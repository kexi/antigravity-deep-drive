import { describe, expect, it, vi } from "vitest";
import {
  computeEngineAcousticParams,
  createExhaustSaturationCurve,
  EngineAudioSystem,
  parseGearIndex,
  resolveInitialEngineAudioConfig,
  type WebAudioBiquadFilterNodeLike,
  type WebAudioBufferLike,
  type WebAudioBufferSourceNodeLike,
  type WebAudioContextLike,
  type WebAudioGainNodeLike,
  type WebAudioGainParamLike,
  type WebAudioOscillatorNodeLike,
  type WebAudioWaveShaperNodeLike,
} from "../audio/engineAudioSystem";
import { InputManager } from "../core/inputManager";

interface MockAudioGraphStats {
  contextResumeCalls: number;
  contextCloseCalls: number;
  oscillatorsCreated: WebAudioOscillatorNodeLike[];
  gainsCreated: WebAudioGainNodeLike[];
  filtersCreated: WebAudioBiquadFilterNodeLike[];
  waveShapersCreated: WebAudioWaveShaperNodeLike[];
  bufferSourcesCreated: WebAudioBufferSourceNodeLike[];
}

function createMockAudioParam(initialValue = 0): WebAudioGainParamLike {
  const param: WebAudioGainParamLike = {
    value: initialValue,
    setValueAtTime: vi.fn((val: number) => {
      param.value = val;
    }),
    setTargetAtTime: vi.fn((val: number) => {
      param.value = val;
    }),
  };
  return param;
}

function createMockWebAudioContext(): {
  context: WebAudioContextLike;
  stats: MockAudioGraphStats;
} {
  const stats: MockAudioGraphStats = {
    contextResumeCalls: 0,
    contextCloseCalls: 0,
    oscillatorsCreated: [],
    gainsCreated: [],
    filtersCreated: [],
    waveShapersCreated: [],
    bufferSourcesCreated: [],
  };

  let currentState: AudioContextState = "suspended";

  const context: WebAudioContextLike = {
    get state(): AudioContextState {
      return currentState;
    },
    currentTime: 1.5,
    sampleRate: 48000,
    destination: {},
    resume: vi.fn(async () => {
      stats.contextResumeCalls += 1;
      currentState = "running";
    }),
    close: vi.fn(async () => {
      stats.contextCloseCalls += 1;
      currentState = "closed";
    }),
    createOscillator: vi.fn((): WebAudioOscillatorNodeLike => {
      const osc: WebAudioOscillatorNodeLike = {
        type: "sine",
        frequency: createMockAudioParam(440),
        detune: createMockAudioParam(0),
        start: vi.fn(),
        stop: vi.fn(),
        connect: vi.fn(),
      };
      stats.oscillatorsCreated.push(osc);
      return osc;
    }),
    createGain: vi.fn((): WebAudioGainNodeLike => {
      const gain: WebAudioGainNodeLike = {
        gain: createMockAudioParam(1),
        connect: vi.fn(),
      };
      stats.gainsCreated.push(gain);
      return gain;
    }),
    createBiquadFilter: vi.fn((): WebAudioBiquadFilterNodeLike => {
      const filter: WebAudioBiquadFilterNodeLike = {
        type: "lowpass",
        frequency: createMockAudioParam(1000),
        Q: createMockAudioParam(1),
        gain: createMockAudioParam(0),
        connect: vi.fn(),
      };
      stats.filtersCreated.push(filter);
      return filter;
    }),
    createWaveShaper: vi.fn((): WebAudioWaveShaperNodeLike => {
      const shaper: WebAudioWaveShaperNodeLike = {
        curve: null,
        oversample: "none",
        connect: vi.fn(),
      };
      stats.waveShapersCreated.push(shaper);
      return shaper;
    }),
    createBuffer: vi.fn((_channels: number, length: number): WebAudioBufferLike => {
      const channelArray = new Float32Array(length);
      return {
        getChannelData: () => channelArray,
      };
    }),
    createBufferSource: vi.fn((): WebAudioBufferSourceNodeLike => {
      const src: WebAudioBufferSourceNodeLike = {
        buffer: null,
        loop: false,
        start: vi.fn(),
        stop: vi.fn(),
        connect: vi.fn(),
      };
      stats.bufferSourcesCreated.push(src);
      return src;
    }),
  };

  return { context, stats };
}

describe("EngineAudioSystem & Procedural Acoustic Model", () => {
  it("URL クエリパラメータ（?sound, ?audio, ?mute, ?volume, ?vol）から初期ミュート状態と音量を安全に解決できることを保証する", () => {
    expect(resolveInitialEngineAudioConfig("")).toEqual({
      muted: false,
      volume: 0.75,
    });

    expect(resolveInitialEngineAudioConfig("?sound=off")).toEqual({
      muted: true,
      volume: 0.75,
    });
    expect(resolveInitialEngineAudioConfig("?audio=muted")).toEqual({
      muted: true,
      volume: 0.75,
    });
    expect(resolveInitialEngineAudioConfig("?mute=1")).toEqual({
      muted: true,
      volume: 0.75,
    });
    expect(resolveInitialEngineAudioConfig("?sound=on&mute=0")).toEqual({
      muted: false,
      volume: 0.75,
    });

    // 小数点 (0..1) およびパーセンテージ (1..100) の音量指定
    expect(resolveInitialEngineAudioConfig("?volume=0.4")).toEqual({
      muted: false,
      volume: 0.4,
    });
    expect(resolveInitialEngineAudioConfig("?vol=60")).toEqual({
      muted: false,
      volume: 0.6,
    });
    expect(resolveInitialEngineAudioConfig("?volume=0")).toEqual({
      muted: true,
      volume: 0,
    });

    // 異常値・負数・上限超過時の安全なクランプとフォールバック
    expect(resolveInitialEngineAudioConfig("?volume=-10")).toEqual({
      muted: true,
      volume: 0,
    });
    expect(resolveInitialEngineAudioConfig("?volume=abc")).toEqual({
      muted: false,
      volume: 0.75,
    });
    expect(resolveInitialEngineAudioConfig("?vol=150")).toEqual({
      muted: false,
      volume: 1,
    });
  });

  it("ギア表記（R / N / P / D 1〜D 4）から数値ギアインデックスを正しく解析できることを保証する", () => {
    expect(parseGearIndex("R")).toBe(-1);
    expect(parseGearIndex("r")).toBe(-1);
    expect(parseGearIndex("N")).toBe(0);
    expect(parseGearIndex("P")).toBe(0);
    expect(parseGearIndex("D 1")).toBe(1);
    expect(parseGearIndex("D 2")).toBe(2);
    expect(parseGearIndex("D 3")).toBe(3);
    expect(parseGearIndex("D 4")).toBe(4);
    expect(parseGearIndex("")).toBe(1);
    expect(parseGearIndex("UNKNOWN")).toBe(1);
  });

  it("排気管の非対称ソフトクリッピング（WaveShaper）カーブが [-1, 1] の範囲内で単調増加することを保証する", () => {
    const curve = createExhaustSaturationCurve(2.2, 512);
    expect(curve).toBeInstanceOf(Float32Array);
    expect(curve.length).toBe(512);

    for (let i = 0; i < curve.length; i++) {
      expect(curve[i]).toBeGreaterThanOrEqual(-1.0);
      expect(curve[i]).toBeLessThanOrEqual(1.0);
      if (i > 0) {
        expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1]);
      }
    }
    // 非対称歪みのため両端の絶対値にわずかな差が生じ、偶数次倍音が付与される
    expect(Math.abs(curve[511] + curve[0])).toBeGreaterThan(0.001);
  });

  it("2.5L 直列4気筒エンジンの RPM に比例して 1次・2次・4次・6次高調波の周波数が物理式通りに算出されることを保証する", () => {
    const idleParams = computeEngineAcousticParams({
      rpm: 800,
      speedKmh: 0,
      throttle: 0,
      brake: 0,
      gear: "D 1",
      cameraMode: "cockpit",
    });

    // 800 rpm -> 800 / 60 = 13.333 Hz (1x subHarmonic), 26.667 Hz (2x fundamental), 53.333 Hz (4x), 80.0 Hz (6x)
    expect(idleParams.effectiveRpm).toBe(800);
    expect(idleParams.subHarmonicHz).toBeCloseTo(800 / 60, 2);
    expect(idleParams.fundamentalHz).toBeCloseTo((800 / 60) * 2, 2);
    expect(idleParams.secondHarmonicHz).toBeCloseTo((800 / 60) * 4, 2);
    expect(idleParams.thirdHarmonicHz).toBeCloseTo((800 / 60) * 6, 2);

    const redlineParams = computeEngineAcousticParams({
      rpm: 6800,
      speedKmh: 180,
      throttle: 1.0,
      brake: 0,
      gear: "D 4",
      cameraMode: "chase",
    });

    expect(redlineParams.effectiveRpm).toBe(6800);
    expect(redlineParams.subHarmonicHz).toBeCloseTo(6800 / 60, 2);
    expect(redlineParams.fundamentalHz).toBeCloseTo((6800 / 60) * 2, 2);
    expect(redlineParams.secondHarmonicHz).toBeCloseTo((6800 / 60) * 4, 2);
    expect(redlineParams.thirdHarmonicHz).toBeCloseTo((6800 / 60) * 6, 2);
    expect(redlineParams.fundamentalHz).toBeGreaterThan(idleParams.fundamentalHz);
    expect(redlineParams.intakeFilterCutoffHz).toBeGreaterThan(idleParams.intakeFilterCutoffHz);
  });

  it("アクセル開度（エンジン負荷）の増加に伴い、燃焼倍音ゲインと吸気ノイズ・ハイブリッドインバーター音が強化されることを保証する", () => {
    const coasting = computeEngineAcousticParams({
      rpm: 3200,
      speedKmh: 70,
      throttle: 0.0,
      brake: 0.0,
      gear: "D 2",
      cameraMode: "cockpit",
    });

    const fullThrottle = computeEngineAcousticParams({
      rpm: 3200,
      speedKmh: 70,
      throttle: 1.0,
      brake: 0.0,
      gear: "D 2",
      cameraMode: "cockpit",
    });

    expect(fullThrottle.fundamentalGain).toBeGreaterThan(coasting.fundamentalGain);
    expect(fullThrottle.secondHarmonicGain).toBeGreaterThan(coasting.secondHarmonicGain);
    expect(fullThrottle.thirdHarmonicGain).toBeGreaterThan(coasting.thirdHarmonicGain);
    expect(fullThrottle.intakeNoiseGain).toBeGreaterThan(coasting.intakeNoiseGain);
    expect(fullThrottle.hybridWhineGain).toBeGreaterThan(coasting.hybridWhineGain);
    expect(fullThrottle.intakeFilterCutoffHz).toBeGreaterThan(coasting.intakeFilterCutoffHz);
    expect(fullThrottle.exhaustFilterCutoffHz).toBeGreaterThan(coasting.exhaustFilterCutoffHz);
  });

  it("車内視点（cockpit）と三人称追跡視点（chase）でキャビン遮音ローパスフィルターと低域共鳴ブーストが切り替わることを保証する", () => {
    const cockpitParams = computeEngineAcousticParams({
      rpm: 3500,
      speedKmh: 80,
      throttle: 0.6,
      brake: 0,
      gear: "D 3",
      cameraMode: "cockpit",
    });

    const chaseParams = computeEngineAcousticParams({
      rpm: 3500,
      speedKmh: 80,
      throttle: 0.6,
      brake: 0,
      gear: "D 3",
      cameraMode: "chase",
    });

    // 車内視点はフロントガラス・バルクヘッド遮音により高域カットオフが低く、車体こもり音（低域ブースト）が強い
    expect(cockpitParams.cabinLowpassCutoffHz).toBeLessThan(chaseParams.cabinLowpassCutoffHz);
    expect(cockpitParams.cabinBassBoostDb).toBeGreaterThan(chaseParams.cabinBassBoostDb);
    expect(cockpitParams.masterEngineGain).toBeLessThan(chaseParams.masterEngineGain);
  });

  it("リバースギア（R）および回生ブレーキ時にハイブリッド MG2 モーター音と後退パルス音が適切に変化することを保証する", () => {
    const reverseParams = computeEngineAcousticParams({
      rpm: 1300,
      speedKmh: -15,
      throttle: 0.3,
      brake: 0,
      gear: "R",
      cameraMode: "cockpit",
    });
    expect(reverseParams.reversePulseGain).toBeGreaterThan(0.05);
    expect(reverseParams.hybridWhineGain).toBeGreaterThan(0.015);

    const regenBrakeParams = computeEngineAcousticParams({
      rpm: 1800,
      speedKmh: 60,
      throttle: 0,
      brake: 0.85,
      gear: "D 2",
      cameraMode: "cockpit",
    });
    const noBrakeParams = computeEngineAcousticParams({
      rpm: 1800,
      speedKmh: 60,
      throttle: 0,
      brake: 0,
      gear: "D 2",
      cameraMode: "cockpit",
    });
    expect(regenBrakeParams.hybridWhineGain).toBeGreaterThan(noBrakeParams.hybridWhineGain);
    expect(regenBrakeParams.reversePulseGain).toBe(0);
  });

  it("シフトアップ・シフトダウンのトランジェントにより点火カット減衰やブリッピング強調が反映されることを保証する", () => {
    const steady = computeEngineAcousticParams({
      rpm: 4200,
      speedKmh: 90,
      throttle: 0.8,
      brake: 0,
      gear: "D 2",
      cameraMode: "chase",
      shiftTransient: 0,
      shiftDirection: 0,
    });

    const upshift = computeEngineAcousticParams({
      rpm: 4200,
      speedKmh: 90,
      throttle: 0.8,
      brake: 0,
      gear: "D 3",
      cameraMode: "chase",
      shiftTransient: 1.0,
      shiftDirection: 1,
    });

    const downshift = computeEngineAcousticParams({
      rpm: 4200,
      speedKmh: 90,
      throttle: 0.8,
      brake: 0,
      gear: "D 1",
      cameraMode: "chase",
      shiftTransient: 1.0,
      shiftDirection: -1,
    });

    // シフトアップ瞬間はトルク制御で一瞬燃焼ゲインと実効RPMが絞られ、シフトダウン時はブリッピングで強調される
    expect(upshift.fundamentalGain).toBeLessThan(steady.fundamentalGain);
    expect(upshift.effectiveRpm).toBeLessThan(steady.effectiveRpm);
    expect(downshift.fundamentalGain).toBeGreaterThan(steady.fundamentalGain);
    expect(downshift.effectiveRpm).toBeGreaterThan(steady.effectiveRpm);
  });

  it("NaN や極端な境界外のテレメトリ入力に対しても有限な音響パラメータを返すことを保証する", () => {
    const anomalous = computeEngineAcousticParams({
      rpm: Number.NaN,
      speedKmh: Number.POSITIVE_INFINITY,
      throttle: -99,
      brake: 999,
      gear: "",
      cameraMode: "cockpit",
    });

    expect(anomalous.effectiveRpm).toBe(780);
    expect(Number.isFinite(anomalous.fundamentalHz)).toBe(true);
    expect(Number.isFinite(anomalous.cabinLowpassCutoffHz)).toBe(true);
    expect(Number.isFinite(anomalous.hybridWhineHz)).toBe(true);
  });

  it("EngineAudioSystem がユーザー操作時に Web Audio グラフを遅延構築・resume し、初回イグニッション音と毎フレーム更新・ミュート制御を行えることを保証する", () => {
    const { context, stats } = createMockWebAudioContext();
    const system = new EngineAudioSystem(
      {
        muted: false,
        volume: 0.8,
      },
      () => context,
    );

    // インスタンス生成直後は Autoplay Policy 配慮のためまだ AudioContext を起動しない
    expect(system.isUnlocked()).toBe(false);
    expect(stats.oscillatorsCreated.length).toBe(0);

    // ユーザー操作でアンロック -> 5基の常駐オシレーター + 1基のセルモーター始動オシレーターが構築される
    const unlocked = system.unlockAudio(true);
    expect(unlocked).toBe(true);
    expect(system.isUnlocked()).toBe(true);
    expect(stats.contextResumeCalls).toBe(1);
    expect(stats.oscillatorsCreated.length).toBe(6); // 5 engine oscillators + 1 starter motor oscillator
    expect(stats.bufferSourcesCreated.length).toBe(1);

    // 2回目の unlockAudio ではセルモーター始動音が重複再生されない
    system.unlockAudio(true);
    expect(stats.oscillatorsCreated.length).toBe(6);

    // 毎フレーム update で RPM・ギア変化に追従して音響パラメータが更新される
    const frame1 = system.update(0.016, {
      rpm: 2800,
      speedKmh: 55,
      throttle: 0.7,
      brake: 0,
      gear: "D 1",
      cameraMode: "cockpit",
    });
    expect(frame1.effectiveRpm).toBeGreaterThan(800);
    expect(system.getLastAcousticParams()).not.toBeNull();

    // D 1 -> D 2 へのシフトアップ発生時の更新
    const frame2 = system.update(0.016, {
      rpm: 2100,
      speedKmh: 58,
      throttle: 0.7,
      brake: 0,
      gear: "D 2",
      cameraMode: "chase",
    });
    expect(frame2.cabinLowpassCutoffHz).toBeGreaterThan(frame1.cabinLowpassCutoffHz);

    // ミュート切り替えと音量変更
    expect(system.toggleMuted()).toBe(true);
    expect(system.isMuted()).toBe(true);
    expect(system.toggleMuted()).toBe(false);
    expect(system.isMuted()).toBe(false);

    expect(system.setVolume(0.5)).toBe(0.5);
    expect(system.getVolume()).toBe(0.5);

    // 破棄処理
    system.dispose();
    expect(stats.contextCloseCalls).toBe(1);
    expect(system.isUnlocked()).toBe(false);
  });

  it("InputManager で [H] キー押下時に onSoundToggle および onUserInteraction コールバックが発火することを保証する", () => {
    const originalWindow = globalThis.window;
    const windowTarget = new EventTarget();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        addEventListener: windowTarget.addEventListener.bind(windowTarget),
        removeEventListener: windowTarget.removeEventListener.bind(windowTarget),
        dispatchEvent: windowTarget.dispatchEvent.bind(windowTarget),
      },
    });

    try {
      const inputManager = new InputManager();
      let toggleCount = 0;
      let interactionCount = 0;

      inputManager.onSoundToggle = () => {
        toggleCount += 1;
      };
      inputManager.onUserInteraction = () => {
        interactionCount += 1;
      };

      const dispatchKey = (type: "keydown" | "keyup", key: string, repeat = false) => {
        const evt = Object.assign(new Event(type), { key, repeat });
        windowTarget.dispatchEvent(evt);
      };

      dispatchKey("keydown", "h");
      expect(toggleCount).toBe(1);
      expect(interactionCount).toBe(1);

      // 押しっぱなしリピート時は多重トグルしない
      dispatchKey("keydown", "h", true);
      expect(toggleCount).toBe(1);

      dispatchKey("keyup", "h");
      dispatchKey("keydown", "H");
      expect(toggleCount).toBe(2);
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
  });

  it("EngineAudioSystem.update() 実行時に R ギアの reversePulseGain が Web Audio ノード（hybridOsc / hybridGain）へ実際に反映されることを保証する", () => {
    const { context, stats } = createMockWebAudioContext();
    const system = new EngineAudioSystem({ muted: false, volume: 0.8 }, () => context);
    system.unlockAudio(false);

    // oscillatorsCreated[4] is hybridOsc; gainsCreated[5] is hybridGain
    const hybridOsc = stats.oscillatorsCreated[4];
    const hybridGain = stats.gainsCreated[5];
    expect(hybridOsc).toBeDefined();
    expect(hybridGain).toBeDefined();

    const forwardParams = system.update(0.05, {
      rpm: 1500,
      speedKmh: 15,
      throttle: 0.35,
      brake: 0,
      gear: "D 1",
      cameraMode: "cockpit",
    });
    const forwardHybridHz = hybridOsc.frequency.value;
    const forwardHybridGainVal = hybridGain.gain.value;
    expect(forwardParams.reversePulseGain).toBe(0);
    expect(forwardHybridHz).toBeCloseTo(forwardParams.hybridWhineHz, 3);
    expect(forwardHybridGainVal).toBeCloseTo(forwardParams.hybridWhineGain, 4);

    // R ギア後退時は reversePulseGain > 0 により hybridOsc 周波数と hybridGain にパルス変調が加算される
    const reverseParams = system.update(0.05, {
      rpm: 1500,
      speedKmh: -15,
      throttle: 0.35,
      brake: 0,
      gear: "R",
      cameraMode: "cockpit",
    });
    expect(reverseParams.reversePulseGain).toBeGreaterThan(0.05);
    expect(hybridOsc.frequency.value).toBeGreaterThan(reverseParams.hybridWhineHz);
    expect(hybridGain.gain.value).toBeGreaterThan(reverseParams.hybridWhineGain);
  });

  it("初回 unlockAudio 時に AudioContext が suspended のままだった場合でも、needsUnlockRetry() が true を返し後続のユーザー操作で resume とセル始動音再生に復帰できることを保証する", async () => {
    const { context, stats } = createMockWebAudioContext();
    let allowRunning = false;
    let currentState: AudioContextState = "suspended";

    Object.defineProperty(context, "state", {
      configurable: true,
      get: () => currentState,
    });
    context.resume = vi.fn(async () => {
      stats.contextResumeCalls += 1;
      if (allowRunning) {
        currentState = "running";
      }
    });

    const system = new EngineAudioSystem({ muted: false, volume: 0.75 }, () => context);

    // 1回目（?autostart=1 等の非ジェスチャー時を想定）: state は suspended のまま
    system.unlockAudio(true);
    expect(system.isUnlocked()).toBe(false);
    expect(system.needsUnlockRetry()).toBe(true);
    // 5基の常駐オシレーターのみ生成され、セルモーター始動音はまだ鳴らない
    expect(stats.oscillatorsCreated.length).toBe(5);

    // 2回目（実ユーザーのキー操作・タッチ・ゲームパッド入力時）: state が running へ遷移
    allowRunning = true;
    system.unlockAudio(true);
    await Promise.resolve();

    expect(system.isUnlocked()).toBe(true);
    expect(system.needsUnlockRetry()).toBe(false);
    expect(stats.contextResumeCalls).toBe(2);
    // running 遷移に伴いセルモーター始動音オシレーター（6基目）が生成・再生される
    expect(stats.oscillatorsCreated.length).toBe(6);
  });

  it("setVolume / adjustVolume により音量 0 で自動ミュート、0 超への変更で自動ミュート解除されることを保証する", () => {
    const { context } = createMockWebAudioContext();
    const system = new EngineAudioSystem({ muted: false, volume: 0.75 }, () => context);

    expect(system.adjustVolume(-0.1)).toBe(0.65);
    expect(system.getVolume()).toBe(0.65);
    expect(system.isMuted()).toBe(false);

    // 音量 0 に設定すると自動的に muted = true になる
    expect(system.setVolume(0)).toBe(0);
    expect(system.isMuted()).toBe(true);

    // ミュート中に音量を +0.1 上げると自動的にミュート解除される
    expect(system.adjustVolume(0.1)).toBe(0.1);
    expect(system.isMuted()).toBe(false);
  });

  it("InputManager で [ / ] キー押下時に onSoundVolumeStep が発火し、range スライダーにフォーカスがあってもショートカットが阻害されないことを保証する", () => {
    const originalWindow = globalThis.window;
    const windowTarget = new EventTarget();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        addEventListener: windowTarget.addEventListener.bind(windowTarget),
        removeEventListener: windowTarget.removeEventListener.bind(windowTarget),
        dispatchEvent: windowTarget.dispatchEvent.bind(windowTarget),
      },
    });

    try {
      const inputManager = new InputManager();
      const steps: number[] = [];
      inputManager.onSoundVolumeStep = (delta) => {
        steps.push(delta);
      };

      const rangeInput = { tagName: "INPUT", type: "range" };
      const textInput = { tagName: "INPUT", type: "text" };

      const dispatchKey = (key: string, target?: unknown) => {
        const evt = Object.assign(new Event("keydown"), { key, repeat: false });
        if (target) {
          Object.defineProperty(evt, "target", { value: target });
        }
        windowTarget.dispatchEvent(evt);
      };

      dispatchKey("[", rangeInput);
      dispatchKey("]", rangeInput);
      expect(steps).toEqual([-0.1, 0.1]);

      // 通常のテキスト入力欄ではショートカットを発火させない
      dispatchKey("[", textInput);
      expect(steps).toEqual([-0.1, 0.1]);
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
  });

  it("InputManager で [Q] が左ウインカー、[E] が右ウインカー、[Z] がハザードランプを発火し、[Shift+Q] / [Shift+E] で左右ドアミラー視線プリセットが発火することを保証する", () => {
    const originalWindow = globalThis.window;
    const windowTarget = new EventTarget();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        addEventListener: windowTarget.addEventListener.bind(windowTarget),
        removeEventListener: windowTarget.removeEventListener.bind(windowTarget),
        dispatchEvent: windowTarget.dispatchEvent.bind(windowTarget),
      },
    });

    try {
      const inputManager = new InputManager();
      const turnSignals: Array<"left" | "right" | "hazard"> = [];
      const gazePresets: string[] = [];

      inputManager.onTurnSignalToggle = (target) => {
        turnSignals.push(target);
      };
      inputManager.onGazePreset = (preset) => {
        gazePresets.push(preset);
      };

      const dispatchKey = (code: string, key: string, shiftKey = false, repeat = false) => {
        const downEvt = Object.assign(new Event("keydown"), {
          code,
          key,
          shiftKey,
          repeat,
        });
        windowTarget.dispatchEvent(downEvt);
        if (!repeat) {
          const upEvt = Object.assign(new Event("keyup"), {
            code,
            key,
            shiftKey,
          });
          windowTarget.dispatchEvent(upEvt);
        }
      };

      // Q = 左ウインカー、E = 右ウインカー、Z = ハザードランプ
      dispatchKey("KeyQ", "q");
      dispatchKey("KeyE", "e");
      dispatchKey("KeyZ", "z");
      expect(turnSignals).toEqual(["left", "right", "hazard"]);
      expect(gazePresets).toEqual([]);

      // キーリピート時は多重発火しないこと
      dispatchKey("KeyQ", "q", false, true);
      dispatchKey("KeyE", "e", false, true);
      windowTarget.dispatchEvent(Object.assign(new Event("keyup"), { code: "KeyQ", key: "q" }));
      windowTarget.dispatchEvent(Object.assign(new Event("keyup"), { code: "KeyE", key: "e" }));
      expect(turnSignals).toEqual(["left", "right", "hazard"]);

      // Shift+Q = 左ミラー視線、Shift+E = 右ミラー視線
      dispatchKey("KeyQ", "Q", true);
      dispatchKey("KeyE", "E", true);
      expect(gazePresets).toEqual(["left_mirror", "right_mirror"]);
      expect(turnSignals).toEqual(["left", "right", "hazard"]);
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
  });

  it("EngineAudioSystem.triggerTurnSignalClick がウインカー点灯 (カチッ: 高音) と消灯 (コチッ: 低音) のフラッシャーリレー音を合成し、ミュート時は発音しないことを保証する", () => {
    const { context, stats } = createMockWebAudioContext();
    const system = new EngineAudioSystem({ muted: false, volume: 0.8 }, () => context);
    system.unlockAudio(false);

    const oscCountBefore = stats.oscillatorsCreated.length;
    // 点灯フェーズ (カチッ)
    expect(system.triggerTurnSignalClick(true)).toBe(true);
    expect(stats.oscillatorsCreated.length).toBe(oscCountBefore + 1);
    const onOsc = stats.oscillatorsCreated[stats.oscillatorsCreated.length - 1];
    expect(onOsc.frequency.setValueAtTime).toHaveBeenCalledWith(1850, context.currentTime);

    // 消灯フェーズ (コチッ)
    expect(system.triggerTurnSignalClick(false)).toBe(true);
    expect(stats.oscillatorsCreated.length).toBe(oscCountBefore + 2);
    const offOsc = stats.oscillatorsCreated[stats.oscillatorsCreated.length - 1];
    expect(offOsc.frequency.setValueAtTime).toHaveBeenCalledWith(1320, context.currentTime);

    // ミュート時はリレー音を鳴らさないこと
    system.setMuted(true);
    expect(system.triggerTurnSignalClick(true)).toBe(false);
    expect(stats.oscillatorsCreated.length).toBe(oscCountBefore + 2);
  });
});

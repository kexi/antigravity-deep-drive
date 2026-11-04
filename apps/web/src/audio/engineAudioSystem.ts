import { logger } from "../core/logger";
import type { CameraMode } from "../types";

export interface EngineTelemetryInput {
  /** エンジン回転数 [rpm] (アイドリング ~800rpm 〜 レッドゾーン ~6,800rpm) */
  rpm: number;
  /** 車速 [km/h] */
  speedKmh: number;
  /** アクセル開度 / エンジン負荷 [0.0 .. 1.0] */
  throttle: number;
  /** ブレーキ開度 [0.0 .. 1.0] */
  brake: number;
  /** 現在のギア表示 ("R", "N", "P", "D 1", "D 2", "D 3", "D 4" 等) */
  gear: string;
  /** カメラ視点 ("cockpit": 車内遮音ガラス環境 / "chase": 車外直達排気・吸気環境) */
  cameraMode: CameraMode;
  /** 変速トランジェント進行度 [0.0 .. 1.0] (0: 通常走行, >0: 変速中トルクカット/ブリッピング) */
  shiftTransient?: number;
  /** シフトアップ(1) / シフトダウン(-1) / 非変速(0) */
  shiftDirection?: -1 | 0 | 1;
}

export interface EngineAcousticParams {
  /** クランク角実効回転数 [rpm] (変速トランジェントや負荷補正後) */
  effectiveRpm: number;
  /** 直列4気筒4ストローク基本爆発周波数 (2次成分: RPM / 60 * 2) [Hz] */
  fundamentalHz: number;
  /** クランクシャフト1次回転基本波 (1次成分: RPM / 60 * 1) [Hz] */
  subHarmonicHz: number;
  /** 直列4気筒特有の4次メカニカル倍音 (4次成分: RPM / 60 * 4) [Hz] */
  secondHarmonicHz: number;
  /** 高回転排気共鳴6次倍音 (6次成分: RPM / 60 * 6) [Hz] */
  thirdHarmonicHz: number;
  /** マルチステージハイブリッド MG1/MG2 インバータ・モーター唸り周波数 [Hz] */
  hybridWhineHz: number;
  /** 基本爆発波 (2次) ゲイン [0.0 .. 1.0] */
  fundamentalGain: number;
  /** クランク1次サブハーモニック (重低音) ゲイン [0.0 .. 1.0] */
  subHarmonicGain: number;
  /** 4次倍音ゲイン [0.0 .. 1.0] */
  secondHarmonicGain: number;
  /** 6次高回転メタリック倍音ゲイン [0.0 .. 1.0] */
  thirdHarmonicGain: number;
  /** ハイブリッドモーター/回生インバータ音ゲイン [0.0 .. 1.0] */
  hybridWhineGain: number;
  /** 吸気インダクション＆燃焼パルスノイズゲイン [0.0 .. 1.0] */
  intakeNoiseGain: number;
  /** 吸気バンドパスフィルタ中心周波数 [Hz] */
  intakeFilterCutoffHz: number;
  /** 排気ローパスフィルタカットオフ周波数 [Hz] */
  exhaustFilterCutoffHz: number;
  /** キャビン遮音ローパスフィルタカットオフ周波数 (cockpit vs chase) [Hz] */
  cabinLowpassCutoffHz: number;
  /** キャビン低域共鳴ピーキングゲイン [dB] */
  cabinBassBoostDb: number;
  /** リバースギア警告チャイム / ギヤ唸り変調ゲイン [0.0 .. 1.0] */
  reversePulseGain: number;
  /** 全体のエンジン合成出力ゲイン (ミュート・マスター音量乗算前) [0.0 .. 1.0] */
  masterEngineGain: number;
}

export interface EngineAudioConfig {
  /** 初期ミュート状態 */
  muted?: boolean;
  /** 初期マスター音量 [0.0 .. 1.0] */
  volume?: number;
}

export interface WebAudioGainParamLike {
  value: number;
  setTargetAtTime(target: number, startTime: number, timeConstant: number): void;
  setValueAtTime(value: number, startTime: number): void;
}

export interface WebAudioOscillatorNodeLike {
  type: OscillatorType;
  frequency: WebAudioGainParamLike;
  detune?: WebAudioGainParamLike;
  connect(destination: unknown): unknown;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface WebAudioBiquadFilterNodeLike {
  type: BiquadFilterType;
  frequency: WebAudioGainParamLike;
  Q: WebAudioGainParamLike;
  gain: WebAudioGainParamLike;
  connect(destination: unknown): unknown;
}

export interface WebAudioGainNodeLike {
  gain: WebAudioGainParamLike;
  connect(destination: unknown): unknown;
}

export interface WebAudioWaveShaperNodeLike {
  curve: Float32Array | null;
  oversample: OverSampleType;
  connect(destination: unknown): unknown;
}

export interface WebAudioBufferLike {
  getChannelData(channel: number): Float32Array;
}

export interface WebAudioBufferSourceNodeLike {
  buffer: WebAudioBufferLike | null;
  loop: boolean;
  connect(destination: unknown): unknown;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface WebAudioContextLike {
  readonly state: AudioContextState;
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly destination: unknown;
  createOscillator(): WebAudioOscillatorNodeLike;
  createGain(): WebAudioGainNodeLike;
  createBiquadFilter(): WebAudioBiquadFilterNodeLike;
  createWaveShaper(): WebAudioWaveShaperNodeLike;
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): WebAudioBufferLike;
  createBufferSource(): WebAudioBufferSourceNodeLike;
  resume(): Promise<void>;
  suspend?(): Promise<void>;
  close?(): Promise<void>;
}

const MIN_IDLE_RPM = 780;
const MAX_REDLINE_RPM = 6800;

function clamp(value: number, min: number, max: number): number {
  const isNotFinite = !Number.isFinite(value);
  if (isNotFinite) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number): number {
  const clampedT = clamp(t, 0, 1);
  return a + (b - a) * clampedT;
}

/**
 * URL クエリ（?sound=off, ?audio=muted, ?mute=1, ?volume=0.6 等）から初期オーディオ設定を解決する
 */
export function resolveInitialEngineAudioConfig(search = ""): Required<EngineAudioConfig> {
  const rawSearch = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(rawSearch);

  const soundParam = (params.get("sound") ?? params.get("audio") ?? "").trim().toLowerCase();
  const muteParam = (params.get("mute") ?? params.get("muted") ?? "").trim().toLowerCase();

  const isExplicitlyMuted =
    soundParam === "off" ||
    soundParam === "0" ||
    soundParam === "false" ||
    soundParam === "mute" ||
    soundParam === "muted" ||
    muteParam === "1" ||
    muteParam === "true" ||
    muteParam === "on";

  const volumeParam = params.get("volume") ?? params.get("vol");
  let resolvedVolume = 0.75;
  const hasVolumeParam = volumeParam !== null && volumeParam.trim().length > 0;
  if (hasVolumeParam) {
    const parsedVolume = Number(volumeParam);
    const isValidNumber = Number.isFinite(parsedVolume);
    if (isValidNumber) {
      // 0..1 または 0..100 のパーセント指定の両方を許容する
      const normalized = parsedVolume > 1.0 ? parsedVolume / 100 : parsedVolume;
      resolvedVolume = clamp(normalized, 0, 1);
    }
  }

  return {
    muted: isExplicitlyMuted || resolvedVolume === 0,
    volume: resolvedVolume,
  };
}

/**
 * ギア段数の数値を抽出する（"R" -> -1, "N"/"P" -> 0, "D 1" -> 1 .. "D 4" -> 4）
 */
export function parseGearIndex(gear: string): number {
  const normalized = (gear || "").trim().toUpperCase();
  const isReverse = normalized.startsWith("R");
  if (isReverse) {
    return -1;
  }
  const isNeutralOrPark = normalized === "N" || normalized === "P";
  if (isNeutralOrPark) {
    return 0;
  }
  const match = /(\d+)/.exec(normalized);
  const hasNumber = Boolean(match && match[1]);
  if (hasNumber) {
    return clamp(Number.parseInt(match![1], 10), 1, 10);
  }
  return 1;
}

/**
 * 排気・燃焼系の非線形ソフトクリッピング（倍音付加）用 WaveShaper カーブを生成する
 * Why WaveShaper を使うか:
 * 単純なサイン波・ノコギリ波の加算だけでは電子オルガンのような無機質な音になるため、
 * 双曲線正接 (tanh) ベースの非対称サチュレーションで内燃機関のシリンダー爆発圧力の偶数次・奇数次倍音を自然に生成する。
 */
export function createExhaustSaturationCurve(drive = 2.4, samples = 1024): Float32Array {
  const safeSamples = Math.max(64, Math.floor(samples));
  const safeDrive = clamp(drive, 0.5, 10);
  const curve = new Float32Array(safeSamples);
  const norm = Math.tanh(safeDrive * 1.08);

  for (let i = 0; i < safeSamples; i++) {
    const x = (i * 2) / (safeSamples - 1) - 1;
    // 正負でわずかに非対称性を持たせ、排気管内の圧力波の偶数次倍音を生み出す
    const biasedX = x >= 0 ? x * 1.08 : x * 0.92;
    curve[i] = clamp(Math.tanh(biasedX * safeDrive) / norm, -1, 1);
  }
  return curve;
}

/**
 * トヨタ クラウン セダン (AZSH32: 2.5L 直列4気筒 A25A-FXS + マルチステージハイブリッド) の
 * 車両テレメトリからプロシージャル音響合成パラメータを算出する純粋関数。
 */
export function computeEngineAcousticParams(input: EngineTelemetryInput): EngineAcousticParams {
  const rawRpm = clamp(input.rpm, MIN_IDLE_RPM, MAX_REDLINE_RPM);
  const speedKmh = clamp(Math.abs(input.speedKmh), 0, 240);
  const throttle = clamp(input.throttle, 0, 1);
  const brake = clamp(input.brake, 0, 1);
  const shiftTransient = clamp(input.shiftTransient ?? 0, 0, 1);
  const shiftDirection = input.shiftDirection ?? 0;
  const gearIndex = parseGearIndex(input.gear);
  const isReverse = gearIndex < 0;
  const isCockpit = input.cameraMode === "cockpit";

  // アクセル踏み込み時のトルクコンバータ / e-CVT ステップ負荷による実効回転数の 미세上昇と、
  // 変速トランジェント時の回転数変動（シフトアップ時は一瞬点火カット、シフトダウン時はブリッピング）
  const throttleRpmBoost = throttle * (speedKmh < 5 ? 650 : 280);
  const shiftRpmOffset =
    shiftDirection > 0 ? -shiftTransient * 260 : shiftDirection < 0 ? shiftTransient * 420 : 0;

  const effectiveRpm = clamp(
    rawRpm + throttleRpmBoost + shiftRpmOffset,
    MIN_IDLE_RPM,
    MAX_REDLINE_RPM,
  );
  const rpmNormalized = clamp(
    (effectiveRpm - MIN_IDLE_RPM) / (MAX_REDLINE_RPM - MIN_IDLE_RPM),
    0,
    1,
  );

  // 直列4気筒 4ストローク機関の次数周波数:
  // 1回転(360度)あたり2気筒が爆発するため、基本爆発周波数(2次)は (RPM / 60) * 2 [Hz]
  const crankHz = effectiveRpm / 60;
  const subHarmonicHz = crankHz; // 1次: 約 13Hz (780rpm) 〜 113Hz (6800rpm)
  const fundamentalHz = crankHz * 2; // 2次(基本爆発): 約 26Hz 〜 226Hz
  const secondHarmonicHz = crankHz * 4; // 4次: 約 52Hz 〜 453Hz
  const thirdHarmonicHz = crankHz * 6; // 6次: 約 78Hz 〜 680Hz

  // マルチステージハイブリッド (MG1/MG2) のインバータ・減速機高周波トーン:
  // 低中速の加速時および回生ブレーキ減速時に澄んだ高周波のモーター音が重なる
  const speedRatio = clamp(speedKmh / 140, 0, 1);
  const hybridWhineHz = 280 + speedRatio * 1450 + throttle * 180;

  // 変速中（シフトアップ点火カット）の瞬間的なトルクディップ
  const shiftTorqueCut =
    shiftDirection > 0 ? 1.0 - shiftTransient * 0.48 : 1.0 + shiftTransient * 0.18;

  // エンジン負荷（スロットル開度 + エンブレ負圧）
  const engineLoad = clamp(throttle * 0.82 + rpmNormalized * 0.28 + brake * 0.08, 0.12, 1.0);

  // 各ハーモニクスのゲイン配分
  // アイドリング〜低回転では1次・2次の落ち着いた重低音が主体となり、
  // 高回転・高負荷（フルスロットル）になるほど4次・6次の直4VVT-iEメカニカルサウンドと吸気音が立ち上がる
  const subHarmonicGain = clamp(
    (0.24 * (1.0 - rpmNormalized * 0.35) + throttle * 0.08) * shiftTorqueCut,
    0.04,
    0.45,
  );
  const fundamentalGain = clamp(
    (0.32 + rpmNormalized * 0.22 + throttle * 0.24) * shiftTorqueCut,
    0.1,
    0.85,
  );
  const secondHarmonicGain = clamp(
    (0.11 + rpmNormalized * 0.28 + throttle * 0.25) * shiftTorqueCut,
    0.04,
    0.7,
  );
  const thirdHarmonicGain = clamp(
    (0.03 + Math.pow(rpmNormalized, 1.4) * 0.26 + throttle * rpmNormalized * 0.22) * shiftTorqueCut,
    0.01,
    0.55,
  );

  // ハイブリッドモーター音ゲイン: EV発進域〜中速加速時および回生制動時に存在感を出す
  const regenBrakeFactor = speedKmh > 6 ? brake * 0.65 : 0;
  const tractionMotorFactor = throttle * (1.0 - speedRatio * 0.35);
  const hybridWhineGain = clamp(
    (0.02 + tractionMotorFactor * 0.09 + regenBrakeFactor * 0.08) * (isReverse ? 1.35 : 1.0),
    0.005,
    0.22,
  );

  // 吸気インダクションノイズ（スロットル開度とRPMに強く比例する空気吸引・燃焼乱流音）
  const intakeNoiseGain = clamp(
    (0.03 + throttle * 0.22 + rpmNormalized * 0.14) * shiftTorqueCut,
    0.015,
    0.42,
  );
  const intakeFilterCutoffHz = lerp(380, 2600, clamp(rpmNormalized * 0.65 + throttle * 0.35, 0, 1));

  // 排気系のローパスフィルタカットオフ（負荷と回転数が上がるほど高域倍音が抜ける）
  const exhaustFilterCutoffHz = lerp(
    240,
    3200,
    clamp(rpmNormalized * 0.6 + engineLoad * 0.4, 0, 1),
  );

  // カメラ視点別の音響空間フィルタリング
  // Why cockpit と chase でフィルタ特性を大きく変えるか:
  // トヨタ クラウン セダン (AZSH32) の車内はアコースティックガラスと吸音材で高周波ノイズが遮断され、
  // 落ち着いた低中域のエンジンの鼓動が心地よく響く一方、車外追従視点ではマフラー直達の排気音とメカニカル音が明瞭に聴こえるため。
  const cabinLowpassCutoffHz = isCockpit
    ? lerp(440, 1380, clamp(rpmNormalized * 0.55 + throttle * 0.45, 0, 1))
    : lerp(1350, 4400, clamp(rpmNormalized * 0.6 + throttle * 0.4, 0, 1));

  const cabinBassBoostDb = isCockpit ? 4.2 + throttle * 2.0 : 1.5 + throttle * 1.2;

  // リバース時のバックギヤ特有の唸り・パルスゲイン
  const reversePulseGain = isReverse ? clamp(0.06 + (speedKmh / 30) * 0.12, 0.06, 0.2) : 0;

  // 全体ゲイン（車内視点は静粛性を保ちつつ、アクセル全開時は力強い咆哮を届ける）
  const perspectiveScale = isCockpit ? 0.76 : 1.0;
  const masterEngineGain = clamp(
    (0.26 + rpmNormalized * 0.36 + throttle * 0.28) * perspectiveScale,
    0.12,
    0.95,
  );

  return {
    effectiveRpm,
    fundamentalHz,
    subHarmonicHz,
    secondHarmonicHz,
    thirdHarmonicHz,
    hybridWhineHz,
    fundamentalGain,
    subHarmonicGain,
    secondHarmonicGain,
    thirdHarmonicGain,
    hybridWhineGain,
    intakeNoiseGain,
    intakeFilterCutoffHz,
    exhaustFilterCutoffHz,
    cabinLowpassCutoffHz,
    cabinBassBoostDb,
    reversePulseGain,
    masterEngineGain,
  };
}

/**
 * Web Audio API によるプロシージャル・エンジンサウンドシンセサイザー
 * - 外部音声アセット (.wav / .mp3) に依存せず、リアルタイム物理テレメトリから直接合成
 * - ブラウザ Autoplay Policy に準拠し、ユーザー操作時に AudioContext を安全にアンロック＆セルモーター始動音を再生
 */
export class EngineAudioSystem {
  private audioContext: WebAudioContextLike | null = null;
  private readonly contextFactory: (() => WebAudioContextLike | null) | null;

  private muted: boolean;
  private volume: number;
  private initialized = false;
  private unlocked = false;
  private hasPlayedIgnition = false;

  private lastGear = "D 1";
  private shiftTransient = 0;
  private shiftDirection: -1 | 0 | 1 = 0;
  private smoothedRpm = 800;
  private smoothedThrottle = 0;
  private reversePulsePhase = 0;
  private lastAcousticParams: EngineAcousticParams | null = null;

  // Web Audio Graph Nodes
  private masterGainNode: WebAudioGainNodeLike | null = null;
  private cabinLowpassFilter: WebAudioBiquadFilterNodeLike | null = null;
  private cabinBassFilter: WebAudioBiquadFilterNodeLike | null = null;
  private exhaustLowpassFilter: WebAudioBiquadFilterNodeLike | null = null;
  private exhaustShaperNode: WebAudioWaveShaperNodeLike | null = null;

  private subOsc: WebAudioOscillatorNodeLike | null = null;
  private subGain: WebAudioGainNodeLike | null = null;

  private fundamentalOsc: WebAudioOscillatorNodeLike | null = null;
  private fundamentalGain: WebAudioGainNodeLike | null = null;

  private secondHarmonicOsc: WebAudioOscillatorNodeLike | null = null;
  private secondHarmonicGain: WebAudioGainNodeLike | null = null;

  private thirdHarmonicOsc: WebAudioOscillatorNodeLike | null = null;
  private thirdHarmonicGain: WebAudioGainNodeLike | null = null;

  private hybridOsc: WebAudioOscillatorNodeLike | null = null;
  private hybridGain: WebAudioGainNodeLike | null = null;

  private intakeNoiseSource: WebAudioBufferSourceNodeLike | null = null;
  private intakeBandpassFilter: WebAudioBiquadFilterNodeLike | null = null;
  private intakeGain: WebAudioGainNodeLike | null = null;

  constructor(config?: EngineAudioConfig, contextFactory?: () => WebAudioContextLike | null) {
    const initialSearch =
      typeof window !== "undefined" && window.location ? window.location.search : "";
    const resolved = resolveInitialEngineAudioConfig(initialSearch);
    this.muted = config?.muted ?? resolved.muted;
    this.volume = clamp(config?.volume ?? resolved.volume, 0, 1);
    this.contextFactory = contextFactory ?? null;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public getVolume(): number {
    return this.volume;
  }

  public isInitialized(): boolean {
    return this.initialized;
  }

  public isUnlocked(): boolean {
    const ctx = this.audioContext;
    const isRunning = ctx !== null && ctx.state !== "suspended";
    return this.unlocked && isRunning;
  }

  /**
   * ブラウザの Autoplay Policy により AudioContext が未初期化または suspended のままであり、
   * 次回のユーザージェスチャー時に unlockAudio() / resume() の再試行が必要かどうかを返す
   */
  public needsUnlockRetry(): boolean {
    const ctx = this.audioContext;
    if (!this.unlocked || ctx === null) {
      return true;
    }
    return ctx.state === "suspended";
  }

  public getLastAcousticParams(): EngineAcousticParams | null {
    return this.lastAcousticParams;
  }

  /**
   * ミュート状態を設定し、マスターゲインへ即座に反映する
   */
  public setMuted(muted: boolean): boolean {
    const wasMuted = this.muted;
    this.muted = Boolean(muted);

    const isUnmuting = wasMuted && !this.muted;
    if (isUnmuting) {
      this.unlockAudio();
    }

    this.applyMasterGain();

    const didChange = wasMuted !== this.muted;
    if (didChange) {
      logger.withTrace("audio", "engine_audio.mute_trace", () => {
        logger.info(
          "audio",
          "engine_audio.mute_changed",
          this.muted ? "Engine audio muted" : "Engine audio unmuted",
          {
            muted: this.muted,
            volume: this.volume,
            unlocked: this.unlocked,
          },
        );
      });
    }

    return this.muted;
  }

  /**
   * ミュート状態をトグルする
   */
  public toggleMuted(): boolean {
    return this.setMuted(!this.muted);
  }

  /**
   * マスター音量 (0.0 .. 1.0) を設定する
   */
  public setVolume(volume: number): number {
    const safeVolume = Number.isFinite(volume) ? clamp(volume, 0, 1) : this.volume;
    this.volume = Math.round(safeVolume * 100) / 100;
    const isZeroVolume = this.volume <= 0;
    if (isZeroVolume) {
      this.muted = true;
    } else if (this.muted) {
      this.muted = false;
      this.unlockAudio();
    }
    this.applyMasterGain();

    logger.withTrace("audio", "engine_audio.volume_trace", () => {
      logger.info(
        "audio",
        "engine_audio.volume_changed",
        `Engine audio volume set to ${Math.round(this.volume * 100)}%`,
        {
          volume: this.volume,
          muted: this.muted,
        },
      );
    });
    return this.volume;
  }

  /**
   * マスター音量を相対ステップ（例: -0.1 / +0.1）で増減する
   */
  public adjustVolume(delta: number): number {
    const safeDelta = Number.isFinite(delta) ? delta : 0;
    const baseVolume = this.muted && safeDelta > 0 && this.volume <= 0 ? 0 : this.volume;
    return this.setVolume(baseVolume + safeDelta);
  }

  /**
   * ユーザー操作（ドライブ開始ボタン・キー押下・ゲームパッド入力等）を契機に
   * Web Audio グラフを初期化・アンロックし、初回のみエンジン始動音（イグニッション）を鳴らす
   */
  public unlockAudio(playIgnitionOnFirstUnlock = true): boolean {
    const hasGraph = this.ensureAudioGraph();
    const ctx = this.audioContext;
    if (!hasGraph || ctx === null) {
      return false;
    }

    const completeUnlockIfRunning = (): void => {
      const isStillSuspended = ctx.state === "suspended";
      if (isStillSuspended) {
        return;
      }

      const wasUnlocked = this.unlocked;
      this.unlocked = true;
      this.applyMasterGain();

      const shouldPlayIgnition =
        playIgnitionOnFirstUnlock && !this.hasPlayedIgnition && !this.muted;
      if (shouldPlayIgnition) {
        this.triggerIgnition();
      }

      if (!wasUnlocked) {
        logger.withTrace("audio", "engine_audio.unlock_trace", () => {
          logger.info(
            "audio",
            "engine_audio.unlocked",
            "Web Audio API engine synthesizer unlocked",
            {
              contextState: ctx.state,
              sampleRate: ctx.sampleRate,
              muted: this.muted,
              volume: this.volume,
            },
          );
        });
      }
    };

    const isSuspended = ctx.state === "suspended";
    if (isSuspended) {
      const resumeResult = ctx.resume();
      // モック等で resume() 呼び出し中に同期的に state が running へ変わった場合は即完了
      completeUnlockIfRunning();

      const hasPromise = Boolean(resumeResult && typeof resumeResult.then === "function");
      if (hasPromise) {
        void resumeResult
          .then(() => {
            completeUnlockIfRunning();
          })
          .catch(() => {
            // ブラウザの Autoplay 制限がまだ解除されていない場合は次回入力時に再試行する
          });
      }
    } else {
      completeUnlockIfRunning();
    }

    this.applyMasterGain();
    return this.isUnlocked();
  }

  /**
   * 2.5L 直列4気筒マルチステージハイブリッドのエンジン始動（セルモーター＆初爆吹き上がり）サウンドを合成する
   */
  public triggerIgnition(): void {
    const hasGraph = this.ensureAudioGraph();
    if (!hasGraph || !this.audioContext || !this.cabinLowpassFilter || this.muted) {
      return;
    }

    this.hasPlayedIgnition = true;
    // 初爆の軽いブリッピング（約 1,450 rpm まで一瞬跳ね上がってからアイドリングへ落ち着く）
    this.smoothedRpm = Math.max(this.smoothedRpm, 1450);

    try {
      const now = this.audioContext.currentTime;
      const starterOsc = this.audioContext.createOscillator();
      const starterGain = this.audioContext.createGain();

      // ハイブリッド MG1 スターターによる滑らかで力強いクランキング音 (110Hz -> 240Hz -> 130Hz)
      starterOsc.type = "sawtooth";
      starterOsc.frequency.setValueAtTime(110, now);
      starterOsc.frequency.setTargetAtTime(245, now + 0.04, 0.08);
      starterOsc.frequency.setTargetAtTime(62, now + 0.22, 0.12);

      starterGain.gain.setValueAtTime(0.001, now);
      starterGain.gain.setTargetAtTime(0.18 * this.volume, now + 0.02, 0.04);
      starterGain.gain.setTargetAtTime(0.0001, now + 0.28, 0.1);

      starterOsc.connect(starterGain);
      starterGain.connect(this.cabinLowpassFilter);
      starterOsc.start(now);
      starterOsc.stop(now + 0.65);
    } catch {
      // モック環境や停止済みコンテキストでの例外を安全に無視
    }
  }

  /**
   * ウインカー（方向指示器）・ハザード点滅時の車内フラッシャーリレー音（「カチッ・コチッ」）を合成する
   * - How:
   *   1. 点灯フェーズ (`isOnPhase = true`: Tick) では約 1,850Hz → 980Hz の鋭い電磁リレー接点アタック音を発生させる。
   *   2. 消灯フェーズ (`isOnPhase = false`: Tock) では約 1,320Hz → 720Hz の落ち着いた接点復帰音を発生させる。
   *   3. エンジン音が低回転（アイドリング/EV走行中）で `masterGainNode` のゲインが絞られている状態でも一定のクリアな音量で聞こえるよう、
   *      `this.volume` でスケーリングした上で `audioContext.destination` へ直接出力する。
   */
  public triggerTurnSignalClick(isOnPhase: boolean): boolean {
    const isMutedOrZero = this.muted || this.volume <= 0;
    if (isMutedOrZero) {
      return false;
    }

    const hasGraph = this.ensureAudioGraph();
    if (!hasGraph || !this.audioContext) {
      return false;
    }

    try {
      const now = this.audioContext.currentTime;
      const relayOsc = this.audioContext.createOscillator();
      const relayGain = this.audioContext.createGain();

      // 点灯 (Tick: 高めの金属接点音) と消灯 (Tock: やや低い復帰音) で周波数を切り替え
      const startFreqHz = isOnPhase ? 1850 : 1320;
      const endFreqHz = isOnPhase ? 960 : 720;
      const peakGain = (isOnPhase ? 0.14 : 0.11) * this.volume;

      relayOsc.type = "triangle";
      relayOsc.frequency.setValueAtTime(startFreqHz, now);
      relayOsc.frequency.setTargetAtTime(endFreqHz, now + 0.004, 0.008);

      relayGain.gain.setValueAtTime(peakGain, now);
      relayGain.gain.setTargetAtTime(0.0001, now + 0.006, 0.007);

      relayOsc.connect(relayGain);
      relayGain.connect(this.audioContext.destination);
      relayOsc.start(now);
      relayOsc.stop(now + 0.038);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 毎フレームの車両物理状態からエンジン音響パラメータを計算し、Web Audio ノードを更新する
   */
  public update(dt: number, telemetry: EngineTelemetryInput): EngineAcousticParams {
    const safeDt = clamp(dt, 0.001, 0.25);

    // ギア変速検知とトランジェント生成（D1 <-> D2 <-> D3 <-> D4）
    const currentGear = telemetry.gear || "D 1";
    const didGearChange = currentGear !== this.lastGear;
    if (didGearChange) {
      const prevGearIdx = parseGearIndex(this.lastGear);
      const nextGearIdx = parseGearIndex(currentGear);
      this.lastGear = currentGear;

      const isForwardShift = prevGearIdx >= 1 && nextGearIdx >= 1 && prevGearIdx !== nextGearIdx;
      if (isForwardShift) {
        this.shiftTransient = 1.0;
        this.shiftDirection = nextGearIdx > prevGearIdx ? 1 : -1;
      }
    } else if (this.shiftTransient > 0) {
      // 約 0.22 秒で変速トランジェントを減衰させる
      this.shiftTransient = Math.max(0, this.shiftTransient - safeDt * 4.5);
      const isShiftFinished = this.shiftTransient <= 1e-3;
      if (isShiftFinished) {
        this.shiftTransient = 0;
        this.shiftDirection = 0;
      }
    }

    // エンジン回転数とスロットルの時間平滑化（フライホイール慣性と吸気マニホールド応答）
    const rpmLerpRate = clamp(safeDt * 14.0, 0.05, 1.0);
    const throttleLerpRate = clamp(safeDt * 18.0, 0.08, 1.0);
    const targetRpm = clamp(telemetry.rpm, MIN_IDLE_RPM, MAX_REDLINE_RPM);
    this.smoothedRpm = lerp(this.smoothedRpm, targetRpm, rpmLerpRate);
    this.smoothedThrottle = lerp(
      this.smoothedThrottle,
      clamp(telemetry.throttle, 0, 1),
      throttleLerpRate,
    );

    const params = computeEngineAcousticParams({
      ...telemetry,
      rpm: this.smoothedRpm,
      throttle: this.smoothedThrottle,
      shiftTransient: telemetry.shiftTransient ?? this.shiftTransient,
      shiftDirection: telemetry.shiftDirection ?? this.shiftDirection,
    });
    this.lastAcousticParams = params;

    const canUpdateAudioGraph =
      this.initialized && this.audioContext !== null && !this.muted && this.unlocked;
    if (!canUpdateAudioGraph) {
      return params;
    }

    const now = this.audioContext!.currentTime;
    const timeConstant = 0.024; // 24ms 時定数でジッパーノイズを防止

    // リバースギア時は後退警告チャイム＆遊星ギヤ唸り変調（約 2.2Hz 周期パルス）をハイブリッド音に重畳する
    const isReversing = params.reversePulseGain > 0;
    let reverseModulationGain = 0;
    let reversePitchOffsetHz = 0;
    if (isReversing) {
      this.reversePulsePhase =
        (this.reversePulsePhase + safeDt * 2.2 * Math.PI * 2) % (Math.PI * 2);
      const pulseEnvelope = 0.5 + 0.5 * Math.sin(this.reversePulsePhase);
      reverseModulationGain = params.reversePulseGain * (0.45 + 0.55 * pulseEnvelope);
      reversePitchOffsetHz = pulseEnvelope > 0.55 ? 210 : 95;
    } else {
      this.reversePulsePhase = 0;
    }

    this.subOsc?.frequency.setTargetAtTime(params.subHarmonicHz, now, timeConstant);
    this.fundamentalOsc?.frequency.setTargetAtTime(params.fundamentalHz, now, timeConstant);
    this.secondHarmonicOsc?.frequency.setTargetAtTime(params.secondHarmonicHz, now, timeConstant);
    this.thirdHarmonicOsc?.frequency.setTargetAtTime(params.thirdHarmonicHz, now, timeConstant);
    this.hybridOsc?.frequency.setTargetAtTime(
      params.hybridWhineHz + reversePitchOffsetHz,
      now,
      timeConstant,
    );

    this.subGain?.gain.setTargetAtTime(params.subHarmonicGain, now, timeConstant);
    this.fundamentalGain?.gain.setTargetAtTime(params.fundamentalGain, now, timeConstant);
    this.secondHarmonicGain?.gain.setTargetAtTime(params.secondHarmonicGain, now, timeConstant);
    this.thirdHarmonicGain?.gain.setTargetAtTime(params.thirdHarmonicGain, now, timeConstant);
    const effectiveHybridGain = clamp(params.hybridWhineGain + reverseModulationGain, 0.005, 0.38);
    this.hybridGain?.gain.setTargetAtTime(effectiveHybridGain, now, timeConstant);

    this.intakeBandpassFilter?.frequency.setTargetAtTime(
      params.intakeFilterCutoffHz,
      now,
      timeConstant,
    );
    this.intakeGain?.gain.setTargetAtTime(params.intakeNoiseGain, now, timeConstant);

    this.exhaustLowpassFilter?.frequency.setTargetAtTime(
      params.exhaustFilterCutoffHz,
      now,
      timeConstant,
    );
    this.cabinLowpassFilter?.frequency.setTargetAtTime(
      params.cabinLowpassCutoffHz,
      now,
      timeConstant,
    );
    this.cabinBassFilter?.gain.setTargetAtTime(params.cabinBassBoostDb, now, timeConstant);

    const effectiveMaster = this.muted ? 0 : params.masterEngineGain * this.volume;
    this.masterGainNode?.gain.setTargetAtTime(effectiveMaster, now, timeConstant);

    return params;
  }

  /**
   * リソース解放（ページアンロードやテスト終了時用）
   */
  public dispose(): void {
    try {
      this.subOsc?.stop();
      this.fundamentalOsc?.stop();
      this.secondHarmonicOsc?.stop();
      this.thirdHarmonicOsc?.stop();
      this.hybridOsc?.stop();
      this.intakeNoiseSource?.stop();
      void this.audioContext?.close?.();
    } catch {
      // 既に停止している場合のエラーは無視
    }
    this.initialized = false;
    this.unlocked = false;
    this.audioContext = null;
  }

  private applyMasterGain(): void {
    const hasMasterNode = Boolean(this.masterGainNode && this.audioContext);
    if (!hasMasterNode) {
      return;
    }
    const now = this.audioContext!.currentTime;
    const baseEngineGain = this.lastAcousticParams?.masterEngineGain ?? 0.32;
    const targetGain = this.muted || !this.unlocked ? 0 : baseEngineGain * this.volume;
    this.masterGainNode!.gain.setTargetAtTime(targetGain, now, 0.03);
  }

  private createDefaultAudioContext(): WebAudioContextLike | null {
    const isBrowser = typeof window !== "undefined";
    if (!isBrowser) {
      return null;
    }
    const win = window as unknown as {
      AudioContext?: new () => WebAudioContextLike;
      webkitAudioContext?: new () => WebAudioContextLike;
    };
    const AudioCtx = win.AudioContext ?? win.webkitAudioContext;
    const hasAudioConstructor = typeof AudioCtx === "function";
    if (!hasAudioConstructor) {
      return null;
    }
    try {
      return new AudioCtx();
    } catch {
      return null;
    }
  }

  private ensureAudioGraph(): boolean {
    if (this.initialized && this.audioContext) {
      return true;
    }

    const ctx = this.contextFactory ? this.contextFactory() : this.createDefaultAudioContext();
    const hasContext = Boolean(ctx);
    if (!hasContext || !ctx) {
      return false;
    }

    this.audioContext = ctx;
    const now = ctx.currentTime;

    // 1. マスター出力とキャビン空間フィルタチェーン
    // [Exhaust Shaper -> Exhaust LPF] + [Intake Noise] + [Hybrid Whine]
    //    --> [Cabin Bass Resonance Peaking] --> [Cabin Insulation LPF] --> [Master Gain] --> destination
    this.masterGainNode = ctx.createGain();
    this.masterGainNode.gain.setValueAtTime(0, now);
    this.masterGainNode.connect(ctx.destination);

    this.cabinLowpassFilter = ctx.createBiquadFilter();
    this.cabinLowpassFilter.type = "lowpass";
    this.cabinLowpassFilter.frequency.setValueAtTime(680, now);
    this.cabinLowpassFilter.Q.setValueAtTime(0.85, now);
    this.cabinLowpassFilter.connect(this.masterGainNode);

    this.cabinBassFilter = ctx.createBiquadFilter();
    this.cabinBassFilter.type = "peaking";
    this.cabinBassFilter.frequency.setValueAtTime(88, now);
    this.cabinBassFilter.Q.setValueAtTime(1.25, now);
    this.cabinBassFilter.gain.setValueAtTime(3.8, now);
    this.cabinBassFilter.connect(this.cabinLowpassFilter);

    // 2. 内燃機関（直列4気筒 2.5L）排気・倍音サチュレーションチェーン
    this.exhaustLowpassFilter = ctx.createBiquadFilter();
    this.exhaustLowpassFilter.type = "lowpass";
    this.exhaustLowpassFilter.frequency.setValueAtTime(420, now);
    this.exhaustLowpassFilter.Q.setValueAtTime(1.1, now);
    this.exhaustLowpassFilter.connect(this.cabinBassFilter);

    this.exhaustShaperNode = ctx.createWaveShaper();
    this.exhaustShaperNode.curve = createExhaustSaturationCurve(2.4, 1024);
    this.exhaustShaperNode.oversample = "2x";
    this.exhaustShaperNode.connect(this.exhaustLowpassFilter);

    // 2a. クランク1次サブハーモニック (triangle 波で厚みのある低域振動を生成)
    this.subOsc = ctx.createOscillator();
    this.subOsc.type = "triangle";
    this.subOsc.frequency.setValueAtTime(14, now);
    this.subGain = ctx.createGain();
    this.subGain.gain.setValueAtTime(0.18, now);
    this.subOsc.connect(this.subGain);
    this.subGain.connect(this.exhaustShaperNode);
    this.subOsc.start(now);

    // 2b. 直4基本爆発2次周波数 (sawtooth 波でシリンダー内燃焼圧力パルスを表現)
    this.fundamentalOsc = ctx.createOscillator();
    this.fundamentalOsc.type = "sawtooth";
    this.fundamentalOsc.frequency.setValueAtTime(28, now);
    this.fundamentalGain = ctx.createGain();
    this.fundamentalGain.gain.setValueAtTime(0.32, now);
    this.fundamentalOsc.connect(this.fundamentalGain);
    this.fundamentalGain.connect(this.exhaustShaperNode);
    this.fundamentalOsc.start(now);

    // 2c. 4次メカニカル倍音 (sawtooth 波)
    this.secondHarmonicOsc = ctx.createOscillator();
    this.secondHarmonicOsc.type = "sawtooth";
    this.secondHarmonicOsc.frequency.setValueAtTime(56, now);
    this.secondHarmonicGain = ctx.createGain();
    this.secondHarmonicGain.gain.setValueAtTime(0.12, now);
    this.secondHarmonicOsc.connect(this.secondHarmonicGain);
    this.secondHarmonicGain.connect(this.exhaustShaperNode);
    this.secondHarmonicOsc.start(now);

    // 2d. 6次高回転エキゾースト共鳴倍音 (triangle 波)
    this.thirdHarmonicOsc = ctx.createOscillator();
    this.thirdHarmonicOsc.type = "triangle";
    this.thirdHarmonicOsc.frequency.setValueAtTime(84, now);
    this.thirdHarmonicGain = ctx.createGain();
    this.thirdHarmonicGain.gain.setValueAtTime(0.04, now);
    this.thirdHarmonicOsc.connect(this.thirdHarmonicGain);
    this.thirdHarmonicGain.connect(this.exhaustShaperNode);
    this.thirdHarmonicOsc.start(now);

    // 3. マルチステージハイブリッド MG1/MG2 モーター＆インバータ高周波レイヤー
    this.hybridOsc = ctx.createOscillator();
    this.hybridOsc.type = "sine";
    this.hybridOsc.frequency.setValueAtTime(320, now);
    this.hybridGain = ctx.createGain();
    this.hybridGain.gain.setValueAtTime(0.02, now);
    this.hybridOsc.connect(this.hybridGain);
    this.hybridGain.connect(this.cabinLowpassFilter);
    this.hybridOsc.start(now);

    // 4. 吸気インダクション＆燃焼乱流ブラウニアン/ピンクノイズレイヤー
    // 2秒ループの決定論的ピンク調ノイズバッファを生成し、バンドパスフィルタで吸気共鳴をシミュレート
    const bufferLength = Math.max(4096, Math.floor(ctx.sampleRate * 2));
    const noiseBuffer = ctx.createBuffer(1, bufferLength, ctx.sampleRate);
    const channelData = noiseBuffer.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let seed = 0x6d2b79f5;
    for (let i = 0; i < bufferLength; i++) {
      // Xorshift 風の軽量決定論的 PRNG で再現性のある滑らかなノイズを生成
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      const white = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;

      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      channelData[i] = clamp((b0 + b1 + b2 + white * 0.1848) * 0.22, -1, 1);
    }

    this.intakeBandpassFilter = ctx.createBiquadFilter();
    this.intakeBandpassFilter.type = "bandpass";
    this.intakeBandpassFilter.frequency.setValueAtTime(480, now);
    this.intakeBandpassFilter.Q.setValueAtTime(1.6, now);

    this.intakeGain = ctx.createGain();
    this.intakeGain.gain.setValueAtTime(0.03, now);

    this.intakeNoiseSource = ctx.createBufferSource();
    this.intakeNoiseSource.buffer = noiseBuffer;
    this.intakeNoiseSource.loop = true;
    this.intakeNoiseSource.connect(this.intakeBandpassFilter);
    this.intakeBandpassFilter.connect(this.intakeGain);
    this.intakeGain.connect(this.cabinBassFilter);
    this.intakeNoiseSource.start(now);

    this.initialized = true;
    return true;
  }
}

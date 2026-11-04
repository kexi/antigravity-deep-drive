import type { GazePreset, VehicleInput } from "../types";
import { logger } from "./logger";

/**
 * Nintendo Switch Pro Controller (第1世代 / Switch ProCon 1) の USB / Bluetooth ベンダー・プロダクト識別定数
 * - Vendor ID: `057e` (Nintendo Co., Ltd.)
 * - Product ID: `2009` (Pro Controller)
 */
export const SWITCH_PRO_VENDOR_ID = "057e";
export const SWITCH_PRO_PRODUCT_ID = "2009";

/**
 * Switch ProCon 1 のドリフト防止用デフォルトデッドゾーン（9%）と非線形応答カーブ指数（1.35）
 * - Why not デッドゾーン 0 や完全線形 (exponent = 1.0) にしないか:
 *   Switch Pro Controller（第1世代）のアナログスティックは構造上センター付近で数%の残留オフセット（ドリフト）が発生しやすく、
 *   また完全線形では高速走行時の微小なレーンキープ操舵が過敏になるため、9% デッドゾーン再正規化＋指数 1.35 カーブで
 *   直進安定性とフルロック応答性を両立する。
 */
export const DEFAULT_STICK_DEADZONE = 0.09;
export const DEFAULT_STICK_CURVE_EXPONENT = 1.35;

/**
 * W3C Standard Gamepad Mapping における Switch Pro Controller ボタンインデックス定義
 * - Why not Xbox 表記（A=下, B=右）をそのままラベルにしないか:
 *   W3C Standard Gamepad では物理位置ベースで `buttons[0]` が下、`buttons[1]` が右に割り当てられるため、
 *   Switch ProCon 1 の物理印字では `buttons[0] = B（下）`、`buttons[1] = A（右）`、`buttons[2] = Y（左）`、`buttons[3] = X（上）` となる。
 */
export const SWITCH_PRO_BUTTON_INDEX = {
  B: 0,
  A: 1,
  Y: 2,
  X: 3,
  L: 4,
  R: 5,
  ZL: 6,
  ZR: 7,
  MINUS: 8,
  PLUS: 9,
  L3: 10,
  R3: 11,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
  HOME: 16,
  CAPTURE: 17,
} as const;

export type SwitchProButtonName = keyof typeof SWITCH_PRO_BUTTON_INDEX;

export interface GamepadButtonLike {
  readonly pressed: boolean;
  readonly value: number;
}

export interface GamepadLike {
  readonly id: string;
  readonly index: number;
  readonly connected: boolean;
  readonly mapping: string;
  readonly axes: ReadonlyArray<number>;
  readonly buttons: ReadonlyArray<GamepadButtonLike>;
  readonly vibrationActuator?: {
    playEffect?: (
      type: "dual-rumble",
      params?: {
        startDelay?: number;
        duration?: number;
        weakMagnitude?: number;
        strongMagnitude?: number;
      },
    ) => Promise<unknown>;
  } | null;
}

export interface GamepadConnectionStatus {
  connected: boolean;
  isSwitchProCon1: boolean;
  gamepadIndex: number | null;
  rawId: string;
  deviceLabel: string;
  mapping: string;
}

export interface GamepadPollSnapshot {
  status: GamepadConnectionStatus;
  connected: boolean;
  isSwitchProCon1: boolean;
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  vehicleInput: VehicleInput;
  leftStickX: number;
  leftStickY: number;
  rightStickX: number;
  rightStickY: number;
}

export interface GamepadActionCallbacks {
  onCameraToggle?: () => void;
  onAreaToggle?: () => void;
  onTimeToggle?: () => void;
  onRoadSurfaceToggle?: () => void;
  onWiperToggle?: () => void;
  onGraphicsQualityToggle?: () => void;
  onResetVehicle?: () => void;
  onSignCreatorToggle?: () => void;
  onGazePreset?: (preset: GazePreset) => void;
  onStatusChange?: (status: GamepadConnectionStatus) => void;
}

export interface GamepadControllerOptions extends GamepadActionCallbacks {
  deadzone?: number;
  curveExponent?: number;
  getGamepads?: () => ReadonlyArray<GamepadLike | null>;
  isInputBlocked?: () => boolean;
  isModalOpen?: () => boolean;
}

export interface GamepadRumbleOptions {
  durationMs?: number;
  strongMagnitude?: number;
  weakMagnitude?: number;
}

export interface RawHidHatDirections {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

/**
 * Gamepad API の `gamepad.id` 文字列から Nintendo Switch Pro Controller (ProCon 1) かどうかを判定する
 * - How:
 *   1. USB / Bluetooth の Vendor ID `057e` かつ Product ID `2009` の組み合わせ（Chromium / Firefox / Safari 各形式）を検査する。
 *   2. ブラウザ固有のヒューマンリーダブル名称（`"pro controller"`, `"switch pro controller"`, `"nintendo switch pro"`, `"procon"`）を大文字小文字を区別せず検査する。
 */
export function isSwitchProController(id: string | null | undefined): boolean {
  const isInvalidId = typeof id !== "string" || id.trim().length === 0;
  if (isInvalidId) {
    return false;
  }

  const normalized = id.toLowerCase();
  const hasNintendoVendor = normalized.includes(SWITCH_PRO_VENDOR_ID);
  const hasProConProduct = normalized.includes(SWITCH_PRO_PRODUCT_ID);
  const isVendorProductMatch = hasNintendoVendor && hasProConProduct;
  if (isVendorProductMatch) {
    return true;
  }

  const hasProControllerLabel =
    normalized.includes("pro controller") ||
    normalized.includes("switch pro controller") ||
    normalized.includes("nintendo switch pro") ||
    normalized.includes("procon");
  return hasProControllerLabel;
}

/**
 * アナログスティック入力 `[-1, 1]` にデッドゾーン再正規化と非線形指数カーブを適用する
 * - How:
 *   1. `|rawValue| <= deadzone` の場合は `0` を返し、スティック中立付近の微少ドリフトを遮断する。
 *   2. デッドゾーン外の領域 `[deadzone, 1.0]` を `[0.0, 1.0]` に線形再正規化し、段差（ジャンプ）を無くす。
 *   3. `normalized ^ exponent` の非線形カーブを適用し、センター付近の繊細な舵角調整と最大切れ角の到達性を両立する。
 */
export function applyStickDeadzoneAndCurve(
  rawValue: number,
  deadzone: number = DEFAULT_STICK_DEADZONE,
  exponent: number = DEFAULT_STICK_CURVE_EXPONENT,
): number {
  const isNotFinite = !Number.isFinite(rawValue);
  if (isNotFinite) {
    return 0;
  }

  const safeDeadzone = Number.isFinite(deadzone) ? Math.max(0, Math.min(0.95, deadzone)) : 0;
  const safeExponent = Number.isFinite(exponent) ? Math.max(0.1, Math.min(5.0, exponent)) : 1;

  const clamped = Math.max(-1, Math.min(1, rawValue));
  const absVal = Math.abs(clamped);
  const isInsideDeadzone = absVal <= safeDeadzone;
  if (isInsideDeadzone) {
    return 0;
  }

  const normalized = (absVal - safeDeadzone) / (1 - safeDeadzone);
  const curved = Math.pow(normalized, safeExponent);
  const signedResult = Math.sign(clamped) * Math.min(1, Math.max(0, curved));
  const isZeroResult = Math.abs(signedResult) < 1e-9;
  if (isZeroResult) {
    return 0;
  }
  return signedResult;
}

/**
 * 非標準マッピング (`mapping !== "standard"`) 環境における Raw HID POV ハットスイッチ (`axes[9]`) を
 * 上下左右のデジタル入力へデコードする
 * - How:
 *   DirectInput / Linux / macOS の 8方向 POV ハット値 `k / 7` (`k ∈ {-7, -5, -3, -1, +1, +3, +5, +7}`) を判定し、
 *   ニュートラル値（`|v| < 0.08` または `|v| > 1.05`）では全方向 `false` を返す。
 */
export function decodeRawHidHatSwitch(hatValue: number | undefined): RawHidHatDirections {
  const isNeutralOrInvalid =
    hatValue === undefined ||
    !Number.isFinite(hatValue) ||
    Math.abs(hatValue) < 0.08 ||
    Math.abs(hatValue) > 1.05;
  if (isNeutralOrInvalid) {
    return { up: false, down: false, left: false, right: false };
  }

  const up = hatValue <= -0.6 || hatValue >= 0.85;
  const right = hatValue >= -0.85 && hatValue <= -0.08;
  const down = hatValue >= -0.25 && hatValue <= 0.55;
  const left = hatValue >= 0.3 && hatValue <= 1.05;

  return { up, down, left, right };
}

interface ButtonPressEdgeMap {
  X: boolean;
  L: boolean;
  R: boolean;
  ZL: boolean;
  ZR: boolean;
  MINUS: boolean;
  PLUS: boolean;
  L3: boolean;
  R3: boolean;
  DPAD_UP: boolean;
  DPAD_DOWN: boolean;
  DPAD_LEFT: boolean;
  DPAD_RIGHT: boolean;
  HOME: boolean;
  CAPTURE: boolean;
}

function createEmptyButtonEdgeMap(): ButtonPressEdgeMap {
  return {
    X: false,
    L: false,
    R: false,
    ZL: false,
    ZR: false,
    MINUS: false,
    PLUS: false,
    L3: false,
    R3: false,
    DPAD_UP: false,
    DPAD_DOWN: false,
    DPAD_LEFT: false,
    DPAD_RIGHT: false,
    HOME: false,
    CAPTURE: false,
  };
}

/**
 * Nintendo Switch Pro Controller (ProCon 1) および W3C Standard Gamepad 入力コントローラー
 * - How:
 *   1. `gamepadconnected` / `gamepaddisconnected` イベントとフレーム毎の `navigator.getGamepads()` ポーリングを併用し、
 *      Switch ProCon 1 (`057e:2009`) が複数パッド接続時にも最優先で選択されるように管理する。
 *   2. アクセル（`ZR` / `A`）、ブレーキ・後退（`ZL` / `B`）、サイドブレーキ（`Y`）、操舵（左スティック X軸）、
 *      自由視線パン（右スティック X/Y軸）をリアルタイム算出する。
 *   3. 視点・ミラー・環境・ワイパー・リセット等の単発アクションボタンは前フレームとの差分（立ち上がりエッジ）のみで発火させ、
 *      長押し中の連続暴発を防止する。
 */
export class GamepadController {
  private readonly deadzone: number;
  private readonly curveExponent: number;
  private readonly customGetGamepads?: () => ReadonlyArray<GamepadLike | null>;
  private readonly isInputBlocked?: () => boolean;
  private readonly isModalOpen?: () => boolean;
  private callbacks: GamepadActionCallbacks = {};

  private status: GamepadConnectionStatus = {
    connected: false,
    isSwitchProCon1: false,
    gamepadIndex: null,
    rawId: "",
    deviceLabel: "Nintendo Switch Pro Controller (ProCon 1)",
    mapping: "",
  };

  private previousButtons: ButtonPressEdgeMap = createEmptyButtonEdgeMap();
  private lastSnapshot: GamepadPollSnapshot = {
    status: {
      connected: false,
      isSwitchProCon1: false,
      gamepadIndex: null,
      rawId: "",
      deviceLabel: "Nintendo Switch Pro Controller (ProCon 1)",
      mapping: "",
    },
    connected: false,
    isSwitchProCon1: false,
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: false,
    vehicleInput: { throttle: 0, brake: 0, steer: 0, handbrake: false },
    leftStickX: 0,
    leftStickY: 0,
    rightStickX: 0,
    rightStickY: 0,
  };

  private readonly boundHandleConnect: (e: Event) => void;
  private readonly boundHandleDisconnect: (e: Event) => void;

  constructor(options: GamepadControllerOptions = {}, callbacks: GamepadActionCallbacks = {}) {
    this.deadzone = options.deadzone ?? DEFAULT_STICK_DEADZONE;
    this.curveExponent = options.curveExponent ?? DEFAULT_STICK_CURVE_EXPONENT;
    this.customGetGamepads = options.getGamepads;
    this.isInputBlocked = options.isInputBlocked;
    this.isModalOpen = options.isModalOpen;
    this.callbacks = {
      onCameraToggle: options.onCameraToggle,
      onAreaToggle: options.onAreaToggle,
      onTimeToggle: options.onTimeToggle,
      onRoadSurfaceToggle: options.onRoadSurfaceToggle,
      onWiperToggle: options.onWiperToggle,
      onGraphicsQualityToggle: options.onGraphicsQualityToggle,
      onResetVehicle: options.onResetVehicle,
      onSignCreatorToggle: options.onSignCreatorToggle,
      onGazePreset: options.onGazePreset,
      onStatusChange: options.onStatusChange,
      ...callbacks,
    };

    this.boundHandleConnect = (e: Event) => {
      const gamepadEvent = e as GamepadEvent;
      this.handleGamepadConnected(gamepadEvent.gamepad);
    };
    this.boundHandleDisconnect = (e: Event) => {
      const gamepadEvent = e as GamepadEvent;
      this.handleGamepadDisconnected(gamepadEvent.gamepad);
    };

    const hasWindow = typeof window !== "undefined";
    if (hasWindow) {
      window.addEventListener("gamepadconnected", this.boundHandleConnect);
      window.addEventListener("gamepaddisconnected", this.boundHandleDisconnect);
    }
  }

  public setCallbacks(callbacks: GamepadActionCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  public getStatus(): GamepadConnectionStatus {
    return { ...this.status };
  }

  public getLastSnapshot(): GamepadPollSnapshot {
    return {
      status: { ...this.lastSnapshot.status },
      connected: this.lastSnapshot.connected,
      isSwitchProCon1: this.lastSnapshot.isSwitchProCon1,
      throttle: this.lastSnapshot.throttle,
      brake: this.lastSnapshot.brake,
      steer: this.lastSnapshot.steer,
      handbrake: this.lastSnapshot.handbrake,
      vehicleInput: { ...this.lastSnapshot.vehicleInput },
      leftStickX: this.lastSnapshot.leftStickX,
      leftStickY: this.lastSnapshot.leftStickY,
      rightStickX: this.lastSnapshot.rightStickX,
      rightStickY: this.lastSnapshot.rightStickY,
    };
  }

  public resetEdgeState(): void {
    this.previousButtons = createEmptyButtonEdgeMap();
    const currentStatus = this.getStatus();
    this.lastSnapshot = {
      status: currentStatus,
      connected: currentStatus.connected,
      isSwitchProCon1: currentStatus.isSwitchProCon1,
      throttle: 0,
      brake: 0,
      steer: 0,
      handbrake: false,
      vehicleInput: { throttle: 0, brake: 0, steer: 0, handbrake: false },
      leftStickX: 0,
      leftStickY: 0,
      rightStickX: 0,
      rightStickY: 0,
    };
  }

  /**
   * 現在のフレームにおける Gamepad 状態をポーリングし、車両操作入力・L/Rスティック視線入力・単発ボタンイベントを更新する
   */
  public poll(): GamepadPollSnapshot {
    const activePad = this.selectActiveGamepad();
    const isDisconnected = activePad === null;
    if (isDisconnected) {
      const wasConnected = this.status.connected;
      if (wasConnected) {
        this.updateConnectionStatus(null);
      }
      this.previousButtons = createEmptyButtonEdgeMap();
      const currentStatus = this.getStatus();
      this.lastSnapshot = {
        status: currentStatus,
        connected: false,
        isSwitchProCon1: false,
        throttle: 0,
        brake: 0,
        steer: 0,
        handbrake: false,
        vehicleInput: { throttle: 0, brake: 0, steer: 0, handbrake: false },
        leftStickX: 0,
        leftStickY: 0,
        rightStickX: 0,
        rightStickY: 0,
      };
      return this.getLastSnapshot();
    }

    const isDifferentPad =
      !this.status.connected ||
      this.status.gamepadIndex !== activePad.index ||
      this.status.rawId !== activePad.id;
    if (isDifferentPad) {
      this.updateConnectionStatus(activePad);
    }

    const isBlocked = (this.isInputBlocked?.() ?? false) || (this.isModalOpen?.() ?? false);
    const currentEdges = this.readButtonEdgeState(activePad);
    const currentStatus = this.getStatus();

    if (isBlocked) {
      // Why not モーダル表示中に previousButtons を放置しないか:
      // モーダル表示中にボタンを押しっぱなしにしてモーダルを閉じた瞬間、前フレームとの差分で意図しない単発ショートカットが暴発するのを防ぐため
      this.previousButtons = currentEdges;
      this.lastSnapshot = {
        status: currentStatus,
        connected: true,
        isSwitchProCon1: currentStatus.isSwitchProCon1,
        throttle: 0,
        brake: 0,
        steer: 0,
        handbrake: false,
        vehicleInput: { throttle: 0, brake: 0, steer: 0, handbrake: false },
        leftStickX: 0,
        leftStickY: 0,
        rightStickX: 0,
        rightStickY: 0,
      };
      return this.getLastSnapshot();
    }

    this.dispatchRisingEdgeActions(currentEdges);
    this.previousButtons = currentEdges;

    const zrVal = this.readButtonValue(activePad, SWITCH_PRO_BUTTON_INDEX.ZR);
    const aVal = this.readButtonValue(activePad, SWITCH_PRO_BUTTON_INDEX.A);
    const zlVal = this.readButtonValue(activePad, SWITCH_PRO_BUTTON_INDEX.ZL);
    const bVal = this.readButtonValue(activePad, SWITCH_PRO_BUTTON_INDEX.B);
    const yPressed = this.isButtonPressed(activePad, SWITCH_PRO_BUTTON_INDEX.Y);

    const throttle = Math.max(0, Math.min(1, Math.max(zrVal, aVal)));
    const brake = Math.max(0, Math.min(1, Math.max(zlVal, bVal)));
    const handbrake = yPressed;

    const rawLeftStickX = this.readAxisValue(activePad, 0);
    const rawLeftStickY = this.readAxisValue(activePad, 1);
    const leftStickX = applyStickDeadzoneAndCurve(rawLeftStickX, this.deadzone, this.curveExponent);
    const leftStickY = applyStickDeadzoneAndCurve(rawLeftStickY, this.deadzone, this.curveExponent);
    const steer = leftStickX;

    const isRawHid = activePad.mapping !== "standard";
    // Raw HID 環境で axes[2]/axes[3] または axes[2]/axes[5] に右スティックが割り当てられるケースを吸収
    const rawRightStickX = this.readAxisValue(activePad, 2);
    const hasStandardRightY = !isRawHid || Math.abs(this.readAxisValue(activePad, 3)) >= 1e-4;
    const rawRightStickY = hasStandardRightY
      ? this.readAxisValue(activePad, 3)
      : this.readAxisValue(activePad, 5);

    const rightStickX = applyStickDeadzoneAndCurve(
      rawRightStickX,
      this.deadzone,
      this.curveExponent,
    );
    const rightStickY = applyStickDeadzoneAndCurve(
      rawRightStickY,
      this.deadzone,
      this.curveExponent,
    );

    this.lastSnapshot = {
      status: currentStatus,
      connected: true,
      isSwitchProCon1: currentStatus.isSwitchProCon1,
      throttle,
      brake,
      steer,
      handbrake,
      vehicleInput: {
        throttle,
        brake,
        steer,
        handbrake,
      },
      leftStickX,
      leftStickY,
      rightStickX,
      rightStickY,
    };

    return this.getLastSnapshot();
  }

  /**
   * 対応ブラウザで Switch ProCon 1 の HD振動 (`vibrationActuator.playEffect("dual-rumble", ...)`) を安全に呼び出す
   */
  public async triggerRumble(
    optionsOrDurationMs: GamepadRumbleOptions | number = {},
    weakMagnitudeArg?: number,
    strongMagnitudeArg?: number,
  ): Promise<boolean> {
    const activePad = this.selectActiveGamepad();
    const isMissingPad = activePad === null;
    if (isMissingPad) {
      return false;
    }

    const actuator = activePad.vibrationActuator;
    const playEffectFn = actuator?.playEffect;
    const isMissingActuator = typeof playEffectFn !== "function";
    if (isMissingActuator) {
      return false;
    }

    const isNumericArg = typeof optionsOrDurationMs === "number";
    const rawDuration = isNumericArg ? optionsOrDurationMs : (optionsOrDurationMs.durationMs ?? 90);
    const rawWeak = isNumericArg
      ? (weakMagnitudeArg ?? 0.25)
      : (optionsOrDurationMs.weakMagnitude ?? 0.25);
    const rawStrong = isNumericArg
      ? (strongMagnitudeArg ?? 0.35)
      : (optionsOrDurationMs.strongMagnitude ?? 0.35);

    const duration = Math.max(10, Math.min(2000, rawDuration));
    const weakMagnitude = Math.max(0, Math.min(1, rawWeak));
    const strongMagnitude = Math.max(0, Math.min(1, rawStrong));

    try {
      await playEffectFn.call(actuator, "dual-rumble", {
        startDelay: 0,
        duration,
        weakMagnitude,
        strongMagnitude,
      });
      return true;
    } catch {
      return false;
    }
  }

  private handleGamepadConnected(gamepad: GamepadLike | null | undefined): void {
    const isInvalidGamepad = !gamepad;
    if (isInvalidGamepad) {
      return;
    }
    this.updateConnectionStatus(gamepad);
  }

  private handleGamepadDisconnected(gamepad: GamepadLike | null | undefined): void {
    const isMatchingIndex =
      gamepad !== null && gamepad !== undefined && this.status.gamepadIndex === gamepad.index;
    if (isMatchingIndex) {
      const remainingPad = this.selectActiveGamepad(gamepad.index);
      this.updateConnectionStatus(remainingPad);
      this.previousButtons = createEmptyButtonEdgeMap();
    }
  }

  private updateConnectionStatus(gamepad: GamepadLike | null): void {
    const isConnecting = gamepad !== null;
    if (isConnecting) {
      const proCon = isSwitchProController(gamepad.id);
      const nextStatus: GamepadConnectionStatus = {
        connected: true,
        isSwitchProCon1: proCon,
        gamepadIndex: gamepad.index,
        rawId: gamepad.id,
        deviceLabel: proCon
          ? "Nintendo Switch Pro Controller (ProCon 1)"
          : gamepad.id || "Generic Gamepad",
        mapping: gamepad.mapping || "raw-hid",
      };
      this.status = nextStatus;
      logger.withTrace(
        "input",
        "gamepad.connected",
        () => {
          this.callbacks.onStatusChange?.(this.getStatus());
        },
        {
          gamepadIndex: gamepad.index,
          rawId: gamepad.id,
          isSwitchProCon1: proCon,
          mapping: nextStatus.mapping,
          buttonsCount: gamepad.buttons.length,
          axesCount: gamepad.axes.length,
        },
      );
      return;
    }

    const previousId = this.status.rawId;
    const previousIndex = this.status.gamepadIndex;
    this.status = {
      connected: false,
      isSwitchProCon1: false,
      gamepadIndex: null,
      rawId: "",
      deviceLabel: "Nintendo Switch Pro Controller (ProCon 1)",
      mapping: "",
    };
    logger.withTrace(
      "input",
      "gamepad.disconnected",
      () => {
        this.callbacks.onStatusChange?.(this.getStatus());
      },
      {
        previousIndex,
        previousId,
      },
    );
  }

  private readGamepadsList(): ReadonlyArray<GamepadLike | null> {
    const hasCustomProvider = typeof this.customGetGamepads === "function";
    if (hasCustomProvider) {
      try {
        return this.customGetGamepads!() ?? [];
      } catch {
        return [];
      }
    }

    const isMissingNavigatorGamepads =
      typeof navigator === "undefined" || typeof navigator.getGamepads !== "function";
    if (isMissingNavigatorGamepads) {
      return [];
    }

    try {
      return navigator.getGamepads() ?? [];
    } catch {
      return [];
    }
  }

  /**
   * 接続中の Gamepad 一覧から優先すべき 1 台を選択する（Switch ProCon 1 を最優先）
   */
  private selectActiveGamepad(excludeIndex?: number): GamepadLike | null {
    const pads = this.readGamepadsList();
    let fallbackPad: GamepadLike | null = null;

    for (const pad of pads) {
      const isUsablePad =
        pad !== null && pad !== undefined && pad.connected !== false && pad.index !== excludeIndex;
      if (isUsablePad) {
        const isProCon = isSwitchProController(pad.id);
        if (isProCon) {
          return pad;
        }
        const hasNoFallback = fallbackPad === null;
        if (hasNoFallback) {
          fallbackPad = pad;
        }
      }
    }

    return fallbackPad;
  }

  private readButtonValue(pad: GamepadLike, buttonIndex: number): number {
    const btn = pad.buttons[buttonIndex];
    const isMissingButton = btn === undefined || btn === null;
    if (isMissingButton) {
      return 0;
    }
    const numericVal = typeof btn.value === "number" && Number.isFinite(btn.value) ? btn.value : 0;
    const pressedVal = btn.pressed ? 1 : 0;
    return Math.max(numericVal, pressedVal);
  }

  private isButtonPressed(pad: GamepadLike, buttonIndex: number): boolean {
    const btn = pad.buttons[buttonIndex];
    const isMissingButton = btn === undefined || btn === null;
    if (isMissingButton) {
      return false;
    }
    const isPressedFlag = Boolean(btn.pressed);
    const isAboveThreshold =
      typeof btn.value === "number" && Number.isFinite(btn.value) && btn.value >= 0.5;
    return isPressedFlag || isAboveThreshold;
  }

  private readAxisValue(pad: GamepadLike, axisIndex: number): number {
    const raw = pad.axes[axisIndex];
    const isInvalidNumber = typeof raw !== "number" || !Number.isFinite(raw);
    if (isInvalidNumber) {
      return 0;
    }
    return raw;
  }

  private readButtonEdgeState(pad: GamepadLike): ButtonPressEdgeMap {
    const isStandardMapping = pad.mapping === "standard";
    const hatDirections = isStandardMapping
      ? { up: false, down: false, left: false, right: false }
      : decodeRawHidHatSwitch(pad.axes[9]);

    return {
      X: this.isButtonPressed(pad, SWITCH_PRO_BUTTON_INDEX.X),
      L: this.isButtonPressed(pad, SWITCH_PRO_BUTTON_INDEX.L),
      R: this.isButtonPressed(pad, SWITCH_PRO_BUTTON_INDEX.R),
      ZL: this.isButtonPressed(pad, SWITCH_PRO_BUTTON_INDEX.ZL),
      ZR: this.isButtonPressed(pad, SWITCH_PRO_BUTTON_INDEX.ZR),
      MINUS: this.isButtonPressed(pad, SWITCH_PRO_BUTTON_INDEX.MINUS),
      PLUS: this.isButtonPressed(pad, SWITCH_PRO_BUTTON_INDEX.PLUS),
      L3: this.isButtonPressed(pad, SWITCH_PRO_BUTTON_INDEX.L3),
      R3: this.isButtonPressed(pad, SWITCH_PRO_BUTTON_INDEX.R3),
      DPAD_UP: this.isButtonPressed(pad, SWITCH_PRO_BUTTON_INDEX.DPAD_UP) || hatDirections.up,
      DPAD_DOWN: this.isButtonPressed(pad, SWITCH_PRO_BUTTON_INDEX.DPAD_DOWN) || hatDirections.down,
      DPAD_LEFT: this.isButtonPressed(pad, SWITCH_PRO_BUTTON_INDEX.DPAD_LEFT) || hatDirections.left,
      DPAD_RIGHT:
        this.isButtonPressed(pad, SWITCH_PRO_BUTTON_INDEX.DPAD_RIGHT) || hatDirections.right,
      HOME: this.isButtonPressed(pad, SWITCH_PRO_BUTTON_INDEX.HOME),
      CAPTURE: this.isButtonPressed(pad, SWITCH_PRO_BUTTON_INDEX.CAPTURE),
    };
  }

  private dispatchRisingEdgeActions(current: ButtonPressEdgeMap): void {
    const prev = this.previousButtons;

    const isXRising = current.X && !prev.X;
    if (isXRising) {
      this.callbacks.onCameraToggle?.();
    }

    const isLRising = current.L && !prev.L;
    if (isLRising) {
      this.callbacks.onGazePreset?.(current.ZL ? "left_shoulder" : "left_mirror");
    }

    const isRRising = current.R && !prev.R;
    if (isRRising) {
      this.callbacks.onGazePreset?.(current.ZR ? "right_shoulder" : "right_mirror");
    }

    const isR3Rising = current.R3 && !prev.R3;
    if (isR3Rising) {
      this.callbacks.onGazePreset?.("forward");
    }

    const isL3Rising = current.L3 && !prev.L3;
    if (isL3Rising) {
      this.callbacks.onRoadSurfaceToggle?.();
    }

    const isDpadUpRising = current.DPAD_UP && !prev.DPAD_UP;
    if (isDpadUpRising) {
      this.callbacks.onGazePreset?.("rearview_mirror");
    }

    const isDpadDownRising = current.DPAD_DOWN && !prev.DPAD_DOWN;
    if (isDpadDownRising) {
      this.callbacks.onGazePreset?.("dashboard");
    }

    const isDpadLeftRising = current.DPAD_LEFT && !prev.DPAD_LEFT;
    if (isDpadLeftRising) {
      this.callbacks.onWiperToggle?.();
    }

    const isDpadRightRising = current.DPAD_RIGHT && !prev.DPAD_RIGHT;
    if (isDpadRightRising) {
      this.callbacks.onTimeToggle?.();
    }

    const isMinusRising = current.MINUS && !prev.MINUS;
    if (isMinusRising) {
      this.callbacks.onAreaToggle?.();
    }

    const isPlusRising = current.PLUS && !prev.PLUS;
    if (isPlusRising) {
      this.callbacks.onResetVehicle?.();
    }

    const isCaptureOrHomeRising =
      (current.CAPTURE && !prev.CAPTURE) || (current.HOME && !prev.HOME);
    if (isCaptureOrHomeRising) {
      this.callbacks.onGraphicsQualityToggle?.();
    }
  }
}

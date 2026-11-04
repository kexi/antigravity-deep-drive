import type { GazePreset, VehicleInput } from "../types";
import {
  GamepadController,
  type GamepadConnectionStatus,
  type GamepadControllerOptions,
  type GamepadPollSnapshot,
} from "./gamepadController";

export type VirtualControlKey = "throttle" | "brake" | "handbrake" | "steerLeft" | "steerRight";

export interface VirtualControlElements {
  throttleBtn?: HTMLElement | null;
  brakeBtn?: HTMLElement | null;
  handbrakeBtn?: HTMLElement | null;
  steerLeftBtn?: HTMLElement | null;
  steerRightBtn?: HTMLElement | null;
  steerPad?: HTMLElement | null;
  steerThumb?: HTMLElement | null;
  onSteerVisualChange?: (steer: number) => void;
}

/**
 * キーボード・ポインタ（マウスドラッグ / スマホタッチスワイプ視線変更）・マルチタッチ仮想コントローラー・
 * Nintendo Switch Pro Controller (ProCon 1 / W3C Gamepad API) 統合入力管理
 * - Why not 単一のタッチ状態変数で管理しないか:
 *   スマートフォン運転時は「左手親指で操舵」「右手親指でアクセル/ブレーキ」「別指で視線スワイプ」が同時に行われるため、
 *   操作系統ごとに `pointerId` の Set / ID を独立追跡しないと、片方の指を離した瞬間に他方の入力まで解除されてしまう。
 * - How:
 *   1. 各仮想ペダル・ボタンごとに `Set<number>` でアクティブな `pointerId` を分離管理し、マルチタッチ同時操作を保証する。
 *   2. アナログステアリングパッド（水平スライド操舵）は中心からの正規化変位 `[-1, 1]` とデッドゾーン処理で滑らかな比例舵角を算出する。
 *   3. 3Dキャンバス上のタッチ操作では `touch-action: none` 下でも確実に機能するカスタムダブルタップ判定（正面視線リセット）と、スマホ画面幅に最適化したスワイプ感度を適用する。
 *   4. GamepadController を統合し、Switch ProCon 1 (`057e:2009`) のアナログ操舵・右スティック自由視線パン・ボタンショートカットを並列処理する。
 */
export class InputManager {
  private keys: Record<string, boolean> = {};
  private isPointerLooking = false;
  private isFreeMouseLookPaused = false;
  private hasFreeMouseBaseline = false;
  private activePointerId: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private pointerDragDistancePx = 0;
  private lastTouchTapTimeMs = 0;
  private lastTouchTapX = 0;
  private lastTouchTapY = 0;

  // マルチタッチ仮想コントローラー状態（pointerId 単位で独立保持）
  private touchControlPointers: Record<VirtualControlKey, Set<number>> = {
    throttle: new Set<number>(),
    brake: new Set<number>(),
    handbrake: new Set<number>(),
    steerLeft: new Set<number>(),
    steerRight: new Set<number>(),
  };
  private analogSteerPointerId: number | null = null;
  private cachedSteerPadRect: DOMRect | null = null;
  private analogSteerValue = 0;
  private gamepadSteerValue = 0;
  private lastGamepadPollSnapshot: GamepadPollSnapshot | null = null;
  private readonly gamepadController: GamepadController;
  private boundLookElement: HTMLElement | null = null;
  private boundControlButtons: Array<{ el: HTMLElement; key: VirtualControlKey }> = [];
  private boundSteerPad: HTMLElement | null = null;
  private boundSteerThumb: HTMLElement | null = null;
  private onSteerVisualChange?: (steer: number) => void;

  public onCameraToggle?: () => void;
  public onAreaToggle?: () => void;
  public onTimeToggle?: () => void;
  public onRoadSurfaceToggle?: () => void;
  public onWiperToggle?: () => void;
  public onSoundToggle?: () => void;
  public onSoundVolumeStep?: (delta: number) => void;
  public onBlurToggle?: () => void;
  public onGraphicsQualityToggle?: () => void;
  public onLocaleToggle?: () => void;
  public onResetVehicle?: () => void;
  public onSignCreatorToggle?: () => void;
  public onAssetManagerToggle?: () => void;
  public onHudVisibilityToggle?: () => void;
  public onTurnSignalToggle?: (target: "left" | "right" | "hazard") => void;
  public onGazePreset?: (preset: GazePreset) => void;
  public onGazeDragDelta?: (deltaYawRad: number, deltaPitchRad: number) => void;
  public onTouchDetected?: () => void;
  public onUserInteraction?: () => void;
  public onGamepadStatusChange?: (status: GamepadConnectionStatus) => void;

  constructor(
    lookTargetElement?: HTMLElement | null,
    gamepadOptions: GamepadControllerOptions = {},
  ) {
    this.gamepadController = new GamepadController(
      {
        ...gamepadOptions,
        isInputBlocked: () => {
          const isExternalBlocked = gamepadOptions.isInputBlocked?.() ?? false;
          return isExternalBlocked || this.isModalDialogOpen();
        },
      },
      {
        onCameraToggle: () => {
          this.onUserInteraction?.();
          this.onCameraToggle?.();
        },
        onAreaToggle: () => {
          this.onUserInteraction?.();
          this.onAreaToggle?.();
        },
        onTimeToggle: () => {
          this.onUserInteraction?.();
          this.onTimeToggle?.();
        },
        onRoadSurfaceToggle: () => {
          this.onUserInteraction?.();
          this.onRoadSurfaceToggle?.();
        },
        onWiperToggle: () => {
          this.onUserInteraction?.();
          this.onWiperToggle?.();
        },
        onGraphicsQualityToggle: () => {
          this.onUserInteraction?.();
          this.onGraphicsQualityToggle?.();
        },
        onResetVehicle: () => {
          this.onUserInteraction?.();
          this.onResetVehicle?.();
        },
        onSignCreatorToggle: () => {
          this.onUserInteraction?.();
          this.onSignCreatorToggle?.();
        },
        onGazePreset: (preset) => {
          this.onUserInteraction?.();
          this.onGazePreset?.(preset);
        },
        onStatusChange: (status) => this.onGamepadStatusChange?.(status),
      },
    );

    const hasWindow = typeof window !== "undefined";
    if (hasWindow) {
      window.addEventListener("keydown", (e) => this.handleKeyDown(e));
      window.addEventListener("keyup", (e) => this.handleKeyUp(e));
      window.addEventListener("blur", () => this.clearAllInputs());
      window.addEventListener("resize", () => this.invalidateSteerPadRectCache());
      window.addEventListener("orientationchange", () => this.invalidateSteerPadRectCache());
      window.visualViewport?.addEventListener("resize", () => this.invalidateSteerPadRectCache());
    }
    const hasDocument = typeof document !== "undefined";
    if (hasDocument) {
      document.addEventListener("visibilitychange", () => {
        const isHidden = document.hidden;
        if (isHidden) {
          this.clearAllInputs();
        }
      });
    }
    const hasLookTarget = lookTargetElement !== null && lookTargetElement !== undefined;
    if (hasLookTarget) {
      this.attachLookTarget(lookTargetElement);
    }
  }

  /**
   * 3Dキャンバス上のポインタ（マウス移動・タッチスワイプ）による自由視線移動およびダブルクリック／ダブルタップ正面リセットを有効化する
   * - How:
   *   1. マウス（`e.pointerType !== "touch"`）ではボタンを押さなくても `#webgl-canvas` 上でマウスを動かすだけで視線（Yaw / Pitch）が変わるようにする。
   *   2. タッチ（`e.pointerType === "touch"`）では従来通りスワイプドラッグで視線移動し、ダブルタップで正面視線へリセットする。
   */
  public attachLookTarget(element: HTMLElement): void {
    this.boundLookElement = element;
    element.style.cursor = this.isFreeMouseLookPaused ? "default" : "crosshair";

    element.addEventListener("pointerenter", (e: PointerEvent) => {
      const isMousePointer = e.pointerType !== "touch";
      if (isMousePointer) {
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;
        this.hasFreeMouseBaseline = !this.isFreeMouseLookPaused;
      }
    });

    element.addEventListener("pointerleave", (e: PointerEvent) => {
      const isMousePointer = e.pointerType !== "touch";
      const shouldResetMouseBaseline = isMousePointer && !this.isPointerLooking;
      if (shouldResetMouseBaseline) {
        this.hasFreeMouseBaseline = false;
      }
    });

    element.addEventListener("pointerdown", (e: PointerEvent) => {
      const isTouch = e.pointerType === "touch";
      if (isTouch) {
        this.onTouchDetected?.();
      }
      this.onUserInteraction?.();

      const isPrimaryOrSecondaryButton = e.button === 0 || e.button === 2 || isTouch;
      const isDialogBlocking = this.isModalDialogOpen() || this.isTitleScreenOverlayOpen();
      const shouldIgnorePointerDown = !isPrimaryOrSecondaryButton || isDialogBlocking;
      if (shouldIgnorePointerDown) {
        return;
      }

      // 既に別の指でキャンバス視線ドラッグ中の場合は2本目の指で視線基準点が飛ばないように無視する
      const isAnotherPointerAlreadyLooking =
        this.isPointerLooking &&
        this.activePointerId !== null &&
        this.activePointerId !== e.pointerId;
      if (isAnotherPointerAlreadyLooking) {
        return;
      }

      this.isFreeMouseLookPaused = false;
      this.isPointerLooking = true;
      this.hasFreeMouseBaseline = true;
      this.activePointerId = e.pointerId;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      this.pointerDragDistancePx = 0;
      element.style.cursor = isTouch ? "grabbing" : "crosshair";
      const canCapturePointer = typeof element.setPointerCapture === "function";
      if (canCapturePointer) {
        try {
          element.setPointerCapture(e.pointerId);
        } catch {
          // テスト環境や合成イベント等で pointerId が未登録の場合は無視して継続
        }
      }
    });

    element.addEventListener("pointermove", (e: PointerEvent) => {
      const isTouchPointer = e.pointerType === "touch";
      const isDialogOrTitleBlocking = this.isModalDialogOpen() || this.isTitleScreenOverlayOpen();
      if (isDialogOrTitleBlocking) {
        this.hasFreeMouseBaseline = false;
        return;
      }

      if (isTouchPointer) {
        const isNotTrackingThisTouch = !(
          this.isPointerLooking &&
          (this.activePointerId === null || e.pointerId === this.activePointerId)
        );
        if (isNotTrackingThisTouch) {
          return;
        }
      } else {
        // Escape キーでフリーマウス視線追従が一時停止されている場合は、ボタン押下なしのカーソル移動で視線を変えない
        const isFreeMouseBlockedByEscape = this.isFreeMouseLookPaused && !this.isPointerLooking;
        if (isFreeMouseBlockedByEscape) {
          this.hasFreeMouseBaseline = false;
          return;
        }

        // マウス操作: ボタン押下なし（フリームーブ）でも視線を動かせるようにする
        const hasNativeMovement =
          typeof e.movementX === "number" &&
          typeof e.movementY === "number" &&
          (e.movementX !== 0 || e.movementY !== 0);
        const needsBaselineInit =
          !this.isPointerLooking && !this.hasFreeMouseBaseline && !hasNativeMovement;
        if (needsBaselineInit) {
          // Why not 初回 pointermove からいきなり clientX - 0 を計算しないか:
          // HUDボタン等からキャンバスへマウスが入った最初の1フレーム目で基準座標が (0, 0) だと視線が大きく飛ぶため
          this.lastPointerX = e.clientX;
          this.lastPointerY = e.clientY;
          this.hasFreeMouseBaseline = true;
          return;
        }
      }

      const rawDx = e.clientX - this.lastPointerX;
      const rawDy = e.clientY - this.lastPointerY;
      const hasClientDelta = rawDx !== 0 || rawDy !== 0;
      const fallbackMoveX = typeof e.movementX === "number" ? e.movementX : 0;
      const fallbackMoveY = typeof e.movementY === "number" ? e.movementY : 0;
      const dx = hasClientDelta ? rawDx : fallbackMoveX;
      const dy = hasClientDelta ? rawDy : fallbackMoveY;

      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      this.hasFreeMouseBaseline = true;

      const isZeroMovement = dx === 0 && dy === 0;
      if (isZeroMovement) {
        return;
      }

      if (this.isPointerLooking) {
        this.pointerDragDistancePx += Math.hypot(dx, dy);
      }

      // 画面右移動(dx > 0)で右方向(-yaw)、下移動(dy > 0)で下方向(-pitch)へ視線を向ける
      // スマホタッチ時は狭い画面幅でも片手スワイプでサイドミラーまで見渡せるよう感度を最適化する
      const sensitivityRadPerPx = isTouchPointer ? 0.0048 : 0.0032;
      const deltaYawRad = -dx * sensitivityRadPerPx;
      const deltaPitchRad = -dy * sensitivityRadPerPx;
      this.onGazeDragDelta?.(deltaYawRad, deltaPitchRad);
    });

    const stopPointerLook = (e: PointerEvent) => {
      const isNotMatchingPointer = !(
        this.activePointerId === null || e.pointerId === this.activePointerId
      );
      if (isNotMatchingPointer) {
        return;
      }

      const wasLooking = this.isPointerLooking;
      const totalDragPx = this.pointerDragDistancePx;
      this.isPointerLooking = false;
      this.activePointerId = null;
      this.pointerDragDistancePx = 0;
      element.style.cursor = this.isFreeMouseLookPaused ? "default" : "crosshair";

      // Why カスタムタッチダブルタップ判定を行うか:
      // モバイル Chrome で `touch-action: none` を設定した WebGL キャンバス上ではネイティブ `dblclick` が発火しない場合があるため、
      // ドラッグ量が少ない（< 14px）2連続タップ（320ms 以内・距離 36px 以内）を検出して確実に正面視線へリセットする。
      const isTapRelease =
        wasLooking &&
        e.type === "pointerup" &&
        e.pointerType === "touch" &&
        totalDragPx < 14 &&
        !this.isModalDialogOpen();
      if (isTapRelease) {
        const eventTimeMs =
          typeof e.timeStamp === "number" && Number.isFinite(e.timeStamp) && e.timeStamp > 0
            ? e.timeStamp
            : Date.now();
        const hasPreviousTap = this.lastTouchTapTimeMs > 0;
        const elapsedMs = eventTimeMs - this.lastTouchTapTimeMs;
        const tapDistPx = Math.hypot(
          e.clientX - this.lastTouchTapX,
          e.clientY - this.lastTouchTapY,
        );
        const isDoubleTap = hasPreviousTap && elapsedMs >= 0 && elapsedMs <= 320 && tapDistPx <= 36;
        if (isDoubleTap) {
          this.lastTouchTapTimeMs = 0;
          this.onGazePreset?.("forward");
          return;
        }
        this.lastTouchTapTimeMs = eventTimeMs;
        this.lastTouchTapX = e.clientX;
        this.lastTouchTapY = e.clientY;
      }
    };

    element.addEventListener("pointerup", stopPointerLook);
    element.addEventListener("pointercancel", stopPointerLook);
    element.addEventListener("lostpointercapture", stopPointerLook);

    element.addEventListener("dblclick", () => {
      const isModalOpen = this.isModalDialogOpen();
      if (isModalOpen) {
        return;
      }
      this.onGazePreset?.("forward");
    });
  }

  /**
   * スマートフォン向けバーチャルタッチコントローラー（アクセル・ブレーキ・サイドブレーキ・左右ステアボタン・アナログ操舵パッド）をバインドする
   */
  public attachVirtualControls(elements: VirtualControlElements): void {
    this.boundSteerPad = elements.steerPad ?? null;
    this.boundSteerThumb = elements.steerThumb ?? null;
    this.onSteerVisualChange = elements.onSteerVisualChange;

    const bindHoldButton = (btn: HTMLElement | null | undefined, key: VirtualControlKey) => {
      const isMissingButton = !btn;
      if (isMissingButton) {
        return;
      }
      this.boundControlButtons.push({ el: btn, key });

      const handleDown = (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        this.onTouchDetected?.();
        this.onUserInteraction?.();
        this.setVirtualControlState(key, true, e.pointerId);
        const canCapture = typeof btn.setPointerCapture === "function";
        if (canCapture) {
          try {
            btn.setPointerCapture(e.pointerId);
          } catch {
            // 合成イベント等で pointerId 未登録時は無視
          }
        }
      };

      const handleUp = (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        this.setVirtualControlState(key, false, e.pointerId);
      };

      btn.addEventListener("pointerdown", handleDown);
      btn.addEventListener("pointerup", handleUp);
      btn.addEventListener("pointercancel", handleUp);
      btn.addEventListener("lostpointercapture", handleUp);
      btn.addEventListener("contextmenu", (e) => e.preventDefault());
    };

    bindHoldButton(elements.throttleBtn, "throttle");
    bindHoldButton(elements.brakeBtn, "brake");
    bindHoldButton(elements.handbrakeBtn, "handbrake");
    bindHoldButton(elements.steerLeftBtn, "steerLeft");
    bindHoldButton(elements.steerRightBtn, "steerRight");

    const steerPad = elements.steerPad;
    const isMissingSteerPad = !steerPad;
    if (isMissingSteerPad) {
      return;
    }

    const updateSteerFromPointer = (clientX: number) => {
      const rect = this.cachedSteerPadRect ?? steerPad.getBoundingClientRect();
      this.cachedSteerPadRect = rect;
      const isTooNarrow = !(rect.width > 8);
      if (isTooNarrow) {
        return;
      }
      const centerX = rect.left + rect.width * 0.5;
      const maxRadius = rect.width * 0.44;
      const rawNormalized = (clientX - centerX) / Math.max(maxRadius, 1);
      const clamped = Math.max(-1, Math.min(1, rawNormalized));
      // 中心付近の微小揺れ（6%未満）はデッドゾーンとして直進安定性を確保
      const deadzone = 0.06;
      const absVal = Math.abs(clamped);
      const isInsideDeadzone = absVal < deadzone;
      const effectiveSteer = isInsideDeadzone
        ? 0
        : Math.sign(clamped) * ((absVal - deadzone) / (1 - deadzone));
      this.setAnalogSteer(effectiveSteer);
    };

    steerPad.addEventListener("pointerdown", (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.onTouchDetected?.();
      this.onUserInteraction?.();
      const isAnotherFingerAlreadySteering =
        this.analogSteerPointerId !== null && this.analogSteerPointerId !== e.pointerId;
      if (isAnotherFingerAlreadySteering) {
        return;
      }
      this.analogSteerPointerId = e.pointerId;
      this.cachedSteerPadRect = steerPad.getBoundingClientRect();
      steerPad.classList.add("active");
      updateSteerFromPointer(e.clientX);
      const canCapture = typeof steerPad.setPointerCapture === "function";
      if (canCapture) {
        try {
          steerPad.setPointerCapture(e.pointerId);
        } catch {
          // 合成イベント時は無視
        }
      }
    });

    steerPad.addEventListener("pointermove", (e: PointerEvent) => {
      const isNotActiveSteerPointer = !(
        this.analogSteerPointerId !== null && e.pointerId === this.analogSteerPointerId
      );
      if (isNotActiveSteerPointer) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      updateSteerFromPointer(e.clientX);
    });

    const stopAnalogSteer = (e: PointerEvent) => {
      const isNotMatchingSteerPointer = !(
        this.analogSteerPointerId === null || e.pointerId === this.analogSteerPointerId
      );
      if (isNotMatchingSteerPointer) {
        return;
      }
      this.analogSteerPointerId = null;
      this.cachedSteerPadRect = null;
      steerPad.classList.remove("active");
      this.setAnalogSteer(0);
    };

    steerPad.addEventListener("pointerup", stopAnalogSteer);
    steerPad.addEventListener("pointercancel", stopAnalogSteer);
    steerPad.addEventListener("lostpointercapture", stopAnalogSteer);
    steerPad.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  /**
   * 仮想ボタンの押下状態を pointerId 単位で更新する
   */
  public setVirtualControlState(
    control: VirtualControlKey,
    isActive: boolean,
    pointerId = -1,
  ): void {
    const pointerSet = this.touchControlPointers[control];
    if (isActive) {
      pointerSet.add(pointerId);
    } else {
      pointerSet.delete(pointerId);
    }
    this.syncBoundControlVisuals();
  }

  /**
   * アナログステアリング値（-1.0: 左最大 〜 +1.0: 右最大）を設定し、UIインジケーターを同期する
   */
  public setAnalogSteer(steer: number): void {
    const safeSteer = Number.isFinite(steer) ? Math.max(-1, Math.min(1, steer)) : 0;
    this.analogSteerValue = safeSteer;
    this.syncSteerThumbVisual();
  }

  /**
   * 画面回転やビューポートリサイズ時にアナログステアリングパッドのキャッシュ済み DOMRect を無効化する
   */
  public invalidateSteerPadRectCache(): void {
    this.cachedSteerPadRect = null;
  }

  public getGamepadController(): GamepadController {
    return this.gamepadController;
  }

  public getGamepadStatus(): GamepadConnectionStatus {
    return this.gamepadController.getStatus();
  }

  /**
   * Escape キー押下によりボタン押下なしのフリーマウス視線追従が一時停止されているかどうかを返す
   */
  public isMouseLookPaused(): boolean {
    return this.isFreeMouseLookPaused;
  }

  private pollGamepad(): GamepadPollSnapshot {
    const snapshot = this.gamepadController.poll();
    this.lastGamepadPollSnapshot = snapshot;
    const prevGamepadSteer = this.gamepadSteerValue;
    this.gamepadSteerValue = snapshot.steer;
    const isResetToCenter = prevGamepadSteer !== 0 && snapshot.steer === 0;
    const hasSteerChanged = isResetToCenter || Math.abs(prevGamepadSteer - snapshot.steer) > 1e-4;
    if (hasSteerChanged) {
      this.syncSteerThumbVisual();
    }
    const hasActiveGamepadDrivingInput =
      snapshot.throttle > 0.01 ||
      snapshot.brake > 0.01 ||
      snapshot.handbrake ||
      Math.abs(snapshot.steer) > 0.01;
    if (hasActiveGamepadDrivingInput) {
      this.onUserInteraction?.();
    }
    return snapshot;
  }

  /**
   * フォーカス喪失やバックグラウンド移行時にすべてのキー・タッチ入力を安全に解除する
   */
  public clearAllInputs(): void {
    this.keys = {};
    this.isPointerLooking = false;
    this.hasFreeMouseBaseline = false;
    this.activePointerId = null;
    this.pointerDragDistancePx = 0;
    this.analogSteerPointerId = null;
    this.invalidateSteerPadRectCache();
    this.analogSteerValue = 0;
    this.gamepadSteerValue = 0;
    this.lastGamepadPollSnapshot = null;
    this.gamepadController.resetEdgeState();
    const lookEl = this.boundLookElement;
    const hasLookEl = lookEl !== null;
    if (hasLookEl) {
      lookEl.style.cursor = this.isFreeMouseLookPaused ? "default" : "crosshair";
    }
    const steerPadEl = this.boundSteerPad;
    const hasSteerPadEl = steerPadEl !== null;
    if (hasSteerPadEl) {
      steerPadEl.classList.remove("active");
    }
    for (const set of Object.values(this.touchControlPointers)) {
      set.clear();
    }
    this.syncBoundControlVisuals();
    this.syncSteerThumbVisual();
  }

  private syncBoundControlVisuals(): void {
    for (const item of this.boundControlButtons) {
      const isPressed = this.touchControlPointers[item.key].size > 0;
      item.el.classList.toggle("active", isPressed);
      item.el.setAttribute("aria-pressed", isPressed ? "true" : "false");
    }
    this.syncSteerThumbVisual();
  }

  private syncSteerThumbVisual(): void {
    const currentSteer = this.computeCurrentSteer();
    this.onSteerVisualChange?.(currentSteer);
    const thumbEl = this.boundSteerThumb;
    const isMissingThumb = thumbEl === null;
    if (isMissingThumb) {
      return;
    }
    const offsetPercent = currentSteer * 115;
    thumbEl.style.transform = `translate3d(${offsetPercent.toFixed(1)}%, 0, 0)`;
  }

  private isTypingInFormField(target: EventTarget | null): boolean {
    const isNotElement = typeof HTMLElement === "undefined" || !(target instanceof HTMLElement);
    if (isNotElement) {
      return false;
    }
    const tag = target.tagName;
    const isFormTag = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
    if (isFormTag) {
      const inputType = (target as HTMLInputElement).type?.toLowerCase() ?? "";
      const isRangeSlider = tag === "INPUT" && inputType === "range";
      if (isRangeSlider) {
        return false;
      }
      return true;
    }
    return target.isContentEditable;
  }

  private isModalDialogOpen(): boolean {
    const isMissingDoc = typeof document === "undefined";
    if (isMissingDoc) {
      return false;
    }
    return document.querySelector("dialog[open]") !== null;
  }

  private isTitleScreenOverlayOpen(): boolean {
    const isMissingDoc = typeof document === "undefined";
    if (isMissingDoc) {
      return false;
    }
    return document.querySelector("#title-screen-overlay:not(.is-hidden)") !== null;
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const isTyping = this.isTypingInFormField(e.target);
    if (isTyping) {
      // Why not: 標識作成モーダル等のフォーム入力中に WASD やショートカットが発火して車が暴走するのを防ぐ
      return;
    }

    this.onUserInteraction?.();

    const key = e.key.toLowerCase();
    const isSignCreatorKey = key === "m";
    if (isSignCreatorKey) {
      this.onSignCreatorToggle?.();
      return;
    }

    const isAssetManagerKey = key === "y";
    if (isAssetManagerKey) {
      this.onAssetManagerToggle?.();
      return;
    }

    const isModalOpen = this.isModalDialogOpen();
    if (isModalOpen) {
      return;
    }

    const isEscapeKey = e.key === "Escape" || e.code === "Escape";
    if (isEscapeKey) {
      // Why Escape キーでフリーマウス視線追従を一時停止するか:
      // 3Dキャンバス上でマウスを動かすだけで視線が変わる仕様では、HUDボタン操作やウィンドウ外へカーソルを移動したい時に
      // 意図せず視線が回ってしまうため、Escape 押下でマウス移動による視線変更を停止し、キャンバスクリックで再開できるようにする。
      this.isFreeMouseLookPaused = true;
      this.isPointerLooking = false;
      this.activePointerId = null;
      this.hasFreeMouseBaseline = false;
      this.pointerDragDistancePx = 0;
      const lookEl = this.boundLookElement;
      const hasLookEl = lookEl !== null;
      if (hasLookEl) {
        lookEl.style.cursor = "default";
      }
      return;
    }

    const isTitleScreenOpen = this.isTitleScreenOverlayOpen();
    const isHudToggleKey = e.key === "Tab" && !e.altKey && !e.ctrlKey && !e.metaKey;
    if (isHudToggleKey && !isTitleScreenOpen) {
      // Why Tab キーに UI OFF（HUD全非表示）切替を割り当て preventDefault するか:
      // アルファベット A〜Z 全26キーは操舵・視線・環境操作に割り当て済みであり、
      // ドライビング中に Tab キーで HUD パネル間のフォーカス移動が起きると Space 等で意図せぬボタン押下が起きるため、
      // Tab を HUD 表示/非表示のワンキー切替に割り当てて没入ドライブモードへ即座に遷移できるようにする。
      e.preventDefault();
      if (!e.repeat) {
        this.onHudVisibilityToggle?.();
      }
      return;
    }

    const wasAlreadyPressed = Boolean(this.keys[key]);
    this.keys[key] = true;
    if (wasAlreadyPressed || e.repeat) {
      return;
    }

    const isAreaKey = key === "p";
    if (isAreaKey) {
      this.onAreaToggle?.();
      return;
    }

    const isCameraKey = key === "c";
    if (isCameraKey) {
      this.onCameraToggle?.();
      return;
    }

    const isTimeKey = key === "t";
    if (isTimeKey) {
      this.onTimeToggle?.();
      return;
    }

    const isRoadSurfaceKey = key === "g";
    if (isRoadSurfaceKey) {
      this.onRoadSurfaceToggle?.();
      return;
    }

    const isWiperKey = key === "x";
    if (isWiperKey) {
      this.onWiperToggle?.();
      return;
    }

    const isSoundKey = key === "h";
    if (isSoundKey) {
      this.onSoundToggle?.();
      return;
    }

    const isVolumeDownKey = key === "[";
    if (isVolumeDownKey) {
      this.onSoundVolumeStep?.(-0.1);
      return;
    }

    const isVolumeUpKey = key === "]";
    if (isVolumeUpKey) {
      this.onSoundVolumeStep?.(0.1);
      return;
    }

    const isBlurKey = key === "b";
    if (isBlurKey) {
      this.onBlurToggle?.();
      return;
    }

    const isGraphicsQualityKey = key === "f";
    if (isGraphicsQualityKey) {
      this.onGraphicsQualityToggle?.();
      return;
    }

    const isLocaleKey = key === "n";
    if (isLocaleKey) {
      this.onLocaleToggle?.();
      return;
    }

    const isResetKey = key === "r";
    if (isResetKey) {
      this.onResetVehicle?.();
      return;
    }

    // --- ウインカー（方向指示器: Q=左 / E=右 / Z=ハザード）＆ 視線変更ショートカット ---
    // Why Q / E 単押しを左右ウインカー、Shift+Q / Shift+E を左右ドアミラー確認に割り当てるか:
    // WASD 操舵中に薬指(Q)・人差し指(E)で即座に左折・右折ウインカーを出せる直感的な操作性を最優先しつつ、
    // Shift 同時押しで左右ドアミラー確認プリセットへもキーボードから素早くアクセスできるようにするため。
    const isGazeForwardKey = key === "v" || key === "0";
    if (isGazeForwardKey) {
      this.onGazePreset?.("forward");
      return;
    }

    const isLeftTurnOrMirrorKey = key === "q";
    if (isLeftTurnOrMirrorKey) {
      const isLeftMirrorGaze = e.shiftKey;
      if (isLeftMirrorGaze) {
        this.onGazePreset?.("left_mirror");
        return;
      }
      this.onTurnSignalToggle?.("left");
      return;
    }

    const isRightTurnOrMirrorKey = key === "e";
    if (isRightTurnOrMirrorKey) {
      const isRightMirrorGaze = e.shiftKey;
      if (isRightMirrorGaze) {
        this.onGazePreset?.("right_mirror");
        return;
      }
      this.onTurnSignalToggle?.("right");
      return;
    }

    const isHazardKey = key === "z";
    if (isHazardKey) {
      this.onTurnSignalToggle?.("hazard");
      return;
    }

    const isRearviewMirrorKey = key === "i";
    if (isRearviewMirrorKey) {
      this.onGazePreset?.("rearview_mirror");
      return;
    }

    const isDashboardGazeKey = key === "k";
    if (isDashboardGazeKey) {
      this.onGazePreset?.("dashboard");
      return;
    }

    const isLeftShoulderKey = key === "u";
    if (isLeftShoulderKey) {
      this.onGazePreset?.("left_shoulder");
      return;
    }

    const isRightShoulderKey = key === "o";
    if (isRightShoulderKey) {
      this.onGazePreset?.("right_shoulder");
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    const key = e.key.toLowerCase();
    this.keys[key] = false;
  }

  /**
   * キー長押し（J / L で左右首振り）および Switch ProCon / ゲームパッドの Lスティック・Rスティックによる連続視線パン量を返す
   */
  public getGazePanDelta(dt: number): { deltaYawRad: number; deltaPitchRad: number } {
    const panRateRadPerSec = 1.45;
    const pitchPanRateRadPerSec = 1.1;
    let deltaYawRad = 0;
    let deltaPitchRad = 0;
    const isPanningLeft = Boolean(this.keys["j"]);
    const isPanningRight = Boolean(this.keys["l"]);
    if (isPanningLeft) {
      deltaYawRad += panRateRadPerSec * dt;
    }
    if (isPanningRight) {
      deltaYawRad -= panRateRadPerSec * dt;
    }

    // Why lastGamepadPollSnapshot を優先再利用するか:
    // メインループでは同一フレーム内で getInput() の直後に getGazePanDelta() が呼ばれるため、
    // 毎フレーム navigator.getGamepads() を2回ポーリングするオーバーヘッドを避けつつ、単体テスト等で直接呼ばれた場合は pollGamepad() にフォールバックする。
    const gamepadSnapshot = this.lastGamepadPollSnapshot ?? this.pollGamepad();
    this.lastGamepadPollSnapshot = null;

    // Lスティック（leftStickX / leftStickY）と Rスティック（rightStickX / rightStickY）の両方で視線変更できるように合算クランプする
    const combinedStickX = Math.max(
      -1,
      Math.min(1, gamepadSnapshot.leftStickX + gamepadSnapshot.rightStickX),
    );
    const combinedStickY = Math.max(
      -1,
      Math.min(1, gamepadSnapshot.leftStickY + gamepadSnapshot.rightStickY),
    );

    const hasStickX = Math.abs(combinedStickX) > 1e-4;
    if (hasStickX) {
      // Why not: CameraController の yaw 規約では左向きが正（+yaw）・右向きが負（-yaw）のため、スティック X（右が正）の符号を反転させる
      deltaYawRad += -combinedStickX * panRateRadPerSec * dt;
    }
    const hasStickY = Math.abs(combinedStickY) > 1e-4;
    if (hasStickY) {
      // Why not: Gamepad API の軸規約では上倒しが負（-1）・下倒しが正（+1）のため、上向き（+pitch）に合わせて符号を反転させる
      deltaPitchRad += -combinedStickY * pitchPanRateRadPerSec * dt;
    }

    return { deltaYawRad, deltaPitchRad };
  }

  private computeCurrentSteer(): number {
    const hasAnalogSteer = Math.abs(this.analogSteerValue) > 1e-4;
    if (hasAnalogSteer) {
      return this.analogSteerValue;
    }

    let discreteSteer = 0;
    const isSteerLeft =
      Boolean(this.keys["a"]) ||
      Boolean(this.keys["arrowleft"]) ||
      this.touchControlPointers.steerLeft.size > 0;
    if (isSteerLeft) {
      discreteSteer -= 1.0;
    }

    const isSteerRight =
      Boolean(this.keys["d"]) ||
      Boolean(this.keys["arrowright"]) ||
      this.touchControlPointers.steerRight.size > 0;
    if (isSteerRight) {
      discreteSteer += 1.0;
    }

    const hasDiscreteSteer = Math.abs(discreteSteer) > 1e-4;
    if (hasDiscreteSteer) {
      return Math.max(-1, Math.min(1, discreteSteer));
    }

    const hasGamepadSteer = Math.abs(this.gamepadSteerValue) > 1e-4;
    if (hasGamepadSteer) {
      return this.gamepadSteerValue;
    }

    return 0;
  }

  public getInput(): VehicleInput {
    const gamepadSnapshot = this.pollGamepad();
    const isModalOpen = this.isModalDialogOpen();
    if (isModalOpen) {
      return { throttle: 0, brake: 0, steer: 0, handbrake: false };
    }

    let throttle = 0;
    let brake = 0;

    const isThrottlePressed =
      Boolean(this.keys["w"]) ||
      Boolean(this.keys["arrowup"]) ||
      this.touchControlPointers.throttle.size > 0;
    if (isThrottlePressed) {
      throttle = 1.0;
    }

    const isBrakePressed =
      Boolean(this.keys["s"]) ||
      Boolean(this.keys["arrowdown"]) ||
      this.touchControlPointers.brake.size > 0;
    if (isBrakePressed) {
      brake = 1.0;
    }

    throttle = Math.max(throttle, gamepadSnapshot.throttle);
    brake = Math.max(brake, gamepadSnapshot.brake);

    const steer = this.computeCurrentSteer();
    const isKeyboardOrTouchHandbrake =
      Boolean(this.keys[" "]) || this.touchControlPointers.handbrake.size > 0;
    const handbrake = isKeyboardOrTouchHandbrake || gamepadSnapshot.handbrake;

    return { throttle, brake, steer, handbrake };
  }
}

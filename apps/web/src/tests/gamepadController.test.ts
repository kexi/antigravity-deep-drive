import { describe, expect, it, vi } from "vitest";
import {
  applyStickDeadzoneAndCurve,
  decodeRawHidHatSwitch,
  DEFAULT_STICK_CURVE_EXPONENT,
  DEFAULT_STICK_DEADZONE,
  GamepadController,
  isSwitchProController,
  SWITCH_PRO_BUTTON_INDEX,
  type GamepadLike,
} from "../core/gamepadController";
import { localizeGamepadStatusText } from "../core/i18n";
import { InputManager } from "../core/inputManager";
import { logger } from "../core/logger";
import { MobileHudController, parseHudVisibilityQuery } from "../core/mobileHudController";

interface MutableGamepadMock extends GamepadLike {
  id: string;
  index: number;
  connected: boolean;
  mapping: string;
  axes: number[];
  buttons: Array<{ pressed: boolean; value: number }>;
}

function createSwitchProGamepadMock(
  overrides: Partial<MutableGamepadMock> = {},
): MutableGamepadMock {
  const buttons = Array.from({ length: 18 }, () => ({ pressed: false, value: 0 }));
  const axes = [0, 0, 0, 0];
  return {
    id: "Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)",
    index: 0,
    connected: true,
    mapping: "standard",
    axes,
    buttons,
    ...overrides,
  };
}

function pressButton(pad: MutableGamepadMock, index: number, value = 1.0): void {
  pad.buttons[index] = { pressed: value >= 0.5, value };
}

function releaseButton(pad: MutableGamepadMock, index: number): void {
  pad.buttons[index] = { pressed: false, value: 0 };
}

describe("Switch Pro Controller (ProCon 1) Gamepad Support", () => {
  describe("isSwitchProController — デバイス識別", () => {
    it("Nintendo Switch Pro Controller 第1世代の USB / Bluetooth ID 文字列を正しく識別することを保証する", () => {
      expect(
        isSwitchProController("Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)"),
      ).toBe(true);
      expect(isSwitchProController("057e-2009-Pro Controller")).toBe(true);
      expect(isSwitchProController("Nintendo Switch Pro Controller Extended Gamepad")).toBe(true);
      expect(isSwitchProController("Wireless Gamepad (Vendor: 057E Product: 2009)")).toBe(true);
    });

    it("Switch ProCon 以外のゲームパッドや空文字列を誤認識しないことを保証する", () => {
      expect(
        isSwitchProController(
          "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b12)",
        ),
      ).toBe(false);
      expect(
        isSwitchProController(
          "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)",
        ),
      ).toBe(false);
      expect(isSwitchProController("Joy-Con (L) (Vendor: 057e Product: 2006)")).toBe(false);
      expect(isSwitchProController("")).toBe(false);
      expect(isSwitchProController(null)).toBe(false);
      expect(isSwitchProController(undefined)).toBe(false);
    });
  });

  describe("applyStickDeadzoneAndCurve — スティックデッドゾーンと非線形カーブ", () => {
    it("デッドゾーン以内の微小入力を完全に 0 に除去してドリフトを防止することを保証する", () => {
      expect(applyStickDeadzoneAndCurve(0)).toBe(0);
      expect(applyStickDeadzoneAndCurve(0.05)).toBe(0);
      expect(applyStickDeadzoneAndCurve(-0.089)).toBe(0);
      expect(applyStickDeadzoneAndCurve(DEFAULT_STICK_DEADZONE)).toBe(0);
      expect(applyStickDeadzoneAndCurve(-DEFAULT_STICK_DEADZONE)).toBe(0);
    });

    it("デッドゾーン超過から最大倒し込みまで 0.0〜±1.0 に滑らかに非線形正規化されることを保証する", () => {
      const slightRight = applyStickDeadzoneAndCurve(
        0.15,
        DEFAULT_STICK_DEADZONE,
        DEFAULT_STICK_CURVE_EXPONENT,
      );
      expect(slightRight).toBeGreaterThan(0);
      expect(slightRight).toBeLessThan(0.1);

      const midRight = applyStickDeadzoneAndCurve(0.5, 0.09, 1.35);
      const midLeft = applyStickDeadzoneAndCurve(-0.5, 0.09, 1.35);
      expect(midRight).toBeGreaterThan(0.3);
      expect(midRight).toBeLessThan(0.5);
      expect(midLeft).toBeCloseTo(-midRight, 6);

      expect(applyStickDeadzoneAndCurve(1.0)).toBeCloseTo(1.0, 6);
      expect(applyStickDeadzoneAndCurve(-1.0)).toBeCloseTo(-1.0, 6);
      expect(applyStickDeadzoneAndCurve(1.4)).toBeCloseTo(1.0, 6);
      expect(applyStickDeadzoneAndCurve(-1.4)).toBeCloseTo(-1.0, 6);
      expect(applyStickDeadzoneAndCurve(Number.NaN)).toBe(0);
    });
  });

  describe("decodeRawHidHatSwitch — Raw HID ハットスイッチ復号", () => {
    it("ニュートラル値（1.2857 や 0 埋め初期値）で全方向 false を返すことを保証する", () => {
      expect(decodeRawHidHatSwitch(1.2857)).toEqual({
        up: false,
        right: false,
        down: false,
        left: false,
      });
      expect(decodeRawHidHatSwitch(0)).toEqual({
        up: false,
        right: false,
        down: false,
        left: false,
      });
      expect(decodeRawHidHatSwitch(Number.NaN)).toEqual({
        up: false,
        right: false,
        down: false,
        left: false,
      });
    });

    it("8方向のハットスイッチ量子化値を上下左右のデジタルフラグへ正確に復号することを保証する", () => {
      expect(decodeRawHidHatSwitch(-1.0)).toEqual({
        up: true,
        right: false,
        down: false,
        left: false,
      });
      expect(decodeRawHidHatSwitch(-3 / 7)).toEqual({
        up: false,
        right: true,
        down: false,
        left: false,
      });
      expect(decodeRawHidHatSwitch(1 / 7)).toEqual({
        up: false,
        right: false,
        down: true,
        left: false,
      });
      expect(decodeRawHidHatSwitch(5 / 7)).toEqual({
        up: false,
        right: false,
        down: false,
        left: true,
      });
      expect(decodeRawHidHatSwitch(-5 / 7)).toEqual({
        up: true,
        right: true,
        down: false,
        left: false,
      });
    });
  });

  describe("GamepadController — 接続監視・アナログ走行入力・ショートカット割当", () => {
    it("Switch ProCon 1 の接続・切断を検出し、構造化ログとステータス通知を発火することを保証する", () => {
      let currentPads: Array<GamepadLike | null> = [];
      const statusChanges: Array<{ connected: boolean; isSwitchProCon1: boolean }> = [];
      const controller = new GamepadController({
        getGamepads: () => currentPads,
        onStatusChange: (status) => {
          statusChanges.push({
            connected: status.connected,
            isSwitchProCon1: status.isSwitchProCon1,
          });
        },
      });

      logger.clear();
      expect(controller.getStatus().connected).toBe(false);

      const proCon = createSwitchProGamepadMock();
      currentPads = [proCon];
      const snapshot = controller.poll();

      expect(snapshot.status.connected).toBe(true);
      expect(snapshot.status.isSwitchProCon1).toBe(true);
      expect(snapshot.status.deviceLabel).toBe("Nintendo Switch Pro Controller (ProCon 1)");
      expect(statusChanges).toHaveLength(1);
      expect(statusChanges[0]).toEqual({ connected: true, isSwitchProCon1: true });

      const logsAfterConnect = logger.getLogs();
      expect(logsAfterConnect.some((entry) => entry.event === "gamepad.connected")).toBe(true);

      currentPads = [null];
      const disconnectedSnapshot = controller.poll();
      expect(disconnectedSnapshot.status.connected).toBe(false);
      expect(statusChanges).toHaveLength(2);
      expect(statusChanges[1]).toEqual({ connected: false, isSwitchProCon1: false });
      expect(logger.getLogs().some((entry) => entry.event === "gamepad.disconnected")).toBe(true);
    });

    it("複数のゲームパッドが接続されている場合、Switch ProCon 1 を最優先で選択することを保証する", () => {
      const genericPad = createSwitchProGamepadMock({
        id: "Generic USB Joystick (Vendor: 045e Product: 028e)",
        index: 0,
      });
      const proCon = createSwitchProGamepadMock({
        id: "Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)",
        index: 1,
      });

      const controller = new GamepadController({
        getGamepads: () => [genericPad, proCon],
      });

      const snapshot = controller.poll();
      expect(snapshot.status.connected).toBe(true);
      expect(snapshot.status.isSwitchProCon1).toBe(true);
      expect(snapshot.status.gamepadIndex).toBe(1);
    });

    it("ZR / A でアクセル、ZL / B でブレーキ、Y でサイドブレーキ、左スティックで操舵、右スティックで自由視線が機能することを保証する", () => {
      const proCon = createSwitchProGamepadMock();
      const controller = new GamepadController({
        getGamepads: () => [proCon],
      });

      // ZR アクセル & 左スティック右操舵 & 右スティック左・上傾き
      pressButton(proCon, SWITCH_PRO_BUTTON_INDEX.ZR, 1.0);
      proCon.axes[0] = 0.8;
      proCon.axes[2] = -0.6;
      proCon.axes[3] = -0.5;

      const snap1 = controller.poll();
      expect(snap1.throttle).toBe(1.0);
      expect(snap1.brake).toBe(0);
      expect(snap1.steer).toBeGreaterThan(0.6);
      expect(snap1.rightStickX).toBeLessThan(-0.4);
      expect(snap1.rightStickY).toBeLessThan(-0.3);

      // ZR 解除 + A ボタンでアクセル、ZL でブレーキ、Y でサイドブレーキ
      releaseButton(proCon, SWITCH_PRO_BUTTON_INDEX.ZR);
      pressButton(proCon, SWITCH_PRO_BUTTON_INDEX.A, 1.0);
      pressButton(proCon, SWITCH_PRO_BUTTON_INDEX.ZL, 1.0);
      pressButton(proCon, SWITCH_PRO_BUTTON_INDEX.Y, 1.0);

      const snap2 = controller.poll();
      expect(snap2.throttle).toBe(1.0);
      expect(snap2.brake).toBe(1.0);
      expect(snap2.handbrake).toBe(true);

      // B ボタン単体でもブレーキ・後退が効くこと
      releaseButton(proCon, SWITCH_PRO_BUTTON_INDEX.A);
      releaseButton(proCon, SWITCH_PRO_BUTTON_INDEX.ZL);
      pressButton(proCon, SWITCH_PRO_BUTTON_INDEX.B, 1.0);

      const snap3 = controller.poll();
      expect(snap3.throttle).toBe(0);
      expect(snap3.brake).toBe(1.0);
    });

    it("各ボタンの立ち上がりエッジ（押下瞬間）でのみショートカットアクションが1回発火し、長押し中は連打されないことを保証する", () => {
      const proCon = createSwitchProGamepadMock();
      const onResetVehicle = vi.fn();
      const onGazePreset = vi.fn();
      const onWiperToggle = vi.fn();
      const onTimeToggle = vi.fn();
      const onRoadSurfaceToggle = vi.fn();
      const onAreaToggle = vi.fn();
      const onCameraToggle = vi.fn();
      const onGraphicsQualityToggle = vi.fn();

      const controller = new GamepadController({
        getGamepads: () => [proCon],
        onResetVehicle,
        onGazePreset,
        onWiperToggle,
        onTimeToggle,
        onRoadSurfaceToggle,
        onAreaToggle,
        onCameraToggle,
        onGraphicsQualityToggle,
      });

      // 初期ポーリング
      controller.poll();

      // X ボタン（カメラ視点切替）押下 → 1回だけ発火、次フレームも押しっぱなしなら発火しない
      pressButton(proCon, SWITCH_PRO_BUTTON_INDEX.X);
      controller.poll();
      controller.poll();
      expect(onCameraToggle).toHaveBeenCalledTimes(1);

      releaseButton(proCon, SWITCH_PRO_BUTTON_INDEX.X);
      controller.poll();
      pressButton(proCon, SWITCH_PRO_BUTTON_INDEX.X);
      controller.poll();
      expect(onCameraToggle).toHaveBeenCalledTimes(2);
      releaseButton(proCon, SWITCH_PRO_BUTTON_INDEX.X);

      // L / R で左右ドアミラー、ZL+L / ZR+R で左右目視（死角確認）
      pressButton(proCon, SWITCH_PRO_BUTTON_INDEX.L);
      controller.poll();
      expect(onGazePreset).toHaveBeenLastCalledWith("left_mirror");
      releaseButton(proCon, SWITCH_PRO_BUTTON_INDEX.L);

      pressButton(proCon, SWITCH_PRO_BUTTON_INDEX.R);
      controller.poll();
      expect(onGazePreset).toHaveBeenLastCalledWith("right_mirror");
      releaseButton(proCon, SWITCH_PRO_BUTTON_INDEX.R);

      pressButton(proCon, SWITCH_PRO_BUTTON_INDEX.ZL);
      pressButton(proCon, SWITCH_PRO_BUTTON_INDEX.L);
      controller.poll();
      expect(onGazePreset).toHaveBeenLastCalledWith("left_shoulder");
      releaseButton(proCon, SWITCH_PRO_BUTTON_INDEX.L);
      releaseButton(proCon, SWITCH_PRO_BUTTON_INDEX.ZL);

      pressButton(proCon, SWITCH_PRO_BUTTON_INDEX.ZR);
      pressButton(proCon, SWITCH_PRO_BUTTON_INDEX.R);
      controller.poll();
      expect(onGazePreset).toHaveBeenLastCalledWith("right_shoulder");
      releaseButton(proCon, SWITCH_PRO_BUTTON_INDEX.R);
      releaseButton(proCon, SWITCH_PRO_BUTTON_INDEX.ZR);

      // R3（正面視線リセット）& L3（路面状態切替）
      pressButton(proCon, SWITCH_PRO_BUTTON_INDEX.R3);
      pressButton(proCon, SWITCH_PRO_BUTTON_INDEX.L3);
      controller.poll();
      expect(onGazePreset).toHaveBeenLastCalledWith("forward");
      expect(onRoadSurfaceToggle).toHaveBeenCalledTimes(1);
      releaseButton(proCon, SWITCH_PRO_BUTTON_INDEX.R3);
      releaseButton(proCon, SWITCH_PRO_BUTTON_INDEX.L3);

      // 十字キー（上: ルームミラー / 下: 計器・ナビ / 左: ワイパー / 右: 時間帯）
      pressButton(proCon, SWITCH_PRO_BUTTON_INDEX.DPAD_UP);
      controller.poll();
      expect(onGazePreset).toHaveBeenLastCalledWith("rearview_mirror");
      releaseButton(proCon, SWITCH_PRO_BUTTON_INDEX.DPAD_UP);

      pressButton(proCon, SWITCH_PRO_BUTTON_INDEX.DPAD_DOWN);
      controller.poll();
      expect(onGazePreset).toHaveBeenLastCalledWith("dashboard");
      releaseButton(proCon, SWITCH_PRO_BUTTON_INDEX.DPAD_DOWN);

      pressButton(proCon, SWITCH_PRO_BUTTON_INDEX.DPAD_LEFT);
      pressButton(proCon, SWITCH_PRO_BUTTON_INDEX.DPAD_RIGHT);
      controller.poll();
      expect(onWiperToggle).toHaveBeenCalledTimes(1);
      expect(onTimeToggle).toHaveBeenCalledTimes(1);
      releaseButton(proCon, SWITCH_PRO_BUTTON_INDEX.DPAD_LEFT);
      releaseButton(proCon, SWITCH_PRO_BUTTON_INDEX.DPAD_RIGHT);

      // - (エリア切替) / + (車両初期位置リセット) / Capture & HOME (画質切替)
      pressButton(proCon, SWITCH_PRO_BUTTON_INDEX.MINUS);
      pressButton(proCon, SWITCH_PRO_BUTTON_INDEX.PLUS);
      pressButton(proCon, SWITCH_PRO_BUTTON_INDEX.CAPTURE);
      controller.poll();
      expect(onAreaToggle).toHaveBeenCalledTimes(1);
      expect(onResetVehicle).toHaveBeenCalledTimes(1);
      expect(onGraphicsQualityToggle).toHaveBeenCalledTimes(1);
      releaseButton(proCon, SWITCH_PRO_BUTTON_INDEX.CAPTURE);
      controller.poll();

      pressButton(proCon, SWITCH_PRO_BUTTON_INDEX.HOME);
      controller.poll();
      expect(onGraphicsQualityToggle).toHaveBeenCalledTimes(2);
    });

    it("モーダルダイアログ表示中は全ゲームパッド操作をブロックし、ボタンを押したままモーダルを閉じた次フレームで誤発火しないことを保証する", () => {
      const proCon = createSwitchProGamepadMock();
      const onAreaToggle = vi.fn();
      const onResetVehicle = vi.fn();
      const onGraphicsQualityToggle = vi.fn();
      let modalOpen = true;

      const controller = new GamepadController({
        getGamepads: () => [proCon],
        isModalOpen: () => modalOpen,
        onAreaToggle,
        onResetVehicle,
        onGraphicsQualityToggle,
      });

      // モーダル表示中にボタン押下 → すべてブロックされること
      pressButton(proCon, SWITCH_PRO_BUTTON_INDEX.ZR, 1.0);
      pressButton(proCon, SWITCH_PRO_BUTTON_INDEX.MINUS, 1.0);
      pressButton(proCon, SWITCH_PRO_BUTTON_INDEX.PLUS, 1.0);
      pressButton(proCon, SWITCH_PRO_BUTTON_INDEX.CAPTURE, 1.0);

      const blockedSnapshot = controller.poll();
      expect(blockedSnapshot.throttle).toBe(0);
      expect(onAreaToggle).not.toHaveBeenCalled();
      expect(onResetVehicle).not.toHaveBeenCalled();
      expect(onGraphicsQualityToggle).not.toHaveBeenCalled();

      // ボタンを押したままモーダルが閉じられた次フレームで立ち上がりエッジが誤発火しないこと
      modalOpen = false;
      const unblockedSnapshot = controller.poll();
      expect(unblockedSnapshot.throttle).toBe(1.0);
      expect(onAreaToggle).not.toHaveBeenCalled();
      expect(onResetVehicle).not.toHaveBeenCalled();
      expect(onGraphicsQualityToggle).not.toHaveBeenCalled();

      // 一度離してから再度押したときに初めて発火すること
      releaseButton(proCon, SWITCH_PRO_BUTTON_INDEX.PLUS);
      controller.poll();
      pressButton(proCon, SWITCH_PRO_BUTTON_INDEX.PLUS, 1.0);
      controller.poll();
      expect(onResetVehicle).toHaveBeenCalledTimes(1);
    });

    it("2台のコントローラー接続中にアクティブな Switch ProCon 1 が切断された場合、残りのコントローラーへ自動フェイルオーバーすることを保証する", () => {
      const proConPrimary = createSwitchProGamepadMock({
        id: "Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)",
        index: 0,
      });
      const proConSecondary = createSwitchProGamepadMock({
        id: "Nintendo Switch Pro Controller #2 (Vendor: 057e Product: 2009)",
        index: 1,
      });
      let currentPads: Array<GamepadLike | null> = [proConPrimary, proConSecondary];

      const controller = new GamepadController({
        getGamepads: () => currentPads,
      });

      const firstSnap = controller.poll();
      expect(firstSnap.status.connected).toBe(true);
      expect(firstSnap.status.gamepadIndex).toBe(0);

      // 1台目の ProCon 1 が切断された場合、2台目 (index: 1) へ即座にフェイルオーバーすること
      proConSecondary.axes[0] = 0.75;
      currentPads = [null, proConSecondary];
      const secondSnap = controller.poll();
      expect(secondSnap.status.connected).toBe(true);
      expect(secondSnap.status.isSwitchProCon1).toBe(true);
      expect(secondSnap.status.gamepadIndex).toBe(1);
      expect(secondSnap.steer).toBeGreaterThan(0.5);
    });

    it("HD振動 (vibrationActuator.playEffect) が利用可能な環境でデュアルランブルを実行できることを保証する", async () => {
      const playEffect = vi.fn().mockResolvedValue("complete");
      const proCon = createSwitchProGamepadMock({
        vibrationActuator: { playEffect },
      });

      const controller = new GamepadController({
        getGamepads: () => [proCon],
      });
      controller.poll();

      const triggered = await controller.triggerRumble(120, 0.35, 0.7);
      expect(triggered).toBe(true);
      expect(playEffect).toHaveBeenCalledWith("dual-rumble", {
        startDelay: 0,
        duration: 120,
        weakMagnitude: 0.35,
        strongMagnitude: 0.7,
      });
    });
  });

  describe("InputManager & i18n 統合", () => {
    it("InputManager が Switch ProCon 1 の視線パン符号（右スティック右＝右向き -yaw、上＝上向き +pitch）と仮想ステアリングサム視覚同期を正しく行うことを保証する", () => {
      const proCon = createSwitchProGamepadMock();
      const originalNavigator = globalThis.navigator;
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: {
          ...originalNavigator,
          getGamepads: () => [proCon],
        },
      });

      try {
        const inputManager = new InputManager();
        const steerVisualValues: number[] = [];
        inputManager.attachVirtualControls({
          onSteerVisualChange: (steer) => {
            steerVisualValues.push(steer);
          },
        });

        proCon.axes[0] = -1.0; // 左一杯に操舵
        proCon.axes[1] = 0.0;
        proCon.axes[2] = 0.0;
        proCon.axes[3] = 0.0;
        pressButton(proCon, SWITCH_PRO_BUTTON_INDEX.ZR, 1.0);

        const vehicleInput = inputManager.getInput();
        expect(vehicleInput.throttle).toBe(1.0);
        expect(vehicleInput.steer).toBeCloseTo(-1.0, 5);
        expect(steerVisualValues.length).toBeGreaterThan(0);
        expect(steerVisualValues[steerVisualValues.length - 1]).toBeCloseTo(-1.0, 5);

        // Lスティック左倒しでも視線が左（+yaw）へ動き、Rスティック右・上倒しでは右（-yaw）・上（+pitch）へ動くこと
        const leftStickGazeDelta = inputManager.getGazePanDelta(0.1);
        expect(leftStickGazeDelta.deltaYawRad).toBeGreaterThan(0); // 左を向く = +yaw

        proCon.axes[0] = 0.0;
        proCon.axes[2] = 1.0; // 右スティックを右一杯
        proCon.axes[3] = -1.0; // 右スティックを一杯上へ
        inputManager.getInput();
        const gazeDelta = inputManager.getGazePanDelta(0.1);
        expect(gazeDelta.deltaYawRad).toBeLessThan(0); // 右を向く = -yaw
        expect(gazeDelta.deltaPitchRad).toBeGreaterThan(0); // 上を向く = +pitch

        // 左スティックをセンター (0) に戻した際、仮想ステアリングサムも 0 へ復帰すること
        proCon.axes[0] = 0;
        const centeredInput = inputManager.getInput();
        expect(centeredInput.steer).toBe(0);
        expect(steerVisualValues[steerVisualValues.length - 1]).toBe(0);
      } finally {
        Object.defineProperty(globalThis, "navigator", {
          configurable: true,
          value: originalNavigator,
        });
      }
    });

    it("Switch ProCon 1 の接続状態テキストが日本語・英語・中国語の3言語すべてにローカライズされることを保証する", () => {
      expect(
        localizeGamepadStatusText({ connected: false, isSwitchProCon1: false }, "ja"),
      ).toContain("ProCon 1 待機中");
      expect(localizeGamepadStatusText({ connected: true, isSwitchProCon1: true }, "ja")).toBe(
        "Switch ProCon 1 接続中",
      );
      expect(localizeGamepadStatusText({ connected: true, isSwitchProCon1: true }, "en")).toBe(
        "Switch ProCon 1 Connected",
      );
      expect(localizeGamepadStatusText({ connected: true, isSwitchProCon1: true }, "zh")).toBe(
        "Switch ProCon 1 已连接",
      );
      expect(localizeGamepadStatusText({ connected: true, isSwitchProCon1: false }, "en")).toBe(
        "Gamepad Connected",
      );
    });

    it("Lスティック単体（X軸・Y軸）で左右Yawおよび上下Pitchの自由視線パンが機能することを保証する", () => {
      const proCon = createSwitchProGamepadMock();
      const originalNavigator = globalThis.navigator;
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: {
          ...originalNavigator,
          getGamepads: () => [proCon],
        },
      });

      try {
        const inputManager = new InputManager();
        // Lスティックを右（+0.85）・上（-0.85）へ倒す（Rスティックは中立）
        proCon.axes[0] = 0.85;
        proCon.axes[1] = -0.85;
        proCon.axes[2] = 0;
        proCon.axes[3] = 0;

        const snap = inputManager.getGamepadController().poll();
        expect(snap.leftStickX).toBeGreaterThan(0.5);
        expect(snap.leftStickY).toBeLessThan(-0.5);

        inputManager.getInput();
        const delta = inputManager.getGazePanDelta(0.1);
        expect(delta.deltaYawRad).toBeLessThan(0); // 右向き (-yaw)
        expect(delta.deltaPitchRad).toBeGreaterThan(0); // 上向き (+pitch)
      } finally {
        Object.defineProperty(globalThis, "navigator", {
          configurable: true,
          value: originalNavigator,
        });
      }
    });

    it("マウスボタンを押さずにキャンバス上でマウスを動かすだけで視線（Yaw / Pitch）が変わり、タッチ操作では従来通りドラッグ中のみ視線が変わることを保証する", () => {
      const listeners = new Map<string, Array<(e: PointerEvent) => void>>();
      const mockCanvas = {
        style: { cursor: "" },
        addEventListener: (type: string, handler: (e: PointerEvent) => void) => {
          const list = listeners.get(type) ?? [];
          list.push(handler);
          listeners.set(type, list);
        },
        setPointerCapture: vi.fn(),
      } as unknown as HTMLElement;

      const emit = (type: string, eventInit: Partial<PointerEvent>) => {
        const list = listeners.get(type) ?? [];
        for (const fn of list) {
          fn({ type, ...eventInit } as PointerEvent);
        }
      };

      const inputManager = new InputManager(mockCanvas);
      const gazeDeltas: Array<{ yaw: number; pitch: number }> = [];
      inputManager.onGazeDragDelta = (yaw, pitch) => {
        gazeDeltas.push({ yaw, pitch });
      };

      // 1. マウス（pointerType: "mouse"）で pointerdown 無しのまま pointermove
      // 初回ムーブはベースライン座標 (200, 150) の初期化のみ行いジャンプしない
      emit("pointermove", { pointerType: "mouse", pointerId: 1, clientX: 200, clientY: 150 });
      expect(gazeDeltas.length).toBe(0);

      // 2回目のマウス移動（ボタン押下なし）で右(+50px)・上(-30px)へ動かすと直ちに視線が変化すること
      emit("pointermove", { pointerType: "mouse", pointerId: 1, clientX: 250, clientY: 120 });
      expect(gazeDeltas.length).toBe(1);
      expect(gazeDeltas[0]?.yaw).toBeCloseTo(-50 * 0.0032, 6);
      expect(gazeDeltas[0]?.pitch).toBeCloseTo(30 * 0.0032, 6);

      // 2. タッチ（pointerType: "touch"）では pointerdown 無しの pointermove では視線が動かないこと
      emit("pointermove", { pointerType: "touch", pointerId: 2, clientX: 300, clientY: 200 });
      expect(gazeDeltas.length).toBe(1);

      // タッチで pointerdown してからスワイプすると視線が動くこと
      emit("pointerdown", {
        pointerType: "touch",
        pointerId: 2,
        button: 0,
        clientX: 300,
        clientY: 200,
      });
      emit("pointermove", { pointerType: "touch", pointerId: 2, clientX: 340, clientY: 180 });
      expect(gazeDeltas.length).toBe(2);
      expect(gazeDeltas[1]?.yaw).toBeCloseTo(-40 * 0.0048, 6);
      expect(gazeDeltas[1]?.pitch).toBeCloseTo(20 * 0.0048, 6);
      emit("pointerup", { pointerType: "touch", pointerId: 2, clientX: 340, clientY: 180 });

      // 3. Escape キーを押すとフリーマウス視線変更が一時停止され、カーソルを動かしても視線が変わらないこと
      const originalWindow = globalThis.window;
      const keydownHandlers: Array<(e: KeyboardEvent) => void> = [];
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
          addEventListener: (type: string, fn: (e: KeyboardEvent) => void) => {
            if (type === "keydown") {
              keydownHandlers.push(fn);
            }
          },
        },
      });
      try {
        const escapeListeners = new Map<string, Array<(e: PointerEvent) => void>>();
        const escapeCanvas = {
          style: { cursor: "" },
          addEventListener: (type: string, handler: (e: PointerEvent) => void) => {
            const list = escapeListeners.get(type) ?? [];
            list.push(handler);
            escapeListeners.set(type, list);
          },
          setPointerCapture: vi.fn(),
        } as unknown as HTMLElement;
        const emitEscapeCanvas = (type: string, eventInit: Partial<PointerEvent>) => {
          const list = escapeListeners.get(type) ?? [];
          for (const fn of list) {
            fn({ type, ...eventInit } as PointerEvent);
          }
        };

        const escapeInputManager = new InputManager(escapeCanvas);
        const escapeGazeDeltas: Array<{ yaw: number; pitch: number }> = [];
        escapeInputManager.onGazeDragDelta = (yaw, pitch) => {
          escapeGazeDeltas.push({ yaw, pitch });
        };

        // 初期状態ではフリーマウス移動が有効（cursor = "crosshair"）
        expect(escapeInputManager.isMouseLookPaused()).toBe(false);
        expect(escapeCanvas.style.cursor).toBe("crosshair");
        emitEscapeCanvas("pointermove", {
          pointerType: "mouse",
          pointerId: 1,
          clientX: 100,
          clientY: 100,
        });
        emitEscapeCanvas("pointermove", {
          pointerType: "mouse",
          pointerId: 1,
          clientX: 140,
          clientY: 90,
        });
        expect(escapeGazeDeltas.length).toBe(1);

        // Escape キー押下でフリーマウス視線変更が一時停止し、カーソルが "default" に戻ること
        for (const fn of keydownHandlers) {
          fn({
            key: "Escape",
            code: "Escape",
            repeat: false,
            target: null,
          } as unknown as KeyboardEvent);
        }
        expect(escapeInputManager.isMouseLookPaused()).toBe(true);
        expect(escapeCanvas.style.cursor).toBe("default");

        // Escape 一時停止中にマウスカーソルを動かしても視線（onGazeDragDelta）が一切変化しないこと
        emitEscapeCanvas("pointermove", {
          pointerType: "mouse",
          pointerId: 1,
          clientX: 200,
          clientY: 150,
          movementX: 60,
          movementY: 60,
        });
        emitEscapeCanvas("pointermove", {
          pointerType: "mouse",
          pointerId: 1,
          clientX: 280,
          clientY: 210,
          movementX: 80,
          movementY: 60,
        });
        expect(escapeGazeDeltas.length).toBe(1);

        // キャンバスをクリック（pointerdown -> pointerup）するとフリーマウス視線変更が再開されること
        emitEscapeCanvas("pointerdown", {
          pointerType: "mouse",
          pointerId: 1,
          button: 0,
          clientX: 280,
          clientY: 210,
        });
        emitEscapeCanvas("pointerup", {
          pointerType: "mouse",
          pointerId: 1,
          button: 0,
          clientX: 280,
          clientY: 210,
        });
        expect(escapeInputManager.isMouseLookPaused()).toBe(false);
        expect(escapeCanvas.style.cursor).toBe("crosshair");

        emitEscapeCanvas("pointermove", {
          pointerType: "mouse",
          pointerId: 1,
          clientX: 310,
          clientY: 190,
        });
        expect(escapeGazeDeltas.length).toBe(2);
      } finally {
        Object.defineProperty(globalThis, "window", {
          configurable: true,
          value: originalWindow,
        });
      }
    });

    it("UI OFF モード（HUD全非表示）が URL クエリ (?hud=0 / ?ui=off)・ボタン・Tab キーショートカットで切り替わり構造化ログを記録することを保証する", () => {
      expect(parseHudVisibilityQuery("")).toBe(true);
      expect(parseHudVisibilityQuery("?area=shibuya")).toBe(true);
      expect(parseHudVisibilityQuery("?hud=1")).toBe(true);
      expect(parseHudVisibilityQuery("?hud=0")).toBe(false);
      expect(parseHudVisibilityQuery("?hud=off")).toBe(false);
      expect(parseHudVisibilityQuery("?hud=false")).toBe(false);
      expect(parseHudVisibilityQuery("?ui=0")).toBe(false);
      expect(parseHudVisibilityQuery("?ui=off")).toBe(false);

      const originalWindow = globalThis.window;
      const originalDocument = globalThis.document;

      const createButtonMock = (dataset: Record<string, string> = {}) => {
        const classes = new Set<string>();
        const attrs = new Map<string, string>();
        const handlers = new Map<string, Array<() => void>>();
        return {
          dataset,
          textContent: "",
          classList: {
            toggle(cls: string, force?: boolean) {
              const next = force ?? !classes.has(cls);
              if (next) classes.add(cls);
              else classes.delete(cls);
            },
            contains(cls: string) {
              return classes.has(cls);
            },
          },
          setAttribute(k: string, v: string) {
            attrs.set(k, v);
          },
          getAttribute(k: string) {
            return attrs.get(k) ?? null;
          },
          addEventListener(type: string, fn: () => void) {
            const list = handlers.get(type) ?? [];
            list.push(fn);
            handlers.set(type, list);
          },
          click() {
            for (const fn of handlers.get("click") ?? []) {
              fn();
            }
          },
        };
      };

      const hudUiToggleBtn = createButtonMock();
      const quickUiOffBtn = createButtonMock();
      const uiRestoreFab = createButtonMock();
      const uiOnBtn = createButtonMock({ uiVisibility: "on" });
      const uiOffBtn = createButtonMock({ uiVisibility: "off" });
      const virtualTouchContainer = createButtonMock();
      const bodyClasses = new Set<string>();
      const bodyDataset: Record<string, string> = {};
      const keydownHandlers: Array<(e: KeyboardEvent) => void> = [];

      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
          location: { search: "?area=shibuya" },
          innerWidth: 1440,
          innerHeight: 900,
          addEventListener: (type: string, fn: (e: KeyboardEvent) => void) => {
            if (type === "keydown") {
              keydownHandlers.push(fn);
            }
          },
        },
      });

      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: {
          body: {
            dataset: bodyDataset,
            classList: {
              toggle(cls: string, force?: boolean) {
                const next = force ?? !bodyClasses.has(cls);
                if (next) bodyClasses.add(cls);
                else bodyClasses.delete(cls);
              },
              contains(cls: string) {
                return bodyClasses.has(cls);
              },
            },
          },
          addEventListener: () => {},
          getElementById(id: string) {
            if (id === "hud-ui-toggle-btn") return hudUiToggleBtn;
            if (id === "quick-ui-off-btn") return quickUiOffBtn;
            if (id === "ui-restore-fab") return uiRestoreFab;
            if (id === "virtual-touch-controls") return virtualTouchContainer;
            return null;
          },
          querySelector() {
            return null;
          },
          querySelectorAll(selector: string) {
            if (selector === "#ui-visibility-buttons button") {
              return [uiOnBtn, uiOffBtn];
            }
            return [];
          },
        },
      });

      try {
        logger.clear();
        const inputManager = new InputManager();
        const hud = new MobileHudController({ inputManager });

        // 初期状態は UI ON
        expect(hud.getHudVisible()).toBe(true);
        expect(bodyClasses.has("ui-off-mode")).toBe(false);
        expect(bodyDataset.hudVisibility).toBe("visible");
        expect(uiRestoreFab.getAttribute("aria-hidden")).toBe("true");
        expect(uiOnBtn.classList.contains("active")).toBe(true);
        expect(uiOffBtn.classList.contains("active")).toBe(false);

        // ヘッダーの「👁 UI OFF [Tab]」ボタンクリックで UI OFF モードへ遷移
        hudUiToggleBtn.click();
        expect(hud.getHudVisible()).toBe(false);
        expect(bodyClasses.has("ui-off-mode")).toBe(true);
        expect(bodyDataset.hudVisibility).toBe("hidden");
        expect(uiRestoreFab.getAttribute("aria-hidden")).toBe("false");
        expect(uiOnBtn.classList.contains("active")).toBe(false);
        expect(uiOffBtn.classList.contains("active")).toBe(true);

        // 右上の復帰ピルボタン (#ui-restore-fab) クリックで UI ON へ復帰
        uiRestoreFab.click();
        expect(hud.getHudVisible()).toBe(true);
        expect(bodyClasses.has("ui-off-mode")).toBe(false);
        expect(bodyDataset.hudVisibility).toBe("visible");

        // Tab キー押下で preventDefault されつつ UI OFF モードへトグルされること
        const preventDefault = vi.fn();
        for (const fn of keydownHandlers) {
          fn({
            key: "Tab",
            repeat: false,
            altKey: false,
            ctrlKey: false,
            metaKey: false,
            target: null,
            preventDefault,
          } as unknown as KeyboardEvent);
        }
        expect(preventDefault).toHaveBeenCalledTimes(1);
        expect(hud.getHudVisible()).toBe(false);
        expect(bodyClasses.has("ui-off-mode")).toBe(true);

        // 構造化ログに hud.visibility.change が記録されていること
        const visibilityLogs = logger
          .getLogs()
          .filter((entry) => entry.event === "hud.visibility.change");
        expect(visibilityLogs.length).toBeGreaterThanOrEqual(3);
      } finally {
        Object.defineProperty(globalThis, "window", {
          configurable: true,
          value: originalWindow,
        });
        Object.defineProperty(globalThis, "document", {
          configurable: true,
          value: originalDocument,
        });
      }
    });
  });
});

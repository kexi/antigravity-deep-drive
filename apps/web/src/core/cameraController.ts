import * as THREE from "three";
import type { CameraMode, GazePreset, GazeState, VehicleState } from "../types";
import { localizeGazePresetLabel, type SupportedLocale } from "./i18n";

interface GazePresetSpec {
  yawDeg: number;
  pitchDeg: number;
  label: string;
}

export const GAZE_PRESET_SPECS: Record<Exclude<GazePreset, "free">, GazePresetSpec> = {
  forward: { yawDeg: 0, pitchDeg: 0, label: "正面" },
  right_mirror: { yawDeg: -30, pitchDeg: -8, label: "右ミラー" },
  // Why yawDeg: 54 を採用するか（47度ではない理由）:
  // 右ハンドル運転席 (x = -0.38m, y = 1.13m, z = 0.06m) から左ドアミラー鏡面中心 (x = 0.915m, y = 0.965m, z = 0.873m) への
  // 実幾何ベクトル方向は水平約 55.2度であり、47度では左ミラーが視界左端に偏ってしまうため、54度でビューポート中央に捉える。
  left_mirror: { yawDeg: 54, pitchDeg: -6, label: "左ミラー" },
  rearview_mirror: { yawDeg: 26, pitchDeg: 8, label: "ルームミラー" },
  dashboard: { yawDeg: 18, pitchDeg: -15, label: "計器・ナビ" },
  right_shoulder: { yawDeg: -95, pitchDeg: -4, label: "右目視" },
  left_shoulder: { yawDeg: 95, pitchDeg: -4, label: "左目視" },
};

/**
 * 車両追従・コックピットカメラコントローラー
 * - コックピット視点: 運転席ポジションからの迫力あるリアルな一人称 + UN R125 準拠の頭部・体幹回旋による視線変更
 * - チェイス視点: 車両後方からの三人称追従カメラ + オービット視線回転
 */
export class CameraController {
  public static readonly BASE_EYE_LOCAL = new THREE.Vector3(-0.38, 1.13, 0.06);
  // UN R125 Annex 3: 首の水平回転中心 P 点から眼球中点までの前方距離 (98.6mm ≈ 0.099m)
  public static readonly NECK_TO_EYE_FORWARD_M = 0.099;
  // 45°超の深い後方目視時に体幹回旋が加わる脊椎ピボット（首の 60mm 後方）
  public static readonly SPINE_TO_NECK_FORWARD_M = 0.06;
  public static readonly TORSO_ENGAGE_RAD = THREE.MathUtils.degToRad(45);
  public static readonly MAX_TORSO_YAW_RAD = THREE.MathUtils.degToRad(40);
  public static readonly MAX_COCKPIT_YAW_RAD = THREE.MathUtils.degToRad(110);
  public static readonly MAX_CHASE_YAW_RAD = THREE.MathUtils.degToRad(180);
  public static readonly MIN_PITCH_RAD = THREE.MathUtils.degToRad(-35);
  public static readonly MAX_PITCH_RAD = THREE.MathUtils.degToRad(25);

  public camera: THREE.PerspectiveCamera;
  public mode: CameraMode = "cockpit";

  private currentTarget = new THREE.Vector3();
  private currentCameraPos = new THREE.Vector3();
  private isChaseSnapPending = true;
  private smoothedChaseHeading = 0;
  private fovDefault = 60;
  private currentAspect = 16 / 9;
  private smoothedSteerLook = 0;
  private smoothedHorizonPitch = 0;
  private smoothedHorizonRoll = 0;

  private gazePreset: GazePreset = "forward";
  private currentGazeYawRad = 0;
  private currentGazePitchRad = 0;
  private targetGazeYawRad = 0;
  private targetGazePitchRad = 0;

  constructor(aspect: number) {
    const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    this.currentAspect = safeAspect;
    const initialFov = this.computeResponsiveFov(safeAspect);
    this.camera = new THREE.PerspectiveCamera(initialFov, safeAspect, 0.1, 2600);
  }

  /**
   * 画面アスペクト比に応じた垂直視野角（FOV）を算出する
   * - Why not 縦持ち（Portrait: aspect < 1.0）でも垂直 FOV 60° 固定のままにしないか:
   *   Three.js の PerspectiveCamera.fov は垂直視野角であるため、スマホ縦持ち（例: 390×844, aspect ≈ 0.46）で
   *   垂直 FOV 60° のままだと水平視野角が約 29° まで狭窄し、ステアリングや 12.3型メーター、11型ナビが左右に見切れてしまうため。
   * - How:
   *   横持ち・PC（aspect >= 1.0）では厳密に 60° を維持し、縦持ち（aspect < 1.0）のときのみ水平視野角を確保するよう最大 80° まで滑らかに広げる。
   */
  public static computeResponsiveFov(aspect: number, baseFov = 60): number {
    const isLandscapeOrSquare = !(aspect < 1.0);
    if (isLandscapeOrSquare) {
      return baseFov;
    }
    const clampedAspect = THREE.MathUtils.clamp(aspect, 0.38, 1.0);
    const portraitBoost = Math.pow(1.0 / clampedAspect, 0.38);
    return THREE.MathUtils.clamp(baseFov * portraitBoost, baseFov, 80);
  }

  public computeResponsiveFov(aspect = this.currentAspect): number {
    return CameraController.computeResponsiveFov(aspect, this.fovDefault);
  }

  public setMode(mode: CameraMode): void {
    const isSwitchingToChase = this.mode !== mode && mode === "chase";
    if (isSwitchingToChase) {
      this.isChaseSnapPending = true;
    }
    this.mode = mode;
    this.targetGazeYawRad = this.clampYawForMode(this.targetGazeYawRad);
    this.currentGazeYawRad = this.clampYawForMode(this.currentGazeYawRad);
  }

  private clampYawForMode(yawRad: number): number {
    const maxYaw =
      this.mode === "cockpit"
        ? CameraController.MAX_COCKPIT_YAW_RAD
        : CameraController.MAX_CHASE_YAW_RAD;
    return THREE.MathUtils.clamp(yawRad, -maxYaw, maxYaw);
  }

  private clampPitch(pitchRad: number): number {
    return THREE.MathUtils.clamp(
      pitchRad,
      CameraController.MIN_PITCH_RAD,
      CameraController.MAX_PITCH_RAD,
    );
  }

  /**
   * プリセット視線（正面・右ミラー・左ミラー・ルームミラー・計器/ナビ・右目視・左目視）を設定する
   */
  public setGazePreset(preset: GazePreset, isImmediate = false): void {
    const isFreePreset = preset === "free";
    if (isFreePreset) {
      this.gazePreset = "free";
      return;
    }

    const spec = GAZE_PRESET_SPECS[preset];
    this.gazePreset = preset;
    this.targetGazeYawRad = this.clampYawForMode(THREE.MathUtils.degToRad(spec.yawDeg));
    this.targetGazePitchRad = this.clampPitch(THREE.MathUtils.degToRad(spec.pitchDeg));

    if (isImmediate) {
      this.currentGazeYawRad = this.targetGazeYawRad;
      this.currentGazePitchRad = this.targetGazePitchRad;
    }
  }

  /**
   * 任意の視線角度（ラジアン：+yaw=左、-yaw=右、+pitch=上、-pitch=下）を設定する
   */
  public setGazeAngles(yawRad: number, pitchRad: number, isImmediate = false): void {
    const isNearForward = Math.abs(yawRad) < 1e-4 && Math.abs(pitchRad) < 1e-4;
    this.gazePreset = isNearForward ? "forward" : "free";
    this.targetGazeYawRad = this.clampYawForMode(yawRad);
    this.targetGazePitchRad = this.clampPitch(pitchRad);

    if (isImmediate) {
      this.currentGazeYawRad = this.targetGazeYawRad;
      this.currentGazePitchRad = this.targetGazePitchRad;
    }
  }

  /**
   * マウスドラッグやキー操作による視線角度の相対加算を行う
   */
  public addGazeDelta(deltaYawRad: number, deltaPitchRad: number, isImmediate = false): void {
    const nextYaw = this.clampYawForMode(this.targetGazeYawRad + deltaYawRad);
    const nextPitch = this.clampPitch(this.targetGazePitchRad + deltaPitchRad);
    this.setGazeAngles(nextYaw, nextPitch, isImmediate);
  }

  /**
   * 視線を正面（yaw=0, pitch=0）にリセットする
   */
  public resetGaze(isImmediate = false): void {
    this.setGazePreset("forward", isImmediate);
  }

  /**
   * UN R125 Annex 3（首の回転軸＝眼の99mm後方）および深い目視時（45°〜110°）の体幹回旋に基づく
   * ドライバーアイポイントのローカル変位ベクトルを算出する。
   * - Why 眼そのものを中心にその場回転させないか:
   *   人間の眼球は首のピボットより約99mm前方に位置するため、首を左右に振ると眼の位置自体が円弧を描いて移動し、
   *   さらに45°を超える目視では肩・体幹の回旋が加わるため Aピラーや Bピラーの死角を回り込んで確認できる。
   *   `yawRad = 0, pitchRad = 0` では厳密に `(0, 0, 0)` となり、正面アイポイント `(-0.38, 1.13, 0.06)` と完全一致する。
   */
  public computeDriverHeadOffset(
    yawRad = this.currentGazeYawRad,
    pitchRad = this.currentGazePitchRad,
  ): THREE.Vector3 {
    const isNeutral = Math.abs(yawRad) < 1e-8 && Math.abs(pitchRad) < 1e-8;
    if (isNeutral) {
      return new THREE.Vector3(0, 0, 0);
    }

    const d = CameraController.NECK_TO_EYE_FORWARD_M;
    const s = CameraController.SPINE_TO_NECK_FORWARD_M;

    // 1. 首ピボット周りの円弧移動（+X: 左、+Z: 前方）
    const neckDx = d * Math.sin(yawRad);
    const neckDz = d * (Math.cos(yawRad) - 1.0);

    // 2. 45°超の深い後方確認（左右目視）における体幹の回旋寄与
    const absYaw = Math.abs(yawRad);
    const isTorsoEngaged = absYaw > CameraController.TORSO_ENGAGE_RAD;
    let torsoDx = 0;
    let torsoDz = 0;
    if (isTorsoEngaged) {
      const torsoSpan = CameraController.MAX_COCKPIT_YAW_RAD - CameraController.TORSO_ENGAGE_RAD;
      const torsoProgress = THREE.MathUtils.clamp(
        (absYaw - CameraController.TORSO_ENGAGE_RAD) / Math.max(torsoSpan, 1e-4),
        0,
        1,
      );
      const torsoAngle = Math.sign(yawRad) * torsoProgress * CameraController.MAX_TORSO_YAW_RAD;
      torsoDx = s * Math.sin(torsoAngle);
      torsoDz = s * (Math.cos(torsoAngle) - 1.0);
    }

    // 3. 俯仰角（ピッチ）に伴うわずかな上下変位
    const pitchDy = d * Math.sin(pitchRad) * 0.35;

    return new THREE.Vector3(neckDx + torsoDx, pitchDy, neckDz + torsoDz);
  }

  public getGazeState(locale: SupportedLocale = "ja"): GazeState {
    const headOffset = this.computeDriverHeadOffset(
      this.currentGazeYawRad,
      this.currentGazePitchRad,
    );
    const label = localizeGazePresetLabel(this.gazePreset, locale);

    return {
      preset: this.gazePreset,
      label,
      yawRad: this.currentGazeYawRad,
      pitchRad: this.currentGazePitchRad,
      targetYawRad: this.targetGazeYawRad,
      targetPitchRad: this.targetGazePitchRad,
      headOffsetLocal: {
        x: headOffset.x,
        y: headOffset.y,
        z: headOffset.z,
      },
    };
  }

  public update(dt: number, state: VehicleState, carGroup: THREE.Group): void {
    const isInvalidDt = !(dt > 0 && dt < 0.2);
    if (isInvalidDt) {
      return;
    }

    // 視線角度（Yaw / Pitch）の滑らかな補間更新
    const gazeLerp = Math.min(1.0, dt * 12.0);
    this.currentGazeYawRad = THREE.MathUtils.lerp(
      this.currentGazeYawRad,
      this.targetGazeYawRad,
      gazeLerp,
    );
    this.currentGazePitchRad = THREE.MathUtils.lerp(
      this.currentGazePitchRad,
      this.targetGazePitchRad,
      gazeLerp,
    );
    const isYawSettled = Math.abs(this.currentGazeYawRad - this.targetGazeYawRad) < 1e-5;
    if (isYawSettled) {
      this.currentGazeYawRad = this.targetGazeYawRad;
    }
    const isPitchSettled = Math.abs(this.currentGazePitchRad - this.targetGazePitchRad) < 1e-5;
    if (isPitchSettled) {
      this.currentGazePitchRad = this.targetGazePitchRad;
    }

    // Why not 車速連動の動的 FOV 拡大を行わないか:
    //   車速 (`speedKmh`) に比例して `camera.fov` を拡大すると、透視投影のズームアウト効果によって
    //   コックピット視点ではハンドル・メーター・フロントガラスが、追従視点では自車ボディが画面奥へ遠ざかり、
    //   速度を上げるほど視点が後ろへ下がっていく不自然な現象が生じるため、車速に依存しない FOV（横画面 60° 固定 / 縦画面のみアスペクト補正）を維持する。
    const targetFov = this.computeResponsiveFov(this.currentAspect);
    const isFovChanged = Math.abs(this.camera.fov - targetFov) > 1e-4;
    if (isFovChanged) {
      this.camera.fov = targetFov;
      this.camera.updateProjectionMatrix();
    }

    const isCockpitMode = this.mode === "cockpit";
    if (isCockpitMode) {
      this.updateCockpitCamera(dt, state, carGroup);
      return;
    }

    this.updateChaseCamera(dt, state, carGroup);
  }

  /**
   * ドライバー視点（コックピット）カメラ更新
   * - Why not:
   *   1. `carGroup.updateMatrixWorld(true)` を呼ばずに `carGroup.matrixWorld` を参照すると、
   *      1フレーム前の車体姿勢でカメラが配置され、直後の `renderer.render()` で現フレームの車体メッシュが描画されるため、
   *      加減速・旋回のたびにハンドルやメーター、Aピラーが画面内で激しくガタつく原因になる。
   *   2. カメラの `eyeWorld` だけに高周波サイン波を加算すると、38cm〜55cm 先の車内インテリアが激しく上下振動してしまう。
   * - How:
   *   1. 冒頭で必ず `carGroup.updateMatrixWorld(true)` を実行し、車内メッシュとの相対位置ズレを完全にゼロにする。
   *   2. アイポイントは右ハンドル運転席 (`x = -0.38m, y = 1.13m, z = 0.06m`) + UN R125 頭部回旋オフセットに同期させ、
   *      人間の前庭動眼反射（VOR: Vestibulo-Ocular Reflex）を模した緩やかな視線安定化とスムーズなステアリング視線追従を行う。
   */
  private updateCockpitCamera(dt: number, state: VehicleState, carGroup: THREE.Group): void {
    // 1. 現フレームの車体ワールド行列を即座に確定させ、車内パーツとの1フレーム遅延ジッターを根絶
    carGroup.updateMatrixWorld(true);

    // 2. ドライバー視点のアイポイント（日本の右ハンドル運転席の実寸位置 + 頭部・体幹回旋オフセット）
    const headOffset = this.computeDriverHeadOffset(
      this.currentGazeYawRad,
      this.currentGazePitchRad,
    );
    const eyeLocal = CameraController.BASE_EYE_LOCAL.clone().add(headOffset);
    const eyeWorld = eyeLocal.clone().applyMatrix4(carGroup.matrixWorld);
    this.camera.position.copy(eyeWorld);

    // 3. ステアリング操作に伴う滑らかな視線移動と前庭動眼反射（ピッチ・ロール安定化）
    const steerLerp = Math.min(1.0, dt * 6.0);
    this.smoothedSteerLook = THREE.MathUtils.lerp(
      this.smoothedSteerLook,
      state.steeringAngle * 0.42,
      steerLerp,
    );

    const pitchAngle = state.pitchAngle ?? 0;
    const rollAngle = state.rollAngle ?? 0;
    const vorLerp = Math.min(1.0, dt * 8.0);
    this.smoothedHorizonPitch = THREE.MathUtils.lerp(
      this.smoothedHorizonPitch,
      pitchAngle,
      vorLerp,
    );
    this.smoothedHorizonRoll = THREE.MathUtils.lerp(this.smoothedHorizonRoll, rollAngle, vorLerp);

    // 車体の急激なノーズダイブ・スクワットに対して首の反射で視線高さを約45%補正し、地平線の揺れを抑える
    const pitchCompensationY = Math.sin(this.smoothedHorizonPitch) * 18.0 * 0.45;
    const isNeutralGaze =
      Math.abs(this.currentGazeYawRad) < 1e-7 && Math.abs(this.currentGazePitchRad) < 1e-7;

    let lookLocal: THREE.Vector3;
    if (isNeutralGaze) {
      lookLocal = new THREE.Vector3(
        -0.34 - this.smoothedSteerLook,
        0.96 + pitchCompensationY,
        18.0,
      );
    } else {
      const lookDistance = 17.94;
      const steerLookWeight = Math.max(0, Math.cos(this.currentGazeYawRad));
      const baseDx = 0.04 - this.smoothedSteerLook * steerLookWeight;
      const baseDy = -0.17 + pitchCompensationY;
      const baseYaw = Math.atan2(baseDx, lookDistance);
      const basePitch = Math.atan2(baseDy, lookDistance);
      const totalYaw = baseYaw + this.currentGazeYawRad;
      const totalPitch = THREE.MathUtils.clamp(
        basePitch + this.currentGazePitchRad,
        -Math.PI * 0.42,
        Math.PI * 0.42,
      );

      const cosPitch = Math.cos(totalPitch);
      lookLocal = new THREE.Vector3(
        eyeLocal.x + lookDistance * Math.sin(totalYaw) * cosPitch,
        eyeLocal.y + lookDistance * Math.sin(totalPitch),
        eyeLocal.z + lookDistance * Math.cos(totalYaw) * cosPitch,
      );
    }

    const lookWorld = lookLocal.applyMatrix4(carGroup.matrixWorld);

    // カメラの上方向ベクトルも車体ロールに対してわずかに水平維持（VORロール安定化）を効かせる
    const carUp = new THREE.Vector3(0, 1, 0).transformDirection(carGroup.matrixWorld);
    const worldUp = new THREE.Vector3(0, 1, 0);
    this.camera.up.copy(carUp).lerp(worldUp, 0.35).normalize();
    this.camera.lookAt(lookWorld);
  }

  /**
   * 車両後方追従（チェイス）カメラ更新
   * - Why not ワールド座標の `targetPos` に対して `currentCameraPos.lerp(targetPos, dt * k)` を行わないか:
   *   前進速度 $v\text{ [m/s]}$ で移動する車体に対してワールド座標で指数平滑化を行うと、
   *   定常状態で $\Delta z = v / k$ の追従遅れ（ラグ）が発生し、速度を上げるほどカメラが車体から後ろへ引き離されてしまう。
   * - How:
   *   並進位置は車体の現在位置 `carPos` に完全同期させて後方距離 (`6.5m`) を車速に依らず一定に保ち、
   *   車体の旋回角（`smoothedChaseHeading`）のみを最短角度差で滑らかに補間する。
   */
  private updateChaseCamera(dt: number, state: VehicleState, _carGroup: THREE.Group): void {
    this.camera.up.set(0, 1, 0);
    const carPos = new THREE.Vector3(state.position.x, state.position.y, state.position.z);

    const shouldSnapChase = this.isChaseSnapPending;
    if (shouldSnapChase) {
      this.smoothedChaseHeading = state.headingAngle;
      this.isChaseSnapPending = false;
    } else {
      const headingDelta = Math.atan2(
        Math.sin(state.headingAngle - this.smoothedChaseHeading),
        Math.cos(state.headingAngle - this.smoothedChaseHeading),
      );
      const headingLerp = Math.min(dt * 8.0, 1.0);
      this.smoothedChaseHeading += headingDelta * headingLerp;
    }

    // 車両後方オフセット（視線変更時は車体周囲をオービット回転、距離 6.5m は速度によらず一定）
    const orbitYaw = this.smoothedChaseHeading + this.currentGazeYawRad;
    const pitchHeightOffset = Math.sin(-this.currentGazePitchRad) * 2.4;
    const chaseOffset = new THREE.Vector3(
      0,
      THREE.MathUtils.clamp(2.6 + pitchHeightOffset, 1.0, 5.2),
      -6.5,
    );
    chaseOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), orbitYaw);

    this.currentCameraPos.copy(carPos).add(chaseOffset);

    // 注視点は車体中心より少し前方（オービット回転時は車両中心寄りへ補間）
    const forwardLookRatio = Math.max(0, Math.cos(this.currentGazeYawRad));
    const lookTarget = carPos
      .clone()
      .add(new THREE.Vector3(0, 1.2 + Math.sin(this.currentGazePitchRad) * 1.4, 0));
    const forwardOffset = new THREE.Vector3(0, 0, 4.0 * forwardLookRatio).applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      this.smoothedChaseHeading,
    );
    lookTarget.add(forwardOffset);

    this.currentTarget.copy(lookTarget);
    this.camera.position.copy(this.currentCameraPos);
    this.camera.lookAt(this.currentTarget);
  }

  public onResize(aspect: number): void {
    const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : this.currentAspect;
    this.currentAspect = safeAspect;
    this.camera.aspect = safeAspect;
    this.camera.fov = this.computeResponsiveFov(safeAspect);
    this.camera.updateProjectionMatrix();
  }
}

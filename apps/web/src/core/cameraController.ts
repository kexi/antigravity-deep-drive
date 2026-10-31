import * as THREE from "three";
import type { CameraMode, VehicleState } from "../types";

/**
 * 車両追従・コックピットカメラコントローラー
 * - コックピット視点: 運転席ポジションからの迫力あるリアルな一人称
 * - チェイス視点: 車両後方からの三人称追従カメラ
 */
export class CameraController {
  public camera: THREE.PerspectiveCamera;
  public mode: CameraMode = "cockpit";

  private currentTarget = new THREE.Vector3();
  private currentCameraPos = new THREE.Vector3();
  private fovDefault = 60;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(this.fovDefault, aspect, 0.1, 1000);
  }

  public setMode(mode: CameraMode): void {
    this.mode = mode;
  }

  public update(dt: number, state: VehicleState, carGroup: THREE.Group): void {
    const isDtValid = dt > 0 && dt < 0.2;
    if (!isDtValid) {
      return;
    }

    // 車速に応じたFOVの動的変化（スピード感の強調）
    const speedKmh = state.speedKmh;
    const speedRatio = Math.min(speedKmh / 160.0, 1.0);
    const targetFov =
      this.mode === "cockpit"
        ? this.fovDefault + speedRatio * 10
        : this.fovDefault + 5 + speedRatio * 15;
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, dt * 5.0);
    this.camera.updateProjectionMatrix();

    if (this.mode === "cockpit") {
      this.updateCockpitCamera(dt, state, carGroup);
    } else {
      this.updateChaseCamera(dt, state, carGroup);
    }
  }

  private updateCockpitCamera(_dt: number, state: VehicleState, carGroup: THREE.Group): void {
    // 運転席のアイポイント（右ハンドル位置: x=0.38, y=1.18, z=-0.05）
    const eyeLocal = new THREE.Vector3(0.38, 1.18, -0.05);
    const eyeWorld = eyeLocal.clone().applyMatrix4(carGroup.matrixWorld);

    // 日本のアスファルト路面マイクロバイブレーション（平坦コライダー上の滑らかな走行と、視覚的凸凹の体感を両立）
    const now = performance.now();
    const speedRatio = Math.min(state.speedKmh / 100.0, 1.5);
    const engineRumble = Math.sin(now * 0.04) * 0.0015;
    // 骨材・クラック・パッチワーク通過による高周波・微細揺れ
    const asphaltJitterY =
      (Math.sin(now * 0.08) * 0.5 + Math.cos(now * 0.13) * 0.5) * 0.0025 * speedRatio;
    const asphaltJitterX = Math.sin(now * 0.05) * 0.0012 * speedRatio;

    eyeWorld.y += engineRumble + asphaltJitterY;
    eyeWorld.x += asphaltJitterX;

    this.camera.position.copy(eyeWorld);

    // 車両の前方を見据えるターゲット点
    const lookLocal = new THREE.Vector3(0.38 - state.steeringAngle * 0.2, 1.15, 20.0);
    const lookWorld = lookLocal.applyMatrix4(carGroup.matrixWorld);
    this.camera.lookAt(lookWorld);
  }

  private updateChaseCamera(dt: number, state: VehicleState, _carGroup: THREE.Group): void {
    const carPos = new THREE.Vector3(state.position.x, state.position.y, state.position.z);

    // 車両後方オフセット
    const chaseOffset = new THREE.Vector3(0, 2.6, -6.5);
    const heading = state.headingAngle;
    chaseOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), heading);

    const targetPos = carPos.clone().add(chaseOffset);

    // スムーズな補間
    const lerpRate = Math.min(dt * 6.0, 1.0);
    this.currentCameraPos.lerp(targetPos, lerpRate);
    this.camera.position.copy(this.currentCameraPos);

    // 注視点は車体中心より少し前方
    const lookTarget = carPos.clone().add(new THREE.Vector3(0, 1.2, 0));
    const forwardOffset = new THREE.Vector3(0, 0, 4.0).applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      heading,
    );
    lookTarget.add(forwardOffset);

    this.currentTarget.lerp(lookTarget, lerpRate);
    this.camera.lookAt(this.currentTarget);
  }

  public onResize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}

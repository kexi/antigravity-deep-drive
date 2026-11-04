import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import type { RoadSurfaceCondition, VehicleInput, VehicleState, WheelTelemetry } from "../types";

/**
 * 車両物理コントローラー
 * Rapier 3D 物理エンジンライブラリの公式 `DynamicRayCastVehicleController` を用いた
 * 4輪レイキャストサスペンション・タイヤスリップ・コーナリング摩擦・駆動・制動シミュレーション
 */
export class VehiclePhysics {
  public rigidBody: RAPIER.RigidBody;
  public collider: RAPIER.Collider;
  public vehicleController: RAPIER.DynamicRayCastVehicleController;
  private rapier: typeof RAPIER;

  private currentSteer = 0;
  private currentSpeedKmh = 0;
  private engineRpm = 800;
  private gear = "D 1";
  private roadSurfaceCondition: RoadSurfaceCondition = "wet";
  private smoothedVisualY = 0.0;
  private hasInitializedVisualFilter = false;
  private smoothedQuat = new THREE.Quaternion();
  private obstacleColliderHandleSet = new Set<number>();

  // 4輪レイキャストサスペンション・タイヤ仕様
  public readonly wheelRadius = 0.38;
  public readonly suspensionRestLength = 0.32;
  private readonly maxEngineForce = 6800;
  private readonly maxBrakeForce = 180;
  private readonly maxSteerAngle = 0.52; // ラジアン (約30度)
  private readonly steerSpeed = 4.5;

  // シャシーローカル座標における4輪のサスペンション接続点 (Front-Left, Front-Right, Rear-Left, Rear-Right)
  private readonly wheelSpecs = [
    { x: -0.88, y: -0.08, z: 1.38, isFront: true },
    { x: 0.88, y: -0.08, z: 1.38, isFront: true },
    { x: -0.88, y: -0.08, z: -1.38, isFront: false },
    { x: 0.88, y: -0.08, z: -1.38, isFront: false },
  ];

  constructor(world: RAPIER.World, rapier: typeof RAPIER, startPos: THREE.Vector3) {
    this.rapier = rapier;

    // 1. 車両シャシーの動的剛体を作成（クラウン セダンの電子制御 AVS フラットライド特性に合わせ回転減衰を強化、CCDで高速衝突時のすり抜けを防止）
    const bodyDesc = rapier.RigidBodyDesc.dynamic()
      .setTranslation(startPos.x, startPos.y, startPos.z)
      .setLinearDamping(0.22)
      .setAngularDamping(3.8)
      .setCcdEnabled(true)
      .setCanSleep(false);

    this.rigidBody = world.createRigidBody(bodyDesc);

    // 2. シャシーコライダー（サスペンションストロークを確保しつつ、高さ0.85mのボラード・ガードレール・街路樹・標識柱に確実に衝突するよう配置）
    // Why not: コライダー下端をタイヤ接地面まで下げると、サスペンション圧縮時にシャシー自身が地面と衝突して跳ねるため、
    // 地面からは十分なクリアランスを確保しつつ、実車（クラウン セダン 全長4.72m × 全幅1.84m）の外形に合わせて設定する
    const halfWidth = 0.88;
    const halfHeight = 0.38;
    const halfLength = 2.26;
    const colliderDesc = rapier.ColliderDesc.cuboid(halfWidth, halfHeight, halfLength)
      .setTranslation(0.0, 0.24, 0.0)
      .setMass(1450.0) // スポーツセダン総重量 1,450kg
      .setFriction(0.32)
      .setRestitution(0.12);

    this.collider = world.createCollider(colliderDesc, this.rigidBody);

    // 3. Rapier 公式の DynamicRayCastVehicleController を生成
    this.vehicleController = world.createVehicleController(this.rigidBody);
    this.vehicleController.indexUpAxis = 1; // Y軸 = Up
    this.vehicleController.setIndexForwardAxis = 2; // Z軸 = Forward

    // 4. 4輪のレイキャストサスペンションとタイヤ摩擦モデルを登録
    const suspensionDirection = new rapier.Vector3(0, -1, 0);
    const axleDirection = new rapier.Vector3(-1, 0, 0);

    for (let i = 0; i < this.wheelSpecs.length; i++) {
      const spec = this.wheelSpecs[i];
      const connectionPoint = new rapier.Vector3(spec.x, spec.y, spec.z);

      this.vehicleController.addWheel(
        connectionPoint,
        suspensionDirection,
        axleDirection,
        this.suspensionRestLength,
        this.wheelRadius,
      );

      // サスペンションバネ定数・減衰力・トラベル量・タイヤグリップの設定（高減衰 AVS でピッチ・ロールの微細振動を抑制）
      this.vehicleController.setWheelSuspensionStiffness(i, 42.0);
      this.vehicleController.setWheelSuspensionCompression(i, 6.4);
      this.vehicleController.setWheelSuspensionRelaxation(i, 7.2);
      this.vehicleController.setWheelMaxSuspensionTravel(i, 0.22);
      this.vehicleController.setWheelMaxSuspensionForce(i, 15000.0);
      this.vehicleController.setWheelFrictionSlip(i, 3.6);
      this.vehicleController.setWheelSideFrictionStiffness(i, 2.4);
    }
  }

  /**
   * 垂直障害物（ビル・ガードレール・ボラード・街路樹・街灯・標識支柱・石垣等）のコライダーハンドルを登録し、
   * 4輪サスペンションの下向きレイキャストから除外する。
   * Why not 障害物もサスペンションレイキャスト対象に含めるか:
   * ガードレールやボラード・木に側面接触した際、ホイールのレイが障害物の上端から下向きに発射されて
   * 障害物上面を「高さ 0.85m〜3m の地面」と誤認し、強烈なサスペンション反力で車体が空中に跳ね上がるため。
   */
  public setObstacleColliderHandles(handles: Iterable<number>): void {
    this.obstacleColliderHandleSet = new Set(handles);
  }

  /**
   * 路面状態（乾燥 `dry` / 雨上がり・湿潤 `wet` / 水たまり `puddle`）に応じて4輪の摩擦係数を更新する。
   */
  public setRoadSurfaceCondition(surface: RoadSurfaceCondition): void {
    this.roadSurfaceCondition = surface;
    const isDry = surface === "dry";
    const isPuddle = surface === "puddle";
    const frictionSlip = isDry ? 4.1 : isPuddle ? 2.85 : 3.45;
    const sideStiffness = isDry ? 2.65 : isPuddle ? 1.95 : 2.3;

    const numWheels = this.vehicleController.numWheels();
    for (let i = 0; i < numWheels; i++) {
      this.vehicleController.setWheelFrictionSlip(i, frictionSlip);
      this.vehicleController.setWheelSideFrictionStiffness(i, sideStiffness);
    }
  }

  public update(dt: number, input: VehicleInput): void {
    const isDtValid = dt > 0 && dt < 0.1;
    if (!isDtValid) {
      return;
    }

    const transform = this.rigidBody.translation();
    const rotation = this.rigidBody.rotation();
    const linvel = this.rigidBody.linvel();

    const q = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const currentVelocity = new THREE.Vector3(linvel.x, linvel.y, linvel.z);
    const forwardSpeed = currentVelocity.dot(forward);

    // 1. 車速に応じたステアリング角の補間（高速域での過敏な旋回を抑制）
    const speedRatio = Math.min(this.currentSpeedKmh / 140.0, 1.0);
    const targetMaxSteer = this.maxSteerAngle * (1.0 - speedRatio * 0.55);
    // 左旋回(input.steer < 0)で+Y軸周り左向きになるよう符号を合わせる
    const targetSteer = -input.steer * targetMaxSteer;
    this.currentSteer = THREE.MathUtils.lerp(
      this.currentSteer,
      targetSteer,
      Math.min(1.0, this.steerSpeed * dt),
    );

    // 2. エンジン駆動力・後退・ブレーキ力の算出
    let engineForce = 0;
    let wheelBrake = 0;

    const isPressingThrottle = input.throttle > 0;
    if (isPressingThrottle) {
      const powerCurve = Math.max(0.2, 1.0 - this.currentSpeedKmh / 185.0);
      engineForce = input.throttle * this.maxEngineForce * powerCurve;
    }

    const isPressingBrake = input.brake > 0;
    if (isPressingBrake) {
      const isMovingForward = forwardSpeed > 0.6;
      if (isMovingForward) {
        wheelBrake = input.brake * this.maxBrakeForce;
      } else {
        // 停止中または後退中はリバースギア駆動
        engineForce = -input.brake * this.maxEngineForce * 0.55;
      }
    }

    // アクセルもブレーキも踏んでいない場合はエンジンブレーキを軽く効かせる
    const isCoasting = !isPressingThrottle && !isPressingBrake;
    if (isCoasting) {
      wheelBrake = 6.5;
    }

    const isHandbrakeEngaged = input.handbrake;

    // 3. DynamicRayCastVehicleController の全4輪へ操舵・駆動・制動・ドリフト摩擦を適用
    const numWheels = this.vehicleController.numWheels();
    for (let i = 0; i < numWheels; i++) {
      const isFront = this.wheelSpecs[i].isFront;
      this.vehicleController.setWheelSteering(i, isFront ? this.currentSteer : 0);

      // AWD（前輪40% : 後輪60% トルク配分）による安定した加速性能
      const torqueSplit = isFront ? 0.42 : 0.58;
      this.vehicleController.setWheelEngineForce(
        i,
        isHandbrakeEngaged && !isFront ? 0 : engineForce * torqueSplit,
      );

      // ハンドブレーキ時は後輪を強力にロックし、横グリップを下げてテールスライドを誘発
      const rearHandbrake = !isFront && isHandbrakeEngaged ? this.maxBrakeForce * 2.2 : 0;
      this.vehicleController.setWheelBrake(i, wheelBrake + rearHandbrake);

      const isDry = this.roadSurfaceCondition === "dry";
      const isPuddle = this.roadSurfaceCondition === "puddle";
      const baseSideFriction = isDry ? 2.65 : isPuddle ? 1.95 : 2.3;
      const sideFriction = !isFront && isHandbrakeEngaged ? 0.65 : baseSideFriction;
      this.vehicleController.setWheelSideFrictionStiffness(i, sideFriction);
    }

    // 4. Rapier 車両物理コントローラーのステップ実行（自車シャシーおよび垂直障害物コライダーをレイキャストから除外）
    const chassisColliderHandle = this.collider.handle;
    this.vehicleController.updateVehicle(dt, undefined, undefined, (collider) => {
      const isSelfChassis = collider.handle === chassisColliderHandle;
      if (isSelfChassis) {
        return false;
      }
      const isRegisteredObstacle = this.obstacleColliderHandleSet.has(collider.handle);
      if (isRegisteredObstacle) {
        return false;
      }
      // 車道(y=-0.25)・歩道(y=0.075)・広域地面(y=-0.5)より高い位置にある垂直構造物（y > 0.20）は車輪レイキャストから除外し、シャシー剛体衝突のみで受け止める
      const hasTranslation = typeof collider.translation === "function";
      if (hasTranslation) {
        const colPos = collider.translation();
        const isElevatedStructure = colPos.y > 0.2;
        if (isElevatedStructure) {
          return false;
        }
      }
      return true;
    });

    // 5. 高速走行時のエアロダウンフォースと転倒防止アンチロールスタビライザー
    const controllerForwardSpeed = this.vehicleController.currentVehicleSpeed();
    const measuredForwardSpeed = Number.isFinite(controllerForwardSpeed)
      ? controllerForwardSpeed
      : forwardSpeed;
    this.currentSpeedKmh = Math.abs(measuredForwardSpeed) * 3.6;

    const downforce = this.currentSpeedKmh * 1.4 * dt;
    this.rigidBody.applyImpulse(new this.rapier.Vector3(0, -downforce, 0), true);

    const uprightDot = up.y;
    const isTilted = uprightDot < 0.96;
    if (isTilted) {
      const correctiveTorque = new THREE.Vector3(0, 1, 0).cross(up).multiplyScalar(-95.0 * dt);
      this.rigidBody.applyTorqueImpulse(
        new this.rapier.Vector3(correctiveTorque.x, correctiveTorque.y, correctiveTorque.z),
        true,
      );
    }

    // 6. ギア・エンジンRPM更新
    this.updateGearAndRpm(measuredForwardSpeed);

    // 7. コース外落下時の安全リセット（車線境界線ではなく各エリアの走行車線中央へ復帰）
    const isFallenOutOfBounds = transform.y < -10.0;
    if (isFallenOutOfBounds) {
      const isInShibuyaZone = transform.x < -550;
      const safeSpawn = isInShibuyaZone
        ? new THREE.Vector3(-744.75, 1.0, -70.0)
        : new THREE.Vector3(1.75, 1.0, 26.0);
      this.resetPosition(safeSpawn, 0);
    }
  }

  private updateGearAndRpm(speed: number): void {
    const isReverse = speed < -0.25;
    if (isReverse) {
      this.gear = "R";
      this.engineRpm = Math.min(5000, 800 + Math.abs(speed) * 200);
      return;
    }

    const kmh = this.currentSpeedKmh;
    const isFirstGear = kmh < 30;
    if (isFirstGear) {
      this.gear = "D 1";
      this.engineRpm = 900 + (kmh / 30) * 3500;
      return;
    }

    const isSecondGear = kmh < 60;
    if (isSecondGear) {
      this.gear = "D 2";
      this.engineRpm = 2000 + ((kmh - 30) / 30) * 3200;
      return;
    }

    const isThirdGear = kmh < 95;
    if (isThirdGear) {
      this.gear = "D 3";
      this.engineRpm = 2200 + ((kmh - 60) / 35) * 3000;
      return;
    }

    this.gear = "D 4";
    this.engineRpm = 2400 + Math.min(3600, ((kmh - 95) / 50) * 2800);
  }

  public resetPosition(pos: THREE.Vector3, yawRadians = 0): void {
    const halfYaw = yawRadians * 0.5;
    const quatY = Math.sin(halfYaw);
    const quatW = Math.cos(halfYaw);
    this.rigidBody.setTranslation(new this.rapier.Vector3(pos.x, pos.y, pos.z), true);
    this.rigidBody.setRotation(new this.rapier.Quaternion(0, quatY, 0, quatW), true);
    this.rigidBody.setLinvel(new this.rapier.Vector3(0, 0, 0), true);
    this.rigidBody.setAngvel(new this.rapier.Vector3(0, 0, 0), true);
    this.currentSteer = 0;
    this.currentSpeedKmh = 0;
    this.hasInitializedVisualFilter = false;

    const numWheels = this.vehicleController.numWheels();
    for (let i = 0; i < numWheels; i++) {
      this.vehicleController.setWheelEngineForce(i, 0);
      this.vehicleController.setWheelBrake(i, 0);
      this.vehicleController.setWheelSteering(i, 0);
    }
  }

  public getState(): VehicleState {
    const pos = this.rigidBody.translation();
    const vel = this.rigidBody.linvel();
    const rot = this.rigidBody.rotation();
    const rawQuat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);

    // 物理ステップ（衝突応答解決）後の実測水平速度でスピードメーター表示値を同期する
    // Why not update() 時点の currentVehicleSpeed() をそのまま返すか:
    // update() は world.step() の前に呼ばれるため、壁や障害物に衝突して剛体が停止した直後でも
    // 物理ステップ後の実際の速度減衰が即座に currentSpeedKmh に反映されるようにする。
    const postStepHorizontalSpeedMs = Math.hypot(vel.x, vel.z);
    const postStepSpeedKmh = postStepHorizontalSpeedMs * 3.6;
    const isStoppedOrSlowedByCollision = postStepSpeedKmh < this.currentSpeedKmh;
    if (isStoppedOrSlowedByCollision) {
      this.currentSpeedKmh = postStepSpeedKmh;
    }

    // タイヤ接地面（y=0）と車体底面（wheelRadius=0.38）が視覚的に一致するよう垂直オフセットを算出
    const rawVisualY = Math.max(0.0, pos.y - (this.wheelRadius + this.suspensionRestLength - 0.08));

    // 可変フレームレート時のレイキャストサスペンション微小振動を平滑化（クラウンのフラットライド姿勢制御）
    if (!this.hasInitializedVisualFilter) {
      this.smoothedVisualY = rawVisualY;
      this.smoothedQuat.copy(rawQuat);
      this.hasInitializedVisualFilter = true;
    } else {
      this.smoothedVisualY = THREE.MathUtils.lerp(this.smoothedVisualY, rawVisualY, 0.25);
      this.smoothedQuat.slerp(rawQuat, 0.32);
    }

    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.smoothedQuat);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.smoothedQuat);
    const heading = Math.atan2(forward.x, forward.z);
    const pitchAngle = Math.asin(THREE.MathUtils.clamp(forward.y, -1.0, 1.0));
    const rollAngle = Math.asin(THREE.MathUtils.clamp(-right.y, -1.0, 1.0));

    const wheels: WheelTelemetry[] = [];
    const numWheels = this.vehicleController.numWheels();
    for (let i = 0; i < numWheels; i++) {
      wheels.push({
        suspensionLength:
          this.vehicleController.wheelSuspensionLength(i) ?? this.suspensionRestLength,
        inContact: this.vehicleController.wheelIsInContact(i),
        rotation: this.vehicleController.wheelRotation(i) ?? 0,
        steering: this.vehicleController.wheelSteering(i) ?? 0,
      });
    }

    return {
      speedKmh: this.currentSpeedKmh,
      engineRpm: this.engineRpm,
      gear: this.gear,
      position: { x: pos.x, y: this.smoothedVisualY, z: pos.z },
      quaternion: {
        x: this.smoothedQuat.x,
        y: this.smoothedQuat.y,
        z: this.smoothedQuat.z,
        w: this.smoothedQuat.w,
      },
      velocity: { x: vel.x, y: vel.y, z: vel.z },
      headingAngle: heading,
      // UI・ステアリングホイール表示用に右旋回=正の符号に戻す
      steeringAngle: -this.currentSteer,
      pitchAngle,
      rollAngle,
      wheels,
    };
  }
}

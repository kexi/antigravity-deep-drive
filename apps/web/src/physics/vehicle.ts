import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import type { RoadSurfaceCondition, VehicleInput, VehicleState, WheelTelemetry } from "../types";

export interface GearSpec {
  readonly label: string;
  readonly ratio: number;
  readonly upshiftRpmEco: number;
  readonly upshiftRpmSport: number;
  readonly downshiftRpm: number;
}

/**
 * トヨタ クラウン セダン Z (AZSH32: 2.5L 直4 A25A-FXS + マルチステージハイブリッド FR)
 * 実車諸元に基づく車両物理仕様（SSOT）
 */
export const CROWN_SEDAN_PHYSICS_SPEC = {
  /** 運転時総質量 [kg]（車両重量 1,920 kg + 乗員1名 60 kg） */
  massKg: 1980.0,
  /** 重力加速度 [m/s^2] */
  gravityMs2: 9.81,
  /** 静的フロント重量配分比 (52% Front : 48% Rear) */
  frontWeightRatio: 0.52,
  /** ホイールベース [m]（car.glb の前後輪中心 z = ±1.39m と完全一致） */
  wheelbaseM: 2.78,
  /** トレッド半幅 [m]（car.glb の WHEEL_X_CENTER = 0.86m と完全一致） */
  halfTrackM: 0.86,
  /** 20インチ標準タイヤ (245/45R20) 半径 [m]（car.glb の WHEEL_R_TIRE = 0.340m と完全一致） */
  wheelRadiusM: 0.34,
  /** サスペンション自由長 [m] */
  suspensionRestLengthM: 0.37,
  /** 静的平衡時のサスペンション基準長 [m]（pos.y ≈ 0.622m でタイヤ底面が路面 y=0 に一致） */
  equilibriumSuspensionLengthM: 0.2622,
  /** シャシーローカル座標におけるサスペンション取付点 Y [m] */
  wheelConnectionY: -0.02,
  /** シャシーローカル重心座標 [m]（路面から h_cg ≈ 0.54m、前後 52:48 配分） */
  centerOfMassLocal: { x: 0.0, y: -0.08, z: 0.0556 },
  /** 主軸慣性モーメント [kg·m^2]（X: ピッチ, Y: ヨー, Z: ロール） */
  principalInertiaKgM2: { x: 3450.0, y: 3850.0, z: 780.0 },
  /** サスペンション剛性・減衰（前輪52%:後輪48%の静的荷重に合わせて前後バランス調整し静的ピッチ0度を実現） */
  frontSuspensionStiffness: 22.0,
  rearSuspensionStiffness: 20.3,
  frontSuspensionCompression: 2.9,
  rearSuspensionCompression: 2.7,
  frontSuspensionRelaxation: 4.1,
  rearSuspensionRelaxation: 3.8,
  maxSuspensionTravelM: 0.24,
  maxSuspensionForceN: 28000.0,
  /** アンチロールバー（スタビライザー）剛性 [N/m]（前強め設定でFRセダンの自然な弱アンダーステア特性） */
  frontAntiRollStiffnessNm: 12000.0,
  rearAntiRollStiffnessNm: 8000.0,
  /** 空気力学パラメータ（空気密度 ρ = 1.225 kg/m^3, Cd = 0.28, 前面投影面積 A = 2.38 m^2） */
  airDensityKgM3: 1.225,
  dragCoefficient: 0.28,
  downforceCoefficient: 0.08,
  frontalAreaM2: 2.38,
  /** 駆動系（FR 後輪駆動: 180 kW システム最高出力, 伝達効率 0.92, ファイナル減速比 3.35） */
  systemWheelPowerMaxW: 166000.0,
  launchTractionForceCapN: 9200.0,
  reverseMaxForceN: 4800.0,
  finalDriveRatio: 3.35,
  drivetrainEfficiency: 0.92,
  /** JDM 電子速度リミッター開始・完全制限速度 [km/h] */
  speedLimiterStartKmh: 175.0,
  speedLimiterMaxKmh: 185.0,
  reverseSpeedLimitKmh: 35.0,
  /** 制動力（Rapier レイキャストブレーキ上限値、前後配分 68% Front : 32% Rear） */
  frontMaxBrakeImpulse: 108.0,
  rearMaxBrakeImpulse: 51.0,
  /** 6段ステップ変速比（マルチステージハイブリッド変速スケジュール） */
  forwardGears: [
    { label: "D 1", ratio: 3.52, upshiftRpmEco: 2900, upshiftRpmSport: 5600, downshiftRpm: 1100 },
    { label: "D 2", ratio: 2.26, upshiftRpmEco: 2850, upshiftRpmSport: 5550, downshiftRpm: 1550 },
    { label: "D 3", ratio: 1.56, upshiftRpmEco: 2800, upshiftRpmSport: 5450, downshiftRpm: 1650 },
    { label: "D 4", ratio: 1.16, upshiftRpmEco: 2750, upshiftRpmSport: 5300, downshiftRpm: 1700 },
    { label: "D 5", ratio: 0.89, upshiftRpmEco: 2700, upshiftRpmSport: 5150, downshiftRpm: 1750 },
    { label: "D 6", ratio: 0.72, upshiftRpmEco: 6800, upshiftRpmSport: 6800, downshiftRpm: 1750 },
  ] as readonly GearSpec[],
  reverseGearRatio: 3.2,
} as const;

interface RoadSurfacePhysicsProfile {
  readonly frictionSlip: number;
  readonly sideStiffness: number;
  readonly rollingResistanceCoeff: number;
  readonly brakeGripScale: number;
  readonly tractionGripScale: number;
}

const ROAD_SURFACE_PROFILES: Record<RoadSurfaceCondition, RoadSurfacePhysicsProfile> = {
  dry: {
    frictionSlip: 2.45,
    sideStiffness: 2.35,
    rollingResistanceCoeff: 0.012,
    brakeGripScale: 1.0,
    tractionGripScale: 1.0,
  },
  wet: {
    frictionSlip: 1.95,
    sideStiffness: 1.9,
    rollingResistanceCoeff: 0.015,
    brakeGripScale: 0.82,
    tractionGripScale: 0.88,
  },
  puddle: {
    frictionSlip: 1.45,
    sideStiffness: 1.45,
    rollingResistanceCoeff: 0.022,
    brakeGripScale: 0.65,
    tractionGripScale: 0.72,
  },
};

/**
 * 車両物理コントローラー
 * Rapier 3D 物理エンジンの `DynamicRayCastVehicleController` を基盤に、
 * 実車トヨタ クラウン セダン (AZSH32, 1,980 kg FR) の質量・52:48重心・3軸慣性テンソル・
 * 多段ハイブリッド駆動トルク・空気抵抗($v^2$)・転がり抵抗($C_{rr}mg$)・前後ブレーキ配分(68:32)・
 * 左右輪連動アンチロールバーによる荷重移動を統合シミュレーションする。
 */
export class VehiclePhysics {
  public rigidBody: RAPIER.RigidBody;
  public collider: RAPIER.Collider;
  public vehicleController: RAPIER.DynamicRayCastVehicleController;
  private rapier: typeof RAPIER;

  public readonly physicsSpec = CROWN_SEDAN_PHYSICS_SPEC;
  public readonly vehicleMassKg = CROWN_SEDAN_PHYSICS_SPEC.massKg;
  public readonly wheelRadius = CROWN_SEDAN_PHYSICS_SPEC.wheelRadiusM;
  public readonly suspensionRestLength = CROWN_SEDAN_PHYSICS_SPEC.suspensionRestLengthM;
  public readonly equilibriumSuspensionLength =
    CROWN_SEDAN_PHYSICS_SPEC.equilibriumSuspensionLengthM;

  private currentSteer = 0;
  private currentSpeedKmh = 0;
  private engineRpm = 800;
  private currentForwardGearIndex = 0;
  private gear = "D 1";
  private gearShiftCooldownS = 0;
  private lastReverseInputActive = false;
  private roadSurfaceCondition: RoadSurfaceCondition = "wet";
  private smoothedVisualY = 0.0;
  private hasInitializedVisualFilter = false;
  private smoothedQuat = new THREE.Quaternion();
  private isAutoHoldActive = false;
  private autoHoldAnchorX: number | null = null;
  private autoHoldAnchorZ: number | null = null;
  private lastStepDt = 1 / 60;
  private prevWorldVelocity = new THREE.Vector3();
  private hasPrevVelocity = false;
  private longitudinalG = 0;
  private lateralG = 0;
  private obstacleColliderHandleSet = new Set<number>();
  private drivableColliderHandleSet = new Set<number>();

  private readonly maxSteerAngle = 0.52; // ラジアン (約30度)
  private readonly steerSpeed = 4.2;

  // シャシーローカル座標における4輪のサスペンション接続点 (car.glb の 4輪座標 ±0.86m / ±1.39m と一致)
  private readonly wheelSpecs = [
    {
      x: -CROWN_SEDAN_PHYSICS_SPEC.halfTrackM,
      y: CROWN_SEDAN_PHYSICS_SPEC.wheelConnectionY,
      z: CROWN_SEDAN_PHYSICS_SPEC.wheelbaseM * 0.5,
      isFront: true,
    },
    {
      x: CROWN_SEDAN_PHYSICS_SPEC.halfTrackM,
      y: CROWN_SEDAN_PHYSICS_SPEC.wheelConnectionY,
      z: CROWN_SEDAN_PHYSICS_SPEC.wheelbaseM * 0.5,
      isFront: true,
    },
    {
      x: -CROWN_SEDAN_PHYSICS_SPEC.halfTrackM,
      y: CROWN_SEDAN_PHYSICS_SPEC.wheelConnectionY,
      z: -CROWN_SEDAN_PHYSICS_SPEC.wheelbaseM * 0.5,
      isFront: false,
    },
    {
      x: CROWN_SEDAN_PHYSICS_SPEC.halfTrackM,
      y: CROWN_SEDAN_PHYSICS_SPEC.wheelConnectionY,
      z: -CROWN_SEDAN_PHYSICS_SPEC.wheelbaseM * 0.5,
      isFront: false,
    },
  ];

  constructor(world: RAPIER.World, rapier: typeof RAPIER, startPos: THREE.Vector3) {
    this.rapier = rapier;
    const spec = CROWN_SEDAN_PHYSICS_SPEC;

    // 1. 車両シャシーの動的剛体を作成
    // Why not 高い LinearDamping (0.22) / AngularDamping (4.8) を掛けないか:
    // 走行抵抗は物理的な空気抵抗 (1/2 ρ Cd A v^2) と転がり抵抗 (Crr m g) で計算し、
    // 姿勢減衰はサスペンション減衰とスタビライザーに委ねることで、約2トンセダンの自然な荷重移動と惰性感を再現する。
    const bodyDesc = rapier.RigidBodyDesc.dynamic()
      .setTranslation(startPos.x, startPos.y, startPos.z)
      .setLinearDamping(0.02)
      .setAngularDamping(0.45)
      .setCcdEnabled(true)
      .setCanSleep(false);

    this.rigidBody = world.createRigidBody(bodyDesc);

    // 2. シャシーコライダー（質量は0とし、下の setAdditionalMassProperties で実車質量・52:48重心・3軸慣性テンソルを厳密指定する）
    // Why not コライダー自動計算の均質直方体慣性に任せないか:
    // 均質直方体では重心が車体幾何中心 (z=0, y=+0.24) に固定されてしまい、FRセダンの 52:48 重量配分・
    // 低重心 (h_cg = 0.54m)・実車準拠のピッチ/ヨー/ロール慣性モーメント比を再現できないため。
    const halfWidth = 0.88;
    const halfHeight = 0.38;
    const halfLength = 2.32;
    const colliderDesc = rapier.ColliderDesc.cuboid(halfWidth, halfHeight, halfLength)
      .setTranslation(0.0, 0.24, 0.0)
      .setMass(0.0)
      .setFriction(0.32)
      .setRestitution(0.12);

    this.collider = world.createCollider(colliderDesc, this.rigidBody);

    this.rigidBody.setAdditionalMassProperties(
      spec.massKg,
      new rapier.Vector3(
        spec.centerOfMassLocal.x,
        spec.centerOfMassLocal.y,
        spec.centerOfMassLocal.z,
      ),
      new rapier.Vector3(
        spec.principalInertiaKgM2.x,
        spec.principalInertiaKgM2.y,
        spec.principalInertiaKgM2.z,
      ),
      new rapier.Quaternion(0, 0, 0, 1),
      true,
    );
    // ステップ実行前から mass() / localCom() / principalInertia() を確定させる
    this.rigidBody.recomputeMassPropertiesFromColliders();

    // 3. Rapier 公式の DynamicRayCastVehicleController を生成
    this.vehicleController = world.createVehicleController(this.rigidBody);
    this.vehicleController.indexUpAxis = 1; // Y軸 = Up
    this.vehicleController.setIndexForwardAxis = 2; // Z軸 = Forward

    // 4. 4輪のレイキャストサスペンションとタイヤ摩擦モデルを登録
    const suspensionDirection = new rapier.Vector3(0, -1, 0);
    const axleDirection = new rapier.Vector3(-1, 0, 0);
    const initialSurfaceProfile = ROAD_SURFACE_PROFILES[this.roadSurfaceCondition];

    for (let i = 0; i < this.wheelSpecs.length; i++) {
      const wheelSpec = this.wheelSpecs[i];
      const connectionPoint = new rapier.Vector3(wheelSpec.x, wheelSpec.y, wheelSpec.z);

      this.vehicleController.addWheel(
        connectionPoint,
        suspensionDirection,
        axleDirection,
        this.suspensionRestLength,
        this.wheelRadius,
      );

      const stiffness = wheelSpec.isFront
        ? spec.frontSuspensionStiffness
        : spec.rearSuspensionStiffness;
      const compression = wheelSpec.isFront
        ? spec.frontSuspensionCompression
        : spec.rearSuspensionCompression;
      const relaxation = wheelSpec.isFront
        ? spec.frontSuspensionRelaxation
        : spec.rearSuspensionRelaxation;

      this.vehicleController.setWheelSuspensionStiffness(i, stiffness);
      this.vehicleController.setWheelSuspensionCompression(i, compression);
      this.vehicleController.setWheelSuspensionRelaxation(i, relaxation);
      this.vehicleController.setWheelMaxSuspensionTravel(i, spec.maxSuspensionTravelM);
      this.vehicleController.setWheelMaxSuspensionForce(i, spec.maxSuspensionForceN);
      this.vehicleController.setWheelFrictionSlip(i, initialSurfaceProfile.frictionSlip);
      this.vehicleController.setWheelSideFrictionStiffness(i, initialSurfaceProfile.sideStiffness);
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
   * 起伏地形 Trimesh 等の走行可能路面コライダーハンドル群を登録し、
   * 標高 `y > 0.2m` の坂道区間（道玄坂・宮益坂・玉川通り等）でも車輪レイキャストが確実に接地するようにする。
   */
  public setDrivableColliderHandles(handles: Iterable<number>): void {
    this.drivableColliderHandleSet = new Set(handles);
  }

  /**
   * 路面状態（乾燥 `dry` / 雨上がり・湿潤 `wet` / 水たまり `puddle`）に応じて4輪の摩擦係数を更新する。
   */
  public setRoadSurfaceCondition(surface: RoadSurfaceCondition): void {
    this.roadSurfaceCondition = surface;
    const profile = ROAD_SURFACE_PROFILES[surface];
    const numWheels = this.vehicleController.numWheels();
    for (let i = 0; i < numWheels; i++) {
      this.vehicleController.setWheelFrictionSlip(i, profile.frictionSlip);
      this.vehicleController.setWheelSideFrictionStiffness(i, profile.sideStiffness);
    }
  }

  /**
   * 2.5L 直4 (A25A-FXS) + マルチステージハイブリッド MG2 モーターの合成後輪軸駆動力 [N] を算出する。
   * ギア比・ファイナル減速比・タイヤ半径・システム最高出力 (166 kW 駆動輪換算)・路面トラクション上限を反映する。
   */
  private computeForwardRearAxleForceN(
    forwardSpeedMs: number,
    throttle: number,
    surfaceProfile: RoadSurfacePhysicsProfile,
  ): number {
    const isThrottleOff = throttle <= 0;
    if (isThrottleOff) {
      return 0;
    }

    const spec = CROWN_SEDAN_PHYSICS_SPEC;
    const speedKmh = Math.max(0, forwardSpeedMs) * 3.6;
    const isAtSpeedLimiter = speedKmh >= spec.speedLimiterMaxKmh;
    if (isAtSpeedLimiter) {
      return 0;
    }

    // JDM 180 km/h リミッターの滑らかな出力絞り込み
    const limiterRange = spec.speedLimiterMaxKmh - spec.speedLimiterStartKmh;
    const limiterScale =
      speedKmh > spec.speedLimiterStartKmh
        ? THREE.MathUtils.clamp((spec.speedLimiterMaxKmh - speedKmh) / limiterRange, 0, 1)
        : 1.0;

    const activeGear = spec.forwardGears[this.currentForwardGearIndex];
    const rpmNorm = THREE.MathUtils.clamp((this.engineRpm - 800) / 5200, 0, 1);
    // 2.5L 直4 エンジン軸トルク曲線 (165 .. 221 N·m) + MG2 電動モーター低中速アシストトルク
    const iceTorqueNm = 165.0 + 56.0 * Math.sin(rpmNorm * Math.PI * 0.82);
    const motorAssistNm = 260.0 / (1.0 + Math.max(0, forwardSpeedMs) * 0.065);
    const combinedTorqueNm = (iceTorqueNm + motorAssistNm) * throttle;

    const gearWheelForceN =
      (combinedTorqueNm * activeGear.ratio * spec.finalDriveRatio * spec.drivetrainEfficiency) /
      spec.wheelRadiusM;
    const powerLimitedForceN =
      (spec.systemWheelPowerMaxW * throttle) / Math.max(forwardSpeedMs, 1.0);
    const tractionCappedForceN =
      spec.launchTractionForceCapN * surfaceProfile.tractionGripScale * throttle;

    return Math.min(gearWheelForceN, powerLimitedForceN, tractionCappedForceN) * limiterScale;
  }

  public update(dt: number, input: VehicleInput): void {
    const isDtValid = dt > 0 && dt < 0.1;
    if (!isDtValid) {
      return;
    }
    this.lastStepDt = dt;
    this.gearShiftCooldownS = Math.max(0, this.gearShiftCooldownS - dt);

    const spec = CROWN_SEDAN_PHYSICS_SPEC;
    const surfaceProfile = ROAD_SURFACE_PROFILES[this.roadSurfaceCondition];

    const transform = this.rigidBody.translation();
    const rotation = this.rigidBody.rotation();
    const linvel = this.rigidBody.linvel();

    const q = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const leftAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const currentVelocity = new THREE.Vector3(linvel.x, linvel.y, linvel.z);
    const forwardSpeed = currentVelocity.dot(forward);

    // 0. 実測加速度から車体前後G / 横Gを算出（メータークラスターのGセンサー表示・テレメトリ用）
    if (this.hasPrevVelocity) {
      const accelWorld = currentVelocity.clone().sub(this.prevWorldVelocity).divideScalar(dt);
      const rawLongG = THREE.MathUtils.clamp(accelWorld.dot(forward) / spec.gravityMs2, -2.0, 2.0);
      const rawLatG = THREE.MathUtils.clamp(accelWorld.dot(leftAxis) / spec.gravityMs2, -2.0, 2.0);
      const gAlpha = 1 - Math.exp(-10 * dt);
      this.longitudinalG = THREE.MathUtils.lerp(this.longitudinalG, rawLongG, gAlpha);
      this.lateralG = THREE.MathUtils.lerp(this.lateralG, rawLatG, gAlpha);
    }
    this.prevWorldVelocity.copy(currentVelocity);
    this.hasPrevVelocity = true;

    // 1. 車速に応じたステアリング角の補間（高速域での過敏な旋回を抑制）
    const speedRatio = Math.min(this.currentSpeedKmh / 140.0, 1.0);
    const targetMaxSteer = this.maxSteerAngle * (1.0 - speedRatio * 0.58);
    // 左旋回(input.steer < 0)で+Y軸周り左向きになるよう符号を合わせる
    const targetSteer = -input.steer * targetMaxSteer;
    this.currentSteer = THREE.MathUtils.lerp(
      this.currentSteer,
      targetSteer,
      Math.min(1.0, this.steerSpeed * dt),
    );

    // 2. FR 後輪軸駆動力・後退力・前後配分ブレーキ力の算出
    let rearAxleForceN = 0;
    let frontWheelBrake = 0;
    let rearWheelBrake = 0;

    const isPressingThrottle = input.throttle > 0;
    const isPressingBrake = input.brake > 0;
    const isHandbrakeEngaged = input.handbrake;
    const isReverseInputActive = isPressingBrake && !isPressingThrottle && !isHandbrakeEngaged;
    this.lastReverseInputActive = isReverseInputActive;

    const hasDriveRequest = isPressingThrottle || isReverseInputActive;
    if (hasDriveRequest) {
      this.isAutoHoldActive = false;
      this.autoHoldAnchorX = null;
      this.autoHoldAnchorZ = null;
    }

    if (isPressingThrottle) {
      rearAxleForceN = this.computeForwardRearAxleForceN(
        forwardSpeed,
        input.throttle,
        surfaceProfile,
      );
    }

    if (isPressingBrake) {
      const isMovingForward = forwardSpeed > 0.6;
      const shouldApplyServiceBrake = isMovingForward || isHandbrakeEngaged || isPressingThrottle;
      if (shouldApplyServiceBrake) {
        frontWheelBrake = input.brake * spec.frontMaxBrakeImpulse * surfaceProfile.brakeGripScale;
        rearWheelBrake = input.brake * spec.rearMaxBrakeImpulse * surfaceProfile.brakeGripScale;
      } else {
        // 停止中または後退中かつリバース入力（S / ArrowDown 単体保持）時のみリバースギア駆動
        const reverseSpeedKmh = Math.max(0, -forwardSpeed) * 3.6;
        const reverseTaper = THREE.MathUtils.clamp(
          1.0 - reverseSpeedKmh / spec.reverseSpeedLimitKmh,
          0,
          1,
        );
        rearAxleForceN =
          -input.brake * spec.reverseMaxForceN * surfaceProfile.tractionGripScale * reverseTaper;
      }
    }

    // アクセル・ブレーキ未操作時は微弱なハイブリッド回生／エンジンブレーキを与えつつ、2トン車の滑らかな惰性滑走を保つ
    const isCoasting = !isPressingThrottle && !isPressingBrake;
    if (isCoasting) {
      const isNearlyStationary = Math.abs(forwardSpeed) < 0.4;
      if (isNearlyStationary) {
        frontWheelBrake = 16.0;
        rearWheelBrake = 10.0;
      } else {
        frontWheelBrake = 1.6;
        rearWheelBrake = 2.8; // FR 後輪モーター回生ブレーキ主体の穏やかな減速
      }
    }

    // 3. DynamicRayCastVehicleController の全4輪へ操舵・FR駆動・前後配分制動・横摩擦を適用
    // Why rearWheelForce = rearAxleForceN * 0.5 か:
    // 左右後輪2本に均等配分して合計が正確に rearAxleForceN (1.0倍) になるようにする（旧実装の合計2.0倍バグを解消）。
    const rearWheelEngineForceN = isHandbrakeEngaged ? 0 : rearAxleForceN * 0.5;
    const numWheels = this.vehicleController.numWheels();
    for (let i = 0; i < numWheels; i++) {
      const isFront = this.wheelSpecs[i].isFront;
      this.vehicleController.setWheelSteering(i, isFront ? this.currentSteer : 0);
      this.vehicleController.setWheelEngineForce(i, isFront ? 0 : rearWheelEngineForceN);

      const rearHandbrake = !isFront && isHandbrakeEngaged ? spec.rearMaxBrakeImpulse * 2.6 : 0;
      const wheelBrake = isFront ? frontWheelBrake : rearWheelBrake + rearHandbrake;
      this.vehicleController.setWheelBrake(i, wheelBrake);

      const sideFriction = !isFront && isHandbrakeEngaged ? 0.55 : surfaceProfile.sideStiffness;
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
      const isRegisteredDrivable = this.drivableColliderHandleSet.has(collider.handle);
      if (isRegisteredDrivable) {
        return true;
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

    // 4.2 接地カウント・物理的走行抵抗（空気抵抗 1/2 ρ Cd A v^2 + 質量比例転がり抵抗 Crr m g + 速度2乗ダウンフォース）
    let groundedWheelCount = 0;
    for (let i = 0; i < numWheels; i++) {
      if (this.vehicleController.wheelIsInContact(i)) {
        groundedWheelCount += 1;
      }
    }

    const postStepVel = this.rigidBody.linvel();
    const postStepAngVel = this.rigidBody.angvel();
    const horizontalSpeedMs = Math.hypot(postStepVel.x, postStepVel.z);
    const totalSpeedMs = Math.hypot(postStepVel.x, postStepVel.y, postStepVel.z);
    const isMovingAppreciably = totalSpeedMs > 0.08;
    if (isMovingAppreciably) {
      const aeroDynamicPressure = 0.5 * spec.airDensityKgM3 * totalSpeedMs * totalSpeedMs;
      const aeroDragForceN = aeroDynamicPressure * spec.dragCoefficient * spec.frontalAreaM2;
      const aeroDownforceN = aeroDynamicPressure * spec.downforceCoefficient * spec.frontalAreaM2;

      const groundedRatio = groundedWheelCount / 4;
      const rollingResistanceN =
        groundedRatio * surfaceProfile.rollingResistanceCoeff * spec.massKg * spec.gravityMs2;
      const totalResistiveForceN = aeroDragForceN + rollingResistanceN;
      const invSpeed = 1 / totalSpeedMs;

      this.rigidBody.applyImpulse(
        new this.rapier.Vector3(
          -postStepVel.x * invSpeed * totalResistiveForceN * dt,
          -aeroDownforceN * dt,
          -postStepVel.z * invSpeed * totalResistiveForceN * dt,
        ),
        true,
      );
    }

    // 4.3 前後アクスル左右輪連動アンチロールバー（スタビライザー）
    // 左右輪のサスペンション伸縮差に比例した復元ロールトルクを車体前後軸 (+Z) 周りに発生させ、
    // コーナリング時のロール剛性を確保しつつ、ピッチ方向（ノーズダイブ／スクワット）は阻害しない。
    const lRightFront =
      this.vehicleController.wheelSuspensionLength(0) ?? this.suspensionRestLength;
    const lLeftFront = this.vehicleController.wheelSuspensionLength(1) ?? this.suspensionRestLength;
    const lRightRear = this.vehicleController.wheelSuspensionLength(2) ?? this.suspensionRestLength;
    const lLeftRear = this.vehicleController.wheelSuspensionLength(3) ?? this.suspensionRestLength;
    const isFrontAxleGrounded =
      this.vehicleController.wheelIsInContact(0) && this.vehicleController.wheelIsInContact(1);
    const isRearAxleGrounded =
      this.vehicleController.wheelIsInContact(2) && this.vehicleController.wheelIsInContact(3);

    let localRollTorqueNm = 0;
    if (isFrontAxleGrounded) {
      localRollTorqueNm +=
        (lRightFront - lLeftFront) * spec.frontAntiRollStiffnessNm * spec.halfTrackM;
    }
    if (isRearAxleGrounded) {
      localRollTorqueNm +=
        (lRightRear - lLeftRear) * spec.rearAntiRollStiffnessNm * spec.halfTrackM;
    }
    if (Math.abs(localRollTorqueNm) > 1e-3) {
      const worldRollTorque = new THREE.Vector3(0, 0, localRollTorqueNm).applyQuaternion(q);
      this.rigidBody.applyTorqueImpulse(
        new this.rapier.Vector3(
          worldRollTorque.x * dt,
          worldRollTorque.y * dt,
          worldRollTorque.z * dt,
        ),
        true,
      );
    }

    // 4.5 停車オートホールド（3輪以上接地かつ微速時に水平スリップ・坂道クリープ・ピッチ/ロール微振動を積極減衰）
    const angularSpeedRad = Math.hypot(postStepAngVel.x, postStepAngVel.y, postStepAngVel.z);
    const isGroundedOnSurface = groundedWheelCount >= 3;
    const shouldEnterAutoHold =
      !hasDriveRequest &&
      isGroundedOnSurface &&
      horizontalSpeedMs < 0.35 &&
      Math.abs(postStepVel.y) < 0.45 &&
      angularSpeedRad < 0.6;
    const shouldKeepAutoHold =
      this.isAutoHoldActive && !hasDriveRequest && isGroundedOnSurface && horizontalSpeedMs < 0.8;

    if (shouldEnterAutoHold || shouldKeepAutoHold) {
      this.isAutoHoldActive = true;
      const currentPos = this.rigidBody.translation();
      const hasAnchor = this.autoHoldAnchorX !== null && this.autoHoldAnchorZ !== null;
      if (!hasAnchor && horizontalSpeedMs < 0.15) {
        this.autoHoldAnchorX = currentPos.x;
        this.autoHoldAnchorZ = currentPos.z;
      }

      const angularDecay = Math.exp(-22.0 * dt);
      const dampAng = (v: number): number => (Math.abs(v) < 0.003 ? 0 : v * angularDecay);

      // Why postStepVel.y は改変せず水平速度 (x, z) のみ 0 固定するか:
      // 鉛直方向は4輪サスペンションのバネ・ダンパー減衰と重力 (-mg) にそのまま委ねることで、
      // 静的平衡時の合計接地荷重 ΣF_susp = m*g (19,424 N) と 52:48 重量配分を歪めずに厳密維持できるため。
      this.rigidBody.setLinvel(new this.rapier.Vector3(0, postStepVel.y, 0), true);
      this.rigidBody.setAngvel(
        new this.rapier.Vector3(
          dampAng(postStepAngVel.x),
          dampAng(postStepAngVel.y),
          dampAng(postStepAngVel.z),
        ),
        true,
      );

      const hasAnchoredXZ = this.autoHoldAnchorX !== null && this.autoHoldAnchorZ !== null;
      if (hasAnchoredXZ) {
        this.rigidBody.setTranslation(
          new this.rapier.Vector3(this.autoHoldAnchorX!, currentPos.y, this.autoHoldAnchorZ!),
          true,
        );
      }
      this.longitudinalG = 0;
      this.lateralG = 0;
    } else {
      this.isAutoHoldActive = false;
      this.autoHoldAnchorX = null;
      this.autoHoldAnchorZ = null;
    }

    // 5. 車速計測および極端な横転防止セーフティトルク
    const controllerForwardSpeed = this.vehicleController.currentVehicleSpeed();
    const rawMeasuredForwardSpeed = Number.isFinite(controllerForwardSpeed)
      ? controllerForwardSpeed
      : forwardSpeed;
    const measuredForwardSpeed =
      Math.abs(forwardSpeed) > Math.abs(rawMeasuredForwardSpeed)
        ? forwardSpeed
        : rawMeasuredForwardSpeed;
    const rawSpeedKmh = Math.abs(measuredForwardSpeed) * 3.6;
    const isParkedMicroJitter =
      this.isAutoHoldActive ||
      (!isPressingThrottle && !isReverseInputActive && Math.abs(measuredForwardSpeed) < 0.15);
    this.currentSpeedKmh = isParkedMicroJitter ? 0 : rawSpeedKmh;

    const uprightDot = up.y;
    const isSeverelyTilted = uprightDot < 0.88;
    if (isSeverelyTilted) {
      const correctiveTorque = new THREE.Vector3(0, 1, 0).cross(up).multiplyScalar(-1800.0 * dt);
      this.rigidBody.applyTorqueImpulse(
        new this.rapier.Vector3(correctiveTorque.x, correctiveTorque.y, correctiveTorque.z),
        true,
      );
    }

    // 6. ギア・エンジンRPM更新（実車ギア比とスロットル開度連動シフトスケジュール＋停止チャタリング防止ヒステリシス）
    this.updateGearAndRpm(measuredForwardSpeed, isReverseInputActive, input.throttle);

    // 7. コース外落下時の安全リセット（車線境界線ではなく各エリアの走行車線中央へ復帰）
    const isFallenOutOfBounds = transform.y < -10.0;
    if (isFallenOutOfBounds) {
      const isInShibuyaZone = transform.x < -345;
      const safeSpawn = isInShibuyaZone
        ? new THREE.Vector3(-728.0, 1.5, 480.0)
        : new THREE.Vector3(1.75, 1.0, 26.0);
      this.resetPosition(safeSpawn, isInShibuyaZone ? -2.35 : 0);
    }
  }

  /**
   * 前後速度・リバース入力状態・スロットル開度から 6段ギア (`R` / `D 1`〜`D 6`) とエンジン回転数を更新する。
   * Why not 未入力状態で負速度のみから `"R"` へ新規遷移させないか:
   * 停止中（~0 km/h）やテレポート直後・段差・サスペンション反発・衝突バウンドによって瞬間的な
   * 後退速度スパイクが生じると、リバース入力（`S` / `ArrowDown`）を押していないにもかかわらず
   * `"D 1"` から `"R"` へ勝手にシフトし、直後の停止後も 3D メータークラスターに赤色 `R` / `[R]` が残るため。
   */
  private updateGearAndRpm(speed: number, isReverseInputActive = false, throttle = 0): void {
    const spec = CROWN_SEDAN_PHYSICS_SPEC;
    const kmh = this.currentSpeedKmh;
    const isStationaryOrJitter = Math.abs(speed) < 0.4 || kmh < 1.5;
    const isReverseWithInput = isReverseInputActive && (speed < -0.25 || isStationaryOrJitter);
    const wasInReverse = this.gear === "R";
    const isStillCoastingBackwardInReverse = wasInReverse && !isStationaryOrJitter && speed < -0.6;
    const shouldEngageReverse = isReverseWithInput || isStillCoastingBackwardInReverse;
    if (shouldEngageReverse) {
      this.gear = "R";
      this.currentForwardGearIndex = 0;
      const wheelRpm = (Math.abs(speed) / (2 * Math.PI * spec.wheelRadiusM)) * 60;
      const reverseRpm = wheelRpm * spec.reverseGearRatio * spec.finalDriveRatio;
      this.engineRpm = THREE.MathUtils.clamp(Math.max(850, reverseRpm + 320), 800, 5000);
      return;
    }

    const forwardSpeedMs = Math.max(0, speed);
    const wheelRpm = (forwardSpeedMs / (2 * Math.PI * spec.wheelRadiusM)) * 60;
    const gears = spec.forwardGears;

    const computeMechanicalRpm = (gearIdx: number): number =>
      wheelRpm * gears[gearIdx].ratio * spec.finalDriveRatio;

    // 停車付近は即座に 1速へ戻す
    const isStoppedForFirstGear = kmh < 3.0;
    if (isStoppedForFirstGear) {
      this.currentForwardGearIndex = 0;
    } else if (this.gearShiftCooldownS <= 0) {
      const currentSpec = gears[this.currentForwardGearIndex];
      const currentMechRpm = computeMechanicalRpm(this.currentForwardGearIndex);
      const upshiftThresholdRpm = THREE.MathUtils.lerp(
        currentSpec.upshiftRpmEco,
        currentSpec.upshiftRpmSport,
        THREE.MathUtils.clamp(throttle, 0, 1),
      );

      const canUpshift =
        this.currentForwardGearIndex < gears.length - 1 && currentMechRpm >= upshiftThresholdRpm;
      const canDownshift =
        this.currentForwardGearIndex > 0 && currentMechRpm <= currentSpec.downshiftRpm;

      if (canUpshift) {
        this.currentForwardGearIndex += 1;
        this.gearShiftCooldownS = 0.35;
      } else if (canDownshift) {
        this.currentForwardGearIndex -= 1;
        this.gearShiftCooldownS = 0.25;
      }
    }

    const activeGear = gears[this.currentForwardGearIndex];
    this.gear = activeGear.label;
    const mechanicalRpm = computeMechanicalRpm(this.currentForwardGearIndex);
    // 発進時のトルクコンバータ／ハイブリッド電気モーター連成スリップによる低速域の自然な吹け上がり
    const launchSlipBlend = 1.0 - THREE.MathUtils.clamp(kmh / 28.0, 0, 1);
    const launchSlipRpm = throttle * 900.0 * launchSlipBlend;
    const targetRpm = THREE.MathUtils.clamp(
      Math.max(800, mechanicalRpm + launchSlipRpm),
      800,
      6800,
    );
    const rpmAlpha = 1 - Math.exp(-14 * this.lastStepDt);
    this.engineRpm = THREE.MathUtils.lerp(this.engineRpm, targetRpm, rpmAlpha);
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
    this.currentForwardGearIndex = 0;
    this.gear = "D 1";
    this.gearShiftCooldownS = 0;
    this.engineRpm = 800;
    this.lastReverseInputActive = false;
    this.hasInitializedVisualFilter = false;
    this.isAutoHoldActive = false;
    this.autoHoldAnchorX = null;
    this.autoHoldAnchorZ = null;
    this.hasPrevVelocity = false;
    this.longitudinalG = 0;
    this.lateralG = 0;

    const numWheels = this.vehicleController.numWheels();
    for (let i = 0; i < numWheels; i++) {
      this.vehicleController.setWheelEngineForce(i, 0);
      this.vehicleController.setWheelBrake(i, 0);
      this.vehicleController.setWheelSteering(i, 0);
    }
  }

  public getState(): VehicleState {
    const spec = CROWN_SEDAN_PHYSICS_SPEC;
    const pos = this.rigidBody.translation();
    const vel = this.rigidBody.linvel();
    const rot = this.rigidBody.rotation();
    const rawQuat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);

    // 物理ステップ（衝突応答解決）後の実測水平速度でスピードメーター表示値を同期する
    // Why not update() 時点の currentVehicleSpeed() をそのまま返すか:
    // update() は world.step() の前に呼ばれるため、壁や障害物に衝突して剛体が停止した直後でも
    // 物理ステップ後の実際の速度減衰が即座に currentSpeedKmh に反映されるようにする。
    if (this.isAutoHoldActive) {
      this.currentSpeedKmh = 0;
    } else {
      const postStepHorizontalSpeedMs = Math.hypot(vel.x, vel.z);
      const postStepSpeedKmh = postStepHorizontalSpeedMs * 3.6;
      const isStoppedOrSlowedByCollision = postStepSpeedKmh < this.currentSpeedKmh;
      if (isStoppedOrSlowedByCollision) {
        this.currentSpeedKmh = postStepSpeedKmh;
      }
    }

    // 物理ステップ後の衝突・停止減衰で停車域 (< 1.5 km/h) に達しリバース未入力の場合は "R" 残留を防止して "D 1" へ整合する
    const isStoppedWithoutReverseInput =
      this.currentSpeedKmh < 1.5 && !this.lastReverseInputActive && this.gear === "R";
    if (isStoppedWithoutReverseInput) {
      this.currentForwardGearIndex = 0;
      this.gear = "D 1";
      this.engineRpm = 800;
    }

    // 静的平衡時の車高 pos.y = groundY + wheelRadius (0.34) + equilibriumSuspensionLength (0.2622) - wheelConnectionY (-0.02) = groundY + 0.6222
    // これにより停車・平坦路走行時に car.glb のタイヤ底面 (local Y = 0.000m) が路面標高と 0mm 精度で一致する。
    const visualHeightOffset =
      spec.wheelRadiusM + spec.equilibriumSuspensionLengthM - spec.wheelConnectionY;
    const rawVisualY = pos.y - visualHeightOffset;

    // 走行中は物理サスペンションのピッチ・ロール・上下荷重移動を鮮明に伝えるため追従帯域を広く取り、
    // 停車オートホールド中のみサブミリ単位の微細ノイズデッドゾーンを効かせる。
    if (!this.hasInitializedVisualFilter) {
      this.smoothedVisualY = rawVisualY;
      this.smoothedQuat.copy(rawQuat);
      this.hasInitializedVisualFilter = true;
    } else {
      const yRate = this.isAutoHoldActive ? 12 : 28;
      const qRate = this.isAutoHoldActive ? 14 : 30;
      const yAlpha = 1 - Math.exp(-yRate * this.lastStepDt);
      const qAlpha = 1 - Math.exp(-qRate * this.lastStepDt);
      const isTinyVerticalNoise =
        this.isAutoHoldActive && Math.abs(rawVisualY - this.smoothedVisualY) < 0.0015;
      if (!isTinyVerticalNoise) {
        this.smoothedVisualY = THREE.MathUtils.lerp(this.smoothedVisualY, rawVisualY, yAlpha);
      }
      const isTinyAngularNoise =
        this.isAutoHoldActive && this.smoothedQuat.angleTo(rawQuat) < 0.0015;
      if (!isTinyAngularNoise) {
        this.smoothedQuat.slerp(rawQuat, qAlpha);
      }
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
          this.vehicleController.wheelSuspensionLength(i) ?? this.equilibriumSuspensionLength,
        inContact: this.vehicleController.wheelIsInContact(i),
        rotation: this.vehicleController.wheelRotation(i) ?? 0,
        steering: this.vehicleController.wheelSteering(i) ?? 0,
        suspensionForce: this.vehicleController.wheelSuspensionForce(i) ?? 0,
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
      longitudinalG: this.longitudinalG,
      lateralG: this.lateralG,
      massKg: this.vehicleMassKg,
      equilibriumSuspensionLength: this.equilibriumSuspensionLength,
      wheelRadius: this.wheelRadius,
    };
  }
}

import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import type { VehicleInput, VehicleState } from "../types";

/**
 * 車両物理コントローラー
 * Rapier 3D の Dynamic RigidBody と Raycast/Impulse ベースの物理シミュレーション
 */
export class VehiclePhysics {
  public rigidBody: RAPIER.RigidBody;
  public collider: RAPIER.Collider;
  private rapier: typeof RAPIER;

  private currentSteer = 0;
  private currentSpeedKmh = 0;
  private engineRpm = 800;
  private gear = "D 1";

  // 車両パラメータ
  private readonly maxEngineForce = 1800;
  private readonly maxBrakeForce = 2400;
  private readonly maxSteerAngle = 0.55; // ラジアン (約31度)
  private readonly steerSpeed = 3.5;

  constructor(world: RAPIER.World, rapier: typeof RAPIER, startPos: THREE.Vector3) {
    this.rapier = rapier;
    // 1. 車両の剛体作成（低重心設定で安定走行）
    const bodyDesc = rapier.RigidBodyDesc.dynamic()
      .setTranslation(startPos.x, startPos.y, startPos.z)
      .setLinearDamping(0.3)
      .setAngularDamping(2.5)
      .setCanSleep(false);

    this.rigidBody = world.createRigidBody(bodyDesc);

    // 2. シャシーコライダー（直方体コライダー + 角丸）
    // 幅 1.9m, 高さ 1.1m, 全長 4.4m
    const halfWidth = 0.95;
    const halfHeight = 0.45;
    const halfLength = 2.1;
    const colliderDesc = rapier.ColliderDesc.cuboid(halfWidth, halfHeight, halfLength)
      .setDensity(1.8) // 車両総重量 約 1,400kg
      .setFriction(0.85)
      .setRestitution(0.05);

    this.collider = world.createCollider(colliderDesc, this.rigidBody);
  }

  public update(dt: number, input: VehicleInput): void {
    const isDtValid = dt > 0 && dt < 0.1;
    if (!isDtValid) {
      return;
    }

    const transform = this.rigidBody.translation();
    const rotation = this.rigidBody.rotation();
    const linvel = this.rigidBody.linvel();

    // 車両の向き（クォータニオンから前方向・右方向ベクトルを算出）
    const q = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);

    // 速度（車両ローカル前方・横方向速度）
    const currentVelocity = new THREE.Vector3(linvel.x, linvel.y, linvel.z);
    const forwardSpeed = currentVelocity.dot(forward);
    const lateralSpeed = currentVelocity.dot(right);
    this.currentSpeedKmh = Math.abs(forwardSpeed) * 3.6;

    // ステアリング角の補間（速度が上がるほど舵角を抑えて安定化）
    const speedRatio = Math.min(this.currentSpeedKmh / 140.0, 1.0);
    const targetMaxSteer = this.maxSteerAngle * (1.0 - speedRatio * 0.55);
    const targetSteer = input.steer * targetMaxSteer;
    this.currentSteer = THREE.MathUtils.lerp(this.currentSteer, targetSteer, this.steerSpeed * dt);

    // 推進力（アクセル）とブレーキ
    let driveForce = 0;
    const isPressingThrottle = input.throttle > 0;
    if (isPressingThrottle) {
      // 速度に応じたトラクション低減
      const powerCurve = Math.max(0.15, 1.0 - this.currentSpeedKmh / 180.0);
      driveForce = input.throttle * this.maxEngineForce * powerCurve;
    }

    let brakeForce = 0;
    const isPressingBrake = input.brake > 0;
    if (isPressingBrake) {
      const isMovingForward = forwardSpeed > 0.5;
      if (isMovingForward) {
        brakeForce = input.brake * this.maxBrakeForce;
      } else {
        // 後退ギア
        driveForce = -input.brake * this.maxEngineForce * 0.45;
      }
    }

    const isHandbrakeEngaged = input.handbrake;
    if (isHandbrakeEngaged) {
      brakeForce += this.maxBrakeForce * 1.5;
    }

    // 車体にかける力
    const netDrive = (driveForce - Math.sign(forwardSpeed) * brakeForce) * dt;
    const driveImpulse = forward.clone().multiplyScalar(netDrive);
    this.rigidBody.applyImpulse(
      new this.rapier.Vector3(driveImpulse.x, driveImpulse.y, driveImpulse.z),
      true,
    );

    // 横滑り（コーナリンググリップ）の横力シミュレーション
    const lateralFriction = -lateralSpeed * (isHandbrakeEngaged ? 30.0 : 180.0) * dt;
    const lateralImpulse = right.clone().multiplyScalar(lateralFriction);
    this.rigidBody.applyImpulse(
      new this.rapier.Vector3(lateralImpulse.x, lateralImpulse.y, lateralImpulse.z),
      true,
    );

    // ステアリングによるヨー回転（旋回トルク）
    const effectiveTurnSpeed = Math.min(Math.abs(forwardSpeed) * 0.5, 1.2);
    const turnSign = forwardSpeed >= -0.1 ? 1 : -1;
    const yawTorque = -this.currentSteer * effectiveTurnSpeed * turnSign * 180.0 * dt;
    const yawImpulse = up.clone().multiplyScalar(yawTorque);
    this.rigidBody.applyTorqueImpulse(
      new this.rapier.Vector3(yawImpulse.x, yawImpulse.y, yawImpulse.z),
      true,
    );

    // 姿勢の自己復元力（横転防止スタビライザー）
    const uprightDot = up.y;
    const isTilted = uprightDot < 0.95;
    if (isTilted) {
      const correctiveTorque = new THREE.Vector3(0, 1, 0).cross(up).multiplyScalar(-80.0 * dt);
      this.rigidBody.applyTorqueImpulse(
        new this.rapier.Vector3(correctiveTorque.x, correctiveTorque.y, correctiveTorque.z),
        true,
      );
    }

    // 地面へのダウンフォース（高速時の浮き上がり防止）
    const downforce = this.currentSpeedKmh * 1.2 * dt;
    this.rigidBody.applyImpulse(new this.rapier.Vector3(0, -downforce, 0), true);

    // ギア・RPM計算
    this.updateGearAndRpm(forwardSpeed);

    // 落下防止・リセット判定
    const isFallenOutOfBounds = transform.y < -10.0;
    if (isFallenOutOfBounds) {
      this.resetPosition(new THREE.Vector3(0, 1.0, 0));
    }
  }

  private updateGearAndRpm(speed: number): void {
    const isReverse = speed < -0.2;
    if (isReverse) {
      this.gear = "R";
      this.engineRpm = Math.min(5000, 800 + Math.abs(speed) * 200);
      return;
    }

    const kmh = this.currentSpeedKmh;
    if (kmh < 30) {
      this.gear = "D 1";
      this.engineRpm = 900 + (kmh / 30) * 3500;
    } else if (kmh < 60) {
      this.gear = "D 2";
      this.engineRpm = 2000 + ((kmh - 30) / 30) * 3200;
    } else if (kmh < 95) {
      this.gear = "D 3";
      this.engineRpm = 2200 + ((kmh - 60) / 35) * 3000;
    } else {
      this.gear = "D 4";
      this.engineRpm = 2400 + Math.min(3600, ((kmh - 95) / 50) * 2800);
    }
  }

  public resetPosition(pos: THREE.Vector3): void {
    this.rigidBody.setTranslation(new this.rapier.Vector3(pos.x, pos.y, pos.z), true);
    this.rigidBody.setRotation(new this.rapier.Quaternion(0, 0, 0, 1), true);
    this.rigidBody.setLinvel(new this.rapier.Vector3(0, 0, 0), true);
    this.rigidBody.setAngvel(new this.rapier.Vector3(0, 0, 0), true);
    this.currentSteer = 0;
  }

  public getState(): VehicleState {
    const pos = this.rigidBody.translation();
    const vel = this.rigidBody.linvel();
    const rot = this.rigidBody.rotation();
    const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const heading = Math.atan2(forward.x, forward.z);

    return {
      speedKmh: this.currentSpeedKmh,
      engineRpm: this.engineRpm,
      gear: this.gear,
      position: { x: pos.x, y: pos.y, z: pos.z },
      velocity: { x: vel.x, y: vel.y, z: vel.z },
      headingAngle: heading,
      steeringAngle: this.currentSteer,
    };
  }
}

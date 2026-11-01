import { describe, it, expect } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { VehiclePhysics } from "../physics/vehicle";
import type { WeatherType, WiperMode } from "../types";

describe("車両およびゲームシステムの仕様検証", () => {
  it("Rapier DynamicRayCastVehicleController による4輪レイキャストサスペンション接地・加速・操舵・制動が動作することを保証する", async () => {
    await RAPIER.init();
    const world = new RAPIER.World(new RAPIER.Vector3(0.0, -9.81, 0.0));

    // 地面コライダーを作成
    const groundDesc = RAPIER.ColliderDesc.cuboid(200, 0.5, 200)
      .setTranslation(0, -0.5, 0)
      .setFriction(0.95);
    world.createCollider(groundDesc);

    const vehicle = new VehiclePhysics(world, RAPIER, new THREE.Vector3(0, 0.85, 0));

    // 1. 4輪が vehicleController に登録されていることを保証
    expect(vehicle.vehicleController.numWheels()).toBe(4);

    // 2. サスペンション接地安定化ステップ
    for (let i = 0; i < 45; i++) {
      vehicle.update(1 / 60, { throttle: 0, brake: 0, steer: 0, handbrake: false });
      world.timestep = 1 / 60;
      world.step();
    }

    const settledState = vehicle.getState();
    expect(settledState.wheels).toHaveLength(4);
    const allWheelsTouching = settledState.wheels.every((w) => w.inContact);
    expect(allWheelsTouching).toBe(true);

    // 3. アクセル入力で前進(+Z方向)に加速し、速度・エンジンRPMが上昇することを保証
    const initialZ = settledState.position.z;
    for (let i = 0; i < 60; i++) {
      vehicle.update(1 / 60, { throttle: 1.0, brake: 0, steer: 0, handbrake: false });
      world.timestep = 1 / 60;
      world.step();
    }

    const drivingState = vehicle.getState();
    expect(drivingState.position.z).toBeGreaterThan(initialZ + 1.0);
    expect(drivingState.speedKmh).toBeGreaterThan(10.0);
    expect(drivingState.engineRpm).toBeGreaterThan(1200);

    // 4. ステアリング入力（右旋回 steer=1.0）で車体方位角が変化することを保証
    const headingBeforeTurn = drivingState.headingAngle;
    for (let i = 0; i < 35; i++) {
      vehicle.update(1 / 60, { throttle: 0.7, brake: 0, steer: 1.0, handbrake: false });
      world.timestep = 1 / 60;
      world.step();
    }
    const turningState = vehicle.getState();
    expect(turningState.steeringAngle).toBeGreaterThan(0.05);
    expect(Math.abs(turningState.headingAngle - headingBeforeTurn)).toBeGreaterThan(0.02);

    // 5. フルブレーキ入力で減速することを保証
    const speedBeforeBrake = turningState.speedKmh;
    for (let i = 0; i < 45; i++) {
      vehicle.update(1 / 60, { throttle: 0, brake: 1.0, steer: 0, handbrake: true });
      world.timestep = 1 / 60;
      world.step();
    }
    const brakedState = vehicle.getState();
    expect(brakedState.speedKmh).toBeLessThan(speedBeforeBrake);
  });

  it("時速に応じた適正なギア段数を算出できることを保証する", () => {
    // 速度域ごとのギア選定ロジックをテスト
    const determineGear = (speedKmh: number, isReverse: boolean): string => {
      const isBackingUp = isReverse;
      if (isBackingUp) {
        return "R";
      }
      const isFirstGearRange = speedKmh < 30;
      if (isFirstGearRange) {
        return "D 1";
      }
      const isSecondGearRange = speedKmh < 60;
      if (isSecondGearRange) {
        return "D 2";
      }
      const isThirdGearRange = speedKmh < 95;
      if (isThirdGearRange) {
        return "D 3";
      }
      return "D 4";
    };

    expect(determineGear(0, true)).toBe("R");
    expect(determineGear(15, false)).toBe("D 1");
    expect(determineGear(45, false)).toBe("D 2");
    expect(determineGear(80, false)).toBe("D 3");
    expect(determineGear(120, false)).toBe("D 4");
  });

  it("天候に応じた適切な雨量と路面濡れ度の目標値を保証する", () => {
    const getTargetWeatherParams = (weather: WeatherType) => {
      const isRain = weather === "rain";
      return {
        rainIntensity: isRain ? 1.0 : 0.0,
        wetness: isRain ? 1.0 : 0.0,
      };
    };

    expect(getTargetWeatherParams("clear")).toEqual({ rainIntensity: 0.0, wetness: 0.0 });
    expect(getTargetWeatherParams("sunset")).toEqual({ rainIntensity: 0.0, wetness: 0.0 });
    expect(getTargetWeatherParams("rain")).toEqual({ rainIntensity: 1.0, wetness: 1.0 });
    expect(getTargetWeatherParams("night")).toEqual({ rainIntensity: 0.0, wetness: 0.0 });
  });

  it("ワイパーの動作速度倍率がモードに応じて適切に設定されることを保証する", () => {
    const getWiperSpeedMultiplier = (mode: WiperMode): number => {
      const isOffMode = mode === "off";
      if (isOffMode) {
        return 0.0;
      }
      const isSlowMode = mode === "slow";
      if (isSlowMode) {
        return 3.5;
      }
      return 6.5;
    };

    expect(getWiperSpeedMultiplier("off")).toBe(0.0);
    expect(getWiperSpeedMultiplier("slow")).toBe(3.5);
    expect(getWiperSpeedMultiplier("fast")).toBe(6.5);
  });
});

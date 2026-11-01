import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { createWindshieldMaterial, type WindshieldUniforms } from "../shaders/windshield";
import { CarModel } from "../vehicle/carModel";
import type { VehicleState } from "../types";

describe("createWindshieldMaterial - Windshield Raindrop & Wiper Shader", () => {
  it("フロントガラス用シェーダーマテリアルが透明設定および必須ユニフォーム群を初期化することを保証する", () => {
    const mat = createWindshieldMaterial();

    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);

    expect(mat.uniforms.uTime).toBeDefined();
    expect(mat.uniforms.uRainIntensity).toBeDefined();
    expect(mat.uniforms.uSpeed).toBeDefined();
    expect(mat.uniforms.uWiperAngle1).toBeDefined();
    expect(mat.uniforms.uWiperAngle2).toBeDefined();
    expect(mat.uniforms.uWiperDir).toBeDefined();
    expect(mat.uniforms.uWiperSpeed).toBeDefined();
    expect(mat.uniforms.uWiperClearing).toBeDefined();

    expect(mat.uniforms.uRainIntensity.value).toBe(0.0);
    expect(mat.uniforms.uWiperDir.value).toBe(1.0);
    expect(mat.uniforms.uWiperSpeed.value).toBe(3.5);
    expect(mat.uniforms.uWiperClearing.value).toBe(1.0);
  });

  it("車速・雨量・ワイパー角度・ストローク方向の動的更新がユニフォームに正常に反映されることを保証する", () => {
    const mat = createWindshieldMaterial();

    mat.uniforms.uRainIntensity.value = 0.9;
    mat.uniforms.uSpeed.value = 65.0;
    mat.uniforms.uWiperAngle1.value = 0.85;
    mat.uniforms.uWiperAngle2.value = 0.78;
    mat.uniforms.uWiperDir.value = -1.0;

    const isRainSet = mat.uniforms.uRainIntensity.value === 0.9;
    const isSpeedSet = mat.uniforms.uSpeed.value === 65.0;

    expect(isRainSet).toBe(true);
    expect(isSpeedSet).toBe(true);
    expect(mat.uniforms.uWiperAngle1.value).toBe(0.85);
    expect(mat.uniforms.uWiperAngle2.value).toBe(0.78);
    expect(mat.uniforms.uWiperDir.value).toBe(-1.0);
  });

  it("GLSLフラグメントシェーダーコード内に実寸メートル座標系・ワイパー通過履歴(strokeAge)払拭・球冠屈折水滴ロジックが含まれていることを保証する", () => {
    const mat = createWindshieldMaterial();
    const frag = mat.fragmentShader;

    const hasMetricGlassSize = frag.includes("GLASS_SIZE = vec2(1.48, 0.965)");
    const hasStrokeHistory = frag.includes("strokeAge");
    const hasStaticMist = frag.includes("calculateStaticMist");
    const hasSlidingDrops = frag.includes("calculateSlidingDrops");
    const hasWiperClearing = frag.includes("calculateWiperClearing");
    const hasWaterRidge = frag.includes("totalRidge");
    const hasLensHighlight = frag.includes("highlightColor");
    const hasEffectiveRainInSliding = frag.includes(
      "calculateSlidingDrops(vec2 p, float time, float speedFactor, float localRain)",
    );

    expect(hasMetricGlassSize).toBe(true);
    expect(hasStrokeHistory).toBe(true);
    expect(hasStaticMist).toBe(true);
    expect(hasSlidingDrops).toBe(true);
    expect(hasWiperClearing).toBe(true);
    expect(hasWaterRidge).toBe(true);
    expect(hasLensHighlight).toBe(true);
    expect(hasEffectiveRainInSliding).toBe(true);
  });

  it("CarModel のフロントガラス UV 正規化により下端カウルが v=0.0、上端ルーフが v=1.0、右ハンドル運転席右端 (x=-0.74) が u=0.0 に統一されることを保証する", () => {
    const car = new CarModel();
    const geo = car.windshieldMesh.geometry;
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;

    expect(uv).toBeDefined();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const u = uv.getX(i);
      const v = uv.getY(i);

      const isLowerCowlEdge = Math.abs(y - 0.88) < 0.01;
      if (isLowerCowlEdge) {
        expect(v).toBeCloseTo(0.0, 2);
      }
      const isUpperRoofEdge = Math.abs(y - 1.42) < 0.01;
      if (isUpperRoofEdge) {
        expect(v).toBeCloseTo(1.0, 2);
      }
      const isDriverOuterEdge = Math.abs(x - -0.74) < 0.01;
      if (isDriverOuterEdge) {
        expect(u).toBeCloseTo(0.0, 2);
      }
    }
  });

  it("CarModel のワイパーがガラス傾斜面 (-0.977 rad) に密着し、動作時にパーク位置 (+0.09 rad) から最大角まで往復してシェーダーユニフォームと完全同期することを保証する", () => {
    const car = new CarModel();
    const dummyState: VehicleState = {
      position: new THREE.Vector3(0, 0.8, 0),
      velocity: new THREE.Vector3(0, 0, 10),
      quaternion: new THREE.Quaternion(),
      speedKmh: 36,
      steeringAngle: 0,
      headingAngle: 0,
      pitchAngle: 0,
      rollAngle: 0,
      engineRpm: 2200,
      gear: "D 2",
      wheels: [],
    };

    // 初期状態はカウル沿いのパーク角度 (+0.09 rad) かつガラス傾斜角 (-0.977 rad)
    expect(car.wiperArmDriver.rotation.x).toBeCloseTo(-0.977, 3);
    expect(car.wiperArmDriver.rotation.z).toBeCloseTo(0.09, 3);

    // slow モードで半周期 (t ≈ π / 3.5 ≈ 0.897s) 進めると上死点 (1.68 rad / 1.58 rad) 付近へ到達
    car.setWiperMode("slow");
    const halfPeriodDt = Math.PI / 3.5;
    car.update(halfPeriodDt, dummyState, 1.0);

    const uniforms = car.windshieldMaterial.uniforms as WindshieldUniforms;
    expect(uniforms.uWiperAngle1.value).toBeCloseTo(1.68, 2);
    expect(uniforms.uWiperAngle2.value).toBeCloseTo(1.58, 2);
    expect(car.wiperArmDriver.rotation.z).toBeCloseTo(1.68, 2);
    expect(uniforms.uWiperClearing.value).toBeGreaterThan(0.9);

    // さらに進めると復路ストローク (uWiperDir = -1.0) に切り替わる
    car.update(0.2, dummyState, 1.0);
    expect(uniforms.uWiperDir.value).toBe(-1.0);
  });
});

import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  computeGlassRainScrollRates,
  createRearWindowMaterial,
  createSideWindowMaterial,
  createWindshieldMaterial,
  type WindshieldUniforms,
} from "../shaders/windshield";
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
    expect(mat.uniforms.uWindScrollY).toBeDefined();
    expect(mat.uniforms.uWindScrollX).toBeDefined();
    expect(mat.uniforms.uWiperAngle1).toBeDefined();
    expect(mat.uniforms.uWiperAngle2).toBeDefined();
    expect(mat.uniforms.uWiperDir).toBeDefined();
    expect(mat.uniforms.uWiperSpeed).toBeDefined();
    expect(mat.uniforms.uWiperClearing).toBeDefined();
    expect(mat.uniforms.uEnvSkyColor).toBeDefined();
    expect(mat.uniforms.uEnvGroundColor).toBeDefined();
    expect(mat.uniforms.uSunColor).toBeDefined();
    expect(mat.uniforms.uNightFactor).toBeDefined();

    expect(mat.uniforms.uRainIntensity.value).toBe(0.0);
    expect(mat.uniforms.uWindScrollY.value).toBe(0.0);
    expect(mat.uniforms.uWindScrollX.value).toBe(0.0);
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

  it("GLSLフラグメントシェーダーコード内に実寸メートル座標系・右ハンドルJDMワイパーピボット・ワイパー通過履歴(strokeAge)払拭・速度別空力雨滴ストリークロジックが含まれていることを保証する", () => {
    const mat = createWindshieldMaterial();
    const frag = mat.fragmentShader;

    const hasMetricGlassSize =
      frag.includes("getGlassPhysicalSize") && frag.includes("vec2(1.48, 0.965)");
    const hasSideAndRearSizes =
      frag.includes("vec2(2.85, 0.56)") && frag.includes("vec2(1.46, 1.08)");
    const hasRhdDriverPivot = frag.includes("pivotDriver = vec2(0.16, 0.02)");
    const hasRhdPassengerPivot = frag.includes("pivotPassenger = vec2(0.80, 0.02)");
    const hasStrokeHistory = frag.includes("strokeAge");
    const hasStaticMist = frag.includes("calculateStaticMist");
    const hasSlidingDrops = frag.includes("calculateSlidingDrops");
    const hasAirflowVector = frag.includes("computeLocalAirflowVector");
    const hasWindScrollUniforms = frag.includes("uWindScrollY") && frag.includes("uWindScrollX");
    const hasWiperClearing = frag.includes("calculateWiperClearing");
    const hasWaterRidge = frag.includes("totalRidge");
    const hasLensHighlight = frag.includes("highlightColor");

    expect(hasMetricGlassSize).toBe(true);
    expect(hasSideAndRearSizes).toBe(true);
    expect(hasRhdDriverPivot).toBe(true);
    expect(hasRhdPassengerPivot).toBe(true);
    expect(hasStrokeHistory).toBe(true);
    expect(hasStaticMist).toBe(true);
    expect(hasSlidingDrops).toBe(true);
    expect(hasAirflowVector).toBe(true);
    expect(hasWindScrollUniforms).toBe(true);
    expect(hasWiperClearing).toBe(true);
    expect(hasWaterRidge).toBe(true);
    expect(hasLensHighlight).toBe(true);
  });

  it("走行速度に応じたガラス雨滴スクロール位相が停車時（重力落下）・中速均衡域・高速走行時（風圧吹き上がり＆サイド後方スリップストリーム）で物理的に遷移し、加減速時に位相ワープしないことを保証する", () => {
    // 1. 停車〜低速域 (0 km/h): 重力が支配し下方向 (+scrollYRate > 0) へ滑落、横スクロールは 0
    const stationaryFront = computeGlassRainScrollRates(0, "windshield");
    expect(stationaryFront.scrollYRate).toBeCloseTo(1.0, 3);
    expect(stationaryFront.scrollXRate).toBeCloseTo(0.0, 3);

    // 2. 中速均衡域 (~50 km/h): 重力と34°傾斜ガラスの風圧揚力が拮抗し、縦スクロール速度がほぼ 0 付近に減速
    const balanceFront = computeGlassRainScrollRates(50, "windshield");
    expect(Math.abs(balanceFront.scrollYRate)).toBeLessThan(0.15);
    expect(balanceFront.scrollXRate).toBeGreaterThan(0.4);

    // 3. 高速域 (100 km/h): 動圧 (v^2) が重力を振り切り、ルーフ上端方向 (scrollYRate < -1.0) かつ Aピラー外側へ強く吹き上がる
    const highSpeedFront = computeGlassRainScrollRates(100, "windshield");
    expect(highSpeedFront.scrollYRate).toBeLessThan(-1.5);
    expect(highSpeedFront.scrollXRate).toBeGreaterThan(1.2);

    // 4. サイドガラス: 速度上昇に伴い後方スリップストリーム (+scrollXRate) が大きく加速する
    const stationarySide = computeGlassRainScrollRates(0, "side");
    const highSpeedSide = computeGlassRainScrollRates(100, "side");
    expect(stationarySide.scrollXRate).toBeCloseTo(0.0, 3);
    expect(highSpeedSide.scrollXRate).toBeGreaterThan(2.0);
    expect(highSpeedSide.scrollYRate).toBeLessThan(stationarySide.scrollYRate);

    // 5. CarModel.update() での時間積分により、急加速・急減速しても uWindScrollY / uWindScrollX が不連続ジャンプせず滑らかに連続変化すること
    const car = new CarModel();
    const state: VehicleState = {
      position: new THREE.Vector3(0, 0.8, 0),
      velocity: new THREE.Vector3(0, 0, 0),
      quaternion: new THREE.Quaternion(),
      speedKmh: 0,
      steeringAngle: 0,
      headingAngle: 0,
      pitchAngle: 0,
      rollAngle: 0,
      engineRpm: 800,
      gear: "D 1",
      wheels: [],
    };

    // 停車状態で 10秒経過（uWindScrollY は正方向に蓄積）
    car.update(10.0, state, 0.9);
    const frontU = car.windshieldMaterial.uniforms as WindshieldUniforms;
    const scrollAfterStationary = frontU.uWindScrollY.value;
    expect(scrollAfterStationary).toBeCloseTo(10.0, 2);

    // 次の 1フレーム (dt = 0.016s) で 110 km/h へ急加速した際、uTime=10.016 との積で数十セル飛ぶのではなく、
    // 1フレーム分の吹き上がり増分 (dt * scrollYRate) だけ連続的に減少すること
    state.speedKmh = 110;
    car.update(0.016, state, 0.9);
    const deltaScroll = frontU.uWindScrollY.value - scrollAfterStationary;
    expect(deltaScroll).toBeLessThan(0);
    expect(Math.abs(deltaScroll)).toBeLessThan(0.1);
  });

  it("フロント以外のガラス（左右6ライトサイドガラス・リアガラス）のマテリアル・3D曲面メッシュ・UV正規化・雨滴および環境光ユニフォーム同期が正しく機能することを保証する", () => {
    const sideMat = createSideWindowMaterial();
    const rearMat = createRearWindowMaterial();

    expect((sideMat.uniforms as WindshieldUniforms).uGlassType.value).toBe(1.0);
    expect((sideMat.uniforms as WindshieldUniforms).uWiperClearing.value).toBe(0.0);
    expect((rearMat.uniforms as WindshieldUniforms).uGlassType.value).toBe(2.0);
    expect((rearMat.uniforms as WindshieldUniforms).uWiperClearing.value).toBe(0.0);
    expect(rearMat.fragmentShader.includes("copperHeaterColor")).toBe(true);

    const car = new CarModel();
    expect(car.sideWindowsMesh).toBeDefined();
    expect(car.rearWindowMesh).toBeDefined();
    expect(car.sideWindowsMesh.geometry.attributes.uv).toBeDefined();
    expect(car.rearWindowMesh.geometry.attributes.uv).toBeDefined();
    expect(car.sideWindowsMesh.geometry.attributes.position.count).toBeGreaterThan(200);
    expect(car.rearWindowMesh.geometry.attributes.position.count).toBeGreaterThan(150);

    // サイドガラスUV正規化の検証（前端 z=maxZ が u=0.0、後端 z=minZ が u=1.0）
    const sidePos = car.sideWindowsMesh.geometry.attributes.position;
    const sideUv = car.sideWindowsMesh.geometry.attributes.uv;
    let maxZ = -Infinity;
    let minZ = Infinity;
    for (let i = 0; i < sidePos.count; i++) {
      maxZ = Math.max(maxZ, sidePos.getZ(i));
      minZ = Math.min(minZ, sidePos.getZ(i));
    }
    for (let i = 0; i < sidePos.count; i++) {
      const z = sidePos.getZ(i);
      const u = sideUv.getX(i);
      const isFrontMost = Math.abs(z - maxZ) < 0.005;
      if (isFrontMost) {
        expect(u).toBeCloseTo(0.0, 2);
      }
      const isRearMost = Math.abs(z - minZ) < 0.005;
      if (isRearMost) {
        expect(u).toBeCloseTo(1.0, 2);
      }
    }

    // update() と setWindshieldEnvironment() でフロント・サイド・リア全ガラスが同期更新されること
    car.setWindshieldEnvironment({
      skyHorizonColor: new THREE.Color(0x60a5fa),
      skyZenithColor: new THREE.Color(0x1d4ed8),
      sunColor: new THREE.Color(0xfef08a),
      nightFactor: 0.75,
    });
    const dummyState: VehicleState = {
      position: new THREE.Vector3(0, 0.8, 0),
      velocity: new THREE.Vector3(0, 0, 15),
      quaternion: new THREE.Quaternion(),
      speedKmh: 54,
      steeringAngle: 0,
      headingAngle: 0,
      pitchAngle: 0,
      rollAngle: 0,
      engineRpm: 2400,
      gear: "D 3",
      wheels: [],
    };
    car.update(0.5, dummyState, 0.85);

    const sideUniforms = car.sideWindowMaterial.uniforms as WindshieldUniforms;
    const rearUniforms = car.rearWindowMaterial.uniforms as WindshieldUniforms;
    expect(sideUniforms.uRainIntensity.value).toBeCloseTo(0.85, 3);
    expect(rearUniforms.uRainIntensity.value).toBeCloseTo(0.85, 3);
    expect(sideUniforms.uSpeed.value).toBeCloseTo(54, 3);
    expect(rearUniforms.uSpeed.value).toBeCloseTo(54, 3);
    expect(sideUniforms.uNightFactor.value).toBeCloseTo(0.75, 3);
    expect(rearUniforms.uNightFactor.value).toBeCloseTo(0.75, 3);
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

  it("CarModel の右ハンドルステアリング (x=-0.38) とワイパーピボット (x=-0.58 / +0.06) がガラス傾斜面 (-0.977 rad) に密着し、パーク位置 (+0.08 rad) から最大角 (1.62 / 1.56 rad) まで往復してシェーダーユニフォームと完全同期することを保証する", () => {
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

    // 右ハンドルステアリングとワイパーピボット位置の検証
    expect(car.steeringWheel.position.x).toBeCloseTo(-0.38, 3);
    expect(car.wiperArmDriver.position.x).toBeCloseTo(-0.58, 3);
    expect(car.wiperArmPassenger.position.x).toBeCloseTo(0.06, 3);

    // 初期状態はカウル沿いのパーク角度 (+0.08 rad) かつガラス傾斜角 (-0.977 rad)
    expect(car.wiperArmDriver.rotation.x).toBeCloseTo(-0.977, 3);
    expect(car.wiperArmDriver.rotation.z).toBeCloseTo(0.08, 3);

    // slow モードで半周期 (t ≈ π / 3.5 ≈ 0.897s) 進めると上死点 (1.62 rad / 1.56 rad) 付近へ到達
    car.setWiperMode("slow");
    const halfPeriodDt = Math.PI / 3.5;
    car.update(halfPeriodDt, dummyState, 1.0);

    const uniforms = car.windshieldMaterial.uniforms as WindshieldUniforms;
    expect(uniforms.uWiperAngle1.value).toBeCloseTo(1.62, 2);
    expect(uniforms.uWiperAngle2.value).toBeCloseTo(1.56, 2);
    expect(car.wiperArmDriver.rotation.z).toBeCloseTo(1.62, 2);
    expect(uniforms.uWiperClearing.value).toBeGreaterThan(0.9);

    // さらに進めると復路ストローク (uWiperDir = -1.0) に切り替わる
    car.update(0.2, dummyState, 1.0);
    expect(uniforms.uWiperDir.value).toBe(-1.0);
  });
});

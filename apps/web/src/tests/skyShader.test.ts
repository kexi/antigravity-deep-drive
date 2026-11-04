import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { AtmosphericSky } from "../shaders/skyShader";
import { WeatherSystem } from "../weather/weatherSystem";

describe("AtmosphericSky (Dynamic Atmospheric Sky Shader)", () => {
  it("初期化時に適切なジオメトリ、BackSide、depthWrite: false、Far平面クリップ防止設定のマテリアルを生成することを保証する", () => {
    const sky = new AtmosphericSky({
      zenithColor: 0x0284c7,
      horizonColor: 0xbae6fd,
      sunColor: 0xfffaed,
      moonColor: 0xe2e8f0,
      moonIntensity: 0.4,
      cloudColor: 0xffffff,
      cloudDensity: 0.35,
      cloudSpeed: 0.02,
      starsIntensity: 0.0,
    });

    expect(sky.mesh).toBeDefined();
    expect(sky.mesh.name).toBe("AtmosphericSkyDome");
    expect(sky.mesh.geometry).toBeInstanceOf(THREE.SphereGeometry);
    // カメラの far (600m / 160m) より大きい半径 2400m のスカイドームが視錐台カリングで消えないことを保証
    expect(sky.mesh.frustumCulled).toBe(false);

    const mat = sky.material;
    expect(mat).toBeInstanceOf(THREE.ShaderMaterial);
    expect(mat.side).toBe(THREE.BackSide);
    // 深度バッファを汚染せず最奥 (depth≈1.0) として描画され、深度フォグ・レンズフレアと共存すること
    expect(mat.depthWrite).toBe(false);
    expect(mat.depthTest).toBe(true);
    expect(mat.depthFunc).toBe(THREE.LessEqualDepth);

    // 頂点シェーダーで z/w = 0.99999 に固定し、いかなるカメラ far でも Far クリップされないことを保証
    expect(mat.vertexShader).toContain(
      "gl_Position = vec4(clipPos.xy, clipPos.w * 0.99999, clipPos.w)",
    );

    // ユニフォームの初期値検証
    expect(mat.uniforms.uZenithColor.value.getHex()).toBe(0x0284c7);
    expect(mat.uniforms.uHorizonColor.value.getHex()).toBe(0xbae6fd);
    expect(mat.uniforms.uSunColor.value.getHex()).toBe(0xfffaed);
    expect(mat.uniforms.uMoonColor.value.getHex()).toBe(0xe2e8f0);
    expect(mat.uniforms.uMoonIntensity.value).toBeCloseTo(0.4);
    expect(mat.uniforms.uCloudColor.value.getHex()).toBe(0xffffff);
    expect(mat.uniforms.uCloudDensity.value).toBe(0.35);
    expect(mat.uniforms.uCloudSpeed.value).toBe(0.02);
    expect(mat.uniforms.uStarsIntensity.value).toBe(0.0);
    expect(mat.uniforms.uTime.value).toBe(0.0);
  });

  it("update() で時刻ユニフォームが進み、メッシュがカメラ座標に追従することを保証する", () => {
    const sky = new AtmosphericSky();
    const cameraPosition = new THREE.Vector3(12.5, 4.0, -85.2);

    sky.update(3.1415, cameraPosition);

    expect(sky.material.uniforms.uTime.value).toBeCloseTo(3.1415);
    expect(sky.mesh.position.x).toBeCloseTo(12.5);
    expect(sky.mesh.position.y).toBeCloseTo(4.0);
    expect(sky.mesh.position.z).toBeCloseTo(-85.2);
  });

  it("setSunPosition() および setMoonPosition() で太陽・月の方向ベクトルが正規化されて更新されることを保証する", () => {
    const sky = new AtmosphericSky();
    const rawSunPos = new THREE.Vector3(100, 200, -300);
    const rawMoonPos = new THREE.Vector3(-42, 62, -165);

    sky.setSunPosition(rawSunPos);
    sky.setMoonPosition(rawMoonPos);

    const uniformSun = sky.material.uniforms.uSunPosition.value as THREE.Vector3;
    expect(uniformSun.length()).toBeCloseTo(1.0);
    const expectedSun = rawSunPos.clone().normalize();
    expect(uniformSun.x).toBeCloseTo(expectedSun.x);
    expect(uniformSun.y).toBeCloseTo(expectedSun.y);
    expect(uniformSun.z).toBeCloseTo(expectedSun.z);

    const uniformMoon = sky.material.uniforms.uMoonPosition.value as THREE.Vector3;
    expect(uniformMoon.length()).toBeCloseTo(1.0);
    const expectedMoon = rawMoonPos.clone().normalize();
    expect(uniformMoon.x).toBeCloseTo(expectedMoon.x);
    expect(uniformMoon.y).toBeCloseTo(expectedMoon.y);
    expect(uniformMoon.z).toBeCloseTo(expectedMoon.z);
  });

  it("setParams() で天頂色・地平線色・太陽色・月色・月輝度・雲密度・星空輝度などのパラメータが動的に上書きされることを保証する", () => {
    const sky = new AtmosphericSky();

    sky.setParams({
      zenithColor: 0x4c1d95,
      horizonColor: 0xf97316,
      sunColor: 0xfb923c,
      moonColor: 0xf1f5f9,
      moonIntensity: 0.95,
      cloudColor: 0xfdba74,
      cloudDensity: 0.65,
      cloudSpeed: 0.05,
      starsIntensity: 0.8,
    });

    const uniforms = sky.material.uniforms;
    expect(uniforms.uZenithColor.value.getHex()).toBe(0x4c1d95);
    expect(uniforms.uHorizonColor.value.getHex()).toBe(0xf97316);
    expect(uniforms.uSunColor.value.getHex()).toBe(0xfb923c);
    expect(uniforms.uMoonColor.value.getHex()).toBe(0xf1f5f9);
    expect(uniforms.uMoonIntensity.value).toBeCloseTo(0.95);
    expect(uniforms.uCloudColor.value.getHex()).toBe(0xfdba74);
    expect(uniforms.uCloudDensity.value).toBeCloseTo(0.65);
    expect(uniforms.uCloudSpeed.value).toBeCloseTo(0.05);
    expect(uniforms.uStarsIntensity.value).toBeCloseTo(0.8);
  });

  it("フラグメントシェーダーにレイリー散乱、太陽ミー散乱、月面クレーター・月の海・月光コロナ、3Dボリュメトリック雲、星空瞬きが含まれることを保証する", () => {
    const sky = new AtmosphericSky();
    const frag = sky.material.fragmentShader;

    // レイリー散乱グラデーション計算の存在
    expect(frag).toContain("uZenithColor");
    expect(frag).toContain("uHorizonColor");
    expect(frag).toContain("horizonFade");

    // 太陽ディスク & ミー散乱計算の存在
    expect(frag).toContain("uSunPosition");
    expect(frag).toContain("sunAureole");
    expect(frag).toContain("sunDisk");

    // 月面（月の海・クレーター・周辺減光・月光コロナ）計算の存在
    expect(frag).toContain("uMoonPosition");
    expect(frag).toContain("uMoonColor");
    expect(frag).toContain("uMoonIntensity");
    expect(frag).toContain("evaluateLunarContribution");
    expect(frag).toContain("mariaPattern");
    expect(frag).toContain("limbDarkening");
    expect(frag).toContain("moonCorona");

    // 3オクターブ FBM & 3D ボリュメトリック雲計算の存在
    expect(frag).toContain("fbm");
    expect(frag).toContain("evaluateVolumetricClouds");
    expect(frag).toContain("uCloudDensity");
    expect(frag).toContain("uCloudSpeed");

    // 星空・瞬き計算の存在
    expect(frag).toContain("uStarsIntensity");
    expect(frag).toContain("twinkle");
  });

  it("WeatherSystem が前方走行視界 (+Z) に太陽と月を配置し、時間帯に応じて太陽・月・雲を正しく切り替えることを保証する", () => {
    const scene = new THREE.Scene();
    const weather = new WeatherSystem(scene);

    // 1. 昼 (day): 太陽が前方 (+Z) にあり、月は非表示 (moonIntensity = 0)
    weather.setEnvironment("day", "clear");
    expect(weather.getSunDirection().z).toBeGreaterThan(0);
    expect(weather.sky.material.uniforms.uMoonIntensity.value).toBeCloseTo(0.0);
    expect(weather.sky.material.uniforms.uCloudCoverage.value).toBeGreaterThan(0.35);

    // 2. 夕暮れ (sunset): 茜色の太陽と薄暮の月がともに前方 (+Z) の空に昇る
    weather.setEnvironment("sunset", "clear");
    expect(weather.getSunDirection().z).toBeGreaterThan(0);
    expect(weather.getMoonDirection().z).toBeGreaterThan(0);
    expect(weather.sky.material.uniforms.uMoonIntensity.value).toBeGreaterThan(0.3);

    // 3. 夜間 (night): 満月が前方 (+Z) の夜空に輝き (moonIntensity = 1.0)、星々と夜雲が描画される
    weather.setEnvironment("night", "clear");
    expect(weather.getMoonDirection().z).toBeGreaterThan(0);
    expect(weather.sky.material.uniforms.uMoonIntensity.value).toBeCloseTo(1.0);
    expect(weather.sky.material.uniforms.uStarsIntensity.value).toBeCloseTo(0.95);
  });
});

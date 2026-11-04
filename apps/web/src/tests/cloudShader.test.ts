import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { VolumetricCloudDome, CLOUD_SHADER_GLSL } from "../shaders/cloudShader";
import { AtmosphericSky } from "../shaders/skyShader";
import { WeatherSystem } from "../weather/weatherSystem";

describe("VolumetricCloudDome & CLOUD_SHADER_GLSL (3D Volumetric Raymarching Cloud Shader)", () => {
  it("VolumetricCloudDome が 3D Perlin-Worley テクスチャとレイマーチング雲ユニフォームを伴って正しく初期化されることを保証する", () => {
    const cloudDome = new VolumetricCloudDome({
      cloudColor: 0xffe4e6,
      cloudShadowColor: 0x475569,
      cloudCoverage: 0.56,
      cloudDensity: 0.48,
      cloudType: 0.35,
      cloudBottomAltitude: 620.0,
      cloudTopAltitude: 1900.0,
      cloudSpeed: 0.025,
      silverLiningIntensity: 1.5,
      powderStrength: 0.9,
      cirrusIntensity: 0.65,
    });

    expect(cloudDome.mesh).toBeDefined();
    expect(cloudDome.mesh.name).toBe("VolumetricCloudDome");
    expect(cloudDome.material.side).toBe(THREE.BackSide);
    expect(cloudDome.material.depthWrite).toBe(false);
    expect(cloudDome.material.transparent).toBe(true);

    const u = cloudDome.material.uniforms;
    expect(u.uCloudColor.value.getHex()).toBe(0xffe4e6);
    expect(u.uCloudShadowColor.value.getHex()).toBe(0x475569);
    expect(u.uCloudCoverage.value).toBeCloseTo(0.56);
    expect(u.uCloudDensity.value).toBeCloseTo(0.48);
    expect(u.uCloudType.value).toBeCloseTo(0.35);
    expect(u.uCloudBottomAltitude.value).toBeCloseTo(620.0);
    expect(u.uCloudTopAltitude.value).toBeCloseTo(1900.0);
    expect(u.uCloudSpeed.value).toBeCloseTo(0.025);
    expect(u.uSilverLiningIntensity.value).toBeCloseTo(1.5);
    expect(u.uPowderStrength.value).toBeCloseTo(0.9);
    expect(u.uCirrusIntensity.value).toBeCloseTo(0.65);
    expect(u.uCloudVolumeTex.value).toBeInstanceOf(THREE.Data3DTexture);
  });

  it("CLOUD_SHADER_GLSL に Henyey-Greenstein 二重ローブ位相関数、Beer-Powder 効果、3D Worley 侵食、巻雲レイヤーが含まれることを保証する", () => {
    expect(CLOUD_SHADER_GLSL).toContain("uniform sampler3D uCloudVolumeTex");
    expect(CLOUD_SHADER_GLSL).toContain("sampleCloudHeightGradient");
    expect(CLOUD_SHADER_GLSL).toContain("cloudPhaseHenyeyGreenstein");
    expect(CLOUD_SHADER_GLSL).toContain("cloudDualLobePhase");
    expect(CLOUD_SHADER_GLSL).toContain("cloudBeerPowder");
    expect(CLOUD_SHADER_GLSL).toContain("sampleVolumetricCloudDensity");
    expect(CLOUD_SHADER_GLSL).toContain("sampleCirrusCloudLayer");
    expect(CLOUD_SHADER_GLSL).toContain("evaluateVolumetricClouds");
  });

  it("AtmosphericSky および WeatherSystem が時間帯×天候に応じてボリュメトリック雲シェーダーのパラメータを連動更新することを保証する", () => {
    const scene = new THREE.Scene();
    const weatherSystem = new WeatherSystem(scene);
    const sky = weatherSystem.sky;
    expect(sky).toBeInstanceOf(AtmosphericSky);

    // 1. 夕暮れ × 晴天: 茜色の積雲と逆光時に白飛びしないシルバーライニング
    weatherSystem.setEnvironment("sunset", "clear");
    expect(sky.material.uniforms.uCloudCoverage.value).toBeCloseTo(0.54);
    expect(sky.material.uniforms.uCloudType.value).toBeCloseTo(0.35);
    expect(sky.material.uniforms.uSilverLiningIntensity.value).toBeCloseTo(0.45);

    // 2. 昼 × 曇天: 層積雲で雲量が増加
    weatherSystem.setEnvironment("day", "cloudy");
    expect(sky.material.uniforms.uCloudCoverage.value).toBeCloseTo(0.78);
    expect(sky.material.uniforms.uCloudType.value).toBeCloseTo(0.62);

    // 3. 夕暮れ × 雨天: 低く垂れ込める乱層雲（雲底高度低下・高密度）
    weatherSystem.setEnvironment("sunset", "rain");
    expect(sky.material.uniforms.uCloudCoverage.value).toBeCloseTo(0.94);
    expect(sky.material.uniforms.uCloudType.value).toBeCloseTo(0.95);
    expect(sky.material.uniforms.uCloudBottomAltitude.value).toBeCloseTo(420.0);
  });

  it("VolumetricCloudDome および AtmosphericSky がグラフィック品質（高/中/低）に応じてレイマーチング・太陽散乱ステップ数を動的に変更し、異常値を安全にクランプすることを保証する", () => {
    const cloudDome = new VolumetricCloudDome();
    expect(cloudDome.material.uniforms.uCloudMarchSteps.value).toBe(14);
    expect(cloudDome.material.uniforms.uCloudSunSteps.value).toBe(2);

    cloudDome.setCloudQuality(8, 1);
    expect(cloudDome.material.uniforms.uCloudMarchSteps.value).toBe(8);
    expect(cloudDome.material.uniforms.uCloudSunSteps.value).toBe(1);

    cloudDome.setCloudQuality(4, 0);
    expect(cloudDome.material.uniforms.uCloudMarchSteps.value).toBe(4);
    expect(cloudDome.material.uniforms.uCloudSunSteps.value).toBe(0);

    // 境界値・異常値のクランプ検証（marchSteps: [2, 14], sunSteps: [0, 2]）
    cloudDome.setCloudQuality(0, -3);
    expect(cloudDome.material.uniforms.uCloudMarchSteps.value).toBe(2);
    expect(cloudDome.material.uniforms.uCloudSunSteps.value).toBe(0);

    cloudDome.setCloudQuality(99, 10);
    expect(cloudDome.material.uniforms.uCloudMarchSteps.value).toBe(14);
    expect(cloudDome.material.uniforms.uCloudSunSteps.value).toBe(2);

    // WeatherSystem.setGraphicsQuality 経由で AtmosphericSky のステップ数が連動すること
    const scene = new THREE.Scene();
    const weatherSystem = new WeatherSystem(scene);
    expect(weatherSystem.sky.material.uniforms.uCloudMarchSteps.value).toBe(14);
    expect(weatherSystem.sky.material.uniforms.uCloudSunSteps.value).toBe(2);

    weatherSystem.setGraphicsQuality("medium");
    expect(weatherSystem.sky.material.uniforms.uCloudMarchSteps.value).toBe(8);
    expect(weatherSystem.sky.material.uniforms.uCloudSunSteps.value).toBe(1);

    weatherSystem.setGraphicsQuality("low");
    expect(weatherSystem.sky.material.uniforms.uCloudMarchSteps.value).toBe(4);
    expect(weatherSystem.sky.material.uniforms.uCloudSunSteps.value).toBe(0);

    weatherSystem.setGraphicsQuality("high");
    expect(weatherSystem.sky.material.uniforms.uCloudMarchSteps.value).toBe(14);
    expect(weatherSystem.sky.material.uniforms.uCloudSunSteps.value).toBe(2);

    // AtmosphericSky 単体での境界値クランプ検証（marchSteps: [2, 14], sunSteps: [0, 2]）
    const customSky = new AtmosphericSky({ cloudMarchSteps: 1, cloudSunSteps: -2 });
    expect(customSky.material.uniforms.uCloudMarchSteps.value).toBe(2);
    expect(customSky.material.uniforms.uCloudSunSteps.value).toBe(0);

    customSky.setCloudQuality(1, -5);
    expect(customSky.material.uniforms.uCloudMarchSteps.value).toBe(2);
    expect(customSky.material.uniforms.uCloudSunSteps.value).toBe(0);

    customSky.setParams({ cloudMarchSteps: 0, cloudSunSteps: 99 });
    expect(customSky.material.uniforms.uCloudMarchSteps.value).toBe(2);
    expect(customSky.material.uniforms.uCloudSunSteps.value).toBe(2);
  });
});

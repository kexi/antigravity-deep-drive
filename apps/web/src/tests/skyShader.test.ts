import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { AtmosphericSky } from "../shaders/skyShader";

describe("AtmosphericSky (Dynamic Atmospheric Sky Shader)", () => {
  it("初期化時に適切なジオメトリ、BackSide、depthWrite: false のマテリアルを生成すること", () => {
    const sky = new AtmosphericSky({
      zenithColor: 0x0284c7,
      horizonColor: 0xbae6fd,
      sunColor: 0xfffaed,
      cloudColor: 0xffffff,
      cloudDensity: 0.35,
      cloudSpeed: 0.02,
      starsIntensity: 0.0,
    });

    expect(sky.mesh).toBeDefined();
    expect(sky.mesh.name).toBe("AtmosphericSkyDome");
    expect(sky.mesh.geometry).toBeInstanceOf(THREE.SphereGeometry);

    const mat = sky.material;
    expect(mat).toBeInstanceOf(THREE.ShaderMaterial);
    expect(mat.side).toBe(THREE.BackSide);
    // 深度バッファを汚染せず最奥 (depth=1.0) として描画され、深度フォグと共存すること
    expect(mat.depthWrite).toBe(false);
    expect(mat.depthTest).toBe(true);

    // ユニフォームの初期値検証
    expect(mat.uniforms.uZenithColor.value.getHex()).toBe(0x0284c7);
    expect(mat.uniforms.uHorizonColor.value.getHex()).toBe(0xbae6fd);
    expect(mat.uniforms.uSunColor.value.getHex()).toBe(0xfffaed);
    expect(mat.uniforms.uCloudColor.value.getHex()).toBe(0xffffff);
    expect(mat.uniforms.uCloudDensity.value).toBe(0.35);
    expect(mat.uniforms.uCloudSpeed.value).toBe(0.02);
    expect(mat.uniforms.uStarsIntensity.value).toBe(0.0);
    expect(mat.uniforms.uTime.value).toBe(0.0);
  });

  it("update() で時刻ユニフォームが進み、メッシュがカメラ座標に追従すること", () => {
    const sky = new AtmosphericSky();
    const cameraPosition = new THREE.Vector3(12.5, 4.0, -85.2);

    sky.update(3.1415, cameraPosition);

    expect(sky.material.uniforms.uTime.value).toBeCloseTo(3.1415);
    expect(sky.mesh.position.x).toBeCloseTo(12.5);
    expect(sky.mesh.position.y).toBeCloseTo(4.0);
    expect(sky.mesh.position.z).toBeCloseTo(-85.2);
  });

  it("setSunPosition() で太陽方向ベクトルが正規化されて更新されること", () => {
    const sky = new AtmosphericSky();
    const rawSunPos = new THREE.Vector3(100, 200, -300);

    sky.setSunPosition(rawSunPos);

    const uniformSun = sky.material.uniforms.uSunPosition.value as THREE.Vector3;
    expect(uniformSun.length()).toBeCloseTo(1.0);
    const expectedNormalized = rawSunPos.clone().normalize();
    expect(uniformSun.x).toBeCloseTo(expectedNormalized.x);
    expect(uniformSun.y).toBeCloseTo(expectedNormalized.y);
    expect(uniformSun.z).toBeCloseTo(expectedNormalized.z);
  });

  it("setParams() で天頂色・地平線色・雲密度・星空輝度などのパラメータが動的に上書きされること", () => {
    const sky = new AtmosphericSky();

    sky.setParams({
      zenithColor: 0x4c1d95,
      horizonColor: 0xf97316,
      sunColor: 0xfb923c,
      cloudColor: 0xfdba74,
      cloudDensity: 0.65,
      cloudSpeed: 0.05,
      starsIntensity: 0.8,
    });

    const uniforms = sky.material.uniforms;
    expect(uniforms.uZenithColor.value.getHex()).toBe(0x4c1d95);
    expect(uniforms.uHorizonColor.value.getHex()).toBe(0xf97316);
    expect(uniforms.uSunColor.value.getHex()).toBe(0xfb923c);
    expect(uniforms.uCloudColor.value.getHex()).toBe(0xfdba74);
    expect(uniforms.uCloudDensity.value).toBeCloseTo(0.65);
    expect(uniforms.uCloudSpeed.value).toBeCloseTo(0.05);
    expect(uniforms.uStarsIntensity.value).toBeCloseTo(0.8);
  });

  it("フラグメントシェーダーにレイリー散乱、ミー散乱、3オクターブFBM雲、星空瞬きが含まれること", () => {
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

    // 3オクターブ FBM 雲計算の存在
    expect(frag).toContain("fbm");
    expect(frag).toContain("uCloudDensity");
    expect(frag).toContain("uCloudSpeed");

    // 星空・瞬き計算の存在
    expect(frag).toContain("uStarsIntensity");
    expect(frag).toContain("twinkle");
  });
});

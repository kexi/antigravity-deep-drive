import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { LensFlarePass } from "../shaders/lensFlare";

describe("LensFlarePass - Optical Cinematic Lens Flare Post-Process", () => {
  it("LensFlarePassが指定解像度、アスペクト比、初期マテリアルユニフォームを適切に初期化することを保証する", () => {
    const lensFlarePass = new LensFlarePass(1920, 1080, {
      enabled: true,
      intensity: 1.5,
      flareColor: 0xffaa55,
      sunColor: 0xfffaed,
      streakIntensity: 1.4,
      ghostIntensity: 0.9,
      haloIntensity: 0.6,
    });

    const isRenderTargetValid = Boolean(lensFlarePass.renderTarget);
    expect(isRenderTargetValid).toBe(true);

    const isCorrectSize =
      lensFlarePass.renderTarget.width === 1920 && lensFlarePass.renderTarget.height === 1080;
    expect(isCorrectSize).toBe(true);

    const uniforms = lensFlarePass.material.uniforms;
    expect(uniforms.uEnabled.value).toBe(1.0);
    expect(uniforms.uIntensity.value).toBe(1.5);
    expect(uniforms.uFlareColor.value.getHex()).toBe(0xffaa55);
    expect(uniforms.uSunColor.value.getHex()).toBe(0xfffaed);
    expect(uniforms.uStreakIntensity.value).toBe(1.4);
    expect(uniforms.uGhostIntensity.value).toBe(0.9);
    expect(uniforms.uHaloIntensity.value).toBe(0.6);

    const expectedAspect = 1920 / 1080;
    expect(uniforms.uAspectRatio.value).toBeCloseTo(expectedAspect);
  });

  it("updateSunPositionによって3D空間の太陽位置がスクリーンUV座標へ正しく射影されることを保証する", () => {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -100);
    camera.updateMatrixWorld();

    const lensFlarePass = new LensFlarePass(1280, 720);

    // 1. カメラ正面中央にある太陽
    lensFlarePass.setSunWorldPosition(new THREE.Vector3(0, 0, -100));
    lensFlarePass.updateSunPosition(camera);

    const sunPosForward = lensFlarePass.material.uniforms.uSunScreenPos.value;
    expect(sunPosForward.x).toBeCloseTo(0.5);
    expect(sunPosForward.y).toBeCloseTo(0.5);
    expect(sunPosForward.z).toBeGreaterThan(0.0); // 前方フラグ

    // 2. カメラ背後にある太陽
    lensFlarePass.setSunWorldPosition(new THREE.Vector3(0, 0, 100));
    lensFlarePass.updateSunPosition(camera);

    const sunPosBehind = lensFlarePass.material.uniforms.uSunScreenPos.value;
    expect(sunPosBehind.z).toBeLessThan(0.0); // 背後フラグ
  });

  it("setParamsによってフレア強度や天候カラーが動的に更新されることを保証する", () => {
    const lensFlarePass = new LensFlarePass(800, 600);

    lensFlarePass.setParams({
      enabled: false,
      intensity: 0.0,
      flareColor: 0x334455,
      sunColor: 0x112233,
      streakIntensity: 0.0,
      ghostIntensity: 0.0,
      haloIntensity: 0.0,
    });

    const uniforms = lensFlarePass.material.uniforms;
    const isEnabledFalse = uniforms.uEnabled.value === 0.0;
    const isIntensityZero = uniforms.uIntensity.value === 0.0;
    const isFlareColorUpdated = uniforms.uFlareColor.value.getHex() === 0x334455;
    const isSunColorUpdated = uniforms.uSunColor.value.getHex() === 0x112233;

    expect(isEnabledFalse).toBe(true);
    expect(isIntensityZero).toBe(true);
    expect(isFlareColorUpdated).toBe(true);
    expect(isSunColorUpdated).toBe(true);
  });

  it("GLSLフラグメントシェーダーコード内に深度オクルージョン、スターバースト光芒、アナモルフィックストリーク、ゴースト計算が含まれていることを保証する", () => {
    const lensFlarePass = new LensFlarePass(800, 600);
    const fragmentGlsl = lensFlarePass.material.fragmentShader;

    // 1. 深度サンプリングオクルージョン
    const hasOcclusionFunc = fragmentGlsl.includes("float calculateOcclusion(vec2 sunUv)");
    const hasDepthTextureLookup = fragmentGlsl.includes("texture2D(tDepth, sampleUv).r");
    expect(hasOcclusionFunc).toBe(true);
    expect(hasDepthTextureLookup).toBe(true);

    // 2. スターバースト回折光芒
    const hasStarburstSpikes = fragmentGlsl.includes("sin(angle * 6.0) * sin(angle * 12.0)");
    expect(hasStarburstSpikes).toBe(true);

    // 3. アナモルフィック・シネマティックストリーク
    const hasAnamorphicStreak = fragmentGlsl.includes("exp(-dy * 160.0)");
    expect(hasAnamorphicStreak).toBe(true);

    // 4. 光学軸マルチエレメント・ゴースト
    const hasGhostFunc = fragmentGlsl.includes("renderGhost(vec2 uv, vec2 ghostPos");
    const hasOpticalAxis = fragmentGlsl.includes("vec2 opticalAxis = vec2(0.5) - sunUv");
    expect(hasGhostFunc).toBe(true);
    expect(hasOpticalAxis).toBe(true);

    // 5. 大口径ハローリング
    const hasHalo = fragmentGlsl.includes("float haloRadius = 0.42");
    expect(hasHalo).toBe(true);
  });
});

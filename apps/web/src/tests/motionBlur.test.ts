import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { MotionBlurPass, MotionBlurShader } from "../shaders/motionBlur";

describe("MotionBlurPass - Depth-Masked Exterior Motion Blur", () => {
  it("MotionBlurShaderとMotionBlurPassが深度マスク用のユニフォーム（tDepth, uHasDepth, uCameraNear, uCameraFar, uMaskNearDistance, uMaskFarDistance）を適切に初期化することを保証する", () => {
    const pass = new MotionBlurPass(1280, 720);
    const uniforms = pass.material.uniforms;

    expect(uniforms.tDiffuse.value).toBeNull();
    expect(uniforms.tDepth.value).toBeNull();
    expect(uniforms.uEnabled.value).toBe(1.0);
    expect(uniforms.uStrength.value).toBe(0.0);
    expect(uniforms.uHasDepth.value).toBe(0.0);
    expect(uniforms.uCameraNear.value).toBeCloseTo(0.1, 4);
    expect(uniforms.uCameraFar.value).toBeCloseTo(600.0, 2);
    expect(uniforms.uMaskNearDistance.value).toBeCloseTo(2.2, 4);
    expect(uniforms.uMaskFarDistance.value).toBeCloseTo(3.0, 4);
  });

  it("車内視点（cockpit）およびチェイス視点（chase）に応じてカメラ距離マスク閾値とブラー強度が更新されることを保証する", () => {
    const pass = new MotionBlurPass(800, 600);

    // 1. コックピット視点・高速走行時 (100 km/h): 車内（カーナビ ~0.62m、メーター ~0.65m、ボンネット先端 ~2.2m）を保護する閾値 2.2m〜3.0m
    pass.update(100, true, {
      cameraNear: 0.1,
      cameraFar: 600.0,
      cameraMode: "cockpit",
    });

    expect(pass.material.uniforms.uEnabled.value).toBe(1.0);
    expect(pass.material.uniforms.uStrength.value).toBeGreaterThan(0.02);
    expect(pass.material.uniforms.uMaskNearDistance.value).toBeCloseTo(2.2, 4);
    expect(pass.material.uniforms.uMaskFarDistance.value).toBeCloseTo(3.0, 4);

    // 2. チェイス視点切り替え時: 近傍マスク閾値がチェイス用に切り替わること
    pass.update(100, true, {
      cameraNear: 0.15,
      cameraFar: 800.0,
      cameraMode: "chase",
    });

    expect(pass.material.uniforms.uCameraNear.value).toBeCloseTo(0.15, 4);
    expect(pass.material.uniforms.uCameraFar.value).toBeCloseTo(800.0, 2);
    expect(pass.material.uniforms.uMaskNearDistance.value).toBeCloseTo(0.5, 4);
    expect(pass.material.uniforms.uMaskFarDistance.value).toBeCloseTo(1.2, 4);

    // 3. 低速時 (20 km/h 以下) または無効化時はブラー強度が 0 になること
    pass.update(15, true, { cameraMode: "cockpit" });
    expect(pass.material.uniforms.uStrength.value).toBe(0.0);

    pass.update(120, false, { cameraMode: "cockpit" });
    expect(pass.material.uniforms.uEnabled.value).toBe(0.0);
    expect(pass.material.uniforms.uStrength.value).toBe(0.0);
  });

  it("renderFromTexture 呼び出し時に depthTexture の有無に応じて tDepth と uHasDepth が正しくバインドされることを保証する", () => {
    const pass = new MotionBlurPass(640, 360);
    const mockRenderer = {
      setRenderTarget: vi.fn(),
      render: vi.fn(),
    } as unknown as THREE.WebGLRenderer;

    const colorTex = new THREE.Texture();
    const depthTex = new THREE.DepthTexture(640, 360);

    // 深度テクスチャありで描画
    pass.renderFromTexture(mockRenderer, colorTex, null, depthTex);
    expect(pass.material.uniforms.tDiffuse.value).toBe(colorTex);
    expect(pass.material.uniforms.tDepth.value).toBe(depthTex);
    expect(pass.material.uniforms.uHasDepth.value).toBe(1.0);

    // 深度テクスチャなし（null）で描画した場合はフォールバック（uHasDepth = 0.0）になること
    pass.renderFromTexture(mockRenderer, colorTex, null, null);
    expect(pass.material.uniforms.tDepth.value).toBeNull();
    expect(pass.material.uniforms.uHasDepth.value).toBe(0.0);
  });

  it("GLSLフラグメントシェーダーに線形深度変換（linearizeDepth）と車内インテリア除外マスク（computeExteriorMask）およびサンプル滲み防止処理が含まれていることを保証する", () => {
    const fragmentGlsl = MotionBlurShader.fragmentShader;

    // 1. 非線形デプスからカメラ距離への線形化関数が存在すること
    const hasLinearizeDepth = fragmentGlsl.includes("float linearizeDepth(float depthSample)");
    expect(hasLinearizeDepth).toBe(true);

    // 2. 車内インテリア領域（uMaskNearDistance 未満）を除外するマスク計算関数が存在すること
    const hasExteriorMaskFunc = fragmentGlsl.includes("float computeExteriorMask(vec2 uv)");
    const hasSmoothstepMask = fragmentGlsl.includes(
      "smoothstep(uMaskNearDistance, uMaskFarDistance, linearDist)",
    );
    expect(hasExteriorMaskFunc).toBe(true);
    expect(hasSmoothstepMask).toBe(true);

    // 3. 中心ピクセルが車内インテリアの場合の早期リターンが含まれること
    const hasCenterEarlyReturn = fragmentGlsl.includes("if (centerExteriorMask <= 0.001)");
    expect(hasCenterEarlyReturn).toBe(true);

    // 4. サンプリング先ピクセルが車内インテリアに入った場合の色滲み（ブリーディング）抑制重みが含まれること
    const hasSampleMaskWeight = fragmentGlsl.includes(
      "float sampleExteriorMask = computeExteriorMask(sampleUv);",
    );
    expect(hasSampleMaskWeight).toBe(true);
  });
});

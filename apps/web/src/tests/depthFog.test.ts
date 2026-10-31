import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { DepthFogPass } from '../shaders/depthFog';

describe('DepthFogPass - Atmospheric Height and Depth Fog', () => {
  it('DepthFogPassが指定解像度と深度レンダーターゲットを適切に初期化することを保証する', () => {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
    camera.position.set(0, 10, 50);
    camera.updateMatrixWorld();

    const fogPass = new DepthFogPass(1280, 720, camera, {
      fogColor: 0x90cdf4,
      sunColor: 0xffaa44,
      density: 0.008,
      heightFalloff: 0.05,
      startDistance: 5.0,
    });

    const hasDepthTexture = Boolean(fogPass.renderTarget.depthTexture);
    expect(hasDepthTexture).toBe(true);

    const isCorrectSize =
      fogPass.renderTarget.width === 1280 && fogPass.renderTarget.height === 720;
    expect(isCorrectSize).toBe(true);

    const isDepthFormatCorrect =
      fogPass.renderTarget.depthTexture?.type === THREE.UnsignedIntType;
    expect(isDepthFormatCorrect).toBe(true);

    const uniforms = fogPass.material.uniforms;
    expect(uniforms.uFogColor.value.getHex()).toBe(0x90cdf4);
    expect(uniforms.uSunColor.value.getHex()).toBe(0xffaa44);
    expect(uniforms.uDensity.value).toBe(0.008);
    expect(uniforms.uHeightFalloff.value).toBe(0.05);
    expect(uniforms.uStartDistance.value).toBe(5.0);
  });

  it('setFogParamsメソッドにより大気密度・高度減衰率・太陽光パラメータが動的更新されることを保証する', () => {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
    const fogPass = new DepthFogPass(800, 600, camera);

    const newSunDir = new THREE.Vector3(0, 1, 0).normalize();
    fogPass.setFogParams({
      fogColor: 0x223344,
      sunColor: 0xffeedd,
      sunDirection: newSunDir,
      density: 0.015,
      heightFalloff: 0.08,
    });

    const uniforms = fogPass.material.uniforms;
    const isFogColorUpdated = uniforms.uFogColor.value.getHex() === 0x223344;
    const isSunColorUpdated = uniforms.uSunColor.value.getHex() === 0xffeedd;
    const isDensityUpdated = uniforms.uDensity.value === 0.015;
    const isHeightFalloffUpdated = uniforms.uHeightFalloff.value === 0.08;
    const isSunDirUpdated = uniforms.uSunDirection.value.y === 1;

    expect(isFogColorUpdated).toBe(true);
    expect(isSunColorUpdated).toBe(true);
    expect(isDensityUpdated).toBe(true);
    expect(isHeightFalloffUpdated).toBe(true);
    expect(isSunDirUpdated).toBe(true);
  });

  it('GLSLシェーダーコードに深度復元、高度減衰積分、Henyey-Greenstein散乱計算が含まれていることを保証する', () => {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
    const fogPass = new DepthFogPass(800, 600, camera);

    const fragmentGlsl = fogPass.material.fragmentShader;

    // 1. 深度値からのビュー座標再構築
    const hasViewPosFunc = fragmentGlsl.includes('vec3 getViewPos(vec2 uv, float depth)');
    const hasClipPosReconstruct = fragmentGlsl.includes('cameraProjectionInverse * clipPos');
    expect(hasViewPosFunc).toBe(true);
    expect(hasClipPosReconstruct).toBe(true);

    // 2. 指数高度減衰の解析解
    const hasHeightIntegral = fragmentGlsl.includes('exp(-uHeightFalloff * camY)');
    const hasDeltaYBranch = fragmentGlsl.includes('abs(deltaY) > 0.001');
    expect(hasHeightIntegral).toBe(true);
    expect(hasDeltaYBranch).toBe(true);

    // 3. Henyey-Greenstein ミー散乱位相関数
    const hasHenyeyGreenstein = fragmentGlsl.includes('float henyeyGreenstein(float cosTheta, float g)');
    const hasInscatteringMix = fragmentGlsl.includes('mix(uFogColor, uSunColor, clamp(phase * uInscatteringIntensity, 0.0, 1.0))');
    expect(hasHenyeyGreenstein).toBe(true);
    expect(hasInscatteringMix).toBe(true);
  });
});

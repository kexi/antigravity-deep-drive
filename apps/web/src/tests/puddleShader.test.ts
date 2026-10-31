import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PuddleMaterial } from '../shaders/puddleShader';

describe('PuddleMaterial - Physically Based Rain Puddles & Ripples Shader', () => {
  it('水たまりシェーダーが初期ユニフォーム値（雨量、時間、閾値、リップル速度）を正しく初期化することを保証する', () => {
    const puddleMat = new PuddleMaterial({
      puddleThreshold: 0.55,
      rippleSpeed: 1.5,
    });

    expect(puddleMat.uRainWetness.value).toBe(0.0);
    expect(puddleMat.uTime.value).toBe(0.0);
    expect(puddleMat.uPuddleThreshold.value).toBe(0.55);
    expect(puddleMat.uRippleIntensity.value).toBe(1.0);
    expect(puddleMat.uRippleSpeed.value).toBe(1.5);
  });

  it('雨量や時間パラメータの更新がユニフォームに即時反映されることを保証する', () => {
    const puddleMat = new PuddleMaterial();

    puddleMat.uRainWetness.value = 0.85;
    puddleMat.uTime.value = 12.34;
    puddleMat.uRippleIntensity.value = 1.2;

    const isWetnessApplied = puddleMat.uRainWetness.value === 0.85;
    const isTimeApplied = puddleMat.uTime.value === 12.34;

    expect(isWetnessApplied).toBe(true);
    expect(isTimeApplied).toBe(true);
    expect(puddleMat.uRippleIntensity.value).toBe(1.2);
  });

  it('onBeforeCompile フックによってGLSLシェーダーコードに波紋計算・法線変調・粗さ変調コードが注入されることを保証する', () => {
    const puddleMat = new PuddleMaterial();

    // Three.js のシェーダーコンパイル前オブジェクトを模倣
    const mockShader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: `
        #include <common>
        void main() {
          #include <worldpos_vertex>
        }
      `,
      fragmentShader: `
        #include <common>
        void main() {
          #include <normal_fragment_maps>
          #include <roughnessmap_fragment>
        }
      `,
    };

    puddleMat.onBeforeCompile(mockShader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as unknown as THREE.WebGLRenderer);

    // ユニフォームのバインド検証
    expect(mockShader.uniforms.uRainWetness).toBe(puddleMat.uRainWetness);
    expect(mockShader.uniforms.uTime).toBe(puddleMat.uTime);
    expect(mockShader.uniforms.uPuddleThreshold).toBe(puddleMat.uPuddleThreshold);
    expect(mockShader.uniforms.uRippleIntensity).toBe(puddleMat.uRippleIntensity);

    // GLSLコード注入の検証
    const hasRippleFunction = mockShader.fragmentShader.includes('calculateRainRipples');
    const hasPuddleNoise = mockShader.fragmentShader.includes('puddleFbm');
    const hasNormalModulation = mockShader.fragmentShader.includes('perturbedN');
    const hasRoughnessMirroring = mockShader.fragmentShader.includes('roughnessFactor = mix(wetAsphaltRoughness, 0.02, puddleCore)');

    expect(hasRippleFunction).toBe(true);
    expect(hasPuddleNoise).toBe(true);
    expect(hasNormalModulation).toBe(true);
    expect(hasRoughnessMirroring).toBe(true);
  });
});

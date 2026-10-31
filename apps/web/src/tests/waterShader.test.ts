import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { WaterSurfaceMaterial } from '../shaders/waterShader';

describe('WaterSurfaceMaterial - Gerstner Waves Water Surface Shader', () => {
  it('水面シェーダーが初期パラメータ（波速、波高、浅瀬・深部色）を正しく初期化することを保証する', () => {
    const waterMat = new WaterSurfaceMaterial({
      shallowColor: 0x14708c,
      deepColor: 0x031e2b,
      waveSpeed: 1.1,
      waveHeight: 0.45,
    });

    expect(waterMat.transparent).toBe(true);
    expect(waterMat.uTime.value).toBe(0.0);
    expect(waterMat.uRainWetness.value).toBe(0.0);
    expect(waterMat.uWaveSpeed.value).toBe(1.1);
    expect(waterMat.uWaveHeight.value).toBe(0.45);
    expect(waterMat.uShallowColor.value.getHex()).toBe(0x14708c);
    expect(waterMat.uDeepColor.value.getHex()).toBe(0x031e2b);
  });

  it('時間・雨量パラメータの更新がユニフォームに正常に反映されることを保証する', () => {
    const waterMat = new WaterSurfaceMaterial();

    waterMat.uTime.value = 45.67;
    waterMat.uRainWetness.value = 0.75;

    const isTimeSet = waterMat.uTime.value === 45.67;
    const isRainSet = waterMat.uRainWetness.value === 0.75;

    expect(isTimeSet).toBe(true);
    expect(isRainSet).toBe(true);
  });

  it('onBeforeCompile フックによってGLSLコードにGerstner波計算と吸光グラデーションが注入されることを保証する', () => {
    const waterMat = new WaterSurfaceMaterial();

    const mockShader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: `
        #include <common>
        void main() {
          #include <begin_vertex>
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

    waterMat.onBeforeCompile(
      mockShader as unknown as THREE.WebGLProgramParametersWithUniforms,
      {} as unknown as THREE.WebGLRenderer
    );

    // ユニフォームバインド検証
    expect(mockShader.uniforms.uTime).toBe(waterMat.uTime);
    expect(mockShader.uniforms.uWaveSpeed).toBe(waterMat.uWaveSpeed);
    expect(mockShader.uniforms.uWaveHeight).toBe(waterMat.uWaveHeight);
    expect(mockShader.uniforms.uRainWetness).toBe(waterMat.uRainWetness);

    // GLSL頂点シェーダー検証
    const hasGerstner = mockShader.vertexShader.includes('calculateGerstnerWave');
    const hasDisplacement = mockShader.vertexShader.includes('transformed += waveOffset');
    expect(hasGerstner).toBe(true);
    expect(hasDisplacement).toBe(true);

    // GLSLフラグメントシェーダー検証
    const hasWaterAbsorption = mockShader.fragmentShader.includes('mix(uDeepColor, uShallowColor, waveHeightFactor)');
    const hasWaterRipples = mockShader.fragmentShader.includes('waterRainRipples');
    expect(hasWaterAbsorption).toBe(true);
    expect(hasWaterRipples).toBe(true);
  });
});

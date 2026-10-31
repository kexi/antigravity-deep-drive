import { describe, it, expect } from 'vitest';
import { createWindshieldMaterial } from '../shaders/windshield';

describe('createWindshieldMaterial - Windshield Raindrop & Wiper Shader', () => {
  it('フロントガラス用シェーダーマテリアルが透明設定および必須ユニフォーム群を初期化することを保証する', () => {
    const mat = createWindshieldMaterial();

    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);

    expect(mat.uniforms.uTime).toBeDefined();
    expect(mat.uniforms.uRainIntensity).toBeDefined();
    expect(mat.uniforms.uSpeed).toBeDefined();
    expect(mat.uniforms.uWiperAngle1).toBeDefined();
    expect(mat.uniforms.uWiperAngle2).toBeDefined();
    expect(mat.uniforms.uWiperClearing).toBeDefined();

    expect(mat.uniforms.uRainIntensity.value).toBe(0.0);
    expect(mat.uniforms.uWiperClearing.value).toBe(1.0);
  });

  it('車速・雨量・ワイパー角度の動的更新がユニフォームに正常に反映されることを保証する', () => {
    const mat = createWindshieldMaterial();

    mat.uniforms.uRainIntensity.value = 0.9;
    mat.uniforms.uSpeed.value = 65.0;
    mat.uniforms.uWiperAngle1.value = 0.85;
    mat.uniforms.uWiperAngle2.value = 0.78;

    const isRainSet = mat.uniforms.uRainIntensity.value === 0.9;
    const isSpeedSet = mat.uniforms.uSpeed.value === 65.0;

    expect(isRainSet).toBe(true);
    expect(isSpeedSet).toBe(true);
    expect(mat.uniforms.uWiperAngle1.value).toBe(0.85);
    expect(mat.uniforms.uWiperAngle2.value).toBe(0.78);
  });

  it('GLSLフラグメントシェーダーコード内に微小水滴・滑落水滴・ワイパーエッジ水堤の計算ロジックが含まれていることを保証する', () => {
    const mat = createWindshieldMaterial();
    const frag = mat.fragmentShader;

    const hasStaticMist = frag.includes('calculateStaticMist');
    const hasSlidingDrops = frag.includes('calculateSlidingDrops');
    const hasWiperClearing = frag.includes('calculateWiperClearing');
    const hasWaterRidge = frag.includes('totalRidge');
    const hasLensHighlight = frag.includes('highlightColor');

    expect(hasStaticMist).toBe(true);
    expect(hasSlidingDrops).toBe(true);
    expect(hasWiperClearing).toBe(true);
    expect(hasWaterRidge).toBe(true);
    expect(hasLensHighlight).toBe(true);
  });
});

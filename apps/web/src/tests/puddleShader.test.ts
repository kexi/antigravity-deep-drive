import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { PuddleMaterial } from "../shaders/puddleShader";
import { JapaneseRoadMaterial } from "../roads/japaneseRoadMaterial";

describe("PuddleMaterial & JapaneseRoadMaterial - Physically Based Puddles, Ripples & Planar Reflection Shader", () => {
  it("水たまりシェーダーが初期ユニフォーム値（雨量、時間、閾値、リップル速度、大気・太陽反射色）を正しく初期化することを保証する", () => {
    const puddleMat = new PuddleMaterial({
      puddleThreshold: 0.55,
      rippleSpeed: 1.5,
      sunColor: 0xffaa44,
      skyHorizonColor: 0xfdba74,
      skyZenithColor: 0x4c1d95,
      nightFactor: 0.35,
    });

    expect(puddleMat.uRainWetness.value).toBe(0.0);
    expect(puddleMat.uTime.value).toBe(0.0);
    expect(puddleMat.uPuddleThreshold.value).toBe(0.55);
    expect(puddleMat.uRippleIntensity.value).toBe(1.0);
    expect(puddleMat.uRippleSpeed.value).toBe(1.5);
    expect(puddleMat.uSunColor.value.getHex()).toBe(0xffaa44);
    expect(puddleMat.uSkyHorizonColor.value.getHex()).toBe(0xfdba74);
    expect(puddleMat.uSkyZenithColor.value.getHex()).toBe(0x4c1d95);
    expect(puddleMat.uNightFactor.value).toBe(0.35);
  });

  it("syncEnvironment メソッドによって雨量・時間・太陽方向・空グラデーション・夜間係数がユニフォームへ一括反映されることを保証する", () => {
    const puddleMat = new PuddleMaterial();

    puddleMat.syncEnvironment({
      wetness: 0.85,
      time: 12.34,
      rippleIntensity: 1.2,
      sunDirection: new THREE.Vector3(0, 1, 0),
      sunColor: 0x38bdf8,
      skyHorizonColor: new THREE.Color(0x0f172a),
      skyZenithColor: 0x020617,
      nightFactor: 1.0,
    });

    const isWetnessApplied = puddleMat.uRainWetness.value === 0.85;
    const isTimeApplied = puddleMat.uTime.value === 12.34;
    const isNightApplied = puddleMat.uNightFactor.value === 1.0;

    expect(isWetnessApplied).toBe(true);
    expect(isTimeApplied).toBe(true);
    expect(isNightApplied).toBe(true);
    expect(puddleMat.uRippleIntensity.value).toBe(1.2);
    expect(puddleMat.uSunDirection.value.y).toBeCloseTo(1.0, 5);
    expect(puddleMat.uSunColor.value.getHex()).toBe(0x38bdf8);
    expect(puddleMat.uSkyHorizonColor.value.getHex()).toBe(0x0f172a);
    expect(puddleMat.uSkyZenithColor.value.getHex()).toBe(0x020617);
  });

  it("onBeforeCompile フックによってGLSLシェーダーコードに波紋計算・微風さざ波・法線変調・粗さ変調・解析的平面鏡面反射コードが注入されることを保証する", () => {
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
          #include <metalnessmap_fragment>
        }
      `,
    };

    puddleMat.onBeforeCompile(
      mockShader as unknown as THREE.WebGLProgramParametersWithUniforms,
      {} as unknown as THREE.WebGLRenderer,
    );

    // ユニフォームのバインド検証
    expect(mockShader.uniforms.uRainWetness).toBe(puddleMat.uRainWetness);
    expect(mockShader.uniforms.uTime).toBe(puddleMat.uTime);
    expect(mockShader.uniforms.uPuddleThreshold).toBe(puddleMat.uPuddleThreshold);
    expect(mockShader.uniforms.uRippleIntensity).toBe(puddleMat.uRippleIntensity);
    expect(mockShader.uniforms.uSunDirection).toBe(puddleMat.uSunDirection);
    expect(mockShader.uniforms.uSkyHorizonColor).toBe(puddleMat.uSkyHorizonColor);

    // GLSLコード注入の検証
    const hasRippleFunction = mockShader.fragmentShader.includes("calculateRainRipples");
    const hasCapillaryWaves = mockShader.fragmentShader.includes("calculateCapillaryWaves");
    const hasEnvReflection = mockShader.fragmentShader.includes("calculatePuddleEnvReflection");
    const hasPuddleNoise = mockShader.fragmentShader.includes("puddleFbm");
    const hasNormalModulation = mockShader.fragmentShader.includes("perturbedN");
    const hasRoughnessMirroring = mockShader.fragmentShader.includes(
      "roughnessFactor = mix(wetAsphaltRoughness, 0.02, puddleCore)",
    );
    const hasEmissivePlanarMirror = mockShader.fragmentShader.includes(
      "totalEmissiveRadiance += puddleEnvReflection * puddleCore",
    );

    expect(hasRippleFunction).toBe(true);
    expect(hasCapillaryWaves).toBe(true);
    expect(hasEnvReflection).toBe(true);
    expect(hasPuddleNoise).toBe(true);
    expect(hasNormalModulation).toBe(true);
    expect(hasRoughnessMirroring).toBe(true);
    expect(hasEmissivePlanarMirror).toBe(true);
  });

  it("JapaneseRoadMaterial でも車線の轍（Wheel Ruts）水たまりと解析的平面鏡面反射GLSLコードが注入されることを保証する", () => {
    const roadMat = new JapaneseRoadMaterial();
    roadMat.syncEnvironment({
      wetness: 0.78,
      time: 5.5,
      rippleIntensity: 0.25,
      sunColor: 0xfb923c,
      nightFactor: 0.35,
    });

    expect(roadMat.uRainWetness.value).toBe(0.78);
    expect(roadMat.uRippleIntensity.value).toBe(0.25);

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
          #include <metalnessmap_fragment>
        }
      `,
    };

    roadMat.onBeforeCompile(
      mockShader as unknown as THREE.WebGLProgramParametersWithUniforms,
      {} as unknown as THREE.WebGLRenderer,
    );

    const hasWheelRutBasin = mockShader.fragmentShader.includes("sampleRoadPuddleBasin");
    const hasRoadPuddleReflection = mockShader.fragmentShader.includes(
      "calculateRoadPuddleReflection",
    );
    const hasRoadEmissiveMirror = mockShader.fragmentShader.includes(
      "totalEmissiveRadiance += roadPuddleRefl * puddle",
    );
    const hasMultiScaleSampling =
      mockShader.fragmentShader.includes("coordFine") &&
      mockShader.fragmentShader.includes("coordMacro");
    const hasUpwardBumpNormal = mockShader.fragmentShader.includes(
      "vec3(dX + crackVal * 0.06, 1.0, dZ + crackVal * 0.06)",
    );

    expect(hasWheelRutBasin).toBe(true);
    expect(hasRoadPuddleReflection).toBe(true);
    expect(hasRoadEmissiveMirror).toBe(true);
    expect(hasMultiScaleSampling).toBe(true);
    expect(hasUpwardBumpNormal).toBe(true);
  });
});

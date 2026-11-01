import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  GinkgoFoliageMaterial,
  TreeBarkMaterial,
  createGinkgoBilobaCanopyGeometry,
} from "../shaders/treeShader";
import { assetManager } from "../assets/assetManager";

describe("GinkgoFoliageMaterial & TreeBarkMaterial - Physically Based Foliage & Bark Shader", () => {
  it("createGinkgoBilobaCanopyGeometry が球体塊ではなく実体3Dイチョウ扇形葉（葉柄・二股切れ込み・正規化UV）のロゼット樹冠メッシュを生成することを保証する", () => {
    const canopyGeo = createGinkgoBilobaCanopyGeometry();
    const posAttr = canopyGeo.getAttribute("position");
    const normAttr = canopyGeo.getAttribute("normal");
    const uvAttr = canopyGeo.getAttribute("uv");
    const indexAttr = canopyGeo.getIndex();

    expect(posAttr).toBeDefined();
    expect(normAttr).toBeDefined();
    expect(uvAttr).toBeDefined();
    expect(indexAttr).not.toBeNull();

    // 1枚18頂点（葉柄2 + 移行部2 + 中間扇7 + 二股外縁7）の整数倍で構成されていること
    expect(posAttr.count % 18).toBe(0);
    expect(posAttr.count).toBeGreaterThanOrEqual(18 * 100);

    // 1枚21三角形 = 63インデックスの整数倍であること
    expect(indexAttr!.count % 63).toBe(0);

    // UVが [0, 1] のイチョウ葉ローカル座標（u=扇幅, v=葉柄0→葉先1）に収まり、二股ノッチ頂点(u=0.5, v=0.68)が存在すること
    let hasPetioleBase = false;
    let hasBilobaNotchVertex = false;
    let hasLobeCrestVertex = false;

    for (let i = 0; i < uvAttr.count; i++) {
      const u = uvAttr.getX(i);
      const v = uvAttr.getY(i);
      expect(u).toBeGreaterThanOrEqual(0.0);
      expect(u).toBeLessThanOrEqual(1.0);
      expect(v).toBeGreaterThanOrEqual(0.0);
      expect(v).toBeLessThanOrEqual(1.0);

      const isPetiole = v < 0.01 && Math.abs(u - 0.47) < 0.02;
      if (isPetiole) {
        hasPetioleBase = true;
      }
      const isBilobaNotch = Math.abs(u - 0.5) < 0.01 && Math.abs(v - 0.68) < 0.02;
      if (isBilobaNotch) {
        hasBilobaNotchVertex = true;
      }
      const isLobeCrest = (Math.abs(u - 0.34) < 0.02 || Math.abs(u - 0.66) < 0.02) && v > 0.98;
      if (isLobeCrest) {
        hasLobeCrestVertex = true;
      }
    }

    expect(hasPetioleBase).toBe(true);
    expect(hasBilobaNotchVertex).toBe(true);
    expect(hasLobeCrestVertex).toBe(true);
  });

  it("GinkgoFoliageMaterial の初期ユニフォーム（風揺れ・逆光SSS・黄金葉グラデーション）が正しく設定されることを保証する", () => {
    const foliageMat = new GinkgoFoliageMaterial({
      baseColor: 0xeab308,
      tipColor: 0xfef08a,
      autumnAccentColor: 0xf97316,
      windSpeed: 1.8,
      windStrength: 0.25,
      sssIntensity: 0.92,
    });

    expect(foliageMat.uTime.value).toBe(0.0);
    expect(foliageMat.uRainWetness.value).toBe(0.0);
    expect(foliageMat.uWindSpeed.value).toBeCloseTo(1.8);
    expect(foliageMat.uWindStrength.value).toBeCloseTo(0.25);
    expect(foliageMat.uSssIntensity.value).toBeCloseTo(0.92);
    expect(foliageMat.side).toBe(THREE.DoubleSide);
  });

  it("GinkgoFoliageMaterial の onBeforeCompile で階層型風揺れ・イチョウ扇形葉脈・逆光SSSのGLSLが注入されることを保証する", () => {
    const foliageMat = new GinkgoFoliageMaterial();
    const mockShader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: `
        #include <common>
        void main() {
          #include <begin_vertex>
          #include <worldpos_vertex>
        }
      `,
      fragmentShader: `
        #include <common>
        void main() {
          #include <color_fragment>
          #include <roughnessmap_fragment>
          #include <metalnessmap_fragment>
          #include <normal_fragment_maps>
        }
      `,
    };

    foliageMat.onBeforeCompile(
      mockShader as unknown as THREE.WebGLProgramParametersWithUniforms,
      {} as unknown as THREE.WebGLRenderer,
    );

    expect(mockShader.uniforms.uWindSpeed).toBeDefined();
    expect(mockShader.uniforms.uSssIntensity).toBeDefined();
    expect(mockShader.vertexShader).toContain("bladeTipWeight");
    expect(mockShader.vertexShader).toContain("leafFlutter");
    expect(mockShader.vertexShader).toContain("primarySwayX");
    expect(mockShader.fragmentShader).toContain("sampleGinkgoVenation");
    expect(mockShader.fragmentShader).toContain("bilobaNotch");
    expect(mockShader.fragmentShader).toContain("leafVeinBump");
    expect(mockShader.fragmentShader).toContain("sssContribution");
    expect(mockShader.fragmentShader).toContain("totalEmissiveRadiance +=");
  });

  it("TreeBarkMaterial の onBeforeCompile で縦溝樹皮ノイズ・根元コケ・主幹同期スウェイ・雨天水筋グロスのGLSLが注入されることを保証する", () => {
    const barkMat = new TreeBarkMaterial();
    const mockShader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: `
        #include <common>
        void main() {
          #include <begin_vertex>
          #include <worldpos_vertex>
        }
      `,
      fragmentShader: `
        #include <common>
        void main() {
          #include <color_fragment>
          #include <roughnessmap_fragment>
          #include <metalnessmap_fragment>
          #include <normal_fragment_maps>
        }
      `,
    };

    barkMat.onBeforeCompile(
      mockShader as unknown as THREE.WebGLProgramParametersWithUniforms,
      {} as unknown as THREE.WebGLRenderer,
    );

    expect(mockShader.uniforms.uBarkDarkColor).toBeDefined();
    expect(mockShader.uniforms.uMossColor).toBeDefined();
    expect(mockShader.vertexShader).toContain("primarySwayX");
    expect(mockShader.fragmentShader).toContain("sampleBarkFurrows");
    expect(mockShader.fragmentShader).toContain("mossMask");
    expect(mockShader.fragmentShader).toContain("mat3(viewMatrix) * barkWorldBump");
  });

  it("syncEnvironment で天候・風速・太陽ベクトル・夜間係数が葉っぱシェーダーと木シェーダーに正しく同期され、street_tree アセット定義が存在することを保証する", () => {
    const foliageMat = new GinkgoFoliageMaterial();
    const barkMat = new TreeBarkMaterial();
    const sunDir = new THREE.Vector3(0.4, 0.7, 0.5);

    foliageMat.syncEnvironment({
      wetness: 0.95,
      time: 42.0,
      windSpeed: 2.3,
      windStrength: 0.38,
      sunDirection: sunDir,
      sunColor: 0xffaa44,
      nightFactor: 0.75,
    });
    barkMat.syncEnvironment({
      wetness: 0.95,
      time: 42.0,
      windSpeed: 2.3,
      windStrength: 0.38,
      nightFactor: 0.75,
    });

    expect(foliageMat.uRainWetness.value).toBeCloseTo(0.95);
    expect(foliageMat.uTime.value).toBeCloseTo(42.0);
    expect(foliageMat.uWindSpeed.value).toBeCloseTo(2.3);
    expect(foliageMat.uWindStrength.value).toBeCloseTo(0.38);
    expect(foliageMat.uNightFactor.value).toBeCloseTo(0.75);
    expect(barkMat.uRainWetness.value).toBeCloseTo(0.95);
    expect(barkMat.uWindSpeed.value).toBeCloseTo(2.3);

    const treeModelConfig = assetManager.getModelConfig("street_tree");
    expect(treeModelConfig).toBeDefined();
    expect(treeModelConfig?.path).toBe("/models/street_tree.glb");
    expect(treeModelConfig?.subparts?.trunk).toBe("Tree_Trunk");
    expect(treeModelConfig?.subparts?.foliage).toBe("Tree_Foliage");
  });
});

import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { Procedural3DTextureGenerator } from "../textures/procedural3DTexture";

describe("3Dプロシージャルテクスチャ生成システムの仕様検証", () => {
  it("アスファルト用3Dボリュームテクスチャが指定解像度と4チャンネル（RGBA）で正常に構築されることを保証する", () => {
    const size = 16; // テスト実行速度のため16x16x16で検証
    const texture = Procedural3DTextureGenerator.generateAsphalt3DTexture(size);

    // 1. Data3DTexture インスタンスとして生成されていること
    expect(texture).toBeInstanceOf(THREE.Data3DTexture);

    // 2. 3次元の解像度が指定サイズと一致すること
    const img = texture.image;
    expect(img.width).toBe(size);
    expect(img.height).toBe(size);
    expect(img.depth).toBe(size);

    // 3. ボクセルデータが RGBA 4チャンネル（size^3 * 4 バイト）で確保されていること
    const expectedByteLength = size * size * size * 4;
    const data = img.data as Uint8Array;
    expect(data).toBeDefined();
    expect(data.byteLength).toBe(expectedByteLength);

    // 4. テクスチャのラッピング設定が3次元すべてで RepeatWrapping であること（シームレスサンプリング保証）
    expect(texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(texture.wrapT).toBe(THREE.RepeatWrapping);
    expect(texture.wrapR).toBe(THREE.RepeatWrapping);

    // 5. 各チャンネル（R: 砕石骨材ハイト, G: 骨材間ボイド＆クラック, B: 歴青バインダー, A: 水たまり盆地）すべてに有効な立体分布が格納されていること
    let hasNonZeroR = false;
    let hasNonZeroG = false;
    let hasNonZeroB = false;
    let hasNonZeroA = false;
    for (let i = 0; i < data.length; i += 4) {
      const isValidR = data[i] > 15 && data[i] < 245;
      if (isValidR) {
        hasNonZeroR = true;
      }
      const isValidG = data[i + 1] > 10;
      if (isValidG) {
        hasNonZeroG = true;
      }
      const isValidB = data[i + 2] > 15 && data[i + 2] < 245;
      if (isValidB) {
        hasNonZeroB = true;
      }
      const isValidA = data[i + 3] > 15 && data[i + 3] < 245;
      if (isValidA) {
        hasNonZeroA = true;
      }
    }
    expect(hasNonZeroR).toBe(true);
    expect(hasNonZeroG).toBe(true);
    expect(hasNonZeroB).toBe(true);
    expect(hasNonZeroA).toBe(true);
  });

  it("JapaneseRoadMaterial が 64^3 3Dアスファルトテクスチャと重複排除済み4階層マルチスケールGLSLチャンクを正常に構成することを保証する", async () => {
    const { JapaneseRoadMaterial } = await import("../roads/japaneseRoadMaterial");
    const { PuddleMaterial } = await import("../shaders/puddleShader");
    const mat = new JapaneseRoadMaterial();
    const puddleMat = new PuddleMaterial();
    expect(mat.uRoadNoise3D.value).toBeInstanceOf(THREE.Data3DTexture);
    expect(mat.uRoadNoise3D.value.image.width).toBe(64);
    expect(mat.uRoadNoise3D.value).toBe(Procedural3DTextureGenerator.getSharedAsphalt3DTexture(64));
    expect(puddleMat.uRoadVolumeTex.value).toBe(mat.uRoadNoise3D.value);

    const mockShader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: "#include <common>\nvoid main() {\n#include <worldpos_vertex>\n}",
      fragmentShader:
        "#include <common>\nvoid main() {\n#include <metalnessmap_fragment>\n#include <normal_fragment_maps>\n}",
    };
    mat.onBeforeCompile(
      mockShader as unknown as THREE.WebGLProgramParametersWithUniforms,
      {} as THREE.WebGLRenderer,
    );
    expect(mockShader.vertexShader).toContain("vLocalRoadPos = transformed;");
    expect(mockShader.fragmentShader).toContain("uniform sampler3D uRoadNoise3D;");
    expect(mockShader.fragmentShader).toContain("varying vec3 vLocalRoadPos;");
    expect(mockShader.fragmentShader).toContain("coordMicro");
    expect(mockShader.fragmentShader).toContain("silicaChip");
    expect(mockShader.fragmentShader).toContain("mineralGrain");
    expect(mockShader.fragmentShader).toContain("tireTrackWear");
    // <metalnessmap_fragment> で計算した 4 階層ボクセル（voxelMicro..Macro）を <normal_fragment_maps> で再利用し、
    // texture(uRoadNoise3D, ...) の総呼び出し回数が 10 回（中心4 + 近傍差分6）に抑えられていることを保証する
    const sampler3DCallMatches = mockShader.fragmentShader.match(/texture\(uRoadNoise3D,/g) ?? [];
    expect(sampler3DCallMatches.length).toBe(10);
    expect(mockShader.fragmentShader).not.toContain("noiseVoxelMicro");
  });

  it("イチョウ葉っぱ＆樹皮用3Dボリュームテクスチャが4チャンネル（葉脈・縦溝・コケ・SSS）で正常に生成されることを保証する", () => {
    const size = 12;
    const texture = Procedural3DTextureGenerator.generateFoliageBark3DTexture(size);

    expect(texture).toBeInstanceOf(THREE.Data3DTexture);
    expect(texture.format).toBe(THREE.RGBAFormat);
    expect(texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(texture.wrapT).toBe(THREE.RepeatWrapping);
    expect(texture.wrapR).toBe(THREE.RepeatWrapping);

    const data = texture.image.data as Uint8Array;
    expect(data.byteLength).toBe(size * size * size * 4);
  });

  it("東京駅赤レンガ・丸の内白御影石・お堀石垣用3Dボリュームテクスチャが正常に生成されることを保証する", () => {
    const size = 12;
    const texture = Procedural3DTextureGenerator.generateArchitecture3DTexture(size);

    expect(texture).toBeInstanceOf(THREE.Data3DTexture);
    expect(texture.format).toBe(THREE.RGBAFormat);
    expect(texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(texture.wrapT).toBe(THREE.RepeatWrapping);
    expect(texture.wrapR).toBe(THREE.RepeatWrapping);

    const data = texture.image.data as Uint8Array;
    expect(data.byteLength).toBe(size * size * size * 4);
  });

  it("3次元トーラス周期ノイズが境界(0.0と1.0)で数学的に完全連続であることを保証する", () => {
    const v0 = Procedural3DTextureGenerator.samplePeriodicVolumeNoise3D(0.0, 0.37, 0.64, 4);
    const v1 = Procedural3DTextureGenerator.samplePeriodicVolumeNoise3D(1.0, 0.37, 0.64, 4);
    expect(v0).toBeCloseTo(v1, 6);

    const vy0 = Procedural3DTextureGenerator.samplePeriodicVolumeNoise3D(0.42, 0.0, 0.81, 4);
    const vy1 = Procedural3DTextureGenerator.samplePeriodicVolumeNoise3D(0.42, 1.0, 0.81, 4);
    expect(vy0).toBeCloseTo(vy1, 6);
  });

  it("雨煙・大気フォグ用3DボリュームテクスチャがRedFormatで正常に生成されることを保証する", () => {
    const size = 8;
    const texture = Procedural3DTextureGenerator.generateFog3DTexture(size);

    expect(texture).toBeInstanceOf(THREE.Data3DTexture);
    expect(texture.format).toBe(THREE.RedFormat);
    expect(texture.image.depth).toBe(size);
    const fogData = texture.image.data as Uint8Array;
    expect(fogData).toBeDefined();
    expect(fogData.byteLength).toBe(size * size * size);
  });

  it("ボリュメトリック雲シェーダー用3D Perlin-Worleyボリュームテクスチャが4チャンネル（RGBA）で正常に生成されることを保証する", () => {
    const size = 12;
    const texture = Procedural3DTextureGenerator.generateCloud3DTexture(size);

    expect(texture).toBeInstanceOf(THREE.Data3DTexture);
    expect(texture.format).toBe(THREE.RGBAFormat);
    expect(texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(texture.wrapT).toBe(THREE.RepeatWrapping);
    expect(texture.wrapR).toBe(THREE.RepeatWrapping);

    const data = texture.image.data as Uint8Array;
    expect(data.byteLength).toBe(size * size * size * 4);
  });

  it("トヨタ クラウン セダン車内内装用3Dボリュームテクスチャ（3D杢目・セミアニリン本革シボ・パンチングディンプル・サテンヘアライン）が正常に生成されることを保証する", () => {
    const size = 12;
    const texture = Procedural3DTextureGenerator.generateCrownInterior3DTexture(size);

    expect(texture).toBeInstanceOf(THREE.Data3DTexture);
    expect(texture.format).toBe(THREE.RGBAFormat);
    expect(texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(texture.wrapT).toBe(THREE.RepeatWrapping);
    expect(texture.wrapR).toBe(THREE.RepeatWrapping);

    const data = texture.image.data as Uint8Array;
    expect(data.byteLength).toBe(size * size * size * 4);

    let hasWoodR = false;
    let hasLeatherG = false;
    let hasPerforatedB = false;
    let hasSatinA = false;
    for (let i = 0; i < data.length; i += 4) {
      const isWoodRInRange = data[i] > 10 && data[i] < 245;
      if (isWoodRInRange) hasWoodR = true;
      const isLeatherGInRange = data[i + 1] > 10 && data[i + 1] < 245;
      if (isLeatherGInRange) hasLeatherG = true;
      const isPerforatedBInRange = data[i + 2] > 10 && data[i + 2] < 245;
      if (isPerforatedBInRange) hasPerforatedB = true;
      const isSatinAInRange = data[i + 3] > 10 && data[i + 3] < 245;
      if (isSatinAInRange) hasSatinA = true;
    }
    expect(hasWoodR).toBe(true);
    expect(hasLeatherG).toBe(true);
    expect(hasPerforatedB).toBe(true);
    expect(hasSatinA).toBe(true);
  });

  it("CarModel.applyCrownInterior3DTexture が5種類の車内マテリアル（wood / leather / perforated / satin / alcantara）に3オクターブ3Dサンプリング・ビュースペース接線法線バンプ・物理スペキュラシェーダーを注入することを保証する", async () => {
    const { CarModel } = await import("../vehicle/carModel");
    const variants = [
      { variant: "wood" as const, expectedCode: 0 },
      { variant: "leather" as const, expectedCode: 1 },
      { variant: "perforated" as const, expectedCode: 2 },
      { variant: "satin" as const, expectedCode: 3 },
      { variant: "alcantara" as const, expectedCode: 4 },
    ];

    for (const { variant, expectedCode } of variants) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5 });
      CarModel.prototype.applyCrownInterior3DTexture(mat, variant);
      expect(mat.userData.crownInterior3DVariant).toBe(variant);

      const mockShader = {
        uniforms: {} as Record<string, { value: unknown }>,
        vertexShader: "#include <common>\nvoid main() {\n#include <begin_vertex>\n}",
        fragmentShader:
          "#include <common>\nvoid main() {\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>\n#include <lights_fragment_end>\n}",
      };
      mat.onBeforeCompile(
        mockShader as unknown as THREE.WebGLProgramParametersWithUniforms,
        {} as THREE.WebGLRenderer,
      );

      expect(mockShader.uniforms.uCrownInteriorVariant.value).toBe(expectedCode);
      expect(mockShader.vertexShader).toContain("vCrownLocalPos = position;");
      expect(mockShader.fragmentShader).toContain("uniform sampler3D uCrownInteriorVolumeTex;");
      expect(mockShader.fragmentShader).toContain("crownVoxA");
      expect(mockShader.fragmentShader).toContain("crownVoxB");
      expect(mockShader.fragmentShader).toContain("crownVoxC");
      expect(mockShader.fragmentShader).toContain("tangentXViewCrown");
      expect(mockShader.fragmentShader).toContain("tangentYViewCrown");
      expect(mockShader.fragmentShader).toContain("clearcoatSheen");
      expect(mockShader.fragmentShader).toContain("velvetRim");
    }
  });

  it("道路標示ペイント・縁石・ガードレール・鋳鉄マンホール・道路標識用3Dボリュームテクスチャが正常に生成されることを保証する", () => {
    const size = 12;
    const texture = Procedural3DTextureGenerator.generateRoadMarkingProp3DTexture(size);

    expect(texture).toBeInstanceOf(THREE.Data3DTexture);
    expect(texture.format).toBe(THREE.RGBAFormat);
    expect(texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(texture.wrapT).toBe(THREE.RepeatWrapping);
    expect(texture.wrapR).toBe(THREE.RepeatWrapping);

    const data = texture.image.data as Uint8Array;
    expect(data.byteLength).toBe(size * size * size * 4);
  });

  it("車両エクステリア（マイカ塗装・クリアコート・タイヤ加硫ゴム・ホイール切削）用3Dボリュームテクスチャが正常に生成されることを保証する", () => {
    const size = 12;
    const texture = Procedural3DTextureGenerator.generateVehicleExterior3DTexture(size);

    expect(texture).toBeInstanceOf(THREE.Data3DTexture);
    expect(texture.format).toBe(THREE.RGBAFormat);
    expect(texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(texture.wrapT).toBe(THREE.RepeatWrapping);
    expect(texture.wrapR).toBe(THREE.RepeatWrapping);

    const data = texture.image.data as Uint8Array;
    expect(data.byteLength).toBe(size * size * size * 4);
  });

  it("皇居お堀・水面用3Dコースティクス・マイクロ波紋ボリュームテクスチャおよび WaterSurfaceMaterial 統合が正常に機能することを保証する", async () => {
    const size = 12;
    const texture = Procedural3DTextureGenerator.generateWaterCaustics3DTexture(size);

    expect(texture).toBeInstanceOf(THREE.Data3DTexture);
    expect(texture.format).toBe(THREE.RGBAFormat);
    expect(texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(texture.wrapT).toBe(THREE.RepeatWrapping);
    expect(texture.wrapR).toBe(THREE.RepeatWrapping);

    const { WaterSurfaceMaterial } = await import("../shaders/waterShader");
    const waterMat = new WaterSurfaceMaterial();
    expect(waterMat.uWaterVolumeTex.value).toBeInstanceOf(THREE.Data3DTexture);
  });

  it("AssetManager が全9種の3Dボリュームテクスチャ設定を検証しキャッシュ取得できることを保証する", async () => {
    const { assetManager } = await import("../assets/assetManager");
    const ids = [
      "asphalt_3d",
      "foliage_bark_3d",
      "architecture_3d",
      "volumetric_fog_3d",
      "volumetric_cloud_3d",
      "crown_interior_3d",
      "road_marking_prop_3d",
      "vehicle_exterior_3d",
      "water_caustics_3d",
    ];
    for (const id of ids) {
      const config = assetManager.getTexture3DConfig(id);
      expect(config).toBeDefined();
      const tex = assetManager.getOrCreate3DTexture(id);
      expect(tex).toBeInstanceOf(THREE.Data3DTexture);
    }
  });
});

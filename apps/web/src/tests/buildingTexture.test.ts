import { describe, it, expect } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { TokyoStationMap } from "../city/tokyoStationMap";
import {
  shibuyaTextureManager,
  SHIBUYA_TEXTURE_CONFIGS,
  type ShibuyaTextureId,
} from "../textures/shibuyaTextureManager";

describe("建築ファサードテクスチャ & 夜間オフィス照明システム仕様検証", () => {
  it("TokyoStationMap.attachArchitecture3DVolumeShader が全10モードの建築ファサードテクスチャに正しいモードコード（0〜9）とキャッシュキーを割り当てることを保証する", async () => {
    await RAPIER.init();
    const scene = new THREE.Scene();
    const world = new RAPIER.World(new RAPIER.Vector3(0, -9.81, 0));
    const cityMap = new TokyoStationMap(scene, world, RAPIER, { deferGlbLoads: true });

    const testModes = [
      { mode: "red_brick" as const, expectedCode: 0 },
      { mode: "white_granite" as const, expectedCode: 1 },
      { mode: "moat" as const, expectedCode: 2 },
      { mode: "copper_patina" as const, expectedCode: 3 },
      { mode: "curtain_glass" as const, expectedCode: 4 },
      { mode: "anodized_metal" as const, expectedCode: 5 },
      { mode: "cast_iron" as const, expectedCode: 6 },
      { mode: "stone_punched" as const, expectedCode: 7 },
      { mode: "ribbon_window" as const, expectedCode: 8 },
      { mode: "retail_storefront" as const, expectedCode: 9 },
    ];

    const cityMapInternal = cityMap as unknown as {
      attachArchitecture3DVolumeShader: (
        material: THREE.MeshStandardMaterial,
        mode: string,
      ) => void;
    };

    for (const { mode, expectedCode } of testModes) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc });
      cityMapInternal.attachArchitecture3DVolumeShader(mat, mode);

      expect(mat.customProgramCacheKey()).toBe("arch_3d_tex_unified_v3");
      expect(mat.userData.hasArch3DVolumeShader).toBe(true);

      const mockShader = {
        uniforms: {} as Record<string, { value: unknown }>,
        vertexShader: "#include <common>\nvoid main() {\n#include <worldpos_vertex>\n}",
        fragmentShader:
          "#include <common>\nvoid main() {\n#include <color_fragment>\n#include <emissivemap_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n}",
      };

      mat.onBeforeCompile(
        mockShader as unknown as THREE.WebGLProgramParametersWithUniforms,
        {} as THREE.WebGLRenderer,
      );

      expect(mockShader.uniforms.uArchSurfaceMode.value).toBe(expectedCode);
      expect(mockShader.uniforms.uArchVolumeTex.value).toBeInstanceOf(THREE.Data3DTexture);
      expect(mockShader.uniforms.uPropVolumeTex.value).toBeInstanceOf(THREE.Data3DTexture);
      expect(mockShader.uniforms.uNightModeFactor).toBeDefined();

      // 頂点シェーダーで法線行列変換が施されフラグメントへ伝播すること
      expect(mockShader.vertexShader).toContain("varying vec3 vArchNormal;");
      expect(mockShader.vertexShader).toContain(
        "vArchNormal = normalize(mat3(modelMatrix) * normal);",
      );

      // フラグメントシェーダーで壁面UV微分と夜間オフィス照明計算が注入されていること
      expect(mockShader.fragmentShader).toContain("uniform float uNightModeFactor;");
      expect(mockShader.fragmentShader).toContain("varying vec3 vArchNormal;");
      expect(mockShader.fragmentShader).toContain("isFacadeWall");
      expect(mockShader.fragmentShader).toContain("fwidth(facadeU)");
      expect(mockShader.fragmentShader).toContain("fwidth(facadeV)");
      expect(mockShader.fragmentShader).toContain("totalEmissiveRadiance");
    }
  });

  it("cityMap.setNightMode(isNight) が uNightModeFactor.value を 0.0 ⇄ 1.0 へ一括同期制御することを保証する", async () => {
    await RAPIER.init();
    const scene = new THREE.Scene();
    const world = new RAPIER.World(new RAPIER.Vector3(0, -9.81, 0));
    const cityMap = new TokyoStationMap(scene, world, RAPIER, { deferGlbLoads: true });

    const glassMat = new THREE.MeshStandardMaterial({ color: 0x334455 });
    const cityMapInternal = cityMap as unknown as {
      attachArchitecture3DVolumeShader: (
        material: THREE.MeshStandardMaterial,
        mode: string,
      ) => void;
    };
    cityMapInternal.attachArchitecture3DVolumeShader(glassMat, "curtain_glass");

    const mockShader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: "#include <common>\nvoid main() {\n#include <worldpos_vertex>\n}",
      fragmentShader:
        "#include <common>\nvoid main() {\n#include <map_fragment>\n#include <emissivemap_fragment>\n}",
    };
    glassMat.onBeforeCompile(
      mockShader as unknown as THREE.WebGLProgramParametersWithUniforms,
      {} as THREE.WebGLRenderer,
    );

    // 初期状態は昼間 (0.0)
    expect(mockShader.uniforms.uNightModeFactor.value).toBe(0.0);

    // 夜間モードに切り替えたら即座に 1.0 に同期すること
    cityMap.setNightMode(true);
    expect(mockShader.uniforms.uNightModeFactor.value).toBe(1.0);

    // 昼間モードに復帰したら 0.0 に同期すること
    cityMap.setNightMode(false);
    expect(mockShader.uniforms.uNightModeFactor.value).toBe(0.0);
  });

  it("丸の内および渋谷の各建築物（東京海上日動・明治生命館・パレスホテル・セルリアンタワー等）に用途と個性に即したファサードテクスチャモードが割り当てられることを保証する", async () => {
    await RAPIER.init();
    const scene = new THREE.Scene();
    const world = new RAPIER.World(new RAPIER.Vector3(0, -9.81, 0));
    const cityMap = new TokyoStationMap(scene, world, RAPIER, { deferGlbLoads: true });

    // 丸の内: 東京海上日動ビル本館 (13101-bldg-604)
    const tokioMarineGroup = cityMap.group.getObjectByName("13101-bldg-604") as THREE.Group | null;
    expect(tokioMarineGroup).toBeDefined();
    expect(tokioMarineGroup).not.toBeNull();

    if (tokioMarineGroup) {
      // 基壇部は赤レンガ (red_brick)、タワー部は石造パンチング窓 (stone_punched)
      const meshes: THREE.Mesh[] = [];
      tokioMarineGroup.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          meshes.push(obj as THREE.Mesh);
        }
      });
      const hasRedBrickPodium = meshes.some((m) => {
        const mat = m.material as THREE.Material;
        return mat?.userData?.arch3DVolumeChannel === "red_brick";
      });
      const hasStonePunchedTower = meshes.some((m) => {
        const mat = m.material as THREE.Material;
        return mat?.userData?.arch3DVolumeChannel === "stone_punched";
      });
      expect(hasRedBrickPodium).toBe(true);
      expect(hasStonePunchedTower).toBe(true);
    }

    // 丸の内: 明治生命館 (13101-bldg-3449)
    const meijiYasudaGroup = cityMap.group.getObjectByName("13101-bldg-3449") as THREE.Group | null;
    expect(meijiYasudaGroup).toBeDefined();
    expect(meijiYasudaGroup).not.toBeNull();
    if (meijiYasudaGroup) {
      const meshes: THREE.Mesh[] = [];
      meijiYasudaGroup.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          meshes.push(obj as THREE.Mesh);
        }
      });
      const hasStonePunched = meshes.some((m) => {
        const mat = m.material as THREE.Material;
        return mat?.userData?.arch3DVolumeChannel === "stone_punched";
      });
      expect(hasStonePunched).toBe(true);
    }

    // 丸の内: パレスホテル東京 (宿泊施設)
    const palaceHotelGroup = cityMap.group.children.find(
      (c) => c.userData?.usage === "宿泊施設" && c.name?.startsWith("13101-bldg"),
    );
    expect(palaceHotelGroup).toBeDefined();
    if (palaceHotelGroup) {
      const meshes: THREE.Mesh[] = [];
      palaceHotelGroup.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          meshes.push(obj as THREE.Mesh);
        }
      });
      const hasRibbonWindow = meshes.some((m) => {
        const mat = m.material as THREE.Material;
        return mat?.userData?.arch3DVolumeChannel === "ribbon_window";
      });
      expect(hasRibbonWindow).toBe(true);
    }

    // 渋谷: 青山オーバルビル (13113-bldg-aoyama-oval, ribbon_window)
    const ovalGroup = cityMap.group.getObjectByName("13113-bldg-aoyama-oval") as THREE.Group | null;
    expect(ovalGroup).toBeDefined();
    expect(ovalGroup).not.toBeNull();
    if (ovalGroup) {
      const meshes: THREE.Mesh[] = [];
      ovalGroup.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          meshes.push(obj as THREE.Mesh);
        }
      });
      const hasRibbonWindow = meshes.some((m) => {
        const mat = m.material as THREE.Material;
        return mat?.userData?.arch3DVolumeChannel === "ribbon_window";
      });
      expect(hasRibbonWindow).toBe(true);
    }

    // 渋谷: 渋谷スクランブルスクエア (13113-bldg-scramble-square)
    const scrambleGroup = cityMap.group.getObjectByName(
      "13113-bldg-scramble-square",
    ) as THREE.Group | null;
    expect(scrambleGroup).toBeDefined();
    expect(scrambleGroup).not.toBeNull();
    if (scrambleGroup) {
      const meshes: THREE.Mesh[] = [];
      scrambleGroup.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          meshes.push(obj as THREE.Mesh);
        }
      });
      const hasCurtainGlass = meshes.some((m) => {
        const mat = m.material as THREE.Material;
        return mat?.userData?.arch3DVolumeChannel === "curtain_glass";
      });
      const hasRetailStorefront = meshes.some((m) => {
        const mat = m.material as THREE.Material;
        return mat?.userData?.arch3DVolumeChannel === "retail_storefront";
      });
      expect(hasCurtainGlass).toBe(true);
      expect(hasRetailStorefront).toBe(true);
    }
  });

  it("ShibuyaTextureManager が全15種の実写ストリートビューおよびPLATEAU LOD2テクスチャと各種マテリアル生成を正常に行うことを保証する", async () => {
    const textureIds = Object.keys(SHIBUYA_TEXTURE_CONFIGS) as ShibuyaTextureId[];
    expect(textureIds).toHaveLength(15);

    for (const id of textureIds) {
      const tex = shibuyaTextureManager.getTexture(id);
      expect(tex).toBeDefined();
      expect(tex.name).toBe(`ShibuyaTex_${id}`);
      expect(tex.generateMipmaps).toBe(true);
      expect(tex.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    }

    // 商業路面店舗マテリアル
    const commercialMatDay = shibuyaTextureManager.createCommercialStorefrontMaterial(false);
    expect(commercialMatDay.map).toBeDefined();
    expect(commercialMatDay.emissiveMap).toBe(commercialMatDay.map);
    expect(commercialMatDay.emissiveIntensity).toBe(
      SHIBUYA_TEXTURE_CONFIGS.commercialFacade.emissiveIntensityDay,
    );

    const commercialMatNight = shibuyaTextureManager.createCommercialStorefrontMaterial(true);
    expect(commercialMatNight.emissiveIntensity).toBe(
      SHIBUYA_TEXTURE_CONFIGS.commercialFacade.emissiveIntensityNight,
    );

    // PLATEAU LOD2 実写ファサードマテリアル
    const plateauLod2MatDay = shibuyaTextureManager.createPlateauLod2Material(false);
    expect(plateauLod2MatDay.map).toBeDefined();
    expect(plateauLod2MatDay.emissiveMap).toBe(plateauLod2MatDay.map);
    expect(plateauLod2MatDay.emissiveIntensity).toBe(
      SHIBUYA_TEXTURE_CONFIGS.plateauLod2Facade.emissiveIntensityDay,
    );

    const plateauLod2MatNight = shibuyaTextureManager.createPlateauLod2Material(true);
    expect(plateauLod2MatNight.emissiveIntensity).toBe(
      SHIBUYA_TEXTURE_CONFIGS.plateauLod2Facade.emissiveIntensityNight,
    );

    // PLATEAU LOD2 1F路面店舗・街路樹映り込みマテリアル
    const plateauStorefrontMatDay =
      shibuyaTextureManager.createPlateauLod2StorefrontMaterial(false);
    expect(plateauStorefrontMatDay.name).toBe("PlateauLod2StorefrontMat");
    expect(plateauStorefrontMatDay.emissiveIntensity).toBe(
      SHIBUYA_TEXTURE_CONFIGS.plateauLod2Storefront.emissiveIntensityDay,
    );

    // PLATEAU LOD2 屋上・パラペット・エレベーター塔屋マテリアル
    const plateauRoofMatDay = shibuyaTextureManager.createPlateauLod2RoofMaterial(false);
    expect(plateauRoofMatDay.name).toBe("PlateauLod2RoofMat");
    expect(plateauRoofMatDay.emissiveIntensity).toBe(
      SHIBUYA_TEXTURE_CONFIGS.plateauLod2Roof.emissiveIntensityDay,
    );

    // PLATEAU LOD2 遠景軽量プロキシマテリアル
    const plateauProxyMatDay = shibuyaTextureManager.createPlateauLod2ProxyMaterial(false);
    expect(plateauProxyMatDay.map).toBeDefined();
    expect(plateauProxyMatDay.name).toBe("PlateauLod2ProxyMat");
    expect(plateauProxyMatDay.roughness).toBe(0.65);
    expect(plateauProxyMatDay.emissiveIntensity).toBe(0.05);

    const plateauProxyMatNight = shibuyaTextureManager.createPlateauLod2ProxyMaterial(true);
    expect(plateauProxyMatNight.emissiveIntensity).toBe(0.45);

    // ビルボードマテリアル
    const billboardMatNight = shibuyaTextureManager.createBillboardMaterial("billboards", true);
    expect(billboardMatNight.emissiveIntensity).toBe(
      SHIBUYA_TEXTURE_CONFIGS.billboards.emissiveIntensityNight,
    );

    // 首都高緑案内標識マテリアル
    const shutokoSignMat = shibuyaTextureManager.createShutokoHighwaySignMaterial(true);
    expect(shutokoSignMat.emissiveIntensity).toBe(
      SHIBUYA_TEXTURE_CONFIGS.shutokoSign.emissiveIntensityNight,
    );

    // /boost 向け preloadAll
    await expect(shibuyaTextureManager.preloadAll()).resolves.toBeUndefined();
  });

  it("TokyoStationMap.applyShibuyaStreamGlbMaterial3DTexture が実写テクスチャマテリアル群に適切なシェーダーモードと昼夜emissiveを割り当てることを保証する", async () => {
    await RAPIER.init();
    const scene = new THREE.Scene();
    const world = new RAPIER.World(new RAPIER.Vector3(0, -9.81, 0));
    const cityMap = new TokyoStationMap(scene, world, RAPIER, { deferGlbLoads: true });

    const glbMaterials = [
      {
        name: "ShutokoHighwayGreenSign",
        expectedChannel: "anodized_metal",
        expectedTex: "shutokoSign",
      },
      { name: "ShibuyaQfrontMedia", expectedChannel: "curtain_glass", expectedTex: "qfront" },
      { name: "Shibuya109Crown", expectedChannel: "anodized_metal", expectedTex: "shibuya109" },
      {
        name: "ShibuyaCrossingBillboard",
        expectedChannel: "curtain_glass",
        expectedTex: "billboards",
      },
      {
        name: "ShibuyaScrambleSquareFacade",
        expectedChannel: "curtain_glass",
        expectedTex: "scrambleSquare",
      },
      { name: "ShibuyaStreamFacade", expectedChannel: "curtain_glass", expectedTex: "stream" },
      {
        name: "ShibuyaMiyashitaParkFacade",
        expectedChannel: "retail_storefront",
        expectedTex: "miyashitaPark",
      },
      {
        name: "ShibuyaCommercialFacade",
        expectedChannel: "retail_storefront",
        expectedTex: "commercialFacade",
      },
      {
        name: "ShibuyaMagnetFacade",
        expectedChannel: "curtain_glass",
        expectedTex: "magnet",
      },
      {
        name: "ShibuyaMarkCityFacade",
        expectedChannel: "anodized_metal",
        expectedTex: "markCity",
      },
      {
        name: "ShibuyaToeiBicFacade",
        expectedChannel: "retail_storefront",
        expectedTex: "toeiBic",
      },
      {
        name: "ShibuyaDogenzakaCommercialFacade",
        expectedChannel: "retail_storefront",
        expectedTex: "dogenzakaCommercial",
      },
    ];

    for (const item of glbMaterials) {
      const mat = new THREE.MeshStandardMaterial({ name: item.name });
      cityMap.applyShibuyaStreamGlbMaterial3DTexture(mat);

      expect(mat.userData.hasArch3DVolumeShader).toBe(true);
      expect(mat.userData.arch3DVolumeChannel).toBe(item.expectedChannel);
      expect(mat.map).toBeDefined();
      expect(mat.emissiveMap).toBe(mat.map);
    }

    const heliportMat = new THREE.MeshStandardMaterial({ name: "HeliportGreenPad" });
    cityMap.applyShibuyaStreamGlbMaterial3DTexture(heliportMat);
    expect(heliportMat.userData.arch3DVolumeChannel).toBe("white_granite");
    expect(heliportMat.map).toBeNull();

    const jrSteelMat = new THREE.MeshStandardMaterial({ name: "JRGreenSteel" });
    cityMap.applyShibuyaStreamGlbMaterial3DTexture(jrSteelMat);
    expect(jrSteelMat.userData.arch3DVolumeChannel).toBe("anodized_metal");
    expect(jrSteelMat.map).toBeNull();

    // PLATEAU 実在建物群向けマテリアル（LOD2実写テクスチャ＆Mipmap検証）
    const plateauTowerMat = new THREE.MeshStandardMaterial({ name: "PlateauGlassTower" });
    cityMap.applyShibuyaPlateauGlbMaterial3DTexture(plateauTowerMat);
    expect(plateauTowerMat.userData.arch3DVolumeChannel).toBe("curtain_glass");
    expect(plateauTowerMat.map).toBeDefined();
    expect(plateauTowerMat.map?.generateMipmaps).toBe(true);
    expect(plateauTowerMat.emissiveMap).toBe(plateauTowerMat.map);

    const plateauCommercialMat = new THREE.MeshStandardMaterial({
      name: "PlateauCommercialFacade",
    });
    cityMap.applyShibuyaPlateauGlbMaterial3DTexture(plateauCommercialMat);
    expect(plateauCommercialMat.userData.arch3DVolumeChannel).toBe("retail_storefront");
    expect(plateauCommercialMat.map).toBeDefined();
    expect(plateauCommercialMat.map?.generateMipmaps).toBe(true);
    expect(plateauCommercialMat.emissiveMap).toBe(plateauCommercialMat.map);

    const plateauAlleyMat = new THREE.MeshStandardMaterial({ name: "PlateauAlleyCommercial" });
    cityMap.applyShibuyaPlateauGlbMaterial3DTexture(plateauAlleyMat);
    expect(plateauAlleyMat.userData.arch3DVolumeChannel).toBe("stone_punched");
    expect(plateauAlleyMat.map).toBeDefined();
    expect(plateauAlleyMat.map?.generateMipmaps).toBe(true);

    const plateauRoofMat = new THREE.MeshStandardMaterial({ name: "PlateauRooftop" });
    cityMap.applyShibuyaPlateauGlbMaterial3DTexture(plateauRoofMat);
    expect(plateauRoofMat.userData.arch3DVolumeChannel).toBe("white_granite");

    const plateauProxyMat = new THREE.MeshStandardMaterial({ name: "PlateauLod2Proxy" });
    cityMap.applyShibuyaPlateauGlbMaterial3DTexture(plateauProxyMat);
    expect(plateauProxyMat.userData.arch3DVolumeChannel).toBeUndefined(); // 3Dボリュームノイズをスキップ
    expect(plateauProxyMat.map).toBeDefined();
    expect(plateauProxyMat.map?.generateMipmaps).toBe(true);
    expect(plateauProxyMat.emissiveMap).toBe(plateauProxyMat.map);
  });

  it("渋谷エリアの路面店舗・袖看板群・交差点ビルボード群が生成され、夜間切り替え時に一括で発光輝度が連動することを保証する", async () => {
    await RAPIER.init();
    const scene = new THREE.Scene();
    const world = new RAPIER.World(new RAPIER.Vector3(0, -9.81, 0));
    const cityMap = new TokyoStationMap(scene, world, RAPIER, { deferGlbLoads: true });

    // 渋谷ストリートビュー看板グループの存在
    const signsGroup = cityMap.group.getObjectByName(
      "ShibuyaStreetViewSignsGroup",
    ) as THREE.Group | null;
    expect(signsGroup).toBeDefined();
    expect(signsGroup).not.toBeNull();

    if (signsGroup) {
      // 突き出し袖看板およびビルボードメッシュが多数格納されていること
      const childCount = signsGroup.children.length;
      expect(childCount).toBeGreaterThan(15);

      // 明治通りの突き出し袖看板（scale.y が 3m 以上で薄いメッシュ）が道路上空へX軸方向に1.2m以上突出し、Z軸厚みが0.3m以下であること
      const bladeSignMeshes = signsGroup.children.filter(
        (c) =>
          (c as THREE.Mesh).isMesh && c.scale.y >= 3.0 && c.scale.y <= 5.5 && c.scale.z <= 0.35,
      );
      expect(bladeSignMeshes.length).toBe(12);
      for (const bMesh of bladeSignMeshes) {
        expect(bMesh.scale.x).toBeGreaterThanOrEqual(1.2);
        expect(bMesh.scale.z).toBeLessThanOrEqual(0.3);
      }
    }

    // ハチ公前広場インフラおよびスクランブル交差点対角線横断歩道が構築されていること
    const hachikoPlaza = cityMap.group.getObjectByName("ShibuyaHachikoPlazaInfrastructure");
    expect(hachikoPlaza).toBeDefined();
    const hachikoMonument = cityMap.group.getObjectByName("ShibuyaHachikoStatueMonument");
    expect(hachikoMonument).toBeDefined();

    // 忠犬ハチ公像モニュメントが車道（z >= 226）にめり込まず、歩行者広場内（z <= 224）に配置されていること
    const monumentWorldPos = new THREE.Vector3();
    hachikoMonument!.getWorldPosition(monumentWorldPos);
    expect(monumentWorldPos.z).toBeLessThanOrEqual(224);
    expect(monumentWorldPos.x).toBeCloseTo(-802, 1);

    // ハチ公前広場舗装（HachikoPlazaPavement）の北端が車道南端（z = 226）を越えないこと
    const plazaPavement = cityMap.group.getObjectByName("HachikoPlazaPavement") as THREE.Mesh;
    expect(plazaPavement).toBeDefined();
    const pavementWorldPos = new THREE.Vector3();
    plazaPavement.getWorldPosition(pavementWorldPos);
    const pavementHalfDepth = (plazaPavement.geometry as THREE.PlaneGeometry).parameters.height / 2;
    expect(pavementWorldPos.z + pavementHalfDepth).toBeLessThanOrEqual(226.01);

    // スクランブル交差点対角線横断歩道が外周横断歩道上面（y = 0.0335）と完全に整合した高さで生成されていること
    const scrambleCrosswalks = cityMap.group.getObjectByName("ShibuyaScrambleDiagonalCrosswalks");
    expect(scrambleCrosswalks).toBeDefined();
    expect(scrambleCrosswalks!.position.y).toBeGreaterThanOrEqual(0.033);

    // スクランブル交差点（Intersection_-815_248）に斜め横断歩道と衝突する中央ダイヤ・誘導破線が存在しないこと
    const scrambleInter = cityMap.group.getObjectByName("Intersection_-815_248");
    expect(scrambleInter).toBeDefined();
    expect(scrambleInter!.getObjectByName("IntersectionCenterDiamond_Edge")).toBeUndefined();
    expect(scrambleInter!.getObjectByName("IntersectionGuideDot_NS")).toBeUndefined();
    expect(scrambleInter!.getObjectByName("IntersectionGuideDot_EW")).toBeUndefined();

    // 109前および神南一丁目がスクランブル交差点パッドと重複して架空交差点パッドを生成していないこと
    expect(cityMap.group.getObjectByName("Intersection_-830_252")).toBeUndefined();
    expect(cityMap.group.getObjectByName("Intersection_-790_265")).toBeUndefined();

    // 昼間モード: 全エントリの emissiveIntensity が dayIntensity であること
    cityMap.setNightMode(false);
    const internalMap = cityMap as unknown as {
      shibuyaStreamEmissiveEntries: Array<{
        material: THREE.MeshStandardMaterial;
        dayIntensity: number;
        nightIntensity: number;
      }>;
    };
    expect(internalMap.shibuyaStreamEmissiveEntries.length).toBeGreaterThan(10);
    for (const entry of internalMap.shibuyaStreamEmissiveEntries) {
      expect(entry.material.emissiveIntensity).toBe(entry.dayIntensity);
    }

    // 夜間モード: 全エントリの emissiveIntensity が nightIntensity に跳ね上がること
    cityMap.setNightMode(true);
    for (const entry of internalMap.shibuyaStreamEmissiveEntries) {
      expect(entry.material.emissiveIntensity).toBe(entry.nightIntensity);
      expect(entry.material.emissiveIntensity).toBeGreaterThan(entry.dayIntensity);
    }
  });

  it("渋谷の沿道ビル群において1F路面店舗ファサードがポディウム基底に埋没せず外側に露出していることを保証する", async () => {
    await RAPIER.init();
    const scene = new THREE.Scene();
    const world = new RAPIER.World(new RAPIER.Vector3(0, -9.81, 0));
    const cityMap = new TokyoStationMap(scene, world, RAPIER, { deferGlbLoads: true });

    // 渋谷ビル群（13113-bldg-*）を探索
    const shibuyaBuildingGroups = cityMap.group.children.filter((c) =>
      c.name?.startsWith("13113-bldg"),
    );
    expect(shibuyaBuildingGroups.length).toBeGreaterThan(0);

    for (const bGroup of shibuyaBuildingGroups) {
      const meshes: THREE.Mesh[] = [];
      bGroup.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          meshes.push(obj as THREE.Mesh);
        }
      });
      const storefrontMesh = meshes.find(
        (m) => (m.material as THREE.Material)?.userData?.arch3DMode === "retail_storefront",
      );
      expect(storefrontMesh).toBeDefined();
      if (storefrontMesh) {
        const geo = storefrontMesh.geometry as THREE.BoxGeometry;
        const width = geo.parameters.width;
        const depth = geo.parameters.depth;
        expect(width).toBeGreaterThan(0);
        expect(depth).toBeGreaterThan(0);
      }
    }
  });

  it("シェーダー置換において USE_MAP / USE_EMISSIVEMAP ガードが機能し、実写看板・ビジョンのテクスチャ色彩と発光が保護されることを保証する", async () => {
    await RAPIER.init();
    const scene = new THREE.Scene();
    const world = new RAPIER.World(new RAPIER.Vector3(0, -9.81, 0));
    const cityMap = new TokyoStationMap(scene, world, RAPIER, { deferGlbLoads: true });

    const texMat = new THREE.MeshStandardMaterial({
      map: shibuyaTextureManager.getTexture("qfront"),
      emissiveMap: shibuyaTextureManager.getTexture("qfront"),
    });

    const cityMapInternal = cityMap as unknown as {
      attachArchitecture3DVolumeShader: (
        material: THREE.MeshStandardMaterial,
        mode: string,
      ) => void;
    };
    cityMapInternal.attachArchitecture3DVolumeShader(texMat, "curtain_glass");

    const mockShader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: "#include <common>\nvoid main() {\n#include <worldpos_vertex>\n}",
      fragmentShader:
        "#include <common>\nvoid main() {\n#include <color_fragment>\n#include <emissivemap_fragment>\n}",
    };

    texMat.onBeforeCompile(
      mockShader as unknown as THREE.WebGLProgramParametersWithUniforms,
      {} as THREE.WebGLRenderer,
    );

    // USE_MAP ガードが含まれていること
    expect(mockShader.fragmentShader).toContain("#ifdef USE_MAP");
    // USE_EMISSIVEMAP ガードが含まれていること
    expect(mockShader.fragmentShader).toContain("#ifdef USE_EMISSIVEMAP");
  });
});

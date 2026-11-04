import { describe, it, expect } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { TokyoStationMap } from "../city/tokyoStationMap";

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
});

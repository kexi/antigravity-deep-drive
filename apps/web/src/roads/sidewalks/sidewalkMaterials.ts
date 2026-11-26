import * as THREE from "three";
import { PuddleMaterial } from "../../shaders/puddleShader";
import { Procedural3DTextureGenerator } from "../../textures/procedural3DTexture";
import { applyRoadProp3DTexture } from "../roadProps";
import type { SidewalkPavingStyle } from "../types";
import type { SidewalkGuardrailStyle } from "./sidewalkSchema";

/**
 * 縁石・L型側溝・中央分離帯コンクリートブロックへ 3D ボリュームテクスチャ（sampler3D）を注入する。
 * How: 共有 3D テクスチャ（getSharedRoadMarkingProp3DTexture）を 3D ワールド座標でサンプリングし、
 * コンクリート骨材粒子、60cm ピッチの目地溝、縦方向の雨だれウェザリング、ラフネス変調、法線マイクロバンプを表現する。
 * Why not 2D UV テクスチャを使うか:
 * 長尺リボン縁石に 2D テクスチャを貼ると上面と側面で伸縮率の違いによる UV 引き伸ばしや継ぎ目が発生するため、
 * 3D ワールド空間座標で連続サンプリングするソリッドテクスチャ方式を採用する。
 */
export function applyCurb3DTexture(material: THREE.MeshStandardMaterial): void {
  const isAlreadyApplied = Boolean(material.userData?.hasCurb3DTexture);
  if (isAlreadyApplied) {
    return;
  }

  const volumeTex = Procedural3DTextureGenerator.getSharedRoadMarkingProp3DTexture(32);
  material.userData.hasCurb3DTexture = true;
  material.userData.uRoadPropVolumeTex = volumeTex;
  material.customProgramCacheKey = () => "japanese-road-curb-3d-v3";

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRoadPropVolumeTex = { value: volumeTex };

    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `#include <common>
varying vec3 vCurbWorldPos;
varying vec3 vCurbLocalPos;
varying vec2 vCurbUv;`,
    );

    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
vCurbLocalPos = position;
vCurbWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
vCurbUv = uv;`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
precision highp sampler3D;
uniform sampler3D uRoadPropVolumeTex;
varying vec3 vCurbWorldPos;
varying vec3 vCurbLocalPos;
varying vec2 vCurbUv;`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
float curbCamDist = length(cameraPosition - vCurbWorldPos);
float curbAggregate = 0.5;
float jointGroove = 0.0;
float bottomGrime = 0.0;
vec4 curbVoxFine = vec4(0.5);
if (curbCamDist < 60.0) {
  vec4 curbVoxCoarse = texture(uRoadPropVolumeTex, vCurbWorldPos * vec3(1.8, 2.4, 0.9));
  curbVoxFine = texture(uRoadPropVolumeTex, vCurbWorldPos * 8.5 + vec3(0.19, 0.47, 0.83));
  curbAggregate = mix(curbVoxCoarse.a, curbVoxFine.r, 0.45);
  // 60cm 間隔のコンクリート縁石ブロック目地溝（道路方向 UV vCurbUv.y に直交）
  float curbLongCoord = vCurbUv.y;
  float jointPhase = abs(fract(curbLongCoord / 0.6 + 0.5) - 0.5);
  float jointDistFade = 1.0 - smoothstep(32.0, 48.0, curbCamDist);
  jointGroove = (1.0 - smoothstep(0.0, 0.022, jointPhase)) * jointDistFade;
  // 縁石下部・側面の縦方向雨だれ＆泥跳ねウェザリング
  float verticalStreak = texture(uRoadPropVolumeTex, vec3(vCurbWorldPos.x * 3.2, vCurbWorldPos.y * 0.65, vCurbWorldPos.z * 2.6)).a;
  bottomGrime = smoothstep(0.14, -0.06, vCurbLocalPos.y) * (0.55 + 0.45 * verticalStreak);
  float curbShade = 0.86 + (curbAggregate - 0.5) * 0.26 - jointGroove * 0.34 - bottomGrime * 0.18;
  diffuseColor.rgb *= clamp(curbShade, 0.48, 1.15);
}`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <metalnessmap_fragment>",
      `#include <metalnessmap_fragment>
if (curbCamDist < 60.0) {
  roughnessFactor = clamp(roughnessFactor + (0.5 - curbAggregate) * 0.16 + jointGroove * 0.14 + bottomGrime * 0.12, 0.45, 0.98);
  metalnessFactor = clamp(metalnessFactor * (1.0 - jointGroove * 0.5), 0.02, 0.25);
}`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_maps>",
      `#include <normal_fragment_maps>
if (curbCamDist < 36.0) {
  // Why not dFdx(vCurbWorldPos) * dFdx(curbHeightSignal) を使うか:
  // 浅い視線角度（グレージング角）やポリゴンエッジで dFdx(worldPos) が数十mになり、
  // ビュースペースの normal と逆向きに相殺して normalize(0) -> NaN の白フラッシュを発生させるため、
  // 3D ボリュームの有界な差分を viewMatrix でビュースペースへ変換して安全に摂動を加える。
  vec3 curbMicroShift = vec3(
    (curbVoxFine.r - 0.5) * 0.09,
    0.0,
    (curbVoxFine.g - 0.5) * 0.09 - jointGroove * 0.08
  );
  vec3 curbViewPerturb = mat3(viewMatrix) * curbMicroShift;
  vec3 curbCombinedN = normal + clamp(curbViewPerturb, vec3(-0.14), vec3(0.14));
  normal = curbCombinedN / max(length(curbCombinedN), 0.001);
}`,
    );
  };
  material.needsUpdate = true;
}

function createCatchBasinGrateTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }

  // 外枠の溶融亜鉛メッキ／鋳鉄フレーム
  ctx.fillStyle = "#525860";
  ctx.fillRect(0, 0, 128, 256);

  // 内側スリット排水口（暗い空洞）
  ctx.fillStyle = "#111519";
  ctx.fillRect(10, 12, 108, 232);

  // 横方向の耐荷重フラットバー（10本）
  for (let y = 20; y <= 236; y += 22) {
    ctx.fillStyle = "#6b727c";
    ctx.fillRect(10, y, 108, 9);
    ctx.fillStyle = "#8a929d";
    ctx.fillRect(10, y, 108, 2);
  }

  // 縦方向の中央補強リブ（2本）
  for (const x of [42, 80]) {
    ctx.fillStyle = "#5e656f";
    ctx.fillRect(x, 12, 6, 232);
  }

  // 外枠ベベルハイライト
  ctx.strokeStyle = "#7e8690";
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, 120, 248);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

export interface SidewalkMaterialStats {
  pavingMaterialCount: number;
  totalCachedMaterials: number;
}

/**
 * 都市全体の歩道・縁石・L型側溝・民地境界ブロック・雨水集水桝グレーチング・防護柵の
 * マテリアルを一元キャッシュするライブラリ。
 *
 * Why: 旧実装では直線道路・曲線道路・交差点ごとに新規 PuddleMaterial / curbMat / gutterMat を
 * 400 個以上複製し、毎フレームの天候 uniform 同期とシェーダープログラム切替を圧迫していたため、
 * 舗装スタイル別（3種）＋付帯構造物（最大7種）の共有キャッシュへ集約する。
 */
export class SidewalkMaterialLibrary {
  private readonly pavingCache = new Map<SidewalkPavingStyle, PuddleMaterial>();
  private readonly guardrailBeamCache = new Map<
    SidewalkGuardrailStyle,
    THREE.MeshStandardMaterial
  >();
  private curbMat: THREE.MeshStandardMaterial | null = null;
  private gutterMat: THREE.MeshStandardMaterial | null = null;
  private backCurbMat: THREE.MeshStandardMaterial | null = null;
  private catchBasinMat: THREE.MeshStandardMaterial | null = null;
  private guardrailRetroMat: THREE.MeshStandardMaterial | null = null;

  public getSidewalkPavingMaterial(style: SidewalkPavingStyle): PuddleMaterial {
    const existing = this.pavingCache.get(style);
    if (existing) {
      return existing;
    }

    const baseColorByStyle: Record<SidewalkPavingStyle, number> = {
      granite_slab: 0xaaa8a2,
      interlocking_brick: 0xa6a39c,
      concrete_tile: 0xa0a09c,
    };

    const mat = new PuddleMaterial({
      baseColor: baseColorByStyle[style],
      baseRoughness: style === "granite_slab" ? 0.74 : 0.78,
      baseMetalness: 0.08,
      puddleThreshold: 0.46,
      sidewalkPavingStyle: style,
    });
    mat.userData.sidewalkMaterialKind = `paving_${style}`;
    this.pavingCache.set(style, mat);
    return mat;
  }

  public getCurbMaterial(): THREE.MeshStandardMaterial {
    if (this.curbMat) {
      return this.curbMat;
    }
    const mat = new THREE.MeshStandardMaterial({
      color: 0x989690,
      roughness: 0.8,
      metalness: 0.1,
    });
    mat.userData.sidewalkMaterialKind = "curb";
    applyCurb3DTexture(mat);
    this.curbMat = mat;
    return mat;
  }

  public getLGutterMaterial(): THREE.MeshStandardMaterial {
    if (this.gutterMat) {
      return this.gutterMat;
    }
    const mat = new THREE.MeshStandardMaterial({
      color: 0x86857f,
      roughness: 0.84,
      metalness: 0.08,
    });
    mat.userData.sidewalkMaterialKind = "l_gutter";
    applyCurb3DTexture(mat);
    this.gutterMat = mat;
    return mat;
  }

  public getBackCurbMaterial(): THREE.MeshStandardMaterial {
    if (this.backCurbMat) {
      return this.backCurbMat;
    }
    const mat = new THREE.MeshStandardMaterial({
      color: 0x76746e,
      roughness: 0.78,
      metalness: 0.12,
    });
    mat.userData.sidewalkMaterialKind = "back_curb";
    applyCurb3DTexture(mat);
    this.backCurbMat = mat;
    return mat;
  }

  public getCatchBasinGrateMaterial(): THREE.MeshStandardMaterial {
    if (this.catchBasinMat) {
      return this.catchBasinMat;
    }
    const grateTex = createCatchBasinGrateTexture();
    const mat = new THREE.MeshStandardMaterial({
      color: grateTex ? 0xd8dde4 : 0x4b525c,
      ...(grateTex ? { map: grateTex } : {}),
      roughness: 0.44,
      metalness: 0.62,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    mat.userData.sidewalkMaterialKind = "catch_basin_grate";
    this.catchBasinMat = mat;
    return mat;
  }

  public getGuardrailBeamMaterial(
    style: SidewalkGuardrailStyle = "tokyo_white_pipe",
  ): THREE.MeshStandardMaterial {
    const resolvedStyle: SidewalkGuardrailStyle = style === "none" ? "tokyo_white_pipe" : style;
    const existing = this.guardrailBeamCache.get(resolvedStyle);
    if (existing) {
      return existing;
    }
    const isDarkBronze = resolvedStyle === "marunouchi_dark_bronze";
    const mat = new THREE.MeshStandardMaterial({
      color: isDarkBronze ? 0x4a453f : 0xf4f7fb,
      roughness: isDarkBronze ? 0.34 : 0.28,
      metalness: isDarkBronze ? 0.42 : 0.25,
    });
    mat.userData.sidewalkMaterialKind = `guardrail_beam_${resolvedStyle}`;
    applyRoadProp3DTexture(mat, "guardrail");
    this.guardrailBeamCache.set(resolvedStyle, mat);
    return mat;
  }

  public getGuardrailRetroMaterial(): THREE.MeshStandardMaterial {
    if (this.guardrailRetroMat) {
      return this.guardrailRetroMat;
    }
    const mat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.75,
      roughness: 0.14,
      metalness: 0.35,
    });
    mat.userData.sidewalkMaterialKind = "guardrail_retro";
    applyRoadProp3DTexture(mat, "retroreflector");
    this.guardrailRetroMat = mat;
    return mat;
  }

  public getPuddleMaterials(): PuddleMaterial[] {
    return Array.from(this.pavingCache.values());
  }

  public getCachedMaterialStats(): SidewalkMaterialStats {
    let extraCount = this.guardrailBeamCache.size;
    if (this.curbMat) extraCount += 1;
    if (this.gutterMat) extraCount += 1;
    if (this.backCurbMat) extraCount += 1;
    if (this.catchBasinMat) extraCount += 1;
    if (this.guardrailRetroMat) extraCount += 1;
    return {
      pavingMaterialCount: this.pavingCache.size,
      totalCachedMaterials: this.pavingCache.size + extraCount,
    };
  }
}

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { assetManager } from "../assets/assetManager";
import { Procedural3DTextureGenerator } from "../textures/procedural3DTexture";
import { JapaneseRoadSigns } from "./roadSigns";

export type RoadProp3DTextureMode =
  | "guardrail"
  | "manhole"
  | "grating"
  | "pole"
  | "traffic-body"
  | "traffic-visor"
  | "bollard"
  | "sign-face"
  | "retroreflector";

export interface RetroreflectorEnvironmentSyncParams {
  headlightPosL?: THREE.Vector3;
  headlightPosR?: THREE.Vector3;
  vehicleForward?: THREE.Vector3;
  headlightsActive?: number;
  nightFactor?: number;
}

/**
 * ガードレール反射板（デリネーター・ビーム谷部台形反射標・支柱反射帯・視線誘導標）が共有する
 * リアルタイム車両ヘッドライト＆環境ユニフォーム
 *
 * How:
 * - 左右2灯のヘッドライトのワールド座標 (`uHeadlightPosL`, `uHeadlightPosR`) と車両進行方向ベクトル (`uVehicleForward`) を
 *   毎フレーム全 `retroreflector` マテリアルで共有参照する。
 * - 光源（ヘッドライトまたはカメラ視線方向）に向かって入射光がそのまま跳ね返る「コーナーキューブ・マイクロプリズム再帰反射」と
 *   六角ハニカムプリズムセルの煌めきをフラグメントシェーダーで物理的に計算する。
 */
export const SHARED_RETROREFLECTOR_UNIFORMS = {
  uHeadlightPosL: { value: new THREE.Vector3(-0.64, 0.82, 2.34) },
  uHeadlightPosR: { value: new THREE.Vector3(0.64, 0.82, 2.34) },
  uVehicleForward: { value: new THREE.Vector3(0, 0, -1) },
  uHeadlightsActive: { value: 1.0 },
  uEnvironmentNightFactor: { value: 0.0 },
};

/**
 * 道路付帯プロップ（ガードレール・マンホール・グレーチング・信号機・ボラード・標識・再帰反射板）用
 * 3D ボリュームテクスチャ（sampler3D）＆ コーナーキューブ再帰反射シェーダー注入ヘルパー
 *
 * How:
 * - Procedural3DTextureGenerator.getSharedRoadMarkingProp3DTexture(32) を 3D ワールド空間でサンプリングし、
 *   B チャンネル（溶融亜鉛めっきスパングル結晶＆ヘアライン）と A チャンネル（鋳鉄砂型ディンプル・雨だれウェザリング）、
 *   R/G チャンネル（再帰反射ガラスビーズ・コーナーキューブマイクロプリズム・塗膜微細凹凸）をモード別に合成する。
 * - `retroreflector` モード (`uRoadPropMode == 8`) では、左右2灯ヘッドライトの照射円錐 (`uHeadlightPosL`, `uHeadlightPosR`, `uVehicleForward`)
 *   およびカメラ視線軸との同軸度（Observation Angle: 入射光線と視線のなす角の狭さ）から再帰反射輝度 `retroBrilliance` を算出し、
 *   正面・斜め前方からヘッドライトが当たった反射板だけがマイクロプリズムの六角格子きらめきを伴って強烈に輝く光学特性を再現する。
 *
 * Why not 単純な定数 emissive や 2D ノーマルマップを使うか:
 * 定数 emissive では昼夜・角度・距離を問わずのっぺりした自発光に見え、反射板特有の「ライトが当たった方向にだけ強く跳ね返る」
 * 再帰反射（Retroreflection）にならないため。また 3D ソリッド座標で六角プリズム格子を評価することで UV 歪みを完全に排除した。
 */
export function applyRoadProp3DTexture(
  material: THREE.MeshStandardMaterial,
  mode: RoadProp3DTextureMode,
): void {
  const volumeTex = Procedural3DTextureGenerator.getSharedRoadMarkingProp3DTexture(32);
  const modeCodeMap: Record<RoadProp3DTextureMode, number> = {
    guardrail: 0,
    manhole: 1,
    grating: 2,
    pole: 3,
    "traffic-body": 4,
    "traffic-visor": 5,
    bollard: 6,
    "sign-face": 7,
    retroreflector: 8,
  };
  const modeCode = modeCodeMap[mode];

  material.userData.uRoadPropVolumeTex = volumeTex;
  material.userData.roadPropMode = mode;
  material.userData.retroreflectorUniforms = SHARED_RETROREFLECTOR_UNIFORMS;
  material.customProgramCacheKey = () => `road-prop-3d-unified-v4-${modeCode}`;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRoadPropVolumeTex = { value: volumeTex };
    shader.uniforms.uRoadPropMode = { value: modeCode };
    shader.uniforms.uHeadlightPosL = SHARED_RETROREFLECTOR_UNIFORMS.uHeadlightPosL;
    shader.uniforms.uHeadlightPosR = SHARED_RETROREFLECTOR_UNIFORMS.uHeadlightPosR;
    shader.uniforms.uVehicleForward = SHARED_RETROREFLECTOR_UNIFORMS.uVehicleForward;
    shader.uniforms.uHeadlightsActive = SHARED_RETROREFLECTOR_UNIFORMS.uHeadlightsActive;
    shader.uniforms.uEnvironmentNightFactor =
      SHARED_RETROREFLECTOR_UNIFORMS.uEnvironmentNightFactor;

    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `#include <common>
varying vec3 vPropWorldPos;
varying vec3 vPropLocalPos;
varying vec3 vPropWorldNormal;`,
    );

    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
vPropLocalPos = position;
vPropWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
vPropWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
precision highp sampler3D;
uniform sampler3D uRoadPropVolumeTex;
uniform int uRoadPropMode;
uniform vec3 uHeadlightPosL;
uniform vec3 uHeadlightPosR;
uniform vec3 uVehicleForward;
uniform float uHeadlightsActive;
uniform float uEnvironmentNightFactor;
varying vec3 vPropWorldPos;
varying vec3 vPropLocalPos;
varying vec3 vPropWorldNormal;`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
if (diffuseColor.a < 0.5) discard;
float propCamDist = length(cameraPosition - vPropWorldPos);
vec4 propVoxFine = vec4(0.5);
vec4 propVoxMacro = vec4(0.5);
float spangleGrain = 0.5;
float castDimple = 0.5;
float beadSparkle = 0.5;
float paintMicro = 0.5;
float propHeightSignal = 0.5;
float retroBrilliance = 0.0;
float retroPrismFacet = 0.5;
float retroHeadlightHit = 0.0;

float maxEvalDist = (uRoadPropMode == 8) ? 148.0 : 60.0;
if (propCamDist < maxEvalDist) {
  propVoxFine = texture(uRoadPropVolumeTex, vPropWorldPos * 9.5 + vPropLocalPos * 4.0);
  propVoxMacro = texture(uRoadPropVolumeTex, vPropWorldPos * 1.85 + vec3(0.23, 0.51, 0.77));
  spangleGrain = mix(propVoxFine.b, propVoxMacro.b, 0.35);
  castDimple = mix(propVoxFine.a, propVoxMacro.a, 0.4);
  beadSparkle = propVoxFine.r;
  paintMicro = propVoxFine.g;
  propHeightSignal = spangleGrain;

  if (uRoadPropMode == 0) {
    // ガードレール：日本標準白塗装＋下地の溶融亜鉛めっきスパングル微粒子＋雨だれウェザリング
    float rainStreak = propVoxMacro.a;
    float coatShade = 0.93 + (paintMicro - 0.5) * 0.12 + (spangleGrain - 0.5) * 0.10 - (1.0 - rainStreak) * 0.08;
    diffuseColor.rgb *= clamp(coatShade, 0.72, 1.12);
    propHeightSignal = mix(paintMicro, spangleGrain, 0.45);
  } else if (uRoadPropMode == 1) {
    // マンホール蓋：鋳鉄の砂型ディンプル凹凸肌＋黒防錆塗装の摩耗金属光沢
    float wearCrest = smoothstep(0.48, 0.84, castDimple);
    vec3 ironHighlight = vec3(0.42, 0.46, 0.52);
    diffuseColor.rgb = mix(diffuseColor.rgb * (0.78 + 0.32 * castDimple), ironHighlight, wearCrest * 0.32);
    propHeightSignal = castDimple;
  } else if (uRoadPropMode == 2) {
    // グレーチング（集水桝）：溶融亜鉛めっき鋼格子の結晶スパングル＋スリット陰影
    float slitWave = smoothstep(-0.35, 0.35, sin(vPropLocalPos.z * 78.0));
    float zincShade = (0.82 + 0.28 * spangleGrain) * (0.72 + 0.28 * slitWave);
    diffuseColor.rgb *= clamp(zincShade, 0.48, 1.18);
    propHeightSignal = mix(spangleGrain, slitWave, 0.4);
  } else if (uRoadPropMode == 3) {
    // 鋼管支柱・アーム：亜鉛めっきスパングル＆縦方向ヘアライン・微細風化
    float poleShade = 0.88 + (spangleGrain - 0.5) * 0.22 + (castDimple - 0.5) * 0.12;
    diffuseColor.rgb *= clamp(poleShade, 0.68, 1.15);
    propHeightSignal = mix(spangleGrain, castDimple, 0.35);
  } else if (uRoadPropMode == 4 || uRoadPropMode == 5) {
    // 信号機灯器ボディ・庇（バイザー）：ダークグレー粉体塗装の微細シボ（梨地）と金属粒子
    float powderGrain = mix(spangleGrain, castDimple, 0.5);
    float visorDarken = (uRoadPropMode == 5) ? 0.88 : 0.95;
    diffuseColor.rgb *= clamp((0.86 + powderGrain * 0.24) * visorDarken, 0.58, 1.12);
    propHeightSignal = powderGrain;
  } else if (uRoadPropMode == 6) {
    // ボラード・ポスト筐体：ウレタン/鋳鉄ポストの微細粒子
    float postGrain = mix(castDimple, beadSparkle, 0.4);
    diffuseColor.rgb *= clamp(0.88 + postGrain * 0.24, 0.68, 1.16);
    propHeightSignal = postGrain;
  } else if (uRoadPropMode == 8) {
    // ガードレール反射板（retroreflector）：コーナーキューブ・マイクロプリズム六角ハニカム再帰反射光学計算
    vec3 viewDeltaW = cameraPosition - vPropWorldPos;
    vec3 viewDirW = viewDeltaW / max(propCamDist, 0.001);
    vec3 worldN = normalize(vPropWorldNormal);
    float faceAlign = clamp(abs(dot(worldN, viewDirW)), 0.0, 1.0);

    // 六角ハニカム・コーナーキューブプリズム格子（3軸の60度交差サイン波＋3Dボリューム微粒子）
    vec3 prismCoord = vPropLocalPos * 210.0 + vPropWorldPos * 28.0;
    float hexA = sin(prismCoord.x + prismCoord.y * 1.73205);
    float hexB = sin(prismCoord.x - prismCoord.y * 1.73205);
    float hexC = sin(prismCoord.z * 2.0 + prismCoord.y * 0.85);
    float honeycombLattice = clamp((hexA * hexB + hexC * 0.5) * 0.5 + 0.5, 0.0, 1.0);
    vec4 microVox = texture(uRoadPropVolumeTex, vPropWorldPos * 24.0 + vPropLocalPos * 18.0 + viewDirW * 0.35);
    retroPrismFacet = mix(honeycombLattice, microVox.r, 0.48);
    float glintSpike = smoothstep(0.42, 0.94, retroPrismFacet);

    // 左右2灯の車両ヘッドライトからの入射ビームと視線ベクトルとの再帰反射同軸度（Observation Angle）
    vec3 fwdDir = normalize(uVehicleForward);
    vec3 toFragL = vPropWorldPos - uHeadlightPosL;
    float distL = length(toFragL);
    vec3 rayL = toFragL / max(distL, 0.001);
    float coneL = smoothstep(0.55, 0.95, dot(rayL, fwdDir));
    float coaxialL = pow(clamp(dot(-rayL, viewDirW), 0.0, 1.0), 10.0);
    float attenL = smoothstep(142.0, 6.0, distL) * smoothstep(0.8, 3.2, distL);
    float returnL = coneL * coaxialL * attenL * clamp(abs(dot(worldN, -rayL)) + 0.25, 0.0, 1.0);

    vec3 toFragR = vPropWorldPos - uHeadlightPosR;
    float distR = length(toFragR);
    vec3 rayR = toFragR / max(distR, 0.001);
    float coneR = smoothstep(0.55, 0.95, dot(rayR, fwdDir));
    float coaxialR = pow(clamp(dot(-rayR, viewDirW), 0.0, 1.0), 10.0);
    float attenR = smoothstep(142.0, 6.0, distR) * smoothstep(0.8, 3.2, distR);
    float returnR = coneR * coaxialR * attenR * clamp(abs(dot(worldN, -rayR)) + 0.25, 0.0, 1.0);

    retroHeadlightHit = (returnL + returnR) * (0.42 + 0.88 * uHeadlightsActive);

    // カメラ視線同軸フォールバック（昼間の太陽光/DRL反射やヘッドライト範囲外からの正対視認時にもプリズム反射を維持）
    float camCoaxial = pow(faceAlign, 2.2) * smoothstep(138.0, 5.0, propCamDist);
    float envBoost = 1.0 + uEnvironmentNightFactor * 1.45;
    retroBrilliance = (max(retroHeadlightHit * 1.65, camCoaxial * (0.55 + 0.55 * uHeadlightsActive)) * envBoost)
      * (0.68 + 0.78 * glintSpike);

    // プリズム内部の明暗コントラストとガラス質クリアコート深み
    float baseCellContrast = 0.74 + 0.36 * honeycombLattice + 0.22 * glintSpike;
    diffuseColor.rgb *= clamp(baseCellContrast * (0.82 + 0.38 * faceAlign), 0.58, 1.45);
    propHeightSignal = retroPrismFacet;
  } else {
    // 道路標識表面（sign-face）：高輝度ガラスビーズ再帰反射カプセルフィルムの微細粒子
    vec3 viewDeltaW = cameraPosition - vPropWorldPos;
    vec3 viewDirW = viewDeltaW / max(length(viewDeltaW), 0.001);
    float retroFactor = pow(clamp(abs(viewDirW.z), 0.15, 1.0), 0.75);
    float prismSparkle = smoothstep(0.52, 0.92, beadSparkle) * retroFactor;
    diffuseColor.rgb *= clamp(0.94 + (paintMicro - 0.5) * 0.10 + prismSparkle * 0.14, 0.82, 1.16);
    propHeightSignal = mix(beadSparkle, paintMicro, 0.5);
  }
}`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <metalnessmap_fragment>",
      `#include <metalnessmap_fragment>
if (propCamDist < maxEvalDist) {
  if (uRoadPropMode == 0) {
    roughnessFactor = clamp(roughnessFactor + (0.5 - spangleGrain) * 0.18 + (1.0 - propVoxMacro.a) * 0.10, 0.20, 0.72);
    metalnessFactor = clamp(metalnessFactor + (spangleGrain - 0.5) * 0.14, 0.45, 0.92);
  } else if (uRoadPropMode == 1) {
    roughnessFactor = clamp(roughnessFactor + (0.5 - castDimple) * 0.26, 0.24, 0.85);
    metalnessFactor = clamp(metalnessFactor + (castDimple - 0.5) * 0.18, 0.55, 0.96);
  } else if (uRoadPropMode == 2 || uRoadPropMode == 3) {
    roughnessFactor = clamp(roughnessFactor + (0.5 - spangleGrain) * 0.22, 0.18, 0.74);
    metalnessFactor = clamp(metalnessFactor + (spangleGrain - 0.5) * 0.16, 0.55, 0.96);
  } else if (uRoadPropMode == 4 || uRoadPropMode == 5) {
    roughnessFactor = clamp(roughnessFactor + (0.5 - spangleGrain) * 0.18, 0.30, 0.82);
    metalnessFactor = clamp(metalnessFactor + (spangleGrain - 0.5) * 0.12, 0.25, 0.78);
  } else if (uRoadPropMode == 6) {
    roughnessFactor = clamp(roughnessFactor + (0.5 - beadSparkle) * 0.20, 0.22, 0.76);
  } else if (uRoadPropMode == 8) {
    // 表面は滑らかなアクリルクリアレンズ、内部はアルミ蒸着コーナーキューブ鏡面
    roughnessFactor = clamp(0.06 + (1.0 - retroPrismFacet) * 0.12, 0.04, 0.22);
    metalnessFactor = clamp(0.42 + retroPrismFacet * 0.46, 0.35, 0.92);
  } else {
    roughnessFactor = clamp(roughnessFactor - (beadSparkle - 0.5) * 0.18, 0.18, 0.68);
    metalnessFactor = clamp(metalnessFactor + (beadSparkle - 0.5) * 0.10, 0.04, 0.28);
  }
}`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
if (uRoadPropMode == 8) {
  // 再帰反射レンズの発光変調：斜め横や照射コーン外では落ち着いた半透明アクリルレンズ（0.16倍）、
  // ヘッドライト照射軸・視線同軸に入るとコーナーキューブから強烈な再帰反射光（最大6.5倍）と白熱ホットコアを返す
  float dynamicRetroGain = clamp(0.16 + retroBrilliance * 3.85, 0.14, 6.8);
  vec3 hotCoreColor = mix(totalEmissiveRadiance, vec3(1.0, 0.97, 0.88) * length(totalEmissiveRadiance), smoothstep(1.1, 3.4, retroBrilliance) * 0.46);
  totalEmissiveRadiance = hotCoreColor * dynamicRetroGain;
}`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_maps>",
      `#include <normal_fragment_maps>
if (propCamDist < 36.0) {
  // Why not dFdx(vPropWorldPos) * dFdx(propHeightSignal) を使うか:
  // ガードレール・マンホール・グレーチング等を浅い角度から見た際に dFdx(worldPos) が爆発し、
  // ビュースペースの normal と相殺して normalize(0) -> NaN 白フラッシュを起こすため、
  // 3D ボリュームの有界な差分を viewMatrix でビュースペースへ変換して安全に摂動を加える。
  float bumpAmp = (uRoadPropMode == 8) ? 0.18 : ((uRoadPropMode == 1 || uRoadPropMode == 2) ? 0.14 : 0.09);
  vec3 propMicroShift = vec3(
    (propVoxFine.r - 0.5) * bumpAmp,
    (propVoxFine.b - 0.5) * bumpAmp * 0.5,
    (propVoxFine.g - 0.5) * bumpAmp
  );
  vec3 propViewPerturb = mat3(viewMatrix) * propMicroShift;
  vec3 propCombinedN = normal + clamp(propViewPerturb, vec3(-0.18), vec3(0.18));
  normal = propCombinedN / max(length(propCombinedN), 0.001);
}`,
    );
  };
  material.needsUpdate = true;
}

interface GuardrailSlot {
  slotGroup: THREE.Group;
  fallbackGroup: THREE.Group;
  length: number;
}

/**
 * 日本の道路プロップ（付帯物）ジェネレーター
 * - 日本標準Wビーム波形鋼板ガードレール（JIS G 3193 / 巻き込み型袖ビーム・Ω型緩衝ブラケット・黄色反射帯付きφ114.3mm支柱・デリネーター、Blender GLBモデル連携）
 * - マンホール（円形鋳鉄・段差リング）
 * - 排水桝・グレーチング
 * - 日本のLED交通信号機（青・黄・赤）
 * - 道路案内・規制標識・警戒標識・指示標識
 */
export class RoadProps {
  public signs: JapaneseRoadSigns;

  private guardrailMat: THREE.MeshStandardMaterial;
  private guardrailGalvanizedMat: THREE.MeshStandardMaterial;
  private guardrailYellowBandMat: THREE.MeshStandardMaterial;
  private guardrailCollarMat: THREE.MeshStandardMaterial;
  private delineatorHousingMat: THREE.MeshStandardMaterial;
  private delineatorAmberMat: THREE.MeshStandardMaterial;
  private delineatorWhiteMat: THREE.MeshStandardMaterial;
  private manholeMat: THREE.MeshStandardMaterial;
  private gratingMat: THREE.MeshStandardMaterial;
  private poleMat: THREE.MeshStandardMaterial;
  private bodyMat: THREE.MeshStandardMaterial;
  private visorMat: THREE.MeshStandardMaterial;
  private postMat: THREE.MeshStandardMaterial;

  private guardrailSlots: GuardrailSlot[] = [];
  private glbGuardrailTemplate: THREE.Group | null = null;
  private isLoadingGuardrailGlb = false;

  constructor() {
    this.signs = new JapaneseRoadSigns();

    this.guardrailMat = new THREE.MeshStandardMaterial({
      color: 0xf4f7fb, // 日本標準ガードレール白色静電粉体塗装
      metalness: 0.25,
      roughness: 0.28,
      side: THREE.DoubleSide,
    });
    applyRoadProp3DTexture(this.guardrailMat, "guardrail");

    this.guardrailGalvanizedMat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1, // スプライス丸頭ボルト・背面六角ナット溶融亜鉛めっき鋼
      metalness: 0.85,
      roughness: 0.32,
    });
    applyRoadProp3DTexture(this.guardrailGalvanizedMat, "pole");

    this.guardrailYellowBandMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15, // 支柱中腹の高輝度イエロー再帰反射テープ帯（マイクロプリズムシート）
      emissive: 0xf59e0b,
      emissiveIntensity: 0.72,
      metalness: 0.35,
      roughness: 0.14,
    });
    applyRoadProp3DTexture(this.guardrailYellowBandMat, "retroreflector");

    this.guardrailCollarMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8, // 支柱根元のモルタル保護目地リング
      metalness: 0.05,
      roughness: 0.85,
    });

    this.delineatorHousingMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b, // 支柱頂部・ビーム谷部デリネーター黒金属枠・ステー
      metalness: 0.68,
      roughness: 0.36,
    });
    applyRoadProp3DTexture(this.delineatorHousingMat, "bollard");

    this.delineatorAmberMat = new THREE.MeshStandardMaterial({
      color: 0xff6d00, // デリネーター高輝度オレンジ再帰反射プリズムレンズ
      emissive: 0xff7b00,
      emissiveIntensity: 1.35,
      metalness: 0.42,
      roughness: 0.1,
    });
    applyRoadProp3DTexture(this.delineatorAmberMat, "retroreflector");

    this.delineatorWhiteMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc, // デリネーター白色再帰反射プリズムレンズ
      emissive: 0xffffff,
      emissiveIntensity: 1.25,
      metalness: 0.45,
      roughness: 0.08,
    });
    applyRoadProp3DTexture(this.delineatorWhiteMat, "retroreflector");

    this.manholeMat = new THREE.MeshStandardMaterial({
      color: 0x334155, // 鋳鉄ダークグレー
      metalness: 0.85,
      roughness: 0.5,
    });
    applyRoadProp3DTexture(this.manholeMat, "manhole");

    this.gratingMat = new THREE.MeshStandardMaterial({
      color: 0x475569, // 亜鉛メッキグレーチング
      metalness: 0.9,
      roughness: 0.4,
    });
    applyRoadProp3DTexture(this.gratingMat, "grating");

    this.poleMat = new THREE.MeshStandardMaterial({
      color: 0x64748b, // 信号柱・標識柱グレー
      metalness: 0.8,
      roughness: 0.35,
    });
    applyRoadProp3DTexture(this.poleMat, "pole");

    this.bodyMat = new THREE.MeshStandardMaterial({
      color: 0x334155, // 信号機灯器ハウジング粉体塗装グレー
      metalness: 0.55,
      roughness: 0.55,
    });
    applyRoadProp3DTexture(this.bodyMat, "traffic-body");

    this.visorMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b, // 信号機レンズフード（庇）ダークスレート
      metalness: 0.6,
      roughness: 0.48,
      side: THREE.DoubleSide,
    });
    applyRoadProp3DTexture(this.visorMat, "traffic-visor");

    this.postMat = new THREE.MeshStandardMaterial({
      color: 0x475569, // 車止めボラード・補助支柱ダークメタル
      metalness: 0.72,
      roughness: 0.42,
    });
    applyRoadProp3DTexture(this.postMat, "bollard");
  }

  /**
   * JIS G 3193 2山波形断面 Wビームの BufferGeometry を構築する
   * +X が車道側（表面）、-X が歩道・支柱側（裏面）、Y が高さ（0.455m 〜 0.805m）、Z が道路進行方向
   */
  private createWBeamGeometry(length: number): THREE.BufferGeometry {
    const profileXY: Array<[number, number]> = [
      [0.092, 0.455], // 下端カールリップ先端
      [0.104, 0.464], // 下端リップ折れ部
      [0.145, 0.496], // 下段外側スロープ
      [0.181, 0.526], // 下段クレスト下肩
      [0.186, 0.542], // 下段クレスト頂点
      [0.181, 0.558], // 下段クレスト上肩
      [0.142, 0.588], // 下段内側スロープ
      [0.102, 0.614], // 中央谷部下肩
      [0.095, 0.63], // 中央谷部（トラフ）底面中心
      [0.102, 0.646], // 中央谷部上肩
      [0.142, 0.672], // 上段内側スロープ
      [0.181, 0.702], // 上段クレスト下肩
      [0.186, 0.718], // 上段クレスト頂点
      [0.181, 0.734], // 上段クレスト上肩
      [0.145, 0.764], // 上段外側スロープ
      [0.104, 0.796], // 上端リップ折れ部
      [0.092, 0.805], // 上端カールリップ先端
    ];

    const zSteps = Math.max(4, Math.min(48, Math.round(length / 1.5)));
    const pCount = profileXY.length;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let iz = 0; iz <= zSteps; iz++) {
      const u = iz / zSteps;
      const z = -length / 2 + u * length;
      for (let ip = 0; ip < pCount; ip++) {
        const v = ip / (pCount - 1);
        const [px, py] = profileXY[ip];
        positions.push(px, py, z);
        uvs.push(u * (length / 2.0), v);
      }
    }

    for (let iz = 0; iz < zSteps; iz++) {
      for (let ip = 0; ip < pCount - 1; ip++) {
        const a = iz * pCount + ip;
        const b = (iz + 1) * pCount + ip;
        const c = (iz + 1) * pCount + (ip + 1);
        const d = iz * pCount + (ip + 1);
        indices.push(a, b, c, a, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * 日本特有の180度巻き込み型端末袖ビーム（そでビーム）の BufferGeometry を構築する
   * @param endZ 端支柱の Z 座標（-length/2 または +length/2）
   * @param dirSign -1: 始端（-Z 外側へ巻き込み）, +1: 終端（+Z 外側へ巻き込み）
   */
  private createRolledSleeveTerminalGeometry(endZ: number, dirSign: -1 | 1): THREE.BufferGeometry {
    const baseProfileXY: Array<[number, number]> = [
      [0.092, -0.175],
      [0.104, -0.166],
      [0.145, -0.134],
      [0.181, -0.104],
      [0.186, -0.088],
      [0.181, -0.072],
      [0.142, -0.042],
      [0.102, -0.016],
      [0.095, 0.0],
      [0.102, 0.016],
      [0.142, 0.042],
      [0.181, 0.072],
      [0.186, 0.088],
      [0.181, 0.104],
      [0.145, 0.134],
      [0.104, 0.166],
      [0.092, 0.175],
    ];

    const yCenter = 0.63;
    const arcCenterX = 0.02;
    const arcCenterZ = endZ + dirSign * 0.06;
    const arcRadiusX = 0.168;
    const arcRadiusZ = 0.36;
    const sSteps = 20;
    const pCount = baseProfileXY.length;

    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let is = 0; is <= sSteps; is++) {
      const s = is / sSteps;
      let baseX = 0;
      let zPos = 0;
      let nrmX = 1;
      let nrmZ = 0;
      let morph = 1;

      if (s <= 0.34) {
        const localT = s / 0.34;
        const morphT = Math.min(1, localT / 0.72);
        morph = morphT * morphT * (3 - 2 * morphT);
        zPos = endZ + dirSign * (-0.24 + 0.28 * localT);
        baseX = arcCenterX + arcRadiusX;
        nrmX = 1;
        nrmZ = 0;
      } else {
        const curveT = (s - 0.34) / 0.66;
        morph = 1;
        const theta = curveT * Math.PI;
        baseX = arcCenterX + arcRadiusX * Math.cos(theta);
        zPos = arcCenterZ + dirSign * (arcRadiusZ * Math.sin(theta));
        nrmX = Math.cos(theta);
        nrmZ = dirSign * Math.sin(theta);
      }

      const heightScale = 1 + 0.16 * morph;
      for (let ip = 0; ip < pCount; ip++) {
        const vFrac = (ip / (pCount - 1)) * 2 - 1;
        const [wx, wyOffset] = baseProfileXY[ip];
        const dy = wyOffset * heightScale;
        const wRelX = wx - 0.186;
        let archProfile = 0.004 * Math.cos(vFrac * Math.PI * 0.42);
        const absV = Math.abs(vFrac);
        if (absV > 0.82) {
          const lipT = (absV - 0.82) / 0.18;
          archProfile -= 0.032 * lipT * lipT;
        }
        const relDepth = (1 - morph) * wRelX + morph * archProfile + 0.0035;
        positions.push(baseX + nrmX * relDepth, yCenter + dy, zPos + nrmZ * relDepth);
        uvs.push(s, ip / (pCount - 1));
      }
    }

    for (let is = 0; is < sSteps; is++) {
      for (let ip = 0; ip < pCount - 1; ip++) {
        const a = is * pCount + ip;
        const b = (is + 1) * pCount + ip;
        const c = (is + 1) * pCount + (ip + 1);
        const d = is * pCount + (ip + 1);
        if (dirSign > 0) {
          indices.push(a, b, c, a, c, d);
        } else {
          indices.push(a, c, b, a, d, c);
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * 日本標準ガードレール（JIS G 3193 2山Wビーム＋180度巻き込み袖ビーム＋φ114.3mm鋼管支柱＋黄色反射テープ帯＋Ω型ブラケット＋デリネーター）
   *
   * How:
   * - 同期生成でも単なる BoxGeometry ではなく、実寸の 2山W字波形断面ビーム (`Guardrail_WBeam`)、
   *   両端の180度巻き込み型袖ビーム (`Guardrail_Sleeve_Ends`)、φ114.3mm支柱・ドームキャップ・黄色反射テープ帯・根元モルタルリング (`Guardrail_Posts`)、
   *   Ω型緩衝ブラケット・丸頭スプライスボルト (`Guardrail_Brackets_Bolts`)、支柱頂部デリネーター反射器 (`Guardrail_Delineators`) を生成する。
   * - ブラウザ環境では Blender MCP スクリプト (`blender/scripts/generate_guardrail.py`) で生成した `/models/guardrail.glb` を非同期ロードし、
   *   6.0m モジュール単位でタイル展開＋両端袖ビームを配置して置き換える。
   */
  public createGuardrail(length: number): THREE.Group {
    const slotGroup = new THREE.Group();
    slotGroup.name = "JapaneseGuardrailSlot";
    slotGroup.userData.isGuardrailSlot = true;

    const fallbackGroup = this.buildProceduralGuardrailGroup(length);
    slotGroup.add(fallbackGroup);

    this.guardrailSlots.push({ slotGroup, fallbackGroup, length });
    this.ensureBlenderGuardrailGlbLoaded();

    return slotGroup;
  }

  /**
   * ガードレール・デリネーター等の再帰反射板が参照する車両ヘッドライト（左右2灯）および進行方向・夜間係数を同期する
   * - How: 毎フレーム車両の現在位置とヨー角から左右ヘッドライトのワールド座標 (`±0.64m`, `y=0.67m`, `前方2.34m`) を算出し、
   *   `SHARED_RETROREFLECTOR_UNIFORMS` を in-place 更新して全反射板シェーダーへ即時反映する。
   */
  public static syncRetroreflectorEnvironment(params: RetroreflectorEnvironmentSyncParams): void {
    if (params.headlightPosL) {
      SHARED_RETROREFLECTOR_UNIFORMS.uHeadlightPosL.value.copy(params.headlightPosL);
    }
    if (params.headlightPosR) {
      SHARED_RETROREFLECTOR_UNIFORMS.uHeadlightPosR.value.copy(params.headlightPosR);
    }
    if (params.vehicleForward && params.vehicleForward.lengthSq() > 1e-6) {
      SHARED_RETROREFLECTOR_UNIFORMS.uVehicleForward.value.copy(params.vehicleForward).normalize();
    }
    if (params.headlightsActive !== undefined) {
      SHARED_RETROREFLECTOR_UNIFORMS.uHeadlightsActive.value = THREE.MathUtils.clamp(
        params.headlightsActive,
        0,
        1,
      );
    }
    if (params.nightFactor !== undefined) {
      SHARED_RETROREFLECTOR_UNIFORMS.uEnvironmentNightFactor.value = THREE.MathUtils.clamp(
        params.nightFactor,
        0,
        1,
      );
    }
  }

  /**
   * ガードレールスロット（`JapaneseGuardrailSlot`）に対して距離 LOD ティアを適用し、
   * 省略・非表示化されたサブメッシュ数を返す。
   * - `high` (LOD0): Blender GLB インスタンス（ロード済みの場合）または全ディテール付きプロシージャルモデルを表示
   * - `medium` (LOD1): 高負荷な GLB モジュール群やボルト・ブラケット・袖ビームを非表示化し、Wビーム＋支柱本体＋反射板（`Guardrail_Delineators`）を表示
   * - `low` (LOD2): 遠景向けに単一連続メッシュの Wビーム（`Guardrail_WBeam`）1本のみを表示
   */
  public static applyGuardrailSlotLod(
    slotGroup: THREE.Object3D,
    tier: "high" | "medium" | "low",
  ): number {
    slotGroup.userData.appliedLodTier = tier;
    const fallbackGroup = slotGroup.getObjectByName("GuardrailRoot");
    const glbContainer = slotGroup.getObjectByName("BlenderGuardrailGlbInstance");

    const isHighTier = tier === "high";
    const isMediumTier = tier === "medium";
    const hasGlbContainer = glbContainer !== undefined && glbContainer !== null;

    if (isHighTier && hasGlbContainer) {
      glbContainer.visible = true;
      if (fallbackGroup) {
        fallbackGroup.visible = false;
      }
      return 0;
    }

    if (hasGlbContainer) {
      glbContainer.visible = false;
    }
    if (!fallbackGroup) {
      return 0;
    }

    fallbackGroup.visible = true;
    let simplifiedCount = hasGlbContainer ? glbContainer.children.length : 0;

    const wBeamMesh = fallbackGroup.getObjectByName("Guardrail_WBeam");
    const sleeveGroup = fallbackGroup.getObjectByName("Guardrail_Sleeve_Ends");
    const postsGroup = fallbackGroup.getObjectByName("Guardrail_Posts");
    const bracketsGroup = fallbackGroup.getObjectByName("Guardrail_Brackets_Bolts");
    const delineatorsGroup = fallbackGroup.getObjectByName("Guardrail_Delineators");

    if (wBeamMesh) {
      wBeamMesh.visible = true;
      if ((wBeamMesh as THREE.Mesh).isMesh) {
        wBeamMesh.castShadow = isHighTier;
      }
    }
    if (sleeveGroup) {
      sleeveGroup.visible = isHighTier;
      if (!isHighTier) {
        simplifiedCount += sleeveGroup.children.length;
      }
    }
    if (bracketsGroup) {
      bracketsGroup.visible = isHighTier;
      if (!isHighTier) {
        simplifiedCount += bracketsGroup.children.length;
      }
    }
    if (delineatorsGroup) {
      const shouldShowDelineators = isHighTier || isMediumTier;
      delineatorsGroup.visible = shouldShowDelineators;
      if (!shouldShowDelineators) {
        simplifiedCount += delineatorsGroup.children.length;
      }
    }
    if (postsGroup) {
      const shouldShowPosts = isHighTier || isMediumTier;
      postsGroup.visible = shouldShowPosts;
      if (!shouldShowPosts) {
        simplifiedCount += postsGroup.children.length;
      } else {
        for (const postChild of postsGroup.children) {
          const isPostMicroDetail = postChild.userData.lodDetailTier === "high";
          if (isPostMicroDetail) {
            postChild.visible = isHighTier;
            if (!isHighTier) {
              simplifiedCount++;
            }
          }
          if ((postChild as THREE.Mesh).isMesh) {
            postChild.castShadow = isHighTier;
          }
        }
      }
    }

    return simplifiedCount;
  }

  private buildProceduralGuardrailGroup(length: number): THREE.Group {
    const group = new THREE.Group();
    group.name = "GuardrailRoot";

    const postSpacing = 2.0; // 日本の市街地標準支柱間隔 2.0m
    const spanCount = Math.max(1, Math.round(length / postSpacing));
    const actualSpacing = length / spanCount;

    // 1. Guardrail_WBeam (JIS G 3193 2山波形断面 Wビーム)
    const wbeamGeo = this.createWBeamGeometry(length);
    const wbeamMesh = new THREE.Mesh(wbeamGeo, this.guardrailMat);
    wbeamMesh.name = "Guardrail_WBeam";
    wbeamMesh.castShadow = true;
    wbeamMesh.receiveShadow = true;
    group.add(wbeamMesh);

    // 2. Guardrail_Sleeve_Ends (両端の180度巻き込み型端末袖ビーム)
    const sleeveGroup = new THREE.Group();
    sleeveGroup.name = "Guardrail_Sleeve_Ends";
    const startSleeveMesh = new THREE.Mesh(
      this.createRolledSleeveTerminalGeometry(-length / 2, -1),
      this.guardrailMat,
    );
    startSleeveMesh.castShadow = true;
    startSleeveMesh.receiveShadow = true;
    const endSleeveMesh = new THREE.Mesh(
      this.createRolledSleeveTerminalGeometry(length / 2, 1),
      this.guardrailMat,
    );
    endSleeveMesh.castShadow = true;
    endSleeveMesh.receiveShadow = true;
    sleeveGroup.add(startSleeveMesh, endSleeveMesh);
    group.add(sleeveGroup);

    // 3. Guardrail_Posts (φ114.3mm 鋼管支柱 + 球面ドームキャップ + 黄色高輝度反射テープ帯 + 根元モルタルリング)
    const postsGroup = new THREE.Group();
    postsGroup.name = "Guardrail_Posts";
    const postRadius = 0.0572;
    const postHeight = 0.816;
    const postGeo = new THREE.CylinderGeometry(postRadius, postRadius, postHeight, 16);
    const domeCapGeo = new THREE.SphereGeometry(
      postRadius + 0.002,
      16,
      8,
      0,
      Math.PI * 2,
      0,
      Math.PI * 0.42,
    );
    domeCapGeo.scale(1, 0.38, 1);
    const yellowBandGeo = new THREE.CylinderGeometry(
      postRadius + 0.0015,
      postRadius + 0.0015,
      0.038,
      16,
    );
    const collarGeo = new THREE.CylinderGeometry(0.066, 0.096, 0.018, 16);

    // 4. Guardrail_Brackets_Bolts (Ω型緩衝ブラケット + 丸頭スプライスボルト + 背面ナット)
    const bracketsGroup = new THREE.Group();
    bracketsGroup.name = "Guardrail_Brackets_Bolts";
    const omegaWebGeo = new THREE.BoxGeometry(0.036, 0.25, 0.13);
    const omegaFlangeGeo = new THREE.BoxGeometry(0.006, 0.25, 0.21);
    const boltHeadGeo = new THREE.SphereGeometry(0.015, 8, 6);
    boltHeadGeo.scale(0.55, 1, 1);

    // 5. Guardrail_Delineators (支柱頂部の円形デリネーター反射器 + Wビーム中央谷部の台形両面再帰反射標)
    const delineatorsGroup = new THREE.Group();
    delineatorsGroup.name = "Guardrail_Delineators";
    const delinStemGeo = new THREE.CylinderGeometry(0.011, 0.013, 0.045, 10);
    const delinHousingGeo = new THREE.CylinderGeometry(0.052, 0.052, 0.034, 20);
    delinHousingGeo.rotateX(Math.PI / 2);
    const delinLensGeo = new THREE.CircleGeometry(0.043, 20);

    // Wビーム中央谷部（Y = 0.63m）に装着する台形ブラケット＋傾斜プリズム反射プレート
    const troughBracketGeo = new THREE.BoxGeometry(0.046, 0.068, 0.088);
    const troughLensGeo = new THREE.PlaneGeometry(0.042, 0.058);

    for (let i = 0; i <= spanCount; i++) {
      const z = -length / 2 + i * actualSpacing;
      const isEndPost = i === 0 || i === spanCount;

      // 支柱本体
      const postMesh = new THREE.Mesh(postGeo, this.guardrailMat);
      postMesh.position.set(0, postHeight / 2, z);
      postMesh.castShadow = true;
      postMesh.receiveShadow = true;
      postsGroup.add(postMesh);

      // 支柱頂部ドームキャップ
      const capMesh = new THREE.Mesh(domeCapGeo, this.guardrailMat);
      capMesh.position.set(0, postHeight, z);
      capMesh.userData.lodDetailTier = "high";
      postsGroup.add(capMesh);

      // 支柱中腹の黄色反射テープ帯 (Y = 0.333m)
      const bandMesh = new THREE.Mesh(yellowBandGeo, this.guardrailYellowBandMat);
      bandMesh.position.set(0, 0.333, z);
      bandMesh.userData.lodDetailTier = "high";
      postsGroup.add(bandMesh);

      // 地際モルタルリング
      const collarMesh = new THREE.Mesh(collarGeo, this.guardrailCollarMat);
      collarMesh.position.set(0, 0.009, z);
      collarMesh.userData.lodDetailTier = "high";
      postsGroup.add(collarMesh);

      // Ω型緩衝ブラケット
      const bracketWeb = new THREE.Mesh(omegaWebGeo, this.guardrailMat);
      bracketWeb.position.set(0.072, 0.63, z);
      const bracketFlange = new THREE.Mesh(omegaFlangeGeo, this.guardrailMat);
      bracketFlange.position.set(0.089, 0.63, z);
      bracketsGroup.add(bracketWeb, bracketFlange);

      // スプライス丸頭ボルト列（車道側 +X の上下クレスト y = 0.542m, 0.718m）
      const boltZOffsets = isEndPost
        ? i === 0
          ? [0.068, 0.185]
          : [-0.185, -0.068]
        : [-0.074, 0.074];
      for (const dz of boltZOffsets) {
        for (const by of [0.542, 0.718]) {
          const bolt = new THREE.Mesh(boltHeadGeo, this.guardrailGalvanizedMat);
          bolt.position.set(isEndPost ? 0.193 : 0.189, by, z + dz);
          bracketsGroup.add(bolt);
        }
      }

      // 両端支柱および 6m (3スパン) おきの支柱頂部に円形デリネーターを設置
      const hasTopDelineator = isEndPost || i % 3 === 0;
      if (hasTopDelineator) {
        const delinUnit = new THREE.Group();
        delinUnit.position.set(0.022, 0.835, z);

        const stem = new THREE.Mesh(delinStemGeo, this.delineatorHousingMat);
        stem.position.y = 0.022;
        const housing = new THREE.Mesh(delinHousingGeo, this.delineatorHousingMat);
        housing.position.y = 0.088;

        const amberLens = new THREE.Mesh(delinLensGeo, this.delineatorAmberMat);
        amberLens.name = "GuardrailTopDelineatorAmber";
        amberLens.position.set(0, 0.088, -0.018);
        amberLens.rotation.y = Math.PI;

        const whiteLens = new THREE.Mesh(delinLensGeo, this.delineatorWhiteMat);
        whiteLens.name = "GuardrailTopDelineatorWhite";
        whiteLens.position.set(0, 0.088, 0.018);

        delinUnit.add(stem, housing, amberLens, whiteLens);
        delineatorsGroup.add(delinUnit);
      }

      // Wビーム中央谷部（Y = 0.63m）に台形両面再帰反射標を設置（各支柱位置でヘッドライト光を鮮烈に再帰反射）
      const troughUnit = new THREE.Group();
      troughUnit.name = "GuardrailTroughReflectorUnit";
      troughUnit.position.set(0.122, 0.63, z);

      const troughHousing = new THREE.Mesh(troughBracketGeo, this.delineatorHousingMat);
      troughUnit.add(troughHousing);

      // -Z 方向（手前からの進行車線）を向くアンバープリズム反射板（車道側 +X へ 26度傾斜）
      const troughAmber = new THREE.Mesh(troughLensGeo, this.delineatorAmberMat);
      troughAmber.name = "GuardrailTroughReflectorAmber";
      troughAmber.position.set(0.004, 0, -0.046);
      troughAmber.rotation.y = Math.PI - 0.45;
      troughUnit.add(troughAmber);

      // +Z 方向（奥側からの対向車線）を向くホワイトプリズム反射板（車道側 +X へ 26度傾斜）
      const troughWhite = new THREE.Mesh(troughLensGeo, this.delineatorWhiteMat);
      troughWhite.name = "GuardrailTroughReflectorWhite";
      troughWhite.position.set(0.004, 0, 0.046);
      troughWhite.rotation.y = 0.45;
      troughUnit.add(troughWhite);

      delineatorsGroup.add(troughUnit);
    }

    group.add(postsGroup, bracketsGroup, delineatorsGroup);
    return group;
  }

  private ensureBlenderGuardrailGlbLoaded(): void {
    const isBrowser = typeof window !== "undefined";
    if (!isBrowser) {
      return;
    }
    if (this.glbGuardrailTemplate) {
      this.populateGuardrailSlotsFromGlb(this.glbGuardrailTemplate);
      return;
    }
    if (this.isLoadingGuardrailGlb) {
      return;
    }
    this.isLoadingGuardrailGlb = true;

    const guardrailConfig = assetManager.getModelConfig("guardrail");
    const rawPath = guardrailConfig?.path ?? "/models/guardrail.glb";
    const resolvedUrl = assetManager.resolveAssetUrl(rawPath);
    const loader = new GLTFLoader();

    loader.load(
      resolvedUrl,
      (gltf) => {
        const template = gltf.scene;
        template.traverse((child) => {
          const isMesh = (child as THREE.Mesh).isMesh;
          if (!isMesh) {
            return;
          }
          const mesh = child as THREE.Mesh;
          mesh.castShadow = true;
          mesh.receiveShadow = true;

          // GLB 内の各マテリアルにも 3D ボリュームテクスチャ＆コーナーキューブ再帰反射シェーダーを適用
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const mat of materials) {
            const stdMat = mat as THREE.MeshStandardMaterial;
            if (!stdMat || !stdMat.isMeshStandardMaterial) {
              continue;
            }
            const matName = stdMat.name || "";
            if (matName.includes("GuardrailWhitePaint")) {
              applyRoadProp3DTexture(stdMat, "guardrail");
            } else if (matName.includes("GalvanizedSteel")) {
              applyRoadProp3DTexture(stdMat, "pole");
            } else if (matName.includes("DelineatorAmber")) {
              stdMat.emissive.setHex(0xff7b00);
              stdMat.emissiveIntensity = 1.35;
              stdMat.roughness = 0.1;
              stdMat.metalness = 0.42;
              applyRoadProp3DTexture(stdMat, "retroreflector");
            } else if (matName.includes("DelineatorWhite")) {
              stdMat.emissive.setHex(0xffffff);
              stdMat.emissiveIntensity = 1.25;
              stdMat.roughness = 0.08;
              stdMat.metalness = 0.45;
              applyRoadProp3DTexture(stdMat, "retroreflector");
            } else if (matName.includes("ReflectiveYellowBand")) {
              stdMat.emissive.setHex(0xf59e0b);
              stdMat.emissiveIntensity = 0.72;
              stdMat.roughness = 0.14;
              stdMat.metalness = 0.35;
              applyRoadProp3DTexture(stdMat, "retroreflector");
            } else if (matName.includes("Delineator")) {
              applyRoadProp3DTexture(stdMat, "bollard");
            }
          }
        });

        this.glbGuardrailTemplate = template;
        this.populateGuardrailSlotsFromGlb(template);
      },
      undefined,
      () => {
        // GLB 読込失敗時は同期生成済みの高精度プロシージャルガードレールをそのまま維持
        this.isLoadingGuardrailGlb = false;
      },
    );
  }

  private populateGuardrailSlotsFromGlb(template: THREE.Group): void {
    const moduleLength = 6.0; // guardrail.glb の1モジュール基準長（3スパン = 6.0m）

    for (const slot of this.guardrailSlots) {
      const alreadyPopulated = slot.slotGroup.userData.glbPopulated === true;
      if (alreadyPopulated) {
        continue;
      }
      slot.slotGroup.userData.glbPopulated = true;

      const glbContainer = new THREE.Group();
      glbContainer.name = "BlenderGuardrailGlbInstance";

      const moduleCount = Math.max(1, Math.round(slot.length / moduleLength));
      const scaleZ = slot.length / (moduleCount * moduleLength);

      for (let m = 0; m < moduleCount; m++) {
        const isFirst = m === 0;
        const isLast = m === moduleCount - 1;
        const modClone = template.clone(true);

        // 中間モジュールでは両端の巻き込み袖ビームを非表示にし、区間全体の両端にだけ袖ビームを表示する
        if (!isFirst && !isLast) {
          modClone.traverse((child) => {
            if (child.name.includes("Guardrail_Sleeve_Ends")) {
              child.visible = false;
            }
          });
        }

        const zCenter = -slot.length / 2 + (m + 0.5) * (slot.length / moduleCount);
        modClone.position.set(0, 0, zCenter);
        modClone.scale.set(1, 1, scaleZ);
        glbContainer.add(modClone);
      }

      slot.slotGroup.add(glbContainer);
      const appliedTier =
        (slot.slotGroup.userData.appliedLodTier as "high" | "medium" | "low" | undefined) ?? "high";
      RoadProps.applyGuardrailSlotLod(slot.slotGroup, appliedTier);
    }
  }

  /**
   * マンホール（鋳鉄丸型蓋：直径60cm、外周リング）
   */
  public createManhole(x: number, z: number): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0.015, z);

    // 外枠リング
    const rimGeo = new THREE.TorusGeometry(0.36, 0.03, 8, 24);
    rimGeo.rotateX(Math.PI / 2);
    const rim = new THREE.Mesh(rimGeo, this.manholeMat);
    group.add(rim);

    // 蓋本体
    const plateGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.02, 24);
    const plate = new THREE.Mesh(plateGeo, this.manholeMat);
    plate.position.y = 0.005;
    group.add(plate);

    // 中心紋章エンブレム
    const crestGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.025, 6);
    const crest = new THREE.Mesh(crestGeo, this.manholeMat);
    crest.position.y = 0.008;
    group.add(crest);

    return group;
  }

  /**
   * 側溝・グレーチング（集水桝）
   */
  public createGrating(x: number, z: number): THREE.Mesh {
    const geo = new THREE.BoxGeometry(0.4, 0.03, 0.8);
    const mesh = new THREE.Mesh(geo, this.gratingMat);
    mesh.position.set(x, 0.01, z);
    return mesh;
  }

  /**
   * 車両用LED信号レンズのマテリアル生成（点灯1灯のみ発光・残り2灯は消灯ダークスモークLED素子面）
   *
   * How:
   * - 点灯時（isActive = true）は警察庁仕様の青緑（#00e5c3）・黄（#fbbf24）・赤（#ef4444）の
   *   同心円LED素子配列を CanvasTexture で描画し、emissiveMap と高い emissiveIntensity を設定する。
   * - 消灯時（isActive = false）は無点灯の暗いチャコールスモークLEDドット網目模様（#141820）を描画し、
   *   emissiveIntensity = 0 とすることで、3色同時点灯による非現実的な見た目を防ぐ。
   */
  private createVehicleLedLensMaterial(
    signalColor: "green" | "yellow" | "red",
    isActive: boolean,
  ): THREE.MeshStandardMaterial {
    const palette = {
      green: {
        baseHex: 0x00d8b8,
        emissiveHex: 0x00e5c3,
        bgCss: "#042f2e",
        ringCss: "#00b894",
        dotCss: "#00f5d4",
        coreCss: "#ccfbf1",
      },
      yellow: {
        baseHex: 0xf59e0b,
        emissiveHex: 0xfbbf24,
        bgCss: "#3b2106",
        ringCss: "#d97706",
        dotCss: "#fbbf24",
        coreCss: "#fef08a",
      },
      red: {
        baseHex: 0xef4444,
        emissiveHex: 0xf87171,
        bgCss: "#3b0a0a",
        ringCss: "#dc2626",
        dotCss: "#ff4d4d",
        coreCss: "#fee2e2",
      },
    }[signalColor];

    const hasDocument = typeof document !== "undefined";
    let lensTex: THREE.CanvasTexture | null = null;

    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext("2d");
      const hasCtx = Boolean(ctx);
      if (hasCtx) {
        const cx = 64;
        const cy = 64;
        ctx!.clearRect(0, 0, 128, 128);

        // 外周ゴムパッキン枠
        ctx!.fillStyle = "#0b0f17";
        ctx!.beginPath();
        ctx!.arc(cx, cy, 62, 0, Math.PI * 2);
        ctx!.fill();

        if (isActive) {
          const grad = ctx!.createRadialGradient(cx, cy, 6, cx, cy, 56);
          grad.addColorStop(0, palette.coreCss);
          grad.addColorStop(0.55, palette.dotCss);
          grad.addColorStop(0.88, palette.ringCss);
          grad.addColorStop(1, palette.bgCss);
          ctx!.fillStyle = grad;
          ctx!.beginPath();
          ctx!.arc(cx, cy, 56, 0, Math.PI * 2);
          ctx!.fill();

          // 同心円LED素子ドット配列
          const rings = [10, 20, 30, 40, 49];
          for (const radius of rings) {
            const count = Math.max(8, Math.round(radius * 0.65));
            for (let i = 0; i < count; i++) {
              const angle = (i / count) * Math.PI * 2;
              const dx = cx + Math.cos(angle) * radius;
              const dy = cy + Math.sin(angle) * radius;
              ctx!.fillStyle = palette.coreCss;
              ctx!.beginPath();
              ctx!.arc(dx, dy, 2.2, 0, Math.PI * 2);
              ctx!.fill();
            }
          }
        } else {
          // 消灯時のスモークグレー・コブレンズ面
          const offGrad = ctx!.createRadialGradient(cx - 10, cy - 12, 4, cx, cy, 56);
          offGrad.addColorStop(0, "#222936");
          offGrad.addColorStop(0.65, "#141821");
          offGrad.addColorStop(1, "#0b0e14");
          ctx!.fillStyle = offGrad;
          ctx!.beginPath();
          ctx!.arc(cx, cy, 56, 0, Math.PI * 2);
          ctx!.fill();

          const rings = [12, 24, 36, 47];
          ctx!.fillStyle = "#1f2633";
          for (const radius of rings) {
            const count = Math.max(8, Math.round(radius * 0.55));
            for (let i = 0; i < count; i++) {
              const angle = (i / count) * Math.PI * 2;
              const dx = cx + Math.cos(angle) * radius;
              const dy = cy + Math.sin(angle) * radius;
              ctx!.beginPath();
              ctx!.arc(dx, dy, 1.8, 0, Math.PI * 2);
              ctx!.fill();
            }
          }
        }
      }
      lensTex = new THREE.CanvasTexture(canvas);
      lensTex.colorSpace = THREE.SRGBColorSpace;
    }

    if (isActive) {
      return new THREE.MeshStandardMaterial({
        color: palette.baseHex,
        map: lensTex,
        emissive: new THREE.Color(palette.emissiveHex),
        emissiveMap: lensTex,
        emissiveIntensity: 1.65,
        roughness: 0.18,
        metalness: 0.08,
      });
    }

    return new THREE.MeshStandardMaterial({
      color: 0x141820,
      map: lensTex,
      emissive: new THREE.Color(0x000000),
      emissiveIntensity: 0,
      roughness: 0.28,
      metalness: 0.22,
    });
  }

  /**
   * 矢印補助信号（青緑LED右折/直進矢印）レンズマテリアル生成
   */
  private createArrowLedLensMaterial(isActive: boolean): THREE.MeshStandardMaterial {
    const hasDocument = typeof document !== "undefined";
    let arrowTex: THREE.CanvasTexture | null = null;

    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext("2d");
      const hasCtx = Boolean(ctx);
      if (hasCtx) {
        ctx!.fillStyle = "#0e131b";
        ctx!.beginPath();
        ctx!.arc(64, 64, 60, 0, Math.PI * 2);
        ctx!.fill();

        ctx!.strokeStyle = isActive ? "#00f5d4" : "#1e2633";
        ctx!.lineWidth = 12;
        ctx!.lineCap = "round";
        ctx!.lineJoin = "round";
        ctx!.beginPath();
        ctx!.moveTo(28, 64);
        ctx!.lineTo(94, 64);
        ctx!.moveTo(70, 40);
        ctx!.lineTo(96, 64);
        ctx!.lineTo(70, 88);
        ctx!.stroke();
      }
      arrowTex = new THREE.CanvasTexture(canvas);
      arrowTex.colorSpace = THREE.SRGBColorSpace;
    }

    return new THREE.MeshStandardMaterial({
      color: isActive ? 0x00d8b8 : 0x12161f,
      map: arrowTex,
      emissive: new THREE.Color(isActive ? 0x00e5c3 : 0x000000),
      emissiveMap: isActive ? arrowTex : null,
      emissiveIntensity: isActive ? 1.45 : 0,
      roughness: 0.22,
      metalness: 0.14,
    });
  }

  /**
   * 日本の歩行者用信号機（警交仕規・LEDドットマトリクス式角型レンズ：上段＝赤立像、下段＝青緑歩行像）のマテリアル生成
   *
   * How:
   * - 256×256 Canvas 上に、日本の薄型LED歩行者用交通信号灯器のダークスモーク・ルーバー（太陽光疑似点灯防止の細密横格子）と
   *   内側の八角形/円形マスク枠を描画する。
   * - 別キャンバスに日本の歩行者信号ピクトグラム（上段：帽子・肩・胴・腕・揃えた脚の赤色立像、下段：前傾姿勢で大きく腕を振り歩幅を広げて歩く青緑色歩行像）を描き、
   *   高精細LEDドットマトリクス（6pxピッチの発光素子配列）としてサンプリング描画することで、本物のLED歩行者用信号機の質感を再現する。
   */
  private createPedestrianLedLensMaterial(
    kind: "red-standing" | "green-walking",
    isActive: boolean,
  ): THREE.MeshStandardMaterial {
    const isRed = kind === "red-standing";
    const activeColorHex = isRed ? 0xff3b30 : 0x00e5b0;
    const activeGlowCss = isRed ? "#ff3b30" : "#00e6b8";
    const activeCoreCss = isRed ? "#ffd6d2" : "#ccfbf1";
    const inactiveDotCss = isRed ? "#29181b" : "#142826";

    const hasDocument = typeof document !== "undefined";
    let pedTex: THREE.CanvasTexture | null = null;

    if (hasDocument) {
      const size = 256;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      const hasCtx = Boolean(ctx);
      if (hasCtx) {
        // 1. 角型ダークマスク筐体枠と防眩ルーバー背景
        ctx!.fillStyle = "#080b10";
        ctx!.fillRect(0, 0, size, size);

        // 外周の金属/樹脂ベゼル段差
        ctx!.strokeStyle = "#263040";
        ctx!.lineWidth = 10;
        ctx!.strokeRect(5, 5, size - 10, size - 10);

        ctx!.strokeStyle = "#141a23";
        ctx!.lineWidth = 4;
        ctx!.strokeRect(14, 14, size - 28, size - 28);

        // レンズ有効発光窓（日本の歩行者灯器特有の角丸正方形〜円形ダークレンズ窓）
        ctx!.fillStyle = "#0c1017";
        ctx!.beginPath();
        ctx!.arc(128, 128, 106, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.strokeStyle = "#1e2736";
        ctx!.lineWidth = 3;
        ctx!.stroke();

        // 2. ピクトグラム形状マスクの描画（オフスクリーンまたは直接シルエット＋LEDドット重畳）
        const drawPictogram = (targetCtx: CanvasRenderingContext2D, color: string) => {
          targetCtx.fillStyle = color;
          targetCtx.strokeStyle = color;
          targetCtx.lineCap = "round";
          targetCtx.lineJoin = "round";

          if (isRed) {
            // 日本の歩行者用信号「赤色立像」（頭部＋帽子つば風シルエット・台形胴体・両脇の腕・揃えた2本脚）
            targetCtx.beginPath();
            targetCtx.arc(128, 52, 20, 0, Math.PI * 2);
            targetCtx.fill();

            // 肩〜胴体（日本の立像特有のしっかりした肩幅と腰）
            targetCtx.beginPath();
            targetCtx.moveTo(98, 82);
            targetCtx.lineTo(158, 82);
            targetCtx.lineTo(150, 146);
            targetCtx.lineTo(106, 146);
            targetCtx.closePath();
            targetCtx.fill();

            // 両腕（肩から少し離して垂直よりわずかにハの字に下ろす）
            targetCtx.lineWidth = 15;
            targetCtx.beginPath();
            targetCtx.moveTo(99, 88);
            targetCtx.lineTo(84, 144);
            targetCtx.moveTo(157, 88);
            targetCtx.lineTo(172, 144);
            targetCtx.stroke();

            // 両脚（中央に明確なスリットを空けて直立）
            targetCtx.lineWidth = 17;
            targetCtx.beginPath();
            targetCtx.moveTo(116, 146);
            targetCtx.lineTo(115, 220);
            targetCtx.moveTo(140, 146);
            targetCtx.lineTo(141, 220);
            targetCtx.stroke();
          } else {
            // 日本の歩行者用信号「青緑色歩行像」（左向きに颯爽と横断するピクトグラム）
            // 頭部
            targetCtx.beginPath();
            targetCtx.arc(122, 50, 20, 0, Math.PI * 2);
            targetCtx.fill();

            // 胴体（左へ進行するやや前傾の台形トルソー）
            targetCtx.beginPath();
            targetCtx.moveTo(108, 78);
            targetCtx.lineTo(144, 82);
            targetCtx.lineTo(138, 144);
            targetCtx.lineTo(104, 142);
            targetCtx.closePath();
            targetCtx.fill();

            // 前後に振る両腕（前腕は左前方へ曲げ、後腕は右後方へ伸ばす）
            targetCtx.lineWidth = 14;
            targetCtx.beginPath();
            targetCtx.moveTo(114, 86);
            targetCtx.lineTo(84, 118);
            targetCtx.lineTo(74, 112);
            targetCtx.moveTo(136, 88);
            targetCtx.lineTo(168, 124);
            targetCtx.stroke();

            // 大きく踏み出す両脚（前脚は左前へ、後脚は右後ろへ蹴り出す日本の青信号特有のシルエット）
            targetCtx.lineWidth = 17;
            targetCtx.beginPath();
            targetCtx.moveTo(114, 140);
            targetCtx.lineTo(84, 214);
            targetCtx.lineTo(74, 214);
            targetCtx.moveTo(130, 140);
            targetCtx.lineTo(154, 182);
            targetCtx.lineTo(172, 216);
            targetCtx.stroke();
          }
        };

        // 消灯時もうっすら見えるLED基板シルエットと、点灯時のベース発光層を描画
        drawPictogram(ctx!, isActive ? activeGlowCss : inactiveDotCss);

        // 3. LEDドットマトリクス格子＆太陽光遮光ルーバーのオーバーレイ
        // 黒い格子スリットを上から重ねることで、ピクトグラムをシャープなLEDドット集合体に分割する
        ctx!.strokeStyle = "#080b10";
        ctx!.lineWidth = 2.2;
        const gridStep = 7;
        for (let pos = 18; pos < size - 18; pos += gridStep) {
          ctx!.beginPath();
          ctx!.moveTo(18, pos);
          ctx!.lineTo(size - 18, pos);
          ctx!.moveTo(pos, 18);
          ctx!.lineTo(pos, size - 18);
          ctx!.stroke();
        }

        // 点灯時は中心部をさらに高輝度なLEDコア色（白みの強い赤／白みの強い青緑）でハイライト
        if (isActive) {
          ctx!.save();
          ctx!.globalCompositeOperation = "lighter";
          ctx!.globalAlpha = 0.48;
          drawPictogram(ctx!, activeCoreCss);
          ctx!.restore();

          // ルーバー横縞を再描画してLED素子の粒立ちを引き締める
          ctx!.strokeStyle = "rgba(8, 11, 16, 0.65)";
          ctx!.lineWidth = 1.6;
          for (let y = 18; y < size - 18; y += gridStep) {
            ctx!.beginPath();
            ctx!.moveTo(18, y);
            ctx!.lineTo(size - 18, y);
            ctx!.stroke();
          }
        }
      }
      pedTex = new THREE.CanvasTexture(canvas);
      pedTex.colorSpace = THREE.SRGBColorSpace;
    }

    if (isActive) {
      return new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: pedTex,
        emissive: new THREE.Color(activeColorHex),
        emissiveMap: pedTex,
        emissiveIntensity: 1.75,
        roughness: 0.22,
        metalness: 0.12,
      });
    }

    return new THREE.MeshStandardMaterial({
      color: 0x1a202c,
      map: pedTex,
      emissive: new THREE.Color(0x000000),
      emissiveIntensity: 0,
      roughness: 0.32,
      metalness: 0.18,
    });
  }

  /**
   * 歩行者用灯器上部の「歩行者・自転車専用」標示プレート生成
   */
  private createPedestrianHeaderPlateMesh(): THREE.Mesh {
    const geo = new THREE.BoxGeometry(0.32, 0.085, 0.016);
    const hasDocument = typeof document !== "undefined";
    let tex: THREE.CanvasTexture | null = null;

    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 64;
      const ctx = canvas.getContext("2d");
      const hasCtx = Boolean(ctx);
      if (hasCtx) {
        ctx!.fillStyle = "#f8fafc";
        ctx!.fillRect(0, 0, 256, 64);
        ctx!.strokeStyle = "#1d4ed8";
        ctx!.lineWidth = 6;
        ctx!.strokeRect(4, 4, 248, 56);
        ctx!.fillStyle = "#0f172a";
        ctx!.font = "bold 24px sans-serif";
        ctx!.textAlign = "center";
        ctx!.textBaseline = "middle";
        ctx!.fillText("歩行者・自転車専用", 128, 33);
      }
      tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
    }

    const mat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      map: tex,
      roughness: 0.38,
      metalness: 0.08,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = "PedBicycleHeaderPlate";
    return mesh;
  }

  /**
   * 信号柱下部の歩行者用「押ボタン箱（おしてください）」生成
   */
  private createPedestrianPushButtonBox(): THREE.Group {
    const boxGroup = new THREE.Group();
    boxGroup.name = "PedPushButtonBox";

    const bodyGeo = new THREE.BoxGeometry(0.12, 0.22, 0.09);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15, // 日本の標準的な黄色い押ボタン箱
      roughness: 0.42,
      metalness: 0.25,
    });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    boxGroup.add(bodyMesh);

    const btnGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.018, 16);
    btnGeo.rotateX(Math.PI / 2);
    const btnMat = new THREE.MeshStandardMaterial({
      color: 0xdc2626,
      roughness: 0.3,
      metalness: 0.1,
    });
    const btnMesh = new THREE.Mesh(btnGeo, btnMat);
    btnMesh.position.set(0, -0.02, 0.05);
    boxGroup.add(btnMesh);

    return boxGroup;
  }

  /**
   * 日本の横型LED交通信号機（警察庁・警視庁 千代田区丸の内／日比谷通り景観地区仕様）
   *
   * How:
   * - 車両用3灯（左から青緑・黄・赤）のうち activeSignal（既定は "green"）の1灯のみを高輝度LED発光させ、
   *   残り2灯は消灯ダークスモークLED素子面（emissiveIntensity = 0）として描画する。
   * - 点灯中のランプ前面には実光源（THREE.PointLight: TrafficSignalActiveLight）を配置し、夜間や雨天時に路面・周囲を照らす。
   * - 薄型カプセル端デザインのLED車両用灯器筐体（VehicleSignalHead）、上下2本平行アーム＋アーチ支持材、
   *   右折青緑矢印補助灯器（ArrowSignalSubUnit）、地点名プレート（IntersectionNamePlate）、
   *   および角型2灯ピクトグラム式歩行者用灯器（PedestrianSignalHead +「歩行者・自転車専用」標示板 + 押ボタン箱）を構築する。
   */
  public createTrafficLight(
    x: number,
    z: number,
    rotationY = 0,
    options?: {
      activeSignal?: "green" | "yellow" | "red";
      intersectionNameJa?: string;
      intersectionNameEn?: string;
      showArrowSignal?: boolean;
    },
  ): THREE.Group {
    const activeSignal = options?.activeSignal ?? "green";
    const intersectionNameJa = options?.intersectionNameJa ?? "東京駅丸の内中央口";
    const intersectionNameEn = options?.intersectionNameEn ?? "Tokyo Sta. Central";
    const showArrowSignal = options?.showArrowSignal ?? true;

    const group = new THREE.Group();
    group.name = "JapaneseTrafficSignalGroup";
    group.position.set(x, 0, z);
    group.rotation.y = rotationY;

    // 1. 信号柱（テーパー鋼管柱・高さ6.6m）＋ 根元フランジ ＋ 柱頭キャップ
    const poleGeo = new THREE.CylinderGeometry(0.115, 0.155, 6.6, 20);
    const pole = new THREE.Mesh(poleGeo, this.poleMat);
    pole.name = "TrafficSignalPole";
    pole.position.y = 3.3;
    pole.castShadow = true;
    group.add(pole);

    const flangeGeo = new THREE.CylinderGeometry(0.24, 0.27, 0.14, 20);
    const flange = new THREE.Mesh(flangeGeo, this.poleMat);
    flange.name = "TrafficPoleBaseFlange";
    flange.position.y = 0.07;
    flange.userData.lodDetailTier = "high";
    group.add(flange);

    const capGeo = new THREE.SphereGeometry(0.12, 16, 12);
    const cap = new THREE.Mesh(capGeo, this.poleMat);
    cap.position.y = 6.62;
    cap.userData.lodDetailTier = "high";
    group.add(cap);

    // 2. 警視庁仕様・交通信号制御機ボックス（柱脇の配電制御キャビネット）＋ 端子箱
    const cabinetGeo = new THREE.BoxGeometry(0.42, 1.35, 0.34);
    const cabinet = new THREE.Mesh(cabinetGeo, this.bodyMat);
    cabinet.name = "TrafficControllerCabinet";
    cabinet.position.set(-0.34, 0.68, 0);
    cabinet.castShadow = true;
    cabinet.userData.lodDetailTier = "high";
    group.add(cabinet);

    const jboxGeo = new THREE.BoxGeometry(0.16, 0.28, 0.14);
    const jbox = new THREE.Mesh(jboxGeo, this.bodyMat);
    jbox.name = "JunctionBox";
    jbox.position.set(0, 4.15, -0.14);
    jbox.userData.lodDetailTier = "high";
    group.add(jbox);

    // 3. 日本式の2本平行支持アーム＋テーパーアーチ支持材＋柱抱き金具
    const armLength = 4.1;
    const armCenterX = 2.05;
    const upperArmGeo = new THREE.CylinderGeometry(0.055, 0.065, armLength, 14);
    upperArmGeo.rotateZ(Math.PI / 2);
    const upperArm = new THREE.Mesh(upperArmGeo, this.poleMat);
    upperArm.name = "ArmUpperPipe";
    upperArm.position.set(armCenterX, 5.96, 0);
    upperArm.castShadow = true;
    group.add(upperArm);

    const lowerArmGeo = new THREE.CylinderGeometry(0.048, 0.058, armLength, 14);
    lowerArmGeo.rotateZ(Math.PI / 2);
    const lowerArm = new THREE.Mesh(lowerArmGeo, this.poleMat);
    lowerArm.name = "ArmLowerPipe";
    lowerArm.position.set(armCenterX, 5.56, 0);
    lowerArm.castShadow = true;
    lowerArm.userData.lodDetailTier = "medium";
    group.add(lowerArm);

    // アーム間の垂直振れ止めストラット＆斜めブレース（日比谷通り・丸の内仕様）
    const braceGeo = new THREE.CylinderGeometry(0.032, 0.038, 1.85, 10);
    braceGeo.rotateZ(Math.PI / 2 - 0.22);
    const archStrut = new THREE.Mesh(braceGeo, this.poleMat);
    archStrut.name = "ArmArchStrut";
    archStrut.position.set(0.95, 5.32, 0);
    archStrut.userData.lodDetailTier = "high";
    group.add(archStrut);

    for (const tieX of [0.85, 1.75, 2.65, 3.65]) {
      const tieGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.4, 8);
      const tie = new THREE.Mesh(tieGeo, this.poleMat);
      tie.position.set(tieX, 5.76, 0);
      tie.userData.lodDetailTier = "high";
      group.add(tie);
    }

    // 柱への抱き金具（クランプバンド）
    for (const bandY of [5.56, 5.96, 5.12]) {
      const bandGeo = new THREE.CylinderGeometry(0.145, 0.145, 0.08, 16);
      const band = new THREE.Mesh(bandGeo, this.bodyMat);
      band.position.set(0, bandY, 0);
      band.userData.lodDetailTier = "high";
      group.add(band);
    }

    // 4. 車両用薄型LED信号灯器（カプセル端筐体・300mmレンズ規格・左から青緑・黄・赤）
    const signalHead = new THREE.Group();
    signalHead.name = "VehicleSignalHead";
    // アーム（z = 0）の前面（z = +0.20）にブラケットを介して吊り下げ、アームが灯器を貫通しない構造にする
    signalHead.position.set(3.2, 5.74, 0.2);
    group.add(signalHead);

    // 背面の吊り金具（アームと灯器背面を接続）
    for (const bracketX of [-0.42, 0.42]) {
      const hangerGeo = new THREE.BoxGeometry(0.06, 0.28, 0.22);
      const hanger = new THREE.Mesh(hangerGeo, this.poleMat);
      hanger.position.set(bracketX, 0.08, -0.14);
      signalHead.add(hanger);
    }

    // カプセル型薄型ハウジング（中央直方体＋左右の半円筒エンドキャップ）
    const centerBodyGeo = new THREE.BoxGeometry(0.88, 0.46, 0.15);
    const centerBody = new THREE.Mesh(centerBodyGeo, this.bodyMat);
    centerBody.castShadow = true;
    signalHead.add(centerBody);

    const endCapGeo = new THREE.CylinderGeometry(0.23, 0.23, 0.15, 20);
    endCapGeo.rotateX(Math.PI / 2);
    const leftEndCap = new THREE.Mesh(endCapGeo, this.bodyMat);
    leftEndCap.position.set(-0.44, 0, 0);
    signalHead.add(leftEndCap);

    const rightEndCap = new THREE.Mesh(endCapGeo, this.bodyMat);
    rightEndCap.position.set(0.44, 0, 0);
    signalHead.add(rightEndCap);

    // 3色LEDレンズと円形ベゼル、および日本仕様のドーム型上部フード（庇）
    const lampRadius = 0.145;
    const lampGeo = new THREE.CylinderGeometry(lampRadius, lampRadius, 0.035, 24);
    lampGeo.rotateX(Math.PI / 2);

    const bezelGeo = new THREE.TorusGeometry(lampRadius + 0.012, 0.016, 10, 24);
    // 上半分を覆う深めの遮光フード（庇）
    const visorGeo = new THREE.CylinderGeometry(
      lampRadius + 0.014,
      lampRadius + 0.022,
      0.22,
      20,
      1,
      true,
      0,
      Math.PI,
    );
    visorGeo.rotateX(Math.PI / 2);
    visorGeo.rotateZ(Math.PI / 2);

    const lampSpecs: Array<{
      key: "green" | "yellow" | "red";
      lampName: string;
      visorName: string;
      xOffset: number;
      lightColorHex: number;
    }> = [
      {
        key: "green",
        lampName: "VehicleLamp_BlueGreen",
        visorName: "VehicleVisor_BlueGreen",
        xOffset: -0.42,
        lightColorHex: 0x00e5c3,
      },
      {
        key: "yellow",
        lampName: "VehicleLamp_Yellow",
        visorName: "VehicleVisor_Yellow",
        xOffset: 0,
        lightColorHex: 0xfbbf24,
      },
      {
        key: "red",
        lampName: "VehicleLamp_Red",
        visorName: "VehicleVisor_Red",
        xOffset: 0.42,
        lightColorHex: 0xef4444,
      },
    ];

    for (const spec of lampSpecs) {
      const isLampActive = activeSignal === spec.key;
      const lampMat = this.createVehicleLedLensMaterial(spec.key, isLampActive);
      const lampMesh = new THREE.Mesh(lampGeo, lampMat);
      lampMesh.name = spec.lampName;
      lampMesh.position.set(spec.xOffset, 0, 0.072);
      signalHead.add(lampMesh);

      const bezelMesh = new THREE.Mesh(bezelGeo, this.visorMat);
      bezelMesh.position.set(spec.xOffset, 0, 0.082);
      signalHead.add(bezelMesh);

      const visorMesh = new THREE.Mesh(visorGeo, this.visorMat);
      visorMesh.name = spec.visorName;
      visorMesh.position.set(spec.xOffset, 0.015, 0.175);
      signalHead.add(visorMesh);

      if (isLampActive) {
        const activeLight = new THREE.PointLight(spec.lightColorHex, 2.2, 22.0, 1.6);
        activeLight.name = "TrafficSignalActiveLight";
        activeLight.position.set(spec.xOffset, -0.02, 0.28);
        signalHead.add(activeLight);
      }
    }

    // 5. 矢印補助信号機（主灯器右下にブラケットで併設される日本の青緑右折矢印灯器）
    if (showArrowSignal) {
      const arrowUnit = new THREE.Group();
      arrowUnit.name = "ArrowSignalSubUnit";
      arrowUnit.position.set(0.42, -0.44, 0);
      arrowUnit.userData.lodDetailTier = "medium";
      signalHead.add(arrowUnit);

      // 吊り下げ連結ステー
      const strutGeo = new THREE.BoxGeometry(0.05, 0.2, 0.05);
      const strut = new THREE.Mesh(strutGeo, this.poleMat);
      strut.position.set(0, 0.2, -0.02);
      arrowUnit.add(strut);

      const arrowBodyGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.14, 20);
      arrowBodyGeo.rotateX(Math.PI / 2);
      const arrowBody = new THREE.Mesh(arrowBodyGeo, this.bodyMat);
      arrowUnit.add(arrowBody);

      const arrowLensMat = this.createArrowLedLensMaterial(true);
      const arrowLens = new THREE.Mesh(lampGeo, arrowLensMat);
      arrowLens.name = "ArrowSignalLens";
      arrowLens.position.set(0, 0, 0.068);
      arrowUnit.add(arrowLens);

      const arrowVisor = new THREE.Mesh(visorGeo, this.visorMat);
      arrowVisor.position.set(0, 0.015, 0.165);
      arrowUnit.add(arrowVisor);
    }

    // 6. 日本の縦型・角型2灯式歩行者用信号機（横断歩道を渡る歩行者へ正対するよう +X 方向＝車道横断方向へ向けて設置）
    // Why not rotation.y = 0（車両用灯器と同じ +Z 向き）にするか:
    // 歩行者用信号機は車道を走る車ではなく「横断歩道の対岸歩道で待つ歩行者（ローカル +X 方向）」に正対する必要があるため、
    // 支柱の横断歩道側（z = +0.48）に張り出し、rotation.y = Math.PI / 2 でレンズ面をローカル +X（横断歩道対岸向き）に向ける。
    const pedHead = new THREE.Group();
    pedHead.name = "PedestrianSignalHead";
    pedHead.position.set(0.06, 3.25, 0.48);
    pedHead.rotation.y = Math.PI / 2;
    pedHead.userData.lodDetailTier = "medium";
    group.add(pedHead);

    // 歩行者灯器を支柱（group 座標 x = 0, z = 0）へ連結する上下2本の水平支持アーム（pedHead ローカル +X が group の -Z＝支柱方向）
    for (const [idx, armY] of [0.24, -0.24].entries()) {
      const pedArmGeo = new THREE.CylinderGeometry(0.028, 0.028, 0.48, 10);
      pedArmGeo.rotateZ(Math.PI / 2);
      const pedArm = new THREE.Mesh(pedArmGeo, this.poleMat);
      pedArm.name = idx === 0 ? "PedSignalArmUpper" : "PedSignalArmLower";
      pedArm.position.set(0.24, armY, -0.06);
      pedHead.add(pedArm);
    }

    const pedBoxGeo = new THREE.BoxGeometry(0.36, 0.76, 0.18);
    const pedBox = new THREE.Mesh(pedBoxGeo, this.bodyMat);
    pedBox.castShadow = true;
    pedHead.add(pedBox);

    // 歩行者灯器上部の「歩行者・自転車専用」標示プレート
    const pedHeaderPlate = this.createPedestrianHeaderPlateMesh();
    pedHeaderPlate.position.set(0, 0.45, 0.02);
    pedHead.add(pedHeaderPlate);

    // 角型2灯レンズ（上段：赤立像、下段：青緑歩行像。車両用信号と連動しつつ、どちらか1灯のみを高輝度点灯させる）
    const isPedRedActive = activeSignal === "red";
    const pedLensGeo = new THREE.PlaneGeometry(0.25, 0.25);

    const pedRedMat = this.createPedestrianLedLensMaterial("red-standing", isPedRedActive);
    const pedRedMesh = new THREE.Mesh(pedLensGeo, pedRedMat);
    pedRedMesh.name = "PedLamp_RedStanding";
    pedRedMesh.position.set(0, 0.17, 0.092);
    pedHead.add(pedRedMesh);

    const pedGreenMat = this.createPedestrianLedLensMaterial("green-walking", !isPedRedActive);
    const pedGreenMesh = new THREE.Mesh(pedLensGeo, pedGreenMat);
    pedGreenMesh.name = "PedLamp_GreenWalking";
    pedGreenMesh.position.set(0, -0.17, 0.092);
    pedHead.add(pedGreenMesh);

    // 角型レンズ上部＋左右側面を囲う日本仕様の3面遮光フード（角型バイザー）
    for (const visorCenterY of [0.17, -0.17]) {
      const pedTopVisorGeo = new THREE.BoxGeometry(0.28, 0.016, 0.13);
      const pedTopVisor = new THREE.Mesh(pedTopVisorGeo, this.visorMat);
      pedTopVisor.position.set(0, visorCenterY + 0.13, 0.145);
      pedHead.add(pedTopVisor);

      for (const sideX of [-0.132, 0.132]) {
        const pedSideVisorGeo = new THREE.BoxGeometry(0.014, 0.24, 0.11);
        const pedSideVisor = new THREE.Mesh(pedSideVisorGeo, this.visorMat);
        pedSideVisor.position.set(sideX, visorCenterY + 0.01, 0.135);
        pedHead.add(pedSideVisor);
      }
    }

    // 7. 支柱下部（y = 1.15m）の歩行者用押ボタン箱（横断歩道待ちの歩行者が押しやすい向きに配置）
    const pushButtonBox = this.createPedestrianPushButtonBox();
    pushButtonBox.position.set(0, 1.15, 0.17);
    pushButtonBox.userData.lodDetailTier = "high";
    group.add(pushButtonBox);

    // 8. 信号機アーム横の「交差点名標識（地点名プレート）」
    const intersectionPlate = this.signs.createIntersectionNamePlateMesh(
      intersectionNameJa,
      intersectionNameEn,
    );
    intersectionPlate.name = "IntersectionNamePlate";
    intersectionPlate.position.set(1.52, 5.76, 0.14);
    group.add(intersectionPlate);

    return group;
  }

  /**
   * 日本の道路標識（丸型速度標識 50km/h 等）
   * Why not 独自の 3 メッシュ実装を維持するか:
   * 旧実装は z=0 に 3.8m の支柱を配置していたため看板表面（z=+0.025, 上端 y=3.78m）から支柱が突き出し、
   * さらに数字部分に MeshBasicMaterial の白い四角 Plane (0.45m) を重ねていたため夜間・雨天に白い四角が浮き出ていた。
   * JapaneseRoadSigns 側の正規実装（支柱 z=-0.06・高さ 3.62m・単一 CanvasTexture + alphaTest: 0.5）へ統一委譲する。
   */
  public createSpeedLimitSign(x: number, z: number, limit = 50): THREE.Group {
    return this.signs.createSpeedLimitSign(x, z, limit);
  }
}

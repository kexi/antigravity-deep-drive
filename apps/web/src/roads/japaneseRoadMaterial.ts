import * as THREE from "three";
import { Procedural3DTextureGenerator } from "../textures/procedural3DTexture";
import type { PuddleEnvironmentSyncParams } from "../shaders/puddleShader";

/**
 * 日本の道路用カスタムPBRマテリアル
 * 【設計方針】
 * - 視覚的には「リアルな凸凹＋轍（わだち）水たまり鏡面反射」：
 *   - 3Dプロシージャルテクスチャ（Data3DTexture / sampler3D）による完全シームレスな立体サンプリング
 *   - R: アスファルト骨材のざらつき法線バンプ
 *   - G: 経年劣化のひび割れ（クラック）
 *   - B: 補修跡（パッチワーク舗装：四角いつぎはぎ）
 *   - A: 雨天・雨上がり時に凹部や車線の轍（Wheel Ruts）に水が溜まる水たまり深度（Puddle Depth）
 *   - 水たまり内部では大気空・太陽スペキュラ・丸の内ビル群シルエット＆窓明かり・街灯ネオンを解析的に平面鏡面反射
 * - 物理的には「完全に平ら」：
 *   - ジオメトリ表面を物理コライダーで平滑に保ち、タイヤの引っかかり・不要な跳ねを根絶
 */

export interface JapaneseRoadMaterialOptions {
  baseRoughness?: number;
  baseMetalness?: number;
  noise3DTexture?: THREE.Data3DTexture;
  isIntersection?: boolean;
}

export class JapaneseRoadMaterial extends THREE.MeshStandardMaterial {
  private static shared3DTexture: THREE.Data3DTexture | null = null;

  public uRainWetness: { value: number };
  public uTime: { value: number };
  public uRippleIntensity: { value: number };
  public uRoadNoise3D: { value: THREE.Data3DTexture };
  public uSunDirection: { value: THREE.Vector3 };
  public uSunColor: { value: THREE.Color };
  public uSkyHorizonColor: { value: THREE.Color };
  public uSkyZenithColor: { value: THREE.Color };
  public uNightFactor: { value: number };
  public uIsIntersection: { value: number };
  public readonly isIntersection: boolean;

  constructor(options: JapaneseRoadMaterialOptions = {}) {
    const isIntersection = Boolean(options.isIntersection);
    super({
      color: 0x4c525c,
      roughness: options.baseRoughness ?? 0.85,
      metalness: options.baseMetalness ?? 0.12,
      // Why 交差点パッドのみ polygonOffset をわずかに手前バイアスするか:
      // 道路セグメント端部との接続境界で深度バッファ誤差による Z-fighting を防ぎつつ、
      // 白線・横断歩道（polygonOffsetFactor: -2, y=+0.02..0.025）より確実に下に描画させるため。
      polygonOffset: isIntersection,
      polygonOffsetFactor: isIntersection ? -0.5 : 0,
      polygonOffsetUnits: isIntersection ? -0.5 : 0,
    });
    this.isIntersection = isIntersection;

    const hasSharedTex = Boolean(JapaneseRoadMaterial.shared3DTexture);
    if (!hasSharedTex) {
      JapaneseRoadMaterial.shared3DTexture =
        Procedural3DTextureGenerator.getSharedAsphalt3DTexture(64);
    }

    const tex3D = options.noise3DTexture ?? JapaneseRoadMaterial.shared3DTexture!;

    this.uRainWetness = { value: 0.0 };
    this.uTime = { value: 0.0 };
    this.uRippleIntensity = { value: 1.0 };
    this.uRoadNoise3D = { value: tex3D };
    this.uSunDirection = { value: new THREE.Vector3(0.68, 0.25, 0.68).normalize() };
    this.uSunColor = { value: new THREE.Color(0xfb923c) };
    this.uSkyHorizonColor = { value: new THREE.Color(0xfdba74) };
    this.uSkyZenithColor = { value: new THREE.Color(0x4c1d95) };
    this.uNightFactor = { value: 0.0 };
    this.uIsIntersection = { value: isIntersection ? 1.0 : 0.0 };
    this.customProgramCacheKey = () =>
      isIntersection ? "japanese-road-mat-3d-intersection-v4" : "japanese-road-mat-3d-segment-v4";

    this.onBeforeCompile = (shader) => {
      shader.uniforms.uRainWetness = this.uRainWetness;
      shader.uniforms.uTime = this.uTime;
      shader.uniforms.uRippleIntensity = this.uRippleIntensity;
      shader.uniforms.uRoadNoise3D = this.uRoadNoise3D;
      shader.uniforms.uSunDirection = this.uSunDirection;
      shader.uniforms.uSunColor = this.uSunColor;
      shader.uniforms.uSkyHorizonColor = this.uSkyHorizonColor;
      shader.uniforms.uSkyZenithColor = this.uSkyZenithColor;
      shader.uniforms.uNightFactor = this.uNightFactor;
      shader.uniforms.uIsIntersection = this.uIsIntersection;

      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        varying vec3 vWorldPos;
        varying vec3 vLocalRoadPos;
        varying vec2 vRoadUv;
        `,
      );

      shader.vertexShader = shader.vertexShader.replace(
        "#include <worldpos_vertex>",
        /* glsl */ `
        #include <worldpos_vertex>
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vLocalRoadPos = transformed;
        vRoadUv = uv;
        `,
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        precision highp sampler3D;
        uniform float uRainWetness;
        uniform float uTime;
        uniform float uRippleIntensity;
        uniform sampler3D uRoadNoise3D;
        uniform vec3 uSunDirection;
        uniform vec3 uSunColor;
        uniform vec3 uSkyHorizonColor;
        uniform vec3 uSkyZenithColor;
        uniform float uNightFactor;
        uniform float uIsIntersection;
        varying vec3 vWorldPos;
        varying vec3 vLocalRoadPos;
        varying vec2 vRoadUv;

        // 水たまり用雨滴着水リップル計算・低周波盆地FBM
        vec2 roadHash2D(vec2 p) {
          p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
          return fract(sin(p) * 43758.5453123);
        }

        float roadPerlin2D(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          float n00 = dot(roadHash2D(i + vec2(0.0, 0.0)) - 0.5, f - vec2(0.0, 0.0));
          float n10 = dot(roadHash2D(i + vec2(1.0, 0.0)) - 0.5, f - vec2(1.0, 0.0));
          float n01 = dot(roadHash2D(i + vec2(0.0, 1.0)) - 0.5, f - vec2(0.0, 1.0));
          float n11 = dot(roadHash2D(i + vec2(1.0, 1.0)) - 0.5, f - vec2(1.0, 1.0));
          return 0.5 + 0.5 * mix(mix(n00, n10, u.x), mix(n01, n11, u.x), u.y);
        }

        float roadPuddleFbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
          for (int i = 0; i < 4; i++) {
            v += a * roadPerlin2D(p);
            p = rot * p * 2.03 + vec2(3.1, 7.4);
            a *= 0.5;
          }
          return v;
        }

        // 車道水たまりの盆地深度（低周波FBM + 車線の轍 Wheel Ruts + 路肩側溝 + 3D微細凹部）
        // Why not: ワールドX座標（worldPos.x）で横断轍を判定すると東西道路（日比谷通り・丸の内仲通り）で道路を横切る縞になるため、
        // 道路ローカル横断座標（localRoadPos.x）で車線の轍・路肩・クラウン排水勾配を評価する。
        // 交差点（uIsIntersection > 0.5）では直交する2方向（X・Z）の轍を滑らかにブレンドし、外隅の水はけを確保する。
        float sampleRoadPuddleBasin(vec3 worldPos, vec3 localRoadPos, float voxelAlpha, float crackVal) {
          float rawMacro = roadPuddleFbm(vec2(worldPos.x * 0.12 + 2.3, worldPos.z * 0.048));
          float rawSub = roadPuddleFbm(vec2(worldPos.x * 0.28 - 5.1, worldPos.z * 0.11 + 1.7));
          vec2 crossRot = vec2(
            worldPos.x * 0.068 - worldPos.z * 0.042,
            worldPos.x * 0.042 + worldPos.z * 0.068
          );
          float rawCross = roadPuddleFbm(crossRot + vec2(9.4, -4.2));

          // Why not: 4オクターブ Perlin FBM の生の値（標準偏差が狭く 0.40..0.60 に集中）をそのまま使うと、
          // 閾値 0.50 前後で路面全体の 5% 未満しか水たまりにならないため、smoothstep S字コントラスト伸長で 0..1 へ広げる
          float macroBasin = smoothstep(0.32, 0.68, rawMacro);
          float subBasin = smoothstep(0.34, 0.66, rawSub);
          float crossBasin = smoothstep(0.35, 0.65, rawCross);

          float absX = abs(localRoadPos.x);
          float absZ = abs(localRoadPos.z);

          // 片側2〜3車線の各車線ホイールトラック（左右タイヤ通過ライン & 車線内窪み）および路肩側溝の集水プロファイル
          float lane1RutX =
            exp(-pow((absX - 1.25) * 1.15, 2.0)) * 0.88 +
            exp(-pow((absX - 2.35) * 1.10, 2.0)) * 0.92;
          float lane2RutX =
            exp(-pow((absX - 4.45) * 1.05, 2.0)) * 0.90 +
            exp(-pow((absX - 5.65) * 1.05, 2.0)) * 0.95;
          float lane3RutX = exp(-pow((absX - 8.20) * 0.85, 2.0)) * 0.82;
          float gutterPoolX = smoothstep(5.4, 7.6, absX) * 0.88;
          float rutProfileX = clamp(max(max(lane1RutX, lane2RutX), max(lane3RutX, gutterPoolX)), 0.0, 1.0);

          float lane1RutZ =
            exp(-pow((absZ - 1.25) * 1.15, 2.0)) * 0.88 +
            exp(-pow((absZ - 2.35) * 1.10, 2.0)) * 0.92;
          float lane2RutZ =
            exp(-pow((absZ - 4.45) * 1.05, 2.0)) * 0.90 +
            exp(-pow((absZ - 5.65) * 1.05, 2.0)) * 0.95;
          float rutProfileZ = clamp(max(lane1RutZ, lane2RutZ), 0.0, 1.0);

          float intersectionBasin = exp(-pow((length(localRoadPos.xz) - 4.2) * 0.22, 2.0)) * 0.55;
          float rutProfile = mix(
            rutProfileX,
            clamp(max(rutProfileX * 0.85, rutProfileZ * 0.85) + intersectionBasin * 0.45, 0.0, 1.0),
            uIsIntersection
          );

          // 轍の縦断方向に長楕円のリアルな水たまり群を形成しつつ、車線中央や交差点にも有機的な水たまりパッチを残す
          float rutPocket = rutProfile * (0.42 + 0.58 * mix(macroBasin, crossBasin, 0.35));
          float openPatch = macroBasin * crossBasin * 0.65;

          // 道路中央線（x ≈ 0）直上のみごく緩やかに排水勾配をつけつつ、車線全体の盆地深さを高く保つ
          float crownDrainSeg = 0.82 + 0.18 * smoothstep(0.0, 0.85, absX);
          float crownDrainInter = 0.86 + 0.14 * smoothstep(0.0, 1.8, length(localRoadPos.xz));
          float crownDrain = mix(crownDrainSeg, crownDrainInter, uIsIntersection);

          float combinedBasin =
            macroBasin * 0.44 +
            subBasin * 0.20 +
            openPatch * 0.18 +
            rutPocket * 0.44 +
            (voxelAlpha - 0.5) * 0.12 +
            crackVal * 0.08;
          return clamp(combinedBasin * crownDrain, 0.0, 1.0);
        }

        vec3 calculatePuddleRipples(vec2 uv, float time, float intensity) {
          vec2 p = uv * 2.75;
          vec3 rippleN = vec3(0.0, 0.0, 1.0);
          // 雨上がり（intensity == 0）ではごく穏やかな微風ゆらぎのみに抑え、降雨時（intensity > 0）のみ水面さざ波を強める
          float breezeScale = 0.25 + 0.75 * clamp(intensity, 0.0, 1.0);
          float cap1X = sin(uv.x * 3.8 + uv.y * 2.7 + time * 2.1) * 0.016 * breezeScale;
          float cap1Y = cos(uv.x * 2.9 - uv.y * 4.2 - time * 1.7) * 0.016 * breezeScale;
          float cap2X = sin(uv.x * 8.4 - uv.y * 6.1 + time * 3.2) * 0.008 * breezeScale;
          float cap2Y = cos(uv.x * 6.7 + uv.y * 7.9 - time * 2.6) * 0.008 * breezeScale;
          rippleN.x += cap1X + cap2X;
          rippleN.y += cap1Y + cap2Y;

          if (intensity <= 0.01) {
            return normalize(rippleN);
          }

          for (int i = 0; i < 3; i++) {
            float scale = 1.0 + float(i) * 0.34;
            float t = time * 1.42 + float(i) * 1.57;
            vec2 gridPos = p * scale + float(i) * vec2(17.1, 31.4);
            vec2 cellId = floor(gridPos);
            vec2 cellFrac = fract(gridPos);

            vec2 dropCenter = 0.20 + 0.60 * roadHash2D(cellId);
            vec2 diff = cellFrac - dropCenter;
            float dist = length(diff);

            float dropAge = fract(t * 1.18 + dot(cellId, vec2(0.4, 0.6)));
            float waveRadius = dropAge * 0.78;
            float waveDist = dist - waveRadius;

            float wave = sin(waveDist * 48.0) * exp(-abs(waveDist) * 14.5) * exp(-dist * 3.2) * (1.0 - dropAge);
            vec2 grad = normalize(diff + 0.0001) * wave * 0.48;
            rippleN.xy += grad * intensity;
          }
          return normalize(rippleN);
        }

        // 車道水たまりの解析的平面鏡面反射（空・雲・太陽/月・丸の内/渋谷ビル群シルエット＆窓明かり・信号機・街灯ネオン）
        vec3 calculateRoadPuddleReflection(vec3 worldPos, vec3 localRoadPos, vec3 worldNormal, float puddleStrength) {
          vec3 V = normalize(cameraPosition - worldPos);
          vec3 N = normalize(worldNormal);
          vec3 R = reflect(-V, N);
          R.y = max(R.y, 0.015);

          // 水のフレネル反射率 (IOR = 1.333, F0 = 0.02 + 浅いドライバー視線角度での水面鏡面強調)
          float NoV = max(dot(N, V), 0.0);
          float fresnel = 0.14 + 0.86 * pow(1.0 - NoV, 3.2);

          // 1. 大気空グラデーション・巻雲/積雲の映り込み・太陽/月の方位グロー
          float skyElev = pow(clamp(R.y, 0.0, 1.0), 0.50);
          vec3 skyGrad = mix(uSkyHorizonColor, uSkyZenithColor, skyElev);
          vec3 sunDir = normalize(uSunDirection + vec3(0.0, 0.0001, 0.0));
          vec3 flatR = vec3(R.x, R.y * 0.32 + 0.001, R.z);
          vec3 flatSun = vec3(sunDir.x, sunDir.y * 0.32 + 0.001, sunDir.z);
          float sunHorizonGlow = pow(max(dot(flatR / max(length(flatR), 0.001), flatSun / max(length(flatSun), 0.001)), 0.0), 3.0);
          skyGrad += uSunColor * sunHorizonGlow * (0.58 * (1.0 - uNightFactor * 0.45));

          // 水面に映り込む立体雲レイヤー（反射ベクトル R の天球投影 UV で FBM 雲をサンプリング）
          vec2 skyCloudUv = R.xz / (R.y + 0.38) * 0.36 + vec2(uTime * 0.006, -uTime * 0.004);
          float cloudReflNoise = roadPuddleFbm(skyCloudUv);
          float cloudReflMask = smoothstep(0.44, 0.72, cloudReflNoise) * smoothstep(0.03, 0.35, R.y);
          vec3 cloudHighlightColor = mix(
            mix(vec3(0.96, 0.98, 1.0), uSunColor * 1.15, 0.45),
            vec3(0.24, 0.32, 0.48),
            uNightFactor
          );
          skyGrad = mix(skyGrad, cloudHighlightColor, cloudReflMask * 0.55);

          // 2. 丸の内・渋谷ビル群のシルエット＆滑らかなカーテンウォール窓明かり反射
          float lateralAngle = abs(R.x) / (abs(R.z) + 0.42);
          float buildingMask = smoothstep(0.42, 0.10, R.y) * smoothstep(0.22, 0.60, lateralAngle);
          vec3 buildingBase = mix(vec3(0.06, 0.09, 0.15), vec3(0.015, 0.03, 0.06), uNightFactor);

          float floorBands = smoothstep(0.32, 0.78, sin(R.y * 30.0) * 0.5 + 0.5);
          float bayPillars = smoothstep(0.28, 0.75, sin(atan(R.x, R.z) * 20.0) * 0.5 + 0.5);
          float winMask = floorBands * bayPillars * smoothstep(0.02, 0.30, R.y);
          vec3 winGlow = mix(vec3(1.0, 0.80, 0.46), vec3(0.42, 0.82, 1.0), clamp(R.z * 0.5 + 0.5, 0.0, 1.0));
          float winIntensity = mix(0.26, 0.82, max(uNightFactor, uRainWetness * 0.60));
          vec3 buildingRefl = buildingBase + winGlow * winMask * winIntensity;

          vec3 envColor = mix(skyGrad, buildingRefl, buildingMask * 0.64);

          // 3. 街灯（アンバー）＆信号機（エメラルド/アンバー/ルビー）の路面水たまり反射ストリーク
          float lampLateral = exp(-abs(abs(localRoadPos.x) - 5.2) * 0.14);
          float lampReflectDir = smoothstep(0.10, 0.72, max(abs(R.x), abs(R.z) * 0.65));
          float rippleShift = (N.x + N.z) * 4.2;
          float lampStreak = lampLateral * lampReflectDir * clamp(1.0 + rippleShift, 0.45, 1.85);
          vec3 streetLightRefl = vec3(1.0, 0.74, 0.34) * lampStreak * mix(0.34, 0.98, max(uNightFactor, uRainWetness * 0.65));

          // 交差点・横断歩道付近の信号機・テールランプ・ネオン反射彩度
          float signalPhase = sin(worldPos.z * 0.045 + worldPos.x * 0.035);
          vec3 neonTint = mix(vec3(0.12, 0.92, 0.68), vec3(1.0, 0.26, 0.32), smoothstep(-0.4, 0.4, signalPhase));
          float neonMask = exp(-abs(abs(localRoadPos.x) - 3.6) * 0.16) * smoothstep(0.02, 0.25, R.y);
          vec3 neonRefl = neonTint * neonMask * clamp(0.8 + rippleShift * 0.6, 0.3, 1.6) * mix(0.14, 0.46, max(uNightFactor, uRainWetness * 0.5));

          // 4. 太陽・月光のデュアルローブ水面スペキュラ道（Glitter Path）
          float sunSpecTight = pow(max(dot(R, sunDir), 0.0), 72.0);
          float sunSpecWide = pow(max(dot(R, sunDir), 0.0), 12.0);
          vec3 sunSpecular = uSunColor * (sunSpecTight * 2.2 + sunSpecWide * 0.58) * (1.0 - uNightFactor * 0.35);

          // 5. 波紋リングの煌めき（雨滴波紋と微風さざ波の傾斜ハイライト）
          float rippleSlope = length(N.xz);
          vec3 rippleSparkle = mix(uSkyHorizonColor, vec3(0.92, 0.97, 1.0), 0.55) * smoothstep(0.015, 0.18, rippleSlope) * (0.32 + 0.45 * clamp(uRippleIntensity, 0.0, 1.0));

          vec3 baseWater = vec3(0.02, 0.045, 0.075);
          vec3 totalRefl = (envColor + streetLightRefl + neonRefl + sunSpecular + rippleSparkle) * mix(0.62, 1.08, fresnel);
          return mix(baseWater, totalRefl, clamp(fresnel + 0.42, 0.0, 1.0)) * (0.78 + 0.22 * puddleStrength);
        }
        `,
      );

      // 3Dボリュームテクスチャからの直接法線バンプサンプリング＆水たまり鏡面法線平坦化
      // How: Three.js の meshphysical_frag では #include <metalnessmap_fragment> が #include <normal_fragment_maps> より先に実行されるため、
      // <metalnessmap_fragment> で計算済みの coordMicro..coordMacro / voxelMicro..voxelMacro / puddleCoreMask / puddleRippleVec を再利用し、
      // 近傍路面は6近傍の3Dマイクロ法線バンプを評価し、水たまり内部は遠方（175m）まで水面法線の平坦化＋波紋摂動を適用する
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <normal_fragment_maps>",
        /* glsl */ `
        #include <normal_fragment_maps>

        vec3 calcNormal = normal;
        if (roadCamDist < 18.0) {
          // Rチャンネル（転圧砕石プラトーハイト）＆ Gチャンネル（骨材間歴青モルタル目地）から3Dマイクロ法線バンプを算出
          // Why not: 水平路面（ワールド法線 +Y = (0, 1, 0)）に対して vec3(dX, dZ, 1.0) を作ると
          // ワールド +Z 向き（地面と平行）の誤った法線になり陰影が破綻するため、
          // 正しくワールド +Y を主軸とする vec3(dX, 1.0, dZ) で構成し、Z方向微分は stepOffset.yyx で取得する
          vec3 stepMicro = vec3(0.024, 0.0, 0.0);
          vec3 stepFine = vec3(0.028, 0.0, 0.0);
          vec3 stepCoarse = vec3(0.032, 0.0, 0.0);
          float voidCenter = voxelMicro.g * 0.46 + voxelFine.g * 0.36 + voxelCoarse.g * 0.18;
          float hCenter = voxelMicro.r * 0.44 + voxelFine.r * 0.34 + voxelCoarse.r * 0.16 + voxelMacro.r * 0.06 - voidCenter * 0.28;

          vec4 microRight = texture(uRoadNoise3D, coordMicro + stepMicro.xyy);
          vec4 fineRight  = texture(uRoadNoise3D, coordFine + stepFine.xyy);
          vec4 coarseRight = texture(uRoadNoise3D, coordCoarse + stepCoarse.xyy);
          float hRight = microRight.r * 0.44 + fineRight.r * 0.34 + coarseRight.r * 0.16 + voxelMacro.r * 0.06 - (microRight.g * 0.46 + fineRight.g * 0.36 + coarseRight.g * 0.18) * 0.28;

          vec4 microForward = texture(uRoadNoise3D, coordMicro + stepMicro.yyx);
          vec4 fineForward  = texture(uRoadNoise3D, coordFine + stepFine.yyx);
          vec4 coarseForward = texture(uRoadNoise3D, coordCoarse + stepCoarse.yyx);
          float hForward = microForward.r * 0.44 + fineForward.r * 0.34 + coarseForward.r * 0.16 + voxelMacro.r * 0.06 - (microForward.g * 0.46 + fineForward.g * 0.36 + coarseForward.g * 0.18) * 0.28;

          float dX = (hCenter - hRight) * 1.05;
          float dZ = (hCenter - hForward) * 1.05;

          // Gチャンネル: 微細クラックおよび骨材間空隙による法線変調
          float crackVal = voxelFine.g * voxelMacro.a;
          float bumpDistFade = 1.0 - smoothstep(10.0, 18.0, roadCamDist);
          vec3 worldBumpNormal = normalize(vec3(dX + crackVal * 0.08, 1.0, dZ + crackVal * 0.08));
          calcNormal = normalize(mix(normal, normalize(mat3(viewMatrix) * worldBumpNormal), bumpDistFade));
        }

        // Why not: 水たまり法線平坦化を roadCamDist < 12.0 の内部に閉じ込めると、チェイスカメラ（自車後方6.5m）から見て
        // 自車前方5.5m以遠のすべての水たまりで水面法線＋リップルが失われるため、175mまで独立して水面法線を適用する
        if (puddleCoreMask > 0.01 && roadCamDist < 175.0) {
          vec3 perturbedN = normalize(vec3(puddleRippleVec.x, puddleRippleVec.z, puddleRippleVec.y));
          calcNormal = normalize(mix(calcNormal, normalize(mat3(viewMatrix) * perturbedN), puddleCoreMask * 0.96));
        }

        normal = calcNormal;
        `,
      );

      // カラー・ラフネス・メタルネス・水たまり鏡面反射の3Dテクスチャ変調（距離 LOD 付き）
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <metalnessmap_fragment>",
        /* glsl */ `
        #include <metalnessmap_fragment>

        float roadCamDist = length(cameraPosition - vWorldPos);
        vec3 coordMicro = vec3(
          vWorldPos.x * 2.55 + vWorldPos.z * 0.74,
          vWorldPos.y * 2.65 + 0.19,
          -vWorldPos.x * 0.74 + vWorldPos.z * 2.55
        );
        vec3 coordFine = vec3(
          vWorldPos.x * 0.84 - vWorldPos.z * 0.21,
          vWorldPos.y * 0.88 + 0.31,
          vWorldPos.x * 0.21 + vWorldPos.z * 0.84
        );
        vec3 coordCoarse = vec3(
          vWorldPos.x * 0.26 + vWorldPos.z * 0.11,
          vWorldPos.y * 0.28 + 0.51,
          -vWorldPos.x * 0.11 + vWorldPos.z * 0.26
        );
        vec3 coordMacro = vec3(
          vWorldPos.x * 0.075 - vWorldPos.z * 0.048,
          vWorldPos.y * 0.085 + 0.37,
          vWorldPos.x * 0.048 + vWorldPos.z * 0.075
        );
        vec3 sampleMicro = coordMicro;
        vec3 sampleFine = coordFine;
        vec3 sampleCoarse = coordCoarse;
        vec3 sampleMacro = coordMacro;
        vec4 voxelMicro = vec4(0.5);
        vec4 voxelFine = vec4(0.5);
        vec4 voxelCoarse = vec4(0.5);
        vec4 voxelMacro = vec4(0.5);
        if (roadCamDist < 32.0) {
          voxelFine = texture(uRoadNoise3D, sampleFine);
          voxelMacro = texture(uRoadNoise3D, sampleMacro);
          if (roadCamDist < 18.0) {
            voxelMicro = texture(uRoadNoise3D, sampleMicro);
            voxelCoarse = texture(uRoadNoise3D, sampleCoarse);
          } else {
            voxelMicro = voxelFine;
            voxelCoarse = voxelMacro;
          }
        }

        // Rチャンネル: 転圧砕石プラトーの立体粒子感と石英・長石チップの微細明暗スペックル
        float aggregateGrain = voxelMicro.r * 0.46 + voxelFine.r * 0.34 + voxelCoarse.r * 0.14 + voxelMacro.r * 0.06;
        float aggregateContrast = smoothstep(0.24, 0.72, aggregateGrain);
        float silicaChip = smoothstep(0.50, 0.80, voxelMicro.r) * smoothstep(0.42, 0.74, voxelFine.r);
        float mineralGrain = smoothstep(0.38, 0.76, voxelMicro.b * 0.62 + voxelFine.b * 0.38);
        float coarseStonePatch = smoothstep(0.28, 0.68, voxelCoarse.r * 0.65 + voxelFine.r * 0.35);
        float poreCrevice = smoothstep(0.38, 0.78, voxelMicro.g * 0.54 + voxelFine.g * 0.30 + voxelCoarse.g * 0.16);

        // Bチャンネル: 転圧ローラー方向のアスファルトバインダー（歴青）色調ムラ
        float binderTone = mix(voxelCoarse.b, voxelMacro.b, 0.55);

        // 車線のタイヤ通過ライン（Wheel Track: 道路ローカル横断 |x| ≈ 1.35m, 2.85m, 4.65m, 6.15m）の摩耗・骨材露出
        // 交差点（uIsIntersection > 0.5）では直交する2方向（X・Z）の通過ラインと旋回摩耗ゾーンを滑らかに合成する
        float absRoadX = abs(vLocalRoadPos.x);
        float absRoadZ = abs(vLocalRoadPos.z);
        float tireTrackWearX =
          exp(-pow((absRoadX - 1.35) * 1.15, 2.0)) +
          exp(-pow((absRoadX - 2.85) * 1.15, 2.0)) +
          exp(-pow((absRoadX - 4.65) * 1.15, 2.0)) +
          exp(-pow((absRoadX - 6.15) * 1.15, 2.0));
        float tireTrackWearZ =
          exp(-pow((absRoadZ - 1.35) * 1.15, 2.0)) +
          exp(-pow((absRoadZ - 2.85) * 1.15, 2.0)) +
          exp(-pow((absRoadZ - 4.65) * 1.15, 2.0)) +
          exp(-pow((absRoadZ - 6.15) * 1.15, 2.0));
        float intersectionTurnWear = exp(-pow((length(vLocalRoadPos.xz) - 3.8) * 0.28, 2.0)) * 0.45;
        float combinedTireWear = mix(
          tireTrackWearX,
          clamp(max(tireTrackWearX * 0.72, tireTrackWearZ * 0.72) + intersectionTurnWear, 0.0, 1.0),
          uIsIntersection
        );
        float tireTrackWear = clamp(combinedTireWear, 0.0, 1.0) * (0.68 + 0.32 * voxelMacro.b);

        // 砕石骨材（安山岩・硬質砂岩グレー）と歴青バインダー暗部・石英ハイライト・タイヤ摩耗帯を合成
        vec3 bitumenDark = vec3(0.032, 0.036, 0.044);
        vec3 crushedStoneGrey = vec3(0.205, 0.218, 0.242);
        vec3 weatheredAndesite = vec3(0.248, 0.262, 0.286);
        vec3 stoneColor = mix(crushedStoneGrey, weatheredAndesite, mineralGrain * 0.62);
        vec3 baseAsphaltAlbedo = mix(bitumenDark, stoneColor, aggregateContrast * 0.76 + coarseStonePatch * 0.24);
        baseAsphaltAlbedo += vec3(0.175, 0.186, 0.205) * silicaChip;
        baseAsphaltAlbedo *= mix(1.0, 0.42, poreCrevice * 0.76);
        baseAsphaltAlbedo = mix(baseAsphaltAlbedo, vec3(0.255, 0.268, 0.295), tireTrackWear * 0.44);
        baseAsphaltAlbedo *= mix(0.84, 1.16, binderTone);

        // Gチャンネル: 微細クラック（経年変化）とアスファルトフィニッシャー車線境界の縦断施工目地（|x| = 0m, 3.5m, 7.0m）
        // Why 交差点内で laneJoint を抑制するか:
        // 交差点内で一方向だけの施工目地スジを描画すると直交道路に対して3.5m間隔の不自然な横断黒線になるため、
        // 交差点パッド外縁部のみ接続道路と馴染ませ、交差点中央では施工目地スジをフェードアウトさせる。
        float crackDarkness = voxelFine.g * smoothstep(0.32, 0.74, voxelMacro.a);
        float jointDistX = abs(fract(absRoadX / 3.5 + 0.5) - 0.5) * 3.5;
        float laneJointSeg = exp(-pow(jointDistX * 14.0, 2.0)) * 0.28;
        float edgeJointFade = smoothstep(5.5, 11.0, max(absRoadX, absRoadZ));
        float laneJoint = mix(laneJointSeg, laneJointSeg * edgeJointFade * 0.35, uIsIntersection);
        diffuseColor.rgb = mix(baseAsphaltAlbedo, vec3(0.022, 0.025, 0.032), clamp(crackDarkness * 0.46 + laneJoint, 0.0, 0.65));

        // 砕石頂部はローラー転圧＆タイヤ研磨でやや滑らか、骨材間の空隙ボイドは粗いマイクロラフネス分布
        roughnessFactor = clamp(
          roughnessFactor + (0.52 - aggregateGrain) * 0.28 + poreCrevice * 0.16 - silicaChip * 0.20 - tireTrackWear * 0.12,
          0.10,
          0.95
        );
        metalnessFactor = clamp(metalnessFactor + silicaChip * 0.16 + mineralGrain * 0.06, 0.05, 0.85);

        // 3D骨材マイクロファセットによる大気空・太陽光の微細スペキュラ反射
        vec3 viewDeltaW = cameraPosition - vWorldPos;
        vec3 viewDirW = viewDeltaW / max(length(viewDeltaW), 0.001);
        vec3 microGradN = normalize(vec3(
          (voxelMicro.r - voxelFine.r) * 0.56 + (voxelCoarse.r - 0.5) * 0.30,
          1.0,
          (voxelFine.r - voxelCoarse.r) * 0.56 + (voxelMicro.g - 0.5) * 0.30
        ));
        vec3 microReflDir = reflect(-viewDirW, microGradN);
        float microFresnel = 0.18 + 0.82 * pow(1.0 - max(dot(microGradN, viewDirW), 0.0), 2.6);
        vec3 skySheenColor = mix(uSkyHorizonColor, uSkyZenithColor, clamp(microReflDir.y * 0.7 + 0.25, 0.0, 1.0));
        vec3 safeSunDir = normalize(uSunDirection + vec3(0.0, 0.0001, 0.0));
        float microSunGlint = pow(max(dot(microReflDir, safeSunDir), 0.0), 14.0) * (1.0 - uNightFactor * 0.7);
        float grainSparkleMask = (0.36 + 0.64 * aggregateContrast + silicaChip * 1.05) * (1.0 - poreCrevice * 0.62);
        vec3 dryAggregateSheen = clamp((skySheenColor * 0.18 + uSunColor * microSunGlint * 0.22) * microFresnel * grainSparkleMask, vec3(0.0), vec3(0.45));

        // Aチャンネル + 轍（Wheel Ruts）: 3D水たまり深度（凹部に水が溜まり、周囲に濡れ縁、内部は鏡面反射に変化）
        float puddleCoreMask = 0.0;
        vec3 puddleRippleVec = vec3(0.0, 0.0, 1.0);
        if (uRainWetness > 0.01 && roadCamDist < 185.0) {
          float distanceFade = 1.0 - smoothstep(130.0, 185.0, roadCamDist);
          float basinDepth = sampleRoadPuddleBasin(vWorldPos, vLocalRoadPos, voxelMacro.a, crackDarkness);
          float threshold = 0.43 - uRainWetness * 0.15;

          // 水たまり外周の浸透湿潤帯（濡れ縁 Wet Meniscus Rim）と表面張力メニスカスリング
          float wetRim = smoothstep(threshold - 0.18, threshold, basinDepth) * distanceFade;
          // 水たまりコア領域（浅瀬〜深水部）
          float puddle = smoothstep(threshold, threshold + 0.055, basinDepth) * smoothstep(0.0, 0.25, uRainWetness) * distanceFade;
          float meniscusRing = wetRim * (1.0 - puddle);
          puddleCoreMask = puddle;

          // 濡れたアスファルトのしっとりとした色調変化（水たまり内部は下地アスファルトを強く減衰させ鏡面反射を際立たせる）
          diffuseColor.rgb *= mix(1.0, 0.46, wetRim * clamp(uRainWetness * 1.15, 0.0, 1.0));
          diffuseColor.rgb *= (1.0 - meniscusRing * 0.28);
          diffuseColor.rgb *= mix(1.0, 0.18, puddle);

          roughnessFactor = mix(roughnessFactor, 0.015, puddle); // 水たまり完全鏡面化
          roughnessFactor = mix(roughnessFactor, 0.26, uRainWetness * (1.0 - puddle) * distanceFade);
          metalnessFactor = mix(metalnessFactor, 0.86, puddle * 0.94);

          // 湿潤アスファルト被膜（非水たまり部）の3D骨材マイクロファセット光沢
          float dampFilmFactor = uRainWetness * (1.0 - puddle);
          totalEmissiveRadiance += clamp(dryAggregateSheen * (1.0 + dampFilmFactor * 1.25) * (1.0 - puddle * 0.90), vec3(0.0), vec3(0.55));

          // 水たまり表面の解析的平面鏡面反射を加算（降雨時のみ同心円着水波紋を評価し、雨上がり晴天時は穏やかな鏡面にする）
          if (puddle > 0.01) {
            float rippleLod = 1.0 - smoothstep(55.0, 115.0, roadCamDist);
            puddleRippleVec = calculatePuddleRipples(vWorldPos.xz, uTime, (uRainWetness * uRippleIntensity) * rippleLod);
            vec3 puddleWorldN = normalize(vec3(puddleRippleVec.x * 0.72, puddleRippleVec.z, puddleRippleVec.y * 0.72));
            vec3 roadPuddleRefl = clamp(calculateRoadPuddleReflection(vWorldPos, vLocalRoadPos, puddleWorldN, puddle), vec3(0.0), vec3(1.55));
            totalEmissiveRadiance += roadPuddleRefl * puddle;
          }
        } else {
          totalEmissiveRadiance += dryAggregateSheen;
        }
        `,
      );
    };
  }

  /**
   * 天候・太陽・空色・波紋強度を車道マテリアルへ一括同期する。
   * How: WeatherSystem から取得した環境光をユニフォームへ反映し、車道水たまりの鏡面反射色を更新する。
   */
  public syncEnvironment(params: PuddleEnvironmentSyncParams): void {
    this.uRainWetness.value = params.wetness;
    this.uTime.value = params.time;

    const hasRippleIntensity = params.rippleIntensity !== undefined;
    if (hasRippleIntensity) {
      this.uRippleIntensity.value = params.rippleIntensity!;
    }

    const hasSunDirection = params.sunDirection !== undefined;
    if (hasSunDirection) {
      this.uSunDirection.value.copy(params.sunDirection!).normalize();
    }

    const hasSunColor = params.sunColor !== undefined;
    if (hasSunColor) {
      const isColorObj = params.sunColor instanceof THREE.Color;
      if (isColorObj) {
        this.uSunColor.value.copy(params.sunColor as THREE.Color);
      } else {
        this.uSunColor.value.setHex(params.sunColor as number);
      }
    }

    const hasHorizon = params.skyHorizonColor !== undefined;
    if (hasHorizon) {
      const isColorObj = params.skyHorizonColor instanceof THREE.Color;
      if (isColorObj) {
        this.uSkyHorizonColor.value.copy(params.skyHorizonColor as THREE.Color);
      } else {
        this.uSkyHorizonColor.value.setHex(params.skyHorizonColor as number);
      }
    }

    const hasZenith = params.skyZenithColor !== undefined;
    if (hasZenith) {
      const isColorObj = params.skyZenithColor instanceof THREE.Color;
      if (isColorObj) {
        this.uSkyZenithColor.value.copy(params.skyZenithColor as THREE.Color);
      } else {
        this.uSkyZenithColor.value.setHex(params.skyZenithColor as number);
      }
    }

    const hasNightFactor = params.nightFactor !== undefined;
    if (hasNightFactor) {
      this.uNightFactor.value = params.nightFactor!;
    }
  }
}

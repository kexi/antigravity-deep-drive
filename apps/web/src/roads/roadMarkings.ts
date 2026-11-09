import * as THREE from "three";
import { Procedural3DTextureGenerator } from "../textures/procedural3DTexture";

export type RoadMarking3DTextureVariant = "white-paint" | "yellow-paint" | "braille";

export type RoadLaneArrowType = "straight" | "straight-left" | "right";

export interface RoadLaneSpec {
  laneIndex: number;
  direction: "inbound" | "oncoming";
  centerX: number;
  width: number;
  innerBoundaryX: number;
  outerBoundaryX: number;
  arrowType: RoadLaneArrowType;
  rotationY: number;
}

export interface RoadLaneLayout {
  lanesPerDirection: number;
  laneWidth: number;
  carriagewayWidth: number;
  halfCarriagewayWidth: number;
  centerLineWidth: number;
  laneDividerOffsets: number[];
  shoulderLineOffsets: [number, number];
  lanes: RoadLaneSpec[];
  crosswalkExcludeZRanges: Array<[number, number]>;
  centerLineExcludeZRanges: Array<[number, number]>;
  inboundNoLaneChangeZRanges: Array<[number, number]>;
  oncomingNoLaneChangeZRanges: Array<[number, number]>;
}

/**
 * 道路セグメントの車線構造（各車線の中心X座標・境界線X座標・進行方向矢印種別）および
 * 横断歩道・停止線・導流帯との非重複除外Z区間（excludeZRanges）を構造的に算出する。
 * Why 車線レイアウトと横断歩道除外区間を一元計算するか:
 * 車線境界線（白破線）・中央線（黄実線/白破線）・路肩外側線・進行方向矢印・予告ダイヤ（◇）・速度標示が
 * 横断歩道や停止線と重なるのを構造的にゼロにし、3D 道路網・2D 道路プレビュー・車載ナビで一貫した車線構造を共有するため。
 */
export function computeRoadLaneLayout(config: {
  lanesPerDirection: number;
  laneWidth: number;
  length: number;
  crosswalkZPositions?: ReadonlyArray<number>;
  zebraZoneZRanges?: ReadonlyArray<readonly [number, number]>;
  segmentEndExclusionBuffer?: number;
  crosswalkExclusionHalfSpan?: number;
}): RoadLaneLayout {
  const lanesPerDirection = Math.max(1, Math.floor(config.lanesPerDirection));
  const laneWidth = Math.max(2.5, config.laneWidth);
  const carriagewayWidth = lanesPerDirection * 2 * laneWidth;
  const halfCarriagewayWidth = carriagewayWidth * 0.5;
  const centerLineWidth = 0.2;

  const laneDividerOffsets: number[] = [];
  for (let i = 1; i < lanesPerDirection; i++) {
    laneDividerOffsets.push(-i * laneWidth);
    laneDividerOffsets.push(i * laneWidth);
  }
  laneDividerOffsets.sort((a, b) => a - b);

  const shoulderLineOffsets: [number, number] = [-halfCarriagewayWidth, halfCarriagewayWidth];

  const resolveArrowType = (laneIdx: number, totalLanes: number): RoadLaneArrowType => {
    const isSingleLane = totalLanes <= 1;
    if (isSingleLane) {
      return "straight-left";
    }
    const isInnerRightTurnLane = laneIdx === 0;
    if (isInnerRightTurnLane) {
      return "right";
    }
    const isOuterLeftTurnLane = laneIdx === totalLanes - 1;
    if (isOuterLeftTurnLane) {
      return "straight-left";
    }
    return "straight";
  };

  const lanes: RoadLaneSpec[] = [];
  // 自車方向（inbound: +Z 進行、日本の左側通行では x > 0）
  for (let i = 0; i < lanesPerDirection; i++) {
    const innerBoundaryX = i * laneWidth;
    const outerBoundaryX = (i + 1) * laneWidth;
    const centerX = (innerBoundaryX + outerBoundaryX) * 0.5;
    lanes.push({
      laneIndex: i,
      direction: "inbound",
      centerX,
      width: laneWidth,
      innerBoundaryX,
      outerBoundaryX,
      arrowType: resolveArrowType(i, lanesPerDirection),
      rotationY: Math.PI,
    });
  }

  // 対向方向（oncoming: -Z 進行、日本の左側通行では x < 0）
  for (let i = 0; i < lanesPerDirection; i++) {
    const innerBoundaryX = -i * laneWidth;
    const outerBoundaryX = -(i + 1) * laneWidth;
    const centerX = (innerBoundaryX + outerBoundaryX) * 0.5;
    lanes.push({
      laneIndex: i,
      direction: "oncoming",
      centerX,
      width: laneWidth,
      innerBoundaryX,
      outerBoundaryX,
      arrowType: resolveArrowType(i, lanesPerDirection),
      rotationY: 0,
    });
  }

  const halfLen = config.length * 0.5;
  const endBuffer = Math.max(0, config.segmentEndExclusionBuffer ?? 1.5);
  // 横断歩道（±2.0m）＋停止線（±3.8m, 外縁 ±4.025m）＋安全クリアランス（1.175m）= ±5.2m
  const cwHalfSpan = Math.max(4.5, config.crosswalkExclusionHalfSpan ?? 5.2);

  const crosswalkExcludeZRanges: Array<[number, number]> = [];
  const hasEndBuffer = endBuffer > 0 && config.length > endBuffer * 4;
  if (hasEndBuffer) {
    crosswalkExcludeZRanges.push([-halfLen, -halfLen + endBuffer]);
    crosswalkExcludeZRanges.push([halfLen - endBuffer, halfLen]);
  }

  for (const cwZ of config.crosswalkZPositions ?? []) {
    crosswalkExcludeZRanges.push([cwZ - cwHalfSpan, cwZ + cwHalfSpan]);
  }

  const centerLineExcludeZRanges: Array<[number, number]> = [...crosswalkExcludeZRanges];
  for (const [zMin, zMax] of config.zebraZoneZRanges ?? []) {
    centerLineExcludeZRanges.push([Math.min(zMin, zMax), Math.max(zMin, zMax)]);
  }

  // 規制標示（102の2）「進路変更禁止」（道路交通法第26条の2第2項・第30条）：
  // 複数車線道路（lanesPerDirection >= 2）において、横断歩道・停止線の直前アプローチ区間（約12〜14m）のみ
  // 車線境界線（車両通行帯境界線）を白破線から黄色実線（進路変更禁止線）へ切り替える。
  // Why not 30m 等の過大な区間にするか:
  // 100〜164m の道路セグメントに北側・南側の2箇所の横断歩道がある都市街区では、30m ずつ黄色実線を引くと
  // 道路の大半が黄色い車線境界線で埋まり、通常の白破線区間や中央導流帯との区別がつきにくくなるため。
  const inboundNoLaneChangeZRanges: Array<[number, number]> = [];
  const oncomingNoLaneChangeZRanges: Array<[number, number]> = [];
  const isMultiLane = lanesPerDirection >= 2;
  if (isMultiLane) {
    const approachSolidLength = Math.min(14.0, Math.max(10.0, config.length * 0.1));
    const minValidZ = -halfLen + endBuffer;
    const maxValidZ = halfLen - endBuffer;

    for (const cwZ of config.crosswalkZPositions ?? []) {
      // 自車方向（inbound: +Z 進行、x > 0）：横断歩道除外区間の手前 [cwZ - cwHalfSpan - approachSolidLength, cwZ - cwHalfSpan]
      const inboundEnd = Math.min(maxValidZ, cwZ - cwHalfSpan);
      const inboundStart = Math.max(minValidZ, inboundEnd - approachSolidLength);
      const isValidInboundSpan = inboundEnd - inboundStart >= 4.0;
      if (isValidInboundSpan) {
        inboundNoLaneChangeZRanges.push([inboundStart, inboundEnd]);
      }

      // 対向方向（oncoming: -Z 進行、x < 0）：横断歩道除外区間の手前 [cwZ + cwHalfSpan, cwZ + cwHalfSpan + approachSolidLength]
      const oncomingStart = Math.max(minValidZ, cwZ + cwHalfSpan);
      const oncomingEnd = Math.min(maxValidZ, oncomingStart + approachSolidLength);
      const isValidOncomingSpan = oncomingEnd - oncomingStart >= 4.0;
      if (isValidOncomingSpan) {
        oncomingNoLaneChangeZRanges.push([oncomingStart, oncomingEnd]);
      }
    }
  }

  return {
    lanesPerDirection,
    laneWidth,
    carriagewayWidth,
    halfCarriagewayWidth,
    centerLineWidth,
    laneDividerOffsets,
    shoulderLineOffsets,
    lanes,
    crosswalkExcludeZRanges,
    centerLineExcludeZRanges,
    inboundNoLaneChangeZRanges,
    oncomingNoLaneChangeZRanges,
  };
}

/**
 * 日本の道路標示（路面ペイント）ジェネレーター
 * 国土交通省 道路標識、区画線及び道路標示に関する命令 準拠
 */
export class RoadMarkings {
  private whitePaintMat: THREE.MeshStandardMaterial;
  private yellowPaintMat: THREE.MeshStandardMaterial;
  private brailleTileMat: THREE.MeshStandardMaterial;

  constructor() {
    // Why not: polygonOffset を設定しないと、同一平面付近の路面や交差標示同士でカメラ俯角が浅いときに
    // 深度バッファの量子化誤差による Z ファイティング（チラつき・縞模様）が発生するため、polygonOffset で手前へバイアスする。
    // また JIS K 5665 路面標示用塗料（ガラスビーズ混入）の再帰反射輝度を emissive で担保し、
    // 濡れたアスファルト路面や浅い俯角でも白線・黄線が黒いシルエットにならず鮮明に視認できるようにする。
    this.whitePaintMat = new THREE.MeshStandardMaterial({
      name: "RoadMarking_WhitePaint",
      color: 0xf8fafc,
      emissive: 0xe2e8f0,
      emissiveIntensity: 0.42,
      roughness: 0.46,
      metalness: 0.08,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.applyRoadMarking3DTexture(this.whitePaintMat, "white-paint");

    this.yellowPaintMat = new THREE.MeshStandardMaterial({
      name: "RoadMarking_YellowPaint",
      color: 0xf59e0b, // 日本の道路規制標示オレンジイエロー
      emissive: 0xf59e0b,
      emissiveIntensity: 0.45,
      roughness: 0.48,
      metalness: 0.08,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.applyRoadMarking3DTexture(this.yellowPaintMat, "yellow-paint");

    this.brailleTileMat = new THREE.MeshStandardMaterial({
      name: "RoadMarking_BrailleTile",
      color: 0xeab308, // 点字ブロック警戒色イエロー（JIS T 9251）
      emissive: 0xeab308,
      emissiveIntensity: 0.35,
      roughness: 0.58,
      metalness: 0.1,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.applyRoadMarking3DTexture(this.brailleTileMat, "braille");
  }

  /**
   * 道路標示ペイント（白線・黄線・点字ブロック）へ 3D ボリュームテクスチャ（sampler3D）を注入する
   * How: getSharedRoadMarkingProp3DTexture(32) の R チャンネル（再帰反射ガラスビーズ粒子）で
   * 視線・光源角度に応じたマイクロプリズム輝度変調（キラキラ感）を与え、
   * G チャンネル（溶融塗装膜の微細凹凸・摩耗マスク）で塗装厚み・タイヤ摩耗・点字ブロック防滑骨材を表現する。
   * Why not 2D テクスチャを使うか:
   * 破線・実線・矢印・横断歩道・ダイヤ標示などジオメトリ寸法や回転角が多様なメッシュ群に対し、
   * 3D ワールド空間座標でサンプリングすることで粒子の引き伸ばしや継ぎ目を完全に排除するため。
   */
  public applyRoadMarking3DTexture(
    material: THREE.MeshStandardMaterial,
    variant: RoadMarking3DTextureVariant,
  ): void {
    const volumeTex = Procedural3DTextureGenerator.getSharedRoadMarkingProp3DTexture(32);
    const isBraille = variant === "braille";
    const isYellow = variant === "yellow-paint";
    const variantCode = isBraille ? 2 : isYellow ? 1 : 0;

    material.userData.uRoadPropVolumeTex = volumeTex;
    material.userData.roadMarkingVariant = variant;
    material.customProgramCacheKey = () => `road-marking-3d-v3-${variant}`;

    material.onBeforeCompile = (shader) => {
      shader.uniforms.uRoadPropVolumeTex = { value: volumeTex };
      shader.uniforms.uMarkingVariant = { value: variantCode };

      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        `#include <common>
varying vec3 vMarkingWorldPos;
varying vec3 vMarkingLocalPos;`,
      );

      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vMarkingLocalPos = position;
vMarkingWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;`,
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        `#include <common>
precision highp sampler3D;
uniform sampler3D uRoadPropVolumeTex;
uniform int uMarkingVariant;
varying vec3 vMarkingWorldPos;
varying vec3 vMarkingLocalPos;`,
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>
float markCamDist = length(cameraPosition - vMarkingWorldPos);
vec4 markVoxFine = vec4(0.5);
vec4 markVoxMacro = vec4(0.5);
float glassBeadSignal = 0.5;
float paintFilmMask = 0.5;
float beadSparkle = 0.0;
if (markCamDist < 65.0) {
  markVoxFine = texture(uRoadPropVolumeTex, vMarkingWorldPos * 14.0);
  markVoxMacro = texture(uRoadPropVolumeTex, vMarkingWorldPos * 1.35 + vec3(0.31, 0.17, 0.59));
  glassBeadSignal = mix(markVoxFine.r, markVoxMacro.r, 0.25);
  paintFilmMask = mix(markVoxMacro.g, markVoxFine.g, 0.42);
  vec3 viewDelta = cameraPosition - vMarkingWorldPos;
  vec3 viewDirWorld = viewDelta / max(length(viewDelta), 0.001);
  float grazingFactor = pow(clamp(1.0 - abs(viewDirWorld.y), 0.0, 1.0), 1.6);
  beadSparkle = clamp(smoothstep(0.56, 0.94, glassBeadSignal) * (0.45 + 0.65 * grazingFactor), 0.0, 1.0);

  if (uMarkingVariant == 2) {
    // 点字ブロック（視覚障害者誘導用ブロック JIS T 9251）：セラミック/樹脂の防滑微細グリット＆30cm角タイル目地・突起陰影
    vec2 tile30Uv = fract(vMarkingWorldPos.xz / 0.30);
    float tileGroutX = smoothstep(0.0, 0.045, tile30Uv.x) * smoothstep(1.0, 0.955, tile30Uv.x);
    float tileGroutY = smoothstep(0.0, 0.045, tile30Uv.y) * smoothstep(1.0, 0.955, tile30Uv.y);
    float tileGroutMask = tileGroutX * tileGroutY;
    vec2 tileCell = fract(vMarkingWorldPos.xz / 0.06) - 0.5;
    float domeBump = smoothstep(0.34, 0.14, length(tileCell)) * tileGroutMask;
    float ceramicGrit = mix(markVoxFine.r, markVoxFine.g, 0.5);
    float brailleShade = (0.86 + (ceramicGrit - 0.5) * 0.22 + domeBump * 0.16) * mix(0.42, 1.0, tileGroutMask);
    diffuseColor.rgb *= clamp(brailleShade, 0.38, 1.18);
  } else {
    // 白線・黄線（溶融型トラフィックペイント JIS K 5665）：ガラスビーズ再帰反射＋塗装膜凹凸
    // Why not 暗い wornAsphaltTint(0.26) を 32% もブレンドするか:
    // アスファルト側が太陽光・街灯・雨天鏡面反射で明るく輝く場面で、ペイント側のアルベドを暗く落とすと
    // 白線・黄線が路面より暗い黒筋（シルエット）に見えてしまうため、高い塗装膜反射率（0.88〜1.0）を維持する。
    float tireTrackWear = smoothstep(0.24, 0.58, paintFilmMask);
    vec3 wornAsphaltTint = (uMarkingVariant == 1) ? vec3(0.82, 0.54, 0.10) : vec3(0.76, 0.80, 0.85);
    diffuseColor.rgb = mix(wornAsphaltTint, diffuseColor.rgb, 0.86 + 0.14 * tireTrackWear);
    vec3 retroTint = (uMarkingVariant == 1) ? vec3(1.0, 0.84, 0.38) : vec3(0.96, 0.98, 1.0);
    diffuseColor.rgb = clamp(diffuseColor.rgb + retroTint * beadSparkle * 0.24, vec3(0.0), vec3(1.12));
  }
}`,
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <metalnessmap_fragment>",
        `#include <metalnessmap_fragment>
if (markCamDist < 65.0) {
  if (uMarkingVariant == 2) {
    float ceramicGritR = mix(markVoxFine.r, markVoxFine.g, 0.5);
    roughnessFactor = clamp(roughnessFactor + (0.5 - ceramicGritR) * 0.22, 0.38, 0.88);
    metalnessFactor = clamp(metalnessFactor + beadSparkle * 0.06, 0.04, 0.22);
  } else {
    // ガラスビーズが露出している箇所は低ラフネス・高反射、摩耗箇所は高ラフネス
    roughnessFactor = clamp(roughnessFactor - beadSparkle * 0.20 + (1.0 - paintFilmMask) * 0.18, 0.24, 0.86);
    metalnessFactor = clamp(metalnessFactor + beadSparkle * 0.14, 0.04, 0.32);
  }
}`,
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
if (markCamDist < 36.0) {
  // Why not dFdx(vMarkingWorldPos) * dFdx(markingHeight) を使うか:
  // 浅い視線角（グレージング角）やリボンメッシュ境界で dFdx(worldPos) が数十mへ爆発し、
  // ビュースペースの normal と逆向きに相殺して normalize(0) -> NaN 白フラッシュを引き起こすため、
  // 3D ボリュームサンプルの有界な差分を viewMatrix でビュースペースへ変換して安全に摂動を加える。
  vec3 markMicroShift = vec3(
    (markVoxFine.r - 0.5) * 0.07,
    0.0,
    (markVoxFine.g - 0.5) * 0.07
  );
  vec3 markViewPerturb = mat3(viewMatrix) * markMicroShift;
  vec3 markCombinedN = normal + clamp(markViewPerturb, vec3(-0.12), vec3(0.12));
  normal = markCombinedN / max(length(markCombinedN), 0.001);
}`,
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
if (uMarkingVariant != 2 && markCamDist < 65.0) {
  vec3 beadRetroGlow = (uMarkingVariant == 1) ? vec3(1.0, 0.72, 0.16) : vec3(0.92, 0.96, 1.0);
  totalEmissiveRadiance += clamp(beadRetroGlow * (0.14 + beadSparkle * 0.24), vec3(0.0), vec3(0.38));
}`,
      );
    };
    material.needsUpdate = true;
  }

  /**
   * 連続する長手方向区間 [-length / 2, length / 2] から excludeZRanges（横断歩道・停止線区間）を除いた有効区間列を算出する
   */
  private computeIncludedZSpans(
    length: number,
    excludeZRanges: ReadonlyArray<readonly [number, number]> = [],
  ): Array<[number, number]> {
    const halfLen = length / 2;
    const hasNoExclusions = excludeZRanges.length === 0;
    if (hasNoExclusions) {
      return [[-halfLen, halfLen]];
    }

    const sortedRanges = [...excludeZRanges]
      .map(([a, b]) => [Math.min(a, b), Math.max(a, b)] as [number, number])
      .sort((a, b) => a[0] - b[0]);

    const spans: Array<[number, number]> = [];
    let cursor = -halfLen;

    for (const [exStart, exEnd] of sortedRanges) {
      const clampedStart = Math.max(-halfLen, Math.min(halfLen, exStart));
      const clampedEnd = Math.max(-halfLen, Math.min(halfLen, exEnd));
      const hasValidSpanBefore = clampedStart - cursor >= 0.4;
      if (hasValidSpanBefore) {
        spans.push([cursor, clampedStart]);
      }
      cursor = Math.max(cursor, clampedEnd);
    }

    const hasRemainingTail = halfLen - cursor >= 0.4;
    if (hasRemainingTail) {
      spans.push([cursor, halfLen]);
    }

    return spans;
  }

  /**
   * 破線区間 [zStart, zEnd] が除外区間（横断歩道・停止線ゾーン）と重なるか判定する
   */
  private isZRangeExcluded(
    zStart: number,
    zEnd: number,
    excludeZRanges: ReadonlyArray<readonly [number, number]>,
  ): boolean {
    for (const [exMin, exMax] of excludeZRanges) {
      const minZ = Math.min(exMin, exMax);
      const maxZ = Math.max(exMin, exMax);
      const isOverlapping = zEnd > minZ && zStart < maxZ;
      if (isOverlapping) {
        return true;
      }
    }
    return false;
  }

  /**
   * 中央線（黄色実線または白破線）
   * Why excludeZRanges で横断歩道区間を分割するか:
  /**
   * 中央線（センターライン: 指示標示 203 / 区画線 101 / 規制標示 101）
   * How:
   * - 道路交通法第17条第4項・道路標識、区画線及び道路標示に関する命令・警察庁「交通規制基準」に基づき、
   *   片側2車線以上（lanesPerDirection >= 2、道路の右側部分に2以上の車両通行帯がある道路）では
   *   法令上すでに右側部分へのはみ出し通行が禁止されているため、追越し禁止の黄色実線（規制標示 101）は用いず、
   *   必ず「白の実線（幅20cm: CenterLine_SolidWhite）」で中央線を標示する。
   * - 片側1車線（lanesPerDirection === 1）では、追越しのため右側部分にはみ出して通行することを禁止する区間（isNoPassing === true）に
   *   「黄色実線（規制標示 101: CenterLine_Solid）」を、それ以外の区間に「白破線（CenterLine_Dash）」を標示する。
   * - いずれの場合も excludeZRanges（横断歩道・停止線・中央導流帯・交差点接続部）のZ範囲を分割・除外して配置する。
   * Why 除外するか:
   * 横断歩道や停止線の上を中央線が突き抜けると日本の道路標示規則に反し、視覚的にも重なり破綻が生じるため。
   * Why not 片側2車線以上の幹線道路や中央分離帯・導流帯沿いに黄色実線を引くか:
   * 日本の交通規制基準では片側2車線以上の道路の中央線は原則として白実線（幅15〜20cm）であり、
   * 黄色実線を引くと片側1車線の追越し禁止規制標示と混同し道路交通法上の標示基準に適合しないため。
   */
  public createCenterLine(
    length: number,
    isNoPassing = true,
    excludeZRanges: ReadonlyArray<readonly [number, number]> = [],
    lanesPerDirection = 1,
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = "CenterLineGroup";
    group.userData.markingType = "CenterLine";
    const width = 0.2; // 20cm幅
    const isMultiLaneRoad = lanesPerDirection >= 2;

    if (isMultiLaneRoad) {
      // 片側2車線以上（4車線・6車線等）：道路交通法第17条第4項・警察庁交通規制基準に基づき「白実線」の中央線
      group.userData.paintColor = "white";
      group.userData.lineStyle = "solid_white";
      const spans = this.computeIncludedZSpans(length, excludeZRanges);
      for (const [zStart, zEnd] of spans) {
        const spanLen = zEnd - zStart;
        const geo = new THREE.PlaneGeometry(width, spanLen);
        geo.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geo, this.whitePaintMat);
        mesh.name = "CenterLine_SolidWhite";
        mesh.userData.markingType = "CenterLine";
        mesh.userData.paintColor = "white";
        mesh.position.set(0, 0.02, (zStart + zEnd) * 0.5);
        group.add(mesh);
      }
      return group;
    }

    if (isNoPassing) {
      // 片側1車線かつ追越し禁止（規制標示 101）：黄色実線（横断歩道・停止線ゾーンは除外して分割配置）
      group.userData.paintColor = "yellow";
      group.userData.lineStyle = "solid_yellow";
      const spans = this.computeIncludedZSpans(length, excludeZRanges);
      for (const [zStart, zEnd] of spans) {
        const spanLen = zEnd - zStart;
        const geo = new THREE.PlaneGeometry(width, spanLen);
        geo.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geo, this.yellowPaintMat);
        mesh.name = "CenterLine_Solid";
        mesh.userData.markingType = "CenterLine";
        mesh.userData.paintColor = "yellow";
        mesh.position.set(0, 0.02, (zStart + zEnd) * 0.5);
        group.add(mesh);
      }
      return group;
    }

    // 片側1車線（追越し禁止指定なし）：白破線（長さ5m、間隔5m）
    group.userData.paintColor = "white";
    group.userData.lineStyle = "dashed_white";
    const dashLength = 5.0;
    const gapLength = 5.0;
    const cycle = dashLength + gapLength;
    for (let z = -length / 2 + dashLength / 2; z < length / 2; z += cycle) {
      const isExcluded = this.isZRangeExcluded(
        z - dashLength * 0.5,
        z + dashLength * 0.5,
        excludeZRanges,
      );
      if (isExcluded) {
        continue;
      }
      const geo = new THREE.PlaneGeometry(width, dashLength);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, this.whitePaintMat);
      mesh.name = "CenterLine_Dash";
      mesh.userData.markingType = "CenterLine";
      mesh.userData.paintColor = "white";
      mesh.position.set(0, 0.02, z);
      group.add(mesh);
    }

    return group;
  }

  /**
   * 車両通行帯境界線（区画線 102：白破線 5m線・5m空き）および
   * 交差点・横断歩道手前の「進路変更禁止」線（規制標示 102の2：黄色実線、道路交通法第26条の2第2項・第30条）
   * How:
   * - 横断歩道・停止線の手前アプローチ区間（noLaneChangeOptions）では、進行方向側（x > 0 は -Z 側手前、x < 0 は +Z 側手前）の
   *   車線境界線を連続する黄色実線（LaneDivider_SolidYellow, userData.isNoLaneChangeYellow = true）として描画する。
   * - それ以外の通常区間では、上記黄色実線区間および横断歩道除外区間（excludeZRanges）と重ならない範囲に白破線を描画する。
   */
  public createLaneDividers(
    length: number,
    laneOffsets: number[],
    excludeZRanges: ReadonlyArray<readonly [number, number]> = [],
    noLaneChangeOptions?: {
      inboundYellowZRanges?: ReadonlyArray<readonly [number, number]>;
      oncomingYellowZRanges?: ReadonlyArray<readonly [number, number]>;
    },
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = "LaneDividersGroup";
    group.userData.markingType = "LaneDivider";
    const width = 0.15; // 15cm幅
    const dashLength = 5.0;
    const gapLength = 5.0;
    const cycle = dashLength + gapLength;

    for (const x of laneOffsets) {
      const isInboundSide = x > 0;
      const rawYellowRanges = isInboundSide
        ? (noLaneChangeOptions?.inboundYellowZRanges ?? [])
        : (noLaneChangeOptions?.oncomingYellowZRanges ?? []);

      // 横断歩道・停止線除外区間と重ならない有効な黄色実線（進路変更禁止）スパンを確定
      const validYellowRanges: Array<[number, number]> = [];
      for (const [yMin, yMax] of rawYellowRanges) {
        let segStart = Math.max(-length * 0.5, Math.min(yMin, yMax));
        const segEnd = Math.min(length * 0.5, Math.max(yMin, yMax));
        for (const [exMin, exMax] of excludeZRanges) {
          const e0 = Math.min(exMin, exMax);
          const e1 = Math.max(exMin, exMax);
          const overlapsStart = segStart >= e0 && segStart < e1;
          if (overlapsStart) {
            segStart = e1;
          }
        }
        const isNotExcluded = !this.isZRangeExcluded(segStart, segEnd, excludeZRanges);
        const hasValidYellowLen = segEnd - segStart >= 3.0 && isNotExcluded;
        if (hasValidYellowLen) {
          validYellowRanges.push([segStart, segEnd]);
          const yellowLen = segEnd - segStart;
          const yellowGeo = new THREE.PlaneGeometry(width, yellowLen);
          yellowGeo.rotateX(-Math.PI / 2);
          const yellowMesh = new THREE.Mesh(yellowGeo, this.yellowPaintMat);
          yellowMesh.name = "LaneDivider_SolidYellow";
          yellowMesh.userData.markingType = "LaneDivider";
          yellowMesh.userData.isNoLaneChangeYellow = true;
          yellowMesh.position.set(x, 0.02, (segStart + segEnd) * 0.5);
          group.add(yellowMesh);
        }
      }

      const combinedDashExclusions: Array<readonly [number, number]> = [
        ...excludeZRanges,
        ...validYellowRanges.map(([z0, z1]) => [z0 - 0.6, z1 + 0.6] as readonly [number, number]),
      ];

      for (let z = -length / 2 + dashLength / 2; z < length / 2; z += cycle) {
        const isExcluded = this.isZRangeExcluded(
          z - dashLength * 0.5,
          z + dashLength * 0.5,
          combinedDashExclusions,
        );
        if (isExcluded) {
          continue;
        }
        const geo = new THREE.PlaneGeometry(width, dashLength);
        geo.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geo, this.whitePaintMat);
        mesh.name = "LaneDivider_Dash";
        mesh.userData.markingType = "LaneDivider";
        mesh.userData.isNoLaneChangeYellow = false;
        mesh.position.set(x, 0.02, z);
        group.add(mesh);
      }
    }

    return group;
  }

  /**
   * 車道外側線（路肩白実線：幅15cm）
   */
  public createShoulderLines(
    length: number,
    leftX: number,
    rightX: number,
    excludeZRanges: ReadonlyArray<readonly [number, number]> = [],
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = "ShoulderLinesGroup";
    group.userData.markingType = "ShoulderLine";
    const width = 0.15;
    const spans = this.computeIncludedZSpans(length, excludeZRanges);

    for (const [zStart, zEnd] of spans) {
      const spanLen = zEnd - zStart;
      const midZ = (zStart + zEnd) * 0.5;

      const leftGeo = new THREE.PlaneGeometry(width, spanLen);
      leftGeo.rotateX(-Math.PI / 2);
      const leftMesh = new THREE.Mesh(leftGeo, this.whitePaintMat);
      leftMesh.name = "ShoulderLine_Left";
      leftMesh.userData.markingType = "ShoulderLine";
      leftMesh.position.set(leftX, 0.02, midZ);
      group.add(leftMesh);

      const rightGeo = new THREE.PlaneGeometry(width, spanLen);
      rightGeo.rotateX(-Math.PI / 2);
      const rightMesh = new THREE.Mesh(rightGeo, this.whitePaintMat);
      rightMesh.name = "ShoulderLine_Right";
      rightMesh.userData.markingType = "ShoulderLine";
      rightMesh.position.set(rightX, 0.02, midZ);
      group.add(rightMesh);
    }

    return group;
  }

  /**
   * 横断歩道（ゼブラ標示：帯幅45cm、間隔45cm、奥行き4m）
   * Why 停止線を道路全幅ではなく進行方向の片側車線（左側通行）のみに引き、中央線・外側線から25cm離隔するか:
   * 日本の左側通行では +Z 方向へ進行する車両（x > 0 車線）は横断歩道手前（z = -3.8m, x > 0）で停止し、
   * -Z 方向へ進行する対向車（x < 0 車線）は反対側手前（z = +3.8m, x < 0）で停止するため、
   * 対向車線側まで貫通する全幅停止線を廃止し、さらに中央線（|x| <= 0.10m）や路肩外側線（|x| = roadWidth * 0.5）と接触・交差しないようにする。
   */
  public createCrosswalk(roadWidth: number, zPosition: number): THREE.Group {
    const group = new THREE.Group();
    group.name = "CrosswalkGroup";
    group.userData.markingType = "Crosswalk";
    group.position.set(0, 0.025, zPosition);

    const stripeWidth = 0.45; // 45cm
    const stripeGap = 0.45;
    const stripeLength = 4.0; // 奥行き4m
    const step = stripeWidth + stripeGap;

    // 外側線（|x| = roadWidth * 0.5）の内側 0.45m 以内に収まるよう対称配置
    const usableWidth = Math.max(2.7, roadWidth - 0.9);
    const count = Math.max(2, Math.floor((usableWidth + stripeGap) / step));
    const totalSpan = count * stripeWidth + (count - 1) * stripeGap;
    const startX = -totalSpan * 0.5 + stripeWidth * 0.5;

    for (let i = 0; i < count; i++) {
      const x = startX + i * step;
      const geo = new THREE.PlaneGeometry(stripeWidth, stripeLength);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, this.whitePaintMat);
      mesh.name = "CrosswalkStripe";
      mesh.userData.markingType = "CrosswalkStripe";
      mesh.position.set(x, 0, 0);
      group.add(mesh);
    }

    // 停止線（横断歩道の手前側、進行方向車線の半分幅のみに配置する幅45cmの白実線）
    // 中央線（|x| <= 0.10m）から 0.25m、路肩外側線（|x| = roadWidth * 0.5）から 0.25m のクリアランスを確保
    const innerMargin = 0.25;
    const outerMargin = 0.25;
    const halfCarriageway = roadWidth * 0.5;
    const halfLaneSpan = Math.max(1.8, halfCarriageway - innerMargin - outerMargin);
    const stopLineCenterX = innerMargin + halfLaneSpan * 0.5;

    // 対向車線（-Z 進行, x < 0）の停止線：横断歩道の +Z 側手前
    const stopLineNorthGeo = new THREE.PlaneGeometry(halfLaneSpan, 0.45);
    stopLineNorthGeo.rotateX(-Math.PI / 2);
    const stopLineNorth = new THREE.Mesh(stopLineNorthGeo, this.whitePaintMat);
    stopLineNorth.name = "StopLine_Oncoming";
    stopLineNorth.userData.markingType = "StopLine";
    stopLineNorth.position.set(-stopLineCenterX, 0, 3.8);
    group.add(stopLineNorth);

    // 自車車線（+Z 進行, x > 0）の停止線：横断歩道の -Z 側手前
    const stopLineSouthGeo = new THREE.PlaneGeometry(halfLaneSpan, 0.45);
    stopLineSouthGeo.rotateX(-Math.PI / 2);
    const stopLineSouth = new THREE.Mesh(stopLineSouthGeo, this.whitePaintMat);
    stopLineSouth.name = "StopLine_Inbound";
    stopLineSouth.userData.markingType = "StopLine";
    stopLineSouth.position.set(stopLineCenterX, 0, -3.8);
    group.add(stopLineSouth);

    return group;
  }

  /**
   * 歩道用点字ブロック（視覚障害者誘導用ブロック JIS T 9251 / 道路移動等円滑化基準）
   * How:
   * - 横断歩道接続部（歩道巻き込み部・縁石スロープ手前）にのみ、30cm角タイル×2列×8枚（幅0.6m × 長さ2.4m）の
   *   警告ブロック（点状ブロック）マットを離散配置する。
   * Why not 歩道中央に道路全長（100m〜164m）の連続した黄色い帯メッシュを敷くか:
   * 歩道の中央に100m超の途切れない黄色いラインを引くと、ドライバー視点から「歩道の上に黄色の車線（センターライン）が
   * 引かれている」ように見えてしまい不自然かつ実際の日本の都市歩道（横断歩道端部の警告ブロック敷設）とも乖離するため。
   */
  public createBrailleTiles(
    length: number,
    xPosition: number,
    curbY: number,
    crosswalkZPositions?: ReadonlyArray<number>,
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = "SidewalkTactileWarningGroup";
    group.userData.markingType = "TactilePaving";

    const resolvedZPositions =
      crosswalkZPositions !== undefined ? crosswalkZPositions : [length * 0.25];

    const padWidth = 0.6; // 30cm角 × 2列（60cm）
    const padLength = 2.4; // 30cm角 × 8枚（240cm：横断歩道開口部の警告ブロック敷設幅）

    for (const crossZ of resolvedZPositions) {
      const isWithinSegment = Math.abs(crossZ) + padLength * 0.5 <= length * 0.5;
      if (!isWithinSegment) {
        continue;
      }
      const geo = new THREE.PlaneGeometry(padWidth, padLength);
      geo.rotateX(-Math.PI / 2);
      const padMesh = new THREE.Mesh(geo, this.brailleTileMat);
      padMesh.name = "BrailleWarningPad";
      padMesh.userData.markingType = "TactilePaving";
      padMesh.position.set(xPosition, curbY + 0.005, crossZ);
      group.add(padMesh);
    }

    return group;
  }

  /**
   * 指示標示（210）: 「横断歩道又は自転車横断帯あり」（路面ダイヤマーク ◇）
   * How: 横断歩道手前 30m / 50m の車線中央に、縦3.6m×横1.4mの中抜き白ひし形（◇）を4本の帯メッシュで形成する。
   * Why rotY の符号を [-angle, +angle, +angle, -angle] にするか:
   * PlaneGeometry を rotateX(-Math.PI / 2) で水平面に寝かせた後、Y軸回転 +angle を掛けると
   * ローカル +Z 端は +X 方向（z * sin(angle)）へ変位する。
   * したがって第3象限（dx < 0, dz < 0）の辺が下頂点 (0, -1.8) と左頂点 (-0.7, 0) を結ぶには
   * rotY = -angle とする必要があり、符号が逆だと中心 (0, 0) で交差する「×」印になってしまうため。
   */
  public createCrosswalkDiamondMarking(x: number, z: number): THREE.Group {
    const group = new THREE.Group();
    group.name = "CrosswalkDiamondGroup";
    group.userData.markingType = "CrosswalkDiamond";
    group.position.set(x, 0.024, z);

    // ひし形の4辺を細長い平面メッシュで構築（縦長 3.6m, 横幅 1.4m）
    const edgeLen = 1.95;
    const lineWidth = 0.22;
    const angle = Math.atan2(0.7, 1.8); // 約21.25度

    const configs = [
      { dx: -0.35, dz: -0.9, rotY: -angle },
      { dx: 0.35, dz: -0.9, rotY: angle },
      { dx: -0.35, dz: 0.9, rotY: angle },
      { dx: 0.35, dz: 0.9, rotY: -angle },
    ];

    for (const c of configs) {
      const geo = new THREE.PlaneGeometry(lineWidth, edgeLen);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, this.whitePaintMat);
      mesh.name = "CrosswalkDiamond_Edge";
      mesh.userData.markingType = "CrosswalkDiamond";
      mesh.position.set(c.dx, 0, c.dz);
      mesh.rotation.y = c.rotY;
      group.add(mesh);
    }

    return group;
  }

  /**
   * 規制標示: 「進行方向別通行区分（路面進行方向矢印）」
   * How: 車線中央に直進・左折・右折の路面白色ペイント矢印（全長5.0m）を配置する。
   */
  public createLaneArrowMarking(
    x: number,
    z: number,
    type: "straight" | "straight-left" | "right" = "straight",
    rotationY = 0,
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = `LaneArrowGroup_${type}`;
    group.userData.markingType = "LaneArrow";
    group.position.set(x, 0.024, z);
    group.rotation.y = rotationY;

    // 縦ステム（シャフト）
    const stemGeo = new THREE.PlaneGeometry(0.3, 3.2);
    stemGeo.rotateX(-Math.PI / 2);
    const stem = new THREE.Mesh(stemGeo, this.whitePaintMat);
    stem.name = "LaneArrow_Stem";
    stem.userData.markingType = "LaneArrow";
    stem.position.set(0, 0, 0.6);
    group.add(stem);

    const hasStraight = type === "straight" || type === "straight-left";
    if (hasStraight) {
      // 直進矢尻（3角形）
      const headShape = new THREE.Shape();
      headShape.moveTo(0, 1.8);
      headShape.lineTo(-0.55, 0.2);
      headShape.lineTo(0.55, 0.2);
      headShape.closePath();

      const headGeo = new THREE.ShapeGeometry(headShape);
      headGeo.rotateX(-Math.PI / 2);
      const head = new THREE.Mesh(headGeo, this.whitePaintMat);
      head.name = "LaneArrow_StraightHead";
      head.userData.markingType = "LaneArrow";
      head.position.set(0, 0, -1.2);
      group.add(head);
    }

    const isStraightLeft = type === "straight-left";
    if (isStraightLeft) {
      const branchGeo = new THREE.PlaneGeometry(0.9, 0.35);
      branchGeo.rotateX(-Math.PI / 2);
      const branch = new THREE.Mesh(branchGeo, this.whitePaintMat);
      branch.name = "LaneArrow_LeftBranch";
      branch.userData.markingType = "LaneArrow";
      branch.position.set(-0.5, 0, 0.2);
      group.add(branch);

      const leftHeadShape = new THREE.Shape();
      leftHeadShape.moveTo(-1.45, -0.2);
      leftHeadShape.lineTo(-0.85, 0.35);
      leftHeadShape.lineTo(-0.85, -0.75);
      leftHeadShape.closePath();
      const leftHeadGeo = new THREE.ShapeGeometry(leftHeadShape);
      leftHeadGeo.rotateX(-Math.PI / 2);
      const leftHead = new THREE.Mesh(leftHeadGeo, this.whitePaintMat);
      leftHead.name = "LaneArrow_LeftHead";
      leftHead.userData.markingType = "LaneArrow";
      group.add(leftHead);
    }

    const isRight = type === "right";
    if (isRight) {
      const branchGeo = new THREE.PlaneGeometry(0.95, 0.38);
      branchGeo.rotateX(-Math.PI / 2);
      const branch = new THREE.Mesh(branchGeo, this.whitePaintMat);
      branch.name = "LaneArrow_RightBranch";
      branch.userData.markingType = "LaneArrow";
      branch.position.set(0.5, 0, -0.8);
      group.add(branch);

      const rightHeadShape = new THREE.Shape();
      rightHeadShape.moveTo(1.5, 0.8);
      rightHeadShape.lineTo(0.9, 1.35);
      rightHeadShape.lineTo(0.9, 0.25);
      rightHeadShape.closePath();
      const rightHeadGeo = new THREE.ShapeGeometry(rightHeadShape);
      rightHeadGeo.rotateX(-Math.PI / 2);
      const rightHead = new THREE.Mesh(rightHeadGeo, this.whitePaintMat);
      rightHead.name = "LaneArrow_RightHead";
      rightHead.userData.markingType = "LaneArrow";
      group.add(rightHead);
    }

    return group;
  }

  /**
   * 規制標示（105）: 「最高速度（路面速度ペイント 30 / 40 / 50）」
   * How: 道路標識、区画線及び道路標示に関する命令（別表第5・別表第6 規制標示「最高速度」105）に準拠し、
   * 幹線道路の車線中央へ白色（#f8fafc）の縦長4倍体数字で「40」「50」等の最高速度標示を描画する。
   * Why not 黄色ペイント（#f59e0b）で描画するか:
   * 日本の標識令（別表第6）において路面規制標示「最高速度（105）」の色彩は法定で「白」と定められており、
   * 進路変更禁止や追越し禁止の黄色実線と明確に識別できるよう白色溶融ペイント（white-paint）を適用する。
   */
  public createSpeedLimitRoadMarking(
    x: number,
    z: number,
    speedLimit = 40,
    rotationY = 0,
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = `SpeedMarkingGroup_${speedLimit}`;
    group.userData.markingType = "SpeedMarking";
    group.userData.speedLimit = speedLimit;
    group.userData.paintColor = "white";
    group.position.set(x, 0.025, z);
    group.rotation.y = rotationY;

    const hasDocument = typeof document !== "undefined";
    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 512;
      const ctx = canvas.getContext("2d");
      const hasCtx = Boolean(ctx);
      if (hasCtx) {
        ctx!.clearRect(0, 0, 256, 512);
        // 運転席からの俯角で正立・等比に見えるよう縦方向に引き伸ばした法定白色ペイント数字
        ctx!.save();
        ctx!.scale(1.0, 2.2);
        ctx!.fillStyle = "#f8fafc";
        ctx!.font = "bold 148px sans-serif";
        ctx!.textAlign = "center";
        ctx!.textBaseline = "middle";
        ctx!.fillText(`${speedLimit}`, 128, 116);
        ctx!.restore();
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshStandardMaterial({
        color: 0xf8fafc,
        emissive: 0xe2e8f0,
        emissiveIntensity: 0.42,
        map: tex,
        transparent: true,
        roughness: 0.46,
        metalness: 0.08,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      });
      this.applyRoadMarking3DTexture(mat, "white-paint");
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 4.2), mat);
      plane.name = "SpeedMarking_Plane";
      plane.userData.markingType = "SpeedMarking";
      plane.userData.paintColor = "white";
      plane.rotation.x = -Math.PI / 2;
      group.add(plane);
    } else {
      // SSR / テスト環境フォールバック（法定白色ペイント）
      const fallback = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 3.6), this.whitePaintMat);
      fallback.name = "SpeedMarking_FallbackPlane";
      fallback.userData.markingType = "SpeedMarking";
      fallback.userData.paintColor = "white";
      fallback.rotation.x = -Math.PI / 2;
      group.add(fallback);
    }

    return group;
  }

  /**
   * 指示標示: 「導流帯（ゼブラゾーン）」
   * How: 交差点手前の中央帯に白外枠（左右の実線）と斜めゼブラストライプを配置する。
   */
  public createZebraZoneMarking(width: number, length: number, zPosition: number): THREE.Group {
    const group = new THREE.Group();
    group.name = "ZebraZoneGroup";
    group.userData.markingType = "ZebraZone";
    group.position.set(0, 0.023, zPosition);

    const frameWidth = 0.14;
    const halfSpan = Math.max(0.22, width * 0.5 - frameWidth * 0.5);
    for (const sideSign of [-1, 1]) {
      const borderGeo = new THREE.PlaneGeometry(frameWidth, length);
      borderGeo.rotateX(-Math.PI / 2);
      const borderMesh = new THREE.Mesh(borderGeo, this.whitePaintMat);
      borderMesh.name = `ZebraZone_Border_${sideSign > 0 ? "Right" : "Left"}`;
      borderMesh.userData.markingType = "ZebraZone";
      borderMesh.position.set(sideSign * halfSpan, 0, 0);
      group.add(borderMesh);
    }

    const stripeStep = 1.6;
    const stripeCount = Math.max(2, Math.floor((length - 0.8) / stripeStep));
    const startZ = -((stripeCount - 1) * stripeStep) * 0.5;
    const stripeSpan = Math.max(0.32, width * 0.78);
    for (let i = 0; i < stripeCount; i++) {
      const z = startZ + i * stripeStep;
      const stripeGeo = new THREE.PlaneGeometry(stripeSpan, 0.26);
      stripeGeo.rotateX(-Math.PI / 2);
      const stripe = new THREE.Mesh(stripeGeo, this.whitePaintMat);
      stripe.name = "ZebraZone_Stripe";
      stripe.userData.markingType = "ZebraZone";
      stripe.position.set(0, 0, z);
      stripe.rotation.y = Math.PI / 6;
      group.add(stripe);
    }

    return group;
  }

  public getWhitePaintMaterial(): THREE.MeshStandardMaterial {
    return this.whitePaintMat;
  }

  /**
   * 渋谷スクランブル交差点の対角線X字型スクランブル横断歩道（斜め横断歩道）を構築する
   * How: 44m交差点フラットパッドの対角線（北東-南西、北西-南東）に沿って、
   * 3Dボリュームテクスチャ（white-paint）適用済みの白色PBRマテリアルによる斜めゼブラストライプを整然と展開する。
   */
  public createScrambleDiagonalCrosswalks(
    padSize = 44,
    stripeLength = 4.2,
    stripeWidth = 0.45,
    stepDist = 1.1,
  ): THREE.Group {
    const scrambleInterGroup = new THREE.Group();
    scrambleInterGroup.name = "ShibuyaScrambleDiagonalCrosswalks";
    scrambleInterGroup.userData.isRoadInfrastructure = true;
    scrambleInterGroup.position.set(0, 0, 0);

    const halfSpan = padSize * 0.42;
    const count = Math.floor(halfSpan / stepDist) * 2;

    for (const dir of [1, -1]) {
      const diagAngle = (dir * Math.PI) / 4;
      for (let i = -count / 2; i <= count / 2; i++) {
        const offset = i * stepDist;
        // Why stripeLength in X and stripeWidth in Z:
        // PlaneGeometry を rotateX(-PI/2) すると X が横幅、Z が縦長になる。
        // diagAngle で回転させると Z軸方向が対角線歩行方向と一致するため、
        // 歩行方向（Z）の厚みを stripeWidth (0.45m)、横断歩道の幅員（X）を stripeLength (4.2m) に設定することで、
        // 対角線歩行路上で各ストライプが重なり合わず、進行方向と直交する美しい 4.2m 幅のゼブラ帯を形成する。
        const stripeGeo = new THREE.PlaneGeometry(stripeLength, stripeWidth);
        stripeGeo.rotateX(-Math.PI / 2);
        stripeGeo.rotateY(diagAngle);
        const stripeMesh = new THREE.Mesh(stripeGeo, this.whitePaintMat);
        stripeMesh.name = `ScrambleDiagonalStripe_${dir > 0 ? "NE_SW" : "NW_SE"}_${i}`;
        stripeMesh.userData.markingType = "CrosswalkStripe";
        stripeMesh.userData.stripeLength = stripeLength;
        stripeMesh.userData.stripeWidth = stripeWidth;
        stripeMesh.userData.diagonalDir = dir;
        stripeMesh.userData.stripeIndex = i;
        stripeMesh.position.set(offset * Math.cos(diagAngle), 0, offset * Math.sin(diagAngle));
        stripeMesh.receiveShadow = true;
        scrambleInterGroup.add(stripeMesh);
      }
    }
    return scrambleInterGroup;
  }

  /**
   * 指示標示（111 / 206）: 「交差点内の進行方向別通行区分・右折直進誘導破線（ドットライン＆横断歩道標示）」
   * How: 交差点パッドの4方向接続口に横断歩道（ゼブラストライプ＋進行方向片側停止線）を配置し、
   * 横断歩道同士が交差点四隅で絶対に重ならないよう対向方向の横断歩道内縁より内側へスパンを制限する。
   * また交差点内のガイドドットは主幹方向のみに引き、縦横の破線が格子状（#）に交差・重複するのを防ぐ。
   */
  public createIntersectionMarkings(
    widthX: number,
    depthZ: number,
    options: {
      lanesX?: number; // 南北道路（X方向幅）の片側車線数
      lanesZ?: number; // 東西道路（Z方向奥行）の片側車線数
      hasCrosswalks?: boolean;
      hasCenterDiamond?: boolean;
      crosswalkN?: boolean;
      crosswalkS?: boolean;
      crosswalkE?: boolean;
      crosswalkW?: boolean;
      hasGuideDots?: boolean;
    } = {},
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = "IntersectionMarkings";
    group.position.y = 0.022;

    const lanesX = options.lanesX ?? (widthX >= 28 ? 3 : widthX >= 20 ? 2 : 1);
    const lanesZ = options.lanesZ ?? (depthZ >= 28 ? 3 : depthZ >= 20 ? 2 : 1);
    const hasCrosswalks = options.hasCrosswalks ?? true;
    const hasGuideDots = options.hasGuideDots ?? true;
    const hasCenterDiamond = options.hasCenterDiamond ?? (lanesX >= 2 && lanesZ >= 2);

    const halfW = widthX * 0.5;
    const halfD = depthZ * 0.5;
    const cwDepth = 3.0; // 横断歩道奥行き 3.0m
    const stripeW = 0.45;
    const stripeGap = 0.45;
    const step = stripeW + stripeGap;

    const laneWidthX = lanesX >= 2 ? 3.5 : 3.25;
    const laneWidthZ = lanesZ >= 2 ? 3.5 : 3.25;
    const carriagewayWidthX = lanesX * 2 * laneWidthX;
    const carriagewayWidthZ = lanesZ * 2 * laneWidthZ;

    // 横断歩道中心の交差点端からの配置位置（外側に左側通行の停止線 + クリアランスが収まるよう端から余裕を確保）
    const zEdgeOffset = Math.max(3.2, halfD - cwDepth * 0.5 - 1.35);
    const xEdgeOffset = Math.max(3.2, halfW - cwDepth * 0.5 - 1.35);

    // 東西横断歩道の内側縁（|x| = xEdgeOffset - cwDepth * 0.5）および南北車道幅の両方から 0.65m 以上のクリアランスを確保
    const maxSafeNsHalfSpan = Math.min(
      carriagewayWidthX * 0.5 - 0.45,
      xEdgeOffset - cwDepth * 0.5 - 0.65,
    );
    const maxSafeEwHalfSpan = Math.min(
      carriagewayWidthZ * 0.5 - 0.45,
      zEdgeOffset - cwDepth * 0.5 - 0.65,
    );

    if (hasCrosswalks) {
      // 1. 南北端（+Z / -Z 側）の横断歩道（X方向にストライプが並ぶ）＋ 左側通行進入車線の停止線（指示標示 203）
      const nsSpan = Math.max(2.7, maxSafeNsHalfSpan * 2);
      const nsCount = Math.max(2, Math.floor((nsSpan + stripeGap) / step));
      const nsTotalSpan = nsCount * stripeW + (nsCount - 1) * stripeGap;
      const nsStartX = -nsTotalSpan * 0.5 + stripeW * 0.5;
      const nsHalfStopSpan = Math.max(
        1.5,
        Math.min(carriagewayWidthX * 0.5, maxSafeNsHalfSpan) - 0.5,
      );
      const nsStopCenterX = 0.25 + nsHalfStopSpan * 0.5;

      for (const zSign of [-1, 1]) {
        const isSouthEnabled = zSign < 0 && (options.crosswalkS ?? true);
        const isNorthEnabled = zSign > 0 && (options.crosswalkN ?? true);
        const shouldDrawNS = isSouthEnabled || isNorthEnabled;
        if (!shouldDrawNS) {
          continue;
        }
        const cwZ = zSign * zEdgeOffset;
        for (let i = 0; i < nsCount; i++) {
          const sx = nsStartX + i * step;
          const geo = new THREE.PlaneGeometry(stripeW, cwDepth);
          geo.rotateX(-Math.PI / 2);
          const mesh = new THREE.Mesh(geo, this.whitePaintMat);
          mesh.name = `IntersectionCrosswalk_NS_${zSign > 0 ? "North" : "South"}`;
          mesh.userData.markingType = "IntersectionCrosswalkNS";
          mesh.position.set(sx, 0, cwZ);
          group.add(mesh);
        }

        // 左側通行の交差点停止線（指示標示 203：幅 0.35m）
        // 南側横断歩道（zSign < 0）には +Z 進行（x > 0）、北側横断歩道（zSign > 0）には -Z 進行（x < 0）の進入車線手前に配置
        const stopLineZ = zSign * (zEdgeOffset + cwDepth * 0.5 + 0.65);
        const isStopWithinPadZ = Math.abs(stopLineZ) + 0.22 <= halfD;
        if (isStopWithinPadZ) {
          const stopGeo = new THREE.PlaneGeometry(nsHalfStopSpan, 0.35);
          stopGeo.rotateX(-Math.PI / 2);
          const stopMesh = new THREE.Mesh(stopGeo, this.whitePaintMat);
          stopMesh.name = `IntersectionStopLine_NS_${zSign > 0 ? "NorthOncoming" : "SouthInbound"}`;
          stopMesh.userData.markingType = "IntersectionStopLine";
          stopMesh.position.set(zSign < 0 ? nsStopCenterX : -nsStopCenterX, 0, stopLineZ);
          group.add(stopMesh);
        }
      }

      // 2. 東西端（+X / -X 側）の横断歩道（Z方向にストライプが並ぶ）＋ 左側通行進入車線の停止線（指示標示 203）
      const ewSpan = Math.max(2.7, maxSafeEwHalfSpan * 2);
      const ewCount = Math.max(2, Math.floor((ewSpan + stripeGap) / step));
      const ewTotalSpan = ewCount * stripeW + (ewCount - 1) * stripeGap;
      const ewStartZ = -ewTotalSpan * 0.5 + stripeW * 0.5;
      const ewHalfStopSpan = Math.max(
        1.5,
        Math.min(carriagewayWidthZ * 0.5, maxSafeEwHalfSpan) - 0.5,
      );
      const ewStopCenterZ = 0.25 + ewHalfStopSpan * 0.5;

      for (const xSign of [-1, 1]) {
        const isWestEnabled = xSign < 0 && (options.crosswalkW ?? true);
        const isEastEnabled = xSign > 0 && (options.crosswalkE ?? true);
        const shouldDrawEW = isWestEnabled || isEastEnabled;
        if (!shouldDrawEW) {
          continue;
        }
        const cwX = xSign * xEdgeOffset;
        for (let i = 0; i < ewCount; i++) {
          const sz = ewStartZ + i * step;
          const geo = new THREE.PlaneGeometry(cwDepth, stripeW);
          geo.rotateX(-Math.PI / 2);
          const mesh = new THREE.Mesh(geo, this.whitePaintMat);
          mesh.name = `IntersectionCrosswalk_EW_${xSign > 0 ? "East" : "West"}`;
          mesh.userData.markingType = "IntersectionCrosswalkEW";
          mesh.position.set(cwX, 0, sz);
          group.add(mesh);
        }

        // 左側通行の東西進入停止線：西側横断歩道（xSign < 0, +X 進行）は左側（z < 0）、東側横断歩道（xSign > 0, -X 進行）は左側（z > 0）
        const stopLineX = xSign * (xEdgeOffset + cwDepth * 0.5 + 0.65);
        const isStopWithinPadX = Math.abs(stopLineX) + 0.22 <= halfW;
        if (isStopWithinPadX) {
          const stopGeo = new THREE.PlaneGeometry(0.35, ewHalfStopSpan);
          stopGeo.rotateX(-Math.PI / 2);
          const stopMesh = new THREE.Mesh(stopGeo, this.whitePaintMat);
          stopMesh.name = `IntersectionStopLine_EW_${xSign > 0 ? "EastWestbound" : "WestEastbound"}`;
          stopMesh.userData.markingType = "IntersectionStopLine";
          stopMesh.position.set(stopLineX, 0, xSign < 0 ? -ewStopCenterZ : ewStopCenterZ);
          group.add(stopMesh);
        }
      }
    }

    // 3. 交差点内の直進車線誘導ドット破線（Keystone / ガイドライン：長さ 0.9m, 幅 0.15m, 間隔 2.8m）
    // Why 南北・東西の両方にドット破線を格子状（#）に引かず主幹道路方向のみに限定するか:
    // 交差点内で縦横両方向の破線を同時に引くと、車線境界線が交差点内で十字に交差して視覚的ノイズ・標示重複を生むため。
    // また横断歩道内縁から 1.4m 以上内側、かつ中央ダイヤマーク（|z|, |x| <= 1.6m）を除外した区間のみに配置する。
    const safeInnerHalfZ = Math.max(0, zEdgeOffset - cwDepth * 0.5 - 1.4);
    const safeInnerHalfX = Math.max(0, xEdgeOffset - cwDepth * 0.5 - 1.4);
    const dotLen = 0.9;
    const dotStep = 2.8;
    const centerDiamondClearance = hasCenterDiamond ? 1.6 : 0.4;

    const isPrimaryNS = lanesX >= lanesZ;
    if (hasGuideDots && isPrimaryNS && lanesX >= 2 && safeInnerHalfZ >= 2.2) {
      const xOffsets = [-laneWidthX, laneWidthX];
      for (const lx of xOffsets) {
        const isWithinEwClearance = Math.abs(lx) <= safeInnerHalfX;
        if (!isWithinEwClearance) {
          continue;
        }
        for (
          let z = -safeInnerHalfZ + dotLen * 0.5;
          z <= safeInnerHalfZ - dotLen * 0.5;
          z += dotStep
        ) {
          const isNearCenter = Math.abs(z) < centerDiamondClearance;
          if (isNearCenter) {
            continue;
          }
          const dotGeo = new THREE.PlaneGeometry(0.15, dotLen);
          dotGeo.rotateX(-Math.PI / 2);
          const dotMesh = new THREE.Mesh(dotGeo, this.whitePaintMat);
          dotMesh.name = "IntersectionGuideDot_NS";
          dotMesh.userData.markingType = "IntersectionGuideDot";
          dotMesh.position.set(lx, -0.001, z);
          group.add(dotMesh);
        }
      }
    } else if (hasGuideDots && !isPrimaryNS && lanesZ >= 2 && safeInnerHalfX >= 2.2) {
      const zOffsets = [-laneWidthZ, laneWidthZ];
      for (const lz of zOffsets) {
        const isWithinNsClearance = Math.abs(lz) <= safeInnerHalfZ;
        if (!isWithinNsClearance) {
          continue;
        }
        for (
          let x = -safeInnerHalfX + dotLen * 0.5;
          x <= safeInnerHalfX - dotLen * 0.5;
          x += dotStep
        ) {
          const isNearCenter = Math.abs(x) < centerDiamondClearance;
          if (isNearCenter) {
            continue;
          }
          const dotGeo = new THREE.PlaneGeometry(dotLen, 0.15);
          dotGeo.rotateX(-Math.PI / 2);
          const dotMesh = new THREE.Mesh(dotGeo, this.whitePaintMat);
          dotMesh.name = "IntersectionGuideDot_EW";
          dotMesh.userData.markingType = "IntersectionGuideDot";
          dotMesh.position.set(x, -0.001, lz);
          group.add(dotMesh);
        }
      }
    }

    // 4. 幹線交差点の中央右折ガイドマーク（日本の主要交差点にある中心ひし形 ◇）
    // Why diamondAngles を [-Math.PI / 4, Math.PI / 4, Math.PI / 4, -Math.PI / 4] にするか:
    // PlaneGeometry を rotateX(-Math.PI / 2) した後に Y軸回転を掛ける際、
    // 符号が逆だと 4 本の辺が外周のひし形（◇）ではなく中心で交差する「×」になってしまうため。
    if (hasCenterDiamond) {
      const dSize = 1.35;
      const dThick = 0.2;
      const diamondAngles = [-Math.PI / 4, Math.PI / 4, Math.PI / 4, -Math.PI / 4];
      const diamondPos = [
        { x: -0.45, z: -0.45 },
        { x: 0.45, z: -0.45 },
        { x: -0.45, z: 0.45 },
        { x: 0.45, z: 0.45 },
      ];
      for (let i = 0; i < 4; i++) {
        const barGeo = new THREE.PlaneGeometry(dThick, dSize);
        barGeo.rotateX(-Math.PI / 2);
        const bar = new THREE.Mesh(barGeo, this.whitePaintMat);
        bar.name = "IntersectionCenterDiamond_Edge";
        bar.userData.markingType = "IntersectionCenterDiamond";
        bar.position.set(diamondPos[i].x, 0.001, diamondPos[i].z);
        bar.rotation.y = diamondAngles[i];
        group.add(bar);
      }
    }

    return group;
  }
}

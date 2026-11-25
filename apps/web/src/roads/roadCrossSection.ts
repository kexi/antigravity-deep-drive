import * as THREE from "three";
import type {
  IntersectionArmSpec,
  JapaneseIntersectionConfig,
  JapaneseRoadSegmentConfig,
  RoadExclusionBox,
  RoadExclusionCorridor,
} from "./types";

export interface RoadFrame {
  pos: THREE.Vector3;
  tangent: THREE.Vector3;
  normal: THREE.Vector3; // +tangent 右手系における左側方向 (+X 相当)
  arcLen: number;
}

export interface SidewalkSideSpec {
  totalWidth: number;
  curbWidth: number;
  curbInner: number;
  curbOuter: number;
  walkInner: number;
  walkOuter: number;
  walkSurfaceWidth: number;
  backEdgeHeight: number;
}

export interface RoadCrossSectionSpec {
  medianWidth: number;
  halfMedian: number;
  carriagewayHalfWidth: number;
  halfDriveable: number;
  driveableWidth: number;
  gutterWidth: number;
  curbWidth: number;
  curbHeight: number;
  curbBevelWidth: number;
  curbBevelHeight: number;
  sidewalkCrossSlope: number;
  left: SidewalkSideSpec;
  right: SidewalkSideSpec;
}

export interface CrosswalkRampZone {
  center: number;
  halfWidth?: number;
  transitionLength?: number;
}

export interface PerSideIntervalParams {
  frames: ReadonlyArray<RoadFrame>;
  totalSplineLength: number;
  sideSign: -1 | 1;
  innerOffset: number;
  outerOffset: number;
  exclusionCorridors?: ReadonlyArray<RoadExclusionCorridor>;
  exclusionBoxes?: ReadonlyArray<RoadExclusionBox>;
  exclusionZones?: ReadonlyArray<{ x: number; z: number; radius: number }>;
  fallbackStartTrim?: number;
  fallbackEndTrim?: number;
  minSpanLength?: number;
}

export interface CornerColliderSpec {
  cx: number;
  cz: number;
  halfX: number;
  halfZ: number;
}

export interface IntersectionSidewalkMaterials {
  sidewalkMaterial: THREE.Material;
  curbMaterial: THREE.Material;
  gutterMaterial: THREE.Material;
  brailleMaterial: THREE.Material;
}

export interface IntersectionSidewalkOutput {
  group: THREE.Group;
  cornerColliders: CornerColliderSpec[];
}

const DEFAULT_RAMP_LOW_HEIGHT = 0.02;
const DEFAULT_RAMP_HALF_WIDTH = 2.2;
const DEFAULT_RAMP_TRANSITION = 1.2;

function buildSideSpec(
  rawTotalWidth: number,
  halfDriveable: number,
  maxCurbWidth: number,
  curbHeight: number,
  crossSlope: number,
): SidewalkSideSpec {
  const totalWidth = Math.max(0, rawTotalWidth);
  const hasSidewalk = totalWidth > 0.05;
  if (!hasSidewalk) {
    return {
      totalWidth: 0,
      curbWidth: 0,
      curbInner: halfDriveable,
      curbOuter: halfDriveable,
      walkInner: halfDriveable,
      walkOuter: halfDriveable,
      walkSurfaceWidth: 0,
      backEdgeHeight: curbHeight,
    };
  }

  const curbWidth = Math.min(maxCurbWidth, totalWidth * 0.4);
  const curbInner = halfDriveable;
  const curbOuter = halfDriveable + curbWidth;
  const walkInner = curbOuter;
  const walkOuter = halfDriveable + totalWidth;
  const walkSurfaceWidth = Math.max(0, walkOuter - walkInner);
  const backEdgeHeight = curbHeight + walkSurfaceWidth * crossSlope;

  return {
    totalWidth,
    curbWidth,
    curbInner,
    curbOuter,
    walkInner,
    walkOuter,
    walkSurfaceWidth,
    backEdgeHeight,
  };
}

/**
 * 道路構造令準拠の統一道路断面（中央分離帯・車線・路肩・L型側溝・面取り縁石・排水勾配付き歩道）を算出する
 */
export function computeRoadCrossSection(config: JapaneseRoadSegmentConfig): RoadCrossSectionSpec {
  const medianWidth = Math.max(0, config.medianWidth ?? 0);
  const halfMedian = medianWidth * 0.5;
  const lanesPerDir = Math.max(1, config.lanesPerDirection);
  const carriagewayHalfWidth = halfMedian + lanesPerDir * config.laneWidth;
  const halfDriveable = carriagewayHalfWidth + config.shoulderWidth;
  const driveableWidth = halfDriveable * 2;

  const gutterWidth = Math.min(0.32, Math.max(0.2, config.shoulderWidth * 0.35));
  const curbWidth = Math.min(0.22, Math.max(0.15, config.curbWidth ?? 0.2));
  const curbHeight = Math.max(0.05, config.curbHeight);
  const curbBevelWidth = 0.045;
  const curbBevelHeight = 0.045;
  const sidewalkCrossSlope = config.sidewalkCrossSlope ?? 0.015;

  const leftRaw = config.leftSidewalkWidth ?? config.sidewalkWidth;
  const rightRaw = config.rightSidewalkWidth ?? config.sidewalkWidth;

  return {
    medianWidth,
    halfMedian,
    carriagewayHalfWidth,
    halfDriveable,
    driveableWidth,
    gutterWidth,
    curbWidth,
    curbHeight,
    curbBevelWidth,
    curbBevelHeight,
    sidewalkCrossSlope,
    left: buildSideSpec(leftRaw, halfDriveable, curbWidth, curbHeight, sidewalkCrossSlope),
    right: buildSideSpec(rightRaw, halfDriveable, curbWidth, curbHeight, sidewalkCrossSlope),
  };
}

export function getSideCrossSection(
  spec: RoadCrossSectionSpec,
  sideSign: -1 | 1,
): SidewalkSideSpec {
  const isLeftSide = sideSign > 0;
  return isLeftSide ? spec.left : spec.right;
}

/**
 * 横断歩道接続部における縁石切下げ高さ（道路移動等円滑化基準: 2cm 段差 + すりつけ区間）を評価する
 */
export function evaluateCurbRampHeight(
  arc: number,
  curbHeight: number,
  rampZones: ReadonlyArray<CrosswalkRampZone> = [],
): number {
  const hasNoRamps = rampZones.length === 0;
  if (hasNoRamps) {
    return curbHeight;
  }

  const rampLow = Math.min(DEFAULT_RAMP_LOW_HEIGHT, curbHeight);
  let resolvedHeight = curbHeight;

  for (const zone of rampZones) {
    const halfW = zone.halfWidth ?? DEFAULT_RAMP_HALF_WIDTH;
    const trans = zone.transitionLength ?? DEFAULT_RAMP_TRANSITION;
    const dist = Math.abs(arc - zone.center);
    const isFlatRampCore = dist <= halfW;
    if (isFlatRampCore) {
      resolvedHeight = Math.min(resolvedHeight, rampLow);
      continue;
    }

    const isInsideTransition = dist < halfW + trans && trans > 0.01;
    if (isInsideTransition) {
      const t = (dist - halfW) / trans;
      const smooth = t * t * (3 - 2 * t);
      const slopedHeight = rampLow + (curbHeight - rampLow) * smooth;
      resolvedHeight = Math.min(resolvedHeight, slopedHeight);
    }
  }

  return resolvedHeight;
}

/**
 * 指定アーク長範囲に対して、ベース分割刻みと横断歩道切下げスロープ境界点を統合した駅点列を生成する
 */
export function buildStationsWithRamps(
  arcStart: number,
  arcEnd: number,
  baseStep: number,
  rampZones: ReadonlyArray<CrosswalkRampZone> = [],
): number[] {
  const span = arcEnd - arcStart;
  const isInvalidSpan = span <= 0.01;
  if (isInvalidSpan) {
    return [];
  }

  const safeStep = Math.max(0.5, baseStep);
  const steps = Math.max(1, Math.ceil(span / safeStep));
  const rawStations: number[] = [];

  for (let i = 0; i <= steps; i++) {
    rawStations.push(arcStart + (span * i) / steps);
  }

  for (const zone of rampZones) {
    const halfW = zone.halfWidth ?? DEFAULT_RAMP_HALF_WIDTH;
    const trans = zone.transitionLength ?? DEFAULT_RAMP_TRANSITION;
    const candidates = [
      zone.center - halfW - trans,
      zone.center - halfW - trans * 0.5,
      zone.center - halfW,
      zone.center,
      zone.center + halfW,
      zone.center + halfW + trans * 0.5,
      zone.center + halfW + trans,
    ];
    for (const pt of candidates) {
      const isInsideSpan = pt > arcStart + 0.02 && pt < arcEnd - 0.02;
      if (isInsideSpan) {
        rawStations.push(pt);
      }
    }
  }

  rawStations.sort((a, b) => a - b);

  const deduped: number[] = [arcStart];
  for (let i = 0; i < rawStations.length; i++) {
    const val = rawStations[i];
    const isNearStart = val - arcStart < 0.04;
    const isNearEnd = arcEnd - val < 0.04;
    if (isNearStart || isNearEnd) {
      continue;
    }
    const last = deduped[deduped.length - 1];
    const isDistinct = val - last >= 0.04;
    if (isDistinct) {
      deduped.push(val);
    }
  }
  deduped.push(arcEnd);

  return deduped;
}

/**
 * 直線道路セグメント用の共通 RoadFrame 列を生成する（tangent=+Z, normal=+X, arcLen=z）
 */
export function buildStraightRoadFrames(stations: ReadonlyArray<number>): RoadFrame[] {
  const tangent = new THREE.Vector3(0, 0, 1);
  const normal = new THREE.Vector3(1, 0, 0);
  return stations.map((z) => ({
    pos: new THREE.Vector3(0, 0, z),
    tangent: tangent.clone(),
    normal: normal.clone(),
    arcLen: z,
  }));
}

function appendFaceStripQuad(
  positions: number[],
  uvs: number[],
  indices: number[],
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
  p3: [number, number, number],
  u0: number,
  u1: number,
  v0: number,
  v1: number,
): void {
  const baseIdx = positions.length / 3;
  positions.push(...p0, ...p1, ...p2, ...p3);
  uvs.push(u0, v0, u1, v0, u0, v1, u1, v1);
  indices.push(baseIdx, baseIdx + 2, baseIdx + 1, baseIdx + 1, baseIdx + 2, baseIdx + 3);
}

function framePoint(
  f: RoadFrame,
  lateralOffset: number,
  y: number,
  elevationSampler?: (x: number, z: number) => number,
): [number, number, number] {
  const px = f.pos.x + f.normal.x * lateralOffset;
  const pz = f.pos.z + f.normal.z * lateralOffset;
  const groundY = elevationSampler ? elevationSampler(px, pz) : f.pos.y;
  return [px, groundY + y, pz];
}

/**
 * 車道外縁に沿う L 型側溝（コンクリート帯）リボンジオメトリを生成する
 * How: sideSign に依らず offMin < offMax へ正規化することで、両側とも厳密に +Y 上向き法線となる。
 */
export function buildLGutterRibbonGeometry(
  frames: ReadonlyArray<RoadFrame>,
  sideSign: -1 | 1,
  crossSection: RoadCrossSectionSpec,
  baseY: number,
  elevationSampler?: (x: number, z: number) => number,
): THREE.BufferGeometry {
  const hasTooFewFrames = frames.length < 2 || crossSection.gutterWidth <= 0.01;
  if (hasTooFewFrames) {
    return new THREE.BufferGeometry();
  }

  const rawA = sideSign * (crossSection.halfDriveable - crossSection.gutterWidth);
  const rawB = sideSign * crossSection.halfDriveable;
  const offMin = Math.min(rawA, rawB);
  const offMax = Math.max(rawA, rawB);
  const gutterY = baseY + 0.004;

  const n = frames.length;
  const positions = new Float32Array(n * 2 * 3);
  const normals = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  const indices: number[] = [];

  for (let i = 0; i < n; i++) {
    const f = frames[i];
    const vIdx = i * 6;
    const minX = f.pos.x + f.normal.x * offMin;
    const minZ = f.pos.z + f.normal.z * offMin;
    const maxX = f.pos.x + f.normal.x * offMax;
    const maxZ = f.pos.z + f.normal.z * offMax;
    const minY = (elevationSampler ? elevationSampler(minX, minZ) : f.pos.y) + gutterY;
    const maxY = (elevationSampler ? elevationSampler(maxX, maxZ) : f.pos.y) + gutterY;
    positions[vIdx] = minX;
    positions[vIdx + 1] = minY;
    positions[vIdx + 2] = minZ;
    positions[vIdx + 3] = maxX;
    positions[vIdx + 4] = maxY;
    positions[vIdx + 5] = maxZ;

    normals[vIdx] = 0;
    normals[vIdx + 1] = 1;
    normals[vIdx + 2] = 0;
    normals[vIdx + 3] = 0;
    normals[vIdx + 4] = 1;
    normals[vIdx + 5] = 0;

    const uvIdx = i * 4;
    uvs[uvIdx] = 0;
    uvs[uvIdx + 1] = f.arcLen;
    uvs[uvIdx + 2] = 1;
    uvs[uvIdx + 3] = f.arcLen;

    const hasNext = i < n - 1;
    if (hasNext) {
      const a = i * 2;
      const b = i * 2 + 1;
      const c = (i + 1) * 2;
      const d = (i + 1) * 2 + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geom.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  if (elevationSampler) {
    geom.computeVertexNormals();
  }
  geom.computeBoundingSphere();
  return geom;
}

/**
 * 面取り（ベベル）＆横断歩道切下げスロープ付き 3D 縁石ジオメトリを生成する
 * How: 横断面（n, y）を必ず時計回りに定義して各面を分離出力することで、
 * sideSign = +1 / -1 の双方で外向き法線とシャープな稜線およびメートル UV を保証する。
 */
export function buildProfiledCurbRibbonGeometry(
  frames: ReadonlyArray<RoadFrame>,
  sideSign: -1 | 1,
  crossSection: RoadCrossSectionSpec,
  baseY: number,
  rampZones: ReadonlyArray<CrosswalkRampZone> = [],
  elevationSampler?: (x: number, z: number) => number,
): THREE.BufferGeometry {
  const sideSpec = getSideCrossSection(crossSection, sideSign);
  const hasInvalidInput = frames.length < 2 || sideSpec.curbWidth <= 0.01;
  if (hasInvalidInput) {
    return new THREE.BufferGeometry();
  }

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const getProfilePoints = (arcLen: number): Array<[number, number]> => {
    const h = evaluateCurbRampHeight(arcLen, crossSection.curbHeight, rampZones);
    const bw = Math.min(crossSection.curbBevelWidth, sideSpec.curbWidth * 0.35, h * 0.55);
    const bh = Math.min(crossSection.curbBevelHeight, h * 0.45);
    const inner = sideSign * sideSpec.curbInner;
    const outer = sideSign * sideSpec.curbOuter;

    const isPositiveNormalSide = sideSign > 0;
    if (isPositiveNormalSide) {
      return [
        [inner, baseY],
        [inner, baseY + h - bh],
        [inner + bw, baseY + h],
        [outer, baseY + h],
        [outer, baseY],
      ];
    }

    // -normal 側は nMin (outer) -> nMax (inner) の時計回り順で外向き法線を維持する
    return [
      [outer, baseY],
      [outer, baseY + h],
      [inner - bw, baseY + h],
      [inner, baseY + h - bh],
      [inner, baseY],
    ];
  };

  for (let i = 0; i < frames.length - 1; i++) {
    const f0 = frames[i];
    const f1 = frames[i + 1];
    const pts0 = getProfilePoints(f0.arcLen);
    const pts1 = getProfilePoints(f1.arcLen);
    const v0 = f0.arcLen;
    const v1 = f1.arcLen;

    for (let edge = 0; edge < pts0.length - 1; edge++) {
      const p0 = framePoint(f0, pts0[edge][0], pts0[edge][1], elevationSampler);
      const p1 = framePoint(f0, pts0[edge + 1][0], pts0[edge + 1][1], elevationSampler);
      const p2 = framePoint(f1, pts1[edge][0], pts1[edge][1], elevationSampler);
      const p3 = framePoint(f1, pts1[edge + 1][0], pts1[edge + 1][1], elevationSampler);
      const u0 = edge / (pts0.length - 1);
      const u1 = (edge + 1) / (pts0.length - 1);
      appendFaceStripQuad(positions, uvs, indices, p0, p1, p2, p3, u0, u1, v0, v1);
    }
  }

  // 始端木口 (-tangent 向き)・終端木口 (+tangent 向き)
  const appendCap = (f: RoadFrame, isStartCap: boolean): void => {
    const pts = getProfilePoints(f.arcLen);
    // pts は時計回り: [0]=(nMin, baseY), [1]=(nMin, hL), [2]=(nMid, hM), [3]=(nMax, hR), [4]=(nMax, baseY)
    const v = pts.map(([off, y]) => framePoint(f, off, y, elevationSampler));
    const baseIdx = positions.length / 3;
    for (const pt of v) {
      positions.push(...pt);
    }
    uvs.push(0, 0, 0, 1, 0.3, 1, 1, 1, 1, 0);
    if (isStartCap) {
      indices.push(
        baseIdx,
        baseIdx + 1,
        baseIdx + 2,
        baseIdx,
        baseIdx + 2,
        baseIdx + 3,
        baseIdx,
        baseIdx + 3,
        baseIdx + 4,
      );
    } else {
      indices.push(
        baseIdx,
        baseIdx + 2,
        baseIdx + 1,
        baseIdx,
        baseIdx + 3,
        baseIdx + 2,
        baseIdx,
        baseIdx + 4,
        baseIdx + 3,
      );
    }
  };

  appendCap(frames[0], true);
  appendCap(frames[frames.length - 1], false);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geom.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  return geom;
}

/**
 * 1.5%排水勾配＆横断歩道切下げすりつけスロープ付き 3D 歩道舗装スラブジオメトリを生成する
 * How: 天面 UV は縁石際を u=0 として歩道幅方向・延長方向を実寸メートルで格納し、舗装目地を正確に整列させる。
 */
export function buildProfiledSidewalkRibbonGeometry(
  frames: ReadonlyArray<RoadFrame>,
  sideSign: -1 | 1,
  crossSection: RoadCrossSectionSpec,
  baseY: number,
  rampZones: ReadonlyArray<CrosswalkRampZone> = [],
  elevationSampler?: (x: number, z: number) => number,
): THREE.BufferGeometry {
  const sideSpec = getSideCrossSection(crossSection, sideSign);
  const hasInvalidInput = frames.length < 2 || sideSpec.walkSurfaceWidth <= 0.05;
  if (hasInvalidInput) {
    return new THREE.BufferGeometry();
  }

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const isPositiveNormalSide = sideSign > 0;
  const nMin = isPositiveNormalSide ? sideSpec.walkInner : -sideSpec.walkOuter;
  const nMax = isPositiveNormalSide ? sideSpec.walkOuter : -sideSpec.walkInner;
  const surfW = sideSpec.walkSurfaceWidth;

  const getHeights = (arcLen: number): { hMin: number; hMax: number } => {
    const innerH = evaluateCurbRampHeight(arcLen, crossSection.curbHeight, rampZones);
    const outerH = sideSpec.backEdgeHeight;
    return isPositiveNormalSide
      ? { hMin: baseY + innerH, hMax: baseY + outerH }
      : { hMin: baseY + outerH, hMax: baseY + innerH };
  };

  for (let i = 0; i < frames.length - 1; i++) {
    const f0 = frames[i];
    const f1 = frames[i + 1];
    const h0 = getHeights(f0.arcLen);
    const h1 = getHeights(f1.arcLen);
    const v0 = f0.arcLen;
    const v1 = f1.arcLen;

    const tl0 = framePoint(f0, nMin, h0.hMin, elevationSampler);
    const tr0 = framePoint(f0, nMax, h0.hMax, elevationSampler);
    const bl0 = framePoint(f0, nMin, baseY, elevationSampler);
    const br0 = framePoint(f0, nMax, baseY, elevationSampler);
    const tl1 = framePoint(f1, nMin, h1.hMin, elevationSampler);
    const tr1 = framePoint(f1, nMax, h1.hMax, elevationSampler);
    const bl1 = framePoint(f1, nMin, baseY, elevationSampler);
    const br1 = framePoint(f1, nMax, baseY, elevationSampler);

    // 縁石側 (uCurb = 0) -> 建物側 (uCurb = surfW) のメートル UV
    const uMin = isPositiveNormalSide ? 0 : surfW;
    const uMax = isPositiveNormalSide ? surfW : 0;

    // 天面 (+Y)
    appendFaceStripQuad(positions, uvs, indices, tl0, tr0, tl1, tr1, uMin, uMax, v0, v1);
    // -normal 側壁
    appendFaceStripQuad(positions, uvs, indices, bl0, tl0, bl1, tl1, 0, 1, v0, v1);
    // +normal 側壁
    appendFaceStripQuad(positions, uvs, indices, tr0, br0, tr1, br1, 0, 1, v0, v1);
  }

  // 始端・終端木口蓋
  const appendCap = (f: RoadFrame, isStartCap: boolean): void => {
    const h = getHeights(f.arcLen);
    const bl = framePoint(f, nMin, baseY, elevationSampler);
    const tl = framePoint(f, nMin, h.hMin, elevationSampler);
    const tr = framePoint(f, nMax, h.hMax, elevationSampler);
    const br = framePoint(f, nMax, baseY, elevationSampler);
    const baseIdx = positions.length / 3;
    positions.push(...bl, ...tl, ...tr, ...br);
    uvs.push(0, 0, 0, 1, 1, 1, 1, 0);
    if (isStartCap) {
      indices.push(baseIdx, baseIdx + 1, baseIdx + 2, baseIdx, baseIdx + 2, baseIdx + 3);
    } else {
      indices.push(baseIdx, baseIdx + 2, baseIdx + 1, baseIdx, baseIdx + 3, baseIdx + 2);
    }
  };

  appendCap(frames[0], true);
  appendCap(frames[frames.length - 1], false);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geom.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  return geom;
}

function minDistanceSqToPointSequence(
  px: number,
  pz: number,
  pts: ReadonlyArray<{ x: number; z: number }>,
): number {
  let minSq = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lenSq = dx * dx + dz * dz;
    const hasLength = lenSq > 1e-8;
    const t = hasLength ? Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / lenSq)) : 0;
    const cx = a.x + dx * t;
    const cz = a.z + dz * t;
    const distSq = (px - cx) ** 2 + (pz - cz) ** 2;
    if (distSq < minSq) {
      minSq = distSq;
    }
  }
  return minSq;
}

function interpolateFrameFromList(frames: ReadonlyArray<RoadFrame>, targetArc: number): RoadFrame {
  const first = frames[0];
  const last = frames[frames.length - 1];
  const clamped = Math.max(first.arcLen, Math.min(last.arcLen, targetArc));
  let low = 0;
  let high = frames.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (frames[mid].arcLen < clamped) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const idx0 = Math.max(0, low - 1);
  const idx1 = Math.min(frames.length - 1, low);
  if (idx0 === idx1) {
    return frames[idx0];
  }
  const f0 = frames[idx0];
  const f1 = frames[idx1];
  const span = f1.arcLen - f0.arcLen;
  const ratio = span > 0.0001 ? (clamped - f0.arcLen) / span : 0;

  return {
    pos: new THREE.Vector3().lerpVectors(f0.pos, f1.pos, ratio),
    tangent: new THREE.Vector3().lerpVectors(f0.tangent, f1.tangent, ratio).normalize(),
    normal: new THREE.Vector3().lerpVectors(f0.normal, f1.normal, ratio).normalize(),
    arcLen: clamped,
  };
}

/**
 * 片側（左 / 右）ごとに独立した歩道配置可能区間を幾何クリッピングで算出する
 * How:
 * - T字路等で片側のみ他道路が合流する場合、合流側だけを切り欠き反対側の歩道は連続維持する。
 * - 急カーブ内側（さくら坂ループ等）の法線交差（ボウタイ自己折返し）および自己ループ干渉を検出して除外する。
 */
export function computePerSideCorridorIntervals(
  params: PerSideIntervalParams,
): Array<{ start: number; end: number }> {
  const {
    frames,
    totalSplineLength,
    sideSign,
    innerOffset,
    outerOffset,
    exclusionCorridors = [],
    exclusionBoxes = [],
    exclusionZones = [],
    fallbackStartTrim = 0,
    fallbackEndTrim = 0,
    minSpanLength = 3.5,
  } = params;

  const hasInvalidInput = frames.length < 2 || outerOffset <= innerOffset;
  if (hasInvalidInput) {
    return [];
  }

  const hasGeometricExclusions =
    exclusionCorridors.length > 0 || exclusionBoxes.length > 0 || exclusionZones.length > 0;
  const maxArc = hasGeometricExclusions ? totalSplineLength : totalSplineLength - fallbackEndTrim;
  const minArc = hasGeometricExclusions ? 0 : fallbackStartTrim;

  const lateralProbes = [
    sideSign * innerOffset,
    sideSign * ((innerOffset + outerOffset) * 0.5),
    sideSign * outerOffset,
  ];

  // 急カーブ内側の法線交差（曲率半径 <= outerOffset）となるアーク区間を事前検出する
  const pinchArcs: number[] = [];
  for (let i = 0; i < frames.length - 1; i++) {
    const f0 = frames[i];
    const f1 = frames[i + 1];
    const outer0x = f0.pos.x + f0.normal.x * (sideSign * outerOffset);
    const outer0z = f0.pos.z + f0.normal.z * (sideSign * outerOffset);
    const outer1x = f1.pos.x + f1.normal.x * (sideSign * outerOffset);
    const outer1z = f1.pos.z + f1.normal.z * (sideSign * outerOffset);
    const prog = (outer1x - outer0x) * f0.tangent.x + (outer1z - outer0z) * f0.tangent.z;
    const isSelfCrossingFold = prog <= 0.05;
    if (isSelfCrossingFold) {
      pinchArcs.push((f0.arcLen + f1.arcLen) * 0.5);
    }
  }

  const isSidewalkArcBlocked = (arc: number): boolean => {
    const isNearCurvaturePinch = pinchArcs.some((pa) => Math.abs(arc - pa) < 3.0);
    if (isNearCurvaturePinch) {
      return true;
    }

    const f = interpolateFrameFromList(frames, arc);

    for (const latOff of lateralProbes) {
      const px = f.pos.x + f.normal.x * latOff;
      const pz = f.pos.z + f.normal.z * latOff;

      const isInsideZone = exclusionZones.some(
        (ez) => Math.hypot(px - ez.x, pz - ez.z) < ez.radius,
      );
      if (isInsideZone) {
        return true;
      }

      const isInsideBox = exclusionBoxes.some(
        (box) =>
          px >= box.minX - 0.15 &&
          px <= box.maxX + 0.15 &&
          pz >= box.minZ - 0.15 &&
          pz <= box.maxZ + 0.15,
      );
      if (isInsideBox) {
        return true;
      }

      for (const other of exclusionCorridors) {
        const minDistSq = minDistanceSqToPointSequence(px, pz, other.sampledPoints);
        const safeThreshold = other.halfWidth + 0.25;
        if (minDistSq < safeThreshold * safeThreshold) {
          return true;
        }
      }

      // 自己ループ近接チェック（22m 以上離れた同路線他区間への侵入を防止）
      for (const fOther of frames) {
        const arcDelta = Math.abs(fOther.arcLen - arc);
        if (arcDelta < 22.0) {
          continue;
        }
        const selfDistSq = (px - fOther.pos.x) ** 2 + (pz - fOther.pos.z) ** 2;
        const selfMinDist = innerOffset + 0.4;
        if (selfDistSq < selfMinDist * selfMinDist) {
          return true;
        }
      }
    }

    return false;
  };

  const refineBoundary = (safeArc: number, blockedArc: number): number => {
    let lo = safeArc;
    let hi = blockedArc;
    for (let iter = 0; iter < 5; iter++) {
      const mid = (lo + hi) * 0.5;
      if (isSidewalkArcBlocked(mid)) {
        hi = mid;
      } else {
        lo = mid;
      }
    }
    return lo;
  };

  const intervals: Array<{ start: number; end: number }> = [];
  const sampleStep = 1.0;
  let activeStart: number | null = null;
  let prevArc = minArc;
  let prevBlocked = true;

  for (let arc = minArc; arc <= maxArc; arc += sampleStep) {
    const blocked = isSidewalkArcBlocked(arc);
    if (!blocked && activeStart === null) {
      activeStart = prevBlocked && arc > minArc ? refineBoundary(arc, prevArc) : arc;
    } else if (blocked && activeStart !== null) {
      const preciseEnd = refineBoundary(prevArc, arc);
      if (preciseEnd - activeStart >= minSpanLength) {
        intervals.push({ start: activeStart, end: preciseEnd });
      }
      activeStart = null;
    }
    prevArc = arc;
    prevBlocked = blocked;
  }

  if (activeStart !== null && maxArc - activeStart >= minSpanLength) {
    intervals.push({ start: activeStart, end: maxArc });
  }

  return intervals;
}

function createQuadrantFilletFrames(
  sx: -1 | 1,
  sz: -1 | 1,
  nsHalfRoad: number,
  ewHalfRoad: number,
  halfW: number,
  halfD: number,
  filletR: number,
): { frames: RoadFrame[]; arcCenterX: number; arcCenterZ: number } {
  const arcCenterX = sx * (nsHalfRoad + filletR);
  const arcCenterZ = sz * (ewHalfRoad + filletR);
  const curvePts: THREE.Vector3[] = [];

  const hasNsStraight = halfD > ewHalfRoad + filletR + 0.05;
  if (hasNsStraight) {
    curvePts.push(new THREE.Vector3(sx * nsHalfRoad, 0, sz * halfD));
  }

  const arcSteps = 8;
  for (let i = 0; i <= arcSteps; i++) {
    const theta = (i / arcSteps) * Math.PI * 0.5;
    const px = arcCenterX - sx * filletR * Math.cos(theta);
    const pz = arcCenterZ - sz * filletR * Math.sin(theta);
    curvePts.push(new THREE.Vector3(px, 0, pz));
  }

  const hasEwStraight = halfW > nsHalfRoad + filletR + 0.05;
  if (hasEwStraight) {
    curvePts.push(new THREE.Vector3(sx * halfW, 0, sz * ewHalfRoad));
  }

  // (sx * sz > 0) の象限（NE / SW）は進行順を反転して normal = (tangent.z, 0, -tangent.x) が
  // 常にコーナー外角方向を向き、かつ tangent × normal = +Y になるよう統一する
  const shouldReverseCornerOrder = sx * sz > 0;
  if (shouldReverseCornerOrder) {
    curvePts.reverse();
  }

  // 重複近接点を除去
  const cleanPts: THREE.Vector3[] = [];
  for (const pt of curvePts) {
    const prev = cleanPts[cleanPts.length - 1];
    if (!prev || prev.distanceTo(pt) > 0.02) {
      cleanPts.push(pt);
    }
  }

  const frames: RoadFrame[] = [];
  let cumLen = 0;

  for (let i = 0; i < cleanPts.length; i++) {
    const p = cleanPts[i];
    if (i > 0) {
      cumLen += p.distanceTo(cleanPts[i - 1]);
    }
    const prevP = cleanPts[Math.max(0, i - 1)];
    const nextP = cleanPts[Math.min(cleanPts.length - 1, i + 1)];
    const tangent = new THREE.Vector3().subVectors(nextP, prevP).normalize();
    const normal = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
    frames.push({ pos: p, tangent, normal, arcLen: cumLen });
  }

  return { frames, arcCenterX, arcCenterZ };
}

function buildCornerSlabGeometry(
  sx: -1 | 1,
  sz: -1 | 1,
  nsHalfRoad: number,
  ewHalfRoad: number,
  halfW: number,
  halfD: number,
  curbW: number,
  filletR: number,
  baseY: number,
  curbHeight: number,
  elevationSampler?: (x: number, z: number) => number,
): THREE.BufferGeometry {
  const xEdge = sx * halfW;
  const zEdge = sz * halfD;
  const innerR = Math.max(0.15, filletR - curbW);
  const arcCenterX = sx * (nsHalfRoad + filletR);
  const arcCenterZ = sz * (ewHalfRoad + filletR);

  const boundaryPts: Array<[number, number]> = [];
  const hasNsStraight = halfD > ewHalfRoad + filletR + 0.05;
  if (hasNsStraight) {
    boundaryPts.push([sx * (nsHalfRoad + curbW), zEdge]);
  }

  const arcSteps = 8;
  for (let i = 0; i <= arcSteps; i++) {
    const theta = (i / arcSteps) * Math.PI * 0.5;
    const px = arcCenterX - sx * innerR * Math.cos(theta);
    const pz = arcCenterZ - sz * innerR * Math.sin(theta);
    boundaryPts.push([px, pz]);
  }

  const hasEwStraight = halfW > nsHalfRoad + filletR + 0.05;
  if (hasEwStraight) {
    boundaryPts.push([xEdge, sz * (ewHalfRoad + curbW)]);
  }

  const topY = baseY + curbHeight;
  const evalGroundY = (px: number, pz: number): number =>
    elevationSampler ? elevationSampler(px, pz) : 0;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // 天面ファン（外角 (xEdge, zEdge) から内側円弧境界へ）
  const apexIdx = 0;
  positions.push(xEdge, evalGroundY(xEdge, zEdge) + topY, zEdge);
  uvs.push(xEdge, zEdge);

  for (const [bx, bz] of boundaryPts) {
    positions.push(bx, evalGroundY(bx, bz) + topY, bz);
    uvs.push(bx, bz);
  }

  // v1 × v2 が +Y 上向き法線となるよう象限符号 (sx * sz) に応じてワインディングを選択
  const isSameSignQuad = sx * sz > 0;
  for (let i = 1; i < boundaryPts.length; i++) {
    const i1 = i;
    const i2 = i + 1;
    if (isSameSignQuad) {
      indices.push(apexIdx, i2, i1);
    } else {
      indices.push(apexIdx, i1, i2);
    }
  }

  // 外周スカート壁（交差点端 x=xEdge および z=zEdge の垂直面）
  const appendWall = (ax: number, az: number, bx: number, bz: number, flip: boolean): void => {
    const base = positions.length / 3;
    const ay = evalGroundY(ax, az);
    const by = evalGroundY(bx, bz);
    positions.push(ax, ay + baseY, az, ax, ay + topY, az, bx, by + topY, bz, bx, by + baseY, bz);
    uvs.push(0, 0, 0, 1, 1, 1, 1, 0);
    if (flip) {
      indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    } else {
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  };

  const firstB = boundaryPts[0];
  const lastB = boundaryPts[boundaryPts.length - 1];
  appendWall(xEdge, zEdge, firstB[0], firstB[1], !isSameSignQuad);
  appendWall(lastB[0], lastB[1], xEdge, zEdge, !isSameSignQuad);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geom.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  return geom;
}

/**
 * 交差点パッド四隅の歩道（隅切り R カーブ・面取り縁石・L型側溝・点字ブロック）および
 * T字路閉鎖辺の連続歩道を構築する
 */
export function buildIntersectionCornerSidewalks(
  config: JapaneseIntersectionConfig,
  materials: IntersectionSidewalkMaterials,
  baseY = 0.0115,
  localElevationSampler?: (localX: number, localZ: number) => number,
): IntersectionSidewalkOutput {
  const group = new THREE.Group();
  group.name = "IntersectionCornerSidewalks";
  const cornerColliders: CornerColliderSpec[] = [];

  const resolvedSampler =
    localElevationSampler ??
    (config.elevationSampler
      ? (lx: number, lz: number) => config.elevationSampler!(config.x + lx, config.z + lz)
      : undefined);

  const arms = config.arms;
  if (!arms) {
    return { group, cornerColliders };
  }

  const halfW = config.widthX * 0.5;
  const halfD = config.depthZ * 0.5;
  const curbHeight = config.curbHeight ?? 0.15;
  const curbWidth = config.curbWidth ?? 0.2;
  const defaultFillet = config.cornerFilletRadius ?? 3.2;
  const gutterW = 0.24;

  const hasN = Boolean(arms.north);
  const hasS = Boolean(arms.south);
  const hasE = Boolean(arms.east);
  const hasW = Boolean(arms.west);

  const buildStraightEdgeBridge = (
    edgeName: string,
    frames: RoadFrame[],
    sideSign: -1 | 1,
    innerOff: number,
    outerOff: number,
    colliderBox: CornerColliderSpec,
  ): void => {
    const totalEdgeWidth = outerOff - innerOff;
    if (totalEdgeWidth < 0.75 || frames.length < 2) {
      return;
    }
    const bridgeCrossSpec: RoadCrossSectionSpec = {
      medianWidth: 0,
      halfMedian: 0,
      carriagewayHalfWidth: innerOff,
      halfDriveable: innerOff,
      driveableWidth: innerOff * 2,
      gutterWidth: gutterW,
      curbWidth,
      curbHeight,
      curbBevelWidth: 0.045,
      curbBevelHeight: 0.045,
      sidewalkCrossSlope: 0.015,
      left: buildSideSpec(totalEdgeWidth, innerOff, curbWidth, curbHeight, 0.015),
      right: buildSideSpec(totalEdgeWidth, innerOff, curbWidth, curbHeight, 0.015),
    };

    const gutterGeom = buildLGutterRibbonGeometry(
      frames,
      sideSign,
      bridgeCrossSpec,
      baseY,
      resolvedSampler,
    );
    const gutterMesh = new THREE.Mesh(gutterGeom, materials.gutterMaterial);
    gutterMesh.name = `IntersectionLGutterEdge_${edgeName}`;
    gutterMesh.receiveShadow = true;
    group.add(gutterMesh);

    const curbGeom = buildProfiledCurbRibbonGeometry(
      frames,
      sideSign,
      bridgeCrossSpec,
      baseY,
      [],
      resolvedSampler,
    );
    const curbMesh = new THREE.Mesh(curbGeom, materials.curbMaterial);
    curbMesh.name = `IntersectionCurbEdge_${edgeName}`;
    curbMesh.userData.isSidewalkSurface = true;
    curbMesh.castShadow = true;
    curbMesh.receiveShadow = true;
    group.add(curbMesh);

    const swGeom = buildProfiledSidewalkRibbonGeometry(
      frames,
      sideSign,
      bridgeCrossSpec,
      baseY,
      [],
      resolvedSampler,
    );
    const swMesh = new THREE.Mesh(swGeom, materials.sidewalkMaterial);
    swMesh.name = `IntersectionSidewalkEdge_${edgeName}`;
    swMesh.userData.isSidewalkSurface = true;
    swMesh.receiveShadow = true;
    group.add(swMesh);

    cornerColliders.push(colliderBox);
  };

  // T字路の閉鎖辺（対向する2アームが繋がり、直交側の1アームが存在しない側）に連続直通歩道を敷設
  const closedEdges = new Set<string>();
  const isEastTClosed = !hasE && hasN && hasS;
  if (isEastTClosed) {
    const nsHalf = Math.max(arms.north!.carriagewayWidth, arms.south!.carriagewayWidth) * 0.5;
    const frames = buildStraightRoadFrames([-halfD, halfD]);
    buildStraightEdgeBridge("East", frames, 1, nsHalf, halfW, {
      cx: (nsHalf + halfW) * 0.5,
      cz: 0,
      halfX: (halfW - nsHalf) * 0.5,
      halfZ: halfD,
    });
    closedEdges.add("East");
  }

  const isWestTClosed = !hasW && hasN && hasS;
  if (isWestTClosed) {
    const nsHalf = Math.max(arms.north!.carriagewayWidth, arms.south!.carriagewayWidth) * 0.5;
    const frames = buildStraightRoadFrames([-halfD, halfD]);
    buildStraightEdgeBridge("West", frames, -1, nsHalf, halfW, {
      cx: -(nsHalf + halfW) * 0.5,
      cz: 0,
      halfX: (halfW - nsHalf) * 0.5,
      halfZ: halfD,
    });
    closedEdges.add("West");
  }

  const isNorthTClosed = !hasN && hasE && hasW;
  if (isNorthTClosed) {
    const ewHalf = Math.max(arms.east!.carriagewayWidth, arms.west!.carriagewayWidth) * 0.5;
    const tangent = new THREE.Vector3(1, 0, 0);
    const normal = new THREE.Vector3(0, 0, -1); // -normal = +Z (North)
    const frames: RoadFrame[] = [
      {
        pos: new THREE.Vector3(-halfW, 0, 0),
        tangent: tangent.clone(),
        normal: normal.clone(),
        arcLen: 0,
      },
      {
        pos: new THREE.Vector3(halfW, 0, 0),
        tangent: tangent.clone(),
        normal: normal.clone(),
        arcLen: config.widthX,
      },
    ];
    buildStraightEdgeBridge("North", frames, -1, ewHalf, halfD, {
      cx: 0,
      cz: (ewHalf + halfD) * 0.5,
      halfX: halfW,
      halfZ: (halfD - ewHalf) * 0.5,
    });
    closedEdges.add("North");
  }

  const isSouthTClosed = !hasS && hasE && hasW;
  if (isSouthTClosed) {
    const ewHalf = Math.max(arms.east!.carriagewayWidth, arms.west!.carriagewayWidth) * 0.5;
    const tangent = new THREE.Vector3(1, 0, 0);
    const normal = new THREE.Vector3(0, 0, -1); // +normal = -Z (South)
    const frames: RoadFrame[] = [
      {
        pos: new THREE.Vector3(-halfW, 0, 0),
        tangent: tangent.clone(),
        normal: normal.clone(),
        arcLen: 0,
      },
      {
        pos: new THREE.Vector3(halfW, 0, 0),
        tangent: tangent.clone(),
        normal: normal.clone(),
        arcLen: config.widthX,
      },
    ];
    buildStraightEdgeBridge("South", frames, 1, ewHalf, halfD, {
      cx: 0,
      cz: -(ewHalf + halfD) * 0.5,
      halfX: halfW,
      halfZ: (halfD - ewHalf) * 0.5,
    });
    closedEdges.add("South");
  }

  // 4象限の開放コーナー（隣接2アームが揃う角）へ隅切り R カーブ歩道を構築
  const quadrants: Array<{ sx: -1 | 1; sz: -1 | 1; label: string }> = [
    { sx: 1, sz: 1, label: "NE" },
    { sx: -1, sz: 1, label: "NW" },
    { sx: 1, sz: -1, label: "SE" },
    { sx: -1, sz: -1, label: "SW" },
  ];

  for (const q of quadrants) {
    const nsKey = q.sz > 0 ? "North" : "South";
    const ewKey = q.sx > 0 ? "East" : "West";
    const isCoveredByBridge = closedEdges.has(nsKey) || closedEdges.has(ewKey);
    if (isCoveredByBridge) {
      continue;
    }

    const nsArm: IntersectionArmSpec | undefined = q.sz > 0 ? arms.north : arms.south;
    const ewArm: IntersectionArmSpec | undefined = q.sx > 0 ? arms.east : arms.west;
    const hasBothAdjacentArms = Boolean(nsArm) && Boolean(ewArm);
    if (!hasBothAdjacentArms) {
      continue;
    }

    const nsHalfRoad = nsArm!.carriagewayWidth * 0.5;
    const ewHalfRoad = ewArm!.carriagewayWidth * 0.5;
    const cornerW = halfW - nsHalfRoad;
    const cornerD = halfD - ewHalfRoad;
    const hasEnoughCornerSpace = cornerW >= 0.75 && cornerD >= 0.75;
    if (!hasEnoughCornerSpace) {
      continue;
    }

    const minCornerDim = Math.min(cornerW, cornerD);
    const filletR = Math.max(curbWidth + 0.25, Math.min(defaultFillet, minCornerDim * 0.78));
    const { frames } = createQuadrantFilletFrames(
      q.sx,
      q.sz,
      nsHalfRoad,
      ewHalfRoad,
      halfW,
      halfD,
      filletR,
    );

    if (frames.length < 2) {
      continue;
    }

    // 縁石・L型側溝のリボン座標軸では frames[0].normal が必ずコーナー外向き (+normal) になるよう構築済み
    const totalCornerLen = frames[frames.length - 1].arcLen;
    const cornerDummyCross: RoadCrossSectionSpec = {
      medianWidth: 0,
      halfMedian: 0,
      carriagewayHalfWidth: 0,
      halfDriveable: 0,
      driveableWidth: 0,
      gutterWidth: gutterW,
      curbWidth,
      curbHeight,
      curbBevelWidth: 0.045,
      curbBevelHeight: 0.045,
      sidewalkCrossSlope: 0,
      left: buildSideSpec(curbWidth + 0.5, 0, curbWidth, curbHeight, 0),
      right: buildSideSpec(curbWidth + 0.5, 0, curbWidth, curbHeight, 0),
    };

    // 1. 隅切り L 型側溝（縁石の外側、車道側 -gutterW .. 0）
    const cornerGutterGeom = buildLGutterRibbonGeometry(
      frames,
      1,
      cornerDummyCross,
      baseY,
      resolvedSampler,
    );
    const cornerGutterMesh = new THREE.Mesh(cornerGutterGeom, materials.gutterMaterial);
    cornerGutterMesh.name = `IntersectionLGutterCorner_${q.label}`;
    cornerGutterMesh.receiveShadow = true;
    group.add(cornerGutterMesh);

    // 2. 隅切り面取り縁石リム (0 .. curbWidth)
    const cornerCurbGeom = buildProfiledCurbRibbonGeometry(
      frames,
      1,
      cornerDummyCross,
      baseY,
      [],
      resolvedSampler,
    );
    const cornerCurbMesh = new THREE.Mesh(cornerCurbGeom, materials.curbMaterial);
    cornerCurbMesh.name = `IntersectionCurbCorner_${q.label}`;
    cornerCurbMesh.userData.isSidewalkSurface = true;
    cornerCurbMesh.castShadow = true;
    cornerCurbMesh.receiveShadow = true;
    group.add(cornerCurbMesh);

    // 3. 隅切り歩道スラブ（縁石内側〜パッド外縁）
    const swSlabGeom = buildCornerSlabGeometry(
      q.sx,
      q.sz,
      nsHalfRoad,
      ewHalfRoad,
      halfW,
      halfD,
      curbWidth,
      filletR,
      baseY,
      curbHeight,
      resolvedSampler,
    );
    const swSlabMesh = new THREE.Mesh(swSlabGeom, materials.sidewalkMaterial);
    swSlabMesh.name = `IntersectionSidewalkCorner_${q.label}`;
    swSlabMesh.userData.isSidewalkSurface = true;
    swSlabMesh.receiveShadow = true;
    group.add(swSlabMesh);

    // 4. 点字警告ブロック（十分な奥行がある辺沿い縁石内側に配置）
    const hasBrailleSpace = totalCornerLen > 3.0 && minCornerDim >= 2.0;
    if (hasBrailleSpace && (config.hasCrosswalks ?? true)) {
      const tileGeo = new THREE.PlaneGeometry(0.6, 1.6);
      tileGeo.rotateX(-Math.PI / 2);
      const tileBaseY = baseY + curbHeight + 0.006;

      const nsTileZ = q.sz * Math.min(halfD - 1.2, ewHalfRoad + filletR + 0.6);
      const nsTileX = q.sx * (nsHalfRoad + curbWidth + 0.42);
      if (Math.abs(nsTileX) < halfW - 0.35 && Math.abs(nsTileZ) < halfD - 0.9) {
        const nsTile = new THREE.Mesh(tileGeo, materials.brailleMaterial);
        nsTile.name = `IntersectionTactileCorner_${q.label}_NS`;
        nsTile.userData.markingType = "TactilePaving";
        const nsTileY = tileBaseY + (resolvedSampler ? resolvedSampler(nsTileX, nsTileZ) : 0);
        nsTile.position.set(nsTileX, nsTileY, nsTileZ);
        group.add(nsTile);
      }

      const ewTileX = q.sx * Math.min(halfW - 1.2, nsHalfRoad + filletR + 0.6);
      const ewTileZ = q.sz * (ewHalfRoad + curbWidth + 0.42);
      if (Math.abs(ewTileZ) < halfD - 0.35 && Math.abs(ewTileX) < halfW - 0.9) {
        const ewTile = new THREE.Mesh(tileGeo, materials.brailleMaterial);
        ewTile.name = `IntersectionTactileCorner_${q.label}_EW`;
        ewTile.userData.markingType = "TactilePaving";
        ewTile.rotation.y = Math.PI / 2;
        const ewTileY = tileBaseY + (resolvedSampler ? resolvedSampler(ewTileX, ewTileZ) : 0);
        ewTile.position.set(ewTileX, ewTileY, ewTileZ);
        group.add(ewTile);
      }
    }

    // 5. 安全な物理コーナーコライダー（R カーブ内縁から外側へ退避した矩形）
    const safeOffset = filletR * 0.45;
    const safeBoxW = cornerW - safeOffset;
    const safeBoxD = cornerD - safeOffset;
    if (safeBoxW >= 0.4 && safeBoxD >= 0.4) {
      cornerColliders.push({
        cx: q.sx * (halfW - safeBoxW * 0.5),
        cz: q.sz * (halfD - safeBoxD * 0.5),
        halfX: safeBoxW * 0.5,
        halfZ: safeBoxD * 0.5,
      });
    }
  }

  return { group, cornerColliders };
}

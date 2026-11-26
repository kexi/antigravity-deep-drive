import * as THREE from "three";
import {
  buildLGutterRibbonGeometry,
  buildProfiledCurbRibbonGeometry,
  buildProfiledSidewalkRibbonGeometry,
  buildStraightRoadFrames,
  evaluateCurbRampHeight,
  getSideCrossSection,
  type CornerColliderSpec,
  type CrosswalkRampZone,
  type RoadCrossSectionSpec,
  type RoadFrame,
  type SidewalkSideSpec,
} from "../roadCrossSection";
import type { Point2D } from "../lanes/laneSchema";
import type { IntersectionArmSpec, JapaneseIntersectionConfig } from "../types";
import type {
  SidewalkDistrictPresetId,
  SidewalkPavingStyleValue,
  SidewalkSegmentRecord,
  SidewalkSideTag,
} from "./sidewalkSchema";

export interface SidewalkCatchBasinBuildResult {
  geometry: THREE.BufferGeometry;
  count: number;
}

export interface SlopedTactilePadParams {
  frames: ReadonlyArray<RoadFrame>;
  sideSign: -1 | 1;
  crossSection: RoadCrossSectionSpec;
  baseY: number;
  centerArc: number;
  padWidth?: number;
  padLength?: number;
  rampZones: ReadonlyArray<CrosswalkRampZone>;
  elevationSampler?: (x: number, z: number) => number;
}

export interface BatchedGuardrailBuildParams {
  intervals: ReadonlyArray<{ start: number; end: number }>;
  sideSign: -1 | 1;
  halfDriveable: number;
  baseY: number;
  getFrame: (arc: number) => RoadFrame;
  evalY: (x: number, z: number, offsetY: number) => number;
  beamMaterial: THREE.Material;
  retroMaterial: THREE.Material;
  groupName: string;
}

export interface UpgradedIntersectionSidewalkMaterials {
  sidewalkMaterial: THREE.Material;
  curbMaterial: THREE.Material;
  gutterMaterial: THREE.Material;
  brailleMaterial: THREE.Material;
  catchBasinMaterial?: THREE.Material;
}

export interface UpgradedIntersectionSidewalkOutput {
  group: THREE.Group;
  cornerColliders: CornerColliderSpec[];
  records: SidewalkSegmentRecord[];
}

function interpolateFrame(frames: ReadonlyArray<RoadFrame>, targetArc: number): RoadFrame {
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
  const ratio = span > 1e-4 ? (clamped - f0.arcLen) / span : 0;
  return {
    pos: new THREE.Vector3().lerpVectors(f0.pos, f1.pos, ratio),
    tangent: new THREE.Vector3().lerpVectors(f0.tangent, f1.tangent, ratio).normalize(),
    normal: new THREE.Vector3().lerpVectors(f0.normal, f1.normal, ratio).normalize(),
    arcLen: clamped,
  };
}

/**
 * 歩道上の任意アーク位置・横断距離における正確な上面高さ（切り下げスロープ＋1.5%排水勾配込み）を算出する。
 */
export function evaluateSidewalkTopHeight(
  arcLen: number,
  lateralFromCenter: number,
  sideSpec: SidewalkSideSpec,
  curbHeight: number,
  rampZones: ReadonlyArray<CrosswalkRampZone>,
): number {
  const innerH = evaluateCurbRampHeight(arcLen, curbHeight, rampZones);
  const outerH = sideSpec.backEdgeHeight;
  const distFromWalkInner = Math.max(0, Math.abs(lateralFromCenter) - sideSpec.walkInner);
  const frac =
    sideSpec.walkSurfaceWidth > 0.01
      ? Math.min(1, Math.max(0, distFromWalkInner / sideSpec.walkSurfaceWidth))
      : 0;
  return innerH + (outerH - innerH) * frac;
}

/**
 * 横断歩道切り下げスロープの 3D 傾斜面へ完全密着する JIS T 9251 点字警告ブロックジオメトリを構築する。
 *
 * Why not 水平な PlaneGeometry を単一高さへ配置するか:
 * 横断歩道前の歩道は縁石側 2cm → 建物側 21cm へ傾斜しているため、水平板を置くと車道側端が宙に浮いたり
 * 建物側端が歩道スラブにめり込んだりする。縁石側・建物側の各頂点を実斜面高さで評価することで浮き・めり込みを根絶する。
 */
export function buildSlopedTactilePadGeometry(
  params: SlopedTactilePadParams,
): THREE.BufferGeometry {
  const { frames, sideSign, crossSection, baseY, centerArc, rampZones, elevationSampler } = params;
  const sideSpec = getSideCrossSection(crossSection, sideSign);
  const padWidth = Math.min(
    params.padWidth ?? 0.6,
    Math.max(0.28, sideSpec.walkSurfaceWidth - 0.16),
  );
  const padLength = params.padLength ?? 2.4;

  if (frames.length < 2 || sideSpec.walkSurfaceWidth < 0.35) {
    return new THREE.BufferGeometry();
  }

  const tactileMargin = Math.min(
    0.42,
    Math.max(padWidth * 0.5 + 0.06, sideSpec.walkSurfaceWidth * 0.34),
  );
  const innerLat = sideSpec.curbOuter + Math.max(0.06, tactileMargin - padWidth * 0.5);
  const outerLat = Math.min(sideSpec.walkOuter - 0.06, innerLat + padWidth);

  const halfL = padLength * 0.5;
  const arcSamples = [
    centerArc - halfL,
    centerArc - halfL * 0.5,
    centerArc,
    centerArc + halfL * 0.5,
    centerArc + halfL,
  ];

  const offA = sideSign * innerLat;
  const offB = sideSign * outerLat;
  const offMin = Math.min(offA, offB);
  const offMax = Math.max(offA, offB);

  const n = arcSamples.length;
  const positions = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  const indices: number[] = [];

  for (let i = 0; i < n; i++) {
    const arc = arcSamples[i];
    const f = interpolateFrame(frames, arc);
    const vCoord = i / (n - 1);

    const xMin = f.pos.x + f.normal.x * offMin;
    const zMin = f.pos.z + f.normal.z * offMin;
    const groundMin = elevationSampler ? elevationSampler(xMin, zMin) : f.pos.y;
    const hMin = evaluateSidewalkTopHeight(
      arc,
      offMin,
      sideSpec,
      crossSection.curbHeight,
      rampZones,
    );

    const xMax = f.pos.x + f.normal.x * offMax;
    const zMax = f.pos.z + f.normal.z * offMax;
    const groundMax = elevationSampler ? elevationSampler(xMax, zMax) : f.pos.y;
    const hMax = evaluateSidewalkTopHeight(
      arc,
      offMax,
      sideSpec,
      crossSection.curbHeight,
      rampZones,
    );

    const pIdx = i * 6;
    positions[pIdx] = xMin;
    positions[pIdx + 1] = groundMin + baseY + hMin + 0.0055;
    positions[pIdx + 2] = zMin;
    positions[pIdx + 3] = xMax;
    positions[pIdx + 4] = groundMax + baseY + hMax + 0.0055;
    positions[pIdx + 5] = zMax;

    const uIdx = i * 4;
    uvs[uIdx] = 0;
    uvs[uIdx + 1] = vCoord * (padLength / 0.6);
    uvs[uIdx + 2] = 1;
    uvs[uIdx + 3] = vCoord * (padLength / 0.6);

    if (i < n - 1) {
      const a = i * 2;
      const b = i * 2 + 1;
      const c = (i + 1) * 2;
      const d = (i + 1) * 2 + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  return geom;
}

/**
 * L型側溝内に埋め込む雨水集水桝グレーチング（鋳鉄製スリット蓋）を
 * セグメント片側ごとに単一 BufferGeometry へバッチ統合生成する。
 *
 * How:
 * - 横断歩道切下げスロープの直前・直後（すりつけ外側 +0.75m）へ優先配置し、雨水がスロープへ滞留するのを防ぐ実物土木仕様を再現。
 * - その他の区間は spacingMeters（既定 20〜24m）間隔で均等配置し、6m 以内の重複を除外する。
 */
export function buildBatchedCatchBasinGeometry(params: {
  frames: ReadonlyArray<RoadFrame>;
  sideSign: -1 | 1;
  crossSection: RoadCrossSectionSpec;
  baseY: number;
  rampZones: ReadonlyArray<CrosswalkRampZone>;
  spacingMeters?: number;
  elevationSampler?: (x: number, z: number) => number;
}): SidewalkCatchBasinBuildResult {
  const { frames, sideSign, crossSection, baseY, rampZones, elevationSampler } = params;
  const spacing = Math.max(10, params.spacingMeters ?? 22.0);
  if (frames.length < 2 || crossSection.gutterWidth < 0.14) {
    return { geometry: new THREE.BufferGeometry(), count: 0 };
  }

  const arcStart = frames[0].arcLen;
  const arcEnd = frames[frames.length - 1].arcLen;
  const span = arcEnd - arcStart;
  if (span < 6.0) {
    return { geometry: new THREE.BufferGeometry(), count: 0 };
  }

  const candidateArcs: number[] = [];
  // 1. 横断歩道切下げスロープの直前・直後に優先配置
  for (const rz of rampZones) {
    const hw = rz.halfWidth ?? 2.2;
    const tr = rz.transitionLength ?? 1.2;
    const offset = hw + tr + 0.75;
    for (const arc of [rz.center - offset, rz.center + offset]) {
      if (arc >= arcStart + 1.4 && arc <= arcEnd - 1.4) {
        candidateArcs.push(arc);
      }
    }
  }
  // 2. 通常区間の等間隔配置
  for (let arc = arcStart + Math.min(8.0, span * 0.25); arc <= arcEnd - 2.5; arc += spacing) {
    const insideRamp = rampZones.some(
      (rz) =>
        Math.abs(arc - rz.center) < (rz.halfWidth ?? 2.2) + (rz.transitionLength ?? 1.2) + 0.3,
    );
    if (!insideRamp) {
      candidateArcs.push(arc);
    }
  }

  candidateArcs.sort((a, b) => a - b);
  const selectedArcs: number[] = [];
  for (const arc of candidateArcs) {
    const isTooClose = selectedArcs.some((prev) => Math.abs(arc - prev) < 6.5);
    if (!isTooClose) {
      selectedArcs.push(arc);
    }
  }

  if (selectedArcs.length === 0) {
    return { geometry: new THREE.BufferGeometry(), count: 0 };
  }

  const grateHalfW = Math.min(0.11, crossSection.gutterWidth * 0.44);
  const grateHalfL = 0.28;
  const gutterCenterOff = sideSign * (crossSection.halfDriveable - crossSection.gutterWidth * 0.5);
  const offMin = Math.min(gutterCenterOff - grateHalfW, gutterCenterOff + grateHalfW);
  const offMax = Math.max(gutterCenterOff - grateHalfW, gutterCenterOff + grateHalfW);

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (const arc of selectedArcs) {
    const f0 = interpolateFrame(frames, arc - grateHalfL);
    const f1 = interpolateFrame(frames, arc + grateHalfL);

    const p0x = f0.pos.x + f0.normal.x * offMin;
    const p0z = f0.pos.z + f0.normal.z * offMin;
    const p0y = (elevationSampler ? elevationSampler(p0x, p0z) : f0.pos.y) + baseY + 0.007;

    const p1x = f0.pos.x + f0.normal.x * offMax;
    const p1z = f0.pos.z + f0.normal.z * offMax;
    const p1y = (elevationSampler ? elevationSampler(p1x, p1z) : f0.pos.y) + baseY + 0.007;

    const p2x = f1.pos.x + f1.normal.x * offMin;
    const p2z = f1.pos.z + f1.normal.z * offMin;
    const p2y = (elevationSampler ? elevationSampler(p2x, p2z) : f1.pos.y) + baseY + 0.007;

    const p3x = f1.pos.x + f1.normal.x * offMax;
    const p3z = f1.pos.z + f1.normal.z * offMax;
    const p3y = (elevationSampler ? elevationSampler(p3x, p3z) : f1.pos.y) + baseY + 0.007;

    const baseIdx = positions.length / 3;
    positions.push(p0x, p0y, p0z, p1x, p1y, p1z, p2x, p2y, p2z, p3x, p3y, p3z);
    uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
    indices.push(baseIdx, baseIdx + 2, baseIdx + 1, baseIdx + 1, baseIdx + 2, baseIdx + 3);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geom.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  return { geometry: geom, count: selectedArcs.length };
}

function appendOrientedBoxToBuffers(
  positions: number[],
  normals: number[],
  uvs: number[],
  indices: number[],
  cx: number,
  cy: number,
  cz: number,
  hx: number,
  hy: number,
  hz: number,
  yawRad: number,
): void {
  const cosY = Math.cos(yawRad);
  const sinY = Math.sin(yawRad);

  const toWorld = (lx: number, ly: number, lz: number): [number, number, number] => [
    cx + lx * cosY + lz * sinY,
    cy + ly,
    cz - lx * sinY + lz * cosY,
  ];
  const rotNorm = (nx: number, ny: number, nz: number): [number, number, number] => [
    nx * cosY + nz * sinY,
    ny,
    -nx * sinY + nz * cosY,
  ];

  const faces: ReadonlyArray<{
    n: [number, number, number];
    verts: ReadonlyArray<[number, number, number]>;
  }> = [
    {
      n: [0, 1, 0],
      verts: [
        [-hx, hy, -hz],
        [-hx, hy, hz],
        [hx, hy, hz],
        [hx, hy, -hz],
      ],
    },
    {
      n: [0, 0, 1],
      verts: [
        [-hx, -hy, hz],
        [hx, -hy, hz],
        [hx, hy, hz],
        [-hx, hy, hz],
      ],
    },
    {
      n: [0, 0, -1],
      verts: [
        [hx, -hy, -hz],
        [-hx, -hy, -hz],
        [-hx, hy, -hz],
        [hx, hy, -hz],
      ],
    },
    {
      n: [1, 0, 0],
      verts: [
        [hx, -hy, hz],
        [hx, -hy, -hz],
        [hx, hy, -hz],
        [hx, hy, hz],
      ],
    },
    {
      n: [-1, 0, 0],
      verts: [
        [-hx, -hy, -hz],
        [-hx, -hy, hz],
        [-hx, hy, hz],
        [-hx, hy, -hz],
      ],
    },
  ];

  for (const face of faces) {
    const baseIdx = positions.length / 3;
    const wn = rotNorm(face.n[0], face.n[1], face.n[2]);
    for (let i = 0; i < 4; i++) {
      const wp = toWorld(face.verts[i][0], face.verts[i][1], face.verts[i][2]);
      positions.push(wp[0], wp[1], wp[2]);
      normals.push(wn[0], wn[1], wn[2]);
    }
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(baseIdx, baseIdx + 1, baseIdx + 2, baseIdx, baseIdx + 2, baseIdx + 3);
  }
}

function appendSolidBoxRibbonToBuffers(
  positions: number[],
  uvs: number[],
  indices: number[],
  getFrame: (arc: number) => RoadFrame,
  evalY: (x: number, z: number, offsetY: number) => number,
  offA: number,
  offB: number,
  yBottom: number,
  yTop: number,
  arcStart: number,
  arcEnd: number,
  stepMeters: number,
): void {
  const span = arcEnd - arcStart;
  if (span < 0.4) {
    return;
  }
  const offMin = Math.min(offA, offB);
  const offMax = Math.max(offA, offB);
  const steps = Math.max(2, Math.ceil(span / Math.max(0.5, stepMeters)));

  const ringPts: Array<{
    bl: [number, number, number];
    br: [number, number, number];
    tl: [number, number, number];
    tr: [number, number, number];
    arc: number;
  }> = [];

  for (let i = 0; i <= steps; i++) {
    const arc = arcStart + (span * i) / steps;
    const f = getFrame(arc);
    const lx = f.pos.x + f.normal.x * offMin;
    const lz = f.pos.z + f.normal.z * offMin;
    const rx = f.pos.x + f.normal.x * offMax;
    const rz = f.pos.z + f.normal.z * offMax;
    ringPts.push({
      bl: [lx, evalY(lx, lz, yBottom), lz],
      br: [rx, evalY(rx, rz, yBottom), rz],
      tl: [lx, evalY(lx, lz, yTop), lz],
      tr: [rx, evalY(rx, rz, yTop), rz],
      arc,
    });
  }

  const pushQuad = (
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    v0: number,
    v1: number,
  ): void => {
    const base = positions.length / 3;
    positions.push(...p0, ...p1, ...p2, ...p3);
    uvs.push(0, v0, 1, v0, 0, v1, 1, v1);
    indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  };

  for (let i = 0; i < ringPts.length - 1; i++) {
    const a = ringPts[i];
    const b = ringPts[i + 1];
    // 天面 (+Y)
    pushQuad(a.tl, a.tr, b.tl, b.tr, a.arc, b.arc);
    // 左側面 (-normal)
    pushQuad(a.bl, a.tl, b.bl, b.tl, a.arc, b.arc);
    // 右側面 (+normal)
    pushQuad(a.tr, a.br, b.tr, b.br, a.arc, b.arc);
  }
}

/**
 * 曲線道路の歩道ガードレール（上部・中部ビーム＋支柱＋再帰反射体）を
 * 片側あたり最大 3 ドローコール（ビーム統合・支柱統合・反射体統合）へバッチ化して構築する。
 */
export function buildBatchedCurvedGuardrailGroup(params: BatchedGuardrailBuildParams): THREE.Group {
  const {
    intervals,
    sideSign,
    halfDriveable,
    baseY,
    getFrame,
    evalY,
    beamMaterial,
    retroMaterial,
    groupName,
  } = params;

  const railGroup = new THREE.Group();
  railGroup.name = groupName;
  const railCenterOff = sideSign * (halfDriveable + 0.36);

  const beamPositions: number[] = [];
  const beamUvs: number[] = [];
  const beamIndices: number[] = [];

  const postPositions: number[] = [];
  const postNormals: number[] = [];
  const postUvs: number[] = [];
  const postIndices: number[] = [];

  const retroPositions: number[] = [];
  const retroNormals: number[] = [];
  const retroUvs: number[] = [];
  const retroIndices: number[] = [];

  for (const iv of intervals) {
    appendSolidBoxRibbonToBuffers(
      beamPositions,
      beamUvs,
      beamIndices,
      getFrame,
      evalY,
      railCenterOff - 0.03,
      railCenterOff + 0.03,
      baseY + 0.72,
      baseY + 0.79,
      iv.start,
      iv.end,
      2.0,
    );
    appendSolidBoxRibbonToBuffers(
      beamPositions,
      beamUvs,
      beamIndices,
      getFrame,
      evalY,
      railCenterOff - 0.025,
      railCenterOff + 0.025,
      baseY + 0.44,
      baseY + 0.49,
      iv.start,
      iv.end,
      2.0,
    );

    let postCounter = 0;
    for (let s = iv.start + 1.25; s <= iv.end - 1.25; s += 2.5) {
      const f = getFrame(s);
      const postX = f.pos.x + f.normal.x * railCenterOff;
      const postZ = f.pos.z + f.normal.z * railCenterOff;
      const postYaw = Math.atan2(f.tangent.x, f.tangent.z);

      appendOrientedBoxToBuffers(
        postPositions,
        postNormals,
        postUvs,
        postIndices,
        postX,
        evalY(postX, postZ, baseY + 0.39),
        postZ,
        0.03,
        0.39,
        0.03,
        postYaw,
      );

      if (postCounter % 2 === 0) {
        appendOrientedBoxToBuffers(
          retroPositions,
          retroNormals,
          retroUvs,
          retroIndices,
          postX,
          evalY(postX, postZ, baseY + 0.62),
          postZ,
          0.0375,
          0.03,
          0.03,
          postYaw,
        );
      }
      postCounter += 1;
    }
  }

  if (beamIndices.length > 0) {
    const beamGeo = new THREE.BufferGeometry();
    beamGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(beamPositions), 3));
    beamGeo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(beamUvs), 2));
    beamGeo.setIndex(beamIndices);
    beamGeo.computeVertexNormals();
    beamGeo.computeBoundingSphere();
    const beamMesh = new THREE.Mesh(beamGeo, beamMaterial);
    beamMesh.name = `${groupName}_Beams`;
    beamMesh.castShadow = true;
    beamMesh.receiveShadow = true;
    railGroup.add(beamMesh);
  }

  if (postIndices.length > 0) {
    const postGeo = new THREE.BufferGeometry();
    postGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(postPositions), 3));
    postGeo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(postNormals), 3));
    postGeo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(postUvs), 2));
    postGeo.setIndex(postIndices);
    postGeo.computeBoundingSphere();
    const postMesh = new THREE.Mesh(postGeo, beamMaterial);
    postMesh.name = `${groupName}_Posts`;
    postMesh.castShadow = true;
    postMesh.receiveShadow = true;
    railGroup.add(postMesh);
  }

  if (retroIndices.length > 0) {
    const retroGeo = new THREE.BufferGeometry();
    retroGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(retroPositions), 3),
    );
    retroGeo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(retroNormals), 3));
    retroGeo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(retroUvs), 2));
    retroGeo.setIndex(retroIndices);
    retroGeo.computeBoundingSphere();
    const retroMesh = new THREE.Mesh(retroGeo, retroMaterial);
    retroMesh.name = `${groupName}_Retroreflectors`;
    railGroup.add(retroMesh);
  }

  return railGroup;
}

function buildSideSpecLocal(
  rawTotalWidth: number,
  halfDriveable: number,
  maxCurbWidth: number,
  curbHeight: number,
  crossSlope: number,
): SidewalkSideSpec {
  const totalWidth = Math.max(0, rawTotalWidth);
  const curbWidth = Math.min(maxCurbWidth, totalWidth * 0.4);
  const curbInner = halfDriveable;
  const curbOuter = halfDriveable + curbWidth;
  const walkInner = curbOuter;
  const walkOuter = halfDriveable + totalWidth;
  const walkSurfaceWidth = Math.max(0, walkOuter - walkInner);
  return {
    totalWidth,
    curbWidth,
    curbInner,
    curbOuter,
    walkInner,
    walkOuter,
    walkSurfaceWidth,
    backEdgeHeight: curbHeight + walkSurfaceWidth * crossSlope,
  };
}

function createQuadrantFilletFramesWithRamps(
  sx: -1 | 1,
  sz: -1 | 1,
  nsHalfRoad: number,
  ewHalfRoad: number,
  halfW: number,
  halfD: number,
  filletR: number,
  hasNsCrosswalk: boolean,
  hasEwCrosswalk: boolean,
): {
  frames: RoadFrame[];
  rampZones: CrosswalkRampZone[];
  nsStraightLen: number;
  ewStraightLen: number;
} {
  const arcCenterX = sx * (nsHalfRoad + filletR);
  const arcCenterZ = sz * (ewHalfRoad + filletR);
  const curvePts: THREE.Vector3[] = [];

  const nsStraightLen = Math.max(0, halfD - (ewHalfRoad + filletR));
  const ewStraightLen = Math.max(0, halfW - (nsHalfRoad + filletR));

  if (nsStraightLen > 0.05) {
    curvePts.push(new THREE.Vector3(sx * nsHalfRoad, 0, sz * halfD));
    if (nsStraightLen > 0.7) {
      curvePts.push(
        new THREE.Vector3(sx * nsHalfRoad, 0, sz * (ewHalfRoad + filletR + nsStraightLen * 0.5)),
      );
    }
  }

  const arcSteps = 8;
  for (let i = 0; i <= arcSteps; i++) {
    const theta = (i / arcSteps) * Math.PI * 0.5;
    const px = arcCenterX - sx * filletR * Math.cos(theta);
    const pz = arcCenterZ - sz * filletR * Math.sin(theta);
    curvePts.push(new THREE.Vector3(px, 0, pz));
  }

  if (ewStraightLen > 0.05) {
    if (ewStraightLen > 0.7) {
      curvePts.push(
        new THREE.Vector3(sx * (nsHalfRoad + filletR + ewStraightLen * 0.5), 0, sz * ewHalfRoad),
      );
    }
    curvePts.push(new THREE.Vector3(sx * halfW, 0, sz * ewHalfRoad));
  }

  const shouldReverseCornerOrder = sx * sz > 0;
  if (shouldReverseCornerOrder) {
    curvePts.reverse();
  }

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

  // 交差点コーナー横断歩道アプローチ部のバリアフリー切下げゾーン（R 中央の頂部は 0.15m を維持）
  const rampZones: CrosswalkRampZone[] = [];
  const totalLen = frames.length > 0 ? frames[frames.length - 1].arcLen : 0;
  if (hasNsCrosswalk && nsStraightLen >= 0.65) {
    const halfRamp = Math.min(0.8, nsStraightLen * 0.35);
    const trans = Math.min(0.65, nsStraightLen * 0.3);
    const center = shouldReverseCornerOrder
      ? totalLen - nsStraightLen * 0.45
      : nsStraightLen * 0.45;
    rampZones.push({ center, halfWidth: halfRamp, transitionLength: trans });
  }
  if (hasEwCrosswalk && ewStraightLen >= 0.65) {
    const halfRamp = Math.min(0.8, ewStraightLen * 0.35);
    const trans = Math.min(0.65, ewStraightLen * 0.3);
    const center = shouldReverseCornerOrder
      ? ewStraightLen * 0.45
      : totalLen - ewStraightLen * 0.45;
    rampZones.push({ center, halfWidth: halfRamp, transitionLength: trans });
  }

  return { frames, rampZones, nsStraightLen, ewStraightLen };
}

function buildRampedCornerSlabGeometry(
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
  cornerRampZones: ReadonlyArray<CrosswalkRampZone>,
  elevationSampler?: (x: number, z: number) => number,
): { geometry: THREE.BufferGeometry; polygonLocal: Point2D[]; areaSqMeters: number } {
  const xEdge = sx * halfW;
  const zEdge = sz * halfD;
  const innerR = Math.max(0.15, filletR - curbW);
  const arcCenterX = sx * (nsHalfRoad + filletR);
  const arcCenterZ = sz * (ewHalfRoad + filletR);

  const rawPts: Array<[number, number]> = [];
  const nsStraightLen = halfD - (ewHalfRoad + filletR);
  const ewStraightLen = halfW - (nsHalfRoad + filletR);

  if (nsStraightLen > 0.05) {
    rawPts.push([sx * (nsHalfRoad + curbW), zEdge]);
    if (nsStraightLen > 0.7) {
      rawPts.push([sx * (nsHalfRoad + curbW), sz * (ewHalfRoad + filletR + nsStraightLen * 0.5)]);
    }
  }

  const arcSteps = 8;
  for (let i = 0; i <= arcSteps; i++) {
    const theta = (i / arcSteps) * Math.PI * 0.5;
    const px = arcCenterX - sx * innerR * Math.cos(theta);
    const pz = arcCenterZ - sz * innerR * Math.sin(theta);
    rawPts.push([px, pz]);
  }

  if (ewStraightLen > 0.05) {
    if (ewStraightLen > 0.7) {
      rawPts.push([sx * (nsHalfRoad + filletR + ewStraightLen * 0.5), sz * (ewHalfRoad + curbW)]);
    }
    rawPts.push([xEdge, sz * (ewHalfRoad + curbW)]);
  }

  const isSameSignQuad = sx * sz > 0;
  const orderedBoundary = isSameSignQuad ? [...rawPts].reverse() : rawPts;
  const boundaryArcs: number[] = [];
  let cumArc = 0;
  for (let i = 0; i < orderedBoundary.length; i++) {
    if (i > 0) {
      cumArc += Math.hypot(
        orderedBoundary[i][0] - orderedBoundary[i - 1][0],
        orderedBoundary[i][1] - orderedBoundary[i - 1][1],
      );
    }
    boundaryArcs.push(cumArc);
  }

  const evalGroundY = (px: number, pz: number): number =>
    elevationSampler ? elevationSampler(px, pz) : 0;

  const apexTopY = baseY + curbHeight + 0.015;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const apexIdx = 0;
  positions.push(xEdge, evalGroundY(xEdge, zEdge) + apexTopY, zEdge);
  uvs.push(xEdge, zEdge);

  // 原点順の境界点と高さを構築（ワインディング整合のため元の順序へ戻す）
  const boundaryPts = rawPts;
  const boundaryHeights: number[] = [];
  for (let i = 0; i < boundaryPts.length; i++) {
    const arcLookupIdx = isSameSignQuad ? boundaryPts.length - 1 - i : i;
    const h = evaluateCurbRampHeight(boundaryArcs[arcLookupIdx], curbHeight, cornerRampZones);
    boundaryHeights.push(baseY + h);
    const [bx, bz] = boundaryPts[i];
    positions.push(bx, evalGroundY(bx, bz) + baseY + h, bz);
    uvs.push(bx, bz);
  }

  let areaSqMeters = 0;
  for (let i = 1; i < boundaryPts.length; i++) {
    const i1 = i;
    const i2 = i + 1;
    if (isSameSignQuad) {
      indices.push(apexIdx, i2, i1);
    } else {
      indices.push(apexIdx, i1, i2);
    }
    const [x1, z1] = boundaryPts[i - 1];
    const [x2, z2] = boundaryPts[i];
    areaSqMeters += Math.abs((x1 - xEdge) * (z2 - zEdge) - (x2 - xEdge) * (z1 - zEdge)) * 0.5;
  }

  const appendWall = (
    ax: number,
    az: number,
    aTopY: number,
    bx: number,
    bz: number,
    bTopY: number,
    flip: boolean,
  ): void => {
    const base = positions.length / 3;
    const ay = evalGroundY(ax, az);
    const by = evalGroundY(bx, bz);
    positions.push(ax, ay + baseY, az, ax, ay + aTopY, az, bx, by + bTopY, bz, bx, by + baseY, bz);
    uvs.push(0, 0, 0, 1, 1, 1, 1, 0);
    if (flip) {
      indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    } else {
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  };

  const firstB = boundaryPts[0];
  const lastB = boundaryPts[boundaryPts.length - 1];
  appendWall(xEdge, zEdge, apexTopY, firstB[0], firstB[1], boundaryHeights[0], !isSameSignQuad);
  appendWall(
    lastB[0],
    lastB[1],
    boundaryHeights[boundaryHeights.length - 1],
    xEdge,
    zEdge,
    apexTopY,
    !isSameSignQuad,
  );

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geom.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  geom.computeBoundingSphere();

  const polygonLocal: Point2D[] = [
    { x: xEdge, z: zEdge },
    ...boundaryPts.map(([x, z]) => ({ x, z })),
  ];
  return { geometry: geom, polygonLocal, areaSqMeters: Math.max(0.25, areaSqMeters) };
}

function computePolygonBounds2D(pts: ReadonlyArray<Point2D>): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, maxX, minZ, maxZ };
}

/**
 * 交差点パッド四隅の歩道（隅切り R カーブ・横断歩道切下げスロープ・面取り縁石・L型側溝・
 * コーナー雨水集水桝・傾斜密着点字警告ブロック）および T 字路閉鎖辺の連続歩道を構築し、
 * SidewalkNetwork 向けの構造化レコードを同時に返す。
 */
export function buildUpgradedIntersectionCornerSidewalks(
  config: JapaneseIntersectionConfig,
  materials: UpgradedIntersectionSidewalkMaterials,
  meta: {
    roadId: string;
    roadName: string;
    presetId: SidewalkDistrictPresetId;
    pavingStyle: SidewalkPavingStyleValue;
  },
  baseY = 0.0115,
  localElevationSampler?: (localX: number, localZ: number) => number,
): UpgradedIntersectionSidewalkOutput {
  const group = new THREE.Group();
  group.name = "IntersectionCornerSidewalks";
  const cornerColliders: CornerColliderSpec[] = [];
  const records: SidewalkSegmentRecord[] = [];

  const resolvedSampler =
    localElevationSampler ??
    (config.elevationSampler
      ? (lx: number, lz: number) => config.elevationSampler!(config.x + lx, config.z + lz)
      : undefined);

  const arms = config.arms;
  if (!arms) {
    return { group, cornerColliders, records };
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
    edgeName: "North" | "South" | "East" | "West",
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
      left: buildSideSpecLocal(totalEdgeWidth, innerOff, curbWidth, curbHeight, 0.015),
      right: buildSideSpecLocal(totalEdgeWidth, innerOff, curbWidth, curbHeight, 0.015),
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

    let catchBasinCount = 0;
    if (materials.catchBasinMaterial) {
      const basin = buildBatchedCatchBasinGeometry({
        frames,
        sideSign,
        crossSection: bridgeCrossSpec,
        baseY,
        rampZones: [],
        spacingMeters: 16.0,
        elevationSampler: resolvedSampler,
      });
      if (basin.count > 0) {
        const basinMesh = new THREE.Mesh(basin.geometry, materials.catchBasinMaterial);
        basinMesh.name = `IntersectionCatchBasinEdge_${edgeName}`;
        basinMesh.userData.lodDetailTier = "high";
        group.add(basinMesh);
        catchBasinCount = basin.count;
      }
    }

    cornerColliders.push(colliderBox);

    const worldPoly: Point2D[] = [
      {
        x: config.x + colliderBox.cx - colliderBox.halfX,
        z: config.z + colliderBox.cz - colliderBox.halfZ,
      },
      {
        x: config.x + colliderBox.cx + colliderBox.halfX,
        z: config.z + colliderBox.cz - colliderBox.halfZ,
      },
      {
        x: config.x + colliderBox.cx + colliderBox.halfX,
        z: config.z + colliderBox.cz + colliderBox.halfZ,
      },
      {
        x: config.x + colliderBox.cx - colliderBox.halfX,
        z: config.z + colliderBox.cz + colliderBox.halfZ,
      },
    ];
    const spanLength = Math.max(colliderBox.halfX * 2, colliderBox.halfZ * 2);
    const sideKey: SidewalkSideTag = `edge_${edgeName}`;
    records.push({
      id: `${meta.roadId}_${sideKey}`,
      roadId: meta.roadId,
      roadName: meta.roadName,
      kind: "intersection_edge",
      side: sideKey,
      presetId: meta.presetId,
      pavingStyle: meta.pavingStyle,
      widthMeters: totalEdgeWidth,
      curbHeightMeters: curbHeight,
      lengthMeters: spanLength,
      areaSqMeters: totalEdgeWidth * spanLength,
      rampCount: 0,
      tactilePadCount: 0,
      catchBasinCount,
      hasGuardrail: false,
      polygonXZ: worldPoly,
      walkableSpine: [
        {
          x: config.x + colliderBox.cx,
          y:
            (config.elevationSampler
              ? config.elevationSampler(config.x + colliderBox.cx, config.z + colliderBox.cz)
              : 0) +
            baseY +
            curbHeight,
          z: config.z + colliderBox.cz,
          tx: edgeName === "North" || edgeName === "South" ? 1 : 0,
          tz: edgeName === "East" || edgeName === "West" ? 1 : 0,
          widthMeters: totalEdgeWidth,
        },
      ],
      bounds: computePolygonBounds2D(worldPoly),
    });
  };

  // T字路の閉鎖辺連続歩道
  const closedEdges = new Set<string>();
  if (!hasE && hasN && hasS) {
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
  if (!hasW && hasN && hasS) {
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
  if (!hasN && hasE && hasW) {
    const ewHalf = Math.max(arms.east!.carriagewayWidth, arms.west!.carriagewayWidth) * 0.5;
    const tangent = new THREE.Vector3(1, 0, 0);
    const normal = new THREE.Vector3(0, 0, -1);
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
  if (!hasS && hasE && hasW) {
    const ewHalf = Math.max(arms.east!.carriagewayWidth, arms.west!.carriagewayWidth) * 0.5;
    const tangent = new THREE.Vector3(1, 0, 0);
    const normal = new THREE.Vector3(0, 0, -1);
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

  // 4象限隅切り R カーブ歩道（横断歩道切下げ＋集水桝＋点字ブロック付き）
  const quadrants: Array<{ sx: -1 | 1; sz: -1 | 1; label: "NE" | "NW" | "SE" | "SW" }> = [
    { sx: 1, sz: 1, label: "NE" },
    { sx: -1, sz: 1, label: "NW" },
    { sx: 1, sz: -1, label: "SE" },
    { sx: -1, sz: -1, label: "SW" },
  ];

  const defaultCrosswalks = config.hasCrosswalks ?? true;

  for (const q of quadrants) {
    const nsKey = q.sz > 0 ? "North" : "South";
    const ewKey = q.sx > 0 ? "East" : "West";
    if (closedEdges.has(nsKey) || closedEdges.has(ewKey)) {
      continue;
    }

    const nsArm: IntersectionArmSpec | undefined = q.sz > 0 ? arms.north : arms.south;
    const ewArm: IntersectionArmSpec | undefined = q.sx > 0 ? arms.east : arms.west;
    if (!nsArm || !ewArm) {
      continue;
    }

    const nsHalfRoad = nsArm.carriagewayWidth * 0.5;
    const ewHalfRoad = ewArm.carriagewayWidth * 0.5;
    const cornerW = halfW - nsHalfRoad;
    const cornerD = halfD - ewHalfRoad;
    if (cornerW < 0.75 || cornerD < 0.75) {
      continue;
    }

    const minCornerDim = Math.min(cornerW, cornerD);
    const filletR = Math.max(curbWidth + 0.25, Math.min(defaultFillet, minCornerDim * 0.78));
    const hasNsCrosswalk = (q.sz > 0 ? config.crosswalkN : config.crosswalkS) ?? defaultCrosswalks;
    const hasEwCrosswalk = (q.sx > 0 ? config.crosswalkE : config.crosswalkW) ?? defaultCrosswalks;

    const { frames, rampZones } = createQuadrantFilletFramesWithRamps(
      q.sx,
      q.sz,
      nsHalfRoad,
      ewHalfRoad,
      halfW,
      halfD,
      filletR,
      hasNsCrosswalk,
      hasEwCrosswalk,
    );
    if (frames.length < 2) {
      continue;
    }

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
      left: buildSideSpecLocal(curbWidth + 0.5, 0, curbWidth, curbHeight, 0),
      right: buildSideSpecLocal(curbWidth + 0.5, 0, curbWidth, curbHeight, 0),
    };

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

    const cornerCurbGeom = buildProfiledCurbRibbonGeometry(
      frames,
      1,
      cornerDummyCross,
      baseY,
      rampZones,
      resolvedSampler,
    );
    const cornerCurbMesh = new THREE.Mesh(cornerCurbGeom, materials.curbMaterial);
    cornerCurbMesh.name = `IntersectionCurbCorner_${q.label}`;
    cornerCurbMesh.userData.isSidewalkSurface = true;
    cornerCurbMesh.castShadow = true;
    cornerCurbMesh.receiveShadow = true;
    group.add(cornerCurbMesh);

    const slabResult = buildRampedCornerSlabGeometry(
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
      rampZones,
      resolvedSampler,
    );
    const swSlabMesh = new THREE.Mesh(slabResult.geometry, materials.sidewalkMaterial);
    swSlabMesh.name = `IntersectionSidewalkCorner_${q.label}`;
    swSlabMesh.userData.isSidewalkSurface = true;
    swSlabMesh.receiveShadow = true;
    group.add(swSlabMesh);

    // コーナー雨水集水桝グレーチング（R カーブ中央のL型側溝へ1基配置）
    let catchBasinCount = 0;
    if (materials.catchBasinMaterial && totalCornerLen >= 2.2) {
      const midArc = totalCornerLen * 0.5;
      const f0 = interpolateFrame(frames, midArc - 0.24);
      const f1 = interpolateFrame(frames, midArc + 0.24);
      const gOffMin = -gutterW * 0.92;
      const gOffMax = -gutterW * 0.08;
      const p0x = f0.pos.x + f0.normal.x * gOffMin;
      const p0z = f0.pos.z + f0.normal.z * gOffMin;
      const p1x = f0.pos.x + f0.normal.x * gOffMax;
      const p1z = f0.pos.z + f0.normal.z * gOffMax;
      const p2x = f1.pos.x + f1.normal.x * gOffMin;
      const p2z = f1.pos.z + f1.normal.z * gOffMin;
      const p3x = f1.pos.x + f1.normal.x * gOffMax;
      const p3z = f1.pos.z + f1.normal.z * gOffMax;
      const yOf = (x: number, z: number) =>
        (resolvedSampler ? resolvedSampler(x, z) : 0) + baseY + 0.007;

      const basinGeo = new THREE.BufferGeometry();
      basinGeo.setAttribute(
        "position",
        new THREE.BufferAttribute(
          new Float32Array([
            p0x,
            yOf(p0x, p0z),
            p0z,
            p1x,
            yOf(p1x, p1z),
            p1z,
            p2x,
            yOf(p2x, p2z),
            p2z,
            p3x,
            yOf(p3x, p3z),
            p3z,
          ]),
          3,
        ),
      );
      basinGeo.setAttribute(
        "uv",
        new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2),
      );
      basinGeo.setIndex([0, 2, 1, 1, 2, 3]);
      basinGeo.computeVertexNormals();
      basinGeo.computeBoundingSphere();

      const basinMesh = new THREE.Mesh(basinGeo, materials.catchBasinMaterial);
      basinMesh.name = `IntersectionCatchBasinCorner_${q.label}`;
      basinMesh.userData.lodDetailTier = "high";
      group.add(basinMesh);
      catchBasinCount = 1;
    }

    // 点字警告ブロック（十分な奥行がある辺沿い縁石内側に配置・隅切りスラブの実高さへ正確追従）
    const sampleCornerSlabTopY = (lx: number, lz: number): number => {
      const posAttr = slabResult.geometry.getAttribute("position") as THREE.BufferAttribute;
      const idxAttr = slabResult.geometry.getIndex();
      if (!posAttr || !idxAttr) {
        return baseY + curbHeight;
      }
      // 天面ファン三角形のみ（先頭 (boundaryPts.length - 1) 枚）から重心座標で実高さを評価
      const triCount = Math.max(0, idxAttr.count / 3 - 4);
      for (let t = 0; t < triCount; t++) {
        const i0 = idxAttr.getX(t * 3);
        const i1 = idxAttr.getX(t * 3 + 1);
        const i2 = idxAttr.getX(t * 3 + 2);
        const x0 = posAttr.getX(i0);
        const y0 = posAttr.getY(i0);
        const z0 = posAttr.getZ(i0);
        const x1 = posAttr.getX(i1);
        const y1 = posAttr.getY(i1);
        const z1 = posAttr.getZ(i1);
        const x2 = posAttr.getX(i2);
        const y2 = posAttr.getY(i2);
        const z2 = posAttr.getZ(i2);
        const denom = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
        if (Math.abs(denom) < 1e-6) {
          continue;
        }
        const w0 = ((z1 - z2) * (lx - x2) + (x2 - x1) * (lz - z2)) / denom;
        const w1 = ((z2 - z0) * (lx - x2) + (x0 - x2) * (lz - z2)) / denom;
        const w2 = 1 - w0 - w1;
        if (w0 >= -0.05 && w1 >= -0.05 && w2 >= -0.05) {
          return w0 * y0 + w1 * y1 + w2 * y2;
        }
      }
      return (resolvedSampler ? resolvedSampler(lx, lz) : 0) + baseY + curbHeight;
    };

    const buildConformedCornerTile = (
      cx: number,
      cz: number,
      widthX: number,
      lengthZ: number,
      tileName: string,
    ): THREE.Mesh => {
      const hx = widthX * 0.5;
      const hz = lengthZ * 0.5;
      const c00y = sampleCornerSlabTopY(cx - hx, cz - hz) + 0.006;
      const c10y = sampleCornerSlabTopY(cx + hx, cz - hz) + 0.006;
      const c01y = sampleCornerSlabTopY(cx - hx, cz + hz) + 0.006;
      const c11y = sampleCornerSlabTopY(cx + hx, cz + hz) + 0.006;
      const g = new THREE.BufferGeometry();
      g.setAttribute(
        "position",
        new THREE.BufferAttribute(
          new Float32Array([
            cx - hx,
            c00y,
            cz - hz,
            cx + hx,
            c10y,
            cz - hz,
            cx - hx,
            c01y,
            cz + hz,
            cx + hx,
            c11y,
            cz + hz,
          ]),
          3,
        ),
      );
      g.setAttribute(
        "uv",
        new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2),
      );
      g.setIndex([0, 2, 1, 1, 2, 3]);
      g.computeVertexNormals();
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, materials.brailleMaterial);
      mesh.name = tileName;
      mesh.userData.markingType = "TactilePaving";
      mesh.userData.lodDetailTier = "high";
      return mesh;
    };

    let tactilePadCount = 0;
    const hasBrailleSpace = totalCornerLen > 3.0 && minCornerDim >= 2.0;
    if (hasBrailleSpace && defaultCrosswalks) {
      const nsTileZ = q.sz * Math.min(halfD - 1.2, ewHalfRoad + filletR + 0.6);
      const nsTileX = q.sx * (nsHalfRoad + curbWidth + 0.42);
      if (hasNsCrosswalk && Math.abs(nsTileX) < halfW - 0.35 && Math.abs(nsTileZ) < halfD - 0.9) {
        group.add(
          buildConformedCornerTile(
            nsTileX,
            nsTileZ,
            0.6,
            1.6,
            `IntersectionTactileCorner_${q.label}_NS`,
          ),
        );
        tactilePadCount += 1;
      }

      const ewTileX = q.sx * Math.min(halfW - 1.2, nsHalfRoad + filletR + 0.6);
      const ewTileZ = q.sz * (ewHalfRoad + curbWidth + 0.42);
      if (hasEwCrosswalk && Math.abs(ewTileZ) < halfD - 0.35 && Math.abs(ewTileX) < halfW - 0.9) {
        group.add(
          buildConformedCornerTile(
            ewTileX,
            ewTileZ,
            1.6,
            0.6,
            `IntersectionTactileCorner_${q.label}_EW`,
          ),
        );
        tactilePadCount += 1;
      }
    }

    // 安全な物理コーナーコライダー
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

    const worldPoly = slabResult.polygonLocal.map((p) => ({
      x: config.x + p.x,
      z: config.z + p.z,
    }));
    const sideKey: SidewalkSideTag = `corner_${q.label}`;
    const midPt = worldPoly[Math.floor(worldPoly.length * 0.5)] ?? worldPoly[0];
    records.push({
      id: `${meta.roadId}_${sideKey}`,
      roadId: meta.roadId,
      roadName: meta.roadName,
      kind: "intersection_corner",
      side: sideKey,
      presetId: meta.presetId,
      pavingStyle: meta.pavingStyle,
      widthMeters: minCornerDim,
      curbHeightMeters: curbHeight,
      lengthMeters: Math.max(0.5, totalCornerLen),
      areaSqMeters: slabResult.areaSqMeters,
      rampCount: rampZones.length,
      tactilePadCount,
      catchBasinCount,
      hasGuardrail: false,
      polygonXZ: worldPoly,
      walkableSpine: [
        {
          x: midPt.x,
          y:
            (config.elevationSampler ? config.elevationSampler(midPt.x, midPt.z) : 0) +
            baseY +
            curbHeight,
          z: midPt.z,
          tx: -q.sz,
          tz: q.sx,
          widthMeters: minCornerDim,
        },
      ],
      bounds: computePolygonBounds2D(worldPoly),
    });
  }

  return { group, cornerColliders, records };
}

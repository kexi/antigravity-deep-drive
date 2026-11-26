import * as THREE from "three";
import type { RoadFrame } from "../roadCrossSection";
import { leftNormal2D } from "./junctionTopology";
import type { JunctionTopology } from "./laneSchema";

/**
 * 統一 3D 路面標示の標高レイヤーオフセット（Z-fighting を防ぐ単一基準）
 */
export const MARKING_Y_LAYERS = {
  longitudinal: 0.019,
  zebraChevron: 0.021,
  transverseAndSymbols: 0.023,
  intersectionMarks: 0.022,
} as const;

export type ElevationEvalFn = (x: number, z: number, offsetY: number) => number;

/**
 * 複数の路面標示プリミティブ（クワッド・三角形）を 1 つの BufferGeometry にバッチ結合するビルダー。
 * Why バッチ結合するか:
 * 個別 PlaneGeometry を 1 本ずつ Mesh 化すると都市全体で数千ドローコールになり、
 * さらに後から drapeObjectOverElevation でジオメトリを複製するとメモリとロード時間が増大するため、
 * 生成時点で直接 elevationSampler(x, z) を評価して共有マテリアル対応の最小ドローコールへ統合する。
 */
export class MarkingGeometryBatcher {
  private readonly positions: number[] = [];
  private readonly uvs: number[] = [];
  private readonly indices: number[] = [];

  public get vertexCount(): number {
    return this.positions.length / 3;
  }

  public addQuad(
    p0: readonly [number, number, number],
    p1: readonly [number, number, number],
    p2: readonly [number, number, number],
    p3: readonly [number, number, number],
    u0 = 0,
    u1 = 1,
    v0 = 0,
    v1 = 1,
  ): void {
    const base = this.positions.length / 3;
    this.positions.push(
      p0[0],
      p0[1],
      p0[2],
      p1[0],
      p1[1],
      p1[2],
      p2[0],
      p2[1],
      p2[2],
      p3[0],
      p3[1],
      p3[2],
    );
    this.uvs.push(u0, v0, u1, v0, u0, v1, u1, v1);
    // 反時計回り（+Y 上向き法線）
    this.indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }

  public addOrientedRect(
    cx: number,
    cz: number,
    dirX: number,
    dirZ: number,
    widthAlongNormal: number,
    lengthAlongDir: number,
    yOffset: number,
    evalY: ElevationEvalFn,
    subdivLength = 1,
  ): void {
    const len = Math.hypot(dirX, dirZ);
    const tx = len > 1e-6 ? dirX / len : 0;
    const tz = len > 1e-6 ? dirZ / len : 1;
    const n = leftNormal2D(tx, tz);
    const halfW = widthAlongNormal * 0.5;
    const halfL = lengthAlongDir * 0.5;
    const steps = Math.max(1, subdivLength);

    for (let i = 0; i < steps; i++) {
      const f0 = -halfL + (lengthAlongDir * i) / steps;
      const f1 = -halfL + (lengthAlongDir * (i + 1)) / steps;
      const x00 = cx + tx * f0 - n.x * halfW;
      const z00 = cz + tz * f0 - n.z * halfW;
      const x10 = cx + tx * f0 + n.x * halfW;
      const z10 = cz + tz * f0 + n.z * halfW;
      const x01 = cx + tx * f1 - n.x * halfW;
      const z01 = cz + tz * f1 - n.z * halfW;
      const x11 = cx + tx * f1 + n.x * halfW;
      const z11 = cz + tz * f1 + n.z * halfW;

      this.addQuad(
        [x00, evalY(x00, z00, yOffset), z00],
        [x10, evalY(x10, z10, yOffset), z10],
        [x01, evalY(x01, z01, yOffset), z01],
        [x11, evalY(x11, z11, yOffset), z11],
        0,
        1,
        i / steps,
        (i + 1) / steps,
      );
    }
  }

  public toBufferGeometry(computeNormals = true): THREE.BufferGeometry {
    const geom = new THREE.BufferGeometry();
    if (this.positions.length === 0) {
      return geom;
    }
    geom.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geom.setAttribute("uv", new THREE.Float32BufferAttribute(this.uvs, 2));
    geom.setIndex(this.indices);
    if (computeNormals) {
      geom.computeVertexNormals();
    } else {
      const normals = new Float32Array(this.positions.length);
      for (let i = 1; i < normals.length; i += 3) {
        normals[i] = 1;
      }
      geom.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    }
    geom.computeBoundingSphere();
    return geom;
  }
}

export function interpolateRoadFrame(
  frames: ReadonlyArray<RoadFrame>,
  targetArc: number,
): RoadFrame {
  const first = frames[0];
  const last = frames[frames.length - 1];
  const clamped = Math.max(first.arcLen, Math.min(last.arcLen, targetArc));
  let lo = 0;
  let hi = frames.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].arcLen < clamped) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const i0 = Math.max(0, lo - 1);
  const i1 = Math.min(frames.length - 1, lo);
  if (i0 === i1) {
    return frames[i0];
  }
  const f0 = frames[i0];
  const f1 = frames[i1];
  const span = f1.arcLen - f0.arcLen;
  const r = span > 1e-4 ? (clamped - f0.arcLen) / span : 0;
  return {
    pos: f0.pos.clone().lerp(f1.pos, r),
    tangent: f0.tangent.clone().lerp(f1.tangent, r).normalize(),
    normal: f0.normal.clone().lerp(f1.normal, r).normalize(),
    arcLen: clamped,
  };
}

/**
 * 連続実線リボン（一定または可変オフセット）を MarkingGeometryBatcher へ追加する。
 */
export function addSolidRibbon(
  batcher: MarkingGeometryBatcher,
  frames: ReadonlyArray<RoadFrame>,
  arcStart: number,
  arcEnd: number,
  offsetLeft: number,
  offsetRight: number,
  yOffset: number,
  evalY: ElevationEvalFn,
  stepMeters = 4.0,
): void {
  const span = arcEnd - arcStart;
  if (span <= 0.1 || frames.length < 2) {
    return;
  }
  const steps = Math.max(1, Math.min(260, Math.ceil(span / Math.max(0.5, stepMeters))));
  let prevFrame = interpolateRoadFrame(frames, arcStart);

  for (let i = 1; i <= steps; i++) {
    const arc = arcStart + (span * i) / steps;
    const currFrame = interpolateRoadFrame(frames, arc);

    const p0x = prevFrame.pos.x + prevFrame.normal.x * offsetLeft;
    const p0z = prevFrame.pos.z + prevFrame.normal.z * offsetLeft;
    const p1x = prevFrame.pos.x + prevFrame.normal.x * offsetRight;
    const p1z = prevFrame.pos.z + prevFrame.normal.z * offsetRight;
    const p2x = currFrame.pos.x + currFrame.normal.x * offsetLeft;
    const p2z = currFrame.pos.z + currFrame.normal.z * offsetLeft;
    const p3x = currFrame.pos.x + currFrame.normal.x * offsetRight;
    const p3z = currFrame.pos.z + currFrame.normal.z * offsetRight;

    batcher.addQuad(
      [p0x, evalY(p0x, p0z, yOffset), p0z],
      [p1x, evalY(p1x, p1z, yOffset), p1z],
      [p2x, evalY(p2x, p2z, yOffset), p2z],
      [p3x, evalY(p3x, p3z, yOffset), p3z],
      0,
      1,
      prevFrame.arcLen * 0.2,
      currFrame.arcLen * 0.2,
    );
    prevFrame = currFrame;
  }
}

/**
 * 弧長に応じて横位置がテーパー変化する実線リボン（右折ポケットシフト線・導流帯外枠用）を追加する。
 */
export function addVariableOffsetRibbon(
  batcher: MarkingGeometryBatcher,
  frames: ReadonlyArray<RoadFrame>,
  arcStart: number,
  arcEnd: number,
  centerOffsetAtArc: (arc: number) => number,
  lineWidth: number,
  yOffset: number,
  evalY: ElevationEvalFn,
  stepMeters = 2.0,
): void {
  const span = arcEnd - arcStart;
  if (span <= 0.1 || frames.length < 2) {
    return;
  }
  const halfW = lineWidth * 0.5;
  const steps = Math.max(2, Math.min(240, Math.ceil(span / Math.max(0.5, stepMeters))));
  let prevArc = arcStart;
  let prevFrame = interpolateRoadFrame(frames, prevArc);
  let prevOff = centerOffsetAtArc(prevArc);

  for (let i = 1; i <= steps; i++) {
    const currArc = arcStart + (span * i) / steps;
    const currFrame = interpolateRoadFrame(frames, currArc);
    const currOff = centerOffsetAtArc(currArc);

    const p0x = prevFrame.pos.x + prevFrame.normal.x * (prevOff - halfW);
    const p0z = prevFrame.pos.z + prevFrame.normal.z * (prevOff - halfW);
    const p1x = prevFrame.pos.x + prevFrame.normal.x * (prevOff + halfW);
    const p1z = prevFrame.pos.z + prevFrame.normal.z * (prevOff + halfW);
    const p2x = currFrame.pos.x + currFrame.normal.x * (currOff - halfW);
    const p2z = currFrame.pos.z + currFrame.normal.z * (currOff - halfW);
    const p3x = currFrame.pos.x + currFrame.normal.x * (currOff + halfW);
    const p3z = currFrame.pos.z + currFrame.normal.z * (currOff + halfW);

    batcher.addQuad(
      [p0x, evalY(p0x, p0z, yOffset), p0z],
      [p1x, evalY(p1x, p1z, yOffset), p1z],
      [p2x, evalY(p2x, p2z, yOffset), p2z],
      [p3x, evalY(p3x, p3z, yOffset), p3z],
      0,
      1,
      prevArc * 0.2,
      currArc * 0.2,
    );
    prevArc = currArc;
    prevFrame = currFrame;
    prevOff = currOff;
  }
}

/**
 * 破線リボン（白破線 5m/5m または 4m/4m）を除外弧長区間（進路変更禁止区間等）を完全に避けて追加する。
 */
export function addDashedRibbon(
  batcher: MarkingGeometryBatcher,
  frames: ReadonlyArray<RoadFrame>,
  arcStart: number,
  arcEnd: number,
  centerOffset: number,
  lineWidth: number,
  yOffset: number,
  evalY: ElevationEvalFn,
  options: {
    dashLength?: number;
    gapLength?: number;
    excludeArcRanges?: ReadonlyArray<readonly [number, number]>;
  } = {},
): void {
  const dashLength = options.dashLength ?? 5.0;
  const gapLength = options.gapLength ?? 5.0;
  const excludeRanges = options.excludeArcRanges ?? [];
  const cycle = dashLength + gapLength;
  const halfW = lineWidth * 0.5;
  if (arcEnd - arcStart < dashLength) {
    return;
  }

  for (let s = arcStart; s + dashLength <= arcEnd; s += cycle) {
    const dashEnd = s + dashLength;
    const isExcluded = excludeRanges.some(
      ([ex0, ex1]) => dashEnd > Math.min(ex0, ex1) && s < Math.max(ex0, ex1),
    );
    if (isExcluded) {
      continue;
    }
    addSolidRibbon(
      batcher,
      frames,
      s,
      dashEnd,
      centerOffset - halfW,
      centerOffset + halfW,
      yOffset,
      evalY,
      1.25,
    );
  }
}

/**
 * 日本の幹線交差点右折ポケット手前の中央ゼブラ導流帯（指示標示 208の2：外枠白実線＋斜め縞）を
 * スプライン曲線・3D起伏地形へ完全追従させて生成する。
 */
export function addChevronZebraZone(
  batcher: MarkingGeometryBatcher,
  frames: ReadonlyArray<RoadFrame>,
  arcStart: number,
  arcEnd: number,
  halfWidthAtArc: (arc: number) => number,
  yOffset: number,
  evalY: ElevationEvalFn,
  options: {
    stripePitch?: number;
    stripeThickness?: number;
    borderWidth?: number;
    slantSign?: -1 | 1;
  } = {},
): void {
  const span = arcEnd - arcStart;
  if (span < 3.0 || frames.length < 2) {
    return;
  }
  const stripePitch = options.stripePitch ?? 1.75;
  const stripeThickness = options.stripeThickness ?? 0.34;
  const borderWidth = options.borderWidth ?? 0.16;
  const slantSign = options.slantSign ?? 1;

  // 外枠の左右白実線
  addVariableOffsetRibbon(
    batcher,
    frames,
    arcStart,
    arcEnd,
    (arc) => -Math.max(0.28, halfWidthAtArc(arc) - borderWidth * 0.5),
    borderWidth,
    yOffset,
    evalY,
    1.5,
  );
  addVariableOffsetRibbon(
    batcher,
    frames,
    arcStart,
    arcEnd,
    (arc) => Math.max(0.28, halfWidthAtArc(arc) - borderWidth * 0.5),
    borderWidth,
    yOffset,
    evalY,
    1.5,
  );

  // 内側の斜めゼブラ縞（外枠内側に綺麗に収める）
  for (let s = arcStart + 1.0; s <= arcEnd - 1.0; s += stripePitch) {
    const hw = Math.max(0.2, halfWidthAtArc(s) - borderWidth - 0.08);
    if (hw < 0.22) {
      continue;
    }
    const slantAdvance = Math.min(hw * 0.85, 0.95) * slantSign;
    const sLeft = Math.max(arcStart + 0.3, Math.min(arcEnd - 0.3, s - slantAdvance));
    const sRight = Math.max(arcStart + 0.3, Math.min(arcEnd - 0.3, s + slantAdvance));
    const fL0 = interpolateRoadFrame(frames, sLeft - stripeThickness * 0.5);
    const fL1 = interpolateRoadFrame(frames, sLeft + stripeThickness * 0.5);
    const fR0 = interpolateRoadFrame(frames, sRight - stripeThickness * 0.5);
    const fR1 = interpolateRoadFrame(frames, sRight + stripeThickness * 0.5);

    const p0x = fL0.pos.x - fL0.normal.x * hw;
    const p0z = fL0.pos.z - fL0.normal.z * hw;
    const p1x = fR0.pos.x + fR0.normal.x * hw;
    const p1z = fR0.pos.z + fR0.normal.z * hw;
    const p2x = fL1.pos.x - fL1.normal.x * hw;
    const p2z = fL1.pos.z - fL1.normal.z * hw;
    const p3x = fR1.pos.x + fR1.normal.x * hw;
    const p3z = fR1.pos.z + fR1.normal.z * hw;

    batcher.addQuad(
      [p0x, evalY(p0x, p0z, yOffset), p0z],
      [p1x, evalY(p1x, p1z, yOffset), p1z],
      [p2x, evalY(p2x, p2z, yOffset), p2z],
      [p3x, evalY(p3x, p3z, yOffset), p3z],
      0,
      1,
      0,
      1,
    );
  }
}

/**
 * 交差点内の右折誘導破線アーク（2次ベジェ曲線上の白ドット帯）をバッチ生成する。
 */
export function buildJunctionTurnGuideArcsMesh(
  topology: JunctionTopology,
  whitePaintMat: THREE.Material,
  options: {
    elevationSampler?: (x: number, z: number) => number;
    centerTerrainY?: number;
    localY?: number;
  } = {},
): THREE.Mesh | null {
  if (topology.isScramble || !topology.hasGuideDots || topology.turnGuideArcs.length === 0) {
    return null;
  }
  const rightTurnArcs = topology.turnGuideArcs.filter((a) => a.kind === "right_turn");
  if (rightTurnArcs.length === 0) {
    return null;
  }

  const batcher = new MarkingGeometryBatcher();
  const sampleY = options.elevationSampler;
  const refY = options.centerTerrainY ?? (sampleY ? sampleY(topology.x, topology.z) : 0);
  const localY = options.localY ?? 0.0005;
  const centerClearance = topology.hasCenterDiamond ? 1.55 : 0.45;
  const evalLocalY: ElevationEvalFn = (lx, lz, offY) =>
    (sampleY ? sampleY(topology.x + lx, topology.z + lz) - refY : 0) + offY;

  for (const arc of rightTurnArcs) {
    const [p0, p1, p2] = arc.controlPoints;
    const sampleCount = 20;
    const pts: Array<{ x: number; z: number; s: number }> = [];
    let cumS = 0;
    for (let i = 0; i <= sampleCount; i++) {
      const t = i / sampleCount;
      const u = 1 - t;
      const lx = u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x - topology.x;
      const lz = u * u * p0.z + 2 * u * t * p1.z + t * t * p2.z - topology.z;
      if (i > 0) {
        cumS += Math.hypot(lx - pts[i - 1].x, lz - pts[i - 1].z);
      }
      pts.push({ x: lx, z: lz, s: cumS });
    }
    if (cumS < 3.5) {
      continue;
    }

    const dashLen = 0.78;
    const gapLen = 1.15;
    const cycle = dashLen + gapLen;
    for (let s = 1.1; s + dashLen <= cumS - 1.1; s += cycle) {
      const midS = s + dashLen * 0.5;
      let segIdx = 0;
      while (segIdx < pts.length - 2 && pts[segIdx + 1].s < midS) {
        segIdx += 1;
      }
      const a = pts[segIdx];
      const b = pts[segIdx + 1];
      const segSpan = Math.max(1e-4, b.s - a.s);
      const ratio = Math.max(0, Math.min(1, (midS - a.s) / segSpan));
      const cx = a.x + (b.x - a.x) * ratio;
      const cz = a.z + (b.z - a.z) * ratio;
      const isNearCenterDiamond = Math.hypot(cx, cz) < centerClearance;
      if (isNearCenterDiamond) {
        continue;
      }
      batcher.addOrientedRect(cx, cz, b.x - a.x, b.z - a.z, 0.14, dashLen, localY, evalLocalY, 1);
    }
  }

  if (batcher.vertexCount === 0) {
    return null;
  }

  const mesh = new THREE.Mesh(batcher.toBufferGeometry(Boolean(sampleY)), whitePaintMat);
  mesh.name = `IntersectionTurnGuideArcs_${topology.id}`;
  mesh.userData.markingType = "IntersectionTurnGuide";
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * 任意角度アーム（斜交交差点・Y字路・5叉路等）の横断歩道・左側通行停止線・右折誘導アークを
 * 交差点ローカル座標系（原点が topology.x, topology.z）で一括構築する。
 */
export function buildArbitraryAngleJunctionMarkings(
  topology: JunctionTopology,
  whitePaintMat: THREE.Material,
  options: {
    elevationSampler?: (x: number, z: number) => number;
    centerTerrainY?: number;
  } = {},
): THREE.Group {
  const group = new THREE.Group();
  group.name = "IntersectionMarkings";
  group.position.y = MARKING_Y_LAYERS.intersectionMarks;

  const sampleY = options.elevationSampler;
  const refY = options.centerTerrainY ?? (sampleY ? sampleY(topology.x, topology.z) : 0);
  const evalLocalY: ElevationEvalFn = (lx, lz, offY) =>
    (sampleY ? sampleY(topology.x + lx, topology.z + lz) - refY : 0) + offY;

  const cwDepth = 3.0;
  const stripeW = 0.45;
  const stripeGap = 0.45;
  const step = stripeW + stripeGap;

  for (const arm of topology.arms) {
    const outX = Math.sin(arm.angleRad);
    const outZ = Math.cos(arm.angleRad);
    const lat = leftNormal2D(outX, outZ);

    if (arm.hasCrosswalk) {
      const span = Math.max(2.2, arm.maxCrosswalkHalfSpan * 2);
      const count = Math.max(2, Math.floor((span + stripeGap) / step));
      const totalSpan = count * stripeW + (count - 1) * stripeGap;
      const startLat = -totalSpan * 0.5 + stripeW * 0.5;
      const cwBatcher = new MarkingGeometryBatcher();

      for (let i = 0; i < count; i++) {
        const latOff = startLat + i * step;
        const cx = outX * arm.crosswalkDistanceFromCenter + lat.x * latOff;
        const cz = outZ * arm.crosswalkDistanceFromCenter + lat.z * latOff;
        cwBatcher.addOrientedRect(
          cx,
          cz,
          outX,
          outZ,
          stripeW,
          cwDepth,
          0,
          evalLocalY,
          sampleY ? 2 : 1,
        );
      }
      if (cwBatcher.vertexCount > 0) {
        const cwMesh = new THREE.Mesh(cwBatcher.toBufferGeometry(Boolean(sampleY)), whitePaintMat);
        cwMesh.name = `IntersectionCrosswalk_Arm_${arm.armId}`;
        cwMesh.userData.markingType = "CrosswalkStripe";
        cwMesh.receiveShadow = true;
        group.add(cwMesh);
      }
    }

    if (arm.hasStopLine && arm.inboundLaneCount > 0) {
      // 交差点へ進入する車両の向きは inDir = (-outX, -outZ)、日本の左側通行車線は left(inDir) = (-lat.x, -lat.z)
      const inLeftX = -lat.x;
      const inLeftZ = -lat.z;
      const stopDist = arm.crosswalkDistanceFromCenter + cwDepth * 0.5 + 0.7;
      const halfSpan = Math.max(
        1.4,
        Math.min(arm.carriagewayWidth * 0.5, arm.maxCrosswalkHalfSpan) - 0.5,
      );
      const stopCenterLat = 0.25 + halfSpan * 0.5;
      const sx = outX * stopDist + inLeftX * stopCenterLat;
      const sz = outZ * stopDist + inLeftZ * stopCenterLat;

      const stopBatcher = new MarkingGeometryBatcher();
      stopBatcher.addOrientedRect(sx, sz, outX, outZ, halfSpan, 0.4, 0, evalLocalY, 1);
      if (stopBatcher.vertexCount > 0) {
        const stopMesh = new THREE.Mesh(
          stopBatcher.toBufferGeometry(Boolean(sampleY)),
          whitePaintMat,
        );
        stopMesh.name = `IntersectionStopLine_Arm_${arm.armId}`;
        stopMesh.userData.markingType = "IntersectionStopLine";
        stopMesh.receiveShadow = true;
        group.add(stopMesh);
      }
    }
  }

  const turnArcMesh = buildJunctionTurnGuideArcsMesh(topology, whitePaintMat, {
    elevationSampler: sampleY,
    centerTerrainY: refY,
  });
  if (turnArcMesh) {
    group.add(turnArcMesh);
  }

  return group;
}

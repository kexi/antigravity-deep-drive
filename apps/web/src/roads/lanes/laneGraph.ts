import * as THREE from "three";
import type { RoadFrame } from "../roadCrossSection";
import { evaluateLaneCrossSectionAt } from "./laneProfile";
import { leftNormal2D } from "./junctionTopology";
import type {
  JunctionConnectionArc,
  JunctionTopology,
  LaneCenterlineSample,
  LaneGraph,
  LaneGraphEdge,
  RoadLaneProfile,
} from "./laneSchema";

function interpolateFrame(frames: ReadonlyArray<RoadFrame>, targetArc: number): RoadFrame {
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

function findNearestJunctionId(
  x: number,
  z: number,
  junctions: ReadonlyArray<JunctionTopology>,
  maxRadius = 28.0,
): string | null {
  let bestId: string | null = null;
  let bestDist = maxRadius;
  for (const j of junctions) {
    const d = Math.hypot(x - j.x, z - j.z);
    const threshold = Math.max(j.widthX, j.depthZ) * 0.65 + 10.0;
    if (d < Math.min(bestDist, threshold)) {
      bestDist = d;
      bestId = j.id;
    }
  }
  return bestId;
}

/**
 * 任意の道路セグメント（直線・曲線共通）から 3D 車線中心線グラフ（LaneGraphEdge[]）を抽出する。
 * 将来の AI トラフィック走行・車載ナビ車線案内・?debugLanes=1 デバッグ可視化が共有する SSOT データ。
 */
export function extractRoadLaneGraphEdges(
  profile: RoadLaneProfile,
  frames: ReadonlyArray<RoadFrame>,
  options: {
    elevationSampler?: (x: number, z: number) => number;
    baseY?: number;
    junctions?: ReadonlyArray<JunctionTopology>;
    worldTransform?: { position: THREE.Vector3; rotationY: number };
    sampleStepM?: number;
  } = {},
): LaneGraphEdge[] {
  if (frames.length < 2) {
    return [];
  }

  const baseY = options.baseY ?? 0.015;
  const sampleStepM = Math.max(2.0, options.sampleStepM ?? 6.0);
  const junctions = options.junctions ?? [];
  const wt = options.worldTransform;
  const cosR = wt ? Math.cos(wt.rotationY) : 1;
  const sinR = wt ? Math.sin(wt.rotationY) : 0;

  const toWorldPoint = (lx: number, lz: number): { x: number; z: number } => {
    if (!wt) {
      return { x: lx, z: lz };
    }
    return {
      x: wt.position.x + lx * cosR + lz * sinR,
      z: wt.position.z - lx * sinR + lz * cosR,
    };
  };

  const toWorldDir = (tx: number, tz: number): { tx: number; tz: number } => {
    if (!wt) {
      return { tx, tz };
    }
    return {
      tx: tx * cosR + tz * sinR,
      tz: -tx * sinR + tz * cosR,
    };
  };

  const minArc = frames[0].arcLen;
  const maxArc = frames[frames.length - 1].arcLen;
  const totalSpan = maxArc - minArc;
  if (totalSpan < 1.0) {
    return [];
  }

  const baseCross = evaluateLaneCrossSectionAt(profile, profile.totalLength * 0.5);
  const startFrame = frames[0];
  const endFrame = frames[frames.length - 1];
  const startWorld = toWorldPoint(startFrame.pos.x, startFrame.pos.z);
  const endWorld = toWorldPoint(endFrame.pos.x, endFrame.pos.z);
  const startJunctionId = findNearestJunctionId(startWorld.x, startWorld.z, junctions);
  const endJunctionId = findNearestJunctionId(endWorld.x, endWorld.z, junctions);

  const steps = Math.max(2, Math.ceil(totalSpan / sampleStepM));
  const edges: LaneGraphEdge[] = [];

  const buildDirectionEdges = (direction: "inbound" | "oncoming", baseLaneCount: number): void => {
    for (let laneIndex = 0; laneIndex < baseLaneCount; laneIndex++) {
      const laneId = `${profile.roadId}:${direction}:${laneIndex}`;
      const samples: LaneCenterlineSample[] = [];
      let resolvedArrow =
        direction === "inbound"
          ? (baseCross.inboundLanes[laneIndex]?.arrow ?? "straight")
          : (baseCross.oncomingLanes[laneIndex]?.arrow ?? "straight");
      let resolvedSpeed = profile.speedLimit;

      for (let i = 0; i <= steps; i++) {
        const frac = direction === "inbound" ? i / steps : 1 - i / steps;
        const arc = minArc + frac * totalSpan;
        const profileS = Math.max(0, Math.min(profile.totalLength, arc - minArc));
        const cross = evaluateLaneCrossSectionAt(profile, profileS);
        const slots = direction === "inbound" ? cross.inboundLanes : cross.oncomingLanes;
        const slot = slots[Math.min(laneIndex, slots.length - 1)];
        if (!slot) {
          continue;
        }
        if (i === steps) {
          resolvedArrow = slot.arrow;
          resolvedSpeed = slot.speedLimit;
        }

        const f = interpolateFrame(frames, arc);
        const lx = f.pos.x + f.normal.x * slot.centerOffset;
        const lz = f.pos.z + f.normal.z * slot.centerOffset;
        const wp = toWorldPoint(lx, lz);
        const rawTx = direction === "inbound" ? f.tangent.x : -f.tangent.x;
        const rawTz = direction === "inbound" ? f.tangent.z : -f.tangent.z;
        const wd = toWorldDir(rawTx, rawTz);
        const groundY = options.elevationSampler
          ? options.elevationSampler(wp.x, wp.z)
          : (wt?.position.y ?? 0);

        samples.push({
          x: wp.x,
          y: groundY + baseY,
          z: wp.z,
          s: (i / steps) * totalSpan,
          tx: wd.tx,
          tz: wd.tz,
          width: slot.width,
        });
      }

      if (samples.length < 2) {
        continue;
      }

      // 日本の左側通行では laneIndex 0 = 中央寄り(右端)、laneIndex n-1 = 歩道寄り(左端)
      const leftAdjacentLaneId =
        laneIndex + 1 < baseLaneCount ? `${profile.roadId}:${direction}:${laneIndex + 1}` : null;
      const rightAdjacentLaneId =
        laneIndex - 1 >= 0 ? `${profile.roadId}:${direction}:${laneIndex - 1}` : null;

      edges.push({
        laneId,
        roadId: profile.roadId,
        roadName: profile.roadName,
        direction,
        laneIndex,
        arrow: resolvedArrow,
        speedLimit: resolvedSpeed,
        leftAdjacentLaneId,
        rightAdjacentLaneId,
        startJunctionId: direction === "inbound" ? startJunctionId : endJunctionId,
        endJunctionId: direction === "inbound" ? endJunctionId : startJunctionId,
        samples,
      });
    }
  };

  buildDirectionEdges("inbound", baseCross.inboundLanes.length);
  buildDirectionEdges("oncoming", baseCross.oncomingLanes.length);

  return edges;
}

/**
 * JunctionTopology 内の 2 次ベジェ導線（turnGuideArcs）を 3D ポリライン（JunctionConnectionArc[]）へ変換する。
 */
export function extractJunctionConnectionArcs(
  junction: JunctionTopology,
  elevationSampler?: (x: number, z: number) => number,
  baseY = 0.02,
): JunctionConnectionArc[] {
  const arcs: JunctionConnectionArc[] = [];
  const sampleCount = 10;

  for (let idx = 0; idx < junction.turnGuideArcs.length; idx++) {
    const arc = junction.turnGuideArcs[idx];
    const [p0, p1, p2] = arc.controlPoints;
    const samples: Array<{ x: number; y: number; z: number }> = [];
    for (let i = 0; i <= sampleCount; i++) {
      const t = i / sampleCount;
      const u = 1 - t;
      const x = u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x;
      const z = u * u * p0.z + 2 * u * t * p1.z + t * t * p2.z;
      const y = (elevationSampler ? elevationSampler(x, z) : 0) + baseY;
      samples.push({ x, y, z });
    }
    arcs.push({
      id: `${junction.id}:${arc.fromArmId}->${arc.toArmId}:${arc.kind}:${idx}`,
      junctionId: junction.id,
      fromArmId: arc.fromArmId,
      toArmId: arc.toArmId,
      kind: arc.kind,
      samples,
    });
  }

  return arcs;
}

/**
 * URL クエリ `?debugLanes=1` 時にシーンへ重畳する軽量 3D 車線デバッグ可視化グループを構築する。
 * How: 全都市の車線中心線・進行矢印・交差点ポリゴン・右折誘導アークを色別の 4 つの LineSegments に
 * 完全バッチングすることで、FPS 負荷をほぼゼロに抑えつつ全車線トポロジーを一望できる。
 */
export function buildLaneDebugOverlayGroup(
  laneGraph: LaneGraph,
  options: { elevationSampler?: (x: number, z: number) => number } = {},
): THREE.Group {
  const group = new THREE.Group();
  group.name = "LaneDebugOverlay";
  group.userData.isLaneDebugOverlay = true;

  const inboundVerts: number[] = [];
  const oncomingVerts: number[] = [];
  const junctionPolyVerts: number[] = [];
  const junctionArcVerts: number[] = [];
  const armBarVerts: number[] = [];

  const yLift = 0.36;

  // 1. 車線中心線＋進行方向シェブロン矢印
  for (const edge of laneGraph.edges) {
    const target = edge.direction === "inbound" ? inboundVerts : oncomingVerts;
    let nextArrowDist = 12.0;
    for (let i = 0; i < edge.samples.length - 1; i++) {
      const a = edge.samples[i];
      const b = edge.samples[i + 1];
      target.push(a.x, a.y + yLift, a.z, b.x, b.y + yLift, b.z);

      if (b.s >= nextArrowDist) {
        const left = leftNormal2D(b.tx, b.tz);
        const headLen = 1.1;
        const wingW = 0.55;
        const tipX = b.x;
        const tipZ = b.z;
        const tipY = b.y + yLift + 0.04;
        const baseX = b.x - b.tx * headLen;
        const baseZ = b.z - b.tz * headLen;
        target.push(
          tipX,
          tipY,
          tipZ,
          baseX + left.x * wingW,
          tipY,
          baseZ + left.z * wingW,
          tipX,
          tipY,
          tipZ,
          baseX - left.x * wingW,
          tipY,
          baseZ - left.z * wingW,
        );
        nextArrowDist = b.s + 26.0;
      }
    }
  }

  // 2. 交差点境界ポリゴン＆アーム横断歩道バー
  for (const j of laneGraph.junctions) {
    const poly = j.boundaryPolygon;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const ay = (options.elevationSampler ? options.elevationSampler(a.x, a.z) : 0) + yLift + 0.08;
      const by = (options.elevationSampler ? options.elevationSampler(b.x, b.z) : 0) + yLift + 0.08;
      junctionPolyVerts.push(a.x, ay, a.z, b.x, by, b.z);
    }

    for (const arm of j.arms) {
      const outX = Math.sin(arm.angleRad);
      const outZ = Math.cos(arm.angleRad);
      const side = leftNormal2D(outX, outZ);
      const cx = j.x + outX * arm.crosswalkDistanceFromCenter;
      const cz = j.z + outZ * arm.crosswalkDistanceFromCenter;
      const span = arm.maxCrosswalkHalfSpan;
      const p0x = cx - side.x * span;
      const p0z = cz - side.z * span;
      const p1x = cx + side.x * span;
      const p1z = cz + side.z * span;
      const y0 = (options.elevationSampler ? options.elevationSampler(p0x, p0z) : 0) + yLift + 0.06;
      const y1 = (options.elevationSampler ? options.elevationSampler(p1x, p1z) : 0) + yLift + 0.06;
      armBarVerts.push(p0x, y0, p0z, p1x, y1, p1z);
    }
  }

  // 3. 交差点内の右折・直進誘導接続アーク
  for (const arc of laneGraph.junctionArcs) {
    for (let i = 0; i < arc.samples.length - 1; i++) {
      const a = arc.samples[i];
      const b = arc.samples[i + 1];
      junctionArcVerts.push(a.x, a.y + yLift + 0.14, a.z, b.x, b.y + yLift + 0.14, b.z);
    }
  }

  const addLineBatch = (name: string, verts: number[], colorHex: number): void => {
    if (verts.length < 6) {
      return;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    const mat = new THREE.LineBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.92,
      depthTest: true,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.name = name;
    lines.userData.isLaneDebugOverlay = true;
    lines.frustumCulled = false;
    group.add(lines);
  };

  addLineBatch("LaneDebug_InboundCenterlines", inboundVerts, 0x22d3ee);
  addLineBatch("LaneDebug_OncomingCenterlines", oncomingVerts, 0x34d399);
  addLineBatch("LaneDebug_JunctionPolygons", junctionPolyVerts, 0xe879f9);
  addLineBatch("LaneDebug_JunctionTurnArcs", junctionArcVerts, 0xfbbf24);
  addLineBatch("LaneDebug_JunctionArmBars", armBarVerts, 0xffffff);

  return group;
}

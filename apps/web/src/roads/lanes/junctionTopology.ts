import type { RoadFrame } from "../roadCrossSection";
import type { RoadExclusionCorridor } from "../types";
import {
  JunctionTopologySchema,
  type JunctionArmTopology,
  type JunctionTopology,
  type JunctionTurnGuideArc,
  type Point2D,
} from "./laneSchema";

export interface StraightRoadTopologyInput {
  id?: string;
  cx: number;
  cz: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  isEastWest: boolean;
  carriagewayWidth: number;
  lanesPerDirection?: number;
  laneWidth?: number;
  medianWidth?: number;
  hasStopText?: boolean;
}

export interface CurvedCorridorTopologyInput {
  id: string;
  samples: ReadonlyArray<{ x: number; z: number; tx: number; tz: number }>;
  carriagewayWidth: number;
  lanesPerDirection: number;
  laneWidth: number;
  medianWidth: number;
  hasStopText?: boolean;
}

export interface ExplicitJunctionArmInput {
  armId: string;
  roadId?: string;
  angleRad: number;
  carriagewayWidth: number;
  medianWidth?: number;
  inboundLaneCount?: number;
  oncomingLaneCount?: number;
  inboundLaneWidth?: number;
  oncomingLaneWidth?: number;
  hasCrosswalk?: boolean;
  hasStopLine?: boolean;
  hasStopText?: boolean;
}

export interface ResolveJunctionTopologyParams {
  id: string;
  name: string;
  x: number;
  z: number;
  widthX: number;
  depthZ: number;
  lanesX: number;
  lanesZ: number;
  isScramble?: boolean;
  hasCrosswalks?: boolean;
  hasCenterDiamond?: boolean;
  hasGuideDots?: boolean;
  crosswalkN?: boolean;
  crosswalkS?: boolean;
  crosswalkE?: boolean;
  crosswalkW?: boolean;
  straightRoads?: ReadonlyArray<StraightRoadTopologyInput>;
  curvedCorridors?: ReadonlyArray<CurvedCorridorTopologyInput>;
  explicitArms?: ReadonlyArray<ExplicitJunctionArmInput>;
}

/**
 * 2D XZ 平面上の点が多角形内部に含まれるか判定する（レイキャスティング法）。
 */
export function isPointInPolygon2D(
  px: number,
  pz: number,
  polygon: ReadonlyArray<Point2D>,
): boolean {
  const n = polygon.length;
  if (n < 3) {
    return false;
  }
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x;
    const zi = polygon[i].z;
    const xj = polygon[j].x;
    const zj = polygon[j].z;
    const crossesZ = zi > pz !== zj > pz;
    if (!crossesZ) {
      continue;
    }
    const intersectX = ((xj - xi) * (pz - zi)) / (zj - zi + 1e-12) + xi;
    if (px < intersectX) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * 2D XZ 平面上の多角形を重心方向へ均等に縮小した内側コアポリゴンを返す。
 * 交差点ポリゴンの境界ギリギリの丸め誤差を除外しつつ、中心部への車線侵入を厳密に検出するために使う。
 */
export function shrinkPolygon2D(polygon: ReadonlyArray<Point2D>, marginMeters: number): Point2D[] {
  const n = polygon.length;
  if (n < 3 || marginMeters <= 0) {
    return polygon.map((p) => ({ x: p.x, z: p.z }));
  }
  let cx = 0;
  let cz = 0;
  for (const p of polygon) {
    cx += p.x;
    cz += p.z;
  }
  cx /= n;
  cz /= n;

  return polygon.map((p) => {
    const dx = p.x - cx;
    const dz = p.z - cz;
    const dist = Math.hypot(dx, dz);
    if (dist <= 1e-4) {
      return { x: p.x, z: p.z };
    }
    const clampedShrink = Math.min(marginMeters, dist * 0.65);
    const scale = Math.max(0.05, (dist - clampedShrink) / dist);
    return {
      x: cx + dx * scale,
      z: cz + dz * scale,
    };
  });
}

/**
 * 矩形交差点の 2D XZ 境界ポリゴンを生成する。
 */
export function buildRectanglePolygon(
  cx: number,
  cz: number,
  widthX: number,
  depthZ: number,
): Point2D[] {
  const hw = widthX * 0.5;
  const hd = depthZ * 0.5;
  return [
    { x: cx - hw, z: cz - hd },
    { x: cx + hw, z: cz - hd },
    { x: cx + hw, z: cz + hd },
    { x: cx - hw, z: cz + hd },
  ];
}

/**
 * 角度差を [-PI, PI] へ正規化する。
 */
export function normalizeAngleDelta(deltaRad: number): number {
  let d = deltaRad;
  while (d > Math.PI) {
    d -= Math.PI * 2;
  }
  while (d < -Math.PI) {
    d += Math.PI * 2;
  }
  return d;
}

/**
 * 交差点中心から方向 angleRad（outDir = (sin, cos)）へレイを伸ばし、
 * 幅 widthX × 奥行 depthZ の交差点パッド外縁までの距離を算出する。
 */
function rayDistanceToBox(angleRad: number, halfW: number, halfD: number): number {
  const dx = Math.abs(Math.sin(angleRad));
  const dz = Math.abs(Math.cos(angleRad));
  const tx = dx > 1e-4 ? halfW / dx : Infinity;
  const tz = dz > 1e-4 ? halfD / dz : Infinity;
  return Math.min(tx, tz);
}

/**
 * Three.js 右手座標系（+Y 上向き）における進行方向 (tx, tz) の左側法線ベクトル (tz, -tx) を返す。
 * 日本の左側通行において、+Z 進行の左側は +X、-Z 進行の左側は -X、+X 進行の左側は -Z、-X 進行の左側は +Z と一致する。
 */
export function leftNormal2D(tx: number, tz: number): { x: number; z: number } {
  const len = Math.hypot(tx, tz);
  if (len <= 1e-6) {
    return { x: 1, z: 0 };
  }
  return { x: tz / len, z: -tx / len };
}

function minDistanceSqToPolyline2D(
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
    const t =
      lenSq > 1e-8 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / lenSq)) : 0;
    const cx = a.x + dx * t;
    const cz = a.z + dz * t;
    const dSq = (px - cx) ** 2 + (pz - cz) ** 2;
    if (dSq < minSq) {
      minSq = dSq;
    }
  }
  return minSq;
}

/**
 * 直線道路・曲線コリドー・明示アーム定義から交差点の任意角度トポロジー（JunctionTopology）を自動解決する。
 *
 * How:
 * - すべての接続アームの方位角・車道幅・横断歩道配置距離を統一算出し、
 *   隣接アーム間の角度が鋭角な斜交交差点でも隅干渉ゼロとなる maxCrosswalkHalfSpan を導出する。
 * - 主要交差点の右折導線（turnGuideArcs: 2次ベジェ曲線）を左側通行の幾何不変式から自動生成する。
 */
export function resolveJunctionTopology(params: ResolveJunctionTopologyParams): JunctionTopology {
  const halfW = params.widthX * 0.5;
  const halfD = params.depthZ * 0.5;
  const isScramble = Boolean(params.isScramble);
  const hasCrosswalks = params.hasCrosswalks ?? true;
  const hasGuideDots = params.hasGuideDots ?? !isScramble;
  const hasCenterDiamond =
    params.hasCenterDiamond ?? (!isScramble && params.lanesX >= 2 && params.lanesZ >= 2);
  const cwDepth = 3.0;

  interface RawArmCandidate {
    armId: string;
    roadId?: string;
    angleRad: number;
    carriagewayWidth: number;
    medianWidth: number;
    inboundLaneCount: number;
    oncomingLaneCount: number;
    inboundLaneWidth: number;
    oncomingLaneWidth: number;
    hasCrosswalk: boolean;
    hasStopLine: boolean;
    hasStopText: boolean;
  }

  const rawArms: RawArmCandidate[] = [];

  const pushMergedArm = (cand: RawArmCandidate): void => {
    const existing = rawArms.find(
      (a) => Math.abs(normalizeAngleDelta(a.angleRad - cand.angleRad)) < 0.36,
    );
    if (existing) {
      if (cand.carriagewayWidth > existing.carriagewayWidth) {
        existing.carriagewayWidth = cand.carriagewayWidth;
        existing.inboundLaneCount = cand.inboundLaneCount;
        existing.oncomingLaneCount = cand.oncomingLaneCount;
        existing.medianWidth = Math.max(existing.medianWidth, cand.medianWidth);
      }
      return;
    }
    rawArms.push(cand);
  };

  if (params.explicitArms && params.explicitArms.length > 0) {
    for (const ea of params.explicitArms) {
      pushMergedArm({
        armId: ea.armId,
        roadId: ea.roadId,
        angleRad: ea.angleRad,
        carriagewayWidth: Math.max(3.0, ea.carriagewayWidth),
        medianWidth: ea.medianWidth ?? 0,
        inboundLaneCount: ea.inboundLaneCount ?? 2,
        oncomingLaneCount: ea.oncomingLaneCount ?? 2,
        inboundLaneWidth: ea.inboundLaneWidth ?? 3.4,
        oncomingLaneWidth: ea.oncomingLaneWidth ?? 3.4,
        hasCrosswalk: ea.hasCrosswalk ?? hasCrosswalks,
        hasStopLine: ea.hasStopLine ?? hasCrosswalks,
        hasStopText: ea.hasStopText ?? false,
      });
    }
  } else {
    // 1. 直線道路からの接続アーム検出
    for (const r of params.straightRoads ?? []) {
      const lanes =
        r.lanesPerDirection ?? (r.carriagewayWidth >= 18 ? 3 : r.carriagewayWidth >= 12 ? 2 : 1);
      const laneW = r.laneWidth ?? (lanes >= 2 ? 3.5 : 3.25);
      const medW = r.medianWidth ?? 0;
      const stopText = Boolean(r.hasStopText);
      if (!r.isEastWest && Math.abs(r.cx - params.x) <= halfW * 0.65) {
        if (Math.abs(r.minZ - (params.z + halfD)) <= 4.5) {
          pushMergedArm({
            armId: "north",
            roadId: r.id,
            angleRad: 0,
            carriagewayWidth: r.carriagewayWidth,
            medianWidth: medW,
            inboundLaneCount: lanes,
            oncomingLaneCount: lanes,
            inboundLaneWidth: laneW,
            oncomingLaneWidth: laneW,
            hasCrosswalk: hasCrosswalks && (params.crosswalkN ?? true),
            hasStopLine: hasCrosswalks && (params.crosswalkN ?? true),
            hasStopText: stopText,
          });
        }
        if (Math.abs(r.maxZ - (params.z - halfD)) <= 4.5) {
          pushMergedArm({
            armId: "south",
            roadId: r.id,
            angleRad: Math.PI,
            carriagewayWidth: r.carriagewayWidth,
            medianWidth: medW,
            inboundLaneCount: lanes,
            oncomingLaneCount: lanes,
            inboundLaneWidth: laneW,
            oncomingLaneWidth: laneW,
            hasCrosswalk: hasCrosswalks && (params.crosswalkS ?? true),
            hasStopLine: hasCrosswalks && (params.crosswalkS ?? true),
            hasStopText: stopText,
          });
        }
      } else if (r.isEastWest && Math.abs(r.cz - params.z) <= halfD * 0.65) {
        if (Math.abs(r.minX - (params.x + halfW)) <= 4.5) {
          pushMergedArm({
            armId: "east",
            roadId: r.id,
            angleRad: Math.PI / 2,
            carriagewayWidth: r.carriagewayWidth,
            medianWidth: medW,
            inboundLaneCount: lanes,
            oncomingLaneCount: lanes,
            inboundLaneWidth: laneW,
            oncomingLaneWidth: laneW,
            hasCrosswalk: hasCrosswalks && (params.crosswalkE ?? true),
            hasStopLine: hasCrosswalks && (params.crosswalkE ?? true),
            hasStopText: stopText,
          });
        }
        if (Math.abs(r.maxX - (params.x - halfW)) <= 4.5) {
          pushMergedArm({
            armId: "west",
            roadId: r.id,
            angleRad: -Math.PI / 2,
            carriagewayWidth: r.carriagewayWidth,
            medianWidth: medW,
            inboundLaneCount: lanes,
            oncomingLaneCount: lanes,
            inboundLaneWidth: laneW,
            oncomingLaneWidth: laneW,
            hasCrosswalk: hasCrosswalks && (params.crosswalkW ?? true),
            hasStopLine: hasCrosswalks && (params.crosswalkW ?? true),
            hasStopText: stopText,
          });
        }
      }
    }

    // 2. 曲線コリドーの任意角度接続アーム検出
    const probeRadius = Math.max(halfW, halfD) + 10.0;
    const minProbeRadius = Math.max(4.0, Math.min(halfW, halfD) * 0.6);
    for (const cor of params.curvedCorridors ?? []) {
      const n = cor.samples.length;
      if (n < 2) {
        continue;
      }
      // 交差点中心に最も近いサンプル点を探し、近傍なら進入・退出方向を抽出
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let i = 0; i < n; i++) {
        const s = cor.samples[i];
        const d = Math.hypot(s.x - params.x, s.z - params.z);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      const isConnected = bestIdx >= 0 && bestDist <= Math.max(halfW, halfD) + 6.0;
      if (!isConnected) {
        continue;
      }

      // 前方（+index）と後方（-index）へ辿り、交差点外縁付近で外向き方位角を確定する
      for (const stepDir of [-1, 1] as const) {
        let probePt: { x: number; z: number } | null = null;
        for (let idx = bestIdx; idx >= 0 && idx < n; idx += stepDir) {
          const s = cor.samples[idx];
          const d = Math.hypot(s.x - params.x, s.z - params.z);
          if (d >= minProbeRadius && d <= probeRadius) {
            probePt = s;
            if (d >= Math.min(halfW, halfD) + 2.0) {
              break;
            }
          }
        }
        if (!probePt) {
          continue;
        }
        const outAngle = Math.atan2(probePt.x - params.x, probePt.z - params.z);
        pushMergedArm({
          armId: `${cor.id}_${stepDir > 0 ? "fwd" : "bwd"}`,
          roadId: cor.id,
          angleRad: outAngle,
          carriagewayWidth: Math.max(4.0, cor.carriagewayWidth),
          medianWidth: cor.medianWidth,
          inboundLaneCount: cor.lanesPerDirection,
          oncomingLaneCount: cor.lanesPerDirection,
          inboundLaneWidth: cor.laneWidth,
          oncomingLaneWidth: cor.laneWidth,
          hasCrosswalk: hasCrosswalks,
          hasStopLine: hasCrosswalks,
          hasStopText: Boolean(cor.hasStopText),
        });
      }
    }

    // 3. 直交交差点で明示道路が未登録の場合は標準 4 方向アームで補完する
    if (rawArms.length === 0) {
      const laneWX = params.lanesX >= 2 ? 3.5 : 3.25;
      const laneWZ = params.lanesZ >= 2 ? 3.5 : 3.25;
      const cwX = params.lanesX * 2 * laneWX;
      const cwZ = params.lanesZ * 2 * laneWZ;
      const cardinals: Array<{
        id: string;
        angle: number;
        cw: number;
        lanes: number;
        lw: number;
        enabled: boolean;
      }> = [
        {
          id: "north",
          angle: 0,
          cw: cwX,
          lanes: params.lanesX,
          lw: laneWX,
          enabled: params.crosswalkN ?? true,
        },
        {
          id: "south",
          angle: Math.PI,
          cw: cwX,
          lanes: params.lanesX,
          lw: laneWX,
          enabled: params.crosswalkS ?? true,
        },
        {
          id: "east",
          angle: Math.PI / 2,
          cw: cwZ,
          lanes: params.lanesZ,
          lw: laneWZ,
          enabled: params.crosswalkE ?? true,
        },
        {
          id: "west",
          angle: -Math.PI / 2,
          cw: cwZ,
          lanes: params.lanesZ,
          lw: laneWZ,
          enabled: params.crosswalkW ?? true,
        },
      ];
      for (const c of cardinals) {
        if (!c.enabled) {
          continue;
        }
        pushMergedArm({
          armId: c.id,
          angleRad: c.angle,
          carriagewayWidth: c.cw,
          medianWidth: 0,
          inboundLaneCount: c.lanes,
          oncomingLaneCount: c.lanes,
          inboundLaneWidth: c.lw,
          oncomingLaneWidth: c.lw,
          hasCrosswalk: hasCrosswalks,
          hasStopLine: hasCrosswalks,
          hasStopText: false,
        });
      }
    }
  }

  rawArms.sort((a, b) => a.angleRad - b.angleRad);

  // 各アームの横断歩道距離および隣接アームと隅干渉しない安全最大半幅を算出
  const resolvedArms: JunctionArmTopology[] = rawArms.map((arm, idx) => {
    const boxDist = rayDistanceToBox(arm.angleRad, halfW, halfD);
    const crosswalkDistanceFromCenter = Math.max(3.2, boxDist - cwDepth * 0.5 - 1.35);

    let minDeltaAngle = Math.PI * 0.5;
    let nearestAdjDist = Math.min(halfW, halfD);
    if (rawArms.length >= 2) {
      const prev = rawArms[(idx - 1 + rawArms.length) % rawArms.length];
      const next = rawArms[(idx + 1) % rawArms.length];
      const dPrev = Math.abs(normalizeAngleDelta(arm.angleRad - prev.angleRad));
      const dNext = Math.abs(normalizeAngleDelta(next.angleRad - arm.angleRad));
      minDeltaAngle = Math.min(dPrev, dNext);
      const prevDist = rayDistanceToBox(prev.angleRad, halfW, halfD);
      const nextDist = rayDistanceToBox(next.angleRad, halfW, halfD);
      nearestAdjDist = dPrev <= dNext ? prevDist : nextDist;
    }

    const baseHalfSpan = arm.carriagewayWidth * 0.5 - 0.45;
    const isNearlyOrthogonal = minDeltaAngle >= 1.22; // ~70 deg
    const cornerSafeHalfSpan = isNearlyOrthogonal
      ? nearestAdjDist - cwDepth * 0.5 - 1.35 - cwDepth * 0.5 - 0.65
      : Math.max(
          1.4,
          (crosswalkDistanceFromCenter - cwDepth * 0.5) *
            Math.tan(Math.max(0.22, minDeltaAngle * 0.5)) -
            0.85,
        );
    const maxCrosswalkHalfSpan = Math.max(1.35, Math.min(baseHalfSpan, cornerSafeHalfSpan));

    const outX = Math.sin(arm.angleRad);
    const outZ = Math.cos(arm.angleRad);
    return {
      armId: arm.armId,
      roadId: arm.roadId,
      angleRad: arm.angleRad,
      entryPoint: {
        x: params.x + outX * boxDist,
        z: params.z + outZ * boxDist,
      },
      carriagewayWidth: arm.carriagewayWidth,
      medianWidth: arm.medianWidth,
      inboundLaneCount: arm.inboundLaneCount,
      oncomingLaneCount: arm.oncomingLaneCount,
      inboundLaneWidth: arm.inboundLaneWidth,
      oncomingLaneWidth: arm.oncomingLaneWidth,
      hasCrosswalk: arm.hasCrosswalk,
      hasStopLine: arm.hasStopLine,
      hasStopText: arm.hasStopText,
      crosswalkDistanceFromCenter,
      maxCrosswalkHalfSpan,
    };
  });

  // 交差点内の右折誘導破線アーク（turnGuideArcs）および直進接続アークを生成
  const turnGuideArcs: JunctionTurnGuideArc[] = [];
  if (!isScramble && resolvedArms.length >= 2) {
    for (const fromArm of resolvedArms) {
      if (fromArm.inboundLaneCount < 1) {
        continue;
      }
      const inDirX = -Math.sin(fromArm.angleRad);
      const inDirZ = -Math.cos(fromArm.angleRad);
      const fromLeft = leftNormal2D(inDirX, inDirZ);
      // 右折対象は最内車線（中央寄り index 0）
      const fromInnerOff = fromArm.medianWidth * 0.5 + fromArm.inboundLaneWidth * 0.5;
      const fromStartDist = Math.max(
        2.0,
        fromArm.crosswalkDistanceFromCenter - cwDepth * 0.5 - 0.8,
      );
      const startPt: Point2D = {
        x: params.x + Math.sin(fromArm.angleRad) * fromStartDist + fromLeft.x * fromInnerOff,
        z: params.z + Math.cos(fromArm.angleRad) * fromStartDist + fromLeft.z * fromInnerOff,
      };

      for (const toArm of resolvedArms) {
        if (toArm.armId === fromArm.armId || toArm.oncomingLaneCount < 1) {
          continue;
        }
        const outDirX = Math.sin(toArm.angleRad);
        const outDirZ = Math.cos(toArm.angleRad);
        // 進行方向 inDir から流出方向 outDir への回転角を算出
        // 左側ベクトルとの内積: dot(outDir, right(inDir)) > 0 なら右折
        const rightOfInX = -inDirZ;
        const rightOfInZ = inDirX;
        const forwardDot = inDirX * outDirX + inDirZ * outDirZ;
        const rightDot = rightOfInX * outDirX + rightOfInZ * outDirZ;

        const toLeft = leftNormal2D(outDirX, outDirZ);
        const toInnerOff = toArm.medianWidth * 0.5 + toArm.oncomingLaneWidth * 0.5;
        const toEndDist = Math.max(2.0, toArm.crosswalkDistanceFromCenter - cwDepth * 0.5 - 0.8);
        const endPt: Point2D = {
          x: params.x + outDirX * toEndDist + toLeft.x * toInnerOff,
          z: params.z + outDirZ * toEndDist + toLeft.z * toInnerOff,
        };

        const isRightTurn = rightDot > 0.55 && Math.abs(forwardDot) < 0.72;
        const isThrough = forwardDot > 0.78;
        if (isRightTurn) {
          // 右折誘導アークは交差点中心付近（中央ダイヤのやや手前外側）を制御点とする 2 次ベジェ曲線
          const ctrlX = params.x + (fromLeft.x + toLeft.x) * (fromInnerOff * 0.45);
          const ctrlZ = params.z + (fromLeft.z + toLeft.z) * (fromInnerOff * 0.45);
          turnGuideArcs.push({
            fromArmId: fromArm.armId,
            toArmId: toArm.armId,
            kind: "right_turn",
            controlPoints: [startPt, { x: ctrlX, z: ctrlZ }, endPt],
          });
        } else if (isThrough) {
          const midPt: Point2D = {
            x: (startPt.x + endPt.x) * 0.5,
            z: (startPt.z + endPt.z) * 0.5,
          };
          turnGuideArcs.push({
            fromArmId: fromArm.armId,
            toArmId: toArm.armId,
            kind: "through",
            controlPoints: [startPt, midPt, endPt],
          });
        }
      }
    }
  }

  const boundaryPolygon = buildRectanglePolygon(params.x, params.z, params.widthX, params.depthZ);

  return JunctionTopologySchema.parse({
    id: params.id,
    name: params.name,
    x: params.x,
    z: params.z,
    widthX: params.widthX,
    depthZ: params.depthZ,
    boundaryPolygon,
    arms: resolvedArms,
    isScramble,
    hasCenterDiamond,
    hasGuideDots,
    turnGuideArcs,
  });
}

function interpolateFrameByArc(frames: ReadonlyArray<RoadFrame>, targetArc: number): RoadFrame {
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

export interface ClipMarkingIntervalsParams {
  frames: ReadonlyArray<RoadFrame>;
  startArc: number;
  endArc: number;
  minSpanLength?: number;
  lateralProbeOffsets?: ReadonlyArray<number>;
  junctionPolygons?: ReadonlyArray<ReadonlyArray<Point2D>>;
  crossingCorridors?: ReadonlyArray<RoadExclusionCorridor>;
  exclusionZones?: ReadonlyArray<{ x: number; z: number; radius: number }>;
  excludeArcRanges?: ReadonlyArray<readonly [number, number]>;
  junctionPaddingM?: number;
  corridorPaddingM?: number;
}

/**
 * 交差点境界ポリゴン・交差道路コリドー・円形除外ゾーン・横断歩道弧長区間に対して
 * 道路の長手方向標示の描画可能区間列を自動クリッピング＋二分法精緻化で算出する。
 */
export function computeClippedMarkingIntervals(
  params: ClipMarkingIntervalsParams,
): Array<{ start: number; end: number }> {
  const {
    frames,
    startArc,
    endArc,
    minSpanLength = 3.5,
    lateralProbeOffsets = [0],
    junctionPolygons = [],
    crossingCorridors = [],
    exclusionZones = [],
    excludeArcRanges = [],
    junctionPaddingM = 0.0,
    corridorPaddingM = 0.15,
  } = params;

  if (frames.length < 2 || endArc - startArc < minSpanLength) {
    return [];
  }

  // 交差点ポリゴンにパディングが必要な場合は重心基準で外向き拡張する
  const expandedPolygons: Point2D[][] = junctionPolygons.map((poly) => {
    if (junctionPaddingM <= 0.01 || poly.length < 3) {
      return poly.map((p) => ({ x: p.x, z: p.z }));
    }
    let cx = 0;
    let cz = 0;
    for (const p of poly) {
      cx += p.x;
      cz += p.z;
    }
    cx /= poly.length;
    cz /= poly.length;
    return poly.map((p) => {
      const dx = p.x - cx;
      const dz = p.z - cz;
      const dist = Math.hypot(dx, dz);
      const scale = dist > 1e-4 ? (dist + junctionPaddingM) / dist : 1;
      return { x: cx + dx * scale, z: cz + dz * scale };
    });
  });

  const isArcBlocked = (arc: number): boolean => {
    for (const [ex0, ex1] of excludeArcRanges) {
      const minE = Math.min(ex0, ex1);
      const maxE = Math.max(ex0, ex1);
      if (arc >= minE && arc <= maxE) {
        return true;
      }
    }

    const f = interpolateFrameByArc(frames, arc);
    for (const latOff of lateralProbeOffsets) {
      const px = f.pos.x + f.normal.x * latOff;
      const pz = f.pos.z + f.normal.z * latOff;

      for (const ez of exclusionZones) {
        if (Math.hypot(px - ez.x, pz - ez.z) < ez.radius) {
          return true;
        }
      }

      for (const poly of expandedPolygons) {
        if (isPointInPolygon2D(px, pz, poly)) {
          return true;
        }
      }

      for (const cor of crossingCorridors) {
        const dSq = minDistanceSqToPolyline2D(px, pz, cor.sampledPoints);
        const thresh = cor.halfWidth + corridorPaddingM;
        if (dSq < thresh * thresh) {
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
      if (isArcBlocked(mid)) {
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
  let prevArc = startArc;
  let prevBlocked = true;

  for (let arc = startArc; arc <= endArc; arc += sampleStep) {
    const blocked = isArcBlocked(arc);
    if (!blocked && activeStart === null) {
      activeStart = prevBlocked && arc > startArc ? refineBoundary(arc, prevArc) : arc;
    } else if (blocked && activeStart !== null) {
      const refinedEnd = refineBoundary(prevArc, arc);
      if (refinedEnd - activeStart >= minSpanLength) {
        intervals.push({ start: activeStart, end: refinedEnd });
      }
      activeStart = null;
    }
    prevArc = arc;
    prevBlocked = blocked;
  }

  if (activeStart !== null) {
    const endBlocked = isArcBlocked(endArc);
    const finalEnd = endBlocked ? refineBoundary(prevArc, endArc) : endArc;
    if (finalEnd - activeStart >= minSpanLength) {
      intervals.push({ start: activeStart, end: finalEnd });
    }
  }

  return intervals;
}

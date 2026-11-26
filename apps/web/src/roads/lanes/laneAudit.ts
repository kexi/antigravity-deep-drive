import * as THREE from "three";
import { isPointInPolygon2D, shrinkPolygon2D } from "./junctionTopology";
import { resolveDriverLeftToRightArrows } from "./laneProfile";
import type { LaneArrowType, LaneGraph, Point2D, RoadLaneProfile } from "./laneSchema";

export type LaneAuditRule =
  | "junction_intrusion"
  | "marking_overlap"
  | "elevation_drift"
  | "sign_arrow_mismatch"
  | "lane_graph_invalid";

export interface LaneAuditViolation {
  rule: LaneAuditRule;
  severity: "error" | "warning";
  objectName: string;
  detail: string;
  x?: number;
  z?: number;
}

export interface LaneAuditOptions {
  /** 交差点ポリゴンの内向き余裕（m: 境界上の接触誤差を許容しつつ内部侵入を検出） */
  junctionInsetMeters?: number;
  /** 3D 地形標高サンプラー（指定時のみ起伏追従誤差を監査） */
  elevationSampler?: (x: number, z: number) => number;
  /** 3D 標高監査の対象領域フィルタ（例: 渋谷エリア x < -395） */
  elevationRegionFilter?: (x: number, z: number) => boolean;
  /** 許容する路面標示の地面からの高さ範囲（m） */
  elevationToleranceRange?: readonly [number, number];
}

export interface LaneAuditReport {
  passed: boolean;
  checkedMarkingMeshes: number;
  checkedSignCount: number;
  checkedLaneEdges: number;
  checkedJunctions: number;
  violations: LaneAuditViolation[];
}

function isLongitudinalMarkingMesh(obj: THREE.Object3D): boolean {
  const markingType = obj.userData?.markingType as string | undefined;
  if (
    markingType === "CenterLine" ||
    markingType === "LaneDivider" ||
    markingType === "ShoulderLine"
  ) {
    return true;
  }
  const name = obj.name;
  return (
    name.startsWith("CurvedMarking_LaneDivider_") ||
    name.startsWith("CurvedMarking_WhiteCenter_") ||
    name.startsWith("CurvedMarking_YellowCenter_") ||
    name.startsWith("CurvedMarking_DoubleYellowCenter_") ||
    name.startsWith("CurvedMarking_WhiteDashedCenter_") ||
    name.startsWith("CurvedMarking_Shoulder_") ||
    name.startsWith("CurvedMarking_YellowNoLaneChange_")
  );
}

function isAnyRoadMarkingMesh(obj: THREE.Object3D): boolean {
  if (isLongitudinalMarkingMesh(obj)) {
    return true;
  }
  const markingType = obj.userData?.markingType as string | undefined;
  if (
    markingType === "CrosswalkStripe" ||
    markingType === "StopLine" ||
    markingType === "ZebraZone" ||
    markingType === "LaneArrow" ||
    markingType === "CrosswalkDiamond" ||
    markingType === "SpeedMarking" ||
    markingType === "StopText" ||
    markingType === "IntersectionCrosswalkNS" ||
    markingType === "IntersectionCrosswalkEW" ||
    markingType === "IntersectionStopLine" ||
    markingType === "IntersectionGuideDot" ||
    markingType === "IntersectionCenterDiamond" ||
    markingType === "IntersectionTurnGuide"
  ) {
    return true;
  }
  return (
    obj.name.startsWith("CurvedCrosswalk_") ||
    obj.name.startsWith("CurvedStopLine_") ||
    obj.name.startsWith("CurvedChevron_")
  );
}

/**
 * 都市全体（渋谷＋東京駅丸の内）の路面標示・交差点・道路標識・車線グラフに対する幾何不変条件を網羅監査する。
 */
export function auditCityLaneSystem(
  root: THREE.Object3D,
  laneGraph: LaneGraph,
  options: LaneAuditOptions = {},
): LaneAuditReport {
  const violations: LaneAuditViolation[] = [];
  const junctionInset = options.junctionInsetMeters ?? 2.5;
  const [minRelY, maxRelY] = options.elevationToleranceRange ?? [-0.03, 0.18];

  // 1. LaneGraph 構造健全性チェック
  if (laneGraph.edges.length === 0) {
    violations.push({
      rule: "lane_graph_invalid",
      severity: "error",
      objectName: "LaneGraph",
      detail: "LaneGraph.edges が空です",
    });
  }

  const edgeIdSet = new Set<string>(laneGraph.edges.map((e) => e.laneId));
  for (const edge of laneGraph.edges) {
    if (edge.samples.length < 2) {
      violations.push({
        rule: "lane_graph_invalid",
        severity: "error",
        objectName: edge.laneId,
        detail: `サンプル点数が不足しています (${edge.samples.length})`,
      });
      continue;
    }
    if (edge.leftAdjacentLaneId && !edgeIdSet.has(edge.leftAdjacentLaneId)) {
      violations.push({
        rule: "lane_graph_invalid",
        severity: "error",
        objectName: edge.laneId,
        detail: `存在しない左隣接車線 ID を参照: ${edge.leftAdjacentLaneId}`,
      });
    }
    if (edge.rightAdjacentLaneId && !edgeIdSet.has(edge.rightAdjacentLaneId)) {
      violations.push({
        rule: "lane_graph_invalid",
        severity: "error",
        objectName: edge.laneId,
        detail: `存在しない右隣接車線 ID を参照: ${edge.rightAdjacentLaneId}`,
      });
    }
    let prevS = -Infinity;
    for (const s of edge.samples) {
      const isFiniteSample =
        Number.isFinite(s.x) &&
        Number.isFinite(s.y) &&
        Number.isFinite(s.z) &&
        Number.isFinite(s.s) &&
        Number.isFinite(s.tx) &&
        Number.isFinite(s.tz);
      if (!isFiniteSample || s.s < prevS - 1e-4 || s.width < 2.2) {
        violations.push({
          rule: "lane_graph_invalid",
          severity: "error",
          objectName: edge.laneId,
          detail: `不正な車線サンプル (s=${s.s}, prevS=${prevS}, width=${s.width})`,
          x: s.x,
          z: s.z,
        });
        break;
      }
      prevS = s.s;
    }
  }

  for (const arc of laneGraph.junctionArcs) {
    const hasInvalidSample =
      arc.samples.length < 2 ||
      arc.samples.some(
        (p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z),
      );
    if (hasInvalidSample) {
      violations.push({
        rule: "lane_graph_invalid",
        severity: "error",
        objectName: arc.id,
        detail: "交差点接続アークに非有限座標またはサンプル不足があります",
      });
    }
  }

  // 2. 交差点コアポリゴン（内向き余裕付き）を事前構築
  const insetJunctions: Array<{
    id: string;
    name: string;
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    polygon: Point2D[];
  }> = laneGraph.junctions.map((j) => {
    const poly = shrinkPolygon2D(j.boundaryPolygon, junctionInset);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of poly) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    return { id: j.id, name: j.name, minX, maxX, minZ, maxZ, polygon: poly };
  });

  // 3. シーングラフ走査：交差点侵入・3D標高追従・看板SSOT整合を監査
  root.updateMatrixWorld(true);
  const vTmp = new THREE.Vector3();
  let checkedMarkingMeshes = 0;
  let checkedSignCount = 0;

  root.traverse((obj) => {
    // 進行方向別通行区分標識（327の7）と親道路プロファイルの SSOT 整合チェック
    if (obj.name.startsWith("LaneDirectionSign_")) {
      checkedSignCount += 1;
      const signArrows = obj.userData?.laneArrows as ReadonlyArray<LaneArrowType> | undefined;
      const parentProfile = obj.parent?.userData?.laneProfile as RoadLaneProfile | undefined;
      if (signArrows && parentProfile) {
        const approachSec = parentProfile.sections[parentProfile.sections.length - 1];
        const expected = resolveDriverLeftToRightArrows(approachSec.inboundLanes);
        const isMatched =
          signArrows.length === expected.length && signArrows.every((a, i) => a === expected[i]);
        if (!isMatched) {
          violations.push({
            rule: "sign_arrow_mismatch",
            severity: "error",
            objectName: obj.name,
            detail: `標識矢印 [${signArrows.join(",")}] != 道路SSOT [${expected.join(",")}] (${parentProfile.roadName})`,
          });
        }
      }
      return;
    }

    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry || !isAnyRoadMarkingMesh(mesh)) {
      return;
    }

    checkedMarkingMeshes += 1;
    const posAttr = mesh.geometry.getAttribute("position");
    if (!posAttr || posAttr.count === 0) {
      return;
    }

    const isLongitudinal = isLongitudinalMarkingMesh(mesh);
    let usesTerrainElevation = false;
    for (let p: THREE.Object3D | null = mesh; p !== null; p = p.parent) {
      if (p.userData?.usesTerrainElevation === true) {
        usesTerrainElevation = true;
        break;
      }
    }
    const step = Math.max(1, Math.floor(posAttr.count / 120));
    let reportedIntrusion = false;
    let reportedElevation = false;

    for (let i = 0; i < posAttr.count; i += step) {
      vTmp.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);

      if (isLongitudinal && !reportedIntrusion && insetJunctions.length > 0) {
        for (const j of insetJunctions) {
          const inBbox =
            vTmp.x >= j.minX && vTmp.x <= j.maxX && vTmp.z >= j.minZ && vTmp.z <= j.maxZ;
          if (!inBbox) {
            continue;
          }
          if (isPointInPolygon2D(vTmp.x, vTmp.z, j.polygon)) {
            violations.push({
              rule: "junction_intrusion",
              severity: "error",
              objectName: mesh.name || "unnamed_marking",
              detail: `長手方向車線が交差点 ${j.name} (${j.id}) 内部へ侵入しています`,
              x: vTmp.x,
              z: vTmp.z,
            });
            reportedIntrusion = true;
            break;
          }
        }
      }

      if (options.elevationSampler && !reportedElevation) {
        const shouldUseSampler =
          usesTerrainElevation &&
          (!options.elevationRegionFilter || options.elevationRegionFilter(vTmp.x, vTmp.z));
        const groundY = shouldUseSampler ? options.elevationSampler(vTmp.x, vTmp.z) : 0;
        const relY = vTmp.y - groundY;
        if (relY < minRelY || relY > maxRelY) {
          violations.push({
            rule: "elevation_drift",
            severity: "error",
            objectName: mesh.name || "unnamed_marking",
            detail: `路面標示の対地高さが許容外 (relY=${relY.toFixed(4)}m, expected [${minRelY}, ${maxRelY}])`,
            x: vTmp.x,
            z: vTmp.z,
          });
          reportedElevation = true;
        }
      }
    }
  });

  const hasErrors = violations.some((v) => v.severity === "error");
  return {
    passed: !hasErrors,
    checkedMarkingMeshes,
    checkedSignCount,
    checkedLaneEdges: laneGraph.edges.length,
    checkedJunctions: laneGraph.junctions.length,
    violations,
  };
}

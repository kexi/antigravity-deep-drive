import * as THREE from "three";
import type { LaneGraph, Point2D } from "../lanes/laneSchema";
import { TrafficSignalController } from "./trafficSignalController";
import type { VehicleSignalAspect } from "./signalSchema";

export type SignalAuditRule =
  | "phase_conflict"
  | "illegal_green_arrow"
  | "lamp_state_invalid"
  | "material_bloat"
  | "elevation_drift"
  | "arm_away_from_road";

export interface SignalAuditViolation {
  rule: SignalAuditRule;
  severity: "error" | "warning";
  targetId: string;
  detail: string;
}

export interface SignalAuditReport {
  passed: boolean;
  checkedSignals: number;
  checkedIntersections: number;
  uniqueLedMaterialCount: number;
  violations: SignalAuditViolation[];
}

function isNonRed(aspect: VehicleSignalAspect): boolean {
  return aspect !== "red";
}

function minDistanceToSegments2D(px: number, pz: number, pts: ReadonlyArray<Point2D>): number {
  let minSq = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lenSq = dx * dx + dz * dz;
    const t =
      lenSq > 1e-8 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / lenSq)) : 0;
    const dSq = (px - (a.x + dx * t)) ** 2 + (pz - (a.z + dz * t)) ** 2;
    if (dSq < minSq) {
      minSq = dSq;
    }
  }
  return Math.sqrt(minSq);
}

function createRoadwayDistanceFn(laneGraph: LaneGraph): (px: number, pz: number) => number {
  const edgePolylines: Point2D[][] = [];
  for (const edge of laneGraph.edges) {
    if (edge.samples.length >= 2) {
      edgePolylines.push(edge.samples.map((p) => ({ x: p.x, z: p.z })));
    }
  }
  const junctionCenters: Point2D[] = laneGraph.junctions.map((j) => ({ x: j.x, z: j.z }));

  // Why prefer laneGraph.edges over junction boundaryPolygon:
  // 遠方左歩道信号は交差点パッド外縁から 1.45m 後退して立つため、パッド外縁との距離を含めると
  // 車道横断方向へのアーム張り出しが外縁の平行距離（1.45m）でマスクされてしまう。
  // 車線中心線（laneGraph.edges）への距離で判定することで、全交差点・単路の張り出し方向を厳密に検査できる。
  return (px: number, pz: number): number => {
    let best = Infinity;
    for (const line of edgePolylines) {
      const d = minDistanceToSegments2D(px, pz, line);
      if (d < best) {
        best = d;
      }
    }
    if (best <= 24.0) {
      return best;
    }
    for (const c of junctionCenters) {
      const d = Math.hypot(px - c.x, pz - c.z);
      if (d < best) {
        best = d;
      }
    }
    return best;
  };
}

/**
 * 都市全体の交通信号システムに対し、
 * 1. 直交軸の排他インターロック（全サイクルにわたり同時青/黄/矢印がゼロ）
 * 2. 青信号＋右折矢印の違法同時点灯ゼロ
 * 3. 各信号灯器の単灯発光整合（3色同時点灯・全消灯なし）
 * 4. LED マテリアル共有キャッシュ効率（重複テクスチャ暴走なし）
 * 5. 起伏地形上の支柱接地精度
 * 6. 水平アームの車道側張り出し方向（歩道・建物側への逆向き張り出しゼロ）
 * を一括監査する。
 */
export function auditTrafficSignalSystem(
  root: THREE.Object3D,
  controller: TrafficSignalController,
  options: {
    maxUniqueLedMaterials?: number;
    elevationSampler?: (x: number, z: number) => number;
    elevationRegionFilter?: (x: number, z: number) => boolean;
    laneGraph?: LaneGraph;
  } = {},
): SignalAuditReport {
  const violations: SignalAuditViolation[] = [];
  const maxUniqueLedMaterials = options.maxUniqueLedMaterials ?? 24;
  const roadwayDistFn = options.laneGraph ? createRoadwayDistanceFn(options.laneGraph) : null;

  // 1. 全登録交差点のフェーズサイクル排他検証（0s..110s を 0.5s 刻みで全数シミュレーション）
  const summaries = controller.getIntersectionSummaries();
  for (const inter of summaries) {
    let hasConflict = false;
    for (let t = 0; t <= 110; t += 0.5) {
      const state = TrafficSignalController.evaluateCycleAt(inter.timing, t);
      const bothGo = isNonRed(state.axisA.vehicle) && isNonRed(state.axisB.vehicle);
      if (bothGo) {
        violations.push({
          rule: "phase_conflict",
          severity: "error",
          targetId: inter.intersectionId,
          detail: `t=${t.toFixed(1)}s で直交2軸が同時進行可能 (axisA=${state.axisA.vehicle}, axisB=${state.axisB.vehicle})`,
        });
        hasConflict = true;
        break;
      }
      if (
        state.scramblePedestrian !== "red" &&
        (isNonRed(state.axisA.vehicle) || isNonRed(state.axisB.vehicle))
      ) {
        violations.push({
          rule: "phase_conflict",
          severity: "error",
          targetId: inter.intersectionId,
          detail: `t=${t.toFixed(1)}s でスクランブル歩行者青中に車両信号が赤以外`,
        });
        hasConflict = true;
        break;
      }
    }
    if (hasConflict) {
      continue;
    }
  }

  // 2. シーングラフ内の全信号機のランプ発光状態・違法矢印・マテリアル共有・接地標高を監査
  root.updateMatrixWorld(true);
  const uniqueLedMaterials = new Set<THREE.Material>();
  const worldPos = new THREE.Vector3();
  let checkedSignals = 0;

  root.traverse((obj) => {
    if (obj.name !== "JapaneseTrafficSignalGroup") {
      return;
    }
    checkedSignals += 1;
    const signalId = (obj.userData?.trafficSignalHandle?.id as string | undefined) ?? obj.name;

    const greenLamp = obj.getObjectByName("VehicleLamp_BlueGreen") as THREE.Mesh | undefined;
    const yellowLamp = obj.getObjectByName("VehicleLamp_Yellow") as THREE.Mesh | undefined;
    const redLamp = obj.getObjectByName("VehicleLamp_Red") as THREE.Mesh | undefined;
    const arrowLamp = obj.getObjectByName("ArrowSignalLens") as THREE.Mesh | undefined;

    const lamps = [greenLamp, yellowLamp, redLamp].filter(Boolean) as THREE.Mesh[];
    let litCount = 0;
    let isGreenLit = false;

    for (const lamp of lamps) {
      const mat = lamp.material as THREE.MeshStandardMaterial;
      uniqueLedMaterials.add(mat);
      if (mat.emissiveIntensity > 1.0) {
        litCount += 1;
        if (lamp === greenLamp) {
          isGreenLit = true;
        }
      }
    }

    if (litCount !== 1) {
      violations.push({
        rule: "lamp_state_invalid",
        severity: "error",
        targetId: signalId,
        detail: `車両用3灯の点灯数が不正です (litCount=${litCount}, expected=1)`,
      });
    }

    if (arrowLamp) {
      const arrowMat = arrowLamp.material as THREE.MeshStandardMaterial;
      uniqueLedMaterials.add(arrowMat);
      if (isGreenLit && arrowMat.emissiveIntensity > 0.1) {
        violations.push({
          rule: "illegal_green_arrow",
          severity: "error",
          targetId: signalId,
          detail: "青信号点灯中に右折矢印灯器が同時発光しています（道路交通法不整合）",
        });
      }
    }

    for (const pedName of ["PedLamp_RedStanding", "PedLamp_GreenWalking"]) {
      const pedMesh = obj.getObjectByName(pedName) as THREE.Mesh | undefined;
      if (pedMesh) {
        uniqueLedMaterials.add(pedMesh.material as THREE.Material);
      }
    }

    if (options.elevationSampler) {
      obj.getWorldPosition(worldPos);
      let usesTerrainElevation = obj.userData?.usesTerrainElevation === true;
      for (let p = obj.parent; !usesTerrainElevation && p !== null; p = p.parent) {
        if (p.userData?.usesTerrainElevation === true) {
          usesTerrainElevation = true;
        }
      }
      const shouldUseSampler =
        usesTerrainElevation &&
        (!options.elevationRegionFilter || options.elevationRegionFilter(worldPos.x, worldPos.z));
      const groundY = shouldUseSampler ? options.elevationSampler(worldPos.x, worldPos.z) : 0;
      const drift = Math.abs(worldPos.y - groundY);
      if (drift > 0.45) {
        violations.push({
          rule: "elevation_drift",
          severity: "error",
          targetId: signalId,
          detail: `信号柱の接地標高誤差が過大です (y=${worldPos.y.toFixed(2)}, groundY=${groundY.toFixed(2)})`,
        });
      }
    }

    if (roadwayDistFn) {
      const headObj = obj.getObjectByName("VehicleSignalHead");
      if (headObj) {
        obj.getWorldPosition(worldPos);
        const headWorldPos = new THREE.Vector3();
        headObj.getWorldPosition(headWorldPos);
        const armDx = headWorldPos.x - worldPos.x;
        const armDz = headWorldPos.z - worldPos.z;
        const armLen = Math.hypot(armDx, armDz);
        if (armLen > 0.5) {
          const probeX = worldPos.x + (armDx / armLen) * 1.5;
          const probeZ = worldPos.z + (armDz / armLen) * 1.5;
          const poleDist = roadwayDistFn(worldPos.x, worldPos.z);
          const probeDist = roadwayDistFn(probeX, probeZ);
          const isArmApproachingRoad = probeDist < poleDist - 0.15 || probeDist < 0.05;
          if (!isArmApproachingRoad && poleDist < 30.0) {
            violations.push({
              rule: "arm_away_from_road",
              severity: "error",
              targetId: signalId,
              detail: `信号アームが車道ではなく歩道/外側へ張り出しています (pole=(${worldPos.x.toFixed(1)}, ${worldPos.z.toFixed(1)}), poleDist=${poleDist.toFixed(2)}m, probeDist=${probeDist.toFixed(2)}m)`,
            });
          }
        }
      }
    }
  });

  if (uniqueLedMaterials.size > maxUniqueLedMaterials) {
    violations.push({
      rule: "material_bloat",
      severity: "error",
      targetId: "TrafficSignalMaterialLibrary",
      detail: `LED マテリアル共有キャッシュが効いていません (unique=${uniqueLedMaterials.size} > ${maxUniqueLedMaterials})`,
    });
  }

  return {
    passed: violations.every((v) => v.severity !== "error"),
    checkedSignals,
    checkedIntersections: summaries.length,
    uniqueLedMaterialCount: uniqueLedMaterials.size,
    violations,
  };
}

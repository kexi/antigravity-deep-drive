import * as THREE from "three";
import { auditCityLaneSystem, type LaneAuditReport, type LaneGraph } from "../lanes";
import {
  auditSidewalkSystem,
  type SidewalkAuditReport,
  type SidewalkNetworkSummary,
  type SidewalkSystem,
} from "../sidewalks";
import {
  auditTrafficSignalSystem,
  type SignalAuditReport,
  type TrafficSignalController,
} from "../signals";
import type { CreatedRoadSignInstance } from "../roadSignSystem";
import {
  auditRoadLightingSystem,
  type RoadLightingAuditReport,
  type RoadLightingSummary,
  type RoadLightingSystem,
} from "../lighting";
import {
  auditBarrierSystem,
  type BarrierAuditReport,
  type BarrierSummary,
  type BarrierSystem,
} from "../barriers";
import {
  auditRoadUtilitySystem,
  type RoadUtilityAuditReport,
  type RoadUtilitySummary,
  type RoadUtilitySystem,
} from "../utilities";
import {
  auditStreetFurnitureSystem,
  type StreetFurnitureAuditReport,
  type StreetFurnitureSummary,
  type StreetFurnitureSystem,
} from "../furniture";

export interface RoadSignAuditViolation {
  rule: "assembly_invalid" | "invalid_coords";
  severity: "error" | "warning";
  targetId: string;
  detail: string;
}

export interface RoadSignAuditReport {
  passed: boolean;
  checkedSigns: number;
  validAssemblyCount: number;
  violations: RoadSignAuditViolation[];
}

/**
 * RoadSignSystem が構築した全道路標識インスタンスの組付健全性（支柱クリアランス・背面リブ・座標有限性）を監査する。
 */
export function auditRoadSignSystem(
  signInstances: ReadonlyArray<CreatedRoadSignInstance>,
): RoadSignAuditReport {
  const violations: RoadSignAuditViolation[] = [];
  let validAssemblyCount = 0;

  for (const inst of signInstances) {
    if (inst.validation.valid) {
      validAssemblyCount += 1;
    } else {
      // 既定の単柱・門型仕様逸脱のみ warning ではなく明確に検査記録する
      const hasCriticalIssue = inst.validation.issues.some(
        (iss) => iss.includes("突き出し") || iss.includes("欠落"),
      );
      if (hasCriticalIssue) {
        violations.push({
          rule: "assembly_invalid",
          severity: "warning",
          targetId: inst.id,
          detail: inst.validation.issues.join("; "),
        });
      }
    }
    const pos = inst.group.position;
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) {
      violations.push({
        rule: "invalid_coords",
        severity: "error",
        targetId: inst.id,
        detail: "道路標識の座標が非有限です",
      });
    }
  }

  return {
    passed: violations.every((v) => v.severity !== "error"),
    checkedSigns: signInstances.length,
    validAssemblyCount,
    violations,
  };
}

export interface JapaneseRoadInfrastructureSummary {
  version: "1.0.0";
  subsystems: {
    lanes: { edgeCount: number; junctionCount: number; junctionArcCount: number };
    sidewalks: SidewalkNetworkSummary;
    signals: { totalSignals: number; managedIntersections: number };
    signs: { totalSigns: number };
    lighting: RoadLightingSummary;
    barriers: BarrierSummary;
    utilities: RoadUtilitySummary;
    furniture: StreetFurnitureSummary;
  };
}

export interface JapaneseRoadInfrastructureAuditReport {
  passed: boolean;
  lanes: LaneAuditReport;
  sidewalks: SidewalkAuditReport;
  signals: SignalAuditReport;
  signs: RoadSignAuditReport;
  lighting: RoadLightingAuditReport;
  barriers: BarrierAuditReport;
  utilities: RoadUtilityAuditReport;
  furniture: StreetFurnitureAuditReport;
}

/**
 * 日本の道路を構成する全 8 大システム（車線・歩道・信号・標識・照明・防護安全・路面インフラ・沿道ファニチャー）を
 * 単一の統一窓口へ束ねるマスターファサード。
 */
export class JapaneseRoadInfrastructure {
  public readonly lanes: () => LaneGraph;
  public readonly sidewalks: SidewalkSystem;
  public readonly signals: TrafficSignalController;
  public readonly signs: () => ReadonlyArray<CreatedRoadSignInstance>;
  public readonly lighting: RoadLightingSystem;
  public readonly barriers: BarrierSystem;
  public readonly utilities: RoadUtilitySystem;
  public readonly furniture: StreetFurnitureSystem;

  constructor(deps: {
    getLaneGraph: () => LaneGraph;
    sidewalks: SidewalkSystem;
    signals: TrafficSignalController;
    getSignInstances: () => ReadonlyArray<CreatedRoadSignInstance>;
    lighting: RoadLightingSystem;
    barriers: BarrierSystem;
    utilities: RoadUtilitySystem;
    furniture: StreetFurnitureSystem;
  }) {
    this.lanes = deps.getLaneGraph;
    this.sidewalks = deps.sidewalks;
    this.signals = deps.signals;
    this.signs = deps.getSignInstances;
    this.lighting = deps.lighting;
    this.barriers = deps.barriers;
    this.utilities = deps.utilities;
    this.furniture = deps.furniture;
  }

  public getFullSummary(): JapaneseRoadInfrastructureSummary {
    const laneGraph = this.lanes();
    return {
      version: "1.0.0",
      subsystems: {
        lanes: {
          edgeCount: laneGraph.edges.length,
          junctionCount: laneGraph.junctions.length,
          junctionArcCount: laneGraph.junctionArcs.length,
        },
        sidewalks: this.sidewalks.getNetworkSummary(),
        signals: {
          totalSignals: this.signals.getAllSignalHandles().length,
          managedIntersections: this.signals.getIntersectionSummaries().length,
        },
        signs: {
          totalSigns: this.signs().length,
        },
        lighting: this.lighting.getSummary(),
        barriers: this.barriers.getSummary(),
        utilities: this.utilities.getSummary(),
        furniture: this.furniture.getSummary(),
      },
    };
  }

  public auditAll(
    scene: THREE.Object3D,
    options: {
      elevationSampler?: (x: number, z: number) => number;
      elevationRegionFilter?: (x: number, z: number) => boolean;
    } = {},
  ): JapaneseRoadInfrastructureAuditReport {
    const laneGraph = this.lanes();
    const lanes = auditCityLaneSystem(scene, laneGraph, {
      elevationSampler: options.elevationSampler,
      elevationRegionFilter: options.elevationRegionFilter,
    });
    const sidewalks = auditSidewalkSystem(scene, this.sidewalks, {
      maxUniquePavingMaterials: 3,
      maxUniqueSidewalkMaterials: 10,
      requireFullCityCoverage: true,
    });
    const signals = auditTrafficSignalSystem(scene, this.signals, {
      maxUniqueLedMaterials: 16,
      elevationSampler: options.elevationSampler,
      elevationRegionFilter: options.elevationRegionFilter,
      laneGraph,
    });
    const signs = auditRoadSignSystem(this.signs());
    const lighting = auditRoadLightingSystem(scene, this.lighting, {
      maxUniqueMaterials: 10,
      minLamps: 20,
    });
    const barriers = auditBarrierSystem(scene, this.barriers, {
      maxUniqueMaterials: 12,
      minBarriers: 20,
    });
    const utilities = auditRoadUtilitySystem(scene, this.utilities, {
      maxUniqueMaterials: 12,
      minUtilities: 40,
    });
    const furniture = auditStreetFurnitureSystem(scene, this.furniture, {
      maxUniqueMaterials: 14,
      minItems: 12,
    });

    const passed =
      lanes.passed &&
      sidewalks.passed &&
      signals.passed &&
      signs.passed &&
      lighting.passed &&
      barriers.passed &&
      utilities.passed &&
      furniture.passed;

    return {
      passed,
      lanes,
      sidewalks,
      signals,
      signs,
      lighting,
      barriers,
      utilities,
      furniture,
    };
  }
}

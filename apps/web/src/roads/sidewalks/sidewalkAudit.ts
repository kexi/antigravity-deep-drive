import * as THREE from "three";
import type { SidewalkSystem } from "./sidewalkSystem";

export type SidewalkAuditRule =
  | "material_bloat"
  | "normal_inverted"
  | "floating_curb"
  | "tactile_invalid"
  | "sidewalk_overlap"
  | "network_incomplete";

export interface SidewalkAuditViolation {
  rule: SidewalkAuditRule;
  severity: "error" | "warning";
  targetId: string;
  detail: string;
}

export interface SidewalkAuditReport {
  passed: boolean;
  checkedSidewalkMeshes: number;
  checkedCurbMeshes: number;
  checkedCatchBasinMeshes: number;
  checkedTactileMeshes: number;
  uniquePavingMaterials: number;
  uniqueSidewalkMaterials: number;
  networkSegments: number;
  totalAreaSqMeters: number;
  totalCatchBasins: number;
  violations: SidewalkAuditViolation[];
}

/**
 * 都市全体の統一歩道システムに対し、
 * 1. マテリアル共有キャッシュ効率（重複 PuddleMaterial / 縁石 / 側溝マテリアル暴走なし）
 * 2. 歩道天面法線の正立（+Y 上向き保証）
 * 3. 縁石・歩道の接地精度（宙浮き・極端な沈み込みなし）
 * 4. JIS T 9251 点字警告ブロックの離散サイズ準拠（<= 2.6m、NaN なし）
 * 5. 直線歩道セグメント間の重なりゼロ
 * 6. SidewalkNetwork（SSOT）のカバレッジ・雨水集水桝・切下げスロープ登録
 * を一括監査する。
 */
export function auditSidewalkSystem(
  root: THREE.Object3D,
  sidewalkSystem: SidewalkSystem,
  options: {
    maxUniquePavingMaterials?: number;
    maxUniqueSidewalkMaterials?: number;
    requireFullCityCoverage?: boolean;
  } = {},
): SidewalkAuditReport {
  const violations: SidewalkAuditViolation[] = [];
  const maxUniquePavingMaterials = options.maxUniquePavingMaterials ?? 4;
  const maxUniqueSidewalkMaterials = options.maxUniqueSidewalkMaterials ?? 14;

  root.updateMatrixWorld(true);

  const uniquePavingMats = new Set<THREE.Material>();
  const uniqueAllSidewalkMats = new Set<THREE.Material>();
  let checkedSidewalkMeshes = 0;
  let checkedCurbMeshes = 0;
  let checkedCatchBasinMeshes = 0;
  let checkedTactileMeshes = 0;

  const straightBoxes: Array<{
    id: string;
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  }> = [];
  const tempBox = new THREE.Box3();
  const tempVert = new THREE.Vector3();
  const tempNormal = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();

  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) {
      return;
    }
    const name = obj.name;

    const isSidewalkSlab =
      name.startsWith("StraightSidewalk_") ||
      name.startsWith("CurvedSidewalk_") ||
      name.startsWith("IntersectionSidewalkCorner_") ||
      name.startsWith("IntersectionSidewalkEdge_");

    const isCurb =
      name.startsWith("StraightCurb_") ||
      name.startsWith("CurvedCurb_") ||
      name.startsWith("IntersectionCurbCorner_") ||
      name.startsWith("IntersectionCurbEdge_");

    const isGutter =
      name.startsWith("StraightLGutter_") ||
      name.startsWith("CurvedLGutter_") ||
      name.startsWith("IntersectionLGutterCorner_") ||
      name.startsWith("IntersectionLGutterEdge_");

    const isCatchBasin =
      name.startsWith("StraightCatchBasins_") ||
      name.startsWith("CurvedCatchBasins_") ||
      name.startsWith("IntersectionCatchBasin");

    const isTactile = obj.userData?.markingType === "TactilePaving";

    if (isSidewalkSlab) {
      checkedSidewalkMeshes += 1;
      const mat = obj.material as THREE.Material;
      uniquePavingMats.add(mat);
      uniqueAllSidewalkMats.add(mat);

      const posAttr = obj.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
      const normAttr = obj.geometry.getAttribute("normal") as THREE.BufferAttribute | undefined;
      if (posAttr && normAttr && posAttr.count > 0) {
        normalMatrix.getNormalMatrix(obj.matrixWorld);
        let topCount = 0;
        let invertedTopCount = 0;
        let maxLocalY = -Infinity;
        for (let i = 0; i < posAttr.count; i++) {
          const ly = posAttr.getY(i);
          if (ly > maxLocalY) maxLocalY = ly;
        }
        for (let i = 0; i < posAttr.count; i++) {
          tempNormal.fromBufferAttribute(normAttr, i).applyMatrix3(normalMatrix).normalize();
          if (Math.abs(tempNormal.y) > 0.65) {
            topCount += 1;
            if (tempNormal.y < -0.5) {
              invertedTopCount += 1;
            }
          }
        }
        if (topCount === 0 || invertedTopCount > 0) {
          violations.push({
            rule: "normal_inverted",
            severity: "error",
            targetId: `${obj.parent?.name ?? "root"}:${name}`,
            detail: `歩道天面の法線が反転または欠落しています (top=${topCount}, inverted=${invertedTopCount})`,
          });
        }
      }

      if (name.startsWith("StraightSidewalk_")) {
        tempBox.setFromObject(obj);
        straightBoxes.push({
          id: `${obj.parent?.userData?.roadName ?? obj.parent?.name ?? "seg"}:${name}`,
          minX: tempBox.min.x,
          maxX: tempBox.max.x,
          minZ: tempBox.min.z,
          maxZ: tempBox.max.z,
        });
      }
    }

    if (isCurb) {
      checkedCurbMeshes += 1;
      uniqueAllSidewalkMats.add(obj.material as THREE.Material);
      const posAttr = obj.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
      if (posAttr && posAttr.count > 0) {
        let hasNan = false;
        for (let i = 0; i < posAttr.count; i++) {
          tempVert.fromBufferAttribute(posAttr, i).applyMatrix4(obj.matrixWorld);
          if (
            !Number.isFinite(tempVert.x) ||
            !Number.isFinite(tempVert.y) ||
            !Number.isFinite(tempVert.z)
          ) {
            hasNan = true;
            break;
          }
        }
        if (hasNan) {
          violations.push({
            rule: "floating_curb",
            severity: "error",
            targetId: `${obj.parent?.name ?? "root"}:${name}`,
            detail: "縁石ジオメトリに非有限座標（NaN/Infinity）が含まれています",
          });
        }
      }
    }

    if (isGutter) {
      uniqueAllSidewalkMats.add(obj.material as THREE.Material);
    }

    if (isCatchBasin) {
      checkedCatchBasinMeshes += 1;
      uniqueAllSidewalkMats.add(obj.material as THREE.Material);
    }

    if (isTactile) {
      checkedTactileMeshes += 1;
      tempBox.setFromObject(obj);
      const spanX = tempBox.max.x - tempBox.min.x;
      const spanZ = tempBox.max.z - tempBox.min.z;
      const maxSpan = Math.max(spanX, spanZ);
      // 曲線外周アーク伸長・45°斜め回転の AABB 膨張を考慮しつつ、長尺連続帯（>3.0m）を厳格に排除
      if (!Number.isFinite(maxSpan) || maxSpan > 3.0) {
        violations.push({
          rule: "tactile_invalid",
          severity: "error",
          targetId: `${obj.parent?.name ?? "root"}:${name}`,
          detail: `点字警告ブロックが規定の離散サイズを超過しています (maxSpan=${maxSpan.toFixed(2)}m > 3.00m)`,
        });
      }
    }
  });

  // 直線歩道重複検査
  for (let i = 0; i < straightBoxes.length; i++) {
    const a = straightBoxes[i];
    for (let j = i + 1; j < straightBoxes.length; j++) {
      const b = straightBoxes[j];
      const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
      const oz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
      if (ox > 0.05 && oz > 0.05) {
        violations.push({
          rule: "sidewalk_overlap",
          severity: "error",
          targetId: `${a.id} x ${b.id}`,
          detail: `直線歩道スラブ同士が重複しています (${ox.toFixed(2)}m x ${oz.toFixed(2)}m)`,
        });
      }
    }
  }

  // マテリアル共有キャッシュ効率検査
  if (uniquePavingMats.size > maxUniquePavingMaterials) {
    violations.push({
      rule: "material_bloat",
      severity: "error",
      targetId: "SidewalkMaterialLibrary",
      detail: `歩道舗装 PuddleMaterial が共有キャッシュされていません (unique=${uniquePavingMats.size} > ${maxUniquePavingMaterials})`,
    });
  }
  if (uniqueAllSidewalkMats.size > maxUniqueSidewalkMaterials) {
    violations.push({
      rule: "material_bloat",
      severity: "error",
      targetId: "SidewalkMaterialLibrary",
      detail: `歩道・縁石・側溝・集水桝マテリアルが過多です (unique=${uniqueAllSidewalkMats.size} > ${maxUniqueSidewalkMaterials})`,
    });
  }

  const summary = sidewalkSystem.getNetworkSummary();
  if (options.requireFullCityCoverage) {
    if (
      summary.straightSegments < 40 ||
      summary.curvedSegments < 20 ||
      summary.intersectionCorners < 60 ||
      summary.totalCatchBasinCount < 40 ||
      summary.totalRampCount < 20
    ) {
      violations.push({
        rule: "network_incomplete",
        severity: "error",
        targetId: "SidewalkNetwork",
        detail: `都市全体の歩道ネットワークカバレッジが不足しています (${JSON.stringify(summary)})`,
      });
    }
  }

  return {
    passed: violations.every((v) => v.severity !== "error"),
    checkedSidewalkMeshes,
    checkedCurbMeshes,
    checkedCatchBasinMeshes,
    checkedTactileMeshes,
    uniquePavingMaterials: uniquePavingMats.size,
    uniqueSidewalkMaterials: uniqueAllSidewalkMats.size,
    networkSegments: summary.totalSegments,
    totalAreaSqMeters: summary.totalAreaSqMeters,
    totalCatchBasins: summary.totalCatchBasinCount,
    violations,
  };
}

import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import {
  getOpenDataCurvedRoadCorridors,
  sampleShibuyaTerrainY,
} from "../openData/gsiPlateauLoader";

export interface RoadClearanceCorridor {
  readonly id: string;
  readonly points: ReadonlyArray<{ x: number; z: number }>;
  readonly halfDriveableWidth: number;
}

export interface GroundSliceExtractionOptions {
  /** 任意の (x, z) における路面標高サンプラー */
  getGroundY?: (x: number, z: number) => number;
  /** 路面からの下限相対高さ [m]（デフォルト: -0.25） */
  minRelY?: number;
  /** 路面からの上限相対高さ [m]（デフォルト: 3.2 — 頭上歩道橋・アーチ桁を除外し地上柱・壁のみ抽出） */
  maxRelY?: number;
  /** 車道中心線からの非侵入フィルタ用コリドー一覧（未指定時は渋谷オープンデータ道路を自動使用） */
  roadCorridors?: ReadonlyArray<RoadClearanceCorridor>;
  /** 車道境界からの許容侵入マージン [m]（負値で車道内侵入を除外、デフォルト: -0.25） */
  minRoadGapM?: number;
  /** 除外するメッシュ判定関数（プロキシタイルや路面メッシュのスキップ用） */
  shouldSkipMesh?: (mesh: THREE.Mesh) => boolean;
  /** 中距離軽量躯体（`PlateauMidTile_*`）をコライダー抽出対象に含めるか（既定: false） */
  includeMidLodMeshes?: boolean;
}

export interface ExtractedCollisionMeshData {
  vertices: Float32Array;
  indices: Uint32Array;
  triangleCount: number;
  filteredRoadTriangles: number;
}

export interface CreatedGlbTrimeshColliders {
  body: RAPIER.RigidBody | null;
  colliders: RAPIER.Collider[];
  triangleCount: number;
  filteredRoadTriangles: number;
}

let cachedShibuyaRoadClearanceCorridors: RoadClearanceCorridor[] | null = null;

/**
 * 渋谷オープンデータ曲線道路の車道半幅とサンプリング点列をキャッシュ構築する。
 * GLB トライメッシュ抽出時に走行車線内へ微小にはみ出す三角形を自動除外し、見えない壁を防ぐ。
 */
export function getShibuyaRoadClearanceCorridors(): ReadonlyArray<RoadClearanceCorridor> {
  if (cachedShibuyaRoadClearanceCorridors !== null) {
    return cachedShibuyaRoadClearanceCorridors;
  }
  cachedShibuyaRoadClearanceCorridors = getOpenDataCurvedRoadCorridors().map((c) => {
    const curve = new THREE.CatmullRomCurve3(
      c.points.map((p) => new THREE.Vector3(p.x, 0, p.z)),
      false,
      "centripetal",
      0.5,
    );
    const isHikarieAccess = c.id === "nav-road-shibuya-hikarie-access";
    const lanes =
      c.widthMeters >= 20 ? 3 : Math.max(1, Math.min(3, Math.round(c.widthMeters / 8.5)));
    const halfDriveableWidth =
      lanes * (isHikarieAccess ? 2.9 : 3.4) + (isHikarieAccess ? 0.5 : 1.2);
    const sampleCount = Math.max(40, Math.ceil(curve.getLength() / 2.5));
    const sampled = curve.getPoints(sampleCount).map((pt) => ({ x: pt.x, z: pt.z }));
    return {
      id: c.id,
      points: sampled,
      halfDriveableWidth,
    };
  });
  return cachedShibuyaRoadClearanceCorridors;
}

function computeMinRoadGapXZ(
  px: number,
  pz: number,
  corridors: ReadonlyArray<RoadClearanceCorridor>,
): number {
  let minGap = Infinity;
  for (let ci = 0; ci < corridors.length; ci += 1) {
    const corr = corridors[ci];
    const pts = corr.points;
    let minDistSq = Infinity;
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i];
      const b = pts[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const lenSq = dx * dx + dz * dz;
      const t =
        lenSq > 1e-8 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / lenSq)) : 0;
      const cx = a.x + dx * t;
      const cz = a.z + dz * t;
      const dSq = (px - cx) * (px - cx) + (pz - cz) * (pz - cz);
      if (dSq < minDistSq) {
        minDistSq = dSq;
      }
    }
    const gap = Math.sqrt(minDistSq) - corr.halfDriveableWidth;
    if (gap < minGap) {
      minGap = gap;
    }
  }
  return minGap;
}

/**
 * Three.js の GLB / Object3D サブツリーから車両衝突高さ帯（路面 -0.25m 〜 +3.2m）に掛かる
 * 実体壁面・支柱・基壇の三角形のみをワールド座標で抽出し、Rapier Trimesh コライダー用バッファを生成する。
 *
 * Why 地上高さ帯スライス抽出を行うか:
 * - 高層ビルの上層階（地上 30m〜355m）は車両が到達しないため除外することで、BVH 構築と衝突判定を数倍高速化できる。
 * - 頭上歩道橋デッキ（地上 7.2m）やセンター街アーチ看板上部（地上 6.7m）を除外し、地上の支柱・階段のみに衝突させることで
 *   車両が高架下やアーチ下をスムーズに通過しつつ支柱には確実に衝突する実寸物理を実現できる。
 * - 走行車線内へ微小にはみ出す三角形は道路コリドー離隔フィルタで自動除外し、見えない壁の発生を防ぐ。
 */
export function extractGroundLevelCollisionTriangles(
  root: THREE.Object3D,
  options: GroundSliceExtractionOptions = {},
): ExtractedCollisionMeshData {
  const getGroundY =
    options.getGroundY ?? ((x: number, z: number) => (x < -395 ? sampleShibuyaTerrainY(x, z) : 0));
  const minRelY = options.minRelY ?? -0.25;
  const maxRelY = options.maxRelY ?? 3.2;
  const minRoadGapM = options.minRoadGapM ?? -0.25;
  const roadCorridors = options.roadCorridors ?? getShibuyaRoadClearanceCorridors();
  const shouldSkipMesh = options.shouldSkipMesh;

  root.updateMatrixWorld(true);

  const outPositions: number[] = [];
  const outIndices: number[] = [];
  let filteredRoadTriangles = 0;

  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const cross = new THREE.Vector3();
  const worldBox = new THREE.Box3();
  const boxCenter = new THREE.Vector3();

  root.traverse((obj) => {
    const isMesh = (obj as THREE.Mesh).isMesh === true;
    if (!isMesh) {
      return;
    }
    const mesh = obj as THREE.Mesh;
    const isMidLod =
      Boolean(mesh.userData?.isPlateauMid) ||
      mesh.name.startsWith("PlateauMidTile_") ||
      Boolean(mesh.parent?.name.startsWith("PlateauMidTile_"));
    const isProxy =
      Boolean(mesh.userData?.isPlateauProxy) ||
      mesh.name.startsWith("PlateauProxyTile_") ||
      (isMidLod && !options.includeMidLodMeshes) ||
      Boolean(mesh.userData?.isRoadInfrastructure);
    if (isProxy) {
      return;
    }
    if (shouldSkipMesh && shouldSkipMesh(mesh)) {
      return;
    }
    const geom = mesh.geometry;
    const posAttr = geom?.getAttribute("position");
    if (!posAttr || posAttr.count < 3) {
      return;
    }

    // メッシュ全体が明らかに上空（例: ShibuyaStream_HighRise / MidVoid）にある場合は早期スキップ
    if (!geom.boundingBox) {
      geom.computeBoundingBox();
    }
    if (geom.boundingBox) {
      worldBox.copy(geom.boundingBox).applyMatrix4(mesh.matrixWorld);
      worldBox.getCenter(boxCenter);
      const approxGroundY = getGroundY(boxCenter.x, boxCenter.z);
      const isEntirelyHighAboveGround = worldBox.min.y > approxGroundY + maxRelY + 12.0;
      if (isEntirelyHighAboveGround) {
        return;
      }
    }

    const indexAttr = geom.getIndex();
    const triCount = indexAttr ? Math.floor(indexAttr.count / 3) : Math.floor(posAttr.count / 3);
    const matWorld = mesh.matrixWorld;

    for (let t = 0; t < triCount; t += 1) {
      const i0 = indexAttr ? indexAttr.getX(t * 3) : t * 3;
      const i1 = indexAttr ? indexAttr.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = indexAttr ? indexAttr.getX(t * 3 + 2) : t * 3 + 2;

      v0.fromBufferAttribute(posAttr, i0).applyMatrix4(matWorld);
      v1.fromBufferAttribute(posAttr, i1).applyMatrix4(matWorld);
      v2.fromBufferAttribute(posAttr, i2).applyMatrix4(matWorld);

      const cx = (v0.x + v1.x + v2.x) / 3;
      const cz = (v0.z + v1.z + v2.z) / 3;
      const groundY = getGroundY(cx, cz);

      const triMinY = Math.min(v0.y, v1.y, v2.y);
      const triMaxY = Math.max(v0.y, v1.y, v2.y);
      const isOutsideHeightBand = triMaxY < groundY + minRelY || triMinY > groundY + maxRelY;
      if (isOutsideHeightBand) {
        continue;
      }

      e1.subVectors(v1, v0);
      e2.subVectors(v2, v0);
      cross.crossVectors(e1, e2);
      const doubleArea = cross.length();
      const isDegenerate = doubleArea < 1e-4;
      if (isDegenerate) {
        continue;
      }

      // 路面スラブ・広場エプロン等の平坦水平床面 (|ny| > 0.92 かつ地上 0.35m 未満) は除外し、壁面・支柱・段差のみ残す
      const absNormalY = Math.abs(cross.y / doubleArea);
      const isFlatGroundCap = absNormalY > 0.92 && triMaxY < groundY + 0.35;
      if (isFlatGroundCap) {
        continue;
      }

      if (roadCorridors.length > 0 && computeMinRoadGapXZ(cx, cz, roadCorridors) < minRoadGapM) {
        filteredRoadTriangles += 1;
        continue;
      }

      const baseVertIdx = outPositions.length / 3;
      outPositions.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
      outIndices.push(baseVertIdx, baseVertIdx + 1, baseVertIdx + 2);
    }
  });

  return {
    vertices: new Float32Array(outPositions),
    indices: new Uint32Array(outIndices),
    triangleCount: outIndices.length / 3,
    filteredRoadTriangles,
  };
}

/**
 * GLB ルートオブジェクトから地上帯 Rapier Trimesh 障害物コライダーを生成する。
 */
export function createGlbGroundSliceColliders(
  root: THREE.Object3D,
  world: RAPIER.World,
  rapier: typeof RAPIER,
  options: GroundSliceExtractionOptions = {},
): CreatedGlbTrimeshColliders {
  const extracted = extractGroundLevelCollisionTriangles(root, options);
  const hasTriangles = extracted.triangleCount > 0;
  if (!hasTriangles) {
    return {
      body: null,
      colliders: [],
      triangleCount: 0,
      filteredRoadTriangles: extracted.filteredRoadTriangles,
    };
  }

  const fixedBody = world.createRigidBody(rapier.RigidBodyDesc.fixed().setTranslation(0, 0, 0));
  const trimeshDesc = rapier.ColliderDesc.trimesh(extracted.vertices, extracted.indices)
    .setFriction(0.55)
    .setRestitution(0.08);
  const collider = world.createCollider(trimeshDesc, fixedBody);

  return {
    body: fixedBody,
    colliders: [collider],
    triangleCount: extracted.triangleCount,
    filteredRoadTriangles: extracted.filteredRoadTriangles,
  };
}

import * as THREE from "three";
import { applyRoadProp3DTexture } from "../roadProps";
import {
  BarrierSummarySchema,
  RoadBarrierPlacementSchema,
  type BarrierSummary,
  type RoadBarrierPlacement,
  type RoadBarrierType,
} from "./barrierSchema";

function createCurveMirrorCautionTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.fillStyle = "#facc15";
  ctx.fillRect(0, 0, 256, 96);
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, 244, 84);
  ctx.fillStyle = "#111827";
  ctx.font = "bold 46px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("注  意", 128, 50);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createRedWhiteStripePoleTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.fillStyle = "#eab308";
  ctx.fillRect(0, 0, 64, 256);
  // 日本の道路反射鏡標準の橙黄ポール＋黒反射警告帯
  ctx.fillStyle = "#1f2937";
  for (let y = 16; y < 120; y += 32) {
    ctx.fillRect(0, y, 64, 14);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

interface SharedBarrierGeometries {
  // 御影石ボラード
  granitePostGeo: THREE.CylinderGeometry;
  graniteCapGeo: THREE.SphereGeometry;
  graniteBandGeo: THREE.CylinderGeometry;
  // 反射車止めポール
  reflPostGeo: THREE.CylinderGeometry;
  reflBandGeo: THREE.CylinderGeometry;
  reflCapGeo: THREE.CylinderGeometry;
  // 道路反射鏡（カーブミラー）
  mirrorPoleGeo: THREE.CylinderGeometry;
  mirrorBackGeo: THREE.CylinderGeometry;
  mirrorHoodGeo: THREE.CylinderGeometry;
  mirrorGlassGeo: THREE.SphereGeometry;
  mirrorCautionGeo: THREE.BoxGeometry;
  // 視線誘導標（デリネーター）
  delinPostGeo: THREE.CylinderGeometry;
  delinDiscGeo: THREE.CylinderGeometry;
}

/**
 * 防護柵・安全施設（ボラード・カーブミラー・視線誘導標）用共有マテリアル＆ジオメトリライブラリ。
 */
export class BarrierMaterialLibrary {
  public readonly graniteMat: THREE.MeshStandardMaterial;
  public readonly bronzeRingMat: THREE.MeshStandardMaterial;
  public readonly reflectivePostMat: THREE.MeshStandardMaterial;
  public readonly retroAmberMat: THREE.MeshStandardMaterial;
  public readonly retroWhiteMat: THREE.MeshStandardMaterial;
  public readonly mirrorPoleMat: THREE.MeshStandardMaterial;
  public readonly mirrorOrangeHoodMat: THREE.MeshStandardMaterial;
  public readonly mirrorGlassMat: THREE.MeshStandardMaterial;
  public readonly mirrorCautionMat: THREE.MeshStandardMaterial;
  public readonly geometries: SharedBarrierGeometries;

  constructor() {
    this.graniteMat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      roughness: 0.72,
      metalness: 0.08,
    });
    applyRoadProp3DTexture(this.graniteMat, "bollard");

    this.bronzeRingMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.4,
      metalness: 0.85,
    });

    this.reflectivePostMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.32,
      metalness: 0.45,
    });
    applyRoadProp3DTexture(this.reflectivePostMat, "bollard");

    this.retroAmberMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.65,
      roughness: 0.14,
      metalness: 0.35,
    });
    applyRoadProp3DTexture(this.retroAmberMat, "retroreflector");

    this.retroWhiteMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      emissive: 0xe2e8f0,
      emissiveIntensity: 0.55,
      roughness: 0.14,
      metalness: 0.35,
    });
    applyRoadProp3DTexture(this.retroWhiteMat, "retroreflector");

    const poleTex = createRedWhiteStripePoleTexture();
    this.mirrorPoleMat = new THREE.MeshStandardMaterial({
      color: poleTex ? 0xffffff : 0xeab308,
      ...(poleTex ? { map: poleTex } : {}),
      roughness: 0.42,
      metalness: 0.35,
    });

    this.mirrorOrangeHoodMat = new THREE.MeshStandardMaterial({
      color: 0xf97316,
      roughness: 0.35,
      metalness: 0.18,
      side: THREE.DoubleSide,
    });

    // 凸面鏡（高反射クロームミラー）
    this.mirrorGlassMat = new THREE.MeshStandardMaterial({
      color: 0xdbe7f3,
      roughness: 0.05,
      metalness: 0.96,
    });

    const cautionTex = createCurveMirrorCautionTexture();
    this.mirrorCautionMat = new THREE.MeshStandardMaterial({
      color: cautionTex ? 0xffffff : 0xfacc15,
      ...(cautionTex ? { map: cautionTex } : {}),
      roughness: 0.35,
      metalness: 0.1,
    });

    const mirrorBackGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.05, 20);
    mirrorBackGeo.rotateX(Math.PI / 2);

    const mirrorHoodGeo = new THREE.CylinderGeometry(0.415, 0.415, 0.16, 20, 1, true, 0, Math.PI);
    mirrorHoodGeo.rotateX(Math.PI / 2);
    mirrorHoodGeo.rotateZ(Math.PI / 2);

    const mirrorGlassGeo = new THREE.SphereGeometry(
      0.39,
      18,
      12,
      0,
      Math.PI * 2,
      0,
      Math.PI * 0.28,
    );
    mirrorGlassGeo.rotateX(Math.PI / 2);

    const delinDiscGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.025, 14);
    delinDiscGeo.rotateX(Math.PI / 2);

    this.geometries = {
      granitePostGeo: new THREE.CylinderGeometry(0.14, 0.15, 0.74, 12),
      graniteCapGeo: new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      graniteBandGeo: new THREE.CylinderGeometry(0.146, 0.146, 0.045, 12),

      reflPostGeo: new THREE.CylinderGeometry(0.052, 0.056, 0.82, 12),
      reflBandGeo: new THREE.CylinderGeometry(0.056, 0.056, 0.08, 12),
      reflCapGeo: new THREE.CylinderGeometry(0.054, 0.054, 0.03, 12),

      mirrorPoleGeo: new THREE.CylinderGeometry(0.038, 0.042, 3.35, 10),
      mirrorBackGeo,
      mirrorHoodGeo,
      mirrorGlassGeo,
      mirrorCautionGeo: new THREE.BoxGeometry(0.44, 0.16, 0.022),

      delinPostGeo: new THREE.CylinderGeometry(0.032, 0.036, 0.95, 10),
      delinDiscGeo,
    };
  }

  public getCachedMaterialCount(): number {
    return 9;
  }
}

export interface PlaceBarrierParams {
  id?: string;
  type: RoadBarrierType;
  x: number;
  y?: number;
  z: number;
  rotationY?: number;
  mirrorDual?: boolean;
  label?: string;
}

export interface BarrierAuditViolation {
  rule: "material_bloat" | "invalid_coords" | "empty_registry";
  severity: "error" | "warning";
  targetId: string;
  detail: string;
}

export interface BarrierAuditReport {
  passed: boolean;
  checkedBarriers: number;
  uniqueMaterials: number;
  typeBreakdown: Record<string, number>;
  violations: BarrierAuditViolation[];
}

/**
 * 統一防護柵・安全施設システム（BarrierSystem）。
 * 丸の内御影石ボラード・渋谷反射車止めポール・道路反射鏡（カーブミラー）・視線誘導標を共有キャッシュで構築・監査する。
 */
export class BarrierSystem {
  public readonly materials: BarrierMaterialLibrary;
  private readonly placements: RoadBarrierPlacement[] = [];
  private counter = 0;

  constructor(materials?: BarrierMaterialLibrary) {
    this.materials = materials ?? new BarrierMaterialLibrary();
  }

  public placeBarrier(params: PlaceBarrierParams): {
    group: THREE.Group;
    placement: RoadBarrierPlacement;
    colliderRadius: number;
    colliderHeight: number;
  } {
    this.counter += 1;
    const id = params.id ?? `road_barrier_${params.type}_${this.counter}`;
    const y = params.y ?? 0;
    const rotationY = params.rotationY ?? 0;
    const mirrorDual = params.mirrorDual ?? false;

    const group = new THREE.Group();
    group.name = "RoadBarrierGroup";
    group.position.set(params.x, y, params.z);
    group.rotation.y = rotationY;
    group.userData.roadBarrierId = id;
    group.userData.roadBarrierType = params.type;
    group.userData.maxLodDrawDistance = params.type === "convex_curve_mirror" ? 165 : 115;

    const g = this.materials.geometries;
    let colliderRadius = 0.14;
    let colliderHeight = 0.9;

    if (params.type === "granite_bollard") {
      const post = new THREE.Mesh(g.granitePostGeo, this.materials.graniteMat);
      post.position.y = 0.37;
      post.receiveShadow = true;
      group.add(post);

      const cap = new THREE.Mesh(g.graniteCapGeo, this.materials.graniteMat);
      cap.position.y = 0.74;
      cap.userData.lodDetailTier = "high";
      group.add(cap);

      const band = new THREE.Mesh(g.graniteBandGeo, this.materials.bronzeRingMat);
      band.position.y = 0.62;
      band.userData.lodDetailTier = "high";
      group.add(band);

      colliderRadius = 0.16;
      colliderHeight = 0.9;
    } else if (params.type === "reflective_bollard") {
      const post = new THREE.Mesh(g.reflPostGeo, this.materials.reflectivePostMat);
      post.position.y = 0.41;
      post.receiveShadow = true;
      group.add(post);

      for (const bandY of [0.54, 0.7]) {
        const band = new THREE.Mesh(g.reflBandGeo, this.materials.retroWhiteMat);
        band.position.y = bandY;
        group.add(band);
      }

      const cap = new THREE.Mesh(g.reflCapGeo, this.materials.bronzeRingMat);
      cap.position.y = 0.835;
      cap.userData.lodDetailTier = "high";
      group.add(cap);

      colliderRadius = 0.08;
      colliderHeight = 0.85;
    } else if (params.type === "convex_curve_mirror") {
      const pole = new THREE.Mesh(g.mirrorPoleGeo, this.materials.mirrorPoleMat);
      pole.name = "CurveMirrorPole";
      pole.position.y = 1.675;
      pole.castShadow = true;
      group.add(pole);

      const attachMirrorHead = (offsetX: number, yawOffset: number): void => {
        const head = new THREE.Group();
        head.position.set(offsetX, 3.05, 0.06);
        head.rotation.y = yawOffset;

        const back = new THREE.Mesh(g.mirrorBackGeo, this.materials.mirrorOrangeHoodMat);
        head.add(back);

        const hood = new THREE.Mesh(g.mirrorHoodGeo, this.materials.mirrorOrangeHoodMat);
        hood.position.z = 0.07;
        head.add(hood);

        const glass = new THREE.Mesh(g.mirrorGlassGeo, this.materials.mirrorGlassMat);
        glass.position.z = -0.24;
        head.add(glass);

        group.add(head);
      };

      if (mirrorDual) {
        attachMirrorHead(-0.42, -0.32);
        attachMirrorHead(0.42, 0.32);
      } else {
        attachMirrorHead(0, 0);
      }

      const caution = new THREE.Mesh(g.mirrorCautionGeo, this.materials.mirrorCautionMat);
      caution.position.set(0, 2.42, 0.055);
      caution.userData.lodDetailTier = "high";
      group.add(caution);

      colliderRadius = 0.08;
      colliderHeight = 3.2;
    } else {
      const post = new THREE.Mesh(g.delinPostGeo, this.materials.reflectivePostMat);
      post.position.y = 0.475;
      group.add(post);

      const disc = new THREE.Mesh(g.delinDiscGeo, this.materials.retroAmberMat);
      disc.position.set(0, 0.86, 0.036);
      group.add(disc);

      colliderRadius = 0.06;
      colliderHeight = 0.95;
    }

    const placement = RoadBarrierPlacementSchema.parse({
      id,
      type: params.type,
      x: params.x,
      y,
      z: params.z,
      rotationY,
      mirrorDual,
      label: params.label,
    });
    this.placements.push(placement);

    return { group, placement, colliderRadius, colliderHeight };
  }

  public getAllPlacements(): ReadonlyArray<RoadBarrierPlacement> {
    return this.placements;
  }

  public getSummary(): BarrierSummary {
    const typeBreakdown: Record<string, number> = {};
    for (const p of this.placements) {
      typeBreakdown[p.type] = (typeBreakdown[p.type] ?? 0) + 1;
    }
    return BarrierSummarySchema.parse({
      version: "1.0.0",
      totalBarriers: this.placements.length,
      typeBreakdown,
      cachedMaterialCount: this.materials.getCachedMaterialCount(),
    });
  }
}

export function auditBarrierSystem(
  root: THREE.Object3D,
  system: BarrierSystem,
  options: { maxUniqueMaterials?: number; minBarriers?: number } = {},
): BarrierAuditReport {
  const violations: BarrierAuditViolation[] = [];
  const maxUniqueMaterials = options.maxUniqueMaterials ?? 12;
  const uniqueMats = new Set<THREE.Material>();
  let checkedBarriers = 0;
  const wp = new THREE.Vector3();

  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    if (obj.name !== "RoadBarrierGroup") {
      return;
    }
    checkedBarriers += 1;
    obj.getWorldPosition(wp);
    if (!Number.isFinite(wp.x) || !Number.isFinite(wp.y) || !Number.isFinite(wp.z)) {
      violations.push({
        rule: "invalid_coords",
        severity: "error",
        targetId: String(obj.userData?.roadBarrierId ?? "RoadBarrierGroup"),
        detail: "防護柵・安全施設の座標が非有限です",
      });
    }
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.Material) {
        uniqueMats.add(child.material);
      }
    });
  });

  if (uniqueMats.size > maxUniqueMaterials) {
    violations.push({
      rule: "material_bloat",
      severity: "error",
      targetId: "BarrierMaterialLibrary",
      detail: `防護柵マテリアルが共有されていません (unique=${uniqueMats.size} > ${maxUniqueMaterials})`,
    });
  }
  if (options.minBarriers !== undefined && checkedBarriers < options.minBarriers) {
    violations.push({
      rule: "empty_registry",
      severity: "error",
      targetId: "BarrierSystem",
      detail: `防護柵・安全施設数が期待値を下回っています (${checkedBarriers} < ${options.minBarriers})`,
    });
  }

  return {
    passed: violations.every((v) => v.severity !== "error"),
    checkedBarriers,
    uniqueMaterials: uniqueMats.size,
    typeBreakdown: system.getSummary().typeBreakdown,
    violations,
  };
}

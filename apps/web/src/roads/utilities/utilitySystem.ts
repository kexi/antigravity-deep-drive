import * as THREE from "three";
import { applyRoadProp3DTexture } from "../roadProps";
import {
  RoadUtilityPlacementSchema,
  RoadUtilitySummarySchema,
  type RoadUtilityPlacement,
  type RoadUtilitySummary,
  type RoadUtilityType,
} from "./utilitySchema";

function createTokyoSakuraManholeTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.fillStyle = "#3a4048";
  ctx.fillRect(0, 0, 256, 256);

  ctx.strokeStyle = "#626a75";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(128, 128, 118, 0, Math.PI * 2);
  ctx.stroke();

  // 東京都章＋桜の花弁モチーフ（簡略レリーフ）
  ctx.strokeStyle = "#7a838f";
  ctx.lineWidth = 4;
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    ctx.beginPath();
    ctx.arc(128 + Math.cos(a) * 58, 128 + Math.sin(a) * 58, 22, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(128, 128, 26, 0, Math.PI * 2);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createTelecomHandholeTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.fillStyle = "#474e57";
  ctx.fillRect(0, 0, 256, 160);
  ctx.strokeStyle = "#6d7682";
  ctx.lineWidth = 10;
  ctx.strokeRect(8, 8, 240, 144);
  ctx.strokeStyle = "#323840";
  ctx.lineWidth = 3;
  for (let x = 24; x < 236; x += 20) {
    ctx.beginPath();
    ctx.moveTo(x, 18);
    ctx.lineTo(x, 142);
    ctx.stroke();
  }
  ctx.fillStyle = "#8a94a0";
  ctx.font = "bold 24px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("電 力 ・ 通 信", 128, 80);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createPadTransformerFrontTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  // 日本の無電柱化地上機器（TEPCO ライトグレー塗装パネル）
  ctx.fillStyle = "#cfd5dc";
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = "#7c8590";
  ctx.lineWidth = 5;
  ctx.strokeRect(8, 8, 240, 240);
  // 中央扉分割線
  ctx.beginPath();
  ctx.moveTo(128, 12);
  ctx.lineTo(128, 244);
  ctx.stroke();
  // 上部・下部換気ルーバー
  ctx.fillStyle = "#4b5563";
  for (let y = 30; y < 86; y += 10) {
    ctx.fillRect(24, y, 88, 4);
    ctx.fillRect(144, y, 88, 4);
  }
  // 高圧危険プレート（黄地・黒枠・赤文字）
  ctx.fillStyle = "#facc15";
  ctx.fillRect(148, 118, 80, 44);
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 3;
  ctx.strokeRect(148, 118, 80, 44);
  ctx.fillStyle = "#b91c1c";
  ctx.font = "bold 18px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("高圧危険", 188, 140);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createFireHydrantSignTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.fillStyle = "#dc2626";
  ctx.beginPath();
  ctx.arc(128, 128, 122, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(128, 128, 108, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 56px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("消火栓", 128, 128);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createTreePitGrateTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.fillStyle = "#363b42";
  ctx.fillRect(0, 0, 256, 256);
  // 放射状・同心円状の鋳鉄ツリーサークルグレーチング＋中央の土・幹開口部
  ctx.strokeStyle = "#5c6470";
  ctx.lineWidth = 6;
  for (const r of [52, 82, 110]) {
    ctx.beginPath();
    ctx.arc(128, 128, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8;
    ctx.beginPath();
    ctx.moveTo(128 + Math.cos(a) * 44, 128 + Math.sin(a) * 44);
    ctx.lineTo(128 + Math.cos(a) * 124, 128 + Math.sin(a) * 124);
    ctx.stroke();
  }
  ctx.fillStyle = "#3b2f24";
  ctx.beginPath();
  ctx.arc(128, 128, 42, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

interface SharedUtilityGeometries {
  manholeGeo: THREE.CylinderGeometry;
  handholeGeo: THREE.BoxGeometry;
  transformerBaseGeo: THREE.BoxGeometry;
  transformerBodyGeo: THREE.BoxGeometry;
  transformerCapGeo: THREE.BoxGeometry;
  transformerFaceGeo: THREE.PlaneGeometry;
  hydrantPoleGeo: THREE.CylinderGeometry;
  hydrantDiscGeo: THREE.CylinderGeometry;
  hydrantFaceGeo: THREE.CircleGeometry;
  treePitBorderHGeo: THREE.BoxGeometry;
  treePitBorderVGeo: THREE.BoxGeometry;
  treePitGrateGeo: THREE.PlaneGeometry;
}

/**
 * 路面・地下インフラ・地上機器共有マテリアル＆ジオメトリライブラリ。
 */
export class RoadUtilityMaterialLibrary {
  public readonly sakuraManholeMat: THREE.MeshStandardMaterial;
  public readonly handholeMat: THREE.MeshStandardMaterial;
  public readonly concretePlinthMat: THREE.MeshStandardMaterial;
  public readonly transformerBodyMat: THREE.MeshStandardMaterial;
  public readonly transformerFrontMat: THREE.MeshStandardMaterial;
  public readonly hydrantRedPoleMat: THREE.MeshStandardMaterial;
  public readonly hydrantSignMat: THREE.MeshStandardMaterial;
  public readonly treePitGraniteMat: THREE.MeshStandardMaterial;
  public readonly treePitGrateMat: THREE.MeshStandardMaterial;
  public readonly geometries: SharedUtilityGeometries;

  constructor() {
    const manholeTex = createTokyoSakuraManholeTexture();
    this.sakuraManholeMat = new THREE.MeshStandardMaterial({
      color: manholeTex ? 0xffffff : 0x3a4048,
      ...(manholeTex ? { map: manholeTex } : {}),
      roughness: 0.56,
      metalness: 0.58,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    applyRoadProp3DTexture(this.sakuraManholeMat, "manhole");

    const handholeTex = createTelecomHandholeTexture();
    this.handholeMat = new THREE.MeshStandardMaterial({
      color: handholeTex ? 0xffffff : 0x474e57,
      ...(handholeTex ? { map: handholeTex } : {}),
      roughness: 0.58,
      metalness: 0.52,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    applyRoadProp3DTexture(this.handholeMat, "manhole");

    this.concretePlinthMat = new THREE.MeshStandardMaterial({
      color: 0x9ca3af,
      roughness: 0.85,
      metalness: 0.05,
    });

    this.transformerBodyMat = new THREE.MeshStandardMaterial({
      color: 0xcbd2da,
      roughness: 0.42,
      metalness: 0.35,
    });

    const tfTex = createPadTransformerFrontTexture();
    this.transformerFrontMat = new THREE.MeshStandardMaterial({
      color: tfTex ? 0xffffff : 0xcbd2da,
      ...(tfTex ? { map: tfTex } : {}),
      roughness: 0.4,
      metalness: 0.3,
    });

    this.hydrantRedPoleMat = new THREE.MeshStandardMaterial({
      color: 0xdc2626,
      roughness: 0.34,
      metalness: 0.28,
    });

    const hydrantTex = createFireHydrantSignTexture();
    this.hydrantSignMat = new THREE.MeshStandardMaterial({
      color: hydrantTex ? 0xffffff : 0xdc2626,
      ...(hydrantTex ? { map: hydrantTex } : {}),
      roughness: 0.3,
      metalness: 0.15,
    });

    this.treePitGraniteMat = new THREE.MeshStandardMaterial({
      color: 0xa6a49d,
      roughness: 0.78,
      metalness: 0.08,
    });

    const treeGrateTex = createTreePitGrateTexture();
    this.treePitGrateMat = new THREE.MeshStandardMaterial({
      color: treeGrateTex ? 0xffffff : 0x3b4048,
      ...(treeGrateTex ? { map: treeGrateTex } : {}),
      roughness: 0.62,
      metalness: 0.42,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    const hydrantDiscGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.025, 20);
    hydrantDiscGeo.rotateX(Math.PI / 2);

    const treePitGrateGeo = new THREE.PlaneGeometry(1.16, 1.16);
    treePitGrateGeo.rotateX(-Math.PI / 2);

    this.geometries = {
      manholeGeo: new THREE.CylinderGeometry(0.34, 0.35, 0.022, 20),
      handholeGeo: new THREE.BoxGeometry(0.86, 0.022, 0.56),
      transformerBaseGeo: new THREE.BoxGeometry(1.12, 0.14, 0.72),
      transformerBodyGeo: new THREE.BoxGeometry(1.04, 1.32, 0.64),
      transformerCapGeo: new THREE.BoxGeometry(1.08, 0.06, 0.68),
      transformerFaceGeo: new THREE.PlaneGeometry(1.0, 1.24),
      hydrantPoleGeo: new THREE.CylinderGeometry(0.036, 0.042, 3.35, 10),
      hydrantDiscGeo,
      hydrantFaceGeo: new THREE.CircleGeometry(0.275, 20),
      treePitBorderHGeo: new THREE.BoxGeometry(1.38, 0.045, 0.11),
      treePitBorderVGeo: new THREE.BoxGeometry(0.11, 0.045, 1.16),
      treePitGrateGeo,
    };
  }

  public getCachedMaterialCount(): number {
    return 9;
  }
}

export interface PlaceRoadUtilityParams {
  id?: string;
  type: RoadUtilityType;
  x: number;
  y?: number;
  z: number;
  rotationY?: number;
  operator?: string;
}

export interface RoadUtilityColliderSpec {
  kind: "cuboid" | "cylinder";
  halfX: number;
  halfY: number;
  halfZ: number;
  radius: number;
}

export interface RoadUtilityAuditViolation {
  rule: "material_bloat" | "invalid_coords" | "empty_registry";
  severity: "error" | "warning";
  targetId: string;
  detail: string;
}

export interface RoadUtilityAuditReport {
  passed: boolean;
  checkedUtilities: number;
  uniqueMaterials: number;
  typeBreakdown: Record<string, number>;
  violations: RoadUtilityAuditViolation[];
}

/**
 * 統一路面・地下インフラシステム（RoadUtilitySystem）。
 * 東京都桜マンホール・電力通信ハンドホール・無電柱化地上変圧器・赤ポール消火栓標識・街路樹植樹桝を一元生成・監査する。
 */
export class RoadUtilitySystem {
  public readonly materials: RoadUtilityMaterialLibrary;
  private readonly placements: RoadUtilityPlacement[] = [];
  private counter = 0;

  constructor(materials?: RoadUtilityMaterialLibrary) {
    this.materials = materials ?? new RoadUtilityMaterialLibrary();
  }

  public placeUtility(params: PlaceRoadUtilityParams): {
    group: THREE.Group;
    placement: RoadUtilityPlacement;
    collider: RoadUtilityColliderSpec | null;
  } {
    this.counter += 1;
    const id = params.id ?? `road_utility_${params.type}_${this.counter}`;
    const y = params.y ?? 0;
    const rotationY = params.rotationY ?? 0;

    const group = new THREE.Group();
    group.name = "RoadUtilityGroup";
    group.position.set(params.x, y, params.z);
    group.rotation.y = rotationY;
    group.userData.roadUtilityId = id;
    group.userData.roadUtilityType = params.type;
    group.userData.maxLodDrawDistance =
      params.type === "pad_transformer" || params.type === "fire_hydrant_sign" ? 175 : 110;

    const g = this.materials.geometries;
    let collider: RoadUtilityColliderSpec | null = null;

    if (params.type === "tokyo_sewer_manhole") {
      const lid = new THREE.Mesh(g.manholeGeo, this.materials.sakuraManholeMat);
      lid.name = "TokyoSakuraManhole";
      lid.position.y = 0.011;
      lid.receiveShadow = true;
      group.add(lid);
    } else if (params.type === "telecom_handhole") {
      const lid = new THREE.Mesh(g.handholeGeo, this.materials.handholeMat);
      lid.name = "TelecomUtilityHandhole";
      lid.position.y = 0.011;
      lid.receiveShadow = true;
      group.add(lid);
    } else if (params.type === "pad_transformer") {
      const plinth = new THREE.Mesh(g.transformerBaseGeo, this.materials.concretePlinthMat);
      plinth.position.y = 0.07;
      plinth.receiveShadow = true;
      group.add(plinth);

      const body = new THREE.Mesh(g.transformerBodyGeo, this.materials.transformerBodyMat);
      body.name = "UndergroundPadTransformer";
      body.position.y = 0.8;
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);

      const cap = new THREE.Mesh(g.transformerCapGeo, this.materials.transformerBodyMat);
      cap.position.y = 1.49;
      cap.userData.lodDetailTier = "high";
      group.add(cap);

      const frontPanel = new THREE.Mesh(g.transformerFaceGeo, this.materials.transformerFrontMat);
      frontPanel.position.set(0, 0.8, 0.324);
      group.add(frontPanel);

      const backPanel = new THREE.Mesh(g.transformerFaceGeo, this.materials.transformerFrontMat);
      backPanel.position.set(0, 0.8, -0.324);
      backPanel.rotation.y = Math.PI;
      group.add(backPanel);

      collider = { kind: "cuboid", halfX: 0.56, halfY: 0.76, halfZ: 0.36, radius: 0.56 };
    } else if (params.type === "fire_hydrant_sign") {
      const pole = new THREE.Mesh(g.hydrantPoleGeo, this.materials.hydrantRedPoleMat);
      pole.name = "FireHydrantSignPole";
      pole.position.y = 1.675;
      pole.castShadow = true;
      group.add(pole);

      const disc = new THREE.Mesh(g.hydrantDiscGeo, this.materials.hydrantRedPoleMat);
      disc.position.set(0, 3.25, 0.045);
      group.add(disc);

      const front = new THREE.Mesh(g.hydrantFaceGeo, this.materials.hydrantSignMat);
      front.position.set(0, 3.25, 0.06);
      group.add(front);

      const back = new THREE.Mesh(g.hydrantFaceGeo, this.materials.hydrantSignMat);
      back.position.set(0, 3.25, 0.03);
      back.rotation.y = Math.PI;
      group.add(back);

      collider = { kind: "cylinder", halfX: 0.08, halfY: 1.65, halfZ: 0.08, radius: 0.08 };
    } else {
      // 街路樹植樹桝（御影石縁石枠＋鋳鉄ツリーサークルグレーチング）
      const pitY = 0.165;
      const topBorder = new THREE.Mesh(g.treePitBorderHGeo, this.materials.treePitGraniteMat);
      topBorder.position.set(0, pitY, 0.635);
      group.add(topBorder);

      const bottomBorder = new THREE.Mesh(g.treePitBorderHGeo, this.materials.treePitGraniteMat);
      bottomBorder.position.set(0, pitY, -0.635);
      group.add(bottomBorder);

      const leftBorder = new THREE.Mesh(g.treePitBorderVGeo, this.materials.treePitGraniteMat);
      leftBorder.position.set(-0.635, pitY, 0);
      group.add(leftBorder);

      const rightBorder = new THREE.Mesh(g.treePitBorderVGeo, this.materials.treePitGraniteMat);
      rightBorder.position.set(0.635, pitY, 0);
      group.add(rightBorder);

      const grate = new THREE.Mesh(g.treePitGrateGeo, this.materials.treePitGrateMat);
      grate.name = "TreePitCircleGrate";
      grate.position.set(0, pitY + 0.015, 0);
      grate.receiveShadow = true;
      group.add(grate);
    }

    const placement = RoadUtilityPlacementSchema.parse({
      id,
      type: params.type,
      x: params.x,
      y,
      z: params.z,
      rotationY,
      operator: params.operator,
    });
    this.placements.push(placement);

    return { group, placement, collider };
  }

  public getAllPlacements(): ReadonlyArray<RoadUtilityPlacement> {
    return this.placements;
  }

  public getSummary(): RoadUtilitySummary {
    const typeBreakdown: Record<string, number> = {};
    for (const p of this.placements) {
      typeBreakdown[p.type] = (typeBreakdown[p.type] ?? 0) + 1;
    }
    return RoadUtilitySummarySchema.parse({
      version: "1.0.0",
      totalUtilities: this.placements.length,
      typeBreakdown,
      cachedMaterialCount: this.materials.getCachedMaterialCount(),
    });
  }
}

export function auditRoadUtilitySystem(
  root: THREE.Object3D,
  system: RoadUtilitySystem,
  options: { maxUniqueMaterials?: number; minUtilities?: number } = {},
): RoadUtilityAuditReport {
  const violations: RoadUtilityAuditViolation[] = [];
  const maxUniqueMaterials = options.maxUniqueMaterials ?? 12;
  const uniqueMats = new Set<THREE.Material>();
  let checkedUtilities = 0;
  const wp = new THREE.Vector3();

  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    if (obj.name !== "RoadUtilityGroup") {
      return;
    }
    checkedUtilities += 1;
    obj.getWorldPosition(wp);
    if (!Number.isFinite(wp.x) || !Number.isFinite(wp.y) || !Number.isFinite(wp.z)) {
      violations.push({
        rule: "invalid_coords",
        severity: "error",
        targetId: String(obj.userData?.roadUtilityId ?? "RoadUtilityGroup"),
        detail: "路面・地下インフラの座標が非有限です",
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
      targetId: "RoadUtilityMaterialLibrary",
      detail: `路面インフラマテリアルが共有されていません (unique=${uniqueMats.size} > ${maxUniqueMaterials})`,
    });
  }
  if (options.minUtilities !== undefined && checkedUtilities < options.minUtilities) {
    violations.push({
      rule: "empty_registry",
      severity: "error",
      targetId: "RoadUtilitySystem",
      detail: `路面・地下インフラ数が期待値を下回っています (${checkedUtilities} < ${options.minUtilities})`,
    });
  }

  return {
    passed: violations.every((v) => v.severity !== "error"),
    checkedUtilities,
    uniqueMaterials: uniqueMats.size,
    typeBreakdown: system.getSummary().typeBreakdown,
    violations,
  };
}

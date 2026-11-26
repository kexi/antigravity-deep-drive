import * as THREE from "three";
import {
  StreetFurniturePlacementSchema,
  StreetFurnitureSummarySchema,
  type StreetFurniturePlacement,
  type StreetFurnitureSummary,
  type StreetFurnitureType,
} from "./furnitureSchema";

function createBusStopSignTexture(brand: "toei" | "tokyu"): THREE.CanvasTexture | null {
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
  const accent = brand === "toei" ? "#15803d" : "#dc2626";
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(128, 128, 122, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 18;
  ctx.beginPath();
  ctx.arc(128, 128, 112, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = accent;
  ctx.fillRect(36, 98, 184, 58);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 36px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(brand === "toei" ? "都営バス" : "東急バス", 128, 128);

  ctx.fillStyle = "#1f2937";
  ctx.font = "bold 24px sans-serif";
  ctx.fillText("BUS STOP", 128, 186);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createPostboxFrontTexture(): THREE.CanvasTexture | null {
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
  ctx.fillRect(0, 0, 256, 256);

  // 2口投函口（手紙・はがき / その他郵便物）
  ctx.fillStyle = "#18181b";
  ctx.fillRect(24, 34, 92, 20);
  ctx.fillRect(140, 34, 92, 20);

  // 白い「〒」マーク
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 86px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("〒", 128, 126);

  // 取集時刻表パネル
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(58, 178, 140, 56);
  ctx.fillStyle = "#1e293b";
  ctx.font = "bold 18px sans-serif";
  ctx.fillText("郵便 POST", 128, 206);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createDistrictInfoKioskTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 384;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(0, 0, 256, 384);
  ctx.fillStyle = "#0ea5e9";
  ctx.fillRect(14, 14, 228, 56);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 24px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("街区・地下鉄案内", 128, 42);

  // 街区地図パネル風グリッド
  ctx.fillStyle = "#f1f5f9";
  ctx.fillRect(14, 82, 228, 212);
  ctx.strokeStyle = "#94a3b8";
  ctx.lineWidth = 3;
  for (let i = 1; i <= 4; i++) {
    ctx.beginPath();
    ctx.moveTo(14 + i * 45, 82);
    ctx.lineTo(14 + i * 45, 294);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(14, 82 + i * 42);
    ctx.lineTo(242, 82 + i * 42);
    ctx.stroke();
  }
  // 現在地ピン
  ctx.fillStyle = "#ef4444";
  ctx.beginPath();
  ctx.arc(128, 188, 12, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#e2e8f0";
  ctx.font = "bold 18px sans-serif";
  ctx.fillText("AREA MAP / METRO", 128, 336);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createParkingMeterFaceTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 192;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, 128, 192);
  ctx.fillStyle = "#0284c7";
  ctx.fillRect(10, 10, 108, 48);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 24px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("P 60分", 64, 34);

  ctx.fillStyle = "#0f172a";
  ctx.fillRect(20, 72, 88, 42);
  ctx.fillStyle = "#22c55e";
  ctx.font = "bold 24px monospace";
  ctx.fillText("300円", 64, 94);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

interface SharedFurnitureGeometries {
  busBaseGeo: THREE.CylinderGeometry;
  busPoleGeo: THREE.CylinderGeometry;
  busTimetableGeo: THREE.BoxGeometry;
  busDiscGeo: THREE.CylinderGeometry;
  busFaceGeo: THREE.CircleGeometry;
  postLegGeo: THREE.CylinderGeometry;
  postBodyGeo: THREE.BoxGeometry;
  postRoofGeo: THREE.BoxGeometry;
  postFaceGeo: THREE.PlaneGeometry;
  kioskFrameGeo: THREE.BoxGeometry;
  kioskFaceGeo: THREE.PlaneGeometry;
  meterPoleGeo: THREE.CylinderGeometry;
  meterHeadGeo: THREE.BoxGeometry;
  meterFaceGeo: THREE.PlaneGeometry;
  benchSeatGeo: THREE.BoxGeometry;
  benchBackGeo: THREE.BoxGeometry;
  benchLegGeo: THREE.BoxGeometry;
}

/**
 * 沿道公共交通・都市ストリートファニチャー用共有マテリアル＆ジオメトリライブラリ。
 */
export class StreetFurnitureMaterialLibrary {
  public readonly steelPoleMat: THREE.MeshStandardMaterial;
  public readonly darkFrameMat: THREE.MeshStandardMaterial;
  public readonly toeiSignMat: THREE.MeshStandardMaterial;
  public readonly tokyuSignMat: THREE.MeshStandardMaterial;
  public readonly busTimetableMat: THREE.MeshStandardMaterial;
  public readonly postboxRedMat: THREE.MeshStandardMaterial;
  public readonly postboxFrontMat: THREE.MeshStandardMaterial;
  public readonly infoKioskPanelMat: THREE.MeshStandardMaterial;
  public readonly parkingMeterBodyMat: THREE.MeshStandardMaterial;
  public readonly parkingMeterFaceMat: THREE.MeshStandardMaterial;
  public readonly benchWoodMat: THREE.MeshStandardMaterial;
  public readonly geometries: SharedFurnitureGeometries;

  constructor() {
    this.steelPoleMat = new THREE.MeshStandardMaterial({
      color: 0xdbe2ea,
      roughness: 0.36,
      metalness: 0.55,
    });

    this.darkFrameMat = new THREE.MeshStandardMaterial({
      color: 0x262b33,
      roughness: 0.38,
      metalness: 0.65,
    });

    const toeiTex = createBusStopSignTexture("toei");
    this.toeiSignMat = new THREE.MeshStandardMaterial({
      color: toeiTex ? 0xffffff : 0x15803d,
      ...(toeiTex ? { map: toeiTex } : {}),
      roughness: 0.32,
      metalness: 0.1,
    });

    const tokyuTex = createBusStopSignTexture("tokyu");
    this.tokyuSignMat = new THREE.MeshStandardMaterial({
      color: tokyuTex ? 0xffffff : 0xdc2626,
      ...(tokyuTex ? { map: tokyuTex } : {}),
      roughness: 0.32,
      metalness: 0.1,
    });

    this.busTimetableMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      roughness: 0.3,
      metalness: 0.12,
    });

    this.postboxRedMat = new THREE.MeshStandardMaterial({
      color: 0xdc2626,
      roughness: 0.28,
      metalness: 0.25,
    });

    const postTex = createPostboxFrontTexture();
    this.postboxFrontMat = new THREE.MeshStandardMaterial({
      color: postTex ? 0xffffff : 0xdc2626,
      ...(postTex ? { map: postTex } : {}),
      roughness: 0.28,
      metalness: 0.2,
    });

    const kioskTex = createDistrictInfoKioskTexture();
    this.infoKioskPanelMat = new THREE.MeshStandardMaterial({
      color: kioskTex ? 0xffffff : 0x334155,
      ...(kioskTex ? { map: kioskTex, emissiveMap: kioskTex } : {}),
      emissive: 0x94a3b8,
      emissiveIntensity: 0.25,
      roughness: 0.26,
      metalness: 0.1,
    });

    this.parkingMeterBodyMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.34,
      metalness: 0.38,
    });

    const meterTex = createParkingMeterFaceTexture();
    this.parkingMeterFaceMat = new THREE.MeshStandardMaterial({
      color: meterTex ? 0xffffff : 0x0284c7,
      ...(meterTex ? { map: meterTex } : {}),
      roughness: 0.3,
      metalness: 0.15,
    });

    this.benchWoodMat = new THREE.MeshStandardMaterial({
      color: 0x8d5b34,
      roughness: 0.72,
      metalness: 0.05,
    });

    const busDiscGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.04, 20);
    busDiscGeo.rotateX(Math.PI / 2);

    this.geometries = {
      busBaseGeo: new THREE.CylinderGeometry(0.22, 0.26, 0.22, 12),
      busPoleGeo: new THREE.CylinderGeometry(0.036, 0.04, 2.55, 10),
      busTimetableGeo: new THREE.BoxGeometry(0.32, 0.62, 0.08),
      busDiscGeo,
      busFaceGeo: new THREE.CircleGeometry(0.255, 20),

      postLegGeo: new THREE.CylinderGeometry(0.065, 0.075, 0.64, 10),
      postBodyGeo: new THREE.BoxGeometry(0.48, 0.74, 0.44),
      postRoofGeo: new THREE.BoxGeometry(0.52, 0.06, 0.48),
      postFaceGeo: new THREE.PlaneGeometry(0.45, 0.7),

      kioskFrameGeo: new THREE.BoxGeometry(0.92, 2.25, 0.16),
      kioskFaceGeo: new THREE.PlaneGeometry(0.82, 1.55),

      meterPoleGeo: new THREE.CylinderGeometry(0.038, 0.042, 1.15, 10),
      meterHeadGeo: new THREE.BoxGeometry(0.2, 0.34, 0.16),
      meterFaceGeo: new THREE.PlaneGeometry(0.18, 0.28),

      benchSeatGeo: new THREE.BoxGeometry(1.76, 0.07, 0.46),
      benchBackGeo: new THREE.BoxGeometry(1.76, 0.36, 0.06),
      benchLegGeo: new THREE.BoxGeometry(0.08, 0.44, 0.48),
    };
  }

  public getCachedMaterialCount(): number {
    return 11;
  }
}

export interface PlaceStreetFurnitureParams {
  id?: string;
  type: StreetFurnitureType;
  x: number;
  y?: number;
  z: number;
  rotationY?: number;
  titleJa?: string;
  titleEn?: string;
}

export interface StreetFurnitureColliderSpec {
  kind: "cuboid" | "cylinder";
  halfX: number;
  halfY: number;
  halfZ: number;
  radius: number;
}

export interface StreetFurnitureAuditViolation {
  rule: "material_bloat" | "invalid_coords" | "empty_registry";
  severity: "error" | "warning";
  targetId: string;
  detail: string;
}

export interface StreetFurnitureAuditReport {
  passed: boolean;
  checkedItems: number;
  uniqueMaterials: number;
  typeBreakdown: Record<string, number>;
  violations: StreetFurnitureAuditViolation[];
}

/**
 * 統一沿道交通・ストリートファニチャーシステム（StreetFurnitureSystem）。
 * 都営/東急バス停・郵便ポスト（〒）・街区/地下鉄案内サイン・パーキングメーター・歩道ベンチを共有キャッシュで構築・監査する。
 */
export class StreetFurnitureSystem {
  public readonly materials: StreetFurnitureMaterialLibrary;
  private readonly placements: StreetFurniturePlacement[] = [];
  private counter = 0;

  constructor(materials?: StreetFurnitureMaterialLibrary) {
    this.materials = materials ?? new StreetFurnitureMaterialLibrary();
  }

  public placeFurniture(params: PlaceStreetFurnitureParams): {
    group: THREE.Group;
    placement: StreetFurniturePlacement;
    collider: StreetFurnitureColliderSpec;
  } {
    this.counter += 1;
    const id = params.id ?? `street_furniture_${params.type}_${this.counter}`;
    const y = params.y ?? 0;
    const rotationY = params.rotationY ?? 0;

    const group = new THREE.Group();
    group.name = "StreetFurnitureGroup";
    group.position.set(params.x, y, params.z);
    group.rotation.y = rotationY;
    group.userData.streetFurnitureId = id;
    group.userData.streetFurnitureType = params.type;
    group.userData.maxLodDrawDistance = 175;

    const g = this.materials.geometries;
    let collider: StreetFurnitureColliderSpec = {
      kind: "cylinder",
      halfX: 0.22,
      halfY: 1.1,
      halfZ: 0.22,
      radius: 0.22,
    };

    if (params.type === "bus_stop_toei" || params.type === "bus_stop_tokyu") {
      const signMat =
        params.type === "bus_stop_toei" ? this.materials.toeiSignMat : this.materials.tokyuSignMat;

      const base = new THREE.Mesh(g.busBaseGeo, this.materials.darkFrameMat);
      base.position.y = 0.11;
      group.add(base);

      const pole = new THREE.Mesh(g.busPoleGeo, this.materials.steelPoleMat);
      pole.name = "BusStopPole";
      pole.position.y = 1.28;
      pole.castShadow = true;
      group.add(pole);

      const timetable = new THREE.Mesh(g.busTimetableGeo, this.materials.busTimetableMat);
      timetable.position.set(0, 1.48, 0.05);
      timetable.userData.lodDetailTier = "medium";
      group.add(timetable);

      const disc = new THREE.Mesh(g.busDiscGeo, this.materials.steelPoleMat);
      disc.position.set(0, 2.52, 0);
      group.add(disc);

      const faceF = new THREE.Mesh(g.busFaceGeo, signMat);
      faceF.position.set(0, 2.52, 0.022);
      group.add(faceF);

      const faceB = new THREE.Mesh(g.busFaceGeo, signMat);
      faceB.position.set(0, 2.52, -0.022);
      faceB.rotation.y = Math.PI;
      group.add(faceB);

      collider = { kind: "cylinder", halfX: 0.24, halfY: 1.3, halfZ: 0.24, radius: 0.24 };
    } else if (params.type === "japan_postbox") {
      const leg = new THREE.Mesh(g.postLegGeo, this.materials.darkFrameMat);
      leg.position.y = 0.32;
      group.add(leg);

      const body = new THREE.Mesh(g.postBodyGeo, this.materials.postboxRedMat);
      body.name = "JapanPostboxBody";
      body.position.y = 0.99;
      body.castShadow = true;
      group.add(body);

      const roof = new THREE.Mesh(g.postRoofGeo, this.materials.postboxRedMat);
      roof.position.y = 1.38;
      roof.userData.lodDetailTier = "high";
      group.add(roof);

      const face = new THREE.Mesh(g.postFaceGeo, this.materials.postboxFrontMat);
      face.position.set(0, 0.99, 0.223);
      group.add(face);

      collider = { kind: "cuboid", halfX: 0.25, halfY: 0.7, halfZ: 0.23, radius: 0.25 };
    } else if (params.type === "district_info_kiosk") {
      const frame = new THREE.Mesh(g.kioskFrameGeo, this.materials.darkFrameMat);
      frame.name = "DistrictInfoKiosk";
      frame.position.y = 1.125;
      frame.castShadow = true;
      group.add(frame);

      const panelF = new THREE.Mesh(g.kioskFaceGeo, this.materials.infoKioskPanelMat);
      panelF.position.set(0, 1.32, 0.084);
      group.add(panelF);

      const panelB = new THREE.Mesh(g.kioskFaceGeo, this.materials.infoKioskPanelMat);
      panelB.position.set(0, 1.32, -0.084);
      panelB.rotation.y = Math.PI;
      group.add(panelB);

      collider = { kind: "cuboid", halfX: 0.46, halfY: 1.12, halfZ: 0.12, radius: 0.46 };
    } else if (params.type === "parking_meter") {
      const pole = new THREE.Mesh(g.meterPoleGeo, this.materials.parkingMeterBodyMat);
      pole.position.y = 0.575;
      group.add(pole);

      const head = new THREE.Mesh(g.meterHeadGeo, this.materials.parkingMeterBodyMat);
      head.name = "ParkingMeterHead";
      head.position.y = 1.32;
      head.castShadow = true;
      group.add(head);

      const face = new THREE.Mesh(g.meterFaceGeo, this.materials.parkingMeterFaceMat);
      face.position.set(0, 1.32, 0.083);
      group.add(face);

      collider = { kind: "cylinder", halfX: 0.12, halfY: 0.75, halfZ: 0.12, radius: 0.12 };
    } else {
      const seat = new THREE.Mesh(g.benchSeatGeo, this.materials.benchWoodMat);
      seat.name = "SidewalkBenchSeat";
      seat.position.set(0, 0.44, 0);
      seat.castShadow = true;
      seat.receiveShadow = true;
      group.add(seat);

      const back = new THREE.Mesh(g.benchBackGeo, this.materials.benchWoodMat);
      back.position.set(0, 0.74, -0.2);
      back.rotation.x = -0.14;
      back.castShadow = true;
      group.add(back);

      for (const legX of [-0.74, 0.74]) {
        const leg = new THREE.Mesh(g.benchLegGeo, this.materials.darkFrameMat);
        leg.position.set(legX, 0.22, 0);
        group.add(leg);
      }

      collider = { kind: "cuboid", halfX: 0.88, halfY: 0.45, halfZ: 0.28, radius: 0.88 };
    }

    const placement = StreetFurniturePlacementSchema.parse({
      id,
      type: params.type,
      x: params.x,
      y,
      z: params.z,
      rotationY,
      titleJa: params.titleJa,
      titleEn: params.titleEn,
    });
    this.placements.push(placement);

    return { group, placement, collider };
  }

  public getAllPlacements(): ReadonlyArray<StreetFurniturePlacement> {
    return this.placements;
  }

  public getSummary(): StreetFurnitureSummary {
    const typeBreakdown: Record<string, number> = {};
    for (const p of this.placements) {
      typeBreakdown[p.type] = (typeBreakdown[p.type] ?? 0) + 1;
    }
    return StreetFurnitureSummarySchema.parse({
      version: "1.0.0",
      totalItems: this.placements.length,
      typeBreakdown,
      cachedMaterialCount: this.materials.getCachedMaterialCount(),
    });
  }
}

export function auditStreetFurnitureSystem(
  root: THREE.Object3D,
  system: StreetFurnitureSystem,
  options: { maxUniqueMaterials?: number; minItems?: number } = {},
): StreetFurnitureAuditReport {
  const violations: StreetFurnitureAuditViolation[] = [];
  const maxUniqueMaterials = options.maxUniqueMaterials ?? 14;
  const uniqueMats = new Set<THREE.Material>();
  let checkedItems = 0;
  const wp = new THREE.Vector3();

  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    if (obj.name !== "StreetFurnitureGroup") {
      return;
    }
    checkedItems += 1;
    obj.getWorldPosition(wp);
    if (!Number.isFinite(wp.x) || !Number.isFinite(wp.y) || !Number.isFinite(wp.z)) {
      violations.push({
        rule: "invalid_coords",
        severity: "error",
        targetId: String(obj.userData?.streetFurnitureId ?? "StreetFurnitureGroup"),
        detail: "ストリートファニチャーの座標が非有限です",
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
      targetId: "StreetFurnitureMaterialLibrary",
      detail: `ファニチャーマテリアルが共有されていません (unique=${uniqueMats.size} > ${maxUniqueMaterials})`,
    });
  }
  if (options.minItems !== undefined && checkedItems < options.minItems) {
    violations.push({
      rule: "empty_registry",
      severity: "error",
      targetId: "StreetFurnitureSystem",
      detail: `ストリートファニチャー数が期待値を下回っています (${checkedItems} < ${options.minItems})`,
    });
  }

  return {
    passed: violations.every((v) => v.severity !== "error"),
    checkedItems,
    uniqueMaterials: uniqueMats.size,
    typeBreakdown: system.getSummary().typeBreakdown,
    violations,
  };
}

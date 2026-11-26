import * as THREE from "three";
import { applyRoadProp3DTexture } from "../roadProps";
import {
  RoadLampPlacementSchema,
  RoadLightingSummarySchema,
  type RoadLampPlacement,
  type RoadLampStyle,
  type RoadLightingSummary,
} from "./lightingSchema";

function createLampGlowHaloTexture(rgbHex: string): THREE.CanvasTexture | null {
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0.0, "#ffffff");
  grad.addColorStop(0.28, rgbHex);
  grad.addColorStop(0.65, `${rgbHex}55`);
  grad.addColorStop(1.0, `${rgbHex}00`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

interface SharedLampGeometries {
  // 丸の内2灯ランタン
  twinBaseGeo: THREE.CylinderGeometry;
  twinPoleGeo: THREE.CylinderGeometry;
  twinArmGeo: THREE.BoxGeometry;
  twinGlobeGeo: THREE.SphereGeometry;
  twinCapGeo: THREE.ConeGeometry;
  twinHaloGeo: THREE.PlaneGeometry;
  // 幹線道路LEDコブラ照明灯
  cobraBaseGeo: THREE.CylinderGeometry;
  cobraPoleGeo: THREE.CylinderGeometry;
  cobraArmGeo: THREE.CylinderGeometry;
  cobraHousingGeo: THREE.BoxGeometry;
  cobraLensGeo: THREE.PlaneGeometry;
  cobraHaloGeo: THREE.PlaneGeometry;
  // 渋谷モダン街路灯
  modernBaseGeo: THREE.BoxGeometry;
  modernPoleGeo: THREE.CylinderGeometry;
  modernArmGeo: THREE.BoxGeometry;
  modernHeadGeo: THREE.BoxGeometry;
  modernLensGeo: THREE.PlaneGeometry;
  modernSubLampGeo: THREE.CylinderGeometry;
  modernHaloGeo: THREE.PlaneGeometry;
}

/**
 * 道路照明用マテリアル＆ジオメトリ共有ライブラリ。
 * Why: 旧 createStreetLamp は 1 基ごとに 2 マテリアル＋5 ジオメトリを新規複製していたため、
 * 都市全体で最大 8 マテリアル・1 セットの共有ジオメトリへ統合し、昼夜調光を O(1) で一括更新する。
 */
export class RoadLightingMaterialLibrary {
  public readonly castIronPoleMat: THREE.MeshStandardMaterial;
  public readonly arterialSteelPoleMat: THREE.MeshStandardMaterial;
  public readonly shibuyaModernPoleMat: THREE.MeshStandardMaterial;
  public readonly warmGlobeMat: THREE.MeshStandardMaterial;
  public readonly cobraLedMat: THREE.MeshStandardMaterial;
  public readonly modernLedMat: THREE.MeshStandardMaterial;
  public readonly warmHaloMat: THREE.MeshBasicMaterial;
  public readonly coolHaloMat: THREE.MeshBasicMaterial;
  public readonly geometries: SharedLampGeometries;

  constructor() {
    this.castIronPoleMat = new THREE.MeshStandardMaterial({
      color: 0x1b1c20,
      metalness: 0.82,
      roughness: 0.3,
    });
    applyRoadProp3DTexture(this.castIronPoleMat, "pole");

    this.arterialSteelPoleMat = new THREE.MeshStandardMaterial({
      color: 0x8b95a2,
      metalness: 0.58,
      roughness: 0.38,
    });
    applyRoadProp3DTexture(this.arterialSteelPoleMat, "pole");

    this.shibuyaModernPoleMat = new THREE.MeshStandardMaterial({
      color: 0x2d323b,
      metalness: 0.65,
      roughness: 0.32,
    });
    applyRoadProp3DTexture(this.shibuyaModernPoleMat, "pole");

    this.warmGlobeMat = new THREE.MeshStandardMaterial({
      color: 0xebe6dc,
      emissive: 0xffd79b,
      emissiveIntensity: 0.15,
      roughness: 0.22,
      metalness: 0.05,
      toneMapped: false,
    });

    this.cobraLedMat = new THREE.MeshStandardMaterial({
      color: 0xdce4ee,
      emissive: 0xf4f8ff,
      emissiveIntensity: 0.12,
      roughness: 0.18,
      metalness: 0.1,
      toneMapped: false,
    });

    this.modernLedMat = new THREE.MeshStandardMaterial({
      color: 0xe6e4de,
      emissive: 0xffe4b8,
      emissiveIntensity: 0.12,
      roughness: 0.2,
      metalness: 0.08,
      toneMapped: false,
    });

    const warmHaloTex = createLampGlowHaloTexture("#ffd28a");
    this.warmHaloMat = new THREE.MeshBasicMaterial({
      color: 0xffd28a,
      ...(warmHaloTex ? { map: warmHaloTex } : {}),
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    const coolHaloTex = createLampGlowHaloTexture("#e0f2fe");
    this.coolHaloMat = new THREE.MeshBasicMaterial({
      color: 0xe0f2fe,
      ...(coolHaloTex ? { map: coolHaloTex } : {}),
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    const cobraArmGeo = new THREE.CylinderGeometry(0.048, 0.065, 2.25, 10);
    cobraArmGeo.rotateZ(Math.PI / 2 - 0.18);

    const cobraLensGeo = new THREE.PlaneGeometry(0.68, 0.26);
    cobraLensGeo.rotateX(Math.PI / 2);

    const modernLensGeo = new THREE.PlaneGeometry(0.58, 0.22);
    modernLensGeo.rotateX(Math.PI / 2);

    this.geometries = {
      twinBaseGeo: new THREE.CylinderGeometry(0.18, 0.26, 0.9, 10),
      twinPoleGeo: new THREE.CylinderGeometry(0.075, 0.12, 5.8, 10),
      twinArmGeo: new THREE.BoxGeometry(1.3, 0.07, 0.07),
      twinGlobeGeo: new THREE.SphereGeometry(0.27, 12, 10),
      twinCapGeo: new THREE.ConeGeometry(0.31, 0.18, 10),
      twinHaloGeo: new THREE.PlaneGeometry(1.45, 1.45),

      cobraBaseGeo: new THREE.CylinderGeometry(0.16, 0.21, 0.55, 10),
      cobraPoleGeo: new THREE.CylinderGeometry(0.085, 0.145, 7.8, 12),
      cobraArmGeo,
      cobraHousingGeo: new THREE.BoxGeometry(0.84, 0.12, 0.34),
      cobraLensGeo,
      cobraHaloGeo: new THREE.PlaneGeometry(1.9, 1.9),

      modernBaseGeo: new THREE.BoxGeometry(0.28, 0.65, 0.28),
      modernPoleGeo: new THREE.CylinderGeometry(0.072, 0.105, 6.4, 10),
      modernArmGeo: new THREE.BoxGeometry(1.55, 0.08, 0.09),
      modernHeadGeo: new THREE.BoxGeometry(0.7, 0.09, 0.28),
      modernLensGeo,
      modernSubLampGeo: new THREE.CylinderGeometry(0.08, 0.08, 0.34, 8),
      modernHaloGeo: new THREE.PlaneGeometry(1.55, 1.55),
    };
  }

  public setNightFactor(rawFactor: number): void {
    const f = Math.max(0, Math.min(1, rawFactor));
    this.warmGlobeMat.emissiveIntensity = 0.15 + f * 2.25;
    this.cobraLedMat.emissiveIntensity = 0.12 + f * 2.5;
    this.modernLedMat.emissiveIntensity = 0.12 + f * 2.3;

    const haloAlpha = f > 0.18 ? Math.min(0.68, (f - 0.18) * 0.85) : 0.0;
    this.warmHaloMat.opacity = haloAlpha;
    this.coolHaloMat.opacity = haloAlpha * 0.92;
  }

  public getCachedMaterialCount(): number {
    return 8;
  }
}

/**
 * 座標と道路名から実在の東京・渋谷地区に即した道路照明様式を自動解決する。
 */
export function resolveRoadLampStyle(
  x: number,
  z: number,
  roadName?: string,
): {
  style: RoadLampStyle;
  district: string;
} {
  const key = (roadName ?? "").toLowerCase();
  const isShibuya = x < -395;
  if (isShibuya) {
    const isMajorShibuyaArterial =
      key.includes("246") ||
      key.includes("玉川") ||
      key.includes("青山") ||
      key.includes("明治") ||
      key.includes("meiji") ||
      key.includes("roppongi");
    return {
      style: isMajorShibuyaArterial ? "tokyo_arterial_cobra" : "shibuya_modern_arm",
      district: "shibuya",
    };
  }

  const isMarunouchiHistoric = Math.abs(x) <= 180 && z >= -40 && z <= 238;
  if (isMarunouchiHistoric) {
    return { style: "marunouchi_twin_globe", district: "marunouchi" };
  }
  return { style: "tokyo_arterial_cobra", district: "tokyo_arterial" };
}

export interface PlaceRoadLampParams {
  id?: string;
  x: number;
  y?: number;
  z: number;
  rotationY?: number;
  style?: RoadLampStyle;
  roadName?: string;
}

export interface RoadLightingAuditViolation {
  rule: "material_bloat" | "point_light_forbidden" | "invalid_coords" | "empty_registry";
  severity: "error" | "warning";
  targetId: string;
  detail: string;
}

export interface RoadLightingAuditReport {
  passed: boolean;
  checkedLamps: number;
  uniqueMaterials: number;
  scenePointLights: number;
  styleBreakdown: Record<string, number>;
  violations: RoadLightingAuditViolation[];
}

/**
 * 統一道路照明システム（RoadLightingSystem）。
 * 街灯の地区別造形・共有キャッシュ・昼夜光学調光・空間登録を一元管理する。
 */
export class RoadLightingSystem {
  public readonly materials: RoadLightingMaterialLibrary;
  private readonly placements: RoadLampPlacement[] = [];
  private readonly haloMeshes: THREE.Mesh[] = [];
  private lampCounter = 0;
  private currentNightFactor = 0;

  constructor(materials?: RoadLightingMaterialLibrary) {
    this.materials = materials ?? new RoadLightingMaterialLibrary();
  }

  public placeLamp(params: PlaceRoadLampParams): {
    group: THREE.Group;
    placement: RoadLampPlacement;
    colliderRadius: number;
    colliderHeight: number;
  } {
    const resolved = resolveRoadLampStyle(params.x, params.z, params.roadName);
    const style = params.style ?? resolved.style;
    const y = params.y ?? 0;
    const rotationY = params.rotationY ?? 0;
    this.lampCounter += 1;
    const id = params.id ?? `road_lamp_${this.lampCounter}`;

    const group = new THREE.Group();
    group.name = "RoadLampGroup";
    group.position.set(params.x, y, params.z);
    group.rotation.y = rotationY;
    group.userData.maxLodDrawDistance = 220;
    group.userData.roadLampStyle = style;
    group.userData.roadLampId = id;

    const g = this.materials.geometries;
    let poleHeightMeters = 6.2;
    let armLengthMeters = 1.3;

    if (style === "marunouchi_twin_globe") {
      const base = new THREE.Mesh(g.twinBaseGeo, this.materials.castIronPoleMat);
      base.position.y = 0.45;
      base.userData.lodDetailTier = "high";
      group.add(base);

      const pole = new THREE.Mesh(g.twinPoleGeo, this.materials.castIronPoleMat);
      pole.name = "RoadLampPole";
      pole.position.y = 3.1;
      group.add(pole);

      const arm = new THREE.Mesh(g.twinArmGeo, this.materials.castIronPoleMat);
      arm.position.set(0, 5.75, 0);
      arm.userData.lodDetailTier = "medium";
      group.add(arm);

      for (const offsetX of [-0.58, 0.58]) {
        const globe = new THREE.Mesh(g.twinGlobeGeo, this.materials.warmGlobeMat);
        globe.position.set(offsetX, 6.0, 0);
        group.add(globe);

        const cap = new THREE.Mesh(g.twinCapGeo, this.materials.castIronPoleMat);
        cap.position.set(offsetX, 6.28, 0);
        cap.userData.lodDetailTier = "high";
        group.add(cap);

        const halo = new THREE.Mesh(g.twinHaloGeo, this.materials.warmHaloMat);
        halo.position.set(offsetX, 6.0, 0);
        halo.visible = this.currentNightFactor > 0.18;
        halo.userData.lodDetailTier = "medium";
        group.add(halo);
        this.haloMeshes.push(halo);
      }
      poleHeightMeters = 6.35;
      armLengthMeters = 1.3;
    } else if (style === "tokyo_arterial_cobra") {
      const base = new THREE.Mesh(g.cobraBaseGeo, this.materials.arterialSteelPoleMat);
      base.position.y = 0.275;
      base.userData.lodDetailTier = "high";
      group.add(base);

      const pole = new THREE.Mesh(g.cobraPoleGeo, this.materials.arterialSteelPoleMat);
      pole.name = "RoadLampPole";
      pole.position.y = 3.9;
      group.add(pole);

      const arm = new THREE.Mesh(g.cobraArmGeo, this.materials.arterialSteelPoleMat);
      arm.position.set(1.05, 7.82, 0);
      arm.userData.lodDetailTier = "medium";
      group.add(arm);

      const housing = new THREE.Mesh(g.cobraHousingGeo, this.materials.arterialSteelPoleMat);
      housing.position.set(2.22, 8.02, 0);
      group.add(housing);

      const lens = new THREE.Mesh(g.cobraLensGeo, this.materials.cobraLedMat);
      lens.position.set(2.22, 7.955, 0);
      group.add(lens);

      const halo = new THREE.Mesh(g.cobraHaloGeo, this.materials.coolHaloMat);
      halo.position.set(2.22, 7.86, 0);
      halo.visible = this.currentNightFactor > 0.18;
      halo.userData.lodDetailTier = "medium";
      group.add(halo);
      this.haloMeshes.push(halo);

      poleHeightMeters = 8.1;
      armLengthMeters = 2.25;
    } else {
      const base = new THREE.Mesh(g.modernBaseGeo, this.materials.shibuyaModernPoleMat);
      base.position.y = 0.325;
      base.userData.lodDetailTier = "high";
      group.add(base);

      const pole = new THREE.Mesh(g.modernPoleGeo, this.materials.shibuyaModernPoleMat);
      pole.name = "RoadLampPole";
      pole.position.y = 3.2;
      group.add(pole);

      const arm = new THREE.Mesh(g.modernArmGeo, this.materials.shibuyaModernPoleMat);
      arm.position.set(0.75, 6.28, 0);
      arm.userData.lodDetailTier = "medium";
      group.add(arm);

      const head = new THREE.Mesh(g.modernHeadGeo, this.materials.shibuyaModernPoleMat);
      head.position.set(1.52, 6.28, 0);
      group.add(head);

      const lens = new THREE.Mesh(g.modernLensGeo, this.materials.modernLedMat);
      lens.position.set(1.52, 6.23, 0);
      group.add(lens);

      const subLamp = new THREE.Mesh(g.modernSubLampGeo, this.materials.modernLedMat);
      subLamp.position.set(-0.18, 4.35, 0);
      subLamp.userData.lodDetailTier = "high";
      group.add(subLamp);

      const halo = new THREE.Mesh(g.modernHaloGeo, this.materials.warmHaloMat);
      halo.position.set(1.52, 6.18, 0);
      halo.visible = this.currentNightFactor > 0.18;
      halo.userData.lodDetailTier = "medium";
      group.add(halo);
      this.haloMeshes.push(halo);

      poleHeightMeters = 6.4;
      armLengthMeters = 1.55;
    }

    const placement = RoadLampPlacementSchema.parse({
      id,
      style,
      x: params.x,
      y,
      z: params.z,
      rotationY,
      poleHeightMeters,
      armLengthMeters,
      district: resolved.district,
    });
    this.placements.push(placement);

    return {
      group,
      placement,
      colliderRadius: 0.22,
      colliderHeight: 5.0,
    };
  }

  public setNightFactor(rawFactor: number): void {
    const f = Math.max(0, Math.min(1, rawFactor));
    this.currentNightFactor = f;
    this.materials.setNightFactor(f);
    const shouldShowHalos = f > 0.18;
    for (let i = 0; i < this.haloMeshes.length; i++) {
      this.haloMeshes[i].visible = shouldShowHalos;
    }
  }

  public getAllPlacements(): ReadonlyArray<RoadLampPlacement> {
    return this.placements;
  }

  public getSummary(): RoadLightingSummary {
    const styleBreakdown: Record<string, number> = {};
    for (const p of this.placements) {
      styleBreakdown[p.style] = (styleBreakdown[p.style] ?? 0) + 1;
    }
    return RoadLightingSummarySchema.parse({
      version: "1.0.0",
      totalLamps: this.placements.length,
      styleBreakdown,
      cachedMaterialCount: this.materials.getCachedMaterialCount(),
      nightFactor: this.currentNightFactor,
    });
  }
}

export function auditRoadLightingSystem(
  root: THREE.Object3D,
  system: RoadLightingSystem,
  options: { maxUniqueMaterials?: number; minLamps?: number } = {},
): RoadLightingAuditReport {
  const violations: RoadLightingAuditViolation[] = [];
  const maxUniqueMaterials = options.maxUniqueMaterials ?? 10;
  const uniqueMats = new Set<THREE.Material>();
  let checkedLamps = 0;
  let scenePointLights = 0;
  const worldPos = new THREE.Vector3();

  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    if (obj.name !== "RoadLampGroup") {
      return;
    }
    checkedLamps += 1;
    obj.getWorldPosition(worldPos);
    if (
      !Number.isFinite(worldPos.x) ||
      !Number.isFinite(worldPos.y) ||
      !Number.isFinite(worldPos.z)
    ) {
      violations.push({
        rule: "invalid_coords",
        severity: "error",
        targetId: String(obj.userData?.roadLampId ?? "RoadLampGroup"),
        detail: "道路照明のワールド座標が非有限です",
      });
    }
    obj.traverse((child) => {
      if (child instanceof THREE.PointLight || child instanceof THREE.SpotLight) {
        scenePointLights += 1;
      }
      if (child instanceof THREE.Mesh && child.material instanceof THREE.Material) {
        uniqueMats.add(child.material);
      }
    });
  });

  if (scenePointLights > 0) {
    violations.push({
      rule: "point_light_forbidden",
      severity: "error",
      targetId: "RoadLightingSystem",
      detail: `街灯グループ内に動的ライトが混入しています (count=${scenePointLights})`,
    });
  }
  if (uniqueMats.size > maxUniqueMaterials) {
    violations.push({
      rule: "material_bloat",
      severity: "error",
      targetId: "RoadLightingMaterialLibrary",
      detail: `道路照明マテリアルが共有されていません (unique=${uniqueMats.size} > ${maxUniqueMaterials})`,
    });
  }
  if (options.minLamps !== undefined && checkedLamps < options.minLamps) {
    violations.push({
      rule: "empty_registry",
      severity: "error",
      targetId: "RoadLightingSystem",
      detail: `道路照明数が期待値を下回っています (${checkedLamps} < ${options.minLamps})`,
    });
  }

  return {
    passed: violations.every((v) => v.severity !== "error"),
    checkedLamps,
    uniqueMaterials: uniqueMats.size,
    scenePointLights,
    styleBreakdown: system.getSummary().styleBreakdown,
    violations,
  };
}

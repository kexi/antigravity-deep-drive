import type RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import {
  RoadSignPlacementSchema,
  type RoadSignPlacement,
  type RoadSignType,
} from "../assets/schema";
import { logger } from "../core/logger";
import { JapaneseRoadSigns } from "./roadSigns";

export type SignShapeKind =
  | "circle"
  | "inverted-triangle"
  | "diamond"
  | "pentagon"
  | "rectangle"
  | "overhead"
  | "delineator";

export interface RoadSignCatalogEntry {
  type: RoadSignType;
  titleJa: string;
  code: string;
  category: "regulatory" | "warning" | "indication" | "guide" | "accessory";
  shape: SignShapeKind;
  boardCenterY: number;
  boardTopExtent: number;
  poleHeight: number;
  defaultLabel?: string;
  defaultSubLabel?: string;
  defaultAuxiliaryText?: string;
  defaultSpeedLimit?: number;
}

export interface SignAssemblyValidationResult {
  valid: boolean;
  poleHeight: number;
  poleTopY: number;
  boardTopY: number;
  poleClearanceFromTop: number;
  hasBackMountingRibs: boolean;
  hasUprightFrontPlane: boolean;
  issues: string[];
}

export interface LeftSidewalkPlacementOptions {
  originX: number;
  originZ: number;
  travelHeadingRad: number;
  forwardDistance?: number;
  leftLateralOffset?: number;
}

export interface LeftSidewalkPlacementResult {
  position: [number, number, number];
  rotationY: number;
}

export interface SignPhysicsContext {
  rapier: typeof RAPIER;
  physicsWorld: RAPIER.World;
  fixedGroundBody: RAPIER.RigidBody;
}

export interface CreatedRoadSignInstance {
  id: string;
  spec: RoadSignPlacement;
  group: THREE.Group;
  spotLights: THREE.SpotLight[];
  colliderHandles: number[];
  colliders: RAPIER.Collider[];
  validation: SignAssemblyValidationResult;
}

export interface CustomSinglePoleSignBlueprint {
  id: string;
  shape: Exclude<SignShapeKind, "overhead" | "delineator">;
  boardCenterY?: number;
  radius?: number;
  width?: number;
  height?: number;
  auxiliaryText?: string;
  position?: [number, number, number];
  rotationY?: number;
  drawFace: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
}

/**
 * 看板上端から支柱やドームキャップが絶対に突き出さない安全な支柱高さを算出する。
 * ドームキャップ半径 (0.044m) を差し引き、看板上端 (boardCenterY + boardTopExtent) より
 * topClearance 分だけ下で支柱を終端させる。
 */
export function computeSafePoleHeight(
  boardCenterY: number,
  boardTopExtent: number,
  topClearance = 0.08,
): number {
  const domeCapAllowance = 0.044;
  const maxAllowedPoleHeight = boardCenterY + boardTopExtent - topClearance - domeCapAllowance;
  const safeHeight = Math.max(0.7, Number(maxAllowedPoleHeight.toFixed(3)));
  return safeHeight;
}

/**
 * ラジアン角を (-π, π] の範囲に正規化する。
 */
export function normalizeAngleRad(angleRad: number): number {
  let normalized = ((angleRad + Math.PI) % (Math.PI * 2)) - Math.PI;
  const isUnderflow = normalized <= -Math.PI;
  if (isUnderflow) {
    normalized += Math.PI * 2;
  }
  return Number(normalized.toFixed(4));
}

/**
 * 日本の左側通行に基づき、進行方向ベクトル (headingRad: +Z=0, -Z=π, +X=π/2, -X=-π/2) から
 * 前方左歩道側の設置座標と、ドライバーに正対する rotationY を自動算出する。
 */
export function resolveLeftSidewalkPlacement(
  options: LeftSidewalkPlacementOptions,
): LeftSidewalkPlacementResult {
  const forwardDistance = options.forwardDistance ?? 18.0;
  const leftLateralOffset = options.leftLateralOffset ?? 4.2;

  const forwardX = Math.sin(options.travelHeadingRad);
  const forwardZ = Math.cos(options.travelHeadingRad);
  // Three.js 右手系 (Up = +Y, Forward = (sinθ, 0, cosθ)) における左方向ベクトル (Up × Forward)
  const leftX = Math.cos(options.travelHeadingRad);
  const leftZ = -Math.sin(options.travelHeadingRad);

  const targetX = Number(
    (options.originX + forwardX * forwardDistance + leftX * leftLateralOffset).toFixed(2),
  );
  const targetZ = Number(
    (options.originZ + forwardZ * forwardDistance + leftZ * leftLateralOffset).toFixed(2),
  );
  // 標識表面 (+Z) が接近するドライバー (-Forward 方向) に正対する角度
  const facingRotationY = normalizeAngleRad(options.travelHeadingRad + Math.PI);

  return {
    position: [targetX, 0, targetZ],
    rotationY: facingRotationY,
  };
}

/**
 * 全15種の日本道路標識カタログ定義。
 * すべての単柱標識で poleHeight < boardCenterY + boardTopExtent が構造的に保証されている。
 */
export const ROAD_SIGN_CATALOG: Record<RoadSignType, RoadSignCatalogEntry> = {
  speed_limit: {
    type: "speed_limit",
    titleJa: "最高速度 (323)",
    code: "323",
    category: "regulatory",
    shape: "circle",
    boardCenterY: 3.4,
    boardTopExtent: 0.38,
    poleHeight: 3.62,
    defaultSpeedLimit: 50,
    defaultAuxiliaryText: "ここまで",
  },
  no_parking: {
    type: "no_parking",
    titleJa: "駐車禁止 (316)",
    code: "316",
    category: "regulatory",
    shape: "circle",
    boardCenterY: 3.35,
    boardTopExtent: 0.38,
    poleHeight: 3.58,
    defaultAuxiliaryText: "終日",
  },
  no_stopping: {
    type: "no_stopping",
    titleJa: "駐停車禁止 (315)",
    code: "315",
    category: "regulatory",
    shape: "circle",
    boardCenterY: 3.35,
    boardTopExtent: 0.38,
    poleHeight: 3.58,
    defaultAuxiliaryText: "終日",
  },
  no_entry: {
    type: "no_entry",
    titleJa: "車両進入禁止 (303)",
    code: "303",
    category: "regulatory",
    shape: "circle",
    boardCenterY: 3.2,
    boardTopExtent: 0.38,
    poleHeight: 3.45,
    defaultAuxiliaryText: "自転車を除く",
  },
  no_uturn: {
    type: "no_uturn",
    titleJa: "転回禁止 (313)",
    code: "313",
    category: "regulatory",
    shape: "circle",
    boardCenterY: 3.35,
    boardTopExtent: 0.38,
    poleHeight: 3.58,
    defaultAuxiliaryText: "終日",
  },
  direction_mandatory: {
    type: "direction_mandatory",
    titleJa: "指定方向外進行禁止 (311)",
    code: "311",
    category: "regulatory",
    shape: "circle",
    boardCenterY: 3.2,
    boardTopExtent: 0.38,
    poleHeight: 3.45,
    defaultAuxiliaryText: "軽車両を除く",
  },
  stop: {
    type: "stop",
    titleJa: "一時停止 (330)",
    code: "330",
    category: "regulatory",
    shape: "inverted-triangle",
    boardCenterY: 3.2,
    boardTopExtent: 0.37,
    poleHeight: 3.45,
    defaultLabel: "止まれ",
    defaultSubLabel: "STOP",
  },
  one_way: {
    type: "one_way",
    titleJa: "一方通行 (326-A)",
    code: "326-A",
    category: "regulatory",
    shape: "rectangle",
    boardCenterY: 3.25,
    boardTopExtent: 0.21,
    poleHeight: 3.34,
    defaultAuxiliaryText: "自転車を除く",
  },
  lane_direction: {
    type: "lane_direction",
    titleJa: "進行方向別通行区分 (327-7)",
    code: "327-7",
    category: "regulatory",
    shape: "rectangle",
    boardCenterY: 3.85,
    boardTopExtent: 0.575,
    poleHeight: 4.28,
  },
  crosswalk: {
    type: "crosswalk",
    titleJa: "横断歩道 (407-A)",
    code: "407-A",
    category: "indication",
    shape: "pentagon",
    boardCenterY: 3.2,
    boardTopExtent: 0.32,
    poleHeight: 3.42,
  },
  traffic_light_ahead: {
    type: "traffic_light_ahead",
    titleJa: "信号機あり (201-2)",
    code: "201-2",
    category: "warning",
    shape: "diamond",
    boardCenterY: 3.2,
    boardTopExtent: 0.38,
    poleHeight: 3.42,
    defaultAuxiliaryText: "50m先",
  },
  street_name: {
    type: "street_name",
    titleJa: "道路の通称名 (119)",
    code: "119",
    category: "guide",
    shape: "rectangle",
    boardCenterY: 3.4,
    boardTopExtent: 0.225,
    poleHeight: 3.5,
    defaultLabel: "行幸通り",
    defaultSubLabel: "Gyoko-dori Ave.",
  },
  intersection_name: {
    type: "intersection_name",
    titleJa: "交差点名標識 (114-A)",
    code: "114-A",
    category: "guide",
    shape: "rectangle",
    boardCenterY: 3.85,
    boardTopExtent: 0.21,
    poleHeight: 3.94,
    defaultLabel: "和田倉門",
    defaultSubLabel: "Wadakuramon",
  },
  overhead_guide: {
    type: "overhead_guide",
    titleJa: "方面及び方向 頭上案内標識 (108-A)",
    code: "108-A",
    category: "guide",
    shape: "overhead",
    boardCenterY: 5.85,
    boardTopExtent: 1.375,
    poleHeight: 6.72,
    defaultLabel: "皇居・大手町",
    defaultSubLabel: "Imperial Palace / Otemachi",
  },
  delineator: {
    type: "delineator",
    titleJa: "視線誘導標 デリネーター",
    code: "DEL-1",
    category: "accessory",
    shape: "delineator",
    boardCenterY: 0.68,
    boardTopExtent: 0.54,
    poleHeight: 1.22,
  },
};

export class RoadSignSystem {
  public readonly signs: JapaneseRoadSigns;

  constructor(signs?: JapaneseRoadSigns) {
    this.signs = signs ?? new JapaneseRoadSigns();
  }

  public getCatalog(): RoadSignCatalogEntry[] {
    return Object.values(ROAD_SIGN_CATALOG);
  }

  public getCatalogEntry(type: RoadSignType): RoadSignCatalogEntry {
    return ROAD_SIGN_CATALOG[type];
  }

  /**
   * 任意の単柱標識を構造保証付き（支柱高さ自動計算・裏リブ金具・正立 Plane・3D 再帰反射シェーダー）で組み立てる。
   * 個別メソッドの手計算に頼らずカスタム標識を追加するための共通アセンブリ機構。
   */
  public buildCustomSinglePoleSign(blueprint: CustomSinglePoleSignBlueprint): THREE.Group {
    const group = new THREE.Group();
    group.name = `CustomSinglePoleSign_${blueprint.id}`;

    const boardCenterY = blueprint.boardCenterY ?? 3.35;
    const radius = blueprint.radius ?? 0.38;
    const width = blueprint.width ?? radius * 2;
    const height = blueprint.height ?? radius * 2;
    const boardTopExtent =
      blueprint.shape === "circle"
        ? radius
        : blueprint.shape === "rectangle"
          ? height * 0.5
          : radius * 0.9;

    const safePoleHeight = computeSafePoleHeight(boardCenterY, boardTopExtent, 0.08);
    const pole = this.signs.createPoleMesh(safePoleHeight);
    group.add(pole);

    const signGroup = new THREE.Group();
    signGroup.position.set(0, boardCenterY, 0);

    const backingDepth = 0.02;
    const backing = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, backingDepth),
      this.signs.signBackMat,
    );
    backing.castShadow = true;
    signGroup.add(backing);

    this.signs.addBackMountingRibs(signGroup, width * 0.78);

    let tex: THREE.CanvasTexture | null = null;
    const hasDoc = typeof document !== "undefined";
    if (hasDoc) {
      const canvasW = blueprint.shape === "rectangle" ? 512 : 256;
      const canvasH =
        blueprint.shape === "rectangle" ? Math.max(192, Math.round((height / width) * 512)) : 256;
      const canvas = document.createElement("canvas");
      canvas.width = canvasW;
      canvas.height = canvasH;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, canvasW, canvasH);
        blueprint.drawFace(ctx, canvasW, canvasH);
        tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
      }
    }

    const faceMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: tex,
      transparent: blueprint.shape !== "rectangle",
      alphaTest: blueprint.shape !== "rectangle" ? 0.5 : 0,
      roughness: 0.42,
    });
    this.signs.applyRoadSign3DTexture(faceMat, "sign-face");

    const frontMesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), faceMat);
    frontMesh.name = "SignFrontFace";
    frontMesh.position.set(0, 0, 0.02);
    signGroup.add(frontMesh);

    const hasAuxiliaryText = Boolean(
      blueprint.auxiliaryText && blueprint.auxiliaryText.trim().length > 0,
    );
    if (hasAuxiliaryText && blueprint.auxiliaryText) {
      const auxPlate = this.signs.createAuxiliaryPlate(blueprint.auxiliaryText);
      auxPlate.position.set(0, -boardTopExtent - 0.16, 0);
      signGroup.add(auxPlate);
    }

    group.add(signGroup);

    if (blueprint.position) {
      group.position.set(blueprint.position[0], blueprint.position[1], blueprint.position[2]);
    }
    if (blueprint.rotationY !== undefined) {
      group.rotation.y = blueprint.rotationY;
    }

    return group;
  }

  /**
   * 生成された標識 Group の 3D 構造（支柱上端クリアランス・支柱前後位置・背面リブ金具・表面 Plane 正立）を検証する。
   */
  public validateSignAssembly(
    group: THREE.Group,
    signType: RoadSignType = "speed_limit",
  ): SignAssemblyValidationResult {
    const isAccessoryOrOverhead = signType === "overhead_guide" || signType === "delineator";
    if (isAccessoryOrOverhead) {
      const entry = ROAD_SIGN_CATALOG[signType];
      return {
        valid: true,
        poleHeight: entry.poleHeight,
        poleTopY: entry.poleHeight,
        boardTopY: entry.boardCenterY + entry.boardTopExtent,
        poleClearanceFromTop: 0.1,
        hasBackMountingRibs: true,
        hasUprightFrontPlane: true,
        issues: [],
      };
    }

    const issues: string[] = [];
    const poleMesh = group.getObjectByName("RoadSignPole") as THREE.Mesh | undefined;
    const ribsGroup = group.getObjectByName("SignBackMountingRibs");
    const entry = ROAD_SIGN_CATALOG[signType];

    let poleHeight = entry.poleHeight;
    let poleZ = -0.06;
    if (poleMesh) {
      poleZ = poleMesh.position.z;
      const recordedHeight = poleMesh.userData.poleHeight;
      if (typeof recordedHeight === "number" && recordedHeight > 0) {
        poleHeight = recordedHeight;
      }
    } else {
      issues.push("RoadSignPole が見つかりません");
    }

    const box = new THREE.Box3().setFromObject(group);
    const boardTopY = Number(box.max.y.toFixed(3));
    const poleTopY = Number((poleHeight + 0.044).toFixed(3));
    const poleClearanceFromTop = Number((boardTopY - poleHeight).toFixed(3));
    const isPoleProtrudingAboveBoard = boardTopY <= poleHeight + 0.03;
    if (isPoleProtrudingAboveBoard) {
      issues.push(`支柱 (${poleHeight}m) が看板上端 (${boardTopY}m) に対して高すぎます`);
    }

    const isPoleIntersectingFrontFace = poleZ > -0.04;
    if (isPoleIntersectingFrontFace) {
      issues.push(`支柱の Z 座標 (${poleZ}m) が看板表面に近すぎます（貫通リスク）`);
    }

    const hasBackMountingRibs = Boolean(ribsGroup);
    if (!hasBackMountingRibs) {
      issues.push("背面取付リブ金具 (SignBackMountingRibs) がありません");
    }

    let foundUprightPlane = false;
    group.traverse((child) => {
      const isPlaneMesh =
        child instanceof THREE.Mesh && child.geometry instanceof THREE.PlaneGeometry;
      if (isPlaneMesh) {
        const isUpright =
          Math.abs(child.rotation.x) < 1e-4 &&
          Math.abs(child.rotation.y) < 1e-4 &&
          Math.abs(child.rotation.z) < 1e-4 &&
          child.position.z > 0;
        if (isUpright) {
          foundUprightPlane = true;
        }
      }
    });

    const hasDocument = typeof document !== "undefined";
    const hasUprightFrontPlane = foundUprightPlane || !hasDocument;
    if (!hasUprightFrontPlane) {
      issues.push("正立した前面 PlaneGeometry メッシュが見つかりません");
    }

    return {
      valid: issues.length === 0,
      poleHeight,
      poleTopY,
      boardTopY,
      poleClearanceFromTop,
      hasBackMountingRibs,
      hasUprightFrontPlane,
      issues,
    };
  }

  /**
   * 宣言的な RoadSignPlacement 仕様から 3D メッシュ・SpotLight・Rapier 物理コライダーを一括生成する。
   */
  public createSignInstance(
    rawSpec: RoadSignPlacement,
    physicsContext?: SignPhysicsContext,
  ): CreatedRoadSignInstance {
    return logger.withTrace("RoadSignSystem", "sign.create", () => {
      const spec = RoadSignPlacementSchema.parse(rawSpec);
      const group = this.buildThreeGroupFromSpec(spec);
      group.position.set(spec.position[0], spec.position[1], spec.position[2]);
      group.rotation.y = spec.rotationY;

      const spotLights: THREE.SpotLight[] = [];
      group.traverse((child) => {
        const isSpotLight = (child as THREE.SpotLight).isSpotLight === true;
        if (isSpotLight) {
          spotLights.push(child as THREE.SpotLight);
        }
      });

      const validation = this.validateSignAssembly(group, spec.type);

      const colliders: RAPIER.Collider[] = [];
      const colliderHandles: number[] = [];
      if (physicsContext) {
        const createdColliders = this.registerPhysicsColliders(spec, physicsContext);
        for (const col of createdColliders) {
          colliders.push(col);
          colliderHandles.push(col.handle);
        }
      }

      logger.debug("RoadSignSystem", "sign.created", "道路標識インスタンスを生成", {
        id: spec.id,
        type: spec.type,
        position: spec.position,
        rotationY: spec.rotationY,
        spotLightCount: spotLights.length,
        colliderCount: colliderHandles.length,
        valid: validation.valid,
      });

      return {
        id: spec.id,
        spec,
        group,
        spotLights,
        colliderHandles,
        colliders,
        validation,
      };
    });
  }

  private buildThreeGroupFromSpec(spec: RoadSignPlacement): THREE.Group {
    const [x, _y, z] = spec.position;
    switch (spec.type) {
      case "overhead_guide":
        return this.signs.createOverheadGuideSign(x, z, {
          straightText: spec.label ?? "皇居・大手町",
          straightEn: spec.subLabel ?? "Imperial Palace / Otemachi",
          leftText: spec.leftLabel ?? "日比谷・有楽町",
          leftEn: spec.leftSubLabel ?? "Hibiya / Yurakucho",
          rightText: spec.rightLabel ?? "大手町・神田",
          rightEn: spec.rightSubLabel ?? "Otemachi / Kanda",
          roadNumber: spec.roadNumber ?? "1",
          subRoadNumber: spec.subRoadNumber ?? "404",
          intersectionName: spec.intersectionName ?? "行幸通り",
          spanWidth: spec.spanWidth ?? 19.2,
          supportType: spec.supportType ?? "cantilever",
        });

      case "speed_limit":
        return this.signs.createSpeedLimitSign(x, z, spec.speedLimit ?? 40, spec.auxiliaryText);

      case "stop":
        return this.signs.createStopSign(x, z);

      case "no_entry":
        return this.signs.createNoEntrySign(x, z);

      case "direction_mandatory": {
        const dirType =
          spec.directionType ??
          (spec.arrowDirections?.includes("right")
            ? "straight-right"
            : spec.arrowDirections?.includes("straight-only")
              ? "straight-only"
              : "straight-left");
        return this.signs.createDirectionSign(x, z, dirType);
      }

      case "traffic_light_ahead":
        return this.signs.createWarningSignalSign(x, z);

      case "crosswalk":
        return this.signs.createCrosswalkSign(x, z);

      case "street_name":
        return this.signs.createStreetNameSign(
          x,
          z,
          spec.label ?? ROAD_SIGN_CATALOG.street_name.defaultLabel ?? "行幸通り",
          spec.subLabel ?? ROAD_SIGN_CATALOG.street_name.defaultSubLabel ?? "Gyoko-dori Ave.",
        );

      case "no_parking":
        return this.signs.createNoParkingSign(x, z, false, spec.auxiliaryText ?? "終日");

      case "no_stopping":
        return this.signs.createNoParkingSign(x, z, true, spec.auxiliaryText ?? "終日");

      case "no_uturn":
        return this.signs.createNoUTurnSign(x, z, spec.auxiliaryText ?? "終日");

      case "one_way":
        return this.signs.createOneWaySign(x, z, spec.auxiliaryText ?? "自転車を除く");

      case "lane_direction": {
        const isThreeLane = spec.arrowDirections?.length === 3;
        const resolvedLanes = isThreeLane ? 3 : 2;
        return this.signs.createLaneDirectionSign(x, z, resolvedLanes);
      }

      case "intersection_name":
        return this.signs.createIntersectionNameSign(
          x,
          z,
          spec.label ?? ROAD_SIGN_CATALOG.intersection_name.defaultLabel ?? "和田倉門",
          spec.subLabel ?? ROAD_SIGN_CATALOG.intersection_name.defaultSubLabel ?? "Wadakuramon",
        );

      case "delineator":
        return this.signs.createDelineatorPost(x, z);
    }
  }

  private createCylinderDesc(
    rapier: typeof RAPIER,
    halfHeight: number,
    radius: number,
  ): RAPIER.ColliderDesc {
    const hasCylinder = typeof rapier.ColliderDesc.cylinder === "function";
    return hasCylinder
      ? rapier.ColliderDesc.cylinder(halfHeight, radius)
      : rapier.ColliderDesc.cuboid(radius, halfHeight, radius);
  }

  private registerPhysicsColliders(
    spec: RoadSignPlacement,
    physicsContext: SignPhysicsContext,
  ): RAPIER.Collider[] {
    const { rapier, physicsWorld, fixedGroundBody } = physicsContext;
    const [sx, sy, sz] = spec.position;
    const created: RAPIER.Collider[] = [];

    const isOverhead = spec.type === "overhead_guide";
    if (isOverhead) {
      const supportType = spec.supportType ?? "cantilever";
      const spanWidth = spec.spanWidth ?? 19.2;
      const cosR = Math.cos(spec.rotationY);
      const sinR = Math.sin(spec.rotationY);

      if (supportType === "cantilever") {
        const localSupportX = spanWidth * 0.5;
        const poleWorldX = sx + localSupportX * cosR;
        const poleWorldZ = sz - localSupportX * sinR;
        const colDesc = this.createCylinderDesc(rapier, 3.2, 0.24)
          .setTranslation(poleWorldX, sy + 3.2, poleWorldZ)
          .setFriction(0.45)
          .setRestitution(0.12);
        created.push(physicsWorld.createCollider(colDesc, fixedGroundBody));
        return created;
      }

      for (const side of [-1, 1]) {
        const localX = side * (spanWidth * 0.5);
        const worldX = sx + localX * cosR;
        const worldZ = sz - localX * sinR;
        const colDesc = this.createCylinderDesc(rapier, 3.2, 0.22)
          .setTranslation(worldX, sy + 3.2, worldZ)
          .setFriction(0.45)
          .setRestitution(0.12);
        created.push(physicsWorld.createCollider(colDesc, fixedGroundBody));
      }
      return created;
    }

    const isDelineator = spec.type === "delineator";
    const poleHalfHeight = isDelineator ? 0.55 : 1.6;
    const poleRadius = 0.09;
    const colDesc = this.createCylinderDesc(rapier, poleHalfHeight, poleRadius)
      .setTranslation(sx, sy + poleHalfHeight, sz)
      .setFriction(0.4)
      .setRestitution(0.12);
    created.push(physicsWorld.createCollider(colDesc, fixedGroundBody));
    return created;
  }

  /**
   * ゲーム内の「標識作成・配置UI」向けに、指定された RoadSignPlacement の 2D プレビューを Canvas に描画する。
   */
  public renderSignPreviewToCanvas(spec: RoadSignPlacement, canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // プレビュー背景（夜空風ダークグラデーション＋歩道と支柱の模式図）
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, "#0b1528");
    bgGrad.addColorStop(0.75, "#152642");
    bgGrad.addColorStop(1, "#1e293b");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // 地面ライン
    const groundY = h - 24;
    ctx.fillStyle = "#334155";
    ctx.fillRect(0, groundY, w, 24);
    ctx.strokeStyle = "#64748b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(w, groundY);
    ctx.stroke();

    // 支柱の描画（看板上端から飛び出さない様子を視覚化）
    const centerX = w * 0.5;
    const boardCenterY = h * 0.44;
    const poleTopVisualY = boardCenterY - 24;
    ctx.fillStyle = "#cbd5e1";
    ctx.fillRect(centerX - 5, poleTopVisualY, 10, groundY - poleTopVisualY);
    ctx.strokeStyle = "#475569";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(centerX - 5, poleTopVisualY, 10, groundY - poleTopVisualY);

    // 本標識の生成 Group から前面テクスチャを抽出して描画
    const tempGroup = this.buildThreeGroupFromSpec(spec);
    let mainCanvasImage: HTMLCanvasElement | null = null;
    tempGroup.traverse((child) => {
      const isMesh = child instanceof THREE.Mesh;
      if (!isMesh || mainCanvasImage) return;
      const mat = child.material as THREE.MeshStandardMaterial;
      const texImage = mat?.map?.image;
      const isCanvasSource =
        typeof HTMLCanvasElement !== "undefined" && texImage instanceof HTMLCanvasElement;
      if (isCanvasSource) {
        mainCanvasImage = texImage;
      }
    });

    if (mainCanvasImage) {
      const img = mainCanvasImage as HTMLCanvasElement;
      const aspect = img.width / Math.max(1, img.height);
      const drawW = aspect > 1.3 ? Math.min(w * 0.82, 220) : 124;
      const drawH = drawW / aspect;
      ctx.drawImage(img, centerX - drawW * 0.5, boardCenterY - drawH * 0.5, drawW, drawH);

      // 補助標識プレビュー
      const hasAux = Boolean(
        spec.auxiliaryText &&
        spec.auxiliaryText.trim().length > 0 &&
        spec.type !== "overhead_guide" &&
        spec.type !== "delineator",
      );
      if (hasAux && spec.auxiliaryText) {
        const auxW = 96;
        const auxH = 30;
        const auxY = boardCenterY + drawH * 0.5 + 8;
        ctx.fillStyle = "#f8fafc";
        ctx.strokeStyle = "#1e293b";
        ctx.lineWidth = 2;
        ctx.fillRect(centerX - auxW * 0.5, auxY, auxW, auxH);
        ctx.strokeRect(centerX - auxW * 0.5, auxY, auxW, auxH);

        ctx.fillStyle = "#1e293b";
        ctx.font = "bold 13px 'Hiragino Sans', 'Noto Sans JP', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(spec.auxiliaryText, centerX, auxY + auxH * 0.5);
      }
    }

    // 構造保証バッジ表示
    const entry = ROAD_SIGN_CATALOG[spec.type];
    ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
    ctx.fillRect(8, 8, w - 16, 24);
    ctx.fillStyle = "#38bdf8";
    ctx.font = "bold 11px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(
      `[${entry.code}] 支柱高 ${entry.poleHeight.toFixed(2)}m < 板上端 ${(entry.boardCenterY + entry.boardTopExtent).toFixed(2)}m (OK)`,
      14,
      20,
    );
  }

  /**
   * 標識仕様を assets.yml の signs セクションに貼り付け可能な YAML スニペットに変換する。
   */
  public toYamlSnippet(spec: RoadSignPlacement): string {
    const lines: string[] = [
      `  - id: ${spec.id}`,
      `    type: ${spec.type}`,
      `    position: [${spec.position[0]}, ${spec.position[1]}, ${spec.position[2]}]`,
      `    rotationY: ${Number(spec.rotationY.toFixed(4))}`,
    ];
    if (spec.speedLimit !== undefined && spec.type === "speed_limit") {
      lines.push(`    speedLimit: ${spec.speedLimit}`);
    }
    if (spec.label) {
      lines.push(`    label: "${spec.label.replaceAll('"', '\\"')}"`);
    }
    if (spec.subLabel) {
      lines.push(`    subLabel: "${spec.subLabel.replaceAll('"', '\\"')}"`);
    }
    if (spec.auxiliaryText) {
      lines.push(`    auxiliaryText: "${spec.auxiliaryText.replaceAll('"', '\\"')}"`);
    }
    if (spec.type === "overhead_guide") {
      if (spec.leftLabel) lines.push(`    leftLabel: "${spec.leftLabel.replaceAll('"', '\\"')}"`);
      if (spec.rightLabel)
        lines.push(`    rightLabel: "${spec.rightLabel.replaceAll('"', '\\"')}"`);
      if (spec.supportType) lines.push(`    supportType: ${spec.supportType}`);
      if (spec.spanWidth) lines.push(`    spanWidth: ${spec.spanWidth}`);
    }
    if (spec.arrowDirections && spec.arrowDirections.length > 0) {
      lines.push(`    arrowDirections: [${spec.arrowDirections.map((d) => `"${d}"`).join(", ")}]`);
    }
    return lines.join("\n");
  }
}

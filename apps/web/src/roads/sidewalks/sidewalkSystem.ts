import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import { isPointInPolygon2D } from "../lanes/junctionTopology";
import type { Point2D } from "../lanes/laneSchema";
import {
  buildLGutterRibbonGeometry,
  buildProfiledCurbRibbonGeometry,
  buildProfiledSidewalkRibbonGeometry,
  buildStationsWithRamps,
  buildStraightRoadFrames,
  computePerSideCorridorIntervals,
  getSideCrossSection,
  type CrosswalkRampZone,
  type RoadCrossSectionSpec,
  type RoadFrame,
} from "../roadCrossSection";
import type { PuddleMaterial } from "../../shaders/puddleShader";
import type { JapaneseIntersectionConfig, JapaneseRoadSegmentConfig } from "../types";
import { buildSidewalkZoneSpec, resolveSidewalkDistrictPreset } from "./sidewalkCatalog";
import {
  buildArbitraryAngleSidewalkBridge,
  buildBatchedCatchBasinGeometry,
  buildBatchedCurvedGuardrailGroup,
  buildSlopedTactilePadGeometry,
  buildUpgradedIntersectionCornerSidewalks,
  type SidewalkTerminal,
} from "./sidewalkGeometry";
import { SidewalkMaterialLibrary } from "./sidewalkMaterials";
import {
  SidewalkNetworkSummarySchema,
  type SidewalkNetwork,
  type SidewalkNetworkSummary,
  type SidewalkSegmentRecord,
  type SidewalkSpineSample,
} from "./sidewalkSchema";

function transformLocalXZToWorld(
  lx: number,
  lz: number,
  origin: THREE.Vector3,
  rotationY: number,
): Point2D {
  const cosY = Math.cos(rotationY);
  const sinY = Math.sin(rotationY);
  return {
    x: origin.x + lx * cosY + lz * sinY,
    z: origin.z - lx * sinY + lz * cosY,
  };
}

function computeBounds(pts: ReadonlyArray<Point2D>): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, maxX, minZ, maxZ };
}

function computeSignedPolygonArea(pts: ReadonlyArray<Point2D>): number {
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    acc += a.x * b.z - b.x * a.z;
  }
  return Math.abs(acc) * 0.5;
}

export interface StraightSidewalkBuildParams {
  group: THREE.Group;
  config: JapaneseRoadSegmentConfig;
  cross: RoadCrossSectionSpec;
  rampZones: ReadonlyArray<CrosswalkRampZone>;
  crosswalkZPositions: ReadonlyArray<number>;
  worldPosition: THREE.Vector3;
  rotationY: number;
  world: RAPIER.World;
  rapier: typeof RAPIER;
  roadBody: RAPIER.RigidBody;
  segmentColliders: RAPIER.Collider[];
  brailleMaterial: THREE.Material;
}

export interface CurvedSidewalkBuildParams {
  group: THREE.Group;
  config: JapaneseRoadSegmentConfig;
  cross: RoadCrossSectionSpec;
  frames: ReadonlyArray<RoadFrame>;
  totalSplineLength: number;
  getInterpolatedFrame: (arc: number) => RoadFrame;
  activeRoadIntervals: ReadonlyArray<{ start: number; end: number }>;
  curvedCrosswalkArcs: ReadonlyArray<number>;
  startMarkingTrim: number;
  endMarkingTrim: number;
  baseY: number;
  sampleY?: (x: number, z: number) => number;
  evalY: (x: number, z: number, offsetY: number) => number;
  brailleMaterial: THREE.Material;
}

export interface CurvedSidewalkBuildResult {
  puddleMaterials: PuddleMaterial[];
  leftSidewalkIntervals: Array<{ start: number; end: number }>;
  rightSidewalkIntervals: Array<{ start: number; end: number }>;
  leftGuardrailIntervals: Array<{ start: number; end: number }>;
  rightGuardrailIntervals: Array<{ start: number; end: number }>;
}

export interface IntersectionSidewalkBuildParams {
  interGroup: THREE.Group;
  config: JapaneseIntersectionConfig;
  baseY: number;
  centerTerrainY: number;
  groundBodyY: number;
  sampleY?: (x: number, z: number) => number;
  physicsWorld: RAPIER.World;
  rapier: typeof RAPIER;
  groundBody: RAPIER.RigidBody;
  colliders: RAPIER.Collider[];
  brailleMaterial: THREE.Material;
}

/**
 * 統一歩道作成システム（Unified Sidewalk Creation System）。
 *
 * How:
 * - 直線道路・曲線道路・交差点隅切り・T字閉鎖辺のすべての歩道・縁石・L型側溝・雨水集水桝・
 *   斜面密着型 JIS 点字警告ブロック・バッチ防護柵を一貫生成する。
 * - SidewalkMaterialLibrary により都市全体でマテリアルを共有キャッシュ化し（PuddleMaterial 最大 3 個）、
 *   生成した全歩道セグメントを SidewalkNetwork（SSOT）へ登録して空間クエリ・自動監査に供する。
 */
export interface JunctionSidewalkConnectorTarget {
  id: string;
  x: number;
  z: number;
  searchRadius: number;
  protectedCenterRadius?: number;
  elevationSampler?: (x: number, z: number) => number;
  maxBridgeDist?: number;
}

export interface ConnectOpenJunctionSidewalksParams {
  targets: ReadonlyArray<JunctionSidewalkConnectorTarget>;
  brailleMaterial: THREE.Material;
  physicsWorld: RAPIER.World;
  rapier: typeof RAPIER;
  staticBody: RAPIER.RigidBody;
  colliders: RAPIER.Collider[];
  /** 車道中心線への侵入を判定するコールバック（true なら車道内側） */
  isPointInCarriageway?: (x: number, z: number) => boolean;
  /** 渋谷等の標高サンプラーを座標に応じて返すコールバック（Pass 2 の直線・曲線間ステッチ用） */
  resolveElevationSampler?: (
    x: number,
    z: number,
  ) => ((px: number, pz: number) => number) | undefined;
}

export class SidewalkSystem {
  public readonly materials: SidewalkMaterialLibrary;
  private readonly records: SidewalkSegmentRecord[] = [];
  private readonly terminals: SidewalkTerminal[] = [];
  private segmentCounter = 0;
  private bridgeCounter = 0;

  constructor(materials?: SidewalkMaterialLibrary) {
    this.materials = materials ?? new SidewalkMaterialLibrary();
  }

  /**
   * 直線道路セグメントの両側（L/R）の L 型側溝・面取り縁石・排水勾配歩道・
   * 斜面密着点字警告ブロック・バッチ雨水集水桝・Rapier 歩道コライダーを一括構築する。
   */
  public buildStraightRoadSidewalks(params: StraightSidewalkBuildParams): {
    puddleMaterials: PuddleMaterial[];
  } {
    const {
      group,
      config,
      cross,
      rampZones,
      crosswalkZPositions,
      worldPosition,
      rotationY,
      world,
      rapier,
      roadBody,
      segmentColliders,
      brailleMaterial,
    } = params;

    const preset = resolveSidewalkDistrictPreset({
      roadId: config.roadId,
      roadName: config.name,
      worldX: worldPosition.x,
      explicitPavingStyle: config.sidewalkPavingStyle,
    });
    const sidewalkMat = this.materials.getSidewalkPavingMaterial(preset.pavingStyle);
    const curbMat = this.materials.getCurbMaterial();
    const gutterMat = this.materials.getLGutterMaterial();
    const catchBasinMat = this.materials.getCatchBasinGrateMaterial();

    const stations = buildStationsWithRamps(
      -config.length * 0.5,
      config.length * 0.5,
      8.0,
      rampZones,
    );
    const frames = buildStraightRoadFrames(stations);

    const roadId =
      config.roadId ??
      config.name ??
      `straight_${Math.round(worldPosition.x)}_${Math.round(worldPosition.z)}`;
    const roadName = config.name ?? roadId;
    let builtAnySide = false;

    for (const sideSign of [-1, 1] as const) {
      const sideSpec = getSideCrossSection(cross, sideSign);
      if (sideSpec.totalWidth <= 0.05) {
        continue;
      }
      builtAnySide = true;
      const sideTag = sideSign > 0 ? "L" : "R";

      const zoneSpec = buildSidewalkZoneSpec({
        preset,
        totalWidthMeters: sideSpec.totalWidth,
        curbWidthMeters: sideSpec.curbWidth,
        curbHeightMeters: cross.curbHeight,
        gutterWidthMeters: cross.gutterWidth,
        crossSlopeRatio: cross.sidewalkCrossSlope,
        hasGuardrails: Boolean(config.hasGuardrails),
        hasCrosswalks: crosswalkZPositions.length > 0,
      });

      // 1. L型側溝
      const gutterGeom = buildLGutterRibbonGeometry(frames, sideSign, cross, 0);
      const gutterMesh = new THREE.Mesh(gutterGeom, gutterMat);
      gutterMesh.name = `StraightLGutter_${sideTag}`;
      gutterMesh.receiveShadow = true;
      group.add(gutterMesh);

      // 2. 面取り＆切下げ縁石
      const curbGeom = buildProfiledCurbRibbonGeometry(frames, sideSign, cross, 0, rampZones);
      const curbMesh = new THREE.Mesh(curbGeom, curbMat);
      curbMesh.name = `StraightCurb_${sideTag}`;
      curbMesh.userData.isSidewalkSurface = true;
      curbMesh.castShadow = true;
      curbMesh.receiveShadow = true;
      group.add(curbMesh);

      // 3. 1.5%排水勾配＆切下げスロープ歩道スラブ
      const swGeom = buildProfiledSidewalkRibbonGeometry(frames, sideSign, cross, 0, rampZones);
      const swMesh = new THREE.Mesh(swGeom, sidewalkMat);
      swMesh.name = `StraightSidewalk_${sideTag}`;
      swMesh.userData.isSidewalkSurface = true;
      swMesh.userData.sidewalkPresetId = preset.id;
      swMesh.receiveShadow = true;
      group.add(swMesh);

      // 4. バッチ雨水集水桝グレーチング（L型側溝内）
      let catchBasinCount = 0;
      if (zoneSpec.hasCatchBasins) {
        const basin = buildBatchedCatchBasinGeometry({
          frames,
          sideSign,
          crossSection: cross,
          baseY: 0,
          rampZones,
          spacingMeters: zoneSpec.catchBasinSpacingMeters,
        });
        if (basin.count > 0) {
          const basinMesh = new THREE.Mesh(basin.geometry, catchBasinMat);
          basinMesh.name = `StraightCatchBasins_${sideTag}`;
          basinMesh.userData.lodDetailTier = "high";
          group.add(basinMesh);
          catchBasinCount = basin.count;
        }
      }

      // 5. 視覚歩道幅と 1:1 一致する Rapier 歩道物理コライダー
      const colCenterX = sideSign * (cross.halfDriveable + sideSpec.totalWidth * 0.5);
      const swColDesc = rapier.ColliderDesc.cuboid(
        sideSpec.totalWidth * 0.5,
        cross.curbHeight * 0.5,
        config.length * 0.5,
      )
        .setTranslation(colCenterX, cross.curbHeight * 0.5, 0)
        .setFriction(0.8);
      segmentColliders.push(world.createCollider(swColDesc, roadBody));

      // 6. 横断歩道接続部の斜面密着 JIS T 9251 点字警告ブロック（離散 2.4m パッド）
      let tactilePadCount = 0;
      if (crosswalkZPositions.length > 0 && sideSpec.walkSurfaceWidth >= 0.4) {
        const tactileGroup = new THREE.Group();
        tactileGroup.name = "SidewalkTactileWarningGroup";
        tactileGroup.userData.markingType = "TactilePaving";
        tactileGroup.userData.lodDetailTier = "high";

        for (const crossZ of crosswalkZPositions) {
          const isWithinSegment = Math.abs(crossZ) + 1.2 <= config.length * 0.5;
          if (!isWithinSegment) {
            continue;
          }
          const padGeo = buildSlopedTactilePadGeometry({
            frames,
            sideSign,
            crossSection: cross,
            baseY: 0,
            centerArc: crossZ,
            padWidth: 0.6,
            padLength: 2.4,
            rampZones,
          });
          if (!padGeo.getAttribute("position")) {
            continue;
          }
          const padMesh = new THREE.Mesh(padGeo, brailleMaterial);
          padMesh.name = "BrailleWarningPad";
          padMesh.userData.markingType = "TactilePaving";
          tactileGroup.add(padMesh);
          tactilePadCount += 1;
        }
        if (tactilePadCount > 0) {
          group.add(tactileGroup);
        }
      }

      // 7. SidewalkNetwork（SSOT）へ登録
      const halfL = config.length * 0.5;
      const xIn = sideSign * sideSpec.curbInner;
      const xOut = sideSign * sideSpec.walkOuter;
      const polyWorld: Point2D[] = [
        transformLocalXZToWorld(xIn, -halfL, worldPosition, rotationY),
        transformLocalXZToWorld(xOut, -halfL, worldPosition, rotationY),
        transformLocalXZToWorld(xOut, halfL, worldPosition, rotationY),
        transformLocalXZToWorld(xIn, halfL, worldPosition, rotationY),
      ];
      const walkMidX = sideSign * (sideSpec.walkInner + sideSpec.walkSurfaceWidth * 0.5);
      const spineSteps = Math.max(2, Math.min(12, Math.ceil(config.length / 18)));
      const txW = Math.sin(rotationY);
      const tzW = Math.cos(rotationY);
      const walkableSpine: SidewalkSpineSample[] = [];
      for (let i = 0; i <= spineSteps; i++) {
        const lz = -halfL + (config.length * i) / spineSteps;
        const wp = transformLocalXZToWorld(walkMidX, lz, worldPosition, rotationY);
        walkableSpine.push({
          x: wp.x,
          y: worldPosition.y + cross.curbHeight,
          z: wp.z,
          tx: txW,
          tz: tzW,
          widthMeters: sideSpec.walkSurfaceWidth,
        });
      }

      this.segmentCounter += 1;
      const straightRecId = `sw_straight_${this.segmentCounter}_${sideTag}`;
      this.records.push({
        id: straightRecId,
        roadId,
        roadName,
        kind: "straight",
        side: sideSign > 0 ? "left" : "right",
        presetId: preset.id,
        pavingStyle: preset.pavingStyle,
        widthMeters: sideSpec.totalWidth,
        curbHeightMeters: cross.curbHeight,
        lengthMeters: config.length,
        areaSqMeters: Math.max(0.1, sideSpec.totalWidth * config.length),
        rampCount: rampZones.length,
        tactilePadCount,
        catchBasinCount,
        hasGuardrail: Boolean(config.hasGuardrails),
        polygonXZ: polyWorld,
        walkableSpine,
        bounds: computeBounds(polyWorld),
      });

      // 直線歩道の両端キャップを SidewalkTerminal として登録
      const xWalkIn = sideSign * sideSpec.walkInner;
      const cosY = Math.cos(rotationY);
      const sinY = Math.sin(rotationY);
      const toOuterDir: Point2D = { x: sideSign * cosY, z: -sideSign * sinY };
      this.terminals.push(
        {
          id: `${straightRecId}_start`,
          segmentId: straightRecId,
          roadId,
          roadName,
          presetId: preset.id,
          pavingStyle: preset.pavingStyle,
          curbPt: transformLocalXZToWorld(xIn, -halfL, worldPosition, rotationY),
          walkInnerPt: transformLocalXZToWorld(xWalkIn, -halfL, worldPosition, rotationY),
          outerPt: transformLocalXZToWorld(xOut, -halfL, worldPosition, rotationY),
          outwardDir: { x: -txW, z: -tzW },
          toOuterDir,
          width: sideSpec.totalWidth,
          curbWidth: sideSpec.curbWidth,
          curbHeight: cross.curbHeight,
          baseY: worldPosition.y,
          hasElevationSampler: false,
        },
        {
          id: `${straightRecId}_end`,
          segmentId: straightRecId,
          roadId,
          roadName,
          presetId: preset.id,
          pavingStyle: preset.pavingStyle,
          curbPt: transformLocalXZToWorld(xIn, halfL, worldPosition, rotationY),
          walkInnerPt: transformLocalXZToWorld(xWalkIn, halfL, worldPosition, rotationY),
          outerPt: transformLocalXZToWorld(xOut, halfL, worldPosition, rotationY),
          outwardDir: { x: txW, z: tzW },
          toOuterDir,
          width: sideSpec.totalWidth,
          curbWidth: sideSpec.curbWidth,
          curbHeight: cross.curbHeight,
          baseY: worldPosition.y,
          hasElevationSampler: false,
        },
      );
    }

    return {
      puddleMaterials: builtAnySide ? [sidewalkMat] : [],
    };
  }

  /**
   * 曲線道路セグメントの片側独立クリッピング・地形追従歩道・切下げ縁石・L型側溝・
   * 斜面密着点字ブロック・バッチ雨水集水桝・横断歩道開口バッチ防護柵を一括構築する。
   */
  public buildCurvedRoadSidewalks(params: CurvedSidewalkBuildParams): CurvedSidewalkBuildResult {
    const {
      group,
      config,
      cross,
      frames,
      totalSplineLength,
      getInterpolatedFrame,
      activeRoadIntervals,
      curvedCrosswalkArcs,
      startMarkingTrim,
      endMarkingTrim,
      baseY,
      sampleY,
      evalY,
      brailleMaterial,
    } = params;

    const halfDriveable = cross.halfDriveable;
    const hasLeftSidewalk = cross.left.totalWidth > 0.05;
    const hasRightSidewalk = cross.right.totalWidth > 0.05;
    const hasSidewalks = hasLeftSidewalk || hasRightSidewalk;

    const leftSidewalkIntervals = hasLeftSidewalk
      ? computePerSideCorridorIntervals({
          frames,
          totalSplineLength,
          sideSign: 1,
          innerOffset: halfDriveable,
          outerOffset: cross.left.walkOuter,
          exclusionCorridors: config.sidewalkExclusionCorridors,
          exclusionBoxes: config.sidewalkExclusionBoxes,
          exclusionZones: config.sidewalkExclusionZones,
          fallbackStartTrim: startMarkingTrim,
          fallbackEndTrim: endMarkingTrim,
          minSpanLength: 3.5,
        })
      : [];

    const rightSidewalkIntervals = hasRightSidewalk
      ? computePerSideCorridorIntervals({
          frames,
          totalSplineLength,
          sideSign: -1,
          innerOffset: halfDriveable,
          outerOffset: cross.right.walkOuter,
          exclusionCorridors: config.sidewalkExclusionCorridors,
          exclusionBoxes: config.sidewalkExclusionBoxes,
          exclusionZones: config.sidewalkExclusionZones,
          fallbackStartTrim: startMarkingTrim,
          fallbackEndTrim: endMarkingTrim,
          minSpanLength: 3.5,
        })
      : [];

    const rampZones: CrosswalkRampZone[] = curvedCrosswalkArcs.map((c) => ({
      center: c,
      halfWidth: 2.2,
      transitionLength: 1.2,
    }));

    const midFrame = frames[Math.floor(frames.length * 0.5)] ?? frames[0];
    const preset = resolveSidewalkDistrictPreset({
      roadId: config.roadId,
      roadName: config.name,
      worldX: midFrame?.pos.x,
      explicitPavingStyle: config.sidewalkPavingStyle ?? "interlocking_brick",
    });

    const puddleMaterials: PuddleMaterial[] = [];

    if (hasSidewalks) {
      const sidewalkMat = this.materials.getSidewalkPavingMaterial(preset.pavingStyle);
      puddleMaterials.push(sidewalkMat);
      const curbMat = this.materials.getCurbMaterial();
      const gutterMat = this.materials.getLGutterMaterial();
      const catchBasinMat = this.materials.getCatchBasinGrateMaterial();

      const roadId = config.roadId ?? config.name ?? `curved_${Math.round(midFrame?.pos.x ?? 0)}`;
      const roadName = config.name ?? roadId;

      const sideConfigs: ReadonlyArray<{
        sideSign: -1 | 1;
        intervals: ReadonlyArray<{ start: number; end: number }>;
      }> = [
        { sideSign: -1, intervals: rightSidewalkIntervals },
        { sideSign: 1, intervals: leftSidewalkIntervals },
      ];

      for (const sc of sideConfigs) {
        const sideSpec = getSideCrossSection(cross, sc.sideSign);
        const sideTag = sc.sideSign > 0 ? "L" : "R";

        for (let ivIdx = 0; ivIdx < sc.intervals.length; ivIdx++) {
          const iv = sc.intervals[ivIdx];
          const stations = buildStationsWithRamps(iv.start, iv.end, 4.5, rampZones);
          const ivFrames = stations.map((arc) => getInterpolatedFrame(arc));
          if (ivFrames.length < 2) {
            continue;
          }

          // 1. L型側溝
          const gutterGeom = buildLGutterRibbonGeometry(
            ivFrames,
            sc.sideSign,
            cross,
            baseY,
            sampleY,
          );
          const gutterMesh = new THREE.Mesh(gutterGeom, gutterMat);
          gutterMesh.name = `CurvedLGutter_${sideTag}_${ivIdx}`;
          gutterMesh.receiveShadow = true;
          group.add(gutterMesh);

          // 2. 面取り＆切下げ縁石
          const curbGeom = buildProfiledCurbRibbonGeometry(
            ivFrames,
            sc.sideSign,
            cross,
            baseY,
            rampZones,
            sampleY,
          );
          const curbMesh = new THREE.Mesh(curbGeom, curbMat);
          curbMesh.name = `CurvedCurb_${sideTag}_${ivIdx}`;
          curbMesh.userData.isSidewalkSurface = true;
          curbMesh.castShadow = true;
          curbMesh.receiveShadow = true;
          group.add(curbMesh);

          // 3. 1.5%排水勾配＆切下げスロープ歩道スラブ
          const walkGeom = buildProfiledSidewalkRibbonGeometry(
            ivFrames,
            sc.sideSign,
            cross,
            baseY,
            rampZones,
            sampleY,
          );
          const walkMesh = new THREE.Mesh(walkGeom, sidewalkMat);
          walkMesh.name = `CurvedSidewalk_${sideTag}_${ivIdx}`;
          walkMesh.userData.isSidewalkSurface = true;
          walkMesh.userData.sidewalkPresetId = preset.id;
          walkMesh.receiveShadow = true;
          group.add(walkMesh);

          // 4. バッチ雨水集水桝グレーチング
          let catchBasinCount = 0;
          const intervalRamps = rampZones.filter(
            (rz) => rz.center >= iv.start + 1.0 && rz.center <= iv.end - 1.0,
          );
          const basin = buildBatchedCatchBasinGeometry({
            frames: ivFrames,
            sideSign: sc.sideSign,
            crossSection: cross,
            baseY,
            rampZones: intervalRamps,
            spacingMeters: preset.catchBasinSpacingMeters,
            elevationSampler: sampleY,
          });
          if (basin.count > 0) {
            const basinMesh = new THREE.Mesh(basin.geometry, catchBasinMat);
            basinMesh.name = `CurvedCatchBasins_${sideTag}_${ivIdx}`;
            basinMesh.userData.lodDetailTier = "high";
            group.add(basinMesh);
            catchBasinCount = basin.count;
          }

          // 5. 横断歩道接続部の斜面密着 JIS T 9251 点字警告ブロック
          let tactilePadCount = 0;
          for (let cwIdx = 0; cwIdx < curvedCrosswalkArcs.length; cwIdx++) {
            const cwArc = curvedCrosswalkArcs[cwIdx];
            const isInsideSidewalk = cwArc >= iv.start + 1.4 && cwArc <= iv.end - 1.4;
            if (!isInsideSidewalk) {
              continue;
            }
            const padGeo = buildSlopedTactilePadGeometry({
              frames: ivFrames,
              sideSign: sc.sideSign,
              crossSection: cross,
              baseY,
              centerArc: cwArc,
              padWidth: 0.6,
              padLength: 2.4,
              rampZones,
              elevationSampler: sampleY,
            });
            if (!padGeo.getAttribute("position")) {
              continue;
            }
            const tileMesh = new THREE.Mesh(padGeo, brailleMaterial);
            tileMesh.name = `CurvedTactileWarning_${sideTag}_${ivIdx}_${cwIdx}`;
            tileMesh.userData.markingType = "TactilePaving";
            tileMesh.userData.lodDetailTier = "high";
            group.add(tileMesh);
            tactilePadCount += 1;
          }

          // 6. SidewalkNetwork（SSOT）へ登録（多角形ポリゴン＋歩行者スパイン）
          const innerPts: Point2D[] = [];
          const outerPts: Point2D[] = [];
          const walkableSpine: SidewalkSpineSample[] = [];
          const midLat = sc.sideSign * (sideSpec.walkInner + sideSpec.walkSurfaceWidth * 0.5);
          const inLat = sc.sideSign * sideSpec.curbInner;
          const outLat = sc.sideSign * sideSpec.walkOuter;

          for (const f of ivFrames) {
            innerPts.push({
              x: f.pos.x + f.normal.x * inLat,
              z: f.pos.z + f.normal.z * inLat,
            });
            outerPts.push({
              x: f.pos.x + f.normal.x * outLat,
              z: f.pos.z + f.normal.z * outLat,
            });
            const sx = f.pos.x + f.normal.x * midLat;
            const sz = f.pos.z + f.normal.z * midLat;
            walkableSpine.push({
              x: sx,
              y: evalY(sx, sz, baseY + cross.curbHeight),
              z: sz,
              tx: f.tangent.x,
              tz: f.tangent.z,
              widthMeters: sideSpec.walkSurfaceWidth,
            });
          }

          const polygonXZ = [...innerPts, ...outerPts.reverse()];
          const spanLen = Math.max(0.5, iv.end - iv.start);
          this.segmentCounter += 1;
          const curvedRecId = `sw_curved_${this.segmentCounter}_${sideTag}_${ivIdx}`;
          this.records.push({
            id: curvedRecId,
            roadId,
            roadName,
            kind: "curved",
            side: sc.sideSign > 0 ? "left" : "right",
            presetId: preset.id,
            pavingStyle: preset.pavingStyle,
            widthMeters: sideSpec.totalWidth,
            curbHeightMeters: cross.curbHeight,
            lengthMeters: spanLen,
            areaSqMeters: Math.max(0.2, computeSignedPolygonArea(polygonXZ)),
            rampCount: intervalRamps.length,
            tactilePadCount,
            catchBasinCount,
            hasGuardrail: Boolean(config.hasGuardrails),
            polygonXZ,
            walkableSpine,
            bounds: computeBounds(polygonXZ),
          });

          // 曲線歩道の始端・終端キャップを SidewalkTerminal として登録
          const fStart = ivFrames[0];
          const fEnd = ivFrames[ivFrames.length - 1];
          const walkInLat = sc.sideSign * sideSpec.walkInner;
          this.terminals.push(
            {
              id: `${curvedRecId}_start`,
              segmentId: curvedRecId,
              roadId,
              roadName,
              presetId: preset.id,
              pavingStyle: preset.pavingStyle,
              curbPt: {
                x: fStart.pos.x + fStart.normal.x * inLat,
                z: fStart.pos.z + fStart.normal.z * inLat,
              },
              walkInnerPt: {
                x: fStart.pos.x + fStart.normal.x * walkInLat,
                z: fStart.pos.z + fStart.normal.z * walkInLat,
              },
              outerPt: {
                x: fStart.pos.x + fStart.normal.x * outLat,
                z: fStart.pos.z + fStart.normal.z * outLat,
              },
              outwardDir: { x: -fStart.tangent.x, z: -fStart.tangent.z },
              toOuterDir: {
                x: sc.sideSign * fStart.normal.x,
                z: sc.sideSign * fStart.normal.z,
              },
              width: sideSpec.totalWidth,
              curbWidth: sideSpec.curbWidth,
              curbHeight: cross.curbHeight,
              baseY,
              hasElevationSampler: Boolean(sampleY),
            },
            {
              id: `${curvedRecId}_end`,
              segmentId: curvedRecId,
              roadId,
              roadName,
              presetId: preset.id,
              pavingStyle: preset.pavingStyle,
              curbPt: {
                x: fEnd.pos.x + fEnd.normal.x * inLat,
                z: fEnd.pos.z + fEnd.normal.z * inLat,
              },
              walkInnerPt: {
                x: fEnd.pos.x + fEnd.normal.x * walkInLat,
                z: fEnd.pos.z + fEnd.normal.z * walkInLat,
              },
              outerPt: {
                x: fEnd.pos.x + fEnd.normal.x * outLat,
                z: fEnd.pos.z + fEnd.normal.z * outLat,
              },
              outwardDir: { x: fEnd.tangent.x, z: fEnd.tangent.z },
              toOuterDir: {
                x: sc.sideSign * fEnd.normal.x,
                z: sc.sideSign * fEnd.normal.z,
              },
              width: sideSpec.totalWidth,
              curbWidth: sideSpec.curbWidth,
              curbHeight: cross.curbHeight,
              baseY,
              hasElevationSampler: Boolean(sampleY),
            },
          );
        }
      }
    }

    // 横断歩道開口と同期したガードレール区間算出＋バッチ防護柵構築
    const subtractGuardrailOpenings = (
      baseIntervals: ReadonlyArray<{ start: number; end: number }>,
    ): Array<{ start: number; end: number }> => {
      const result: Array<{ start: number; end: number }> = [];
      const sortedCuts = [...curvedCrosswalkArcs]
        .map((c) => [c - 3.6, c + 3.6] as [number, number])
        .sort((a, b) => a[0] - b[0]);

      for (const iv of baseIntervals) {
        let cursor = iv.start + 1.5;
        const limitEnd = iv.end - 1.5;
        for (const [cutStart, cutEnd] of sortedCuts) {
          if (cutEnd <= cursor || cutStart >= limitEnd) {
            continue;
          }
          const clippedEnd = Math.min(limitEnd, cutStart);
          if (clippedEnd - cursor >= 3.5) {
            result.push({ start: cursor, end: clippedEnd });
          }
          cursor = Math.max(cursor, cutEnd);
        }
        if (limitEnd - cursor >= 3.5) {
          result.push({ start: cursor, end: limitEnd });
        }
      }
      return result;
    };

    const leftGuardrailIntervals = subtractGuardrailOpenings(
      hasLeftSidewalk ? leftSidewalkIntervals : activeRoadIntervals,
    );
    const rightGuardrailIntervals = subtractGuardrailOpenings(
      hasRightSidewalk ? rightSidewalkIntervals : activeRoadIntervals,
    );

    if (config.hasGuardrails) {
      const beamMat = this.materials.getGuardrailBeamMaterial(preset.guardrailStyle);
      const retroMat = this.materials.getGuardrailRetroMaterial();

      const rightRail = buildBatchedCurvedGuardrailGroup({
        intervals: rightGuardrailIntervals,
        sideSign: -1,
        halfDriveable,
        baseY,
        getFrame: getInterpolatedFrame,
        evalY,
        beamMaterial: beamMat,
        retroMaterial: retroMat,
        groupName: "CurvedGuardrail_R",
      });
      group.add(rightRail);

      const leftRail = buildBatchedCurvedGuardrailGroup({
        intervals: leftGuardrailIntervals,
        sideSign: 1,
        halfDriveable,
        baseY,
        getFrame: getInterpolatedFrame,
        evalY,
        beamMaterial: beamMat,
        retroMaterial: retroMat,
        groupName: "CurvedGuardrail_L",
      });
      group.add(leftRail);
    }

    return {
      puddleMaterials,
      leftSidewalkIntervals,
      rightSidewalkIntervals,
      leftGuardrailIntervals,
      rightGuardrailIntervals,
    };
  }

  /**
   * 交差点四隅の隅切り R 歩道（横断歩道切下げ＋コーナー集水桝＋斜面密着点字ブロック）および
   * T 字路閉鎖辺連続歩道を構築し、共有マテリアルと SidewalkNetwork へ統合する。
   */
  public buildIntersectionSidewalks(params: IntersectionSidewalkBuildParams): {
    puddleMaterials: PuddleMaterial[];
  } {
    const {
      interGroup,
      config,
      baseY,
      centerTerrainY,
      groundBodyY,
      sampleY,
      physicsWorld,
      rapier,
      groundBody,
      colliders,
      brailleMaterial,
    } = params;

    const shouldBuildCorners = (config.hasCornerSidewalks ?? true) && Boolean(config.arms);
    if (!shouldBuildCorners) {
      return { puddleMaterials: [] };
    }

    const preset = resolveSidewalkDistrictPreset({
      roadId: config.name,
      roadName: config.name,
      worldX: config.x,
      explicitPavingStyle: config.sidewalkPavingStyle ?? "granite_slab",
    });

    const sidewalkMat = this.materials.getSidewalkPavingMaterial(preset.pavingStyle);
    const curbMat = this.materials.getCurbMaterial();
    const gutterMat = this.materials.getLGutterMaterial();
    const catchBasinMat = this.materials.getCatchBasinGrateMaterial();
    const curbHeight = config.curbHeight ?? 0.15;

    const localDeltaSampler = sampleY
      ? (lx: number, lz: number) => sampleY(config.x + lx, config.z + lz) - centerTerrainY
      : undefined;

    const roadId = config.name ?? `Intersection_${Math.round(config.x)}_${Math.round(config.z)}`;
    const corners = buildUpgradedIntersectionCornerSidewalks(
      config,
      {
        sidewalkMaterial: sidewalkMat,
        curbMaterial: curbMat,
        gutterMaterial: gutterMat,
        brailleMaterial,
        catchBasinMaterial: catchBasinMat,
      },
      {
        roadId,
        roadName: roadId,
        presetId: preset.id,
        pavingStyle: preset.pavingStyle,
      },
      0,
      localDeltaSampler,
    );
    interGroup.add(corners.group);

    for (const cc of corners.cornerColliders) {
      const colGroundY = sampleY ? sampleY(config.x + cc.cx, config.z + cc.cz) : 0;
      const swColDesc = rapier.ColliderDesc.cuboid(cc.halfX, curbHeight * 0.5, cc.halfZ)
        .setTranslation(
          config.x + cc.cx,
          colGroundY + baseY + curbHeight * 0.5 - groundBodyY,
          config.z + cc.cz,
        )
        .setFriction(0.8);
      colliders.push(physicsWorld.createCollider(swColDesc, groundBody));
    }

    for (const rec of corners.records) {
      this.records.push(rec);
    }
    for (const term of corners.terminals) {
      this.terminals.push(term);
    }

    return {
      puddleMaterials: [sidewalkMat],
    };
  }

  private minDistanceToPolygonEdges(px: number, pz: number, poly: ReadonlyArray<Point2D>): number {
    if (isPointInPolygon2D(px, pz, poly)) {
      return 0;
    }
    let minD = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const lenSq = dx * dx + dz * dz;
      const t =
        lenSq > 1e-8 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / lenSq)) : 0;
      const d = Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
      if (d < minD) {
        minD = d;
      }
    }
    return minD;
  }

  private isTerminalAlreadyConnected(term: SidewalkTerminal, toleranceMeters = 0.25): boolean {
    const midX = (term.curbPt.x + term.outerPt.x) * 0.5;
    const midZ = (term.curbPt.z + term.outerPt.z) * 0.5;
    for (const rec of this.records) {
      if (rec.id === term.segmentId) {
        continue;
      }
      const b = rec.bounds;
      const dxB = Math.max(0, b.minX - midX, midX - b.maxX);
      const dzB = Math.max(0, b.minZ - midZ, midZ - b.maxZ);
      if (Math.hypot(dxB, dzB) > toleranceMeters + term.width * 0.5 + 0.25) {
        continue;
      }
      const dCurb = this.minDistanceToPolygonEdges(term.curbPt.x, term.curbPt.z, rec.polygonXZ);
      const dOuter = this.minDistanceToPolygonEdges(term.outerPt.x, term.outerPt.z, rec.polygonXZ);
      if (dCurb <= toleranceMeters && dOuter <= toleranceMeters) {
        return true;
      }
    }
    return false;
  }

  /**
   * 渋谷の斜交・Y字・T字・5差路スクランブル交差点および直線×曲線合流点において、
   * 交差点外周で切断されていた開放歩道端末同士をカイラリティ整合（車道非横断）で自動接続し、
   * 連続した隅切り R 歩道・連続エッジ歩道・L 型側溝・雨水集水桝を構築する。
   */
  public connectOpenJunctionSidewalks(params: ConnectOpenJunctionSidewalksParams): {
    group: THREE.Group;
    puddleMaterials: PuddleMaterial[];
    createdBridgeCount: number;
  } {
    const {
      targets,
      brailleMaterial,
      physicsWorld,
      rapier,
      staticBody,
      colliders,
      isPointInCarriageway,
      resolveElevationSampler,
    } = params;

    const connectorGroup = new THREE.Group();
    connectorGroup.name = "JunctionSidewalkConnectors";
    connectorGroup.userData.isRoadInfrastructure = true;
    const usedPuddleMats: PuddleMaterial[] = [];
    const consumedTerminalIds = new Set<string>();
    let createdBridgeCount = 0;

    const registerPuddle = (mat: PuddleMaterial): void => {
      if (!usedPuddleMats.includes(mat)) {
        usedPuddleMats.push(mat);
      }
    };

    const cross2D = (a: Point2D, b: Point2D): number => a.x * b.z - a.z * b.x;

    const tryBuildBridge = (
      termA: SidewalkTerminal,
      termB: SidewalkTerminal,
      roadId: string,
      roadName: string,
      protectedCenter?: { x: number; z: number; radius: number },
      elevationSampler?: (x: number, z: number) => number,
      maxBridgeDist = 48.0,
    ): boolean => {
      if (consumedTerminalIds.has(termA.id) || consumedTerminalIds.has(termB.id)) {
        return false;
      }
      if (termA.segmentId === termB.segmentId) {
        return false;
      }
      const chordLen = Math.hypot(termA.curbPt.x - termB.curbPt.x, termA.curbPt.z - termB.curbPt.z);
      const outerChordLen = Math.hypot(
        termA.outerPt.x - termB.outerPt.x,
        termA.outerPt.z - termB.outerPt.z,
      );
      if ((chordLen < 0.05 && outerChordLen < 0.35) || chordLen > maxBridgeDist) {
        return false;
      }

      const pavingStyle = termB.pavingStyle;
      const sidewalkMat = this.materials.getSidewalkPavingMaterial(pavingStyle);
      const curbMat = this.materials.getCurbMaterial();
      const gutterMat = this.materials.getLGutterMaterial();
      const catchBasinMat = this.materials.getCatchBasinGrateMaterial();

      const resolvedSampler =
        elevationSampler ??
        resolveElevationSampler?.(
          (termA.curbPt.x + termB.curbPt.x) * 0.5,
          (termA.curbPt.z + termB.curbPt.z) * 0.5,
        );

      this.bridgeCounter += 1;
      const bridgeId = `${roadId}_${this.bridgeCounter}`;
      const bridge = buildArbitraryAngleSidewalkBridge({
        termB,
        termA,
        materials: {
          sidewalkMaterial: sidewalkMat,
          curbMaterial: curbMat,
          gutterMaterial: gutterMat,
          brailleMaterial,
          catchBasinMaterial: catchBasinMat,
        },
        bridgeId,
        roadId,
        roadName,
        protectedCenter,
        elevationSampler: resolvedSampler,
      });
      if (!bridge) {
        return false;
      }

      // 生成された歩道スパインの中央点が他道路の走行車線内に侵入していないか安全検証
      if (isPointInCarriageway && bridge.record.walkableSpine.length >= 3) {
        const spine = bridge.record.walkableSpine;
        const sampleIndices = [
          Math.floor(spine.length * 0.35),
          Math.floor(spine.length * 0.5),
          Math.floor(spine.length * 0.65),
        ];
        for (const sIdx of sampleIndices) {
          const sp = spine[sIdx];
          if (isPointInCarriageway(sp.x, sp.z)) {
            return false;
          }
        }
      }

      connectorGroup.add(bridge.group);
      this.records.push(bridge.record);
      registerPuddle(sidewalkMat);
      consumedTerminalIds.add(termA.id);
      consumedTerminalIds.add(termB.id);
      createdBridgeCount += 1;

      // 車道外側の安全な位置のみへ非障害物（縁石段差）コライダーを配置
      if (bridge.colliderCenter) {
        const cc = bridge.colliderCenter;
        const isSafeCollider = !isPointInCarriageway || !isPointInCarriageway(cc.x, cc.z);
        if (isSafeCollider) {
          const staticBodyY =
            typeof staticBody?.translation === "function" ? staticBody.translation().y : 0;
          const gy = resolvedSampler ? resolvedSampler(cc.x, cc.z) : 0;
          const colDesc = rapier.ColliderDesc.cylinder(
            bridge.curbHeight * 0.5,
            bridge.colliderRadius,
          )
            .setTranslation(cc.x, gy + bridge.baseY + bridge.curbHeight * 0.5 - staticBodyY, cc.z)
            .setFriction(0.8);
          colliders.push(physicsWorld.createCollider(colDesc, staticBody));
        }
      }

      return true;
    };

    // Pass 1: 各交差点ターゲット周囲の開放歩道端末を偏角順＋カイラリティ整合（+1 -> -1）で接続
    for (const target of targets) {
      const candidates: Array<{ term: SidewalkTerminal; angle: number; cross: number }> = [];
      for (const term of this.terminals) {
        if (consumedTerminalIds.has(term.id)) {
          continue;
        }
        const dx = target.x - term.curbPt.x;
        const dz = target.z - term.curbPt.z;
        const dist = Math.hypot(dx, dz);
        if (dist > target.searchRadius || dist < 1.0) {
          continue;
        }
        const towardDot = (term.outwardDir.x * dx + term.outwardDir.z * dz) / dist;
        // L字屈曲点直近（dist < 14m）の外側歩道端は交差点中心に対して横向き（towardDot ≈ 0）になるため許容する
        const minTowardDot = dist < 14.0 ? -0.35 : 0.12;
        if (towardDot < minTowardDot) {
          continue;
        }
        if (this.isTerminalAlreadyConnected(term, 0.25)) {
          continue;
        }
        const angle = Math.atan2(term.curbPt.x - target.x, term.curbPt.z - target.z);
        const chirality = cross2D(term.outwardDir, term.toOuterDir);
        candidates.push({ term, angle, cross: chirality });
      }

      if (candidates.length < 2) {
        continue;
      }

      candidates.sort((a, b) => a.angle - b.angle);
      const protectedCenter =
        target.protectedCenterRadius && target.protectedCenterRadius > 0
          ? { x: target.x, z: target.z, radius: target.protectedCenterRadius }
          : undefined;

      const n = candidates.length;
      for (let i = 0; i < n; i++) {
        const curr = candidates[i];
        const next = candidates[(i + 1) % n];
        // カイラリティ不変式: cross(curr) > 0 かつ cross(next) < 0 の組のみ歩道コーナー/連続辺（車道横断を絶対回避）
        const isValidCornerPair = curr.cross > 0 && next.cross < 0;
        if (!isValidCornerPair) {
          continue;
        }
        tryBuildBridge(
          curr.term,
          next.term,
          target.id,
          target.id,
          protectedCenter,
          target.elevationSampler,
          target.maxBridgeDist ?? 48.0,
        );
      }
    }

    // Pass 2: 残存する近接対向端末（直線×曲線継ぎ目・曲線×曲線直列接続 0.05m〜7.5m）を直接ステッチ
    const openTerms = this.terminals.filter(
      (t) => !consumedTerminalIds.has(t.id) && !this.isTerminalAlreadyConnected(t, 0.25),
    );
    const candidatesPass2: Array<{
      termA: SidewalkTerminal;
      termB: SidewalkTerminal;
      dist: number;
    }> = [];
    for (let i = 0; i < openTerms.length; i++) {
      const a = openTerms[i];
      const crossA = cross2D(a.outwardDir, a.toOuterDir);
      if (crossA <= 0) {
        continue;
      }
      for (let j = 0; j < openTerms.length; j++) {
        if (i === j) continue;
        const b = openTerms[j];
        if (a.segmentId === b.segmentId) continue;
        const crossB = cross2D(b.outwardDir, b.toOuterDir);
        if (crossB >= 0) {
          continue;
        }
        const dx = a.curbPt.x - b.curbPt.x;
        const dz = a.curbPt.z - b.curbPt.z;
        const dist = Math.hypot(dx, dz);
        const outerDist = Math.hypot(a.outerPt.x - b.outerPt.x, a.outerPt.z - b.outerPt.z);
        if ((dist < 0.05 && outerDist < 0.35) || dist > 7.5) {
          continue;
        }
        if (dist >= 0.25) {
          const toADot = (b.outwardDir.x * dx + b.outwardDir.z * dz) / dist;
          const toBDot = (a.outwardDir.x * -dx + a.outwardDir.z * -dz) / dist;
          const minFacingDot = dist < 3.0 ? 0.05 : 0.35;
          if (toADot < minFacingDot || toBDot < minFacingDot) {
            continue;
          }
        }
        candidatesPass2.push({ termA: a, termB: b, dist });
      }
    }
    candidatesPass2.sort((x, y) => x.dist - y.dist);
    for (const pair of candidatesPass2) {
      tryBuildBridge(
        pair.termA,
        pair.termB,
        `Stitch_${pair.termB.roadId}`,
        `Stitch_${pair.termB.roadId}`,
        undefined,
        undefined,
        7.5,
      );
    }

    return {
      group: connectorGroup,
      puddleMaterials: usedPuddleMats,
      createdBridgeCount,
    };
  }

  /**
   * 任意ワールド XZ 座標が登録済み歩道ポリゴン内に含まれるかを高速判定する。
   */
  public isPointOnSidewalk(x: number, z: number): boolean {
    for (const rec of this.records) {
      const b = rec.bounds;
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) {
        continue;
      }
      if (isPointInPolygon2D(x, z, rec.polygonXZ)) {
        return true;
      }
    }
    return false;
  }

  /**
   * 任意ワールド XZ 座標から最寄りの歩道セグメントレコードを探索する。
   */
  public findNearestSidewalk(
    x: number,
    z: number,
    maxDistanceMeters = 40.0,
  ): { record: SidewalkSegmentRecord; distanceMeters: number } | null {
    let bestRec: SidewalkSegmentRecord | null = null;
    let bestDist = maxDistanceMeters;

    for (const rec of this.records) {
      const b = rec.bounds;
      const dxBox = Math.max(0, b.minX - x, x - b.maxX);
      const dzBox = Math.max(0, b.minZ - z, z - b.maxZ);
      const boxDist = Math.hypot(dxBox, dzBox);
      if (boxDist > bestDist) {
        continue;
      }
      if (isPointInPolygon2D(x, z, rec.polygonXZ)) {
        return { record: rec, distanceMeters: 0 };
      }
      for (const sp of rec.walkableSpine) {
        const d = Math.hypot(x - sp.x, z - sp.z);
        if (d < bestDist) {
          bestDist = d;
          bestRec = rec;
        }
      }
    }

    return bestRec ? { record: bestRec, distanceMeters: bestDist } : null;
  }

  public getSidewalkNetwork(): SidewalkNetwork {
    return {
      version: "1.0.0",
      segments: this.records,
    };
  }

  public getNetworkSummary(): SidewalkNetworkSummary {
    let straightSegments = 0;
    let curvedSegments = 0;
    let intersectionCorners = 0;
    let intersectionEdges = 0;
    let totalAreaSqMeters = 0;
    let totalRampCount = 0;
    let totalTactilePadCount = 0;
    let totalCatchBasinCount = 0;
    const pavingStyleBreakdown: Record<string, number> = {};

    for (const rec of this.records) {
      if (rec.kind === "straight") straightSegments += 1;
      else if (rec.kind === "curved") curvedSegments += 1;
      else if (rec.kind === "intersection_corner") intersectionCorners += 1;
      else if (rec.kind === "intersection_edge") intersectionEdges += 1;

      totalAreaSqMeters += rec.areaSqMeters;
      totalRampCount += rec.rampCount;
      totalTactilePadCount += rec.tactilePadCount;
      totalCatchBasinCount += rec.catchBasinCount;
      pavingStyleBreakdown[rec.pavingStyle] = (pavingStyleBreakdown[rec.pavingStyle] ?? 0) + 1;
    }

    return SidewalkNetworkSummarySchema.parse({
      version: "1.0.0",
      totalSegments: this.records.length,
      straightSegments,
      curvedSegments,
      intersectionCorners,
      intersectionEdges,
      totalAreaSqMeters: Math.round(totalAreaSqMeters * 10) / 10,
      totalRampCount,
      totalTactilePadCount,
      totalCatchBasinCount,
      pavingStyleBreakdown,
    });
  }
}

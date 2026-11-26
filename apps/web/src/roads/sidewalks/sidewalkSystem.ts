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
  buildBatchedCatchBasinGeometry,
  buildBatchedCurvedGuardrailGroup,
  buildSlopedTactilePadGeometry,
  buildUpgradedIntersectionCornerSidewalks,
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
export class SidewalkSystem {
  public readonly materials: SidewalkMaterialLibrary;
  private readonly records: SidewalkSegmentRecord[] = [];
  private segmentCounter = 0;

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
      this.records.push({
        id: `sw_straight_${this.segmentCounter}_${sideTag}`,
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
          this.records.push({
            id: `sw_curved_${this.segmentCounter}_${sideTag}_${ivIdx}`,
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

    return {
      puddleMaterials: [sidewalkMat],
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

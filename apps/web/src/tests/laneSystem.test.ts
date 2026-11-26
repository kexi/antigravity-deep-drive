import { describe, expect, it } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  ROAD_LANE_CATALOG,
  auditCityLaneSystem,
  buildArbitraryAngleJunctionMarkings,
  buildLaneDebugOverlayGroup,
  buildRectanglePolygon,
  buildRoadLaneProfile,
  computeClippedMarkingIntervals,
  evaluateLaneCrossSectionAt,
  isPointInPolygon2D,
  lookupRoadLaneCatalogEntry,
  resolveDefaultLaneArrow,
  resolveDriverLeftToRightArrows,
  resolveJunctionTopology,
} from "../roads/lanes";
import { buildStraightRoadFrames } from "../roads/roadCrossSection";
import { JapaneseRoadBuilder } from "../roads/roadBuilder";
import { RoadMarkings } from "../roads/roadMarkings";
import { JapaneseRoadSigns } from "../roads/roadSigns";
import { TokyoStationMap } from "../city/tokyoStationMap";
import { sampleShibuyaTerrainY } from "../openData/gsiPlateauLoader";
import { assetManager } from "../assets/assetManager";
import type { JapaneseRoadSegmentConfig } from "../roads/types";

describe("Unified Lane System（統一車線プロファイル・交差点トポロジー・都市全体幾何監査）", () => {
  it("宣言的車線カタログが Zod 検証を通過し、2車線・3車線・非対称・一方通行・右折ポケット（車道外縁不変）を正確に展開することを保証する", () => {
    expect(ROAD_LANE_CATALOG.length).toBeGreaterThanOrEqual(8);
    expect(lookupRoadLaneCatalogEntry("nav-road-meiji-dori")?.inboundArrows).toEqual([
      "straight-right",
      "straight-left",
    ]);
    expect(resolveDefaultLaneArrow(0, 2)).toBe("straight-right");
    expect(resolveDefaultLaneArrow(1, 2)).toBe("straight-left");
    expect(resolveDefaultLaneArrow(0, 3)).toBe("right");
    expect(resolveDefaultLaneArrow(1, 3)).toBe("straight");
    expect(resolveDefaultLaneArrow(2, 3)).toBe("straight-left");

    // 1. 非対称・一方通行道路の自動展開
    const oneWayConfig: JapaneseRoadSegmentConfig = {
      roadId: "test-oneway",
      name: "TestOneWay",
      lanesPerDirection: 2,
      laneWidth: 3.2,
      shoulderWidth: 0.75,
      sidewalkWidth: 2.5,
      curbHeight: 0.15,
      length: 90,
      laneProfileOverride: {
        idPattern: "test-oneway",
        description: "一方通行2車線テスト",
        inboundLaneCount: 2,
        oncomingLaneCount: 0,
        inboundArrows: ["right", "straight-left"],
      },
    };
    const oneWayProfile = buildRoadLaneProfile(oneWayConfig, 90, {
      roadId: "test-oneway",
      catalogEntry: oneWayConfig.laneProfileOverride,
    });
    const oneWayCross = evaluateLaneCrossSectionAt(oneWayProfile, 45);
    expect(oneWayCross.centerFeature).toBe("none");
    expect(oneWayCross.inboundLanes.length).toBe(2);
    expect(oneWayCross.oncomingLanes.length).toBe(0);
    expect(resolveDriverLeftToRightArrows(oneWayProfile.sections[0].inboundLanes)).toEqual([
      "straight-left",
      "right",
    ]);

    // 2. 国道246号の右折ポケット＋中央ゼブラ導流帯が既存の車道半幅（halfDriveableWidth）を不変のまま内側に収めること
    const r246Entry = lookupRoadLaneCatalogEntry("nav-road-route246");
    expect(r246Entry).toBeDefined();
    const r246Config: JapaneseRoadSegmentConfig = {
      roadId: "nav-road-route246",
      name: "国道246号",
      lanesPerDirection: 3,
      laneWidth: 3.45,
      shoulderWidth: 1.5,
      medianWidth: 2.4,
      sidewalkWidth: 3.5,
      curbHeight: 0.15,
      length: 220,
    };
    const r246Profile = buildRoadLaneProfile(r246Config, 220, {
      roadId: "nav-road-route246",
      catalogEntry: r246Entry,
    });
    const expectedHalfDriveable = 3 * 3.45 + 1.5 + 2.4 * 0.5;
    expect(r246Profile.halfDriveableWidth).toBeCloseTo(expectedHalfDriveable, 5);

    const chevronSec = r246Profile.sections.find((s) => s.centerFeature === "zebra_chevron");
    const pocketSec = r246Profile.sections.find((s) => s.hasRightTurnPocketInbound);
    expect(chevronSec).toBeDefined();
    expect(pocketSec).toBeDefined();

    // 右折ポケット区間でも歩道縁石（halfDriveableWidth）をはみ出さず全車線幅 >= 2.75m を維持すること
    const pocketCross = evaluateLaneCrossSectionAt(
      r246Profile,
      (pocketSec!.sStart + pocketSec!.sEnd) * 0.5,
    );
    expect(pocketCross.inboundLanes.length).toBe(4);
    expect(pocketCross.inboundLanes[0].arrow).toBe("right");
    for (const slot of pocketCross.inboundLanes) {
      expect(slot.width).toBeGreaterThanOrEqual(2.75);
      expect(slot.outerOffset).toBeLessThanOrEqual(r246Profile.halfDriveableWidth - 0.3);
    }
  });

  it("任意角度の斜交交差点トポロジーが横断歩道・停止線・右折誘導アークを隅干渉ゼロで生成し、交差点ポリゴン自動クリッピングが長手白線の侵入をゼロに抑えることを保証する", () => {
    const obliqueTopology = resolveJunctionTopology({
      id: "oblique-5way",
      name: "ObliqueTestJunction",
      x: 100,
      z: 200,
      widthX: 38,
      depthZ: 38,
      lanesX: 2,
      lanesZ: 2,
      hasCrosswalks: true,
      hasGuideDots: true,
      explicitArms: [
        {
          armId: "arm_n",
          angleRad: 0.05,
          carriagewayWidth: 14,
          inboundLaneCount: 2,
          oncomingLaneCount: 2,
        },
        {
          armId: "arm_ne",
          angleRad: 1.05,
          carriagewayWidth: 11,
          inboundLaneCount: 2,
          oncomingLaneCount: 2,
        },
        {
          armId: "arm_se",
          angleRad: 2.35,
          carriagewayWidth: 14,
          inboundLaneCount: 2,
          oncomingLaneCount: 2,
        },
        {
          armId: "arm_sw",
          angleRad: -2.2,
          carriagewayWidth: 12,
          inboundLaneCount: 2,
          oncomingLaneCount: 2,
        },
        {
          armId: "arm_nw",
          angleRad: -0.95,
          carriagewayWidth: 11,
          inboundLaneCount: 2,
          oncomingLaneCount: 2,
        },
      ],
    });

    expect(obliqueTopology.arms.length).toBe(5);
    expect(obliqueTopology.turnGuideArcs.some((a) => a.kind === "right_turn")).toBe(true);
    for (const arm of obliqueTopology.arms) {
      expect(arm.maxCrosswalkHalfSpan).toBeGreaterThanOrEqual(1.35);
      expect(arm.crosswalkDistanceFromCenter).toBeGreaterThanOrEqual(3.2);
    }

    const markings = new RoadMarkings();
    const obliqueGroup = buildArbitraryAngleJunctionMarkings(
      obliqueTopology,
      markings.getWhitePaintMaterial(),
    );
    const armCrosswalks = obliqueGroup.children.filter((c) =>
      c.name.startsWith("IntersectionCrosswalk_Arm_"),
    );
    const armStopLines = obliqueGroup.children.filter((c) =>
      c.name.startsWith("IntersectionStopLine_Arm_"),
    );
    expect(armCrosswalks.length).toBe(5);
    expect(armStopLines.length).toBe(5);

    // 交差点ポリゴン自動クリッピング：[-50, 50] を通る道路が中心 (0, 0) の 24x24 交差点内部を厳密に除外すること
    const straightFrames = buildStraightRoadFrames(Array.from({ length: 101 }, (_, i) => i - 50));
    const jPoly = buildRectanglePolygon(0, 0, 24, 24);
    const clipped = computeClippedMarkingIntervals({
      frames: straightFrames,
      startArc: -50,
      endArc: 50,
      junctionPolygons: [jPoly],
      junctionPaddingM: 0.2,
    });
    expect(clipped.length).toBe(2);
    expect(clipped[0].end).toBeLessThanOrEqual(-12.0);
    expect(clipped[1].start).toBeGreaterThanOrEqual(12.0);
    expect(isPointInPolygon2D(0, 0, jPoly)).toBe(true);
    expect(isPointInPolygon2D(0, 15, jPoly)).toBe(false);
  });

  it("路面「止まれ」標示・進行方向別通行区分標識（2/3/4車線配列SSOT）・?debugLanes=1 デバッグ可視化が正しく生成されることを保証する", () => {
    const markings = new RoadMarkings();
    const stopText = markings.createStopTextRoadMarking(1.75, 10, Math.PI);
    expect(stopText.name).toBe("StopTextGroup");
    expect(stopText.userData.markingType).toBe("StopText");
    expect(stopText.children.length).toBeGreaterThanOrEqual(1);

    // 全7種の矢印タイプが例外なく生成されること
    for (const arrowType of [
      "straight",
      "left",
      "right",
      "straight-left",
      "straight-right",
      "left-right",
      "straight-left-right",
    ] as const) {
      const arrow = markings.createLaneArrowMarking(0, 0, arrowType, 0);
      expect(arrow.name).toBe(`LaneArrowGroup_${arrowType}`);
      expect(arrow.children.length).toBeGreaterThanOrEqual(2);
    }

    // 進行方向別通行区分標識（327の7）が配列SSOT（2車線・3車線・右折ポケット付き4車線）を正確に保持すること
    const signs = new JapaneseRoadSigns();
    const sign2 = signs.createLaneDirectionSign(0, 0, ["straight-left", "straight-right"]);
    expect(sign2.name).toBe("LaneDirectionSign_2Lanes");
    expect(sign2.userData.laneArrows).toEqual(["straight-left", "straight-right"]);

    const sign4 = signs.createLaneDirectionSign(0, 0, [
      "straight-left",
      "straight",
      "straight",
      "right",
    ]);
    expect(sign4.name).toBe("LaneDirectionSign_4Lanes");
    expect(sign4.userData.laneArrows).toEqual(["straight-left", "straight", "straight", "right"]);

    // 共有ペイントマテリアルが DoubleSide で公開されていること
    expect(markings.getWhitePaintMaterial().side).toBe(THREE.DoubleSide);
    expect(markings.getYellowPaintMaterial().side).toBe(THREE.DoubleSide);
  });

  it("渋谷・東京駅丸の内の全都市マップに対し、交差点侵入ゼロ・3D起伏追従・標識SSOT一致・車線グラフ整合・右折ポケット導流帯・細街路「止まれ」標示・オーバーライド互換を保証する", async () => {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const scene = new THREE.Scene();
    const cityMap = new TokyoStationMap(scene, world, RAPIER, { deferGlbLoads: true });

    const laneGraph = cityMap.getLaneGraph();
    expect(laneGraph.version).toBe("1.0.0");
    expect(laneGraph.edges.length).toBeGreaterThanOrEqual(40);
    expect(laneGraph.junctions.length).toBeGreaterThanOrEqual(25);
    expect(laneGraph.junctionArcs.length).toBeGreaterThan(0);

    // 1. 都市全体の幾何不変条件監査（交差点侵入・3D起伏追従・標識SSOT一致・車線グラフ構造）
    const report = auditCityLaneSystem(scene, laneGraph, {
      junctionInsetMeters: 2.5,
      elevationSampler: sampleShibuyaTerrainY,
      elevationRegionFilter: (x) => x < -395,
      elevationToleranceRange: [-0.04, 0.22],
    });
    expect(report.checkedMarkingMeshes).toBeGreaterThan(50);
    expect(report.checkedSignCount).toBeGreaterThan(0);
    expect(report.violations, JSON.stringify(report.violations.slice(0, 10), null, 2)).toEqual([]);
    expect(report.passed).toBe(true);

    // 2. 新規日本固有標示（右折ポケット中央ゼブラ導流帯・交差点右折誘導アーク・細街路「止まれ」路面文字）が実都市に配置されていること
    let chevronCount = 0;
    let pocketYellowCount = 0;
    let stopTextCount = 0;
    let turnGuideArcCount = 0;
    scene.traverse((obj) => {
      if (obj.name.startsWith("CurvedChevron_GuideZone_")) chevronCount += 1;
      if (obj.name.startsWith("CurvedMarking_RightTurnPocketYellow_")) pocketYellowCount += 1;
      if (obj.name === "StopTextGroup") stopTextCount += 1;
      if (obj.name.startsWith("IntersectionTurnGuideArcs_")) turnGuideArcCount += 1;
    });
    expect(chevronCount).toBeGreaterThan(0);
    expect(pocketYellowCount).toBeGreaterThan(0);
    expect(stopTextCount).toBeGreaterThan(0);
    expect(turnGuideArcCount).toBeGreaterThan(0);

    // 3. ?debugLanes=1 デバッグ可視化グループがバッチ LineSegments として生成されること
    const debugOverlay = buildLaneDebugOverlayGroup(laneGraph, {
      elevationSampler: (x, z) => (x < -395 ? sampleShibuyaTerrainY(x, z) : 0),
    });
    expect(debugOverlay.name).toBe("LaneDebugOverlay");
    expect(debugOverlay.children.length).toBeGreaterThanOrEqual(4);

    // 4. AssetManagerUI の道路オーバーライド（applyRoadDefinitionOverride）が引き続き動作すること
    const gyokoRoad = assetManager.getRoads().find((r) => r.id.includes("gyoko"));
    expect(gyokoRoad).toBeDefined();
    if (gyokoRoad) {
      const overrideRes = cityMap.applyRoadDefinitionOverride({
        ...gyokoRoad,
        markings: { ...gyokoRoad.markings, hasShoulderLines: false },
      });
      expect(overrideRes.matchedSegments).toBeGreaterThan(0);
    }

    // 5. JapaneseRoadBuilder 単体でも共有ペイントマテリアルを再利用し不要な複製を行わないこと
    const builder = new JapaneseRoadBuilder();
    const polyA = builder.buildPolylineSegment(
      {
        name: "MatShareA",
        lanesPerDirection: 2,
        laneWidth: 3.4,
        shoulderWidth: 1.0,
        sidewalkWidth: 0,
        curbHeight: 0.15,
        length: 80,
        hasWhiteDashedLines: true,
        hasCrosswalks: true,
      },
      [
        { x: 0, z: 0 },
        { x: 0, z: 40 },
        { x: 0, z: 80 },
      ],
      world,
      RAPIER,
    );
    const polyB = builder.buildPolylineSegment(
      {
        name: "MatShareB",
        lanesPerDirection: 2,
        laneWidth: 3.4,
        shoulderWidth: 1.0,
        sidewalkWidth: 0,
        curbHeight: 0.15,
        length: 80,
        hasWhiteDashedLines: true,
        hasCrosswalks: true,
      },
      [
        { x: 30, z: 0 },
        { x: 30, z: 40 },
        { x: 30, z: 80 },
      ],
      world,
      RAPIER,
    );
    const whiteMatA = polyA.group.getObjectByName("CurvedMarking_Shoulder_L_0") as THREE.Mesh;
    const whiteMatB = polyB.group.getObjectByName("CurvedMarking_Shoulder_L_0") as THREE.Mesh;
    expect(whiteMatA.material).toBe(whiteMatB.material);
  }, 45_000);
});

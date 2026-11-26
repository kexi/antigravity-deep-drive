import { describe, expect, it } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  SidewalkMaterialLibrary,
  SidewalkSystem,
  auditSidewalkSystem,
  buildBatchedCatchBasinGeometry,
  buildSidewalkZoneSpec,
  buildSlopedTactilePadGeometry,
  evaluateSidewalkTopHeight,
  resolveSidewalkDistrictPreset,
} from "../roads/sidewalks";
import {
  buildStationsWithRamps,
  buildStraightRoadFrames,
  computeRoadCrossSection,
} from "../roads/roadCrossSection";
import { JapaneseRoadBuilder } from "../roads/roadBuilder";
import { TokyoStationMap } from "../city/tokyoStationMap";

describe("Unified Sidewalk Creation System（統一歩道作成・共有マテリアル・交差点切下げ・集水桝・都市監査）", () => {
  it("地区プリセット解決・道路構造令ゾーニング・共有マテリアルキャッシュ（PuddleMaterial 最大3種）を保証する", () => {
    const marunouchi = resolveSidewalkDistrictPreset({ roadName: "行幸通り", worldX: 0 });
    expect(marunouchi.id).toBe("marunouchi_granite");
    expect(marunouchi.pavingStyle).toBe("granite_slab");

    const shibuya = resolveSidewalkDistrictPreset({ roadName: "道玄坂", worldX: -1200 });
    expect(shibuya.id).toBe("shibuya_brick");
    expect(shibuya.pavingStyle).toBe("interlocking_brick");
    expect(shibuya.guardrailStyle).toBe("tokyo_white_pipe");

    const ginza = resolveSidewalkDistrictPreset({ roadName: "中央通り（銀座）", worldX: 150 });
    expect(ginza.id).toBe("ginza_promenade");

    const zoneSpec = buildSidewalkZoneSpec({
      preset: marunouchi,
      totalWidthMeters: 4.5,
      curbWidthMeters: 0.2,
      curbHeightMeters: 0.15,
      gutterWidthMeters: 0.24,
      hasGuardrails: true,
      hasCrosswalks: true,
    });
    expect(zoneSpec.furnitureZoneWidthMeters).toBeCloseTo(0.9, 2);
    expect(zoneSpec.pedestrianClearWidthMeters).toBeGreaterThan(3.0);
    expect(zoneSpec.hasCatchBasins).toBe(true);

    // 共有マテリアルキャッシュ効率：何回取得しても同一参照が返り、総数 <= 10 に収まること
    const lib = new SidewalkMaterialLibrary();
    const g1 = lib.getSidewalkPavingMaterial("granite_slab");
    const g2 = lib.getSidewalkPavingMaterial("granite_slab");
    const b1 = lib.getSidewalkPavingMaterial("interlocking_brick");
    const c1 = lib.getSidewalkPavingMaterial("concrete_tile");
    expect(g1).toBe(g2);
    expect(g1).not.toBe(b1);
    expect(lib.getPuddleMaterials().length).toBe(3);

    const curb1 = lib.getCurbMaterial();
    const curb2 = lib.getCurbMaterial();
    expect(curb1).toBe(curb2);
    lib.getLGutterMaterial();
    lib.getCatchBasinGrateMaterial();
    lib.getGuardrailBeamMaterial("tokyo_white_pipe");
    lib.getGuardrailRetroMaterial();
    expect(c1.uSidewalkPavingMode.value).toBe(3);
    expect(lib.getCachedMaterialStats().pavingMaterialCount).toBe(3);
    expect(lib.getCachedMaterialStats().totalCachedMaterials).toBeLessThanOrEqual(10);
  });

  it("横断歩道切り下げ斜面へ密着する点字警告ブロックと L 型側溝バッチ雨水集水桝ジオメトリの精度を保証する", () => {
    const cross = computeRoadCrossSection({
      lanesPerDirection: 2,
      laneWidth: 3.5,
      shoulderWidth: 1.0,
      sidewalkWidth: 4.0,
      curbHeight: 0.15,
      length: 100,
    });
    const rampZones = [{ center: 25, halfWidth: 2.2, transitionLength: 1.2 }];
    const stations = buildStationsWithRamps(-50, 50, 8.0, rampZones);
    const frames = buildStraightRoadFrames(stations);

    // 切り下げ中心（z=25）で縁石側高さ 0.02m → 建物側高さ backEdgeHeight へ連続傾斜すること
    const innerTopY = evaluateSidewalkTopHeight(
      25,
      cross.left.walkInner,
      cross.left,
      0.15,
      rampZones,
    );
    const outerTopY = evaluateSidewalkTopHeight(
      25,
      cross.left.walkOuter,
      cross.left,
      0.15,
      rampZones,
    );
    expect(innerTopY).toBeCloseTo(0.02, 3);
    expect(outerTopY).toBeCloseTo(cross.left.backEdgeHeight, 3);

    // 点字警告ブロックの各頂点が傾斜歩道面の上面 (+5.5mm) へ完全追従し、車道側が建物側より低く傾斜すること
    const padGeo = buildSlopedTactilePadGeometry({
      frames,
      sideSign: 1,
      crossSection: cross,
      baseY: 0,
      centerArc: 25,
      padWidth: 0.6,
      padLength: 2.4,
      rampZones,
    });
    const pos = padGeo.getAttribute("position") as THREE.BufferAttribute;
    expect(pos.count).toBe(10);
    const yInnerAtCenter = pos.getY(4);
    const yOuterAtCenter = pos.getY(5);
    expect(yOuterAtCenter).toBeGreaterThan(yInnerAtCenter + 0.01);
    expect(yInnerAtCenter).toBeGreaterThan(0.02);
    expect(yOuterAtCenter).toBeLessThan(0.12);

    // バッチ雨水集水桝が切り下げスロープ前後＋等間隔で複数配置され、単一 BufferGeometry に統合されること
    const basin = buildBatchedCatchBasinGeometry({
      frames,
      sideSign: 1,
      crossSection: cross,
      baseY: 0,
      rampZones,
      spacingMeters: 22.0,
    });
    expect(basin.count).toBeGreaterThanOrEqual(4);
    const bPos = basin.geometry.getAttribute("position") as THREE.BufferAttribute;
    expect(bPos.count).toBe(basin.count * 4);
  });

  it("交差点隅切り歩道の横断歩道切下げスロープ・コーナー集水桝・SidewalkNetwork空間クエリを保証する", async () => {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const builder = new JapaneseRoadBuilder();
    const groundBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0),
    );

    const inter = builder.buildIntersection(
      {
        name: "TestRampedCornerIntersection",
        x: 100,
        z: 200,
        widthX: 30,
        depthZ: 30,
        lanesX: 2,
        lanesZ: 2,
        hasCrosswalks: true,
        hasCornerSidewalks: true,
        arms: {
          north: { carriagewayWidth: 16, sidewalkLeft: 4, sidewalkRight: 4 },
          south: { carriagewayWidth: 16, sidewalkLeft: 4, sidewalkRight: 4 },
          east: { carriagewayWidth: 16, sidewalkLeft: 4, sidewalkRight: 4 },
          west: { carriagewayWidth: 16, sidewalkLeft: 4, sidewalkRight: 4 },
        },
      },
      world,
      RAPIER,
      groundBody,
    );

    // 4隅すべてに隅切り縁石・歩道・コーナー集水桝が生成され、切下げ部（<=0.04m）と標準頂部（>=0.14m）が共存すること
    const neCurb = inter.group.getObjectByName("IntersectionCurbCorner_NE") as THREE.Mesh;
    const neBasin = inter.group.getObjectByName("IntersectionCatchBasinCorner_NE") as THREE.Mesh;
    expect(neCurb).toBeDefined();
    expect(neBasin).toBeDefined();

    const curbPos = neCurb.geometry.getAttribute("position") as THREE.BufferAttribute;
    let hasLoweredRampVert = false;
    let hasStandardTopVert = false;
    for (let i = 0; i < curbPos.count; i++) {
      const y = curbPos.getY(i);
      if (y > 0.01 && y <= 0.04) hasLoweredRampVert = true;
      if (y >= 0.14) hasStandardTopVert = true;
    }
    expect(hasLoweredRampVert).toBe(true);
    expect(hasStandardTopVert).toBe(true);

    // SidewalkSystem の空間クエリが登録された NE コーナー歩道上を正しく検知すること
    const swSys: SidewalkSystem = builder.getSidewalkSystem();
    const summary = swSys.getNetworkSummary();
    expect(summary.intersectionCorners).toBe(4);
    expect(summary.totalCatchBasinCount).toBe(4);
    expect(summary.totalRampCount).toBeGreaterThanOrEqual(4);
    expect(swSys.isPointOnSidewalk(113.5, 213.5)).toBe(true);
    expect(swSys.isPointOnSidewalk(100, 200)).toBe(false);
    const nearest = swSys.findNearestSidewalk(114.5, 214.5, 10);
    expect(nearest).not.toBeNull();
    expect(nearest!.record.kind).toBe("intersection_corner");
  });

  it("渋谷・東京駅丸の内全都市マップの統一歩道システムが共有マテリアル上限・法線正立・重複0・集水桝・ネットワーク空間クエリを満たすことを保証する", async () => {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const scene = new THREE.Scene();
    const cityMap = new TokyoStationMap(scene, world, RAPIER, { deferGlbLoads: true });

    const swSys = cityMap.getSidewalkSystem();
    const report = auditSidewalkSystem(scene, swSys, {
      maxUniquePavingMaterials: 3,
      maxUniqueSidewalkMaterials: 10,
      requireFullCityCoverage: true,
    });

    expect(report.violations, JSON.stringify(report.violations, null, 2)).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.uniquePavingMaterials).toBeLessThanOrEqual(3);
    expect(report.uniqueSidewalkMaterials).toBeLessThanOrEqual(10);
    expect(report.checkedSidewalkMeshes).toBeGreaterThanOrEqual(200);
    expect(report.checkedCatchBasinMeshes).toBeGreaterThanOrEqual(150);
    expect(report.totalCatchBasins).toBeGreaterThanOrEqual(300);
    expect(report.totalAreaSqMeters).toBeGreaterThan(20_000);

    // 重複排除により TokyoStationMap.puddleMaterials が 15 個以下に劇的圧縮されていること（旧: 140+ 個）
    expect(cityMap.puddleMaterials.length).toBeLessThanOrEqual(15);

    // 曲線歩道ガードレールがバッチ化されていること（片側あたり <= 3 メッシュ）
    let maxGuardrailChildren = 0;
    scene.traverse((obj) => {
      if (obj.name.startsWith("CurvedGuardrail_")) {
        if (obj.children.length > maxGuardrailChildren) {
          maxGuardrailChildren = obj.children.length;
        }
      }
    });
    expect(maxGuardrailChildren).toBeGreaterThanOrEqual(1);
    expect(maxGuardrailChildren).toBeLessThanOrEqual(3);

    // 丸の内・行幸通り歩道上および渋谷歩道ネットワークの空間クエリ検証
    expect(swSys.isPointOnSidewalk(12.5, 90)).toBe(true);
    expect(swSys.isPointOnSidewalk(0, 90)).toBe(false);
    const shibuyaNearest = swSys.findNearestSidewalk(-993, 249, 12);
    expect(shibuyaNearest).not.toBeNull();
    expect(shibuyaNearest!.record.pavingStyle).toBe("interlocking_brick");
  }, 45_000);
});

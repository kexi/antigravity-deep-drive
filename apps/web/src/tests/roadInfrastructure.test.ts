import { describe, expect, it } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  RoadLightingSystem,
  auditRoadLightingSystem,
  resolveRoadLampStyle,
} from "../roads/lighting";
import { BarrierSystem, auditBarrierSystem } from "../roads/barriers";
import { RoadUtilitySystem, auditRoadUtilitySystem } from "../roads/utilities";
import { StreetFurnitureSystem, auditStreetFurnitureSystem } from "../roads/furniture";
import { TokyoStationMap } from "../city/tokyoStationMap";
import { sampleShibuyaTerrainY } from "../openData/gsiPlateauLoader";

describe("Japanese Road 8-System Infrastructure（道路照明・防護安全・路面インフラ・沿道ファニチャー・全8系統統合監査）", () => {
  it("道路照明システム（lighting/）が地区別3様式・共有マテリアルキャッシュ・昼夜調光・PointLightゼロを満たすことを保証する", () => {
    expect(resolveRoadLampStyle(12, 80, "行幸通り").style).toBe("marunouchi_twin_globe");
    expect(resolveRoadLampStyle(50, 250, "日比谷通り").style).toBe("tokyo_arterial_cobra");
    expect(resolveRoadLampStyle(-980, 200, "nav-road-shibuya-koen-dori").style).toBe(
      "shibuya_modern_arm",
    );
    expect(resolveRoadLampStyle(-800, 440, "nav-road-r246-tamagawa").style).toBe(
      "tokyo_arterial_cobra",
    );

    const root = new THREE.Group();
    const lighting = new RoadLightingSystem();
    for (let i = 0; i < 6; i++) {
      const style =
        i % 3 === 0
          ? "marunouchi_twin_globe"
          : i % 3 === 1
            ? "tokyo_arterial_cobra"
            : "shibuya_modern_arm";
      root.add(lighting.placeLamp({ x: i * 20, z: 0, style }).group);
    }

    // 昼間は消灯・ハロー非表示、夜間で高輝度発光＋ハロー表示へ一括切替されること
    lighting.setNightFactor(0.0);
    expect(lighting.materials.warmGlobeMat.emissiveIntensity).toBeLessThan(0.3);
    expect(lighting.materials.warmHaloMat.opacity).toBe(0);

    lighting.setNightFactor(1.0);
    expect(lighting.materials.warmGlobeMat.emissiveIntensity).toBeGreaterThan(2.0);
    expect(lighting.materials.cobraLedMat.emissiveIntensity).toBeGreaterThan(2.0);
    expect(lighting.materials.warmHaloMat.opacity).toBeGreaterThan(0.5);

    const report = auditRoadLightingSystem(root, lighting, { minLamps: 6 });
    expect(report.violations).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.scenePointLights).toBe(0);
    expect(report.uniqueMaterials).toBeLessThanOrEqual(8);
  });

  it("防護安全（barriers/）・路面インフラ（utilities/）・沿道ファニチャー（furniture/）が全実在種別と共有マテリアル上限を満たすことを保証する", () => {
    const root = new THREE.Group();
    const barriers = new BarrierSystem();
    for (const type of [
      "granite_bollard",
      "reflective_bollard",
      "convex_curve_mirror",
      "median_delineator",
    ] as const) {
      root.add(barriers.placeBarrier({ type, x: 10, z: 10, mirrorDual: true }).group);
    }
    const barReport = auditBarrierSystem(root, barriers, { minBarriers: 4 });
    expect(barReport.passed).toBe(true);
    expect(barReport.violations).toEqual([]);
    expect(barReport.uniqueMaterials).toBeLessThanOrEqual(10);

    const utilities = new RoadUtilitySystem();
    for (const type of [
      "tokyo_sewer_manhole",
      "telecom_handhole",
      "pad_transformer",
      "fire_hydrant_sign",
      "tree_pit_curb",
    ] as const) {
      root.add(utilities.placeUtility({ type, x: 20, z: 20 }).group);
    }
    const utilReport = auditRoadUtilitySystem(root, utilities, { minUtilities: 5 });
    expect(utilReport.passed).toBe(true);
    expect(utilReport.violations).toEqual([]);
    expect(utilReport.uniqueMaterials).toBeLessThanOrEqual(10);

    const furniture = new StreetFurnitureSystem();
    for (const type of [
      "bus_stop_toei",
      "bus_stop_tokyu",
      "japan_postbox",
      "district_info_kiosk",
      "parking_meter",
      "sidewalk_bench",
    ] as const) {
      root.add(furniture.placeFurniture({ type, x: 30, z: 30 }).group);
    }
    const furnReport = auditStreetFurnitureSystem(root, furniture, { minItems: 6 });
    expect(furnReport.passed).toBe(true);
    expect(furnReport.violations).toEqual([]);
    expect(furnReport.uniqueMaterials).toBeLessThanOrEqual(12);
  });

  it("全8系統マスター統合オーケストレーター（JapaneseRoadInfrastructure.auditAll）が東京駅丸の内・渋谷の全都市マップでエラーゼロを通過することを保証する", async () => {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const scene = new THREE.Scene();
    const cityMap = new TokyoStationMap(scene, world, RAPIER, { deferGlbLoads: true });

    const infra = cityMap.getRoadInfrastructure();
    const summary = infra.getFullSummary();
    const audit = infra.auditAll(scene, {
      elevationSampler: sampleShibuyaTerrainY,
      elevationRegionFilter: (x) => x < -395,
    });

    expect(audit.lanes.violations, `lanes: ${JSON.stringify(audit.lanes.violations)}`).toEqual([]);
    expect(
      audit.sidewalks.violations,
      `sidewalks: ${JSON.stringify(audit.sidewalks.violations)}`,
    ).toEqual([]);
    expect(
      audit.signals.violations,
      `signals: ${JSON.stringify(audit.signals.violations)}`,
    ).toEqual([]);
    expect(audit.signs.passed).toBe(true);
    expect(
      audit.lighting.violations,
      `lighting: ${JSON.stringify(audit.lighting.violations)}`,
    ).toEqual([]);
    expect(
      audit.barriers.violations,
      `barriers: ${JSON.stringify(audit.barriers.violations)}`,
    ).toEqual([]);
    expect(
      audit.utilities.violations,
      `utilities: ${JSON.stringify(audit.utilities.violations)}`,
    ).toEqual([]);
    expect(
      audit.furniture.violations,
      `furniture: ${JSON.stringify(audit.furniture.violations)}`,
    ).toEqual([]);
    expect(audit.passed).toBe(true);

    // 全実在アイテム種別が都市全体へ配置されていること
    expect(summary.subsystems.lighting.styleBreakdown.marunouchi_twin_globe).toBeGreaterThan(0);
    expect(summary.subsystems.lighting.styleBreakdown.tokyo_arterial_cobra).toBeGreaterThan(0);
    expect(summary.subsystems.lighting.styleBreakdown.shibuya_modern_arm).toBeGreaterThan(0);

    expect(summary.subsystems.barriers.typeBreakdown.granite_bollard).toBeGreaterThan(0);
    expect(summary.subsystems.barriers.typeBreakdown.convex_curve_mirror).toBeGreaterThan(0);
    expect(summary.subsystems.barriers.typeBreakdown.reflective_bollard).toBeGreaterThan(0);

    expect(summary.subsystems.utilities.typeBreakdown.tree_pit_curb).toBeGreaterThan(0);
    expect(summary.subsystems.utilities.typeBreakdown.pad_transformer).toBeGreaterThan(0);
    expect(summary.subsystems.utilities.typeBreakdown.fire_hydrant_sign).toBeGreaterThan(0);
    expect(summary.subsystems.utilities.typeBreakdown.telecom_handhole).toBeGreaterThan(0);
    expect(summary.subsystems.utilities.typeBreakdown.tokyo_sewer_manhole).toBeGreaterThan(0);

    expect(summary.subsystems.furniture.typeBreakdown.bus_stop_toei).toBeGreaterThan(0);
    expect(summary.subsystems.furniture.typeBreakdown.bus_stop_tokyu).toBeGreaterThan(0);
    expect(summary.subsystems.furniture.typeBreakdown.japan_postbox).toBeGreaterThan(0);
    expect(summary.subsystems.furniture.typeBreakdown.district_info_kiosk).toBeGreaterThan(0);
    expect(summary.subsystems.furniture.typeBreakdown.parking_meter).toBeGreaterThan(0);
    expect(summary.subsystems.furniture.typeBreakdown.sidewalk_bench).toBeGreaterThan(0);

    // 夜間切替で照明システムが同期更新されること
    cityMap.setNightMode(true);
    expect(cityMap.lightingSystem.getSummary().nightFactor).toBe(1);
    cityMap.setNightMode(false);
    expect(cityMap.lightingSystem.getSummary().nightFactor).toBe(0);
  }, 45_000);
});

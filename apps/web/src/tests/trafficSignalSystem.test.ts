import { describe, expect, it } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  IntersectionTimingConfigSchema,
  TrafficSignalController,
  alignSignalYawToRoadOverhang,
  auditTrafficSignalSystem,
  computeIntersectionSignalPlacements,
  resolveAdaptiveArmLength,
  resolveIntersectionDisplayName,
} from "../roads/signals";
import { resolveJunctionTopology } from "../roads/lanes";
import { RoadProps } from "../roads/roadProps";
import { TokyoStationMap } from "../city/tokyoStationMap";
import { sampleShibuyaTerrainY } from "../openData/gsiPlateauLoader";

describe("Unified Traffic Signal System（統一信号作成・排他フェーズ制御・都市全体監査）", () => {
  it("2軸交差点とスクランブル交差点のフェーズサイクルが排他インターロック（全赤クリアランス・歩行者青点滅・赤＋右折矢印）を厳密に満たすことを保証する", () => {
    const standardTiming = IntersectionTimingConfigSchema.parse({
      greenSec: 16,
      pedBlinkSec: 4,
      yellowSec: 3,
      allRedSec: 2,
      rightArrowSec: 5,
      scramblePedGreenSec: 0,
      phaseOffsetSec: 0,
    });

    const seenPhases = new Set<string>();
    let sawPedBlink = false;
    let sawRightArrow = false;

    for (let t = 0; t <= 80; t += 0.5) {
      const state = TrafficSignalController.evaluateCycleAt(standardTiming, t);
      seenPhases.add(state.phaseName);

      // 安全不変式：直交2軸が同時に非赤（青・黄・右折矢印）になる瞬間はゼロであること
      const bothNonRed = state.axisA.vehicle !== "red" && state.axisB.vehicle !== "red";
      expect(bothNonRed, `t=${t}s phase=${state.phaseName}`).toBe(false);

      if (state.axisA.pedestrian === "green_blink" || state.axisB.pedestrian === "green_blink") {
        sawPedBlink = true;
      }
      if (state.axisA.vehicle === "red_right_arrow" || state.axisB.vehicle === "red_right_arrow") {
        sawRightArrow = true;
        // 右折矢印フェーズ中は歩行者信号が必ず赤であること
        expect(state.axisA.pedestrian).toBe("red");
        expect(state.axisB.pedestrian).toBe("red");
      }
    }

    expect(seenPhases.has("axis_a_green")).toBe(true);
    expect(seenPhases.has("axis_a_yellow")).toBe(true);
    expect(seenPhases.has("axis_a_right_arrow")).toBe(true);
    expect(seenPhases.has("all_red_a_to_b")).toBe(true);
    expect(seenPhases.has("axis_b_green")).toBe(true);
    expect(seenPhases.has("all_red_b_to_a")).toBe(true);
    expect(sawPedBlink).toBe(true);
    expect(sawRightArrow).toBe(true);

    // スクランブル交差点：全歩行者青フェーズ中は全車両が赤であること
    const scrambleTiming = IntersectionTimingConfigSchema.parse({
      greenSec: 14,
      pedBlinkSec: 4,
      yellowSec: 3,
      allRedSec: 2,
      rightArrowSec: 0,
      scramblePedGreenSec: 12,
      phaseOffsetSec: 0,
    });
    let sawScramblePhase = false;
    for (let t = 0; t <= 80; t += 0.5) {
      const state = TrafficSignalController.evaluateCycleAt(scrambleTiming, t);
      if (state.phaseName === "scramble_pedestrian_green") {
        sawScramblePhase = true;
        expect(state.axisA.vehicle).toBe("red");
        expect(state.axisB.vehicle).toBe("red");
        expect(
          state.scramblePedestrian === "green" || state.scramblePedestrian === "green_blink",
        ).toBe(true);
      }
    }
    expect(sawScramblePhase).toBe(true);
  });

  it("信号灯器ビルダーが適応アーム長・共有LEDキャッシュ・グロウハロー・違法同時点灯防止（青時は右折矢印消灯、red_right_arrow時のみ点灯）を満たすことを保証する", () => {
    expect(resolveAdaptiveArmLength(8.0)).toBe(2.9);
    expect(resolveAdaptiveArmLength(16.0)).toBe(4.1);
    expect(resolveAdaptiveArmLength(24.0)).toBe(5.0);

    const props = new RoadProps();
    const { group, handle } = props.createManagedTrafficLight(
      10,
      20,
      Math.PI,
      {
        activeSignal: "green",
        showArrowSignal: true,
        armLengthMeters: 5.0,
        hasDualPedestrianHeads: true,
        intersectionNameJa: "和田倉門・日比谷通り",
        intersectionNameEn: "Wadakuramon",
      },
      { id: "test_sig_0", intersectionId: "test_inter", axisGroup: "axis_a" },
    );

    expect(group.getObjectByName("PedestrianSignalHead")).toBeDefined();
    expect(group.getObjectByName("PedestrianSignalHead_Secondary")).toBeDefined();
    const greenLamp = group.getObjectByName("VehicleLamp_BlueGreen") as THREE.Mesh;
    const redLamp = group.getObjectByName("VehicleLamp_Red") as THREE.Mesh;
    const arrowLamp = group.getObjectByName("ArrowSignalLens") as THREE.Mesh;
    const greenGlow = group.getObjectByName("VehicleLampGlow_BlueGreen") as THREE.Mesh;
    const arrowGlow = group.getObjectByName("ArrowSignalGlow") as THREE.Mesh;

    // 1. 青信号時：青ランプ点灯＋グロウ表示、右折矢印は必ず消灯
    expect((greenLamp.material as THREE.MeshStandardMaterial).emissiveIntensity).toBeGreaterThan(
      2.0,
    );
    expect((greenLamp.material as THREE.MeshStandardMaterial).toneMapped).toBe(false);
    expect(greenGlow.visible).toBe(true);
    expect((arrowLamp.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(0);
    expect(arrowGlow.visible).toBe(false);

    // 2. red_right_arrow へ動的遷移：赤ランプ＋右折矢印のみ点灯、青ランプ消灯
    handle.applyAspect("red_right_arrow", "red", true);
    expect((greenLamp.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(0);
    expect(greenGlow.visible).toBe(false);
    expect((redLamp.material as THREE.MeshStandardMaterial).emissiveIntensity).toBeGreaterThan(2.0);
    expect((arrowLamp.material as THREE.MeshStandardMaterial).emissiveIntensity).toBeGreaterThan(
      2.0,
    );
    expect(arrowGlow.visible).toBe(true);

    // 3. 30基生成しても LED マテリアルは共有キャッシュ（<= 14個）に収まること
    for (let i = 0; i < 30; i++) {
      props.createManagedTrafficLight(i * 10, 0, 0, {
        activeSignal: i % 2 === 0 ? "green" : "red",
        includePointLight: false,
      });
    }
    expect(props.signalMaterials.getCachedLedMaterialCount()).toBeLessThanOrEqual(14);
  });

  it("JunctionTopology から日本式遠方左歩道信号配置（computeIntersectionSignalPlacements）が4方向すべて正しい位置・正対角・排他軸で算出されることを保証する", () => {
    const topo = resolveJunctionTopology({
      id: "Intersection_0_250",
      name: "Intersection_0_250",
      x: 0,
      z: 250,
      widthX: 26,
      depthZ: 32,
      lanesX: 2,
      lanesZ: 3,
      hasCrosswalks: true,
    });
    const placements = computeIntersectionSignalPlacements(topo);
    expect(placements.length).toBe(4);
    expect(resolveIntersectionDisplayName(0, 250).nameJa).toContain("和田倉門");

    const axisACount = placements.filter((p) => p.axisGroup === "axis_a").length;
    const axisBCount = placements.filter((p) => p.axisGroup === "axis_b").length;
    expect(axisACount).toBe(2);
    expect(axisBCount).toBe(2);

    // すべての支柱が交差点パッド外縁より外側へ配置されていること
    for (const p of placements) {
      const outsideX = Math.abs(p.x - topo.x) > topo.widthX * 0.5;
      const outsideZ = Math.abs(p.z - topo.z) > topo.depthZ * 0.5;
      expect(outsideX || outsideZ).toBe(true);
    }

    // 逆向き（歩道側へアーム張り出し）の候補角が alignSignalYawToRoadOverhang で車道側へ自動反転されること
    const roadLine = [
      { x: 0, z: -50 },
      { x: 0, z: 50 },
    ];
    // 西側歩道（x=-8）で rotY=π の場合、アーム (+X) は -X（歩道外側）を向くため 0（+X=車道側）へ反転する
    const fixedYaw = alignSignalYawToRoadOverhang(-8, 0, Math.PI, [roadLine]);
    expect(Math.cos(fixedYaw)).toBeGreaterThan(0.95);
    // すでに車道側（+X）を向く rotY=0 は維持される
    const keptYaw = alignSignalYawToRoadOverhang(-8, 0, 0, [roadLine]);
    expect(Math.cos(keptYaw)).toBeGreaterThan(0.95);
  });

  it("渋谷・東京駅丸の内全都市マップの交通信号システムが排他制御・違法点灯ゼロ・マテリアル共有・和田倉門交差点信号配置・リアルタイム更新を満たすことを保証する", async () => {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const scene = new THREE.Scene();
    const cityMap = new TokyoStationMap(scene, world, RAPIER, { deferGlbLoads: true });

    const controller = cityMap.getTrafficSignalController();
    const report = auditTrafficSignalSystem(scene, controller, {
      maxUniqueLedMaterials: 16,
      elevationSampler: sampleShibuyaTerrainY,
      elevationRegionFilter: (x) => x < -395,
      laneGraph: cityMap.getLaneGraph(),
    });

    expect(report.checkedSignals).toBeGreaterThanOrEqual(40);
    expect(report.checkedIntersections).toBeGreaterThanOrEqual(15);
    expect(report.uniqueLedMaterialCount).toBeLessThanOrEqual(16);
    expect(report.violations, JSON.stringify(report.violations, null, 2)).toEqual([]);
    expect(report.passed).toBe(true);

    // 行幸通り×日比谷通り（和田倉門交差点 x=0, z=250）に正規の交差点連動信号が配置されていること
    const wadakuraSummary = controller
      .getIntersectionSummaries()
      .find((s) => s.intersectionId === "Intersection_0_250");
    expect(wadakuraSummary).toBeDefined();
    expect(wadakuraSummary!.signalCount).toBeGreaterThanOrEqual(3);
    expect(wadakuraSummary!.axes).toContain("axis_a");
    expect(wadakuraSummary!.axes).toContain("axis_b");

    // 渋谷スクランブル交差点（-990.7, 275.8）にスクランブル専用フェーズが有効化されていること
    const scrambleSummary = controller.getIntersectionSummaries().find((s) => s.isScramble);
    expect(scrambleSummary).toBeDefined();
    expect(scrambleSummary!.timing.scramblePedGreenSec).toBeGreaterThan(0);

    // 時間を進めても全都市の排他不変式・単灯整合が保たれ続けること
    cityMap.updateTrafficSignals(0.2);
    controller.setElapsedSeconds(18.0);
    const reportMidCycle = auditTrafficSignalSystem(scene, controller, {
      maxUniqueLedMaterials: 16,
    });
    expect(reportMidCycle.violations).toEqual([]);
    expect(reportMidCycle.passed).toBe(true);
  }, 45_000);
});

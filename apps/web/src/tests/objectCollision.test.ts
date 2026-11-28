import { describe, it, expect } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { TokyoStationMap } from "../city/tokyoStationMap";
import { VehiclePhysics } from "../physics/vehicle";
import { sampleShibuyaTerrainY } from "../openData/gsiPlateauLoader";
import {
  createGlbGroundSliceColliders,
  extractGroundLevelCollisionTriangles,
} from "../physics/meshColliderBuilder";

function hasActiveObstacleNear(
  world: RAPIER.World,
  obstacleHandles: ReadonlySet<number>,
  x: number,
  y: number,
  z: number,
  halfExtentXZ = 0.6,
  halfExtentY = 1.0,
): boolean {
  let found = false;
  const probe = new RAPIER.Cuboid(halfExtentXZ, halfExtentY, halfExtentXZ);
  world.intersectionsWithShape({ x, y, z }, { x: 0, y: 0, z: 0, w: 1 }, probe, (col) => {
    if (obstacleHandles.has(col.handle) && col.isEnabled()) {
      found = true;
      return false;
    }
    return true;
  });
  return found;
}

describe("都市・道路オブジェクト全域の当たり判定保証", () => {
  it("渋谷の信号機・ハチ公広場・JRガード下壁/橋脚・バスシェルター・センター街・沿道ビル群のすべてに有効な障害物コライダーが付与されていることを保証する", async () => {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const scene = new THREE.Scene();
    const cityMap = new TokyoStationMap(scene, world, RAPIER, { deferGlbLoads: true });
    scene.updateMatrixWorld(true);
    world.step();

    const obstacleHandles = new Set(cityMap.obstacleColliderHandles);
    const wp = new THREE.Vector3();

    // 1. 渋谷交差点の信号機全基に支柱コライダーが付与されていること
    const shibuyaSignals: Array<{ x: number; y: number; z: number }> = [];
    cityMap.group.traverse((obj) => {
      if (obj.name === "JapaneseTrafficSignalGroup" && obj.position.x < -395) {
        obj.getWorldPosition(wp);
        shibuyaSignals.push({ x: wp.x, y: wp.y, z: wp.z });
      }
    });
    expect(shibuyaSignals.length).toBeGreaterThanOrEqual(12);
    for (const sig of shibuyaSignals) {
      expect(
        hasActiveObstacleNear(world, obstacleHandles, sig.x, sig.y + 1.5, sig.z, 0.35, 1.0),
        `Shibuya signal at (${sig.x.toFixed(1)}, ${sig.z.toFixed(1)}) has collider`,
      ).toBe(true);
    }

    // 2. ハチ公広場（忠犬ハチ公像・プランター3基・ベンチ3基・LED照明灯3基・JRキャノピー柱4本・バスターミナルシェルター2基）
    const hachikoStatue = scene.getObjectByName("ShibuyaHachikoStatueMonument")!;
    expect(hachikoStatue).toBeDefined();
    hachikoStatue.getWorldPosition(wp);
    expect(hasActiveObstacleNear(world, obstacleHandles, wp.x, wp.y + 0.9, wp.z, 0.5, 0.8)).toBe(
      true,
    );

    for (let i = 0; i < 3; i += 1) {
      const planter = scene.getObjectByName(`HachikoPlanter_${i}`)!;
      expect(planter).toBeDefined();
      planter.getWorldPosition(wp);
      expect(
        hasActiveObstacleNear(world, obstacleHandles, wp.x + 1.6, wp.y, wp.z, 0.4, 0.5),
        `HachikoPlanter_${i} outer rim has collider`,
      ).toBe(true);

      const bench = scene.getObjectByName(`HachikoBench_${i}`)!;
      expect(bench).toBeDefined();
      bench.getWorldPosition(wp);
      expect(
        hasActiveObstacleNear(world, obstacleHandles, wp.x, wp.y + 0.25, wp.z, 0.4, 0.35),
        `HachikoBench_${i} has collider`,
      ).toBe(true);
    }

    for (const shelterName of [
      "ShibuyaBusTerminalShelter_Hachiko",
      "ShibuyaBusTerminalShelter_EastExit",
    ]) {
      const shelter = scene.getObjectByName(shelterName)!;
      expect(shelter).toBeDefined();
      shelter.getWorldPosition(wp);
      expect(
        hasActiveObstacleNear(world, obstacleHandles, wp.x, wp.y + 1.2, wp.z, 0.6, 0.8),
        `${shelterName} registered as obstacle collider`,
      ).toBe(true);
    }

    // 3. JR渋谷駅ガード下の化粧壁および橋脚に障害物コライダーが付与されていること
    let jrWallChecked = 0;
    let jrPierChecked = 0;
    cityMap.group.traverse((obj) => {
      if (obj.name === "RoadInfra_JrGuardUnderpassWall") {
        obj.getWorldPosition(wp);
        expect(
          hasActiveObstacleNear(world, obstacleHandles, wp.x, wp.y, wp.z, 0.8, 1.5),
          `JR guard wall at (${wp.x.toFixed(1)}, ${wp.z.toFixed(1)}) has collider`,
        ).toBe(true);
        jrWallChecked += 1;
      } else if (obj.name === "RoadInfra_JrGuardPier") {
        obj.getWorldPosition(wp);
        expect(
          hasActiveObstacleNear(world, obstacleHandles, wp.x, wp.y, wp.z, 0.8, 1.5),
          `JR guard pier at (${wp.x.toFixed(1)}, ${wp.z.toFixed(1)}) has collider`,
        ).toBe(true);
        jrPierChecked += 1;
      }
    });
    expect(jrWallChecked).toBeGreaterThanOrEqual(2);
    expect(jrPierChecked).toBeGreaterThanOrEqual(2);

    // 4. センター街入口アーチ支柱（左右2本）および商業ビル群・沿道ビル群がすべて障害物登録されていること
    const centerGaiArch = scene.getObjectByName("CenterGaiEntranceArchSign")!;
    expect(centerGaiArch).toBeDefined();
    let archPillarsWithCollider = 0;
    centerGaiArch.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry.type === "CylinderGeometry") {
        child.getWorldPosition(wp);
        if (hasActiveObstacleNear(world, obstacleHandles, wp.x, wp.y, wp.z, 0.4, 1.5)) {
          archPillarsWithCollider += 1;
        }
      }
    });
    expect(archPillarsWithCollider).toBe(2);

    for (const bldgName of [
      "CenterGaiCommercialBuilding_North_1",
      "CenterGaiCommercialBuilding_South_1",
      "KoenEast_MaruiSouth",
      "DogenzakaSouth_CornerBlock",
      "MiyamasuSouth_WestBlock",
    ]) {
      const bMesh = scene.getObjectByName(bldgName)!;
      expect(bMesh, `${bldgName} exists`).toBeDefined();
      bMesh.getWorldPosition(wp);
      const gy = sampleShibuyaTerrainY(wp.x, wp.z);
      expect(
        hasActiveObstacleNear(world, obstacleHandles, wp.x, gy + 1.5, wp.z, 1.0, 1.2),
        `${bldgName} registered as obstacle collider`,
      ).toBe(true);
    }

    // 5. 109前三角広場の縁石にコライダーが付与されていること
    const curbNose = scene.getObjectByName("Shibuya109TriangularPlazaCurb_0")!;
    expect(curbNose).toBeDefined();
    curbNose.getWorldPosition(wp);
    expect(hasActiveObstacleNear(world, obstacleHandles, wp.x, wp.y, wp.z, 0.3, 0.3)).toBe(true);
  }, 45_000);

  it("GLB 地上帯 Trimesh コライダー生成が頭上桁を通過可能としつつ地上壁面で車両を確実に阻止し、GLB 切替時も当たり判定が消失しないことを保証する", async () => {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(200, 0.5, 200).setTranslation(0, -0.5, 0).setFriction(0.95),
    );

    // 疑似 GLB シーン:
    // - 地上壁 (z = 12m, y = 0..10m): 衝突すべき実体壁
    // - 頭上歩道橋デッキ (z = 6m, y = 6.5..7.5m): 車両は下を通過できるべき
    // - Proxy タイル (isPlateauProxy = true): コライダー生成から除外されるべき
    const mockGlbRoot = new THREE.Group();
    const groundWall = new THREE.Mesh(
      new THREE.BoxGeometry(8, 10, 1.2),
      new THREE.MeshBasicMaterial(),
    );
    groundWall.name = "MockLandmarkWall";
    groundWall.position.set(0, 5, 12);
    mockGlbRoot.add(groundWall);

    const overheadBridgeDeck = new THREE.Mesh(
      new THREE.BoxGeometry(12, 1.0, 4.0),
      new THREE.MeshBasicMaterial(),
    );
    overheadBridgeDeck.name = "MockOverheadPedestrianDeck";
    overheadBridgeDeck.position.set(0, 7.0, 6);
    mockGlbRoot.add(overheadBridgeDeck);

    const proxyTile = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 6), new THREE.MeshBasicMaterial());
    proxyTile.name = "PlateauProxyTile_mock";
    proxyTile.userData.isPlateauProxy = true;
    proxyTile.position.set(0, 3, 4);
    mockGlbRoot.add(proxyTile);

    const extracted = extractGroundLevelCollisionTriangles(mockGlbRoot, {
      getGroundY: () => 0,
      roadCorridors: [],
    });
    // 地上壁のみ抽出（頭上デッキ y=7m と Proxy タイルは除外される）
    expect(extracted.triangleCount).toBeGreaterThanOrEqual(8);
    expect(extracted.triangleCount).toBeLessThanOrEqual(12);

    const created = createGlbGroundSliceColliders(mockGlbRoot, world, RAPIER, {
      getGroundY: () => 0,
      roadCorridors: [],
    });
    expect(created.colliders).toHaveLength(1);

    // 実車で走行テスト: z=0 から発進 → z=4 の Proxy・z=6 の頭上歩道橋下を問題なく通過し、z=12 の GLB 壁で確実に停止する
    const vehicle = new VehiclePhysics(world, RAPIER, new THREE.Vector3(0, 0.622, 0));
    vehicle.setObstacleColliderHandles(created.colliders.map((c) => c.handle));

    for (let i = 0; i < 240; i += 1) {
      vehicle.update(1 / 60, { throttle: 1.0, brake: 0, steer: 0, handbrake: false });
      world.timestep = 1 / 60;
      world.step();
    }
    const finalState = vehicle.getState();
    // z=6 の頭上橋下は通過している (z > 7.5) が、z=12 の壁 (前面 z=11.4, 車体半長 2.32 => z ≈ 9.08) はすり抜けない
    expect(finalState.position.z).toBeGreaterThan(7.5);
    expect(finalState.position.z).toBeLessThan(10.0);
    expect(finalState.speedKmh).toBeLessThan(5.0);

    // TokyoStationMap の GLB コライダー切替および onObstacleCollidersChanged 通知検証
    const mapWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const mapScene = new THREE.Scene();
    const cityMap = new TokyoStationMap(mapScene, mapWorld, RAPIER, { deferGlbLoads: true });
    let notifiedCount = 0;
    let lastNotifiedHandlesLen = 0;
    cityMap.onObstacleCollidersChanged = (handles) => {
      notifiedCount += 1;
      lastNotifiedHandlesLen = handles.length;
    };
    const countBefore = cityMap.obstacleColliderHandles.length;
    const glbTriCount = cityMap.attachShibuyaStreamGlbColliders(mockGlbRoot, true);
    expect(glbTriCount).toBeGreaterThanOrEqual(8);
    expect(notifiedCount).toBe(1);
    expect(lastNotifiedHandlesLen).toBe(countBefore + 1);
  }, 45_000);
});

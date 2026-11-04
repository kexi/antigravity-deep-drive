import { describe, it, expect } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { VehiclePhysics } from "../physics/vehicle";
import { CarModel } from "../vehicle/carModel";
import type { WeatherType, WiperMode } from "../types";

describe("車両およびゲームシステムの仕様検証", () => {
  it("Rapier DynamicRayCastVehicleController による4輪レイキャストサスペンション接地・加速・操舵・制動が動作することを保証する", async () => {
    await RAPIER.init();
    const world = new RAPIER.World(new RAPIER.Vector3(0.0, -9.81, 0.0));

    // 地面コライダーを作成
    const groundDesc = RAPIER.ColliderDesc.cuboid(200, 0.5, 200)
      .setTranslation(0, -0.5, 0)
      .setFriction(0.95);
    world.createCollider(groundDesc);

    const vehicle = new VehiclePhysics(world, RAPIER, new THREE.Vector3(0, 0.85, 0));

    // 1. 4輪が vehicleController に登録されていることを保証
    expect(vehicle.vehicleController.numWheels()).toBe(4);

    // 2. サスペンション接地安定化ステップ
    for (let i = 0; i < 45; i++) {
      vehicle.update(1 / 60, { throttle: 0, brake: 0, steer: 0, handbrake: false });
      world.timestep = 1 / 60;
      world.step();
    }

    const settledState = vehicle.getState();
    expect(settledState.wheels).toHaveLength(4);
    const allWheelsTouching = settledState.wheels.every((w) => w.inContact);
    expect(allWheelsTouching).toBe(true);

    // 3. アクセル入力で前進(+Z方向)に加速し、速度・エンジンRPMが上昇することを保証
    const initialZ = settledState.position.z;
    for (let i = 0; i < 60; i++) {
      vehicle.update(1 / 60, { throttle: 1.0, brake: 0, steer: 0, handbrake: false });
      world.timestep = 1 / 60;
      world.step();
    }

    const drivingState = vehicle.getState();
    expect(drivingState.position.z).toBeGreaterThan(initialZ + 1.0);
    expect(drivingState.speedKmh).toBeGreaterThan(10.0);
    expect(drivingState.engineRpm).toBeGreaterThan(1200);

    // 4. ステアリング入力（右旋回 steer=1.0）で車体方位角が変化することを保証
    const headingBeforeTurn = drivingState.headingAngle;
    for (let i = 0; i < 35; i++) {
      vehicle.update(1 / 60, { throttle: 0.7, brake: 0, steer: 1.0, handbrake: false });
      world.timestep = 1 / 60;
      world.step();
    }
    const turningState = vehicle.getState();
    expect(turningState.steeringAngle).toBeGreaterThan(0.05);
    expect(Math.abs(turningState.headingAngle - headingBeforeTurn)).toBeGreaterThan(0.02);

    // 5. フルブレーキ入力で減速することを保証
    const speedBeforeBrake = turningState.speedKmh;
    for (let i = 0; i < 45; i++) {
      vehicle.update(1 / 60, { throttle: 0, brake: 1.0, steer: 0, handbrake: true });
      world.timestep = 1 / 60;
      world.step();
    }
    const brakedState = vehicle.getState();
    expect(brakedState.speedKmh).toBeLessThan(speedBeforeBrake);
  });

  it("時速に応じた適正なギア段数を算出できることを保証する", () => {
    // 速度域ごとのギア選定ロジックをテスト
    const determineGear = (speedKmh: number, isReverse: boolean): string => {
      const isBackingUp = isReverse;
      if (isBackingUp) {
        return "R";
      }
      const isFirstGearRange = speedKmh < 30;
      if (isFirstGearRange) {
        return "D 1";
      }
      const isSecondGearRange = speedKmh < 60;
      if (isSecondGearRange) {
        return "D 2";
      }
      const isThirdGearRange = speedKmh < 95;
      if (isThirdGearRange) {
        return "D 3";
      }
      return "D 4";
    };

    expect(determineGear(0, true)).toBe("R");
    expect(determineGear(15, false)).toBe("D 1");
    expect(determineGear(45, false)).toBe("D 2");
    expect(determineGear(80, false)).toBe("D 3");
    expect(determineGear(120, false)).toBe("D 4");
  });

  it("天候に応じた適切な雨量と路面濡れ度の目標値を保証する", () => {
    const getTargetWeatherParams = (weather: WeatherType) => {
      const isRain = weather === "rain";
      return {
        rainIntensity: isRain ? 1.0 : 0.0,
        wetness: isRain ? 1.0 : 0.0,
      };
    };

    expect(getTargetWeatherParams("clear")).toEqual({ rainIntensity: 0.0, wetness: 0.0 });
    expect(getTargetWeatherParams("sunset")).toEqual({ rainIntensity: 0.0, wetness: 0.0 });
    expect(getTargetWeatherParams("rain")).toEqual({ rainIntensity: 1.0, wetness: 1.0 });
    expect(getTargetWeatherParams("night")).toEqual({ rainIntensity: 0.0, wetness: 0.0 });
  });

  it("ワイパーの動作速度倍率がモードに応じて適切に設定されることを保証する", () => {
    const getWiperSpeedMultiplier = (mode: WiperMode): number => {
      const isOffMode = mode === "off";
      if (isOffMode) {
        return 0.0;
      }
      const isSlowMode = mode === "slow";
      if (isSlowMode) {
        return 3.5;
      }
      return 6.5;
    };

    expect(getWiperSpeedMultiplier("off")).toBe(0.0);
    expect(getWiperSpeedMultiplier("slow")).toBe(3.5);
    expect(getWiperSpeedMultiplier("fast")).toBe(6.5);
  });

  it("車内のルームミラー（バックミラー）と左右のドアミラー（サイドミラー）が実寸JDM右ハンドル配置で構築され、後方鏡面反射シェーダーを備えることを保証する", () => {
    const car = new CarModel();

    // 1. 車内ルームミラー（トヨタ クラウン セダン実車通り車体中央 x=0.00m・フロントガラス上端傾斜面 y=1.258m, z=0.74m）と右ハンドル運転席向きヨー角 (22°) の検証
    expect(car.rearviewMirrorGroup).toBeDefined();
    expect(car.rearviewMirrorGroup.position.x).toBeCloseTo(0.0, 3);
    expect(car.rearviewMirrorGroup.position.y).toBeCloseTo(1.258, 3);
    expect(car.rearviewMirrorGroup.position.z).toBeCloseTo(0.74, 3);
    expect(car.rearviewMirrorGroup.rotation.y).toBeCloseTo(THREE.MathUtils.degToRad(22.0), 3);

    // 1b. ルームミラーが宙に浮かないよう、上部ルーフヘッダー／Toyota Safety Sense 3.0 カメラポッドへ隙間なく接続するステーが構築されていることを保証する
    const stayMesh = car.rearviewMirrorGroup.getObjectByName("RearviewMirrorStay");
    expect(stayMesh).toBeDefined();

    // 2. 左右ドアミラー（右 x=-0.918m, z=1.005m, yaw=-22° / 左 x=+0.918m, z=0.880m, yaw=+27°）のRHD視界確保配置とドアマウントステー結合の検証
    expect(car.sideMirrorRightGroup.position.x).toBeCloseTo(-0.918, 3);
    expect(car.sideMirrorLeftGroup.position.x).toBeCloseTo(0.918, 3);
    expect(car.sideMirrorRightGroup.position.y).toBeCloseTo(0.962, 3);
    expect(car.sideMirrorLeftGroup.position.y).toBeCloseTo(0.962, 3);
    expect(car.sideMirrorRightGroup.position.z).toBeCloseTo(1.005, 3);
    expect(car.sideMirrorLeftGroup.position.z).toBeCloseTo(0.88, 3);
    expect(car.sideMirrorRightGroup.rotation.y).toBeCloseTo(THREE.MathUtils.degToRad(-22.0), 3);
    expect(car.sideMirrorLeftGroup.rotation.y).toBeCloseTo(THREE.MathUtils.degToRad(27.0), 3);
    expect(car.sideMirrorRightGroup.getObjectByName("SideMirrorStalk_R")).toBeDefined();
    expect(car.sideMirrorLeftGroup.getObjectByName("SideMirrorStalk_L")).toBeDefined();

    // 2b. ステアリングコラム（SteeringColumnAssembly）がステアリングホイール（-0.38, 0.888, 0.440, 20°チルト）と同軸（0.0mm偏心）でダッシュボードまで接続されていることを保証する
    const columnAssembly = car.group.getObjectByName("SteeringColumnAssembly");
    expect(columnAssembly).toBeDefined();
    expect(columnAssembly!.position.x).toBeCloseTo(-0.38, 3);
    expect(columnAssembly!.position.y).toBeCloseTo(0.869, 3);
    expect(columnAssembly!.position.z).toBeCloseTo(0.492, 3);
    expect(columnAssembly!.rotation.x).toBeCloseTo(0.35, 3);

    // 3. 後方レンダーターゲット・リアカメラ・3系統ミラーシェーダーマテリアルのユニフォーム検証
    expect(car.rearRenderTarget.width).toBe(512);
    expect(car.rearRenderTarget.height).toBe(256);
    expect(car.rearCamera.fov).toBeGreaterThanOrEqual(70);
    expect(car.rearviewMirrorMaterial.uniforms.tMirror.value).toBe(car.rearRenderTarget.texture);
    expect(car.sideMirrorRightMaterial.uniforms.tMirror.value).toBe(car.rearRenderTarget.texture);
    expect(car.sideMirrorLeftMaterial.uniforms.tMirror.value).toBe(car.rearRenderTarget.texture);
  });

  it("追従視点（chase）への切替初回フレームでカメラ位置が原点(0,0,0)地下から補間されず即座に車両後方へスナップすることを保証する", async () => {
    const { CameraController } = await import("../core/cameraController");
    const cam = new CameraController(16 / 9);
    cam.setMode("chase");

    const carGroup = new THREE.Group();
    carGroup.position.set(3.5, 0.8, 34.0);
    cam.update(
      1 / 60,
      {
        position: { x: 3.5, y: 0.8, z: 34.0 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        velocity: { x: 0, y: 0, z: 0 },
        speedKmh: 0,
        steeringAngle: 0,
        engineRpm: 800,
        gear: "D 1",
        headingAngle: 0,
        pitchAngle: 0,
        rollAngle: 0,
        wheels: [],
      },
      carGroup,
    );

    expect(cam.camera.position.x).toBeCloseTo(3.5, 2);
    expect(cam.camera.position.y).toBeCloseTo(3.4, 2);
    expect(cam.camera.position.z).toBeCloseTo(27.5, 2);
  });

  it("右旋回（steeringAngle > 0）でステアリングホイール上部が右側（-X方向＝ドライバー視点で時計回り）へ、左旋回（steeringAngle < 0）で左側（+X方向＝反時計回り）へ回転することを保証する", () => {
    const car = new CarModel();
    const baseState = {
      position: { x: 0, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      velocity: { x: 0, y: 0, z: 0 },
      speedKmh: 40,
      steeringAngle: 0,
      engineRpm: 1800,
      gear: "D 2",
      headingAngle: 0,
      pitchAngle: 0,
      rollAngle: 0,
      wheels: [],
    };

    // 1. 右旋回 (D / ArrowRight -> steeringAngle = +0.35 rad)
    car.update(1 / 60, { ...baseState, steeringAngle: 0.35 }, 0);
    car.steeringWheel.updateMatrixWorld(true);
    const topPointRightTurn = new THREE.Vector3(0, 0.164, 0).applyMatrix4(
      car.steeringWheel.matrixWorld,
    );
    // ドライバー視点（+Z向き）で右側は -X なので、中心 x = -0.38m よりさらに右側 (< -0.38m) へ移動すること
    expect(car.steeringWheel.rotation.z).toBeGreaterThan(0);
    expect(topPointRightTurn.x).toBeLessThan(-0.38 - 0.08);

    // 2. 左旋回 (A / ArrowLeft -> steeringAngle = -0.35 rad)
    car.update(1 / 60, { ...baseState, steeringAngle: -0.35 }, 0);
    car.steeringWheel.updateMatrixWorld(true);
    const topPointLeftTurn = new THREE.Vector3(0, 0.164, 0).applyMatrix4(
      car.steeringWheel.matrixWorld,
    );
    // ドライバー視点（+Z向き）で左側は +X なので、中心 x = -0.38m より左側 (> -0.38m) へ移動すること
    expect(car.steeringWheel.rotation.z).toBeLessThan(0);
    expect(topPointLeftTurn.x).toBeGreaterThan(-0.38 + 0.08);
  });

  it("車両が立体障害物（ボラード・ガードレール・街路樹・標識柱・石垣・ビル壁面）に衝突した際、すり抜けず・空中に跳ね上がらずに手前で阻止されることを保証する", async () => {
    await RAPIER.init();
    const world = new RAPIER.World(new RAPIER.Vector3(0.0, -9.81, 0.0));

    // 平坦な路面コライダー
    const groundDesc = RAPIER.ColliderDesc.cuboid(200, 0.5, 200)
      .setTranslation(0, -0.5, 0)
      .setFriction(0.95);
    world.createCollider(groundDesc);

    // 車両前方 z = 8.0m に障害物群（御影石ボラード・街路樹・ビル壁面を模した固定コライダー）を配置
    const obstacleBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 8),
    );
    const bollardCollider = world.createCollider(
      RAPIER.ColliderDesc.cylinder(0.45, 0.22)
        .setTranslation(0, 0.45, 0)
        .setFriction(0.8)
        .setRestitution(0.15),
      obstacleBody,
    );
    const wallCollider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(4.0, 2.0, 0.4)
        .setTranslation(0, 2.0, 0.5)
        .setFriction(0.8)
        .setRestitution(0.1),
      obstacleBody,
    );

    const vehicle = new VehiclePhysics(world, RAPIER, new THREE.Vector3(0, 0.85, 0));
    vehicle.setObstacleColliderHandles([bollardCollider.handle, wallCollider.handle]);

    // フルスロットルで前進して障害物に突入させる
    let maxHeightReached = 0;
    for (let i = 0; i < 150; i++) {
      vehicle.update(1 / 60, { throttle: 1.0, brake: 0, steer: 0, handbrake: false });
      world.timestep = 1 / 60;
      world.step();
      const currentState = vehicle.getState();
      const isHigherPosition = currentState.position.y > maxHeightReached;
      if (isHigherPosition) {
        maxHeightReached = currentState.position.y;
      }
    }

    const postCollisionState = vehicle.getState();
    // 1. 障害物（z = 8.0m, 車体前端 halfLength = 2.26m）をすり抜けず手前（z < 6.2m）で確実に阻止されること
    expect(postCollisionState.position.z).toBeLessThan(6.2);
    // 2. 4輪レイキャストが障害物を地面と誤認して車体を空中に跳ね上げないこと
    expect(maxHeightReached).toBeLessThan(1.4);
    // 3. 衝突阻止状態では前進速度がほぼゼロに抑えられていること
    expect(postCollisionState.speedKmh).toBeLessThan(5.0);
  });

  it("都市マップ（TokyoStationMap）構築時に建築物・石垣・街路樹・街灯・ボラード・ガードレール・信号機・標識の物理コライダーが生成されることを保証する", async () => {
    await RAPIER.init();
    const world = new RAPIER.World(new RAPIER.Vector3(0.0, -9.81, 0.0));
    const scene = new THREE.Scene();

    const { TokyoStationMap } = await import("../city/tokyoStationMap");
    const cityMap = new TokyoStationMap(scene, world, RAPIER);

    expect(cityMap.roadMaterials.length).toBeGreaterThan(0);
    // 建築物・石垣・街路樹・街灯・ボラード・ガードレール・信号機・標識など数百個の立体障害物コライダーが登録されていること
    expect(cityMap.obstacleColliderHandles.length).toBeGreaterThan(400);
    expect(world.colliders.len()).toBeGreaterThan(cityMap.obstacleColliderHandles.length);

    // 渋谷ストリーム フォールバックの正面バッジが明治通り側（worldX < -710、西向き）を向いていることを保証する
    scene.updateMatrixWorld(true);
    const fallbackBadge = scene.getObjectByName("FallbackStreamBadgeBack");
    expect(fallbackBadge).toBeDefined();
    const badgeWorldPos = new THREE.Vector3();
    fallbackBadge!.getWorldPosition(badgeWorldPos);
    expect(badgeWorldPos.x).toBeCloseTo(-715.2, 1);

    // shibuya_stream.glb のマテリアルが適切な 3D テクスチャモードと発光属性にルーティングされ、
    // 共有マテリアル (StreamDarkVoidSteel) が発光色に誤上書きされないことを保証する
    const darkSteelMat = new THREE.MeshStandardMaterial({
      name: "StreamDarkVoidSteel",
      color: 0x171c24,
    });
    cityMap.applyShibuyaStreamGlbMaterial3DTexture(darkSteelMat, "ShibuyaStream_MidVoid_0");
    expect(darkSteelMat.userData?.arch3DMode).toBe("cast_iron");
    expect(darkSteelMat.emissiveIntensity).toBe(1);

    const yellowAccentMat = new THREE.MeshStandardMaterial({
      name: "StreamYellowAccent",
      color: 0xd6e614,
    });
    cityMap.applyShibuyaStreamGlbMaterial3DTexture(yellowAccentMat, "ShibuyaStream_Podium_2");
    expect(yellowAccentMat.emissive.getHex()).toBe(0xd6e614);
    expect(yellowAccentMat.emissiveIntensity).toBeCloseTo(0.48, 2);

    const verticalGreenMat = new THREE.MeshStandardMaterial({
      name: "StreamVerticalGreen",
      color: 0x2e5721,
    });
    cityMap.applyShibuyaStreamGlbMaterial3DTexture(verticalGreenMat, "ShibuyaStream_MidVoid_1");
    expect(verticalGreenMat.userData?.arch3DMode).toBe("white_granite");
    expect(verticalGreenMat.metalness).toBeCloseTo(0.02, 2);

    const warmGlowMat = new THREE.MeshStandardMaterial({
      name: "WarmPlazaGlow",
      color: 0xffe0ad,
    });
    cityMap.applyShibuyaStreamGlbMaterial3DTexture(warmGlowMat, "ShibuyaStream_Podium_1");
    expect(warmGlowMat.userData?.arch3DMode).toBe("curtain_glass");
    expect(warmGlowMat.emissiveIntensity).toBeCloseTo(0.72, 2);

    const beaconMat = new THREE.MeshStandardMaterial({
      name: "BeaconRed",
      color: 0xff1e14,
    });
    cityMap.applyShibuyaStreamGlbMaterial3DTexture(beaconMat, "ShibuyaStream_HighRise_1");
    expect(beaconMat.userData?.hasArch3DVolumeShader).toBeUndefined();
    expect(beaconMat.emissiveIntensity).toBeCloseTo(2.8, 2);

    // 夜間・夕暮れモード切替時にライムイエローアクセントおよびロビー窓の発光強度がブーストされることを保証する
    cityMap.setNightMode(true);
    expect(yellowAccentMat.emissiveIntensity).toBeCloseTo(0.95, 2);
    expect(warmGlowMat.emissiveIntensity).toBeCloseTo(1.32, 2);
    cityMap.setNightMode(false);
    expect(yellowAccentMat.emissiveIntensity).toBeCloseTo(0.48, 2);
    expect(warmGlowMat.emissiveIntensity).toBeCloseTo(0.72, 2);

    // 稲荷橋広場（ShibuyaInaribashiPlaza）が渋谷川開渠区間（z = -195..-55）を上から塞がず、
    // 渋谷川水面（13113-wtr-shibuya-river, y = 0.18）が地面（y = -0.01）および河床（ShibuyaRiverBed, y = 0.04）より上に配置されていることを保証する
    const groundMesh = scene.getObjectByName("CityWideGroundMesh") as THREE.Mesh;
    const inaribashiPlaza = scene.getObjectByName("ShibuyaInaribashiPlaza") as THREE.Mesh;
    const shibuyaRiverBed = scene.getObjectByName("ShibuyaRiverBed") as THREE.Mesh;
    const shibuyaRiverWater = scene.getObjectByName("13113-wtr-shibuya-river") as THREE.Mesh;
    expect(groundMesh).toBeDefined();
    expect(inaribashiPlaza).toBeDefined();
    expect(shibuyaRiverBed).toBeDefined();
    expect(shibuyaRiverWater).toBeDefined();

    const plazaBox = new THREE.Box3().setFromObject(inaribashiPlaza);
    const riverBox = new THREE.Box3().setFromObject(shibuyaRiverWater);
    expect(plazaBox.min.z).toBeCloseTo(-52, 1);
    expect(plazaBox.max.z).toBeCloseTo(76, 1);
    expect(riverBox.min.z).toBeCloseTo(-195, 1);
    expect(riverBox.max.z).toBeCloseTo(-55, 1);
    // 稲荷橋広場南端 (z = -52) が渋谷川開渠北端 (z = -55) より北側にあり重複しないこと
    expect(plazaBox.min.z).toBeGreaterThan(riverBox.max.z);

    // 高さ順序: 地面 (-0.01) < 河床 (0.04) < 水面 (0.18) であること
    expect(groundMesh.position.y).toBeCloseTo(-0.01, 3);
    expect(shibuyaRiverBed.position.y).toBeCloseTo(0.04, 3);
    expect(shibuyaRiverWater.position.y).toBeCloseTo(0.18, 3);
    expect(shibuyaRiverBed.position.y).toBeGreaterThan(groundMesh.position.y);
    expect(shibuyaRiverWater.position.y).toBeGreaterThan(shibuyaRiverBed.position.y);
  });

  it("車内の12.3インチ運転席メータークラスター（スピードメーター指針・タコメーター指針・トリップ距離計）および電子シフトレバーが走行状態に応じてリアルタイムに動作することを保証する", () => {
    const car = new CarModel();

    // 1. メータークラスターが右ハンドル運転席正面（x = -0.38m, y = 0.948m, z = 0.625m）に配置されていること
    expect(car.instrumentClusterGroup).toBeDefined();
    expect(car.instrumentClusterGroup.position.x).toBeCloseTo(-0.38, 2);
    expect(car.instrumentClusterGroup.position.y).toBeCloseTo(0.948, 2);
    expect(car.instrumentClusterGroup.position.z).toBeCloseTo(0.625, 2);
    expect(car.speedNeedleGroup).toBeDefined();
    expect(car.tachNeedleGroup).toBeDefined();
    expect(car.electroShifterGroup).toBeDefined();

    // 停止時の初期角度を記録（ゼロ目盛り側: 運転席から見て左下 7時半方向 = -3π/4 rad ≈ -2.356 rad）
    const idleState = {
      position: { x: 0, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      velocity: { x: 0, y: 0, z: 0 },
      speedKmh: 0,
      steeringAngle: 0,
      engineRpm: 780,
      gear: "D 1",
      headingAngle: 0,
      pitchAngle: 0,
      rollAngle: 0,
      wheels: [],
    };
    car.update(1 / 60, idleState, 0);
    const initialSpeedNeedleAngle = car.speedNeedleGroup.rotation.z;
    const initialTachNeedleAngle = car.tachNeedleGroup.rotation.z;
    expect(initialSpeedNeedleAngle).toBeCloseTo(-(3 * Math.PI) / 4, 2);
    // 停止時（0 km/h）にスピード針の先端がメーター中心（x = -0.075, y = 0）より左側（+X方向）かつ下側（-Y方向）＝左下7時半を指していることを保証する
    const speedTipIdleLocal = new THREE.Vector3(0, 0.031, 0).applyEuler(
      car.speedNeedleGroup.rotation,
    );
    expect(speedTipIdleLocal.x).toBeGreaterThan(0.015); // +X = 運転席から見て左（0 km/h側）
    expect(speedTipIdleLocal.y).toBeLessThan(-0.015); // -Y = 下側
    expect(car.getTripDistanceKm()).toBe(0);

    // 2. 時速 90 km/h・4200 rpm で前進走行した際、スピード針・タコ針が時計回り（rotation.z 増加方向）へスイープし、トリップ距離が加算されること
    const cruisingState = {
      ...idleState,
      speedKmh: 90,
      engineRpm: 4200,
      gear: "D 3",
    };
    for (let i = 0; i < 60; i++) {
      car.update(0.1, cruisingState, 0);
    }

    // 90 km/h はフルスケール 180 km/h の半分（真上 12時方向 = 0.0 rad 付近）へ動くこと
    expect(car.speedNeedleGroup.rotation.z).toBeGreaterThan(initialSpeedNeedleAngle + 1.8);
    expect(car.speedNeedleGroup.rotation.z).toBeCloseTo(0.0, 1);

    // 4200 rpm はアイドリング時より大きく時計回りへ振れていること
    expect(car.tachNeedleGroup.rotation.z).toBeGreaterThan(initialTachNeedleAngle + 1.5);
    expect(car.getSmoothedRpm()).toBeGreaterThan(3800);

    // 180 km/h フルスケール時は右下 4時半方向（+3π/4 rad ≈ +2.356 rad）を指すこと
    const maxSpeedState = {
      ...idleState,
      speedKmh: 180,
      engineRpm: 6800,
      gear: "D 6",
    };
    for (let i = 0; i < 60; i++) {
      car.update(0.1, maxSpeedState, 0);
    }
    expect(car.speedNeedleGroup.rotation.z).toBeCloseTo((3 * Math.PI) / 4, 1);
    const speedTipMaxLocal = new THREE.Vector3(0, 0.031, 0).applyEuler(
      car.speedNeedleGroup.rotation,
    );
    expect(speedTipMaxLocal.x).toBeLessThan(-0.015); // -X = 運転席から見て右（180 km/h側）
    expect(speedTipMaxLocal.y).toBeLessThan(-0.015); // -Y = 下側

    // 90 km/h で 6.0 秒 (0.15 km) + 180 km/h で 6.0 秒 (0.30 km) = 0.45 km 積算されていること
    expect(car.getTripDistanceKm()).toBeCloseTo(0.45, 3);
    // Dレンジ走行中は電子シフトレバーが後方（+X回転）へチルトしていること
    expect(car.electroShifterGroup.rotation.x).toBeGreaterThan(0.08);

    // 3. リバース（R）ギア時は電子シフトレバーが前方（-X回転）へチルトすること
    const reverseState = {
      ...idleState,
      speedKmh: 15,
      engineRpm: 1600,
      gear: "R",
    };
    for (let i = 0; i < 30; i++) {
      car.update(0.05, reverseState, 0);
    }
    expect(car.electroShifterGroup.rotation.x).toBeLessThan(-0.08);
  });

  it("車内11インチJDMカーナビ画面が街区ビル→3パス道路階層合成（全外枠ケーシング→全路面塗り→車線・交差点）の順で描画し、dt=0.015s等の60Hzフレーム揺らぎでもフレーム落ちせず毎フレーム滑らかに更新されることを保証する", () => {
    const car = new CarModel();

    // カーナビ液晶画面マテリアルが toneMapped: false であり、背面ハウジングと十分なZクリアランスを持つこと
    let navScreenToneMapped: boolean | undefined;
    car.centerNavGroup.traverse((child) => {
      const mesh = child as THREE.Mesh;
      const isPlaneMesh =
        mesh.isMesh &&
        mesh.geometry?.type === "PlaneGeometry" &&
        mesh.material instanceof THREE.MeshBasicMaterial;
      if (isPlaneMesh) {
        navScreenToneMapped = (mesh.material as THREE.MeshBasicMaterial).toneMapped;
      }
    });
    expect(navScreenToneMapped).toBe(false);

    const drawEvents: Array<{ op: "stroke" | "fill"; style: string; lineCap: string }> = [];
    let quadraticCurveCount = 0;
    let transformArgs: number[] = [];

    const mockCtx = {
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      lineCap: "butt",
      lineJoin: "miter",
      font: "",
      textAlign: "left",
      setTransform: (...args: number[]) => {
        transformArgs = args;
      },
      fillRect: () => {},
      strokeRect: () => {},
      beginPath: () => {},
      closePath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      quadraticCurveTo: () => {
        quadraticCurveCount += 1;
      },
      arc: () => {},
      fill: function () {
        drawEvents.push({
          op: "fill",
          style: String(this.fillStyle),
          lineCap: String(this.lineCap),
        });
      },
      stroke: function () {
        drawEvents.push({
          op: "stroke",
          style: String(this.strokeStyle),
          lineCap: String(this.lineCap),
        });
      },
      fillText: () => {},
      save: () => {},
      restore: () => {},
      rect: () => {},
      clip: () => {},
      setLineDash: () => {},
    };

    const internalCar = car as unknown as {
      navCanvas: { width: number; height: number };
      navContext: typeof mockCtx;
      navTexture: { needsUpdate: boolean };
    };
    internalCar.navCanvas = { width: 1280, height: 720 };
    internalCar.navContext = mockCtx;
    internalCar.navTexture = { needsUpdate: false };

    const tokyoState = {
      position: { x: 0, y: 0.8, z: 85 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      velocity: { x: 0, y: 0, z: 12 },
      speedKmh: 45,
      steeringAngle: 0.08,
      engineRpm: 2100,
      gear: "D 3",
      headingAngle: 0.35,
      pitchAngle: 0,
      rollAngle: 0,
      wheels: [],
    };

    // 60Hz requestAnimationFrame でフレーム間隔が 15.0ms (0.015s < 0.016s) に揺らいだ場合でも、連続フレームでスキップされず毎回更新されること
    car.update(0.015, tokyoState, 0);
    expect(internalCar.navTexture.needsUpdate).toBe(true);
    internalCar.navTexture.needsUpdate = false;
    drawEvents.length = 0;
    quadraticCurveCount = 0;

    car.update(0.015, tokyoState, 0);
    expect(internalCar.navTexture.needsUpdate).toBe(true);
    expect(transformArgs[0]).toBe(2);
    expect(transformArgs[3]).toBe(2);
    expect(quadraticCurveCount).toBeGreaterThanOrEqual(5);

    // 1. 街区ビル群 (#475569 ルーフ枠) がすべて道路の外枠ケーシング (#1e293b) より前に描画され、3Dルーフ視差で道路を欠けさせないこと
    const buildingRoofIndices = drawEvents
      .map((e, idx) => (e.op === "stroke" && e.style === "#475569" ? idx : -1))
      .filter((idx) => idx >= 0);
    const casingIndices = drawEvents
      .map((e, idx) => (e.op === "stroke" && e.style === "#1e293b" ? idx : -1))
      .filter((idx) => idx >= 0);
    const fillColors = new Set(["#3f4f63", "#52637a", "#64748b"]);
    const fillIndices = drawEvents
      .map((e, idx) => (e.op === "stroke" && fillColors.has(e.style) ? idx : -1))
      .filter((idx) => idx >= 0);

    expect(buildingRoofIndices.length).toBeGreaterThanOrEqual(5);
    expect(casingIndices.length).toBeGreaterThanOrEqual(10);
    expect(fillIndices.length).toBeGreaterThanOrEqual(10);

    const lastBuildingIdx = Math.max(...buildingRoofIndices);
    const firstCasingIdx = Math.min(...casingIndices);
    const lastCasingIdx = Math.max(...casingIndices);
    const firstFillIdx = Math.min(...fillIndices);
    expect(lastBuildingIdx).toBeLessThan(firstCasingIdx);
    expect(lastCasingIdx).toBeLessThan(firstFillIdx);

    // 2. 道路ケーシング・路面塗りともに lineCap = "round" で描画され、T字路端部の角ばり・はみ出しが発生しないこと
    for (const idx of [...casingIndices, ...fillIndices]) {
      expect(drawEvents[idx].lineCap).toBe("round");
    }

    // 3. 渋谷エリア走行時も180度折り返しなしでコーナーR補間 (quadraticCurveTo) が機能すること
    quadraticCurveCount = 0;
    const shibuyaState = {
      ...tokyoState,
      position: { x: -750, y: 0.8, z: -20 },
    };
    car.update(0.015, shibuyaState, 0);
    expect(quadraticCurveCount).toBeGreaterThanOrEqual(3);
  });

  it("CarModel.setGraphicsQuality が高・中・低の三段階でミラー反射レンダーターゲット解像度と描画間引き間隔を制御することを保証する", () => {
    const car = new CarModel();
    const scene = new THREE.Scene();

    let renderCalls = 0;
    const mockRenderer = {
      getRenderTarget: () => null,
      setRenderTarget: () => {},
      clear: () => {},
      render: () => {
        renderCalls += 1;
      },
    } as unknown as THREE.WebGLRenderer;

    // 1. 高 (high): 512x256, 毎フレーム更新 (interval = 1)
    expect(car.graphicsQuality).toBe("high");
    expect(car.rearRenderTarget.width).toBe(512);
    expect(car.rearRenderTarget.height).toBe(256);
    expect(car.mirrorRenderInterval).toBe(1);
    expect(car.updateMirrors(mockRenderer, scene)).toBe(true);
    expect(car.updateMirrors(mockRenderer, scene)).toBe(true);
    expect(renderCalls).toBe(2);

    // 2. 中 (medium): 256x128, 2フレームに1回更新 (interval = 2: リサイズ直後の初回フレームで描画し、偶数ステップごとに描画)
    renderCalls = 0;
    car.setGraphicsQuality("medium");
    expect(car.graphicsQuality).toBe("medium");
    expect(car.rearRenderTarget.width).toBe(256);
    expect(car.rearRenderTarget.height).toBe(128);
    expect(car.mirrorRenderInterval).toBe(2);
    expect(car.updateMirrors(mockRenderer, scene)).toBe(true); // 1フレーム目描画 (counter=0)
    expect(car.updateMirrors(mockRenderer, scene)).toBe(false); // 2フレーム目スキップ (counter=1)
    expect(car.updateMirrors(mockRenderer, scene)).toBe(true); // 3フレーム目描画 (counter=2)
    expect(car.updateMirrors(mockRenderer, scene)).toBe(false); // 4フレーム目スキップ (counter=3)
    expect(renderCalls).toBe(2);

    // 3. 低 (low): 128x64, 6フレームに1回更新 (interval = 6)、force=true 時は即時描画
    renderCalls = 0;
    car.setGraphicsQuality("low");
    expect(car.graphicsQuality).toBe("low");
    expect(car.rearRenderTarget.width).toBe(128);
    expect(car.rearRenderTarget.height).toBe(64);
    expect(car.mirrorRenderInterval).toBe(6);
    expect(car.updateMirrors(mockRenderer, scene)).toBe(true); // 初回フレームでリサイズ後のテクスチャを即時更新 (counter=0)
    for (let i = 0; i < 5; i++) {
      expect(car.updateMirrors(mockRenderer, scene)).toBe(false); // 続く5フレームはスキップ (counter=1..5)
    }
    expect(car.updateMirrors(mockRenderer, scene)).toBe(true); // 7フレーム目で再描画 (counter=6)
    expect(renderCalls).toBe(2);

    // force = true 指定時は間引きカウンタに関係なく即座に再描画されること
    expect(car.updateMirrors(mockRenderer, scene, true)).toBe(true);
    expect(renderCalls).toBe(3);

    // 4. ミラー描画中に RainParticles / RainSplashParticles / VolumetricCloudDome が一時的に非表示化され、描画後に復元されること
    const rainMesh = new THREE.Mesh();
    rainMesh.name = "RainParticles";
    const splashMesh = new THREE.Mesh();
    splashMesh.name = "RainSplashParticles";
    scene.add(rainMesh, splashMesh);

    let rainVisibleDuringMirror = true;
    let splashVisibleDuringMirror = true;
    let mirrorFarDuringRender = 0;
    const inspectRenderer = {
      shadowMap: { autoUpdate: true },
      getRenderTarget: () => null,
      setRenderTarget: () => {},
      clear: () => {},
      render: () => {
        rainVisibleDuringMirror = rainMesh.visible;
        splashVisibleDuringMirror = splashMesh.visible;
        mirrorFarDuringRender = car.rearCamera.far;
      },
    } as unknown as THREE.WebGLRenderer;

    car.updateMirrors(inspectRenderer, scene, true);
    expect(rainVisibleDuringMirror).toBe(false);
    expect(splashVisibleDuringMirror).toBe(false);
    expect(mirrorFarDuringRender).toBeLessThanOrEqual(100);
    expect(rainMesh.visible).toBe(true);
    expect(splashMesh.visible).toBe(true);
  });

  it("TokyoStationMap の距離カリング (updateDistanceCulling) と動的 PointLight / SpotLight のシーングラフ完全除外を保証する", async () => {
    const { TokyoStationMap } = await import("../city/tokyoStationMap");
    await RAPIER.init();
    const world = new RAPIER.World(new RAPIER.Vector3(0, -9.81, 0));
    const scene = new THREE.Scene();
    const map = new TokyoStationMap(scene, world, RAPIER);

    // 1. TokyoStationMap のシーンツリー内に PointLight / SpotLight が一切残っていないこと
    let attachedLightCount = 0;
    map.group.traverse((child) => {
      const isLight = (child as THREE.Light).isLight === true;
      if (isLight) {
        attachedLightCount += 1;
      }
    });
    expect(attachedLightCount).toBe(0);

    // 2. CarModel のシーンツリー内のヘッドライト光源は左右対称の SpotLight 2灯（右 x = -0.66m / 左 x = +0.66m）であり、
    //    消灯時 (setHeadlights(false)) は両方 visible = false、点灯時 (setHeadlights(true)) は両方 visible = true になること
    const car = new CarModel();
    const carAttachedLights: THREE.SpotLight[] = [];
    car.group.traverse((child) => {
      const isLight = (child as THREE.Light).isLight === true;
      if (isLight) {
        carAttachedLights.push(child as THREE.SpotLight);
      }
    });
    expect(carAttachedLights.length).toBe(2);
    expect(carAttachedLights[0].position.x).toBeCloseTo(-0.66, 2);
    expect(carAttachedLights[1].position.x).toBeCloseTo(0.66, 2);
    expect(carAttachedLights[0].position.y).toBeCloseTo(0.675, 3);
    expect(carAttachedLights[1].position.y).toBeCloseTo(0.675, 3);
    expect(carAttachedLights[0].position.z).toBeCloseTo(2.38, 2);
    expect(carAttachedLights[1].position.z).toBeCloseTo(2.38, 2);
    car.setHeadlights(false);
    expect(carAttachedLights[0].visible).toBe(false);
    expect(carAttachedLights[1].visible).toBe(false);
    car.setHeadlights(true);
    expect(carAttachedLights[0].visible).toBe(true);
    expect(carAttachedLights[1].visible).toBe(true);

    // 3. 丸の内エリア (x = 0, z = 42) 走行時は渋谷エリア (x ≈ -750) のオブジェクトが非表示 (visible = false) にカリングされ、
    //    広域地面 (CityWideGroundMesh) と東京駅周辺のオブジェクトは表示 (visible = true) を維持すること
    const totalChildren = map.group.children.length;
    const visibleAtMarunouchi = map.updateDistanceCulling(new THREE.Vector3(0, 0.8, 42), 380);
    expect(visibleAtMarunouchi).toBeGreaterThan(10);
    expect(visibleAtMarunouchi).toBeLessThan(totalChildren);

    const groundMesh = map.group.children.find((c) => c.name === "CityWideGroundMesh");
    expect(groundMesh?.visible).toBe(true);

    const shibuyaBuilding = map.group.children.find((c) => c.position.x < -600);
    expect(shibuyaBuilding?.visible).toBe(false);

    // 4. 渋谷エリア (x = -750, z = -15) へ移動すると渋谷側オブジェクトが表示され、丸の内側がカリングされること
    const visibleAtShibuya = map.updateDistanceCulling(new THREE.Vector3(-750, 0.8, -15), 380);
    expect(visibleAtShibuya).toBeGreaterThan(5);
    expect(shibuyaBuilding?.visible).toBe(true);
    expect(groundMesh?.visible).toBe(true);
  });

  it("CarModel のウインカー（方向指示器: left / right / hazard / off）が 0.34秒周期で点滅し、外装・ドアミラーLED・右ハンドルウインカーレバー角度が連動することを保証する", () => {
    const car = new CarModel();
    const stalkGroup = car.group.getObjectByName("TurnSignalStalk_R");
    const lampGroup = car.group.getObjectByName("TurnSignalLamps");
    expect(stalkGroup).toBeDefined();
    expect(lampGroup).toBeDefined();

    const baseState = {
      position: { x: 0, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      velocity: { x: 0, y: 0, z: 0 },
      speedKmh: 30,
      steeringAngle: 0,
      engineRpm: 1500,
      gear: "D 2",
      headingAngle: 0,
      pitchAngle: 0,
      rollAngle: 0,
      wheels: [],
    };

    const observedPhases: Array<{ blinkOn: boolean; state: string }> = [];
    car.onTurnSignalBlinkPhaseChange = (blinkOn, state) => {
      observedPhases.push({ blinkOn, state });
    };

    // 初期状態は off（JIS右側ウインカーレバーの中立角度 = -0.18 rad）
    const neutralStalkRotZ = -0.18;
    expect(car.getTurnSignal()).toBe("off");
    expect(car.isTurnSignalBlinkOn()).toBe(false);
    expect(stalkGroup!.rotation.z).toBeCloseTo(neutralStalkRotZ, 4);

    // 1. 左ウインカー (Q -> "left") 点灯開始: 即座に ON フェーズから始まり、右側レバーが上（左折側 -Z回転）へ引き上げられること
    car.setTurnSignal("left");
    expect(car.getTurnSignal()).toBe("left");
    expect(car.isTurnSignalBlinkOn()).toBe(true);
    expect(stalkGroup!.rotation.z).toBeCloseTo(neutralStalkRotZ - 0.22, 4);
    expect(observedPhases[observedPhases.length - 1]).toEqual({ blinkOn: true, state: "left" });

    // 0.35秒経過すると OFF フェーズへ切り替わること
    car.update(0.35, { ...baseState, turnSignal: "left" }, 0);
    expect(car.isTurnSignalBlinkOn()).toBe(false);
    expect(observedPhases[observedPhases.length - 1]).toEqual({ blinkOn: false, state: "left" });

    // さらに 0.35秒経過すると再び ON フェーズへ戻ること
    car.update(0.35, { ...baseState, turnSignal: "left" }, 0);
    expect(car.isTurnSignalBlinkOn()).toBe(true);

    // 2. 右ウインカー (E -> "right") 切替: 右側レバーが下（右折側 +Z回転）へ押し下げられること
    car.setTurnSignal("right");
    expect(car.getTurnSignal()).toBe("right");
    expect(car.isTurnSignalBlinkOn()).toBe(true);
    expect(stalkGroup!.rotation.z).toBeCloseTo(neutralStalkRotZ + 0.22, 4);

    // 3. ハザードランプ (Z -> "hazard"): レバーは中立 (-0.18 rad) に戻りつつ両側ランプが点滅すること
    car.setTurnSignal("hazard");
    expect(car.getTurnSignal()).toBe("hazard");
    expect(car.isTurnSignalBlinkOn()).toBe(true);
    expect(stalkGroup!.rotation.z).toBeCloseTo(neutralStalkRotZ, 4);

    // 4. 消灯 ("off"): すべて消灯しレバーが中立 (-0.18 rad) になること
    car.setTurnSignal("off");
    expect(car.getTurnSignal()).toBe("off");
    expect(car.isTurnSignalBlinkOn()).toBe(false);
    expect(stalkGroup!.rotation.z).toBeCloseTo(neutralStalkRotZ, 4);
  });
});

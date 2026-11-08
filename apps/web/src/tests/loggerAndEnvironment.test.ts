import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { StructuredLogger, StructuredLogEntrySchema } from "../core/logger";
import { WeatherSystem } from "../weather/weatherSystem";
import { CarModel } from "../vehicle/carModel";
import { CameraController } from "../core/cameraController";
import { InputManager } from "../core/inputManager";
import { MobileHudController } from "../core/mobileHudController";

describe("StructuredLogger (Zod Schema) & TimeOfDay × WeatherCondition 直交環境システム", () => {
  it("StructuredLogger が Zod スキーマ検証を通過した1行JSON構造化ログを生成し、traceId と parentSpanId を伝播することを保証する", async () => {
    const testLogger = new StructuredLogger({ consoleOutputEnabled: false });
    const rootTrace = testLogger.startTrace("simulation.session");

    await testLogger.withAsyncTrace(
      "environment",
      "switchTimeAndWeather",
      async (parentTrace) => {
        testLogger.withTrace(
          "weatherSystem",
          "applySkyAndFog",
          () => {
            testLogger.info("skyShader", "uniforms.updated", "Sky uniforms synchronized", {
              timeOfDay: "sunset",
              weather: "rain",
            });
          },
          { parentSpan: parentTrace.spanId },
        );
      },
      { requestedTime: "sunset", requestedWeather: "rain" },
    );

    const traceLogs = testLogger.queryByTraceId(rootTrace.traceId);
    expect(traceLogs.length).toBe(3);

    for (const entry of traceLogs) {
      const parsed = StructuredLogEntrySchema.safeParse(entry);
      expect(parsed.success).toBe(true);
      expect(entry.traceId).toBe(rootTrace.traceId);
      const singleLineJson = JSON.stringify(entry);
      expect(singleLineJson.includes("\n")).toBe(false);
    }

    const leafLog = testLogger.queryByEvent("uniforms.updated")[0];
    const middleSpanLog = testLogger.queryByEvent("applySkyAndFog")[0];
    const outerSpanLog = testLogger.queryByEvent("switchTimeAndWeather")[0];

    expect(leafLog.spanId).toBe(middleSpanLog.spanId);
    expect(middleSpanLog.parentSpanId).toBe(outerSpanLog.spanId);
    expect(outerSpanLog.parentSpanId).toBe(rootTrace.spanId);
    expect(typeof outerSpanLog.durationMs).toBe("number");
  });

  it("時間帯（朝・昼・夕暮れ・夜間）と天候（晴天・曇天・雨天）が独立して組み合わさり、夕暮れ×晴天や夕暮れ×雨天などが正しく表現されることを保証する", () => {
    const scene = new THREE.Scene();
    const weatherSystem = new WeatherSystem(scene);

    // 1. 夕暮れ × 晴天: レンズフレア有効、雨なし、時刻 17:30
    weatherSystem.setEnvironment("sunset", "clear");
    const sunsetClear = weatherSystem.getEnvironmentSummary();
    expect(sunsetClear.timeOfDay).toBe("sunset");
    expect(sunsetClear.weather).toBe("clear");
    expect(sunsetClear.clockText).toBe("17:30");
    expect(sunsetClear.timeLabel).toBe("夕暮れ");
    expect(sunsetClear.weatherLabel).toBe("晴天");
    expect(weatherSystem.rainIntensity).toBe(0.0);
    expect(weatherSystem.getLensFlareConfig().enabled).toBe(true);
    expect(weatherSystem.getPuddleEnvironmentParams().nightFactor).toBeCloseTo(0.35, 3);

    // 2. 夕暮れ × 雨天: 時間帯は夕暮れ(17:30)のまま雨が降り、レンズフレアは遮蔽され水面波紋が最大化する
    weatherSystem.setWeather("rain");
    const sunsetRain = weatherSystem.getEnvironmentSummary();
    expect(sunsetRain.timeOfDay).toBe("sunset");
    expect(sunsetRain.weather).toBe("rain");
    expect(sunsetRain.clockText).toBe("17:30");
    expect(weatherSystem.rainIntensity).toBe(1.0);
    expect(weatherSystem.wetness).toBe(1.0);
    expect(weatherSystem.getLensFlareConfig().enabled).toBe(false);
    expect(weatherSystem.getPuddleEnvironmentParams().nightFactor).toBeCloseTo(0.35, 3);

    // 3. 朝 × 曇天: 時刻 06:30、雨なし、曇天による拡散光（レンズフレア無効）
    weatherSystem.setEnvironment("morning", "cloudy");
    const morningCloudy = weatherSystem.getEnvironmentSummary();
    expect(morningCloudy.timeOfDay).toBe("morning");
    expect(morningCloudy.weather).toBe("cloudy");
    expect(morningCloudy.clockText).toBe("06:30");
    expect(morningCloudy.timeLabel).toBe("朝");
    expect(morningCloudy.weatherLabel).toBe("曇天");
    expect(weatherSystem.rainIntensity).toBe(0.0);
    expect(weatherSystem.getLensFlareConfig().enabled).toBe(false);

    // 4. 夜間 × 雨天: 時刻 21:00、雨天、夜間係数 1.0、ヘッドライト点灯対象、GPU雨ストリーク＆路面クラウンスプラッシュが可視化・同期される
    weatherSystem.setEnvironment("night", "rain");
    const nightRain = weatherSystem.getEnvironmentSummary();
    expect(nightRain.timeOfDay).toBe("night");
    expect(nightRain.weather).toBe("rain");
    expect(nightRain.clockText).toBe("21:00");
    expect(weatherSystem.rainIntensity).toBe(1.0);
    expect(weatherSystem.rainMesh.visible).toBe(true);
    expect(weatherSystem.rainSplashMesh.visible).toBe(true);
    expect(weatherSystem.rainMaterial.uniforms.uNightFactor.value).toBe(1.0);
    expect(weatherSystem.shouldEnableHeadlights()).toBe(true);
    expect(weatherSystem.getPuddleEnvironmentParams().nightFactor).toBe(1.0);

    // 5. GPU雨パーティクル更新で車両位置・速度・経過時間がシェーダーユニフォームへ伝播し、車内キャビン除外ロジックが含まれることを検証
    weatherSystem.update(0.16, new THREE.Vector3(3.5, 0.8, 42.0), new THREE.Vector3(0, 0, 14.0));
    expect((weatherSystem.rainMaterial.uniforms.uCarPos.value as THREE.Vector3).z).toBeCloseTo(
      42.0,
      2,
    );
    expect((weatherSystem.rainMaterial.uniforms.uCarVel.value as THREE.Vector3).z).toBeCloseTo(
      14.0,
      2,
    );
    expect(weatherSystem.rainMaterial.vertexShader.includes("inCabinBox")).toBe(true);
    expect(weatherSystem.rainSplashMaterial.fragmentShader.includes("crownRing")).toBe(true);
  });

  it("右ハンドル車内の11インチJDMフローティングカーナビが運転席カメラ視野内に配置され、時間帯・天候表示を同期できることを保証する", () => {
    const carModel = new CarModel();
    expect(carModel.centerNavGroup).toBeDefined();

    // 右ハンドル運転席カメラ(x=-0.38m)から見切れないセンター寄り位置(-0.132m)かつ運転席向きチルト(+Y回転)であることを検証
    expect(carModel.centerNavGroup.position.x).toBeCloseTo(-0.132, 3);
    expect(carModel.centerNavGroup.position.y).toBeCloseTo(0.955, 3);
    expect(carModel.centerNavGroup.position.z).toBeCloseTo(0.585, 3);
    expect(carModel.centerNavGroup.rotation.y).toBeGreaterThan(0.1);

    carModel.setEnvironmentDisplay("17:30", "夕暮れ", "雨天");
    expect(() => {
      carModel.update(
        0.2,
        {
          speedKmh: 42,
          engineRpm: 2400,
          gear: "D 2",
          position: { x: 3.5, y: 0.8, z: 30 },
          quaternion: { x: 0, y: 0, z: 0, w: 1 },
          velocity: { x: 0, y: 0, z: 11.6 },
          headingAngle: 0,
          steeringAngle: 0,
          pitchAngle: 0,
          rollAngle: 0,
          wheels: [],
        },
        1.0,
      );
    }).not.toThrow();
  });

  it("時間帯×天候とは独立に路面状態（乾燥 dry / 雨上がり wet / 水たまり puddle）を設定でき、「晴天×雨上がり」や「晴天×乾燥」が正しく機能することを保証する", () => {
    const scene = new THREE.Scene();
    const weatherSystem = new WeatherSystem(scene);

    // 1. 昼 × 晴天 × 雨上がり(wet): 空は快晴でレンズフレア有効、雨は降っていないが路面は湿潤(0.72)、雨粒の着水波紋(rippleIntensity)は 0.0
    weatherSystem.setEnvironment("day", "clear", "wet");
    const dayClearWet = weatherSystem.getEnvironmentSummary();
    expect(dayClearWet.timeOfDay).toBe("day");
    expect(dayClearWet.weather).toBe("clear");
    expect(dayClearWet.roadSurface).toBe("wet");
    expect(dayClearWet.roadSurfaceLabel).toBe("雨上がり・湿潤");
    expect(weatherSystem.rainIntensity).toBe(0.0);
    expect(weatherSystem.wetness).toBeCloseTo(0.72, 2);
    expect(weatherSystem.getPuddleEnvironmentParams().rippleIntensity).toBe(0.0);
    expect(weatherSystem.getLensFlareConfig().enabled).toBe(true);

    // 2. 昼 × 晴天 × 乾燥(dry): 完全ドライ路面(wetness=0.0, 波紋=0.0)
    weatherSystem.setRoadSurface("dry");
    expect(weatherSystem.currentRoadSurface).toBe("dry");
    expect(weatherSystem.wetness).toBe(0.0);
    expect(weatherSystem.getPuddleEnvironmentParams().rippleIntensity).toBe(0.0);

    // 3. 夕暮れ × 晴天 × 水たまり(puddle): 夕焼け空が路面の水たまりに鏡面反射するが、晴天なので着水波紋(rippleIntensity)は 0.0
    weatherSystem.setEnvironment("sunset", "clear", "puddle");
    expect(weatherSystem.currentRoadSurface).toBe("puddle");
    expect(weatherSystem.wetness).toBe(1.0);
    expect(weatherSystem.rainIntensity).toBe(0.0);
    expect(weatherSystem.getPuddleEnvironmentParams().rippleIntensity).toBe(0.0);

    // 4. 夜間 × 雨天 × 水たまり(puddle): 実際に雨が降っている時は着水波紋(rippleIntensity)が 1.0 になること
    weatherSystem.setEnvironment("night", "rain", "puddle");
    expect(weatherSystem.rainIntensity).toBe(1.0);
    expect(weatherSystem.getPuddleEnvironmentParams().rippleIntensity).toBe(1.0);

    // 5. 天候プリセット（WeatherPreset）適用時：非降雨プリセット（sunset/day/night/cloudy）では路面が dry(0.0) に初期化され、降雨プリセットでは puddle(>=0.92) になること
    weatherSystem.applyPreset({
      id: "sunset",
      name: "夕暮れ",
      sunPosition: [4, 40, 180],
      sunColor: 0xff9944,
      ambientColor: 0xfdba74,
      skyColor: 0x4c1d95,
      fogDensity: 0.0025,
      fogColor: 0xfb923c,
      rain: { enabled: false, intensity: 0, wiperSpeed: 0, windshieldWetness: 0 },
      lensflare: { enabled: true, intensity: 1.0, color: 0xffbb66 },
    });
    expect(weatherSystem.currentRoadSurface).toBe("dry");
    expect(weatherSystem.wetness).toBe(0.0);
    expect(weatherSystem.rainIntensity).toBe(0.0);

    weatherSystem.applyPreset({
      id: "rain",
      name: "雨天",
      sunPosition: [0, 80, 100],
      sunColor: 0x94a3b8,
      ambientColor: 0x64748b,
      skyColor: 0x334155,
      fogDensity: 0.008,
      fogColor: 0x475569,
      rain: { enabled: true, intensity: 0.85, wiperSpeed: 1.2, windshieldWetness: 0.95 },
      lensflare: { enabled: false, intensity: 0, color: 0 },
    });
    expect(weatherSystem.currentRoadSurface).toBe("puddle");
    expect(weatherSystem.wetness).toBeGreaterThanOrEqual(0.92);
    expect(weatherSystem.rainIntensity).toBe(0.85);
  });

  it("クラウン セダンの4眼Bi-Beam LEDヘッドライト光源・ロービーム補助光源・車内ライティングと、1フレーム遅延揺れのないドライバー視点カメラを保証する", () => {
    const carModel = new CarModel();

    // 1. ヘッドライトSpotLightがフロントバンパー先端外(z = 2.38m)に配置され、自己遮蔽されないこと
    expect(carModel.headLights.length).toBe(2);
    expect(carModel.headLights[0].position.z).toBeCloseTo(2.38, 2);
    expect(carModel.headLights[0].shadow.camera.near).toBeCloseTo(0.6, 2);
    expect(carModel.headlightLowBeamLight).toBeDefined();
    expect(carModel.headlightLightSourceGroup).toBeDefined();
    expect(carModel.headlightBeamConeGroup).toBeDefined();

    carModel.setHeadlights(true);
    expect(carModel.headLights[0].intensity).toBeGreaterThan(50);
    expect(carModel.headlightLowBeamLight.intensity).toBeGreaterThan(30);
    expect(carModel.headlightBeamConeGroup.visible).toBe(true);

    carModel.setHeadlights(false);
    expect(carModel.headLights[0].intensity).toBe(0);
    expect(carModel.headlightLowBeamLight.intensity).toBe(0);
    expect(carModel.headlightBeamConeGroup.visible).toBe(false);

    // 2. 車内キャビン専用ライト（ルーフ間接光＋64色アンビエント＋フットウェル間接光）が時間帯・天候に応じて更新されること
    carModel.setInteriorLighting("night", "clear");
    expect(carModel.cabinAmbientLight.intensity).toBeCloseTo(1.55, 2);
    expect(carModel.cabinFootwellLight.intensity).toBeCloseTo(0.95, 2);
    carModel.setInteriorLighting("day", "rain");
    expect(carModel.cabinOverheadLight.intensity).toBeCloseTo(1.42, 2);
    expect(carModel.cabinFootwellLight.intensity).toBeCloseTo(0.75, 2);

    // 3. ドライバー視点カメラが車体移動直後でも1フレーム遅延や高周波ジッターなしで右ハンドルアイポイント(-0.38, 1.13, 0.06)に完全一致すること
    const cameraController = new CameraController(16 / 9);
    cameraController.setMode("cockpit");
    const state = {
      speedKmh: 85,
      engineRpm: 3100,
      gear: "D 3",
      position: { x: 3.5, y: 0.48, z: 64.2 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      velocity: { x: 0, y: 0, z: 23.6 },
      headingAngle: 0,
      steeringAngle: 0,
      pitchAngle: 0,
      rollAngle: 0,
      wheels: [],
    };
    carModel.update(0.016, state, 0.0);
    cameraController.update(0.016, state, carModel.group);

    expect(cameraController.camera.position.x).toBeCloseTo(3.5 - 0.38, 5);
    expect(cameraController.camera.position.y).toBeCloseTo(0.48 + 1.13, 5);
    expect(cameraController.camera.position.z).toBeCloseTo(64.2 + 0.06, 5);
  });

  it("ドライバー視点および追従視点で視線（プリセット・自由角度・UN R125頭部/体幹回旋）を変更・リセットできること", () => {
    const carModel = new CarModel();
    const cameraController = new CameraController(16 / 9);
    cameraController.setMode("cockpit");

    const state = {
      speedKmh: 60,
      engineRpm: 2200,
      gear: "D 2",
      position: { x: 3.5, y: 0.48, z: 40.0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      velocity: { x: 0, y: 0, z: 16.6 },
      headingAngle: 0,
      steeringAngle: 0,
      pitchAngle: 0,
      rollAngle: 0,
      wheels: [],
    };
    carModel.update(0.016, state, 0.0);

    // 1. 初期状態（正面 forward）では頭部オフセットが厳密に (0, 0, 0) であること
    const initialGaze = cameraController.getGazeState();
    expect(initialGaze.preset).toBe("forward");
    expect(initialGaze.headOffsetLocal.x).toBe(0);
    expect(initialGaze.headOffsetLocal.y).toBe(0);
    expect(initialGaze.headOffsetLocal.z).toBe(0);

    // 2. 右ドアミラー確認（right_mirror: yaw = -30°, pitch = -8°）では首の回転軸（眼の99mm後方）により
    //    アイポイントが右(-X)・わずかに後方(-Z)へ移動し、カメラ視線ベクトルが右前下方を向くこと
    cameraController.setGazePreset("right_mirror", true);
    cameraController.update(0.016, state, carModel.group);
    const rightMirrorGaze = cameraController.getGazeState();
    expect(rightMirrorGaze.preset).toBe("right_mirror");
    expect(rightMirrorGaze.headOffsetLocal.x).toBeLessThan(-0.04);
    expect(rightMirrorGaze.headOffsetLocal.z).toBeLessThan(-0.01);

    const forwardDirRightMirror = new THREE.Vector3();
    cameraController.camera.getWorldDirection(forwardDirRightMirror);
    expect(forwardDirRightMirror.x).toBeLessThan(-0.45); // 右方向(-X)
    expect(forwardDirRightMirror.y).toBeLessThan(-0.1); // 下方向(-Y)
    expect(forwardDirRightMirror.z).toBeGreaterThan(0.75); // 前方(+Z)

    // 3. 左後方目視（left_shoulder: yaw = +95° > 45°）では首回旋に加えて体幹回旋が働き、
    //    アイポイントが左(+X)へ移動しつつカメラが左横〜左後方を向くこと
    cameraController.setGazePreset("left_shoulder", true);
    cameraController.update(0.016, state, carModel.group);
    const leftShoulderGaze = cameraController.getGazeState();
    expect(leftShoulderGaze.preset).toBe("left_shoulder");
    expect(leftShoulderGaze.headOffsetLocal.x).toBeGreaterThan(0.12); // 首99mm + 体幹回旋寄与
    expect(leftShoulderGaze.headOffsetLocal.z).toBeLessThan(-0.1);

    const forwardDirLeftShoulder = new THREE.Vector3();
    cameraController.camera.getWorldDirection(forwardDirLeftShoulder);
    expect(forwardDirLeftShoulder.x).toBeGreaterThan(0.95); // 左方向(+X)
    expect(forwardDirLeftShoulder.z).toBeLessThan(0.0); // 90°超でわずかに後方(-Z)

    // 4. 自由ドラッグ操作（addGazeDelta）で preset が "free" になり、resetGaze で正面に完全復帰すること
    cameraController.resetGaze(true);
    cameraController.addGazeDelta(0.25, -0.1, true);
    expect(cameraController.getGazeState().preset).toBe("free");

    cameraController.resetGaze(true);
    cameraController.update(0.016, state, carModel.group);
    expect(cameraController.getGazeState().preset).toBe("forward");
    expect(cameraController.camera.position.x).toBeCloseTo(3.5 - 0.38, 5);
    expect(cameraController.camera.position.y).toBeCloseTo(0.48 + 1.13, 5);
    expect(cameraController.camera.position.z).toBeCloseTo(40.0 + 0.06, 5);
  });

  it("速度を上げてもドライバー視点・追従視点ともにカメラが後ろへ下がらず、FOVも固定維持されること", () => {
    const carModel = new CarModel();
    const cameraController = new CameraController(16 / 9);
    const dt = 0.016;

    // 1. コックピット視点: 停止時(0 km/h)と高速走行時(140 km/h)で FOV (60°) もアイポイント相対位置 (-0.38, 1.13, 0.06) も後ろへ下がらないこと
    cameraController.setMode("cockpit");
    const stoppedCockpitState = {
      speedKmh: 0,
      engineRpm: 750,
      gear: "D 1",
      position: { x: 3.5, y: 0.48, z: 10.0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      velocity: { x: 0, y: 0, z: 0 },
      headingAngle: 0,
      steeringAngle: 0,
      pitchAngle: 0,
      rollAngle: 0,
      wheels: [],
    };
    carModel.update(dt, stoppedCockpitState, 0.0);
    cameraController.update(dt, stoppedCockpitState, carModel.group);
    const stoppedCockpitFov = cameraController.camera.fov;
    const stoppedCockpitRelZ = cameraController.camera.position.z - stoppedCockpitState.position.z;

    const highSpeedCockpitState = {
      ...stoppedCockpitState,
      speedKmh: 140,
      engineRpm: 4800,
      gear: "D 6",
      position: { x: 3.5, y: 0.48, z: 150.0 },
      velocity: { x: 0, y: 0, z: 38.89 },
    };
    for (let i = 0; i < 30; i++) {
      highSpeedCockpitState.position.z += highSpeedCockpitState.velocity.z * dt;
      carModel.update(dt, highSpeedCockpitState, 0.0);
      cameraController.update(dt, highSpeedCockpitState, carModel.group);
    }
    const highSpeedCockpitFov = cameraController.camera.fov;
    const highSpeedCockpitRelZ =
      cameraController.camera.position.z - highSpeedCockpitState.position.z;

    expect(stoppedCockpitFov).toBeCloseTo(60, 5);
    expect(highSpeedCockpitFov).toBeCloseTo(60, 5);
    expect(stoppedCockpitRelZ).toBeCloseTo(0.06, 5);
    expect(highSpeedCockpitRelZ).toBeCloseTo(0.06, 5);

    // 2. 追従視点(chase): 停止時(0 km/h)と高速走行時(140 km/h)でカメラと車体の前後距離 (-6.5m) が一定で後ろへ引き離されないこと
    cameraController.setMode("chase");
    const stoppedChaseState = {
      ...stoppedCockpitState,
      position: { x: 3.5, y: 0.48, z: 20.0 },
    };
    carModel.update(dt, stoppedChaseState, 0.0);
    cameraController.update(dt, stoppedChaseState, carModel.group);
    const stoppedChaseRelZ = cameraController.camera.position.z - stoppedChaseState.position.z;

    const highSpeedChaseState = {
      ...stoppedChaseState,
      speedKmh: 140,
      velocity: { x: 0, y: 0, z: 38.89 },
    };
    for (let i = 0; i < 30; i++) {
      highSpeedChaseState.position.z += highSpeedChaseState.velocity.z * dt;
      carModel.update(dt, highSpeedChaseState, 0.0);
      cameraController.update(dt, highSpeedChaseState, carModel.group);
    }
    const highSpeedChaseRelZ = cameraController.camera.position.z - highSpeedChaseState.position.z;

    expect(stoppedChaseRelZ).toBeCloseTo(-6.5, 5);
    expect(highSpeedChaseRelZ).toBeCloseTo(-6.5, 5);
    expect(cameraController.camera.fov).toBeCloseTo(60, 5);
  });

  it("モバイル縦持ち (Portrait: aspect < 1.0) では水平視野角狭窄を防ぐため垂直 FOV が自動拡大され、横持ち・PC (aspect >= 1.0) では 60° が厳密に維持されることを保証する", () => {
    // PC / スマホ横持ち (Landscape)
    expect(CameraController.computeResponsiveFov(16 / 9)).toBe(60);
    expect(CameraController.computeResponsiveFov(844 / 390)).toBe(60);
    expect(CameraController.computeResponsiveFov(1.0)).toBe(60);

    // スマホ縦持ち (Portrait: 例 390x844 iPhone 16 Pro Max / Pixel 11 Pro)
    const portraitAspect = 390 / 844;
    const portraitFov = CameraController.computeResponsiveFov(portraitAspect);
    expect(portraitFov).toBeGreaterThan(70);
    expect(portraitFov).toBeLessThanOrEqual(80);

    // 極端な縦長アスペクト比でも上限 80° でクランプされパース歪みが暴走しないこと
    expect(CameraController.computeResponsiveFov(0.2)).toBe(80);

    // CameraController.onResize で Portrait <-> Landscape 回転時に FOV が即座に再計算されること
    const cameraController = new CameraController(16 / 9);
    expect(cameraController.camera.fov).toBe(60);

    cameraController.onResize(portraitAspect);
    expect(cameraController.camera.fov).toBeCloseTo(portraitFov, 5);
    expect(cameraController.camera.aspect).toBeCloseTo(portraitAspect, 5);

    cameraController.onResize(844 / 390);
    expect(cameraController.camera.fov).toBe(60);
  });

  it("InputManager がマルチタッチ同時操作（左手操舵 + 右手アクセル/ブレーキ）を pointerId 単位で独立追跡し、片指リリースで他方の入力が消えないことを保証する", () => {
    const inputManager = new InputManager();

    // 初期状態はすべて 0 / false
    expect(inputManager.getInput()).toEqual({
      throttle: 0,
      brake: 0,
      steer: 0,
      handbrake: false,
    });

    // 右手親指 (pointerId = 1) でアクセル、左手親指 (pointerId = 2) で左ステアを同時押下
    inputManager.setVirtualControlState("throttle", true, 1);
    inputManager.setVirtualControlState("steerLeft", true, 2);
    expect(inputManager.getInput()).toEqual({
      throttle: 1.0,
      brake: 0,
      steer: -1.0,
      handbrake: false,
    });

    // 左手親指 (pointerId = 2) だけ離しても、右手親指 (pointerId = 1) のアクセルは維持されること
    inputManager.setVirtualControlState("steerLeft", false, 2);
    expect(inputManager.getInput()).toEqual({
      throttle: 1.0,
      brake: 0,
      steer: 0,
      handbrake: false,
    });

    // 同一ボタンに2本の指 (pointerId = 10, 11) が触れた場合、片方を離してももう片方が残っていれば維持されること
    inputManager.setVirtualControlState("brake", true, 10);
    inputManager.setVirtualControlState("brake", true, 11);
    inputManager.setVirtualControlState("brake", false, 10);
    expect(inputManager.getInput().brake).toBe(1.0);
    inputManager.setVirtualControlState("brake", false, 11);
    expect(inputManager.getInput().brake).toBe(0);

    // clearAllInputs() で全タッチ・アナログ舵角が安全にリセットされること
    inputManager.setAnalogSteer(0.75);
    inputManager.setVirtualControlState("handbrake", true, 3);
    expect(inputManager.getInput().steer).toBeCloseTo(0.75, 5);
    expect(inputManager.getInput().handbrake).toBe(true);

    inputManager.clearAllInputs();
    expect(inputManager.getInput()).toEqual({
      throttle: 0,
      brake: 0,
      steer: 0,
      handbrake: false,
    });
  });

  it("InputManager のアナログステアリングパッド・タッチ視線スワイプ・ダブルタップ正面リセットがモック要素上で正しく機能することを保証する", () => {
    type Listener = (event: Record<string, unknown>) => void;
    const createMockElement = (initialRectWidth = 200) => {
      const listeners = new Map<string, Listener[]>();
      const classes = new Set<string>();
      const attrs = new Map<string, string>();
      let rectWidth = initialRectWidth;
      let rectCallCount = 0;
      const el = {
        getRectCallCount: () => rectCallCount,
        setRectWidth: (nextWidth: number) => {
          rectWidth = nextWidth;
        },
        style: { cursor: "", transform: "" },
        classList: {
          add: (c: string) => classes.add(c),
          remove: (c: string) => classes.delete(c),
          toggle: (c: string, force?: boolean) => {
            const shouldAdd = force ?? !classes.has(c);
            if (shouldAdd) {
              classes.add(c);
            } else {
              classes.delete(c);
            }
            return shouldAdd;
          },
          contains: (c: string) => classes.has(c),
        },
        setAttribute: (k: string, v: string) => attrs.set(k, v),
        getAttribute: (k: string) => attrs.get(k) ?? null,
        getBoundingClientRect: () => {
          rectCallCount += 1;
          return {
            left: 0,
            top: 0,
            width: rectWidth,
            height: 54,
            right: rectWidth,
            bottom: 54,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          };
        },
        addEventListener: (type: string, cb: Listener) => {
          const list = listeners.get(type) ?? [];
          list.push(cb);
          listeners.set(type, list);
        },
        emit: (type: string, payload: Record<string, unknown> = {}) => {
          const list = listeners.get(type) ?? [];
          for (const cb of list) {
            cb({
              type,
              preventDefault: () => {},
              stopPropagation: () => {},
              ...payload,
            });
          }
        },
      };
      return el;
    };

    const canvasMock = createMockElement(390);
    const steerPadMock = createMockElement(200);
    const steerThumbMock = createMockElement(44);
    const throttleBtnMock = createMockElement(80);

    const inputManager = new InputManager(canvasMock as unknown as HTMLElement);
    let touchDetectedCount = 0;
    let lastVisualSteer = 0;
    inputManager.onTouchDetected = () => {
      touchDetectedCount += 1;
    };

    inputManager.attachVirtualControls({
      throttleBtn: throttleBtnMock as unknown as HTMLElement,
      steerPad: steerPadMock as unknown as HTMLElement,
      steerThumb: steerThumbMock as unknown as HTMLElement,
      onSteerVisualChange: (steer) => {
        lastVisualSteer = steer;
      },
    });

    // 1. アナログステアリングパッド: 中心(x=100)付近のデッドゾーン内では steer === 0
    expect(steerPadMock.getRectCallCount()).toBe(0);
    steerPadMock.emit("pointerdown", { pointerId: 5, pointerType: "touch", clientX: 102 });
    expect(steerPadMock.getRectCallCount()).toBe(1);
    expect(touchDetectedCount).toBeGreaterThanOrEqual(1);
    expect(steerPadMock.classList.contains("active")).toBe(true);
    expect(inputManager.getInput().steer).toBe(0);

    // 右方向 (x=150, 175) へ連続スライドすると正の比例ステア値が出力され、pointermove 時はキャッシュ済み DOMRect を参照して getBoundingClientRect() 再呼び出しが発生しないこと
    steerPadMock.emit("pointermove", { pointerId: 5, pointerType: "touch", clientX: 150 });
    steerPadMock.emit("pointermove", { pointerId: 5, pointerType: "touch", clientX: 175 });
    expect(steerPadMock.getRectCallCount()).toBe(1);
    expect(inputManager.getInput().steer).toBeGreaterThan(0.4);
    expect(lastVisualSteer).toBeCloseTo(inputManager.getInput().steer, 5);
    expect(steerThumbMock.style.transform).toContain("translate3d(");

    // 指を置いたまま画面回転・リサイズが発生して invalidateSteerPadRectCache() が呼ばれた場合、次の pointermove で1回だけ新しい DOMRect を再取得して再計算すること
    steerPadMock.setRectWidth(300);
    inputManager.invalidateSteerPadRectCache();
    steerPadMock.emit("pointermove", { pointerId: 5, pointerType: "touch", clientX: 150 });
    expect(steerPadMock.getRectCallCount()).toBe(2);
    // 新しい幅 300px の中心 x=150 ではデッドゾーン内のため steer === 0 になること
    expect(inputManager.getInput().steer).toBe(0);
    steerPadMock.emit("pointermove", { pointerId: 5, pointerType: "touch", clientX: 250 });
    expect(steerPadMock.getRectCallCount()).toBe(2);
    expect(inputManager.getInput().steer).toBeGreaterThan(0.4);
    steerPadMock.setRectWidth(200);

    // 別の指 (pointerId = 99) の pointerdown や pointermove ではアナログステアリングが乗っ取られないこと
    const steerBeforeOtherFinger = inputManager.getInput().steer;
    steerPadMock.emit("pointerdown", { pointerId: 99, pointerType: "touch", clientX: 10 });
    steerPadMock.emit("pointermove", { pointerId: 99, pointerType: "touch", clientX: 10 });
    expect(inputManager.getInput().steer).toBeCloseTo(steerBeforeOtherFinger, 5);

    // 別の指 (pointerId = 99) を離しても最初の指 (pointerId = 5) の操舵は解除されないこと
    steerPadMock.emit("pointerup", { pointerId: 99, pointerType: "touch", clientX: 10 });
    expect(inputManager.getInput().steer).toBeCloseTo(steerBeforeOtherFinger, 5);
    expect(steerPadMock.classList.contains("active")).toBe(true);

    // 指を離すと steer === 0 に戻り、キャッシュもクリアされること
    steerPadMock.emit("pointerup", { pointerId: 5, pointerType: "touch", clientX: 150 });
    expect(inputManager.getInput().steer).toBe(0);
    expect(steerPadMock.classList.contains("active")).toBe(false);

    // アナログ操舵中に clearAllInputs() が呼ばれた場合も active クラス・舵角・DOMRect キャッシュが確実にクリアされること
    steerPadMock.emit("pointerdown", { pointerId: 6, pointerType: "touch", clientX: 160 });
    expect(steerPadMock.getRectCallCount()).toBe(3);
    expect(steerPadMock.classList.contains("active")).toBe(true);
    inputManager.clearAllInputs();
    expect(steerPadMock.classList.contains("active")).toBe(false);
    expect(inputManager.getInput().steer).toBe(0);

    // 2. キャンバス上のタッチスワイプ自由視線と2本目ポインタの干渉防止
    let accumulatedYaw = 0;
    let accumulatedPitch = 0;
    inputManager.onGazeDragDelta = (dYaw, dPitch) => {
      accumulatedYaw += dYaw;
      accumulatedPitch += dPitch;
    };

    canvasMock.emit("pointerdown", {
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      clientX: 100,
      clientY: 200,
    });
    // 視線ドラッグ中に2本目の指 (pointerId = 2) がキャンバスに触れても基準座標が飛ばないこと
    canvasMock.emit("pointerdown", {
      pointerId: 2,
      pointerType: "touch",
      button: 0,
      clientX: 350,
      clientY: 50,
    });
    canvasMock.emit("pointermove", {
      pointerId: 1,
      pointerType: "touch",
      clientX: 150,
      clientY: 180,
    });
    // dx = +50 -> deltaYaw = -50 * 0.0048 = -0.24 rad, dy = -20 -> deltaPitch = +20 * 0.0048 = +0.096 rad
    expect(accumulatedYaw).toBeCloseTo(-0.24, 5);
    expect(accumulatedPitch).toBeCloseTo(0.096, 5);
    canvasMock.emit("pointerup", {
      pointerId: 1,
      pointerType: "touch",
      clientX: 150,
      clientY: 180,
    });

    // 3. キャンバス上のタッチダブルタップによる正面視線リセット（同一ミリ秒発火および timeStamp 差分の双方で機能すること）
    let lastGazePreset: string | null = null;
    inputManager.onGazePreset = (preset) => {
      lastGazePreset = preset;
    };

    canvasMock.emit("pointerdown", {
      pointerId: 7,
      pointerType: "touch",
      button: 0,
      clientX: 180,
      clientY: 220,
      timeStamp: 1000,
    });
    canvasMock.emit("pointerup", {
      pointerId: 7,
      pointerType: "touch",
      clientX: 182,
      clientY: 221,
      timeStamp: 1040,
    });
    expect(lastGazePreset).toBeNull();

    canvasMock.emit("pointerdown", {
      pointerId: 8,
      pointerType: "touch",
      button: 0,
      clientX: 184,
      clientY: 222,
      timeStamp: 1180,
    });
    canvasMock.emit("pointerup", {
      pointerId: 8,
      pointerType: "touch",
      clientX: 185,
      clientY: 222,
      timeStamp: 1210,
    });
    expect(lastGazePreset).toBe("forward");
  });

  it("MobileHudController がドロワー開閉・GIS表示トグル・タッチUI表示モード (auto/on/off) を正しく状態遷移させることを保証する", () => {
    const inputManager = new InputManager();
    const mobileHud = new MobileHudController({ inputManager });

    expect(mobileHud.getDrawerOpen()).toBe(false);
    mobileHud.setDrawerOpen(true);
    expect(mobileHud.getDrawerOpen()).toBe(true);
    mobileHud.setDrawerOpen(false);
    expect(mobileHud.getDrawerOpen()).toBe(false);

    expect(mobileHud.getGisExpandedOnMobile()).toBe(false);
    mobileHud.setGisExpandedOnMobile(true);
    expect(mobileHud.getGisExpandedOnMobile()).toBe(true);

    expect(mobileHud.getTouchUiMode()).toBe("auto");
    mobileHud.setTouchUiMode("on");
    expect(mobileHud.isVirtualTouchVisible()).toBe(true);

    mobileHud.setTouchUiMode("off");
    expect(mobileHud.isVirtualTouchVisible()).toBe(false);
  });

  it("グラフィック品質プリセット（高 high / 中 medium / 低 low）の三段階定義、サイクル遷移、URLクエリ解析、レンダーターゲット解像度計算、および WeatherSystem 連動を保証する", async () => {
    const {
      GRAPHICS_QUALITY_ORDER,
      getGraphicsQualityPreset,
      getNextGraphicsQuality,
      isGraphicsQuality,
      parseGraphicsQualityQuery,
      computeScaledRenderDimensions,
    } = await import("../core/graphicsQuality");

    // 1. 三段階プリセット順序と型ガード
    expect(GRAPHICS_QUALITY_ORDER).toEqual(["high", "medium", "low"]);
    expect(isGraphicsQuality("high")).toBe(true);
    expect(isGraphicsQuality("medium")).toBe(true);
    expect(isGraphicsQuality("low")).toBe(true);
    expect(isGraphicsQuality("ultra")).toBe(false);
    expect(isGraphicsQuality("")).toBe(false);
    expect(isGraphicsQuality(null)).toBe(false);
    expect(isGraphicsQuality(undefined)).toBe(false);

    // 2. サイクル遷移（高 → 中 → 低 → 高）
    expect(getNextGraphicsQuality("high")).toBe("medium");
    expect(getNextGraphicsQuality("medium")).toBe("low");
    expect(getNextGraphicsQuality("low")).toBe("high");

    // 3. URLクエリパラメータ解析（?graphics=... / ?quality=... および大文字・空白・不正値フォールバック）
    expect(parseGraphicsQualityQuery("?graphics=low")).toBe("low");
    expect(parseGraphicsQualityQuery("?graphics=medium")).toBe("medium");
    expect(parseGraphicsQualityQuery("?graphics=HIGH")).toBe("high");
    expect(parseGraphicsQualityQuery("?quality=low")).toBe("low");
    expect(parseGraphicsQualityQuery("?area=shibuya&graphics=medium&time=night")).toBe("medium");
    expect(parseGraphicsQualityQuery("?graphics=invalid", "high")).toBe("high");
    expect(parseGraphicsQualityQuery("", "medium")).toBe("medium");

    // 4. レンダーターゲット解像度計算と境界値（0 / 負数 / NaN / スケールクランプ）
    expect(computeScaledRenderDimensions(1920, 1080, 1.0)).toEqual({ width: 1920, height: 1080 });
    expect(computeScaledRenderDimensions(1920, 1080, 0.8)).toEqual({ width: 1536, height: 864 });
    expect(computeScaledRenderDimensions(1920, 1080, 0.6)).toEqual({ width: 1152, height: 648 });
    expect(computeScaledRenderDimensions(0, -10, 0.6)).toEqual({ width: 1, height: 1 });
    expect(computeScaledRenderDimensions(Number.NaN, Number.NaN, Number.NaN)).toEqual({
      width: 1,
      height: 1,
    });

    // 5. 各段階のプリセット値の単調減少性（high > medium > low）
    const high = getGraphicsQualityPreset("high");
    const medium = getGraphicsQualityPreset("medium");
    const low = getGraphicsQualityPreset("low");
    expect(high.renderScale).toBeGreaterThan(medium.renderScale);
    expect(medium.renderScale).toBeGreaterThan(low.renderScale);
    expect(high.cloudMarchSteps).toBeGreaterThan(medium.cloudMarchSteps);
    expect(medium.cloudMarchSteps).toBeGreaterThan(low.cloudMarchSteps);
    expect(high.rainParticleCount).toBeGreaterThan(medium.rainParticleCount);
    expect(medium.rainParticleCount).toBeGreaterThan(low.rainParticleCount);
    expect(high.shadowsEnabled).toBe(true);
    expect(medium.shadowsEnabled).toBe(true);
    expect(low.shadowsEnabled).toBe(false);
    expect(high.postProcessLensFlare).toBe(true);
    expect(medium.postProcessLensFlare).toBe(true);
    expect(low.postProcessLensFlare).toBe(false);

    // 6. WeatherSystem.setGraphicsQuality によるシャドウ・雨パーティクル数・スプラッシュ数の動的スケーリング
    const scene = new THREE.Scene();
    const weatherSystem = new WeatherSystem(scene);
    weatherSystem.setEnvironment("night", "rain");

    weatherSystem.setGraphicsQuality("high");
    expect(weatherSystem.currentGraphicsQuality).toBe("high");
    expect(weatherSystem.dirLight.castShadow).toBe(true);
    expect(weatherSystem.dirLight.shadow.mapSize.x).toBe(2048);
    expect(weatherSystem.rainMesh.count).toBe(8500);
    expect(weatherSystem.rainSplashMesh.count).toBe(2600);
    expect(weatherSystem.rainSplashMesh.visible).toBe(true);

    weatherSystem.setGraphicsQuality("medium");
    expect(weatherSystem.currentGraphicsQuality).toBe("medium");
    expect(weatherSystem.dirLight.castShadow).toBe(true);
    expect(weatherSystem.dirLight.shadow.mapSize.x).toBe(1024);
    expect(weatherSystem.rainMesh.count).toBe(4500);
    expect(weatherSystem.rainSplashMesh.count).toBe(1200);
    expect(weatherSystem.rainSplashMesh.visible).toBe(true);

    weatherSystem.setGraphicsQuality("low");
    expect(weatherSystem.currentGraphicsQuality).toBe("low");
    expect(weatherSystem.dirLight.castShadow).toBe(false);
    expect(weatherSystem.rainMesh.count).toBe(1800);
    expect(weatherSystem.rainSplashMesh.count).toBe(0);
    expect(weatherSystem.rainSplashMesh.visible).toBe(false);

    // 雨天中に update() を呼んでも low 品質では rainSplashMesh.visible が false のまま維持されること
    weatherSystem.update(0.016, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 10));
    expect(weatherSystem.rainMesh.visible).toBe(true);
    expect(weatherSystem.rainSplashMesh.visible).toBe(false);

    // 晴天に切り替えた後、再度雨天に戻しても low 品質のパーティクル上限が保持されること
    weatherSystem.setEnvironment("day", "clear");
    expect(weatherSystem.rainMesh.visible).toBe(false);
    weatherSystem.setEnvironment("day", "rain");
    expect(weatherSystem.rainMesh.visible).toBe(true);
    expect(weatherSystem.rainMesh.count).toBe(1800);
    expect(weatherSystem.rainSplashMesh.visible).toBe(false);

    // 7. シャドウマップ解像度変更時に既存の WebGLRenderTarget が dispose されて null リセットされること
    let disposedCount = 0;
    weatherSystem.dirLight.shadow.map = {
      dispose: () => {
        disposedCount += 1;
      },
    } as unknown as THREE.WebGLRenderTarget;
    weatherSystem.setGraphicsQuality("high");
    expect(disposedCount).toBe(1);
    expect(weatherSystem.dirLight.shadow.map).toBeNull();
    expect(weatherSystem.dirLight.shadow.mapSize.x).toBe(2048);
  });
});

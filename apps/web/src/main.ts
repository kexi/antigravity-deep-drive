import * as THREE from "three";
import { PhysicsWorld } from "./physics/physicsWorld";
import { VehiclePhysics } from "./physics/vehicle";
import { CarModel } from "./vehicle/carModel";
import { TokyoStationMap } from "./city/tokyoStationMap";
import { WeatherSystem } from "./weather/weatherSystem";
import { CameraController } from "./core/cameraController";
import { InputManager } from "./core/inputManager";
import { MotionBlurPass } from "./shaders/motionBlur";
import { DepthFogPass } from "./shaders/depthFog";
import { LensFlarePass } from "./shaders/lensFlare";
import { assetManager } from "./assets/assetManager";
import {
  findNearestGsiRoad,
  findNearestPlateauBuilding,
  loadTokyoOpenData,
  localToWgs84,
  sampleGsiDemElevation,
} from "./openData/gsiPlateauLoader";
import type { CameraMode, WeatherType, WiperMode } from "./types";

async function bootstrap() {
  const canvas = document.getElementById("webgl-canvas") as HTMLCanvasElement;
  const hasNoCanvas = !canvas;
  if (hasNoCanvas) {
    return;
  }

  // 0. YAML アセットマニフェスト & 東京都PLATEAU・国土地理院オープンデータの読み込み
  await Promise.all([assetManager.loadFromUrl(), loadTokyoOpenData()]);

  // 1. レンダラー初期化
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();

  // 2. 物理エンジン初期化 (Rapier 3D)
  const physics = await PhysicsWorld.getInstance();
  const world = physics.world;
  const rapier = physics.rapier;

  // 3. 東京駅・丸の内周辺都市マップ構築
  const cityMap = new TokyoStationMap(scene, world, rapier);

  // 4. 車両物理 & 3Dモデル構築（行幸通りの日本の左側通行車線 x=+3.5m・交差点通過後からスタート）
  const startPosition = new THREE.Vector3(3.5, 0.8, 26);
  const vehiclePhysics = new VehiclePhysics(world, rapier, startPosition);
  const carModel = new CarModel();
  scene.add(carModel.group);

  // 5. 天候システム・レンズフレア初期化（YAMLデフォルト設定適用）
  const weatherSystem = new WeatherSystem(scene);
  const defaultWeatherPreset = assetManager.getDefaultWeather();
  weatherSystem.applyPreset(defaultWeatherPreset);
  cityMap.updateRainWetness(weatherSystem.wetness, 0, weatherSystem.getPuddleEnvironmentParams());

  // 6. カメラコントローラー
  const cameraController = new CameraController(window.innerWidth / window.innerHeight);

  // 7. ポストプロセス（深度フォグ & 光学レンズフレア & モーションブラー）
  const depthFogPass = new DepthFogPass(
    window.innerWidth,
    window.innerHeight,
    cameraController.camera,
  );
  const lensFlarePass = new LensFlarePass(window.innerWidth, window.innerHeight);
  const motionBlurPass = new MotionBlurPass(window.innerWidth, window.innerHeight);
  let motionBlurEnabled = true;

  // 天候パラメータに応じた深度フォグ & レンズフレア設定更新ヘルパー
  const updatePostProcessesForWeather = (weather: WeatherType) => {
    const yamlPreset = assetManager.getWeatherPreset(weather);
    const hasPreset = yamlPreset !== undefined;
    if (hasPreset) {
      depthFogPass.setFogParams({
        fogColor: yamlPreset!.fogColor,
        sunColor: yamlPreset!.sunColor,
        sunDirection: weatherSystem.getSunDirection(),
        density: yamlPreset!.fogDensity * 1.5,
        heightFalloff: 0.04,
      });
      lensFlarePass.setParams({
        enabled: yamlPreset!.lensflare.enabled,
        intensity: yamlPreset!.lensflare.intensity,
        flareColor: yamlPreset!.lensflare.color,
        sunColor: yamlPreset!.sunColor,
      });
      lensFlarePass.setSunWorldPosition(weatherSystem.getSunWorldPosition());
      return;
    }

    // デフォルトフォールバック
    const flareCfg = weatherSystem.getLensFlareConfig();
    lensFlarePass.setParams({
      enabled: flareCfg.enabled,
      intensity: flareCfg.intensity,
      flareColor: flareCfg.color,
      sunColor: weatherSystem.getSunColor().getHex(),
    });
    lensFlarePass.setSunWorldPosition(weatherSystem.getSunWorldPosition());

    const isSunset = weather === "sunset";
    if (isSunset) {
      depthFogPass.setFogParams({
        fogColor: 0xfdba74,
        sunColor: 0xfb923c,
        sunDirection: weatherSystem.getSunDirection(),
        density: 0.007,
        heightFalloff: 0.05,
      });
      return;
    }

    const isRain = weather === "rain";
    if (isRain) {
      depthFogPass.setFogParams({
        fogColor: 0x64748b,
        sunColor: 0x94a3b8,
        sunDirection: weatherSystem.getSunDirection(),
        density: 0.018,
        heightFalloff: 0.08,
      });
      return;
    }

    const isNight = weather === "night";
    if (isNight) {
      depthFogPass.setFogParams({
        fogColor: 0x0f172a,
        sunColor: 0x38bdf8,
        sunDirection: weatherSystem.getSunDirection(),
        density: 0.006,
        heightFalloff: 0.04,
      });
      return;
    }

    depthFogPass.setFogParams({
      fogColor: 0x93c5fd,
      sunColor: 0xfffaed,
      sunDirection: weatherSystem.getSunDirection(),
      density: 0.003,
      heightFalloff: 0.03,
    });
  };

  // 初期天候のポストプロセス適用
  updatePostProcessesForWeather(weatherSystem.currentWeather);

  // 8. 入力管理
  const inputManager = new InputManager();

  // 状態管理（初期天候が雨天のときのみワイパーを slow で起動、晴天時は off でカウルに収納）
  const isInitialRain = weatherSystem.currentWeather === "rain";
  let currentWiperMode: WiperMode = isInitialRain ? "slow" : "off";

  // ワイパー切り替え
  const setWiperMode = (mode: WiperMode) => {
    currentWiperMode = mode;
    carModel.setWiperMode(mode);
    const wiperBtns = document.querySelectorAll<HTMLButtonElement>("#wiper-buttons button");
    wiperBtns.forEach((b) => {
      b.classList.toggle("active", b.dataset.wiper === mode);
    });
  };
  setWiperMode(currentWiperMode);

  // --- UI連携 ---
  const speedDisplay = document.getElementById("speed-display");
  const gearIndicator = document.getElementById("gear-indicator");
  const blurStatus = document.getElementById("blur-status");
  const gisCoordDisplay = document.getElementById("gis-coord-display");
  const gisRoadDisplay = document.getElementById("gis-road-display");
  const gisBldgDisplay = document.getElementById("gis-bldg-display");

  // 天候ボタン（初期天候プリセットに合わせてボタンの active 表示を同期）
  const weatherBtns = document.querySelectorAll<HTMLButtonElement>("#weather-buttons button");
  weatherBtns.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.weather === weatherSystem.currentWeather);
    btn.addEventListener("click", () => {
      const weather = btn.dataset.weather as WeatherType;
      weatherBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const yamlPreset = assetManager.getWeatherPreset(weather);
      const hasPreset = yamlPreset !== undefined;
      if (hasPreset) {
        weatherSystem.applyPreset(yamlPreset!);
      } else {
        weatherSystem.setWeather(weather);
      }
      cityMap.setNightMode(weather === "night");
      const isRainWeather = weather === "rain";
      carModel.setHeadlights(weather === "night" || isRainWeather);
      const shouldAutoStartWiper = isRainWeather && currentWiperMode === "off";
      const shouldAutoStopWiper = !isRainWeather && currentWiperMode !== "off";
      if (shouldAutoStartWiper) {
        setWiperMode("slow");
      } else if (shouldAutoStopWiper) {
        setWiperMode("off");
      }
      updatePostProcessesForWeather(weather);
    });
  });

  // カメラ視点切り替え
  const setCameraMode = (mode: CameraMode) => {
    cameraController.setMode(mode);
    const cameraBtns = document.querySelectorAll<HTMLButtonElement>("#camera-buttons button");
    cameraBtns.forEach((b) => {
      b.classList.toggle("active", b.dataset.camera === mode);
    });
  };

  const cameraBtns = document.querySelectorAll<HTMLButtonElement>("#camera-buttons button");
  cameraBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.camera as CameraMode;
      setCameraMode(mode);
    });
  });
  inputManager.onCameraToggle = () => {
    const nextMode = cameraController.mode === "cockpit" ? "chase" : "cockpit";
    setCameraMode(nextMode);
  };

  const wiperBtns = document.querySelectorAll<HTMLButtonElement>("#wiper-buttons button");
  wiperBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.wiper as WiperMode;
      setWiperMode(mode);
    });
  });
  inputManager.onWiperToggle = () => {
    const modes: WiperMode[] = ["off", "slow", "fast"];
    const nextIndex = (modes.indexOf(currentWiperMode) + 1) % modes.length;
    setWiperMode(modes[nextIndex]);
  };

  // モーションブラー切り替え
  const setBlurMode = (enabled: boolean) => {
    motionBlurEnabled = enabled;
    const blurBtns = document.querySelectorAll<HTMLButtonElement>("#blur-buttons button");
    blurBtns.forEach((b) => {
      b.classList.toggle("active", b.dataset.blur === (enabled ? "on" : "off"));
    });
    const hasBlurStatus = blurStatus !== null;
    if (hasBlurStatus) {
      blurStatus.textContent = `MOTION BLUR: ${enabled ? "ACTIVE" : "OFF"}`;
      blurStatus.style.color = enabled ? "#a855f7" : "#64748b";
    }
  };

  const blurBtns = document.querySelectorAll<HTMLButtonElement>("#blur-buttons button");
  blurBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      setBlurMode(btn.dataset.blur === "on");
    });
  });
  inputManager.onBlurToggle = () => {
    setBlurMode(!motionBlurEnabled);
  };

  // 車両リセット
  inputManager.onResetVehicle = () => {
    vehiclePhysics.resetPosition(startPosition);
  };

  // リサイズハンドラ
  window.addEventListener("resize", () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height);
    cameraController.onResize(width / height);
    depthFogPass.setSize(width, height);
    lensFlarePass.setSize(width, height);
    motionBlurPass.setSize(width, height);
  });

  // --- メインループ ---
  let lastTime = performance.now();

  function animate() {
    requestAnimationFrame(animate);

    const currentTime = performance.now();
    const dt = Math.min((currentTime - lastTime) / 1000, 0.05);
    lastTime = currentTime;

    // 1. 入力取得・物理更新
    const input = inputManager.getInput();
    vehiclePhysics.update(dt, input);
    physics.step(dt);

    // 2. 車両ステート同期
    const vehicleState = vehiclePhysics.getState();
    const carPos = new THREE.Vector3(
      vehicleState.position.x,
      vehicleState.position.y,
      vehicleState.position.z,
    );
    const carVelocity = new THREE.Vector3(
      vehicleState.velocity.x,
      vehicleState.velocity.y,
      vehicleState.velocity.z,
    );

    // 3. 天候 & 雨シミュレーション更新（水たまりシェーダーへ太陽・空色・波紋強度を同期）
    weatherSystem.update(dt, carPos, carVelocity);
    cityMap.updateRainWetness(
      weatherSystem.wetness,
      currentTime * 0.001,
      weatherSystem.getPuddleEnvironmentParams(),
    );

    // 4. 車体メッシュ & ワイパー & フロントガラス更新
    carModel.update(dt, vehicleState, weatherSystem.rainIntensity);

    // 5. カメラ更新
    cameraController.update(dt, vehicleState, carModel.group);

    // 5.1 大気スカイドームのカメラ追従 & 雲流動更新
    weatherSystem.updateSky(currentTime * 0.001, cameraController.camera.position);

    // 6. ポストプロセスパイプライン描画（深度フォグ → レンズフレア → モーションブラー）
    // Step 1: シーンを深度テクスチャ付きレンダーターゲットへ描画
    renderer.setRenderTarget(depthFogPass.renderTarget);
    renderer.render(scene, cameraController.camera);

    // Step 2: 深度フォグ（大気高度減衰・ミー散乱）を適用してレンズフレアレンダーターゲットへ描画
    depthFogPass.render(renderer, depthFogPass.renderTarget.texture, lensFlarePass.renderTarget);

    // Step 3: レンズフレア（深度オクルージョン・スターバースト・アナモルフィック光条）を適用してモーションブラーレンダーターゲットへ描画
    lensFlarePass.updateSunPosition(cameraController.camera);
    lensFlarePass.render(
      renderer,
      lensFlarePass.renderTarget.texture,
      depthFogPass.renderTarget.depthTexture,
      motionBlurPass.renderTarget,
    );

    // Step 4: モーションブラーを適用して画面へ最終出力
    motionBlurPass.update(vehicleState.speedKmh, motionBlurEnabled);
    motionBlurPass.renderFromTexture(renderer, motionBlurPass.renderTarget.texture, null);

    // 7. HUD更新（スピードメーター & 東京都PLATEAU / 国土地理院 GIS テレメトリ）
    const hasSpeedDisplay = Boolean(speedDisplay);
    if (hasSpeedDisplay) {
      speedDisplay!.textContent = Math.round(vehicleState.speedKmh).toString();
    }
    const hasGearIndicator = Boolean(gearIndicator);
    if (hasGearIndicator) {
      gearIndicator!.textContent = vehicleState.gear;
    }

    const hasGisCoordDisplay = Boolean(gisCoordDisplay);
    if (hasGisCoordDisplay) {
      const wgs = localToWgs84(carPos.x, carPos.z);
      const demTp = sampleGsiDemElevation(carPos.x, carPos.z);
      gisCoordDisplay!.textContent = `${wgs.lat.toFixed(5)}°N, ${wgs.lon.toFixed(5)}°E (TP +${demTp.toFixed(2)}m)`;
    }

    const hasGisRoadDisplay = Boolean(gisRoadDisplay);
    if (hasGisRoadDisplay) {
      const nearestRoad = findNearestGsiRoad(carPos.x, carPos.z);
      gisRoadDisplay!.textContent = `${nearestRoad.displayName} [${nearestRoad.rnkWidth}]`;
    }

    const hasGisBldgDisplay = Boolean(gisBldgDisplay);
    if (hasGisBldgDisplay) {
      const nearestBldg = findNearestPlateauBuilding(carPos.x, carPos.z);
      gisBldgDisplay!.textContent = `${nearestBldg.name} (${nearestBldg.measuredHeight}m / ${nearestBldg.storeysAboveGround}F・${nearestBldg.buildingId})`;
    }
  }

  animate();
}

bootstrap().catch(console.error);

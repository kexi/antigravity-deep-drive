import * as THREE from "three";
import { PhysicsWorld } from "./physics/physicsWorld";
import { VehiclePhysics } from "./physics/vehicle";
import { CarModel } from "./vehicle/carModel";
import { TokyoStationMap, type DriveAreaId } from "./city/tokyoStationMap";
import {
  OpenWorldStreamingSystem,
  type OpenWorldStreamingStatus,
  type WorldChunkId,
} from "./city/openWorldStreaming";
import { WeatherSystem } from "./weather/weatherSystem";
import { CameraController } from "./core/cameraController";
import { InputManager } from "./core/inputManager";
import { MobileHudController } from "./core/mobileHudController";
import { EngineAudioSystem } from "./audio/engineAudioSystem";
import {
  computeScaledRenderDimensions,
  getGraphicsQualityPreset,
  getNextGraphicsQuality,
  isGraphicsQuality,
  parseGraphicsQualityQuery,
} from "./core/graphicsQuality";
import {
  applyDocumentTranslations,
  formatGsiRoadTelemetry,
  formatLabelPair,
  formatPlateauBuildingTelemetry,
  getUiTranslations,
  i18n,
  isSupportedLocale,
  localizeGamepadStatusText,
  localizeGraphicsQualityTexts,
  resolveInitialLocale,
} from "./core/i18n";
import { logger } from "./core/logger";
import {
  buildUrlWithBoostOption,
  parseBoostOption,
  prebuildSceneShaders,
  type ShaderPrebuildReport,
} from "./core/shaderPrebuilder";
import { RoadSignCreatorUI } from "./roads/roadSignCreatorUI";
import { RoadProps } from "./roads/roadProps";
import { MotionBlurPass } from "./shaders/motionBlur";
import { DepthFogPass } from "./shaders/depthFog";
import { LensFlarePass } from "./shaders/lensFlare";
import { assetManager } from "./assets/assetManager";
import { AssetManagerUI, parseAssetManagerOption } from "./assets/assetManagerUI";
import {
  findNearestGsiRoad,
  findNearestPlateauBuilding,
  loadTokyoOpenData,
  localToWgs84,
  sampleGsiDemElevation,
} from "./openData/gsiPlateauLoader";
import type {
  CameraMode,
  GazePreset,
  GraphicsQuality,
  RoadSurfaceCondition,
  TimeOfDay,
  TurnSignalState,
  WeatherCondition,
  WiperMode,
} from "./types";

async function bootstrap() {
  const canvas = document.getElementById("webgl-canvas") as HTMLCanvasElement;
  const hasNoCanvas = !canvas;
  if (hasNoCanvas) {
    return;
  }

  const bootTrace = logger.startTrace("app.bootstrap");

  // タイトル画面・ローディングプログレス要素の取得
  const titleScreenOverlay = document.getElementById("title-screen-overlay");
  const loadingProgressBar = document.getElementById("loading-progress-bar");
  const loadingProgressFill = document.getElementById("loading-progress-fill");
  const loadingStatusText = document.getElementById("loading-status-text");
  const loadingPercentText = document.getElementById("loading-percent-text");
  const loadingChunkDetail = document.getElementById("loading-chunk-detail");
  const loadingRetryBtn = document.getElementById("loading-retry-btn") as HTMLButtonElement | null;
  const startDriveBtn = document.getElementById("start-drive-btn") as HTMLButtonElement | null;

  // オープンワールド・ストリーミングバナー要素
  const worldStreamingBanner = document.getElementById("world-streaming-banner");
  const streamingBannerTitle = document.getElementById("streaming-banner-title");
  const streamingBannerPercent = document.getElementById("streaming-banner-percent");
  const streamingBannerFill = document.getElementById("streaming-banner-fill");
  const streamingBannerDetail = document.getElementById("streaming-banner-detail");
  const streamingBannerRetryBtn = document.getElementById(
    "streaming-banner-retry-btn",
  ) as HTMLButtonElement | null;

  type LoadingStageKey =
    | "loadingStageInit"
    | "loadingStageOpenData"
    | "loadingStageTextures"
    | "loadingStagePhysics"
    | "loadingStageCity"
    | "loadingStagePriorityChunks"
    | "loadingStageShaderPrebuild"
    | "loadingStageReady";

  let currentLoadingStageKey: LoadingStageKey = "loadingStageInit";
  let currentLoadingPercent = 10;

  const updateLoadingProgress = (percent: number, stageKey: LoadingStageKey) => {
    currentLoadingPercent = Math.max(0, Math.min(100, Math.round(percent)));
    currentLoadingStageKey = stageKey;
    const dict = i18n.t();
    const hasFill = loadingProgressFill !== null;
    if (hasFill) {
      loadingProgressFill.style.width = `${currentLoadingPercent}%`;
    }
    const hasBar = loadingProgressBar !== null;
    if (hasBar) {
      loadingProgressBar.setAttribute("aria-valuenow", String(currentLoadingPercent));
    }
    const hasPercent = loadingPercentText !== null;
    if (hasPercent) {
      loadingPercentText.textContent = `${currentLoadingPercent}%`;
    }
    const hasStatus = loadingStatusText !== null;
    if (hasStatus) {
      loadingStatusText.textContent = dict[stageKey];
    }
  };

  // 0.0 ブラウザ言語設定（navigator.languages / navigator.language）および URL クエリ (?lang=ja|en|zh) から初期表示言語を決定
  const initialLocale = resolveInitialLocale({ search: window.location.search });
  i18n.setLocale(initialLocale);
  applyDocumentTranslations(initialLocale);
  updateLoadingProgress(15, "loadingStageOpenData");

  // 0. YAML アセットマニフェスト & 東京都PLATEAU・国土地理院オープンデータの読み込み
  await logger.withAsyncTrace(
    "bootstrap",
    "loadAssetsAndOpenData",
    async () => {
      await Promise.all([assetManager.loadFromUrl(), loadTokyoOpenData()]);
    },
    { target: "assets.yml + plateau_13101_13113 + gsi_dem5a" },
  );
  updateLoadingProgress(40, "loadingStageTextures");

  // 1. レンダラー初期化
  let currentGraphicsQuality: GraphicsQuality = parseGraphicsQualityQuery(
    window.location.search,
    "high",
  );
  const initialGraphicsPreset = getGraphicsQualityPreset(currentGraphicsQuality);
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, initialGraphicsPreset.maxPixelRatio));
  renderer.shadowMap.enabled = initialGraphicsPreset.shadowsEnabled;
  renderer.shadowMap.type = initialGraphicsPreset.shadowMapType;
  // Why 毎フレームの全シャドウマップ再計算 (autoUpdate = true) を無効化し間引き更新にするか:
  // 広域都市シーンの 2048px シャドウマップを毎フレーム再描画すると GPU 頂点負荷が増大するため、
  // 数フレームおきおよび環境変更時に needsUpdate = true で更新することで 30fps 以上を安定維持する。
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();

  // 2. 物理エンジン初期化 (Rapier 3D)
  updateLoadingProgress(58, "loadingStagePhysics");
  const physics = await logger.withAsyncTrace("physics", "initRapierWorld", async () =>
    PhysicsWorld.getInstance(),
  );
  const world = physics.world;
  const rapier = physics.rapier;

  // 3. 渋谷ストリーム周辺 & 東京駅・丸の内 都市マップ構築（ランドマークGLB・遠方チャンクは遅延優先ロード）
  updateLoadingProgress(75, "loadingStageCity");
  const cityMap = logger.withTrace("city", "buildTokyoStationMap", () => {
    return new TokyoStationMap(scene, world, rapier, { deferGlbLoads: true });
  });

  // 3.1 オープンワールド型チャンクストリーミング＆メモリ管理システム初期化
  const streamingSystem = new OpenWorldStreamingSystem({
    quality: currentGraphicsQuality,
    callbacks: {
      onActivateChunk: async (chunkId) => {
        await cityMap.activateWorldChunk(chunkId);
        renderer.shadowMap.needsUpdate = true;
      },
      onEvictChunk: (chunkId) => {
        cityMap.evictWorldChunk(chunkId);
        renderer.shadowMap.needsUpdate = true;
      },
      onUpdateChunkTransition: (chunkId, alpha) => {
        cityMap.setWorldChunkTransition(chunkId, alpha);
      },
      getGpuMemoryStats: () => ({
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
      }),
    },
  });
  const chunkObjectCounts = cityMap.getChunkObjectCounts();
  for (const [chunkId, count] of Object.entries(chunkObjectCounts)) {
    streamingSystem.setChunkBoundObjectCount(chunkId as WorldChunkId, count);
  }

  // 4. 車両物理 & 3Dモデル構築（デフォルト: 渋谷ストリーム前・明治通りからスタート）
  const urlParams = new URLSearchParams(window.location.search);
  const rawQueryArea = urlParams.get("area");
  const isInitialTokyo = rawQueryArea === "tokyo";
  let currentDriveArea: DriveAreaId = isInitialTokyo ? "tokyo" : "shibuya";

  const rawQueryX = urlParams.get("x");
  const parsedQueryX = rawQueryX !== null ? Number(rawQueryX) : Number.NaN;
  const hasValidQueryX = Number.isFinite(parsedQueryX);

  const rawQueryZ = urlParams.get("z");
  const parsedQueryZ = rawQueryZ !== null ? Number(rawQueryZ) : Number.NaN;
  const hasValidQueryZ = Number.isFinite(parsedQueryZ);

  const rawQueryHeading = urlParams.get("heading");
  const parsedQueryHeading = rawQueryHeading !== null ? Number(rawQueryHeading) : Number.NaN;
  const hasValidQueryHeading = Number.isFinite(parsedQueryHeading);

  const initialAreaSpawn = TokyoStationMap.getAreaSpawnTransform(currentDriveArea);
  const startX = hasValidQueryX ? parsedQueryX : initialAreaSpawn.position.x;
  const startZ = hasValidQueryZ ? parsedQueryZ : initialAreaSpawn.position.z;
  const startYaw = hasValidQueryHeading ? parsedQueryHeading : initialAreaSpawn.yawRadians;
  const startPosition = new THREE.Vector3(startX, initialAreaSpawn.position.y, startZ);
  let activeSpawnTransform = {
    position: startPosition.clone(),
    yawRadians: startYaw,
  };
  const vehiclePhysics = new VehiclePhysics(world, rapier, startPosition);
  const hasCustomInitialHeading = startYaw !== 0;
  if (hasCustomInitialHeading) {
    vehiclePhysics.resetPosition(startPosition, startYaw);
  }
  vehiclePhysics.setObstacleColliderHandles(cityMap.obstacleColliderHandles);
  const carModel = new CarModel();
  carModel.setLocale(i18n.getLocale());
  scene.add(carModel.group);

  // 5. 時間帯 × 天候システム・レンズフレア初期化（YAMLデフォルト設定適用）
  const weatherSystem = new WeatherSystem(scene);
  const defaultWeatherPreset = assetManager.getDefaultWeather();
  weatherSystem.applyPreset(defaultWeatherPreset);
  cityMap.updateRainWetness(weatherSystem.wetness, 0, weatherSystem.getPuddleEnvironmentParams());

  // 6. カメラコントローラー
  const cameraController = new CameraController(window.innerWidth / window.innerHeight);

  // 7. ポストプロセス（深度フォグ & 光学レンズフレア & モーションブラー）
  const initialRenderSize = computeScaledRenderDimensions(
    window.innerWidth,
    window.innerHeight,
    initialGraphicsPreset.renderScale,
  );
  const depthFogPass = new DepthFogPass(
    initialRenderSize.width,
    initialRenderSize.height,
    cameraController.camera,
  );
  const lensFlarePass = new LensFlarePass(initialRenderSize.width, initialRenderSize.height);
  const motionBlurPass = new MotionBlurPass(initialRenderSize.width, initialRenderSize.height);
  let motionBlurEnabled = initialGraphicsPreset.postProcessMotionBlur;

  // 時間帯 × 天候パラメータに応じた深度フォグ & レンズフレア設定更新ヘルパー
  const updatePostProcessesForEnvironment = () => {
    const flareCfg = weatherSystem.getLensFlareConfig();
    const sunHex = weatherSystem.getSunColor().getHex();
    const isRain = weatherSystem.currentWeatherCondition === "rain";
    const isCloudy = weatherSystem.currentWeatherCondition === "cloudy";
    const isSunset = weatherSystem.currentTimeOfDay === "sunset";
    const isNight = weatherSystem.currentTimeOfDay === "night";
    const activeGraphicsPreset = getGraphicsQualityPreset(currentGraphicsQuality);

    lensFlarePass.setParams({
      enabled: flareCfg.enabled && activeGraphicsPreset.postProcessLensFlare,
      intensity: flareCfg.intensity,
      flareColor: flareCfg.color,
      sunColor: sunHex,
    });
    lensFlarePass.setSunWorldPosition(weatherSystem.getSunWorldPosition());

    // Why 夜間・雨天時に前方ミー散乱 (inscatteringIntensity) を減衰させるか:
    // 夜間や雨雲遮蔽時に inscatteringIntensity = 1.2 のままだと遠景ビルだけが月光色 (0x38bdf8) に明るく発光し、
    // 無限遠の夜空 (depth >= 0.9999, 0x020617) との境界が黒抜きの矩形シルエットのように見えてしまうため。
    const baseInscatter = isNight ? 0.08 : isSunset ? 1.2 : 0.72;
    const weatherInscatterMult = isRain ? 0.12 : isCloudy ? 0.35 : 1.0;

    depthFogPass.setFogParams({
      fogColor: weatherSystem.fogColorHex,
      sunColor: sunHex,
      sunDirection: weatherSystem.getSunDirection(),
      density: weatherSystem.fogDensity * 1.5,
      heightFalloff: isRain ? 0.08 : isCloudy ? 0.06 : isSunset ? 0.05 : 0.035,
      inscatteringIntensity: baseInscatter * weatherInscatterMult,
    });
  };

  // 8. 入力管理（キャンバス上のポインタドラッグ・ダブルクリックによる視線変更も有効化）
  const inputManager = new InputManager(canvas);

  // 8.1 エンジン音響合成システム（Web Audio API による 2.5L 直列4気筒 A25A-FXS マルチステージハイブリッド音響）
  const engineAudio = new EngineAudioSystem();

  // 状態管理（初期天候が雨天のときのみワイパーを slow で起動、晴天・曇天時は off でカウルに収納）
  const isInitialRain = weatherSystem.currentWeatherCondition === "rain";
  let currentWiperMode: WiperMode = isInitialRain ? "slow" : "off";

  // ワイパー切り替え
  const setWiperMode = (mode: WiperMode) => {
    currentWiperMode = mode;
    carModel.setWiperMode(mode);
    const wiperBtns = document.querySelectorAll<HTMLButtonElement>("#wiper-buttons button");
    wiperBtns.forEach((b) => {
      b.classList.toggle("active", b.dataset.wiper === mode);
    });
    logger.info("vehicle", "wiper.change", "Wiper mode updated", { wiperMode: mode });
  };
  setWiperMode(currentWiperMode);

  // --- UI連携 ---
  const speedDisplay = document.getElementById("speed-display");
  const gearIndicator = document.getElementById("gear-indicator");
  const turnSignalStatus = document.getElementById("turn-signal-status");
  const hudTurnSignalBadge = document.getElementById("hud-turn-signal-badge");
  const turnSignalBtns = document.querySelectorAll<HTMLButtonElement>(
    "#turn-signal-buttons button",
  );
  const soundStatus = document.getElementById("sound-status");
  const blurStatus = document.getElementById("blur-status");
  const graphicsStatus = document.getElementById("graphics-status");
  const boostStatus = document.getElementById("boost-status");
  const gamepadStatusBadge = document.getElementById("gamepad-status-badge");
  const gamepadHudStatus = document.getElementById("gamepad-hud-status");
  const hudClockBadge = document.getElementById("hud-clock-badge");
  const hudGazeBadge = document.getElementById("hud-gaze-badge");
  const hudSoundBadge = document.getElementById("hud-sound-badge");
  const soundVolumeSlider = document.getElementById(
    "sound-volume-slider",
  ) as HTMLInputElement | null;
  const soundVolumeValue = document.getElementById("sound-volume-value");
  const hudGraphicsBadge = document.getElementById("hud-graphics-badge");
  const hudBoostBadge = document.getElementById("hud-boost-badge");
  const quickSoundBtn = document.getElementById("quick-sound-btn") as HTMLButtonElement | null;
  const gisAreaHeader = document.getElementById("gis-area-header");
  const gisCoordDisplay = document.getElementById("gis-coord-display");
  const gisRoadDisplay = document.getElementById("gis-road-display");
  const gisBldgDisplay = document.getElementById("gis-bldg-display");
  const gisStreamingDisplay = document.getElementById("gis-streaming-display");
  const streamingStatus = document.getElementById("streaming-status");

  let warpBannerHideTimerId: number | null = null;
  let isWarpStreamingInProgress = false;

  const getLocalizedChunkName = (status: OpenWorldStreamingStatus): string => {
    const locale = i18n.getLocale();
    if (locale === "en") {
      return status.currentChunkNameEn;
    }
    if (locale === "zh") {
      return status.currentChunkNameZh;
    }
    return status.currentChunkNameJa;
  };

  const syncStreamingHudAndBanner = (status: OpenWorldStreamingStatus) => {
    const dict = i18n.t();
    const chunkLabel = getLocalizedChunkName(status);
    const detailSummary = `${chunkLabel} · ${status.activeChunkCount}/${status.totalChunkCount} Chunks (${status.estimatedMemoryUsedMb.toFixed(0)}/${status.memoryBudgetMb} MB)`;

    const hasLoadingDetail = loadingChunkDetail !== null;
    if (hasLoadingDetail) {
      loadingChunkDetail.textContent = status.canRetry
        ? `⚠️ ${status.lastErrorMessage ?? "Chunk Load Error"}`
        : `STREAMING: ${detailSummary}`;
      loadingChunkDetail.style.color = status.canRetry ? "#fda4af" : "#7dd3fc";
    }

    const hasLoadingRetry = loadingRetryBtn !== null;
    if (hasLoadingRetry) {
      loadingRetryBtn.style.display = status.canRetry ? "inline-block" : "none";
    }

    const hasGisStreaming = gisStreamingDisplay !== null;
    if (hasGisStreaming) {
      const prefetchSuffix =
        status.prefetchTargetIds.length > 0
          ? ` · +${status.prefetchTargetIds.length} Prefetch`
          : "";
      const evictedSuffix =
        status.totalEvictedCount > 0 ? ` · Evicted ${status.totalEvictedCount}` : "";
      gisStreamingDisplay.textContent = `${chunkLabel} (${status.activeChunkCount}/${status.totalChunkCount} Chunks · ${status.estimatedMemoryUsedMb.toFixed(0)}/${status.memoryBudgetMb}MB${prefetchSuffix}${evictedSuffix})`;
      gisStreamingDisplay.style.color = status.canRetry ? "#fda4af" : "#38bdf8";
    }

    const hasStreamingStatus = streamingStatus !== null;
    if (hasStreamingStatus) {
      const stateBadge = status.canRetry
        ? "RETRY"
        : status.phase === "streaming" || status.phase === "warping"
          ? "PREFETCH"
          : "ACTIVE";
      streamingStatus.textContent = `${dict.streamingStatusLabel}: ${status.activeChunkCount}/${status.totalChunkCount} CHUNKS · ${status.estimatedMemoryUsedMb.toFixed(0)}/${status.memoryBudgetMb}MB (${stateBadge})`;
      streamingStatus.style.color = status.canRetry
        ? "#f43f5e"
        : stateBadge === "PREFETCH"
          ? "#facc15"
          : "#38bdf8";
    }

    const hasBanner = worldStreamingBanner !== null;
    if (hasBanner) {
      const shouldShowBanner =
        isWarpStreamingInProgress || status.phase === "warping" || status.canRetry;
      if (shouldShowBanner) {
        worldStreamingBanner.classList.add("is-visible");
        worldStreamingBanner.classList.toggle("has-error", status.canRetry);
        worldStreamingBanner.setAttribute("aria-hidden", "false");
      } else if (warpBannerHideTimerId === null) {
        worldStreamingBanner.classList.remove("is-visible", "has-error");
        worldStreamingBanner.setAttribute("aria-hidden", "true");
      }

      const hasBannerTitle = streamingBannerTitle !== null;
      if (hasBannerTitle) {
        streamingBannerTitle.textContent = status.canRetry
          ? `⚠️ ${status.lastErrorMessage ?? dict.streamingBannerAreaTitle}`
          : isWarpStreamingInProgress
            ? dict.streamingBannerAreaTitle
            : dict.streamingBannerPrefetchTitle;
      }

      const hasBannerPercent = streamingBannerPercent !== null;
      if (hasBannerPercent) {
        streamingBannerPercent.textContent = `${status.priorityLoadProgressPercent}%`;
      }

      const hasBannerFill = streamingBannerFill !== null;
      if (hasBannerFill) {
        streamingBannerFill.style.width = `${status.priorityLoadProgressPercent}%`;
      }

      const hasBannerDetail = streamingBannerDetail !== null;
      if (hasBannerDetail) {
        streamingBannerDetail.textContent = detailSummary;
      }

      const hasBannerRetry = streamingBannerRetryBtn !== null;
      if (hasBannerRetry) {
        streamingBannerRetryBtn.classList.toggle("is-visible", status.canRetry);
      }
    }
  };

  streamingSystem.onStatusChange((status) => {
    syncStreamingHudAndBanner(status);
  });

  const handleManualStreamingRetry = () => {
    // シミュレート失敗フラグがあればクリアして再試行を成功させる
    for (const chunkState of streamingSystem.getAllChunkStates()) {
      if (chunkState.state === "failed") {
        streamingSystem.setSimulatedChunkFailure(chunkState.definition.id, false);
      }
    }
    void streamingSystem.retryFailedChunks().then((status) => {
      syncStreamingHudAndBanner(status);
      const isAllReady = !status.canRetry;
      if (isAllReady && startDriveBtn) {
        startDriveBtn.disabled = false;
      }
    });
  };

  loadingRetryBtn?.addEventListener("click", handleManualStreamingRetry);
  streamingBannerRetryBtn?.addEventListener("click", handleManualStreamingRetry);

  const syncGamepadHudStatus = () => {
    const status = inputManager.getGamepadStatus();
    const localizedText = localizeGamepadStatusText(status, i18n.getLocale());
    const hasBadge = gamepadStatusBadge !== null;
    if (hasBadge) {
      gamepadStatusBadge.textContent = localizedText;
      gamepadStatusBadge.classList.toggle("active", status.connected);
    }
    const hasHudStatus = gamepadHudStatus !== null;
    if (hasHudStatus) {
      gamepadHudStatus.textContent = localizedText;
      gamepadHudStatus.style.color = status.connected ? "#4ade80" : "#64748b";
    }
  };
  inputManager.onGamepadStatusChange = () => {
    syncGamepadHudStatus();
  };
  syncGamepadHudStatus();

  const langBtns = document.querySelectorAll<HTMLButtonElement>(
    "#lang-buttons button, #title-lang-buttons button",
  );
  const areaBtns = document.querySelectorAll<HTMLButtonElement>(
    "#area-buttons button, #title-area-buttons button",
  );
  const timeBtns = document.querySelectorAll<HTMLButtonElement>("#time-buttons button");
  const weatherBtns = document.querySelectorAll<HTMLButtonElement>("#weather-buttons button");
  const roadSurfaceBtns = document.querySelectorAll<HTMLButtonElement>(
    "#road-surface-buttons button",
  );
  const soundBtns = document.querySelectorAll<HTMLButtonElement>("#sound-buttons button");
  const graphicsBtns = document.querySelectorAll<HTMLButtonElement>(
    "#graphics-buttons button, #title-graphics-buttons button",
  );
  const boostBtns = document.querySelectorAll<HTMLButtonElement>(
    "#boost-buttons button, #title-boost-buttons button",
  );

  const syncSoundHudTexts = () => {
    const isMuted = engineAudio.isMuted();
    const volumePct = Math.round(engineAudio.getVolume() * 100);
    const effectiveVolumePct = isMuted ? 0 : volumePct;
    const dict = i18n.t();
    soundBtns.forEach((btn) => {
      const isTarget = btn.dataset.sound === (isMuted ? "off" : "on");
      btn.classList.toggle("active", isTarget);
    });
    const hasVolumeSlider = soundVolumeSlider !== null;
    if (hasVolumeSlider) {
      soundVolumeSlider.value = String(effectiveVolumePct);
    }
    const hasVolumeValue = soundVolumeValue !== null;
    if (hasVolumeValue) {
      soundVolumeValue.textContent = `${effectiveVolumePct}%`;
    }
    const hasHudSoundBadge = hudSoundBadge !== null;
    if (hasHudSoundBadge) {
      hudSoundBadge.textContent = isMuted
        ? dict.soundBadgeMuted
        : `${dict.soundBadgeActive} · ${volumePct}%`;
    }
    const hasSoundStatus = soundStatus !== null;
    if (hasSoundStatus) {
      soundStatus.textContent = isMuted
        ? dict.soundStatusMuted
        : `${dict.soundStatusActive} (${volumePct}%)`;
      soundStatus.style.color = isMuted ? "#64748b" : "#34d399";
    }
    const hasQuickSoundBtn = quickSoundBtn !== null;
    if (hasQuickSoundBtn) {
      quickSoundBtn.textContent = isMuted ? dict.quickSoundOff : dict.quickSoundOn;
      quickSoundBtn.classList.toggle("active", !isMuted);
    }
  };

  const setSoundMuted = (muted: boolean) => {
    const shouldUnlockAudio = !muted && engineAudio.needsUnlockRetry();
    if (shouldUnlockAudio) {
      engineAudio.unlockAudio(true);
    }
    const shouldRestoreDefaultVolume = !muted && engineAudio.getVolume() <= 0;
    if (shouldRestoreDefaultVolume) {
      engineAudio.setVolume(0.75);
    }
    engineAudio.setMuted(muted);
    syncSoundHudTexts();
  };

  const setSoundVolume = (nextVolume: number) => {
    const isAudibleTarget = nextVolume > 0;
    const shouldUnlockAudio = isAudibleTarget && engineAudio.needsUnlockRetry();
    if (shouldUnlockAudio) {
      engineAudio.unlockAudio(true);
    }
    engineAudio.setVolume(nextVolume);
    syncSoundHudTexts();
  };

  soundBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      setSoundMuted(btn.dataset.sound === "off");
    });
  });

  const hasSoundVolumeSlider = soundVolumeSlider !== null;
  if (hasSoundVolumeSlider) {
    soundVolumeSlider.addEventListener("input", () => {
      const nextRatio = Number(soundVolumeSlider.value) / 100;
      setSoundVolume(nextRatio);
    });
  }

  inputManager.onSoundToggle = () => {
    setSoundMuted(!engineAudio.isMuted());
  };
  inputManager.onSoundVolumeStep = (delta) => {
    const isIncreasing = delta > 0;
    const shouldUnlockAudio = isIncreasing && engineAudio.needsUnlockRetry();
    if (shouldUnlockAudio) {
      engineAudio.unlockAudio(true);
    }
    engineAudio.adjustVolume(delta);
    syncSoundHudTexts();
  };
  syncSoundHudTexts();

  const syncLanguageButtons = () => {
    const activeLocale = i18n.getLocale();
    langBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.lang === activeLocale);
    });
  };
  syncLanguageButtons();

  // 時間帯 × 天候 × 路面状態の統合反映ヘルパー
  const applyEnvironmentState = (
    timeOfDay: TimeOfDay,
    weather: WeatherCondition,
    roadSurface?: RoadSurfaceCondition,
  ) => {
    logger.withTrace(
      "environment",
      "environment.change",
      () => {
        const nextRoadSurface: RoadSurfaceCondition =
          roadSurface ?? (weather === "rain" ? "puddle" : weatherSystem.currentRoadSurface);

        weatherSystem.setEnvironment(timeOfDay, weather, nextRoadSurface);
        cityMap.setNightMode(weatherSystem.shouldEnableHeadlights());
        carModel.setHeadlights(weatherSystem.shouldEnableHeadlights());
        carModel.setInteriorLighting(
          weatherSystem.currentTimeOfDay,
          weatherSystem.currentWeatherCondition,
        );
        vehiclePhysics.setRoadSurfaceCondition(weatherSystem.currentRoadSurface);
        cityMap.updateRainWetness(
          weatherSystem.wetness,
          performance.now() * 0.001,
          weatherSystem.getPuddleEnvironmentParams(),
        );
        renderer.shadowMap.needsUpdate = true;

        const isRainWeather = weather === "rain";
        const shouldAutoStartWiper = isRainWeather && currentWiperMode === "off";
        const shouldAutoStopWiper = !isRainWeather && currentWiperMode !== "off";
        if (shouldAutoStartWiper) {
          setWiperMode("slow");
        } else if (shouldAutoStopWiper) {
          setWiperMode("off");
        }

        updatePostProcessesForEnvironment();

        const activeLocale = i18n.getLocale();
        const summary = weatherSystem.getEnvironmentSummary(activeLocale);
        const hasClockBadge = hudClockBadge !== null;
        if (hasClockBadge) {
          hudClockBadge.textContent = `${summary.clockText} (${summary.timeLabel})`;
        }
        carModel.setEnvironmentDisplay(
          summary.clockText,
          summary.timeLabel,
          formatLabelPair(summary.weatherLabel, summary.roadSurfaceLabel, activeLocale),
        );

        timeBtns.forEach((btn) => {
          btn.classList.toggle("active", btn.dataset.time === timeOfDay);
        });
        weatherBtns.forEach((btn) => {
          btn.classList.toggle("active", btn.dataset.weather === weather);
        });
        roadSurfaceBtns.forEach((btn) => {
          btn.classList.toggle("active", btn.dataset.surface === weatherSystem.currentRoadSurface);
        });
      },
      {
        timeOfDay,
        weather,
        roadSurface: roadSurface ?? weatherSystem.currentRoadSurface,
        clockText: weatherSystem.getClockText(),
      },
    );
  };

  // 初期時間帯・天候・路面状態のUI＆ポストプロセス同期
  applyEnvironmentState(
    weatherSystem.currentTimeOfDay,
    weatherSystem.currentWeatherCondition,
    weatherSystem.currentRoadSurface,
  );
  cityMap.updateDistanceCulling(activeSpawnTransform.position, 380);

  // モバイル・タブレット向け HUD（クイックアクションバー・折りたたみドロワー・マルチタッチ操作パッド）初期化
  const mobileHud = new MobileHudController({
    inputManager,
    onToggleCamera: () => {
      const nextMode = cameraController.mode === "cockpit" ? "chase" : "cockpit";
      setCameraMode(nextMode);
    },
    onSelectGazePreset: (preset) => {
      const currentPreset = cameraController.getGazeState(i18n.getLocale()).preset;
      const shouldToggleBackToForward = preset !== "forward" && currentPreset === preset;
      applyGazePreset(shouldToggleBackToForward ? "forward" : preset);
    },
    onToggleArea: () => {
      const nextArea: DriveAreaId = currentDriveArea === "tokyo" ? "shibuya" : "tokyo";
      setDriveArea(nextArea);
    },
    onToggleGraphicsQuality: () => {
      applyGraphicsQuality(getNextGraphicsQuality(currentGraphicsQuality), "quickbar");
    },
    onToggleSound: () => {
      setSoundMuted(!engineAudio.isMuted());
    },
    onToggleLocale: () => {
      i18n.cycleLocale();
    },
    onResetVehicle: () => {
      inputManager.onResetVehicle?.();
    },
  });

  const syncMobileQuickBar = () => {
    mobileHud.syncQuickBarState({
      cameraMode: cameraController.mode,
      gazePreset: cameraController.getGazeState().preset,
      area: currentDriveArea,
      graphicsQuality: currentGraphicsQuality,
    });
  };

  // 走行エリア切替（渋谷 <-> 東京駅・丸の内）
  const syncAreaButtons = (area: DriveAreaId) => {
    areaBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.area === area);
    });
    syncMobileQuickBar();
  };
  syncAreaButtons(currentDriveArea);

  const setDriveArea = (area: DriveAreaId) => {
    logger.withTrace(
      "city",
      "area.change",
      () => {
        currentDriveArea = area;
        const spawn = TokyoStationMap.getAreaSpawnTransform(area);
        activeSpawnTransform = {
          position: spawn.position.clone(),
          yawRadians: spawn.yawRadians,
        };
        vehiclePhysics.resetPosition(spawn.position, spawn.yawRadians);
        syncAreaButtons(area);

        isWarpStreamingInProgress = true;
        if (warpBannerHideTimerId !== null) {
          window.clearTimeout(warpBannerHideTimerId);
          warpBannerHideTimerId = null;
        }
        syncStreamingHudAndBanner(streamingSystem.getStatus());

        void streamingSystem
          .loadPriorityAreaAround(spawn.position.x, spawn.position.z, {
            isWarp: true,
            headingAngleRad: spawn.yawRadians,
            onProgress: (pct, status) => {
              syncStreamingHudAndBanner(status);
              const isTitleStillShowing = !isTitleScreenDismissed;
              if (isTitleStillShowing) {
                updateLoadingProgress(80 + Math.round(pct * 0.2), "loadingStagePriorityChunks");
              }
            },
          })
          .then((status) => {
            isWarpStreamingInProgress = false;
            const maxDrawDist = streamingSystem.getBudgetProfile().activeRadiusM;
            cityMap.updateDistanceCulling(spawn.position, maxDrawDist, true);
            renderer.shadowMap.needsUpdate = true;
            syncStreamingHudAndBanner(status);

            const isTitleStillShowing = !isTitleScreenDismissed && !status.canRetry;
            if (isTitleStillShowing) {
              updateLoadingProgress(100, "loadingStageReady");
            }

            if (!status.canRetry) {
              warpBannerHideTimerId = window.setTimeout(() => {
                warpBannerHideTimerId = null;
                syncStreamingHudAndBanner(streamingSystem.getStatus());
              }, 850);
            }
          });
      },
      {
        area,
        spawnX: TokyoStationMap.getAreaSpawnTransform(area).position.x,
        spawnZ: TokyoStationMap.getAreaSpawnTransform(area).position.z,
      },
    );
  };

  areaBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const nextArea = btn.dataset.area === "tokyo" ? "tokyo" : "shibuya";
      setDriveArea(nextArea);
    });
  });

  inputManager.onAreaToggle = () => {
    const nextArea: DriveAreaId = currentDriveArea === "tokyo" ? "shibuya" : "tokyo";
    setDriveArea(nextArea);
  };

  // 時間帯ボタンイベント
  timeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const nextTime = btn.dataset.time as TimeOfDay;
      applyEnvironmentState(
        nextTime,
        weatherSystem.currentWeatherCondition,
        weatherSystem.currentRoadSurface,
      );
    });
  });

  // キーボード [T] での時間帯サイクル切替
  inputManager.onTimeToggle = () => {
    const order: TimeOfDay[] = ["morning", "day", "sunset", "night"];
    const nextIdx = (order.indexOf(weatherSystem.currentTimeOfDay) + 1) % order.length;
    applyEnvironmentState(
      order[nextIdx],
      weatherSystem.currentWeatherCondition,
      weatherSystem.currentRoadSurface,
    );
  };

  // 天候ボタンイベント（晴天 / 曇天 / 雨天）
  weatherBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const nextWeather = btn.dataset.weather as WeatherCondition;
      const autoSurface: RoadSurfaceCondition =
        nextWeather === "rain" ? "puddle" : weatherSystem.currentRoadSurface;
      applyEnvironmentState(weatherSystem.currentTimeOfDay, nextWeather, autoSurface);
    });
  });

  // 路面状態ボタンイベント（乾燥 / 雨上がり / 水たまり）
  roadSurfaceBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const nextSurface = btn.dataset.surface as RoadSurfaceCondition;
      applyEnvironmentState(
        weatherSystem.currentTimeOfDay,
        weatherSystem.currentWeatherCondition,
        nextSurface,
      );
    });
  });

  // キーボード [G] での路面状態サイクル切替
  inputManager.onRoadSurfaceToggle = () => {
    const order: RoadSurfaceCondition[] = ["dry", "wet", "puddle"];
    const nextIdx = (order.indexOf(weatherSystem.currentRoadSurface) + 1) % order.length;
    applyEnvironmentState(
      weatherSystem.currentTimeOfDay,
      weatherSystem.currentWeatherCondition,
      order[nextIdx],
    );
  };

  // カメラ視点切り替え
  const setCameraMode = (mode: CameraMode) => {
    cameraController.setMode(mode);
    const cameraBtns = document.querySelectorAll<HTMLButtonElement>("#camera-buttons button");
    cameraBtns.forEach((b) => {
      b.classList.toggle("active", b.dataset.camera === mode);
    });
    syncMobileQuickBar();
    logger.info("camera", "camera.change", "Camera view mode changed", { cameraMode: mode });
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

  // 視線（Gaze）プリセット＆ドラッグ変更連携
  const gazeBtns = document.querySelectorAll<HTMLButtonElement>("#gaze-buttons button");
  let lastSyncedGazeKey = "";
  const syncGazeHud = () => {
    const currentLocale = i18n.getLocale();
    const gazeState = cameraController.getGazeState(currentLocale);
    const yawDeg = Math.round(THREE.MathUtils.radToDeg(gazeState.yawRad));
    const pitchDeg = Math.round(THREE.MathUtils.radToDeg(gazeState.pitchRad));
    const nextGazeKey = `${gazeState.preset}|${yawDeg}|${pitchDeg}|${cameraController.mode}|${currentLocale}`;
    const isUnchanged = nextGazeKey === lastSyncedGazeKey;
    if (isUnchanged) {
      return;
    }
    lastSyncedGazeKey = nextGazeKey;

    gazeBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.gaze === gazeState.preset);
    });
    const hasGazeBadge = hudGazeBadge !== null;
    if (hasGazeBadge) {
      const yawText = yawDeg > 0 ? `+${yawDeg}°` : `${yawDeg}°`;
      const pitchText = pitchDeg > 0 ? `+${pitchDeg}°` : `${pitchDeg}°`;
      hudGazeBadge.textContent = `${gazeState.label} (${yawText}, ${pitchText})`;
    }
    syncMobileQuickBar();
  };

  const applyGazePreset = (preset: GazePreset, isImmediate = false) => {
    logger.withTrace(
      "camera",
      "gaze.change",
      () => {
        cameraController.setGazePreset(preset, isImmediate);
        syncGazeHud();
      },
      { preset, cameraMode: cameraController.mode },
    );
  };

  gazeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const preset = btn.dataset.gaze as GazePreset;
      applyGazePreset(preset);
    });
  });

  inputManager.onGazePreset = (preset) => {
    const currentPreset = cameraController.getGazeState(i18n.getLocale()).preset;
    // 同じ非正面プリセットキーを再度押した場合は素早く正面視線へ戻すトグル動作にする
    const shouldToggleBackToForward = preset !== "forward" && currentPreset === preset;
    applyGazePreset(shouldToggleBackToForward ? "forward" : preset);
  };

  inputManager.onGazeDragDelta = (deltaYawRad, deltaPitchRad) => {
    cameraController.addGazeDelta(deltaYawRad, deltaPitchRad, true);
    syncGazeHud();
  };

  // URLクエリパラメータ（?time=...&weather=...&surface=...&camera=...&gaze=...&yaw=...&pitch=...）による初期状態オーバーライド
  const queryTime = urlParams.get("time") as TimeOfDay | null;
  const queryWeather = urlParams.get("weather") as WeatherCondition | null;
  const querySurface = urlParams.get("surface") as RoadSurfaceCondition | null;
  const queryCamera = urlParams.get("camera") as CameraMode | null;
  const queryGaze = urlParams.get("gaze") as GazePreset | null;
  const rawQueryYaw = urlParams.get("yaw");
  const rawQueryPitch = urlParams.get("pitch");
  const hasEnvQuery = queryTime !== null || queryWeather !== null || querySurface !== null;
  if (hasEnvQuery) {
    applyEnvironmentState(
      queryTime ?? weatherSystem.currentTimeOfDay,
      queryWeather ?? weatherSystem.currentWeatherCondition,
      querySurface ?? weatherSystem.currentRoadSurface,
    );
  }
  const hasCameraQuery = queryCamera === "cockpit" || queryCamera === "chase";
  if (hasCameraQuery) {
    setCameraMode(queryCamera);
  }
  const validGazePresets: GazePreset[] = [
    "forward",
    "right_mirror",
    "left_mirror",
    "rearview_mirror",
    "dashboard",
    "right_shoulder",
    "left_shoulder",
  ];
  const hasValidGazePresetQuery = queryGaze !== null && validGazePresets.includes(queryGaze);
  const hasExplicitYawOrPitch = rawQueryYaw !== null || rawQueryPitch !== null;
  if (hasValidGazePresetQuery) {
    applyGazePreset(queryGaze, true);
  } else if (hasExplicitYawOrPitch) {
    const parsedYawDeg = rawQueryYaw !== null ? Number(rawQueryYaw) : 0;
    const parsedPitchDeg = rawQueryPitch !== null ? Number(rawQueryPitch) : 0;
    const yawRad = THREE.MathUtils.degToRad(Number.isFinite(parsedYawDeg) ? parsedYawDeg : 0);
    const pitchRad = THREE.MathUtils.degToRad(Number.isFinite(parsedPitchDeg) ? parsedPitchDeg : 0);
    cameraController.setGazeAngles(yawRad, pitchRad, true);
    syncGazeHud();
  }

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

  // ウインカー（方向指示器: Q=左 / E=右 / Z=ハザード）制御 & ステアリング戻り自動キャンセル & フラッシャーリレー音連携
  let currentTurnSignalState: TurnSignalState = "off";
  let hasTurnSignalReachedSteerThreshold = false;

  const syncTurnSignalHud = () => {
    const dict = i18n.t();
    const blinkOn = carModel.isTurnSignalBlinkOn();
    turnSignalBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.turnSignal === currentTurnSignalState);
    });
    const statusText =
      currentTurnSignalState === "left"
        ? dict.turnSignalStatusLeft
        : currentTurnSignalState === "right"
          ? dict.turnSignalStatusRight
          : currentTurnSignalState === "hazard"
            ? dict.turnSignalStatusHazard
            : dict.turnSignalStatusOff;
    const badgeText =
      currentTurnSignalState === "left"
        ? "◀ LEFT"
        : currentTurnSignalState === "right"
          ? "RIGHT ▶"
          : currentTurnSignalState === "hazard"
            ? "◀▶ HAZARD"
            : "OFF";
    const isTurnActive = currentTurnSignalState !== "off";
    const isHazard = currentTurnSignalState === "hazard";
    const hasHudBadge = hudTurnSignalBadge !== null;
    if (hasHudBadge) {
      hudTurnSignalBadge.textContent = badgeText;
      hudTurnSignalBadge.style.color = !isTurnActive
        ? "#64748b"
        : isHazard
          ? blinkOn
            ? "#f59e0b"
            : "#78350f"
          : blinkOn
            ? "#4ade80"
            : "#14532d";
    }
    const hasStatus = turnSignalStatus !== null;
    if (hasStatus) {
      turnSignalStatus.textContent = statusText;
      turnSignalStatus.classList.toggle("is-active-turn", isTurnActive && !isHazard && blinkOn);
      turnSignalStatus.classList.toggle("is-active-hazard", isHazard && blinkOn);
      turnSignalStatus.classList.toggle("is-blink-off", isTurnActive && !blinkOn);
    }
  };

  const setTurnSignalState = (
    nextState: TurnSignalState,
    source: "keyboard" | "ui" | "auto_cancel" | "reset" | "init" = "keyboard",
  ) => {
    const isUnchanged = currentTurnSignalState === nextState && source !== "init";
    if (isUnchanged) {
      return;
    }
    logger.withTrace(
      "vehicle",
      "turnSignal.change",
      () => {
        currentTurnSignalState = nextState;
        hasTurnSignalReachedSteerThreshold = false;
        carModel.setTurnSignal(nextState);
        syncTurnSignalHud();
      },
      {
        turnSignal: nextState,
        source,
      },
    );
  };

  const toggleTurnSignal = (
    target: "left" | "right" | "hazard",
    source: "keyboard" | "ui" = "keyboard",
  ) => {
    const shouldUnlockAudio = engineAudio.needsUnlockRetry();
    if (shouldUnlockAudio) {
      engineAudio.unlockAudio(true);
    }
    const nextState: TurnSignalState = currentTurnSignalState === target ? "off" : target;
    setTurnSignalState(nextState, source);
  };

  carModel.onTurnSignalBlinkPhaseChange = (blinkOn) => {
    engineAudio.triggerTurnSignalClick(blinkOn);
    syncTurnSignalHud();
  };

  turnSignalBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const rawTarget = btn.dataset.turnSignal as TurnSignalState | undefined;
      const isOffTarget = !rawTarget || rawTarget === "off";
      if (isOffTarget) {
        setTurnSignalState("off", "ui");
        return;
      }
      toggleTurnSignal(rawTarget, "ui");
    });
  });

  inputManager.onTurnSignalToggle = (target) => {
    toggleTurnSignal(target, "keyboard");
  };

  const rawQueryBlinker = urlParams.get("blinker") ?? urlParams.get("turnSignal");
  const isInitialBlinkerValid =
    rawQueryBlinker === "left" ||
    rawQueryBlinker === "right" ||
    rawQueryBlinker === "hazard" ||
    rawQueryBlinker === "off";
  setTurnSignalState(isInitialBlinkerValid ? rawQueryBlinker : "off", "init");

  // モーションブラー切り替え
  const setBlurMode = (enabled: boolean) => {
    motionBlurEnabled = enabled;
    const blurBtns = document.querySelectorAll<HTMLButtonElement>("#blur-buttons button");
    blurBtns.forEach((b) => {
      b.classList.toggle("active", b.dataset.blur === (enabled ? "on" : "off"));
    });
    const hasBlurStatus = blurStatus !== null;
    if (hasBlurStatus) {
      const dict = i18n.t();
      blurStatus.textContent = enabled ? dict.blurStatusActive : dict.blurStatusOff;
      blurStatus.style.color = enabled ? "#a855f7" : "#64748b";
    }
    logger.info("postprocess", "motionBlur.change", "Motion blur toggled", { enabled });
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

  // グラフィック品質（高: high / 中: medium / 低: low）三段階切り替え
  const syncGraphicsHudTexts = () => {
    const localizedGfx = localizeGraphicsQualityTexts(currentGraphicsQuality, i18n.getLocale());
    const hasHudGraphicsBadge = hudGraphicsBadge !== null;
    if (hasHudGraphicsBadge) {
      hudGraphicsBadge.textContent = localizedGfx.badgeText;
    }
    const hasGraphicsStatus = graphicsStatus !== null;
    if (hasGraphicsStatus) {
      graphicsStatus.textContent = localizedGfx.hudStatusText;
      graphicsStatus.style.color =
        currentGraphicsQuality === "high"
          ? "#38bdf8"
          : currentGraphicsQuality === "medium"
            ? "#facc15"
            : "#94a3b8";
    }
  };

  const applyGraphicsQuality = (
    quality: GraphicsQuality,
    source: "init" | "ui" | "quickbar" | "keyboard" = "ui",
  ) => {
    const preset = getGraphicsQualityPreset(quality);
    logger.withTrace(
      "graphics",
      "graphics.change",
      () => {
        currentGraphicsQuality = preset.quality;

        renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.maxPixelRatio));
        renderer.shadowMap.enabled = preset.shadowsEnabled;
        renderer.shadowMap.type = preset.shadowMapType;
        renderer.shadowMap.needsUpdate = true;

        const scaledSize = computeScaledRenderDimensions(
          window.innerWidth,
          window.innerHeight,
          preset.renderScale,
        );
        depthFogPass.setSize(scaledSize.width, scaledSize.height);
        lensFlarePass.setSize(scaledSize.width, scaledSize.height);
        motionBlurPass.setSize(scaledSize.width, scaledSize.height);

        weatherSystem.setGraphicsQuality(preset.quality);
        carModel.setGraphicsQuality(preset.quality);
        streamingSystem.setQualityProfile(preset.quality);
        setBlurMode(preset.postProcessMotionBlur);
        updatePostProcessesForEnvironment();

        graphicsBtns.forEach((btn) => {
          btn.classList.toggle("active", btn.dataset.graphics === preset.quality);
        });
        syncGraphicsHudTexts();
        syncMobileQuickBar();
      },
      {
        quality: preset.quality,
        source,
        renderScale: preset.renderScale,
        maxPixelRatio: preset.maxPixelRatio,
        shadowsEnabled: preset.shadowsEnabled,
        shadowMapSize: preset.shadowMapSize,
        cloudMarchSteps: preset.cloudMarchSteps,
        cloudSunSteps: preset.cloudSunSteps,
        rainParticleCount: preset.rainParticleCount,
        mirrorRenderInterval: preset.mirrorRenderInterval,
      },
    );
  };

  graphicsBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const rawQuality = btn.dataset.graphics;
      const nextQuality: GraphicsQuality = isGraphicsQuality(rawQuality) ? rawQuality : "high";
      applyGraphicsQuality(nextQuality, "ui");
    });
  });

  inputManager.onGraphicsQualityToggle = () => {
    applyGraphicsQuality(getNextGraphicsQuality(currentGraphicsQuality), "keyboard");
  };

  // 初期グラフィック品質の適用（URLクエリ ?graphics=... または既定 "high"）
  applyGraphicsQuality(currentGraphicsQuality, "init");

  // /boost オプション（シェーダー全バリアント事前プリビルド）の制御と同期
  let boostEnabled = parseBoostOption(window.location);
  let shaderPrebuilt = false;
  let lastPrebuildDurationMs: number | null = null;
  let lastPrebuildReport: ShaderPrebuildReport | null = null;

  const syncBoostHudTexts = () => {
    const dict = getUiTranslations(i18n.getLocale());
    boostBtns.forEach((btn) => {
      const isTarget = btn.dataset.boost === (boostEnabled ? "on" : "off");
      btn.classList.toggle("active", isTarget);
    });
    const hasBoostBadge = hudBoostBadge !== null;
    if (hasBoostBadge) {
      hudBoostBadge.textContent =
        shaderPrebuilt && boostEnabled
          ? dict.boostBadgePrebuilt
          : boostEnabled
            ? dict.boostBadgeOn
            : dict.boostBadgeOff;
    }
    const hasBoostStatus = boostStatus !== null;
    if (hasBoostStatus) {
      boostStatus.textContent = boostEnabled ? dict.boostStatusPrebuilt : dict.boostStatusOff;
      boostStatus.style.color = boostEnabled ? "#34d399" : "#64748b";
    }
  };

  const runShaderPrebuild = async (trigger: "bootstrap" | "ui"): Promise<ShaderPrebuildReport> => {
    return await logger.withAsyncTrace(
      "graphics",
      "shader.prebuild",
      async (span) => {
        // 非同期 GLB アセット（車両、東京駅丸の内駅舎、渋谷ストリーム、街路樹）および
        // ロード完了コールバック内で付与される 3D プロシージャル onBeforeCompile シェーダーの構築完了を待つ
        await Promise.all([cityMap.waitForModelsLoaded(), carModel.waitForModelsLoaded()]);

        const report = await prebuildSceneShaders({
          renderer,
          scene,
          cameras: [cameraController.camera, carModel.rearCamera],
          postProcessPasses: [depthFogPass, lensFlarePass, motionBlurPass],
        });
        // プリビルド完了後、現在の車両位置に基づく距離カリング・多段階LODを再適用する
        cityMap.updateDistanceCulling(activeSpawnTransform.position, 380, true);
        shaderPrebuilt = true;
        lastPrebuildDurationMs = report.durationMs;
        lastPrebuildReport = report;
        syncBoostHudTexts();

        logger.info(
          "graphics",
          "shader.prebuild.completed",
          `Shader prebuild completed (async=${report.usedAsyncCompile}) in ${report.durationMs}ms`,
          {
            trigger,
            usedAsyncCompile: report.usedAsyncCompile,
            compiledScenesCount: report.compiledScenesCount,
            compiledObjectsCount: report.compiledObjectsCount,
            temporarilyRevealedObjectsCount: report.temporarilyRevealedObjectsCount,
            compiledMaterialsCount: report.compiledMaterialsCount,
            compiledCamerasCount: report.compiledCamerasCount,
            compiledPostProcessCount: report.compiledPostProcessCount,
            durationMs: report.durationMs,
          },
          { trace: span },
        );
        return report;
      },
      { trigger, boostEnabled },
    );
  };

  const setBoostOption = async (enabled: boolean, trigger: "ui") => {
    boostEnabled = enabled;
    const nextUrl = buildUrlWithBoostOption(window.location, enabled);
    window.history.replaceState(null, "", nextUrl);
    syncBoostHudTexts();

    logger.info("graphics", "boost.toggle", `Shader prebuild boost option set to ${enabled}`, {
      boostEnabled: enabled,
      trigger,
      shaderPrebuilt,
      nextUrl,
    });

    if (enabled) {
      await runShaderPrebuild(trigger);
    }
  };

  boostBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const nextEnabled = btn.dataset.boost === "on";
      void setBoostOption(nextEnabled, "ui");
    });
  });

  syncBoostHudTexts();

  // 表示言語（日本語 / English / 中文）切り替え連携
  langBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const rawLang = btn.dataset.lang;
      const isValidLocale = isSupportedLocale(rawLang);
      if (isValidLocale) {
        i18n.setLocale(rawLang);
      }
    });
  });

  inputManager.onLocaleToggle = () => {
    i18n.cycleLocale();
  };

  // Why ここで logger.withTrace("i18n", "locale.change") を重ねて呼ばないか:
  // I18nManager.setLocale() が既に "i18n" / "locale.change" のトレーススパンを開始してリスナーを呼ぶため、
  // ここで同名の withTrace をネストすると1回の言語切替で重複した完了ログが出力されてしまうため。
  i18n.onChange((locale) => {
    applyDocumentTranslations(locale);
    updateLoadingProgress(currentLoadingPercent, currentLoadingStageKey);
    carModel.setLocale(locale);
    syncLanguageButtons();

    const summary = weatherSystem.getEnvironmentSummary(locale);
    const hasClockBadge = hudClockBadge !== null;
    if (hasClockBadge) {
      hudClockBadge.textContent = `${summary.clockText} (${summary.timeLabel})`;
    }
    carModel.setEnvironmentDisplay(
      summary.clockText,
      summary.timeLabel,
      formatLabelPair(summary.weatherLabel, summary.roadSurfaceLabel, locale),
    );

    syncGazeHud();
    syncTurnSignalHud();
    syncSoundHudTexts();
    setBlurMode(motionBlurEnabled);
    syncGraphicsHudTexts();
    syncBoostHudTexts();
    syncGamepadHudStatus();
    syncStreamingHudAndBanner(streamingSystem.getStatus());
  });

  // 車両リセット（現在選択中の走行エリアの初期スポーン座標へ戻す）
  inputManager.onResetVehicle = () => {
    setTurnSignalState("off", "reset");
    vehiclePhysics.resetPosition(activeSpawnTransform.position, activeSpawnTransform.yawRadians);
    cityMap.updateDistanceCulling(activeSpawnTransform.position, 380, true);
    logger.info("vehicle", "vehicle.reset", "Vehicle reset to start position", {
      area: currentDriveArea,
      x: activeSpawnTransform.position.x,
      y: activeSpawnTransform.position.y,
      z: activeSpawnTransform.position.z,
    });
  };

  // 道路標識作成・配置システム UI 初期化
  const signCreatorUI = new RoadSignCreatorUI({
    signSystem: cityMap.signSystem,
    getVehiclePose: () => {
      const telemetry = vehiclePhysics.getState();
      return {
        x: telemetry.position.x,
        z: telemetry.position.z,
        headingRad: telemetry.headingAngle,
      };
    },
    onPlaceSign: (spec) => {
      const created = cityMap.addCustomRoadSign(spec);
      vehiclePhysics.setObstacleColliderHandles(cityMap.obstacleColliderHandles);
      cityMap.setNightMode(weatherSystem.shouldEnableHeadlights());
      renderer.shadowMap.needsUpdate = true;
      return created;
    },
    onRemoveSign: (id) => {
      const removed = cityMap.removeCustomRoadSign(id);
      vehiclePhysics.setObstacleColliderHandles(cityMap.obstacleColliderHandles);
      renderer.shadowMap.needsUpdate = true;
      return removed;
    },
    getPlacedCustomSigns: () => cityMap.getCustomRoadSigns(),
  });
  inputManager.onSignCreatorToggle = () => {
    signCreatorUI.toggle();
  };

  // Web アセット管理システム UI 初期化（モデル・3Dテクスチャ・道路・標識・天候・YAML・/boost 統合管理）
  const assetManagerUI = new AssetManagerUI({
    manager: assetManager,
    bridge: {
      onApplyModelToScene: (model) => {
        const isCarModel = model.id === "car" && carModel.glbModelGroup !== null;
        if (isCarModel && carModel.glbModelGroup) {
          carModel.glbModelGroup.scale.set(model.scale[0], model.scale[1], model.scale[2]);
          carModel.glbModelGroup.position.set(model.offset[0], model.offset[1], model.offset[2]);
        }
        const isStationModel = model.id === "tokyo_station" && cityMap.glbStationGroup !== null;
        if (isStationModel && cityMap.glbStationGroup) {
          cityMap.glbStationGroup.scale.set(model.scale[0], model.scale[1], model.scale[2]);
          cityMap.glbStationGroup.position.set(model.offset[0], model.offset[1], model.offset[2]);
        }
        const isShibuyaStream =
          model.id === "shibuya_stream" && cityMap.glbShibuyaStreamGroup !== null;
        if (isShibuyaStream && cityMap.glbShibuyaStreamGroup) {
          cityMap.glbShibuyaStreamGroup.scale.set(model.scale[0], model.scale[1], model.scale[2]);
          cityMap.glbShibuyaStreamGroup.position.set(
            model.offset[0],
            model.offset[1],
            model.offset[2],
          );
        }
        renderer.shadowMap.needsUpdate = true;
      },
      onApplyTexture3DToScene: () => {
        renderer.shadowMap.needsUpdate = true;
      },
      onApplyRoadToScene: () => {
        renderer.shadowMap.needsUpdate = true;
      },
      onApplySignToScene: (sign) => {
        cityMap.removeCustomRoadSign(sign.id);
        cityMap.addCustomRoadSign(sign);
        vehiclePhysics.setObstacleColliderHandles(cityMap.obstacleColliderHandles);
        cityMap.setNightMode(weatherSystem.shouldEnableHeadlights());
        renderer.shadowMap.needsUpdate = true;
      },
      onRemoveSignFromScene: (signId) => {
        cityMap.removeCustomRoadSign(signId);
        vehiclePhysics.setObstacleColliderHandles(cityMap.obstacleColliderHandles);
        renderer.shadowMap.needsUpdate = true;
      },
      onApplyWeatherPresetToScene: (preset) => {
        const mappedWeather: WeatherCondition = preset.rain.enabled
          ? "rain"
          : preset.id === "cloudy"
            ? "cloudy"
            : "clear";
        const mappedSurface: RoadSurfaceCondition = preset.rain.enabled ? "puddle" : "wet";
        const mappedTime: TimeOfDay =
          preset.id === "sunset"
            ? "sunset"
            : preset.id === "night"
              ? "night"
              : preset.id === "morning"
                ? "morning"
                : weatherSystem.currentTimeOfDay;
        applyEnvironmentState(mappedTime, mappedWeather, mappedSurface);
        weatherSystem.applyPreset(preset);
        cityMap.updateRainWetness(
          weatherSystem.wetness,
          performance.now() * 0.001,
          weatherSystem.getPuddleEnvironmentParams(),
        );
        updatePostProcessesForEnvironment();
        renderer.shadowMap.needsUpdate = true;
      },
      onManifestReloaded: () => {
        const currentManifest = assetManager.getManifest();
        for (const model of currentManifest.models) {
          const isCarModel = model.id === "car" && carModel.glbModelGroup !== null;
          if (isCarModel && carModel.glbModelGroup) {
            carModel.glbModelGroup.scale.set(model.scale[0], model.scale[1], model.scale[2]);
            carModel.glbModelGroup.position.set(model.offset[0], model.offset[1], model.offset[2]);
          }
          const isStationModel = model.id === "tokyo_station" && cityMap.glbStationGroup !== null;
          if (isStationModel && cityMap.glbStationGroup) {
            cityMap.glbStationGroup.scale.set(model.scale[0], model.scale[1], model.scale[2]);
            cityMap.glbStationGroup.position.set(model.offset[0], model.offset[1], model.offset[2]);
          }
          const isShibuyaStream =
            model.id === "shibuya_stream" && cityMap.glbShibuyaStreamGroup !== null;
          if (isShibuyaStream && cityMap.glbShibuyaStreamGroup) {
            cityMap.glbShibuyaStreamGroup.scale.set(model.scale[0], model.scale[1], model.scale[2]);
            cityMap.glbShibuyaStreamGroup.position.set(
              model.offset[0],
              model.offset[1],
              model.offset[2],
            );
          }
        }
        const defaultPreset = assetManager.getDefaultWeather();
        weatherSystem.applyPreset(defaultPreset);
        updatePostProcessesForEnvironment();
        renderer.shadowMap.needsUpdate = true;
      },
      onTriggerShaderPrebuild: async () => {
        boostEnabled = true;
        const nextUrl = buildUrlWithBoostOption(window.location, true);
        window.history.replaceState(null, "", nextUrl);
        return await runShaderPrebuild("ui");
      },
      getShaderBoostState: () => ({
        enabled: boostEnabled,
        prebuilt: shaderPrebuilt,
        lastReport: lastPrebuildReport,
      }),
    },
  });
  inputManager.onAssetManagerToggle = () => {
    assetManagerUI.toggle();
  };

  // URL パス (/assets, /boost/assets) またはクエリ (?assets=1) 指定時は起動時にアセット管理システムを開く
  const shouldOpenAssetManagerOnBoot = parseAssetManagerOption(window.location);
  if (shouldOpenAssetManagerOnBoot) {
    assetManagerUI.open();
  }

  // 8.2 初期位置周辺の必須チャンクを優先ロード（Playable First オープンワールドストリーミング）
  updateLoadingProgress(82, "loadingStagePriorityChunks");
  const initialStreamingStatus = await streamingSystem.loadPriorityAreaAround(
    activeSpawnTransform.position.x,
    activeSpawnTransform.position.z,
    {
      isWarp: false,
      headingAngleRad: activeSpawnTransform.yawRadians,
      onProgress: (pct, status) => {
        updateLoadingProgress(82 + Math.round(pct * 0.12), "loadingStagePriorityChunks");
        syncStreamingHudAndBanner(status);
      },
    },
  );
  cityMap.updateDistanceCulling(
    activeSpawnTransform.position,
    streamingSystem.getBudgetProfile().activeRadiusM,
    true,
  );
  syncStreamingHudAndBanner(initialStreamingStatus);

  // /boost オプションが有効な場合は、起動時に全3Dシーン＋ポストプロセスシェーダーを事前プリビルドする
  if (boostEnabled) {
    updateLoadingProgress(95, "loadingStageShaderPrebuild");
    await runShaderPrebuild("bootstrap");
  }

  // ローディング完了（100%）& タイトル画面スタート制御
  if (!initialStreamingStatus.canRetry) {
    updateLoadingProgress(100, "loadingStageReady");
  }
  let isTitleScreenDismissed = false;
  const dismissTitleScreen = (trigger: string) => {
    if (isTitleScreenDismissed) {
      return;
    }
    isTitleScreenDismissed = true;
    const hasOverlay = titleScreenOverlay !== null;
    if (hasOverlay) {
      titleScreenOverlay.classList.add("is-hidden");
      titleScreenOverlay.setAttribute("aria-hidden", "true");
    }
    const isUserGestureTrigger = trigger !== "url_query";
    if (isUserGestureTrigger) {
      engineAudio.unlockAudio(true);
    }
    logger.info("bootstrap", "titleScreen.dismiss", "Title screen dismissed and drive started", {
      trigger,
      area: currentDriveArea,
      graphicsQuality: currentGraphicsQuality,
      boostEnabled,
      shaderPrebuilt,
      locale: i18n.getLocale(),
    });
  };

  inputManager.onUserInteraction = () => {
    const shouldUnlockOnInteraction = isTitleScreenDismissed && engineAudio.needsUnlockRetry();
    if (shouldUnlockOnInteraction) {
      engineAudio.unlockAudio(true);
    }
  };

  const hasStartBtn = startDriveBtn !== null;
  if (hasStartBtn) {
    startDriveBtn.disabled = false;
    startDriveBtn.addEventListener("click", () => {
      dismissTitleScreen("click");
    });
  }

  window.addEventListener("keydown", (event) => {
    const isStartKey =
      !isTitleScreenDismissed &&
      (event.code === "Enter" ||
        event.code === "Space" ||
        event.code === "KeyW" ||
        event.code === "ArrowUp");
    if (isStartKey) {
      dismissTitleScreen(`key:${event.code}`);
    }
  });

  const shouldAutoStart =
    urlParams.get("autostart") === "1" || hasValidQueryX || hasValidQueryZ || hasValidQueryHeading;
  if (shouldAutoStart) {
    dismissTitleScreen("url_query");
  }

  // デバッグ・E2E検証用にオープンワールドストリーミングAPIを window へ公開
  (window as unknown as { __DEEP_DRIVE_STREAMING__?: unknown }).__DEEP_DRIVE_STREAMING__ = {
    getStatus: () => streamingSystem.getStatus(),
    getAllChunks: () => streamingSystem.getAllChunkStates(),
    getBudget: () => streamingSystem.getBudgetProfile(),
    getLodStats: () => cityMap.getLodStats(),
    setQualityProfile: (quality: GraphicsQuality, isMobileOverride?: boolean) =>
      streamingSystem.setQualityProfile(quality, isMobileOverride),
    warpToArea: (area: DriveAreaId) => {
      setDriveArea(area);
      return streamingSystem.getStatus();
    },
    teleportVehicle: (x: number, z: number, headingRad = 0, speedKmh = 0) => {
      const targetPos = new THREE.Vector3(x, 0.02, z);
      vehiclePhysics.resetPosition(targetPos, headingRad);
      const speedMs = speedKmh / 3.6;
      const vx = -Math.sin(headingRad) * speedMs;
      const vz = -Math.cos(headingRad) * speedMs;
      const status = streamingSystem.updateFrame({
        vehicleX: x,
        vehicleZ: z,
        velocityX: vx,
        velocityZ: vz,
        headingAngleRad: headingRad,
        speedKmh,
        deltaSeconds: 0.05,
      });
      const budgetActiveRadius = streamingSystem.getBudgetProfile().activeRadiusM;
      const cullingDistanceM = Math.max(280, Math.min(420, budgetActiveRadius));
      cityMap.updateDistanceCulling(targetPos, cullingDistanceM, true);
      return status;
    },
    simulateFailureAndTrigger: async (chunkId: WorldChunkId) => {
      streamingSystem.forceEvictChunk(chunkId);
      streamingSystem.setSimulatedChunkFailure(chunkId, true);
      const chunk = streamingSystem.getChunkState(chunkId);
      if (!chunk) {
        return streamingSystem.getStatus();
      }
      const centerX = (chunk.definition.bounds.minX + chunk.definition.bounds.maxX) * 0.5;
      const centerZ = (chunk.definition.bounds.minZ + chunk.definition.bounds.maxZ) * 0.5;
      return streamingSystem.loadPriorityAreaAround(centerX, centerZ, {
        isWarp: false,
      });
    },
    retryFailedChunks: () => handleManualStreamingRetry(),
    forceEvictChunk: (chunkId: WorldChunkId) => streamingSystem.forceEvictChunk(chunkId),
  };

  logger.info(
    "bootstrap",
    "bootstrap.ready",
    "Antigravity Deep Drive initialized",
    {
      locale: i18n.getLocale(),
      area: currentDriveArea,
      timeOfDay: weatherSystem.currentTimeOfDay,
      weather: weatherSystem.currentWeatherCondition,
      cameraMode: cameraController.mode,
      graphicsQuality: currentGraphicsQuality,
      boostEnabled,
      shaderPrebuilt,
      shaderPrebuildDurationMs: lastPrebuildDurationMs,
      initialStreamingStatus: streamingSystem.getStatus(),
    },
    { trace: bootTrace },
  );

  // リサイズハンドラ（モバイル Chrome のアドレスバー伸縮に伴う visualViewport リサイズにも追従）
  let adaptivePixelRatioScale = 1.0;
  let lastAppliedRenderWidth = 0;
  let lastAppliedRenderHeight = 0;
  const handleResize = () => {
    const width = window.innerWidth;
    const height = Math.max(window.innerHeight, 1);
    const activePreset = getGraphicsQualityPreset(currentGraphicsQuality);
    renderer.setSize(width, height);
    renderer.setPixelRatio(
      Math.max(
        0.5,
        Math.min(window.devicePixelRatio, activePreset.maxPixelRatio) * adaptivePixelRatioScale,
      ),
    );
    cameraController.onResize(width / height);
    const scaledSize = computeScaledRenderDimensions(
      width,
      height,
      activePreset.renderScale * adaptivePixelRatioScale,
    );
    const hasRenderTargetSizeChanged =
      scaledSize.width !== lastAppliedRenderWidth || scaledSize.height !== lastAppliedRenderHeight;
    if (hasRenderTargetSizeChanged) {
      lastAppliedRenderWidth = scaledSize.width;
      lastAppliedRenderHeight = scaledSize.height;
      depthFogPass.setSize(scaledSize.width, scaledSize.height);
      lensFlarePass.setSize(scaledSize.width, scaledSize.height);
      motionBlurPass.setSize(scaledSize.width, scaledSize.height);
    }
  };
  window.addEventListener("resize", handleResize);
  window.visualViewport?.addEventListener("resize", handleResize);

  // --- メインループ ---
  let lastTime = performance.now();
  const reusableCarPos = new THREE.Vector3();
  const reusableCarVelocity = new THREE.Vector3();
  const reusableHeadlightPosL = new THREE.Vector3();
  const reusableHeadlightPosR = new THREE.Vector3();
  const reusableVehicleForward = new THREE.Vector3();
  let lastSpeedText = "";
  let lastGearText = "";
  let lastGisAreaHeaderText = "";
  let gisHudElapsedSec = 1.0;
  let frameCounter = 0;
  let smoothedFrameMs = 16.6;
  let lastGovernorResizeFrame = -180;

  function animate() {
    requestAnimationFrame(animate);

    const currentTime = performance.now();
    const rawFrameMs = Math.max(1, currentTime - lastTime);
    smoothedFrameMs = smoothedFrameMs * 0.9 + rawFrameMs * 0.1;
    const dt = Math.min(rawFrameMs / 1000, 0.05);
    lastTime = currentTime;
    frameCounter += 1;

    // 30fps (33.3ms/frame) 維持のための動的解像度ガバナー
    // Why 単発フレームスパイクでの即時リサイズや頻繁な RenderTarget 再生成を行わないか:
    // WebGLRenderTarget.setSize() が高頻度で呼ばれるとオフスクリーンバッファが再確保・クリアされ、
    // 走行中に画面全体が一瞬チカチカと点滅する原因になるため、十分なクールダウン（180フレーム以上）を設ける。
    const canRunResolutionGovernor =
      isTitleScreenDismissed &&
      frameCounter - lastGovernorResizeFrame >= 180 &&
      frameCounter % 60 === 0;
    if (canRunResolutionGovernor) {
      const isSustainedBelowTargetFps = smoothedFrameMs > 34.0 && adaptivePixelRatioScale > 0.65;
      const hasSustainedHeadroom = smoothedFrameMs < 16.0 && adaptivePixelRatioScale < 1.0;
      if (isSustainedBelowTargetFps) {
        adaptivePixelRatioScale = Math.max(0.65, adaptivePixelRatioScale - 0.15);
        lastGovernorResizeFrame = frameCounter;
        handleResize();
      } else if (hasSustainedHeadroom) {
        adaptivePixelRatioScale = Math.min(1.0, adaptivePixelRatioScale + 0.1);
        lastGovernorResizeFrame = frameCounter;
        handleResize();
      }
    }

    // 1. 入力取得（タイトル画面表示中はゲームパッドスロットル開始判定のみ行い、アイドルフレームは3D再描画をスキップする）
    const rawInput = inputManager.getInput();
    const hasGamepadStartThrottle = !isTitleScreenDismissed && rawInput.throttle > 0.25;
    if (hasGamepadStartThrottle) {
      dismissTitleScreen("gamepad_throttle");
    }

    // Why タイトル画面表示中（#title-screen-overlay が画面を覆っている状態）は初回背景描画後の毎フレーム 3D フル描画を間引くか:
    // 走行開始前に毎フレーム物理ステップ・Canvas2D ナビ/メーター再描画・3D シーン描画を回すと GPU/CPU を無意味に消費し、
    // 統合 GPU や SwiftShader 環境で 30fps を大きく割り込むため、初回フレーム描画後は 30 フレームに 1 回のみ背景を更新する。
    const isTitleOverlayIdleFrame =
      !isTitleScreenDismissed && frameCounter > 1 && frameCounter % 30 !== 0;
    if (isTitleOverlayIdleFrame) {
      return;
    }

    const activeInput = isTitleScreenDismissed
      ? rawInput
      : { throttle: 0, brake: 1, steer: 0, handbrake: true };
    if (isTitleScreenDismissed) {
      vehiclePhysics.update(dt, activeInput);
      physics.step(dt);
    }

    // 2. 車両ステート同期 & オープンワールドチャンクストリーミング & エリア・距離カリング更新
    const vehicleState = vehiclePhysics.getState();
    // ステアリング操舵後の直進復帰によるウインカー自動キャンセル（左折/右折後に舵角が中立付近へ戻ったら自動消灯）
    const isDirectionalTurnSignal =
      currentTurnSignalState === "left" || currentTurnSignalState === "right";
    if (isDirectionalTurnSignal) {
      const isSteeredTowardSignal =
        (currentTurnSignalState === "left" && vehicleState.steeringAngle >= 0.18) ||
        (currentTurnSignalState === "right" && vehicleState.steeringAngle <= -0.18) ||
        Math.abs(vehicleState.steeringAngle) >= 0.22;
      if (isSteeredTowardSignal) {
        hasTurnSignalReachedSteerThreshold = true;
      }
      const hasReturnedNearCenter =
        hasTurnSignalReachedSteerThreshold && Math.abs(vehicleState.steeringAngle) <= 0.05;
      if (hasReturnedNearCenter) {
        setTurnSignalState("off", "auto_cancel");
      }
    }
    vehicleState.turnSignal = currentTurnSignalState;
    const carPos = reusableCarPos.set(
      vehicleState.position.x,
      vehicleState.position.y,
      vehicleState.position.z,
    );
    const carVelocity = reusableCarVelocity.set(
      vehicleState.velocity.x,
      vehicleState.velocity.y,
      vehicleState.velocity.z,
    );
    const canUpdateStreamingFrame = !isWarpStreamingInProgress;
    if (canUpdateStreamingFrame) {
      streamingSystem.updateFrame({
        vehicleX: carPos.x,
        vehicleZ: carPos.z,
        velocityX: carVelocity.x,
        velocityZ: carVelocity.z,
        headingAngleRad: vehicleState.headingAngle,
        speedKmh: vehicleState.speedKmh,
        deltaSeconds: dt,
      });
    }
    const isUnderFrameBudgetStress = rawFrameMs > 30.0 || smoothedFrameMs > 28.0;
    const shouldUpdateDistanceCulling = frameCounter === 1 || frameCounter % 4 === 1;
    if (shouldUpdateDistanceCulling) {
      const budgetActiveRadius = streamingSystem.getBudgetProfile().activeRadiusM;
      const cullingDistanceM = Math.max(280, Math.min(420, budgetActiveRadius));
      cityMap.updateDistanceCulling(carPos, cullingDistanceM);
    }

    // 3. 時間帯 & 天候 & 雨シミュレーション更新（水たまりシェーダー＆フロントガラス雨滴光学シェーダーへ太陽・空色・波紋強度を同期）
    weatherSystem.update(dt, carPos, carVelocity);
    const puddleEnvParams = weatherSystem.getPuddleEnvironmentParams();
    cityMap.updateRainWetness(weatherSystem.wetness, currentTime * 0.001, puddleEnvParams);

    // 4. 車体メッシュ & ワイパー & フロントガラス更新（環境ラベル更新は時間帯・天候・言語切替時のみイベント駆動で実行）
    carModel.setWindshieldEnvironment(puddleEnvParams);
    carModel.update(dt, vehicleState, weatherSystem.rainIntensity);

    // 4.05 ガードレール・デリネーター再帰反射シェーダーへ左右ツインヘッドライト座標・車両進行方向・夜間係数を同期
    const fwdX = Math.sin(vehicleState.headingAngle);
    const fwdZ = Math.cos(vehicleState.headingAngle);
    const rightX = Math.cos(vehicleState.headingAngle);
    const rightZ = -Math.sin(vehicleState.headingAngle);
    reusableHeadlightPosL.set(
      carPos.x - rightX * 0.64 + fwdX * 2.34,
      carPos.y + 0.67,
      carPos.z - rightZ * 0.64 + fwdZ * 2.34,
    );
    reusableHeadlightPosR.set(
      carPos.x + rightX * 0.64 + fwdX * 2.34,
      carPos.y + 0.67,
      carPos.z + rightZ * 0.64 + fwdZ * 2.34,
    );
    reusableVehicleForward.set(fwdX, 0, fwdZ);
    const isHeadlightsOn = weatherSystem.shouldEnableHeadlights();
    RoadProps.syncRetroreflectorEnvironment({
      headlightPosL: reusableHeadlightPosL,
      headlightPosR: reusableHeadlightPosR,
      vehicleForward: reusableVehicleForward,
      headlightsActive: isHeadlightsOn ? 1.0 : 0.25,
      nightFactor: puddleEnvParams.nightFactor ?? 0.0,
    });

    // 4.1 エンジン音響合成のリアルタイム更新（3Dタコメーター針の回転数・スロットル負荷・ギア段・カメラ視点に完全同期）
    if (isTitleScreenDismissed) {
      engineAudio.update(dt, {
        rpm: carModel.getSmoothedRpm(),
        speedKmh: vehicleState.speedKmh,
        throttle: activeInput.throttle,
        brake: activeInput.brake,
        gear: vehicleState.gear,
        cameraMode: cameraController.mode,
      });
    }

    // 5. カメラ更新（J/Lキー長押しによる首振りパンも反映）
    const gazePan = inputManager.getGazePanDelta(dt);
    const hasGazePan =
      Math.abs(gazePan.deltaYawRad) > 1e-6 || Math.abs(gazePan.deltaPitchRad) > 1e-6;
    if (hasGazePan) {
      cameraController.addGazeDelta(gazePan.deltaYawRad, gazePan.deltaPitchRad);
    }
    cameraController.update(dt, vehicleState, carModel.group);
    syncGazeHud();

    // 5.1 大気スカイドームのカメラ追従 & 雲流動更新
    weatherSystem.updateSky(currentTime * 0.001, cameraController.camera.position);

    // 5.2 車内ルームミラー（バックミラー）& 左右ドアミラー（サイドミラー）のリアルタイム後方反射描画
    // Why 運転席視点 (cockpit) かつタイトル画面解除後・フレームレート余裕時のみ更新するか:
    // 追従視点 (chase) やタイトルオーバーレイ表示中、あるいはフレーム時間が 26ms を超える高負荷時には
    // シーン全体の2パス目オフスクリーン描画をスキップして 30fps (33.3ms/frame) を確実に維持するため。
    const isCockpitCamera = cameraController.mode === "cockpit";
    const hasMirrorFrameBudget =
      isTitleScreenDismissed && rawFrameMs <= 28.0 && smoothedFrameMs <= 26.0;
    const shouldUpdateCarMirrors = isCockpitCamera && hasMirrorFrameBudget;
    if (shouldUpdateCarMirrors) {
      carModel.updateMirrors(renderer, scene);
    }

    // 5.3 シャドウマップは8フレームに1回（かつフレーム予算に余裕がある時のみ）更新し GPU シャドウパス負荷を削減
    const shouldRefreshShadowMap =
      renderer.shadowMap.enabled && !isUnderFrameBudgetStress && frameCounter % 8 === 0;
    if (shouldRefreshShadowMap) {
      renderer.shadowMap.needsUpdate = true;
    }

    // 6. ポストプロセスパイプライン描画（深度フォグ → レンズフレア → モーションブラー）
    // Why フレームごとの負荷判定 (isUnderFrameBudgetStress) でポストプロセスを ON/OFF しないか:
    // depthFogPass（大気ミー散乱・高度減衰フォグ）や lensFlarePass を 1 フレーム単位でバイパスしたり
    // 再有効化したりすると、空・道路・遠景の輝度とトーンが毎フレーム激しく切り替わり、
    // 走行中に画面全体がチカチカと白く点滅（フラッシュ）してしまうため、画質設定にのみ従わせる。
    const activeGraphicsPreset = getGraphicsQualityPreset(currentGraphicsQuality);
    const shouldRunLensFlarePass =
      isTitleScreenDismissed && activeGraphicsPreset.postProcessLensFlare;
    const shouldRunMotionBlurPass = isTitleScreenDismissed && motionBlurEnabled;
    const canRenderDirectlyToScreen = !shouldRunLensFlarePass && !shouldRunMotionBlurPass;

    if (canRenderDirectlyToScreen) {
      // Why 低画質 (low) かつモーションブラー OFF 時（または高負荷フレーム時）に直接画面 (null) へ描画するか:
      // depthFogPass.renderTarget へのオフスクリーン描画＋フルスクリーンクワッド転送パス自体をバイパスし、
      // Three.js 標準の scene.fog による 1 パス直接描画のみでフルスクリーンフラグメント帯域を半減させるため。
      renderer.setRenderTarget(null);
      renderer.render(scene, cameraController.camera);
    } else {
      renderer.setRenderTarget(depthFogPass.renderTarget);
      renderer.render(scene, cameraController.camera);

      if (shouldRunLensFlarePass) {
        depthFogPass.render(
          renderer,
          depthFogPass.renderTarget.texture,
          lensFlarePass.renderTarget,
        );

        lensFlarePass.updateSunPosition(cameraController.camera);
        if (shouldRunMotionBlurPass) {
          lensFlarePass.render(
            renderer,
            lensFlarePass.renderTarget.texture,
            depthFogPass.renderTarget.depthTexture,
            motionBlurPass.renderTarget,
          );
          motionBlurPass.update(vehicleState.speedKmh, true, {
            cameraNear: cameraController.camera.near,
            cameraFar: cameraController.camera.far,
            cameraMode: cameraController.mode,
          });
          motionBlurPass.renderFromTexture(
            renderer,
            motionBlurPass.renderTarget.texture,
            null,
            depthFogPass.renderTarget.depthTexture,
          );
        } else {
          lensFlarePass.render(
            renderer,
            lensFlarePass.renderTarget.texture,
            depthFogPass.renderTarget.depthTexture,
            null,
          );
        }
      } else {
        depthFogPass.render(
          renderer,
          depthFogPass.renderTarget.texture,
          motionBlurPass.renderTarget,
        );
        motionBlurPass.update(vehicleState.speedKmh, true, {
          cameraNear: cameraController.camera.near,
          cameraFar: cameraController.camera.far,
          cameraMode: cameraController.mode,
        });
        motionBlurPass.renderFromTexture(
          renderer,
          motionBlurPass.renderTarget.texture,
          null,
          depthFogPass.renderTarget.depthTexture,
        );
      }
    }

    // 7. HUD更新（スピードメーター & 東京都PLATEAU / 国土地理院 GIS テレメトリ）
    const hasSpeedDisplay = Boolean(speedDisplay);
    if (hasSpeedDisplay) {
      const nextSpeedText = Math.round(vehicleState.speedKmh).toString();
      const hasSpeedChanged = nextSpeedText !== lastSpeedText;
      if (hasSpeedChanged) {
        lastSpeedText = nextSpeedText;
        speedDisplay!.textContent = nextSpeedText;
      }
    }
    const hasGearIndicator = Boolean(gearIndicator);
    if (hasGearIndicator) {
      const nextGearText = vehicleState.gear;
      const hasGearChanged = nextGearText !== lastGearText;
      if (hasGearChanged) {
        lastGearText = nextGearText;
        gearIndicator!.textContent = nextGearText;
      }
    }

    gisHudElapsedSec += dt;
    const shouldUpdateGisHud = gisHudElapsedSec >= 0.1;
    if (shouldUpdateGisHud) {
      gisHudElapsedSec = 0;
      const currentLocale = i18n.getLocale();
      const dict = i18n.t();
      const isInShibuyaZone = carPos.x < -550;
      const hasGisAreaHeader = Boolean(gisAreaHeader);
      if (hasGisAreaHeader) {
        const nextAreaHeaderText = isInShibuyaZone
          ? dict.gisHeaderShibuya
          : dict.gisHeaderMarunouchi;
        const hasAreaHeaderChanged = nextAreaHeaderText !== lastGisAreaHeaderText;
        if (hasAreaHeaderChanged) {
          lastGisAreaHeaderText = nextAreaHeaderText;
          gisAreaHeader!.textContent = nextAreaHeaderText;
        }
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
        gisRoadDisplay!.textContent = formatGsiRoadTelemetry(nearestRoad, currentLocale);
      }

      const hasGisBldgDisplay = Boolean(gisBldgDisplay);
      if (hasGisBldgDisplay) {
        const nearestBldg = findNearestPlateauBuilding(carPos.x, carPos.z);
        gisBldgDisplay!.textContent = formatPlateauBuildingTelemetry(nearestBldg, currentLocale);
      }

      syncStreamingHudAndBanner(streamingSystem.getStatus());
    }
  }

  animate();
}

bootstrap().catch((err) => {
  logger.error("bootstrap", "bootstrap.fatal", err instanceof Error ? err.message : String(err));
});

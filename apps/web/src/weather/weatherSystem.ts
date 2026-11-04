import * as THREE from "three";
import { Lensflare, LensflareElement } from "three/examples/jsm/objects/Lensflare.js";
import { getGraphicsQualityPreset, type GraphicsQualityPreset } from "../core/graphicsQuality";
import {
  localizeRoadSurfaceLabel,
  localizeTimeOfDaySummaryLabel,
  localizeWeatherSummaryLabel,
  type SupportedLocale,
} from "../core/i18n";
import { AtmosphericSky } from "../shaders/skyShader";
import type {
  GraphicsQuality,
  RoadSurfaceCondition,
  TimeOfDay,
  WeatherCondition,
  WeatherType,
} from "../types";
import type { WeatherPreset } from "../assets/schema";

export interface TimeOfDayMetadata {
  id: TimeOfDay;
  label: string;
  clockText: string;
  baseHour: number;
  baseMinute: number;
}

export const TIME_OF_DAY_CONFIG: Record<TimeOfDay, TimeOfDayMetadata> = {
  morning: { id: "morning", label: "朝", clockText: "06:30", baseHour: 6, baseMinute: 30 },
  day: { id: "day", label: "昼", clockText: "12:00", baseHour: 12, baseMinute: 0 },
  sunset: { id: "sunset", label: "夕暮れ", clockText: "17:30", baseHour: 17, baseMinute: 30 },
  night: { id: "night", label: "夜間", clockText: "21:00", baseHour: 21, baseMinute: 0 },
};

export const WEATHER_CONDITION_LABELS: Record<WeatherCondition, string> = {
  clear: "晴天",
  cloudy: "曇天",
  rain: "雨天",
};

export const ROAD_SURFACE_LABELS: Record<RoadSurfaceCondition, string> = {
  dry: "乾燥",
  wet: "雨上がり・湿潤",
  puddle: "水たまり",
};

interface TimeLightingProfile {
  sunPosition: [number, number, number];
  moonPosition: [number, number, number];
  moonColor: number;
  moonIntensity: number;
  zenithColor: number;
  horizonColor: number;
  fogColor: number;
  baseFogDensity: number;
  sunColor: number;
  sunIntensity: number;
  ambientSkyColor: number;
  ambientGroundColor: number;
  ambientIntensity: number;
  cloudColor: number;
  cloudShadowColor: number;
  baseCloudCoverage: number;
  baseCloudDensity: number;
  starsIntensity: number;
  lensflareEnabled: boolean;
  lensflareIntensity: number;
  lensflareColor: number;
  baseWetness: number;
}

const TIME_LIGHTING_PROFILES: Record<TimeOfDay, TimeLightingProfile> = {
  morning: {
    sunPosition: [-7, 46, 180],
    moonPosition: [6, 62, 180],
    moonColor: 0xe2e8f0,
    moonIntensity: 0.35,
    zenithColor: 0x1d4ed8,
    horizonColor: 0xfda4af,
    fogColor: 0xfecdd3,
    baseFogDensity: 0.0022,
    sunColor: 0xfde68a,
    sunIntensity: 2.4,
    ambientSkyColor: 0xbfdbfe,
    ambientGroundColor: 0x1e293b,
    ambientIntensity: 0.95,
    cloudColor: 0xffe4e6,
    cloudShadowColor: 0x475569,
    baseCloudCoverage: 0.46,
    baseCloudDensity: 0.36,
    starsIntensity: 0.02,
    lensflareEnabled: true,
    lensflareIntensity: 0.32,
    lensflareColor: 0xfef08a,
    baseWetness: 0.68,
  },
  day: {
    sunPosition: [-5, 52, 180],
    moonPosition: [14, 48, -180],
    moonColor: 0xe2e8f0,
    moonIntensity: 0.0,
    zenithColor: 0x0284c7,
    horizonColor: 0xbae6fd,
    fogColor: 0xbae6fd,
    baseFogDensity: 0.0015,
    sunColor: 0xfffaed,
    sunIntensity: 2.8,
    ambientSkyColor: 0x93c5fd,
    ambientGroundColor: 0x1e293b,
    ambientIntensity: 1.05,
    cloudColor: 0xffffff,
    cloudShadowColor: 0x94a3b8,
    baseCloudCoverage: 0.44,
    baseCloudDensity: 0.38,
    starsIntensity: 0.0,
    lensflareEnabled: true,
    lensflareIntensity: 0.14,
    lensflareColor: 0xfffaed,
    baseWetness: 0.58,
  },
  sunset: {
    sunPosition: [4, 40, 180],
    moonPosition: [-6, 62, 180],
    moonColor: 0xf1f5f9,
    moonIntensity: 0.68,
    zenithColor: 0x4c1d95,
    horizonColor: 0xf97316,
    fogColor: 0xfb923c,
    baseFogDensity: 0.0025,
    sunColor: 0xff9944,
    sunIntensity: 3.2,
    ambientSkyColor: 0xfdba74,
    ambientGroundColor: 0x451a03,
    ambientIntensity: 0.92,
    cloudColor: 0xfdba74,
    cloudShadowColor: 0x4c1d95,
    baseCloudCoverage: 0.54,
    baseCloudDensity: 0.45,
    starsIntensity: 0.05,
    lensflareEnabled: true,
    lensflareIntensity: 0.18,
    lensflareColor: 0xffbb66,
    baseWetness: 0.78,
  },
  night: {
    sunPosition: [3, 48, 180],
    moonPosition: [3, 48, 180],
    moonColor: 0xe2e8f0,
    moonIntensity: 1.0,
    zenithColor: 0x020617,
    horizonColor: 0x0f172a,
    fogColor: 0x0f172a,
    baseFogDensity: 0.0038,
    sunColor: 0x93c5fd,
    sunIntensity: 0.45,
    ambientSkyColor: 0x1e293b,
    ambientGroundColor: 0x020617,
    ambientIntensity: 0.4,
    cloudColor: 0x334155,
    cloudShadowColor: 0x090d16,
    baseCloudCoverage: 0.34,
    baseCloudDensity: 0.26,
    starsIntensity: 0.95,
    lensflareEnabled: false,
    lensflareIntensity: 0.0,
    lensflareColor: 0x38bdf8,
    baseWetness: 0.82,
  },
};

/**
 * 動的時間帯（Time of Day）× 天候（Weather Condition）・大気ライティング・レンズフレアシステム
 * - 時間帯 (TimeOfDay): 朝 (06:30) / 昼 (12:00) / 夕暮れ (17:30) / 夜間 (21:00)
 * - 天候 (WeatherCondition): 晴天 (clear) / 曇天 (cloudy) / 雨天 (rain)
 * - 時間帯と天候は直交して組み合わせ可能（例：夕暮れ×晴天、夕暮れ×雨天、昼×曇天、夜間×雨天など）
 */
export class WeatherSystem {
  public currentTimeOfDay: TimeOfDay = "day";
  public currentWeatherCondition: WeatherCondition = "clear";
  public currentRoadSurface: RoadSurfaceCondition = "wet";
  public currentWeather: WeatherType = "clear";
  public currentGraphicsQuality: GraphicsQuality = "high";
  public activeRainCount = 8500;
  public activeSplashCount = 2600;
  public rainIntensity = 0.0;
  public wetness = 0.0;
  public fogColorHex = 0xbae6fd;
  public fogDensity = 0.0015;
  public lensflareConfig = {
    enabled: true,
    intensity: 1.0,
    color: 0xfffaed,
  };
  public sky: AtmosphericSky;

  private scene: THREE.Scene;
  public dirLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private lensflare: Lensflare;
  public rainMesh: THREE.InstancedMesh;
  public rainSplashMesh: THREE.InstancedMesh;
  public rainMaterial: THREE.ShaderMaterial;
  public rainSplashMaterial: THREE.ShaderMaterial;
  private rainCount = 8500;
  private splashCount = 2600;
  private elapsedSimSeconds = 0;
  private baseSunPosition = new THREE.Vector3(55, 72, -175);
  private baseMoonPosition = new THREE.Vector3(-42, 62, -165);
  private lastTargetCarPos = new THREE.Vector3(0, 0, 0);

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // 1. 半球環境光
    this.hemiLight = new THREE.HemisphereLight(0xbfdbfe, 0x1e293b, 1.0);
    this.scene.add(this.hemiLight);

    // 2. 太陽・月光（DirectionalLight）
    this.dirLight = new THREE.DirectionalLight(0xfffaed, 2.8);
    this.dirLight.position.set(100, 150, 100);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 2048;
    this.dirLight.shadow.mapSize.height = 2048;
    this.dirLight.shadow.camera.near = 10;
    this.dirLight.shadow.camera.far = 850;
    this.dirLight.shadow.camera.left = -240;
    this.dirLight.shadow.camera.right = 240;
    this.dirLight.shadow.camera.top = 240;
    this.dirLight.shadow.camera.bottom = -240;
    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);

    // 3. レンズフレア
    this.lensflare = this.createLensFlare();
    this.dirLight.add(this.lensflare);

    // 4. 物理ベース GPU 雨ストリーク＆着水クラウンスプラッシュシステム
    const { rainMesh, rainMaterial, splashMesh, splashMaterial } = this.createRainSystem();
    this.rainMesh = rainMesh;
    this.rainMaterial = rainMaterial;
    this.rainSplashMesh = splashMesh;
    this.rainSplashMaterial = splashMaterial;
    this.scene.add(this.rainMesh);
    this.scene.add(this.rainSplashMesh);

    // 5. 大気散乱・動的雲スカイドーム
    this.sky = new AtmosphericSky();
    this.scene.add(this.sky.mesh);

    // 初期環境（昼 × 晴天）の適用
    this.setEnvironment("day", "clear");
  }

  private createLensFlare(): Lensflare {
    const lensflare = new Lensflare();

    const mainFlareTex = this.generateFlareTexture(256, 1.0, 0.9, 0.7);
    const ringFlareTex = this.generateFlareTexture(128, 0.4, 0.7, 1.0);
    const ghostFlareTex = this.generateFlareTexture(64, 0.9, 0.5, 0.2);

    lensflare.addElement(new LensflareElement(mainFlareTex, 450, 0, new THREE.Color(0xfffaed)));
    lensflare.addElement(new LensflareElement(ringFlareTex, 70, 0.2, new THREE.Color(0x93c5fd)));
    lensflare.addElement(new LensflareElement(ghostFlareTex, 130, 0.5, new THREE.Color(0xfde047)));
    lensflare.addElement(new LensflareElement(ghostFlareTex, 90, 0.8, new THREE.Color(0xf43f5e)));

    return lensflare;
  }

  private generateFlareTexture(size: number, r: number, g: number, b: number): THREE.Texture {
    const isDomAvailable = typeof document !== "undefined";
    if (!isDomAvailable) {
      // Why not: Node.js / Vitest 等のヘッドレス単体テスト環境では document が存在しないため DataTexture へフォールバックする
      const data = new Uint8Array([
        Math.floor(r * 255),
        Math.floor(g * 255),
        Math.floor(b * 255),
        255,
      ]);
      const tex = new THREE.DataTexture(data, 1, 1);
      tex.needsUpdate = true;
      return tex;
    }

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const hasContext = ctx !== null;
    if (!hasContext) {
      return new THREE.CanvasTexture(canvas);
    }

    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(
      0.0,
      `rgba(${Math.floor(r * 255)}, ${Math.floor(g * 255)}, ${Math.floor(b * 255)}, 1.0)`,
    );
    gradient.addColorStop(
      0.2,
      `rgba(${Math.floor(r * 255)}, ${Math.floor(g * 255)}, ${Math.floor(b * 255)}, 0.4)`,
    );
    gradient.addColorStop(
      0.5,
      `rgba(${Math.floor(r * 255 * 0.5)}, ${Math.floor(g * 255 * 0.5)}, ${Math.floor(b * 255)}, 0.1)`,
    );
    gradient.addColorStop(1.0, "rgba(0, 0, 0, 0.0)");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    return new THREE.CanvasTexture(canvas);
  }

  /**
   * 物理ベース GPU 雨ストリーク（ベロシティストレッチ・ビルボード）＆路面クラウンスプラッシュシステムを構築
   * - Why not: 単色 (`#93c5fd`) の太い CylinderGeometry を CPU ループで更新すると「青いプラスチックの棒」にしか見えず、
   *   コックピット車内にまで雨が貫通して安っぽくなるため。
   * - How:
   *   1. 8,500個のカメラ向きベロシティストレッチ・リボンを GPU 頂点シェーダーでトロイダルラップさせ、
   *      車内キャビン除外マスク・先端ティアドロップハイライト・後端フェード・大気光散乱をフラグメントシェーダーで描画。
   *   2. 2,600個の路面着水マイクロクラウンスプラッシュ（水飛沫リング＆跳ね返りミスト）を路面に配置し、
   *      雨粒がアスファルトを叩く動的インパクトを表現。
   */
  private createRainSystem(): {
    rainMesh: THREE.InstancedMesh;
    rainMaterial: THREE.ShaderMaterial;
    splashMesh: THREE.InstancedMesh;
    splashMaterial: THREE.ShaderMaterial;
  } {
    // --- A. 空中落下雨ストリーク（GPU Velocity-Stretched Billboard） ---
    const streakGeo = new THREE.PlaneGeometry(1.0, 1.0);
    const aSeed = new Float32Array(this.rainCount * 4);
    for (let i = 0; i < this.rainCount; i++) {
      aSeed[i * 4 + 0] = Math.random();
      aSeed[i * 4 + 1] = Math.random();
      aSeed[i * 4 + 2] = Math.random();
      aSeed[i * 4 + 3] = Math.random();
    }
    streakGeo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(aSeed, 4));

    const rainMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0.0 },
        uRainIntensity: { value: 1.0 },
        uCarPos: { value: new THREE.Vector3(3.5, 0.8, 26.0) },
        uCarVel: { value: new THREE.Vector3(0.0, 0.0, 0.0) },
        uWindVel: { value: new THREE.Vector3(-1.6, 0.0, -2.4) },
        uSkyColor: { value: new THREE.Color(0x94a3b8) },
        uSunColor: { value: new THREE.Color(0xe2e8f0) },
        uFogColor: { value: new THREE.Color(0x475569) },
        uNightFactor: { value: 0.0 },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime;
        uniform float uRainIntensity;
        uniform vec3 uCarPos;
        uniform vec3 uCarVel;
        uniform vec3 uWindVel;

        varying vec2 vUv;
        varying float vDist;
        varying float vDropSeed;
        varying float vCabinClip;
        varying float vHeightFade;

        void main() {
          vUv = uv;
          vDropSeed = aSeed.w;

          // 車両周囲 92m × 34m × 92m の3Dボリューム内で連続トロイダルラップ
          vec3 boxSize = vec3(92.0, 34.0, 92.0);
          float fallSpeed = mix(24.0, 38.0, aSeed.w);

          vec3 relVel = vec3(
            uWindVel.x - uCarVel.x * 0.42,
            -fallSpeed,
            uWindVel.z - uCarVel.z * 0.42
          );

          vec3 baseOffset = (aSeed.xyz - 0.5) * boxSize;
          vec3 animatedPos = baseOffset + relVel * uTime;
          vec3 wrappedOffset = mod(animatedPos - uCarPos + boxSize * 0.5, boxSize) - boxSize * 0.5;

          vec3 dropCenter = uCarPos + wrappedOffset;
          // 地面 (y = 0.05m) ～ 上空 (y = 34.05m) に配置
          dropCenter.y = mod(animatedPos.y, boxSize.y) + 0.05;

          // 車内キャビン空間（ルーフ・フロントガラス内側のドライ空間）には雨粒を入れない
          vec3 localCar = dropCenter - uCarPos;
          float inCabinBox = step(abs(localCar.x), 0.92) *
                             step(-0.1, localCar.y) * step(localCar.y, 1.52) *
                             step(-2.15, localCar.z) * step(localCar.z, 1.45);
          // カメラ極近傍（0.55m以内）の巨大化ノイズも防止
          float tooCloseToCam = 1.0 - smoothstep(0.35, 0.75, distance(dropCenter, cameraPosition));
          vCabinClip = clamp(inCabinBox + tooCloseToCam, 0.0, 1.0);

          vec3 toCam = cameraPosition - dropCenter;
          float dist = length(toCam);
          vDist = dist;

          vec3 viewDir = toCam / max(dist, 0.001);
          vec3 dropDir = normalize(relVel);

          // カメラ視線と落下ベクトルに直交するビルボード横軸
          vec3 rightAxis = normalize(cross(viewDir, dropDir));
          // 遠方でもラスタライザでピクセル落ちしないよう視距離比例でスクリーン最小幅を確保しつつ、繊細な雨糸 (10mm〜22mm) に設定
          float streakWidth = mix(0.011, 0.022, aSeed.x) * (1.0 + clamp(dist * 0.042, 0.0, 2.4));
          // 落下速度と走行速度に応じた自然なシャッタースピード残像長 (0.85m〜1.85m)
          float speedStretch = clamp(length(uCarVel) * 0.038, 0.0, 0.85);
          float streakLength = (mix(0.85, 1.72, aSeed.w) + speedStretch) * mix(0.45, 1.0, uRainIntensity);

          // uv.y = 0.0 が下端（雨粒の先端ヘッド）、uv.y = 1.0 が上端（残像テール）
          vec3 worldPos = dropCenter
            + rightAxis * ((uv.x - 0.5) * streakWidth)
            - dropDir * ((uv.y - 0.5) * streakLength);

          vHeightFade = smoothstep(0.02, 0.45, dropCenter.y) * smoothstep(34.0, 27.0, dropCenter.y);

          gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uRainIntensity;
        uniform vec3 uSkyColor;
        uniform vec3 uSunColor;
        uniform vec3 uFogColor;
        uniform float uNightFactor;

        varying vec2 vUv;
        varying float vDist;
        varying float vDropSeed;
        varying float vCabinClip;
        varying float vHeightFade;

        void main() {
          if (vCabinClip > 0.5 || uRainIntensity <= 0.01) {
            discard;
          }

          // 横断面ガウシアン減衰（中心軸が鋭く輝き、両端が滑らかに透過してプラスチック棒感を排除）
          float radial = abs(vUv.x - 0.5) * 2.0;
          float coreProfile = exp(-radial * radial * 4.8);

          // 縦断面（下端 vUv.y ≈ 0.12 に雨滴先端の明るいメニスカス凝縮核、上端 vUv.y → 1.0 へ長いモーションブラー減衰）
          float headTip = smoothstep(0.0, 0.10, vUv.y) * exp(-pow((vUv.y - 0.12) * 3.8, 2.0));
          float tailWake = smoothstep(0.0, 0.06, vUv.y) * pow(1.0 - vUv.y, 1.45);
          float longitudinal = tailWake * 0.78 + headTip * 0.95;

          // 距離減衰（近景〜中景の繊細な雨幕と遠景フォグへの溶け込み）
          float distFade = (1.0 - smoothstep(16.0, 56.0, vDist)) * smoothstep(0.55, 1.6, vDist);

          // 環境光・太陽散乱・夜間ヘッドライト／街灯反射をブレンドした半透明銀白色の水滴色
          vec3 envTint = mix(uSkyColor, uFogColor, 0.35);
          vec3 silverSpec = mix(vec3(0.88, 0.94, 1.0), uSunColor, 0.38);
          vec3 nightHeadlightGlint = vec3(0.82, 0.92, 1.0) * uNightFactor * 0.52;
          vec3 dropColor = mix(envTint, silverSpec, 0.65 + headTip * 0.35) + nightHeadlightGlint;

          // 粒ごとの微細な輝度ばらつき（手前の主雨糸と奥の雨霧の奥行きレイヤー）
          float seedAlpha = mix(0.16, 0.46, pow(vDropSeed, 1.2));
          float alpha = coreProfile * longitudinal * distFade * vHeightFade * seedAlpha * uRainIntensity;

          if (alpha < 0.004) {
            discard;
          }

          gl_FragColor = vec4(dropColor, clamp(alpha, 0.0, 0.48));
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    });

    const rainMesh = new THREE.InstancedMesh(streakGeo, rainMaterial, this.rainCount);
    rainMesh.frustumCulled = false;
    rainMesh.visible = false;

    // --- B. 路面着水マイクロクラウンスプラッシュ（Ground Impact Splash Rings） ---
    const splashGeo = new THREE.PlaneGeometry(0.22, 0.22);
    const aSplashSeed = new Float32Array(this.splashCount * 4);
    for (let i = 0; i < this.splashCount; i++) {
      aSplashSeed[i * 4 + 0] = Math.random();
      aSplashSeed[i * 4 + 1] = Math.random();
      aSplashSeed[i * 4 + 2] = Math.random();
      aSplashSeed[i * 4 + 3] = Math.random();
    }
    splashGeo.setAttribute("aSplashSeed", new THREE.InstancedBufferAttribute(aSplashSeed, 4));

    const splashMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0.0 },
        uRainIntensity: { value: 1.0 },
        uCarPos: { value: new THREE.Vector3(3.5, 0.8, 26.0) },
        uSkyColor: { value: new THREE.Color(0x94a3b8) },
        uSunColor: { value: new THREE.Color(0xe2e8f0) },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aSplashSeed;
        uniform float uTime;
        uniform float uRainIntensity;
        uniform vec3 uCarPos;

        varying vec2 vUv;
        varying float vPhase;
        varying float vDistFade;

        void main() {
          vUv = uv;

          // 1粒あたり約0.35秒周期で弾けて消えるクラウンスプラッシュ
          float rate = mix(2.4, 3.8, aSplashSeed.w);
          float life = uTime * rate + aSplashSeed.z * 17.0;
          float cycleId = floor(life);
          vPhase = fract(life);

          // サイクルごとに少しずつ着水位置をずらす擬似乱数
          vec2 jitter = fract(sin(vec2(cycleId * 12.9898, cycleId * 78.233) + aSplashSeed.xy * 43.1) * 43758.5453) - 0.5;
          vec2 areaSize = vec2(44.0, 56.0);
          vec2 baseXZ = (aSplashSeed.xy - 0.5) * areaSize + jitter * 2.5;
          vec2 wrappedXZ = mod(baseXZ - uCarPos.xz + areaSize * 0.5, areaSize) - areaSize * 0.5;
          vec3 splashCenter = vec3(uCarPos.x + wrappedXZ.x, 0.025, uCarPos.z + wrappedXZ.y);

          // 自車直下（シャシー下）のスプラッシュは除外
          vec2 localCarXZ = splashCenter.xz - uCarPos.xz;
          float underCar = step(abs(localCarXZ.x), 0.95) * step(abs(localCarXZ.y), 2.35);

          float dist = distance(splashCenter, cameraPosition);
          vDistFade = (1.0 - smoothstep(6.0, 32.0, dist)) * (1.0 - underCar);

          // カメラへ向く微小クラウンビルボード（拡大しながら弾ける）
          vec3 toCam = normalize(cameraPosition - splashCenter);
          vec3 rightAxis = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
          float scale = mix(0.35, 1.25, sin(vPhase * 3.14159)) * uRainIntensity;

          vec3 worldPos = splashCenter
            + rightAxis * ((uv.x - 0.5) * 0.14 * scale)
            + vec3(0.0, uv.y * 0.095 * scale, 0.0);

          gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uRainIntensity;
        uniform vec3 uSkyColor;
        uniform vec3 uSunColor;

        varying vec2 vUv;
        varying float vPhase;
        varying float vDistFade;

        void main() {
          if (vDistFade <= 0.01 || uRainIntensity <= 0.05) {
            discard;
          }

          // 王冠状の跳ね返りスプラッシュ弧と3本の微細飛沫ジェット
          vec2 p = vec2((vUv.x - 0.5) * 2.0, vUv.y);
          float arcRadius = mix(0.25, 0.92, vPhase);
          float distFromCenter = length(vec2(p.x * 0.85, p.y * 1.15));
          float crownRing = exp(-pow((distFromCenter - arcRadius) * 9.5, 2.0));
          float crownSpikes = 0.55 + 0.45 * cos(atan(p.y, p.x) * 7.0);

          float fadeOut = sin(vPhase * 3.14159) * (1.0 - vPhase * 0.65);
          float alpha = crownRing * crownSpikes * fadeOut * vDistFade * 0.24 * uRainIntensity;

          if (alpha < 0.005) {
            discard;
          }

          vec3 splashColor = mix(uSkyColor, uSunColor, 0.45) + vec3(0.22, 0.26, 0.30);
          gl_FragColor = vec4(splashColor, clamp(alpha, 0.0, 0.26));
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    });

    const splashMesh = new THREE.InstancedMesh(splashGeo, splashMaterial, this.splashCount);
    splashMesh.frustumCulled = false;
    splashMesh.visible = false;

    return { rainMesh, rainMaterial, splashMesh, splashMaterial };
  }

  /**
   * 2つの16進数カラーをブレンドするヘルパー。
   */
  private blendHexColors(hexA: number, hexB: number, ratioB: number): number {
    const cA = new THREE.Color(hexA);
    const cB = new THREE.Color(hexB);
    cA.lerp(cB, THREE.MathUtils.clamp(ratioB, 0, 1));
    return cA.getHex();
  }

  /**
   * グラフィック品質プリセット（高 `high` / 中 `medium` / 低 `low`）を天候・大気・シャドウ・雲・雨システムへ適用する。
   * How:
   * - 太陽光シャドウの有効/無効とシャドウマップ解像度（2048 / 1024 / 512）を更新し、既存シャドウマップを安全に破棄・再確保させる
   * - 3D ボリュメトリック雲シェーダーのレイマーチングステップ数（14 / 8 / 4）および太陽ライトマーチングステップ数（2 / 1 / 0）を更新する
   * - GPU インスタンス雨ストリーク（8500 / 4500 / 1800）および着水クラウンスプラッシュ（2600 / 1200 / 0）の描画インスタンス数を動的に切り替える
   */
  public setGraphicsQuality(quality: GraphicsQuality): GraphicsQualityPreset {
    this.currentGraphicsQuality = quality;
    const preset = getGraphicsQualityPreset(quality);

    this.dirLight.castShadow = preset.shadowsEnabled;
    const hasShadowSizeChanged =
      this.dirLight.shadow.mapSize.width !== preset.shadowMapSize ||
      this.dirLight.shadow.mapSize.height !== preset.shadowMapSize;
    if (hasShadowSizeChanged) {
      this.dirLight.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
      const hasAllocatedShadowMap = this.dirLight.shadow.map !== null;
      if (hasAllocatedShadowMap) {
        this.dirLight.shadow.map!.dispose();
        this.dirLight.shadow.map = null;
      }
    }

    this.sky.setCloudQuality(preset.cloudMarchSteps, preset.cloudSunSteps);

    this.activeRainCount = Math.max(0, Math.min(this.rainCount, preset.rainParticleCount));
    this.activeSplashCount = Math.max(0, Math.min(this.splashCount, preset.rainSplashCount));
    this.rainMesh.count = this.activeRainCount;
    this.rainSplashMesh.count = this.activeSplashCount;

    const isRainingNow = this.currentWeatherCondition === "rain" || this.rainIntensity > 0.02;
    const isSplashingNow = this.currentWeatherCondition === "rain" || this.rainIntensity > 0.05;
    this.rainMesh.visible = isRainingNow && this.activeRainCount > 0;
    this.rainSplashMesh.visible = isSplashingNow && this.activeSplashCount > 0;

    return preset;
  }

  /**
   * 時間帯（TimeOfDay）を変更し、現在の天候（WeatherCondition）および路面状態（RoadSurfaceCondition）と合成してシーンへ反映する。
   */
  public setTimeOfDay(timeOfDay: TimeOfDay): void {
    this.setEnvironment(timeOfDay, this.currentWeatherCondition, this.currentRoadSurface);
  }

  /**
   * 路面状態（RoadSurfaceCondition: dry 乾燥 / wet 雨上がり・湿潤 / puddle 水たまり）を設定する。
   * 時間帯・天候とは独立した第3の軸として動作し、「晴天 × 雨上がり」「晴天 × 乾燥」「夕暮れ × 水たまり」などを表現する。
   */
  public setRoadSurface(surface: RoadSurfaceCondition): void {
    this.currentRoadSurface = surface;
    this.wetness = this.getRoadWetnessTarget();
  }

  /**
   * 現在の路面状態（RoadSurfaceCondition）に対応する路面湿潤度（wetness ターゲット値）を算出する。
   */
  public getRoadWetnessTarget(): number {
    const isDry = this.currentRoadSurface === "dry";
    if (isDry) {
      return 0.0;
    }

    const isPuddle = this.currentRoadSurface === "puddle";
    if (isPuddle) {
      return 1.0;
    }

    // "wet"（雨上がり・湿潤）：車線の轍や路肩・広場に水たまりが残り、空・太陽・都市ビル群・街灯を鏡面反射する状態
    return 0.72;
  }

  /**
   * 天候（WeatherCondition）または旧プリセット型（WeatherType）を設定する。
   * How: "sunset" / "night" が渡された場合は時間帯（TimeOfDay）を更新し、"clear" / "cloudy" / "rain" の場合は天候を更新する。
   */
  public setWeather(type: WeatherType): void {
    const isLegacyTimeSunset = type === "sunset";
    if (isLegacyTimeSunset) {
      this.setEnvironment("sunset", this.currentWeatherCondition, this.currentRoadSurface);
      return;
    }

    const isLegacyTimeNight = type === "night";
    if (isLegacyTimeNight) {
      this.setEnvironment("night", this.currentWeatherCondition, this.currentRoadSurface);
      return;
    }

    // 雨天に切り替えた場合は路面も自動的に水たまり（puddle）へ連動させ、晴天/曇天に戻した場合は現在の路面状態（雨上がり等）を維持
    const nextSurface: RoadSurfaceCondition = type === "rain" ? "puddle" : this.currentRoadSurface;
    this.setEnvironment(this.currentTimeOfDay, type, nextSurface);
  }

  /**
   * 時間帯（朝・昼・夕暮れ・夜間）× 天候（晴天・曇天・雨天）× 路面状態（乾燥・雨上がり・水たまり）の直交する3軸から
   * 大気・太陽・雲・フォグ・雨パーティクル・路面湿潤度を合成して適用する。
   */
  public setEnvironment(
    timeOfDay: TimeOfDay,
    weather: WeatherCondition,
    roadSurface?: RoadSurfaceCondition,
  ): void {
    this.currentTimeOfDay = timeOfDay;
    this.currentWeatherCondition = weather;
    this.currentWeather = weather;
    if (roadSurface !== undefined) {
      this.currentRoadSurface = roadSurface;
    } else if (weather === "rain") {
      this.currentRoadSurface = "puddle";
    }

    const base = TIME_LIGHTING_PROFILES[timeOfDay];
    const isNight = timeOfDay === "night";
    const isCloudy = weather === "cloudy";
    const isRain = weather === "rain";

    const overcastSlateZenith = isNight ? 0x030712 : 0x1e293b;
    const overcastSlateHorizon = isNight ? 0x0f172a : 0x475569;
    const overcastSunTint = isNight ? 0x1e293b : 0x94a3b8;

    const weatherBlend = isRain ? 0.72 : isCloudy ? 0.48 : 0.0;
    const zenithColor = this.blendHexColors(base.zenithColor, overcastSlateZenith, weatherBlend);
    const horizonColor = this.blendHexColors(base.horizonColor, overcastSlateHorizon, weatherBlend);
    const fogColor = this.blendHexColors(base.fogColor, overcastSlateHorizon, weatherBlend);
    const sunColor = this.blendHexColors(base.sunColor, overcastSunTint, weatherBlend * 0.85);
    const ambientSkyColor = this.blendHexColors(
      base.ambientSkyColor,
      overcastSlateHorizon,
      weatherBlend * 0.75,
    );
    const cloudColor = this.blendHexColors(
      base.cloudColor,
      overcastSlateZenith,
      weatherBlend * 0.65,
    );

    const fogMultiplier = isRain ? 2.6 : isCloudy ? 1.55 : 1.0;
    const sunIntensityMultiplier = isRain ? 0.32 : isCloudy ? 0.58 : 1.0;
    const ambientMultiplier = isRain ? 0.68 : isCloudy ? 0.84 : 1.0;

    this.fogColorHex = fogColor;
    this.fogDensity = base.baseFogDensity * fogMultiplier;

    this.scene.background = new THREE.Color(zenithColor);
    this.scene.fog = new THREE.FogExp2(this.fogColorHex, this.fogDensity);

    this.dirLight.color.setHex(sunColor);
    this.baseSunPosition.set(base.sunPosition[0], base.sunPosition[1], base.sunPosition[2]);
    this.dirLight.position.set(
      this.lastTargetCarPos.x + this.baseSunPosition.x,
      this.baseSunPosition.y,
      this.lastTargetCarPos.z + this.baseSunPosition.z,
    );
    this.dirLight.intensity = base.sunIntensity * sunIntensityMultiplier;

    this.hemiLight.color.setHex(ambientSkyColor);
    this.hemiLight.groundColor.setHex(base.ambientGroundColor);
    this.hemiLight.intensity = base.ambientIntensity * ambientMultiplier;

    const flareAllowed = base.lensflareEnabled && !isRain && !isCloudy;
    // Why not: THREE.Lensflare を有限座標の dirLight (例: [60, 42, 180]) に直接表示すると、
    // 無限遠の太陽方向と視差ズレが生じ、ビルの背後や角から 450px の巨大スプライトが貫通描画されるため、
    // 実際の光学フレア描画は線形深度オクルージョン付きのポストプロセス LensFlarePass に一本化する。
    this.lensflare.visible = false;
    this.lensflareConfig = {
      enabled: flareAllowed,
      intensity: flareAllowed ? base.lensflareIntensity : 0.0,
      color: base.lensflareColor,
    };

    this.rainMesh.visible = isRain && this.activeRainCount > 0;
    this.rainSplashMesh.visible = isRain && this.activeSplashCount > 0;
    this.rainIntensity = isRain ? 1.0 : 0.0;
    this.wetness = this.getRoadWetnessTarget();

    const nightFactor = isNight ? 1.0 : timeOfDay === "sunset" ? 0.35 : 0.0;
    this.syncRainShaderEnvironment(horizonColor, sunColor, fogColor, nightFactor);

    const cloudShadowColor = this.blendHexColors(
      base.cloudShadowColor,
      isNight ? 0x020617 : 0x0f172a,
      weatherBlend * 0.8,
    );
    const cloudCoverage = isRain ? 0.94 : isCloudy ? 0.78 : base.baseCloudCoverage;
    const cloudDensity = isRain ? 0.88 : isCloudy ? 0.72 : base.baseCloudDensity;
    const cloudType = isRain ? 0.95 : isCloudy ? 0.62 : timeOfDay === "sunset" ? 0.35 : 0.18;
    const cloudBottomAltitude = isRain ? 420.0 : isCloudy ? 540.0 : 680.0;
    const cloudTopAltitude = isRain ? 1950.0 : isCloudy ? 1750.0 : 1850.0;
    const cloudSpeed = isRain ? 0.042 : isCloudy ? 0.028 : 0.018;
    const silverLiningIntensity = isRain
      ? 0.28
      : isCloudy
        ? 0.42
        : isNight
          ? 0.22
          : timeOfDay === "sunset" || timeOfDay === "morning"
            ? 0.45
            : 0.35;
    const powderStrength = isRain ? 0.95 : isCloudy ? 0.88 : 0.82;
    const cirrusIntensity = isRain
      ? 0.15
      : isCloudy
        ? 0.65
        : isNight
          ? 0.25
          : timeOfDay === "sunset"
            ? 0.72
            : 0.45;
    const starsIntensity = isRain
      ? 0.0
      : isCloudy
        ? base.starsIntensity * 0.25
        : base.starsIntensity;
    const moonIntensity = isRain
      ? base.moonIntensity * 0.15
      : isCloudy
        ? base.moonIntensity * 0.55
        : base.moonIntensity;

    this.baseMoonPosition.set(base.moonPosition[0], base.moonPosition[1], base.moonPosition[2]);
    this.sky.setSunPosition(this.baseSunPosition);
    this.sky.setMoonPosition(this.baseMoonPosition);
    this.sky.setParams({
      zenithColor,
      horizonColor,
      sunColor,
      moonColor: base.moonColor,
      moonIntensity,
      cloudColor,
      cloudShadowColor,
      cloudCoverage,
      cloudDensity,
      cloudType,
      cloudBottomAltitude,
      cloudTopAltitude,
      cloudSpeed,
      silverLiningIntensity,
      powderStrength,
      cirrusIntensity,
      starsIntensity,
    });
  }

  /**
   * YAMLアセットマニフェストで定義されたWeatherPresetを適用する。
   * How: まず時間帯・天候のベース環境（3Dボリュメトリック雲・太陽・月の全パラメータ）を setEnvironment で構築した上で、
   * プリセット固有のカラー・太陽位置・フォグ・雨量を上書き同期する。
   */
  public applyPreset(preset: WeatherPreset): void {
    const isSunsetPreset = preset.id === "sunset";
    const isNightPreset = preset.id === "night";
    const isRainPreset = preset.rain.enabled || preset.id === "rain";
    const isCloudyPreset = preset.id === "cloudy";

    const targetTimeOfDay: TimeOfDay = isSunsetPreset
      ? "sunset"
      : isNightPreset
        ? "night"
        : preset.id === "morning"
          ? "morning"
          : "day";

    const targetWeatherCondition: WeatherCondition = isRainPreset
      ? "rain"
      : isCloudyPreset
        ? "cloudy"
        : "clear";

    const targetRoadSurface: RoadSurfaceCondition = isRainPreset ? "puddle" : "wet";

    // まず 3D ボリュメトリック雲（coverage, type, altitude, silverLining, cirrus）と月パラメータ一式を完全初期化する
    this.setEnvironment(targetTimeOfDay, targetWeatherCondition, targetRoadSurface);

    const baseProfile = TIME_LIGHTING_PROFILES[targetTimeOfDay];

    this.fogColorHex = preset.fogColor;
    this.fogDensity = preset.fogDensity;

    this.scene.background = new THREE.Color(preset.skyColor);
    this.scene.fog = new THREE.FogExp2(preset.fogColor, preset.fogDensity);

    this.dirLight.color.setHex(preset.sunColor);
    this.baseSunPosition.set(preset.sunPosition[0], preset.sunPosition[1], preset.sunPosition[2]);
    this.dirLight.position.set(
      this.lastTargetCarPos.x + this.baseSunPosition.x,
      this.baseSunPosition.y,
      this.lastTargetCarPos.z + this.baseSunPosition.z,
    );
    this.dirLight.intensity = isNightPreset ? 0.5 : isRainPreset ? 1.0 : isSunsetPreset ? 3.2 : 2.8;

    this.hemiLight.color.setHex(preset.ambientColor);
    this.hemiLight.groundColor.setHex(
      isNightPreset ? 0x020617 : isSunsetPreset ? 0x451a03 : 0x1e293b,
    );
    this.hemiLight.intensity = isNightPreset ? 0.45 : isRainPreset ? 0.7 : 1.1;

    this.lensflare.visible = false;
    this.lensflareConfig = {
      enabled: preset.lensflare.enabled,
      intensity: preset.lensflare.intensity,
      color: preset.lensflare.color,
    };
    this.rainMesh.visible = preset.rain.enabled && this.activeRainCount > 0;
    this.rainSplashMesh.visible = preset.rain.enabled && this.activeSplashCount > 0;

    if (isRainPreset) {
      this.rainIntensity = preset.rain.intensity;
      this.currentRoadSurface = "puddle";
      this.wetness = Math.max(0.92, preset.rain.windshieldWetness);
    } else if (isNightPreset) {
      this.rainIntensity = 0.0;
      this.currentRoadSurface = "wet";
      this.wetness = 0.85;
    } else if (isSunsetPreset) {
      this.rainIntensity = 0.0;
      this.currentRoadSurface = "wet";
      this.wetness = 0.82;
    } else {
      this.rainIntensity = 0.0;
      this.currentRoadSurface = "wet";
      this.wetness = 0.76;
    }

    const presetNightFactor = isNightPreset ? 1.0 : isSunsetPreset ? 0.35 : 0.0;
    this.syncRainShaderEnvironment(
      preset.fogColor,
      preset.sunColor,
      preset.fogColor,
      presetNightFactor,
    );

    this.sky.setSunPosition(this.baseSunPosition);
    if (isNightPreset) {
      this.baseMoonPosition.copy(this.baseSunPosition);
      this.sky.setMoonPosition(this.baseMoonPosition);
    }
    this.sky.setParams({
      zenithColor: preset.skyColor,
      horizonColor: preset.fogColor,
      sunColor: preset.sunColor,
      moonColor: baseProfile.moonColor,
      moonIntensity: isRainPreset ? baseProfile.moonIntensity * 0.15 : baseProfile.moonIntensity,
      cloudDensity: isRainPreset ? 0.85 : isNightPreset ? 0.34 : baseProfile.baseCloudDensity,
      starsIntensity: isRainPreset ? 0.0 : isNightPreset ? 0.9 : baseProfile.starsIntensity,
    });
  }

  /**
   * 現在の時間帯プリセットと経過秒数から HH:MM 形式の時刻文字列を取得する。
   */
  public getClockText(): string {
    const meta = TIME_OF_DAY_CONFIG[this.currentTimeOfDay];
    const additionalMinutes = Math.floor(this.elapsedSimSeconds / 60) % 60;
    const totalMinutes = meta.baseHour * 60 + meta.baseMinute + additionalMinutes;
    const hh = Math.floor(totalMinutes / 60) % 24;
    const mm = totalMinutes % 60;
    return `${hh.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}`;
  }

  /**
   * 現在の時間帯・天候・路面状態の多言語ラベル（既定: 日本語 `"ja"`）を取得する。
   */
  public getEnvironmentSummary(locale: SupportedLocale = "ja"): {
    timeOfDay: TimeOfDay;
    timeLabel: string;
    clockText: string;
    weather: WeatherCondition;
    weatherLabel: string;
    roadSurface: RoadSurfaceCondition;
    roadSurfaceLabel: string;
  } {
    return {
      timeOfDay: this.currentTimeOfDay,
      timeLabel: localizeTimeOfDaySummaryLabel(this.currentTimeOfDay, locale),
      clockText: this.getClockText(),
      weather: this.currentWeatherCondition,
      weatherLabel: localizeWeatherSummaryLabel(this.currentWeatherCondition, locale),
      roadSurface: this.currentRoadSurface,
      roadSurfaceLabel: localizeRoadSurfaceLabel(this.currentRoadSurface, locale),
    };
  }

  /**
   * 夜間ライト・ヘッドライトを点灯すべき環境か判定する（夜間、夕暮れ、または雨天時）。
   */
  public shouldEnableHeadlights(): boolean {
    const isDarkTime = this.currentTimeOfDay === "night" || this.currentTimeOfDay === "sunset";
    const isRainy = this.currentWeatherCondition === "rain";
    return isDarkTime || isRainy;
  }

  /**
   * 都市の街灯・窓明かり・東京駅ライトアップを点灯すべき時間帯か判定する。
   */
  public isCityLightActive(): boolean {
    return this.currentTimeOfDay === "night" || this.currentTimeOfDay === "sunset";
  }

  public updateSky(time: number, cameraPos: THREE.Vector3): void {
    this.sky.update(time, cameraPos);
  }

  public getSunDirection(): THREE.Vector3 {
    return this.baseSunPosition.clone().normalize();
  }

  public getMoonDirection(): THREE.Vector3 {
    return this.baseMoonPosition.clone().normalize();
  }

  public getSunWorldPosition(): THREE.Vector3 {
    return this.baseSunPosition.clone();
  }

  public getMoonWorldPosition(): THREE.Vector3 {
    return this.baseMoonPosition.clone();
  }

  public getSunColor(): THREE.Color {
    return this.dirLight.color;
  }

  public getLensFlareConfig() {
    return this.lensflareConfig;
  }

  /**
   * 水たまりシェーダー（PuddleMaterial / JapaneseRoadMaterial）へ渡す大気・太陽・波紋パラメータを取得する。
   * How: 現在の時間帯・天候・路面状態に応じた雨滴波紋強度・太陽ベクトル・空の天頂/地平線カラー・夜間係数を返す。
   */
  public getPuddleEnvironmentParams() {
    const isNight = this.currentTimeOfDay === "night";
    const isSunset = this.currentTimeOfDay === "sunset";
    const nightFactor = isNight ? 1.0 : isSunset ? 0.35 : 0.0;
    // Why 雨上がり路面（wet / puddle）でも雨が降っていない時は rippleIntensity を 0.0 にするか:
    // 晴天や曇天の「雨上がり・湿潤 (wet)」「水たまり (puddle)」路面に固定の baseRipple を与えると、
    // 雨が降っていない快晴の空の下でも路面に雨粒が落ちる同心円波紋が常時発生して不自然になるため、
    // 着水波紋強度 (rippleIntensity) は実際の降雨量 (this.rainIntensity) にのみ連動させる。
    const isRainingOnWetRoad = this.currentRoadSurface !== "dry" && this.rainIntensity >= 0.02;
    const rippleIntensity = isRainingOnWetRoad ? this.rainIntensity : 0.0;
    const horizonUniform = this.sky.material.uniforms.uHorizonColor;
    const zenithUniform = this.sky.material.uniforms.uZenithColor;

    return {
      rippleIntensity,
      sunDirection: this.getSunDirection(),
      sunColor: this.dirLight.color,
      skyHorizonColor: horizonUniform
        ? (horizonUniform.value as THREE.Color)
        : new THREE.Color(0xfdba74),
      skyZenithColor: zenithUniform
        ? (zenithUniform.value as THREE.Color)
        : new THREE.Color(0x4c1d95),
      nightFactor,
    };
  }

  public update(dt: number, carPos: THREE.Vector3, carVelocity: THREE.Vector3): void {
    this.elapsedSimSeconds += dt;

    // Why 太陽・月光の DirectionalLight とその target を自車座標へ追従させるか:
    // 東京駅エリア (x = 0) と渋谷エリア (x = -750) は約 750m 離れているため、
    // シャドウカメラを原点 (0, 0, 0) に固定すると渋谷エリアで太陽光シャドウが範囲外になり車内や路面の陰影が失われるため。
    this.lastTargetCarPos.copy(carPos);
    this.dirLight.target.position.set(carPos.x, 0, carPos.z);
    this.dirLight.position.set(
      carPos.x + this.baseSunPosition.x,
      this.baseSunPosition.y,
      carPos.z + this.baseSunPosition.z,
    );
    this.dirLight.target.updateMatrixWorld();

    const isRainWeather = this.currentWeatherCondition === "rain";

    const targetRain = isRainWeather ? 1.0 : 0.0;
    this.rainIntensity = THREE.MathUtils.lerp(this.rainIntensity, targetRain, dt * 2.5);

    const targetWet = this.getRoadWetnessTarget();
    const wetLerpSpeed = isRainWeather ? 1.8 : 1.4;
    this.wetness = THREE.MathUtils.lerp(this.wetness, targetWet, dt * wetLerpSpeed);

    const isRaining = this.rainIntensity > 0.02;
    this.rainMesh.visible = isRaining && this.activeRainCount > 0;
    this.rainSplashMesh.visible = this.rainIntensity > 0.05 && this.activeSplashCount > 0;
    if (isRaining) {
      this.updateRainParticles(dt, carPos, carVelocity);
    }
  }

  /**
   * 空中雨ストリークおよび路面クラウンスプラッシュシェーダーへ現在の環境光カラーを同期する。
   */
  private syncRainShaderEnvironment(
    skyHex: number,
    sunHex: number,
    fogHex: number,
    nightFactor: number,
  ): void {
    const rainU = this.rainMaterial.uniforms;
    (rainU.uSkyColor.value as THREE.Color).setHex(skyHex);
    (rainU.uSunColor.value as THREE.Color).setHex(sunHex);
    (rainU.uFogColor.value as THREE.Color).setHex(fogHex);
    rainU.uNightFactor.value = nightFactor;
    rainU.uRainIntensity.value = this.rainIntensity;

    const splashU = this.rainSplashMaterial.uniforms;
    (splashU.uSkyColor.value as THREE.Color).setHex(skyHex);
    (splashU.uSunColor.value as THREE.Color).setHex(sunHex);
    splashU.uRainIntensity.value = this.rainIntensity;
  }

  private updateRainParticles(
    _dt: number,
    carPos: THREE.Vector3,
    carVelocity: THREE.Vector3,
  ): void {
    const rainU = this.rainMaterial.uniforms;
    rainU.uTime.value = this.elapsedSimSeconds;
    rainU.uRainIntensity.value = this.rainIntensity;
    (rainU.uCarPos.value as THREE.Vector3).copy(carPos);
    (rainU.uCarVel.value as THREE.Vector3).copy(carVelocity);

    const splashU = this.rainSplashMaterial.uniforms;
    splashU.uTime.value = this.elapsedSimSeconds;
    splashU.uRainIntensity.value = this.rainIntensity;
    (splashU.uCarPos.value as THREE.Vector3).copy(carPos);
  }
}

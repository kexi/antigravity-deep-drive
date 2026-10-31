import * as THREE from "three";
import { Lensflare, LensflareElement } from "three/examples/jsm/objects/Lensflare.js";
import { AtmosphericSky } from "../shaders/skyShader";
import type { WeatherType } from "../types";
import type { WeatherPreset } from "../assets/schema";

/**
 * 動的天候・大気ライティング・レンズフレアシステム
 * - 晴天 (Clear): 爽やかな青空、強烈な直射日光、ダイナミックレンズフレア
 * - 夕暮れ (Sunset): 黄金・茜色の夕景、長い影、温かなレンズフレア
 * - 雨天 (Rain): 暗い雨雲、雨滴パーティクル、濡れた路面
 * - 夜間 (Night): 月光、街灯、東京駅ライトアップ
 * - YAMLアセットマネージャー連携: 外部YAMLで定義されたパラメータによる完全制御
 */
export class WeatherSystem {
  public currentWeather: WeatherType = "clear";
  public rainIntensity = 0.0;
  public wetness = 0.0;
  public lensflareConfig = {
    enabled: true,
    intensity: 1.0,
    color: 0xfffaed,
  };
  public sky: AtmosphericSky;

  private scene: THREE.Scene;
  private dirLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private lensflare: Lensflare;
  private rainMesh: THREE.InstancedMesh;
  private rainCount = 4000;
  private rainVelocities: Float32Array;

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
    this.dirLight.shadow.camera.far = 400;
    this.dirLight.shadow.camera.left = -120;
    this.dirLight.shadow.camera.right = 120;
    this.dirLight.shadow.camera.top = 120;
    this.dirLight.shadow.camera.bottom = -120;
    this.scene.add(this.dirLight);

    // 3. レンズフレア
    this.lensflare = this.createLensFlare();
    this.dirLight.add(this.lensflare);

    // 4. 雨パーティクル
    const { mesh, velocities } = this.createRainSystem();
    this.rainMesh = mesh;
    this.rainVelocities = velocities;
    this.scene.add(this.rainMesh);

    // 5. 大気散乱・動的雲スカイドーム
    this.sky = new AtmosphericSky();
    this.scene.add(this.sky.mesh);

    // 初期天候の適用
    this.setWeather("clear");
  }

  private createLensFlare(): Lensflare {
    const lensflare = new Lensflare();

    // プロシージャルにフレアテクスチャを生成
    const mainFlareTex = this.generateFlareTexture(256, 1.0, 0.9, 0.7);
    const ringFlareTex = this.generateFlareTexture(128, 0.4, 0.7, 1.0);
    const ghostFlareTex = this.generateFlareTexture(64, 0.9, 0.5, 0.2);

    lensflare.addElement(new LensflareElement(mainFlareTex, 450, 0, new THREE.Color(0xfffaed)));
    lensflare.addElement(new LensflareElement(ringFlareTex, 70, 0.2, new THREE.Color(0x93c5fd)));
    lensflare.addElement(new LensflareElement(ghostFlareTex, 130, 0.5, new THREE.Color(0xfde047)));
    lensflare.addElement(new LensflareElement(ghostFlareTex, 90, 0.8, new THREE.Color(0xf43f5e)));

    return lensflare;
  }

  private generateFlareTexture(size: number, r: number, g: number, b: number): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const gradient = ctx.createRadialGradient(
        size / 2,
        size / 2,
        0,
        size / 2,
        size / 2,
        size / 2,
      );
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
    }
    const texture = new THREE.CanvasTexture(canvas);
    return texture;
  }

  private createRainSystem(): { mesh: THREE.InstancedMesh; velocities: Float32Array } {
    // 雨筋の細長い円柱
    const geo = new THREE.CylinderGeometry(0.015, 0.015, 1.2, 4);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x93c5fd,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    });

    const mesh = new THREE.InstancedMesh(geo, mat, this.rainCount);
    const dummy = new THREE.Object3D();
    const velocities = new Float32Array(this.rainCount);

    for (let i = 0; i < this.rainCount; i++) {
      dummy.position.set(
        (Math.random() - 0.5) * 120,
        Math.random() * 40,
        (Math.random() - 0.5) * 120,
      );
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      velocities[i] = 25.0 + Math.random() * 15.0; // 落下速度
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.visible = false;

    return { mesh, velocities };
  }

  public setWeather(type: WeatherType): void {
    this.currentWeather = type;

    if (type === "clear") {
      this.scene.background = new THREE.Color(0x38bdf8);
      this.scene.fog = new THREE.FogExp2(0xbae6fd, 0.003);
      this.dirLight.color.setHex(0xfffaed);
      this.dirLight.intensity = 2.8;
      this.dirLight.position.set(120, 160, 80);
      this.hemiLight.color.setHex(0x93c5fd);
      this.hemiLight.groundColor.setHex(0x1e293b);
      this.hemiLight.intensity = 1.0;
      this.lensflare.visible = true;
      this.lensflareConfig = { enabled: true, intensity: 0.9, color: 0xfffaed };
      this.rainMesh.visible = false;
      this.sky.setParams({
        zenithColor: 0x0284c7,
        horizonColor: 0xbae6fd,
        sunColor: 0xfffaed,
        cloudColor: 0xffffff,
        cloudDensity: 0.3,
        cloudSpeed: 0.02,
        starsIntensity: 0.0,
      });
      this.sky.setSunPosition(this.dirLight.position);
    } else if (type === "sunset") {
      this.scene.background = new THREE.Color(0xf97316);
      this.scene.fog = new THREE.FogExp2(0xfdba74, 0.004);
      this.dirLight.color.setHex(0xfb923c);
      this.dirLight.intensity = 3.2;
      this.dirLight.position.set(150, 40, 120);
      this.hemiLight.color.setHex(0xfdba74);
      this.hemiLight.groundColor.setHex(0x451a03);
      this.hemiLight.intensity = 0.9;
      this.lensflare.visible = true;
      this.lensflareConfig = { enabled: true, intensity: 1.4, color: 0xffbb66 };
      this.rainMesh.visible = false;
      this.sky.setParams({
        zenithColor: 0x4c1d95,
        horizonColor: 0xf97316,
        sunColor: 0xfb923c,
        cloudColor: 0xfdba74,
        cloudDensity: 0.45,
        cloudSpeed: 0.015,
        starsIntensity: 0.05,
      });
      this.sky.setSunPosition(this.dirLight.position);
    } else if (type === "rain") {
      this.scene.background = new THREE.Color(0x334155);
      this.scene.fog = new THREE.FogExp2(0x475569, 0.008);
      this.dirLight.color.setHex(0x94a3b8);
      this.dirLight.intensity = 0.8;
      this.dirLight.position.set(50, 120, 50);
      this.hemiLight.color.setHex(0x64748b);
      this.hemiLight.groundColor.setHex(0x0f172a);
      this.hemiLight.intensity = 0.6;
      this.lensflare.visible = false;
      this.lensflareConfig = { enabled: false, intensity: 0.0, color: 0x8899aa };
      this.rainMesh.visible = true;
      this.sky.setParams({
        zenithColor: 0x1e293b,
        horizonColor: 0x475569,
        sunColor: 0x94a3b8,
        cloudColor: 0x334155,
        cloudDensity: 0.85,
        cloudSpeed: 0.04,
        starsIntensity: 0.0,
      });
      this.sky.setSunPosition(this.dirLight.position);
    } else if (type === "night") {
      this.scene.background = new THREE.Color(0x050811);
      this.scene.fog = new THREE.FogExp2(0x0f172a, 0.005);
      this.dirLight.color.setHex(0x38bdf8);
      this.dirLight.intensity = 0.4;
      this.dirLight.position.set(60, 120, 60);
      this.hemiLight.color.setHex(0x1e293b);
      this.hemiLight.groundColor.setHex(0x020617);
      this.hemiLight.intensity = 0.35;
      this.lensflare.visible = false;
      this.lensflareConfig = { enabled: false, intensity: 0.0, color: 0x38bdf8 };
      this.rainMesh.visible = false;
      this.sky.setParams({
        zenithColor: 0x020617,
        horizonColor: 0x0f172a,
        sunColor: 0x38bdf8,
        cloudColor: 0x1e293b,
        cloudDensity: 0.25,
        cloudSpeed: 0.01,
        starsIntensity: 0.9,
      });
      this.sky.setSunPosition(this.dirLight.position);
    }
  }

  /**
   * YAMLアセットマニフェストで定義されたWeatherPresetを適用する。
   * How: 太陽光位置・色、環境光、フォグ密度、雨量、レンズフレアの表示状態をプリセット値で上書きする。
   */
  public applyPreset(preset: WeatherPreset): void {
    const isKnownWeather =
      preset.id === "clear" ||
      preset.id === "sunset" ||
      preset.id === "rain" ||
      preset.id === "night";
    if (isKnownWeather) {
      this.currentWeather = preset.id as WeatherType;
    }

    this.scene.background = new THREE.Color(preset.skyColor);
    this.scene.fog = new THREE.FogExp2(preset.fogColor, preset.fogDensity);

    this.dirLight.color.setHex(preset.sunColor);
    this.dirLight.position.set(preset.sunPosition[0], preset.sunPosition[1], preset.sunPosition[2]);

    this.hemiLight.color.setHex(preset.ambientColor);
    this.lensflare.visible = preset.lensflare.enabled;
    this.lensflareConfig = {
      enabled: preset.lensflare.enabled,
      intensity: preset.lensflare.intensity,
      color: preset.lensflare.color,
    };
    this.rainMesh.visible = preset.rain.enabled;

    if (preset.rain.enabled) {
      this.rainIntensity = preset.rain.intensity;
      this.wetness = preset.rain.windshieldWetness;
    }

    // スカイドームのプリセット連動
    const isNight = preset.id === "night";
    this.sky.setSunPosition(this.dirLight.position);
    this.sky.setParams({
      zenithColor: preset.skyColor,
      horizonColor: preset.fogColor,
      sunColor: preset.sunColor,
      cloudDensity: preset.rain.enabled ? 0.85 : (isNight ? 0.25 : 0.35),
      starsIntensity: isNight ? 0.9 : 0.0,
    });
  }

  public updateSky(time: number, cameraPos: THREE.Vector3): void {
    this.sky.update(time, cameraPos);
  }

  public getSunDirection(): THREE.Vector3 {
    return this.dirLight.position.clone().normalize();
  }

  public getSunWorldPosition(): THREE.Vector3 {
    return this.dirLight.position.clone();
  }

  public getSunColor(): THREE.Color {
    return this.dirLight.color;
  }

  public getLensFlareConfig() {
    return this.lensflareConfig;
  }

  public update(dt: number, carPos: THREE.Vector3, carVelocity: THREE.Vector3): void {
    // 雨天ターゲット値
    const targetRain = this.currentWeather === "rain" ? 1.0 : 0.0;
    this.rainIntensity = THREE.MathUtils.lerp(this.rainIntensity, targetRain, dt * 2.5);

    // 路面濡れ度（雨が止んでもゆっくり乾く）
    const targetWet = this.currentWeather === "rain" ? 1.0 : 0.0;
    const wetLerpSpeed = this.currentWeather === "rain" ? 1.5 : 0.2;
    this.wetness = THREE.MathUtils.lerp(this.wetness, targetWet, dt * wetLerpSpeed);

    // 雨パーティクルの更新（プレイヤー車両の周囲に追従）
    const isRaining = this.rainIntensity > 0.05;
    if (isRaining) {
      this.updateRainParticles(dt, carPos, carVelocity);
    }
  }

  private updateRainParticles(dt: number, carPos: THREE.Vector3, carVelocity: THREE.Vector3): void {
    const dummy = new THREE.Object3D();
    const matrix = new THREE.Matrix4();
    const boxSize = 80;

    // 車速による雨筋の傾き
    const carSpeedZ = carVelocity.z;
    const tiltAngle = (carSpeedZ / 30.0) * 0.3;

    for (let i = 0; i < this.rainCount; i++) {
      this.rainMesh.getMatrixAt(i, matrix);
      dummy.matrix.copy(matrix);
      dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);

      // 落下
      dummy.position.y -= this.rainVelocities[i] * dt;

      // 車両を中心としたバウンディングエリア内にリサイクル
      const dx = dummy.position.x - carPos.x;
      const dz = dummy.position.z - carPos.z;

      const isBelowGround = dummy.position.y < 0;
      const isFarAway = Math.abs(dx) > boxSize / 2 || Math.abs(dz) > boxSize / 2;

      if (isBelowGround || isFarAway) {
        dummy.position.y = 35 + Math.random() * 10;
        dummy.position.x = carPos.x + (Math.random() - 0.5) * boxSize;
        dummy.position.z = carPos.z + (Math.random() - 0.5) * boxSize;
      }

      // 車速に応じた風の傾き
      dummy.rotation.x = tiltAngle;

      dummy.updateMatrix();
      this.rainMesh.setMatrixAt(i, dummy.matrix);
    }

    this.rainMesh.instanceMatrix.needsUpdate = true;
  }
}

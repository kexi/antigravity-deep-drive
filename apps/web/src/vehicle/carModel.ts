import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createWindshieldMaterial, type WindshieldUniforms } from "../shaders/windshield";
import type { VehicleState, WiperMode } from "../types";
import { assetManager } from "../assets/assetManager";

/**
 * 車両3Dモデルクラス
 * - 外装・内装（ダッシュボード、ステアリングホイール）
 * - フロントガラス（専用雨滴＆ワイパーシェーダー）
 * - ワイパー機構（ピボット回転アニメーション）
 * - ヘッドライト（夜間・雨天時のプロジェクション）
 * - Blender CLI 生成 GLB モデル対応（GLB非同期ロード & プロシージャルフォールバック）
 */
export class CarModel {
  public group: THREE.Group;
  public windshieldMesh: THREE.Mesh;
  public windshieldMaterial: THREE.ShaderMaterial;
  public steeringWheel: THREE.Group;
  public wiperArmDriver: THREE.Group;
  public wiperArmPassenger: THREE.Group;
  public wheels: THREE.Mesh[] = [];
  public headLights: THREE.SpotLight[] = [];
  public glbModelGroup: THREE.Group | null = null;

  private proceduralBodyGroup: THREE.Group;
  private wiperAngleDriver = 0;
  private wiperAnglePassenger = 0;
  private wiperTime = 0;
  private wiperMode: WiperMode = "slow";

  constructor() {
    this.group = new THREE.Group();

    // 1. 車体外装（シャシー）
    const bodyGroup = this.createCarBody();
    this.proceduralBodyGroup = bodyGroup;
    this.group.add(bodyGroup);

    // 2. コックピット内装
    const interiorGroup = this.createInterior();
    this.proceduralBodyGroup.add(interiorGroup);

    // 3. フロントガラス
    const { mesh, material } = this.createWindshield();
    this.windshieldMesh = mesh;
    this.windshieldMaterial = material;
    this.group.add(mesh);

    // 4. ワイパー機構
    const { driverWiper, passengerWiper } = this.createWipers();
    this.wiperArmDriver = driverWiper;
    this.wiperArmPassenger = passengerWiper;
    this.group.add(driverWiper);
    this.group.add(passengerWiper);

    // 5. ステアリングホイール（内装内から参照）
    this.steeringWheel = this.createSteeringWheel();
    this.group.add(this.steeringWheel);

    // 6. ヘッドライト
    this.setupHeadlights();

    // 7. Blender CLI で生成した car.glb の非同期ロード
    this.loadGlbModel();
  }

  private loadGlbModel(): void {
    const config = assetManager.getModelConfig("car");
    const modelPath = config?.path ?? "/models/car.glb";
    const loader = new GLTFLoader();
    loader.load(
      modelPath,
      (gltf) => {
        const glbScene = gltf.scene;
        const hasLoadedScene = Boolean(glbScene);
        if (!hasLoadedScene) {
          return;
        }

        const scale = config?.scale ?? [1, 1, 1];
        glbScene.scale.set(scale[0], scale[1], scale[2]);
        const offset = config?.offset ?? [0, 0, 0];
        glbScene.position.set(offset[0], offset[1], offset[2]);

        const glbWheels: THREE.Mesh[] = [];
        let glbSteering: THREE.Group | null = null;
        let glbWiperD: THREE.Group | null = null;
        let glbWiperP: THREE.Group | null = null;

        glbScene.traverse((child) => {
          const isMesh = (child as THREE.Mesh).isMesh;
          if (isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }

          // 各パーツの自動検出
          const nodeName = child.name;
          if (nodeName === "Windshield") {
            // フロントガラスに雨滴・ワイパーシェーダーを適用
            (child as THREE.Mesh).material = this.windshieldMaterial;
          } else if (nodeName === "SteeringWheel") {
            glbSteering = child as THREE.Group;
          } else if (nodeName === "WiperDriver") {
            glbWiperD = child as THREE.Group;
          } else if (nodeName === "WiperPassenger") {
            glbWiperP = child as THREE.Group;
          } else if (nodeName.startsWith("Wheel_") || nodeName.startsWith("Wheel")) {
            glbWheels.push(child as THREE.Mesh);
          }
        });

        // 検出できたパーツをバインド
        const hasSteering = Boolean(glbSteering);
        if (hasSteering) {
          this.steeringWheel = glbSteering!;
        }

        const hasWiperD = Boolean(glbWiperD);
        if (hasWiperD) {
          this.wiperArmDriver = glbWiperD!;
        }

        const hasWiperP = Boolean(glbWiperP);
        if (hasWiperP) {
          this.wiperArmPassenger = glbWiperP!;
        }

        const hasWheels = glbWheels.length >= 4;
        if (hasWheels) {
          this.wheels = glbWheels;
        }

        this.glbModelGroup = glbScene;
        this.group.add(glbScene);

        // GLBの配置に伴いプロシージャルメッシュを非表示化
        this.proceduralBodyGroup.visible = false;
      },
      undefined,
      (error) => {
        console.warn("Notice: Using procedural Car model (GLB load skipped):", error);
      },
    );
  }

  private createCarBody(): THREE.Group {
    const group = new THREE.Group();

    // メタリックボディペイント
    const bodyMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x1d4ed8, // ディープブルー
      metalness: 0.85,
      roughness: 0.2,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1,
    });

    const blackTrimMaterial = new THREE.MeshStandardMaterial({
      color: 0x111827,
      roughness: 0.8,
    });

    // メインロアボディ
    const lowerBodyGeo = new THREE.BoxGeometry(1.9, 0.65, 4.3);
    const lowerBody = new THREE.Mesh(lowerBodyGeo, bodyMaterial);
    lowerBody.position.y = 0.55;
    lowerBody.castShadow = true;
    lowerBody.receiveShadow = true;
    group.add(lowerBody);

    // キャビン（ルーフ）
    const cabinGeo = new THREE.BoxGeometry(1.55, 0.55, 2.2);
    const cabin = new THREE.Mesh(cabinGeo, bodyMaterial);
    cabin.position.set(0, 1.1, -0.2);
    cabin.castShadow = true;
    group.add(cabin);

    // グリル
    const grillGeo = new THREE.BoxGeometry(1.3, 0.3, 0.1);
    const grill = new THREE.Mesh(grillGeo, blackTrimMaterial);
    grill.position.set(0, 0.45, 2.16);
    group.add(grill);

    // ホイール4輪
    const wheelRadius = 0.38;
    const wheelWidth = 0.28;
    const wheelGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, 24);
    wheelGeo.rotateZ(Math.PI / 2);

    const tireMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      roughness: 0.9,
    });
    const rimMaterial = new THREE.MeshStandardMaterial({
      color: 0xd1d5db,
      metalness: 0.9,
      roughness: 0.25,
    });

    const wheelPositions = [
      new THREE.Vector3(-0.95, 0.38, 1.35), // 前左
      new THREE.Vector3(0.95, 0.38, 1.35), // 前右
      new THREE.Vector3(-0.95, 0.38, -1.35), // 後左
      new THREE.Vector3(0.95, 0.38, -1.35), // 後右
    ];

    for (let i = 0; i < wheelPositions.length; i++) {
      const pos = wheelPositions[i];
      const wheelMesh = new THREE.Mesh(wheelGeo, tireMaterial);
      wheelMesh.position.copy(pos);
      wheelMesh.castShadow = true;

      // ホイールキャップ
      const rimGeo = new THREE.CylinderGeometry(0.25, 0.25, wheelWidth + 0.02, 16);
      rimGeo.rotateZ(Math.PI / 2);
      const rimMesh = new THREE.Mesh(rimGeo, rimMaterial);
      wheelMesh.add(rimMesh);

      group.add(wheelMesh);
      this.wheels.push(wheelMesh);
    }

    return group;
  }

  private createInterior(): THREE.Group {
    const group = new THREE.Group();

    const dashMaterial = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.85,
    });

    // ダッシュボード
    const dashGeo = new THREE.BoxGeometry(1.48, 0.4, 0.75);
    const dash = new THREE.Mesh(dashGeo, dashMaterial);
    dash.position.set(0, 0.95, 0.65);
    group.add(dash);

    // センターコンソール
    const consoleGeo = new THREE.BoxGeometry(0.35, 0.35, 1.2);
    const console = new THREE.Mesh(consoleGeo, dashMaterial);
    console.position.set(0, 0.65, 0.0);
    group.add(console);

    // メーターパネル（スピードメーター等の発光スクリーン）
    const screenGeo = new THREE.PlaneGeometry(0.5, 0.18);
    const screenMat = new THREE.MeshBasicMaterial({
      color: 0x0284c7,
    });
    const screen = new THREE.Mesh(screenGeo, screenMat);
    // 右ハンドル仕様（運転席: x = 0.4）
    screen.position.set(0.38, 1.05, 0.7);
    screen.rotation.x = -0.3;
    screen.rotation.y = Math.PI;
    group.add(screen);

    // 運転席・助手席シート
    const seatMaterial = new THREE.MeshStandardMaterial({
      color: 0x27272a,
      roughness: 0.7,
    });
    const seatGeo = new THREE.BoxGeometry(0.5, 0.7, 0.55);

    const driverSeat = new THREE.Mesh(seatGeo, seatMaterial);
    driverSeat.position.set(0.38, 0.7, -0.2);
    group.add(driverSeat);

    const passSeat = new THREE.Mesh(seatGeo, seatMaterial);
    passSeat.position.set(-0.38, 0.7, -0.2);
    group.add(passSeat);

    return group;
  }

  private createSteeringWheel(): THREE.Group {
    const group = new THREE.Group();
    // 運転席の前方（右ハンドル位置: x = 0.38, y = 1.05, z = 0.48）
    group.position.set(0.38, 1.05, 0.48);

    const rimGeo = new THREE.TorusGeometry(0.18, 0.025, 12, 32);
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x09090b,
      roughness: 0.6,
    });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = 0.35;
    group.add(rim);

    // ホーンパッド
    const centerGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.04, 16);
    centerGeo.rotateX(Math.PI / 2);
    const center = new THREE.Mesh(centerGeo, rimMat);
    center.position.set(0, 0, 0.02);
    rim.add(center);

    return group;
  }

  private createWindshield(): { mesh: THREE.Mesh; material: THREE.ShaderMaterial } {
    // フロントガラスの傾斜平面ジオメトリ (幅1.48m, 高さ0.72m)
    const geo = new THREE.PlaneGeometry(1.48, 0.78, 16, 16);

    // カーブを少しつける
    const posAttr = geo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const zOffset = -Math.pow(x / 1.48, 2) * 0.12;
      posAttr.setZ(i, zOffset);
    }
    geo.computeVertexNormals();

    const mat = createWindshieldMaterial();
    const mesh = new THREE.Mesh(geo, mat);

    // フロントガラスの配置（キャビン前方の傾斜面）
    mesh.position.set(0, 1.15, 0.95);
    mesh.rotation.x = -0.68; // 約39度傾斜

    return { mesh, material: mat };
  }

  private createWipers(): { driverWiper: THREE.Group; passengerWiper: THREE.Group } {
    const bladeMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.9,
    });

    const createArm = () => {
      const armGroup = new THREE.Group();
      // アーム部分
      const armGeo = new THREE.BoxGeometry(0.02, 0.45, 0.015);
      armGeo.translate(0, 0.22, 0);
      const arm = new THREE.Mesh(armGeo, bladeMat);
      armGroup.add(arm);

      // ワイパーブレード
      const bladeGeo = new THREE.BoxGeometry(0.012, 0.52, 0.01);
      bladeGeo.translate(0, 0.26, 0.01);
      const blade = new THREE.Mesh(bladeGeo, bladeMat);
      armGroup.add(blade);

      return armGroup;
    };

    // 運転席側ワイパー
    const driverWiper = createArm();
    driverWiper.position.set(0.28, 0.92, 1.25);
    driverWiper.rotation.x = -0.68;
    driverWiper.rotation.z = 0.2;

    // 助手席側ワイパー
    const passengerWiper = createArm();
    passengerWiper.position.set(-0.32, 0.92, 1.25);
    passengerWiper.rotation.x = -0.68;
    passengerWiper.rotation.z = 0.2;

    return { driverWiper, passengerWiper };
  }

  private setupHeadlights(): void {
    const lightPositions = [
      new THREE.Vector3(-0.65, 0.55, 2.15),
      new THREE.Vector3(0.65, 0.55, 2.15),
    ];

    for (let i = 0; i < lightPositions.length; i++) {
      const pos = lightPositions[i];
      const spot = new THREE.SpotLight(0xfff5e6, 30.0, 60, Math.PI / 6, 0.4, 1.5);
      spot.position.copy(pos);

      const target = new THREE.Object3D();
      target.position.set(pos.x * 0.5, 0.2, pos.z + 25);
      this.group.add(target);
      spot.target = target;

      spot.castShadow = true;
      spot.shadow.mapSize.width = 1024;
      spot.shadow.mapSize.height = 1024;

      this.group.add(spot);
      this.headLights.push(spot);
    }
  }

  public setWiperMode(mode: WiperMode): void {
    this.wiperMode = mode;
  }

  public update(dt: number, state: VehicleState, rainIntensity: number): void {
    // 1. 車両位置・回転の同期
    this.group.position.set(state.position.x, state.position.y, state.position.z);
    this.group.rotation.y = state.headingAngle;

    // 2. ステアリングホイールの回転連動
    this.steeringWheel.rotation.z = -state.steeringAngle * 2.8;

    // 3. 前輪の操舵角とホイール回転
    const wheelRotSpeed = (state.speedKmh / 3.6 / 0.38) * dt;
    for (let i = 0; i < this.wheels.length; i++) {
      this.wheels[i].rotation.x += wheelRotSpeed;
      const isFrontWheel = i < 2;
      if (isFrontWheel) {
        this.wheels[i].rotation.y = -state.steeringAngle;
      }
    }

    // 4. ワイパーアニメーション
    this.updateWipers(dt, rainIntensity);

    // 5. フロントガラスシェーダーユニフォーム更新
    const u = this.windshieldMaterial.uniforms as WindshieldUniforms;
    u.uTime.value += dt;
    u.uSpeed.value = state.speedKmh;
    u.uRainIntensity.value = rainIntensity;
    u.uWiperAngle1.value = this.wiperAngleDriver;
    u.uWiperAngle2.value = this.wiperAnglePassenger;
    const isWiping = this.wiperMode !== "off";
    u.uWiperClearing.value = isWiping ? 0.95 : 0.0;
  }

  private updateWipers(dt: number, rainIntensity: number): void {
    let speedMult = 0;
    if (this.wiperMode === "slow") {
      speedMult = 3.5;
    } else if (this.wiperMode === "fast") {
      speedMult = 6.5;
    } else if (this.wiperMode === "off" && rainIntensity > 0.3) {
      // 自動ワイパー（豪雨時の微動）
      speedMult = 0.0;
    }

    const isWiperMoving = speedMult > 0;
    if (isWiperMoving) {
      this.wiperTime += dt * speedMult;
      // サイン波でスムーズな往復運動（0 〜 約75度）
      const sweep = (Math.sin(this.wiperTime) + 1.0) * 0.5;
      const maxAngle = 1.35; // ラジアン

      this.wiperAngleDriver = sweep * maxAngle;
      this.wiperAnglePassenger = sweep * maxAngle;

      this.wiperArmDriver.rotation.z = 0.2 - this.wiperAngleDriver;
      this.wiperArmPassenger.rotation.z = 0.2 - this.wiperAnglePassenger;
    } else {
      // 収納位置に戻る
      this.wiperAngleDriver = THREE.MathUtils.lerp(this.wiperAngleDriver, 0, dt * 5.0);
      this.wiperAnglePassenger = THREE.MathUtils.lerp(this.wiperAnglePassenger, 0, dt * 5.0);
      this.wiperArmDriver.rotation.z = 0.2 - this.wiperAngleDriver;
      this.wiperArmPassenger.rotation.z = 0.2 - this.wiperAnglePassenger;
    }
  }

  public setHeadlights(enabled: boolean): void {
    for (let i = 0; i < this.headLights.length; i++) {
      this.headLights[i].intensity = enabled ? 35.0 : 0.0;
    }
  }
}

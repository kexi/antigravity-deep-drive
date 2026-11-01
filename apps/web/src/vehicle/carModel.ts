import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createWindshieldMaterial, type WindshieldUniforms } from "../shaders/windshield";
import type { VehicleState, WiperMode } from "../types";
import { assetManager } from "../assets/assetManager";
import {
  findNearestGsiRoad,
  findNearestPlateauBuilding,
  getTokyoOpenData,
  localToWgs84,
} from "../openData/gsiPlateauLoader";

/**
 * 車両3Dモデルクラス
 * - 外装・内装（ダッシュボード、ステアリングホイール、リアLEDテールバー、クアッドマフラー）
 * - フロントガラス（専用雨滴＆ワイパーシェーダー）
 * - ワイパー機構（ピボット回転アニメーション）
 * - ヘッドライト（夜間・雨天時のプロジェクション）
 * - Rapier DynamicRayCastVehicleController の4輪サスペンション長・ピッチ・ロール同期
 * - Blender CLI 生成 GLB モデル対応（GLB非同期ロード & プロシージャルフォールバック）
 */
export class CarModel {
  public group: THREE.Group;
  public windshieldMesh: THREE.Mesh;
  public windshieldMaterial: THREE.ShaderMaterial;
  public steeringWheel: THREE.Group;
  public wiperArmDriver: THREE.Group;
  public wiperArmPassenger: THREE.Group;
  public wheels: THREE.Object3D[] = [];
  public headLights: THREE.SpotLight[] = [];
  public glbModelGroup: THREE.Group | null = null;
  public centerNavGroup: THREE.Group;

  private proceduralBodyGroup: THREE.Group;
  private wheelBasePositions: THREE.Vector3[] = [];
  private navCanvas: HTMLCanvasElement | null = null;
  private navContext: CanvasRenderingContext2D | null = null;
  private navTexture: THREE.CanvasTexture | null = null;
  private navUpdateElapsed = 1.0;
  private wiperAngleDriver = 0.08;
  private wiperAnglePassenger = 0.08;
  private wiperDirection = 1.0;
  private wiperSpeedVal = 3.5;
  private wiperTime = 0;
  private wiperMode: WiperMode = "slow";

  private static readonly WIPER_PARK_ANGLE = 0.08;
  private static readonly WIPER_MAX_ANGLE_DRIVER = 1.62;
  private static readonly WIPER_MAX_ANGLE_PASSENGER = 1.56;
  private static readonly WINDSHIELD_TILT_X = -0.977;

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

    // 5. ステアリングホイール＆JIS規格固定ステアリングコラム（右ウインカー／左ワイパーレバー）
    const steeringColumn = this.createSteeringColumnAssembly();
    this.group.add(steeringColumn);
    this.steeringWheel = this.createSteeringWheel();
    this.group.add(this.steeringWheel);

    // 5.5 車内11インチJDMフローティングカーナビユニット（リアルタイムPLATEAU建物＆国土地理院道路3Dマップ表示）
    this.centerNavGroup = this.createCenterNavAssembly();
    this.group.add(this.centerNavGroup);

    // 6. ヘッドライト
    this.setupHeadlights();

    // 7. Blender CLI で生成した car.glb の非同期ロード
    this.loadGlbModel();
  }

  private loadGlbModel(): void {
    const isBrowserEnvironment = typeof window !== "undefined" && typeof document !== "undefined";
    if (!isBrowserEnvironment) {
      return;
    }

    const config = assetManager.getModelConfig("car");
    const rawPath = config?.path ?? "/models/car.glb";
    const modelPath = assetManager.resolveAssetUrl(rawPath);
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

        const wheelMap = new Map<string, THREE.Object3D>();

        glbScene.traverse((child) => {
          const isMesh = (child as THREE.Mesh).isMesh;
          if (isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }

          const nodeName = child.name;
          const isGlbWindshield =
            nodeName === "Windshield" || nodeName === config?.subparts?.windshield;
          if (isGlbWindshield) {
            const glbWindshieldMesh = child as THREE.Mesh;
            // Why glTF の Windshield メッシュに対して頂点座標から UV を正規化し直すか:
            // glTF 2.0 仕様のテクスチャ V 座標反転 (1.0 - v) により、Blender 側と Three.js 側で
            // V 軸の上下（カウル側 v=0.0 / ルーフ側 v=1.0）が逆転し、ワイパー支点と雨粒落下が逆向きになるのを防ぐため。
            this.normalizeWindshieldGeometryUVs(glbWindshieldMesh.geometry);
            glbWindshieldMesh.material = this.windshieldMaterial;
            child.castShadow = false;
            child.receiveShadow = false;
            this.windshieldMesh.visible = false;
            return;
          }

          // Why Three.js 側のステアリング・ワイパー階層を優先するか:
          // glTF エクスポート時の Y-up 軸変換でローカル回転軸(Z軸)が変化するため、
          // 回転アニメーションを持つステアリングとワイパーは Three.js ネイティブ軸のメッシュを使用する。
          const isAnimatedSubpartInGlb =
            nodeName === "SteeringWheel" ||
            nodeName === "WiperDriver" ||
            nodeName === "WiperPassenger" ||
            nodeName === "WiperBladeDriver" ||
            nodeName === "WiperBladePassenger";
          if (isAnimatedSubpartInGlb) {
            child.visible = false;
            return;
          }

          const isWheelNode =
            nodeName === "Wheel_FL" ||
            nodeName === "Wheel_FR" ||
            nodeName === "Wheel_RL" ||
            nodeName === "Wheel_RR";
          if (isWheelNode) {
            wheelMap.set(nodeName, child);
          }
        });

        const orderedNames = ["Wheel_FL", "Wheel_FR", "Wheel_RL", "Wheel_RR"];
        const orderedWheels = orderedNames
          .map((name) => wheelMap.get(name))
          .filter((w): w is THREE.Object3D => Boolean(w));

        const hasAllFourWheels = orderedWheels.length === 4;
        if (hasAllFourWheels) {
          this.wheels = orderedWheels;
          this.wheelBasePositions = orderedWheels.map((w) => w.position.clone());
        }

        this.glbModelGroup = glbScene;
        this.group.add(glbScene);

        // GLBの配置に伴いプロシージャルボディ＆内装メッシュを非表示化
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

    const bodyMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x0b35a8,
      metalness: 0.9,
      roughness: 0.16,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
    });

    const blackTrimMaterial = new THREE.MeshStandardMaterial({
      color: 0x111827,
      roughness: 0.5,
      metalness: 0.25,
    });

    const chromeMaterial = new THREE.MeshStandardMaterial({
      color: 0xf3f4f6,
      metalness: 0.96,
      roughness: 0.08,
    });

    const tailLightMaterial = new THREE.MeshStandardMaterial({
      color: 0xdc2626,
      emissive: 0xff1122,
      emissiveIntensity: 3.2,
      roughness: 0.15,
    });

    // メインロアボディ
    const lowerBodyGeo = new THREE.BoxGeometry(1.9, 0.5, 4.35);
    const lowerBody = new THREE.Mesh(lowerBodyGeo, bodyMaterial);
    lowerBody.position.y = 0.5;
    lowerBody.castShadow = true;
    lowerBody.receiveShadow = true;
    group.add(lowerBody);

    // ルーフ天板（中空キャビン：コックピット視界を塞がないよう天板と細ピラーで構成）
    // Why not: キャビン全体をソリッドな BoxGeometry にすると、車内カメラ (y=1.18, z=-0.05) が直方体内部に埋まり視界が遮られるため
    const roofGeo = new THREE.BoxGeometry(1.42, 0.04, 1.75);
    const roof = new THREE.Mesh(roofGeo, bodyMaterial);
    roof.position.set(0, 1.44, -0.25);
    roof.castShadow = true;
    group.add(roof);

    // 左右Aピラー・Cピラー
    const aPillarGeo = new THREE.BoxGeometry(0.05, 0.58, 0.06);
    for (const side of [-1, 1]) {
      const aPillar = new THREE.Mesh(aPillarGeo, bodyMaterial);
      aPillar.position.set(side * 0.71, 1.12, 0.74);
      aPillar.rotation.x = 0.52;
      group.add(aPillar);

      const cPillar = new THREE.Mesh(aPillarGeo, bodyMaterial);
      cPillar.position.set(side * 0.7, 1.12, -1.12);
      cPillar.rotation.x = -0.48;
      group.add(cPillar);
    }

    // フロントグリル & スプリッター
    const grillGeo = new THREE.BoxGeometry(1.25, 0.26, 0.08);
    const grill = new THREE.Mesh(grillGeo, blackTrimMaterial);
    grill.position.set(0, 0.42, 2.18);
    group.add(grill);

    // 日本規格ナンバープレート（実寸 330mm × 165mm: 白地に緑文字帯アクセント）
    const plateWhiteMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.35,
      metalness: 0.05,
    });
    const plateGreenMat = new THREE.MeshStandardMaterial({
      color: 0x14532d,
      roughness: 0.4,
      metalness: 0.05,
    });
    const plateFrameGeo = new THREE.BoxGeometry(0.34, 0.175, 0.012);
    const plateBaseGeo = new THREE.BoxGeometry(0.33, 0.165, 0.014);
    const plateCharStripeGeo = new THREE.BoxGeometry(0.24, 0.055, 0.016);

    for (const plateZ of [2.21, -2.19]) {
      const plateGroup = new THREE.Group();
      plateGroup.position.set(0, 0.36, plateZ);
      plateGroup.add(new THREE.Mesh(plateFrameGeo, blackTrimMaterial));
      plateGroup.add(new THREE.Mesh(plateBaseGeo, plateWhiteMat));
      const stripeMesh = new THREE.Mesh(plateCharStripeGeo, plateGreenMat);
      stripeMesh.position.set(0, -0.02, 0);
      plateGroup.add(stripeMesh);
      group.add(plateGroup);
    }

    // JDM 丸型4灯テールランプ + リア貫通LEDテールバー & ディフューザー & 4本出しマフラー
    const tailBarGeo = new THREE.BoxGeometry(1.58, 0.045, 0.05);
    const tailBar = new THREE.Mesh(tailBarGeo, tailLightMaterial);
    tailBar.position.set(0, 0.74, -2.18);
    group.add(tailBar);

    const outerTailRingGeo = new THREE.TorusGeometry(0.068, 0.016, 12, 24);
    const innerTailRingGeo = new THREE.TorusGeometry(0.052, 0.014, 12, 24);
    for (const side of [-1, 1]) {
      const outerLamp = new THREE.Mesh(outerTailRingGeo, tailLightMaterial);
      outerLamp.position.set(side * 0.64, 0.74, -2.185);
      group.add(outerLamp);

      const innerLamp = new THREE.Mesh(innerTailRingGeo, tailLightMaterial);
      innerLamp.position.set(side * 0.46, 0.73, -2.185);
      group.add(innerLamp);
    }

    const diffuserGeo = new THREE.BoxGeometry(1.68, 0.14, 0.12);
    const diffuser = new THREE.Mesh(diffuserGeo, blackTrimMaterial);
    diffuser.position.set(0, 0.28, -2.16);
    group.add(diffuser);

    const exhaustGeo = new THREE.CylinderGeometry(0.042, 0.042, 0.12, 16);
    exhaustGeo.rotateX(Math.PI / 2);
    for (const exX of [-0.62, -0.49, 0.49, 0.62]) {
      const exhaust = new THREE.Mesh(exhaustGeo, chromeMaterial);
      exhaust.position.set(exX, 0.27, -2.21);
      group.add(exhaust);
    }

    // ホイール4輪（実寸 245/40R19: 外径 680mm = 半径 0.34m、タイヤ幅 0.245m、19インチリム半径 0.24m）
    const wheelRadius = 0.34;
    const wheelWidth = 0.245;
    const wheelGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, 32);
    wheelGeo.rotateZ(Math.PI / 2);

    const tireMaterial = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.88,
    });
    const rimMaterial = new THREE.MeshStandardMaterial({
      color: 0xe5e7eb,
      metalness: 0.94,
      roughness: 0.18,
    });

    const wheelPositions = [
      new THREE.Vector3(-0.84, 0.34, 1.39), // 前右 (右ハンドル運転席側)
      new THREE.Vector3(0.84, 0.34, 1.39), // 前左 (助手席側)
      new THREE.Vector3(-0.84, 0.34, -1.39), // 後右
      new THREE.Vector3(0.84, 0.34, -1.39), // 後左
    ];

    for (let i = 0; i < wheelPositions.length; i++) {
      const pos = wheelPositions[i];
      const wheelMesh = new THREE.Mesh(wheelGeo, tireMaterial);
      wheelMesh.position.copy(pos);
      wheelMesh.castShadow = true;

      const rimGeo = new THREE.CylinderGeometry(0.24, 0.24, wheelWidth + 0.015, 24);
      rimGeo.rotateZ(Math.PI / 2);
      const rimMesh = new THREE.Mesh(rimGeo, rimMaterial);
      wheelMesh.add(rimMesh);

      group.add(wheelMesh);
      this.wheels.push(wheelMesh);
      this.wheelBasePositions.push(pos.clone());
    }

    return group;
  }

  private createInterior(): THREE.Group {
    const group = new THREE.Group();

    const dashMaterial = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.85,
    });
    const chromeBezelMat = new THREE.MeshStandardMaterial({
      color: 0xd4d4d8,
      metalness: 0.85,
      roughness: 0.25,
    });

    // ダッシュボード（上端 y=0.86 に抑え、y=1.13 のドライバー視点カメラからメーターとフロントガラス下部が広く見える配置）
    const dashGeo = new THREE.BoxGeometry(1.48, 0.24, 0.48);
    const dash = new THREE.Mesh(dashGeo, dashMaterial);
    dash.position.set(0, 0.74, 0.68);
    group.add(dash);

    // 運転席メーターフード（右ハンドル x = -0.38m）
    const hoodGeo = new THREE.BoxGeometry(0.36, 0.095, 0.24);
    const hood = new THREE.Mesh(hoodGeo, dashMaterial);
    hood.position.set(-0.38, 0.91, 0.66);
    group.add(hood);

    // センターコンソール
    const consoleGeo = new THREE.BoxGeometry(0.3, 0.28, 1.0);
    const consoleMesh = new THREE.Mesh(consoleGeo, dashMaterial);
    consoleMesh.position.set(0, 0.56, 0.0);
    group.add(consoleMesh);

    // センターナビディスプレイ（右ハンドル運転席から見やすいよう少し右側へ角度を向けたJDMコックピット配置）
    const navHousingGeo = new THREE.BoxGeometry(0.28, 0.14, 0.04);
    const navHousing = new THREE.Mesh(navHousingGeo, dashMaterial);
    navHousing.position.set(0.0, 0.89, 0.61);
    navHousing.rotation.y = 0.12;
    group.add(navHousing);

    const navScreenGeo = new THREE.PlaneGeometry(0.25, 0.115);
    const navScreenMat = new THREE.MeshBasicMaterial({ color: 0x0284c7 });
    const navScreen = new THREE.Mesh(navScreenGeo, navScreenMat);
    navScreen.position.set(0.0, 0.89, 0.588);
    navScreen.rotation.y = Math.PI + 0.12;
    group.add(navScreen);

    // 運転席デジタルメータークラスター（右ハンドル仕様: x = -0.38m、ステアリング上部開口から見える2連リング＋液晶）
    const screenGeo = new THREE.PlaneGeometry(0.3, 0.1);
    const screenMat = new THREE.MeshBasicMaterial({
      color: 0x0ea5e9,
    });
    const screen = new THREE.Mesh(screenGeo, screenMat);
    screen.position.set(-0.38, 0.92, 0.62);
    screen.rotation.x = -0.22;
    screen.rotation.y = Math.PI;
    group.add(screen);

    const gaugeRingGeo = new THREE.TorusGeometry(0.042, 0.004, 12, 28);
    for (const offsetX of [-0.068, 0.068]) {
      const ring = new THREE.Mesh(gaugeRingGeo, chromeBezelMat);
      ring.position.set(-0.38 + offsetX, 0.92, 0.615);
      ring.rotation.x = 0.22;
      group.add(ring);
    }

    // 運転席・助手席シート（カメラ z=0.06 より後方 z=-0.42 に配置し、前方視界の遮蔽を防止）
    const seatMaterial = new THREE.MeshStandardMaterial({
      color: 0x27272a,
      roughness: 0.7,
    });
    const seatGeo = new THREE.BoxGeometry(0.48, 0.48, 0.16);

    const driverSeat = new THREE.Mesh(seatGeo, seatMaterial);
    driverSeat.position.set(-0.38, 0.7, -0.42);
    group.add(driverSeat);

    const passSeat = new THREE.Mesh(seatGeo, seatMaterial);
    passSeat.position.set(0.38, 0.7, -0.42);
    group.add(passSeat);

    return group;
  }

  /**
   * 日本の右ハンドル車（JIS規格）用 固定ステアリングコラム＆コンビネーションレバー
   * - ハンドル操舵時も回転しない固定グループとして this.group に直接追加（GLBロード時も常時表示）
   * - 右側 (-X 方向): ウインカー／ライトスイッチレバー（JIS規格・日本車固有の右ウインカー配置）
   * - 左側 (+X 方向): ワイパー／ウォッシャースイッチレバー
   */
  private createSteeringColumnAssembly(): THREE.Group {
    const columnGroup = new THREE.Group();
    columnGroup.position.set(-0.38, 0.895, 0.495);
    columnGroup.rotation.x = 0.35;

    const columnMat = new THREE.MeshStandardMaterial({
      color: 0x14171f,
      roughness: 0.62,
      metalness: 0.18,
    });
    const stalkTipMat = new THREE.MeshStandardMaterial({
      color: 0x27272a,
      roughness: 0.45,
      metalness: 0.25,
    });
    const indicatorMarkMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.25,
      roughness: 0.3,
    });

    // ステアリングコラムシュラウド（カバー）
    const shroudGeo = new THREE.CylinderGeometry(0.044, 0.052, 0.14, 18);
    shroudGeo.rotateX(Math.PI / 2);
    const shroud = new THREE.Mesh(shroudGeo, columnMat);
    shroud.position.set(0, -0.004, 0.04);
    columnGroup.add(shroud);

    // 1. 日本車（JIS規格）右ウインカーレバー（右側 -X 方向へ伸びる）
    const rightTurnStalkGroup = new THREE.Group();
    rightTurnStalkGroup.position.set(-0.038, 0.008, 0.01);
    rightTurnStalkGroup.rotation.z = -0.18;
    rightTurnStalkGroup.rotation.y = -0.12;

    const stalkRodGeo = new THREE.CylinderGeometry(0.0065, 0.0085, 0.115, 12);
    stalkRodGeo.rotateZ(Math.PI / 2);
    stalkRodGeo.translate(-0.057, 0, 0);
    rightTurnStalkGroup.add(new THREE.Mesh(stalkRodGeo, columnMat));

    const rightKnobGeo = new THREE.CylinderGeometry(0.011, 0.009, 0.034, 14);
    rightKnobGeo.rotateZ(Math.PI / 2);
    const rightKnob = new THREE.Mesh(rightKnobGeo, stalkTipMat);
    rightKnob.position.set(-0.118, 0, 0);
    rightTurnStalkGroup.add(rightKnob);

    const turnRingGeo = new THREE.TorusGeometry(0.0098, 0.0016, 8, 16);
    turnRingGeo.rotateY(Math.PI / 2);
    const turnRing = new THREE.Mesh(turnRingGeo, indicatorMarkMat);
    turnRing.position.set(-0.105, 0, 0);
    rightTurnStalkGroup.add(turnRing);

    columnGroup.add(rightTurnStalkGroup);

    // 2. 日本車（JIS規格）左ワイパーレバー（左側 +X 方向へ伸びる）
    const leftWiperStalkGroup = new THREE.Group();
    leftWiperStalkGroup.position.set(0.038, 0.008, 0.01);
    leftWiperStalkGroup.rotation.z = 0.18;
    leftWiperStalkGroup.rotation.y = 0.12;

    const leftStalkRodGeo = new THREE.CylinderGeometry(0.0085, 0.0065, 0.115, 12);
    leftStalkRodGeo.rotateZ(Math.PI / 2);
    leftStalkRodGeo.translate(0.057, 0, 0);
    leftWiperStalkGroup.add(new THREE.Mesh(leftStalkRodGeo, columnMat));

    const leftKnobGeo = new THREE.CylinderGeometry(0.009, 0.011, 0.034, 14);
    leftKnobGeo.rotateZ(Math.PI / 2);
    const leftKnob = new THREE.Mesh(leftKnobGeo, stalkTipMat);
    leftKnob.position.set(0.118, 0, 0);
    leftWiperStalkGroup.add(leftKnob);

    const wiperRing = new THREE.Mesh(turnRingGeo, indicatorMarkMat);
    wiperRing.position.set(0.105, 0, 0);
    leftWiperStalkGroup.add(wiperRing);

    columnGroup.add(leftWiperStalkGroup);

    return columnGroup;
  }

  /**
   * 車内センターコンソール上部の11インチJDMフローティングカーナビゲーションシステムを構築
   * - 右ハンドル運転席 (x = -0.38m) の左隣 (x = -0.02m, y = 0.935m, z = 0.565m) に配置し、運転席側へ14度チルト
   * - 東京都 Project PLATEAU 千代田区 (13101) 建築物フットプリント & 国土地理院道路中心線 (experimental_rdcl) を
   *   高精細 CanvasTexture でリアルタイム描画（左ペイン：ターンバイターン案内・ETC2.0/VICS・速度制限、右ペイン：ヘディングアップ3Dナビ地図）
   */
  private createCenterNavAssembly(): THREE.Group {
    const navGroup = new THREE.Group();
    // 右ハンドル運転席カメラ (x=-0.38, y=1.13, z=0.06) から画面左端(-0.055m)とメーターフード左端(-0.208m)の間に100%収まる位置
    navGroup.position.set(-0.132, 0.985, 0.565);
    // 右ハンドル運転席側 (-X, -Z) へ画面法線を向けるため、Y軸を +0.18 rad (約10.3度)、X軸を +0.06 rad 傾ける
    navGroup.rotation.y = 0.18;
    navGroup.rotation.x = 0.06;

    const bezelDarkMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.35,
      metalness: 0.35,
    });
    const aluminumTrimMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.22,
      metalness: 0.88,
    });
    const hazardMat = new THREE.MeshStandardMaterial({
      color: 0xdc2626,
      emissive: 0xef4444,
      emissiveIntensity: 0.75,
      roughness: 0.25,
    });

    // 1. フローティングディスプレイ背面ハウジング & ダッシュボードマウントステー
    const housingGeo = new THREE.BoxGeometry(0.15, 0.096, 0.016);
    const housing = new THREE.Mesh(housingGeo, bezelDarkMat);
    housing.position.set(0, 0, 0.01);
    navGroup.add(housing);

    const trimFrameGeo = new THREE.BoxGeometry(0.155, 0.101, 0.012);
    const trimFrame = new THREE.Mesh(trimFrameGeo, aluminumTrimMat);
    trimFrame.position.set(0, 0, 0.013);
    navGroup.add(trimFrame);

    // 2. 下部センターエアコンルーバー＆赤いハザードランプスイッチ台座
    const ventHousingGeo = new THREE.BoxGeometry(0.136, 0.024, 0.024);
    const ventHousing = new THREE.Mesh(ventHousingGeo, bezelDarkMat);
    ventHousing.position.set(0, -0.062, 0.01);
    navGroup.add(ventHousing);

    const hazardBtnGeo = new THREE.BoxGeometry(0.022, 0.014, 0.008);
    const hazardBtn = new THREE.Mesh(hazardBtnGeo, hazardMat);
    hazardBtn.position.set(0, -0.062, -0.003);
    navGroup.add(hazardBtn);

    // 3. 高精細カーナビ液晶画面（CanvasTexture 対応、非ブラウザ環境ではフォールバック色）
    let screenMat: THREE.MeshBasicMaterial;
    const isBrowserCanvasAvailable =
      typeof document !== "undefined" && typeof HTMLCanvasElement !== "undefined";
    if (isBrowserCanvasAvailable) {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        this.navCanvas = canvas;
        this.navContext = ctx;
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        this.navTexture = tex;
        this.renderNavigationDisplay({
          position: { x: 3.5, y: 0.8, z: 26 },
          speedKmh: 0,
          headingAngle: 0,
          gear: "D",
        });
        screenMat = new THREE.MeshBasicMaterial({ map: tex });
      } else {
        screenMat = new THREE.MeshBasicMaterial({ color: 0x0284c7 });
      }
    } else {
      screenMat = new THREE.MeshBasicMaterial({ color: 0x0284c7 });
    }

    const screenGeo = new THREE.PlaneGeometry(0.142, 0.088);
    // カメラが後方 (-Z 側) から前方 (+Z 側) を見るため、Y軸に 180度 (Math.PI) 回転させて表面を運転席へ向ける
    screenGeo.rotateY(Math.PI);
    const screenMesh = new THREE.Mesh(screenGeo, screenMat);
    screenMesh.position.set(0, 0.001, 0.001);
    navGroup.add(screenMesh);

    return navGroup;
  }

  /**
   * 車内カーナビ画面を東京都PLATEAU & 国土地理院オープンデータと自車位置・方位でリアルタイム描画する
   */
  private renderNavigationDisplay(
    state: Pick<VehicleState, "position" | "speedKmh" | "headingAngle" | "gear">,
  ): void {
    const ctx = this.navContext;
    const canvas = this.navCanvas;
    const tex = this.navTexture;
    const isReady = Boolean(ctx && canvas && tex);
    if (!isReady || !ctx || !canvas || !tex) {
      return;
    }

    const w = canvas.width;
    const h = canvas.height;
    const carX = state.position.x;
    const carZ = state.position.z;
    const heading = state.headingAngle;

    const nearestRoad = findNearestGsiRoad(carX, carZ);
    const nearestBldg = findNearestPlateauBuilding(carX, carZ);
    const wgs = localToWgs84(carX, carZ);
    const openData = getTokyoOpenData();

    // 1. 全体ベース背景（JDM プレミアムダークネイビー UI）
    ctx.fillStyle = "#070e1c";
    ctx.fillRect(0, 0, w, h);

    // 2. 上部ステータスバー（GPS / VICS / ETC2.0 / 現在道路名 / 時刻）
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, w, 38);
    ctx.strokeStyle = "#1e3a8a";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 38);
    ctx.lineTo(w, 38);
    ctx.stroke();

    // GPS / ETC2.0 バッジ
    ctx.fillStyle = "#10b981";
    ctx.fillRect(12, 8, 52, 22);
    ctx.fillStyle = "#042f2e";
    ctx.font = "bold 12px sans-serif";
    ctx.fillText("ETC2.0", 17, 23);

    ctx.fillStyle = "#0284c7";
    ctx.fillRect(70, 8, 48, 22);
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 12px sans-serif";
    ctx.fillText("VICS", 79, 23);

    // 走行道路名
    ctx.fillStyle = "#38bdf8";
    ctx.font = "bold 15px sans-serif";
    ctx.fillText(nearestRoad.displayName, 128, 24);

    // 右上時刻 & 測位表示
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "bold 15px monospace";
    ctx.fillText("GPS 3D  12:45", w - 132, 24);

    // 3. 左側ターンバイターン・ルート案内パネル (x: 0..225, y: 38..324)
    const leftW = 225;
    ctx.fillStyle = "#0b1528";
    ctx.fillRect(0, 38, leftW, h - 72);

    // 次の交差点までの距離計算（日比谷通り交差点 z = 250m を目標に設定）
    const distToIntersection = Math.max(0, Math.round(250 - carZ));
    ctx.fillStyle = "#1d4ed8";
    ctx.fillRect(10, 48, leftW - 20, 128);
    ctx.strokeStyle = "#60a5fa";
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 48, leftW - 20, 128);

    // ターン案内矢印アイコン（直進＋東京駅・皇居方面案内）
    ctx.strokeStyle = "#ffffff";
    ctx.fillStyle = "#ffffff";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(46, 138);
    ctx.lineTo(46, 74);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(46, 60);
    ctx.lineTo(31, 82);
    ctx.lineTo(61, 82);
    ctx.closePath();
    ctx.fill();

    // 残り距離数値
    ctx.fillStyle = "#fde047";
    ctx.font = "bold 34px monospace";
    ctx.fillText(`${distToIntersection}`, 82, 102);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 18px sans-serif";
    ctx.fillText("m 先", 156, 102);

    ctx.fillStyle = "#e0f2fe";
    ctx.font = "bold 15px sans-serif";
    ctx.fillText("和田倉門・日比谷通り", 80, 130);
    ctx.fillStyle = "#93c5fd";
    ctx.font = "12px sans-serif";
    ctx.fillText("都道404号 → 国道1号", 80, 152);

    // 法定速度 50 km/h 標識アイコン
    ctx.beginPath();
    ctx.arc(42, 214, 24, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = "#ef4444";
    ctx.stroke();
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 20px sans-serif";
    ctx.fillText("50", 30, 221);

    // 現在車速 & ギアテレメトリ
    ctx.fillStyle = "#94a3b8";
    ctx.font = "bold 12px sans-serif";
    ctx.fillText("SPEED / GEAR", 80, 198);
    ctx.fillStyle = "#38bdf8";
    ctx.font = "bold 26px monospace";
    ctx.fillText(`${Math.round(state.speedKmh)}`, 80, 226);
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "bold 14px sans-serif";
    ctx.fillText(`km/h [${state.gear}]`, 134, 226);

    // 近傍 PLATEAU ランドマーク表示カード
    ctx.fillStyle = "#111c33";
    ctx.fillRect(10, 250, leftW - 20, 64);
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 1;
    ctx.strokeRect(10, 250, leftW - 20, 64);
    ctx.fillStyle = "#38bdf8";
    ctx.font = "bold 11px sans-serif";
    ctx.fillText("PLATEAU 3D LANDMARK", 18, 268);
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 14px sans-serif";
    const bldgTitle =
      nearestBldg.name.length > 12 ? `${nearestBldg.name.slice(0, 12)}…` : nearestBldg.name;
    ctx.fillText(bldgTitle, 18, 289);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "11px monospace";
    ctx.fillText(`H:${nearestBldg.measuredHeight}m / ${nearestBldg.storeysAboveGround}F`, 18, 306);

    // 4. 右側リアルタイム 3D/2D ベクトル地図ペイン (x: 225..640, y: 38..324)
    const mapX = leftW;
    const mapY = 38;
    const mapW = w - leftW;
    const mapH = h - 72;
    const centerPxX = mapX + mapW * 0.5;
    const centerPxY = mapY + mapH * 0.68; // 自車アイコンをマップ下部寄りに置いて前方を広く表示
    const scalePxPerMeter = 1.35; // 1m = 1.35px (前方約160m範囲を表示)

    ctx.save();
    ctx.beginPath();
    ctx.rect(mapX, mapY, mapW, mapH);
    ctx.clip();

    // 地図背景色
    ctx.fillStyle = "#09192b";
    ctx.fillRect(mapX, mapY, mapW, mapH);

    // ワールド座標 (wx, wz) を自車中心・ヘディングアップ画面座標へ変換するヘルパー
    // Three.js では +Z が前方、-X が右側（右ハンドル側）、+X が左側
    const worldToMapPx = (wx: number, wz: number): { x: number; y: number } => {
      const dx = wx - carX;
      const dz = wz - carZ;
      const cosH = Math.cos(-heading);
      const sinH = Math.sin(-heading);
      const localRight = -dx * cosH - dz * sinH;
      const localForward = -dx * sinH + dz * cosH;
      return {
        x: centerPxX + localRight * scalePxPerMeter,
        y: centerPxY - localForward * scalePxPerMeter,
      };
    };

    // 距離リンググリッド（50m / 100m / 150m）
    ctx.strokeStyle = "rgba(56, 189, 248, 0.14)";
    ctx.lineWidth = 1;
    for (const rMeters of [50, 100, 150]) {
      ctx.beginPath();
      ctx.arc(centerPxX, centerPxY, rMeters * scalePxPerMeter, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 4.1 皇居外苑内濠（和田倉濠・日比谷濠）の水域描画
    ctx.fillStyle = "rgba(2, 132, 199, 0.48)";
    for (const wb of openData.waterBodies) {
      const corners = [
        worldToMapPx(wb.localX - wb.width * 0.5, wb.localZ - wb.depth * 0.5),
        worldToMapPx(wb.localX + wb.width * 0.5, wb.localZ - wb.depth * 0.5),
        worldToMapPx(wb.localX + wb.width * 0.5, wb.localZ + wb.depth * 0.5),
        worldToMapPx(wb.localX - wb.width * 0.5, wb.localZ + wb.depth * 0.5),
      ];
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < corners.length; i++) {
        ctx.lineTo(corners[i].x, corners[i].y);
      }
      ctx.closePath();
      ctx.fill();
    }

    // 4.2 東京都 PLATEAU 千代田区 (13101) ビル群フットプリント描画
    for (const bldg of openData.plateauBuildings) {
      const isClosest = bldg.buildingId === nearestBldg.buildingId;
      const hw = bldg.width * 0.5;
      const hd = bldg.depth * 0.5;
      const corners = [
        worldToMapPx(bldg.localX - hw, bldg.localZ - hd),
        worldToMapPx(bldg.localX + hw, bldg.localZ - hd),
        worldToMapPx(bldg.localX + hw, bldg.localZ + hd),
        worldToMapPx(bldg.localX - hw, bldg.localZ + hd),
      ];
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < corners.length; i++) {
        ctx.lineTo(corners[i].x, corners[i].y);
      }
      ctx.closePath();
      ctx.fillStyle = isClosest ? "rgba(56, 189, 248, 0.35)" : "rgba(51, 65, 85, 0.72)";
      ctx.fill();
      ctx.strokeStyle = isClosest ? "#38bdf8" : "#64748b";
      ctx.lineWidth = isClosest ? 2.0 : 1.2;
      ctx.stroke();
    }

    // 4.3 国土地理院 道路中心線 (experimental_rdcl) ネットワーク描画
    for (const seg of openData.gsiRoadSegments) {
      const p0 = worldToMapPx(seg.start.x, seg.start.z);
      const p1 = worldToMapPx(seg.end.x, seg.end.z);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.strokeStyle = "#475569";
      ctx.lineWidth = 14;
      ctx.lineCap = "round";
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.strokeStyle = "#94a3b8";
      ctx.lineWidth = 8;
      ctx.lineCap = "round";
      ctx.stroke();
    }

    // 4.4 推奨ナビゲーションルート（行幸通り左側車線 x = +3.5m, z = -30..250m → 日比谷通り）をシアン＆ブルー発光ラインでハイライト
    const routePts = [worldToMapPx(3.5, -20), worldToMapPx(3.5, 250), worldToMapPx(95.0, 250)];
    ctx.beginPath();
    ctx.moveTo(routePts[0].x, routePts[0].y);
    ctx.lineTo(routePts[1].x, routePts[1].y);
    ctx.lineTo(routePts[2].x, routePts[2].y);
    ctx.strokeStyle = "#0284c7";
    ctx.lineWidth = 11;
    ctx.lineJoin = "round";
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(routePts[0].x, routePts[0].y);
    ctx.lineTo(routePts[1].x, routePts[1].y);
    ctx.lineTo(routePts[2].x, routePts[2].y);
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 5;
    ctx.stroke();

    // 主要ランドマーク名ラベル（東京駅・丸ビル・新丸ビル・和田倉門）
    const labels = [
      { text: "東京駅", x: 0, z: -25, color: "#fca5a5" },
      { text: "丸ビル", x: 64, z: 62, color: "#e2e8f0" },
      { text: "新丸ビル", x: -64, z: 62, color: "#e2e8f0" },
      { text: "皇居・和田倉門", x: 0, z: 255, color: "#86efac" },
    ];
    ctx.font = "bold 12px sans-serif";
    for (const lbl of labels) {
      const pt = worldToMapPx(lbl.x, lbl.z);
      const isInsideMap =
        pt.x > mapX + 15 && pt.x < w - 55 && pt.y > mapY + 18 && pt.y < mapY + mapH - 12;
      if (isInsideMap) {
        ctx.fillStyle = "rgba(15, 23, 42, 0.82)";
        ctx.fillRect(pt.x - 28, pt.y - 11, lbl.text.length * 13 + 8, 18);
        ctx.fillStyle = lbl.color;
        ctx.fillText(lbl.text, pt.x - 24, pt.y + 2);
      }
    }

    // 4.5 自車位置マーカー（赤いデルタ矢印＋パルスサークル）
    ctx.beginPath();
    ctx.arc(centerPxX, centerPxY, 18, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(239, 68, 68, 0.24)";
    ctx.fill();
    ctx.strokeStyle = "#f87171";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(centerPxX, centerPxY - 14);
    ctx.lineTo(centerPxX - 11, centerPxY + 11);
    ctx.lineTo(centerPxX, centerPxY + 5);
    ctx.lineTo(centerPxX + 11, centerPxY + 11);
    ctx.closePath();
    ctx.fillStyle = "#ef4444";
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.stroke();

    // コンパスアイコン（右上）
    const compX = w - 34;
    const compY = mapY + 32;
    ctx.beginPath();
    ctx.arc(compX, compY, 18, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
    ctx.fill();
    ctx.strokeStyle = "#64748b";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "#ef4444";
    ctx.font = "bold 12px sans-serif";
    ctx.fillText("N", compX - 4, compY - 3);
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "10px sans-serif";
    ctx.fillText("100m", compX - 13, compY + 11);

    ctx.restore();

    // 左ペインと地図ペインの境界線
    ctx.strokeStyle = "#1e3a8a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(leftW, 38);
    ctx.lineTo(leftW, h - 34);
    ctx.stroke();

    // 5. 下部ナビメニュー＆オーディオ・エアコンステータスバー (y: 326..360)
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, h - 34, w, 34);
    ctx.strokeStyle = "#1e3a8a";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, h - 34);
    ctx.lineTo(w, h - 34);
    ctx.stroke();

    ctx.fillStyle = "#38bdf8";
    ctx.font = "bold 12px sans-serif";
    ctx.fillText("MENU", 16, h - 12);
    ctx.fillStyle = "#e2e8f0";
    ctx.fillText("MAP 3D", 74, h - 12);
    ctx.fillStyle = "#94a3b8";
    ctx.fillText("AUDIO: TOKYO JDM FM 80.0MHz", 146, h - 12);
    ctx.fillStyle = "#34d399";
    ctx.font = "bold 12px monospace";
    ctx.fillText(`A/C AUTO 22.0℃ | ${wgs.lat.toFixed(4)}N ${wgs.lon.toFixed(4)}E`, 368, h - 12);

    tex.needsUpdate = true;
  }

  private createSteeringWheel(): THREE.Group {
    const group = new THREE.Group();
    // 日本の右ハンドル運転席位置 (x = -0.38m, y = 0.90m, z = 0.44m)
    group.position.set(-0.38, 0.9, 0.44);

    // 実寸スポーツステアリング（外径 360mm = 中心半径 0.164m + グリップ断面半径 0.016m）
    const rimGeo = new THREE.TorusGeometry(0.164, 0.016, 18, 42);
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x181c24,
      roughness: 0.48,
      metalness: 0.12,
    });
    const spokeMat = new THREE.MeshStandardMaterial({
      color: 0xe5e7eb,
      metalness: 0.88,
      roughness: 0.22,
    });
    const markerMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      emissive: 0x854d0e,
      emissiveIntensity: 0.35,
      roughness: 0.3,
    });
    const jdmBadgeMat = new THREE.MeshStandardMaterial({
      color: 0xdc2626,
      emissive: 0x7f1d1d,
      emissiveIntensity: 0.35,
      roughness: 0.25,
      metalness: 0.2,
    });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = 0.35;
    group.add(rim);

    // 12時位置のトップセンターマーカーリング（実寸 14mm 幅）
    const topMarkerGeo = new THREE.CylinderGeometry(0.0172, 0.0172, 0.014, 16);
    topMarkerGeo.rotateZ(Math.PI / 2);
    const topMarker = new THREE.Mesh(topMarkerGeo, markerMat);
    topMarker.position.set(0, 0.164, 0);
    rim.add(topMarker);

    const centerGeo = new THREE.CylinderGeometry(0.056, 0.056, 0.032, 20);
    centerGeo.rotateX(Math.PI / 2);
    const center = new THREE.Mesh(centerGeo, rimMat);
    center.position.set(0, 0, 0.01);
    rim.add(center);

    // センターパッドのJDMレッドバッジ＆クロームエンブレムリング
    const badgePlateGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.004, 20);
    badgePlateGeo.rotateX(Math.PI / 2);
    const badgePlate = new THREE.Mesh(badgePlateGeo, jdmBadgeMat);
    badgePlate.position.set(0, 0, 0.026);
    rim.add(badgePlate);

    const emblemGeo = new THREE.TorusGeometry(0.024, 0.003, 12, 24);
    const emblem = new THREE.Mesh(emblemGeo, spokeMat);
    emblem.position.set(0, 0, 0.028);
    rim.add(emblem);

    // 3本スポーク（左右＋下）
    const hSpokeGeo = new THREE.BoxGeometry(0.3, 0.022, 0.014);
    const hSpoke = new THREE.Mesh(hSpokeGeo, spokeMat);
    rim.add(hSpoke);

    const vSpokeGeo = new THREE.BoxGeometry(0.026, 0.15, 0.014);
    const vSpoke = new THREE.Mesh(vSpokeGeo, spokeMat);
    vSpoke.position.set(0, -0.075, 0);
    rim.add(vSpoke);

    // 左右パドルシフト（-/+）
    const paddleGeo = new THREE.BoxGeometry(0.016, 0.072, 0.008);
    const leftPaddle = new THREE.Mesh(paddleGeo, spokeMat);
    leftPaddle.position.set(0.115, 0.018, 0.026);
    rim.add(leftPaddle);

    const rightPaddle = new THREE.Mesh(paddleGeo, spokeMat);
    rightPaddle.position.set(-0.115, 0.018, 0.026);
    rim.add(rightPaddle);

    return group;
  }

  /**
   * フロントガラスの頂点座標から UV を正規化し、GLB / プロシージャル双方で
   * u = 0.0 (右ハンドル運転席右端 x=-0.74) .. 1.0 (助手席左端 x=+0.74),
   * v = 0.0 (カウル下端 y=0.88) .. 1.0 (ルーフ上端 y=1.42) に統一する
   */
  public normalizeWindshieldGeometryUVs(geometry: THREE.BufferGeometry): void {
    const posAttr = geometry.attributes.position;
    const hasNoPositionAttribute = !posAttr;
    if (hasNoPositionAttribute) {
      return;
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }

    const spanX = Math.max(maxX - minX, 0.001);
    const spanY = Math.max(maxY - minY, 0.001);
    const uvs = new Float32Array(posAttr.count * 2);

    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      // 右ハンドル運転席側外側 (x = minX = -0.74) を u = 0.0、助手席側外側 (x = maxX = +0.74) を u = 1.0 とする
      const u = THREE.MathUtils.clamp((x - minX) / spanX, 0.0, 1.0);
      // カウル下端 (y = minY = 0.88) を v = 0.0、ルーフ上端 (y = maxY = 1.42) を v = 1.0 とする
      const v = THREE.MathUtils.clamp((y - minY) / spanY, 0.0, 1.0);
      uvs[i * 2] = u;
      uvs[i * 2 + 1] = v;
    }

    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  }

  private createWindshield(): { mesh: THREE.Mesh; material: THREE.ShaderMaterial } {
    // GLB の Windshield と完全同一の 3D 曲面座標 (幅 1.48m, 傾斜長 0.965m, y=0.88..1.42, z=1.28..0.48) を構築
    const segX = 24;
    const segY = 16;
    const geo = new THREE.PlaneGeometry(1.48, 0.965, segX, segY);

    const posAttr = geo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const localX = posAttr.getX(i); // -0.74 .. +0.74
      const localY = posAttr.getY(i); // -0.4825 .. +0.4825
      const t = localY / 0.965 + 0.5; // 0.0 (下端カウル) .. 1.0 (上端ルーフ)
      const worldY = THREE.MathUtils.lerp(0.88, 1.42, t);
      const baseZ = THREE.MathUtils.lerp(1.28, 0.48, t);
      const archZ = (1.0 - Math.pow(localX / 0.74, 2)) * 0.06;
      posAttr.setXYZ(i, localX, worldY, baseZ + archZ);
    }

    this.normalizeWindshieldGeometryUVs(geo);
    geo.computeVertexNormals();

    const mat = createWindshieldMaterial();
    const mesh = new THREE.Mesh(geo, mat);

    return { mesh, material: mat };
  }

  private createWipers(): { driverWiper: THREE.Group; passengerWiper: THREE.Group } {
    const armMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.45,
      metalness: 0.55,
    });
    const rubberMat = new THREE.MeshStandardMaterial({
      color: 0x09090b,
      roughness: 0.92,
      metalness: 0.05,
    });

    /**
     * 日本の右ハンドル車用タンデム式エアロフラットワイパーを構築する
     * - ローカル原点 (0,0,0) をピボット軸とし、+X 方向（車体右外側から助手席左内側方向）へアームとブレードを配置
     * - シェーダーのブレード半径 r = [bladeInnerR, bladeOuterR] と 1mm の誤差なく一致させる
     */
    const createAeroWiperAssembly = (
      armLength: number,
      bladeInnerR: number,
      bladeOuterR: number,
    ): THREE.Group => {
      const wiperGroup = new THREE.Group();
      wiperGroup.rotation.order = "XYZ";

      // 1. ピボットキャップ（カウル付け根の回転軸カバー）
      const capGeo = new THREE.CylinderGeometry(0.018, 0.022, 0.014, 16);
      capGeo.rotateX(Math.PI / 2);
      const capMesh = new THREE.Mesh(capGeo, armMat);
      capMesh.position.set(0, 0, 0.002);
      wiperGroup.add(capMesh);

      // 2. ワイパーアーム（ピボット (0,0) からブレード中央ブラケット (+armLength, 0) まで伸びるテーパーアーム）
      const armGeo = new THREE.BoxGeometry(armLength, 0.016, 0.008);
      armGeo.translate(armLength * 0.5, 0, 0.004);
      const armMesh = new THREE.Mesh(armGeo, armMat);
      wiperGroup.add(armMesh);

      // 3. センタークリップ（アーム先端とブレードを繋ぐジョイント）
      const clipGeo = new THREE.BoxGeometry(0.036, 0.02, 0.01);
      const clipMesh = new THREE.Mesh(clipGeo, armMat);
      clipMesh.position.set(armLength, 0, 0.003);
      wiperGroup.add(clipMesh);

      // 4. エアロフラットブレード本体（r = bladeInnerR .. bladeOuterR を払拭）
      const bladeLength = bladeOuterR - bladeInnerR;
      const bladeCenterR = (bladeInnerR + bladeOuterR) * 0.5;
      const spineGeo = new THREE.BoxGeometry(bladeLength, 0.014, 0.007);
      spineGeo.translate(bladeCenterR, 0, 0.001);
      const spineMesh = new THREE.Mesh(spineGeo, armMat);
      wiperGroup.add(spineMesh);

      // 5. ガラス面に完全密着するラバーリップ（スクイージーゴム刃: 視差ゼロでシェーダー払拭境界と完全一致）
      const rubberGeo = new THREE.BoxGeometry(bladeLength, 0.007, 0.006);
      rubberGeo.translate(bladeCenterR, 0, -0.001);
      const rubberMesh = new THREE.Mesh(rubberGeo, rubberMat);
      wiperGroup.add(rubberMesh);

      return wiperGroup;
    };

    // 右ハンドル運転席ワイパー: ピボット (x=-0.58, y=0.891, z=1.275) -> シェーダー上の pivotDriver = (0.16m, 0.02m)
    // ブレード払拭半径 r = [0.08m, 0.86m]（アーム長 0.45m、右ハンドル運転席正面 p.x=0.36m を高さ p.y=0.85m までワイドに払拭）
    const driverWiper = createAeroWiperAssembly(0.45, 0.08, 0.86);
    driverWiper.position.set(-0.58, 0.891, 1.275);
    driverWiper.rotation.x = CarModel.WINDSHIELD_TILT_X;
    driverWiper.rotation.z = CarModel.WIPER_PARK_ANGLE;

    // 助手席ワイパー: ピボット (x=+0.06, y=0.891, z=1.318) -> シェーダー上の pivotPassenger = (0.80m, 0.02m)
    // ブレード払拭半径 r = [0.08m, 0.66m]（アーム長 0.36m、中央オーバーラップから助手席Aピラー際まで払拭）
    const passengerWiper = createAeroWiperAssembly(0.36, 0.08, 0.66);
    passengerWiper.position.set(0.06, 0.891, 1.318);
    passengerWiper.rotation.x = CarModel.WINDSHIELD_TILT_X;
    passengerWiper.rotation.z = CarModel.WIPER_PARK_ANGLE;

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
    // 1. 車両位置・3次元姿勢（クォータニオン：ヨー＋サスペンションによるピッチ・ロール）の同期
    this.group.position.set(state.position.x, state.position.y, state.position.z);
    const hasQuaternion = state.quaternion !== undefined;
    if (hasQuaternion) {
      this.group.quaternion.set(
        state.quaternion.x,
        state.quaternion.y,
        state.quaternion.z,
        state.quaternion.w,
      );
    } else {
      this.group.rotation.y = state.headingAngle;
    }

    // 2. ステアリングホイールの回転連動
    this.steeringWheel.rotation.z = -state.steeringAngle * 2.8;

    // 3. 4輪のサスペンション上下ストローク・前輪操舵角・ホイール回転の同期
    const wheelRotSpeed = (state.speedKmh / 3.6 / 0.38) * dt;
    const hasWheelTelemetry = Array.isArray(state.wheels) && state.wheels.length >= 4;
    const restLength = 0.32;

    for (let i = 0; i < this.wheels.length; i++) {
      const wheelObj = this.wheels[i];
      wheelObj.rotation.order = "YXZ";

      const isFrontWheel = i < 2;
      if (isFrontWheel) {
        wheelObj.rotation.y = -state.steeringAngle;
      }

      if (hasWheelTelemetry && i < this.wheelBasePositions.length) {
        const telemetry = state.wheels[i];
        const basePos = this.wheelBasePositions[i];
        // サスペンションの伸縮（圧縮時はホイールが車体に対して相対的に上へ移動）
        const compressionOffset = THREE.MathUtils.clamp(
          restLength - telemetry.suspensionLength,
          -0.12,
          0.14,
        );
        wheelObj.position.y = basePos.y + compressionOffset;
      }

      wheelObj.rotation.x += wheelRotSpeed;
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
    u.uWiperDir.value = this.wiperDirection;
    u.uWiperSpeed.value = this.wiperSpeedVal;
    const isReturningToPark = this.wiperAngleDriver > CarModel.WIPER_PARK_ANGLE + 0.015;
    const isWiping = this.wiperMode !== "off" || isReturningToPark;
    u.uWiperClearing.value = isWiping ? 0.98 : 0.0;

    // 6. センターコンソール 11インチ JDM フローティングカーナビ画面の定期更新
    this.navUpdateElapsed += dt;
    const shouldRefreshNav = this.navUpdateElapsed >= 0.15;
    if (shouldRefreshNav) {
      this.navUpdateElapsed = 0;
      this.renderNavigationDisplay(state);
    }
  }

  private updateWipers(dt: number, rainIntensity: number): void {
    let speedMult = 0;
    const isSlowWiper = this.wiperMode === "slow";
    const isFastWiper = this.wiperMode === "fast";
    const isAutoWiperStandby = this.wiperMode === "off" && rainIntensity > 0.3;

    if (isSlowWiper) {
      speedMult = 3.5;
    } else if (isFastWiper) {
      speedMult = 6.5;
    } else if (isAutoWiperStandby) {
      speedMult = 0.0;
    }

    const parkAngle = CarModel.WIPER_PARK_ANGLE;
    const isWiperMoving = speedMult > 0;
    if (!isWiperMoving) {
      this.wiperDirection = -1.0;
      this.wiperSpeedVal = 3.5;
      this.wiperAngleDriver = THREE.MathUtils.lerp(
        this.wiperAngleDriver,
        parkAngle,
        Math.min(1.0, dt * 6.0),
      );
      this.wiperAnglePassenger = THREE.MathUtils.lerp(
        this.wiperAnglePassenger,
        parkAngle,
        Math.min(1.0, dt * 6.0),
      );
      this.wiperTime = 0;
      this.applyWiperArmTransforms();
      return;
    }

    this.wiperSpeedVal = speedMult;
    this.wiperTime += dt * speedMult;

    // 0.5 - 0.5 * cos(t): t=0 で下端パーク位置(sweep=0)から始まり、t=π で上死点(sweep=1)、t=2π でパーク位置へ戻る
    const sweep = 0.5 - 0.5 * Math.cos(this.wiperTime);
    const isAscendingStroke = Math.sin(this.wiperTime) >= 0.0;
    this.wiperDirection = isAscendingStroke ? 1.0 : -1.0;

    this.wiperAngleDriver = THREE.MathUtils.lerp(parkAngle, CarModel.WIPER_MAX_ANGLE_DRIVER, sweep);
    this.wiperAnglePassenger = THREE.MathUtils.lerp(
      parkAngle,
      CarModel.WIPER_MAX_ANGLE_PASSENGER,
      sweep,
    );

    this.applyWiperArmTransforms();
  }

  private applyWiperArmTransforms(): void {
    // ローカル +X 軸基準（右ハンドル車仕様）で構築されたブレードを、傾斜ガラス平面上で Z 軸回転 (+angle) させる
    // 同時にガラスの緩やかな水平アーチ曲面に密着させるため、角度に応じた微小な Y 軸ロール補正を加える
    this.wiperArmDriver.rotation.x = CarModel.WINDSHIELD_TILT_X;
    this.wiperArmDriver.rotation.y = -Math.sin(this.wiperAngleDriver) * 0.045;
    this.wiperArmDriver.rotation.z = this.wiperAngleDriver;

    this.wiperArmPassenger.rotation.x = CarModel.WINDSHIELD_TILT_X;
    this.wiperArmPassenger.rotation.y = -Math.sin(this.wiperAnglePassenger) * 0.035;
    this.wiperArmPassenger.rotation.z = this.wiperAnglePassenger;
  }

  public setHeadlights(enabled: boolean): void {
    for (let i = 0; i < this.headLights.length; i++) {
      this.headLights[i].intensity = enabled ? 35.0 : 0.0;
    }
  }
}

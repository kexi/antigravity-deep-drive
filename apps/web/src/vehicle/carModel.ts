import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createWindshieldMaterial, type WindshieldUniforms } from "../shaders/windshield";
import type { VehicleState, WiperMode } from "../types";
import { assetManager } from "../assets/assetManager";

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

  private proceduralBodyGroup: THREE.Group;
  private wheelBasePositions: THREE.Vector3[] = [];
  private wiperAngleDriver = 0.09;
  private wiperAnglePassenger = 0.09;
  private wiperDirection = 1.0;
  private wiperSpeedVal = 3.5;
  private wiperTime = 0;
  private wiperMode: WiperMode = "slow";

  private static readonly WIPER_PARK_ANGLE = 0.09;
  private static readonly WIPER_MAX_ANGLE_DRIVER = 1.68;
  private static readonly WIPER_MAX_ANGLE_PASSENGER = 1.58;
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

    // 5. ステアリングホイール（内装内から参照）
    this.steeringWheel = this.createSteeringWheel();
    this.group.add(this.steeringWheel);

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

    // リア貫通LEDテールバー & ディフューザー & 4本出しマフラー
    const tailBarGeo = new THREE.BoxGeometry(1.58, 0.06, 0.05);
    const tailBar = new THREE.Mesh(tailBarGeo, tailLightMaterial);
    tailBar.position.set(0, 0.74, -2.18);
    group.add(tailBar);

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

    // ダッシュボード（上端 y=0.86 に抑え、y=1.13 のドライバー視点カメラからメーターとフロントガラス下部が広く見える配置）
    const dashGeo = new THREE.BoxGeometry(1.48, 0.24, 0.48);
    const dash = new THREE.Mesh(dashGeo, dashMaterial);
    dash.position.set(0, 0.74, 0.68);
    group.add(dash);

    // 運転席メーターフード（右ハンドル x = -0.38m）
    const hoodGeo = new THREE.BoxGeometry(0.34, 0.09, 0.22);
    const hood = new THREE.Mesh(hoodGeo, dashMaterial);
    hood.position.set(-0.38, 0.91, 0.66);
    group.add(hood);

    // センターコンソール
    const consoleGeo = new THREE.BoxGeometry(0.3, 0.28, 1.0);
    const consoleMesh = new THREE.Mesh(consoleGeo, dashMaterial);
    consoleMesh.position.set(0, 0.56, 0.0);
    group.add(consoleMesh);

    // 運転席デジタルメータークラスター（右ハンドル仕様: x = -0.38m、ステアリング上部開口から見える位置）
    const screenGeo = new THREE.PlaneGeometry(0.3, 0.1);
    const screenMat = new THREE.MeshBasicMaterial({
      color: 0x0ea5e9,
    });
    const screen = new THREE.Mesh(screenGeo, screenMat);
    screen.position.set(-0.38, 0.92, 0.62);
    screen.rotation.x = -0.22;
    screen.rotation.y = Math.PI;
    group.add(screen);

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

    // センターパッドのクロームエンブレムリング
    const emblemGeo = new THREE.TorusGeometry(0.024, 0.003, 12, 24);
    const emblem = new THREE.Mesh(emblemGeo, spokeMat);
    emblem.position.set(0, 0, 0.027);
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

    // 右ハンドル運転席ワイパー: ピボット (x=-0.64, y=0.891, z=1.275) -> シェーダー上の pivotDriver = (0.10m, 0.02m)
    // ブレード払拭半径 r = [0.10m, 0.76m]（右ハンドル運転席Aピラー際から中央まで広範囲を払拭）
    const driverWiper = createAeroWiperAssembly(0.41, 0.1, 0.76);
    driverWiper.position.set(-0.64, 0.891, 1.275);
    driverWiper.rotation.x = CarModel.WINDSHIELD_TILT_X;
    driverWiper.rotation.z = CarModel.WIPER_PARK_ANGLE;

    // 助手席ワイパー: ピボット (x=-0.02, y=0.891, z=1.318) -> シェーダー上の pivotPassenger = (0.72m, 0.02m)
    // ブレード払拭半径 r = [0.10m, 0.68m]（中央オーバーラップから助手席Aピラー際まで払拭）
    const passengerWiper = createAeroWiperAssembly(0.37, 0.1, 0.68);
    passengerWiper.position.set(-0.02, 0.891, 1.318);
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

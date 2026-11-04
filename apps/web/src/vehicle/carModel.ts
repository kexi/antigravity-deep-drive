import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { getGraphicsQualityPreset, type GraphicsQualityPreset } from "../core/graphicsQuality";
import {
  computeGlassRainScrollRates,
  createRearWindowMaterial,
  createSideWindowMaterial,
  createWindshieldMaterial,
  type WindshieldUniforms,
} from "../shaders/windshield";
import type {
  GraphicsQuality,
  TimeOfDay,
  TurnSignalState,
  VehicleState,
  WeatherCondition,
  WiperMode,
} from "../types";
import { assetManager } from "../assets/assetManager";
import { Procedural3DTextureGenerator } from "../textures/procedural3DTexture";
import {
  findNearestGsiRoad,
  findNearestPlateauBuilding,
  getNavigationIntersections,
  getNavigationRoadCorridors,
  getPlateauBuildingsForMap,
  getShibuyaPlateauBuildingsForMap,
  getTokyoOpenData,
  localToWgs84,
} from "../openData/gsiPlateauLoader";
import {
  formatLabelPair,
  getNavigationMapLabels,
  getUiTranslations,
  i18n,
  localizeBuildingName,
  localizeRoadDisplayName,
  localizeTimeOfDaySummaryLabel,
  localizeWeatherSummaryLabel,
  type SupportedLocale,
} from "../core/i18n";

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
  public sideWindowsMesh: THREE.Mesh;
  public sideWindowMaterial: THREE.ShaderMaterial;
  public rearWindowMesh: THREE.Mesh;
  public rearWindowMaterial: THREE.ShaderMaterial;
  public steeringWheel: THREE.Group;
  public wiperArmDriver: THREE.Group;
  public wiperArmPassenger: THREE.Group;
  public wheels: THREE.Object3D[] = [];
  public headLights: THREE.SpotLight[] = [];
  public headlightLowBeamLight!: THREE.SpotLight;
  public headlightLightSourceGroup!: THREE.Group;
  public headlightBeamConeGroup!: THREE.Group;
  public cabinOverheadLight!: THREE.PointLight;
  public cabinAmbientLight!: THREE.PointLight;
  public cabinFootwellLight!: THREE.PointLight;
  public glbModelGroup: THREE.Group | null = null;
  public instrumentClusterGroup: THREE.Group;
  public tachNeedleGroup!: THREE.Group;
  public speedNeedleGroup!: THREE.Group;
  public electroShifterGroup: THREE.Group;
  public shifterKnobMesh!: THREE.Mesh;
  public centerNavGroup: THREE.Group;
  public rearviewMirrorGroup: THREE.Group;
  public sideMirrorRightGroup: THREE.Group;
  public sideMirrorLeftGroup: THREE.Group;
  public rearCamera: THREE.PerspectiveCamera;
  public rearRenderTarget: THREE.WebGLRenderTarget;
  public rearviewMirrorMaterial: THREE.ShaderMaterial;
  public sideMirrorRightMaterial: THREE.ShaderMaterial;
  public sideMirrorLeftMaterial: THREE.ShaderMaterial;
  public graphicsQuality: GraphicsQuality = "high";
  public mirrorRenderInterval = 1;
  public turnSignalStalkGroup!: THREE.Group;
  public turnSignalLampGroup!: THREE.Group;
  public leftBlinkerMaterial!: THREE.MeshStandardMaterial;
  public rightBlinkerMaterial!: THREE.MeshStandardMaterial;
  public onTurnSignalBlinkPhaseChange?: (blinkOn: boolean, state: TurnSignalState) => void;

  private mirrorFrameCounter = 0;
  private proceduralBodyGroup: THREE.Group;
  private turnSignalState: TurnSignalState = "off";
  private turnSignalTimer = 0;
  private turnSignalBlinkOn = false;
  private static readonly TURN_SIGNAL_HALF_PERIOD_SEC = 0.34;
  private static readonly STALK_NEUTRAL_ROT_Z = -0.18;
  private rearCameraWorldPos = new THREE.Vector3();
  private rearCameraLookAtPos = new THREE.Vector3();
  private wheelBasePositions: THREE.Vector3[] = [];
  private clusterCanvas: HTMLCanvasElement | null = null;
  private clusterContext: CanvasRenderingContext2D | null = null;
  private clusterTexture: THREE.CanvasTexture | null = null;
  private clusterUpdateElapsed = 1.0;
  private smoothedSpeedKmh = 0;
  private smoothedRpm = 780;
  private smoothedPowerRatio = 0;
  private tripDistanceKm = 0;
  private odometerBaseKm = 12480.4;
  private headlightsEnabled = true;
  private navCanvas: HTMLCanvasElement | null = null;
  private navContext: CanvasRenderingContext2D | null = null;
  private navTexture: THREE.CanvasTexture | null = null;
  private navUpdateElapsed = 1.0;
  private navClockText = "17:30";
  private navTimeLabel = localizeTimeOfDaySummaryLabel("sunset", i18n.getLocale());
  private navWeatherLabel = localizeWeatherSummaryLabel("clear", i18n.getLocale());
  private currentLocale: SupportedLocale = i18n.getLocale();
  private cachedNavWaterBodies: Array<{
    localX: number;
    localZ: number;
    width: number;
    depth: number;
  }> | null = null;
  private cachedNavMapBuildings: Array<{
    buildingId: string;
    x: number;
    z: number;
    w: number;
    d: number;
    h: number;
  }> | null = null;
  private navLabelWidthCache = new Map<string, number>();
  private lastNavVehicleState: Pick<
    VehicleState,
    "position" | "speedKmh" | "headingAngle" | "gear"
  > = {
    position: { x: 3.5, y: 0.8, z: 26 },
    speedKmh: 0,
    headingAngle: 0,
    gear: "D",
  };
  private wiperAngleDriver = 0.08;
  private wiperAnglePassenger = 0.08;
  private wiperDirection = 1.0;
  private wiperSpeedVal = 3.5;
  private wiperTime = 0;
  private wiperMode: WiperMode = "slow";
  private glbLoadPromise: Promise<void> = Promise.resolve();

  private static readonly WIPER_PARK_ANGLE = 0.08;
  private static readonly WIPER_MAX_ANGLE_DRIVER = 1.62;
  private static readonly WIPER_MAX_ANGLE_PASSENGER = 1.56;
  private static readonly WINDSHIELD_TILT_X = -0.977;

  constructor() {
    this.group = new THREE.Group();

    // 0. リアルタイム後方鏡面反射カメラ & WebGLRenderTarget & ミラーシェーダーマテリアルの初期化
    // Why far を 160m に抑えるか:
    // バックミラー・サイドミラーでは後方 160m 以内の道路・建物が視認できれば十分であり、
    // 遠方の別街区ビルや小物をフラスタムカリングで除外してミラー描画パスの頂点・フラグメント負荷を削減するため。
    this.rearCamera = new THREE.PerspectiveCamera(78, 2.0, 0.25, 160);
    this.rearRenderTarget = new THREE.WebGLRenderTarget(512, 256, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.rearviewMirrorMaterial = this.createMirrorShaderMaterial(
      this.rearRenderTarget.texture,
      new THREE.Vector2(0.84, 0.68),
      new THREE.Vector2(0.08, 0.18),
      new THREE.Color(0xebf8ff),
    );
    this.sideMirrorRightMaterial = this.createMirrorShaderMaterial(
      this.rearRenderTarget.texture,
      new THREE.Vector2(0.52, 0.78),
      new THREE.Vector2(0.02, 0.11),
      new THREE.Color(0xe0f2fe),
    );
    this.sideMirrorLeftMaterial = this.createMirrorShaderMaterial(
      this.rearRenderTarget.texture,
      new THREE.Vector2(0.52, 0.78),
      new THREE.Vector2(0.46, 0.11),
      new THREE.Color(0xe0f2fe),
    );
    this.leftBlinkerMaterial = new THREE.MeshStandardMaterial({
      name: "BlinkerAmber_L",
      color: 0xf59e0b,
      emissive: 0xff8c00,
      emissiveIntensity: 0.08,
      roughness: 0.22,
    });
    this.rightBlinkerMaterial = new THREE.MeshStandardMaterial({
      name: "BlinkerAmber_R",
      color: 0xf59e0b,
      emissive: 0xff8c00,
      emissiveIntensity: 0.08,
      roughness: 0.22,
    });

    // 1. 車体外装（シャシー）
    const bodyGroup = this.createCarBody();
    this.proceduralBodyGroup = bodyGroup;
    this.group.add(bodyGroup);

    // 2. コックピット内装
    const interiorGroup = this.createInterior();
    this.proceduralBodyGroup.add(interiorGroup);

    // 2.5 車内ルームミラー（バックミラー）& 左右ドアミラー（サイドミラー）プロシージャルフォールバック
    this.rearviewMirrorGroup = this.createRearviewMirrorAssembly();
    this.proceduralBodyGroup.add(this.rearviewMirrorGroup);
    const { rightMirror, leftMirror } = this.createSideMirrorsAssembly();
    this.sideMirrorRightGroup = rightMirror;
    this.sideMirrorLeftGroup = leftMirror;
    this.proceduralBodyGroup.add(this.sideMirrorRightGroup);
    this.proceduralBodyGroup.add(this.sideMirrorLeftGroup);

    // 3. フロントガラス・左右6ライトサイドガラス・リアガラス
    const { mesh, material } = this.createWindshield();
    this.windshieldMesh = mesh;
    this.windshieldMaterial = material;
    this.group.add(mesh);

    const { mesh: sideMesh, material: sideMat } = this.createSideWindows();
    this.sideWindowsMesh = sideMesh;
    this.sideWindowMaterial = sideMat;
    this.group.add(sideMesh);

    const { mesh: rearMesh, material: rearMat } = this.createRearWindow();
    this.rearWindowMesh = rearMesh;
    this.rearWindowMaterial = rearMat;
    this.group.add(rearMesh);

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

    // 5.25 運転席12.3インチ フルTFTデジタル＋2眼リングメータークラスター & 電子シフトレバー（車両状態に連動してリアルタイム動作）
    this.instrumentClusterGroup = this.createInstrumentClusterAssembly();
    this.group.add(this.instrumentClusterGroup);
    this.electroShifterGroup = this.createElectroShifterAssembly();
    this.group.add(this.electroShifterGroup);

    // 5.5 車内11インチJDMフローティングカーナビユニット（リアルタイムPLATEAU建物＆国土地理院道路3Dマップ表示）
    this.centerNavGroup = this.createCenterNavAssembly();
    this.group.add(this.centerNavGroup);

    // 5.75 前後左右ウインカー（方向指示器）アンバーLEDストリップ（GLB・プロシージャル両モード共通）
    this.turnSignalLampGroup = this.createTurnSignalLampsAssembly();
    this.group.add(this.turnSignalLampGroup);

    // 6. ヘッドライト＆クラウン車内キャビン専用ライティング（ルーフマップランプ＋64色アンビエントイルミネーション）
    this.setupHeadlights();
    this.setupInteriorLighting();

    // 7. Blender CLI で生成した car.glb の非同期ロード
    this.glbLoadPromise = this.loadGlbModel();
  }

  /**
   * 非同期ロードされる `car.glb` の読み込み・3Dテクスチャシェーダー設定完了を待機する。
   * Why タイムアウト付き Promise にするか:
   * `/boost` 起動時に GLB モデルのカスタムシェーダー（3D杢目・本革・マイカ塗装等）を確実にプリビルド対象へ含めつつ、
   * ネットワーク遅延やオフライン環境でも起動がハングアップしないようにするため。
   */
  public async waitForModelsLoaded(timeoutMs = 4000): Promise<void> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<void>((resolve) => {
      timeoutId = setTimeout(resolve, timeoutMs);
    });
    try {
      await Promise.race([this.glbLoadPromise, timeoutPromise]);
    } finally {
      const hasTimeout = timeoutId !== null;
      if (hasTimeout) {
        clearTimeout(timeoutId!);
      }
    }
  }

  private loadGlbModel(): Promise<void> {
    const isBrowserEnvironment = typeof window !== "undefined" && typeof document !== "undefined";
    if (!isBrowserEnvironment) {
      return Promise.resolve();
    }

    const config = assetManager.getModelConfig("car");
    const rawPath = config?.path ?? "/models/car.glb";
    const modelPath = assetManager.resolveAssetUrl(rawPath);
    const loader = new GLTFLoader();
    return new Promise<void>((resolve) => {
      loader.load(
        modelPath,
        (gltf) => {
          const glbScene = gltf.scene;
          const hasLoadedScene = Boolean(glbScene);
          if (!hasLoadedScene) {
            resolve();
            return;
          }

          const scale = config?.scale ?? [1, 1, 1];
          glbScene.scale.set(scale[0], scale[1], scale[2]);
          const offset = config?.offset ?? [0, 0, 0];
          glbScene.position.set(offset[0], offset[1], offset[2]);

          const wheelMap = new Map<string, THREE.Object3D>();

          glbScene.traverse((child) => {
            const isMesh = (child as THREE.Mesh).isMesh;
            const nodeName = child.name;
            if (isMesh) {
              const mesh = child as THREE.Mesh;
              // Why 車内インテリアとルームミラーの castShadow を無効化するか:
              // ルーフ天板のセルフシャドウと車内パーツ自身の影が重なってコックピットが黒潰れするのを防ぎ、
              // 車内キャビンライト (cabinOverheadLight / cabinAmbientLight) で3D杢目・本革シボを上品に照らすため。
              const isInteriorOrMirrorMesh =
                nodeName === "Interior" || nodeName === "RearviewMirror";
              mesh.castShadow = !isInteriorOrMirrorMesh;
              mesh.receiveShadow = true;

              const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
              for (const mat of materials) {
                const isStandardMat = Boolean(
                  mat && (mat as THREE.MeshStandardMaterial).isMeshStandardMaterial,
                );
                if (isStandardMat) {
                  const stdMat = mat as THREE.MeshStandardMaterial;
                  const matName = stdMat.name || "";
                  const isCrownWood = matName.includes("CrownWoodTrim");
                  const isInteriorSeat = matName.includes("InteriorSeat");
                  const isAlcantara =
                    matName.includes("AlcantaraTrim") || matName.includes("Ultrasuede");
                  const isInteriorLeather =
                    matName.includes("InteriorDark") ||
                    matName.includes("SteeringLeather") ||
                    matName.includes("SaddleStitch");
                  const isInteriorChrome =
                    (nodeName === "Interior" || nodeName === "SteeringWheel") &&
                    matName.includes("Chrome");
                  const isSatinSilver = matName.includes("SilverTrim") || isInteriorChrome;
                  const isBodyPaint = matName.includes("BodyPaint");
                  const isPianoBlack =
                    matName.includes("BlackTrim") || matName.includes("WiperBlack");
                  const isTireRubber = matName.includes("TireRubber");
                  const isWheelAlloy =
                    matName.includes("WheelAlloy") ||
                    (matName.includes("Chrome") && !isInteriorChrome);
                  const isBrakeRotor =
                    matName.includes("BrakeRotor") || matName.includes("BrakeCaliper");

                  // Why Blender の glTF 出力マテリアルに明示的なベースカラーを再設定するか:
                  // Blender 側で ShaderNodeTexWave / ShaderNodeTexNoise 等のプロシージャル 3D ノードを Base Color に接続すると、
                  // glTF 2.0 エクスポータは非 ImageTexture ノードを変換できず baseColorFactor = [1.0, 1.0, 1.0, 1.0]（純白）にフォールバックする。
                  // そのまま diffuseColor.rgb *= mix(...) で3Dシボやパンチング陰影を乗算すると内装全体が白飛びするため、
                  // トヨタ クラウン セダン本来のブラック・ダークチャコール本革およびウォルナット杢目のベースカラーを明示設定する。
                  if (isCrownWood) {
                    stdMat.color.setHex(0x3d2214);
                    this.applyCrownInterior3DTexture(stdMat, "wood");
                  } else if (isInteriorSeat) {
                    stdMat.color.setHex(0x1c2029);
                    this.applyCrownInterior3DTexture(stdMat, "perforated");
                  } else if (isAlcantara) {
                    stdMat.color.setHex(0x181b22);
                    this.applyCrownInterior3DTexture(stdMat, "alcantara");
                  } else if (isInteriorLeather) {
                    stdMat.color.setHex(0x161920);
                    this.applyCrownInterior3DTexture(stdMat, "leather");
                  } else if (isSatinSilver) {
                    stdMat.color.setHex(0x94a3b8);
                    this.applyCrownInterior3DTexture(stdMat, "satin");
                  } else if (isBodyPaint) {
                    this.applyVehicleExterior3DTexture(stdMat, "body_mica");
                  } else if (isPianoBlack) {
                    stdMat.color.setHex(0x0b0e14);
                    this.applyVehicleExterior3DTexture(stdMat, "piano_black");
                  } else if (isTireRubber) {
                    stdMat.color.setHex(0x14171c);
                    this.applyVehicleExterior3DTexture(stdMat, "tire_rubber");
                  } else if (isWheelAlloy) {
                    this.applyVehicleExterior3DTexture(stdMat, "wheel_alloy");
                  } else if (isBrakeRotor) {
                    this.applyVehicleExterior3DTexture(stdMat, "brake_rotor");
                  }
                }
              }
            }

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
              this.windshieldMesh.userData.permanentlyHiddenByGlb = true;
              return;
            }

            const isGlbSideWindows = nodeName === "SideWindows";
            if (isGlbSideWindows) {
              const glbSideMesh = child as THREE.Mesh;
              this.normalizeSideWindowGeometryUVs(glbSideMesh.geometry);
              glbSideMesh.material = this.sideWindowMaterial;
              child.castShadow = false;
              child.receiveShadow = false;
              this.sideWindowsMesh.visible = false;
              this.sideWindowsMesh.userData.permanentlyHiddenByGlb = true;
              return;
            }

            const isGlbRearWindow = nodeName === "RearWindow";
            if (isGlbRearWindow) {
              const glbRearMesh = child as THREE.Mesh;
              this.normalizeWindshieldGeometryUVs(glbRearMesh.geometry);
              glbRearMesh.material = this.rearWindowMaterial;
              child.castShadow = false;
              child.receiveShadow = false;
              this.rearWindowMesh.visible = false;
              this.rearWindowMesh.userData.permanentlyHiddenByGlb = true;
              return;
            }

            const isRearviewMirrorGlass = nodeName === "RearviewMirrorGlass";
            if (isRearviewMirrorGlass) {
              const mirrorMesh = child as THREE.Mesh;
              mirrorMesh.material = this.rearviewMirrorMaterial;
              child.castShadow = false;
              child.receiveShadow = false;
              return;
            }

            const isRightSideMirrorGlass = nodeName === "SideMirrorGlass_R";
            if (isRightSideMirrorGlass) {
              const mirrorMesh = child as THREE.Mesh;
              mirrorMesh.material = this.sideMirrorRightMaterial;
              child.castShadow = false;
              child.receiveShadow = false;
              return;
            }

            const isLeftSideMirrorGlass = nodeName === "SideMirrorGlass_L";
            if (isLeftSideMirrorGlass) {
              const mirrorMesh = child as THREE.Mesh;
              mirrorMesh.material = this.sideMirrorLeftMaterial;
              child.castShadow = false;
              child.receiveShadow = false;
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
              child.userData.permanentlyHiddenByGlb = true;
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
          this.proceduralBodyGroup.userData.permanentlyHiddenByGlb = true;
          resolve();
        },
        undefined,
        (error) => {
          console.warn("Notice: Using procedural Car model (GLB load skipped):", error);
          resolve();
        },
      );
    });
  }

  private createCarBody(): THREE.Group {
    const group = new THREE.Group();

    // トヨタ クラウン セダン（AZSH32 / KZSM30）象徴カラー「プレシャスメタル (1L5)」
    const bodyMaterial = new THREE.MeshPhysicalMaterial({
      name: "BodyPaint",
      color: 0x9ca3af,
      metalness: 0.88,
      roughness: 0.16,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
    });
    this.applyVehicleExterior3DTexture(bodyMaterial, "body_mica");

    const blackTrimMaterial = new THREE.MeshStandardMaterial({
      name: "BlackTrim",
      color: 0x111827,
      roughness: 0.45,
      metalness: 0.25,
    });
    this.applyVehicleExterior3DTexture(blackTrimMaterial, "piano_black");

    const chromeMaterial = new THREE.MeshStandardMaterial({
      name: "Chrome",
      color: 0xf3f4f6,
      metalness: 0.96,
      roughness: 0.08,
    });
    this.applyVehicleExterior3DTexture(chromeMaterial, "wheel_alloy");

    const tailLightMaterial = new THREE.MeshStandardMaterial({
      color: 0xdc2626,
      emissive: 0xff1122,
      emissiveIntensity: 3.4,
      roughness: 0.15,
    });

    // メインロアボディ（キャビン内部を中空バスタブ化して車内下半分の埋没を防ぐため、フロントノーズ・リアトランク・アンダーフロア・左右ドアパネルに分割）
    const frontHoodGeo = new THREE.BoxGeometry(1.86, 0.48, 1.34);
    const frontHood = new THREE.Mesh(frontHoodGeo, bodyMaterial);
    frontHood.position.set(0, 0.5, 1.57);
    frontHood.castShadow = true;
    frontHood.receiveShadow = true;
    group.add(frontHood);

    const rearTrunkGeo = new THREE.BoxGeometry(1.86, 0.52, 0.89);
    const rearTrunk = new THREE.Mesh(rearTrunkGeo, bodyMaterial);
    rearTrunk.position.set(0, 0.52, -1.795);
    rearTrunk.castShadow = true;
    rearTrunk.receiveShadow = true;
    group.add(rearTrunk);

    const underFloorPanGeo = new THREE.BoxGeometry(1.78, 0.14, 2.25);
    const underFloorPan = new THREE.Mesh(underFloorPanGeo, bodyMaterial);
    underFloorPan.position.set(0, 0.28, -0.225);
    underFloorPan.castShadow = true;
    underFloorPan.receiveShadow = true;
    group.add(underFloorPan);

    const sideDoorGeo = new THREE.BoxGeometry(0.14, 0.58, 2.25);
    for (const side of [-1, 1]) {
      const sideDoor = new THREE.Mesh(sideDoorGeo, bodyMaterial);
      sideDoor.position.set(side * 0.84, 0.55, -0.225);
      sideDoor.castShadow = true;
      sideDoor.receiveShadow = true;
      group.add(sideDoor);
    }

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

    // クラウン セダン アンダープライオリティ台形グリル & 垂直メッキバー
    const grillGeo = new THREE.BoxGeometry(1.36, 0.28, 0.08);
    const grill = new THREE.Mesh(grillGeo, blackTrimMaterial);
    grill.position.set(0, 0.38, 2.22);
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

    for (const plateZ of [2.25, -2.23]) {
      const plateGroup = new THREE.Group();
      plateGroup.position.set(0, 0.36, plateZ);
      plateGroup.add(new THREE.Mesh(plateFrameGeo, blackTrimMaterial));
      plateGroup.add(new THREE.Mesh(plateBaseGeo, plateWhiteMat));
      const stripeMesh = new THREE.Mesh(plateCharStripeGeo, plateGreenMat);
      stripeMesh.position.set(0, -0.02, 0);
      plateGroup.add(stripeMesh);
      group.add(plateGroup);
    }

    // トヨタ クラウン セダン 横一文字LEDテールランプバー & ロア水平クロームガーニッシュ
    const tailBarGeo = new THREE.BoxGeometry(1.66, 0.042, 0.05);
    const tailBar = new THREE.Mesh(tailBarGeo, tailLightMaterial);
    tailBar.position.set(0, 0.78, -2.22);
    group.add(tailBar);

    const diffuserGeo = new THREE.BoxGeometry(1.68, 0.14, 0.12);
    const diffuser = new THREE.Mesh(diffuserGeo, blackTrimMaterial);
    diffuser.position.set(0, 0.28, -2.19);
    group.add(diffuser);

    const rearChromeStripGeo = new THREE.BoxGeometry(1.56, 0.024, 0.04);
    const rearChromeStrip = new THREE.Mesh(rearChromeStripGeo, chromeMaterial);
    rearChromeStrip.position.set(0, 0.29, -2.24);
    group.add(rearChromeStrip);

    // ホイール4輪（実寸 245/40R19: 外径 680mm = 半径 0.34m、タイヤ幅 0.245m、19インチリム半径 0.24m）
    const tireMaterial = new THREE.MeshStandardMaterial({
      name: "TireRubber",
      color: 0x18181b,
      roughness: 0.88,
    });
    this.applyVehicleExterior3DTexture(tireMaterial, "tire_rubber");

    const rimMaterial = new THREE.MeshStandardMaterial({
      name: "WheelAlloy",
      color: 0xe5e7eb,
      metalness: 0.94,
      roughness: 0.18,
    });
    this.applyVehicleExterior3DTexture(rimMaterial, "wheel_alloy");

    const brakeRotorMaterial = new THREE.MeshStandardMaterial({
      name: "BrakeRotor",
      color: 0x8c929c,
      metalness: 0.72,
      roughness: 0.28,
    });
    this.applyVehicleExterior3DTexture(brakeRotorMaterial, "brake_rotor");

    const wheelPositions = [
      new THREE.Vector3(-0.84, 0.34, 1.39), // 前右 (右ハンドル運転席側)
      new THREE.Vector3(0.84, 0.34, 1.39), // 前左 (助手席側)
      new THREE.Vector3(-0.84, 0.34, -1.39), // 後右
      new THREE.Vector3(0.84, 0.34, -1.39), // 後左
    ];

    for (let i = 0; i < wheelPositions.length; i++) {
      const pos = wheelPositions[i];
      const wheelMesh = this.createWheel(pos, tireMaterial, rimMaterial, brakeRotorMaterial);

      group.add(wheelMesh);
      this.wheels.push(wheelMesh);
      this.wheelBasePositions.push(pos.clone());
    }

    return group;
  }

  /**
   * プロシージャルホイール（タイヤ加硫ゴム・大径切削アルミホイール・ベンチレーテッドブレーキローター）を生成する
   */
  private createWheel(
    position: THREE.Vector3,
    tireMaterial: THREE.MeshStandardMaterial,
    rimMaterial: THREE.MeshStandardMaterial,
    brakeRotorMaterial: THREE.MeshStandardMaterial,
  ): THREE.Mesh {
    const wheelRadius = 0.34;
    const wheelWidth = 0.245;
    const wheelGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, 32);
    wheelGeo.rotateZ(Math.PI / 2);

    const wheelMesh = new THREE.Mesh(wheelGeo, tireMaterial);
    wheelMesh.position.copy(position);
    wheelMesh.castShadow = true;

    const rimGeo = new THREE.CylinderGeometry(0.24, 0.24, wheelWidth + 0.015, 24);
    rimGeo.rotateZ(Math.PI / 2);
    const rimMesh = new THREE.Mesh(rimGeo, rimMaterial);
    wheelMesh.add(rimMesh);

    const rotorGeo = new THREE.CylinderGeometry(0.185, 0.185, 0.032, 24);
    rotorGeo.rotateZ(Math.PI / 2);
    const rotorMesh = new THREE.Mesh(rotorGeo, brakeRotorMaterial);
    wheelMesh.add(rotorMesh);

    return wheelMesh;
  }

  private createInterior(): THREE.Group {
    const group = new THREE.Group();

    const dashMaterial = new THREE.MeshStandardMaterial({
      name: "InteriorDark",
      color: 0x1c1e24,
      roughness: 0.62,
      metalness: 0.08,
    });
    this.applyCrownInterior3DTexture(dashMaterial, "leather");

    const alcantaraMaterial = new THREE.MeshStandardMaterial({
      name: "AlcantaraTrim",
      color: 0x1e222b,
      roughness: 0.88,
      metalness: 0.02,
    });
    this.applyCrownInterior3DTexture(alcantaraMaterial, "alcantara");

    const saddleStitchMaterial = new THREE.MeshStandardMaterial({
      name: "SaddleStitch",
      color: 0xc27d44,
      roughness: 0.52,
      metalness: 0.14,
    });
    this.applyCrownInterior3DTexture(saddleStitchMaterial, "leather");

    const crownWoodMaterial = new THREE.MeshStandardMaterial({
      name: "CrownWoodTrim",
      color: 0x4b2c1b,
      roughness: 0.28,
      metalness: 0.08,
    });
    this.applyCrownInterior3DTexture(crownWoodMaterial, "wood");

    const ambientLedMat = new THREE.MeshStandardMaterial({
      name: "AmbientStripLED",
      color: 0xffdf9e,
      emissive: 0xffb84d,
      emissiveIntensity: 2.4,
      roughness: 0.2,
    });

    const chromeBezelMat = new THREE.MeshStandardMaterial({
      name: "SilverTrim",
      color: 0xd4d4d8,
      metalness: 0.88,
      roughness: 0.22,
    });
    this.applyCrownInterior3DTexture(chromeBezelMat, "satin");

    // ダッシュボード（上端 y=0.86 に抑え、y=1.13 のドライバー視点カメラからメーターとフロントガラス下部が広く見える配置）
    const dashGeo = new THREE.BoxGeometry(1.48, 0.24, 0.48);
    const dash = new THREE.Mesh(dashGeo, dashMaterial);
    dash.position.set(0, 0.74, 0.68);
    group.add(dash);

    // ダッシュボード前端のサドルタン本革ダブルステッチライン
    const dashStitchGeo = new THREE.BoxGeometry(1.44, 0.004, 0.004);
    const dashStitch = new THREE.Mesh(dashStitchGeo, saddleStitchMaterial);
    dashStitch.position.set(0, 0.862, 0.538);
    group.add(dashStitch);

    // クラウン セダン「アイランドアーキテクチャー」大型3D杢目調パネル（ウッディブラウン）＆64色アンビエントLED
    const woodPanelGeo = new THREE.BoxGeometry(1.44, 0.068, 0.05);
    const woodPanel = new THREE.Mesh(woodPanelGeo, crownWoodMaterial);
    woodPanel.position.set(0, 0.84, 0.56);
    group.add(woodPanel);

    const ambientStripGeo = new THREE.BoxGeometry(1.44, 0.008, 0.054);
    const ambientStrip = new THREE.Mesh(ambientStripGeo, ambientLedMat);
    ambientStrip.position.set(0, 0.802, 0.558);
    group.add(ambientStrip);

    // 左右Aピラーのウルトラスエード（アルカンターラ調）内張りトリム
    const pillarLinerGeo = new THREE.BoxGeometry(0.044, 0.56, 0.054);
    for (const side of [-1, 1]) {
      const liner = new THREE.Mesh(pillarLinerGeo, alcantaraMaterial);
      liner.position.set(side * 0.685, 1.11, 0.73);
      liner.rotation.x = 0.52;
      group.add(liner);
    }

    // 運転席メーターフード（右ハンドル x = -0.38m）＋サドルタンステッチ縁取り
    const hoodGeo = new THREE.BoxGeometry(0.36, 0.095, 0.24);
    const hood = new THREE.Mesh(hoodGeo, dashMaterial);
    hood.position.set(-0.38, 0.91, 0.66);
    group.add(hood);

    const hoodStitchGeo = new THREE.BoxGeometry(0.362, 0.004, 0.004);
    const hoodStitch = new THREE.Mesh(hoodStitchGeo, saddleStitchMaterial);
    hoodStitch.position.set(-0.38, 0.958, 0.542);
    group.add(hoodStitch);

    // センターコンソール（3D杢目トップパネル＆サドルタンステッチ付き）
    const consoleGeo = new THREE.BoxGeometry(0.3, 0.28, 1.0);
    const consoleMesh = new THREE.Mesh(consoleGeo, dashMaterial);
    consoleMesh.position.set(0, 0.56, 0.0);
    group.add(consoleMesh);

    const consoleWoodGeo = new THREE.BoxGeometry(0.28, 0.025, 0.68);
    const consoleWood = new THREE.Mesh(consoleWoodGeo, crownWoodMaterial);
    consoleWood.position.set(0, 0.71, 0.14);
    group.add(consoleWood);

    for (const side of [-1, 1]) {
      const consoleStitchGeo = new THREE.BoxGeometry(0.004, 0.004, 0.72);
      const consoleStitch = new THREE.Mesh(consoleStitchGeo, saddleStitchMaterial);
      consoleStitch.position.set(side * 0.146, 0.704, 0.12);
      group.add(consoleStitch);
    }

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

    // キャビンフロア＆右ハンドル運転席フロアマット＆アルミスポーツペダル（オルガン式アクセル・ブレーキ・フットレスト）
    const floorGeo = new THREE.BoxGeometry(1.56, 0.06, 2.25);
    const floorMesh = new THREE.Mesh(floorGeo, dashMaterial);
    floorMesh.position.set(0, 0.36, -0.225);
    group.add(floorMesh);

    const floorMatGeo = new THREE.BoxGeometry(0.46, 0.01, 0.56);
    const floorMatMesh = new THREE.Mesh(floorMatGeo, alcantaraMaterial);
    floorMatMesh.position.set(-0.4, 0.398, 0.36);
    group.add(floorMatMesh);

    const kneeBolsterGeo = new THREE.BoxGeometry(0.52, 0.22, 0.14);
    const driverKneeBolster = new THREE.Mesh(kneeBolsterGeo, dashMaterial);
    driverKneeBolster.position.set(-0.44, 0.67, 0.66);
    group.add(driverKneeBolster);

    const accelPedalGeo = new THREE.BoxGeometry(0.046, 0.16, 0.014);
    const accelPedal = new THREE.Mesh(accelPedalGeo, chromeBezelMat);
    accelPedal.position.set(-0.25, 0.48, 0.77);
    accelPedal.rotation.x = 0.52;
    group.add(accelPedal);

    const brakePedalGeo = new THREE.BoxGeometry(0.092, 0.056, 0.018);
    const brakePedal = new THREE.Mesh(brakePedalGeo, chromeBezelMat);
    brakePedal.position.set(-0.38, 0.485, 0.72);
    brakePedal.rotation.x = 0.38;
    group.add(brakePedal);

    const deadPedalGeo = new THREE.BoxGeometry(0.068, 0.16, 0.014);
    const deadPedal = new THREE.Mesh(deadPedalGeo, chromeBezelMat);
    deadPedal.position.set(-0.53, 0.475, 0.77);
    deadPedal.rotation.x = 0.56;
    group.add(deadPedal);

    // 運転席・助手席シート（カメラ z=0.06 より後方 z=-0.42 に配置し、前方視界の遮蔽を防止）
    const seatMaterial = new THREE.MeshStandardMaterial({
      name: "InteriorSeat",
      color: 0x27272a,
      roughness: 0.68,
    });
    this.applyCrownInterior3DTexture(seatMaterial, "perforated");
    const seatGeo = new THREE.BoxGeometry(0.48, 0.48, 0.16);
    const seatCushionGeo = new THREE.BoxGeometry(0.5, 0.14, 0.52);

    const driverSeat = new THREE.Mesh(seatGeo, seatMaterial);
    driverSeat.position.set(-0.38, 0.7, -0.42);
    group.add(driverSeat);

    const driverCushion = new THREE.Mesh(seatCushionGeo, seatMaterial);
    driverCushion.position.set(-0.38, 0.44, -0.18);
    group.add(driverCushion);

    const passSeat = new THREE.Mesh(seatGeo, seatMaterial);
    passSeat.position.set(0.38, 0.7, -0.42);
    group.add(passSeat);

    const passCushion = new THREE.Mesh(seatCushionGeo, seatMaterial);
    passCushion.position.set(0.38, 0.44, -0.18);
    group.add(passCushion);

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
    columnGroup.name = "SteeringColumnAssembly";
    // ステアリングホイール (-0.38, 0.888, 0.440, rotation.x = 0.35) の傾斜シャフト軸と 1mm 単位で同軸配置:
    // z = 0.440 + 0.055 * cos(0.35) = 0.4917m, y = 0.888 - 0.055 * sin(0.35) = 0.8691m
    columnGroup.position.set(-0.38, 0.869, 0.492);
    columnGroup.rotation.x = 0.35;

    const columnMat = new THREE.MeshStandardMaterial({
      name: "SteeringColumnLeather",
      color: 0x161922,
      roughness: 0.56,
      metalness: 0.14,
    });
    this.applyCrownInterior3DTexture(columnMat, "leather");

    const stalkTipMat = new THREE.MeshStandardMaterial({
      name: "StalkTipSatin",
      color: 0x27272a,
      roughness: 0.38,
      metalness: 0.35,
    });
    this.applyCrownInterior3DTexture(stalkTipMat, "satin");

    const indicatorMarkMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.25,
      roughness: 0.3,
    });

    // ステアリングコラムシュラウド（カバー: 手前 z=-0.044m でホーンパッド背面に密着し、奥 z=+0.116m でインパネコラムブーツに 0.0mm ギャップで貫入）
    const shroudGeo = new THREE.CylinderGeometry(0.046, 0.054, 0.16, 20);
    shroudGeo.rotateX(Math.PI / 2);
    const shroud = new THREE.Mesh(shroudGeo, columnMat);
    shroud.position.set(0, 0, 0.036);
    columnGroup.add(shroud);

    // 1. 日本車（JIS規格）右ウインカーレバー（右側 -X 方向へ伸びる）
    const rightTurnStalkGroup = new THREE.Group();
    rightTurnStalkGroup.name = "TurnSignalStalk_R";
    rightTurnStalkGroup.position.set(-0.038, 0.008, 0.01);
    rightTurnStalkGroup.rotation.z = CarModel.STALK_NEUTRAL_ROT_Z;
    rightTurnStalkGroup.rotation.y = -0.12;
    this.turnSignalStalkGroup = rightTurnStalkGroup;

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
   * トヨタ クラウン セダン (AZSH32) 右ハンドル運転席 12.3インチ フルTFTカラー液晶＋立体2眼リングデジタルメータークラスターを構築
   * - 右ハンドル運転席正面 (x = -0.38m, y = 0.935m, z = 0.625m) に配置し、GLBロード時・プロシージャル時の双方で常時表示・動作する
   * - 右リング (ローカル x = -0.075m): ハイブリッドパワー＆エンジン回転数タコメーター（CHG - ECO - PWR / 0〜7000 rpm）＋ 3D発光指針 (`tachNeedleGroup`)
   * - 左リング (ローカル x = +0.075m): 0〜180 km/h スピードメーター ＋ 3D発光指針 (`speedNeedleGroup`)
   * - 中央マルチインフォメーションディスプレイ (MID): 大型デジタル車速、シフトポジション (P/R/N/D)、ADASレーン・操舵角Gボール、ODO/TRIP距離計、各種インジケーターランプを CanvasTexture でリアルタイム描画
   */
  private createInstrumentClusterAssembly(): THREE.Group {
    const clusterGroup = new THREE.Group();
    clusterGroup.name = "InstrumentClusterGroup";
    // GLB のメータークラスター (y=0.948, z=0.635〜0.652) のすぐ手前に配置し、ステアリングリム上部開口からケラレなく視認できる位置
    clusterGroup.position.set(-0.38, 0.948, 0.625);

    const bezelDarkMat = new THREE.MeshStandardMaterial({
      name: "ClusterBezelAlcantara",
      color: 0x0d111a,
      roughness: 0.78,
      metalness: 0.12,
    });
    this.applyCrownInterior3DTexture(bezelDarkMat, "alcantara");
    const satinChromeMat = new THREE.MeshStandardMaterial({
      name: "SilverTrim",
      color: 0xe2e8f0,
      roughness: 0.18,
      metalness: 0.92,
    });
    this.applyCrownInterior3DTexture(satinChromeMat, "satin");

    const cyanAccentMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      toneMapped: false,
    });
    const needleRedMat = new THREE.MeshBasicMaterial({
      color: 0xf43f5e,
      toneMapped: false,
    });
    const needleCyanMat = new THREE.MeshBasicMaterial({
      color: 0xe0f2fe,
      toneMapped: false,
    });

    // 1. メータークラスター背面遮光バックプレート（GLBの静的針・リングを完全に覆い隠す）
    const backPlateGeo = new THREE.BoxGeometry(0.32, 0.114, 0.012);
    const backPlate = new THREE.Mesh(backPlateGeo, bezelDarkMat);
    backPlate.position.set(0, 0, 0.008);
    clusterGroup.add(backPlate);

    // 2. 高解像度 12.3インチ フルTFTメーター液晶画面 (CanvasTexture 768x256)
    let screenMat: THREE.MeshBasicMaterial;
    const isBrowserCanvasAvailable =
      typeof document !== "undefined" && typeof HTMLCanvasElement !== "undefined";
    if (isBrowserCanvasAvailable) {
      const canvas = document.createElement("canvas");
      canvas.width = 768;
      canvas.height = 256;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        this.clusterCanvas = canvas;
        this.clusterContext = ctx;
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.generateMipmaps = false;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        this.clusterTexture = tex;
        this.renderInstrumentClusterDisplay(
          {
            position: { x: 3.5, y: 0.8, z: 26 },
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
          },
          0,
        );
        screenMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
      } else {
        screenMat = new THREE.MeshBasicMaterial({ color: 0x091526 });
      }
    } else {
      screenMat = new THREE.MeshBasicMaterial({ color: 0x091526 });
    }

    const screenGeo = new THREE.PlaneGeometry(0.308, 0.104);
    // ドライバー視点 (-Z 側) から +Z 方向を見るため、Y軸に 180度回転させて表面を運転席へ向ける
    screenGeo.rotateY(Math.PI);
    const screenMesh = new THREE.Mesh(screenGeo, screenMat);
    screenMesh.name = "InstrumentClusterScreen";
    screenMesh.position.set(0, 0, 0.001);
    clusterGroup.add(screenMesh);

    // 3. 左右2連 立体サテンシルバーメーターリング & 3D物理発光指針
    // 右側 (gx = -0.075m = Canvas x=572px): スピードメーター (0〜180 km/h)
    // 左側 (gx = +0.075m = Canvas x=196px): タコメーター / ハイブリッドパワーメーター (0〜7000 rpm)
    const outerRingGeo = new THREE.TorusGeometry(0.043, 0.0034, 14, 36);
    const innerGlowRingGeo = new THREE.TorusGeometry(0.0385, 0.0012, 10, 36);
    const hubCapGeo = new THREE.CylinderGeometry(0.0068, 0.0078, 0.006, 18);
    hubCapGeo.rotateX(Math.PI / 2);

    const createNeedlePivot = (isSpeedometer: boolean): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.name = isSpeedometer ? "SpeedometerNeedlePivot" : "TachometerNeedlePivot";

      // 指針ブレード（中心から +Y 方向へ長さ 0.035m 伸びるテーパー発光針）
      const bladeGeo = new THREE.BoxGeometry(0.0026, 0.032, 0.0022);
      bladeGeo.translate(0, 0.015, 0);
      const bladeMesh = new THREE.Mesh(bladeGeo, needleRedMat);
      pivot.add(bladeMesh);

      // 指針先端のホワイトシアン発光チップ
      const tipGeo = new THREE.BoxGeometry(0.0018, 0.009, 0.0026);
      tipGeo.translate(0, 0.031, -0.0004);
      const tipMesh = new THREE.Mesh(tipGeo, needleCyanMat);
      pivot.add(tipMesh);

      return pivot;
    };

    const gaugeOffsets = [-0.075, 0.075];
    for (let idx = 0; idx < gaugeOffsets.length; idx++) {
      const gx = gaugeOffsets[idx];
      const outerRing = new THREE.Mesh(outerRingGeo, satinChromeMat);
      outerRing.position.set(gx, 0, -0.002);
      clusterGroup.add(outerRing);

      const innerRing = new THREE.Mesh(innerGlowRingGeo, cyanAccentMat);
      innerRing.position.set(gx, 0, -0.001);
      clusterGroup.add(innerRing);

      const hubCap = new THREE.Mesh(hubCapGeo, satinChromeMat);
      hubCap.position.set(gx, 0, -0.004);
      clusterGroup.add(hubCap);

      // idx = 0 (gx = -0.075m = 運転席から見て右側: Canvas u=0.744 x=572px): スピードメーター (0〜180 km/h)
      // idx = 1 (gx = +0.075m = 運転席から見て左側: Canvas u=0.256 x=196px): タコメーター / ハイブリッドパワーメーター (0〜7000 rpm)
      const isSpeed = idx === 0;
      const needlePivot = createNeedlePivot(isSpeed);
      needlePivot.position.set(gx, 0, -0.0035);
      // 車両ローカル座標（+Z前方・+Y上・+X左・-X右）において、運転席（z=0.06m）から +Z 方向のメーター（z=0.625m）を見たとき:
      // 視点から向こう側へ +Z 軸が伸びているため、+Z まわりの正回転（右手系）は画面上で時計回りとなる。
      // +Y（12時方向 = 0 rad）の針を Z軸まわりに θ 回転させると、
      // 左下7時半のゼロ目盛り（x' > 0 左側, y' < 0 下側）は θ = -135° (-3π/4 rad ≈ -2.3562 rad) であり、
      // そこから時計回り（12時 θ = 0 → 右下4時半 θ = +3π/4 rad）へ増加させることで 2D Canvas 目盛り（startDeg=135°, sweepDeg=270°）と 1:1 一致する。
      // Why not +2.18 rad から減算: +Z がカメラ奥向きのため、θ > 0 は右側（160〜180km/h側）を指してしまい、停車中に100km/h超を指す不具合になるため。
      const zeroAngleRad = -(3 * Math.PI) / 4;
      const fullSweepRad = (3 * Math.PI) / 2;
      needlePivot.rotation.z = isSpeed ? zeroAngleRad : zeroAngleRad + (780 / 7000) * fullSweepRad;
      clusterGroup.add(needlePivot);

      if (isSpeed) {
        this.speedNeedleGroup = needlePivot;
      } else {
        this.tachNeedleGroup = needlePivot;
      }
    }

    return clusterGroup;
  }

  /**
   * センターコンソールのエレクトロシフトマチック（電子シフトレバー）の可動ノブ＆シフトポジションLEDインジケーターを構築
   * - 前進 (D)、後退 (R)、ニュートラル/停止時に応じてシフトノブの前後チルト角とLEDインジケーターが連動する
   */
  private createElectroShifterAssembly(): THREE.Group {
    const shifterGroup = new THREE.Group();
    shifterGroup.name = "ElectroShifterGroup";
    // GLB センターコンソールのシフトベース (x = -0.055m, y = 0.706m, z = 0.28m) に配置
    shifterGroup.position.set(-0.055, 0.71, 0.28);

    const leatherMat = new THREE.MeshStandardMaterial({
      name: "InteriorSeat",
      color: 0x1e2330,
      roughness: 0.44,
      metalness: 0.14,
    });
    this.applyCrownInterior3DTexture(leatherMat, "leather");

    const perforatedGripMat = new THREE.MeshStandardMaterial({
      name: "ShifterPerforatedLeather",
      color: 0x222736,
      roughness: 0.52,
      metalness: 0.1,
    });
    this.applyCrownInterior3DTexture(perforatedGripMat, "perforated");

    const chromeMat = new THREE.MeshStandardMaterial({
      name: "SilverTrim",
      color: 0xe2e8f0,
      roughness: 0.18,
      metalness: 0.92,
    });
    this.applyCrownInterior3DTexture(chromeMat, "satin");

    const shiftGateLedMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 1.6,
      roughness: 0.2,
    });

    // シフトゲートベゼル（サテンシルバー枠＋LEDシフトパターンインジケーター）
    const gateBezelGeo = new THREE.BoxGeometry(0.064, 0.006, 0.092);
    const gateBezel = new THREE.Mesh(gateBezelGeo, chromeMat);
    gateBezel.position.set(0, 0.002, 0);
    shifterGroup.add(gateBezel);

    const gateIndicatorGeo = new THREE.BoxGeometry(0.008, 0.007, 0.068);
    const gateIndicator = new THREE.Mesh(gateIndicatorGeo, shiftGateLedMat);
    gateIndicator.position.set(-0.022, 0.003, 0);
    shifterGroup.add(gateIndicator);

    const knobGroup = new THREE.Group();
    const stalkGeo = new THREE.BoxGeometry(0.034, 0.048, 0.044);
    stalkGeo.translate(0, 0.024, 0);
    const stalkMesh = new THREE.Mesh(stalkGeo, leatherMat);
    knobGroup.add(stalkMesh);

    const headGeo = new THREE.BoxGeometry(0.048, 0.024, 0.064);
    headGeo.translate(0, 0.054, 0);
    const headMesh = new THREE.Mesh(headGeo, perforatedGripMat);
    this.shifterKnobMesh = headMesh;
    knobGroup.add(headMesh);

    const trimGeo = new THREE.BoxGeometry(0.044, 0.006, 0.026);
    trimGeo.translate(0, 0.067, 0.008);
    const trimMesh = new THREE.Mesh(trimGeo, chromeMat);
    knobGroup.add(trimMesh);

    shifterGroup.add(knobGroup);
    return shifterGroup;
  }

  /**
   * 運転席 12.3インチ フルTFTデジタルメータークラスターの CanvasTexture をリアルタイム描画する
   * - 右ゲージ (Canvas 左側 cx = 196): ハイブリッドパワー / タコメーター (CHG / ECO / PWR, 0〜7 x1000 rpm)
   * - 左ゲージ (Canvas 右側 cx = 572): スピードメーター (0〜180 km/h アーク＆目盛り)
   * - 中央 MID (x = 300..468): 大型デジタル車速、シフトポジション (P/R/N/D)、ADASレーン・Gセンサー、ODO/TRIP距離計、各種表示灯
   */
  private renderInstrumentClusterDisplay(state: VehicleState, rainIntensity: number): void {
    const ctx = this.clusterContext;
    const canvas = this.clusterCanvas;
    const tex = this.clusterTexture;
    const isReady = Boolean(ctx && canvas && tex);
    if (!isReady || !ctx || !canvas || !tex) {
      return;
    }

    const w = canvas.width; // 768
    const h = canvas.height; // 256
    const speedKmh = Math.max(0, state.speedKmh);
    const rpm = Math.max(0, this.smoothedRpm);

    // 1. クラウン TFT 液晶ディープミッドナイトグラデーション背景
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, "#040814");
    bgGrad.addColorStop(0.5, "#071022");
    bgGrad.addColorStop(1, "#03060e");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // 2. 上部ステータス＆インジケーターバー（ウインカー、ライト点灯、ワイパー、外気温、時刻）
    ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
    ctx.fillRect(0, 0, w, 30);
    ctx.strokeStyle = "rgba(56, 189, 248, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 30);
    ctx.lineTo(w, 30);
    ctx.stroke();

    // ウインカーインジケーター（Q=左ウインカー / E=右ウインカー / Z=ハザード点灯時は点滅フェーズと完全同期、未操作時は大舵角旋回フォールバック）
    const activeTurnSignal: TurnSignalState =
      this.turnSignalState !== "off" ? this.turnSignalState : (state.turnSignal ?? "off");
    const hasExplicitTurnSignal = activeTurnSignal !== "off";
    const fallbackBlinkOn = Math.floor(performance.now() / 340) % 2 === 0;
    const isTurningLeft = hasExplicitTurnSignal
      ? (activeTurnSignal === "left" || activeTurnSignal === "hazard") && this.turnSignalBlinkOn
      : state.steeringAngle < -0.14 && fallbackBlinkOn;
    const isTurningRight = hasExplicitTurnSignal
      ? (activeTurnSignal === "right" || activeTurnSignal === "hazard") && this.turnSignalBlinkOn
      : state.steeringAngle > 0.14 && fallbackBlinkOn;

    ctx.font = "bold 16px sans-serif";
    ctx.fillStyle = isTurningLeft ? "#22c55e" : "#1e293b";
    ctx.fillText("◀", 240, 21);
    ctx.fillStyle = isTurningRight ? "#22c55e" : "#1e293b";
    ctx.fillText("▶", 512, 21);

    // ヘッドライト・ワイパー・READY インジケーター
    ctx.font = "bold 12px monospace";
    ctx.fillStyle = "#22c55e";
    ctx.fillText("READY", 32, 20);

    ctx.fillStyle = this.headlightsEnabled ? "#38bdf8" : "#475569";
    ctx.fillText(this.headlightsEnabled ? "💡 AUTO-BEAM" : "💡 OFF", 92, 20);

    const isWiperActive = this.wiperMode !== "off" || rainIntensity > 0.3;
    ctx.fillStyle = isWiperActive ? "#38bdf8" : "#475569";
    ctx.fillText(`WIPER:${this.wiperMode.toUpperCase()}`, 645, 20);

    // 中央上部の時刻＆外気温
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "bold 13px monospace";
    ctx.textAlign = "center";
    const tempText = rainIntensity > 0.2 ? "16.5℃" : "19.5℃";
    ctx.fillText(`${this.navClockText}   OUTSIDE ${tempText}`, w * 0.5, 20);

    // 3. 左右2連リングゲージの目盛り・アーク描画
    // Why Y軸180度回転した PlaneGeometry 上での X 座標対応:
    // PlaneGeometry を rotateY(Math.PI) しているため、ローカル +X（運転席から見て左側: gx = +0.075m）は Canvas 左側 (u = 0.256 -> x = 196px: タコメーター)、
    // ローカル -X（運転席から見て右側: gx = -0.075m）は Canvas 右側 (u = 0.744 -> x = 572px: スピードメーター) に正確にマッピングされる。
    const startDeg = 135; // 左下 7時半位置
    const sweepDeg = 270; // 時計回りに 270度スイープして右下 4時半位置 (405度) へ
    const startRad = (startDeg * Math.PI) / 180;
    const endRad = ((startDeg + sweepDeg) * Math.PI) / 180;
    const gaugeCy = 128;
    const gaugeR = 88;

    // 3.1 左側キャンバス (cx = 196): タコメーター / ハイブリッドシステムインジケーター (0〜7 x1000 rpm)
    const tachCx = 196;
    const rpmRatio = THREE.MathUtils.clamp(rpm / 7000, 0, 1);
    const tachCurrentRad = startRad + rpmRatio * (endRad - startRad);

    // ゲージ背景トラック
    ctx.beginPath();
    ctx.arc(tachCx, gaugeCy, gaugeR, startRad, endRad, false);
    ctx.strokeStyle = "rgba(30, 41, 59, 0.9)";
    ctx.lineWidth = 12;
    ctx.stroke();

    // アクティブRPM発光アーク
    const isRedZone = rpm >= 5800;
    ctx.beginPath();
    ctx.arc(tachCx, gaugeCy, gaugeR, startRad, tachCurrentRad, false);
    ctx.strokeStyle = isRedZone ? "#f43f5e" : "#38bdf8";
    ctx.lineWidth = 10;
    ctx.stroke();

    // レッドゾーンアーク (6000〜7000 rpm)
    const redZoneStartRad = startRad + (6 / 7) * (endRad - startRad);
    ctx.beginPath();
    ctx.arc(tachCx, gaugeCy, gaugeR, redZoneStartRad, endRad, false);
    ctx.strokeStyle = "rgba(244, 63, 94, 0.75)";
    ctx.lineWidth = 6;
    ctx.stroke();

    // タコメーター目盛り (0〜7)
    for (let i = 0; i <= 14; i++) {
      const frac = i / 14;
      const ang = startRad + frac * (endRad - startRad);
      const isMajor = i % 2 === 0;
      const rInner = isMajor ? gaugeR - 16 : gaugeR - 10;
      const rOuter = gaugeR - 2;
      ctx.beginPath();
      ctx.moveTo(tachCx + Math.cos(ang) * rInner, gaugeCy + Math.sin(ang) * rInner);
      ctx.lineTo(tachCx + Math.cos(ang) * rOuter, gaugeCy + Math.sin(ang) * rOuter);
      ctx.strokeStyle = i >= 12 ? "#f43f5e" : "#cbd5e1";
      ctx.lineWidth = isMajor ? 2.5 : 1.2;
      ctx.stroke();

      if (isMajor) {
        const num = i / 2;
        const rText = gaugeR - 28;
        ctx.fillStyle = num >= 6 ? "#fb7185" : "#e2e8f0";
        ctx.font = "bold 14px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`${num}`, tachCx + Math.cos(ang) * rText, gaugeCy + Math.sin(ang) * rText);
      }
    }

    // タコメーター中央デジタルRPM＆モード表示
    ctx.fillStyle = "#38bdf8";
    ctx.font = "bold 11px sans-serif";
    ctx.fillText("HYBRID / RPM", tachCx, gaugeCy + 34);
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 16px monospace";
    ctx.fillText(`${Math.round(rpm / 50) * 50} rpm`, tachCx, gaugeCy + 52);
    ctx.fillStyle = this.smoothedPowerRatio < -0.05 ? "#34d399" : "#38bdf8";
    ctx.font = "bold 11px sans-serif";
    const hsdLabel =
      this.smoothedPowerRatio < -0.05 ? "CHG (REGEN)" : rpm > 3200 ? "PWR BOOST" : "ECO DRIVE";
    ctx.fillText(hsdLabel, tachCx, gaugeCy + 70);

    // 3.2 右側キャンバス (cx = 572): スピードメーター (0〜180 km/h)
    const speedCx = 572;
    const speedRatio = THREE.MathUtils.clamp(speedKmh / 180, 0, 1);
    const speedCurrentRad = startRad + speedRatio * (endRad - startRad);

    ctx.beginPath();
    ctx.arc(speedCx, gaugeCy, gaugeR, startRad, endRad, false);
    ctx.strokeStyle = "rgba(30, 41, 59, 0.9)";
    ctx.lineWidth = 12;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(speedCx, gaugeCy, gaugeR, startRad, speedCurrentRad, false);
    ctx.strokeStyle = speedKmh > 100 ? "#f59e0b" : "#0ea5e9";
    ctx.lineWidth = 10;
    ctx.stroke();

    // スピードメーター目盛り (0〜180 km/h、20 km/h 刻み)
    for (let spd = 0; spd <= 180; spd += 10) {
      const frac = spd / 180;
      const ang = startRad + frac * (endRad - startRad);
      const isMajor = spd % 20 === 0;
      const rInner = isMajor ? gaugeR - 16 : gaugeR - 10;
      const rOuter = gaugeR - 2;
      ctx.beginPath();
      ctx.moveTo(speedCx + Math.cos(ang) * rInner, gaugeCy + Math.sin(ang) * rInner);
      ctx.lineTo(speedCx + Math.cos(ang) * rOuter, gaugeCy + Math.sin(ang) * rOuter);
      ctx.strokeStyle = spd >= 120 ? "#fbbf24" : "#cbd5e1";
      ctx.lineWidth = isMajor ? 2.5 : 1.2;
      ctx.stroke();

      if (isMajor) {
        const rText = gaugeR - 30;
        ctx.fillStyle = spd >= 120 ? "#fde047" : "#e2e8f0";
        ctx.font = "bold 12px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`${spd}`, speedCx + Math.cos(ang) * rText, gaugeCy + Math.sin(ang) * rText);
      }
    }

    ctx.fillStyle = "#38bdf8";
    ctx.font = "bold 11px sans-serif";
    ctx.fillText("SPEEDOMETER", speedCx, gaugeCy + 34);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "bold 12px monospace";
    ctx.fillText("km/h", speedCx, gaugeCy + 52);

    // 4. 中央マルチインフォメーションディスプレイ (MID: x = 304..464)
    const midCx = w * 0.5; // 384
    ctx.textBaseline = "alphabetic";

    // 大型デジタル車速表示
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 54px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`${Math.round(speedKmh)}`, midCx, 94);
    ctx.fillStyle = "#38bdf8";
    ctx.font = "bold 14px sans-serif";
    ctx.fillText("km/h", midCx, 114);

    // シフトポジションインジケーター (P / R / N / D) + ギア段数
    const gearRaw = state.gear || "D 1";
    const isReverse = gearRaw.startsWith("R");
    const activeShift = isReverse ? "R" : "D";
    const shiftPositions = ["P", "R", "N", "D"];
    const shiftStartX = midCx - 54;
    for (let i = 0; i < shiftPositions.length; i++) {
      const sp = shiftPositions[i];
      const sx = shiftStartX + i * 36;
      const isSelected = sp === activeShift;
      if (isSelected) {
        ctx.fillStyle = isReverse ? "#ef4444" : "#0284c7";
        ctx.fillRect(sx - 13, 124, 26, 24);
      }
      ctx.fillStyle = isSelected ? "#ffffff" : "#64748b";
      ctx.font = isSelected ? "bold 17px monospace" : "bold 14px monospace";
      ctx.fillText(sp, sx, 142);
    }
    ctx.fillStyle = "#fde047";
    ctx.font = "bold 13px monospace";
    ctx.fillText(`[${gearRaw}]`, midCx, 164);

    // ステアリング舵角＆Gセンサーボールインジケーター
    const gBoxY = 182;
    ctx.strokeStyle = "rgba(56, 189, 248, 0.45)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(midCx, gBoxY, 15, 0, Math.PI * 2);
    ctx.stroke();

    const gDotX = midCx - THREE.MathUtils.clamp(state.steeringAngle * 24, -12, 12);
    const gDotY = gBoxY + THREE.MathUtils.clamp(state.pitchAngle * 80, -12, 12);
    ctx.beginPath();
    ctx.arc(gDotX, gDotY, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#38bdf8";
    ctx.fill();

    // 5. 下部オドメーター (ODO) & トリップメーター (TRIP A) & 路面状態バー（ホーンパッド上縁にケラレない y=208..236 に配置）
    ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
    ctx.fillRect(0, h - 46, w, 46);
    ctx.strokeStyle = "rgba(56, 189, 248, 0.4)";
    ctx.beginPath();
    ctx.moveTo(0, h - 46);
    ctx.lineTo(w, h - 46);
    ctx.stroke();

    const totalOdo = Math.floor(this.odometerBaseKm + this.tripDistanceKm);
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 13px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`ODO  ${totalOdo.toLocaleString()} km`, 214, h - 24);

    ctx.textAlign = "center";
    ctx.fillStyle = rainIntensity > 0.2 ? "#38bdf8" : "#34d399";
    ctx.fillText(rainIntensity > 0.2 ? "SURFACE: WET" : "SURFACE: DRY", midCx, h - 24);

    ctx.textAlign = "right";
    ctx.fillStyle = "#f8fafc";
    ctx.fillText(`TRIP A  ${this.tripDistanceKm.toFixed(1)} km`, w - 214, h - 24);

    tex.needsUpdate = true;
  }

  /**
   * 車両状態（車速・エンジンRPM・ギア・操舵角・経過時間）から
   * 運転席メータークラスターの3D指針角度・オド/トリップ距離・電子シフトレバー角度・液晶画面を更新する
   */
  private updateInstrumentCluster(dt: number, state: VehicleState, rainIntensity: number): void {
    const safeDt = Math.max(0, Math.min(dt, 0.25));
    const rawSpeedKmh = Math.max(0, state.speedKmh);

    // 走行距離（km）の積算: v [km/h] * (dt [s] / 3600)
    this.tripDistanceKm += (rawSpeedKmh * safeDt) / 3600;

    // 60fps で滑らかに追従するダンピング補間
    const lerpFactor = Math.min(1.0, safeDt * 14.0 + 0.18);
    const accelKmhPerSec = safeDt > 1e-4 ? (rawSpeedKmh - this.smoothedSpeedKmh) / safeDt : 0;
    this.smoothedSpeedKmh = THREE.MathUtils.lerp(this.smoothedSpeedKmh, rawSpeedKmh, lerpFactor);

    // 物理エンジンの engineRpm が与えられていれば優先し、加減速に応じたハイブリッドパワー/RPM応答を加える
    const baseRpm =
      state.engineRpm && state.engineRpm > 0
        ? state.engineRpm
        : 780 + (rawSpeedKmh % 42) * 85 + Math.min(2200, rawSpeedKmh * 22);
    const targetRpm = THREE.MathUtils.clamp(
      baseRpm + Math.max(-400, Math.min(1200, accelKmhPerSec * 45)),
      750,
      6800,
    );
    this.smoothedRpm = THREE.MathUtils.lerp(this.smoothedRpm, targetRpm, lerpFactor);
    this.smoothedPowerRatio = THREE.MathUtils.clamp(accelKmhPerSec / 25, -1, 1);

    // 3D物理指針の回転角更新
    // 車両ローカル座標（+Z前方・+Y上・+X左・-X右）で運転席（z=0.06m）から +Z 方向のメーター面（z=0.625m）を見るとき、
    // カメラ視線方向に +Z 軸が向いているため、+Z 軸まわりの正回転は運転席から見て時計回りとなる。
    // Why not +2.18 rad から減算: θ > 0 はメーター右側（160〜180 km/h・6500 rpm 側）になるため、停車時に高速側を指してしまう。
    // 左下 7時半のゼロ目盛り = -135° (-3π/4 rad ≈ -2.3562 rad) から時計回り（+方向）へ +270° (3π/2 rad) スイープさせ、
    // 90 km/h で真上 12時 (0 rad)、180 km/h で右下 4時半 (+3π/4 rad) とすることで Canvas 2D 目盛りと 1:1 同期させる。
    const zeroAngleRad = -(3 * Math.PI) / 4;
    const fullSweepRad = (3 * Math.PI) / 2;
    const speedRatio = THREE.MathUtils.clamp(this.smoothedSpeedKmh / 180, 0, 1);
    const rpmRatio = THREE.MathUtils.clamp(this.smoothedRpm / 7000, 0, 1);

    if (this.speedNeedleGroup) {
      this.speedNeedleGroup.rotation.z = zeroAngleRad + speedRatio * fullSweepRad;
    }
    if (this.tachNeedleGroup) {
      this.tachNeedleGroup.rotation.z = zeroAngleRad + rpmRatio * fullSweepRad;
    }

    // センターコンソール電子シフトレバーの前後チルト連動（R: 前方倒し -0.14 rad / D: 後方引き +0.12 rad）
    if (this.electroShifterGroup) {
      const isReverseGear = (state.gear || "").startsWith("R");
      const targetShiftTilt = isReverseGear ? -0.14 : rawSpeedKmh > 0.2 ? 0.12 : 0.04;
      this.electroShifterGroup.rotation.x = THREE.MathUtils.lerp(
        this.electroShifterGroup.rotation.x,
        targetShiftTilt,
        lerpFactor,
      );
    }

    // CanvasTexture の定期再描画（約20fps = 0.05秒間隔）
    this.clusterUpdateElapsed += safeDt;
    const shouldRefreshCluster = this.clusterUpdateElapsed >= 0.05;
    if (shouldRefreshCluster) {
      this.clusterUpdateElapsed = 0;
      this.renderInstrumentClusterDisplay(state, rainIntensity);
    }
  }

  public getTripDistanceKm(): number {
    return this.tripDistanceKm;
  }

  public getSmoothedRpm(): number {
    return this.smoothedRpm;
  }

  /**
   * 車内センターコンソール上部の11インチJDMフローティングカーナビゲーションシステムを構築
   * - 右ハンドル運転席 (x = -0.38m) の左隣 (x = -0.02m, y = 0.935m, z = 0.565m) に配置し、運転席側へ14度チルト
   * - 東京都 Project PLATEAU 千代田区 (13101) 建築物フットプリント & 国土地理院道路中心線 (experimental_rdcl) を
   *   高精細 CanvasTexture でリアルタイム描画（左ペイン：ターンバイターン案内・ETC2.0/VICS・速度制限、右ペイン：ヘディングアップ3Dナビ地図）
   */
  private createCenterNavAssembly(): THREE.Group {
    const navGroup = new THREE.Group();
    // 右ハンドル運転席カメラ (x=-0.38, y=1.13, z=0.06) から画面左端(-0.055m)とメーターフード左端(-0.208m)の間に100%収まり、
    // かつ GLB ダッシュボード天面 (y=0.875) および杢目パネル上端 (y=0.873) に隙間・めり込みなく綺麗に載る位置
    navGroup.position.set(-0.132, 0.955, 0.585);
    // 右ハンドル運転席側 (-X, -Z) へ画面法線を向けるため、Y軸を +0.16 rad (約9.2度)、X軸を +0.05 rad 傾ける
    navGroup.rotation.y = 0.16;
    navGroup.rotation.x = 0.05;

    const bezelDarkMat = new THREE.MeshStandardMaterial({
      name: "CenterNavBezelLeather",
      color: 0x0f172a,
      roughness: 0.42,
      metalness: 0.25,
    });
    this.applyCrownInterior3DTexture(bezelDarkMat, "leather");

    const aluminumTrimMat = new THREE.MeshStandardMaterial({
      name: "SilverTrim",
      color: 0xe2e8f0,
      roughness: 0.2,
      metalness: 0.9,
    });
    this.applyCrownInterior3DTexture(aluminumTrimMat, "satin");

    const hazardMat = new THREE.MeshStandardMaterial({
      color: 0xdc2626,
      emissive: 0xef4444,
      emissiveIntensity: 0.75,
      roughness: 0.25,
    });

    // 1. フローティングディスプレイ背面ハウジング & ダッシュボードマウントステー
    const housingGeo = new THREE.BoxGeometry(0.15, 0.096, 0.022);
    const housing = new THREE.Mesh(housingGeo, bezelDarkMat);
    housing.position.set(0, 0, 0.014);
    navGroup.add(housing);

    const trimFrameGeo = new THREE.BoxGeometry(0.155, 0.101, 0.014);
    const trimFrame = new THREE.Mesh(trimFrameGeo, aluminumTrimMat);
    trimFrame.position.set(0, 0, 0.011);
    navGroup.add(trimFrame);

    // 2. 下部センターエアコンルーバー（水平フィン＆サテンシルバー風向ノブ）＆赤いハザードランプスイッチ台座
    const ventHousingGeo = new THREE.BoxGeometry(0.148, 0.026, 0.032);
    const ventHousing = new THREE.Mesh(ventHousingGeo, bezelDarkMat);
    ventHousing.position.set(0, -0.062, 0.015);
    navGroup.add(ventHousing);

    const louverFinGeo = new THREE.BoxGeometry(0.048, 0.0022, 0.012);
    const louverKnobGeo = new THREE.BoxGeometry(0.008, 0.005, 0.006);
    for (const sideX of [-0.038, 0.038]) {
      for (const finY of [-0.066, -0.062, -0.058]) {
        const finMesh = new THREE.Mesh(louverFinGeo, aluminumTrimMat);
        finMesh.position.set(sideX, finY, -0.001);
        navGroup.add(finMesh);
      }
      const knobMesh = new THREE.Mesh(louverKnobGeo, aluminumTrimMat);
      knobMesh.position.set(sideX, -0.062, -0.004);
      navGroup.add(knobMesh);
    }

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
      // Why 1280x720 (HiDPI 2x) にするか:
      // 640x360 の低解像度テクスチャ＋Mipmap無し設定では、斜め道路や文字・境界線がピクセルジャギー（カクカク）に見えるため、
      // 論理座標系 (640x360) を維持したまま2倍解像度でラスタライズし、三線形Mipmap＋異方性フィルタリングを有効化する。
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        this.navCanvas = canvas;
        this.navContext = ctx;
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        // Why generateMipmaps = false + LinearFilter にするか:
        // 毎フレーム needsUpdate = true となる 1280x720 動的 CanvasTexture でミップマップ生成を有効にすると、
        // 毎フレーム GPU 側で 1280x720 → 1x1 までの全10階層ミップマップ再生成が走り大きなフレームレート低下を招くため。
        tex.generateMipmaps = false;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.anisotropy = 4;
        this.navTexture = tex;
        this.renderNavigationDisplay({
          position: { x: 3.5, y: 0.8, z: 26 },
          speedKmh: 0,
          headingAngle: 0,
          gear: "D",
        });
        screenMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
      } else {
        screenMat = new THREE.MeshBasicMaterial({ color: 0x0284c7, toneMapped: false });
      }
    } else {
      screenMat = new THREE.MeshBasicMaterial({ color: 0x0284c7, toneMapped: false });
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
    this.lastNavVehicleState = state;
    const ctx = this.navContext;
    const canvas = this.navCanvas;
    const tex = this.navTexture;
    const isReady = Boolean(ctx && canvas && tex);
    if (!isReady || !ctx || !canvas || !tex) {
      return;
    }

    // 論理レイアウト座標系は 640x360 とし、実キャンバス解像度 (1280x720) へスケーリング描画する
    const w = 640;
    const h = 360;
    const hasSetTransform = typeof ctx.setTransform === "function";
    if (hasSetTransform) {
      ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
    }

    const carX = state.position.x;
    const carZ = state.position.z;
    const heading = state.headingAngle;

    const nearestRoad = findNearestGsiRoad(carX, carZ);
    const nearestBldg = findNearestPlateauBuilding(carX, carZ);
    const wgs = localToWgs84(carX, carZ);
    const openData = getTokyoOpenData();
    const locale = this.currentLocale;
    const dict = getUiTranslations(locale);

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

    // 走行道路名（右上の環境・時刻文字列と重ならないよう最大幅 255px に収める）
    const localizedRoadName = localizeRoadDisplayName(nearestRoad.displayName, locale);
    ctx.fillStyle = "#38bdf8";
    ctx.font = "bold 14px sans-serif";
    ctx.fillText(localizedRoadName, 126, 24, 255);

    // 右上時刻 & 時間帯・天候・路面状態表示（右端基準で描画し最大幅 245px に制限して道路名との衝突を防止）
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "bold 13px monospace";
    ctx.textAlign = "right";
    const envStatusText = formatLabelPair(this.navTimeLabel, this.navWeatherLabel, locale);
    ctx.fillText(`${envStatusText}  ${this.navClockText}`, w - 10, 24, 245);
    ctx.textAlign = "left";

    // 3. 左側ターンバイターン・ルート案内パネル (x: 0..225, y: 38..324)
    const leftW = 225;
    ctx.fillStyle = "#0b1528";
    ctx.fillRect(0, 38, leftW, h - 72);

    const isShibuyaZone = carX < -550;

    // 次の交差点までの距離計算（渋谷エリアは国道246号・渋谷駅東口 z = 95m、丸の内エリアは日比谷通り z = 250m を目標）
    const targetIntersectionZ = isShibuyaZone ? 95 : 250;
    const distToIntersection = Math.max(0, Math.round(Math.abs(targetIntersectionZ - carZ)));
    ctx.fillStyle = "#1d4ed8";
    ctx.fillRect(10, 48, leftW - 20, 128);
    ctx.strokeStyle = "#60a5fa";
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 48, leftW - 20, 128);

    // ターン案内矢印アイコン
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
    ctx.fillText(dict.navDistanceAheadSuffix, 156, 102);

    ctx.fillStyle = "#e0f2fe";
    ctx.font = "bold 15px sans-serif";
    ctx.fillText(isShibuyaZone ? dict.navTargetShibuya : dict.navTargetMarunouchi, 80, 130, 132);
    ctx.fillStyle = "#93c5fd";
    ctx.font = "12px sans-serif";
    ctx.fillText(
      isShibuyaZone ? dict.navRouteSubShibuya : dict.navRouteSubMarunouchi,
      80,
      152,
      132,
    );

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
    ctx.fillText(dict.navSpeedGearHeader, 80, 198, 132);
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
    ctx.fillText(dict.navLandmarkHeader, 18, 268, 190);
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 14px sans-serif";
    const localizedBldgName = localizeBuildingName(nearestBldg, locale);
    const maxBldgTitleLen = locale === "en" ? 18 : 12;
    const bldgTitle =
      localizedBldgName.length > maxBldgTitleLen
        ? `${localizedBldgName.slice(0, maxBldgTitleLen)}…`
        : localizedBldgName;
    ctx.fillText(bldgTitle, 18, 289, 190);
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
    const scalePxPerMeter = 1.05; // 1m = 1.05px (前方約220m〜広域周回グリッドを表示)

    ctx.save();
    ctx.beginPath();
    ctx.rect(mapX, mapY, mapW, mapH);
    ctx.clip();

    // 地図背景色（街区ベースカラー）
    ctx.fillStyle = "#081526";
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

    // 距離リンググリッド（80m / 160m / 240m）
    ctx.strokeStyle = "rgba(56, 189, 248, 0.12)";
    ctx.lineWidth = 1;
    for (const rMeters of [80, 160, 240]) {
      ctx.beginPath();
      ctx.arc(centerPxX, centerPxY, rMeters * scalePxPerMeter, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 4.1 皇居外苑内濠（和田倉濠・日比谷濠）および渋谷川の水域描画（エリア境界で突然消えないよう統合描画）
    if (!this.cachedNavWaterBodies) {
      this.cachedNavWaterBodies = [
        ...openData.waterBodies,
        { localX: -726.0, localZ: -40.0, width: 8.5, depth: 520.0 },
      ];
    }
    const waterBodiesForNav = this.cachedNavWaterBodies;
    for (const wb of waterBodiesForNav) {
      const distWater = Math.hypot(wb.localX - carX, wb.localZ - carZ);
      const isWaterVisible = distWater < 650;
      if (!isWaterVisible) {
        continue;
      }
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
      ctx.fillStyle = "rgba(3, 105, 161, 0.52)";
      ctx.fill();
      ctx.strokeStyle = "rgba(56, 189, 248, 0.35)";
      ctx.lineWidth = 1.0;
      ctx.stroke();
    }

    // 4.2 東京都 PLATEAU 千代田区 (13101) / 渋谷区 (13113) 道路クリアランス済み 3D ビル群フットプリント描画
    // Why 街区ビルを道路コリドーより先に描画するか:
    // 3D ルーフオフセット表現 (-roofShiftPx) は画面座標系で上方向へシフトするため、道路の後にビルを描くと
    // 旋回角度によってビル屋根の角が道路の縁石やアスファルトに食い込み、道路の縁が欠けてカクカクに見える。
    // 街区レイヤーとしてビルを先に描画し、その上に道路コリドー（Pass 1〜3）を重ねることで道路の連続性を100%保証する。
    if (!this.cachedNavMapBuildings) {
      this.cachedNavMapBuildings = [
        ...getPlateauBuildingsForMap(),
        {
          buildingId: "13101-bldg-tokyo-station",
          x: 0,
          z: -36,
          w: 310,
          d: 24,
          h: 46,
        },
        ...getShibuyaPlateauBuildingsForMap(),
      ];
    }
    const mapBuildings = this.cachedNavMapBuildings;
    for (const bldg of mapBuildings) {
      const distFromCar = Math.hypot(bldg.x - carX, bldg.z - carZ);
      const isWithinView = distFromCar < 460;
      if (!isWithinView) {
        continue;
      }
      const isClosest = bldg.buildingId === nearestBldg.buildingId;
      const isTokyoStation = bldg.buildingId === "13101-bldg-tokyo-station";
      const hw = bldg.w * 0.5;
      const hd = bldg.d * 0.5;
      const baseCorners = [
        worldToMapPx(bldg.x - hw, bldg.z - hd),
        worldToMapPx(bldg.x + hw, bldg.z - hd),
        worldToMapPx(bldg.x + hw, bldg.z + hd),
        worldToMapPx(bldg.x - hw, bldg.z + hd),
      ];

      // ビル基底フットプリント
      ctx.beginPath();
      ctx.moveTo(baseCorners[0].x, baseCorners[0].y);
      for (let i = 1; i < baseCorners.length; i++) {
        ctx.lineTo(baseCorners[i].x, baseCorners[i].y);
      }
      ctx.closePath();
      ctx.fillStyle = isTokyoStation
        ? "rgba(153, 27, 27, 0.72)"
        : isClosest
          ? "rgba(14, 116, 144, 0.55)"
          : "rgba(15, 23, 42, 0.78)";
      ctx.fill();

      // 3D ルーフオフセット表現（高さに応じた微小視差で JDM 3D ナビ地図の立体感を表現）
      const roofShiftPx = Math.min(4.2, Math.max(1.4, bldg.h * 0.02));
      ctx.beginPath();
      ctx.moveTo(baseCorners[0].x - roofShiftPx * 0.6, baseCorners[0].y - roofShiftPx);
      for (let i = 1; i < baseCorners.length; i++) {
        ctx.lineTo(baseCorners[i].x - roofShiftPx * 0.6, baseCorners[i].y - roofShiftPx);
      }
      ctx.closePath();
      ctx.fillStyle = isTokyoStation
        ? "rgba(185, 28, 28, 0.82)"
        : isClosest
          ? "rgba(56, 189, 248, 0.38)"
          : "rgba(30, 41, 59, 0.84)";
      ctx.fill();
      ctx.strokeStyle = isTokyoStation ? "#f87171" : isClosest ? "#38bdf8" : "#475569";
      ctx.lineWidth = isClosest || isTokyoStation ? 1.6 : 1.0;
      ctx.stroke();
    }

    // 4.3 道路コリドー・マルチパス合成描画
    // Why 3パスに分離するか:
    // 1セグメントずつ「太い暗色枠線 → 細い明色塗り」を交互に描くと、各頂点や交差点で後から描いた道路の枠線が
    // 既存の道路塗りを上書きし、ソーセージの継ぎ目状の黒いスジや段差（「カクカクで変な道路表現」）が発生する。
    // 全道路の外枠（Pass 1）→ 全道路の路面塗り（Pass 2）→ 車線・交差点フィレット（Pass 3）の順に階層合成し、
    // さらに lineCap = "round" とすることで T字路・十字路のすべてが段差なく滑らかに結合される。
    const navCorridors = getNavigationRoadCorridors();
    const navIntersections = getNavigationIntersections();
    const visibleNavCorridors = navCorridors.filter((corridor) => {
      const isValidCorridor = corridor.points.length >= 2;
      if (!isValidCorridor) {
        return false;
      }
      for (let i = 0; i < corridor.points.length; i++) {
        const pt = corridor.points[i];
        const isPtNearCar = Math.abs(pt.x - carX) < 560 && Math.abs(pt.z - carZ) < 560;
        if (isPtNearCar) {
          return true;
        }
      }
      return false;
    });

    // Pass 1: 全道路コリドーの外枠（縁石・ケーシング）を一括描画
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const corridor of visibleNavCorridors) {
      const roadPxWidth = corridor.widthMeters * scalePxPerMeter;
      const startPt = worldToMapPx(corridor.points[0].x, corridor.points[0].z);
      ctx.beginPath();
      ctx.moveTo(startPt.x, startPt.y);
      for (let i = 1; i < corridor.points.length; i++) {
        const pt = worldToMapPx(corridor.points[i].x, corridor.points[i].z);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.strokeStyle = "#1e293b";
      ctx.lineWidth = roadPxWidth + 3.4;
      ctx.stroke();
    }

    // Pass 2: 全道路コリドーのアスファルト路面塗りを階層順（街区道 → 主要都道 → 国道）に一括描画
    for (const corridor of visibleNavCorridors) {
      const roadPxWidth = corridor.widthMeters * scalePxPerMeter;
      const startPt = worldToMapPx(corridor.points[0].x, corridor.points[0].z);
      ctx.beginPath();
      ctx.moveTo(startPt.x, startPt.y);
      for (let i = 1; i < corridor.points.length; i++) {
        const pt = worldToMapPx(corridor.points[i].x, corridor.points[i].z);
        ctx.lineTo(pt.x, pt.y);
      }
      const isNationalHighway = corridor.category === "national_highway";
      const isMajorAvenue = corridor.category === "major_avenue";
      ctx.strokeStyle = isNationalHighway ? "#64748b" : isMajorAvenue ? "#52637a" : "#3f4f63";
      ctx.lineWidth = roadPxWidth;
      ctx.stroke();
    }

    // Pass 3: 幹線道路の中央線・複数車線区分線および交差点内のクリアランス描画
    ctx.lineCap = "butt";
    const hasLineDashSupport = typeof ctx.setLineDash === "function";
    for (const corridor of visibleNavCorridors) {
      const shouldDrawCenterline = corridor.hasMedianLine;
      if (!shouldDrawCenterline) {
        continue;
      }

      // 複数車線の幹線道路（幅員 17m 以上）では左右の車線境界破線もオフセット描画する
      const isWideMultiLane = corridor.widthMeters >= 17 && corridor.points.length >= 2;
      if (isWideMultiLane && hasLineDashSupport) {
        const laneOffsetMeters = corridor.widthMeters * 0.24;
        for (const sideSign of [-1, 1]) {
          ctx.beginPath();
          for (let i = 0; i < corridor.points.length; i++) {
            const curr = corridor.points[i];
            const prev = corridor.points[Math.max(0, i - 1)];
            const next = corridor.points[Math.min(corridor.points.length - 1, i + 1)];
            const dx = next.x - prev.x;
            const dz = next.z - prev.z;
            const len = Math.hypot(dx, dz) || 1;
            const nx = (dz / len) * sideSign * laneOffsetMeters;
            const nz = (-dx / len) * sideSign * laneOffsetMeters;
            const pt = worldToMapPx(curr.x + nx, curr.z + nz);
            if (i === 0) {
              ctx.moveTo(pt.x, pt.y);
            } else {
              ctx.lineTo(pt.x, pt.y);
            }
          }
          ctx.setLineDash([4, 5]);
          ctx.strokeStyle = "rgba(226, 232, 240, 0.28)";
          ctx.lineWidth = 0.85;
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }

      const startPt = worldToMapPx(corridor.points[0].x, corridor.points[0].z);
      ctx.beginPath();
      ctx.moveTo(startPt.x, startPt.y);
      for (let i = 1; i < corridor.points.length; i++) {
        const pt = worldToMapPx(corridor.points[i].x, corridor.points[i].z);
        ctx.lineTo(pt.x, pt.y);
      }
      const isNationalHighway = corridor.category === "national_highway";
      if (hasLineDashSupport) {
        ctx.setLineDash(isNationalHighway ? [] : [6, 6]);
      }
      ctx.strokeStyle = isNationalHighway
        ? "rgba(251, 191, 36, 0.52)"
        : "rgba(226, 232, 240, 0.38)";
      ctx.lineWidth = isNationalHighway ? 1.2 : 1.0;
      ctx.stroke();
      if (hasLineDashSupport) {
        ctx.setLineDash([]);
      }
    }

    // 主要交差点の中央面＋横断歩道帯をアスファルト色でマスクし、車線ラインと横断歩道が重ならないように描画する
    for (const inter of navIntersections) {
      const isInterNearCar = Math.abs(inter.x - carX) < 420 && Math.abs(inter.z - carZ) < 420;
      if (!isInterNearCar) {
        continue;
      }
      // 交差点ボックス（横断歩道外端まで含む領域）で縦断車線ラインをクリア
      const hw = inter.widthMeters * 0.56;
      const hd = inter.depthMeters * 0.56;
      const corners = [
        worldToMapPx(inter.x - hw, inter.z - hd),
        worldToMapPx(inter.x + hw, inter.z - hd),
        worldToMapPx(inter.x + hw, inter.z + hd),
        worldToMapPx(inter.x - hw, inter.z + hd),
      ];
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < corners.length; i++) {
        ctx.lineTo(corners[i].x, corners[i].y);
      }
      ctx.closePath();
      ctx.fillStyle = "#5b6b80";
      ctx.fill();

      // 交差点の4辺に非重複の横断歩道ミニストライプを描画
      if (hasLineDashSupport) {
        ctx.strokeStyle = "rgba(248, 250, 252, 0.45)";
        ctx.lineWidth = 1.6;
        ctx.setLineDash([2, 2]);
        const cwSpanX = inter.widthMeters * 0.34;
        const cwSpanZ = inter.depthMeters * 0.34;
        const cwOffsetZ = inter.depthMeters * 0.48;
        const cwOffsetX = inter.widthMeters * 0.48;
        for (const zSign of [-1, 1]) {
          const p1 = worldToMapPx(inter.x - cwSpanX, inter.z + zSign * cwOffsetZ);
          const p2 = worldToMapPx(inter.x + cwSpanX, inter.z + zSign * cwOffsetZ);
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
        for (const xSign of [-1, 1]) {
          const p1 = worldToMapPx(inter.x + xSign * cwOffsetX, inter.z - cwSpanZ);
          const p2 = worldToMapPx(inter.x + xSign * cwOffsetX, inter.z + cwSpanZ);
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
    }

    // 4.4 推奨ナビゲーションルート（交差点コーナーR補間付きシアン＆ブルー発光ライン＋進行方向シェブロン）
    // Why コーナーR補間 (quadraticCurveTo) を入れるか:
    // 交差点で直角 (90度) に折れ曲がるポリラインや180度折り返し点をそのまま lineTo で結ぶと、
    // 交差点の角が鋭利に尖ってカクカクに見えるため、交差点手前16mから滑らかな接線円弧でカーブさせる。
    const routeWaypoints: ReadonlyArray<{ x: number; z: number }> = isShibuyaZone
      ? [
          { x: -750.0, z: -240.0 },
          { x: -750.0, z: 95.0 },
          { x: -640.0, z: 95.0 },
          { x: -545.0, z: 108.0 },
          { x: -450.0, z: 108.0 },
          { x: -355.0, z: 98.0 },
          { x: -268.0, z: 95.0 },
          { x: -268.0, z: 250.0 },
          { x: 0.0, z: 250.0 },
        ]
      : [
          { x: 0.0, z: 5.0 },
          { x: 0.0, z: 250.0 },
          { x: 270.0, z: 250.0 },
          { x: 270.0, z: 5.0 },
          { x: -268.0, z: 5.0 },
          { x: -268.0, z: 250.0 },
          { x: 0.0, z: 250.0 },
        ];

    const traceRoundedRoute = (
      waypoints: ReadonlyArray<{ x: number; z: number }>,
      cornerRadiusMeters: number,
    ): void => {
      const hasEnoughPoints = waypoints.length >= 2;
      if (!hasEnoughPoints) {
        return;
      }
      const firstPx = worldToMapPx(waypoints[0].x, waypoints[0].z);
      ctx.beginPath();
      ctx.moveTo(firstPx.x, firstPx.y);

      const hasQuadraticCurve = typeof ctx.quadraticCurveTo === "function";
      for (let i = 1; i < waypoints.length - 1; i++) {
        const prev = waypoints[i - 1];
        const curr = waypoints[i];
        const next = waypoints[i + 1];
        const inDx = curr.x - prev.x;
        const inDz = curr.z - prev.z;
        const outDx = next.x - curr.x;
        const outDz = next.z - curr.z;
        const inLen = Math.hypot(inDx, inDz);
        const outLen = Math.hypot(outDx, outDz);
        const canRoundCorner = hasQuadraticCurve && inLen > 1 && outLen > 1;
        if (!canRoundCorner) {
          const currPx = worldToMapPx(curr.x, curr.z);
          ctx.lineTo(currPx.x, currPx.y);
          continue;
        }
        const radius = Math.min(cornerRadiusMeters, inLen * 0.35, outLen * 0.35);
        const enterWorldX = curr.x - (inDx / inLen) * radius;
        const enterWorldZ = curr.z - (inDz / inLen) * radius;
        const exitWorldX = curr.x + (outDx / outLen) * radius;
        const exitWorldZ = curr.z + (outDz / outLen) * radius;

        const enterPx = worldToMapPx(enterWorldX, enterWorldZ);
        const ctrlPx = worldToMapPx(curr.x, curr.z);
        const exitPx = worldToMapPx(exitWorldX, exitWorldZ);
        ctx.lineTo(enterPx.x, enterPx.y);
        ctx.quadraticCurveTo(ctrlPx.x, ctrlPx.y, exitPx.x, exitPx.y);
      }

      const lastWp = waypoints[waypoints.length - 1];
      const lastPx = worldToMapPx(lastWp.x, lastWp.z);
      ctx.lineTo(lastPx.x, lastPx.y);
    };

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    traceRoundedRoute(routeWaypoints, 16.0);
    ctx.strokeStyle = "rgba(3, 105, 161, 0.92)";
    ctx.lineWidth = 8.5;
    ctx.stroke();

    traceRoundedRoute(routeWaypoints, 16.0);
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 4.2;
    ctx.stroke();

    // ルート上の進行方向シェブロン（矢羽根マーク）を一定間隔で描画
    ctx.strokeStyle = "#e0f2fe";
    ctx.lineWidth = 1.6;
    for (let i = 0; i < routeWaypoints.length - 1; i++) {
      const pStart = routeWaypoints[i];
      const pEnd = routeWaypoints[i + 1];
      const segDx = pEnd.x - pStart.x;
      const segDz = pEnd.z - pStart.z;
      const segLen = Math.hypot(segDx, segDz);
      const isLongEnoughForChevron = segLen >= 70;
      if (!isLongEnoughForChevron) {
        continue;
      }
      const stepMeters = 85;
      for (let dist = 42; dist < segLen - 32; dist += stepMeters) {
        const t = dist / segLen;
        const wx = pStart.x + segDx * t;
        const wz = pStart.z + segDz * t;
        const aheadWx = pStart.x + segDx * Math.min(1, (dist + 4) / segLen);
        const aheadWz = pStart.z + segDz * Math.min(1, (dist + 4) / segLen);
        const cPx = worldToMapPx(wx, wz);
        const aPx = worldToMapPx(aheadWx, aheadWz);
        const dirAngle = Math.atan2(aPx.y - cPx.y, aPx.x - cPx.x);
        const wingLen = 3.8;
        ctx.beginPath();
        ctx.moveTo(
          cPx.x - Math.cos(dirAngle - 0.65) * wingLen,
          cPx.y - Math.sin(dirAngle - 0.65) * wingLen,
        );
        ctx.lineTo(cPx.x, cPx.y);
        ctx.lineTo(
          cPx.x - Math.cos(dirAngle + 0.65) * wingLen,
          cPx.y - Math.sin(dirAngle + 0.65) * wingLen,
        );
        ctx.stroke();
      }
    }

    // 主要ランドマーク名ラベル
    const labels = getNavigationMapLabels(isShibuyaZone, locale);
    ctx.font = "bold 12px sans-serif";
    for (const lbl of labels) {
      const pt = worldToMapPx(lbl.x, lbl.z);
      const isInsideMap =
        pt.x > mapX + 15 && pt.x < w - 55 && pt.y > mapY + 18 && pt.y < mapY + mapH - 12;
      if (isInsideMap) {
        let textWidth = this.navLabelWidthCache.get(lbl.text);
        if (textWidth === undefined) {
          const hasMeasureText = typeof ctx.measureText === "function";
          const measuredWidth = hasMeasureText ? ctx.measureText(lbl.text).width : 0;
          textWidth = measuredWidth > 0 ? measuredWidth : lbl.text.length * 10;
          this.navLabelWidthCache.set(lbl.text, textWidth);
        }
        ctx.fillStyle = "rgba(15, 23, 42, 0.84)";
        ctx.fillRect(pt.x - 28, pt.y - 11, textWidth + 12, 18);
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

    // コンパスアイコン（右上・ヘディングアップ連動で北方位針が回転）
    const compX = w - 34;
    const compY = mapY + 32;
    ctx.beginPath();
    ctx.arc(compX, compY, 18, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
    ctx.fill();
    ctx.strokeStyle = "#64748b";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const northDirX = Math.sin(heading);
    const northDirY = -Math.cos(heading);
    ctx.beginPath();
    ctx.moveTo(compX + northDirX * 13, compY + northDirY * 13);
    ctx.lineTo(compX - northDirY * 3.5, compY + northDirX * 3.5);
    ctx.lineTo(compX + northDirY * 3.5, compY - northDirX * 3.5);
    ctx.closePath();
    ctx.fillStyle = "#ef4444";
    ctx.fill();

    ctx.fillStyle = "#ef4444";
    ctx.font = "bold 11px sans-serif";
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
    // 日本の右ハンドル運転席位置 (x = -0.38m, y = 0.888m, z = 0.44m)
    group.position.set(-0.38, 0.888, 0.44);
    // Why order = "XZY" にするか:
    // ステアリングシャフトのチルト角 (rotation.x = 0.35) を適用した上で、傾斜面内のシャフト軸 (ローカル Z 軸) 周りに
    // ブレなく回転 (rotation.z) させるため（R = Rx(0.35) * Rz(steer)）。
    group.rotation.order = "XZY";
    group.rotation.x = 0.35;

    // 実寸クラウン セダン 本革×3D杢目コンビステアリング（外径 360mm = 中心半径 0.164m + グリップ断面半径 0.016m）
    const rimGeo = new THREE.TorusGeometry(0.164, 0.016, 18, 42);
    const rimMat = new THREE.MeshStandardMaterial({
      name: "SteeringLeather",
      color: 0x181c24,
      roughness: 0.44,
      metalness: 0.12,
    });
    this.applyCrownInterior3DTexture(rimMat, "leather");

    const woodRimMat = new THREE.MeshStandardMaterial({
      name: "CrownWoodTrim",
      color: 0x4b2c1b,
      roughness: 0.24,
      metalness: 0.08,
    });
    this.applyCrownInterior3DTexture(woodRimMat, "wood");

    const stitchMat = new THREE.MeshStandardMaterial({
      name: "SaddleStitch",
      color: 0xc27d44,
      roughness: 0.48,
      metalness: 0.15,
    });
    this.applyCrownInterior3DTexture(stitchMat, "leather");

    const spokeMat = new THREE.MeshStandardMaterial({
      name: "SilverTrim",
      color: 0xe5e7eb,
      metalness: 0.9,
      roughness: 0.19,
    });
    this.applyCrownInterior3DTexture(spokeMat, "satin");

    const switchPodMat = new THREE.MeshStandardMaterial({
      name: "SteeringSwitchPod",
      color: 0x11151f,
      roughness: 0.48,
      metalness: 0.2,
    });
    this.applyCrownInterior3DTexture(switchPodMat, "leather");

    const switchIconMat = new THREE.MeshStandardMaterial({
      color: 0xe0f2fe,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.65,
      roughness: 0.25,
    });

    const crownBadgeBaseMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.28,
      metalness: 0.35,
    });
    this.applyCrownInterior3DTexture(crownBadgeBaseMat, "leather");

    const rim = new THREE.Mesh(rimGeo, rimMat);
    group.add(rim);

    // ステアリング内周のサドルタン本革ユーロステッチシームリング
    const innerStitchGeo = new THREE.TorusGeometry(0.1485, 0.0018, 10, 42);
    const innerStitch = new THREE.Mesh(innerStitchGeo, stitchMat);
    innerStitch.position.set(0, 0, -0.002);
    rim.add(innerStitch);

    // ステアリング上部のクラウン ウッディブラウン3D杢目コンビグリップアーク（10時〜2時位置）
    const woodArcGeo = new THREE.TorusGeometry(
      0.164,
      0.0168,
      16,
      28,
      THREE.MathUtils.degToRad(110),
    );
    const woodArc = new THREE.Mesh(woodArcGeo, woodRimMat);
    woodArc.rotation.z = THREE.MathUtils.degToRad(35);
    rim.add(woodArc);

    // ステアリング下部のクラウン ウッディブラウン3D杢目コンビグリップアーク（5時〜7時位置）
    const lowerWoodArcGeo = new THREE.TorusGeometry(
      0.164,
      0.0166,
      14,
      22,
      THREE.MathUtils.degToRad(68),
    );
    const lowerWoodArc = new THREE.Mesh(lowerWoodArcGeo, woodRimMat);
    lowerWoodArc.rotation.z = THREE.MathUtils.degToRad(236);
    rim.add(lowerWoodArc);

    // 本革と杢目アークの境目を飾るサテンシルバー・ジョイントリング（4箇所）
    const jointRingGeo = new THREE.TorusGeometry(0.0172, 0.0016, 10, 18);
    for (const deg of [35, 145, 236, 304]) {
      const rad = THREE.MathUtils.degToRad(deg);
      const jointRing = new THREE.Mesh(jointRingGeo, spokeMat);
      jointRing.position.set(Math.cos(rad) * 0.164, Math.sin(rad) * 0.164, 0);
      jointRing.rotation.z = rad;
      jointRing.rotation.x = Math.PI / 2;
      rim.add(jointRing);
    }

    const centerGeo = new THREE.CylinderGeometry(0.056, 0.056, 0.032, 24);
    centerGeo.rotateX(Math.PI / 2);
    const center = new THREE.Mesh(centerGeo, rimMat);
    center.position.set(0, 0, -0.004);
    rim.add(center);

    // ホーンパッド外周のサドルタン本革ステッチリング
    const hornStitchGeo = new THREE.TorusGeometry(0.051, 0.0014, 10, 28);
    const hornStitch = new THREE.Mesh(hornStitchGeo, stitchMat);
    hornStitch.position.set(0, 0, -0.0195);
    rim.add(hornStitch);

    // ホーンパッド中央のトヨタ クラウン「王冠（Crown）エンブレム」（ドライバー側 -Z 面に配置）
    const badgePlateGeo = new THREE.CylinderGeometry(0.024, 0.024, 0.004, 24);
    badgePlateGeo.rotateX(Math.PI / 2);
    const badgePlate = new THREE.Mesh(badgePlateGeo, crownBadgeBaseMat);
    badgePlate.position.set(0, 0, -0.02);
    rim.add(badgePlate);

    const emblemRingGeo = new THREE.TorusGeometry(0.025, 0.0026, 12, 28);
    const emblemRing = new THREE.Mesh(emblemRingGeo, spokeMat);
    emblemRing.position.set(0, 0, -0.022);
    rim.add(emblemRing);

    const crownBaseGeo = new THREE.BoxGeometry(0.026, 0.004, 0.004);
    const crownBase = new THREE.Mesh(crownBaseGeo, spokeMat);
    crownBase.position.set(0, -0.007, -0.023);
    rim.add(crownBase);

    const crownPillars: Array<{ x: number; h: number; rotZ: number }> = [
      { x: 0.0, h: 0.014, rotZ: 0.0 },
      { x: -0.006, h: 0.012, rotZ: 0.14 },
      { x: 0.006, h: 0.012, rotZ: -0.14 },
      { x: -0.0115, h: 0.0095, rotZ: 0.28 },
      { x: 0.0115, h: 0.0095, rotZ: -0.28 },
    ];
    for (const p of crownPillars) {
      const pGeo = new THREE.BoxGeometry(0.0028, p.h, 0.004);
      const pMesh = new THREE.Mesh(pGeo, spokeMat);
      pMesh.position.set(p.x, -0.006 + p.h * 0.5, -0.023);
      pMesh.rotation.z = p.rotZ;
      rim.add(pMesh);
    }

    // 3本スポーク（左右＋下）
    const hSpokeGeo = new THREE.BoxGeometry(0.3, 0.022, 0.014);
    const hSpoke = new THREE.Mesh(hSpokeGeo, spokeMat);
    rim.add(hSpoke);

    const vSpokeGeo = new THREE.BoxGeometry(0.026, 0.15, 0.014);
    const vSpoke = new THREE.Mesh(vSpokeGeo, spokeMat);
    vSpoke.position.set(0, -0.075, 0);
    rim.add(vSpoke);

    // 左右スポーク上のマルチファンクションスイッチクラスター（ADAS / オーディオ操作ボタン＆イルミアイコン）
    const podGeo = new THREE.BoxGeometry(0.044, 0.032, 0.012);
    const dpadRingGeo = new THREE.TorusGeometry(0.009, 0.0014, 8, 16);
    const toggleBtnGeo = new THREE.BoxGeometry(0.008, 0.003, 0.004);
    for (const sideX of [-0.095, 0.095]) {
      const podMesh = new THREE.Mesh(podGeo, switchPodMat);
      podMesh.position.set(sideX, 0.002, -0.01);
      rim.add(podMesh);

      const dpadRing = new THREE.Mesh(dpadRingGeo, spokeMat);
      dpadRing.position.set(sideX, 0.003, -0.0165);
      rim.add(dpadRing);

      for (const offsetY of [-0.009, 0.012]) {
        const btnIcon = new THREE.Mesh(toggleBtnGeo, switchIconMat);
        btnIcon.position.set(sideX, offsetY, -0.0165);
        rim.add(btnIcon);
      }
    }

    // 左右パドルシフト（-/+：スポーク奥側 +Z 面に配置）
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

  /**
   * サイドガラスの頂点座標から UV を正規化し、GLB / プロシージャル双方で
   * u = 0.0 (車両前方 Aピラー側 z=maxZ) .. 1.0 (車両後方 Cピラー側 z=minZ),
   * v = 0.0 (ベルトライン下端 y=minY) .. 1.0 (ルーフ上端 y=maxY) に統一する
   */
  public normalizeSideWindowGeometryUVs(geometry: THREE.BufferGeometry): void {
    const posAttr = geometry.attributes.position;
    const hasNoPositionAttribute = !posAttr;
    if (hasNoPositionAttribute) {
      return;
    }

    let minZ = Infinity;
    let maxZ = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < posAttr.count; i++) {
      const y = posAttr.getY(i);
      const z = posAttr.getZ(i);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }

    const spanZ = Math.max(maxZ - minZ, 0.001);
    const spanY = Math.max(maxY - minY, 0.001);
    const uvs = new Float32Array(posAttr.count * 2);

    for (let i = 0; i < posAttr.count; i++) {
      const y = posAttr.getY(i);
      const z = posAttr.getZ(i);
      const u = THREE.MathUtils.clamp((maxZ - z) / spanZ, 0.0, 1.0);
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

    const mat = createWindshieldMaterial("windshield");
    const mesh = new THREE.Mesh(geo, mat);

    return { mesh, material: mat };
  }

  private createSideWindows(): { mesh: THREE.Mesh; material: THREE.ShaderMaterial } {
    // 左右6ライトサイドガラス（フロントドア・リアドア・6ライトクォーターガラス）の3D曲面メッシュを構築
    const positions: number[] = [];
    const indices: number[] = [];

    const panels: Array<{
      b0: [number, number, number];
      b1: [number, number, number];
      t0: [number, number, number];
      t1: [number, number, number];
      archY: number;
      archX: number;
      uSegs: number;
      vSegs: number;
    }> = [
      // 1. フロントドアガラス (Aピラー z=+1.24 〜 Bピラー z=-0.16)
      {
        b0: [0.742, 0.862, 1.24],
        b1: [0.798, 0.858, -0.155],
        t0: [0.658, 1.4, 0.48],
        t1: [0.674, 1.432, -0.195],
        archY: 0.012,
        archX: 0.01,
        uSegs: 12,
        vSegs: 8,
      },
      // 2. リアドアガラス (Bピラー z=-0.165 〜 6ライトディバイダー z=-0.915)
      {
        b0: [0.798, 0.858, -0.165],
        b1: [0.78, 0.87, -0.915],
        t0: [0.674, 1.432, -0.205],
        t1: [0.642, 1.362, -0.715],
        archY: 0.014,
        archX: 0.006,
        uSegs: 10,
        vSegs: 8,
      },
      // 3. 6ライトリアクォーターガラス (ディバイダー z=-0.925 〜 Cピラー後端 z=-1.665)
      {
        b0: [0.78, 0.87, -0.925],
        b1: [0.758, 0.89, -1.665],
        t0: [0.642, 1.362, -0.725],
        t1: [0.756, 0.902, -1.655],
        archY: 0.0,
        archX: 0.0,
        uSegs: 8,
        vSegs: 6,
      },
    ];

    let vertOffset = 0;
    for (const side of [-1.0, 1.0]) {
      for (const panel of panels) {
        const { b0, b1, t0, t1, archY, archX, uSegs, vSegs } = panel;
        for (let vi = 0; vi <= vSegs; vi++) {
          const vRatio = vi / vSegs;
          const tumbleX = Math.sin(vRatio * Math.PI) * 0.016;
          for (let ui = 0; ui <= uSegs; ui++) {
            const uRatio = ui / uSegs;
            const arc = Math.sin(uRatio * Math.PI);

            const bx = THREE.MathUtils.lerp(b0[0], b1[0], uRatio);
            const by = THREE.MathUtils.lerp(b0[1], b1[1], uRatio);
            const bz = THREE.MathUtils.lerp(b0[2], b1[2], uRatio);

            const tx = THREE.MathUtils.lerp(t0[0], t1[0], uRatio) + arc * archX;
            const ty = THREE.MathUtils.lerp(t0[1], t1[1], uRatio) + arc * archY;
            const tz = THREE.MathUtils.lerp(t0[2], t1[2], uRatio);

            const x = side * (THREE.MathUtils.lerp(bx, tx, vRatio) + tumbleX);
            const y = THREE.MathUtils.lerp(by, ty, vRatio);
            const z = THREE.MathUtils.lerp(bz, tz, vRatio);
            positions.push(x, y, z);
          }
        }

        const stride = uSegs + 1;
        for (let vi = 0; vi < vSegs; vi++) {
          for (let ui = 0; ui < uSegs; ui++) {
            const v0 = vertOffset + vi * stride + ui;
            const v1 = v0 + 1;
            const v2 = v0 + stride + 1;
            const v3 = v0 + stride;
            if (side > 0) {
              indices.push(v0, v1, v2, v0, v2, v3);
            } else {
              indices.push(v0, v3, v2, v0, v2, v1);
            }
          }
        }
        vertOffset += (uSegs + 1) * (vSegs + 1);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    this.normalizeSideWindowGeometryUVs(geo);
    geo.computeVertexNormals();

    const mat = createSideWindowMaterial();
    const mesh = new THREE.Mesh(geo, mat);
    return { mesh, material: mat };
  }

  private createRearWindow(): { mesh: THREE.Mesh; material: THREE.ShaderMaterial } {
    // ファストバックリアガラス (幅 1.46..1.23m, y=0.89..1.362, z=-1.74..-0.70) を構築
    const segX = 16;
    const segY = 12;
    const geo = new THREE.PlaneGeometry(1.46, 1.08, segX, segY);

    const posAttr = geo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const uRatio = posAttr.getX(i) / 1.46 + 0.5;
      const vRatio = posAttr.getY(i) / 1.08 + 0.5; // 0.0 (下端トランク側) .. 1.0 (上端ルーフ側)
      const width = THREE.MathUtils.lerp(1.46, 1.23, vRatio);
      const x = (uRatio - 0.5) * width;
      const baseY = THREE.MathUtils.lerp(0.89, 1.362, vRatio);
      const baseZ = THREE.MathUtils.lerp(-1.74, -0.7, vRatio);
      const crownU = Math.sin(uRatio * Math.PI);
      const crownV = Math.sin(vRatio * Math.PI);
      const archY = crownU * THREE.MathUtils.lerp(0.012, 0.026, vRatio) + crownV * 0.015;
      const archZ = -crownU * 0.032 + crownV * 0.014;
      posAttr.setXYZ(i, x, baseY + archY, baseZ + archZ);
    }

    this.normalizeWindshieldGeometryUVs(geo);
    geo.computeVertexNormals();

    const mat = createRearWindowMaterial();
    const mesh = new THREE.Mesh(geo, mat);
    return { mesh, material: mat };
  }

  private createWipers(): { driverWiper: THREE.Group; passengerWiper: THREE.Group } {
    const armMat = new THREE.MeshStandardMaterial({
      name: "WiperBlack",
      color: 0x18181b,
      roughness: 0.45,
      metalness: 0.55,
    });
    this.applyVehicleExterior3DTexture(armMat, "piano_black");
    const rubberMat = new THREE.MeshStandardMaterial({
      name: "TireRubber",
      color: 0x09090b,
      roughness: 0.92,
      metalness: 0.05,
    });
    this.applyVehicleExterior3DTexture(rubberMat, "tire_rubber");

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

  /**
   * トヨタ クラウン セダン（AZSH32）の4眼Bi-Beam LEDヘッドライト光源・ハンマーヘッド一文字DRL・ボリューメトリックライトコーン・路面照射を構築する
   * - Why not:
   *   従来の `SpotLight` 位置 `(±0.65, 0.55, 2.15)` はフロントバンパー (`z = 2.15m 〜 2.34m`) の内側に埋まっており、
   *   車体外装メッシュの `castShadow = true` によって自身のバンパーでヘッドライト光が遮蔽され、路面が暗くなっていた。
   * - How:
   *   1. 左右メイン Bi-Beam `SpotLight` の光源位置をフロントノーズ先端・4眼レンズ表面すぐ外側の `(±0.66, 0.675, 2.38)` に配置し、
   *      `shadow.camera.near = 0.6`, 照射角度 `Math.PI / 3.2`, 距離 `110m` で前方車線・標識・建築物をクリアに照射する。
   *   2. ドライバー視点から手前〜中距離のアスファルト路面と白線をワイドに照らすロービーム補助 `SpotLight` (`headlightLowBeamLight`) を追加する。
   *   3. 車外視点や路面反射からも「ヘッドライトの光源」が鮮明に見えるよう、片側4眼（計8眼）の超薄型 Bi-Beam LED プロジェクター発光レンズ、
   *      ハンマーヘッド横一文字 LED シグネチャー DRL バー、およびボリューメトリックライトビームコーン (`headlightBeamConeGroup`) を構築する。
   */
  private setupHeadlights(): void {
    // 1. 左右メイン4眼 Bi-Beam LED SpotLight（右 x = -0.66m / 左 x = +0.66m の2灯を対称配置、バンパー先端外 z = 2.38m から前方へ照射、自己遮蔽ゼロ）
    const lightPositions = [
      new THREE.Vector3(-0.66, 0.675, 2.38),
      new THREE.Vector3(0.66, 0.675, 2.38),
    ];

    for (let i = 0; i < lightPositions.length; i++) {
      const pos = lightPositions[i];
      const spot = new THREE.SpotLight(0xf8fbff, 58.0, 115, Math.PI / 3.1, 0.62, 1.15);
      spot.name = i === 0 ? "HeadlightSpot_R" : "HeadlightSpot_L";
      spot.position.copy(pos);

      const target = new THREE.Object3D();
      target.name = i === 0 ? "HeadlightTarget_R" : "HeadlightTarget_L";
      target.position.set(pos.x * 0.65, 0.05, pos.z + 34);
      spot.target = target;

      // Why 左右2灯の SpotLight で castShadow = false にしつつ、両方の光源をシーンツリーに追加するか:
      // 太陽・月光のメイン DirectionalLight に加えてシャドウマップを生成すると描画負荷が増大するため castShadow = false とし、
      // 左右独立した2つの SpotLight (x = -0.66m / +0.66m) を両方とも this.group に追加して路面・車線・標識を左右対称のツインビームで照射する。
      // 消灯時（初期状態）は visible = false にして昼間シェーダーから除外する。
      spot.castShadow = false;
      spot.visible = this.headlightsEnabled;
      spot.shadow.mapSize.width = 512;
      spot.shadow.mapSize.height = 512;
      spot.shadow.camera.near = 0.6;
      spot.shadow.camera.far = 65;

      this.group.add(target);
      this.group.add(spot);
      this.headLights.push(spot);
    }

    // 2. 手前〜中距離のアスファルト路面をワイドに照らすロービーム補助光源（シーンツリーには追加せずプロパティ互換として保持）
    this.headlightLowBeamLight = new THREE.SpotLight(0xeef6ff, 42.0, 52, Math.PI / 2.15, 0.82, 1.1);
    this.headlightLowBeamLight.position.set(0.0, 0.69, 2.4);
    const lowBeamTarget = new THREE.Object3D();
    lowBeamTarget.position.set(0.0, -0.15, 16.5);
    this.headlightLowBeamLight.target = lowBeamTarget;
    this.headlightLowBeamLight.castShadow = false;
    this.headlightLowBeamLight.visible = false;

    // 3. クラウン セダン 4眼Bi-Beam LEDプロジェクター発光レンズ ＆ ハンマーヘッド一文字DRL光源メッシュ
    this.headlightLightSourceGroup = new THREE.Group();
    this.headlightLightSourceGroup.name = "HeadlightLightSourceGroup";

    const ledProjectorMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      toneMapped: false,
    });
    const ledHaloMat = new THREE.MeshBasicMaterial({
      color: 0xdbeafe,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const hammerheadDrlMat = new THREE.MeshBasicMaterial({
      color: 0xf0f9ff,
      toneMapped: false,
    });

    // ハンマーヘッド中央〜左右を貫く横一文字シグネチャーLEDバー (幅 1.66m)
    const centerDrlGeo = new THREE.BoxGeometry(1.66, 0.014, 0.024);
    const centerDrlMesh = new THREE.Mesh(centerDrlGeo, hammerheadDrlMat);
    centerDrlMesh.position.set(0.0, 0.722, 2.332);
    centerDrlMesh.castShadow = false;
    this.headlightLightSourceGroup.add(centerDrlMesh);

    // 片側4眼・計8眼の超薄型 Bi-Beam LED プロジェクターレンズ発光コア (x = ±0.50, ±0.59, ±0.68, ±0.77)
    const quadXOffsets = [0.5, 0.59, 0.68, 0.77];
    const lensGeo = new THREE.BoxGeometry(0.056, 0.022, 0.018);
    const haloGeo = new THREE.PlaneGeometry(0.11, 0.055);

    for (const side of [-1, 1]) {
      for (let qIdx = 0; qIdx < quadXOffsets.length; qIdx++) {
        const xPos = side * quadXOffsets[qIdx];
        const yPos = 0.674 + qIdx * 0.004;
        const zPos = 2.312 - qIdx * 0.036;

        const lensMesh = new THREE.Mesh(lensGeo, ledProjectorMat);
        lensMesh.position.set(xPos, yPos, zPos);
        lensMesh.rotation.y = side * -0.18;
        lensMesh.castShadow = false;
        this.headlightLightSourceGroup.add(lensMesh);

        const haloMesh = new THREE.Mesh(haloGeo, ledHaloMat);
        haloMesh.position.set(xPos, yPos, zPos + 0.012);
        haloMesh.rotation.y = side * -0.18;
        haloMesh.castShadow = false;
        this.headlightLightSourceGroup.add(haloMesh);
      }
    }

    // 4. ボリューメトリック・ライトビームコーン（夜間・夕暮れ・雨天時にヘッドライト光源から前方へ伸びる光束）
    this.headlightBeamConeGroup = new THREE.Group();
    this.headlightBeamConeGroup.name = "HeadlightBeamConeGroup";

    const beamConeGeo = new THREE.ConeGeometry(1.85, 11.5, 24, 1, true);
    // コーン頂点を原点 (光源位置) に置き、+Z 前方へ伸びるように座標変換
    beamConeGeo.translate(0, -11.5 * 0.5, 0);
    beamConeGeo.rotateX(-Math.PI / 2);

    const beamConeMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0xdbeafe) },
        uOpacity: { value: 0.13 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vLocalPos;
        varying vec3 vNormalView;
        void main() {
          vLocalPos = position;
          vNormalView = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec3 vLocalPos;
        varying vec3 vNormalView;
        void main() {
          float distRatio = clamp(vLocalPos.z / 11.5, 0.0, 1.0);
          float longitudinalFade = smoothstep(0.0, 0.08, distRatio) * pow(1.0 - distRatio, 1.85);
          float edgeSoftness = pow(abs(vNormalView.z), 1.35);
          float alpha = longitudinalFade * edgeSoftness * uOpacity;
          if (alpha < 0.002) {
            discard;
          }
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    for (const side of [-1, 1]) {
      const coneMesh = new THREE.Mesh(beamConeGeo, beamConeMat);
      coneMesh.position.set(side * 0.64, 0.67, 2.34);
      coneMesh.rotation.x = 0.042; // 路面へ向かってわずかに下向き（ロービームカットオフ角）
      coneMesh.rotation.y = side * -0.025;
      coneMesh.castShadow = false;
      this.headlightBeamConeGroup.add(coneMesh);
    }

    this.headlightLightSourceGroup.add(this.headlightBeamConeGroup);
    this.group.add(this.headlightLightSourceGroup);
  }

  /**
   * トヨタ クラウン セダン車内キャビン専用ライティングを構築する
   * - Why 車内専用ライトが必要か:
   *   車外の太陽光 (DirectionalLight) はルーフ天板やピラーで遮られ、また夜間や雨天時は環境光が落ちるため、
   *   コックピット内の3D杢目パネル・本革シボ・王冠エンブレム・JISコンビレバーが黒潰れしやすい。
   *   ルーフコンソールからの柔らかい間接フィルライト (`cabinOverheadLight`)、
   *   クラウン セダン象徴の「64色マルチカラーアンビエントイルミネーション」(`cabinAmbientLight`)、
   *   および運転席足元・ステアリングコラム・センターコンソール側面を温かく浮かび上がらせるフットウェル間接照明 (`cabinFootwellLight`) を配置する。
   */
  private setupInteriorLighting(): void {
    // Why シーンツリーに PointLight を追加せず visible = false で保持するか:
    // Three.js のフォワードレンダリングではシーンツリー内の PointLight 走査やシェーダー再コンパイル負荷が生じるため、
    // 実描画では PMREM 環境マップと自己発光で車内明度を担保し、PointLight インスタンスは API 互換・状態保持のみに留める。
    // 1. ルーフコンソール間接フィルライト（右ハンドル運転席とセンターコンソールの中間上空）
    this.cabinOverheadLight = new THREE.PointLight(0xfff4e6, 1.15, 2.8, 1.3);
    this.cabinOverheadLight.position.set(-0.18, 1.24, 0.22);
    this.cabinOverheadLight.castShadow = false;
    this.cabinOverheadLight.visible = false;

    // 2. アイランドアーキテクチャー 64色アンビエントイルミネーション（行燈のような温かみのある和風間接照明）
    this.cabinAmbientLight = new THREE.PointLight(0xffcf8b, 1.05, 2.4, 1.4);
    this.cabinAmbientLight.position.set(-0.15, 0.85, 0.52);
    this.cabinAmbientLight.castShadow = false;
    this.cabinAmbientLight.visible = false;

    // 3. 運転席フットウェル＆ステアリングコラム下部アンビエントライト（本革シボ・杢目下部・シフトノブの立体陰影を強調）
    this.cabinFootwellLight = new THREE.PointLight(0xffdca8, 0.72, 1.85, 1.5);
    this.cabinFootwellLight.position.set(-0.28, 0.58, 0.36);
    this.cabinFootwellLight.castShadow = false;
    this.cabinFootwellLight.visible = false;
  }

  /**
   * 時間帯（TimeOfDay）と天候（WeatherCondition）に応じて車内キャビンライティングの色温度と強度を連動制御する
   */
  public setInteriorLighting(timeOfDay: TimeOfDay, weather: WeatherCondition): void {
    const isNight = timeOfDay === "night";
    const isSunset = timeOfDay === "sunset";
    const isRainOrCloudy = weather === "rain" || weather === "cloudy";

    if (isNight) {
      // 夜間：ルーフは落ち着いたクールウォーム間接光、アンビエント＆フットウェルはクラウン伝統の行燈（あんどん）アンバーゴールドを強調
      this.cabinOverheadLight.color.setHex(0xdbeafe);
      this.cabinOverheadLight.intensity = 0.92;
      this.cabinAmbientLight.color.setHex(0xffb84d);
      this.cabinAmbientLight.intensity = 1.55;
      this.cabinFootwellLight.color.setHex(0xffab40);
      this.cabinFootwellLight.intensity = 0.95;
      return;
    }

    if (isSunset) {
      // 夕暮れ：西日と調和するゴールデンアンバーの室内光で3D杢目ウッドパネルの導管とクリアコートを際立たせる
      this.cabinOverheadLight.color.setHex(0xffe8cc);
      this.cabinOverheadLight.intensity = 1.25;
      this.cabinAmbientLight.color.setHex(0xffc069);
      this.cabinAmbientLight.intensity = 1.32;
      this.cabinFootwellLight.color.setHex(0xffc878);
      this.cabinFootwellLight.intensity = 0.85;
      return;
    }

    // 朝・昼：ルーフの影による車内の暗転を防ぐナチュラルデイライトフィル（雨天・曇天時は少し強めに補助）
    this.cabinOverheadLight.color.setHex(0xfff8f0);
    this.cabinOverheadLight.intensity = isRainOrCloudy ? 1.42 : 1.08;
    this.cabinAmbientLight.color.setHex(0xffe0b2);
    this.cabinAmbientLight.intensity = isRainOrCloudy ? 1.05 : 0.78;
    this.cabinFootwellLight.color.setHex(0xffe4bc);
    this.cabinFootwellLight.intensity = isRainOrCloudy ? 0.75 : 0.56;
  }

  /**
   * トヨタ クラウン セダン車内内装マテリアルへ 3D ボリュームテクスチャ (`sampler3D uCrownInteriorVolumeTex`) を注入する
   * - UV 継ぎ目のない 3D オブジェクト空間座標 (`vCrownLocalPos`) でサンプリングし、
   *   - `"wood"`: 3D 異方性オープンポア杢目ウッドグレイン（ウッディブラウン深彫り導管ピット・リボン杢シマー・クリアコートラッカー鏡面反射）
   *   - `"leather"`: 3D Worley ペブル本革シボ（セミアニリンレザーの立体セルドーム隆起・シャープなシボ溝・グリージングエッジシマー）
   *   - `"perforated"`: 3D パンチングレザー＆マイクロファブリック織り目（シート座面・シフトノブの立体ディンプル穿孔＆リムハイライト）
   *   - `"satin"`: 3D サテンシルバー微細ヘアライン加飾（異方性金属ブラシ反射ハイライト）
   *   - `"alcantara"`: 3D ウルトラスエード／アルカンターラ調起毛マイクロファイバー（Aピラー・ルーフ内張りのソフトベルベットリム散乱）
   *   のアルベド濃淡・ラフネス変調・ビュースペース接線バンプ法線摂動・物理スペキュラ強調を適用する。
   */
  public applyCrownInterior3DTexture(
    material: THREE.MeshStandardMaterial,
    variant: "wood" | "leather" | "perforated" | "satin" | "alcantara",
  ): void {
    const isWood = variant === "wood";
    const isLeather = variant === "leather";
    const isPerforated = variant === "perforated";
    const isSatin = variant === "satin";

    let variantCode = 4; // "alcantara"
    if (isWood) {
      variantCode = 0;
    } else if (isLeather) {
      variantCode = 1;
    } else if (isPerforated) {
      variantCode = 2;
    } else if (isSatin) {
      variantCode = 3;
    }

    const crownVolumeTex = Procedural3DTextureGenerator.getSharedCrownInterior3DTexture(32);

    material.userData.crownInterior3DVariant = variant;
    material.userData.crownInterior3DTexture = crownVolumeTex;
    material.customProgramCacheKey = () => "crown-interior-3d-unified-v2";

    material.onBeforeCompile = (shader) => {
      shader.uniforms.uCrownInteriorVolumeTex = { value: crownVolumeTex };
      shader.uniforms.uCrownInteriorVariant = { value: variantCode };

      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          /* glsl */ `
          #include <common>
          varying vec3 vCrownLocalPos;
          `,
        )
        .replace(
          "#include <begin_vertex>",
          /* glsl */ `
          #include <begin_vertex>
          vCrownLocalPos = position;
          `,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          /* glsl */ `
          #include <common>
          uniform sampler3D uCrownInteriorVolumeTex;
          uniform int uCrownInteriorVariant;
          varying vec3 vCrownLocalPos;
          `,
        )
        .replace(
          "#include <color_fragment>",
          /* glsl */ `
          #include <color_fragment>
          float crownViewDist = length(vViewPosition);
          vec4 crownVoxA = vec4(0.5);
          vec4 crownVoxB = vec4(0.5);
          vec4 crownVoxC = vec4(0.5);
          float crownDetailHeight = 0.5;
          float crownPoreMask = 0.0;
          if (crownViewDist < 2.5) {
            crownVoxA = texture(uCrownInteriorVolumeTex, vCrownLocalPos * 6.0);
            crownVoxB = texture(uCrownInteriorVolumeTex, vCrownLocalPos * 19.5 + vec3(0.37, 0.61, 0.19));
            if (crownViewDist < 1.35) {
              crownVoxC = texture(uCrownInteriorVolumeTex, vCrownLocalPos * 42.0 + vec3(0.73, 0.17, 0.53));
            } else {
              crownVoxC = crownVoxB;
            }
            if (uCrownInteriorVariant == 0) {
              // 0 ("wood"): クラウン アイランドアーキテクチャー 大型3D杢目調パネル（ウッディブラウン・オープンポア導管＋リボン杢）
              float woodMacro = crownVoxA.r;
              float woodFine = crownVoxB.r;
              float woodMicro = crownVoxC.r;
              crownDetailHeight = woodMacro * 0.58 + woodFine * 0.28 + woodMicro * 0.14;
              crownPoreMask = smoothstep(0.30, 0.10, woodFine);
              vec3 darkPoreWood = vec3(0.09, 0.038, 0.016);
              vec3 warmHeartWood = vec3(0.36, 0.185, 0.092);
              vec3 goldenRibbonWood = vec3(0.60, 0.35, 0.175);
              vec3 woodTint = mix(darkPoreWood, warmHeartWood, smoothstep(0.14, 0.64, crownDetailHeight));
              woodTint = mix(woodTint, goldenRibbonWood, smoothstep(0.64, 0.94, crownDetailHeight) * 0.82);
              woodTint = mix(woodTint, darkPoreWood * 0.65, crownPoreMask * 0.65);
              diffuseColor.rgb = mix(diffuseColor.rgb, woodTint, 0.88);
            } else if (uCrownInteriorVariant == 1) {
              // 1 ("leather"): クラウン セミアニリン本革ペブルシボ（立体セルドーム隆起＆シャープなシボ溝）
              float pebbleMacro = crownVoxA.g;
              float pebbleFine = crownVoxB.g;
              float pebbleMicro = crownVoxC.g;
              crownDetailHeight = pebbleMacro * 0.32 + pebbleFine * 0.48 + pebbleMicro * 0.20;
              float creaseShadow = smoothstep(0.12, 0.44, crownDetailHeight);
              float domeHighlight = smoothstep(0.55, 0.92, crownDetailHeight);
              diffuseColor.rgb *= mix(0.74, 1.18, creaseShadow * 0.65 + domeHighlight * 0.35);
            } else if (uCrownInteriorVariant == 2) {
              // 2 ("perforated"): クラウン パンチングレザー＆マイクロファブリック織り目（シート座面・シフトノブ）
              float perfHole = mix(crownVoxA.b, crownVoxB.b, 0.72);
              float leatherGrain = mix(crownVoxB.g, crownVoxC.g, 0.5);
              crownPoreMask = smoothstep(0.32, 0.10, perfHole);
              crownDetailHeight = mix(leatherGrain * 0.82 + 0.18, 0.04, crownPoreMask);
              diffuseColor.rgb *= mix(0.32, 1.16, crownDetailHeight);
            } else if (uCrownInteriorVariant == 3) {
              // 3 ("satin"): クラウン サテンシルバー異方性ヘアライン金属加飾
              float hairline = crownVoxA.a * 0.35 + crownVoxB.a * 0.45 + crownVoxC.a * 0.20;
              crownDetailHeight = hairline;
              vec3 coolSatinTint = mix(vec3(0.88, 0.90, 0.94), vec3(1.08, 1.10, 1.13), smoothstep(0.20, 0.82, hairline));
              diffuseColor.rgb *= coolSatinTint;
            } else {
              // 4 ("alcantara"): クラウン ウルトラスエード／アルカンターラ調起毛マイクロファイバー（Aピラー・ルーフ・ベゼル内張り）
              float suedeNap = crownVoxA.a * 0.30 + crownVoxB.g * 0.35 + crownVoxC.a * 0.35;
              crownDetailHeight = suedeNap;
              diffuseColor.rgb *= mix(0.82, 1.14, suedeNap);
            }
          }
          `,
        )
        .replace(
          "#include <roughnessmap_fragment>",
          /* glsl */ `
          #include <roughnessmap_fragment>
          if (crownViewDist < 2.5) {
            if (uCrownInteriorVariant == 0) {
              roughnessFactor = clamp(mix(0.14, 0.58, crownPoreMask * 0.75 + (1.0 - crownDetailHeight) * 0.25), 0.12, 0.58);
            } else if (uCrownInteriorVariant == 1) {
              roughnessFactor = clamp(roughnessFactor + (0.52 - crownDetailHeight) * 0.34, 0.32, 0.84);
            } else if (uCrownInteriorVariant == 2) {
              roughnessFactor = clamp(mix(0.38, 0.92, crownPoreMask * 0.7 + (1.0 - crownDetailHeight) * 0.3), 0.36, 0.92);
            } else if (uCrownInteriorVariant == 3) {
              roughnessFactor = clamp(roughnessFactor + (0.5 - crownDetailHeight) * 0.14, 0.12, 0.36);
            } else {
              roughnessFactor = clamp(0.78 + (0.5 - crownDetailHeight) * 0.16, 0.70, 0.95);
            }
          }
          `,
        )
        .replace(
          "#include <normal_fragment_maps>",
          /* glsl */ `
          #include <normal_fragment_maps>
          if (crownViewDist < 1.8) {
            vec3 crownSurfPosView = -vViewPosition;
            vec3 dViewPosDxCrown = dFdx(crownSurfPosView);
            vec3 dViewPosDyCrown = dFdy(crownSurfPosView);
            float dHeightDxCrown = dFdx(crownDetailHeight);
            float dHeightDyCrown = dFdy(crownDetailHeight);
            vec3 tangentXViewCrown = normalize(dViewPosDxCrown - normal * dot(dViewPosDxCrown, normal) + vec3(1e-6, 0.0, 0.0));
            vec3 tangentYViewCrown = normalize(dViewPosDyCrown - normal * dot(dViewPosDyCrown, normal) + vec3(0.0, 1e-6, 0.0));
            float bumpScaleCrown = (uCrownInteriorVariant == 0)
              ? 0.16
              : (uCrownInteriorVariant == 1)
                ? 0.28
                : (uCrownInteriorVariant == 2)
                  ? 0.32
                  : (uCrownInteriorVariant == 3 ? 0.09 : 0.20);
            normal = normalize(normal - (tangentXViewCrown * dHeightDxCrown + tangentYViewCrown * dHeightDyCrown) * bumpScaleCrown);
          }
          `,
        )
        .replace(
          "#include <lights_fragment_end>",
          /* glsl */ `
          #include <lights_fragment_end>
          if (crownViewDist < 2.5) {
            vec3 crownViewDir = normalize(vViewPosition);
            float crownNdotV = clamp(dot(normal, crownViewDir), 0.0, 1.0);
            float crownFresnel = pow(1.0 - crownNdotV, 4.0);
            if (uCrownInteriorVariant == 0) {
              float lacquerMask = 1.0 - crownPoreMask * 0.85;
              vec3 clearcoatSheen = vec3(0.95, 0.78, 0.58) * crownFresnel * 0.22 * lacquerMask;
              vec3 chatoyancyGlow = vec3(0.48, 0.26, 0.11) * smoothstep(0.55, 0.92, crownDetailHeight) * pow(crownNdotV, 2.0) * 0.14;
              reflectedLight.indirectSpecular += clearcoatSheen + chatoyancyGlow;
            } else if (uCrownInteriorVariant == 1 || uCrownInteriorVariant == 2) {
              float leatherPeakMask = smoothstep(0.45, 0.88, crownDetailHeight) * (1.0 - crownPoreMask);
              float rimSheen = pow(1.0 - crownNdotV, 2.6) * leatherPeakMask;
              reflectedLight.indirectSpecular += diffuseColor.rgb * 0.35 * rimSheen + vec3(0.18, 0.19, 0.22) * rimSheen * 0.24;
            } else if (uCrownInteriorVariant == 3) {
              float anisoBand = smoothstep(0.30, 0.85, crownDetailHeight);
              reflectedLight.indirectSpecular += vec3(0.85, 0.90, 0.98) * (0.14 * anisoBand + 0.18 * crownFresnel);
            } else {
              float velvetRim = pow(1.0 - crownNdotV, 1.85) * (0.65 + 0.35 * crownDetailHeight);
              reflectedLight.indirectDiffuse += diffuseColor.rgb * velvetRim * 0.42;
            }
          }
          `,
        );
    };
    material.needsUpdate = true;
  }

  /**
   * トヨタ クラウン セダン（AZSH32）外装エクステリア・足回りマテリアルへ 3D ボリュームテクスチャ (`sampler3D uVehicleExtVolumeTex`) を注入する
   * - Why not: 2D UV テクスチャでは複雑な曲面（ハンマーヘッドノーズ・フェンダーアーチ・マルチスポークホイール・タイヤショルダー）で
   *   UV 伸縮歪みやタイリングの継ぎ目（シーム）が発生するため、オブジェクト空間の3次元座標 (`vExtLocalPos`) で直接 3D ボリュームテクスチャをサンプリングする。
   * - How:
   *   - `"body_mica"` (mode 0): Rチャンネルの3Dマイカ・メタリックフレーク粒子とGチャンネルのマイクロオレンジピールにより、
   *     プレシャスブロンズ／ダークマイカ／プレシャスメタル塗装の繊細な真珠・金属粒子スパークルとラフネス微細変調を付与。
   *   - `"piano_black"` (mode 1): GチャンネルとAチャンネルにより、アンダースポイラーやグロスブラックグリル・樹脂パーツの緻密な塗装肌・カーボン調微細織り目感を付与。
   *   - `"tire_rubber"` (mode 2): Bチャンネルの3D加硫ゴムグレインとRチャンネルのシリカ微粒子により、タイヤトレッド面・サイドウォールのリアルなマットゴム質感と微細凹凸ラフネス（0.72〜0.92）を付与。
   *   - `"wheel_alloy"` (mode 3): Aチャンネルの3D異方性切削スピンヘアラインにより、大径アルミホイールスポーク・リム・マフラーカッターの金属切削光沢グラデーションを付与。
   *   - `"brake_rotor"` (mode 4): AチャンネルとBチャンネルにより、ベンチレーテッドディスクローターの鋳鉄摺動痕とキャリパーの金属鋳造肌を付与。
   */
  public applyVehicleExterior3DTexture(
    material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
    surfaceMode: "body_mica" | "piano_black" | "tire_rubber" | "wheel_alloy" | "brake_rotor",
  ): void {
    const isBodyMica = surfaceMode === "body_mica";
    const isPianoBlack = surfaceMode === "piano_black";
    const isTireRubber = surfaceMode === "tire_rubber";
    const isWheelAlloy = surfaceMode === "wheel_alloy";

    let modeCode = 4; // "brake_rotor"
    if (isBodyMica) {
      modeCode = 0;
    } else if (isPianoBlack) {
      modeCode = 1;
    } else if (isTireRubber) {
      modeCode = 2;
    } else if (isWheelAlloy) {
      modeCode = 3;
    }

    const extVolumeTex = Procedural3DTextureGenerator.getSharedVehicleExterior3DTexture(32);

    material.userData.vehicleExterior3DSurfaceMode = surfaceMode;
    material.userData.vehicleExterior3DTexture = extVolumeTex;
    material.customProgramCacheKey = () => "vehicle-exterior-3d-unified-v2";

    material.onBeforeCompile = (shader) => {
      shader.uniforms.uVehicleExtVolumeTex = { value: extVolumeTex };
      shader.uniforms.uVehicleExtSurfaceMode = { value: modeCode };

      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          /* glsl */ `
          #include <common>
          varying vec3 vExtLocalPos;
          `,
        )
        .replace(
          "#include <begin_vertex>",
          /* glsl */ `
          #include <begin_vertex>
          vExtLocalPos = position;
          `,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          /* glsl */ `
          #include <common>
          uniform sampler3D uVehicleExtVolumeTex;
          uniform int uVehicleExtSurfaceMode;
          varying vec3 vExtLocalPos;
          `,
        )
        .replace(
          "#include <color_fragment>",
          /* glsl */ `
          #include <color_fragment>
          float extViewDist = length(vViewPosition);
          vec4 extVoxMacro = vec4(0.5);
          vec4 extVoxFine = vec4(0.5);
          float extDetailHeight = 0.5;
          if (extViewDist < 12.0) {
            extVoxMacro = texture(uVehicleExtVolumeTex, vExtLocalPos * 4.2);
            if (extViewDist < 6.5) {
              extVoxFine = texture(uVehicleExtVolumeTex, vExtLocalPos * 18.5 + vec3(0.29, 0.53, 0.71));
            } else {
              extVoxFine = extVoxMacro;
            }
            if (uVehicleExtSurfaceMode == 0) {
              // 0 ("body_mica"): Rチャンネルの3Dマイカ・メタリックフレーク粒子 + Gチャンネルのマイクロオレンジピール
              float micaSparkle = mix(extVoxMacro.r, extVoxFine.r, 0.68);
              float orangePeel = mix(extVoxMacro.g, extVoxFine.g, 0.42);
              extDetailHeight = mix(orangePeel, micaSparkle, 0.38);
              vec3 pearlBronzeTint = mix(vec3(0.92, 0.90, 0.88), vec3(1.08, 1.05, 1.02), smoothstep(0.25, 0.85, micaSparkle));
              diffuseColor.rgb *= pearlBronzeTint * mix(0.95, 1.07, orangePeel);
            } else if (uVehicleExtSurfaceMode == 1) {
              // 1 ("piano_black"): Gチャンネルの塗装肌 + Aチャンネルのカーボン調微細織り目
              float glossPeel = extVoxMacro.g;
              float microWeave = extVoxFine.a;
              extDetailHeight = mix(glossPeel, microWeave, 0.52);
              diffuseColor.rgb *= mix(0.86, 1.14, extDetailHeight);
            } else if (uVehicleExtSurfaceMode == 2) {
              // 2 ("tire_rubber"): Bチャンネルの3D加硫ゴムグレイン + Rチャンネルのシリカ微粒子
              float rubberGrain = mix(extVoxMacro.b, extVoxFine.b, 0.64);
              float silicaGrit = extVoxFine.r;
              extDetailHeight = rubberGrain * 0.72 + silicaGrit * 0.28;
              vec3 vulcanizedRubberTint = mix(vec3(0.08, 0.085, 0.095), vec3(0.16, 0.165, 0.18), smoothstep(0.15, 0.88, extDetailHeight));
              diffuseColor.rgb = mix(diffuseColor.rgb, vulcanizedRubberTint, 0.45) * mix(0.82, 1.15, extDetailHeight);
            } else if (uVehicleExtSurfaceMode == 3) {
              // 3 ("wheel_alloy"): Aチャンネルの3D異方性切削スピンヘアラインによる金属切削光沢グラデーション
              float spinHairline = mix(extVoxMacro.a, extVoxFine.a, 0.62);
              extDetailHeight = spinHairline;
              vec3 alloySheen = mix(vec3(0.88, 0.90, 0.94), vec3(1.10, 1.12, 1.15), smoothstep(0.20, 0.82, spinHairline));
              diffuseColor.rgb *= alloySheen;
            } else {
              // 4 ("brake_rotor"): Aチャンネルの鋳鉄摺動痕 + Bチャンネルのキャリパー金属鋳造肌
              float rotorGroove = extVoxFine.a;
              float castIronGrain = mix(extVoxMacro.b, extVoxFine.b, 0.55);
              extDetailHeight = rotorGroove * 0.62 + castIronGrain * 0.38;
              diffuseColor.rgb *= mix(0.80, 1.18, extDetailHeight);
            }
          }
          `,
        )
        .replace(
          "#include <roughnessmap_fragment>",
          /* glsl */ `
          #include <roughnessmap_fragment>
          if (extViewDist < 12.0) {
            if (uVehicleExtSurfaceMode == 0) {
              roughnessFactor = clamp(roughnessFactor + (0.5 - extDetailHeight) * 0.08, 0.08, 0.28);
            } else if (uVehicleExtSurfaceMode == 1) {
              roughnessFactor = clamp(roughnessFactor + (0.5 - extDetailHeight) * 0.12, 0.16, 0.58);
            } else if (uVehicleExtSurfaceMode == 2) {
              roughnessFactor = clamp(mix(0.72, 0.92, 1.0 - extDetailHeight * 0.65), 0.72, 0.92);
            } else if (uVehicleExtSurfaceMode == 3) {
              roughnessFactor = clamp(roughnessFactor + (0.5 - extDetailHeight) * 0.10, 0.08, 0.34);
            } else {
              roughnessFactor = clamp(roughnessFactor + (0.5 - extDetailHeight) * 0.18, 0.20, 0.56);
            }
          }
          `,
        )
        .replace(
          "#include <normal_fragment_maps>",
          /* glsl */ `
          #include <normal_fragment_maps>
          if (extViewDist < 8.5) {
            vec3 extSurfPosView = -vViewPosition;
            vec3 dViewPosDxExt = dFdx(extSurfPosView);
            vec3 dViewPosDyExt = dFdy(extSurfPosView);
            float dHeightDxExt = dFdx(extDetailHeight);
            float dHeightDyExt = dFdy(extDetailHeight);
            vec3 tangentXViewExt = normalize(dViewPosDxExt - normal * dot(dViewPosDxExt, normal) + vec3(1e-6, 0.0, 0.0));
            vec3 tangentYViewExt = normalize(dViewPosDyExt - normal * dot(dViewPosDyExt, normal) + vec3(0.0, 1e-6, 0.0));
            float bumpScaleExt = (uVehicleExtSurfaceMode == 0)
              ? 0.035
              : (uVehicleExtSurfaceMode == 1)
                ? 0.065
                : (uVehicleExtSurfaceMode == 2)
                  ? 0.22
                  : (uVehicleExtSurfaceMode == 3 ? 0.08 : 0.15);
            normal = normalize(normal - (tangentXViewExt * dHeightDxExt + tangentYViewExt * dHeightDyExt) * bumpScaleExt);
          }
          `,
        );
    };
    material.needsUpdate = true;
  }

  public setWiperMode(mode: WiperMode): void {
    this.wiperMode = mode;
  }

  public getLocale(): SupportedLocale {
    return this.currentLocale;
  }

  public setLocale(locale: SupportedLocale): void {
    const isSameLocale = this.currentLocale === locale;
    if (isSameLocale) {
      return;
    }
    this.currentLocale = locale;
    this.navUpdateElapsed = 1.0;
    this.renderNavigationDisplay(this.lastNavVehicleState);
  }

  public setEnvironmentDisplay(clockText: string, timeLabel: string, weatherLabel: string): void {
    const hasChanged =
      this.navClockText !== clockText ||
      this.navTimeLabel !== timeLabel ||
      this.navWeatherLabel !== weatherLabel;
    if (!hasChanged) {
      return;
    }
    this.navClockText = clockText;
    this.navTimeLabel = timeLabel;
    this.navWeatherLabel = weatherLabel;
    this.navUpdateElapsed = 1.0;
    this.clusterUpdateElapsed = 1.0;
    this.renderNavigationDisplay(this.lastNavVehicleState);
  }

  /**
   * フロントガラス・サイドガラス・リアガラスの雨滴屈折シェーダーへ現在の時間帯・天候の環境光カラーを同期する。
   */
  public setWindshieldEnvironment(params: {
    skyHorizonColor: THREE.Color;
    skyZenithColor: THREE.Color;
    sunColor: THREE.Color;
    nightFactor: number;
  }): void {
    const glassMaterials = [
      this.windshieldMaterial,
      this.sideWindowMaterial,
      this.rearWindowMaterial,
    ];
    for (const mat of glassMaterials) {
      const u = mat.uniforms as WindshieldUniforms;
      u.uEnvSkyColor.value.copy(params.skyHorizonColor).lerp(params.skyZenithColor, 0.35);
      u.uEnvGroundColor.value
        .copy(params.skyZenithColor)
        .multiplyScalar(0.28)
        .add(new THREE.Color(0x090d16));
      u.uSunColor.value.copy(params.sunColor);
      u.uNightFactor.value = params.nightFactor;
    }
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
    // カメラコントローラーやミラー描画が1フレーム前の古いワールド行列を参照しないよう即座に更新
    this.group.updateMatrixWorld(true);

    // 2. ステアリングホイールの回転連動
    // Why +state.steeringAngle とするか:
    // 車体座標系では前方が +Z、左が +X、右が -X であり、ドライバーは -Z 側から +Z 方向を見る。
    // Z軸回転行列では上部頂点 (0, +R, 0) の X 変位が Δx = -R * sin(rotZ) となるため、
    // 右旋回 (state.steeringAngle > 0) のときにハンドル上部が右側 (Δx < 0, 時計回り) へ傾くには rotZ > 0 が正しい。
    this.steeringWheel.rotation.z = state.steeringAngle * 2.8;

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

    // 5. フロントガラス・サイドガラス・リアガラスシェーダーユニフォーム更新
    const u = this.windshieldMaterial.uniforms as WindshieldUniforms;
    u.uTime.value += dt;
    u.uSpeed.value = state.speedKmh;
    u.uRainIntensity.value = rainIntensity;
    if (dt > 0) {
      const frontScroll = computeGlassRainScrollRates(state.speedKmh, "windshield");
      u.uWindScrollY.value += dt * frontScroll.scrollYRate;
      u.uWindScrollX.value += dt * frontScroll.scrollXRate;
    }
    u.uWiperAngle1.value = this.wiperAngleDriver;
    u.uWiperAngle2.value = this.wiperAnglePassenger;
    u.uWiperDir.value = this.wiperDirection;
    u.uWiperSpeed.value = this.wiperSpeedVal;
    const isReturningToPark = this.wiperAngleDriver > CarModel.WIPER_PARK_ANGLE + 0.015;
    const isWiping = this.wiperMode !== "off" || isReturningToPark;
    u.uWiperClearing.value = isWiping ? 0.98 : 0.0;

    const sideU = this.sideWindowMaterial.uniforms as WindshieldUniforms;
    sideU.uTime.value = u.uTime.value;
    sideU.uSpeed.value = state.speedKmh;
    sideU.uRainIntensity.value = rainIntensity;
    if (dt > 0) {
      const sideScroll = computeGlassRainScrollRates(state.speedKmh, "side");
      sideU.uWindScrollY.value += dt * sideScroll.scrollYRate;
      sideU.uWindScrollX.value += dt * sideScroll.scrollXRate;
    }

    const rearU = this.rearWindowMaterial.uniforms as WindshieldUniforms;
    rearU.uTime.value = u.uTime.value;
    rearU.uSpeed.value = state.speedKmh;
    rearU.uRainIntensity.value = rainIntensity;
    if (dt > 0) {
      const rearScroll = computeGlassRainScrollRates(state.speedKmh, "rear");
      rearU.uWindScrollY.value += dt * rearScroll.scrollYRate;
      rearU.uWindScrollX.value += dt * rearScroll.scrollXRate;
    }

    // 5.5 前後左右ウインカー（方向指示器）＆JIS右ウインカーレバー点滅更新
    this.updateTurnSignals(dt);

    // 6. 運転席 12.3インチ フルTFTデジタル＋2眼リングメータークラスター & 電子シフトレバーの更新
    this.updateInstrumentCluster(dt, state, rainIntensity);

    // 7. センターコンソール 11インチ JDM フローティングカーナビ画面の適応的間引き更新
    // Why 毎フレーム無条件で 1280x720 Canvas2D 再描画＆GPUテクスチャ転送を行わないか:
    // 1280x720 (約3.68MB) の CanvasTexture を毎フレーム GPU へ転送 (`texSubImage2D`) するとメインスレッドとGPU帯域を圧迫し、
    // 30fps+ 安定維持のボトルネックになるため、初回フレーム（`navUpdateElapsed >= 1.0`）または 50ms 経過時・旋回/移動変化時に更新する。
    const hasPositiveDeltaTime = dt > 0;
    if (hasPositiveDeltaTime) {
      this.navUpdateElapsed += dt;
      const movedDistSq =
        (state.position.x - this.lastNavVehicleState.position.x) ** 2 +
        (state.position.z - this.lastNavVehicleState.position.z) ** 2;
      const headingDelta = Math.abs(state.headingAngle - this.lastNavVehicleState.headingAngle);
      const hasGearChanged = state.gear !== this.lastNavVehicleState.gear;
      const isVehicleMoving = Math.abs(state.speedKmh) > 0.5;
      const shouldRefreshNav =
        isVehicleMoving ||
        this.navUpdateElapsed >= 0.1 ||
        movedDistSq >= 0.01 ||
        headingDelta >= 0.004 ||
        hasGearChanged;
      if (shouldRefreshNav) {
        this.navUpdateElapsed = 0;
        this.renderNavigationDisplay(state);
      }
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

  /**
   * 前後左右ウインカー（方向指示器）アンバーLEDストリップおよびドアミラーLEDストリップを生成する。
   * Why `this.group` 直下に配置するか:
   * `car.glb` 非同期ロード後に `this.proceduralBodyGroup.visible = false` へ切り替わった際にも、
   * フロント（ハンマーヘッドDRL下段）・リア（一文字テールランプ両端）・ドアミラーのアンバーウインカーが確実に視認できるようにするため。
   */
  private createTurnSignalLampsAssembly(): THREE.Group {
    const group = new THREE.Group();
    group.name = "TurnSignalLamps";

    const frontStripGeo = new THREE.BoxGeometry(0.18, 0.016, 0.024);
    const rearStripGeo = new THREE.BoxGeometry(0.2, 0.018, 0.024);
    const mirrorStripGeo = new THREE.BoxGeometry(0.128, 0.014, 0.018);

    // 左フロント（+X側: 助手席側）& 右フロント（-X側: 運転席側）
    const frontLeftMesh = new THREE.Mesh(frontStripGeo, this.leftBlinkerMaterial);
    frontLeftMesh.name = "TurnSignalFront_L";
    frontLeftMesh.position.set(0.74, 0.675, 2.285);
    frontLeftMesh.rotation.y = -0.18;
    group.add(frontLeftMesh);

    const frontRightMesh = new THREE.Mesh(frontStripGeo, this.rightBlinkerMaterial);
    frontRightMesh.name = "TurnSignalFront_R";
    frontRightMesh.position.set(-0.74, 0.675, 2.285);
    frontRightMesh.rotation.y = 0.18;
    group.add(frontRightMesh);

    // 左リア（+X側）& 右リア（-X側）
    const rearLeftMesh = new THREE.Mesh(rearStripGeo, this.leftBlinkerMaterial);
    rearLeftMesh.name = "TurnSignalRear_L";
    rearLeftMesh.position.set(0.72, 0.875, -2.342);
    rearLeftMesh.rotation.y = 0.12;
    group.add(rearLeftMesh);

    const rearRightMesh = new THREE.Mesh(rearStripGeo, this.rightBlinkerMaterial);
    rearRightMesh.name = "TurnSignalRear_R";
    rearRightMesh.position.set(-0.72, 0.875, -2.342);
    rearRightMesh.rotation.y = -0.12;
    group.add(rearRightMesh);

    // ドアミラーLEDストリップ（GLB表示時にもハウジング前面で確実に発光するオーバーレイ）
    const mirrorRightLed = new THREE.Mesh(mirrorStripGeo, this.rightBlinkerMaterial);
    mirrorRightLed.name = "TurnSignalMirror_R";
    mirrorRightLed.position.set(-0.922, 0.97, 1.082);
    mirrorRightLed.rotation.y = -THREE.MathUtils.degToRad(22.0);
    group.add(mirrorRightLed);

    const mirrorLeftLed = new THREE.Mesh(mirrorStripGeo, this.leftBlinkerMaterial);
    mirrorLeftLed.name = "TurnSignalMirror_L";
    mirrorLeftLed.position.set(0.922, 0.97, 0.957);
    mirrorLeftLed.rotation.y = THREE.MathUtils.degToRad(27.0);
    group.add(mirrorLeftLed);

    return group;
  }

  /**
   * ウインカー（方向指示器 / ハザードランプ）の状態を設定する。
   * How:
   * - 状態が変わった瞬間に最初の点灯フェーズ (`turnSignalBlinkOn = true`) から開始し、
   *   12.3インチメータークラスター・外装アンバーLED・JIS右ウインカーレバー角度を即座に同期する。
   */
  public setTurnSignal(state: TurnSignalState): void {
    const isUnchanged = this.turnSignalState === state;
    if (isUnchanged) {
      return;
    }

    this.turnSignalState = state;
    this.turnSignalTimer = 0;
    const isSignalActive = state !== "off";
    this.turnSignalBlinkOn = isSignalActive;
    this.applyTurnSignalVisuals();
    this.clusterUpdateElapsed = 1.0;

    if (isSignalActive) {
      this.onTurnSignalBlinkPhaseChange?.(true, state);
    }
  }

  public getTurnSignal(): TurnSignalState {
    return this.turnSignalState;
  }

  public isTurnSignalBlinkOn(): boolean {
    return this.turnSignalBlinkOn;
  }

  private updateTurnSignals(dt: number): void {
    const isOff = this.turnSignalState === "off";
    if (isOff) {
      return;
    }

    const hasPositiveDt = dt > 0;
    if (!hasPositiveDt) {
      return;
    }

    this.turnSignalTimer += dt;
    const shouldTogglePhase = this.turnSignalTimer >= CarModel.TURN_SIGNAL_HALF_PERIOD_SEC;
    if (!shouldTogglePhase) {
      return;
    }

    this.turnSignalTimer %= CarModel.TURN_SIGNAL_HALF_PERIOD_SEC;
    this.turnSignalBlinkOn = !this.turnSignalBlinkOn;
    this.applyTurnSignalVisuals();
    this.clusterUpdateElapsed = 1.0;
    this.onTurnSignalBlinkPhaseChange?.(this.turnSignalBlinkOn, this.turnSignalState);
  }

  private applyTurnSignalVisuals(): void {
    const isLeftFlashing =
      (this.turnSignalState === "left" || this.turnSignalState === "hazard") &&
      this.turnSignalBlinkOn;
    const isRightFlashing =
      (this.turnSignalState === "right" || this.turnSignalState === "hazard") &&
      this.turnSignalBlinkOn;

    this.leftBlinkerMaterial.emissiveIntensity = isLeftFlashing ? 2.8 : 0.08;
    this.leftBlinkerMaterial.color.setHex(isLeftFlashing ? 0xffb703 : 0x78350f);

    this.rightBlinkerMaterial.emissiveIntensity = isRightFlashing ? 2.8 : 0.08;
    this.rightBlinkerMaterial.color.setHex(isRightFlashing ? 0xffb703 : 0x78350f);

    // JIS規格 右ウインカーレバー角度連動（右ウインカー=下へ押し下げ +0.22rad、左ウインカー=上へ引き上げ -0.22rad）
    if (this.turnSignalStalkGroup) {
      const isLeftStalk = this.turnSignalState === "left";
      const isRightStalk = this.turnSignalState === "right";
      let stalkOffset = 0;
      if (isLeftStalk) {
        stalkOffset = -0.22;
      } else if (isRightStalk) {
        stalkOffset = 0.22;
      }
      this.turnSignalStalkGroup.rotation.z = CarModel.STALK_NEUTRAL_ROT_Z + stalkOffset;
    }
  }

  public setHeadlights(enabled: boolean): void {
    this.headlightsEnabled = enabled;
    this.clusterUpdateElapsed = 1.0;
    for (let i = 0; i < this.headLights.length; i++) {
      this.headLights[i].intensity = enabled ? 58.0 : 0.0;
      this.headLights[i].visible = enabled;
    }
    if (this.headlightLowBeamLight) {
      this.headlightLowBeamLight.intensity = enabled ? 42.0 : 0.0;
      this.headlightLowBeamLight.visible = false;
    }
    if (this.headlightBeamConeGroup) {
      this.headlightBeamConeGroup.visible = enabled;
    }
  }

  /**
   * 車内ルームミラー（バックミラー）および車外左右ドアミラー（サイドミラー）用の
   * リアルタイム後方鏡面反射シェーダーマテリアルを生成する
   * - 後方カメラのレンダーターゲットを水平鏡像反転 (1.0 - vUv.x) してサンプリング
   * - ミラー種別（ルームミラー中央広角 / 右ドアミラー右後方 / 左ドアミラー左後方）ごとの UV クロップ領域に対応
   * - 防眩ブルーガラスティントと外周フレームレスベベルのビネット減衰を付与
   */
  private createMirrorShaderMaterial(
    mirrorTexture: THREE.Texture,
    uvScale: THREE.Vector2,
    uvOffset: THREE.Vector2,
    tintColor: THREE.Color,
  ): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        tMirror: { value: mirrorTexture },
        uUvScale: { value: uvScale },
        uUvOffset: { value: uvOffset },
        uTint: { value: tintColor },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tMirror;
        uniform vec2 uUvScale;
        uniform vec2 uUvOffset;
        uniform vec3 uTint;
        varying vec2 vUv;

        void main() {
          // 鏡像反転（左右反転）+ 各ミラー固有の後方視界クロップ領域へマッピング
          vec2 sampleUv = vec2(
            uUvOffset.x + (1.0 - vUv.x) * uUvScale.x,
            uUvOffset.y + vUv.y * uUvScale.y
          );
          vec4 texColor = texture2D(tMirror, clamp(sampleUv, 0.01, 0.99));

          // レンダーターゲット未描画フレーム（単体テスト等）向けのフォールバック後方風景グラデーション
          float luma = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));
          vec3 skyHorizon = mix(vec3(0.18, 0.24, 0.34), vec3(0.48, 0.68, 0.88), smoothstep(0.32, 0.95, vUv.y));
          vec3 roadSurface = mix(vec3(0.12, 0.14, 0.18), vec3(0.22, 0.25, 0.30), smoothstep(0.0, 0.38, vUv.y));
          vec3 fallbackScene = mix(roadSurface, skyHorizon, smoothstep(0.34, 0.44, vUv.y));
          vec3 baseReflection = luma > 0.001 ? texColor.rgb : fallbackScene;

          // 防眩ガラスコーティングのティントとガンマ補正
          vec3 coated = pow(max(baseReflection, vec3(0.0)), vec3(0.88)) * uTint * 1.12;

          // フレームレス鏡面エッジのベベルハイライト＆ビネット
          vec2 edgeDist = abs(vUv - vec2(0.5)) * 2.0;
          float edgeFactor = max(edgeDist.x, edgeDist.y);
          float bevelHighlight = smoothstep(0.86, 0.98, edgeFactor) * 0.16;
          float edgeVignette = 1.0 - smoothstep(0.92, 1.0, edgeFactor) * 0.35;

          vec3 finalColor = (coated + vec3(bevelHighlight)) * edgeVignette;
          gl_FragColor = vec4(finalColor, 1.0);
        }
      `,
    });
  }

  /**
   * プロシージャルフォールバック用の車内ルームミラー（バックミラー）アセンブリを構築
   * - トヨタ クラウン セダン (AZSH32) 実車通り車体中央 (x = 0.00m)・フロントガラス上端傾斜面 (y = 1.258m, z = 0.74m) に配置し、右ハンドル運転席 (x = -0.38m) 側へ22度チルト
   */
  private createRearviewMirrorAssembly(): THREE.Group {
    const mirrorGroup = new THREE.Group();
    mirrorGroup.name = "RearviewMirror";
    mirrorGroup.position.set(0.0, 1.258, 0.74);
    mirrorGroup.rotation.y = THREE.MathUtils.degToRad(22.0);
    mirrorGroup.rotation.x = THREE.MathUtils.degToRad(-5.0);

    const housingMat = new THREE.MeshStandardMaterial({
      color: 0x14171f,
      roughness: 0.42,
      metalness: 0.28,
    });

    // 1. 車体中央 (x = 0.00m) のフロントガラス内面〜ルーフヘッダーに 0.0mm ギャップで密着する Toyota Safety Sense ADAS センサーポッド＆上部デュアルジョイントステー
    const adasPodGeo = new THREE.BoxGeometry(0.24, 0.095, 0.16);
    const adasPodMesh = new THREE.Mesh(adasPodGeo, housingMat);
    adasPodMesh.position.set(0.0, 0.118, -0.045);
    mirrorGroup.add(adasPodMesh);

    const baseGeo = new THREE.BoxGeometry(0.064, 0.048, 0.058);
    const baseMesh = new THREE.Mesh(baseGeo, housingMat);
    baseMesh.position.set(0, 0.072, -0.008);
    mirrorGroup.add(baseMesh);

    // ミラー上端 (y=+0.034m) の上方から ADAS マウントベース (y=+0.072m) へ連続して立ち上がるシリンダーステー
    const stemGeo = new THREE.CylinderGeometry(0.012, 0.014, 0.074, 16);
    stemGeo.rotateX(Math.PI * 0.14);
    const stemMesh = new THREE.Mesh(stemGeo, housingMat);
    stemMesh.name = "RearviewMirrorStay";
    stemMesh.position.set(0, 0.042, 0.004);
    mirrorGroup.add(stemMesh);

    // 2. ワイドフレームレス風ルームミラー筐体 (横幅 248mm × 高さ 68mm)
    const housingGeo = new THREE.BoxGeometry(0.248, 0.068, 0.022);
    const housingMesh = new THREE.Mesh(housingGeo, housingMat);
    housingMesh.position.set(0, 0, 0.012);
    mirrorGroup.add(housingMesh);

    // 3. ルームミラー反射ガラス面（運転席・後方 -Z 側へ向けるため Y軸180度回転）
    const glassGeo = new THREE.PlaneGeometry(0.238, 0.058);
    glassGeo.rotateY(Math.PI);
    const glassMesh = new THREE.Mesh(glassGeo, this.rearviewMirrorMaterial);
    glassMesh.name = "RearviewMirrorGlass";
    glassMesh.position.set(0, 0, -0.001);
    mirrorGroup.add(glassMesh);

    return mirrorGroup;
  }

  /**
   * プロシージャルフォールバック用の左右ドアミラー（サイドミラー）アセンブリを構築
   * - 右ドアミラー (x = -0.918m, y = 0.962m, z = 1.005m) / 左ドアミラー (x = +0.918m, y = 0.962m, z = 1.005m)
   */
  private createSideMirrorsAssembly(): {
    rightMirror: THREE.Group;
    leftMirror: THREE.Group;
  } {
    const bodyPaintMat = new THREE.MeshPhysicalMaterial({
      name: "BodyPaint",
      color: 0x9ca3af,
      metalness: 0.88,
      roughness: 0.16,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
    });
    this.applyVehicleExterior3DTexture(bodyPaintMat, "body_mica");
    const trimMat = new THREE.MeshStandardMaterial({
      name: "BlackTrim",
      color: 0x111827,
      roughness: 0.48,
      metalness: 0.25,
    });
    this.applyVehicleExterior3DTexture(trimMat, "piano_black");

    const buildSideMirror = (isRightSide: boolean): THREE.Group => {
      const side = isRightSide ? -1 : 1;
      const mirrorZ = isRightSide ? 1.005 : 0.88;
      const yawDeg = isRightSide ? 22.0 : 27.0;
      const group = new THREE.Group();
      group.name = isRightSide ? "SideMirror_R" : "SideMirror_L";
      group.position.set(side * 0.918, 0.962, mirrorZ);
      // 外側後端を内側へスイープさせ、鏡面を右ハンドル運転席へ向ける（右22度 / 左27度）
      group.rotation.y = side * THREE.MathUtils.degToRad(yawDeg);

      // ドアパネルマウントステー（22度ヨー角スイープ後のハウジング底面 z=+0.026m とドアガセットを 0.0mm ギャップで結合）
      const stalkGeo = new THREE.BoxGeometry(0.125, 0.036, 0.058);
      const stalkMesh = new THREE.Mesh(stalkGeo, trimMat);
      stalkMesh.name = isRightSide ? "SideMirrorStalk_R" : "SideMirrorStalk_L";
      stalkMesh.position.set(-side * 0.058, -0.052, 0.032);
      stalkMesh.rotation.z = side * 0.34;
      group.add(stalkMesh);

      // エアロミラーハウジングアッパー（ボディ同色）＆ロア（ブラックトリム）
      const shellGeo = new THREE.BoxGeometry(0.185, 0.118, 0.095);
      const shellMesh = new THREE.Mesh(shellGeo, bodyPaintMat);
      shellMesh.position.set(0, 0, 0.036);
      group.add(shellMesh);

      const visorGeo = new THREE.BoxGeometry(0.192, 0.124, 0.024);
      const visorMesh = new THREE.Mesh(visorGeo, trimMat);
      visorMesh.position.set(0, 0, 0.004);
      group.add(visorMesh);

      // フラッシュマウントLEDシーケンシャルウインカーストリップ（左右独立点滅マテリアルに連動）
      const ledGeo = new THREE.BoxGeometry(0.125, 0.012, 0.014);
      const ledMat = isRightSide ? this.rightBlinkerMaterial : this.leftBlinkerMaterial;
      const ledMesh = new THREE.Mesh(ledGeo, ledMat);
      ledMesh.position.set(side * 0.025, 0.008, 0.082);
      group.add(ledMesh);

      // ドアミラー反射ガラス面（後方 -Z 側へ向ける）
      const glassGeo = new THREE.PlaneGeometry(0.172, 0.106);
      glassGeo.rotateY(Math.PI);
      const glassMat = isRightSide ? this.sideMirrorRightMaterial : this.sideMirrorLeftMaterial;
      const glassMesh = new THREE.Mesh(glassGeo, glassMat);
      glassMesh.name = isRightSide ? "SideMirrorGlass_R" : "SideMirrorGlass_L";
      glassMesh.position.set(0, 0, -0.009);
      group.add(glassMesh);

      return group;
    };

    return {
      rightMirror: buildSideMirror(true),
      leftMirror: buildSideMirror(false),
    };
  }

  /**
   * グラフィック品質プリセットに応じて後方ミラー用レンダーターゲット解像度および更新間隔を切り替える。
   * How:
   * - `high`: 512×256 毎フレーム更新 (`interval = 1`)
   * - `medium`: 256×128 2フレームに1回更新 (`interval = 2`)
   * - `low`: 128×64 6フレームに1回更新 (`interval = 6`)
   */
  public setGraphicsQuality(quality: GraphicsQuality): GraphicsQualityPreset {
    this.graphicsQuality = quality;
    const preset = getGraphicsQualityPreset(quality);
    this.mirrorRenderInterval = Math.max(1, Math.round(preset.mirrorRenderInterval));
    this.mirrorFrameCounter = 0;

    const hasTargetSizeChanged =
      this.rearRenderTarget.width !== preset.mirrorRenderWidth ||
      this.rearRenderTarget.height !== preset.mirrorRenderHeight;
    if (hasTargetSizeChanged) {
      this.rearRenderTarget.setSize(preset.mirrorRenderWidth, preset.mirrorRenderHeight);
    }

    return preset;
  }

  /**
   * 車両後方カメラから WebGLRenderTarget へ後方風景をレンダリングし、
   * 車内ルームミラーおよび左右ドアミラーのリアルタイム反射映像を更新する
   */
  public updateMirrors(renderer: THREE.WebGLRenderer, scene: THREE.Scene, force = false): boolean {
    const shouldSkipFrame =
      !force && this.mirrorFrameCounter % Math.max(1, this.mirrorRenderInterval) !== 0;
    this.mirrorFrameCounter += 1;
    if (shouldSkipFrame) {
      return false;
    }

    this.group.updateMatrixWorld(true);

    // 車両後端ルーフ・トランク上付近 (ローカル x=0, y=1.18, z=-2.26) から後方遠景 (z=-35.0) を撮影
    this.rearCameraWorldPos.set(0, 1.18, -2.26).applyMatrix4(this.group.matrixWorld);
    this.rearCameraLookAtPos.set(0, 1.08, -35.0).applyMatrix4(this.group.matrixWorld);

    this.rearCamera.position.copy(this.rearCameraWorldPos);
    this.rearCamera.lookAt(this.rearCameraLookAtPos);
    this.rearCamera.updateMatrixWorld();

    const prevRenderTarget = renderer.getRenderTarget();
    const wasCarVisible = this.group.visible;
    const hasShadowMap = renderer.shadowMap !== undefined;
    const prevShadowAutoUpdate = hasShadowMap ? renderer.shadowMap.autoUpdate : false;
    const prevFar = this.rearCamera.far;

    // Why ミラーパスで遠方クリップを90mに短縮しシャドウマップ再計算や雨パーティクル等の重いオブジェクト描画を抑止するか:
    // 小さなミラー画面（512×256以下）に遠景の反対側エリアや8500個の雨滴パーティクル・ボリューメトリック雲ドームまで描画・シャドウ更新すると、
    // 毎フレームの頂点・ドローコール・フラグメント負荷が倍増して30fps維持のボトルネックになるため。
    const hiddenHeavyObjects: THREE.Object3D[] = [];
    for (let i = 0; i < scene.children.length; i++) {
      const child = scene.children[i];
      const isHeavyWeatherOrSkyMesh =
        child.name === "RainParticles" ||
        child.name === "RainSplashParticles" ||
        child.name === "VolumetricCloudDome" ||
        child.userData?.skipInMirror === true;
      const shouldHideInMirror = isHeavyWeatherOrSkyMesh && child.visible;
      if (shouldHideInMirror) {
        child.visible = false;
        hiddenHeavyObjects.push(child);
      }
    }

    this.rearCamera.far = 90;
    this.rearCamera.updateProjectionMatrix();
    if (hasShadowMap) {
      renderer.shadowMap.autoUpdate = false;
    }

    // 自車メッシュによる後方カメラの視界遮蔽を防ぐため一時的に非表示にして描画
    this.group.visible = false;
    try {
      renderer.setRenderTarget(this.rearRenderTarget);
      renderer.clear();
      renderer.render(scene, this.rearCamera);
    } finally {
      this.group.visible = wasCarVisible;
      for (let i = 0; i < hiddenHeavyObjects.length; i++) {
        hiddenHeavyObjects[i].visible = true;
      }
      this.rearCamera.far = prevFar;
      this.rearCamera.updateProjectionMatrix();
      if (hasShadowMap) {
        renderer.shadowMap.autoUpdate = prevShadowAutoUpdate;
      }
      renderer.setRenderTarget(prevRenderTarget);
    }
    return true;
  }
}

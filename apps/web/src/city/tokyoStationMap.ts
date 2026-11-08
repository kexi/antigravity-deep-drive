import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { JapaneseRoadBuilder } from "../roads/roadBuilder";
import { RoadProps } from "../roads/roadProps";
import {
  RoadSignSystem,
  type CreatedRoadSignInstance,
  type SignPhysicsContext,
} from "../roads/roadSignSystem";
import type { RoadSignPlacement } from "../assets/schema";
import { JapaneseRoadMaterial } from "../roads/japaneseRoadMaterial";
import type { JapaneseRoadSegmentConfig } from "../roads/types";
import { PuddleMaterial, type PuddleEnvironmentSyncParams } from "../shaders/puddleShader";
import {
  GinkgoFoliageMaterial,
  TreeBarkMaterial,
  createGinkgoBilobaCanopyGeometry,
} from "../shaders/treeShader";
import { WaterSurfaceMaterial } from "../shaders/waterShader";
import { Procedural3DTextureGenerator } from "../textures/procedural3DTexture";
import { shibuyaTextureManager } from "../textures/shibuyaTextureManager";
import { assetManager } from "../assets/assetManager";
import {
  getOpenDataCurvedRoadCorridors,
  getPlateauBuildingsForMap,
  getPlateauWaterBodies,
  getRelativeTerrainDisplacement,
  getShibuyaPlateauBuildingsForMap,
} from "../openData/gsiPlateauLoader";
import {
  WORLD_CHUNK_DEFINITIONS,
  resolveChunkIdAtPosition,
  type WorldChunkId,
} from "./openWorldStreaming";

export type DriveAreaId = "tokyo" | "shibuya";

export interface TokyoStationMapOptions {
  /**
   * true の場合、コンストラクタ時点で全エリアのGLBモデルを一斉ロードせず、
   * オープンワールドストリーミング（`activateWorldChunk`）に応じて必要なチャンクのGLBのみを優先・遅延ロードする。
   */
  deferGlbLoads?: boolean;
}

export interface AreaSpawnTransform {
  area: DriveAreaId;
  areaLabel: string;
  position: THREE.Vector3;
  yawRadians: number;
}

export type ModelLodTier = "high" | "medium" | "low" | "culled";

export interface DistanceLodStats {
  /** 現在 visible = true になっているトップレベルシーンオブジェクト数 */
  visibleObjects: number;
  /** 近距離・最高ディテール（LOD0: GLB / フルサブメッシュ表示）のオブジェクト数 */
  lod0HighCount: number;
  /** 中距離・中ディテール（LOD1: 微細装飾・GLB省略）のオブジェクト数 */
  lod1MediumCount: number;
  /** 遠距離・低ディテール（LOD2: 主要シルエット塊のみ表示）のオブジェクト数 */
  lod2LowCount: number;
  /** 距離カリングにより非表示化されたオブジェクト数 */
  culledByDistanceCount: number;
  /** LOD1/LOD2 簡略化によって非表示化されたサブメッシュ・GLB子要素の総数 */
  simplifiedSubMeshCount: number;
  /** 大型ランドマーク（東京駅・渋谷ストリーム）でGLBの代わりに軽量プロシージャルProxyが表示されている数 */
  landmarkProxyActiveCount: number;
}

/**
 * 渋谷（渋谷ストリーム）& 東京駅丸の内周辺 3D都市環境
 * 東京都デジタルツイン / 国土交通省 Project PLATEAU（千代田区 13101・渋谷区 13113・2025年度版）および
 * 国土地理院 地理院タイル DEM5A（5mメッシュ数値標高モデル）・ベクトルタイル道路中心線統合
 * - 渋谷ストリーム（Blender CLI生成GLBモデル & 3Dテクスチャ・ライムイエローアクセントサイン）
 * - 東京駅丸の内赤レンガ駅舎（Blender CLI生成GLBモデル & プロシージャル）
 * - 行幸通り・丸の内中央通り・日比谷通り・明治通り・国道246号・曲線道路網（日本の道路規格準拠・凸凹シェーダー & 平坦Rapierコライダー）
 * - 東京都 PLATEAU 千代田区・渋谷区の実在建築物（丸ビル・新丸ビル・渋谷スクランブルスクエア・渋谷ヒカリエ・渋谷サクラステージ等）
 * - 皇居内濠・渋谷川清流復活水路（3Dコースティクス水面シェーダー）
 * - 街路樹（Blender CLI生成イチョウ並木GLBモデル + 葉っぱシェーダー・木シェーダー）、街灯
 */
export class TokyoStationMap {
  public group: THREE.Group;
  public roadMaterials: JapaneseRoadMaterial[] = [];
  public puddleMaterials: PuddleMaterial[] = [];
  public foliageMaterials: GinkgoFoliageMaterial[] = [];
  public barkMaterials: TreeBarkMaterial[] = [];
  public waterMaterials: WaterSurfaceMaterial[] = [];
  public streetLights: THREE.PointLight[] = [];
  public signSpotLights: THREE.SpotLight[] = [];
  public colliders: RAPIER.Collider[] = [];
  public obstacleColliderHandles: number[] = [];
  public plateauBuildingGroups: THREE.Group[] = [];
  public glbStationGroup: THREE.Group | null = null;
  public glbShibuyaStreamGroup: THREE.Group | null = null;
  public glbShibuyaPlateauGroup: THREE.Group | null = null;
  public plateauTileMeshes: THREE.Mesh[] = [];
  public glbTreeTemplate: THREE.Group | null = null;
  public readonly signSystem: RoadSignSystem;

  private roadBuilder: JapaneseRoadBuilder;
  private signPhysicsContext: SignPhysicsContext | null = null;
  private customSignInstances = new Map<string, CreatedRoadSignInstance>();
  private proceduralStationGroup: THREE.Group | null = null;
  private proceduralShibuyaStreamGroup: THREE.Group | null = null;
  private proceduralScrambleSquareGroup: THREE.Group | null = null;
  private proceduralHikarieGroup: THREE.Group | null = null;
  private proceduralSakuraStageGroup: THREE.Group | null = null;
  private proceduralFukurasGroup: THREE.Group | null = null;
  private proceduralMiyashitaParkGroup: THREE.Group | null = null;
  private proceduralQfront109Group: THREE.Group | null = null;
  private proceduralShutokoCoreMeshes: THREE.Mesh[] = [];
  private treeSlots: {
    slotGroup: THREE.Group;
    fallbackGroup: THREE.Group;
    scale: number;
    rotationY: number;
    chunkId: WorldChunkId;
    glbInstance: THREE.Object3D | null;
  }[] = [];
  private sharedFoliageMaterial: GinkgoFoliageMaterial;
  private sharedBarkMaterial: TreeBarkMaterial;
  private sharedGinkgoCanopyGeometry: THREE.BufferGeometry;
  private streetLampCounter = 0;
  private isNightActive = false;
  private sharedArchUniforms = {
    uNightModeFactor: { value: 0.0 },
  };
  private shibuyaStreamEmissiveEntries: Array<{
    material: THREE.MeshStandardMaterial;
    dayIntensity: number;
    nightIntensity: number;
  }> = [];
  private cullingBoundsCache = new WeakMap<THREE.Object3D, THREE.Box3>();
  private lastCulledFocusPos = new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN);
  private lastCulledMaxDrawDistance = Number.NaN;
  private lastLodStats: DistanceLodStats = {
    visibleObjects: 0,
    lod0HighCount: 0,
    lod1MediumCount: 0,
    lod2LowCount: 0,
    culledByDistanceCount: 0,
    simplifiedSubMeshCount: 0,
    landmarkProxyActiveCount: 0,
  };
  private glbLoadPromises: Promise<void>[] = [];
  private readonly deferGlbLoads: boolean;
  private readonly chunkObjectsMap = new Map<WorldChunkId, THREE.Object3D[]>();
  private readonly objectToChunkId = new WeakMap<THREE.Object3D, WorldChunkId>();
  private readonly unloadedChunkIds = new Set<WorldChunkId>();
  private readonly chunkTransitionAlphas = new Map<WorldChunkId, number>();
  private stationGlbLoadingPromise: Promise<void> | null = null;
  private shibuyaStreamGlbLoadingPromise: Promise<void> | null = null;
  private shibuyaPlateauGlbLoadingPromise: Promise<void> | null = null;
  private treeTemplateLoadingPromise: Promise<void> | null = null;

  private registerCollider(col: RAPIER.Collider, isObstacle = true): void {
    this.colliders.push(col);
    const hasValidHandle = isObstacle && typeof col?.handle === "number";
    if (hasValidHandle) {
      this.obstacleColliderHandles.push(col.handle);
    }
  }

  private createCylinderDesc(
    rapier: typeof RAPIER,
    halfHeight: number,
    radius: number,
  ): RAPIER.ColliderDesc {
    const hasCylinder = typeof rapier.ColliderDesc.cylinder === "function";
    return hasCylinder
      ? rapier.ColliderDesc.cylinder(halfHeight, radius)
      : rapier.ColliderDesc.cuboid(radius, halfHeight, radius);
  }

  constructor(
    scene: THREE.Scene,
    world: RAPIER.World,
    rapier: typeof RAPIER,
    options?: TokyoStationMapOptions,
  ) {
    this.deferGlbLoads = Boolean(options?.deferGlbLoads);
    this.group = new THREE.Group();
    scene.add(this.group);
    this.roadBuilder = new JapaneseRoadBuilder();
    this.signSystem = new RoadSignSystem();

    for (const def of WORLD_CHUNK_DEFINITIONS) {
      this.chunkObjectsMap.set(def.id, []);
      this.chunkTransitionAlphas.set(def.id, 1.0);
    }

    this.sharedFoliageMaterial = new GinkgoFoliageMaterial({
      baseColor: 0xeab308,
      tipColor: 0xfef08a,
      autumnAccentColor: 0xf97316,
      roughness: 0.5,
      windSpeed: 1.65,
      windStrength: 0.24,
      sssIntensity: 0.9,
    });
    this.sharedBarkMaterial = new TreeBarkMaterial({
      barkDarkColor: 0x261710,
      barkLightColor: 0x6b4c3b,
      mossColor: 0x365314,
      roughness: 0.88,
      windSpeed: 1.65,
      windStrength: 0.24,
    });
    this.sharedGinkgoCanopyGeometry = createGinkgoBilobaCanopyGeometry();
    this.foliageMaterials.push(this.sharedFoliageMaterial);
    this.barkMaterials.push(this.sharedBarkMaterial);

    // 1. 日本の道路網（行幸通り、丸の内中央通り、日比谷通り、明治通り、国道246号、オープンデータ曲線道路）
    this.buildJapaneseRoadNetwork(world, rapier);

    // 2. 東京駅丸の内赤レンガ駅舎（GLBモデル読み込み + プロシージャル初期表示）
    this.buildTokyoStationBuilding(world, rapier);

    // 3. 渋谷ストリーム & 渋谷駅南口・渋谷川周辺街区（GLBモデル + 3Dテクスチャ + 周辺ランドマーク）
    this.buildShibuyaStreamDistrict(world, rapier);

    // 4. 周辺高層ビル群（丸ビル、新丸ビル、大手町・丸の内オフィス群）
    this.buildSurroundingSkyscrapers(world, rapier);

    // 4b. 10倍広域マップ拡張エリアの都市街並み・ビル群（原宿、恵比寿、六本木、赤坂、銀座、新橋、神田、八重洲）
    this.buildExpandedMetropolitanDistricts(world, rapier);

    // 5. 街灯・街路樹・環境小物
    this.buildStreetProps(world, rapier);

    // 6. 日本の道路標識（大型案内青看板、規制標識、警戒標識、指示標識、通称名標識）
    this.buildTokyoStreetSigns(world, rapier);

    // 7. 皇居のお堀（和田倉濠・日比谷濠）と水面シェーダー・石垣
    this.buildImperialPalaceMoat(world, rapier);

    // 8. シーン内の全子オブジェクトを空間チャンク（9セクター）へ割り当て
    this.assignObjectsToWorldChunks();
    if (this.deferGlbLoads) {
      for (const def of WORLD_CHUNK_DEFINITIONS) {
        this.unloadedChunkIds.add(def.id);
        this.chunkTransitionAlphas.set(def.id, 0);
      }
      this.syncChunkVisibilityState();
    }
  }

  /**
   * 指定したドライブエリア（渋谷 / 東京駅・丸の内）の初期スポーン位置・向きを取得する。
   */
  public static getAreaSpawnTransform(area: DriveAreaId = "shibuya"): AreaSpawnTransform {
    const isShibuya = area === "shibuya";
    if (isShibuya) {
      // Why x = -744.75 か:
      // 明治通り（中心 x = -750、片側3車線・幅3.5m）において x = -746.5（localX = +3.5m）は
      // 第1車線と第2車線の白破線境界線上になるため、第2車線中央（localX = +5.25m → x = -744.75）にスポーンさせる。
      return {
        area: "shibuya",
        areaLabel: "渋谷 (渋谷ストリーム / 明治通り)",
        position: new THREE.Vector3(-744.75, 0.9, -68.0),
        yawRadians: 0.0,
      };
    }

    // Why x = 1.75 か:
    // 行幸通り（中心 x = 0、片側2車線・幅3.5m）において x = 3.5（localX = +3.5m）は
    // 白破線の車線境界線上になるため、内側車線中央（localX = +1.75m → x = 1.75）にスポーンさせる。
    return {
      area: "tokyo",
      areaLabel: "東京駅・丸の内 (行幸通り)",
      position: new THREE.Vector3(1.75, 0.8, 26.0),
      yawRadians: 0.0,
    };
  }

  public getAreaSpawnTransform(area: DriveAreaId = "shibuya"): AreaSpawnTransform {
    return TokyoStationMap.getAreaSpawnTransform(area);
  }

  /**
   * 非同期ロードされる都市 GLB モデル（`tokyo_station.glb`, `shibuya_stream.glb`, `street_tree.glb`）の
   * 読み込みおよび 3D ボリュームテクスチャシェーダー設定完了を待機する。
   */
  public async waitForModelsLoaded(timeoutMs = 4000): Promise<void> {
    const hasNoPendingLoads = this.glbLoadPromises.length === 0;
    if (hasNoPendingLoads) {
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<void>((resolve) => {
      timeoutId = setTimeout(resolve, timeoutMs);
    });
    try {
      await Promise.race([Promise.all(this.glbLoadPromises), timeoutPromise]);
    } finally {
      const hasTimeout = timeoutId !== null;
      if (hasTimeout) {
        clearTimeout(timeoutId!);
      }
    }
  }

  private buildJapaneseRoadNetwork(world: RAPIER.World, rapier: typeof RAPIER): void {
    // 基礎地面（8000m × 8000m = 64 km²、従来の10倍以上）- 国土地理院 地理院タイル DEM5A (5mメッシュ標高) を反映した広域都市地形ベース
    // How: 道路コリドー外周の頂点Y座標に DEM5A の実測標高変位を適用し、車道領域は Rapier コライダーと一致する y=0 を維持する
    const groundGeo = new THREE.PlaneGeometry(8000, 8000, 96, 96);
    groundGeo.rotateX(-Math.PI / 2);
    const posAttr = groundGeo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i);
      const vz = posAttr.getZ(i);
      const terrainDeltaY = getRelativeTerrainDisplacement(vx, vz);
      posAttr.setY(i, terrainDeltaY);
    }
    groundGeo.computeVertexNormals();

    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x1f242d,
      roughness: 0.9,
      metalness: 0.1,
    });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.name = "CityWideGroundMesh";
    groundMesh.position.y = -0.01;
    groundMesh.receiveShadow = true;
    this.group.add(groundMesh);

    // 広域地面コライダー（Rapier: 8000m × 8000m, halfExtent = 4000m）
    const groundBodyDesc = rapier.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0);
    const groundBody = world.createRigidBody(groundBodyDesc);
    const groundColliderDesc = rapier.ColliderDesc.cuboid(4000, 0.5, 4000).setFriction(0.9);
    const groundCollider = world.createCollider(groundColliderDesc, groundBody);
    this.registerCollider(groundCollider, false);

    // ヘルパー: 道路セグメントを構築しマテリアル・コライダー配列へ登録する
    const addRoadSegment = (
      config: JapaneseRoadSegmentConfig,
      center: THREE.Vector3,
      rotationY: number,
    ): void => {
      const res = this.roadBuilder.buildSegment(config, world, rapier, center, rotationY);
      // Why 道路セグメント内の信号機 PointLight をシーングラフから削除するか:
      // 29区間の道路セグメントそれぞれに2基ずつ計58基の PointLight がシーンツリーに残っていると、
      // visible = false でも Three.js のシーングラフ走査やライト配列収集のオーバーヘッドが発生するため、
      // 信号機の視覚的発光は LED レンズの MeshBasicMaterial のみで表現し、PointLight ノード自体は親から除外する。
      const signalLightsToRemove: THREE.Object3D[] = [];
      res.group.traverse((child) => {
        const isLight = (child as THREE.Light).isLight === true;
        if (isLight) {
          child.visible = false;
          signalLightsToRemove.push(child);
        }
      });
      for (const sigLight of signalLightsToRemove) {
        sigLight.removeFromParent();
      }
      this.group.add(res.group);
      this.roadMaterials.push(...res.materials);
      this.puddleMaterials.push(...res.puddleMaterials);
      this.colliders.push(...res.colliders);
      this.obstacleColliderHandles.push(...res.obstacleColliderHandles);
    };

    // --- A. 行幸通り（メインアベニュー: 丸の内中央通り z=5・丸の内仲通り z=165・日比谷通り z=250 の各交差点で分割） ---
    // Why not 1本の長尺セグメント（length=280）で生成するか:
    // ガードレールや歩道縁石の物理コライダーが丸の内中央通り（z=5）・仲通り（z=165）・日比谷通り（z=250）の交差点を塞いでしまい、
    // 交差点での右左折ができなくなるため、永代通り等と同様に街区間ごとに分割して交差点開口部を確保する。
    for (const gyokoSeg of [
      { cz: 85.0, len: 138 }, // z = 16 .. 154（丸の内ビル・新丸ビル街区）
      { cz: 205.0, len: 58 }, // z = 176 .. 234（丸の内北街区〜和田倉門交差点手前）
    ]) {
      const gyokoConfig: JapaneseRoadSegmentConfig = {
        name: "Gyoko-dori",
        lanesPerDirection: 2,
        laneWidth: 3.5,
        shoulderWidth: 1.5,
        sidewalkWidth: 4.5,
        curbHeight: 0.15,
        length: gyokoSeg.len,
        hasYellowCenterLine: false,
        hasWhiteDashedLines: true,
        hasCrosswalk: true,
        hasGuardrails: true,
        hasManholes: true,
        hasTrafficLights: true,
        speedLimitSign: 40,
      };
      addRoadSegment(gyokoConfig, new THREE.Vector3(0, 0.01, gyokoSeg.cz), 0);
    }

    // A-2. 行幸通り・和田倉橋〜皇居外苑内堀通り連絡路（z = 266 .. 354, 和田倉濠と日比谷濠の間の土橋・皇居前広場アプローチ）
    const kokyoApproachConfig: JapaneseRoadSegmentConfig = {
      name: "Kokyo-Gaien-Approach",
      lanesPerDirection: 2,
      laneWidth: 3.5,
      shoulderWidth: 1.5,
      sidewalkWidth: 4.0,
      curbHeight: 0.15,
      length: 88,
      hasYellowCenterLine: false,
      hasWhiteDashedLines: true,
      hasCrosswalk: true,
      hasGuardrails: false,
      hasManholes: true,
      hasTrafficLights: true,
      speedLimitSign: 40,
    };
    addRoadSegment(kokyoApproachConfig, new THREE.Vector3(0, 0.01, 310), 0);

    // --- B. 丸の内中央通り（z = 5: 大手町 x=-440 〜 東京駅前広場 〜 有楽町 x=+440） ---
    // Why not: 交差する南北幹線（x = -268, 0, +270）および丸の内西通り・東通り（x = -156, +156）を1本の長尺メッシュで重ねると
    // Zファイティングや歩道縁石による車線閉塞が起きるため、5箇所の交差点ごとに6区間へ分割して街区周回走行を可能にする。
    const centralInnerSegments: Array<{ cx: number; len: number; rot: number }> = [
      { cx: -360.5, len: 159, rot: Math.PI / 2 },
      { cx: -210.5, len: 89, rot: Math.PI / 2 },
      { cx: -79.75, len: 132.5, rot: Math.PI / 2 },
      { cx: 79.75, len: 132.5, rot: -Math.PI / 2 },
      { cx: 211.5, len: 91, rot: -Math.PI / 2 },
      { cx: 361.5, len: 157, rot: -Math.PI / 2 },
    ];
    for (const seg of centralInnerSegments) {
      addRoadSegment(
        {
          name: "Marunouchi-Central-Ave",
          lanesPerDirection: 1,
          laneWidth: 3.25,
          shoulderWidth: 1.0,
          sidewalkWidth: 3.0,
          curbHeight: 0.15,
          length: seg.len,
          hasYellowCenterLine: true,
          hasWhiteDashedLines: false,
          hasCrosswalk: true,
          hasGuardrails: false,
          hasManholes: true,
          hasTrafficLights: true,
          speedLimitSign: 40,
        },
        new THREE.Vector3(seg.cx, 0.012, 5),
        seg.rot,
      );
    }

    // --- C. 丸の内仲通り（z = 165: 大手町仲通り x=-440 〜 丸の内ブリックスクエア 〜 有楽町 x=+440） ---
    for (const seg of centralInnerSegments) {
      addRoadSegment(
        {
          name: "Marunouchi-Naka-dori",
          lanesPerDirection: 1,
          laneWidth: 3.25,
          shoulderWidth: 1.0,
          sidewalkWidth: 3.5,
          curbHeight: 0.15,
          length: seg.len,
          hasYellowCenterLine: false,
          hasWhiteDashedLines: true,
          hasCrosswalk: true,
          hasGuardrails: false,
          hasManholes: true,
          hasTrafficLights: true,
          speedLimitSign: 30,
        },
        new THREE.Vector3(seg.cx, 0.012, 165),
        seg.rot,
      );
    }

    // --- D. 日比谷通り（z = 250: 国道1号・都道403号 神田橋・大手町 x=-480 〜 和田倉門 〜 馬場先門・日比谷 x=+480） ---
    const hibiyaSegments: Array<{ cx: number; len: number; rot: number }> = [
      { cx: -381, len: 198, rot: Math.PI / 2 },
      { cx: -210.5, len: 89, rot: Math.PI / 2 },
      { cx: -79.75, len: 132.5, rot: Math.PI / 2 },
      { cx: 79.75, len: 132.5, rot: -Math.PI / 2 },
      { cx: 211.5, len: 91, rot: -Math.PI / 2 },
      { cx: 382, len: 196, rot: -Math.PI / 2 },
    ];
    for (const seg of hibiyaSegments) {
      addRoadSegment(
        {
          name: "Hibiya-dori",
          lanesPerDirection: 3,
          laneWidth: 3.5,
          shoulderWidth: 1.5,
          sidewalkWidth: 4.0,
          curbHeight: 0.15,
          length: seg.len,
          hasYellowCenterLine: false,
          hasWhiteDashedLines: true,
          hasCrosswalk: true,
          hasGuardrails: true,
          hasManholes: true,
          hasTrafficLights: true,
          speedLimitSign: 60,
        },
        new THREE.Vector3(seg.cx, 0.012, 250),
        seg.rot,
      );
    }

    // --- E. 内堀通り（z = 365: 都道301号 大手門 x=-480 〜 皇居前広場・二重橋前 〜 祝田橋・桜田門 x=+480） ---
    // Why 外側2区間のみ直線で構築するか:
    // 中央区間（x = -253 .. +255）は国土地理院オープンデータの曲線道路コリドー（nav-road-uchibori-dori）として
    // 皇居前広場に沿って緩やかに湾曲して構築されるため、直線セグメントを重複配置すると縁石が交差してしまうため。
    for (const seg of [
      { cx: -381, len: 198, rot: Math.PI / 2 },
      { cx: 382, len: 196, rot: -Math.PI / 2 },
    ]) {
      addRoadSegment(
        {
          name: "Uchibori-dori",
          lanesPerDirection: 2,
          laneWidth: 3.5,
          shoulderWidth: 1.5,
          sidewalkWidth: 4.0,
          curbHeight: 0.15,
          length: seg.len,
          hasYellowCenterLine: false,
          hasWhiteDashedLines: true,
          hasCrosswalk: true,
          hasGuardrails: true,
          hasManholes: true,
          hasTrafficLights: true,
          speedLimitSign: 50,
        },
        new THREE.Vector3(seg.cx, 0.012, 365),
        seg.rot,
      );
    }

    // --- F. 永代通り・大手町大通り（x = -268: 国道1号 日本橋口 z=-85 〜 大手町交差点 z=250 〜 大手門 z=365） ---
    // --- G. 鍛冶橋通り・馬場先門通り（x = +270: 都道406号 京橋口 z=-85 〜 馬場先門交差点 z=250 〜 皇居外苑楠公前 z=365） ---
    // Why Eitai-dori (x = -268) のみ z = 95 前後を分割するか:
    // 渋谷から東へ伸びる国道246号・青山通り（z = 95, x = -735 .. -283）が永代通り（x = -268）にT字接続するため、
    // 分割しないと永代通りの西側歩道縁石・ガードレール・信号柱が国道246号の車道を塞いでしまうため。
    for (const arterial of [
      {
        x: -268,
        name: "Eitai-dori",
        speedLimit: 50,
        segments: [
          { cz: -45.5, len: 79 }, // z = -85 .. -6
          { cz: 48.5, len: 65 }, // z = 16 .. 81（国道246号交差点 z = 95 南側まで）
          { cz: 131.5, len: 45 }, // z = 109 .. 154（国道246号交差点 z = 95 北側から）
          { cz: 205.0, len: 58 }, // z = 176 .. 234
          { cz: 310.0, len: 88 }, // z = 266 .. 354
        ],
      },
      {
        x: 270,
        name: "Babasakimon-Kajibashi-dori",
        speedLimit: 50,
        segments: [
          { cz: -45.5, len: 79 }, // z = -85 .. -6
          { cz: 85.0, len: 138 }, // z = 16 .. 154
          { cz: 205.0, len: 58 }, // z = 176 .. 234
          { cz: 310.0, len: 88 }, // z = 266 .. 354
        ],
      },
    ]) {
      for (const zSeg of arterial.segments) {
        addRoadSegment(
          {
            name: arterial.name,
            lanesPerDirection: 2,
            laneWidth: 3.5,
            shoulderWidth: 1.5,
            sidewalkWidth: 4.0,
            curbHeight: 0.15,
            length: zSeg.len,
            hasYellowCenterLine: false,
            hasWhiteDashedLines: true,
            hasCrosswalk: true,
            hasGuardrails: true,
            hasManholes: true,
            hasTrafficLights: true,
            speedLimitSign: arterial.speedLimit,
          },
          new THREE.Vector3(arterial.x, 0.011, zSeg.cz),
          0,
        );
      }
    }

    // --- G-2. 丸の内西通り（x = -156）＆ 丸の内東通り・大名小路（x = +156）の街区縦断通り ---
    // How: 丸ビル・新丸ビル・KITTE・明治安田生命ビル等の街区裏通りへ右左折進入できるよう、
    // 中央通り(z=5)〜仲通り(z=165)〜日比谷通り(z=250)を結ぶ南北街路を生成する。
    for (const sideStreet of [
      { x: -156, name: "Marunouchi-West-St" },
      { x: 156, name: "Marunouchi-East-St" },
    ]) {
      for (const zSeg of [
        { cz: 85.0, len: 138 }, // z = 16 .. 154
        { cz: 205.0, len: 58 }, // z = 176 .. 234
      ]) {
        addRoadSegment(
          {
            name: sideStreet.name,
            lanesPerDirection: 1,
            laneWidth: 3.25,
            shoulderWidth: 1.0,
            sidewalkWidth: 2.5,
            curbHeight: 0.15,
            length: zSeg.len,
            hasYellowCenterLine: false,
            hasWhiteDashedLines: true,
            hasCrosswalk: true,
            hasGuardrails: false,
            hasManholes: true,
            hasTrafficLights: true,
            speedLimitSign: 30,
          },
          new THREE.Vector3(sideStreet.x, 0.011, zSeg.cz),
          0,
        );
      }
    }

    // --- H. 交差点フラットアスファルト接続パッド＆交差点路面標示（x ∈ {-268, -156, 0, +156, +270} × z ∈ {5, 165, 250, 365}） ---
    // Why not PuddleMaterial を交差点パッドに使うか:
    // PuddleMaterial は歩道・広場タイル用の単色シェーダーであり、前後の車道セグメント（JapaneseRoadMaterial）と
    // アスファルト砕石骨材・石英チップ・微細クラック・3D法線バンプ・色調が異なるため、交差点だけ真っ黒な別マテリアルの板に見えてしまう。
    // 車道と同一の JapaneseRoadMaterial({ isIntersection: true }) を共有し、さらに交差点内の横断歩道・車線誘導ドット破線を重畳する。
    const intersectionPadMat = new JapaneseRoadMaterial({
      baseRoughness: 0.85,
      baseMetalness: 0.12,
      isIntersection: true,
    });
    this.roadMaterials.push(intersectionPadMat);

    const addIntersectionPadAndMarkings = (
      ix: number,
      iz: number,
      widthX: number,
      depthZ: number,
      lanesX: number,
      lanesZ: number,
      hasCrosswalks = true,
    ): void => {
      const interGroup = new THREE.Group();
      interGroup.name = `Intersection_${ix}_${iz}`;
      interGroup.userData.isRoadInfrastructure = true;
      interGroup.position.set(ix, 0.0115, iz);

      const padGeo = new THREE.PlaneGeometry(widthX, depthZ, 8, 8);
      padGeo.rotateX(-Math.PI / 2);
      const padMesh = new THREE.Mesh(padGeo, intersectionPadMat);
      padMesh.userData.isRoadInfrastructure = true;
      padMesh.receiveShadow = true;
      interGroup.add(padMesh);

      const interMarkings = this.roadBuilder.buildIntersectionMarkingGroup(widthX, depthZ, {
        lanesX,
        lanesZ,
        hasCrosswalks,
        hasCenterDiamond: lanesX >= 2 && lanesZ >= 2,
      });
      interMarkings.userData.isRoadInfrastructure = true;
      interGroup.add(interMarkings);

      this.group.add(interGroup);

      // 交差点内の平坦路面コライダー（車道セグメントと同じ上面高さ y = 0.012 で段差なく接続）
      const padColDesc = rapier.ColliderDesc.cuboid(widthX / 2, 0.25, depthZ / 2)
        .setTranslation(ix, 0.512 - 0.25, iz)
        .setFriction(0.85)
        .setRestitution(0.02);
      this.registerCollider(world.createCollider(padColDesc, groundBody), false);
    };

    const intersectionXs = [-268, 0, 270];
    const intersectionZs = [
      { z: 5, depth: 22, lanesZ: 1 },
      { z: 165, depth: 22, lanesZ: 1 },
      { z: 250, depth: 32, lanesZ: 3 },
      { z: 365, depth: 26, lanesZ: 2 },
    ];
    for (const ix of intersectionXs) {
      for (const iz of intersectionZs) {
        addIntersectionPadAndMarkings(ix, iz.z, 26, iz.depth, 2, iz.lanesZ, true);
      }
    }
    for (const sideIx of [-156, 156]) {
      for (const iz of [
        { z: 5, depth: 22, lanesZ: 1 },
        { z: 165, depth: 22, lanesZ: 1 },
        { z: 250, depth: 32, lanesZ: 3 },
      ]) {
        addIntersectionPadAndMarkings(sideIx, iz.z, 20, iz.depth, 1, iz.lanesZ, true);
      }
    }

    // 丸の内駅前広場の石畳歩道（グレータイル・水たまりシェーダー適用：行幸通り南端 z = -10m の手前に配置）
    const plazaGeo = new THREE.PlaneGeometry(220, 28);
    plazaGeo.rotateX(-Math.PI / 2);
    const plazaMat = new PuddleMaterial({
      baseColor: 0x64748b,
      baseRoughness: 0.72,
      baseMetalness: 0.08,
      puddleThreshold: 0.44,
    });
    this.puddleMaterials.push(plazaMat);
    const plaza = new THREE.Mesh(plazaGeo, plazaMat);
    plaza.userData.isRoadInfrastructure = true;
    plaza.position.set(0, 0.025, -24.5);
    plaza.receiveShadow = true;
    this.group.add(plaza);

    // 行幸通りサイドエスプラネード石畳広場（丸の内中央通り〜仲通り〜日比谷通りの間の街区歩道外側に分割配置し、交差道路車道との重なりを回避）
    const esplanadeMat = new PuddleMaterial({
      baseColor: 0x475569,
      baseRoughness: 0.75,
      baseMetalness: 0.1,
      puddleThreshold: 0.43,
    });
    this.puddleMaterials.push(esplanadeMat);

    for (const espSeg of [
      { cz: 85, len: 132 },
      { cz: 205, len: 54 },
    ]) {
      const esplanadeGeo = new THREE.PlaneGeometry(22, espSeg.len);
      esplanadeGeo.rotateX(-Math.PI / 2);
      for (const sideX of [-25, 25]) {
        const espMesh = new THREE.Mesh(esplanadeGeo, esplanadeMat);
        espMesh.userData.isRoadInfrastructure = true;
        espMesh.position.set(sideX, 0.02, espSeg.cz);
        espMesh.receiveShadow = true;
        this.group.add(espMesh);
      }
    }

    // 皇居外苑（Kokyo Gaien）の玉砂利・大芝生苑地（和田倉濠・日比谷濠と内堀通りの間の緑地広場 z = 342）
    const kokyoLawnMat = new THREE.MeshStandardMaterial({
      color: 0x2d4c2b,
      roughness: 0.92,
      metalness: 0.04,
    });
    for (const lawnX of [-135, 135, -380, 382]) {
      const lawnGeo = new THREE.PlaneGeometry(180, 26);
      lawnGeo.rotateX(-Math.PI / 2);
      const lawnMesh = new THREE.Mesh(lawnGeo, kokyoLawnMat);
      lawnMesh.userData.isRoadInfrastructure = true;
      lawnMesh.position.set(lawnX, 0.015, 340);
      lawnMesh.receiveShadow = true;
      this.group.add(lawnMesh);
    }

    // --- I. 渋谷駅周辺街中グリッド道路網（明治通り x = -750 / 国道246号 z = 95 / 稲荷橋通り z = -95 / 並木橋通り z = -200 / 宮下公園通り z = 195 / 桜丘西通り x = -855 / 金王坂通り x = -645） ---
    // Why 明治通りを4箇所の交差点（z = -200, -95, +95, +195）で3区間に分割するか:
    // 1本の長尺セグメントで生成すると歩道縁石・ガードレールコライダーが稲荷橋（渋谷ストリーム前 z=-95）や並木橋（z=-200）、
    // 宮下公園前（z=+195）の交差点を完全に塞いでしまい、街中への右左折進入ができなくなるため。
    for (const meijiSeg of [
      { cz: -147.5, len: 83 }, // z = -189 .. -106（並木橋〜稲荷橋・渋谷三丁目街区）
      { cz: 0.0, len: 164 }, // z = -82 .. +82（渋谷ストリーム・サクラステージ・フクラス正面街区）
      { cz: 146.5, len: 75 }, // z = +109 .. +184（渋谷駅東口・ヒカリエ・スクランブルスクエア街区）
      { cz: 221.5, len: 41 }, // z = +201 .. +242（宮下公園前〜宮益坂下交差点南）
    ]) {
      addRoadSegment(
        {
          name: "Meiji-dori-Shibuya",
          lanesPerDirection: 3,
          laneWidth: 3.5,
          shoulderWidth: 1.5,
          sidewalkWidth: 4.5,
          curbHeight: 0.15,
          length: meijiSeg.len,
          hasYellowCenterLine: false,
          hasWhiteDashedLines: true,
          hasCrosswalk: true,
          hasGuardrails: true,
          hasManholes: true,
          hasTrafficLights: true,
          speedLimitSign: 50,
        },
        new THREE.Vector3(-750, 0.011, meijiSeg.cz),
        0,
      );
    }

    // 国道246号・玉川通り・青山通り渋谷区間（z = 95: フクラス西 x=-844 〜 明治通り西 x=-767、および明治通り東 x=-733 〜 金王坂交差点西 x=-656）
    // Why x = -632 以東をここで直線生成しないか:
    // 金王坂交差点（x = -645, z = 95）より東側の青山通り区間（x = -632 .. -283）は国土地理院オープンデータの曲線道路コリドー（nav-road-route246）として
    // 緩やかなS字カーブで生成されるため、渋谷街中グリッド内の2区間のみ直線セグメントで構築して金王坂交差点を開口させる。
    for (const r246Seg of [
      { cx: -805.5, len: 77, rot: Math.PI / 2 }, // x = -844 .. -767
      { cx: -694.5, len: 77, rot: -Math.PI / 2 }, // x = -733 .. -656
    ]) {
      addRoadSegment(
        {
          name: "Route-246-Shibuya",
          lanesPerDirection: 2,
          laneWidth: 3.5,
          shoulderWidth: 1.5,
          sidewalkWidth: 4.0,
          curbHeight: 0.15,
          length: r246Seg.len,
          hasYellowCenterLine: false,
          hasWhiteDashedLines: true,
          hasCrosswalk: true,
          hasGuardrails: true,
          hasManholes: true,
          hasTrafficLights: true,
          speedLimitSign: 50,
        },
        new THREE.Vector3(r246Seg.cx, 0.012, 95),
        r246Seg.rot,
      );
    }

    // I-2. 渋谷街中東西ストリート（稲荷橋通り z = -95 / 並木橋通り z = -200 / 宮下公園・美竹通り z = 195）
    // How: 渋谷ストリーム・サクラステージ・スクランブルスクエア・ヒカリエ・渋谷三丁目ビルの周囲を回遊できるよう東西街路を開通させる。
    for (const ewStreet of [
      { z: -95, name: "Shibuya-Inaribashi-St" },
      { z: -200, name: "Shibuya-Namikibashi-St" },
      { z: 195, name: "Shibuya-Miyashita-Mitake-St" },
    ]) {
      for (const xSeg of [
        { cx: -805.5, len: 77, rot: Math.PI / 2 }, // x = -844 .. -767（西街区）
        { cx: -694.5, len: 77, rot: -Math.PI / 2 }, // x = -733 .. -656（東街区・渋谷川横断）
      ]) {
        addRoadSegment(
          {
            name: ewStreet.name,
            lanesPerDirection: 1,
            laneWidth: 3.25,
            shoulderWidth: 1.0,
            sidewalkWidth: 2.5,
            curbHeight: 0.15,
            length: xSeg.len,
            hasYellowCenterLine: false,
            hasWhiteDashedLines: true,
            hasCrosswalk: true,
            hasGuardrails: false,
            hasManholes: true,
            hasTrafficLights: true,
            speedLimitSign: 30,
          },
          new THREE.Vector3(xSeg.cx, 0.012, ewStreet.z),
          xSeg.rot,
        );
      }
    }

    // I-3. 渋谷西口・桜丘ウエスト通り（x = -855: サクラステージ・フクラス・スクランブルスクエア西側）
    // ※ z = -200 .. -95 区間は国土地理院曲線道路コリドー（nav-road-shibuya-sakuragaoka-loop）として生成されるため、z = -95 以北を構築する
    for (const westSeg of [
      { cz: 0.0, len: 164 }, // z = -82 .. +82
      { cz: 146.5, len: 75 }, // z = +109 .. +184
    ]) {
      addRoadSegment(
        {
          name: "Shibuya-Sakuragaoka-West-St",
          lanesPerDirection: 1,
          laneWidth: 3.25,
          shoulderWidth: 1.0,
          sidewalkWidth: 2.5,
          curbHeight: 0.15,
          length: westSeg.len,
          hasYellowCenterLine: false,
          hasWhiteDashedLines: true,
          hasCrosswalk: true,
          hasGuardrails: true,
          hasManholes: true,
          hasTrafficLights: true,
          speedLimitSign: 30,
        },
        new THREE.Vector3(-855, 0.011, westSeg.cz),
        0,
      );
    }

    // I-4. 金王坂・渋谷三丁目イースト通り（x = -645: 渋谷ストリーム・ヒカリエ・渋谷三丁目ビル東側）
    for (const eastSeg of [
      { cz: -147.5, len: 83 }, // z = -189 .. -106
      { cz: 0.0, len: 164 }, // z = -82 .. +82
      { cz: 146.5, len: 75 }, // z = +109 .. +184
    ]) {
      addRoadSegment(
        {
          name: "Shibuya-Konnozaka-East-St",
          lanesPerDirection: 1,
          laneWidth: 3.25,
          shoulderWidth: 1.0,
          sidewalkWidth: 2.5,
          curbHeight: 0.15,
          length: eastSeg.len,
          hasYellowCenterLine: false,
          hasWhiteDashedLines: true,
          hasCrosswalk: true,
          hasGuardrails: true,
          hasManholes: true,
          hasTrafficLights: true,
          speedLimitSign: 30,
        },
        new THREE.Vector3(-645, 0.011, eastSeg.cz),
        0,
      );
    }

    // I-5. 渋谷エリア全12交差点（x ∈ {-855, -750, -645} × z ∈ {-200, -95, +95, +195}）フラットアスファルト接続パッド＆路面標示
    const shibuyaIntersectionXs = [
      { x: -855, width: 22, lanesX: 1 },
      { x: -750, width: 32, lanesX: 3 },
      { x: -645, width: 22, lanesX: 1 },
    ];
    const shibuyaIntersectionZs = [
      { z: -200, depth: 20, lanesZ: 1 },
      { z: -95, depth: 22, lanesZ: 1 },
      { z: 95, depth: 26, lanesZ: 2 },
      { z: 195, depth: 20, lanesZ: 1 },
    ];
    for (const sx of shibuyaIntersectionXs) {
      for (const sz of shibuyaIntersectionZs) {
        addIntersectionPadAndMarkings(sx.x, sz.z, sx.width, sz.depth, sx.lanesX, sz.lanesZ, true);
      }
    }

    // I-5b. 渋谷駅前東西連絡路（宮益坂下交差点西 x = -766 〜 スクランブル交差点東 x = -794、z = 248）
    addRoadSegment(
      {
        name: "Shibuya-Station-Link-St",
        lanesPerDirection: 2,
        laneWidth: 3.5,
        shoulderWidth: 1.2,
        sidewalkWidth: 3.0,
        curbHeight: 0.15,
        length: 28,
        hasYellowCenterLine: false,
        hasWhiteDashedLines: true,
        hasCrosswalk: false,
        hasGuardrails: false,
        hasManholes: false,
        hasTrafficLights: false,
        speedLimitSign: 40,
      },
      new THREE.Vector3(-780, 0.012, 248),
      Math.PI / 2,
    );

    // 渋谷スクランブル交差点（x = -815, z = 248）および宮益坂下交差点（x = -750, z = 248）
    addIntersectionPadAndMarkings(-815, 248, 42, 42, 2, 2, true);
    addIntersectionPadAndMarkings(-750, 248, 32, 24, 3, 2, true);

    // 渋谷スクランブル交差点 象徴の対角線X字型スクランブル横断歩道（斜め横断歩道）
    const scrambleInterGroup = new THREE.Group();
    scrambleInterGroup.name = "ShibuyaScrambleDiagonalCrosswalks";
    scrambleInterGroup.userData.isRoadInfrastructure = true;
    scrambleInterGroup.position.set(-815, 0.024, 248);
    const diagonalStripeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (const dir of [1, -1]) {
      const diagAngle = (dir * Math.PI) / 4;
      const count = 28;
      const stepDist = 1.1;
      for (let i = -count / 2; i <= count / 2; i++) {
        const offset = i * stepDist;
        const stripeGeo = new THREE.PlaneGeometry(0.45, 3.8);
        stripeGeo.rotateX(-Math.PI / 2);
        stripeGeo.rotateY(diagAngle);
        const stripeMesh = new THREE.Mesh(stripeGeo, diagonalStripeMat);
        stripeMesh.position.set(offset * Math.cos(diagAngle), 0, offset * Math.sin(diagAngle));
        scrambleInterGroup.add(stripeMesh);
      }
    }
    this.group.add(scrambleInterGroup);

    // 永代通り×国道246号T字交差点（x = -268 × z = 95）フラットアスファルト接続パッド＆路面標示
    addIntersectionPadAndMarkings(-268, 95, 26, 26, 2, 2, true);

    // --- J. 国土地理院 道路中心線 (experimental_rdcl) & PLATEAU 道路網オープンデータに基づく曲線・屈曲道路区間 ---
    const curvedRoadCorridors = getOpenDataCurvedRoadCorridors();
    for (const curvedCorridor of curvedRoadCorridors) {
      const lanesPerDir = Math.max(1, Math.min(3, Math.round(curvedCorridor.widthMeters / 8.5)));
      const isArterialCategory = curvedCorridor.category !== "local_street";
      const polyRes = this.roadBuilder.buildPolylineSegment(
        {
          name: curvedCorridor.displayName,
          lanesPerDirection: lanesPerDir,
          laneWidth: 3.4,
          shoulderWidth: 1.2,
          sidewalkWidth: 3.2,
          curbHeight: 0.15,
          length: 120,
          hasYellowCenterLine: lanesPerDir === 1 && isArterialCategory,
          hasWhiteDashedLines: lanesPerDir >= 2,
          hasCrosswalk: false,
          hasGuardrails: isArterialCategory,
          hasManholes: false,
          hasTrafficLights: false,
          speedLimitSign: isArterialCategory ? 50 : 40,
          points: curvedCorridor.points,
        },
        curvedCorridor.points,
        world,
        rapier,
        0.011,
      );
      this.group.add(polyRes.group);
      this.roadMaterials.push(...polyRes.materials);
      this.puddleMaterials.push(...polyRes.puddleMaterials);
      this.colliders.push(...polyRes.colliders);
      this.obstacleColliderHandles.push(...polyRes.obstacleColliderHandles);
    }

    // --- K. 10倍広域マップ拡張: 渋谷南北・西側延伸大動脈（原宿・代々木・恵比寿・山手通り・神泉・駒沢通り） ---
    // How: 渋谷エリアを東西 1600m × 南北 2200m へ大拡張し、原宿・代々木公園・恵比寿・山手通り（環状6号線）を直結する
    // 1. 明治通り北延伸（原宿・神宮前・代々木方面）
    for (const meijiNorth of [
      { cz: 398.5, len: 277 }, // 宮益坂下 z=260 .. 神宮前交差点 z=537
      { cz: 700.0, len: 274 }, // 神宮前 z=563 .. 原宿駅前交差点 z=837
      { cz: 981.5, len: 237 }, // 原宿駅前 z=863 .. 代々木・千駄ヶ谷北端 z=1100
    ]) {
      addRoadSegment(
        {
          name: "Meiji-dori-North-Harajuku",
          lanesPerDirection: 3,
          laneWidth: 3.5,
          shoulderWidth: 1.5,
          sidewalkWidth: 4.5,
          curbHeight: 0.15,
          length: meijiNorth.len,
          hasYellowCenterLine: false,
          hasWhiteDashedLines: true,
          hasCrosswalk: true,
          hasGuardrails: true,
          hasManholes: true,
          hasTrafficLights: true,
          speedLimitSign: 50,
        },
        new THREE.Vector3(-750, 0.011, meijiNorth.cz),
        0,
      );
    }

    // 2. 明治通り南延伸（並木橋〜恵比寿駅前〜広尾方面）
    for (const meijiSouth of [
      { cz: -373.5, len: 327 }, // 並木橋南 z=-210 .. 渋谷橋交差点 z=-537
      { cz: -675.0, len: 224 }, // 渋谷橋 z=-563 .. 恵比寿駅前交差点 z=-787
      { cz: -931.5, len: 237 }, // 恵比寿駅前 z=-813 .. 広尾方面南端 z=-1050
    ]) {
      addRoadSegment(
        {
          name: "Meiji-dori-South-Ebisu",
          lanesPerDirection: 3,
          laneWidth: 3.5,
          shoulderWidth: 1.5,
          sidewalkWidth: 4.5,
          curbHeight: 0.15,
          length: meijiSouth.len,
          hasYellowCenterLine: false,
          hasWhiteDashedLines: true,
          hasCrosswalk: true,
          hasGuardrails: true,
          hasManholes: true,
          hasTrafficLights: true,
          speedLimitSign: 50,
        },
        new THREE.Vector3(-750, 0.011, meijiSouth.cz),
        0,
      );
    }

    // 3. 道玄坂上〜神泉〜山手通り（東西大通り: z = 95）
    addRoadSegment(
      {
        name: "Dogenzaka-Shinsen-Connector",
        lanesPerDirection: 2,
        laneWidth: 3.5,
        shoulderWidth: 1.2,
        sidewalkWidth: 3.5,
        curbHeight: 0.15,
        length: 468,
        hasYellowCenterLine: false,
        hasWhiteDashedLines: true,
        hasCrosswalk: true,
        hasGuardrails: true,
        hasManholes: true,
        hasTrafficLights: true,
        speedLimitSign: 50,
      },
      new THREE.Vector3(-1100, 0.012, 95),
      Math.PI / 2,
    );

    // 4. 山手通り（環状6号線: x = -1350 南北縦断幹線）
    for (const yamateSeg of [
      { cz: -706.5, len: 287 }, // 南端 z=-850 .. 駒沢通り z=-563
      { cz: -227.5, len: 619 }, // 駒沢通り z=-537 .. 神泉交差点 z=82
      { cz: 322.5, len: 429 }, // 神泉 z=108 .. 富ヶ谷交差点 z=537
      { cz: 706.5, len: 287 }, // 富ヶ谷 z=563 .. 北端 z=850
    ]) {
      addRoadSegment(
        {
          name: "Yamate-dori-Ring6",
          lanesPerDirection: 3,
          laneWidth: 3.5,
          shoulderWidth: 1.5,
          sidewalkWidth: 4.0,
          curbHeight: 0.15,
          length: yamateSeg.len,
          hasYellowCenterLine: false,
          hasWhiteDashedLines: true,
          hasCrosswalk: true,
          hasGuardrails: true,
          hasManholes: true,
          hasTrafficLights: true,
          speedLimitSign: 60,
        },
        new THREE.Vector3(-1350, 0.011, yamateSeg.cz),
        0,
      );
    }

    // 5. 恵比寿・駒沢通り（東西幹線: z = -550）
    for (const komazawaSeg of [
      { cx: -1050, len: 568, rot: Math.PI / 2 }, // 山手通り x=-1334 .. 明治通り x=-766
      { cx: -650, len: 168, rot: -Math.PI / 2 }, // 明治通り x=-734 .. 外苑西通り x=-566
    ]) {
      addRoadSegment(
        {
          name: "Komazawa-dori-Ebisu",
          lanesPerDirection: 2,
          laneWidth: 3.5,
          shoulderWidth: 1.2,
          sidewalkWidth: 3.5,
          curbHeight: 0.15,
          length: komazawaSeg.len,
          hasYellowCenterLine: false,
          hasWhiteDashedLines: true,
          hasCrosswalk: true,
          hasGuardrails: true,
          hasManholes: true,
          hasTrafficLights: true,
          speedLimitSign: 50,
        },
        new THREE.Vector3(komazawaSeg.cx, 0.012, -550),
        komazawaSeg.rot,
      );
    }

    // --- L. 10倍広域マップ拡張: 青山・六本木・赤坂大動脈（六本木通り・外苑西通り・外苑東通り・青山通り本線） ---
    // 1. 六本木通り（都道412号: z = -350, 渋谷〜西麻布〜六本木ヒルズ〜赤坂アークヒルズ〜日比谷公園）
    for (const roppongiSeg of [
      { cx: -465, len: 138 }, // 西麻布 x=-534 .. 六本木 x=-396
      { cx: -280, len: 168 }, // 六本木 x=-364 .. 溜池 x=-196
      { cx: -90, len: 148 }, // 溜池 x=-164 .. 日比谷公園 x=-16
    ]) {
      addRoadSegment(
        {
          name: "Roppongi-dori",
          lanesPerDirection: 3,
          laneWidth: 3.5,
          shoulderWidth: 1.5,
          sidewalkWidth: 4.5,
          curbHeight: 0.15,
          length: roppongiSeg.len,
          hasYellowCenterLine: false,
          hasWhiteDashedLines: true,
          hasCrosswalk: true,
          hasGuardrails: true,
          hasManholes: true,
          hasTrafficLights: true,
          speedLimitSign: 50,
        },
        new THREE.Vector3(roppongiSeg.cx, 0.012, -350),
        Math.PI / 2,
      );
    }

    // 2. 外苑西通り（キラー通り: x = -550 南北幹線）
    for (const gaienWestSeg of [
      { cz: -50, len: 568 }, // 西麻布 z=-334 .. 青山通り表参道 z=234
      { cz: 400, len: 268 }, // 表参道 z=266 .. 原宿北 z=534
    ]) {
      addRoadSegment(
        {
          name: "Gaien-Nishi-dori",
          lanesPerDirection: 2,
          laneWidth: 3.5,
          shoulderWidth: 1.2,
          sidewalkWidth: 3.5,
          curbHeight: 0.15,
          length: gaienWestSeg.len,
          hasYellowCenterLine: false,
          hasWhiteDashedLines: true,
          hasCrosswalk: true,
          hasGuardrails: true,
          hasManholes: true,
          hasTrafficLights: true,
          speedLimitSign: 50,
        },
        new THREE.Vector3(-550, 0.011, gaienWestSeg.cz),
        0,
      );
    }

    // 3. 外苑東通り（x = -380 南北幹線: 六本木〜青山一丁目〜信濃町）
    for (const gaienEastSeg of [
      { cz: -50, len: 568 }, // 六本木 z=-334 .. 青山一丁目 z=234
      { cz: 400, len: 268 }, // 青山一丁目 z=266 .. 信濃町方面 z=534
    ]) {
      addRoadSegment(
        {
          name: "Gaien-Higashi-dori",
          lanesPerDirection: 2,
          laneWidth: 3.5,
          shoulderWidth: 1.2,
          sidewalkWidth: 3.5,
          curbHeight: 0.15,
          length: gaienEastSeg.len,
          hasYellowCenterLine: false,
          hasWhiteDashedLines: true,
          hasCrosswalk: true,
          hasGuardrails: true,
          hasManholes: true,
          hasTrafficLights: true,
          speedLimitSign: 50,
        },
        new THREE.Vector3(-380, 0.011, gaienEastSeg.cz),
        0,
      );
    }

    // 4. 青山通り（国道246号）本線東西（z = 250: 表参道〜外苑前〜青山一丁目〜赤坂見附）
    for (const r246Main of [
      { cx: -465, len: 138 }, // 表参道 x=-534 .. 外苑前・青山一丁目 x=-396
      { cx: -324, len: 80 }, // 青山一丁目 x=-364 .. 赤坂見附永代通り接続 x=-284
    ]) {
      addRoadSegment(
        {
          name: "Route-246-Aoyama-dori-Main",
          lanesPerDirection: 3,
          laneWidth: 3.5,
          shoulderWidth: 1.5,
          sidewalkWidth: 4.0,
          curbHeight: 0.15,
          length: r246Main.len,
          hasYellowCenterLine: false,
          hasWhiteDashedLines: true,
          hasCrosswalk: true,
          hasGuardrails: true,
          hasManholes: true,
          hasTrafficLights: true,
          speedLimitSign: 60,
        },
        new THREE.Vector3(r246Main.cx, 0.012, 250),
        Math.PI / 2,
      );
    }

    // --- M. 10倍広域マップ拡張: 皇居一周パノラマ大周回道路（内堀通り周回コース） ---
    // 1. 皇居西側・内堀通り（三宅坂〜半蔵門〜イギリス大使館前: x = -350）
    addRoadSegment(
      {
        name: "Uchibori-dori-West-Hanzomon",
        lanesPerDirection: 3,
        laneWidth: 3.5,
        shoulderWidth: 1.5,
        sidewalkWidth: 4.5,
        curbHeight: 0.15,
        length: 456,
        hasYellowCenterLine: false,
        hasWhiteDashedLines: true,
        hasCrosswalk: true,
        hasGuardrails: true,
        hasManholes: true,
        hasTrafficLights: true,
        speedLimitSign: 50,
      },
      new THREE.Vector3(-350, 0.011, 606),
      0,
    );

    // 2. 皇居北側・内堀通り（千鳥ヶ淵〜北の丸公園〜竹橋: z = 850）
    addRoadSegment(
      {
        name: "Uchibori-dori-North-Takebashi",
        lanesPerDirection: 3,
        laneWidth: 3.5,
        shoulderWidth: 1.5,
        sidewalkWidth: 4.5,
        curbHeight: 0.15,
        length: 318,
        hasYellowCenterLine: false,
        hasWhiteDashedLines: true,
        hasCrosswalk: true,
        hasGuardrails: true,
        hasManholes: true,
        hasTrafficLights: true,
        speedLimitSign: 50,
      },
      new THREE.Vector3(-175, 0.012, 850),
      Math.PI / 2,
    );

    // 3. 皇居東側・内堀通り（竹橋〜気象庁前〜大手門・大手町: x = 0）
    addRoadSegment(
      {
        name: "Uchibori-dori-East-Otemon",
        lanesPerDirection: 3,
        laneWidth: 3.5,
        shoulderWidth: 1.5,
        sidewalkWidth: 4.5,
        curbHeight: 0.15,
        length: 456,
        hasYellowCenterLine: false,
        hasWhiteDashedLines: true,
        hasCrosswalk: true,
        hasGuardrails: true,
        hasManholes: true,
        hasTrafficLights: true,
        speedLimitSign: 50,
      },
      new THREE.Vector3(0, 0.011, 606),
      0,
    );

    // --- N. 10倍広域マップ拡張: 神田・秋葉原・日本橋（北側大動脈） ---
    // 1. 中央通り北延伸（日本橋〜神田駅前〜万世橋・秋葉原: x = 156）
    addRoadSegment(
      {
        name: "Chuo-dori-North-Kanda",
        lanesPerDirection: 2,
        laneWidth: 3.5,
        shoulderWidth: 1.2,
        sidewalkWidth: 4.0,
        curbHeight: 0.15,
        length: 568,
        hasYellowCenterLine: false,
        hasWhiteDashedLines: true,
        hasCrosswalk: true,
        hasGuardrails: true,
        hasManholes: true,
        hasTrafficLights: true,
        speedLimitSign: 40,
      },
      new THREE.Vector3(156, 0.011, 550),
      0,
    );

    // 2. 昭和通り（都道316号: x = 650, 新橋〜銀座〜宝町〜日本橋〜神田〜秋葉原の片側4車線メガコリドー）
    for (const showaSeg of [
      { cz: -550, len: 368 }, // 新橋 z=-734 .. 晴海通り z=-366
      { cz: -171, len: 326 }, // 晴海通り z=-334 .. 鍛冶橋通り z=-8
      { cz: 126, len: 216 }, // 鍛冶橋通り z=18 .. 永代通り z=234
      { cz: 550, len: 568 }, // 永代通り z=266 .. 神田・秋葉原 z=834
    ]) {
      addRoadSegment(
        {
          name: "Showa-dori-Mega-Arterial",
          lanesPerDirection: 4,
          laneWidth: 3.5,
          shoulderWidth: 1.8,
          sidewalkWidth: 5.0,
          curbHeight: 0.15,
          length: showaSeg.len,
          hasYellowCenterLine: false,
          hasWhiteDashedLines: true,
          hasCrosswalk: true,
          hasGuardrails: true,
          hasManholes: true,
          hasTrafficLights: true,
          speedLimitSign: 60,
        },
        new THREE.Vector3(650, 0.011, showaSeg.cz),
        0,
      );
    }

    // --- O. 10倍広域マップ拡張: 銀座・数寄屋橋・晴海通り・新橋・汐留（南東エリア） ---
    // 1. 銀座中央通り（京橋〜銀座一丁目〜銀座四丁目〜新橋: x = 156）
    for (const ginzaSeg of [
      { cz: -170, len: 328 }, // 京橋 z=-6 .. 銀座四丁目 z=-334
      { cz: -550, len: 368 }, // 銀座四丁目 z=-366 .. 新橋 z=-734
    ]) {
      addRoadSegment(
        {
          name: "Ginza-Chuo-dori",
          lanesPerDirection: 2,
          laneWidth: 3.5,
          shoulderWidth: 1.2,
          sidewalkWidth: 5.0,
          curbHeight: 0.15,
          length: ginzaSeg.len,
          hasYellowCenterLine: false,
          hasWhiteDashedLines: true,
          hasCrosswalk: true,
          hasGuardrails: false,
          hasManholes: true,
          hasTrafficLights: true,
          speedLimitSign: 40,
        },
        new THREE.Vector3(156, 0.011, ginzaSeg.cz),
        0,
      );
    }

    // 2. 晴海通り（日比谷公園〜数寄屋橋〜銀座四丁目〜歌舞伎座〜昭和通り: z = -350）
    for (const harumiSeg of [
      { cx: 78, len: 124 }, // 数寄屋橋 x=16 .. 銀座四丁目 x=140
      { cx: 402, len: 460 }, // 銀座四丁目 x=172 .. 東銀座昭和通り x=632
      { cx: 734, len: 132 }, // 昭和通り東 x=668 .. 勝鬨橋方面 x=800
    ]) {
      addRoadSegment(
        {
          name: "Harumi-dori-Ginza",
          lanesPerDirection: 3,
          laneWidth: 3.5,
          shoulderWidth: 1.5,
          sidewalkWidth: 4.5,
          curbHeight: 0.15,
          length: harumiSeg.len,
          hasYellowCenterLine: false,
          hasWhiteDashedLines: true,
          hasCrosswalk: true,
          hasGuardrails: true,
          hasManholes: true,
          hasTrafficLights: true,
          speedLimitSign: 50,
        },
        new THREE.Vector3(harumiSeg.cx, 0.012, -350),
        Math.PI / 2,
      );
    }

    // 3. 日比谷通り南延伸（内幸町〜新橋SL広場〜第一京浜・汐留: x = 0）
    for (const hibiyaSouthSeg of [
      { cz: -170, len: 328 }, // 日比谷 z=-6 .. 数寄屋橋 z=-334
      { cz: -550, len: 368 }, // 数寄屋橋 z=-366 .. 新橋 z=-734
      { cz: -908, len: 284 }, // 新橋 z=-766 .. 第一京浜南端 z=-1050
    ]) {
      addRoadSegment(
        {
          name: "Hibiya-dori-South-Shimbashi",
          lanesPerDirection: 3,
          laneWidth: 3.5,
          shoulderWidth: 1.5,
          sidewalkWidth: 4.5,
          curbHeight: 0.15,
          length: hibiyaSouthSeg.len,
          hasYellowCenterLine: false,
          hasWhiteDashedLines: true,
          hasCrosswalk: true,
          hasGuardrails: true,
          hasManholes: true,
          hasTrafficLights: true,
          speedLimitSign: 50,
        },
        new THREE.Vector3(0, 0.011, hibiyaSouthSeg.cz),
        0,
      );
    }

    // 4. 新橋・汐留東西大通り（虎ノ門〜新橋SL広場〜汐留シオサイト: z = -750）
    for (const shimbashiSeg of [
      { cx: -134, len: 236 }, // 虎ノ門 x=-252 .. 新橋 x=-16
      { cx: 78, len: 124 }, // 新橋 x=16 .. 銀座南 x=140
      { cx: 402, len: 460 }, // 銀座南 x=172 .. 汐留昭和通り x=632
    ]) {
      addRoadSegment(
        {
          name: "Shimbashi-Shiodome-Avenue",
          lanesPerDirection: 3,
          laneWidth: 3.5,
          shoulderWidth: 1.5,
          sidewalkWidth: 4.5,
          curbHeight: 0.15,
          length: shimbashiSeg.len,
          hasYellowCenterLine: false,
          hasWhiteDashedLines: true,
          hasCrosswalk: true,
          hasGuardrails: true,
          hasManholes: true,
          hasTrafficLights: true,
          speedLimitSign: 50,
        },
        new THREE.Vector3(shimbashiSeg.cx, 0.012, -750),
        Math.PI / 2,
      );
    }

    // --- P. 10倍広域マップ拡張: 新規主要交差点フラット接続パッド＆路面標示群 ---
    const expandedIntersections: Array<{
      x: number;
      z: number;
      width: number;
      depth: number;
      lanesX: number;
      lanesZ: number;
    }> = [
      // 原宿・神宮前・代々木
      { x: -750, z: 550, width: 32, depth: 26, lanesX: 3, lanesZ: 2 },
      { x: -750, z: 850, width: 32, depth: 26, lanesX: 3, lanesZ: 2 },
      // 恵比寿・渋谷橋
      { x: -750, z: -550, width: 32, depth: 26, lanesX: 3, lanesZ: 2 },
      { x: -750, z: -800, width: 32, depth: 26, lanesX: 3, lanesZ: 2 },
      // 山手通り（神泉・駒沢通り・富ヶ谷）
      { x: -1350, z: 95, width: 32, depth: 26, lanesX: 3, lanesZ: 2 },
      { x: -1350, z: -550, width: 32, depth: 26, lanesX: 3, lanesZ: 2 },
      { x: -1350, z: 550, width: 32, depth: 26, lanesX: 3, lanesZ: 2 },
      // 青山・六本木・赤坂
      { x: -550, z: -350, width: 32, depth: 32, lanesX: 3, lanesZ: 2 }, // 西麻布交差点
      { x: -380, z: -350, width: 32, depth: 32, lanesX: 3, lanesZ: 2 }, // 六本木交差点
      { x: -180, z: -150, width: 32, depth: 26, lanesX: 3, lanesZ: 2 }, // 赤坂・溜池
      { x: -550, z: 250, width: 32, depth: 32, lanesX: 3, lanesZ: 3 }, // 表参道交差点
      { x: -380, z: 250, width: 32, depth: 32, lanesX: 3, lanesZ: 2 }, // 青山一丁目交差点
      // 皇居周回（三宅坂・半蔵門・竹橋）
      { x: -350, z: 365, width: 32, depth: 32, lanesX: 3, lanesZ: 2 }, // 三宅坂交差点
      { x: -350, z: 850, width: 32, depth: 32, lanesX: 3, lanesZ: 3 }, // 半蔵門・千鳥ヶ淵交差点
      { x: 0, z: 850, width: 32, depth: 32, lanesX: 3, lanesZ: 3 }, // 竹橋交差点
      // 銀座・数寄屋橋・晴海通り・新橋・汐留
      { x: 0, z: -350, width: 32, depth: 32, lanesX: 3, lanesZ: 3 }, // 数寄屋橋交差点
      { x: 156, z: -350, width: 32, depth: 32, lanesX: 3, lanesZ: 2 }, // 銀座四丁目交差点（世界的大交差点）
      { x: 650, z: -350, width: 36, depth: 32, lanesX: 4, lanesZ: 3 }, // 東銀座・三原橋交差点
      { x: 0, z: -750, width: 32, depth: 32, lanesX: 3, lanesZ: 3 }, // 新橋交差点（SL広場前）
      { x: 650, z: -750, width: 36, depth: 32, lanesX: 4, lanesZ: 3 }, // 汐留交差点
      // 昭和通り（鍛冶橋・永代）
      { x: 650, z: 5, width: 36, depth: 26, lanesX: 4, lanesZ: 2 },
      { x: 650, z: 250, width: 36, depth: 32, lanesX: 4, lanesZ: 3 },
      // 神田・秋葉原
      { x: 156, z: 850, width: 32, depth: 26, lanesX: 2, lanesZ: 2 },
    ];
    for (const expInt of expandedIntersections) {
      addIntersectionPadAndMarkings(
        expInt.x,
        expInt.z,
        expInt.width,
        expInt.depth,
        expInt.lanesX,
        expInt.lanesZ,
        true,
      );
    }
  }

  /**
   * 建築石材・赤レンガ・ドーム緑青銅板・カーテンウォールガラス・陽極酸化アルミ・黒鋳鉄マテリアルに
   * 3D ボリュームテクスチャ (`sampler3D`) を注入する
   * Why not: 2D UV テクスチャではプロシージャル Box / Cylinder や非同期 GLB メッシュ間で
   * タイリング継ぎ目やアスペクト比歪みが生じるため、3次元ワールド座標 `vArchWorldPos` で
   * `uArchVolumeTex` と `uPropVolumeTex` を直接サンプリングして完全シームレスな立体質感を付与する。
   */
  private applyArchitecture3DTexture(
    mat: THREE.MeshStandardMaterial,
    mode:
      | "brick"
      | "red_brick"
      | "granite"
      | "white_granite"
      | "moat"
      | "copper_patina"
      | "curtain_glass"
      | "anodized_metal"
      | "cast_iron"
      | "stone_punched"
      | "ribbon_window"
      | "retail_storefront",
  ): void {
    const isAlreadyApplied = Boolean(mat.userData?.hasArch3DVolumeShader);
    if (isAlreadyApplied) {
      return;
    }
    mat.userData = {
      ...mat.userData,
      hasArch3DVolumeShader: true,
      arch3DMode: mode,
      arch3DVolumeChannel: mode,
    };

    const archVolumeTex = Procedural3DTextureGenerator.getSharedArchitecture3DTexture();
    const propVolumeTex = Procedural3DTextureGenerator.getSharedRoadMarkingProp3DTexture();

    const isRedBrick = mode === "brick" || mode === "red_brick";
    const isWhiteGranite = mode === "granite" || mode === "white_granite";
    const isMoatWall = mode === "moat";
    const isCopperPatina = mode === "copper_patina";
    const isCurtainGlass = mode === "curtain_glass";
    const isAnodizedMetal = mode === "anodized_metal";
    const isStonePunched = mode === "stone_punched";
    const isRibbonWindow = mode === "ribbon_window";
    const isRetailStorefront = mode === "retail_storefront";

    let modeCode = 6; // "cast_iron"
    if (isRedBrick) {
      modeCode = 0;
    } else if (isWhiteGranite) {
      modeCode = 1;
    } else if (isMoatWall) {
      modeCode = 2;
    } else if (isCopperPatina) {
      modeCode = 3;
    } else if (isCurtainGlass) {
      modeCode = 4;
    } else if (isAnodizedMetal) {
      modeCode = 5;
    } else if (isStonePunched) {
      modeCode = 7;
    } else if (isRibbonWindow) {
      modeCode = 8;
    } else if (isRetailStorefront) {
      modeCode = 9;
    }

    // Why 単一のシェーダープログラムと uniform int uArchSurfaceMode 分岐を使うか:
    // モードごとに異なる GLSL 文字列をコンパイルすると、Three.js の複雑な PBR シェーダーが10種類別々にリンクされ、
    // ANGLE Metal バックエンドでのシェーダーコンパイル時間およびコマンドバッファ切り替え負荷が増大するため。
    mat.customProgramCacheKey = () => "arch_3d_tex_unified_v3";
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uArchVolumeTex = { value: archVolumeTex };
      shader.uniforms.uPropVolumeTex = { value: propVolumeTex };
      shader.uniforms.uArchSurfaceMode = { value: modeCode };
      shader.uniforms.uNightModeFactor = this.sharedArchUniforms.uNightModeFactor;

      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        varying vec3 vArchWorldPos;
        varying vec3 vArchNormal;
        `,
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <worldpos_vertex>",
        /* glsl */ `
        #include <worldpos_vertex>
        vArchWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vArchNormal = normalize(mat3(modelMatrix) * normal);
        `,
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        uniform sampler3D uArchVolumeTex;
        uniform sampler3D uPropVolumeTex;
        uniform int uArchSurfaceMode;
        uniform float uNightModeFactor;
        varying vec3 vArchWorldPos;
        varying vec3 vArchNormal;
        `,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        /* glsl */ `
        #include <color_fragment>
        float archViewDist = length(vViewPosition);
        vec4 archVolMacro = vec4(0.5);
        vec4 archVolMicro = vec4(0.5);
        vec4 propVolSample = vec4(0.5);

        // 3D ボリュームテクスチャ（近〜中距離サンプリング: LOD0 <= 72m, LOD1 <= 135m, LOD2 > 135m は軽量化バイパス）
        if (archViewDist < 135.0) {
          archVolMacro = texture(uArchVolumeTex, vArchWorldPos * 0.22);
          if (archViewDist < 30.0) {
            archVolMicro = texture(uArchVolumeTex, vArchWorldPos * 0.65);
            propVolSample = texture(uPropVolumeTex, vArchWorldPos * 0.48);
          } else {
            archVolMicro = archVolMacro;
            propVolSample = archVolMacro;
          }
        }

        // 壁面幾何グリッド座標（Screen-space anti-aliased procedural facade）
        vec3 absArchNorm = abs(vArchNormal);
        bool isFacadeWall = absArchNorm.y < 0.68;
        float facadeU = (absArchNorm.x > absArchNorm.z) ? vArchWorldPos.z : vArchWorldPos.x;
        float facadeV = vArchWorldPos.y;
        float dWallU = max(fwidth(facadeU) * 1.5, 0.002);
        float dWallV = max(fwidth(facadeV) * 1.5, 0.002);

        // PLATEAU LOD2 環境映り込み（木々の緑・路面アスファルトの照り返し）
        // 沿道街路樹（y in [1.5, 15.0]）および路面（y < 3.2）の反射環境光を近景・中景（archViewDist < 135.0）で合成
        if (archViewDist < 135.0 && isFacadeWall) {
          float treeReflectionFactor = smoothstep(1.5, 4.5, vArchWorldPos.y) * (1.0 - smoothstep(8.5, 15.0, vArchWorldPos.y));
          float groundReflectionFactor = 1.0 - smoothstep(0.0, 3.2, vArchWorldPos.y);
          vec3 treeFoliageReflection = vec3(0.12, 0.26, 0.14) * (0.8 + 0.4 * archVolMacro.g);
          vec3 groundWarmReflection = vec3(0.24, 0.22, 0.20) * (0.85 + 0.3 * archVolMacro.r);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb + treeFoliageReflection, treeReflectionFactor * 0.28);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb + groundWarmReflection, groundReflectionFactor * 0.22);
        }

        #ifdef USE_MAP
        // 実写テクスチャ（PLATEAU LOD2写真、Google マップ / ストリートビュー写真、看板、電子ビジョン、道路標識等）が存在する場合は、
        // プロシージャル色帯での上書きを行わず、テクスチャ本来の高解像度な実写色彩を100%保持。
        // 遠距離（LOD2: archViewDist >= 180.0）ではテクスチャMipmapサンプリングのみで3Dノイズ演算を完全スキップ
        if (archViewDist < 180.0) {
          diffuseColor.rgb *= mix(0.93, 1.05, archVolMacro.r * 0.65 + archVolMicro.r * 0.35);
        }
        #else
        if (archViewDist > 235.0) {
          // 遠距離（LOD2）: 複雑なプロシージャル計算を完全スキップして軽量均一シェーディング
          diffuseColor.rgb *= mix(0.92, 1.02, archVolMacro.r);
        } else if (uArchSurfaceMode == 0) {
          // 赤レンガ・テラコッタ（東京駅丸の内駅舎・東京海上日動ビルなど）
          float clayGrain = mix(archVolMacro.r, archVolMicro.r, 0.45);
          float mortarJoint = smoothstep(0.62, 0.88, archVolMacro.g);
          if (archViewDist < 60.0 && isFacadeWall) {
            float brickH = 0.075;
            float brickL = 0.225;
            float rowIdx = floor(facadeV / brickH);
            float uShift = mod(rowIdx, 2.0) * (brickL * 0.5);
            float uInBrick = mod(facadeU + uShift, brickL);
            float vInBrick = mod(facadeV, brickH);
            float edgeH = 1.0 - smoothstep(0.012 - dWallV, 0.012 + dWallV, vInBrick);
            float edgeV = 1.0 - smoothstep(0.012 - dWallU, 0.012 + dWallU, uInBrick);
            mortarJoint = max(mortarJoint, max(edgeH, edgeV) * 0.72);
          }
          vec3 brickTone = diffuseColor.rgb * mix(0.82, 1.16, clayGrain) * mix(0.88, 1.04, archVolMacro.b);
          vec3 mortarColor = vec3(0.76, 0.73, 0.69);
          diffuseColor.rgb = mix(brickTone, mortarColor, mortarJoint * 0.32) * mix(0.90, 1.05, archVolMicro.a);
        } else if (uArchSurfaceMode == 1) {
          // 白御影石・ポディウム石張りパネル
          float biotiteCrystal = mix(archVolMacro.r, archVolMicro.r, 0.52);
          float panelJoint = 0.0;
          if (archViewDist < 180.0 && isFacadeWall) {
            float panelW = 1.2;
            float panelH = 0.9;
            float pRow = floor(facadeV / panelH);
            float pShift = mod(pRow, 2.0) * (panelW * 0.5);
            float uInPanel = mod(facadeU + pShift, panelW);
            float vInPanel = mod(facadeV, panelH);
            float edgeH = 1.0 - smoothstep(0.022 - dWallV, 0.022 + dWallV, vInPanel);
            float edgeV = 1.0 - smoothstep(0.022 - dWallU, 0.022 + dWallU, uInPanel);
            panelJoint = max(edgeH, edgeV) * (1.0 - smoothstep(120.0, 180.0, archViewDist));
          }
          float stoneJoint = max(smoothstep(0.66, 0.90, archVolMacro.g), panelJoint * 0.6);
          diffuseColor.rgb *= mix(0.86, 1.12, biotiteCrystal) * (1.0 - stoneJoint * 0.22) * mix(0.92, 1.04, archVolMacro.b);
        } else if (uArchSurfaceMode == 2) {
          // 皇居石垣・巨石
          float megalithJoint = smoothstep(0.55, 0.85, archVolMacro.g);
          vec3 stoneShade = diffuseColor.rgb * mix(0.78, 1.15, archVolMicro.r) * (1.0 - megalithJoint * 0.26);
          vec3 dampMossTint = vec3(0.22, 0.29, 0.24);
          diffuseColor.rgb = mix(stoneShade, dampMossTint, smoothstep(0.58, 0.86, archVolMacro.b) * 0.32);
        } else if (uArchSurfaceMode == 3) {
          // 緑青銅板屋根
          vec3 verdigrisTint = vec3(0.11, 0.52, 0.46);
          vec3 agedBronzeTint = diffuseColor.rgb * mix(0.84, 1.16, archVolMacro.r * 0.6 + propVolSample.b * 0.4);
          diffuseColor.rgb = mix(agedBronzeTint, verdigrisTint, smoothstep(0.42, 0.78, archVolMacro.b) * 0.35);
        } else if (uArchSurfaceMode == 4) {
          // 全面ガラスカーテンウォール高層タワー（Low-E ガラス ＋ 垂直アルミマリオン ＋ 水平スパンドレル）
          if (isFacadeWall && archViewDist < 360.0) {
            float floorH = 3.8;
            float bayW = 1.8;
            float spandrelH = 1.05;
            float mullionW = 0.18;

            float vInFloor = mod(facadeV, floorH);
            float uInBay = mod(facadeU, bayW);

            float isSpandrel = 1.0 - smoothstep(spandrelH - dWallV, spandrelH + dWallV, vInFloor);
            float isMullion = 1.0 - smoothstep(mullionW - dWallU, mullionW + dWallU, uInBay);
            float isGlass = (1.0 - isSpandrel) * (1.0 - isMullion);

            float topShadow = mix(0.84, 1.06, smoothstep(spandrelH, floorH, vInFloor));
            vec3 glassColor = diffuseColor.rgb * topShadow;
            vec3 spandrelColor = diffuseColor.rgb * 0.68;
            vec3 mullionColor = mix(diffuseColor.rgb, vec3(0.85, 0.88, 0.92), 0.55);

            diffuseColor.rgb = mix(spandrelColor, glassColor, isGlass);
            diffuseColor.rgb = mix(diffuseColor.rgb, mullionColor, isMullion * 0.85);
            diffuseColor.rgb *= mix(0.92, 1.08, archVolMacro.r);
          } else {
            float floorDepthMod = mix(0.88, 1.14, archVolMacro.r * 0.6 + archVolMacro.b * 0.4);
            float coatingShimmer = mix(0.94, 1.08, propVolSample.r);
            diffuseColor.rgb *= floorDepthMod * coatingShimmer;
          }
        } else if (uArchSurfaceMode == 5) {
          // アルミマリオン・ルーバー
          diffuseColor.rgb *= mix(0.88, 1.14, propVolSample.b) * mix(0.92, 1.05, archVolMacro.b);
        } else if (uArchSurfaceMode == 6) {
          // 鋳鉄・ダークフレーム
          diffuseColor.rgb *= mix(0.84, 1.16, propVolSample.a * 0.65 + propVolSample.b * 0.35) * mix(0.90, 1.06, archVolMacro.b);
        } else if (uArchSurfaceMode == 7) {
          // 石張り連窓ファサード（丸の内ポストモダン・重厚な石造柱梁 ＋ 縦長窓）
          if (isFacadeWall && archViewDist < 360.0) {
            float floorH = 3.9;
            float bayW = 2.4;
            float spandrelH = 1.45;
            float pillarW = 0.65;

            float vInFloor = mod(facadeV, floorH);
            float uInBay = mod(facadeU, bayW);

            float isSpandrel = 1.0 - smoothstep(spandrelH - dWallV, spandrelH + dWallV, vInFloor);
            float isPillar = 1.0 - smoothstep(pillarW - dWallU, pillarW + dWallU, uInBay);
            float isGlass = (1.0 - isSpandrel) * (1.0 - isPillar);

            float biotiteCrystal = mix(archVolMacro.r, archVolMicro.r, 0.45);
            vec3 stoneColor = diffuseColor.rgb * mix(0.88, 1.12, biotiteCrystal);
            vec3 windowDark = diffuseColor.rgb * 0.32;
            diffuseColor.rgb = mix(stoneColor, windowDark, isGlass * 0.78);
          } else {
            diffuseColor.rgb *= mix(0.86, 1.12, archVolMacro.r);
          }
        } else if (uArchSurfaceMode == 8) {
          // 水平リボン連窓ファサード（中層オフィス・帯状ガラス窓 ＋ メタル/コンクリートスパンドレル）
          if (isFacadeWall && archViewDist < 360.0) {
            float floorH = 3.6;
            float spandrelH = 1.55;
            float vInFloor = mod(facadeV, floorH);
            float isSpandrel = 1.0 - smoothstep(spandrelH - dWallV, spandrelH + dWallV, vInFloor);
            float isGlass = 1.0 - isSpandrel;

            vec3 spandrelColor = diffuseColor.rgb * mix(0.92, 1.06, archVolMacro.b);
            vec3 glassColor = diffuseColor.rgb * 0.50 * mix(0.84, 1.08, smoothstep(spandrelH, floorH, vInFloor));

            float bayW = 1.6;
            float mullionW = 0.12;
            float uInBay = mod(facadeU, bayW);
            float isMullion = 1.0 - smoothstep(mullionW - dWallU, mullionW + dWallU, uInBay);

            diffuseColor.rgb = mix(spandrelColor, glassColor, isGlass);
            diffuseColor.rgb = mix(diffuseColor.rgb, spandrelColor * 1.15, isGlass * isMullion * 0.65);
          } else {
            diffuseColor.rgb *= mix(0.90, 1.10, archVolMacro.r);
          }
        } else if (uArchSurfaceMode == 9) {
          // 1F〜2F路面店舗・ショーウィンドウ・ロビーガラス
          if (isFacadeWall && archViewDist < 250.0) {
            float bayW = 3.6;
            float uInBay = mod(facadeU, bayW);
            float columnW = 0.45;
            float isColumn = 1.0 - smoothstep(columnW - dWallU, columnW + dWallU, uInBay);

            float vStore = mod(facadeV, 7.0);
            float baseH = 0.4;
            float transomH = 1.2;
            float isBase = 1.0 - smoothstep(baseH - dWallV, baseH + dWallV, vStore);
            float isTransom = smoothstep(7.0 - transomH - dWallV, 7.0 - transomH + dWallV, vStore);
            float isGlass = (1.0 - isBase) * (1.0 - isTransom) * (1.0 - isColumn);

            vec3 frameColor = diffuseColor.rgb * 0.72;
            vec3 glassDisplay = diffuseColor.rgb * 1.18;
            diffuseColor.rgb = mix(frameColor, glassDisplay, isGlass * 0.85);
          } else {
            diffuseColor.rgb *= 1.08;
          }
        }
        #endif
        `,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <emissivemap_fragment>",
        /* glsl */ `
        #include <emissivemap_fragment>
        #ifdef USE_EMISSIVEMAP
        // 看板・LEDビジョン・道路標識等の実写 emissiveMap がある場合は、テクスチャ本来の発光色彩と
        // マテリアル側の emissiveIntensity 設定を尊重する
        #else
        if (uNightModeFactor > 0.01 && isFacadeWall && archViewDist < 360.0) {
          bool hasWindows = (uArchSurfaceMode == 4 || uArchSurfaceMode == 7 || uArchSurfaceMode == 8 || uArchSurfaceMode == 9);
          if (hasWindows) {
            float floorH = (uArchSurfaceMode == 8) ? 3.6 : (uArchSurfaceMode == 7 ? 3.9 : (uArchSurfaceMode == 9 ? 7.0 : 3.8));
            float bayW = (uArchSurfaceMode == 8) ? 1.6 : (uArchSurfaceMode == 7 ? 2.4 : (uArchSurfaceMode == 9 ? 3.6 : 1.8));
            float spandrelH = (uArchSurfaceMode == 8) ? 1.55 : (uArchSurfaceMode == 7 ? 1.45 : (uArchSurfaceMode == 9 ? 0.4 : 1.05));
            float mullionW = (uArchSurfaceMode == 8) ? 0.12 : (uArchSurfaceMode == 7 ? 0.65 : (uArchSurfaceMode == 9 ? 0.45 : 0.18));

            float vInFloor = mod(facadeV, floorH);
            float uInBay = mod(facadeU, bayW);
            float isSpandrel = 1.0 - smoothstep(spandrelH - dWallV, spandrelH + dWallV, vInFloor);
            float isMullion = 1.0 - smoothstep(mullionW - dWallU, mullionW + dWallU, uInBay);
            float isGlass = (1.0 - isSpandrel) * (1.0 - isMullion);

            if (isGlass > 0.05) {
              float floorId = floor(facadeV / floorH);
              float bayId = floor(facadeU / bayW);
              vec2 roomSeed = floor(vArchWorldPos.xz * 0.02) * 17.13;
              float roomHash = fract(sin(dot(vec2(floorId, bayId) + roomSeed, vec2(12.9898, 78.233))) * 43758.5453);

              float litThreshold = (uArchSurfaceMode == 9) ? 0.10 : 0.40;
              if (roomHash > litThreshold) {
                float colorMix = fract(roomHash * 7.31);
                vec3 coolLight = vec3(0.92, 0.96, 1.0);
                vec3 warmLight = vec3(1.0, 0.84, 0.58);
                vec3 roomLightColor = mix(coolLight, warmLight, colorMix);

                float blindFrac = fract(roomHash * 11.19);
                float windowNormV = (vInFloor - spandrelH) / max(floorH - spandrelH, 0.001);
                float blindCoverage = blindFrac * 0.65;
                float blindFactor = (windowNormV > (1.0 - blindCoverage)) ? 0.15 : 1.0;

                float distFade = 1.0 - smoothstep(280.0, 360.0, archViewDist);
                float lightIntensity = (uArchSurfaceMode == 9 ? 1.6 : 1.25) * uNightModeFactor * blindFactor * distFade;

                totalEmissiveRadiance += roomLightColor * isGlass * lightIntensity;
              }
            }
          }
        }
        #endif
        `,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <normal_fragment_maps>",
        /* glsl */ `
        #include <normal_fragment_maps>
        if (archViewDist < 28.0) {
          float archPerturbScale = (uArchSurfaceMode == 2) ? 0.11 : (uArchSurfaceMode == 4 ? 0.035 : 0.065);
          vec3 archPerturb = vec3(
            (archVolMicro.r - 0.5) * archPerturbScale,
            (archVolMicro.g - 0.5) * archPerturbScale,
            0.0
          );
          normal = normalize(normal + mat3(viewMatrix) * archPerturb);
        }
        `,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <roughnessmap_fragment>",
        /* glsl */ `
        #include <roughnessmap_fragment>
        if (archViewDist < 72.0) {
          roughnessFactor = clamp(roughnessFactor + (archVolMacro.a - 0.5) * 0.14, 0.08, 0.96);
        }
        if (isFacadeWall && (uArchSurfaceMode == 4 || uArchSurfaceMode == 8)) {
          float floorH = (uArchSurfaceMode == 8) ? 3.6 : 3.8;
          float spandrelH = (uArchSurfaceMode == 8) ? 1.55 : 1.05;
          float vInFloor = mod(facadeV, floorH);
          float isSpandrel = 1.0 - smoothstep(spandrelH - dWallV, spandrelH + dWallV, vInFloor);
          float isGlass = 1.0 - isSpandrel;
          roughnessFactor = mix(roughnessFactor, 0.06, isGlass * 0.7);
        }
        `,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <metalnessmap_fragment>",
        /* glsl */ `
        #include <metalnessmap_fragment>
        if (isFacadeWall && (uArchSurfaceMode == 4 || uArchSurfaceMode == 8)) {
          float floorH = (uArchSurfaceMode == 8) ? 3.6 : 3.8;
          float spandrelH = (uArchSurfaceMode == 8) ? 1.55 : 1.05;
          float vInFloor = mod(facadeV, floorH);
          float isSpandrel = 1.0 - smoothstep(spandrelH - dWallV, spandrelH + dWallV, vInFloor);
          float isGlass = 1.0 - isSpandrel;
          metalnessFactor = mix(metalnessFactor, 0.92, isGlass * 0.45);
        }
        `,
      );
    };
    mat.needsUpdate = true;
  }

  private attachArchitecture3DVolumeShader(
    mat: THREE.MeshStandardMaterial,
    channel:
      | "brick"
      | "red_brick"
      | "granite"
      | "white_granite"
      | "moat"
      | "copper_patina"
      | "curtain_glass"
      | "anodized_metal"
      | "cast_iron"
      | "stone_punched"
      | "ribbon_window"
      | "retail_storefront",
  ): void {
    this.applyArchitecture3DTexture(mat, channel);
  }

  private buildTokyoStationBuilding(world: RAPIER.World, rapier: typeof RAPIER): void {
    const stationGroup = new THREE.Group();
    stationGroup.position.set(0, 0, -45); // 丸の内駅前広場の東側
    stationGroup.userData.isLargeStructure = true;
    this.proceduralStationGroup = stationGroup;

    // 赤レンガマテリアル（3D ボリュームテクスチャ統合）
    const redBrickMat = new THREE.MeshStandardMaterial({
      color: 0xb91c1c,
      roughness: 0.82,
      metalness: 0.05,
    });
    this.applyArchitecture3DTexture(redBrickMat, "red_brick");

    // 白御影石トリム（3D ボリュームテクスチャ統合）
    const whiteStoneMat = new THREE.MeshStandardMaterial({
      color: 0xf3f4f6,
      roughness: 0.58,
      metalness: 0.1,
    });
    this.applyArchitecture3DTexture(whiteStoneMat, "white_granite");

    // スレート屋根・ドーム（青緑銅板パティナ＆スレート結晶 3D ボリュームテクスチャ統合）
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x0f766e, // 酸化銅グリーン
      roughness: 0.45,
      metalness: 0.4,
    });
    this.applyArchitecture3DTexture(roofMat, "copper_patina");

    // 1. 中央部（皇居正対中央棟: 幅50m, 奥行き24m, 高さ26m）
    const centerGeo = new THREE.BoxGeometry(50, 24, 22);
    const centerMesh = new THREE.Mesh(centerGeo, redBrickMat);
    centerMesh.position.y = 12;
    centerMesh.castShadow = true;
    centerMesh.receiveShadow = true;
    stationGroup.add(centerMesh);

    // 中央棟の三角形ペディメント（切妻装飾）
    const pedimentGeo = new THREE.ConeGeometry(8, 6, 4);
    pedimentGeo.rotateY(Math.PI / 4);
    const pediment = new THREE.Mesh(pedimentGeo, whiteStoneMat);
    pediment.position.set(0, 26, 0);
    stationGroup.add(pediment);

    // 2. 南北の主翼（ウィング棟: 全長約330mを再現）
    const wingGeo = new THREE.BoxGeometry(110, 18, 20);
    const northWing = new THREE.Mesh(wingGeo, redBrickMat);
    northWing.position.set(-85, 9, 0);
    northWing.castShadow = true;
    stationGroup.add(northWing);

    const southWing = new THREE.Mesh(wingGeo, redBrickMat);
    southWing.position.set(85, 9, 0);
    southWing.castShadow = true;
    stationGroup.add(southWing);

    // 3. 南北八角形ドーム（特徴的な象徴シンボル）
    const domePositions = [-145, 145];
    for (const domeX of domePositions) {
      // 8角形塔
      const towerGeo = new THREE.CylinderGeometry(14, 15, 24, 8);
      const tower = new THREE.Mesh(towerGeo, redBrickMat);
      tower.position.set(domeX, 12, 0);
      stationGroup.add(tower);

      // 八角形ドーム屋根
      const domeRoofGeo = new THREE.ConeGeometry(15, 14, 8);
      const domeRoof = new THREE.Mesh(domeRoofGeo, roofMat);
      domeRoof.position.set(domeX, 30, 0);
      stationGroup.add(domeRoof);
    }

    // 白い窓枠・ストライプ装飾帯（実物の赤レンガと白帯のデザイン）
    for (let y = 5; y <= 20; y += 5) {
      const stripeGeo = new THREE.BoxGeometry(320, 0.6, 22.4);
      const stripe = new THREE.Mesh(stripeGeo, whiteStoneMat);
      stripe.position.set(0, y, 0);
      stripe.userData.lodDetailTier = "medium";
      stationGroup.add(stripe);
    }

    this.group.add(stationGroup);

    // 駅舎全体の物理コライダー（Rapier: 主棟 + 南北八角形ドーム塔の張り出し部）
    const stationBodyDesc = rapier.RigidBodyDesc.fixed().setTranslation(0, 12, -45);
    const stationBody = world.createRigidBody(stationBodyDesc);
    const stationCollider = rapier.ColliderDesc.cuboid(165, 15, 15)
      .setFriction(0.5)
      .setRestitution(0.1);
    this.registerCollider(world.createCollider(stationCollider, stationBody), true);

    for (const domeX of domePositions) {
      const domeTowerCol = this.createCylinderDesc(rapier, 15, 15.5)
        .setTranslation(domeX, 0, 0)
        .setFriction(0.5)
        .setRestitution(0.1);
      this.registerCollider(world.createCollider(domeTowerCol, stationBody), true);
    }

    // 4. Blender CLI で生成した PLATEAU 準拠 GLB 駅舎モデルの非同期ロード
    if (!this.deferGlbLoads) {
      this.glbLoadPromises.push(this.loadGlbStationModel());
    }
  }

  /**
   * GLB東京駅モデル内の各メッシュマテリアルを名前・メッシュ名・色から判定し、対応する3Dボリュームテクスチャを適用する
   */
  private applyStationGlbMaterial3DTexture(
    mat: THREE.Material | null | undefined,
    meshName: string,
  ): void {
    const isStandardMat = Boolean(
      mat && (mat as THREE.MeshStandardMaterial).isMeshStandardMaterial,
    );
    if (!isStandardMat) {
      return;
    }

    const stdMat = mat as THREE.MeshStandardMaterial;
    const matName = stdMat.name || "";
    const r = stdMat.color?.r ?? 0.5;
    const g = stdMat.color?.g ?? 0.5;
    const b = stdMat.color?.b ?? 0.5;

    const isBrickByName = matName.includes("RedBrick") || matName.includes("Brick");
    const isBrickByColor = r > 0.42 && r > g * 1.7 && r > b * 1.7;
    const isRedBrick = isBrickByName || isBrickByColor;
    if (isRedBrick) {
      this.applyArchitecture3DTexture(stdMat, "red_brick");
      return;
    }

    const isStoneByName =
      matName.includes("WhiteStone") ||
      matName.includes("Stone") ||
      matName.includes("ClockDial") ||
      meshName.includes("FacadeDetails");
    const isStoneByColor = r > 0.72 && g > 0.72 && b > 0.7;
    const isWhiteGranite = isStoneByName || isStoneByColor;
    if (isWhiteGranite) {
      this.applyArchitecture3DTexture(stdMat, "white_granite");
      return;
    }

    const isRoofByName =
      matName.includes("CopperRoof") ||
      matName.includes("SlateRoof") ||
      matName.includes("Roof") ||
      meshName.includes("Dome");
    const isCopperByColor = g > r * 1.3 && b > r * 1.2;
    const isCopperOrSlateRoof = isRoofByName || isCopperByColor;
    if (isCopperOrSlateRoof) {
      this.applyArchitecture3DTexture(stdMat, "copper_patina");
      return;
    }

    const isWindowGlass = matName.includes("WindowGlass") || matName.includes("Glass");
    if (isWindowGlass) {
      this.applyArchitecture3DTexture(stdMat, "curtain_glass");
      return;
    }

    const isDarkBronze = matName.includes("DarkBronze") || matName.includes("Bronze");
    if (isDarkBronze) {
      this.applyArchitecture3DTexture(stdMat, "cast_iron");
      return;
    }

    this.applyArchitecture3DTexture(stdMat, "red_brick");
  }

  private loadGlbStationModel(): Promise<void> {
    const isBrowser = typeof window !== "undefined";
    if (!isBrowser) {
      return Promise.resolve();
    }
    const isAlreadyLoaded = this.glbStationGroup !== null;
    if (isAlreadyLoaded) {
      return Promise.resolve();
    }
    const hasInflightPromise = this.stationGlbLoadingPromise !== null;
    if (hasInflightPromise && this.stationGlbLoadingPromise) {
      return this.stationGlbLoadingPromise;
    }

    const config = assetManager.getModelConfig("tokyo_station");
    const rawPath = config?.path ?? "/models/tokyo_station.glb";
    const modelPath = assetManager.resolveAssetUrl(rawPath);
    const loader = new GLTFLoader();
    const loadPromise = new Promise<void>((resolve) => {
      loader.load(
        modelPath,
        (gltf) => {
          const glbModel = gltf.scene;
          const hasLoadedScene = Boolean(glbModel);
          if (!hasLoadedScene) {
            this.stationGlbLoadingPromise = null;
            resolve();
            return;
          }

          const zOffset = config?.offset[2] ?? -45;
          glbModel.position.set(0, 0, zOffset);
          glbModel.userData.basePositionY = 0;
          glbModel.userData.baseScaleY = 1;
          glbModel.traverse((child) => {
            const isMesh = (child as THREE.Mesh).isMesh;
            if (!isMesh) {
              return;
            }
            const mesh = child as THREE.Mesh;
            mesh.castShadow = true;
            mesh.receiveShadow = true;

            // How: GLB内の単一または配列マテリアルを走査し、赤レンガ・白御影石・緑青銅板屋根等の3Dテクスチャを適用する
            const isMaterialArray = Array.isArray(mesh.material);
            if (isMaterialArray) {
              const matList = mesh.material as THREE.Material[];
              for (let i = 0; i < matList.length; i++) {
                this.applyStationGlbMaterial3DTexture(matList[i], mesh.name);
              }
            } else {
              this.applyStationGlbMaterial3DTexture(mesh.material as THREE.Material, mesh.name);
            }
          });

          this.glbStationGroup = glbModel;
          this.group.add(glbModel);
          this.registerObjectInChunk(glbModel, "marunouchi-core");

          // GLBモデルが正常に配置されたら初期状態としてプロシージャル駅舎を非表示に切り替え（185m超の遠距離では updateDistanceCulling が軽量プロキシとして再表示する）
          const hasProceduralGroup = Boolean(this.proceduralStationGroup);
          if (hasProceduralGroup) {
            this.proceduralStationGroup!.visible = false;
          }
          const isMarunouchiUnloaded = this.unloadedChunkIds.has("marunouchi-core");
          glbModel.visible = !isMarunouchiUnloaded;

          const hasValidLastFocus = !Number.isNaN(this.lastCulledFocusPos.x);
          if (hasValidLastFocus) {
            const prevFocus = this.lastCulledFocusPos.clone();
            this.updateDistanceCulling(prevFocus, 380, true);
          }
          this.stationGlbLoadingPromise = null;
          resolve();
        },
        undefined,
        (error) => {
          console.warn("Notice: Using procedural Tokyo Station model (GLB load skipped):", error);
          this.stationGlbLoadingPromise = null;
          resolve();
        },
      );
    });
    this.stationGlbLoadingPromise = loadPromise;
    return loadPromise;
  }

  /**
   * 渋谷ストリーム（Shibuya Stream）および渋谷駅南口・渋谷川・稲荷橋広場の構築。
   * How:
   * 1. Blender MCP / CLI で実写を参照してモデリングした `shibuya_stream.glb` をロードし、
   *    白アルミ千鳥フィン・溶融亜鉛メッキ鉄骨・杉板本実型枠コンクリート・Low-Eカーテンウォールに
   *    WebGL2 3D ボリュームテクスチャ (`sampler3D`) を適用する。
   * 2. 稲荷橋広場（Inaribashi Plaza）と渋谷川清流復活水路（3Dコースティクス水面シェーダー + 壁泉ウォーターウォール）、
   *    および周辺の渋谷スクランブルスクエア・渋谷ヒカリエ・渋谷サクラステージ・渋谷フクラスを構築する。
   */
  private buildShibuyaStreamDistrict(world: RAPIER.World, rapier: typeof RAPIER): void {
    const streamCenterX = -695.0;
    const streamCenterZ = -15.0;

    // 1. プロシージャル初期フォールバック（GLB非同期ロード前やヘッドレス単体テスト用）
    const fallbackStreamGroup = new THREE.Group();
    fallbackStreamGroup.name = "ShibuyaStreamProceduralFallback";
    fallbackStreamGroup.position.set(streamCenterX, 0, streamCenterZ);
    fallbackStreamGroup.rotation.y = -Math.PI / 2;
    fallbackStreamGroup.userData.isLargeStructure = true;
    this.proceduralShibuyaStreamGroup = fallbackStreamGroup;

    const whitePanelMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      roughness: 0.32,
      metalness: 0.45,
    });
    this.applyArchitecture3DTexture(whitePanelMat, "anodized_metal");

    const darkFrameMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.48,
      metalness: 0.78,
    });
    this.applyArchitecture3DTexture(darkFrameMat, "cast_iron");

    const streamGlassMat = new THREE.MeshPhysicalMaterial({
      color: 0x1e3a5f,
      roughness: 0.12,
      metalness: 0.82,
      reflectivity: 0.94,
      clearcoat: 0.9,
    });
    this.applyArchitecture3DTexture(streamGlassMat, "curtain_glass");

    // 低層ポディウム（1F〜3F 商業・大階段・広場フレーム。rotation.y = -Math.PI/2 によりローカル +Z がワールド -X 明治通り正面を向く）
    const podiumMesh = new THREE.Mesh(new THREE.BoxGeometry(58, 18, 42), darkFrameMat);
    podiumMesh.position.set(0, 9, 6);
    podiumMesh.castShadow = true;
    podiumMesh.receiveShadow = true;
    fallbackStreamGroup.add(podiumMesh);

    // 中層4Fボイド（エントランスロビー・コート階層）
    const midVoidMesh = new THREE.Mesh(new THREE.BoxGeometry(54, 14, 38), streamGlassMat);
    midVoidMesh.position.set(0, 25, 4);
    fallbackStreamGroup.add(midVoidMesh);

    // 高層タワー（14F〜35F オフィスタワー本体 + 白水平・千鳥フィン）
    const highRiseHeight = 148;
    const highRiseMesh = new THREE.Mesh(
      new THREE.BoxGeometry(50, highRiseHeight, 36),
      streamGlassMat,
    );
    highRiseMesh.position.set(0, 32 + highRiseHeight / 2, 0);
    highRiseMesh.castShadow = true;
    highRiseMesh.receiveShadow = true;
    fallbackStreamGroup.add(highRiseMesh);

    for (let floor = 0; floor < 22; floor++) {
      const finY = 34 + floor * 6.5;
      const finMesh = new THREE.Mesh(new THREE.BoxGeometry(51.4, 1.35, 37.4), whitePanelMat);
      finMesh.position.set(0, finY, 0);
      finMesh.userData.lodDetailTier = "medium";
      fallbackStreamGroup.add(finMesh);
    }

    // プロシージャルフォールバック用の渋谷ストリーム建築サインパネル（ローカル +Z = ワールド -X 明治通り側正面）
    const streamAccentColors = [0xd6e614, 0xf8fafc, 0xd6e614, 0xf8fafc];
    const badgeBackMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: this.isNightActive ? 0.95 : 0.55,
      roughness: 0.2,
    });
    this.shibuyaStreamEmissiveEntries.push({
      material: badgeBackMat,
      dayIntensity: 0.55,
      nightIntensity: 0.95,
    });
    const badgeBack = new THREE.Mesh(new THREE.BoxGeometry(20, 4.2, 0.8), badgeBackMat);
    badgeBack.name = "FallbackStreamBadgeBack";
    badgeBack.position.set(0, 26.5, 20.2);
    badgeBack.userData.lodDetailTier = "medium";
    fallbackStreamGroup.add(badgeBack);

    for (let i = 0; i < streamAccentColors.length; i++) {
      const barMat = new THREE.MeshStandardMaterial({
        color: streamAccentColors[i],
        emissive: streamAccentColors[i],
        emissiveIntensity: this.isNightActive ? 1.35 : 0.75,
        roughness: 0.18,
      });
      this.shibuyaStreamEmissiveEntries.push({
        material: barMat,
        dayIntensity: 0.75,
        nightIntensity: 1.35,
      });
      const barBox = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.2, 1.0), barMat);
      barBox.position.set(-6.0 + i * 4.0, 26.5, 20.5);
      barBox.userData.lodDetailTier = "medium";
      fallbackStreamGroup.add(barBox);
    }

    this.group.add(fallbackStreamGroup);

    // 渋谷ストリーム本体・大階段・広場案内モニュメントの Rapier 物理コライダー
    const streamBody = world.createRigidBody(
      rapier.RigidBodyDesc.fixed().setTranslation(streamCenterX, 90, streamCenterZ),
    );
    const streamCol = rapier.ColliderDesc.cuboid(21, 90, 27.5).setFriction(0.5).setRestitution(0.1);
    this.registerCollider(world.createCollider(streamCol, streamBody), true);

    // 稲荷橋広場の大階段（Grand Staircase: worldX = -729.8..-716.0, worldZ = -8.3..+2.3）
    const grandStairsCol = rapier.ColliderDesc.cuboid(6.9, 7.25, 5.3)
      .setTranslation(-27.9, -82.75, 12.0)
      .setFriction(0.6)
      .setRestitution(0.05);
    this.registerCollider(world.createCollider(grandStairsCol, streamBody), true);

    // 稲荷橋広場の路面アイレベル渋谷ストリーム案内モニュメントサイン（worldX = -726.2, worldZ = -21.0）
    const monolithSignCol = rapier.ColliderDesc.cuboid(0.8, 2.1, 4.4)
      .setTranslation(-31.2, -87.9, -6.0)
      .setFriction(0.5)
      .setRestitution(0.1);
    this.registerCollider(world.createCollider(monolithSignCol, streamBody), true);

    // 2. 稲荷橋広場（Inaribashi Plaza）石畳＆大階段前プロムナード（x = -736..-712, z = -52..+76）
    // Why not z = -140..+75 まで延ばすか: 南側（z = -195..-55）は渋谷川の開渠区間であり、
    // 広場メッシュが水路の上を覆うと水面が隠れてしまうため、大階段前〜国道246号側（中心 z = 12, 長さ 128m）に配置する
    const inaribashiPlazaMat = new PuddleMaterial({
      baseColor: 0x64748b,
      baseRoughness: 0.68,
      baseMetalness: 0.1,
      puddleThreshold: 0.44,
    });
    this.puddleMaterials.push(inaribashiPlazaMat);
    const inaribashiGeo = new THREE.PlaneGeometry(24, 128);
    inaribashiGeo.rotateX(-Math.PI / 2);
    const inaribashiMesh = new THREE.Mesh(inaribashiGeo, inaribashiPlazaMat);
    inaribashiMesh.name = "ShibuyaInaribashiPlaza";
    inaribashiMesh.position.set(-724, 0.022, 12);
    inaribashiMesh.userData.isLargeStructure = true;
    inaribashiMesh.receiveShadow = true;
    this.group.add(inaribashiMesh);

    // 3. 渋谷川（Shibuya River）清流復活水路＆親水護岸（x = -727.5, z = -195..-55）
    const riverChannelLength = 140;
    const riverChannelWidth = 7.6;
    const riverCenterX = -727.5;
    const riverCenterZ = -125.0;

    // 水路底面のダーク石材河床メッシュ（地面 y = -0.01 より上、水面 y = 0.18 より下の y = 0.04 に敷設）
    const riverBedGeo = new THREE.PlaneGeometry(riverChannelWidth + 0.4, riverChannelLength);
    riverBedGeo.rotateX(-Math.PI / 2);
    const riverBedMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.88,
      metalness: 0.08,
    });
    this.applyArchitecture3DTexture(riverBedMat, "moat");
    const riverBedMesh = new THREE.Mesh(riverBedGeo, riverBedMat);
    riverBedMesh.name = "ShibuyaRiverBed";
    riverBedMesh.position.set(riverCenterX, 0.04, riverCenterZ);
    riverBedMesh.userData.isLargeStructure = true;
    riverBedMesh.receiveShadow = true;
    this.group.add(riverBedMesh);

    // 親水水路の3Dコースティクス水面（地面 y = -0.01・河床 y = 0.04 より上、両岸護岸パラペット上面 y = 0.90m の内側 y = 0.18）
    const riverWaterGeo = new THREE.PlaneGeometry(riverChannelWidth, riverChannelLength, 16, 48);
    riverWaterGeo.rotateX(-Math.PI / 2);
    const riverWaterMat = new WaterSurfaceMaterial({
      shallowColor: 0x0ea5e9,
      deepColor: 0x082f49,
      waveSpeed: 1.35,
      waveHeight: 0.12,
    });
    this.waterMaterials.push(riverWaterMat);
    const riverWaterMesh = new THREE.Mesh(riverWaterGeo, riverWaterMat);
    riverWaterMesh.name = "13113-wtr-shibuya-river";
    riverWaterMesh.position.set(riverCenterX, 0.18, riverCenterZ);
    riverWaterMesh.userData.isLargeStructure = true;
    this.group.add(riverWaterMesh);

    // 渋谷川の両岸コンクリート護岸パラペット（杉板本実型枠コンクリート 3D テクスチャ、上面 y = 0.90m）
    // Why z = -95（稲荷橋通り）前後で北側 (z = -84..-55) と南側 (z = -195..-106) の2区間に分割するか:
    // 1本の連続パラペット壁で生成すると、稲荷橋通り（z = -95）で渋谷川を東西に横断する車道が護岸コライダーで塞がれてしまうため、
    // 橋梁開口部（z ∈ [-106, -84]）を空けて車両がスムーズに橋を渡れるようにする。
    const riverWallMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      roughness: 0.78,
      metalness: 0.08,
    });
    this.applyArchitecture3DTexture(riverWallMat, "white_granite");
    const riverWallBody = world.createRigidBody(
      rapier.RigidBodyDesc.fixed().setTranslation(riverCenterX, 0.2, 0),
    );
    for (const wallSpan of [
      { cz: -150.5, len: 89 }, // z = -195 .. -106（稲荷橋南側〜並木橋手前）
      { cz: -69.5, len: 29 }, // z = -84 .. -55（稲荷橋北側〜稲荷橋広場南端）
    ]) {
      const sideWallGeo = new THREE.BoxGeometry(0.65, 1.3, wallSpan.len);
      for (const sideOffset of [-riverChannelWidth / 2 - 0.32, riverChannelWidth / 2 + 0.32]) {
        const wallMesh = new THREE.Mesh(sideWallGeo, riverWallMat);
        wallMesh.position.set(riverCenterX + sideOffset, 0.25, wallSpan.cz);
        wallMesh.userData.isLargeStructure = true;
        wallMesh.castShadow = true;
        wallMesh.receiveShadow = true;
        this.group.add(wallMesh);

        const wallCol = rapier.ColliderDesc.cuboid(0.35, 0.65, wallSpan.len / 2)
          .setTranslation(sideOffset, 0, wallSpan.cz)
          .setFriction(0.5);
        this.registerCollider(world.createCollider(wallCol, riverWallBody), true);
      }
    }

    // 4. 渋谷エリア周辺 PLATEAU 高層ビル群（スクランブルスクエア・ヒカリエ・サクラステージ・フクラス・渋谷三丁目ビル）
    const shibuyaBuildings = getShibuyaPlateauBuildingsForMap();
    const shibuyaMullionMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      metalness: 0.82,
      roughness: 0.25,
    });
    this.applyArchitecture3DTexture(shibuyaMullionMat, "anodized_metal");
    const beaconRedMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });

    for (const b of shibuyaBuildings) {
      // 渋谷ストリーム本体は専用 GLB で構築済みのため plateauBuildingGroups メタデータのみ登録し重複メッシュをスキップ
      const isShibuyaStreamMain = b.buildingId === "13113-bldg-shibuya-stream";
      if (isShibuyaStreamMain) {
        fallbackStreamGroup.userData = {
          buildingId: b.buildingId,
          gmlId: b.gmlId,
          name: b.name,
          nameEn: b.nameEn,
          usage: b.usage,
          measuredHeight: b.h,
          storeysAboveGround: b.storeysAboveGround,
          groundElevationM: b.groundElevationM,
          isLargeStructure: true,
        };
        this.plateauBuildingGroups.push(fallbackStreamGroup);
        continue;
      }

      const bGroup = new THREE.Group();
      bGroup.name = b.buildingId;
      bGroup.userData = {
        buildingId: b.buildingId,
        gmlId: b.gmlId,
        name: b.name,
        nameEn: b.nameEn,
        usage: b.usage,
        measuredHeight: b.h,
        storeysAboveGround: b.storeysAboveGround,
        groundElevationM: b.groundElevationM,
        isLargeStructure: true,
      };
      bGroup.position.set(b.x, b.h / 2, b.z);

      const podiumHeight = Math.min(b.podiumHeight, b.h * 0.45);
      const crownHeight = Math.min(10, Math.max(5, b.h * 0.07));
      const towerHeight = Math.max(12, b.h - podiumHeight - crownHeight);

      // 1. 低層ポディウム（商業・エントランス基壇部）
      const storefrontHeight = Math.min(7.5, podiumHeight * 0.48);
      const upperPodiumHeight = Math.max(1.0, podiumHeight - storefrontHeight);

      const baseGeo = new THREE.BoxGeometry(b.w, upperPodiumHeight, b.d);
      const baseMat = new THREE.MeshStandardMaterial({
        color: b.podiumColor,
        roughness: 0.52,
        metalness: 0.25,
      });
      this.applyArchitecture3DTexture(baseMat, "white_granite");
      const baseMesh = new THREE.Mesh(baseGeo, baseMat);
      baseMesh.position.y = -b.h / 2 + storefrontHeight + upperPodiumHeight / 2;
      baseMesh.castShadow = true;
      baseMesh.receiveShadow = true;
      bGroup.add(baseMesh);

      // 1b. 低層1F〜2F 渋谷商業街区の路面ショーウィンドウ・店舗ファサード（ストリートビュー実写テクスチャ）
      const storefrontGeo = new THREE.BoxGeometry(b.w * 1.008, storefrontHeight, b.d * 1.008);
      const storefrontTex = shibuyaTextureManager.getTexture("commercialFacade");
      const lobbyGlassMat = new THREE.MeshStandardMaterial({
        map: storefrontTex,
        color: 0xffffff,
        emissive: new THREE.Color(0xffffff),
        emissiveMap: storefrontTex,
        emissiveIntensity: this.isNightActive ? 0.95 : 0.18,
        roughness: 0.22,
        metalness: 0.15,
      });
      this.shibuyaStreamEmissiveEntries.push({
        material: lobbyGlassMat,
        dayIntensity: 0.18,
        nightIntensity: 0.95,
      });
      this.applyArchitecture3DTexture(lobbyGlassMat, "retail_storefront");
      const storefrontMesh = new THREE.Mesh(storefrontGeo, lobbyGlassMat);
      storefrontMesh.position.y = -b.h / 2 + storefrontHeight / 2;
      storefrontMesh.userData.lodDetailTier = "high";
      bGroup.add(storefrontMesh);

      // 2. 高層タワー本体（ビルの個性に応じたファサードスタイル）
      const isCerulean = b.buildingId === "13113-bldg-cerulean-tower";
      const isAoyamaOval = b.buildingId === "13113-bldg-aoyama-oval";
      let towerTextureMode: "curtain_glass" | "stone_punched" | "ribbon_window" = "curtain_glass";
      if (isCerulean) {
        // セルリアンタワー（ホテル＆オフィスのグリッド＆水平リボン連窓）
        towerTextureMode = "ribbon_window";
      } else if (isAoyamaOval) {
        // 青山オーバルビル（端正な水平連窓モダニズムオフィス）
        towerTextureMode = "ribbon_window";
      } else if (b.h < 85 && (b.storeysAboveGround ?? 0) <= 20) {
        // 中層ビルは水平連窓と石造パンチング窓を配して多様性を演出
        const isEvenStoreys = (b.storeysAboveGround ?? 0) % 2 === 0;
        towerTextureMode = isEvenStoreys ? "ribbon_window" : "stone_punched";
      }

      const towerW = b.w * 0.88;
      const towerD = b.d * 0.88;
      const towerCenterY = -b.h / 2 + podiumHeight + towerHeight / 2;
      const towerGeo = new THREE.BoxGeometry(towerW, towerHeight, towerD);
      const towerMat = new THREE.MeshPhysicalMaterial({
        color: b.color,
        metalness: 0.86,
        roughness: 0.14,
        reflectivity: 0.92,
        clearcoat: 0.85,
      });
      this.applyArchitecture3DTexture(towerMat, towerTextureMode);
      const towerMesh = new THREE.Mesh(towerGeo, towerMat);
      towerMesh.position.y = towerCenterY;
      towerMesh.castShadow = true;
      towerMesh.receiveShadow = true;
      bGroup.add(towerMesh);

      const stripeCount = Math.max(4, Math.min(18, Math.floor(towerHeight / 9)));
      const stripeMat = new THREE.MeshStandardMaterial({
        color: b.glass,
        emissive: b.glass,
        emissiveIntensity: 0.34,
        roughness: 0.2,
      });
      this.applyArchitecture3DTexture(stripeMat, "curtain_glass");
      const isScrambleSquare = b.buildingId === "13113-bldg-scramble-square";
      const isHikarie = b.buildingId === "13113-bldg-shibuya-hikarie";
      const isSakuraStage = b.buildingId === "13113-bldg-sakura-stage";
      const isFukuras = b.buildingId === "13113-bldg-shibuya-fukuras";
      const isMiyashitaPark = b.buildingId === "13113-bldg-miyashita-park";
      const isQfront109 = b.buildingId === "13113-bldg-qfront-109";

      for (let i = 0; i < stripeCount; i++) {
        const stripeY =
          -b.h / 2 + podiumHeight + 3 + i * (Math.max(5, towerHeight - 6) / stripeCount);
        const stripeMesh = new THREE.Mesh(
          new THREE.BoxGeometry(towerW + 0.3, 1.0, towerD + 0.3),
          stripeMat,
        );
        stripeMesh.position.y = stripeY;
        stripeMesh.userData.lodDetailTier = "medium";
        bGroup.add(stripeMesh);
      }

      // ランドマーク固有のプロシージャル造形（LOD1/LOD2 フォールバックおよび専用ディテール）
      if (isScrambleSquare) {
        // 渋谷スクランブルスクエア 東棟: 屋上展望施設「SHIBUYA SKY」スカイエッジ発光ガラス回廊＆ヘリポート＋実写タワーテクスチャ
        const scrambleTex = shibuyaTextureManager.getTexture("scrambleSquare");
        towerMat.map = scrambleTex;
        towerMat.emissive = new THREE.Color(0xffffff);
        towerMat.emissiveMap = scrambleTex;
        towerMat.emissiveIntensity = this.isNightActive ? 1.25 : 0.1;
        this.shibuyaStreamEmissiveEntries.push({
          material: towerMat,
          dayIntensity: 0.1,
          nightIntensity: 1.25,
        });

        const skyEdgeMat = new THREE.MeshStandardMaterial({
          color: 0x7dd3fc,
          emissive: 0x38bdf8,
          emissiveIntensity: this.isNightActive ? 1.35 : 0.12,
          roughness: 0.12,
          metalness: 0.3,
        });
        this.shibuyaStreamEmissiveEntries.push({
          material: skyEdgeMat,
          dayIntensity: 0.12,
          nightIntensity: 1.35,
        });
        this.applyArchitecture3DTexture(skyEdgeMat, "curtain_glass");

        const skyGalleryMesh = new THREE.Mesh(
          new THREE.BoxGeometry(towerW + 1.2, 8.8, towerD + 1.2),
          skyEdgeMat,
        );
        skyGalleryMesh.name = "ShibuyaSkyObservationDeck";
        skyGalleryMesh.position.y = b.h / 2 - crownHeight - 1.5;
        bGroup.add(skyGalleryMesh);

        // ヘリポート着陸帯パッド
        const helipadMat = new THREE.MeshStandardMaterial({
          color: 0x059669,
          emissive: 0x047857,
          emissiveIntensity: 0.35,
          roughness: 0.4,
        });
        const helipadMesh = new THREE.Mesh(new THREE.BoxGeometry(18, 0.6, 18), helipadMat);
        helipadMesh.name = "ShibuyaSkyHelipad";
        helipadMesh.position.y = b.h / 2 + 0.3;
        helipadMesh.userData.lodDetailTier = "medium";
        bGroup.add(helipadMesh);

        // 斜めホワイトアルミルーバーバンド（6段の階段状ダイアゴナルフィン）
        for (let dIdx = 0; dIdx < 6; dIdx++) {
          const ratio = (dIdx + 0.5) / 6 - 0.5;
          const diagFin = new THREE.Mesh(
            new THREE.BoxGeometry(towerW + 0.9, 6.5, 6.2),
            whitePanelMat,
          );
          diagFin.position.set(
            0,
            towerCenterY + ratio * (towerHeight * 0.78),
            ratio * (towerD * 0.72),
          );
          diagFin.userData.lodDetailTier = "medium";
          bGroup.add(diagFin);
        }
      } else if (isHikarie) {
        // 渋谷ヒカリエ: 中層11F〜16Fに浮かぶ球体・円筒劇場「東急シアターオーブ (Tokyu Theatre Orb)」＆スカイロビー
        const orbMat = new THREE.MeshStandardMaterial({
          color: 0xf59e0b,
          emissive: 0xd97706,
          emissiveIntensity: this.isNightActive ? 1.15 : 0.0,
          roughness: 0.22,
          metalness: 0.48,
        });
        this.shibuyaStreamEmissiveEntries.push({
          material: orbMat,
          dayIntensity: 0.0,
          nightIntensity: 1.15,
        });
        this.applyArchitecture3DTexture(orbMat, "anodized_metal");

        const theatreOrbMesh = new THREE.Mesh(
          new THREE.CylinderGeometry(20.5, 20.5, 24.0, 24),
          orbMat,
        );
        theatreOrbMesh.name = "HikarieTokyuTheatreOrb";
        theatreOrbMesh.position.set(-4.5, -b.h / 2 + podiumHeight + 18.0, -3.5);
        bGroup.add(theatreOrbMesh);

        const skyLobbyFrame = new THREE.Mesh(
          new THREE.BoxGeometry(b.w + 3.0, 2.2, b.d + 3.0),
          whitePanelMat,
        );
        skyLobbyFrame.position.y = -b.h / 2 + podiumHeight + 4.0;
        bGroup.add(skyLobbyFrame);
      } else if (isSakuraStage) {
        // 渋谷サクラステージ: 桜色（チェリーピンク）発光アトリウム＆段状グリーンテラス
        const sakuraGlowMat = new THREE.MeshStandardMaterial({
          color: 0xfda4af,
          emissive: 0xf43f5e,
          emissiveIntensity: this.isNightActive ? 1.1 : 0.15,
          roughness: 0.2,
        });
        this.shibuyaStreamEmissiveEntries.push({
          material: sakuraGlowMat,
          dayIntensity: 0.15,
          nightIntensity: 1.1,
        });
        const sakuraAtrium = new THREE.Mesh(
          new THREE.BoxGeometry(b.w + 1.8, 12.0, b.d * 0.55),
          sakuraGlowMat,
        );
        sakuraAtrium.name = "SakuraStageAtrium";
        sakuraAtrium.position.set(4.0, -b.h / 2 + podiumHeight + 6.0, 0);
        bGroup.add(sakuraAtrium);
      } else if (isFukuras) {
        // 渋谷フクラス (東急プラザ渋谷): 折り紙モチーフのプリーツ白ルーバー基壇＆17F屋上庭園「SHIBUYA NIWA」
        for (let fStep = 0; fStep < 4; fStep++) {
          const pleatMesh = new THREE.Mesh(
            new THREE.BoxGeometry(b.w + 1.6, 2.4, b.d + 1.6),
            whitePanelMat,
          );
          pleatMesh.position.y = -b.h / 2 + 8.0 + fStep * 5.8;
          pleatMesh.rotation.y = (fStep % 2 === 0 ? 1 : -1) * 0.035;
          pleatMesh.userData.lodDetailTier = "medium";
          bGroup.add(pleatMesh);
        }
      } else if (isMiyashitaPark) {
        // MIYASHITA PARK (宮下公園): 3F 屋上公園の象徴的な白アーチキャノピー＆屋上芝生パーク＋低層商業ファサード実写テクスチャ
        const miyashitaTex = shibuyaTextureManager.getTexture("miyashitaPark");
        const miyashitaMat = new THREE.MeshStandardMaterial({
          map: miyashitaTex,
          emissive: new THREE.Color(0xffffff),
          emissiveMap: miyashitaTex,
          emissiveIntensity: this.isNightActive ? 1.25 : 0.22,
          roughness: 0.32,
          metalness: 0.25,
        });
        this.shibuyaStreamEmissiveEntries.push({
          material: miyashitaMat,
          dayIntensity: 0.22,
          nightIntensity: 1.25,
        });
        this.applyArchitecture3DTexture(miyashitaMat, "retail_storefront");
        const miyashitaStorefront = new THREE.Mesh(
          new THREE.BoxGeometry(b.w * 1.012, storefrontHeight * 1.25, b.d * 1.012),
          miyashitaMat,
        );
        miyashitaStorefront.position.y = -b.h / 2 + (storefrontHeight * 1.25) / 2;
        bGroup.add(miyashitaStorefront);

        const parkGreenMat = new THREE.MeshStandardMaterial({
          color: 0x22c55e,
          roughness: 0.85,
          metalness: 0.02,
        });
        const roofLawn = new THREE.Mesh(
          new THREE.BoxGeometry(b.w + 1.2, 1.8, b.d + 1.2),
          parkGreenMat,
        );
        roofLawn.name = "MiyashitaParkRoofLawn";
        roofLawn.position.y = -b.h / 2 + podiumHeight + 0.9;
        bGroup.add(roofLawn);

        for (let archIdx = 0; archIdx < 6; archIdx++) {
          const az = -b.d * 0.4 + (archIdx / 5) * (b.d * 0.8);
          const archCanopy = new THREE.Mesh(
            new THREE.BoxGeometry(b.w * 0.92, 5.5, 1.2),
            whitePanelMat,
          );
          archCanopy.position.set(0, -b.h / 2 + podiumHeight + 3.6, az);
          archCanopy.userData.lodDetailTier = "medium";
          bGroup.add(archCanopy);
        }
      } else if (isQfront109) {
        // QFRONT・SHIBUYA109 街区: スクランブル交差点正面の大型湾曲LEDビジョン「Q'S EYE」実写ストリートビューテクスチャ
        const qfrontTex = shibuyaTextureManager.getTexture("qfront");
        const mediaWallMat = new THREE.MeshStandardMaterial({
          map: qfrontTex,
          emissive: new THREE.Color(0xffffff),
          emissiveMap: qfrontTex,
          emissiveIntensity: this.isNightActive ? 1.65 : 0.35,
          roughness: 0.14,
          metalness: 0.25,
        });
        this.shibuyaStreamEmissiveEntries.push({
          material: mediaWallMat,
          dayIntensity: 0.35,
          nightIntensity: 1.65,
        });
        this.applyArchitecture3DTexture(mediaWallMat, "curtain_glass");
        const qfrontMedia = new THREE.Mesh(
          new THREE.CylinderGeometry(14.0, 14.0, 28.0, 20),
          mediaWallMat,
        );
        qfrontMedia.name = "ShibuyaQfrontMediaWall";
        qfrontMedia.position.set(b.w * 0.25, -b.h / 2 + 22.0, -b.d * 0.28);
        bGroup.add(qfrontMedia);
      }

      const crownMesh = new THREE.Mesh(
        new THREE.BoxGeometry(towerW * 0.82, crownHeight, towerD * 0.82),
        shibuyaMullionMat,
      );
      crownMesh.position.y = b.h / 2 - crownHeight / 2;
      bGroup.add(crownMesh);

      for (const [bx, bz] of [
        [towerW * 0.38, towerD * 0.38],
        [-towerW * 0.38, towerD * 0.38],
        [towerW * 0.38, -towerD * 0.38],
        [-towerW * 0.38, -towerD * 0.38],
      ]) {
        const beaconMesh = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 8), beaconRedMat);
        beaconMesh.position.set(bx, b.h / 2 + 0.6, bz);
        beaconMesh.userData.lodDetailTier = "medium";
        bGroup.add(beaconMesh);
      }

      if (isScrambleSquare) {
        this.proceduralScrambleSquareGroup = bGroup;
      } else if (isHikarie) {
        this.proceduralHikarieGroup = bGroup;
      } else if (isSakuraStage) {
        this.proceduralSakuraStageGroup = bGroup;
      } else if (isFukuras) {
        this.proceduralFukurasGroup = bGroup;
      } else if (isMiyashitaPark) {
        this.proceduralMiyashitaParkGroup = bGroup;
      } else if (isQfront109) {
        this.proceduralQfront109Group = bGroup;
      }
      this.group.add(bGroup);
      this.plateauBuildingGroups.push(bGroup);

      const bBody = world.createRigidBody(
        rapier.RigidBodyDesc.fixed().setTranslation(b.x, b.h / 2, b.z),
      );
      const bCol = rapier.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2)
        .setFriction(0.5)
        .setRestitution(0.1);
      this.registerCollider(world.createCollider(bCol, bBody), true);
    }

    // 5. 首都高速3号渋谷線 高架橋（Shutoko Route 3 Shibuya Line Viaduct）＆ 渋谷駅東口歩道橋・鉄道高架のプロシージャル構造物＋歩道橋脚コライダー
    this.buildShutokoRoute3AndShibuyaOverpass(world, rapier, whitePanelMat, darkFrameMat);

    // 5b. 渋谷実写ストリートビュー袖看板・大型屋外電子ビジョン・ビルボード群の構築
    this.buildShibuyaStreetViewSignsAndBillboards(world, rapier);

    // 6. Blender 生成 `shibuya_stream.glb` および `shibuya_plateau_buildings.glb` の非同期ロードと 3D テクスチャシェーダー統合
    if (!this.deferGlbLoads) {
      this.glbLoadPromises.push(this.loadGlbShibuyaStreamModel());
      this.glbLoadPromises.push(this.loadGlbShibuyaPlateauModel());
    }
  }

  /**
   * 首都高速3号渋谷線高架橋（国道246号・玉川通り／青山通り上空 y=11.4m..17.1m）および
   * 渋谷駅東口歩道橋・JR山手線・東京メトロ銀座線高架橋のプロシージャル構造物と Rapier 橋脚コライダーを構築する。
   * How:
   * - `shibuya_stream.glb` ロード前やヘッドレス単体テスト、および遠距離 LOD 時にも首都高高架橋・緑案内標識・
   *   渋谷駅東口歩道橋・JR/銀座線高架橋が途切れず立体的に存在するよう構築する。
   * - 渋谷駅コア区間（`x = -865 .. -575`）のプロシージャル高架・歩道橋・鉄道高架は `proceduralShutokoCoreMeshes` に登録し、
   *   `shibuya_stream.glb` が近距離 LOD0 で表示されている間は非表示に切り替えることで同一座標での Z-fighting と二重ドローコールを防止する。
   * - 青山通り東側区間（`x = -575 .. -265`）は GLB 範囲外のため常時連続描画し、GLB の東端（`x = -575`）とシームレスに接続する。
   * - 橋脚コライダーはすべて国道246号（車道 z = 86..104）および明治通り（車道 x = -762..-738）の外側歩道上にのみ配置し、
   *   走行車線を一切阻害しない。
   */
  private buildShutokoRoute3AndShibuyaOverpass(
    world: RAPIER.World,
    rapier: typeof RAPIER,
    whitePanelMat: THREE.MeshStandardMaterial,
    darkSteelMat: THREE.MeshStandardMaterial,
  ): void {
    const viaductGroup = new THREE.Group();
    viaductGroup.name = "ShutokoRoute3ViaductGroup";
    viaductGroup.position.set(-720, 0, 95);
    viaductGroup.userData = {
      isLargeStructure: true,
      isRoadInfrastructure: true,
      routeCode: "首都高速3号渋谷線",
    };
    this.proceduralShutokoCoreMeshes = [];

    const registerCoreFallbackMesh = (mesh: THREE.Mesh): void => {
      viaductGroup.add(mesh);
      this.proceduralShutokoCoreMeshes.push(mesh);
    };

    const concretePierMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      roughness: 0.76,
      metalness: 0.08,
    });
    this.applyArchitecture3DTexture(concretePierMat, "white_granite");

    const shutokoSignTex = shibuyaTextureManager.getTexture("shutokoSign");
    const shutokoGreenSignMat = new THREE.MeshStandardMaterial({
      map: shutokoSignTex,
      roughness: 0.28,
      metalness: 0.12,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: shutokoSignTex,
      emissiveIntensity: this.isNightActive ? 1.15 : 0.08,
    });
    this.shibuyaStreamEmissiveEntries.push({
      material: shutokoGreenSignMat,
      dayIntensity: 0.08,
      nightIntensity: 1.15,
    });
    this.applyArchitecture3DTexture(shutokoGreenSignMat, "anodized_metal");

    const underpassLightMat = new THREE.MeshStandardMaterial({
      color: 0xfde68a,
      emissive: 0xf59e0b,
      emissiveIntensity: this.isNightActive ? 1.45 : 0.18,
      roughness: 0.2,
    });
    this.shibuyaStreamEmissiveEntries.push({
      material: underpassLightMat,
      dayIntensity: 0.18,
      nightIntensity: 1.45,
    });

    const deckWidthZ = 21.6;

    // 1A. 渋谷駅コア区間（x = -865 .. -575, 長さ 290m: GLB 内の ShutokoRoute3_Viaduct と一致するプロシージャル Proxy 区間）
    const coreSpanLenX = 290;
    const coreSpanCenterX = 0; // viaductGroup (-720) 基準で -145..+145 -> worldX = -865..-575
    const steelGirderCore = new THREE.Mesh(
      new THREE.BoxGeometry(coreSpanLenX, 1.8, deckWidthZ - 2.0),
      darkSteelMat,
    );
    steelGirderCore.name = "ShutokoSteelBoxGirder";
    steelGirderCore.position.set(coreSpanCenterX, 12.3, 0);
    steelGirderCore.castShadow = true;
    steelGirderCore.receiveShadow = true;
    registerCoreFallbackMesh(steelGirderCore);

    const concreteDeckCore = new THREE.Mesh(
      new THREE.BoxGeometry(coreSpanLenX, 1.1, deckWidthZ),
      concretePierMat,
    );
    concreteDeckCore.name = "ShutokoConcreteDeck";
    concreteDeckCore.position.set(coreSpanCenterX, 13.65, 0);
    concreteDeckCore.castShadow = true;
    concreteDeckCore.receiveShadow = true;
    registerCoreFallbackMesh(concreteDeckCore);

    for (const sideZ of [-deckWidthZ * 0.5 + 0.35, deckWidthZ * 0.5 - 0.35]) {
      const soundWallCore = new THREE.Mesh(
        new THREE.BoxGeometry(coreSpanLenX, 2.8, 0.55),
        concretePierMat,
      );
      soundWallCore.name = "ShutokoSoundBarrierWall";
      soundWallCore.position.set(coreSpanCenterX, 15.6, sideZ);
      soundWallCore.castShadow = true;
      registerCoreFallbackMesh(soundWallCore);
    }

    // 1B. 青山通り東側延長区間（x = -575 .. -265, 長さ 310m: GLB 範囲外のため常時表示して表参道方面まで連続させる）
    const eastSpanLenX = 310;
    const eastSpanCenterX = 300; // viaductGroup (-720) 基準で +145..+455 -> worldX = -575..-265
    const steelGirderEast = new THREE.Mesh(
      new THREE.BoxGeometry(eastSpanLenX, 1.8, deckWidthZ - 2.0),
      darkSteelMat,
    );
    steelGirderEast.name = "ShutokoSteelBoxGirderEast";
    steelGirderEast.position.set(eastSpanCenterX, 12.3, 0);
    steelGirderEast.castShadow = true;
    steelGirderEast.receiveShadow = true;
    viaductGroup.add(steelGirderEast);

    const concreteDeckEast = new THREE.Mesh(
      new THREE.BoxGeometry(eastSpanLenX, 1.1, deckWidthZ),
      concretePierMat,
    );
    concreteDeckEast.name = "ShutokoConcreteDeckEast";
    concreteDeckEast.position.set(eastSpanCenterX, 13.65, 0);
    concreteDeckEast.castShadow = true;
    concreteDeckEast.receiveShadow = true;
    viaductGroup.add(concreteDeckEast);

    for (const sideZ of [-deckWidthZ * 0.5 + 0.35, deckWidthZ * 0.5 - 0.35]) {
      const soundWallEast = new THREE.Mesh(
        new THREE.BoxGeometry(eastSpanLenX, 2.8, 0.55),
        concretePierMat,
      );
      soundWallEast.name = "ShutokoSoundBarrierWallEast";
      soundWallEast.position.set(eastSpanCenterX, 15.6, sideZ);
      soundWallEast.castShadow = true;
      viaductGroup.add(soundWallEast);
    }

    // 首都高3号渋谷線の緑案内標識パネル（signX < 145 は渋谷コア区間、signX >= 145 は青山通り東側区間）
    for (const signX of [-30, 0, 42, 160]) {
      const isCoreSign = signX < 145;
      const greenSignBoard = new THREE.Mesh(
        new THREE.BoxGeometry(13.5, 2.3, 0.45),
        shutokoGreenSignMat,
      );
      greenSignBoard.name = "ShutokoRoute3GreenSign";
      greenSignBoard.position.set(signX, 15.8, -deckWidthZ * 0.5 - 0.35);
      if (isCoreSign) {
        registerCoreFallbackMesh(greenSignBoard);
      } else {
        viaductGroup.add(greenSignBoard);
      }

      const greenSignBoardNorth = new THREE.Mesh(
        new THREE.BoxGeometry(13.5, 2.3, 0.45),
        shutokoGreenSignMat,
      );
      greenSignBoardNorth.position.set(signX, 15.8, deckWidthZ * 0.5 + 0.35);
      if (isCoreSign) {
        registerCoreFallbackMesh(greenSignBoardNorth);
      } else {
        viaductGroup.add(greenSignBoardNorth);
      }
    }

    // 高架下アンバーナトリウム道路照明列
    for (let lx = -140; lx <= 420; lx += 30) {
      const underLight = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.25, 8.0), underpassLightMat);
      underLight.position.set(lx, 11.35, 0);
      underLight.userData.lodDetailTier = "medium";
      if (lx <= 140) {
        registerCoreFallbackMesh(underLight);
      } else {
        viaductGroup.add(underLight);
      }
    }

    // 首都高ラーメン橋脚＆Rapier物理コライダー（国道246号の歩道外側 z = 80.5, 109.5 に配置し車道を完全クリア）
    // -830..-618 は GLB 内橋脚座標（by = -135, -87, -33, +23, +77 -> worldX = -830, -782, -728, -672, -618）と完全一致
    const pierWorldXList = [-830, -782, -728, -672, -618, -540, -450, -360];
    const shutokoPierBody = world.createRigidBody(
      rapier.RigidBodyDesc.fixed().setTranslation(-720, 0, 95),
    );
    for (const worldX of pierWorldXList) {
      const localX = worldX - -720;
      const isCorePier = worldX >= -865 && worldX <= -575;
      const crossBeam = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.7, 31.2), concretePierMat);
      crossBeam.position.set(localX, 10.65, 0);
      crossBeam.castShadow = true;
      if (isCorePier) {
        registerCoreFallbackMesh(crossBeam);
      } else {
        viaductGroup.add(crossBeam);
      }

      for (const localZ of [-14.5, 14.5]) {
        const pierColMesh = new THREE.Mesh(new THREE.BoxGeometry(2.5, 10.6, 2.5), concretePierMat);
        pierColMesh.position.set(localX, 5.3, localZ);
        pierColMesh.castShadow = true;
        pierColMesh.receiveShadow = true;
        if (isCorePier) {
          registerCoreFallbackMesh(pierColMesh);
        } else {
          viaductGroup.add(pierColMesh);
        }

        const pierCol = rapier.ColliderDesc.cuboid(1.25, 5.3, 1.25)
          .setTranslation(localX, 5.3, localZ)
          .setFriction(0.6);
        this.registerCollider(world.createCollider(pierCol, shutokoPierBody), true);
      }
    }

    // 渋谷駅東口歩道橋（ペデストリアンデッキ）＆ JR山手線・東京メトロ銀座線高架橋（プロシージャル Proxy 構造）
    const eastDeckCrossSouth = new THREE.Mesh(new THREE.BoxGeometry(54, 1.1, 5.6), whitePanelMat);
    eastDeckCrossSouth.name = "ShibuyaEastPedestrianDeckBridge";
    eastDeckCrossSouth.position.set(-29, 7.8, -24); // worldX = -749, worldZ = 71
    registerCoreFallbackMesh(eastDeckCrossSouth);

    const ginzaLineRoof = new THREE.Mesh(new THREE.BoxGeometry(92, 3.6, 15.2), whitePanelMat);
    ginzaLineRoof.name = "ShibuyaGinzaLineStationVault";
    ginzaLineRoof.position.set(-30, 17.2, 48); // worldX = -750, worldZ = 143
    registerCoreFallbackMesh(ginzaLineRoof);

    const jrGreenSteelMat = new THREE.MeshStandardMaterial({
      color: 0x0f5132,
      roughness: 0.45,
      metalness: 0.75,
    });
    this.applyArchitecture3DTexture(jrGreenSteelMat, "anodized_metal");

    const jrYamanoteBridge = new THREE.Mesh(new THREE.BoxGeometry(13.5, 3.8, 300), jrGreenSteelMat);
    jrYamanoteBridge.name = "ShibuyaJrYamanoteOverpass";
    jrYamanoteBridge.position.set(-59, 10.2, -60); // worldX = -779
    registerCoreFallbackMesh(jrYamanoteBridge);

    this.group.add(viaductGroup);
  }

  /**
   * 渋谷実写ストリートビュー袖看板・大型屋外電子ビジョン・ビルボード群の構築
   * How:
   * - Google マップ / ストリートビューで明治通り・スクランブル交差点・国道246号沿道に見られる
   *   突き出し袖看板（カラオケ館、マツモトキヨシ、コンビニ、カフェ等）および屋外大型LEDビジョン群を
   *   実写テクスチャマテリアルで配置し、夜間発光アニメーションと連動させる。
   */
  private buildShibuyaStreetViewSignsAndBillboards(
    _world: RAPIER.World,
    _rapier: typeof RAPIER,
  ): void {
    const signsGroup = new THREE.Group();
    signsGroup.name = "ShibuyaStreetViewSignsGroup";

    const commercialMat = shibuyaTextureManager.createCommercialStorefrontMaterial(
      this.isNightActive,
    );
    this.shibuyaStreamEmissiveEntries.push({
      material: commercialMat,
      dayIntensity: 0.25,
      nightIntensity: 1.45,
    });
    this.applyArchitecture3DTexture(commercialMat, "retail_storefront");

    const billboardMat = shibuyaTextureManager.createBillboardMaterial(
      "billboards",
      this.isNightActive,
    );
    this.shibuyaStreamEmissiveEntries.push({
      material: billboardMat,
      dayIntensity: 0.45,
      nightIntensity: 1.85,
    });
    this.applyArchitecture3DTexture(billboardMat, "curtain_glass");

    const steelBracketMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.45,
      metalness: 0.8,
    });
    this.applyArchitecture3DTexture(steelBracketMat, "cast_iron");

    // 1. 明治通り沿道 突き出し袖看板群（歩道・車道から見上げる日本のリアルな商業街路景観）
    // 明治通り中央軸 x = -750m。東側ビル壁面: x ≈ -735.4m、西側ビル壁面: x ≈ -764.6m
    // 突き出し看板は建物壁面から道路上空へX軸方向に1.35m〜1.6m突出し、進行方向（Z軸南北）に幅広の発光面を向ける。
    const meijiBladeSigns = [
      // 東側ビル街（渋谷ストリーム〜ヒカリエ〜宮下公園方向: 壁面 x ≈ -735.4m より道路側 x = -736.3m へ突出）
      { x: -736.3, y: 7.5, z: -80, w: 1.35, h: 3.8, d: 0.25 },
      { x: -736.3, y: 12.0, z: -35, w: 1.5, h: 4.5, d: 0.25 },
      { x: -736.3, y: 8.2, z: 15, w: 1.2, h: 3.2, d: 0.25 },
      { x: -736.3, y: 11.5, z: 65, w: 1.4, h: 4.2, d: 0.25 },
      { x: -736.3, y: 9.0, z: 120, w: 1.3, h: 3.6, d: 0.25 },
      { x: -736.3, y: 13.0, z: 175, w: 1.6, h: 4.8, d: 0.25 },
      // 西側ビル街（並木橋〜サクラステージ〜フクラス〜道玄坂方向: 壁面 x ≈ -764.6m より道路側 x = -763.7m へ突出）
      { x: -763.7, y: 8.0, z: -60, w: 1.3, h: 3.5, d: 0.25 },
      { x: -763.7, y: 12.5, z: -10, w: 1.5, h: 4.6, d: 0.25 },
      { x: -763.7, y: 7.8, z: 35, w: 1.25, h: 3.4, d: 0.25 },
      { x: -763.7, y: 10.5, z: 90, w: 1.35, h: 4.0, d: 0.25 },
      { x: -763.7, y: 8.5, z: 145, w: 1.4, h: 3.8, d: 0.25 },
      { x: -763.7, y: 14.0, z: 200, w: 1.7, h: 5.0, d: 0.25 },
    ];

    const bladeGeo = new THREE.BoxGeometry(1, 1, 1);
    const bracketArmGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.2, 8);
    bracketArmGeo.rotateZ(Math.PI / 2);

    for (let i = 0; i < meijiBladeSigns.length; i++) {
      const s = meijiBladeSigns[i];
      const signMat = i % 2 === 0 ? commercialMat : billboardMat;
      const signMesh = new THREE.Mesh(bladeGeo, signMat);
      signMesh.scale.set(s.w, s.h, s.d);
      signMesh.position.set(s.x, s.y, s.z);
      signMesh.userData.lodDetailTier = "medium";
      signsGroup.add(signMesh);

      const armX = s.x > -750 ? s.x + s.w * 0.45 : s.x - s.w * 0.45;
      const armTop = new THREE.Mesh(bracketArmGeo, steelBracketMat);
      armTop.position.set(armX, s.y + s.h * 0.35, s.z);
      armTop.userData.lodDetailTier = "high";
      signsGroup.add(armTop);

      const armBtm = new THREE.Mesh(bracketArmGeo, steelBracketMat);
      armBtm.position.set(armX, s.y - s.h * 0.35, s.z);
      armBtm.userData.lodDetailTier = "high";
      signsGroup.add(armBtm);
    }

    // 2. 渋谷スクランブル交差点・駅前広場 屋外大型LEDビジョン＆ビルボード群
    // ストリートビューから見える実写広告・電子ビジョン
    const crossingBillboards = [
      // スクランブル交差点 北東向き大型屋上ビジョン
      { x: -788.0, y: 34.0, z: 212.0, w: 16.0, h: 9.5, d: 0.8, rotY: 0.45 },
      // スクランブル交差点 南向き（ハチ公広場正面）大型ファサードビジョン
      { x: -822.0, y: 28.0, z: 228.0, w: 18.0, h: 10.5, d: 0.8, rotY: 0.15 },
      // 国道246号・玉川通り 沿道大型ロードサイド看板（東行・渋谷流入車両向き）
      { x: -725.0, y: 22.0, z: 42.0, w: 14.0, h: 7.5, d: 0.7, rotY: Math.PI / 2 },
      // 渋谷駅東口広場・明治通り交差点 大型ビジョン
      { x: -768.0, y: 25.0, z: 125.0, w: 15.0, h: 8.0, d: 0.7, rotY: -0.35 },
    ];

    const billboardGeo = new THREE.BoxGeometry(1, 1, 1);
    const frameGeo = new THREE.BoxGeometry(1.02, 1.02, 1.05);

    for (let i = 0; i < crossingBillboards.length; i++) {
      const b = crossingBillboards[i];
      const bMesh = new THREE.Mesh(billboardGeo, billboardMat);
      bMesh.scale.set(b.w, b.h, b.d);
      bMesh.position.set(b.x, b.y, b.z);
      bMesh.rotation.y = b.rotY;
      bMesh.userData.lodDetailTier = "medium";
      signsGroup.add(bMesh);

      const fMesh = new THREE.Mesh(frameGeo, steelBracketMat);
      fMesh.scale.set(b.w * 1.02, b.h * 1.02, b.d * 1.1);
      fMesh.position.set(b.x, b.y, b.z);
      fMesh.rotation.y = b.rotY;
      fMesh.userData.lodDetailTier = "high";
      signsGroup.add(fMesh);
    }

    signsGroup.userData.isRoadInfra = true;
    this.group.add(signsGroup);
  }

  /**
   * `shibuya_stream.glb` 内のマテリアルを解析し、
   * 屋上航空障害灯・イエローアクセント・暖色ロビー窓・首都高緑標識・SHIBUYA SKY・ヒカリエシアターオーブは固有の発光と色調を保持し、
   * 白アルミ千鳥パネル・溶融亜鉛メッキ鉄骨・コンクリート橋脚・壁面緑化・カーテンウォールには WebGL2 3D ボリュームテクスチャを適用する。
   * Why not: メッシュ名のみで一括判定するとマルチマテリアルメッシュが共有参照する
   * `StreamDarkVoidSteel` や `StreamYellowAccent` のマテリアルインスタンスまで別属性に上書きされてしまうため、
   * マテリアル名 (`stdMat.name`) に基づいて厳密に振り分ける。
   */
  public applyShibuyaStreamGlbMaterial3DTexture(
    mat: THREE.Material | null | undefined,
    _meshName = "",
  ): void {
    const isStandardMat = Boolean(
      mat && (mat as THREE.MeshStandardMaterial).isMeshStandardMaterial,
    );
    if (!isStandardMat) {
      return;
    }

    const stdMat = mat as THREE.MeshStandardMaterial;
    const matName = stdMat.name || "";

    // 1. 屋上ヘリポート・クラウン四隅の赤色航空障害灯
    const isBeaconRed = matName.includes("BeaconRed");
    if (isBeaconRed) {
      stdMat.emissive = new THREE.Color(0xff2a1a);
      stdMat.emissiveIntensity = 2.8;
      stdMat.roughness = 0.15;
      stdMat.metalness = 0.0;
      stdMat.needsUpdate = true;
      return;
    }

    // 2. 渋谷ストリーム象徴のライムイエロー・デッキエッジ＆サインアクセント
    const isYellowAccent = matName.includes("StreamYellowAccent");
    if (isYellowAccent) {
      const dayIntensity = 0.08;
      const nightIntensity = 0.95;
      stdMat.emissive = new THREE.Color(0xd6e614);
      stdMat.emissiveIntensity = this.isNightActive ? nightIntensity : dayIntensity;
      stdMat.roughness = 0.24;
      stdMat.metalness = 0.15;
      this.shibuyaStreamEmissiveEntries.push({
        material: stdMat,
        dayIntensity,
        nightIntensity,
      });
      this.applyArchitecture3DTexture(stdMat, "anodized_metal");
      return;
    }

    // 3. 首都高速3号渋谷線 緑案内標識ボード（実写案内標識ストリートビューテクスチャ）
    const isShutokoGreenSign = matName.includes("ShutokoHighwayGreenSign");
    if (isShutokoGreenSign) {
      if (!stdMat.map) {
        stdMat.map = shibuyaTextureManager.getTexture("shutokoSign");
      }
      stdMat.emissiveMap = stdMat.map;
      stdMat.emissive = new THREE.Color(0xffffff);
      const dayIntensity = 0.08;
      const nightIntensity = 1.15;
      stdMat.emissiveIntensity = this.isNightActive ? nightIntensity : dayIntensity;
      stdMat.roughness = 0.28;
      stdMat.metalness = 0.12;
      this.shibuyaStreamEmissiveEntries.push({
        material: stdMat,
        dayIntensity,
        nightIntensity,
      });
      this.applyArchitecture3DTexture(stdMat, "anodized_metal");
      return;
    }

    // 4. 渋谷スクランブルスクエア 屋上展望施設「SHIBUYA SKY」スカイエッジ発光ガラス
    const isShibuyaSkyEdge = matName.includes("ShibuyaSkyEdgeGlow");
    if (isShibuyaSkyEdge) {
      const dayIntensity = 0.12;
      const nightIntensity = 1.42;
      stdMat.emissive = new THREE.Color(0x38bdf8);
      stdMat.emissiveIntensity = this.isNightActive ? nightIntensity : dayIntensity;
      stdMat.roughness = 0.12;
      stdMat.metalness = 0.28;
      this.shibuyaStreamEmissiveEntries.push({
        material: stdMat,
        dayIntensity,
        nightIntensity,
      });
      this.applyArchitecture3DTexture(stdMat, "curtain_glass");
      return;
    }

    // 5. 渋谷ヒカリエ 東急シアターオーブ球体劇場＆首都高高架下アンバーナトリウム照明
    const isHikarieGoldOrb = matName.includes("HikarieGoldOrb");
    if (isHikarieGoldOrb) {
      const dayIntensity = 0.0;
      const nightIntensity = 1.38;
      stdMat.emissive = new THREE.Color(0xf59e0b);
      stdMat.emissiveIntensity = this.isNightActive ? nightIntensity : dayIntensity;
      stdMat.roughness = 0.22;
      stdMat.metalness = 0.48;
      this.shibuyaStreamEmissiveEntries.push({
        material: stdMat,
        dayIntensity,
        nightIntensity,
      });
      this.applyArchitecture3DTexture(stdMat, "anodized_metal");
      return;
    }

    // 5b. 渋谷サクラステージ「KINETIC GATE（ときめきSTAGE）」チェリーピンク発光ガラス
    const isSakuraPinkGlow = matName.includes("SakuraStagePinkGlow");
    if (isSakuraPinkGlow) {
      const dayIntensity = 0.15;
      const nightIntensity = 1.45;
      stdMat.emissive = new THREE.Color(0xf43f5e);
      stdMat.emissiveIntensity = this.isNightActive ? nightIntensity : dayIntensity;
      stdMat.roughness = 0.14;
      stdMat.metalness = 0.22;
      this.shibuyaStreamEmissiveEntries.push({
        material: stdMat,
        dayIntensity,
        nightIntensity,
      });
      this.applyArchitecture3DTexture(stdMat, "curtain_glass");
      return;
    }

    // 5c. SHIBUYA109 シリンダークラウン＆立体ロゴ・QFRONT 大型ビジョン マゼンタレッド発光アクセント
    const isQfront109Accent = matName.includes("ShibuyaQfront109Accent");
    if (isQfront109Accent) {
      const dayIntensity = 0.35;
      const nightIntensity = 1.65;
      stdMat.emissive = new THREE.Color(0xec4899);
      stdMat.emissiveIntensity = this.isNightActive ? nightIntensity : dayIntensity;
      stdMat.roughness = 0.16;
      stdMat.metalness = 0.28;
      this.shibuyaStreamEmissiveEntries.push({
        material: stdMat,
        dayIntensity,
        nightIntensity,
      });
      this.applyArchitecture3DTexture(stdMat, "anodized_metal");
      return;
    }

    // 6. 首都高速3号渋谷線・鉄道高架のプレキャストコンクリート橋脚・床版・遮音壁
    const isShutokoConcrete = matName.includes("ShutokoConcretePier");
    if (isShutokoConcrete) {
      stdMat.roughness = 0.76;
      stdMat.metalness = 0.08;
      this.applyArchitecture3DTexture(stdMat, "white_granite");
      return;
    }

    // 7. 商業フロア・大階段アトリウム・オフィス点灯窓のウォームインテリア発光ガラス
    const isWarmPlazaGlow =
      matName.includes("WarmPlazaGlow") || matName.includes("StreamWarmLobby");
    if (isWarmPlazaGlow) {
      const dayIntensity = 0.04;
      const nightIntensity = 1.32;
      stdMat.emissive = new THREE.Color(0xffd28a);
      stdMat.emissiveIntensity = this.isNightActive ? nightIntensity : dayIntensity;
      stdMat.roughness = 0.18;
      stdMat.metalness = 0.12;
      this.shibuyaStreamEmissiveEntries.push({
        material: stdMat,
        dayIntensity,
        nightIntensity,
      });
      this.applyArchitecture3DTexture(stdMat, "curtain_glass");
      return;
    }

    // 8. 中層・低層ボイドおよび屋上テラスの垂直壁面緑化（グリーンウォール植栽）
    const isVerticalGreen =
      matName.includes("StreamVerticalGreen") || matName.includes("StreamFoliageGreen");
    if (isVerticalGreen) {
      stdMat.roughness = 0.84;
      stdMat.metalness = 0.02;
      this.applyArchitecture3DTexture(stdMat, "white_granite");
      return;
    }

    // 9. 白アルミカーテンウォールパネル（渋谷ストリーム象徴の白い縦横千鳥ルーバーフィン）
    const isWhiteAluminumFin = matName.includes("StreamWhitePanel");
    if (isWhiteAluminumFin) {
      stdMat.roughness = 0.24;
      stdMat.metalness = 0.22;
      this.applyArchitecture3DTexture(stdMat, "anodized_metal");
      return;
    }

    // 10. 屋上オープンフレーム＆デッキ梁の溶融亜鉛めっき鋼材（シルバーグレー）
    const isGalvanizedFrame = matName.includes("StreamGalvanizedFrame");
    if (isGalvanizedFrame) {
      stdMat.roughness = 0.36;
      stdMat.metalness = 0.65;
      this.applyArchitecture3DTexture(stdMat, "anodized_metal");
      return;
    }

    // 11. 中層ボイド・低層ピロティ・渋谷川護岸・大階段のダークチャコール鉄骨＆杉板本実コンクリート
    const isDarkVoidSteel =
      matName.includes("StreamDarkVoidSteel") || matName.includes("StreamConcretePodium");
    if (isDarkVoidSteel) {
      stdMat.roughness = 0.48;
      stdMat.metalness = 0.45;
      this.applyArchitecture3DTexture(stdMat, "cast_iron");
      return;
    }

    // 12. 高層 Low-E ブルーグレー反射カーテンウォールガラス
    const isGlassOrWater =
      matName.includes("StreamCurtainGlass") || matName.includes("StreamWaterWall");
    if (isGlassOrWater) {
      stdMat.roughness = 0.12;
      stdMat.metalness = 0.42;
      this.applyArchitecture3DTexture(stdMat, "curtain_glass");
      return;
    }

    // 13. QFRONT 巨大湾曲LEDビジョン「Q'S EYE」＆TSUTAYA実写ストリートビューテクスチャ
    const isQfrontMedia = matName.includes("ShibuyaQfrontMedia");
    if (isQfrontMedia) {
      if (!stdMat.map) {
        stdMat.map = shibuyaTextureManager.getTexture("qfront");
      }
      stdMat.emissiveMap = stdMat.map;
      stdMat.emissive = new THREE.Color(0xffffff);
      const dayIntensity = 0.35;
      const nightIntensity = 1.65;
      stdMat.emissiveIntensity = this.isNightActive ? nightIntensity : dayIntensity;
      stdMat.roughness = 0.14;
      stdMat.metalness = 0.35;
      this.shibuyaStreamEmissiveEntries.push({
        material: stdMat,
        dayIntensity,
        nightIntensity,
      });
      this.applyArchitecture3DTexture(stdMat, "curtain_glass");
      return;
    }

    // 14. SHIBUYA109 円筒クラウン「109」ロゴ＆ファサード実写ストリートビューテクスチャ
    const is109Crown = matName.includes("Shibuya109Crown");
    if (is109Crown) {
      if (!stdMat.map) {
        stdMat.map = shibuyaTextureManager.getTexture("shibuya109");
      }
      stdMat.emissiveMap = stdMat.map;
      stdMat.emissive = new THREE.Color(0xffffff);
      const dayIntensity = 0.25;
      const nightIntensity = 1.45;
      stdMat.emissiveIntensity = this.isNightActive ? nightIntensity : dayIntensity;
      stdMat.roughness = 0.22;
      stdMat.metalness = 0.38;
      this.shibuyaStreamEmissiveEntries.push({
        material: stdMat,
        dayIntensity,
        nightIntensity,
      });
      this.applyArchitecture3DTexture(stdMat, "anodized_metal");
      return;
    }

    // 15. 渋谷スクランブル交差点 屋外大型LEDビジョン＆ビルボード実写ストリートビューテクスチャ
    const isCrossingBillboard = matName.includes("ShibuyaCrossingBillboard");
    if (isCrossingBillboard) {
      if (!stdMat.map) {
        stdMat.map = shibuyaTextureManager.getTexture("billboards");
      }
      stdMat.emissiveMap = stdMat.map;
      stdMat.emissive = new THREE.Color(0xffffff);
      const dayIntensity = 0.45;
      const nightIntensity = 1.85;
      stdMat.emissiveIntensity = this.isNightActive ? nightIntensity : dayIntensity;
      stdMat.roughness = 0.15;
      stdMat.metalness = 0.22;
      this.shibuyaStreamEmissiveEntries.push({
        material: stdMat,
        dayIntensity,
        nightIntensity,
      });
      this.applyArchitecture3DTexture(stdMat, "curtain_glass");
      return;
    }

    // 16. 渋谷スクランブルスクエア 東棟超高層ファサード実写ストリートビューテクスチャ
    const isScrambleSquareFacade = matName.includes("ShibuyaScrambleSquareFacade");
    if (isScrambleSquareFacade) {
      if (!stdMat.map) {
        stdMat.map = shibuyaTextureManager.getTexture("scrambleSquare");
      }
      stdMat.emissiveMap = stdMat.map;
      stdMat.emissive = new THREE.Color(0xffffff);
      const dayIntensity = 0.1;
      const nightIntensity = 1.25;
      stdMat.emissiveIntensity = this.isNightActive ? nightIntensity : dayIntensity;
      stdMat.roughness = 0.12;
      stdMat.metalness = 0.45;
      this.shibuyaStreamEmissiveEntries.push({
        material: stdMat,
        dayIntensity,
        nightIntensity,
      });
      this.applyArchitecture3DTexture(stdMat, "curtain_glass");
      return;
    }

    // 17. 渋谷ストリーム 水流（Stream）千鳥ルーバーファサード実写ストリートビューテクスチャ
    const isStreamFacade = matName.includes("ShibuyaStreamFacade");
    if (isStreamFacade) {
      if (!stdMat.map) {
        stdMat.map = shibuyaTextureManager.getTexture("stream");
      }
      stdMat.emissiveMap = stdMat.map;
      stdMat.emissive = new THREE.Color(0xffffff);
      const dayIntensity = 0.08;
      const nightIntensity = 1.15;
      stdMat.emissiveIntensity = this.isNightActive ? nightIntensity : dayIntensity;
      stdMat.roughness = 0.24;
      stdMat.metalness = 0.32;
      this.shibuyaStreamEmissiveEntries.push({
        material: stdMat,
        dayIntensity,
        nightIntensity,
      });
      this.applyArchitecture3DTexture(stdMat, "curtain_glass");
      return;
    }

    // 18. MIYASHITA PARK 商業ファサード＆渋谷横丁実写ストリートビューテクスチャ
    const isMiyashitaParkFacade = matName.includes("ShibuyaMiyashitaParkFacade");
    if (isMiyashitaParkFacade) {
      if (!stdMat.map) {
        stdMat.map = shibuyaTextureManager.getTexture("miyashitaPark");
      }
      stdMat.emissiveMap = stdMat.map;
      stdMat.emissive = new THREE.Color(0xffffff);
      const dayIntensity = 0.22;
      const nightIntensity = 1.35;
      stdMat.emissiveIntensity = this.isNightActive ? nightIntensity : dayIntensity;
      stdMat.roughness = 0.32;
      stdMat.metalness = 0.25;
      this.shibuyaStreamEmissiveEntries.push({
        material: stdMat,
        dayIntensity,
        nightIntensity,
      });
      this.applyArchitecture3DTexture(stdMat, "retail_storefront");
      return;
    }

    // 19. 明治通り・国道246号 沿道商業ビル（コンビニ・ドラッグストア・飲食店）実写ストリートビューテクスチャ
    const isCommercialFacade = matName.includes("ShibuyaCommercialFacade");
    if (isCommercialFacade) {
      if (!stdMat.map) {
        stdMat.map = shibuyaTextureManager.getTexture("commercialFacade");
      }
      stdMat.emissiveMap = stdMat.map;
      stdMat.emissive = new THREE.Color(0xffffff);
      const dayIntensity = 0.25;
      const nightIntensity = 1.45;
      stdMat.emissiveIntensity = this.isNightActive ? nightIntensity : dayIntensity;
      stdMat.roughness = 0.38;
      stdMat.metalness = 0.18;
      this.shibuyaStreamEmissiveEntries.push({
        material: stdMat,
        dayIntensity,
        nightIntensity,
      });
      this.applyArchitecture3DTexture(stdMat, "retail_storefront");
      return;
    }

    // 20. 渋谷スクランブルスクエア 屋上ヘリポート着陸帯（緑色着陸パッド、道路標識ではない）
    const isHeliportGreenPad = matName.includes("HeliportGreenPad");
    if (isHeliportGreenPad) {
      stdMat.color = new THREE.Color(0x065f46);
      stdMat.roughness = 0.55;
      stdMat.metalness = 0.08;
      this.applyArchitecture3DTexture(stdMat, "white_granite");
      return;
    }

    // 21. JR跨道グリーンスチール鉄道橋
    const isJrGreenSteel = matName.includes("JRGreenSteel");
    if (isJrGreenSteel) {
      stdMat.color = new THREE.Color(0x0f5132);
      stdMat.roughness = 0.45;
      stdMat.metalness = 0.75;
      this.applyArchitecture3DTexture(stdMat, "anodized_metal");
      return;
    }

    // 22. MAGNET by SHIBUYA109（旧109MEN'S）ガラスカーテンウォール＆渋谷駅前大型LEDビジョン実写ストリートビューテクスチャ
    const isMagnetFacade = matName.includes("ShibuyaMagnetFacade");
    if (isMagnetFacade) {
      if (!stdMat.map) {
        stdMat.map = shibuyaTextureManager.getTexture("magnet");
      }
      stdMat.emissiveMap = stdMat.map;
      stdMat.emissive = new THREE.Color(0xffffff);
      const dayIntensity = 0.35;
      const nightIntensity = 1.75;
      stdMat.emissiveIntensity = this.isNightActive ? nightIntensity : dayIntensity;
      stdMat.roughness = 0.16;
      stdMat.metalness = 0.38;
      this.shibuyaStreamEmissiveEntries.push({
        material: stdMat,
        dayIntensity,
        nightIntensity,
      });
      this.applyArchitecture3DTexture(stdMat, "curtain_glass");
      return;
    }

    // 23. 渋谷マークシティ（イースト棟95.6m・ウエスト棟85m・空中回廊コンコース）アルミルーバー＆連窓実写ストリートビューテクスチャ
    const isMarkCityFacade = matName.includes("ShibuyaMarkCityFacade");
    if (isMarkCityFacade) {
      if (!stdMat.map) {
        stdMat.map = shibuyaTextureManager.getTexture("markCity");
      }
      stdMat.emissiveMap = stdMat.map;
      stdMat.emissive = new THREE.Color(0xffffff);
      const dayIntensity = 0.12;
      const nightIntensity = 1.35;
      stdMat.emissiveIntensity = this.isNightActive ? nightIntensity : dayIntensity;
      stdMat.roughness = 0.22;
      stdMat.metalness = 0.32;
      this.shibuyaStreamEmissiveEntries.push({
        material: stdMat,
        dayIntensity,
        nightIntensity,
      });
      this.applyArchitecture3DTexture(stdMat, "anodized_metal");
      return;
    }

    // 24. 渋谷東映プラザ / ビックカメラ渋谷東口店（宮益坂下）大看板＆商業ファサード実写ストリートビューテクスチャ
    const isToeiBicFacade = matName.includes("ShibuyaToeiBicFacade");
    if (isToeiBicFacade) {
      if (!stdMat.map) {
        stdMat.map = shibuyaTextureManager.getTexture("toeiBic");
      }
      stdMat.emissiveMap = stdMat.map;
      stdMat.emissive = new THREE.Color(0xffffff);
      const dayIntensity = 0.38;
      const nightIntensity = 1.8;
      stdMat.emissiveIntensity = this.isNightActive ? nightIntensity : dayIntensity;
      stdMat.roughness = 0.28;
      stdMat.metalness = 0.2;
      this.shibuyaStreamEmissiveEntries.push({
        material: stdMat,
        dayIntensity,
        nightIntensity,
      });
      this.applyArchitecture3DTexture(stdMat, "retail_storefront");
      return;
    }

    // 25. 道玄坂・宮益坂 沿道商業ビル（飲食店・ドラッグストア・雑居ビル）実写ストリートビューテクスチャ
    const isDogenzakaCommercialFacade = matName.includes("ShibuyaDogenzakaCommercialFacade");
    if (isDogenzakaCommercialFacade) {
      if (!stdMat.map) {
        stdMat.map = shibuyaTextureManager.getTexture("dogenzakaCommercial");
      }
      stdMat.emissiveMap = stdMat.map;
      stdMat.emissive = new THREE.Color(0xffffff);
      const dayIntensity = 0.28;
      const nightIntensity = 1.55;
      stdMat.emissiveIntensity = this.isNightActive ? nightIntensity : dayIntensity;
      stdMat.roughness = 0.36;
      stdMat.metalness = 0.18;
      this.shibuyaStreamEmissiveEntries.push({
        material: stdMat,
        dayIntensity,
        nightIntensity,
      });
      this.applyArchitecture3DTexture(stdMat, "retail_storefront");
      return;
    }

    this.applyArchitecture3DTexture(stdMat, "anodized_metal");
  }

  private loadGlbShibuyaStreamModel(): Promise<void> {
    const isBrowser = typeof window !== "undefined";
    if (!isBrowser) {
      return Promise.resolve();
    }
    const isAlreadyLoaded = this.glbShibuyaStreamGroup !== null;
    if (isAlreadyLoaded) {
      return Promise.resolve();
    }
    const hasInflightPromise = this.shibuyaStreamGlbLoadingPromise !== null;
    if (hasInflightPromise && this.shibuyaStreamGlbLoadingPromise) {
      return this.shibuyaStreamGlbLoadingPromise;
    }

    const config = assetManager.getModelConfig("shibuya_stream");
    const rawPath = config?.path ?? "/models/shibuya_stream.glb";
    const modelPath = assetManager.resolveAssetUrl(rawPath);
    const loader = new GLTFLoader();

    const loadPromise = new Promise<void>((resolve) => {
      loader.load(
        modelPath,
        (gltf) => {
          const glbModel = gltf.scene;
          const hasLoadedScene = Boolean(glbModel);
          if (!hasLoadedScene) {
            this.shibuyaStreamGlbLoadingPromise = null;
            resolve();
            return;
          }

          const offsetX = config?.offset[0] ?? -695.0;
          const offsetY = config?.offset[1] ?? 0.0;
          const offsetZ = config?.offset[2] ?? -15.0;
          glbModel.position.set(offsetX, offsetY, offsetZ);
          glbModel.userData.basePositionY = offsetY;
          glbModel.userData.baseScaleY = 1;
          // How: Blender 座標系で -Y 正面（Three.js GLB +Z 正面）に造形された渋谷ストリームを -90° 回転させ、
          // 西側（x = -750）を走る明治通りに向かって正面広場・大階段が正対するように配置する
          glbModel.rotation.y = -Math.PI / 2;

          glbModel.traverse((child) => {
            const isMesh = (child as THREE.Mesh).isMesh;
            if (!isMesh) {
              return;
            }
            const mesh = child as THREE.Mesh;
            mesh.castShadow = true;
            mesh.receiveShadow = true;

            const isMaterialArray = Array.isArray(mesh.material);
            if (isMaterialArray) {
              const matList = mesh.material as THREE.Material[];
              for (let i = 0; i < matList.length; i++) {
                this.applyShibuyaStreamGlbMaterial3DTexture(matList[i], mesh.name);
              }
            } else {
              this.applyShibuyaStreamGlbMaterial3DTexture(
                mesh.material as THREE.Material,
                mesh.name,
              );
            }
          });

          this.glbShibuyaStreamGroup = glbModel;
          this.group.add(glbModel);
          this.registerObjectInChunk(glbModel, "shibuya-core");

          const isShibuyaCoreUnloaded = this.unloadedChunkIds.has("shibuya-core");
          glbModel.visible = !isShibuyaCoreUnloaded;
          this.setShibuyaGlbOverlappingProceduralVisible(isShibuyaCoreUnloaded);

          const hasValidLastFocus = !Number.isNaN(this.lastCulledFocusPos.x);
          if (hasValidLastFocus) {
            const prevFocus = this.lastCulledFocusPos.clone();
            this.updateDistanceCulling(prevFocus, 380, true);
          }
          this.shibuyaStreamGlbLoadingPromise = null;
          resolve();
        },
        undefined,
        (error) => {
          console.warn("Notice: Using procedural Shibuya Stream model (GLB load skipped):", error);
          this.shibuyaStreamGlbLoadingPromise = null;
          resolve();
        },
      );
    });
    this.shibuyaStreamGlbLoadingPromise = loadPromise;
    return loadPromise;
  }

  private loadGlbShibuyaPlateauModel(): Promise<void> {
    const isBrowser = typeof window !== "undefined";
    if (!isBrowser) {
      return Promise.resolve();
    }
    const isAlreadyLoaded = this.glbShibuyaPlateauGroup !== null;
    if (isAlreadyLoaded) {
      return Promise.resolve();
    }
    const hasInflightPromise = this.shibuyaPlateauGlbLoadingPromise !== null;
    if (hasInflightPromise && this.shibuyaPlateauGlbLoadingPromise) {
      return this.shibuyaPlateauGlbLoadingPromise;
    }

    const config = assetManager.getModelConfig("shibuya_plateau_buildings");
    const rawPath = config?.path ?? "/models/shibuya_plateau_buildings.glb";
    const modelPath = assetManager.resolveAssetUrl(rawPath);
    const loader = new GLTFLoader();

    const loadPromise = new Promise<void>((resolve) => {
      loader.load(
        modelPath,
        (gltf) => {
          const glbModel = gltf.scene;
          const hasLoadedScene = Boolean(glbModel);
          if (!hasLoadedScene) {
            this.shibuyaPlateauGlbLoadingPromise = null;
            resolve();
            return;
          }

          const offsetX = config?.offset[0] ?? 0.0;
          const offsetY = config?.offset[1] ?? 0.0;
          const offsetZ = config?.offset[2] ?? 0.0;
          glbModel.position.set(offsetX, offsetY, offsetZ);
          glbModel.userData.basePositionY = offsetY;
          glbModel.userData.baseScaleY = 1;
          glbModel.userData.isLargeStructure = true;
          glbModel.userData.maxLodDrawDistance = 800;

          this.plateauTileMeshes = [];
          const detailedTileMeshes: THREE.Mesh[] = [];
          const proxyTileMap = new Map<string, THREE.Mesh>();

          glbModel.traverse((child) => {
            const isMesh = (child as THREE.Mesh).isMesh;
            if (!isMesh) {
              return;
            }
            const mesh = child as THREE.Mesh;
            const meshName = mesh.name || "";
            const isProxy = meshName.startsWith("PlateauProxyTile_");

            if (isProxy) {
              mesh.castShadow = false;
              mesh.receiveShadow = false;
              mesh.visible = false;
              mesh.userData.isPlateauProxy = true;
              const tileId = meshName.replace("PlateauProxyTile_", "");
              proxyTileMap.set(tileId, mesh);

              const isMaterialArray = Array.isArray(mesh.material);
              if (isMaterialArray) {
                const matList = mesh.material as THREE.Material[];
                for (let i = 0; i < matList.length; i++) {
                  this.applyShibuyaPlateauGlbMaterial3DTexture(matList[i]);
                }
              } else {
                this.applyShibuyaPlateauGlbMaterial3DTexture(mesh.material as THREE.Material);
              }
              return;
            }

            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.userData.initialCastShadow = true;
            mesh.userData.isLargeStructure = true;
            mesh.userData.maxLodDrawDistance = 800;

            const tileBounds = new THREE.Box3().setFromObject(mesh);
            mesh.userData.cullingBounds = tileBounds;

            const isMaterialArray = Array.isArray(mesh.material);
            if (isMaterialArray) {
              const matList = mesh.material as THREE.Material[];
              for (let i = 0; i < matList.length; i++) {
                this.applyShibuyaPlateauGlbMaterial3DTexture(matList[i]);
              }
            } else {
              this.applyShibuyaPlateauGlbMaterial3DTexture(mesh.material as THREE.Material);
            }
            detailedTileMeshes.push(mesh);
          });

          for (let i = 0; i < detailedTileMeshes.length; i++) {
            const tileMesh = detailedTileMeshes[i];
            const tileId = (tileMesh.name || "").replace("PlateauTile_", "");
            const proxyMesh = proxyTileMap.get(tileId);
            if (proxyMesh) {
              tileMesh.userData.proxyMesh = proxyMesh;
              tileMesh.userData.detailedGeometry = tileMesh.geometry;
              tileMesh.userData.proxyGeometry = proxyMesh.geometry;
              tileMesh.userData.detailedMaterial = tileMesh.material;
              tileMesh.userData.proxyMaterial = proxyMesh.material;
            } else {
              this.ensurePlateauTileProxy(tileMesh);
            }
            this.plateauTileMeshes.push(tileMesh);
          }

          this.glbShibuyaPlateauGroup = glbModel;
          this.group.add(glbModel);
          this.registerObjectInChunk(glbModel, "shibuya-core");

          const isShibuyaCoreUnloaded = this.unloadedChunkIds.has("shibuya-core");
          glbModel.visible = !isShibuyaCoreUnloaded;

          const hasValidLastFocus = !Number.isNaN(this.lastCulledFocusPos.x);
          if (hasValidLastFocus) {
            const prevFocus = this.lastCulledFocusPos.clone();
            this.updateDistanceCulling(prevFocus, 380, true);
          }
          this.shibuyaPlateauGlbLoadingPromise = null;
          resolve();
        },
        undefined,
        (error) => {
          console.warn("Notice: Plateau Shibuya buildings GLB load skipped:", error);
          this.shibuyaPlateauGlbLoadingPromise = null;
          resolve();
        },
      );
    });

    this.shibuyaPlateauGlbLoadingPromise = loadPromise;
    return loadPromise;
  }

  public applyShibuyaPlateauGlbMaterial3DTexture(mat: THREE.Material | null | undefined): void {
    const isStandardMat = Boolean(
      mat && (mat as THREE.MeshStandardMaterial).isMeshStandardMaterial,
    );
    if (!isStandardMat) {
      return;
    }
    const stdMat = mat as THREE.MeshStandardMaterial;
    const matName = stdMat.name || "";

    if (matName.includes("PlateauGlassTower")) {
      const tex = shibuyaTextureManager.getTexture("plateauLod2Facade");
      stdMat.map = tex;
      stdMat.roughness = 0.18;
      stdMat.metalness = 0.45;
      const dayIntensity = 0.05;
      const nightIntensity = 1.25;
      stdMat.emissive = new THREE.Color(0xa5f3fc);
      stdMat.emissiveMap = tex;
      stdMat.emissiveIntensity = this.isNightActive ? nightIntensity : dayIntensity;
      this.shibuyaStreamEmissiveEntries.push({
        material: stdMat,
        dayIntensity,
        nightIntensity,
      });
      this.applyArchitecture3DTexture(stdMat, "curtain_glass");
      return;
    }

    if (matName.includes("PlateauCommercialFacade")) {
      const tex = shibuyaTextureManager.getTexture("plateauLod2Facade");
      stdMat.map = tex;
      stdMat.roughness = 0.35;
      stdMat.metalness = 0.2;
      const dayIntensity = 0.06;
      const nightIntensity = 1.15;
      stdMat.emissive = new THREE.Color(0xfde68a);
      stdMat.emissiveMap = tex;
      stdMat.emissiveIntensity = this.isNightActive ? nightIntensity : dayIntensity;
      this.shibuyaStreamEmissiveEntries.push({
        material: stdMat,
        dayIntensity,
        nightIntensity,
      });
      this.applyArchitecture3DTexture(stdMat, "retail_storefront");
      return;
    }

    if (matName.includes("PlateauAlleyCommercial")) {
      const tex = shibuyaTextureManager.getTexture("dogenzakaCommercial");
      stdMat.map = tex;
      stdMat.roughness = 0.45;
      stdMat.metalness = 0.15;
      const dayIntensity = 0.04;
      const nightIntensity = 0.95;
      stdMat.emissive = new THREE.Color(0xfef08a);
      stdMat.emissiveMap = tex;
      stdMat.emissiveIntensity = this.isNightActive ? nightIntensity : dayIntensity;
      this.shibuyaStreamEmissiveEntries.push({
        material: stdMat,
        dayIntensity,
        nightIntensity,
      });
      this.applyArchitecture3DTexture(stdMat, "stone_punched");
      return;
    }

    if (matName.includes("PlateauLod2Proxy")) {
      const tex = shibuyaTextureManager.getTexture("plateauLod2Facade");
      stdMat.map = tex;
      stdMat.roughness = 0.65;
      stdMat.metalness = 0.15;
      const dayIntensity = 0.05;
      const nightIntensity = 0.45;
      stdMat.emissive = new THREE.Color(0xffe8ba);
      stdMat.emissiveMap = tex;
      stdMat.emissiveIntensity = this.isNightActive ? nightIntensity : dayIntensity;
      this.shibuyaStreamEmissiveEntries.push({
        material: stdMat,
        dayIntensity,
        nightIntensity,
      });
      return;
    }

    if (matName.includes("PlateauRooftop")) {
      stdMat.roughness = 0.65;
      stdMat.metalness = 0.08;
      this.applyArchitecture3DTexture(stdMat, "white_granite");
      return;
    }

    this.applyArchitecture3DTexture(stdMat, "anodized_metal");
  }

  /**
   * PLATEAU タイルメッシュに LOD2 軽量プロキシ表現（低ポリゴン・軽量マテリアル）を保証・付与する
   */
  public ensurePlateauTileProxy(tileMesh: THREE.Mesh): void {
    if (tileMesh.userData.proxyGeometry && tileMesh.userData.proxyMaterial) {
      return;
    }
    if (!tileMesh.userData.detailedGeometry) {
      tileMesh.userData.detailedGeometry = tileMesh.geometry;
    }
    if (!tileMesh.userData.detailedMaterial) {
      tileMesh.userData.detailedMaterial = tileMesh.material;
    }

    const bounds =
      (tileMesh.userData.cullingBounds as THREE.Box3) ?? this.getOrComputeBounds(tileMesh);
    const size = new THREE.Vector3();
    bounds.getSize(size);

    const proxyGeo = new THREE.BoxGeometry(
      Math.max(1, size.x),
      Math.max(1, size.y),
      Math.max(1, size.z),
    );
    const center = new THREE.Vector3();
    bounds.getCenter(center);
    const offset = center.clone().sub(tileMesh.position);
    proxyGeo.translate(offset.x, offset.y, offset.z);

    const proxyMat = shibuyaTextureManager.createPlateauLod2ProxyMaterial(this.isNightActive);
    this.shibuyaStreamEmissiveEntries.push({
      material: proxyMat,
      dayIntensity: 0.05,
      nightIntensity: 0.45,
    });

    tileMesh.userData.proxyGeometry = proxyGeo;
    tileMesh.userData.proxyMaterial = proxyMat;
  }

  private buildSurroundingSkyscrapers(world: RAPIER.World, rapier: typeof RAPIER): void {
    // 東京都 Project PLATEAU 千代田区 (13101) 実在18棟の3D都市モデルデータから構築
    // How: 実測の JGD2011 座標変換位置 (x, z)・実測高 (measuredHeight)・百尺基壇 (31m)・地上階数を反映する
    const buildingPositions = getPlateauBuildingsForMap();

    const mullionMetalMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      metalness: 0.78,
      roughness: 0.28,
    });
    this.applyArchitecture3DTexture(mullionMetalMat, "anodized_metal");

    const crownLouverMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      metalness: 0.65,
      roughness: 0.35,
    });
    this.applyArchitecture3DTexture(crownLouverMat, "anodized_metal");

    const beaconRedMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });

    for (const b of buildingPositions) {
      const bGroup = new THREE.Group();
      bGroup.name = b.buildingId;
      bGroup.userData = {
        buildingId: b.buildingId,
        gmlId: b.gmlId,
        name: b.name,
        nameEn: b.nameEn,
        usage: b.usage,
        measuredHeight: b.h,
        storeysAboveGround: b.storeysAboveGround,
        groundElevationM: b.groundElevationM,
        isLargeStructure: true,
      };
      bGroup.position.set(b.x, b.h / 2, b.z);

      // 丸の内百尺（31m）歴史的スカイライン階層（中層ビルの場合は建物高に応じて比率調整）
      const podiumHeight = Math.min(b.podiumHeight, b.h * 0.58);
      const crownHeight = Math.min(10, Math.max(4, b.h * 0.08));
      const towerHeight = Math.max(6, b.h - podiumHeight - crownHeight);

      // 1. 低層基壇部（丸の内31m歴史的百尺ポディウム：東京海上日動は赤レンガ、明治生命館は重厚石造パンチング、他は白御影石）
      const isTokioMarine = b.buildingId === "13101-bldg-604";
      const isMeijiYasuda = b.buildingId === "13101-bldg-3449";
      const isHotel = b.usage === "宿泊施設";

      let podiumTextureMode: "white_granite" | "red_brick" | "stone_punched" = "white_granite";
      if (isTokioMarine) {
        podiumTextureMode = "red_brick";
      } else if (isMeijiYasuda) {
        podiumTextureMode = "stone_punched";
      }

      const baseGeo = new THREE.BoxGeometry(b.w, podiumHeight, b.d);
      const baseMat = new THREE.MeshStandardMaterial({
        color: b.podiumColor,
        roughness: 0.62,
        metalness: 0.12,
      });
      this.applyArchitecture3DTexture(baseMat, podiumTextureMode);
      const baseMesh = new THREE.Mesh(baseGeo, baseMat);
      baseMesh.position.y = -b.h / 2 + podiumHeight / 2;
      baseMesh.castShadow = true;
      baseMesh.receiveShadow = true;
      bGroup.add(baseMesh);

      // 1b. 低層1F〜2F 商業路面ショーウィンドウ・ロビーガラス＆コロネード（PLATEAU LOD2 実写ファサード・木々＆地面映り込み）
      const storefrontGeo = new THREE.BoxGeometry(b.w * 0.96, 6.5, b.d * 0.96);
      const lod2StorefrontTex = shibuyaTextureManager.getTexture("plateauLod2Facade");
      const lobbyGlassMat = new THREE.MeshStandardMaterial({
        map: lod2StorefrontTex,
        color: 0xffffff,
        emissive: b.warmInterior,
        emissiveMap: lod2StorefrontTex,
        emissiveIntensity: 0.38,
        roughness: 0.2,
      });
      this.applyArchitecture3DTexture(lobbyGlassMat, "retail_storefront");
      const storefrontMesh = new THREE.Mesh(storefrontGeo, lobbyGlassMat);
      storefrontMesh.position.y = -b.h / 2 + 3.6;
      storefrontMesh.userData.lodDetailTier = "high";
      bGroup.add(storefrontMesh);

      // ポディウム最上部のコーニス（31m 水平軒蛇腹）
      const corniceGeo = new THREE.BoxGeometry(b.w + 1.4, 1.4, b.d + 1.4);
      const corniceMesh = new THREE.Mesh(corniceGeo, baseMat);
      corniceMesh.position.y = -b.h / 2 + podiumHeight;
      corniceMesh.userData.lodDetailTier = "high";
      bGroup.add(corniceMesh);

      // 2. セットバック高層タワー本体（ビルの個性に応じたファサードスタイル）
      let towerTextureMode: "curtain_glass" | "stone_punched" | "ribbon_window" = "curtain_glass";
      if (isTokioMarine) {
        // 東京海上日動ビル本館（前川國男設計の端正なパンチングウィンドウ）
        towerTextureMode = "stone_punched";
      } else if (isHotel) {
        // パレスホテル東京（皇居前の水平連窓リボンウィンドウ＆テラス）
        towerTextureMode = "ribbon_window";
      } else if (b.h < 85 && (b.storeysAboveGround ?? 0) <= 20) {
        // 中層モダニズムビルには水平連窓と石造パンチング窓を交互に配し、街並みの多様性を創出
        const isEvenStoreys = (b.storeysAboveGround ?? 0) % 2 === 0;
        towerTextureMode = isEvenStoreys ? "ribbon_window" : "stone_punched";
      }

      const towerW = b.w * 0.86;
      const towerD = b.d * 0.86;
      const towerCenterY = -b.h / 2 + podiumHeight + towerHeight / 2;
      const towerGeo = new THREE.BoxGeometry(towerW, towerHeight, towerD);
      const glassTowerMat = new THREE.MeshPhysicalMaterial({
        color: b.color,
        metalness: 0.85,
        roughness: 0.14,
        reflectivity: 0.92,
        clearcoat: 0.85,
      });
      this.applyArchitecture3DTexture(glassTowerMat, towerTextureMode);
      const towerMesh = new THREE.Mesh(towerGeo, glassTowerMat);
      towerMesh.position.y = towerCenterY;
      towerMesh.castShadow = true;
      towerMesh.receiveShadow = true;
      bGroup.add(towerMesh);

      // 3. 垂直アルミマリオン（方立）列
      const mullionCols = 7;
      for (let m = 0; m < mullionCols; m++) {
        const ratio = -0.42 + (m / (mullionCols - 1)) * 0.84;
        const mullionXGeo = new THREE.BoxGeometry(0.45, towerHeight, towerD + 0.35);
        const mullionXMesh = new THREE.Mesh(mullionXGeo, mullionMetalMat);
        mullionXMesh.position.set(towerW * ratio, towerCenterY, 0);
        mullionXMesh.userData.lodDetailTier = "high";
        bGroup.add(mullionXMesh);

        const mullionZGeo = new THREE.BoxGeometry(towerW + 0.35, towerHeight, 0.45);
        const mullionZMesh = new THREE.Mesh(mullionZGeo, mullionMetalMat);
        mullionZMesh.position.set(0, towerCenterY, towerD * ratio);
        mullionZMesh.userData.lodDetailTier = "high";
        bGroup.add(mullionZMesh);
      }

      // 4. 水平スパンドレル＆オフィス階層照明バンド
      const stripeCount = Math.max(3, Math.min(18, Math.floor(towerHeight / 8)));
      const stripeMat = new THREE.MeshStandardMaterial({
        color: b.glass,
        emissive: b.glass,
        emissiveIntensity: 0.32,
        roughness: 0.2,
      });
      this.applyArchitecture3DTexture(stripeMat, "curtain_glass");
      for (let i = 0; i < stripeCount; i++) {
        const stripeY =
          -b.h / 2 + podiumHeight + 3 + i * (Math.max(4, towerHeight - 5) / stripeCount);
        const stripeGeo = new THREE.BoxGeometry(towerW + 0.25, 1.05, towerD + 0.25);
        const stripeMesh = new THREE.Mesh(stripeGeo, stripeMat);
        stripeMesh.position.y = stripeY;
        stripeMesh.userData.lodDetailTier = "medium";
        bGroup.add(stripeMesh);
      }

      // 5. 屋上メカニカルルーバー冠部（Crown）＆航空障害灯（赤色ビーコン：60m以上の高層建築物）
      const crownCenterY = b.h / 2 - crownHeight / 2;
      const crownGeo = new THREE.BoxGeometry(towerW * 0.78, crownHeight, towerD * 0.78);
      const crownMesh = new THREE.Mesh(crownGeo, crownLouverMat);
      crownMesh.position.y = crownCenterY;
      bGroup.add(crownMesh);

      const requiresAviationBeacon = b.h >= 60;
      if (requiresAviationBeacon) {
        for (const [bx, bz] of [
          [towerW * 0.38, towerD * 0.38],
          [-towerW * 0.38, towerD * 0.38],
          [towerW * 0.38, -towerD * 0.38],
          [-towerW * 0.38, -towerD * 0.38],
        ]) {
          const beaconGeo = new THREE.SphereGeometry(0.45, 8, 8);
          const beaconMesh = new THREE.Mesh(beaconGeo, beaconRedMat);
          beaconMesh.position.set(bx, b.h / 2 + 0.6, bz);
          beaconMesh.userData.lodDetailTier = "medium";
          bGroup.add(beaconMesh);
        }
      }

      this.group.add(bGroup);
      this.plateauBuildingGroups.push(bGroup);

      // 物理コライダー（Rapier）
      const bBodyDesc = rapier.RigidBodyDesc.fixed().setTranslation(b.x, b.h / 2, b.z);
      const bBody = world.createRigidBody(bBodyDesc);
      const bCollider = rapier.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2)
        .setFriction(0.5)
        .setRestitution(0.1);
      this.registerCollider(world.createCollider(bCollider, bBody), true);
    }
  }

  /**
   * 10倍広域マップ拡張エリアの都市街並み・ビル群を構築する
   * 原宿・表参道、恵比寿・代官山、山手通り・神泉、六本木・赤坂、皇居周回、銀座・数寄屋橋、新橋・汐留、神田・秋葉原、八重洲東
   * の主要街区に実在スケールの都市高層ビル群・商業施設・ランドマークタワーを配置し、遠景のビル街スカイラインを形成する。
   */
  private buildExpandedMetropolitanDistricts(world: RAPIER.World, rapier: typeof RAPIER): void {
    const districts: Array<{
      id: string;
      name: string;
      nameEn: string;
      x: number;
      z: number;
      w: number;
      d: number;
      h: number;
      usage: string;
      mode:
        | "curtain_glass"
        | "white_granite"
        | "stone_punched"
        | "anodized_metal"
        | "ribbon_window";
      color: number;
      podiumColor: number;
    }> = [
      // 1. 原宿・表参道エリア (harajuku-yoyogi / omotesando-aoyama-north)
      {
        id: "exp-bldg-harajuku-fashion-1",
        name: "原宿ファッションプラザ",
        nameEn: "Harajuku Fashion Plaza",
        x: -795,
        z: 450,
        w: 42,
        d: 38,
        h: 48,
        usage: "商業施設",
        mode: "curtain_glass",
        color: 0x38bdf8,
        podiumColor: 0x1e293b,
      },
      {
        id: "exp-bldg-harajuku-boutique",
        name: "原宿ブティックタワー",
        nameEn: "Harajuku Boutique Tower",
        x: -705,
        z: 480,
        w: 36,
        d: 34,
        h: 56,
        usage: "商業施設",
        mode: "anodized_metal",
        color: 0x94a3b8,
        podiumColor: 0x334155,
      },
      {
        id: "exp-bldg-omotesando-complex",
        name: "表参道テラスコンプレックス",
        nameEn: "Omotesando Terrace Complex",
        x: -610,
        z: 400,
        w: 78,
        d: 32,
        h: 36,
        usage: "商業施設",
        mode: "curtain_glass",
        color: 0x0284c7,
        podiumColor: 0x0f172a,
      },
      {
        id: "exp-bldg-omotesando-luxury",
        name: "表参道ラグジュアリータワー",
        nameEn: "Omotesando Luxury Tower",
        x: -490,
        z: 360,
        w: 38,
        d: 38,
        h: 64,
        usage: "業務施設",
        mode: "white_granite",
        color: 0xe2e8f0,
        podiumColor: 0x64748b,
      },
      {
        id: "exp-bldg-yoyogi-gym-tower",
        name: "代々木パークタワー",
        nameEn: "Yoyogi Park Tower",
        x: -800,
        z: 720,
        w: 48,
        d: 42,
        h: 72,
        usage: "業務施設",
        mode: "ribbon_window",
        color: 0x475569,
        podiumColor: 0x1e293b,
      },
      {
        id: "exp-bldg-harajuku-station-front",
        name: "原宿駅前ゲートビル",
        nameEn: "Harajuku Station Gate Building",
        x: -795,
        z: 820,
        w: 40,
        d: 36,
        h: 52,
        usage: "商業施設",
        mode: "curtain_glass",
        color: 0x38bdf8,
        podiumColor: 0x0f172a,
      },

      // 2. 恵比寿・代官山エリア (ebisu-daikanyama)
      {
        id: "exp-bldg-ebisu-garden-tower",
        name: "恵比寿ガーデンタワー",
        nameEn: "Ebisu Garden Tower",
        x: -705,
        z: -720,
        w: 52,
        d: 48,
        h: 167,
        usage: "業務施設",
        mode: "curtain_glass",
        color: 0x1e293b,
        podiumColor: 0x0f172a,
      },
      {
        id: "exp-bldg-ebisu-station-front",
        name: "恵比寿駅前ビル",
        nameEn: "Ebisu Station Front Building",
        x: -795,
        z: -750,
        w: 46,
        d: 40,
        h: 68,
        usage: "商業施設",
        mode: "anodized_metal",
        color: 0x64748b,
        podiumColor: 0x334155,
      },
      {
        id: "exp-bldg-daikanyama-terrace",
        name: "代官山テラスセンター",
        nameEn: "Daikanyama Terrace Center",
        x: -880,
        z: -480,
        w: 44,
        d: 38,
        h: 42,
        usage: "商業施設",
        mode: "stone_punched",
        color: 0xd6d3d1,
        podiumColor: 0x57534e,
      },
      {
        id: "exp-bldg-ebisu-south-office",
        name: "恵比寿サウスオフィスタワー",
        nameEn: "Ebisu South Office Tower",
        x: -705,
        z: -900,
        w: 42,
        d: 38,
        h: 84,
        usage: "業務施設",
        mode: "ribbon_window",
        color: 0x334155,
        podiumColor: 0x1e293b,
      },

      // 3. 山手通り・神泉・松濤エリア (shibuya-west)
      {
        id: "exp-bldg-shinsen-crossing",
        name: "神泉交差点タワー",
        nameEn: "Shinsen Crossing Tower",
        x: -920,
        z: 140,
        w: 42,
        d: 36,
        h: 78,
        usage: "業務施設",
        mode: "curtain_glass",
        color: 0x0f172a,
        podiumColor: 0x334155,
      },
      {
        id: "exp-bldg-shoto-heights",
        name: "松濤レジデンスハイツ",
        nameEn: "Shoto Residence Heights",
        x: -1080,
        z: 140,
        w: 48,
        d: 38,
        h: 46,
        usage: "共同住宅",
        mode: "white_granite",
        color: 0xf1f5f9,
        podiumColor: 0x64748b,
      },
      {
        id: "exp-bldg-yamate-shinsen-center",
        name: "山手神泉センタービル",
        nameEn: "Yamate Shinsen Center Building",
        x: -1290,
        z: 140,
        w: 54,
        d: 42,
        h: 96,
        usage: "業務施設",
        mode: "anodized_metal",
        color: 0x475569,
        podiumColor: 0x1e293b,
      },
      {
        id: "exp-bldg-yamate-komazawa-tower",
        name: "山手駒沢タワー",
        nameEn: "Yamate Komazawa Tower",
        x: -1290,
        z: -480,
        w: 48,
        d: 42,
        h: 88,
        usage: "業務施設",
        mode: "ribbon_window",
        color: 0x1e293b,
        podiumColor: 0x0f172a,
      },
      {
        id: "exp-bldg-yamate-tomigaya-tower",
        name: "山手富ヶ谷タワー",
        nameEn: "Yamate Tomigaya Tower",
        x: -1290,
        z: 480,
        w: 46,
        d: 40,
        h: 92,
        usage: "業務施設",
        mode: "curtain_glass",
        color: 0x0284c7,
        podiumColor: 0x1e293b,
      },

      // 4. 六本木・西麻布・赤坂エリア (roppongi-nishiazabu / aoyama-east)
      {
        id: "exp-bldg-roppongi-hills-mori",
        name: "六本木ヒルズ森タワー",
        nameEn: "Roppongi Hills Mori Tower",
        x: -380,
        z: -420,
        w: 68,
        d: 62,
        h: 238,
        usage: "業務施設",
        mode: "curtain_glass",
        color: 0x0284c7,
        podiumColor: 0x0f172a,
      },
      {
        id: "exp-bldg-roppongi-grand-tower",
        name: "六本木グランドタワー",
        nameEn: "Roppongi Grand Tower",
        x: -320,
        z: -300,
        w: 54,
        d: 48,
        h: 180,
        usage: "業務施設",
        mode: "curtain_glass",
        color: 0x0f172a,
        podiumColor: 0x1e293b,
      },
      {
        id: "exp-bldg-nishi-azabu-crossing",
        name: "西麻布クロッシングビル",
        nameEn: "Nishi-Azabu Crossing Building",
        x: -600,
        z: -300,
        w: 44,
        d: 38,
        h: 62,
        usage: "商業施設",
        mode: "anodized_metal",
        color: 0x64748b,
        podiumColor: 0x334155,
      },
      {
        id: "exp-bldg-akasaka-ark-hills",
        name: "赤坂アークヒルズタワー",
        nameEn: "Akasaka Ark Hills Tower",
        x: -220,
        z: -220,
        w: 56,
        d: 50,
        h: 153,
        usage: "業務施設",
        mode: "stone_punched",
        color: 0x78716c,
        podiumColor: 0x44403c,
      },
      {
        id: "exp-bldg-akasaka-biz-tower",
        name: "赤坂Bizタワー",
        nameEn: "Akasaka Biz Tower",
        x: -220,
        z: 80,
        w: 52,
        d: 46,
        h: 179,
        usage: "業務施設",
        mode: "curtain_glass",
        color: 0x38bdf8,
        podiumColor: 0x0f172a,
      },

      // 5. 皇居周回（半蔵門・竹橋: kokyo-west-hanzomon / kokyo-north-takebashi）
      {
        id: "exp-bldg-national-theater",
        name: "国立劇場・伝統芸能館",
        nameEn: "National Theatre of Japan",
        x: -290,
        z: 480,
        w: 64,
        d: 52,
        h: 38,
        usage: "文教施設",
        mode: "stone_punched",
        color: 0x292524,
        podiumColor: 0x1c1917,
      },
      {
        id: "exp-bldg-hanzomon-media",
        name: "半蔵門メディアセンター",
        nameEn: "Hanzomon Media Center",
        x: -290,
        z: 750,
        w: 48,
        d: 42,
        h: 86,
        usage: "業務施設",
        mode: "white_granite",
        color: 0xe2e8f0,
        podiumColor: 0x475569,
      },
      {
        id: "exp-bldg-palace-side-takebashi",
        name: "パレスサイドビルディング",
        nameEn: "Palaceside Building",
        x: -50,
        z: 780,
        w: 84,
        d: 44,
        h: 48,
        usage: "業務施設",
        mode: "anodized_metal",
        color: 0x475569,
        podiumColor: 0x1e293b,
      },
      {
        id: "exp-bldg-kanda-nishikicho-square",
        name: "神田錦町スクエアタワー",
        nameEn: "Kanda Nishikicho Square Tower",
        x: 60,
        z: 780,
        w: 52,
        d: 46,
        h: 110,
        usage: "業務施設",
        mode: "curtain_glass",
        color: 0x0284c7,
        podiumColor: 0x0f172a,
      },

      // 6. 銀座・数寄屋橋・晴海通り (ginza-sukiyabashi)
      {
        id: "exp-bldg-ginza-wako-clock",
        name: "銀座和光クロックビル",
        nameEn: "Ginza Wako Clock Building",
        x: 110,
        z: -300,
        w: 44,
        d: 40,
        h: 58,
        usage: "商業施設",
        mode: "white_granite",
        color: 0xfef08a,
        podiumColor: 0x78716c,
      },
      {
        id: "exp-bldg-ginza-mitsukoshi",
        name: "銀座三越デパートメント",
        nameEn: "Ginza Mitsukoshi Department Store",
        x: 198,
        z: -300,
        w: 56,
        d: 48,
        h: 54,
        usage: "商業施設",
        mode: "stone_punched",
        color: 0x78716c,
        podiumColor: 0x44403c,
      },
      {
        id: "exp-bldg-sukiyabashi-plaza",
        name: "数寄屋橋東急プラザ",
        nameEn: "Sukiyabashi Tokyu Plaza",
        x: -50,
        z: -300,
        w: 58,
        d: 46,
        h: 66,
        usage: "商業施設",
        mode: "curtain_glass",
        color: 0x0284c7,
        podiumColor: 0x0f172a,
      },
      {
        id: "exp-bldg-kabukiza-tower",
        name: "歌舞伎座タワー",
        nameEn: "Kabukiza Tower",
        x: 480,
        z: -300,
        w: 54,
        d: 48,
        h: 143,
        usage: "業務施設",
        mode: "curtain_glass",
        color: 0x38bdf8,
        podiumColor: 0x1e293b,
      },

      // 7. 新橋・汐留エリア (shimbashi-shiodome)
      {
        id: "exp-bldg-shiodome-dentsu-tower",
        name: "汐留電通タワー",
        nameEn: "Shiodome Dentsu Tower",
        x: 480,
        z: -820,
        w: 62,
        d: 54,
        h: 213,
        usage: "業務施設",
        mode: "curtain_glass",
        color: 0x0284c7,
        podiumColor: 0x0f172a,
      },
      {
        id: "exp-bldg-shiodome-nippon-tv",
        name: "汐留日本テレビタワー",
        nameEn: "Shiodome NTV Tower",
        x: 400,
        z: -700,
        w: 54,
        d: 48,
        h: 192,
        usage: "業務施設",
        mode: "anodized_metal",
        color: 0x334155,
        podiumColor: 0x0f172a,
      },
      {
        id: "exp-bldg-shimbashi-sl-station",
        name: "新橋SLステーションビル",
        nameEn: "Shimbashi SL Station Building",
        x: 60,
        z: -700,
        w: 46,
        d: 40,
        h: 52,
        usage: "商業施設",
        mode: "ribbon_window",
        color: 0x64748b,
        podiumColor: 0x1e293b,
      },
      {
        id: "exp-bldg-shimbashi-keihin-tower",
        name: "新橋第一京浜タワー",
        nameEn: "Shimbashi Daiichi-Keihin Tower",
        x: 200,
        z: -820,
        w: 48,
        d: 44,
        h: 96,
        usage: "業務施設",
        mode: "curtain_glass",
        color: 0x0f172a,
        podiumColor: 0x1e293b,
      },

      // 8. 神田・秋葉原エリア (kanda-akihabara)
      {
        id: "exp-bldg-nihombashi-mitsukoshi-main",
        name: "日本橋三越本店",
        nameEn: "Nihombashi Mitsukoshi Main Store",
        x: 110,
        z: 320,
        w: 62,
        d: 52,
        h: 42,
        usage: "商業施設",
        mode: "white_granite",
        color: 0xf5f5f4,
        podiumColor: 0x78716c,
      },
      {
        id: "exp-bldg-kanda-station-tower",
        name: "神田駅前タワー",
        nameEn: "Kanda Station Front Tower",
        x: 210,
        z: 600,
        w: 48,
        d: 42,
        h: 98,
        usage: "業務施設",
        mode: "curtain_glass",
        color: 0x0284c7,
        podiumColor: 0x0f172a,
      },
      {
        id: "exp-bldg-akihabara-udx-cross",
        name: "秋葉原UDXクロスタワー",
        nameEn: "Akihabara UDX Cross Tower",
        x: 210,
        z: 800,
        w: 64,
        d: 54,
        h: 107,
        usage: "業務施設",
        mode: "curtain_glass",
        color: 0x0f172a,
        podiumColor: 0x334155,
      },

      // 9. 八重洲・昭和通り東エリア (yaesu-showadori-east)
      {
        id: "exp-bldg-yaesu-midtown-tower",
        name: "東京ミッドタウン八重洲",
        nameEn: "Tokyo Midtown Yaesu",
        x: 480,
        z: 80,
        w: 64,
        d: 56,
        h: 240,
        usage: "業務施設",
        mode: "curtain_glass",
        color: 0x0284c7,
        podiumColor: 0x0f172a,
      },
      {
        id: "exp-bldg-takaracho-complex",
        name: "宝町メガコンプレックス",
        nameEn: "Takaracho Mega Complex",
        x: 620,
        z: -120,
        w: 54,
        d: 48,
        h: 125,
        usage: "業務施設",
        mode: "ribbon_window",
        color: 0x334155,
        podiumColor: 0x1e293b,
      },
      {
        id: "exp-bldg-kabutocho-financial",
        name: "兜町フィナンシャルタワー",
        nameEn: "Kabutocho Financial Tower",
        x: 620,
        z: 280,
        w: 52,
        d: 46,
        h: 130,
        usage: "業務施設",
        mode: "anodized_metal",
        color: 0x475569,
        podiumColor: 0x1e293b,
      },
    ];

    const lod2ProxyMat = shibuyaTextureManager.createPlateauLod2ProxyMaterial();
    const beaconRedMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });

    for (const b of districts) {
      const bGroup = new THREE.Group();
      bGroup.name = b.id;
      bGroup.userData = {
        buildingId: b.id,
        gmlId: `13100-expanded-${b.id}`,
        name: b.name,
        nameEn: b.nameEn,
        usage: b.usage,
        measuredHeight: b.h,
        storeysAboveGround: Math.round(b.h / 3.8),
        groundElevationM: 0,
        isLargeStructure: true,
      };
      bGroup.position.set(b.x, b.h / 2, b.z);

      const podiumHeight = Math.min(28, b.h * 0.35);
      const crownHeight = Math.min(10, Math.max(4, b.h * 0.08));
      const towerHeight = Math.max(8, b.h - podiumHeight - crownHeight);

      // 1. 低層ポディウム
      const baseGeo = new THREE.BoxGeometry(b.w, podiumHeight, b.d);
      const baseMat = new THREE.MeshStandardMaterial({
        color: b.podiumColor,
        roughness: 0.65,
        metalness: 0.15,
      });
      this.applyArchitecture3DTexture(
        baseMat,
        b.mode === "white_granite" ? "white_granite" : "anodized_metal",
      );
      const baseMesh = new THREE.Mesh(baseGeo, baseMat);
      baseMesh.position.y = -b.h / 2 + podiumHeight / 2;
      baseMesh.castShadow = true;
      baseMesh.receiveShadow = true;
      baseMesh.userData.lodDetailTier = "high";
      bGroup.add(baseMesh);

      // 2. タワー部（高層カーテンウォール / パンチング石造）
      const towerGeo = new THREE.BoxGeometry(b.w * 0.94, towerHeight, b.d * 0.94);
      const towerMat = new THREE.MeshStandardMaterial({
        color: b.color,
        roughness: b.mode === "curtain_glass" ? 0.18 : 0.55,
        metalness: b.mode === "curtain_glass" ? 0.88 : 0.25,
      });
      this.applyArchitecture3DTexture(towerMat, b.mode);
      const towerMesh = new THREE.Mesh(towerGeo, towerMat);
      towerMesh.position.y = -b.h / 2 + podiumHeight + towerHeight / 2;
      towerMesh.castShadow = true;
      towerMesh.receiveShadow = true;
      towerMesh.userData.lodDetailTier = "high";
      bGroup.add(towerMesh);

      // 3. 塔屋・クラウン
      const crownGeo = new THREE.BoxGeometry(b.w * 0.65, crownHeight, b.d * 0.65);
      const crownMat = new THREE.MeshStandardMaterial({
        color: 0x334155,
        metalness: 0.72,
        roughness: 0.32,
      });
      this.applyArchitecture3DTexture(crownMat, "anodized_metal");
      const crownMesh = new THREE.Mesh(crownGeo, crownMat);
      crownMesh.position.y = b.h / 2 - crownHeight / 2;
      crownMesh.userData.lodDetailTier = "medium";
      bGroup.add(crownMesh);

      // 4. 超高層ビル (h >= 60m) の航空障害灯
      if (b.h >= 60) {
        const beaconGeo = new THREE.SphereGeometry(0.7, 8, 8);
        const beaconMesh = new THREE.Mesh(beaconGeo, beaconRedMat);
        beaconMesh.position.set(0, b.h / 2 + 0.5, 0);
        beaconMesh.userData.lodDetailTier = "medium";
        bGroup.add(beaconMesh);
      }

      // 5. 遠距離用軽量プロキシメッシュ（LOD2）
      const proxyGeo = new THREE.BoxGeometry(b.w, b.h, b.d);
      const proxyMesh = new THREE.Mesh(proxyGeo, lod2ProxyMat);
      proxyMesh.position.set(0, 0, 0);
      proxyMesh.visible = false;
      proxyMesh.userData.isLodProxyMesh = true;
      proxyMesh.userData.lodDetailTier = "low";
      bGroup.add(proxyMesh);

      this.group.add(bGroup);
      this.plateauBuildingGroups.push(bGroup);

      // 物理コライダー（Rapier）
      const bBodyDesc = rapier.RigidBodyDesc.fixed().setTranslation(b.x, b.h / 2, b.z);
      const bBody = world.createRigidBody(bBodyDesc);
      const bCollider = rapier.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2)
        .setFriction(0.5)
        .setRestitution(0.1);
      this.registerCollider(world.createCollider(bCollider, bBody), true);
    }
  }

  private buildStreetProps(world: RAPIER.World, rapier: typeof RAPIER): void {
    // 街路樹・街灯・ボラード・道路標識用の共有固定剛体（ワールド原点配置）
    const streetPropsBody = world.createRigidBody(
      rapier.RigidBodyDesc.fixed().setTranslation(0, 0, 0),
    );

    // 1. 行幸通りのイチョウ並木（歩道 |x| = 8.75m..13.25m の中央 x = ±11.5m、およびサイドエスプラネード x = ±19.5m）
    // ※ 丸の内仲通り交差部（z ∈ [150, 180]）を除外して車道への樹木干渉を防止
    const treePositions = [-11.5, 11.5, -19.5, 19.5];
    let treeIndex = 0;
    for (let z = 14; z < 245; z += 18) {
      const isNearNakadoriIntersection = Math.abs(z - 165) < 16;
      if (isNearNakadoriIntersection) {
        continue;
      }
      for (const x of treePositions) {
        this.createGinkgoTree(x, z, treeIndex, world, rapier, streetPropsBody);
        treeIndex++;
      }
    }

    // 2. 丸の内仲通り（z = 165）のケヤキ・イチョウ並木（z = 165 ± 9.2m の歩道上、大手町〜丸の内〜有楽町）
    for (let x = -420; x <= 420; x += 28) {
      const isNearIntersection =
        Math.abs(x) < 22 ||
        Math.abs(x - -156) < 18 ||
        Math.abs(x - 156) < 18 ||
        Math.abs(x - -268) < 22 ||
        Math.abs(x - 270) < 22;
      if (isNearIntersection) {
        continue;
      }
      this.createGinkgoTree(x, 165 - 9.2, treeIndex++, world, rapier, streetPropsBody);
      this.createGinkgoTree(x, 165 + 9.2, treeIndex++, world, rapier, streetPropsBody);
    }

    // 3. 日比谷通り（z = 250）＆ 内堀通り・皇居外苑（z = 365）の並木（大手町 x=-450 〜 日比谷 x=+450）
    for (let x = -450; x <= 450; x += 36) {
      const isNearIntersection =
        Math.abs(x) < 24 ||
        Math.abs(x - -156) < 18 ||
        Math.abs(x - 156) < 18 ||
        Math.abs(x - -268) < 24 ||
        Math.abs(x - 270) < 24;
      if (isNearIntersection) {
        continue;
      }
      this.createGinkgoTree(x, 250 - 14.5, treeIndex++, world, rapier, streetPropsBody);
      this.createGinkgoTree(x, 365 - 11.5, treeIndex++, world, rapier, streetPropsBody);
      this.createGinkgoTree(x, 365 + 11.5, treeIndex++, world, rapier, streetPropsBody);
    }

    // 4. 永代通り（x = -268）＆ 鍛冶橋通り・馬場先門通り（x = +270）の街路樹
    for (const arterialX of [-268, 270]) {
      for (let z = 25; z <= 340; z += 32) {
        const isNearCrossRoad =
          Math.abs(z - 5) < 18 ||
          (arterialX === -268 && Math.abs(z - 95) < 18) ||
          Math.abs(z - 165) < 18 ||
          Math.abs(z - 250) < 22 ||
          Math.abs(z - 365) < 18;
        if (isNearCrossRoad) {
          continue;
        }
        this.createGinkgoTree(arterialX - 11.2, z, treeIndex++, world, rapier, streetPropsBody);
        this.createGinkgoTree(arterialX + 11.2, z, treeIndex++, world, rapier, streetPropsBody);
      }
    }

    // 5. 渋谷・明治通り（x = -750）および渋谷川遊歩道（x = -673.5）のケヤキ・イチョウ並木
    for (let z = -175; z <= 185; z += 28) {
      const isNearShibuyaCrossRoad =
        Math.abs(z - -200) < 18 ||
        Math.abs(z - -95) < 18 ||
        Math.abs(z - 95) < 22 ||
        Math.abs(z - 195) < 18;
      if (isNearShibuyaCrossRoad) {
        continue;
      }
      this.createGinkgoTree(-750 - 14.8, z, treeIndex++, world, rapier, streetPropsBody);
      this.createGinkgoTree(-750 + 14.8, z, treeIndex++, world, rapier, streetPropsBody);
      const isAlongShibuyaRiver = z >= -150 && z <= 40;
      if (isAlongShibuyaRiver) {
        this.createGinkgoTree(-673.5, z, treeIndex++, world, rapier, streetPropsBody);
      }
    }

    // Blender CLI 生成 GLB 街路樹モデルの非同期ロード＆全スロットへの展開
    if (!this.deferGlbLoads) {
      this.glbLoadPromises.push(this.loadBlenderStreetTreeGlb());
    }

    // 街灯（夜間に点灯：丸の内・行幸通り・仲通り・日比谷通り・永代通り・馬場先門通りの黒鋳鉄製2灯式クラシカル街灯 + 渋谷明治通り）
    for (let z = 18; z < 245; z += 35) {
      const isNearNakadori = Math.abs(z - 165) < 15;
      if (isNearNakadori) {
        continue;
      }
      this.createStreetLamp(-12.8, z, world, rapier, streetPropsBody);
      this.createStreetLamp(12.8, z, world, rapier, streetPropsBody);
    }
    for (let x = -400; x <= 400; x += 65) {
      const isNearIntersection =
        Math.abs(x) < 22 ||
        Math.abs(x - -156) < 18 ||
        Math.abs(x - 156) < 18 ||
        Math.abs(x - -268) < 22 ||
        Math.abs(x - 270) < 22;
      if (isNearIntersection) {
        continue;
      }
      this.createStreetLamp(x, 165 - 8.8, world, rapier, streetPropsBody);
      this.createStreetLamp(x, 250 - 14.2, world, rapier, streetPropsBody);
      this.createStreetLamp(x, 365 + 11.2, world, rapier, streetPropsBody);
    }
    for (let z = -165; z <= 175; z += 42) {
      const isNearShibuyaCrossRoad =
        Math.abs(z - -200) < 18 ||
        Math.abs(z - -95) < 18 ||
        Math.abs(z - 95) < 20 ||
        Math.abs(z - 195) < 18;
      if (isNearShibuyaCrossRoad) {
        continue;
      }
      this.createStreetLamp(-750 - 14.2, z, world, rapier, streetPropsBody);
      this.createStreetLamp(-750 + 14.2, z, world, rapier, streetPropsBody);
    }

    // 行幸通り石造ボラード（車止め御影石柱：歩道車道境界縁石 |x|=8.75m のすぐ内側 x = ±9.15m に実寸配置）
    this.buildGraniteBollards(world, rapier, streetPropsBody);
  }

  private buildGraniteBollards(
    world: RAPIER.World,
    rapier: typeof RAPIER,
    streetPropsBody: RAPIER.RigidBody,
  ): void {
    const graniteMat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1, // 白御影石（稲田石）
      roughness: 0.72,
      metalness: 0.08,
    });
    this.applyArchitecture3DTexture(graniteMat, "white_granite");

    const bronzeRingMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b, // ブロンズ黒装飾リング
      roughness: 0.4,
      metalness: 0.85,
    });
    this.applyArchitecture3DTexture(bronzeRingMat, "anodized_metal");

    // 実寸ボラード（直径 28〜30cm = 半径 0.14〜0.15m、地上高約 0.85m）
    const postGeo = new THREE.CylinderGeometry(0.14, 0.15, 0.74, 12);
    const capGeo = new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const bandGeo = new THREE.CylinderGeometry(0.146, 0.146, 0.045, 12);

    for (let z = 18; z <= 232; z += 12) {
      const isNearNakadori = Math.abs(z - 165) < 15;
      if (isNearNakadori) {
        continue;
      }
      for (const x of [-9.15, 9.15]) {
        const bollard = new THREE.Group();
        bollard.position.set(x, 0, z);
        bollard.userData.maxLodDrawDistance = 115;

        const post = new THREE.Mesh(postGeo, graniteMat);
        post.position.y = 0.37;
        post.castShadow = false;
        post.receiveShadow = true;
        bollard.add(post);

        const cap = new THREE.Mesh(capGeo, graniteMat);
        cap.position.y = 0.74;
        cap.userData.lodDetailTier = "high";
        bollard.add(cap);

        const band = new THREE.Mesh(bandGeo, bronzeRingMat);
        band.position.y = 0.62;
        band.userData.lodDetailTier = "high";
        bollard.add(band);

        this.group.add(bollard);

        // 御影石ボラード物理コライダー（半径 0.16m, 高さ 0.90m）
        const bollardColDesc = this.createCylinderDesc(rapier, 0.45, 0.16)
          .setTranslation(x, 0.45, z)
          .setFriction(0.45)
          .setRestitution(0.15);
        this.registerCollider(world.createCollider(bollardColDesc, streetPropsBody), true);
      }
    }
  }

  private createGinkgoTree(
    x: number,
    z: number,
    index: number,
    world: RAPIER.World,
    rapier: typeof RAPIER,
    streetPropsBody: RAPIER.RigidBody,
  ): void {
    const slotGroup = new THREE.Group();
    slotGroup.position.set(x, 0, z);
    slotGroup.userData.isStreetTreeSlot = true;
    slotGroup.userData.maxLodDrawDistance = 260;

    // 実寸 1:1 スケール基準（0.96 .. 1.04 の自然な個体差のみ付与）
    const scale = 0.96 + ((index * 37) % 9) * 0.01;
    const rotationY = ((index * 73) % 360) * (Math.PI / 180);

    // 街路樹の幹の物理コライダー（根元半径 0.34m * scale, 高さ 3.6m）
    const trunkColliderDesc = this.createCylinderDesc(rapier, 1.8, 0.34 * scale)
      .setTranslation(x, 1.8, z)
      .setFriction(0.55)
      .setRestitution(0.1);
    this.registerCollider(world.createCollider(trunkColliderDesc, streetPropsBody), true);

    const fallbackGroup = new THREE.Group();
    fallbackGroup.scale.setScalar(scale);
    fallbackGroup.rotation.y = rotationY;

    // 1. 幹（木シェーダー TreeBarkMaterial 適用）
    const trunkGeo = new THREE.CylinderGeometry(0.14, 0.38, 6.2, 10, 6);
    const trunk = new THREE.Mesh(trunkGeo, this.sharedBarkMaterial);
    trunk.position.y = 3.1;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    fallbackGroup.add(trunk);

    // 2. 主枝・副枝（黄金角螺旋で広がる枝骨格）
    for (let b = 0; b < 6; b++) {
      const branchAngle = b * 2.399963 + 0.35;
      const branchGeo = new THREE.CylinderGeometry(0.035, 0.1, 2.35, 6);
      const branchMesh = new THREE.Mesh(branchGeo, this.sharedBarkMaterial);
      branchMesh.position.set(
        Math.cos(branchAngle) * 0.72,
        3.55 + b * 0.48,
        Math.sin(branchAngle) * 0.72,
      );
      branchMesh.rotation.z = -Math.cos(branchAngle) * 0.58;
      branchMesh.rotation.x = Math.sin(branchAngle) * 0.58;
      branchMesh.castShadow = false;
      branchMesh.userData.lodDetailTier = "medium";
      fallbackGroup.add(branchMesh);
    }

    // 3. 実体3Dイチョウ扇形葉ロゼット樹冠（葉柄・左右2裂片・中央二股切れ込みを持つ葉の集合体）
    // Why not: 球体(IcosahedronGeometry)や円錐(ConeGeometry)では葉っぱの形が分からない塊に
    // なってしまうため、1枚ずつ葉柄・扇形葉身・二股切れ込みを造形した3Dイチョウ葉ジオメトリを使用する
    const canopyMesh = new THREE.Mesh(this.sharedGinkgoCanopyGeometry, this.sharedFoliageMaterial);
    canopyMesh.castShadow = true;
    canopyMesh.receiveShadow = true;
    fallbackGroup.add(canopyMesh);

    slotGroup.add(fallbackGroup);
    this.group.add(slotGroup);
    const chunkId = resolveChunkIdAtPosition(x, z);
    this.treeSlots.push({
      slotGroup,
      fallbackGroup,
      scale,
      rotationY,
      chunkId,
      glbInstance: null,
    });
  }

  private loadBlenderStreetTreeGlb(): Promise<void> {
    const isBrowser = typeof window !== "undefined";
    if (!isBrowser) {
      return Promise.resolve();
    }
    const isTemplateAlreadyLoaded = this.glbTreeTemplate !== null;
    if (isTemplateAlreadyLoaded) {
      return Promise.resolve();
    }
    const hasInflightTreeLoad = this.treeTemplateLoadingPromise !== null;
    if (hasInflightTreeLoad && this.treeTemplateLoadingPromise) {
      return this.treeTemplateLoadingPromise;
    }

    const treeConfig = assetManager.getModelConfig("street_tree");
    const rawTreePath = treeConfig?.path ?? "/models/street_tree.glb";
    const resolvedTreeUrl = assetManager.resolveAssetUrl(rawTreePath);
    const loader = new GLTFLoader();

    const loadPromise = new Promise<void>((resolve) => {
      loader.load(
        resolvedTreeUrl,
        (gltf) => {
          const template = gltf.scene;
          template.traverse((child) => {
            const isMesh = (child as THREE.Mesh).isMesh;
            if (!isMesh) {
              return;
            }
            const mesh = child as THREE.Mesh;
            mesh.castShadow = true;
            mesh.receiveShadow = true;

            const meshName = mesh.name;
            const isFoliage = meshName.includes("Foliage");
            const isTrunk = meshName.includes("Trunk");

            if (isFoliage) {
              mesh.material = this.sharedFoliageMaterial;
            } else if (isTrunk) {
              mesh.material = this.sharedBarkMaterial;
            }
          });

          this.glbTreeTemplate = template;

          for (let i = 0; i < this.treeSlots.length; i++) {
            const slot = this.treeSlots[i];
            const isChunkUnloaded = this.unloadedChunkIds.has(slot.chunkId);
            if (isChunkUnloaded) {
              continue;
            }
            const hasExistingInstance = slot.glbInstance !== null;
            if (hasExistingInstance) {
              continue;
            }
            const instance = template.clone(true);
            instance.scale.setScalar(slot.scale);
            instance.rotation.y = slot.rotationY;
            slot.fallbackGroup.visible = false;
            slot.fallbackGroup.userData.permanentlyHiddenByGlb = true;
            slot.slotGroup.add(instance);
            slot.glbInstance = instance;
            this.cullingBoundsCache.delete(slot.slotGroup);
          }
          const hasValidLastFocus = !Number.isNaN(this.lastCulledFocusPos.x);
          if (hasValidLastFocus) {
            const prevFocus = this.lastCulledFocusPos.clone();
            this.lastCulledFocusPos.set(Number.NaN, Number.NaN, Number.NaN);
            this.updateDistanceCulling(prevFocus);
          }
          this.treeTemplateLoadingPromise = null;
          resolve();
        },
        undefined,
        (error) => {
          console.warn("Notice: Using procedural Ginkgo trees (GLB tree load skipped):", error);
          this.treeTemplateLoadingPromise = null;
          resolve();
        },
      );
    });
    this.treeTemplateLoadingPromise = loadPromise;
    return loadPromise;
  }

  private createStreetLamp(
    x: number,
    z: number,
    world: RAPIER.World,
    rapier: typeof RAPIER,
    streetPropsBody: RAPIER.RigidBody,
  ): void {
    const lampGroup = new THREE.Group();
    lampGroup.position.set(x, 0, z);
    lampGroup.userData.maxLodDrawDistance = 220;

    // 街灯ポールの物理コライダー（台座半径 0.22m, 高さ 5.0m）
    const lampColDesc = this.createCylinderDesc(rapier, 2.5, 0.22)
      .setTranslation(x, 2.5, z)
      .setFriction(0.4)
      .setRestitution(0.15);
    this.registerCollider(world.createCollider(lampColDesc, streetPropsBody), true);

    // 丸の内・行幸通り伝統の黒鋳鉄製フルート装飾ポール＋台座（3D鋳鉄砂型ディンプル質感）
    const poleMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      metalness: 0.85,
      roughness: 0.28,
    });
    this.applyArchitecture3DTexture(poleMat, "cast_iron");
    const baseGeo = new THREE.CylinderGeometry(0.18, 0.26, 0.9, 10);
    const base = new THREE.Mesh(baseGeo, poleMat);
    base.position.y = 0.45;
    base.userData.lodDetailTier = "high";
    lampGroup.add(base);

    const poleGeo = new THREE.CylinderGeometry(0.075, 0.12, 5.8, 10);
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = 3.1;
    pole.castShadow = false;
    lampGroup.add(pole);

    // 上部2灯式クラシカルブラケットアーム
    const armGeo = new THREE.BoxGeometry(1.3, 0.07, 0.07);
    const arm = new THREE.Mesh(armGeo, poleMat);
    arm.position.set(0, 5.75, 0);
    arm.userData.lodDetailTier = "medium";
    lampGroup.add(arm);

    // 2灯ランタングローブ（温白色ガス灯風）
    const headGeo = new THREE.SphereGeometry(0.28, 12, 12);
    const headMat = new THREE.MeshBasicMaterial({ color: 0xffedd5 });
    const capGeo = new THREE.ConeGeometry(0.32, 0.18, 10);
    for (const offsetX of [-0.58, 0.58]) {
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.set(offsetX, 6.0, 0);
      lampGroup.add(head);

      const cap = new THREE.Mesh(capGeo, poleMat);
      cap.position.set(offsetX, 6.28, 0);
      cap.userData.lodDetailTier = "high";
      lampGroup.add(cap);
    }

    // 点光源（Why 街灯の PointLight をシーンツリーに追加せず、代表ダミー1基のみを配列に保持するか:
    // visible = false にするだけでは Three.js のシーングラフ走査・ライト収集オーバーヘッドが残るため、
    // ランタングローブの発光表現は MeshBasicMaterial + 路面側のシェーダー反射で担い、
    // シーンツリーには PointLight を一切追加しない。streetLights 配列を参照するテストやインターフェースとの
    // 互換性のため、親を持たない代表 PointLight を最大1個のみ配列に保持する）
    const shouldCreateRepresentativeLight = this.streetLampCounter === 0;
    this.streetLampCounter += 1;
    if (shouldCreateRepresentativeLight) {
      const light = new THREE.PointLight(0xffecd2, 0.0, 52);
      light.position.set(x > 0 ? -0.58 : 0.58, 6.0, 0);
      light.visible = false;
      this.streetLights.push(light);
    }

    this.group.add(lampGroup);
  }

  private buildTokyoStreetSigns(world: RAPIER.World, rapier: typeof RAPIER): void {
    const signRigidBody = world.createRigidBody(
      rapier.RigidBodyDesc.fixed().setTranslation(0, 0, 0),
    );
    this.signPhysicsContext = {
      rapier,
      physicsWorld: world,
      fixedGroundBody: signRigidBody,
    };

    const signPlacements = assetManager.getSigns();
    const hasYamlSigns = signPlacements.length > 0;
    if (!hasYamlSigns) {
      // Why not: YAMLに標識設定が存在しない場合は何も配置せず早期リターン
      return;
    }

    for (const p of signPlacements) {
      const isOverhead = p.type === "overhead_guide";
      const isWadakuraGantry = p.id === "overhead_guide_wadakura";
      const isShibuyaStreamGantry = p.id === "overhead_guide_shibuya_stream";
      const enrichedSpec: RoadSignPlacement = isOverhead
        ? {
            ...p,
            label: p.label ?? "皇居・大手町",
            subLabel: p.subLabel ?? "Imperial Palace / Otemachi",
            leftLabel:
              p.leftLabel ??
              (isShibuyaStreamGantry
                ? "渋谷ストリーム・並木橋"
                : isWadakuraGantry
                  ? "桜田門・三宅坂"
                  : "日比谷・有楽町"),
            leftSubLabel:
              p.leftSubLabel ??
              (isShibuyaStreamGantry
                ? "Shibuya Stream / Namikibashi"
                : isWadakuraGantry
                  ? "Sakuradamon"
                  : "Hibiya / Yurakucho"),
            rightLabel: p.rightLabel ?? (isShibuyaStreamGantry ? "原宿・新宿" : "大手町・神田"),
            rightSubLabel:
              p.rightSubLabel ??
              (isShibuyaStreamGantry ? "Harajuku / Shinjuku" : "Otemachi / Kanda"),
            roadNumber: p.roadNumber ?? (isShibuyaStreamGantry ? "246" : "1"),
            subRoadNumber: p.subRoadNumber ?? (isShibuyaStreamGantry ? "305" : "404"),
            intersectionName:
              p.intersectionName ??
              (isShibuyaStreamGantry
                ? "渋谷ストリーム前"
                : isWadakuraGantry
                  ? "和田倉門"
                  : "行幸通り"),
            spanWidth: p.spanWidth ?? (isShibuyaStreamGantry ? 25.6 : 19.2),
            supportType: p.supportType ?? "cantilever",
          }
        : p;

      const instance = this.signSystem.createSignInstance(
        enrichedSpec,
        this.signPhysicsContext ?? undefined,
      );
      for (const col of instance.colliders) {
        this.registerCollider(col, true);
      }
      // Why 頭上案内標識・小型道路標識の SpotLight をすべてシーングラフから除外するか:
      // 標識板自体はガラスビーズ再帰反射シェーダーと emissive で夜間視認性を確保しており、
      // visible = false でもシーンツリーに SpotLight を残すと Three.js のシーングラフ走査負荷が残るため、
      // 親ノードから remove してシーンツリーには SpotLight を追加しない。
      for (const light of instance.spotLights) {
        light.visible = false;
        light.intensity = this.isNightActive ? 32.0 : 0.0;
        light.target.parent?.remove(light.target);
        light.parent?.remove(light);
      }
      if (isOverhead) {
        instance.group.userData.isLargeStructure = true;
        for (const light of instance.spotLights) {
          this.signSpotLights.push(light);
        }
      } else {
        instance.spotLights.length = 0;
      }
      this.group.add(instance.group);
    }
  }

  /**
   * 実行時に新しいカスタム道路標識をマップへ追加し、物理コライダーと夜間照明（SpotLight）へ即座に反映する。
   */
  public addCustomRoadSign(spec: RoadSignPlacement): CreatedRoadSignInstance {
    const existing = this.customSignInstances.get(spec.id);
    if (existing) {
      this.removeCustomRoadSign(spec.id);
    }

    const instance = this.signSystem.createSignInstance(spec, this.signPhysicsContext ?? undefined);
    for (const col of instance.colliders) {
      this.registerCollider(col, true);
    }
    for (const light of instance.spotLights) {
      light.visible = false;
      light.target.parent?.remove(light.target);
      light.parent?.remove(light);
      this.signSpotLights.push(light);
    }
    this.group.add(instance.group);
    this.customSignInstances.set(spec.id, instance);
    return instance;
  }

  /**
   * 実行時に追加したカスタム道路標識をシーン・物理ワールド・夜間照明から削除する。
   */
  public removeCustomRoadSign(id: string): boolean {
    const instance = this.customSignInstances.get(id);
    if (!instance) return false;

    this.group.remove(instance.group);
    for (const light of instance.spotLights) {
      const idx = this.signSpotLights.indexOf(light);
      const isFound = idx !== -1;
      if (isFound) {
        this.signSpotLights.splice(idx, 1);
      }
    }

    const physicsWorld = this.signPhysicsContext?.physicsWorld;
    for (const col of instance.colliders) {
      const colIdx = this.colliders.indexOf(col);
      if (colIdx !== -1) {
        this.colliders.splice(colIdx, 1);
      }
      const handleIdx = this.obstacleColliderHandles.indexOf(col.handle);
      if (handleIdx !== -1) {
        this.obstacleColliderHandles.splice(handleIdx, 1);
      }
      const canRemoveCollider = Boolean(
        physicsWorld && typeof physicsWorld.removeCollider === "function",
      );
      if (canRemoveCollider && physicsWorld) {
        physicsWorld.removeCollider(col, false);
      }
    }

    this.customSignInstances.delete(id);
    return true;
  }

  public getCustomRoadSigns(): CreatedRoadSignInstance[] {
    return Array.from(this.customSignInstances.values());
  }

  private buildImperialPalaceMoat(world: RAPIER.World, rapier: typeof RAPIER): void {
    // 皇居外苑内濠（和田倉濠: TP+1.56m / 日比谷濠: TP+2.04m）国土地理院DEM5A・PLATEAU水部データ準拠
    const moatConfigs = getPlateauWaterBodies();

    // 石垣マテリアル（江戸城伝統の切込接ぎ・巨石石垣 + 3D ボリュームテクスチャ）
    const stoneWallMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.85,
      metalness: 0.1,
    });
    this.attachArchitecture3DVolumeShader(stoneWallMat, "moat");

    for (const m of moatConfigs) {
      // 1. 水面メッシュ（Gerstner 波シェーダー用高密度グリッド）
      const waterGeo = new THREE.PlaneGeometry(m.w, m.d, 40, 20);
      waterGeo.rotateX(-Math.PI / 2);
      const waterMat = new WaterSurfaceMaterial({
        shallowColor: 0x14708c,
        deepColor: 0x031e2b,
        waveSpeed: 0.9,
        waveHeight: 0.28,
      });
      this.waterMaterials.push(waterMat);

      const waterMesh = new THREE.Mesh(waterGeo, waterMat);
      waterMesh.name = m.id;
      waterMesh.position.set(m.x, m.relativeWaterY, m.z);
      waterMesh.userData.isLargeStructure = true;
      this.group.add(waterMesh);

      // 2. お堀の4辺石垣（南岸・北岸・西岸・東岸の土手・転落防止擁壁）
      const wallThickness = 2.0;
      const wallHeight = 2.5;
      const wallCenterY = wallHeight / 2 - 1.0;
      const moatWallBody = world.createRigidBody(
        rapier.RigidBodyDesc.fixed().setTranslation(m.x, wallCenterY, m.z),
      );

      // 南岸・北岸（東西方向に伸びる石垣）
      const nsWallGeo = new THREE.BoxGeometry(m.w + wallThickness, wallHeight, wallThickness);
      for (const zOffset of [-m.d / 2, m.d / 2]) {
        const nsWallMesh = new THREE.Mesh(nsWallGeo, stoneWallMat);
        nsWallMesh.position.set(m.x, wallCenterY, m.z + zOffset);
        nsWallMesh.userData.isLargeStructure = true;
        nsWallMesh.castShadow = true;
        nsWallMesh.receiveShadow = true;
        this.group.add(nsWallMesh);

        const nsWallCol = rapier.ColliderDesc.cuboid(
          (m.w + wallThickness) / 2,
          wallHeight / 2,
          wallThickness / 2,
        )
          .setTranslation(0, 0, zOffset)
          .setFriction(0.55)
          .setRestitution(0.1);
        this.registerCollider(world.createCollider(nsWallCol, moatWallBody), true);
      }

      // 西岸・東岸（南北方向に伸びる石垣：行幸通り・内堀通り・永代通り・馬場先門通りからの転落を防止）
      const ewWallGeo = new THREE.BoxGeometry(wallThickness, wallHeight, m.d);
      for (const xOffset of [-m.w / 2, m.w / 2]) {
        const ewWallMesh = new THREE.Mesh(ewWallGeo, stoneWallMat);
        ewWallMesh.position.set(m.x + xOffset, wallCenterY, m.z);
        ewWallMesh.userData.isLargeStructure = true;
        ewWallMesh.castShadow = true;
        ewWallMesh.receiveShadow = true;
        this.group.add(ewWallMesh);

        const ewWallCol = rapier.ColliderDesc.cuboid(wallThickness / 2, wallHeight / 2, m.d / 2)
          .setTranslation(xOffset, 0, 0)
          .setFriction(0.55)
          .setRestitution(0.1);
        this.registerCollider(world.createCollider(ewWallCol, moatWallBody), true);
      }

      // お堀底面コライダー（水底）
      const waterFloorBodyDesc = rapier.RigidBodyDesc.fixed().setTranslation(m.x, -2.5, m.z);
      const waterFloorBody = world.createRigidBody(waterFloorBodyDesc);
      const waterFloorCollider = rapier.ColliderDesc.cuboid(m.w / 2, 0.5, m.d / 2);
      this.registerCollider(world.createCollider(waterFloorCollider, waterFloorBody), false);
    }
  }

  public updateRainWetness(
    wetness: number,
    time: number,
    envParams?: Omit<PuddleEnvironmentSyncParams, "wetness" | "time">,
  ): void {
    const syncPayload: PuddleEnvironmentSyncParams = {
      wetness,
      time,
      ...envParams,
    };
    for (let i = 0; i < this.roadMaterials.length; i++) {
      this.roadMaterials[i].syncEnvironment(syncPayload);
    }
    for (let i = 0; i < this.puddleMaterials.length; i++) {
      this.puddleMaterials[i].syncEnvironment(syncPayload);
    }
    RoadProps.syncRetroreflectorEnvironment({
      nightFactor: envParams?.nightFactor ?? (this.isNightActive ? 1.0 : 0.0),
    });

    // 雨天時は風がやや強まり、晴天・夕暮れ・夜間は心地よい丸の内ビル風でイチョウが揺れる
    const isRainyWind = (envParams?.rippleIntensity ?? 0) > 0.1;
    const windSpeed = isRainyWind ? 2.25 : 1.55;
    const windStrength = isRainyWind ? 0.36 : 0.22;

    for (let i = 0; i < this.foliageMaterials.length; i++) {
      this.foliageMaterials[i].syncEnvironment({
        wetness,
        time,
        windSpeed,
        windStrength,
        sunDirection: envParams?.sunDirection,
        sunColor: envParams?.sunColor,
        nightFactor: envParams?.nightFactor,
      });
    }
    for (let i = 0; i < this.barkMaterials.length; i++) {
      this.barkMaterials[i].syncEnvironment({
        wetness,
        time,
        windSpeed,
        windStrength,
        nightFactor: envParams?.nightFactor,
      });
    }

    for (let i = 0; i < this.waterMaterials.length; i++) {
      this.waterMaterials[i].uRainWetness.value = wetness;
      this.waterMaterials[i].uTime.value = time;
    }
  }

  public setNightMode(isNight: boolean): void {
    this.isNightActive = isNight;
    this.sharedArchUniforms.uNightModeFactor.value = isNight ? 1.0 : 0.0;
    for (let i = 0; i < this.streetLights.length; i++) {
      this.streetLights[i].intensity = isNight ? 22.0 : 0.0;
      this.streetLights[i].visible = false;
    }
    const signLightIntensity = isNight ? 32.0 : 0.0;
    for (let i = 0; i < this.signSpotLights.length; i++) {
      this.signSpotLights[i].intensity = signLightIntensity;
      this.signSpotLights[i].visible = false;
    }
    // 渋谷ストリームの建築アクセントサイン・イエローアクセント・ロビー窓の発光強度を夜間・夕暮れ時にブーストする
    for (let i = 0; i < this.shibuyaStreamEmissiveEntries.length; i++) {
      const entry = this.shibuyaStreamEmissiveEntries[i];
      entry.material.emissiveIntensity = isNight ? entry.nightIntensity : entry.dayIntensity;
    }
  }

  /**
   * マップ内の全トップレベルオブジェクトを代表座標から空間チャンクに割り当てる。
   * - How: `this.group.children` を走査し、`CityWideGroundMesh` 以外の全メッシュ・グループに対して
   *   バウンディングボックス中心（または position）から `resolveChunkIdAtPosition(x, z)` で所属チャンクを決定する。
   */
  private assignObjectsToWorldChunks(): void {
    const centerVec = new THREE.Vector3();
    const children = this.group.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const isCityGround = child.name === "CityWideGroundMesh";
      if (isCityGround) {
        continue;
      }

      if (typeof child.userData.basePositionY !== "number") {
        child.userData.basePositionY = child.position.y;
      }
      if (typeof child.userData.baseScaleY !== "number") {
        child.userData.baseScaleY = child.scale.y || 1;
      }

      let bounds = this.cullingBoundsCache.get(child);
      if (!bounds) {
        bounds = new THREE.Box3().setFromObject(child);
        this.cullingBoundsCache.set(child, bounds);
      }

      const isEmptyBounds = bounds.isEmpty();
      if (isEmptyBounds) {
        centerVec.copy(child.position);
      } else {
        bounds.getCenter(centerVec);
      }

      const chunkId = resolveChunkIdAtPosition(centerVec.x, centerVec.z);
      this.registerObjectInChunk(child, chunkId);
    }
  }

  private registerObjectInChunk(obj: THREE.Object3D, chunkId: WorldChunkId): void {
    const prevChunkId = this.objectToChunkId.get(obj);
    if (prevChunkId && prevChunkId !== chunkId) {
      const prevList = this.chunkObjectsMap.get(prevChunkId);
      if (prevList) {
        const idx = prevList.indexOf(obj);
        if (idx !== -1) {
          prevList.splice(idx, 1);
        }
      }
    }
    this.objectToChunkId.set(obj, chunkId);
    const list = this.chunkObjectsMap.get(chunkId);
    if (list && !list.includes(obj)) {
      list.push(obj);
    }
  }

  /**
   * 各空間チャンクに属するオブジェクト数を返す（StreamingSystem へ通知するため）。
   */
  public getChunkObjectCounts(): Record<WorldChunkId, number> {
    const counts = {} as Record<WorldChunkId, number>;
    for (const def of WORLD_CHUNK_DEFINITIONS) {
      const list = this.chunkObjectsMap.get(def.id) ?? [];
      counts[def.id] = list.length;
    }
    return counts;
  }

  /**
   * 指定チャンクをアクティブ化し、必要なランドマークGLBや街路樹GLBクローンを非同期展開する。
   */
  public async activateWorldChunk(chunkId: WorldChunkId): Promise<void> {
    this.unloadedChunkIds.delete(chunkId);

    const loadTasks: Promise<void>[] = [];
    const isShibuyaZone =
      chunkId === "shibuya-core" || chunkId === "shibuya-north" || chunkId === "shibuya-south";
    const isMarunouchiCore = chunkId === "marunouchi-core";

    if (isShibuyaZone && this.glbShibuyaStreamGroup === null) {
      loadTasks.push(this.loadGlbShibuyaStreamModel());
    }
    if (isShibuyaZone && this.glbShibuyaPlateauGroup === null) {
      loadTasks.push(this.loadGlbShibuyaPlateauModel());
    }
    if (isMarunouchiCore && this.glbStationGroup === null) {
      loadTasks.push(this.loadGlbStationModel());
    }
    if (this.glbTreeTemplate === null) {
      loadTasks.push(this.loadBlenderStreetTreeGlb());
    }

    const hasPendingLoads = loadTasks.length > 0;
    if (hasPendingLoads) {
      await Promise.all(loadTasks);
    }

    // 街路樹テンプレートがロード済みなら該当チャンクの未展開スロットにGLBインスタンスを割り当てる
    const hasTreeTemplate = this.glbTreeTemplate !== null;
    if (hasTreeTemplate && this.glbTreeTemplate) {
      for (let i = 0; i < this.treeSlots.length; i++) {
        const slot = this.treeSlots[i];
        const isTargetChunk = slot.chunkId === chunkId;
        const NeedsGlbClone = isTargetChunk && slot.glbInstance === null;
        if (!NeedsGlbClone) {
          continue;
        }
        const instance = this.glbTreeTemplate.clone(true);
        instance.scale.setScalar(slot.scale);
        instance.rotation.y = slot.rotationY;
        slot.fallbackGroup.visible = false;
        slot.fallbackGroup.userData.permanentlyHiddenByGlb = true;
        slot.slotGroup.add(instance);
        slot.glbInstance = instance;
        this.cullingBoundsCache.delete(slot.slotGroup);
      }
    }

    this.syncChunkVisibilityState();
  }

  /**
   * 遠方またはメモリ上限超過により不要となったチャンクをアンロード（解放）する。
   * - How:
   *   1. `unloadedChunkIds` に追加してチャンク内のオブジェクトを非表示にする。
   *   2. `marunouchi-core` / `shibuya-core` の大型ランドマークGLBが常駐している場合は、
   *      メッシュの geometry / material を `.dispose()` してシーングラフから除去し、GPU/ヒープメモリを解放する。
   *   3. 該当チャンクの街路樹GLBクローンも除去し、再度近づいた際に再展開できるようにする。
   */
  public evictWorldChunk(chunkId: WorldChunkId): void {
    this.unloadedChunkIds.add(chunkId);
    this.chunkTransitionAlphas.set(chunkId, 0);

    const isMarunouchiCore = chunkId === "marunouchi-core";
    if (isMarunouchiCore && this.glbStationGroup) {
      this.disposeGlbHierarchy(this.glbStationGroup);
      this.group.remove(this.glbStationGroup);
      const list = this.chunkObjectsMap.get("marunouchi-core");
      if (list) {
        const idx = list.indexOf(this.glbStationGroup);
        if (idx !== -1) {
          list.splice(idx, 1);
        }
      }
      this.objectToChunkId.delete(this.glbStationGroup);
      this.cullingBoundsCache.delete(this.glbStationGroup);
      this.glbStationGroup = null;
      if (this.proceduralStationGroup) {
        this.proceduralStationGroup.userData.permanentlyHiddenByGlb = false;
      }
    }

    const hasRemainingShibuyaChunks =
      !this.unloadedChunkIds.has("shibuya-core") ||
      !this.unloadedChunkIds.has("shibuya-north") ||
      !this.unloadedChunkIds.has("shibuya-south");

    if (!hasRemainingShibuyaChunks && this.glbShibuyaStreamGroup) {
      this.disposeGlbHierarchy(this.glbShibuyaStreamGroup);
      this.group.remove(this.glbShibuyaStreamGroup);
      const list = this.chunkObjectsMap.get("shibuya-core");
      if (list) {
        const idx = list.indexOf(this.glbShibuyaStreamGroup);
        if (idx !== -1) {
          list.splice(idx, 1);
        }
      }
      this.objectToChunkId.delete(this.glbShibuyaStreamGroup);
      this.cullingBoundsCache.delete(this.glbShibuyaStreamGroup);
      this.glbShibuyaStreamGroup = null;
      this.setShibuyaGlbOverlappingProceduralVisible(true);
    }

    if (!hasRemainingShibuyaChunks && this.glbShibuyaPlateauGroup) {
      this.disposeGlbHierarchy(this.glbShibuyaPlateauGroup);
      this.group.remove(this.glbShibuyaPlateauGroup);
      const list = this.chunkObjectsMap.get("shibuya-core");
      if (list) {
        const idx = list.indexOf(this.glbShibuyaPlateauGroup);
        if (idx !== -1) {
          list.splice(idx, 1);
        }
      }
      this.objectToChunkId.delete(this.glbShibuyaPlateauGroup);
      this.cullingBoundsCache.delete(this.glbShibuyaPlateauGroup);
      this.glbShibuyaPlateauGroup = null;
      this.plateauTileMeshes = [];
    }

    // 該当チャンクの街路樹GLBクローンを解放
    for (let i = 0; i < this.treeSlots.length; i++) {
      const slot = this.treeSlots[i];
      const isTargetChunk = slot.chunkId === chunkId;
      if (!isTargetChunk || !slot.glbInstance) {
        continue;
      }
      slot.slotGroup.remove(slot.glbInstance);
      slot.glbInstance = null;
      slot.fallbackGroup.userData.permanentlyHiddenByGlb = false;
      slot.fallbackGroup.visible = false;
      this.cullingBoundsCache.delete(slot.slotGroup);
    }

    const objects = this.chunkObjectsMap.get(chunkId) ?? [];
    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i];
      // Why 道路インフラメッシュ（車道・歩道・交差点パッド・曲線道路）および大型建築・ランドマーク構造物をチャンク Evict で非表示にしないか:
      // 1. 国道246号や明治通り・日比谷通りなどの道路セグメントは複数チャンクに跨っており、
      //    バウンディングボックス中心の1点だけで所属チャンクが Evict されると走行中の目の前の道路が突然消滅・点滅するため。
      // 2. 高層ビル（PLATEAU）・東京駅赤レンガ駅舎Proxy・渋谷ストリームProxy・お堀などの大型構造物は遠方からでも地平線のスカイラインとして視認されるため、
      //    チャンクアンロード時は高負荷GLBのみ解放しつつ、本体は超軽量な LOD2（low: 3ボックスシルエット・castShadow=false）へ降格して遠景描画を維持する。
      const isRoadInfra = Boolean(obj.userData?.isRoadInfrastructure);
      if (isRoadInfra) {
        continue;
      }
      const isLargeStructure = this.isLargeStructureObject(obj);
      if (isLargeStructure) {
        obj.visible = true;
        this.applySubtreeLodTier(obj, "low");
        continue;
      }
      obj.visible = false;
    }
  }

  /**
   * `shibuya_stream.glb` に一体収録されている渋谷ストリーム・渋谷スクランブルスクエア・渋谷ヒカリエ・
   * 渋谷サクラステージ・渋谷フクラス・MIYASHITA PARK・QFRONT/SHIBUYA109・
   * 首都高3号渋谷線コア区間（x = -865..-575）・東口歩道橋のプロシージャル Proxy メッシュ群の可視性を一括切り替えする。
   * - Why: GLB が近距離 LOD0 で表示されている間に同じワールド座標のプロシージャルメッシュも `visible = true` のままだと、
   *   高架床版・遮音壁・橋脚や各ランドマーク壁面で Z-fighting と二重描画が発生するため。
   */
  private setShibuyaGlbOverlappingProceduralVisible(showProcedural: boolean): void {
    const isPermanentlyHidden = !showProcedural;
    for (const procGroup of [
      this.proceduralShibuyaStreamGroup,
      this.proceduralScrambleSquareGroup,
      this.proceduralHikarieGroup,
      this.proceduralSakuraStageGroup,
      this.proceduralFukurasGroup,
      this.proceduralMiyashitaParkGroup,
      this.proceduralQfront109Group,
    ]) {
      if (procGroup) {
        procGroup.visible = showProcedural;
        procGroup.userData.permanentlyHiddenByGlb = isPermanentlyHidden;
      }
    }
    for (let i = 0; i < this.proceduralShutokoCoreMeshes.length; i++) {
      const coreMesh = this.proceduralShutokoCoreMeshes[i];
      coreMesh.visible = showProcedural;
      coreMesh.userData.permanentlyHiddenByGlb = isPermanentlyHidden;
      if (showProcedural && coreMesh.parent) {
        coreMesh.parent.userData.appliedLodTier = undefined;
      }
    }
  }

  private isLargeStructureObject(obj: THREE.Object3D): boolean {
    const isGlbLandmark = obj === this.glbStationGroup || obj === this.glbShibuyaStreamGroup;
    if (isGlbLandmark) {
      return false;
    }
    return Boolean(
      obj === this.glbShibuyaPlateauGroup ||
      obj.userData?.isLargeStructure ||
      obj.userData?.buildingId ||
      obj === this.proceduralStationGroup ||
      obj === this.proceduralShibuyaStreamGroup,
    );
  }

  private disposeGlbHierarchy(root: THREE.Object3D): void {
    root.traverse((node) => {
      const isMesh = (node as THREE.Mesh).isMesh;
      if (!isMesh) {
        return;
      }
      const mesh = node as THREE.Mesh;
      if (mesh.geometry) {
        mesh.geometry.dispose();
      }
      if (mesh.userData.detailedGeometry && mesh.userData.detailedGeometry !== mesh.geometry) {
        mesh.userData.detailedGeometry.dispose();
      }
      if (mesh.userData.proxyGeometry && mesh.userData.proxyGeometry !== mesh.geometry) {
        mesh.userData.proxyGeometry.dispose();
      }
      const isMaterialArray = Array.isArray(mesh.material);
      if (isMaterialArray) {
        const mats = mesh.material as THREE.Material[];
        for (let i = 0; i < mats.length; i++) {
          mats[i].dispose();
        }
      } else if (mesh.material) {
        (mesh.material as THREE.Material).dispose();
      }
    });
  }

  /**
   * チャンクのポップイン抑制トランジション係数 (0..1) を設定し、オブジェクトのスケール補間を更新する。
   */
  public setWorldChunkTransition(chunkId: WorldChunkId, alpha: number): void {
    const clamped = Math.max(0, Math.min(1, alpha));
    this.chunkTransitionAlphas.set(chunkId, clamped);

    const isUnloaded = this.unloadedChunkIds.has(chunkId);
    if (isUnloaded) {
      return;
    }

    const objects = this.chunkObjectsMap.get(chunkId) ?? [];
    const scaleFactor = 0.86 + 0.14 * clamped;
    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i];
      // Why 道路インフラおよび常時遠景表示される大型構造物に scale.y 補間を適用しないか:
      // 1. 道路グループや交差点パッドの scale.y を変動させると、白線 (y=0.02)・横断歩道 (y=0.025)・交差点パッド (y=0.013) の
      //    相対高さが崩れて Z-fighting による路面全体の白いチラつきを引き起こすため。
      // 2. 大型ビルやランドマークはチャンク有効化前から遠景 LOD2 シルエットとして等倍で描画されているため、
      //    チャンク有効化時に 0.86 倍へ縮めてから伸ばすと不自然な縦方向の伸縮（バウンス）が発生するため。
      const isRoadInfra = Boolean(obj.userData?.isRoadInfrastructure);
      const isLargeStructure = this.isLargeStructureObject(obj);
      if (isRoadInfra || isLargeStructure) {
        continue;
      }
      const baseScaleY = typeof obj.userData.baseScaleY === "number" ? obj.userData.baseScaleY : 1;
      obj.scale.y = baseScaleY * scaleFactor;
    }
  }

  private syncChunkVisibilityState(): void {
    const hasValidLastFocus = !Number.isNaN(this.lastCulledFocusPos.x);
    if (hasValidLastFocus) {
      const prevFocus = this.lastCulledFocusPos.clone();
      this.updateDistanceCulling(prevFocus, 380, true);
      return;
    }

    const isShibuyaGlbActive =
      this.glbShibuyaStreamGroup !== null && !this.unloadedChunkIds.has("shibuya-core");
    this.setShibuyaGlbOverlappingProceduralVisible(!isShibuyaGlbActive);

    for (const def of WORLD_CHUNK_DEFINITIONS) {
      const isUnloaded = this.unloadedChunkIds.has(def.id);
      const objects = this.chunkObjectsMap.get(def.id) ?? [];
      for (let i = 0; i < objects.length; i++) {
        const obj = objects[i];
        const isHiddenProceduralStation =
          obj === this.proceduralStationGroup && this.glbStationGroup !== null && !isUnloaded;
        const isHiddenProceduralShibuya =
          (obj === this.proceduralShibuyaStreamGroup ||
            obj === this.proceduralScrambleSquareGroup ||
            obj === this.proceduralHikarieGroup ||
            obj === this.proceduralSakuraStageGroup ||
            obj === this.proceduralFukurasGroup ||
            obj === this.proceduralMiyashitaParkGroup ||
            obj === this.proceduralQfront109Group) &&
          isShibuyaGlbActive;
        if (isHiddenProceduralStation || isHiddenProceduralShibuya) {
          obj.visible = false;
          continue;
        }
        const isRoadInfra = Boolean(obj.userData?.isRoadInfrastructure);
        if (isRoadInfra) {
          obj.visible = true;
          continue;
        }
        const isLargeStructure = this.isLargeStructureObject(obj);
        if (isLargeStructure) {
          obj.visible = true;
          if (isUnloaded) {
            this.applySubtreeLodTier(obj, "low");
          }
          continue;
        }
        obj.visible = !isUnloaded;
      }
    }
  }

  /**
   * 直近の `updateDistanceCulling` 実行時における距離ベース多段階 LOD（LOD0 / LOD1 / LOD2 / Culled）統計を取得する。
   */
  public getLodStats(): DistanceLodStats {
    return { ...this.lastLodStats };
  }

  private getOrComputeBounds(obj: THREE.Object3D): THREE.Box3 {
    let bounds = this.cullingBoundsCache.get(obj);
    if (!bounds) {
      bounds = new THREE.Box3().setFromObject(obj);
      this.cullingBoundsCache.set(obj, bounds);
    }
    return bounds;
  }

  private computeDistanceToObject(obj: THREE.Object3D, focusPosition: THREE.Vector3): number {
    const bounds = this.getOrComputeBounds(obj);
    const isEmptyBounds = bounds.isEmpty();
    return isEmptyBounds
      ? obj.position.distanceTo(focusPosition)
      : bounds.distanceToPoint(focusPosition);
  }

  private applySubtreeLodTier(root: THREE.Object3D, tier: "high" | "medium" | "low"): number {
    const isTierUnchanged = root.userData.appliedLodTier === tier;
    let simplifiedCount =
      typeof root.userData.lastSimplifiedSubMeshCount === "number"
        ? root.userData.lastSimplifiedSubMeshCount
        : 0;
    if (isTierUnchanged) {
      return simplifiedCount;
    }

    root.userData.appliedLodTier = tier;
    simplifiedCount = 0;
    const isHighTier = tier === "high";
    const isMediumTier = tier === "medium";

    for (let i = 0; i < root.children.length; i++) {
      const subChild = root.children[i];
      const isHiddenByGlb = subChild.userData.permanentlyHiddenByGlb === true;
      if (isHiddenByGlb) {
        subChild.visible = false;
        continue;
      }
      const isGuardrailSlot =
        subChild.userData.isGuardrailSlot === true || subChild.name === "JapaneseGuardrailSlot";
      if (isGuardrailSlot) {
        simplifiedCount += RoadProps.applyGuardrailSlotLod(subChild, tier);
        continue;
      }

      const subDetailTier = subChild.userData.lodDetailTier as "high" | "medium" | undefined;
      if (subDetailTier === "high") {
        subChild.visible = isHighTier;
        if (!isHighTier) {
          simplifiedCount += 1;
          continue;
        }
      } else if (subDetailTier === "medium") {
        const shouldShowMedium = isHighTier || isMediumTier;
        subChild.visible = shouldShowMedium;
        if (!shouldShowMedium) {
          simplifiedCount += 1;
          continue;
        }
      }

      const isMesh = (subChild as THREE.Mesh).isMesh === true;
      if (isMesh) {
        if (subChild.userData.initialCastShadow === undefined) {
          subChild.userData.initialCastShadow = subChild.castShadow;
        }
        const canCastShadow = Boolean(subChild.userData.initialCastShadow);
        subChild.castShadow = canCastShadow && isHighTier;
      }

      const hasNestedChildren = subChild.children.length > 0;
      if (hasNestedChildren) {
        simplifiedCount += this.applySubtreeLodTier(subChild, tier);
      }
    }

    root.userData.lastSimplifiedSubMeshCount = simplifiedCount;
    return simplifiedCount;
  }

  private applyRoadSegmentSubPropsLod(
    roadGroup: THREE.Object3D,
    focusPosition: THREE.Vector3,
    segmentDist: number,
  ): {
    segmentTier: "high" | "medium" | "low";
    simplifiedCount: number;
  } {
    const isFarSegment = segmentDist > 165;
    if (isFarSegment) {
      const simplifiedCount = this.applySubtreeLodTier(roadGroup, "low");
      return { segmentTier: "low", simplifiedCount };
    }

    // 道路セグメント自体が近・中距離（<= 165m）の場合、長尺道路（138m〜500m）上の各プロップ・信号機・ガードレールごとに個別距離判定する
    roadGroup.userData.appliedLodTier = "per-child";
    let simplifiedCount = 0;
    const isNearSegment = segmentDist <= 85;
    const segmentTier: "high" | "medium" | "low" = isNearSegment ? "high" : "medium";

    for (let i = 0; i < roadGroup.children.length; i++) {
      const propChild = roadGroup.children[i];
      if (propChild.userData.permanentlyHiddenByGlb === true) {
        propChild.visible = false;
        continue;
      }
      const isGuardrailSlot =
        propChild.userData.isGuardrailSlot === true || propChild.name === "JapaneseGuardrailSlot";
      if (isGuardrailSlot) {
        const guardTier: "high" | "medium" | "low" =
          segmentDist <= 75 ? "high" : segmentDist <= 150 ? "medium" : "low";
        simplifiedCount += RoadProps.applyGuardrailSlotLod(propChild, guardTier);
        continue;
      }

      const propDetailTier = propChild.userData.lodDetailTier as "high" | "medium" | undefined;
      const isTrafficSignal = propChild.name === "JapaneseTrafficSignalGroup";
      const NeedsPerPropEval = propDetailTier !== undefined || isTrafficSignal;
      if (!NeedsPerPropEval) {
        continue;
      }

      // ローカル座標を道路グループの回転・位置でワールド座標へ変換（高速近似）
      const cosR = Math.cos(roadGroup.rotation.y);
      const sinR = Math.sin(roadGroup.rotation.y);
      const lx = propChild.position.x;
      const lz = propChild.position.z;
      const worldX = roadGroup.position.x + lx * cosR + lz * sinR;
      const worldZ = roadGroup.position.z - lx * sinR + lz * cosR;
      const dx = worldX - focusPosition.x;
      const dz = worldZ - focusPosition.z;
      const propDist = Math.hypot(dx, dz);

      if (propDetailTier === "high") {
        // マンホール・グレーチングは 75m 以内、点字ブロックはセグメント距離 85m 以内のみ表示
        const effectiveDist = lx === 0 && lz === 0 ? segmentDist : propDist;
        const shouldShowHigh = effectiveDist <= 80;
        propChild.visible = shouldShowHigh;
        if (!shouldShowHigh) {
          simplifiedCount += 1;
        }
        continue;
      }

      if (propDetailTier === "medium") {
        // 道路脇の小型規制・警戒標識やデリネーターは 155m 以内のみ表示
        const shouldShowMedium = propDist <= 155;
        propChild.visible = shouldShowMedium;
        if (!shouldShowMedium) {
          simplifiedCount += 1;
        }
        continue;
      }

      if (isTrafficSignal) {
        const signalTier: "high" | "medium" | "low" =
          propDist <= 85 ? "high" : propDist <= 165 ? "medium" : "low";
        simplifiedCount += this.applySubtreeLodTier(propChild, signalTier);
      }
    }

    roadGroup.userData.lastSimplifiedSubMeshCount = simplifiedCount;
    return { segmentTier, simplifiedCount };
  }

  /**
   * 視点または車両座標（focusPosition）からの距離に基づき、遠方の街区・道路セグメント・建築物・街路樹の
   * visible フラグおよび多段階 LOD（LOD0 High / LOD1 Medium / LOD2 Low / Culled）を一括制御する。
   * - Why:
   *   1. 渋谷エリア (x ≈ -750) と東京駅・丸の内エリア (x ≈ 0) は約 750m 離れており、非アクティブエリアをカリングする。
   *   2. 同一エリア内でも遠方（80m〜380m）のモデルについて、高ポリゴン GLB（駅舎・渋谷ストリーム・街路樹・ガードレール）を
   *      軽量なプロシージャル Proxy や幹線メッシュのみに切り替え、PLATEAU ビルのマリオン・スパンドレル・店舗枠や
   *      マンホール・グレーチング・信号機微細部品・遠方シャドウキャストを段階的に省略することで、
   *      近景のミリ単位のディテールを一切損なわずに遠景のドローコールと頂点シェーダー負荷を大幅に削減する。
   */
  public updateDistanceCulling(
    focusPosition: THREE.Vector3,
    maxDrawDistance = 380,
    forceUpdate = false,
  ): number {
    const movedSq = this.lastCulledFocusPos.distanceToSquared(focusPosition);
    const isSameDrawDistance = this.lastCulledMaxDrawDistance === maxDrawDistance;
    const isSmallMovement = !forceUpdate && isSameDrawDistance && movedSq < 25.0;
    if (isSmallMovement) {
      return this.lastLodStats.visibleObjects;
    }
    this.lastCulledFocusPos.copy(focusPosition);
    this.lastCulledMaxDrawDistance = maxDrawDistance;

    let visibleCount = 0;
    let lod0HighCount = 0;
    let lod1MediumCount = 0;
    let lod2LowCount = 0;
    let culledByDistanceCount = 0;
    let simplifiedSubMeshCount = 0;
    let landmarkProxyActiveCount = 0;

    // 1. 大型ランドマーク GLB（東京駅丸の内駅舎・渋谷ストリーム＆渋谷駅複合街区）の距離 LOD 切替（<= 185m: GLB LOD0, > 185m またはチャンク未ロード時: 軽量プロシージャル Proxy）
    const landmarkHighLodDist = Math.min(185, maxDrawDistance * 0.55);
    const largeStructureMaxDist = Math.max(maxDrawDistance * 2.8, 1100);
    const isMarunouchiChunkLoaded = !this.unloadedChunkIds.has("marunouchi-core");
    const isShibuyaChunkLoaded = !this.unloadedChunkIds.has("shibuya-core");

    let stationActiveObject: THREE.Object3D | null = this.proceduralStationGroup;
    let isStationProxyActive = false;
    if (this.proceduralStationGroup !== null) {
      const distStation = this.computeDistanceToObject(this.proceduralStationGroup, focusPosition);
      const useHighGlb =
        this.glbStationGroup !== null &&
        isMarunouchiChunkLoaded &&
        distStation <= landmarkHighLodDist;
      stationActiveObject =
        useHighGlb && this.glbStationGroup ? this.glbStationGroup : this.proceduralStationGroup;
      isStationProxyActive =
        !useHighGlb &&
        distStation <= largeStructureMaxDist &&
        (this.glbStationGroup !== null || !isMarunouchiChunkLoaded);
    }

    let streamActiveObject: THREE.Object3D | null = this.proceduralShibuyaStreamGroup;
    let isStreamProxyActive = false;
    let useHighShibuyaGlb = false;
    if (this.proceduralShibuyaStreamGroup !== null) {
      // Why glbShibuyaStreamGroup がロード済みの場合はその統合バウンディングボックスまでの最短距離を使うか:
      // shibuya_stream.glb には渋谷ストリーム（z=-15）だけでなく首都高3号高架（z=95）・スクランブルスクエア（z=145）・ヒカリエ（z=146）も一体収録されているため、
      // 宮下公園やスクランブル交差点北側（z=240）を走行中に渋谷ストリーム単体からの距離（>185m）だけで判定すると、
      // すぐ目の前（約95m）にあるスクランブルスクエアやヒカリエ・首都高高架まで GLB から Proxy に切り替わってしまうため。
      const distStream =
        this.glbShibuyaStreamGroup !== null
          ? Math.min(
              this.computeDistanceToObject(this.proceduralShibuyaStreamGroup, focusPosition),
              this.computeDistanceToObject(this.glbShibuyaStreamGroup, focusPosition),
            )
          : this.computeDistanceToObject(this.proceduralShibuyaStreamGroup, focusPosition);
      useHighShibuyaGlb =
        this.glbShibuyaStreamGroup !== null &&
        isShibuyaChunkLoaded &&
        distStream <= landmarkHighLodDist;
      streamActiveObject =
        useHighShibuyaGlb && this.glbShibuyaStreamGroup
          ? this.glbShibuyaStreamGroup
          : this.proceduralShibuyaStreamGroup;
      isStreamProxyActive =
        !useHighShibuyaGlb &&
        distStream <= largeStructureMaxDist &&
        (this.glbShibuyaStreamGroup !== null || !isShibuyaChunkLoaded);
    }
    this.setShibuyaGlbOverlappingProceduralVisible(!useHighShibuyaGlb);

    // 2. 街路樹スロット（this.treeSlots）の3段階 LOD 更新（LOD0 <= 85m GLB, LOD1 85..165m 枝付きFallback, LOD2 165..260m 幹+樹冠のみ）
    const processedTreeSlotGroups = new Set<THREE.Object3D>();
    for (let i = 0; i < this.treeSlots.length; i++) {
      const slot = this.treeSlots[i];
      processedTreeSlotGroups.add(slot.slotGroup);
      const isChunkUnloaded = this.unloadedChunkIds.has(slot.chunkId);
      if (isChunkUnloaded) {
        slot.slotGroup.visible = false;
        continue;
      }

      const dist = slot.slotGroup.position.distanceTo(focusPosition);
      const treeMaxDist = Math.min(maxDrawDistance, 260);
      const isTreeCulled = dist > treeMaxDist;
      if (isTreeCulled) {
        slot.slotGroup.visible = false;
        slot.slotGroup.userData.appliedLodTier = "culled";
        culledByDistanceCount += 1;
        continue;
      }

      slot.slotGroup.visible = true;
      visibleCount += 1;
      const treeTier: "high" | "medium" | "low" =
        dist <= 85 ? "high" : dist <= 165 ? "medium" : "low";
      slot.slotGroup.userData.appliedLodTier = treeTier;

      if (treeTier === "high") {
        lod0HighCount += 1;
        if (slot.glbInstance !== null) {
          slot.glbInstance.visible = true;
          slot.fallbackGroup.visible = false;
        } else {
          slot.fallbackGroup.visible = true;
          simplifiedSubMeshCount += this.applySubtreeLodTier(slot.fallbackGroup, "high");
        }
      } else if (treeTier === "medium") {
        lod1MediumCount += 1;
        if (slot.glbInstance !== null) {
          slot.glbInstance.visible = false;
          simplifiedSubMeshCount += 1;
        }
        slot.fallbackGroup.visible = true;
        simplifiedSubMeshCount += this.applySubtreeLodTier(slot.fallbackGroup, "medium");
      } else {
        lod2LowCount += 1;
        if (slot.glbInstance !== null) {
          slot.glbInstance.visible = false;
          simplifiedSubMeshCount += 1;
        }
        slot.fallbackGroup.visible = true;
        simplifiedSubMeshCount += this.applySubtreeLodTier(slot.fallbackGroup, "low");
      }
    }

    // 2b. PLATEAU 渋谷区実測3D建築物群（this.plateauTileMeshes）の多段階距離 LOD カリング
    // 各タイル（宮益坂・道玄坂・センター街・駅東口・青山通り等）ごとに自車からの最短距離を個別に算定し、
    // 近景（<= 135m）: LOD0（高精細メッシュ・LOD2写真テクスチャ・影有効）
    // 中景（135m < dist <= 235m）: LOD1（中距離軽量化・3Dノイズバイパス・テクスチャMipmap・影OFF）
    // 遠景（235m < dist <= 800m）: LOD2（低ポリゴン軽量プロキシ・単一軽量マテリアル・影OFF）
    // 最遠方（> 800m）: Culled（完全非表示）
    // に動的自動遷移させて遠距離の描画負荷やメモリ・シャドウパス消費を徹底抑制する。
    if (this.glbShibuyaPlateauGroup !== null && this.plateauTileMeshes.length > 0) {
      const isShibuyaLoaded = isShibuyaChunkLoaded;
      for (let i = 0; i < this.plateauTileMeshes.length; i++) {
        const tileMesh = this.plateauTileMeshes[i];
        const isChunkNotLoaded = !isShibuyaLoaded;
        if (isChunkNotLoaded) {
          tileMesh.visible = false;
          tileMesh.userData.appliedLodTier = "culled";
          tileMesh.userData.isProxyActive = false;
          if (tileMesh.userData.proxyMesh) {
            tileMesh.userData.proxyMesh.visible = false;
          }
          culledByDistanceCount += 1;
          continue;
        }

        const tileBounds =
          (tileMesh.userData.cullingBounds as THREE.Box3) ?? this.getOrComputeBounds(tileMesh);
        const dist = tileBounds.distanceToPoint(focusPosition);
        const tileMaxDist = Math.min(maxDrawDistance * 2.2, 800);
        const isTileCulled = dist > tileMaxDist;
        if (isTileCulled) {
          tileMesh.visible = false;
          tileMesh.userData.appliedLodTier = "culled";
          tileMesh.userData.isProxyActive = false;
          if (tileMesh.userData.proxyMesh) {
            tileMesh.userData.proxyMesh.visible = false;
          }
          culledByDistanceCount += 1;
          continue;
        }

        tileMesh.visible = true;
        visibleCount += 1;
        const tileTier: "high" | "medium" | "low" =
          dist <= 135 ? "high" : dist <= 235 ? "medium" : "low";
        tileMesh.userData.appliedLodTier = tileTier;

        this.ensurePlateauTileProxy(tileMesh);

        if (tileTier === "high") {
          lod0HighCount += 1;
          tileMesh.castShadow = true;
          if (
            tileMesh.userData.detailedGeometry &&
            tileMesh.geometry !== tileMesh.userData.detailedGeometry
          ) {
            tileMesh.geometry = tileMesh.userData.detailedGeometry;
          }
          if (
            tileMesh.userData.detailedMaterial &&
            tileMesh.material !== tileMesh.userData.detailedMaterial
          ) {
            tileMesh.material = tileMesh.userData.detailedMaterial;
          }
          tileMesh.userData.isProxyActive = false;
          if (tileMesh.userData.proxyMesh) {
            tileMesh.userData.proxyMesh.visible = false;
          }
        } else if (tileTier === "medium") {
          lod1MediumCount += 1;
          tileMesh.castShadow = false;
          if (
            tileMesh.userData.detailedGeometry &&
            tileMesh.geometry !== tileMesh.userData.detailedGeometry
          ) {
            tileMesh.geometry = tileMesh.userData.detailedGeometry;
          }
          if (
            tileMesh.userData.detailedMaterial &&
            tileMesh.material !== tileMesh.userData.detailedMaterial
          ) {
            tileMesh.material = tileMesh.userData.detailedMaterial;
          }
          tileMesh.userData.isProxyActive = false;
          if (tileMesh.userData.proxyMesh) {
            tileMesh.userData.proxyMesh.visible = false;
          }
          simplifiedSubMeshCount += 1;
        } else {
          lod2LowCount += 1;
          tileMesh.castShadow = false;
          if (
            tileMesh.userData.proxyGeometry &&
            tileMesh.geometry !== tileMesh.userData.proxyGeometry
          ) {
            tileMesh.geometry = tileMesh.userData.proxyGeometry;
          }
          if (
            tileMesh.userData.proxyMaterial &&
            tileMesh.material !== tileMesh.userData.proxyMaterial
          ) {
            tileMesh.material = tileMesh.userData.proxyMaterial;
          }
          tileMesh.userData.isProxyActive = true;
          if (tileMesh.userData.proxyMesh) {
            tileMesh.userData.proxyMesh.visible = false;
          }
          simplifiedSubMeshCount += 4;
        }
      }
    }

    // 3. シーングラフ直下の全オブジェクトの距離カリング & 階層的サブメッシュ LOD 制御
    const children = this.group.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (processedTreeSlotGroups.has(child)) {
        continue;
      }
      if (child === this.glbShibuyaPlateauGroup && this.plateauTileMeshes.length > 0) {
        continue;
      }

      const isCityGround = child.name === "CityWideGroundMesh";
      if (isCityGround) {
        child.visible = true;
        visibleCount += 1;
        lod0HighCount += 1;
        continue;
      }

      const isRoadInfra = Boolean(child.userData?.isRoadInfrastructure);
      const isLargeStructure = this.isLargeStructureObject(child);
      const assignedChunkId = this.objectToChunkId.get(child);
      const isAssignedChunkUnloaded = Boolean(
        assignedChunkId && this.unloadedChunkIds.has(assignedChunkId),
      );
      const isChunkUnloaded = Boolean(!isRoadInfra && !isLargeStructure && isAssignedChunkUnloaded);
      if (isChunkUnloaded) {
        child.visible = false;
        continue;
      }

      // 東京駅・渋谷ストリーム（および GLB 内包のスクランブルスクエア・ヒカリエ・サクラステージ・フクラス・MIYASHITA PARK・QFRONT/109）の GLB とプロシージャル Proxy の排他選択
      const isInactiveStationVariant =
        (child === this.proceduralStationGroup || child === this.glbStationGroup) &&
        child !== stationActiveObject;
      const isInactiveStreamVariant =
        (child === this.proceduralShibuyaStreamGroup || child === this.glbShibuyaStreamGroup) &&
        child !== streamActiveObject;
      const isInactiveShibuyaSubLandmark =
        useHighShibuyaGlb &&
        (child === this.proceduralScrambleSquareGroup ||
          child === this.proceduralHikarieGroup ||
          child === this.proceduralSakuraStageGroup ||
          child === this.proceduralFukurasGroup ||
          child === this.proceduralMiyashitaParkGroup ||
          child === this.proceduralQfront109Group);
      if (isInactiveStationVariant || isInactiveStreamVariant || isInactiveShibuyaSubLandmark) {
        child.visible = false;
        continue;
      }

      const dist = this.computeDistanceToObject(child, focusPosition);
      const customMaxDist =
        typeof child.userData?.maxLodDrawDistance === "number"
          ? Math.min(maxDrawDistance, child.userData.maxLodDrawDistance)
          : isLargeStructure
            ? largeStructureMaxDist
            : isRoadInfra
              ? Math.max(maxDrawDistance + 220, 600)
              : maxDrawDistance;
      const isWithinDrawDistance = dist <= customMaxDist;
      child.visible = isWithinDrawDistance;
      if (!isWithinDrawDistance) {
        child.userData.appliedLodTier = "culled";
        culledByDistanceCount += 1;
        continue;
      }

      visibleCount += 1;

      if (
        (child === this.proceduralStationGroup && isStationProxyActive) ||
        (child === this.proceduralShibuyaStreamGroup && isStreamProxyActive)
      ) {
        landmarkProxyActiveCount += 1;
        simplifiedSubMeshCount += 18; // 高精細 GLB サブメッシュ群の省略分
      }

      if (isRoadInfra) {
        const roadLod = this.applyRoadSegmentSubPropsLod(child, focusPosition, dist);
        simplifiedSubMeshCount += roadLod.simplifiedCount;
        if (roadLod.segmentTier === "high") {
          lod0HighCount += 1;
        } else if (roadLod.segmentTier === "medium") {
          lod1MediumCount += 1;
        } else {
          lod2LowCount += 1;
        }
        continue;
      }

      // PLATEAU 建築物・ランドマーク・街灯・ボラード・カスタム標識の3段階 LOD ティア判定
      // Why 未ロードチャンク内の大型構造物は距離にかかわらず "low" (LOD2) 固定とするか:
      // チャンクがまだアクティブ化されていない（または Evict 済みの）遠方エリアのビル群は、
      // 3ボックスの基本シルエット（castShadow=false）のみを描画してドローコールとシャドウ負荷を最小限に抑えるため。
      const isBuilding = Boolean(child.userData?.buildingId) || isLargeStructure;
      const highThreshold = isBuilding ? 135 : 85;
      const mediumThreshold = isBuilding ? 235 : 160;
      const objTier: "high" | "medium" | "low" = isAssignedChunkUnloaded
        ? "low"
        : dist <= highThreshold
          ? "high"
          : dist <= mediumThreshold
            ? "medium"
            : "low";

      simplifiedSubMeshCount += this.applySubtreeLodTier(child, objTier);
      if (objTier === "high") {
        lod0HighCount += 1;
      } else if (objTier === "medium") {
        lod1MediumCount += 1;
      } else {
        lod2LowCount += 1;
      }
    }

    this.lastLodStats = {
      visibleObjects: visibleCount,
      lod0HighCount,
      lod1MediumCount,
      lod2LowCount,
      culledByDistanceCount,
      simplifiedSubMeshCount,
      landmarkProxyActiveCount,
    };

    return visibleCount;
  }
}

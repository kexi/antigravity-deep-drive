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
  public glbTreeTemplate: THREE.Group | null = null;
  public readonly signSystem: RoadSignSystem;

  private roadBuilder: JapaneseRoadBuilder;
  private signPhysicsContext: SignPhysicsContext | null = null;
  private customSignInstances = new Map<string, CreatedRoadSignInstance>();
  private proceduralStationGroup: THREE.Group | null = null;
  private proceduralShibuyaStreamGroup: THREE.Group | null = null;
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
    // 基礎地面（2400m × 2400m）- 国土地理院 地理院タイル DEM5A (5mメッシュ標高) を反映した広域都市地形ベース
    // How: 道路コリドー外周の頂点Y座標に DEM5A の実測標高変位を適用し、車道領域は Rapier コライダーと一致する y=0 を維持する
    const groundGeo = new THREE.PlaneGeometry(2400, 2400, 64, 64);
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

    // 広域地面コライダー（Rapier: 2400m × 2400m, halfExtent = 1200m）
    const groundBodyDesc = rapier.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0);
    const groundBody = world.createRigidBody(groundBodyDesc);
    const groundColliderDesc = rapier.ColliderDesc.cuboid(1200, 0.5, 1200).setFriction(0.9);
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
      | "cast_iron",
  ): void {
    const isAlreadyApplied = Boolean(mat.userData?.hasArch3DVolumeShader);
    if (isAlreadyApplied) {
      return;
    }
    mat.userData = {
      ...mat.userData,
      hasArch3DVolumeShader: true,
      arch3DMode: mode,
    };

    const archVolumeTex = Procedural3DTextureGenerator.getSharedArchitecture3DTexture();
    const propVolumeTex = Procedural3DTextureGenerator.getSharedRoadMarkingProp3DTexture();

    const isRedBrick = mode === "brick" || mode === "red_brick";
    const isWhiteGranite = mode === "granite" || mode === "white_granite";
    const isMoatWall = mode === "moat";
    const isCopperPatina = mode === "copper_patina";
    const isCurtainGlass = mode === "curtain_glass";
    const isAnodizedMetal = mode === "anodized_metal";

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
    }

    // Why 単一のシェーダープログラムと uniform int uArchSurfaceMode 分岐を使うか:
    // モードごとに異なる GLSL 文字列をコンパイルすると、Three.js の複雑な PBR シェーダーが7種類別々にリンクされ、
    // ANGLE Metal バックエンドでのシェーダーコンパイル時間およびコマンドバッファ切り替え負荷が増大するため。
    mat.customProgramCacheKey = () => "arch_3d_tex_unified_v2";
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uArchVolumeTex = { value: archVolumeTex };
      shader.uniforms.uPropVolumeTex = { value: propVolumeTex };
      shader.uniforms.uArchSurfaceMode = { value: modeCode };
      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        varying vec3 vArchWorldPos;
        `,
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <worldpos_vertex>",
        /* glsl */ `
        #include <worldpos_vertex>
        vArchWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        `,
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        uniform sampler3D uArchVolumeTex;
        uniform sampler3D uPropVolumeTex;
        uniform int uArchSurfaceMode;
        varying vec3 vArchWorldPos;
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
        if (archViewDist < 48.0) {
          archVolMacro = texture(uArchVolumeTex, vArchWorldPos * 0.22);
          if (archViewDist < 26.0) {
            archVolMicro = texture(uArchVolumeTex, vArchWorldPos * 0.65);
            propVolSample = texture(uPropVolumeTex, vArchWorldPos * 0.48);
          } else {
            archVolMicro = archVolMacro;
            propVolSample = archVolMacro;
          }
          if (uArchSurfaceMode == 0) {
            float clayGrain = mix(archVolMacro.r, archVolMicro.r, 0.45);
            float mortarJoint = smoothstep(0.62, 0.88, archVolMacro.g);
            vec3 brickTone = diffuseColor.rgb * mix(0.82, 1.16, clayGrain) * mix(0.88, 1.04, archVolMacro.b);
            vec3 mortarColor = vec3(0.76, 0.73, 0.69);
            diffuseColor.rgb = mix(brickTone, mortarColor, mortarJoint * 0.28) * mix(0.90, 1.05, archVolMicro.a);
          } else if (uArchSurfaceMode == 1) {
            float biotiteCrystal = mix(archVolMacro.r, archVolMicro.r, 0.52);
            float stoneJoint = smoothstep(0.66, 0.90, archVolMacro.g);
            diffuseColor.rgb *= mix(0.86, 1.12, biotiteCrystal) * (1.0 - stoneJoint * 0.14) * mix(0.92, 1.04, archVolMacro.b);
          } else if (uArchSurfaceMode == 2) {
            float megalithJoint = smoothstep(0.55, 0.85, archVolMacro.g);
            vec3 stoneShade = diffuseColor.rgb * mix(0.78, 1.15, archVolMicro.r) * (1.0 - megalithJoint * 0.26);
            vec3 dampMossTint = vec3(0.22, 0.29, 0.24);
            diffuseColor.rgb = mix(stoneShade, dampMossTint, smoothstep(0.58, 0.86, archVolMacro.b) * 0.32);
          } else if (uArchSurfaceMode == 3) {
            vec3 verdigrisTint = vec3(0.11, 0.52, 0.46);
            vec3 agedBronzeTint = diffuseColor.rgb * mix(0.84, 1.16, archVolMacro.r * 0.6 + propVolSample.b * 0.4);
            diffuseColor.rgb = mix(agedBronzeTint, verdigrisTint, smoothstep(0.42, 0.78, archVolMacro.b) * 0.35);
          } else if (uArchSurfaceMode == 4) {
            float floorDepthMod = mix(0.88, 1.14, archVolMacro.r * 0.6 + archVolMacro.b * 0.4);
            float coatingShimmer = mix(0.94, 1.08, propVolSample.r);
            diffuseColor.rgb *= floorDepthMod * coatingShimmer;
          } else if (uArchSurfaceMode == 5) {
            diffuseColor.rgb *= mix(0.88, 1.14, propVolSample.b) * mix(0.92, 1.05, archVolMacro.b);
          } else {
            diffuseColor.rgb *= mix(0.84, 1.16, propVolSample.a * 0.65 + propVolSample.b * 0.35) * mix(0.90, 1.06, archVolMacro.b);
          }
        }
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
        "#include <metalnessmap_fragment>",
        /* glsl */ `
        #include <metalnessmap_fragment>
        if (archViewDist < 48.0) {
          roughnessFactor = clamp(roughnessFactor + (archVolMacro.a - 0.5) * 0.14, 0.08, 0.96);
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
      | "cast_iron",
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

      const baseGeo = new THREE.BoxGeometry(b.w, podiumHeight, b.d);
      const baseMat = new THREE.MeshStandardMaterial({
        color: b.podiumColor,
        roughness: 0.52,
        metalness: 0.25,
      });
      this.applyArchitecture3DTexture(baseMat, "white_granite");
      const baseMesh = new THREE.Mesh(baseGeo, baseMat);
      baseMesh.position.y = -b.h / 2 + podiumHeight / 2;
      baseMesh.castShadow = true;
      baseMesh.receiveShadow = true;
      bGroup.add(baseMesh);

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
      this.applyArchitecture3DTexture(towerMat, "curtain_glass");
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

    // 5. Blender 生成 `shibuya_stream.glb` の非同期ロードと 3D テクスチャシェーダー統合
    if (!this.deferGlbLoads) {
      this.glbLoadPromises.push(this.loadGlbShibuyaStreamModel());
    }
  }

  /**
   * `shibuya_stream.glb` 内のマテリアルを解析し、
   * 屋上航空障害灯・イエローアクセント・暖色ロビー窓は固有の発光と色調を保持し、
   * 白アルミ千鳥パネル・溶融亜鉛メッキ鉄骨・コンクリート基壇・壁面緑化・カーテンウォールには WebGL2 3D ボリュームテクスチャを適用する。
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
      const dayIntensity = 0.48;
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

    // 5. 商業フロア・大階段アトリウム・オフィス点灯窓のウォームインテリア発光ガラス
    const isWarmPlazaGlow =
      matName.includes("WarmPlazaGlow") || matName.includes("StreamWarmLobby");
    if (isWarmPlazaGlow) {
      const dayIntensity = 0.72;
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

    // 6. 中層・低層ボイドおよび屋上テラスの垂直壁面緑化（グリーンウォール植栽）
    const isVerticalGreen =
      matName.includes("StreamVerticalGreen") || matName.includes("StreamFoliageGreen");
    if (isVerticalGreen) {
      stdMat.roughness = 0.84;
      stdMat.metalness = 0.02;
      this.applyArchitecture3DTexture(stdMat, "white_granite");
      return;
    }

    // 7. 白アルミカーテンウォールパネル（渋谷ストリーム象徴の白い縦横千鳥ルーバーフィン）
    const isWhiteAluminumFin =
      matName.includes("StreamWhitePanel") || matName.includes("ShibuyaStreamFacade");
    if (isWhiteAluminumFin) {
      stdMat.roughness = 0.24;
      stdMat.metalness = 0.22;
      this.applyArchitecture3DTexture(stdMat, "anodized_metal");
      return;
    }

    // 8. 屋上オープンフレーム＆デッキ梁の溶融亜鉛めっき鋼材（シルバーグレー）
    const isGalvanizedFrame = matName.includes("StreamGalvanizedFrame");
    if (isGalvanizedFrame) {
      stdMat.roughness = 0.36;
      stdMat.metalness = 0.65;
      this.applyArchitecture3DTexture(stdMat, "anodized_metal");
      return;
    }

    // 9. 中層ボイド・低層ピロティ・渋谷川護岸・大階段のダークチャコール鉄骨＆杉板本実コンクリート
    const isDarkVoidSteel =
      matName.includes("StreamDarkVoidSteel") || matName.includes("StreamConcretePodium");
    if (isDarkVoidSteel) {
      stdMat.roughness = 0.48;
      stdMat.metalness = 0.45;
      this.applyArchitecture3DTexture(stdMat, "cast_iron");
      return;
    }

    // 10. 高層 Low-E ブルーグレー反射カーテンウォールガラス
    const isGlassOrWater =
      matName.includes("StreamCurtainGlass") || matName.includes("StreamWaterWall");
    if (isGlassOrWater) {
      stdMat.roughness = 0.12;
      stdMat.metalness = 0.42;
      this.applyArchitecture3DTexture(stdMat, "curtain_glass");
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

          const hasProceduralStream = Boolean(this.proceduralShibuyaStreamGroup);
          if (hasProceduralStream) {
            this.proceduralShibuyaStreamGroup!.visible = false;
          }
          const isShibuyaCoreUnloaded = this.unloadedChunkIds.has("shibuya-core");
          glbModel.visible = !isShibuyaCoreUnloaded;

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

      // 1. 低層基壇部（丸の内31m石積み商業ポディウム + 3D ボリューム御影石テクスチャ）
      const baseGeo = new THREE.BoxGeometry(b.w, podiumHeight, b.d);
      const baseMat = new THREE.MeshStandardMaterial({
        color: b.podiumColor,
        roughness: 0.62,
        metalness: 0.12,
      });
      this.applyArchitecture3DTexture(baseMat, "white_granite");
      const baseMesh = new THREE.Mesh(baseGeo, baseMat);
      baseMesh.position.y = -b.h / 2 + podiumHeight / 2;
      baseMesh.castShadow = true;
      baseMesh.receiveShadow = true;
      bGroup.add(baseMesh);

      // 1b. 低層1F〜2F 商業路面ショーウィンドウ・ロビーガラス＆コロネード（列柱）ディテール
      const storefrontGeo = new THREE.BoxGeometry(b.w * 0.96, 6.5, b.d * 0.96);
      const lobbyGlassMat = new THREE.MeshStandardMaterial({
        color: b.warmInterior,
        emissive: b.warmInterior,
        emissiveIntensity: 0.38,
        roughness: 0.2,
      });
      this.applyArchitecture3DTexture(lobbyGlassMat, "curtain_glass");
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

      // 2. セットバック高層タワー本体（オフィスビル・Low-E ガラスカーテンウォール + 3D微細歪み＆フロア奥行き変調）
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
      this.applyArchitecture3DTexture(glassTowerMat, "curtain_glass");
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
    const isShibuyaCore = chunkId === "shibuya-core";
    const isMarunouchiCore = chunkId === "marunouchi-core";

    if (isShibuyaCore && this.glbShibuyaStreamGroup === null) {
      loadTasks.push(this.loadGlbShibuyaStreamModel());
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

    const isShibuyaCore = chunkId === "shibuya-core";
    if (isShibuyaCore && this.glbShibuyaStreamGroup) {
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
      if (this.proceduralShibuyaStreamGroup) {
        this.proceduralShibuyaStreamGroup.userData.permanentlyHiddenByGlb = false;
      }
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

  private isLargeStructureObject(obj: THREE.Object3D): boolean {
    const isGlbLandmark = obj === this.glbStationGroup || obj === this.glbShibuyaStreamGroup;
    if (isGlbLandmark) {
      return false;
    }
    return Boolean(
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

    for (const def of WORLD_CHUNK_DEFINITIONS) {
      const isUnloaded = this.unloadedChunkIds.has(def.id);
      const objects = this.chunkObjectsMap.get(def.id) ?? [];
      for (let i = 0; i < objects.length; i++) {
        const obj = objects[i];
        const isHiddenProceduralStation =
          obj === this.proceduralStationGroup && this.glbStationGroup !== null && !isUnloaded;
        const isHiddenProceduralStream =
          obj === this.proceduralShibuyaStreamGroup &&
          this.glbShibuyaStreamGroup !== null &&
          !isUnloaded;
        if (isHiddenProceduralStation || isHiddenProceduralStream) {
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
        subChild.castShadow = canCastShadow && (isHighTier || isMediumTier);
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

    // 1. 大型ランドマーク GLB（東京駅丸の内駅舎・渋谷ストリーム）の距離 LOD 切替（<= 185m: GLB LOD0, > 185m またはチャンク未ロード時: 軽量プロシージャル Proxy）
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
    if (this.proceduralShibuyaStreamGroup !== null) {
      const distStream = this.computeDistanceToObject(
        this.proceduralShibuyaStreamGroup,
        focusPosition,
      );
      const useHighGlb =
        this.glbShibuyaStreamGroup !== null &&
        isShibuyaChunkLoaded &&
        distStream <= landmarkHighLodDist;
      streamActiveObject =
        useHighGlb && this.glbShibuyaStreamGroup
          ? this.glbShibuyaStreamGroup
          : this.proceduralShibuyaStreamGroup;
      isStreamProxyActive =
        !useHighGlb &&
        distStream <= largeStructureMaxDist &&
        (this.glbShibuyaStreamGroup !== null || !isShibuyaChunkLoaded);
    }

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

    // 3. シーングラフ直下の全オブジェクトの距離カリング & 階層的サブメッシュ LOD 制御
    const children = this.group.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (processedTreeSlotGroups.has(child)) {
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

      // 東京駅・渋谷ストリームの GLB とプロシージャル Proxy の排他選択
      const isInactiveStationVariant =
        (child === this.proceduralStationGroup || child === this.glbStationGroup) &&
        child !== stationActiveObject;
      const isInactiveStreamVariant =
        (child === this.proceduralShibuyaStreamGroup || child === this.glbShibuyaStreamGroup) &&
        child !== streamActiveObject;
      if (isInactiveStationVariant || isInactiveStreamVariant) {
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

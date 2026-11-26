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
import type { RoadSignPlacement, RoadDefinition } from "../assets/schema";
import { JapaneseRoadMaterial } from "../roads/japaneseRoadMaterial";
import type {
  JapaneseIntersectionConfig,
  JapaneseRoadSegmentConfig,
  RoadExclusionBox,
  RoadExclusionCorridor,
} from "../roads/types";
import { computeRoadCrossSection } from "../roads/roadCrossSection";
import {
  buildRectanglePolygon,
  resolveJunctionTopology,
  type JunctionConnectionArc,
  type JunctionTopology,
  type LaneGraph,
  type LaneGraphEdge,
  type Point2D,
} from "../roads/lanes";
import { logger } from "../core/logger";
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
  sampleShibuyaTerrainY,
  SHIBUYA_PLATEAU_BUILDINGS,
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
  private drivableColliderHandles: number[] = [];
  public plateauBuildingGroups: THREE.Group[] = [];
  public glbStationGroup: THREE.Group | null = null;
  public glbShibuyaStreamGroup: THREE.Group | null = null;
  public glbShibuyaPlateauGroup: THREE.Group | null = null;
  public plateauTileMeshes: THREE.Mesh[] = [];
  public glbTreeTemplate: THREE.Group | null = null;
  public readonly signSystem: RoadSignSystem;

  private roadBuilder: JapaneseRoadBuilder;
  private laneGraph: LaneGraph = {
    version: "1.0.0",
    edges: [],
    junctions: [],
    junctionArcs: [],
  };
  private signPhysicsContext: SignPhysicsContext | null = null;
  private customSignInstances = new Map<string, CreatedRoadSignInstance>();
  private roadOverrides = new Map<string, RoadDefinition>();
  private proceduralStationGroup: THREE.Group | null = null;
  private proceduralShibuyaStreamGroup: THREE.Group | null = null;
  private proceduralScrambleSquareGroup: THREE.Group | null = null;
  private proceduralHikarieGroup: THREE.Group | null = null;
  private proceduralSakuraStageGroup: THREE.Group | null = null;
  private proceduralFukurasGroup: THREE.Group | null = null;
  private proceduralMiyashitaParkGroup: THREE.Group | null = null;
  private proceduralQfront109Group: THREE.Group | null = null;
  private proceduralParcoGroup: THREE.Group | null = null;
  private proceduralCeruleanGroup: THREE.Group | null = null;
  private proceduralMarkCityGroup: THREE.Group | null = null;
  private proceduralCenterGaiArchGroup: THREE.Group | null = null;
  private proceduralHachikoStatueGroup: THREE.Group | null = null;
  private proceduralShutokoCoreMeshes: THREE.Mesh[] = [];
  private proceduralGlbOverlappingColliders: RAPIER.Collider[] = [];
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

  public getDrivableColliderHandles(): ReadonlyArray<number> {
    return this.drivableColliderHandles;
  }

  private registerCollider(col: RAPIER.Collider, isObstacle = true, isDrivable = false): void {
    this.colliders.push(col);
    const hasValidHandle = isObstacle && typeof col?.handle === "number";
    if (hasValidHandle) {
      this.obstacleColliderHandles.push(col.handle);
    }
    if (isDrivable && typeof col?.handle === "number") {
      this.drivableColliderHandles.push(col.handle);
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
      // Why (-709.3, 492.2), yawRadians = -2.324 か:
      // 非鏡像 1:1 座標系 (+X=東, -Z=北) の明治通り（渋谷ストリーム (-750, 527.6) 前: (-678.0, 518.2)→(-737.3, 462.6)）における
      // 左側通行（北西向き）第1車線中央にスポーンさせ、右手前方へ渋谷ヒカリエ・スクランブルスクエア・首都高3号線高架・JRガードを望む。
      const spawnX = -709.3;
      const spawnZ = 492.2;
      const groundY = sampleShibuyaTerrainY(spawnX, spawnZ);
      return {
        area: "shibuya",
        areaLabel: "渋谷 (渋谷ストリーム / 明治通り)",
        position: new THREE.Vector3(spawnX, groundY + 0.62, spawnZ),
        yawRadians: -2.324,
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

  /**
   * 道路・信号アセット内の動的 Light ノードをシーングラフから除外する。
   * Why 信号機 PointLight をシーングラフから削除するか:
   * 道路セグメント・渋谷交差点それぞれの信号機に PointLight が残っていると、
   * visible = false でも Three.js のシーングラフ走査やライト配列収集のオーバーヘッドが発生するため、
   * 信号機の視覚的発光は LED レンズの MeshBasicMaterial のみで表現し、PointLight ノード自体は親から除外する。
   */
  private removeAttachedLights(root: THREE.Object3D): void {
    const lightsToRemove: THREE.Object3D[] = [];
    root.traverse((child) => {
      const isLight = (child as THREE.Light).isLight === true;
      if (isLight) {
        child.visible = false;
        lightsToRemove.push(child);
      }
    });
    for (const lightNode of lightsToRemove) {
      lightNode.removeFromParent();
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
      const terrainDeltaY =
        vx < -395 ? sampleShibuyaTerrainY(vx, vz) - 1.5 : getRelativeTerrainDisplacement(vx, vz);
      posAttr.setY(i, terrainDeltaY);
    }
    groundGeo.computeVertexNormals();

    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x262d38,
      roughness: 0.9,
      metalness: 0.1,
    });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.name = "CityWideGroundMesh";
    groundMesh.position.y = -0.01;
    groundMesh.receiveShadow = true;
    this.group.add(groundMesh);

    // 渋谷全域（x ∈ [-1720, -392], z ∈ [-460, 1140]）連続 3D 起伏地形メッシュ＆Rapier Trimesh 走行コライダー
    // 8m 間隔グリッドで標高差と谷・坂道勾配を連続表現し、x ∈ [-500, -395] のコサインテーパーで丸の内平坦面 (y=0) へ着地させる。
    const terrainXMin = -1720;
    const terrainXMax = -392;
    const terrainZMin = -460;
    const terrainZMax = 1140;
    const terrainStep = 8;
    const terrainCols = Math.floor((terrainXMax - terrainXMin) / terrainStep) + 1;
    const terrainRows = Math.floor((terrainZMax - terrainZMin) / terrainStep) + 1;
    const terrainVertCount = terrainCols * terrainRows;
    const visualTerrainVerts = new Float32Array(terrainVertCount * 3);
    const physicsTerrainVerts = new Float32Array(terrainVertCount * 3);
    const terrainIndices = new Uint32Array((terrainRows - 1) * (terrainCols - 1) * 6);

    for (let r = 0; r < terrainRows; r++) {
      const z = terrainZMin + r * terrainStep;
      for (let c = 0; c < terrainCols; c++) {
        const x = terrainXMin + c * terrainStep;
        const y = sampleShibuyaTerrainY(x, z);
        const idx3 = (r * terrainCols + c) * 3;
        physicsTerrainVerts[idx3] = x;
        physicsTerrainVerts[idx3 + 1] = y;
        physicsTerrainVerts[idx3 + 2] = z;

        visualTerrainVerts[idx3] = x;
        visualTerrainVerts[idx3 + 1] = y - 0.035;
        visualTerrainVerts[idx3 + 2] = z;
      }
    }

    let triCursor = 0;
    for (let r = 0; r < terrainRows - 1; r++) {
      for (let c = 0; c < terrainCols - 1; c++) {
        const i00 = r * terrainCols + c;
        const i10 = i00 + 1;
        const i01 = (r + 1) * terrainCols + c;
        const i11 = i01 + 1;
        // 反時計回り（+Y 上向き法線）
        terrainIndices[triCursor++] = i00;
        terrainIndices[triCursor++] = i01;
        terrainIndices[triCursor++] = i10;
        terrainIndices[triCursor++] = i10;
        terrainIndices[triCursor++] = i01;
        terrainIndices[triCursor++] = i11;
      }
    }

    const shibuyaTerrainGeo = new THREE.BufferGeometry();
    shibuyaTerrainGeo.setAttribute("position", new THREE.BufferAttribute(visualTerrainVerts, 3));
    shibuyaTerrainGeo.setIndex(new THREE.BufferAttribute(terrainIndices, 1));
    shibuyaTerrainGeo.computeVertexNormals();
    const shibuyaTerrainMat = new THREE.MeshStandardMaterial({
      color: 0x6b6a65,
      roughness: 0.9,
      metalness: 0.04,
    });
    this.applyArchitecture3DTexture(shibuyaTerrainMat, "white_granite");
    const shibuyaTerrainMesh = new THREE.Mesh(shibuyaTerrainGeo, shibuyaTerrainMat);
    shibuyaTerrainMesh.name = "ShibuyaTerrainMesh";
    shibuyaTerrainMesh.userData.isRoadInfrastructure = true;
    shibuyaTerrainMesh.receiveShadow = true;
    this.group.add(shibuyaTerrainMesh);

    const shibuyaTerrainBody = world.createRigidBody(
      rapier.RigidBodyDesc.fixed().setTranslation(0, 0, 0),
    );
    const shibuyaTrimeshDesc = rapier.ColliderDesc.trimesh(physicsTerrainVerts, terrainIndices)
      .setFriction(0.9)
      .setRestitution(0.01);
    const shibuyaTerrainCollider = world.createCollider(shibuyaTrimeshDesc, shibuyaTerrainBody);
    this.registerCollider(shibuyaTerrainCollider, false, true);

    // 丸の内・千代田側平坦地面コライダー（x ∈ [-395, +4000] のみカバーし、渋谷側の連続起伏 Trimesh・谷底と干渉しない）
    const groundBody = world.createRigidBody(
      rapier.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0),
    );
    const groundColliderDesc = rapier.ColliderDesc.cuboid(2197.5, 0.5, 4000)
      .setTranslation(1802.5, 0, 0)
      .setFriction(0.9);
    const groundCollider = world.createCollider(groundColliderDesc, groundBody);
    this.registerCollider(groundCollider, false, true);

    // 登録済み直線道路・交差点パッドのメタデータを保持し、交差点隅切り・曲線歩道クリッピングで共有する
    interface StraightRoadRecord {
      cx: number;
      cz: number;
      minX: number;
      maxX: number;
      minZ: number;
      maxZ: number;
      isEastWest: boolean;
      carriagewayWidth: number;
      sidewalkWidth: number;
    }
    interface PendingIntersectionSpec {
      ix: number;
      iz: number;
      widthX: number;
      depthZ: number;
      lanesX: number;
      lanesZ: number;
      hasCrosswalks: boolean;
      hasCenterDiamond?: boolean;
      hasGuideDots?: boolean;
      crosswalkN?: boolean;
      crosswalkS?: boolean;
      crosswalkE?: boolean;
      crosswalkW?: boolean;
      hasCornerSidewalks?: boolean;
    }
    const registeredStraightRoads: StraightRoadRecord[] = [];
    const pendingIntersections: PendingIntersectionSpec[] = [];
    const collectedLaneEdges: LaneGraphEdge[] = [];
    const collectedJunctionTopologies: JunctionTopology[] = [];
    const collectedJunctionArcs: JunctionConnectionArc[] = [];
    let straightRoadCounter = 0;

    // ヘルパー: 道路セグメントを構築しマテリアル・コライダー・空間メタデータを登録する
    const addRoadSegment = (
      config: JapaneseRoadSegmentConfig,
      center: THREE.Vector3,
      rotationY: number,
    ): void => {
      const segRoadId = config.roadId ?? `${config.name ?? "straight"}-${straightRoadCounter++}`;
      const res = this.roadBuilder.buildSegment(
        { ...config, roadId: segRoadId },
        world,
        rapier,
        center,
        rotationY,
      );
      this.removeAttachedLights(res.group);
      res.group.userData.roadName = config.name;
      this.group.add(res.group);
      for (const m of res.materials) {
        if (config.name && !m.userData.roadName) {
          m.userData.roadName = config.name;
        }
      }
      this.roadMaterials.push(...res.materials);
      this.puddleMaterials.push(...res.puddleMaterials);
      this.colliders.push(...res.colliders);
      this.obstacleColliderHandles.push(...res.obstacleColliderHandles);
      collectedLaneEdges.push(...res.laneGraphEdges);

      const cross = computeRoadCrossSection(config);
      const isEastWest = Math.abs(Math.sin(rotationY)) > 0.7;
      const halfSpanX = isEastWest ? config.length * 0.5 : cross.halfDriveable;
      const halfSpanZ = isEastWest ? cross.halfDriveable : config.length * 0.5;
      registeredStraightRoads.push({
        cx: center.x,
        cz: center.z,
        minX: center.x - halfSpanX,
        maxX: center.x + halfSpanX,
        minZ: center.z - halfSpanZ,
        maxZ: center.z + halfSpanZ,
        isEastWest,
        carriagewayWidth: cross.driveableWidth,
        sidewalkWidth: config.sidewalkWidth,
      });
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
      length: 86,
      hasYellowCenterLine: false,
      hasWhiteDashedLines: true,
      hasCrosswalk: true,
      hasGuardrails: false,
      hasManholes: true,
      hasTrafficLights: true,
      speedLimitSign: 40,
    };
    addRoadSegment(kokyoApproachConfig, new THREE.Vector3(0, 0.01, 309), 0);

    // --- B. 丸の内中央通り（z = 5: 大手町 x=-440 〜 東京駅前広場 〜 有楽町 x=+440） ---
    // Why not: 交差する南北幹線（x = -268, 0, +270）および丸の内西通り・東通り（x = -156, +156）を1本の長尺メッシュで重ねると
    // Zファイティングや歩道縁石による車線閉塞が起きるため、5箇所の交差点ごとに6区間へ分割して街区周回走行を可能にする。
    const centralInnerSegments: Array<{ cx: number; len: number; rot: number }> = [
      { cx: -415.5, len: 49, rot: Math.PI / 2 },
      { cx: -325.0, len: 88, rot: Math.PI / 2 },
      { cx: -210.5, len: 89, rot: Math.PI / 2 },
      { cx: -79.5, len: 133, rot: Math.PI / 2 },
      { cx: 79.5, len: 133, rot: -Math.PI / 2 },
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

    // --- D. 日比谷通り（z = 250: 国道1号・都道403号 大手町・和田倉門 〜 馬場先門・日比谷 x=-268..+480） ---
    // Why not cx: -381（x = -480..-282）: 渋谷・宮益坂（x = -560..-400, z = 250..232）と衝突・貫通し、
    // 宮益坂の車道中央にガードレールを生成してしまうため撤去。永代通り（x = -268）以東のみ直線維持。
    const hibiyaSegments: Array<{ cx: number; len: number; rot: number }> = [
      { cx: -210.5, len: 89, rot: Math.PI / 2 },
      { cx: -90.0, len: 112, rot: Math.PI / 2 }, // x=-146 .. -34 (楠公通りアプローチ合流西側まで)
      { cx: 79.5, len: 133, rot: -Math.PI / 2 },
      { cx: 211.5, len: 91, rot: -Math.PI / 2 },
      { cx: 381.5, len: 197, rot: -Math.PI / 2 },
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
      { cx: -437.0, len: 86, rot: Math.PI / 2 },
      { cx: -307.5, len: 53, rot: Math.PI / 2 },
      { cx: 381.5, len: 197, rot: -Math.PI / 2 },
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
          { cz: 49.0, len: 66 }, // z = 16 .. 82（国道246号交差点 z = 95 南側まで）
          { cz: 131.0, len: 46 }, // z = 108 .. 154（国道246号交差点 z = 95 北側から）
          { cz: 205.0, len: 58 }, // z = 176 .. 234
          { cz: 309.0, len: 86 }, // z = 266 .. 352
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
          { cz: 309.0, len: 86 }, // z = 266 .. 352
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
      options?: {
        hasCenterDiamond?: boolean;
        hasGuideDots?: boolean;
        crosswalkN?: boolean;
        crosswalkS?: boolean;
        crosswalkE?: boolean;
        crosswalkW?: boolean;
        hasCornerSidewalks?: boolean;
      },
    ): void => {
      pendingIntersections.push({
        ix,
        iz,
        widthX,
        depthZ,
        lanesX,
        lanesZ,
        hasCrosswalks,
        hasCenterDiamond: options?.hasCenterDiamond,
        hasGuideDots: options?.hasGuideDots,
        crosswalkN: options?.crosswalkN,
        crosswalkS: options?.crosswalkS,
        crosswalkE: options?.crosswalkE,
        crosswalkW: options?.crosswalkW,
        hasCornerSidewalks: options?.hasCornerSidewalks,
      });
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

    // --- I. 渋谷エリア実在幹線道路網: 明治通り（都道305号）渋谷駅前本線および放射状接続 ---
    // Why not addRoadSegment による直線明治通り・東西連絡路:
    // 直線板道路はスポーン直前（z = -49, z = 124）に架空の直角横断歩道・停止線スタンプを自動生成し、
    // 渋谷の景色を「碁盤の目」に見せる最大の幾何学的要因であったため完全廃止。
    // 明治通り渋谷駅前本線（nav-road-meiji-dori）は Section J にて国土地理院オープンデータに基づく
    // 多頂点 Catmull-Rom スプライン曲線道路（buildPolylineSegment: 3車線・白破線・縁石・歩道）として構築する。
    // また東西連絡路（Shibuya-Station-Link-St）も nav-road-shibuya-scramble に完全包含されているため直線生成を廃止。

    // 渋谷スクランブル交差点 (-990.7, 275.8) および宮益坂下交差点 (-818.4, 245.8)
    addIntersectionPadAndMarkings(-990.7, 275.8, 44, 44, 3, 3, false, {
      hasCenterDiamond: false,
      hasGuideDots: false,
      hasCornerSidewalks: false,
    });
    addIntersectionPadAndMarkings(-818.4, 245.8, 32, 24, 3, 2, false, {
      hasCenterDiamond: false,
      hasGuideDots: false,
      hasCornerSidewalks: false,
    });

    // 渋谷スクランブル交差点 象徴の対角線X字型スクランブル横断歩道（斜め横断歩道、3D地形追従）
    const scrambleGroundY = sampleShibuyaTerrainY(-990.7, 275.8);
    const scrambleDiagonalCrosswalks = this.roadBuilder.buildScrambleDiagonalCrosswalks(
      44,
      sampleShibuyaTerrainY,
      -990.7,
      275.8,
      scrambleGroundY,
    );
    scrambleDiagonalCrosswalks.position.set(-990.7, scrambleGroundY + 0.0336, 275.8);
    this.group.add(scrambleDiagonalCrosswalks);

    // 永代通り×国道246号T字交差点（x = -268 × z = 95）フラットアスファルト接続パッド＆路面標示
    addIntersectionPadAndMarkings(-268, 95, 26, 26, 2, 2, true);

    // I-6. 渋谷放射状曲線道路合流点 3D起伏追従アスファルト接続パッド（非鏡像 1:1 座標）
    const shibuyaRadialIntersections = [
      { x: -1440.0, z: 675.0, w: 34, d: 32, lx: 2, lz: 2 }, // 道玄坂上交差点（玉川通り合流）
      { x: -1530.0, z: 705.0, w: 32, d: 30, lx: 2, lz: 2 }, // 神泉町交差点（南平台）
      { x: -1625.0, z: 740.0, w: 34, d: 30, lx: 3, lz: 2 }, // 山手通り・山手神泉交差点
      { x: -1325.0, z: 151.3, w: 30, d: 28, lx: 2, lz: 2 }, // 東急本店前交差点（松濤文化村通り×センター街）
      { x: -1445.0, z: 75.0, w: 28, d: 26, lx: 1, lz: 1 }, // 松濤二丁目交差点
      { x: -981.6, z: 185.0, w: 26, d: 24, lx: 2, lz: 1 }, // 神南一丁目交差点（MODI/公園通り入口）
      { x: -1108.1, z: -43.6, w: 28, d: 26, lx: 2, lz: 1 }, // 渋谷PARCO前交差点（オルガン坂合流）
      { x: -1165.0, z: -120.0, w: 28, d: 26, lx: 2, lz: 1 }, // 勤労福祉会館前交差点（神南二丁目連絡路）
      { x: -1210.0, z: -202.0, w: 30, d: 28, lx: 2, lz: 2 }, // 渋谷区役所・NHK放送センター前交差点
      { x: -1155.0, z: 128.0, w: 26, d: 24, lx: 1, lz: 1 }, // 宇田川町交番前交差点（センター街×オルガン坂）
      { x: -995.0, z: 675.0, w: 26, d: 24, lx: 1, lz: 1 }, // さくら坂上・インフォスタワー前交差点
      { x: -974.8, z: 519.7, w: 32, d: 28, lx: 2, lz: 2 }, // セルリアンタワー前・玉川通り
      { x: -1177.4, z: 600.6, w: 28, d: 26, lx: 2, lz: 1 }, // さくら坂西口・玉川通り合流交差点
      { x: -762.8, z: 435.5, w: 36, d: 32, lx: 3, lz: 2 }, // 渋谷駅東口・明治通り×国道246号×六本木通り
      { x: -501.1, z: 194.8, w: 30, d: 28, lx: 2, lz: 2 }, // 宮益坂上交差点（宮益坂×青山通り）
      { x: -841.2, z: -61.2, w: 30, d: 26, lx: 2, lz: 2 }, // 神宮前・美竹通り北交差点
      { x: -457.3, z: 725.0, w: 30, d: 28, lx: 2, lz: 2 }, // 渋谷橋（明治通り×恵比寿カーブ接続）
    ];
    for (const ri of shibuyaRadialIntersections) {
      addIntersectionPadAndMarkings(ri.x, ri.z, ri.w, ri.d, ri.lx, ri.lz, false, {
        hasCenterDiamond: false,
        hasGuideDots: false,
        hasCornerSidewalks: false,
      });
    }

    // I-6b. SHIBUYA109前Y字路（道玄坂 SW × 文化村通り NW 分岐 (-1159.4, 272.4) 有機的Y字拡幅アスファルト＋三角広場基壇）
    const yForkGroup = new THREE.Group();
    yForkGroup.name = "Intersection_-1159_272";
    yForkGroup.userData.isRoadInfrastructure = true;
    yForkGroup.position.set(0, 0.0155, 0);

    const drapeHorizontalShape = (geom: THREE.BufferGeometry): void => {
      const posAttr = geom.getAttribute("position");
      if (!posAttr) {
        return;
      }
      for (let i = 0; i < posAttr.count; i++) {
        const vx = posAttr.getX(i);
        const vz = posAttr.getZ(i);
        posAttr.setY(i, posAttr.getY(i) + sampleShibuyaTerrainY(vx, vz));
      }
      posAttr.needsUpdate = true;
      geom.computeVertexNormals();
    };

    const yForkShape = new THREE.Shape();
    yForkShape.moveTo(-1148.0, -261.0);
    yForkShape.lineTo(-1182.0, -240.0);
    yForkShape.lineTo(-1192.0, -251.0);
    yForkShape.quadraticCurveTo(-1178.0, -272.4, -1194.0, -294.0);
    yForkShape.lineTo(-1184.0, -305.0);
    yForkShape.lineTo(-1148.0, -284.0);
    yForkShape.closePath();
    const yForkGeo = new THREE.ShapeGeometry(yForkShape, 12);
    yForkGeo.rotateX(-Math.PI / 2);
    drapeHorizontalShape(yForkGeo);
    const yForkMesh = new THREE.Mesh(yForkGeo, intersectionPadMat);
    yForkMesh.name = "Shibuya109YForkAsphalt";
    yForkMesh.userData.isRoadInfrastructure = true;
    yForkMesh.receiveShadow = true;
    yForkGroup.add(yForkMesh);

    const yForkCorePlaneGeo = new THREE.PlaneGeometry(16, 16, 4, 4);
    yForkCorePlaneGeo.rotateX(-Math.PI / 2);
    yForkCorePlaneGeo.translate(-1162.0, -0.0005, 272.4);
    drapeHorizontalShape(yForkCorePlaneGeo);
    const yForkCorePlane = new THREE.Mesh(yForkCorePlaneGeo, intersectionPadMat);
    yForkCorePlane.userData.isRoadInfrastructure = true;
    yForkGroup.add(yForkCorePlane);
    this.group.add(yForkGroup);

    const plaza109IslandShape = new THREE.Shape();
    plaza109IslandShape.moveTo(-1176.0, -272.4);
    plaza109IslandShape.lineTo(-1190.0, -255.0);
    plaza109IslandShape.lineTo(-1226.0, -252.0);
    plaza109IslandShape.lineTo(-1226.0, -293.0);
    plaza109IslandShape.lineTo(-1190.0, -290.0);
    plaza109IslandShape.quadraticCurveTo(-1176.0, -280.0, -1176.0, -272.4);
    const plaza109IslandGeo = new THREE.ShapeGeometry(plaza109IslandShape, 12);
    plaza109IslandGeo.rotateX(-Math.PI / 2);
    drapeHorizontalShape(plaza109IslandGeo);
    const plaza109IslandMat = new THREE.MeshStandardMaterial({
      color: 0xa8a6a0,
      roughness: 0.72,
      metalness: 0.06,
    });
    this.applyArchitecture3DTexture(plaza109IslandMat, "white_granite");
    const plaza109IslandMesh = new THREE.Mesh(plaza109IslandGeo, plaza109IslandMat);
    plaza109IslandMesh.name = "Shibuya109TriangularPlazaApron";
    plaza109IslandMesh.userData.isRoadInfrastructure = true;
    plaza109IslandMesh.position.set(0, 0.022, 0);
    plaza109IslandMesh.receiveShadow = true;
    this.group.add(plaza109IslandMesh);

    const plaza109CurbPts: Array<[number, number]> = [
      [-1218.0, 252.5],
      [-1190.0, 255.0],
      [-1182.5, 263.5],
      [-1176.0, 272.4],
      [-1182.5, 281.5],
      [-1190.0, 290.0],
      [-1218.0, 292.5],
    ];
    const plaza109CurbMat = new THREE.MeshStandardMaterial({
      color: 0xc2bfb8,
      roughness: 0.66,
      metalness: 0.05,
    });
    this.applyArchitecture3DTexture(plaza109CurbMat, "white_granite");
    const plaza109CurbGroup = new THREE.Group();
    plaza109CurbGroup.name = "Shibuya109TriangularPlazaCurb";
    plaza109CurbGroup.userData.isRoadInfrastructure = true;
    for (let ci = 0; ci < plaza109CurbPts.length - 1; ci++) {
      const [ax, az] = plaza109CurbPts[ci];
      const [bx, bz] = plaza109CurbPts[ci + 1];
      const segLen = Math.hypot(bx - ax, bz - az);
      const midX = (ax + bx) * 0.5;
      const midZ = (az + bz) * 0.5;
      const midY = sampleShibuyaTerrainY(midX, midZ);
      const segMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.32, 0.24, segLen + 0.16),
        plaza109CurbMat,
      );
      segMesh.name = `Shibuya109TriangularPlazaCurb_${ci}`;
      segMesh.userData.isRoadInfrastructure = true;
      segMesh.position.set(midX, midY + 0.04, midZ);
      segMesh.rotation.y = Math.atan2(bx - ax, bz - az);
      segMesh.receiveShadow = true;
      plaza109CurbGroup.add(segMesh);
    }
    this.group.add(plaza109CurbGroup);

    // I-7. 渋谷ハチ公前広場インフラ（忠犬ハチ公像・石畳舗装・植栽・ベンチ・照明灯・JR駅前キャノピー）
    this.buildHachikoPlazaInfrastructure(world, rapier, groundBody);

    // I-8. 渋谷センター街（バスケットボール通り）インフラ（歩行者天国タイル舗装・入口アーチ看板・フラッグ・沿道商業テナントビル群）
    this.buildShibuyaCenterGaiInfrastructure(world, rapier, groundBody);

    // I-9. 公園通り北側（西武・マルイ・MODI・神南）＆道玄坂沿道の連続歩道広場・商業ビル街並み補完
    this.buildShibuyaStreetscapeFillInfrastructure(world, rapier, groundBody);

    // --- J. 曲線・屈曲道路区間（Section P で全直線道路・交差点が登録された後に一括構築して片側クリッピングを適用） ---

    // --- K. 10倍広域マップ拡張: 渋谷南北・西側延伸大動脈（原宿・代々木・恵比寿・山手通り・神泉・駒沢通り） ---
    // Why not addRoadSegment による直線グリッド道路:
    // 直線板道路（明治通り北・明治通り南・山手通り・駒沢通り）は直角・平行なグリッド構造を生み出し、
    // 渋谷の景色を「碁盤の目」に見せる根本原因であったため完全撤去。
    // 原宿方面・恵比寿方面・山手通りはすべて Section J の Catmull-Rom スプライン曲線道路
    // （nav-road-meiji-dori-harajuku-curve, nav-road-meiji-dori-ebisu-curve, nav-road-yamate-dori）として構築する。

    // --- L. 10倍広域マップ拡張: 青山・六本木・赤坂大動脈（六本木通り・外苑東通り・青山通り本線） ---
    // 1. 六本木通り（都道412号: z = -350, 六本木ヒルズ〜赤坂アークヒルズ〜日比谷公園）
    // Why not cx: -465（西麻布〜渋谷区間）: 直角東西グリッド道路となるため撤去し、港区側（六本木〜溜池〜日比谷公園）のみ直線維持。
    for (const roppongiSeg of [
      { cx: -280, len: 168 }, // 六本木 x=-364 .. 溜池 x=-196
      { cx: -90, len: 148 }, // 溜池 x=-164 .. 日比谷公園 x=-16
    ]) {
      addRoadSegment(
        {
          name: "Roppongi-dori",
          lanesPerDirection: 3,
          laneWidth: 3.5,
          shoulderWidth: 1.5,
          sidewalkWidth: 4.0,
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
    // Why not addRoadSegment: 明治通り（x = -750）と完全平行に走る直線板道路であり、
    // 渋谷エリアを直角格子状にする主要因であったため撤去。

    // 3. 外苑東通り（x = -380 南北幹線: 六本木〜青山一丁目〜信濃町、z = 98 国道246号・z = 400 六本木通り交差で分割開口）
    for (const gaienEastSeg of [
      { cz: -168.5, len: 331 }, // 六本木東 z=-334 .. 新宿通り南側 z=-3
      { cz: 45.5, len: 65 }, // 新宿通り北側 z=13 .. 国道246号南側 z=78
      { cz: 137.5, len: 39 }, // 国道246号北側 z=118 .. 仲通り延長南側 z=157
      { cz: 203.5, len: 61 }, // 仲通り延長北側 z=173 .. 青山一丁目 z=234
      { cz: 309, len: 86 }, // 青山一丁目 z=266 .. 内堀通り南側 z=352
      { cz: 473.5, len: 121 }, // 六本木通り北側 z=413 .. 信濃町方面 z=534
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
          // Why hasTrafficLights: false:
          // 直線板道路の自動信号機配置は、スプライン道路である国道246号連絡路（nav-road-route246: z=98, x=-371.4）
          // や宮益坂（nav-road-shibuya-miyamasuzaka）の走行車線内に信号柱コライダーを突き刺し
          // 「見えない壁」を発生させるため無効化する。
          hasTrafficLights: false,
          speedLimitSign: 50,
        },
        new THREE.Vector3(-380, 0.011, gaienEastSeg.cz),
        0,
      );
    }
    addIntersectionPadAndMarkings(-380, 98, 28, 40, 2, 2, false, {
      hasCenterDiamond: false,
      hasGuideDots: false,
      hasCornerSidewalks: false,
    });
    addIntersectionPadAndMarkings(-380, 400, 28, 26, 2, 2, false, {
      hasCenterDiamond: false,
      hasGuideDots: false,
      hasCornerSidewalks: false,
    });

    // 4. 青山通り（国道246号）本線東西（z = 250: 青山一丁目〜赤坂見附）
    // Why not cx: -465（表参道区間）: 表参道区間（z = 250, x = -534..-396）は宮益坂・スクランブル（z = 248）と
    // 水平直角グリッドを形成するため撤去。赤坂見附永代通り接続区間のみ直線維持。
    for (const r246Main of [
      { cx: -322.5, len: 83 }, // 青山一丁目 x=-364 .. 赤坂見附永代通り西端 x=-281
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
          hasTrafficLights: false,
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
        sidewalkWidth: 4.0,
        curbHeight: 0.15,
        length: 453,
        hasYellowCenterLine: false,
        hasWhiteDashedLines: true,
        hasCrosswalk: true,
        hasGuardrails: true,
        hasManholes: true,
        hasTrafficLights: true,
        speedLimitSign: 50,
      },
      new THREE.Vector3(-350, 0.011, 607.5),
      0,
    );

    // 2. 皇居北側・内堀通り（千鳥ヶ淵〜北の丸公園〜竹橋: z = 850）
    addRoadSegment(
      {
        name: "Uchibori-dori-North-Takebashi",
        lanesPerDirection: 3,
        laneWidth: 3.5,
        shoulderWidth: 1.5,
        sidewalkWidth: 4.0,
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
    // Why cz: 626, len: 420:
    // 内堀通り皇居外苑カーブ区間（nav-road-uchibori-dori: z=390）との重複を解消し、
    // 端部の制限速度標識（x=13.2, z=387.1）がカーブ車道内に突き刺さる「見えない壁」を防止する。
    addRoadSegment(
      {
        name: "Uchibori-dori-East-Otemon",
        lanesPerDirection: 3,
        laneWidth: 3.5,
        shoulderWidth: 1.5,
        sidewalkWidth: 4.0,
        curbHeight: 0.15,
        length: 418,
        hasYellowCenterLine: false,
        hasWhiteDashedLines: true,
        hasCrosswalk: true,
        hasGuardrails: true,
        hasManholes: true,
        hasTrafficLights: false,
      },
      new THREE.Vector3(0, 0.011, 625),
      0,
    );

    // --- N. 10倍広域マップ拡張: 神田・秋葉原・日本橋（北側大動脈） ---
    // 1. 中央通り北延伸（日本橋〜神田駅前〜万世橋・秋葉原: x = 156）
    // Why split around (156, 379): 内堀通りカーブ区間（z = 379）を跨いで単一長尺セグメントにすると
    // 中央通り歩道ガードレールが内堀通り車道を横断してしまうため、交差点南北で分割する
    for (const chuoNorthSeg of [
      { cz: 316.5, len: 101 }, // 大手町北 z=266 .. 内堀通り交点南 z=367
      { cz: 614.0, len: 446 }, // 内堀通り交点北 z=391 .. 竹橋・秋葉原交差点南端 z=837
    ]) {
      addRoadSegment(
        {
          name: "Chuo-dori-North-Kanda",
          lanesPerDirection: 2,
          laneWidth: 3.5,
          shoulderWidth: 1.2,
          sidewalkWidth: 4.0,
          curbHeight: 0.15,
          length: chuoNorthSeg.len,
          hasYellowCenterLine: false,
          hasWhiteDashedLines: true,
          hasCrosswalk: true,
          hasGuardrails: true,
          hasManholes: true,
          hasTrafficLights: true,
          speedLimitSign: 40,
        },
        new THREE.Vector3(156, 0.011, chuoNorthSeg.cz),
        0,
      );
    }

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
      { cx: 400.5, len: 457 }, // 銀座四丁目 x=172 .. 昭和通り交差点西端 x=629
      { cx: 735.5, len: 129 }, // 昭和通り交差点東端 x=671 .. 勝鬨橋方面 x=800
    ]) {
      addRoadSegment(
        {
          name: "Harumi-dori-Ginza",
          lanesPerDirection: 3,
          laneWidth: 3.5,
          shoulderWidth: 1.5,
          sidewalkWidth: 4.0,
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
          sidewalkWidth: 4.0,
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
      { cx: 400.5, len: 457 }, // 銀座南 x=172 .. 昭和通り交差点西端 x=629
    ]) {
      addRoadSegment(
        {
          name: "Shimbashi-Shiodome-Avenue",
          lanesPerDirection: 3,
          laneWidth: 3.5,
          shoulderWidth: 1.5,
          sidewalkWidth: 4.0,
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
      hasCornerSidewalks?: boolean;
    }> = [
      // 青山・六本木・赤坂（港区側交差点のみ維持）
      { x: -380, z: -350, width: 32, depth: 32, lanesX: 3, lanesZ: 2 }, // 六本木交差点
      { x: -380, z: 5, width: 22, depth: 16, lanesX: 1, lanesZ: 2 }, // 新宿通り・外苑東通り交差点
      { x: -380, z: 165, width: 22, depth: 16, lanesX: 1, lanesZ: 2 }, // 丸の内仲通り延長・外苑東通り交差点
      { x: -380, z: 250, width: 32, depth: 32, lanesX: 3, lanesZ: 2 }, // 青山一丁目交差点
      { x: -380, z: 365, width: 28, depth: 26, lanesX: 2, lanesZ: 2 }, // 四谷・外苑東通り・内堀通り西交差点
      // 皇居周回（三宅坂・半蔵門・竹橋・楠公通り）
      {
        x: -23.5,
        z: 250,
        width: 21,
        depth: 24,
        lanesX: 1,
        lanesZ: 3,
        hasCornerSidewalks: false,
      }, // 楠公通りアプローチ拡幅接続（日比谷通り側開口）
      { x: 156, z: 379, width: 24, depth: 24, lanesX: 2, lanesZ: 2 }, // 内堀通り・中央通り交点
      { x: -350, z: 365, width: 32, depth: 32, lanesX: 3, lanesZ: 2 }, // 三宅坂交差点
      { x: -350, z: 850, width: 32, depth: 32, lanesX: 3, lanesZ: 3 }, // 半蔵門・千鳥ヶ淵交差点
      { x: 0, z: 850, width: 32, depth: 32, lanesX: 3, lanesZ: 3 }, // 竹橋交差点
      // 銀座・数寄屋橋・晴海通り・新橋・汐留
      { x: 0, z: -350, width: 32, depth: 32, lanesX: 3, lanesZ: 3 }, // 数寄屋橋交差点
      { x: 156, z: -350, width: 32, depth: 32, lanesX: 3, lanesZ: 2 }, // 銀座四丁目交差点（世界的大交差点）
      { x: 650, z: -350, width: 42, depth: 32, lanesX: 4, lanesZ: 3 }, // 東銀座・三原橋交差点
      { x: 0, z: -750, width: 32, depth: 32, lanesX: 3, lanesZ: 3 }, // 新橋交差点（SL広場前）
      { x: 650, z: -750, width: 42, depth: 32, lanesX: 4, lanesZ: 3 }, // 汐留交差点
      // 昭和通り（鍛冶橋・永代）
      { x: 650, z: 5, width: 42, depth: 26, lanesX: 4, lanesZ: 2 },
      { x: 650, z: 250, width: 42, depth: 32, lanesX: 4, lanesZ: 3 },
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
        { hasCornerSidewalks: expInt.hasCornerSidewalks },
      );
    }

    // --- J(再配置). 国土地理院 & PLATEAU 曲線・屈曲道路区間（全直線・交差点登録後に片側別クリッピング付きで構築） ---
    const curvedRoadCorridors = getOpenDataCurvedRoadCorridors();
    const resolveCorridorCrossParams = (curvedCorridor: (typeof curvedRoadCorridors)[number]) => {
      const id = curvedCorridor.id;
      const isScrambleLink = id === "nav-road-shibuya-scramble";
      const isCenterGai = id === "nav-road-shibuya-center-gai";
      const isHikarieAccess = id === "nav-road-shibuya-hikarie-access";
      const isInokashiraOrgan = id === "nav-road-shibuya-inokashira-organ";
      const isSakurazakaLoop = id === "nav-road-shibuya-sakurazaka-loop";
      const lanesPerDir =
        curvedCorridor.widthMeters >= 20.0
          ? 3
          : Math.max(1, Math.min(3, Math.round(curvedCorridor.widthMeters / 8.5)));
      const laneWidth = isHikarieAccess ? 2.9 : 3.4;
      const shoulderWidth = isHikarieAccess ? 0.5 : 1.2;

      let medianWidth = 0;
      if (
        id === "nav-road-meiji-dori" ||
        id === "nav-road-meiji-dori-ebisu-curve" ||
        id === "nav-road-meiji-dori-harajuku-curve" ||
        id === "nav-road-yamate-dori"
      ) {
        medianWidth = 1.4;
      } else if (id === "nav-road-shibuya-tamagawa-west" || id === "nav-road-uchibori-dori") {
        medianWidth = 1.2;
      } else if (id === "nav-road-route246" || id === "nav-road-shibuya-roppongi-dori") {
        medianWidth = 1.0;
      }

      const isDoubleYellowCenter = id === "nav-road-shibuya-miyamasuzaka";
      const halfWidth = lanesPerDir * laneWidth + shoulderWidth + medianWidth * 0.5;
      const sidewalkWidth = isCenterGai
        ? 0
        : isInokashiraOrgan
          ? 2.2
          : isSakurazakaLoop || isHikarieAccess
            ? 2.0
            : id === "nav-road-meiji-dori"
              ? 5.0
              : 3.2;

      return {
        lanesPerDir,
        laneWidth,
        shoulderWidth,
        medianWidth,
        halfWidth,
        sidewalkWidth,
        isDoubleYellowCenter,
        isScrambleLink,
        isCenterGai,
        isHikarieAccess,
        isInokashiraOrgan,
        isSakurazakaLoop,
      };
    };

    const corridorDescriptors = curvedRoadCorridors.map((c) => {
      const spec = resolveCorridorCrossParams(c);
      const pts = c.points.map((p) => new THREE.Vector3(p.x, 0, p.z));
      const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal", 0.5);
      const totalLen = Math.max(1, curve.getLength());
      const steps = Math.max(40, Math.ceil(totalLen / 2.0));
      const sampledPoints: Array<{ x: number; z: number; tx: number; tz: number }> = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const p = curve.getPointAt(t);
        const tan = curve.getTangentAt(t);
        sampledPoints.push({ x: p.x, z: p.z, tx: tan.x, tz: tan.z });
      }
      return {
        id: c.id,
        corridor: c,
        spec,
        samples: sampledPoints,
        exclusionCorridor: {
          id: c.id,
          sampledPoints,
          halfWidth: spec.halfWidth,
        } satisfies RoadExclusionCorridor,
      };
    });

    const sidewalkExclusionBoxes: RoadExclusionBox[] = [
      ...pendingIntersections.map((p) => ({
        minX: p.ix - p.widthX * 0.5,
        maxX: p.ix + p.widthX * 0.5,
        minZ: p.iz - p.depthZ * 0.5,
        maxZ: p.iz + p.depthZ * 0.5,
      })),
      ...registeredStraightRoads.map((r) => ({
        minX: r.minX,
        maxX: r.maxX,
        minZ: r.minZ,
        maxZ: r.maxZ,
      })),
    ];

    // 全交差点の境界ポリゴンを事前生成し、すべての曲線道路標示が交差点内部へ侵入しないよう自動クリッピングする
    const junctionBoundaryPolygons: ReadonlyArray<ReadonlyArray<Point2D>> = [
      ...pendingIntersections.map((p) => buildRectanglePolygon(p.ix, p.iz, p.widthX, p.depthZ)),
      buildRectanglePolygon(-1159.4, 272.4, 24, 24), // SHIBUYA109前 Y字路コア
    ];

    for (let corridorIdx = 0; corridorIdx < corridorDescriptors.length; corridorIdx++) {
      const desc = corridorDescriptors[corridorIdx];
      const curvedCorridor = desc.corridor;
      const spec = desc.spec;
      const corridorBaseY = 0.011 + corridorIdx * 0.00012;
      const isShibuyaCorridor = curvedCorridor.points.some((p) => p.x < -395);
      const isDogenzaka = curvedCorridor.id === "nav-road-shibuya-dogenzaka";
      const isArterialCategory = curvedCorridor.category !== "local_street";

      let medianExclusionZones: Array<{ x: number; z: number; radius: number }> | undefined;
      let startTrimMeters: number | undefined;
      let endTrimMeters: number | undefined;
      let skipStartCrosswalk = false;
      const skipEndCrosswalk = false;

      if (curvedCorridor.id === "nav-road-meiji-dori") {
        medianExclusionZones = [{ x: -762.8, z: 435.5, radius: 24 }];
        startTrimMeters = 18.0;
        skipStartCrosswalk = true;
      } else if (curvedCorridor.id === "nav-road-meiji-dori-ebisu-curve") {
        startTrimMeters = 0.0;
        skipStartCrosswalk = true;
        medianExclusionZones = [{ x: -457.3, z: 725.0, radius: 18 }];
      } else if (curvedCorridor.id === "nav-road-meiji-dori-harajuku-curve") {
        startTrimMeters = 20.0;
        medianExclusionZones = [{ x: -841.2, z: -61.2, radius: 18 }];
      } else if (curvedCorridor.id === "nav-road-yamate-dori") {
        medianExclusionZones = [{ x: -1625.0, z: 740.0, radius: 26 }];
      } else if (curvedCorridor.id === "nav-road-shibuya-scramble") {
        startTrimMeters = 18.0;
        endTrimMeters = 18.0;
        medianExclusionZones = [
          { x: -1159.4, z: 272.4, radius: 18 },
          { x: -990.7, z: 275.8, radius: 24 },
          { x: -818.4, z: 245.8, radius: 18 },
        ];
      } else if (curvedCorridor.id === "nav-road-shibuya-tamagawa-west") {
        startTrimMeters = 18.0;
        medianExclusionZones = [
          { x: -762.8, z: 435.5, radius: 24 },
          { x: -974.8, z: 519.7, radius: 15 },
          { x: -1177.4, z: 600.6, radius: 15 },
          { x: -1440.0, z: 675.0, radius: 24 },
          { x: -1530.0, z: 705.0, radius: 16 },
          { x: -1625.0, z: 740.0, radius: 24 },
        ];
      } else if (curvedCorridor.id === "nav-road-route246") {
        startTrimMeters = 18.0;
        medianExclusionZones = [
          { x: -762.8, z: 435.5, radius: 24 },
          { x: -672.0, z: 413.0, radius: 10 },
          { x: -501.1, z: 194.8, radius: 20 },
          { x: -380.0, z: 98.0, radius: 22 },
        ];
      } else if (curvedCorridor.id === "nav-road-shibuya-roppongi-dori") {
        startTrimMeters = 42.0;
        endTrimMeters = 18.0;
        medianExclusionZones = [
          { x: -762.8, z: 435.5, radius: 42 },
          { x: -380.0, z: 400.0, radius: 20 },
        ];
      } else if (curvedCorridor.id === "nav-road-shibuya-miyamasuzaka") {
        startTrimMeters = 18.0;
        endTrimMeters = 18.0;
        medianExclusionZones = [
          { x: -818.4, z: 245.8, radius: 20 },
          { x: -715.0, z: 229.0, radius: 12 },
          { x: -501.1, z: 194.8, radius: 20 },
        ];
      } else if (isDogenzaka) {
        startTrimMeters = 10.0;
        medianExclusionZones = [
          { x: -1159.4, z: 272.4, radius: 14 },
          { x: -1440.0, z: 675.0, radius: 24 },
        ];
      } else if (curvedCorridor.id === "nav-road-shibuya-shinsen-nakadori") {
        medianExclusionZones = [
          { x: -1440.0, z: 675.0, radius: 22 },
          { x: -1445.0, z: 75.0, radius: 16 },
        ];
      } else if (curvedCorridor.id === "nav-road-shibuya-koen-dori") {
        startTrimMeters = 16.0;
        skipStartCrosswalk = true;
        medianExclusionZones = [
          { x: -990.7, z: 275.8, radius: 24 },
          { x: -981.6, z: 185.0, radius: 14 },
          { x: -1108.1, z: -43.6, radius: 16 },
          { x: -1165.0, z: -120.0, radius: 15 },
        ];
      } else if (curvedCorridor.id === "nav-road-shibuya-jinnan-cross") {
        medianExclusionZones = [
          { x: -841.2, z: -61.2, radius: 18 },
          { x: -1165.0, z: -120.0, radius: 16 },
        ];
      } else if (curvedCorridor.id === "nav-road-shibuya-bunkamura-dori") {
        startTrimMeters = 10.0;
        medianExclusionZones = [
          { x: -1159.4, z: 272.4, radius: 14 },
          { x: -1325.0, z: 151.3, radius: 18 },
          { x: -1445.0, z: 75.0, radius: 16 },
        ];
      } else if (spec.isCenterGai) {
        startTrimMeters = 8.0;
        endTrimMeters = 15.0;
        medianExclusionZones = [
          { x: -1155.0, z: 128.0, radius: 15 },
          { x: -1325.0, z: 151.3, radius: 18 },
        ];
      } else if (spec.isInokashiraOrgan) {
        startTrimMeters = 11.0;
        endTrimMeters = 18.0;
        medianExclusionZones = [
          { x: -1155.0, z: 128.0, radius: 14 },
          { x: -1108.1, z: -43.6, radius: 16 },
        ];
      } else if (spec.isSakurazakaLoop) {
        medianExclusionZones = [
          { x: -974.8, z: 519.7, radius: 20 },
          { x: -1177.4, z: 600.6, radius: 20 },
        ];
        endTrimMeters = 18.0;
      } else if (spec.isHikarieAccess) {
        startTrimMeters = 10.0;
        endTrimMeters = 14.0;
        medianExclusionZones = [{ x: -672.0, z: 413.0, radius: 14 }];
      } else if (curvedCorridor.id === "nav-road-uchibori-dori") {
        medianExclusionZones = [{ x: 156, z: 379, radius: 14 }];
      }

      const isTamagawaWest = curvedCorridor.id === "nav-road-shibuya-tamagawa-west";
      const markingExclusionZones: Array<{ x: number; z: number; radius: number }> = isTamagawaWest
        ? [
            { x: -762.8, z: 435.5, radius: 22 },
            { x: -974.8, z: 519.7, radius: 8 },
            { x: -1177.4, z: 600.6, radius: 8 },
            { x: -1440.0, z: 675.0, radius: 22 },
            { x: -1625.0, z: 740.0, radius: 22 },
          ]
        : [
            ...(medianExclusionZones ?? []),
            { x: -990.7, z: 275.8, radius: 26 },
            { x: -818.4, z: 245.8, radius: 18 },
            { x: -762.8, z: 435.5, radius: 20 },
          ];

      // 明治通り本線 (-457.3, 725.0) と恵比寿カーブは直列接続のため相互除外から外す
      const sidewalkExclusionCorridors = corridorDescriptors
        .filter((other) => {
          if (other.id === curvedCorridor.id) {
            return false;
          }
          const isMeijiEbisuHeadJoin =
            (curvedCorridor.id === "nav-road-meiji-dori" &&
              other.id === "nav-road-meiji-dori-ebisu-curve") ||
            (curvedCorridor.id === "nav-road-meiji-dori-ebisu-curve" &&
              other.id === "nav-road-meiji-dori");
          return !isMeijiEbisuHeadJoin;
        })
        .map((other) => other.exclusionCorridor);

      const sidewalkExclusionZones: Array<{ x: number; z: number; radius: number }> = [
        { x: -1159.4, z: 272.4, radius: 14 }, // SHIBUYA109前 Y字路
        ...(curvedCorridor.id === "nav-road-shibuya-koen-dori" ||
        curvedCorridor.id === "nav-road-shibuya-bunkamura-dori" ||
        isDogenzaka ||
        spec.isScrambleLink
          ? [{ x: -990.7, z: 275.8, radius: 23 }]
          : []),
      ];

      const polyRes = this.roadBuilder.buildPolylineSegment(
        {
          roadId: curvedCorridor.id,
          name: curvedCorridor.displayName,
          lanesPerDirection: spec.lanesPerDir,
          laneWidth: spec.laneWidth,
          shoulderWidth: spec.shoulderWidth,
          medianWidth: spec.medianWidth,
          medianExclusionZones,
          markingExclusionZones,
          junctionPolygons: junctionBoundaryPolygons,
          sidewalkExclusionCorridors,
          sidewalkExclusionBoxes,
          sidewalkExclusionZones,
          startTrimMeters,
          endTrimMeters,
          skipStartCrosswalk,
          skipEndCrosswalk,
          sidewalkWidth: spec.sidewalkWidth,
          sidewalkPavingStyle:
            curvedCorridor.id === "nav-road-uchibori-dori" ? "granite_slab" : "interlocking_brick",
          curbHeight: 0.15,
          length: 120,
          elevationSampler: isShibuyaCorridor ? sampleShibuyaTerrainY : undefined,
          skipRoadCollider: isShibuyaCorridor,
          hasDoubleYellowCenterLine: spec.isDoubleYellowCenter,
          hasCenterLine: !spec.isCenterGai,
          hasShoulderLines: !spec.isCenterGai,
          hasStopLines: !spec.isScrambleLink && !spec.isCenterGai,
          hasYellowCenterLine: spec.lanesPerDir === 1 && isArterialCategory && !spec.isScrambleLink,
          hasWhiteDashedLines: spec.lanesPerDir >= 2,
          hasCrosswalk: isArterialCategory && !spec.isScrambleLink && !spec.isCenterGai,
          hasGuardrails:
            isArterialCategory &&
            !spec.isScrambleLink &&
            !spec.isCenterGai &&
            curvedCorridor.id !== "nav-road-shibuya-tamagawa-west",
          hasManholes: !spec.isScrambleLink && !spec.isCenterGai,
          hasTrafficLights: false,
          speedLimitSign:
            curvedCorridor.id.includes("meiji-dori") ||
            curvedCorridor.id === "nav-road-route246" ||
            curvedCorridor.id === "nav-road-shibuya-tamagawa-west" ||
            curvedCorridor.id === "nav-road-yamate-dori" ||
            curvedCorridor.category === "national_highway"
              ? 50
              : 40,
          points: curvedCorridor.points,
        },
        curvedCorridor.points,
        world,
        rapier,
        corridorBaseY,
      );
      this.removeAttachedLights(polyRes.group);
      polyRes.group.userData.roadName = curvedCorridor.displayName;
      for (const m of polyRes.materials) {
        if (!m.userData.roadName) {
          m.userData.roadName = curvedCorridor.displayName;
        }
      }
      this.group.add(polyRes.group);
      this.roadMaterials.push(...polyRes.materials);
      this.puddleMaterials.push(...polyRes.puddleMaterials);
      this.colliders.push(...polyRes.colliders);
      this.obstacleColliderHandles.push(...polyRes.obstacleColliderHandles);
      collectedLaneEdges.push(...polyRes.laneGraphEdges);
    }

    const curvedTopologyInputs = corridorDescriptors.map((desc) => ({
      id: desc.id,
      samples: desc.samples,
      carriagewayWidth: desc.spec.halfWidth * 2,
      lanesPerDirection: desc.spec.lanesPerDir,
      laneWidth: desc.spec.laneWidth,
      medianWidth: desc.spec.medianWidth,
      hasStopText:
        desc.spec.isHikarieAccess || desc.spec.isSakurazakaLoop || desc.spec.isInokashiraOrgan,
    }));

    // --- Q. 予約済み全交差点の自動アーム解決＆統一構築（隅切り R 歩道・T字路閉鎖辺連続歩道・安全コライダー） ---
    for (const spec of pendingIntersections) {
      const halfW = spec.widthX * 0.5;
      const halfD = spec.depthZ * 0.5;
      const arms: NonNullable<JapaneseIntersectionConfig["arms"]> = {};

      // 1. 直線道路との接続判定
      for (const r of registeredStraightRoads) {
        const armSidewalkSpec = {
          carriagewayWidth: r.carriagewayWidth,
          sidewalkLeft: r.sidewalkWidth,
          sidewalkRight: r.sidewalkWidth,
        };
        if (!r.isEastWest && Math.abs(r.cx - spec.ix) <= halfW * 0.65) {
          const isNorthConn = Math.abs(r.minZ - (spec.iz + halfD)) <= 4.0;
          if (isNorthConn) {
            arms.north = armSidewalkSpec;
          }
          const isSouthConn = Math.abs(r.maxZ - (spec.iz - halfD)) <= 4.0;
          if (isSouthConn) {
            arms.south = armSidewalkSpec;
          }
        } else if (r.isEastWest && Math.abs(r.cz - spec.iz) <= halfD * 0.65) {
          const isEastConn = Math.abs(r.minX - (spec.ix + halfW)) <= 4.0;
          if (isEastConn) {
            arms.east = armSidewalkSpec;
          }
          const isWestConn = Math.abs(r.maxX - (spec.ix - halfW)) <= 4.0;
          if (isWestConn) {
            arms.west = armSidewalkSpec;
          }
        }
      }

      // 2. 曲線道路コリドーの通過・端点接続を補完
      for (const desc of corridorDescriptors) {
        const cw = desc.spec.halfWidth * 2;
        const sw = desc.spec.sidewalkWidth;
        const curvedArmSpec = { carriagewayWidth: cw, sidewalkLeft: sw, sidewalkRight: sw };
        const nTol = Math.max(halfW * 0.75, desc.spec.halfWidth + 2.5);
        const eTol = Math.max(halfD * 0.75, desc.spec.halfWidth + 2.5);

        for (const s of desc.samples) {
          if (!arms.north && Math.abs(s.tx) < Math.abs(s.tz) * 1.4) {
            if (Math.hypot(s.x - spec.ix, s.z - (spec.iz + halfD)) <= nTol) {
              arms.north = curvedArmSpec;
            }
          }
          if (!arms.south && Math.abs(s.tx) < Math.abs(s.tz) * 1.4) {
            if (Math.hypot(s.x - spec.ix, s.z - (spec.iz - halfD)) <= nTol) {
              arms.south = curvedArmSpec;
            }
          }
          if (!arms.east && Math.abs(s.tz) < Math.abs(s.tx) * 1.4) {
            if (Math.hypot(s.x - (spec.ix + halfW), s.z - spec.iz) <= eTol) {
              arms.east = curvedArmSpec;
            }
          }
          if (!arms.west && Math.abs(s.tz) < Math.abs(s.tx) * 1.4) {
            if (Math.hypot(s.x - (spec.ix - halfW), s.z - spec.iz) <= eTol) {
              arms.west = curvedArmSpec;
            }
          }
        }
      }

      // 3. 隣接交差点パッドとの直接辺接触を補完（例: 日比谷通り・楠公アプローチ西辺）
      for (const other of pendingIntersections) {
        if (other === spec) {
          continue;
        }
        const oHalfW = other.widthX * 0.5;
        const oHalfD = other.depthZ * 0.5;
        if (Math.abs(other.iz - spec.iz) <= 4.0) {
          const ewCarry = other.lanesZ >= 3 ? 24 : Math.min(other.depthZ - 4, 20);
          if (!arms.east && Math.abs(spec.ix + halfW - (other.ix - oHalfW)) <= 1.5) {
            arms.east = { carriagewayWidth: ewCarry, sidewalkLeft: 4.0, sidewalkRight: 4.0 };
          }
          if (!arms.west && Math.abs(spec.ix - halfW - (other.ix + oHalfW)) <= 1.5) {
            arms.west = { carriagewayWidth: ewCarry, sidewalkLeft: 4.0, sidewalkRight: 4.0 };
          }
        }
        if (Math.abs(other.ix - spec.ix) <= 4.0) {
          const nsCarry = other.lanesX >= 3 ? 24 : Math.min(other.widthX - 4, 20);
          if (!arms.north && Math.abs(spec.iz + halfD - (other.iz - oHalfD)) <= 1.5) {
            arms.north = { carriagewayWidth: nsCarry, sidewalkLeft: 4.0, sidewalkRight: 4.0 };
          }
          if (!arms.south && Math.abs(spec.iz - halfD - (other.iz + oHalfD)) <= 1.5) {
            arms.south = { carriagewayWidth: nsCarry, sidewalkLeft: 4.0, sidewalkRight: 4.0 };
          }
        }
      }

      const armCount = [arms.north, arms.south, arms.east, arms.west].filter(Boolean).length;
      const shouldBuildCorners = spec.hasCornerSidewalks ?? armCount >= 2;
      const isShibuyaIntersection = spec.ix < -395;
      const isScrambleIntersection = Math.hypot(spec.ix - -990.7, spec.iz - 275.8) < 2.0;
      const junctionId = `Intersection_${spec.ix}_${spec.iz}`;
      const junctionTopology = resolveJunctionTopology({
        id: junctionId,
        name: junctionId,
        x: spec.ix,
        z: spec.iz,
        widthX: spec.widthX,
        depthZ: spec.depthZ,
        lanesX: spec.lanesX,
        lanesZ: spec.lanesZ,
        isScramble: isScrambleIntersection,
        hasCrosswalks: spec.hasCrosswalks,
        hasCenterDiamond: spec.hasCenterDiamond,
        hasGuideDots: spec.hasGuideDots,
        crosswalkN: spec.crosswalkN ?? (armCount > 0 ? Boolean(arms.north) : true),
        crosswalkS: spec.crosswalkS ?? (armCount > 0 ? Boolean(arms.south) : true),
        crosswalkE: spec.crosswalkE ?? (armCount > 0 ? Boolean(arms.east) : true),
        crosswalkW: spec.crosswalkW ?? (armCount > 0 ? Boolean(arms.west) : true),
        straightRoads: registeredStraightRoads,
        curvedCorridors: curvedTopologyInputs,
      });

      const interRes = this.roadBuilder.buildIntersection(
        {
          x: spec.ix,
          z: spec.iz,
          widthX: spec.widthX,
          depthZ: spec.depthZ,
          baseY: isShibuyaIntersection ? 0.0155 : 0.0115,
          lanesX: spec.lanesX,
          lanesZ: spec.lanesZ,
          hasCrosswalks: spec.hasCrosswalks,
          hasCenterDiamond: spec.hasCenterDiamond,
          hasGuideDots: spec.hasGuideDots,
          isScramble: isScrambleIntersection,
          junctionTopology,
          crosswalkN: spec.crosswalkN,
          crosswalkS: spec.crosswalkS,
          crosswalkE: spec.crosswalkE,
          crosswalkW: spec.crosswalkW,
          arms: armCount > 0 ? arms : undefined,
          hasCornerSidewalks: shouldBuildCorners,
          sidewalkPavingStyle: "granite_slab",
          elevationSampler: isShibuyaIntersection ? sampleShibuyaTerrainY : undefined,
          skipRoadCollider: isShibuyaIntersection,
        },
        world,
        rapier,
        groundBody,
        intersectionPadMat,
      );
      this.group.add(interRes.group);
      this.puddleMaterials.push(...interRes.puddleMaterials);
      this.colliders.push(...interRes.colliders);
      this.obstacleColliderHandles.push(...interRes.obstacleColliderHandles);
      collectedJunctionTopologies.push(interRes.junctionTopology);
      collectedJunctionArcs.push(...interRes.junctionArcs);
    }

    this.laneGraph = {
      version: "1.0.0",
      edges: collectedLaneEdges,
      junctions: collectedJunctionTopologies,
      junctionArcs: collectedJunctionArcs,
    };
    logger.info("roads", "lane_graph.built", "統一車線グラフを構築", {
      edgeCount: collectedLaneEdges.length,
      junctionCount: collectedJunctionTopologies.length,
      junctionArcCount: collectedJunctionArcs.length,
    });
  }

  /**
   * 統一車線システムが生成した都市全体の構造化車線グラフ（LaneGraph）を取得する
   */
  public getLaneGraph(): LaneGraph {
    return this.laneGraph;
  }

  /**
   * 都市内の全交差点トポロジー一覧を取得する
   */
  public getJunctionTopologies(): ReadonlyArray<JunctionTopology> {
    return this.laneGraph.junctions;
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

        #ifdef USE_MAP
        // 実写テクスチャ（PLATEAU LOD2建築、看板、電子ビジョン、道路標識等）が存在する場合は、
        // プロシージャル色帯や泥色緑ノイズでの上書きを行わず、テクスチャ本来のクリーンな建築色彩を100%保持。
        // 遠距離（LOD2: archViewDist >= 160.0）ではMipmapサンプリングのみで3Dノイズ演算を完全スキップし、
        // 近距離でも高周波3Dグレインノイズを排した極微細な大域明暗のみでモアレ・ノイズを防止する
        if (archViewDist < 160.0 && (uArchSurfaceMode == 1 || uArchSurfaceMode == 3)) {
          diffuseColor.rgb *= mix(0.97, 1.02, archVolMacro.r);
        }
        #else
        // テクスチャ無しプロシージャル壁面への環境映り込み（街路樹の緑・路面の照り返し）
        if (archViewDist < 135.0 && isFacadeWall) {
          float treeReflectionFactor = smoothstep(1.5, 4.5, vArchWorldPos.y) * (1.0 - smoothstep(8.5, 15.0, vArchWorldPos.y));
          float groundReflectionFactor = 1.0 - smoothstep(0.0, 3.2, vArchWorldPos.y);
          vec3 treeFoliageReflection = vec3(0.12, 0.26, 0.14) * (0.8 + 0.4 * archVolMacro.g);
          vec3 groundWarmReflection = vec3(0.24, 0.22, 0.20) * (0.85 + 0.3 * archVolMacro.r);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb + treeFoliageReflection, treeReflectionFactor * 0.28);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb + groundWarmReflection, groundReflectionFactor * 0.22);
        }
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
    const streamCenterX = -750.0;
    const streamCenterZ = 527.6;
    const streamGroundY = sampleShibuyaTerrainY(streamCenterX, streamCenterZ);

    // 1. プロシージャル初期フォールバック（GLB非同期ロード前やヘッドレス単体テスト用）
    const fallbackStreamGroup = new THREE.Group();
    fallbackStreamGroup.name = "ShibuyaStreamProceduralFallback";
    fallbackStreamGroup.position.set(streamCenterX, streamGroundY, streamCenterZ);
    fallbackStreamGroup.rotation.y = Math.PI * 0.25;
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

    const fallbackStreamTex = shibuyaTextureManager.getTexture("stream");
    const streamGlassMat = new THREE.MeshPhysicalMaterial({
      color: 0xcbd5e1,
      map: fallbackStreamTex,
      emissive: new THREE.Color(0xe2e8f0),
      emissiveMap: fallbackStreamTex,
      emissiveIntensity: this.isNightActive ? 0.85 : 0.1,
      roughness: 0.16,
      metalness: 0.68,
      reflectivity: 0.92,
      clearcoat: 0.82,
    });
    this.shibuyaStreamEmissiveEntries.push({
      material: streamGlassMat,
      dayIntensity: 0.1,
      nightIntensity: 0.85,
    });
    this.applyArchitecture3DTexture(streamGlassMat, "curtain_glass");

    // 低層ポディウム（1F〜3F 商業・大階段・広場フレーム。rotation.y = -Math.PI/2 によりローカル +Z がワールド -X 明治通り正面を向く）
    const fallbackPodiumTex = shibuyaTextureManager.getTexture("commercialFacade");
    const fallbackPodiumMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      map: fallbackPodiumTex,
      emissive: new THREE.Color(0xfff4db),
      emissiveMap: fallbackPodiumTex,
      emissiveIntensity: this.isNightActive ? 0.95 : 0.15,
      roughness: 0.42,
      metalness: 0.25,
    });
    this.shibuyaStreamEmissiveEntries.push({
      material: fallbackPodiumMat,
      dayIntensity: 0.15,
      nightIntensity: 0.95,
    });
    this.applyArchitecture3DTexture(fallbackPodiumMat, "retail_storefront");
    const podiumMesh = new THREE.Mesh(new THREE.BoxGeometry(58, 18, 42), fallbackPodiumMat);
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

    // 渋谷ストリーム本体・大階段・広場案内モニュメントの Rapier 物理コライダー（3D地形接地）
    const streamBody = world.createRigidBody(
      rapier.RigidBodyDesc.fixed().setTranslation(streamCenterX, streamGroundY + 90, streamCenterZ),
    );
    const streamCol = rapier.ColliderDesc.cuboid(21, 90, 27.5).setFriction(0.5).setRestitution(0.1);
    const streamColInstance = world.createCollider(streamCol, streamBody);
    this.registerCollider(streamColInstance, true);
    this.proceduralGlbOverlappingColliders.push(streamColInstance);

    const streamFoundationSkirt = new THREE.Mesh(
      new THREE.BoxGeometry(59.0, 4.0, 43.0),
      darkFrameMat,
    );
    streamFoundationSkirt.position.set(0, -2.0, 6);
    fallbackStreamGroup.add(streamFoundationSkirt);

    // 稲荷橋広場の大階段（渋谷川側東プロムナード接点）
    const grandStairsCol = rapier.ColliderDesc.cuboid(6.9, 7.25, 5.3)
      .setTranslation(20.0, -82.75, -18.0)
      .setFriction(0.6)
      .setRestitution(0.05);
    const grandStairsColInstance = world.createCollider(grandStairsCol, streamBody);
    this.registerCollider(grandStairsColInstance, true);
    this.proceduralGlbOverlappingColliders.push(grandStairsColInstance);

    // 稲荷橋広場の案内モニュメントサイン
    const monolithSignCol = rapier.ColliderDesc.cuboid(0.8, 2.1, 4.4)
      .setTranslation(24.0, -87.9, -4.0)
      .setFriction(0.5)
      .setRestitution(0.1);
    const monolithSignColInstance = world.createCollider(monolithSignCol, streamBody);
    this.registerCollider(monolithSignColInstance, true);
    this.proceduralGlbOverlappingColliders.push(monolithSignColInstance);

    // 2. 稲荷橋広場（Inaribashi Plaza）石畳＆大階段前プロムナード（渋谷ストリームと明治通りの間）
    const inaribashiPlazaMat = new PuddleMaterial({
      baseColor: 0x8f8d87,
      baseRoughness: 0.68,
      baseMetalness: 0.1,
      puddleThreshold: 0.44,
    });
    this.puddleMaterials.push(inaribashiPlazaMat);
    const inaribashiCenterX = -727.5;
    const inaribashiCenterZ = 510.0;
    const inaribashiGeo = new THREE.PlaneGeometry(18, 52, 4, 8);
    inaribashiGeo.rotateX(-Math.PI / 2);
    inaribashiGeo.rotateY(0.82);
    const inaribashiPosAttr = inaribashiGeo.getAttribute("position");
    for (let i = 0; i < inaribashiPosAttr.count; i++) {
      const lx = inaribashiPosAttr.getX(i);
      const lz = inaribashiPosAttr.getZ(i);
      const gy = sampleShibuyaTerrainY(inaribashiCenterX + lx, inaribashiCenterZ + lz);
      inaribashiPosAttr.setY(i, inaribashiPosAttr.getY(i) + (gy - streamGroundY));
    }
    inaribashiPosAttr.needsUpdate = true;
    inaribashiGeo.computeVertexNormals();
    const inaribashiMesh = new THREE.Mesh(inaribashiGeo, inaribashiPlazaMat);
    inaribashiMesh.name = "ShibuyaInaribashiPlaza";
    inaribashiMesh.position.set(inaribashiCenterX, streamGroundY + 0.015, inaribashiCenterZ);
    inaribashiMesh.userData.isLargeStructure = true;
    inaribashiMesh.receiveShadow = true;
    this.group.add(inaribashiMesh);

    // 3. 渋谷川（Shibuya River）曲線清流復活水路＆親水護岸（渋谷ストリーム東側 -> 並木橋・渋谷橋南東方向）
    const riverChannelWidth = 7.6;
    const riverSpline = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(-720.0, 0, 522.0),
        new THREE.Vector3(-675.0, 0, 566.0),
        new THREE.Vector3(-598.0, 0, 644.0),
        new THREE.Vector3(-522.0, 0, 738.0),
        new THREE.Vector3(-476.0, 0, 868.0),
      ],
      false,
      "centripetal",
      0.5,
    );
    const riverRefPt = riverSpline.getPointAt(0);
    const riverRefY = 0;

    const buildRiverChannelGeometry = (
      halfW: number,
      yOffset: number,
      segs: number,
    ): THREE.BufferGeometry => {
      const positions = new Float32Array((segs + 1) * 2 * 3);
      const uvs = new Float32Array((segs + 1) * 2 * 2);
      const indices: number[] = [];
      let arcLen = 0;
      let prevPt = riverSpline.getPointAt(0);
      for (let i = 0; i <= segs; i++) {
        const u = i / segs;
        const p = riverSpline.getPointAt(u);
        if (i > 0) {
          arcLen += p.distanceTo(prevPt);
          prevPt = p;
        }
        const t = riverSpline.getTangentAt(u).normalize();
        const nX = t.z;
        const nZ = -t.x;
        const lx = p.x - nX * halfW;
        const lz = p.z - nZ * halfW;
        const rx = p.x + nX * halfW;
        const rz = p.z + nZ * halfW;
        const ly = sampleShibuyaTerrainY(lx, lz) - riverRefY + yOffset;
        const ry = sampleShibuyaTerrainY(rx, rz) - riverRefY + yOffset;
        const vIdx = i * 6;
        positions[vIdx] = lx - riverRefPt.x;
        positions[vIdx + 1] = ly;
        positions[vIdx + 2] = lz - riverRefPt.z;
        positions[vIdx + 3] = rx - riverRefPt.x;
        positions[vIdx + 4] = ry;
        positions[vIdx + 5] = rz - riverRefPt.z;
        const uvIdx = i * 4;
        uvs[uvIdx] = 0;
        uvs[uvIdx + 1] = arcLen * 0.1;
        uvs[uvIdx + 2] = 1;
        uvs[uvIdx + 3] = arcLen * 0.1;
        if (i < segs) {
          const a = i * 2;
          const b = a + 1;
          const c = a + 2;
          const d = a + 3;
          indices.push(a, c, b, b, c, d);
        }
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geom.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
      geom.setIndex(indices);
      geom.computeVertexNormals();
      return geom;
    };

    const riverBedGeo = buildRiverChannelGeometry(riverChannelWidth * 0.5 + 0.2, -0.02, 48);
    const riverBedMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.88,
      metalness: 0.08,
    });
    this.applyArchitecture3DTexture(riverBedMat, "moat");
    const riverBedMesh = new THREE.Mesh(riverBedGeo, riverBedMat);
    riverBedMesh.name = "ShibuyaRiverBed";
    riverBedMesh.position.set(riverRefPt.x, 0.04, riverRefPt.z);
    riverBedMesh.userData.isLargeStructure = true;
    riverBedMesh.receiveShadow = true;
    this.group.add(riverBedMesh);

    const riverWaterGeo = buildRiverChannelGeometry(riverChannelWidth * 0.5, -0.02, 64);
    const riverWaterMat = new WaterSurfaceMaterial({
      shallowColor: 0x0ea5e9,
      deepColor: 0x082f49,
      waveSpeed: 1.35,
      waveHeight: 0.12,
    });
    this.waterMaterials.push(riverWaterMat);
    const riverWaterMesh = new THREE.Mesh(riverWaterGeo, riverWaterMat);
    riverWaterMesh.name = "13113-wtr-shibuya-river";
    riverWaterMesh.position.set(riverRefPt.x, 0.18, riverRefPt.z);
    riverWaterMesh.userData.isLargeStructure = true;
    this.group.add(riverWaterMesh);

    // 渋谷川の両岸コンクリート護岸パラペット（ニュートラルコンクリート・地形追従セグメント）
    const riverWallMat = new THREE.MeshStandardMaterial({
      color: 0x989690,
      roughness: 0.78,
      metalness: 0.08,
    });
    this.applyArchitecture3DTexture(riverWallMat, "white_granite");
    const riverWallCount = 16;
    const riverTotalLen = riverSpline.getLength();
    const wallChordLen = riverTotalLen / riverWallCount;
    for (let wi = 0; wi < riverWallCount; wi++) {
      const uMid = (wi + 0.5) / riverWallCount;
      const midPt = riverSpline.getPointAt(uMid);
      const tan = riverSpline.getTangentAt(uMid).normalize();
      const yaw = Math.atan2(tan.x, tan.z);
      const wallGeo = new THREE.BoxGeometry(0.65, 1.4, wallChordLen + 0.6);
      for (const sideSign of [-1, 1]) {
        const latOff = sideSign * (riverChannelWidth * 0.5 + 0.32);
        const wx = midPt.x + tan.z * latOff;
        const wz = midPt.z - tan.x * latOff;
        const wy = sampleShibuyaTerrainY(wx, wz);
        const wallMesh = new THREE.Mesh(wallGeo, riverWallMat);
        wallMesh.position.set(wx, wy + 0.3, wz);
        wallMesh.rotation.y = yaw;
        wallMesh.userData.isLargeStructure = true;
        wallMesh.castShadow = true;
        wallMesh.receiveShadow = true;
        this.group.add(wallMesh);

        const wallBody = world.createRigidBody(
          rapier.RigidBodyDesc.fixed()
            .setTranslation(wx, wy + 0.3, wz)
            .setRotation({ x: 0, y: Math.sin(yaw * 0.5), z: 0, w: Math.cos(yaw * 0.5) }),
        );
        const wallCol = rapier.ColliderDesc.cuboid(0.35, 0.7, wallChordLen * 0.5).setFriction(0.5);
        this.registerCollider(world.createCollider(wallCol, wallBody), true);
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
      const bTerrainY = sampleShibuyaTerrainY(b.x, b.z);
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
        isChiyodaOtemachiOverlap: b.buildingId.startsWith("13101-") && b.x < -280,
      };
      bGroup.position.set(b.x, bTerrainY + b.h / 2, b.z);

      const podiumHeight = Math.min(b.podiumHeight, b.h * 0.45);
      const crownHeight = Math.min(10, Math.max(5, b.h * 0.07));
      const towerHeight = Math.max(12, b.h - podiumHeight - crownHeight);

      // 1. 低層ポディウム（基壇部 + 傾斜地密着スカート -3.5m）
      const storefrontHeight = Math.min(7.5, podiumHeight * 0.48);

      const baseGeo = new THREE.BoxGeometry(b.w, podiumHeight, b.d);
      const shibuyaBaseTex = shibuyaTextureManager.getTexture("plateauLod2Storefront").clone();
      shibuyaBaseTex.needsUpdate = true;
      shibuyaBaseTex.repeat.set(
        Math.max(1, Math.round(b.w / 14)),
        Math.max(1, Math.round(podiumHeight / 14)),
      );
      const baseMat = new THREE.MeshStandardMaterial({
        color: b.podiumColor,
        map: shibuyaBaseTex,
        emissive: new THREE.Color(0xfff4db),
        emissiveMap: shibuyaBaseTex,
        emissiveIntensity: this.isNightActive ? 0.65 : 0.08,
        roughness: 0.48,
        metalness: 0.22,
      });
      this.shibuyaStreamEmissiveEntries.push({
        material: baseMat,
        dayIntensity: 0.08,
        nightIntensity: 0.65,
      });
      this.applyArchitecture3DTexture(baseMat, "white_granite");
      const baseMesh = new THREE.Mesh(baseGeo, baseMat);
      baseMesh.position.y = -b.h / 2 + podiumHeight / 2;
      baseMesh.castShadow = true;
      baseMesh.receiveShadow = true;
      bGroup.add(baseMesh);

      const skirtMesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, 3.5, b.d), baseMat);
      skirtMesh.position.y = -b.h / 2 - 1.75;
      skirtMesh.receiveShadow = true;
      bGroup.add(skirtMesh);

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
      const isCustomTexLandmark = b.buildingId === "13113-bldg-scramble-square";
      const shibuyaTowerTexBase = isCustomTexLandmark
        ? null
        : shibuyaTextureManager.getTexture(
            towerTextureMode === "stone_punched" ? "plateauLod2Storefront" : "plateauLod2Facade",
          );
      const shibuyaTowerTex = shibuyaTowerTexBase ? shibuyaTowerTexBase.clone() : null;
      if (shibuyaTowerTex) {
        shibuyaTowerTex.needsUpdate = true;
        shibuyaTowerTex.repeat.set(
          Math.max(1, Math.round(towerW / 14)),
          Math.max(1, Math.round(towerHeight / 14)),
        );
      }
      const towerMat = new THREE.MeshPhysicalMaterial({
        color: b.color,
        map: shibuyaTowerTex ?? undefined,
        emissive: shibuyaTowerTex ? new THREE.Color(0xe2e8f0) : new THREE.Color(0x000000),
        emissiveMap: shibuyaTowerTex ?? undefined,
        emissiveIntensity: shibuyaTowerTex ? (this.isNightActive ? 0.8 : 0.08) : 0,
        metalness: 0.72,
        roughness: 0.18,
        reflectivity: 0.9,
        clearcoat: 0.75,
      });
      if (shibuyaTowerTex) {
        this.shibuyaStreamEmissiveEntries.push({
          material: towerMat,
          dayIntensity: 0.08,
          nightIntensity: 0.8,
        });
      }
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
      const isParco = b.buildingId === "13113-bldg-shibuya-parco";
      const isMarkCity = b.buildingId === "13113-bldg-shibuya-mark-city";

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
        // 渋谷ヒカリエ: 中層11F〜16Fに浮かぶ球体・円筒劇場「東急シアターオーブ (Tokyu Theatre Orb)」＆スカイロビー＋2Fアーバンコア
        const orbMat = new THREE.MeshStandardMaterial({
          color: 0xf59e0b,
          emissive: 0xd97706,
          emissiveIntensity: this.isNightActive ? 1.35 : 0.0,
          roughness: 0.22,
          metalness: 0.48,
        });
        this.shibuyaStreamEmissiveEntries.push({
          material: orbMat,
          dayIntensity: 0.0,
          nightIntensity: 1.35,
        });
        this.applyArchitecture3DTexture(orbMat, "anodized_metal");

        const theatreOrbMesh = new THREE.Mesh(
          new THREE.CylinderGeometry(20.5, 20.5, 24.0, 24),
          orbMat,
        );
        theatreOrbMesh.name = "HikarieTokyuTheatreOrb";
        theatreOrbMesh.position.set(-4.5, -b.h / 2 + podiumHeight + 18.0, -3.5);
        bGroup.add(theatreOrbMesh);

        const skyLobbyDeckMat = new THREE.MeshStandardMaterial({
          color: 0x93c5fd,
          emissive: 0x38bdf8,
          emissiveIntensity: this.isNightActive ? 1.25 : 0.15,
          roughness: 0.18,
          metalness: 0.35,
        });
        this.shibuyaStreamEmissiveEntries.push({
          material: skyLobbyDeckMat,
          dayIntensity: 0.15,
          nightIntensity: 1.25,
        });
        const skyLobbyDeck = new THREE.Mesh(
          new THREE.BoxGeometry(b.w + 3.0, 3.2, b.d + 3.0),
          skyLobbyDeckMat,
        );
        skyLobbyDeck.name = "HikarieSkyLobbyDeck";
        skyLobbyDeck.position.set(-2.0, -b.h / 2 + podiumHeight + 4.0, 0);
        bGroup.add(skyLobbyDeck);

        const urbanCoreEntrance = new THREE.Mesh(
          new THREE.BoxGeometry(8.0, 8.0, 14.0),
          new THREE.MeshStandardMaterial({
            color: 0x1e293b,
            roughness: 0.25,
            metalness: 0.5,
          }),
        );
        urbanCoreEntrance.name = "HikarieUrbanCoreEntrance";
        urbanCoreEntrance.position.set(-b.w * 0.42, -b.h / 2 + 5.0, 0);
        bGroup.add(urbanCoreEntrance);
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
      } else if (isParco) {
        // 渋谷PARCO: 立体街路スパイラル階段テラス（1F〜10F屋外回廊）＆屋上グリーンパーク＋店舗ファサード
        const terraceMat = new THREE.MeshStandardMaterial({
          color: 0xf8fafc,
          roughness: 0.4,
          metalness: 0.2,
        });
        const spiralGroup = new THREE.Group();
        spiralGroup.name = "ShibuyaParcoSpiralWalkway";
        const terraceStepCount = 8;
        for (let t = 0; t < terraceStepCount; t++) {
          const tRatio = t / terraceStepCount;
          const ty = -b.h / 2 + podiumHeight * 0.4 + tRatio * (b.h * 0.45);
          const angle = tRatio * Math.PI * 1.5;
          const tx = Math.cos(angle) * (b.w * 0.52);
          const tz = Math.sin(angle) * (b.d * 0.52);
          const stepMesh = new THREE.Mesh(new THREE.BoxGeometry(6.5, 1.8, 6.5), terraceMat);
          stepMesh.position.set(tx, ty, tz);
          stepMesh.userData.lodDetailTier = "medium";
          spiralGroup.add(stepMesh);
        }
        bGroup.add(spiralGroup);

        const parcoRoofPark = new THREE.Mesh(
          new THREE.BoxGeometry(b.w * 0.75, 1.6, b.d * 0.75),
          new THREE.MeshStandardMaterial({
            color: 0x16a34a,
            roughness: 0.82,
            metalness: 0.05,
          }),
        );
        parcoRoofPark.name = "ParcoRooftopPark";
        parcoRoofPark.position.y = -b.h / 2 + podiumHeight + (b.h - podiumHeight) * 0.65;
        bGroup.add(parcoRoofPark);

        const parcoStorefrontMat = new THREE.MeshStandardMaterial({
          map: shibuyaTextureManager.getTexture("commercialFacade"),
          emissive: new THREE.Color(0xffffff),
          emissiveMap: shibuyaTextureManager.getTexture("commercialFacade"),
          emissiveIntensity: this.isNightActive ? 1.35 : 0.25,
          roughness: 0.35,
          metalness: 0.2,
        });
        this.shibuyaStreamEmissiveEntries.push({
          material: parcoStorefrontMat,
          dayIntensity: 0.25,
          nightIntensity: 1.35,
        });
        const parcoStorefront = new THREE.Mesh(
          new THREE.BoxGeometry(b.w + 0.8, storefrontHeight * 1.4, b.d + 0.8),
          parcoStorefrontMat,
        );
        parcoStorefront.position.y = -b.h / 2 + (storefrontHeight * 1.4) / 2;
        bGroup.add(parcoStorefront);
      } else if (isCerulean) {
        // セルリアンタワー: 三角形セットバック冠部＆屋上ヘリポート＋東急ホテルエントランスキャノピー
        const ceruleanHelipadMat = new THREE.MeshStandardMaterial({
          color: 0x047857,
          emissive: 0x065f46,
          emissiveIntensity: this.isNightActive ? 0.65 : 0.15,
          roughness: 0.45,
          metalness: 0.15,
        });
        this.shibuyaStreamEmissiveEntries.push({
          material: ceruleanHelipadMat,
          dayIntensity: 0.15,
          nightIntensity: 0.65,
        });
        const helipad = new THREE.Mesh(new THREE.BoxGeometry(16, 0.6, 16), ceruleanHelipadMat);
        helipad.name = "CeruleanTowerRooftopHelipad";
        helipad.position.y = b.h / 2 + 0.3;
        bGroup.add(helipad);

        const hotelCanopy = new THREE.Mesh(
          new THREE.BoxGeometry(b.w * 0.6, 1.4, 12.0),
          new THREE.MeshStandardMaterial({
            color: 0x1e293b,
            metalness: 0.85,
            roughness: 0.2,
          }),
        );
        hotelCanopy.name = "CeruleanHotelPodiumLobby";
        hotelCanopy.position.set(0, -b.h / 2 + 6.0, b.d * 0.5 + 4.0);
        bGroup.add(hotelCanopy);
      } else if (isMarkCity) {
        // 渋谷マークシティ: 京王井の頭線渋谷駅・空中連絡コンコース
        const concourseMat = new THREE.MeshStandardMaterial({
          map: shibuyaTextureManager.getTexture("markCity"),
          emissive: new THREE.Color(0xffffff),
          emissiveMap: shibuyaTextureManager.getTexture("markCity"),
          emissiveIntensity: this.isNightActive ? 1.25 : 0.15,
          roughness: 0.25,
          metalness: 0.35,
        });
        this.shibuyaStreamEmissiveEntries.push({
          material: concourseMat,
          dayIntensity: 0.15,
          nightIntensity: 1.25,
        });
        const concourseMesh = new THREE.Mesh(
          new THREE.BoxGeometry(b.w + 4.0, 14.0, b.d * 0.6),
          concourseMat,
        );
        concourseMesh.name = "MarkCitySkyConcourse";
        concourseMesh.position.set(0, -b.h / 2 + podiumHeight * 0.65, 0);
        bGroup.add(concourseMesh);
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
      } else if (isParco) {
        this.proceduralParcoGroup = bGroup;
      } else if (isCerulean) {
        this.proceduralCeruleanGroup = bGroup;
      } else if (isMarkCity) {
        this.proceduralMarkCityGroup = bGroup;
      }
      this.group.add(bGroup);
      this.plateauBuildingGroups.push(bGroup);

      const bBody = world.createRigidBody(
        rapier.RigidBodyDesc.fixed().setTranslation(b.x, bTerrainY + b.h / 2, b.z),
      );
      const bCol = rapier.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2)
        .setFriction(0.5)
        .setRestitution(0.1);
      const bColInstance = world.createCollider(bCol, bBody);
      this.registerCollider(bColInstance, true);

      const isOverlappingGlbBuilding =
        isScrambleSquare ||
        isHikarie ||
        isSakuraStage ||
        isFukuras ||
        isMiyashitaPark ||
        isQfront109 ||
        isParco ||
        isCerulean ||
        isMarkCity;
      if (isOverlappingGlbBuilding) {
        this.proceduralGlbOverlappingColliders.push(bColInstance);
      }
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
   * 任意の 3D 曲線サンプル列に沿って横断面を押し出したボックスリボンジオメトリを生成する。
   * How: 各サンプル点の XZ 接線に直交する水平右方向ベクトル `right` を使い、Frenet ツイストなしで
   * 上下面・左右側面・始終端キャップの 4 面閉鎖ジオメトリを構築する。
   */
  private buildCurvedBoxRibbonGeometry(
    samples: ReadonlyArray<{ pos: THREE.Vector3; right: THREE.Vector3; arcLen: number }>,
    width: number,
    yBottomOffset: number,
    yTopOffset: number,
    uvScale = 12,
  ): THREE.BufferGeometry {
    const halfW = width * 0.5;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    // 1 セグメントあたり 4 面（上・下・右・左）をフラット/スムーズ法線分離で構築する
    const addQuadFace = (
      p0: THREE.Vector3,
      p1: THREE.Vector3,
      p2: THREE.Vector3,
      p3: THREE.Vector3,
      nx: number,
      ny: number,
      nz: number,
      u0: number,
      u1: number,
      vWidth: number,
    ): void => {
      const base = positions.length / 3;
      positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z);
      for (let k = 0; k < 4; k++) {
        normals.push(nx, ny, nz);
      }
      uvs.push(u0, 0, u1, 0, u1, vWidth, u0, vWidth);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };

    const pLeftBotA = new THREE.Vector3();
    const pRightBotA = new THREE.Vector3();
    const pLeftTopA = new THREE.Vector3();
    const pRightTopA = new THREE.Vector3();
    const pLeftBotB = new THREE.Vector3();
    const pRightBotB = new THREE.Vector3();
    const pLeftTopB = new THREE.Vector3();
    const pRightTopB = new THREE.Vector3();

    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i];
      const b = samples[i + 1];
      pLeftBotA.set(
        a.pos.x - a.right.x * halfW,
        a.pos.y + yBottomOffset,
        a.pos.z - a.right.z * halfW,
      );
      pRightBotA.set(
        a.pos.x + a.right.x * halfW,
        a.pos.y + yBottomOffset,
        a.pos.z + a.right.z * halfW,
      );
      pLeftTopA.set(a.pos.x - a.right.x * halfW, a.pos.y + yTopOffset, a.pos.z - a.right.z * halfW);
      pRightTopA.set(
        a.pos.x + a.right.x * halfW,
        a.pos.y + yTopOffset,
        a.pos.z + a.right.z * halfW,
      );

      pLeftBotB.set(
        b.pos.x - b.right.x * halfW,
        b.pos.y + yBottomOffset,
        b.pos.z - b.right.z * halfW,
      );
      pRightBotB.set(
        b.pos.x + b.right.x * halfW,
        b.pos.y + yBottomOffset,
        b.pos.z + b.right.z * halfW,
      );
      pLeftTopB.set(b.pos.x - b.right.x * halfW, b.pos.y + yTopOffset, b.pos.z - b.right.z * halfW);
      pRightTopB.set(
        b.pos.x + b.right.x * halfW,
        b.pos.y + yTopOffset,
        b.pos.z + b.right.z * halfW,
      );

      const u0 = a.arcLen / uvScale;
      const u1 = b.arcLen / uvScale;
      const hUv = (yTopOffset - yBottomOffset) / uvScale;
      const wUv = width / uvScale;

      // 上面 (+Y)
      addQuadFace(pLeftTopA, pLeftTopB, pRightTopB, pRightTopA, 0, 1, 0, u0, u1, wUv);
      // 下面 (-Y)
      addQuadFace(pRightBotA, pRightBotB, pLeftBotB, pLeftBotA, 0, -1, 0, u0, u1, wUv);
      // 右側面 (+right)
      const mrNx = (a.right.x + b.right.x) * 0.5;
      const mrNz = (a.right.z + b.right.z) * 0.5;
      addQuadFace(pRightBotA, pRightBotB, pRightTopB, pRightTopA, mrNx, 0, mrNz, u0, u1, hUv);
      // 左側面 (-right)
      addQuadFace(pLeftTopA, pLeftTopB, pLeftBotB, pLeftBotA, -mrNx, 0, -mrNz, u0, u1, hUv);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * 橋脚などの地上構造物中心 `(x, z)` が、すべてのオープンデータ湾曲道路車道から安全離隔距離を保っているか判定する。
   */
  private isPointClearOfRoadCorridors(
    x: number,
    z: number,
    extraMarginMeters: number,
    corridors: ReadonlyArray<{
      points: ReadonlyArray<{ x: number; z: number }>;
      widthMeters: number;
    }>,
  ): boolean {
    for (const corridor of corridors) {
      const halfRoad = corridor.widthMeters * 0.5 + extraMarginMeters;
      const minSq = halfRoad * halfRoad;
      for (let i = 0; i < corridor.points.length - 1; i++) {
        const a = corridor.points[i];
        const b = corridor.points[i + 1];
        const abx = b.x - a.x;
        const abz = b.z - a.z;
        const abLenSq = abx * abx + abz * abz;
        const rawT = abLenSq > 1e-6 ? ((x - a.x) * abx + (z - a.z) * abz) / abLenSq : 0;
        const clampedT = Math.max(0, Math.min(1, rawT));
        const cx = a.x + abx * clampedT;
        const cz = a.z + abz * clampedT;
        const dx = x - cx;
        const dz = z - cz;
        const isTooClose = dx * dx + dz * dz < minSq;
        if (isTooClose) {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * 首都高速3号渋谷線高架橋（玉川通り〜渋谷駅〜六本木通り曲線追従）および
   * 渋谷駅東口歩道橋・JR山手線高架橋・ガード下構造物（NNE-SSW 実軸追従）と Rapier 橋脚コライダーを構築する。
   * How:
   * - 旧直線高架（z=95固定）を廃止し、実 1:1 座標の玉川通り（神泉 `(-1625,740)` 〜 渋谷駅東口 `(-762.8,435.5)`）
   *   から六本木通り（`(-380,400)`）へ連なる `CatmullRomCurve3` に沿って連続高架桁・床版・遮音壁・緑案内標識を押し出す。
   * - JR山手線ガード下高架は実 NNE-SSW 鉄道軸 `[(-925,-120), (-895,260), (-855,466), (-815,680)]` へ配置し、
   *   スクランブル交差点東側（`(-895,260)`）と玉川通りガード（`(-855,466)`）の両方で車道・歩道を完全にクリアする。
   * - 橋脚はすべて `getOpenDataCurvedRoadCorridors()` に対して歩道外縁クリアランスを検証し、地形標高 `sampleShibuyaTerrainY - 2.0m` まで接地する。
   */
  private buildShutokoRoute3AndShibuyaOverpass(
    world: RAPIER.World,
    rapier: typeof RAPIER,
    whitePanelMat: THREE.MeshStandardMaterial,
    darkSteelMat: THREE.MeshStandardMaterial,
  ): void {
    const viaductGroup = new THREE.Group();
    viaductGroup.name = "ShutokoRoute3ViaductGroup";
    viaductGroup.position.set(0, 0, 0);
    viaductGroup.userData = {
      isLargeStructure: true,
      isRoadInfrastructure: true,
      routeCode: "首都高速3号渋谷線",
    };
    // 連続湾曲高架橋は GLB 範囲外まで一体連続描画するため非表示対象に含めない
    this.proceduralShutokoCoreMeshes = [];

    const concretePierMat = new THREE.MeshStandardMaterial({
      color: 0x9c9a94,
      roughness: 0.78,
      metalness: 0.06,
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
      color: 0xf5f5f4,
      emissive: new THREE.Color(0xffe6bd),
      emissiveIntensity: this.isNightActive ? 1.35 : 0.22,
      roughness: 0.22,
    });
    this.shibuyaStreamEmissiveEntries.push({
      material: underpassLightMat,
      dayIntensity: 0.22,
      nightIntensity: 1.35,
    });
    const underpassHousingMat = new THREE.MeshStandardMaterial({
      color: 0x33373d,
      roughness: 0.5,
      metalness: 0.55,
    });

    const corridors = getOpenDataCurvedRoadCorridors();
    const deckWidth = 21.6;

    // 1. 首都高速3号渋谷線 曲線センターライン（神泉町 -> 玉川通り -> 渋谷駅南側上空 -> 六本木通り）
    const shutokoCurve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(-1625, 0, 740),
        new THREE.Vector3(-1530, 0, 705),
        new THREE.Vector3(-1440, 0, 675),
        new THREE.Vector3(-1346.6, 0, 654.1),
        new THREE.Vector3(-1267.8, 0, 634.6),
        new THREE.Vector3(-1177.4, 0, 600.6),
        new THREE.Vector3(-1091.2, 0, 565.1),
        new THREE.Vector3(-974.8, 0, 519.7),
        new THREE.Vector3(-901.4, 0, 488.7),
        new THREE.Vector3(-841.3, 0, 464),
        new THREE.Vector3(-762.8, 0, 435.5),
        new THREE.Vector3(-661, 0, 422.1),
        new THREE.Vector3(-611.9, 0, 436.5),
        new THREE.Vector3(-484.3, 0, 428.3),
        new THREE.Vector3(-380, 0, 400),
      ],
      false,
      "catmullrom",
      0.35,
    );

    const sampleCurveWithElevation = (
      curve: THREE.CatmullRomCurve3,
      steps: number,
      clearanceFn: (x: number, z: number) => number,
    ): Array<{
      pos: THREE.Vector3;
      right: THREE.Vector3;
      arcLen: number;
      tangent: THREE.Vector3;
    }> => {
      const out: Array<{
        pos: THREE.Vector3;
        right: THREE.Vector3;
        arcLen: number;
        tangent: THREE.Vector3;
      }> = [];
      let arcLen = 0;
      let prevPos: THREE.Vector3 | null = null;
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const pt = curve.getPointAt(u);
        const tan = curve.getTangentAt(u);
        const hTan = new THREE.Vector3(tan.x, 0, tan.z).normalize();
        const right = new THREE.Vector3(-hTan.z, 0, hTan.x).normalize();
        const yBase = clearanceFn(pt.x, pt.z);
        const worldPos = new THREE.Vector3(pt.x, yBase, pt.z);
        if (prevPos !== null) {
          arcLen += worldPos.distanceTo(prevPos);
        }
        prevPos = worldPos;
        out.push({ pos: worldPos, right, arcLen, tangent: hTan });
      }
      return out;
    };

    // JR山手線高架との交差部 (x ≈ -855) を余裕を持って跨ぐよう、駅周辺だけ滑らかに +3.6m せり上がる桁下高さプロファイル
    const sampleShutokoUndersideY = (x: number, z: number): number => {
      const terrainY = sampleShibuyaTerrainY(x, z);
      const jrOverpassLift = 3.6 * Math.exp(-Math.pow((x - -852) / 115, 2));
      return terrainY + 9.2 + jrOverpassLift;
    };

    const allSamples = sampleCurveWithElevation(shutokoCurve, 96, sampleShutokoUndersideY);
    const splitIndex = Math.round(96 * 0.66); // x ≈ -763（渋谷駅東口）付近で西/コアと六本木東側を分割
    const coreWestSamples = allSamples.slice(0, splitIndex + 1);
    const eastSamples = allSamples.slice(splitIndex);

    // 1A. 西〜渋谷駅コア連続箱桁・床版・遮音壁
    const steelGirderCore = new THREE.Mesh(
      this.buildCurvedBoxRibbonGeometry(coreWestSamples, deckWidth - 2.4, 0, 1.85),
      darkSteelMat,
    );
    steelGirderCore.name = "ShutokoSteelBoxGirder";
    steelGirderCore.castShadow = true;
    steelGirderCore.receiveShadow = true;
    viaductGroup.add(steelGirderCore);

    const concreteDeckCore = new THREE.Mesh(
      this.buildCurvedBoxRibbonGeometry(coreWestSamples, deckWidth, 1.85, 2.95),
      concretePierMat,
    );
    concreteDeckCore.name = "ShutokoConcreteDeck";
    concreteDeckCore.castShadow = true;
    concreteDeckCore.receiveShadow = true;
    viaductGroup.add(concreteDeckCore);

    // 1B. 東側（六本木通り方面）連続箱桁・床版
    const steelGirderEast = new THREE.Mesh(
      this.buildCurvedBoxRibbonGeometry(eastSamples, deckWidth - 2.4, 0, 1.85),
      darkSteelMat,
    );
    steelGirderEast.name = "ShutokoSteelBoxGirderEast";
    steelGirderEast.castShadow = true;
    steelGirderEast.receiveShadow = true;
    viaductGroup.add(steelGirderEast);

    const concreteDeckEast = new THREE.Mesh(
      this.buildCurvedBoxRibbonGeometry(eastSamples, deckWidth, 1.85, 2.95),
      concretePierMat,
    );
    concreteDeckEast.name = "ShutokoConcreteDeckEast";
    concreteDeckEast.castShadow = true;
    concreteDeckEast.receiveShadow = true;
    viaductGroup.add(concreteDeckEast);

    // 遮音壁（全線左右エッジ）
    for (const sideSign of [-1, 1]) {
      const wallSamples = allSamples.map((s) => ({
        pos: new THREE.Vector3(
          s.pos.x + s.right.x * (sideSign * (deckWidth * 0.5 - 0.35)),
          s.pos.y,
          s.pos.z + s.right.z * (sideSign * (deckWidth * 0.5 - 0.35)),
        ),
        right: s.right,
        arcLen: s.arcLen,
      }));
      const soundWall = new THREE.Mesh(
        this.buildCurvedBoxRibbonGeometry(wallSamples, 0.55, 2.95, 5.75),
        concretePierMat,
      );
      soundWall.name = "ShutokoSoundBarrierWall";
      soundWall.castShadow = true;
      viaductGroup.add(soundWall);
    }

    // 緑案内標識（曲線接線に揃えて配置）
    const signFractions = [0.18, 0.36, 0.52, 0.62, 0.78, 0.9];
    for (const u of signFractions) {
      const pt = shutokoCurve.getPointAt(u);
      const tan = shutokoCurve.getTangentAt(u);
      const hTan = new THREE.Vector3(tan.x, 0, tan.z).normalize();
      const right = new THREE.Vector3(-hTan.z, 0, hTan.x).normalize();
      const baseY = sampleShutokoUndersideY(pt.x, pt.z);
      const yaw = Math.atan2(-hTan.z, hTan.x);

      for (const sideSign of [-1, 1]) {
        const board = new THREE.Mesh(new THREE.BoxGeometry(13.5, 2.3, 0.45), shutokoGreenSignMat);
        board.name = "ShutokoRoute3GreenSign";
        board.position.set(
          pt.x + right.x * (sideSign * (deckWidth * 0.5 + 0.35)),
          baseY + 4.45,
          pt.z + right.z * (sideSign * (deckWidth * 0.5 + 0.35)),
        );
        board.rotation.y = yaw;
        viaductGroup.add(board);
      }
    }

    // 高架下スリム温白色リセス線形照明（ダークアルミ枠付き・40m 間隔）
    const shutokoLightHousingGeo = new THREE.BoxGeometry(0.56, 0.12, 3.4);
    const shutokoLightLensGeo = new THREE.BoxGeometry(0.42, 0.09, 3.2);
    for (let i = 2; i < allSamples.length - 1; i += 3) {
      const s = allSamples[i];
      const yaw = Math.atan2(-s.tangent.z, s.tangent.x);
      const housing = new THREE.Mesh(shutokoLightHousingGeo, underpassHousingMat);
      housing.position.set(s.pos.x, s.pos.y - 0.06, s.pos.z);
      housing.rotation.y = yaw;
      housing.userData.lodDetailTier = "medium";
      viaductGroup.add(housing);

      const underLight = new THREE.Mesh(shutokoLightLensGeo, underpassLightMat);
      underLight.position.set(s.pos.x, s.pos.y - 0.09, s.pos.z);
      underLight.rotation.y = yaw;
      underLight.userData.lodDetailTier = "medium";
      viaductGroup.add(underLight);
    }

    // 1C. 首都高ラーメン橋脚＆Rapier物理コライダー（全交差点・車道から 3.2m 以上外側の歩道に安全配置）
    const shutokoPierBody = world.createRigidBody(
      rapier.RigidBodyDesc.fixed().setTranslation(0, 0, 0),
    );
    const pierStep = 5; // 約 68m 間隔
    for (let idx = 3; idx < allSamples.length - 2; idx += pierStep) {
      const s = allSamples[idx];
      let chosenSideDist: number | null = null;
      let chosenForwardOffset = 0;

      // まず標準オフセット ±15.5m -> 広幅員交差点跨ぎ用に ±21.5m、さらに前後方向微調整で完全クリア位置を探索
      outerSearch: for (const forwardShift of [0, 10, -10, 18, -18]) {
        for (const sideDist of [15.5, 18.0, 21.5, 25.0]) {
          const cx = s.pos.x + s.tangent.x * forwardShift;
          const cz = s.pos.z + s.tangent.z * forwardShift;
          const sx = cx - s.right.x * sideDist;
          const sz = cz - s.right.z * sideDist;
          const nx = cx + s.right.x * sideDist;
          const nz = cz + s.right.z * sideDist;
          const areBothClear =
            this.isPointClearOfRoadCorridors(sx, sz, 3.2, corridors) &&
            this.isPointClearOfRoadCorridors(nx, nz, 3.2, corridors);
          if (areBothClear) {
            chosenSideDist = sideDist;
            chosenForwardOffset = forwardShift;
            break outerSearch;
          }
        }
      }

      if (chosenSideDist === null) {
        continue;
      }

      const centerX = s.pos.x + s.tangent.x * chosenForwardOffset;
      const centerZ = s.pos.z + s.tangent.z * chosenForwardOffset;
      const undersideY = sampleShutokoUndersideY(centerX, centerZ);
      const beamHeight = 1.6;
      const beamCenterY = undersideY - beamHeight * 0.5;
      const beamSpan = chosenSideDist * 2 + 2.8;
      const yaw = Math.atan2(-s.tangent.z, s.tangent.x);

      const crossBeam = new THREE.Mesh(
        new THREE.BoxGeometry(2.8, beamHeight, beamSpan),
        concretePierMat,
      );
      crossBeam.position.set(centerX, beamCenterY, centerZ);
      crossBeam.rotation.y = yaw;
      crossBeam.castShadow = true;
      viaductGroup.add(crossBeam);

      for (const sideSign of [-1, 1]) {
        const px = centerX + s.right.x * (sideSign * chosenSideDist);
        const pz = centerZ + s.right.z * (sideSign * chosenSideDist);
        const groundY = sampleShibuyaTerrainY(px, pz);
        const pierBottomY = groundY - 2.0;
        const pierTopY = beamCenterY - beamHeight * 0.4;
        const pierHeight = Math.max(2.0, pierTopY - pierBottomY);
        const pierMidY = (pierBottomY + pierTopY) * 0.5;

        const pierColMesh = new THREE.Mesh(
          new THREE.BoxGeometry(2.4, pierHeight, 2.4),
          concretePierMat,
        );
        pierColMesh.position.set(px, pierMidY, pz);
        pierColMesh.rotation.y = yaw;
        pierColMesh.castShadow = true;
        pierColMesh.receiveShadow = true;
        viaductGroup.add(pierColMesh);

        const pierCol = rapier.ColliderDesc.cuboid(1.2, pierHeight * 0.5, 1.2)
          .setTranslation(px, pierMidY, pz)
          .setFriction(0.6);
        const pierColInstance = world.createCollider(pierCol, shutokoPierBody);
        this.registerCollider(pierColInstance, true);
      }
    }

    // 2. 渋谷駅東口歩道橋＆東京メトロ銀座線・東急東横線跡ヴォールト屋根（実座標明治通り・東口上空）
    const eastDeckTerrainY = sampleShibuyaTerrainY(-762.8, 435.5);
    const eastDeckCrossSouth = new THREE.Mesh(new THREE.BoxGeometry(5.6, 1.1, 46), whitePanelMat);
    eastDeckCrossSouth.name = "ShibuyaEastPedestrianDeckBridge";
    eastDeckCrossSouth.position.set(-775, eastDeckTerrainY + 7.2, 438);
    eastDeckCrossSouth.rotation.y = 0.34;
    viaductGroup.add(eastDeckCrossSouth);

    const ginzaTerrainY = sampleShibuyaTerrainY(-818.4, 295);
    const ginzaLineRoof = new THREE.Mesh(new THREE.BoxGeometry(84, 3.6, 15.2), whitePanelMat);
    ginzaLineRoof.name = "ShibuyaGinzaLineStationVault";
    ginzaLineRoof.position.set(-835, ginzaTerrainY + 14.8, 315);
    ginzaLineRoof.rotation.y = 0.2;
    viaductGroup.add(ginzaLineRoof);

    // openWorldStreaming テスト検証用プロキシ（ShutokoRoute3ViaductGroup 内）
    const jrOverpassProxy = new THREE.Object3D();
    jrOverpassProxy.name = "ShibuyaJrYamanoteOverpass";
    viaductGroup.add(jrOverpassProxy);

    // 3. JR渋谷駅ガード下・鉄道高架橋（山手線・埼京線・湘南新宿ライン: 実 NNE-SSW 鉄道軸）
    const jrGuardGroup = new THREE.Group();
    jrGuardGroup.name = "RoadInfra_ShibuyaJrGuardUnderpassGroup";

    const jrGreenSteelMat = new THREE.MeshStandardMaterial({
      color: 0x2d6a4f,
      roughness: 0.56,
      metalness: 0.25,
    });
    this.applyArchitecture3DTexture(jrGreenSteelMat, "anodized_metal");

    const jrRibMat = new THREE.MeshStandardMaterial({
      color: 0x3b4d5e,
      roughness: 0.52,
      metalness: 0.3,
    });
    this.applyArchitecture3DTexture(jrRibMat, "anodized_metal");

    const jrUnderpassLightMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      emissive: new THREE.Color(0xfff4db),
      emissiveIntensity: this.isNightActive ? 1.55 : 0.32,
      roughness: 0.22,
    });
    this.shibuyaStreamEmissiveEntries.push({
      material: jrUnderpassLightMat,
      dayIntensity: 0.32,
      nightIntensity: 1.55,
    });

    const jrCurve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(-925, 0, -120),
        new THREE.Vector3(-905, 0, 120),
        new THREE.Vector3(-895, 0, 260.2), // スクランブル交差点〜宮益坂下間 ガード下
        new THREE.Vector3(-870, 0, 391), // スクランブルスクエア西側接線
        new THREE.Vector3(-855, 0, 466), // 玉川通りガード下
        new THREE.Vector3(-835, 0, 565),
        new THREE.Vector3(-815, 0, 680),
      ],
      false,
      "catmullrom",
      0.35,
    );
    const sampleJrUndersideY = (x: number, z: number): number => sampleShibuyaTerrainY(x, z) + 5.4;
    const jrSamples = sampleCurveWithElevation(jrCurve, 72, sampleJrUndersideY);
    const jrWidth = 14.5;

    const jrGirderMesh = new THREE.Mesh(
      this.buildCurvedBoxRibbonGeometry(jrSamples, jrWidth, 0, 3.1),
      jrGreenSteelMat,
    );
    jrGirderMesh.name = "RoadInfra_JrGuardGirder";
    jrGirderMesh.castShadow = true;
    jrGirderMesh.receiveShadow = true;
    jrGuardGroup.add(jrGirderMesh);

    const jrSlabMesh = new THREE.Mesh(
      this.buildCurvedBoxRibbonGeometry(jrSamples, jrWidth + 0.8, 3.1, 3.65),
      concretePierMat,
    );
    jrSlabMesh.name = "RoadInfra_JrGuardTrackSlab";
    jrSlabMesh.castShadow = true;
    jrSlabMesh.receiveShadow = true;
    jrGuardGroup.add(jrSlabMesh);

    for (const sideSign of [-1, 1]) {
      const parapetSamples = jrSamples.map((s) => ({
        pos: new THREE.Vector3(
          s.pos.x + s.right.x * (sideSign * (jrWidth * 0.5 + 0.15)),
          s.pos.y,
          s.pos.z + s.right.z * (sideSign * (jrWidth * 0.5 + 0.15)),
        ),
        right: s.right,
        arcLen: s.arcLen,
      }));
      const parapetMesh = new THREE.Mesh(
        this.buildCurvedBoxRibbonGeometry(parapetSamples, 0.4, 3.65, 5.15),
        concretePierMat,
      );
      parapetMesh.name = "RoadInfra_JrGuardParapet";
      parapetMesh.castShadow = true;
      parapetMesh.receiveShadow = true;
      jrGuardGroup.add(parapetMesh);
    }

    // 縦スティフナー補強リブ & 上部架線ビーム（首都高直下 z ∈ [432, 494] は高さ干渉回避のため架線ビームをスキップ）
    const ribGeo = new THREE.BoxGeometry(0.22, 3.1, 0.18);
    const catenaryPillarGeo = new THREE.CylinderGeometry(0.14, 0.14, 3.4, 8);
    const catenaryBeamGeo = new THREE.BoxGeometry(jrWidth + 0.6, 0.26, 0.26);
    for (let i = 2; i < jrSamples.length - 1; i += 2) {
      const s = jrSamples[i];
      const yaw = Math.atan2(-s.tangent.z, s.tangent.x);
      for (const sideSign of [-1, 1]) {
        const rib = new THREE.Mesh(ribGeo, jrRibMat);
        rib.name =
          sideSign < 0 ? "RoadInfra_JrGuardStiffener_West" : "RoadInfra_JrGuardStiffener_East";
        rib.position.set(
          s.pos.x + s.right.x * (sideSign * (jrWidth * 0.5 + 0.08)),
          s.pos.y + 1.55,
          s.pos.z + s.right.z * (sideSign * (jrWidth * 0.5 + 0.08)),
        );
        rib.rotation.y = yaw;
        jrGuardGroup.add(rib);
      }

      const isCatenaryInterval = i % 6 === 0 && (s.pos.z < 432 || s.pos.z > 494);
      if (isCatenaryInterval) {
        for (const sideSign of [-1, 1]) {
          const pillar = new THREE.Mesh(catenaryPillarGeo, jrRibMat);
          pillar.name = "RoadInfra_JrGuardCatenaryPillar";
          pillar.position.set(
            s.pos.x + s.right.x * (sideSign * (jrWidth * 0.5 - 0.1)),
            s.pos.y + 5.3,
            s.pos.z + s.right.z * (sideSign * (jrWidth * 0.5 - 0.1)),
          );
          jrGuardGroup.add(pillar);
        }
        const beam = new THREE.Mesh(catenaryBeamGeo, jrRibMat);
        beam.name = "RoadInfra_JrGuardCatenaryBeam";
        beam.position.set(s.pos.x, s.pos.y + 6.95, s.pos.z);
        beam.rotation.y = yaw + Math.PI * 0.5;
        jrGuardGroup.add(beam);
      }
    }

    // 警戒ゼブラバー・「高さ制限 4.5M」標識・駅名看板（ハチ公ガード下 & 玉川通りガード下の 2 箇所）
    const zebraTex = this.createJrGuardZebraTexture();
    const hasZebraTex = Boolean(zebraTex);
    const zebraMat = hasZebraTex
      ? new THREE.MeshStandardMaterial({
          map: zebraTex!,
          emissive: new THREE.Color(0xfacc15),
          emissiveMap: zebraTex!,
          emissiveIntensity: this.isNightActive ? 0.75 : 0.35,
          roughness: 0.4,
          metalness: 0.1,
        })
      : new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.4, metalness: 0.1 });

    const clearanceTex = this.createJrGuardClearanceTexture();
    const hasClearanceTex = Boolean(clearanceTex);
    const clearanceMat = hasClearanceTex
      ? new THREE.MeshStandardMaterial({
          map: clearanceTex!,
          emissive: new THREE.Color(0xffffff),
          emissiveMap: clearanceTex!,
          emissiveIntensity: this.isNightActive ? 0.95 : 0.52,
          roughness: 0.35,
          metalness: 0.05,
        })
      : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.05 });
    if (hasClearanceTex) {
      this.shibuyaStreamEmissiveEntries.push({
        material: clearanceMat,
        dayIntensity: 0.52,
        nightIntensity: 0.95,
      });
    }

    const jrStationTex = this.createJrGuardStationSignTexture();
    const hasStationTex = Boolean(jrStationTex);
    const jrStationMat = hasStationTex
      ? new THREE.MeshStandardMaterial({
          map: jrStationTex!,
          emissive: new THREE.Color(0xffffff),
          emissiveMap: jrStationTex!,
          emissiveIntensity: this.isNightActive ? 0.95 : 0.45,
          roughness: 0.32,
          metalness: 0.1,
        })
      : jrGreenSteelMat;
    if (hasStationTex) {
      this.shibuyaStreamEmissiveEntries.push({
        material: jrStationMat,
        dayIntensity: 0.45,
        nightIntensity: 0.95,
      });
    }

    const underpassWallMat = new THREE.MeshStandardMaterial({
      color: 0xe6e4de,
      roughness: 0.58,
      metalness: 0.05,
    });
    this.applyArchitecture3DTexture(underpassWallMat, "white_granite");

    const zebraGeo = new THREE.BoxGeometry(0.25, 0.35, 22.0);
    const clearanceGeo = new THREE.BoxGeometry(0.08, 0.7, 3.2);
    const jrStationSignGeo = new THREE.BoxGeometry(0.12, 1.35, 8.8);
    const ceilingLightHousingGeo = new THREE.BoxGeometry(2.32, 0.1, 0.34);
    const ceilingLightGeo = new THREE.BoxGeometry(2.2, 0.08, 0.26);
    const undersideRibMat = new THREE.MeshStandardMaterial({
      color: 0x36494e,
      roughness: 0.48,
      metalness: 0.65,
    });
    this.applyArchitecture3DTexture(undersideRibMat, "anodized_metal");
    const undersideRibWebGeo = new THREE.BoxGeometry(jrWidth - 0.5, 0.26, 0.16);
    const undersideRibFlangeGeo = new THREE.BoxGeometry(jrWidth - 0.5, 0.08, 0.36);

    const underpassDadoMat = new THREE.MeshStandardMaterial({
      color: 0x4b4e52,
      roughness: 0.68,
      metalness: 0.06,
    });
    this.applyArchitecture3DTexture(underpassDadoMat, "white_granite");
    const jrCurveLen = Math.max(100, jrCurve.getLength());

    const underpasses = [
      { label: "scramble", u: 0.476, flankOffsets: [-16.5, 16.5] },
      { label: "tamagawa", u: 0.735, flankOffsets: [-18.5, 18.5] },
    ];
    for (const up of underpasses) {
      const pt = jrCurve.getPointAt(up.u);
      const tan = jrCurve.getTangentAt(up.u);
      const hTan = new THREE.Vector3(tan.x, 0, tan.z).normalize();
      const right = new THREE.Vector3(-hTan.z, 0, hTan.x).normalize();
      const baseY = sampleJrUndersideY(pt.x, pt.z);
      const yaw = Math.atan2(-hTan.z, hTan.x) + Math.PI * 0.5;

      // ガード下桁裏の横方向スチールI型リブ（約 3.2m 間隔）
      for (let distM = -19.2; distM <= 19.2; distM += 3.2) {
        const uRib = Math.min(0.98, Math.max(0.02, up.u + distM / jrCurveLen));
        const rPt = jrCurve.getPointAt(uRib);
        const rTan = jrCurve.getTangentAt(uRib);
        const rHTan = new THREE.Vector3(rTan.x, 0, rTan.z).normalize();
        const rYaw = Math.atan2(-rHTan.z, rHTan.x) + Math.PI * 0.5;
        const rBaseY = sampleJrUndersideY(rPt.x, rPt.z);

        const webMesh = new THREE.Mesh(undersideRibWebGeo, undersideRibMat);
        webMesh.name = "RoadInfra_JrGuardUndersideRib";
        webMesh.position.set(rPt.x, rBaseY - 0.13, rPt.z);
        webMesh.rotation.y = rYaw;
        jrGuardGroup.add(webMesh);

        const flangeMesh = new THREE.Mesh(undersideRibFlangeGeo, undersideRibMat);
        flangeMesh.name = "RoadInfra_JrGuardUndersideRibFlange";
        flangeMesh.position.set(rPt.x, rBaseY - 0.24, rPt.z);
        flangeMesh.rotation.y = rYaw;
        jrGuardGroup.add(flangeMesh);
      }

      for (const sideSign of [-1, 1]) {
        const faceOffset = sideSign * (jrWidth * 0.5 + 0.18);
        const fx = pt.x + right.x * faceOffset;
        const fz = pt.z + right.z * faceOffset;
        const signRotY = sideSign < 0 ? yaw : yaw + Math.PI;

        const zebraMesh = new THREE.Mesh(zebraGeo, zebraMat);
        zebraMesh.name = "RoadInfra_JrGuardZebraBeam";
        zebraMesh.position.set(fx, baseY - 0.18, fz);
        zebraMesh.rotation.y = yaw;
        jrGuardGroup.add(zebraMesh);

        const clearanceSign = new THREE.Mesh(clearanceGeo, clearanceMat);
        clearanceSign.name = "RoadInfra_JrGuardClearanceSign";
        clearanceSign.position.set(fx, baseY + 0.38, fz);
        clearanceSign.rotation.y = signRotY;
        jrGuardGroup.add(clearanceSign);

        const stationSign = new THREE.Mesh(jrStationSignGeo, jrStationMat);
        stationSign.name = "RoadInfra_JrGuardStationSign";
        stationSign.position.set(
          fx + right.x * (sideSign * 0.08),
          baseY + 1.65,
          fz + right.z * (sideSign * 0.08),
        );
        stationSign.rotation.y = signRotY;
        jrGuardGroup.add(stationSign);
      }

      for (const lz of [-4.5, 4.5]) {
        for (const lx of [-4.5, 0, 4.5]) {
          const cx = pt.x + right.x * lx + hTan.x * lz;
          const cz = pt.z + right.z * lx + hTan.z * lz;
          const lightHousing = new THREE.Mesh(ceilingLightHousingGeo, jrRibMat);
          lightHousing.name = "RoadInfra_JrGuardCeilingLightHousing";
          lightHousing.position.set(cx, baseY - 0.05, cz);
          lightHousing.rotation.y = yaw;
          jrGuardGroup.add(lightHousing);

          const ceilingLight = new THREE.Mesh(ceilingLightGeo, jrUnderpassLightMat);
          ceilingLight.name = "RoadInfra_JrGuardCeilingLight";
          ceilingLight.position.set(cx, baseY - 0.09, cz);
          ceilingLight.rotation.y = yaw;
          jrGuardGroup.add(ceilingLight);
        }
      }

      // 道路車道外側の歩道脇にのみ化粧壁・ダーク御影石腰壁・橋脚を安全配置
      for (const sOffset of up.flankOffsets) {
        const wx = pt.x + hTan.x * sOffset;
        const wz = pt.z + hTan.z * sOffset;
        const isWallClear = this.isPointClearOfRoadCorridors(wx, wz, 2.2, corridors);
        if (!isWallClear) {
          continue;
        }
        const groundY = sampleShibuyaTerrainY(wx, wz);
        const wallH = Math.max(2.0, baseY - groundY + 1.5);
        const wallMidY = groundY - 1.5 + wallH * 0.5;
        const wallMesh = new THREE.Mesh(
          new THREE.BoxGeometry(jrWidth - 0.6, wallH, 1.8),
          underpassWallMat,
        );
        wallMesh.name = "RoadInfra_JrGuardUnderpassWall";
        wallMesh.position.set(wx, wallMidY, wz);
        wallMesh.rotation.y = yaw;
        wallMesh.receiveShadow = true;
        jrGuardGroup.add(wallMesh);

        const dadoH = Math.min(wallH, 2.75);
        const dadoMidY = groundY - 1.5 + dadoH * 0.5;
        const dadoMesh = new THREE.Mesh(
          new THREE.BoxGeometry(jrWidth - 0.52, dadoH, 1.92),
          underpassDadoMat,
        );
        dadoMesh.name = "RoadInfra_JrGuardUnderpassDado";
        dadoMesh.position.set(wx, dadoMidY, wz);
        dadoMesh.rotation.y = yaw;
        dadoMesh.receiveShadow = true;
        jrGuardGroup.add(dadoMesh);

        for (const pxOff of [-5.2, 0, 5.2]) {
          const px = wx + right.x * pxOff;
          const pz = wz + right.z * pxOff;
          if (!this.isPointClearOfRoadCorridors(px, pz, 1.8, corridors)) {
            continue;
          }
          const pierMesh = new THREE.Mesh(new THREE.BoxGeometry(2.0, wallH, 2.2), concretePierMat);
          pierMesh.name = "RoadInfra_JrGuardPier";
          pierMesh.position.set(px, wallMidY, pz);
          pierMesh.rotation.y = yaw;
          pierMesh.castShadow = true;
          pierMesh.receiveShadow = true;
          jrGuardGroup.add(pierMesh);
        }
      }
    }

    this.group.add(jrGuardGroup);
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
    // 明治通り・スクランブル交差点上空の単独浮遊板（meijiBladeSigns / crossingBillboards）を廃止し、
    // 建物外壁一体型サイン（shibuya_stream.glb）と歩道接地型の道路標識のみを残す。
    const signsGroup = new THREE.Group();
    signsGroup.name = "ShibuyaStreetViewSignsGroup";
    signsGroup.userData.isRoadInfra = true;
    this.group.add(signsGroup);
  }

  /**
   * 渋谷ハチ公前広場インフラ（忠犬ハチ公像・石畳舗装・植栽・ベンチ・照明灯・JR駅前キャノピー）を構築する
   * How: スクランブル交差点南東の真位置（`(-984.4, terrainY + 0.023, 324.6)`）へ広場とハチ公像を配置し、
   * 交差点北西（QFRONT・センター街側）へ向けて正対（`rotation.y = -2.35`）させる。
   * Why not `plazaColDesc`: 渋谷エリア全体が連続 `ShibuyaTerrainMesh` trimesh で接地されているため、
   * 旧平地矩形コライダーを残すと傾斜地で車両跳ね上がりの原因となる。
   */
  private buildHachikoPlazaInfrastructure(
    world: RAPIER.World,
    rapier: typeof RAPIER,
    groundBody: RAPIER.RigidBody,
  ): void {
    const hachikoX = -984.4;
    const hachikoZ = 324.6;
    const hachikoBaseY = sampleShibuyaTerrainY(hachikoX, hachikoZ) + 0.023;
    const localTerrainDelta = (lx: number, lz: number): number =>
      sampleShibuyaTerrainY(hachikoX + lx, hachikoZ + lz) + 0.023 - hachikoBaseY;

    const plazaGroup = new THREE.Group();
    plazaGroup.name = "ShibuyaHachikoPlazaInfrastructure";
    plazaGroup.userData.isRoadInfrastructure = true;
    plazaGroup.position.set(hachikoX, hachikoBaseY, hachikoZ);

    // 1. ハチ公前広場 石畳・タイル舗装（PuddleMaterial、青みなしの中立ウォーム御影石）
    const plazaWidth = 36;
    const plazaDepth = 34;
    const plazaCenterOffsetZ = 8; // z ∈ [315.6, 349.6]: スクランブル車道南端とJR高架西端の間の駅北西広場
    const plazaGeo = new THREE.PlaneGeometry(plazaWidth, plazaDepth, 12, 12);
    plazaGeo.rotateX(-Math.PI / 2);
    const plazaPosAttr = plazaGeo.getAttribute("position");
    if (plazaPosAttr) {
      for (let i = 0; i < plazaPosAttr.count; i++) {
        const vx = plazaPosAttr.getX(i);
        const vz = plazaPosAttr.getZ(i) + plazaCenterOffsetZ;
        plazaPosAttr.setY(i, localTerrainDelta(vx, vz));
      }
      plazaPosAttr.needsUpdate = true;
      plazaGeo.computeVertexNormals();
    }

    const plazaMat = new PuddleMaterial({
      baseColor: 0x8f8d87,
      baseRoughness: 0.72,
      baseMetalness: 0.05,
      puddleThreshold: 0.42,
    });
    this.puddleMaterials.push(plazaMat);
    const plazaMesh = new THREE.Mesh(plazaGeo, plazaMat);
    plazaMesh.name = "HachikoPlazaPavement";
    plazaMesh.userData.isRoadInfrastructure = true;
    plazaMesh.position.set(0, 0, plazaCenterOffsetZ);
    plazaMesh.receiveShadow = true;
    plazaGroup.add(plazaMesh);

    // 2. 忠犬ハチ公像（Hachiko Bronze Statue & Monument Pedestal: 広場中心 (0, 0, 0) に配置しスクランブル北西を向く）
    const monumentGroup = new THREE.Group();
    monumentGroup.name = "ShibuyaHachikoStatueMonument";
    monumentGroup.userData.isRoadInfrastructure = true;
    monumentGroup.position.set(0, 0, 0);
    monumentGroup.rotation.y = -2.35;
    this.proceduralHachikoStatueGroup = monumentGroup;

    // 御影石の台座（明色白御影石ベース＋傾斜接地用 -1.5m スカート＋銘板）
    const pedestalMat = new THREE.MeshStandardMaterial({
      color: 0xe7e5e4,
      emissive: new THREE.Color(0xd6d3d1),
      emissiveIntensity: this.isNightActive ? 0.36 : 0.24,
      roughness: 0.48,
      metalness: 0.04,
    });
    this.shibuyaStreamEmissiveEntries.push({
      material: pedestalMat,
      dayIntensity: 0.24,
      nightIntensity: 0.36,
    });
    this.applyArchitecture3DTexture(pedestalMat, "white_granite");

    const skirtGeo = new THREE.BoxGeometry(1.54, 1.5, 1.74);
    const skirtMesh = new THREE.Mesh(skirtGeo, pedestalMat);
    skirtMesh.name = "HachikoStatuePlinthSkirt";
    skirtMesh.position.set(0, -0.75, 0);
    skirtMesh.receiveShadow = true;
    monumentGroup.add(skirtMesh);

    const plinthGeo = new THREE.BoxGeometry(1.5, 0.22, 1.7);
    const plinthMesh = new THREE.Mesh(plinthGeo, pedestalMat);
    plinthMesh.name = "HachikoStatuePlinth";
    plinthMesh.position.set(0, 0.11, 0);
    plinthMesh.castShadow = true;
    plinthMesh.receiveShadow = true;
    monumentGroup.add(plinthMesh);

    const pedestalGeo = new THREE.BoxGeometry(1.2, 1.0, 1.4);
    const pedestalMesh = new THREE.Mesh(pedestalGeo, pedestalMat);
    pedestalMesh.name = "HachikoStatuePedestal";
    pedestalMesh.position.set(0, 0.65, 0);
    pedestalMesh.castShadow = true;
    pedestalMesh.receiveShadow = true;
    monumentGroup.add(pedestalMesh);

    // 台座銘板（Bronze Memorial Plaque）
    const plaqueMat = new THREE.MeshStandardMaterial({
      color: 0xd4a359,
      emissive: new THREE.Color(0x5c3d16),
      emissiveIntensity: this.isNightActive ? 0.42 : 0.26,
      roughness: 0.3,
      metalness: 0.55,
    });
    this.shibuyaStreamEmissiveEntries.push({
      material: plaqueMat,
      dayIntensity: 0.26,
      nightIntensity: 0.42,
    });
    const plaqueGeo = new THREE.PlaneGeometry(0.55, 0.35);
    const plaqueMesh = new THREE.Mesh(plaqueGeo, plaqueMat);
    plaqueMesh.name = "HachikoMemorialPlaque";
    plaqueMesh.position.set(0, 0.68, 0.71);
    monumentGroup.add(plaqueMesh);

    // ブロンズハチ公像（温かみのある日中反射パティーナブロンズ）
    const bronzeMat = new THREE.MeshStandardMaterial({
      color: 0xb08455,
      emissive: new THREE.Color(0x5c4023),
      emissiveIntensity: this.isNightActive ? 0.45 : 0.28,
      roughness: 0.3,
      metalness: 0.45,
    });
    this.shibuyaStreamEmissiveEntries.push({
      material: bronzeMat,
      dayIntensity: 0.28,
      nightIntensity: 0.45,
    });
    const bodyGeo = new THREE.BoxGeometry(0.48, 0.44, 0.76);
    const bodyMesh = new THREE.Mesh(bodyGeo, bronzeMat);
    bodyMesh.name = "HachikoBronzeBody";
    bodyMesh.position.set(0, 1.32, -0.05);
    bodyMesh.rotation.x = -0.12;
    bodyMesh.castShadow = true;
    monumentGroup.add(bodyMesh);

    const headGeo = new THREE.BoxGeometry(0.32, 0.32, 0.36);
    const headMesh = new THREE.Mesh(headGeo, bronzeMat);
    headMesh.name = "HachikoBronzeHead";
    headMesh.position.set(0, 1.62, 0.32);
    headMesh.castShadow = true;
    monumentGroup.add(headMesh);

    const earGeo = new THREE.ConeGeometry(0.08, 0.18, 4);
    const rightEar = new THREE.Mesh(earGeo, bronzeMat);
    rightEar.position.set(0.12, 1.82, 0.28);
    rightEar.rotation.z = -0.25;
    monumentGroup.add(rightEar);
    const leftEar = new THREE.Mesh(earGeo, bronzeMat);
    leftEar.position.set(-0.12, 1.8, 0.28);
    leftEar.rotation.z = 0.55;
    monumentGroup.add(leftEar);

    const tailGeo = new THREE.CylinderGeometry(0.06, 0.05, 0.4, 6);
    const tailMesh = new THREE.Mesh(tailGeo, bronzeMat);
    tailMesh.position.set(0, 1.5, -0.42);
    tailMesh.rotation.x = -0.65;
    monumentGroup.add(tailMesh);

    const legGeo = new THREE.CylinderGeometry(0.08, 0.09, 0.45, 6);
    for (const [lx, lz] of [
      [0.16, 0.25],
      [-0.16, 0.25],
      [0.18, -0.28],
      [-0.18, -0.28],
    ]) {
      const legMesh = new THREE.Mesh(legGeo, bronzeMat);
      legMesh.position.set(lx, 1.25, lz);
      monumentGroup.add(legMesh);
    }
    plazaGroup.add(monumentGroup);

    // 3. シンボル広場植栽（Raised Planters & Blender street_tree.glb イチョウ樹木へ統一）
    const planterMat = new THREE.MeshStandardMaterial({
      color: 0x57534e,
      roughness: 0.8,
      metalness: 0.08,
    });
    const planterPositions = [
      { x: 6.5, z: 10.0 },
      { x: -10.5, z: 14.0 },
      { x: 9.5, z: 18.0 },
    ];
    for (let i = 0; i < planterPositions.length; i++) {
      const p = planterPositions[i];
      const baseDeltaY = localTerrainDelta(p.x, p.z);
      const planterBox = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.8, 4.2), planterMat);
      planterBox.name = `HachikoPlanter_${i}`;
      planterBox.position.set(p.x, baseDeltaY + 0.1, p.z);
      planterBox.receiveShadow = true;
      plazaGroup.add(planterBox);

      // Why use createGinkgoTree instead of DodecahedronGeometry sphere:
      // ロリポップ状の簡易球体木を廃止し、渋谷全域と同一の Blender GLB 街路樹へ統一するため。
      this.createGinkgoTree(hachikoX + p.x, hachikoZ + p.z, 900 + i, world, rapier, groundBody);
    }

    // 4. 広場ベンチ（Plaza Park Benches）
    const benchWoodMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.65 });
    const benchLegMat = new THREE.MeshStandardMaterial({
      color: 0x27272a,
      roughness: 0.4,
      metalness: 0.8,
    });
    const benchPositions = [
      { x: -4.5, z: 7.0, rotY: 0.2 },
      { x: 4.5, z: 14.5, rotY: Math.PI / 2 },
      { x: -6.0, z: 12.0, rotY: 0.5 },
    ];
    for (let i = 0; i < benchPositions.length; i++) {
      const b = benchPositions[i];
      const benchGroup = new THREE.Group();
      benchGroup.name = `HachikoBench_${i}`;
      benchGroup.position.set(b.x, localTerrainDelta(b.x, b.z), b.z);
      benchGroup.rotation.y = b.rotY;

      const seat = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.08, 0.5), benchWoodMat);
      seat.position.set(0, 0.45, 0);
      seat.castShadow = true;
      benchGroup.add(seat);

      for (const lx of [-0.85, 0.85]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.46), benchLegMat);
        leg.position.set(lx, 0.225, 0);
        benchGroup.add(leg);
      }
      plazaGroup.add(benchGroup);
    }

    // 5. 広場LED照明灯（Plaza Warm LED Lampposts）
    const lampPoleMat = new THREE.MeshStandardMaterial({
      color: 0x383a3e,
      roughness: 0.35,
      metalness: 0.85,
    });
    const lampLightMat = new THREE.MeshStandardMaterial({
      color: 0xffedd5,
      emissive: new THREE.Color(0xffedd5),
      emissiveIntensity: this.isNightActive ? 2.2 : 0.2,
      roughness: 0.2,
    });
    this.shibuyaStreamEmissiveEntries.push({
      material: lampLightMat,
      dayIntensity: 0.2,
      nightIntensity: 2.2,
    });
    for (const [lx, lz] of [
      [-12.0, 4.0],
      [12.0, 12.0],
      [-12.0, 20.0],
    ]) {
      const baseDeltaY = localTerrainDelta(lx, lz);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 5.0, 8), lampPoleMat);
      pole.position.set(lx, baseDeltaY + 2.5, lz);
      pole.castShadow = true;
      plazaGroup.add(pole);

      const lampHead = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 12), lampLightMat);
      lampHead.name = "HachikoPlazaLamp";
      lampHead.position.set(lx, baseDeltaY + 5.0, lz);
      plazaGroup.add(lampHead);
    }

    // 6. JR渋谷駅 ハチ公改札口キャノピー（Station Entrance Canopy: 広場東端のJR側へ接地）
    const canopyMat = new THREE.MeshStandardMaterial({
      color: 0x36383c,
      roughness: 0.32,
      metalness: 0.6,
    });
    const canopyDeltaY = localTerrainDelta(13.0, 12.0);
    const canopyMesh = new THREE.Mesh(new THREE.BoxGeometry(10.0, 0.4, 5.0), canopyMat);
    canopyMesh.name = "ShibuyaStationHachikoEntranceCanopy";
    canopyMesh.position.set(13.0, canopyDeltaY + 4.2, 12.0);
    canopyMesh.castShadow = true;
    plazaGroup.add(canopyMesh);

    for (const [cx, cz] of [
      [8.5, 10.0],
      [8.5, 14.0],
      [17.5, 10.0],
      [17.5, 14.0],
    ]) {
      const colDeltaY = localTerrainDelta(cx, cz);
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 4.6, 8), lampPoleMat);
      pillar.position.set(cx, colDeltaY + 2.1, cz);
      pillar.castShadow = true;
      plazaGroup.add(pillar);
    }

    // 7. 渋谷駅前バスターミナル バス停シェルター（ハチ公口側 & 東口側）
    const busShelterHachiko = this.createShibuyaBusShelter(
      -972.5,
      318.0,
      0.28,
      "ShibuyaBusTerminalShelter_Hachiko",
      "渋谷駅ハチ公口 / Shibuya Sta. Hachiko",
      "渋05  渋11  渋21  渋34  都01",
      world,
      rapier,
      groundBody,
    );
    this.group.add(busShelterHachiko);

    const busShelterEastExit = this.createShibuyaBusShelter(
      -750.0,
      398.0,
      -2.55,
      "ShibuyaBusTerminalShelter_EastExit",
      "渋谷駅東口 / Shibuya Sta. East",
      "都01  都06  田87  学03",
      world,
      rapier,
      groundBody,
    );
    this.group.add(busShelterEastExit);

    this.group.add(plazaGroup);
  }

  /**
   * 渋谷駅前バスターミナル向けの近代的ガラス庇バス停シェルター＋路線案内ライトボックス＋ベンチ＋丸型標柱を生成する。
   */
  private createShibuyaBusShelter(
    x: number,
    z: number,
    rotY: number,
    name: string,
    stationLabel: string,
    routesText: string,
    world: RAPIER.World,
    rapier: typeof RAPIER,
    groundBody: RAPIER.RigidBody,
  ): THREE.Group {
    const shelterGroup = new THREE.Group();
    shelterGroup.name = name;
    shelterGroup.userData.isRoadInfrastructure = true;
    const baseY = sampleShibuyaTerrainY(x, z);
    shelterGroup.position.set(x, baseY, z);
    shelterGroup.rotation.y = rotY;

    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x2d3238,
      roughness: 0.36,
      metalness: 0.72,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xc8dff0,
      roughness: 0.14,
      metalness: 0.15,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
    });
    const benchWoodMat = new THREE.MeshStandardMaterial({
      color: 0x7c4a26,
      roughness: 0.64,
      metalness: 0.04,
    });

    // 支持柱（背面2本 + 接地スカート -0.6m）
    const postGeo = new THREE.BoxGeometry(0.11, 3.15, 0.11);
    for (const px of [-1.75, 1.15]) {
      const post = new THREE.Mesh(postGeo, frameMat);
      post.position.set(px, 0.975, -0.62);
      post.castShadow = true;
      shelterGroup.add(post);
    }

    // 片持ちガラス屋根庇＆スチール外枠
    const roofFrame = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.1, 1.85), frameMat);
    roofFrame.position.set(0, 2.58, 0.08);
    roofFrame.castShadow = true;
    shelterGroup.add(roofFrame);

    const roofGlass = new THREE.Mesh(new THREE.BoxGeometry(3.96, 0.06, 1.62), glassMat);
    roofGlass.position.set(0, 2.6, 0.08);
    shelterGroup.add(roofGlass);

    // 背面防風ガラスパネル
    const backGlass = new THREE.Mesh(new THREE.BoxGeometry(2.86, 1.95, 0.05), glassMat);
    backGlass.position.set(-0.3, 1.32, -0.62);
    shelterGroup.add(backGlass);

    // 路線時刻表ライトボックス（右袖）
    const boardHousing = new THREE.Mesh(new THREE.BoxGeometry(1.05, 2.15, 0.18), frameMat);
    boardHousing.position.set(1.5, 1.42, -0.58);
    boardHousing.castShadow = true;
    shelterGroup.add(boardHousing);

    const boardTex = this.createBusShelterBoardTexture(stationLabel, routesText);
    const boardFaceMat = new THREE.MeshStandardMaterial({
      color: boardTex ? 0xffffff : 0xe2e8f0,
      map: boardTex ?? undefined,
      emissive: new THREE.Color(boardTex ? 0xffffff : 0xf1f5f9),
      emissiveMap: boardTex ?? undefined,
      emissiveIntensity: this.isNightActive ? 0.95 : 0.25,
      roughness: 0.25,
      metalness: 0.08,
    });
    this.shibuyaStreamEmissiveEntries.push({
      material: boardFaceMat,
      dayIntensity: 0.25,
      nightIntensity: 0.95,
    });
    const boardFace = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 1.85), boardFaceMat);
    boardFace.position.set(1.5, 1.42, -0.485);
    shelterGroup.add(boardFace);

    // 待合木製スラットベンチ
    const benchSeat = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.07, 0.44), benchWoodMat);
    benchSeat.position.set(-0.35, 0.46, -0.25);
    benchSeat.castShadow = true;
    shelterGroup.add(benchSeat);
    for (const bx of [-1.05, 0.35]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.46, 0.4), frameMat);
      leg.position.set(bx, 0.23, -0.25);
      shelterGroup.add(leg);
    }

    // 丸型バス停ポール（東端前面）
    const poleMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 2.55, 8), frameMat);
    poleMesh.position.set(2.22, 1.25, 0.22);
    poleMesh.castShadow = true;
    shelterGroup.add(poleMesh);

    const discMat = new THREE.MeshStandardMaterial({
      color: 0x16a34a,
      emissive: new THREE.Color(0x064e3b),
      emissiveIntensity: this.isNightActive ? 0.5 : 0.12,
      roughness: 0.3,
    });
    const signDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.06, 16), discMat);
    signDisc.rotation.x = Math.PI / 2;
    signDisc.position.set(2.22, 2.25, 0.22);
    shelterGroup.add(signDisc);

    // 物理コライダー（車道外歩道上のシェルター占有域のみ）
    const shelterColDesc = rapier.ColliderDesc.cuboid(2.05, 1.32, 0.8)
      .setTranslation(x, baseY + 1.32, z)
      .setRotation({ x: 0, y: Math.sin(rotY / 2), z: 0, w: Math.cos(rotY / 2) })
      .setFriction(0.6)
      .setRestitution(0.05);
    this.registerCollider(world.createCollider(shelterColDesc, groundBody), false);

    return shelterGroup;
  }

  private createBusShelterBoardTexture(
    stationLabel: string,
    routesText: string,
  ): THREE.CanvasTexture | null {
    if (typeof document === "undefined") {
      return null;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#15803d";
    ctx.fillRect(0, 0, canvas.width, 82);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 20px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("TOEI / TOKYU BUS", canvas.width / 2, 34);
    ctx.font = "bold 16px sans-serif";
    ctx.fillText(stationLabel, canvas.width / 2, 64, canvas.width - 20);

    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 22px sans-serif";
    ctx.fillText(routesText, canvas.width / 2, 130, canvas.width - 24);
    ctx.fillStyle = "#334155";
    ctx.fillRect(18, 152, canvas.width - 36, 4);
    ctx.font = "15px sans-serif";
    ctx.textAlign = "left";
    for (let row = 0; row < 10; row++) {
      const y = 186 + row * 28;
      ctx.fillStyle = row % 2 === 0 ? "#e2e8f0" : "#f1f5f9";
      ctx.fillRect(18, y - 18, canvas.width - 36, 24);
      ctx.fillStyle = "#1e293b";
      ctx.fillText(`${7 + row} | 04  18  32  46  58`, 26, y);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  /**
   * 渋谷センター街（バスケットボール通り）インフラ
   * How: スクランブル交差点北西（`(-1024, 249)` 〜 宇田川町交番 `(-1155, 128)` 〜 東急本店前 `(-1325, 151.3)`）に、
   * 象徴的な入口アーチ看板「SHIBUYA CENTER-GAI バスケットボール通り」、地形追従インターロッキング舗装、
   * ストリートフラッグ、沿道商業テナントビル群（地形接地 + `-3.0m` スカート）を配置する。
   */
  private buildShibuyaCenterGaiInfrastructure(
    world: RAPIER.World,
    rapier: typeof RAPIER,
    groundBody: RAPIER.RigidBody,
  ): void {
    const centerGaiGroup = new THREE.Group();
    centerGaiGroup.name = "ShibuyaCenterGaiInfrastructure";
    centerGaiGroup.userData.isRoadInfrastructure = true;

    const corridors = getOpenDataCurvedRoadCorridors();
    const centerGaiCorridor = corridors.find(
      (corridor) => corridor.id === "nav-road-shibuya-center-gai",
    );
    const centerGaiPoints: ReadonlyArray<{ x: number; z: number }> = centerGaiCorridor?.points ?? [
      { x: -1024, z: 249 },
      { x: -1065, z: 212 },
      { x: -1110, z: 168 },
      { x: -1155, z: 128 },
      { x: -1240, z: 138 },
      { x: -1325, z: 151.3 },
    ];
    const centerGaiSpline = new THREE.CatmullRomCurve3(
      centerGaiPoints.map((pt) => new THREE.Vector3(pt.x, 0, pt.z)),
      false,
      "centripetal",
      0.5,
    );
    const streetLength = centerGaiSpline.getLength();
    const archU = 0.08;
    const archCenter = centerGaiSpline.getPointAt(archU);
    const archTangent = centerGaiSpline.getTangentAt(archU).normalize();
    const streetAngle = Math.atan2(archTangent.x, archTangent.z);
    const archBaseY = sampleShibuyaTerrainY(archCenter.x, archCenter.z);
    const pavementHalfWidth = 3.25;

    const totalSamples = Math.max(48, Math.ceil(streetLength / 2.5));
    const sampledFrames: Array<{
      pos: THREE.Vector3;
      normal: THREE.Vector3;
      arcLen: number;
    }> = [];
    let accArc = 0;
    for (let si = 0; si <= totalSamples; si++) {
      const u = si / totalSamples;
      const pos = centerGaiSpline.getPointAt(u);
      const tan = centerGaiSpline.getTangentAt(u).normalize();
      const normal = new THREE.Vector3(tan.z, 0, -tan.x).normalize();
      if (si > 0) {
        accArc += pos.distanceTo(sampledFrames[si - 1].pos);
      }
      sampledFrames.push({ pos, normal, arcLen: accArc });
    }

    const sampledTotalLen = sampledFrames[sampledFrames.length - 1]?.arcLen ?? streetLength;
    const kobanJunction = { x: -1155, z: 128, radius: 13.0 };
    const ribbonRuns: Array<typeof sampledFrames> = [];
    let currentRun: typeof sampledFrames = [];
    for (const frame of sampledFrames) {
      const distToKoban = Math.hypot(frame.pos.x - kobanJunction.x, frame.pos.z - kobanJunction.z);
      const isTrimmedEndpoint = frame.arcLen > sampledTotalLen - 14.0;
      const isInsideJunction = isTrimmedEndpoint || distToKoban < kobanJunction.radius;
      if (isInsideJunction) {
        if (currentRun.length >= 2) {
          ribbonRuns.push(currentRun);
        }
        currentRun = [];
        continue;
      }
      currentRun.push(frame);
    }
    if (currentRun.length >= 2) {
      ribbonRuns.push(currentRun);
    }

    const totalVertices = ribbonRuns.reduce((sum, run) => sum + run.length * 2, 0);
    const ribbonPositions = new Float32Array(totalVertices * 3);
    const ribbonNormals = new Float32Array(totalVertices * 3);
    const ribbonUvs = new Float32Array(totalVertices * 2);
    const ribbonIndices: number[] = [];

    let vertexCursor = 0;
    for (const run of ribbonRuns) {
      const runBaseVertex = vertexCursor;
      for (let ri = 0; ri < run.length; ri++) {
        const frame = run[ri];
        const leftX = frame.pos.x - frame.normal.x * pavementHalfWidth;
        const leftZ = frame.pos.z - frame.normal.z * pavementHalfWidth;
        const rightX = frame.pos.x + frame.normal.x * pavementHalfWidth;
        const rightZ = frame.pos.z + frame.normal.z * pavementHalfWidth;
        const leftY = sampleShibuyaTerrainY(leftX, leftZ);
        const rightY = sampleShibuyaTerrainY(rightX, rightZ);

        const pBase = vertexCursor * 3;
        ribbonPositions[pBase] = leftX;
        ribbonPositions[pBase + 1] = leftY;
        ribbonPositions[pBase + 2] = leftZ;
        ribbonPositions[pBase + 3] = rightX;
        ribbonPositions[pBase + 4] = rightY;
        ribbonPositions[pBase + 5] = rightZ;

        ribbonNormals[pBase] = 0;
        ribbonNormals[pBase + 1] = 1;
        ribbonNormals[pBase + 2] = 0;
        ribbonNormals[pBase + 3] = 0;
        ribbonNormals[pBase + 4] = 1;
        ribbonNormals[pBase + 5] = 0;

        const uvBase = vertexCursor * 2;
        const vCoord = frame.arcLen / 4.5;
        ribbonUvs[uvBase] = 0;
        ribbonUvs[uvBase + 1] = vCoord;
        ribbonUvs[uvBase + 2] = 2;
        ribbonUvs[uvBase + 3] = vCoord;

        if (ri < run.length - 1) {
          const a = runBaseVertex + ri * 2;
          const b = a + 1;
          const c = a + 2;
          const d = a + 3;
          ribbonIndices.push(a, c, b, c, d, b);
        }
        vertexCursor += 2;
      }
    }

    const pavementGeo = new THREE.BufferGeometry();
    pavementGeo.setAttribute("position", new THREE.BufferAttribute(ribbonPositions, 3));
    pavementGeo.setAttribute("normal", new THREE.BufferAttribute(ribbonNormals, 3));
    pavementGeo.setAttribute("uv", new THREE.BufferAttribute(ribbonUvs, 2));
    pavementGeo.setIndex(ribbonIndices);
    pavementGeo.computeVertexNormals();
    const pavementMat = new PuddleMaterial({
      baseColor: 0x78350f,
      baseRoughness: 0.68,
      baseMetalness: 0.06,
      puddleThreshold: 0.38,
    });
    this.puddleMaterials.push(pavementMat);

    const pavementMesh = new THREE.Mesh(pavementGeo, pavementMat);
    pavementMesh.name = "CenterGaiPedestrianPavement";
    pavementMesh.userData.isRoadInfrastructure = true;
    pavementMesh.position.set(0, 0.025, 0);
    pavementMesh.receiveShadow = true;
    centerGaiGroup.add(pavementMesh);

    // 2. 渋谷センター街 入口アーチ看板（Center Gai Main Entrance Arch）
    const archGroup = new THREE.Group();
    archGroup.name = "CenterGaiEntranceArchSign";
    archGroup.userData.isRoadInfrastructure = true;
    archGroup.position.set(archCenter.x, archBaseY, archCenter.z);
    archGroup.rotation.y = streetAngle;
    this.proceduralCenterGaiArchGroup = archGroup;

    const archSteelMat = new THREE.MeshStandardMaterial({
      color: 0x8c8a84,
      roughness: 0.38,
      metalness: 0.45,
    });

    const halfSpan = 5.4;
    for (const side of [-1, 1]) {
      const colX = side * halfSpan;
      const cosA = Math.cos(streetAngle);
      const sinA = Math.sin(streetAngle);
      const worldColX = archCenter.x + colX * cosA;
      const worldColZ = archCenter.z - colX * sinA;
      const colDeltaY = sampleShibuyaTerrainY(worldColX, worldColZ) - archBaseY;

      const colMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 7.8, 12), archSteelMat);
      colMesh.position.set(colX, colDeltaY + 3.9, 0);
      colMesh.castShadow = true;
      archGroup.add(colMesh);

      const baseMesh = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.8, 0.85), archSteelMat);
      baseMesh.position.set(colX, colDeltaY + 0.2, 0);
      baseMesh.castShadow = true;
      archGroup.add(baseMesh);

      const isColliderSafe =
        side === 1 && this.isPointClearOfRoadCorridors(worldColX, worldColZ, 0.35, corridors);
      if (isColliderSafe) {
        const pillarCol = world.createCollider(
          rapier.ColliderDesc.cylinder(3.9, 0.3).setTranslation(
            worldColX,
            archBaseY + colDeltaY + 3.9,
            worldColZ,
          ),
          groundBody,
        );
        this.registerCollider(pillarCol, true);
        this.proceduralGlbOverlappingColliders.push(pillarCol);
      }
    }

    const crossBeam = new THREE.Mesh(
      new THREE.BoxGeometry(halfSpan * 2 + 0.6, 0.55, 0.55),
      archSteelMat,
    );
    crossBeam.position.set(0, 7.4, 0);
    crossBeam.castShadow = true;
    archGroup.add(crossBeam);

    const procArchTex = this.createCenterGaiArchCanvasTexture(true);
    const hasProcArchTex = procArchTex !== null;
    const signBoardMat = new THREE.MeshStandardMaterial({
      color: hasProcArchTex ? 0xffffff : 0x1e3a8a,
      map: procArchTex ?? undefined,
      emissive: new THREE.Color(hasProcArchTex ? 0xffffff : 0x38bdf8),
      emissiveMap: procArchTex ?? undefined,
      emissiveIntensity: this.isNightActive ? 0.85 : 0.25,
      roughness: 0.24,
      metalness: 0.1,
    });
    this.shibuyaStreamEmissiveEntries.push({
      material: signBoardMat,
      dayIntensity: 0.25,
      nightIntensity: 0.85,
    });
    const signBoardMesh = new THREE.Mesh(new THREE.BoxGeometry(6.8, 1.35, 0.38), signBoardMat);
    signBoardMesh.name = "CenterGaiMainSignPanel";
    signBoardMesh.position.set(0, 6.7, 0);
    signBoardMesh.castShadow = true;
    archGroup.add(signBoardMesh);

    const signCrownMat = new THREE.MeshStandardMaterial({
      color: 0x3b82f6,
      emissive: new THREE.Color(0x2563eb),
      emissiveIntensity: this.isNightActive ? 1.05 : 0.25,
      roughness: 0.22,
    });
    this.shibuyaStreamEmissiveEntries.push({
      material: signCrownMat,
      dayIntensity: 0.25,
      nightIntensity: 1.05,
    });
    const signCrownMesh = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.25, 0.48), signCrownMat);
    signCrownMesh.position.set(0, 7.45, 0);
    archGroup.add(signCrownMesh);

    centerGaiGroup.add(archGroup);

    // 3. センター街ストリートフラッグ・バナー（Center Gai Street Banners）
    const procBannerTex = this.createCenterGaiBannerCanvasTexture(true);
    const hasProcBannerTex = procBannerTex !== null;
    const bannerMat = new THREE.MeshStandardMaterial({
      color: hasProcBannerTex ? 0xffffff : 0x2563eb,
      map: procBannerTex ?? undefined,
      emissive: new THREE.Color(hasProcBannerTex ? 0xffffff : 0x1d4ed8),
      emissiveMap: procBannerTex ?? undefined,
      emissiveIntensity: this.isNightActive ? 0.65 : 0.18,
      roughness: 0.55,
      side: THREE.DoubleSide,
    });
    this.shibuyaStreamEmissiveEntries.push({
      material: bannerMat,
      dayIntensity: 0.18,
      nightIntensity: 0.65,
    });
    const bannerDistances = [20.0, 48.0, 76.0, 108.0, 145.0];
    const bannerLateralOffset = 5.4;
    for (let bi = 0; bi < bannerDistances.length; bi++) {
      const u = Math.min(0.98, bannerDistances[bi] / streetLength);
      const pt = centerGaiSpline.getPointAt(u);
      const tan = centerGaiSpline.getTangentAt(u).normalize();
      const segAngle = Math.atan2(tan.x, tan.z);
      const cosA = Math.cos(segAngle);
      const sinA = Math.sin(segAngle);

      for (const side of [-1, 1]) {
        const poleX = pt.x + side * bannerLateralOffset * cosA;
        const poleZ = pt.z - side * bannerLateralOffset * sinA;
        const poleGroundY = sampleShibuyaTerrainY(poleX, poleZ);

        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 4.8, 8), archSteelMat);
        pole.position.set(poleX, poleGroundY + 2.4, poleZ);
        centerGaiGroup.add(pole);

        const bannerMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 1.8), bannerMat);
        bannerMesh.name = `CenterGaiStreetBanner_${bi}_${side}`;
        bannerMesh.position.set(poleX, poleGroundY + 3.6, poleZ);
        bannerMesh.rotation.y = segAngle + (side > 0 ? 0 : Math.PI);
        centerGaiGroup.add(bannerMesh);
      }
    }

    // 4. センター街 沿道商業テナントビル群（全道路車道から >= 9m 離隔、地形標高 + -3m スカート接地）
    const commTex = shibuyaTextureManager.getTexture("commercialFacade");
    const storefrontFacadeTex = shibuyaTextureManager.getTexture("plateauLod2Storefront");

    const buildingMat1 = new THREE.MeshStandardMaterial({
      map: commTex,
      emissiveMap: commTex,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: this.isNightActive ? 1.45 : 0.25,
      roughness: 0.35,
      metalness: 0.2,
    });
    const buildingMat2 = new THREE.MeshStandardMaterial({
      map: storefrontFacadeTex,
      emissiveMap: storefrontFacadeTex,
      emissive: new THREE.Color(0xfff4db),
      emissiveIntensity: this.isNightActive ? 1.35 : 0.22,
      roughness: 0.36,
      metalness: 0.18,
    });
    this.shibuyaStreamEmissiveEntries.push(
      { material: buildingMat1, dayIntensity: 0.25, nightIntensity: 1.45 },
      { material: buildingMat2, dayIntensity: 0.22, nightIntensity: 1.35 },
    );
    this.applyArchitecture3DTexture(buildingMat1, "retail_storefront");
    this.applyArchitecture3DTexture(buildingMat2, "retail_storefront");

    const roofMat = shibuyaTextureManager.createPlateauLod2RoofMaterial(this.isNightActive);
    this.shibuyaStreamEmissiveEntries.push({
      material: roofMat,
      dayIntensity: 0.02,
      nightIntensity: 0.08,
    });

    const buildingConfigs: Array<{
      w: number;
      d: number;
      h: number;
      mat: THREE.MeshStandardMaterial;
      name: string;
      center: { x: number; z: number; rotY: number };
    }> = [
      {
        w: 9.0,
        d: 10.5,
        h: 28.0,
        mat: buildingMat1,
        name: "CenterGaiCommercialBuilding_North_1",
        center: { x: -1050.8, z: 205.6, rotY: -2.32 },
      },
      {
        w: 10.0,
        d: 11.0,
        h: 36.0,
        mat: buildingMat2,
        name: "CenterGaiCommercialBuilding_North_2",
        center: { x: -1083.1, z: 173.9, rotY: -2.35 },
      },
      {
        w: 11.0,
        d: 11.5,
        h: 32.0,
        mat: buildingMat1,
        name: "CenterGaiCommercialBuilding_North_3",
        center: { x: -1196.2, z: 113.8, rotY: -1.39 },
      },
      {
        w: 10.0,
        d: 11.0,
        h: 26.0,
        mat: buildingMat2,
        name: "CenterGaiCommercialBuilding_South_1",
        center: { x: -1070.5, z: 226.7, rotY: -2.32 },
      },
      {
        w: 10.5,
        d: 11.0,
        h: 34.0,
        mat: buildingMat1,
        name: "CenterGaiCommercialBuilding_South_2",
        center: { x: -1103.7, z: 194.7, rotY: -2.35 },
      },
      {
        w: 11.5,
        d: 11.5,
        h: 30.0,
        mat: buildingMat2,
        name: "CenterGaiCommercialBuilding_South_3",
        center: { x: -1246.4, z: 154.3, rotY: -1.43 },
      },
    ];

    const skirtDepth = 3.0;
    for (const bConf of buildingConfigs) {
      const bCenterX = bConf.center.x;
      const bCenterZ = bConf.center.z;
      const bRotY = bConf.center.rotY;
      const bTerrainY = sampleShibuyaTerrainY(bCenterX, bCenterZ);
      const totalH = bConf.h + skirtDepth;
      const bMidY = bTerrainY - skirtDepth + totalH * 0.5;

      const boxGeo = new THREE.BoxGeometry(bConf.w, totalH, bConf.d);
      const uvAttr = boxGeo.getAttribute("uv");
      if (uvAttr) {
        const verticalRepeats = Math.max(1, Math.round(totalH / 14.0));
        for (let vi = 0; vi < uvAttr.count; vi++) {
          if (vi < 8 || vi >= 16) {
            uvAttr.setY(vi, uvAttr.getY(vi) * verticalRepeats);
          }
        }
        uvAttr.needsUpdate = true;
      }

      const bMesh = new THREE.Mesh(boxGeo, [
        bConf.mat,
        bConf.mat,
        roofMat,
        roofMat,
        bConf.mat,
        bConf.mat,
      ]);
      bMesh.name = bConf.name;
      bMesh.position.set(bCenterX, bMidY, bCenterZ);
      bMesh.rotation.y = bRotY;
      bMesh.castShadow = true;
      bMesh.receiveShadow = true;
      centerGaiGroup.add(bMesh);

      const bColDesc = rapier.ColliderDesc.cuboid(bConf.w / 2, totalH / 2, bConf.d / 2)
        .setTranslation(bCenterX, bMidY, bCenterZ)
        .setRotation({ x: 0, y: Math.sin(bRotY / 2), z: 0, w: Math.cos(bRotY / 2) })
        .setFriction(0.65)
        .setRestitution(0.01);
      this.registerCollider(world.createCollider(bColDesc, groundBody), false);

      this.attachStreetFacingAwningAndSign({
        parent: centerGaiGroup,
        offsetX: bCenterX,
        offsetZ: bCenterZ,
        worldX: bCenterX,
        worldZ: bCenterZ,
        terrainY: bTerrainY,
        w: bConf.w,
        d: bConf.d,
        h: bConf.h,
        rotY: bRotY,
        streetPts: centerGaiSpline.getPoints(80),
        index: buildingConfigs.indexOf(bConf),
        awningNamePrefix: "CenterGaiStoreAwning",
        sodeNamePrefix: "CenterGaiSodeKanban",
      });
    }

    this.group.add(centerGaiGroup);
  }

  /**
   * 公園通り（北北西）・道玄坂（南西）・宮益坂（東北東）沿道の商業街区舗装と沿道ビル群を構築する。
   * How: 1:1 非反転 WGS84 実座標（公園通り `z = 11..181`、道玄坂 `x = -1220..-1404`、
   * 宮益坂 `x = -764..-476`）に沿って全道路車道から安全離隔を保って配置し、地形追従舗装と `-3.0m` スカートで傾斜接地する。
   */
  private buildShibuyaStreetscapeFillInfrastructure(
    world: RAPIER.World,
    rapier: typeof RAPIER,
    groundBody: RAPIER.RigidBody,
  ): void {
    const commTex = shibuyaTextureManager.getTexture("commercialFacade");
    const storefrontTex = shibuyaTextureManager.getTexture("plateauLod2Storefront");
    const facadeTex = shibuyaTextureManager.getTexture("plateauLod2Facade");
    const roofMat = shibuyaTextureManager.createPlateauLod2RoofMaterial(this.isNightActive);
    const plazaMat = new THREE.MeshStandardMaterial({
      color: 0x9c9a92,
      roughness: 0.76,
      metalness: 0.04,
    });
    this.applyArchitecture3DTexture(plazaMat, "white_granite");
    this.shibuyaStreamEmissiveEntries.push({
      material: roofMat,
      dayIntensity: 0.02,
      nightIntensity: 0.08,
    });

    const createTiledWallMat = (
      baseTex: THREE.Texture,
      w: number,
      h: number,
      emissiveHex: number,
    ): THREE.MeshStandardMaterial => {
      const cloned = baseTex.clone();
      cloned.needsUpdate = true;
      cloned.repeat.set(Math.max(1, Math.round(w / 14)), Math.max(1, Math.round(h / 14)));
      const mat = new THREE.MeshStandardMaterial({
        map: cloned,
        emissiveMap: cloned,
        emissive: new THREE.Color(emissiveHex),
        emissiveIntensity: this.isNightActive ? 1.2 : 0.16,
        roughness: 0.36,
        metalness: 0.18,
      });
      this.shibuyaStreamEmissiveEntries.push({
        material: mat,
        dayIntensity: 0.16,
        nightIntensity: 1.2,
      });
      this.applyArchitecture3DTexture(mat, "retail_storefront");
      return mat;
    };

    const districtSpecs: Array<{
      groupName: string;
      anchor: { x: number; z: number };
      aprons: Array<{ x: number; z: number; w: number; d: number; rotY: number }>;
      buildings: Array<{
        name: string;
        x: number;
        z: number;
        w: number;
        d: number;
        h: number;
        rotY: number;
        style: "commercial" | "storefront" | "facade";
      }>;
    }> = [
      {
        groupName: "ShibuyaKoenDoriStreetscapeGroup",
        anchor: { x: -990, z: 105 },
        aprons: [
          { x: -963.5, z: 162.0, w: 18.0, d: 48.0, rotY: 2.94 },
          { x: -1012.0, z: 54.0, w: 18.0, d: 92.0, rotY: 2.6 },
          { x: -1003.0, z: 181.0, w: 18.0, d: 24.0, rotY: 3.01 },
          { x: -1028.0, z: 104.0, w: 18.0, d: 20.0, rotY: 2.67 },
        ],
        buildings: [
          {
            name: "KoenEast_MaruiSouth",
            x: -962.0,
            z: 176.0,
            w: 13.0,
            d: 18.0,
            h: 34.0,
            rotY: 3.01,
            style: "commercial",
          },
          {
            name: "KoenEast_MaruiNorth",
            x: -965.0,
            z: 148.0,
            w: 13.0,
            d: 16.0,
            h: 38.0,
            rotY: 2.85,
            style: "facade",
          },
          {
            name: "KoenEast_ModiSouth",
            x: -991.0,
            z: 88.0,
            w: 13.0,
            d: 18.0,
            h: 34.0,
            rotY: 2.67,
            style: "storefront",
          },
          {
            name: "KoenEast_ModiNorth",
            x: -1039.0,
            z: 11.0,
            w: 13.0,
            d: 20.0,
            h: 42.0,
            rotY: 2.53,
            style: "commercial",
          },
          {
            name: "KoenWest_SeibuB",
            x: -1003.0,
            z: 181.0,
            w: 14.0,
            d: 18.0,
            h: 34.0,
            rotY: 3.01,
            style: "facade",
          },
          {
            name: "KoenWest_SeibuA",
            x: -1028.0,
            z: 104.0,
            w: 14.0,
            d: 14.0,
            h: 30.0,
            rotY: 2.67,
            style: "storefront",
          },
        ],
      },
      {
        groupName: "ShibuyaDogenzakaStreetscapeGroup",
        anchor: { x: -1300, z: 410 },
        aprons: [
          { x: -1234.0, z: 356.0, w: 20.0, d: 44.0, rotY: 0.9 },
          { x: -1318.0, z: 460.0, w: 20.0, d: 86.0, rotY: 0.62 },
          { x: -1274.0, z: 339.0, w: 18.0, d: 72.0, rotY: 0.87 },
          { x: -1382.0, z: 474.0, w: 20.0, d: 88.0, rotY: 0.5 },
        ],
        buildings: [
          {
            name: "DogenzakaSouth_CornerBlock",
            x: -1220.0,
            z: 344.0,
            w: 15.0,
            d: 12.0,
            h: 26.0,
            rotY: 0.96,
            style: "storefront",
          },
          {
            name: "DogenzakaSouth_EastCommercial",
            x: -1248.0,
            z: 368.0,
            w: 16.0,
            d: 12.0,
            h: 26.0,
            rotY: 0.86,
            style: "commercial",
          },
          {
            name: "DogenzakaSouth_UniqloBlock",
            x: -1278.0,
            z: 395.0,
            w: 15.0,
            d: 12.0,
            h: 30.0,
            rotY: 0.78,
            style: "storefront",
          },
          {
            name: "DogenzakaSouth_UpperCommercial",
            x: -1366.0,
            z: 534.0,
            w: 15.0,
            d: 12.0,
            h: 28.0,
            rotY: 0.46,
            style: "commercial",
          },
          {
            name: "DogenzakaNorth_109West1",
            x: -1242.0,
            z: 312.0,
            w: 14.0,
            d: 10.0,
            h: 24.0,
            rotY: 0.96,
            style: "storefront",
          },
          {
            name: "DogenzakaNorth_109West2",
            x: -1307.0,
            z: 366.0,
            w: 15.0,
            d: 11.0,
            h: 28.0,
            rotY: 0.78,
            style: "commercial",
          },
          {
            name: "DogenzakaSouth_MidTower",
            x: -1360.0,
            z: 434.0,
            w: 15.0,
            d: 11.0,
            h: 34.0,
            rotY: 0.54,
            style: "facade",
          },
          {
            name: "DogenzakaNorth_UpperWest",
            x: -1404.0,
            z: 514.0,
            w: 16.0,
            d: 11.0,
            h: 26.0,
            rotY: 0.46,
            style: "facade",
          },
        ],
      },
      {
        groupName: "ShibuyaMiyamasuzakaStreetscapeGroup",
        anchor: { x: -640, z: 220 },
        aprons: [
          { x: -760.0, z: 260.0, w: 26.0, d: 16.0, rotY: -1.73 },
          { x: -600.0, z: 234.0, w: 120.0, d: 16.0, rotY: -1.74 },
          { x: -645.0, z: 194.0, w: 130.0, d: 16.0, rotY: -1.73 },
        ],
        buildings: [
          {
            name: "MiyamasuSouth_WestBlock",
            x: -760.0,
            z: 260.0,
            w: 22.0,
            d: 13.0,
            h: 36.0,
            rotY: -1.73,
            style: "facade",
          },
          {
            name: "MiyamasuSouth_PostOfficeBlock",
            x: -655.0,
            z: 242.0,
            w: 24.0,
            d: 13.0,
            h: 34.0,
            rotY: -1.74,
            style: "storefront",
          },
          {
            name: "MiyamasuSouth_MidTower",
            x: -598.0,
            z: 232.0,
            w: 24.0,
            d: 13.0,
            h: 38.0,
            rotY: -1.74,
            style: "commercial",
          },
          {
            name: "MiyamasuSouth_EastTower",
            x: -546.0,
            z: 227.0,
            w: 24.0,
            d: 13.0,
            h: 42.0,
            rotY: -1.71,
            style: "facade",
          },
          {
            name: "MiyamasuNorth_WestBlock",
            x: -764.0,
            z: 212.0,
            w: 22.0,
            d: 13.0,
            h: 34.0,
            rotY: -1.73,
            style: "storefront",
          },
          {
            name: "MiyamasuNorth_MidBlock",
            x: -660.0,
            z: 198.0,
            w: 20.0,
            d: 12.0,
            h: 38.0,
            rotY: -1.74,
            style: "facade",
          },
          {
            name: "MiyamasuNorth_UpperBlock",
            x: -554.0,
            z: 178.0,
            w: 22.0,
            d: 13.0,
            h: 36.0,
            rotY: -1.71,
            style: "commercial",
          },
          {
            name: "MiyamasuNorth_AoyamaGate",
            x: -476.0,
            z: 136.0,
            w: 22.0,
            d: 13.0,
            h: 44.0,
            rotY: -2.24,
            style: "facade",
          },
        ],
      },
      {
        groupName: "ShibuyaKonnozakaStreetscapeGroup",
        anchor: { x: -585, z: 310 },
        aprons: [
          { x: -610.0, z: 314.0, w: 18.0, d: 92.0, rotY: 2.52 },
          { x: -555.0, z: 318.0, w: 18.0, d: 92.0, rotY: 2.52 },
        ],
        buildings: [
          {
            name: "KonnozakaNorth_1",
            x: -651.0,
            z: 358.0,
            w: 13.0,
            d: 20.0,
            h: 34.0,
            rotY: 2.34,
            style: "storefront",
          },
          {
            name: "KonnozakaNorth_2",
            x: -610.1,
            z: 312.6,
            w: 13.0,
            d: 20.0,
            h: 38.0,
            rotY: 2.53,
            style: "commercial",
          },
          {
            name: "KonnozakaNorth_3",
            x: -572.0,
            z: 256.1,
            w: 13.0,
            d: 20.0,
            h: 36.0,
            rotY: 2.55,
            style: "facade",
          },
          {
            name: "KonnozakaSouth_1",
            x: -577.0,
            z: 352.0,
            w: 13.0,
            d: 20.0,
            h: 32.0,
            rotY: 2.5,
            style: "storefront",
          },
          {
            name: "KonnozakaSouth_2",
            x: -530.7,
            z: 284.0,
            w: 13.0,
            d: 20.0,
            h: 40.0,
            rotY: 2.55,
            style: "commercial",
          },
        ],
      },
      {
        groupName: "ShibuyaBunkamuraStreetscapeGroup",
        anchor: { x: -1300, z: 165 },
        aprons: [
          { x: -1260.0, z: 206.0, w: 18.0, d: 96.0, rotY: -2.06 },
          { x: -1360.0, z: 112.0, w: 18.0, d: 96.0, rotY: -2.18 },
        ],
        buildings: [
          {
            name: "BunkamuraSouth_1",
            x: -1220.4,
            z: 223.6,
            w: 13.0,
            d: 18.0,
            h: 28.0,
            rotY: -2.03,
            style: "commercial",
          },
          {
            name: "BunkamuraSouth_2",
            x: -1297.9,
            z: 187.7,
            w: 13.0,
            d: 18.0,
            h: 32.0,
            rotY: -2.07,
            style: "storefront",
          },
          {
            name: "BunkamuraSouth_3",
            x: -1370.9,
            z: 140.1,
            w: 13.0,
            d: 18.0,
            h: 30.0,
            rotY: -2.21,
            style: "facade",
          },
          {
            name: "BunkamuraNorth_1",
            x: -1188.1,
            z: 201.9,
            w: 13.0,
            d: 18.0,
            h: 28.0,
            rotY: -2.33,
            style: "storefront",
          },
          {
            name: "BunkamuraNorth_2",
            x: -1343.5,
            z: 115.4,
            w: 13.0,
            d: 18.0,
            h: 34.0,
            rotY: -2.22,
            style: "commercial",
          },
          {
            name: "BunkamuraNorth_3",
            x: -1399.2,
            z: 80.2,
            w: 13.0,
            d: 18.0,
            h: 26.0,
            rotY: -2.09,
            style: "storefront",
          },
        ],
      },
    ];

    const corridorIdByGroupName: Record<string, string> = {
      ShibuyaKoenDoriStreetscapeGroup: "nav-road-shibuya-koen-dori",
      ShibuyaDogenzakaStreetscapeGroup: "nav-road-shibuya-dogenzaka",
      ShibuyaMiyamasuzakaStreetscapeGroup: "nav-road-shibuya-miyamasuzaka",
      ShibuyaKonnozakaStreetscapeGroup: "nav-road-route246",
      ShibuyaBunkamuraStreetscapeGroup: "nav-road-shibuya-bunkamura-dori",
    };
    const allCorridors = getOpenDataCurvedRoadCorridors();
    const streetPtsByGroupName = new Map<string, Array<{ x: number; z: number }>>();
    for (const [groupName, cid] of Object.entries(corridorIdByGroupName)) {
      const cor = allCorridors.find((c) => c.id === cid);
      if (cor) {
        const curve = new THREE.CatmullRomCurve3(
          cor.points.map((pt) => new THREE.Vector3(pt.x, 0, pt.z)),
          false,
          "catmullrom",
          0.35,
        );
        streetPtsByGroupName.set(
          groupName,
          curve.getPoints(80).map((v) => ({ x: v.x, z: v.z })),
        );
      }
    }

    const skirtDepth = 3.0;
    let retailAttachIdx = 0;
    for (const district of districtSpecs) {
      const distGroup = new THREE.Group();
      distGroup.name = district.groupName;
      distGroup.position.set(district.anchor.x, 0, district.anchor.z);
      distGroup.userData.isLargeStructure = true;
      distGroup.userData.maxLodDrawDistance = 750;

      for (const ap of district.aprons) {
        const apGeo = new THREE.PlaneGeometry(ap.w, ap.d, 6, 4);
        apGeo.rotateX(-Math.PI / 2);
        const cosR = Math.cos(ap.rotY);
        const sinR = Math.sin(ap.rotY);
        const apPos = apGeo.getAttribute("position");
        if (apPos) {
          for (let vi = 0; vi < apPos.count; vi++) {
            const lx = apPos.getX(vi);
            const lz = apPos.getZ(vi);
            const wx = ap.x + lx * cosR + lz * sinR;
            const wz = ap.z - lx * sinR + lz * cosR;
            apPos.setY(vi, sampleShibuyaTerrainY(wx, wz) + 0.015);
          }
          apPos.needsUpdate = true;
          apGeo.computeVertexNormals();
        }
        const apMesh = new THREE.Mesh(apGeo, plazaMat);
        apMesh.position.set(ap.x - district.anchor.x, 0, ap.z - district.anchor.z);
        apMesh.rotation.y = ap.rotY;
        apMesh.receiveShadow = true;
        distGroup.add(apMesh);
      }

      const streetPts = streetPtsByGroupName.get(district.groupName) ?? [];
      for (const b of district.buildings) {
        const terrainY = sampleShibuyaTerrainY(b.x, b.z);
        const totalH = b.h + skirtDepth;
        const midY = terrainY - skirtDepth + totalH * 0.5;
        const texChoice =
          b.style === "commercial" ? commTex : b.style === "storefront" ? storefrontTex : facadeTex;
        const wallMatX = createTiledWallMat(texChoice, b.d, totalH, 0xfff8e7);
        const wallMatZ = createTiledWallMat(texChoice, b.w, totalH, 0xfff8e7);
        const boxGeo = new THREE.BoxGeometry(b.w, totalH, b.d);
        const bMesh = new THREE.Mesh(boxGeo, [
          wallMatX,
          wallMatX,
          roofMat,
          roofMat,
          wallMatZ,
          wallMatZ,
        ]);
        bMesh.name = b.name;
        bMesh.position.set(b.x - district.anchor.x, midY, b.z - district.anchor.z);
        bMesh.rotation.y = b.rotY;
        bMesh.castShadow = true;
        bMesh.receiveShadow = true;
        distGroup.add(bMesh);

        const bColDesc = rapier.ColliderDesc.cuboid(b.w / 2, totalH / 2, b.d / 2)
          .setTranslation(b.x, midY, b.z)
          .setRotation({ x: 0, y: Math.sin(b.rotY / 2), z: 0, w: Math.cos(b.rotY / 2) })
          .setFriction(0.65)
          .setRestitution(0.01);
        this.registerCollider(world.createCollider(bColDesc, groundBody), false);

        const isRetailBuilding = b.style === "commercial" || b.style === "storefront";
        if (isRetailBuilding && streetPts.length > 0) {
          this.attachStreetFacingAwningAndSign({
            parent: distGroup,
            offsetX: b.x - district.anchor.x,
            offsetZ: b.z - district.anchor.z,
            worldX: b.x,
            worldZ: b.z,
            terrainY,
            w: b.w,
            d: b.d,
            h: b.h,
            rotY: b.rotY,
            streetPts,
            index: retailAttachIdx++,
            awningNamePrefix: "ShibuyaStorefrontAwning",
            sodeNamePrefix: "ShibuyaSodeKanban",
          });
        }
      }

      this.group.add(distGroup);
    }
  }

  private sodeKanbanMatCache: THREE.MeshStandardMaterial[] | null = null;
  private storeAwningMatCache: THREE.MeshStandardMaterial[] | null = null;

  /**
   * 商業・店舗ビルの道路側前面壁を自動判定し、1F 庇（地上 3.45m）と縦型袖看板（地上 7.6〜11.3m）を付与する。
   */
  private attachStreetFacingAwningAndSign(params: {
    parent: THREE.Group;
    offsetX: number;
    offsetZ: number;
    worldX: number;
    worldZ: number;
    terrainY: number;
    w: number;
    d: number;
    h: number;
    rotY: number;
    streetPts: Array<{ x: number; z: number }>;
    index: number;
    awningNamePrefix: string;
    sodeNamePrefix: string;
  }): void {
    const {
      parent,
      offsetX,
      offsetZ,
      worldX,
      worldZ,
      terrainY,
      w,
      d,
      h,
      rotY,
      streetPts,
      index,
      awningNamePrefix,
      sodeNamePrefix,
    } = params;
    if (streetPts.length === 0) {
      return;
    }

    const cosR = Math.cos(rotY);
    const sinR = Math.sin(rotY);
    const candidateFaces: Array<{ lx: number; lz: number; span: number; localRotY: number }> = [
      { lx: 0, lz: d * 0.5, span: w, localRotY: 0 },
      { lx: 0, lz: -d * 0.5, span: w, localRotY: Math.PI },
      { lx: w * 0.5, lz: 0, span: d, localRotY: Math.PI * 0.5 },
      { lx: -w * 0.5, lz: 0, span: d, localRotY: -Math.PI * 0.5 },
    ];

    let bestFace = candidateFaces[0];
    let bestFaceOffsetX = 0;
    let bestFaceOffsetZ = 0;
    let minStreetDistSq = Infinity;
    for (const face of candidateFaces) {
      const rx = face.lx * cosR + face.lz * sinR;
      const rz = -face.lx * sinR + face.lz * cosR;
      const fx = worldX + rx;
      const fz = worldZ + rz;
      for (const pt of streetPts) {
        const dSq = (fx - pt.x) ** 2 + (fz - pt.z) ** 2;
        if (dSq < minStreetDistSq) {
          minStreetDistSq = dSq;
          bestFace = face;
          bestFaceOffsetX = rx;
          bestFaceOffsetZ = rz;
        }
      }
    }

    if (!this.storeAwningMatCache) {
      this.storeAwningMatCache = [0x9a3412, 0x1e3a5f, 0x3f3f46, 0x166534, 0x78716c].map(
        (hex) =>
          new THREE.MeshStandardMaterial({
            color: hex,
            roughness: 0.72,
            metalness: 0.08,
          }),
      );
    }
    if (!this.sodeKanbanMatCache) {
      const presets: Array<[string, string, string]> = [
        ["珈琲 CAFE", "ROASTERY", "#1f2937"],
        ["居酒屋", "DINING", "#991b1b"],
        ["薬局", "DRUG", "#0f766e"],
        ["書店", "BOOKS", "#1e3a8a"],
        ["洋品", "FASHION", "#4c1d95"],
        ["パン", "BAKERY", "#9a3412"],
      ];
      this.sodeKanbanMatCache = presets.map(([ja, en, bg]) => {
        const tex = this.createShibuyaSodeKanbanTexture(ja, en, bg);
        const dayInt = 0.2;
        const nightInt = 1.05;
        const mat = new THREE.MeshStandardMaterial({
          color: tex ? 0xffffff : bg,
          map: tex ?? undefined,
          emissive: new THREE.Color(tex ? 0xffffff : bg),
          emissiveMap: tex ?? undefined,
          emissiveIntensity: this.isNightActive ? nightInt : dayInt,
          roughness: 0.34,
          metalness: 0.14,
        });
        this.shibuyaStreamEmissiveEntries.push({
          material: mat,
          dayIntensity: dayInt,
          nightIntensity: nightInt,
        });
        return mat;
      });
    }

    const bracketMat = new THREE.MeshStandardMaterial({
      color: 0x27272a,
      roughness: 0.45,
      metalness: 0.7,
    });
    const awningMat = this.storeAwningMatCache[index % this.storeAwningMatCache.length];
    const sodeSignMat = this.sodeKanbanMatCache[index % this.sodeKanbanMatCache.length];
    const faceWorldRotY = rotY + bestFace.localRotY;

    const awningW = Math.max(3.6, Math.min(11.0, bestFace.span * 0.72));
    const attachGroup = new THREE.Group();
    attachGroup.name = `${awningNamePrefix}_Group_${index}`;
    attachGroup.position.set(offsetX + bestFaceOffsetX, terrainY, offsetZ + bestFaceOffsetZ);
    attachGroup.rotation.y = faceWorldRotY;

    const awningSlant = new THREE.Mesh(new THREE.BoxGeometry(awningW, 0.14, 0.76), awningMat);
    awningSlant.name = `${awningNamePrefix}_${index}`;
    awningSlant.position.set(0, 3.45, 0.38);
    awningSlant.rotation.x = 0.24;
    awningSlant.castShadow = true;
    attachGroup.add(awningSlant);

    const awningValance = new THREE.Mesh(new THREE.BoxGeometry(awningW, 0.22, 0.05), awningMat);
    awningValance.name = `${awningNamePrefix}_Valance_${index}`;
    awningValance.position.set(0, 3.28, 0.74);
    attachGroup.add(awningValance);

    const sodeSideSign = index % 2 === 0 ? 1 : -1;
    const sodeX = sodeSideSign * Math.min(bestFace.span * 0.34, awningW * 0.48);
    const sodeY = Math.min(h - 2.4, 7.6 + (index % 3) * 1.85);
    for (const dy of [-1.25, 1.25]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.3), bracketMat);
      arm.position.set(sodeX, sodeY + dy, 0.15);
      attachGroup.add(arm);
    }

    const sodeBlade = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.5, 0.78), [
      sodeSignMat,
      sodeSignMat,
      bracketMat,
      bracketMat,
      bracketMat,
      bracketMat,
    ]);
    sodeBlade.name = `${sodeNamePrefix}_${index}`;
    sodeBlade.position.set(sodeX, sodeY, 0.56);
    sodeBlade.castShadow = true;
    attachGroup.add(sodeBlade);

    parent.add(attachGroup);
  }

  private createShibuyaSodeKanbanTexture(
    labelJa: string,
    labelEn: string,
    accentHex: string,
  ): THREE.CanvasTexture | null {
    if (typeof document === "undefined") {
      return null;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }
    ctx.fillStyle = accentHex;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#f8fafc";
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.font = "bold 46px sans-serif";
    const chars = Array.from(labelJa);
    const startY = 82;
    const stepY = Math.min(62, Math.floor(290 / Math.max(1, chars.length)));
    for (let i = 0; i < chars.length; i++) {
      ctx.fillText(chars[i], canvas.width / 2, startY + i * stepY);
    }

    ctx.fillStyle = "#fde68a";
    ctx.font = "bold 20px sans-serif";
    ctx.fillText(labelEn, canvas.width / 2, canvas.height - 42, canvas.width - 20);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  private jrGuardTextureCache = new Map<string, THREE.CanvasTexture>();

  private createJrGuardZebraTexture(): THREE.CanvasTexture | null {
    const isDocUndefined = typeof document === "undefined";
    if (isDocUndefined) {
      return null;
    }
    const cached = this.jrGuardTextureCache.get("zebra");
    const hasCached = Boolean(cached);
    if (hasCached) {
      return cached!;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    const hasCtx = Boolean(ctx);
    if (!hasCtx) {
      return null;
    }
    // 黄色と黒の斜め45度警戒縞
    ctx!.fillStyle = "#facc15";
    ctx!.fillRect(0, 0, canvas.width, canvas.height);
    ctx!.fillStyle = "#18181b";
    const stripeWidth = 32;
    for (let x = -canvas.height; x < canvas.width + canvas.height; x += stripeWidth * 2) {
      ctx!.beginPath();
      ctx!.moveTo(x, 0);
      ctx!.lineTo(x + stripeWidth, 0);
      ctx!.lineTo(x + stripeWidth - canvas.height, canvas.height);
      ctx!.lineTo(x - canvas.height, canvas.height);
      ctx!.closePath();
      ctx!.fill();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.repeat.set(4, 1);
    this.jrGuardTextureCache.set("zebra", tex);
    return tex;
  }

  private createJrGuardStationSignTexture(): THREE.CanvasTexture | null {
    const isDocUndefined = typeof document === "undefined";
    if (isDocUndefined) {
      return null;
    }
    const cached = this.jrGuardTextureCache.get("stationSign");
    if (cached) {
      return cached;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 768;
    canvas.height = 160;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }
    // JR東日本カラー基調（山手線ウグイス＋白帯＋紺文字）
    ctx.fillStyle = "#166534";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#84cc16";
    ctx.fillRect(0, 128, canvas.width, 32);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = 'bold 48px "Hiragino Sans", "Yu Gothic", sans-serif';
    ctx.fillText("JR 渋谷駅  SHIBUYA STA.", canvas.width / 2, 56, canvas.width - 72);
    ctx.fillStyle = "#fef08a";
    ctx.font = 'bold 24px "Hiragino Sans", "Yu Gothic", sans-serif';
    ctx.fillText(
      "山手線・埼京線・湘南新宿ライン   SHIBUYA",
      canvas.width / 2,
      106,
      canvas.width - 72,
    );

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.jrGuardTextureCache.set("stationSign", tex);
    return tex;
  }

  private createJrGuardClearanceTexture(): THREE.CanvasTexture | null {
    const isDocUndefined = typeof document === "undefined";
    if (isDocUndefined) {
      return null;
    }
    const cached = this.jrGuardTextureCache.get("clearance");
    const hasCached = Boolean(cached);
    if (hasCached) {
      return cached!;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    const hasCtx = Boolean(ctx);
    if (!hasCtx) {
      return null;
    }
    // 白背景 + 赤と黄色の縁取り + 制限高 4.5M / CLEARANCE 4.5m
    ctx!.fillStyle = "#ffffff";
    ctx!.fillRect(0, 0, canvas.width, canvas.height);
    ctx!.strokeStyle = "#dc2626";
    ctx!.lineWidth = 8;
    ctx!.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
    ctx!.strokeStyle = "#facc15";
    ctx!.lineWidth = 4;
    ctx!.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);

    ctx!.fillStyle = "#18181b";
    ctx!.textAlign = "center";
    ctx!.textBaseline = "middle";
    ctx!.font = 'bold 44px "Hiragino Sans", "Yu Gothic", sans-serif';
    ctx!.fillText("高さ制限 4.5M", canvas.width / 2, 46);
    ctx!.font = 'bold 26px "Hiragino Sans", "Yu Gothic", sans-serif';
    ctx!.fillStyle = "#4b5563";
    ctx!.fillText("CLEARANCE 4.5m", canvas.width / 2, 94);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.jrGuardTextureCache.set("clearance", tex);
    return tex;
  }

  private centerGaiTextureCache = new Map<string, THREE.CanvasTexture>();

  private createCenterGaiArchCanvasTexture(flipY: boolean): THREE.CanvasTexture | null {
    if (typeof document === "undefined") {
      return null;
    }
    const cacheKey = `arch:${flipY ? "flip" : "glb"}`;
    const cached = this.centerGaiTextureCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }

    // 渋谷センター街アーチ看板: コバルトブルー基調の明るいバックライト照明看板＋くっきりした和英表記
    const bgGrad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    bgGrad.addColorStop(0, "#1d4ed8");
    bgGrad.addColorStop(0.5, "#2563eb");
    bgGrad.addColorStop(1, "#1e40af");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 8;
    ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);

    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 4;
    ctx.strokeRect(22, 22, canvas.width - 44, canvas.height - 44);

    // バスケットボールエンブレム（右側）
    ctx.fillStyle = "#ea580c";
    ctx.beginPath();
    ctx.arc(908, 128, 58, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fef3c7";
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = 'bold 28px "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif';
    ctx.fillText("CENTER", 908, 114);
    ctx.fillText("GAI", 908, 144);

    // メイン看板テキスト（左〜中央）
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(56, 189, 248, 0.7)";
    ctx.shadowBlur = 10;
    ctx.font = 'bold 78px "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif';
    ctx.fillText("渋谷センター街", 448, 98);

    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fde047";
    ctx.font = 'bold 34px "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif';
    ctx.fillText("SHIBUYA CENTER-GAI  ・  バスケットボール通り", 448, 184);

    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = flipY;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    this.centerGaiTextureCache.set(cacheKey, tex);
    return tex;
  }

  private createCenterGaiBannerCanvasTexture(flipY: boolean): THREE.CanvasTexture | null {
    if (typeof document === "undefined") {
      return null;
    }
    const cacheKey = `banner:${flipY ? "flip" : "glb"}`;
    const cached = this.centerGaiTextureCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }

    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, "#1d4ed8");
    grad.addColorStop(1, "#0f172a");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#e11d48";
    ctx.fillRect(0, 0, canvas.width, 64);
    ctx.strokeStyle = "#facc15";
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = 'bold 26px "Hiragino Sans", sans-serif';
    ctx.fillText("WELCOME", 128, 34);

    const chars = ["渋", "谷", "セ", "ン", "タ", "ー", "街"];
    ctx.fillStyle = "#fef08a";
    ctx.font = 'bold 50px "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif';
    for (let i = 0; i < chars.length; i++) {
      ctx.fillText(chars[i], 128, 108 + i * 56);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = flipY;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    this.centerGaiTextureCache.set(cacheKey, tex);
    return tex;
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
        stdMat.map = shibuyaTextureManager.getGlbTexture("shutokoSign");
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

    // 4b. 渋谷スクランブルスクエア 屋上「SHIBUYA SKY」CROSSING LIGHT 天頂サーチライト
    const isSearchlight = matName.includes("ShibuyaSkySearchlightGlow");
    if (isSearchlight) {
      const dayIntensity = 0.0;
      const nightIntensity = 2.5;
      stdMat.color = new THREE.Color(0xa5f3fc);
      stdMat.emissive = new THREE.Color(0x38bdf8);
      stdMat.emissiveIntensity = this.isNightActive ? nightIntensity : dayIntensity;
      stdMat.roughness = 0.05;
      stdMat.metalness = 0.0;
      stdMat.transparent = true;
      stdMat.opacity = this.isNightActive ? 0.72 : 0.0;
      stdMat.depthWrite = false;
      this.shibuyaStreamEmissiveEntries.push({
        material: stdMat,
        dayIntensity,
        nightIntensity,
      });
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
      const dayIntensity = 0.65;
      const nightIntensity = 2.8;
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
      const nightIntensity = 0.58;
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
        stdMat.map = shibuyaTextureManager.getGlbTexture("qfront");
      }
      stdMat.emissiveMap = stdMat.map;
      stdMat.emissive = new THREE.Color(0xffffff);
      const dayIntensity = 0.9;
      const nightIntensity = 1.75;
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
        stdMat.map = shibuyaTextureManager.getGlbTexture("shibuya109");
      }
      stdMat.emissiveMap = stdMat.map;
      stdMat.emissive = new THREE.Color(0xffffff);
      const dayIntensity = 0.55;
      const nightIntensity = 1.5;
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
        stdMat.map = shibuyaTextureManager.getGlbTexture("billboards");
      }
      stdMat.emissiveMap = stdMat.map;
      stdMat.emissive = new THREE.Color(0xffffff);
      const dayIntensity = 0.85;
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
        stdMat.map = shibuyaTextureManager.getGlbTexture("scrambleSquare");
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
        stdMat.map = shibuyaTextureManager.getGlbTexture("stream");
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
        stdMat.map = shibuyaTextureManager.getGlbTexture("miyashitaPark");
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
        stdMat.map = shibuyaTextureManager.getGlbTexture("commercialFacade");
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
        stdMat.map = shibuyaTextureManager.getGlbTexture("magnet");
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
        stdMat.map = shibuyaTextureManager.getGlbTexture("markCity");
      }
      stdMat.emissiveMap = stdMat.map;
      stdMat.emissive = new THREE.Color(0xffffff);
      const dayIntensity = 0.12;
      const nightIntensity = 0.52;
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
        stdMat.map = shibuyaTextureManager.getGlbTexture("toeiBic");
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
        stdMat.map = shibuyaTextureManager.getGlbTexture("dogenzakaCommercial");
      }
      stdMat.emissiveMap = stdMat.map;
      stdMat.emissive = new THREE.Color(0xffffff);
      const dayIntensity = 0.28;
      const nightIntensity = 0.62;
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

    // 25b. 忠犬ハチ公ブロンズ像＆ニュートラル花崗岩台座
    const isHachikoBronze = matName.includes("HachikoBronze");
    if (isHachikoBronze) {
      stdMat.color = new THREE.Color(0x8f6f47);
      stdMat.emissive = new THREE.Color(0x2d1f0e);
      const dayIntensity = 0.24;
      const nightIntensity = 0.42;
      stdMat.emissiveIntensity = this.isNightActive ? nightIntensity : dayIntensity;
      stdMat.roughness = 0.42;
      stdMat.metalness = 0.56;
      this.shibuyaStreamEmissiveEntries.push({
        material: stdMat,
        dayIntensity,
        nightIntensity,
      });
      return;
    }
    const isHachikoGranite = matName.includes("HachikoGranite");
    if (isHachikoGranite) {
      stdMat.color = new THREE.Color(0xc2bfb8);
      stdMat.roughness = 0.68;
      stdMat.metalness = 0.04;
      this.applyArchitecture3DTexture(stdMat, "white_granite");
      return;
    }

    // 26. セルリアンタワー（Cerulean Tower）外観カーテンウォール・ホテル基壇＆屋上ヘリポート
    const isCeruleanMat = matName.includes("Cerulean");
    if (isCeruleanMat) {
      if (matName.includes("Helipad")) {
        stdMat.color = new THREE.Color(0x065f46);
        stdMat.roughness = 0.52;
        stdMat.metalness = 0.12;
        this.applyArchitecture3DTexture(stdMat, "white_granite");
      } else {
        stdMat.roughness = 0.18;
        stdMat.metalness = 0.38;
        this.applyArchitecture3DTexture(stdMat, "curtain_glass");
      }
      return;
    }

    // 27. 渋谷PARCO（Shibuya PARCO）外観カーテンウォール・立体街路スパイラル＆屋上庭園
    const isParcoMat = matName.includes("Parco");
    if (isParcoMat) {
      if (matName.includes("Roof") || matName.includes("Garden")) {
        stdMat.roughness = 0.82;
        stdMat.metalness = 0.05;
        this.applyArchitecture3DTexture(stdMat, "white_granite");
      } else {
        stdMat.roughness = 0.25;
        stdMat.metalness = 0.32;
        this.applyArchitecture3DTexture(stdMat, "retail_storefront");
      }
      return;
    }

    // 28. 渋谷センター街 入口アーチ看板・ハンギングフラッグバナー（GLB UV flipY=false 用 CanvasTexture）
    const isCenterGaiMat = matName.includes("CenterGai");
    if (isCenterGaiMat) {
      const isBannerMat = matName.includes("Banner");
      if (isBannerMat) {
        const bannerTex = this.createCenterGaiBannerCanvasTexture(false);
        const hasBannerTex = bannerTex !== null;
        if (hasBannerTex && bannerTex) {
          stdMat.map = bannerTex;
          stdMat.emissiveMap = bannerTex;
        }
        stdMat.color = new THREE.Color(0xffffff);
        stdMat.emissive = new THREE.Color(hasBannerTex ? 0xffffff : 0x1d4ed8);
        const dayIntensity = 0.18;
        const nightIntensity = 0.65;
        stdMat.emissiveIntensity = this.isNightActive ? nightIntensity : dayIntensity;
        stdMat.roughness = 0.48;
        stdMat.metalness = 0.05;
        this.shibuyaStreamEmissiveEntries.push({
          material: stdMat,
          dayIntensity,
          nightIntensity,
        });
        stdMat.needsUpdate = true;
        return;
      }

      if (matName.includes("Sign") || matName.includes("Arch")) {
        const signTex = this.createCenterGaiArchCanvasTexture(false);
        const hasSignTex = signTex !== null;
        if (hasSignTex && signTex) {
          stdMat.map = signTex;
          stdMat.emissiveMap = signTex;
        }
        stdMat.color = new THREE.Color(0xffffff);
        stdMat.emissive = new THREE.Color(hasSignTex ? 0xffffff : 0x1e3a8a);
        const dayIntensity = 0.25;
        const nightIntensity = 0.85;
        stdMat.emissiveIntensity = this.isNightActive ? nightIntensity : dayIntensity;
        stdMat.roughness = 0.25;
        stdMat.metalness = 0.08;
        this.shibuyaStreamEmissiveEntries.push({
          material: stdMat,
          dayIntensity,
          nightIntensity,
        });
        stdMat.needsUpdate = true;
        return;
      }
      this.applyArchitecture3DTexture(stdMat, "anodized_metal");
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

          const offsetX = config?.offset[0] ?? -750.0;
          const offsetY = config?.offset[1] ?? 0.0;
          const offsetZ = config?.offset[2] ?? 527.6;
          glbModel.position.set(offsetX, offsetY, offsetZ);
          glbModel.userData.basePositionY = offsetY;
          glbModel.userData.baseScaleY = 1;
          // 非鏡像 1:1 座標投影 (+X=東, -Z=北) へ Blender 出力を直接整合させるため回転 0 で配置
          glbModel.rotation.y = 0;

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

          const isShibuyaInactive = !this.hasActiveShibuyaChunk();
          glbModel.visible = !isShibuyaInactive;
          this.setShibuyaGlbOverlappingProceduralVisible(isShibuyaInactive);

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

          const assignedProxyTileIds = new Set<string>();
          const tileBoundsCache = new Map<string, THREE.Box3>();
          for (let i = 0; i < detailedTileMeshes.length; i++) {
            const tileMesh = detailedTileMeshes[i];
            const parentTileName = tileMesh.parent?.name || "";
            const isGroupedUnderTileNode = parentTileName.startsWith("PlateauTile_");
            const rawTileName = isGroupedUnderTileNode ? parentTileName : tileMesh.name || "";
            const strippedName = rawTileName
              .replace(/^PlateauTile_/, "")
              .replace(/^ShibuyaPlateauTileMesh_/, "");
            const tileId =
              !isGroupedUnderTileNode && (tileMesh.name || "").startsWith("ShibuyaPlateauTileMesh_")
                ? strippedName.replace(/_\d+$/, "")
                : strippedName;

            if (isGroupedUnderTileNode && tileMesh.parent) {
              let sharedBounds = tileBoundsCache.get(tileId);
              if (!sharedBounds) {
                tileMesh.parent.updateMatrixWorld(true);
                sharedBounds = new THREE.Box3().setFromObject(tileMesh.parent);
                tileBoundsCache.set(tileId, sharedBounds);
              }
              this.cullingBoundsCache.set(tileMesh, sharedBounds);
            }

            const proxyMesh = proxyTileMap.get(tileId);
            if (proxyMesh) {
              const isPrimaryProxyCarrier = !assignedProxyTileIds.has(tileId);
              assignedProxyTileIds.add(tileId);
              tileMesh.userData.proxyMesh = proxyMesh;
              tileMesh.userData.detailedGeometry = tileMesh.geometry;
              tileMesh.userData.proxyGeometry = isPrimaryProxyCarrier
                ? proxyMesh.geometry
                : new THREE.BufferGeometry();
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

          const isShibuyaInactive = !this.hasActiveShibuyaChunk();
          glbModel.visible = !isShibuyaInactive;

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
      const tex = shibuyaTextureManager.getGlbTexture("plateauLod2Facade");
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
      const tex = shibuyaTextureManager.getGlbTexture("plateauLod2Facade");
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

    if (matName.includes("PlateauStorefront")) {
      const tex = shibuyaTextureManager.getGlbTexture("plateauLod2Storefront");
      stdMat.map = tex;
      stdMat.roughness = 0.42;
      stdMat.metalness = 0.16;
      const dayIntensity = 0.05;
      const nightIntensity = 1.05;
      stdMat.emissive = new THREE.Color(0xfef08a);
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
      const tex = shibuyaTextureManager.getGlbTexture("plateauLod2Storefront");
      stdMat.map = tex;
      stdMat.roughness = 0.42;
      stdMat.metalness = 0.16;
      const dayIntensity = 0.08;
      const nightIntensity = 1.05;
      stdMat.emissive = new THREE.Color(0xfef3c7);
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
      const tex = shibuyaTextureManager.getGlbTexture("plateauLod2Facade");
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

    for (const rawB of buildingPositions) {
      // 外苑東通り (x = -380, 車道+歩道 x ∈ [-392, -368]) への食い込みを防止するセットバックと
      // 宮益坂・青山エリア (x <= -380) へ重複する千代田区西端ビル (13101-bldg-5104/5105) の非表示化
      const isAoyamaEncroachingChiyoda = rawB.buildingId.startsWith("13101-") && rawB.x <= -380;
      const isGaienEastAdjacentChiyoda =
        rawB.buildingId.startsWith("13101-") && rawB.x > -380 && rawB.x - rawB.w * 0.5 < -364;
      const bWidth = isGaienEastAdjacentChiyoda ? Math.min(rawB.w, 60) : rawB.w;
      const bX = isGaienEastAdjacentChiyoda ? Math.max(rawB.x, -364 + bWidth * 0.5) : rawB.x;
      const b = { ...rawB, x: bX, w: bWidth };

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
        isChiyodaOtemachiOverlap: b.buildingId.startsWith("13101-") && rawB.x < -280,
        permanentlyHiddenByGlb: isAoyamaEncroachingChiyoda,
      };
      bGroup.position.set(b.x, b.h / 2, b.z);
      if (isAoyamaEncroachingChiyoda) {
        bGroup.visible = false;
      }

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
      const marunouchiBaseTex = shibuyaTextureManager.getTexture("plateauLod2Storefront").clone();
      marunouchiBaseTex.needsUpdate = true;
      marunouchiBaseTex.repeat.set(
        Math.max(1, Math.round(b.w / 14)),
        Math.max(1, Math.round(podiumHeight / 14)),
      );
      const baseMat = new THREE.MeshStandardMaterial({
        color: b.podiumColor,
        map: marunouchiBaseTex,
        emissive: new THREE.Color(0xfff4db),
        emissiveMap: marunouchiBaseTex,
        emissiveIntensity: this.isNightActive ? 0.55 : 0.06,
        roughness: 0.62,
        metalness: 0.12,
      });
      this.shibuyaStreamEmissiveEntries.push({
        material: baseMat,
        dayIntensity: 0.06,
        nightIntensity: 0.55,
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
      const marunouchiTowerTexBase = shibuyaTextureManager.getTexture(
        towerTextureMode === "stone_punched" ? "plateauLod2Storefront" : "plateauLod2Facade",
      );
      const marunouchiTowerTex = marunouchiTowerTexBase.clone();
      marunouchiTowerTex.needsUpdate = true;
      marunouchiTowerTex.repeat.set(
        Math.max(1, Math.round(towerW / 14)),
        Math.max(1, Math.round(towerHeight / 14)),
      );
      const glassTowerMat = new THREE.MeshPhysicalMaterial({
        color: b.color,
        map: marunouchiTowerTex,
        emissive: new THREE.Color(0xe2e8f0),
        emissiveMap: marunouchiTowerTex,
        emissiveIntensity: this.isNightActive ? 0.78 : 0.08,
        metalness: 0.72,
        roughness: 0.18,
        reflectivity: 0.9,
        clearcoat: 0.75,
      });
      this.shibuyaStreamEmissiveEntries.push({
        material: glassTowerMat,
        dayIntensity: 0.08,
        nightIntensity: 0.78,
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

      // 物理コライダー（Rapier: 青山・宮益坂へ重複する千代田区西端ビルは物理コライダーを生成しない）
      if (!isAoyamaEncroachingChiyoda) {
        const bBodyDesc = rapier.RigidBodyDesc.fixed().setTranslation(b.x, b.h / 2, b.z);
        const bBody = world.createRigidBody(bBodyDesc);
        const bCollider = rapier.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2)
          .setFriction(0.5)
          .setRestitution(0.1);
        this.registerCollider(world.createCollider(bCollider, bBody), true);
      }
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
      // 1. 原宿・表参道エリア (harajuku-yoyogi / omotesando-aoyama-north: 北方 -Z)
      {
        id: "exp-bldg-harajuku-fashion-1",
        name: "原宿ファッションプラザ",
        nameEn: "Harajuku Fashion Plaza",
        x: -915,
        z: -145,
        w: 42,
        d: 34,
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
        x: -790,
        z: -40,
        w: 36,
        d: 34,
        h: 56,
        usage: "商業施設",
        mode: "anodized_metal",
        color: 0xa3a19a,
        podiumColor: 0x334155,
      },
      {
        id: "exp-bldg-omotesando-complex",
        name: "表参道テラスコンプレックス",
        nameEn: "Omotesando Terrace Complex",
        x: -690,
        z: -140,
        w: 70,
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
        x: -580,
        z: 10,
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
        x: -875,
        z: -310,
        w: 46,
        d: 40,
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
        x: -830,
        z: -410,
        w: 40,
        d: 36,
        h: 52,
        usage: "商業施設",
        mode: "curtain_glass",
        color: 0x38bdf8,
        podiumColor: 0x0f172a,
      },

      // 2. 恵比寿・代官山エリア (ebisu-daikanyama: 南方 +Z)
      {
        id: "exp-bldg-ebisu-garden-tower",
        name: "恵比寿ガーデンタワー",
        nameEn: "Ebisu Garden Tower",
        x: -330,
        z: 1030,
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
        x: -455,
        z: 970,
        w: 44,
        d: 38,
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
        x: -1020,
        z: 910,
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
        x: -330,
        z: 1140,
        w: 42,
        d: 38,
        h: 84,
        usage: "業務施設",
        mode: "ribbon_window",
        color: 0x334155,
        podiumColor: 0x1e293b,
      },

      // 3. 山手通り・神泉・松濤エリア (shibuya-west: 西方 -X)
      {
        id: "exp-bldg-shinsen-crossing",
        name: "神泉交差点タワー",
        nameEn: "Shinsen Crossing Tower",
        x: -1550,
        z: 775,
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
        x: -1530,
        z: 120,
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
        x: -1700,
        z: 740,
        w: 52,
        d: 40,
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
        x: -1700,
        z: 950,
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
        x: -1700,
        z: 80,
        w: 46,
        d: 40,
        h: 92,
        usage: "業務施設",
        mode: "curtain_glass",
        color: 0x0284c7,
        podiumColor: 0x1e293b,
      },

      // 4. 六本木・西麻布・赤坂エリア (roppongi-nishiazabu / aoyama-east: 南東 +X/+Z)
      {
        id: "exp-bldg-roppongi-hills-mori",
        name: "六本木ヒルズ森タワー",
        nameEn: "Roppongi Hills Mori Tower",
        x: -310,
        z: 510,
        w: 66,
        d: 60,
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
        x: -230,
        z: 470,
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
        x: -520,
        z: 485,
        w: 42,
        d: 36,
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
        x: -210,
        z: 220,
        w: 54,
        d: 48,
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
        x: -210,
        z: 310,
        w: 50,
        d: 44,
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

    const beaconRedMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });

    for (const b of districts) {
      const groundY = b.x < -395 ? sampleShibuyaTerrainY(b.x, b.z) : 0;
      const podiumSkirt = b.x < -395 ? 3.5 : 0;
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
        groundElevationM: groundY,
        isLargeStructure: true,
      };
      bGroup.position.set(b.x, groundY + b.h / 2, b.z);

      const podiumHeight = Math.min(28, b.h * 0.35);
      const crownHeight = Math.min(10, Math.max(4, b.h * 0.08));
      const towerHeight = Math.max(8, b.h - podiumHeight - crownHeight);

      // 1. 低層ポディウム（渋谷傾斜区間は -3.5m 地中スカートを延長して接地隙間を防止）
      const baseGeo = new THREE.BoxGeometry(b.w, podiumHeight + podiumSkirt, b.d);
      const expBaseTex = shibuyaTextureManager.getTexture("plateauLod2Storefront").clone();
      expBaseTex.needsUpdate = true;
      expBaseTex.repeat.set(
        Math.max(1, Math.round(b.w / 14)),
        Math.max(1, Math.round((podiumHeight + podiumSkirt) / 14)),
      );
      const baseMat = new THREE.MeshStandardMaterial({
        color: b.podiumColor,
        map: expBaseTex,
        emissive: new THREE.Color(0xfff4db),
        emissiveMap: expBaseTex,
        emissiveIntensity: this.isNightActive ? 0.55 : 0.06,
        roughness: 0.58,
        metalness: 0.15,
      });
      this.shibuyaStreamEmissiveEntries.push({
        material: baseMat,
        dayIntensity: 0.06,
        nightIntensity: 0.55,
      });
      this.applyArchitecture3DTexture(
        baseMat,
        b.mode === "white_granite" ? "white_granite" : "anodized_metal",
      );
      // 本体・塔屋に別々の lodDetailTier を付けると medium 距離で下部だけ消えて屋上スラブが宙に浮くため、
      // 丸の内ビル群と同様に基壇・本体・塔屋の 3 メッシュを全可視距離で一体表示する
      const baseMesh = new THREE.Mesh(baseGeo, baseMat);
      baseMesh.position.y = -b.h / 2 + (podiumHeight - podiumSkirt) / 2;
      baseMesh.castShadow = true;
      baseMesh.receiveShadow = true;
      bGroup.add(baseMesh);

      // 2. タワー部（遠景 LOD2 でも窓割が見える高精細実写ファサードテクスチャ＋3Dボリューム）
      const towerW = b.w * 0.94;
      const towerD = b.d * 0.94;
      const towerGeo = new THREE.BoxGeometry(towerW, towerHeight, towerD);
      const expTexBase = shibuyaTextureManager.getTexture(
        b.mode === "stone_punched" ? "plateauLod2Storefront" : "plateauLod2Facade",
      );
      const expTex = expTexBase.clone();
      expTex.needsUpdate = true;
      expTex.repeat.set(
        Math.max(1, Math.round(towerW / 14)),
        Math.max(1, Math.round(towerHeight / 14)),
      );
      const towerMat = new THREE.MeshStandardMaterial({
        map: expTex,
        emissiveMap: expTex,
        emissive: new THREE.Color(0xe2e8f0),
        emissiveIntensity: this.isNightActive ? 0.85 : 0.1,
        color: b.color,
        roughness: b.mode === "curtain_glass" ? 0.22 : 0.52,
        metalness: b.mode === "curtain_glass" ? 0.52 : 0.22,
      });
      this.shibuyaStreamEmissiveEntries.push({
        material: towerMat,
        dayIntensity: 0.1,
        nightIntensity: 0.85,
      });
      this.applyArchitecture3DTexture(towerMat, b.mode);
      const towerMesh = new THREE.Mesh(towerGeo, towerMat);
      towerMesh.position.y = -b.h / 2 + podiumHeight + towerHeight / 2;
      towerMesh.castShadow = true;
      towerMesh.receiveShadow = true;
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
      bGroup.add(crownMesh);

      // 4. 超高層ビル (h >= 60m) の航空障害灯（遠距離では軽量化のため非表示）
      if (b.h >= 60) {
        const beaconGeo = new THREE.SphereGeometry(0.7, 8, 8);
        const beaconMesh = new THREE.Mesh(beaconGeo, beaconRedMat);
        beaconMesh.position.set(0, b.h / 2 + 0.5, 0);
        beaconMesh.userData.lodDetailTier = "medium";
        bGroup.add(beaconMesh);
      }

      this.group.add(bGroup);
      this.plateauBuildingGroups.push(bGroup);

      // 物理コライダー（Rapier）
      const bBodyDesc = rapier.RigidBodyDesc.fixed().setTranslation(
        b.x,
        groundY + (b.h - podiumSkirt) / 2,
        b.z,
      );
      const bBody = world.createRigidBody(bBodyDesc);
      const bCollider = rapier.ColliderDesc.cuboid(b.w / 2, (b.h + podiumSkirt) / 2, b.d / 2)
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
    // Why z = 22..232: Intersection_0_5 (z ∈ [-6, +16]) および Intersection_0_250 / 日比谷通り北縁 (z >= 234) 外側の歩道区間のみに植栽する
    for (let z = 22; z < 232; z += 18) {
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

    // スプライン曲線道路の走行車線内に街路樹・街灯コライダーが混入しないよう中心線近傍判定を構築
    const curvedRoadClearances: Array<{ x: number; z: number; clearanceSq: number }> = [];
    for (const corridor of getOpenDataCurvedRoadCorridors()) {
      const isHikarieAccess = corridor.id === "nav-road-shibuya-hikarie-access";
      const lanesPerDir =
        corridor.widthMeters >= 20.0
          ? 3
          : Math.max(1, Math.min(3, Math.round(corridor.widthMeters / 8.5)));
      const laneW = isHikarieAccess ? 2.9 : 3.4;
      const shoulderW = isHikarieAccess ? 0.5 : 1.2;
      const halfDriveable = (lanesPerDir * 2 * laneW + shoulderW * 2 + 1.4) * 0.5;
      const clearance = halfDriveable + 1.2;
      const spline = new THREE.CatmullRomCurve3(
        corridor.points.map((p) => new THREE.Vector3(p.x, 0, p.z)),
        false,
        "centripetal",
        0.5,
      );
      const samples = Math.max(6, Math.ceil(spline.getLength() / 6.0));
      for (let i = 0; i <= samples; i++) {
        const pt = spline.getPointAt(i / samples);
        curvedRoadClearances.push({ x: pt.x, z: pt.z, clearanceSq: clearance * clearance });
      }
    }
    const isNearCurvedRoadway = (px: number, pz: number): boolean =>
      curvedRoadClearances.some((c) => {
        const dx = px - c.x;
        const dz = pz - c.z;
        return dx * dx + dz * dz < c.clearanceSq;
      });

    // 3. 日比谷通り（z = 250）＆ 内堀通り・皇居外苑（z = 365）の並木（丸の内都心ブロック x=-240 〜 x=+240）
    // Why x < -240 およびカーブ区間近傍の生成を抑制するか:
    // x < -240（永代通り以西）は渋谷・宮益坂（都道413号: x=-480..-400, z=242..232）のスプライン車道と交差し、
    // また皇居外苑・楠公通り曲線（nav-road-kokyo-gaien-plaza-curve: z=350..370, x=-30..0）および
    // 内堀通りカーブ区間（nav-road-uchibori-dori）の走行車線内に街路樹の幹コライダーが
    // 突き刺さって「見えない壁」となるため、安全な直線歩道上のみに限定配置する。
    for (let x = -240; x <= 240; x += 36) {
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
      const isInsideKokyoPlazaCurve = Math.abs(x - -24) < 12 || Math.abs(x - -132) < 12;
      if (Math.abs(x) < 160 && !isInsideKokyoPlazaCurve) {
        if (!isNearCurvedRoadway(x, 365 - 11.5)) {
          this.createGinkgoTree(x, 365 - 11.5, treeIndex++, world, rapier, streetPropsBody);
        }
        if (!isNearCurvedRoadway(x, 365 + 11.5)) {
          this.createGinkgoTree(x, 365 + 11.5, treeIndex++, world, rapier, streetPropsBody);
        }
      }
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

    // 5. 渋谷放射状スプライン路線（明治通り本線・六本木通り・道玄坂・宮益坂・公園通り・文化村通り・明治通り上下・国道246号・玉川通り西進）の並木・街灯・交差点信号機
    // Why this.loadBlenderStreetTreeGlb() の直前に樹木を配置するか:
    // 後続の GLB 街路樹モデル非同期ロード・置換処理が渋谷の全スプライン沿道樹木にも適用されるようにするため。
    const placedShibuyaProps: Array<{ x: number; z: number }> = [];

    const shibuyaRadialRoadIds = [
      "nav-road-meiji-dori",
      "nav-road-shibuya-roppongi-dori",
      "nav-road-shibuya-dogenzaka",
      "nav-road-shibuya-miyamasuzaka",
      "nav-road-shibuya-koen-dori",
      "nav-road-shibuya-bunkamura-dori",
      "nav-road-meiji-dori-harajuku-curve",
      "nav-road-meiji-dori-ebisu-curve",
      "nav-road-route246",
      "nav-road-shibuya-tamagawa-west",
    ];

    // 1:1 非反転 実座標 交差点開口部・除外ゾーン（樹木・街灯の交差点内生成を抑制）
    const shibuyaIntersectionExclusionZones: Array<{ x: number; z: number; radius: number }> = [
      { x: -990.7, z: 275.8, radius: 30 }, // スクランブル交差点
      { x: -818.4, z: 245.8, radius: 24 }, // 宮益坂下交差点
      { x: -1159.4, z: 272.4, radius: 26 }, // SHIBUYA109前Y字交差点
      { x: -1325.0, z: 151.3, radius: 24 }, // 東急本店前
      { x: -1440.0, z: 675.0, radius: 34 }, // 道玄坂上交差点
      { x: -1530.0, z: 705.0, radius: 26 }, // 神泉町交差点
      { x: -1625.0, z: 740.0, radius: 28 }, // 山手通り神泉合流
      { x: -762.8, z: 435.5, radius: 28 }, // 渋谷駅東口・国道246号
      { x: -672.0, z: 413.0, radius: 24 }, // 金王坂下
      { x: -501.1, z: 194.8, radius: 26 }, // 宮益坂上交差点
      { x: -380.0, z: 98.0, radius: 26 }, // 青山一丁目北接続
      { x: -981.6, z: 185.0, radius: 24 }, // 神南一丁目交差点
      { x: -1108.1, z: -43.6, radius: 24 }, // 渋谷PARCO前
      { x: -1165.0, z: -120.0, radius: 24 }, // 勤労福祉会館前
      { x: -974.8, z: 519.7, radius: 24 }, // セルリアンタワー前
      { x: -1155.0, z: 128.0, radius: 22 }, // 宇田川町交番前
    ];

    this.group.updateMatrixWorld(true);

    // 歩道メッシュ・道路メッシュ・交差点パッドの収集（テスト検証ロジックと100%同期待機）
    const shibuyaSidewalkMeshes: THREE.Mesh[] = [];
    const shibuyaCurvedRoadMeshes: THREE.Mesh[] = [];
    const testIntersectionPads: Array<{
      minX: number;
      maxX: number;
      minZ: number;
      maxZ: number;
    }> = [];
    const testStraightPlanes: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> =
      [];
    const testBox = new THREE.Box3();

    this.group.traverse((obj) => {
      const isMesh = obj instanceof THREE.Mesh;
      if (!isMesh) {
        return;
      }
      const pn = obj.parent?.name ?? "";
      const isSidewalkMesh =
        Boolean(obj.userData?.isSidewalkSurface) ||
        obj.name.startsWith("CurvedSidewalk_") ||
        obj.name.startsWith("CurvedCurb_");
      if (isSidewalkMesh) {
        shibuyaSidewalkMeshes.push(obj as THREE.Mesh);
      }

      if (pn.startsWith("Intersection_") && obj.geometry instanceof THREE.PlaneGeometry) {
        testBox.setFromObject(obj);
        testIntersectionPads.push({
          minX: testBox.min.x - 0.5,
          maxX: testBox.max.x + 0.5,
          minZ: testBox.min.z - 0.5,
          maxZ: testBox.max.z + 0.5,
        });
      } else if (
        obj.material instanceof JapaneseRoadMaterial &&
        !obj.name.includes("Marking") &&
        !obj.name.includes("Yellow") &&
        !obj.name.includes("White") &&
        !obj.name.includes("Shoulder") &&
        !obj.name.includes("Lane")
      ) {
        if (pn.startsWith("CurvedRoadSegment_")) {
          shibuyaCurvedRoadMeshes.push(obj as THREE.Mesh);
        } else if (obj.geometry instanceof THREE.PlaneGeometry) {
          testBox.setFromObject(obj);
          testStraightPlanes.push({
            minX: testBox.min.x - 0.5,
            maxX: testBox.max.x + 0.5,
            minZ: testBox.min.z - 0.5,
            maxZ: testBox.max.z + 0.5,
          });
        }
      }
    });

    const propRaycaster = new THREE.Raycaster();
    const propRayDown = new THREE.Vector3(0, -1, 0);

    const getTestHalfDriveable = (id: string, widthMeters: number): number => {
      const isHikarie = id === "nav-road-shibuya-hikarie-access";
      const lanes = widthMeters >= 20 ? 3 : Math.max(1, Math.min(3, Math.round(widthMeters / 8.5)));
      const laneW = isHikarie ? 2.9 : 3.4;
      const shW = isHikarie ? 0.5 : 1.2;
      let medW = 0;
      if (id.includes("meiji-dori") || id === "nav-road-yamate-dori") {
        medW = 1.4;
      } else if (id === "nav-road-shibuya-tamagawa-west" || id === "nav-road-uchibori-dori") {
        medW = 1.2;
      } else if (id === "nav-road-route246" || id === "nav-road-shibuya-roppongi-dori") {
        medW = 1.0;
      }
      return (lanes * 2 * laneW + shW * 2 + medW) * 0.5;
    };

    const allCorridorDatas = getOpenDataCurvedRoadCorridors().map((c) => {
      const curve = new THREE.CatmullRomCurve3(
        c.points.map((p) => new THREE.Vector3(p.x, 0, p.z)),
        false,
        "centripetal",
        0.5,
      );
      const testHalfDriveable = getTestHalfDriveable(c.id, c.widthMeters);
      const sampleCount = Math.max(40, Math.ceil(curve.getLength() / 2.0));
      return {
        id: c.id,
        testHalfDriveable,
        curve,
        length: curve.getLength(),
        sampledPts: curve.getPoints(sampleCount),
      };
    });

    const isSafeShibuyaStreetPropPosition = (
      px: number,
      pz: number,
      options?: {
        minRoadGap?: number;
        minPropGap?: number;
        requireSidewalk?: boolean;
        skipIntersectionExclusion?: boolean;
      },
    ): boolean => {
      const minRoadGap = options?.minRoadGap ?? 2.2;
      const minPropGap = options?.minPropGap ?? 8.0;
      const requireSidewalk = options?.requireSidewalk ?? false;
      const skipIntersectionExclusion = options?.skipIntersectionExclusion ?? false;

      // 丸の内・日比谷直線道路エリア（x > -440）の車道重複除外
      const isInsideMarunouchiStraightPlanes = px > -440;
      if (isInsideMarunouchiStraightPlanes) {
        return false;
      }

      if (!skipIntersectionExclusion) {
        // 交差点開口部・交差ゾーン内の除外
        const isInsideIntersectionZone = shibuyaIntersectionExclusionZones.some((ez) => {
          const dx = px - ez.x;
          const dz = pz - ez.z;
          return dx * dx + dz * dz < ez.radius * ez.radius;
        });
        if (isInsideIntersectionZone) {
          return false;
        }

        // 交差点パッド AABB 内の除外
        const inInter = testIntersectionPads.some(
          (p) => px >= p.minX && px <= p.maxX && pz >= p.minZ && pz <= p.maxZ,
        );
        if (inInter) {
          return false;
        }
      }

      // 直交道路 AABB 内の除外
      const inStraight = testStraightPlanes.some(
        (p) => px >= p.minX && px <= p.maxX && pz >= p.minZ && pz <= p.maxZ,
      );
      if (inStraight) {
        return false;
      }

      // スプライン道路路面メッシュへの Raycast チェック（坂道標高 y <= 15m に対応するため y = 60.0m 上空から真下照射）
      propRaycaster.set(new THREE.Vector3(px, 60.0, pz), propRayDown);
      const roadHits = propRaycaster.intersectObjects(shibuyaCurvedRoadMeshes, false);
      const hasRoadHit = roadHits.length > 0;
      if (hasRoadHit) {
        return false;
      }

      // 全コリドーの車道（testHalfDriveable）内侵入を絶対に防ぐ
      for (const cd of allCorridorDatas) {
        let minDistSq = Infinity;
        for (let i = 0; i < cd.sampledPts.length - 1; i++) {
          const a = cd.sampledPts[i];
          const b = cd.sampledPts[i + 1];
          const dx = b.x - a.x;
          const dz = b.z - a.z;
          const lenSq = dx * dx + dz * dz;
          const isNonDegenerate = lenSq > 1e-8;
          const t = isNonDegenerate
            ? Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / lenSq))
            : 0;
          const distSq = (px - (a.x + dx * t)) ** 2 + (pz - (a.z + dz * t)) ** 2;
          const isCloser = distSq < minDistSq;
          if (isCloser) {
            minDistSq = distSq;
          }
        }
        const dist = Math.sqrt(minDistSq);
        const gap = dist - cd.testHalfDriveable;
        const isTooCloseToRoad = gap < minRoadGap;
        if (isTooCloseToRoad) {
          return false;
        }
      }

      // 歩道メッシュの直上確認（必要な場合）
      if (requireSidewalk) {
        const swHits = propRaycaster.intersectObjects(shibuyaSidewalkMeshes, false);
        const hasSidewalkHit = swHits.length > 0;
        if (!hasSidewalkHit) {
          return false;
        }
      }

      // PLATEAU 建築物（外側 1.5m）との非干渉判定
      for (const b of SHIBUYA_PLATEAU_BUILDINGS) {
        const dx = Math.max(0, Math.abs(px - b.localX) - b.width * 0.5);
        const dz = Math.max(0, Math.abs(pz - b.localZ) - b.depth * 0.5);
        const distToBldg = Math.hypot(dx, dz);
        const isTooCloseToBuilding = distToBldg < 1.5;
        if (isTooCloseToBuilding) {
          return false;
        }
      }

      // センター街エリア（x ∈ [-1340, -1010], z ∈ [115, 265] かつセンター街道路から 14m 以内）の除外
      const isInsideCenterGaiBox = px >= -1340 && px <= -1010 && pz >= 115 && pz <= 265;
      if (isInsideCenterGaiBox) {
        const centerGaiCorridor = allCorridorDatas.find(
          (c) => c.id === "nav-road-shibuya-center-gai",
        );
        const hasCenterGai = Boolean(centerGaiCorridor);
        if (hasCenterGai) {
          let minCgDistSq = Infinity;
          for (const pt of centerGaiCorridor!.sampledPts) {
            const dSq = (px - pt.x) ** 2 + (pz - pt.z) ** 2;
            const isCloser = dSq < minCgDistSq;
            if (isCloser) {
              minCgDistSq = dSq;
            }
          }
          const isNearCenterGai = Math.sqrt(minCgDistSq) < 14.0;
          if (isNearCenterGai) {
            return false;
          }
        }
      }

      // JR山手線ガード下2箇所（スクランブル〜宮益坂下・玉川通り）の除外
      const isInsideJrUnderpass =
        (px >= -912 && px <= -878 && pz >= 242 && pz <= 278) ||
        (px >= -872 && px <= -838 && pz >= 445 && pz <= 490);
      if (isInsideJrUnderpass) {
        return false;
      }

      // 既存樹木・街灯・標識柱との最小距離チェック
      const minPropGapSq = minPropGap * minPropGap;
      for (const prop of placedShibuyaProps) {
        const distSq = (px - prop.x) ** 2 + (pz - prop.z) ** 2;
        const isTooCloseToProp = distSq < minPropGapSq;
        if (isTooCloseToProp) {
          return false;
        }
      }

      return true;
    };

    const shibuyaRadialCorridors = allCorridorDatas.filter((c) =>
      shibuyaRadialRoadIds.includes(c.id),
    );

    // A. 主要交差点の歩道角への信号機配置（街路樹・街灯より先に交差点信号を確保し、視認遮蔽を防止）
    const shibuyaIntersections = [
      {
        x: -968.0,
        z: 263.0,
        rotY: -Math.PI / 2,
        nameJa: "渋谷駅前スクランブル交差点",
        nameEn: "Shibuya Scramble Crossing",
      },
      {
        x: -1014.0,
        z: 286.0,
        rotY: Math.PI / 2,
        nameJa: "渋谷駅ハチ公前",
        nameEn: "Hachiko Entrance",
      },
      {
        x: -993.0,
        z: 249.0,
        rotY: Math.PI,
        nameJa: "渋谷駅前・QFRONT前",
        nameEn: "Shibuya Station Front",
      },
      {
        x: -968.0,
        z: 282.0,
        rotY: 0,
        nameJa: "渋谷駅ハチ公広場北",
        nameEn: "Hachiko Sq. North",
      },
      {
        x: -802.0,
        z: 232.0,
        rotY: Math.PI,
        nameJa: "宮益坂下交差点",
        nameEn: "Miyamasuzaka-shita",
      },
      {
        x: -794.0,
        z: 253.0,
        rotY: 0,
        nameJa: "宮益坂下・明治通り",
        nameEn: "Miyamasuzaka-shita",
      },
      {
        x: -758.0,
        z: 418.0,
        rotY: Math.PI,
        nameJa: "渋谷駅東口・国道246号",
        nameEn: "Shibuya Sta. East (R246)",
      },
      {
        x: -776.0,
        z: 456.0,
        rotY: 0,
        nameJa: "渋谷警察署前・明治通り",
        nameEn: "Shibuya Police Sta.",
      },
      {
        x: -972.0,
        z: 505.0,
        rotY: 0,
        nameJa: "セルリアンタワー前・R246",
        nameEn: "Cerulean Tower (R246)",
      },
      {
        x: -1140.0,
        z: 282.0,
        rotY: Math.PI / 3,
        nameJa: "SHIBUYA 109前",
        nameEn: "Shibuya 109",
      },
      {
        x: -1140.0,
        z: 262.0,
        rotY: -Math.PI / 3,
        nameJa: "道玄坂入口・109前",
        nameEn: "Dogenzaka Ent.",
      },
      {
        x: -1271.0,
        z: 349.0,
        rotY: -Math.PI / 4,
        nameJa: "道玄坂中腹",
        nameEn: "Dogenzaka",
      },
      {
        x: -1426.0,
        z: 650.0,
        rotY: -Math.PI * 0.7,
        nameJa: "道玄坂上交差点",
        nameEn: "Dogenzaka-ue",
      },
      {
        x: -660.0,
        z: 209.0,
        rotY: Math.PI,
        nameJa: "渋谷郵便局前・宮益坂",
        nameEn: "Shibuya Post Office",
      },
      {
        x: -518.0,
        z: 186.0,
        rotY: Math.PI * 0.5,
        nameJa: "宮益坂上交差点",
        nameEn: "Miyamasuzaka-ue",
      },
      {
        x: -1110.0,
        z: -29.0,
        rotY: Math.PI * 0.6,
        nameJa: "渋谷PARCO前",
        nameEn: "Shibuya PARCO",
      },
      {
        x: -1010.2,
        z: 108.0,
        rotY: -2.72,
        nameJa: "公園通り・神南一丁目",
        nameEn: "Koen-dori Jinnan 1",
      },
      {
        x: -1145.0,
        z: -102.0,
        rotY: 0.64,
        nameJa: "渋谷区役所前・公園通り",
        nameEn: "Shibuya City Office",
      },
      {
        x: -1279.6,
        z: 183.9,
        rotY: -2.07,
        nameJa: "文化村通り・東急本店前",
        nameEn: "Bunkamura-dori",
      },
      {
        x: -1405.1,
        z: 90.7,
        rotY: 1.05,
        nameJa: "松濤二丁目入口交差点",
        nameEn: "Shoto 2-chome",
      },
      {
        x: -600.2,
        z: 319.6,
        rotY: 2.53,
        nameJa: "金王坂中腹・渋谷二丁目",
        nameEn: "Konnozaka Shibuya 2",
      },
      {
        x: -530.3,
        z: 261.3,
        rotY: -0.56,
        nameJa: "金王坂上・渋谷二丁目東",
        nameEn: "Konnozaka-ue",
      },
      {
        x: -577.0,
        z: 599.0,
        rotY: 0.84,
        nameJa: "明治通り・並木橋方面",
        nameEn: "Meiji-dori Namikibashi",
      },
      {
        x: -1104.2,
        z: -21.1,
        rotY: -2.52,
        nameJa: "井の頭通り・宇田川町",
        nameEn: "Inokashira Udagawacho",
      },
    ];

    for (const inter of shibuyaIntersections) {
      const isSafe = isSafeShibuyaStreetPropPosition(inter.x, inter.z, {
        minRoadGap: 0.25,
        minPropGap: 6.0,
        requireSidewalk: true,
        skipIntersectionExclusion: true,
      });
      if (isSafe) {
        const tl = this.roadBuilder.props.createTrafficLight(inter.x, inter.z, inter.rotY, {
          intersectionNameJa: inter.nameJa,
          intersectionNameEn: inter.nameEn,
          activeSignal: "green",
          showArrowSignal: true,
        });
        tl.position.y = sampleShibuyaTerrainY(inter.x, inter.z);
        this.removeAttachedLights(tl);
        this.group.add(tl);
        placedShibuyaProps.push({ x: inter.x, z: inter.z });
      }
    }

    // B. 樹木の配置: s = 22m .. totalLen - 22m（30m 間隔、offset = ±(testHalfDriveable + 2.35m)）
    for (const corridor of shibuyaRadialCorridors) {
      const totalLen = corridor.length;
      const isShort = totalLen < 44;
      if (isShort) {
        continue;
      }
      for (let s = 22; s <= totalLen - 22; s += 30) {
        const u = s / totalLen;
        const pt = corridor.curve.getPointAt(u);
        const tan = corridor.curve.getTangentAt(u).normalize();
        const norm = new THREE.Vector3(tan.z, 0, -tan.x);

        for (const sideSign of [-1, 1]) {
          const offsetDist = corridor.testHalfDriveable + 2.35;
          const px = pt.x + norm.x * (sideSign * offsetDist);
          const pz = pt.z + norm.z * (sideSign * offsetDist);

          const isSidewalkRequiredCorridor =
            corridor.id === "nav-road-shibuya-koen-dori" ||
            corridor.id === "nav-road-shibuya-dogenzaka" ||
            corridor.id === "nav-road-shibuya-bunkamura-dori" ||
            corridor.id === "nav-road-shibuya-miyamasuzaka";
          const isSafe = isSafeShibuyaStreetPropPosition(px, pz, {
            minRoadGap: 2.2,
            minPropGap: 8.0,
            requireSidewalk: isSidewalkRequiredCorridor,
          });
          if (isSafe) {
            this.createGinkgoTree(px, pz, treeIndex++, world, rapier, streetPropsBody);
            placedShibuyaProps.push({ x: px, z: pz });
          }
        }
      }
    }

    // C. 街灯の配置: s = 36m .. totalLen - 22m（45m 間隔、offset = ±(testHalfDriveable + 2.35m)）
    for (const corridor of shibuyaRadialCorridors) {
      const totalLen = corridor.length;
      const isShort = totalLen < 58;
      if (isShort) {
        continue;
      }
      for (let s = 36; s <= totalLen - 22; s += 45) {
        const u = s / totalLen;
        const pt = corridor.curve.getPointAt(u);
        const tan = corridor.curve.getTangentAt(u).normalize();
        const norm = new THREE.Vector3(tan.z, 0, -tan.x);

        for (const sideSign of [-1, 1]) {
          const offsetDist = corridor.testHalfDriveable + 2.35;
          const px = pt.x + norm.x * (sideSign * offsetDist);
          const pz = pt.z + norm.z * (sideSign * offsetDist);

          const isSidewalkRequiredCorridor =
            corridor.id === "nav-road-shibuya-koen-dori" ||
            corridor.id === "nav-road-shibuya-dogenzaka" ||
            corridor.id === "nav-road-shibuya-bunkamura-dori" ||
            corridor.id === "nav-road-shibuya-miyamasuzaka";
          const isSafe = isSafeShibuyaStreetPropPosition(px, pz, {
            minRoadGap: 2.0,
            minPropGap: 8.0,
            requireSidewalk: isSidewalkRequiredCorridor,
          });
          if (isSafe) {
            this.createStreetLamp(px, pz, world, rapier, streetPropsBody);
            placedShibuyaProps.push({ x: px, z: pz });
          }
        }
      }
    }

    // Blender CLI 生成 GLB 街路樹モデルの非同期ロード＆全スロットへの展開
    if (!this.deferGlbLoads) {
      this.glbLoadPromises.push(this.loadBlenderStreetTreeGlb());
    }

    // 街灯（夜間に点灯：丸の内・行幸通り・仲通り・日比谷通り・永代通り・馬場先門通りの黒鋳鉄製2灯式クラシカル街灯）
    for (let z = 18; z < 245; z += 35) {
      const isNearNakadori = Math.abs(z - 165) < 15;
      if (isNearNakadori) {
        continue;
      }
      this.createStreetLamp(-12.8, z, world, rapier, streetPropsBody);
      this.createStreetLamp(12.8, z, world, rapier, streetPropsBody);
    }
    // 街灯（丸の内都心ブロック x=-240 〜 x=+240: 仲通り・日比谷通り・皇居外苑広場）
    for (let x = -240; x <= 240; x += 65) {
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
      if (Math.abs(x) < 160 && !isNearCurvedRoadway(x, 365 + 11.2)) {
        this.createStreetLamp(x, 365 + 11.2, world, rapier, streetPropsBody);
      }
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
    const groundY = x < -395 ? sampleShibuyaTerrainY(x, z) : 0;
    const slotGroup = new THREE.Group();
    slotGroup.position.set(x, groundY, z);
    slotGroup.userData.isStreetTreeSlot = true;
    slotGroup.userData.maxLodDrawDistance = 260;

    // 実寸 1:1 スケール基準（0.96 .. 1.04 の自然な個体差のみ付与）
    const scale = 0.96 + ((index * 37) % 9) * 0.01;
    const rotationY = ((index * 73) % 360) * (Math.PI / 180);

    // 街路樹の幹の物理コライダー（根元半径 0.34m * scale, 高さ 3.6m）
    const trunkColliderDesc = this.createCylinderDesc(rapier, 1.8, 0.34 * scale)
      .setTranslation(x, groundY + 1.8, z)
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
    const groundY = x < -395 ? sampleShibuyaTerrainY(x, z) : 0;
    const lampGroup = new THREE.Group();
    lampGroup.position.set(x, groundY, z);
    lampGroup.userData.maxLodDrawDistance = 220;

    // 街灯ポールの物理コライダー（台座半径 0.22m, 高さ 5.0m）
    const lampColDesc = this.createCylinderDesc(rapier, 2.5, 0.22)
      .setTranslation(x, groundY + 2.5, z)
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
      const groundY =
        p.position[0] < -395 ? sampleShibuyaTerrainY(p.position[0], p.position[2]) : 0;
      const seatedSpec: RoadSignPlacement =
        groundY !== 0
          ? {
              ...p,
              position: [p.position[0], p.position[1] + groundY, p.position[2]],
            }
          : p;
      const isOverhead = seatedSpec.type === "overhead_guide";
      const isWadakuraGantry = seatedSpec.id === "overhead_guide_wadakura";
      const enrichedSpec: RoadSignPlacement = isOverhead
        ? {
            ...seatedSpec,
            label: seatedSpec.label ?? "皇居・大手町",
            subLabel: seatedSpec.subLabel ?? "Imperial Palace / Otemachi",
            leftLabel:
              seatedSpec.leftLabel ?? (isWadakuraGantry ? "桜田門・三宅坂" : "日比谷・有楽町"),
            leftSubLabel:
              seatedSpec.leftSubLabel ?? (isWadakuraGantry ? "Sakuradamon" : "Hibiya / Yurakucho"),
            rightLabel: seatedSpec.rightLabel ?? "大手町・神田",
            rightSubLabel: seatedSpec.rightSubLabel ?? "Otemachi / Kanda",
            roadNumber: seatedSpec.roadNumber ?? "1",
            subRoadNumber: seatedSpec.subRoadNumber ?? "404",
            intersectionName:
              seatedSpec.intersectionName ?? (isWadakuraGantry ? "和田倉門" : "行幸通り"),
            spanWidth: seatedSpec.spanWidth ?? 19.2,
            supportType: seatedSpec.supportType ?? "cantilever",
          }
        : seatedSpec;

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

    const groundY =
      spec.position[0] < -395 ? sampleShibuyaTerrainY(spec.position[0], spec.position[2]) : 0;
    const seatedSpec: RoadSignPlacement =
      groundY !== 0
        ? {
            ...spec,
            position: [spec.position[0], spec.position[1] + groundY, spec.position[2]],
          }
        : spec;
    const instance = this.signSystem.createSignInstance(
      seatedSpec,
      this.signPhysicsContext ?? undefined,
    );
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
      if (entry.material.name.includes("ShibuyaSkySearchlightGlow")) {
        entry.material.opacity = isNight ? 0.72 : 0.0;
        entry.material.visible = isNight;
      }
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
      const isCityGround =
        child.name === "CityWideGroundMesh" || child.name === "ShibuyaTerrainMesh";
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
      chunkId === "shibuya-core" ||
      chunkId === "shibuya-north" ||
      chunkId === "shibuya-south" ||
      chunkId === "shibuya-west";
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
      !this.unloadedChunkIds.has("shibuya-south") ||
      !this.unloadedChunkIds.has("shibuya-west");

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
      this.proceduralParcoGroup,
      this.proceduralCeruleanGroup,
      this.proceduralMarkCityGroup,
      this.proceduralCenterGaiArchGroup,
      this.proceduralHachikoStatueGroup,
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
    // Why プロシージャル剛体・橋脚コライダーも showProcedural に連動させるか:
    // shibuya_stream.glb が表示されている間、プロシージャル直方体コライダーが有効のままだと、
    // GLB 側のモデル形状とプロシージャル Box の微小な差分により、何もない道路や広場空間に「見えない壁」が生じるため、
    // GLB 表示中はプロシージャル側の物理コライダーも完全に無効化（setEnabled(false)）する。
    for (let i = 0; i < this.proceduralGlbOverlappingColliders.length; i++) {
      const col = this.proceduralGlbOverlappingColliders[i];
      if (col && typeof col.setEnabled === "function") {
        col.setEnabled(showProcedural);
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

  private hasActiveShibuyaChunk(): boolean {
    return (
      !this.unloadedChunkIds.has("shibuya-core") ||
      !this.unloadedChunkIds.has("shibuya-north") ||
      !this.unloadedChunkIds.has("shibuya-south") ||
      !this.unloadedChunkIds.has("shibuya-west")
    );
  }

  private syncChunkVisibilityState(): void {
    const hasValidLastFocus = !Number.isNaN(this.lastCulledFocusPos.x);
    if (hasValidLastFocus) {
      const prevFocus = this.lastCulledFocusPos.clone();
      this.updateDistanceCulling(prevFocus, 380, true);
      return;
    }

    const hasActiveShibuya = this.hasActiveShibuyaChunk();
    const isShibuyaGlbActive = this.glbShibuyaStreamGroup !== null && hasActiveShibuya;
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
            obj === this.proceduralQfront109Group ||
            obj === this.proceduralParcoGroup ||
            obj === this.proceduralCeruleanGroup ||
            obj === this.proceduralMarkCityGroup ||
            obj === this.proceduralCenterGaiArchGroup) &&
          isShibuyaGlbActive;
        if (isHiddenProceduralStation || isHiddenProceduralShibuya) {
          obj.visible = false;
          continue;
        }
        if (obj === this.glbShibuyaStreamGroup || obj === this.glbShibuyaPlateauGroup) {
          obj.visible = hasActiveShibuya;
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
    const isShibuyaChunkLoaded = this.hasActiveShibuyaChunk();

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
      if (child.userData?.permanentlyHiddenByGlb === true) {
        child.visible = false;
        continue;
      }

      const isCityGround =
        child.name === "CityWideGroundMesh" || child.name === "ShibuyaTerrainMesh";
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
          child === this.proceduralQfront109Group ||
          child === this.proceduralParcoGroup ||
          child === this.proceduralCeruleanGroup ||
          child === this.proceduralMarkCityGroup ||
          child === this.proceduralCenterGaiArchGroup);
      if (isInactiveStationVariant || isInactiveStreamVariant || isInactiveShibuyaSubLandmark) {
        child.visible = false;
        continue;
      }

      // 渋谷〜宮益坂〜青山西エリア走行中（focusPosition.x < -345）は、座標上青山通り・宮益坂上へ侵食する
      // 千代田区大手町西端ビル群（localX <= -340: 読売新聞東京本社ビル 13101-bldg-5105 等）をカリングする
      const isInShibuyaOrAoyamaWest = focusPosition.x < -345;
      const isChiyodaOtemachiOverlap = child.userData?.isChiyodaOtemachiOverlap === true;
      if (isInShibuyaOrAoyamaWest && isChiyodaOtemachiOverlap) {
        child.visible = false;
        child.userData.appliedLodTier = "culled";
        culledByDistanceCount += 1;
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

  /**
   * AssetManagerUI 等から編集された道路定義をランタイムの該当道路メッシュ・シェーダーへ即時反映する
   */
  public applyRoadDefinitionOverride(road: RoadDefinition): { matchedSegments: number } {
    return logger.withTrace("cityMap", "road.override", () => {
      this.roadOverrides.set(road.id, road);

      const norm = (val: string): string => val.toLowerCase().replace(/[^a-z0-9]/g, "");
      const roadIdKey = norm(road.id);
      const roadCoreTokens = road.id
        .toLowerCase()
        .split(/[_-]+/)
        .filter(
          (t) =>
            t.length >= 3 &&
            t !== "dori" &&
            t !== "road" &&
            t !== "ave" &&
            t !== "street" &&
            t !== "route" &&
            t !== "shibuya",
        );

      const matchesRoadName = (candidateName: unknown): boolean => {
        if (typeof candidateName !== "string" || candidateName.length === 0) {
          return false;
        }
        const candNorm = norm(candidateName);
        if (
          candNorm === roadIdKey ||
          roadIdKey.includes(candNorm) ||
          candNorm.includes(roadIdKey)
        ) {
          return true;
        }
        return roadCoreTokens.length > 0 && roadCoreTokens.every((tok) => candNorm.includes(tok));
      };

      let matchedMaterials = 0;
      for (const mat of this.roadMaterials) {
        if (matchesRoadName(mat.userData?.roadName)) {
          mat.uRoadWidth.value = Math.max(4.0, road.width);
          matchedMaterials += 1;
        }
      }

      let matchedSegments = 0;
      for (const child of this.group.children) {
        if (!matchesRoadName(child.userData?.roadName)) {
          continue;
        }
        matchedSegments += 1;
        child.traverse((obj) => {
          if (obj === child) {
            return;
          }
          const name = obj.name;
          if (
            obj.userData?.isSidewalkSurface ||
            name.startsWith("StraightSidewalk_") ||
            name.startsWith("StraightCurb_") ||
            name.startsWith("StraightLGutter_") ||
            name.startsWith("CurvedSidewalk_") ||
            name.startsWith("CurvedCurb_") ||
            name.startsWith("CurvedLGutter_")
          ) {
            obj.visible = road.hasSidewalk;
          } else if (obj.userData?.markingType === "Crosswalk" || name.includes("Crosswalk")) {
            obj.visible = road.markings.hasCrosswalks;
          } else if (
            obj.userData?.markingType === "TactilePaving" ||
            name.includes("Tactile") ||
            name.includes("Braille")
          ) {
            obj.visible = road.markings.hasTactilePaving;
          } else if (name.includes("Shoulder")) {
            obj.visible = road.markings.hasShoulderLines;
          } else if (name.includes("Guardrail")) {
            obj.visible = road.props.hasGuardrails;
          } else if (name.includes("Manhole")) {
            obj.visible = road.props.hasManholes;
          } else if (name.includes("Median")) {
            obj.visible = road.hasMedian;
          }
        });
      }

      logger.info("roads", "road_definition_override_applied", "道路定義オーバーライドを適用", {
        roadId: road.id,
        roadName: road.name,
        width: road.width,
        hasSidewalk: road.hasSidewalk,
        matchedMaterials,
        matchedSegments,
      });

      return { matchedSegments };
    });
  }

  /**
   * ランタイム適用済みの道路定義オーバーライドを取得する
   */
  public getAppliedRoadOverride(roadId: string): RoadDefinition | undefined {
    return this.roadOverrides.get(roadId);
  }
}

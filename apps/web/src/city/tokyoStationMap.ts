import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { JapaneseRoadBuilder } from "../roads/roadBuilder";
import { JapaneseRoadSigns } from "../roads/roadSigns";
import type { JapaneseRoadMaterial } from "../roads/japaneseRoadMaterial";
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
  getPlateauBuildingsForMap,
  getPlateauWaterBodies,
  getRelativeTerrainDisplacement,
} from "../openData/gsiPlateauLoader";

/**
 * 東京駅丸の内周辺 3D都市環境
 * 東京都デジタルツイン / 国土交通省 Project PLATEAU（千代田区 13101・2025年度版）および
 * 国土地理院 地理院タイル DEM5A（5mメッシュ数値標高モデル）・ベクトルタイル道路中心線統合
 * - 東京駅丸の内赤レンガ駅舎（Blender CLI生成GLBモデル & プロシージャル）
 * - 行幸通り（Gyoko-dori Avenue: 都道404号・日本の道路規格準拠・凸凹シェーダー & 平坦Rapierコライダー）
 * - 丸の内中央通り & 日比谷通り（国道1号 / 都道403号・交差点・側溝・マンホール・ガードレール・横断歩道・信号機）
 * - 東京都 PLATEAU 千代田区の実在18棟（丸ビル・新丸ビル・JPタワーKITTE・東京海上日動ビル・明治安田生命ビル等）
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
  public colliders: RAPIER.Collider[] = [];
  public plateauBuildingGroups: THREE.Group[] = [];
  public glbStationGroup: THREE.Group | null = null;
  public glbTreeTemplate: THREE.Group | null = null;

  private roadBuilder: JapaneseRoadBuilder;
  private proceduralStationGroup: THREE.Group | null = null;
  private treeSlots: {
    slotGroup: THREE.Group;
    fallbackGroup: THREE.Group;
    scale: number;
    rotationY: number;
  }[] = [];
  private sharedFoliageMaterial: GinkgoFoliageMaterial;
  private sharedBarkMaterial: TreeBarkMaterial;
  private sharedGinkgoCanopyGeometry: THREE.BufferGeometry;

  constructor(scene: THREE.Scene, world: RAPIER.World, rapier: typeof RAPIER) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.roadBuilder = new JapaneseRoadBuilder();

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

    // 1. 日本の道路網（行幸通り、丸の内中央通り、日比谷通り）
    this.buildJapaneseRoadNetwork(world, rapier);

    // 2. 東京駅丸の内赤レンガ駅舎（GLBモデル読み込み + プロシージャル初期表示）
    this.buildTokyoStationBuilding(world, rapier);

    // 3. 周辺高層ビル群（丸ビル、新丸ビル、大手町・丸の内オフィス群）
    this.buildSurroundingSkyscrapers(world, rapier);

    // 4. 街灯・街路樹・環境小物
    this.buildStreetProps();

    // 5. 日本の道路標識（大型案内青看板、規制標識、警戒標識、指示標識、通称名標識）
    this.buildTokyoStreetSigns();

    // 6. 皇居のお堀（和田倉濠・日比谷濠）と水面シェーダー・石垣
    this.buildImperialPalaceMoat(world, rapier);
  }

  private buildJapaneseRoadNetwork(world: RAPIER.World, rapier: typeof RAPIER): void {
    // 基礎地面（800m × 800m）- 国土地理院 地理院タイル DEM5A (5mメッシュ標高) を反映した周辺地形ベース
    // How: 道路コリドー外周の頂点Y座標に DEM5A の実測標高変位を適用し、車道領域は Rapier コライダーと一致する y=0 を維持する
    const groundGeo = new THREE.PlaneGeometry(800, 800, 32, 32);
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
    groundMesh.position.y = -0.01;
    groundMesh.receiveShadow = true;
    this.group.add(groundMesh);

    // 地面コライダー（Rapier）
    const groundBodyDesc = rapier.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0);
    const groundBody = world.createRigidBody(groundBodyDesc);
    const groundColliderDesc = rapier.ColliderDesc.cuboid(400, 0.5, 400).setFriction(0.9);
    world.createCollider(groundColliderDesc, groundBody);

    // --- A. 行幸通り（メインアベニュー: 東京駅前広場から皇居へ向かうシンボル道路） ---
    // 往復各2車線 (laneWidth: 3.5m, shoulderWidth: 1.5m, sidewalkWidth: 4.5m, curbHeight: 0.15m)
    // 視覚: アスファルト骨材、補修パッチワーク、クラック、マンホール、水たまり凹凸
    // 物理: 完全平坦コライダー
    const gyokoConfig: JapaneseRoadSegmentConfig = {
      lanesPerDirection: 2,
      laneWidth: 3.5,
      shoulderWidth: 1.5,
      sidewalkWidth: 4.5,
      curbHeight: 0.15,
      length: 280,
      hasYellowCenterLine: true,
      hasWhiteDashedLines: true,
      hasCrosswalk: true,
      hasGuardrails: true,
      hasManholes: true,
      hasTrafficLights: true,
      speedLimitSign: 50,
    };
    const gyokoResult = this.roadBuilder.buildSegment(
      gyokoConfig,
      world,
      rapier,
      new THREE.Vector3(0, 0.01, 130),
      0,
    );
    this.group.add(gyokoResult.group);
    this.roadMaterials.push(...gyokoResult.materials);
    this.puddleMaterials.push(...gyokoResult.puddleMaterials);

    // --- B. 丸の内中央通り（駅前広場横断交差道路：行幸通りとの交差部を開口して左右に分割） ---
    // Why not: 1本の長尺セグメントを x = 0 にそのまま配置すると、行幸通りの車道と同一平面 (y = 0.01) で重なって
    // 激しい Z ファイティング縞模様が発生し、さらに交差道路の歩道・縁石が行幸通りの車線を塞いでしまうため、
    // 交差点（|x| <= 13.5m）を挟んだ東西2区間に分割して配置する。
    const centralArmLength = 95;
    const centralArmOffsetX = 13.5 + centralArmLength / 2; // 61.0m
    const centralAveConfig: JapaneseRoadSegmentConfig = {
      lanesPerDirection: 1,
      laneWidth: 3.25,
      shoulderWidth: 1.0,
      sidewalkWidth: 3.0,
      curbHeight: 0.15,
      length: centralArmLength,
      hasYellowCenterLine: true,
      hasWhiteDashedLines: false,
      hasCrosswalk: true,
      hasGuardrails: false,
      hasManholes: true,
      hasTrafficLights: true,
      speedLimitSign: 40,
    };
    for (const sideSign of [-1, 1]) {
      const centralArmResult = this.roadBuilder.buildSegment(
        centralAveConfig,
        world,
        rapier,
        new THREE.Vector3(sideSign * centralArmOffsetX, 0.012, 5),
        sideSign < 0 ? Math.PI / 2 : -Math.PI / 2,
      );
      this.group.add(centralArmResult.group);
      this.roadMaterials.push(...centralArmResult.materials);
      this.puddleMaterials.push(...centralArmResult.puddleMaterials);
    }

    // --- C. 日比谷通り（皇居外苑前大通り：和田倉門交差点の東西2区間に分割） ---
    const hibiyaArmLength = 105;
    const hibiyaArmOffsetX = 13.5 + hibiyaArmLength / 2; // 66.0m
    const hibiyaConfig: JapaneseRoadSegmentConfig = {
      lanesPerDirection: 3,
      laneWidth: 3.5,
      shoulderWidth: 1.5,
      sidewalkWidth: 4.0,
      curbHeight: 0.15,
      length: hibiyaArmLength,
      hasYellowCenterLine: true,
      hasWhiteDashedLines: true,
      hasCrosswalk: true,
      hasGuardrails: false,
      hasManholes: true,
      hasTrafficLights: true,
      speedLimitSign: 60,
    };
    for (const sideSign of [-1, 1]) {
      const hibiyaArmResult = this.roadBuilder.buildSegment(
        hibiyaConfig,
        world,
        rapier,
        new THREE.Vector3(sideSign * hibiyaArmOffsetX, 0.012, 250),
        sideSign < 0 ? Math.PI / 2 : -Math.PI / 2,
      );
      this.group.add(hibiyaArmResult.group);
      this.roadMaterials.push(...hibiyaArmResult.materials);
      this.puddleMaterials.push(...hibiyaArmResult.puddleMaterials);
    }

    // 丸の内駅前広場の石畳歩道（グレータイル・水たまりシェーダー適用：行幸通り南端 z = -10m の手前に配置）
    const plazaGeo = new THREE.PlaneGeometry(160, 28);
    plazaGeo.rotateX(-Math.PI / 2);
    const plazaMat = new PuddleMaterial({
      baseColor: 0x64748b,
      baseRoughness: 0.72,
      baseMetalness: 0.08,
      puddleThreshold: 0.44,
    });
    this.puddleMaterials.push(plazaMat);
    const plaza = new THREE.Mesh(plazaGeo, plazaMat);
    plaza.position.set(0, 0.025, -24.5);
    plaza.receiveShadow = true;
    this.group.add(plaza);

    // 行幸通りサイドエスプラネード石畳広場（丸の内中央通り〜日比谷通りの間の街区歩道外側に配置し、交差道路車道との重なりを回避）
    const esplanadeGeo = new THREE.PlaneGeometry(22, 208);
    esplanadeGeo.rotateX(-Math.PI / 2);
    const esplanadeMat = new PuddleMaterial({
      baseColor: 0x475569,
      baseRoughness: 0.75,
      baseMetalness: 0.1,
      puddleThreshold: 0.43,
    });
    this.puddleMaterials.push(esplanadeMat);

    const leftEsplanade = new THREE.Mesh(esplanadeGeo, esplanadeMat);
    leftEsplanade.position.set(-25, 0.02, 126);
    leftEsplanade.receiveShadow = true;
    this.group.add(leftEsplanade);

    const rightEsplanade = new THREE.Mesh(esplanadeGeo, esplanadeMat);
    rightEsplanade.position.set(25, 0.02, 126);
    rightEsplanade.receiveShadow = true;
    this.group.add(rightEsplanade);
  }

  /**
   * 建築石材・赤レンガ・お堀石垣マテリアルに 3D ボリュームテクスチャ (`sampler3D`) を注入する
   */
  private attachArchitecture3DVolumeShader(
    mat: THREE.MeshStandardMaterial,
    channel: "brick" | "granite" | "moat",
  ): void {
    const archVolumeTex = Procedural3DTextureGenerator.getSharedArchitecture3DTexture();
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uArchVolumeTex = { value: archVolumeTex };
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

      const channelExpr =
        channel === "brick" ? "archVol.r" : channel === "granite" ? "archVol.g" : "archVol.b";

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        uniform sampler3D uArchVolumeTex;
        varying vec3 vArchWorldPos;
        `,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        /* glsl */ `
        #include <color_fragment>
        vec4 archVol = texture(uArchVolumeTex, vArchWorldPos * 0.16);
        float grainVal = ${channelExpr};
        diffuseColor.rgb *= mix(0.84, 1.14, grainVal) * mix(0.90, 1.04, archVol.a);
        `,
      );
    };
  }

  private buildTokyoStationBuilding(world: RAPIER.World, rapier: typeof RAPIER): void {
    const stationGroup = new THREE.Group();
    stationGroup.position.set(0, 0, -45); // 丸の内駅前広場の東側
    this.proceduralStationGroup = stationGroup;

    // 赤レンガマテリアル（3D ボリュームテクスチャ統合）
    const redBrickMat = new THREE.MeshStandardMaterial({
      color: 0xb91c1c,
      roughness: 0.82,
      metalness: 0.05,
    });
    this.attachArchitecture3DVolumeShader(redBrickMat, "brick");

    // 白御影石トリム（3D ボリュームテクスチャ統合）
    const whiteStoneMat = new THREE.MeshStandardMaterial({
      color: 0xf3f4f6,
      roughness: 0.58,
      metalness: 0.1,
    });
    this.attachArchitecture3DVolumeShader(whiteStoneMat, "granite");

    // スレート屋根・ドーム（青緑銅板）
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x0f766e, // 酸化銅グリーン
      roughness: 0.45,
      metalness: 0.4,
    });

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
      stationGroup.add(stripe);
    }

    this.group.add(stationGroup);

    // 駅舎全体の物理コライダー（Rapier）
    const stationBodyDesc = rapier.RigidBodyDesc.fixed().setTranslation(0, 12, -45);
    const stationBody = world.createRigidBody(stationBodyDesc);
    const stationCollider = rapier.ColliderDesc.cuboid(165, 15, 15);
    world.createCollider(stationCollider, stationBody);

    // 4. Blender CLI で生成した PLATEAU 準拠 GLB 駅舎モデルの非同期ロード
    this.loadGlbStationModel();
  }

  private loadGlbStationModel(): void {
    const config = assetManager.getModelConfig("tokyo_station");
    const rawPath = config?.path ?? "/models/tokyo_station.glb";
    const modelPath = assetManager.resolveAssetUrl(rawPath);
    const loader = new GLTFLoader();
    loader.load(
      modelPath,
      (gltf) => {
        const glbModel = gltf.scene;
        const hasLoadedScene = Boolean(glbModel);
        if (!hasLoadedScene) {
          return;
        }

        const zOffset = config?.offset[2] ?? -45;
        glbModel.position.set(0, 0, zOffset);
        glbModel.traverse((child) => {
          const isMesh = (child as THREE.Mesh).isMesh;
          if (isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        this.glbStationGroup = glbModel;
        this.group.add(glbModel);

        // GLBモデルが正常に配置されたらプロシージャル駅舎を非表示に切り替え
        const hasProceduralGroup = Boolean(this.proceduralStationGroup);
        if (hasProceduralGroup) {
          this.proceduralStationGroup!.visible = false;
        }
      },
      undefined,
      (error) => {
        console.warn("Notice: Using procedural Tokyo Station model (GLB load skipped):", error);
      },
    );
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
    const crownLouverMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      metalness: 0.65,
      roughness: 0.35,
    });
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
      this.attachArchitecture3DVolumeShader(baseMat, "granite");
      const baseMesh = new THREE.Mesh(baseGeo, baseMat);
      baseMesh.position.y = -b.h / 2 + podiumHeight / 2;
      baseMesh.castShadow = true;
      baseMesh.receiveShadow = true;
      bGroup.add(baseMesh);

      // 1b. 低層1F〜2F 商業路面ショーウィンドウ＆コロネード（列柱）ディテール
      const storefrontGeo = new THREE.BoxGeometry(b.w * 0.96, 6.5, b.d * 0.96);
      const storefrontMat = new THREE.MeshStandardMaterial({
        color: b.warmInterior,
        emissive: b.warmInterior,
        emissiveIntensity: 0.38,
        roughness: 0.2,
      });
      const storefrontMesh = new THREE.Mesh(storefrontGeo, storefrontMat);
      storefrontMesh.position.y = -b.h / 2 + 3.6;
      bGroup.add(storefrontMesh);

      // ポディウム最上部のコーニス（31m 水平軒蛇腹）
      const corniceGeo = new THREE.BoxGeometry(b.w + 1.4, 1.4, b.d + 1.4);
      const corniceMesh = new THREE.Mesh(corniceGeo, baseMat);
      corniceMesh.position.y = -b.h / 2 + podiumHeight;
      bGroup.add(corniceMesh);

      // 2. セットバック高層タワー本体（オフィスビル・Low-E ガラスカーテンウォール）
      const towerW = b.w * 0.86;
      const towerD = b.d * 0.86;
      const towerCenterY = -b.h / 2 + podiumHeight + towerHeight / 2;
      const towerGeo = new THREE.BoxGeometry(towerW, towerHeight, towerD);
      const towerMat = new THREE.MeshPhysicalMaterial({
        color: b.color,
        metalness: 0.85,
        roughness: 0.14,
        reflectivity: 0.92,
        clearcoat: 0.85,
      });
      const towerMesh = new THREE.Mesh(towerGeo, towerMat);
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
        bGroup.add(mullionXMesh);

        const mullionZGeo = new THREE.BoxGeometry(towerW + 0.35, towerHeight, 0.45);
        const mullionZMesh = new THREE.Mesh(mullionZGeo, mullionMetalMat);
        mullionZMesh.position.set(0, towerCenterY, towerD * ratio);
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
      for (let i = 0; i < stripeCount; i++) {
        const stripeY =
          -b.h / 2 + podiumHeight + 3 + i * (Math.max(4, towerHeight - 5) / stripeCount);
        const stripeGeo = new THREE.BoxGeometry(towerW + 0.25, 1.05, towerD + 0.25);
        const stripeMesh = new THREE.Mesh(stripeGeo, stripeMat);
        stripeMesh.position.y = stripeY;
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
          bGroup.add(beaconMesh);
        }
      }

      this.group.add(bGroup);
      this.plateauBuildingGroups.push(bGroup);

      // 物理コライダー（Rapier）
      const bBodyDesc = rapier.RigidBodyDesc.fixed().setTranslation(b.x, b.h / 2, b.z);
      const bBody = world.createRigidBody(bBodyDesc);
      const bCollider = rapier.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2);
      world.createCollider(bCollider, bBody);
    }
  }

  private buildStreetProps(): void {
    // 行幸通りのイチョウ並木（歩道 |x| = 8.75m..13.25m の中央 x = ±11.5m に実寸 1.4m 保護桝が干渉なく収まる配置）
    const treePositions = [-11.5, 11.5, -19.5, 19.5];
    let treeIndex = 0;
    for (let z = 10; z < 250; z += 18) {
      for (const x of treePositions) {
        this.createGinkgoTree(x, z, treeIndex);
        treeIndex++;
      }
    }

    // Blender CLI 生成 GLB 街路樹モデルの非同期ロード＆全スロットへの展開
    this.loadBlenderStreetTreeGlb();

    // 街灯（夜間に点灯：丸の内・行幸通り特有の黒鋳鉄製2灯式クラシカル街灯、歩道外側 x = ±12.8m）
    for (let z = 5; z < 260; z += 35) {
      this.createStreetLamp(-12.8, z);
      this.createStreetLamp(12.8, z);
    }

    // 行幸通り石造ボラード（車止め御影石柱：歩道車道境界縁石 |x|=8.75m のすぐ内側 x = ±9.15m に実寸配置）
    this.buildGraniteBollards();
  }

  private buildGraniteBollards(): void {
    const graniteMat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1, // 白御影石（稲田石）
      roughness: 0.72,
      metalness: 0.08,
    });
    const bandMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b, // ブロンズ黒装飾リング
      roughness: 0.4,
      metalness: 0.85,
    });

    // 実寸ボラード（直径 28〜30cm = 半径 0.14〜0.15m、地上高約 0.85m）
    const postGeo = new THREE.CylinderGeometry(0.14, 0.15, 0.74, 12);
    const capGeo = new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const bandGeo = new THREE.CylinderGeometry(0.146, 0.146, 0.045, 12);

    for (let z = 8; z <= 240; z += 12) {
      for (const x of [-9.15, 9.15]) {
        const bollard = new THREE.Group();
        bollard.position.set(x, 0, z);

        const post = new THREE.Mesh(postGeo, graniteMat);
        post.position.y = 0.37;
        post.castShadow = true;
        post.receiveShadow = true;
        bollard.add(post);

        const cap = new THREE.Mesh(capGeo, graniteMat);
        cap.position.y = 0.74;
        bollard.add(cap);

        const band = new THREE.Mesh(bandGeo, bandMat);
        band.position.y = 0.62;
        bollard.add(band);

        this.group.add(bollard);
      }
    }
  }

  private createGinkgoTree(x: number, z: number, index: number): void {
    const slotGroup = new THREE.Group();
    slotGroup.position.set(x, 0, z);

    // 実寸 1:1 スケール基準（0.96 .. 1.04 の自然な個体差のみ付与）
    const scale = 0.96 + ((index * 37) % 9) * 0.01;
    const rotationY = ((index * 73) % 360) * (Math.PI / 180);

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
      branchMesh.castShadow = true;
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
    this.treeSlots.push({ slotGroup, fallbackGroup, scale, rotationY });
  }

  private loadBlenderStreetTreeGlb(): void {
    const isBrowser = typeof window !== "undefined";
    if (!isBrowser) {
      return;
    }

    const treeConfig = assetManager.getModelConfig("street_tree");
    const rawTreePath = treeConfig?.path ?? "/models/street_tree.glb";
    const resolvedTreeUrl = assetManager.resolveAssetUrl(rawTreePath);
    const loader = new GLTFLoader();

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
          const instance = template.clone(true);
          instance.scale.setScalar(slot.scale);
          instance.rotation.y = slot.rotationY;
          slot.fallbackGroup.visible = false;
          slot.slotGroup.add(instance);
        }
      },
      undefined,
      (error) => {
        console.warn("Notice: Using procedural Ginkgo trees (GLB tree load skipped):", error);
      },
    );
  }

  private createStreetLamp(x: number, z: number): void {
    const lampGroup = new THREE.Group();
    lampGroup.position.set(x, 0, z);

    // 丸の内・行幸通り伝統の黒鋳鉄製フルート装飾ポール＋台座
    const poleMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      metalness: 0.85,
      roughness: 0.28,
    });
    const baseGeo = new THREE.CylinderGeometry(0.18, 0.26, 0.9, 10);
    const base = new THREE.Mesh(baseGeo, poleMat);
    base.position.y = 0.45;
    lampGroup.add(base);

    const poleGeo = new THREE.CylinderGeometry(0.075, 0.12, 5.8, 10);
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = 3.1;
    pole.castShadow = true;
    lampGroup.add(pole);

    // 上部2灯式クラシカルブラケットアーム
    const armGeo = new THREE.BoxGeometry(1.3, 0.07, 0.07);
    const arm = new THREE.Mesh(armGeo, poleMat);
    arm.position.set(0, 5.75, 0);
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
      lampGroup.add(cap);
    }

    // 点光源
    const light = new THREE.PointLight(0xffecd2, 12.0, 30);
    light.position.set(x > 0 ? -0.58 : 0.58, 6.0, 0);
    lampGroup.add(light);
    this.streetLights.push(light);

    this.group.add(lampGroup);
  }

  private buildTokyoStreetSigns(): void {
    const signPlacements = assetManager.getSigns();
    const hasYamlSigns = signPlacements.length > 0;
    if (!hasYamlSigns) {
      // Why not: YAMLに標識設定が存在しない場合は何も配置せず早期リターン
      return;
    }

    const signs = new JapaneseRoadSigns();

    for (const p of signPlacements) {
      let signMesh: THREE.Group | null = null;
      const [x, _y, z] = p.position;

      const isOverhead = p.type === "overhead_guide";
      const isSpeedLimit = p.type === "speed_limit";
      const isStop = p.type === "stop";
      const isNoEntry = p.type === "no_entry";
      const isDirection = p.type === "direction_mandatory";
      const isTrafficLightAhead = p.type === "traffic_light_ahead";
      const isCrosswalk = p.type === "crosswalk";
      const isStreetName = p.type === "street_name";
      const isNoParking = p.type === "no_parking";
      const isNoStopping = p.type === "no_stopping";
      const isNoUTurn = p.type === "no_uturn";
      const isOneWay = p.type === "one_way";
      const isLaneDirection = p.type === "lane_direction";
      const isIntersectionName = p.type === "intersection_name";
      const isDelineator = p.type === "delineator";

      if (isOverhead) {
        signMesh = signs.createOverheadGuideSign(x, z, {
          straightText: p.label ?? "大手町",
          straightEn: p.subLabel ?? "Otemachi",
          rightText: "東京駅",
          rightEn: "Tokyo Sta.",
          roadNumber: "1",
          spanWidth: 16.0,
        });
      } else if (isSpeedLimit) {
        signMesh = signs.createSpeedLimitSign(x, z, p.speedLimit ?? 40, p.auxiliaryText);
      } else if (isStop) {
        signMesh = signs.createStopSign(x, z);
      } else if (isNoEntry) {
        signMesh = signs.createNoEntrySign(x, z);
      } else if (isDirection) {
        signMesh = signs.createDirectionSign(x, z, "straight-left");
      } else if (isTrafficLightAhead) {
        signMesh = signs.createWarningSignalSign(x, z);
      } else if (isCrosswalk) {
        signMesh = signs.createCrosswalkSign(x, z);
      } else if (isStreetName) {
        signMesh = signs.createStreetNameSign(
          x,
          z,
          p.label ?? "行幸通り",
          p.subLabel ?? "Gyoko-dori Ave.",
        );
      } else if (isNoParking) {
        signMesh = signs.createNoParkingSign(x, z, false, p.auxiliaryText ?? "終日");
      } else if (isNoStopping) {
        signMesh = signs.createNoParkingSign(x, z, true, p.auxiliaryText ?? "終日");
      } else if (isNoUTurn) {
        signMesh = signs.createNoUTurnSign(x, z, p.auxiliaryText ?? "終日");
      } else if (isOneWay) {
        signMesh = signs.createOneWaySign(x, z, p.auxiliaryText ?? "自転車を除く");
      } else if (isLaneDirection) {
        signMesh = signs.createLaneDirectionSign(x, z);
      } else if (isIntersectionName) {
        signMesh = signs.createIntersectionNameSign(
          x,
          z,
          p.label ?? "和田倉門",
          p.subLabel ?? "Wadakuramon",
        );
      } else if (isDelineator) {
        signMesh = signs.createDelineatorPost(x, z);
      }

      const hasMesh = signMesh !== null;
      if (hasMesh) {
        signMesh!.rotation.y = p.rotationY;
        this.group.add(signMesh!);
      }
    }
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
      this.group.add(waterMesh);

      // 2. お堀の石垣（土手・岸壁）
      const wallThickness = 2.0;
      const wallHeight = 2.5;

      // 道路側石垣（転落防止擁壁）
      const roadSideWallGeo = new THREE.BoxGeometry(m.w, wallHeight, wallThickness);
      const roadSideWall = new THREE.Mesh(roadSideWallGeo, stoneWallMat);
      roadSideWall.position.set(m.x, wallHeight / 2 - 1.0, m.z - m.d / 2);
      roadSideWall.castShadow = true;
      roadSideWall.receiveShadow = true;
      this.group.add(roadSideWall);

      // 石垣物理コライダー（Rapier: 車両の不用意なお堀転落を防止）
      const wallBodyDesc = rapier.RigidBodyDesc.fixed().setTranslation(
        m.x,
        wallHeight / 2 - 1.0,
        m.z - m.d / 2,
      );
      const wallBody = world.createRigidBody(wallBodyDesc);
      const wallCollider = rapier.ColliderDesc.cuboid(m.w / 2, wallHeight / 2, wallThickness / 2);
      world.createCollider(wallCollider, wallBody);

      // お堀底面コライダー（水底）
      const waterFloorBodyDesc = rapier.RigidBodyDesc.fixed().setTranslation(m.x, -2.5, m.z);
      const waterFloorBody = world.createRigidBody(waterFloorBodyDesc);
      const waterFloorCollider = rapier.ColliderDesc.cuboid(m.w / 2, 0.5, m.d / 2);
      world.createCollider(waterFloorCollider, waterFloorBody);
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
    for (let i = 0; i < this.streetLights.length; i++) {
      this.streetLights[i].intensity = isNight ? 22.0 : 0.0;
    }
  }
}

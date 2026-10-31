import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { JapaneseRoadBuilder } from "../roads/roadBuilder";
import { JapaneseRoadSigns } from "../roads/roadSigns";
import type { JapaneseRoadMaterial } from "../roads/japaneseRoadMaterial";
import type { JapaneseRoadSegmentConfig } from "../roads/types";
import { PuddleMaterial } from "../shaders/puddleShader";
import { WaterSurfaceMaterial } from "../shaders/waterShader";
import { assetManager } from "../assets/assetManager";

/**
 * 東京駅丸の内周辺 3D都市環境
 * 国土交通省/東京都オープンデータ（Project PLATEAU 3D都市モデル仕様準拠）
 * - 東京駅丸の内赤レンガ駅舎（Blender CLI生成GLBモデル & プロシージャル）
 * - 行幸通り（Gyoko-dori Avenue: 日本の道路規格準拠・凸凹シェーダー & 平坦Rapierコライダー）
 * - 丸の内中央通り & 日比谷通り（交差点・側溝・マンホール・ガードレール・横断歩道・信号機）
 * - 丸ビル・新丸ビル等の高層ビル群
 * - 街路樹（銀杏並木）、街灯
 */
export class TokyoStationMap {
  public group: THREE.Group;
  public roadMaterials: JapaneseRoadMaterial[] = [];
  public puddleMaterials: PuddleMaterial[] = [];
  public waterMaterials: WaterSurfaceMaterial[] = [];
  public streetLights: THREE.PointLight[] = [];
  public colliders: RAPIER.Collider[] = [];
  public glbStationGroup: THREE.Group | null = null;

  private roadBuilder: JapaneseRoadBuilder;
  private proceduralStationGroup: THREE.Group | null = null;

  constructor(scene: THREE.Scene, world: RAPIER.World, rapier: typeof RAPIER) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.roadBuilder = new JapaneseRoadBuilder();

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
    // 基礎地面（500m × 500m）- 道路以外の敷地・広場ベース
    const groundGeo = new THREE.PlaneGeometry(500, 500, 16, 16);
    groundGeo.rotateX(-Math.PI / 2);
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
    const groundColliderDesc = rapier.ColliderDesc.cuboid(250, 0.5, 250).setFriction(0.9);
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

    // --- B. 丸の内中央通り（駅前広場横断交差道路） ---
    // 往復各1車線 (z = 10m 付近、南北に走る)
    const centralAveConfig: JapaneseRoadSegmentConfig = {
      lanesPerDirection: 1,
      laneWidth: 3.25,
      shoulderWidth: 1.0,
      sidewalkWidth: 3.0,
      curbHeight: 0.15,
      length: 200,
      hasYellowCenterLine: true,
      hasWhiteDashedLines: false,
      hasCrosswalk: true,
      hasGuardrails: true,
      hasManholes: true,
      hasTrafficLights: true,
      speedLimitSign: 40,
    };
    const centralAveResult = this.roadBuilder.buildSegment(
      centralAveConfig,
      world,
      rapier,
      new THREE.Vector3(0, 0.01, 5),
      Math.PI / 2,
    );
    this.group.add(centralAveResult.group);
    this.roadMaterials.push(...centralAveResult.materials);

    // --- C. 日比谷通り（皇居外苑前大通り） ---
    // 往復各3車線 (z = 240m 付近、南北に走る広幅員道路)
    const hibiyaConfig: JapaneseRoadSegmentConfig = {
      lanesPerDirection: 3,
      laneWidth: 3.5,
      shoulderWidth: 1.5,
      sidewalkWidth: 4.0,
      curbHeight: 0.15,
      length: 220,
      hasYellowCenterLine: true,
      hasWhiteDashedLines: true,
      hasCrosswalk: true,
      hasGuardrails: true,
      hasManholes: true,
      hasTrafficLights: true,
      speedLimitSign: 60,
    };
    const hibiyaResult = this.roadBuilder.buildSegment(
      hibiyaConfig,
      world,
      rapier,
      new THREE.Vector3(0, 0.01, 250),
      Math.PI / 2,
    );
    this.group.add(hibiyaResult.group);
    this.roadMaterials.push(...hibiyaResult.materials);

    // 丸の内駅前広場の石畳歩道（グレータイル・水たまりシェーダー適用）
    const plazaGeo = new THREE.PlaneGeometry(160, 30);
    plazaGeo.rotateX(-Math.PI / 2);
    const plazaMat = new PuddleMaterial({
      baseColor: 0x9ca3af,
      baseRoughness: 0.72,
      baseMetalness: 0.08,
      puddleThreshold: 0.48,
    });
    this.puddleMaterials.push(plazaMat);
    const plaza = new THREE.Mesh(plazaGeo, plazaMat);
    plaza.position.set(0, 0.03, -15);
    this.group.add(plaza);
  }

  private buildTokyoStationBuilding(world: RAPIER.World, rapier: typeof RAPIER): void {
    const stationGroup = new THREE.Group();
    stationGroup.position.set(0, 0, -45); // 丸の内駅前広場の東側
    this.proceduralStationGroup = stationGroup;

    // 赤レンガマテリアル
    const redBrickMat = new THREE.MeshStandardMaterial({
      color: 0xb91c1c, // 赤レンガ色
      roughness: 0.85,
      metalness: 0.05,
    });

    // 白御影石トリム
    const whiteStoneMat = new THREE.MeshStandardMaterial({
      color: 0xf3f4f6,
      roughness: 0.6,
      metalness: 0.1,
    });

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
    const buildingPositions = [
      // 丸ビル（南西側）
      {
        name: "MaruBuilding",
        x: 50,
        z: 60,
        w: 55,
        h: 180,
        d: 55,
        color: 0x334155,
        glass: 0x93c5fd,
      },
      // 新丸ビル（北西側）
      {
        name: "ShinMaruBuilding",
        x: -50,
        z: 60,
        w: 58,
        h: 198,
        d: 58,
        color: 0x1e293b,
        glass: 0x60a5fa,
      },
      // 大手町方面オフィス群
      {
        name: "OtemachiTower1",
        x: -65,
        z: 150,
        w: 60,
        h: 160,
        d: 50,
        color: 0x334155,
        glass: 0x38bdf8,
      },
      {
        name: "OtemachiTower2",
        x: -70,
        z: 220,
        w: 55,
        h: 150,
        d: 55,
        color: 0x475569,
        glass: 0x7dd3fc,
      },
      // 丸の内仲通り・有楽町方面オフィス群
      {
        name: "MarunouchiTower1",
        x: 65,
        z: 150,
        w: 55,
        h: 170,
        d: 50,
        color: 0x1e293b,
        glass: 0x60a5fa,
      },
      {
        name: "MarunouchiTower2",
        x: 70,
        z: 220,
        w: 60,
        h: 140,
        d: 55,
        color: 0x334155,
        glass: 0x93c5fd,
      },
    ];

    for (const b of buildingPositions) {
      const bGroup = new THREE.Group();
      bGroup.position.set(b.x, b.h / 2, b.z);

      // 低層基底商業ゾーン
      const baseGeo = new THREE.BoxGeometry(b.w, 25, b.d);
      const baseMat = new THREE.MeshStandardMaterial({
        color: 0x64748b,
        roughness: 0.7,
      });
      const baseMesh = new THREE.Mesh(baseGeo, baseMat);
      baseMesh.position.y = -b.h / 2 + 12.5;
      baseMesh.castShadow = true;
      baseMesh.receiveShadow = true;
      bGroup.add(baseMesh);

      // 高層タワー本体（オフィスビル・カーテンウォール）
      const towerGeo = new THREE.BoxGeometry(b.w * 0.9, b.h - 25, b.d * 0.9);
      const towerMat = new THREE.MeshPhysicalMaterial({
        color: b.color,
        metalness: 0.85,
        roughness: 0.15,
        reflectivity: 0.9,
        clearcoat: 0.8,
      });
      const towerMesh = new THREE.Mesh(towerGeo, towerMat);
      towerMesh.position.y = 12.5;
      towerMesh.castShadow = true;
      towerMesh.receiveShadow = true;
      bGroup.add(towerMesh);

      // ガラスカーテンウォールの反射ライン
      const stripeCount = 12;
      for (let i = 0; i < stripeCount; i++) {
        const stripeY = -b.h / 2 + 35 + i * (b.h / stripeCount);
        const stripeGeo = new THREE.BoxGeometry(b.w * 0.92, 1.2, b.d * 0.92);
        const stripeMat = new THREE.MeshBasicMaterial({ color: b.glass });
        const stripeMesh = new THREE.Mesh(stripeGeo, stripeMat);
        stripeMesh.position.y = stripeY;
        bGroup.add(stripeMesh);
      }

      this.group.add(bGroup);

      // 物理コライダー（Rapier）
      const bBodyDesc = rapier.RigidBodyDesc.fixed().setTranslation(b.x, b.h / 2, b.z);
      const bBody = world.createRigidBody(bBodyDesc);
      const bCollider = rapier.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2);
      world.createCollider(bCollider, bBody);
    }
  }

  private buildStreetProps(): void {
    // 行幸通りのイチョウ並木（左右に配置）
    const treePositions = [-12, 12];
    for (let z = 10; z < 250; z += 18) {
      for (const x of treePositions) {
        this.createGinkgoTree(x, z);
      }
    }

    // 街灯（夜間に点灯）
    for (let z = 5; z < 260; z += 35) {
      this.createStreetLamp(-14, z);
      this.createStreetLamp(14, z);
    }
  }

  private createGinkgoTree(x: number, z: number): void {
    const treeGroup = new THREE.Group();
    treeGroup.position.set(x, 0, z);

    // 幹
    const trunkGeo = new THREE.CylinderGeometry(0.2, 0.35, 4.5, 8);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.9 });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 2.25;
    trunk.castShadow = true;
    treeGroup.add(trunk);

    // 樹冠（丸の内銀杏並木：黄金色〜鮮やかな黄緑）
    const foliageGeo = new THREE.ConeGeometry(2.2, 5.5, 8);
    const foliageMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15, // イチョウの黄色
      roughness: 0.65,
    });
    const foliage = new THREE.Mesh(foliageGeo, foliageMat);
    foliage.position.y = 5.5;
    foliage.castShadow = true;
    treeGroup.add(foliage);

    this.group.add(treeGroup);
  }

  private createStreetLamp(x: number, z: number): void {
    const lampGroup = new THREE.Group();
    lampGroup.position.set(x, 0, z);

    // ポール
    const poleMat = new THREE.MeshStandardMaterial({
      color: 0x1f2937,
      metalness: 0.8,
      roughness: 0.3,
    });
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.12, 6.0, 8);
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = 3.0;
    lampGroup.add(pole);

    // ランプヘッド
    const headGeo = new THREE.SphereGeometry(0.35, 12, 12);
    const headMat = new THREE.MeshBasicMaterial({ color: 0xffedd5 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.set(x > 0 ? -0.8 : 0.8, 6.0, 0);
    lampGroup.add(head);

    // 点光源
    const light = new THREE.PointLight(0xffecd2, 12.0, 30);
    light.position.copy(head.position);
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
        signMesh = signs.createSpeedLimitSign(x, z, p.speedLimit ?? 40);
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
      }

      const hasMesh = signMesh !== null;
      if (hasMesh) {
        signMesh!.rotation.y = p.rotationY;
        this.group.add(signMesh!);
      }
    }
  }

  private buildImperialPalaceMoat(world: RAPIER.World, rapier: typeof RAPIER): void {
    // 皇居のお堀（和田倉濠: 北側、日比谷濠: 南側）
    const moatConfigs = [
      { name: "WadakuraMoatNorth", x: -75, z: 280, w: 110, d: 55 },
      { name: "HibiyaMoatSouth", x: 75, z: 280, w: 110, d: 55 },
    ];

    // 石垣マテリアル（江戸城伝統の切込萩・巨石石垣）
    const stoneWallMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.85,
      metalness: 0.1,
    });

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
      waterMesh.position.set(m.x, -0.65, m.z);
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

  public updateRainWetness(wetness: number, time: number): void {
    for (let i = 0; i < this.roadMaterials.length; i++) {
      this.roadMaterials[i].uRainWetness.value = wetness;
      this.roadMaterials[i].uTime.value = time;
    }
    for (let i = 0; i < this.puddleMaterials.length; i++) {
      this.puddleMaterials[i].uRainWetness.value = wetness;
      this.puddleMaterials[i].uTime.value = time;
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

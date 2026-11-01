import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import { JapaneseRoadMaterial } from "./japaneseRoadMaterial";
import { PuddleMaterial } from "../shaders/puddleShader";
import { RoadMarkings } from "./roadMarkings";
import { RoadProps } from "./roadProps";
import type { JapaneseRoadSegmentConfig } from "./types";

/**
 * 日本の道路ジェネレーター＆ビルダー
 * 【コア仕様】
 * - ビジュアル：
 *   - アスファルト骨材、クラック（ひび割れ）、補修パッチワーク、マンホール段差によるリアルな「凸凹」
 *   - 車道（JapaneseRoadMaterial）と歩道（PuddleMaterial）の双方に物理ベース水たまり・波紋・平面鏡面反射を適用
 * - 物理コライダー：
 *   - 車道面は完全に「平ら（Flat）」な Rapier コライダーで構成し、
 *     高速走行時のスナッギング（引っかかり）や異常振動を完全に防止
 */
export class JapaneseRoadBuilder {
  private roadMaterials: JapaneseRoadMaterial[] = [];
  private puddleMaterials: PuddleMaterial[] = [];
  private markings: RoadMarkings;
  private props: RoadProps;

  constructor() {
    this.markings = new RoadMarkings();
    this.props = new RoadProps();
  }

  public buildSegment(
    config: JapaneseRoadSegmentConfig,
    world: RAPIER.World,
    rapier: typeof RAPIER,
    position: THREE.Vector3,
    rotationY = 0,
  ): {
    group: THREE.Group;
    materials: JapaneseRoadMaterial[];
    puddleMaterials: PuddleMaterial[];
  } {
    const group = new THREE.Group();
    group.position.copy(position);
    group.rotation.y = rotationY;

    // 車道幅の計算 (片側 lanes * laneWidth + shoulder * 2)
    const roadwayWidth = config.lanesPerDirection * 2 * config.laneWidth;
    const totalRoadWidth = roadwayWidth + config.shoulderWidth * 2;
    const halfRoadWidth = totalRoadWidth / 2;

    // 1. ビジュアル車道アスファルト（凸凹＆水たまり鏡面シェーダー適用）
    const roadMat = new JapaneseRoadMaterial({ baseRoughness: 0.85, baseMetalness: 0.12 });
    this.roadMaterials.push(roadMat);

    const roadGeo = new THREE.PlaneGeometry(totalRoadWidth, config.length, 16, 32);
    roadGeo.rotateX(-Math.PI / 2);
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.receiveShadow = true;
    group.add(roadMesh);

    // 2. 物理コライダー（★完全な平坦コライダー★）
    // 視覚的には凹凸があるが、物理面は段差のない滑らかな平坦面を作成
    const roadBodyDesc = rapier.RigidBodyDesc.fixed()
      .setTranslation(position.x, position.y, position.z)
      .setRotation(new rapier.Quaternion(0, Math.sin(rotationY / 2), 0, Math.cos(rotationY / 2)));
    const roadBody = world.createRigidBody(roadBodyDesc);

    // 車道コライダー（厚み 0.5m の直方体を平坦に敷設）
    const roadCollider = rapier.ColliderDesc.cuboid(totalRoadWidth / 2, 0.25, config.length / 2)
      .setTranslation(0, -0.25, 0)
      .setFriction(0.85)
      .setRestitution(0.02);
    world.createCollider(roadCollider, roadBody);

    // 3. 縁石（マウントアップコンクリートブロック）
    this.buildCurbs(group, config, halfRoadWidth);

    // 4. 歩道（インターロッキングブロック舗装 + 水たまりシェーダー）
    this.buildSidewalks(group, config, halfRoadWidth, world, rapier, roadBody);

    // 5. 道路標示（黄色中央線、白破線、路肩線、横断歩道）
    this.buildMarkings(group, config, halfRoadWidth);

    // 6. プロップ（マンホール、グレーチング、ガードレール、信号機、標識）
    this.buildProps(group, config, halfRoadWidth);

    return {
      group,
      materials: this.roadMaterials,
      puddleMaterials: this.puddleMaterials,
    };
  }

  private buildCurbs(
    group: THREE.Group,
    config: JapaneseRoadSegmentConfig,
    halfRoadWidth: number,
  ): void {
    const curbMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8, // 道路用コンクリートグレー
      roughness: 0.8,
      metalness: 0.1,
    });

    const curbWidth = 0.25; // 25cm幅
    const curbGeo = new THREE.BoxGeometry(curbWidth, config.curbHeight, config.length);

    // 左縁石
    const leftCurb = new THREE.Mesh(curbGeo, curbMat);
    leftCurb.position.set(-halfRoadWidth - curbWidth / 2, config.curbHeight / 2, 0);
    leftCurb.castShadow = true;
    leftCurb.receiveShadow = true;
    group.add(leftCurb);

    // 右縁石
    const rightCurb = new THREE.Mesh(curbGeo, curbMat);
    rightCurb.position.set(halfRoadWidth + curbWidth / 2, config.curbHeight / 2, 0);
    rightCurb.castShadow = true;
    rightCurb.receiveShadow = true;
    group.add(rightCurb);
  }

  private buildSidewalks(
    group: THREE.Group,
    config: JapaneseRoadSegmentConfig,
    halfRoadWidth: number,
    _world: RAPIER.World,
    rapier: typeof RAPIER,
    roadBody: RAPIER.RigidBody,
  ): void {
    const sidewalkMat = new PuddleMaterial({
      baseColor: 0x94a3b8, // 丸の内御影石・インターロッキングブロック調
      baseRoughness: 0.76,
      baseMetalness: 0.08,
      puddleThreshold: 0.46,
    });
    this.puddleMaterials.push(sidewalkMat);

    const swGeo = new THREE.BoxGeometry(config.sidewalkWidth, config.curbHeight, config.length);

    // 左歩道
    const leftX = -halfRoadWidth - 0.25 - config.sidewalkWidth / 2;
    const leftSidewalk = new THREE.Mesh(swGeo, sidewalkMat);
    leftSidewalk.position.set(leftX, config.curbHeight / 2, 0);
    leftSidewalk.receiveShadow = true;
    group.add(leftSidewalk);

    // 右歩道
    const rightX = halfRoadWidth + 0.25 + config.sidewalkWidth / 2;
    const rightSidewalk = new THREE.Mesh(swGeo, sidewalkMat);
    rightSidewalk.position.set(rightX, config.curbHeight / 2, 0);
    rightSidewalk.receiveShadow = true;
    group.add(rightSidewalk);

    // 歩道の物理コライダー（一段高い歩道面）
    const swColDesc = rapier.ColliderDesc.cuboid(
      config.sidewalkWidth / 2,
      config.curbHeight / 2,
      config.length / 2,
    ).setFriction(0.8);

    swColDesc.setTranslation(leftX, config.curbHeight / 2, 0);
    _world.createCollider(swColDesc, roadBody);

    const swColDescRight = rapier.ColliderDesc.cuboid(
      config.sidewalkWidth / 2,
      config.curbHeight / 2,
      config.length / 2,
    ).setFriction(0.8);
    swColDescRight.setTranslation(rightX, config.curbHeight / 2, 0);
    _world.createCollider(swColDescRight, roadBody);

    // 点字ブロック（歩道中央）
    const leftBraille = this.markings.createBrailleTiles(config.length, leftX, config.curbHeight);
    group.add(leftBraille);

    const rightBraille = this.markings.createBrailleTiles(config.length, rightX, config.curbHeight);
    group.add(rightBraille);
  }

  private buildMarkings(
    group: THREE.Group,
    config: JapaneseRoadSegmentConfig,
    halfRoadWidth: number,
  ): void {
    // 1. 中央線（追越し禁止黄色実線）
    const centerLine = this.markings.createCenterLine(config.length, true);
    group.add(centerLine);

    // 2. 車線境界白破線（複数車線の場合）
    const laneDividers: number[] = [];
    for (let i = 1; i < config.lanesPerDirection; i++) {
      laneDividers.push(-i * config.laneWidth);
      laneDividers.push(i * config.laneWidth);
    }
    const isMultiLane = laneDividers.length > 0;
    if (isMultiLane) {
      const lanes = this.markings.createLaneDividers(config.length, laneDividers);
      group.add(lanes);
    }

    // 3. 路肩白実線
    const shoulderLines = this.markings.createShoulderLines(
      config.length,
      -halfRoadWidth + config.shoulderWidth,
      halfRoadWidth - config.shoulderWidth,
    );
    group.add(shoulderLines);

    // 4. 横断歩道 ＋ 予告ダイヤマーク（◇）＋ 路面進行方向矢印 ＋ 路面速度制限ペイント
    const hasCrosswalks = config.hasCrosswalks;
    const crossZ = config.length * 0.25;
    if (hasCrosswalks) {
      // セグメント中央手前に横断歩道を配置
      const crosswalk = this.markings.createCrosswalk(
        halfRoadWidth * 2 - config.shoulderWidth * 2,
        crossZ,
      );
      group.add(crosswalk);

      // 横断歩道手前 22m & 38m に「横断歩道又は自転車横断帯あり」ダイヤマーク（◇）を配置
      const leftLaneCenter = -config.laneWidth * 0.5;
      const rightLaneCenter = config.laneWidth * 0.5;
      for (const offsetZ of [-22.0, -38.0]) {
        const diamondLeft = this.markings.createCrosswalkDiamondMarking(
          leftLaneCenter,
          crossZ + offsetZ,
        );
        group.add(diamondLeft);

        const diamondRight = this.markings.createCrosswalkDiamondMarking(
          rightLaneCenter,
          crossZ - offsetZ,
        );
        group.add(diamondRight);
      }
    }

    // 5. 車線進行方向矢印（直進・左折・右折）と路面速度ペイント（40 / 50）
    const speedVal = config.speedLimitSign ?? 50;
    const arrowZ = crossZ - 12.0;
    const isMultiLaneRoad = config.lanesPerDirection >= 2;
    if (isMultiLaneRoad) {
      // 左側通行・第1車線（左端）：直進＋左折、第2車線（中央寄り）：直進または右折
      const outerLeftX = -config.laneWidth * 1.5;
      const innerLeftX = -config.laneWidth * 0.5;
      group.add(this.markings.createLaneArrowMarking(outerLeftX, arrowZ, "straight-left", 0));
      group.add(this.markings.createLaneArrowMarking(innerLeftX, arrowZ, "straight", 0));

      // 対向車線
      const innerRightX = config.laneWidth * 0.5;
      const outerRightX = config.laneWidth * 1.5;
      group.add(this.markings.createLaneArrowMarking(innerRightX, crossZ + 12.0, "right", Math.PI));
      group.add(
        this.markings.createLaneArrowMarking(outerRightX, crossZ + 12.0, "straight-left", Math.PI),
      );

      // 路面最高速度標示
      group.add(
        this.markings.createSpeedLimitRoadMarking(innerLeftX, -config.length * 0.18, speedVal, 0),
      );
      group.add(
        this.markings.createSpeedLimitRoadMarking(
          innerRightX,
          config.length * 0.05,
          speedVal,
          Math.PI,
        ),
      );

      // 交差点手前の中央導流帯（ゼブラゾーン）
      const zebra = this.markings.createZebraZoneMarking(0.9, 14.0, crossZ - 14.0);
      group.add(zebra);
    } else {
      const laneX = -config.laneWidth * 0.5;
      group.add(this.markings.createLaneArrowMarking(laneX, arrowZ, "straight-left", 0));
      group.add(
        this.markings.createSpeedLimitRoadMarking(laneX, -config.length * 0.15, speedVal, 0),
      );
    }
  }

  private buildProps(
    group: THREE.Group,
    config: JapaneseRoadSegmentConfig,
    halfRoadWidth: number,
  ): void {
    const hasGuardrails = config.hasGuardrails;
    if (hasGuardrails) {
      // 縁石の内側（歩道側）にガードレール
      const leftGuard = this.props.createGuardrail(config.length);
      leftGuard.position.set(-halfRoadWidth - 0.15, config.curbHeight, 0);
      group.add(leftGuard);

      const rightGuard = this.props.createGuardrail(config.length);
      rightGuard.position.set(halfRoadWidth + 0.15, config.curbHeight, 0);
      group.add(rightGuard);
    }

    const hasManholes = config.hasManholes;
    if (hasManholes) {
      // 車道中央寄り・路肩寄りにマンホールを散在配置
      for (let z = -config.length / 3; z < config.length / 2; z += 45) {
        const mh = this.props.createManhole(config.laneWidth * 0.6, z);
        group.add(mh);

        const mhLeft = this.props.createManhole(-config.laneWidth * 0.7, z + 20);
        group.add(mhLeft);
      }
    }

    // 側溝グレーチング（路肩）
    for (let z = -config.length / 2 + 15; z < config.length / 2; z += 30) {
      const gratingLeft = this.props.createGrating(-halfRoadWidth + 0.35, z);
      group.add(gratingLeft);

      const gratingRight = this.props.createGrating(halfRoadWidth - 0.35, z);
      group.add(gratingRight);
    }

    const hasTrafficLights = config.hasTrafficLights;
    if (hasTrafficLights) {
      // 交差点・横断歩道前に日本の信号機を配置
      const trafficLight = this.props.createTrafficLight(
        halfRoadWidth + 0.4,
        config.length * 0.25 + 4.5,
        Math.PI,
      );
      group.add(trafficLight);

      // 信号機手前50mに「信号機あり」警戒標識（201-2）を設置
      const warningSign = this.props.signs.createWarningSignalSign(
        halfRoadWidth + 1.2,
        config.length * 0.25 - 45.0,
      );
      group.add(warningSign);
    }

    // 横断歩道指示標識（407: 青五角形屋根型）
    const hasCrosswalk = config.hasCrosswalk || config.hasCrosswalks;
    if (hasCrosswalk) {
      const crossSign = this.props.signs.createCrosswalkSign(
        halfRoadWidth + 1.2,
        config.length * 0.25,
      );
      group.add(crossSign);
    }

    // 速度制限標識（323: 規制標識）
    const limit = config.speedLimitSign ?? 50;
    const speedSign = this.props.createSpeedLimitSign(
      halfRoadWidth + 1.2,
      -config.length * 0.35,
      limit,
    );
    group.add(speedSign);

    // 通りの名称標識（119: 通称名標識）
    const hasRoadName = Boolean(config.name);
    if (hasRoadName) {
      const streetSign = this.props.signs.createStreetNameSign(
        halfRoadWidth + 1.2,
        -config.length * 0.45,
        config.name!,
        `${config.name!} Ave.`,
      );
      group.add(streetSign);
    }

    // 駐車禁止標識（316）＋ 補助標識「終日」を両側歩道に定期配置
    const noParkingLeft = this.props.signs.createNoParkingSign(
      -halfRoadWidth - 1.15,
      -config.length * 0.12,
      false,
      "終日",
    );
    group.add(noParkingLeft);

    const noParkingRight = this.props.signs.createNoParkingSign(
      halfRoadWidth + 1.15,
      config.length * 0.08,
      true,
      "ここまで",
    );
    noParkingRight.rotation.y = Math.PI;
    group.add(noParkingRight);

    // 交差点手前の「進行方向別通行区分」標識（327の7）とデリネーター（視線誘導標）
    const isMajorMultiLane = config.lanesPerDirection >= 2;
    if (isMajorMultiLane) {
      const laneDirSign = this.props.signs.createLaneDirectionSign(
        -halfRoadWidth - 1.35,
        config.length * 0.25 - 24.0,
      );
      group.add(laneDirSign);

      const delinNorth = this.props.signs.createDelineatorPost(0, config.length * 0.25 - 6.5);
      group.add(delinNorth);
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
  }
}

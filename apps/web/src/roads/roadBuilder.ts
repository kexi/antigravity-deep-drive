import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import { JapaneseRoadMaterial } from "./japaneseRoadMaterial";
import { PuddleMaterial } from "../shaders/puddleShader";
import { Procedural3DTextureGenerator } from "../textures/procedural3DTexture";
import { RoadMarkings, computeRoadLaneLayout } from "./roadMarkings";
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

  /**
   * 交差点パッド（アスファルト路面＋4方向横断歩道・交差点内誘導ドット破線・中央右折ガイド標示）を構築する
   */
  public buildIntersectionMarkingGroup(
    widthX: number,
    depthZ: number,
    options: {
      lanesX?: number;
      lanesZ?: number;
      hasCrosswalks?: boolean;
      hasCenterDiamond?: boolean;
      crosswalkN?: boolean;
      crosswalkS?: boolean;
      crosswalkE?: boolean;
      crosswalkW?: boolean;
      hasGuideDots?: boolean;
    } = {},
  ): THREE.Group {
    return this.markings.createIntersectionMarkings(widthX, depthZ, options);
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
    colliders: RAPIER.Collider[];
    obstacleColliderHandles: number[];
  } {
    const group = new THREE.Group();
    group.userData.isRoadInfrastructure = true;
    group.position.copy(position);
    group.rotation.y = rotationY;
    const segmentColliders: RAPIER.Collider[] = [];
    const obstacleColliderHandles: number[] = [];

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
    const createdRoadCol = world.createCollider(roadCollider, roadBody);
    segmentColliders.push(createdRoadCol);

    // 3. 縁石（マウントアップコンクリートブロック）
    this.buildCurbs(group, config, halfRoadWidth);

    // 4. 歩道（インターロッキングブロック舗装 + 水たまりシェーダー）
    this.buildSidewalks(group, config, halfRoadWidth, world, rapier, roadBody, segmentColliders);

    // 5. 道路標示（黄色中央線、白破線、路肩線、横断歩道）
    this.buildMarkings(group, config, halfRoadWidth);

    // 6. プロップ（マンホール、グレーチング、ガードレール、信号機、標識）および物理衝突コライダー
    this.buildProps(
      group,
      config,
      halfRoadWidth,
      world,
      rapier,
      roadBody,
      segmentColliders,
      obstacleColliderHandles,
    );

    return {
      group,
      materials: this.roadMaterials,
      puddleMaterials: this.puddleMaterials,
      colliders: segmentColliders,
      obstacleColliderHandles,
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
    this.applyCurb3DTexture(curbMat);

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

  /**
   * 縁石（マウントアップコンクリートブロック）へ 3D ボリュームテクスチャ（sampler3D）を注入する
   * How: 共有 3D テクスチャ（getSharedRoadMarkingProp3DTexture）を 3D ワールド座標でサンプリングし、
   * コンクリート骨材粒子、60cm ピッチの目地溝、縦方向の雨だれウェザリング、ラフネス変調、法線マイクロバンプを表現する。
   * Why not 2D UV テクスチャを使うか:
   * 長尺の BoxGeometry 縁石に 2D テクスチャを貼ると上面と側面で伸縮率の違いによる UV 引き伸ばしや継ぎ目が発生するため、
   * 3D ワールド空間座標で連続サンプリングするソリッドテクスチャ方式を採用した。
   */
  private applyCurb3DTexture(material: THREE.MeshStandardMaterial): void {
    const volumeTex = Procedural3DTextureGenerator.getSharedRoadMarkingProp3DTexture(32);
    material.userData.uRoadPropVolumeTex = volumeTex;
    material.customProgramCacheKey = () => "japanese-road-curb-3d-v2";

    material.onBeforeCompile = (shader) => {
      shader.uniforms.uRoadPropVolumeTex = { value: volumeTex };

      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        `#include <common>
varying vec3 vCurbWorldPos;
varying vec3 vCurbLocalPos;`,
      );

      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vCurbLocalPos = position;
vCurbWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;`,
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        `#include <common>
precision highp sampler3D;
uniform sampler3D uRoadPropVolumeTex;
varying vec3 vCurbWorldPos;
varying vec3 vCurbLocalPos;`,
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>
float curbCamDist = length(cameraPosition - vCurbWorldPos);
float curbAggregate = 0.5;
float jointGroove = 0.0;
float bottomGrime = 0.0;
vec4 curbVoxFine = vec4(0.5);
if (curbCamDist < 60.0) {
  vec4 curbVoxCoarse = texture(uRoadPropVolumeTex, vCurbWorldPos * vec3(1.8, 2.4, 0.9));
  curbVoxFine = texture(uRoadPropVolumeTex, vCurbWorldPos * 8.5 + vec3(0.19, 0.47, 0.83));
  curbAggregate = mix(curbVoxCoarse.a, curbVoxFine.r, 0.45);
  // 60cm 間隔のコンクリート縁石ブロック目地溝（スリット）
  float jointPhase = abs(fract(vCurbWorldPos.z / 0.6 + 0.5) - 0.5);
  jointGroove = 1.0 - smoothstep(0.0, 0.022, jointPhase);
  // 縁石下部・側面の縦方向雨だれ＆泥跳ねウェザリング
  float verticalStreak = texture(uRoadPropVolumeTex, vec3(vCurbWorldPos.x * 3.2, vCurbWorldPos.y * 0.65, vCurbWorldPos.z * 2.6)).a;
  bottomGrime = smoothstep(0.14, -0.06, vCurbLocalPos.y) * (0.55 + 0.45 * verticalStreak);
  float curbShade = 0.86 + (curbAggregate - 0.5) * 0.26 - jointGroove * 0.34 - bottomGrime * 0.18;
  diffuseColor.rgb *= clamp(curbShade, 0.48, 1.15);
}`,
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <metalnessmap_fragment>",
        `#include <metalnessmap_fragment>
if (curbCamDist < 60.0) {
  roughnessFactor = clamp(roughnessFactor + (0.5 - curbAggregate) * 0.16 + jointGroove * 0.14 + bottomGrime * 0.12, 0.45, 0.98);
  metalnessFactor = clamp(metalnessFactor * (1.0 - jointGroove * 0.5), 0.02, 0.25);
}`,
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
if (curbCamDist < 36.0) {
  // Why not dFdx(vCurbWorldPos) * dFdx(curbHeightSignal) を使うか:
  // 浅い視線角度（グレージング角）やポリゴンエッジで dFdx(worldPos) が数十mになり、
  // ビュースペースの normal と逆向きに相殺して normalize(0) -> NaN の白フラッシュを発生させるため、
  // 3D ボリュームの有界な差分を viewMatrix でビュースペースへ変換して安全に摂動を加える。
  vec3 curbMicroShift = vec3(
    (curbVoxFine.r - 0.5) * 0.09,
    0.0,
    (curbVoxFine.g - 0.5) * 0.09 - jointGroove * 0.08
  );
  vec3 curbViewPerturb = mat3(viewMatrix) * curbMicroShift;
  vec3 curbCombinedN = normal + clamp(curbViewPerturb, vec3(-0.14), vec3(0.14));
  normal = curbCombinedN / max(length(curbCombinedN), 0.001);
}`,
      );
    };
    material.needsUpdate = true;
  }

  private buildSidewalks(
    group: THREE.Group,
    config: JapaneseRoadSegmentConfig,
    halfRoadWidth: number,
    world: RAPIER.World,
    rapier: typeof RAPIER,
    roadBody: RAPIER.RigidBody,
    segmentColliders: RAPIER.Collider[],
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

    // 歩道および縁石の物理コライダー（縁石 0.25m 幅も含めた一段高い歩道面）
    const totalSidewalkColliderWidth = config.sidewalkWidth + 0.25;
    const leftColliderX = -halfRoadWidth - totalSidewalkColliderWidth / 2;
    const rightColliderX = halfRoadWidth + totalSidewalkColliderWidth / 2;

    const swColDesc = rapier.ColliderDesc.cuboid(
      totalSidewalkColliderWidth / 2,
      config.curbHeight / 2,
      config.length / 2,
    ).setFriction(0.8);

    swColDesc.setTranslation(leftColliderX, config.curbHeight / 2, 0);
    segmentColliders.push(world.createCollider(swColDesc, roadBody));

    const swColDescRight = rapier.ColliderDesc.cuboid(
      totalSidewalkColliderWidth / 2,
      config.curbHeight / 2,
      config.length / 2,
    ).setFriction(0.8);
    swColDescRight.setTranslation(rightColliderX, config.curbHeight / 2, 0);
    segmentColliders.push(world.createCollider(swColDescRight, roadBody));

    // 横断歩道接続部（歩道巻き込み部）の点字警告ブロック（JIS T 9251）
    // Why not 歩道中央（leftX / rightX）に全長連続の黄色帯を敷くか:
    // 歩道の中央に道路全長（100m〜164m）の黄色ラインを引くと、ドライバー視点で「歩道の上に黄色の車線が引かれている」ように見えるため、
    // 実際の日本の都市歩道（道路移動等円滑化基準）に則り、横断歩道接続部の歩道縁石際（車道端から 0.65m 歩道側）にのみ警告ブロックを配置する。
    const hasCrosswalks = Boolean(config.hasCrosswalks || config.hasCrosswalk);
    if (hasCrosswalks) {
      const crossZ = config.length * 0.25;
      const southCrossZ = -config.length * 0.14;
      const hasSouthCrosswalk = config.lanesPerDirection >= 2 && config.length >= 120;
      const crosswalkZPositions = hasSouthCrosswalk ? [crossZ, southCrossZ] : [crossZ];
      const tactileCurbOffset = Math.min(0.65, config.sidewalkWidth * 0.45);
      const leftTactileX = -halfRoadWidth - 0.25 - tactileCurbOffset;
      const rightTactileX = halfRoadWidth + 0.25 + tactileCurbOffset;

      const leftBraille = this.markings.createBrailleTiles(
        config.length,
        leftTactileX,
        config.curbHeight,
        crosswalkZPositions,
      );
      leftBraille.userData.lodDetailTier = "high";
      group.add(leftBraille);

      const rightBraille = this.markings.createBrailleTiles(
        config.length,
        rightTactileX,
        config.curbHeight,
        crosswalkZPositions,
      );
      rightBraille.userData.lodDetailTier = "high";
      group.add(rightBraille);
    }
  }

  private buildMarkings(
    group: THREE.Group,
    config: JapaneseRoadSegmentConfig,
    halfRoadWidth: number,
  ): void {
    const hasCrosswalks = Boolean(config.hasCrosswalks || config.hasCrosswalk);
    const crossZ = config.length * 0.25;
    const southCrossZ = -config.length * 0.14;
    // Why 長さ 120m 以上の幹線道路のみ第2横断歩道（southCrosswalk）を設けるか:
    // 58m〜90m の中短距離セグメントで crossZ と southCrossZ の両方を入れると、
    // 停止線・予告ダイヤ（◇）・進行方向矢印・速度標示（40/50）が互いに重なって破綻するため。
    // 一方 138m（行幸通り・丸の内中央口）や 164m（明治通り・渋谷ストリーム前）では
    // southCrossZ = -0.14 * length の信号機と対になる横断歩道を設置できる十分な縦断長がある。
    const hasSouthCrosswalk =
      hasCrosswalks && config.lanesPerDirection >= 2 && config.length >= 120;

    const crosswalkZPositions: number[] = [];
    if (hasCrosswalks) {
      crosswalkZPositions.push(crossZ);
      if (hasSouthCrosswalk) {
        crosswalkZPositions.push(southCrossZ);
      }
    }

    const isMultiLaneRoad = config.lanesPerDirection >= 2;
    const hasZebraZone = isMultiLaneRoad && config.length >= 75 && hasCrosswalks;
    const zebraLen = 8.0;
    // Why crossZ - 10.5m に導流帯（長さ 8.0m → [crossZ - 14.5, crossZ - 6.5]）を置くか:
    // 停止線が crossZ - 3.8m（外端 crossZ - 4.025m）にあるため、導流帯北端（crossZ - 6.5m）との間に
    // 2.475m のクリアランスを確保し、導流帯と停止線・横断歩道が重ならないようにする。
    const zebraCenterZ = crossZ - 10.5;
    const zebraZoneZRanges: Array<[number, number]> = [];
    if (hasZebraZone) {
      // 導流帯（zebraCenterZ ± 4.0m）から横断歩道北端（crossZ + 5.2m）までを連続して除外し、
      // 導流帯と横断歩道の間の隙間に黄色中央線の切れ端が残らないようにする
      zebraZoneZRanges.push([zebraCenterZ - zebraLen * 0.5 - 0.6, crossZ + 5.2]);
    }

    // 車線レイアウト計算（各車線の中心X座標・境界X・横断歩道/交差点端部の非重複除外Z区間を一元算出）
    const laneLayout = computeRoadLaneLayout({
      lanesPerDirection: config.lanesPerDirection,
      laneWidth: config.laneWidth,
      length: config.length,
      crosswalkZPositions,
      zebraZoneZRanges,
      segmentEndExclusionBuffer: 1.5,
      crosswalkExclusionHalfSpan: 5.2,
    });
    group.userData.laneLayout = laneLayout;

    // 1. 中央線（道路交通法第17条第4項・警察庁交通規制基準に基づき、片側2車線以上は白実線、片側1車線は追越し禁止黄色実線または白破線：横断歩道・停止線・中央導流帯・セグメント端部は除外）
    const isYellowNoPassing = config.hasYellowCenterLine ?? true;
    const centerLine = this.markings.createCenterLine(
      config.length,
      isYellowNoPassing,
      laneLayout.centerLineExcludeZRanges,
      config.lanesPerDirection,
    );
    group.add(centerLine);

    // 2. 車線境界線（複数車線の場合：横断歩道・停止線手前30mは道路交通法第26条の2・第30条の「進路変更禁止（規制標示 102の2）」黄色実線、それ以外は車両通行帯境界線（区画線 102）白破線）
    const shouldDrawLaneDividers =
      config.hasWhiteDashedLines !== false && laneLayout.laneDividerOffsets.length > 0;
    if (shouldDrawLaneDividers) {
      const lanes = this.markings.createLaneDividers(
        config.length,
        laneLayout.laneDividerOffsets,
        laneLayout.crosswalkExcludeZRanges,
        {
          inboundYellowZRanges: laneLayout.inboundNoLaneChangeZRanges,
          oncomingYellowZRanges: laneLayout.oncomingNoLaneChangeZRanges,
        },
      );
      group.add(lanes);
    }

    // 3. 路肩白実線（横断歩道・停止線・セグメント端部は除外）
    const shoulderLines = this.markings.createShoulderLines(
      config.length,
      -halfRoadWidth + config.shoulderWidth,
      halfRoadWidth - config.shoulderWidth,
      laneLayout.crosswalkExcludeZRanges,
    );
    group.add(shoulderLines);

    // 同一車線上で路面標示同士（矢印・ダイヤ◇・速度ペイント・横断歩道・停止線）が絶対に重ならないよう占有 Z 座標を管理
    const halfSegLen = config.length * 0.5 - 5.0;
    const occupiedByLane = new Map<string, Array<[number, number]>>();
    const laneKey = (x: number): string => x.toFixed(2);
    const registerLaneSpan = (x: number, zCenter: number, halfSpanZ: number): boolean => {
      const isWithinSegment =
        zCenter - halfSpanZ >= -halfSegLen && zCenter + halfSpanZ <= halfSegLen;
      if (!isWithinSegment) {
        return false;
      }
      const isInsideCrosswalkOrEndExclusion = laneLayout.crosswalkExcludeZRanges.some(
        ([minZ, maxZ]) => zCenter + halfSpanZ > minZ - 1.2 && zCenter - halfSpanZ < maxZ + 1.2,
      );
      if (isInsideCrosswalkOrEndExclusion) {
        return false;
      }
      const key = laneKey(x);
      const list = occupiedByLane.get(key) ?? [];
      const hasCollision = list.some(
        ([minZ, maxZ]) => zCenter + halfSpanZ > minZ && zCenter - halfSpanZ < maxZ,
      );
      if (hasCollision) {
        return false;
      }
      list.push([zCenter - halfSpanZ, zCenter + halfSpanZ]);
      occupiedByLane.set(key, list);
      return true;
    };

    // 4. 横断歩道（白ゼブラ + 停止線：中央線・路肩線・車線境界線とは重ならないクリアランス付き）
    if (hasCrosswalks) {
      const crosswalk = this.markings.createCrosswalk(laneLayout.carriagewayWidth, crossZ);
      group.add(crosswalk);

      if (hasSouthCrosswalk) {
        const southCrosswalk = this.markings.createCrosswalk(
          laneLayout.carriagewayWidth,
          southCrossZ,
        );
        group.add(southCrosswalk);
      }
    }

    // 5. 中央導流帯（ゼブラゾーン：複数車線道路の右折レーン手前）
    if (hasZebraZone) {
      const zebra = this.markings.createZebraZoneMarking(0.75, zebraLen, zebraCenterZ);
      group.add(zebra);
    }

    // 6. 全車線（1〜3+車線すべて）への進行方向矢印・横断歩道予告ダイヤ（◇）・最高速度標示の非重複配置
    // Why not rotationY = 0 for inbound (+Z) lanes:
    // RoadMarkings の Plane は rotateX(-Math.PI / 2) で地面に寝かせるため、rotationY = 0 だと上端が -Z（対向側）を向く。
    // +Z 方向へ走る自車車線（x > 0）から正立して見え、かつ「直進＋左折」が左（+X）へ分岐するよう rotationY = Math.PI とする。
    const arrowZ = crossZ - 9.5;
    const oncomingArrowZ = crossZ + 9.5;
    const southArrowZ = southCrossZ - 9.5;
    const southOncomingArrowZ = southCrossZ + 9.5;

    for (const lane of laneLayout.lanes) {
      const isInbound = lane.direction === "inbound";
      const primaryArrowZ = isInbound ? arrowZ : oncomingArrowZ;
      if (registerLaneSpan(lane.centerX, primaryArrowZ, 3.6)) {
        group.add(
          this.markings.createLaneArrowMarking(
            lane.centerX,
            primaryArrowZ,
            lane.arrowType,
            lane.rotationY,
          ),
        );
      }

      if (hasSouthCrosswalk) {
        const secondaryArrowZ = isInbound ? southArrowZ : southOncomingArrowZ;
        // 第2横断歩道では中央寄り車線は直進（straight）、最外車線は直進＋左折とする
        const secondaryArrowType =
          lane.laneIndex === config.lanesPerDirection - 1 && config.lanesPerDirection >= 2
            ? "straight-left"
            : "straight";
        if (registerLaneSpan(lane.centerX, secondaryArrowZ, 3.6)) {
          group.add(
            this.markings.createLaneArrowMarking(
              lane.centerX,
              secondaryArrowZ,
              secondaryArrowType,
              lane.rotationY,
            ),
          );
        }
      }
    }

    // 7. 横断歩道予告ダイヤマーク（◇）：横断歩道手前 18.5m & 34.5m（占有半径 3.4m で衝突チェック）
    if (hasCrosswalks) {
      for (const lane of laneLayout.lanes) {
        const isInbound = lane.direction === "inbound";
        for (const distFromCrosswalk of [18.5, 34.5]) {
          const targetZ = isInbound ? crossZ - distFromCrosswalk : crossZ + distFromCrosswalk;
          if (registerLaneSpan(lane.centerX, targetZ, 3.4)) {
            group.add(this.markings.createCrosswalkDiamondMarking(lane.centerX, targetZ));
          }
        }

        if (hasSouthCrosswalk && isInbound) {
          for (const southDist of [18.5, 31.5]) {
            const targetSouthZ = southCrossZ - southDist;
            if (registerLaneSpan(lane.centerX, targetSouthZ, 3.4)) {
              group.add(this.markings.createCrosswalkDiamondMarking(lane.centerX, targetSouthZ));
            }
          }
        }
      }
    }

    // 8. 路面最高速度標示（40 / 50）：既存の矢印・ダイヤ（◇）・横断歩道と最低 4.2m 以上の間隔が空く候補位置を選択
    const speedVal = config.speedLimitSign ?? 50;
    const inboundSpeedCandidates = [
      crossZ - 26.5,
      crossZ - 42.5,
      -config.length * 0.28,
      -config.length * 0.36,
      0,
    ];
    const oncomingSpeedCandidates = [
      crossZ + 26.5,
      crossZ - 26.5,
      -config.length * 0.08,
      -config.length * 0.24,
    ];

    for (const lane of laneLayout.lanes) {
      const isInbound = lane.direction === "inbound";
      const candidates = isInbound ? inboundSpeedCandidates : oncomingSpeedCandidates;
      for (const candZ of candidates) {
        if (registerLaneSpan(lane.centerX, candZ, 4.2)) {
          group.add(
            this.markings.createSpeedLimitRoadMarking(
              lane.centerX,
              candZ,
              speedVal,
              lane.rotationY,
            ),
          );
          break;
        }
      }
    }
  }

  /**
   * 道路セグメント名（config.name）から道路標識令準拠の通称名標識（119-A）および地点名標識（114-A）の和英表記を解決する
   * How: 渋谷エリア（明治通り・国道246号・稲荷橋通り・並木橋通り等）や丸の内エリア（行幸通り・日比谷通り・内堀通り・永代通り等）の
   * 実在路線名・交差点名へマッピングし、全信号機が「東京駅丸の内中央口」固定になる不整合を防ぐ。
   */
  private resolveRoadSignLocalizedLabels(roadName?: string): {
    streetJa: string;
    streetEn: string;
    northIntersectionJa: string;
    northIntersectionEn: string;
    southIntersectionJa: string;
    southIntersectionEn: string;
  } {
    const rawName = roadName ?? "";
    const isMeijiShibuya = rawName.includes("Meiji-dori");
    if (isMeijiShibuya) {
      return {
        streetJa: "明治通り",
        streetEn: "Meiji-dori Ave.",
        northIntersectionJa: "渋谷駅東口",
        northIntersectionEn: "Shibuya Sta. East",
        southIntersectionJa: "渋谷ストリーム前",
        southIntersectionEn: "Shibuya Stream",
      };
    }

    const isRoute246 = rawName.includes("Route-246") || rawName.includes("246");
    if (isRoute246) {
      return {
        streetJa: "青山通り (国道246号)",
        streetEn: "Aoyama-dori (Route 246)",
        northIntersectionJa: "宮益坂下",
        northIntersectionEn: "Miyamasuzaka-shita",
        southIntersectionJa: "金王坂上",
        southIntersectionEn: "Konnozaka-ue",
      };
    }

    const isInaribashi = rawName.includes("Inaribashi");
    if (isInaribashi) {
      return {
        streetJa: "稲荷橋通り",
        streetEn: "Inaribashi-dori St.",
        northIntersectionJa: "渋谷ストリーム前",
        northIntersectionEn: "Shibuya Stream",
        southIntersectionJa: "稲荷橋",
        southIntersectionEn: "Inaribashi",
      };
    }

    const isNamikibashi = rawName.includes("Namikibashi");
    if (isNamikibashi) {
      return {
        streetJa: "並木橋通り",
        streetEn: "Namikibashi-dori St.",
        northIntersectionJa: "並木橋",
        northIntersectionEn: "Namikibashi",
        southIntersectionJa: "渋谷三丁目",
        southIntersectionEn: "Shibuya 3-chome",
      };
    }

    const isMiyashita = rawName.includes("Miyashita");
    if (isMiyashita) {
      return {
        streetJa: "宮下公園通り",
        streetEn: "Miyashita Park St.",
        northIntersectionJa: "宮下公園前",
        northIntersectionEn: "Miyashita Park",
        southIntersectionJa: "美竹通り",
        southIntersectionEn: "Mitake-dori",
      };
    }

    const isSakuragaoka = rawName.includes("Sakuragaoka");
    if (isSakuragaoka) {
      return {
        streetJa: "さくら坂・桜丘通り",
        streetEn: "Sakuragaoka St.",
        northIntersectionJa: "渋谷駅西口",
        northIntersectionEn: "Shibuya Sta. West",
        southIntersectionJa: "桜丘町",
        southIntersectionEn: "Sakuragaokacho",
      };
    }

    const isKonnozaka = rawName.includes("Konnozaka");
    if (isKonnozaka) {
      return {
        streetJa: "金王坂通り",
        streetEn: "Konnozaka St.",
        northIntersectionJa: "金王坂下",
        northIntersectionEn: "Konnozaka-shita",
        southIntersectionJa: "渋谷三丁目東",
        southIntersectionEn: "Shibuya 3 East",
      };
    }

    const isHibiya = rawName.includes("Hibiya");
    if (isHibiya) {
      return {
        streetJa: "日比谷通り",
        streetEn: "Hibiya-dori Ave.",
        northIntersectionJa: "和田倉門",
        northIntersectionEn: "Wadakuramon",
        southIntersectionJa: "馬場先門",
        southIntersectionEn: "Babasakimon",
      };
    }

    const isUchibori = rawName.includes("Uchibori") || rawName.includes("Kokyo");
    if (isUchibori) {
      return {
        streetJa: "内堀通り",
        streetEn: "Uchibori-dori Ave.",
        northIntersectionJa: "二重橋前",
        northIntersectionEn: "Nijubashimae",
        southIntersectionJa: "皇居外苑",
        southIntersectionEn: "Kokyo Gaien",
      };
    }

    const isEitai = rawName.includes("Eitai");
    if (isEitai) {
      return {
        streetJa: "永代通り",
        streetEn: "Eitai-dori Ave.",
        northIntersectionJa: "大手町",
        northIntersectionEn: "Otemachi",
        southIntersectionJa: "東京駅日本橋口",
        southIntersectionEn: "Nihombashi Exit",
      };
    }

    const isKajibashi = rawName.includes("Kajibashi") || rawName.includes("Babasakimon");
    if (isKajibashi) {
      return {
        streetJa: "鍛冶橋通り",
        streetEn: "Kajibashi-dori Ave.",
        northIntersectionJa: "馬場先門",
        northIntersectionEn: "Babasakimon",
        southIntersectionJa: "鍛冶橋",
        southIntersectionEn: "Kajibashi",
      };
    }

    const isNakaDori = rawName.includes("Naka-dori");
    if (isNakaDori) {
      return {
        streetJa: "丸の内仲通り",
        streetEn: "Marunouchi Naka-dori",
        northIntersectionJa: "丸の内仲通り",
        northIntersectionEn: "Marunouchi Naka-dori",
        southIntersectionJa: "丸ビル前",
        southIntersectionEn: "Marunouchi Bldg.",
      };
    }

    const isCentralAve = rawName.includes("Central-Ave");
    if (isCentralAve) {
      return {
        streetJa: "丸の内中央通り",
        streetEn: "Marunouchi Chuo-dori",
        northIntersectionJa: "東京駅丸の内中央口",
        northIntersectionEn: "Tokyo Sta. Central",
        southIntersectionJa: "丸の内北口",
        southIntersectionEn: "Marunouchi North",
      };
    }

    return {
      streetJa: "行幸通り",
      streetEn: "Gyoko-dori Ave.",
      northIntersectionJa: "東京駅丸の内中央口",
      northIntersectionEn: "Tokyo Sta. Central",
      southIntersectionJa: "行幸通り前",
      southIntersectionEn: "Gyoko-dori",
    };
  }

  private buildProps(
    group: THREE.Group,
    config: JapaneseRoadSegmentConfig,
    halfRoadWidth: number,
    world: RAPIER.World,
    rapier: typeof RAPIER,
    roadBody: RAPIER.RigidBody,
    segmentColliders: RAPIER.Collider[],
    obstacleColliderHandles: number[],
  ): void {
    const signLabels = this.resolveRoadSignLocalizedLabels(config.name);
    const createPoleCylinderDesc = (halfH: number, radius: number) => {
      const hasCylinder = typeof rapier.ColliderDesc.cylinder === "function";
      return hasCylinder
        ? rapier.ColliderDesc.cylinder(halfH, radius)
        : rapier.ColliderDesc.cuboid(radius, halfH, radius);
    };

    const registerObstacleCollider = (desc: RAPIER.ColliderDesc): void => {
      const col = world.createCollider(desc, roadBody);
      segmentColliders.push(col);
      const hasValidHandle = typeof col?.handle === "number";
      if (hasValidHandle) {
        obstacleColliderHandles.push(col.handle);
      }
    };

    const hasGuardrails = config.hasGuardrails;
    if (hasGuardrails) {
      // 縁石の内側（歩道側）にガードレールを配置する。
      // Why not 全長 config.length の単一ガードレールをそのまま置くか:
      // 横断歩道（crossZ = length * 0.25 および southCrossZ = -length * 0.14）の前に連続ガードレールがあると
      // 歩行者が歩道から横断歩道へ出入りできないため、横断歩道前後（±4.2m）およびセグメント両端を切り欠いて分割配置する。
      // また、ガードレールは +X 側が車道面（Wビーム表面・丸頭ボルト）、-X 側が歩道面（支柱・Ωブラケット・袖ビーム巻き込み）として造形されているため、
      // 右側歩道（+X 側、車道は -X 方向）では rotation.y = Math.PI に反転させて両側ともWビーム表面が車道側を向くようにする。
      const endTrim = 2.0;
      const crosswalkClearanceHalfSpan = 4.2;
      const minGuardSpanLength = 4.0;
      const crosswalkOpeningsZ: number[] = [];
      if (config.hasCrosswalk) {
        const hasSouthCrosswalk = config.lanesPerDirection >= 2 && config.length >= 120;
        if (hasSouthCrosswalk) {
          crosswalkOpeningsZ.push(-config.length * 0.14);
        }
        crosswalkOpeningsZ.push(config.length * 0.25);
      }

      const guardSpans: Array<[number, number]> = [];
      let spanCursorZ = -config.length / 2 + endTrim;
      const maxSpanEndZ = config.length / 2 - endTrim;

      for (const cwZ of crosswalkOpeningsZ) {
        const gapStartZ = cwZ - crosswalkClearanceHalfSpan;
        const gapEndZ = cwZ + crosswalkClearanceHalfSpan;
        const hasValidBeforeSpan = gapStartZ - spanCursorZ >= minGuardSpanLength;
        if (hasValidBeforeSpan) {
          guardSpans.push([spanCursorZ, gapStartZ]);
        }
        spanCursorZ = Math.max(spanCursorZ, gapEndZ);
      }

      const hasValidTailSpan = maxSpanEndZ - spanCursorZ >= minGuardSpanLength;
      if (hasValidTailSpan) {
        guardSpans.push([spanCursorZ, maxSpanEndZ]);
      }

      const guardHalfHeight = 0.425;
      const guardCenterY = config.curbHeight + guardHalfHeight;

      for (const [startZ, endZ] of guardSpans) {
        const spanLength = endZ - startZ;
        const midZ = (startZ + endZ) * 0.5;

        const leftGuard = this.props.createGuardrail(spanLength);
        leftGuard.position.set(-halfRoadWidth - 0.2, config.curbHeight, midZ);
        group.add(leftGuard);

        const rightGuard = this.props.createGuardrail(spanLength);
        rightGuard.position.set(halfRoadWidth + 0.2, config.curbHeight, midZ);
        rightGuard.rotation.y = Math.PI;
        group.add(rightGuard);

        // ガードレール物理コライダー（横断歩道開口部を除いた各分割区間ごとに生成）
        const leftGuardColDesc = rapier.ColliderDesc.cuboid(0.14, guardHalfHeight, spanLength / 2)
          .setTranslation(-halfRoadWidth - 0.15, guardCenterY, midZ)
          .setFriction(0.35)
          .setRestitution(0.18);
        registerObstacleCollider(leftGuardColDesc);

        const rightGuardColDesc = rapier.ColliderDesc.cuboid(0.14, guardHalfHeight, spanLength / 2)
          .setTranslation(halfRoadWidth + 0.15, guardCenterY, midZ)
          .setFriction(0.35)
          .setRestitution(0.18);
        registerObstacleCollider(rightGuardColDesc);
      }
    }

    const hasManholes = config.hasManholes;
    if (hasManholes) {
      // 車道中央寄り・路肩寄りにマンホールを散在配置
      for (let z = -config.length / 3; z < config.length / 2; z += 45) {
        const mh = this.props.createManhole(config.laneWidth * 0.6, z);
        mh.userData.lodDetailTier = "high";
        group.add(mh);

        const mhLeft = this.props.createManhole(-config.laneWidth * 0.7, z + 20);
        mhLeft.userData.lodDetailTier = "high";
        group.add(mhLeft);
      }
    }

    // 側溝グレーチング（路肩）
    for (let z = -config.length / 2 + 15; z < config.length / 2; z += 30) {
      const gratingLeft = this.props.createGrating(-halfRoadWidth + 0.35, z);
      gratingLeft.userData.lodDetailTier = "high";
      group.add(gratingLeft);

      const gratingRight = this.props.createGrating(halfRoadWidth - 0.35, z);
      gratingRight.userData.lodDetailTier = "high";
      group.add(gratingRight);
    }

    const hasTrafficLights = config.hasTrafficLights;
    if (hasTrafficLights) {
      // 北側交差点・横断歩道前に日本の信号機を配置（左歩道側＋対向車線側）
      const northSignalX = halfRoadWidth + 0.45;
      const northSignalZ = config.length * 0.25 + 4.5;
      const trafficLightNorth = this.props.createTrafficLight(northSignalX, northSignalZ, Math.PI, {
        activeSignal: "green",
        intersectionNameJa: signLabels.northIntersectionJa,
        intersectionNameEn: signLabels.northIntersectionEn,
        showArrowSignal: true,
      });
      group.add(trafficLightNorth);
      registerObstacleCollider(
        createPoleCylinderDesc(2.5, 0.16)
          .setTranslation(northSignalX, 2.5, northSignalZ)
          .setFriction(0.4)
          .setRestitution(0.12),
      );

      const northOppSignalX = -halfRoadWidth - 0.45;
      const northOppSignalZ = config.length * 0.25 - 4.5;
      const trafficLightNorthOpposite = this.props.createTrafficLight(
        northOppSignalX,
        northOppSignalZ,
        0,
        {
          activeSignal: "green",
          intersectionNameJa: signLabels.northIntersectionJa,
          intersectionNameEn: signLabels.northIntersectionEn,
          showArrowSignal: false,
        },
      );
      group.add(trafficLightNorthOpposite);
      registerObstacleCollider(
        createPoleCylinderDesc(2.5, 0.16)
          .setTranslation(northOppSignalX, 2.5, northOppSignalZ)
          .setFriction(0.4)
          .setRestitution(0.12),
      );

      // 多車線幹線道路（行幸通り・日比谷通り・明治通り等）ではスタート地点から直近前方の南側交差点（-0.14 * length + 4.5）にも日本の信号機を配置
      const isMajorMultiLaneSignal = config.lanesPerDirection >= 2;
      if (isMajorMultiLaneSignal) {
        const southSignalX = halfRoadWidth + 0.45;
        const southSignalZ = -config.length * 0.14 + 4.5;
        const trafficLightSouth = this.props.createTrafficLight(
          southSignalX,
          southSignalZ,
          Math.PI,
          {
            activeSignal: "green",
            intersectionNameJa: signLabels.southIntersectionJa,
            intersectionNameEn: signLabels.southIntersectionEn,
            showArrowSignal: true,
          },
        );
        group.add(trafficLightSouth);
        registerObstacleCollider(
          createPoleCylinderDesc(2.5, 0.16)
            .setTranslation(southSignalX, 2.5, southSignalZ)
            .setFriction(0.4)
            .setRestitution(0.12),
        );

        const southOppSignalX = -halfRoadWidth - 0.45;
        const southOppSignalZ = -config.length * 0.14 - 4.5;
        const trafficLightSouthOpposite = this.props.createTrafficLight(
          southOppSignalX,
          southOppSignalZ,
          0,
          {
            activeSignal: "green",
            intersectionNameJa: signLabels.southIntersectionJa,
            intersectionNameEn: signLabels.southIntersectionEn,
            showArrowSignal: false,
          },
        );
        group.add(trafficLightSouthOpposite);
        registerObstacleCollider(
          createPoleCylinderDesc(2.5, 0.16)
            .setTranslation(southOppSignalX, 2.5, southOppSignalZ)
            .setFriction(0.4)
            .setRestitution(0.12),
        );
      }

      // 信号機手前50mに「信号機あり」警戒標識（201-2）を設置
      const warningSignX = halfRoadWidth + 1.2;
      const warningSignZ = config.length * 0.25 - 45.0;
      const warningSign = this.props.signs.createWarningSignalSign(warningSignX, warningSignZ);
      warningSign.rotation.y = Math.PI;
      warningSign.userData.lodDetailTier = "medium";
      group.add(warningSign);
      registerObstacleCollider(
        createPoleCylinderDesc(1.6, 0.09)
          .setTranslation(warningSignX, 1.6, warningSignZ)
          .setFriction(0.4),
      );
    }

    // 横断歩道指示標識（407: 青五角形屋根型）
    const hasCrosswalk = config.hasCrosswalk || config.hasCrosswalks;
    if (hasCrosswalk) {
      const crossSignX = halfRoadWidth + 1.2;
      const crossSignZ = config.length * 0.25;
      const crossSign = this.props.signs.createCrosswalkSign(crossSignX, crossSignZ);
      crossSign.rotation.y = Math.PI;
      crossSign.userData.lodDetailTier = "medium";
      group.add(crossSign);
      registerObstacleCollider(
        createPoleCylinderDesc(1.6, 0.09)
          .setTranslation(crossSignX, 1.6, crossSignZ)
          .setFriction(0.4),
      );
    }

    // 速度制限標識（323: 規制標識）
    // Why not -config.length * 0.35:
    // 行幸通り（center.z = 130, length = 280）で -0.35 * 280 = -98（worldZ = 32.0）にすると
    // YAML 定義の street_name_gyoko（worldZ = 32.0）と同一座標で衝突し、支柱が看板面を貫通して見えるため -0.42 に離隔する。
    const limit = config.speedLimitSign ?? 50;
    const speedSignX = halfRoadWidth + 1.2;
    const speedSignZ = -config.length * 0.42;
    const speedSign = this.props.createSpeedLimitSign(speedSignX, speedSignZ, limit);
    speedSign.rotation.y = Math.PI;
    speedSign.userData.lodDetailTier = "medium";
    group.add(speedSign);
    registerObstacleCollider(
      createPoleCylinderDesc(1.6, 0.09)
        .setTranslation(speedSignX, 1.6, speedSignZ)
        .setFriction(0.4),
    );

    // 通りの名称標識（119-A: 通称名標識）
    const hasRoadName = Boolean(config.name);
    if (hasRoadName) {
      const streetSignX = halfRoadWidth + 1.2;
      const streetSignZ = -config.length * 0.48;
      const streetSign = this.props.signs.createStreetNameSign(
        streetSignX,
        streetSignZ,
        signLabels.streetJa,
        signLabels.streetEn,
      );
      streetSign.rotation.y = Math.PI;
      streetSign.userData.lodDetailTier = "medium";
      group.add(streetSign);
      registerObstacleCollider(
        createPoleCylinderDesc(1.6, 0.09)
          .setTranslation(streetSignX, 1.6, streetSignZ)
          .setFriction(0.4),
      );
    }

    // 駐車禁止標識（316）＋ 補助標識「終日」を左歩道および対向歩道奥に離隔配置
    const noParkingLeftX = -halfRoadWidth - 1.15;
    const noParkingLeftZ = config.length * 0.36;
    const noParkingLeft = this.props.signs.createNoParkingSign(
      noParkingLeftX,
      noParkingLeftZ,
      false,
      "終日",
    );
    noParkingLeft.userData.lodDetailTier = "medium";
    group.add(noParkingLeft);
    registerObstacleCollider(
      createPoleCylinderDesc(1.6, 0.09)
        .setTranslation(noParkingLeftX, 1.6, noParkingLeftZ)
        .setFriction(0.4),
    );

    const noParkingRightX = halfRoadWidth + 1.15;
    const noParkingRightZ = config.length * 0.02;
    const noParkingRight = this.props.signs.createNoParkingSign(
      noParkingRightX,
      noParkingRightZ,
      true,
      "ここまで",
    );
    noParkingRight.rotation.y = Math.PI;
    noParkingRight.userData.lodDetailTier = "medium";
    group.add(noParkingRight);
    registerObstacleCollider(
      createPoleCylinderDesc(1.6, 0.09)
        .setTranslation(noParkingRightX, 1.6, noParkingRightZ)
        .setFriction(0.4),
    );

    // 交差点手前の「進行方向別通行区分」標識（327の7）とデリネーター（視線誘導標）
    // 左側通行（+Z 進行 = x > 0）のドライバーへ正対するよう左歩道（+halfRoadWidth + 1.35）に rotation.y = Math.PI で設置し、
    // 道路の実際の片側車線数（lanesPerDirection = 2 または 3）と一致する矢印区画板を描画する。
    const isMajorMultiLane = config.lanesPerDirection >= 2;
    if (isMajorMultiLane) {
      const laneDirSignX = halfRoadWidth + 1.35;
      const laneDirSignZ = config.length * 0.25 - 24.0;
      const laneDirSign = this.props.signs.createLaneDirectionSign(
        laneDirSignX,
        laneDirSignZ,
        config.lanesPerDirection,
      );
      laneDirSign.rotation.y = Math.PI;
      laneDirSign.userData.lodDetailTier = "medium";
      group.add(laneDirSign);
      registerObstacleCollider(
        createPoleCylinderDesc(1.6, 0.09)
          .setTranslation(laneDirSignX, 1.6, laneDirSignZ)
          .setFriction(0.4),
      );

      const delinNorthZ = config.length * 0.25 - 6.5;
      const delinNorth = this.props.signs.createDelineatorPost(0, delinNorthZ);
      delinNorth.rotation.y = Math.PI;
      delinNorth.userData.lodDetailTier = "medium";
      group.add(delinNorth);
      registerObstacleCollider(
        createPoleCylinderDesc(0.55, 0.08).setTranslation(0, 0.55, delinNorthZ).setFriction(0.35),
      );
    }
  }

  /**
   * 国土地理院 (GSI) 道路中心線オープンデータ・ポリライン座標列に基づき、
   * 曲線・折れ線道路セグメント（Catmull-Rom スプライン補間リボンメッシュ、
   * 路面標示、両側縁石・歩道、ガードレール、フラット物理コライダー）を構築する
   */
  public buildPolylineSegment(
    config: JapaneseRoadSegmentConfig,
    points: ReadonlyArray<{ x: number; z: number }>,
    physicsWorld: RAPIER.World,
    rapier: typeof RAPIER,
    baseY = 0.011,
  ): {
    group: THREE.Group;
    materials: JapaneseRoadMaterial[];
    puddleMaterials: PuddleMaterial[];
    colliders: RAPIER.Collider[];
    obstacleColliderHandles: number[];
  } {
    const hasInsufficientPoints = points.length < 2;
    if (hasInsufficientPoints) {
      return this.buildSegment(config, physicsWorld, rapier, new THREE.Vector3(0, baseY, 0), 0);
    }

    const group = new THREE.Group();
    group.name = `CurvedRoadSegment_${config.name || "OpenDataPolyline"}`;
    group.userData.isRoadInfrastructure = true;
    const segmentMaterials: JapaneseRoadMaterial[] = [];
    const segmentPuddleMaterials: PuddleMaterial[] = [];
    const segmentColliders: RAPIER.Collider[] = [];
    const obstacleColliderHandles: number[] = [];

    const medianW = config.medianWidth ?? 0;
    const driveableWidth =
      config.lanesPerDirection * 2 * config.laneWidth + config.shoulderWidth * 2 + medianW;
    const halfDriveable = driveableWidth / 2;

    // 1. Catmull-Rom スプラインで道路中心線を滑らかに補間サンプリング
    const curveControlPoints = points.map((p) => new THREE.Vector3(p.x, 0, p.z));
    const spline = new THREE.CatmullRomCurve3(curveControlPoints, false, "centripetal", 0.5);
    const totalSplineLength = spline.getLength();
    const subdivisions = Math.max(16, Math.min(72, Math.ceil(totalSplineLength / 7.0)));

    interface SampleFrame {
      pos: THREE.Vector3;
      tangent: THREE.Vector3;
      normal: THREE.Vector3; // 右向き法線 (+X 相当)
      arcLen: number;
    }

    const frames: SampleFrame[] = [];
    let cumulativeLen = 0;
    for (let i = 0; i <= subdivisions; i++) {
      const t = i / subdivisions;
      const pos = spline.getPointAt(t);
      const tangent = spline.getTangentAt(t).normalize();
      const normal = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
      const isAfterFirst = i > 0;
      if (isAfterFirst) {
        cumulativeLen += pos.distanceTo(frames[i - 1].pos);
      }
      frames.push({ pos, tangent, normal, arcLen: cumulativeLen });
    }

    const buildRibbonGeometry = (
      offsetLeft: number,
      offsetRight: number,
      yHeight: number,
      uScale = 1,
      vRepeatPerMeter = 0.1,
      startTrim = 0,
      endTrim = 0,
    ): THREE.BufferGeometry => {
      const trimmedFrames = frames.filter(
        (f) => f.arcLen >= startTrim && f.arcLen <= totalSplineLength - endTrim,
      );
      const activeFrames = trimmedFrames.length >= 2 ? trimmedFrames : frames;
      const n = activeFrames.length;
      const positions = new Float32Array(n * 2 * 3);
      const normals = new Float32Array(n * 2 * 3);
      const uvs = new Float32Array(n * 2 * 2);
      const indices: number[] = [];

      for (let i = 0; i < n; i++) {
        const f = activeFrames[i];
        const leftX = f.pos.x + f.normal.x * offsetLeft;
        const leftZ = f.pos.z + f.normal.z * offsetLeft;
        const rightX = f.pos.x + f.normal.x * offsetRight;
        const rightZ = f.pos.z + f.normal.z * offsetRight;

        const vIdx = i * 6;
        positions[vIdx] = leftX;
        positions[vIdx + 1] = yHeight;
        positions[vIdx + 2] = leftZ;
        positions[vIdx + 3] = rightX;
        positions[vIdx + 4] = yHeight;
        positions[vIdx + 5] = rightZ;

        normals[vIdx] = 0;
        normals[vIdx + 1] = 1;
        normals[vIdx + 2] = 0;
        normals[vIdx + 3] = 0;
        normals[vIdx + 4] = 1;
        normals[vIdx + 5] = 0;

        const uvIdx = i * 4;
        const vCoord = f.arcLen * vRepeatPerMeter;
        uvs[uvIdx] = 0;
        uvs[uvIdx + 1] = vCoord;
        uvs[uvIdx + 2] = uScale;
        uvs[uvIdx + 3] = vCoord;

        const hasNextRow = i < n - 1;
        if (hasNextRow) {
          const a = i * 2;
          const b = i * 2 + 1;
          const c = (i + 1) * 2;
          const d = (i + 1) * 2 + 1;
          indices.push(a, b, c, b, d, c);
        }
      }

      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geom.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
      geom.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
      geom.setIndex(indices);
      geom.computeBoundingSphere();
      return geom;
    };

    // 2. 曲線アスファルト車道メッシュ
    const roadGeom = buildRibbonGeometry(-halfDriveable, halfDriveable, baseY + 0.001, 1, 0.05);
    const roadMat = new JapaneseRoadMaterial({ baseRoughness: 0.85, baseMetalness: 0.12 });
    this.roadMaterials.push(roadMat);
    segmentMaterials.push(roadMat);
    const roadMesh = new THREE.Mesh(roadGeom, roadMat);
    roadMesh.name = "CurvedRoadway_Asphalt";
    roadMesh.receiveShadow = true;
    group.add(roadMesh);

    // 3. 曲線道路標示（中央線・車線境界線・外側線）
    // Why markingEndTrim = 3.2m を設けるか:
    // 曲線道路の両端は直線幹線道路や交差点パッドと接続するため、始終端まで中央線・路肩線を描画すると
    // 接続先の横断歩道や交差点標示と重なってしまうのを防ぐ。
    const markingEndTrim = Math.min(3.2, totalSplineLength * 0.12);
    // Why not applyCurb3DTexture を流用するか:
    // 縁石用マテリアルには polygonOffset が設定されておらず、路面メッシュと深度競合（Z-fighting）して
    // 走行中に白い点滅を引き起こすため、polygonOffset 付きかつガラスビーズ再帰反射対応の RoadMarkings シェーダーを適用する。
    const whiteLineMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      emissive: 0xe2e8f0,
      emissiveIntensity: 0.42,
      roughness: 0.4,
      metalness: 0.05,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.markings.applyRoadMarking3DTexture(whiteLineMat, "white-paint");

    // 中央線（道路交通法第17条第4項・警察庁交通規制基準に基づき、片側2車線以上は白実線、片側1車線かつ追越し禁止は黄色実線）
    const isMultiLaneCurved = config.lanesPerDirection >= 2;
    const isSingleLaneYellow = !isMultiLaneCurved && Boolean(config.hasYellowCenterLine);
    if (isMultiLaneCurved || isSingleLaneYellow) {
      const centerGeom = buildRibbonGeometry(
        -0.09,
        0.09,
        baseY + 0.02,
        1,
        0.2,
        markingEndTrim,
        markingEndTrim,
      );
      if (isMultiLaneCurved) {
        const centerLineMesh = new THREE.Mesh(centerGeom, whiteLineMat);
        centerLineMesh.name = "CurvedMarking_WhiteCenter";
        centerLineMesh.userData.paintColor = "white";
        centerLineMesh.receiveShadow = true;
        group.add(centerLineMesh);
      } else {
        const yellowMat = new THREE.MeshStandardMaterial({
          color: 0xf59e0b,
          emissive: 0xf59e0b,
          emissiveIntensity: 0.45,
          roughness: 0.45,
          metalness: 0.05,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        });
        this.markings.applyRoadMarking3DTexture(yellowMat, "yellow-paint");
        const centerLineMesh = new THREE.Mesh(centerGeom, yellowMat);
        centerLineMesh.name = "CurvedMarking_YellowCenter";
        centerLineMesh.userData.paintColor = "yellow";
        centerLineMesh.receiveShadow = true;
        group.add(centerLineMesh);
      }
    }

    // 路肩外側線（実線）
    const shoulderOffset = halfDriveable - config.shoulderWidth;
    for (const sideSign of [-1, 1]) {
      const centerOff = sideSign * shoulderOffset;
      const edgeGeom = buildRibbonGeometry(
        centerOff - 0.075,
        centerOff + 0.075,
        baseY + 0.019,
        1,
        0.2,
        markingEndTrim,
        markingEndTrim,
      );
      const edgeMesh = new THREE.Mesh(edgeGeom, whiteLineMat);
      edgeMesh.name = `CurvedMarking_Shoulder_${sideSign > 0 ? "L" : "R"}`;
      edgeMesh.receiveShadow = true;
      group.add(edgeMesh);
    }

    // 複数車線時の破線レーン境界線
    const hasMultiLaneDashed = config.hasWhiteDashedLines && config.lanesPerDirection > 1;
    if (hasMultiLaneDashed) {
      for (const dirSign of [-1, 1]) {
        for (let lane = 1; lane < config.lanesPerDirection; lane++) {
          const laneOffset = dirSign * (medianW / 2 + lane * config.laneWidth);
          for (let dist = 6; dist + 5 < totalSplineLength - 6; dist += 12) {
            const tMid = (dist + 2.5) / totalSplineLength;
            const pMid = spline.getPointAt(Math.min(1, Math.max(0, tMid)));
            const tan = spline.getTangentAt(Math.min(1, Math.max(0, tMid))).normalize();
            const norm = new THREE.Vector3(tan.z, 0, -tan.x).normalize();
            const dashMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 5.0), whiteLineMat);
            dashMesh.name = `CurvedMarking_LaneDivider_${dirSign > 0 ? "R" : "L"}_${lane}`;
            dashMesh.rotation.x = -Math.PI / 2;
            dashMesh.rotation.z = -Math.atan2(tan.x, tan.z);
            dashMesh.position.set(
              pMid.x + norm.x * laneOffset,
              baseY + 0.019,
              pMid.z + norm.z * laneOffset,
            );
            dashMesh.receiveShadow = true;
            group.add(dashMesh);
          }
        }
      }
    }

    // 4. 両側歩道・縁石リボンメッシュ
    const hasSidewalks = config.sidewalkWidth > 0;
    if (hasSidewalks) {
      const curbW = 0.22;
      const curbMat = new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        roughness: 0.72,
        metalness: 0.08,
      });
      this.applyCurb3DTexture(curbMat);

      const sidewalkMat = new PuddleMaterial({
        baseColor: 0x94a3b8,
        baseRoughness: 0.76,
        baseMetalness: 0.08,
        puddleThreshold: 0.46,
      });
      this.puddleMaterials.push(sidewalkMat);
      segmentPuddleMaterials.push(sidewalkMat);

      for (const sideSign of [-1, 1]) {
        const innerOff = sideSign * halfDriveable;
        const curbOuterOff = sideSign * (halfDriveable + curbW);
        const walkOuterOff = sideSign * (halfDriveable + config.sidewalkWidth);

        const minCurb = Math.min(innerOff, curbOuterOff);
        const maxCurb = Math.max(innerOff, curbOuterOff);
        const curbGeom = buildRibbonGeometry(minCurb, maxCurb, config.curbHeight, 1, 0.25);
        const curbMesh = new THREE.Mesh(curbGeom, curbMat);
        curbMesh.name = `CurvedCurb_${sideSign > 0 ? "L" : "R"}`;
        curbMesh.receiveShadow = true;
        group.add(curbMesh);

        const minWalk = Math.min(curbOuterOff, walkOuterOff);
        const maxWalk = Math.max(curbOuterOff, walkOuterOff);
        const walkGeom = buildRibbonGeometry(minWalk, maxWalk, config.curbHeight * 0.85, 1, 0.12);
        const walkMesh = new THREE.Mesh(walkGeom, sidewalkMat);
        walkMesh.name = `CurvedSidewalk_${sideSign > 0 ? "L" : "R"}`;
        walkMesh.receiveShadow = true;
        group.add(walkMesh);
      }
    }

    // 5. 曲線Wビーム防護柵（ガードレール）リボンメッシュ & 視線誘導標（デリネーター）
    if (config.hasGuardrails) {
      const railBeamMat = new THREE.MeshStandardMaterial({
        color: 0xe2e8f0,
        roughness: 0.34,
        metalness: 0.72,
      });
      this.applyCurb3DTexture(railBeamMat);

      for (const sideSign of [-1, 1]) {
        const railCenterOff = sideSign * (halfDriveable + 0.32);
        const minRail = Math.min(railCenterOff - 0.08, railCenterOff + 0.08);
        const maxRail = Math.max(railCenterOff - 0.08, railCenterOff + 0.08);
        const railGeom = buildRibbonGeometry(minRail, maxRail, config.curbHeight + 0.62, 1, 0.2);
        const railMesh = new THREE.Mesh(railGeom, railBeamMat);
        railMesh.name = `CurvedGuardrail_${sideSign > 0 ? "L" : "R"}`;
        railMesh.castShadow = true;
        railMesh.receiveShadow = true;
        group.add(railMesh);
      }
    }

    const shouldPlaceDelineators = config.hasGuardrails && totalSplineLength >= 36;
    if (shouldPlaceDelineators) {
      const stepMeters = 12;
      for (let s = 10; s < totalSplineLength - 10; s += stepMeters) {
        const t = s / totalSplineLength;
        const pt = spline.getPointAt(t);
        const tan = spline.getTangentAt(t).normalize();
        const norm = new THREE.Vector3(tan.z, 0, -tan.x).normalize();
        const yaw = Math.atan2(tan.x, tan.z);

        for (const sideSign of [-1, 1]) {
          const offset = sideSign * (halfDriveable + 0.35);
          const delin = this.props.signs.createDelineatorPost(
            pt.x + norm.x * offset,
            pt.z + norm.z * offset,
          );
          delin.rotation.y = yaw + Math.PI;
          delin.userData.lodDetailTier = "medium";
          group.add(delin);
        }
      }
    }

    // 6. 物理エンジンのフラット路面コライダー＆両側歩道・ガードレールコライダー（各折れ線区間ごとに摩擦付き直方体を配置）
    const colliderChordCount = Math.max(4, Math.min(16, points.length * 2));
    for (let i = 0; i < colliderChordCount; i++) {
      const t0 = i / colliderChordCount;
      const t1 = (i + 1) / colliderChordCount;
      const p0 = spline.getPointAt(t0);
      const p1 = spline.getPointAt(t1);
      const segDx = p1.x - p0.x;
      const segDz = p1.z - p0.z;
      const segLen = Math.hypot(segDx, segDz);
      const isTooShort = segLen < 0.5;
      if (isTooShort) {
        continue;
      }

      const midX = (p0.x + p1.x) * 0.5;
      const midZ = (p0.z + p1.z) * 0.5;
      const yaw = Math.atan2(segDx, segDz);
      const halfYaw = yaw * 0.5;

      const roadBodyDesc = rapier.RigidBodyDesc.fixed()
        .setTranslation(midX, baseY, midZ)
        .setRotation(new rapier.Quaternion(0, Math.sin(halfYaw), 0, Math.cos(halfYaw)));
      const roadBody = physicsWorld.createRigidBody(roadBodyDesc);
      const roadColliderDesc = rapier.ColliderDesc.cuboid(
        driveableWidth / 2,
        0.25,
        segLen / 2 + 1.2,
      )
        .setTranslation(0, -0.25, 0)
        .setFriction(0.85)
        .setRestitution(0.02);
      const roadCol = physicsWorld.createCollider(roadColliderDesc, roadBody);
      segmentColliders.push(roadCol);

      if (hasSidewalks) {
        const swWidth = config.sidewalkWidth + 0.22;
        for (const sideSign of [-1, 1]) {
          const swCenterX = sideSign * (halfDriveable + swWidth / 2);
          const swColDesc = rapier.ColliderDesc.cuboid(
            swWidth / 2,
            config.curbHeight / 2,
            segLen / 2,
          )
            .setTranslation(swCenterX, config.curbHeight / 2, 0)
            .setFriction(0.8);
          const swCol = physicsWorld.createCollider(swColDesc, roadBody);
          segmentColliders.push(swCol);
          obstacleColliderHandles.push(swCol.handle);
        }
      }

      if (config.hasGuardrails) {
        const railHeight = 0.85;
        const railThickness = 0.28;
        const railCenterY = config.curbHeight + railHeight / 2;
        for (const sideSign of [-1, 1]) {
          const railX = sideSign * (halfDriveable + 0.32);
          const railColDesc = rapier.ColliderDesc.cuboid(
            railThickness / 2,
            railHeight / 2,
            segLen / 2,
          )
            .setTranslation(railX, railCenterY, 0)
            .setFriction(0.4)
            .setRestitution(0.25);
          const railCol = physicsWorld.createCollider(railColDesc, roadBody);
          segmentColliders.push(railCol);
          obstacleColliderHandles.push(railCol.handle);
        }
      }
    }

    return {
      group,
      materials: segmentMaterials,
      puddleMaterials: segmentPuddleMaterials,
      colliders: segmentColliders,
      obstacleColliderHandles,
    };
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

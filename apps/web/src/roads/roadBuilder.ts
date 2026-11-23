import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import { JapaneseRoadMaterial } from "./japaneseRoadMaterial";
import { PuddleMaterial } from "../shaders/puddleShader";
import { Procedural3DTextureGenerator } from "../textures/procedural3DTexture";
import { RoadMarkings, computeRoadLaneLayout, type RoadLaneLayout } from "./roadMarkings";
import { applyRoadProp3DTexture, RoadProps } from "./roadProps";
import {
  buildIntersectionCornerSidewalks,
  buildLGutterRibbonGeometry,
  buildProfiledCurbRibbonGeometry,
  buildProfiledSidewalkRibbonGeometry,
  buildStationsWithRamps,
  buildStraightRoadFrames,
  computePerSideCorridorIntervals,
  computeRoadCrossSection,
  getSideCrossSection,
  type CrosswalkRampZone,
  type RoadCrossSectionSpec,
  type RoadFrame,
} from "./roadCrossSection";
import type { JapaneseIntersectionConfig, JapaneseRoadSegmentConfig } from "./types";

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
  public readonly props: RoadProps;
  private intersectionAsphaltMaterial: JapaneseRoadMaterial;

  constructor() {
    this.markings = new RoadMarkings();
    this.props = new RoadProps();
    this.intersectionAsphaltMaterial = new JapaneseRoadMaterial({
      isIntersection: true,
      isIntersectionPad: true,
    });
    this.roadMaterials.push(this.intersectionAsphaltMaterial);
  }

  public getIntersectionAsphaltMaterial(): JapaneseRoadMaterial {
    return this.intersectionAsphaltMaterial;
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

  /**
   * 渋谷スクランブル交差点の対角線X字型スクランブル横断歩道（斜め横断歩道）を構築する
   */
  public buildScrambleDiagonalCrosswalks(padSize = 44): THREE.Group {
    return this.markings.createScrambleDiagonalCrosswalks(padSize);
  }

  public getMarkings(): RoadMarkings {
    return this.markings;
  }

  private createLGutterMaterial(): THREE.MeshStandardMaterial {
    const gutterMat = new THREE.MeshStandardMaterial({
      color: 0xb4beca,
      roughness: 0.78,
      metalness: 0.06,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.applyCurb3DTexture(gutterMat);
    return gutterMat;
  }

  /**
   * 統一交差点（フラットアスファルト＋路面標示＋四隅隅切り R カーブ歩道・面取り縁石・L型側溝・点字ブロック＋安全物理コライダー）を構築する
   */
  public buildIntersection(
    config: JapaneseIntersectionConfig,
    physicsWorld: RAPIER.World,
    rapier: typeof RAPIER,
    groundBody: RAPIER.RigidBody,
    sharedPadMaterial?: JapaneseRoadMaterial,
  ): {
    group: THREE.Group;
    puddleMaterials: PuddleMaterial[];
    colliders: RAPIER.Collider[];
    obstacleColliderHandles: number[];
  } {
    const baseY = config.baseY ?? 0.0115;
    const interGroup = new THREE.Group();
    interGroup.name = config.name ?? `Intersection_${config.x}_${config.z}`;
    interGroup.userData.isRoadInfrastructure = true;
    interGroup.position.set(config.x, baseY, config.z);

    const padMat = sharedPadMaterial ?? this.intersectionAsphaltMaterial;
    const padGeo = new THREE.PlaneGeometry(config.widthX, config.depthZ, 8, 8);
    padGeo.rotateX(-Math.PI / 2);
    const padMesh = new THREE.Mesh(padGeo, padMat);
    padMesh.userData.isRoadInfrastructure = true;
    padMesh.receiveShadow = true;
    interGroup.add(padMesh);

    const hasArms = Boolean(config.arms);
    const resolvedCrosswalkN = config.crosswalkN ?? (hasArms ? Boolean(config.arms?.north) : true);
    const resolvedCrosswalkS = config.crosswalkS ?? (hasArms ? Boolean(config.arms?.south) : true);
    const resolvedCrosswalkE = config.crosswalkE ?? (hasArms ? Boolean(config.arms?.east) : true);
    const resolvedCrosswalkW = config.crosswalkW ?? (hasArms ? Boolean(config.arms?.west) : true);

    const lanesX = config.lanesX ?? 2;
    const lanesZ = config.lanesZ ?? 2;
    const hasCrosswalks = config.hasCrosswalks ?? true;

    const interMarkings = this.buildIntersectionMarkingGroup(config.widthX, config.depthZ, {
      lanesX,
      lanesZ,
      hasCrosswalks,
      hasCenterDiamond: config.hasCenterDiamond ?? (lanesX >= 2 && lanesZ >= 2),
      hasGuideDots: config.hasGuideDots ?? true,
      crosswalkN: resolvedCrosswalkN,
      crosswalkS: resolvedCrosswalkS,
      crosswalkE: resolvedCrosswalkE,
      crosswalkW: resolvedCrosswalkW,
    });
    interMarkings.userData.isRoadInfrastructure = true;
    interGroup.add(interMarkings);

    const colliders: RAPIER.Collider[] = [];
    const obstacleColliderHandles: number[] = [];
    const puddleMaterials: PuddleMaterial[] = [];

    const groundBodyY =
      typeof groundBody?.translation === "function" ? groundBody.translation().y : -0.5;

    // 交差点フラット路面コライダー（車道セグメント上面 y = 0.012 と段差なく接続）
    const padColDesc = rapier.ColliderDesc.cuboid(config.widthX / 2, 0.25, config.depthZ / 2)
      .setTranslation(config.x, 0.012 - 0.25 - groundBodyY, config.z)
      .setFriction(0.85)
      .setRestitution(0.02);
    colliders.push(physicsWorld.createCollider(padColDesc, groundBody));

    const shouldBuildCorners = (config.hasCornerSidewalks ?? true) && Boolean(config.arms);
    if (shouldBuildCorners) {
      const curbHeight = config.curbHeight ?? 0.15;
      const sidewalkMat = new PuddleMaterial({
        baseColor: 0x94a3b8,
        baseRoughness: 0.76,
        baseMetalness: 0.08,
        puddleThreshold: 0.46,
        sidewalkPavingStyle: config.sidewalkPavingStyle ?? "granite_slab",
      });
      this.puddleMaterials.push(sidewalkMat);
      puddleMaterials.push(sidewalkMat);

      const curbMat = new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        roughness: 0.8,
        metalness: 0.1,
      });
      this.applyCurb3DTexture(curbMat);
      const gutterMat = this.createLGutterMaterial();

      const corners = buildIntersectionCornerSidewalks(
        config,
        {
          sidewalkMaterial: sidewalkMat,
          curbMaterial: curbMat,
          gutterMaterial: gutterMat,
          brailleMaterial: this.markings.getBrailleTileMaterial(),
        },
        0,
      );
      interGroup.add(corners.group);

      for (const cc of corners.cornerColliders) {
        const swColDesc = rapier.ColliderDesc.cuboid(cc.halfX, curbHeight * 0.5, cc.halfZ)
          .setTranslation(
            config.x + cc.cx,
            baseY + curbHeight * 0.5 - groundBodyY,
            config.z + cc.cz,
          )
          .setFriction(0.8);
        const col = physicsWorld.createCollider(swColDesc, groundBody);
        colliders.push(col);
      }
    }

    return { group: interGroup, puddleMaterials, colliders, obstacleColliderHandles };
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

    // 統一断面計算 (medianWidth・車線・路肩・L型側溝・面取り縁石・歩道)
    const cross = computeRoadCrossSection(config);
    const totalRoadWidth = cross.driveableWidth;
    const halfRoadWidth = cross.halfDriveable;

    const hasCrosswalks = Boolean(config.hasCrosswalks || config.hasCrosswalk);
    const crossZ = config.length * 0.25;
    const southCrossZ = -config.length * 0.14;
    const hasSouthCrosswalk =
      hasCrosswalks && config.lanesPerDirection >= 2 && config.length >= 120;
    const crosswalkZPositions: number[] = [];
    if (hasCrosswalks) {
      crosswalkZPositions.push(crossZ);
      if (hasSouthCrosswalk) {
        crosswalkZPositions.push(southCrossZ);
      }
    }
    const rampZones: CrosswalkRampZone[] = crosswalkZPositions.map((cz) => ({
      center: cz,
      halfWidth: 2.2,
      transitionLength: 1.2,
    }));

    // 1. ビジュアル車道アスファルト（凸凹＆水たまり鏡面シェーダー適用）
    const roadMat = new JapaneseRoadMaterial({
      baseRoughness: 0.85,
      baseMetalness: 0.12,
      roadWidth: totalRoadWidth,
    });
    this.roadMaterials.push(roadMat);

    const roadGeo = new THREE.PlaneGeometry(totalRoadWidth, config.length, 16, 32);
    roadGeo.rotateX(-Math.PI / 2);
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.receiveShadow = true;
    group.add(roadMesh);

    // 2. 物理コライダー（★完全な平坦コライダー★）
    const roadBodyDesc = rapier.RigidBodyDesc.fixed()
      .setTranslation(position.x, position.y, position.z)
      .setRotation(new rapier.Quaternion(0, Math.sin(rotationY / 2), 0, Math.cos(rotationY / 2)));
    const roadBody = world.createRigidBody(roadBodyDesc);

    const roadCollider = rapier.ColliderDesc.cuboid(totalRoadWidth / 2, 0.25, config.length / 2)
      .setTranslation(0, -0.25, 0)
      .setFriction(0.85)
      .setRestitution(0.02);
    const createdRoadCol = world.createCollider(roadCollider, roadBody);
    segmentColliders.push(createdRoadCol);

    // 3. L型側溝・面取り縁石（横断歩道切下げスロープ付き）
    this.buildCurbs(group, config, cross, rampZones);

    // 4. 歩道（1.5%排水勾配・舗装目地シェーダー・切下げすりつけスロープ・点字警告ブロック）
    this.buildSidewalks(
      group,
      config,
      cross,
      rampZones,
      crosswalkZPositions,
      world,
      rapier,
      roadBody,
      segmentColliders,
    );

    // 5. 道路標示（中央線、白破線、路肩線、横断歩道）
    const laneLayout = this.buildMarkings(group, config, cross, crosswalkZPositions);

    // 6. 中央分離帯アイランド（medianWidth > 0 の場合）
    const hasRaisedMedian = cross.medianWidth > 0;
    if (hasRaisedMedian) {
      this.buildRaisedMedian(
        group,
        config,
        cross,
        laneLayout.centerLineExcludeZRanges,
        world,
        rapier,
        roadBody,
        segmentColliders,
        obstacleColliderHandles,
      );
    }

    // 7. プロップ（マンホール、グレーチング、ガードレール、信号機、標識）および物理衝突コライダー
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
    cross: RoadCrossSectionSpec,
    rampZones: ReadonlyArray<CrosswalkRampZone>,
  ): void {
    const curbMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      roughness: 0.8,
      metalness: 0.1,
    });
    this.applyCurb3DTexture(curbMat);
    const gutterMat = this.createLGutterMaterial();

    const stations = buildStationsWithRamps(
      -config.length * 0.5,
      config.length * 0.5,
      8.0,
      rampZones,
    );
    const frames = buildStraightRoadFrames(stations);

    for (const sideSign of [-1, 1] as const) {
      const sideSpec = getSideCrossSection(cross, sideSign);
      const hasSidewalk = sideSpec.totalWidth > 0.05;
      if (!hasSidewalk) {
        continue;
      }

      const gutterGeom = buildLGutterRibbonGeometry(frames, sideSign, cross, 0);
      const gutterMesh = new THREE.Mesh(gutterGeom, gutterMat);
      gutterMesh.name = `StraightLGutter_${sideSign > 0 ? "L" : "R"}`;
      gutterMesh.receiveShadow = true;
      group.add(gutterMesh);

      const curbGeom = buildProfiledCurbRibbonGeometry(frames, sideSign, cross, 0, rampZones);
      const curbMesh = new THREE.Mesh(curbGeom, curbMat);
      curbMesh.name = `StraightCurb_${sideSign > 0 ? "L" : "R"}`;
      curbMesh.userData.isSidewalkSurface = true;
      curbMesh.castShadow = true;
      curbMesh.receiveShadow = true;
      group.add(curbMesh);
    }
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
    material.customProgramCacheKey = () => "japanese-road-curb-3d-v3";

    material.onBeforeCompile = (shader) => {
      shader.uniforms.uRoadPropVolumeTex = { value: volumeTex };

      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        `#include <common>
varying vec3 vCurbWorldPos;
varying vec3 vCurbLocalPos;
varying vec2 vCurbUv;`,
      );

      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vCurbLocalPos = position;
vCurbWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
vCurbUv = uv;`,
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        `#include <common>
precision highp sampler3D;
uniform sampler3D uRoadPropVolumeTex;
varying vec3 vCurbWorldPos;
varying vec3 vCurbLocalPos;
varying vec2 vCurbUv;`,
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
  // 60cm 間隔のコンクリート縁石ブロック目地溝（道路方向 UV vCurbUv.y に直交）
  float curbLongCoord = vCurbUv.y;
  float jointPhase = abs(fract(curbLongCoord / 0.6 + 0.5) - 0.5);
  float jointDistFade = 1.0 - smoothstep(32.0, 48.0, curbCamDist);
  jointGroove = (1.0 - smoothstep(0.0, 0.022, jointPhase)) * jointDistFade;
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
    cross: RoadCrossSectionSpec,
    rampZones: ReadonlyArray<CrosswalkRampZone>,
    crosswalkZPositions: ReadonlyArray<number>,
    world: RAPIER.World,
    rapier: typeof RAPIER,
    roadBody: RAPIER.RigidBody,
    segmentColliders: RAPIER.Collider[],
  ): void {
    const sidewalkMat = new PuddleMaterial({
      baseColor: 0x94a3b8,
      baseRoughness: 0.76,
      baseMetalness: 0.08,
      puddleThreshold: 0.46,
      sidewalkPavingStyle: config.sidewalkPavingStyle ?? "granite_slab",
    });
    this.puddleMaterials.push(sidewalkMat);

    const stations = buildStationsWithRamps(
      -config.length * 0.5,
      config.length * 0.5,
      8.0,
      rampZones,
    );
    const frames = buildStraightRoadFrames(stations);

    for (const sideSign of [-1, 1] as const) {
      const sideSpec = getSideCrossSection(cross, sideSign);
      const hasSidewalk = sideSpec.totalWidth > 0.05;
      if (!hasSidewalk) {
        continue;
      }

      const swGeom = buildProfiledSidewalkRibbonGeometry(frames, sideSign, cross, 0, rampZones);
      const swMesh = new THREE.Mesh(swGeom, sidewalkMat);
      swMesh.name = `StraightSidewalk_${sideSign > 0 ? "L" : "R"}`;
      swMesh.userData.isSidewalkSurface = true;
      swMesh.receiveShadow = true;
      group.add(swMesh);

      // 視覚歩道幅と 1:1 一致する歩道物理コライダー
      const colCenterX = sideSign * (cross.halfDriveable + sideSpec.totalWidth * 0.5);
      const swColDesc = rapier.ColliderDesc.cuboid(
        sideSpec.totalWidth * 0.5,
        cross.curbHeight * 0.5,
        config.length * 0.5,
      )
        .setTranslation(colCenterX, cross.curbHeight * 0.5, 0)
        .setFriction(0.8);
      segmentColliders.push(world.createCollider(swColDesc, roadBody));

      const hasCrosswalks = crosswalkZPositions.length > 0;
      if (hasCrosswalks) {
        const tactileMargin = Math.min(0.42, sideSpec.walkSurfaceWidth * 0.42);
        const tactileX = sideSign * (sideSpec.curbOuter + tactileMargin);
        const outerRampRatio =
          sideSpec.walkSurfaceWidth > 0.01
            ? Math.min(1, (tactileMargin + 0.3) / sideSpec.walkSurfaceWidth)
            : 0;
        const tactileBaseY = 0.02 + (sideSpec.backEdgeHeight - 0.02) * outerRampRatio + 0.002;
        const braille = this.markings.createBrailleTiles(
          config.length,
          tactileX,
          tactileBaseY,
          crosswalkZPositions,
        );
        braille.userData.lodDetailTier = "high";
        group.add(braille);
      }
    }
  }

  private buildRaisedMedian(
    group: THREE.Group,
    config: JapaneseRoadSegmentConfig,
    cross: RoadCrossSectionSpec,
    excludeZRanges: ReadonlyArray<readonly [number, number]>,
    world: RAPIER.World,
    rapier: typeof RAPIER,
    roadBody: RAPIER.RigidBody,
    segmentColliders: RAPIER.Collider[],
    obstacleColliderHandles: number[],
  ): void {
    const medianHeight = Math.max(0.16, cross.curbHeight + 0.02);
    const halfMed = cross.halfMedian;
    const curbBorder = Math.min(0.18, halfMed * 0.35);

    const curbMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      roughness: 0.8,
      metalness: 0.1,
    });
    this.applyCurb3DTexture(curbMat);

    const medianTopMat = new THREE.MeshStandardMaterial({
      color: 0xb8c2cf,
      roughness: 0.72,
      metalness: 0.06,
    });
    this.applyCurb3DTexture(medianTopMat);

    const whiteEdgeMat = this.markings.getWhitePaintMaterial();
    const spans = this.markings.computeIncludedZSpans(config.length, excludeZRanges);

    for (let idx = 0; idx < spans.length; idx++) {
      const [zStart, zEnd] = spans[idx];
      const spanLen = zEnd - zStart;
      const isTooShort = spanLen < 4.0;
      if (isTooShort) {
        continue;
      }

      const midZ = (zStart + zEnd) * 0.5;
      const curbGeo = new THREE.BoxGeometry(cross.medianWidth, medianHeight, spanLen);
      const curbMesh = new THREE.Mesh(curbGeo, curbMat);
      curbMesh.name = `StraightCentralMedian_Curb_${idx}`;
      curbMesh.position.set(0, medianHeight * 0.5, midZ);
      curbMesh.castShadow = true;
      curbMesh.receiveShadow = true;
      group.add(curbMesh);

      const deckWidth = cross.medianWidth - curbBorder * 2;
      if (deckWidth > 0.2) {
        const deckGeo = new THREE.BoxGeometry(deckWidth, 0.022, spanLen - 0.3);
        const deckMesh = new THREE.Mesh(deckGeo, medianTopMat);
        deckMesh.name = `StraightCentralMedian_Deck_${idx}`;
        deckMesh.position.set(0, medianHeight + 0.001, midZ);
        deckMesh.receiveShadow = true;
        group.add(deckMesh);
      }

      for (const sideSign of [-1, 1] as const) {
        const edgeGeo = new THREE.PlaneGeometry(0.15, spanLen);
        edgeGeo.rotateX(-Math.PI / 2);
        const edgeMesh = new THREE.Mesh(edgeGeo, whiteEdgeMat);
        edgeMesh.name = `StraightMarking_MedianEdge_${sideSign > 0 ? "L" : "R"}_${idx}`;
        edgeMesh.userData.paintColor = "white";
        edgeMesh.position.set(sideSign * (halfMed + 0.22), 0.02, midZ);
        group.add(edgeMesh);
      }

      const medColDesc = rapier.ColliderDesc.cuboid(
        Math.max(0.25, halfMed - 0.06),
        medianHeight * 0.5,
        spanLen * 0.5,
      )
        .setTranslation(0, medianHeight * 0.5, midZ)
        .setFriction(0.6)
        .setRestitution(0.15);
      const medCol = world.createCollider(medColDesc, roadBody);
      segmentColliders.push(medCol);
      if (typeof medCol?.handle === "number") {
        obstacleColliderHandles.push(medCol.handle);
      }
    }
  }

  private buildMarkings(
    group: THREE.Group,
    config: JapaneseRoadSegmentConfig,
    cross: RoadCrossSectionSpec,
    crosswalkZPositions: ReadonlyArray<number>,
  ): RoadLaneLayout {
    const halfRoadWidth = cross.halfDriveable;
    const hasCrosswalks = crosswalkZPositions.length > 0;
    const crossZ = config.length * 0.25;
    const southCrossZ = -config.length * 0.14;
    const hasSouthCrosswalk =
      hasCrosswalks && config.lanesPerDirection >= 2 && config.length >= 120;

    const isMultiLaneRoad = config.lanesPerDirection >= 2;
    const hasZebraZone = isMultiLaneRoad && config.length >= 75 && hasCrosswalks;
    const zebraLen = 8.0;
    const zebraCenterZ = crossZ - 10.5;
    const zebraZoneZRanges: Array<[number, number]> = [];
    if (hasZebraZone) {
      zebraZoneZRanges.push([zebraCenterZ - zebraLen * 0.5 - 0.6, crossZ + 5.2]);
    }

    // 車線レイアウト計算（中央分離帯幅・各車線の中心X座標・境界X・横断歩道/交差点端部の非重複除外Z区間を一元算出）
    const laneLayout = computeRoadLaneLayout({
      lanesPerDirection: config.lanesPerDirection,
      laneWidth: config.laneWidth,
      length: config.length,
      medianWidth: cross.medianWidth,
      crosswalkZPositions,
      zebraZoneZRanges,
      segmentEndExclusionBuffer: 1.5,
      crosswalkExclusionHalfSpan: 5.2,
    });
    group.userData.laneLayout = laneLayout;

    // 1. 中央線（立体中央分離帯がある場合は buildRaisedMedian 側で描画するため抑止）
    const hasNoMedianIsland = cross.medianWidth <= 0;
    if (hasNoMedianIsland) {
      const isYellowNoPassing = config.hasYellowCenterLine ?? true;
      const centerLine = this.markings.createCenterLine(
        config.length,
        isYellowNoPassing,
        laneLayout.centerLineExcludeZRanges,
        config.lanesPerDirection,
      );
      group.add(centerLine);
    }

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

    return laneLayout;
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
      // Why guard by segment length: 45m/58m の短区間では 0.25*length - 45 が区間南端(-length/2)をはみ出し交差点車道上に立ってしまうため、区間内に収まる場合のみ設置する
      const warningSignX = halfRoadWidth + 1.2;
      const warningSignZ = config.length * 0.25 - 45.0;
      const minSafePropZ = -config.length * 0.5 + 3.0;
      const isWarningInsideSegment = warningSignZ >= minSafePropZ;
      if (isWarningInsideSegment) {
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

      const hasPhysicalMedian = (config.medianWidth ?? 0) > 0;
      if (hasPhysicalMedian) {
        const delinNorthZ = config.length * 0.25 - 6.5;
        const delinNorth = this.props.signs.createMedianGuidePost(0, delinNorthZ);
        delinNorth.rotation.y = Math.PI;
        delinNorth.userData.lodDetailTier = "medium";
        group.add(delinNorth);
        registerObstacleCollider(
          createPoleCylinderDesc(0.45, 0.08).setTranslation(0, 0.45, delinNorthZ).setFriction(0.35),
        );
      }
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

    const cross = computeRoadCrossSection(config);
    const medianW = cross.medianWidth;
    const driveableWidth = cross.driveableWidth;
    const halfDriveable = cross.halfDriveable;

    // 1. Catmull-Rom スプラインで道路中心線を滑らかに補間サンプリング
    const curveControlPoints = points.map((p) => new THREE.Vector3(p.x, 0, p.z));
    const spline = new THREE.CatmullRomCurve3(curveControlPoints, false, "centripetal", 0.5);
    const totalSplineLength = spline.getLength();
    const subdivisions = Math.max(16, Math.min(360, Math.ceil(totalSplineLength / 4.5)));

    const frames: RoadFrame[] = [];
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
      encodeMetricUv = false,
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
        const vCoord = f.arcLen * 0.2;
        const isMetric = encodeMetricUv;
        if (isMetric) {
          // 道路中心からの横オフセット(m) + 50.0 を格納し、シェーダーで正確な roadLatX = uv.x - 50.0 を復元
          uvs[uvIdx] = 50.0 + offsetLeft;
          uvs[uvIdx + 1] = vCoord;
          uvs[uvIdx + 2] = 50.0 + offsetRight;
          uvs[uvIdx + 3] = vCoord;
        } else {
          uvs[uvIdx] = 0;
          uvs[uvIdx + 1] = f.arcLen * vRepeatPerMeter;
          uvs[uvIdx + 2] = uScale;
          uvs[uvIdx + 3] = f.arcLen * vRepeatPerMeter;
        }

        const hasNextRow = i < n - 1;
        if (hasNextRow) {
          const a = i * 2;
          const b = i * 2 + 1;
          const c = (i + 1) * 2;
          const d = (i + 1) * 2 + 1;
          // 反時計回り（CCW: 上向き法線）
          indices.push(a, c, b, b, c, d);
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

    // 2. 曲線アスファルト車道メッシュ（正確なメートルUVエンコーディング）
    const roadGeom = buildRibbonGeometry(
      -halfDriveable,
      halfDriveable,
      baseY + 0.001,
      1,
      0.05,
      0,
      0,
      true,
    );
    const roadMat = new JapaneseRoadMaterial({
      baseRoughness: 0.85,
      baseMetalness: 0.12,
      roadWidth: driveableWidth,
    });
    this.roadMaterials.push(roadMat);
    segmentMaterials.push(roadMat);
    const roadMesh = new THREE.Mesh(roadGeom, roadMat);
    roadMesh.name = "CurvedRoadway_Asphalt";
    roadMesh.receiveShadow = true;
    group.add(roadMesh);

    // 3. 曲線道路標示（中央線・車線境界線・外側線）
    // Why 交差点手前トリム（14m〜20m）を設けるか:
    // スプライン曲線道路の端点は交差点パッド（スクランブル交差点 44m×44m、宮益坂下 32m×24m 等）の内部にある。
    // 白線（中央線・外側線・車線境界線）を端点まで伸ばすと、交差点の中心深くまで複数の道路の白線が突入し、
    // 十字・X字に交差して「白線のジャングル」と激しい Z-fighting を引き起こす。
    // 日本の道路構造基準・警察庁交通規制基準に基づき、交差点手前（停止線手前）で車線標示を終了させ、
    // 交差点内部は平滑なアスファルト舗装面と横断歩道のみを整然と保つ。
    const defaultTrim = Math.min(18.0, totalSplineLength * 0.25);
    const startMarkingTrim = config.startTrimMeters ?? defaultTrim;
    const endMarkingTrim = config.endTrimMeters ?? defaultTrim;

    // フレーム配列から任意の弧長（arcLen）における位置・接線・法線を滑らかに補間するヘルパー
    const getInterpolatedFrame = (targetArc: number): RoadFrame => {
      const clampedArc = Math.max(0, Math.min(totalSplineLength, targetArc));
      let low = 0;
      let high = frames.length - 1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (frames[mid].arcLen < clampedArc) {
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      const idx0 = Math.max(0, low - 1);
      const idx1 = Math.min(frames.length - 1, low);
      if (idx0 === idx1) {
        return frames[idx0];
      }
      const f0 = frames[idx0];
      const f1 = frames[idx1];
      const span = f1.arcLen - f0.arcLen;
      const ratio = span > 0.0001 ? (clampedArc - f0.arcLen) / span : 0;

      const pos = new THREE.Vector3().lerpVectors(f0.pos, f1.pos, ratio);
      const tangent = new THREE.Vector3().lerpVectors(f0.tangent, f1.tangent, ratio).normalize();
      const normal = new THREE.Vector3().lerpVectors(f0.normal, f1.normal, ratio).normalize();
      return { pos, tangent, normal, arcLen: clampedArc };
    };

    const buildDashedRibbonGeometry = (
      centerOffset: number,
      lineWidth: number,
      yHeight: number,
      dashLength = 5.0,
      gapLength = 5.0,
      arcStart = 0,
      arcEnd = totalSplineLength,
      excludeArcRanges: ReadonlyArray<readonly [number, number]> = [],
    ): THREE.BufferGeometry => {
      const halfW = lineWidth * 0.5;
      const offsetLeft = centerOffset - halfW;
      const offsetRight = centerOffset + halfW;
      const cycle = dashLength + gapLength;
      const minArc = Math.max(0, arcStart);
      const maxArc = Math.min(totalSplineLength, arcEnd);
      const totalDashable = maxArc - minArc;
      if (totalDashable <= dashLength) {
        return new THREE.BufferGeometry();
      }

      const positions: number[] = [];
      const normals: number[] = [];
      const uvs: number[] = [];
      const indices: number[] = [];

      let vertCount = 0;
      for (let s = minArc; s + dashLength <= maxArc; s += cycle) {
        const dashEnd = s + dashLength;
        const overlapsExclusion = excludeArcRanges.some(
          ([exStart, exEnd]) => dashEnd > exStart && s < exEnd,
        );
        if (overlapsExclusion) {
          continue;
        }

        const segStart = s;
        const segSubdivs = 4;
        const segStartIndex = vertCount / 3;

        for (let j = 0; j <= segSubdivs; j++) {
          const tSeg = j / segSubdivs;
          const arc = segStart + tSeg * dashLength;
          const frame = getInterpolatedFrame(arc);

          const lx = frame.pos.x + frame.normal.x * offsetLeft;
          const lz = frame.pos.z + frame.normal.z * offsetLeft;
          const rx = frame.pos.x + frame.normal.x * offsetRight;
          const rz = frame.pos.z + frame.normal.z * offsetRight;

          positions.push(lx, yHeight, lz, rx, yHeight, rz);
          normals.push(0, 1, 0, 0, 1, 0);
          uvs.push(0, tSeg, 1, tSeg);
          vertCount += 6;

          if (j < segSubdivs) {
            const a = segStartIndex + j * 2;
            const b = segStartIndex + j * 2 + 1;
            const c = segStartIndex + (j + 1) * 2;
            const d = segStartIndex + (j + 1) * 2 + 1;
            indices.push(a, c, b, b, c, d);
          }
        }
      }

      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
      geom.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(normals), 3));
      geom.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
      geom.setIndex(indices);
      geom.computeBoundingSphere();
      return geom;
    };

    // Why not applyCurb3DTexture を流用するか:
    // 縁石用マテリアルには polygonOffset が設定されておらず、路面メッシュと深度競合（Z-fighting）して
    // 走行中に白い点滅を引き起こすため、polygonOffset 付きかつガラスビーズ再帰反射対応の RoadMarkings シェーダーを適用する。
    // また side: THREE.DoubleSide を設定し、急勾配や急カーブでもバックフェースカリングによる白線の消失を構造的に防ぐ。
    const whiteLineMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xf1f5f9,
      emissiveIntensity: 0.45,
      roughness: 0.35,
      metalness: 0.05,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.markings.applyRoadMarking3DTexture(whiteLineMat, "white-paint");

    // 中央分離帯・縁石・歩道共通コンクリートマテリアル
    const curbMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      roughness: 0.72,
      metalness: 0.08,
    });
    this.applyCurb3DTexture(curbMat);

    const buildArcRibbonGeometry = (
      offsetLeft: number,
      offsetRight: number,
      yHeight: number,
      arcStart: number,
      arcEnd: number,
      uScale = 1,
      vRepeatPerMeter = 0.2,
    ): THREE.BufferGeometry => {
      const spanArc = arcEnd - arcStart;
      const steps = Math.max(2, Math.min(280, Math.ceil(spanArc / 4.0)));
      const positions = new Float32Array((steps + 1) * 2 * 3);
      const normals = new Float32Array((steps + 1) * 2 * 3);
      const uvs = new Float32Array((steps + 1) * 2 * 2);
      const indices: number[] = [];

      for (let i = 0; i <= steps; i++) {
        const arc = arcStart + (spanArc * i) / steps;
        const f = getInterpolatedFrame(arc);
        const lx = f.pos.x + f.normal.x * offsetLeft;
        const lz = f.pos.z + f.normal.z * offsetLeft;
        const rx = f.pos.x + f.normal.x * offsetRight;
        const rz = f.pos.z + f.normal.z * offsetRight;

        const vIdx = i * 6;
        positions[vIdx] = lx;
        positions[vIdx + 1] = yHeight;
        positions[vIdx + 2] = lz;
        positions[vIdx + 3] = rx;
        positions[vIdx + 4] = yHeight;
        positions[vIdx + 5] = rz;

        normals[vIdx] = 0;
        normals[vIdx + 1] = 1;
        normals[vIdx + 2] = 0;
        normals[vIdx + 3] = 0;
        normals[vIdx + 4] = 1;
        normals[vIdx + 5] = 0;

        const uvIdx = i * 4;
        const vCoord = arc * vRepeatPerMeter;
        uvs[uvIdx] = 0;
        uvs[uvIdx + 1] = vCoord;
        uvs[uvIdx + 2] = uScale;
        uvs[uvIdx + 3] = vCoord;

        if (i < steps) {
          const a = i * 2;
          const b = i * 2 + 1;
          const c = (i + 1) * 2;
          const d = (i + 1) * 2 + 1;
          indices.push(a, c, b, b, c, d);
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

    const buildCurvedSolidBoxRibbonGeometry = (
      offsetLeft: number,
      offsetRight: number,
      bottomY: number,
      topY: number,
      arcStart: number,
      arcEnd: number,
      vRepeatPerMeter = 1.0,
    ): THREE.BufferGeometry => {
      const spanArc = arcEnd - arcStart;
      const steps = Math.max(2, Math.min(240, Math.ceil(spanArc / 4.0)));
      const positions: number[] = [];
      const uvs: number[] = [];
      const indices: number[] = [];

      const pushQuad = (
        p0: [number, number, number],
        p1: [number, number, number],
        p2: [number, number, number],
        p3: [number, number, number],
        v0: number,
        v1: number,
      ): void => {
        const baseIdx = positions.length / 3;
        positions.push(...p0, ...p1, ...p2, ...p3);
        uvs.push(0, v0, 1, v0, 0, v1, 1, v1);
        indices.push(baseIdx, baseIdx + 2, baseIdx + 1, baseIdx + 1, baseIdx + 2, baseIdx + 3);
      };

      const sectionFrames: RoadFrame[] = [];
      for (let i = 0; i <= steps; i++) {
        sectionFrames.push(getInterpolatedFrame(arcStart + (spanArc * i) / steps));
      }

      const corner = (f: RoadFrame, off: number, y: number): [number, number, number] => [
        f.pos.x + f.normal.x * off,
        y,
        f.pos.z + f.normal.z * off,
      ];

      for (let i = 0; i < steps; i++) {
        const f0 = sectionFrames[i];
        const f1 = sectionFrames[i + 1];
        const v0 = f0.arcLen * vRepeatPerMeter;
        const v1 = f1.arcLen * vRepeatPerMeter;
        const tl0 = corner(f0, offsetLeft, topY);
        const tr0 = corner(f0, offsetRight, topY);
        const bl0 = corner(f0, offsetLeft, bottomY);
        const br0 = corner(f0, offsetRight, bottomY);
        const tl1 = corner(f1, offsetLeft, topY);
        const tr1 = corner(f1, offsetRight, topY);
        const bl1 = corner(f1, offsetLeft, bottomY);
        const br1 = corner(f1, offsetRight, bottomY);

        // 天面 (+Y)
        pushQuad(tl0, tr0, tl1, tr1, v0, v1);
        // 左側面 (-normal)
        pushQuad(tl0, tl1, bl0, bl1, v0, v1);
        // 右側面 (+normal)
        pushQuad(tr1, tr0, br1, br0, v1, v0);
      }

      // 始端・終端の木口蓋
      const fs = sectionFrames[0];
      pushQuad(
        corner(fs, offsetRight, topY),
        corner(fs, offsetLeft, topY),
        corner(fs, offsetRight, bottomY),
        corner(fs, offsetLeft, bottomY),
        0,
        1,
      );
      const fe = sectionFrames[steps];
      pushQuad(
        corner(fe, offsetLeft, topY),
        corner(fe, offsetRight, topY),
        corner(fe, offsetLeft, bottomY),
        corner(fe, offsetRight, bottomY),
        0,
        1,
      );

      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
      geom.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
      geom.setIndex(indices);
      geom.computeVertexNormals();
      geom.computeBoundingSphere();
      return geom;
    };

    const exclusions = [
      ...(config.medianExclusionZones ?? []),
      ...(config.markingExclusionZones ?? []),
    ];
    const isPointInExclusion = (px: number, pz: number, padding = 0): boolean =>
      exclusions.some((ex) => Math.hypot(px - ex.x, pz - ex.z) < ex.radius + padding);

    const computeActiveArcIntervals = (
      trimStart: number,
      trimEnd: number,
      minSpanLength: number,
    ): Array<{ start: number; end: number }> => {
      const maxArc = totalSplineLength - trimEnd;
      const intervals: Array<{ start: number; end: number }> = [];
      const sampleStep = 2.0;
      let activeStart: number | null = null;
      for (let arc = trimStart; arc <= maxArc; arc += sampleStep) {
        const framePos = getInterpolatedFrame(arc).pos;
        const blocked = isPointInExclusion(framePos.x, framePos.z);
        if (!blocked && activeStart === null) {
          activeStart = arc;
        } else if (blocked && activeStart !== null) {
          if (arc - sampleStep - activeStart >= minSpanLength) {
            intervals.push({ start: activeStart, end: arc - sampleStep });
          }
          activeStart = null;
        }
      }
      if (activeStart !== null && maxArc - activeStart >= minSpanLength) {
        intervals.push({ start: activeStart, end: maxArc });
      }
      return intervals;
    };

    const activeRoadIntervals = computeActiveArcIntervals(startMarkingTrim, endMarkingTrim, 4.0);
    const shouldAddCrosswalks = Boolean(config.hasCrosswalk || config.hasCrosswalks);
    const shouldAddStopLinesForSpan = config.hasStopLines ?? true;
    const getLongitudinalMarkingSpan = (
      iv: { start: number; end: number },
      ivIdx: number,
    ): { start: number; end: number } => {
      const ivLen = iv.end - iv.start;
      const isLongEnough = ivLen >= 28.0;
      if (!isLongEnough || (!shouldAddCrosswalks && !shouldAddStopLinesForSpan)) {
        return iv;
      }
      const shouldSkipStart = ivIdx === 0 && Boolean(config.skipStartCrosswalk);
      const shouldSkipEnd =
        ivIdx === activeRoadIntervals.length - 1 && Boolean(config.skipEndCrosswalk);
      const fStartCross = getInterpolatedFrame(iv.start + 3.5);
      const fStartStop = getInterpolatedFrame(iv.start + 6.3);
      const hasStartMarking =
        !shouldSkipStart &&
        ((shouldAddCrosswalks && !isPointInExclusion(fStartCross.pos.x, fStartCross.pos.z, 2.0)) ||
          (shouldAddStopLinesForSpan &&
            !isPointInExclusion(fStartStop.pos.x, fStartStop.pos.z, 2.0)));
      const fEndCross = getInterpolatedFrame(iv.end - 3.5);
      const fEndStop = getInterpolatedFrame(iv.end - 6.3);
      const hasEndMarking =
        !shouldSkipEnd &&
        ((shouldAddCrosswalks && !isPointInExclusion(fEndCross.pos.x, fEndCross.pos.z, 2.0)) ||
          (shouldAddStopLinesForSpan && !isPointInExclusion(fEndStop.pos.x, fEndStop.pos.z, 2.0)));
      const trimmedStart = hasStartMarking ? iv.start + 6.8 : iv.start;
      const trimmedEnd = hasEndMarking ? iv.end - 6.8 : iv.end;
      return trimmedEnd - trimmedStart >= 4.0 ? { start: trimmedStart, end: trimmedEnd } : iv;
    };

    // 中央分離帯区間（medianWidth > 0 のときは交差点開口部・排他半径を除いた立体中央分離帯アイランドを構築）
    const hasRaisedMedian = medianW > 0;
    const medianHeight = Math.max(0.16, config.curbHeight + 0.02);
    const medianIntervals = hasRaisedMedian
      ? computeActiveArcIntervals(startMarkingTrim, endMarkingTrim, 8.0)
      : [];

    if (hasRaisedMedian) {
      const halfMed = medianW * 0.5;
      const curbBorder = Math.min(0.18, halfMed * 0.35);
      // Why brighter concrete grey (0xb8c2cf): 0x475569 blended into asphalt and made raised medians look like dark voids.
      const medianTopMat = new THREE.MeshStandardMaterial({
        color: 0xb8c2cf,
        roughness: 0.72,
        metalness: 0.06,
      });
      this.applyCurb3DTexture(medianTopMat);

      for (let ivIdx = 0; ivIdx < medianIntervals.length; ivIdx++) {
        const iv = medianIntervals[ivIdx];
        const curbIslandGeom = buildCurvedSolidBoxRibbonGeometry(
          -halfMed,
          halfMed,
          baseY,
          baseY + medianHeight,
          iv.start,
          iv.end,
        );
        const curbIslandMesh = new THREE.Mesh(curbIslandGeom, curbMat);
        curbIslandMesh.name = `CurvedCentralMedian_Curb_${ivIdx}`;
        curbIslandMesh.castShadow = true;
        curbIslandMesh.receiveShadow = true;
        group.add(curbIslandMesh);

        const capWidth = halfMed - curbBorder;
        if (capWidth > 0.1) {
          const capGeom = buildCurvedSolidBoxRibbonGeometry(
            -capWidth,
            capWidth,
            baseY + medianHeight - 0.01,
            baseY + medianHeight + 0.012,
            iv.start + 0.15,
            iv.end - 0.15,
          );
          const capMesh = new THREE.Mesh(capGeom, medianTopMat);
          capMesh.name = `CurvedCentralMedian_Deck_${ivIdx}`;
          capMesh.receiveShadow = true;
          group.add(capMesh);
        }

        // 中央分離帯の両側白実線
        for (const sideSign of [-1, 1]) {
          const lineCenter = sideSign * (halfMed + 0.22);
          const lineGeom = buildArcRibbonGeometry(
            lineCenter - 0.075,
            lineCenter + 0.075,
            baseY + 0.02,
            iv.start,
            iv.end,
            1,
            0.2,
          );
          const lineMesh = new THREE.Mesh(lineGeom, whiteLineMat);
          lineMesh.name = `CurvedMarking_MedianEdge_${sideSign > 0 ? "R" : "L"}_${ivIdx}`;
          lineMesh.userData.paintColor = "white";
          lineMesh.receiveShadow = true;
          group.add(lineMesh);
        }

        // 視線誘導ガイドポスト（全周反射＋両面円形ヘッドを中央分離帯天端へ確実に接地設置）
        for (let postArc = iv.start + 2.0; postArc <= iv.end - 2.0; postArc += 28.0) {
          const postFrame = getInterpolatedFrame(postArc);
          const delin = this.props.signs.createMedianGuidePost(postFrame.pos.x, postFrame.pos.z);
          delin.position.y = baseY + medianHeight;
          delin.rotation.y = Math.atan2(postFrame.tangent.x, postFrame.tangent.z);
          delin.userData.lodDetailTier = "medium";
          group.add(delin);
        }
      }
    } else {
      // 中央線（立体分離帯なしの道路: 片側2車線以上は白実線、片側1車線かつ追越し禁止は黄色実線、片側1車線一般道は白破線）
      const hasCenterLine = config.hasCenterLine ?? true;
      const isMultiLaneCurved = config.lanesPerDirection >= 2;
      const isSingleLaneYellow = !isMultiLaneCurved && Boolean(config.hasYellowCenterLine);
      const isSingleLaneDashed = !isMultiLaneCurved && !isSingleLaneYellow;
      if (hasCenterLine && isSingleLaneDashed) {
        for (let ivIdx = 0; ivIdx < activeRoadIntervals.length; ivIdx++) {
          const iv = getLongitudinalMarkingSpan(activeRoadIntervals[ivIdx], ivIdx);
          const centerDashGeom = buildDashedRibbonGeometry(
            0,
            0.14,
            baseY + 0.02,
            4.0,
            4.0,
            iv.start,
            iv.end,
          );
          const centerDashMesh = new THREE.Mesh(centerDashGeom, whiteLineMat);
          centerDashMesh.name = `CurvedMarking_WhiteDashedCenter_${ivIdx}`;
          centerDashMesh.userData.paintColor = "white";
          centerDashMesh.receiveShadow = true;
          group.add(centerDashMesh);
        }
      }
      const shouldDrawCenterLine = hasCenterLine && (isMultiLaneCurved || isSingleLaneYellow);
      if (shouldDrawCenterLine) {
        const centerMat = isMultiLaneCurved
          ? whiteLineMat
          : (() => {
              const yellowMat = new THREE.MeshStandardMaterial({
                color: 0xf59e0b,
                emissive: 0xf59e0b,
                emissiveIntensity: 0.45,
                roughness: 0.45,
                metalness: 0.05,
                side: THREE.DoubleSide,
                polygonOffset: true,
                polygonOffsetFactor: -3,
                polygonOffsetUnits: -3,
              });
              this.markings.applyRoadMarking3DTexture(yellowMat, "yellow-paint");
              return yellowMat;
            })();

        for (let ivIdx = 0; ivIdx < activeRoadIntervals.length; ivIdx++) {
          const iv = getLongitudinalMarkingSpan(activeRoadIntervals[ivIdx], ivIdx);
          const centerGeom = buildArcRibbonGeometry(
            -0.09,
            0.09,
            baseY + 0.02,
            iv.start,
            iv.end,
            1,
            0.2,
          );
          const centerLineMesh = new THREE.Mesh(centerGeom, centerMat);
          centerLineMesh.name = isMultiLaneCurved
            ? `CurvedMarking_WhiteCenter_${ivIdx}`
            : `CurvedMarking_YellowCenter_${ivIdx}`;
          centerLineMesh.userData.paintColor = isMultiLaneCurved ? "white" : "yellow";
          centerLineMesh.receiveShadow = true;
          group.add(centerLineMesh);
        }
      }
    }

    // 路肩外側線（実線: 交差点開口区間で分割）
    const hasShoulderLines = config.hasShoulderLines ?? true;
    if (hasShoulderLines) {
      const shoulderOffset = halfDriveable - config.shoulderWidth;
      for (const sideSign of [-1, 1]) {
        const centerOff = sideSign * shoulderOffset;
        for (let ivIdx = 0; ivIdx < activeRoadIntervals.length; ivIdx++) {
          const iv = getLongitudinalMarkingSpan(activeRoadIntervals[ivIdx], ivIdx);
          const edgeGeom = buildArcRibbonGeometry(
            centerOff - 0.075,
            centerOff + 0.075,
            baseY + 0.019,
            iv.start,
            iv.end,
            1,
            0.2,
          );
          const edgeMesh = new THREE.Mesh(edgeGeom, whiteLineMat);
          edgeMesh.name = `CurvedMarking_Shoulder_${sideSign > 0 ? "L" : "R"}_${ivIdx}`;
          edgeMesh.receiveShadow = true;
          group.add(edgeMesh);
        }
      }
    }

    // 横断歩道・停止線・進路変更禁止黄色実線の配置対象を先に収集し、白破線重複および歩道切下げスロープ・点字ブロック・ガードレール開口と 100% 同期させる
    const lanesPerDir = config.lanesPerDirection;
    const shouldAddStopLines = config.hasStopLines ?? true;
    interface CurvedApproachSpec {
      ivIdx: number;
      ivLen: number;
      name: string;
      sCross: number;
      sStop: number;
      isStart: boolean;
      hasCrosswalk: boolean;
      hasStopLine: boolean;
      ivStart: number;
      ivEnd: number;
    }
    const validCurvedApproaches: CurvedApproachSpec[] = [];
    const curvedCrosswalkArcs: number[] = [];
    const yellowNoLaneChangeByLane = new Map<string, Array<[number, number]>>();

    for (let ivIdx = 0; ivIdx < activeRoadIntervals.length; ivIdx++) {
      const iv = activeRoadIntervals[ivIdx];
      const ivLen = iv.end - iv.start;
      const isLongEnough = ivLen >= 28.0;
      if (!isLongEnough) {
        continue;
      }

      const rawApproaches = [
        { name: "Start", sCross: iv.start + 3.5, sStop: iv.start + 6.3, isStart: true },
        { name: "End", sCross: iv.end - 3.5, sStop: iv.end - 6.3, isStart: false },
      ];
      for (const app of rawApproaches) {
        const shouldSkipStart = app.isStart && ivIdx === 0 && Boolean(config.skipStartCrosswalk);
        const shouldSkipEnd =
          !app.isStart &&
          ivIdx === activeRoadIntervals.length - 1 &&
          Boolean(config.skipEndCrosswalk);
        if (shouldSkipStart || shouldSkipEnd) {
          continue;
        }

        const fCross = getInterpolatedFrame(app.sCross);
        const fStop = getInterpolatedFrame(app.sStop);
        const hasCrosswalk =
          shouldAddCrosswalks && !isPointInExclusion(fCross.pos.x, fCross.pos.z, 2.0);
        const hasStopLine =
          shouldAddStopLines && !isPointInExclusion(fStop.pos.x, fStop.pos.z, 2.0);

        if (hasCrosswalk) {
          curvedCrosswalkArcs.push(app.sCross);
        }

        if (hasStopLine && lanesPerDir >= 2 && ivLen >= 40.0) {
          const sYellowStart = app.isStart ? app.sStop : Math.max(iv.start, app.sStop - 18.0);
          const sYellowEnd = app.isStart ? Math.min(iv.end, app.sStop + 18.0) : app.sStop;
          const yellowDirSign = app.isStart ? -1 : 1;
          for (let lane = 1; lane < lanesPerDir; lane++) {
            const key = `${yellowDirSign}_${lane}`;
            const list = yellowNoLaneChangeByLane.get(key) ?? [];
            list.push([sYellowStart - 0.6, sYellowEnd + 0.6]);
            yellowNoLaneChangeByLane.set(key, list);
          }
        }

        validCurvedApproaches.push({
          ivIdx,
          ivLen,
          name: app.name,
          sCross: app.sCross,
          sStop: app.sStop,
          isStart: app.isStart,
          hasCrosswalk,
          hasStopLine,
          ivStart: iv.start,
          ivEnd: iv.end,
        });
      }
    }

    // 複数車線時の破線レーン境界線（スプライン追従リボンメッシュ：進路変更禁止黄色実線区間を除外）
    const hasMultiLaneDashed = config.hasWhiteDashedLines && config.lanesPerDirection > 1;
    if (hasMultiLaneDashed) {
      for (const dirSign of [-1, 1]) {
        for (let lane = 1; lane < config.lanesPerDirection; lane++) {
          const laneOffset = dirSign * (medianW / 2 + lane * config.laneWidth);
          const yellowExclusions = yellowNoLaneChangeByLane.get(`${dirSign}_${lane}`) ?? [];
          for (let ivIdx = 0; ivIdx < activeRoadIntervals.length; ivIdx++) {
            const iv = getLongitudinalMarkingSpan(activeRoadIntervals[ivIdx], ivIdx);
            const dashedGeom = buildDashedRibbonGeometry(
              laneOffset,
              0.15,
              baseY + 0.019,
              5.0,
              5.0,
              iv.start,
              iv.end,
              yellowExclusions,
            );
            if (dashedGeom.attributes.position && dashedGeom.attributes.position.count > 0) {
              const dashMesh = new THREE.Mesh(dashedGeom, whiteLineMat);
              dashMesh.name = `CurvedMarking_LaneDivider_${dirSign > 0 ? "R" : "L"}_${lane}_${ivIdx}`;
              dashMesh.receiveShadow = true;
              group.add(dashMesh);
            }
          }
        }
      }
    }

    // 4. 片側別の高精度歩道・面取り縁石・L型側溝・切下げスロープ・点字警告ブロック
    const hasLeftSidewalk = cross.left.totalWidth > 0.05;
    const hasRightSidewalk = cross.right.totalWidth > 0.05;
    const hasSidewalks = hasLeftSidewalk || hasRightSidewalk;

    const leftSidewalkIntervals = hasLeftSidewalk
      ? computePerSideCorridorIntervals({
          frames,
          totalSplineLength,
          sideSign: 1,
          innerOffset: halfDriveable,
          outerOffset: cross.left.walkOuter,
          exclusionCorridors: config.sidewalkExclusionCorridors,
          exclusionBoxes: config.sidewalkExclusionBoxes,
          exclusionZones: config.sidewalkExclusionZones,
          fallbackStartTrim: startMarkingTrim,
          fallbackEndTrim: endMarkingTrim,
          minSpanLength: 3.5,
        })
      : [];

    const rightSidewalkIntervals = hasRightSidewalk
      ? computePerSideCorridorIntervals({
          frames,
          totalSplineLength,
          sideSign: -1,
          innerOffset: halfDriveable,
          outerOffset: cross.right.walkOuter,
          exclusionCorridors: config.sidewalkExclusionCorridors,
          exclusionBoxes: config.sidewalkExclusionBoxes,
          exclusionZones: config.sidewalkExclusionZones,
          fallbackStartTrim: startMarkingTrim,
          fallbackEndTrim: endMarkingTrim,
          minSpanLength: 3.5,
        })
      : [];

    const rampZones: CrosswalkRampZone[] = curvedCrosswalkArcs.map((c) => ({
      center: c,
      halfWidth: 2.2,
      transitionLength: 1.2,
    }));

    if (hasSidewalks) {
      const sidewalkMat = new PuddleMaterial({
        baseColor: 0x94a3b8,
        baseRoughness: 0.76,
        baseMetalness: 0.08,
        puddleThreshold: 0.46,
        sidewalkPavingStyle: config.sidewalkPavingStyle ?? "interlocking_brick",
      });
      this.puddleMaterials.push(sidewalkMat);
      segmentPuddleMaterials.push(sidewalkMat);

      const gutterMat = this.createLGutterMaterial();
      const brailleMat = this.markings.getBrailleTileMaterial();

      const sideConfigs: ReadonlyArray<{
        sideSign: -1 | 1;
        intervals: ReadonlyArray<{ start: number; end: number }>;
      }> = [
        { sideSign: -1, intervals: rightSidewalkIntervals },
        { sideSign: 1, intervals: leftSidewalkIntervals },
      ];

      for (const sc of sideConfigs) {
        const sideSpec = getSideCrossSection(cross, sc.sideSign);
        const sideTag = sc.sideSign > 0 ? "L" : "R";

        for (let ivIdx = 0; ivIdx < sc.intervals.length; ivIdx++) {
          const iv = sc.intervals[ivIdx];
          const stations = buildStationsWithRamps(iv.start, iv.end, 4.5, rampZones);
          const ivFrames = stations.map((arc) => getInterpolatedFrame(arc));
          if (ivFrames.length < 2) {
            continue;
          }

          // L型側溝コンクリート帯
          const gutterGeom = buildLGutterRibbonGeometry(ivFrames, sc.sideSign, cross, baseY);
          const gutterMesh = new THREE.Mesh(gutterGeom, gutterMat);
          gutterMesh.name = `CurvedLGutter_${sideTag}_${ivIdx}`;
          gutterMesh.receiveShadow = true;
          group.add(gutterMesh);

          // 面取り＆切下げスロープ付き 3D 縁石（路面 baseY に密着）
          const curbGeom = buildProfiledCurbRibbonGeometry(
            ivFrames,
            sc.sideSign,
            cross,
            baseY,
            rampZones,
          );
          const curbMesh = new THREE.Mesh(curbGeom, curbMat);
          curbMesh.name = `CurvedCurb_${sideTag}_${ivIdx}`;
          curbMesh.userData.isSidewalkSurface = true;
          curbMesh.castShadow = true;
          curbMesh.receiveShadow = true;
          group.add(curbMesh);

          // 1.5%排水勾配＆切下げスロープ付き舗装歩道（路面 baseY に密着）
          const walkGeom = buildProfiledSidewalkRibbonGeometry(
            ivFrames,
            sc.sideSign,
            cross,
            baseY,
            rampZones,
          );
          const walkMesh = new THREE.Mesh(walkGeom, sidewalkMat);
          walkMesh.name = `CurvedSidewalk_${sideTag}_${ivIdx}`;
          walkMesh.userData.isSidewalkSurface = true;
          walkMesh.receiveShadow = true;
          group.add(walkMesh);

          // 横断歩道接続部の点字警告ブロック（JIS T 9251）
          const tactileMargin = Math.min(0.42, sideSpec.walkSurfaceWidth * 0.42);
          const tactileOff = sc.sideSign * (sideSpec.curbOuter + tactileMargin);
          const outerRampRatio =
            sideSpec.walkSurfaceWidth > 0.01
              ? Math.min(1, (tactileMargin + 0.3) / sideSpec.walkSurfaceWidth)
              : 0;
          const tactileY = baseY + 0.02 + (sideSpec.backEdgeHeight - 0.02) * outerRampRatio + 0.005;

          for (let cwIdx = 0; cwIdx < curvedCrosswalkArcs.length; cwIdx++) {
            const cwArc = curvedCrosswalkArcs[cwIdx];
            const isInsideSidewalk = cwArc >= iv.start + 1.4 && cwArc <= iv.end - 1.4;
            if (!isInsideSidewalk) {
              continue;
            }
            const fCw = getInterpolatedFrame(cwArc);
            const tileGeo = new THREE.PlaneGeometry(0.6, 2.4);
            tileGeo.rotateX(-Math.PI / 2);
            const tileMesh = new THREE.Mesh(tileGeo, brailleMat);
            tileMesh.name = `CurvedTactileWarning_${sideTag}_${ivIdx}_${cwIdx}`;
            tileMesh.userData.markingType = "TactilePaving";
            tileMesh.userData.lodDetailTier = "high";
            tileMesh.position.set(
              fCw.pos.x + fCw.normal.x * tactileOff,
              tactileY,
              fCw.pos.z + fCw.normal.z * tactileOff,
            );
            tileMesh.rotation.y = Math.atan2(fCw.tangent.x, fCw.tangent.z);
            group.add(tileMesh);
          }
        }
      }
    }

    // 5. 曲線3D都市型防護柵（ガードレール・東京都型防護パイプ）立体ビーム＆支柱・横断歩道開口・再帰反射材
    const subtractGuardrailOpenings = (
      baseIntervals: ReadonlyArray<{ start: number; end: number }>,
    ): Array<{ start: number; end: number }> => {
      const result: Array<{ start: number; end: number }> = [];
      const sortedCuts = [...curvedCrosswalkArcs]
        .map((c) => [c - 3.6, c + 3.6] as [number, number])
        .sort((a, b) => a[0] - b[0]);

      for (const iv of baseIntervals) {
        let cursor = iv.start + 1.5;
        const limitEnd = iv.end - 1.5;
        for (const [cutStart, cutEnd] of sortedCuts) {
          if (cutEnd <= cursor || cutStart >= limitEnd) {
            continue;
          }
          const clippedEnd = Math.min(limitEnd, cutStart);
          if (clippedEnd - cursor >= 3.5) {
            result.push({ start: cursor, end: clippedEnd });
          }
          cursor = Math.max(cursor, cutEnd);
        }
        if (limitEnd - cursor >= 3.5) {
          result.push({ start: cursor, end: limitEnd });
        }
      }
      return result;
    };

    const leftGuardrailIntervals = subtractGuardrailOpenings(
      hasLeftSidewalk ? leftSidewalkIntervals : activeRoadIntervals,
    );
    const rightGuardrailIntervals = subtractGuardrailOpenings(
      hasRightSidewalk ? rightSidewalkIntervals : activeRoadIntervals,
    );

    const hasGuardrails = Boolean(config.hasGuardrails);
    if (hasGuardrails) {
      const railBeamMat = new THREE.MeshStandardMaterial({
        color: 0xf4f7fb,
        roughness: 0.28,
        metalness: 0.25,
      });
      applyRoadProp3DTexture(railBeamMat, "guardrail");

      const railRetroMat = new THREE.MeshStandardMaterial({
        color: 0xfacc15,
        emissive: 0xf59e0b,
        emissiveIntensity: 0.75,
        roughness: 0.14,
        metalness: 0.35,
      });
      applyRoadProp3DTexture(railRetroMat, "retroreflector");

      const postGeo = new THREE.BoxGeometry(0.06, 0.78, 0.06);
      const retroBadgeGeo = new THREE.BoxGeometry(0.075, 0.06, 0.06);

      const railSideSpecs: ReadonlyArray<{
        sideSign: -1 | 1;
        intervals: ReadonlyArray<{ start: number; end: number }>;
      }> = [
        { sideSign: -1, intervals: rightGuardrailIntervals },
        { sideSign: 1, intervals: leftGuardrailIntervals },
      ];

      for (const rs of railSideSpecs) {
        const railCenterOff = rs.sideSign * (halfDriveable + 0.36);
        const railGroup = new THREE.Group();
        railGroup.name = `CurvedGuardrail_${rs.sideSign > 0 ? "L" : "R"}`;

        for (const iv of rs.intervals) {
          const topGeom = buildCurvedSolidBoxRibbonGeometry(
            railCenterOff - 0.03,
            railCenterOff + 0.03,
            baseY + 0.72,
            baseY + 0.79,
            iv.start,
            iv.end,
            0.2,
          );
          const topMesh = new THREE.Mesh(topGeom, railBeamMat);
          topMesh.castShadow = true;
          topMesh.receiveShadow = true;
          railGroup.add(topMesh);

          const midGeom = buildCurvedSolidBoxRibbonGeometry(
            railCenterOff - 0.025,
            railCenterOff + 0.025,
            baseY + 0.44,
            baseY + 0.49,
            iv.start,
            iv.end,
            0.2,
          );
          const midMesh = new THREE.Mesh(midGeom, railBeamMat);
          midMesh.castShadow = true;
          midMesh.receiveShadow = true;
          railGroup.add(midMesh);

          let postCounter = 0;
          for (let s = iv.start + 1.25; s <= iv.end - 1.25; s += 2.5) {
            const f = getInterpolatedFrame(s);
            const postX = f.pos.x + f.normal.x * railCenterOff;
            const postZ = f.pos.z + f.normal.z * railCenterOff;
            const postYaw = Math.atan2(f.tangent.x, f.tangent.z);

            const postMesh = new THREE.Mesh(postGeo, railBeamMat);
            postMesh.position.set(postX, baseY + 0.39, postZ);
            postMesh.rotation.y = postYaw;
            postMesh.castShadow = true;
            postMesh.receiveShadow = true;
            railGroup.add(postMesh);

            if (postCounter % 2 === 0) {
              const badgeMesh = new THREE.Mesh(retroBadgeGeo, railRetroMat);
              badgeMesh.position.set(postX, baseY + 0.62, postZ);
              badgeMesh.rotation.y = postYaw;
              railGroup.add(badgeMesh);
            }
            postCounter += 1;
          }
        }
        group.add(railGroup);
      }
    }

    // 6. 交差点アプローチ標示・横断歩道・停止線・進行方向矢印・制限速度ペイント・マンホール・信号機
    const yellowPaintMat = (() => {
      const yellowMat = new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        emissive: 0xf59e0b,
        emissiveIntensity: 0.45,
        roughness: 0.45,
        metalness: 0.05,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      });
      this.markings.applyRoadMarking3DTexture(yellowMat, "yellow-paint");
      return yellowMat;
    })();

    for (const app of validCurvedApproaches) {
      const fCross = getInterpolatedFrame(app.sCross);
      if (app.hasCrosswalk) {
        const zebraGeo = new THREE.PlaneGeometry(0.45, 3.6);
        zebraGeo.rotateX(-Math.PI / 2);
        const crossYaw = Math.atan2(fCross.tangent.x, fCross.tangent.z);

        const zebraStartOff = -halfDriveable + 1.0;
        const zebraEndOff = halfDriveable - 1.0;
        let stripeIdx = 0;
        for (let off = zebraStartOff; off <= zebraEndOff; off += 0.9) {
          const zebraMesh = new THREE.Mesh(zebraGeo, whiteLineMat);
          zebraMesh.name = `CurvedCrosswalk_${app.name}_${app.ivIdx}_${stripeIdx++}`;
          zebraMesh.userData.markingType = "CrosswalkStripe";
          zebraMesh.position.set(
            fCross.pos.x + fCross.normal.x * off,
            baseY + 0.024,
            fCross.pos.z + fCross.normal.z * off,
          );
          zebraMesh.rotation.y = crossYaw;
          zebraMesh.receiveShadow = true;
          group.add(zebraMesh);
        }
      }

      if (app.hasStopLine) {
        const isStartApproach = app.isStart;
        const stopOffLeft = isStartApproach ? -halfDriveable + 0.5 : Math.max(0.1, medianW * 0.5);
        const stopOffRight = isStartApproach ? -Math.max(0.1, medianW * 0.5) : halfDriveable - 0.5;

        const stopGeom = buildArcRibbonGeometry(
          stopOffLeft,
          stopOffRight,
          baseY + 0.024,
          app.sStop - 0.2,
          app.sStop + 0.2,
          1,
          0.2,
        );
        const stopMesh = new THREE.Mesh(stopGeom, whiteLineMat);
        stopMesh.name = `CurvedStopLine_${app.name}_${app.ivIdx}`;
        stopMesh.userData.markingType = "StopLine";
        stopMesh.receiveShadow = true;
        group.add(stopMesh);

        const canAddArrows = lanesPerDir >= 2 && app.ivLen >= 42.0;
        if (canAddArrows) {
          const arrowOffsets = [8.0, 20.0];
          for (const arrDist of arrowOffsets) {
            const sArrow = isStartApproach ? app.sStop + arrDist : app.sStop - arrDist;
            const isArrowInSpan = sArrow >= app.ivStart && sArrow <= app.ivEnd;
            if (!isArrowInSpan) {
              continue;
            }
            const fArrow = getInterpolatedFrame(sArrow);
            const isArrowBlocked = isPointInExclusion(fArrow.pos.x, fArrow.pos.z, 2.0);
            if (isArrowBlocked) {
              continue;
            }
            const arrowYaw = isStartApproach
              ? Math.atan2(fArrow.tangent.x, fArrow.tangent.z)
              : Math.atan2(-fArrow.tangent.x, -fArrow.tangent.z);

            for (let lane = 1; lane <= lanesPerDir; lane++) {
              const laneCenterOffset = isStartApproach
                ? -(medianW * 0.5 + (lane - 0.5) * config.laneWidth)
                : +(medianW * 0.5 + (lane - 0.5) * config.laneWidth);

              const arrowType: "straight" | "straight-left" | "right" =
                lane === 1 ? "right" : lane === lanesPerDir ? "straight-left" : "straight";

              const arrowMesh = this.markings.createLaneArrowMarking(
                fArrow.pos.x + fArrow.normal.x * laneCenterOffset,
                fArrow.pos.z + fArrow.normal.z * laneCenterOffset,
                arrowType,
                arrowYaw,
              );
              arrowMesh.position.y = baseY + 0.024;
              group.add(arrowMesh);
            }
          }
        }

        const canAddYellowSolid = lanesPerDir >= 2 && app.ivLen >= 40.0;
        if (canAddYellowSolid) {
          const sYellowStart = isStartApproach
            ? app.sStop
            : Math.max(app.ivStart, app.sStop - 18.0);
          const sYellowEnd = isStartApproach ? Math.min(app.ivEnd, app.sStop + 18.0) : app.sStop;
          for (let lane = 1; lane < lanesPerDir; lane++) {
            const laneDivOff = isStartApproach
              ? -(medianW * 0.5 + lane * config.laneWidth)
              : +(medianW * 0.5 + lane * config.laneWidth);
            const yellowDivGeom = buildArcRibbonGeometry(
              laneDivOff - 0.075,
              laneDivOff + 0.075,
              baseY + 0.024,
              sYellowStart,
              sYellowEnd,
              1,
              0.2,
            );
            const yellowDivMesh = new THREE.Mesh(yellowDivGeom, yellowPaintMat);
            yellowDivMesh.name = `CurvedMarking_YellowNoLaneChange_${app.name}_${lane}_${app.ivIdx}`;
            yellowDivMesh.receiveShadow = true;
            group.add(yellowDivMesh);
          }
        }
      }
    }

    for (let ivIdx = 0; ivIdx < activeRoadIntervals.length; ivIdx++) {
      const iv = activeRoadIntervals[ivIdx];
      const ivLen = iv.end - iv.start;
      const isLongEnough = ivLen >= 28.0;
      if (!isLongEnough) {
        continue;
      }

      // 制限速度ペイント (区間中央付近)
      const canAddSpeedLimit = ivLen >= 55.0;
      if (canAddSpeedLimit) {
        const sMid = (iv.start + iv.end) * 0.5;
        const fMid = getInterpolatedFrame(sMid);
        const speedVal = config.speedLimitSign ?? (lanesPerDir >= 3 ? 50 : 40);

        for (const dirSign of [-1, 1]) {
          const isReverse = dirSign < 0;
          const speedYaw = isReverse
            ? Math.atan2(fMid.tangent.x, fMid.tangent.z)
            : Math.atan2(-fMid.tangent.x, -fMid.tangent.z);
          const speedLaneOff = dirSign * (medianW * 0.5 + 0.5 * config.laneWidth);
          const speedMarking = this.markings.createSpeedLimitRoadMarking(
            fMid.pos.x + fMid.normal.x * speedLaneOff,
            fMid.pos.z + fMid.normal.z * speedLaneOff,
            speedVal,
            speedYaw,
          );
          speedMarking.position.y = baseY + 0.025;
          group.add(speedMarking);
        }
      }

      // マンホール＆雨水ますグレーチング
      const hasManholes = Boolean(config.hasManholes);
      if (hasManholes) {
        for (let s = iv.start + 14.0; s <= iv.end - 14.0; s += 28.0) {
          const fProp = getInterpolatedFrame(s);
          const mhStep = Math.floor(s / 28.0);
          const isEvenStep = mhStep % 2 === 0;
          const mhOff = (isEvenStep ? 1 : -1) * (halfDriveable * 0.5);
          const mh = this.props.createManhole(
            fProp.pos.x + fProp.normal.x * mhOff,
            fProp.pos.z + fProp.normal.z * mhOff,
          );
          mh.position.y = baseY + 0.005;
          group.add(mh);

          for (const side of [-1, 1]) {
            const gutterOff = side * (halfDriveable - 0.35);
            const grating = this.props.createGrating(
              fProp.pos.x + fProp.normal.x * gutterOff,
              fProp.pos.z + fProp.normal.z * gutterOff,
            );
            grating.position.y = baseY + 0.005;
            grating.rotation.y = Math.atan2(fProp.tangent.x, fProp.tangent.z);
            group.add(grating);
          }
        }
      }

      // 信号機 (始端・終端の外側歩道上)
      const hasTrafficLights = Boolean(config.hasTrafficLights) && ivLen >= 35.0;
      if (hasTrafficLights) {
        const lightApps = [
          { s: iv.start + 4.5, sideSign: -1 },
          { s: iv.end - 4.5, sideSign: 1 },
        ];
        for (const la of lightApps) {
          const fLight = getInterpolatedFrame(la.s);
          const lightOff = la.sideSign * (halfDriveable + 1.25);
          const lightPosX = fLight.pos.x + fLight.normal.x * lightOff;
          const lightPosZ = fLight.pos.z + fLight.normal.z * lightOff;
          const isLightBlocked = isPointInExclusion(lightPosX, lightPosZ, 3.0);
          if (isLightBlocked) {
            continue;
          }

          const lightYaw =
            la.sideSign < 0
              ? Math.atan2(-fLight.tangent.x, -fLight.tangent.z)
              : Math.atan2(fLight.tangent.x, fLight.tangent.z);

          const tl = this.props.createTrafficLight(lightPosX, lightPosZ, lightYaw, {
            activeSignal: "green",
            showArrowSignal: lanesPerDir >= 2,
            intersectionNameJa: config.name,
          });
          tl.position.y = baseY;
          group.add(tl);
        }
      }
    }

    // 7. 物理エンジンのフラット路面コライダー＆片側歩道・ガードレール開口同期済み立体コライダー
    const createFixedChordBody = (p0: THREE.Vector3, p1: THREE.Vector3) => {
      const segDx = p1.x - p0.x;
      const segDz = p1.z - p0.z;
      const segLen = Math.hypot(segDx, segDz);
      const isTooShort = segLen < 0.5;
      if (isTooShort) {
        return null;
      }
      const midX = (p0.x + p1.x) * 0.5;
      const midZ = (p0.z + p1.z) * 0.5;
      const yaw = Math.atan2(segDx, segDz);
      const halfYaw = yaw * 0.5;
      const bodyDesc = rapier.RigidBodyDesc.fixed()
        .setTranslation(midX, baseY, midZ)
        .setRotation(new rapier.Quaternion(0, Math.sin(halfYaw), 0, Math.cos(halfYaw)));
      return { body: physicsWorld.createRigidBody(bodyDesc), segLen };
    };

    const roadChordCount = Math.max(6, Math.min(120, Math.ceil(totalSplineLength / 12.0)));
    for (let i = 0; i < roadChordCount; i++) {
      const p0 = spline.getPointAt(i / roadChordCount);
      const p1 = spline.getPointAt((i + 1) / roadChordCount);
      const chord = createFixedChordBody(p0, p1);
      if (!chord) {
        continue;
      }
      const roadColliderDesc = rapier.ColliderDesc.cuboid(
        driveableWidth / 2,
        0.25,
        chord.segLen / 2 + 1.2,
      )
        .setTranslation(0, -0.25, 0)
        .setFriction(0.85)
        .setRestitution(0.02);
      segmentColliders.push(physicsWorld.createCollider(roadColliderDesc, chord.body));
    }

    const addObstacleIntervalChords = (
      intervals: ReadonlyArray<{ start: number; end: number }>,
      attachColliders: (body: RAPIER.RigidBody, segLen: number) => void,
    ): void => {
      for (const iv of intervals) {
        const span = iv.end - iv.start;
        const subCount = Math.max(1, Math.ceil(span / 8.0));
        for (let i = 0; i < subCount; i++) {
          const p0 = getInterpolatedFrame(iv.start + (span * i) / subCount).pos;
          const p1 = getInterpolatedFrame(iv.start + (span * (i + 1)) / subCount).pos;
          const chord = createFixedChordBody(p0, p1);
          if (!chord) {
            continue;
          }
          attachColliders(chord.body, chord.segLen);
        }
      }
    };

    // 左右それぞれの歩道区間と視覚幅に 1:1 一致する歩道物理コライダー
    for (const sc of [
      { sideSign: -1 as const, intervals: rightSidewalkIntervals },
      { sideSign: 1 as const, intervals: leftSidewalkIntervals },
    ]) {
      const sideSpec = getSideCrossSection(cross, sc.sideSign);
      if (sideSpec.totalWidth <= 0.05 || sc.intervals.length === 0) {
        continue;
      }
      const swCenterX = sc.sideSign * (halfDriveable + sideSpec.totalWidth * 0.5);
      addObstacleIntervalChords(sc.intervals, (body, segLen) => {
        const swColDesc = rapier.ColliderDesc.cuboid(
          sideSpec.totalWidth * 0.5,
          cross.curbHeight * 0.5,
          segLen * 0.5,
        )
          .setTranslation(swCenterX, cross.curbHeight * 0.5, 0)
          .setFriction(0.8);
        const swCol = physicsWorld.createCollider(swColDesc, body);
        segmentColliders.push(swCol);
        obstacleColliderHandles.push(swCol.handle);
      });
    }

    // 横断歩道開口部と 100% 同期したガードレール物理コライダー
    if (hasGuardrails) {
      const railHeight = 0.85;
      const railThickness = 0.24;
      const railCenterY = cross.curbHeight + railHeight * 0.5;
      for (const rs of [
        { sideSign: -1 as const, intervals: rightGuardrailIntervals },
        { sideSign: 1 as const, intervals: leftGuardrailIntervals },
      ]) {
        const railX = rs.sideSign * (halfDriveable + 0.36);
        addObstacleIntervalChords(rs.intervals, (body, segLen) => {
          const railColDesc = rapier.ColliderDesc.cuboid(
            railThickness * 0.5,
            railHeight * 0.5,
            segLen * 0.5,
          )
            .setTranslation(railX, railCenterY, 0)
            .setFriction(0.4)
            .setRestitution(0.25);
          const railCol = physicsWorld.createCollider(railColDesc, body);
          segmentColliders.push(railCol);
          obstacleColliderHandles.push(railCol.handle);
        });
      }
    }

    if (hasRaisedMedian) {
      addObstacleIntervalChords(medianIntervals, (body, segLen) => {
        const medColDesc = rapier.ColliderDesc.cuboid(
          Math.max(0.25, medianW / 2 - 0.06),
          medianHeight / 2,
          segLen / 2,
        )
          .setTranslation(0, medianHeight / 2, 0)
          .setFriction(0.6)
          .setRestitution(0.15);
        const medCol = physicsWorld.createCollider(medColDesc, body);
        segmentColliders.push(medCol);
        obstacleColliderHandles.push(medCol.handle);
      });
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

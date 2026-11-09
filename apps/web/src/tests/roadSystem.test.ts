import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { JapaneseRoadBuilder } from "../roads/roadBuilder";
import { JapaneseRoadMaterial } from "../roads/japaneseRoadMaterial";
import { RoadProps } from "../roads/roadProps";
import type { JapaneseRoadSegmentConfig } from "../roads/types";
import { getOpenDataCurvedRoadCorridors } from "../openData/gsiPlateauLoader";

describe("日本の道路作成システムの仕様検証", () => {
  it("道路構造令に基づき視覚メッシュ（凸凹シェーダー）と完全平坦コライダーが生成されることを保証する", () => {
    // モック用 Rapier World と RigidBody / Collider
    const createdColliders: Array<{ width: number; height: number; depth: number }> = [];

    const mockBody = {} as any;
    const mockWorld = {
      createRigidBody: () => mockBody,
      createCollider: (desc: any) => {
        createdColliders.push(desc.halfExtents);
        return { handle: createdColliders.length } as any;
      },
    } as any;

    const mockRapier = {
      RigidBodyDesc: {
        fixed: () => ({
          setTranslation: () => ({
            setRotation: () => ({}),
          }),
        }),
      },
      ColliderDesc: {
        cuboid: (hx: number, hy: number, hz: number) => ({
          halfExtents: { width: hx * 2, height: hy * 2, depth: hz * 2 },
          setTranslation: function () {
            return this;
          },
          setFriction: function () {
            return this;
          },
          setRestitution: function () {
            return this;
          },
        }),
      },
      Quaternion: class {
        constructor(
          public x: number,
          public y: number,
          public z: number,
          public w: number,
        ) {}
      },
    } as any;

    const builder = new JapaneseRoadBuilder();
    const config: JapaneseRoadSegmentConfig = {
      name: "Gyoko-dori",
      lanesPerDirection: 2,
      laneWidth: 3.5,
      shoulderWidth: 1.5,
      sidewalkWidth: 4.5,
      curbHeight: 0.15,
      length: 100,
      hasYellowCenterLine: true,
      hasWhiteDashedLines: true,
      hasCrosswalk: true,
      hasGuardrails: true,
      hasManholes: true,
      hasTrafficLights: true,
    };

    const result = builder.buildSegment(
      config,
      mockWorld,
      mockRapier,
      new THREE.Vector3(0, 0, 0),
      0,
    );

    // 1. 視覚グループ内に道路メッシュ、縁石、歩道、プロップが正しく構築されていること
    const hasVisualGroup = Boolean(result.group);
    expect(hasVisualGroup).toBe(true);
    expect(result.group.children.length).toBeGreaterThan(0);

    // 2. 道路マテリアル（凸凹シェーダー）が生成されていること
    const hasMaterials = result.materials.length > 0;
    expect(hasMaterials).toBe(true);

    // 3. 物理コライダーの幅員計算（車道幅: 2*2*3.5 + 1.5*2 = 17m, 平坦な直方体）
    // Trimesh ではなく平滑な直方体（Cuboid）により物理スナッギングを防止
    const expectedRoadwayWidth =
      config.lanesPerDirection * 2 * config.laneWidth + config.shoulderWidth * 2;
    expect(expectedRoadwayWidth).toBe(17.0);

    const roadCollider = createdColliders[0];
    const isFlatCollider = roadCollider.height <= 0.5;
    expect(isFlatCollider).toBe(true);
    expect(roadCollider.width).toBeCloseTo(expectedRoadwayWidth, 0.01);

    // 4. 歩道縁石・ガードレール（横断歩道前後の開口部で2分割×左右＝4区間）・信号機支柱・道路標識支柱・デリネーターの物理コライダーがすべて生成されることを保証する
    // 車道(1) + 左右歩道(2) + 左右分割ガードレール(4) + 信号機支柱(4) + 標識支柱(6) + デリネーター(2) = 19個
    expect(result.colliders.length).toBe(19);
    expect(result.obstacleColliderHandles.length).toBe(16);

    // 5. 横断歩道（crossZ = length * 0.25 = 25m）の前後にガードレール開口部が設けられ、歩行者の通路を塞がないことを保証する
    const guardrailGroups = result.group.children.filter(
      (child) => child.name === "JapaneseGuardrailSlot",
    );
    expect(guardrailGroups.length).toBe(4);
    for (const gr of guardrailGroups) {
      const box = new THREE.Box3().setFromObject(gr);
      const overlapsCrosswalkCenter = box.min.z < 23.0 && box.max.z > 27.0;
      expect(overlapsCrosswalkCenter).toBe(false);
    }
  });

  it("国土地理院の道路中心線ポリライン（複数座標点）から Catmull-Rom スプライン曲線車道メッシュ・区画線・歩道・平坦コライダーが生成されることを保証する", () => {
    const createdColliders: Array<{ width: number; height: number; depth: number }> = [];
    const mockBody = {} as any;
    const mockWorld = {
      createRigidBody: () => mockBody,
      createCollider: (desc: any) => {
        createdColliders.push(desc.halfExtents);
        return { handle: createdColliders.length } as any;
      },
    } as any;
    const mockRapier = {
      RigidBodyDesc: {
        fixed: () => ({
          setTranslation: () => ({
            setRotation: () => ({}),
          }),
        }),
      },
      ColliderDesc: {
        cuboid: (hx: number, hy: number, hz: number) => ({
          halfExtents: { width: hx * 2, height: hy * 2, depth: hz * 2 },
          setTranslation: function () {
            return this;
          },
          setRotation: function () {
            return this;
          },
          setFriction: function () {
            return this;
          },
          setRestitution: function () {
            return this;
          },
        }),
      },
      Quaternion: class {
        constructor(
          public x: number,
          public y: number,
          public z: number,
          public w: number,
        ) {}
      },
    } as any;

    const builder = new JapaneseRoadBuilder();
    const curvePoints = [
      { x: -750, z: -40 },
      { x: -790, z: -55 },
      { x: -840, z: -90 },
      { x: -890, z: -135 },
    ];
    const curvedResult = builder.buildPolylineSegment(
      {
        name: "Sakuragaoka-Curve",
        lanesPerDirection: 2,
        laneWidth: 3.25,
        shoulderWidth: 1.25,
        sidewalkWidth: 3.5,
        curbHeight: 0.15,
        length: 180,
        hasYellowCenterLine: true,
        hasWhiteDashedLines: true,
        hasCrosswalk: false,
        hasGuardrails: true,
        hasManholes: false,
        hasTrafficLights: false,
        points: curvePoints,
      },
      curvePoints,
      mockWorld,
      mockRapier,
    );

    expect(curvedResult.group.children.length).toBeGreaterThan(4);
    expect(curvedResult.group.userData.isRoadInfrastructure).toBe(true);
    expect(curvedResult.group.getObjectByName("CurvedGuardrail_L")).toBeDefined();
    expect(curvedResult.group.getObjectByName("CurvedGuardrail_R")).toBeDefined();
    expect(curvedResult.materials.length).toBe(1);
    expect(curvedResult.puddleMaterials.length).toBe(1);
    expect(curvedResult.colliders.length).toBeGreaterThan(9);
    expect(curvedResult.obstacleColliderHandles.length).toBeGreaterThan(8);
    const hasFlatRoadCollider = createdColliders.some((c) => c.height <= 0.5 && c.width >= 14);
    const hasGuardrailCollider = createdColliders.some(
      (c) => Math.abs(c.height - 0.85) < 0.05 && Math.abs(c.width - 0.24) < 0.05,
    );
    expect(hasFlatRoadCollider).toBe(true);
    expect(hasGuardrailCollider).toBe(true);
  });

  it("渋谷エリア実在放射状曲線道路網（道玄坂・文化村通り・玉川通り西進等）が buildPolylineSegment で正常に物理コライダーおよび路面メッシュを生成することを保証する", () => {
    const createdColliders: Array<{ width: number; height: number; depth: number }> = [];
    const mockBody = {} as any;
    const mockWorld = {
      createRigidBody: () => mockBody,
      createCollider: (desc: any) => {
        createdColliders.push(desc.halfExtents);
        return { handle: createdColliders.length } as any;
      },
    } as any;

    const mockRapier = {
      RigidBodyDesc: {
        fixed: () => ({
          setTranslation: () => ({
            setRotation: () => ({}),
          }),
        }),
      },
      ColliderDesc: {
        cuboid: (hx: number, hy: number, hz: number) => ({
          halfExtents: { width: hx * 2, height: hy * 2, depth: hz * 2 },
          setTranslation: function () {
            return this;
          },
          setFriction: function () {
            return this;
          },
          setRestitution: function () {
            return this;
          },
        }),
      },
      Quaternion: class {
        constructor(
          public x: number,
          public y: number,
          public z: number,
          public w: number,
        ) {}
      },
    } as any;

    const builder = new JapaneseRoadBuilder();
    const curvedCorridors = getOpenDataCurvedRoadCorridors();
    const shibuyaRadial = curvedCorridors.filter((c) => c.id.startsWith("nav-road-shibuya-"));
    expect(shibuyaRadial.length).toBeGreaterThanOrEqual(9);

    for (const c of shibuyaRadial) {
      const result = builder.buildPolylineSegment(
        {
          name: c.displayName,
          lanesPerDirection: 1,
          laneWidth: c.widthMeters * 0.25,
          shoulderWidth: 1.0,
          sidewalkWidth: 2.5,
          curbHeight: 0.15,
          length: 100,
          hasYellowCenterLine: c.hasMedianLine,
          hasWhiteDashedLines: false,
          hasCrosswalk: false,
          hasGuardrails: true,
          hasManholes: false,
          hasTrafficLights: false,
          points: c.points,
        },
        c.points,
        mockWorld,
        mockRapier,
      );

      expect(result.group.children.length).toBeGreaterThan(0);
      expect(result.group.userData.isRoadInfrastructure).toBe(true);
      expect(result.materials.length).toBeGreaterThanOrEqual(1);
      expect(result.colliders.length).toBeGreaterThanOrEqual(c.points.length - 1);
    }
  });

  it("日本の道路標識令に準拠した案内・規制・警戒・指示・通称名標識が正常に生成されることを保証する", async () => {
    const { JapaneseRoadSigns } = await import("../roads/roadSigns");
    const signs = new JapaneseRoadSigns();

    // 1. 大型オーバーヘッド青看板（108-A）: 既定は Google Street View（日比谷通り・大手町・和田倉門）実写準拠の F型片持ち式単柱（cantilever = 片足）
    const overheadCantilever = signs.createOverheadGuideSign(0, 0, {
      straightText: "皇居・大手町",
      leftText: "日比谷・霞が関",
      rightText: "東京駅・銀座",
      intersectionName: "和田倉門",
      spanWidth: 19.2,
    });
    expect(overheadCantilever.children.length).toBeGreaterThan(0);

    const cantileverCol = overheadCantilever.getObjectByName(
      "GantryColumn_CantileverLeft",
    ) as THREE.Mesh;
    const saddleBracket = overheadCantilever.getObjectByName(
      "CantileverSaddleBracket",
    ) as THREE.Mesh;
    const cantileverUpperBeam = overheadCantilever.getObjectByName("GantryUpperBeam") as THREE.Mesh;
    const cantileverLowerBeam = overheadCantilever.getObjectByName("GantryLowerBeam") as THREE.Mesh;
    const cantileverBoard = overheadCantilever.getObjectByName("PrimaryGuideBoard") as THREE.Mesh;
    const cantileverFace = overheadCantilever.getObjectByName("PrimaryGuideSignFace") as THREE.Mesh;
    expect(cantileverCol).toBeDefined();
    expect(saddleBracket).toBeDefined();
    expect(cantileverUpperBeam).toBeDefined();
    expect(cantileverLowerBeam).toBeDefined();
    expect(cantileverBoard).toBeDefined();
    expect(cantileverFace).toBeDefined();
    // 片足（F型片持ち式単柱）では右支柱や2枚目のサブ標識板が存在しないことを保証する
    expect(overheadCantilever.getObjectByName("GantryColumn_Right")).toBeUndefined();
    expect(overheadCantilever.getObjectByName("SecondaryLaneGuideBoard")).toBeUndefined();
    // rotation.y = Math.PI 配置時に左歩道（World +X = +9.6m）および左側通行車線（World +X > 0）へ正しく配置されるよう localX < 0 であることを保証する
    expect(cantileverCol.position.x).toBeCloseTo(-9.6, 2);
    expect(cantileverBoard.position.x).toBeLessThan(0);
    expect(cantileverUpperBeam.position.x).toBeLessThan(0);
    // 水平アーム右端が青看板の右端付近で終端し、対向車線側（localX > 0）へ突き出さないことを保証する
    const beamHalfLen =
      (cantileverUpperBeam.geometry as THREE.CylinderGeometry).parameters.height / 2;
    const beamRightEndLocalX = cantileverUpperBeam.position.x + beamHalfLen;
    expect(beamRightEndLocalX).toBeLessThan(0);

    // 逆光でも視認可能な JIS 高輝度再帰反射シート（非 null の emissiveMap と emissiveIntensity = 0.22）が表面メッシュに設定されていることを保証する
    const cantileverFaceMat = cantileverFace.material as THREE.MeshStandardMaterial;
    expect(cantileverFaceMat.emissiveMap).not.toBeNull();
    expect(cantileverFaceMat.emissiveIntensity).toBeCloseTo(0.22, 2);

    // 看板上部の外照式標識照明灯（2灯）が単なる発光メッシュではなく、看板表面を実際に照らす Three.js SpotLight 実光源を備えていることを保証する
    for (const lampIdx of [0, 1]) {
      const lampHood = overheadCantilever.getObjectByName(
        `OverheadSignLampHood_Primary_${lampIdx}`,
      ) as THREE.Group;
      const lampBulb = overheadCantilever.getObjectByName(
        `OverheadSignLampBulb_Primary_${lampIdx}`,
      ) as THREE.Mesh;
      const spotLight = overheadCantilever.getObjectByName(
        `OverheadSignSpotLight_Primary_${lampIdx}`,
      ) as THREE.SpotLight;
      const spotTarget = overheadCantilever.getObjectByName(
        `OverheadSignSpotLightTarget_Primary_${lampIdx}`,
      ) as THREE.Object3D;

      expect(lampHood).toBeDefined();
      expect(lampBulb).toBeDefined();
      expect(spotLight).toBeDefined();
      expect(spotLight.isSpotLight).toBe(true);
      expect(spotLight.intensity).toBeGreaterThan(0);
      expect(spotTarget).toBeDefined();
      expect(spotLight.target).toBe(spotTarget);

      // 光源が看板表面（z = 0.205）より手前（+Z）かつ看板上端付近（+Y）にあり、ターゲットが看板面上にあることで表面法線（+Z）へ光を照射することを保証する
      expect(spotLight.position.z).toBeGreaterThan(cantileverFace.position.z + 0.4);
      expect(spotLight.position.y).toBeGreaterThan(cantileverBoard.position.y + 1.0);
      expect(spotTarget.position.z).toBeCloseTo(cantileverFace.position.z, 2);
      expect(spotTarget.position.y).toBeLessThan(cantileverBoard.position.y);
    }

    // 1b. 狭幅員道路（spanWidth = 5.0m < 6.0m）でも水平アーム右端と主標識板が +spanWidth / 2 を超えて対向歩道へ突き出さないことを保証する
    const narrowCantilever = signs.createOverheadGuideSign(0, 0, {
      spanWidth: 5.0,
      supportType: "cantilever",
    });
    const narrowUpperBeam = narrowCantilever.getObjectByName("GantryUpperBeam") as THREE.Mesh;
    const narrowBoard = narrowCantilever.getObjectByName("PrimaryGuideBoard") as THREE.Mesh;
    const narrowBeamHalfLen =
      (narrowUpperBeam.geometry as THREE.CylinderGeometry).parameters.height / 2;
    const narrowBeamRightEnd = narrowUpperBeam.position.x + narrowBeamHalfLen;
    const narrowBoardRightEnd =
      narrowBoard.position.x + (narrowBoard.geometry as THREE.BoxGeometry).parameters.width / 2;
    expect(narrowBeamRightEnd).toBeLessThanOrEqual(2.5);
    expect(narrowBoardRightEnd).toBeLessThanOrEqual(2.5);

    // 1c. 門型ガントリー（portal）明示指定時は両脚支柱と2枚の標識板が生成されることを保証する
    const overheadPortal = signs.createOverheadGuideSign(0, 0, {
      straightText: "皇居・大手町",
      leftText: "日比谷・霞が関",
      rightText: "東京駅・銀座",
      spanWidth: 19.2,
      supportType: "portal",
    });
    const leftCol = overheadPortal.getObjectByName("GantryColumn_Left") as THREE.Mesh;
    const rightCol = overheadPortal.getObjectByName("GantryColumn_Right") as THREE.Mesh;
    const primaryBoard = overheadPortal.getObjectByName("PrimaryGuideBoard") as THREE.Mesh;
    const secondaryBoard = overheadPortal.getObjectByName("SecondaryLaneGuideBoard") as THREE.Mesh;
    expect(leftCol).toBeDefined();
    expect(rightCol).toBeDefined();
    expect(primaryBoard).toBeDefined();
    expect(secondaryBoard).toBeDefined();
    expect(leftCol.position.x).toBeCloseTo(-9.6, 2);
    expect(rightCol.position.x).toBeCloseTo(9.6, 2);
    expect(primaryBoard.position.x).toBeLessThan(0);

    // 2. 規制標識: 止まれ / STOP（330）— 裏板が逆三角形（頂点が下 y < 0）であり、上下逆転（▲）していないことを保証する
    const stopSign = signs.createStopSign(0, 0);
    expect(stopSign.children.length).toBeGreaterThan(0);
    const stopBacking = stopSign.getObjectByName("StopSignBackingBoard") as THREE.Mesh;
    expect(stopBacking).toBeDefined();
    expect(stopBacking.rotation.z).toBe(0);

    // 3. 規制標識: 最高速度（323）— CylinderGeometry 側面マッピングによる 90度横倒し・鏡文字を防ぎ、正立 PlaneGeometry（SpeedLimitSignFace）で描画されることを保証する
    const speedLimitSign = signs.createSpeedLimitSign(0, 0, 40, "終日");
    const speedFace = speedLimitSign.getObjectByName("SpeedLimitSignFace") as THREE.Mesh;
    expect(speedFace).toBeDefined();
    expect(speedFace.geometry.type).toBe("PlaneGeometry");
    expect(speedFace.rotation.x).toBe(0);
    expect(speedFace.rotation.y).toBe(0);
    expect(speedFace.rotation.z).toBe(0);
    expect(speedFace.position.z).toBeGreaterThan(0.01);
    expect((speedFace.material as THREE.MeshStandardMaterial).alphaTest).toBeGreaterThanOrEqual(
      0.5,
    );

    // RoadProps.createSpeedLimitSign も旧3メッシュ実装ではなく JapaneseRoadSigns へ委譲され、支柱貫通や白い四角が発生しないことを保証する
    const { RoadProps } = await import("../roads/roadProps");
    const roadProps = new RoadProps();
    const delegatedSpeedSign = roadProps.createSpeedLimitSign(0, 0, 60);
    const delegatedPole = delegatedSpeedSign.getObjectByName("RoadSignPole") as THREE.Mesh;
    const delegatedFace = delegatedSpeedSign.getObjectByName("SpeedLimitSignFace") as THREE.Mesh;
    expect(delegatedPole).toBeDefined();
    expect(delegatedPole.position.z).toBeLessThan(-0.04);
    expect(delegatedFace).toBeDefined();
    expect((delegatedFace.material as THREE.MeshStandardMaterial).alphaTest).toBeGreaterThanOrEqual(
      0.5,
    );

    // 4. 規制標識: 車両進入禁止（303）
    const noEntry = signs.createNoEntrySign(0, 0);
    expect(noEntry.children.length).toBeGreaterThan(0);

    // 5. 規制標識: 指定方向外進行禁止（311）
    const direction = signs.createDirectionSign(0, 0, "straight-left");
    expect(direction.children.length).toBeGreaterThan(0);

    // 6. 警戒標識: 信号機あり（201-2）
    const warning = signs.createWarningSignalSign(0, 0);
    expect(warning.children.length).toBeGreaterThan(0);

    // 7. 指示標識: 横断歩道（407）
    const crosswalkSign = signs.createCrosswalkSign(0, 0);
    expect(crosswalkSign.children.length).toBeGreaterThan(0);
    const crosswalkBacking = crosswalkSign.getObjectByName(
      "CrosswalkSignBackingBoard",
    ) as THREE.Mesh;
    expect(crosswalkBacking).toBeDefined();

    // 8. 通称名標識: 行幸通り（119）— 円筒支柱が標識表面（z = +0.02）を貫通せず、かつ支柱上端が看板上端から突き出さないことを保証する
    const streetName = signs.createStreetNameSign(0, 0, "行幸通り", "Gyoko-dori Ave.");
    expect(streetName.children.length).toBeGreaterThan(0);
    const streetPole = streetName.getObjectByName("RoadSignPole") as THREE.Mesh;
    expect(streetPole).toBeDefined();
    expect(streetPole.position.z).toBeLessThan(-0.04);

    // 9. 規制標識: 駐車禁止（316）& 駐停車禁止（315）+ 補助標識
    const noParking = signs.createNoParkingSign(0, 0, false, "終日");
    expect(noParking.children.length).toBeGreaterThan(0);
    const noStopping = signs.createNoParkingSign(0, 0, true, "ここまで");
    expect(noStopping.children.length).toBeGreaterThan(0);

    // 10. 規制標識: 転回禁止（313）
    const noUTurn = signs.createNoUTurnSign(0, 0, "終日");
    expect(noUTurn.children.length).toBeGreaterThan(0);

    // 11. 規制標識: 一方通行（326-A）
    const oneWay = signs.createOneWaySign(0, 0, "自転車を除く");
    expect(oneWay.children.length).toBeGreaterThan(0);

    // 12. 規制標識: 進行方向別通行区分（327の7）— 2車線仕様（直進・左折 | 右折）と 3車線仕様（直進・左折 | 直進 | 右折）の双方をサポートすることを保証する
    const laneDirection = signs.createLaneDirectionSign(0, 0, 2);
    expect(laneDirection.children.length).toBeGreaterThan(0);
    expect(laneDirection.userData.lanesPerDirection).toBe(2);

    const laneDirection3 = signs.createLaneDirectionSign(0, 0, 3);
    expect(laneDirection3.children.length).toBeGreaterThan(0);
    expect(laneDirection3.userData.lanesPerDirection).toBe(3);

    // 13. 案内標識: 交差点名標識（114-A）
    const intersectionName = signs.createIntersectionNameSign(0, 0, "和田倉門", "Wadakuramon");
    expect(intersectionName.children.length).toBeGreaterThan(0);

    // 14. 全単柱標識において、支柱上端（poleHeight）が標識板の上端より下に収まり、看板の上から柱が突き出さないこと、および背面リブ金具（SignBackMountingRibs）が存在することを保証する
    const singlePoleSigns = [
      stopSign,
      speedLimitSign,
      noEntry,
      direction,
      warning,
      crosswalkSign,
      streetName,
      noParking,
      noStopping,
      noUTurn,
      oneWay,
      laneDirection,
      intersectionName,
    ];
    for (const signGroup of singlePoleSigns) {
      const poleMesh = signGroup.getObjectByName("RoadSignPole") as THREE.Mesh;
      const ribs = signGroup.getObjectByName("SignBackMountingRibs") as THREE.Group;
      expect(poleMesh).toBeDefined();
      expect(ribs).toBeDefined();

      const poleHeight = poleMesh.userData.poleHeight as number;
      expect(poleHeight).toBeGreaterThan(2.0);

      // 標識グループ全体のバウンディングボックス上端（看板の上縁）が支柱上端より高い位置にあることを検証する
      const box = new THREE.Box3().setFromObject(signGroup);
      expect(box.max.y).toBeGreaterThan(poleHeight + 0.03);
    }

    // 15. 安全施設: 視線誘導標（デリネーター・黄黒ゼブラ警戒板）
    const delineator = signs.createDelineatorPost(0, 0);
    expect(delineator.children.length).toBeGreaterThan(0);
  });

  it("路面標示（ダイヤマーク◇・車線進行方向矢印・路面最高速度ペイント・導流帯ゼブラ）が正常に生成されることを保証する", async () => {
    const { RoadMarkings } = await import("../roads/roadMarkings");
    const markings = new RoadMarkings();

    const diamond = markings.createCrosswalkDiamondMarking(0, 10);
    expect(diamond.children.length).toBe(4);

    const arrowStraightLeft = markings.createLaneArrowMarking(-3.5, 20, "straight-left");
    expect(arrowStraightLeft.children.length).toBeGreaterThanOrEqual(3);

    const arrowRight = markings.createLaneArrowMarking(3.5, 20, "right");
    expect(arrowRight.children.length).toBeGreaterThanOrEqual(2);

    const speedPaint = markings.createSpeedLimitRoadMarking(-1.75, 15, 40);
    expect(speedPaint.children.length).toBeGreaterThan(0);
    // 標識令別表第6（規制標示 最高速度 105）に基づき、路面最高速度標示の色彩が「白」であることを保証する
    expect(speedPaint.userData.paintColor).toBe("white");

    const zebra = markings.createZebraZoneMarking(0.9, 12.0, 25);
    expect(zebra.children.length).toBeGreaterThanOrEqual(2);
  });

  it("日本の交通信号機（警察庁・警視庁仕様）が左から青緑・黄・赤の配列で1灯のみ発光し、角型歩行者用信号機・矢印灯器・実光源を備えることを保証する", async () => {
    const { RoadProps } = await import("../roads/roadProps");
    const props = new RoadProps();

    // 1. 既定（青信号点灯）の検証
    const signalGreen = props.createTrafficLight(8.95, 95.3, Math.PI);
    const vehicleHead = signalGreen.getObjectByName("VehicleSignalHead") as THREE.Group;
    const blueGreenLamp = signalGreen.getObjectByName("VehicleLamp_BlueGreen") as THREE.Mesh;
    const yellowLamp = signalGreen.getObjectByName("VehicleLamp_Yellow") as THREE.Mesh;
    const redLamp = signalGreen.getObjectByName("VehicleLamp_Red") as THREE.Mesh;
    const activeLight = signalGreen.getObjectByName("TrafficSignalActiveLight") as THREE.PointLight;
    const arrowSubUnit = signalGreen.getObjectByName("ArrowSignalSubUnit") as THREE.Group;
    const intersectionPlate = signalGreen.getObjectByName("IntersectionNamePlate") as THREE.Mesh;

    expect(vehicleHead).toBeDefined();
    expect(blueGreenLamp).toBeDefined();
    expect(yellowLamp).toBeDefined();
    expect(redLamp).toBeDefined();
    expect(activeLight).toBeDefined();
    expect(arrowSubUnit).toBeDefined();
    expect(intersectionPlate).toBeDefined();

    // 左から青緑（x < 0）・黄（x = 0）・赤（x > 0）の日本の信号配列であることを保証する
    expect(blueGreenLamp.position.x).toBeLessThan(0);
    expect(yellowLamp.position.x).toBeCloseTo(0, 2);
    expect(redLamp.position.x).toBeGreaterThan(0);

    // 3色同時点灯ではなく、青緑1灯のみが発光（emissiveIntensity > 1）し、黄・赤は消灯（emissiveIntensity === 0）していることを保証する
    const greenMat = blueGreenLamp.material as THREE.MeshStandardMaterial;
    const yellowMat = yellowLamp.material as THREE.MeshStandardMaterial;
    const redMat = redLamp.material as THREE.MeshStandardMaterial;
    expect(greenMat.emissiveIntensity).toBeGreaterThan(1.0);
    expect(yellowMat.emissiveIntensity).toBe(0);
    expect(redMat.emissiveIntensity).toBe(0);

    // 点灯中のランプ位置に THREE.PointLight 実光源が配置されていることを保証する
    expect(activeLight.isPointLight).toBe(true);
    expect(activeLight.intensity).toBeGreaterThan(0);
    expect(activeLight.position.x).toBeCloseTo(blueGreenLamp.position.x, 2);

    // 2. 歩行者用信号機（角型2灯ピクトグラム式＋上下支持アーム＋「歩行者・自転車専用」プレート＋押ボタン箱）の検証
    const pedHead = signalGreen.getObjectByName("PedestrianSignalHead") as THREE.Group;
    const pedArmUpper = signalGreen.getObjectByName("PedSignalArmUpper") as THREE.Mesh;
    const pedArmLower = signalGreen.getObjectByName("PedSignalArmLower") as THREE.Mesh;
    const pedHeaderPlate = signalGreen.getObjectByName("PedBicycleHeaderPlate") as THREE.Mesh;
    const pedRedStanding = signalGreen.getObjectByName("PedLamp_RedStanding") as THREE.Mesh;
    const pedGreenWalking = signalGreen.getObjectByName("PedLamp_GreenWalking") as THREE.Mesh;
    const pedPushButton = signalGreen.getObjectByName("PedPushButtonBox") as THREE.Group;

    expect(pedHead).toBeDefined();
    expect(pedArmUpper).toBeDefined();
    expect(pedArmLower).toBeDefined();
    expect(pedHeaderPlate).toBeDefined();
    expect(pedRedStanding).toBeDefined();
    expect(pedGreenWalking).toBeDefined();
    expect(pedPushButton).toBeDefined();

    // 歩行者用信号機が車両用灯器と同じ +Z 向き（rotation.y = 0）ではなく、横断歩道を渡る歩行者に正対する向き（rotation.y = π/2、ローカル +X 方向）であることを保証する
    expect(pedHead.rotation.y).toBeCloseTo(Math.PI / 2, 3);
    expect(pedHead.position.z).toBeGreaterThan(0.3);

    // 歩行者用信号も上段（赤立像）と下段（青緑歩行像）が同時点灯せず、下段のみ発光していることを保証する
    const pedRedMat = pedRedStanding.material as THREE.MeshStandardMaterial;
    const pedGreenMat = pedGreenWalking.material as THREE.MeshStandardMaterial;
    expect(pedRedMat.emissiveIntensity).toBe(0);
    expect(pedGreenMat.emissiveIntensity).toBeGreaterThan(1.0);

    // 3. 赤信号モード指定時は右端の赤ランプと歩行者上段の赤立像のみが発光することを保証する
    const signalRed = props.createTrafficLight(8.95, 95.3, Math.PI, {
      activeSignal: "red",
      showArrowSignal: false,
    });
    const redModeGreenLamp = signalRed.getObjectByName("VehicleLamp_BlueGreen") as THREE.Mesh;
    const redModeRedLamp = signalRed.getObjectByName("VehicleLamp_Red") as THREE.Mesh;
    const redModePedRed = signalRed.getObjectByName("PedLamp_RedStanding") as THREE.Mesh;
    const redModePedGreen = signalRed.getObjectByName("PedLamp_GreenWalking") as THREE.Mesh;

    expect((redModeGreenLamp.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(0);
    expect(
      (redModeRedLamp.material as THREE.MeshStandardMaterial).emissiveIntensity,
    ).toBeGreaterThan(1.0);
    expect(
      (redModePedRed.material as THREE.MeshStandardMaterial).emissiveIntensity,
    ).toBeGreaterThan(1.0);
    expect((redModePedGreen.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(0);
    expect(signalRed.getObjectByName("ArrowSignalSubUnit")).toBeUndefined();
  });

  it("宣言的道路標識作成システム（RoadSignSystem）が全15種の標識およびカスタム標識において支柱高さ・前後オフセット・裏リブ金具・正立Plane・左歩道正対配置・物理コライダーを構造的に保証すること", async () => {
    const {
      RoadSignSystem,
      ROAD_SIGN_CATALOG,
      computeSafePoleHeight,
      resolveLeftSidewalkPlacement,
    } = await import("../roads/roadSignSystem");

    // 1. 支柱高さ自動計算: 常に看板上端（boardCenterY + boardTopExtent）より下で支柱が止まることを保証する
    const boardCenterY = 2.65;
    const boardTopExtent = 0.14;
    const safePoleHeight = computeSafePoleHeight(boardCenterY, boardTopExtent, 0.08);
    expect(safePoleHeight).toBeCloseTo(2.666, 3);
    expect(safePoleHeight + 0.044).toBeLessThan(boardCenterY + boardTopExtent);

    // 2. 左側通行に基づく左歩道座標とドライバー正対角度（rotationY = heading + π）の自動算出を保証する
    // 南進（+Z方向, heading = 0）→ 左歩道は +X 側、看板正面は -Z（rotationY = π）
    const southPlacement = resolveLeftSidewalkPlacement({
      originX: 0,
      originZ: 50,
      travelHeadingRad: 0,
      forwardDistance: 12,
      leftLateralOffset: 6.3,
    });
    expect(southPlacement.position[0]).toBeCloseTo(6.3, 3);
    expect(southPlacement.position[2]).toBeCloseTo(62, 3);
    expect(Math.abs(southPlacement.rotationY)).toBeCloseTo(Math.PI, 3);

    // 北進（-Z方向, heading = π）→ 左歩道は -X 側、看板正面は +Z（rotationY = 0）
    const northPlacement = resolveLeftSidewalkPlacement({
      originX: 0,
      originZ: 50,
      travelHeadingRad: Math.PI,
      forwardDistance: 12,
      leftLateralOffset: 6.3,
    });
    expect(northPlacement.position[0]).toBeCloseTo(-6.3, 3);
    expect(northPlacement.position[2]).toBeCloseTo(38, 3);
    expect(northPlacement.rotationY).toBeCloseTo(0, 3);

    // 西進（-X方向, heading = -π/2）→ 左歩道は +Z 側、看板正面は +X（rotationY = +π/2）
    const westPlacement = resolveLeftSidewalkPlacement({
      originX: -20,
      originZ: 0,
      travelHeadingRad: -Math.PI / 2,
      forwardDistance: 15,
      leftLateralOffset: 21.8,
    });
    expect(westPlacement.position[0]).toBeCloseTo(-35, 3);
    expect(westPlacement.position[2]).toBeCloseTo(21.8, 3);
    expect(westPlacement.rotationY).toBeCloseTo(Math.PI / 2, 3);

    // 3. 全15種のカタログ標識を宣言的スペックから生成し、構造検証（validateSignAssembly）と物理コライダー登録がすべてパスすることを保証する
    const signSystem = new RoadSignSystem();
    let colliderCounter = 0;
    const mockPhysicsContext = {
      rapier: {
        ColliderDesc: {
          cylinder: () => ({
            setTranslation: function () {
              return this;
            },
            setFriction: function () {
              return this;
            },
            setRestitution: function () {
              return this;
            },
          }),
        },
      } as any,
      physicsWorld: {
        createCollider: () => {
          colliderCounter += 1;
          return { handle: 5000 + colliderCounter } as any;
        },
      } as any,
      fixedGroundBody: {} as any,
    };

    const catalogEntries = Object.values(ROAD_SIGN_CATALOG);
    expect(catalogEntries.length).toBe(15);

    for (const meta of catalogEntries) {
      const result = signSystem.createSignInstance(
        {
          id: `test-${meta.type}`,
          type: meta.type,
          position: [6.3, 0, 42.0],
          rotationY: Math.PI,
          speedLimit: 50,
          label: "丸の内仲通り",
          subLabel: "Marunouchi-Nakadori Ave.",
          leftLabel: "日比谷・銀座",
          leftSubLabel: "Hibiya / Ginza",
          rightLabel: "大手町・神田",
          rightSubLabel: "Otemachi / Kanda",
          intersectionName: "和田倉門",
          roadNumber: "404",
          subRoadNumber: "1",
          supportType: "cantilever",
          spanWidth: 13.0,
          directionType: "straight-left",
        },
        mockPhysicsContext,
      );

      expect(result.validation.valid).toBe(true);
      expect(result.validation.issues).toEqual([]);
      expect(result.validation.poleClearanceFromTop).toBeGreaterThan(0.01);
      expect(result.validation.hasBackMountingRibs).toBe(true);
      expect(result.validation.hasUprightFrontPlane).toBe(true);
      expect(result.colliderHandles.length).toBeGreaterThanOrEqual(1);
    }

    // 4. カスタム単柱標識ブループリントから任意の道路標識を組み立て、構造保証と YAML 出力が機能することを保証する
    const customGroup = signSystem.buildCustomSinglePoleSign({
      id: "custom-street-name-test",
      shape: "rectangle",
      boardCenterY: 2.65,
      width: 0.96,
      height: 0.28,
      auxiliaryText: "千代田区丸の内",
      drawFace: (ctx, w, h) => {
        ctx.fillStyle = "#003893";
        ctx.fillRect(0, 0, w, h);
      },
    });
    const customValidation = signSystem.validateSignAssembly(customGroup, "street_name");
    expect(customValidation.valid).toBe(true);
    expect(customValidation.issues).toEqual([]);

    const yaml = signSystem.toYamlSnippet({
      id: "sign-custom-01",
      type: "street_name",
      position: [6.3, 0, 55.2],
      rotationY: Math.PI,
      label: "鍛冶橋通り",
      subLabel: "Kajibashi-dori Ave.",
    });
    expect(yaml).toContain("id: sign-custom-01");
    expect(yaml).toContain("type: street_name");
    expect(yaml).toContain('label: "鍛冶橋通り"');
  });

  it("日本標準ガードレール（JIS G 3193 2山Wビーム・180度巻き込み袖ビーム・黄色反射帯付き支柱・Ω型ブラケット・デリネーター）が左右対向向きで生成されることを保証する", () => {
    const props = new RoadProps();
    const guardrailSlot = props.createGuardrail(12.0);
    expect(guardrailSlot.name).toBe("JapaneseGuardrailSlot");

    const root = guardrailSlot.getObjectByName("GuardrailRoot");
    const hasRoot = root !== undefined;
    expect(hasRoot).toBe(true);

    const wbeam = guardrailSlot.getObjectByName("Guardrail_WBeam") as THREE.Mesh | undefined;
    const sleeveEnds = guardrailSlot.getObjectByName("Guardrail_Sleeve_Ends");
    const posts = guardrailSlot.getObjectByName("Guardrail_Posts");
    const bracketsBolts = guardrailSlot.getObjectByName("Guardrail_Brackets_Bolts");
    const delineators = guardrailSlot.getObjectByName("Guardrail_Delineators");

    expect(wbeam).toBeDefined();
    expect(sleeveEnds).toBeDefined();
    expect(posts).toBeDefined();
    expect(bracketsBolts).toBeDefined();
    expect(delineators).toBeDefined();

    // Wビームが単なる直方体ではなく 2山波形断面（複数頂点プロファイル）を持ち、車道側 (+X) に張り出していることを検証
    const wbeamBox = new THREE.Box3().setFromObject(wbeam!);
    expect(wbeamBox.min.y).toBeCloseTo(0.455, 2);
    expect(wbeamBox.max.y).toBeCloseTo(0.805, 2);
    expect(wbeamBox.max.x - wbeamBox.min.x).toBeGreaterThan(0.08);

    // 両端の180度巻き込み型袖ビームがビーム全長 (±6.0m) の外側へ張り出し、歩道側 (-X) まで回り込んでいることを検証
    const sleeveBox = new THREE.Box3().setFromObject(sleeveEnds!);
    expect(sleeveBox.min.z).toBeLessThan(-6.2);
    expect(sleeveBox.max.z).toBeGreaterThan(6.2);
    expect(sleeveBox.min.x).toBeLessThan(-0.1);
  });

  it("交差点パッド専用マテリアル（isIntersection: true）と交差点路面標示（横断歩道・キーストーン誘導線・右折ひし形マーク）が生成されることを保証する", () => {
    const intersectionMat = new JapaneseRoadMaterial({
      isIntersection: true,
      baseRoughness: 0.85,
      baseMetalness: 0.12,
    });
    expect(intersectionMat.isIntersection).toBe(true);
    expect(intersectionMat.polygonOffset).toBe(true);
    expect(intersectionMat.polygonOffsetFactor).toBeCloseTo(-0.5, 2);

    const builder = new JapaneseRoadBuilder();
    const markingGroup = builder.buildIntersectionMarkingGroup(36, 36, {
      lanesX: 3,
      lanesZ: 3,
      crosswalkN: true,
      crosswalkS: true,
      crosswalkE: true,
      crosswalkW: true,
      hasGuideDots: true,
    });

    expect(markingGroup.name).toBe("IntersectionMarkings");
    expect(markingGroup.children.length).toBeGreaterThan(20);
  });

  it("渋谷スクランブル交差点の対角線X字型スクランブル横断歩道（斜め横断歩道）が正しい本数とPBRマテリアルで生成されることを保証する", () => {
    const builder = new JapaneseRoadBuilder();
    const scramble = builder.buildScrambleDiagonalCrosswalks(44);
    expect(scramble.name).toBe("ShibuyaScrambleDiagonalCrosswalks");
    expect(scramble.userData.isRoadInfrastructure).toBe(true);
    expect(scramble.children.length).toBeGreaterThanOrEqual(30);
    const firstStripe = scramble.children[0] as THREE.Mesh;
    expect(firstStripe.userData.markingType).toBe("CrosswalkStripe");
    const mat = firstStripe.material as THREE.MeshStandardMaterial;
    expect(mat.isMeshStandardMaterial).toBe(true);
    expect(mat.name).toBe("RoadMarking_WhitePaint");

    // 各ストライプが進行方向厚み 0.45m、横断歩道幅員 4.2m であり、対角線上を重ならずに 1.1m 間隔で並ぶことを保証する
    expect(firstStripe.userData.stripeWidth).toBe(0.45);
    expect(firstStripe.userData.stripeLength).toBe(4.2);

    const neSwStripes = scramble.children.filter(
      (c) => (c as THREE.Mesh).userData.diagonalDir === 1,
    ) as THREE.Mesh[];
    expect(neSwStripes.length).toBeGreaterThanOrEqual(15);
    // 連続する2ストライプ間の距離が 1.1m (stepDist) であり、厚み 0.45m より大きいため 0.65m のアスファルト隙間があり重なり合わないこと
    for (let i = 1; i < neSwStripes.length; i++) {
      const prev = neSwStripes[i - 1];
      const curr = neSwStripes[i];
      const dist = Math.hypot(curr.position.x - prev.position.x, curr.position.z - prev.position.z);
      expect(dist).toBeCloseTo(1.1, 2);
      expect(dist).toBeGreaterThan(0.45);
    }
  });

  it("渋谷スクランブル交差点の交差点標示（4面外周横断歩道）において中央ダイヤ標示（◇）および南北誘導破線が無効化されることを保証する", () => {
    const builder = new JapaneseRoadBuilder();
    const scrambleMarkings = builder.buildIntersectionMarkingGroup(44, 44, {
      lanesX: 3,
      lanesZ: 3,
      hasCrosswalks: true,
      hasCenterDiamond: false,
      hasGuideDots: false,
    });
    expect(scrambleMarkings.name).toBe("IntersectionMarkings");
    // 4面の外周横断歩道が存在すること
    expect(scrambleMarkings.getObjectByName("IntersectionCrosswalk_NS_North")).toBeDefined();
    expect(scrambleMarkings.getObjectByName("IntersectionCrosswalk_NS_South")).toBeDefined();
    expect(scrambleMarkings.getObjectByName("IntersectionCrosswalk_EW_East")).toBeDefined();
    expect(scrambleMarkings.getObjectByName("IntersectionCrosswalk_EW_West")).toBeDefined();
    // 対角線横断歩道と衝突する中央ダイヤ（◇）および誘導破線が生成されていないこと
    expect(scrambleMarkings.getObjectByName("IntersectionCenterDiamond_Edge")).toBeUndefined();
    expect(scrambleMarkings.getObjectByName("IntersectionGuideDot_NS")).toBeUndefined();
    expect(scrambleMarkings.getObjectByName("IntersectionGuideDot_EW")).toBeUndefined();
  });

  it("路面ダイヤ標示（◇）が × 印ではなく閉じた中抜きひし形になり、横断歩道区間を中央線・破線が貫通せず、停止線が進行方向片側車線のみに引かれることを保証する", async () => {
    const { RoadMarkings } = await import("../roads/roadMarkings");
    const markings = new RoadMarkings();

    // 1. ダイヤマーク（◇）の 4 辺の向きを検証：中心 (0, 0) を通る対角線（×）ではなく、4 頂点 (0, ±1.8), (±0.7, 0) を結ぶ外周辺であること
    const diamond = markings.createCrosswalkDiamondMarking(1.75, 10.0);
    expect(diamond.children.length).toBe(4);
    const bar0 = diamond.children[0] as THREE.Mesh; // dx < 0, dz < 0（左下辺）
    const bar1 = diamond.children[1] as THREE.Mesh; // dx > 0, dz < 0（右下辺）
    expect(bar0.position.x).toBeLessThan(0);
    expect(bar0.position.z).toBeLessThan(0);
    expect(bar0.rotation.y).toBeLessThan(0);
    expect(bar1.position.x).toBeGreaterThan(0);
    expect(bar1.position.z).toBeLessThan(0);
    expect(bar1.rotation.y).toBeGreaterThan(0);

    // 2. 横断歩道と停止線の配置：停止線が道路全幅ではなく進行方向車線側（z = -3.8 は x > 0、z = +3.8 は x < 0）のみに配置されていること
    const crosswalk = markings.createCrosswalk(14.0, 25.0);
    const stopLines = crosswalk.children.slice(-2) as THREE.Mesh[];
    expect(stopLines.length).toBe(2);
    const northStop = stopLines[0]; // z > 0（対向 -Z 車線用 → x < 0）
    const southStop = stopLines[1]; // z < 0（自車 +Z 車線用 → x > 0）
    expect(northStop.position.z).toBeGreaterThan(3.0);
    expect(northStop.position.x).toBeLessThan(0);
    expect(southStop.position.z).toBeLessThan(-3.0);
    expect(southStop.position.x).toBeGreaterThan(0);

    // 3. 中央線・車線境界線が横断歩道除外区間 [20.7, 29.3] を貫通せず分割されていること
    const excludeRanges: ReadonlyArray<readonly [number, number]> = [[20.7, 29.3]];
    const centerLine = markings.createCenterLine(100, true, excludeRanges);
    expect(centerLine.children.length).toBe(2);

    const laneDividers = markings.createLaneDividers(100, [-3.5, 3.5], excludeRanges);
    for (const child of laneDividers.children) {
      const z = child.position.z;
      const isOverlappingExcluded = z + 2.5 > 20.7 && z - 2.5 < 29.3;
      expect(isOverlappingExcluded).toBe(false);
    }
  });

  it("車線レイアウト計算（computeRoadLaneLayout）が1〜3車線道路の全車線スペック・境界線・横断歩道除外区間を正確に算出し、全路面標示メッシュ同士（車線・横断歩道・停止線・導流帯・矢印・ダイヤ◇・速度ペイント）の2D XZ バウンディングボックスが一切重ならないことを保証する", async () => {
    const { computeRoadLaneLayout, RoadMarkings } = await import("../roads/roadMarkings");
    const markings = new RoadMarkings();

    // 1. 1車線・2車線・3車線のレイアウト算出検証
    const layout1 = computeRoadLaneLayout({
      lanesPerDirection: 1,
      laneWidth: 3.5,
      length: 90,
      crosswalkZPositions: [22.5],
    });
    expect(layout1.lanes.length).toBe(2);
    expect(layout1.laneDividerOffsets).toEqual([]);
    expect(layout1.shoulderLineOffsets).toEqual([-3.5, 3.5]);
    expect(layout1.inboundNoLaneChangeZRanges).toEqual([]);
    expect(layout1.oncomingNoLaneChangeZRanges).toEqual([]);

    const layout2 = computeRoadLaneLayout({
      lanesPerDirection: 2,
      laneWidth: 3.5,
      length: 138,
      crosswalkZPositions: [34.5, -19.32],
    });
    expect(layout2.lanes.length).toBe(4);
    expect(layout2.laneDividerOffsets).toEqual([-3.5, 3.5]);
    expect(layout2.shoulderLineOffsets).toEqual([-7.0, 7.0]);
    // 道路交通法第26条の2第2項・第30条（交差点・横断歩道手前30mの進路変更禁止）に基づき、自車側（+Z進行）と対向車線側（-Z進行）の手前区間に黄色実線区間が算出されること
    expect(layout2.inboundNoLaneChangeZRanges.length).toBe(2);
    expect(layout2.oncomingNoLaneChangeZRanges.length).toBe(2);

    const layout3 = computeRoadLaneLayout({
      lanesPerDirection: 3,
      laneWidth: 3.5,
      length: 164,
      crosswalkZPositions: [41.0, -22.96],
    });
    expect(layout3.lanes.length).toBe(6);
    expect(layout3.laneDividerOffsets).toEqual([-7.0, -3.5, 3.5, 7.0]);
    expect(layout3.shoulderLineOffsets).toEqual([-10.5, 10.5]);
    expect(layout3.inboundNoLaneChangeZRanges.length).toBe(2);
    expect(layout3.oncomingNoLaneChangeZRanges.length).toBe(2);
    // 片側3車線では内側(right: +1.75)、中央(straight: +5.25)、外側(straight-left: +8.75)の3車線すべてが定義されていること
    const inboundLanes = layout3.lanes.filter((l) => l.direction === "inbound");
    expect(inboundLanes.map((l) => l.centerX)).toEqual([1.75, 5.25, 8.75]);
    expect(inboundLanes.map((l) => l.arrowType)).toEqual(["right", "straight", "straight-left"]);

    // 2. 直線道路セグメント（片側1車線・2車線・3車線）における横断歩道・停止線・車線ライン・車線内標示の2D XZ 非重複検証
    const mockBody = {} as any;
    const mockWorld = {
      createRigidBody: () => mockBody,
      createCollider: () => ({ handle: 1 }) as any,
    } as any;
    const mockRapier = {
      RigidBodyDesc: {
        fixed: () => ({
          setTranslation: () => ({
            setRotation: () => ({}),
          }),
        }),
      },
      ColliderDesc: {
        cuboid: () => ({
          setTranslation: function () {
            return this;
          },
          setFriction: function () {
            return this;
          },
          setRestitution: function () {
            return this;
          },
        }),
      },
      Quaternion: class {
        constructor(
          public x: number,
          public y: number,
          public z: number,
          public w: number,
        ) {}
      },
    } as any;

    const builder = new JapaneseRoadBuilder();
    const testConfigs: JapaneseRoadSegmentConfig[] = [
      {
        name: "Local-1Lane",
        lanesPerDirection: 1,
        laneWidth: 3.25,
        shoulderWidth: 0.75,
        sidewalkWidth: 3.0,
        curbHeight: 0.15,
        length: 88,
        hasYellowCenterLine: false,
        hasWhiteDashedLines: true,
        hasCrosswalks: true,
        hasGuardrails: false,
        hasManholes: false,
        hasTrafficLights: true,
        speedLimitSign: 40,
      },
      {
        name: "Gyoko-2Lane",
        lanesPerDirection: 2,
        laneWidth: 3.5,
        shoulderWidth: 1.5,
        sidewalkWidth: 4.5,
        curbHeight: 0.15,
        length: 138,
        hasYellowCenterLine: true,
        hasWhiteDashedLines: true,
        hasCrosswalks: true,
        hasGuardrails: true,
        hasManholes: true,
        hasTrafficLights: true,
        speedLimitSign: 40,
      },
      {
        name: "Meiji-Shibuya-3Lane",
        lanesPerDirection: 3,
        laneWidth: 3.5,
        shoulderWidth: 1.5,
        sidewalkWidth: 5.0,
        curbHeight: 0.15,
        length: 164,
        hasYellowCenterLine: true,
        hasWhiteDashedLines: true,
        hasCrosswalks: true,
        hasGuardrails: true,
        hasManholes: true,
        hasTrafficLights: true,
        speedLimitSign: 50,
      },
    ];

    interface MarkingBox2D {
      markingType: string;
      minX: number;
      maxX: number;
      minZ: number;
      maxZ: number;
    }

    const collectMarkingBoxes = (root: THREE.Object3D): MarkingBox2D[] => {
      root.updateMatrixWorld(true);
      const boxes: MarkingBox2D[] = [];
      root.traverse((obj) => {
        const isMesh = (obj as THREE.Mesh).isMesh;
        const markingType = obj.userData?.markingType as string | undefined;
        if (!isMesh || !markingType) {
          return;
        }
        const box3 = new THREE.Box3().setFromObject(obj);
        boxes.push({
          markingType,
          minX: box3.min.x,
          maxX: box3.max.x,
          minZ: box3.min.z,
          maxZ: box3.max.z,
        });
      });
      return boxes;
    };

    const overlaps2D = (a: MarkingBox2D, b: MarkingBox2D, eps = 0.02): boolean => {
      const overlapX = a.maxX - eps > b.minX && a.minX + eps < b.maxX;
      const overlapZ = a.maxZ - eps > b.minZ && a.minZ + eps < b.maxZ;
      return overlapX && overlapZ;
    };

    for (const cfg of testConfigs) {
      const seg = builder.buildSegment(cfg, mockWorld, mockRapier, new THREE.Vector3(0, 0, 0), 0);
      const boxes = collectMarkingBoxes(seg.group);

      const longitudinalLines = boxes.filter(
        (b) =>
          b.markingType === "CenterLine" ||
          b.markingType === "LaneDivider" ||
          b.markingType === "ShoulderLine",
      );
      const crosswalkAndStopBoxes = boxes.filter(
        (b) =>
          b.markingType === "CrosswalkStripe" ||
          b.markingType === "StopLine" ||
          b.markingType === "ZebraZone",
      );

      expect(longitudinalLines.length).toBeGreaterThan(0);
      expect(crosswalkAndStopBoxes.length).toBeGreaterThan(0);

      // 車線ライン（中央線・車線境界破線・路肩実線）が横断歩道・停止線・導流帯と一切重ならないことを検証
      for (const lineBox of longitudinalLines) {
        for (const cwBox of crosswalkAndStopBoxes) {
          const isOverlapping = overlaps2D(lineBox, cwBox);
          expect(isOverlapping).toBe(false);
        }
      }

      // 複数車線（lanesPerDirection >= 2）では：
      // 1) 道路交通法第17条第4項・警察庁交通規制基準に基づき、中央線は追越し禁止の黄色実線ではなく「白実線（CenterLine_SolidWhite）」であること
      // 2) 横断歩道・停止線手前の進路変更禁止黄色実線（LaneDivider_SolidYellow）と通常区間の白破線（LaneDivider_Dash）の両方が生成されること
      if (cfg.lanesPerDirection >= 2) {
        let solidYellowCount = 0;
        let whiteDashCount = 0;
        let centerWhiteSolidCount = 0;
        let centerYellowSolidCount = 0;
        seg.group.traverse((obj) => {
          if (
            obj.name === "LaneDivider_SolidYellow" &&
            obj.userData.isNoLaneChangeYellow === true
          ) {
            solidYellowCount += 1;
          }
          if (obj.name === "LaneDivider_Dash" && obj.userData.isNoLaneChangeYellow === false) {
            whiteDashCount += 1;
          }
          if (obj.name === "CenterLine_SolidWhite") {
            centerWhiteSolidCount += 1;
            expect(obj.userData.paintColor).toBe("white");
          }
          if (obj.name === "CenterLine_Solid") {
            centerYellowSolidCount += 1;
          }
        });
        expect(centerWhiteSolidCount).toBeGreaterThan(0);
        expect(centerYellowSolidCount).toBe(0);
        expect(solidYellowCount).toBeGreaterThanOrEqual((cfg.lanesPerDirection - 1) * 4);
        expect(whiteDashCount).toBeGreaterThan(0);
      }

      // 歩道の点字ブロック（TactilePaving）が歩道全長にわたる黄色車線のような連続帯ではなく、横断歩道接続部のみの離散パッド（長さ 2.4m）として配置されていること
      const tactileBoxes = boxes.filter((b) => b.markingType === "TactilePaving");
      expect(tactileBoxes.length).toBeGreaterThanOrEqual(2);
      for (const tBox of tactileBoxes) {
        const zSpan = tBox.maxZ - tBox.minZ;
        expect(zSpan).toBeLessThanOrEqual(2.5);
      }

      // 横断歩道・停止線が車線内標示（矢印・ダイヤ◇・速度標示）とも一切重ならないことを検証
      const inLaneMarkings = boxes.filter(
        (b) =>
          b.markingType === "LaneArrow" ||
          b.markingType === "CrosswalkDiamond" ||
          b.markingType === "SpeedMarking",
      );
      expect(inLaneMarkings.length).toBeGreaterThanOrEqual(cfg.lanesPerDirection * 2);
      for (const inLaneBox of inLaneMarkings) {
        for (const cwBox of crosswalkAndStopBoxes) {
          expect(overlaps2D(inLaneBox, cwBox)).toBe(false);
        }
        for (const lineBox of longitudinalLines) {
          expect(overlaps2D(inLaneBox, lineBox)).toBe(false);
        }
      }
    }

    // 3. 交差点標示（createIntersectionMarkings）において、南北横断歩道・東西横断歩道・誘導ドット・中央ダイヤが互いに一切重ならないことを保証する
    const interGroup = markings.createIntersectionMarkings(34, 34, {
      lanesX: 3,
      lanesZ: 2,
      crosswalkN: true,
      crosswalkS: true,
      crosswalkE: true,
      crosswalkW: true,
      hasGuideDots: true,
      hasCenterDiamond: true,
    });
    const interBoxes = collectMarkingBoxes(interGroup);
    const nsCrosswalks = interBoxes.filter((b) => b.markingType === "IntersectionCrosswalkNS");
    const ewCrosswalks = interBoxes.filter((b) => b.markingType === "IntersectionCrosswalkEW");
    const interStopLines = interBoxes.filter((b) => b.markingType === "IntersectionStopLine");
    const guideDots = interBoxes.filter((b) => b.markingType === "IntersectionGuideDot");
    const centerDiamonds = interBoxes.filter((b) => b.markingType === "IntersectionCenterDiamond");

    expect(nsCrosswalks.length).toBeGreaterThan(0);
    expect(ewCrosswalks.length).toBeGreaterThan(0);
    // 四方向すべての流入車線（左側通行）に停止線（指示標示 203）が生成され、横断歩道と重ならないこと
    expect(interStopLines.length).toBe(4);
    for (const stopBox of interStopLines) {
      for (const cw of [...nsCrosswalks, ...ewCrosswalks]) {
        expect(overlaps2D(stopBox, cw)).toBe(false);
      }
    }
    expect(guideDots.length).toBeGreaterThan(0);
    expect(centerDiamonds.length).toBe(4);

    // 南北横断歩道と東西横断歩道が四隅で重ならないこと
    for (const ns of nsCrosswalks) {
      for (const ew of ewCrosswalks) {
        expect(overlaps2D(ns, ew)).toBe(false);
      }
    }
    // 誘導ドットが横断歩道および中央ひし形マークと重ならないこと
    for (const dot of guideDots) {
      for (const cw of [...nsCrosswalks, ...ewCrosswalks]) {
        expect(overlaps2D(dot, cw)).toBe(false);
      }
      for (const cd of centerDiamonds) {
        expect(overlaps2D(dot, cd)).toBe(false);
      }
    }
  });

  it("ガードレールおよび路側デリネーターの反射板にコーナーキューブ（マイクロプリズム）再帰反射シェーダーが適用され、左右ツインヘッドライト座標・車両進行方向と動的同期することを保証する", async () => {
    const { applyRoadProp3DTexture } = await import("../roads/roadProps");
    const { JapaneseRoadSigns } = await import("../roads/roadSigns");

    // 1. applyRoadProp3DTexture(mat, "retroreflector") が modeCode = 8 とコーナーキューブ再帰反射シェーダーを注入すること
    const testRetroMat = new THREE.MeshStandardMaterial({
      color: 0xff8800,
      emissive: 0xff7700,
      emissiveIntensity: 1.35,
    });
    applyRoadProp3DTexture(testRetroMat, "retroreflector");
    expect(testRetroMat.userData.uRoadPropVolumeTex).toBeDefined();
    expect(testRetroMat.userData.roadPropMode).toBe("retroreflector");
    expect(testRetroMat.customProgramCacheKey()).toBe("road-prop-3d-unified-v4-8");

    const mockShader: {
      uniforms: Record<string, { value: unknown }>;
      vertexShader: string;
      fragmentShader: string;
    } = {
      uniforms: {},
      vertexShader: `#include <common>\n#include <begin_vertex>`,
      fragmentShader: `#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n#include <emissivemap_fragment>`,
    };
    testRetroMat.onBeforeCompile(mockShader as any, {} as any);

    expect(mockShader.uniforms.uRoadPropMode.value).toBe(8);
    expect(mockShader.uniforms.uHeadlightPosL).toBeDefined();
    expect(mockShader.uniforms.uHeadlightPosR).toBeDefined();
    expect(mockShader.uniforms.uVehicleForward).toBeDefined();
    expect(mockShader.uniforms.uHeadlightsActive).toBeDefined();
    expect(mockShader.uniforms.uEnvironmentNightFactor).toBeDefined();
    expect(mockShader.vertexShader).toContain("vPropWorldNormal");
    expect(mockShader.fragmentShader).toContain("honeycombLattice");
    expect(mockShader.fragmentShader).toContain("retroBrilliance");
    expect(mockShader.fragmentShader).toContain(
      "totalEmissiveRadiance = hotCoreColor * dynamicRetroGain",
    );

    // 2. RoadProps.syncRetroreflectorEnvironment が共有ユニフォームを更新すること
    RoadProps.syncRetroreflectorEnvironment({
      headlightPosL: new THREE.Vector3(-0.64, 0.67, 12.34),
      headlightPosR: new THREE.Vector3(0.64, 0.67, 12.34),
      vehicleForward: new THREE.Vector3(0, 0, 1),
      headlightsActive: 1.0,
      nightFactor: 0.85,
    });
    expect((mockShader.uniforms.uHeadlightPosL.value as THREE.Vector3).x).toBeCloseTo(-0.64, 3);
    expect((mockShader.uniforms.uHeadlightPosR.value as THREE.Vector3).x).toBeCloseTo(0.64, 3);
    expect((mockShader.uniforms.uVehicleForward.value as THREE.Vector3).z).toBeCloseTo(1.0, 3);
    expect(mockShader.uniforms.uHeadlightsActive.value).toBeCloseTo(1.0, 3);
    expect(mockShader.uniforms.uEnvironmentNightFactor.value).toBeCloseTo(0.85, 3);

    // 3. ガードレールのプロシージャルモデルが支柱天端丸型デリネーターとWビーム谷部台形反射板の両方を備え、"retroreflector" モードかつ中距離LODでも可視であることを保証する
    const props = new RoadProps();
    const guardrail = props.createGuardrail(24);
    const delineatorsGroup = guardrail.getObjectByName("Guardrail_Delineators") as THREE.Group;
    expect(delineatorsGroup).toBeDefined();
    expect(delineatorsGroup.children.length).toBeGreaterThan(4);

    let topCircularCount = 0;
    let troughTrapezoidCount = 0;
    delineatorsGroup.traverse((child) => {
      if (
        child.name === "GuardrailTopDelineatorAmber" ||
        child.name === "GuardrailTopDelineatorWhite"
      ) {
        topCircularCount += 1;
        const mesh = child as THREE.Mesh;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        expect(mat.userData.roadPropMode).toBe("retroreflector");
      }
      if (
        child.name === "GuardrailTroughReflectorAmber" ||
        child.name === "GuardrailTroughReflectorWhite"
      ) {
        troughTrapezoidCount += 1;
        const mesh = child as THREE.Mesh;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        expect(mat.userData.roadPropMode).toBe("retroreflector");
      }
    });
    expect(topCircularCount).toBeGreaterThanOrEqual(4);
    expect(troughTrapezoidCount).toBeGreaterThanOrEqual(12);

    // 中距離 LOD ("medium") でも反射板グループ (Guardrail_Delineators) が非表示にならず視認可能であること
    RoadProps.applyGuardrailSlotLod(guardrail, "medium");
    expect(delineatorsGroup.visible).toBe(true);
    RoadProps.applyGuardrailSlotLod(guardrail, "low");
    expect(delineatorsGroup.visible).toBe(false);

    // 4. 曲線道路・路肩の視線誘導標（createDelineatorPost）の反射レンズおよびゼブラ反射板にも "retroreflector" が適用されていること
    const signs = new JapaneseRoadSigns();
    const delineatorPost = signs.createDelineatorPost(0, 0);
    const topRetroLens = delineatorPost.getObjectByName("DelineatorTopRetroLens") as THREE.Mesh;
    const zebraRetroPlate = delineatorPost.getObjectByName(
      "DelineatorZebraRetroPlate",
    ) as THREE.Mesh;
    expect(topRetroLens).toBeDefined();
    expect(zebraRetroPlate).toBeDefined();
    expect((topRetroLens.material as THREE.MeshStandardMaterial).userData.roadPropMode).toBe(
      "retroreflector",
    );
    expect((zebraRetroPlate.material as THREE.MeshStandardMaterial).userData.roadPropMode).toBe(
      "retroreflector",
    );
  });
});

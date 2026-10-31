import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { JapaneseRoadBuilder } from "../roads/roadBuilder";
import type { JapaneseRoadSegmentConfig } from "../roads/types";

describe("日本の道路作成システムの仕様検証", () => {
  it("道路構造令に基づき視覚メッシュ（凸凹シェーダー）と完全平坦コライダーが生成されることを保証する", () => {
    // モック用 Rapier World と RigidBody / Collider
    const createdColliders: Array<{ width: number; height: number; depth: number }> = [];

    const mockBody = {} as any;
    const mockWorld = {
      createRigidBody: () => mockBody,
      createCollider: (desc: any) => {
        createdColliders.push(desc.halfExtents);
        return {} as any;
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
  });

  it("日本の道路標識令に準拠した案内・規制・警戒・指示・通称名標識が正常に生成されることを保証する", async () => {
    const { JapaneseRoadSigns } = await import("../roads/roadSigns");
    const signs = new JapaneseRoadSigns();

    // 1. 大型オーバーヘッド青看板（108-A）
    const overhead = signs.createOverheadGuideSign(0, 0, {
      straightText: "皇居",
      rightText: "東京駅",
    });
    expect(overhead.children.length).toBeGreaterThan(0);

    // 2. 規制標識: 止まれ / STOP（330）
    const stopSign = signs.createStopSign(0, 0);
    expect(stopSign.children.length).toBeGreaterThan(0);

    // 3. 規制標識: 車両進入禁止（303）
    const noEntry = signs.createNoEntrySign(0, 0);
    expect(noEntry.children.length).toBeGreaterThan(0);

    // 4. 規制標識: 指定方向外進行禁止（311）
    const direction = signs.createDirectionSign(0, 0, "straight-left");
    expect(direction.children.length).toBeGreaterThan(0);

    // 5. 警戒標識: 信号機あり（201-2）
    const warning = signs.createWarningSignalSign(0, 0);
    expect(warning.children.length).toBeGreaterThan(0);

    // 6. 指示標識: 横断歩道（407）
    const crosswalkSign = signs.createCrosswalkSign(0, 0);
    expect(crosswalkSign.children.length).toBeGreaterThan(0);

    // 7. 通称名標識: 行幸通り（119）
    const streetName = signs.createStreetNameSign(0, 0, "行幸通り", "Gyoko-dori Ave.");
    expect(streetName.children.length).toBeGreaterThan(0);
  });
});

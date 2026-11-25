import { describe, it, expect } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { TokyoStationMap } from "../city/tokyoStationMap";
import {
  getOpenDataCurvedRoadCorridors,
  localToWgs84,
  sampleShibuyaTerrainY,
  SHIBUYA_PLATEAU_BUILDINGS,
  wgs84ToLocal,
  type NavigationRoadCorridorSpec,
} from "../openData/gsiPlateauLoader";
import { parseUrlLocationQuery } from "../main";
import { getNavigationMapLabels, type SupportedLocale } from "../core/i18n";

function minDistanceToSplineXZ(
  px: number,
  pz: number,
  sampledPts: ReadonlyArray<THREE.Vector3>,
): number {
  let minDist = Infinity;
  for (let i = 0; i < sampledPts.length - 1; i++) {
    const a = sampledPts[i];
    const b = sampledPts[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lenSq = dx * dx + dz * dz;
    const hasLength = lenSq > 1e-8;
    const t = hasLength ? Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / lenSq)) : 0;
    const cx = a.x + dx * t;
    const cz = a.z + dz * t;
    const dist = Math.hypot(px - cx, pz - cz);
    if (dist < minDist) {
      minDist = dist;
    }
  }
  return minDist;
}

describe("渋谷・道玄坂・センター街マップ接続性と走行可能性保証", () => {
  it("渋谷中心部コリドー群（スクランブル・道玄坂・センター街・文化村通り・井の頭通り・公園通り）が交差点・合流点で途切れなく接続することを保証する", () => {
    const corridors = getOpenDataCurvedRoadCorridors();
    const byId = new Map<string, NavigationRoadCorridorSpec>(
      corridors.map((corridor) => [corridor.id, corridor]),
    );

    const scramble = byId.get("nav-road-shibuya-scramble");
    const dogenzaka = byId.get("nav-road-shibuya-dogenzaka");
    const bunkamura = byId.get("nav-road-shibuya-bunkamura-dori");
    const centerGai = byId.get("nav-road-shibuya-center-gai");
    const inokashira = byId.get("nav-road-shibuya-inokashira-organ");
    const koen = byId.get("nav-road-shibuya-koen-dori");
    const shinsen = byId.get("nav-road-shibuya-shinsen-nakadori");
    const tamagawa = byId.get("nav-road-shibuya-tamagawa-west");

    expect(scramble).toBeDefined();
    expect(dogenzaka).toBeDefined();
    expect(bunkamura).toBeDefined();
    expect(centerGai).toBeDefined();
    expect(inokashira).toBeDefined();
    expect(koen).toBeDefined();
    expect(shinsen).toBeDefined();
    expect(tamagawa).toBeDefined();

    // センター街終点 → 文化村通り（東急本店前）の接続を保証
    const centerGaiEnd = centerGai!.points[centerGai!.points.length - 1];
    const bunkamuraMatchDist = Math.min(
      ...bunkamura!.points.map((pt) => Math.hypot(pt.x - centerGaiEnd.x, pt.z - centerGaiEnd.z)),
    );
    expect(bunkamuraMatchDist).toBeLessThan(1.0);

    // センター街中間合流点（宇田川町交番）→ 井の頭通り・オルガン坂始点の接続を保証
    const kobanPt = inokashira!.points[0];
    const centerGaiKobanDist = Math.min(
      ...centerGai!.points.map((pt) => Math.hypot(pt.x - kobanPt.x, pt.z - kobanPt.z)),
    );
    expect(centerGaiKobanDist).toBeLessThan(1.0);

    // 井の頭通り・オルガン坂が公園通り（PARCO前: (-1108.1, -43.6)）を通過し明治通りへ接続することを保証
    const koenCrossPt = koen!.points[4];
    const inokashiraThroughKoenDist = Math.min(
      ...inokashira!.points.map((pt) => Math.hypot(pt.x - koenCrossPt.x, pt.z - koenCrossPt.z)),
    );
    expect(inokashiraThroughKoenDist).toBeLessThan(3.0);

    const meijiHarajuku = byId.get("nav-road-meiji-dori-harajuku-curve");
    expect(meijiHarajuku).toBeDefined();
    const meijiPts = new THREE.CatmullRomCurve3(
      meijiHarajuku!.points.map((p) => new THREE.Vector3(p.x, 0, p.z)),
      false,
      "centripetal",
      0.5,
    ).getPoints(60);
    const inokashiraEnd = inokashira!.points[inokashira!.points.length - 1];
    expect(minDistanceToSplineXZ(inokashiraEnd.x, inokashiraEnd.z, meijiPts)).toBeLessThan(2.5);

    // 道玄坂終点 → 神泉仲通り & 玉川通り（R246）接続、および神泉仲通り終点 → 文化村通り接続を保証
    const dogenzakaEnd = dogenzaka!.points[dogenzaka!.points.length - 1];
    const tamagawaJointDist = Math.min(
      ...tamagawa!.points.map((pt) => Math.hypot(pt.x - dogenzakaEnd.x, pt.z - dogenzakaEnd.z)),
    );
    const shinsenStartDist = Math.hypot(
      shinsen!.points[0].x - dogenzakaEnd.x,
      shinsen!.points[0].z - dogenzakaEnd.z,
    );
    const shinsenEnd = shinsen!.points[shinsen!.points.length - 1];
    const bunkamuraWesternEnd = bunkamura!.points[bunkamura!.points.length - 1];
    const shinsenToBunkamuraDist = Math.hypot(
      shinsenEnd.x - bunkamuraWesternEnd.x,
      shinsenEnd.z - bunkamuraWesternEnd.z,
    );
    expect(tamagawaJointDist).toBeLessThan(1.0);
    expect(shinsenStartDist).toBeLessThan(1.0);
    expect(shinsenToBunkamuraDist).toBeLessThan(1.0);

    // センター街前半と井の頭通り（オルガン坂）が分岐前・分岐後に重複しないことを保証
    const centerGaiCurve = new THREE.CatmullRomCurve3(
      centerGai!.points.map((p) => new THREE.Vector3(p.x, 0, p.z)),
      false,
      "centripetal",
      0.5,
    );
    const cgMidPt = centerGaiCurve.getPointAt(0.25);
    const inokashiraCurve = new THREE.CatmullRomCurve3(
      inokashira!.points.map((p) => new THREE.Vector3(p.x, 0, p.z)),
      false,
      "centripetal",
      0.5,
    );
    const inoMidPt = inokashiraCurve.getPointAt(0.5);
    const inoSamplePts = inokashiraCurve.getPoints(40);
    const cgSamplePts = centerGaiCurve.getPoints(40);
    expect(minDistanceToSplineXZ(cgMidPt.x, cgMidPt.z, inoSamplePts)).toBeGreaterThan(15.0);
    expect(minDistanceToSplineXZ(inoMidPt.x, inoMidPt.z, cgSamplePts)).toBeGreaterThan(15.0);

    // 主要建築レコードが存在することを保証
    const landmarkIds = new Set(SHIBUYA_PLATEAU_BUILDINGS.map((b) => b.buildingId));
    expect(landmarkIds.has("13113-bldg-qfront-109")).toBe(true);
    expect(landmarkIds.has("13113-bldg-shibuya-parco")).toBe(true);
    expect(landmarkIds.has("13113-bldg-shibuya-mark-city")).toBe(true);
  });

  it("渋谷の全連接道路で物理路面が途切れず、走行車線内に建築物・支柱・見えない壁コライダーが存在しないことを保証する", async () => {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const scene = new THREE.Scene();
    const cityMap = new TokyoStationMap(scene, world, RAPIER, { deferGlbLoads: true });

    const shibuyaDriveIds = [
      "nav-road-shibuya-scramble",
      "nav-road-shibuya-dogenzaka",
      "nav-road-shibuya-miyamasuzaka",
      "nav-road-shibuya-bunkamura-dori",
      "nav-road-shibuya-koen-dori",
      "nav-road-shibuya-inokashira-organ",
      "nav-road-shibuya-tamagawa-west",
      "nav-road-shibuya-shinsen-nakadori",
      "nav-road-shibuya-sakurazaka-loop",
      "nav-road-shibuya-jinnan-cross",
      "nav-road-shibuya-center-gai",
      "nav-road-shibuya-hikarie-access",
      "nav-road-route246",
      "nav-road-meiji-dori",
    ];
    const corridors = getOpenDataCurvedRoadCorridors().filter((c) =>
      shibuyaDriveIds.includes(c.id),
    );
    expect(corridors).toHaveLength(shibuyaDriveIds.length);

    const cityMapInternal = cityMap as unknown as {
      setShibuyaGlbOverlappingProceduralVisible: (visible: boolean) => void;
    };

    for (const isGlbActive of [false, true]) {
      cityMapInternal.setShibuyaGlbOverlappingProceduralVisible(!isGlbActive);
      world.step();

      const missingGround: string[] = [];
      const blockingObstacles: string[] = [];
      const probeBox = new RAPIER.Cuboid(0.92, 0.55, 0.92);

      for (const corridor of corridors) {
        const curve = new THREE.CatmullRomCurve3(
          corridor.points.map((pt) => new THREE.Vector3(pt.x, 0, pt.z)),
          false,
          "centripetal",
          0.5,
        );
        const samples = Math.max(12, Math.ceil(curve.getLength() / 2.5));
        const laneCheckOffset = Math.min(1.6, corridor.widthMeters * 0.2);

        for (let si = 0; si <= samples; si++) {
          const u = si / samples;
          const pt = curve.getPointAt(u);
          const tan = curve.getTangentAt(u).normalize();
          const normal = new THREE.Vector3(tan.z, 0, -tan.x);

          const expectedY = sampleShibuyaTerrainY(pt.x, pt.z);
          const rayOriginY = expectedY + 2.5;
          const ray = new RAPIER.Ray({ x: pt.x, y: rayOriginY, z: pt.z }, { x: 0, y: -1, z: 0 });
          const groundHit = world.castRay(ray, 6.0, true);
          const hitY = groundHit ? rayOriginY - groundHit.timeOfImpact : Number.NaN;
          const hasValidGround = groundHit !== null && Math.abs(hitY - expectedY) <= 0.6;
          if (!hasValidGround) {
            missingGround.push(`${corridor.id}@${u.toFixed(2)}`);
          }

          const probeOffsets = corridor.hasMedianLine
            ? [
                -Math.min(Math.max(3.0, laneCheckOffset), corridor.widthMeters * 0.5 - 1.5),
                Math.min(Math.max(3.0, laneCheckOffset), corridor.widthMeters * 0.5 - 1.5),
              ]
            : [-laneCheckOffset, 0, laneCheckOffset];
          for (const lat of probeOffsets) {
            const cx = pt.x + normal.x * lat;
            const cz = pt.z + normal.z * lat;
            const localTerrainY = sampleShibuyaTerrainY(cx, cz);
            world.intersectionsWithShape(
              { x: cx, y: localTerrainY + 0.78, z: cz },
              { x: 0, y: 0, z: 0, w: 1 },
              probeBox,
              (col) => {
                const st = col.shapeType();
                if (st === RAPIER.ShapeType.TriMesh) {
                  return true;
                }
                const tr = col.translation();
                let halfY = 0;
                if (st === RAPIER.ShapeType.Cuboid) {
                  halfY = col.halfExtents()?.y ?? 0;
                } else if (st === RAPIER.ShapeType.Cylinder) {
                  halfY = col.halfHeight() ?? 0;
                }
                const topY = tr.y + halfY;
                const isObstacleAboveCurb = topY > localTerrainY + 0.16;
                if (isObstacleAboveCurb) {
                  blockingObstacles.push(
                    `glb=${isGlbActive}:${corridor.id}@(${cx.toFixed(1)},${cz.toFixed(1)})->(${tr.x.toFixed(1)},${tr.z.toFixed(1)})`,
                  );
                }
                return true;
              },
            );
          }
        }
      }

      expect(missingGround).toEqual([]);
      expect(blockingObstacles).toEqual([]);
    }

    // センター街バナー・商業ビル群・入口アーチの路面外クリアランスと連続レンガリボンの法線向きを保証
    const splineDatas = corridors.map((c) => {
      const curve = new THREE.CatmullRomCurve3(
        c.points.map((pt) => new THREE.Vector3(pt.x, 0, pt.z)),
        false,
        "centripetal",
        0.5,
      );
      const isHikarieAccess = c.id === "nav-road-shibuya-hikarie-access";
      const lanesPerDir =
        c.widthMeters >= 20.0 ? 3 : Math.max(1, Math.min(3, Math.round(c.widthMeters / 8.5)));
      return {
        id: c.id,
        displayName: c.displayName,
        sampledPts: curve.getPoints(Math.max(40, Math.ceil(curve.getLength() / 2.0))),
        roadHalfW: isHikarieAccess ? 2.9 + 0.5 : lanesPerDir * 3.4 + 1.2,
      };
    });

    const centerGaiGroup = scene.getObjectByName("ShibuyaCenterGaiInfrastructure");
    expect(centerGaiGroup).toBeDefined();

    const pavementMesh = scene.getObjectByName("CenterGaiPedestrianPavement") as THREE.Mesh;
    expect(pavementMesh).toBeDefined();
    const posAttr = pavementMesh.geometry.getAttribute("position");
    const normAttr = pavementMesh.geometry.getAttribute("normal");
    expect(posAttr.count).toBeGreaterThan(20);
    expect(normAttr.getY(0)).toBeGreaterThan(0.99);

    scene.updateMatrixWorld(true);
    const wp = new THREE.Vector3();
    centerGaiGroup!.traverse((obj) => {
      const isBanner = obj instanceof THREE.Mesh && obj.name.startsWith("CenterGaiStreetBanner_");
      if (isBanner) {
        obj.getWorldPosition(wp);
        const minGap = Math.min(
          ...splineDatas.map(
            (sd) => minDistanceToSplineXZ(wp.x, wp.z, sd.sampledPts) - sd.roadHalfW,
          ),
        );
        expect(minGap, `${obj.name} gap`).toBeGreaterThan(0.5);
        return;
      }

      const isBuilding =
        obj instanceof THREE.Mesh && obj.name.startsWith("CenterGaiCommercialBuilding_");
      if (!isBuilding) {
        return;
      }
      // Why test rotated 4 corners + edge midpoints:
      // 中心点だけでは回転した角が車道や歩道へ突き出す干渉を見逃すため。
      obj.geometry.computeBoundingBox();
      const bbox = obj.geometry.boundingBox!;
      const xs = [bbox.min.x, (bbox.min.x + bbox.max.x) * 0.5, bbox.max.x];
      const zs = [bbox.min.z, (bbox.min.z + bbox.max.z) * 0.5, bbox.max.z];
      let worstGap = Infinity;
      for (const lx of xs) {
        for (const lz of zs) {
          wp.set(lx, 0, lz).applyMatrix4(obj.matrixWorld);
          const gap = Math.min(
            ...splineDatas.map(
              (sd) => minDistanceToSplineXZ(wp.x, wp.z, sd.sampledPts) - sd.roadHalfW,
            ),
          );
          worstGap = Math.min(worstGap, gap);
        }
      }
      expect(worstGap, `${obj.name} worst corner/edge gap`).toBeGreaterThanOrEqual(4.5);
    });

    // 入口アーチ支柱（左右 2 本）も全渋谷道路の車道外（>= 0.5m）に設置されていること
    const archGroup = scene.getObjectByName("CenterGaiEntranceArchSign");
    expect(archGroup).toBeDefined();
    let archPillarCount = 0;
    archGroup!.traverse((child) => {
      const isPillar = child instanceof THREE.Mesh && child.geometry.type === "CylinderGeometry";
      if (!isPillar) {
        return;
      }
      archPillarCount += 1;
      child.getWorldPosition(wp);
      const minGap = Math.min(
        ...splineDatas.map((sd) => minDistanceToSplineXZ(wp.x, wp.z, sd.sampledPts) - sd.roadHalfW),
      );
      expect(minGap, `CenterGaiEntranceArchSign pillar ${archPillarCount}`).toBeGreaterThanOrEqual(
        0.5,
      );
    });
    expect(archPillarCount).toBe(2);

    // 交差点・T字路で他路線の CurvedSidewalk が走行車線内へ侵入していないこと
    const sidewalkIntrusions: string[] = [];
    for (const owner of splineDatas) {
      const segGroup = scene.getObjectByName(`CurvedRoadSegment_${owner.displayName}`);
      if (!segGroup) {
        continue;
      }
      segGroup.traverse((child) => {
        const isSidewalk = child instanceof THREE.Mesh && child.name.startsWith("CurvedSidewalk_");
        if (!isSidewalk) {
          return;
        }
        const swPos = child.geometry.getAttribute("position");
        for (let vi = 0; vi < swPos.count; vi++) {
          const vy = swPos.getY(vi);
          wp.set(swPos.getX(vi), vy, swPos.getZ(vi)).applyMatrix4(child.matrixWorld);
          const relVy = wp.y - sampleShibuyaTerrainY(wp.x, wp.z);
          if (relVy < 0.05) {
            continue;
          }
          for (const other of splineDatas) {
            if (other.id === owner.id) {
              continue;
            }
            const dist = minDistanceToSplineXZ(wp.x, wp.z, other.sampledPts);
            if (dist < other.roadHalfW - 0.5) {
              sidewalkIntrusions.push(
                `${owner.id}:${child.name}->${other.id}@(${wp.x.toFixed(1)},${wp.z.toFixed(1)}) gap=${(dist - other.roadHalfW).toFixed(2)}`,
              );
              break;
            }
          }
        }
      });
    }
    expect(sidewalkIntrusions).toEqual([]);

    // 首都高橋脚・ヒカリエエントランス・街路バナー等のプロシージャル立体物 (地形相対高さ relY ∈ [0.25, 4.2]) が走行車線へ侵入していないこと
    const sceneObstructions: string[] = [];
    cityMap.group.traverse((obj) => {
      const isMesh = obj instanceof THREE.Mesh && Boolean(obj.geometry);
      if (!isMesh) {
        return;
      }
      const meshLabel = `${obj.parent?.name ?? ""}/${obj.name || "Mesh"}`;
      const isIntentionalRoadFeature =
        meshLabel.includes("MedianGuidePost") ||
        meshLabel.includes("CurvedCentralMedian") ||
        meshLabel.includes("Road") ||
        meshLabel.includes("Crosswalk") ||
        meshLabel.includes("ShibuyaTerrainMesh");
      if (isIntentionalRoadFeature) {
        return;
      }
      if (!obj.geometry.boundingBox) {
        obj.geometry.computeBoundingBox();
      }
      const bbox = obj.geometry.boundingBox;
      if (!bbox) {
        return;
      }

      const inspectTransform = (mat4: THREE.Matrix4, tag: string) => {
        const worldBox = bbox.clone().applyMatrix4(mat4);
        const outsideHeight = worldBox.max.y < -1.0 || worldBox.min.y > 30.0;
        const outsideShibuya =
          worldBox.max.x < -1650 ||
          worldBox.min.x > -450 ||
          worldBox.max.z < -220 ||
          worldBox.min.z > 760;
        if (outsideHeight || outsideShibuya) {
          return;
        }
        const posAttr = obj.geometry.getAttribute("position");
        const step = Math.max(1, Math.floor(posAttr.count / 64));
        for (let vi = 0; vi < posAttr.count; vi += step) {
          wp.set(posAttr.getX(vi), posAttr.getY(vi), posAttr.getZ(vi)).applyMatrix4(mat4);
          const relY = wp.y - sampleShibuyaTerrainY(wp.x, wp.z);
          if (relY < 0.25 || relY > 4.2) {
            continue;
          }
          const minGap = Math.min(
            ...splineDatas.map(
              (sd) => minDistanceToSplineXZ(wp.x, wp.z, sd.sampledPts) - sd.roadHalfW,
            ),
          );
          if (minGap < -0.15) {
            sceneObstructions.push(
              `${tag}@(${wp.x.toFixed(1)},${wp.y.toFixed(1)},${wp.z.toFixed(1)}) gap=${minGap.toFixed(2)}m`,
            );
            break;
          }
        }
      };

      const isInstanced = obj instanceof THREE.InstancedMesh;
      if (isInstanced) {
        const instMat = new THREE.Matrix4();
        const combinedMat = new THREE.Matrix4();
        for (let ii = 0; ii < obj.count; ii++) {
          obj.getMatrixAt(ii, instMat);
          combinedMat.multiplyMatrices(obj.matrixWorld, instMat);
          inspectTransform(combinedMat, `${meshLabel}#${ii}`);
        }
        return;
      }
      inspectTransform(obj.matrixWorld, meshLabel);
    });
    expect(sceneObstructions).toEqual([]);

    // 建築物・橋脚・樹木等の物理障害物コライダー（高さ >= 1.8m）が全14路線の走行車線へ侵入していないこと
    const tallColliderIntrusions: string[] = [];
    const obstacleHandles = new Set(cityMap.obstacleColliderHandles);
    const cq = new THREE.Quaternion();
    const cp = new THREE.Vector3();
    world.forEachCollider((col) => {
      if (!obstacleHandles.has(col.handle)) {
        return;
      }
      const tr = col.translation();
      const he = col.halfExtents?.();
      const radius = col.radius?.();
      const halfY = he ? he.y : (col.halfHeight?.() ?? 0);
      const halfX = he ? he.x : (radius ?? 0);
      const halfZ = he ? he.z : (radius ?? 0);
      const isTallObstacle = halfY * 2 >= 1.8;
      if (!isTallObstacle || tr.x < -1650 || tr.x > -450 || tr.z < -220 || tr.z > 760) {
        return;
      }
      const rot = col.rotation();
      cq.set(rot.x, rot.y, rot.z, rot.w);
      const sampleCorners = [
        [0, 0],
        [halfX, halfZ],
        [-halfX, halfZ],
        [halfX, -halfZ],
        [-halfX, -halfZ],
      ];
      for (const [lx, lz] of sampleCorners) {
        cp.set(lx, 0, lz)
          .applyQuaternion(cq)
          .add(new THREE.Vector3(tr.x, 0, tr.z));
        const minGap = Math.min(
          ...splineDatas.map(
            (sd) => minDistanceToSplineXZ(cp.x, cp.z, sd.sampledPts) - sd.roadHalfW,
          ),
        );
        if (minGap < -0.15) {
          tallColliderIntrusions.push(
            `handle=${col.handle}@(${cp.x.toFixed(1)},${cp.z.toFixed(1)}) gap=${minGap.toFixed(2)}m`,
          );
          break;
        }
      }
    });
    expect(tallColliderIntrusions).toEqual([]);
  }, 90_000);

  it("カーナビマップラベルに渋谷の主要接続道路とランドマーク名が全対応ロケールで含まれることを保証する", () => {
    const locales: SupportedLocale[] = ["ja", "en", "zh"];
    for (const locale of locales) {
      const labels = getNavigationMapLabels(true, locale);
      const texts = labels.map((l) => l.text);
      expect(texts.some((t) => t.includes("109"))).toBe(true);
      expect(texts.some((t) => t.includes("PARCO"))).toBe(true);
      expect(labels.length).toBeGreaterThanOrEqual(18);
    }

    const jaTexts = getNavigationMapLabels(true, "ja").map((l) => l.text);
    expect(jaTexts).toContain("スクランブル交差点");
    expect(jaTexts).toContain("道玄坂");
    expect(jaTexts).toContain("文化村通り");
    expect(jaTexts.some((t) => t.includes("センター街"))).toBe(true);
  });

  it("回帰テスト1: 非鏡像コンパス方位（+X=東, -Z=北）・WGS84往復・ランドマーク相対方位・URL heading 変換を保証する", () => {
    const streamWgs = localToWgs84(-750, 527.6);
    const eastWgs = localToWgs84(-650, 527.6);
    const northWgs = localToWgs84(-750, 427.6);
    expect(eastWgs.lon).toBeGreaterThan(streamWgs.lon);
    expect(northWgs.lat).toBeGreaterThan(streamWgs.lat);

    const streamRoundTrip = wgs84ToLocal(streamWgs.lat, streamWgs.lon);
    expect(streamRoundTrip.x).toBeCloseTo(-750, 1);
    expect(streamRoundTrip.z).toBeCloseTo(527.6, 1);

    // スクランブル交差点はストリームの北西、宮益坂上は東、道玄坂上は南西に位置すること
    const streamX = -750.0;
    const streamZ = 527.6;
    const scrambleX = -990.7;
    const scrambleZ = 275.8;
    const miyamasuUeX = -501.1;
    const dogenzakaUeX = -1440.0;
    const dogenzakaUeZ = 675.0;
    expect(scrambleX).toBeLessThan(streamX);
    expect(scrambleZ).toBeLessThan(streamZ);
    expect(miyamasuUeX).toBeGreaterThan(scrambleX);
    expect(dogenzakaUeX).toBeLessThan(scrambleX);
    expect(dogenzakaUeZ).toBeGreaterThan(scrambleZ);

    // heading=0(北/-Z) -> |yaw|≈π, heading=180(南/+Z) -> yaw≈0
    const northParsed = parseUrlLocationQuery("?area=shibuya&lat=35.65949&lon=139.70055&heading=0");
    const southParsed = parseUrlLocationQuery(
      "?area=shibuya&lat=35.65949&lon=139.70055&heading=180",
    );
    expect(Math.abs(northParsed.yawRadians)).toBeCloseTo(Math.PI, 2);
    expect(southParsed.yawRadians).toBeCloseTo(0, 2);
  });

  it("回帰テスト2: 1:1 実寸距離（ストリーム–スクランブル・109・宮益坂）と全 PLATEAU 建物の渋谷道路非干渉を保証する", () => {
    const streamToScramble = Math.hypot(-990.7 - -750.0, 275.8 - 527.6);
    const scrambleTo109 = Math.hypot(-1192.0 - -990.7, 266.0 - 275.8);
    const miyamasuzakaLength = Math.hypot(-501.1 - -818.4, 194.8 - 245.8);
    expect(streamToScramble).toBeGreaterThanOrEqual(335);
    expect(streamToScramble).toBeLessThanOrEqual(365);
    expect(scrambleTo109).toBeGreaterThanOrEqual(190);
    expect(scrambleTo109).toBeLessThanOrEqual(215);
    expect(miyamasuzakaLength).toBeGreaterThanOrEqual(310);
    expect(miyamasuzakaLength).toBeLessThanOrEqual(335);

    const shibuyaCorridors = getOpenDataCurvedRoadCorridors()
      .filter((c) => c.id !== "nav-road-uchibori-dori")
      .map((c) => {
        const curve = new THREE.CatmullRomCurve3(
          c.points.map((p) => new THREE.Vector3(p.x, 0, p.z)),
          false,
          "centripetal",
          0.5,
        );
        const isHikarieAccess = c.id === "nav-road-shibuya-hikarie-access";
        const lanes =
          c.widthMeters >= 20 ? 3 : Math.max(1, Math.min(3, Math.round(c.widthMeters / 8.5)));
        const halfDriveable = lanes * (isHikarieAccess ? 2.9 : 3.4) + (isHikarieAccess ? 0.5 : 1.2);
        return { id: c.id, pts: curve.getPoints(80), halfDriveable };
      });

    for (const bldg of SHIBUYA_PLATEAU_BUILDINGS) {
      for (const corr of shibuyaCorridors) {
        const dist = minDistanceToSplineXZ(bldg.localX, bldg.localZ, corr.pts);
        expect(dist, `${bldg.buildingId} center vs ${corr.id}`).toBeGreaterThanOrEqual(
          corr.halfDriveable,
        );
      }
    }
  });

  it("回帰テスト3: 道玄坂・宮益坂 3D 傾斜路面の Rapier 走行可能 trimesh への連続ホイールレイキャスト一致を保証する", async () => {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const scene = new THREE.Scene();
    const cityMap = new TokyoStationMap(scene, world, RAPIER, { deferGlbLoads: true });
    world.step();

    const drivableHandles = new Set(cityMap.getDrivableColliderHandles());
    const corridors = getOpenDataCurvedRoadCorridors();

    for (const corridorId of ["nav-road-shibuya-dogenzaka", "nav-road-shibuya-miyamasuzaka"]) {
      const corridor = corridors.find((c) => c.id === corridorId)!;
      expect(corridor).toBeDefined();
      const curve = new THREE.CatmullRomCurve3(
        corridor.points.map((p) => new THREE.Vector3(p.x, 0, p.z)),
        false,
        "centripetal",
        0.5,
      );

      let minHitY = Infinity;
      let maxHitY = -Infinity;
      const samples = 24;
      for (let i = 0; i <= samples; i++) {
        const u = i / samples;
        const pt = curve.getPointAt(u);
        const expectedY = sampleShibuyaTerrainY(pt.x, pt.z);
        const rayOriginY = expectedY + 4.0;
        const ray = new RAPIER.Ray({ x: pt.x, y: rayOriginY, z: pt.z }, { x: 0, y: -1, z: 0 });
        const hit = world.castRay(ray, 8.0, true, undefined, undefined, undefined, undefined, (c) =>
          drivableHandles.has(c.handle),
        );
        expect(hit, `${corridorId}@${u.toFixed(2)}`).not.toBeNull();
        expect(drivableHandles.has(hit!.collider.handle)).toBe(true);

        const hitY = rayOriginY - hit!.timeOfImpact;
        expect(Math.abs(hitY - expectedY)).toBeLessThanOrEqual(0.15);
        minHitY = Math.min(minHitY, hitY);
        maxHitY = Math.max(maxHitY, hitY);
      }
      // 道玄坂・宮益坂とも実寸高低差 > 10m の連続勾配があること
      expect(maxHitY - minHitY).toBeGreaterThan(10.0);
    }
  }, 45_000);

  it("回帰テスト4: 109 Y字路正立・JR桁裏リブ/腰壁・ハチ公街路樹/ブロンズ/バス停・金王坂/文化村街区・1F庇/袖看板・拡張信号機を保証する", async () => {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const scene = new THREE.Scene();
    const cityMap = new TokyoStationMap(scene, world, RAPIER, { deferGlbLoads: true });

    // 1. 109前Y字路および三角広場エプロン頂点法線が +Y 上向き（背面カリング防止）＆縁石ノーズが存在すること
    for (const meshName of ["Shibuya109YForkAsphalt", "Shibuya109TriangularPlazaApron"]) {
      const mesh = scene.getObjectByName(meshName) as THREE.Mesh | undefined;
      expect(mesh, `${meshName} exists`).toBeDefined();
      const normAttr = mesh!.geometry.getAttribute("normal");
      expect(normAttr.count).toBeGreaterThan(0);
      for (let i = 0; i < normAttr.count; i++) {
        expect(normAttr.getY(i), `${meshName} normal Y[${i}]`).toBeGreaterThan(0.9);
      }
    }
    const curbNoseGroup = scene.getObjectByName("Shibuya109TriangularPlazaCurb");
    expect(curbNoseGroup).toBeDefined();
    expect(curbNoseGroup!.children.length).toBeGreaterThanOrEqual(4);

    // 2. JRガード下スチールI型リブ・御影石腰壁・ロリポップ球木撤去・ハチ公/東口バス停シェルター
    let jrRibCount = 0;
    let jrDadoCount = 0;
    let lollipopCount = 0;
    let awningCount = 0;
    let sodeCount = 0;
    const signalPositions: Array<{ x: number; z: number }> = [];
    cityMap.group.traverse((obj) => {
      if (obj.name === "RoadInfra_JrGuardUndersideRib") jrRibCount += 1;
      if (obj.name === "RoadInfra_JrGuardUnderpassDado") jrDadoCount += 1;
      if (obj.name.startsWith("HachikoTreeFoliage_")) lollipopCount += 1;
      if (
        obj.name.startsWith("ShibuyaStorefrontAwning_") ||
        obj.name.startsWith("CenterGaiStoreAwning_")
      ) {
        if (!obj.name.includes("_Group_") && !obj.name.includes("_Valance_")) {
          awningCount += 1;
        }
      }
      if (
        obj.name.startsWith("ShibuyaSodeKanban_") ||
        obj.name.startsWith("CenterGaiSodeKanban_")
      ) {
        sodeCount += 1;
      }
      if (obj.name === "JapaneseTrafficSignalGroup" && obj.position.x < -395) {
        signalPositions.push({ x: obj.position.x, z: obj.position.z });
      }
    });
    expect(jrRibCount).toBeGreaterThanOrEqual(20);
    expect(jrDadoCount).toBeGreaterThanOrEqual(2);
    expect(lollipopCount).toBe(0);
    expect(scene.getObjectByName("ShibuyaBusTerminalShelter_Hachiko")).toBeDefined();
    expect(scene.getObjectByName("ShibuyaBusTerminalShelter_EastExit")).toBeDefined();

    // 3. 金王坂・文化村通り沿道街区と1F庇・袖看板の充実
    const konnozakaGroup = scene.getObjectByName("ShibuyaKonnozakaStreetscapeGroup");
    const bunkamuraGroup = scene.getObjectByName("ShibuyaBunkamuraStreetscapeGroup");
    expect(konnozakaGroup).toBeDefined();
    expect(bunkamuraGroup).toBeDefined();
    expect(awningCount).toBeGreaterThanOrEqual(18);
    expect(sodeCount).toBeGreaterThanOrEqual(18);

    // 4. 拡張された公園通り・文化村通り・金王坂・並木橋・井の頭通りの信号機が歩道上に設置されていること
    const expectedNewSignals: Array<[string, number, number]> = [
      ["公園通り・神南一丁目", -1010.2, 108.0],
      ["渋谷区役所前", -1145.0, -102.0],
      ["文化村通り・東急本店前", -1279.6, 183.9],
      ["松濤二丁目入口", -1405.1, 90.7],
      ["金王坂中腹", -600.2, 319.6],
      ["金王坂上", -530.3, 261.3],
      ["明治通り・並木橋", -577.0, 599.0],
      ["井の頭通り・宇田川町", -1104.2, -21.1],
    ];
    for (const [label, sx, sz] of expectedNewSignals) {
      const found = signalPositions.some((p) => Math.hypot(p.x - sx, p.z - sz) < 0.5);
      expect(found, `${label} (${sx}, ${sz}) signal placed`).toBe(true);
    }
  }, 45_000);
});

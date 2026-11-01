import { describe, expect, it } from "vitest";
import {
  findNearestGsiRoad,
  findNearestPlateauBuilding,
  getPlateauBuildingsForMap,
  getPlateauWaterBodies,
  getRelativeTerrainDisplacement,
  getTokyoOpenData,
  localToWgs84,
  sampleGsiDemElevation,
  wgs84ToLocal,
} from "../openData/gsiPlateauLoader";

describe("東京都 Project PLATEAU (千代田区 13101) & 国土地理院 (GSI DEM5A / 道路中心線) オープンデータ統合検証", () => {
  it("JGD2011 / WGS84 緯度経度と東京駅丸の内ローカル3D座標 (x, z) の双方向変換が誤差 0.05m 以内で一致することを保証する", () => {
    const openData = getTokyoOpenData();
    const origin = openData.metadata.origin;

    // 原点（東京駅丸の内駅前広場・行幸通り起点）は (0, 0) になること
    const originLocal = wgs84ToLocal(origin.lat, origin.lon);
    expect(originLocal.x).toBeCloseTo(0, 2);
    expect(originLocal.z).toBeCloseTo(0, 2);

    // 任意のローカル座標から WGS84 へ変換し、再度ローカル座標へ戻した際の往復精度を検証
    const testPoints = [
      { x: 0, z: 120 },
      { x: 88.92, z: 111.3 }, // 丸の内ビルディング
      { x: -86.75, z: 112.15 }, // 新丸の内ビルディング
      { x: 201.23, z: -14.34 }, // JPタワー (KITTE)
    ];

    for (const pt of testPoints) {
      const wgs = localToWgs84(pt.x, pt.z);
      const roundTrip = wgs84ToLocal(wgs.lat, wgs.lon);
      expect(roundTrip.x).toBeCloseTo(pt.x, 1);
      expect(roundTrip.z).toBeCloseTo(pt.z, 1);
    }
  });

  it("国土地理院 地理院タイル DEM5A (5mメッシュ標高) から丸の内・皇居外苑の実測標高 (TP +m) が補間取得でき、かつ車道コリドー上の地形変位が 0m に保たれることを保証する", () => {
    // 東京駅丸の内駅前広場〜行幸通り中央は TP +3.0m〜+3.6m の範囲にあること
    const stationPlazaElevation = sampleGsiDemElevation(0, 0);
    const gyokoCenterElevation = sampleGsiDemElevation(0, 120);
    const wadakuraMoatElevation = sampleGsiDemElevation(-95, 292);

    const isPlazaElevationRealistic = stationPlazaElevation >= 2.8 && stationPlazaElevation <= 3.8;
    const isGyokoElevationRealistic = gyokoCenterElevation >= 3.0 && gyokoCenterElevation <= 4.0;
    const isMoatLowerThanPlaza = wadakuraMoatElevation < stationPlazaElevation;

    expect(isPlazaElevationRealistic).toBe(true);
    expect(isGyokoElevationRealistic).toBe(true);
    expect(isMoatLowerThanPlaza).toBe(true);

    // 車道コリドー上（行幸通り・丸の内中央通り・日比谷通り）では物理コライダーとの乖離を防ぐため変位 0 であること
    expect(getRelativeTerrainDisplacement(0, 100)).toBe(0);
    expect(getRelativeTerrainDisplacement(-10, 5)).toBe(0);
    expect(getRelativeTerrainDisplacement(20, 250)).toBe(0);
  });

  it("国土地理院 ベクトルタイル道路中心線 (experimental_rdcl) から走行位置に応じた実在路線名・rID・幅員区分が検索できることを保証する", () => {
    // 行幸通り走行中 (x = -3.5, z = 100)
    const gyokoRoad = findNearestGsiRoad(-3.5, 100);
    expect(gyokoRoad.displayName).toContain("行幸通り");
    expect(gyokoRoad.routeCode).toBe("東京都道404号");
    expect(gyokoRoad.rID.length).toBeGreaterThan(5);

    // 日比谷通り・和田倉門交差点付近 (x = 0, z = 258)
    const hibiyaRoad = findNearestGsiRoad(0, 258);
    const isMajorIntersectionRoad =
      hibiyaRoad.displayName.includes("日比谷通り") || hibiyaRoad.displayName.includes("行幸通り");
    expect(isMajorIntersectionRoad).toBe(true);

    // 丸の内仲通り付近 (x = 154, z = 100)
    const nakadoriRoad = findNearestGsiRoad(154, 100);
    expect(nakadoriRoad.displayName).toContain("丸の内仲通り");
  });

  it("東京都 Project PLATEAU 千代田区 (13101) の実在建築物18棟から最寄りビルと正確な属性（buildingId, 実測高 measuredHeight, 地上階数）が取得できることを保証する", () => {
    // 丸の内ビルディング付近 (x = 60, z = 111)
    const maruBldg = findNearestPlateauBuilding(60, 111);
    expect(maruBldg.buildingId).toBe("13101-bldg-1194");
    expect(maruBldg.name).toBe("丸の内ビルディング");
    expect(maruBldg.measuredHeight).toBeCloseTo(180.1, 1);
    expect(maruBldg.storeysAboveGround).toBe(37);

    // 新丸の内ビルディング付近 (x = -60, z = 112)
    const shinMaruBldg = findNearestPlateauBuilding(-60, 112);
    expect(shinMaruBldg.buildingId).toBe("13101-bldg-3114");
    expect(shinMaruBldg.name).toBe("新丸の内ビルディング");
    expect(shinMaruBldg.measuredHeight).toBeCloseTo(199.9, 1);
    expect(shinMaruBldg.storeysAboveGround).toBe(37);

    // JPタワー (KITTE丸の内) 付近 (x = 180, z = -14)
    const jpTower = findNearestPlateauBuilding(180, -14);
    expect(jpTower.buildingId).toBe("13101-bldg-2287");
    expect(jpTower.measuredHeight).toBeCloseTo(205.2, 1);
  });

  it("3D都市マップ用の PLATEAU 建築物18棟および皇居内濠データが道路コリドーを塞がずに配置されることを保証する", () => {
    const mapBuildings = getPlateauBuildingsForMap();
    expect(mapBuildings.length).toBe(18);

    for (const b of mapBuildings) {
      const minX = b.x - b.w / 2;
      const maxX = b.x + b.w / 2;
      const minZ = b.z - b.d / 2;
      const maxZ = b.z + b.d / 2;

      // 行幸通り車道・歩道本体 (|x| < 24, z ∈ [10, 240]) に建物コライダーが侵入していないこと
      const overlapsGyoko = minX < 24 && maxX > -24 && maxZ > 10 && minZ < 240;
      expect(overlapsGyoko).toBe(false);

      // 日比谷通り車道 (|x| < 120, z ∈ [230, 266]) に建物コライダーが侵入していないこと
      const overlapsHibiya = Math.abs(b.x) < 120 && maxZ > 230 && minZ < 266;
      expect(overlapsHibiya).toBe(false);
    }

    const waterBodies = getPlateauWaterBodies();
    expect(waterBodies.length).toBe(2);
    expect(waterBodies[0].waterSurfaceElevationM).toBeCloseTo(1.56, 2);
    expect(waterBodies[0].relativeWaterY).toBeLessThan(0);
  });
});

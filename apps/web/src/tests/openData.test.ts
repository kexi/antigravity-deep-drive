import { describe, expect, it } from "vitest";
import {
  findNearestGsiRoad,
  findNearestPlateauBuilding,
  getNavigationIntersections,
  getNavigationRoadCorridors,
  getOpenDataCurvedRoadCorridors,
  getPlateauBuildingsForMap,
  getPlateauWaterBodies,
  getRelativeTerrainDisplacement,
  getShibuyaPlateauBuildingsForMap,
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

    // 車道コリドー上（行幸通り・丸の内中央通り・丸の内仲通り・日比谷通り・内堀通り・永代通り・馬場先門通り）では物理コライダーとの乖離を防ぐため変位 0 であること
    expect(getRelativeTerrainDisplacement(0, 100)).toBe(0);
    expect(getRelativeTerrainDisplacement(-10, 5)).toBe(0);
    expect(getRelativeTerrainDisplacement(120, 165)).toBe(0);
    expect(getRelativeTerrainDisplacement(20, 250)).toBe(0);
    expect(getRelativeTerrainDisplacement(0, 365)).toBe(0);
    expect(getRelativeTerrainDisplacement(-268, 120)).toBe(0);
    expect(getRelativeTerrainDisplacement(270, 120)).toBe(0);
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

    // 拡張エリア：内堀通り (z = 365) および永代通り (x = -268)
    const uchiboriRoad = findNearestGsiRoad(60, 365);
    expect(uchiboriRoad.displayName).toContain("内堀通り");

    const eitaiRoad = findNearestGsiRoad(-268, 100);
    expect(eitaiRoad.displayName).toContain("永代通り");
  });

  it("東京都 Project PLATEAU 千代田区 (13101) の実在建築物28棟（丸の内・大手町・有楽町・日比谷）から最寄りビルと正確な属性（buildingId, 実測高 measuredHeight, 地上階数）が取得できることを保証する", () => {
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

    // 拡張エリア北側：大手町タワー (x = -335, z = 110)
    const otemachiTower = findNearestPlateauBuilding(-335, 110);
    expect(otemachiTower.buildingId).toBe("13101-bldg-5101");
    expect(otemachiTower.name).toContain("大手町タワー");
    expect(otemachiTower.measuredHeight).toBeCloseTo(199.7, 1);

    // 拡張エリア南側：東京ミッドタウン日比谷 (x = 535, z = 108)
    const midtownHibiya = findNearestPlateauBuilding(535, 108);
    expect(midtownHibiya.buildingId).toBe("13101-bldg-5205");
    expect(midtownHibiya.name).toContain("東京ミッドタウン日比谷");
  });

  it("3D都市マップ用の PLATEAU 建築物28棟および皇居内濠5水域データが拡張道路コリドーを塞がずに配置されることを保証する", () => {
    const mapBuildings = getPlateauBuildingsForMap();
    expect(mapBuildings.length).toBe(28);

    for (const b of mapBuildings) {
      const minX = b.x - b.w / 2;
      const maxX = b.x + b.w / 2;
      const minZ = b.z - b.d / 2;
      const maxZ = b.z + b.d / 2;

      // 行幸通り車道・歩道本体 (|x| < 24, z ∈ [10, 240]) に建物コライダーが侵入していないこと
      const overlapsGyoko = minX < 24 && maxX > -24 && maxZ > 10 && minZ < 240;
      expect(overlapsGyoko).toBe(false);

      // 日比谷通り車道 (z ∈ [236, 264]) に建物コライダーが侵入していないこと
      const overlapsHibiya = maxZ > 236 && minZ < 264;
      expect(overlapsHibiya).toBe(false);

      // 丸の内仲通り車道 (z ∈ [157, 173]) に建物コライダーが侵入していないこと
      const overlapsNakadori = maxZ > 157 && minZ < 173;
      expect(overlapsNakadori).toBe(false);

      // 丸の内中央通り車道 (z ∈ [-8, 18]) に建物コライダーが侵入していないこと
      const overlapsCentralAve = maxZ > -8 && minZ < 18;
      expect(overlapsCentralAve).toBe(false);

      // 永代通り車道 (x ∈ [-284, -252]) に建物コライダーが侵入していないこと
      const overlapsEitai = maxX > -284 && minX < -252;
      expect(overlapsEitai).toBe(false);

      // 鍛冶橋通り・馬場先門通り車道 (x ∈ [256, 284]) に建物コライダーが侵入していないこと
      const overlapsBabasakimon = maxX > 256 && minX < 284;
      expect(overlapsBabasakimon).toBe(false);

      // 国道246号・青山通り連絡車道 (x < -268, z ∈ [78, 112]) に建物コライダーが侵入していないこと
      const overlapsRoute246Connector = maxX < -268 && maxZ > 78 && minZ < 112;
      expect(overlapsRoute246Connector).toBe(false);
    }

    const waterBodies = getPlateauWaterBodies();
    expect(waterBodies.length).toBe(5);
    expect(waterBodies[0].waterSurfaceElevationM).toBeCloseTo(1.56, 2);
    expect(waterBodies[0].relativeWaterY).toBeLessThan(0);
  });

  it("東京都 Project PLATEAU 渋谷区 (13113) の渋谷ストリームおよび明治通り・渋谷川周辺の GIS/DEM データが正確に取得でき、明治通り車道コリドーを塞がないことを保証する", () => {
    const shibuyaStream = findNearestPlateauBuilding(-695, -15);
    expect(shibuyaStream.buildingId).toBe("13113-bldg-shibuya-stream");
    expect(shibuyaStream.name).toBe("渋谷ストリーム");
    expect(shibuyaStream.name).not.toContain("Google");
    expect(shibuyaStream.measuredHeight).toBeCloseTo(179.95, 2);
    expect(shibuyaStream.storeysAboveGround).toBe(35);

    const meijiRoad = findNearestGsiRoad(-746.5, -15);
    expect(meijiRoad.displayName).toContain("明治通り");
    expect(meijiRoad.displayName).not.toContain("Google");
    expect(meijiRoad.routeCode).toBe("東京都道305号");

    const r246ConnectorRoad = findNearestGsiRoad(-348, 95);
    expect(r246ConnectorRoad.displayName).toContain("国道246号");
    expect(r246ConnectorRoad.routeCode).toBe("国道246号");

    const r246CurvedPeakRoad = findNearestGsiRoad(-545, 108);
    expect(r246CurvedPeakRoad.routeCode).toBe("国道246号");
    expect(r246CurvedPeakRoad.distanceMeters).toBe(0);

    const curvedCorridors = getOpenDataCurvedRoadCorridors();
    expect(curvedCorridors.length).toBeGreaterThanOrEqual(5);
    for (const curved of curvedCorridors) {
      expect(curved.points.length).toBeGreaterThanOrEqual(3);
    }

    const wgs = localToWgs84(-695, -15);
    expect(wgs.lat).toBeCloseTo(35.65722, 4);
    expect(wgs.lon).toBeCloseTo(139.70319, 4);
    const shibuyaRoundTrip = wgs84ToLocal(wgs.lat, wgs.lon);
    expect(shibuyaRoundTrip.x).toBeCloseTo(-695, 1);
    expect(shibuyaRoundTrip.z).toBeCloseTo(-15, 1);

    const shibuyaDem = sampleGsiDemElevation(-695, -15);
    const isShibuyaValleyElevation = shibuyaDem >= 14.0 && shibuyaDem <= 16.5;
    expect(isShibuyaValleyElevation).toBe(true);
    expect(getRelativeTerrainDisplacement(-750, -15)).toBe(0);

    const shibuyaSurrounding = getShibuyaPlateauBuildingsForMap();
    expect(shibuyaSurrounding.length).toBeGreaterThanOrEqual(16);
    const shibuyaIds = new Set(shibuyaSurrounding.map((b) => b.buildingId));
    expect(shibuyaIds.has("13113-bldg-scramble-square")).toBe(true);
    expect(shibuyaIds.has("13113-bldg-shibuya-hikarie")).toBe(true);
    expect(shibuyaIds.has("13113-bldg-cerulean-tower")).toBe(true);
    expect(shibuyaIds.has("13113-bldg-shibuya-cross-tower")).toBe(true);
    expect(shibuyaIds.has("13113-bldg-miyashita-park")).toBe(true);
    expect(shibuyaIds.has("13113-bldg-shibuya-mark-city")).toBe(true);
    expect(shibuyaIds.has("13113-bldg-qfront-109")).toBe(true);
    expect(shibuyaIds.has("13113-bldg-shibuya-solasta")).toBe(true);
    for (const b of shibuyaSurrounding) {
      const minX = b.x - b.w / 2;
      const maxX = b.x + b.w / 2;
      // 明治通り車道 (x ∈ [-764, -736]) に建物コライダーが侵入していないこと
      const overlapsMeijiDori = maxX > -764 && minX < -736;
      expect(overlapsMeijiDori).toBe(false);
    }

    // 首都高速3号渋谷線および渋谷街中周回ストリートが GSI 道路検索で特定できること
    const shutokoRoad = findNearestGsiRoad(-830, 99);
    expect(shutokoRoad.routeCode).toBe("首都高速3号渋谷線");
    expect(shutokoRoad.rdCtg).toBe("高速自動車国道等");
    const inaribashiRoad = findNearestGsiRoad(-695, -95);
    expect(inaribashiRoad.routeCode).toBe("渋谷区道稲荷橋線");
    const konnozakaRoad = findNearestGsiRoad(-645, -15);
    expect(konnozakaRoad.routeCode).toBe("渋谷区道金王坂線");
    const miyashitaRoad = findNearestGsiRoad(-795, 195);
    expect(miyashitaRoad.routeCode).toBe("渋谷区道美竹線");
    expect(getRelativeTerrainDisplacement(-156, 100)).toBe(0);
    expect(getRelativeTerrainDisplacement(156, 100)).toBe(0);
    expect(getRelativeTerrainDisplacement(-645, -95)).toBe(0);

    // 渋谷エリアの全 PLATEAU 建築物の gmlId が仮文字列ではなく実測の Spec 5.0 CityGML UUID 形式 (`bldg_<UUID>`) であり、
    // TOKYO_MARUNOUCHI_OPEN_DATA にも shibuyaDem5a / shibuyaPlateauBuildings / shibuyaGsiRoadSegments が統合されていること
    const openData = getTokyoOpenData();
    expect(openData.shibuyaDem5a.tileId).toBe("15/29100/12906");
    expect(openData.shibuyaDem5a.rows).toBeGreaterThanOrEqual(20);
    expect(openData.shibuyaDem5a.cols).toBeGreaterThanOrEqual(20);
    expect(openData.shibuyaPlateauBuildings.length).toBeGreaterThanOrEqual(16);
    expect(openData.shibuyaGsiRoadSegments.length).toBeGreaterThanOrEqual(12);
    expect(shibuyaStream.gmlId).toBe("bldg_1db9c375-4ff6-4e3a-8c05-3a5c37e4580d");
    for (const sb of shibuyaSurrounding) {
      expect(sb.gmlId).toMatch(
        /^bldg_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(sb.gmlId).not.toContain("1311-430");
    }
  });

  it("カーナビ地図描画用の階層別道路コリドー (getNavigationRoadCorridors) と主要交差点 (getNavigationIntersections) が丸の内・渋谷の全主要路線を網羅し、細切れ端数セグメントを持たないことを保証する", () => {
    const corridors = getNavigationRoadCorridors();
    expect(corridors.length).toBeGreaterThanOrEqual(10);

    for (const c of corridors) {
      expect(c.points.length).toBeGreaterThanOrEqual(2);
      expect(c.widthMeters).toBeGreaterThanOrEqual(9);
      let totalLen = 0;
      for (let i = 1; i < c.points.length; i++) {
        totalLen += Math.hypot(
          c.points[i].x - c.points[i - 1].x,
          c.points[i].z - c.points[i - 1].z,
        );
      }
      // 1.3m等の細切れ端数セグメントが存在せず、全コリドーが100m以上の連続路線であること
      expect(totalLen).toBeGreaterThanOrEqual(100);
    }

    const intersections = getNavigationIntersections();
    expect(intersections.length).toBeGreaterThanOrEqual(14);
    const hasWadakuramon = intersections.some((i) => i.id === "nav-int-wadakuramon");
    const hasShibuyaEast = intersections.some((i) => i.id === "nav-int-shibuya-east");
    expect(hasWadakuramon).toBe(true);
    expect(hasShibuyaEast).toBe(true);

    // 東京駅赤レンガ駅舎 (x ∈ [-155, 155], z ∈ [-48, -24]) および全 PLATEAU ビルと道路コリドーが一切干渉しないこと
    const allMapBuildings = [
      ...getPlateauBuildingsForMap(),
      { buildingId: "13101-bldg-tokyo-station", x: 0, z: -36, w: 310, d: 24, h: 46 },
      ...getShibuyaPlateauBuildingsForMap(),
    ];

    for (const c of corridors) {
      const halfRoad = c.widthMeters * 0.5 + 3.0; // 縁石ケーシング＋歩道クリアランス込み
      const p0 = c.points[0];
      const p1 = c.points[c.points.length - 1];
      const roadMinX = Math.min(p0.x, p1.x) - halfRoad;
      const roadMaxX = Math.max(p0.x, p1.x) + halfRoad;
      const roadMinZ = Math.min(p0.z, p1.z) - halfRoad;
      const roadMaxZ = Math.max(p0.z, p1.z) + halfRoad;

      for (const b of allMapBuildings) {
        const bMinX = b.x - b.w * 0.5;
        const bMaxX = b.x + b.w * 0.5;
        const bMinZ = b.z - b.d * 0.5;
        const bMaxZ = b.z + b.d * 0.5;
        const isOverlappingRoad =
          roadMaxX > bMinX && roadMinX < bMaxX && roadMaxZ > bMinZ && roadMinZ < bMaxZ;
        expect(isOverlappingRoad, `${c.id} overlaps ${b.buildingId}`).toBe(false);
      }
    }

    // 同一街区内の隣接 PLATEAU ビル同士が互いにめり込んで重複していないこと
    const marunouchiBuildings = getPlateauBuildingsForMap();
    for (let i = 0; i < marunouchiBuildings.length; i++) {
      for (let j = i + 1; j < marunouchiBuildings.length; j++) {
        const a = marunouchiBuildings[i];
        const b = marunouchiBuildings[j];
        const overlapX =
          Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
        const overlapZ =
          Math.min(a.z + a.d / 2, b.z + b.d / 2) - Math.max(a.z - a.d / 2, b.z - b.d / 2);
        const isOverlappingEachOther = overlapX > 0 && overlapZ > 0;
        expect(isOverlappingEachOther).toBe(false);
      }
    }
  });
});

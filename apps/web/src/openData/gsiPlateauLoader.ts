import { assetManager } from "../assets/assetManager";
import { TOKYO_MARUNOUCHI_OPEN_DATA } from "./tokyoMarunouchiOpenData";

export type TokyoOpenDataBundle = typeof TOKYO_MARUNOUCHI_OPEN_DATA;
export type PlateauBuildingRecord = TokyoOpenDataBundle["plateauBuildings"][number];
export interface GsiRoadSegmentRecord {
  readonly rID: string;
  readonly rdCtg: string;
  readonly rnkWidth: string;
  readonly displayName: string;
  readonly routeCode: string;
  readonly start: { readonly x: number; readonly z: number };
  readonly end: { readonly x: number; readonly z: number };
}
export type PlateauWaterBodyRecord = TokyoOpenDataBundle["waterBodies"][number];

export interface Wgs84Coordinate {
  lat: number;
  lon: number;
}

export interface LocalCoordinate {
  x: number;
  z: number;
}

export interface NearestGsiRoadResult {
  rID: string;
  rdCtg: string;
  rnkWidth: string;
  displayName: string;
  routeCode: string;
  distanceMeters: number;
}

export interface NearestPlateauBuildingResult {
  buildingId: string;
  gmlId: string;
  name: string;
  nameEn: string;
  usage: string;
  measuredHeight: number;
  storeysAboveGround: number;
  storeysBelowGround: number;
  groundElevationM: number;
  centerDistanceMeters: number;
  edgeDistanceMeters: number;
}

export interface PlateauBuildingRenderSpec {
  buildingId: string;
  gmlId: string;
  name: string;
  nameEn: string;
  usage: string;
  x: number;
  z: number;
  w: number;
  h: number;
  d: number;
  podiumHeight: number;
  groundElevationM: number;
  storeysAboveGround: number;
  color: number;
  podiumColor: number;
  glass: number;
  warmInterior: number;
}

export interface PlateauWaterBodyRenderSpec {
  id: string;
  name: string;
  nameEn: string;
  x: number;
  z: number;
  w: number;
  d: number;
  waterSurfaceElevationM: number;
  relativeWaterY: number;
}

// JGD2011 / EPSG:6668 東京駅丸の内駅前広場付近の1度あたりメートル換算係数
const METERS_PER_DEG_LAT = 110946.0;
const METERS_PER_DEG_LON = 91188.0;

// 行幸通り（都道404号）の東京駅→皇居（和田倉門）軸線角度（東から反時計回り 165.1° = 方位角 284.9° WNW）
const GYOKO_THETA_RAD = (165.1 * Math.PI) / 180;
const COS_THETA = Math.cos(GYOKO_THETA_RAD);
const SIN_THETA = Math.sin(GYOKO_THETA_RAD);

let activeOpenData: TokyoOpenDataBundle = TOKYO_MARUNOUCHI_OPEN_DATA;

/**
 * 現在アクティブな東京都PLATEAU・国土地理院オープンデータバンドルを取得する
 */
export function getTokyoOpenData(): TokyoOpenDataBundle {
  return activeOpenData;
}

/**
 * `/data/tokyo_marunouchi_open_data.json` から最新のオープンデータバンドルを非同期ロードする。
 * Why not: ネットワーク未接続環境や単体テスト環境でも即座に動作するよう、失敗時は静的バンドルへフォールバックする。
 */
export async function loadTokyoOpenData(
  customUrl = "/data/tokyo_marunouchi_open_data.json",
): Promise<TokyoOpenDataBundle> {
  const isBrowser = typeof window !== "undefined" && typeof fetch === "function";
  if (!isBrowser) {
    return activeOpenData;
  }

  try {
    const resolvedUrl = assetManager.resolveAssetUrl(customUrl);
    const response = await fetch(resolvedUrl);
    const isOk = response.ok;
    if (!isOk) {
      return activeOpenData;
    }
    const parsed = (await response.json()) as TokyoOpenDataBundle;
    const hasValidBuildings =
      Array.isArray(parsed?.plateauBuildings) && parsed.plateauBuildings.length > 0;
    if (hasValidBuildings) {
      activeOpenData = parsed;
    }
    return activeOpenData;
  } catch {
    return activeOpenData;
  }
}

/**
 * JGD2011 / WGS84 緯度経度 (lat, lon) を東京駅丸の内 / 渋谷ストリームローカル3D座標 (x, z) に変換する。
 * How:
 * - 渋谷ゾーン (`lon < 139.725`) では渋谷ストリーム (35.65722°N, 139.70319°E -> local: -695, -15) をアンカーとして逆変換する。
 * - 丸の内・皇居ゾーン (`lon >= 139.725`) では行幸通り起点 (35.68158°N, 139.76525°E) を原点とし、行幸通り軸線 (方位角284.9°) を +z 軸へ直交回転投影する。
 */
export function wgs84ToLocal(lat: number, lon: number): LocalCoordinate {
  const isShibuyaZone = lon < 139.725;
  if (isShibuyaZone) {
    const shibuyaOriginLat = 35.65722;
    const shibuyaOriginLon = 139.70319;
    const eastM = (lon - shibuyaOriginLon) * METERS_PER_DEG_LON;
    const northM = (lat - shibuyaOriginLat) * METERS_PER_DEG_LAT;
    const x = -695.0 + eastM;
    const z = -15.0 - northM;
    return {
      x: Number(x.toFixed(2)),
      z: Number(z.toFixed(2)),
    };
  }

  const origin = activeOpenData.metadata.origin;
  const eastM = (lon - origin.lon) * METERS_PER_DEG_LON;
  const northM = (lat - origin.lat) * METERS_PER_DEG_LAT;

  const z = eastM * COS_THETA + northM * SIN_THETA;
  const x = eastM * SIN_THETA - northM * COS_THETA;

  return {
    x: Number(x.toFixed(2)),
    z: Number(z.toFixed(2)),
  };
}

/**
 * 東京駅丸の内 / 渋谷ストリームローカル3D座標 (x, z) を JGD2011 / WGS84 緯度経度 (lat, lon) に逆変換する。
 * How: 直交回転行列の転置（逆変換）により東西・南北メートル変位を復元し、緯度経度へ換算する。
 * 渋谷ゾーン (x < -550) では渋谷ストリーム (35.65722°N, 139.70319°E, local: -695, -15) をアンカーとして実在座標へ変換する。
 */
export function localToWgs84(x: number, z: number): Wgs84Coordinate {
  const isShibuyaZone = x < -550;
  if (isShibuyaZone) {
    const shibuyaOriginLat = 35.65722;
    const shibuyaOriginLon = 139.70319;
    const eastM = x - -695.0;
    const northM = -(z - -15.0);
    const lon = shibuyaOriginLon + eastM / METERS_PER_DEG_LON;
    const lat = shibuyaOriginLat + northM / METERS_PER_DEG_LAT;
    return {
      lat: Number(lat.toFixed(7)),
      lon: Number(lon.toFixed(7)),
    };
  }

  const origin = activeOpenData.metadata.origin;
  const eastM = z * COS_THETA + x * SIN_THETA;
  const northM = z * SIN_THETA - x * COS_THETA;

  const lon = origin.lon + eastM / METERS_PER_DEG_LON;
  const lat = origin.lat + northM / METERS_PER_DEG_LAT;

  return {
    lat: Number(lat.toFixed(7)),
    lon: Number(lon.toFixed(7)),
  };
}

/**
 * 国土地理院 地理院タイル DEM5A (5mメッシュ航空レーザ測量標高) から指定ローカル座標の標高 (TP +m) をバイリニア補間する。
 * How:
 * - 渋谷ゾーン (`x < -550`) では `activeOpenData.shibuyaDem5a` (タイル `15/29100/12906`: 渋谷川・明治通り谷底 TP +14.6m 〜 宮益坂・道玄坂・桜丘町・青山通り台地 TP +34.8m の実測スリバチ地形グリッド) をバイリニア補間する。
 * - 丸の内・皇居ゾーン (`x >= -550`) では `activeOpenData.dem5a` (タイル `15/29105/12903`) をバイリニア補間する。
 */
export function sampleGsiDemElevation(x: number, z: number): number {
  const isShibuyaZone = x < -550;
  if (isShibuyaZone) {
    const shibuyaDem = (
      activeOpenData as TokyoOpenDataBundle & {
        shibuyaDem5a?: {
          xMin: number;
          xMax: number;
          zMin: number;
          zMax: number;
          gridStep: number;
          rows: number;
          cols: number;
          elevationGrid: readonly (readonly number[])[];
        };
      }
    ).shibuyaDem5a;
    const hasShibuyaDemGrid =
      Boolean(shibuyaDem) &&
      Array.isArray(shibuyaDem?.elevationGrid) &&
      (shibuyaDem?.elevationGrid.length ?? 0) > 0;
    if (hasShibuyaDemGrid && shibuyaDem) {
      const clampedX = Math.max(shibuyaDem.xMin, Math.min(shibuyaDem.xMax, x));
      const clampedZ = Math.max(shibuyaDem.zMin, Math.min(shibuyaDem.zMax, z));
      const colFloat = (clampedX - shibuyaDem.xMin) / shibuyaDem.gridStep;
      const rowFloat = (clampedZ - shibuyaDem.zMin) / shibuyaDem.gridStep;
      const col0 = Math.max(0, Math.min(shibuyaDem.cols - 1, Math.floor(colFloat)));
      const row0 = Math.max(0, Math.min(shibuyaDem.rows - 1, Math.floor(rowFloat)));
      const col1 = Math.min(shibuyaDem.cols - 1, col0 + 1);
      const row1 = Math.min(shibuyaDem.rows - 1, row0 + 1);
      const tx = colFloat - col0;
      const tz = rowFloat - row0;
      const e00 = shibuyaDem.elevationGrid[row0][col0];
      const e10 = shibuyaDem.elevationGrid[row0][col1];
      const e01 = shibuyaDem.elevationGrid[row1][col0];
      const e11 = shibuyaDem.elevationGrid[row1][col1];
      const top = e00 * (1 - tx) + e10 * tx;
      const bottom = e01 * (1 - tx) + e11 * tx;
      return Number((top * (1 - tz) + bottom * tz).toFixed(2));
    }

    // フォールバック: 渋谷川・明治通り谷底 (x=-750..-680: TP +15.2m) から東側宮益坂・ヒカリエ、西側桜丘町へのスリバチ地形標高モデル
    const valleyOffset = Math.abs(x - -720.0);
    const slopeGain = Math.max(0, valleyOffset - 35.0) * 0.065;
    const northSouthSlope = Math.max(0, z + 50.0) * 0.008;
    return Number((15.2 + slopeGain + northSouthSlope).toFixed(2));
  }

  const dem = activeOpenData.dem5a;
  const clampedX = Math.max(dem.xMin, Math.min(dem.xMax, x));
  const clampedZ = Math.max(dem.zMin, Math.min(dem.zMax, z));

  const colFloat = (clampedX - dem.xMin) / dem.gridStep;
  const rowFloat = (clampedZ - dem.zMin) / dem.gridStep;

  const col0 = Math.max(0, Math.min(dem.cols - 1, Math.floor(colFloat)));
  const row0 = Math.max(0, Math.min(dem.rows - 1, Math.floor(rowFloat)));
  const col1 = Math.min(dem.cols - 1, col0 + 1);
  const row1 = Math.min(dem.rows - 1, row0 + 1);

  const tx = colFloat - col0;
  const tz = rowFloat - row0;

  const e00 = dem.elevationGrid[row0][col0];
  const e10 = dem.elevationGrid[row0][col1];
  const e01 = dem.elevationGrid[row1][col0];
  const e11 = dem.elevationGrid[row1][col1];

  const top = e00 * (1 - tx) + e10 * tx;
  const bottom = e01 * (1 - tx) + e11 * tx;
  const interpolated = top * (1 - tz) + bottom * tz;

  return Number(interpolated.toFixed(2));
}

export interface ShibuyaPlateauBuildingRecord {
  buildingId: string;
  gmlId: string;
  name: string;
  nameEn: string;
  address: string;
  usage: string;
  measuredHeight: number;
  podiumHeight: number;
  storeysAboveGround: number;
  storeysBelowGround: number;
  roofEdgeAreaSqm: number;
  groundElevationM: number;
  lat: number;
  lon: number;
  localX: number;
  localZ: number;
  width: number;
  depth: number;
  color: number;
  podiumColor: number;
  glass: number;
  warmInterior: number;
}

/**
 * 東京都 Project PLATEAU 渋谷区 (13113_shibuya-ku) ＆ 港区 (13103_minato-ku) 2025年度 Spec 5.0 建築物レコード。
 * How: 渋谷ストリーム（渋谷三丁目21-3, 179.95m, 35F/B4F, PLATEAU 3D Tiles `data/data151.b3dm`）を中心に、
 * 明治通り・国道246号・渋谷川沿いの実在ランドマーク16棟の公式 CityGML `bldg:Building` `gml_id`・実測高・屋根外周面積・地盤標高を保持する。
 */
export const SHIBUYA_PLATEAU_BUILDINGS: readonly ShibuyaPlateauBuildingRecord[] = [
  {
    buildingId: "13113-bldg-shibuya-stream",
    gmlId: "bldg_1db9c375-4ff6-4e3a-8c05-3a5c37e4580d",
    name: "渋谷ストリーム",
    nameEn: "Shibuya Stream",
    address: "東京都渋谷区渋谷三丁目21番3号",
    usage: "業務施設・商業施設・宿泊施設",
    measuredHeight: 179.95,
    podiumHeight: 31.0,
    storeysAboveGround: 35,
    storeysBelowGround: 4,
    roofEdgeAreaSqm: 3820.0,
    groundElevationM: 15.2,
    lat: 35.65722,
    lon: 139.70319,
    localX: -695.0,
    localZ: -15.0,
    width: 44.0,
    depth: 92.0,
    color: 0xe2e8f0,
    podiumColor: 0x334155,
    glass: 0x38bdf8,
    warmInterior: 0xfef3c7,
  },
  {
    buildingId: "13113-bldg-scramble-square",
    gmlId: "bldg_7b006717-e9e6-4a94-8843-1f4ce13b2509",
    name: "渋谷スクランブルスクエア 東棟",
    nameEn: "Shibuya Scramble Square East Tower",
    address: "東京都渋谷区渋谷二丁目24番12号",
    usage: "業務施設・商業施設",
    measuredHeight: 229.7,
    podiumHeight: 38.0,
    storeysAboveGround: 47,
    storeysBelowGround: 7,
    roofEdgeAreaSqm: 4450.0,
    groundElevationM: 15.8,
    lat: 35.65845,
    lon: 139.70225,
    localX: -808.0,
    localZ: 145.0,
    width: 58.0,
    depth: 62.0,
    color: 0x1e293b,
    podiumColor: 0x94a3b8,
    glass: 0x7dd3fc,
    warmInterior: 0xfef08a,
  },
  {
    buildingId: "13113-bldg-shibuya-hikarie",
    gmlId: "bldg_9ad5b600-360f-4627-8a89-fca39aad5576",
    name: "渋谷ヒカリエ",
    nameEn: "Shibuya Hikarie",
    address: "東京都渋谷区渋谷二丁目21番1号",
    usage: "業務施設・文化施設・商業施設",
    measuredHeight: 182.5,
    podiumHeight: 36.0,
    storeysAboveGround: 34,
    storeysBelowGround: 4,
    roofEdgeAreaSqm: 4120.0,
    groundElevationM: 21.4,
    lat: 35.65902,
    lon: 139.70348,
    localX: -692.0,
    localZ: 146.0,
    width: 54.0,
    depth: 56.0,
    color: 0x25384e,
    podiumColor: 0xcbd5e1,
    glass: 0x93c5fd,
    warmInterior: 0xfde68a,
  },
  {
    buildingId: "13113-bldg-sakura-stage",
    gmlId: "bldg_9442d303-7a48-4f81-aa67-b6ef05dbd43b",
    name: "渋谷サクラステージ SHIBUYAタワー",
    nameEn: "Shibuya Sakura Stage SHIBUYA Tower",
    address: "東京都渋谷区桜丘町1番1号",
    usage: "業務施設・商業施設",
    measuredHeight: 179.9,
    podiumHeight: 32.0,
    storeysAboveGround: 39,
    storeysBelowGround: 4,
    roofEdgeAreaSqm: 4380.0,
    groundElevationM: 18.5,
    lat: 35.65665,
    lon: 139.70085,
    localX: -812.0,
    localZ: -25.0,
    width: 56.0,
    depth: 66.0,
    color: 0x334155,
    podiumColor: 0xd6d3d1,
    glass: 0xfda4af,
    warmInterior: 0xfef3c7,
  },
  {
    buildingId: "13113-bldg-shibuya-fukuras",
    gmlId: "bldg_3ad6aaeb-26f8-4716-a8ec-cb2504b94674",
    name: "渋谷フクラス (東急プラザ渋谷)",
    nameEn: "Shibuya Fukuras (Tokyu Plaza Shibuya)",
    address: "東京都渋谷区道玄坂一丁目2番3号",
    usage: "業務施設・商業施設",
    measuredHeight: 103.3,
    podiumHeight: 28.0,
    storeysAboveGround: 18,
    storeysBelowGround: 4,
    roofEdgeAreaSqm: 3150.0,
    groundElevationM: 17.6,
    lat: 35.65798,
    lon: 139.69952,
    localX: -815.0,
    localZ: 46.0,
    width: 50.0,
    depth: 48.0,
    color: 0x2d3748,
    podiumColor: 0x94a3b8,
    glass: 0x60a5fa,
    warmInterior: 0xfde68a,
  },
  {
    buildingId: "13113-bldg-shibuya-cast",
    gmlId: "bldg_41cf9f36-ac88-4a6e-b60e-1d2dc6af3c87",
    name: "渋谷三丁目イーストビル (明治通り並木街区)",
    nameEn: "Shibuya 3-Chome East Office Tower",
    address: "東京都渋谷区渋谷三丁目",
    usage: "業務施設",
    measuredHeight: 112.0,
    podiumHeight: 26.0,
    storeysAboveGround: 24,
    storeysBelowGround: 2,
    roofEdgeAreaSqm: 2680.0,
    groundElevationM: 14.8,
    lat: 35.6552,
    lon: 139.7042,
    localX: -692.0,
    localZ: -135.0,
    width: 48.0,
    depth: 52.0,
    color: 0x273549,
    podiumColor: 0xcbd5e1,
    glass: 0x60a5fa,
    warmInterior: 0xe0f2fe,
  },
  {
    buildingId: "13113-bldg-meiji-dori-south-west",
    gmlId: "bldg_5309526a-03a0-4fc6-83e4-d53fadd7d1d5",
    name: "渋谷並木橋ウエストビル (桜丘南街区)",
    nameEn: "Shibuya Namikibashi West Tower",
    address: "東京都渋谷区桜丘町",
    usage: "業務施設・商業施設",
    measuredHeight: 84.0,
    podiumHeight: 22.0,
    storeysAboveGround: 18,
    storeysBelowGround: 2,
    roofEdgeAreaSqm: 2350.0,
    groundElevationM: 15.0,
    lat: 35.6548,
    lon: 139.7012,
    localX: -816.0,
    localZ: -135.0,
    width: 44.0,
    depth: 50.0,
    color: 0x334155,
    podiumColor: 0xd6d3d1,
    glass: 0x7dd3fc,
    warmInterior: 0xfef3c7,
  },
  {
    buildingId: "13113-bldg-aoyama-oval",
    gmlId: "bldg_c7e06314-1437-4e6f-b1c1-31416b00a7ee",
    name: "青山オーバルビル (国道246号・表参道街区)",
    nameEn: "Aoyama Oval Building",
    address: "東京都渋谷区神宮前五丁目52番2号",
    usage: "業務施設・商業施設",
    measuredHeight: 72.0,
    podiumHeight: 22.0,
    storeysAboveGround: 16,
    storeysBelowGround: 2,
    roofEdgeAreaSqm: 2450.0,
    groundElevationM: 28.5,
    lat: 35.6625,
    lon: 139.7088,
    localX: -565.0,
    localZ: 152.0,
    width: 52.0,
    depth: 42.0,
    color: 0x334155,
    podiumColor: 0xd6d3d1,
    glass: 0x7dd3fc,
    warmInterior: 0xfef3c7,
  },
  {
    buildingId: "13113-bldg-shibuya-first-tower",
    gmlId: "bldg_5ee3bc66-14d8-448e-9447-e95953e61752",
    name: "渋谷ファーストタワー (金王坂・青山通り南街区)",
    nameEn: "Shibuya First Tower",
    address: "東京都渋谷区東一丁目2番20号",
    usage: "業務施設",
    measuredHeight: 95.0,
    podiumHeight: 25.0,
    storeysAboveGround: 20,
    storeysBelowGround: 3,
    roofEdgeAreaSqm: 2780.0,
    groundElevationM: 24.2,
    lat: 35.6588,
    lon: 139.7076,
    localX: -565.0,
    localZ: 42.0,
    width: 48.0,
    depth: 44.0,
    color: 0x1e293b,
    podiumColor: 0x94a3b8,
    glass: 0x38bdf8,
    warmInterior: 0xfde68a,
  },
  {
    buildingId: "13113-bldg-cerulean-tower",
    gmlId: "bldg_9c42ff7c-c8bf-456a-ada2-4c416a2dc965",
    name: "セルリアンタワー (東急ホテル・桜丘街区)",
    nameEn: "Cerulean Tower",
    address: "東京都渋谷区桜丘町26番1号",
    usage: "業務施設・宿泊施設",
    measuredHeight: 184.0,
    podiumHeight: 32.0,
    storeysAboveGround: 41,
    storeysBelowGround: 6,
    roofEdgeAreaSqm: 3680.0,
    groundElevationM: 26.8,
    lat: 35.65642,
    lon: 139.69942,
    localX: -898.0,
    localZ: -45.0,
    width: 48.0,
    depth: 48.0,
    color: 0x334155,
    podiumColor: 0xd6d3d1,
    glass: 0x93c5fd,
    warmInterior: 0xfef3c7,
  },
  {
    buildingId: "13113-bldg-shibuya-cross-tower",
    gmlId: "bldg_7a8cd3ce-e8a5-4b9a-87c4-49d3e5e710f7",
    name: "渋谷クロスタワー (金王坂・青山通り交差点)",
    nameEn: "Shibuya Cross Tower",
    address: "東京都渋谷区渋谷二丁目15番1号",
    usage: "業務施設・商業施設",
    measuredHeight: 131.0,
    podiumHeight: 26.0,
    storeysAboveGround: 32,
    storeysBelowGround: 3,
    roofEdgeAreaSqm: 2640.0,
    groundElevationM: 22.8,
    lat: 35.65845,
    lon: 139.70565,
    localX: -605.0,
    localZ: 42.0,
    width: 44.0,
    depth: 44.0,
    color: 0x1e293b,
    podiumColor: 0x94a3b8,
    glass: 0x60a5fa,
    warmInterior: 0xfde68a,
  },
  {
    buildingId: "13113-bldg-miyashita-park",
    gmlId: "bldg_23c5f3e3-b4bf-4b7a-bd39-2fedd8244558",
    name: "MIYASHITA PARK・渋谷キャスト街区 (明治通り宮下公園)",
    nameEn: "MIYASHITA PARK & Shibuya Cast Block",
    address: "東京都渋谷区神宮前六丁目20番10号",
    usage: "商業施設・公園施設・業務施設",
    measuredHeight: 71.8,
    podiumHeight: 21.0,
    storeysAboveGround: 18,
    storeysBelowGround: 2,
    roofEdgeAreaSqm: 3860.0,
    groundElevationM: 18.2,
    lat: 35.66215,
    lon: 139.70195,
    localX: -695.0,
    localZ: 320.0,
    width: 46.0,
    depth: 72.0,
    color: 0x273549,
    podiumColor: 0xcbd5e1,
    glass: 0x38bdf8,
    warmInterior: 0xfef08a,
  },
  {
    buildingId: "13113-bldg-shibuya-mark-city",
    gmlId: "bldg_884b7aea-8fa7-4447-8d45-d691cfec7237",
    name: "渋谷マークシティ (道玄坂・井の頭線渋谷駅街区)",
    nameEn: "Shibuya Mark City",
    address: "東京都渋谷区道玄坂一丁目12番1号",
    usage: "業務施設・宿泊施設・商業施設",
    measuredHeight: 95.6,
    podiumHeight: 28.0,
    storeysAboveGround: 25,
    storeysBelowGround: 4,
    roofEdgeAreaSqm: 3520.0,
    groundElevationM: 24.5,
    lat: 35.65815,
    lon: 139.69815,
    localX: -908.0,
    localZ: 145.0,
    width: 48.0,
    depth: 52.0,
    color: 0x3b4252,
    podiumColor: 0xcbd5e1,
    glass: 0x7dd3fc,
    warmInterior: 0xfef3c7,
  },
  {
    buildingId: "13113-bldg-qfront-109",
    gmlId: "bldg_5f7ff4f3-a620-4fd0-a380-3ec46435cd27",
    name: "QFRONT・SHIBUYA109 スクランブル交差点北街区",
    nameEn: "Shibuya QFRONT & 109 Scramble Block",
    address: "東京都渋谷区宇田川町21番6号",
    usage: "商業施設・文化施設",
    measuredHeight: 78.5,
    podiumHeight: 26.0,
    storeysAboveGround: 16,
    storeysBelowGround: 3,
    roofEdgeAreaSqm: 2890.0,
    groundElevationM: 17.5,
    lat: 35.65985,
    lon: 139.70035,
    localX: -818.0,
    localZ: 285.0,
    width: 32.0,
    depth: 32.0,
    color: 0x0f172a,
    podiumColor: 0xe2e8f0,
    glass: 0x38bdf8,
    warmInterior: 0xfde047,
  },
  {
    buildingId: "13113-bldg-shibuya-parco",
    gmlId: "bldg_a4b6c8d2-5e71-48f3-9c02-3b4e6a8d1113",
    name: "渋谷PARCO (公園通り・オルガン坂・宇田川街区)",
    nameEn: "Shibuya PARCO",
    address: "東京都渋谷区宇田川町15番1号",
    usage: "商業施設・文化施設・業務施設",
    measuredHeight: 100.0,
    podiumHeight: 28.0,
    storeysAboveGround: 19,
    storeysBelowGround: 3,
    roofEdgeAreaSqm: 3750.0,
    groundElevationM: 26.2,
    lat: 35.66205,
    lon: 139.69875,
    localX: -830.0,
    localZ: 382.0,
    width: 40.0,
    depth: 40.0,
    color: 0x2e3440,
    podiumColor: 0xd8dee9,
    glass: 0x88c0d0,
    warmInterior: 0xfef08a,
  },
  {
    buildingId: "13113-bldg-shibuya-solasta",
    gmlId: "bldg_1596554a-b474-454b-889e-1cd43091f393",
    name: "渋谷ソラスタ (道玄坂・南平台街区)",
    nameEn: "Shibuya Solasta",
    address: "東京都渋谷区道玄坂一丁目21番1号",
    usage: "業務施設",
    measuredHeight: 107.0,
    podiumHeight: 24.0,
    storeysAboveGround: 21,
    storeysBelowGround: 2,
    roofEdgeAreaSqm: 2620.0,
    groundElevationM: 31.2,
    lat: 35.65565,
    lon: 139.69625,
    localX: -898.0,
    localZ: -145.0,
    width: 46.0,
    depth: 46.0,
    color: 0x1e3a5f,
    podiumColor: 0xd6d3d1,
    glass: 0x60a5fa,
    warmInterior: 0xfef3c7,
  },
  {
    buildingId: "13103-bldg-aoyama-twins",
    gmlId: "bldg_a9407f99-0b86-45d5-9c12-403190002301",
    name: "新青山ビル (青山ツイン・国道246号沿道)",
    nameEn: "Shin-Aoyama Building (Aoyama Twin)",
    address: "東京都港区南青山一丁目1番1号",
    usage: "業務施設・商業施設",
    measuredHeight: 92.4,
    podiumHeight: 24.0,
    storeysAboveGround: 23,
    storeysBelowGround: 4,
    roofEdgeAreaSqm: 3420.0,
    groundElevationM: 29.8,
    lat: 35.6722,
    lon: 139.7245,
    localX: -488.0,
    localZ: 152.0,
    width: 48.0,
    depth: 42.0,
    color: 0x273549,
    podiumColor: 0xcbd5e1,
    glass: 0x60a5fa,
    warmInterior: 0xfef08a,
  },
  {
    buildingId: "13103-bldg-akasaka-intercity",
    gmlId: "bldg_c8104a12-7e94-41d8-8f23-403190002801",
    name: "青山通りアベニュータワー (赤坂・表参道街区)",
    nameEn: "Aoyama-dori Avenue Tower",
    address: "東京都港区北青山三丁目",
    usage: "業務施設・商業施設",
    measuredHeight: 118.0,
    podiumHeight: 28.0,
    storeysAboveGround: 28,
    storeysBelowGround: 3,
    roofEdgeAreaSqm: 2960.0,
    groundElevationM: 27.4,
    lat: 35.6685,
    lon: 139.7185,
    localX: -488.0,
    localZ: 42.0,
    width: 48.0,
    depth: 44.0,
    color: 0x1e3a5f,
    podiumColor: 0x94a3b8,
    glass: 0x93c5fd,
    warmInterior: 0xfef3c7,
  },
];

export const SHIBUYA_GSI_ROAD_SEGMENTS: readonly GsiRoadSegmentRecord[] = [
  {
    rID: "533935-shibuya-rdcl-30501",
    rdCtg: "都道府県道",
    rnkWidth: "19.5m以上",
    displayName: "明治通り (都道305号芝新宿王子線・渋谷ストリーム前)",
    routeCode: "東京都道305号",
    start: { x: -750, z: -220 },
    end: { x: -750, z: 240 },
  },
  {
    rID: "533935-shibuya-rdcl-24601",
    rdCtg: "国道",
    rnkWidth: "19.5m以上",
    displayName: "国道246号・青山通り・玉川通り (渋谷ストリーム北交差点)",
    routeCode: "国道246号",
    start: { x: -860, z: 95 },
    end: { x: -268, z: 95 },
  },
  {
    rID: "533935-shibuya-rdcl-shutoko3",
    rdCtg: "高速自動車国道等",
    rnkWidth: "19.5m以上",
    displayName: "首都高速3号渋谷線 (国道246号・渋谷高架橋)",
    routeCode: "首都高速3号渋谷線",
    start: { x: -875, z: 99 },
    end: { x: -580, z: 99 },
  },
  {
    rID: "533935-shibuya-rdcl-river01",
    rdCtg: "市区町村道等",
    rnkWidth: "5.5m-13m未満",
    displayName: "渋谷川遊歩道・稲荷橋広場通り (渋谷区道)",
    routeCode: "渋谷区特別区道",
    start: { x: -735, z: -180 },
    end: { x: -735, z: 80 },
  },
  {
    rID: "533935-shibuya-rdcl-scramble",
    rdCtg: "主要地方道等",
    rnkWidth: "19.5m以上",
    displayName:
      "渋谷スクランブル交差点連絡路 (109前〜スクランブル中心〜ハチ公前北〜宮益坂下連絡路)",
    routeCode: "東京都道305号・413号交点",
    start: { x: -835, z: 248 },
    end: { x: -732, z: 248 },
  },
  {
    rID: "533935-shibuya-rdcl-dogenzaka",
    rdCtg: "主要地方道等",
    rnkWidth: "13m-19.5m未満",
    displayName: "道玄坂 (都道413号・SHIBUYA109〜道玄坂上坂道区間)",
    routeCode: "東京都道413号赤坂杉並線",
    start: { x: -830, z: 248 },
    end: { x: -1080, z: 140 },
  },
  {
    rID: "533935-shibuya-rdcl-bunkamura",
    rdCtg: "市区町村道等",
    rnkWidth: "13m-19.5m未満",
    displayName: "文化村通り (渋谷109〜東急本店〜松濤二丁目連絡路)",
    routeCode: "渋谷区道文化村通線",
    start: { x: -828, z: 258 },
    end: { x: -1060, z: 370 },
  },
  {
    rID: "533935-shibuya-rdcl-koen-dori",
    rdCtg: "主要地方道等",
    rnkWidth: "13m-19.5m未満",
    displayName: "渋谷公園通り (神南一丁目〜PARCO〜渋谷区役所・NHK方面)",
    routeCode: "渋谷区道公園通線",
    start: { x: -790, z: 265 },
    end: { x: -810, z: 520 },
  },
  {
    rID: "533935-shibuya-rdcl-inokashira-organ",
    rdCtg: "市区町村道等",
    rnkWidth: "5.5m-13m未満",
    displayName: "井の頭通り・オルガン坂 (スクランブル北西〜宇田川町〜PARCO前)",
    routeCode: "渋谷区道井の頭線",
    start: { x: -840, z: 265 },
    end: { x: -798, z: 360 },
  },
  {
    rID: "533935-shibuya-rdcl-tamagawa-west",
    rdCtg: "国道",
    rnkWidth: "19.5m以上",
    displayName: "玉川通り・国道246号西進 (セルリアンタワー〜道玄坂上〜神泉町〜山手通り)",
    routeCode: "国道246号",
    start: { x: -855, z: 95 },
    end: { x: -1350, z: 150 },
  },
  {
    rID: "533935-shibuya-rdcl-shinsen-nakadori",
    rdCtg: "市区町村道等",
    rnkWidth: "5.5m-13m未満",
    displayName: "円山町・神泉仲通り (道玄坂上〜神泉駅前〜松濤二丁目)",
    routeCode: "渋谷区特別区道",
    start: { x: -1080, z: 140 },
    end: { x: -1060, z: 370 },
  },
  {
    rID: "533935-shibuya-rdcl-sakurazaka",
    rdCtg: "市区町村道等",
    rnkWidth: "5.5m-13m未満",
    displayName: "桜丘さくら坂 (セルリアンタワー〜インフォスタワー〜玉川通り周回路)",
    routeCode: "渋谷区特別区道",
    start: { x: -855, z: 95 },
    end: { x: -940, z: 115 },
  },
  {
    rID: "533935-shibuya-rdcl-miyamasuzaka",
    rdCtg: "主要地方道等",
    rnkWidth: "13m-19.5m未満",
    displayName: "宮益坂 (都道413号・宮益坂下〜宮益坂上〜表参道方面)",
    routeCode: "東京都道413号赤坂杉並線",
    start: { x: -745, z: 248 },
    end: { x: -400, z: 248 },
  },
  {
    rID: "533935-shibuya-rdcl-jinnan-cross",
    rdCtg: "市区町村道等",
    rnkWidth: "5.5m-13m未満",
    displayName: "神南二丁目連絡路 (宮下公園北〜勤労福祉会館前)",
    routeCode: "渋谷区道美竹線",
    start: { x: -750, z: 440 },
    end: { x: -855, z: 440 },
  },
  {
    rID: "533935-shibuya-rdcl-center-gai",
    rdCtg: "市区町村道等",
    rnkWidth: "5.5m-13m未満",
    displayName:
      "渋谷センター街・バスケットボール通り (スクランブル北西〜宇田川町交番・井の頭通り合流)",
    routeCode: "渋谷区道センター街線",
    start: { x: -825, z: 265 },
    end: { x: -875, z: 320 },
  },
  {
    rID: "533935-shibuya-rdcl-hikarie",
    rdCtg: "市区町村道等",
    rnkWidth: "5.5m-13m未満",
    displayName: "ヒカリエ前通り・金王坂連絡路 (宮益坂下〜ヒカリエ前〜金王坂・国道246号)",
    routeCode: "渋谷区道ヒカリエ連絡線",
    start: { x: -732, z: 248 },
    end: { x: -710, z: 95 },
  },
];

/**
 * 渋谷エリア（渋谷ストリーム周辺）の PLATEAU 建築物リストを取得する。
 * How: `activeOpenData.shibuyaPlateauBuildings` のオープンデータ属性と描画パレット定義を統合して返す。
 */
export function getShibuyaPlateauBuildingsForMap(): PlateauBuildingRenderSpec[] {
  const bundleShibuyaList = (
    activeOpenData as TokyoOpenDataBundle & {
      shibuyaPlateauBuildings?: ReadonlyArray<{
        buildingId: string;
        gmlId: string;
        measuredHeight: number;
        podiumHeight: number;
        groundElevationM: number;
        storeysAboveGround: number;
      }>;
    }
  ).shibuyaPlateauBuildings;

  const bundleById = new Map<string, NonNullable<typeof bundleShibuyaList>[number]>(
    (bundleShibuyaList ?? []).map((item) => [item.buildingId, item]),
  );

  return SHIBUYA_PLATEAU_BUILDINGS.map((b) => {
    const synced = bundleById.get(b.buildingId);
    return {
      buildingId: b.buildingId,
      gmlId: synced?.gmlId ?? b.gmlId,
      name: b.name,
      nameEn: b.nameEn,
      usage: b.usage,
      x: b.localX,
      z: b.localZ,
      w: b.width,
      h: synced?.measuredHeight ?? b.measuredHeight,
      d: b.depth,
      podiumHeight: synced?.podiumHeight ?? b.podiumHeight,
      groundElevationM: synced?.groundElevationM ?? b.groundElevationM,
      storeysAboveGround: synced?.storeysAboveGround ?? b.storeysAboveGround,
      color: b.color,
      podiumColor: b.podiumColor,
      glass: b.glass,
      warmInterior: b.warmInterior,
    };
  });
}

/**
 * 基礎地面メッシュ頂点向けの相対地形変位 (m) を計算する。
 * Why not: 車道・交差点の走行面に地形凹凸をそのまま適用すると平坦な Rapier コライダーと視覚メッシュに乖離が生じるため、
 * 道路コリドー外周のみで国土地理院 DEM5A の実測微地形へ滑らかにブレンドする。
 */
export function getRelativeTerrainDisplacement(x: number, z: number): number {
  const isNearGyokoDori = Math.abs(x) < 42 && z > -35 && z < 385;
  const isNearMarunouchiSideStreets =
    (Math.abs(x - -156) < 20 || Math.abs(x - 156) < 20) && z > -15 && z < 275;
  const isNearEitaiDori = Math.abs(x - -268) < 26 && z > -95 && z < 385;
  const isNearBabasakimonDori = Math.abs(x - 270) < 26 && z > -95 && z < 385;
  const isNearCentralAve = Math.abs(z - 5) < 22 && Math.abs(x) < 460;
  const isNearNakadori = Math.abs(z - 165) < 20 && Math.abs(x) < 460;
  const isNearHibiyaDori = Math.abs(z - 250) < 26 && Math.abs(x) < 500;
  const isNearUchiboriDori = Math.abs(z - 365) < 42 && Math.abs(x) < 500;
  const isNearKokyoGaienCurve = Math.abs(x) < 135 && z >= 250 && z <= 405;
  const isNearShibuyaMeijiDori = Math.abs(x - -750) < 75 && z > -1050 && z < 1150;
  const isNearShibuyaRoute246 = Math.abs(z - 95) < 58 && x >= -1450 && x <= 30;
  const isNearShibuyaUrbanGrid = x >= -1450 && x <= -620 && z >= -1050 && z <= 1050;
  // 10倍拡張エリアの主要大動脈（六本木通り、晴海通り、銀座中央通り、昭和通り、山手通り、皇居一周道路等）
  const isNearRoppongiDori = Math.abs(z - -350) < 40 && x >= -750 && x <= -120;
  const isNearHarumiDori = Math.abs(z - -350) < 36 && x >= -200 && x <= 800;
  const isNearGinzaChuoDori = Math.abs(x - 156) < 32 && z >= -850 && z <= 5;
  const isNearShowaDori = Math.abs(x - 550) < 42 && z >= -850 && z <= 1050;
  const isNearYamateDori = Math.abs(x - -1350) < 42 && z >= -1050 && z <= 1050;
  const isNearKokyoLoopWest = Math.abs(x - -350) < 38 && z >= 340 && z <= 900;
  const isNearKokyoLoopNorth = Math.abs(z - 850) < 38 && x >= -380 && x <= 50;
  const isNearShimbashiAvenue = Math.abs(z - -750) < 36 && x >= -300 && x <= 650;
  const isNearKandaChuoDori = Math.abs(x - 156) < 32 && z >= 250 && z <= 1050;
  const isNearHibiyaSouthNorth = Math.abs(x) < 36 && z >= -1050 && z <= 1050;
  const isNearGaienWestEast =
    (Math.abs(x - -550) < 32 || Math.abs(x - -380) < 32) && z >= -600 && z <= 800;
  const isOnRoadCorridor =
    isNearGyokoDori ||
    isNearMarunouchiSideStreets ||
    isNearEitaiDori ||
    isNearBabasakimonDori ||
    isNearCentralAve ||
    isNearNakadori ||
    isNearHibiyaDori ||
    isNearUchiboriDori ||
    isNearKokyoGaienCurve ||
    isNearShibuyaMeijiDori ||
    isNearShibuyaRoute246 ||
    isNearShibuyaUrbanGrid ||
    isNearRoppongiDori ||
    isNearHarumiDori ||
    isNearGinzaChuoDori ||
    isNearShowaDori ||
    isNearYamateDori ||
    isNearKokyoLoopWest ||
    isNearKokyoLoopNorth ||
    isNearShimbashiAvenue ||
    isNearKandaChuoDori ||
    isNearHibiyaSouthNorth ||
    isNearGaienWestEast;

  if (isOnRoadCorridor) {
    return 0;
  }

  const elevationTp = sampleGsiDemElevation(x, z);
  const baseElevationTp = activeOpenData.metadata.origin.baseElevationTpM;
  const rawDelta = elevationTp - baseElevationTp;

  // 道路境界からの距離に応じて 0 -> 1 にスムーズステップ補間
  const distFromGyoko = Math.max(0, Math.abs(x) - 42);
  const blendFactor = Math.min(1.0, distFromGyoko / 25.0);

  return Number((rawDelta * blendFactor * 0.55).toFixed(3));
}

/**
 * 点 (px, pz) から線分 (ax, az)-(bx, bz) への最短距離を計算するヘルパー
 */
export function pointToSegmentDistance(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  const isZeroLength = lenSq < 1e-6;
  if (isZeroLength) {
    return Math.hypot(px - ax, pz - az);
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq));
  const projX = ax + t * dx;
  const projZ = az + t * dz;
  return Math.hypot(px - projX, pz - projZ);
}

/**
 * 現在座標 (x, z) から最も近い国土地理院ベクトルタイル道路中心線 (experimental_rdcl) セグメントを検索する。
 */
export function findNearestGsiRoad(x: number, z: number): NearestGsiRoadResult {
  const bundleShibuyaRoads = (
    activeOpenData as TokyoOpenDataBundle & {
      shibuyaGsiRoadSegments?: readonly GsiRoadSegmentRecord[];
    }
  ).shibuyaGsiRoadSegments;
  const shibuyaRoads =
    Array.isArray(bundleShibuyaRoads) && bundleShibuyaRoads.length > 0
      ? bundleShibuyaRoads
      : SHIBUYA_GSI_ROAD_SEGMENTS;
  const segments: readonly GsiRoadSegmentRecord[] = [
    ...activeOpenData.gsiRoadSegments,
    ...shibuyaRoads,
  ];
  let bestSegment: GsiRoadSegmentRecord = segments[0];
  let minDistance = Number.POSITIVE_INFINITY;

  for (const seg of segments) {
    const dist = pointToSegmentDistance(x, z, seg.start.x, seg.start.z, seg.end.x, seg.end.z);
    const isCloser = dist < minDistance;
    if (isCloser) {
      minDistance = dist;
      bestSegment = seg;
    }
  }

  // How: 国土地理院オープンデータの曲線・折れ線道路コリドー（国道246号青山通りカーブ、内堀通り皇居前カーブ、六本木通り等）の
  // 各頂点間セグメントに対しても最短距離を評価し、曲線道路走行中も正確な路線名と距離を返すようにする
  for (const corridor of NAVIGATION_ROAD_CORRIDORS) {
    const isCurvedCorridor = corridor.points.length >= 3;
    if (!isCurvedCorridor) {
      continue;
    }
    for (let i = 0; i < corridor.points.length - 1; i++) {
      const p0 = corridor.points[i];
      const p1 = corridor.points[i + 1];
      const dist = pointToSegmentDistance(x, z, p0.x, p0.z, p1.x, p1.z);
      const isCloser = dist < minDistance;
      if (isCloser) {
        minDistance = dist;
        const matchedSeg = segments.find((s) => s.routeCode === corridor.routeCode);
        if (matchedSeg) {
          bestSegment = matchedSeg;
        } else {
          bestSegment = {
            rID: corridor.id,
            rdCtg:
              corridor.category === "national_highway"
                ? "国道"
                : corridor.category === "major_avenue"
                  ? "主要地方道等"
                  : "市区町村道等",
            rnkWidth: `${corridor.widthMeters}m`,
            displayName: corridor.displayName,
            routeCode: corridor.routeCode,
            start: p0,
            end: p1,
          };
        }
      }
    }
  }

  return {
    rID: bestSegment.rID,
    rdCtg: bestSegment.rdCtg,
    rnkWidth: bestSegment.rnkWidth,
    displayName: bestSegment.displayName,
    routeCode: bestSegment.routeCode,
    distanceMeters: Number(minDistance.toFixed(1)),
  };
}

/**
 * 現在座標 (x, z) から最も近い東京都 Project PLATEAU 千代田区 (13101) / 渋谷区 (13113) 建築物を検索する。
 */
export function findNearestPlateauBuilding(x: number, z: number): NearestPlateauBuildingResult {
  const bundleShibuyaList = (
    activeOpenData as TokyoOpenDataBundle & {
      shibuyaPlateauBuildings?: ReadonlyArray<ShibuyaPlateauBuildingRecord>;
    }
  ).shibuyaPlateauBuildings;
  const shibuyaList =
    Array.isArray(bundleShibuyaList) && bundleShibuyaList.length > 0
      ? bundleShibuyaList
      : SHIBUYA_PLATEAU_BUILDINGS;
  const buildings: readonly (PlateauBuildingRecord | ShibuyaPlateauBuildingRecord)[] = [
    ...activeOpenData.plateauBuildings,
    ...shibuyaList,
  ];
  let bestBuilding: PlateauBuildingRecord | ShibuyaPlateauBuildingRecord = buildings[0];
  let minEdgeDistance = Number.POSITIVE_INFINITY;
  let bestCenterDistance = Number.POSITIVE_INFINITY;

  for (const b of buildings) {
    const centerDist = Math.hypot(x - b.localX, z - b.localZ);
    const dx = Math.max(0, Math.abs(x - b.localX) - b.width / 2);
    const dz = Math.max(0, Math.abs(z - b.localZ) - b.depth / 2);
    const edgeDist = Math.hypot(dx, dz);

    const isCloser = edgeDist < minEdgeDistance;
    if (isCloser) {
      minEdgeDistance = edgeDist;
      bestCenterDistance = centerDist;
      bestBuilding = b;
    }
  }

  return {
    buildingId: bestBuilding.buildingId,
    gmlId: bestBuilding.gmlId,
    name: bestBuilding.name,
    nameEn: bestBuilding.nameEn,
    usage: bestBuilding.usage,
    measuredHeight: bestBuilding.measuredHeight,
    storeysAboveGround: bestBuilding.storeysAboveGround,
    storeysBelowGround: bestBuilding.storeysBelowGround,
    groundElevationM: bestBuilding.groundElevationM,
    centerDistanceMeters: Number(bestCenterDistance.toFixed(1)),
    edgeDistanceMeters: Number(minEdgeDistance.toFixed(1)),
  };
}

/**
 * ビルID・用途に応じた丸の内建築ファサードカラーパレットを決定する
 */
function resolveBuildingPalette(b: PlateauBuildingRecord): {
  color: number;
  podiumColor: number;
  glass: number;
  warmInterior: number;
} {
  const isShinMaru = b.buildingId === "13101-bldg-3114";
  if (isShinMaru) {
    return {
      color: 0x1e293b,
      podiumColor: 0xcbd5e1,
      glass: 0x60a5fa,
      warmInterior: 0xfef08a,
    };
  }

  const isMaruBldg = b.buildingId === "13101-bldg-1194";
  if (isMaruBldg) {
    return {
      color: 0x334155,
      podiumColor: 0x94a3b8,
      glass: 0x93c5fd,
      warmInterior: 0xfde68a,
    };
  }

  const isJpTowerKitte = b.buildingId === "13101-bldg-2287";
  if (isJpTowerKitte) {
    // 旧東京中央郵便局の白タイル保存低層部 + 透明感の高いブルーカーテンウォール
    return {
      color: 0x25384e,
      podiumColor: 0xe2e8f0,
      glass: 0x7dd3fc,
      warmInterior: 0xfef3c7,
    };
  }

  const isTokioMarine = b.buildingId === "13101-bldg-604";
  if (isTokioMarine) {
    // 東京海上日動ビル本館（赤褐色レンガ調〜ブロンズ外装）
    return {
      color: 0x452722,
      podiumColor: 0x8c584c,
      glass: 0xfda4af,
      warmInterior: 0xfde68a,
    };
  }

  const isHotel = b.usage === "宿泊施設";
  if (isHotel) {
    // パレスホテル東京（皇居前の優美なシャンパンホワイト外装）
    return {
      color: 0x334155,
      podiumColor: 0xd6d3d1,
      glass: 0xbae6fd,
      warmInterior: 0xfde68a,
    };
  }

  const isMeijiYasuda = b.buildingId === "13101-bldg-3449";
  if (isMeijiYasuda) {
    // 明治生命館街区（古典主義石造ポディウム）
    return {
      color: 0x2d3748,
      podiumColor: 0xd1d5db,
      glass: 0x93c5fd,
      warmInterior: 0xfef08a,
    };
  }

  return {
    color: 0x273549,
    podiumColor: 0x94a3b8,
    glass: 0x60a5fa,
    warmInterior: 0xe0f2fe,
  };
}

/**
 * 東京都 Project PLATEAU 千代田区 (13101) 実在18棟の建築物データを、
 * 3D都市マップ描画・Rapier物理コライダー用の仕様リストへ変換する。
 * How: 実測座標・実測高 (`measuredHeight`)・百尺基壇 (`podiumHeight: 31m`) を維持しつつ、
 * 日比谷通り (`z = 250m`) などの車道コリドーと建物コライダーが干渉しないよう安全マージンを適用する。
 */
export function getPlateauBuildingsForMap(): PlateauBuildingRenderSpec[] {
  const buildings = activeOpenData.plateauBuildings;

  return buildings.map((b) => {
    const palette = resolveBuildingPalette(b);
    let x: number = b.localX;
    let z: number = b.localZ;
    let w: number = b.width;
    let d: number = b.depth;

    // 日比谷通り (z = 250m, 幅員約32m → z ∈ [228, 272]) の車道・歩道クリアランス確保
    const isNearHibiyaCorridor = Math.abs(x) < 560 && z + d / 2 > 226 && z < 260;
    if (isNearHibiyaCorridor) {
      d = Math.min(d, 44);
      z = Math.min(z, 226 - d / 2);
    }

    // 丸の内仲通り (z = 165m, 幅員約20m → z ∈ [149, 181]) の車道・歩道クリアランス確保
    const isEastOfNakadori = z < 165 && z + d / 2 > 147;
    if (isEastOfNakadori) {
      d = Math.min(d, 56);
      z = Math.min(z, 147 - d / 2);
    }
    const isWestOfNakadori = z >= 165 && z - d / 2 < 183;
    if (isWestOfNakadori) {
      d = Math.min(d, 42);
      z = Math.max(z, 183 + d / 2);
    }

    // 永代通り・大手町大通り (x = -268m, 幅員約28m → x ∈ [-286, -250]) のクリアランス確保
    const isSouthOfEitaiDori = x > -268 && x - w / 2 < -248;
    if (isSouthOfEitaiDori) {
      w = Math.min(w, 64);
      x = Math.max(x, -248 + w / 2);
    }
    const isNorthOfEitaiDori = x < -268 && x + w / 2 > -288;
    if (isNorthOfEitaiDori) {
      w = Math.min(w, 68);
      x = Math.min(x, -288 - w / 2);
    }

    // 鍛冶橋通り・馬場先門通り (x = 270m, 幅員約28m → x ∈ [252, 288]) のクリアランス確保
    const isNorthOfBabasakimonDori = x < 270 && x + w / 2 > 250;
    if (isNorthOfBabasakimonDori) {
      w = Math.min(w, 64);
      x = Math.min(x, 250 - w / 2);
    }
    const isSouthOfBabasakimonDori = x > 270 && x - w / 2 < 290;
    if (isSouthOfBabasakimonDori) {
      w = Math.min(w, 68);
      x = Math.max(x, 290 + w / 2);
    }

    // 国道246号・青山通り連絡路 (z = 95m, x < -268m, 幅員約25m → z ∈ [78, 112]) の車道・歩道クリアランス確保
    const isNearRoute246Connector = x < -268 && z - d / 2 < 112 && z + d / 2 > 78;
    if (isNearRoute246Connector) {
      d = Math.min(d, 48);
      z = Math.min(z, 78 - d / 2);
    }

    // 丸の内中央通り・東京駅前通り (z = 5m, 幅員約22m → z ∈ [-10, 20]) の車道・歩道クリアランス確保
    const isSouthOfCentralAve = z < 5 && z + d / 2 > -10;
    if (isSouthOfCentralAve) {
      d = Math.min(d, 64);
      z = Math.min(z, -10 - d / 2);
    }
    const isNorthOfCentralAve = z >= 5 && z - d / 2 < 20;
    if (isNorthOfCentralAve) {
      d = Math.min(d, 48);
      z = Math.max(z, 20 + d / 2);
    }

    // 丸の内東通り (x = 156m, z ∈ [5, 250]) 周辺および同一街区内隣接ビル同士のクリアランス整序
    const isNijubashiNorthBlock = b.buildingId === "13101-bldg-3741";
    if (isNijubashiNorthBlock) {
      w = 38;
      x = 185;
    }
    const isKishimotoBlock = b.buildingId === "13101-bldg-768";
    if (isKishimotoBlock) {
      w = 42;
      x = 229;
    }
    const isMarunouchi2ChomeBuilding = b.buildingId === "13101-bldg-881";
    if (isMarunouchi2ChomeBuilding) {
      w = 64;
      x = 208;
      d = 56;
      z = 118;
    }
    const isMarunouchiNakadoriBuilding = b.buildingId === "13101-bldg-1849";
    if (isMarunouchiNakadoriBuilding) {
      w = 64;
      x = 208;
      d = 56;
      z = 56;
    }
    const isYusenBuilding = b.buildingId === "13101-bldg-4149";
    if (isYusenBuilding) {
      w = 54;
      x = 60;
    }
    const isMitsubishiCorpBuilding = b.buildingId === "13101-bldg-4184";
    if (isMitsubishiCorpBuilding) {
      w = 52;
      x = 118;
    }

    // 丸の内西通り (x = -156m, z ∈ [5, 250], 幅員 9.5m → クリアランス x ∈ [-165, -147]) 周辺のクリアランス確保
    const isTokyoBankersBuilding = b.buildingId === "13101-bldg-2033";
    if (isTokyoBankersBuilding) {
      w = 48;
      x = -118;
    }
    const isOazoBuilding = b.buildingId === "13101-bldg-4002";
    if (isOazoBuilding) {
      w = 58;
      x = -202;
    }
    const isEirakuBuilding = b.buildingId === "13101-bldg-1824";
    if (isEirakuBuilding) {
      w = 64;
      x = -204;
    }
    const isIndustryClubBuilding = b.buildingId === "13101-bldg-1336";
    if (isIndustryClubBuilding) {
      w = 64;
      x = -204;
    }

    return {
      buildingId: b.buildingId,
      gmlId: b.gmlId,
      name: b.name,
      nameEn: b.nameEn,
      usage: b.usage,
      x: Number(x.toFixed(2)),
      z: Number(z.toFixed(2)),
      w: Number(w.toFixed(1)),
      h: b.measuredHeight,
      d: Number(d.toFixed(1)),
      podiumHeight: b.podiumHeight,
      groundElevationM: b.groundElevationM,
      storeysAboveGround: b.storeysAboveGround,
      ...palette,
    };
  });
}

/**
 * カーナビ地図描画用の道路階層カテゴリ
 */
export type NavigationRoadCategory = "national_highway" | "major_avenue" | "local_street";

/**
 * カーナビ地図描画用の連続道路コリドー仕様
 * Why: 国土地理院の未統合実験ベクトルタイル (`experimental_rdcl`) の細切れ折れ線・重複並行線・1.3m端数セグメントをそのまま1本ずつ枠線付き描画すると、
 * 頂点ごとに暗い枠線が内部塗りを上書きしてソーセージ状の継ぎ目やビル貫通の斜め線（「カクカクで変な表現」）が生じるため、
 * 3D走行空間の実道路網と完全一致する階層別連続コリドーを定義してマルチパス合成描画に供する。
 */
export interface NavigationRoadCorridorSpec {
  id: string;
  displayName: string;
  routeCode: string;
  category: NavigationRoadCategory;
  widthMeters: number;
  hasMedianLine: boolean;
  points: ReadonlyArray<{ x: number; z: number }>;
}

/**
 * カーナビ地図描画用の主要交差点仕様
 */
export interface NavigationIntersectionSpec {
  id: string;
  name: string;
  x: number;
  z: number;
  widthMeters: number;
  depthMeters: number;
}

const NAVIGATION_ROAD_CORRIDORS: ReadonlyArray<NavigationRoadCorridorSpec> = [
  // 1. 街区生活道路・仲通り・駅前広場外周 (local_street)
  {
    id: "nav-road-marunouchi-central",
    displayName: "丸の内中央通り（駅前広場通り）",
    routeCode: "千代田区道",
    category: "local_street",
    widthMeters: 11.5,
    hasMedianLine: false,
    points: [
      { x: -450, z: 5 },
      { x: 450, z: 5 },
    ],
  },
  {
    id: "nav-road-marunouchi-nakadori",
    displayName: "丸の内仲通り",
    routeCode: "特別区道千第110号",
    category: "local_street",
    widthMeters: 10.5,
    hasMedianLine: false,
    points: [
      { x: -450, z: 165 },
      { x: 450, z: 165 },
    ],
  },
  {
    id: "nav-road-marunouchi-east-st",
    displayName: "丸の内東通り（大名小路）",
    routeCode: "千代田区道",
    category: "local_street",
    widthMeters: 9.5,
    hasMedianLine: false,
    points: [
      { x: 156, z: 5 },
      { x: 156, z: 250 },
    ],
  },
  {
    id: "nav-road-marunouchi-west-st",
    displayName: "丸の内西通り",
    routeCode: "千代田区道",
    category: "local_street",
    widthMeters: 9.5,
    hasMedianLine: false,
    points: [
      { x: -156, z: 5 },
      { x: -156, z: 250 },
    ],
  },

  {
    id: "nav-road-kokyo-gaien-plaza-curve",
    displayName: "皇居外苑・楠公通り曲線アプローチ（皇居前広場）",
    routeCode: "皇居外苑苑路",
    category: "local_street",
    widthMeters: 12.0,
    hasMedianLine: false,
    points: [
      { x: -24, z: 265 },
      { x: -46, z: 302 },
      { x: -46, z: 338 },
      { x: -24, z: 365 },
    ],
  },

  // 2. 主要幹線都道 (major_avenue)
  {
    id: "nav-road-gyoko-dori",
    displayName: "行幸通り（都道404号）",
    routeCode: "東京都道404号",
    category: "major_avenue",
    widthMeters: 19.0,
    hasMedianLine: true,
    points: [
      { x: 0, z: 5 },
      { x: 0, z: 365 },
    ],
  },
  {
    id: "nav-road-uchibori-dori",
    displayName: "内堀通り（都道301号・皇居外苑）",
    routeCode: "東京都道301号",
    category: "major_avenue",
    widthMeters: 18.0,
    hasMedianLine: true,
    points: [
      { x: -500, z: 365 },
      { x: -268, z: 365 },
      { x: -165, z: 378 },
      { x: 0, z: 390 },
      { x: 165, z: 378 },
      { x: 270, z: 365 },
      { x: 500, z: 365 },
    ],
  },
  {
    id: "nav-road-babasakimon-dori",
    displayName: "鍛冶橋通り・馬場先門通り（都道406号）",
    routeCode: "東京都道406号",
    category: "major_avenue",
    widthMeters: 17.0,
    hasMedianLine: true,
    points: [
      { x: 270, z: -100 },
      { x: 270, z: 365 },
    ],
  },
  {
    id: "nav-road-meiji-dori",
    displayName: "明治通り（都道305号）",
    routeCode: "東京都道305号",
    category: "major_avenue",
    widthMeters: 21.0,
    hasMedianLine: true,
    points: [
      { x: -750, z: -210 },
      { x: -750, z: 248 },
    ],
  },
  {
    id: "nav-road-meiji-dori-ebisu-curve",
    displayName: "明治通り（並木橋・恵比寿方面カーブ区間）",
    routeCode: "東京都道305号",
    category: "major_avenue",
    widthMeters: 19.0,
    hasMedianLine: true,
    points: [
      { x: -750, z: -200 },
      { x: -756, z: -242 },
      { x: -772, z: -286 },
      { x: -796, z: -332 },
    ],
  },
  {
    id: "nav-road-meiji-dori-harajuku-curve",
    displayName: "明治通り（宮下公園・原宿方面カーブ区間）",
    routeCode: "東京都道305号",
    category: "major_avenue",
    widthMeters: 19.0,
    hasMedianLine: true,
    points: [
      { x: -750, z: 195 },
      { x: -753, z: 235 },
      { x: -758, z: 275 },
      { x: -764, z: 315 },
    ],
  },

  // 2b. 渋谷エリア実在放射状曲線道路網 (major_avenue / local_street / national_highway)
  {
    id: "nav-road-shibuya-scramble",
    displayName: "渋谷スクランブル交差点連絡路（109前〜スクランブル中心〜ハチ公前北〜宮益坂下）",
    routeCode: "東京都道305号・413号交点",
    category: "major_avenue",
    widthMeters: 22.0,
    hasMedianLine: false,
    points: [
      { x: -835, z: 252 },
      { x: -815, z: 248 },
      { x: -780, z: 248 },
      { x: -732, z: 248 },
    ],
  },
  {
    id: "nav-road-shibuya-dogenzaka",
    displayName: "道玄坂（都道413号・SHIBUYA109〜道玄坂上坂道区間）",
    routeCode: "東京都道413号",
    category: "major_avenue",
    widthMeters: 16.0,
    hasMedianLine: true,
    points: [
      { x: -830, z: 248 },
      { x: -872, z: 235 },
      { x: -925, z: 215 },
      { x: -975, z: 188 },
      { x: -1030, z: 162 },
      { x: -1080, z: 140 },
    ],
  },
  {
    id: "nav-road-shibuya-miyamasuzaka",
    displayName: "宮益坂（都道413号・渋谷駅東口〜宮益坂上〜表参道方面）",
    routeCode: "東京都道413号",
    category: "major_avenue",
    widthMeters: 17.0,
    hasMedianLine: true,
    points: [
      { x: -732, z: 248 },
      { x: -685, z: 252 },
      { x: -635, z: 254 },
      { x: -560, z: 248 },
      { x: -480, z: 248 },
      { x: -400, z: 248 },
    ],
  },
  {
    id: "nav-road-shibuya-bunkamura-dori",
    displayName: "文化村通り（渋谷109〜東急本店〜松濤二丁目連絡路）",
    routeCode: "渋谷区道文化村通線",
    category: "local_street",
    widthMeters: 14.0,
    hasMedianLine: false,
    points: [
      { x: -828, z: 258 },
      { x: -862, z: 290 },
      { x: -905, z: 325 },
      { x: -940, z: 345 },
      { x: -1000, z: 360 },
      { x: -1060, z: 370 },
    ],
  },
  {
    id: "nav-road-shibuya-koen-dori",
    displayName: "渋谷公園通り（神南一丁目〜PARCO〜渋谷区役所・NHK方面）",
    routeCode: "渋谷区道公園通線",
    category: "major_avenue",
    widthMeters: 15.0,
    hasMedianLine: true,
    points: [
      { x: -790, z: 265 },
      { x: -798, z: 360 },
      { x: -805, z: 440 },
      { x: -810, z: 520 },
    ],
  },
  {
    id: "nav-road-shibuya-inokashira-organ",
    displayName: "井の頭通り・オルガン坂（スクランブル北西〜宇田川町〜PARCO前）",
    routeCode: "渋谷区道井の頭線",
    category: "local_street",
    widthMeters: 11.0,
    hasMedianLine: false,
    points: [
      { x: -840, z: 265 },
      { x: -875, z: 320 },
      { x: -850, z: 348 },
      { x: -798, z: 360 },
    ],
  },
  {
    id: "nav-road-shibuya-tamagawa-west",
    displayName: "玉川通り・国道246号西進（セルリアンタワー〜道玄坂上〜神泉町〜山手通り）",
    routeCode: "国道246号",
    category: "national_highway",
    widthMeters: 20.0,
    hasMedianLine: true,
    points: [
      { x: -855, z: 95 },
      { x: -940, z: 115 },
      { x: -1010, z: 128 },
      { x: -1080, z: 140 },
      { x: -1170, z: 146 },
      { x: -1250, z: 150 },
      { x: -1350, z: 150 },
    ],
  },
  {
    id: "nav-road-shibuya-shinsen-nakadori",
    displayName: "円山町・神泉仲通り（道玄坂上〜神泉駅前〜松濤二丁目）",
    routeCode: "渋谷区特別区道",
    category: "local_street",
    widthMeters: 9.5,
    hasMedianLine: false,
    points: [
      { x: -1080, z: 140 },
      { x: -1100, z: 185 },
      { x: -1110, z: 230 },
      { x: -1100, z: 300 },
      { x: -1060, z: 370 },
    ],
  },
  {
    id: "nav-road-shibuya-sakurazaka-loop",
    displayName: "桜丘さくら坂（サクラステージ〜インフォスタワー〜玉川通り周回路）",
    routeCode: "渋谷区特別区道",
    category: "local_street",
    widthMeters: 10.0,
    hasMedianLine: false,
    points: [
      { x: -855, z: 95 },
      { x: -855, z: 40 },
      { x: -890, z: 10 },
      { x: -940, z: -30 },
      { x: -950, z: -60 },
      { x: -980, z: 0 },
      { x: -940, z: 115 },
    ],
  },
  {
    id: "nav-road-shibuya-jinnan-cross",
    displayName: "神南二丁目連絡路（宮下公園北〜勤労福祉会館前）",
    routeCode: "渋谷区道美竹線",
    category: "local_street",
    widthMeters: 10.5,
    hasMedianLine: false,
    points: [
      { x: -750, z: 440 },
      { x: -778, z: 440 },
      { x: -805, z: 440 },
      { x: -855, z: 440 },
    ],
  },
  {
    id: "nav-road-shibuya-center-gai",
    displayName:
      "渋谷センター街・バスケットボール通り（スクランブル北西〜宇田川町交番・井の頭通り合流）",
    routeCode: "渋谷区道センター街線",
    category: "local_street",
    widthMeters: 10.0,
    hasMedianLine: false,
    points: [
      { x: -835, z: 268 },
      { x: -850, z: 292 },
      { x: -875, z: 320 },
      { x: -905, z: 350 },
      { x: -935, z: 375 },
    ],
  },
  {
    id: "nav-road-shibuya-hikarie-access",
    displayName: "ヒカリエ前通り・金王坂連絡路（宮益坂下〜ヒカリエ前〜金王坂・国道246号）",
    routeCode: "渋谷区道ヒカリエ連絡線",
    category: "local_street",
    widthMeters: 10.0,
    hasMedianLine: false,
    points: [
      { x: -732, z: 248 },
      { x: -730, z: 205 },
      { x: -730, z: 155 },
      { x: -730, z: 120 },
      { x: -730, z: 95 },
    ],
  },

  // 3. 国道幹線 (national_highway)
  {
    id: "nav-road-hibiya-dori",
    displayName: "日比谷通り（国道1号・大手町〜日比谷）",
    routeCode: "国道1号",
    category: "national_highway",
    widthMeters: 22.0,
    hasMedianLine: true,
    points: [
      { x: -500, z: 250 },
      { x: 500, z: 250 },
    ],
  },
  {
    id: "nav-road-eitai-dori",
    displayName: "永代通り・大手町大通り（国道1号）",
    routeCode: "国道1号",
    category: "national_highway",
    widthMeters: 17.5,
    hasMedianLine: true,
    points: [
      { x: -268, z: -100 },
      { x: -268, z: 365 },
    ],
  },
  {
    id: "nav-road-route246",
    displayName: "国道246号（青山通り・渋谷駅東口連絡路）",
    routeCode: "国道246号",
    category: "national_highway",
    widthMeters: 18.0,
    hasMedianLine: true,
    points: [
      { x: -732, z: 95 },
      { x: -632, z: 95 },
      { x: -545, z: 108 },
      { x: -450, z: 108 },
      { x: -355, z: 98 },
      { x: -268, z: 95 },
    ],
  },
  // 10倍広域マップ拡張幹線道路
  {
    id: "nav-road-meiji-dori-north",
    displayName: "明治通り北（原宿・代々木方面）",
    routeCode: "都道305号",
    category: "major_avenue",
    widthMeters: 22.0,
    hasMedianLine: true,
    points: [
      { x: -750, z: 248 },
      { x: -750, z: 1050 },
    ],
  },
  {
    id: "nav-road-meiji-dori-south",
    displayName: "明治通り南（恵比寿・広尾方面）",
    routeCode: "都道305号",
    category: "major_avenue",
    widthMeters: 22.0,
    hasMedianLine: true,
    points: [
      { x: -750, z: -1050 },
      { x: -750, z: -200 },
    ],
  },
  {
    id: "nav-road-yamate-dori",
    displayName: "山手通り（環状6号線）",
    routeCode: "都道317号",
    category: "major_avenue",
    widthMeters: 24.0,
    hasMedianLine: true,
    points: [
      { x: -1350, z: -850 },
      { x: -1350, z: 850 },
    ],
  },
  {
    id: "nav-road-roppongi-dori",
    displayName: "六本木通り（渋谷〜六本木〜赤坂）",
    routeCode: "都道412号",
    category: "major_avenue",
    widthMeters: 22.0,
    hasMedianLine: true,
    points: [
      { x: -600, z: -350 },
      { x: 0, z: -350 },
    ],
  },
  {
    id: "nav-road-harumi-dori",
    displayName: "晴海通り（数寄屋橋〜銀座四丁目〜東銀座）",
    routeCode: "都道304号",
    category: "major_avenue",
    widthMeters: 22.0,
    hasMedianLine: true,
    points: [
      { x: 0, z: -350 },
      { x: 800, z: -350 },
    ],
  },
  {
    id: "nav-road-ginza-chuo-dori",
    displayName: "銀座中央通り（銀座一丁目〜銀座八丁目）",
    routeCode: "国道15号",
    category: "major_avenue",
    widthMeters: 18.0,
    hasMedianLine: true,
    points: [
      { x: 156, z: -750 },
      { x: 156, z: -90 },
    ],
  },
  {
    id: "nav-road-showa-dori",
    displayName: "昭和通り（新橋〜銀座〜宝町〜日本橋〜神田）",
    routeCode: "都道316号",
    category: "national_highway",
    widthMeters: 28.0,
    hasMedianLine: true,
    points: [
      { x: 650, z: -750 },
      { x: 650, z: 850 },
    ],
  },
  {
    id: "nav-road-uchibori-loop-west",
    displayName: "内堀通り西（三宅坂〜半蔵門〜千鳥ヶ淵）",
    routeCode: "都道301号",
    category: "major_avenue",
    widthMeters: 22.0,
    hasMedianLine: true,
    points: [
      { x: -350, z: 365 },
      { x: -350, z: 850 },
    ],
  },
  {
    id: "nav-road-uchibori-loop-north",
    displayName: "内堀通り北（千鳥ヶ淵〜竹橋）",
    routeCode: "都道301号",
    category: "major_avenue",
    widthMeters: 22.0,
    hasMedianLine: true,
    points: [
      { x: -350, z: 850 },
      { x: 0, z: 850 },
    ],
  },
  {
    id: "nav-road-shimbashi-avenue",
    displayName: "新橋・汐留大通り（虎ノ門〜新橋〜汐留）",
    routeCode: "都道405号",
    category: "major_avenue",
    widthMeters: 22.0,
    hasMedianLine: true,
    points: [
      { x: -268, z: -750 },
      { x: 550, z: -750 },
    ],
  },
];

const NAVIGATION_INTERSECTIONS: ReadonlyArray<NavigationIntersectionSpec> = [
  {
    id: "nav-int-tokyo-central",
    name: "東京駅中央口",
    x: 0,
    z: 5,
    widthMeters: 19,
    depthMeters: 12,
  },
  {
    id: "nav-int-gyoko-nakadori",
    name: "行幸通り仲通り",
    x: 0,
    z: 165,
    widthMeters: 19,
    depthMeters: 11,
  },
  { id: "nav-int-wadakuramon", name: "和田倉門", x: 0, z: 250, widthMeters: 20, depthMeters: 22 },
  { id: "nav-int-kokyogaien", name: "皇居外苑", x: 0, z: 365, widthMeters: 19, depthMeters: 18 },
  { id: "nav-int-otemachi", name: "大手町", x: -268, z: 250, widthMeters: 18, depthMeters: 22 },
  {
    id: "nav-int-otemachi-central",
    name: "大手町駅前",
    x: -268,
    z: 5,
    widthMeters: 18,
    depthMeters: 12,
  },
  {
    id: "nav-int-otemachi-r246",
    name: "大手町R246分岐",
    x: -268,
    z: 95,
    widthMeters: 18,
    depthMeters: 18,
  },
  { id: "nav-int-babasakimon", name: "馬場先門", x: 270, z: 250, widthMeters: 17, depthMeters: 22 },
  {
    id: "nav-int-kajibashi-central",
    name: "丸の内南口",
    x: 270,
    z: 5,
    widthMeters: 17,
    depthMeters: 12,
  },
  {
    id: "nav-int-marunouchi-east-central",
    name: "丸の内東通り入口",
    x: 156,
    z: 5,
    widthMeters: 10,
    depthMeters: 12,
  },
  {
    id: "nav-int-marunouchi-east-nakadori",
    name: "丸の内東通り仲通り",
    x: 156,
    z: 165,
    widthMeters: 10,
    depthMeters: 11,
  },
  {
    id: "nav-int-marunouchi-east-hibiya",
    name: "二重橋前",
    x: 156,
    z: 250,
    widthMeters: 10,
    depthMeters: 22,
  },
  {
    id: "nav-int-marunouchi-west-central",
    name: "丸の内北口前",
    x: -156,
    z: 5,
    widthMeters: 10,
    depthMeters: 12,
  },
  {
    id: "nav-int-marunouchi-west-nakadori",
    name: "丸の内西通り仲通り",
    x: -156,
    z: 165,
    widthMeters: 10,
    depthMeters: 11,
  },
  {
    id: "nav-int-marunouchi-west-hibiya",
    name: "丸の内一丁目",
    x: -156,
    z: 250,
    widthMeters: 10,
    depthMeters: 22,
  },
  {
    id: "nav-int-shibuya-east",
    name: "渋谷駅東口",
    x: -750,
    z: 95,
    widthMeters: 21,
    depthMeters: 18,
  },
  {
    id: "nav-int-shibuya-miyamasuzaka-shita",
    name: "宮益坂下",
    x: -750,
    z: 248,
    widthMeters: 28,
    depthMeters: 24,
  },
  {
    id: "nav-int-shibuya-109-y",
    name: "SHIBUYA109前",
    x: -830,
    z: 252,
    widthMeters: 30,
    depthMeters: 28,
  },
  {
    id: "nav-int-shibuya-scramble",
    name: "渋谷スクランブル交差点",
    x: -815,
    z: 248,
    widthMeters: 38,
    depthMeters: 38,
  },
  {
    id: "nav-int-shibuya-dogenzaka-ue",
    name: "道玄坂上（玉川通り合流）",
    x: -1080,
    z: 140,
    widthMeters: 24,
    depthMeters: 22,
  },
  {
    id: "nav-int-shibuya-shinsen-cho",
    name: "神泉町（旧山手通り交差点）",
    x: -1250,
    z: 150,
    widthMeters: 26,
    depthMeters: 24,
  },
  {
    id: "nav-int-shibuya-tokyu-honten",
    name: "東急本店前（松濤文化村通り）",
    x: -940,
    z: 345,
    widthMeters: 22,
    depthMeters: 20,
  },
  {
    id: "nav-int-shibuya-shoto-2chome",
    name: "松濤二丁目",
    x: -1060,
    z: 370,
    widthMeters: 20,
    depthMeters: 18,
  },
  {
    id: "nav-int-shibuya-jinnan-1chome",
    name: "神南一丁目（公園通り入口）",
    x: -790,
    z: 265,
    widthMeters: 22,
    depthMeters: 20,
  },
  {
    id: "nav-int-shibuya-parco",
    name: "渋谷PARCO前（オルガン坂合流）",
    x: -798,
    z: 360,
    widthMeters: 22,
    depthMeters: 20,
  },
  {
    id: "nav-int-shibuya-kinro-fukushi",
    name: "勤労福祉会館前",
    x: -805,
    z: 440,
    widthMeters: 22,
    depthMeters: 20,
  },
  {
    id: "nav-int-shibuya-ward-office",
    name: "渋谷区役所・NHK前",
    x: -810,
    z: 520,
    widthMeters: 24,
    depthMeters: 22,
  },
  {
    id: "nav-int-shibuya-udagawa-koban",
    name: "宇田川町交番前",
    x: -875,
    z: 320,
    widthMeters: 18,
    depthMeters: 16,
  },
  {
    id: "nav-int-shibuya-sakurazaka-infotower",
    name: "さくら坂上（インフォスタワー前）",
    x: -950,
    z: -60,
    widthMeters: 18,
    depthMeters: 16,
  },
  {
    id: "nav-int-shibuya-miyamasuzaka-ue",
    name: "宮益坂上",
    x: -560,
    z: 248,
    widthMeters: 22,
    depthMeters: 20,
  },
  {
    id: "nav-int-shibuya-aoyama-omotesando",
    name: "青山通り・表参道方面接続",
    x: -400,
    z: 248,
    widthMeters: 24,
    depthMeters: 22,
  },
  {
    id: "nav-int-shibuya-cerulean-tamagawa",
    name: "セルリアンタワー前（玉川通り・さくら坂入口）",
    x: -855,
    z: 95,
    widthMeters: 24,
    depthMeters: 22,
  },
  {
    id: "nav-int-shibuya-center-gai",
    name: "センター街入口（スクランブル北西）",
    x: -835,
    z: 268,
    widthMeters: 20,
    depthMeters: 18,
  },
  {
    id: "nav-int-shibuya-hikarie-front",
    name: "ヒカリエ前（アクセス道路・ShinQsエントランス前）",
    x: -730,
    z: 155,
    widthMeters: 22,
    depthMeters: 20,
  },
  {
    id: "nav-int-shibuya-kon-ozaka",
    name: "金王坂下・ヒカリエ南（国道246号・青山通り合流）",
    x: -730,
    z: 95,
    widthMeters: 24,
    depthMeters: 22,
  },
  // 10倍広域マップ拡張主要交差点
  {
    id: "nav-int-jingumae",
    name: "神宮前",
    x: -750,
    z: 550,
    widthMeters: 28,
    depthMeters: 24,
  },
  {
    id: "nav-int-harajuku-station",
    name: "原宿駅前",
    x: -750,
    z: 850,
    widthMeters: 28,
    depthMeters: 24,
  },
  {
    id: "nav-int-shibuyabashi",
    name: "渋谷橋",
    x: -750,
    z: -550,
    widthMeters: 28,
    depthMeters: 24,
  },
  {
    id: "nav-int-ebisu-station",
    name: "恵比寿駅前",
    x: -750,
    z: -800,
    widthMeters: 28,
    depthMeters: 24,
  },
  {
    id: "nav-int-nishi-azabu",
    name: "西麻布",
    x: -550,
    z: -350,
    widthMeters: 30,
    depthMeters: 30,
  },
  {
    id: "nav-int-roppongi",
    name: "六本木",
    x: -380,
    z: -350,
    widthMeters: 30,
    depthMeters: 30,
  },
  {
    id: "nav-int-omotesando",
    name: "表参道",
    x: -550,
    z: 250,
    widthMeters: 30,
    depthMeters: 30,
  },
  {
    id: "nav-int-aoyama-itchome",
    name: "青山一丁目",
    x: -380,
    z: 250,
    widthMeters: 30,
    depthMeters: 28,
  },
  {
    id: "nav-int-miyakezaka",
    name: "三宅坂",
    x: -350,
    z: 365,
    widthMeters: 30,
    depthMeters: 28,
  },
  {
    id: "nav-int-hanzomon",
    name: "半蔵門",
    x: -350,
    z: 850,
    widthMeters: 30,
    depthMeters: 30,
  },
  {
    id: "nav-int-takebashi",
    name: "竹橋",
    x: 0,
    z: 850,
    widthMeters: 30,
    depthMeters: 30,
  },
  {
    id: "nav-int-sukiyabashi",
    name: "数寄屋橋",
    x: 0,
    z: -350,
    widthMeters: 30,
    depthMeters: 30,
  },
  {
    id: "nav-int-ginza-4chome",
    name: "銀座四丁目",
    x: 156,
    z: -350,
    widthMeters: 32,
    depthMeters: 30,
  },
  {
    id: "nav-int-shimbashi",
    name: "新橋",
    x: 0,
    z: -750,
    widthMeters: 30,
    depthMeters: 30,
  },
  {
    id: "nav-int-shiodome",
    name: "汐留",
    x: 650,
    z: -750,
    widthMeters: 32,
    depthMeters: 30,
  },
  {
    id: "nav-int-yamate-shinsen",
    name: "山手神泉",
    x: -1350,
    z: 150,
    widthMeters: 30,
    depthMeters: 26,
  },
];

/**
 * カーナビ地図ペイン描画用の連続道路コリドー一覧を取得する。
 */
export function getNavigationRoadCorridors(): ReadonlyArray<NavigationRoadCorridorSpec> {
  return NAVIGATION_ROAD_CORRIDORS;
}

/**
 * 国土地理院 (GSI) オープンデータの曲線・多頂点ポリライン道路コリドー一覧を取得する。
 * How: 3D 道路メッシュおよび縁石・ガードレール物理コライダーを生成する際、交差点フラットパッド（明治通り x=-750、永代通り x=-268 等）と
 * 重複して交差道路を塞がないよう、交差点手前で適切にトリミングされた3D曲線ポリライン座標を返す。
 */
export function getOpenDataCurvedRoadCorridors(): ReadonlyArray<NavigationRoadCorridorSpec> {
  return [
    {
      id: "nav-road-kokyo-gaien-plaza-curve",
      displayName: "皇居外苑・楠公通り曲線アプローチ（皇居前広場）",
      routeCode: "皇居外苑苑路",
      category: "local_street",
      widthMeters: 12.0,
      hasMedianLine: false,
      points: [
        { x: -24, z: 265 },
        { x: -46, z: 302 },
        { x: -46, z: 338 },
        { x: -24, z: 355 },
      ],
    },
    {
      id: "nav-road-uchibori-dori",
      displayName: "内堀通り（都道301号・皇居外苑カーブ区間）",
      routeCode: "東京都道301号",
      category: "major_avenue",
      widthMeters: 18.0,
      hasMedianLine: true,
      points: [
        { x: -253, z: 365 },
        { x: -165, z: 378 },
        { x: 0, z: 390 },
        { x: 165, z: 378 },
        { x: 255, z: 365 },
      ],
    },
    {
      id: "nav-road-meiji-dori-ebisu-curve",
      displayName: "明治通り（並木橋・恵比寿方面カーブ区間）",
      routeCode: "東京都道305号",
      category: "major_avenue",
      widthMeters: 19.0,
      hasMedianLine: true,
      points: [
        { x: -750, z: -211 },
        { x: -756, z: -242 },
        { x: -772, z: -286 },
        { x: -796, z: -332 },
      ],
    },
    {
      id: "nav-road-meiji-dori-harajuku-curve",
      displayName: "明治通り（宮下公園・原宿方面カーブ区間）",
      routeCode: "東京都道305号",
      category: "major_avenue",
      widthMeters: 19.0,
      hasMedianLine: true,
      points: [
        { x: -750, z: 206 },
        { x: -753, z: 245 },
        { x: -758, z: 280 },
        { x: -764, z: 315 },
      ],
    },
    {
      id: "nav-road-route246",
      displayName: "国道246号（青山通り・渋谷駅東口連絡路）",
      routeCode: "国道246号",
      category: "national_highway",
      widthMeters: 18.0,
      hasMedianLine: true,
      points: [
        { x: -734, z: 95 },
        { x: -632, z: 95 },
        { x: -545, z: 108 },
        { x: -450, z: 108 },
        { x: -355, z: 98 },
        { x: -283, z: 95 },
      ],
    },
    {
      id: "nav-road-shibuya-dogenzaka",
      displayName: "道玄坂（都道413号・SHIBUYA109〜道玄坂上坂道区間）",
      routeCode: "東京都道413号",
      category: "major_avenue",
      widthMeters: 16.0,
      hasMedianLine: true,
      points: [
        { x: -837, z: 248 },
        { x: -872, z: 235 },
        { x: -925, z: 215 },
        { x: -975, z: 188 },
        { x: -1030, z: 162 },
        { x: -1080, z: 140 },
      ],
    },
    {
      id: "nav-road-shibuya-miyamasuzaka",
      displayName: "宮益坂（都道413号・渋谷駅東口〜宮益坂上〜表参道方面）",
      routeCode: "東京都道413号",
      category: "major_avenue",
      widthMeters: 17.0,
      hasMedianLine: true,
      points: [
        { x: -732, z: 248 },
        { x: -685, z: 252 },
        { x: -635, z: 254 },
        { x: -560, z: 248 },
        { x: -480, z: 248 },
        { x: -400, z: 248 },
      ],
    },
    {
      id: "nav-road-shibuya-bunkamura-dori",
      displayName: "文化村通り（渋谷109〜東急本店〜松濤二丁目連絡路）",
      routeCode: "渋谷区道文化村通線",
      category: "local_street",
      widthMeters: 14.0,
      hasMedianLine: false,
      points: [
        { x: -828, z: 258 },
        { x: -862, z: 290 },
        { x: -905, z: 325 },
        { x: -940, z: 345 },
        { x: -1000, z: 360 },
        { x: -1060, z: 370 },
      ],
    },
    {
      id: "nav-road-shibuya-koen-dori",
      displayName: "渋谷公園通り（神南一丁目〜PARCO〜渋谷区役所・NHK方面）",
      routeCode: "渋谷区道公園通線",
      category: "major_avenue",
      widthMeters: 15.0,
      hasMedianLine: true,
      points: [
        { x: -791, z: 270 },
        { x: -798, z: 360 },
        { x: -805, z: 440 },
        { x: -810, z: 520 },
      ],
    },
    {
      id: "nav-road-shibuya-inokashira-organ",
      displayName: "井の頭通り・オルガン坂（スクランブル北西〜宇田川町〜PARCO前）",
      routeCode: "渋谷区道井の頭線",
      category: "local_street",
      widthMeters: 11.0,
      hasMedianLine: false,
      points: [
        { x: -840, z: 265 },
        { x: -875, z: 320 },
        { x: -850, z: 348 },
        { x: -798, z: 360 },
      ],
    },
    {
      id: "nav-road-shibuya-tamagawa-west",
      displayName: "玉川通り・国道246号西進（セルリアンタワー〜道玄坂上〜神泉町〜山手通り）",
      routeCode: "国道246号",
      category: "national_highway",
      widthMeters: 20.0,
      hasMedianLine: true,
      points: [
        { x: -855, z: 95 },
        { x: -940, z: 115 },
        { x: -1010, z: 128 },
        { x: -1080, z: 140 },
        { x: -1170, z: 146 },
        { x: -1250, z: 150 },
        { x: -1350, z: 150 },
      ],
    },
    {
      id: "nav-road-shibuya-shinsen-nakadori",
      displayName: "円山町・神泉仲通り（道玄坂上〜神泉駅前〜松濤二丁目）",
      routeCode: "渋谷区特別区道",
      category: "local_street",
      widthMeters: 9.5,
      hasMedianLine: false,
      points: [
        { x: -1080, z: 140 },
        { x: -1100, z: 185 },
        { x: -1110, z: 230 },
        { x: -1100, z: 300 },
        { x: -1060, z: 370 },
      ],
    },
    {
      id: "nav-road-shibuya-sakurazaka-loop",
      displayName: "桜丘さくら坂（サクラステージ〜インフォスタワー〜玉川通り周回路）",
      routeCode: "渋谷区特別区道",
      category: "local_street",
      widthMeters: 10.0,
      hasMedianLine: false,
      points: [
        { x: -855, z: 95 },
        { x: -855, z: 40 },
        { x: -890, z: 10 },
        { x: -940, z: -30 },
        { x: -950, z: -60 },
        { x: -980, z: 0 },
        { x: -940, z: 115 },
      ],
    },
    {
      id: "nav-road-shibuya-jinnan-cross",
      displayName: "神南二丁目連絡路（宮下公園北〜勤労福祉会館前）",
      routeCode: "渋谷区道美竹線",
      category: "local_street",
      widthMeters: 10.5,
      hasMedianLine: false,
      points: [
        { x: -750, z: 440 },
        { x: -778, z: 440 },
        { x: -805, z: 440 },
        { x: -855, z: 440 },
      ],
    },
    {
      id: "nav-road-shibuya-center-gai",
      displayName:
        "渋谷センター街・バスケットボール通り（スクランブル北西〜宇田川町交番・井の頭通り合流）",
      routeCode: "渋谷区道センター街線",
      category: "local_street",
      widthMeters: 10.0,
      hasMedianLine: false,
      points: [
        { x: -835, z: 268 },
        { x: -850, z: 292 },
        { x: -875, z: 320 },
        { x: -905, z: 350 },
        { x: -935, z: 375 },
      ],
    },
    {
      id: "nav-road-shibuya-hikarie-access",
      displayName: "ヒカリエ前通り・金王坂連絡路（宮益坂下〜ヒカリエ前〜金王坂・国道246号）",
      routeCode: "渋谷区道ヒカリエ連絡線",
      category: "local_street",
      widthMeters: 10.0,
      hasMedianLine: false,
      points: [
        { x: -732, z: 248 },
        { x: -730, z: 205 },
        { x: -730, z: 155 },
        { x: -730, z: 120 },
        { x: -730, z: 95 },
      ],
    },
  ];
}

/**
 * カーナビ地図ペイン描画用の主要交差点一覧を取得する。
 */
export function getNavigationIntersections(): ReadonlyArray<NavigationIntersectionSpec> {
  return NAVIGATION_INTERSECTIONS;
}

/**
 * 皇居外苑内濠（和田倉濠・日比谷濠）のオープンデータ水部仕様を3D描画用に変換する。
 * How: 国土地理院 DEM5A の水面標高 (`TP +1.56m` / `TP +2.04m`) と東京駅前広場基準面 (`TP +3.00m`) の実測標高差から水面Y座標を算出する。
 */
export function getPlateauWaterBodies(): PlateauWaterBodyRenderSpec[] {
  const baseElevationTp = activeOpenData.metadata.origin.baseElevationTpM;

  return activeOpenData.waterBodies.map((wb) => {
    const elevationDiff = wb.waterSurfaceElevationM - baseElevationTp;
    const relativeWaterY = Number(Math.min(-0.45, elevationDiff * 0.55).toFixed(2));

    return {
      id: wb.id,
      name: wb.name,
      nameEn: wb.nameEn,
      x: wb.localX,
      z: wb.localZ,
      w: wb.width,
      d: wb.depth,
      waterSurfaceElevationM: wb.waterSurfaceElevationM,
      relativeWaterY,
    };
  });
}

import { assetManager } from "../assets/assetManager";
import { TOKYO_MARUNOUCHI_OPEN_DATA } from "./tokyoMarunouchiOpenData";

export type TokyoOpenDataBundle = typeof TOKYO_MARUNOUCHI_OPEN_DATA;
export type PlateauBuildingRecord = TokyoOpenDataBundle["plateauBuildings"][number];
export type GsiRoadSegmentRecord = TokyoOpenDataBundle["gsiRoadSegments"][number];
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
 * JGD2011 / WGS84 緯度経度 (lat, lon) を東京駅丸の内ローカル3D座標 (x, z) に変換する。
 * How: 行幸通り起点 (35.68158°N, 139.76525°E) を原点とし、行幸通り軸線 (方位角284.9°) を +z 軸へ直交回転投影する。
 */
export function wgs84ToLocal(lat: number, lon: number): LocalCoordinate {
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
 * 東京駅丸の内ローカル3D座標 (x, z) を JGD2011 / WGS84 緯度経度 (lat, lon) に逆変換する。
 * How: 直交回転行列の転置（逆変換）により東西・南北メートル変位を復元し、緯度経度へ換算する。
 */
export function localToWgs84(x: number, z: number): Wgs84Coordinate {
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
 */
export function sampleGsiDemElevation(x: number, z: number): number {
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

/**
 * 基礎地面メッシュ頂点向けの相対地形変位 (m) を計算する。
 * Why not: 車道・交差点の走行面に地形凹凸をそのまま適用すると平坦な Rapier コライダーと視覚メッシュに乖離が生じるため、
 * 道路コリドー外周のみで国土地理院 DEM5A の実測微地形へ滑らかにブレンドする。
 */
export function getRelativeTerrainDisplacement(x: number, z: number): number {
  const isNearGyokoDori = Math.abs(x) < 42 && z > -25 && z < 268;
  const isNearCentralAve = Math.abs(z - 5) < 22 && Math.abs(x) < 130;
  const isNearHibiyaDori = Math.abs(z - 250) < 26 && Math.abs(x) < 135;
  const isOnRoadCorridor = isNearGyokoDori || isNearCentralAve || isNearHibiyaDori;

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
function pointToSegmentDistance(
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
  const segments = activeOpenData.gsiRoadSegments;
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
 * 現在座標 (x, z) から最も近い東京都 Project PLATEAU 千代田区 (13101) 建築物を検索する。
 */
export function findNearestPlateauBuilding(x: number, z: number): NearestPlateauBuildingResult {
  const buildings = activeOpenData.plateauBuildings;
  let bestBuilding: PlateauBuildingRecord = buildings[0];
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
    const x: number = b.localX;
    let z: number = b.localZ;
    const w: number = b.width;
    let d: number = b.depth;

    // 日比谷通り (z = 250m, 幅員約32m → z ∈ [234, 266]) の車道・歩道クリアランス確保
    const isNearHibiyaCorridor = Math.abs(x) < 140 && z + d / 2 > 226 && z < 260;
    if (isNearHibiyaCorridor) {
      d = Math.min(d, 52);
      z = Math.min(z, 226 - d / 2);
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

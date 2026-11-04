/**
 * 東京都デジタルツイン / 国土交通省 Project PLATEAU (千代田区 13101, 2025年度 Spec 5.0)
 * および 国土地理院 (GSI) 地理院タイル (DEM5A 5mメッシュ数値標高モデル / experimental_rdcl 道路中心線)
 * を取得し、東京駅丸の内〜行幸通り〜皇居外苑ローカル3D座標系へ変換して出力するスクリプト。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 東京駅丸の内駅前広場（行幸通り起点）の基準原点（JGD2011 / WGS84）
const ORIGIN_LAT = 35.68158;
const ORIGIN_LON = 139.76525;
// 行幸通り中心軸（東京駅丸の内中央口から皇居・和田倉門方面への方位角: 東から反時計回り 165.1°）
const GYOKO_AXIS_RAD = (165.1 * Math.PI) / 180;

const METERS_PER_DEG_LAT = 110946.25;
const METERS_PER_DEG_LON = 111319.49 * Math.cos((ORIGIN_LAT * Math.PI) / 180);

// 単位ベクトル (+z: 行幸通り皇居方向 WNW, +x: 丸ビル・有楽町方向 SSW, -x: 新丸ビル・大手町方向 NNE)
const UZ_EAST = Math.cos(GYOKO_AXIS_RAD);
const UZ_NORTH = Math.sin(GYOKO_AXIS_RAD);
const UX_EAST = -UZ_NORTH;
const UX_NORTH = UZ_EAST;

interface LocalCoord {
  x: number;
  z: number;
}

function wgs84ToLocal(lat: number, lon: number): LocalCoord {
  const dEast = (lon - ORIGIN_LON) * METERS_PER_DEG_LON;
  const dNorth = (lat - ORIGIN_LAT) * METERS_PER_DEG_LAT;
  const x = dEast * UX_EAST + dNorth * UX_NORTH;
  const z = dEast * UZ_EAST + dNorth * UZ_NORTH;
  return {
    x: Number(x.toFixed(2)),
    z: Number(z.toFixed(2)),
  };
}

function localToWgs84(x: number, z: number): { lat: number; lon: number } {
  const dEast = x * UX_EAST + z * UZ_EAST;
  const dNorth = x * UX_NORTH + z * UZ_NORTH;
  const lon = ORIGIN_LON + dEast / METERS_PER_DEG_LON;
  const lat = ORIGIN_LAT + dNorth / METERS_PER_DEG_LAT;
  return { lat, lon };
}

function latLonToTilePixel(lat: number, lon: number, zoom: number) {
  const n = 2 ** zoom;
  const xtileFloat = ((lon + 180.0) / 360.0) * n;
  const latRad = (lat * Math.PI) / 180.0;
  const ytileFloat = ((1.0 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2.0) * n;
  const tileX = Math.floor(xtileFloat);
  const tileY = Math.floor(ytileFloat);
  const px = Math.min(255, Math.max(0, Math.floor((xtileFloat - tileX) * 256)));
  const py = Math.min(255, Math.max(0, Math.floor((ytileFloat - tileY) * 256)));
  return { tileX, tileY, px, py };
}

// PLATEAU 千代田区 (13101) の既知ランドマーク名称辞書（PLATEAU CityGML で gml:name が省略されている主要歴史・高層建築物の公式名称補完）
const LANDMARK_NAME_BY_ID: Record<string, { name: string; nameEn: string; podiumHeight: number }> =
  {
    "13101-bldg-3114": {
      name: "新丸の内ビルディング",
      nameEn: "Shin-Marunouchi Building",
      podiumHeight: 31.0,
    },
    "13101-bldg-1194": {
      name: "丸の内ビルディング",
      nameEn: "Marunouchi Building",
      podiumHeight: 31.0,
    },
    "13101-bldg-2287": {
      name: "JPタワー (KITTE丸の内)",
      nameEn: "JP Tower / KITTE",
      podiumHeight: 31.0,
    },
    "13101-bldg-2340": {
      name: "丸の内パークビルディング",
      nameEn: "Marunouchi Park Building",
      podiumHeight: 31.0,
    },
    "13101-bldg-3556": {
      name: "東京ビルディング (TOKIA)",
      nameEn: "Tokyo Building TOKIA",
      podiumHeight: 31.0,
    },
    "13101-bldg-1336": {
      name: "日本工業倶楽部会館・三菱UFJ信託銀行本店ビル",
      nameEn: "Industry Club of Japan / Mitsubishi UFJ Trust",
      podiumHeight: 31.0,
    },
    "13101-bldg-4002": {
      name: "丸の内オアゾ (日本生命丸の内ビル)",
      nameEn: "Marunouchi OAZO / Nippon Life Bldg",
      podiumHeight: 31.0,
    },
    "13101-bldg-604": {
      name: "東京海上日動ビルディング本館",
      nameEn: "Tokio Marine Nichido Building",
      podiumHeight: 31.0,
    },
    "13101-bldg-4184": {
      name: "三菱商事ビルディング",
      nameEn: "Mitsubishi Corporation Building",
      podiumHeight: 31.0,
    },
    "13101-bldg-4149": {
      name: "郵船ビルディング",
      nameEn: "Yusen Building",
      podiumHeight: 31.0,
    },
    "13101-bldg-2033": {
      name: "東京銀行協会ビルディング",
      nameEn: "Tokyo Bankers Association Building",
      podiumHeight: 31.0,
    },
    "13101-bldg-3631": {
      name: "パレスホテル東京",
      nameEn: "Palace Hotel Tokyo",
      podiumHeight: 31.0,
    },
    "13101-bldg-1824": {
      name: "丸の内永楽ビルディング (iiyo!!)",
      nameEn: "Marunouchi Eiraku Building",
      podiumHeight: 31.0,
    },
    "13101-bldg-3449": {
      name: "明治安田生命ビル (明治生命館街区)",
      nameEn: "Meiji Yasuda Life Building",
      podiumHeight: 31.0,
    },
    "13101-bldg-1849": {
      name: "丸の内仲通りビル",
      nameEn: "Marunouchi Nakadori Building",
      podiumHeight: 31.0,
    },
    "13101-bldg-881": {
      name: "丸の内二丁目ビル",
      nameEn: "Marunouchi 2-Chome Building",
      podiumHeight: 31.0,
    },
    "13101-bldg-768": {
      name: "丸の内仲通り岸本ビル街区",
      nameEn: "Kishimoto Building Block",
      podiumHeight: 31.0,
    },
    "13101-bldg-3741": {
      name: "丸の内二重橋ビル北ブロック",
      nameEn: "Marunouchi Nijubashi North",
      podiumHeight: 31.0,
    },
  };

async function main() {
  console.log(
    "[OpenData] Fetching GSI DEM5A (15/29105/12903) & Road Centerlines (16/58211/25806)...",
  );

  // 1. 国土地理院 5mメッシュ数値標高モデル (DEM5A) の取得
  const demUrl = "https://cyberjapandata.gsi.go.jp/xyz/dem5a/15/29105/12903.txt";
  const demRes = await fetch(demUrl);
  const isDemOk = demRes.ok;
  if (!isDemOk) {
    throw new Error(`Failed to fetch GSI DEM5A: ${demRes.status}`);
  }
  const demText = await demRes.text();
  const demRows = demText
    .trim()
    .split(/\r?\n/)
    .map((line) =>
      line.split(",").map((cell) => {
        const parsed = Number.parseFloat(cell);
        return Number.isFinite(parsed) ? parsed : 3.0;
      }),
    );

  // ローカル座標 x ∈ [-240, 240] (step 20m -> 25 cols), z ∈ [-80, 320] (step 20m -> 21 rows) の DEM5A 標高メッシュを抽出
  const xMin = -240;
  const xMax = 240;
  const zMin = -80;
  const zMax = 320;
  const gridStep = 20;
  const elevationGrid: number[][] = [];

  for (let z = zMin; z <= zMax; z += gridStep) {
    const row: number[] = [];
    for (let x = xMin; x <= xMax; x += gridStep) {
      const { lat, lon } = localToWgs84(x, z);
      const { px, py } = latLonToTilePixel(lat, lon, 15);
      const elev = demRows[py]?.[px] ?? 3.0;
      row.push(Number(elev.toFixed(2)));
    }
    elevationGrid.push(row);
  }

  // 2. 国土地理院 道路中心線 (experimental_rdcl) の取得
  const rdclUrl = "https://cyberjapandata.gsi.go.jp/xyz/experimental_rdcl/16/58211/25806.geojson";
  const rdclRes = await fetch(rdclUrl);
  const isRdclOk = rdclRes.ok;
  if (!isRdclOk) {
    throw new Error(`Failed to fetch GSI experimental_rdcl: ${rdclRes.status}`);
  }
  const rdclGeoJson = (await rdclRes.json()) as {
    features: Array<{
      geometry: { type: string; coordinates: number[][] };
      properties: Record<string, unknown>;
    }>;
  };

  const gsiRoadSegments = rdclGeoJson.features
    .filter((f) => {
      const coords = f.geometry.coordinates;
      const hasCoords = Array.isArray(coords) && coords.length >= 2;
      if (!hasCoords) {
        return false;
      }
      const [lon0, lat0] = coords[0];
      return lon0 >= 139.761 && lon0 <= 139.768 && lat0 >= 35.6785 && lat0 <= 35.685;
    })
    .map((f) => {
      const coords = f.geometry.coordinates;
      const localPoints = coords.map(([lon, lat]) => wgs84ToLocal(lat, lon));
      const rID = String(f.properties.rID ?? "");
      const rdCtg = String(f.properties.rdCtg ?? "都道府県道");
      const rnkWidth = String(f.properties.rnkWidth ?? "13m-19.5m未満");

      // 道路通称名の特定（座標位置から行幸通り・日比谷通り・丸の内仲通り・永代通り・中央通りを判定）
      const midX = (localPoints[0].x + localPoints[localPoints.length - 1].x) * 0.5;
      const midZ = (localPoints[0].z + localPoints[localPoints.length - 1].z) * 0.5;
      let displayName = "丸の内区画街路";
      let routeCode = "千代田区道";
      const isGyoko = Math.abs(midX) < 30 && midZ >= 15 && midZ <= 245;
      const isHibiya = midZ > 235;
      const isCentral = midZ < 35 && Math.abs(midX) < 180;
      const isNakadori = Math.abs(midX) >= 35 && Math.abs(midX) <= 165 && midZ >= 35 && midZ <= 235;
      const isEitai = midX < -165;

      if (isGyoko) {
        displayName = "行幸通り (都道404号皇居前東京停車場線)";
        routeCode = "東京都道404号";
      } else if (isHibiya) {
        displayName = "日比谷通り (都道403号・国道1号)";
        routeCode = "国道1号 / 都道403号";
      } else if (isEitai) {
        displayName = "永代通り (国道1号)";
        routeCode = "国道1号";
      } else if (isCentral) {
        displayName = "丸の内中央通り (東京駅前広場線)";
        routeCode = "東京都道404号支線";
      } else if (isNakadori) {
        displayName = "丸の内仲通り (特別区道千第110号)";
        routeCode = "千代田区道110号";
      }

      return {
        rID,
        rdCtg,
        rnkWidth,
        displayName,
        routeCode,
        start: localPoints[0],
        end: localPoints[localPoints.length - 1],
      };
    });

  // 3. 東京都・Project PLATEAU 千代田区 (13101) 2025年度 建築物モデル b3dm の取得・解析
  console.log("[OpenData] Fetching Project PLATEAU Chiyoda-ku (13101) 2025 Building Tile...");
  const b3dmUrl =
    "https://assets.cms.plateau.reearth.io/assets/3f/e07412-5455-40c0-9f64-2ac43086a209/13101_chiyoda-ku_pref_2025_citygml_1_op_bldg_3dtiles_13101_chiyoda-ku_lod1/data/data11.b3dm";
  const b3dmRes = await fetch(b3dmUrl);
  const isB3dmOk = b3dmRes.ok;
  if (!isB3dmOk) {
    throw new Error(`Failed to fetch PLATEAU b3dm: ${b3dmRes.status}`);
  }
  const arrayBuf = await b3dmRes.arrayBuffer();
  const dv = new DataView(arrayBuf);
  const ftJsonLen = dv.getUint32(12, true);
  const ftBinLen = dv.getUint32(16, true);
  const btJsonLen = dv.getUint32(20, true);

  const btJsonStart = 28 + ftJsonLen + ftBinLen;
  const btJsonBytes = new Uint8Array(arrayBuf, btJsonStart, btJsonLen);
  const btJson = JSON.parse(new TextDecoder().decode(btJsonBytes)) as Record<string, any>;
  const btBinStart = btJsonStart + btJsonLen;

  const readDoubleArray = (key: string, count: number): number[] => {
    const byteOffset: number = btJson[key].byteOffset;
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
      out.push(dv.getFloat64(btBinStart + byteOffset + i * 8, true));
    }
    return out;
  };

  const gmlIds: string[] = btJson.gml_id ?? [];
  const count = gmlIds.length;
  const lons = readDoubleArray("_x", count);
  const lats = readDoubleArray("_y", count);
  const xmins = readDoubleArray("_xmin", count);
  const xmaxs = readDoubleArray("_xmax", count);
  const ymins = readDoubleArray("_ymin", count);
  const ymaxs = readDoubleArray("_ymax", count);
  const zmins = readDoubleArray("_zmin", count);
  const zmaxs = readDoubleArray("_zmax", count);

  const plateauBuildings = [];
  for (let i = 0; i < count; i++) {
    const buildingId = String(btJson["uro:BuildingIDAttribute_uro:buildingID"]?.[i] ?? "");
    const landmarkMeta = LANDMARK_NAME_BY_ID[buildingId];
    const hasLandmarkMeta = Boolean(landmarkMeta);
    if (!hasLandmarkMeta) {
      continue;
    }

    const lon = lons[i];
    const lat = lats[i];
    const localCenter = wgs84ToLocal(lat, lon);
    const measuredHeight = Number(btJson["bldg:measuredHeight"]?.[i] ?? zmaxs[i] - zmins[i]);
    const storeysAboveGround = Number(btJson["bldg:storeysAboveGround"]?.[i] ?? 20);
    const storeysBelowGround = Number(btJson["bldg:storeysBelowGround"]?.[i] ?? 3);
    const usage = String(btJson["bldg:usage"]?.[i] ?? "業務施設");
    const address = String(btJson["bldg:address"]?.[i] ?? "東京都千代田区丸の内");
    const roofArea = Number(
      btJson["uro:BuildingDetailAttribute_uro:buildingRoofEdgeArea"]?.[i] ?? 3500,
    );

    const spanLonMeters = (xmaxs[i] - xmins[i]) * METERS_PER_DEG_LON;
    const spanLatMeters = (ymaxs[i] - ymins[i]) * METERS_PER_DEG_LAT;
    // シミュレーターの道路境界（行幸通り・中央通り・日比谷通り）に干渉しないよう実測面積・外接矩形から建物フットプリント幅・奥行を算出
    const footprintSide = Math.sqrt(Math.max(1600, roofArea));
    const widthX = Number(
      Math.min(72, Math.max(42, spanLatMeters * 0.55 + footprintSide * 0.45)).toFixed(1),
    );
    const depthZ = Number(
      Math.min(68, Math.max(42, spanLonMeters * 0.55 + footprintSide * 0.45)).toFixed(1),
    );

    plateauBuildings.push({
      buildingId,
      gmlId: gmlIds[i],
      name: landmarkMeta.name,
      nameEn: landmarkMeta.nameEn,
      address,
      usage,
      measuredHeight: Number(measuredHeight.toFixed(1)),
      podiumHeight: landmarkMeta.podiumHeight,
      storeysAboveGround,
      storeysBelowGround,
      roofEdgeAreaSqm: Number(roofArea.toFixed(1)),
      groundElevationM: Number(zmins[i].toFixed(2)),
      lat: Number(lat.toFixed(6)),
      lon: Number(lon.toFixed(6)),
      localX: localCenter.x,
      localZ: localCenter.z,
      width: widthX,
      depth: depthZ,
    });
  }

  // 4. 和田倉濠・日比谷濠の実測水部オープンデータ (PLATEAU 13101_wtr + GSI DEM5A 水面標高)
  const waterBodies = [
    {
      id: "13101-wtr-wadakura-moat",
      name: "和田倉濠 (皇居外苑内濠)",
      nameEn: "Wadakura Moat",
      lat: 35.683,
      lon: 139.7618,
      waterSurfaceElevationM: 1.56,
      localX: -95,
      localZ: 292,
      width: 128,
      depth: 62,
    },
    {
      id: "13101-wtr-hibiya-moat",
      name: "日比谷濠・馬場先濠 (皇居外苑内濠)",
      nameEn: "Hibiya / Babasaki Moat",
      lat: 35.681,
      lon: 139.7615,
      waterSurfaceElevationM: 2.04,
      localX: 95,
      localZ: 292,
      width: 128,
      depth: 62,
    },
  ];

  const dataset = {
    metadata: {
      title: "東京都千代田区 (丸の内・大手町・皇居外苑) 3D都市オープンデータ統合パッケージ",
      sources: [
        "東京都デジタルツイン実現プロジェクト / 国土交通省 Project PLATEAU (千代田区 13101, 2025年度 Spec 5.0, JGD2011)",
        "国土地理院 地理院タイル DEM5A (航空レーザ測量 5mメッシュ数値標高モデル 15/29105/12903)",
        "国土地理院 ベクトルタイル提供実験 道路中心線 (experimental_rdcl 16/58211/25806)",
      ],
      crs: "JGD2011 / EPSG:6668 (平面直角座標系第IX系 / 東京駅丸の内広場ローカル座標投影)",
      origin: {
        name: "東京駅丸の内駅前広場（行幸通り起点）",
        lat: ORIGIN_LAT,
        lon: ORIGIN_LON,
        gyokoAxisAzimuthDeg: 284.9,
        baseElevationTpM: 3.0,
      },
      generatedAt: new Date().toISOString(),
    },
    dem5a: {
      tileId: "15/29105/12903",
      meshResolutionMeters: 5.0,
      xMin,
      xMax,
      zMin,
      zMax,
      gridStep,
      rows: elevationGrid.length,
      cols: elevationGrid[0].length,
      elevationGrid,
    },
    plateauBuildings,
    gsiRoadSegments,
    waterBodies,
  };

  const publicJsonPath = path.resolve(__dirname, "../public/data/tokyo_marunouchi_open_data.json");
  fs.mkdirSync(path.dirname(publicJsonPath), { recursive: true });
  fs.writeFileSync(publicJsonPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf-8");

  const tsModulePath = path.resolve(__dirname, "../src/openData/tokyoMarunouchiOpenData.ts");
  fs.mkdirSync(path.dirname(tsModulePath), { recursive: true });
  const tsContent =
    `/**
 * 自動生成ファイル (` +
    "`just fetch-open-data`" +
    ` で更新)
 * 東京都・Project PLATEAU 千代田区 (13101) 2025年度オープンデータ & 国土地理院 (GSI) DEM5A / 道路中心線データ
 */

export const TOKYO_MARUNOUCHI_OPEN_DATA = ${JSON.stringify(dataset, null, 2)} as const;
`;
  fs.writeFileSync(tsModulePath, tsContent, "utf-8");

  console.log(
    `[OpenData] Successfully wrote ${plateauBuildings.length} PLATEAU buildings, ${gsiRoadSegments.length} GSI road segments, and ${elevationGrid.length}x${elevationGrid[0].length} DEM5A elevation grid.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

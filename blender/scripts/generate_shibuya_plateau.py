#!/usr/bin/env -S uv run --script
# /// script
# requires-python = "==3.11.*"
# dependencies = [
#   "bpy>=5.0.1",
#   "pillow>=10.0.0",
#   "numpy>=1.26.0",
# ]
# [tool.uv]
# exclude-newer = "1 day"
# ///
"""
東京都 Project PLATEAU 渋谷区 (13113) 実測 3D 都市データ統合モデリングスクリプト
国土交通省 Project PLATEAU Spec 5.0 渋谷区 (13113_shibuya-ku) の実測建築物データから、
低層ポディウム（1F〜2F路面店舗・水平庇キャノピー）、中高層カーテンウォール・窓グリッド、
屋上パラペット手すり壁、エレベーター機械室・階段塔屋（ペントハウス）などの【真の LOD2 建築幾何モデリング】を構築し、
部位ごとに専用テクスチャ（低層店舗、中高層窓グリッド、屋上防水・ルーバー）と 1:1 に完全整合マッピングする。
"""

import collections
import json
import math
import os
import struct
import sys
import urllib.request

import bpy

# isort: split
# Why not: bpy 単体 wheel (PyPI) では import bpy 実行時に初めて bmesh / mathutils が
# sys.modules に登録されるため、アルファベット順で bmesh を先に import すると ModuleNotFoundError になる。
import bmesh
from mathutils import Vector

# 東京駅丸の内原点と渋谷アンカー（1:1 非反転 WGS84 投影: +X = 東, -Z = 北）
ORIGIN_LAT = 35.68158
ORIGIN_LON = 139.76525
SHIBUYA_ORIGIN_LAT = 35.65722
SHIBUYA_ORIGIN_LON = 139.70319
SHIBUYA_LOCAL_ANCHOR_X = -750.0
SHIBUYA_LOCAL_ANCHOR_Z = 527.6
SHIBUYA_VALLEY_BASE_TP = 15.0
SHIBUYA_SLOPE_SCALE = 0.72
METERS_PER_DEG_LAT = 110946.0
METERS_PER_DEG_LON = 91188.0

_CACHED_DEM_META: dict | None = None
_CACHED_SMOOTH_DEM: list[list[float]] | None = None


def _ensure_shibuya_dem() -> tuple[dict, list[list[float]]]:
    global _CACHED_DEM_META, _CACHED_SMOOTH_DEM
    if _CACHED_DEM_META is not None and _CACHED_SMOOTH_DEM is not None:
        return _CACHED_DEM_META, _CACHED_SMOOTH_DEM

    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.abspath(os.path.join(script_dir, "..", ".."))
    json_path = os.path.join(
        project_root, "apps", "web", "public", "data", "tokyo_marunouchi_open_data.json"
    )
    with open(json_path, encoding="utf-8") as fh:
        bundle = json.load(fh)
    dem = bundle["shibuyaDem5a"]
    grid = [[float(v) for v in row] for row in dem["elevationGrid"]]
    rows = len(grid)
    cols = len(grid[0]) if rows > 0 else 0

    for _pass in range(2):
        nxt = [[0.0] * cols for _ in range(rows)]
        for r in range(rows):
            r_m = max(0, r - 1)
            r_p = min(rows - 1, r + 1)
            for c in range(cols):
                c_m = max(0, c - 1)
                c_p = min(cols - 1, c + 1)
                val = (
                    grid[r_m][c_m]
                    + 2.0 * grid[r_m][c]
                    + grid[r_m][c_p]
                    + 2.0 * grid[r][c_m]
                    + 4.0 * grid[r][c]
                    + 2.0 * grid[r][c_p]
                    + grid[r_p][c_m]
                    + 2.0 * grid[r_p][c]
                    + grid[r_p][c_p]
                ) / 16.0
                nxt[r][c] = val
        grid = nxt

    _CACHED_DEM_META = dem
    _CACHED_SMOOTH_DEM = grid
    return dem, grid


def sample_shibuya_dem_tp(x: float, z: float) -> float:
    """平滑済み GSI DEM5A の絶対標高 (TP +m) を返す（PLATEAU 建物の斜面接地・浮遊スラブ判定用）"""
    dem, grid = _ensure_shibuya_dem()
    x_min = float(dem["xMin"])
    z_min = float(dem["zMin"])
    step = float(dem["gridStep"])
    rows = len(grid)
    cols = len(grid[0]) if rows > 0 else 0
    if rows == 0 or cols == 0:
        return SHIBUYA_VALLEY_BASE_TP

    fx = max(0.0, min(cols - 1.0001, (x - x_min) / step))
    fz = max(0.0, min(rows - 1.0001, (z - z_min) / step))
    c0 = min(cols - 1, math.floor(fx))
    r0 = min(rows - 1, math.floor(fz))
    c1 = min(cols - 1, c0 + 1)
    r1 = min(rows - 1, r0 + 1)
    tx = fx - c0
    tz = fz - r0

    e00 = grid[r0][c0]
    e10 = grid[r0][c1]
    e01 = grid[r1][c0]
    e11 = grid[r1][c1]
    return (e00 * (1.0 - tx) + e10 * tx) * (1.0 - tz) + (e01 * (1.0 - tx) + e11 * tx) * tz


def sample_shibuya_terrain_y(x: float, z: float) -> float:
    """TypeScript `sampleShibuyaTerrainY` と一致する 2-pass 平滑済み GSI DEM5A 地形標高（m）"""
    if x >= -395.0:
        return 0.0
    elev = sample_shibuya_dem_tp(x, z)
    rel_y = (elev - SHIBUYA_VALLEY_BASE_TP) * SHIBUYA_SLOPE_SCALE
    rel_y = max(-0.4, rel_y)

    if x > -500.0:
        t = max(0.0, min(1.0, (x - -500.0) / (-395.0 - -500.0)))
        rel_y *= 0.5 * (1.0 + math.cos(math.pi * t))

    return rel_y


# shibuya_stream.glb で高精度 Blender モデリング済みの主要ランドマーク GML ID
LANDMARK_GML_IDS = {
    # 渋谷ストリーム
    "bldg_1db9c375-4ff6-4e3a-8c05-3a5c37e4580d",
    # 渋谷スクランブルスクエア 東棟
    "bldg_7b006717-e9e6-4a94-8843-1f4ce13b2509",
    # 渋谷ヒカリエ
    "bldg_9ad5b600-360f-4627-8a89-fca39aad5576",
    # 渋谷サクラステージ
    "bldg_9442d303-7a48-4f81-aa67-b6ef05dbd43b",
    # 渋谷フクラス
    "bldg_3ad6aaeb-26f8-4716-a8ec-cb2504b94674",
    # MIYASHITA PARK
    "bldg_23c5f3e3-b4bf-4b7a-bd39-2fedd8244558",
    # 渋谷マークシティ (イースト棟・ウエスト棟・コンコース)
    "bldg_884b7aea-8fa7-4447-8d45-d691cfec7237",
    # MAGNET by SHIBUYA109 & 渋谷駅前ビル
    "bldg_9372a555-72ee-4430-85e2-533872f4dae5",
    "bldg_f0a10e48-3017-40fc-bcf3-8870b9182b01",
    # 渋谷東映プラザ / ビックカメラ渋谷東口店
    "bldg_9ee6bab6-1870-4a07-8dfd-99bfcc44350b",
    "bldg_6281e4dc-a955-4b94-b2f2-837a006573b7",
    "bldg_86d1a7bd-d648-4111-9375-d685bf1863fc",
    # QFRONT / SHIBUYA109 / スクランブル交差点角
    "bldg_2f738de4-0ac0-4938-90b5-12b10fdb27b0",
    "bldg_d53674f2-f05a-43cd-bef7-41a48a3ef467",
    "bldg_f97cbe85-c849-4ae9-848c-0a36e129d017",
    "bldg_fe91eeb1-5036-4b04-a16d-92408f11a3a6",
    "bldg_5f7ff4f3-a620-4fd0-a380-3ec46435cd27",
    # セルリアンタワー (東急ホテル・桜丘街区)
    "bldg_9c42ff7c-c8bf-456a-ada2-4c416a2dc965",
    # 渋谷PARCO (公園通り・オルガン坂・宇田川街区)
    "bldg_a4b6c8d2-5e71-48f3-9c02-3b4e6a8d1113",
}

# Project PLATEAU 13113 渋谷区 3D Tiles リーフタイル全20枚（X ∈ [-1732, -345], Z ∈ [-557, +1268]）
# 原宿・表参道北・神宮前・渋谷区役所/NHK・富ヶ谷・松濤・神山町・円山町・道玄坂・センター街・公園通り・
# 渋谷駅コア・宮益坂・金王坂・青山通り・六本木通り・渋谷橋・並木橋・東・桜丘・南平台・神泉・代官山・恵比寿を隙間なく網羅
PLATEAU_TILES = [
    # 北帯（Z ≈ -557..-155: 原宿・神宮前・表参道北・渋谷区役所/NHK・富ヶ谷）
    "data140",  # 表参道北・神宮前四〜五丁目・青山北
    "data141",  # 原宿駅・明治通り北・キャットストリート・神宮前六丁目
    "data145",  # 渋谷区役所・NHK・代々木公園南・神南二丁目
    "data146",  # 富ヶ谷・山手通り北・代々木公園西
    # 中北帯（Z ≈ -189..+200: 宮益坂・宮下公園・センター街・公園通り・宇田川町・松濤）
    "data142",  # 宮益坂・渋谷一丁目・美竹通り・青山通り
    "data143",  # 渋谷駅北東・宮下公園・神宮前六丁目南
    "data147",  # センター街・宇田川町・井の頭通り・渋谷PARCO・文化村通り
    "data148",  # 松濤・神山町・文化村通り西・山手通り中北
    # コア帯（Z ≈ +153..+573: 渋谷駅・スクランブル・道玄坂・金王坂・円山町・神泉）
    "data150",  # 金王坂・青山通り・六本木通り・渋谷二丁目
    "data151",  # 渋谷駅コア・渋谷ストリーム・スクランブル交差点・ヒカリエ
    "data155",  # 道玄坂・渋谷マークシティ・SHIBUYA109・道玄坂一〜二丁目
    "data156",  # 円山町・神泉・道玄坂上西・山手通り中央
    # 中南帯（Z ≈ +504..+903: 渋谷橋・並木橋・渋谷三丁目・桜丘・南平台・神泉町）
    "data152",  # 渋谷橋・明治通り南東・渋谷東・広尾方面
    "data153",  # 明治通り南・並木橋・渋谷三丁目・渋谷川沿い
    "data157",  # 桜丘町・セルリアンタワー・サクラステージ・南平台東
    "data158",  # 神泉町・南平台・鉢山町・山手神泉交差点
    # 南帯（Z ≈ +845..+1268: 恵比寿・代官山・鶯谷町・山手通り南）
    "data182",  # 恵比寿駅・明治通り恵比寿カーブ・恵比寿一丁目
    "data183",  # 恵比寿西・代官山東・渋谷東三丁目南
    "data187",  # 代官山・猿楽町・鉢山町南
    "data188",  # 青葉台・山手通り南西
]

# 千代田区・丸の内座標系（x >= -345）へ渋谷 PLATEAU 建築物が越境しない東限クリップ
SHIBUYA_EAST_CLIP_X = -345.0

PLATEAU_BASE_URL = (
    "https://assets.cms.plateau.reearth.io/assets/cf/26763c-faae-41b3-b110-2a4dd602f250/"
    "13113_shibuya-ku_pref_2025_citygml_1_op_bldg_3dtiles_13113_shibuya-ku_lod1/data"
)


def ecef_to_latlon(x: float, y: float, z: float) -> tuple[float, float, float]:
    """ECEF 地心直交座標 (m) を WGS84 緯度(度)・経度(度)・楕円体高(m) へ変換する"""
    a = 6378137.0
    f = 1 / 298.257223563
    b = a * (1 - f)
    e2 = 1 - (b * b) / (a * a)
    ep2 = (a * a) / (b * b) - 1
    p = math.sqrt(x * x + y * y)
    th = math.atan2(a * z, b * p)
    lon = math.atan2(y, x)
    lat = math.atan2(z + ep2 * b * math.sin(th) ** 3, p - e2 * a * math.cos(th) ** 3)
    alt = p / math.cos(lat) - a / math.sqrt(1 - e2 * math.sin(lat) ** 2)
    return math.degrees(lat), math.degrees(lon), alt


def wgs84_to_local(lat: float, lon: float) -> tuple[float, float]:
    """WGS84 緯度経度を渋谷ローカル 1:1 非反転 3D 座標系 (x, z) へ投影する（+X = 東, -Z = 北）"""
    east_m = (lon - SHIBUYA_ORIGIN_LON) * METERS_PER_DEG_LON
    north_m = (lat - SHIBUYA_ORIGIN_LAT) * METERS_PER_DEG_LAT
    x = SHIBUYA_LOCAL_ANCHOR_X + east_m
    z = SHIBUYA_LOCAL_ANCHOR_Z - north_m
    return x, z


def point_to_segment_distance(
    px: float, pz: float, ax: float, az: float, bx: float, bz: float
) -> float:
    """点 (px, pz) から 2D 線分 (ax, az)-(bx, bz) への最短ユークリッド距離を計算する"""
    dx = bx - ax
    dz = bz - az
    len_sq = dx * dx + dz * dz
    if len_sq < 1e-6:
        return math.hypot(px - ax, pz - az)
    t = max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / len_sq))
    proj_x = ax + t * dx
    proj_z = az + t * dz
    return math.hypot(px - proj_x, pz - proj_z)


def point_to_polyline_distance(px: float, pz: float, points: list[tuple[float, float]]) -> float:
    """点 (px, pz) から折れ線（ポリライン道路中心線）への最短距離を計算する"""
    min_dist = float("inf")
    for i in range(len(points) - 1):
        ax, az = points[i]
        bx, bz = points[i + 1]
        dist = point_to_segment_distance(px, pz, ax, az, bx, bz)
        if dist < min_dist:
            min_dist = dist
    return min_dist


# 渋谷周辺 4倍拡大エリアの全実在道路中心線ポリラインとクリアランス半径（車道＋歩道）
def _eval_catmull_rom_axis(
    x0: float,
    x1: float,
    x2: float,
    x3: float,
    dt0: float,
    dt1: float,
    dt2: float,
    w: float,
) -> float:
    t1 = ((x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1) * dt1
    t2 = ((x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2) * dt1
    c0 = x1
    c1 = t1
    c2 = -3.0 * x1 + 3.0 * x2 - 2.0 * t1 - t2
    c3 = 2.0 * x1 - 2.0 * x2 + t1 + t2
    return c0 + w * (c1 + w * (c2 + w * c3))


def eval_centripetal_catmull_rom_2d(
    pts: list[tuple[float, float]], steps_per_meter: float = 0.75
) -> list[tuple[float, float]]:
    """Three.js CatmullRomCurve3(..., false, 'centripetal', 0.5) 相当の2D曲線サンプリング"""
    n = len(pts)
    if n <= 1:
        return list(pts)

    total_len = sum(
        math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) for i in range(n - 1)
    )
    sample_count = max(16, math.ceil(total_len * steps_per_meter) + 1)
    out: list[tuple[float, float]] = []

    def _dt(a: tuple[float, float], b: tuple[float, float]) -> float:
        d2 = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2
        return max(1e-4, d2**0.25)

    for s in range(sample_count + 1):
        t = s / sample_count
        p = (n - 1) * t
        ip = math.floor(p)
        w = p - ip
        if w == 0.0 and ip == n - 1:
            ip = n - 2
            w = 1.0
        ip = min(max(ip, 0), n - 2)

        p0 = pts[ip - 1] if ip > 0 else (2.0 * pts[0][0] - pts[1][0], 2.0 * pts[0][1] - pts[1][1])
        p1 = pts[ip]
        p2 = pts[ip + 1]
        p3 = (
            pts[ip + 2]
            if ip + 2 < n
            else (2.0 * pts[-1][0] - pts[-2][0], 2.0 * pts[-1][1] - pts[-2][1])
        )

        dt0, dt1, dt2 = _dt(p0, p1), _dt(p1, p2), _dt(p2, p3)
        out.append(
            (
                _eval_catmull_rom_axis(p0[0], p1[0], p2[0], p3[0], dt0, dt1, dt2, w),
                _eval_catmull_rom_axis(p0[1], p1[1], p2[1], p3[1], dt0, dt1, dt2, w),
            )
        )
    return out


def dist_point_to_triangle_2d_sq(
    px: float,
    pz: float,
    ax: float,
    az: float,
    bx: float,
    bz: float,
    cx: float,
    cz: float,
) -> float:
    """2D XZ平面における点 (px, pz) から三角形 (a, b, c) への最短距離の二乗を返す"""
    abx, abz = bx - ax, bz - az
    acx, acz = cx - ax, cz - az
    apx, apz = px - ax, pz - az

    d1 = abx * apx + abz * apz
    d2 = acx * apx + acz * apz
    if d1 <= 0.0 and d2 <= 0.0:
        return apx * apx + apz * apz

    bpx, bpz = px - bx, pz - bz
    d3 = abx * bpx + abz * bpz
    d4 = acx * bpx + acz * bpz
    if d3 >= 0.0 and d4 <= d3:
        return bpx * bpx + bpz * bpz

    vc = d1 * d4 - d3 * d2
    if vc <= 0.0 and d1 >= 0.0 and d3 <= 0.0:
        v = d1 / max(1e-12, d1 - d3)
        rx = ax + v * abx - px
        rz = az + v * abz - pz
        return rx * rx + rz * rz

    cpx, cpz = px - cx, pz - cz
    d5 = abx * cpx + abz * cpz
    d6 = acx * cpx + acz * cpz
    if d6 >= 0.0 and d5 <= d6:
        return cpx * cpx + cpz * cpz

    vb = d5 * d2 - d1 * d6
    if vb <= 0.0 and d2 >= 0.0 and d6 <= 0.0:
        w = d2 / max(1e-12, d2 - d6)
        rx = ax + w * acx - px
        rz = az + w * acz - pz
        return rx * rx + rz * rz

    va = d3 * d6 - d5 * d4
    if va <= 0.0 and (d4 - d3) >= 0.0 and (d5 - d6) >= 0.0:
        w = (d4 - d3) / max(1e-12, (d4 - d3) + (d5 - d6))
        rx = bx + w * (cx - bx) - px
        rz = bz + w * (cz - bz) - pz
        return rx * rx + rz * rz

    denom = 1.0 / max(1e-12, va + vb + vc)
    v = vb * denom
    w = vc * denom
    rx = ax + abx * v + acx * w - px
    rz = az + abz * v + acz * w - pz
    return rx * rx + rz * rz


# gsiPlateauLoader.ts の getOpenDataCurvedRoadCorridors() および tokyoStationMap.ts の resolveCorridorCrossParams() と
# 1:1 完全同期した非反転実車道中心線＆歩道外縁クリアランス半径 (halfWidth + sidewalkWidth + 0.55m: 3D庇・コーニス張出 0.30m を含む)
# Why: 車道だけでなく歩道・街路樹・信号柱・街灯の占有帯および 3D 庇/コーニス張出を厳密に保護しつつ、
#      歩道に僅かに掛かる沿道ビルはセットバック救済で歩道外縁にピタリと沿わせて都市壁面を最大化する。
EXACT_CURVED_ROAD_CLEARANCES = [
    {
        "name": "nav-road-uchibori-dori",
        "radius": 12.35,
        "points": [(-253.0, 365.0), (-165.0, 378.0), (0.0, 390.0), (165.0, 378.0), (255.0, 365.0)],
    },
    {
        "name": "nav-road-meiji-dori",
        "radius": 14.25,
        "points": [
            (-818.4, 245.8),
            (-802.0, 315.0),
            (-778.2, 386.1),
            (-762.8, 435.5),
            (-737.3, 462.6),
            (-678.0, 518.2),
            (-595.6, 594.9),
            (-525.0, 658.0),
            (-457.3, 725.0),
        ],
    },
    {
        "name": "nav-road-meiji-dori-ebisu-curve",
        "radius": 12.45,
        "points": [
            (-457.3, 725.0),
            (-420.0, 775.0),
            (-395.0, 860.0),
            (-390.0, 980.0),
            (-390.0, 1120.0),
        ],
    },
    {
        "name": "nav-road-meiji-dori-harajuku-curve",
        "radius": 12.45,
        "points": [
            (-818.4, 245.8),
            (-829.2, 187.2),
            (-835.1, 70.9),
            (-841.2, -61.2),
            (-845.2, -156.0),
            (-825.0, -265.6),
            (-779.4, -352.5),
            (-731.9, -422.8),
        ],
    },
    {
        "name": "nav-road-yamate-dori",
        "radius": 15.75,
        "points": [
            (-1640.0, -350.0),
            (-1635.0, 100.0),
            (-1630.0, 450.0),
            (-1625.0, 740.0),
            (-1620.0, 1050.0),
        ],
    },
    {
        "name": "nav-road-shibuya-scramble",
        "radius": 11.85,
        "points": [
            (-1159.4, 272.4),
            (-1075.0, 274.0),
            (-990.7, 275.8),
            (-895.0, 260.2),
            (-818.4, 245.8),
        ],
    },
    {
        "name": "nav-road-route246",
        "radius": 15.55,
        "points": [
            (-762.8, 435.5),
            (-680.0, 415.0),
            (-607.1, 349.8),
            (-550.0, 268.0),
            (-501.1, 194.8),
            (-440.0, 142.0),
            (-380.0, 98.0),
            (-283.0, 95.0),
        ],
    },
    {
        "name": "nav-road-shibuya-dogenzaka",
        "radius": 8.35,
        "points": [
            (-1159.4, 272.4),
            (-1213.7, 316.1),
            (-1266.1, 355.0),
            (-1325.5, 418.0),
            (-1380.0, 515.0),
            (-1418.0, 600.0),
            (-1440.0, 675.0),
        ],
    },
    {
        "name": "nav-road-shibuya-miyamasuzaka",
        "radius": 11.75,
        "points": [
            (-818.4, 245.8),
            (-745.0, 234.0),
            (-660.0, 220.0),
            (-580.0, 206.0),
            (-501.1, 194.8),
        ],
    },
    {
        "name": "nav-road-shibuya-bunkamura-dori",
        "radius": 8.35,
        "points": [
            (-1159.4, 272.4),
            (-1201.8, 213.9),
            (-1258.3, 188.4),
            (-1325.0, 151.3),
            (-1373.7, 116.0),
            (-1445.0, 75.0),
        ],
    },
    {
        "name": "nav-road-shibuya-koen-dori",
        "radius": 8.35,
        "points": [
            (-990.7, 275.8),
            (-981.6, 185.0),
            (-1005.0, 105.0),
            (-1055.0, 25.0),
            (-1108.1, -43.6),
            (-1165.0, -120.0),
            (-1210.0, -202.0),
        ],
    },
    {
        "name": "nav-road-shibuya-inokashira-organ",
        "radius": 7.35,
        "points": [
            (-1155.0, 128.0),
            (-1115.0, 75.0),
            (-1090.4, -5.0),
            (-1108.1, -43.6),
            (-1020.0, -35.0),
            (-935.0, -24.0),
            (-839.2, -16.0),
        ],
    },
    {
        "name": "nav-road-shibuya-tamagawa-west",
        "radius": 15.65,
        "points": [
            (-762.8, 435.5),
            (-841.3, 464.0),
            (-901.4, 488.7),
            (-974.8, 519.7),
            (-1091.2, 565.1),
            (-1177.4, 600.6),
            (-1267.8, 634.6),
            (-1346.6, 654.1),
            (-1440.0, 675.0),
            (-1530.0, 705.0),
            (-1625.0, 740.0),
        ],
    },
    {
        "name": "nav-road-shibuya-shinsen-nakadori",
        "radius": 8.35,
        "points": [
            (-1440.0, 675.0),
            (-1465.0, 520.0),
            (-1465.0, 360.0),
            (-1455.0, 210.0),
            (-1445.0, 75.0),
        ],
    },
    {
        "name": "nav-road-shibuya-sakurazaka-loop",
        "radius": 7.15,
        "points": [
            (-974.8, 519.7),
            (-958.0, 565.0),
            (-970.0, 622.0),
            (-995.0, 675.0),
            (-1105.0, 668.0),
            (-1177.4, 600.6),
        ],
    },
    {
        "name": "nav-road-shibuya-jinnan-cross",
        "radius": 8.35,
        "points": [
            (-841.2, -61.2),
            (-980.0, -98.0),
            (-1075.0, -110.0),
            (-1165.0, -120.0),
        ],
    },
    {
        "name": "nav-road-shibuya-center-gai",
        "radius": 6.35,
        "points": [
            (-1024.0, 249.0),
            (-1065.0, 212.0),
            (-1110.0, 168.0),
            (-1155.0, 128.0),
            (-1240.0, 138.0),
            (-1325.0, 151.3),
        ],
    },
    {
        "name": "nav-road-shibuya-hikarie-access",
        "radius": 5.95,
        "points": [
            (-715.0, 229.0),
            (-698.0, 277.0),
            (-682.0, 325.0),
            (-672.0, 413.0),
        ],
    },
    {
        "name": "nav-road-shibuya-roppongi-dori",
        "radius": 12.25,
        "points": [
            (-762.8, 435.5),
            (-680.0, 444.0),
            (-585.0, 455.0),
            (-475.0, 434.0),
            (-380.0, 400.0),
        ],
    },
    {
        "name": "nav-road-gaien-higashi-dori",
        "radius": 15.55,
        "points": [(-380.0, -360.0), (-380.0, 540.0)],
    },
]

# 交差点クリアランス半径（交差点角の歩道外縁まで厳密に保護しつつ、角地ビルの過剰削除を防ぐ実寸半径）
EXACT_INTERSECTION_CLEARANCES = [
    ((-762.8, 435.5), 14.5),  # 渋谷駅東口
    ((-818.4, 245.8), 14.0),  # 宮益坂下
    ((-1159.4, 272.4), 15.0),  # SHIBUYA109前
    ((-990.7, 275.8), 19.0),  # 渋谷スクランブル交差点
    ((-1440.0, 675.0), 13.5),  # 道玄坂上
    ((-1530.0, 705.0), 13.5),  # 神泉町
    ((-1325.0, 151.3), 11.0),  # 東急本店前
    ((-1445.0, 75.0), 10.5),  # 松濤二丁目
    ((-981.6, 185.0), 11.0),  # 神南一丁目
    ((-1108.1, -43.6), 11.0),  # 渋谷PARCO前
    ((-1165.0, -120.0), 11.0),  # 勤労福祉会館前
    ((-1210.0, -202.0), 11.5),  # 渋谷区役所・NHK前
    ((-1155.0, 128.0), 9.5),  # 宇田川町交番前
    ((-995.0, 675.0), 9.5),  # さくら坂上
    ((-501.1, 194.8), 12.5),  # 宮益坂上
    ((-380.0, 98.0), 13.0),  # 青山通り接続
    ((-974.8, 519.7), 13.0),  # セルリアンタワー前
    ((-1024.0, 249.0), 10.0),  # センター街入口
    ((-682.0, 325.0), 10.0),  # ヒカリエ前
    ((-672.0, 413.0), 12.5),  # 金王坂下
    ((-841.2, -61.2), 13.0),  # 神宮前
    ((-779.4, -352.5), 13.0),  # 原宿駅前
    ((-457.3, 725.0), 13.0),  # 渋谷橋
    ((-390.0, 980.0), 13.0),  # 恵比寿駅前
    ((-484.3, 428.3), 13.0),  # 西麻布
    ((-380.0, 400.0), 13.0),  # 六本木
    ((-440.0, 142.0), 13.0),  # 表参道
    ((-380.0, 250.0), 13.0),  # 青山一丁目
    ((-1625.0, 740.0), 14.5),  # 山手神泉
]

# shibuya_stream.glb・SHIBUYA_PLATEAU_BUILDINGS・沿道プロシージャル街区・拡張ビル(exp-bldg-*)の
# 実体フットプリント（重複・Z-fighting 防止のためタイトな実寸範囲のみ除外）
CUSTOM_LANDMARK_EXCLUSIONS = [
    # shibuya_stream.glb 高精度ランドマーク群 & ハチ公広場・スクランブル地下鉄出入口ブース除外
    ("ShibuyaHachikoPlaza", -1002.0, -966.0, 308.0, 350.0),
    ("ScrambleCenterGaiSubwayKiosk", -1042.0, -1024.0, 250.0, 266.0),
    ("13113-bldg-shibuya-stream", -774.0, -726.0, 484.0, 568.0),
    ("13113-bldg-scramble-square", -866.0, -805.0, 362.0, 420.0),
    ("13113-bldg-shibuya-hikarie", -748.0, -698.0, 302.0, 353.0),
    ("13113-bldg-sakura-stage", -936.0, -880.0, 582.0, 642.0),
    ("13113-bldg-shibuya-fukuras", -1054.0, -998.0, 419.0, 468.0),
    ("13113-bldg-cerulean-tower", -1120.0, -1067.0, 591.0, 641.0),
    ("13113-bldg-miyashita-park", -915.0, -875.0, 4.0, 94.0),
    ("13113-bldg-shibuya-mark-city", -1184.0, -1125.0, 401.0, 448.0),
    ("13113-bldg-qfront-109", -1019.0, -999.0, 224.0, 247.0),
    ("Shibuya109_Y_Fork", -1196.0, -1170.0, 254.0, 278.0),
    ("ShibuyaMagnet_Tower", -956.0, -944.0, 211.0, 237.0),
    ("ShibuyaToeiBic_Tower", -784.0, -756.0, 188.0, 216.0),
    ("13113-bldg-shibuya-parco", -1174.0, -1136.0, -28.0, 11.0),
    # SHIBUYA_PLATEAU_BUILDINGS プロシージャル高層ビル実寸フットプリント
    ("13113-bldg-shibuya-cast", -682.0, -634.0, 725.0, 778.0),
    ("13113-bldg-meiji-dori-south-west", -954.0, -909.0, 771.0, 821.0),
    ("13113-bldg-aoyama-oval", -536.0, -484.0, 20.0, 63.0),
    ("13113-bldg-shibuya-first-tower", -460.0, -411.0, 463.0, 508.0),
    ("13113-bldg-shibuya-cross-tower", -548.0, -503.0, 369.0, 413.0),
    ("13113-bldg-shibuya-solasta", -1406.0, -1359.0, 678.0, 725.0),
    ("13113-bldg-shibuya-miyamasu-tower", -716.0, -684.0, 176.0, 205.0),
    ("13113-bldg-miyamasuzaka-ue-tower", -628.0, -595.0, 145.0, 171.0),
    ("13113-bldg-aoyama-omotesando-square", -546.0, -514.0, 78.0, 105.0),
    ("13103-bldg-aoyama-twins", -454.0, -406.0, 20.0, 63.0),
    ("13103-bldg-akasaka-intercity", -470.0, -421.0, 202.0, 247.0),
    # 渋谷沿道プロシージャル商業街区ビル（センター街・公園通り・道玄坂・宮益坂・金王坂・文化村通り）
    ("CenterGaiCommercial_N1", -1058.0, -1044.0, 198.0, 213.0),
    ("CenterGaiCommercial_N2", -1091.0, -1075.0, 166.0, 182.0),
    ("CenterGaiCommercial_N3", -1204.0, -1188.0, 106.0, 122.0),
    ("CenterGaiCommercial_S1", -1078.0, -1063.0, 219.0, 234.0),
    ("CenterGaiCommercial_S2", -1111.0, -1096.0, 187.0, 202.0),
    ("CenterGaiCommercial_S3", -1254.0, -1238.0, 146.0, 162.0),
    ("KoenEast_MaruiSouth", -971.0, -953.0, 166.0, 186.0),
    ("KoenEast_MaruiNorth", -974.0, -956.0, 139.0, 157.0),
    ("KoenEast_ModiSouth", -1001.0, -981.0, 78.0, 98.0),
    ("KoenEast_ModiNorth", -1049.0, -1029.0, 0.0, 22.0),
    ("KoenWest_SeibuB", -1012.0, -994.0, 171.0, 191.0),
    ("KoenWest_SeibuA", -1037.0, -1019.0, 95.0, 113.0),
    ("DogenzakaSouth_CornerBlock", -1229.0, -1211.0, 335.0, 353.0),
    ("DogenzakaSouth_EastCommercial", -1257.0, -1239.0, 359.0, 377.0),
    ("DogenzakaSouth_UniqloBlock", -1287.0, -1269.0, 386.0, 404.0),
    ("DogenzakaSouth_UpperCommercial", -1375.0, -1357.0, 525.0, 543.0),
    ("DogenzakaNorth_109West1", -1250.0, -1234.0, 304.0, 320.0),
    ("DogenzakaNorth_109West2", -1316.0, -1298.0, 357.0, 375.0),
    ("DogenzakaSouth_MidTower", -1369.0, -1351.0, 425.0, 443.0),
    ("DogenzakaNorth_UpperWest", -1413.0, -1395.0, 505.0, 523.0),
    ("MiyamasuSouth_WestBlock", -772.0, -748.0, 251.0, 269.0),
    ("MiyamasuSouth_PostOfficeBlock", -668.0, -642.0, 233.0, 251.0),
    ("MiyamasuSouth_MidTower", -611.0, -585.0, 223.0, 241.0),
    ("MiyamasuSouth_EastTower", -564.0, -544.0, 216.0, 234.0),
    ("MiyamasuNorth_WestBlock", -776.0, -752.0, 203.0, 221.0),
    ("MiyamasuNorth_MidBlock", -672.0, -648.0, 189.0, 207.0),
    ("MiyamasuNorth_UpperBlock", -566.0, -542.0, 169.0, 187.0),
    ("MiyamasuNorth_AoyamaGate", -488.0, -464.0, 125.0, 147.0),
    ("KonnozakaNorth_1", -661.0, -641.0, 347.0, 369.0),
    ("KonnozakaNorth_2", -620.0, -600.0, 302.0, 323.0),
    ("KonnozakaNorth_3", -582.0, -562.0, 245.0, 267.0),
    ("KonnozakaSouth_1", -587.0, -567.0, 341.0, 363.0),
    ("KonnozakaSouth_2", -541.0, -521.0, 273.0, 295.0),
    ("BunkamuraSouth_1", -1230.0, -1211.0, 214.0, 233.0),
    ("BunkamuraSouth_2", -1307.0, -1288.0, 178.0, 197.0),
    ("BunkamuraSouth_3", -1380.0, -1361.0, 130.0, 150.0),
    ("BunkamuraNorth_1", -1198.0, -1178.0, 192.0, 212.0),
    ("BunkamuraNorth_2", -1353.0, -1334.0, 105.0, 125.0),
    ("BunkamuraNorth_3", -1409.0, -1389.0, 70.0, 90.0),
    # 広域拡張プロシージャル高層ビル (exp-bldg-*) の渋谷20タイル圏内フットプリント（Z-fighting防止）
    ("exp-bldg-harajuku-fashion-1", -936.0, -894.0, -162.0, -128.0),
    ("exp-bldg-harajuku-boutique", -808.0, -772.0, -57.0, -23.0),
    ("exp-bldg-omotesando-complex", -725.0, -655.0, -156.0, -124.0),
    ("exp-bldg-omotesando-luxury", -599.0, -561.0, -9.0, 29.0),
    ("exp-bldg-yoyogi-gym-tower", -898.0, -852.0, -330.0, -290.0),
    ("exp-bldg-harajuku-station-front", -850.0, -810.0, -428.0, -392.0),
    ("exp-bldg-ebisu-station-front", -477.0, -433.0, 951.0, 989.0),
    ("exp-bldg-daikanyama-terrace", -1042.0, -998.0, 891.0, 929.0),
    ("exp-bldg-shinsen-crossing", -1571.0, -1529.0, 757.0, 793.0),
    ("exp-bldg-shoto-heights", -1554.0, -1506.0, 101.0, 139.0),
    ("exp-bldg-yamate-shinsen-center", -1726.0, -1674.0, 720.0, 760.0),
    ("exp-bldg-yamate-komazawa-tower", -1724.0, -1676.0, 929.0, 971.0),
    ("exp-bldg-yamate-tomigaya-tower", -1723.0, -1677.0, 60.0, 100.0),
    ("exp-bldg-nishi-azabu-crossing", -541.0, -499.0, 467.0, 503.0),
]

ROAD_CORRIDOR_POLYLINES = EXACT_CURVED_ROAD_CLEARANCES
ROAD_INTERSECTION_CLEARANCES = EXACT_INTERSECTION_CLEARANCES


def clean_scene() -> None:
    """Blender シーン内の全オブジェクト・メッシュ・マテリアルをクリアする"""
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh, do_unlink=True)
    for mat in list(bpy.data.materials):
        bpy.data.materials.remove(mat, do_unlink=True)


def create_pbr_material(
    name: str,
    base_color: tuple[float, float, float, float],
    roughness: float = 0.4,
    metallic: float = 0.1,
    emissive_color: tuple[float, float, float, float] | None = None,
    emissive_strength: float = 0.0,
    image_path: str | None = None,
    use_vertex_color: bool = False,
) -> bpy.types.Material:
    """Blender 5.0+ Principled BSDF マテリアルを構築する（写真ベーステクスチャ・頂点カラー乗算対応）"""
    mat = bpy.data.materials.new(name=name)
    has_node_tree = mat.node_tree is not None
    if not has_node_tree:
        mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = base_color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emissive_color is not None and "Emission Color" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = emissive_color
        bsdf.inputs["Emission Strength"].default_value = emissive_strength

    if image_path:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.abspath(os.path.join(script_dir, "..", ".."))
        full_img_path = os.path.join(project_root, image_path.lstrip("/"))
        if os.path.exists(full_img_path):
            tex_node = mat.node_tree.nodes.new(type="ShaderNodeTexImage")
            img = bpy.data.images.load(full_img_path)
            tex_node.image = img
            if use_vertex_color:
                vcol_node = mat.node_tree.nodes.new(type="ShaderNodeVertexColor")
                vcol_node.layer_name = "Col"
                mix_node = mat.node_tree.nodes.new(type="ShaderNodeMix")
                mix_node.data_type = "RGBA"
                mix_node.blend_type = "MULTIPLY"
                mix_node.inputs["Factor"].default_value = 1.0
                mat.node_tree.links.new(tex_node.outputs["Color"], mix_node.inputs[6])
                mat.node_tree.links.new(vcol_node.outputs["Color"], mix_node.inputs[7])
                mat.node_tree.links.new(mix_node.outputs[2], bsdf.inputs["Base Color"])
            else:
                mat.node_tree.links.new(tex_node.outputs["Color"], bsdf.inputs["Base Color"])
            if emissive_strength > 0.0 and "Emission Color" in bsdf.inputs:
                mat.node_tree.links.new(tex_node.outputs["Color"], bsdf.inputs["Emission Color"])
    return mat


def _uf_find(parent: list[int], x: int) -> int:
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


def _partition_connected_shells(polys: list, mesh_verts) -> list[list]:
    """glTF の法線分割頂点も同一シェルとして連結できるよう量子化座標で Union-Find 分割する"""
    poly_vgroups: dict[int, int] = {}
    qkey_to_rep: dict[tuple[int, int, int], int] = {}
    parent: list[int] = []

    for p in polys:
        first_rep = -1
        for vi in p.vertices:
            co = mesh_verts[vi].co
            qkey = (round(co.x * 20.0), round(co.y * 20.0), round(co.z * 20.0))
            rep = qkey_to_rep.get(qkey)
            if rep is None:
                rep = len(parent)
                parent.append(rep)
                qkey_to_rep[qkey] = rep
            if first_rep < 0:
                first_rep = rep
            else:
                ra = _uf_find(parent, first_rep)
                rb = _uf_find(parent, rep)
                if ra != rb:
                    parent[rb] = ra
        poly_vgroups[p.index] = first_rep

    shell_polys = collections.defaultdict(list)
    for p in polys:
        root = _uf_find(parent, poly_vgroups[p.index])
        shell_polys[root].append(p)
    return list(shell_polys.values())


# LOD0 詳細メッシュ内マテリアルスロット定数
MAT_TOWER = 0
MAT_COMMERCIAL = 1
MAT_STOREFRONT = 2
MAT_ALLEY = 3
MAT_ROOF = 4
MAT_ARCH_TRIM = 5
MAT_DARK_FRAME = 6
MAT_PITCHED_ROOF = 7

# LOD1 中距離メッシュ内マテリアルスロット定数（LOD0 3D 立体陰影ベイク済み 512px/256px）
LOD1_MAT_GLASS = 0
LOD1_MAT_COMMERCIAL = 1
LOD1_MAT_ALLEY = 2
LOD1_MAT_ROOF = 3


def setup_materials() -> dict[str, object]:
    """LOD0/LOD1/LOD2 各階層向けに Blender 3D 建築リグからベイク生成した PBR マテリアル群を構築する"""
    # --- LOD0 (近景 <= 135m: 1024px 高精細ベイクテクスチャ + 3D 立体建築ディテール) ---
    mat_tower = create_pbr_material(
        "PlateauGlassTower",
        (0.88, 0.90, 0.94, 1.0),
        roughness=0.22,
        metallic=0.48,
        image_path="apps/web/public/textures/shibuya/plateau_lod0_glass.jpg",
    )
    mat_commercial = create_pbr_material(
        "PlateauCommercialFacade",
        (0.94, 0.94, 0.94, 1.0),
        roughness=0.48,
        metallic=0.18,
        image_path="apps/web/public/textures/shibuya/plateau_lod0_commercial.jpg",
    )
    mat_storefront = create_pbr_material(
        "PlateauStorefrontMat",
        (0.96, 0.95, 0.92, 1.0),
        roughness=0.34,
        metallic=0.20,
        image_path="apps/web/public/textures/shibuya/plateau_lod0_storefront.jpg",
    )
    mat_alley = create_pbr_material(
        "PlateauAlleyCommercial",
        (0.96, 0.94, 0.92, 1.0),
        roughness=0.52,
        metallic=0.12,
        image_path="apps/web/public/textures/shibuya/plateau_lod0_alley.jpg",
    )
    mat_roof = create_pbr_material(
        "PlateauRooftop",
        (0.90, 0.90, 0.92, 1.0),
        roughness=0.82,
        metallic=0.08,
        image_path="apps/web/public/textures/shibuya/plateau_lod0_roof.jpg",
    )
    mat_arch_trim = create_pbr_material(
        "PlateauArchTrim",
        (0.58, 0.59, 0.61, 1.0),
        roughness=0.40,
        metallic=0.26,
    )
    mat_dark_frame = create_pbr_material(
        "PlateauDarkFrame",
        (0.13, 0.15, 0.19, 1.0),
        roughness=0.36,
        metallic=0.52,
    )
    mat_pitched_roof = create_pbr_material(
        "PlateauPitchedRoof",
        (0.92, 0.92, 0.94, 1.0),
        roughness=0.76,
        metallic=0.06,
        image_path="apps/web/public/textures/shibuya/plateau_lod0_pitched_roof.jpg",
    )

    # --- LOD1 (中景 135m〜235m: LOD0 の 3D 庇・マリオン陰影を焼き込んだ 512px/256px 軽量テクスチャ) ---
    mat_mid_glass = create_pbr_material(
        "PlateauMidGlass",
        (1.0, 1.0, 1.0, 1.0),
        roughness=0.30,
        metallic=0.38,
        image_path="apps/web/public/textures/shibuya/plateau_lod1_glass.jpg",
        use_vertex_color=True,
    )
    mat_mid_commercial = create_pbr_material(
        "PlateauMidCommercial",
        (1.0, 1.0, 1.0, 1.0),
        roughness=0.52,
        metallic=0.16,
        image_path="apps/web/public/textures/shibuya/plateau_lod1_commercial.jpg",
        use_vertex_color=True,
    )
    mat_mid_alley = create_pbr_material(
        "PlateauMidAlley",
        (1.0, 1.0, 1.0, 1.0),
        roughness=0.56,
        metallic=0.10,
        image_path="apps/web/public/textures/shibuya/plateau_lod1_alley.jpg",
        use_vertex_color=True,
    )
    mat_mid_roof = create_pbr_material(
        "PlateauMidRoof",
        (1.0, 1.0, 1.0, 1.0),
        roughness=0.84,
        metallic=0.06,
        image_path="apps/web/public/textures/shibuya/plateau_lod1_roof.jpg",
        use_vertex_color=True,
    )

    # --- LOD2 (遠景 235m〜800m: LOD1 から事前フィルタ縮約した 256px 対モアレ単一ドローコールマテリアル) ---
    mat_proxy = create_pbr_material(
        "PlateauLod2Proxy",
        (1.0, 1.0, 1.0, 1.0),
        roughness=0.68,
        metallic=0.14,
        image_path="apps/web/public/textures/shibuya/plateau_lod2_proxy.jpg",
        use_vertex_color=True,
    )
    return {
        "lod0": [
            mat_tower,
            mat_commercial,
            mat_storefront,
            mat_alley,
            mat_roof,
            mat_arch_trim,
            mat_dark_frame,
            mat_pitched_roof,
        ],
        "lod1": [
            mat_mid_glass,
            mat_mid_commercial,
            mat_mid_alley,
            mat_mid_roof,
        ],
        "lod2": mat_proxy,
    }


def _add_wall_bar(
    bm: bmesh.types.BMesh,
    cid: int,
    cid_layer,
    uv_layer,
    ax: float,
    ay: float,
    bx: float,
    by: float,
    nx: float,
    ny: float,
    z0: float,
    z1: float,
    d_in: float,
    d_out: float,
    mat_idx: int,
    u_scale: float = 4.0,
    v_scale: float = 4.0,
    u_range: tuple[float, float] | None = None,
    v_range: tuple[float, float] | None = None,
    allow_skirt: bool = False,
    cap_top: bool = True,
    cap_bottom: bool = True,
    cap_sides: bool = True,
) -> None:
    """外壁セグメント (ax,ay)->(bx,by) に対し外向き法線 (nx,ny) に沿った立体建築部材（庇・スパンドレル・マリオン・パラペット）を生成する"""
    if z1 <= z0 + 0.04 or d_out <= d_in + 0.02:
        return
    # T = (-ny, nx) 方向に (A -> B) を揃えることで全 5 面の法線が数学的に必ず外向きになる
    tx, ty = -ny, nx
    if (bx - ax) * tx + (by - ay) * ty < 0.0:
        ax, ay, bx, by = bx, by, ax, ay
    seg_len = math.hypot(bx - ax, by - ay)
    if seg_len < 0.08:
        return

    z0_safe = z0 if allow_skirt else max(0.0, z0)
    z1_safe = max(z0_safe + 0.05, z1)

    p0_out = Vector((ax + nx * d_out, ay + ny * d_out, z0_safe))
    p1_out = Vector((bx + nx * d_out, by + ny * d_out, z0_safe))
    p0_in = Vector((ax + nx * d_in, ay + ny * d_in, z0_safe))
    p1_in = Vector((bx + nx * d_in, by + ny * d_in, z0_safe))

    q0_out = Vector((p0_out.x, p0_out.y, z1_safe))
    q1_out = Vector((p1_out.x, p1_out.y, z1_safe))
    q0_in = Vector((p0_in.x, p0_in.y, z1_safe))
    q1_in = Vector((p1_in.x, p1_in.y, z1_safe))

    b0 = bm.verts.new(p0_out)
    b1 = bm.verts.new(p1_out)
    t1 = bm.verts.new(q1_out)
    t0 = bm.verts.new(q0_out)
    b0_i = bm.verts.new(p0_in)
    b1_i = bm.verts.new(p1_in)
    t1_i = bm.verts.new(q1_in)
    t0_i = bm.verts.new(q0_in)

    u0_uv, u1_uv = u_range if u_range is not None else (0.0, max(0.1, seg_len / u_scale))
    v0_uv, v1_uv = (
        v_range if v_range is not None else (0.0, max(0.1, (z1_safe - z0_safe) / v_scale))
    )
    u_len = u1_uv - u0_uv
    d_len = max(0.05, (d_out - d_in) / u_scale)

    def _make_quad(vs: list[bmesh.types.BMVert], uvs: list[tuple[float, float]]) -> None:
        try:
            nf = bm.faces.new(vs)
            nf[cid_layer] = cid
            nf.material_index = mat_idx
            for lp, uv_val in zip(nf.loops, uvs, strict=True):
                lp[uv_layer].uv = uv_val
        except Exception:
            pass

    # 外壁正面 (+n)
    _make_quad([b0, b1, t1, t0], [(u0_uv, v0_uv), (u1_uv, v0_uv), (u1_uv, v1_uv), (u0_uv, v1_uv)])
    if cap_top:
        _make_quad([t0, t1, t1_i, t0_i], [(0.0, 0.0), (u_len, 0.0), (u_len, d_len), (0.0, d_len)])
    if cap_bottom:
        _make_quad([b0_i, b1_i, b1, b0], [(0.0, 0.0), (u_len, 0.0), (u_len, d_len), (0.0, d_len)])
    if cap_sides:
        _make_quad(
            [b1, b1_i, t1_i, t1], [(0.0, v0_uv), (d_len, v0_uv), (d_len, v1_uv), (0.0, v1_uv)]
        )
        _make_quad(
            [b0_i, b0, t0, t0_i], [(0.0, v0_uv), (d_len, v0_uv), (d_len, v1_uv), (0.0, v1_uv)]
        )


def _add_axis_box(
    bm: bmesh.types.BMesh,
    cid: int,
    cid_layer,
    uv_layer,
    cx: float,
    cy: float,
    w: float,
    d: float,
    z0: float,
    z1: float,
    mat_side: int,
    mat_top: int,
) -> None:
    """屋上ペントハウス・HVAC室外機・アンテナ塔用の外向き直方体ボックスを追加する"""
    if w < 0.08 or d < 0.08 or z1 <= z0 + 0.05:
        return
    z0_s = max(0.20, z0)
    z1_s = max(z0_s + 0.05, z1)
    hw, hd = w * 0.5, d * 0.5
    vb = [
        bm.verts.new(Vector((cx - hw, cy - hd, z0_s))),
        bm.verts.new(Vector((cx + hw, cy - hd, z0_s))),
        bm.verts.new(Vector((cx + hw, cy + hd, z0_s))),
        bm.verts.new(Vector((cx - hw, cy + hd, z0_s))),
    ]
    vt = [
        bm.verts.new(Vector((cx - hw, cy - hd, z1_s))),
        bm.verts.new(Vector((cx + hw, cy - hd, z1_s))),
        bm.verts.new(Vector((cx + hw, cy + hd, z1_s))),
        bm.verts.new(Vector((cx - hw, cy + hd, z1_s))),
    ]
    bh = z1_s - z0_s
    for i in range(4):
        ni = (i + 1) % 4
        elen = (vb[ni].co - vb[i].co).length
        try:
            fs = bm.faces.new([vb[i], vb[ni], vt[ni], vt[i]])
            fs[cid_layer] = cid
            fs.material_index = mat_side
            uvs = [(0.0, 0.0), (elen / 4.0, 0.0), (elen / 4.0, bh / 4.0), (0.0, bh / 4.0)]
            for lp, uv_val in zip(fs.loops, uvs, strict=True):
                lp[uv_layer].uv = uv_val
        except Exception:
            pass
    try:
        ft = bm.faces.new([vt[0], vt[1], vt[2], vt[3]])
        ft[cid_layer] = cid
        ft.material_index = mat_top
        for lp in ft.loops:
            lp[uv_layer].uv = (lp.vert.co.x / 4.0, -lp.vert.co.y / 4.0)
    except Exception:
        pass


def _add_pitched_roof_on_quad(
    bm: bmesh.types.BMesh,
    cid: int,
    cid_layer,
    uv_layer,
    corners_xy: list[tuple[float, float]],
    z_base: float,
    mat_roof: int,
) -> None:
    """低層住宅・小規模建物の矩形屋根面へ日本の寄棟（よせむね）勾配屋根を立体構築する"""
    if len(corners_xy) != 4:
        return
    # 反時計回り (CCW) 保証
    signed_area = 0.0
    for i in range(4):
        x0, y0 = corners_xy[i]
        x1, y1 = corners_xy[(i + 1) % 4]
        signed_area += x0 * y1 - x1 * y0
    pts = list(corners_xy) if signed_area > 0.0 else list(reversed(corners_xy))

    e01 = math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1])
    e12 = math.hypot(pts[2][0] - pts[1][0], pts[2][1] - pts[1][1])
    if min(e01, e12) < 2.8 or max(e01, e12) > 18.0:
        return
    # 長辺を (pts[0]->pts[1]) 方向に揃える
    if e12 > e01:
        pts = [pts[1], pts[2], pts[3], pts[0]]
        e01, e12 = e12, e01

    cx = sum(p[0] for p in pts) * 0.25
    cy = sum(p[1] for p in pts) * 0.25
    # 軒先を僅かに外側 (+0.18m) へ張り出し
    eaves = []
    for px, py in pts:
        vx, vy = px - cx, py - cy
        vl = math.hypot(vx, vy)
        scale = (vl + 0.18) / max(1e-4, vl)
        eaves.append((cx + vx * scale, cy + vy * scale))

    # 棟線（長辺中央ライン）を両端から 22% 内側へ寄せて寄棟（よせむね）形状を構築
    m0x, m0y = 0.5 * (eaves[0][0] + eaves[3][0]), 0.5 * (eaves[0][1] + eaves[3][1])
    m1x, m1y = 0.5 * (eaves[1][0] + eaves[2][0]), 0.5 * (eaves[1][1] + eaves[2][1])
    r0x = m0x + (m1x - m0x) * 0.22
    r0y = m0y + (m1y - m0y) * 0.22
    r1x = m1x + (m0x - m1x) * 0.22
    r1y = m1y + (m0y - m1y) * 0.22
    ridge_h = min(2.3, max(1.0, e12 * 0.26))
    zb = max(0.25, z_base)
    zt = zb + ridge_h

    ve = [bm.verts.new(Vector((ex, ey, zb))) for ex, ey in eaves]
    vr0 = bm.verts.new(Vector((r0x, r0y, zt)))
    vr1 = bm.verts.new(Vector((r1x, r1y, zt)))

    slope_loops = [
        [ve[0], ve[1], vr1, vr0],  # 南/主斜面1
        [ve[1], ve[2], vr1],  # 妻斜面1
        [ve[2], ve[3], vr0, vr1],  # 北/主斜面2
        [ve[3], ve[0], vr0],  # 妻斜面2
    ]
    for sl in slope_loops:
        try:
            sf = bm.faces.new(sl)
            sf[cid_layer] = cid
            sf.material_index = mat_roof
            sf.normal_update()
            # 軒先辺 (sl[0]->sl[1]) を u 軸、斜面登り方向を v 軸に投影してスレート瓦の段葺きを全4斜面で軒に平行化
            origin_v = sl[0].co
            e_vec = sl[1].co - origin_v
            if e_vec.length > 1e-4:
                e_dir = e_vec.normalized()
                s_dir = sf.normal.cross(e_dir)
                if s_dir.length > 1e-4:
                    s_dir.normalize()
                    for lp in sf.loops:
                        rel = lp.vert.co - origin_v
                        lp[uv_layer].uv = (rel.dot(e_dir) / 4.2, rel.dot(s_dir) / 4.2)
                    continue
            for lp in sf.loops:
                lp[uv_layer].uv = (lp.vert.co.x / 4.2, lp.vert.co.y / 4.2)
        except Exception:
            pass


def _fit_oriented_rect(
    poly_xy: list[tuple[float, float]],
    poly_area: float,
) -> list[tuple[float, float]] | None:
    """4〜8頂点の低層住宅屋根ポリゴンから最小面積配向矩形（OBB）を抽出し寄棟屋根の4隅を返す"""
    n = len(poly_xy)
    if n < 4 or n > 8:
        return None
    if n == 4:
        return poly_xy

    # 最長辺を主軸にして配向矩形を算出（矩形充填率 >= 0.72 のみ許容）
    best_rect = None
    best_area = float("inf")
    for i in range(n):
        x0, y0 = poly_xy[i]
        x1, y1 = poly_xy[(i + 1) % n]
        dx, dy = x1 - x0, y1 - y0
        elen = math.hypot(dx, dy)
        if elen < 0.8:
            continue
        ux, uy = dx / elen, dy / elen
        vx, vy = -uy, ux
        us = [px * ux + py * uy for px, py in poly_xy]
        vs = [px * vx + py * vy for px, py in poly_xy]
        u0, u1 = min(us), max(us)
        v0, v1 = min(vs), max(vs)
        obb_area = (u1 - u0) * (v1 - v0)
        if obb_area < best_area:
            best_area = obb_area
            best_rect = [
                (u0 * ux + v0 * vx, u0 * uy + v0 * vy),
                (u1 * ux + v0 * vx, u1 * uy + v0 * vy),
                (u1 * ux + v1 * vx, u1 * uy + v1 * vy),
                (u0 * ux + v1 * vx, u0 * uy + v1 * vy),
            ]
    if best_rect is None or best_area <= 1e-3 or (poly_area / best_area) < 0.72:
        return None
    return best_rect


def _assign_integer_bay_wall_uvs(
    bm: bmesh.types.BMesh,
    cid_layer,
    uv_layer,
    comp_info: dict[int, tuple[float, float, float, float]],
) -> dict[int, list[tuple[float, float, float, float, float, float, float, float, int, int, int]]]:
    """
    平面統合済み（dissolve_limit 後）の垂直外壁面ごとに整数窓スパン・整数階高 UV を割り当てる。
    - 横方向: 壁左隅 u=0.0 → 右隅 u=n_bays*0.25（建物角での窓途中切れを 100% 根絶）
    - 縦方向: 壁下端 v=0.0 → 上端 v=n_floors*0.25（屋根直下での窓途中切れを 100% 根絶）
    併せて _sculpt_buildings_lod0 へ exact な (n_bays, n_floors) を返却し 3D 庇・マリオンを 1px の狂いなく同期する。
    """
    wall_segments_by_cid: dict[
        int, list[tuple[float, float, float, float, float, float, float, float, int, int, int]]
    ] = collections.defaultdict(list)

    for f in bm.faces:
        fcid = f[cid_layer]
        if fcid <= 0 or fcid not in comp_info:
            continue
        if abs(f.normal.z) >= 0.25:
            continue
        nx, ny = f.normal.x, f.normal.y
        n_len = math.hypot(nx, ny)
        if n_len < 0.5:
            continue
        nx /= n_len
        ny /= n_len
        tx, ty = -ny, nx

        _zb, bldg_h, _bcx, _bcy = comp_info[fcid]
        if bldg_h < 24.0:
            target_bay_w, target_floor_h = 2.15, 2.85
        elif bldg_h < 46.0:
            target_bay_w, target_floor_h = 2.25, 3.05
        else:
            target_bay_w, target_floor_h = 2.40, 3.35

        coords = [v.co for v in f.verts]
        ts = [c.x * tx + c.y * ty for c in coords]
        zs = [c.z for c in coords]
        t_min, t_max = min(ts), max(ts)
        z_min, z_max = min(zs), max(zs)
        wlen = t_max - t_min
        wh = z_max - z_min
        if wlen < 0.08 or wh < 0.08:
            continue

        n_bays = max(1, round(wlen / target_bay_w))
        n_floors = max(1, round(wh / target_floor_h))
        u_total = n_bays * 0.25
        v_total = n_floors * 0.25
        # ビルごとに 1 スパン単位の整数位相シフト（端の柱位置を崩さず窓点灯パターンの反復感を解消）
        u_bay_shift = (fcid % 4) * 0.25
        v_floor_shift = ((fcid // 4) % 4) * 0.25

        for lp in f.loops:
            co = lp.vert.co
            t_val = co.x * tx + co.y * ty
            u_norm = (t_val - t_min) / wlen
            v_norm = (co.z - z_min) / wh
            lp[uv_layer].uv = (u_bay_shift + u_norm * u_total, v_floor_shift + v_norm * v_total)

        if wh >= 1.2 and wlen >= 2.6:
            projs = [(c.x * tx + c.y * ty, c.x, c.y) for c in coords]
            min_p = min(projs, key=lambda item: item[0])
            max_p = max(projs, key=lambda item: item[0])
            wall_segments_by_cid[fcid].append(
                (
                    min_p[1],
                    min_p[2],
                    max_p[1],
                    max_p[2],
                    nx,
                    ny,
                    z_min,
                    z_max,
                    f.material_index,
                    n_bays,
                    n_floors,
                )
            )
    return wall_segments_by_cid


def _add_foundation_skirts(
    bm: bmesh.types.BMesh,
    cid_layer,
    uv_layer,
    wall_segments_by_cid: dict[
        int, list[tuple[float, float, float, float, float, float, float, float, int, int, int]]
    ],
    mat_idx: int,
    col_layer=None,
    skirt_col: tuple[float, float, float, float] = (0.38, 0.40, 0.43, 1.0),
) -> None:
    """
    傾斜地での 1F 外壁テクスチャ地中引き伸ばしを完全防止するため、壁底面 z=0.06 から地中 z=-3.5m へ
    専用の無地ダーク基礎スカートを追加する。
    """
    for cid, walls in wall_segments_by_cid.items():
        for ax, ay, bx, by, nx, ny, z_lo, _z_hi, _mw, _nb, _nf in walls:
            if z_lo > 0.25:
                continue
            tx, ty = -ny, nx
            if (bx - ax) * tx + (by - ay) * ty < 0.0:
                ax, ay, bx, by = bx, by, ax, ay
            v0 = bm.verts.new(Vector((ax, ay, -3.5)))
            v1 = bm.verts.new(Vector((bx, by, -3.5)))
            v2 = bm.verts.new(Vector((bx, by, 0.08)))
            v3 = bm.verts.new(Vector((ax, ay, 0.08)))
            try:
                sf = bm.faces.new([v0, v1, v2, v3])
                sf[cid_layer] = cid
                sf.material_index = mat_idx
                for lp in sf.loops:
                    lp[uv_layer].uv = (0.006, 0.006)
                    if col_layer is not None:
                        lp[col_layer] = skirt_col
            except Exception:
                pass


def _sculpt_buildings_lod0(
    bm: bmesh.types.BMesh,
    cid_layer,
    uv_layer,
    comp_info: dict[int, tuple[float, float, float, float]],
    comp_roof_faces: dict[int, list[tuple[float, float, float, float, float]]],
    wall_segments_by_cid: dict[
        int, list[tuple[float, float, float, float, float, float, float, float, int, int, int]]
    ],
) -> int:
    """全実在 PLATEAU 建築物へ整数スパン・整数階高 UV と 100% 厳密同期した Blender 3D 建築ディテールを造形する"""
    poly_roof_by_cid: dict[int, tuple[float, float, list[tuple[float, float]]]] = {}
    true_top_z_by_cid: dict[int, float] = {}

    for f in list(bm.faces):
        fcid = f[cid_layer]
        if fcid <= 0 or fcid not in comp_info:
            continue
        f_max_z = max(v.co.z for v in f.verts)
        if f_max_z > true_top_z_by_cid.get(fcid, 0.0):
            true_top_z_by_cid[fcid] = f_max_z
        if f.normal.z > 0.94 and 4 <= len(f.verts) <= 8:
            area = f.calc_area()
            prev = poly_roof_by_cid.get(fcid)
            if prev is None or area > prev[0]:
                fc = f.calc_center_median()
                poly_roof_by_cid[fcid] = (area, fc.z, [(v.co.x, v.co.y) for v in f.verts])

    pitched_roof_count = 0
    for cid, (_z_base, bldg_h, _b_cx, _b_cy) in comp_info.items():
        walls = wall_segments_by_cid.get(cid, [])
        if not walls:
            continue

        true_top_z = max(true_top_z_by_cid.get(cid, bldg_h), 1.0)

        # 1. 低層住宅（3.2m <= h <= 10.5m, 18〜175m², 4〜8頂点矩形系）へ日本式スレート瓦の寄棟勾配屋根を造形
        pro = poly_roof_by_cid.get(cid)
        pitched_corners = (
            _fit_oriented_rect(pro[2], pro[0])
            if (
                pro is not None
                and 3.2 <= true_top_z <= 10.5
                and 18.0 <= pro[0] <= 175.0
                and abs(pro[1] - true_top_z) <= 1.2
            )
            else None
        )
        if pitched_corners is not None and pro is not None:
            _add_pitched_roof_on_quad(
                bm, cid, cid_layer, uv_layer, pitched_corners, pro[1], MAT_PITCHED_ROOF
            )
            pitched_roof_count += 1
            for ax, ay, bx, by, nx, ny, z_lo, z_hi, _mat_w, _nb, _nf in walls:
                wlen = math.hypot(bx - ax, by - ay)
                if wlen >= 4.2 and z_lo <= 0.5 and z_hi >= 3.4:
                    _add_wall_bar(
                        bm,
                        cid,
                        cid_layer,
                        uv_layer,
                        ax,
                        ay,
                        bx,
                        by,
                        nx,
                        ny,
                        2.85,
                        3.12,
                        -0.04,
                        0.24,
                        MAT_DARK_FRAME,
                        cap_sides=False,
                    )
            continue

        is_high_rise = true_top_z >= 36.0
        is_mid_rise = 15.0 <= true_top_z < 36.0
        is_commercial_low = 7.5 <= true_top_z < 15.0

        # 2. 壁面単位の 3D 建築モデリング（整数窓スパン n_bays・整数階高 n_floors に 100% 厳密同期）
        for ax, ay, bx, by, nx, ny, z_lo, z_hi, mat_w, n_bays, n_floors in walls:
            wlen = math.hypot(bx - ax, by - ay)
            wh = z_hi - z_lo
            is_true_roof_edge = abs(z_hi - true_top_z) <= 0.35
            if wh < 3.0 and not is_true_roof_edge:
                continue

            exact_floor_h = wh / max(1, n_floors)
            exact_bay_w = wlen / max(1, n_bays)
            is_tower_glass = mat_w == MAT_TOWER
            trim_primary = MAT_DARK_FRAME if is_tower_glass else MAT_ARCH_TRIM
            trim_canopy = MAT_DARK_FRAME if (is_tower_glass or cid % 2 == 0) else MAT_ARCH_TRIM
            ux, uy = (bx - ax) / wlen, (by - ay) / wlen

            # A. 1F 路面店舗ポディウム（1F→2F スラブ境界 exact_floor_h に厳密一致する 3D 入口庇＋1F ショップフロント＋接地隅柱）
            canopy_z0 = round(max(2.75, min(3.85, exact_floor_h - 0.12)), 2)
            canopy_z1 = canopy_z0 + (0.38 if is_high_rise else 0.32)
            if z_lo <= 0.6 and z_hi >= 6.8 and wlen >= 3.2:
                canopy_out = 0.31 if wlen >= 4.5 else 0.24
                _add_wall_bar(
                    bm,
                    cid,
                    cid_layer,
                    uv_layer,
                    ax,
                    ay,
                    bx,
                    by,
                    nx,
                    ny,
                    canopy_z0,
                    canopy_z1,
                    -0.05,
                    canopy_out,
                    trim_canopy,
                )
                # 1F 基礎幅木（ダーク石材キックプレート：地中 -3.5m まで伸ばし急勾配でも無縫接地）
                if wlen >= 4.2:
                    _add_wall_bar(
                        bm,
                        cid,
                        cid_layer,
                        uv_layer,
                        ax,
                        ay,
                        bx,
                        by,
                        nx,
                        ny,
                        -3.5,
                        0.42,
                        -0.04,
                        0.14,
                        MAT_DARK_FRAME,
                        allow_skirt=True,
                        cap_bottom=False,
                        cap_sides=False,
                    )
                # 1F 専用路面店舗ショーウィンドウ（整数店舗ベイ数 u_range=(0, n_shops*0.25), 縦フル展開 v_range=(0.06, 0.96)）
                if (is_high_rise or is_mid_rise or is_commercial_low) and wlen >= 4.4:
                    shop_span = max(2.0, wlen - 0.84)
                    n_shops = max(1, round(shop_span / 2.65))
                    _add_wall_bar(
                        bm,
                        cid,
                        cid_layer,
                        uv_layer,
                        ax + ux * 0.42,
                        ay + uy * 0.42,
                        bx - ux * 0.42,
                        by - uy * 0.42,
                        nx,
                        ny,
                        0.38,
                        canopy_z0,
                        -0.02,
                        0.06,
                        MAT_STOREFRONT,
                        u_range=(0.0, n_shops * 0.25),
                        v_range=(0.06, 0.96),
                        allow_skirt=False,
                        cap_top=False,
                        cap_bottom=False,
                        cap_sides=False,
                    )
                # 1F コロネード隅柱（地中 -3.5m まで伸ばし斜面での浮遊ゼロ）
                if wlen >= 5.2 and (is_high_rise or is_mid_rise):
                    pw_col = 0.46
                    for start_d in (0.0, wlen - pw_col):
                        p0x, p0y = ax + ux * start_d, ay + uy * start_d
                        p1x, p1y = p0x + ux * pw_col, p0y + uy * pw_col
                        _add_wall_bar(
                            bm,
                            cid,
                            cid_layer,
                            uv_layer,
                            p0x,
                            p0y,
                            p1x,
                            p1y,
                            nx,
                            ny,
                            -3.5,
                            canopy_z0,
                            -0.04,
                            0.22,
                            MAT_ARCH_TRIM,
                            allow_skirt=True,
                            cap_top=False,
                            cap_bottom=False,
                        )

            # B. 最上階コーニス（軒蛇腹）＆屋上立体パラペット壁（隅の欠けを防ぐため両端を +0.14m 延長してコーナー閉合）
            if is_true_roof_edge and true_top_z >= 7.5:
                parapet_h = 1.15 if is_high_rise else (0.90 if is_mid_rise else 0.72)
                c_ext = 0.14
                _add_wall_bar(
                    bm,
                    cid,
                    cid_layer,
                    uv_layer,
                    ax - ux * c_ext,
                    ay - uy * c_ext,
                    bx + ux * c_ext,
                    by + uy * c_ext,
                    nx,
                    ny,
                    z_hi - 0.05,
                    z_hi + parapet_h,
                    -0.30,
                    0.14,
                    MAT_ARCH_TRIM if (is_high_rise or is_mid_rise) else MAT_DARK_FRAME,
                    cap_bottom=False,
                )
                if is_high_rise or is_mid_rise or (is_commercial_low and wlen >= 4.2):
                    c_ext_corn = 0.24
                    _add_wall_bar(
                        bm,
                        cid,
                        cid_layer,
                        uv_layer,
                        ax - ux * c_ext_corn,
                        ay - uy * c_ext_corn,
                        bx + ux * c_ext_corn,
                        by + uy * c_ext_corn,
                        nx,
                        ny,
                        z_hi - 0.44,
                        z_hi - 0.04,
                        -0.04,
                        0.26,
                        trim_primary,
                        cap_sides=False,
                    )

            if wh < 3.0:
                continue

            # C. 整数階高境界 z_lo + k * exact_floor_h に 100% 同期した 3D 水平スパンドレル帯
            if (is_high_rise or is_mid_rise) and wlen >= 4.2 and wh >= 11.0 and n_floors >= 4:
                floors_per_band = 3 if is_high_rise else 2
                ledge_thick = 0.36 if is_high_rise else 0.28
                ledge_out = 0.26 if is_high_rise else 0.22
                band_count = 0
                for fk in range(floors_per_band, n_floors, floors_per_band):
                    z_band = z_lo + fk * exact_floor_h
                    if z_band <= canopy_z1 + 0.8 or z_band >= z_hi - 1.2:
                        continue
                    _add_wall_bar(
                        bm,
                        cid,
                        cid_layer,
                        uv_layer,
                        ax,
                        ay,
                        bx,
                        by,
                        nx,
                        ny,
                        z_band - ledge_thick * 0.5,
                        z_band + ledge_thick * 0.5,
                        -0.04,
                        ledge_out,
                        trim_primary,
                        cap_sides=False,
                    )
                    band_count += 1
                    if band_count >= 6:
                        break
            elif is_commercial_low and wlen >= 4.8 and n_floors >= 3 and z_lo <= 1.0:
                z_band = z_lo + 2.0 * exact_floor_h
                if canopy_z1 + 0.8 < z_band < z_hi - 1.2:
                    _add_wall_bar(
                        bm,
                        cid,
                        cid_layer,
                        uv_layer,
                        ax,
                        ay,
                        bx,
                        by,
                        nx,
                        ny,
                        z_band - 0.14,
                        z_band + 0.14,
                        -0.04,
                        0.20,
                        MAT_ARCH_TRIM,
                        cap_sides=False,
                    )

            # D. 整数窓スパン目地 k * exact_bay_w に 100% 同期した 3D 垂直構造柱・アルミマリオン
            if (is_high_rise or is_mid_rise) and wlen >= 5.8 and wh >= 12.0 and n_bays >= 2:
                m_z0 = max(z_lo + 0.25, canopy_z1 if z_lo <= 0.6 else z_lo + 0.25)
                m_z1 = z_hi - 0.46
                if m_z1 > m_z0 + 4.0:
                    fin_w = 0.26 if is_high_rise else 0.30
                    fin_out = 0.24 if is_high_rise else 0.20
                    positions: list[float] = [0.0, wlen - fin_w]
                    bay_step = 2 if n_bays <= 10 else 3
                    internal_added = 0
                    for bk in range(bay_step, n_bays, bay_step):
                        dist_along = bk * exact_bay_w - fin_w * 0.5
                        if 1.4 <= dist_along <= wlen - 1.4:
                            positions.append(dist_along)
                            internal_added += 1
                            if internal_added >= 4:
                                break

                    for dist_along in positions:
                        p0x, p0y = ax + ux * dist_along, ay + uy * dist_along
                        p1x, p1y = p0x + ux * fin_w, p0y + uy * fin_w
                        _add_wall_bar(
                            bm,
                            cid,
                            cid_layer,
                            uv_layer,
                            p0x,
                            p0y,
                            p1x,
                            p1y,
                            nx,
                            ny,
                            m_z0,
                            m_z1,
                            -0.04,
                            fin_out,
                            trim_primary,
                            cap_top=False,
                            cap_bottom=False,
                        )

        # 3. 屋上ペントハウス（側面は建築コンクリート MAT_ARCH_TRIM、上面のみ防水屋上 MAT_ROOF）・HVAC・高層マスト
        r_faces = comp_roof_faces.get(cid, [])
        if r_faces and bldg_h >= 10.0:
            best_area, rcx, rcy, rcz, min_span = max(r_faces, key=lambda t: t[0])
            if bldg_h >= 18.0 and best_area >= 36.0 and min_span >= 6.2:
                pw = min(max(min_span * 0.28, 3.0), 5.8)
                pd = min(max(min_span * 0.26, 2.8), 5.2)
                ph = 3.5 if is_high_rise else 2.8
                _add_axis_box(
                    bm,
                    cid,
                    cid_layer,
                    uv_layer,
                    rcx,
                    rcy,
                    pw,
                    pd,
                    rcz,
                    rcz + ph,
                    MAT_ARCH_TRIM,
                    MAT_ROOF,
                )
                _add_axis_box(
                    bm,
                    cid,
                    cid_layer,
                    uv_layer,
                    rcx,
                    rcy,
                    pw + 0.36,
                    pd + 0.36,
                    rcz + ph - 0.28,
                    rcz + ph + 0.08,
                    MAT_DARK_FRAME,
                    MAT_ROOF,
                )
                if min_span >= 8.5:
                    hvac_off = pw * 0.5 + 1.5
                    _add_axis_box(
                        bm,
                        cid,
                        cid_layer,
                        uv_layer,
                        rcx + hvac_off * 0.65,
                        rcy - pd * 0.35,
                        2.3,
                        1.7,
                        rcz,
                        rcz + 1.65,
                        MAT_DARK_FRAME,
                        MAT_ARCH_TRIM,
                    )
                if bldg_h >= 42.0:
                    mast_h = 6.5 if bldg_h >= 65.0 else 4.2
                    _add_axis_box(
                        bm,
                        cid,
                        cid_layer,
                        uv_layer,
                        rcx - pw * 0.22,
                        rcy + pd * 0.22,
                        0.32,
                        0.32,
                        rcz + ph,
                        rcz + ph + mast_h,
                        MAT_DARK_FRAME,
                        MAT_DARK_FRAME,
                    )
            elif best_area >= 22.0 and min_span >= 4.8:
                _add_axis_box(
                    bm,
                    cid,
                    cid_layer,
                    uv_layer,
                    rcx,
                    rcy,
                    2.2,
                    1.8,
                    rcz,
                    rcz + 1.85,
                    MAT_ARCH_TRIM,
                    MAT_ROOF,
                )
    return pitched_roof_count


def prepare_b3dm_and_extract_glb(tile_name: str, cache_dir: str) -> tuple[str, dict]:
    """b3dm ファイルを取得・キャッシュし、CESIUM_RTC を除去した互換 glb と属性メタデータを抽出する"""
    os.makedirs(cache_dir, exist_ok=True)
    b3dm_path = os.path.join(cache_dir, f"{tile_name}.b3dm")
    glb_path = os.path.join(cache_dir, f"{tile_name}.glb")
    meta_path = os.path.join(cache_dir, f"{tile_name}_meta.json")

    is_cached = os.path.exists(glb_path) and os.path.exists(meta_path)
    if is_cached:
        with open(meta_path, encoding="utf-8") as f:
            cached_meta = json.load(f)
            if "gml_ids" in cached_meta:
                return glb_path, cached_meta

    if not os.path.exists(b3dm_path):
        url = f"{PLATEAU_BASE_URL}/{tile_name}.b3dm"
        print(f"[PLATEAU] Downloading {tile_name} from {url}...")
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req) as res, open(b3dm_path, "wb") as f:
            f.write(res.read())

    with open(b3dm_path, "rb") as f:
        data = f.read()

    _magic, _ver, _byte_len, ft_json_len, ft_bin_len, bt_json_len, bt_bin_len = struct.unpack(
        "<4sIIIIII", data[:28]
    )
    bt_start = 28 + ft_json_len + ft_bin_len
    bt_json = json.loads(data[bt_start : bt_start + bt_json_len].decode("utf-8"))
    bt_bin_start = bt_start + bt_json_len

    glb_start = bt_bin_start + bt_bin_len
    glb_data = data[glb_start:]
    g_magic, g_ver, _g_len = struct.unpack("<4sII", glb_data[:12])
    c_len, c_type = struct.unpack("<I4s", glb_data[12:20])
    gltf = json.loads(glb_data[20 : 20 + c_len].decode("utf-8"))
    rtc_center = gltf.get("extensions", {}).get("CESIUM_RTC", {}).get("center", [0, 0, 0])

    bldg_count = len(bt_json.get("gml_id", []))
    meta = {
        "tile": tile_name,
        "rtc_center": rtc_center,
        "bldg_count": bldg_count,
        "gml_ids": bt_json.get("gml_id", []),
        "heights": bt_json.get("bldg:measuredHeight", [0] * bldg_count),
        "names": bt_json.get("gml:name", [None] * bldg_count),
        "usages": bt_json.get("bldg:usage", [None] * bldg_count),
    }

    gltf["extensionsRequired"] = [
        e for e in gltf.get("extensionsRequired", []) if e != "CESIUM_RTC"
    ]
    gltf["extensionsUsed"] = [e for e in gltf.get("extensionsUsed", []) if e != "CESIUM_RTC"]
    bin_data = glb_data[20 + c_len :]
    new_json_bytes = json.dumps(gltf).encode("utf-8")
    while len(new_json_bytes) % 4 != 0:
        new_json_bytes += b" "

    new_glb = struct.pack("<4sII", g_magic, g_ver, 12 + 8 + len(new_json_bytes) + len(bin_data))
    new_glb += struct.pack("<I4s", len(new_json_bytes), c_type)
    new_glb += new_json_bytes
    new_glb += bin_data

    with open(glb_path, "wb") as f:
        f.write(new_glb)
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f)

    return glb_path, meta


def generate_shibuya_plateau_city() -> str:
    """Project PLATEAU 渋谷区全20リーフタイルの実在建築メッシュを LOD2 建築モデリング化して GLB を生成する"""
    clean_scene()
    cache_dir = "/tmp/shibuya_tiles"
    materials = setup_materials()

    total_buildings = 0
    total_components_kept = 0
    total_faces_kept = 0
    total_landmarks_skipped = 0
    total_road_clipped = 0

    for tile_name in PLATEAU_TILES:
        glb_path, meta = prepare_b3dm_and_extract_glb(tile_name, cache_dir)
        rtc = meta["rtc_center"]
        gml_ids = meta["gml_ids"]
        heights = meta["heights"]
        total_buildings += meta["bldg_count"]

        bpy.ops.import_scene.gltf(filepath=glb_path)
        imported_objs = [o for o in bpy.context.selected_objects if o.type == "MESH"]
        if not imported_objs:
            continue
        obj = imported_objs[-1]

        batch_attr = obj.data.attributes.get("_BATCHID")
        batch_vals = (
            [d.value for d in batch_attr.data] if batch_attr else [0] * len(obj.data.vertices)
        )

        # 1. 頂点座標をローカル平面座標に変換（高度は一旦 WGS84 楕円体高を保持）
        for v in obj.data.vertices:
            lat, lon, alt = ecef_to_latlon(
                rtc[0] + v.co.x,
                rtc[1] + v.co.y,
                rtc[2] + v.co.z,
            )
            lx, lz = wgs84_to_local(lat, lon)
            v.co = Vector((lx, -lz, alt))
        obj.data.update()

        # 2. 建物バッチIDごとにポリゴンをグループ化
        bldg_polys = collections.defaultdict(list)
        for poly in obj.data.polygons:
            main_bid = batch_vals[poly.vertices[0]] if poly.vertices else 0
            bldg_polys[main_bid].append(poly)

        # 3. 建物バッチ内を連結シェル単位に分解し、道路クリアランス・接地・宙浮き除外を実施
        valid_poly_comp: dict[int, int] = {}
        comp_info: dict[int, tuple[float, float, float, float]] = {}  # cid: (z_base, h, cx, cy)
        vert_z_offset: dict[int, float] = {}
        next_comp_id = 1
        total_floating_dropped = 0
        is_single_batch_tile = len(bldg_polys) == 1
        tile_accepted_boxes: list[tuple[float, float, float, float]] = []

        for bid, polys in bldg_polys.items():
            gml_id = gml_ids[bid] if bid < len(gml_ids) else ""
            h = heights[bid] if (bid < len(heights) and heights[bid] is not None) else 20.0

            # ランドマーク除外
            if gml_id in LANDMARK_GML_IDS:
                total_landmarks_skipped += len(polys)
                continue

            shell_list = _partition_connected_shells(polys, obj.data.vertices)
            shell_records = []
            for sp in shell_list:
                vert_indices = {vi for p in sp for vi in p.vertices}
                coords = [obj.data.vertices[vi].co for vi in vert_indices]
                if not coords:
                    continue
                c_min_x = min(c.x for c in coords)
                c_max_x = max(c.x for c in coords)
                c_min_y = min(c.y for c in coords)
                c_max_y = max(c.y for c in coords)
                c_min_z = min(c.z for c in coords)
                c_max_z = max(c.z for c in coords)
                c_cx = sum(c.x for c in coords) / len(coords)
                c_cy = sum(c.y for c in coords) / len(coords)
                c_cz = -c_cy
                c_h = c_max_z - c_min_z

                # 三角形2D一覧を構築し、カスタムランドマーク重複・道路コリドー・首都高3号線との干渉を厳密判定
                # Why: 従来の重心判定や端点チェックでは明治通り(x=-750)やR246を跨ぐ幅70〜90mの大型基壇ブロックがすり抜けるため、
                #      全構成三角形に対して実道路曲線(Catmull-Rom)および交差点・高架橋との2D最短距離を判定する。
                c_world_min_z = -c_max_y
                c_world_max_z = -c_min_y
                shell_w = c_max_x - c_min_x
                shell_d = c_world_max_z - c_world_min_z
                shell_area_xz = max(1.0, shell_w * shell_d)

                # 千代田区・丸の内側 (x > -345) への越境を除外
                if c_cx > SHIBUYA_EAST_CLIP_X:
                    total_landmarks_skipped += len(sp)
                    continue

                # PLATEAU の細長い境界壁・極小小屋シェルおよび高架スラブのみを除外（渋谷特有の狭小ペンシルビル・低層商業店舗は保持）
                is_highway_viaduct_shell = (
                    tile_name == "data155"
                    and max(shell_w, shell_d) > 85.0
                    and (
                        c_h < 12.0
                        or (max(shell_w, shell_d) / max(1.0, min(shell_w, shell_d))) > 4.5
                    )
                )
                if (
                    min(shell_w, shell_d) < 2.2
                    or shell_area_xz < 14.0
                    or c_h < 2.8
                    or is_highway_viaduct_shell
                ):
                    total_landmarks_skipped += len(sp)
                    continue
                in_custom_landmark = False
                for _lm_name, lx0, lx1, lz0, lz1 in CUSTOM_LANDMARK_EXCLUSIONS:
                    if lx0 <= c_cx <= lx1 and lz0 <= c_cz <= lz1:
                        in_custom_landmark = True
                        break
                    ox = min(c_max_x, lx1) - max(c_min_x, lx0)
                    oz = min(c_world_max_z, lz1) - max(c_world_min_z, lz0)
                    if ox > 2.5 and oz > 2.5:
                        lm_area = max(1.0, (lx1 - lx0) * (lz1 - lz0))
                        if (ox * oz) >= 0.35 * min(shell_area_xz, lm_area):
                            in_custom_landmark = True
                            break

                if in_custom_landmark:
                    total_landmarks_skipped += len(sp)
                    continue

                if "_EXACT_ROAD_DISCS" not in globals():
                    discs: list[tuple[float, float, float]] = []
                    for corridor in EXACT_CURVED_ROAD_CLEARANCES:
                        r = corridor["radius"]
                        for sx, sz in eval_centripetal_catmull_rom_2d(corridor["points"]):
                            discs.append((sx, sz, r))
                    for (ix, iz), iradius in EXACT_INTERSECTION_CLEARANCES:
                        discs.append((ix, iz, iradius))
                    globals()["_EXACT_ROAD_DISCS"] = discs
                road_discs: list[tuple[float, float, float]] = globals()["_EXACT_ROAD_DISCS"]

                shell_tris_2d: list[tuple[float, float, float, float, float, float]] = []
                for p in sp:
                    pverts = [obj.data.vertices[vi].co for vi in p.vertices]
                    for ki in range(1, len(pverts) - 1):
                        v0, v1, v2 = pverts[0], pverts[ki], pverts[ki + 1]
                        shell_tris_2d.append((v0.x, -v0.y, v1.x, -v1.y, v2.x, -v2.y))

                max_disc_r = 21.0
                cand_discs = [
                    (rx, rz, rr)
                    for (rx, rz, rr) in road_discs
                    if (c_min_x - max_disc_r) <= rx <= (c_max_x + max_disc_r)
                    and (c_world_min_z - max_disc_r) <= rz <= (c_world_max_z + max_disc_r)
                ]

                in_exact_road = False
                closest_disc: tuple[float, float, float] | None = None
                min_disc_margin = float("inf")
                if cand_discs and shell_tris_2d:
                    for ax, az, bx, bz, cx, cz in shell_tris_2d:
                        tmin_x = min(ax, bx, cx)
                        tmax_x = max(ax, bx, cx)
                        tmin_z = min(az, bz, cz)
                        tmax_z = max(az, bz, cz)
                        for rx, rz, rr in cand_discs:
                            if (
                                rx < tmin_x - rr
                                or rx > tmax_x + rr
                                or rz < tmin_z - rr
                                or rz > tmax_z + rr
                            ):
                                continue
                            d2 = dist_point_to_triangle_2d_sq(rx, rz, ax, az, bx, bz, cx, cz)
                            if d2 <= (rr * rr):
                                in_exact_road = True
                                margin = math.sqrt(max(0.0, d2)) - rr
                                if margin < min_disc_margin:
                                    min_disc_margin = margin
                                    closest_disc = (rx, rz, rr)

                in_intersection = any(
                    math.hypot(c_cx - ix, c_cz - iz) <= iradius
                    for (ix, iz), iradius in ROAD_INTERSECTION_CLEARANCES
                )
                in_corridor_center = any(
                    point_to_polyline_distance(c_cx, c_cz, corridor["points"]) <= corridor["radius"]
                    for corridor in ROAD_CORRIDOR_POLYLINES
                )

                if in_exact_road or in_intersection or in_corridor_center:
                    # 沿道ビル（宮益坂・公園通り・道玄坂・文化村通り・R246・六本木通り・明治通り等）が歩道・車道クリアランスに掛かる場合、
                    # 低層店舗〜超高層タワー（3m〜185m）まで幅広く道路法線方向へ精密セットバック移動して救済する
                    rescued = False
                    if (
                        3.0 <= c_h <= 185.0
                        and min(shell_w, shell_d) >= 2.5
                        and max(shell_w, shell_d) <= 95.0
                        and closest_disc is not None
                    ):
                        rx0, rz0, _rr0 = closest_disc
                        vx = c_cx - rx0
                        vz = c_cz - rz0
                        vlen = math.hypot(vx, vz)
                        if vlen > 1e-3:
                            ux, uz = vx / vlen, vz / vlen
                            # 主方向（道路中心から離れる方向）に加え、角地ビル用に ±35度 回転方向も候補にする
                            cand_dirs = [
                                (ux, uz),
                                (ux * 0.819 - uz * 0.574, ux * 0.574 + uz * 0.819),
                                (ux * 0.819 + uz * 0.574, -ux * 0.574 + uz * 0.819),
                            ]
                            for shift_m in (1.8, 3.5, 5.5, 8.0, 11.0, 14.5, 18.0):
                                for dux, duz in cand_dirs:
                                    s_dx = dux * shift_m
                                    s_dz = duz * shift_m
                                    s_min_x = c_min_x + s_dx
                                    s_max_x = c_max_x + s_dx
                                    s_w_min_z = c_world_min_z + s_dz
                                    s_w_max_z = c_world_max_z + s_dz
                                    s_cx = c_cx + s_dx
                                    s_cz = c_cz + s_dz
                                    if s_cx > SHIBUYA_EAST_CLIP_X:
                                        continue
                                    # 1) カスタムランドマーク非干渉
                                    hits_lm = False
                                    for _lm, lx0, lx1, lz0, lz1 in CUSTOM_LANDMARK_EXCLUSIONS:
                                        if lx0 <= s_cx <= lx1 and lz0 <= s_cz <= lz1:
                                            hits_lm = True
                                            break
                                        ox = min(s_max_x, lx1 + 1.0) - max(s_min_x, lx0 - 1.0)
                                        oz = min(s_w_max_z, lz1 + 1.0) - max(s_w_min_z, lz0 - 1.0)
                                        if ox > 1.5 and oz > 1.5:
                                            lm_area = max(1.0, (lx1 - lx0) * (lz1 - lz0))
                                            if (ox * oz) >= 0.25 * min(shell_area_xz, lm_area):
                                                hits_lm = True
                                                break
                                    if hits_lm:
                                        continue
                                    # 2) 既存受入シェルとの過度な重複なし（斜め街路のAABB重複を誤判定しないよう面積比で判定）
                                    hits_existing = False
                                    for ex0, ex1, ez0, ez1 in tile_accepted_boxes:
                                        ox = min(s_max_x, ex1) - max(s_min_x, ex0)
                                        oz = min(s_w_max_z, ez1) - max(s_w_min_z, ez0)
                                        if ox > 2.5 and oz > 2.5:
                                            ex_area = max(1.0, (ex1 - ex0) * (ez1 - ez0))
                                            if (ox * oz) >= 0.35 * min(shell_area_xz, ex_area):
                                                hits_existing = True
                                                break
                                    if hits_existing:
                                        continue
                                    # 3) 交差点・ポリライン中心非干渉 (+0.6m 安全マージン)
                                    if any(
                                        math.hypot(s_cx - ix, s_cz - iz) <= iradius + 0.6
                                        for (ix, iz), iradius in ROAD_INTERSECTION_CLEARANCES
                                    ) or any(
                                        point_to_polyline_distance(s_cx, s_cz, corridor["points"])
                                        <= corridor["radius"] + 0.6
                                        for corridor in ROAD_CORRIDOR_POLYLINES
                                    ):
                                        continue
                                    # 4) 全道路ディスク非干渉 (+0.5m 安全マージン)
                                    s_cand = [
                                        (rx, rz, rr + 0.5)
                                        for (rx, rz, rr) in road_discs
                                        if (s_min_x - max_disc_r) <= rx <= (s_max_x + max_disc_r)
                                        and (s_w_min_z - max_disc_r)
                                        <= rz
                                        <= (s_w_max_z + max_disc_r)
                                    ]
                                    hits_disc = False
                                    for ax, az, bx, bz, cx, cz in shell_tris_2d:
                                        sa_x, sa_z = ax + s_dx, az + s_dz
                                        sb_x, sb_z = bx + s_dx, bz + s_dz
                                        sc_x, sc_z = cx + s_dx, cz + s_dz
                                        tmin_x = min(sa_x, sb_x, sc_x)
                                        tmax_x = max(sa_x, sb_x, sc_x)
                                        tmin_z = min(sa_z, sb_z, sc_z)
                                        tmax_z = max(sa_z, sb_z, sc_z)
                                        for rx, rz, rr in s_cand:
                                            if (
                                                rx < tmin_x - rr
                                                or rx > tmax_x + rr
                                                or rz < tmin_z - rr
                                                or rz > tmax_z + rr
                                            ):
                                                continue
                                            if dist_point_to_triangle_2d_sq(
                                                rx, rz, sa_x, sa_z, sb_x, sb_z, sc_x, sc_z
                                            ) <= (rr * rr):
                                                hits_disc = True
                                                break
                                        if hits_disc:
                                            break
                                    if not hits_disc:
                                        s_dy = -s_dz
                                        for vi in vert_indices:
                                            obj.data.vertices[vi].co.x += s_dx
                                            obj.data.vertices[vi].co.y += s_dy
                                        c_min_x += s_dx
                                        c_max_x += s_dx
                                        c_min_y += s_dy
                                        c_max_y += s_dy
                                        c_cx += s_dx
                                        c_cy += s_dy
                                        c_cz += s_dz
                                        c_world_min_z += s_dz
                                        c_world_max_z += s_dz
                                        rescued = True
                                        break
                                if rescued:
                                    break
                    if not rescued:
                        total_road_clipped += len(sp)
                        continue

                tile_accepted_boxes.append((c_min_x, c_max_x, c_world_min_z, c_world_max_z))
                shell_records.append(
                    {
                        "polys": sp,
                        "vert_indices": vert_indices,
                        "min_x": c_min_x,
                        "max_x": c_max_x,
                        "min_y": c_min_y,
                        "max_y": c_max_y,
                        "min_z": c_min_z,
                        "max_z": c_max_z,
                        "h": c_h,
                        "cx": c_cx,
                        "cy": c_cy,
                    }
                )

            if not shell_records:
                continue

            # 最低標高順にソートし、連結シェル単位で接地または下部躯体支持を判定
            # Why DEM5A 基準で浮遊判定するか:
            # _BATCHID が失われた単一バッチタイル（data155, 140, 152, 156, 158, 182, 183, 187）では
            # 渋谷の急勾配斜面（道玄坂・神泉・代官山・東）で 45m 以内に 5〜15m の実標高差が生じるため、
            # 近傍最小標高との差分ではなく各シェル自身位置の GSI DEM5A 標高＋ジオイド高との差分で真の浮遊スラブのみを除外する。
            shell_records.sort(key=lambda s: s["min_z"])
            bid_z_min = shell_records[0]["min_z"]
            tile_geoid_offset = 36.7
            if is_single_batch_tile:
                geoid_samples = sorted(
                    s["min_z"] - sample_shibuya_dem_tp(s["cx"], -s["cy"]) for s in shell_records
                )
                tile_geoid_offset = geoid_samples[len(geoid_samples) // 2]
            supported_shells = []

            for rec in shell_records:
                is_at_bid_base = rec["min_z"] <= bid_z_min + 0.5
                supporting = None
                overlaps_detached_above = False
                rec_area = max(1.0, (rec["max_x"] - rec["min_x"]) * (rec["max_y"] - rec["min_y"]))
                if not is_at_bid_base:
                    for g in reversed(supported_shells):
                        overlap_w = min(g["max_x"], rec["max_x"]) - max(g["min_x"], rec["min_x"])
                        overlap_d = min(g["max_y"], rec["max_y"]) - max(g["min_y"], rec["min_y"])
                        if overlap_w <= 0.0 or overlap_d <= 0.0:
                            continue
                        xy_overlaps = overlap_w >= 2.5 and overlap_d >= 2.5
                        z_rests_on_roof = abs(rec["min_z"] - g["max_z"]) <= 0.8
                        if xy_overlaps and z_rests_on_roof:
                            supporting = g
                            break
                        if (overlap_w * overlap_d) >= 0.35 * rec_area and rec["min_z"] > g[
                            "max_z"
                        ] + 1.2:
                            overlaps_detached_above = True

                if is_single_batch_tile:
                    expected_ground_alt = (
                        sample_shibuya_dem_tp(rec["cx"], -rec["cy"]) + tile_geoid_offset
                    )
                    is_floating_slab = supporting is None and (
                        overlaps_detached_above or (rec["min_z"] - expected_ground_alt) > 8.5
                    )
                else:
                    is_floating_slab = (
                        not is_at_bid_base
                        and supporting is None
                        and (rec["min_z"] - bid_z_min) > 2.0
                    )
                if is_floating_slab:
                    total_floating_dropped += len(rec["polys"])
                    continue

                # 傾斜地の独立棟・単体棟は自らの底面を z=0.0 へ完全接地
                shift_z = supporting["shift_z"] if supporting is not None else rec["min_z"]

                rec["shift_z"] = shift_z
                supported_shells.append(rec)

                cid = next_comp_id
                next_comp_id += 1
                comp_h = max(
                    h if (len(shell_records) == 1 and not is_single_batch_tile) else rec["h"],
                    rec["h"],
                )
                comp_info[cid] = (shift_z, comp_h, rec["cx"], rec["cy"])
                for p in rec["polys"]:
                    valid_poly_comp[p.index] = cid
                for vi in rec["vert_indices"]:
                    vert_z_offset[vi] = shift_z

        # 4. 決定されたシェル別オフセットで全頂点を接地（高台・傾斜地の空中浮遊を根絶）
        for vi, v in enumerate(obj.data.vertices):
            if vi in vert_z_offset:
                v.co.z = max(0.0, v.co.z - vert_z_offset[vi])
            else:
                v.co.z = 0.0
        obj.data.update()
        if total_floating_dropped > 0:
            print(
                f"[PLATEAU] {tile_name}: Dropped {total_floating_dropped} floating detached slab faces"
            )

        # 5. BMesh による除外面先行削除・コンポーネント別トポロジー/外向き法線修復・LOD2マテリアル・UV割り当て
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bm.faces.ensure_lookup_table()
        cid_layer = bm.faces.layers.int.new("cid")
        for poly_idx, f in enumerate(bm.faces):
            f[cid_layer] = valid_poly_comp.get(poly_idx, 0)

        # 除外面・極小縮退面を先に削除してから法線修復する（未削除面との共有辺による法線反転を防止）
        initial_bad_faces = [f for f in bm.faces if f[cid_layer] == 0 or f.calc_area() < 1e-4]
        if initial_bad_faces:
            bmesh.ops.delete(bm, geom=initial_bad_faces, context="FACES")
        isolated_verts = [v for v in bm.verts if not v.link_faces]
        if isolated_verts:
            bmesh.ops.delete(bm, geom=isolated_verts, context="VERTS")
        bm.faces.ensure_lookup_table()

        # コンポーネントごとに重複頂点を結合（異なるビル同士の誤結合を防ぐ）
        cid_verts_map: dict[int, set[bmesh.types.BMVert]] = collections.defaultdict(set)
        for f in bm.faces:
            cid_val = f[cid_layer]
            if cid_val > 0:
                for v in f.verts:
                    cid_verts_map[cid_val].add(v)
        for cid_val in sorted(cid_verts_map.keys()):
            c_verts = [v for v in cid_verts_map[cid_val] if v.is_valid]
            if len(c_verts) >= 3:
                bmesh.ops.remove_doubles(bm, verts=c_verts, dist=0.005)

        collapsed_faces = [f for f in bm.faces if f.calc_area() < 1e-4]
        if collapsed_faces:
            bmesh.ops.delete(bm, geom=collapsed_faces, context="FACES")
        isolated_verts = [v for v in bm.verts if not v.link_faces]
        if isolated_verts:
            bmesh.ops.delete(bm, geom=isolated_verts, context="VERTS")
        bm.faces.ensure_lookup_table()

        # コンポーネント単位で外向き法線と符号付き体積・屋上法線の上向き整合性を保証する
        comp_faces_map: dict[int, list[bmesh.types.BMFace]] = collections.defaultdict(list)
        for f in bm.faces:
            cid_val = f[cid_layer]
            if cid_val > 0:
                comp_faces_map[cid_val].append(f)

        for _cid_val, c_faces in comp_faces_map.items():
            bmesh.ops.recalc_face_normals(bm, faces=c_faces)
            for f in c_faces:
                f.normal_update()

            c_coords = [v.co for f in c_faces for v in f.verts]
            if not c_coords:
                continue
            comp_min_z = min(co.z for co in c_coords)
            comp_max_z = max(co.z for co in c_coords)
            avg_x = sum(co.x for co in c_coords) / len(c_coords)
            avg_y = sum(co.y for co in c_coords) / len(c_coords)
            ref = Vector((avg_x, avg_y, (comp_min_z + comp_max_z) * 0.5))

            signed_vol = 0.0
            top_roof_dot = 0.0
            outward_dot = 0.0
            for f in c_faces:
                area = f.calc_area()
                fc = f.calc_center_median()
                outward_dot += (fc - ref).dot(f.normal) * area
                if abs(f.normal.z) > 0.7 and fc.z >= max(comp_min_z + 0.8, comp_max_z - 0.5):
                    top_roof_dot += area * f.normal.z
                if len(f.verts) >= 3:
                    v0 = f.verts[0].co - ref
                    for ki in range(1, len(f.verts) - 1):
                        v1 = f.verts[ki].co - ref
                        v2 = f.verts[ki + 1].co - ref
                        signed_vol += v0.dot(v1.cross(v2))

            need_flip = (top_roof_dot < -0.5) or (
                abs(top_roof_dot) <= 0.5
                and (signed_vol < -1.0 or (abs(signed_vol) <= 1.0 and outward_dot < 0.0))
            )
            if need_flip:
                bmesh.ops.reverse_faces(bm, faces=c_faces)
                for f in c_faces:
                    f.normal_update()

            comp_h_span = comp_max_z - comp_min_z
            for f in c_faces:
                if abs(f.normal.z) > 0.80:
                    fc = f.calc_center_median()
                    should_flip = (fc.z <= comp_min_z + 0.25 and f.normal.z > 0.0) or (
                        comp_h_span >= 1.5 and fc.z >= comp_max_z - 0.35 and f.normal.z < 0.0
                    )
                    if should_flip:
                        f.normal_flip()
                        f.normal_update()

        bm.normal_update()
        uv_layer = bm.loops.layers.uv.verify()

        comp_roof_faces: dict[int, list[tuple[float, float, float, float, float]]] = (
            collections.defaultdict(list)
        )
        comp_wall_mat: dict[int, int] = {}

        for f in bm.faces:
            cid = f[cid_layer]
            if cid not in comp_info:
                continue

            _z_base, bldg_h, _b_cx, _b_cy = comp_info[cid]
            normal_z = f.normal.z
            is_roof = normal_z > 0.45
            is_floor = normal_z < -0.45

            if is_floor:
                # 地盤底面（閉じたソリッドを維持しつつ地面直下に配置）
                f.material_index = 4  # PlateauRooftop (暗色床)
                for loop in f.loops:
                    loop[uv_layer].uv = (loop.vert.co.x / 8.0, -loop.vert.co.y / 8.0)
                continue

            if is_roof:
                f.material_index = 4  # PlateauRooftop
                for loop in f.loops:
                    loop[uv_layer].uv = (loop.vert.co.x / 8.0, -loop.vert.co.y / 8.0)
                # 塔屋配置用: 単一屋根面の中心と面積・高さを記録（最上階水平屋根のみ対象・中庭越しの浮遊を防止）
                fc = f.calc_center_median()
                if normal_z > 0.92 and fc.z >= max(10.0, bldg_h * 0.55):
                    xs = [v.co.x for v in f.verts]
                    ys = [v.co.y for v in f.verts]
                    min_span = min(max(xs) - min(xs), max(ys) - min(ys)) if xs else 0.0
                    comp_roof_faces[cid].append((f.calc_area(), fc.x, fc.y, fc.z, min_span))
                continue

            # 垂直壁面（Wall）: 上階外壁は MAT_ALLEY / MAT_COMMERCIAL / MAT_TOWER をビル単位で一貫割当
            # Why MAT_STOREFRONT を上階外壁へ割り当てないか:
            # 1F 専用ショップフロント（玄関ガラス扉・店頭看板帯）が 2F〜5F へ反復貼付される不自然さを完全に排除するため。
            if bldg_h < 24.0:
                mat_wall = MAT_ALLEY if (cid % 3 != 0) else MAT_COMMERCIAL
            elif bldg_h < 46.0:
                if cid % 4 == 0:
                    mat_wall = MAT_TOWER if bldg_h >= 32.0 else MAT_ALLEY
                elif cid % 4 == 1:
                    mat_wall = MAT_ALLEY
                else:
                    mat_wall = MAT_COMMERCIAL
            else:
                mat_wall = MAT_TOWER if (cid % 3 != 0) else MAT_COMMERCIAL

            f.material_index = mat_wall
            if cid not in comp_wall_mat:
                comp_wall_mat[cid] = mat_wall

        # 6. 地中不可視の底面（is_floor）を削除し、同一平面を統合したクリーン躯体へ
        #    整数窓スパン・整数階高 UV（角・屋根際の窓切れゼロ）を割り当てたうえで、
        #    3段階距離LOD（LOD1 3D陰影ベイク軽量躯体・LOD2 遠景スカイライン・LOD0 立体造形）を構築する。
        bpy.data.objects.remove(obj, do_unlink=True)

        floor_faces = [f for f in bm.faces if f.normal.z < -0.55]
        if floor_faces:
            bmesh.ops.delete(bm, geom=floor_faces, context="FACES")
            iso_v = [v for v in bm.verts if not v.link_faces]
            if iso_v:
                bmesh.ops.delete(bm, geom=iso_v, context="VERTS")
            bm.faces.ensure_lookup_table()

        # 同一平面の冗長な三角形分割を統合し（角度差 <= 2.5°）、外壁面ごとに連続した 1 枚パネル化
        if len(bm.edges) > 0:
            bmesh.ops.dissolve_limit(
                bm,
                angle_limit=math.radians(2.5),
                use_dissolve_boundaries=False,
                verts=list(bm.verts),
                edges=list(bm.edges),
                delimit={"MATERIAL"},
            )
            bm.normal_update()
            bm.faces.ensure_lookup_table()

        # 平面統合済み外壁面へ整数窓スパン・整数階高 UV を適用（全4,159棟の隅・屋根際の窓切れを根絶）
        wall_segments_by_cid = _assign_integer_bay_wall_uvs(bm, cid_layer, uv_layer, comp_info)

        # 棟別 LOD1 微細色調バリエーション & LOD2 頂点カラーパレット
        lod1_mat_map = {
            MAT_TOWER: LOD1_MAT_GLASS,
            MAT_COMMERCIAL: LOD1_MAT_COMMERCIAL,
            MAT_ALLEY: LOD1_MAT_ALLEY,
            MAT_STOREFRONT: LOD1_MAT_ALLEY,
            MAT_ROOF: LOD1_MAT_ROOF,
            MAT_PITCHED_ROOF: LOD1_MAT_ROOF,
            MAT_DARK_FRAME: LOD1_MAT_ROOF,
        }
        lod2_tint_by_mat = {
            MAT_TOWER: (0.64, 0.75, 0.88, 1.0),
            MAT_COMMERCIAL: (0.94, 0.94, 0.95, 1.0),
            MAT_STOREFRONT: (0.94, 0.86, 0.76, 1.0),
            MAT_ALLEY: (0.90, 0.80, 0.70, 1.0),
        }
        roof_lod2_tint = (0.52, 0.54, 0.58, 1.0)
        roof_lod_uv = (0.006, 0.006)

        # 6a. LOD1（中距離 135m〜235m）軽量躯体メッシュをスナップショット構築
        #     LOD0 の 3D 庇・マリオン陰影を焼き込んだ専用 512px テクスチャ（Glass/Commercial/Alley/Roof の 4 系統）＋基礎スカート
        mid_mesh = None
        if len(bm.faces) > 0:
            bm_mid = bm.copy()
            mid_cid_layer = bm_mid.faces.layers.int.get("cid")
            mid_uv_layer = bm_mid.loops.layers.uv.verify()
            mid_col_layer = bm_mid.loops.layers.color.new("Col")
            if mid_cid_layer is not None:
                for mf in bm_mid.faces:
                    mcid = mf[mid_cid_layer]
                    is_mid_roof = mf.normal.z > 0.45 or mf.material_index == MAT_ROOF
                    if is_mid_roof:
                        mf.material_index = LOD1_MAT_ROOF
                        tint = (0.96, 0.96, 0.98, 1.0)
                    else:
                        mf.material_index = lod1_mat_map.get(mf.material_index, LOD1_MAT_COMMERCIAL)
                        # 隣接同系統ビル間で僅かな個体差（0.98〜1.06）を付与し LOD0 との全体輝度を精密一致
                        v_shift = 0.98 + ((mcid * 17) % 9) * 0.01
                        tint = (v_shift, v_shift, v_shift, 1.0)
                    for mlp in mf.loops:
                        mlp[mid_col_layer] = tint
                # 傾斜地でも 1F 外壁 UV が伸びないよう独立基礎スカート（LOD1_MAT_ROOF）を底面下へ追加
                _add_foundation_skirts(
                    bm_mid,
                    mid_cid_layer,
                    mid_uv_layer,
                    wall_segments_by_cid,
                    LOD1_MAT_ROOF,
                    col_layer=mid_col_layer,
                )
            bm_mid.verts.index_update()
            bm_mid.verts.ensure_lookup_table()
            mid_vert_cid: dict[bmesh.types.BMVert, int] = {}
            if mid_cid_layer is not None:
                for mf in bm_mid.faces:
                    mcid = mf[mid_cid_layer]
                    if mcid > 0:
                        for mv in mf.verts:
                            if mv not in mid_vert_cid:
                                mid_vert_cid[mv] = mcid
            for mv in bm_mid.verts:
                mcid = mid_vert_cid.get(mv, 0)
                if mcid in comp_info:
                    _zb, _bh, b_cx, b_cy = comp_info[mcid]
                    mv.co.z += sample_shibuya_terrain_y(b_cx, -b_cy)
            bm_mid.normal_update()
            mid_mesh = bpy.data.meshes.new(f"ShibuyaPlateauMidMesh_{tile_name}")
            bm_mid.to_mesh(mid_mesh)
            bm_mid.free()

        # 6b. LOD2（遠景 235m〜800m）超軽量箱型スカイラインプロキシメッシュを構築（1ドローコール・256px対モアレテクスチャ＋頂点カラー）
        eval_mesh = None
        if len(bm.faces) > 0:
            comp_bounds: dict[int, list[float]] = {}
            for f in bm.faces:
                fcid = f[cid_layer]
                if fcid <= 0:
                    continue
                b = comp_bounds.get(fcid)
                if b is None:
                    b = [
                        float("inf"),
                        float("-inf"),
                        float("inf"),
                        float("-inf"),
                        float("inf"),
                        float("-inf"),
                    ]
                    comp_bounds[fcid] = b
                for v in f.verts:
                    co = v.co
                    if co.x < b[0]:
                        b[0] = co.x
                    if co.x > b[1]:
                        b[1] = co.x
                    if co.y < b[2]:
                        b[2] = co.y
                    if co.y > b[3]:
                        b[3] = co.y
                    if co.z < b[4]:
                        b[4] = co.z
                    if co.z > b[5]:
                        b[5] = co.z

            bm_proxy = bmesh.new()
            proxy_uv_layer = bm_proxy.loops.layers.uv.verify()
            proxy_col_layer = bm_proxy.loops.layers.color.new("Col")
            for p_cid, (x0, x1, y0, y1, z0, z1) in comp_bounds.items():
                bh = z1 - z0
                bw = x1 - x0
                bd = y1 - y0
                if bh < 10.0 and (bw * bd) < 80.0:
                    continue
                if bw < 1.5 or bd < 1.5 or bh < 3.0:
                    continue
                pc_wx = 0.5 * (x0 + x1)
                pc_wz = -0.5 * (y0 + y1)
                pc_ty = sample_shibuya_terrain_y(pc_wx, pc_wz)
                bot_z = pc_ty - 3.5
                top_z = pc_ty + max(bh, 3.0)
                wall_tint = lod2_tint_by_mat.get(
                    comp_wall_mat.get(p_cid, MAT_COMMERCIAL), (0.90, 0.92, 0.95, 1.0)
                )
                vb = [
                    bm_proxy.verts.new(Vector((x0, y0, bot_z))),
                    bm_proxy.verts.new(Vector((x1, y0, bot_z))),
                    bm_proxy.verts.new(Vector((x1, y1, bot_z))),
                    bm_proxy.verts.new(Vector((x0, y1, bot_z))),
                ]
                vt = [
                    bm_proxy.verts.new(Vector((x0, y0, top_z))),
                    bm_proxy.verts.new(Vector((x1, y0, top_z))),
                    bm_proxy.verts.new(Vector((x1, y1, top_z))),
                    bm_proxy.verts.new(Vector((x0, y1, top_z))),
                ]
                for si in range(4):
                    ni = (si + 1) % 4
                    edge_len = (vb[ni].co - vb[si].co).length
                    try:
                        pf = bm_proxy.faces.new([vb[si], vb[ni], vt[ni], vt[si]])
                        u_end = max(1, round(edge_len / 2.3)) * 0.25
                        v_end = max(1, round((top_z - bot_z) / 3.1)) * 0.25
                        uvs = [(0.0, 0.0), (u_end, 0.0), (u_end, v_end), (0.0, v_end)]
                        for lp, uv_val in zip(pf.loops, uvs, strict=True):
                            lp[proxy_uv_layer].uv = uv_val
                            lp[proxy_col_layer] = wall_tint
                    except Exception:
                        pass
                try:
                    pf_top = bm_proxy.faces.new([vt[0], vt[1], vt[2], vt[3]])
                    for lp in pf_top.loops:
                        lp[proxy_uv_layer].uv = roof_lod_uv
                        lp[proxy_col_layer] = roof_lod2_tint
                except Exception:
                    pass

            if len(bm_proxy.faces) > 0:
                bm_proxy.normal_update()
                eval_mesh = bpy.data.meshes.new(f"ShibuyaPlateauProxyMesh_{tile_name}")
                bm_proxy.to_mesh(eval_mesh)
            bm_proxy.free()

        # 7. LOD0 近景詳細タイルへ整数窓スパン・整数階高同期 Blender 3D 建築モデリング＋独立基礎スカートを追加
        pitched_cnt = _sculpt_buildings_lod0(
            bm, cid_layer, uv_layer, comp_info, comp_roof_faces, wall_segments_by_cid
        )
        _add_foundation_skirts(bm, cid_layer, uv_layer, wall_segments_by_cid, MAT_DARK_FRAME)

        # 7b. 全詳細シェル＋3D建築パーツ＋基礎スカートを 3D 地形標高（sample_shibuya_terrain_y）へ均一シフト
        # Why v.co.z <= 0.15 の条件引き伸ばしを廃止し独立基礎スカート＋均一 +ty シフトにしたか:
        # 1F 外壁テクスチャの下端頂点を地中 -3.5m へ引き伸ばすと道玄坂・宮益坂等の急勾配で 1F 窓が縦に伸びるため。
        bm.verts.index_update()
        bm.verts.ensure_lookup_table()
        vert_cid: dict[bmesh.types.BMVert, int] = {}
        for f in bm.faces:
            fcid = f[cid_layer]
            if fcid > 0:
                for v in f.verts:
                    if v not in vert_cid:
                        vert_cid[v] = fcid
        for v in bm.verts:
            fcid = vert_cid.get(v, 0)
            if fcid in comp_info:
                _zb, _bh, b_cx, b_cy = comp_info[fcid]
                v.co.z += sample_shibuya_terrain_y(b_cx, -b_cy)

        # 8. 3段階 LOD（LOD0詳細・LOD1 3D陰影ベイク中距離・LOD2 遠景プロキシ）メッシュをシーンへ出力
        bm.normal_update()
        tile_faces_count = len(bm.faces)
        tile_comp_count = len(comp_info)
        total_components_kept += tile_comp_count
        total_faces_kept += tile_faces_count

        if tile_faces_count > 0:
            tile_mesh = bpy.data.meshes.new(f"ShibuyaPlateauTileMesh_{tile_name}")
            for m in materials["lod0"]:
                tile_mesh.materials.append(m)
            bm.to_mesh(tile_mesh)

            tile_obj = bpy.data.objects.new(f"PlateauTile_{tile_name}", tile_mesh)
            bpy.context.scene.collection.objects.link(tile_obj)
            tile_obj["tile_id"] = tile_name
            tile_obj["is_plateau_tile"] = True

            mid_poly_count = len(mid_mesh.polygons) if mid_mesh is not None else 0
            if mid_mesh is not None and mid_poly_count > 0:
                for m_mid in materials["lod1"]:
                    mid_mesh.materials.append(m_mid)
                mid_mesh.validate()

                mid_obj = bpy.data.objects.new(f"PlateauMidTile_{tile_name}", mid_mesh)
                bpy.context.scene.collection.objects.link(mid_obj)
                mid_obj["tile_id"] = tile_name
                mid_obj["is_plateau_mid"] = True
                mid_obj["target_tile"] = f"PlateauTile_{tile_name}"
            elif mid_mesh is not None:
                bpy.data.meshes.remove(mid_mesh)

            proxy_poly_count = len(eval_mesh.polygons) if eval_mesh is not None else 0
            if eval_mesh is not None and proxy_poly_count > 0:
                eval_mesh.name = f"ShibuyaPlateauProxyMesh_{tile_name}"
                eval_mesh.materials.clear()
                eval_mesh.materials.append(materials["lod2"])
                for p in eval_mesh.polygons:
                    p.material_index = 0
                eval_mesh.validate()

                proxy_obj = bpy.data.objects.new(f"PlateauProxyTile_{tile_name}", eval_mesh)
                bpy.context.scene.collection.objects.link(proxy_obj)
                proxy_obj["tile_id"] = tile_name
                proxy_obj["is_plateau_proxy"] = True
                proxy_obj["target_tile"] = f"PlateauTile_{tile_name}"
            elif eval_mesh is not None:
                bpy.data.meshes.remove(eval_mesh)

            bm.free()
            print(
                f"[PLATEAU] Built {tile_name} ({tile_comp_count} bldgs, {pitched_cnt} pitched): "
                f"LOD0={tile_faces_count}f, LOD1={mid_poly_count}f, LOD2={proxy_poly_count}f"
            )
        else:
            if mid_mesh is not None:
                bpy.data.meshes.remove(mid_mesh)
            if eval_mesh is not None:
                bpy.data.meshes.remove(eval_mesh)
            bm.free()

    print(
        f"[PLATEAU] Total {total_buildings} raw buildings across {len(PLATEAU_TILES)} tiles -> "
        f"kept {total_components_kept} building shells ({total_faces_kept} faces), "
        f"skipped {total_landmarks_skipped} landmark/micro faces, "
        f"clipped {total_road_clipped} roadway faces."
    )

    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.abspath(os.path.join(script_dir, "..", ".."))
    out_public_glb = os.path.join(
        project_root, "apps", "web", "public", "models", "shibuya_plateau_buildings.glb"
    )
    out_dist_glb = os.path.join(
        project_root, "apps", "web", "dist", "models", "shibuya_plateau_buildings.glb"
    )

    os.makedirs(os.path.dirname(out_public_glb), exist_ok=True)
    # Draco 圧縮により全 20 タイル × 3 段階 LOD（LOD0 3D建築ディテール + LOD1 中距離 + LOD2 遠景）を軽量配信サイズへ最適化
    bpy.ops.export_scene.gltf(
        filepath=out_public_glb,
        export_format="GLB",
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=10,
        export_draco_texcoord_quantization=12,
    )
    print(
        f"[PLATEAU] Successfully exported {out_public_glb} ({os.path.getsize(out_public_glb) / 1024 / 1024:.2f} MB)"
    )

    if os.path.exists(os.path.dirname(out_dist_glb)):
        import shutil

        shutil.copyfile(out_public_glb, out_dist_glb)
        print(f"[PLATEAU] Synchronized to dist: {out_dist_glb}")

    return out_public_glb


def render_360_review(review_dir: str) -> None:
    """AGENTS.md 1節に準拠した360度マルチアングル収束レビュー画像をレンダリングする"""
    os.makedirs(review_dir, exist_ok=True)
    scene = bpy.context.scene

    # 詳細メッシュレビュー時は中距離/遠景プロキシとの重複Z-fightingを避けるため LOD1/LOD2 側を非表示にする
    for obj in bpy.data.objects:
        if obj.name.startswith("PlateauProxyTile_") or obj.name.startswith("PlateauMidTile_"):
            obj.hide_render = True
            obj.hide_viewport = True

    avail_engines = [
        e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items
    ]
    if "BLENDER_EEVEE_NEXT" in avail_engines:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    elif "BLENDER_EEVEE" in avail_engines:
        scene.render.engine = "BLENDER_EEVEE"
    elif "CYCLES" in avail_engines:
        scene.render.engine = "CYCLES"
        try:
            cycles_prefs = bpy.context.preferences.addons["cycles"].preferences
            cycles_prefs.refresh_devices()
            metal_devices = [d for d in cycles_prefs.devices if d.type == "METAL"]
            if metal_devices:
                cycles_prefs.compute_device_type = "METAL"
                for d in cycles_prefs.devices:
                    d.use = d.type == "METAL"
                scene.cycles.device = "GPU"
            else:
                scene.cycles.device = "CPU"
        except Exception:
            scene.cycles.device = "CPU"

        scene.cycles.samples = 8
        scene.cycles.preview_samples = 4
        scene.cycles.max_bounces = 3
        scene.cycles.diffuse_bounces = 2
        scene.cycles.glossy_bounces = 2
        scene.cycles.transparent_max_bounces = 2
        scene.cycles.use_denoising = False

    scene.render.resolution_x = 800
    scene.render.resolution_y = 450

    world = scene.world
    if not world.use_nodes:
        world.use_nodes = True
    bg = next((n for n in world.node_tree.nodes if n.type == "BACKGROUND"), None)
    if bg:
        bg.inputs["Color"].default_value = (0.50, 0.58, 0.72, 1.0)
        bg.inputs["Strength"].default_value = 0.85

    # 渋谷エリア広域を覆うアスファルト地面メッシュ
    ground_mesh = bpy.data.meshes.new("ReviewGroundMesh")
    ground_bm = bmesh.new()
    bmesh.ops.create_grid(ground_bm, x_segments=2, y_segments=2, size=2600)
    ground_bm.to_mesh(ground_mesh)
    ground_bm.free()
    ground_obj = bpy.data.objects.new("ReviewGround", ground_mesh)
    ground_obj.location = Vector((-950.0, -350.0, -0.05))
    ground_mat = bpy.data.materials.new("ReviewGroundMat")
    ground_mat.use_nodes = True
    bsdf_g = next(n for n in ground_mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf_g.inputs["Base Color"].default_value = (0.16, 0.17, 0.19, 1.0)
    bsdf_g.inputs["Roughness"].default_value = 0.85
    ground_mesh.materials.append(ground_mat)
    scene.collection.objects.link(ground_obj)

    # 自然な日光ライティング
    for idx, (loc, rot, energy) in enumerate(
        [
            ((150.0, -250.0, 350.0), (math.radians(48), 0.0, math.radians(32)), 1.25),
            ((-200.0, 250.0, 200.0), (math.radians(65), 0.0, math.radians(-135)), 0.55),
        ]
    ):
        light_data = bpy.data.lights.new(name=f"Sun_{idx}", type="SUN")
        light_data.energy = energy
        light_obj = bpy.data.objects.new(name=f"Sun_{idx}", object_data=light_data)
        scene.collection.objects.link(light_obj)
        light_obj.location = loc
        light_obj.rotation_euler = rot

    cam_data = bpy.data.cameras.new("PlateauReviewCamera")
    cam_data.lens = 28.0  # 人間の視野・車内フロントガラス広角視野に近い28mm
    cam_data.clip_end = 3000.0
    cam_obj = bpy.data.objects.new("PlateauReviewCamera", cam_data)
    scene.collection.objects.link(cam_obj)
    scene.camera = cam_obj

    # 渋谷エリア 1:1 非反転 実座標の主要6大スポット（各スポット360度マルチアングル + 俯瞰）
    review_spots = [
        {
            "id": "spot1_scramble_109_y_fork",
            "name": "スクランブル交差点〜109前Y字路（道玄坂下・文化村通り）",
            "center": Vector((-990.7, -275.8, sample_shibuya_terrain_y(-990.7, 275.8) + 2.0)),
            "birdseye_height": 85.0,
            "look_radius": 65.0,
        },
        {
            "id": "spot2_dogenzaka_ue_tamagawa",
            "name": "道玄坂上・玉川通り合流・神泉町（西進傾斜エリア）",
            "center": Vector((-1440.0, -675.0, sample_shibuya_terrain_y(-1440.0, 675.0) + 2.2)),
            "birdseye_height": 70.0,
            "look_radius": 55.0,
        },
        {
            "id": "spot3_bunkamura_shoto",
            "name": "文化村通り・東急本店前・松濤二丁目",
            "center": Vector((-1325.0, -151.3, sample_shibuya_terrain_y(-1325.0, 151.3) + 2.0)),
            "birdseye_height": 65.0,
            "look_radius": 50.0,
        },
        {
            "id": "spot4_koen_dori_parco",
            "name": "渋谷公園通り・PARCO前・オルガン坂",
            "center": Vector((-1108.1, 43.6, sample_shibuya_terrain_y(-1108.1, -43.6) + 2.2)),
            "birdseye_height": 70.0,
            "look_radius": 50.0,
        },
        {
            "id": "spot5_sakurazaka_cerulean",
            "name": "桜丘町・さくら坂・セルリアンタワー周辺",
            "center": Vector((-974.8, -519.7, sample_shibuya_terrain_y(-974.8, 519.7) + 2.0)),
            "birdseye_height": 70.0,
            "look_radius": 50.0,
        },
        {
            "id": "spot6_miyamasuzaka_shita",
            "name": "宮益坂下交差点・明治通り（渋谷駅北東・原宿方面見通し）",
            "center": Vector((-818.4, -245.8, sample_shibuya_terrain_y(-818.4, 245.8) + 2.2)),
            "birdseye_height": 85.0,
            "look_radius": 65.0,
        },
        {
            "id": "spot7_harajuku_jingumae",
            "name": "明治通り北・神宮前〜原宿駅前（北帯新設タイル群）",
            "center": Vector((-825.0, 265.6, sample_shibuya_terrain_y(-825.0, -265.6) + 2.2)),
            "birdseye_height": 90.0,
            "look_radius": 65.0,
        },
        {
            "id": "spot8_shibuyabashi_ebisu",
            "name": "明治通り南・渋谷橋〜恵比寿（南東・南帯新設タイル群）",
            "center": Vector((-457.3, -725.0, sample_shibuya_terrain_y(-457.3, 725.0) + 2.2)),
            "birdseye_height": 90.0,
            "look_radius": 65.0,
        },
    ]

    directions = [
        ("000_north", 0.0),
        ("045_northeast", 45.0),
        ("090_east", 90.0),
        ("135_southeast", 135.0),
        ("180_south", 180.0),
        ("225_southwest", 225.0),
        ("270_west", 270.0),
        ("315_northwest", 315.0),
    ]

    rendered_count = 0
    for spot in review_spots:
        spot_id = spot["id"]
        spot_center = spot["center"]
        look_r = spot["look_radius"]

        # A. アイレベル 360度 全8方位レンダリング（非反転 Blender: +X=東, +Y=北, -Y=南）
        for dir_name, deg in directions:
            rad = math.radians(deg)
            cam_obj.location = spot_center
            dx = math.sin(rad) * look_r
            dy = math.cos(rad) * look_r
            target = spot_center + Vector((dx, dy, 14.0))
            direction = target - spot_center
            cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

            out_file = os.path.join(review_dir, f"{spot_id}_{dir_name}.png")
            scene.render.filepath = out_file
            bpy.ops.render.render(write_still=True)
            rendered_count += 1

        # B. スポット直上からの高解像度俯瞰（Birdseye View）
        bh = spot["birdseye_height"]
        cam_obj.location = spot_center + Vector((0.0, 0.0, bh))
        cam_obj.rotation_euler = (0.0, 0.0, 0.0)
        out_file = os.path.join(review_dir, f"{spot_id}_999_birdseye.png")
        scene.render.filepath = out_file
        bpy.ops.render.render(write_still=True)
        rendered_count += 1

    # C. 渋谷エリア全域高空バードズアイ（南西俯瞰・北東俯瞰・真上マップ全景の3視点）
    overview_views = [
        (
            "00_shibuya_metropolis_high_birdseye_sw.png",
            Vector((-1550.0, -1050.0, 720.0)),
            Vector((-950.0, -280.0, 30.0)),
        ),
        (
            "00_shibuya_metropolis_high_birdseye_ne.png",
            Vector((-350.0, 450.0, 680.0)),
            Vector((-950.0, -350.0, 30.0)),
        ),
        (
            "00_shibuya_metropolis_topdown.png",
            Vector((-980.0, -320.0, 1450.0)),
            Vector((-980.0, -320.0, 0.0)),
        ),
    ]
    for fname, loc, tgt in overview_views:
        cam_obj.location = loc
        direction = tgt - cam_obj.location
        cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        out_file = os.path.join(review_dir, fname)
        scene.render.filepath = out_file
        bpy.ops.render.render(write_still=True)
        rendered_count += 1

    print(f"[Review] Complete: Rendered {rendered_count} 360-degree review images to {review_dir}")


if __name__ == "__main__":
    generate_shibuya_plateau_city()
    if "--render-review" in sys.argv:
        idx = sys.argv.index("--render-review")
        target_dir = sys.argv[idx + 1] if idx + 1 < len(sys.argv) else "/tmp/shibuya_plateau_review"
        render_360_review(target_dir)

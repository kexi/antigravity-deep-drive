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

# 東京駅丸の内原点と渋谷アンカー
ORIGIN_LAT = 35.68158
ORIGIN_LON = 139.76525
SHIBUYA_ORIGIN_LAT = 35.65722
SHIBUYA_ORIGIN_LON = 139.70319
SHIBUYA_LOCAL_ANCHOR_X = -695.0
SHIBUYA_LOCAL_ANCHOR_Z = -15.0
METERS_PER_DEG_LAT = 110946.25
METERS_PER_DEG_LON = 111319.49 * math.cos(ORIGIN_LAT * math.pi / 180)

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

PLATEAU_TILES = [
    "data142",  # 宮益坂・渋谷一丁目・美竹通り
    "data143",  # 渋谷駅東口・宮下公園南
    "data147",  # センター街・宇田川町・井の頭通り
    "data150",  # 金王坂・青山通り・渋谷二丁目
    "data151",  # 渋谷駅コア・渋谷ストリーム・スクランブル交差点
    "data153",  # 明治通り南・並木橋・渋谷三丁目
    "data155",  # 道玄坂・渋谷マークシティ・SHIBUYA109
    "data157",  # 桜丘町・セルリアンタワー・サクラステージ
]

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
    """WGS84 緯度経度を渋谷ローカル3D座標系 (x, z) へ投影する（北方向が +Z、東方向が +X）"""
    east_m = (lon - SHIBUYA_ORIGIN_LON) * METERS_PER_DEG_LON
    north_m = (lat - SHIBUYA_ORIGIN_LAT) * METERS_PER_DEG_LAT
    x = SHIBUYA_LOCAL_ANCHOR_X + east_m
    z = SHIBUYA_LOCAL_ANCHOR_Z + north_m
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


# gsiPlateauLoader.ts の getOpenDataCurvedRoadCorridors() と1対1対応する実車道中心線＆クリアランス半径 (halfW + 1.8m)
EXACT_CURVED_ROAD_CLEARANCES = [
    {
        "name": "nav-road-uchibori-dori",
        "radius": 10.8,
        "points": [(-253.0, 365.0), (-165.0, 378.0), (0.0, 390.0), (165.0, 378.0), (255.0, 365.0)],
    },
    {
        "name": "nav-road-meiji-dori",
        "radius": 12.3,
        "points": [
            (-750.0, -210.0),
            (-750.0, -140.0),
            (-750.0, -68.0),
            (-750.0, 0.0),
            (-750.0, 60.0),
            (-750.0, 95.0),
            (-750.0, 150.0),
            (-750.0, 206.0),
            (-750.0, 248.0),
        ],
    },
    {
        "name": "nav-road-meiji-dori-ebisu-curve",
        "radius": 12.3,
        "points": [
            (-750.0, -210.0),
            (-756.0, -280.0),
            (-768.0, -380.0),
            (-780.0, -520.0),
            (-775.0, -680.0),
            (-762.0, -860.0),
            (-750.0, -1050.0),
        ],
    },
    {
        "name": "nav-road-meiji-dori-harajuku-curve",
        "radius": 12.3,
        "points": [
            (-750.0, 248.0),
            (-753.0, 310.0),
            (-762.0, 420.0),
            (-774.0, 580.0),
            (-780.0, 750.0),
            (-772.0, 920.0),
            (-760.0, 1050.0),
        ],
    },
    {
        "name": "nav-road-yamate-dori",
        "radius": 13.8,
        "points": [
            (-1365.0, -850.0),
            (-1355.0, -550.0),
            (-1346.0, -200.0),
            (-1348.0, 0.0),
            (-1350.0, 150.0),
            (-1358.0, 380.0),
            (-1368.0, 620.0),
            (-1362.0, 850.0),
        ],
    },
    {
        "name": "nav-road-shibuya-scramble",
        "radius": 12.8,
        "points": [(-835.0, 252.0), (-815.0, 249.0), (-775.0, 246.0), (-732.0, 248.0)],
    },
    {
        "name": "nav-road-route246",
        "radius": 10.8,
        "points": [
            (-738.0, 102.0),
            (-690.0, 106.0),
            (-632.0, 108.0),
            (-545.0, 108.0),
            (-450.0, 104.0),
            (-355.0, 98.0),
            (-283.0, 95.0),
        ],
    },
    {
        "name": "nav-road-route246-underpass-link",
        "radius": 11.8,
        "points": [(-855.0, 95.0), (-795.0, 98.5), (-738.0, 102.0)],
    },
    {
        "name": "nav-road-shibuya-dogenzaka",
        "radius": 9.8,
        "points": [
            (-837.0, 248.0),
            (-872.0, 235.0),
            (-925.0, 215.0),
            (-975.0, 188.0),
            (-1030.0, 162.0),
            (-1080.0, 140.0),
        ],
    },
    {
        "name": "nav-road-shibuya-miyamasuzaka",
        "radius": 10.3,
        "points": [
            (-732.0, 248.0),
            (-685.0, 252.0),
            (-635.0, 254.0),
            (-560.0, 250.0),
            (-480.0, 242.0),
            (-400.0, 232.0),
        ],
    },
    {
        "name": "nav-road-shibuya-bunkamura-dori",
        "radius": 8.8,
        "points": [
            (-838.0, 252.0),
            (-869.0, 282.0),
            (-905.0, 325.0),
            (-940.0, 345.0),
            (-1000.0, 360.0),
            (-1060.0, 370.0),
        ],
    },
    {
        "name": "nav-road-shibuya-koen-dori",
        "radius": 9.3,
        "points": [(-791.0, 270.0), (-798.0, 360.0), (-805.0, 440.0), (-810.0, 520.0)],
    },
    {
        "name": "nav-road-shibuya-inokashira-organ",
        "radius": 7.3,
        "points": [
            (-875.0, 320.0),
            (-856.0, 342.0),
            (-822.0, 345.0),
            (-802.0, 348.0),
            (-798.0, 358.0),
            (-756.0, 354.0),
        ],
    },
    {
        "name": "nav-road-shibuya-tamagawa-west",
        "radius": 11.8,
        "points": [
            (-855.0, 95.0),
            (-940.0, 115.0),
            (-1010.0, 128.0),
            (-1080.0, 140.0),
            (-1170.0, 146.0),
            (-1250.0, 150.0),
            (-1350.0, 150.0),
        ],
    },
    {
        "name": "nav-road-shibuya-shinsen-nakadori",
        "radius": 6.6,
        "points": [
            (-1080.0, 140.0),
            (-1100.0, 185.0),
            (-1110.0, 230.0),
            (-1100.0, 300.0),
            (-1060.0, 370.0),
        ],
    },
    {
        "name": "nav-road-shibuya-sakurazaka-loop",
        "radius": 6.8,
        "points": [
            (-855.0, 95.0),
            (-855.0, 40.0),
            (-890.0, 10.0),
            (-940.0, -30.0),
            (-950.0, -60.0),
            (-980.0, 0.0),
            (-940.0, 115.0),
        ],
    },
    {
        "name": "nav-road-shibuya-jinnan-cross",
        "radius": 7.1,
        "points": [
            (-750.0, 430.0),
            (-772.0, 434.0),
            (-798.0, 440.0),
            (-825.0, 446.0),
            (-860.0, 450.0),
        ],
    },
    {
        "name": "nav-road-shibuya-center-gai",
        "radius": 6.8,
        "points": [
            (-835.0, 268.0),
            (-850.0, 292.0),
            (-875.0, 320.0),
            (-902.0, 350.0),
            (-922.0, 356.0),
            (-940.0, 345.0),
        ],
    },
    {
        "name": "nav-road-shibuya-hikarie-access",
        "radius": 6.8,
        "points": [
            (-729.0, 248.0),
            (-729.0, 205.0),
            (-727.5, 155.0),
            (-727.5, 120.0),
            (-727.5, 102.0),
        ],
    },
    # 首都高速3号渋谷線高架橋コリドー（R246上空 X[-1252..-572], Z[83..107] と建物躯体の貫通を根絶）
    {
        "name": "shutoko-route3-viaduct",
        "radius": 12.2,
        "points": [(-1252.0, 95.0), (-1050.0, 95.0), (-865.0, 95.0), (-572.0, 95.0)],
    },
]

EXACT_INTERSECTION_CLEARANCES = [
    ((-815.0, 248.0), 23.0),
    ((-750.0, 248.0), 18.0),
    ((-1080.0, 140.0), 19.0),
    ((-1250.0, 150.0), 18.0),
    ((-940.0, 345.0), 16.0),
    ((-1060.0, 370.0), 15.0),
    ((-798.0, 360.0), 16.0),
    ((-805.0, 440.0), 15.0),
    ((-810.0, 520.0), 16.0),
    ((-875.0, 320.0), 14.0),
    ((-950.0, -60.0), 14.0),
    ((-1350.0, 150.0), 17.0),
    ((-855.0, 95.0), 22.0),
    ((-940.0, 115.0), 18.0),
    ((-750.0, 102.0), 18.0),
    ((-750.0, -210.0), 14.0),
]

# shibuya_stream.glb の高精度カスタムランドマーク建物フットプリント（重複する生PLATEAU躯体を除外）
CUSTOM_LANDMARK_EXCLUSIONS = [
    ("ShibuyaCerulean", -934.0, -868.0, -76.0, -14.0),
    ("ShibuyaFukuras", -840.0, -773.0, 21.0, 71.0),
    ("ShibuyaHikarie", -725.0, -667.0, 117.0, 174.0),
    ("ShibuyaMagnet", -781.0, -769.0, 280.0, 309.0),
    ("ShibuyaMarkCity", -918.0, -844.0, 132.0, 190.0),
    ("ShibuyaMiyashitaPark", -718.0, -672.0, 283.0, 357.0),
    ("ShibuyaParco", -858.0, -812.0, 362.0, 410.0),
    ("ShibuyaQfront109", -900.0, -805.0, 252.0, 299.0),
    ("ShibuyaSakuraStage", -838.0, -772.0, -54.0, 6.0),
    ("ShibuyaScrambleSquare", -835.0, -781.0, 117.0, 173.0),
    ("ShibuyaStream", -731.0, -673.0, -44.0, 14.0),
    ("ShibuyaToeiBic", -738.0, -709.0, 260.0, 289.0),
    ("CenterGaiCommercial_North_1", -839.0, -824.0, 287.0, 302.0),
    ("CenterGaiCommercial_North_2", -859.0, -842.0, 313.0, 330.0),
    ("CenterGaiCommercial_North_3", -873.0, -859.0, 355.0, 369.0),
    ("ExpBldgShinsenCrossing", -1300.0, -1256.0, 169.0, 207.0),
]


ROAD_CORRIDOR_POLYLINES = [
    # 1. 道玄坂本線（109前〜道玄坂上〜神泉接続）
    {
        "name": "Dogenzaka",
        "radius": 12.5,
        "points": [
            (-830.0, 248.0),
            (-872.0, 235.0),
            (-925.0, 215.0),
            (-975.0, 188.0),
            (-1030.0, 162.0),
            (-1080.0, 140.0),
        ],
    },
    # 2. 文化村通り（109前〜東急本店〜松濤二丁目）
    {
        "name": "Bunkamura",
        "radius": 11.5,
        "points": [
            (-838.0, 252.0),
            (-869.0, 282.0),
            (-905.0, 325.0),
            (-940.0, 345.0),
            (-1000.0, 360.0),
            (-1060.0, 370.0),
        ],
    },
    # 3. 玉川通り・国道246号西進（セルリアンタワー〜道玄坂上〜神泉町〜山手通り）
    {
        "name": "Tamagawa_West",
        "radius": 14.5,
        "points": [
            (-855.0, 95.0),
            (-940.0, 115.0),
            (-1010.0, 128.0),
            (-1080.0, 140.0),
            (-1170.0, 146.0),
            (-1250.0, 150.0),
            (-1350.0, 150.0),
        ],
    },
    # 4. 渋谷公園通り（神南一丁目〜PARCO〜渋谷区役所・NHK放送センター）
    {
        "name": "Koen_Dori",
        "radius": 11.5,
        "points": [
            (-790.0, 265.0),
            (-798.0, 360.0),
            (-805.0, 440.0),
            (-810.0, 520.0),
        ],
    },
    # 5. 井の頭通り・オルガン坂（スクランブル北西〜宇田川町〜PARCO前〜明治通り）
    {
        "name": "Inokashira_Organ",
        "radius": 9.0,
        "points": [
            (-875.0, 320.0),
            (-856.0, 342.0),
            (-822.0, 345.0),
            (-802.0, 348.0),
            (-798.0, 358.0),
            (-756.0, 354.0),
        ],
    },
    # 6. 桜丘町・さくら坂（サクラステージ〜インフォスタワー〜玉川通り周回路）
    {
        "name": "Sakurazaka",
        "radius": 8.5,
        "points": [
            (-855.0, 95.0),
            (-855.0, 40.0),
            (-890.0, 10.0),
            (-940.0, -30.0),
            (-950.0, -60.0),
            (-980.0, 0.0),
            (-940.0, 115.0),
        ],
    },
    # 7. 円山町・神泉仲通り（道玄坂上〜神泉駅前〜松濤二丁目）
    {
        "name": "Shinsen_Nakadori",
        "radius": 7.5,
        "points": [
            (-1080.0, 140.0),
            (-1100.0, 185.0),
            (-1110.0, 230.0),
            (-1100.0, 300.0),
            (-1060.0, 370.0),
        ],
    },
    # 8. 宮益坂・青山通り延伸（宮益坂下〜宮益坂上〜表参道方面）
    {
        "name": "Miyamasuzaka",
        "radius": 12.5,
        "points": [
            (-750.0, 248.0),
            (-685.0, 252.0),
            (-635.0, 254.0),
            (-560.0, 248.0),
            (-480.0, 248.0),
            (-400.0, 248.0),
        ],
    },
    # 9. 神南二丁目連絡路（宮下公園北〜勤労福祉会館前）
    {
        "name": "Jinnan_Cross",
        "radius": 8.5,
        "points": [
            (-750.0, 440.0),
            (-778.0, 440.0),
            (-805.0, 440.0),
            (-855.0, 440.0),
        ],
    },
    # 10. 渋谷スクランブル交差点連絡路（109前〜スクランブル中心〜ハチ公前北〜宮益坂下）
    {
        "name": "Shibuya_Scramble",
        "radius": 13.0,
        "points": [
            (-835.0, 252.0),
            (-815.0, 248.0),
            (-780.0, 248.0),
            (-732.0, 248.0),
        ],
    },
    # 11. 渋谷センター街・バスケットボール通り（スクランブル北西〜宇田川町交番・井の頭通り合流〜東急本店前）
    {
        "name": "Center_Gai",
        "radius": 7.0,
        "points": [
            (-835.0, 268.0),
            (-850.0, 292.0),
            (-875.0, 320.0),
            (-902.0, 350.0),
            (-922.0, 356.0),
            (-940.0, 345.0),
        ],
    },
    # 12. 渋谷ヒカリエ連絡路・金王坂（宮益坂下〜ヒカリエ前〜金王坂・国道246号合流）
    {
        "name": "Hikarie_Access",
        "radius": 8.5,
        "points": [
            (-729.0, 248.0),
            (-729.0, 205.0),
            (-727.5, 155.0),
            (-727.5, 120.0),
            (-727.5, 102.0),
        ],
    },
]

# 主要交差点・広場の円形クリアランス（中心とクリアランス半径 m）
ROAD_INTERSECTION_CLEARANCES = [
    ((-815.0, 248.0), 24.0),  # 渋谷スクランブル交差点中心
    ((-795.0, 225.0), 22.0),  # ハチ公前広場
    ((-830.0, 252.0), 22.0),  # 109前Y字路
    ((-835.0, 268.0), 16.0),  # センター街入口交差点
    ((-1080.0, 140.0), 22.0),  # 道玄坂上
    ((-1250.0, 150.0), 22.0),  # 神泉町
    ((-1350.0, 150.0), 22.0),  # 山手通り・神泉町（玉川通り西進合流）
    ((-855.0, 95.0), 22.0),  # セルリアンタワー前・玉川通り（さくら坂分岐）
    ((-750.0, 95.0), 22.0),  # 渋谷駅東口・明治通り（青山通り分岐）
    ((-730.0, 155.0), 16.0),  # 渋谷ヒカリエ前交差点（アクセス道路・ShinQs前）
    ((-730.0, 95.0), 18.0),  # 金王坂下・ヒカリエ南交差点（国道246号・青山通り合流）
    ((-940.0, 345.0), 19.0),  # 東急本店前
    ((-1060.0, 370.0), 18.0),  # 松濤二丁目
    ((-790.0, 265.0), 19.0),  # 神南一丁目
    ((-798.0, 360.0), 18.0),  # 渋谷PARCO前
    ((-805.0, 440.0), 18.0),  # 勤労福祉会館前
    ((-810.0, 520.0), 22.0),  # 渋谷区役所・NHK前
    ((-875.0, 320.0), 16.0),  # 宇田川町交番前
    ((-950.0, -60.0), 16.0),  # さくら坂上
    ((-560.0, 248.0), 19.0),  # 宮益坂上
    ((-400.0, 248.0), 19.0),  # 青山通り接続
]


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
) -> bpy.types.Material:
    """Blender 5.0+ Principled BSDF マテリアルを構築する（写真ベーステクスチャ対応）"""
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


def setup_materials() -> list[bpy.types.Material]:
    """PLATEAU 建築用途および部位に応じた実在感のある PBR マテリアル群を作成する（LOD2モデリング完全整合）"""
    # 0: 高層オフィスタワー（3F〜最上階カーテンウォールガラス・反射スチール・オフィスブラインド）
    mat_tower = create_pbr_material(
        "PlateauGlassTower",
        (0.22, 0.28, 0.38, 1.0),
        roughness=0.18,
        metallic=0.75,
        emissive_color=(0.35, 0.55, 0.85, 1.0),
        emissive_strength=0.22,
        image_path="apps/web/public/textures/shibuya/plateau_lod2_facade.jpg",
    )
    # 1: 中高層商業・オフィスファサード（3F〜最上階アルミパネル・窓グリッド・ブラインド）
    mat_commercial = create_pbr_material(
        "PlateauCommercialFacade",
        (0.40, 0.42, 0.46, 1.0),
        roughness=0.45,
        metallic=0.25,
        emissive_color=(0.95, 0.88, 0.65, 1.0),
        emissive_strength=0.28,
        image_path="apps/web/public/textures/shibuya/plateau_lod2_facade.jpg",
    )
    # 2: 低層ポディウム・路面店舗（1F〜2F ショーウィンドウ・エントランス庇・木々＆地面照り返し）
    mat_storefront = create_pbr_material(
        "PlateauStorefrontMat",
        (0.48, 0.46, 0.42, 1.0),
        roughness=0.32,
        metallic=0.22,
        emissive_color=(1.0, 0.92, 0.75, 1.0),
        emissive_strength=0.35,
        image_path="apps/web/public/textures/shibuya/plateau_lod2_storefront.jpg",
    )
    # 3: センター街・道玄坂路地裏・低層商業テナントビル（暖色店舗照明・看板）
    mat_alley = create_pbr_material(
        "PlateauAlleyCommercial",
        (0.44, 0.41, 0.38, 1.0),
        roughness=0.52,
        metallic=0.18,
        emissive_color=(1.0, 0.82, 0.52, 1.0),
        emissive_strength=0.38,
        image_path="apps/web/public/textures/shibuya/shibuya_dogenzaka_commercial.jpg",
    )
    # 4: 屋上防水床面・パラペット手すり壁・塔屋（ペントハウス）・換気ルーバー
    mat_roof = create_pbr_material(
        "PlateauRooftop",
        (0.24, 0.25, 0.27, 1.0),
        roughness=0.78,
        metallic=0.15,
        image_path="apps/web/public/textures/shibuya/plateau_lod2_roof.jpg",
    )
    # 5: 遠景（LOD2）軽量プロキシ用マテリアル（単一ドローコール・テクスチャMipmap対応・低負荷シェーディング）
    mat_proxy = create_pbr_material(
        "PlateauLod2Proxy",
        (0.35, 0.37, 0.40, 1.0),
        roughness=0.65,
        metallic=0.15,
        emissive_color=(0.90, 0.82, 0.60, 1.0),
        emissive_strength=0.20,
        image_path="apps/web/public/textures/shibuya/plateau_lod2_facade.jpg",
    )
    return [mat_tower, mat_commercial, mat_storefront, mat_alley, mat_roof, mat_proxy]


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
    """Project PLATEAU 渋谷区全8タイルの実在建築メッシュを LOD2 建築モデリング化して GLB を生成する"""
    clean_scene()
    cache_dir = "/tmp/shibuya_tiles"
    materials = setup_materials()

    total_buildings = 0
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
                # Why skip narrow slivers & tiny low sheds:
                # PLATEAU の細長い境界壁・低層物置シェル (幅 <3.5m、面積 <180m2 かつ 高さ <4.5m、
                # または面積 <45m2 かつ 高さ <7.0m) が交差点脇やアーチ背後に孤立した小屋として残るのを防ぐ。
                if (
                    min(shell_w, shell_d) < 3.5
                    or (shell_area_xz < 180.0 and c_h < 4.5)
                    or (shell_area_xz < 45.0 and c_h < 7.0)
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
                    if ox > 2.0 and oz > 2.0:
                        lm_area = max(1.0, (lx1 - lx0) * (lz1 - lz0))
                        if (ox * oz) >= 0.20 * min(shell_area_xz, lm_area):
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

                max_disc_r = 24.0
                cand_discs = [
                    (rx, rz, rr)
                    for (rx, rz, rr) in road_discs
                    if (c_min_x - max_disc_r) <= rx <= (c_max_x + max_disc_r)
                    and (c_world_min_z - max_disc_r) <= rz <= (c_world_max_z + max_disc_r)
                ]

                in_exact_road = False
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
                            if dist_point_to_triangle_2d_sq(rx, rz, ax, az, bx, bz, cx, cz) <= (
                                rr * rr
                            ):
                                in_exact_road = True
                                break
                        if in_exact_road:
                            break

                in_intersection = any(
                    math.hypot(c_cx - ix, c_cz - iz) <= iradius
                    for (ix, iz), iradius in ROAD_INTERSECTION_CLEARANCES
                )
                in_corridor_center = any(
                    point_to_polyline_distance(c_cx, c_cz, corridor["points"]) <= corridor["radius"]
                    for corridor in ROAD_CORRIDOR_POLYLINES
                )

                if in_exact_road or in_intersection or in_corridor_center:
                    total_road_clipped += len(sp)
                    continue

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
            shell_records.sort(key=lambda s: s["min_z"])
            bid_z_min = shell_records[0]["min_z"]
            supported_shells = []

            for rec in shell_records:
                is_at_bid_base = rec["min_z"] <= bid_z_min + 0.5
                supporting = None
                if not is_at_bid_base:
                    for g in reversed(supported_shells):
                        overlap_w = min(g["max_x"], rec["max_x"]) - max(g["min_x"], rec["min_x"])
                        overlap_d = min(g["max_y"], rec["max_y"]) - max(g["min_y"], rec["min_y"])
                        xy_overlaps = overlap_w >= 1.5 and overlap_d >= 1.5
                        z_rests_on_roof = abs(rec["min_z"] - g["max_z"]) <= 0.8
                        if xy_overlaps and z_rests_on_roof:
                            supporting = g
                            break

                is_floating_slab = (
                    not is_at_bid_base
                    and supporting is None
                    and rec["h"] < 5.0
                    and (rec["min_z"] - bid_z_min) > 2.5
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
                comp_h = max(h if len(shell_records) == 1 else rec["h"], rec["h"])
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

            # 垂直壁面（Wall）: ビル単位でのマテリアル一貫性（三角形対角線割れアーティファクトを100%根絶）
            # 渋谷の都市景観に応じたマテリアル割り当て（全4階×4スパン 16m×14m 実寸スケールで圧縮モアレを防止）:
            # - 低中層商業ビル (<35m): 繁華街テナントファサード / ライムストーン店舗 (PlateauAlleyCommercial / PlateauStorefrontMat)
            # - 中高層オフィス (35m〜60m): アルミパネル・窓グリッド (PlateauCommercialFacade)
            # - 高層タワー (>=60m): ガラスカーテンウォール (PlateauGlassTower)
            if bldg_h < 35.0:
                mat_wall = 3 if (cid % 3 != 0) else 2
                span_u = 16.0
                span_v = 14.0
            elif bldg_h < 60.0:
                mat_wall = 1
                span_u = 16.0
                span_v = 14.0
            else:
                mat_wall = 0
                span_u = 16.0
                span_v = 14.4

            f.material_index = mat_wall

            nx, ny = f.normal.x, f.normal.y
            n_len = math.hypot(nx, ny)
            if n_len > 1e-4:
                tx = -ny / n_len
                ty = nx / n_len
            else:
                tx, ty = 1.0, 0.0

            for loop in f.loops:
                co = loop.vert.co
                # 水平接線（Tangent）プロジェクション
                u = (co.x * tx + co.y * ty) / span_u
                # 足元 z=0 から上階へ垂直タイリング
                v = co.z / span_v
                loop[uv_layer].uv = (u, v)

        # 6. 除外面はステップ5で削除済み。まず塔屋追加前の地盤接地済み躯体からLOD2プロキシを生成・浮遊断片除去する
        bpy.data.objects.remove(obj, do_unlink=True)

        eval_mesh = None
        if len(bm.faces) > 0:
            proxy_src_mesh = bpy.data.meshes.new(f"ShibuyaPlateauProxySrc_{tile_name}")
            bm.to_mesh(proxy_src_mesh)
            proxy_src_obj = bpy.data.objects.new(f"PlateauProxySrc_{tile_name}", proxy_src_mesh)
            bpy.context.scene.collection.objects.link(proxy_src_obj)

            mod = proxy_src_obj.modifiers.new("Decimate", "DECIMATE")
            mod.ratio = 0.20
            bpy.context.view_layer.objects.active = proxy_src_obj
            dg = bpy.context.evaluated_depsgraph_get()
            eval_mesh = bpy.data.meshes.new_from_object(proxy_src_obj.evaluated_get(dg))

            bpy.data.objects.remove(proxy_src_obj, do_unlink=True)
            bpy.data.meshes.remove(proxy_src_mesh)

            # Decimate後に独立浮遊化した上部断片シェルを 5cm 量子化連結成分判定で完全に除去する
            bm_proxy = bmesh.new()
            bm_proxy.from_mesh(eval_mesh)
            bm_proxy.faces.ensure_lookup_table()
            tiny_proxy = [pf for pf in bm_proxy.faces if pf.calc_area() < 1e-4]
            if tiny_proxy:
                bmesh.ops.delete(bm_proxy, geom=tiny_proxy, context="FACES")
            bm_proxy.faces.ensure_lookup_table()

            v_bucket: dict[tuple[int, int, int], list[bmesh.types.BMVert]] = (
                collections.defaultdict(list)
            )
            for pv in bm_proxy.verts:
                bkey = (
                    round(pv.co.x * 20.0),
                    round(pv.co.y * 20.0),
                    round(pv.co.z * 20.0),
                )
                v_bucket[bkey].append(pv)

            visited_pf: set[int] = set()
            proxy_comps: list[dict] = []
            for pf in bm_proxy.faces:
                if pf.index in visited_pf:
                    continue
                queue = collections.deque([pf])
                visited_pf.add(pf.index)
                comp_pf: list[bmesh.types.BMFace] = []
                min_x = min_y = min_z = float("inf")
                max_x = max_y = max_z = float("-inf")
                while queue:
                    cur = queue.popleft()
                    comp_pf.append(cur)
                    for pv in cur.verts:
                        co = pv.co
                        if co.x < min_x:
                            min_x = co.x
                        if co.x > max_x:
                            max_x = co.x
                        if co.y < min_y:
                            min_y = co.y
                        if co.y > max_y:
                            max_y = co.y
                        if co.z < min_z:
                            min_z = co.z
                        if co.z > max_z:
                            max_z = co.z
                        bkey = (
                            round(co.x * 20.0),
                            round(co.y * 20.0),
                            round(co.z * 20.0),
                        )
                        for bvert in v_bucket[bkey]:
                            for nf in bvert.link_faces:
                                if nf.index not in visited_pf:
                                    visited_pf.add(nf.index)
                                    queue.append(nf)
                proxy_comps.append(
                    {
                        "faces": comp_pf,
                        "min_x": min_x,
                        "max_x": max_x,
                        "min_y": min_y,
                        "max_y": max_y,
                        "min_z": min_z,
                        "max_z": max_z,
                    }
                )

            grounded_proxies = [pc for pc in proxy_comps if pc["min_z"] <= 0.45]
            drop_proxy_faces: list[bmesh.types.BMFace] = []
            for pc in proxy_comps:
                if pc["min_z"] <= 0.45:
                    continue
                is_supported = any(
                    gp["min_x"] <= pc["max_x"] - 0.05
                    and gp["max_x"] >= pc["min_x"] + 0.05
                    and gp["min_y"] <= pc["max_y"] - 0.05
                    and gp["max_y"] >= pc["min_y"] + 0.05
                    and pc["min_z"] <= gp["max_z"] + 0.7
                    for gp in grounded_proxies
                )
                if not is_supported:
                    drop_proxy_faces.extend(pc["faces"])

            if drop_proxy_faces:
                bmesh.ops.delete(bm_proxy, geom=drop_proxy_faces, context="FACES")
                iso_pv = [pv for pv in bm_proxy.verts if not pv.link_faces]
                if iso_pv:
                    bmesh.ops.delete(bm_proxy, geom=iso_pv, context="VERTS")
            bm_proxy.normal_update()
            bm_proxy.to_mesh(eval_mesh)
            bm_proxy.free()

        # 7. 詳細タイルへ立体塔屋（ペントハウス・エレベーター機械室）を追加（最大の水平屋根面に確実に接地）
        for cid, (_z_base, bldg_h, _b_cx, _b_cy) in comp_info.items():
            r_faces = comp_roof_faces.get(cid, [])
            if r_faces and bldg_h >= 20.0:
                best_area, rcx, rcy, rcz, min_span = max(r_faces, key=lambda t: t[0])
                if best_area >= 48.0 and min_span >= 8.0:
                    pw = min(max(min_span * 0.25, 2.8), 4.8)
                    pd = min(max(min_span * 0.25, 2.8), 4.8)
                    ph = 2.8
                    corners_bottom = [
                        Vector((rcx - pw * 0.5, rcy - pd * 0.5, rcz)),
                        Vector((rcx + pw * 0.5, rcy - pd * 0.5, rcz)),
                        Vector((rcx + pw * 0.5, rcy + pd * 0.5, rcz)),
                        Vector((rcx - pw * 0.5, rcy + pd * 0.5, rcz)),
                    ]
                    corners_top = [
                        Vector((rcx - pw * 0.5, rcy - pd * 0.5, rcz + ph)),
                        Vector((rcx + pw * 0.5, rcy - pd * 0.5, rcz + ph)),
                        Vector((rcx + pw * 0.5, rcy + pd * 0.5, rcz + ph)),
                        Vector((rcx - pw * 0.5, rcy + pd * 0.5, rcz + ph)),
                    ]
                    vb = [bm.verts.new(co) for co in corners_bottom]
                    vt = [bm.verts.new(co) for co in corners_top]
                    hut_faces: list[bmesh.types.BMFace] = []
                    for i in range(4):
                        next_i = (i + 1) % 4
                        try:
                            f_side = bm.faces.new([vb[i], vb[next_i], vt[next_i], vt[i]])
                            f_side.material_index = 1 if bldg_h < 55.0 else 0
                            for loop in f_side.loops:
                                u = (loop.vert.co.x + loop.vert.co.y) / 4.0
                                v = (loop.vert.co.z - rcz) / ph
                                loop[uv_layer].uv = (u, v)
                            hut_faces.append(f_side)
                        except Exception:
                            pass
                    try:
                        f_top = bm.faces.new(vt)
                        f_top.material_index = 4  # PlateauRooftop
                        for loop in f_top.loops:
                            loop[uv_layer].uv = (loop.vert.co.x / 4.0, -loop.vert.co.y / 4.0)
                        hut_faces.append(f_top)
                    except Exception:
                        pass
                    if hut_faces:
                        bmesh.ops.recalc_face_normals(bm, faces=hut_faces)

        # 8. 詳細メッシュ・プロキシメッシュをシーンへ出力（成分単位溶接済みのため全体remove_doublesは行わない）
        bm.normal_update()
        tile_faces_count = len(bm.faces)
        total_faces_kept += tile_faces_count

        if tile_faces_count > 0:
            tile_mesh = bpy.data.meshes.new(f"ShibuyaPlateauTileMesh_{tile_name}")
            for m in materials[:5]:
                tile_mesh.materials.append(m)
            bm.to_mesh(tile_mesh)

            tile_obj = bpy.data.objects.new(f"PlateauTile_{tile_name}", tile_mesh)
            bpy.context.scene.collection.objects.link(tile_obj)
            tile_obj["tile_id"] = tile_name
            tile_obj["is_plateau_tile"] = True

            proxy_poly_count = len(eval_mesh.polygons) if eval_mesh is not None else 0
            if eval_mesh is not None and proxy_poly_count > 0:
                eval_mesh.name = f"ShibuyaPlateauProxyMesh_{tile_name}"
                eval_mesh.materials.clear()
                eval_mesh.materials.append(materials[5])
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
                f"[PLATEAU] Built tile object PlateauTile_{tile_name} ({tile_faces_count} faces) "
                f"and proxy PlateauProxyTile_{tile_name} ({proxy_poly_count} faces)"
            )
        else:
            if eval_mesh is not None:
                bpy.data.meshes.remove(eval_mesh)
            bm.free()

    print(
        f"[PLATEAU] Total {total_buildings} real buildings processed: "
        f"kept {total_faces_kept} faces, skipped {total_landmarks_skipped} landmark faces, "
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
    bpy.ops.export_scene.gltf(filepath=out_public_glb, export_format="GLB")
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

    avail_engines = [
        e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items
    ]
    if "CYCLES" in avail_engines:
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
    elif "BLENDER_EEVEE_NEXT" in avail_engines:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    else:
        scene.render.engine = "CYCLES"

    scene.render.resolution_x = 800
    scene.render.resolution_y = 450

    world = scene.world
    if not world.use_nodes:
        world.use_nodes = True
    bg = next((n for n in world.node_tree.nodes if n.type == "BACKGROUND"), None)
    if bg:
        bg.inputs["Color"].default_value = (0.50, 0.58, 0.72, 1.0)
        bg.inputs["Strength"].default_value = 0.85

    # アスファルト地面メッシュ
    ground_mesh = bpy.data.meshes.new("ReviewGroundMesh")
    ground_bm = bmesh.new()
    bmesh.ops.create_grid(ground_bm, x_segments=2, y_segments=2, size=1500)
    ground_bm.to_mesh(ground_mesh)
    ground_bm.free()
    ground_obj = bpy.data.objects.new("ReviewGround", ground_mesh)
    ground_obj.location = Vector((-750.0, 0.0, -0.05))
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

    # 渋谷周辺4倍拡大エリアの主要6大スポット（各スポット360度マルチアングル 8方位 + 俯瞰）
    review_spots = [
        {
            "id": "spot1_scramble_109_y_fork",
            "name": "スクランブル交差点〜109前Y字路（道玄坂下・文化村通り）",
            "center": Vector((-825.0, -250.0, 1.8)),
            "birdseye_height": 80.0,
            "look_radius": 60.0,
        },
        {
            "id": "spot2_dogenzaka_ue_tamagawa",
            "name": "道玄坂上・玉川通り合流・神泉町（西進エリア）",
            "center": Vector((-1080.0, -140.0, 2.0)),
            "birdseye_height": 65.0,
            "look_radius": 50.0,
        },
        {
            "id": "spot3_bunkamura_shoto",
            "name": "文化村通り・東急本店前・松濤二丁目",
            "center": Vector((-940.0, -345.0, 1.8)),
            "birdseye_height": 60.0,
            "look_radius": 45.0,
        },
        {
            "id": "spot4_koen_dori_parco",
            "name": "渋谷公園通り・PARCO前・オルガン坂",
            "center": Vector((-798.0, -360.0, 2.0)),
            "birdseye_height": 65.0,
            "look_radius": 45.0,
        },
        {
            "id": "spot5_sakurazaka_cerulean",
            "name": "桜丘町・さくら坂・セルリアンタワー周回路",
            "center": Vector((-920.0, 10.0, 2.0)),
            "birdseye_height": 65.0,
            "look_radius": 45.0,
        },
        {
            "id": "spot6_miyamasuzaka_ue",
            "name": "宮益坂・宮益坂上・青山通り",
            "center": Vector((-560.0, -248.0, 2.2)),
            "birdseye_height": 65.0,
            "look_radius": 50.0,
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

        # A. アイレベル 360度 全8方位レンダリング
        for dir_name, deg in directions:
            rad = math.radians(deg)
            cam_obj.location = spot_center
            # Blender 座標系: x: 東 (+X), y: 南 (-Y なので北は -Y, 南は +Y)
            # deg=0 (北): y方向は -1.0, deg=90 (東): x方向は +1.0
            dx = math.sin(rad) * look_r
            dy = -math.cos(rad) * look_r
            target = spot_center + Vector((dx, dy, 14.0))  # 沿道ビル見上げ角度
            direction = target - spot_center
            cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

            out_file = os.path.join(review_dir, f"{spot_id}_{dir_name}.png")
            scene.render.filepath = out_file
            bpy.ops.render.render(write_still=True)
            rendered_count += 1

        # B. スポット直上からの高解像度俯瞰（Birdseye View）
        bh = spot["birdseye_height"]
        cam_obj.location = spot_center + Vector((0.0, 0.0, bh))
        cam_obj.rotation_euler = (0.0, 0.0, 0.0)  # 直下
        out_file = os.path.join(review_dir, f"{spot_id}_999_birdseye.png")
        scene.render.filepath = out_file
        bpy.ops.render.render(write_still=True)
        rendered_count += 1

    # C. 渋谷エリア全域高空バードズアイ（南西から北東全景）
    cam_obj.location = Vector((-1100.0, 150.0, 480.0))
    direction = Vector((-750.0, -150.0, 50.0)) - cam_obj.location
    cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    out_file = os.path.join(review_dir, "00_shibuya_metropolis_high_birdseye.png")
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

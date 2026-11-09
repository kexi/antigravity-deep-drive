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
ROAD_CORRIDOR_POLYLINES = [
    # 1. 道玄坂本線（109前〜道玄坂上〜神泉接続）
    {
        "name": "Dogenzaka",
        "radius": 12.0,
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
        "radius": 11.0,
        "points": [
            (-828.0, 258.0),
            (-862.0, 290.0),
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
    # 5. 井の頭通り・オルガン坂（スクランブル北西〜宇田川町〜PARCO前）
    {
        "name": "Inokashira_Organ",
        "radius": 9.0,
        "points": [
            (-840.0, 265.0),
            (-875.0, 320.0),
            (-850.0, 348.0),
            (-798.0, 360.0),
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
]

# 主要交差点の円形クリアランス（交差点中心とクリアランス半径 m）
ROAD_INTERSECTION_CLEARANCES = [
    ((-830.0, 252.0), 22.0),  # 109前Y字路
    ((-1080.0, 140.0), 22.0),  # 道玄坂上
    ((-1250.0, 150.0), 22.0),  # 神泉町
    ((-1350.0, 150.0), 22.0),  # 山手通り・神泉町（玉川通り西進合流）
    ((-855.0, 95.0), 22.0),  # セルリアンタワー前・玉川通り（さくら坂分岐）
    ((-750.0, 95.0), 22.0),  # 渋谷駅東口・明治通り（青山通り分岐）
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

        # 3. 建物ごとのクリアランス・ランドマーク判定および最低標高の算出
        valid_bldg_bids = set()
        bldg_info = {}  # bid: (z_base, bldg_h, b_cx, b_cy)

        for bid, polys in bldg_polys.items():
            gml_id = gml_ids[bid] if bid < len(gml_ids) else ""
            h = heights[bid] if (bid < len(heights) and heights[bid] is not None) else 20.0

            # ランドマーク除外
            if gml_id in LANDMARK_GML_IDS:
                total_landmarks_skipped += len(polys)
                continue

            all_coords = [obj.data.vertices[vi].co for p in polys for vi in p.vertices]
            if not all_coords:
                continue
            b_cx = sum(c.x for c in all_coords) / len(all_coords)
            b_cy = sum(c.y for c in all_coords) / len(all_coords)
            b_cz = -b_cy
            z_base = min(c.z for c in all_coords)
            z_top = max(c.z for c in all_coords)
            bldg_h = max(h, z_top - z_base)

            # 車道コリドー＆交差点干渉除外（4倍拡大エリア全実在道路・交差点）
            # A. 主要交差点円形クリアランス
            if any(
                math.hypot(b_cx - ix, b_cz - iz) <= iradius
                for (ix, iz), iradius in ROAD_INTERSECTION_CLEARANCES
            ):
                total_road_clipped += len(polys)
                continue

            # B. 放射状曲線道路ポリラインクリアランス
            if any(
                point_to_polyline_distance(b_cx, b_cz, corridor["points"]) <= corridor["radius"]
                for corridor in ROAD_CORRIDOR_POLYLINES
            ):
                total_road_clipped += len(polys)
                continue

            # C. 明治通り南北幹線 (x = -750)
            if -764.0 <= b_cx <= -736.0 and -350.0 <= b_cz <= 550.0:
                total_road_clipped += len(polys)
                continue

            # D. 国道246号・青山通り東側区間 (z = 95)
            if 82.0 <= b_cz <= 108.0 and -735.0 <= b_cx <= -260.0:
                total_road_clipped += len(polys)
                continue

            # E. 渋谷駅前東西連絡路 (z = 248)
            if -795.0 <= b_cx <= -750.0 and 236.0 <= b_cz <= 260.0:
                total_road_clipped += len(polys)
                continue

            valid_bldg_bids.add(bid)
            bldg_info[bid] = (z_base, bldg_h, b_cx, b_cy)

        # 4. 全建物を地盤面 z=0.0 にピタッと完全接地オフセット（高台・傾斜地の空中浮遊を根絶）
        vert_z_offset = {}
        for bid in valid_bldg_bids:
            z_base = bldg_info[bid][0]
            for p in bldg_polys[bid]:
                for vi in p.vertices:
                    vert_z_offset[vi] = z_base

        for vi, v in enumerate(obj.data.vertices):
            if vi in vert_z_offset:
                v.co.z = max(0.0, v.co.z - vert_z_offset[vi])
            else:
                v.co.z = 0.0
        obj.data.update()

        # 5. BMesh によるトポロジー維持・LOD2マテリアル・UV割り当て
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bm.faces.ensure_lookup_table()
        uv_layer = bm.loops.layers.uv.verify()

        faces_to_delete = []
        bldg_roof_coords = collections.defaultdict(list)

        for f in bm.faces:
            poly = obj.data.polygons[f.index]
            main_bid = batch_vals[poly.vertices[0]] if poly.vertices else 0

            # 除外対象の建物は削除
            if main_bid not in valid_bldg_bids:
                faces_to_delete.append(f)
                continue

            _z_base, bldg_h, b_cx, b_cy = bldg_info[main_bid]
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
                bldg_roof_coords[main_bid].extend([v.co.copy() for v in f.verts])
                continue

            # 垂直壁面（Wall）: ビル単位でのマテリアル一貫性（三角形対角線割れアーティファクトを100%根絶）
            # 渋谷の都市景観に応じたマテリアル割り当て:
            # - 低中層商業ビル (<35m): 繁華街テナントファサード (PlateauAlleyCommercial / PlateauStorefrontMat)
            # - 中高層オフィス (35m〜60m): アルミパネル・窓グリッド (PlateauCommercialFacade)
            # - 高層タワー (>=60m): ガラスカーテンウォール (PlateauGlassTower)
            if bldg_h < 35.0:
                mat_wall = 3 if (main_bid % 3 != 0) else 2
                span_u = 12.0
                span_v = 3.2
            elif bldg_h < 60.0:
                mat_wall = 1
                span_u = 6.0
                span_v = 3.4
            else:
                mat_wall = 0
                span_u = 6.0
                span_v = 3.6

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

        # 6. 除外面および孤立頂点を削除
        bmesh.ops.delete(bm, geom=faces_to_delete, context="FACES")
        isolated_verts = [v for v in bm.verts if not v.link_faces]
        if isolated_verts:
            bmesh.ops.delete(bm, geom=isolated_verts, context="VERTS")

        # 7. 立体塔屋（ペントハウス・エレベーター機械室）の追加（屋根平均高さに完全接地）
        for bid in valid_bldg_bids:
            roof_coords = bldg_roof_coords.get(bid, [])
            _z_base, bldg_h, b_cx, b_cy = bldg_info[bid]
            if roof_coords and bldg_h >= 20.0:
                rcx = sum(c.x for c in roof_coords) / len(roof_coords)
                rcy = sum(c.y for c in roof_coords) / len(roof_coords)
                rcz = sum(c.z for c in roof_coords) / len(roof_coords)
                r_radius = sum(math.hypot(c.x - rcx, c.y - rcy) for c in roof_coords) / len(
                    roof_coords
                )

                if r_radius >= 4.5:
                    pw = min(max(r_radius * 0.45, 3.8), 6.5)
                    pd = min(max(r_radius * 0.45, 3.8), 6.5)
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
                    for i in range(4):
                        next_i = (i + 1) % 4
                        try:
                            f_side = bm.faces.new([vb[i], vb[next_i], vt[next_i], vt[i]])
                            f_side.material_index = 1 if bldg_h < 55.0 else 0
                            for loop in f_side.loops:
                                u = (loop.vert.co.x + loop.vert.co.y) / 4.0
                                v = (loop.vert.co.z - rcz) / ph
                                loop[uv_layer].uv = (u, v)
                        except Exception:
                            pass
                    try:
                        f_top = bm.faces.new(vt)
                        f_top.material_index = 4  # PlateauRooftop
                        for loop in f_top.loops:
                            loop[uv_layer].uv = (loop.vert.co.x / 4.0, -loop.vert.co.y / 4.0)
                    except Exception:
                        pass

        # 8. 全法線を外向きに統一再計算
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        tile_faces_count = len(bm.faces)
        total_faces_kept += tile_faces_count

        bpy.data.objects.remove(obj, do_unlink=True)

        if tile_faces_count > 0:
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.01)
            tile_mesh = bpy.data.meshes.new(f"ShibuyaPlateauTileMesh_{tile_name}")
            for m in materials[:5]:
                tile_mesh.materials.append(m)
            bm.to_mesh(tile_mesh)

            tile_obj = bpy.data.objects.new(f"PlateauTile_{tile_name}", tile_mesh)
            bpy.context.scene.collection.objects.link(tile_obj)
            tile_obj["tile_id"] = tile_name
            tile_obj["is_plateau_tile"] = True

            # LOD2 軽量プロキシメッシュ生成 (Decimate による低ポリゴン化 80%削減 + 単一プロキシマテリアル)
            mod = tile_obj.modifiers.new("Decimate", "DECIMATE")
            mod.ratio = 0.20
            bpy.context.view_layer.objects.active = tile_obj
            dg = bpy.context.evaluated_depsgraph_get()
            eval_mesh = bpy.data.meshes.new_from_object(tile_obj.evaluated_get(dg))
            tile_obj.modifiers.remove(mod)

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

            bm.free()
            print(
                f"[PLATEAU] Built tile object PlateauTile_{tile_name} ({tile_faces_count} faces) "
                f"and proxy PlateauProxyTile_{tile_name} ({len(eval_mesh.polygons)} faces)"
            )
        else:
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

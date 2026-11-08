#!/usr/bin/env -S uv run --script
# /// script
# requires-python = "==3.11.*"
# dependencies = [
#   "bpy>=5.0.1",
# ]
# [tool.uv]
# exclude-newer = "1 day"
# ///
"""
東京都 Project PLATEAU 渋谷区 (13113) 実測 3D 都市データ統合モデリングスクリプト
国土交通省 Project PLATEAU Spec 5.0 (2025年度) 渋谷区 (13113_shibuya-ku) 3D Tiles (b3dm) から、
道玄坂・宮益坂・明治通り・センター街・宇田川町・桜丘町・神南・渋谷1〜3丁目の実在する約1,700棟の
建物多角形メッシュ（フットプリント・実測高・屋根形状）を抽出し、シミュレーターのローカル座標系へ変換・統合する。
"""

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
# 重複描画および Z-fighting を完全に防止するため背景 PLATEAU メッシュ側からは除外する
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
) -> bpy.types.Material:
    """Blender 5.0+ Principled BSDF マテリアルを構築する"""
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = base_color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emissive_color is not None and "Emission Color" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = emissive_color
        bsdf.inputs["Emission Strength"].default_value = emissive_strength
    return mat


def setup_materials() -> list[bpy.types.Material]:
    """PLATEAU 建築用途および高さに応じた実在感のある PBR マテリアル群を作成する"""
    # 0: 高層オフィスタワー（カーテンウォールガラス・反射スチール）
    mat_tower = create_pbr_material(
        "PlateauGlassTower",
        (0.18, 0.24, 0.35, 1.0),
        roughness=0.18,
        metallic=0.82,
        emissive_color=(0.35, 0.55, 0.85, 1.0),
        emissive_strength=0.28,
    )
    # 1: 中高層商業・オフィスファサード（アルミパネル・石張り・窓グリッド）
    mat_commercial = create_pbr_material(
        "PlateauCommercialFacade",
        (0.36, 0.38, 0.42, 1.0),
        roughness=0.48,
        metallic=0.28,
        emissive_color=(0.95, 0.88, 0.65, 1.0),
        emissive_strength=0.32,
    )
    # 2: センター街・道玄坂路地裏・低層商業テナントビル（暖色店舗照明・看板）
    mat_alley = create_pbr_material(
        "PlateauAlleyCommercial",
        (0.44, 0.41, 0.38, 1.0),
        roughness=0.55,
        metallic=0.18,
        emissive_color=(1.0, 0.82, 0.52, 1.0),
        emissive_strength=0.38,
    )
    # 3: 屋上・パラペット（防水アスファルトコンクリート・設備機械基礎）
    mat_roof = create_pbr_material(
        "PlateauRooftop",
        (0.20, 0.22, 0.24, 1.0),
        roughness=0.82,
        metallic=0.10,
    )
    return [mat_tower, mat_commercial, mat_alley, mat_roof]


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

    # Blender の glTF インポーターで CESIUM_RTC 未対応例外が出ないようヘッダーから除外
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
    """Project PLATEAU 渋谷区全8タイルの実在建築メッシュを統合した GLB を生成する"""
    clean_scene()
    cache_dir = "/tmp/shibuya_tiles"
    materials = setup_materials()

    merged_mesh = bpy.data.meshes.new("ShibuyaPlateauCityMesh")
    for m in materials:
        merged_mesh.materials.append(m)

    bm = bmesh.new()
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

        # 一時オブジェクトとしてインポート
        bpy.ops.import_scene.gltf(filepath=glb_path)
        imported_objs = [o for o in bpy.context.selected_objects if o.type == "MESH"]
        if not imported_objs:
            continue
        obj = imported_objs[-1]

        batch_attr = obj.data.attributes.get("_BATCHID")
        batch_vals = (
            [d.value for d in batch_attr.data] if batch_attr else [0] * len(obj.data.vertices)
        )

        # 頂点座標を ECEF からローカル3D座標へ一括変換
        local_verts = []
        for v in obj.data.vertices:
            lat, lon, alt = ecef_to_latlon(
                rtc[0] + v.co.x,
                rtc[1] + v.co.y,
                rtc[2] + v.co.z,
            )
            lx, lz = wgs84_to_local(lat, lon)
            # 東京ジオイド高 ~36.7m、渋谷ストリーム地盤高 TP +14.5m
            rel_y = max(0.0, alt - 36.7 - 14.5)
            local_verts.append((lx, -lz, rel_y))

        # ポリゴン単位で bmesh へコピー（マテリアル判定・コリドー干渉除外・ランドマーク重複除外）
        for poly in obj.data.polygons:
            p_verts = [local_verts[vi] for vi in poly.vertices]
            p_bids = [batch_vals[vi] for vi in poly.vertices]
            main_bid = p_bids[0] if p_bids else 0
            gml_id = gml_ids[main_bid] if main_bid < len(gml_ids) else ""
            h = (
                heights[main_bid]
                if (main_bid < len(heights) and heights[main_bid] is not None)
                else 20.0
            )

            # 1. ランドマーク除外（shibuya_stream.glb 側で詳細モデルを描画）
            if gml_id in LANDMARK_GML_IDS:
                total_landmarks_skipped += 1
                continue

            # 2. 車道コリドー干渉除外（走行可能エリアへの侵入を防止）
            avg_x = sum(v[0] for v in p_verts) / len(p_verts)
            avg_z = sum(-v[1] for v in p_verts) / len(p_verts)

            # 詳細モデリング建築物（MAGNET, 東映プラザ/ビックカメラ, マークシティ等）近接ポリゴンの除外（Z-fighting 防止）
            if math.hypot(avg_x - (-782.0), avg_z - 275.0) < 18.0:
                total_landmarks_skipped += 1
                continue
            if math.hypot(avg_x - (-723.0), avg_z - 275.0) < 18.0:
                total_landmarks_skipped += 1
                continue

            # 明治通り車道コリドー (x ∈ [-764, -736], z ∈ [-220, 260])
            if -764.0 <= avg_x <= -736.0 and -220.0 <= avg_z <= 260.0:
                total_road_clipped += 1
                continue
            # 国道246号車道コリドー (z ∈ [84, 106], x ∈ [-860, -640])
            if 84.0 <= avg_z <= 106.0 and -860.0 <= avg_x <= -640.0:
                total_road_clipped += 1
                continue
            # 渋谷駅前東西連絡路 (x ∈ [-795, -750], z ∈ [236, 260])
            if -795.0 <= avg_x <= -750.0 and 236.0 <= avg_z <= 260.0:
                total_road_clipped += 1
                continue
            # スクランブル交差点コアコリドー (x ∈ [-838, -792], z ∈ [228, 268])
            if -838.0 <= avg_x <= -792.0 and 228.0 <= avg_z <= 268.0:
                total_road_clipped += 1
                continue
            # 宮益坂車道コリドー (x ∈ [-750, -575], z ∈ [236, 260])
            if -750.0 <= avg_x <= -575.0 and 236.0 <= avg_z <= 260.0:
                total_road_clipped += 1
                continue
            # 道玄坂車道コリドー (x ∈ [-975, -825], z ∈ [180, 255])
            # 道玄坂中心線: start (-830, 248) to end (-975, 188)
            dogenzaka_center_z = 248.0 + (avg_x - (-830.0)) * 0.4138
            if -975.0 <= avg_x <= -825.0 and abs(avg_z - dogenzaka_center_z) <= 12.0:
                total_road_clipped += 1
                continue
            # 文化村通りコリドー (x ∈ [-905, -825], z ∈ [248, 330])
            # 文化村通り中心線: start (-828, 255) to end (-905, 325)
            bunkamura_center_z = 255.0 + (avg_x - (-828.0)) * (-0.909)
            if -905.0 <= avg_x <= -828.0 and abs(avg_z - bunkamura_center_z) <= 11.0:
                total_road_clipped += 1
                continue
            # 稲荷橋通り (z ∈ [-104, -86], x ∈ [-855, -645])
            if -104.0 <= avg_z <= -86.0 and -855.0 <= avg_x <= -645.0:
                total_road_clipped += 1
                continue
            # 並木橋通り (z ∈ [-209, -191], x ∈ [-855, -645])
            if -209.0 <= avg_z <= -191.0 and -855.0 <= avg_x <= -645.0:
                total_road_clipped += 1
                continue
            # 宮下公園通り (z ∈ [186, 204], x ∈ [-855, -645])
            if 186.0 <= avg_z <= 204.0 and -855.0 <= avg_x <= -645.0:
                total_road_clipped += 1
                continue
            # 桜丘西通り (x ∈ [-863, -847], z ∈ [-200, 195])
            if -863.0 <= avg_x <= -847.0 and -200.0 <= avg_z <= 195.0:
                total_road_clipped += 1
                continue
            # 金王坂通り (x ∈ [-653, -637], z ∈ [-200, 195])
            if -653.0 <= avg_x <= -637.0 and -200.0 <= avg_z <= 195.0:
                total_road_clipped += 1
                continue

            # 3. マテリアル分類（屋根・高層・中層・路地商業）
            normal_z = poly.normal.z
            if normal_z > 0.72:
                mat_idx = 3  # PlateauRooftop
            elif h >= 75.0:
                mat_idx = 0  # PlateauGlassTower
            elif h >= 32.0:
                mat_idx = 1  # PlateauCommercialFacade
            else:
                mat_idx = 2  # PlateauAlleyCommercial

            bm_verts = [bm.verts.new(co) for co in p_verts]
            try:
                f = bm.faces.new(bm_verts)
                f.material_index = mat_idx
                total_faces_kept += 1
            except Exception:
                pass

        bpy.data.objects.remove(obj, do_unlink=True)

    print(
        f"[PLATEAU] Total {total_buildings} real buildings processed: "
        f"kept {total_faces_kept} faces, skipped {total_landmarks_skipped} landmark faces, "
        f"clipped {total_road_clipped} roadway faces."
    )

    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.01)
    bm.to_mesh(merged_mesh)
    bm.free()

    city_obj = bpy.data.objects.new("ShibuyaPlateauCity", merged_mesh)
    bpy.context.scene.collection.objects.link(city_obj)

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
    if "BLENDER_EEVEE_NEXT" in avail_engines:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    elif "BLENDER_EEVEE" in avail_engines:
        scene.render.engine = "BLENDER_EEVEE"
    else:
        scene.render.engine = "CYCLES"
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720

    world = scene.world
    if not world.use_nodes:
        world.use_nodes = True
    bg = next((n for n in world.node_tree.nodes if n.type == "BACKGROUND"), None)
    if bg:
        bg.inputs["Color"].default_value = (0.35, 0.42, 0.54, 1.0)
        bg.inputs["Strength"].default_value = 1.1

    # サンライト
    for idx, (loc, rot, energy) in enumerate(
        [
            ((100.0, -200.0, 300.0), (math.radians(50), 0.0, math.radians(35)), 3.0),
            ((-150.0, 200.0, 250.0), (math.radians(60), 0.0, math.radians(-140)), 1.5),
        ]
    ):
        light_data = bpy.data.lights.new(name=f"Sun_{idx}", type="SUN")
        light_data.energy = energy
        light_obj = bpy.data.objects.new(name=f"Sun_{idx}", object_data=light_data)
        scene.collection.objects.link(light_obj)
        light_obj.location = loc
        light_obj.rotation_euler = rot

    cam_data = bpy.data.cameras.new("PlateauReviewCamera")
    cam_data.lens = 32.0
    cam_data.clip_end = 3000.0
    cam_obj = bpy.data.objects.new("PlateauReviewCamera", cam_data)
    scene.collection.objects.link(cam_obj)
    scene.camera = cam_obj

    # 渋谷の主要ランドマーク・交差点・坂道・街並みアングル
    # Blender 座標系: x=world_x, y=-world_z, z=height
    angles = [
        # 1. スクランブル交差点・ハチ公前（俯瞰）
        (
            "01_scramble_crossing_birdseye",
            Vector((-815.0, -248.0, 180.0)),
            Vector((-815.0, -248.0, 25.0)),
        ),
        # 2. 道玄坂を登るドライバー視点
        ("02_dogenzaka_driver_view", Vector((-830.0, -248.0, 4.0)), Vector((-930.0, -200.0, 22.0))),
        # 3. 宮益坂を登るドライバー視点（東向き）
        (
            "03_miyamasuzaka_driver_view",
            Vector((-750.0, -248.0, 5.0)),
            Vector((-620.0, -248.0, 28.0)),
        ),
        # 4. センター街・井の頭通りの密集街区
        (
            "04_center_gai_dense_fabric",
            Vector((-815.0, -260.0, 8.0)),
            Vector((-900.0, -290.0, 20.0)),
        ),
        # 5. 明治通り・渋谷ストリーム前（北向きアイレベル）
        (
            "05_meiji_dori_shibuya_stream",
            Vector((-750.0, 15.0, 3.0)),
            Vector((-750.0, -150.0, 45.0)),
        ),
        # 6. 渋谷駅東口・ヒカリエ・スクランブルスクエア広角
        (
            "06_station_east_hikarie_wide",
            Vector((-645.0, -145.0, 40.0)),
            Vector((-780.0, -145.0, 80.0)),
        ),
        # 7. 桜丘町・セルリアンタワー台地見上げ
        (
            "07_sakuragaoka_cerulean_slope",
            Vector((-810.0, 45.0, 6.0)),
            Vector((-900.0, 45.0, 85.0)),
        ),
        # 8. 渋谷エリア全域高空バードズアイ（南西から北東全景）
        (
            "08_shibuya_metropolis_high_birdseye",
            Vector((-1050.0, 100.0, 450.0)),
            Vector((-750.0, -150.0, 60.0)),
        ),
    ]

    for name, cam_pos, target_pos in angles:
        cam_obj.location = cam_pos
        direction = target_pos - cam_pos
        cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        out_file = os.path.join(review_dir, f"{name}.png")
        scene.render.filepath = out_file
        bpy.ops.render.render(write_still=True)
        print(f"[Review] Rendered: {out_file}")


if __name__ == "__main__":
    generate_shibuya_plateau_city()
    if "--render-review" in sys.argv:
        idx = sys.argv.index("--render-review")
        target_dir = sys.argv[idx + 1] if idx + 1 < len(sys.argv) else "/tmp/shibuya_plateau_review"
        render_360_review(target_dir)

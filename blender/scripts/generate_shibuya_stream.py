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
渋谷ストリーム（Shibuya Stream）高精度 3D モデル生成スクリプト
実寸 180.0m（地上35階）・シーラカンスアンドアソシエイツ（CAt）設計の特徴的な外観を忠実に再現：
1. 高層オフィスタワー（14F〜35F, Z=66m〜168m）:
   - Low-E ブルーグレー反射ガラスカーテンウォール + 白アルミパネルの「ストリーム（水流）」スタガード格子
   - 屋上（Z=168m〜180m）の溶融亜鉛めっき鉄骨オープンフレーム（ブレース付き冠部）＆屋上緑化
2. 中層ボイド＆ホテル層（7F〜13F, Z=32m〜66m）:
   - 深いチャコールグレーの吹き抜けボイド層 + 垂直壁面緑化（グリーンウォール）＆白縦ルーバーの交互配置
   - 9F〜13F の高密度縦マリオン・ガラスバンド
3. 低層商業ポディウム・歩行者デッキ・稲荷橋広場大階段（1F〜6F, Z=0m〜32m）:
   - 1F ピロティ円柱列、キャンチレバーで張り出すガラスキューブ群、北西角の円筒ガラスパビリオン
   - 2F/3F ペデストリアンデッキと稲荷橋広場へ降りる大階段
4. 渋谷ストリーム建築サイン＆ライムイエロー・ストリームアクセント（ShibuyaStream_Signage）:
   - 高層ファサード4面（Z=152m）、中層ポディウム冠部（Z=29.2m）、低層2Fエントランスキャノピー（Z=10.6m）、
     および明治通り沿い稲荷橋広場アイレベル・モニュメントサイン（Z=2.35m）に、
     渋谷ストリーム固有のライムイエロー・ストリームライン＆ホワイトアルミ建築サインを配置。
"""

import math
import os

import bpy

# isort: split
# Why not: bpy 単体 wheel (PyPI) では import bpy 実行時に初めて bmesh / mathutils が
# sys.modules に登録されるため、アルファベット順で bmesh を先に import すると ModuleNotFoundError になる。
import bmesh
from mathutils import Vector


def clean_scene():
    """既存の全オブジェクト・メッシュ・マテリアルをクリアする"""
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh, do_unlink=True)
    for mat in list(bpy.data.materials):
        bpy.data.materials.remove(mat, do_unlink=True)


def create_material(
    name: str,
    base_color: tuple,
    roughness: float = 0.5,
    metallic: float = 0.0,
    emission_color: tuple | None = None,
    emission_strength: float = 0.0,
    coat_weight: float = 0.0,
) -> bpy.types.Material:
    """Blender 5.0+ Principled BSDF マテリアルを作成する"""
    mat = bpy.data.materials.new(name=name)
    has_node_tree = mat.node_tree is not None
    if not has_node_tree:
        mat.use_nodes = True
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf:
        bsdf.inputs["Base Color"].default_value = base_color
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
        if coat_weight > 0.0 and "Coat Weight" in bsdf.inputs:
            bsdf.inputs["Coat Weight"].default_value = coat_weight
        if emission_color is not None and "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = emission_color
            bsdf.inputs["Emission Strength"].default_value = emission_strength
    return mat


def setup_materials() -> dict[str, bpy.types.Material]:
    """実写の渋谷ストリーム（Shibuya Stream）に基づく PBR マテリアル群を構築する"""
    mats = {
        # 0: 白アルミカーテンウォールパネル（渋谷ストリーム象徴の白い縦横ランダムフィン）
        "StreamWhitePanel": create_material(
            "StreamWhitePanel",
            base_color=(0.93, 0.95, 0.97, 1.0),
            roughness=0.26,
            metallic=0.28,
            coat_weight=0.35,
        ),
        # 1: 高層 Low-E ブルーグレー反射カーテンウォールガラス
        "StreamCurtainGlass": create_material(
            "StreamCurtainGlass",
            base_color=(0.24, 0.41, 0.56, 1.0),
            roughness=0.10,
            metallic=0.42,
            coat_weight=0.90,
        ),
        # 2: 中層ボイド・低層ピロティのダークチャコール鉄骨・打放しコンクリート
        "StreamDarkVoidSteel": create_material(
            "StreamDarkVoidSteel",
            base_color=(0.09, 0.11, 0.14, 1.0),
            roughness=0.48,
            metallic=0.52,
        ),
        # 3: 屋上オープンフレーム＆デッキ梁の溶融亜鉛めっき鋼材（シルバーグレー）
        "StreamGalvanizedFrame": create_material(
            "StreamGalvanizedFrame",
            base_color=(0.56, 0.60, 0.65, 1.0),
            roughness=0.38,
            metallic=0.72,
        ),
        # 4: 中層・低層ボイドの垂直壁面緑化（グリーンウォール植栽）
        "StreamVerticalGreen": create_material(
            "StreamVerticalGreen",
            base_color=(0.18, 0.34, 0.13, 1.0),
            roughness=0.84,
            metallic=0.0,
        ),
        # 5: 渋谷ストリーム ブランドアクセント（ライムイエロー）
        "StreamYellowAccent": create_material(
            "StreamYellowAccent",
            base_color=(0.84, 0.90, 0.08, 1.0),
            roughness=0.24,
            metallic=0.15,
            emission_color=(0.75, 0.82, 0.06, 1.0),
            emission_strength=0.65,
        ),
        # 6: 商業フロア・カフェ・オフィス窓のウォームインテリア発光ガラス
        "WarmPlazaGlow": create_material(
            "WarmPlazaGlow",
            base_color=(1.0, 0.88, 0.68, 1.0),
            roughness=0.18,
            metallic=0.10,
            emission_color=(1.0, 0.82, 0.54, 1.0),
            emission_strength=0.85,
        ),
        # 7: 航空障害灯レッド発光
        "BeaconRed": create_material(
            "BeaconRed",
            base_color=(1.0, 0.12, 0.08, 1.0),
            roughness=0.15,
            metallic=0.0,
            emission_color=(1.0, 0.15, 0.08, 1.0),
            emission_strength=3.2,
        ),
    }
    return mats


def add_box(bm: bmesh.types.BMesh, center: Vector, size: Vector, mat_idx: int = 0):
    """指定中心・サイズの直方体を bmesh に追加する"""
    res = bmesh.ops.create_cube(bm, size=1.0)
    verts = res["verts"]
    bmesh.ops.scale(bm, vec=size, verts=verts)
    bmesh.ops.translate(bm, vec=center, verts=verts)
    for v in verts:
        for f in v.link_faces:
            f.material_index = mat_idx


def add_oriented_box(
    bm: bmesh.types.BMesh,
    center: Vector,
    tangent_dir: Vector,
    normal_dir: Vector,
    size_tangent: float,
    size_normal: float,
    size_z: float,
    mat_idx: int = 0,
):
    """接線・法線・Z軸方向に整列した直方体を bmesh に追加する"""
    t = tangent_dir.normalized()
    n = normal_dir.normalized()
    up = Vector((0.0, 0.0, 1.0))

    ht = size_tangent * 0.5
    hn = size_normal * 0.5
    hz = size_z * 0.5

    offsets = [
        (-ht, -hn, -hz),
        (ht, -hn, -hz),
        (ht, hn, -hz),
        (-ht, hn, -hz),
        (-ht, -hn, hz),
        (ht, -hn, hz),
        (ht, hn, hz),
        (-ht, hn, hz),
    ]
    v = [bm.verts.new(center + t * ox + n * oy + up * oz) for (ox, oy, oz) in offsets]
    quads = [
        (0, 3, 2, 1),
        (4, 5, 6, 7),
        (0, 1, 5, 4),
        (2, 3, 7, 6),
        (1, 2, 6, 5),
        (3, 0, 4, 7),
    ]
    for q in quads:
        f = bm.faces.new([v[q[0]], v[q[1]], v[q[2]], v[q[3]]])
        f.material_index = mat_idx


def add_cylinder_z(
    bm: bmesh.types.BMesh,
    center: Vector,
    radius: float,
    height: float,
    segments: int = 16,
    mat_idx: int = 0,
    smooth: bool = True,
):
    """Z軸方向の円柱を bmesh に追加する"""
    bot_verts = []
    top_verts = []
    hz = height * 0.5
    for i in range(segments):
        ang = (2.0 * math.pi * i) / segments
        dx = math.cos(ang) * radius
        dy = math.sin(ang) * radius
        bot_verts.append(bm.verts.new(center + Vector((dx, dy, -hz))))
        top_verts.append(bm.verts.new(center + Vector((dx, dy, hz))))

    for i in range(segments):
        ni = (i + 1) % segments
        f = bm.faces.new([bot_verts[i], bot_verts[ni], top_verts[ni], top_verts[i]])
        f.material_index = mat_idx
        f.smooth = smooth

    f_bot = bm.faces.new(list(reversed(bot_verts)))
    f_bot.material_index = mat_idx
    f_top = bm.faces.new(top_verts)
    f_top.material_index = mat_idx


def add_extruded_arc_ring(
    bm: bmesh.types.BMesh,
    center: Vector,
    tangent_dir: Vector,
    normal_dir: Vector,
    outer_r: float,
    inner_r: float,
    depth: float,
    start_deg: float = 0.0,
    end_deg: float = 360.0,
    segments: int = 28,
    mat_idx: int = 0,
    offset_t: float = 0.0,
    offset_z: float = 0.0,
):
    """
    ファサード平面 (tangent_dir, Z) 上に円環または円弧を描き、normal_dir 方向へ厚み depth で押し出した
    3D メッシュを追加する（Google ロゴの G, o, g, e の曲線パーツ生成用）。
    """
    t = tangent_dir.normalized()
    n = normal_dir.normalized()
    up = Vector((0.0, 0.0, 1.0))
    origin = center + t * offset_t + up * offset_z
    hd = depth * 0.5

    is_full_circle = abs((end_deg - start_deg) - 360.0) < 1e-3
    num_pts = segments if is_full_circle else segments + 1

    front_outer = []
    front_inner = []
    back_outer = []
    back_inner = []

    for i in range(num_pts):
        ratio = i / segments
        ang = math.radians(start_deg + (end_deg - start_deg) * ratio)
        ca = math.cos(ang)
        sa = math.sin(ang)
        p_out = origin + t * (ca * outer_r) + up * (sa * outer_r)
        p_in = origin + t * (ca * inner_r) + up * (sa * inner_r)

        front_outer.append(bm.verts.new(p_out + n * hd))
        front_inner.append(bm.verts.new(p_in + n * hd))
        back_outer.append(bm.verts.new(p_out - n * hd))
        back_inner.append(bm.verts.new(p_in - n * hd))

    loop_count = segments
    for i in range(loop_count):
        ni = (i + 1) % num_pts
        # 前面・背面・外周・内周の4面
        for quad in [
            [front_inner[i], front_outer[i], front_outer[ni], front_inner[ni]],
            [back_outer[i], back_inner[i], back_inner[ni], back_outer[ni]],
            [front_outer[i], back_outer[i], back_outer[ni], front_outer[ni]],
            [back_inner[i], front_inner[i], front_inner[ni], back_inner[ni]],
        ]:
            f = bm.faces.new(quad)
            f.material_index = mat_idx

    if not is_full_circle:
        # 始端・終端のキャップ面
        f_start = bm.faces.new([front_outer[0], front_inner[0], back_inner[0], back_outer[0]])
        f_start.material_index = mat_idx
        f_end = bm.faces.new([front_inner[-1], front_outer[-1], back_outer[-1], back_inner[-1]])
        f_end.material_index = mat_idx


def add_3d_stream_architectural_emblem(
    bm: bmesh.types.BMesh,
    center: Vector,
    tangent_dir: Vector,
    normal_dir: Vector,
    cap_height: float,
    depth: float,
    with_backing_plate: bool = True,
    mat_white: int = 0,
    mat_dark_frame: int = 2,
    mat_galvanized: int = 3,
    mat_yellow_accent: int = 5,
):
    """
    指定したファサード面上に渋谷ストリーム（SHIBUYA STREAM）の建築ストリーム・エンブレム＆
    ライムイエロー水平ストリームラインを生成する（特定企業ロゴを含まない純粋な建築サイン）。
    """
    t = tangent_dir.normalized()
    n = normal_dir.normalized()
    up = Vector((0.0, 0.0, 1.0))

    plate_w = cap_height * 4.4
    plate_h = cap_height * 1.55

    if with_backing_plate:
        # ダークチャコール外枠バックプレート
        add_oriented_box(
            bm,
            center=center - n * (depth * 0.45),
            tangent_dir=t,
            normal_dir=n,
            size_tangent=plate_w,
            size_normal=depth * 0.65,
            size_z=plate_h,
            mat_idx=mat_dark_frame,
        )
        # 溶融亜鉛めっきインナーフレーム
        add_oriented_box(
            bm,
            center=center - n * (depth * 0.18),
            tangent_dir=t,
            normal_dir=n,
            size_tangent=plate_w - cap_height * 0.22,
            size_normal=depth * 0.42,
            size_z=plate_h - cap_height * 0.22,
            mat_idx=mat_galvanized,
        )

    # 3本の流れるような水平ストリーム・リボン（上段：白アルミ、中段：ライムイエロー発光、下段：白アルミ）
    bar_configs = [
        (-0.22 * cap_height, 0.36 * cap_height, 2.85 * cap_height, 0.22 * cap_height, mat_white),
        (0.18 * cap_height, 0.0, 3.35 * cap_height, 0.26 * cap_height, mat_yellow_accent),
        (0.24 * cap_height, -0.36 * cap_height, 2.85 * cap_height, 0.22 * cap_height, mat_white),
    ]
    for offset_t, offset_z, bar_w, bar_h, m_idx in bar_configs:
        add_oriented_box(
            bm,
            center=center + t * offset_t + up * offset_z + n * (depth * 0.22),
            tangent_dir=t,
            normal_dir=n,
            size_tangent=bar_w,
            size_normal=depth * 0.75,
            size_z=bar_h,
            mat_idx=m_idx,
        )

    # 左端の「S」字ストリーム・デュアルアーク（水流シンボル）
    arc_r = cap_height * 0.28
    arc_stroke = cap_height * 0.11
    add_extruded_arc_ring(
        bm,
        center=center,
        tangent_dir=t,
        normal_dir=n,
        outer_r=arc_r,
        inner_r=arc_r - arc_stroke,
        depth=depth * 0.85,
        start_deg=35.0,
        end_deg=270.0,
        segments=20,
        mat_idx=mat_yellow_accent,
        offset_t=-1.55 * cap_height,
        offset_z=0.18 * cap_height,
    )
    add_extruded_arc_ring(
        bm,
        center=center,
        tangent_dir=t,
        normal_dir=n,
        outer_r=arc_r,
        inner_r=arc_r - arc_stroke,
        depth=depth * 0.85,
        start_deg=215.0,
        end_deg=450.0,
        segments=20,
        mat_idx=mat_white,
        offset_t=-1.55 * cap_height,
        offset_z=-0.18 * cap_height,
    )


def assign_materials_to_object(obj: bpy.types.Object, materials: dict[str, bpy.types.Material]):
    """固定インデックス順でオブジェクトに全マテリアルスロットを割り当てる"""
    ordered_keys = [
        "StreamWhitePanel",  # 0
        "StreamCurtainGlass",  # 1
        "StreamDarkVoidSteel",  # 2
        "StreamGalvanizedFrame",  # 3
        "StreamVerticalGreen",  # 4
        "StreamYellowAccent",  # 5
        "WarmPlazaGlow",  # 6
        "BeaconRed",  # 7
    ]
    for k in ordered_keys:
        obj.data.materials.append(materials[k])


def build_high_rise_tower(materials: dict[str, bpy.types.Material]) -> bpy.types.Object:
    """
    渋谷ストリーム高層オフィスタワー（14F〜35F, Z=66m〜180m）を構築する。
    実写（File:Shibuya Stream-1b.jpg / detail_3.jpg）に忠実なスタガード白アルミパネル格子と
    屋上の溶融亜鉛めっき鉄骨オープンフレーム冠部を備える。
    """
    mesh = bpy.data.meshes.new("ShibuyaStream_HighRiseMesh")
    bm = bmesh.new()

    tower_w = 50.0  # X軸幅 (-25m..+25m)
    tower_d = 38.0  # Y軸奥行 (-19m..+19m)
    z_start = 66.0
    z_glass_top = 168.0
    z_crown_top = 180.0
    glass_h = z_glass_top - z_start

    # 1. メインガラスカーテンウォールコア (Z=66m..168m)
    add_box(
        bm,
        center=Vector((0.0, 0.0, z_start + glass_h * 0.5)),
        size=Vector((tower_w, tower_d, glass_h)),
        mat_idx=1,
    )

    # 2. 各階（14F〜35F：22フロア × 階高 4.63m）の水平スパンドレル帯＆発光オフィス窓バンド
    num_floors = 22
    floor_h = glass_h / num_floors
    for fl in range(num_floors + 1):
        fz = z_start + fl * floor_h
        # 水平アルミスパンドレルフィン
        add_box(
            bm,
            center=Vector((0.0, 0.0, fz)),
            size=Vector((tower_w + 0.32, tower_d + 0.32, 0.36)),
            mat_idx=0,
        )
        # 3階おきに室内のウォームオフィス照明ストリップを内側に配置
        is_lit_floor = fl < num_floors and (fl % 3 == 1)
        if is_lit_floor:
            add_box(
                bm,
                center=Vector((0.0, 0.0, fz + floor_h * 0.5)),
                size=Vector((tower_w + 0.06, tower_d + 0.06, floor_h * 0.42)),
                mat_idx=6,
            )

    # 3. 渋谷ストリーム象徴の「スタガード（千鳥・水流）白アルミパネル＆縦フィン」
    # 正面(-Y: 明治通り側) と 背面(+Y: 渋谷川側): 20ベイ
    num_bays_x = 20
    bay_w_x = tower_w / num_bays_x
    for bx in range(num_bays_x + 1):
        cx = -tower_w * 0.5 + bx * bay_w_x
        # 細い垂直サッシマリオン（全高通し）
        for ny_sign in [-1.0, 1.0]:
            py = ny_sign * (tower_d * 0.5 + 0.12)
            add_box(
                bm,
                center=Vector((cx, py, z_start + glass_h * 0.5)),
                size=Vector((0.18, 0.24, glass_h)),
                mat_idx=3,
            )

    # 水流のように斜め・千鳥状に連なる白アルミパネル（CAt ファサードパターン）
    for fl in range(num_floors):
        fz = z_start + (fl + 0.5) * floor_h
        for bx in range(num_bays_x):
            cx = -tower_w * 0.5 + (bx + 0.5) * bay_w_x
            # 周期的ハッシュと階段位相で実写の斜めストリーム白パネル配置を生成
            stream_phase = (bx * 3 + fl * 2) % 7
            is_wide_panel = stream_phase in (0, 1)
            is_narrow_fin = stream_phase == 4
            if is_wide_panel or is_narrow_fin:
                panel_w = bay_w_x * (0.86 if is_wide_panel else 0.42)
                panel_x = cx + (0.0 if is_wide_panel else -bay_w_x * 0.22)
                for ny_sign in [-1.0, 1.0]:
                    py = ny_sign * (tower_d * 0.5 + 0.22)
                    add_box(
                        bm,
                        center=Vector((panel_x, py, fz)),
                        size=Vector((panel_w, 0.34, floor_h + 0.12)),
                        mat_idx=0,
                    )

    # 左側面(-X: 渋谷駅・スクランブルスクエア側) と 右側面(+X: 恵比寿側): 16ベイ
    num_bays_y = 16
    bay_w_y = tower_d / num_bays_y
    for by in range(num_bays_y + 1):
        cy = -tower_d * 0.5 + by * bay_w_y
        for nx_sign in [-1.0, 1.0]:
            px = nx_sign * (tower_w * 0.5 + 0.12)
            add_box(
                bm,
                center=Vector((px, cy, z_start + glass_h * 0.5)),
                size=Vector((0.24, 0.18, glass_h)),
                mat_idx=3,
            )

    for fl in range(num_floors):
        fz = z_start + (fl + 0.5) * floor_h
        for by in range(num_bays_y):
            cy = -tower_d * 0.5 + (by + 0.5) * bay_w_y
            stream_phase = (by * 3 + fl * 2 + 2) % 7
            is_wide_panel = stream_phase in (0, 2)
            is_narrow_fin = stream_phase == 5
            if is_wide_panel or is_narrow_fin:
                panel_d = bay_w_y * (0.86 if is_wide_panel else 0.42)
                for nx_sign in [-1.0, 1.0]:
                    px = nx_sign * (tower_w * 0.5 + 0.22)
                    add_box(
                        bm,
                        center=Vector((px, cy, fz)),
                        size=Vector((0.34, panel_d, floor_h + 0.12)),
                        mat_idx=0,
                    )

    # 4隅のホワイトコーナーピラー（建物の輪郭を引き締める）
    for sx in [-1.0, 1.0]:
        for sy in [-1.0, 1.0]:
            add_box(
                bm,
                center=Vector(
                    (
                        sx * (tower_w * 0.5 + 0.18),
                        sy * (tower_d * 0.5 + 0.18),
                        z_start + glass_h * 0.5,
                    )
                ),
                size=Vector((1.35, 1.35, glass_h + 0.4)),
                mat_idx=0,
            )

    # 4. 屋上オープン鉄骨フレーム冠部 (Z=168m..180m: 実写 wikimedia_2.jpg / wikimedia_5.jpg)
    crown_h = z_crown_top - z_glass_top
    crown_mid_z = z_glass_top + crown_h * 0.5
    # 屋上内側の設備コア＆屋上緑化プランター
    add_box(
        bm,
        center=Vector((0.0, 0.0, z_glass_top + crown_h * 0.38)),
        size=Vector((tower_w - 8.5, tower_d - 8.5, crown_h * 0.76)),
        mat_idx=2,
    )
    # 屋上外周の植栽ヘッジ（実写 wikimedia_2.jpg の屋上緑化）
    add_box(
        bm,
        center=Vector((0.0, 0.0, z_glass_top + 1.2)),
        size=Vector((tower_w - 2.2, tower_d - 2.2, 2.2)),
        mat_idx=4,
    )

    # 外周の溶融亜鉛めっき鉄骨柱列＆水平H鋼ビーム3段
    for bx in range(0, num_bays_x + 1, 2):
        cx = -tower_w * 0.5 + bx * bay_w_x
        for ny_sign in [-1.0, 1.0]:
            py = ny_sign * (tower_d * 0.5 - 0.2)
            add_box(
                bm,
                center=Vector((cx, py, crown_mid_z)),
                size=Vector((0.55, 0.55, crown_h)),
                mat_idx=3,
            )
    for by in range(0, num_bays_y + 1, 2):
        cy = -tower_d * 0.5 + by * bay_w_y
        for nx_sign in [-1.0, 1.0]:
            px = nx_sign * (tower_w * 0.5 - 0.2)
            add_box(
                bm,
                center=Vector((px, cy, crown_mid_z)),
                size=Vector((0.55, 0.55, crown_h)),
                mat_idx=3,
            )

    for ring_z in [z_glass_top + 4.0, z_glass_top + 8.0, z_crown_top - 0.35]:
        for ny_sign in [-1.0, 1.0]:
            add_box(
                bm,
                center=Vector((0.0, ny_sign * (tower_d * 0.5 - 0.2), ring_z)),
                size=Vector((tower_w + 0.4, 0.60, 0.55)),
                mat_idx=3,
            )
        for nx_sign in [-1.0, 1.0]:
            add_box(
                bm,
                center=Vector((nx_sign * (tower_w * 0.5 - 0.2), 0.0, ring_z)),
                size=Vector((0.60, tower_d + 0.4, 0.55)),
                mat_idx=3,
            )

    # 屋上航空障害灯（四隅）
    for sx in [-1.0, 1.0]:
        for sy in [-1.0, 1.0]:
            add_cylinder_z(
                bm,
                center=Vector(
                    (sx * (tower_w * 0.5 - 0.8), sy * (tower_d * 0.5 - 0.8), z_crown_top + 0.9)
                ),
                radius=0.45,
                height=1.8,
                segments=12,
                mat_idx=7,
            )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("ShibuyaStream_HighRise", mesh)
    assign_materials_to_object(obj, materials)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_mid_void_and_hotel_band(materials: dict[str, bpy.types.Material]) -> bpy.types.Object:
    """
    中層ボイド＆ホテル層（Z=32m〜66m）を構築する。
    - Z=32m〜48m: 深いダークチャコール吹き抜けボイド + 壁面緑化（グリーンウォール）＋白縦パネルの千鳥配置
      （実写 File:Shibuya Stream-2a.jpg / detail_1.jpg / detail_2.jpg で非常に特徴的な中層帯）
    - Z=48m〜66m: 9F〜13F エクセルホテル東急＆スカイロビーの高密度縦マリオン・ガラスバンド
    """
    mesh = bpy.data.meshes.new("ShibuyaStream_MidVoidMesh")
    bm = bmesh.new()

    tower_w = 50.0
    tower_d = 38.0

    # 1. Z=32m..48m: 奥まったダークチャコール構造コア
    void_z0 = 32.0
    void_z1 = 48.0
    void_h = void_z1 - void_z0
    void_mid_z = void_z0 + void_h * 0.5
    add_box(
        bm,
        center=Vector((0.0, 0.0, void_mid_z)),
        size=Vector((tower_w - 4.2, tower_d - 4.2, void_h)),
        mat_idx=2,
    )
    # ボイド内の水平構造スラブ（2段）
    for sz in [32.3, 40.0, 47.7]:
        add_box(
            bm,
            center=Vector((0.0, 0.0, sz)),
            size=Vector((tower_w + 0.2, tower_d + 0.2, 0.65)),
            mat_idx=2,
        )

    # ボイド外周に並ぶ「白アルミ縦パネル」と「垂直壁面緑化（グリーンウォール）」の交互配置
    num_void_cols_x = 14
    col_step_x = tower_w / num_void_cols_x
    for i in range(num_void_cols_x):
        cx = -tower_w * 0.5 + (i + 0.5) * col_step_x
        for ny_sign in [-1.0, 1.0]:
            py = ny_sign * (tower_d * 0.5 - 0.15)
            # 下段 (Z=32..40) と 上段 (Z=40..48) で白パネルと緑化パネルを千鳥配置
            for seg_idx, seg_z in enumerate([36.0, 44.0]):
                mode = (i + seg_idx) % 3
                if mode == 0:
                    # 白アルミ縦パネル
                    add_box(
                        bm,
                        center=Vector((cx, py, seg_z)),
                        size=Vector((col_step_x * 0.68, 0.55, 7.6)),
                        mat_idx=0,
                    )
                elif mode == 1:
                    # 垂直壁面緑化プランター（グリーンウォール）
                    add_box(
                        bm,
                        center=Vector((cx, py - ny_sign * 0.25, seg_z)),
                        size=Vector((col_step_x * 0.64, 0.75, 7.4)),
                        mat_idx=4,
                    )

    num_void_cols_y = 10
    col_step_y = tower_d / num_void_cols_y
    for i in range(num_void_cols_y):
        cy = -tower_d * 0.5 + (i + 0.5) * col_step_y
        for nx_sign in [-1.0, 1.0]:
            px = nx_sign * (tower_w * 0.5 - 0.15)
            for seg_idx, seg_z in enumerate([36.0, 44.0]):
                mode = (i + seg_idx + 1) % 3
                if mode == 0:
                    add_box(
                        bm,
                        center=Vector((px, cy, seg_z)),
                        size=Vector((0.55, col_step_y * 0.68, 7.6)),
                        mat_idx=0,
                    )
                elif mode == 1:
                    add_box(
                        bm,
                        center=Vector((px - nx_sign * 0.25, cy, seg_z)),
                        size=Vector((0.75, col_step_y * 0.64, 7.4)),
                        mat_idx=4,
                    )

    # 2. Z=48m..66m: 9F〜13F ホテル＆スカイロビー層（細かい縦マリオン＋白パネルアクセント）
    hotel_z0 = 48.0
    hotel_z1 = 66.0
    hotel_h = hotel_z1 - hotel_z0
    hotel_mid_z = hotel_z0 + hotel_h * 0.5
    add_box(
        bm,
        center=Vector((0.0, 0.0, hotel_mid_z)),
        size=Vector((tower_w, tower_d, hotel_h)),
        mat_idx=1,
    )
    # 4フロア分の水平白帯と高密度縦マリオン
    for fl in range(5):
        fz = hotel_z0 + fl * (hotel_h / 4.0)
        add_box(
            bm,
            center=Vector((0.0, 0.0, fz)),
            size=Vector((tower_w + 0.30, tower_d + 0.30, 0.38)),
            mat_idx=0,
        )

    for i in range(32):
        cx = -tower_w * 0.5 + (i + 0.5) * (tower_w / 32.0)
        is_white_strip = i % 5 == 0
        for ny_sign in [-1.0, 1.0]:
            py = ny_sign * (tower_d * 0.5 + 0.16)
            add_box(
                bm,
                center=Vector((cx, py, hotel_mid_z)),
                size=Vector((1.15 if is_white_strip else 0.22, 0.30, hotel_h)),
                mat_idx=0 if is_white_strip else 3,
            )

    for j in range(24):
        cy = -tower_d * 0.5 + (j + 0.5) * (tower_d / 24.0)
        is_white_strip = j % 4 == 0
        for nx_sign in [-1.0, 1.0]:
            px = nx_sign * (tower_w * 0.5 + 0.16)
            add_box(
                bm,
                center=Vector((px, cy, hotel_mid_z)),
                size=Vector((0.30, 1.15 if is_white_strip else 0.22, hotel_h)),
                mat_idx=0 if is_white_strip else 3,
            )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("ShibuyaStream_MidVoid", mesh)
    assign_materials_to_object(obj, materials)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_low_rise_podium_and_plaza(materials: dict[str, bpy.types.Material]) -> bpy.types.Object:
    """
    低層商業ポディウム・歩行者デッキ・円筒ガラスアトリウム・稲荷橋広場大階段（1F〜6F, Z=0m〜32m）を構築する。
    実写（detail_2.jpg / cat_0.jpg）の通り：
    - 1F (Z=0..8.5m): ダークチャコールの円柱ピロティ列と奥まったガラスエントランス
    - 2F〜6F (Z=8.5..32m): 明治通り側(-Y)および渋谷駅側(-X)へ張り出すガラス＆白パネルの積層キューブ群
    - 北西角 (-X, -Y) の2層吹き抜け円筒ガラスパビリオン＆歩行者デッキ歩道橋
    - 稲荷橋広場の大階段（階段ステップ＋傾斜に追従したガラス・白スチール手すり）
    """
    mesh = bpy.data.meshes.new("ShibuyaStream_PodiumMesh")
    bm = bmesh.new()

    # 1. 1F ベースプラザ床スラブ＆ダークコア (Z=0..8.8m)
    add_box(
        bm,
        center=Vector((0.0, 0.0, 4.4)),
        size=Vector((46.0, 34.0, 8.8)),
        mat_idx=2,
    )
    # 1F 路面商業・エントランス発光ショーウィンドウ
    add_box(
        bm,
        center=Vector((0.0, -17.1, 3.8)),
        size=Vector((38.0, 0.4, 5.8)),
        mat_idx=6,
    )
    add_box(
        bm,
        center=Vector((-23.1, 0.0, 3.8)),
        size=Vector((0.4, 26.0, 5.8)),
        mat_idx=6,
    )

    # 1F 外周の重厚なダークチャコール円柱ピロティ列（実写 cat_0.jpg 右下の丸柱列）
    for cx in [-24.0, -16.0, -8.0, 0.0, 8.0, 16.0, 24.0]:
        for cy in [-20.5, 20.5]:
            add_cylinder_z(
                bm,
                center=Vector((cx, cy, 4.5)),
                radius=0.68,
                height=9.0,
                segments=16,
                mat_idx=2,
            )
    for cy in [-12.0, -4.0, 4.0, 12.0]:
        for cx in [-26.5, 26.5]:
            add_cylinder_z(
                bm,
                center=Vector((cx, cy, 4.5)),
                radius=0.68,
                height=9.0,
                segments=16,
                mat_idx=2,
            )

    # 2. 2F〜4F キャンチレバー積層ガラスキューブ (Z=8.8m..21.5m)
    podium_w = 55.0
    podium_d = 43.0
    podium_z0 = 8.8
    podium_z1 = 21.5
    podium_h = podium_z1 - podium_z0
    add_box(
        bm,
        center=Vector((0.0, -1.0, podium_z0 + podium_h * 0.5)),
        size=Vector((podium_w, podium_d, podium_h)),
        mat_idx=1,
    )
    # ポディウム内部の暖かいカフェ・商業照明バンド
    for lz in [11.2, 15.2, 19.2]:
        add_box(
            bm,
            center=Vector((0.0, -1.0, lz)),
            size=Vector((podium_w + 0.08, podium_d + 0.08, 1.8)),
            mat_idx=6,
        )
    # ポディウム外周の白アルミパネル＆グリッドフレーム（実写 detail_2.jpg）
    for sz in [8.8, 13.0, 17.2, 21.5]:
        add_box(
            bm,
            center=Vector((0.0, -1.0, sz)),
            size=Vector((podium_w + 0.45, podium_d + 0.45, 0.50)),
            mat_idx=0,
        )
    for bx in range(15):
        cx = -podium_w * 0.5 + (bx + 0.5) * (podium_w / 15.0)
        is_panel = bx % 3 == 0
        for ny_pos in [-22.6, 20.6]:
            add_box(
                bm,
                center=Vector((cx, ny_pos, podium_z0 + podium_h * 0.5)),
                size=Vector((2.4 if is_panel else 0.28, 0.38, podium_h)),
                mat_idx=0 if is_panel else 3,
            )
    for by in range(12):
        cy = -1.0 - podium_d * 0.5 + (by + 0.5) * (podium_d / 12.0)
        is_panel = by % 3 == 1
        for nx_pos in [-podium_w * 0.5 - 0.15, podium_w * 0.5 + 0.15]:
            add_box(
                bm,
                center=Vector((nx_pos, cy, podium_z0 + podium_h * 0.5)),
                size=Vector((0.38, 2.2 if is_panel else 0.28, podium_h)),
                mat_idx=0 if is_panel else 3,
            )

    # 3. 5F〜6F セットバック上層ポディウム (Z=21.5m..32.0m)
    upper_p_z0 = 21.5
    upper_p_z1 = 32.0
    upper_p_h = upper_p_z1 - upper_p_z0
    add_box(
        bm,
        center=Vector((0.0, -0.5, upper_p_z0 + upper_p_h * 0.5)),
        size=Vector((52.0, 40.0, upper_p_h)),
        mat_idx=1,
    )
    for sz in [25.0, 28.5, 32.0]:
        add_box(
            bm,
            center=Vector((0.0, -0.5, sz)),
            size=Vector((52.5, 40.5, 0.45)),
            mat_idx=0,
        )
    for bx in range(14):
        cx = -26.0 + (bx + 0.5) * (52.0 / 14.0)
        is_panel = (bx % 2) == 1
        for ny_pos in [-20.6, 19.6]:
            add_box(
                bm,
                center=Vector((cx, ny_pos, upper_p_z0 + upper_p_h * 0.5)),
                size=Vector((2.1 if is_panel else 0.26, 0.36, upper_p_h)),
                mat_idx=0 if is_panel else 3,
            )
    for by in range(11):
        cy = -0.5 - 20.0 + (by + 0.5) * (40.0 / 11.0)
        is_panel = (by % 2) == 0
        for nx_pos in [-26.15, 26.15]:
            add_box(
                bm,
                center=Vector((nx_pos, cy, upper_p_z0 + upper_p_h * 0.5)),
                size=Vector((0.36, 2.0 if is_panel else 0.26, upper_p_h)),
                mat_idx=0 if is_panel else 3,
            )

    # 4. 北西角・明治通り広場側の円筒ガラスパビリオン＆2Fペデストリアンデッキ（実写 detail_2.jpg 左手前）
    pav_center = Vector((-21.5, -24.5, 12.8))
    add_cylinder_z(
        bm,
        center=pav_center,
        radius=6.2,
        height=8.4,
        segments=24,
        mat_idx=1,
    )
    # パビリオン上下の白リングスラブ
    for rz in [8.6, 12.8, 17.0]:
        add_cylinder_z(
            bm,
            center=Vector((pav_center.x, pav_center.y, rz)),
            radius=6.45,
            height=0.42,
            segments=24,
            mat_idx=0,
        )

    # 2F 歩行者デッキテラス＆ガラス欄干 (Y = -22m..-27.5m, Z = 8.4m)
    add_box(
        bm,
        center=Vector((2.0, -24.8, 8.4)),
        size=Vector((42.0, 5.2, 0.65)),
        mat_idx=0,
    )
    add_box(
        bm,
        center=Vector((2.0, -27.2, 9.3)),
        size=Vector((42.0, 0.18, 1.15)),
        mat_idx=1,
    )
    # 渋谷ストリーム象徴のイエローストリーム・リボンアクセントライン
    add_box(
        bm,
        center=Vector((2.0, -27.45, 8.45)),
        size=Vector((42.2, 0.22, 0.28)),
        mat_idx=5,
    )

    # 5. 稲荷橋広場（Inaribashi Plaza）大階段（Z=0m から Z=8.4m の2Fデッキへ上がる大階段）
    num_steps = 16
    stair_w = 11.0
    stair_x = 12.5
    y_bot = -34.8
    y_top = -27.0
    z_top = 8.4
    for st in range(num_steps):
        ratio = (st + 0.5) / num_steps
        step_h = (st + 1) * (z_top / num_steps)
        step_z = step_h * 0.5
        step_y = y_bot + ratio * (y_top - y_bot)
        add_box(
            bm,
            center=Vector((stair_x, step_y, step_z)),
            size=Vector((stair_w, (y_top - y_bot) / num_steps + 0.08, step_h)),
            mat_idx=3,
        )
        # 階段側面の段差に追従した白スチール手すりポスト＆ガラス欄干
        for sx in [-1.0, 1.0]:
            rail_x = stair_x + sx * (stair_w * 0.5 + 0.22)
            add_box(
                bm,
                center=Vector((rail_x, step_y, step_h + 0.55)),
                size=Vector((0.28, (y_top - y_bot) / num_steps + 0.06, 1.10)),
                mat_idx=0 if (st % 3 == 0) else 1,
            )
            # 手すりトップの白キャップバー
            add_box(
                bm,
                center=Vector((rail_x, step_y, step_h + 1.16)),
                size=Vector((0.36, (y_top - y_bot) / num_steps + 0.10, 0.16)),
                mat_idx=0,
            )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("ShibuyaStream_Podium", mesh)
    assign_materials_to_object(obj, materials)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_stream_architectural_signage(
    materials: dict[str, bpy.types.Material],
) -> bpy.types.Object:
    """
    渋谷ストリーム（Shibuya Stream）の立体建築エンブレムサイン群を構築する：
    1. 高層タワー4面サイン (Z=152.0m, エンブレム高 5.4m):
       - 正面(-Y: 明治通り側)、背面(+Y: 渋谷川側)、左側面(-X: 渋谷駅側)、右側面(+X: 恵比寿側)の4面すべてに配置。
    2. 中層ポディウム冠部サイン (Z=29.2m, エンブレム高 3.2m):
       - 明治通り側(-Y)および渋谷駅側(-X)の低層ガラスキューブ最上部に配置し、
         道路走行中の追従カメラ・フロントガラス越しに自然な仰角で視認可能。
    3. 低層2Fデッキ・エントランスサイン (Z=10.6m, エンブレム高 2.15m) ＆
       明治通り稲荷橋広場アイレベル・モニュメントサイン (Z=2.35m, エンブレム高 1.55m):
       - コックピット視点（ドライバー目線高 1.18m）で目の前に渋谷ストリームの建築サインが鮮明に入る配置。
    """
    mesh = bpy.data.meshes.new("ShibuyaStream_SignageMesh")
    bm = bmesh.new()

    # 1. 高層タワー4面 渋谷ストリーム建築サイン (Z = 152.0m)
    # 正面 (-Y: 明治通り向き)
    add_3d_stream_architectural_emblem(
        bm,
        center=Vector((0.0, -19.65, 152.0)),
        tangent_dir=Vector((1.0, 0.0, 0.0)),
        normal_dir=Vector((0.0, -1.0, 0.0)),
        cap_height=5.4,
        depth=0.55,
        with_backing_plate=True,
    )
    # 背面 (+Y: 渋谷川向き)
    add_3d_stream_architectural_emblem(
        bm,
        center=Vector((0.0, 19.65, 152.0)),
        tangent_dir=Vector((-1.0, 0.0, 0.0)),
        normal_dir=Vector((0.0, 1.0, 0.0)),
        cap_height=5.4,
        depth=0.55,
        with_backing_plate=True,
    )
    # 左側面 (-X: 渋谷駅・国道246号向き)
    add_3d_stream_architectural_emblem(
        bm,
        center=Vector((-25.65, 0.0, 152.0)),
        tangent_dir=Vector((0.0, -1.0, 0.0)),
        normal_dir=Vector((-1.0, 0.0, 0.0)),
        cap_height=4.6,
        depth=0.55,
        with_backing_plate=True,
    )
    # 右側面 (+X: 恵比寿・並木橋向き)
    add_3d_stream_architectural_emblem(
        bm,
        center=Vector((25.65, 0.0, 152.0)),
        tangent_dir=Vector((0.0, 1.0, 0.0)),
        normal_dir=Vector((1.0, 0.0, 0.0)),
        cap_height=4.6,
        depth=0.55,
        with_backing_plate=True,
    )

    # 2. 中層ポディウム冠部サイン (Z = 29.2m) — 明治通り・広場側(-Y) ＆ 渋谷駅側(-X)
    add_3d_stream_architectural_emblem(
        bm,
        center=Vector((-2.0, -21.05, 29.2)),
        tangent_dir=Vector((1.0, 0.0, 0.0)),
        normal_dir=Vector((0.0, -1.0, 0.0)),
        cap_height=3.2,
        depth=0.42,
        with_backing_plate=True,
    )
    add_3d_stream_architectural_emblem(
        bm,
        center=Vector((-26.45, -1.0, 29.2)),
        tangent_dir=Vector((0.0, -1.0, 0.0)),
        normal_dir=Vector((-1.0, 0.0, 0.0)),
        cap_height=2.8,
        depth=0.42,
        with_backing_plate=True,
    )

    # 3. 低層2Fエントランスデッキ・キャノピーサイン (Z = 10.6m, Y = -27.55m)
    add_3d_stream_architectural_emblem(
        bm,
        center=Vector((-1.5, -27.55, 10.6)),
        tangent_dir=Vector((1.0, 0.0, 0.0)),
        normal_dir=Vector((0.0, -1.0, 0.0)),
        cap_height=2.15,
        depth=0.35,
        with_backing_plate=True,
    )

    # 4. 明治通り沿いアイレベル（ドライバー目線 Z = 2.35m）渋谷ストリーム モニュメントサイン
    monolith_pos = Vector((-6.0, -31.2, 2.2))
    add_box(
        bm,
        center=Vector((monolith_pos.x, monolith_pos.y, 1.9)),
        size=Vector((8.6, 1.1, 3.8)),
        mat_idx=2,
    )
    add_box(
        bm,
        center=Vector((monolith_pos.x, monolith_pos.y, 0.25)),
        size=Vector((9.4, 1.6, 0.5)),
        mat_idx=3,
    )
    # モニュメント上部のライムイエローアクセントバー
    add_box(
        bm,
        center=Vector((monolith_pos.x, monolith_pos.y, 3.88)),
        size=Vector((8.7, 1.18, 0.18)),
        mat_idx=5,
    )
    # モニュメント前面 (-Y) と 背面 (+Y) の立体ストリーム建築エンブレム
    add_3d_stream_architectural_emblem(
        bm,
        center=Vector((monolith_pos.x, monolith_pos.y - 0.62, 2.35)),
        tangent_dir=Vector((1.0, 0.0, 0.0)),
        normal_dir=Vector((0.0, -1.0, 0.0)),
        cap_height=1.55,
        depth=0.24,
        with_backing_plate=True,
    )
    add_3d_stream_architectural_emblem(
        bm,
        center=Vector((monolith_pos.x, monolith_pos.y + 0.62, 2.35)),
        tangent_dir=Vector((-1.0, 0.0, 0.0)),
        normal_dir=Vector((0.0, 1.0, 0.0)),
        cap_height=1.55,
        depth=0.24,
        with_backing_plate=True,
    )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("ShibuyaStream_Signage", mesh)
    assign_materials_to_object(obj, materials)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def generate_shibuya_stream():
    """渋谷ストリーム（Shibuya Stream）3Dモデル全体を生成し GLB としてエクスポートする"""
    clean_scene()
    materials = setup_materials()

    root = bpy.data.objects.new("ShibuyaStreamRoot", None)
    root.empty_display_type = "ARROWS"
    root.empty_display_size = 2.0
    bpy.context.scene.collection.objects.link(root)

    podium = build_low_rise_podium_and_plaza(materials)
    podium.parent = root

    mid_void = build_mid_void_and_hotel_band(materials)
    mid_void.parent = root

    high_rise = build_high_rise_tower(materials)
    high_rise.parent = root

    stream_signage = build_stream_architectural_signage(materials)
    stream_signage.parent = root

    print("High-precision Shibuya Stream modeling complete! Hierarchy:")
    for obj in bpy.data.objects:
        p_name = obj.parent.name if obj.parent else "None"
        print(f"  - {obj.name} (Type: {obj.type}, Parent: {p_name})")

    out_dir = os.path.abspath("apps/web/public/models")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "shibuya_stream.glb")

    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_extras=True,
    )
    print(
        f"Successfully exported Shibuya Stream model to: {out_path} ({os.path.getsize(out_path):,} bytes)"
    )


def render_360_review(review_dir: str):
    """360度マルチアングル（12視点）の検証レンダリング画像を出力する"""
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

    scene.render.resolution_x = 960
    scene.render.resolution_y = 720
    scene.render.image_settings.file_format = "PNG"

    world = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
    scene.world = world
    if world.node_tree is None:
        world.use_nodes = True
    bg = next((n for n in world.node_tree.nodes if n.type == "BACKGROUND"), None)
    if bg:
        bg.inputs["Color"].default_value = (0.36, 0.44, 0.56, 1.0)
        bg.inputs["Strength"].default_value = 1.15

    for idx, (loc, rot, energy) in enumerate(
        [
            ((120.0, -160.0, 220.0), (math.radians(48), 0.0, math.radians(32)), 3.2),
            ((-140.0, 150.0, 180.0), (math.radians(55), 0.0, math.radians(-145)), 1.6),
        ]
    ):
        light_data = bpy.data.lights.new(name=f"ReviewSun_{idx}", type="SUN")
        light_data.energy = energy
        light_obj = bpy.data.objects.new(name=f"ReviewSun_{idx}", object_data=light_data)
        scene.collection.objects.link(light_obj)
        light_obj.location = loc
        light_obj.rotation_euler = rot

    cam_data = bpy.data.cameras.new("ReviewCamera")
    cam_data.lens = 35.0
    cam_data.clip_end = 1500.0
    cam_obj = bpy.data.objects.new("ReviewCamera", cam_data)
    scene.collection.objects.link(cam_obj)
    scene.camera = cam_obj

    views = [
        ("00_front_meijidori", Vector((0.0, -245.0, 92.0)), Vector((0.0, 0.0, 88.0)), 35.0),
        ("01_diag_front_right", Vector((175.0, -185.0, 95.0)), Vector((0.0, 0.0, 88.0)), 35.0),
        ("02_right_ebisu", Vector((245.0, 0.0, 92.0)), Vector((0.0, 0.0, 88.0)), 35.0),
        ("03_diag_back_right", Vector((175.0, 185.0, 95.0)), Vector((0.0, 0.0, 88.0)), 35.0),
        ("04_back_river", Vector((0.0, 245.0, 92.0)), Vector((0.0, 0.0, 88.0)), 35.0),
        ("05_diag_back_left", Vector((-175.0, 185.0, 95.0)), Vector((0.0, 0.0, 88.0)), 35.0),
        ("06_left_station", Vector((-245.0, 0.0, 92.0)), Vector((0.0, 0.0, 88.0)), 35.0),
        ("07_diag_front_left", Vector((-175.0, -185.0, 95.0)), Vector((0.0, 0.0, 88.0)), 35.0),
        ("08_birdseye_crown", Vector((-125.0, -145.0, 235.0)), Vector((0.0, 0.0, 130.0)), 38.0),
        ("09_driver_eye_level", Vector((-6.0, -68.0, 1.8)), Vector((-2.0, -20.0, 16.0)), 28.0),
        (
            "10_closeup_podium_signage",
            Vector((-10.0, -56.0, 14.0)),
            Vector((-2.0, -21.0, 21.0)),
            38.0,
        ),
        (
            "11_closeup_highrise_signage",
            Vector((0.0, -68.0, 148.0)),
            Vector((0.0, -19.5, 152.0)),
            45.0,
        ),
    ]

    for name, cam_pos, target_pos, lens in views:
        cam_data.lens = lens
        cam_obj.location = cam_pos
        direction = target_pos - cam_pos
        cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        out_file = os.path.join(review_dir, f"{name}.png")
        scene.render.filepath = out_file
        bpy.ops.render.render(write_still=True)
        print(f"Rendered review angle: {out_file}")


if __name__ == "__main__":
    import sys

    generate_shibuya_stream()
    if "--render-review" in sys.argv:
        idx = sys.argv.index("--render-review")
        target_dir = sys.argv[idx + 1] if idx + 1 < len(sys.argv) else "/tmp/shibuya_review_r2"
        render_360_review(target_dir)

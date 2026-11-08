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
            base_color=(1.0, 0.90, 0.78, 1.0),
            roughness=0.18,
            metallic=0.10,
            emission_color=(1.0, 0.85, 0.60, 1.0),
            emission_strength=0.05,
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
        # 8: 首都高速3号渋谷線・鉄道高架の重厚プレキャストコンクリート橋脚・遮音壁パネル
        "ShutokoConcretePier": create_material(
            "ShutokoConcretePier",
            base_color=(0.52, 0.55, 0.58, 1.0),
            roughness=0.76,
            metallic=0.08,
        ),
        # 9: 首都高速道路 緑案内標識ボード（[3] 首都高速3号渋谷線 / 渋谷・用賀・東名 / 谷町JCT・都心環状）
        "ShutokoHighwayGreenSign": create_material(
            "ShutokoHighwayGreenSign",
            base_color=(0.04, 0.42, 0.24, 1.0),
            roughness=0.35,
            metallic=0.10,
            emission_color=(0.05, 0.48, 0.28, 1.0),
            emission_strength=0.05,
        ),
        # 10: 渋谷スクランブルスクエア 屋上展望施設「SHIBUYA SKY」スカイエッジ発光ガラス＆ヘリポートライン
        "ShibuyaSkyEdgeGlow": create_material(
            "ShibuyaSkyEdgeGlow",
            base_color=(0.45, 0.82, 1.0, 1.0),
            roughness=0.12,
            metallic=0.25,
            emission_color=(0.38, 0.78, 1.0, 1.0),
            emission_strength=0.25,
        ),
        # 11: 渋谷ヒカリエ 東急シアターオーブ球体劇場＆首都高高架下アンバーナトリウム照明
        "HikarieGoldOrb": create_material(
            "HikarieGoldOrb",
            base_color=(0.92, 0.78, 0.42, 1.0),
            roughness=0.25,
            metallic=0.75,
            emission_color=(0.95, 0.75, 0.35, 1.0),
            emission_strength=0.0,
        ),
        # 12: 渋谷サクラステージ（Shibuya Sakura Stage）「KINETIC GATE（ときめきSTAGE）」チェリーピンク発光ガラス
        "SakuraStagePinkGlow": create_material(
            "SakuraStagePinkGlow",
            base_color=(1.0, 0.56, 0.68, 1.0),
            roughness=0.14,
            metallic=0.22,
            emission_color=(0.96, 0.32, 0.50, 1.0),
            emission_strength=0.25,
        ),
        # 13: SHIBUYA109 シリンダークラウン＆QFRONT 大型ビジョン マゼンタレッド発光アクセント
        "ShibuyaQfront109Accent": create_material(
            "ShibuyaQfront109Accent",
            base_color=(0.96, 0.14, 0.42, 1.0),
            roughness=0.16,
            metallic=0.28,
            emission_color=(1.0, 0.16, 0.45, 1.0),
            emission_strength=0.35,
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


def add_cylindrical_panel_z(
    bm: bmesh.types.BMesh,
    center: Vector,
    r_inner: float,
    r_outer: float,
    height: float,
    start_rad: float,
    end_rad: float,
    segments: int = 20,
    mat_idx: int = 0,
):
    """
    円柱表面に沿った扇形円筒シェル（厚み r_outer - r_inner、角度範囲 start_rad .. end_rad）を bmesh に追加する。
    SHIBUYA109 シリンダー曲面ファサードに完全密着したバッキングプレート・看板ベース生成用。
    """
    hz = height * 0.5
    p_in_bot = []
    p_in_top = []
    p_out_bot = []
    p_out_top = []

    for i in range(segments + 1):
        ratio = i / segments
        ang = start_rad + (end_rad - start_rad) * ratio
        ca = math.cos(ang)
        sa = math.sin(ang)

        c_in = center + Vector((ca * r_inner, sa * r_inner, 0.0))
        c_out = center + Vector((ca * r_outer, sa * r_outer, 0.0))

        p_in_bot.append(bm.verts.new(c_in - Vector((0.0, 0.0, hz))))
        p_in_top.append(bm.verts.new(c_in + Vector((0.0, 0.0, hz))))
        p_out_bot.append(bm.verts.new(c_out - Vector((0.0, 0.0, hz))))
        p_out_top.append(bm.verts.new(c_out + Vector((0.0, 0.0, hz))))

    for i in range(segments):
        ni = i + 1
        # 外周面
        f_out = bm.faces.new([p_out_bot[i], p_out_bot[ni], p_out_top[ni], p_out_top[i]])
        f_out.material_index = mat_idx
        # 内周面
        f_in = bm.faces.new([p_in_bot[ni], p_in_bot[i], p_in_top[i], p_in_top[ni]])
        f_in.material_index = mat_idx
        # 底面
        f_bot = bm.faces.new([p_in_bot[i], p_in_bot[ni], p_out_bot[ni], p_out_bot[i]])
        f_bot.material_index = mat_idx
        # 天面
        f_top = bm.faces.new([p_in_top[ni], p_in_top[i], p_out_top[i], p_out_top[ni]])
        f_top.material_index = mat_idx

    # 左側小口 (i = 0)
    f_left = bm.faces.new([p_in_bot[0], p_out_bot[0], p_out_top[0], p_in_top[0]])
    f_left.material_index = mat_idx
    # 右側小口 (i = segments)
    f_right = bm.faces.new([p_out_bot[-1], p_in_bot[-1], p_in_top[-1], p_out_top[-1]])
    f_right.material_index = mat_idx


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
        "ShutokoConcretePier",  # 8
        "ShutokoHighwayGreenSign",  # 9
        "ShibuyaSkyEdgeGlow",  # 10
        "HikarieGoldOrb",  # 11
        "SakuraStagePinkGlow",  # 12
        "ShibuyaQfront109Accent",  # 13
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


def build_shutoko_route3_viaduct(
    materials: dict[str, bpy.types.Material],
) -> bpy.types.Object:
    """
    首都高速3号渋谷線（Shutoko Route 3 Shibuya Line）高架橋を構築する。
    国道246号（玉川通り・青山通り: worldZ = 95 -> bx = 110.0）の頭上（Z = 11.2m〜16.8m）を
    道玄坂・桜丘側（worldX = -865 -> by = -170）から渋谷駅・明治通り交差部（by = -55）を経て
    金王坂・表参道側（worldX = -575 -> by = +120）まで全長 290m にわたり横断する重厚な都市高速高架橋：
    - 歩道外側（bx = 95.5, 124.5）に建つラーメン門型・T字コンクリート橋脚列（走行車線を一切阻害しない）
    - 高架裏面の主桁スチールボックスガーダー（4連）＋横桁クロスビーム格子
    - コンクリート床版＋曲線・半透明ルーバー遮音壁（Acoustic Sound Barrier Walls）
    - 首都高グリーンの方面案内標識門型ゲート（[3] 首都高速3号渋谷線 / 渋谷・大橋JCT・東名 / 谷町JCT・都心環状）
    - 高架下を照らすアンバーナトリウム道路照明列（ドライバー視点で国道246号高架下の重厚感を演出）
    """
    mesh = bpy.data.meshes.new("ShutokoRoute3_ViaductMesh")
    bm = bmesh.new()

    bx_center = 110.0  # worldZ = 95.0 (国道246号中心)
    by_min = -170.0  # worldX = -865.0
    by_max = 120.0  # worldX = -575.0
    span_len = by_max - by_min
    by_mid = (by_min + by_max) * 0.5
    deck_w = 21.6  # 上下4車線＋路肩幅

    # 1. スチール箱桁（4本並行の重厚な主桁ガーダー: Z = 11.4m..13.2m）
    for gx_offset in [-7.8, -2.6, 2.6, 7.8]:
        add_box(
            bm,
            center=Vector((bx_center + gx_offset, by_mid, 12.3)),
            size=Vector((1.45, span_len, 1.8)),
            mat_idx=2,
        )

    # 高架裏面の横桁（クロスビーム格子: 10m ピッチで頭上の立体感を強調）
    num_cross_beams = 29
    for cb in range(num_cross_beams + 1):
        cy = by_min + cb * (span_len / num_cross_beams)
        add_box(
            bm,
            center=Vector((bx_center, cy, 12.15)),
            size=Vector((deck_w - 1.2, 0.65, 1.35)),
            mat_idx=3,
        )
        # 高架下ナトリウム照明器具（明治通り・国道246号交差部を含む全スパンの桁下に配置）
        if cb % 2 == 0:
            for lx_off in [-4.8, 4.8]:
                add_box(
                    bm,
                    center=Vector((bx_center + lx_off, cy, 11.38)),
                    size=Vector((1.1, 0.55, 0.24)),
                    mat_idx=11,
                )

    # 2. コンクリート高架床版スラブ (Z = 13.2m..14.1m) ＆ アスファルト舗装面
    add_box(
        bm,
        center=Vector((bx_center, by_mid, 13.65)),
        size=Vector((deck_w, span_len, 0.95)),
        mat_idx=8,
    )
    add_box(
        bm,
        center=Vector((bx_center, by_mid, 14.18)),
        size=Vector((deck_w - 1.4, span_len, 0.16)),
        mat_idx=2,
    )
    # 中央分離帯ガードレール＆白破線レーンマーク
    add_box(
        bm,
        center=Vector((bx_center, by_mid, 14.65)),
        size=Vector((0.55, span_len, 0.85)),
        mat_idx=8,
    )

    # 3. 首都高象徴の遮音壁（Acoustic Sound Barrier Walls: 下段コンクリート壁＋中段半透明ポリカ窓＋上段内향き吸音ルーバー）
    for side_sign in [-1.0, 1.0]:
        wall_x = bx_center + side_sign * (deck_w * 0.5 - 0.35)
        # 下段プレキャストコンクリート高欄 (Z = 14.1m..15.3m)
        add_box(
            bm,
            center=Vector((wall_x, by_mid, 14.7)),
            size=Vector((0.55, span_len, 1.2)),
            mat_idx=8,
        )
        # 中段採光アクリルスリット窓 (Z = 15.3m..16.2m)
        add_box(
            bm,
            center=Vector((wall_x, by_mid, 15.75)),
            size=Vector((0.28, span_len, 0.9)),
            mat_idx=1,
        )
        # 上段シルバー遮音ルーバーフード (Z = 16.2m..17.1m)
        add_box(
            bm,
            center=Vector((wall_x - side_sign * 0.22, by_mid, 16.65)),
            size=Vector((0.75, span_len, 0.9)),
            mat_idx=3,
        )
        # 遮音壁の垂直H鋼支柱（8m ピッチ）
        for sp in range(37):
            py = by_min + sp * (span_len / 36.0)
            add_box(
                bm,
                center=Vector((wall_x + side_sign * 0.12, py, 15.55)),
                size=Vector((0.42, 0.38, 3.1)),
                mat_idx=2,
            )

    # 4. 門型ラーメン・T字コンクリート橋脚列（国道246号の車道 bx=98..122 および明治通り車道 by=-67..-43 を完全回避）
    # bx = 95.5 (worldZ = 80.5: 南側歩道外縁) & bx = 124.5 (worldZ = 109.5: 北側歩道外縁)
    pier_by_list = [-135.0, -87.0, -33.0, 23.0, 77.0]
    for p_by in pier_by_list:
        # 水平ハンチ付き大梁（クロスヘッド: Z = 9.8m..11.4m, 桁下クリアランス 9.8m 確保）
        add_box(
            bm,
            center=Vector((bx_center, p_by, 10.65)),
            size=Vector((31.2, 2.8, 1.7)),
            mat_idx=8,
        )
        # 左右の丸みを帯びた角柱コンクリート橋脚（Z = 0m..10.6m）
        for pier_x in [95.5, 124.5]:
            add_box(
                bm,
                center=Vector((pier_x, p_by, 5.3)),
                size=Vector((2.5, 2.6, 10.6)),
                mat_idx=8,
            )
            # 橋脚根元の保護フーチング＆トラストライプ警戒帯
            add_box(
                bm,
                center=Vector((pier_x, p_by, 0.45)),
                size=Vector((2.9, 3.0, 0.9)),
                mat_idx=2,
            )
            add_box(
                bm,
                center=Vector((pier_x, p_by, 1.6)),
                size=Vector((2.58, 2.68, 0.45)),
                mat_idx=5,
            )

    # 5. 首都高速3号渋谷線 オーバーヘッド緑案内標識門型ゲート＆側面ルートサイン
    # 明治通り交差点のすぐ西側（by = -72.0 -> worldX = -767）と東側（by = -36.0 -> worldX = -731）に配置し、
    # 明治通りおよび国道246号のどちらから見上げても「首都高3号渋谷線」と一目で分かる標識を掲出
    for gate_by in [-72.0, -36.0, 15.0]:
        # 門型鉄骨トラスフレーム (Z = 16.8m..21.2m)
        for gx in [bx_center - 10.6, bx_center + 10.6]:
            add_box(
                bm,
                center=Vector((gx, gate_by, 19.0)),
                size=Vector((0.45, 0.45, 4.6)),
                mat_idx=3,
            )
        add_box(
            bm,
            center=Vector((bx_center, gate_by, 20.8)),
            size=Vector((21.8, 0.55, 0.65)),
            mat_idx=3,
        )
        # 首都高グリーン案内標識板（高速上向け＆高架側面向け）
        add_box(
            bm,
            center=Vector((bx_center, gate_by, 19.8)),
            size=Vector((14.5, 0.42, 2.8)),
            mat_idx=9,
        )
        # 白枠トリム＆ルート番号バッジ
        add_box(
            bm,
            center=Vector((bx_center, gate_by, 19.8)),
            size=Vector((14.8, 0.34, 3.05)),
            mat_idx=0,
        )

    # 明治通り走行中のドライバーから正面に見える高架側面「首都高速3号渋谷線 [3] SHIBUYA EXPWY」大型緑看板
    for side_x, n_sign in [
        (bx_center - deck_w * 0.5 - 0.45, -1.0),
        (bx_center + deck_w * 0.5 + 0.45, 1.0),
    ]:
        for sign_by in [-55.0, -18.0]:
            # 白外枠プレート
            add_box(
                bm,
                center=Vector((side_x, sign_by, 15.65)),
                size=Vector((0.28, 13.6, 2.35)),
                mat_idx=0,
            )
            # 首都高グリーン内面プレート
            add_box(
                bm,
                center=Vector((side_x + n_sign * 0.08, sign_by, 15.65)),
                size=Vector((0.24, 13.0, 1.95)),
                mat_idx=9,
            )
            # 白ルートライン＆イエロー出口バッジアクセント
            add_box(
                bm,
                center=Vector((side_x + n_sign * 0.16, sign_by - 4.2, 15.65)),
                size=Vector((0.20, 2.2, 1.35)),
                mat_idx=5,
            )
            add_box(
                bm,
                center=Vector((side_x + n_sign * 0.16, sign_by + 1.4, 15.65)),
                size=Vector((0.20, 7.4, 0.48)),
                mat_idx=0,
            )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("ShutokoRoute3_Viaduct", mesh)
    assign_materials_to_object(obj, materials)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_shibuya_scramble_square_tower(
    materials: dict[str, bpy.types.Material],
) -> bpy.types.Object:
    """
    渋谷スクランブルスクエア 東棟（Shibuya Scramble Square East Tower, 実寸 229.7m / 地上47階）を構築する。
    配置: worldX = -808.0, worldZ = 145.0 -> Blender (bx = 160.0, by = -113.0)
    隈研吾建築都市設計事務所・SANAA・日建設計による渋谷最高峰ランドマークの特徴を忠実に造形：
    - 低層〜中層商業ポディウム（Z = 0m..38m）と中層セットバックテラス
    - 高層カーテンウォール（Z = 38m..214m）の躍動感ある斜め・垂直ホワイトアルミルーバーフィン帯
    - 屋上展望施設「SHIBUYA SKY（渋谷スカイ）」（Z = 214m..229.7m）：
      360度オープンエア展望デッキ、シアンブルーに輝くガラススカイエッジ（SKY EDGE）、
      屋上ヘリポート（グリーン着陸帯＋白「H」マーク）＆四隅の赤色航空障害灯
    """
    mesh = bpy.data.meshes.new("ShibuyaScrambleSquare_TowerMesh")
    bm = bmesh.new()

    cx = 160.0  # worldZ = 145.0
    cy = -113.0  # worldX = -808.0
    w_x = 54.0  # Z方向奥行
    d_y = 52.0  # X方向幅

    # 1. 低層商業ポディウム (1F〜11F, Z = 0m..38m)
    add_box(
        bm,
        center=Vector((cx, cy, 19.0)),
        size=Vector((w_x, d_y, 38.0)),
        mat_idx=2,
    )
    # 低層部の明るいガラスカーテン＆ウォーム商業ショーウィンドウ階層
    for pz in [6.0, 14.0, 22.0, 30.0]:
        add_box(
            bm,
            center=Vector((cx, cy, pz)),
            size=Vector((w_x + 0.35, d_y + 0.35, 4.2)),
            mat_idx=6 if pz <= 14.0 else 1,
        )
        add_box(
            bm,
            center=Vector((cx, cy, pz + 2.4)),
            size=Vector((w_x + 0.65, d_y + 0.65, 0.55)),
            mat_idx=0,
        )

    # 12F イベントスペース「Scene12」中層ボイド＆セットバック帯 (Z = 38m..48m)
    add_box(
        bm,
        center=Vector((cx, cy, 43.0)),
        size=Vector((w_x - 3.0, d_y - 3.0, 10.0)),
        mat_idx=10,
    )
    add_box(
        bm,
        center=Vector((cx, cy, 48.0)),
        size=Vector((w_x + 0.8, d_y + 0.8, 0.9)),
        mat_idx=0,
    )

    # 2. 高層オフィスタワーコア (14F〜45F, Z = 48m..214m)
    tw_x = 47.0
    td_y = 45.0
    z_tower_bot = 48.0
    z_tower_top = 214.0
    tower_h = z_tower_top - z_tower_bot
    add_box(
        bm,
        center=Vector((cx, cy, z_tower_bot + tower_h * 0.5)),
        size=Vector((tw_x, td_y, tower_h)),
        mat_idx=1,
    )

    # スクランブルスクエア固有の多層水平アルミフィン＆ウォームオフィス照明帯（28段）
    num_bands = 28
    band_step = tower_h / num_bands
    for b_idx in range(num_bands + 1):
        bz = z_tower_bot + b_idx * band_step
        add_box(
            bm,
            center=Vector((cx, cy, bz)),
            size=Vector((tw_x + 0.45, td_y + 0.45, 0.38)),
            mat_idx=0,
        )
        if b_idx < num_bands and (b_idx % 3 == 0):
            add_box(
                bm,
                center=Vector((cx, cy, bz + band_step * 0.5)),
                size=Vector((tw_x + 0.12, td_y + 0.12, band_step * 0.44)),
                mat_idx=6,
            )

    # ファサードを斜めに横切るダイナミックな白ルーバーフィン列（スクランブルスクエアの外観シグネチャ）
    num_fins = 16
    for f_idx in range(num_fins):
        ratio = (f_idx + 0.5) / num_fins - 0.5
        # 東面(+Y: 明治通り・ヒカリエ向き) と 西面(-Y: スクランブル交差点向き) の垂直マリオン
        fx = cx + ratio * (tw_x - 2.0)
        for sy in [-1.0, 1.0]:
            add_box(
                bm,
                center=Vector((fx, cy + sy * (td_y * 0.5 + 0.24), z_tower_bot + tower_h * 0.5)),
                size=Vector((0.42, 0.48, tower_h)),
                mat_idx=0 if (f_idx % 2 == 0) else 3,
            )
        # 南面(-X: 国道246号・ストリーム向き) と 北面(+X: 宮下公園向き) の垂直マリオン
        fy = cy + ratio * (td_y - 2.0)
        for sx in [-1.0, 1.0]:
            add_box(
                bm,
                center=Vector((cx + sx * (tw_x * 0.5 + 0.24), fy, z_tower_bot + tower_h * 0.5)),
                size=Vector((0.48, 0.42, tower_h)),
                mat_idx=0 if (f_idx % 2 == 1) else 3,
            )

    # スクランブルスクエア象徴の斜め上昇ホワイトフィン（4面のカーテンウォールを斜めに走る白いライン）
    for diag_pass in range(4):
        z_seg_bot = z_tower_bot + diag_pass * (tower_h / 4.0)
        seg_h = tower_h / 4.0
        for step_i in range(10):
            t_ratio = (step_i + 0.5) / 10.0
            dz = z_seg_bot + t_ratio * seg_h
            dx_pos = cx + (t_ratio - 0.5) * (tw_x - 3.0) * (1.0 if diag_pass % 2 == 0 else -1.0)
            dy_pos = cy + (t_ratio - 0.5) * (td_y - 3.0) * (1.0 if diag_pass % 2 == 0 else -1.0)
            for sy in [-1.0, 1.0]:
                add_box(
                    bm,
                    center=Vector((dx_pos, cy + sy * (td_y * 0.5 + 0.38), dz)),
                    size=Vector((4.8, 0.52, 4.4)),
                    mat_idx=0,
                )
            for sx in [-1.0, 1.0]:
                add_box(
                    bm,
                    center=Vector((cx + sx * (tw_x * 0.5 + 0.38), dy_pos, dz)),
                    size=Vector((0.52, 4.8, 4.4)),
                    mat_idx=0,
                )

    # 3. 屋上展望施設「SHIBUYA SKY（渋谷スカイ）」(46F〜屋上: Z = 214m..229.7m)
    # 展望回廊 SKY GALLERY & スカイエッジ発光ガラス壁 (Z = 214m..223.5m)
    add_box(
        bm,
        center=Vector((cx, cy, 218.8)),
        size=Vector((tw_x - 1.2, td_y - 1.2, 9.6)),
        mat_idx=10,
    )
    # 展望デッキ外周の白い水平クラウンフレーム（上下2本のシャープな白トリム）
    for crown_z in [214.2, 223.6, 228.2]:
        add_box(
            bm,
            center=Vector((cx, cy, crown_z)),
            size=Vector((tw_x + 1.1, td_y + 1.1, 0.75)),
            mat_idx=0,
        )
    # SHIBUYA SKY コーナー展望台「SKY EDGE」（南東・北西角の張り出しガラスデッキ）
    for sx, sy in [(-1.0, 1.0), (-1.0, -1.0), (1.0, 1.0)]:
        add_box(
            bm,
            center=Vector((cx + sx * (tw_x * 0.5 - 2.5), cy + sy * (td_y * 0.5 - 2.5), 225.8)),
            size=Vector((9.5, 9.5, 4.2)),
            mat_idx=10,
        )

    # 屋上オープンエア芝生・ウッドデッキ＆ヘリポート (Z = 223.8m..229.7m)
    add_box(
        bm,
        center=Vector((cx, cy, 226.4)),
        size=Vector((tw_x - 8.0, td_y - 8.0, 5.2)),
        mat_idx=2,
    )
    # 屋上ヘリポート着陸パッド（グリーン標識パッド＋白 H マーク）
    add_box(
        bm,
        center=Vector((cx, cy, 229.25)),
        size=Vector((18.0, 18.0, 0.45)),
        mat_idx=9,
    )
    for hx_off in [-3.2, 3.2]:
        add_box(
            bm,
            center=Vector((cx + hx_off, cy, 229.55)),
            size=Vector((1.4, 9.0, 0.25)),
            mat_idx=0,
        )
    add_box(
        bm,
        center=Vector((cx, cy, 229.55)),
        size=Vector((6.4, 1.4, 0.25)),
        mat_idx=0,
    )

    # 屋上四隅の赤色航空障害灯
    for sx in [-1.0, 1.0]:
        for sy in [-1.0, 1.0]:
            add_cylinder_z(
                bm,
                center=Vector((cx + sx * (tw_x * 0.5 - 1.0), cy + sy * (td_y * 0.5 - 1.0), 230.6)),
                radius=0.55,
                height=2.0,
                segments=12,
                mat_idx=7,
            )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("ShibuyaScrambleSquare_Tower", mesh)
    assign_materials_to_object(obj, materials)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_shibuya_hikarie_tower(
    materials: dict[str, bpy.types.Material],
) -> bpy.types.Object:
    """
    渋谷ヒカリエ（Shibuya Hikarie, 実寸 182.5m / 地上34階）を構築する。
    配置: worldX = -692.0, worldZ = 146.0 -> Blender (bx = 161.0, by = 3.0)
    日建設計・隈研吾氏らによる渋谷駅東口の象徴的複合タワーの特徴を造形：
    - 低層商業「ShinQs」ステップ状ガラスポディウム（1F〜8F, Z = 0m..36m）と2F貫通アーバンコア歩行者デッキ口
    - 中層11F〜16F（Z = 42m..76m）に浮かぶ球体・楕円ドラム型ミュージカル劇場「東急シアターオーブ（Tokyu Theatre Orb）」
      およびガラス張りの11Fスカイロビー（明治通り側へキャンチレバーで張り出す発光アトリウム）
    - 高層オフィスタワー（17F〜34F, Z = 76m..182.5m）の南北ツインガラスコア＆白マリオンフレーム
    """
    mesh = bpy.data.meshes.new("ShibuyaHikarie_TowerMesh")
    bm = bmesh.new()

    cx = 161.0  # worldZ = 146.0
    cy = 3.0  # worldX = -692.0
    w_x = 50.0
    d_y = 48.0

    # 1. 低層商業ポディウム「ShinQs」(Z = 0m..38m)
    add_box(
        bm,
        center=Vector((cx, cy, 19.0)),
        size=Vector((w_x, d_y, 38.0)),
        mat_idx=1,
    )
    for pz in [5.5, 13.5, 21.5, 29.5, 37.5]:
        add_box(
            bm,
            center=Vector((cx, cy, pz)),
            size=Vector((w_x + 0.5, d_y + 0.5, 0.65)),
            mat_idx=0,
        )
        add_box(
            bm,
            center=Vector((cx, cy, pz - 2.6)),
            size=Vector((w_x + 0.15, d_y + 0.15, 2.8)),
            mat_idx=6,
        )
    # 明治通り側 (-Y) の円筒ガラスアーバンコア（エレベーター・エスカレーターシャフト）
    add_cylinder_z(
        bm,
        center=Vector((cx - 14.0, cy - d_y * 0.5 - 1.2, 24.0)),
        radius=5.2,
        height=48.0,
        segments=20,
        mat_idx=10,
    )

    # 2. 中層 11F スカイロビー＆「東急シアターオーブ（Tokyu Theatre Orb）」(Z = 38m..76m)
    # ガラスアトリウムの背面にダークコアを置き、明治通り(-Y)および国道246号(-X)側に
    # ゴールドアンバーの球体・円筒劇場「東急シアターオーブ」が鮮明に浮き出る造形
    add_box(
        bm,
        center=Vector((cx + 2.0, cy + 2.0, 57.0)),
        size=Vector((w_x - 4.0, d_y - 4.0, 35.0)),
        mat_idx=2,
    )
    # 劇場オーブ（ガラスカーテンウォールの外縁までダイナミックに張り出す大口径ゴールドドラム球体）
    add_cylinder_z(
        bm,
        center=Vector((cx - 4.5, cy - 8.5, 57.5)),
        radius=21.5,
        height=27.0,
        segments=32,
        mat_idx=11,
    )
    # オーブ中央のリングバンド（球体感を強調する3段の膨らみ）
    add_cylinder_z(
        bm,
        center=Vector((cx - 4.5, cy - 8.5, 57.5)),
        radius=23.2,
        height=14.0,
        segments=32,
        mat_idx=11,
    )
    # シアターオーブを囲む白構造トラスリング＆11Fスカイロビー発光帯
    for orb_z in [40.0, 48.5, 57.5, 66.5, 74.5]:
        add_box(
            bm,
            center=Vector((cx, cy - 2.5, orb_z)),
            size=Vector((w_x + 4.2, d_y + 5.2, 0.85)),
            mat_idx=0,
        )
    # 11F スカイロビーのキャンチレバー展望ガラスデッキ
    add_box(
        bm,
        center=Vector((cx, cy - d_y * 0.5 - 2.8, 43.5)),
        size=Vector((w_x - 2.0, 2.4, 6.2)),
        mat_idx=6,
    )

    # 3. 高層オフィスタワー（17F〜34F, Z = 76m..182.5m）：分節されたツインガラスボリューム
    z_hi_bot = 76.0
    z_hi_top = 182.5
    hi_h = z_hi_top - z_hi_bot
    tw_x = 44.0
    td_y = 40.0
    add_box(
        bm,
        center=Vector((cx, cy, z_hi_bot + hi_h * 0.5)),
        size=Vector((tw_x, td_y, hi_h)),
        mat_idx=1,
    )
    # 南北分節スリット（ヒカリエ特有の垂直ガラススリット）
    add_box(
        bm,
        center=Vector((cx, cy, z_hi_bot + hi_h * 0.5)),
        size=Vector((4.2, td_y + 0.8, hi_h + 1.0)),
        mat_idx=10,
    )
    for fl in range(20):
        fz = z_hi_bot + fl * (hi_h / 20.0)
        add_box(
            bm,
            center=Vector((cx, cy, fz)),
            size=Vector((tw_x + 0.45, td_y + 0.45, 0.36)),
            mat_idx=0,
        )
        if fl % 3 == 1:
            add_box(
                bm,
                center=Vector((cx, cy, fz + 2.4)),
                size=Vector((tw_x + 0.12, td_y + 0.12, 2.0)),
                mat_idx=6,
            )

    # 屋上冠部フレーム＆航空障害灯
    add_box(
        bm,
        center=Vector((cx, cy, z_hi_top - 2.5)),
        size=Vector((tw_x + 0.9, td_y + 0.9, 1.2)),
        mat_idx=0,
    )
    for sx in [-1.0, 1.0]:
        for sy in [-1.0, 1.0]:
            add_cylinder_z(
                bm,
                center=Vector(
                    (cx + sx * (tw_x * 0.5 - 1.0), cy + sy * (td_y * 0.5 - 1.0), z_hi_top + 0.9)
                ),
                radius=0.5,
                height=1.8,
                segments=12,
                mat_idx=7,
            )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("ShibuyaHikarie_Tower", mesh)
    assign_materials_to_object(obj, materials)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_shibuya_pedestrian_deck_and_rail_overpass(
    materials: dict[str, bpy.types.Material],
) -> bpy.types.Object:
    """
    渋谷駅東口歩道橋（ペデストリアンデッキ網）および JR山手線・埼京線・東京メトロ銀座線高架橋を構築する：
    1. 渋谷駅東口歩道橋（Shibuya Station East Exit Pedestrian Deck, Z = 7.4m〜9.2m）：
       - 渋谷ストリーム2Fデッキ（bx = 21, by = -27）から北へ延び、
         明治通り（by = -55）および国道246号（bx = 110）の上空をロの字に跨いで
         渋谷スクランブルスクエア（bx = 160, by = -113）・渋谷ヒカリエ（bx = 161, by = 3）・
         渋谷サクラステージ（bx = -10, by = -117）を立体接続するガラス手すり＆白ルーフキャノピー付き歩道橋。
       - 渋谷ストリーム前の明治通り（bx = -20..+65）ではドライバーの視界を上空へ大きく開け、
         交差点手前（bx = 86.0）で渋谷駅東口歩道橋と首都高3号渋谷線高架橋がドラマチックに重なる構図を実現。
    2. JR山手線・埼京線高架橋（worldX = -779 -> by = -84.0）：
       - 渋谷ストリーム・明治通りの西側を南北に貫く鉄道高架橋と、国道246号を跨ぐグリーンスチールトラス鉄道橋。
    3. 東京メトロ銀座線 渋谷駅新駅舎（M字アーチ屋根トレインシェッド: bx = 158, by = -55, Z = 15.2m〜19.8m）：
       - スクランブルスクエアとヒカリエの間、明治通り上空を東西に跨ぐ象徴的な白いアーチ屋根ホーム。
    """
    mesh = bpy.data.meshes.new("ShibuyaEastDeckAndRailMesh")
    bm = bmesh.new()

    deck_z = 7.8  # 桁下クリアランス 7.2m（大型車も余裕で通過可能、ドライバー視界も開放的）

    # 1. 渋谷駅東口歩道橋（明治通り＆国道246号横断ロの字スカイウォーク）
    # (a) 渋谷ストリーム2Fデッキ北端から国道246号南側歩道へ延びる南北デッキ (bx = 22..90, by = -29.5)
    # (b) 明治通りを東西に跨ぐ南側横断歩道橋 (bx = 86.0, by = -82..-26)
    # (c) 国道246号を南北に跨ぐ東側横断歩道橋 (bx = 84..136, by = -29.5) ＆ 西側横断歩道橋 (bx = 84..136, by = -78.5)
    # (d) 明治通りを東西に跨ぐ北側横断歩道橋（スクランブルスクエア〜ヒカリエ連絡デッキ: bx = 134.0, by = -95..0）
    # (e) サクラステージ連絡西口デッキ (bx = 35.0..86.0, by = -78.5)
    deck_segments = [
        # (center_x, center_y, size_x, size_y)
        (54.0, -29.5, 68.0, 5.2),  # ストリーム北連絡デッキ（明治通り東側歩道上空）
        (86.0, -54.0, 5.6, 54.0),  # 明治通り南側横断デッキ（渋谷駅東口歩道橋）
        (110.0, -29.5, 54.0, 5.2),  # 国道246号東側横断デッキ（ヒカリエ・ストリーム連絡）
        (110.0, -78.5, 54.0, 5.2),  # 国道246号西側横断デッキ（スクランブルSQ・サクラステージ連絡）
        (134.0, -48.0, 5.8, 96.0),  # 明治通り北側横断デッキ（スクランブルSQ〜ヒカリエ2F連絡）
        (
            46.0,
            -78.5,
            84.0,
            5.2,
        ),  # サクラステージ・フクラス北西連絡デッキ（明治通り西側歩道上空 bx=4..88）
    ]

    for dx, dy, sx, sy in deck_segments:
        # 歩道橋白い鋼製床版スラブ
        add_box(
            bm,
            center=Vector((dx, dy, deck_z)),
            size=Vector((sx, sy, 0.72)),
            mat_idx=0,
        )
        # 床版下のダークスチール桁
        add_box(
            bm,
            center=Vector((dx, dy, deck_z - 0.50)),
            size=Vector((sx - 0.6, sy - 0.6, 0.36)),
            mat_idx=2,
        )
        # 両側のガラス欄干＋ウォームLEDフットライトライン
        is_ns = sx >= sy
        if is_ns:
            for side in [-1.0, 1.0]:
                ry = dy + side * (sy * 0.5 - 0.15)
                add_box(
                    bm,
                    center=Vector((dx, ry, deck_z + 0.95)),
                    size=Vector((sx, 0.18, 1.2)),
                    mat_idx=10,
                )
                add_box(
                    bm,
                    center=Vector((dx, ry, deck_z + 1.62)),
                    size=Vector((sx, 0.28, 0.16)),
                    mat_idx=0,
                )
            # 歩道橋の白い軽快なルーフキャノピー
            add_box(
                bm,
                center=Vector((dx, dy, deck_z + 3.1)),
                size=Vector((sx - 2.0, sy + 0.6, 0.26)),
                mat_idx=0,
            )
        else:
            for side in [-1.0, 1.0]:
                rx = dx + side * (sx * 0.5 - 0.15)
                add_box(
                    bm,
                    center=Vector((rx, dy, deck_z + 0.95)),
                    size=Vector((0.18, sy, 1.2)),
                    mat_idx=10,
                )
                add_box(
                    bm,
                    center=Vector((rx, dy, deck_z + 1.62)),
                    size=Vector((0.28, sy, 0.16)),
                    mat_idx=0,
                )
            add_box(
                bm,
                center=Vector((dx, dy, deck_z + 3.1)),
                size=Vector((sx + 0.6, sy - 2.0, 0.26)),
                mat_idx=0,
            )

    # 歩道橋の円柱スチール橋脚（すべて歩道上のみ：車道 bx=98..122, by=-67..-43 を完全回避）
    deck_pillars = [
        (86.0, -29.5),
        (86.0, -78.5),
        (134.0, -29.5),
        (134.0, -78.5),
        (24.0, -29.5),
        (24.0, -78.5),
    ]
    for px, py in deck_pillars:
        add_cylinder_z(
            bm,
            center=Vector((px, py, deck_z * 0.5)),
            radius=0.58,
            height=deck_z,
            segments=16,
            mat_idx=3,
        )

    # 2. 東京メトロ銀座線 渋谷駅新駅舎（明治通り上空 Z = 15.2m..19.5m を跨ぐ白いM字アーチ屋根ホーム）
    ginza_x = 158.0  # worldZ = 143.0（スクランブルスクエアとヒカリエの間）
    ginza_y = -55.0  # worldX = -750.0（明治通り真上）
    ginza_span_y = 92.0
    # 銀座線高架床版＆ガラスサイドウォール
    add_box(
        bm,
        center=Vector((ginza_x, ginza_y, 14.8)),
        size=Vector((14.5, ginza_span_y, 1.2)),
        mat_idx=8,
    )
    add_box(
        bm,
        center=Vector((ginza_x, ginza_y, 16.8)),
        size=Vector((13.8, ginza_span_y, 2.8)),
        mat_idx=1,
    )
    # 象徴的な白アルミM字ボールト屋根＆屋上緑化プラザ
    add_box(
        bm,
        center=Vector((ginza_x, ginza_y, 18.6)),
        size=Vector((15.2, ginza_span_y + 2.0, 0.85)),
        mat_idx=0,
    )
    for arch_idx in range(15):
        ay = ginza_y - ginza_span_y * 0.5 + (arch_idx + 0.5) * (ginza_span_y / 15.0)
        add_box(
            bm,
            center=Vector((ginza_x, ay, 17.2)),
            size=Vector((15.4, 0.55, 3.6)),
            mat_idx=0,
        )

    # 3. JR山手線・埼京線 渋谷駅高架橋＆国道246号ガード橋（worldX = -779 -> by = -84.0, Z = 8.4m..12.8m）
    jr_by = -84.0
    jr_bx_min = -120.0
    jr_bx_max = 185.0
    jr_len = jr_bx_max - jr_bx_min
    jr_bx_mid = (jr_bx_min + jr_bx_max) * 0.5
    # 鉄道高架バラスト軌道床版 (Z = 8.4m..9.8m: 国道246号の大型車も余裕でくぐれる桁下高 7.8m)
    add_box(
        bm,
        center=Vector((jr_bx_mid, jr_by, 9.1)),
        size=Vector((jr_len, 13.5, 1.4)),
        mat_idx=8,
    )
    # 国道246号（bx = 85..135）および稲荷橋通り（bx = -80）を跨ぐJRグリーンスチールプレートガーダー＆ワーレントラス橋
    for bridge_bx, bridge_span in [(110.0, 52.0), (-80.0, 28.0)]:
        for side_y in [-6.4, 6.4]:
            add_box(
                bm,
                center=Vector((bridge_bx, jr_by + side_y, 11.2)),
                size=Vector((bridge_span, 0.75, 3.8)),
                mat_idx=9,
            )
            # トラス斜材ポスト
            num_posts = 8
            for p_i in range(num_posts + 1):
                px = bridge_bx - bridge_span * 0.5 + p_i * (bridge_span / num_posts)
                add_box(
                    bm,
                    center=Vector((px, jr_by + side_y, 11.2)),
                    size=Vector((0.55, 0.9, 4.0)),
                    mat_idx=0,
                )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("ShibuyaEastPedestrianDeck", mesh)
    assign_materials_to_object(obj, materials)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_shibuya_sakura_stage_tower(
    materials: dict[str, bpy.types.Material],
) -> bpy.types.Object:
    """
    渋谷サクラステージ（Shibuya Sakura Stage / SHIBUYAタワー, 実寸 179.9m / 地上39階）
    Three.js ワールド座標 (x=-812.0, z=-25.0) -> Blender 座標 (bx=-10.0, by=-117.0):
    1. 低層商業ポディウム（1F〜5F, Z=0.0m〜32.0m）:
       - 東側（明治通り・JR渋谷駅新南改札側 `by = -92.0`）の象徴的なチェリーピンク発光アトリウム「KINETIC GATE（ときめきSTAGE）」
       - 1F〜4F へと連鎖する段状ランドスケープテラス「にぎわいSTAGE」＆植栽グリーンプランター
       - 2F/3F 北東側で `ShibuyaEastPedestrianDeck`（西口・国道246号横断歩道橋）と直結する歩行者デッキ広場
    2. 中高層 SHIBUYAタワー（6F〜37F, Z=32.0m〜169.5m）:
       - 52.0m × 44.0m の高透過 Low-E ブルーグレーガラスカーテンウォール
       - サクラステージ特有の水平ホワイトアルミスパンドレルフィン＆コーナーのチェリーピンク垂直アクセントマリオン
       - 17F スカイロビー＆コワーキング「38F/17F ボイド緑化テラス」の水平セットバック
    3. 屋上メカニカルクラウン＆ヘリポート（38F〜R, Z=169.5m〜179.9m）:
       - ホワイトアルミルーバー冠部、四隅の航空障害灯レッドビーコン
    """
    mesh = bpy.data.meshes.new("ShibuyaSakuraStageMesh")
    bm = bmesh.new()

    cx = -10.0  # worldZ = -25.0 (南端 bx=-38 -> worldZ=-53, 北端 bx=+18 -> worldZ=+3)
    cy = -117.0  # worldX = -812.0 (西端 by=-142 -> worldX=-837, 東端 by=-92 -> worldX=-787: JR線路 by=-84 をクリア)
    w_x = 56.0
    d_y = 50.0

    # 1. 低層商業ポディウム（1F〜5F, Z = 0.0m .. 32.0m）
    add_box(
        bm,
        center=Vector((cx, cy, 16.0)),
        size=Vector((w_x, d_y, 32.0)),
        mat_idx=2,
    )
    # 1F〜2F 路面ショーウィンドウ＆ウォームロビー発光ガラス
    add_box(
        bm,
        center=Vector((cx, cy, 4.8)),
        size=Vector((w_x + 0.35, d_y + 0.35, 8.2)),
        mat_idx=6,
    )

    # 段状ランドスケープテラス「にぎわいSTAGE」（東側・北東側に向かって階段状にせり出す4層の緑化デッキ）
    for step_idx in range(4):
        step_z = 8.2 + step_idx * 5.8
        terrace_ext_y = 4.2 - step_idx * 0.75
        terrace_y = cy + d_y * 0.5 + terrace_ext_y * 0.5
        # 白アルミデッキスラブ
        add_box(
            bm,
            center=Vector((cx + 2.0, terrace_y, step_z)),
            size=Vector((w_x - step_idx * 3.2, terrace_ext_y + 1.4, 1.15)),
            mat_idx=0,
        )
        # 植栽グリーンプランター帯
        add_box(
            bm,
            center=Vector((cx + 2.0, terrace_y + terrace_ext_y * 0.28, step_z + 0.92)),
            size=Vector((w_x - step_idx * 3.6 - 1.5, 1.35, 0.85)),
            mat_idx=4,
        )
        # ガラス手すり＆ウォーム間接照明
        add_box(
            bm,
            center=Vector((cx + 2.0, terrace_y + terrace_ext_y * 0.45, step_z + 1.15)),
            size=Vector((w_x - step_idx * 3.6, 0.22, 1.1)),
            mat_idx=6,
        )

    # 東面・北東角の象徴的な「KINETIC GATE（ときめきSTAGE）」チェリーピンク発光ガラスアトリウム
    gate_cx = cx + 12.5
    gate_cy = cy + d_y * 0.5 + 1.8
    # アトリウム背面のブルーグレーガラスコア
    add_box(
        bm,
        center=Vector((gate_cx, gate_cy - 0.35, 17.5)),
        size=Vector((22.4, 4.6, 25.0)),
        mat_idx=1,
    )
    # KINETIC GATE の3層ガラスステージボックス（チェリーピンク発光＋ウォームアトリウム交互配置）
    for k_tier in range(4):
        kz = 8.2 + k_tier * 6.0
        add_box(
            bm,
            center=Vector((gate_cx, gate_cy + 0.15, kz)),
            size=Vector((21.6, 4.8, 4.6)),
            mat_idx=12 if (k_tier % 2 == 0) else 6,
        )
        # 各ステージ間の水平ホワイトアルミデッキバンド
        add_box(
            bm,
            center=Vector((gate_cx, gate_cy + 0.45, kz - 2.55)),
            size=Vector((22.8, 5.4, 0.72)),
            mat_idx=0,
        )
    # KINETIC GATE を囲む白い立体フレームと桜色デジタルルーバー列
    for g_rib in range(8):
        gx = gate_cx - 10.5 + g_rib * 3.0
        add_box(
            bm,
            center=Vector((gx, gate_cy + 2.55, 17.5)),
            size=Vector((0.46, 0.72, 25.4)),
            mat_idx=0 if (g_rib % 2 == 0) else 12,
        )
    # 2F 歩行者デッキ連絡ブリッジ（東側のJR渋谷駅新南改札・西口歩道橋 `by = -78.5` へ接続）
    add_box(
        bm,
        center=Vector((cx + 22.0, -85.5, 7.8)),
        size=Vector((8.5, 14.5, 0.85)),
        mat_idx=0,
    )
    add_box(
        bm,
        center=Vector((cx + 22.0, -85.5, 9.0)),
        size=Vector((8.5, 14.5, 1.2)),
        mat_idx=12,
    )

    # 2. 中高層 SHIBUYAタワー（6F〜37F, Z = 32.0m .. 169.5m）
    tw_x = 46.0
    td_y = 40.0
    tower_base_z = 32.0
    tower_top_z = 169.5
    tower_h = tower_top_z - tower_base_z
    tower_cz = (tower_base_z + tower_top_z) * 0.5

    # タワーコアガラスカーテンウォール
    add_box(
        bm,
        center=Vector((cx, cy - 1.5, tower_cz)),
        size=Vector((tw_x, td_y, tower_h)),
        mat_idx=1,
    )

    # 17F スカイロビー＆緑化ボイドテラス（Z = 78.0m .. 85.5m）
    sky_lobby_z = 81.8
    add_box(
        bm,
        center=Vector((cx, cy - 1.5, sky_lobby_z)),
        size=Vector((tw_x + 1.8, td_y + 1.8, 6.2)),
        mat_idx=6,
    )
    add_box(
        bm,
        center=Vector((cx, cy - 1.5 + td_y * 0.5 + 0.8, sky_lobby_z - 2.2)),
        size=Vector((tw_x + 2.2, 2.2, 1.4)),
        mat_idx=4,
    )

    # 各階水平ホワイトアルミ・スパンドレルフィン＆ウォームオフィス窓バンド
    for z_step in range(18):
        fz = tower_base_z + 4.0 + z_step * 7.4
        add_box(
            bm,
            center=Vector((cx, cy - 1.5, fz)),
            size=Vector((tw_x + 0.65, td_y + 0.65, 0.62)),
            mat_idx=0,
        )
        if z_step % 2 == 0:
            add_box(
                bm,
                center=Vector((cx, cy - 1.5, fz + 2.6)),
                size=Vector((tw_x + 0.28, td_y + 0.28, 1.25)),
                mat_idx=6,
            )

    # 垂直ホワイトアルミマリオン列＋四隅のサクラピンク垂直ライトライン
    for m_idx in range(9):
        ratio = -0.44 + (m_idx / 8.0) * 0.88
        is_corner_accent = m_idx in (0, 8)
        m_mat = 12 if is_corner_accent else 0
        # 東面・西面
        for sy in [-1.0, 1.0]:
            add_box(
                bm,
                center=Vector((cx + ratio * tw_x, cy - 1.5 + sy * (td_y * 0.5 + 0.25), tower_cz)),
                size=Vector((0.52, 0.58, tower_h)),
                mat_idx=m_mat,
            )
        # 北面・南面
        for sx in [-1.0, 1.0]:
            add_box(
                bm,
                center=Vector((cx + sx * (tw_x * 0.5 + 0.25), cy - 1.5 + ratio * td_y, tower_cz)),
                size=Vector((0.58, 0.52, tower_h)),
                mat_idx=m_mat,
            )

    # 3. 屋上メカニカルクラウン＆桜色コーニスライン（Z = 169.5m .. 179.9m）
    add_box(
        bm,
        center=Vector((cx, cy - 1.5, 174.2)),
        size=Vector((tw_x * 0.88, td_y * 0.88, 9.4)),
        mat_idx=3,
    )
    add_box(
        bm,
        center=Vector((cx, cy - 1.5, 170.2)),
        size=Vector((tw_x + 0.9, td_y + 0.9, 1.4)),
        mat_idx=12,
    )
    add_box(
        bm,
        center=Vector((cx, cy - 1.5, 179.2)),
        size=Vector((tw_x * 0.92, td_y * 0.92, 1.2)),
        mat_idx=0,
    )

    # 四隅の航空障害灯レッドビーコン
    for sx in [-1.0, 1.0]:
        for sy in [-1.0, 1.0]:
            add_cylinder_z(
                bm,
                center=Vector((cx + sx * (tw_x * 0.43), cy - 1.5 + sy * (td_y * 0.43), 180.3)),
                radius=0.52,
                height=1.1,
                segments=12,
                mat_idx=7,
            )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("ShibuyaSakuraStage_Tower", mesh)
    assign_materials_to_object(obj, materials)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_shibuya_fukuras_tower(
    materials: dict[str, bpy.types.Material],
) -> bpy.types.Object:
    """
    渋谷フクラス / 東急プラザ渋谷（Shibuya Fukuras / Tokyu Plaza Shibuya, 実寸 103.3m / 地上18階）
    Three.js ワールド座標 (x=-815.0, z=46.0) -> Blender 座標 (bx=61.0, by=-120.0):
    1. 1F バスターミナル・ピロティ＆エントランスロビー（Z=0.0m〜7.2m）
    2. 東急プラザ渋谷（2F〜8F, Z=7.2m〜34.5m）:
       - 手塚建築研究所・日建設計による「折り紙・結晶体」モチーフの多面体プリーツ・ホワイトアルミルーバー基壇
       - 角度を交互に振ったV字プリーツスクリーンと内部の暖色商業アトリウム光・2F歩道橋連絡口
    3. 17F 屋上庭園「SHIBUYA NIWA（シブヤニワ）」＆中層セットバックテラス（Z=34.5m〜38.5m, Z=88.0m〜92.5m）:
       - 緑豊かなルーフトップガーデン植栽とオープンエアのカフェテラス発光
    4. 高層オフィスタワー（9F〜18F, Z=36.0m〜103.3m）:
       - 端正なブルーグレー反射ガラスカーテンウォール＋繊細なホワイトアルミ水平・垂直マリオン格子
    """
    mesh = bpy.data.meshes.new("ShibuyaFukurasMesh")
    bm = bmesh.new()

    cx = 61.0  # worldZ = 46.0 (南端 bx=38 -> worldZ=23, 北端 bx=84 -> worldZ=69: 国道246号 bx=96 をクリア)
    cy = -120.0  # worldX = -815.0 (西端 by=-143 -> worldX=-838, 東端 by=-97 -> worldX=-792: JR線 by=-84 をクリア)
    w_x = 46.0
    d_y = 46.0

    # 1. 1F バスターミナル・ピロティ＆商業エントランス（Z = 0.0m .. 7.5m）
    add_box(
        bm,
        center=Vector((cx, cy, 3.75)),
        size=Vector((w_x - 2.0, d_y - 2.0, 7.5)),
        mat_idx=2,
    )
    add_box(
        bm,
        center=Vector((cx, cy + 2.0, 3.8)),
        size=Vector((w_x - 3.2, d_y - 3.2, 6.2)),
        mat_idx=6,
    )
    # 1F バスターミナル外周のピロティ列柱
    for px_i in range(5):
        px = cx - (w_x * 0.42) + px_i * (w_x * 0.21)
        for py_side in [-1.0, 1.0]:
            add_cylinder_z(
                bm,
                center=Vector((px, cy + py_side * (d_y * 0.45), 3.75)),
                radius=0.62,
                height=7.5,
                segments=14,
                mat_idx=3,
            )

    # 2F 東口・西口歩行者デッキと直結するエントランスブリッジ（東側 `by = -78.5` の西側連絡デッキへ接続）
    add_box(
        bm,
        center=Vector((cx + 12.0, -88.0, 7.8)),
        size=Vector((7.5, 19.0, 0.82)),
        mat_idx=0,
    )
    add_box(
        bm,
        center=Vector((cx + 12.0, -88.0, 8.95)),
        size=Vector((7.5, 19.0, 1.15)),
        mat_idx=10,
    )

    # 2. 東急プラザ渋谷（2F〜8F, Z = 7.5m .. 34.5m）: 象徴的な折り紙プリーツ・ホワイトアルミルーバー基壇
    # 内部の商業ガラスコア（ブルーグレー反射ガラス＋ウォームアトリウム）
    add_box(
        bm,
        center=Vector((cx, cy, 21.0)),
        size=Vector((w_x - 0.8, d_y - 0.8, 27.0)),
        mat_idx=1,
    )
    for wf_i in range(5):
        wz = 10.2 + wf_i * 5.2
        add_box(
            bm,
            center=Vector((cx, cy, wz)),
            size=Vector((w_x - 0.2, d_y - 0.2, 2.2)),
            mat_idx=6,
        )

    # 多面体折り紙プリーツ水平シェルフ＆斜めファセットルーバー（手塚建築研究所の折り紙外装）
    for p_band in range(6):
        bz = 8.8 + p_band * 4.5
        sign = 1.0 if (p_band % 2 == 0) else -1.0
        # 水平プリーツキャノピーフィン
        add_box(
            bm,
            center=Vector((cx, cy, bz)),
            size=Vector((w_x + 1.8, d_y + 1.8, 0.68)),
            mat_idx=0,
        )
        # 4面に走る斜め折り紙プリーツルーバー列
        for l_idx in range(11):
            ratio = -0.44 + (l_idx / 10.0) * 0.88
            tilt = 0.26 * sign * (1.0 if (l_idx % 2 == 0) else -1.0)
            # 東面・西面
            for sy in [-1.0, 1.0]:
                add_oriented_box(
                    bm,
                    center=Vector(
                        (
                            cx + ratio * w_x,
                            cy + sy * (d_y * 0.5 + 0.55),
                            bz + 2.25,
                        )
                    ),
                    tangent_dir=Vector((tilt, 0.0, 1.0)).normalized(),
                    normal_dir=Vector((0.0, sy, 0.0)),
                    size_tangent=4.5,
                    size_normal=1.15,
                    size_z=0.52,
                    mat_idx=0,
                )
            # 北面・南面
            for sx in [-1.0, 1.0]:
                add_oriented_box(
                    bm,
                    center=Vector(
                        (
                            cx + sx * (w_x * 0.5 + 0.55),
                            cy + ratio * d_y,
                            bz + 2.25,
                        )
                    ),
                    tangent_dir=Vector((0.0, tilt, 1.0)).normalized(),
                    normal_dir=Vector((sx, 0.0, 0.0)),
                    size_tangent=4.5,
                    size_normal=1.15,
                    size_z=0.52,
                    mat_idx=0,
                )

    # 8F テラス緑化帯（Z = 34.5m .. 36.2m）
    add_box(
        bm,
        center=Vector((cx, cy, 35.1)),
        size=Vector((w_x + 1.4, d_y + 1.4, 1.2)),
        mat_idx=0,
    )
    add_box(
        bm,
        center=Vector((cx + 2.5, cy + 2.5, 36.0)),
        size=Vector((w_x - 3.0, d_y - 3.0, 1.2)),
        mat_idx=4,
    )

    # 3. 高層オフィスタワー（9F〜16F, Z = 36.0m .. 88.5m）
    tw_x = 39.0
    td_y = 39.0
    tower_cz = (36.0 + 88.5) * 0.5
    tower_h = 88.5 - 36.0
    add_box(
        bm,
        center=Vector((cx - 1.5, cy - 1.5, tower_cz)),
        size=Vector((tw_x, td_y, tower_h)),
        mat_idx=1,
    )
    for f_i in range(10):
        fz = 38.5 + f_i * 5.0
        add_box(
            bm,
            center=Vector((cx - 1.5, cy - 1.5, fz)),
            size=Vector((tw_x + 0.55, td_y + 0.55, 0.52)),
            mat_idx=0,
        )
        if f_i % 2 == 1:
            add_box(
                bm,
                center=Vector((cx - 1.5, cy - 1.5, fz + 2.2)),
                size=Vector((tw_x + 0.25, td_y + 0.25, 1.15)),
                mat_idx=6,
            )
    # 垂直ホワイトアルミマリオン
    for m_i in range(7):
        ratio = -0.42 + (m_i / 6.0) * 0.84
        for sy in [-1.0, 1.0]:
            add_box(
                bm,
                center=Vector(
                    (cx - 1.5 + ratio * tw_x, cy - 1.5 + sy * (td_y * 0.5 + 0.2), tower_cz)
                ),
                size=Vector((0.42, 0.45, tower_h)),
                mat_idx=0,
            )

    # 4. 17F〜18F 屋上庭園「SHIBUYA NIWA（シブヤニワ）」＆ルーフトップ展望ラウンジ（Z = 88.5m .. 103.3m）
    add_box(
        bm,
        center=Vector((cx - 1.5, cy - 1.5, 89.2)),
        size=Vector((tw_x + 1.4, td_y + 1.4, 1.4)),
        mat_idx=0,
    )
    add_box(
        bm,
        center=Vector((cx + 2.5, cy + 2.5, 90.4)),
        size=Vector((tw_x - 4.0, td_y - 4.0, 1.5)),
        mat_idx=4,
    )
    # 屋上庭園を囲むクリアガラス欄干とウォームラウンジ「CÉ LA VI TOKYO」
    add_box(
        bm,
        center=Vector((cx - 4.5, cy - 4.5, 95.2)),
        size=Vector((tw_x * 0.76, td_y * 0.76, 10.2)),
        mat_idx=1,
    )
    add_box(
        bm,
        center=Vector((cx - 4.5, cy - 4.5, 93.2)),
        size=Vector((tw_x * 0.78, td_y * 0.78, 3.2)),
        mat_idx=6,
    )
    add_box(
        bm,
        center=Vector((cx - 4.5, cy - 4.5, 101.5)),
        size=Vector((tw_x * 0.80, td_y * 0.80, 3.6)),
        mat_idx=0,
    )

    # 航空障害灯レッドビーコン
    for sx in [-1.0, 1.0]:
        for sy in [-1.0, 1.0]:
            add_cylinder_z(
                bm,
                center=Vector((cx - 4.5 + sx * 13.5, cy - 4.5 + sy * 13.5, 103.8)),
                radius=0.45,
                height=1.0,
                segments=12,
                mat_idx=7,
            )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("ShibuyaFukuras_Tower", mesh)
    assign_materials_to_object(obj, materials)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_shibuya_miyashita_park_complex(
    materials: dict[str, bpy.types.Material],
) -> bpy.types.Object:
    """
    MIYASHITA PARK / sequence MIYASHITA PARK（宮下公園・レイヤードミヤシタパーク, 実寸 71.8m / 地上18階）
    Three.js ワールド座標 (x=-695.0, z=248.0) -> Blender 座標 (bx=263.0, by=0.0):
    1. 低層商業施設「RAYARD MIYASHITA PARK」（1F〜3F, Z=0.0m〜16.5m, 全長 70.0m × 幅 42.0m）:
       - 1F「渋谷横丁（Shibuya Yokocho）」の暖色提灯・ネオン飲食街アーケード（西面＝明治通り沿い `by = -21.0`）
       - 2F/3F オープンエア商業回廊（キャンチレバーデッキ・ガラス手すり・階段）
    2. 4F 屋上立体都市公園「渋谷区立宮下公園」（Z=16.5m〜25.2m）:
       - 全面に広がる屋上芝生広場・植栽ツリー・スケート場＆ボルダリングウォール
       - 宮下公園の最も象徴的な「ボタニカル・パラボラアーチ鉄骨フレーム（10連の白/亜鉛めっきアーチキャノピー）」
       - 屋上中央のガラスパビリオンカフェ（Starbucks Coffee MIYASHITA PARK 店モチーフ）
    3. 北端のホテルタワー「sequence MIYASHITA PARK」（4F〜18F, Z=16.5m〜71.8m）:
       - 北側（`bx = 284.7`）にそびえるダークグレー＆ブルーグレーガラスの18階建てライフスタイルホテル棟
    """
    mesh = bpy.data.meshes.new("ShibuyaMiyashitaParkMesh")
    bm = bmesh.new()

    cx = 263.0  # worldZ = 248.0 (南端 bx=228 -> worldZ=213: 宮下美竹通り worldZ=195 を完全クリア)
    cy = 0.0  # worldX = -695.0 (西端 by=-21 -> worldX=-716: 明治通り東歩道外縁をクリア)
    w_x = 70.0
    d_y = 42.0
    park_deck_z = 16.5

    # 1. 1F〜3F 商業施設「RAYARD MIYASHITA PARK」基壇
    add_box(
        bm,
        center=Vector((cx, cy, park_deck_z * 0.5)),
        size=Vector((w_x, d_y, park_deck_z)),
        mat_idx=2,
    )
    # 1F「渋谷横丁」暖色飲食街アーケード（明治通り側 `by = -21.0` に連なる賑わい発光帯）
    add_box(
        bm,
        center=Vector((cx - 4.0, cy - d_y * 0.5 - 0.25, 3.6)),
        size=Vector((w_x - 6.0, 1.2, 5.2)),
        mat_idx=6,
    )
    # 渋谷横丁の赤・アンバー提灯ランタン列
    for yoko_i in range(14):
        yx = cx - w_x * 0.44 + yoko_i * (w_x * 0.88 / 13.0)
        add_box(
            bm,
            center=Vector((yx, cy - d_y * 0.5 - 0.95, 5.4)),
            size=Vector((1.8, 0.55, 0.95)),
            mat_idx=11 if (yoko_i % 2 == 0) else 13,
        )

    # 2F・3F オープンエア商業デッキスラブ＆緑化プランター
    for floor_z in [6.2, 11.4, 16.5]:
        add_box(
            bm,
            center=Vector((cx, cy, floor_z)),
            size=Vector((w_x + 1.8, d_y + 1.8, 0.95)),
            mat_idx=0,
        )
        add_box(
            bm,
            center=Vector((cx, cy - d_y * 0.5 - 0.65, floor_z + 1.05)),
            size=Vector((w_x + 1.4, 0.24, 1.15)),
            mat_idx=6,
        )

    # 2. 4F 屋上芝生公園「宮下公園」(Z = 16.5m .. 25.2m)
    add_box(
        bm,
        center=Vector((cx - 8.0, cy, park_deck_z + 0.75)),
        size=Vector((w_x - 14.0, d_y - 2.0, 1.1)),
        mat_idx=4,
    )
    # 屋上中央のガラスパビリオンカフェ
    add_box(
        bm,
        center=Vector((cx - 12.0, cy - 2.0, park_deck_z + 2.8)),
        size=Vector((14.0, 10.5, 4.2)),
        mat_idx=6,
    )
    add_box(
        bm,
        center=Vector((cx - 12.0, cy - 2.0, park_deck_z + 5.1)),
        size=Vector((15.6, 12.0, 0.55)),
        mat_idx=0,
    )

    # 象徴的な「ボタニカル・パラボラアーチ鉄骨フレーム列」（屋上公園を跨ぐ10連の白/シルバーアーチキャノピー）
    for arch_i in range(10):
        ax = (cx - w_x * 0.45) + arch_i * (w_x * 0.70 / 9.0)
        # 左右のアーチ垂直脚柱: y = ±19.5m, Z = 16.5m .. 21.5m (高さ 5.0m)
        for side_y in [-1.0, 1.0]:
            ay = cy + side_y * 19.5
            add_box(
                bm,
                center=Vector((ax, ay, park_deck_z + 2.5)),
                size=Vector((0.75, 0.85, 5.0)),
                mat_idx=0,
            )
            # 斜めニーブレース（アーチ肩部）: (y=±19.5, z=21.5) から (y=±10.5, z=24.8) を正確に結ぶ
            brace_dy = -side_y * 9.0
            brace_dz = 3.3
            brace_len = math.hypot(brace_dy, brace_dz) + 0.65
            t_vec = Vector((0.0, brace_dy, brace_dz)).normalized()
            n_vec = Vector((1.0, 0.0, 0.0))
            add_oriented_box(
                bm,
                center=Vector((ax, cy + side_y * 15.0, park_deck_z + 6.65)),
                tangent_dir=t_vec,
                normal_dir=n_vec,
                size_tangent=brace_len,
                size_normal=0.72,
                size_z=0.72,
                mat_idx=0,
            )
        # アーチ頂部水平ビーム: y = -10.8 .. +10.8m, Z = 24.8m
        add_box(
            bm,
            center=Vector((ax, cy, park_deck_z + 8.3)),
            size=Vector((0.78, 21.8, 0.78)),
            mat_idx=0,
        )

    # アーチ列を縦断連結するルーバーパーゴラ＆植栽グリーンネット
    for purlin_y in [-13.5, -7.5, 0.0, 7.5, 13.5]:
        pz = (park_deck_z + 8.3) if abs(purlin_y) <= 10.5 else (park_deck_z + 7.2)
        add_box(
            bm,
            center=Vector((cx - 7.0, cy + purlin_y, pz)),
            size=Vector((w_x * 0.72, 0.48, 0.48)),
            mat_idx=3,
        )

    # 3. 北端の18階建てホテルタワー「sequence MIYASHITA PARK」（Z = 16.5m .. 71.8m）
    hotel_cx = cx + w_x * 0.31  # bx = 284.7 (北側)
    hotel_cy = cy + 1.0
    hw_x = 22.0
    hd_y = 34.0
    hotel_base_z = 16.5
    hotel_top_z = 71.8
    hotel_h = hotel_top_z - hotel_base_z
    hotel_cz = (hotel_base_z + hotel_top_z) * 0.5

    add_box(
        bm,
        center=Vector((hotel_cx, hotel_cy, hotel_cz)),
        size=Vector((hw_x, hd_y, hotel_h)),
        mat_idx=1,
    )
    # ホテル外装のダークチャコール＆白アルミ縦ルーバーと客室照明バンド
    for hf_i in range(9):
        hf_z = hotel_base_z + 4.5 + hf_i * 5.8
        add_box(
            bm,
            center=Vector((hotel_cx, hotel_cy, hf_z)),
            size=Vector((hw_x + 0.5, hd_y + 0.5, 0.52)),
            mat_idx=0,
        )
        if hf_i % 2 == 0:
            add_box(
                bm,
                center=Vector((hotel_cx, hotel_cy, hf_z + 2.4)),
                size=Vector((hw_x + 0.25, hd_y + 0.25, 1.15)),
                mat_idx=6,
            )
    # 屋上クラウン＆航空障害灯
    add_box(
        bm,
        center=Vector((hotel_cx, hotel_cy, 70.2)),
        size=Vector((hw_x * 0.86, hd_y * 0.86, 3.2)),
        mat_idx=2,
    )
    for sx in [-1.0, 1.0]:
        for sy in [-1.0, 1.0]:
            add_cylinder_z(
                bm,
                center=Vector((hotel_cx + sx * 8.5, hotel_cy + sy * 13.5, 72.3)),
                radius=0.42,
                height=0.95,
                segments=12,
                mat_idx=7,
            )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("ShibuyaMiyashitaPark_Complex", mesh)
    assign_materials_to_object(obj, materials)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_shibuya_qfront_109_complex(
    materials: dict[str, bpy.types.Material],
) -> bpy.types.Object:
    """
    QFRONT・SHIBUYA109 街区（渋谷スクランブル交差点北西〜道玄坂分岐ランドマーク群, 実寸 78.5m / 地上16階）
    Three.js ワールド座標 (x=-815.0, z=248.0) -> Blender 座標 (bx=263.0, by=-120.0):
    1. QFRONT（キューフロント: 東側＝スクランブル交差点・明治通り側 `bx = 256.0, by = -104.0`, Z=0.0m〜47.5m）:
       - 渋谷スクランブル交差点（南東側）に正対する象徴的な曲面ガラスカーテンウォール
       - 壁面全体を覆う大型湾曲LEDビジョン「Q'S EYE」（シアンブルー＆マゼンタ発光）
       - 2F「SHIBUYA TSUTAYA / Starbucks Coffee」のスクランブル交差点展望リボンウィンドウ（ウォーム発光帯）
    2. SHIBUYA109（シブヤ109: 南西角・道玄坂二股分岐先端 `bx = 247.0, by = -131.5`, Z=0.0m〜78.5m）:
       - 竹山実設計の象徴的な「鏡面シルバーメタリック円筒シリンダータワー」（半径 10.6m, 高さ 78.5m）が南東のハチ公前広場側からも遮られずに聳え立つ配置
       - シリンダー頂部（Z=60.0m〜75.0m）の象徴的なマゼンタレッド発光クラウンバンド＆「109」立体ブロックロゴ
       - 8階建て段状商業ビル本体と屋上テラス・航空障害灯
    """
    mesh = bpy.data.meshes.new("ShibuyaQfront109Mesh")
    bm = bmesh.new()

    cx = 263.0  # worldZ = 248.0 (南端 bx=238 -> worldZ=223: 宮下美竹通り worldZ=195 をクリア)
    cy = (
        -120.0
    )  # worldX = -815.0 (西端 by=-143 -> worldX=-838, 東端 by=-97 -> worldX=-792: 明治通りをクリア)
    w_x = 50.0
    d_y = 46.0

    # 1. 街区共通の低層商業ポディウム（1F〜5F, Z = 0.0m .. 24.0m）
    add_box(
        bm,
        center=Vector((cx + 2.0, cy, 12.0)),
        size=Vector((w_x - 8.0, d_y - 6.0, 24.0)),
        mat_idx=2,
    )
    # 1F〜2F スクランブル交差点・文化村通り路面ショーウィンドウ
    add_box(
        bm,
        center=Vector((cx, cy + 2.0, 5.2)),
        size=Vector((w_x - 6.0, d_y - 4.0, 8.8)),
        mat_idx=6,
    )

    # 2. QFRONT（南東〜東側 `bx = 252.0, by = -104.5`: 明治通り・スクランブル交差点に面する曲面メディアビル）
    qfront_cx = cx - 9.0
    qfront_cy = cy + 12.5
    add_box(
        bm,
        center=Vector((qfront_cx + 4.0, qfront_cy, 23.0)),
        size=Vector((24.0, 18.0, 46.0)),
        mat_idx=1,
    )
    # スクランブル交差点側（南東角 `bx = 244.5, by = -101.5`）の曲面ガラス＆大型湾曲LEDビジョン「Q'S EYE」
    q_corner_x = cx - 16.5
    q_corner_y = cy + 15.5
    add_cylinder_z(
        bm,
        center=Vector((q_corner_x, q_corner_y, 23.75)),
        radius=9.2,
        height=47.5,
        segments=24,
        mat_idx=1,
    )
    # 2F〜3F スターバックス展望ガラスバンド（Z = 5.5m .. 12.5m）
    add_cylinder_z(
        bm,
        center=Vector((q_corner_x, q_corner_y, 9.0)),
        radius=9.48,
        height=6.8,
        segments=24,
        mat_idx=6,
    )
    # 大型湾曲LEDビジョン「Q'S EYE」（Z = 14.5m .. 39.5m: シアンブルー発光＋白/マゼンタフレーム）
    add_cylinder_z(
        bm,
        center=Vector((q_corner_x, q_corner_y, 27.0)),
        radius=9.65,
        height=24.0,
        segments=24,
        mat_idx=10,
    )
    for border_z in [14.6, 27.0, 39.4]:
        add_cylinder_z(
            bm,
            center=Vector((q_corner_x, q_corner_y, border_z)),
            radius=9.82,
            height=1.2,
            segments=24,
            mat_idx=0,
        )
    add_cylinder_z(
        bm,
        center=Vector((q_corner_x, q_corner_y, 27.0)),
        radius=9.76,
        height=3.8,
        segments=24,
        mat_idx=13,
    )

    # 3. SHIBUYA109（南西角〜道玄坂分岐先端 `bx = 247.5, by = -131.0`: 南側のスクランブル交差点からも全景が見える円筒シリンダータワー）
    cyl_cx = cx - 14.5  # bx = 248.5 (南側前面に配置し QFRONT と並んでスクランブル交差点を見下ろす)
    cyl_cy = cy - 11.5  # by = -131.5 (西側・道玄坂分岐角)
    cyl_r = 10.8
    cyl_h = 86.0

    # 109 背後のステップ状商業ビル本体（北西側 `bx = 266.0, by = -126.0`, Z = 0.0m .. 64.0m）
    add_box(
        bm,
        center=Vector((cx + 4.0, cy - 7.5, 32.0)),
        size=Vector((28.0, 24.0, 64.0)),
        mat_idx=0,
    )
    for band_z in range(16, 62, 6):
        add_box(
            bm,
            center=Vector((cx + 4.0, cy - 7.5, float(band_z))),
            size=Vector((28.5, 24.5, 1.5)),
            mat_idx=1,
        )

    # 竹山実設計 SHIBUYA109 象徴のメタリックシルバー円筒シリンダータワー（Z = 0.0m .. 86.0m）
    add_cylinder_z(
        bm,
        center=Vector((cyl_cx, cyl_cy, cyl_h * 0.5)),
        radius=cyl_r,
        height=cyl_h,
        segments=28,
        mat_idx=0,
    )
    # シリンダー外周の水平ステンレス目地リング（Z = 10m .. 62m）
    for ring_z in range(10, 64, 6):
        add_cylinder_z(
            bm,
            center=Vector((cyl_cx, cyl_cy, float(ring_z))),
            radius=cyl_r + 0.22,
            height=0.55,
            segments=28,
            mat_idx=3,
        )
    # 1F エントランス・リボンキャノピー＆ウォームショーウィンドウ
    add_cylinder_z(
        bm,
        center=Vector((cyl_cx, cyl_cy, 4.2)),
        radius=cyl_r + 0.38,
        height=7.2,
        segments=28,
        mat_idx=6,
    )
    add_cylinder_z(
        bm,
        center=Vector((cyl_cx, cyl_cy, 8.2)),
        radius=cyl_r + 1.25,
        height=0.85,
        segments=28,
        mat_idx=13,
    )

    # シリンダー頂部（Z = 65.0m .. 82.0m）のメタリックシルバーパネル＆象徴的なマゼンタレッド発光クラウンバンド
    add_cylinder_z(
        bm,
        center=Vector((cyl_cx, cyl_cy, 73.5)),
        radius=cyl_r + 0.38,
        height=16.5,
        segments=28,
        mat_idx=3,
    )
    for pink_z in [67.8, 79.2]:
        add_cylinder_z(
            bm,
            center=Vector((cyl_cx, cyl_cy, pink_z)),
            radius=cyl_r + 0.62,
            height=1.65,
            segments=28,
            mat_idx=13,
        )
    # シリンダー正面（スクランブル交差点・明治通り向き南東面）の立体マゼンタ「1 0 9」ジオメトリック・エンブレム（Z = 73.5m）
    # 南東（スクランブル交差点・明治通り側 bx=185..210, by=-55）からシリンダー (248.5, -131.5) を見たとき、
    # 法線方向は (-0.54, 0.84, 0.0)、観察者から見た右方向（接線）は (-0.84, -0.54, 0.0)
    logo_dir = Vector((-0.54, 0.84, 0.0)).normalized()
    theta_center = math.atan2(logo_dir.y, logo_dir.x)

    # シリンダー曲面外側に美しく浮き彫りされた白アルミバッキングプレート（Z-fighting・埋没ゼロ）
    add_cylindrical_panel_z(
        bm,
        center=Vector((cyl_cx, cyl_cy, 73.5)),
        r_inner=cyl_r + 0.40,
        r_outer=cyl_r + 0.52,
        height=7.2,
        start_rad=theta_center - 0.48,
        end_rad=theta_center + 0.54,
        segments=28,
        mat_idx=0,
    )

    # 各文字のシリンダー曲面上の配置角度（左から 1, 0, 9）
    cyl_center = Vector((cyl_cx, cyl_cy, 0.0))
    letter_r = cyl_r + 0.58
    letter_depth = 0.36

    # "1" (左側 theta = theta_center - 0.27: 0 との間に 0.556m のクリアランスを確保)
    theta_1 = theta_center - 0.27
    n_1 = Vector((math.cos(theta_1), math.sin(theta_1), 0.0))
    t_1 = Vector((-math.sin(theta_1), math.cos(theta_1), 0.0))
    pos_1 = cyl_center + n_1 * letter_r + Vector((0.0, 0.0, 73.5))
    # 縦ステム
    add_oriented_box(
        bm,
        center=pos_1,
        tangent_dir=t_1,
        normal_dir=n_1,
        size_tangent=1.05,
        size_normal=letter_depth,
        size_z=5.0,
        mat_idx=13,
    )
    # トップセリフ
    add_oriented_box(
        bm,
        center=pos_1 - t_1 * 0.60 + Vector((0.0, 0.0, 1.85)),
        tangent_dir=t_1,
        normal_dir=n_1,
        size_tangent=0.85,
        size_normal=letter_depth,
        size_z=1.10,
        mat_idx=13,
    )

    # "0" (中央 theta = theta_center)
    theta_0 = theta_center
    n_0 = Vector((math.cos(theta_0), math.sin(theta_0), 0.0))
    t_0 = Vector((-math.sin(theta_0), math.cos(theta_0), 0.0))
    pos_0 = cyl_center + n_0 * letter_r + Vector((0.0, 0.0, 73.5))
    add_extruded_arc_ring(
        bm,
        center=pos_0,
        tangent_dir=t_0,
        normal_dir=n_0,
        outer_r=2.10,
        inner_r=1.15,
        depth=letter_depth,
        start_deg=0.0,
        end_deg=360.0,
        segments=28,
        mat_idx=13,
    )

    # "9" (右側 theta = theta_center + 0.33: 0 との間に 0.585m の完全なクリアランスを確保し衝突を完全解消)
    theta_9 = theta_center + 0.33
    n_9 = Vector((math.cos(theta_9), math.sin(theta_9), 0.0))
    t_9 = Vector((-math.sin(theta_9), math.cos(theta_9), 0.0))
    pos_9 = cyl_center + n_9 * letter_r + Vector((0.0, 0.0, 73.5))
    # 上部ループ (全高・プロポーションを0と統一)
    add_extruded_arc_ring(
        bm,
        center=pos_9 + Vector((0.0, 0.0, 1.0)) - t_9 * 0.20,
        tangent_dir=t_9,
        normal_dir=n_9,
        outer_r=1.35,
        inner_r=0.60,
        depth=letter_depth,
        start_deg=0.0,
        end_deg=360.0,
        segments=24,
        mat_idx=13,
    )
    # 右縦ステム (ループ右端 -0.20 + 1.35 = +1.15 と完全同一面で接合)
    add_oriented_box(
        bm,
        center=pos_9 + t_9 * 0.75 - Vector((0.0, 0.0, 0.10)),
        tangent_dir=t_9,
        normal_dir=n_9,
        size_tangent=0.80,
        size_normal=letter_depth,
        size_z=4.6,
        mat_idx=13,
    )
    # 下部ボトムフック (右端 +1.15 から左へ滑らかに弧を描くように接続し、不要な段差や飛び出しフットを完全排除)
    add_oriented_box(
        bm,
        center=pos_9 - t_9 * 0.05 - Vector((0.0, 0.0, 2.0)),
        tangent_dir=t_9,
        normal_dir=n_9,
        size_tangent=2.40,
        size_normal=letter_depth,
        size_z=0.80,
        mat_idx=13,
    )

    # シリンダー最上部のダークスチール冠部＆航空障害灯（Z = 82.2m .. 86.0m）
    add_cylinder_z(
        bm,
        center=Vector((cyl_cx, cyl_cy, 84.1)),
        radius=cyl_r * 0.88,
        height=3.6,
        segments=24,
        mat_idx=2,
    )
    for ang_deg in [0.0, 90.0, 180.0, 270.0]:
        rad = math.radians(ang_deg)
        add_cylinder_z(
            bm,
            center=Vector(
                (
                    cyl_cx + math.cos(rad) * (cyl_r * 0.78),
                    cyl_cy + math.sin(rad) * (cyl_r * 0.78),
                    86.5,
                )
            ),
            radius=0.45,
            height=1.0,
            segments=12,
            mat_idx=7,
        )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("ShibuyaQfront109_Complex", mesh)
    assign_materials_to_object(obj, materials)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def generate_shibuya_stream():
    """渋谷ストリームおよび渋谷駅周辺8大ランドマーク・首都高3号渋谷線高架橋の3Dモデル全体を生成し GLB としてエクスポートする"""
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

    shutoko_viaduct = build_shutoko_route3_viaduct(materials)
    shutoko_viaduct.parent = root

    scramble_square = build_shibuya_scramble_square_tower(materials)
    scramble_square.parent = root

    hikarie = build_shibuya_hikarie_tower(materials)
    hikarie.parent = root

    pedestrian_deck = build_shibuya_pedestrian_deck_and_rail_overpass(materials)
    pedestrian_deck.parent = root

    sakura_stage = build_shibuya_sakura_stage_tower(materials)
    sakura_stage.parent = root

    fukuras = build_shibuya_fukuras_tower(materials)
    fukuras.parent = root

    miyashita_park = build_shibuya_miyashita_park_complex(materials)
    miyashita_park.parent = root

    qfront_109 = build_shibuya_qfront_109_complex(materials)
    qfront_109.parent = root

    print("High-precision Shibuya Station District & Shutoko Viaduct modeling complete! Hierarchy:")
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
        f"Successfully exported Shibuya Stream & Landmarks model to: {out_path} ({os.path.getsize(out_path):,} bytes)"
    )


def render_360_review(review_dir: str):
    """360度マルチアングル（16視点：渋谷ストリーム・首都高3号渋谷線・スクランブルSQ・ヒカリエ・サクラステージ・フクラス・MIYASHITA PARK・QFRONT/109を含む）の検証レンダリング画像を出力する"""
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
    cam_data.clip_end = 2000.0
    cam_obj = bpy.data.objects.new("ReviewCamera", cam_data)
    scene.collection.objects.link(cam_obj)
    scene.camera = cam_obj

    views = [
        ("00_front_meijidori", Vector((0.0, -245.0, 92.0)), Vector((40.0, -30.0, 88.0)), 32.0),
        ("01_diag_front_right", Vector((245.0, -225.0, 105.0)), Vector((65.0, -45.0, 95.0)), 32.0),
        ("02_right_north_246", Vector((350.0, -55.0, 105.0)), Vector((120.0, -55.0, 75.0)), 30.0),
        ("03_diag_back_right", Vector((245.0, 165.0, 105.0)), Vector((65.0, -20.0, 95.0)), 32.0),
        ("04_back_east_hikarie", Vector((45.0, 235.0, 95.0)), Vector((55.0, -30.0, 90.0)), 32.0),
        ("05_diag_back_left", Vector((-165.0, 185.0, 95.0)), Vector((35.0, -25.0, 88.0)), 32.0),
        ("06_left_south_ebisu", Vector((-235.0, -55.0, 92.0)), Vector((55.0, -55.0, 88.0)), 32.0),
        ("07_diag_front_left", Vector((-175.0, -245.0, 95.0)), Vector((45.0, -65.0, 88.0)), 32.0),
        (
            "08_birdseye_district",
            Vector((-160.0, -250.0, 320.0)),
            Vector((110.0, -55.0, 85.0)),
            28.0,
        ),
        (
            "09_driver_eye_meijidori_north",
            Vector((-27.0, -50.0, 1.8)),
            Vector((135.0, -55.0, 38.0)),
            22.0,
        ),
        (
            "10_driver_eye_under_shutoko_246",
            Vector((110.0, -68.0, 2.0)),
            Vector((110.0, 30.0, 13.5)),
            24.0,
        ),
        (
            "11_closeup_scramble_sky_and_hikarie",
            Vector((-35.0, -55.0, 135.0)),
            Vector((160.0, -55.0, 140.0)),
            24.0,
        ),
        (
            "12_driver_eye_sakura_stage_and_fukuras",
            Vector((-35.0, -48.0, 2.2)),
            Vector((35.0, -115.0, 42.0)),
            22.0,
        ),
        (
            "13_driver_eye_miyashita_and_qfront_109",
            Vector((185.0, -55.0, 2.4)),
            Vector((263.0, -60.0, 32.0)),
            22.0,
        ),
        (
            "14_closeup_qfront_and_shibuya109",
            Vector((205.0, -55.0, 36.0)),
            Vector((255.0, -125.0, 58.0)),
            28.0,
        ),
        (
            "15_closeup_miyashita_park_arches",
            Vector((200.0, -65.0, 34.0)),
            Vector((263.0, 0.0, 26.0)),
            26.0,
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
        target_dir = sys.argv[idx + 1] if idx + 1 < len(sys.argv) else "/tmp/shibuya_review_r3"
        render_360_review(target_dir)

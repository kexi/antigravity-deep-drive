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
Blender Procedural Modeling Script: 東京駅丸の内赤レンガ駅舎 (Tokyo Station Marunouchi Building - High Precision)
Tokyo Station Deep Drive 用 3D アセット生成

高精度建築仕様 (Project PLATEAU / 辰野金吾式ルネサンス赤レンガ建築 - 360度全方位レビュー対応版):
- 中央棟 (CentralBuilding): 幅50m (X=-25m〜+25m), 奥行き24m, 高さ22m, 立体ピラスター(付け柱), 正背面の大三角形ペディメント, 皇室貴賓エントランス大庇・車寄せアーチ列柱, 24分割円形大時計, 2段勾配マンサード屋根＆左右角塔タレット
- 北ウィング棟 (NorthWing): 中心X=-84m, 幅122m (X=-23m〜-145m で中央棟・北ドームと隙間なく完全連結), 奥行き20m, 高さ18m, 正背面14スパン×3階建て半円アーチ窓・ピラスター列・2段勾配マンサード天然スレート屋根・正背面ドーマー小窓
- 南ウィング棟 (SouthWing): 中心X=+84m, 幅122m (X=+23m〜+145m で中央棟・南ドームと隙間なく完全連結), 奥行き20m, 高さ18m, 正背面14スパン×3階建て半円アーチ窓・ピラスター列・2段勾配マンサード天然スレート屋根・正背面ドーマー小窓
- 北八角形ドーム (NorthDome): 中心X=-145m, 8角形塔 (半径14.5m, 高さ24m) + 各壁面法線に完全整列した半円アーチ窓・双柱レリーフ・小ペディメント + 12リング高分割ベル型銅板ドーム屋根 + 連続ロフト造形による8本コーナーリブ + 頂部クーポラ小塔
- 南八角形ドーム (SouthDome): 中心X=+145m, 8角形塔 (半径14.5m, 高さ24m) + 各壁面法線に完全整列した半円アーチ窓・双柱レリーフ・小ペディメント + 12リング高分割ベル型銅板ドーム屋根 + 連続ロフト造形による8本コーナーリブ + 頂部クーポラ小塔
- 白御影石トリム (FacadeDetails): 中央棟・南北ウィング・南北八角形ドームの全周をシームレスに巡る辰野式水平白帯装飾ストライプ・重厚な御影石腰壁基壇

階層構造:
StationRoot (Empty)
├── CentralBuilding (メッシュ: 中央棟ファサード・ピラスター・ペディメント・エントランス・丸時計・マンサード屋根)
├── NorthWing (メッシュ: 北ウィング棟・ピラスター・アーチ窓・マンサード屋根・両面ドーマー窓)
├── SouthWing (メッシュ: 南ウィング棟・ピラスター・アーチ窓・マンサード屋根・両面ドーマー窓)
├── NorthDome (メッシュ: 北八角形ドーム塔・法線整列窓＆双柱・酸化銅ドーム屋根・連続リブ・クーポラ)
├── SouthDome (メッシュ: 南八角形ドーム塔・法線整列窓＆双柱・酸化銅ドーム屋根・連続リブ・クーポラ)
└── FacadeDetails (メッシュ: 全棟＋八角ドームを連続周回する白帯ストライプ装飾帯、御影石基壇、コーニス)
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
    """既存のシーン内オブジェクトとマテリアルを全消去して初期化"""
    bpy.ops.wm.read_factory_settings(use_empty=True)


def create_pbr_material(
    name: str,
    base_color=(1.0, 1.0, 1.0, 1.0),
    metallic=0.0,
    roughness=0.5,
    emission_color=(0.0, 0.0, 0.0, 1.0),
    emission_strength=0.0,
) -> bpy.types.Material:
    """Principled BSDF PBRマテリアルを作成"""
    mat = bpy.data.materials.new(name=name)
    nodes = mat.node_tree.nodes
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")

    if "Base Color" in bsdf.inputs:
        bsdf.inputs["Base Color"].default_value = base_color
    if "Metallic" in bsdf.inputs:
        bsdf.inputs["Metallic"].default_value = metallic
    if "Roughness" in bsdf.inputs:
        bsdf.inputs["Roughness"].default_value = roughness
    if "Emission Color" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = emission_color
    if "Emission Strength" in bsdf.inputs:
        bsdf.inputs["Emission Strength"].default_value = emission_strength

    return mat


def setup_materials():
    """東京駅用PBRマテリアル一式を定義"""
    return {
        # 赤レンガ（深みのある化粧煉瓦色）
        "RedBrick": create_pbr_material(
            "RedBrick",
            base_color=(0.70, 0.12, 0.11, 1.0),
            roughness=0.82,
            metallic=0.04,
        ),
        # 白御影石トリム・花崗岩（辰野式白帯装飾）
        "WhiteStone": create_pbr_material(
            "WhiteStone",
            base_color=(0.94, 0.94, 0.95, 1.0),
            roughness=0.58,
            metallic=0.08,
        ),
        # 酸化銅グリーン屋根・ドーム（緑青銅板）
        "CopperRoof": create_pbr_material(
            "CopperRoof",
            base_color=(0.08, 0.48, 0.44, 1.0),
            roughness=0.42,
            metallic=0.45,
        ),
        # ダークスレート瓦屋根（宮城県雄勝産天然スレート瓦）
        "SlateRoof": create_pbr_material(
            "SlateRoof",
            base_color=(0.16, 0.18, 0.22, 1.0),
            roughness=0.72,
            metallic=0.18,
        ),
        # 窓ガラス（昼夜両方で映えるアンバー室内光エミッション付きガラス）
        "WindowGlass": create_pbr_material(
            "WindowGlass",
            base_color=(0.14, 0.18, 0.24, 1.0),
            roughness=0.10,
            metallic=0.85,
            emission_color=(1.0, 0.84, 0.55, 1.0),
            emission_strength=0.45,
        ),
        # ダークブロンズ（庇金具、鉄柵、時計枠、尖塔フィニアル）
        "DarkBronze": create_pbr_material(
            "DarkBronze",
            base_color=(0.14, 0.12, 0.10, 1.0),
            roughness=0.50,
            metallic=0.75,
        ),
        # 大時計文字盤（発光アイボリー）
        "ClockDial": create_pbr_material(
            "ClockDial",
            base_color=(0.98, 0.96, 0.90, 1.0),
            roughness=0.25,
            metallic=0.05,
            emission_color=(1.0, 0.95, 0.82, 1.0),
            emission_strength=1.4,
        ),
    }


def add_box(bm, center: Vector, size: Vector, mat_idx=0, smooth=False):
    """bmesh にワールド軸平行の直方体を追加"""
    half = size * 0.5
    v0 = bm.verts.new(center + Vector((-half.x, -half.y, -half.z)))
    v1 = bm.verts.new(center + Vector((half.x, -half.y, -half.z)))
    v2 = bm.verts.new(center + Vector((half.x, half.y, -half.z)))
    v3 = bm.verts.new(center + Vector((-half.x, half.y, -half.z)))
    v4 = bm.verts.new(center + Vector((-half.x, -half.y, half.z)))
    v5 = bm.verts.new(center + Vector((half.x, -half.y, half.z)))
    v6 = bm.verts.new(center + Vector((half.x, half.y, half.z)))
    v7 = bm.verts.new(center + Vector((-half.x, half.y, half.z)))

    faces = [
        (v0, v1, v2, v3),
        (v4, v7, v6, v5),
        (v0, v4, v5, v1),
        (v2, v6, v7, v3),
        (v0, v3, v7, v4),
        (v1, v5, v6, v2),
    ]
    created = []
    for f_verts in faces:
        f = bm.faces.new(f_verts)
        f.material_index = mat_idx
        f.smooth = smooth
        created.append(f)
    return created


def add_oriented_box(
    bm,
    center: Vector,
    tangent_dir: Vector,
    normal_dir: Vector,
    size_tangent: float,
    size_normal: float,
    size_z: float,
    mat_idx=0,
    smooth=False,
):
    """
    任意の壁面接線方向 (tangent_dir) と外向き法線方向 (normal_dir) に整列した直方体を追加。
    八角形ドーム塔の斜め45度壁面や側面に対しても、豆腐のような飛び出しを起こさず壁面に完全密着させる。
    """
    t = tangent_dir.normalized()
    n = normal_dir.normalized()
    u = Vector((0.0, 0.0, 1.0))

    ht = size_tangent * 0.5
    hn = size_normal * 0.5
    hz = size_z * 0.5

    v0 = bm.verts.new(center - t * ht - n * hn - u * hz)
    v1 = bm.verts.new(center + t * ht - n * hn - u * hz)
    v2 = bm.verts.new(center + t * ht + n * hn - u * hz)
    v3 = bm.verts.new(center - t * ht + n * hn - u * hz)
    v4 = bm.verts.new(center - t * ht - n * hn + u * hz)
    v5 = bm.verts.new(center + t * ht - n * hn + u * hz)
    v6 = bm.verts.new(center + t * ht + n * hn + u * hz)
    v7 = bm.verts.new(center - t * ht + n * hn + u * hz)

    faces = [
        (v0, v1, v2, v3),
        (v4, v7, v6, v5),
        (v0, v4, v5, v1),
        (v2, v6, v7, v3),
        (v0, v3, v7, v4),
        (v1, v5, v6, v2),
    ]
    for f_verts in faces:
        f = bm.faces.new(f_verts)
        f.material_index = mat_idx
        f.smooth = smooth


def add_mansard_roof(
    bm,
    center: Vector,
    base_w: float,
    base_d: float,
    base_z: float,
    mid_w: float,
    mid_d: float,
    mid_h: float,
    top_w: float,
    top_d: float,
    top_h: float,
    slate_mat=2,
    stone_mat=1,
):
    """
    2段勾配のマンサード屋根（下段急勾配スレート屋根＋中間白御影石モールディング＋上段緩勾配屋根）を生成。
    単純な直方体ボックスではなく台形断面でスロープさせることで、ペディメントや角塔と美しく噛み合わせる。
    """
    cx, cy = center.x, center.y
    z0 = base_z
    z1 = base_z + mid_h
    z2 = base_z + mid_h + top_h

    def make_rect_ring(w_val: float, d_val: float, z_val: float):
        hw, hd = w_val * 0.5, d_val * 0.5
        return [
            bm.verts.new(Vector((cx - hw, cy - hd, z_val))),
            bm.verts.new(Vector((cx + hw, cy - hd, z_val))),
            bm.verts.new(Vector((cx + hw, cy + hd, z_val))),
            bm.verts.new(Vector((cx - hw, cy + hd, z_val))),
        ]

    r0 = make_rect_ring(base_w, base_d, z0)
    r1 = make_rect_ring(mid_w, mid_d, z1)
    r2 = make_rect_ring(top_w, top_d, z2)

    for i in range(4):
        ni = (i + 1) % 4
        f_low = bm.faces.new([r0[i], r0[ni], r1[ni], r1[i]])
        f_low.material_index = slate_mat
        f_high = bm.faces.new([r1[i], r1[ni], r2[ni], r2[i]])
        f_high.material_index = slate_mat

    f_top = bm.faces.new(r2)
    f_top.material_index = slate_mat

    # 屋根頂部の装飾クレスト（棟飾り）
    if top_w > 4.0:
        add_box(
            bm,
            center=Vector((cx, cy, z2 + 0.25)),
            size=Vector((top_w * 0.96, 0.45, 0.50)),
            mat_idx=stone_mat,
        )


def add_cylinder_y(
    bm,
    center: Vector,
    radius: float,
    depth_y: float,
    segments=24,
    mat_idx=0,
    smooth=True,
):
    """Y軸方向（ファサード法線方向）を向いた円柱・円盤（丸時計やバラ窓用）を追加"""
    front_verts = []
    back_verts = []
    hy = depth_y * 0.5
    for i in range(segments):
        ang = (2.0 * math.pi * i) / segments
        cx = center.x + math.cos(ang) * radius
        cz = center.z + math.sin(ang) * radius
        front_verts.append(bm.verts.new(Vector((cx, center.y - hy, cz))))
        back_verts.append(bm.verts.new(Vector((cx, center.y + hy, cz))))

    for i in range(segments):
        ni = (i + 1) % segments
        f = bm.faces.new([front_verts[i], front_verts[ni], back_verts[ni], back_verts[i]])
        f.material_index = mat_idx
        f.smooth = smooth

    f_f = bm.faces.new(list(reversed(front_verts)))
    f_f.material_index = mat_idx
    f_b = bm.faces.new(back_verts)
    f_b.material_index = mat_idx


def add_oriented_arched_window(
    bm,
    center: Vector,
    tangent_dir: Vector,
    normal_dir: Vector,
    width: float,
    rect_h: float,
    depth_n: float,
    glass_mat=3,
    stone_mat=1,
):
    """
    任意の壁面接線 (tangent_dir) と外向き法線 (normal_dir) に沿って、
    矩形窓ガラス＋半円アーチガラス＋立体的な白御影石キーストーンアーチ枠＋窓台シルを追加。
    360度どの角度から見ても窓枠に厚みがあり、壁面にピタリと密着する。
    """
    t = tangent_dir.normalized()
    n = normal_dir.normalized()
    u = Vector((0.0, 0.0, 1.0))

    # 1. 下部矩形ガラス
    rect_center = center - u * (rect_h * 0.12)
    add_oriented_box(
        bm,
        center=rect_center,
        tangent_dir=t,
        normal_dir=n,
        size_tangent=width,
        size_normal=depth_n,
        size_z=rect_h * 0.76,
        mat_idx=glass_mat,
    )

    # 2. 左右の白御影石窓枠ピラスター（窓の両脇を引き締める縦枠）
    for side_s in [-1.0, 1.0]:
        add_oriented_box(
            bm,
            center=rect_center + t * (side_s * width * 0.54) + n * 0.04,
            tangent_dir=t,
            normal_dir=n,
            size_tangent=width * 0.12,
            size_normal=depth_n * 1.25,
            size_z=rect_h * 0.78,
            mat_idx=stone_mat,
        )

    # 3. 上部半円アーチ（8分割の立体白御影石アーチ枠 + アーチガラス面）
    arch_r = width * 0.5
    arch_z_base = center.z + rect_h * 0.26
    arch_origin = Vector((center.x, center.y, arch_z_base))
    hn = depth_n * 0.62
    segs = 8

    for s in range(segs):
        a0 = (math.pi * s) / segs
        a1 = (math.pi * (s + 1)) / segs
        r_in = arch_r * 0.88
        r_out = arch_r * 1.18

        p_in0 = arch_origin + t * (math.cos(a0) * r_in) + u * (math.sin(a0) * r_in * 0.78)
        p_out0 = arch_origin + t * (math.cos(a0) * r_out) + u * (math.sin(a0) * r_out * 0.78)
        p_out1 = arch_origin + t * (math.cos(a1) * r_out) + u * (math.sin(a1) * r_out * 0.78)
        p_in1 = arch_origin + t * (math.cos(a1) * r_in) + u * (math.sin(a1) * r_in * 0.78)

        # 前面と背面のアーチ頂点（厚みを持たせる）
        vf0 = bm.verts.new(p_in0 + n * hn)
        vf1 = bm.verts.new(p_out0 + n * hn)
        vf2 = bm.verts.new(p_out1 + n * hn)
        vf3 = bm.verts.new(p_in1 + n * hn)

        vb0 = bm.verts.new(p_in0 - n * (hn * 0.5))
        vb1 = bm.verts.new(p_out0 - n * (hn * 0.5))
        vb2 = bm.verts.new(p_out1 - n * (hn * 0.5))
        vb3 = bm.verts.new(p_in1 - n * (hn * 0.5))

        for f_verts in [
            (vf0, vf1, vf2, vf3),
            (vb3, vb2, vb1, vb0),
            (vf1, vb1, vb2, vf2),
            (vf0, vf3, vb3, vb0),
        ]:
            f = bm.faces.new(f_verts)
            f.material_index = stone_mat
            f.smooth = True

        # アーチ内部の扇形ガラス
        vg_c = bm.verts.new(arch_origin + n * (depth_n * 0.35))
        vg_0 = bm.verts.new(p_in0 + n * (depth_n * 0.35))
        vg_1 = bm.verts.new(p_in1 + n * (depth_n * 0.35))
        fg = bm.faces.new([vg_c, vg_0, vg_1])
        fg.material_index = glass_mat

    # 4. 窓下の白御影石シル（窓台）
    add_oriented_box(
        bm,
        center=center - u * (rect_h * 0.5 + 0.16) + n * 0.05,
        tangent_dir=t,
        normal_dir=n,
        size_tangent=width * 1.24,
        size_normal=depth_n * 1.45,
        size_z=0.26,
        mat_idx=stone_mat,
    )


def add_arched_window(
    bm,
    center: Vector,
    width: float,
    rect_h: float,
    depth_y: float,
    glass_mat=3,
    stone_mat=1,
):
    """Y軸向きのファサード（正面 -Y または背面 +Y）に半円アーチ窓を追加"""
    normal_sign = -1.0 if center.y < 0.0 else 1.0
    tangent_dir = Vector((1.0, 0.0, 0.0)) if normal_sign < 0.0 else Vector((-1.0, 0.0, 0.0))
    normal_dir = Vector((0.0, normal_sign, 0.0))
    add_oriented_arched_window(
        bm,
        center=center,
        tangent_dir=tangent_dir,
        normal_dir=normal_dir,
        width=width,
        rect_h=rect_h,
        depth_n=depth_y,
        glass_mat=glass_mat,
        stone_mat=stone_mat,
    )


def add_dormer_window(
    bm,
    center: Vector,
    normal_sign: float,
    width: float = 2.2,
    height: float = 2.4,
    depth: float = 1.9,
    stone_mat=1,
    roof_mat=2,
    glass_mat=3,
):
    """マンサード屋根の斜面から張り出す三角形ペディメント付きドーマー窓を追加（正面・背面両対応）"""
    n_dir = Vector((0.0, normal_sign, 0.0))
    t_dir = Vector((1.0, 0.0, 0.0)) if normal_sign < 0.0 else Vector((-1.0, 0.0, 0.0))

    # ドーマー本体（白御影石枠）
    add_oriented_box(
        bm,
        center=center,
        tangent_dir=t_dir,
        normal_dir=n_dir,
        size_tangent=width,
        size_normal=depth,
        size_z=height,
        mat_idx=stone_mat,
    )
    # ドーマーの三角屋根（切妻小屋根）
    hw = width * 0.58
    hd = depth * 0.56

    vf_l = bm.verts.new(center - t_dir * hw + n_dir * hd + Vector((0.0, 0.0, height * 0.5)))
    vf_r = bm.verts.new(center + t_dir * hw + n_dir * hd + Vector((0.0, 0.0, height * 0.5)))
    vf_t = bm.verts.new(center + n_dir * hd + Vector((0.0, 0.0, height * 0.5 + 0.85)))

    vb_l = bm.verts.new(center - t_dir * hw - n_dir * hd + Vector((0.0, 0.0, height * 0.5)))
    vb_r = bm.verts.new(center + t_dir * hw - n_dir * hd + Vector((0.0, 0.0, height * 0.5)))
    vb_t = bm.verts.new(center - n_dir * hd + Vector((0.0, 0.0, height * 0.5 + 0.85)))

    for f_verts, m_idx in [
        ([vf_l, vf_r, vf_t], stone_mat),
        ([vb_r, vb_l, vb_t], stone_mat),
        ([vf_l, vf_t, vb_t, vb_l], roof_mat),
        ([vf_r, vb_r, vb_t, vf_t], roof_mat),
        ([vf_l, vb_l, vb_r, vf_r], stone_mat),
    ]:
        f = bm.faces.new(f_verts)
        f.material_index = m_idx

    # ドーマー前面ガラス窓
    add_oriented_box(
        bm,
        center=center + n_dir * (depth * 0.48),
        tangent_dir=t_dir,
        normal_dir=n_dir,
        size_tangent=width * 0.58,
        size_normal=0.18,
        size_z=height * 0.68,
        mat_idx=glass_mat,
    )


def add_polygon_prism(
    bm,
    center: Vector,
    radius_bot: float,
    radius_top: float,
    height: float,
    sides=8,
    mat_idx=0,
    smooth=False,
):
    """bmesh に多角柱を追加（頂点位相 pi/sides オフセットにより、各辺の法線が 0, 45, 90... 度に整列）"""
    bot_verts = []
    top_verts = []
    half_h = height * 0.5

    for i in range(sides):
        angle = (2.0 * math.pi * i) / sides + (math.pi / sides)
        cb = math.cos(angle) * radius_bot
        sb = math.sin(angle) * radius_bot
        ct = math.cos(angle) * radius_top
        st = math.sin(angle) * radius_top

        bot_verts.append(bm.verts.new(center + Vector((cb, sb, -half_h))))
        top_verts.append(bm.verts.new(center + Vector((ct, st, half_h))))

    for i in range(sides):
        ni = (i + 1) % sides
        f = bm.faces.new([bot_verts[i], bot_verts[ni], top_verts[ni], top_verts[i]])
        f.material_index = mat_idx
        f.smooth = smooth

    f_bot = bm.faces.new(list(reversed(bot_verts)))
    f_bot.material_index = mat_idx
    f_top = bm.faces.new(top_verts)
    f_top.material_index = mat_idx


def add_high_precision_bell_dome(
    bm,
    center: Vector,
    radius: float,
    height: float,
    sides=8,
    rings=14,
    roof_mat=2,
    stone_mat=1,
    bronze_mat=4,
    glass_mat=3,
):
    """
    14リング高分割の八角形ベル型ドーム屋根＋連続ロフト造形による8本コーナーリブ＋
    ドーム斜面の丸窓（オクルス）＋頂部クーポラ（小塔・尖塔フィニアル）を追加。
    従来の軸平行ボックスによるリブの飛び出しを完全に解消し、ドーム曲面に密着した連続リブを生成。
    """
    ring_verts = []
    radii_per_ring = []
    z_per_ring = []

    for ri in range(rings + 1):
        ratio = ri / rings
        z = center.z + height * ratio
        # 東京駅丸の内ドーム特有の優雅なベル型曲率
        bell_curve = math.pow(math.cos(ratio * math.pi * 0.5), 0.62) + 0.08 * math.sin(
            ratio * math.pi
        )
        r = radius * bell_curve if ratio < 1.0 else radius * 0.17
        radii_per_ring.append(r)
        z_per_ring.append(z)

        current_ring = []
        for si in range(sides):
            angle = (2.0 * math.pi * si) / sides + (math.pi / sides)
            x = center.x + math.cos(angle) * r
            y = center.y + math.sin(angle) * r
            current_ring.append(bm.verts.new(Vector((x, y, z))))
        ring_verts.append(current_ring)

    for ri in range(rings):
        r0 = ring_verts[ri]
        r1 = ring_verts[ri + 1]
        for si in range(sides):
            nsi = (si + 1) % sides
            f = bm.faces.new([r0[si], r0[nsi], r1[nsi], r1[si]])
            f.material_index = roof_mat
            f.smooth = True

    # 8本のコーナー稜線リブ（ドーム曲面に完全沿った連続ロフト四角柱ストリップ）
    rib_half_w = 0.22
    rib_out = 0.24
    for si in range(sides):
        angle = (2.0 * math.pi * si) / sides + (math.pi / sides)
        radial_dir = Vector((math.cos(angle), math.sin(angle), 0.0))
        tangent_dir = Vector((-math.sin(angle), math.cos(angle), 0.0))

        rib_sections = []
        for ri in range(rings + 1):
            r = radii_per_ring[ri]
            z = z_per_ring[ri]
            base_pt = Vector((center.x, center.y, z)) + radial_dir * (r * 0.99)
            out_pt = Vector((center.x, center.y, z)) + radial_dir * (r + rib_out)

            v_in_l = bm.verts.new(base_pt - tangent_dir * rib_half_w)
            v_in_r = bm.verts.new(base_pt + tangent_dir * rib_half_w)
            v_out_r = bm.verts.new(out_pt + tangent_dir * (rib_half_w * 0.8))
            v_out_l = bm.verts.new(out_pt - tangent_dir * (rib_half_w * 0.8))
            rib_sections.append((v_in_l, v_in_r, v_out_r, v_out_l))

        for ri in range(rings):
            s0 = rib_sections[ri]
            s1 = rib_sections[ri + 1]
            for k in range(4):
                nk = (k + 1) % 4
                f = bm.faces.new([s0[k], s0[nk], s1[nk], s1[k]])
                f.material_index = stone_mat if k == 2 else roof_mat
                f.smooth = True

    # ドーム中段の8面それぞれに白御影石枠付きオクルス（丸窓ドーマー）を法線整列で配置
    oculus_ratio = 0.36
    oculus_z = center.z + height * oculus_ratio
    oculus_curve = math.pow(math.cos(oculus_ratio * math.pi * 0.5), 0.62) + 0.08 * math.sin(
        oculus_ratio * math.pi
    )
    oculus_r = radius * oculus_curve * math.cos(math.pi / sides)
    for si in range(sides):
        face_angle = (2.0 * math.pi * si) / sides
        face_dir = Vector((math.cos(face_angle), math.sin(face_angle), 0.0))
        tangent_dir = Vector((-math.sin(face_angle), math.cos(face_angle), 0.0))
        oc_pos = Vector((center.x, center.y, oculus_z)) + face_dir * (oculus_r + 0.15)
        add_oriented_box(
            bm,
            center=oc_pos,
            tangent_dir=tangent_dir,
            normal_dir=face_dir,
            size_tangent=1.85,
            size_normal=0.55,
            size_z=2.35,
            mat_idx=stone_mat,
        )
        add_oriented_box(
            bm,
            center=oc_pos + face_dir * 0.24,
            tangent_dir=tangent_dir,
            normal_dir=face_dir,
            size_tangent=1.15,
            size_normal=0.18,
            size_z=1.55,
            mat_idx=glass_mat,
        )

    # ドーム頂部の八角クーポラ（ランタン小塔）＋尖塔フィニアル
    cupola_base_z = center.z + height
    add_polygon_prism(
        bm,
        center=Vector((center.x, center.y, cupola_base_z + 1.2)),
        radius_bot=radius * 0.19,
        radius_top=radius * 0.17,
        height=2.4,
        sides=8,
        mat_idx=stone_mat,
        smooth=True,
    )
    add_polygon_prism(
        bm,
        center=Vector((center.x, center.y, cupola_base_z + 3.2)),
        radius_bot=radius * 0.20,
        radius_top=0.08,
        height=2.0,
        sides=8,
        mat_idx=roof_mat,
        smooth=True,
    )
    # 頂点避雷針・風見鶏ポール
    add_polygon_prism(
        bm,
        center=Vector((center.x, center.y, cupola_base_z + 5.2)),
        radius_bot=0.10,
        radius_top=0.03,
        height=2.4,
        sides=8,
        mat_idx=bronze_mat,
        smooth=True,
    )


def build_central_building(materials) -> bpy.types.Object:
    """中央棟（皇居正対中央部: X=-25m〜+25m）を高精度モデリング"""
    mesh = bpy.data.meshes.new("CentralBuildingMesh")
    bm = bmesh.new()

    # 0: RedBrick, 1: WhiteStone, 2: SlateRoof, 3: WindowGlass, 4: DarkBronze, 5: ClockDial
    mat_keys = [
        "RedBrick",
        "WhiteStone",
        "SlateRoof",
        "WindowGlass",
        "DarkBronze",
        "ClockDial",
    ]

    w, d, h = 50.0, 24.0, 22.0

    # 1. 中央棟メイン躯体
    add_box(bm, center=Vector((0.0, 0.0, h * 0.5)), size=Vector((w, d, h)), mat_idx=0)

    # 2. 正面 (-Y) と背面 (+Y) の立体レンガピラスター（付け柱 8本）と白御影石柱頭・柱脚
    pilaster_xs = [-22.0, -15.0, -8.5, -3.2, 3.2, 8.5, 15.0, 22.0]
    for side_sign in [-1.0, 1.0]:
        py = side_sign * (d * 0.5 + 0.25)
        for px in pilaster_xs:
            add_box(
                bm,
                center=Vector((px, py, h * 0.5)),
                size=Vector((1.25, 0.55, h - 1.0)),
                mat_idx=0,
            )
            # コリント風白御影石キャピタル（柱頭）とベース
            add_box(
                bm,
                center=Vector((px, py * 1.01, h - 0.8)),
                size=Vector((1.55, 0.72, 0.9)),
                mat_idx=1,
            )
            add_box(
                bm,
                center=Vector((px, py * 1.01, 2.2)),
                size=Vector((1.45, 0.68, 0.7)),
                mat_idx=1,
            )

    # 3. 中央棟の2段勾配マンサード屋根（直方体ではなく台形スロープ屋根でペディメント・角塔と綺麗に融合）
    add_mansard_roof(
        bm,
        center=Vector((0.0, 0.0, 0.0)),
        base_w=w * 0.98,
        base_d=d * 0.96,
        base_z=h,
        mid_w=w * 0.90,
        mid_d=d * 0.78,
        mid_h=5.2,
        top_w=w * 0.82,
        top_d=d * 0.58,
        top_h=3.0,
        slate_mat=2,
        stone_mat=1,
    )

    # 4. 正面 (-Y) と背面 (+Y) の中央大三角形ペディメント＋24分割円形大時計
    ped_w, ped_h = 19.0, 7.6
    for side_sign in [-1.0, 1.0]:
        y_front = side_sign * (d * 0.5 + 0.45)
        y_back = side_sign * (d * 0.5 - 3.2)

        v_bl = bm.verts.new(Vector((-ped_w * 0.5, y_front, h)))
        v_br = bm.verts.new(Vector((ped_w * 0.5, y_front, h)))
        v_top = bm.verts.new(Vector((0.0, y_front, h + ped_h)))
        v_bl_b = bm.verts.new(Vector((-ped_w * 0.5, y_back, h)))
        v_br_b = bm.verts.new(Vector((ped_w * 0.5, y_back, h)))
        v_top_b = bm.verts.new(Vector((0.0, y_back, h + ped_h)))

        if side_sign < 0.0:
            faces_ped = [
                ([v_bl, v_br, v_top], 1),
                ([v_bl_b, v_top_b, v_br_b], 1),
                ([v_bl, v_top, v_top_b, v_bl_b], 2),
                ([v_br, v_br_b, v_top_b, v_top], 2),
            ]
        else:
            faces_ped = [
                ([v_br, v_bl, v_top], 1),
                ([v_br_b, v_top_b, v_bl_b], 1),
                ([v_bl_b, v_top_b, v_top, v_bl], 2),
                ([v_br, v_top, v_top_b, v_br_b], 2),
            ]
        for f_verts, m_idx in faces_ped:
            f = bm.faces.new(f_verts)
            f.material_index = m_idx

        # 円形大時計文字盤＋ブロンズベゼル＋針
        clock_center = Vector((0.0, side_sign * (d * 0.5 + 0.55), 24.4))
        add_cylinder_y(
            bm,
            center=clock_center,
            radius=1.95,
            depth_y=0.32,
            segments=24,
            mat_idx=4,
            smooth=True,
        )
        add_cylinder_y(
            bm,
            center=clock_center + Vector((0.0, side_sign * 0.08, 0.0)),
            radius=1.55,
            depth_y=0.22,
            segments=24,
            mat_idx=5,
            smooth=True,
        )
        add_box(
            bm,
            center=clock_center + Vector((-0.35, side_sign * 0.22, 0.28)),
            size=Vector((0.95, 0.08, 0.14)),
            mat_idx=4,
        )
        add_box(
            bm,
            center=clock_center + Vector((0.42, side_sign * 0.22, 0.35)),
            size=Vector((1.15, 0.08, 0.12)),
            mat_idx=4,
        )

    # 5. 中央棟の四隅角塔ドーム（タレット: 正面側・背面側の両方にシンメトリー配置）
    for turret_x in [-21.2, 21.2]:
        for side_sign in [-1.0, 1.0]:
            ty = side_sign * (d * 0.34)
            add_box(
                bm,
                center=Vector((turret_x, ty, h + 4.4)),
                size=Vector((6.4, 6.4, 8.8)),
                mat_idx=0,
            )
            add_box(
                bm,
                center=Vector((turret_x, ty, h + 9.0)),
                size=Vector((7.0, 7.0, 0.75)),
                mat_idx=1,
            )
            add_polygon_prism(
                bm,
                center=Vector((turret_x, ty, h + 11.4)),
                radius_bot=4.3,
                radius_top=0.32,
                height=4.8,
                sides=8,
                mat_idx=2,
                smooth=True,
            )

    # 6. 正面貴賓エントランス大庇（皇室車寄せポーティコ: 幅18m, 奥行き7m, 高さ5.6m, アーチ列柱）
    add_box(
        bm,
        center=Vector((0.0, -d * 0.5 - 3.5, 5.5)),
        size=Vector((18.0, 7.0, 0.85)),
        mat_idx=1,
    )
    add_box(
        bm,
        center=Vector((0.0, -d * 0.5 - 3.5, 6.15)),
        size=Vector((17.2, 6.4, 0.45)),
        mat_idx=4,
    )
    for col_x in [-7.5, -2.6, 2.6, 7.5]:
        add_box(
            bm,
            center=Vector((col_x, -d * 0.5 - 6.4, 2.75)),
            size=Vector((1.15, 1.15, 5.5)),
            mat_idx=0,
        )
        add_box(
            bm,
            center=Vector((col_x, -d * 0.5 - 6.4, 1.2)),
            size=Vector((1.35, 1.35, 0.6)),
            mat_idx=1,
        )
        add_box(
            bm,
            center=Vector((col_x, -d * 0.5 - 6.4, 5.0)),
            size=Vector((1.40, 1.40, 0.65)),
            mat_idx=1,
        )

    # 7. 中央ファサードの半円アーチ窓列（正面 -Y と背面 +Y）
    for side_sign in [-1.0, 1.0]:
        y_face = side_sign * (d * 0.5 + 0.14)
        for floor_z in [5.6, 11.2, 16.8]:
            for wx in [-18.5, -11.8, -5.8, 0.0, 5.8, 11.8, 18.5]:
                if floor_z == 5.6 and abs(wx) < 3.0 and side_sign < 0:
                    add_box(
                        bm,
                        center=Vector((wx, y_face, 3.0)),
                        size=Vector((3.6, 0.3, 5.2)),
                        mat_idx=4,
                    )
                else:
                    add_arched_window(
                        bm,
                        center=Vector((wx, y_face, floor_z)),
                        width=2.4,
                        rect_h=3.3,
                        depth_y=0.25,
                    )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("CentralBuilding", mesh)
    for k in mat_keys:
        obj.data.materials.append(materials[k])

    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_wing(materials, name: str, center_x: float) -> bpy.types.Object:
    """
    南北ウィング棟（center_x=±84.0m, 幅122.0m -> X=±23.0m〜±145.0m）を高精度モデリング。
    中央棟（|X|<=25m）および八角形ドーム塔（center_x=±145m, 半径14.5m）へそれぞれ内部まで貫入させて
    5mの隙間を完全にゼロにし、360度どこから見ても一体化した重厚な赤レンガ駅舎を実現する。
    """
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    bm = bmesh.new()

    # 0: RedBrick, 1: WhiteStone, 2: SlateRoof, 3: WindowGlass
    mat_keys = ["RedBrick", "WhiteStone", "SlateRoof", "WindowGlass"]

    w, d, h = 122.0, 20.0, 18.0
    sign_x = -1.0 if center_x < 0.0 else 1.0

    # 1. ウィング棟メイン躯体（X=±23.0m〜±145.0m で中央棟・ドーム塔と完全連結）
    add_box(bm, center=Vector((center_x, 0.0, h * 0.5)), size=Vector((w, d, h)), mat_idx=0)

    # 2. 2段勾配マンサードスレート屋根（隙間なく中央棟からドーム塔まで連続）
    add_mansard_roof(
        bm,
        center=Vector((center_x, 0.0, 0.0)),
        base_w=w,
        base_d=d * 0.98,
        base_z=h,
        mid_w=w * 0.98,
        mid_d=d * 0.80,
        mid_h=4.0,
        top_w=w * 0.96,
        top_d=d * 0.58,
        top_h=2.2,
        slate_mat=2,
        stone_mat=1,
    )

    # 3. 14スパンの窓列とピラスター（中央棟 |X|<=25m とドーム塔 |X|>=130.5m の間の露出区間 |X|=29.5m〜126.5m に均等配置）
    window_count = 14
    vis_start_abs = 29.5
    vis_end_abs = 126.5
    step_abs = (vis_end_abs - vis_start_abs) / (window_count - 1)

    for side_sign in [-1.0, 1.0]:
        y_face = side_sign * (d * 0.5 + 0.12)
        y_pilaster = side_sign * (d * 0.5 + 0.22)

        # スパン間の垂直ピラスター（正面 -Y と背面 +Y の両方）
        for wi in range(window_count + 1):
            px = sign_x * (vis_start_abs + (wi - 0.5) * step_abs)
            add_box(
                bm,
                center=Vector((px, y_pilaster, h * 0.5)),
                size=Vector((0.85, 0.42, h - 0.8)),
                mat_idx=0,
            )
            add_box(
                bm,
                center=Vector((px, y_pilaster * 1.01, h - 0.6)),
                size=Vector((1.05, 0.52, 0.6)),
                mat_idx=1,
            )

        # 3階層のアーチ窓（正面 -Y と背面 +Y の両方）
        for fi, floor_z in enumerate([4.5, 9.5, 14.5]):
            win_h = 2.7 if fi < 2 else 2.3
            for wi in range(window_count):
                wx = sign_x * (vis_start_abs + wi * step_abs)
                add_arched_window(
                    bm,
                    center=Vector((wx, y_face, floor_z)),
                    width=2.1,
                    rect_h=win_h,
                    depth_y=0.22,
                )

        # 4. 屋根上の三角形ペディメント付きドーマー窓（正面 -Y と背面 +Y の両面に10基ずつ配置）
        dormer_count = 10
        dormer_start_abs = 33.0
        dormer_end_abs = 123.0
        dormer_step_abs = (dormer_end_abs - dormer_start_abs) / (dormer_count - 1)
        for di in range(dormer_count):
            dx = sign_x * (dormer_start_abs + di * dormer_step_abs)
            add_dormer_window(
                bm,
                center=Vector((dx, side_sign * (d * 0.5 - 1.15), h + 2.0)),
                normal_sign=side_sign,
                width=2.1,
                height=2.2,
                depth=1.8,
                stone_mat=1,
                roof_mat=2,
                glass_mat=3,
            )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new(name, mesh)
    for k in mat_keys:
        obj.data.materials.append(materials[k])

    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_octagonal_dome(materials, name: str, center_x: float) -> bpy.types.Object:
    """
    南北八角形ドーム塔＆14リング高分割ベル型銅板ドーム屋根をモデリング。
    8角形のすべての壁面・コーナーに対して法線・接線ベクトル (`face_dir`, `tangent_dir`) で
    回転整列させた窓・ピラスター・ペディメント・連続リブを生成し、360度どの角度から見ても破綻のない造形にする。
    """
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    bm = bmesh.new()

    # 0: RedBrick, 1: WhiteStone, 2: CopperRoof, 3: WindowGlass, 4: DarkBronze
    mat_keys = ["RedBrick", "WhiteStone", "CopperRoof", "WindowGlass", "DarkBronze"]

    tower_r = 14.5
    tower_h = 24.0
    dome_h = 14.5

    # 1. 八角形レンガ塔本体
    add_polygon_prism(
        bm,
        center=Vector((center_x, 0.0, tower_h * 0.5)),
        radius_bot=tower_r,
        radius_top=tower_r * 0.98,
        height=tower_h,
        sides=8,
        mat_idx=0,
    )

    # 2. 塔の8角コーナーピラスター（各頂点の放射方向 c_dir に沿って回転配置された白御影石＆赤レンガ隅柱）
    for side_idx in range(8):
        corner_ang = (2.0 * math.pi * side_idx) / 8.0 + (math.pi / 8.0)
        c_dir = Vector((math.cos(corner_ang), math.sin(corner_ang), 0.0))
        c_tan = Vector((-math.sin(corner_ang), math.cos(corner_ang), 0.0))
        c_pos = Vector((center_x, 0.0, tower_h * 0.5)) + c_dir * (tower_r * 0.98)
        add_oriented_box(
            bm,
            center=c_pos,
            tangent_dir=c_tan,
            normal_dir=c_dir,
            size_tangent=1.10,
            size_normal=0.65,
            size_z=tower_h,
            mat_idx=1,
        )

    # 3. 塔上部コーニス・白御影石パラペット帯（2段八角形モールディング）
    add_polygon_prism(
        bm,
        center=Vector((center_x, 0.0, tower_h + 0.55)),
        radius_bot=tower_r * 1.05,
        radius_top=tower_r * 1.08,
        height=1.1,
        sides=8,
        mat_idx=1,
    )
    add_polygon_prism(
        bm,
        center=Vector((center_x, 0.0, tower_h + 1.45)),
        radius_bot=tower_r * 1.03,
        radius_top=tower_r * 1.04,
        height=0.8,
        sides=8,
        mat_idx=1,
    )

    # 4. 高精度14リング八角形ベル型ドーム屋根＋連続ロフト8本コーナーリブ＋オクルス丸窓＋クーポラ小塔
    add_high_precision_bell_dome(
        bm,
        center=Vector((center_x, 0.0, tower_h + 1.8)),
        radius=tower_r * 1.02,
        height=dome_h,
        sides=8,
        rings=14,
        roof_mat=2,
        stone_mat=1,
        bronze_mat=4,
        glass_mat=3,
    )

    # 5. ドーム塔8面のアーチ窓・双柱ピラスター・上部ペディメント装飾（各面の法線 face_dir と接線 tangent_dir に完全整列）
    apothem = tower_r * math.cos(math.pi / 8.0)
    for side_idx in range(8):
        # ウィング棟と直結する内側面（NorthDome の +X 面 side_idx=0、SouthDome の -X 面 side_idx=4）は壁面接続のためスキップ
        is_wing_junction = (center_x < 0.0 and side_idx == 0) or (center_x > 0.0 and side_idx == 4)
        if is_wing_junction:
            continue

        face_angle = (2.0 * math.pi * side_idx) / 8.0
        face_dir = Vector((math.cos(face_angle), math.sin(face_angle), 0.0))
        tangent_dir = Vector((-math.sin(face_angle), math.cos(face_angle), 0.0))
        wall_center_xy = Vector((center_x, 0.0, 0.0)) + face_dir * apothem

        # 各壁面の左右を引き締める双柱レリーフ（付け柱）
        for p_offset in [-2.6, 2.6]:
            pil_pos = (
                wall_center_xy
                + tangent_dir * p_offset
                + face_dir * 0.22
                + Vector((0.0, 0.0, tower_h * 0.52))
            )
            add_oriented_box(
                bm,
                center=pil_pos,
                tangent_dir=tangent_dir,
                normal_dir=face_dir,
                size_tangent=0.72,
                size_normal=0.42,
                size_z=tower_h - 2.0,
                mat_idx=0,
            )
            # 柱頭（白御影石）
            add_oriented_box(
                bm,
                center=pil_pos + Vector((0.0, 0.0, (tower_h - 2.0) * 0.5 + 0.35)),
                tangent_dir=tangent_dir,
                normal_dir=face_dir,
                size_tangent=0.92,
                size_normal=0.55,
                size_z=0.65,
                mat_idx=1,
            )

        # 3階大アーチ窓（法線方向に薄く、接線方向に広い正しい向き）
        win_pos3 = wall_center_xy + face_dir * 0.12 + Vector((0.0, 0.0, 17.8))
        add_oriented_arched_window(
            bm,
            center=win_pos3,
            tangent_dir=tangent_dir,
            normal_dir=face_dir,
            width=2.6,
            rect_h=3.5,
            depth_n=0.26,
            glass_mat=3,
            stone_mat=1,
        )

        # 2階アーチ窓
        win_pos2 = wall_center_xy + face_dir * 0.12 + Vector((0.0, 0.0, 11.4))
        add_oriented_arched_window(
            bm,
            center=win_pos2,
            tangent_dir=tangent_dir,
            normal_dir=face_dir,
            width=2.4,
            rect_h=3.1,
            depth_n=0.26,
            glass_mat=3,
            stone_mat=1,
        )

        # 1階アーチ開口・エントランス扉
        win_pos1 = wall_center_xy + face_dir * 0.14 + Vector((0.0, 0.0, 4.8))
        add_oriented_arched_window(
            bm,
            center=win_pos1,
            tangent_dir=tangent_dir,
            normal_dir=face_dir,
            width=2.6,
            rect_h=3.6,
            depth_n=0.28,
            glass_mat=4,
            stone_mat=1,
        )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new(name, mesh)
    for k in mat_keys:
        obj.data.materials.append(materials[k])

    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_facade_details(materials) -> bpy.types.Object:
    """全棟および八角形ドーム塔にわたる辰野式白御影石ストライプ化粧帯（白帯装飾）と御影石基壇をモデリング"""
    mesh = bpy.data.meshes.new("FacadeDetailsMesh")
    bm = bmesh.new()

    stripe_heights = [2.2, 6.8, 9.2, 11.8, 14.2, 16.8, 18.0]

    for sz in stripe_heights:
        # 中央棟部分 (幅50m)
        add_box(
            bm,
            center=Vector((0.0, 0.0, sz)),
            size=Vector((50.7, 24.6, 0.40)),
            mat_idx=0,
        )
        # 北ウィング部分 (X=-23m〜-145m を隙間なくカバー)
        add_box(
            bm,
            center=Vector((-84.0, 0.0, sz)),
            size=Vector((122.4, 20.6, 0.36)),
            mat_idx=0,
        )
        # 南ウィング部分 (X=+23m〜+145m を隙間なくカバー)
        add_box(
            bm,
            center=Vector((84.0, 0.0, sz)),
            size=Vector((122.4, 20.6, 0.36)),
            mat_idx=0,
        )
        # 北・南八角形ドーム塔の周囲を巡る八角形白帯ストライプ
        for dome_cx in [-145.0, 145.0]:
            add_polygon_prism(
                bm,
                center=Vector((dome_cx, 0.0, sz)),
                radius_bot=14.72,
                radius_top=14.72,
                height=0.38,
                sides=8,
                mat_idx=0,
            )

    # 中央棟・ドーム塔の上層（Z=20.2m, 22.0m）の白帯コーニス
    for upper_sz in [20.2, 21.8]:
        add_box(
            bm,
            center=Vector((0.0, 0.0, upper_sz)),
            size=Vector((50.8, 24.7, 0.44)),
            mat_idx=0,
        )
        for dome_cx in [-145.0, 145.0]:
            add_polygon_prism(
                bm,
                center=Vector((dome_cx, 0.0, upper_sz)),
                radius_bot=14.70,
                radius_top=14.70,
                height=0.40,
                sides=8,
                mat_idx=0,
            )

    # 1階重厚御影石基壇（ルスティカ仕上げ風2段土台：中央棟・ウィング・ドーム塔すべてを支える）
    add_box(bm, center=Vector((0.0, 0.0, 0.45)), size=Vector((322.0, 25.2, 0.90)), mat_idx=0)
    add_box(bm, center=Vector((0.0, 0.0, 1.15)), size=Vector((321.0, 24.8, 0.55)), mat_idx=0)
    for dome_cx in [-145.0, 145.0]:
        add_polygon_prism(
            bm,
            center=Vector((dome_cx, 0.0, 0.70)),
            radius_bot=15.05,
            radius_top=14.90,
            height=1.40,
            sides=8,
            mat_idx=0,
        )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("FacadeDetails", mesh)
    obj.data.materials.append(materials["WhiteStone"])
    bpy.context.scene.collection.objects.link(obj)
    return obj


def generate_tokyo_station():
    """東京駅丸の内赤レンガ駅舎全体を生成しエクスポート"""
    clean_scene()
    materials = setup_materials()

    root = bpy.data.objects.new("StationRoot", None)
    root.empty_display_type = "ARROWS"
    root.empty_display_size = 2.0
    bpy.context.scene.collection.objects.link(root)

    central = build_central_building(materials)
    central.parent = root

    north_wing = build_wing(materials, "NorthWing", center_x=-84.0)
    north_wing.parent = root

    south_wing = build_wing(materials, "SouthWing", center_x=84.0)
    south_wing.parent = root

    north_dome = build_octagonal_dome(materials, "NorthDome", center_x=-145.0)
    north_dome.parent = root

    south_dome = build_octagonal_dome(materials, "SouthDome", center_x=145.0)
    south_dome.parent = root

    details = build_facade_details(materials)
    details.parent = root

    print("High-precision Tokyo Station modeling complete! Hierarchy created:")
    for obj in bpy.data.objects:
        p_name = obj.parent.name if obj.parent else "None"
        print(f"  - {obj.name} (Type: {obj.type}, Parent: {p_name})")

    out_dir = os.path.abspath("apps/web/public/models")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "tokyo_station.glb")

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
        f"Successfully exported Tokyo Station model to: {out_path} ({os.path.getsize(out_path):,} bytes)"
    )


if __name__ == "__main__":
    generate_tokyo_station()

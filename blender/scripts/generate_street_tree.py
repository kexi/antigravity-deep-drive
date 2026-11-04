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
Blender Procedural Modeling Script: 行幸通りイチョウ街路樹 (Gyoko-dori Ginkgo Biloba Tree - Pure 3D Fan-Leaf Modeling)
Tokyo Station Deep Drive 用 3D アセット生成

高精度モデリング仕様 (東京駅丸の内・行幸通り イチョウ並木モデル - 100%実体3Dイチョウ扇形葉・360度対応版):
- 根張り (Root Flare) とテーパー付き主幹 (Main Trunk: 高さ約7.6m, 16分割スムーズ円筒 + 縦溝樹皮ディテール)
- 下枝の分岐構造が360度から自然に見える主枝・副枝・小枝 (Twigs) ネットワーク:
  黄金角螺旋配置で10本の主枝 (Z=2.05m〜6.05m)、20本の副枝、さらに葉束へと伸びる90本の小枝が分岐し、
  すべての小枝の先端がイチョウの短枝葉束（ロゼット）へ自然に繋がる構造
- 球体塊（ブロブ）を一切使わず、100%「実体3Dイチョウ扇形葉 (Ginkgo Biloba Fan Leaves)」で構成された樹冠:
  1枚1枚の葉が「細い葉柄 (Petiole) ＋ 放射状クアッドで構成された左右2裂片の扇形葉身 ＋ 中央の二股切れ込み (Biloba Notch)」
  の3D曲面メッシュ（19頂点・11面、法線完全統一）として造形され、約2,200枚の葉が短枝輪生（ロゼット）状に重なり合うことで、
  遠景の端正な円錐シルエットから近景の葉っぱ1枚1枚のディテールまで破綻なく表現
- 葉脈・二股切れ込みシェーダー (`GinkgoFoliageMaterial`) と完全連動する正規化イチョウ葉UV (`u=扇幅, v=葉柄0→葉先1`)
- 鋳鉄製・御影石縁石付き街路樹保護桝 (Cast-Iron Concentric & Radial Grate + Beveled Granite Curb)

階層構造:
GinkgoTreeRoot (Empty)
├── Tree_Trunk (メッシュ: 根張り・主幹・主枝10本・副枝20本・小枝90本・樹皮溝ディテール)
├── Tree_Foliage (メッシュ: 約2,200枚の立体イチョウ扇形葉ロゼット群、葉UV・法線最適化済み)
└── Tree_Guard (メッシュ: 歩道埋設型の御影石縁石＆同心円・放射状鋳鉄製ツリーサークル格子)
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
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh, do_unlink=True)
    for mat in list(bpy.data.materials):
        bpy.data.materials.remove(mat, do_unlink=True)


def create_pbr_material(
    name: str,
    base_color=(1.0, 1.0, 1.0, 1.0),
    metallic=0.0,
    roughness=0.5,
    subsurface_weight=0.0,
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
    if "Subsurface Weight" in bsdf.inputs:
        bsdf.inputs["Subsurface Weight"].default_value = subsurface_weight

    return mat


def setup_materials():
    """イチョウ街路樹用PBRマテリアル一式を定義"""
    return {
        # イチョウの縦溝樹皮（灰褐色〜深茶色）
        "GinkgoBark": create_pbr_material(
            "GinkgoBark",
            base_color=(0.24, 0.17, 0.12, 1.0),
            roughness=0.88,
            metallic=0.02,
        ),
        # 行幸通りイチョウ黄葉（鮮やかな黄金色〜琥珀イエロー、SSS透過対応）
        "GinkgoFoliage": create_pbr_material(
            "GinkgoFoliage",
            base_color=(0.95, 0.74, 0.11, 1.0),
            roughness=0.42,
            metallic=0.02,
            subsurface_weight=0.48,
        ),
        # 鋳鉄製ツリーガード格子（ダークブロンズ鋳鉄）
        "TreeGuardIron": create_pbr_material(
            "TreeGuardIron",
            base_color=(0.15, 0.16, 0.18, 1.0),
            roughness=0.45,
            metallic=0.78,
        ),
        # 御影石縁石（白御影石）
        "GraniteCurb": create_pbr_material(
            "GraniteCurb",
            base_color=(0.78, 0.79, 0.81, 1.0),
            roughness=0.60,
            metallic=0.05,
        ),
    }


def add_tapered_tube(
    bm: bmesh.types.BMesh,
    uv_layer,
    points: list[Vector],
    radii: list[float],
    sides: int = 14,
    bark_ridge_amp: float = 0.04,
    is_main_trunk: bool = False,
    mat_idx: int = 0,
):
    """指定された3Dパスと半径リストに沿って、樹皮の縦溝凹凸を持つ高分割テーパー円筒（幹・枝）を生成"""
    rings = []
    ring_v_coords = []
    accum_len = 0.0

    for idx, pt in enumerate(points):
        if idx > 0:
            accum_len += (pt - points[idx - 1]).length
        ring_v_coords.append(accum_len * 0.65)

        if idx == 0:
            tangent = (points[1] - points[0]).normalized()
        elif idx == len(points) - 1:
            tangent = (points[-1] - points[-2]).normalized()
        else:
            tangent = (points[idx + 1] - points[idx - 1]).normalized()

        up_ref = Vector((1.0, 0.0, 0.0)) if abs(tangent.z) > 0.92 else Vector((0.0, 0.0, 1.0))
        normal = tangent.cross(up_ref).normalized()
        binormal = tangent.cross(normal).normalized()

        r_base = radii[idx]
        ring_verts = []
        for s in range(sides):
            angle = (2.0 * math.pi * s) / sides
            flare = 0.0
            if is_main_trunk and pt.z < 0.85:
                flare_factor = max(0.0, (0.85 - pt.z) / 0.85)
                flare = flare_factor * flare_factor * 0.14 * (0.5 + 0.5 * math.cos(angle * 5.0))

            ridge = bark_ridge_amp * r_base * math.cos(angle * 8.0 + accum_len * 1.5)
            r = max(0.010, r_base + flare + ridge)

            offset = (normal * math.cos(angle) + binormal * math.sin(angle)) * r
            v = bm.verts.new(pt + offset)
            ring_verts.append((v, s / sides))

        rings.append(ring_verts)

    for r_idx in range(len(rings) - 1):
        r0 = rings[r_idx]
        r1 = rings[r_idx + 1]
        v0_coord = ring_v_coords[r_idx]
        v1_coord = ring_v_coords[r_idx + 1]

        for s in range(sides):
            ns = (s + 1) % sides
            vert_bl, u_bl = r0[s]
            vert_br, _ = r0[ns]
            vert_tr, _ = r1[ns]
            vert_tl, _ = r1[s]
            u_br = (s + 1) / sides

            face = bm.faces.new([vert_bl, vert_br, vert_tr, vert_tl])
            face.material_index = mat_idx
            face.smooth = True

            uvs = [
                Vector((u_bl, v0_coord)),
                Vector((u_br, v0_coord)),
                Vector((u_br, v1_coord)),
                Vector((u_bl, v1_coord)),
            ]
            for loop, uv in zip(face.loops, uvs, strict=True):
                loop[uv_layer].uv = uv

    top_ring = [pair[0] for pair in rings[-1]]
    f_top = bm.faces.new(top_ring)
    f_top.material_index = mat_idx
    f_top.smooth = True
    for loop in f_top.loops:
        loop[uv_layer].uv = Vector((0.5, ring_v_coords[-1]))


def get_branch_skeleton():
    """
    主幹から分岐する10本の主枝、20本の副枝、および葉束を支える小枝(twigs)と葉房アンカー座標を計算して返す。
    すべての小枝の先端 (twig_tips) にもイチョウ葉ロゼットを直接配置することで、枝切れ端の露出を防ぐ。
    """
    golden_angle = math.radians(137.508)
    # (分岐開始高さZ, 方位角, 水平到達半径reach_r, 上昇量rise_z, 付け根半径base_r)
    branch_configs = [
        (2.05, 0.0, 1.38, 1.05, 0.135),
        (2.35, golden_angle * 1, 1.44, 1.12, 0.130),
        (2.70, golden_angle * 2, 1.48, 1.18, 0.125),
        (3.10, golden_angle * 3, 1.42, 1.24, 0.118),
        (3.55, golden_angle * 4, 1.36, 1.28, 0.112),
        (4.00, golden_angle * 5, 1.26, 1.26, 0.104),
        (4.45, golden_angle * 6, 1.15, 1.22, 0.095),
        (4.95, golden_angle * 7, 1.02, 1.16, 0.086),
        (5.50, golden_angle * 8, 0.86, 1.08, 0.076),
        (6.05, golden_angle * 9, 0.68, 0.98, 0.066),
    ]

    primary_branches = []
    secondary_branches = []
    tertiary_twigs = []
    foliage_anchors = []
    twig_tip_rosettes = []

    for b_idx, (start_z, angle, reach_r, rise_z, base_r) in enumerate(branch_configs):
        dir_xy = Vector((math.cos(angle), math.sin(angle), 0.0))
        side_xy = Vector((-math.sin(angle), math.cos(angle), 0.0))

        # 主枝はまず斜め横へ張り出し、そこから緩やかに上向きへ立ち上がる
        p0 = Vector((0.0, 0.0, start_z))
        p1 = p0 + dir_xy * (reach_r * 0.42) + side_xy * 0.04 + Vector((0.0, 0.0, rise_z * 0.25))
        p2 = p0 + dir_xy * (reach_r * 0.78) - side_xy * 0.03 + Vector((0.0, 0.0, rise_z * 0.62))
        p3 = p0 + dir_xy * reach_r + Vector((0.0, 0.0, rise_z))

        primary_branches.append(
            ([p0, p1, p2, p3], [base_r, base_r * 0.75, base_r * 0.52, base_r * 0.24])
        )

        height_ratio = b_idx / len(branch_configs)
        main_lobe_rxy = 0.74 * (1.0 - 0.26 * height_ratio)
        main_lobe_rz = 0.58 * (1.0 - 0.20 * height_ratio)
        foliage_anchors.append(
            (
                p3 + Vector((0.0, 0.0, 0.06)),
                main_lobe_rxy,
                main_lobe_rz,
                b_idx * 1.7 + 0.5,
            )
        )

        # 主枝の中腹にも短枝葉束アンカーを追加して枝沿いの葉密度を高める
        mid_branch_pt = p1.lerp(p2, 0.60)
        foliage_anchors.append(
            (
                mid_branch_pt + Vector((0.0, 0.0, 0.08)),
                main_lobe_rxy * 0.70,
                main_lobe_rz * 0.70,
                b_idx * 2.3 + 4.1,
            )
        )

        # 主枝先端から放射状に広がる小枝 (Twigs) — 先端 tp1 に必ず葉束ロゼットを配置
        for t_i in range(3):
            t_ang = angle + (t_i - 1.0) * 0.46
            t_dir = Vector((math.cos(t_ang), math.sin(t_ang), 0.28)).normalized()
            tp0 = p2.lerp(p3, 0.58)
            tp1 = tp0 + t_dir * 0.36
            tertiary_twigs.append(([tp0, tp1], [base_r * 0.20, 0.012]))
            twig_tip_rosettes.append((tp1, t_dir, b_idx * 5.1 + t_i * 1.3))

        # 副枝（各主枝から左右2本に分岐して葉房を広げる）
        for sub_idx, sub_sign in enumerate([-1.0, 1.0]):
            sub_angle = angle + sub_sign * (0.46 + 0.06 * (b_idx % 2))
            sub_dir = Vector((math.cos(sub_angle), math.sin(sub_angle), 0.0))
            sp0 = p1.lerp(p2, 0.35 if sub_sign < 0 else 0.72)
            sp1 = sp0 + sub_dir * (reach_r * 0.28) + Vector((0.0, 0.0, rise_z * 0.26))
            sp2 = sp0 + sub_dir * (reach_r * 0.54) + Vector((0.0, 0.0, rise_z * 0.55))
            secondary_branches.append(
                ([sp0, sp1, sp2], [base_r * 0.52, base_r * 0.34, base_r * 0.16])
            )

            sub_lobe_rxy = main_lobe_rxy * (0.82 if sub_idx == 0 else 0.76)
            sub_lobe_rz = main_lobe_rz * 0.84
            foliage_anchors.append(
                (
                    sp2 + Vector((0.0, 0.0, 0.05)),
                    sub_lobe_rxy,
                    sub_lobe_rz,
                    b_idx * 3.1 + sub_idx * 1.3,
                )
            )

            # 副枝先端の小枝 — 先端 stp1 に必ず葉束ロゼットを配置
            for st_i in range(3):
                st_ang = sub_angle + (st_i - 1.0) * 0.50
                st_dir = Vector((math.cos(st_ang), math.sin(st_ang), 0.24)).normalized()
                stp0 = sp1.lerp(sp2, 0.58)
                stp1 = stp0 + st_dir * 0.32
                tertiary_twigs.append(([stp0, stp1], [base_r * 0.17, 0.010]))
                twig_tip_rosettes.append((stp1, st_dir, b_idx * 7.3 + sub_idx * 2.9 + st_i * 1.1))

    return (
        primary_branches,
        secondary_branches,
        tertiary_twigs,
        foliage_anchors,
        twig_tip_rosettes,
    )


def build_tree_trunk(materials) -> bpy.types.Object:
    """イチョウの主幹・根張り・10本の主枝・20本の副枝・90本の小枝を構築"""
    mesh = bpy.data.meshes.new("Tree_Trunk_Mesh")
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")

    # 1. 主幹（16分割で滑らかな円筒断面、Z=0.0m -> Z=7.65m）
    trunk_pts = [
        Vector((0.00, 0.00, 0.00)),
        Vector((0.01, -0.01, 0.45)),
        Vector((0.02, 0.01, 1.20)),
        Vector((0.01, 0.02, 2.15)),
        Vector((-0.02, 0.01, 3.25)),
        Vector((-0.01, -0.02, 4.45)),
        Vector((0.01, -0.01, 5.75)),
        Vector((0.00, 0.00, 6.85)),
        Vector((0.00, 0.00, 7.65)),
    ]
    trunk_radii = [0.40, 0.30, 0.26, 0.23, 0.20, 0.16, 0.12, 0.08, 0.04]
    add_tapered_tube(
        bm,
        uv_layer,
        trunk_pts,
        trunk_radii,
        sides=16,
        bark_ridge_amp=0.055,
        is_main_trunk=True,
        mat_idx=0,
    )

    # 2. 主枝・副枝・小枝
    primary_branches, secondary_branches, tertiary_twigs, _, _ = get_branch_skeleton()
    for pts, radii in primary_branches:
        add_tapered_tube(
            bm,
            uv_layer,
            pts,
            radii,
            sides=10,
            bark_ridge_amp=0.035,
            is_main_trunk=False,
            mat_idx=0,
        )

    for pts, radii in secondary_branches:
        add_tapered_tube(
            bm,
            uv_layer,
            pts,
            radii,
            sides=8,
            bark_ridge_amp=0.022,
            is_main_trunk=False,
            mat_idx=0,
        )

    for pts, radii in tertiary_twigs:
        add_tapered_tube(
            bm,
            uv_layer,
            pts,
            radii,
            sides=5,
            bark_ridge_amp=0.010,
            is_main_trunk=False,
            mat_idx=0,
        )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("Tree_Trunk", mesh)
    obj.data.materials.append(materials["GinkgoBark"])
    bpy.context.scene.collection.objects.link(obj)
    return obj


def add_ginkgo_fan_leaf_3d(
    bm: bmesh.types.BMesh,
    uv_layer,
    origin: Vector,
    forward_dir: Vector,
    up_dir: Vector,
    leaf_length: float = 0.22,
    fan_angle: float = 1.98,
    arch_bend: float = 0.15,
    cup_depth: float = 0.038,
    mat_idx: int = 0,
):
    """
    イチョウ（Ginkgo biloba）特有の
      1. 細長い葉柄（Petiole stalk: v=0.0 -> 0.20）
      2. 扇形に広がる葉身中間アーク（7頂点: v=0.54）
      3. 丸みを帯びた左右2裂片と中央の二股切れ込み（7頂点 Biloba Margin: v=0.70..1.00）
    を右手系直交基底 (fwd, side, up = fwd × side) 上で一貫した表法線 (+up) を持つ
    放射状クアッドメッシュ（18頂点・9面）として生成する。
    """
    fwd = forward_dir.normalized()
    side = up_dir.cross(fwd).normalized()
    if side.length < 1e-4:
        side = Vector((0.0, 0.0, 1.0)).cross(fwd).normalized()
    # 右手系: fwd × side = +up （常に上向き成分を持つ表法線）
    up = fwd.cross(side).normalized()
    if up.z < 0.0:
        side = -side
        up = -up

    def leaf_point(u_norm: float, r_frac: float, width_scale: float, z_offset: float) -> Vector:
        theta = (u_norm - 0.5) * fan_angle * width_scale
        dist = r_frac * leaf_length
        local_x = dist * math.cos(theta)
        local_y = dist * math.sin(theta)
        arch_z = -arch_bend * leaf_length * (r_frac * r_frac)
        cup_z = cup_depth * leaf_length * (1.0 - 4.0 * (u_norm - 0.5) ** 2) * r_frac
        return origin + fwd * local_x + side * local_y + up * (arch_z + cup_z + z_offset)

    # Row 0: 葉柄（茎）の基部 (v = 0.0, 2頂点)
    s0 = bm.verts.new(leaf_point(0.47, 0.00, 0.08, 0.000))
    s1 = bm.verts.new(leaf_point(0.53, 0.00, 0.08, 0.000))
    uv_s0 = Vector((0.47, 0.00))
    uv_s1 = Vector((0.53, 0.00))

    # Row 1: 葉柄から扇形葉身への移行部 (v = 0.20, 2頂点)
    n0 = bm.verts.new(leaf_point(0.42, 0.20, 0.20, 0.003))
    n1 = bm.verts.new(leaf_point(0.58, 0.20, 0.20, 0.003))
    uv_n0 = Vector((0.42, 0.20))
    uv_n1 = Vector((0.58, 0.20))

    # Row 2: 扇形の中間展開アーク (v = 0.54, 7頂点 — Row 3 と 1対1 対応する放射状グリッド)
    m_specs = [
        (0.00, 0.46, 0.84, 0.005),
        (0.17, 0.53, 0.86, 0.002),
        (0.34, 0.56, 0.88, -0.002),
        (0.50, 0.48, 0.88, -0.007),
        (0.66, 0.56, 0.88, -0.002),
        (0.83, 0.53, 0.86, 0.002),
        (1.00, 0.46, 0.84, 0.005),
    ]
    m_verts = []
    m_uvs = []
    for u_val, r_val, w_sc, z_off in m_specs:
        m_verts.append(bm.verts.new(leaf_point(u_val, r_val, w_sc, z_off)))
        m_uvs.append(Vector((u_val, 0.54)))

    # Row 3: 扇形外縁＋中央二股切れ込み (7頂点 — 1対1のクリーンな6枚の放射クアッドを形成)
    o_specs = [
        (0.00, 0.80, 1.00, 0.006, 0.86),  # 0: 左外端
        (0.17, 0.99, 0.97, 0.012, 0.98),  # 1: 左裂片 外ピーク
        (0.34, 1.03, 0.94, 0.008, 1.00),  # 2: 左裂片 内ピーク
        (0.50, 0.65, 0.90, -0.014, 0.68),  # 3: 中央二股切れ込み (Biloba Notch!)
        (0.66, 1.03, 0.94, 0.008, 1.00),  # 4: 右裂片 内ピーク
        (0.83, 0.99, 0.97, 0.012, 0.98),  # 5: 右裂片 外ピーク
        (1.00, 0.80, 1.00, 0.006, 0.86),  # 6: 右外端
    ]
    o_verts = []
    o_uvs = []
    for u_val, r_val, w_sc, z_off, v_uv in o_specs:
        o_verts.append(bm.verts.new(leaf_point(u_val, r_val, w_sc, z_off)))
        o_uvs.append(Vector((u_val, v_uv)))

    def make_leaf_face(v_list, uv_list):
        # [inner_left, outer_left, outer_right, inner_right] -> (outer - inner) × (right - left) = fwd × side = +up
        f = bm.faces.new(v_list)
        f.material_index = mat_idx
        f.smooth = True
        for lp, uv in zip(f.loops, uv_list, strict=True):
            lp[uv_layer].uv = uv

    # 1. 葉柄 (Petiole) クアッド (1面)
    make_leaf_face([s0, n0, n1, s1], [uv_s0, uv_n0, uv_n1, uv_s1])

    # 2. 葉柄先端 (n0, n1) から中間アーク (m_verts[0..6]) への扇展開 (5面)
    make_leaf_face([n0, m_verts[0], m_verts[1]], [uv_n0, m_uvs[0], m_uvs[1]])
    make_leaf_face([n0, m_verts[1], m_verts[2], m_verts[3]], [uv_n0, m_uvs[1], m_uvs[2], m_uvs[3]])
    make_leaf_face([n0, m_verts[3], n1], [uv_n0, m_uvs[3], uv_n1])
    make_leaf_face([n1, m_verts[3], m_verts[4], m_verts[5]], [uv_n1, m_uvs[3], m_uvs[4], m_uvs[5]])
    make_leaf_face([n1, m_verts[5], m_verts[6]], [uv_n1, m_uvs[5], m_uvs[6]])

    # 3. 中間アーク (m_verts[0..6]) から二股外縁 (o_verts[0..6]) への放射状クアッド (6面)
    for k in range(6):
        make_leaf_face(
            [m_verts[k], o_verts[k], o_verts[k + 1], m_verts[k + 1]],
            [m_uvs[k], o_uvs[k], o_uvs[k + 1], m_uvs[k + 1]],
        )


def add_ginkgo_spur_rosette(
    bm: bmesh.types.BMesh,
    uv_layer,
    spur_center: Vector,
    outward_normal: Vector,
    leaf_count: int = 6,
    base_leaf_len: float = 0.22,
    seed: float = 0.0,
    mat_idx: int = 0,
):
    """
    イチョウ特有の短枝（Spur shoot）から輪生・束生する葉束ロゼット（5〜7枚の立体扇形葉ブーケ）を生成。
    """
    n_dir = outward_normal.normalized()
    ref_up = Vector((1.0, 0.0, 0.0)) if abs(n_dir.z) > 0.90 else Vector((0.0, 0.0, 1.0))
    tangent_x = n_dir.cross(ref_up).normalized()
    tangent_y = n_dir.cross(tangent_x).normalized()

    golden_angle = math.radians(137.508)
    for i in range(leaf_count):
        azim = seed * 2.1 + i * golden_angle
        ring_t = (i + 0.5) / leaf_count
        spread_cone = 0.34 + 0.64 * ring_t

        radial_tangent = tangent_x * math.cos(azim) + tangent_y * math.sin(azim)
        leaf_fwd = (
            n_dir * math.cos(spread_cone)
            + radial_tangent * math.sin(spread_cone)
            + Vector((0.0, 0.0, 0.18 - 0.26 * ring_t))
        ).normalized()

        roll_angle = 0.24 * math.sin(seed * 3.7 + i * 1.9)
        leaf_up = (
            n_dir * 0.42 + Vector((0.0, 0.0, 0.88)) + radial_tangent * roll_angle
        ).normalized()

        len_var = base_leaf_len * (0.86 + 0.26 * ((i * 37 + int(seed * 13)) % 7) / 6.0)
        fan_var = 1.92 + 0.22 * math.sin(seed + i * 1.3)
        arch_var = 0.13 + 0.08 * ring_t

        stem_pos = spur_center + radial_tangent * 0.008 + n_dir * (0.007 * (1.0 - ring_t))

        add_ginkgo_fan_leaf_3d(
            bm,
            uv_layer,
            origin=stem_pos,
            forward_dir=leaf_fwd,
            up_dir=leaf_up,
            leaf_length=len_var,
            fan_angle=fan_var,
            arch_bend=arch_var,
            cup_depth=0.04,
            mat_idx=mat_idx,
        )


def add_foliage_cluster_with_leaves(
    bm: bmesh.types.BMesh,
    uv_layer,
    center: Vector,
    radius_xy: float,
    radius_z: float,
    seed_offset: float,
    outer_rosette_count: int = 7,
    inner_rosette_count: int = 3,
    leaves_per_rosette: int = 7,
    mat_idx: int = 0,
):
    """
    球体ブロブを一切使わず、内層ロゼット＋外層ロゼットの2層構造で
    100%「実寸スケール（葉長 8.0cm〜9.8cm）の3Dイチョウ扇形葉」からなる立体葉房クラスタを構築する。
    """
    golden_angle = math.radians(137.508)

    # 1. 内層ロゼット（枝の周囲・クラスタ中心部の密度を作り、向こう側がスカスカに透けるのを防ぐ）
    for r_idx in range(inner_rosette_count):
        t = (r_idx + 0.5) / max(1, inner_rosette_count)
        z_norm = -0.35 + 0.95 * t
        xy_proj = math.sqrt(max(0.1, 1.0 - z_norm * z_norm))
        azim = seed_offset * 1.3 + r_idx * golden_angle * 1.5
        local_dir = Vector(
            (math.cos(azim) * xy_proj, math.sin(azim) * xy_proj, z_norm)
        ).normalized()
        spur_pos = center + Vector(
            (
                local_dir.x * radius_xy * 0.28,
                local_dir.y * radius_xy * 0.28,
                local_dir.z * radius_z * 0.28,
            )
        )
        add_ginkgo_spur_rosette(
            bm,
            uv_layer,
            spur_center=spur_pos,
            outward_normal=local_dir,
            leaf_count=leaves_per_rosette,
            base_leaf_len=0.084 + 0.012 * min(1.0, radius_xy / 0.75),
            seed=seed_offset * 2.1 + r_idx * 2.9,
            mat_idx=mat_idx,
        )

    # 2. 外層ロゼット（クラスタ外周へ立体的に張り出す実寸8.2〜9.8cmの扇形イチョウ葉の束）
    for r_idx in range(outer_rosette_count):
        t = (r_idx + 0.5) / max(1, outer_rosette_count)
        z_norm = -0.55 + 1.42 * t
        z_clamped = max(-0.92, min(0.92, z_norm))
        xy_proj = math.sqrt(max(0.08, 1.0 - z_clamped * z_clamped))
        azim = seed_offset * 1.9 + r_idx * golden_angle

        local_dir = Vector(
            (
                math.cos(azim) * xy_proj,
                math.sin(azim) * xy_proj,
                z_clamped,
            )
        ).normalized()
        spur_pos = center + Vector(
            (
                local_dir.x * radius_xy * 0.58,
                local_dir.y * radius_xy * 0.58,
                local_dir.z * radius_z * 0.58,
            )
        )
        leaf_len = 0.082 + 0.016 * min(1.0, radius_xy / 0.75)

        add_ginkgo_spur_rosette(
            bm,
            uv_layer,
            spur_center=spur_pos,
            outward_normal=local_dir,
            leaf_count=leaves_per_rosette,
            base_leaf_len=leaf_len,
            seed=seed_offset * 3.1 + r_idx * 1.7,
            mat_idx=mat_idx,
        )


def build_tree_foliage(materials) -> bpy.types.Object:
    """
    行幸通りイチョウ並木特有の端正な円錐〜卵形シルエットを持ち、
    なおかつ100%「実寸（約8〜9.8cm）の扇形・二股切れ込みイチョウ葉」が高密度に重なる樹冠メッシュを構築
    """
    mesh = bpy.data.meshes.new("Tree_Foliage_Mesh")
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")

    golden_angle = math.radians(137.508)

    # 1. 主枝・副枝・枝中腹の40箇所の葉房クラスタ + 全小枝先端(90箇所)の直結ロゼット
    _, _, _, branch_foliage_anchors, twig_tip_rosettes = get_branch_skeleton()
    for idx, (center, r_xy, r_z, seed) in enumerate(branch_foliage_anchors):
        is_primary = idx % 4 == 0
        add_foliage_cluster_with_leaves(
            bm,
            uv_layer,
            center=center,
            radius_xy=r_xy * 0.85,
            radius_z=r_z * 0.85,
            seed_offset=seed,
            outer_rosette_count=7 if is_primary else 5,
            inner_rosette_count=3 if is_primary else 2,
            leaves_per_rosette=7,
            mat_idx=0,
        )

    # すべての小枝 (Twigs) の先端に直接イチョウ葉ロゼットを着生させ、枝先が実寸葉束に包まれるようにする
    for tip_pos, tip_dir, tip_seed in twig_tip_rosettes:
        add_ginkgo_spur_rosette(
            bm,
            uv_layer,
            spur_center=tip_pos,
            outward_normal=tip_dir,
            leaf_count=7,
            base_leaf_len=0.088,
            seed=tip_seed,
            mat_idx=0,
        )

    # 2. 樹冠中層〜上層の内部ボリュームと頂部スパイアを満たすクラスタ
    inner_lobes = [
        (Vector((0.12, -0.10, 3.85)), 0.82, 0.66, 0.8),
        (Vector((-0.14, 0.12, 4.45)), 0.88, 0.72, 1.9),
        (Vector((0.10, 0.14, 5.15)), 0.84, 0.72, 3.1),
        (Vector((-0.10, -0.12, 5.85)), 0.76, 0.68, 4.3),
        (Vector((0.06, -0.06, 6.55)), 0.68, 0.64, 5.5),
        (Vector((-0.04, 0.05, 7.20)), 0.56, 0.60, 6.7),
        (Vector((0.00, 0.00, 7.80)), 0.45, 0.54, 7.9),
        (Vector((0.00, 0.00, 8.35)), 0.32, 0.45, 9.1),
    ]
    for center, r_xy, r_z, seed in inner_lobes:
        add_foliage_cluster_with_leaves(
            bm,
            uv_layer,
            center=center,
            radius_xy=r_xy,
            radius_z=r_z,
            seed_offset=seed,
            outer_rosette_count=6,
            inner_rosette_count=3,
            leaves_per_rosette=7,
            mat_idx=0,
        )

    # 3. 樹冠外周シルエット（特にドライバー視点から近い下枝〜中層）に実寸イチョウ扇形葉の房を際立たせる表層リーフブーケ
    accent_layers = [
        (2.65, 1.42, 0.34, 0.28, 7, golden_angle * 0.2),
        (3.40, 1.52, 0.36, 0.30, 7, golden_angle * 0.8),
        (4.25, 1.44, 0.35, 0.30, 6, golden_angle * 1.4),
        (5.15, 1.28, 0.34, 0.28, 6, golden_angle * 2.0),
        (6.10, 1.04, 0.32, 0.26, 4, golden_angle * 2.6),
        (7.15, 0.68, 0.28, 0.24, 3, golden_angle * 3.2),
    ]
    accent_idx = 0
    for z_h, ring_r, c_rxy, c_rz, count, phase in accent_layers:
        for i in range(count):
            ang = phase + (2.0 * math.pi * i) / count
            pos = Vector(
                (
                    math.cos(ang) * ring_r,
                    math.sin(ang) * ring_r,
                    z_h + 0.12 * math.sin(accent_idx * 2.1),
                )
            )
            add_foliage_cluster_with_leaves(
                bm,
                uv_layer,
                center=pos,
                radius_xy=c_rxy,
                radius_z=c_rz,
                seed_offset=12.0 + accent_idx * 1.6,
                outer_rosette_count=5,
                inner_rosette_count=2,
                leaves_per_rosette=7,
                mat_idx=0,
            )
            accent_idx += 1

    bm.normal_update()
    # 各3D扇形葉の純粋な面法線（0.88）を維持しつつ、樹冠中心からの放射法線（0.12）をわずかにブレンド
    canopy_center = Vector((0.0, 0.0, 5.0))
    for v in bm.verts:
        radial = (v.co - canopy_center).normalized()
        v.normal = (v.normal * 0.88 + radial * 0.12).normalized()

    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("Tree_Foliage", mesh)
    obj.data.materials.append(materials["GinkgoFoliage"])
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_tree_guard(materials) -> bpy.types.Object:
    """丸の内・行幸通りの歩道に設置されている実寸 1.4m × 1.4m 御影石縁石＋同心円・放射状鋳鉄製ツリーガードを構築"""
    mesh = bpy.data.meshes.new("Tree_Guard_Mesh")
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")

    # 実寸 1.40m 四方（歩道幅 4.5m 内でボラードと干渉しない東京都道路標準の街路樹保護桝寸法）
    outer_half = 0.70
    inner_half = 0.56
    curb_h = 0.11

    def add_oriented_uv_box(
        center: Vector, dir_x: Vector, dir_y: Vector, size: Vector, mat_idx: int
    ):
        hx, hy, hz = size.x * 0.5, size.y * 0.5, size.z * 0.5
        dx = dir_x.normalized()
        dy = dir_y.normalized()
        dz = Vector((0.0, 0.0, 1.0))

        corners = [
            (-hx, -hy, -hz),
            (hx, -hy, -hz),
            (hx, hy, -hz),
            (-hx, hy, -hz),
            (-hx, -hy, hz),
            (hx, -hy, hz),
            (hx, hy, hz),
            (-hx, hy, hz),
        ]
        verts = [bm.verts.new(center + dx * cx + dy * cy + dz * cz) for cx, cy, cz in corners]
        faces_spec = [
            (verts[4], verts[7], verts[6], verts[5]),
            (verts[0], verts[4], verts[5], verts[1]),
            (verts[2], verts[6], verts[7], verts[3]),
            (verts[0], verts[3], verts[7], verts[4]),
            (verts[1], verts[5], verts[6], verts[2]),
        ]
        for f_v in faces_spec:
            f = bm.faces.new(f_v)
            f.material_index = mat_idx
            for lp, uv in zip(
                f.loops,
                [Vector((0, 0)), Vector((1, 0)), Vector((1, 1)), Vector((0, 1))],
                strict=True,
            ):
                lp[uv_layer].uv = uv

    # 1. 御影石の四角形縁石フレーム
    border_w = outer_half - inner_half
    mid_offset = (outer_half + inner_half) * 0.5
    ux = Vector((1.0, 0.0, 0.0))
    uy = Vector((0.0, 1.0, 0.0))
    add_oriented_uv_box(
        Vector((0.0, -mid_offset, curb_h * 0.5)),
        ux,
        uy,
        Vector((outer_half * 2.0, border_w, curb_h)),
        mat_idx=0,
    )
    add_oriented_uv_box(
        Vector((0.0, mid_offset, curb_h * 0.5)),
        ux,
        uy,
        Vector((outer_half * 2.0, border_w, curb_h)),
        mat_idx=0,
    )
    add_oriented_uv_box(
        Vector((-mid_offset, 0.0, curb_h * 0.5)),
        ux,
        uy,
        Vector((border_w, inner_half * 2.0, curb_h)),
        mat_idx=0,
    )
    add_oriented_uv_box(
        Vector((mid_offset, 0.0, curb_h * 0.5)),
        ux,
        uy,
        Vector((border_w, inner_half * 2.0, curb_h)),
        mat_idx=0,
    )

    # 2. 鋳鉄製ツリーガード格子（3重の同心円リング + 16本の放射状リブバー）
    seg_count = 24
    for ring_r in [0.33, 0.43, 0.53]:
        arc_len = (2.0 * math.pi * ring_r) / seg_count * 1.06
        for s in range(seg_count):
            ang = (2.0 * math.pi * s) / seg_count
            radial_dir = Vector((math.cos(ang), math.sin(ang), 0.0))
            tangent_dir = Vector((-math.sin(ang), math.cos(ang), 0.0))
            center = radial_dir * ring_r + Vector((0.0, 0.0, 0.035))
            add_oriented_uv_box(
                center,
                tangent_dir,
                radial_dir,
                Vector((arc_len, 0.036, 0.042)),
                mat_idx=1,
            )

    radial_bars = 16
    for b in range(radial_bars):
        ang = (2.0 * math.pi * b) / radial_bars
        radial_dir = Vector((math.cos(ang), math.sin(ang), 0.0))
        tangent_dir = Vector((-math.sin(ang), math.cos(ang), 0.0))
        center = radial_dir * 0.43 + Vector((0.0, 0.0, 0.035))
        add_oriented_uv_box(
            center, radial_dir, tangent_dir, Vector((0.24, 0.032, 0.040)), mat_idx=1
        )

    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("Tree_Guard", mesh)
    obj.data.materials.append(materials["GraniteCurb"])
    obj.data.materials.append(materials["TreeGuardIron"])
    bpy.context.scene.collection.objects.link(obj)
    return obj


def generate_street_tree():
    """行幸通りイチョウ街路樹を生成し GLB 形式でエクスポート"""
    clean_scene()
    materials = setup_materials()

    root = bpy.data.objects.new("GinkgoTreeRoot", None)
    root.empty_display_type = "ARROWS"
    root.empty_display_size = 1.0
    bpy.context.scene.collection.objects.link(root)

    trunk_obj = build_tree_trunk(materials)
    trunk_obj.parent = root

    foliage_obj = build_tree_foliage(materials)
    foliage_obj.parent = root

    guard_obj = build_tree_guard(materials)
    guard_obj.parent = root

    print(
        "High-precision Street Tree (Ginkgo Biloba with Real-Scale 3D Fan Leaves) modeling complete! Hierarchy created:"
    )
    for obj in bpy.data.objects:
        p_name = obj.parent.name if obj.parent else "None"
        v_cnt = len(obj.data.vertices) if obj.type == "MESH" else 0
        f_cnt = len(obj.data.polygons) if obj.type == "MESH" else 0
        print(
            f"  - {obj.name} (Type: {obj.type}, Parent: {p_name}, Verts: {v_cnt}, Faces: {f_cnt})"
        )

    script_file = globals().get("__file__")
    repo_root = (
        os.path.abspath(os.path.join(os.path.dirname(script_file), "../.."))
        if script_file
        else "/Users/kei/ghq/github.com/kexi/antigravity-deep-drive"
    )
    out_dir = os.path.join(repo_root, "apps/web/public/models")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "street_tree.glb")

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
        f"Successfully exported Street Tree model to: {out_path} ({os.path.getsize(out_path):,} bytes)"
    )


if __name__ == "__main__":
    generate_street_tree()

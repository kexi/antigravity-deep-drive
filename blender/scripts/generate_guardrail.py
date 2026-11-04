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
Blender Procedural Modeling Script: 日本標準ガードレール (JIS G 3193 / 国土交通省『防護柵の設置基準』準拠 Wビーム波形鋼板防護柵)
Tokyo Station Deep Drive 用 3D アセット生成

高精度モデリング仕様 (実写リファレンス準拠・実寸 1 Unit = 1.0m・360度全方位レビュー対応版):
- 全長 6.0m (支柱間隔 2.0m × 3スパン、両端巻き込み袖ビーム含め全長約 6.90m)、ビーム中心高さ Z = 0.630m (上端高さ 0.805m)
- Guardrail_WBeam (JIS G 3193 2山波形断面 Wビーム):
  - 高さ 350mm (Z = 0.455m 〜 0.805m)、波形奥行 94mm (X = +0.092m 〜 +0.186m)、板厚 6mm の表裏ソリッド2山波形リブ断面
  - 上下端のカール折り返しリップ、支柱位置でのビーム重ね継手（スプライス段差）を再現
- Guardrail_Sleeve_Ends (日本特有の巻き込み型端末袖ビーム / そでビーム):
  - 両端支柱 (Y = ±3.0m) から外側へ張り出し、4本の大径丸頭ボルト留めオーバーラップ部で2山W断面から単一緩曲面へ遷移しつつ
    上下幅が 350mm → 410mm へ緩やかなS字カーブでフレア拡大し、歩道側 (-X) へ 180度 U字状に巻き込む実写通りの立体曲面造形
- Guardrail_Posts (円形鋼管支柱 φ114.3mm + ドームキャップ + 黄色反射テープ帯 + 根元モルタル保護目地リング):
  - Y = -3.0m, -1.0m, +1.0m, +3.0m の4本配置 (外径 114.3mm / 半径 0.0572m)
  - 頂部の緩やかな球面ドームキャップ＋中央ひし形刻印レリーフ（実写上面ビュー準拠）
  - ビーム下端直下 (Z = 0.310m 〜 0.348m) に巻かれた高輝度イエロー反射テープ帯
  - 地際 (Z = 0.000m 〜 0.018m) の円形モルタル充填リング
- Guardrail_Brackets_Bolts (Ω型緩衝ブラケット + 丸頭スプライスボルト + 背面六角ナット＆突出ボルトねじ山):
  - 支柱前面とWビーム背面を繋ぐハット型（台形Ω断面）板金ブラケット（上面から見た中空折り曲げ形状を完全再現）
  - 車道側 (+X) の丸頭（マッシュルームヘッド）スプライスボルト列（袖ビーム部4本×2、中間継手部8本＋中央谷部固定ボルト）
  - 歩道側 (-X) 裏面に突き出た六角ナット・座金・ボルトねじ山スタッド
- Guardrail_Delineators (支柱頂部 視線誘導標 / デリネーター):
  - 両端支柱頂部に取付金具ステムを介して設置された円形デリネーター（ダークメタル筐体＋前後両面の高輝度オレンジ/ホワイト反射レンズ）

階層構造:
GuardrailRoot (Empty)
├── Guardrail_WBeam (メッシュ: JIS 2山波形Wビーム本体)
├── Guardrail_Sleeve_Ends (メッシュ: 両端の180度巻き込み型袖ビーム)
├── Guardrail_Posts (メッシュ: φ114.3mm 鋼管支柱4本・ドームキャップ・黄色反射帯・根元モルタルリング)
├── Guardrail_Brackets_Bolts (メッシュ: Ω型緩衝ブラケット・丸頭スプライスボルト・背面六角ナット＆ねじ山)
└── Guardrail_Delineators (メッシュ: 支柱頂部の円形デリネーター反射器)
"""

import math
import os

import bpy

# isort: split
# Why not: bpy 単体 wheel (PyPI) では import bpy 実行時に初めて bmesh / mathutils が
# sys.modules に登録されるため、アルファベット順で bmesh を先に import すると ModuleNotFoundError になる。
import bmesh
from mathutils import Vector


def clean_scene() -> None:
    """既存のシーン内オブジェクト・メッシュ・マテリアルを全消去して初期化する"""
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh, do_unlink=True)
    for mat in list(bpy.data.materials):
        bpy.data.materials.remove(mat, do_unlink=True)


def create_pbr_material(
    name: str,
    base_color: tuple[float, float, float, float] = (1.0, 1.0, 1.0, 1.0),
    metallic: float = 0.0,
    roughness: float = 0.5,
    coat_weight: float = 0.0,
    emission_color: tuple[float, float, float, float] | None = None,
    emission_strength: float = 0.0,
) -> bpy.types.Material:
    """Principled BSDF PBRマテリアルを作成する"""
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")

    if "Base Color" in bsdf.inputs:
        bsdf.inputs["Base Color"].default_value = base_color
    if "Metallic" in bsdf.inputs:
        bsdf.inputs["Metallic"].default_value = metallic
    if "Roughness" in bsdf.inputs:
        bsdf.inputs["Roughness"].default_value = roughness
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = coat_weight
    if emission_color is not None and "Emission Color" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = emission_color
    if "Emission Strength" in bsdf.inputs:
        bsdf.inputs["Emission Strength"].default_value = emission_strength

    return mat


def setup_materials() -> dict[str, bpy.types.Material]:
    """日本標準ガードレール用 PBR マテリアル一式を定義する"""
    return {
        # 白色静電粉体塗装（日本の一般的な白ガードレール：わずかに青みのある高光沢ホワイト塗装鋼板）
        "GuardrailWhitePaint": create_pbr_material(
            "GuardrailWhitePaint",
            base_color=(0.93, 0.95, 0.97, 1.0),
            metallic=0.18,
            roughness=0.24,
            coat_weight=0.65,
        ),
        # 溶融亜鉛めっき鋼材（スプライスボルト・背面六角ナット・ワッシャー・取付金具）
        "GalvanizedSteel": create_pbr_material(
            "GalvanizedSteel",
            base_color=(0.64, 0.67, 0.71, 1.0),
            metallic=0.86,
            roughness=0.34,
        ),
        # 支柱下部の黄色高輝度反射テープ帯（実写の鮮やかなアンバーイエロー）
        "ReflectiveYellowBand": create_pbr_material(
            "ReflectiveYellowBand",
            base_color=(0.96, 0.68, 0.04, 1.0),
            metallic=0.15,
            roughness=0.22,
            coat_weight=0.80,
            emission_color=(0.96, 0.68, 0.04, 1.0),
            emission_strength=0.18,
        ),
        # 支柱根元のモルタル保護目地リング
        "ConcreteCollar": create_pbr_material(
            "ConcreteCollar",
            base_color=(0.56, 0.58, 0.60, 1.0),
            metallic=0.04,
            roughness=0.84,
        ),
        # デリネーター（視線誘導標）ダークメタル筐体・ステー
        "DelineatorHousing": create_pbr_material(
            "DelineatorHousing",
            base_color=(0.14, 0.16, 0.19, 1.0),
            metallic=0.72,
            roughness=0.38,
        ),
        # デリネーター高輝度オレンジ再帰反射レンズ（コーナーキューブ・マイクロプリズム）
        "DelineatorAmber": create_pbr_material(
            "DelineatorAmber",
            base_color=(1.0, 0.42, 0.02, 1.0),
            metallic=0.35,
            roughness=0.10,
            coat_weight=1.0,
            emission_color=(1.0, 0.48, 0.04, 1.0),
            emission_strength=1.35,
        ),
        # デリネーター白色再帰反射レンズ（コーナーキューブ・マイクロプリズム）
        "DelineatorWhite": create_pbr_material(
            "DelineatorWhite",
            base_color=(0.98, 0.99, 1.0, 1.0),
            metallic=0.38,
            roughness=0.08,
            coat_weight=1.0,
            emission_color=(0.98, 0.99, 1.0, 1.0),
            emission_strength=1.25,
        ),
    }


def get_wbeam_profile_points(z_center: float = 0.630) -> list[tuple[float, float]]:
    """
    JIS G 3193 2山波形ガードレール（Wビーム）の断面プロファイル (x, z) を下端から上端まで19点で返す。
    +X が車道側（表面）、-X が支柱・歩道側（裏面）。
    高さ 350mm (z_center ± 0.175m)、波形深さ 94mm (x = 0.092m 〜 0.186m)。
    """
    raw_offsets = [
        (0.092, -0.175),  # 0: 下端カールリップ先端
        (0.104, -0.166),  # 1: 下端リップ折れ部
        (0.132, -0.146),  # 2: 下段外側スロープ下部
        (0.162, -0.124),  # 3: 下段外側スロープ上部
        (0.181, -0.104),  # 4: 下段クレスト（山）下肩
        (0.186, -0.088),  # 5: 下段クレスト頂点
        (0.181, -0.072),  # 6: 下段クレスト上肩
        (0.152, -0.048),  # 7: 下段内側スロープ
        (0.114, -0.024),  # 8: 中央谷部（トラフ）下肩
        (0.096, -0.011),  # 9: 中央谷部底面下端
        (0.095, 0.000),  # 10: 中央谷部中心（ボルト座面）
        (0.096, 0.011),  # 11: 中央谷部底面上端
        (0.114, 0.024),  # 12: 中央谷部上肩
        (0.152, 0.048),  # 13: 上段内側スロープ
        (0.181, 0.072),  # 14: 上段クレスト下肩
        (0.186, 0.088),  # 15: 上段クレスト頂点
        (0.181, 0.104),  # 16: 上段クレスト上肩
        (0.162, 0.124),  # 17: 上段外側スロープ下部
        (0.132, 0.146),  # 18: 上段外側スロープ上部
        (0.104, 0.166),  # 19: 上端リップ折れ部
        (0.092, 0.175),  # 20: 上端カールリップ先端
    ]
    return [(x, z_center + dz) for x, dz in raw_offsets]


def add_lofted_thick_sheet(
    bm: bmesh.types.BMesh,
    uv_layer,
    section_rings: list[list[tuple[Vector, Vector]]],
    thickness: float = 0.006,
    mat_idx: int = 0,
) -> None:
    """
    断面リスト section_rings (各要素は [(表側座標 Vector, 厚み方向法線 Vector), ...]) をロフト接続し、
    表裏両面＋上下縁＋前後端キャップを持つソリッド板金メッシュを生成する。
    """
    num_rings = len(section_rings)
    num_pts = len(section_rings[0])

    front_grid: list[list[bmesh.types.BMVert]] = []
    back_grid: list[list[bmesh.types.BMVert]] = []

    for r_idx in range(num_rings):
        f_row = []
        b_row = []
        for p_idx in range(num_pts):
            pos, nrm = section_rings[r_idx][p_idx]
            v_front = bm.verts.new(pos)
            v_back = bm.verts.new(pos - nrm * thickness)
            f_row.append(v_front)
            b_row.append(v_back)
        front_grid.append(f_row)
        back_grid.append(b_row)

    for r_idx in range(num_rings - 1):
        u0 = r_idx / max(1, num_rings - 1)
        u1 = (r_idx + 1) / max(1, num_rings - 1)
        for p_idx in range(num_pts - 1):
            v0 = p_idx / max(1, num_pts - 1)
            v1 = (p_idx + 1) / max(1, num_pts - 1)

            # 表面 (+X 側)
            f_face = bm.faces.new(
                [
                    front_grid[r_idx][p_idx],
                    front_grid[r_idx + 1][p_idx],
                    front_grid[r_idx + 1][p_idx + 1],
                    front_grid[r_idx][p_idx + 1],
                ]
            )
            f_face.material_index = mat_idx
            f_face.smooth = True
            for loop, uv in zip(
                f_face.loops,
                [(u0, v0), (u1, v0), (u1, v1), (u0, v1)],
                strict=True,
            ):
                loop[uv_layer].uv = uv

            # 裏面 (-X 側)
            b_face = bm.faces.new(
                [
                    back_grid[r_idx][p_idx + 1],
                    back_grid[r_idx + 1][p_idx + 1],
                    back_grid[r_idx + 1][p_idx],
                    back_grid[r_idx][p_idx],
                ]
            )
            b_face.material_index = mat_idx
            b_face.smooth = True
            for loop, uv in zip(
                b_face.loops,
                [(u0, v1), (u1, v1), (u1, v0), (u0, v0)],
                strict=True,
            ):
                loop[uv_layer].uv = uv

        # 下縁 (p_idx = 0) と 上縁 (p_idx = num_pts - 1) の厚み側面
        bot_face = bm.faces.new(
            [
                back_grid[r_idx][0],
                back_grid[r_idx + 1][0],
                front_grid[r_idx + 1][0],
                front_grid[r_idx][0],
            ]
        )
        bot_face.material_index = mat_idx
        bot_face.smooth = False

        top_face = bm.faces.new(
            [
                front_grid[r_idx][num_pts - 1],
                front_grid[r_idx + 1][num_pts - 1],
                back_grid[r_idx + 1][num_pts - 1],
                back_grid[r_idx][num_pts - 1],
            ]
        )
        top_face.material_index = mat_idx
        top_face.smooth = False

    # 始端 (r_idx = 0) と 終端 (r_idx = num_rings - 1) の端面キャップ
    for p_idx in range(num_pts - 1):
        start_cap = bm.faces.new(
            [
                back_grid[0][p_idx],
                front_grid[0][p_idx],
                front_grid[0][p_idx + 1],
                back_grid[0][p_idx + 1],
            ]
        )
        start_cap.material_index = mat_idx
        start_cap.smooth = False

        end_cap = bm.faces.new(
            [
                front_grid[-1][p_idx],
                back_grid[-1][p_idx],
                back_grid[-1][p_idx + 1],
                front_grid[-1][p_idx + 1],
            ]
        )
        end_cap.material_index = mat_idx
        end_cap.smooth = False


def build_wbeam_mesh(
    materials: dict[str, bpy.types.Material],
    post_y_positions: list[float],
) -> bpy.types.Object:
    """JIS G 3193 2山波形 Wビーム本体メッシュを構築する（3スパン・継手オーバーラップ段差付き）"""
    mesh = bpy.data.meshes.new("Guardrail_WBeamMesh")
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")

    profile_xz = get_wbeam_profile_points(z_center=0.630)
    y_start = post_y_positions[0]
    y_end = post_y_positions[-1]

    # スパン方向に高密度分割し、支柱継手部 (y = -1.0, +1.0) でビーム重ね合わせの微小段差 (2.5mm) を付与
    num_y_steps = 48
    section_rings: list[list[tuple[Vector, Vector]]] = []
    nrm_x = Vector((1.0, 0.0, 0.0))

    for i in range(num_y_steps + 1):
        t = i / num_y_steps
        y = y_start + (y_end - y_start) * t

        # 中間支柱 (y = -1.0m, +1.0m) 前後 ±0.16m のスプライス重ね継手膨らみ
        splice_bump = 0.0
        for py in post_y_positions[1:-1]:
            dist_y = abs(y - py)
            if dist_y < 0.16:
                splice_bump = 0.0028 * math.cos((dist_y / 0.16) * (math.pi * 0.5))

        ring: list[tuple[Vector, Vector]] = []
        for x, z in profile_xz:
            ring.append((Vector((x + splice_bump, y, z)), nrm_x))
        section_rings.append(ring)

    add_lofted_thick_sheet(bm, uv_layer, section_rings, thickness=0.006, mat_idx=0)

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("Guardrail_WBeam", mesh)
    obj.data.materials.append(materials["GuardrailWhitePaint"])
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_single_sleeve_terminal(
    bm: bmesh.types.BMesh,
    uv_layer,
    end_post_y: float,
    dir_sign: float,
    z_center: float = 0.630,
) -> None:
    """
    片側の巻き込み型端末袖ビーム（そでビーム）を生成する。
    実写（ref_jp_guardrail_white_1〜4.jpg）の通り：
    1. 端支柱の手前 (|y| = 2.75m 〜 3.00m) でWビーム表面とオーバーラップしながら、
       2山のW字波形から滑らかな単一凸曲面へ遷移し、かつ上下幅が 350mm → 406mm へS字カーブでフレア拡大する。
    2. 端支柱の外側 (|y| = 3.00m 〜 3.45m) で歩道側 (-X) へ向かって半径約 0.165m の 180度 U字曲線を描いて巻き込む。
    """
    w_profile = get_wbeam_profile_points(z_center=z_center)
    num_pts = len(w_profile)

    # パラメータ s ∈ [0, 1] に沿って袖ビームの中心軌道・法線・断面形状を定義
    # Stage A (0.0 -> 0.35): 直線オーバーラップ＆フレア遷移区間 (y_offset = -0.24m -> +0.06m)
    # Stage B (0.35 -> 1.0): 180度 Uターン巻き込み曲線区間 (angle = 0 -> pi)
    num_steps = 28
    section_rings: list[list[tuple[Vector, Vector]]] = []

    arc_center_x = 0.020
    arc_center_y = end_post_y + dir_sign * 0.060
    arc_radius_x = 0.168
    arc_radius_y = 0.360

    for step in range(num_steps + 1):
        s = step / num_steps

        if s <= 0.34:
            # オーバーラップ＆フレア遷移区間（端支柱 Y=±3.0m の手前 0.24m から外側 0.04m まで）
            local_t = s / 0.34
            # 滑らかなエルミート補間 (smoothstep): s=0.22 付近（第2ボルト列の直後）でW波形から単一凸シェルへ遷移完了
            morph_t = min(1.0, local_t / 0.72)
            morph = morph_t * morph_t * (3.0 - 2.0 * morph_t)
            y_pos = end_post_y + dir_sign * (-0.240 + 0.280 * local_t)
            base_x = arc_center_x + arc_radius_x
            out_nrm = Vector((1.0, 0.0, 0.0))
        else:
            # 180度 U字巻き込み区間
            curve_t = (s - 0.34) / 0.66
            morph = 1.0
            theta = curve_t * math.pi  # 0 (車道側 +X) -> pi/2 (先端 ±Y) -> pi (歩道側 -X)
            base_x = arc_center_x + arc_radius_x * math.cos(theta)
            y_pos = arc_center_y + dir_sign * (arc_radius_y * math.sin(theta))
            out_nrm = Vector((math.cos(theta), dir_sign * math.sin(theta), 0.0)).normalized()

        # 断面高さのフレア倍率（350mm -> 406mm、先端巻き込み部で実写通りの堂々とした丸みを作る）
        height_scale = 1.0 + 0.16 * morph

        ring: list[tuple[Vector, Vector]] = []
        for p_idx, (wx, wz) in enumerate(w_profile):
            v_frac = (p_idx / (num_pts - 1)) * 2.0 - 1.0  # -1.0 (下端) .. +1.0 (上端)
            dz = (wz - z_center) * height_scale

            # W字の凹凸量 (wx - 0.186: クレスト頂点 x=0.186m を基準 0.0 とする)
            w_rel_x = wx - 0.186

            # 単一凸アーチ断面（クレスト部では +0.002m 外側を覆い、上下端で内側へカールする袖ビームシェル断面）
            arch_profile = 0.004 * math.cos(v_frac * math.pi * 0.42)
            if abs(v_frac) > 0.82:
                lip_t = (abs(v_frac) - 0.82) / 0.18
                arch_profile -= 0.032 * (lip_t * lip_t)

            rel_depth = (1.0 - morph) * w_rel_x + morph * arch_profile
            # オーバーラップ部でWビーム本体 (クレスト x=0.186m) の外側 (+0.0055m) に確実に被さるように配置
            pt_world = Vector((base_x, y_pos, z_center + dz)) + out_nrm * (rel_depth + 0.0035)
            ring.append((pt_world, out_nrm))

        # dir_sign < 0 のときは法線向きを揃えるためリング順序を制御
        section_rings.append(ring)

    if dir_sign < 0:
        section_rings.reverse()

    add_lofted_thick_sheet(bm, uv_layer, section_rings, thickness=0.006, mat_idx=0)


def build_sleeve_ends_mesh(
    materials: dict[str, bpy.types.Material],
    post_y_positions: list[float],
) -> bpy.types.Object:
    """両端（始端 Y=-3.0m・終端 Y=+3.0m）の巻き込み型袖ビームを構築する"""
    mesh = bpy.data.meshes.new("Guardrail_Sleeve_EndsMesh")
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")

    build_single_sleeve_terminal(bm, uv_layer, end_post_y=post_y_positions[0], dir_sign=-1.0)
    build_single_sleeve_terminal(bm, uv_layer, end_post_y=post_y_positions[-1], dir_sign=1.0)

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("Guardrail_Sleeve_Ends", mesh)
    obj.data.materials.append(materials["GuardrailWhitePaint"])
    bpy.context.scene.collection.objects.link(obj)
    return obj


def add_cylinder_segment(
    bm: bmesh.types.BMesh,
    center_xy: tuple[float, float],
    z_bottom: float,
    z_top: float,
    r_bottom: float,
    r_top: float,
    segments: int = 24,
    cap_bottom: bool = False,
    cap_top: bool = False,
    mat_idx: int = 0,
    smooth: bool = True,
) -> None:
    """指定されたZ範囲と上下半径で円筒または円錐台セグメントを追加する"""
    cx, cy = center_xy
    bot_verts = []
    top_verts = []
    for s in range(segments):
        ang = (2.0 * math.pi * s) / segments
        ca, sa = math.cos(ang), math.sin(ang)
        bot_verts.append(bm.verts.new((cx + ca * r_bottom, cy + sa * r_bottom, z_bottom)))
        top_verts.append(bm.verts.new((cx + ca * r_top, cy + sa * r_top, z_top)))

    for s in range(segments):
        ns = (s + 1) % segments
        f = bm.faces.new([bot_verts[s], bot_verts[ns], top_verts[ns], top_verts[s]])
        f.material_index = mat_idx
        f.smooth = smooth

    if cap_bottom:
        fb = bm.faces.new(list(reversed(bot_verts)))
        fb.material_index = mat_idx
        fb.smooth = False
    if cap_top:
        ft = bm.faces.new(top_verts)
        ft.material_index = mat_idx
        ft.smooth = False


def build_posts_mesh(
    materials: dict[str, bpy.types.Material],
    post_y_positions: list[float],
) -> bpy.types.Object:
    """
    φ114.3mm 円形鋼管支柱4本 + 球面ドームキャップ + 黄色高輝度反射テープ帯 + 根元モルタルリングを構築する。
    マテリアルスロット:
      0: GuardrailWhitePaint (支柱本体・ドームキャップ)
      1: ReflectiveYellowBand (支柱中腹の黄色反射テープ帯)
      2: ConcreteCollar (地際の円形モルタル目地リング)
    """
    mesh = bpy.data.meshes.new("Guardrail_PostsMesh")
    bm = bmesh.new()

    post_radius = 0.0572  # JIS φ114.3mm 鋼管

    for py in post_y_positions:
        # 1. 根元モルタル充填カラー (Z = 0.000m .. 0.018m)
        add_cylinder_segment(
            bm,
            center_xy=(0.0, py),
            z_bottom=0.000,
            z_top=0.018,
            r_bottom=0.096,
            r_top=0.066,
            segments=24,
            cap_bottom=True,
            cap_top=True,
            mat_idx=2,
            smooth=True,
        )

        # 2. 円形鋼管支柱本体 (Z = 0.015m .. 0.816m)
        add_cylinder_segment(
            bm,
            center_xy=(0.0, py),
            z_bottom=0.015,
            z_top=0.816,
            r_bottom=post_radius,
            r_top=post_radius,
            segments=24,
            cap_bottom=False,
            cap_top=False,
            mat_idx=0,
            smooth=True,
        )

        # 3. 黄色高輝度反射テープ帯 (実写 ref_jp_guardrail_white_1/4.jpg 準拠: Wビーム下端の少し下 Z = 0.315m .. 0.352m)
        add_cylinder_segment(
            bm,
            center_xy=(0.0, py),
            z_bottom=0.315,
            z_top=0.352,
            r_bottom=post_radius + 0.0012,
            r_top=post_radius + 0.0012,
            segments=24,
            cap_bottom=True,
            cap_top=True,
            mat_idx=1,
            smooth=True,
        )

        # 4. 支柱頭部の球面ドームキャップ (実写 ref_jp_guardrail_white_2.jpg 準拠: 4段ドーム + 中央ひし形刻印)
        dome_rings = [
            (0.816, 0.822, post_radius + 0.0022, post_radius + 0.0018),
            (0.822, 0.829, post_radius + 0.0018, post_radius * 0.78),
            (0.829, 0.835, post_radius * 0.78, post_radius * 0.42),
            (0.835, 0.839, post_radius * 0.42, 0.008),
        ]
        for idx, (zb, zt, rb, rt) in enumerate(dome_rings):
            add_cylinder_segment(
                bm,
                center_xy=(0.0, py),
                z_bottom=zb,
                z_top=zt,
                r_bottom=rb,
                r_top=rt,
                segments=24,
                cap_bottom=(idx == 0),
                cap_top=(idx == len(dome_rings) - 1),
                mat_idx=0,
                smooth=True,
            )

        # キャップ中央のひし形メーカー刻印レリーフ (ref_jp_guardrail_white_2.jpg)
        add_cylinder_segment(
            bm,
            center_xy=(0.0, py),
            z_bottom=0.838,
            z_top=0.8405,
            r_bottom=0.009,
            r_top=0.007,
            segments=4,
            cap_bottom=False,
            cap_top=True,
            mat_idx=0,
            smooth=False,
        )

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("Guardrail_Posts", mesh)
    obj.data.materials.append(materials["GuardrailWhitePaint"])
    obj.data.materials.append(materials["ReflectiveYellowBand"])
    obj.data.materials.append(materials["ConcreteCollar"])
    bpy.context.scene.collection.objects.link(obj)
    return obj


def add_extruded_xy_strip(
    bm: bmesh.types.BMesh,
    xy_points: list[tuple[float, float]],
    z_min: float,
    z_max: float,
    thickness: float = 0.0045,
    mat_idx: int = 0,
) -> None:
    """
    XY平面上の折れ線 xy_points に板厚 thickness を与え、Z方向 (z_min .. z_max) に押し出した板金パーツを追加する。
    実写 ref_jp_guardrail_white_2.jpg の上から見たΩ型（ハット断面）緩衝ブラケットの造形に使用。
    """
    n_pts = len(xy_points)
    normals_xy: list[tuple[float, float]] = []
    for i in range(n_pts):
        if i == 0:
            dx = xy_points[1][0] - xy_points[0][0]
            dy = xy_points[1][1] - xy_points[0][1]
        elif i == n_pts - 1:
            dx = xy_points[-1][0] - xy_points[-2][0]
            dy = xy_points[-1][1] - xy_points[-2][1]
        else:
            dx = xy_points[i + 1][0] - xy_points[i - 1][0]
            dy = xy_points[i + 1][1] - xy_points[i - 1][1]
        length = max(1e-6, math.hypot(dx, dy))
        normals_xy.append((-dy / length, dx / length))

    z_levels = [z_min, z_max]
    front_rows = []
    back_rows = []
    for z in z_levels:
        f_row = []
        b_row = []
        for (px, py), (nx, ny) in zip(xy_points, normals_xy, strict=True):
            f_row.append(
                bm.verts.new((px + nx * (thickness * 0.5), py + ny * (thickness * 0.5), z))
            )
            b_row.append(
                bm.verts.new((px - nx * (thickness * 0.5), py - ny * (thickness * 0.5), z))
            )
        front_rows.append(f_row)
        back_rows.append(b_row)

    for i in range(n_pts - 1):
        # 表面・裏面
        f1 = bm.faces.new(
            [front_rows[0][i], front_rows[0][i + 1], front_rows[1][i + 1], front_rows[1][i]]
        )
        f2 = bm.faces.new(
            [back_rows[0][i + 1], back_rows[0][i], back_rows[1][i], back_rows[1][i + 1]]
        )
        # 上端・下端の板厚面
        f_top = bm.faces.new(
            [front_rows[1][i], front_rows[1][i + 1], back_rows[1][i + 1], back_rows[1][i]]
        )
        f_bot = bm.faces.new(
            [back_rows[0][i], back_rows[0][i + 1], front_rows[0][i + 1], front_rows[0][i]]
        )
        for f in (f1, f2, f_top, f_bot):
            f.material_index = mat_idx
            f.smooth = False

    # 左右端キャップ
    f_left = bm.faces.new([back_rows[0][0], front_rows[0][0], front_rows[1][0], back_rows[1][0]])
    f_right = bm.faces.new(
        [front_rows[0][-1], back_rows[0][-1], back_rows[1][-1], front_rows[1][-1]]
    )
    f_left.material_index = mat_idx
    f_right.material_index = mat_idx


def add_splice_bolt_and_nut(
    bm: bmesh.types.BMesh,
    x_front_surface: float,
    y: float,
    z: float,
    head_radius: float = 0.015,
    x_back_override: float | None = None,
    include_back_nut: bool = True,
    mat_idx: int = 1,
) -> None:
    """
    車道側 (+X) の丸頭（マッシュルームヘッド）スプライスボルトと、
    歩道側 (-X) 裏面の六角ナット・ワッシャー・突出ねじ山スタッドを生成する（ref_jp_guardrail_white_2/3/4.jpg 準拠）。
    """
    # 1. 車道側 (+X) のドーム型丸頭ボルトヘッド (X軸方向に突出)
    segments = 12
    ring0 = []
    ring1 = []
    ring2 = []
    for s in range(segments):
        ang = (2.0 * math.pi * s) / segments
        cy = y + math.cos(ang) * head_radius
        cz = z + math.sin(ang) * head_radius
        ring0.append(bm.verts.new((x_front_surface - 0.001, cy, cz)))
        ring1.append(
            bm.verts.new(
                (
                    x_front_surface + 0.0055,
                    y + math.cos(ang) * (head_radius * 0.82),
                    z + math.sin(ang) * (head_radius * 0.82),
                )
            )
        )
        ring2.append(
            bm.verts.new(
                (
                    x_front_surface + 0.0095,
                    y + math.cos(ang) * (head_radius * 0.35),
                    z + math.sin(ang) * (head_radius * 0.35),
                )
            )
        )

    for s in range(segments):
        ns = (s + 1) % segments
        fa = bm.faces.new([ring0[s], ring0[ns], ring1[ns], ring1[s]])
        fb = bm.faces.new([ring1[s], ring1[ns], ring2[ns], ring2[s]])
        fa.material_index = mat_idx
        fb.material_index = mat_idx
        fa.smooth = True
        fb.smooth = True

    f_cap = bm.faces.new(ring2)
    f_cap.material_index = mat_idx
    f_cap.smooth = True

    if not include_back_nut:
        return

    # 2. 裏面 (-X 側) のワッシャー + 六角ナット + 突出ボルトねじ山 (ref_jp_guardrail_white_2.jpg)
    x_back = x_back_override if x_back_override is not None else (x_front_surface - 0.006)
    hex_r = 0.013
    stud_r = 0.0075

    # 六角ナット (6角柱: x_back - 0.012 .. x_back)
    nut_front = []
    nut_back = []
    for s in range(6):
        ang = (2.0 * math.pi * s) / 6
        cy = y + math.cos(ang) * hex_r
        cz = z + math.sin(ang) * hex_r
        nut_front.append(bm.verts.new((x_back, cy, cz)))
        nut_back.append(bm.verts.new((x_back - 0.012, cy, cz)))

    for s in range(6):
        ns = (s + 1) % 6
        fn = bm.faces.new([nut_front[s], nut_back[s], nut_back[ns], nut_front[ns]])
        fn.material_index = mat_idx
        fn.smooth = False
    fn_cap = bm.faces.new(list(reversed(nut_back)))
    fn_cap.material_index = mat_idx

    # 突出ねじ山スタッド (x_back - 0.026 .. x_back - 0.012)
    stud_front = []
    stud_back = []
    for s in range(10):
        ang = (2.0 * math.pi * s) / 10
        cy = y + math.cos(ang) * stud_r
        cz = z + math.sin(ang) * stud_r
        stud_front.append(bm.verts.new((x_back - 0.012, cy, cz)))
        stud_back.append(bm.verts.new((x_back - 0.026, cy, cz)))

    for s in range(10):
        ns = (s + 1) % 10
        fs = bm.faces.new([stud_front[s], stud_back[s], stud_back[ns], stud_front[ns]])
        fs.material_index = mat_idx
        fs.smooth = True
    fs_cap = bm.faces.new(list(reversed(stud_back)))
    fs_cap.material_index = mat_idx


def build_brackets_and_bolts_mesh(
    materials: dict[str, bpy.types.Material],
    post_y_positions: list[float],
) -> bpy.types.Object:
    """
    実写 ref_jp_guardrail_white_2.jpg の上面図に完全準拠した
    Ω型（ハット断面）板金ブラケット、支柱締結六角ボルト、および丸頭スプライスボルト群を構築する。
    マテリアルスロット:
      0: GuardrailWhitePaint (塗装ブラケット本体)
      1: GalvanizedSteel (ボルト・ナット・ねじ山)
    """
    mesh = bpy.data.meshes.new("Guardrail_Brackets_BoltsMesh")
    bm = bmesh.new()

    for idx, py in enumerate(post_y_positions):
        is_start_post = idx == 0
        is_end_post = idx == len(post_y_positions) - 1

        # 1. Ω型（ハット断面）緩衝ブラケット (Z = 0.505m .. 0.755m)
        # Wビーム裏面 (x = 0.090m) の左右フランジから支柱前面 (x = 0.056m) の円弧サドルへ折れ曲がる板金ストリップ
        omega_xy = [
            (0.089, py - 0.105),  # 左フランジ外端（Wビーム裏面密着）
            (0.089, py - 0.048),  # 左フランジ内端（ボルト穴位置）
            (0.062, py - 0.032),  # 左ウェブ斜辺
            (0.056, py - 0.016),  # 支柱サドル左肩
            (0.055, py + 0.000),  # 支柱サドル中央（六角ボルト締結部）
            (0.056, py + 0.016),  # 支柱サドル右肩
            (0.062, py + 0.032),  # 右ウェブ斜辺
            (0.089, py + 0.048),  # 右フランジ内端（ボルト穴位置）
            (0.089, py + 0.105),  # 右フランジ外端（Wビーム裏面密着）
        ]
        add_extruded_xy_strip(
            bm,
            xy_points=omega_xy,
            z_min=0.505,
            z_max=0.755,
            thickness=0.005,
            mat_idx=0,
        )

        # 支柱とブラケットを固定する中央六角ボルト頭 (ref_jp_guardrail_white_2.jpg で支柱直前に見える黒い六角ボルト)
        add_splice_bolt_and_nut(
            bm,
            x_front_surface=0.060,
            y=py,
            z=0.740,
            head_radius=0.012,
            include_back_nut=False,
            mat_idx=1,
        )

        if is_start_post or is_end_post:
            # 両端支柱: 袖ビーム重ね継手用の4本大径丸頭ボルト (ref_jp_guardrail_white_2/3/4.jpg)
            dir_s = -1.0 if is_start_post else 1.0
            for y_off in (-0.185, -0.068):
                bolt_y = py + dir_s * y_off
                for z_crest in (0.542, 0.718):
                    add_splice_bolt_and_nut(
                        bm,
                        x_front_surface=0.193,
                        y=bolt_y,
                        z=z_crest,
                        head_radius=0.017,
                        x_back_override=0.086,
                        include_back_nut=True,
                        mat_idx=1,
                    )
        else:
            # 中間支柱: 左右フランジとWビームクレストを留める上下4箇所のスプライスボルト＆背面ナット + 中央谷部固定ボルト
            for dy in (-0.074, 0.074):
                for z_bolt in (0.542, 0.718):
                    add_splice_bolt_and_nut(
                        bm,
                        x_front_surface=0.189,
                        y=py + dy,
                        z=z_bolt,
                        head_radius=0.0145,
                        x_back_override=0.086,
                        include_back_nut=True,
                        mat_idx=1,
                    )

            add_splice_bolt_and_nut(
                bm,
                x_front_surface=0.097,
                y=py,
                z=0.630,
                head_radius=0.013,
                include_back_nut=False,
                mat_idx=1,
            )

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("Guardrail_Brackets_Bolts", mesh)
    obj.data.materials.append(materials["GuardrailWhitePaint"])
    obj.data.materials.append(materials["GalvanizedSteel"])
    bpy.context.scene.collection.objects.link(obj)
    return obj


def add_delineator_unit(
    bm: bmesh.types.BMesh,
    post_y: float,
    z_base: float = 0.835,
) -> None:
    """
    支柱頂部に取り付けられる日本道路標準の円形デリネーター（視線誘導標: ref_jp_guardrail_brown.jpg 準拠）を追加する。
    マテリアルスロット:
      0: DelineatorHousing (黒〜ダークグレー金属枠・ステー)
      1: DelineatorAmber (進行方向側の高輝度オレンジ反射レンズ)
      2: DelineatorWhite (反対側の白色反射レンズ)
    """
    cx = 0.022
    cy = post_y
    disc_z = z_base + 0.088
    disc_radius = 0.052
    half_depth = 0.017

    # 1. 取付ステム脚 (Z = z_base .. z_base + 0.042)
    add_cylinder_segment(
        bm,
        center_xy=(cx, cy),
        z_bottom=z_base - 0.005,
        z_top=z_base + 0.042,
        r_bottom=0.013,
        r_top=0.011,
        segments=12,
        cap_bottom=False,
        cap_top=True,
        mat_idx=0,
        smooth=True,
    )

    # 2. Y軸方向（道路進行方向）を向く円形ハウジング外枠リング
    segments = 24
    front_outer = []
    back_outer = []
    front_inner = []
    back_inner = []
    lens_r = disc_radius * 0.82

    for s in range(segments):
        ang = (2.0 * math.pi * s) / segments
        px = cx + math.cos(ang) * disc_radius
        pz = disc_z + math.sin(ang) * disc_radius
        lx = cx + math.cos(ang) * lens_r
        lz = disc_z + math.sin(ang) * lens_r

        front_outer.append(bm.verts.new((px, cy - half_depth, pz)))
        back_outer.append(bm.verts.new((px, cy + half_depth, pz)))
        front_inner.append(bm.verts.new((lx, cy - half_depth + 0.003, lz)))
        back_inner.append(bm.verts.new((lx, cy + half_depth - 0.003, lz)))

    for s in range(segments):
        ns = (s + 1) % segments
        # 外周ドラム側面
        f_side = bm.faces.new([front_outer[s], back_outer[s], back_outer[ns], front_outer[ns]])
        # 前面ベゼルリム
        f_rim_f = bm.faces.new([front_outer[s], front_outer[ns], front_inner[ns], front_inner[s]])
        # 背面ベゼルリム
        f_rim_b = bm.faces.new([back_outer[ns], back_outer[s], back_inner[s], back_inner[ns]])
        for f in (f_side, f_rim_f, f_rim_b):
            f.material_index = 0
            f.smooth = True

    # 前面レンズ（高輝度アンバーオレンジ反射器: mat_idx = 1）
    f_lens_amber = bm.faces.new(list(reversed(front_inner)))
    f_lens_amber.material_index = 1
    f_lens_amber.smooth = False

    # 背面レンズ（高輝度ホワイト反射器: mat_idx = 2）
    f_lens_white = bm.faces.new(back_inner)
    f_lens_white.material_index = 2
    f_lens_white.smooth = False


def add_wbeam_trough_reflector(
    bm: bmesh.types.BMesh,
    post_y: float,
    z_center: float = 0.630,
) -> None:
    """
    Wビーム中央谷部（トラフ: Z = 0.630m, X = 0.098m .. 0.148m）に装着される
    日本道路標準の台形両面再帰反射標（ガードレールビーム用視線誘導標）を追加する。
    前照灯（ヘッドライト）の入射角に対して正対するよう、前後のプリズム反射面を車道側 (+X) へ傾斜させる。
    マテリアルスロット:
      0: DelineatorHousing (台形ブラケット黒金属枠)
      1: DelineatorAmber (-Y 側を向く高輝度アンバープリズム反射面)
      2: DelineatorWhite (+Y 側を向く高輝度ホワイトプリズム反射面)
    """
    x_back = 0.098
    x_front = 0.146
    y_half_back = 0.056
    y_half_front = 0.022
    z_half_back = 0.036
    z_half_front = 0.031

    # 台形ブラケットの8頂点
    b_fl_b = bm.verts.new((x_back, post_y - y_half_back, z_center - z_half_back))
    b_fl_t = bm.verts.new((x_back, post_y - y_half_back, z_center + z_half_back))
    b_fr_b = bm.verts.new((x_back, post_y + y_half_back, z_center - z_half_back))
    b_fr_t = bm.verts.new((x_back, post_y + y_half_back, z_center + z_half_back))

    f_fl_b = bm.verts.new((x_front, post_y - y_half_front, z_center - z_half_front))
    f_fl_t = bm.verts.new((x_front, post_y - y_half_front, z_center + z_half_front))
    f_fr_b = bm.verts.new((x_front, post_y + y_half_front, z_center - z_half_front))
    f_fr_t = bm.verts.new((x_front, post_y + y_half_front, z_center + z_half_front))

    # 筐体の上面・下面・車道側先端面・背面 (mat_idx = 0)
    housing_faces = [
        [b_fl_t, f_fl_t, f_fr_t, b_fr_t],  # 上面
        [b_fr_b, f_fr_b, f_fl_b, b_fl_b],  # 下面
        [f_fl_b, f_fr_b, f_fr_t, f_fl_t],  # 車道側先端面 (+X)
        [b_fr_b, b_fl_b, b_fl_t, b_fr_t],  # ビーム谷部取付背面 (-X)
        [b_fl_b, f_fl_b, f_fl_t, b_fl_t],  # -Y 斜面ベース
        [f_fr_b, b_fr_b, b_fr_t, f_fr_t],  # +Y 斜面ベース
    ]
    for verts in housing_faces:
        f = bm.faces.new(verts)
        f.material_index = 0
        f.smooth = False

    # -Y 側傾斜面上の高輝度アンバー再帰反射プリズムプレート (mat_idx = 1)
    # 斜面法線方向へ 1.5mm オフセットして Z-fighting を防ぐ
    a_v0 = bm.verts.new(
        (x_back + 0.006, post_y - y_half_back - 0.0015, z_center - z_half_back + 0.005)
    )
    a_v1 = bm.verts.new(
        (x_front - 0.005, post_y - y_half_front - 0.0022, z_center - z_half_front + 0.005)
    )
    a_v2 = bm.verts.new(
        (x_front - 0.005, post_y - y_half_front - 0.0022, z_center + z_half_front - 0.005)
    )
    a_v3 = bm.verts.new(
        (x_back + 0.006, post_y - y_half_back - 0.0015, z_center + z_half_back - 0.005)
    )
    f_amber = bm.faces.new([a_v0, a_v1, a_v2, a_v3])
    f_amber.material_index = 1
    f_amber.smooth = False

    # +Y 側傾斜面上の高輝度ホワイト再帰反射プリズムプレート (mat_idx = 2)
    w_v0 = bm.verts.new(
        (x_front - 0.005, post_y + y_half_front + 0.0022, z_center - z_half_front + 0.005)
    )
    w_v1 = bm.verts.new(
        (x_back + 0.006, post_y + y_half_back + 0.0015, z_center - z_half_back + 0.005)
    )
    w_v2 = bm.verts.new(
        (x_back + 0.006, post_y + y_half_back + 0.0015, z_center + z_half_back - 0.005)
    )
    w_v3 = bm.verts.new(
        (x_front - 0.005, post_y + y_half_front + 0.0022, z_center + z_half_front - 0.005)
    )
    f_white = bm.faces.new([w_v0, w_v1, w_v2, w_v3])
    f_white.material_index = 2
    f_white.smooth = False


def build_delineators_mesh(
    materials: dict[str, bpy.types.Material],
    post_y_positions: list[float],
) -> bpy.types.Object:
    """支柱頂部の円形デリネーターおよびWビーム谷部の台形反射標メッシュを構築する"""
    mesh = bpy.data.meshes.new("Guardrail_DelineatorsMesh")
    bm = bmesh.new()

    # 両端支柱頂部へ円形デリネーターを設置し、全支柱位置のWビーム谷部へ台形再帰反射標を設置
    for idx, py in enumerate(post_y_positions):
        is_end_post = idx == 0 or idx == len(post_y_positions) - 1
        if is_end_post:
            add_delineator_unit(bm, post_y=py, z_base=0.835)
        add_wbeam_trough_reflector(bm, post_y=py, z_center=0.630)

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("Guardrail_Delineators", mesh)
    obj.data.materials.append(materials["DelineatorHousing"])
    obj.data.materials.append(materials["DelineatorAmber"])
    obj.data.materials.append(materials["DelineatorWhite"])
    bpy.context.scene.collection.objects.link(obj)
    return obj


def generate_guardrail() -> dict[str, object]:
    """日本標準ガードレール 3D アセットを生成し GLB 形式でエクスポートする"""
    clean_scene()
    materials = setup_materials()

    root = bpy.data.objects.new("GuardrailRoot", None)
    root.empty_display_type = "ARROWS"
    root.empty_display_size = 0.5
    bpy.context.scene.collection.objects.link(root)

    # 支柱間隔 2.0m × 3スパン = 6.0m (支柱4本: Y = -3.0, -1.0, +1.0, +3.0)
    post_y_positions = [-3.0, -1.0, 1.0, 3.0]

    wbeam_obj = build_wbeam_mesh(materials, post_y_positions)
    wbeam_obj.parent = root

    sleeve_obj = build_sleeve_ends_mesh(materials, post_y_positions)
    sleeve_obj.parent = root

    posts_obj = build_posts_mesh(materials, post_y_positions)
    posts_obj.parent = root

    brackets_obj = build_brackets_and_bolts_mesh(materials, post_y_positions)
    brackets_obj.parent = root

    delineators_obj = build_delineators_mesh(materials, post_y_positions)
    delineators_obj.parent = root

    # シーンのワールド行列更新
    bpy.context.view_layer.update()

    script_file = globals().get("__file__")
    repo_root = (
        os.path.abspath(os.path.join(os.path.dirname(script_file), "../.."))
        if script_file
        else "/Users/kei/ghq/github.com/kexi/antigravity-deep-drive"
    )
    out_dir = os.path.join(repo_root, "apps/web/public/models")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "guardrail.glb")

    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_extras=True,
    )

    summary = {}
    total_verts = 0
    total_faces = 0
    for obj in bpy.data.objects:
        if obj.type == "MESH":
            v_cnt = len(obj.data.vertices)
            f_cnt = len(obj.data.polygons)
            total_verts += v_cnt
            total_faces += f_cnt
            summary[obj.name] = {"verts": v_cnt, "faces": f_cnt}

    print(
        f"Successfully exported Japanese Guardrail model to: {out_path} "
        f"({os.path.getsize(out_path):,} bytes, {total_verts} verts, {total_faces} faces)"
    )
    return {
        "glb_path": out_path,
        "glb_size_bytes": os.path.getsize(out_path),
        "total_verts": total_verts,
        "total_faces": total_faces,
        "objects": summary,
    }


if __name__ == "__main__":
    generate_guardrail()

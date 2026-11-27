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
Blender Procedural Modeling Script: トヨタ クラウン セダン (TOYOTA CROWN SEDAN AZSH32 / KZSM30)
Antigravity Deep Drive 用 スタジオ品質 3D アセット生成（右ハンドル RHD 日本仕様 + 車内3Dプロシージャルテクスチャ）

360度収束レビューに基づく高精度モデリング仕様:
- 実寸プロポーション (1 Unit = 1.0m):
  - 全長 4.70m (Y = -2.35m .. +2.35m) × 全幅 1.89m (X = ±0.945m) × 全高 1.48m × ホイールベース 2.78m (wy = ±1.39m)
  - Three.js `carModel.ts` のヘッドライト光源・ウインカー・ワイパー・メーター・ナビ・3系統ミラー座標と 0.0mm 整合
- Class-A 連続溶着スカルプトボディシェル & 真のホイールアーチ開口:
  - フロントバンパー・前後フェンダー・左右ドア・ボンネットフード・トランクデッキ・リアバンパーの境界頂点を
    共通パラメトリック曲面式で 0.0mm 一致させ `remove_doubles` で完全溶着（隙間・段差・陰影折れを根絶）
  - 前後4輪に極座標トポロジーの真の半円ホイールアーチ開口 (R=0.392m)・立体フェンダーフレア・Z>=0.178m 遮光ライナーを構築
- ハンマーヘッドフロントフェイス & フルワイド横一文字LEDテール:
  - フードブロウ直下に独立成型した曲面ハンマーヘッドダークハウジング・横一文字DRL・片側4眼Bi-Beam LEDプロジェクター (Z=0.675..0.715m)
  - シャープな境界を持つ立体アンダープライオリティ台形グリル（縦基調21本グロスブラックルーバー）& 曲面フラッシュC字エアカーテン
  - 曲面リアデッキに凹設したスモークハウジング＆全幅連続クリムゾンLEDテールバー (Z=0.875..0.905m)、正方向『C R O W N』レタリング、
    下部水平クロームバー＆スリムリフレクター
  - 高解像度パック済み日本規格ナンバープレートテクスチャ（「品川 330 / さ 16-32」正方向UV展開＋立体ボルト＆リアアルミ封印）
- 6ライト・ファストバックグリーンハウス:
  - 16断面ドームルーフとカントレール下に収まるフラッシュA/Bピラー＆6ライトディバイダー、連続曲面Cピラーセイル、一体クロームモール
- 20インチ 20本マルチスポークアルミホイール & ラウンドトレッドタイヤ:
  - 4本排水溝＆48分割ラウンドタイヤ、凹面20本切削光輝＆ダークチタン複合スポーク、5穴ラグナット、曲面モノブロックキャリパー
- 右ハンドル (RHD: X=-0.38m) アイランドアーキテクチャー内装:
  - ホイールハウスへ一切侵入しない厳密クリアランス配置、面取り曲面シート、ラップアラウンド杢目ダッシュ、フレームレスインナーミラー
"""

import math
import os

import bpy

# isort: split
# Why not: bpy 単体 wheel (PyPI) では import bpy 実行時に初めて bmesh / mathutils が
# sys.modules に登録されるため、アルファベット順で bmesh を先に import すると ModuleNotFoundError になる。
import bmesh
from mathutils import Euler, Vector

# ==============================================================================
# 1. シーン初期化 & PBR / 3Dプロシージャルマテリアル構築
# ==============================================================================


def clean_scene():
    """既存のシーン内オブジェクト・メッシュ・マテリアル・画像を全消去して初期化"""
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh, do_unlink=True)
    for mat in list(bpy.data.materials):
        bpy.data.materials.remove(mat, do_unlink=True)
    for img in list(bpy.data.images):
        bpy.data.images.remove(img, do_unlink=True)


def create_pbr_material(
    name: str,
    base_color=(1.0, 1.0, 1.0, 1.0),
    metallic=0.0,
    roughness=0.5,
    emission_color=(0.0, 0.0, 0.0, 1.0),
    emission_strength=0.0,
    transmission=0.0,
    ior=1.45,
    alpha=1.0,
    coat_weight=0.0,
    coat_roughness=0.08,
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
    if "Transmission Weight" in bsdf.inputs:
        bsdf.inputs["Transmission Weight"].default_value = transmission
    if "IOR" in bsdf.inputs:
        bsdf.inputs["IOR"].default_value = ior
    if "Alpha" in bsdf.inputs:
        bsdf.inputs["Alpha"].default_value = alpha
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = coat_weight
    if "Coat Roughness" in bsdf.inputs:
        bsdf.inputs["Coat Roughness"].default_value = coat_roughness
    if "Emission Color" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = emission_color
    if "Emission Strength" in bsdf.inputs:
        bsdf.inputs["Emission Strength"].default_value = emission_strength

    return mat


def attach_crown_wood_3d_nodes(mat: bpy.types.Material):
    """CrownWoodTrim マテリアルに 3D Wave + 3D Noise オープンポア杢目ノードを接続する"""
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")

    tex_coord = nodes.new(type="ShaderNodeTexCoord")
    tex_coord.location = (-860, 0)

    mapping = nodes.new(type="ShaderNodeMapping")
    mapping.location = (-640, 0)
    mapping.inputs["Scale"].default_value = (6.0, 18.0, 9.0)
    links.new(tex_coord.outputs["Object"], mapping.inputs["Vector"])

    wave_3d = nodes.new(type="ShaderNodeTexWave")
    wave_3d.location = (-360, 180)
    wave_3d.wave_type = "RINGS"
    wave_3d.rings_direction = "SPHERICAL"
    wave_3d.inputs["Scale"].default_value = 4.5
    wave_3d.inputs["Distortion"].default_value = 6.5
    wave_3d.inputs["Detail"].default_value = 5.0
    links.new(mapping.outputs["Vector"], wave_3d.inputs["Vector"])

    noise_3d = nodes.new(type="ShaderNodeTexNoise")
    noise_3d.location = (-360, -140)
    noise_3d.noise_dimensions = "3D"
    noise_3d.inputs["Scale"].default_value = 28.0
    noise_3d.inputs["Detail"].default_value = 6.0
    links.new(mapping.outputs["Vector"], noise_3d.inputs["Vector"])

    color_mix = nodes.new(type="ShaderNodeMix")
    color_mix.data_type = "RGBA"
    color_mix.location = (-60, 160)
    color_mix.inputs[6].default_value = (0.18, 0.095, 0.050, 1.0)
    color_mix.inputs[7].default_value = (0.38, 0.21, 0.110, 1.0)
    links.new(wave_3d.outputs["Fac"], color_mix.inputs["Factor"])
    links.new(color_mix.outputs[2], bsdf.inputs["Base Color"])

    bump = nodes.new(type="ShaderNodeBump")
    bump.location = (-60, -140)
    bump.inputs["Strength"].default_value = 0.22
    bump.inputs["Distance"].default_value = 0.012
    links.new(noise_3d.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])


def attach_crown_leather_3d_nodes(
    mat: bpy.types.Material, col_dark, col_light, scale=26.0, bump_strength=0.22
):
    """本革・ソフトパッド系マテリアルに 3D Voronoi ペブルシボ＆3D Noise 毛穴バンプノードを接続する"""
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")

    tex_coord = nodes.new(type="ShaderNodeTexCoord")
    tex_coord.location = (-860, 0)

    mapping = nodes.new(type="ShaderNodeMapping")
    mapping.location = (-640, 0)
    mapping.inputs["Scale"].default_value = (scale, scale, scale)
    links.new(tex_coord.outputs["Object"], mapping.inputs["Vector"])

    voronoi_3d = nodes.new(type="ShaderNodeTexVoronoi")
    voronoi_3d.location = (-360, 160)
    voronoi_3d.voronoi_dimensions = "3D"
    voronoi_3d.feature = "F1"
    voronoi_3d.inputs["Scale"].default_value = 18.0
    links.new(mapping.outputs["Vector"], voronoi_3d.inputs["Vector"])

    noise_3d = nodes.new(type="ShaderNodeTexNoise")
    noise_3d.location = (-360, -140)
    noise_3d.noise_dimensions = "3D"
    noise_3d.inputs["Scale"].default_value = 40.0
    noise_3d.inputs["Detail"].default_value = 4.0
    links.new(mapping.outputs["Vector"], noise_3d.inputs["Vector"])

    color_mix = nodes.new(type="ShaderNodeMix")
    color_mix.data_type = "RGBA"
    color_mix.location = (-60, 150)
    color_mix.inputs[6].default_value = col_dark
    color_mix.inputs[7].default_value = col_light
    links.new(noise_3d.outputs["Fac"], color_mix.inputs["Factor"])
    links.new(color_mix.outputs[2], bsdf.inputs["Base Color"])

    bump = nodes.new(type="ShaderNodeBump")
    bump.location = (-60, -140)
    bump.inputs["Strength"].default_value = bump_strength
    bump.inputs["Distance"].default_value = 0.008
    links.new(voronoi_3d.outputs["Distance"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])


def _dist_seg(px: float, py: float, x0: float, y0: float, x1: float, y1: float) -> float:
    """点 (px, py) と線分 (x0, y0)-(x1, y1) の最短ユークリッド距離を返す"""
    dx = x1 - x0
    dy = y1 - y0
    len_sq = dx * dx + dy * dy
    if len_sq <= 1e-10:
        return math.hypot(px - x0, py - y0)
    t = max(0.0, min(1.0, ((px - x0) * dx + (py - y0) * dy) / len_sq))
    return math.hypot(px - (x0 + t * dx), py - (y0 + t * dy))


def create_jdm_license_plate_image() -> bpy.types.Image:
    """高解像度 512x256 日本規格ナンバープレート画像（「品川 330 / さ 16-32」）を生成しGLBへパックする
    Why not 外部フォントや緑の直方体メッシュ並置に頼らないか:
    外部フォント依存は実行環境差で欠落し、直方体並置では至近距離でブロック文字に見える。
    純Pythonの符号付き距離カプセルストローク描画でアンチエイリアス済み画像を GLB へ pack することで、
    Blender・Three.js の双方で完全に一貫した鮮明な日本ナンバープレートを実現する。
    """
    width, height = 512, 256
    img = bpy.data.images.new("JdmLicensePlateTex", width=width, height=height, alpha=False)

    strokes: list[tuple[float, float, float, float, float]] = []

    def add_polyline(pts: list[tuple[float, float]], thick: float):
        for idx in range(len(pts) - 1):
            strokes.append((pts[idx][0], pts[idx][1], pts[idx + 1][0], pts[idx + 1][1], thick))

    def add_rect(x0: float, y0: float, x1: float, y1: float, thick: float):
        add_polyline([(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)], thick)

    def add_digit(ch: str, cx: float, cy: float, w: float, h: float, thick: float):
        hw = w * 0.5
        hh = h * 0.5
        x_l, x_r = cx - hw, cx + hw
        y_b, y_m, y_t = cy - hh, cy, cy + hh
        if ch == "0":
            add_polyline(
                [
                    (cx - hw * 0.65, y_t),
                    (cx + hw * 0.65, y_t),
                    (x_r, cy + hh * 0.72),
                    (x_r, cy - hh * 0.72),
                    (cx + hw * 0.65, y_b),
                    (cx - hw * 0.65, y_b),
                    (x_l, cy - hh * 0.72),
                    (x_l, cy + hh * 0.72),
                    (cx - hw * 0.65, y_t),
                ],
                thick,
            )
        elif ch == "1":
            add_polyline(
                [(cx - hw * 0.45, y_t - hh * 0.30), (cx + hw * 0.08, y_t), (cx + hw * 0.08, y_b)],
                thick,
            )
            add_polyline([(cx - hw * 0.55, y_b), (cx + hw * 0.62, y_b)], thick)
        elif ch == "2":
            add_polyline(
                [
                    (x_l, cy + hh * 0.55),
                    (cx - hw * 0.45, y_t),
                    (cx + hw * 0.55, y_t),
                    (x_r, cy + hh * 0.62),
                    (x_r, cy + hh * 0.25),
                    (x_l, y_b),
                    (x_r, y_b),
                ],
                thick,
            )
        elif ch == "3":
            add_polyline(
                [
                    (x_l, cy + hh * 0.62),
                    (cx - hw * 0.35, y_t),
                    (cx + hw * 0.55, y_t),
                    (x_r, cy + hh * 0.62),
                    (x_r, cy + hh * 0.20),
                    (cx + hw * 0.15, y_m),
                    (cx - hw * 0.20, y_m),
                ],
                thick,
            )
            add_polyline(
                [
                    (cx + hw * 0.15, y_m),
                    (x_r, cy - hh * 0.22),
                    (x_r, cy - hh * 0.66),
                    (cx + hw * 0.55, y_b),
                    (cx - hw * 0.45, y_b),
                    (x_l, cy - hh * 0.62),
                ],
                thick,
            )
        elif ch == "6":
            add_polyline(
                [
                    (cx + hw * 0.55, y_t),
                    (cx - hw * 0.45, y_t),
                    (x_l, cy + hh * 0.58),
                    (x_l, cy - hh * 0.66),
                    (cx - hw * 0.45, y_b),
                    (cx + hw * 0.55, y_b),
                    (x_r, cy - hh * 0.66),
                    (x_r, cy - hh * 0.06),
                    (cx + hw * 0.50, cy + hh * 0.12),
                    (cx - hw * 0.55, cy + hh * 0.12),
                    (x_l, cy - hh * 0.10),
                ],
                thick,
            )

    # 上段左: 「品川」
    add_rect(0.262, 0.795, 0.312, 0.865, 0.009)
    add_rect(0.240, 0.680, 0.280, 0.758, 0.009)
    add_rect(0.296, 0.680, 0.336, 0.758, 0.009)
    add_polyline([(0.368, 0.870), (0.368, 0.745), (0.354, 0.678)], 0.010)
    add_polyline([(0.402, 0.865), (0.402, 0.695)], 0.010)
    add_polyline([(0.436, 0.875), (0.436, 0.675)], 0.010)

    # 上段右: 分類番号 「330」
    add_digit("3", 0.548, 0.775, 0.056, 0.195, 0.011)
    add_digit("3", 0.630, 0.775, 0.056, 0.195, 0.011)
    add_digit("0", 0.712, 0.775, 0.056, 0.195, 0.011)

    # 下段左: ひらがな 「さ」
    add_polyline([(0.098, 0.405), (0.175, 0.422)], 0.011)
    add_polyline([(0.128, 0.468), (0.156, 0.338)], 0.011)
    add_polyline([(0.104, 0.282), (0.122, 0.238), (0.166, 0.242)], 0.011)

    # 下段中央〜右: 4桁一連指定番号 「16-32」 (16代目 クラウン AZSH32)
    add_digit("1", 0.278, 0.345, 0.092, 0.415, 0.021)
    add_digit("6", 0.412, 0.345, 0.102, 0.415, 0.021)
    add_polyline([(0.514, 0.345), (0.562, 0.345)], 0.019)
    add_digit("3", 0.668, 0.345, 0.102, 0.415, 0.021)
    add_digit("2", 0.818, 0.345, 0.102, 0.415, 0.021)

    stroke_bboxes = [
        (
            min(x0, x1) - t - 0.012,
            max(x0, x1) + t + 0.012,
            min(y0, y1) - t - 0.012,
            max(y0, y1) + t + 0.012,
            x0,
            y0,
            x1,
            y1,
            t,
        )
        for (x0, y0, x1, y1, t) in strokes
    ]

    pixels = [0.0] * (width * height * 4)
    bg_r, bg_g, bg_b = 0.88, 0.90, 0.87
    ink_r, ink_g, ink_b = 0.010, 0.140, 0.052
    rim_r, rim_g, rim_b = 0.68, 0.70, 0.68

    for py_i in range(height):
        v = (py_i + 0.5) / height
        row_strokes = [sb for sb in stroke_bboxes if sb[2] <= v <= sb[3]]
        row_offset = py_i * width * 4
        is_v_border = v < 0.048 or v > 0.952
        for px_i in range(width):
            u = (px_i + 0.5) / width
            r, g, b = bg_r, bg_g, bg_b

            is_u_border = u < 0.024 or u > 0.976
            if is_v_border or is_u_border:
                r, g, b = rim_r, rim_g, rim_b
            elif (0.024 <= u <= 0.036 or 0.964 <= u <= 0.976) or (
                0.048 <= v <= 0.072 or 0.928 <= v <= 0.952
            ):
                r, g, b = 0.94, 0.95, 0.93

            best_cov = 0.0
            for min_x, max_x, _min_y, _max_y, x0, y0, x1, y1, t in row_strokes:
                if min_x <= u <= max_x:
                    d = _dist_seg(u * 2.0, v, x0 * 2.0, y0, x1 * 2.0, y1)
                    edge = d - t * 1.45
                    if edge < 0.012:
                        cov = max(0.0, min(1.0, (0.012 - edge) / 0.024))
                        if cov > best_cov:
                            best_cov = cov

            if best_cov > 0.0:
                inv = 1.0 - best_cov
                r = r * inv + ink_r * best_cov
                g = g * inv + ink_g * best_cov
                b = b * inv + ink_b * best_cov

            idx = row_offset + px_i * 4
            pixels[idx] = r
            pixels[idx + 1] = g
            pixels[idx + 2] = b
            pixels[idx + 3] = 1.0

    img.pixels.foreach_set(pixels)
    img.pack()
    return img


def setup_materials():
    """トヨタ クラウン セダン (AZSH32) 用PBRマテリアル一式を定義"""
    crown_wood = create_pbr_material(
        "CrownWoodTrim",
        base_color=(0.28, 0.15, 0.08, 1.0),
        roughness=0.32,
        metallic=0.06,
        coat_weight=0.50,
        coat_roughness=0.12,
        emission_color=(0.24, 0.12, 0.06, 1.0),
        emission_strength=0.05,
    )
    attach_crown_wood_3d_nodes(crown_wood)

    interior_dark = create_pbr_material(
        "InteriorDark",
        base_color=(0.11, 0.115, 0.135, 1.0),
        roughness=0.62,
        metallic=0.05,
        emission_color=(0.09, 0.095, 0.11, 1.0),
        emission_strength=0.03,
    )
    attach_crown_leather_3d_nodes(
        interior_dark,
        col_dark=(0.09, 0.095, 0.115, 1.0),
        col_light=(0.14, 0.15, 0.175, 1.0),
        scale=26.0,
        bump_strength=0.20,
    )

    interior_seat = create_pbr_material(
        "InteriorSeat",
        base_color=(0.16, 0.165, 0.19, 1.0),
        roughness=0.48,
        metallic=0.06,
        emission_color=(0.13, 0.135, 0.16, 1.0),
        emission_strength=0.04,
    )
    attach_crown_leather_3d_nodes(
        interior_seat,
        col_dark=(0.13, 0.135, 0.16, 1.0),
        col_light=(0.20, 0.21, 0.24, 1.0),
        scale=30.0,
        bump_strength=0.24,
    )

    steering_leather = create_pbr_material(
        "SteeringLeather",
        base_color=(0.10, 0.105, 0.125, 1.0),
        roughness=0.50,
        metallic=0.06,
        emission_color=(0.08, 0.085, 0.10, 1.0),
        emission_strength=0.03,
    )
    attach_crown_leather_3d_nodes(
        steering_leather,
        col_dark=(0.08, 0.085, 0.105, 1.0),
        col_light=(0.13, 0.14, 0.165, 1.0),
        scale=34.0,
        bump_strength=0.22,
    )

    plate_img = create_jdm_license_plate_image()
    plate_mat = create_pbr_material(
        "JdmPlateWhite",
        base_color=(0.95, 0.96, 0.94, 1.0),
        metallic=0.06,
        roughness=0.30,
        coat_weight=0.25,
        coat_roughness=0.22,
    )
    p_nodes = plate_mat.node_tree.nodes
    p_links = plate_mat.node_tree.links
    p_bsdf = next(n for n in p_nodes if n.type == "BSDF_PRINCIPLED")
    p_tex = p_nodes.new(type="ShaderNodeTexImage")
    p_tex.image = plate_img
    p_tex.location = (-360, 160)
    p_links.new(p_tex.outputs["Color"], p_bsdf.inputs["Base Color"])
    p_links.new(p_tex.outputs["Color"], p_bsdf.inputs["Emission Color"])
    p_bsdf.inputs["Emission Strength"].default_value = 0.15

    return {
        # 外装 クラウン セダン象徴色「プレシャスメタル (1L5) チタニウムシルバーメタリック」
        "BodyPaint": create_pbr_material(
            "BodyPaint",
            base_color=(0.46, 0.49, 0.54, 1.0),
            metallic=0.72,
            roughness=0.17,
            coat_weight=1.0,
            coat_roughness=0.04,
        ),
        # ピアノブラックトリム（アンダープライオリティグリル、ピラー、ロッカー、シャットライン、ホイールハウス）
        "BlackTrim": create_pbr_material(
            "BlackTrim",
            base_color=(0.018, 0.020, 0.026, 1.0),
            roughness=0.24,
            metallic=0.22,
            coat_weight=0.75,
            coat_roughness=0.08,
        ),
        # クローム＆切削光輝サテンシルバー（ウィンドウモール、王冠エンブレム、C R O W Nレター、ホイール切削面）
        "Chrome": create_pbr_material(
            "Chrome",
            base_color=(0.88, 0.91, 0.95, 1.0),
            metallic=0.90,
            roughness=0.12,
            coat_weight=0.50,
            coat_roughness=0.05,
        ),
        "WindshieldGlass": create_pbr_material(
            "WindshieldGlass",
            base_color=(0.86, 0.93, 0.97, 0.18),
            metallic=0.04,
            roughness=0.02,
            transmission=0.92,
            ior=1.52,
            alpha=0.24,
        ),
        "WindowGlass": create_pbr_material(
            "WindowGlass",
            base_color=(0.07, 0.10, 0.14, 0.40),
            metallic=0.12,
            roughness=0.04,
            transmission=0.80,
            ior=1.52,
            alpha=0.40,
        ),
        "HeadlightLED": create_pbr_material(
            "HeadlightLED",
            base_color=(0.96, 0.98, 1.0, 1.0),
            emission_color=(0.94, 0.97, 1.0, 1.0),
            emission_strength=5.5,
            roughness=0.05,
        ),
        "TaillightLED": create_pbr_material(
            "TaillightLED",
            base_color=(0.86, 0.02, 0.04, 1.0),
            emission_color=(1.0, 0.035, 0.055, 1.0),
            emission_strength=5.2,
            roughness=0.05,
        ),
        "JdmPlateWhite": plate_mat,
        "JdmPlateGreen": create_pbr_material(
            "JdmPlateGreen",
            base_color=(0.02, 0.22, 0.10, 1.0),
            metallic=0.05,
            roughness=0.38,
        ),
        "MirrorGlass": create_pbr_material(
            "MirrorGlass",
            base_color=(0.30, 0.38, 0.46, 1.0),
            metallic=0.40,
            roughness=0.14,
            emission_color=(0.18, 0.24, 0.30, 1.0),
            emission_strength=0.08,
        ),
        "InteriorDark": interior_dark,
        "InteriorSeat": interior_seat,
        "CrownWoodTrim": crown_wood,
        "AmbientStripLED": create_pbr_material(
            "AmbientStripLED",
            base_color=(1.0, 0.78, 0.45, 1.0),
            emission_color=(1.0, 0.74, 0.38, 1.0),
            emission_strength=2.20,
            roughness=0.15,
        ),
        "MeterBack": create_pbr_material(
            "MeterBack",
            base_color=(0.015, 0.025, 0.045, 1.0),
            emission_color=(0.02, 0.05, 0.10, 1.0),
            emission_strength=0.18,
            roughness=0.22,
        ),
        "DashboardScreen": create_pbr_material(
            "DashboardScreen",
            base_color=(0.08, 0.55, 0.95, 1.0),
            emission_color=(0.12, 0.68, 1.0, 1.0),
            emission_strength=1.35,
            roughness=0.15,
        ),
        "GaugeNeedleRed": create_pbr_material(
            "GaugeNeedleRed",
            base_color=(0.95, 0.12, 0.08, 1.0),
            emission_color=(1.0, 0.16, 0.08, 1.0),
            emission_strength=1.80,
            roughness=0.18,
        ),
        "SteeringLeather": steering_leather,
        "AlcantaraTrim": create_pbr_material(
            "AlcantaraTrim",
            base_color=(0.13, 0.135, 0.155, 1.0),
            roughness=0.88,
            metallic=0.02,
            emission_color=(0.10, 0.105, 0.125, 1.0),
            emission_strength=0.03,
        ),
        "SaddleStitch": create_pbr_material(
            "SaddleStitch",
            base_color=(0.68, 0.42, 0.22, 1.0),
            roughness=0.42,
            metallic=0.14,
            emission_color=(0.58, 0.34, 0.16, 1.0),
            emission_strength=0.08,
        ),
        "SilverTrim": create_pbr_material(
            "SilverTrim",
            base_color=(0.82, 0.85, 0.89, 1.0),
            metallic=0.68,
            roughness=0.22,
            coat_weight=0.55,
            coat_roughness=0.14,
            emission_color=(0.76, 0.79, 0.84, 1.0),
            emission_strength=0.08,
        ),
        "WiperBlack": create_pbr_material(
            "WiperBlack",
            base_color=(0.025, 0.025, 0.03, 1.0),
            roughness=0.60,
            metallic=0.25,
        ),
        # 深みのある加硫ゴムタイヤ（切削アルミホイールとのコントラストを鮮明化）
        "TireRubber": create_pbr_material(
            "TireRubber",
            base_color=(0.018, 0.020, 0.024, 1.0),
            roughness=0.82,
            metallic=0.02,
        ),
        "WheelAlloy": create_pbr_material(
            "WheelAlloy",
            base_color=(0.22, 0.25, 0.30, 1.0),
            metallic=0.84,
            roughness=0.20,
            coat_weight=0.70,
            coat_roughness=0.07,
        ),
        "BrakeRotor": create_pbr_material(
            "BrakeRotor",
            base_color=(0.55, 0.58, 0.62, 1.0),
            metallic=0.74,
            roughness=0.26,
        ),
        "BrakeCaliper": create_pbr_material(
            "BrakeCaliper",
            base_color=(0.62, 0.65, 0.70, 1.0),
            metallic=0.60,
            roughness=0.20,
            coat_weight=0.72,
        ),
    }


# ==============================================================================
# 2. BMesh ジオメトリ構築プリミティブ & 曲線補間ユーティリティ
# ==============================================================================


def clamp01(t: float) -> float:
    return max(0.0, min(1.0, t))


def smoothstep(t: float) -> float:
    t = clamp01(t)
    return t * t * (3.0 - 2.0 * t)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def sample_curve(x: float, knots: list[tuple[float, float]]) -> float:
    """単調増加な (x, y) 制御点列を滑らかな Catmull-Rom 補間で評価する"""
    if x <= knots[0][0]:
        return knots[0][1]
    if x >= knots[-1][0]:
        return knots[-1][1]
    for i in range(len(knots) - 1):
        x0, y0 = knots[i]
        x1, y1 = knots[i + 1]
        if x0 <= x <= x1:
            t = (x - x0) / max(1e-9, x1 - x0)
            p0 = knots[max(0, i - 1)][1]
            p1 = y0
            p2 = y1
            p3 = knots[min(len(knots) - 1, i + 2)][1]
            t2 = t * t
            t3 = t2 * t
            return 0.5 * (
                (2.0 * p1)
                + (-p0 + p2) * t
                + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2
                + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3
            )
    return knots[-1][1]


def safe_face(bm, verts: list, mat_idx: int = 0, smooth: bool = True):
    """重複頂点を除去し安全に面を生成"""
    clean = []
    for v in verts:
        if not clean or clean[-1] != v:
            clean.append(v)
    if len(clean) >= 2 and clean[0] == clean[-1]:
        clean.pop()
    if len(clean) < 3:
        return None
    try:
        f = bm.faces.new(clean)
        f.material_index = mat_idx
        f.smooth = smooth
        return f
    except ValueError:
        return None


def add_quad_grid(bm, grid: list[list], mat_idx: int = 0, smooth: bool = True, flip: bool = False):
    """2次元頂点グリッド grid[row][col] から滑らかな四角形メッシュを生成"""
    rows = len(grid)
    cols = len(grid[0])
    for r in range(rows - 1):
        for c in range(cols - 1):
            v0 = grid[r][c]
            v1 = grid[r][c + 1]
            v2 = grid[r + 1][c + 1]
            v3 = grid[r + 1][c]
            verts = [v0, v3, v2, v1] if flip else [v0, v1, v2, v3]
            safe_face(bm, verts, mat_idx=mat_idx, smooth=smooth)


def add_box(bm, center: Vector, size: Vector, mat_idx=0, smooth=False):
    """bmesh に直方体を追加"""
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
    for fv in faces:
        f = safe_face(bm, list(fv), mat_idx=mat_idx, smooth=smooth)
        if f:
            created.append(f)
    return created


def add_rounded_box(
    bm,
    center: Vector,
    size: Vector,
    bevel_r: float = 0.012,
    mat_idx: int = 0,
    smooth: bool = True,
    rot_euler: Euler | None = None,
):
    """面取り（ベベル）された丸みのある直方体を追加"""
    tmp = bmesh.new()
    bmesh.ops.create_cube(tmp, size=1.0)
    bmesh.ops.scale(tmp, vec=size, verts=tmp.verts)
    max_r = min(size.x, size.y, size.z) * 0.42
    r = min(bevel_r, max_r)
    if r > 1e-4:
        bmesh.ops.bevel(
            tmp,
            geom=list(tmp.edges),
            offset=r,
            offset_type="OFFSET",
            segments=3,
            profile=0.5,
            affect="EDGES",
            clamp_overlap=True,
        )
    if rot_euler is not None:
        bmesh.ops.rotate(tmp, cent=(0, 0, 0), matrix=rot_euler.to_matrix(), verts=tmp.verts)
    bmesh.ops.translate(tmp, vec=center, verts=tmp.verts)

    vert_map = {v: bm.verts.new(v.co) for v in tmp.verts}
    for f in tmp.faces:
        nf = safe_face(bm, [vert_map[v] for v in f.verts], mat_idx=mat_idx, smooth=smooth)
        if nf is not None:
            nf.smooth = smooth
    tmp.free()


def add_hexahedron(bm, verts_8: list[Vector], mat_idx=0, smooth=True):
    """任意の8頂点 [b0,b1,b2,b3, t0,t1,t2,t3] から六面体を追加"""
    v = [bm.verts.new(pt) for pt in verts_8]
    for fv in [
        (v[0], v[1], v[2], v[3]),
        (v[4], v[7], v[6], v[5]),
        (v[0], v[4], v[5], v[1]),
        (v[2], v[6], v[7], v[3]),
        (v[0], v[3], v[7], v[4]),
        (v[1], v[5], v[6], v[2]),
    ]:
        safe_face(bm, list(fv), mat_idx=mat_idx, smooth=smooth)


def add_slanted_strut(
    bm,
    p0: Vector,
    p1: Vector,
    width_x: float,
    depth_y: float,
    taper=0.85,
    mat_idx=0,
    smooth=True,
):
    """2点 p0 -> p1 を結ぶ傾斜角柱を追加"""
    hx = width_x * 0.5
    hy = depth_y * 0.5
    verts_8 = [
        p0 + Vector((-hx, -hy, 0.0)),
        p0 + Vector((hx, -hy, 0.0)),
        p0 + Vector((hx, hy, 0.0)),
        p0 + Vector((-hx, hy, 0.0)),
        p1 + Vector((-hx * taper, -hy * taper, 0.0)),
        p1 + Vector((hx * taper, -hy * taper, 0.0)),
        p1 + Vector((hx * taper, hy * taper, 0.0)),
        p1 + Vector((-hx * taper, hy * taper, 0.0)),
    ]
    add_hexahedron(bm, verts_8, mat_idx=mat_idx, smooth=smooth)


def add_swept_tube(
    bm,
    path_pts: list[Vector],
    radius_x: float,
    radius_y: float | None = None,
    segments: int = 10,
    mat_idx: int = 2,
    smooth: bool = True,
    cap_ends: bool = True,
):
    """任意の3D折れ線パスに沿って滑らかな断面チューブをスイープ生成"""
    if radius_y is None:
        radius_y = radius_x
    rings = []
    n_pts = len(path_pts)
    for i, pt in enumerate(path_pts):
        if i == 0:
            tangent = (path_pts[1] - path_pts[0]).normalized()
        elif i == n_pts - 1:
            tangent = (path_pts[-1] - path_pts[-2]).normalized()
        else:
            tangent = (path_pts[i + 1] - path_pts[i - 1]).normalized()
        up_ref = Vector((0.0, 0.0, 1.0)) if abs(tangent.z) < 0.92 else Vector((1.0, 0.0, 0.0))
        right = tangent.cross(up_ref).normalized()
        up = right.cross(tangent).normalized()
        ring = []
        for s in range(segments):
            ang = (2.0 * math.pi * s) / segments
            offset = right * (math.cos(ang) * radius_x) + up * (math.sin(ang) * radius_y)
            ring.append(bm.verts.new(pt + offset))
        rings.append(ring)

    for i in range(n_pts - 1):
        r0, r1 = rings[i], rings[i + 1]
        for s in range(segments):
            ns = (s + 1) % segments
            safe_face(bm, [r0[s], r0[ns], r1[ns], r1[s]], mat_idx=mat_idx, smooth=smooth)

    if cap_ends:
        safe_face(bm, list(reversed(rings[0])), mat_idx=mat_idx, smooth=False)
        safe_face(bm, rings[-1], mat_idx=mat_idx, smooth=False)


def add_cylinder(
    bm,
    center: Vector,
    radius: float,
    height: float,
    segments=24,
    axis="Z",
    mat_idx=0,
    smooth=True,
    cap_ends=True,
):
    """bmesh に円柱を追加"""
    top_verts, bot_verts = [], []
    half_h = height * 0.5
    for i in range(segments):
        angle = (2.0 * math.pi * i) / segments
        ca, sa = math.cos(angle) * radius, math.sin(angle) * radius
        if axis == "X":
            bot_verts.append(bm.verts.new(center + Vector((-half_h, ca, sa))))
            top_verts.append(bm.verts.new(center + Vector((half_h, ca, sa))))
        elif axis == "Y":
            bot_verts.append(bm.verts.new(center + Vector((ca, -half_h, sa))))
            top_verts.append(bm.verts.new(center + Vector((ca, half_h, sa))))
        else:
            bot_verts.append(bm.verts.new(center + Vector((ca, sa, -half_h))))
            top_verts.append(bm.verts.new(center + Vector((ca, sa, half_h))))

    for i in range(segments):
        ni = (i + 1) % segments
        safe_face(
            bm,
            [bot_verts[i], bot_verts[ni], top_verts[ni], top_verts[i]],
            mat_idx=mat_idx,
            smooth=smooth,
        )

    if cap_ends:
        safe_face(bm, list(reversed(bot_verts)), mat_idx=mat_idx, smooth=False)
        safe_face(bm, top_verts, mat_idx=mat_idx, smooth=False)


def add_hollow_tube_x(
    bm,
    center: Vector,
    r_outer: float,
    r_inner: float,
    width_x: float,
    segments=48,
    mat_idx=1,
    smooth=True,
):
    """X軸方向の中空リングバレル（ホイールリム用）を追加"""
    hx = width_x * 0.5
    out_left, out_right, in_left, in_right = [], [], [], []
    for i in range(segments):
        ang = (2.0 * math.pi * i) / segments
        cy, cz = math.cos(ang), math.sin(ang)
        out_left.append(bm.verts.new(center + Vector((-hx, cy * r_outer, cz * r_outer))))
        out_right.append(bm.verts.new(center + Vector((hx, cy * r_outer, cz * r_outer))))
        in_left.append(bm.verts.new(center + Vector((-hx, cy * r_inner, cz * r_inner))))
        in_right.append(bm.verts.new(center + Vector((hx, cy * r_inner, cz * r_inner))))

    for i in range(segments):
        ni = (i + 1) % segments
        safe_face(
            bm,
            [out_left[i], out_left[ni], out_right[ni], out_right[i]],
            mat_idx=mat_idx,
            smooth=smooth,
        )
        safe_face(
            bm, [in_right[i], in_right[ni], in_left[ni], in_left[i]], mat_idx=mat_idx, smooth=smooth
        )
        safe_face(
            bm, [in_left[i], in_left[ni], out_left[ni], out_left[i]], mat_idx=mat_idx, smooth=False
        )
        safe_face(
            bm,
            [out_right[i], out_right[ni], in_right[ni], in_right[i]],
            mat_idx=mat_idx,
            smooth=False,
        )


def add_hollow_ring_y(
    bm,
    center: Vector,
    r_outer: float,
    r_inner: float,
    depth_y: float,
    segments=24,
    mat_idx=2,
    smooth=True,
):
    """Y軸方向の中空リングを追加"""
    hy = depth_y * 0.5
    out_front, out_back, in_front, in_back = [], [], [], []
    for i in range(segments):
        ang = (2.0 * math.pi * i) / segments
        cx, cz = math.cos(ang), math.sin(ang)
        out_front.append(bm.verts.new(center + Vector((cx * r_outer, -hy, cz * r_outer))))
        out_back.append(bm.verts.new(center + Vector((cx * r_outer, hy, cz * r_outer))))
        in_front.append(bm.verts.new(center + Vector((cx * r_inner, -hy, cz * r_inner))))
        in_back.append(bm.verts.new(center + Vector((cx * r_inner, hy, cz * r_inner))))

    for i in range(segments):
        ni = (i + 1) % segments
        safe_face(
            bm,
            [out_front[i], out_front[ni], out_back[ni], out_back[i]],
            mat_idx=mat_idx,
            smooth=smooth,
        )
        safe_face(
            bm, [in_back[i], in_back[ni], in_front[ni], in_front[i]], mat_idx=mat_idx, smooth=smooth
        )
        safe_face(
            bm,
            [in_front[i], in_front[ni], out_front[ni], out_front[i]],
            mat_idx=mat_idx,
            smooth=False,
        )
        safe_face(
            bm, [out_back[i], out_back[ni], in_back[ni], in_back[i]], mat_idx=mat_idx, smooth=False
        )


# ==============================================================================
# 3. トヨタ クラウン セダン (AZSH32) 共通パラメトリック曲面式（SSOT: 0.0mm 接合保証）
# ==============================================================================

WHEEL_Y_FRONT = -1.39
WHEEL_Y_REAR = 1.39
WHEEL_Z = 0.340
WHEEL_R_TIRE = 0.340
WHEEL_X_CENTER = 0.860
ARCH_CENTER_Z = 0.345
ARCH_R_INNER = 0.392
ARCH_R_FLARE = 0.432
ROCKER_Z = 0.178

# 共通の垂直分割数（バンパー・前後フェンダー・ドア間で全境界頂点を厳密1:1一致させ滑らかなClass-A曲率を得る）
N_SIDE_Z = 12
N_FENDER_TOP = 16  # フェンダー天頂ベルトラインの分割数 (合計アーチ分割 = 12 + 16 + 12 = 40!)
N_BUMPER_U = 32

BELT_Z_KNOTS = [
    (-2.34, 0.720),
    (-2.15, 0.752),
    (-1.94, 0.788),
    (-1.75, 0.818),
    (-1.39, 0.858),
    (-1.25, 0.868),
    (-0.85, 0.866),
    (-0.40, 0.864),
    (0.16, 0.870),
    (0.85, 0.892),
    (1.39, 0.922),
    (1.82, 0.942),
    (1.94, 0.946),
    (2.26, 0.948),
    (2.34, 0.926),
]

BODY_MAX_X_KNOTS = [
    (-2.35, 0.600),
    (-2.22, 0.825),
    (-1.94, 0.920),
    (-1.39, 0.954),
    (-0.85, 0.938),
    (0.00, 0.936),
    (0.85, 0.946),
    (1.39, 0.964),
    (1.94, 0.918),
    (2.22, 0.822),
    (2.35, 0.610),
]

BELT_X_KNOTS = [
    (-2.34, 0.560),
    (-2.18, 0.765),
    (-1.94, 0.838),
    (-1.39, 0.868),
    (-1.24, 0.855),
    (-0.85, 0.856),
    (0.16, 0.860),
    (0.85, 0.858),
    (1.39, 0.868),
    (1.82, 0.844),
    (1.94, 0.834),
    (2.18, 0.775),
    (2.34, 0.585),
]

ROCKER_X_KNOTS = [
    (-2.35, 0.560),
    (-2.16, 0.790),
    (-1.94, 0.862),
    (-1.39, 0.878),
    (-0.85, 0.876),
    (0.00, 0.874),
    (0.85, 0.878),
    (1.39, 0.884),
    (1.94, 0.860),
    (2.16, 0.785),
    (2.35, 0.575),
]

HOOD_CENTER_Z_KNOTS = [
    (-2.345, 0.720),
    (-2.26, 0.752),
    (-2.02, 0.802),
    (-1.66, 0.855),
    (-1.34, 0.882),
]


def eval_side_x(y: float, z: float) -> float:
    """任意の (y, z) における滑らかな3次元彫刻半幅 |X|（フェンダー・ドア・バンパー端で完全 C1 連続）"""
    z_belt = sample_curve(y, BELT_Z_KNOTS)
    x_max = sample_curve(y, BODY_MAX_X_KNOTS)
    x_belt = sample_curve(y, BELT_X_KNOTS)
    x_rock = sample_curve(y, ROCKER_X_KNOTS)

    v = clamp01((z - ROCKER_Z) / max(0.15, z_belt - ROCKER_Z))

    if v < 0.16:
        t = smoothstep(v / 0.16)
        base_x = lerp(x_rock - 0.028, x_rock + 0.020, t)
    elif v < 0.56:
        t = (v - 0.16) / 0.40
        base_x = lerp(x_rock + 0.020, x_max, smoothstep(t))
    elif v < 0.84:
        t = (v - 0.56) / 0.28
        base_x = lerp(x_max, lerp(x_max, x_belt, 0.45), smoothstep(t))
    else:
        t = (v - 0.84) / 0.16
        base_x = lerp(lerp(x_max, x_belt, 0.45), x_belt, smoothstep(t))

    # ドア中央部の緩やかなライトキャッチャー彫り込み（境界 y=±0.85 で滑らかにゼロへ収束させ折れ目を防ぐ）
    door_mask = smoothstep((y - (-0.82)) / 0.28) * smoothstep((0.82 - y) / 0.28)
    lower_scoop = math.exp(-(((v - 0.28) / 0.14) ** 2)) * 0.020 * door_mask

    # 全長を貫くシャープなショルダーキャラクターライン
    shoulder_crease = math.exp(-(((v - 0.80) / 0.06) ** 2)) * 0.012

    # ホイールアーチ周囲のみに緩やかに効かせるマッスルブリスター（境界 y=±0.85, ±1.94 で完全に 0.0 へ減衰）
    flare_boost = 0.0
    for wy in (WHEEL_Y_FRONT, WHEEL_Y_REAR):
        d = math.hypot(y - wy, z - ARCH_CENTER_Z)
        if ARCH_R_INNER - 0.02 <= d <= ARCH_R_FLARE + 0.09:
            ring_w = math.exp(-(((d - ARCH_R_FLARE) / 0.055) ** 2))
            y_fade = smoothstep((0.52 - abs(y - wy)) / 0.12)
            top_w = clamp01((z - ROCKER_Z) / 0.24)
            flare_boost = max(flare_boost, 0.020 * ring_w * top_w * y_fade)

    return base_x - lower_scoop + shoulder_crease + flare_boost


def eval_front_bumper_pt(u: float, vz: float) -> Vector:
    """ラップアラウンドフロントバンパー曲面点 (u in [-1, 1], vz in [0, 1]) の単一真実源 (SSOT)
    - |u| = 1.0 でフロントフェンダー前端 (y = -1.94, x = ±eval_side_x(-1.94, z), z = lerp(ROCKER_Z, z_belt(-1.94), vz)) と 0.000mm 一致!
    - vz = 1.0 でボンネットフード前端 (vi = 0) と 0.000mm 一致!
    """
    ua = abs(u)
    theta = u * (math.pi * 0.5)
    sa = abs(math.sin(theta))
    ca = math.cos(theta)

    y_base = -1.940 - 0.405 * (ca**0.78)
    z_top_side = sample_curve(y_base, BELT_Z_KNOTS)
    z_top_center = sample_curve(y_base, HOOD_CENTER_Z_KNOTS)
    z_top = lerp(z_top_center, z_top_side, ua**1.4)
    z = lerp(ROCKER_Z, z_top, vz)

    # 上下方向のノーズ立体カーブ（vz=1.0 のフード境界と |u|=1.0 のフェンダー境界では厳密に 0.0 へ収束）
    if vz > 0.85:
        nose_bump = 0.018 * math.sin(((vz - 0.85) / 0.15) * math.pi) * (ca**0.85)
    elif vz > 0.72:
        nose_bump = -0.022 * math.sin(((vz - 0.72) / 0.13) * math.pi) * (ca**0.55)
    elif vz < 0.14:
        nose_bump = 0.014 * (1.0 - vz / 0.14) * (ca**0.80)
    else:
        nose_bump = 0.014 * math.sin(vz * math.pi) * (ca**0.85)

    y = y_base - nose_bump

    x_side_end = eval_side_x(-1.940, z)
    x_mag = x_side_end * (sa**0.82)
    x = math.copysign(x_mag, u) if abs(u) > 1e-6 else 0.0
    return Vector((x, y, z))


def eval_rear_bumper_pt(u: float, vz: float) -> Vector:
    """ラップアラウンドリアバンパー＆トランク背面曲面点 (u in [-1, 1], vz in [0, 1]) の単一真実源 (SSOT)
    - |u| = 1.0 でリアフェンダー後端 (y = +1.94, z = lerp(ROCKER_Z, z_belt(+1.94), vz)) と 0.000mm 一致!（段差歯ゼロ）
    - vz = 1.0 でトランクデッキ後端 (vi = n_v) と 0.000mm 一致!
    """
    ua = abs(u)
    theta = u * (math.pi * 0.5)
    sa = abs(math.sin(theta))
    ca = math.cos(theta)

    y_base = 1.940 + 0.402 * (ca**0.76)
    z_top_side = sample_curve(y_base, BELT_Z_KNOTS)
    z_top = z_top_side + (1.0 - ua * ua) * 0.024
    # 下端はフェンダー端 (|u|=1) で厳密に ROCKER_Z (0.178m) に一致させ、中央のみディフューザーデパーチャー角で +0.028m 切り上げ
    z_bot = ROCKER_Z + 0.028 * (ca**1.4)
    z = lerp(z_bot, z_top, vz)

    # リアファシアの立体造形（vz=1.0 と |u|=1.0 で厳密に 0.0 へ収束）
    tail_sculpt = 0.0
    if vz > 0.92:
        tail_sculpt = 0.010 * math.sin(((vz - 0.92) / 0.08) * math.pi) * (ca**0.85)
    elif 0.78 <= vz <= 0.92:
        tail_sculpt = -0.018 * math.sin(((vz - 0.78) / 0.14) * math.pi) * (ca**0.45)
    elif vz < 0.22:
        tail_sculpt = -0.040 * (((0.22 - vz) / 0.22) ** 1.35) * (ca**0.85)

    # 優雅な台形ナンバーリセスポケット凹み
    plate_u_mask = smoothstep((0.34 - ua) / 0.08)
    plate_z_mask = smoothstep((z - 0.48) / 0.04) * smoothstep((0.72 - z) / 0.04)
    plate_recess = -0.022 * plate_u_mask * plate_z_mask

    y = y_base + tail_sculpt + plate_recess

    x_side_end = eval_side_x(1.940, z)
    x_mag = x_side_end * (sa**0.82)
    x = math.copysign(x_mag, u) if abs(u) > 1e-6 else 0.0
    return Vector((x, y, z))


def front_u_for_x(x_val: float, vz: float) -> float:
    """指定 X 座標に対応するフロントバンパーパラメータ u in [-1, 1] を逆算"""
    z_approx = lerp(ROCKER_Z, 0.74, vz)
    x_edge = max(0.1, eval_side_x(-1.940, z_approx))
    sa = clamp01(abs(x_val) / x_edge) ** (1.0 / 0.82)
    theta = math.asin(clamp01(sa))
    u_mag = theta / (math.pi * 0.5)
    return math.copysign(u_mag, x_val) if abs(x_val) > 1e-6 else 0.0


def rear_u_for_x(x_val: float, vz: float) -> float:
    """指定 X 座標に対応するリアバンパーパラメータ u in [-1, 1] を逆算"""
    z_approx = lerp(ROCKER_Z + 0.02, 0.94, vz)
    x_edge = max(0.1, eval_side_x(1.940, z_approx))
    sa = clamp01(abs(x_val) / x_edge) ** (1.0 / 0.82)
    theta = math.asin(clamp01(sa))
    u_mag = theta / (math.pi * 0.5)
    return math.copysign(u_mag, x_val) if abs(x_val) > 1e-6 else 0.0


# ==============================================================================
# 4. Class-A 溶着ボディシェル構築（実ホイールアーチ・ドア・フード・トランク・前後ファシア）
# ==============================================================================


def build_fender_with_wheel_arch(
    bm,
    side: float,
    wy: float,
    y_start: float,
    y_end: float,
    shell_verts: list,
    mat_paint=0,
    mat_black=1,
):
    """極座標トポロジーで真の半円ホイールアーチ開口を持つフロント/リアフェンダーを構築
    前後端の垂直エッジに厳密に N_SIDE_Z 分割を配置し、ドアおよびバンパーと 1:1 頂点溶着できるようにする。
    """
    n_arch = N_SIDE_Z + N_FENDER_TOP + N_SIDE_Z  # 8 + 16 + 8 = 32 分割!

    sin_min = max(-0.95, min(0.0, (ROCKER_Z - ARCH_CENTER_Z) / ARCH_R_INNER))
    theta_min = math.asin(sin_min)
    theta_max = math.pi - theta_min

    z_end_belt = sample_curve(y_end, BELT_Z_KNOTS)
    z_start_belt = sample_curve(y_start, BELT_Z_KNOTS)

    # 外側境界パス (厳密に N_SIDE_Z 後縁 + N_FENDER_TOP 上縁 + N_SIDE_Z 前縁)
    outer_yz: list[tuple[float, float]] = []
    for k in range(N_SIDE_Z):
        outer_yz.append((y_end, lerp(ROCKER_Z, z_end_belt, k / N_SIDE_Z)))
    for k in range(N_FENDER_TOP):
        yy = lerp(y_end, y_start, k / N_FENDER_TOP)
        outer_yz.append((yy, sample_curve(yy, BELT_Z_KNOTS)))
    for k in range(N_SIDE_Z + 1):
        outer_yz.append((y_start, lerp(z_start_belt, ROCKER_Z, k / N_SIDE_Z)))

    n_radial = 5
    grid = [[] for _ in range(n_radial)]
    liner_outer_ring = []
    liner_inner_ring = []
    inner_tub_x = side * 0.610

    for i in range(n_arch + 1):
        t = i / n_arch
        ang = lerp(theta_min, theta_max, t)
        cy, sz = math.cos(ang), math.sin(ang)

        y_in = wy + cy * ARCH_R_INNER
        z_in = max(ROCKER_Z, ARCH_CENTER_Z + sz * ARCH_R_INNER)
        x_in = eval_side_x(y_in, z_in) + 0.008

        y_fl = wy + cy * ARCH_R_FLARE
        z_fl = max(ROCKER_Z, ARCH_CENTER_Z + sz * ARCH_R_FLARE)
        x_fl = eval_side_x(y_fl, z_fl) + 0.015

        y_out, z_out = outer_yz[i]
        x_out = eval_side_x(y_out, z_out)

        # 垂直エッジ境界付近では中間リングを外側寄りに配置し、ドア/バンパーとの法線連続性を滑らかに保つ
        is_side_edge = (i <= N_SIDE_Z) or (i >= n_arch - N_SIDE_Z)
        mid_frac = 0.64 if is_side_edge else 0.54
        y_mid = lerp(y_fl, y_out, mid_frac)
        z_mid = lerp(z_fl, z_out, mid_frac)
        x_mid = eval_side_x(y_mid, z_mid)

        v_lip = bm.verts.new(Vector((side * (x_in - 0.044), y_in, z_in)))
        v_in = bm.verts.new(Vector((side * x_in, y_in, z_in)))
        v_fl = bm.verts.new(Vector((side * x_fl, y_fl, z_fl)))
        v_mid = bm.verts.new(Vector((side * x_mid, y_mid, z_mid)))
        v_out = bm.verts.new(Vector((side * x_out, y_out, z_out)))

        grid[0].append(v_lip)
        grid[1].append(v_in)
        grid[2].append(v_fl)
        grid[3].append(v_mid)
        grid[4].append(v_out)
        shell_verts.append(v_out)

        r_liner = ARCH_R_INNER + 0.014
        yl = wy + cy * r_liner
        zl = max(ROCKER_Z + 0.004, ARCH_CENTER_Z + sz * r_liner)
        liner_outer_ring.append(bm.verts.new(Vector((side * (x_in - 0.042), yl, zl))))
        liner_inner_ring.append(bm.verts.new(Vector((inner_tub_x, yl, zl))))

    flip_outer = side < 0
    for r in range(n_radial - 1):
        mat_use = mat_black if r == 0 else mat_paint
        for i in range(n_arch):
            v0 = grid[r][i]
            v1 = grid[r][i + 1]
            v2 = grid[r + 1][i + 1]
            v3 = grid[r + 1][i]
            verts = [v0, v3, v2, v1] if flip_outer else [v0, v1, v2, v3]
            safe_face(bm, verts, mat_idx=mat_use, smooth=(r >= 1))

    # ホイールハウス内側遮光アーチ天井＆奥壁（Z >= ROCKER_Z 厳密保証）
    center_wall = bm.verts.new(Vector((inner_tub_x, wy, max(ROCKER_Z + 0.01, ARCH_CENTER_Z))))
    for i in range(n_arch):
        o0, o1 = liner_outer_ring[i], liner_outer_ring[i + 1]
        in0, in1 = liner_inner_ring[i], liner_inner_ring[i + 1]
        verts_dome = [o0, o1, in1, in0] if side < 0 else [o0, in0, in1, o1]
        safe_face(bm, verts_dome, mat_idx=mat_black, smooth=True)
        verts_wall = [in0, in1, center_wall] if side < 0 else [in0, center_wall, in1]
        safe_face(bm, verts_wall, mat_idx=mat_black, smooth=False)


def build_side_door_panels(
    bm, side: float, y_front: float, y_rear: float, shell_verts: list, mat_paint=0, mat_black=1
):
    """前後フェンダー間の滑らかな連続ドア曲面パネルを構築し、境界頂点をフェンダーと 1:1 溶着する"""
    n_y = 14
    y_stations = [lerp(y_front, y_rear, i / n_y) for i in range(n_y + 1)]

    grid = []
    for yi, y in enumerate(y_stations):
        z_belt = sample_curve(y, BELT_Z_KNOTS)
        row = []
        is_boundary = yi in (0, n_y)
        for zi in range(N_SIDE_Z + 1):
            v = zi / N_SIDE_Z
            z = lerp(ROCKER_Z, z_belt, v)
            x = eval_side_x(y, z)
            vert = bm.verts.new(Vector((side * x, y, z)))
            row.append(vert)
            if is_boundary:
                shell_verts.append(vert)
        grid.append(row)

    flip = side > 0
    for yi in range(n_y):
        for zi in range(N_SIDE_Z):
            v0 = grid[yi][zi]
            v1 = grid[yi + 1][zi]
            v2 = grid[yi + 1][zi + 1]
            v3 = grid[yi][zi + 1]
            verts = [v0, v3, v2, v1] if flip else [v0, v1, v2, v3]
            safe_face(bm, verts, mat_idx=mat_paint, smooth=True)

    # ベルトライン上面ドア肩フランジ
    belt_in_row = [
        bm.verts.new(Vector((side * 0.760, y, sample_curve(y, BELT_Z_KNOTS) - 0.004)))
        for y in y_stations
    ]
    for yi in range(n_y):
        v0 = grid[yi][-1]
        v1 = grid[yi + 1][-1]
        v2 = belt_in_row[yi + 1]
        v3 = belt_in_row[yi]
        verts = [v0, v3, v2, v1] if flip else [v0, v1, v2, v3]
        safe_face(bm, verts, mat_idx=mat_paint, smooth=True)

    # 繊細な物理ドアシャットライン（フロントフェンダー/前ドア Y=-0.85、前ドア/後ドア Y=+0.16、後ドア/リアクォーター Y=+0.88）
    # Why not ボディ頂点を分断・凹ませて線を作らないか:
    # 頂点を分断すると法線が途切れてドア端に暗い影の帯ができる。外装シェルは完全溶着したまま、
    # 表面に 1.8mm の極細ダークシャットラインリボンを密着させることで本物のパネル隙間ラインを綺麗に描く。
    for seam_y in (-0.85, 0.16, 0.88):
        z_top_s = sample_curve(seam_y, BELT_Z_KNOTS) - 0.004
        seam_pts = [
            Vector(
                (
                    side * (eval_side_x(seam_y, lerp(ROCKER_Z + 0.015, z_top_s, k / 10)) + 0.0012),
                    seam_y,
                    lerp(ROCKER_Z + 0.015, z_top_s, k / 10),
                )
            )
            for k in range(11)
        ]
        add_swept_tube(
            bm,
            seam_pts,
            radius_x=0.0018,
            radius_y=0.0018,
            segments=6,
            mat_idx=mat_black,
            smooth=False,
        )


def build_front_hood_and_bumper(
    bm, shell_verts: list, mat_paint=0, mat_black=1, mat_chrome=2, mat_hl=4
):
    """0.0mm 溶着ボンネットフード・完全塗装フロントバンパー・独立シャープ台形グリル・ハンマーヘッド4眼LED・正方向日本ナンバー"""
    # 1. ラップアラウンド曲面フロントバンパーシェル（全面 BodyPaint で段差・階段ジャギーをゼロ化！）
    bumper_grid = []
    for zi in range(N_SIDE_Z + 1):
        vz = zi / N_SIDE_Z
        row = []
        for ui in range(N_BUMPER_U + 1):
            u = lerp(-1.0, 1.0, ui / N_BUMPER_U)
            pt = eval_front_bumper_pt(u, vz)
            v = bm.verts.new(pt)
            row.append(v)
            if ui in (0, N_BUMPER_U) or zi == N_SIDE_Z:
                shell_verts.append(v)
        bumper_grid.append(row)

    add_quad_grid(bm, bumper_grid, mat_idx=mat_paint, smooth=True, flip=False)

    # 2. スカルプト曲面ボンネットフード（前端 vi=0 を bumper_grid 上端と N_BUMPER_U 厳密一致で 0.0mm 溶着！）
    n_v = 14
    hood_grid = []
    for vi in range(n_v + 1):
        vr = vi / n_v
        row = []
        for ui in range(N_BUMPER_U + 1):
            u = lerp(-1.0, 1.0, ui / N_BUMPER_U)
            ua = abs(u)
            p_front = eval_front_bumper_pt(u, 1.0)

            # カウル後端はフロントガラス下端曲率 (-1.335 中央 .. -1.280 左右端) に完全一致
            y_cowl = -1.335 + 0.055 * (ua**1.85)
            x_cowl = u * sample_curve(y_cowl, BELT_X_KNOTS)
            z_cowl = lerp(
                sample_curve(y_cowl, HOOD_CENTER_Z_KNOTS),
                sample_curve(y_cowl, BELT_Z_KNOTS),
                ua**1.4,
            )

            y = lerp(p_front.y, y_cowl, vr)
            x_base = lerp(p_front.x, x_cowl, vr)
            # 側面輪郭 (|u|=1) を BELT_X_KNOTS / BELT_Z_KNOTS に厳密沿わせてフェンダー上端と隙間ゼロ接続
            x_side_exact = math.copysign(sample_curve(y, BELT_X_KNOTS), u) if abs(u) > 1e-6 else 0.0
            x = lerp(x_base, x_side_exact, smoothstep((ua - 0.85) / 0.15) * math.sin(vr * math.pi))

            z_base = lerp(p_front.z, z_cowl, vr)
            z_side_exact = sample_curve(y, BELT_Z_KNOTS)
            z_center_exact = sample_curve(y, HOOD_CENTER_Z_KNOTS)
            z_interp = lerp(z_center_exact, z_side_exact, ua**1.4)
            z = lerp(z_base, z_interp, math.sin(vr * math.pi))

            # パワードーム隆起＆フェンダー肩の自然なボリューム（前端 vr=0 と後端 vr=1 では厳密に 0.0）
            dome_crest = math.exp(-(((ua - 0.42) / 0.15) ** 2)) * 0.011 * math.sin(vr * math.pi)
            fender_swell = math.exp(-(((ua - 0.84) / 0.12) ** 2)) * 0.008 * math.sin(vr * math.pi)
            v = bm.verts.new(Vector((x, y, z + dome_crest + fender_swell)))
            row.append(v)
            if vi == 0:
                shell_verts.append(v)
        hood_grid.append(row)

    add_quad_grid(bm, hood_grid, mat_idx=mat_paint, smooth=True, flip=False)

    # カウル凹みダークワイパートレイ（フード後端とフロントガラス下端の間を綺麗に閉じる）
    cowl_grid = []
    for vi, z_off, y_shift in [(0, -0.006, 0.0), (1, -0.020, 0.042), (2, -0.002, 0.086)]:
        row = []
        for ui in range(N_BUMPER_U + 1):
            u = lerp(-1.0, 1.0, ui / N_BUMPER_U)
            ua = abs(u)
            y_cowl = -1.335 + 0.055 * (ua**1.85) + y_shift
            x = u * lerp(0.84, 0.745, vi * 0.5)
            z = 0.880 - 0.015 * (ua**1.5) + z_off
            row.append(bm.verts.new(Vector((x, y_cowl, z))))
        cowl_grid.append(row)
    add_quad_grid(bm, cowl_grid, mat_idx=mat_black, smooth=True, flip=False)

    # 3. 独立成型・シャープ境界の大型台形「アンダープライオリティ」フロントグリル（階段ジャギー完全根絶！）
    # バンパー曲面の直前 (-Y 方向 0.005m) に完全に滑らかな台形バックプレート＋ベゼルフレーム＋縦21本ルーバーを成型
    g_nu, g_nz = 22, 8
    grille_bg_grid = []
    for zi in range(g_nz + 1):
        tz = zi / g_nz
        vz = lerp(0.055, 0.720, tz)
        half_w = lerp(0.615, 0.505, tz)
        row = []
        for ui in range(g_nu + 1):
            gx = lerp(-half_w, half_w, ui / g_nu)
            u_b = front_u_for_x(gx, vz)
            pt = eval_front_bumper_pt(u_b, vz)
            # バンパー面から外側 (-Y) へ +0.006m 浮かせてシャープな台形輪郭を得る
            row.append(bm.verts.new(Vector((pt.x, pt.y - 0.006, pt.z))))
        grille_bg_grid.append(row)
    add_quad_grid(bm, grille_bg_grid, mat_idx=mat_black, smooth=True, flip=False)

    # 台形グリル外周の立体グロスブラックベゼル枠
    frame_pts = (
        [v.co + Vector((0.0, -0.006, 0.0)) for v in grille_bg_grid[0]]
        + [grille_bg_grid[zi][-1].co + Vector((0.0, -0.006, 0.0)) for zi in range(1, g_nz + 1)]
        + [v.co + Vector((0.0, -0.006, 0.0)) for v in reversed(grille_bg_grid[-1][:-1])]
        + [grille_bg_grid[zi][0].co + Vector((0.0, -0.006, 0.0)) for zi in range(g_nz - 1, -1, -1)]
    )
    add_swept_tube(
        bm, frame_pts, radius_x=0.011, radius_y=0.011, segments=8, mat_idx=mat_black, smooth=True
    )

    # 縦基調グロスブラックルーバー 21本（中央のナンバープレート領域 |x|<0.168, z in [0.275..0.455] は貫通防止のため上下分割！）
    for bar_i in range(-10, 11):
        frac = bar_i / 10.5
        bx_bot = frac * 0.595
        bx_top = frac * 0.488
        u_bot = front_u_for_x(bx_bot, 0.06)
        u_top = front_u_for_x(bx_top, 0.71)
        p_bot = eval_front_bumper_pt(u_bot, 0.06) + Vector((0.0, -0.014, 0.0))
        p_top = eval_front_bumper_pt(u_top, 0.71) + Vector((0.0, -0.014, 0.0))

        is_behind_plate = abs(bx_bot) < 0.172
        if is_behind_plate:
            # ナンバープレート上側・下側のみルーバーを描画し、プレートへのバー貫通を物理的にゼロにする
            p_plate_bot = eval_front_bumper_pt(
                front_u_for_x(lerp(bx_bot, bx_top, 0.18), 0.18), 0.18
            ) + Vector((0.0, -0.014, 0.0))
            p_plate_top = eval_front_bumper_pt(
                front_u_for_x(lerp(bx_bot, bx_top, 0.56), 0.56), 0.56
            ) + Vector((0.0, -0.014, 0.0))
            add_slanted_strut(
                bm,
                p_bot,
                p_plate_bot,
                width_x=0.010,
                depth_y=0.018,
                taper=0.96,
                mat_idx=mat_black,
                smooth=True,
            )
            add_slanted_strut(
                bm,
                p_plate_top,
                p_top,
                width_x=0.010,
                depth_y=0.018,
                taper=0.92,
                mat_idx=mat_black,
                smooth=True,
            )
        else:
            add_slanted_strut(
                bm,
                p_bot,
                p_top,
                width_x=0.010,
                depth_y=0.018,
                taper=0.90,
                mat_idx=mat_black,
                smooth=True,
            )

    # グリル下端＆フロントアンダースプリッター（上品なダークリップ＋極細クロームエッジ）
    lip_pts = [
        eval_front_bumper_pt(lerp(-1.0, 1.0, i / 24), 0.0) + Vector((0.0, -0.014, -0.006))
        for i in range(25)
    ]
    add_swept_tube(
        bm, lip_pts, radius_x=0.014, radius_y=0.012, segments=8, mat_idx=mat_black, smooth=True
    )
    lip_chrome = [
        eval_front_bumper_pt(lerp(-0.56, 0.56, i / 14), 0.02) + Vector((0.0, -0.022, 0.002))
        for i in range(15)
    ]
    add_swept_tube(
        bm, lip_chrome, radius_x=0.005, radius_y=0.0045, segments=8, mat_idx=mat_chrome, smooth=True
    )

    # 4. 左右バンパーコーナーの曲面フラッシュ・縦型サイドエアカーテンインテーク（途切れ・突き出しゼロ！）
    for side in (-1.0, 1.0):
        ac_grid = []
        for zi in range(9):
            tz = zi / 8
            vz = lerp(0.14, 0.63, tz)
            w_in = lerp(0.652, 0.585, tz)
            w_out = w_in + 0.068 * math.sin(tz * math.pi) + 0.024
            row = []
            for ui in range(5):
                gx = side * lerp(w_in, w_out, ui / 4)
                u_b = front_u_for_x(gx, vz)
                pt = eval_front_bumper_pt(u_b, vz)
                ang_out = u_b * (math.pi * 0.5)
                off = Vector((math.sin(ang_out) * 0.011, -math.cos(ang_out) * 0.011, 0.0))
                row.append(bm.verts.new(pt + off))
            ac_grid.append(row)
        add_quad_grid(bm, ac_grid, mat_idx=mat_black, smooth=True, flip=(side < 0))

        # エアカーテン外縁の洗練されたグロスブラック縦縁＆中央水平エアロフィン
        fin_pts = [ac_grid[zi][-1].co + Vector((side * 0.002, -0.003, 0.0)) for zi in range(9)]
        add_swept_tube(
            bm,
            fin_pts,
            radius_x=0.0055,
            radius_y=0.0055,
            segments=8,
            mat_idx=mat_black,
            smooth=True,
        )
        mid_bar = [ac_grid[4][ui].co + Vector((side * 0.003, -0.004, 0.0)) for ui in range(5)]
        add_swept_tube(
            bm,
            mid_bar,
            radius_x=0.0045,
            radius_y=0.0045,
            segments=8,
            mat_idx=mat_chrome,
            smooth=True,
        )

    # 5. 独立成型・曲面ハンマーヘッド光学ヘッドランプユニット (Z = 0.655 .. 0.718m)
    # Why +0.016m 以上のクリアランスを確保するか:
    # バンパー曲面の凹みリセス (vz=0.72..0.85) の弦補間と干渉して銀塗装がダークハウジングへ滲み出すのを完全防止し、
    # 漆黒の光学ハウジング内で片側4眼 Bi-Beam LED プロジェクターを鮮明に際立たせるため。
    hl_nu = 32
    hl_nz = 5
    hl_panel = []
    for zi in range(hl_nz + 1):
        tz = zi / hl_nz
        row = []
        for ui in range(hl_nu + 1):
            u_norm = lerp(-1.0, 1.0, ui / hl_nu)
            ua = abs(u_norm)
            lamp_expand = smoothstep((ua - 0.35) / 0.13)
            vz_bot = lerp(0.865, 0.748, lamp_expand)
            vz_top = lerp(0.935, 0.946, lamp_expand)
            vz = lerp(vz_bot, vz_top, tz)
            u_b = u_norm * 0.785
            pt = eval_front_bumper_pt(u_b, vz)
            ang_out = u_b * (math.pi * 0.5)
            # 光学ハウジング背面が確実にバンパー面より前方へ出る +0.016m オフセット（上下縁はわずかに絞り一体感演出）
            edge_tuck = 0.004 * math.sin(tz * math.pi)
            off = Vector(
                (
                    math.sin(ang_out) * (0.015 + edge_tuck),
                    -math.cos(ang_out) * (0.015 + edge_tuck),
                    0.0,
                )
            )
            row.append(bm.verts.new(pt + off))
        hl_panel.append(row)
    add_quad_grid(bm, hl_panel, mat_idx=mat_black, smooth=True, flip=False)

    # ヘッドランプ外周のシャープなグロスブラック下縁トリム
    hl_bot_rim = [v.co + Vector((0.0, -0.002, 0.0)) for v in hl_panel[0]]
    add_swept_tube(
        bm, hl_bot_rim, radius_x=0.0045, radius_y=0.0045, segments=8, mat_idx=mat_black, smooth=True
    )

    # 横一文字シームレスLED DRL シグネチャーブレード + 下縁クロームアイライン
    drl_pts = []
    drl_chrome_pts = []
    for ui in range(hl_nu + 1):
        u_norm = lerp(-1.0, 1.0, ui / hl_nu)
        u_b = u_norm * 0.78
        pt_top = eval_front_bumper_pt(u_b, 0.922)
        ang_out = u_b * (math.pi * 0.5)
        n_dir = Vector((math.sin(ang_out), -math.cos(ang_out), 0.0))
        drl_pts.append(pt_top + n_dir * 0.023)
        drl_chrome_pts.append(pt_top + n_dir * 0.020 + Vector((0.0, 0.0, -0.010)))
    add_swept_tube(
        bm, drl_pts, radius_x=0.0072, radius_y=0.0068, segments=10, mat_idx=mat_hl, smooth=True
    )
    add_swept_tube(
        bm,
        drl_chrome_pts,
        radius_x=0.0036,
        radius_y=0.0032,
        segments=8,
        mat_idx=mat_chrome,
        smooth=True,
    )

    # 片側4眼Bi-Beam LEDプロジェクター光学ユニット（曲線接線から正確な法線・ヨー角を算出し全4眼ワイドレンズを正面発光！）
    for side in (-1.0, 1.0):
        for q_idx in range(4):
            t_q = (q_idx + 0.5) / 4.0
            u_b = side * lerp(0.42, 0.72, t_q)
            pt_l = eval_front_bumper_pt(u_b, 0.832)
            p_prev = eval_front_bumper_pt(u_b - 0.015, 0.832)
            p_next = eval_front_bumper_pt(u_b + 0.015, 0.832)
            tang = Vector((p_next.x - p_prev.x, p_next.y - p_prev.y, 0.0)).normalized()
            # 接線 (+X 方向) に対する外向き法線 (-Y 方向) = (tang.y, -tang.x, 0)
            n_dir = Vector((tang.y, -tang.x, 0.0)).normalized()
            yaw_q = math.atan2(tang.y, tang.x)
            # ダークプロジェクターハウジング
            add_rounded_box(
                bm,
                center=pt_l + n_dir * 0.017,
                size=Vector((0.056, 0.012, 0.032)),
                bevel_r=0.003,
                mat_idx=mat_black,
                smooth=True,
                rot_euler=Euler((0.0, 0.0, yaw_q), "XYZ"),
            )
            # 高輝度クールホワイト Bi-Beam LED ワイド光学レンズコア（44mm x 22mm が正面〜斜めから鮮明発光）
            add_rounded_box(
                bm,
                center=pt_l + n_dir * 0.023,
                size=Vector((0.044, 0.008, 0.020)),
                bevel_r=0.003,
                mat_idx=mat_hl,
                smooth=True,
                rot_euler=Euler((0.0, 0.0, yaw_q), "XYZ"),
            )
            # 下縁クローム光学リフレクターアクセント
            add_rounded_box(
                bm,
                center=pt_l + n_dir * 0.023 + Vector((0.0, 0.0, -0.014)),
                size=Vector((0.050, 0.007, 0.004)),
                bevel_r=0.001,
                mat_idx=mat_chrome,
                smooth=True,
                rot_euler=Euler((0.0, 0.0, yaw_q), "XYZ"),
            )

    # 6. ハンマーヘッドノーズ中央の立体「王冠（Crown）エンブレム」
    p_emblem_base = eval_front_bumper_pt(0.0, 1.0)
    add_crown_emblem_sculpted(
        bm,
        center=Vector((0.0, p_emblem_base.y + 0.026, p_emblem_base.z + 0.016)),
        scale=1.12,
        axis_y_dir=-1.0,
        pitch_rad=math.radians(52.0),
        mat_chrome=mat_chrome,
        mat_back=mat_black,
    )

    # 7. フロント日本規格ナンバープレート（グリルルーバーと完全クリアランス・正方向UV）
    add_japanese_license_plate(
        bm,
        center=Vector((0.0, -2.370, 0.365)),
        is_rear=False,
        mat_trim=mat_black,
        mat_plate=6,
        mat_chrome=mat_chrome,
    )


def build_rear_deck_and_bumper(
    bm, shell_verts: list, mat_paint=0, mat_black=1, mat_chrome=2, mat_tail=5
):
    """0.0mm 溶着トランクデッキ＆リアバンパー・全幅発光横一文字LEDテール・正方向C R O W Nレタリング・クロームロアバー"""
    # 1. ラップアラウンド曲面リアバンパー＆トランク背面（下端はフェンダーと 0.0mm 一致、上端はトランクデッキと 0.0mm 一致！）
    rear_grid = []
    for zi in range(N_SIDE_Z + 1):
        vz = zi / N_SIDE_Z
        row = []
        for ui in range(N_BUMPER_U + 1):
            u = lerp(-1.0, 1.0, ui / N_BUMPER_U)
            pt = eval_rear_bumper_pt(u, vz)
            v = bm.verts.new(pt)
            row.append(v)
            if ui in (0, N_BUMPER_U) or zi == N_SIDE_Z:
                shell_verts.append(v)
        rear_grid.append(row)

    # 全面 BodyPaint で滑らかに統一（角張った矩形の黒切り替わりを廃止し、専用スカルプトディフューザーパネルを重ねる）
    add_quad_grid(bm, rear_grid, mat_idx=mat_paint, smooth=True, flip=True)

    # 独立成型・滑らかに先細りするグロスブラックリアロアディフューザーバランス (u in [-0.82, +0.82])
    val_nu, val_nz = 26, 5
    val_grid = []
    for zi in range(val_nz + 1):
        tz = zi / val_nz
        row = []
        for ui in range(val_nu + 1):
            u_norm = lerp(-1.0, 1.0, ui / val_nu)
            ua = abs(u_norm)
            u_b = u_norm * 0.80
            # 両端に向かって優雅に低く絞り込む台形ロアバランス輪郭
            vz_top = lerp(0.225, 0.065, smoothstep((ua - 0.72) / 0.28))
            vz = lerp(0.00, vz_top, tz)
            pt = eval_rear_bumper_pt(u_b, vz)
            ang_out = u_b * (math.pi * 0.5)
            n_dir = Vector((math.sin(ang_out), math.cos(ang_out), 0.0))
            row.append(bm.verts.new(pt + n_dir * 0.0075))
        val_grid.append(row)
    add_quad_grid(bm, val_grid, mat_idx=mat_black, smooth=True, flip=True)
    val_top_edge = [v.co + Vector((0.0, 0.002, 0.0)) for v in val_grid[-1]]
    add_swept_tube(
        bm,
        val_top_edge,
        radius_x=0.0055,
        radius_y=0.0055,
        segments=8,
        mat_idx=mat_black,
        smooth=True,
    )

    # 2. 曲面トランクデッキ上面（後端 vi=n_v を rear_grid 上端と N_BUMPER_U 厳密一致で 0.0mm 溶着！隙間完全消滅！）
    n_v = 10
    deck_grid = []
    for vi in range(n_v + 1):
        vr = vi / n_v
        row = []
        for ui in range(N_BUMPER_U + 1):
            u = lerp(-1.0, 1.0, ui / N_BUMPER_U)
            ua = abs(u)
            p_rear = eval_rear_bumper_pt(u, 1.0)

            y_start = 1.845 - 0.055 * (ua**1.8)
            x_start = u * sample_curve(y_start, BELT_X_KNOTS)
            z_start = sample_curve(y_start, BELT_Z_KNOTS) + (1.0 - ua * ua) * 0.022

            y = lerp(y_start, p_rear.y, vr)
            x = lerp(x_start, p_rear.x, vr)
            z = lerp(z_start, p_rear.z, vr) + 0.012 * math.sin(vr * math.pi) * (
                1.0 - 0.35 * ua * ua
            )
            v = bm.verts.new(Vector((x, y, z)))
            row.append(v)
            if vi == n_v:
                shell_verts.append(v)
        deck_grid.append(row)

    add_quad_grid(bm, deck_grid, mat_idx=mat_paint, smooth=True, flip=False)

    # 3. 曲面追従フルワイド横一文字LEDリヤコンビネーションランプ（全幅 100% 鮮明発光！）
    # スモークブラックハウジングを表面 +0.008m に、クリムゾンLEDバーをさらに後方 (+0.021m) へ配置し埋没を完全解消
    housing_pts = []
    blade_main_pts = []
    chrome_accent_pts = []
    for i in range(33):
        u_norm = lerp(-1.0, 1.0, i / 32)
        u_b = u_norm * 0.85
        pt_m = eval_rear_bumper_pt(u_b, 0.900)
        ang_out = u_b * (math.pi * 0.5)
        n_dir = Vector((math.sin(ang_out), math.cos(ang_out), 0.0))
        housing_pts.append(pt_m + n_dir * 0.009)
        blade_main_pts.append(pt_m + n_dir * 0.024 + Vector((0.0, 0.0, 0.004)))
        chrome_accent_pts.append(pt_m + n_dir * 0.021 + Vector((0.0, 0.0, -0.015)))

    add_swept_tube(
        bm, housing_pts, radius_x=0.018, radius_y=0.030, segments=12, mat_idx=mat_black, smooth=True
    )
    add_swept_tube(
        bm,
        blade_main_pts,
        radius_x=0.0085,
        radius_y=0.0085,
        segments=10,
        mat_idx=mat_tail,
        smooth=True,
    )
    add_swept_tube(
        bm,
        chrome_accent_pts,
        radius_x=0.0032,
        radius_y=0.0032,
        segments=8,
        mat_idx=mat_chrome,
        smooth=True,
    )

    # 左右外側の立体ワイドL字シグネチャーLEDウィング（コーナーへ美しく回り込む）
    for side in (-1.0, 1.0):
        wing_pts = []
        for i in range(11):
            t = i / 10
            u_b = side * lerp(0.50, 0.85, t)
            pt_w = eval_rear_bumper_pt(u_b, 0.880)
            ang_out = u_b * (math.pi * 0.5)
            n_dir = Vector((math.sin(ang_out), math.cos(ang_out), 0.0))
            wing_pts.append(pt_w + n_dir * 0.024)
        add_swept_tube(
            bm, wing_pts, radius_x=0.011, radius_y=0.014, segments=10, mat_idx=mat_tail, smooth=True
        )

    # 4. リア中央トヨタ3楕円（Triple-Oval）クロームエンブレム（テールバー直上）＆ 正方向『C R O W N』レタリング
    p_top_emb = eval_rear_bumper_pt(0.0, 0.968)
    ey_emb = p_top_emb.y + 0.011
    ez_emb = p_top_emb.z
    # 外側横楕円・内側縦楕円・内側上部横楕円の3楕円リングでトヨタエンブレムを精密造形
    for rx, rz, dz_off, tube_r in [
        (0.028, 0.0185, 0.0, 0.0026),
        (0.0085, 0.0170, 0.0, 0.0022),
        (0.0205, 0.0068, 0.0068, 0.0022),
    ]:
        oval_pts = [
            Vector(
                (
                    math.cos(2.0 * math.pi * k / 20) * rx,
                    ey_emb,
                    ez_emb + dz_off + math.sin(2.0 * math.pi * k / 20) * rz,
                )
            )
            for k in range(21)
        ]
        add_swept_tube(
            bm,
            oval_pts,
            radius_x=tube_r,
            radius_y=tube_r,
            segments=8,
            mat_idx=mat_chrome,
            smooth=True,
            cap_ends=False,
        )

    # 正方向『C R O W N』立体レタリング（後方 +Y から -Y を見たとき左から C → R → O → W → N に読める！）
    add_crown_rear_lettering(bm, vz_letter=0.805, mat_chrome=mat_chrome)

    # リア右側 HEV エンブレムプレート（ダークエナメル台座＋クロームバーで鮮明に浮かび上がらせる）
    u_hev = rear_u_for_x(-0.56, 0.74)
    p_hev = eval_rear_bumper_pt(u_hev, 0.74)
    ang_hev = u_hev * (math.pi * 0.5)
    n_hev = Vector((math.sin(ang_hev), math.cos(ang_hev), 0.0))
    add_rounded_box(
        bm,
        center=p_hev + n_hev * 0.009,
        size=Vector((0.076, 0.007, 0.018)),
        bevel_r=0.003,
        mat_idx=mat_black,
        smooth=True,
        rot_euler=Euler((0.0, 0.0, -ang_hev), "XYZ"),
    )
    add_rounded_box(
        bm,
        center=p_hev + n_hev * 0.013,
        size=Vector((0.066, 0.005, 0.008)),
        bevel_r=0.002,
        mat_idx=mat_chrome,
        smooth=True,
        rot_euler=Euler((0.0, 0.0, -ang_hev), "XYZ"),
    )

    # 5. リセスドポケット内・リア日本規格ナンバープレート（正方向UV＋左上アルミ封印）
    p_plate = eval_rear_bumper_pt(0.0, 0.55)
    add_japanese_license_plate(
        bm,
        center=Vector((0.0, p_plate.y + 0.012, 0.595)),
        is_rear=True,
        mat_trim=mat_black,
        mat_plate=6,
        mat_chrome=mat_chrome,
    )

    # 6. リアバンパー下部・水平クロームアクセントバー＆左右スリムレッドリフレクター（ディフューザー内に完全収容）
    rear_chrome_pts = []
    for i in range(25):
        u_b = lerp(-0.66, 0.66, i / 24)
        pt_c = eval_rear_bumper_pt(u_b, 0.135)
        ang_out = u_b * (math.pi * 0.5)
        n_dir = Vector((math.sin(ang_out), math.cos(ang_out), 0.0))
        rear_chrome_pts.append(pt_c + n_dir * 0.014)
    add_swept_tube(
        bm,
        rear_chrome_pts,
        radius_x=0.0075,
        radius_y=0.0068,
        segments=10,
        mat_idx=mat_chrome,
        smooth=True,
    )

    for side in (-1.0, 1.0):
        ref_pts = []
        ref_bezel_pts = []
        for i in range(7):
            u_b = side * lerp(0.42, 0.64, i / 6)
            pt_r = eval_rear_bumper_pt(u_b, 0.200)
            p_prev = eval_rear_bumper_pt(u_b - 0.015, 0.200)
            p_next = eval_rear_bumper_pt(u_b + 0.015, 0.200)
            tang = Vector((p_next.x - p_prev.x, p_next.y - p_prev.y, 0.0)).normalized()
            n_dir = Vector((-tang.y, tang.x, 0.0)).normalized()
            ref_bezel_pts.append(pt_r + n_dir * 0.010)
            ref_pts.append(pt_r + n_dir * 0.0165)
        add_swept_tube(
            bm,
            ref_bezel_pts,
            radius_x=0.0095,
            radius_y=0.0095,
            segments=8,
            mat_idx=mat_black,
            smooth=True,
        )
        add_swept_tube(
            bm, ref_pts, radius_x=0.0060, radius_y=0.0060, segments=8, mat_idx=mat_tail, smooth=True
        )


def add_crown_rear_lettering(bm, vz_letter: float, mat_chrome: int):
    """リアテールバー直下に後方 (+Y -> -Y) から正読できる『C R O W N』クロームレリーフを配置
    Why +X -> -X 順に配置するか:
    車両後方 (+Y) から車両前方向 (-Y) を見ると、画面左が +X、画面右が -X となるため、
    C(+0.18), R(+0.09), O(0.0), W(-0.09), N(-0.18) の順に並べ各文字の左右軸を -X = 右 で定義する。
    """
    h = 0.021
    w = 0.020
    t = 0.0040
    d = 0.008

    def pt_at(x_val: float, dz: float) -> Vector:
        u_b = rear_u_for_x(x_val, vz_letter)
        base = eval_rear_bumper_pt(u_b, vz_letter)
        ang_out = u_b * (math.pi * 0.5)
        return base + Vector((math.sin(ang_out) * 0.007, math.cos(ang_out) * 0.007, dz))

    def seg(x0: float, z0: float, x1: float, z1: float):
        add_swept_tube(
            bm,
            [pt_at(x0, z0), pt_at(x1, z1)],
            radius_x=t * 0.55,
            radius_y=d * 0.45,
            segments=6,
            mat_idx=mat_chrome,
            smooth=True,
        )

    # 注意: 後方から見た「左」は +dx、「右」は -dx
    # C (center x = +0.18)
    cx = 0.18
    seg(cx - w * 0.42, h * 0.45, cx + w * 0.42, h * 0.45)
    seg(cx + w * 0.42, h * 0.45, cx + w * 0.42, -h * 0.45)
    seg(cx + w * 0.42, -h * 0.45, cx - w * 0.42, -h * 0.45)

    # R (center x = +0.09)
    cx = 0.09
    seg(cx + w * 0.42, h * 0.46, cx + w * 0.42, -h * 0.46)
    seg(cx + w * 0.42, h * 0.46, cx - w * 0.36, h * 0.46)
    seg(cx - w * 0.36, h * 0.46, cx - w * 0.36, h * 0.02)
    seg(cx - w * 0.36, h * 0.02, cx + w * 0.42, h * 0.02)
    seg(cx - w * 0.02, h * 0.02, cx - w * 0.42, -h * 0.46)

    # O (center x = 0.00) — 他文字と同じ線幅・高さの端正なオーバルリング
    o_pts = [
        pt_at(
            math.cos(2.0 * math.pi * k / 16) * (w * 0.44),
            math.sin(2.0 * math.pi * k / 16) * (h * 0.46),
        )
        for k in range(17)
    ]
    add_swept_tube(
        bm,
        o_pts,
        radius_x=t * 0.55,
        radius_y=d * 0.45,
        segments=6,
        mat_idx=mat_chrome,
        smooth=True,
        cap_ends=False,
    )

    # W (center x = -0.09)
    cx = -0.09
    seg(cx + w * 0.52, h * 0.46, cx + w * 0.26, -h * 0.46)
    seg(cx + w * 0.26, -h * 0.46, cx, h * 0.20)
    seg(cx, h * 0.20, cx - w * 0.26, -h * 0.46)
    seg(cx - w * 0.26, -h * 0.46, cx - w * 0.52, h * 0.46)

    # N (center x = -0.18)
    cx = -0.18
    seg(cx + w * 0.42, -h * 0.46, cx + w * 0.42, h * 0.46)
    seg(cx + w * 0.42, h * 0.46, cx - w * 0.42, -h * 0.46)
    seg(cx - w * 0.42, -h * 0.46, cx - w * 0.42, h * 0.46)


def add_crown_emblem_sculpted(
    bm,
    center: Vector,
    scale: float,
    axis_y_dir: float,
    pitch_rad: float,
    mat_chrome: int,
    mat_back: int = -1,
):
    """トヨタ クラウン伝統の『王冠（Crown）エンブレム』を曲面台座＋傾斜5本ティアラ形状の立体レリーフとして造形"""
    rot = Euler((axis_y_dir * pitch_rad, 0.0, 0.0), "XYZ").to_matrix()

    def xf(lx: float, ly: float, lz: float) -> Vector:
        return center + (rot @ Vector((lx * scale, ly * axis_y_dir * scale, lz * scale)))

    if mat_back >= 0:
        add_rounded_box(
            bm,
            center=xf(0.0, 0.002, 0.0),
            size=Vector((0.058 * scale, 0.009 * scale, 0.044 * scale)),
            bevel_r=0.008 * scale,
            mat_idx=mat_back,
            smooth=True,
            rot_euler=Euler((axis_y_dir * pitch_rad, 0.0, 0.0), "XYZ"),
        )

    band_pts = [
        xf(lx, 0.007, -0.011 + 0.0025 * (lx / 0.022) ** 2)
        for lx in (-0.021, -0.010, 0.0, 0.010, 0.021)
    ]
    add_swept_tube(
        bm,
        band_pts,
        radius_x=0.0028 * scale,
        radius_y=0.0026 * scale,
        segments=8,
        mat_idx=mat_chrome,
        smooth=True,
    )

    for x0, x1, z_top in [
        (-0.016, -0.021, 0.006),
        (-0.008, -0.011, 0.011),
        (0.000, 0.000, 0.014),
        (0.008, 0.011, 0.011),
        (0.016, 0.021, 0.006),
    ]:
        add_swept_tube(
            bm,
            [xf(x0, 0.007, -0.010), xf(x1, 0.0075, z_top)],
            radius_x=0.0024 * scale,
            radius_y=0.0024 * scale,
            segments=8,
            mat_idx=mat_chrome,
            smooth=True,
        )


def add_japanese_license_plate(
    bm,
    center: Vector,
    is_rear: bool,
    mat_trim: int,
    mat_plate: int,
    mat_chrome: int,
):
    """日本規格ナンバープレート（実寸 330mm x 165mm）を正方向UV展開済み高解像度画像面・フレーム・ボルト＆封印付きで造形
    Why フロントは x_left=-hw..x_right=+hw、リアは x_left=+hw..x_right=-hw とするか:
    - フロント正面 (-Y) から +Y 方向を見ると画面左が -X、画面右が +X。
    - リア正面 (+Y) から -Y 方向を見ると画面左が +X、画面右が -X。
    それぞれ UV=(0,0)..(1,1) を正読方向に合わせて配置し、法線が必ず外向きになる頂点順序とする。
    """
    dir_y = 1.0 if is_rear else -1.0
    uv_layer = bm.loops.layers.uv.verify()

    # 1. スリムベベル・ピアノブラックナンバーフレーム＆背面台座 (340mm x 174mm)
    add_rounded_box(
        bm,
        center=center - Vector((0.0, dir_y * 0.006, 0.0)),
        size=Vector((0.340, 0.022, 0.174)),
        bevel_r=0.004,
        mat_idx=mat_trim,
        smooth=True,
    )

    hw, hh = 0.165, 0.0825
    y_back = center.y + dir_y * 0.002
    y_face = center.y + dir_y * 0.0085

    if is_rear:
        # 後方 (+Y) から見て左が +X、右が -X
        x_left, x_right = center.x + hw, center.x - hw
    else:
        # 前方 (-Y) から見て左が -X、右が +X
        x_left, x_right = center.x - hw, center.x + hw

    vb_l = bm.verts.new(Vector((x_left, y_face, center.z - hh)))
    vb_r = bm.verts.new(Vector((x_right, y_face, center.z - hh)))
    vt_r = bm.verts.new(Vector((x_right, y_face, center.z + hh)))
    vt_l = bm.verts.new(Vector((x_left, y_face, center.z + hh)))

    # 検証:
    # フロント (-Y外向き): (vb_r - vb_l) = (+2hw, 0, 0), (vt_l - vb_l) = (0, 0, +2hh) -> cross = (0, -4hw*hh, 0) = -Y (外向き!)
    # リア (+Y外向き): (vb_r - vb_l) = (-2hw, 0, 0), (vt_l - vb_l) = (0, 0, +2hh) -> cross = (0, +4hw*hh, 0) = +Y (外向き!)
    face_verts = [vb_l, vb_r, vt_r, vt_l]
    face_uvs = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
    f_plate = bm.faces.new(face_verts)
    f_plate.material_index = mat_plate
    f_plate.smooth = False
    for loop, uv in zip(f_plate.loops, face_uvs, strict=True):
        loop[uv_layer].uv = uv

    bb_l = bm.verts.new(Vector((x_left, y_back, center.z - hh)))
    bb_r = bm.verts.new(Vector((x_right, y_back, center.z - hh)))
    bt_r = bm.verts.new(Vector((x_right, y_back, center.z + hh)))
    bt_l = bm.verts.new(Vector((x_left, y_back, center.z + hh)))
    for side_quad in [
        [bb_l, vb_l, vb_r, bb_r],
        [bt_l, bt_r, vt_r, vt_l],
        [bb_l, bt_l, vt_l, vb_l],
        [bb_r, vb_r, vt_r, bt_r],
    ]:
        safe_face(bm, side_quad, mat_idx=mat_trim, smooth=False)

    # 上部左右のステンレス取付ボルト＆リア左上のアルミ封印キャップ（リアから見て左上は +X 側！）
    bolt_y = y_face + dir_y * 0.0025
    for bx in (-0.105, 0.105):
        is_seal = is_rear and bx > 0
        bolt_r = 0.0090 if is_seal else 0.0055
        bolt_h = 0.0068 if is_seal else 0.0040
        add_cylinder(
            bm,
            center=Vector((center.x + bx, bolt_y, center.z + 0.060)),
            radius=bolt_r,
            height=bolt_h,
            segments=16,
            axis="Y",
            mat_idx=mat_chrome,
            smooth=True,
        )


def build_underbody_floor_and_rockers(bm, mat_paint=0, mat_black=1, mat_chrome=2):
    """フラットアンダーボディ（Z=0.178m 厳密保証）＆左右エアロロッカーモール＆ドアハンドルを構築"""
    under_stations = [
        (-2.22, 0.58),
        (-1.85, 0.60),
        (-1.39, 0.60),
        (-0.96, 0.60),
        (-0.85, 0.85),
        (0.00, 0.85),
        (0.85, 0.85),
        (0.96, 0.60),
        (1.39, 0.60),
        (1.85, 0.60),
        (2.22, 0.58),
    ]
    rows = [
        [bm.verts.new(Vector((-hw, y, ROCKER_Z))), bm.verts.new(Vector((hw, y, ROCKER_Z)))]
        for y, hw in under_stations
    ]
    for i in range(len(rows) - 1):
        safe_face(
            bm,
            [rows[i][0], rows[i][1], rows[i + 1][1], rows[i + 1][0]],
            mat_idx=mat_black,
            smooth=False,
        )

    for side in (-1.0, 1.0):
        rocker_pts = []
        chrome_pts = []
        for i in range(13):
            y = lerp(-0.94, 0.94, i / 12)
            x_base = eval_side_x(y, ROCKER_Z + 0.025)
            rocker_pts.append(Vector((side * (x_base + 0.005), y, ROCKER_Z + 0.012)))
            chrome_pts.append(Vector((side * (x_base + 0.015), y, ROCKER_Z + 0.024)))
        add_swept_tube(
            bm,
            rocker_pts,
            radius_x=0.016,
            radius_y=0.014,
            segments=8,
            mat_idx=mat_black,
            smooth=True,
        )
        add_swept_tube(
            bm,
            chrome_pts,
            radius_x=0.0052,
            radius_y=0.0052,
            segments=8,
            mat_idx=mat_chrome,
            smooth=True,
        )

        # クラウン セダン象徴のフロントフェンダー縦型サイドガーニッシュ（曲面密着）
        gx = eval_side_x(-0.90, 0.56) + 0.002
        add_rounded_box(
            bm,
            Vector((side * gx, -0.90, 0.56)),
            Vector((0.010, 0.030, 0.210)),
            bevel_r=0.0035,
            mat_idx=mat_black,
            smooth=True,
        )
        add_rounded_box(
            bm,
            Vector((side * (gx + 0.0045), -0.90, 0.56)),
            Vector((0.0045, 0.010, 0.180)),
            bevel_r=0.0018,
            mat_idx=mat_chrome,
            smooth=True,
        )

        # 前後ドア・フラッシュスカルプトグリップハンドル
        for door_y in (-0.16, 0.58):
            hz = 0.778 if door_y < 0 else 0.790
            hx = eval_side_x(door_y, hz)
            add_rounded_box(
                bm,
                Vector((side * (hx - 0.001), door_y, hz - 0.004)),
                Vector((0.010, 0.125, 0.034)),
                bevel_r=0.004,
                mat_idx=mat_black,
                smooth=True,
            )
            handle_pts = [
                Vector((side * (hx + 0.004), door_y - 0.078, hz)),
                Vector((side * (hx + 0.017), door_y - 0.045, hz)),
                Vector((side * (hx + 0.019), door_y + 0.015, hz)),
                Vector((side * (hx + 0.015), door_y + 0.055, hz)),
                Vector((side * (hx + 0.004), door_y + 0.078, hz)),
            ]
            add_swept_tube(
                bm,
                handle_pts,
                radius_x=0.009,
                radius_y=0.012,
                segments=10,
                mat_idx=mat_paint,
                smooth=True,
            )
            chrome_h_pts = [
                Vector((side * (hx + 0.022), door_y - 0.062, hz + 0.007)),
                Vector((side * (hx + 0.024), door_y, hz + 0.007)),
                Vector((side * (hx + 0.021), door_y + 0.062, hz + 0.007)),
            ]
            add_swept_tube(
                bm,
                chrome_h_pts,
                radius_x=0.0030,
                radius_y=0.0030,
                segments=8,
                mat_idx=mat_chrome,
                smooth=True,
            )


# ==============================================================================
# 5. 6ライト・ファストバックグリーンハウス（ピラー飛び出しゼロの洗練ルーフライン）
# ==============================================================================

ROOF_KNOTS_HW = [
    (-0.48, 0.672),
    (-0.18, 0.680),
    (0.18, 0.678),
    (0.55, 0.658),
    (0.94, 0.624),
]
ROOF_KNOTS_ZS = [
    (-0.48, 1.418),
    (-0.18, 1.444),
    (0.18, 1.450),
    (0.55, 1.426),
    (0.94, 1.370),
]
ROOF_KNOTS_ZM = [
    (-0.48, 1.442),
    (-0.18, 1.476),
    (0.18, 1.486),
    (0.55, 1.462),
    (0.94, 1.406),
]


def eval_roof_surface(u: float, vr: float) -> Vector:
    """ルーフ外皮曲面点 (u in [-1, 1], vr in [0, 1]) を評価"""
    ua = abs(u)
    y_front = -0.480 - 0.055 * math.cos(ua * math.pi * 0.5)
    y_rear = 0.940 + 0.032 * math.cos(ua * math.pi * 0.5)
    y = lerp(y_front, y_rear, vr)
    y_eval = lerp(-0.48, 0.94, vr)
    hw = sample_curve(y_eval, ROOF_KNOTS_HW)
    zs = sample_curve(y_eval, ROOF_KNOTS_ZS)
    zm = sample_curve(y_eval, ROOF_KNOTS_ZM)
    x = u * hw
    z = zs + (zm - zs) * math.cos(ua * math.pi * 0.5)
    return Vector((x, y, z))


def build_curved_roof_and_pillars(bm, mat_paint=0, mat_black=1, mat_chrome=2, mat_tail=5):
    """16×14高分割ドームルーフ、ルーフ下完全収まりのフラッシュA/Bピラー、一体Cピラーセイル、連続クロームモールを構築"""
    n_u, n_v = 14, 16
    thick = 0.030

    top_grid, bot_grid = [], []
    for vi in range(n_v + 1):
        vr = vi / n_v
        t_row, b_row = [], []
        for ui in range(n_u + 1):
            u = lerp(-1.0, 1.0, ui / n_u)
            pt = eval_roof_surface(u, vr)
            t_row.append(bm.verts.new(pt))
            b_row.append(bm.verts.new(pt - Vector((0.0, 0.0, thick))))
        top_grid.append(t_row)
        bot_grid.append(b_row)

    add_quad_grid(bm, top_grid, mat_idx=mat_paint, smooth=True, flip=False)
    add_quad_grid(bm, bot_grid, mat_idx=mat_black, smooth=True, flip=True)

    for ui in range(n_u):
        safe_face(
            bm,
            [top_grid[0][ui], top_grid[0][ui + 1], bot_grid[0][ui + 1], bot_grid[0][ui]],
            mat_idx=mat_black,
            smooth=False,
        )
        safe_face(
            bm,
            [top_grid[-1][ui], bot_grid[-1][ui], bot_grid[-1][ui + 1], top_grid[-1][ui + 1]],
            mat_idx=mat_black,
            smooth=False,
        )
    for vi in range(n_v):
        safe_face(
            bm,
            [top_grid[vi][0], bot_grid[vi][0], bot_grid[vi + 1][0], top_grid[vi + 1][0]],
            mat_idx=mat_paint,
            smooth=True,
        )
        safe_face(
            bm,
            [top_grid[vi][-1], top_grid[vi + 1][-1], bot_grid[vi + 1][-1], bot_grid[vi][-1]],
            mat_idx=mat_paint,
            smooth=True,
        )

    # エアロ流線形シャークフィンアンテナ
    fin_stations = [
        (0.68, 0.004, 0.004, 0.002),
        (0.73, 0.015, 0.018, 0.003),
        (0.79, 0.018, 0.040, 0.003),
        (0.85, 0.016, 0.056, 0.003),
        (0.89, 0.010, 0.058, 0.002),
        (0.91, 0.002, 0.012, 0.001),
    ]
    fin_rings = []
    for fy, fhw, fh, ftop_hw in fin_stations:
        vr_f = clamp01((fy - (-0.535)) / (0.972 - (-0.535)))
        z_base = eval_roof_surface(0.0, vr_f).z - 0.004
        fin_rings.append(
            [
                bm.verts.new(Vector((-fhw, fy, z_base))),
                bm.verts.new(Vector((-fhw * 0.72, fy, z_base + fh * 0.55))),
                bm.verts.new(Vector((-ftop_hw, fy, z_base + fh))),
                bm.verts.new(Vector((ftop_hw, fy, z_base + fh))),
                bm.verts.new(Vector((fhw * 0.72, fy, z_base + fh * 0.55))),
                bm.verts.new(Vector((fhw, fy, z_base))),
            ]
        )
    for i in range(len(fin_rings) - 1):
        r0, r1 = fin_rings[i], fin_rings[i + 1]
        for j in range(len(r0)):
            nj = (j + 1) % len(r0)
            safe_face(bm, [r0[j], r0[nj], r1[nj], r1[j]], mat_idx=mat_paint, smooth=True)
    safe_face(bm, list(reversed(fin_rings[0])), mat_idx=mat_paint, smooth=False)
    safe_face(bm, fin_rings[-1], mat_idx=mat_paint, smooth=False)

    # ハイマウントストップランプ（リアガラス上端ルーフ後縁）
    hmsl_pts = [
        Vector((lerp(-0.20, 0.20, i / 8), 0.968 - 0.006 * (lerp(-1.0, 1.0, i / 8) ** 2), 1.384))
        for i in range(9)
    ]
    add_swept_tube(
        bm, hmsl_pts, radius_x=0.008, radius_y=0.008, segments=8, mat_idx=mat_tail, smooth=True
    )

    for side in (-1.0, 1.0):
        # 1) フラッシュAピラー（ルーフ前端の曲率へ連続フィレット接続し、角ばりを完全排除）
        a_pts = []
        a_in_pts = []
        for i in range(13):
            t = i / 12
            if t <= 0.85:
                s = t / 0.85
                ay = lerp(-1.265, -0.492, s)
                az = lerp(0.868, 1.404, s) + math.sin(s * math.pi) * 0.018
                ax = side * lerp(0.750, 0.665, s)
            else:
                s = (t - 0.85) / 0.15
                pt_r = eval_roof_surface(side * 1.0, s * 0.10)
                ay = lerp(-0.492, pt_r.y, s)
                az = lerp(1.404, pt_r.z - 0.010, s)
                ax = side * lerp(0.665, abs(pt_r.x) - 0.004, s)
            a_pts.append(Vector((ax, ay, az)))
            a_in_pts.append(Vector((side * (abs(ax) - 0.015), ay + 0.024, az - 0.010)))
        add_swept_tube(
            bm, a_pts, radius_x=0.018, radius_y=0.022, segments=10, mat_idx=mat_paint, smooth=True
        )
        add_swept_tube(
            bm, a_in_pts, radius_x=0.016, radius_y=0.018, segments=8, mat_idx=mat_black, smooth=True
        )

        # 2) フラッシュ・グロスブラックBピラー（サイドガラスと面一のリボン断面、ルーフ下 Z=1.434m で収束し飛び出しゼロ！）
        b_grid = []
        for vi in range(11):
            v = vi / 10
            by_c = lerp(0.158, 0.195, v)
            bz = lerp(0.868, 1.434, v)
            bx_surf = lerp(0.848, 0.674, v) + math.sin(v * math.pi) * 0.020
            half_w = lerp(0.044, 0.036, v)
            row = [
                bm.verts.new(Vector((side * (bx_surf - 0.010), by_c - half_w, bz))),
                bm.verts.new(Vector((side * (bx_surf + 0.002), by_c - half_w * 0.7, bz))),
                bm.verts.new(Vector((side * (bx_surf + 0.002), by_c + half_w * 0.7, bz))),
                bm.verts.new(Vector((side * (bx_surf - 0.010), by_c + half_w, bz))),
            ]
            b_grid.append(row)
        add_quad_grid(bm, b_grid, mat_idx=mat_black, smooth=True, flip=(side > 0))

        # 3) 6ライトウィンドウ用フラッシュ・リアドアディバイダーバー（ルーフ下 Z=1.366m で綺麗に収束）
        d_grid = []
        for vi in range(11):
            v = vi / 10
            dy_c = lerp(0.950, 0.900, v)
            dz = lerp(0.892, 1.366, v)
            dx_surf = lerp(0.848, 0.624, v) + math.sin(v * math.pi) * 0.018
            half_w = 0.015
            row = [
                bm.verts.new(Vector((side * (dx_surf - 0.008), dy_c - half_w, dz))),
                bm.verts.new(Vector((side * (dx_surf + 0.0015), dy_c - half_w * 0.6, dz))),
                bm.verts.new(Vector((side * (dx_surf + 0.0015), dy_c + half_w * 0.6, dz))),
                bm.verts.new(Vector((side * (dx_surf - 0.008), dy_c + half_w, dz))),
            ]
            d_grid.append(row)
        add_quad_grid(bm, d_grid, mat_idx=mat_black, smooth=True, flip=(side > 0))

        # 4) スカルプト一体型ファストバックCピラーセイルパネル
        n_c = 12
        c_front_out, c_rear_out, c_rear_in, c_front_in = [], [], [], []
        for ci in range(n_c + 1):
            t = ci / n_c
            arch = math.sin(t * math.pi)
            yi = lerp(0.940, 1.815, t)
            zi = lerp(1.370, 0.944, t) + arch * 0.026
            xi = side * (lerp(0.620, 0.728, t) + arch * 0.010)

            sail_width_y = lerp(0.11, 0.24, smoothstep(t))
            yo = yi + sail_width_y * 0.35
            yf = yi - sail_width_y * 0.65
            zf = lerp(1.368, 0.930, t) + arch * 0.022
            xf = side * (lerp(0.624, 0.844, t) + arch * 0.018)
            xo = side * (lerp(0.624, 0.838, t) + arch * 0.015)

            c_front_out.append(bm.verts.new(Vector((xf, yf, zf))))
            c_rear_out.append(bm.verts.new(Vector((xo, yo, lerp(zi, zf, 0.35) + 0.006))))
            c_rear_in.append(bm.verts.new(Vector((xi, yi, zi))))
            c_front_in.append(
                bm.verts.new(Vector((side * (abs(xf) - 0.042), yf + 0.02, zf - 0.028)))
            )

        flip_c = side < 0
        for ci in range(n_c):
            for r_a, r_b, m_idx in [
                (c_front_out, c_rear_out, mat_paint),
                (c_rear_out, c_rear_in, mat_paint),
                (c_rear_in, c_front_in, mat_black),
                (c_front_in, c_front_out, mat_black),
            ]:
                verts = (
                    [r_a[ci], r_b[ci], r_b[ci + 1], r_a[ci + 1]]
                    if flip_c
                    else [r_a[ci], r_a[ci + 1], r_b[ci + 1], r_b[ci]]
                )
                safe_face(bm, verts, mat_idx=m_idx, smooth=(m_idx == mat_paint))

        # 5) 6ライトウィンドウ全周を滑らかに縁取る連続クロームモールディング（A/Bピラー・ディバイダーの上を連続で包む）
        belt_chrome_pts = []
        belt_rubber_pts = []
        for i in range(19):
            y = lerp(-1.24, 1.56, i / 18)
            zb = sample_curve(y, BELT_Z_KNOTS)
            xb = sample_curve(y, BELT_X_KNOTS)
            belt_chrome_pts.append(Vector((side * (xb + 0.005), y, zb + 0.004)))
            belt_rubber_pts.append(Vector((side * (xb - 0.012), y, zb + 0.005)))
        add_swept_tube(
            bm,
            belt_chrome_pts,
            radius_x=0.0068,
            radius_y=0.0075,
            segments=8,
            mat_idx=mat_chrome,
            smooth=True,
        )
        add_swept_tube(
            bm,
            belt_rubber_pts,
            radius_x=0.013,
            radius_y=0.010,
            segments=8,
            mat_idx=mat_black,
            smooth=True,
        )

        upper_arch_pts = []
        for i in range(7):
            t = i / 6
            ay = lerp(-1.24, -0.48, t)
            az = lerp(0.876, 1.414, t) + math.sin(t * math.pi) * 0.018
            ax = side * lerp(0.766, 0.676, t)
            upper_arch_pts.append(Vector((ax, ay, az)))
        for i in range(1, 9):
            vr = i / 8
            pt = eval_roof_surface(side * 1.0, vr)
            upper_arch_pts.append(Vector((side * (abs(pt.x) + 0.006), pt.y, pt.z - 0.005)))
        for i in range(1, 8):
            t = i / 7
            arch = math.sin(t * math.pi)
            qy = lerp(0.94, 1.56, t)
            qz = lerp(1.364, sample_curve(1.56, BELT_Z_KNOTS) + 0.006, t) + arch * 0.016
            qx = side * (lerp(0.628, sample_curve(1.56, BELT_X_KNOTS) + 0.005, t) + arch * 0.014)
            upper_arch_pts.append(Vector((qx, qy, qz)))
        add_swept_tube(
            bm,
            upper_arch_pts,
            radius_x=0.0072,
            radius_y=0.0080,
            segments=8,
            mat_idx=mat_chrome,
            smooth=True,
        )


# ==============================================================================
# 6. 流線形エアロドアミラー（RHD UN R46 視界座標厳守）
# ==============================================================================


def build_aerodynamic_door_mirrors(bm, mat_paint=0, mat_black=1, mat_hl=4):
    """左右の流線形エアロドアミラーを構築（右: Y=-1.005m, yaw=-22° / 左: Y=-0.880m, yaw=+27° を厳密保持）"""
    for side in (-1.0, 1.0):
        is_left_mirror = side > 0
        mirror_y = -0.880 if is_left_mirror else -1.005
        gusset_y = -0.952 if is_left_mirror else -1.078
        yaw_deg = 27.0 if is_left_mirror else 22.0
        yaw_angle = side * math.radians(yaw_deg)
        cos_y, sin_y = math.cos(yaw_angle), math.sin(yaw_angle)
        pivot = Vector((side * 0.918, mirror_y, 0.962))

        def xf(lx: float, ly: float, lz: float, _cy=cos_y, _sy=sin_y, _p=pivot) -> Vector:
            rx = lx * _cy - ly * _sy
            ry = lx * _sy + ly * _cy
            return _p + Vector((rx, ry, lz))

        base_pts = [
            Vector((side * 0.840, gusset_y - 0.095, 0.870)),
            Vector((side * 0.858, gusset_y - 0.025, 0.873)),
            Vector((side * 0.852, gusset_y + 0.055, 0.872)),
        ]
        add_swept_tube(
            bm,
            base_pts,
            radius_x=0.026,
            radius_y=0.018,
            segments=10,
            mat_idx=mat_black,
            smooth=True,
        )

        stalk_pts = [
            Vector((side * 0.835, gusset_y, 0.874)),
            Vector((side * 0.865, lerp(gusset_y, mirror_y, 0.45), 0.904)),
            xf(-side * 0.032, -0.022, -0.036),
            xf(-side * 0.028, -0.020, -0.020),
        ]
        add_swept_tube(
            bm,
            stalk_pts,
            radius_x=0.020,
            radius_y=0.024,
            segments=12,
            mat_idx=mat_black,
            smooth=True,
        )

        out_x = side * 0.086
        n_seg = 20

        def housing_ring(
            y_off: float, sx: float, sz: float, z_sh: float = 0.0, _s=side, _xf=xf, _n_seg=n_seg
        ):
            verts = []
            for k in range(_n_seg):
                ang = (2.0 * math.pi * k) / _n_seg
                ca, sa = math.cos(ang), math.sin(ang)
                lx = (0.086 * sx) * math.copysign(abs(ca) ** 0.78, ca)
                lz = (0.050 * sz) * math.copysign(abs(sa) ** 0.80, sa) + z_sh
                if lx * _s > 0:
                    lz *= 0.92
                verts.append(bm.verts.new(_xf(lx, y_off, lz)))
            return verts

        r_in_vis = housing_ring(0.004, 0.88, 0.86, 0.0)
        r_rear = housing_ring(0.018, 1.00, 1.00, 0.0)
        r_mid1 = housing_ring(-0.012, 1.03, 1.03, 0.001)
        r_mid2 = housing_ring(-0.044, 0.94, 0.92, -0.002)
        r_front = housing_ring(-0.068, 0.64, 0.60, -0.005)
        v_nose_tip = bm.verts.new(xf(side * 0.008, -0.078, -0.006))

        for r0, r1 in [(r_rear, r_mid1), (r_mid1, r_mid2), (r_mid2, r_front)]:
            for k in range(n_seg):
                nk = (k + 1) % n_seg
                avg_z = (r0[k].co.z + r0[nk].co.z + r1[nk].co.z + r1[k].co.z) * 0.25
                mat_u = mat_paint if avg_z >= pivot.z - 0.006 else mat_black
                safe_face(bm, [r0[k], r0[nk], r1[nk], r1[k]], mat_idx=mat_u, smooth=True)

        for k in range(n_seg):
            nk = (k + 1) % n_seg
            avg_z = (r_front[k].co.z + r_front[nk].co.z + v_nose_tip.co.z) / 3.0
            mat_u = mat_paint if avg_z >= pivot.z - 0.006 else mat_black
            safe_face(bm, [r_front[k], r_front[nk], v_nose_tip], mat_idx=mat_u, smooth=True)

        for k in range(n_seg):
            nk = (k + 1) % n_seg
            safe_face(
                bm,
                [r_in_vis[k], r_in_vis[nk], r_rear[nk], r_rear[k]],
                mat_idx=mat_black,
                smooth=True,
            )
        safe_face(bm, list(reversed(r_in_vis)), mat_idx=mat_black, smooth=False)

        led_pts = [
            xf(out_x * 0.12, -0.072, -0.003),
            xf(out_x * 0.56, -0.068, -0.002),
            xf(out_x * 0.88, -0.048, 0.000),
            xf(out_x * 1.00, -0.018, 0.001),
        ]
        add_swept_tube(
            bm, led_pts, radius_x=0.0045, radius_y=0.0045, segments=8, mat_idx=mat_hl, smooth=True
        )


# ==============================================================================
# 7. Chassis 統合ビルダー（Class-A シェル頂点溶着込み）
# ==============================================================================


def build_chassis(materials) -> bpy.types.Object:
    """トヨタ クラウン セダン (AZSH32) 外装ボディ (Chassis) を構築"""
    mesh = bpy.data.meshes.new("ChassisMesh")
    bm = bmesh.new()

    mat_keys = [
        "BodyPaint",
        "BlackTrim",
        "Chrome",
        "WindowGlass",
        "HeadlightLED",
        "TaillightLED",
        "JdmPlateWhite",
        "JdmPlateGreen",
        "MirrorGlass",
    ]

    # ボディ外皮境界頂点を記録して最後に 2mm 以内で溶着し、バンパー/フェンダー/ドア/フード/トランクの陰影を完全連続化
    shell_verts: list = []

    for side in (-1.0, 1.0):
        build_fender_with_wheel_arch(
            bm,
            side=side,
            wy=WHEEL_Y_FRONT,
            y_start=-1.94,
            y_end=-0.85,
            shell_verts=shell_verts,
            mat_paint=0,
            mat_black=1,
        )
        build_fender_with_wheel_arch(
            bm,
            side=side,
            wy=WHEEL_Y_REAR,
            y_start=0.85,
            y_end=1.94,
            shell_verts=shell_verts,
            mat_paint=0,
            mat_black=1,
        )
        build_side_door_panels(
            bm,
            side=side,
            y_front=-0.85,
            y_rear=0.85,
            shell_verts=shell_verts,
            mat_paint=0,
            mat_black=1,
        )

    build_front_hood_and_bumper(
        bm, shell_verts=shell_verts, mat_paint=0, mat_black=1, mat_chrome=2, mat_hl=4
    )
    build_rear_deck_and_bumper(
        bm, shell_verts=shell_verts, mat_paint=0, mat_black=1, mat_chrome=2, mat_tail=5
    )

    # ボディ外皮の共通境界頂点のみ溶着（ナンバープレート等の独立パーツは UV を損なわないよう対象外）
    unique_shell = list({v for v in shell_verts if v.is_valid})
    bmesh.ops.remove_doubles(bm, verts=unique_shell, dist=0.0025)

    build_underbody_floor_and_rockers(bm, mat_paint=0, mat_black=1, mat_chrome=2)
    build_curved_roof_and_pillars(bm, mat_paint=0, mat_black=1, mat_chrome=2, mat_tail=5)
    build_aerodynamic_door_mirrors(bm, mat_paint=0, mat_black=1, mat_hl=4)

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("Chassis", mesh)
    for k in mat_keys:
        obj.data.materials.append(materials[k])

    bpy.context.scene.collection.objects.link(obj)
    return obj


# ==============================================================================
# 8. 右ハンドル (RHD) クラウン「アイランドアーキテクチャー」内装 (Interior)
# ==============================================================================


def build_interior(materials) -> bpy.types.Object:
    """日本の右ハンドル (RHD: X = -0.38m) 専用 トヨタ クラウン セダン (AZSH32) 内装
    Why ドア内張りパネルを Y = -0.88 .. +0.94 のキャビン内へ厳密制限するか:
    前後ホイールハウス開口 (Y < -0.98 / Y > +0.98) へ内装ドアトリムがはみ出すと、
    タイヤハウス内側から車体の内張りが露出してしまうため、キャビンバスタブ内へ厳密に収める。
    """
    mesh = bpy.data.meshes.new("InteriorMesh")
    bm = bmesh.new()

    mat_keys = [
        "InteriorDark",
        "InteriorSeat",
        "MeterBack",
        "DashboardScreen",
        "GaugeNeedleRed",
        "Chrome",
        "CrownWoodTrim",
        "AmbientStripLED",
        "AlcantaraTrim",
        "SaddleStitch",
        "SilverTrim",
    ]

    # キャビンフロア（前後ホイールハウス間 Y = -0.88 .. +1.15 に厳密収容）
    add_box(
        bm,
        center=Vector((0.0, 0.14, 0.35)),
        size=Vector((1.54, 2.02, 0.07)),
        mat_idx=0,
        smooth=False,
    )
    for side in (-1.0, 1.0):
        # Aピラー車内側アルカンターラ調内張り
        a_in_pts = [
            Vector(
                (
                    side * lerp(0.715, 0.630, t / 6),
                    lerp(-1.22, -0.48, t / 6),
                    lerp(0.87, 1.385, t / 6) + math.sin((t / 6) * math.pi) * 0.012,
                )
            )
            for t in range(7)
        ]
        add_swept_tube(
            bm, a_in_pts, radius_x=0.021, radius_y=0.026, segments=10, mat_idx=8, smooth=True
        )
        add_cylinder(
            bm,
            Vector((side * 0.692, -1.08, 0.95)),
            0.022,
            0.012,
            segments=18,
            axis="X",
            mat_idx=10,
            smooth=True,
        )

        # ドア内張りロア〜アッパーパネル（Y = -0.88 .. +0.92 に厳密制限し、ホイールハウスへの飛び出しを完全根絶！）
        add_rounded_box(
            bm,
            Vector((side * 0.775, 0.02, 0.62)),
            Vector((0.095, 1.80, 0.46)),
            bevel_r=0.014,
            mat_idx=0,
            smooth=True,
        )
        add_rounded_box(
            bm,
            Vector((side * 0.770, 0.02, 0.858)),
            Vector((0.088, 1.78, 0.048)),
            bevel_r=0.012,
            mat_idx=1,
            smooth=True,
        )
        add_box(bm, Vector((side * 0.728, 0.02, 0.872)), Vector((0.005, 1.70, 0.004)), mat_idx=9)
        add_rounded_box(
            bm,
            Vector((side * 0.738, -0.10, 0.804)),
            Vector((0.036, 1.44, 0.052)),
            bevel_r=0.008,
            mat_idx=6,
            smooth=True,
        )
        add_box(bm, Vector((side * 0.728, -0.10, 0.775)), Vector((0.022, 1.42, 0.006)), mat_idx=10)
        add_box(bm, Vector((side * 0.726, -0.10, 0.768)), Vector((0.018, 1.38, 0.005)), mat_idx=7)
        add_rounded_box(
            bm,
            Vector((side * 0.725, -0.18, 0.71)),
            Vector((0.076, 0.58, 0.048)),
            bevel_r=0.012,
            mat_idx=1,
            smooth=True,
        )
        add_box(bm, Vector((side * 0.688, -0.18, 0.733)), Vector((0.004, 0.54, 0.004)), mat_idx=9)
        add_rounded_box(
            bm,
            Vector((side * 0.725, -0.36, 0.736)),
            Vector((0.044, 0.14, 0.014)),
            bevel_r=0.004,
            mat_idx=10,
            smooth=True,
        )
        add_rounded_box(
            bm,
            Vector((side * 0.724, -0.42, 0.796)),
            Vector((0.018, 0.095, 0.020)),
            bevel_r=0.005,
            mat_idx=10,
            smooth=True,
        )

    # 1. 面取りラップアラウンド立体ダッシュボード本体（ロアダッシュ前面を Y=-0.610 で収め、手前の杢目パネル・アンビエントLEDを100%露出させつつ隙間ゼロ！）
    add_rounded_box(
        bm,
        Vector((0.0, -0.95, 0.845)),
        Vector((1.44, 0.60, 0.062)),
        bevel_r=0.016,
        mat_idx=0,
        smooth=True,
    )
    add_rounded_box(
        bm,
        Vector((0.0, -0.785, 0.742)),
        Vector((1.44, 0.35, 0.238)),
        bevel_r=0.014,
        mat_idx=0,
        smooth=True,
    )
    add_box(bm, Vector((0.0, -0.665, 0.876)), Vector((1.42, 0.005, 0.004)), mat_idx=9)
    add_box(bm, Vector((0.0, -0.674, 0.876)), Vector((1.42, 0.004, 0.003)), mat_idx=9)
    add_rounded_box(
        bm,
        Vector((-0.38, -0.85, 0.874)),
        Vector((0.23, 0.13, 0.008)),
        bevel_r=0.003,
        mat_idx=10,
        smooth=True,
    )
    add_box(bm, Vector((-0.38, -0.85, 0.877)), Vector((0.20, 0.10, 0.006)), mat_idx=2)
    add_rounded_box(
        bm,
        Vector((0.0, -0.88, 0.876)),
        Vector((0.26, 0.12, 0.007)),
        bevel_r=0.003,
        mat_idx=10,
        smooth=True,
    )

    add_rounded_box(
        bm,
        Vector((0.18, -0.615, 0.838)),
        Vector((1.06, 0.076, 0.068)),
        bevel_r=0.010,
        mat_idx=6,
        smooth=True,
    )
    add_rounded_box(
        bm,
        Vector((-0.59, -0.615, 0.842)),
        Vector((0.24, 0.072, 0.062)),
        bevel_r=0.010,
        mat_idx=6,
        smooth=True,
    )
    add_box(bm, Vector((0.0, -0.576, 0.873)), Vector((1.42, 0.014, 0.007)), mat_idx=10)
    add_box(bm, Vector((0.0, -0.576, 0.804)), Vector((1.42, 0.014, 0.007)), mat_idx=10)
    add_box(bm, Vector((0.0, -0.578, 0.797)), Vector((1.40, 0.010, 0.006)), mat_idx=7)

    add_rounded_box(
        bm,
        Vector((0.46, -0.574, 0.838)),
        Vector((0.36, 0.014, 0.022)),
        bevel_r=0.004,
        mat_idx=0,
        smooth=True,
    )
    add_box(bm, Vector((0.46, -0.569, 0.838)), Vector((0.34, 0.008, 0.005)), mat_idx=10)
    add_rounded_box(
        bm,
        Vector((-0.63, -0.578, 0.855)),
        Vector((0.11, 0.036, 0.044)),
        bevel_r=0.007,
        mat_idx=0,
        smooth=True,
    )
    add_box(bm, Vector((-0.63, -0.561, 0.855)), Vector((0.09, 0.008, 0.008)), mat_idx=10)

    # 2. 12.3インチ連装パノラミック・メーターフード＆ナビ背面マウント
    add_rounded_box(
        bm,
        Vector((-0.38, -0.64, 1.018)),
        Vector((0.38, 0.18, 0.026)),
        bevel_r=0.009,
        mat_idx=0,
        smooth=True,
    )
    add_box(bm, Vector((-0.38, -0.635, 1.004)), Vector((0.35, 0.16, 0.005)), mat_idx=8)
    add_box(bm, Vector((-0.38, -0.551, 1.029)), Vector((0.36, 0.005, 0.004)), mat_idx=9)
    add_rounded_box(
        bm,
        Vector((-0.56, -0.64, 0.946)),
        Vector((0.026, 0.16, 0.135)),
        bevel_r=0.008,
        mat_idx=0,
        smooth=True,
    )
    add_rounded_box(
        bm,
        Vector((-0.38, -0.658, 0.948)),
        Vector((0.36, 0.022, 0.126)),
        bevel_r=0.006,
        mat_idx=0,
        smooth=True,
    )
    add_box(bm, Vector((-0.38, -0.646, 1.010)), Vector((0.35, 0.012, 0.006)), mat_idx=10)
    add_rounded_box(
        bm,
        Vector((-0.132, -0.625, 0.910)),
        Vector((0.14, 0.052, 0.088)),
        bevel_r=0.010,
        mat_idx=0,
        smooth=True,
    )

    # 3. ステアリングコラム奥側シュラウド & ニーボルスター & スポーツアルミペダル
    add_rounded_box(
        bm,
        Vector((-0.38, -0.585, 0.835)),
        Vector((0.092, 0.085, 0.068)),
        bevel_r=0.012,
        mat_idx=0,
        smooth=True,
    )
    add_rounded_box(
        bm,
        Vector((-0.38, -0.625, 0.823)),
        Vector((0.112, 0.048, 0.078)),
        bevel_r=0.012,
        mat_idx=0,
        smooth=True,
    )
    add_rounded_box(
        bm,
        Vector((-0.42, -0.66, 0.67)),
        Vector((0.48, 0.14, 0.22)),
        bevel_r=0.018,
        mat_idx=1,
        smooth=True,
    )
    add_rounded_box(
        bm,
        Vector((0.42, -0.66, 0.67)),
        Vector((0.48, 0.14, 0.22)),
        bevel_r=0.018,
        mat_idx=1,
        smooth=True,
    )
    add_box(bm, Vector((0.42, -0.588, 0.72)), Vector((0.42, 0.008, 0.006)), mat_idx=10)

    add_rounded_box(
        bm,
        Vector((-0.40, -0.36, 0.398)),
        Vector((0.46, 0.56, 0.012)),
        bevel_r=0.004,
        mat_idx=8,
        smooth=True,
    )
    add_box(bm, Vector((-0.40, -0.50, 0.405)), Vector((0.18, 0.12, 0.004)), mat_idx=10)
    add_slanted_strut(
        bm,
        Vector((-0.25, -0.73, 0.405)),
        Vector((-0.25, -0.81, 0.55)),
        0.046,
        0.014,
        0.92,
        mat_idx=10,
        smooth=True,
    )
    add_slanted_strut(
        bm,
        Vector((-0.38, -0.78, 0.62)),
        Vector((-0.38, -0.73, 0.49)),
        0.018,
        0.018,
        1.0,
        mat_idx=0,
        smooth=False,
    )
    add_rounded_box(
        bm,
        Vector((-0.38, -0.72, 0.485)),
        Vector((0.092, 0.018, 0.056)),
        bevel_r=0.005,
        mat_idx=10,
        smooth=True,
    )
    add_slanted_strut(
        bm,
        Vector((-0.53, -0.72, 0.405)),
        Vector((-0.53, -0.82, 0.54)),
        0.068,
        0.014,
        0.95,
        mat_idx=10,
        smooth=True,
    )

    # 4. センターダッシュロア・オートエアコン操作パネル & ENGINE START STOP ボタン
    add_rounded_box(
        bm,
        Vector((-0.11, -0.578, 0.838)),
        Vector((0.24, 0.028, 0.038)),
        bevel_r=0.006,
        mat_idx=0,
        smooth=True,
    )
    add_box(bm, Vector((-0.11, -0.563, 0.838)), Vector((0.20, 0.006, 0.008)), mat_idx=5)
    add_cylinder(
        bm,
        Vector((-0.205, -0.575, 0.838)),
        0.014,
        0.010,
        segments=20,
        axis="Y",
        mat_idx=5,
        smooth=True,
    )
    add_cylinder(
        bm,
        Vector((-0.205, -0.570, 0.838)),
        0.010,
        0.008,
        segments=20,
        axis="Y",
        mat_idx=4,
        smooth=True,
    )

    # 5. ハイデッキ・センターコンソール
    add_rounded_box(
        bm,
        Vector((0.0, -0.05, 0.53)),
        Vector((0.30, 1.18, 0.30)),
        bevel_r=0.022,
        mat_idx=1,
        smooth=True,
    )
    add_rounded_box(
        bm,
        Vector((0.0, -0.24, 0.688)),
        Vector((0.26, 0.62, 0.024)),
        bevel_r=0.008,
        mat_idx=6,
        smooth=True,
    )
    for side in (-1.0, 1.0):
        add_box(bm, Vector((side * 0.132, -0.24, 0.692)), Vector((0.008, 0.60, 0.012)), mat_idx=10)
        add_box(bm, Vector((side * 0.145, -0.05, 0.682)), Vector((0.004, 1.12, 0.004)), mat_idx=9)
        add_box(bm, Vector((side * 0.138, -0.24, 0.678)), Vector((0.006, 0.58, 0.006)), mat_idx=7)
    add_rounded_box(
        bm,
        Vector((0.0, 0.28, 0.725)),
        Vector((0.27, 0.44, 0.088)),
        bevel_r=0.024,
        mat_idx=1,
        smooth=True,
    )
    for side in (-1.0, 1.0):
        add_box(bm, Vector((side * 0.122, 0.28, 0.769)), Vector((0.004, 0.40, 0.004)), mat_idx=9)
    add_rounded_box(
        bm,
        Vector((-0.055, -0.28, 0.704)),
        Vector((0.072, 0.110, 0.012)),
        bevel_r=0.003,
        mat_idx=0,
        smooth=True,
    )
    for cup_y in (-0.22, -0.34):
        add_hollow_ring_y(
            bm,
            Vector((0.055, cup_y, 0.702)),
            0.036,
            0.030,
            0.012,
            segments=20,
            mat_idx=5,
            smooth=True,
        )

    # 6. スカルプト曲面セミアニリン本革エグゼクティブフロントシート
    for seat_x in (-0.38, 0.38):
        add_rounded_box(
            bm,
            Vector((seat_x, 0.16, 0.445)),
            Vector((0.48, 0.52, 0.145)),
            bevel_r=0.036,
            mat_idx=1,
            smooth=True,
            rot_euler=Euler((math.radians(-4.0), 0.0, 0.0), "XYZ"),
        )
        for side_b in (-1.0, 1.0):
            add_rounded_box(
                bm,
                Vector((seat_x + side_b * 0.215, 0.18, 0.475)),
                Vector((0.085, 0.48, 0.125)),
                bevel_r=0.028,
                mat_idx=1,
                smooth=True,
            )
        add_rounded_box(
            bm,
            Vector((seat_x, 0.44, 0.755)),
            Vector((0.46, 0.135, 0.54)),
            bevel_r=0.038,
            mat_idx=1,
            smooth=True,
            rot_euler=Euler((math.radians(14.0), 0.0, 0.0), "XYZ"),
        )
        for side_b in (-1.0, 1.0):
            add_rounded_box(
                bm,
                Vector((seat_x + side_b * 0.215, 0.405, 0.735)),
                Vector((0.082, 0.165, 0.47)),
                bevel_r=0.028,
                mat_idx=1,
                smooth=True,
                rot_euler=Euler((math.radians(14.0), 0.0, 0.0), "XYZ"),
            )
        add_rounded_box(
            bm,
            Vector((seat_x, 0.485, 0.985)),
            Vector((0.30, 0.115, 0.026)),
            bevel_r=0.008,
            mat_idx=6,
            smooth=True,
            rot_euler=Euler((math.radians(12.0), 0.0, 0.0), "XYZ"),
        )
        for post_dx in (-0.062, 0.062):
            add_cylinder(
                bm,
                Vector((seat_x + post_dx, 0.505, 1.035)),
                0.007,
                0.075,
                segments=12,
                axis="Z",
                mat_idx=5,
                smooth=True,
            )
        add_rounded_box(
            bm,
            Vector((seat_x, 0.515, 1.115)),
            Vector((0.235, 0.105, 0.165)),
            bevel_r=0.034,
            mat_idx=1,
            smooth=True,
            rot_euler=Euler((math.radians(8.0), 0.0, 0.0), "XYZ"),
        )

    # 7. リアVIPエグゼクティブシート（幅 1.18m で後輪ホイールハウス内壁 |X|=0.61 と 0.0mm 干渉ゼロ！）
    add_rounded_box(
        bm,
        Vector((0.0, 1.12, 0.465)),
        Vector((1.18, 0.50, 0.18)),
        bevel_r=0.042,
        mat_idx=1,
        smooth=True,
    )
    add_rounded_box(
        bm,
        Vector((0.0, 1.38, 0.75)),
        Vector((1.18, 0.15, 0.48)),
        bevel_r=0.040,
        mat_idx=1,
        smooth=True,
        rot_euler=Euler((math.radians(16.0), 0.0, 0.0), "XYZ"),
    )
    add_rounded_box(
        bm,
        Vector((0.0, 1.14, 0.625)),
        Vector((0.25, 0.42, 0.115)),
        bevel_r=0.024,
        mat_idx=6,
        smooth=True,
    )
    for rx_head in (-0.38, 0.38):
        add_rounded_box(
            bm,
            Vector((rx_head, 1.44, 1.035)),
            Vector((0.23, 0.10, 0.145)),
            bevel_r=0.032,
            mat_idx=1,
            smooth=True,
        )
    add_rounded_box(
        bm,
        Vector((0.0, 1.63, 0.895)),
        Vector((1.24, 0.38, 0.055)),
        bevel_r=0.014,
        mat_idx=0,
        smooth=True,
    )

    # 8. フロントルーフヘッダー・オーバーヘッドコンソール＆左右サンバイザー
    header_front_arch = [
        Vector((-0.650, -0.495, 1.376)),
        Vector((-0.280, -0.545, 1.384)),
        Vector((0.280, -0.545, 1.384)),
        Vector((0.650, -0.495, 1.376)),
        Vector((-0.660, -0.480, 1.404)),
        Vector((-0.280, -0.532, 1.422)),
        Vector((0.280, -0.532, 1.422)),
        Vector((0.660, -0.480, 1.404)),
    ]
    add_hexahedron(bm, header_front_arch, mat_idx=8, smooth=True)

    header_rear_arch = [
        Vector((-0.650, -0.320, 1.384)),
        Vector((-0.280, -0.320, 1.394)),
        Vector((0.280, -0.320, 1.394)),
        Vector((0.650, -0.320, 1.384)),
        Vector((-0.650, -0.495, 1.376)),
        Vector((-0.280, -0.545, 1.384)),
        Vector((0.280, -0.545, 1.384)),
        Vector((0.650, -0.495, 1.376)),
    ]
    add_hexahedron(bm, header_rear_arch, mat_idx=8, smooth=True)

    overhead_console_verts = [
        Vector((-0.145, -0.585, 1.378)),
        Vector((0.145, -0.585, 1.378)),
        Vector((0.155, -0.415, 1.380)),
        Vector((-0.155, -0.415, 1.380)),
        Vector((-0.150, -0.545, 1.416)),
        Vector((0.150, -0.545, 1.416)),
        Vector((0.160, -0.415, 1.414)),
        Vector((-0.160, -0.415, 1.414)),
    ]
    add_hexahedron(bm, overhead_console_verts, mat_idx=0, smooth=False)
    add_box(bm, Vector((0.0, -0.495, 1.378)), Vector((0.180, 0.110, 0.004)), mat_idx=0)
    for lamp_sx in (-0.045, 0.045):
        add_box(bm, Vector((lamp_sx, -0.495, 1.3755)), Vector((0.018, 0.012, 0.002)), mat_idx=10)

    for visor_side, visor_cx in ((-1.0, -0.395), (1.0, 0.395)):
        add_rounded_box(
            bm,
            Vector((visor_cx, -0.465, 1.374)),
            Vector((0.350, 0.135, 0.016)),
            bevel_r=0.006,
            mat_idx=8,
            smooth=True,
        )
        add_cylinder(
            bm,
            Vector((visor_cx + visor_side * 0.155, -0.515, 1.380)),
            0.009,
            0.022,
            segments=12,
            axis="Z",
            mat_idx=10,
            smooth=True,
        )

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("Interior", mesh)
    for k in mat_keys:
        obj.data.materials.append(materials[k])

    bpy.context.scene.collection.objects.link(obj)
    return obj


# ==============================================================================
# 9. ステアリング・曲面ガラス群・ワイパー・ミラー・20インチホイール
# ==============================================================================


def build_steering_wheel(materials) -> bpy.types.Object:
    """実寸 360mm 本革×杢目コンビステアリングホイール"""
    mesh = bpy.data.meshes.new("SteeringWheelMesh")
    bm = bmesh.new()
    mat_keys = ["SteeringLeather", "Chrome", "BlackTrim", "CrownWoodTrim"]

    center_r = 0.164
    tube_r = 0.0165
    segs = 44
    tube_segs = 16

    ring_loops = []
    for i in range(segs):
        theta = (2.0 * math.pi * i) / segs
        cx, cz = math.cos(theta) * center_r, math.sin(theta) * center_r
        radial = Vector((math.cos(theta), 0.0, math.sin(theta))).normalized()
        loop_verts = []
        for j in range(tube_segs):
            phi = (2.0 * math.pi * j) / tube_segs
            offset = radial * (math.cos(phi) * tube_r) + Vector((0.0, math.sin(phi) * tube_r, 0.0))
            loop_verts.append(bm.verts.new(Vector((cx, 0.0, cz)) + offset))
        ring_loops.append(loop_verts)

    for i in range(segs):
        ni = (i + 1) % segs
        theta_deg = (360.0 * i) / segs
        is_wood_arc = (45.0 <= theta_deg <= 135.0) or (235.0 <= theta_deg <= 305.0)
        for j in range(tube_segs):
            nj = (j + 1) % tube_segs
            safe_face(
                bm,
                [ring_loops[i][j], ring_loops[i][nj], ring_loops[ni][nj], ring_loops[ni][j]],
                mat_idx=(3 if is_wood_arc else 0),
                smooth=True,
            )

    add_cylinder(
        bm, Vector((0.0, 0.0, 0.0)), 0.058, 0.034, segments=28, axis="Y", mat_idx=0, smooth=True
    )
    add_hollow_ring_y(
        bm, Vector((0.0, 0.017, 0.0)), 0.031, 0.027, 0.004, segments=24, mat_idx=1, smooth=True
    )
    add_crown_emblem_sculpted(
        bm,
        Vector((0.0, 0.016, 0.0)),
        0.66,
        axis_y_dir=1.0,
        pitch_rad=0.0,
        mat_chrome=1,
        mat_back=-1,
    )

    for sx in (-0.098, 0.098):
        add_rounded_box(
            bm,
            Vector((sx, 0.0, -0.008)),
            Vector((0.095, 0.018, 0.034)),
            bevel_r=0.005,
            mat_idx=0,
            smooth=True,
        )
        add_rounded_box(
            bm,
            Vector((sx * 0.97, 0.010, -0.008)),
            Vector((0.064, 0.006, 0.024)),
            bevel_r=0.002,
            mat_idx=2,
            smooth=True,
        )
        add_rounded_box(
            bm,
            Vector((sx, 0.009, -0.022)),
            Vector((0.086, 0.005, 0.006)),
            bevel_r=0.0015,
            mat_idx=1,
            smooth=True,
        )
        add_rounded_box(
            bm,
            Vector((sx * 1.18, -0.028, 0.025)),
            Vector((0.018, 0.008, 0.068)),
            bevel_r=0.003,
            mat_idx=1,
            smooth=True,
        )
    add_rounded_box(
        bm,
        Vector((0.0, 0.0, -0.092)),
        Vector((0.042, 0.018, 0.095)),
        bevel_r=0.006,
        mat_idx=1,
        smooth=True,
    )
    add_rounded_box(
        bm,
        Vector((0.0, 0.008, -0.092)),
        Vector((0.022, 0.006, 0.082)),
        bevel_r=0.002,
        mat_idx=2,
        smooth=True,
    )

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("SteeringWheel", mesh)
    for k in mat_keys:
        obj.data.materials.append(materials[k])
    obj.location = Vector((-0.38, -0.44, 0.888))
    obj.rotation_euler = Euler((math.radians(20), 0, 0), "XYZ")
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_windshield(materials) -> bpy.types.Object:
    """3次元曲面フロントガラス (Windshield) — Three.js ワイパー・雨滴シェーダーと完全整合"""
    mesh = bpy.data.meshes.new("WindshieldMesh")
    bm = bmesh.new()

    u_segs, v_segs = 20, 14
    grid_verts = []
    for vi in range(v_segs + 1):
        vr = vi / v_segs
        y = lerp(-1.28, -0.48, vr)
        z = lerp(0.88, 1.42, vr)
        width = lerp(1.48, 1.34, vr)
        row = []
        for ui in range(u_segs + 1):
            ur = ui / u_segs
            x = (width * 0.5) * (1.0 - 2.0 * ur)
            curve_y = math.sin(ur * math.pi) * 0.055
            curve_z = math.sin(vr * math.pi) * 0.018
            row.append(bm.verts.new(Vector((x, y - curve_y, z + curve_z))))
        grid_verts.append(row)

    add_quad_grid(bm, grid_verts, mat_idx=0, smooth=True, flip=False)
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    uv_layer = mesh.uv_layers.new(name="UVMap")
    xs = [v.co.x for v in mesh.vertices]
    zs = [v.co.z for v in mesh.vertices]
    min_x, max_x = min(xs), max(xs)
    min_z, max_z = min(zs), max(zs)
    range_x = (max_x - min_x) if max_x != min_x else 1.0
    range_z = (max_z - min_z) if max_z != min_z else 1.0

    for poly in mesh.polygons:
        for loop_idx in poly.loop_indices:
            vert = mesh.vertices[mesh.loops[loop_idx].vertex_index]
            u = (vert.co.x - min_x) / range_x
            v = 1.0 - (vert.co.z - min_z) / range_z
            uv_layer.data[loop_idx].uv = (u, v)

    obj = bpy.data.objects.new("Windshield", mesh)
    obj.data.materials.append(materials["WindshieldGlass"])
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_side_windows(materials) -> bpy.types.Object:
    """クラウン セダン (AZSH32) の左右6ライトサイドガラス"""
    mesh = bpy.data.meshes.new("SideWindowsMesh")
    bm = bmesh.new()

    def belt_pt(y_val: float) -> tuple[float, float, float]:
        return (
            sample_curve(y_val, BELT_X_KNOTS) - 0.008,
            y_val,
            sample_curve(y_val, BELT_Z_KNOTS) + 0.002,
        )

    def roof_rail_pt(y_val: float) -> tuple[float, float, float]:
        vr = clamp01((y_val - (-0.48)) / (0.94 - (-0.48)))
        pt = eval_roof_surface(1.0, vr)
        return (pt.x - 0.004, pt.y, pt.z - 0.008)

    def front_top(u: float) -> tuple[float, float, float]:
        if u < 0.55:
            t = u / 0.55
            return (
                lerp(0.752, 0.668, t),
                lerp(-1.24, -0.48, t),
                lerp(0.875, 1.410, t) + math.sin(t * math.pi) * 0.016,
            )
        t = (u - 0.55) / 0.45
        return roof_rail_pt(lerp(-0.48, 0.19, t))

    def front_bot(u: float) -> tuple[float, float, float]:
        return belt_pt(lerp(-1.24, 0.15, u))

    def rear_door_top(u: float) -> tuple[float, float, float]:
        return roof_rail_pt(lerp(0.20, 0.90, u))

    def rear_door_bot(u: float) -> tuple[float, float, float]:
        return belt_pt(lerp(0.165, 0.945, u))

    def quarter_top(u: float) -> tuple[float, float, float]:
        arch = math.sin(u * math.pi)
        qy = lerp(0.91, 1.54, u)
        qz = lerp(1.368, sample_curve(1.54, BELT_Z_KNOTS) + 0.014, u) + arch * 0.015
        qx = lerp(0.624, sample_curve(1.54, BELT_X_KNOTS) - 0.008, u) + arch * 0.014
        return (qx, qy, qz)

    def quarter_bot(u: float) -> tuple[float, float, float]:
        return belt_pt(lerp(0.955, 1.54, u))

    for side in (-1.0, 1.0):
        for u_segs, v_segs, b_fn, t_fn in [
            (16, 10, front_bot, front_top),
            (12, 10, rear_door_bot, rear_door_top),
            (10, 8, quarter_bot, quarter_top),
        ]:
            grid = []
            for vi in range(v_segs + 1):
                vr = vi / v_segs
                tumble_x = math.sin(vr * math.pi) * 0.020
                row = []
                for ui in range(u_segs + 1):
                    ur = ui / u_segs
                    bx, by, bz = b_fn(ur)
                    tx, ty, tz = t_fn(ur)
                    row.append(
                        bm.verts.new(
                            Vector(
                                (
                                    side * (lerp(bx, tx, vr) + tumble_x),
                                    lerp(by, ty, vr),
                                    lerp(bz, tz, vr),
                                )
                            )
                        )
                    )
                grid.append(row)
            add_quad_grid(bm, grid, mat_idx=0, smooth=True, flip=(side < 0))

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    uv_layer = mesh.uv_layers.new(name="UVMap")
    ys = [v.co.y for v in mesh.vertices]
    zs = [v.co.z for v in mesh.vertices]
    min_y, max_y = min(ys), max(ys)
    min_z, max_z = min(zs), max(zs)
    range_y = (max_y - min_y) if max_y != min_y else 1.0
    range_z = (max_z - min_z) if max_z != min_z else 1.0

    for poly in mesh.polygons:
        for loop_idx in poly.loop_indices:
            vert = mesh.vertices[mesh.loops[loop_idx].vertex_index]
            u = (vert.co.y - min_y) / range_y
            v = 1.0 - (vert.co.z - min_z) / range_z
            uv_layer.data[loop_idx].uv = (u, v)

    obj = bpy.data.objects.new("SideWindows", mesh)
    obj.data.materials.append(materials["WindowGlass"])
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_rear_window(materials) -> bpy.types.Object:
    """3次元曲面ファストバックリアガラス (RearWindow)"""
    mesh = bpy.data.meshes.new("RearWindowMesh")
    bm = bmesh.new()

    u_segs, v_segs = 18, 14
    grid_verts = []
    for vi in range(v_segs + 1):
        vr = vi / v_segs
        y_side = lerp(1.815, 0.940, vr)
        z_side = lerp(0.944, 1.370, vr)
        z_arch = lerp(0.022, 0.036, vr)
        width = lerp(1.456, 1.240, vr)

        row = []
        for ui in range(u_segs + 1):
            ur = ui / u_segs
            x = (width * 0.5) * (2.0 * ur - 1.0)
            crown_u = math.sin(ur * math.pi)
            crown_v = math.sin(vr * math.pi)
            curve_y = crown_u * 0.036 - crown_v * 0.012
            curve_z = crown_u * z_arch + crown_v * 0.026
            row.append(bm.verts.new(Vector((x, y_side + curve_y, z_side + curve_z))))
        grid_verts.append(row)

    add_quad_grid(bm, grid_verts, mat_idx=0, smooth=True, flip=False)
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    uv_layer = mesh.uv_layers.new(name="UVMap")
    xs = [v.co.x for v in mesh.vertices]
    zs = [v.co.z for v in mesh.vertices]
    min_x, max_x = min(xs), max(xs)
    min_z, max_z = min(zs), max(zs)
    range_x = (max_x - min_x) if max_x != min_x else 1.0
    range_z = (max_z - min_z) if max_z != min_z else 1.0

    for poly in mesh.polygons:
        for loop_idx in poly.loop_indices:
            vert = mesh.vertices[mesh.loops[loop_idx].vertex_index]
            u = (vert.co.x - min_x) / range_x
            v = 1.0 - (vert.co.z - min_z) / range_z
            uv_layer.data[loop_idx].uv = (u, v)

    obj = bpy.data.objects.new("RearWindow", mesh)
    obj.data.materials.append(materials["WindowGlass"])
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_wiper(
    materials, name_suffix: str, pivot_loc: Vector, pivot_rot: Euler, parent_root: bpy.types.Object
):
    """日本の右ハンドル車用ワイパーピボット Empty とエアロワイパーブレードを作成"""
    pivot_empty = bpy.data.objects.new(f"Wiper{name_suffix}", None)
    pivot_empty.empty_display_type = "SINGLE_ARROW"
    pivot_empty.empty_display_size = 0.2
    pivot_empty.location = pivot_loc
    pivot_empty.rotation_euler = pivot_rot
    pivot_empty.parent = parent_root
    bpy.context.scene.collection.objects.link(pivot_empty)

    mesh = bpy.data.meshes.new(f"WiperBlade{name_suffix}Mesh")
    bm = bmesh.new()

    is_driver = name_suffix == "Driver"
    arm_length = 0.45 if is_driver else 0.36
    blade_inner_r = 0.08
    blade_outer_r = 0.86 if is_driver else 0.66

    add_slanted_strut(
        bm,
        Vector((0.0, 0.0, 0.0)),
        Vector((arm_length, 0.032, 0.042)),
        0.015,
        0.010,
        0.78,
        mat_idx=0,
        smooth=True,
    )
    add_slanted_strut(
        bm,
        Vector((blade_inner_r, 0.012, 0.015)),
        Vector((blade_outer_r, 0.055, 0.072)),
        0.013,
        0.010,
        0.88,
        mat_idx=0,
        smooth=True,
    )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    blade_obj = bpy.data.objects.new(f"WiperBlade{name_suffix}", mesh)
    blade_obj.data.materials.append(materials["WiperBlack"])
    blade_obj.parent = pivot_empty
    bpy.context.scene.collection.objects.link(blade_obj)
    return pivot_empty, blade_obj


def add_sculpted_tire(bm, radius: float, rim_r: float, width: float, segments=48, mat_idx=0):
    """16断面サイドウォール曲率＋リムガードフランジ＋4本主排水溝付きラジアルタイヤ（245/45ZR20）を48分割で生成"""
    hw = width * 0.5
    sh_w = hw * 0.84
    r_sh = radius * 0.968
    r_groove = radius - 0.0055
    r_mid_sw = lerp(rim_r, radius, 0.46)

    profile = [
        (-hw * 0.82, rim_r - 0.002),
        (-hw * 0.98, lerp(rim_r, radius, 0.12)),
        (-hw * 1.00, r_mid_sw),
        (-hw * 0.95, lerp(rim_r, radius, 0.76)),
        (-sh_w, r_sh),
        (-sh_w * 0.78, radius),
        (-sh_w * 0.56, radius),
        (-sh_w * 0.52, r_groove),
        (-sh_w * 0.44, r_groove),
        (-sh_w * 0.40, radius),
        (-sh_w * 0.18, radius),
        (-sh_w * 0.14, r_groove),
        (-sh_w * 0.06, r_groove),
        (-sh_w * 0.02, radius),
        (sh_w * 0.02, radius),
        (sh_w * 0.06, r_groove),
        (sh_w * 0.14, r_groove),
        (sh_w * 0.18, radius),
        (sh_w * 0.40, radius),
        (sh_w * 0.44, r_groove),
        (sh_w * 0.52, r_groove),
        (sh_w * 0.56, radius),
        (sh_w * 0.78, radius),
        (sh_w, r_sh),
        (hw * 0.95, lerp(rim_r, radius, 0.76)),
        (hw * 1.00, r_mid_sw),
        (hw * 0.98, lerp(rim_r, radius, 0.12)),
        (hw * 0.82, rim_r - 0.002),
    ]

    rings = []
    for x_pos, r_val in profile:
        ring = []
        for s in range(segments):
            ang = (2.0 * math.pi * s) / segments
            ring.append(bm.verts.new(Vector((x_pos, math.cos(ang) * r_val, math.sin(ang) * r_val))))
        rings.append(ring)

    for p_idx in range(len(rings) - 1):
        r0, r1 = rings[p_idx], rings[p_idx + 1]
        for s in range(segments):
            ns = (s + 1) % segments
            safe_face(bm, [r0[s], r0[ns], r1[ns], r1[s]], mat_idx=mat_idx, smooth=True)


def build_wheel(
    materials, name: str, position: Vector, parent_root: bpy.types.Object
) -> bpy.types.Object:
    """クラウン セダン Z 20インチ 20本マルチスポーク切削光輝＆ダークチタンアルミホイール＋ベンチレーテッドブレーキ＆曲面キャリパー"""
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    bm = bmesh.new()
    mat_keys = ["TireRubber", "WheelAlloy", "BrakeRotor", "BrakeCaliper", "BlackTrim", "Chrome"]

    radius = WHEEL_R_TIRE
    width = 0.245
    rim_r = 0.248
    rim_inner_r = 0.228
    side_sign = 1.0 if position.x > 0 else -1.0

    add_sculpted_tire(bm, radius=radius, rim_r=rim_r, width=width, segments=48, mat_idx=0)
    add_hollow_tube_x(
        bm,
        Vector((0.0, 0.0, 0.0)),
        rim_r,
        rim_inner_r,
        width * 0.84,
        segments=48,
        mat_idx=1,
        smooth=True,
    )
    add_hollow_tube_x(
        bm,
        Vector((side_sign * (width * 0.395), 0.0, 0.0)),
        rim_r + 0.002,
        rim_inner_r + 0.005,
        0.015,
        segments=48,
        mat_idx=5,
        smooth=True,
    )
    add_cylinder(
        bm,
        Vector((-side_sign * width * 0.34, 0.0, 0.0)),
        rim_inner_r - 0.002,
        0.016,
        segments=36,
        axis="X",
        mat_idx=4,
        smooth=False,
    )

    outer_x = side_sign * (width * 0.405)
    mid_x = side_sign * (width * 0.355)
    hub_x = side_sign * (width * 0.275)

    for pair_idx in range(10):
        base_angle = (2.0 * math.pi * pair_idx) / 10.0
        for sub_idx, sub_offset in enumerate((-0.098, 0.098)):
            s_angle = base_angle + sub_offset
            twist = 0.042 if sub_idx == 0 else -0.022
            spoke_stations = [
                (hub_x, 0.056, s_angle - twist * 0.8, 0.0072, 0.013),
                (mid_x, 0.145, s_angle + twist * 0.1, 0.0064, 0.011),
                (outer_x, rim_inner_r * 1.02, s_angle + twist, 0.0056, 0.009),
            ]
            rings_sp = []
            for sx, sr, sa, half_t, half_d in spoke_stations:
                cy, cz = math.cos(sa), math.sin(sa)
                ty, tz = -cz, cy
                p = Vector((sx, cy * sr, cz * sr))
                tv = Vector((0.0, ty * half_t, tz * half_t))
                dv = Vector((side_sign * half_d, 0.0, 0.0))
                rings_sp.append(
                    [
                        bm.verts.new(p - tv - dv),
                        bm.verts.new(p + tv - dv),
                        bm.verts.new(p + tv * 0.78 + dv),
                        bm.verts.new(p - tv * 0.78 + dv),
                    ]
                )
            for si in range(len(rings_sp) - 1):
                r0, r1 = rings_sp[si], rings_sp[si + 1]
                for k in range(4):
                    nk = (k + 1) % 4
                    m_sp = 5 if (k == 2 and sub_idx == 0) else 1
                    safe_face(bm, [r0[k], r0[nk], r1[nk], r1[k]], mat_idx=m_sp, smooth=True)
            safe_face(bm, list(reversed(rings_sp[0])), mat_idx=1, smooth=False)
            safe_face(bm, rings_sp[-1], mat_idx=5, smooth=False)

    add_cylinder(
        bm, Vector((hub_x, 0.0, 0.0)), 0.072, 0.028, segments=32, axis="X", mat_idx=1, smooth=True
    )
    add_cylinder(
        bm,
        Vector((hub_x + side_sign * 0.018, 0.0, 0.0)),
        0.036,
        0.016,
        segments=28,
        axis="X",
        mat_idx=4,
        smooth=True,
    )
    add_hollow_tube_x(
        bm,
        Vector((hub_x + side_sign * 0.024, 0.0, 0.0)),
        0.033,
        0.027,
        0.006,
        segments=28,
        mat_idx=5,
        smooth=True,
    )
    for lug_i in range(5):
        la = (2.0 * math.pi * lug_i) / 5.0 + 0.314
        add_cylinder(
            bm,
            Vector((hub_x + side_sign * 0.014, math.cos(la) * 0.053, math.sin(la) * 0.053)),
            0.0075,
            0.016,
            segments=6,
            axis="X",
            mat_idx=5,
            smooth=False,
        )

    rotor_x = side_sign * (width * 0.13)
    add_cylinder(
        bm, Vector((rotor_x, 0.0, 0.0)), 0.198, 0.024, segments=36, axis="X", mat_idx=2, smooth=True
    )
    add_cylinder(
        bm,
        Vector((rotor_x + side_sign * 0.014, 0.0, 0.0)),
        0.095,
        0.026,
        segments=28,
        axis="X",
        mat_idx=4,
        smooth=True,
    )

    cal_segs = 10
    cal_rings = []
    cal_ang_start = math.radians(122.0) if position.y < 0 else math.radians(24.0)
    cal_ang_end = math.radians(176.0) if position.y < 0 else math.radians(78.0)
    for ci in range(cal_segs + 1):
        t = ci / cal_segs
        ang = lerp(cal_ang_start, cal_ang_end, t)
        taper_w = 0.72 + 0.28 * math.sin(t * math.pi)
        r_in_c, r_out_c = 0.140, 0.208
        x_in_c = rotor_x - side_sign * 0.018
        x_out_c = rotor_x + side_sign * (0.044 * taper_w)
        cy, cz = math.cos(ang), math.sin(ang)
        cal_rings.append(
            [
                bm.verts.new(Vector((x_in_c, cy * r_in_c, cz * r_in_c))),
                bm.verts.new(Vector((x_out_c, cy * r_in_c, cz * r_in_c))),
                bm.verts.new(Vector((x_out_c, cy * r_out_c, cz * r_out_c))),
                bm.verts.new(Vector((x_in_c, cy * r_out_c, cz * r_out_c))),
            ]
        )
    for ci in range(cal_segs):
        r0, r1 = cal_rings[ci], cal_rings[ci + 1]
        for k in range(4):
            nk = (k + 1) % 4
            safe_face(bm, [r0[k], r0[nk], r1[nk], r1[k]], mat_idx=3, smooth=True)
    safe_face(bm, list(reversed(cal_rings[0])), mat_idx=3, smooth=False)
    safe_face(bm, cal_rings[-1], mat_idx=3, smooth=False)

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    wheel_obj = bpy.data.objects.new(name, mesh)
    for k in mat_keys:
        wheel_obj.data.materials.append(materials[k])
    wheel_obj.location = position
    wheel_obj.parent = parent_root
    bpy.context.scene.collection.objects.link(wheel_obj)
    return wheel_obj


def assign_planar_mirror_uvs(mesh: bpy.types.Mesh, yaw_rad: float = 0.0):
    """ミラー鏡面メッシュに glTF 2.0 出力後 Three.js 側で u=[0..1], v=[0..1] となる正規化UVを付与"""
    uv_layer = mesh.uv_layers.new(name="UVMap")
    cos_y, sin_y = math.cos(-yaw_rad), math.sin(-yaw_rad)

    local_xs = [v.co.x * cos_y - v.co.y * sin_y for v in mesh.vertices]
    local_zs = [v.co.z for v in mesh.vertices]
    min_x, max_x = min(local_xs), max(local_xs)
    min_z, max_z = min(local_zs), max(local_zs)
    range_x = (max_x - min_x) if max_x != min_x else 1.0
    range_z = (max_z - min_z) if max_z != min_z else 1.0

    for poly in mesh.polygons:
        for loop_idx in poly.loop_indices:
            vert = mesh.vertices[mesh.loops[loop_idx].vertex_index]
            lx = vert.co.x * cos_y - vert.co.y * sin_y
            u = (lx - min_x) / range_x
            v_coord = 1.0 - (vert.co.z - min_z) / range_z
            uv_layer.data[loop_idx].uv = (u, v_coord)


def build_rearview_mirror(materials, parent_root: bpy.types.Object):
    """車体中央 (X=0.00m, Y=-0.74m, Z=1.258m, yaw=22°, pitch=-5°) JDM ワイド台形フレームレスデジタルインナーミラー"""
    housing_mesh = bpy.data.meshes.new("RearviewMirrorMesh")
    bm = bmesh.new()
    mat_keys = ["InteriorDark", "BlackTrim", "Chrome", "DashboardScreen"]

    pivot = Vector((0.0, -0.74, 1.258))
    yaw_angle = math.radians(22.0)
    pitch_angle = math.radians(-5.0)
    cos_y, sin_y = math.cos(yaw_angle), math.sin(yaw_angle)
    cos_p, sin_p = math.cos(pitch_angle), math.sin(pitch_angle)

    def xform_rv(lx: float, ly: float, lz: float) -> Vector:
        py = ly * cos_p - lz * sin_p
        pz = ly * sin_p + lz * cos_p
        rx = lx * cos_y - py * sin_y
        ry = lx * sin_y + py * cos_y
        return pivot + Vector((rx, ry, pz))

    add_hexahedron(
        bm,
        [
            Vector((-0.072, -0.695, 1.328)),
            Vector((0.072, -0.695, 1.328)),
            Vector((0.088, -0.548, 1.412)),
            Vector((-0.088, -0.548, 1.412)),
            Vector((-0.064, -0.682, 1.314)),
            Vector((0.064, -0.682, 1.314)),
            Vector((0.080, -0.538, 1.392)),
            Vector((-0.080, -0.538, 1.392)),
        ],
        mat_idx=0,
        smooth=True,
    )
    add_hexahedron(
        bm,
        [
            Vector((-0.048, -0.755, 1.292)),
            Vector((0.048, -0.755, 1.292)),
            Vector((0.072, -0.695, 1.328)),
            Vector((-0.072, -0.695, 1.328)),
            Vector((-0.042, -0.742, 1.282)),
            Vector((0.042, -0.742, 1.282)),
            Vector((0.064, -0.682, 1.314)),
            Vector((-0.064, -0.682, 1.314)),
        ],
        mat_idx=1,
        smooth=True,
    )

    add_swept_tube(
        bm,
        [Vector((0.0, -0.722, 1.316)), Vector((0.0, -0.752, 1.292)), xform_rv(0.0, -0.017, 0.012)],
        radius_x=0.011,
        radius_y=0.011,
        segments=12,
        mat_idx=1,
        smooth=True,
    )
    add_cylinder(
        bm,
        xform_rv(0.0, -0.018, 0.010),
        0.013,
        0.016,
        segments=16,
        axis="Y",
        mat_idx=2,
        smooth=True,
    )

    def rv_profile(scale_x: float, scale_z: float):
        base = [
            (-0.098, -0.033),
            (0.098, -0.033),
            (0.114, -0.025),
            (0.121, -0.012),
            (0.124, 0.014),
            (0.118, 0.028),
            (0.106, 0.034),
            (-0.106, 0.034),
            (-0.118, 0.028),
            (-0.124, 0.014),
            (-0.121, -0.012),
            (-0.114, -0.025),
        ]
        return [(px * scale_x, pz * scale_z) for px, pz in base]

    outer_prof = rv_profile(1.0, 1.0)
    inner_prof = rv_profile(0.945, 0.905)
    back_prof = rv_profile(0.82, 0.78)

    ring_front = [bm.verts.new(xform_rv(px, 0.006, pz)) for px, pz in outer_prof]
    ring_inner = [bm.verts.new(xform_rv(px, 0.002, pz)) for px, pz in inner_prof]
    ring_mid = [bm.verts.new(xform_rv(px, -0.008, pz)) for px, pz in outer_prof]
    ring_back = [bm.verts.new(xform_rv(px, -0.018, pz)) for px, pz in back_prof]

    n_rv = len(ring_front)
    for i in range(n_rv):
        ni = (i + 1) % n_rv
        safe_face(
            bm, [ring_front[i], ring_front[ni], ring_mid[ni], ring_mid[i]], mat_idx=1, smooth=True
        )
        safe_face(
            bm, [ring_mid[i], ring_mid[ni], ring_back[ni], ring_back[i]], mat_idx=0, smooth=True
        )
        safe_face(
            bm,
            [ring_inner[i], ring_inner[ni], ring_front[ni], ring_front[i]],
            mat_idx=1,
            smooth=True,
        )
    safe_face(bm, list(reversed(ring_back)), mat_idx=0, smooth=False)
    safe_face(bm, ring_inner, mat_idx=1, smooth=False)

    add_rounded_box(
        bm,
        xform_rv(0.0, -0.004, -0.037),
        Vector((0.026, 0.012, 0.008)),
        bevel_r=0.002,
        mat_idx=1,
        smooth=True,
    )
    add_box(bm, xform_rv(-0.075, 0.006, -0.028), Vector((0.008, 0.003, 0.004)), mat_idx=3)

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    bm.to_mesh(housing_mesh)
    bm.free()

    housing_obj = bpy.data.objects.new("RearviewMirror", housing_mesh)
    for k in mat_keys:
        housing_obj.data.materials.append(materials[k])
    housing_obj.parent = parent_root
    bpy.context.scene.collection.objects.link(housing_obj)

    glass_mesh = bpy.data.meshes.new("RearviewMirrorGlassMesh")
    bm_g = bmesh.new()
    glass_prof = rv_profile(0.940, 0.898)
    g_verts = [bm_g.verts.new(xform_rv(px, 0.0045, pz)) for px, pz in reversed(glass_prof)]
    f_glass = bm_g.faces.new(g_verts)
    f_glass.material_index = 0
    f_glass.smooth = False
    bm_g.normal_update()
    if f_glass.normal.y < 0:
        f_glass.normal_flip()
        bm_g.normal_update()
    bm_g.to_mesh(glass_mesh)
    bm_g.free()

    assign_planar_mirror_uvs(glass_mesh, yaw_rad=yaw_angle)
    glass_obj = bpy.data.objects.new("RearviewMirrorGlass", glass_mesh)
    glass_obj.data.materials.append(materials["MirrorGlass"])
    glass_obj.parent = parent_root
    bpy.context.scene.collection.objects.link(glass_obj)
    return housing_obj, glass_obj


def build_side_mirror_glasses(materials, parent_root: bpy.types.Object):
    """左右ドアミラー鏡面メッシュ (SideMirrorGlass_R / SideMirrorGlass_L) — +Y法線厳密保証"""
    created = []
    n_seg = 20
    for side, suffix in ((-1.0, "R"), (1.0, "L")):
        mesh = bpy.data.meshes.new(f"SideMirrorGlass_{suffix}Mesh")
        bm = bmesh.new()

        is_left_mirror = side > 0
        mirror_y = -0.880 if is_left_mirror else -1.005
        yaw_deg = 27.0 if is_left_mirror else 22.0
        yaw_angle = side * math.radians(yaw_deg)
        cos_y, sin_y = math.cos(yaw_angle), math.sin(yaw_angle)
        pivot = Vector((side * 0.918, mirror_y, 0.962))

        def xf(lx: float, ly: float, lz: float, _cy=cos_y, _sy=sin_y, _p=pivot) -> Vector:
            rx = lx * _cy - ly * _sy
            ry = lx * _sy + ly * _cy
            return _p + Vector((rx, ry, lz))

        g_verts = []
        y_glass = 0.0085
        for k in range(n_seg):
            ang = (2.0 * math.pi * k) / n_seg
            ca, sa = math.cos(ang), math.sin(ang)
            lx = (0.086 * 0.87) * math.copysign(abs(ca) ** 0.78, ca)
            lz = (0.050 * 0.85) * math.copysign(abs(sa) ** 0.80, sa)
            if lx * side > 0:
                lz *= 0.92
            g_verts.append(bm.verts.new(xf(lx, y_glass, lz)))

        f_glass = bm.faces.new(g_verts)
        f_glass.material_index = 0
        f_glass.smooth = False
        bm.normal_update()
        if f_glass.normal.y < 0:
            f_glass.normal_flip()
            bm.normal_update()
        bm.to_mesh(mesh)
        bm.free()

        assign_planar_mirror_uvs(mesh, yaw_rad=yaw_angle)
        obj = bpy.data.objects.new(f"SideMirrorGlass_{suffix}", mesh)
        obj.data.materials.append(materials["MirrorGlass"])
        obj.parent = parent_root
        bpy.context.scene.collection.objects.link(obj)
        created.append(obj)
    return created


# ==============================================================================
# 10. 車両全体ビルド & GLB エクスポート
# ==============================================================================


def generate_vehicle():
    """トヨタ クラウン セダン 3Dモデル全体を生成し GLB へエクスポート"""
    clean_scene()
    materials = setup_materials()

    root = bpy.data.objects.new("CarRoot", None)
    root.empty_display_type = "ARROWS"
    root.empty_display_size = 0.5
    bpy.context.scene.collection.objects.link(root)

    chassis = build_chassis(materials)
    chassis.parent = root

    interior = build_interior(materials)
    interior.parent = root

    steering = build_steering_wheel(materials)
    steering.parent = root

    windshield = build_windshield(materials)
    windshield.parent = root

    side_windows = build_side_windows(materials)
    side_windows.parent = root

    rear_window = build_rear_window(materials)
    rear_window.parent = root

    build_rearview_mirror(materials, root)
    build_side_mirror_glasses(materials, root)

    build_wiper(
        materials, "Driver", Vector((-0.58, -1.275, 0.891)), Euler((0.0, 0.0, 0.0), "XYZ"), root
    )
    build_wiper(
        materials, "Passenger", Vector((0.06, -1.318, 0.891)), Euler((0.0, 0.0, 0.0), "XYZ"), root
    )

    for name, pos in [
        ("Wheel_FL", Vector((-WHEEL_X_CENTER, WHEEL_Y_FRONT, WHEEL_Z))),
        ("Wheel_FR", Vector((WHEEL_X_CENTER, WHEEL_Y_FRONT, WHEEL_Z))),
        ("Wheel_RL", Vector((-WHEEL_X_CENTER, WHEEL_Y_REAR, WHEEL_Z))),
        ("Wheel_RR", Vector((WHEEL_X_CENTER, WHEEL_Y_REAR, WHEEL_Z))),
    ]:
        build_wheel(materials, name, pos, root)

    print("High-precision JDM RHD Toyota Crown Sedan (AZSH32) modeling complete! Hierarchy:")
    for obj in bpy.data.objects:
        p_name = obj.parent.name if obj.parent else "None"
        print(f"  - {obj.name} (Type: {obj.type}, Parent: {p_name})")

    script_file = globals().get("__file__")
    repo_root = (
        os.path.abspath(os.path.join(os.path.dirname(script_file), "../.."))
        if script_file
        else "/Users/kei/ghq/github.com/kexi/antigravity-deep-drive"
    )
    out_dir = os.path.join(repo_root, "apps/web/public/models")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "car.glb")

    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_extras=True,
    )
    print(f"Successfully exported car model to: {out_path} ({os.path.getsize(out_path):,} bytes)")


if __name__ == "__main__":
    generate_vehicle()

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
Antigravity Deep Drive 用 3D アセット生成（右ハンドル RHD 日本仕様 + 車内3Dプロシージャルテクスチャ）

360度全方向＆ドライバー視点レビューに基づく高精度 トヨタ クラウン セダン (16代目) モデリング仕様:
- 実寸プロポーション＆FRセダンの伸びやかな6ライト・ファストバックシルエット
  - ボディカラー: プレシャスメタル（チタニウムシルバーグレーメタリック）
- フロントフェイス:
  - ハンマーヘッド（Hammerhead）デザイン＋一文字LEDデイタイムランニングランプ＋片側4眼スクエアLEDヘッドランプ
  - ノーズ中央の立体クローム「王冠（Crown）エンブレム」
  - 大型台形「アンダープライオリティ」フロントグリル＋縦基調メッキバー列（Vertical Bars）＋左右C字コーナーガーニッシュ
  - 日本規格ナンバープレート（実寸 330mm × 165mm、白地に緑文字ディテール＆封印ボルト）
- サイドビュー:
  - 6ライトキャビンウィンドウ＋クロームウィンドウモールディング
  - 前輪アーチ直後の垂直ブラック＆クローム「フェンダーサイドガーニッシュ」
  - クラウン セダン Z 純正 20インチ 20本マルチスポーク（タービン調ダークメタリック＆切削光輝）アルミホイール
- リアフェイス:
  - 横一文字LEDリヤコンビネーションランプ（Full-width LED Taillight Bar）＋中央トヨタエンブレム＋「C R O W N」レタリング
  - リアバンパー下部の水平クロームガーニッシュ＆横長スリムリフレクター（スポーツカー用の丸4灯や4本出しマフラーは廃止）
- 右ハンドル（RHD: X = -0.38m）専用 クラウン「アイランドアーキテクチャー（Island Architecture）」内装＆3Dテクスチャ:
  - 大型杢目調「ウッディブラウン」パネル（`CrownWoodTrim`: 3D Wave + 3D Noise プロシージャル木目ノード付き）
  - 64色マルチカラーアンビエントイルミネーション（インパネ水平ライン・センターコンソール脇の間接照明LEDストリップ）
  - 12.3インチ大型連装ワイドディスプレイハウジング（メーター＋センターナビ一体型パノラミックベゼル）
  - セミアニリン本革シボ＆パンチングレザー（`InteriorDark` / `InteriorSeat` / `SteeringLeather`: 3D Voronoi 本革シボノード付き）
  - ステアリングホイール中央の立体「王冠（Crown）エンブレム」＋JIS規格の右ウインカーレバー＆左ワイパーレバー
  - ストレート型エレクトロシフトマチックノブ、エンジンスターターボタン、縦型2連カップホルダー

階層構造:
CarRoot (Empty)
├── Chassis (メッシュ: JDM外装ボディ、前後バンパー、グリル、ライト、日本ナンバープレート、エアロミラー、リアガラス)
├── Interior (メッシュ: RHD立体ダッシュボード、2連中空リングメーター、ウインカー/ワイパーレバー、ナビ、コンソール、シート、ドア内張り)
├── SteeringWheel (メッシュ: 右ハンドル位置 X=-0.38m ステアリングハンドル)
├── Windshield (メッシュ: 3次元曲面フロントガラス - UV展開必須)
├── WiperDriver (Empty: 右ハンドル運転席ワイパーピボット)
│   └── WiperBladeDriver (メッシュ: ワイパーアーム＆エアロブレード)
├── WiperPassenger (Empty: 助手席ワイパーピボット)
│   └── WiperBladePassenger (メッシュ: ワイパーアーム＆エアロブレード)
├── Wheel_FL (メッシュ: 前右タイヤ・中空リム・10本スポーク・ローター・キャリパー)
├── Wheel_FR (メッシュ: 前左タイヤ・中空リム・10本スポーク・ローター・キャリパー)
├── Wheel_RL (メッシュ: 後右タイヤ・中空リム・10本スポーク・ローター・キャリパー)
└── Wheel_RR (メッシュ: 後左タイヤ・中空リム・10本スポーク・ローター・キャリパー)
"""

import math
import os

import bpy

# isort: split
# Why not: bpy 単体 wheel (PyPI) では import bpy 実行時に初めて bmesh / mathutils が
# sys.modules に登録されるため、アルファベット順で bmesh を先に import すると ModuleNotFoundError になる。
import bmesh
from mathutils import Euler, Vector


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


def setup_materials():
    """トヨタ クラウン セダン (AZSH32) 用PBRマテリアル一式を定義
    Why metallic を 0.45〜0.55 に抑えるか:
    Three.js 側で HDRI 環境マップ無し（DirectionalLight + HemisphereLight）で描画される際、
    metallic が 0.9 以上だと拡散反射成分 (1 - metallic) が消失して真っ黒なシルエットになるのを防ぐため。
    """
    crown_wood = create_pbr_material(
        "CrownWoodTrim",
        base_color=(0.28, 0.15, 0.08, 1.0),
        roughness=0.34,
        metallic=0.06,
        coat_weight=0.45,
        coat_roughness=0.14,
        emission_color=(0.24, 0.12, 0.06, 1.0),
        emission_strength=0.06,
    )
    attach_crown_wood_3d_nodes(crown_wood)

    interior_dark = create_pbr_material(
        "InteriorDark",
        base_color=(0.12, 0.125, 0.145, 1.0),
        roughness=0.64,
        metallic=0.05,
        emission_color=(0.10, 0.105, 0.12, 1.0),
        emission_strength=0.04,
    )
    attach_crown_leather_3d_nodes(
        interior_dark,
        col_dark=(0.10, 0.105, 0.125, 1.0),
        col_light=(0.15, 0.16, 0.185, 1.0),
        scale=26.0,
        bump_strength=0.20,
    )

    interior_seat = create_pbr_material(
        "InteriorSeat",
        base_color=(0.17, 0.175, 0.20, 1.0),
        roughness=0.50,
        metallic=0.06,
        emission_color=(0.14, 0.145, 0.17, 1.0),
        emission_strength=0.05,
    )
    attach_crown_leather_3d_nodes(
        interior_seat,
        col_dark=(0.14, 0.145, 0.17, 1.0),
        col_light=(0.21, 0.22, 0.25, 1.0),
        scale=30.0,
        bump_strength=0.25,
    )

    steering_leather = create_pbr_material(
        "SteeringLeather",
        base_color=(0.11, 0.115, 0.135, 1.0),
        roughness=0.52,
        metallic=0.06,
        emission_color=(0.09, 0.095, 0.11, 1.0),
        emission_strength=0.04,
    )
    attach_crown_leather_3d_nodes(
        steering_leather,
        col_dark=(0.09, 0.095, 0.115, 1.0),
        col_light=(0.14, 0.15, 0.175, 1.0),
        scale=34.0,
        bump_strength=0.22,
    )

    return {
        # 外装 クラウン セダン象徴色「プレシャスメタル（チタニウムシルバーグレーメタリック）」
        "BodyPaint": create_pbr_material(
            "BodyPaint",
            base_color=(0.46, 0.49, 0.53, 1.0),
            metallic=0.52,
            roughness=0.20,
            coat_weight=0.85,
            coat_roughness=0.08,
        ),
        # グロス＆サテンブラックトリム（アンダープライオリティグリル枠、ピラー、ロアガーニッシュ、ホイールハウス内壁）
        "BlackTrim": create_pbr_material(
            "BlackTrim",
            base_color=(0.035, 0.038, 0.045, 1.0),
            roughness=0.42,
            metallic=0.18,
        ),
        # クローム＆サテンシルバー（王冠エンブレム、縦グリルバー、6ライトウィンドウモール、メーターリング）
        "Chrome": create_pbr_material(
            "Chrome",
            base_color=(0.88, 0.91, 0.95, 1.0),
            metallic=0.48,
            roughness=0.18,
            emission_color=(0.85, 0.88, 0.92, 1.0),
            emission_strength=0.14,
        ),
        # フロントガラス（高透過PBRガラス）
        "WindshieldGlass": create_pbr_material(
            "WindshieldGlass",
            base_color=(0.88, 0.94, 0.98, 0.22),
            metallic=0.05,
            roughness=0.02,
            transmission=0.92,
            ior=1.52,
            alpha=0.28,
        ),
        # リアガラス・6ライトクォーターガラス（スモークガラス）
        "WindowGlass": create_pbr_material(
            "WindowGlass",
            base_color=(0.10, 0.14, 0.18, 0.45),
            metallic=0.15,
            roughness=0.06,
            transmission=0.78,
            ior=1.52,
            alpha=0.45,
        ),
        # ハンマーヘッド一文字DRL ＆ 4眼LEDヘッドライト（クールホワイト発光）
        "HeadlightLED": create_pbr_material(
            "HeadlightLED",
            base_color=(0.95, 0.98, 1.0, 1.0),
            emission_color=(0.92, 0.96, 1.0, 1.0),
            emission_strength=4.5,
            roughness=0.08,
        ),
        # 横一文字テールライトLED（クリムゾンレッド発光）
        "TaillightLED": create_pbr_material(
            "TaillightLED",
            base_color=(0.92, 0.03, 0.05, 1.0),
            emission_color=(1.0, 0.05, 0.07, 1.0),
            emission_strength=4.2,
            roughness=0.08,
        ),
        # 日本規格ナンバープレート白地
        "JdmPlateWhite": create_pbr_material(
            "JdmPlateWhite",
            base_color=(0.96, 0.97, 0.95, 1.0),
            metallic=0.04,
            roughness=0.35,
            emission_color=(0.94, 0.96, 0.93, 1.0),
            emission_strength=0.38,
        ),
        # 日本規格ナンバープレート濃緑文字
        "JdmPlateGreen": create_pbr_material(
            "JdmPlateGreen",
            base_color=(0.03, 0.24, 0.11, 1.0),
            metallic=0.05,
            roughness=0.40,
            emission_color=(0.03, 0.22, 0.10, 1.0),
            emission_strength=0.15,
        ),
        # ドアミラー・ルームミラー鏡面
        "MirrorGlass": create_pbr_material(
            "MirrorGlass",
            base_color=(0.28, 0.36, 0.44, 1.0),
            metallic=0.35,
            roughness=0.18,
            emission_color=(0.18, 0.24, 0.30, 1.0),
            emission_strength=0.08,
        ),
        # 内装ダッシュボードソフトパッド（3D本革シボノード付きチャコールレザー）
        "InteriorDark": interior_dark,
        # 内装セミアニリン本革シート＆ドアトリム（3D本革シボノード付き）
        "InteriorSeat": interior_seat,
        # クラウン アイランドアーキテクチャー 大型杢目調「ウッディブラウン」パネル（3D杢目ノード付き）
        "CrownWoodTrim": crown_wood,
        # クラウン 64色マルチカラーアンビエントイルミネーション（胡粉・ウォームアンバーゴールド間接照明）
        "AmbientStripLED": create_pbr_material(
            "AmbientStripLED",
            base_color=(1.0, 0.78, 0.45, 1.0),
            emission_color=(1.0, 0.74, 0.38, 1.0),
            emission_strength=2.20,
            roughness=0.15,
        ),
        # メーター盤・12.3インチ連装ナビ画面のダーク背景
        "MeterBack": create_pbr_material(
            "MeterBack",
            base_color=(0.015, 0.025, 0.045, 1.0),
            emission_color=(0.02, 0.05, 0.10, 1.0),
            emission_strength=0.18,
            roughness=0.22,
        ),
        # メーター目盛り・ナビ地図ライン発光（シャープなシアンブルーOLED発光）
        "DashboardScreen": create_pbr_material(
            "DashboardScreen",
            base_color=(0.08, 0.55, 0.95, 1.0),
            emission_color=(0.12, 0.68, 1.0, 1.0),
            emission_strength=1.35,
            roughness=0.15,
        ),
        # メーター指針・スタートボタン・ハザードスイッチ発光
        "GaugeNeedleRed": create_pbr_material(
            "GaugeNeedleRed",
            base_color=(0.95, 0.12, 0.08, 1.0),
            emission_color=(1.0, 0.16, 0.08, 1.0),
            emission_strength=1.80,
            roughness=0.18,
        ),
        # ステアリングホイール本革（3D本革シボノード付き）
        "SteeringLeather": steering_leather,
        # アルカンターラ調（ウルトラスエード）起毛トリム（Aピラー内張り・メーターフード内張り）
        "AlcantaraTrim": create_pbr_material(
            "AlcantaraTrim",
            base_color=(0.14, 0.145, 0.165, 1.0),
            roughness=0.88,
            metallic=0.02,
            emission_color=(0.11, 0.115, 0.135, 1.0),
            emission_strength=0.04,
        ),
        # サドルタン（カッパーブラウン）本革ステッチライン
        "SaddleStitch": create_pbr_material(
            "SaddleStitch",
            base_color=(0.68, 0.42, 0.22, 1.0),
            roughness=0.42,
            metallic=0.14,
            emission_color=(0.58, 0.34, 0.16, 1.0),
            emission_strength=0.08,
        ),
        # 車内サテンシルバーヘアライン加飾
        "SilverTrim": create_pbr_material(
            "SilverTrim",
            base_color=(0.82, 0.85, 0.89, 1.0),
            metallic=0.58,
            roughness=0.24,
            coat_weight=0.55,
            coat_roughness=0.14,
            emission_color=(0.76, 0.79, 0.84, 1.0),
            emission_strength=0.10,
        ),
        # ワイパーブラック
        "WiperBlack": create_pbr_material(
            "WiperBlack",
            base_color=(0.025, 0.025, 0.03, 1.0),
            roughness=0.65,
            metallic=0.25,
        ),
        # タイヤゴム
        "TireRubber": create_pbr_material(
            "TireRubber",
            base_color=(0.035, 0.036, 0.04, 1.0),
            roughness=0.84,
            metallic=0.02,
        ),
        # クラウン セダン Z 20インチ 20本マルチスポークアルミホイール（ダークメタリック＆切削光輝）
        "WheelAlloy": create_pbr_material(
            "WheelAlloy",
            base_color=(0.76, 0.80, 0.85, 1.0),
            metallic=0.52,
            roughness=0.18,
        ),
        # ブレーキローター（ベンチレーテッドスチールディスク）
        "BrakeRotor": create_pbr_material(
            "BrakeRotor",
            base_color=(0.55, 0.58, 0.62, 1.0),
            metallic=0.48,
            roughness=0.28,
        ),
        # ブレーキキャリパー（クラウン純正の上品なサテンシルバーメタリックキャリパー）
        "BrakeCaliper": create_pbr_material(
            "BrakeCaliper",
            base_color=(0.68, 0.71, 0.75, 1.0),
            metallic=0.45,
            roughness=0.22,
            coat_weight=0.60,
        ),
    }


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
        (v0, v1, v2, v3),  # bottom (-Z)
        (v4, v7, v6, v5),  # top (+Z)
        (v0, v4, v5, v1),  # front (-Y)
        (v2, v6, v7, v3),  # back (+Y)
        (v0, v3, v7, v4),  # left (-X)
        (v1, v5, v6, v2),  # right (+X)
    ]
    created_faces = []
    for f_verts in faces:
        face = bm.faces.new(f_verts)
        face.material_index = mat_idx
        face.smooth = smooth
        created_faces.append(face)
    return created_faces


def add_hexahedron(bm, verts_8: list[Vector], mat_idx=0, smooth=True):
    """任意の8頂点 [b0,b1,b2,b3, t0,t1,t2,t3] から六面体（スラントブロック・楔形パーツ）を追加"""
    v = [bm.verts.new(pt) for pt in verts_8]
    faces = [
        (v[0], v[1], v[2], v[3]),  # bottom
        (v[4], v[7], v[6], v[5]),  # top
        (v[0], v[4], v[5], v[1]),  # front (-Y)
        (v[2], v[6], v[7], v[3]),  # back (+Y)
        (v[0], v[3], v[7], v[4]),  # left (-X)
        (v[1], v[5], v[6], v[2]),  # right (+X)
    ]
    for f_v in faces:
        f = bm.faces.new(f_v)
        f.material_index = mat_idx
        f.smooth = smooth


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
    """2点 p0 -> p1 を結ぶ傾斜ピラー・ストラット角柱を追加"""
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
    """bmesh に円柱（または両端開放の円筒）を追加"""
    top_verts = []
    bot_verts = []
    half_h = height * 0.5

    for i in range(segments):
        angle = (2.0 * math.pi * i) / segments
        ca = math.cos(angle) * radius
        sa = math.sin(angle) * radius

        if axis == "X":
            v_bot = bm.verts.new(center + Vector((-half_h, ca, sa)))
            v_top = bm.verts.new(center + Vector((half_h, ca, sa)))
        elif axis == "Y":
            v_bot = bm.verts.new(center + Vector((ca, -half_h, sa)))
            v_top = bm.verts.new(center + Vector((ca, half_h, sa)))
        else:  # Z
            v_bot = bm.verts.new(center + Vector((ca, sa, -half_h)))
            v_top = bm.verts.new(center + Vector((ca, sa, half_h)))

        bot_verts.append(v_bot)
        top_verts.append(v_top)

    for i in range(segments):
        ni = (i + 1) % segments
        face = bm.faces.new([bot_verts[i], bot_verts[ni], top_verts[ni], top_verts[i]])
        face.material_index = mat_idx
        face.smooth = smooth

    if cap_ends:
        f_bot = bm.faces.new(list(reversed(bot_verts)))
        f_bot.material_index = mat_idx
        f_bot.smooth = False
        f_top = bm.faces.new(top_verts)
        f_top.material_index = mat_idx
        f_top.smooth = False


def add_hollow_tube_x(
    bm,
    center: Vector,
    r_outer: float,
    r_inner: float,
    width_x: float,
    segments=32,
    mat_idx=1,
    smooth=True,
):
    """X軸方向の中空リングバレル（ホイールのアウターリム用：外側を塞がない中空円筒）を追加"""
    hx = width_x * 0.5
    out_left = []
    out_right = []
    in_left = []
    in_right = []

    for i in range(segments):
        ang = (2.0 * math.pi * i) / segments
        cy = math.cos(ang)
        cz = math.sin(ang)
        out_left.append(bm.verts.new(center + Vector((-hx, cy * r_outer, cz * r_outer))))
        out_right.append(bm.verts.new(center + Vector((hx, cy * r_outer, cz * r_outer))))
        in_left.append(bm.verts.new(center + Vector((-hx, cy * r_inner, cz * r_inner))))
        in_right.append(bm.verts.new(center + Vector((hx, cy * r_inner, cz * r_inner))))

    for i in range(segments):
        ni = (i + 1) % segments
        f_out = bm.faces.new([out_left[i], out_left[ni], out_right[ni], out_right[i]])
        f_out.material_index = mat_idx
        f_out.smooth = smooth
        f_in = bm.faces.new([in_right[i], in_right[ni], in_left[ni], in_left[i]])
        f_in.material_index = mat_idx
        f_in.smooth = smooth
        f_l = bm.faces.new([in_left[i], in_left[ni], out_left[ni], out_left[i]])
        f_l.material_index = mat_idx
        f_l.smooth = False
        f_r = bm.faces.new([out_right[i], out_right[ni], in_right[ni], in_right[i]])
        f_r.material_index = mat_idx
        f_r.smooth = False


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
    """Y軸方向の中空リング（JDM 丸型4灯テールランプおよびコックピット2連メーターベゼル用：中央を塞がない中空円環）"""
    hy = depth_y * 0.5
    out_front = []
    out_back = []
    in_front = []
    in_back = []

    for i in range(segments):
        ang = (2.0 * math.pi * i) / segments
        cx = math.cos(ang)
        cz = math.sin(ang)
        out_front.append(bm.verts.new(center + Vector((cx * r_outer, -hy, cz * r_outer))))
        out_back.append(bm.verts.new(center + Vector((cx * r_outer, hy, cz * r_outer))))
        in_front.append(bm.verts.new(center + Vector((cx * r_inner, -hy, cz * r_inner))))
        in_back.append(bm.verts.new(center + Vector((cx * r_inner, hy, cz * r_inner))))

    for i in range(segments):
        ni = (i + 1) % segments
        f_out = bm.faces.new([out_front[i], out_front[ni], out_back[ni], out_back[i]])
        f_out.material_index = mat_idx
        f_out.smooth = smooth
        f_in = bm.faces.new([in_back[i], in_back[ni], in_front[ni], in_front[i]])
        f_in.material_index = mat_idx
        f_in.smooth = smooth
        f_f = bm.faces.new([in_front[i], in_front[ni], out_front[ni], out_front[i]])
        f_f.material_index = mat_idx
        f_f.smooth = False
        f_b = bm.faces.new([out_back[i], out_back[ni], in_back[ni], in_back[i]])
        f_b.material_index = mat_idx
        f_b.smooth = False


def add_japanese_license_plate(
    bm,
    center: Vector,
    is_rear: bool,
    mat_trim: int,
    mat_white: int,
    mat_green: int,
    mat_chrome: int,
):
    """日本規格ナンバープレート（普通車 中板: 横 330mm × 縦 165mm）を白地＋緑文字レリーフ＋封印ボルト付きで造形"""
    dir_y = 1.0 if is_rear else -1.0
    # 1. ブラック樹脂ナンバーフレーム (342mm x 175mm)
    add_box(
        bm,
        center=center,
        size=Vector((0.342, 0.014, 0.175)),
        mat_idx=mat_trim,
        smooth=False,
    )
    # 2. 日本の白ナンバープレート本体 (実寸 330mm x 165mm)
    plate_y = center.y + dir_y * 0.004
    add_box(
        bm,
        center=Vector((center.x, plate_y, center.z)),
        size=Vector((0.330, 0.012, 0.165)),
        mat_idx=mat_white,
        smooth=False,
    )

    # 3. 緑文字レリーフ（上部：地名「千代田 330」、下部左：ひらがな「す」、下部中央：ハイフン、下部4桁数字「40-00」）
    char_y = center.y + dir_y * 0.010
    # 上段：地名＆分類番号バー
    add_box(
        bm,
        center=Vector((center.x - 0.045, char_y, center.z + 0.042)),
        size=Vector((0.075, 0.004, 0.028)),
        mat_idx=mat_green,
    )
    add_box(
        bm,
        center=Vector((center.x + 0.050, char_y, center.z + 0.042)),
        size=Vector((0.070, 0.004, 0.028)),
        mat_idx=mat_green,
    )
    # 下段左：ひらがな
    add_box(
        bm,
        center=Vector((center.x - 0.118, char_y, center.z - 0.022)),
        size=Vector((0.026, 0.004, 0.036)),
        mat_idx=mat_green,
    )
    # 下段4桁大型ナンバー + ハイフン
    for dx in [-0.068, -0.024, 0.046, 0.092]:
        add_box(
            bm,
            center=Vector((center.x + dx, char_y, center.z - 0.022)),
            size=Vector((0.030, 0.004, 0.062)),
            mat_idx=mat_green,
        )
    add_box(
        bm,
        center=Vector((center.x + 0.011, char_y, center.z - 0.022)),
        size=Vector((0.018, 0.004, 0.010)),
        mat_idx=mat_green,
    )

    # 4. 上部左右の取付ボルト＆リア左上のアルミ封印キャップ
    for bx in [-0.105, 0.105]:
        bolt_r = 0.009 if (is_rear and bx < 0) else 0.006
        add_cylinder(
            bm,
            center=Vector((center.x + bx, char_y + dir_y * 0.002, center.z + 0.058)),
            radius=bolt_r,
            height=0.006,
            segments=12,
            axis="Y",
            mat_idx=mat_chrome,
            smooth=False,
        )


def build_lofted_lower_body(bm, mat_idx=0):
    """車両のロアボディ（Y=-2.26m フロントノーズ 〜 Y=+2.21m リアテール）をロフト曲面として生成
    Why キャビン区間 (Y = -0.86m .. +1.36m) のみ w_in / zt_in / zc を掘り下げるか:
    従来のように全断面で zc = 0.85..0.88m の天面を張ると、キャビン内部をベルトライン高さの水平板が横断し、
    ステアリング下部・センターコンソール・シート座面・足元フロアが外装ボディ（Chassis）に埋没してしまうため。
    キャビン区間では左右ドアシル内縁 (|X| = 0.745m) からフロアパン (Z = 0.33m, 内装フロア Z = 0.36m の直下) へ
    バスタブ状に掘り下げることで、360度どの角度から車内を見ても下半分の埋没をゼロにする。
    """
    # (y, wb, wm, wt, zb, zm, zt, w_in, zt_in, zc)
    stations = [
        (-2.26, 0.72, 0.78, 0.68, 0.23, 0.35, 0.46, 0.26, 0.49, 0.49),  # 0: フロントノーズ最先端
        (
            -2.12,
            0.82,
            0.88,
            0.78,
            0.21,
            0.40,
            0.55,
            0.30,
            0.59,
            0.59,
        ),  # 1: ヘッドライト・グリル上縁
        (-1.82, 0.87, 0.94, 0.85, 0.21, 0.46, 0.69, 0.32, 0.73, 0.73),  # 2: 前輪アーチ前方
        (-1.38, 0.82, 0.96, 0.89, 0.36, 0.58, 0.80, 0.34, 0.83, 0.83),  # 3: 前輪ホイールアーチ頂部
        (-0.96, 0.88, 0.96, 0.88, 0.21, 0.50, 0.84, 0.745, 0.86, 0.87),  # 4: カウル・Aピラー根元
        (
            -0.88,
            0.88,
            0.96,
            0.88,
            0.20,
            0.50,
            0.845,
            0.745,
            0.85,
            0.33,
        ),  # 5: フロントバルクヘッド（キャビン開口前端・足元フロア下へ段落ち）
        (
            -0.35,
            0.89,
            0.95,
            0.87,
            0.20,
            0.50,
            0.85,
            0.745,
            0.85,
            0.33,
        ),  # 6: フロントドア中央（キャビンバスタブ）
        (
            0.35,
            0.89,
            0.95,
            0.87,
            0.20,
            0.51,
            0.86,
            0.745,
            0.86,
            0.33,
        ),  # 7: Bピラー・リアドア（キャビンバスタブ）
        (
            0.95,
            0.90,
            0.98,
            0.89,
            0.21,
            0.53,
            0.88,
            0.745,
            0.88,
            0.33,
        ),  # 8: リアフェンダー前縁（キャビンバスタブ）
        (
            1.35,
            0.82,
            0.98,
            0.90,
            0.36,
            0.60,
            0.90,
            0.745,
            0.88,
            0.33,
        ),  # 9: リアシート背面バルクヘッド下端
        (
            1.42,
            0.82,
            0.98,
            0.90,
            0.36,
            0.60,
            0.90,
            0.70,
            0.89,
            0.89,
        ),  # 10: リアパーセルシェルフ・後輪アーチ頂部
        (1.78, 0.88, 0.95, 0.85, 0.24, 0.54, 0.88, 0.32, 0.89, 0.89),  # 11: リアデッキ・トランク
        (
            2.10,
            0.83,
            0.89,
            0.79,
            0.27,
            0.54,
            0.86,
            0.30,
            0.88,
            0.88,
        ),  # 12: ダックテールスポイラー縁
        (2.21, 0.76, 0.82, 0.73, 0.29, 0.52, 0.78, 0.28, 0.80, 0.80),  # 13: リアバンパー後端
    ]

    profile_rings = []
    for y, wb, wm, wt, zb, zm, zt, w_in, zt_in, zc in stations:
        w_floor = max(0.20, w_in - 0.025)
        ring = [
            bm.verts.new(Vector((-wb * 0.5, y, zb))),
            bm.verts.new(Vector((-wb, y, zb + 0.03))),
            bm.verts.new(Vector((-wm, y, zm))),
            bm.verts.new(Vector((-wt, y, zt))),
            bm.verts.new(Vector((-w_in, y, zt_in))),
            bm.verts.new(Vector((-w_floor, y, zc))),
            bm.verts.new(Vector((w_floor, y, zc))),
            bm.verts.new(Vector((w_in, y, zt_in))),
            bm.verts.new(Vector((wt, y, zt))),
            bm.verts.new(Vector((wm, y, zm))),
            bm.verts.new(Vector((wb, y, zb + 0.03))),
            bm.verts.new(Vector((wb * 0.5, y, zb))),
        ]
        profile_rings.append(ring)

    n_pts = len(profile_rings[0])
    for s_idx in range(len(profile_rings) - 1):
        r0 = profile_rings[s_idx]
        r1 = profile_rings[s_idx + 1]
        for i in range(n_pts):
            ni = (i + 1) % n_pts
            f = bm.faces.new([r0[i], r0[ni], r1[ni], r1[i]])
            f.material_index = mat_idx
            # キャビン内壁・フロアパン区間 (i == 4, 5, 6) はフラットシェーディングにしてエッジの陰影破綻を防ぐ
            f.smooth = i not in (4, 5, 6)

    f_front = bm.faces.new(list(reversed(profile_rings[0])))
    f_front.material_index = mat_idx
    f_front.smooth = False

    f_rear = bm.faces.new(profile_rings[-1])
    f_rear.material_index = mat_idx
    f_rear.smooth = False


def build_wheel_arches_and_liners(bm, paint_mat=0, black_mat=1):
    """前後4輪のホイールハウス遮光ライナーと立体フェンダーアーチリップを追加"""
    for side in [-1.0, 1.0]:
        for wy in [-1.38, 1.38]:
            add_cylinder(
                bm,
                center=Vector((side * 0.68, wy, 0.35)),
                radius=0.365,
                height=0.22,
                segments=24,
                axis="X",
                mat_idx=black_mat,
                smooth=True,
                cap_ends=True,
            )
            arch_segs = 12
            r_in = 0.385
            r_out = 0.410
            x_in = side * 0.88
            x_out = side * 0.942
            arch_rings = []
            for s in range(arch_segs + 1):
                ang = math.pi * (s / arch_segs)
                cy = wy - math.cos(ang) * r_in
                cz = 0.37 + math.sin(ang) * r_in
                cy_o = wy - math.cos(ang) * r_out
                cz_o = 0.37 + math.sin(ang) * r_out
                v_i = bm.verts.new(Vector((x_in, cy, cz)))
                v_o = bm.verts.new(Vector((x_out, cy_o, cz_o)))
                arch_rings.append((v_i, v_o))
            for s in range(arch_segs):
                v0i, v0o = arch_rings[s]
                v1i, v1o = arch_rings[s + 1]
                verts = [v0i, v1i, v1o, v0o] if side > 0 else [v0o, v1o, v1i, v0i]
                f = bm.faces.new(verts)
                f.material_index = paint_mat
                f.smooth = True


def add_crown_emblem(
    bm,
    center: Vector,
    scale: float,
    axis_y_dir: float,
    mat_chrome: int,
    mat_back: int = -1,
):
    """トヨタ クラウン伝統の『王冠（Crown）エンブレム』を立体レリーフとして造形"""
    if mat_back >= 0:
        add_box(
            bm,
            center=center + Vector((0.0, axis_y_dir * 0.001, 0.0)),
            size=Vector((0.056 * scale, 0.008 * scale, 0.046 * scale)),
            mat_idx=mat_back,
            smooth=False,
        )
    ey = center.y + axis_y_dir * 0.005 * scale
    # 王冠ベースバンド（水平台座）
    add_box(
        bm,
        center=Vector((center.x, ey, center.z - 0.011 * scale)),
        size=Vector((0.044 * scale, 0.006 * scale, 0.007 * scale)),
        mat_idx=mat_chrome,
        smooth=False,
    )
    # 王冠の5本ピラー（中央が高く、左右に広がるクラウン紋章）
    peaks = [
        (0.0, 0.014, 0.024),
        (-0.010, 0.011, 0.020),
        (0.010, 0.011, 0.020),
        (-0.019, 0.008, 0.016),
        (0.019, 0.008, 0.016),
    ]
    for px, pz, ph in peaks:
        add_box(
            bm,
            center=Vector((center.x + px * scale, ey, center.z + (pz - 0.008) * scale)),
            size=Vector((0.0055 * scale, 0.006 * scale, ph * scale)),
            mat_idx=mat_chrome,
            smooth=False,
        )


def build_curved_roof_and_pillars(bm):
    """滑らかなアーチを描くクラウン セダンの6ライトルーフ天板〜ファストバックCピラー・クロームウィンドウモールを構築
    mat_idx: 0=BodyPaint, 1=BlackTrim, 2=Chrome, 3=WindowGlass"""
    roof_stations = [
        (-0.532, 0.658, 1.402, 1.430),
        (-0.50, 0.66, 1.404, 1.432),
        (-0.20, 0.68, 1.43, 1.465),
        (0.15, 0.68, 1.44, 1.475),
        (0.45, 0.66, 1.415, 1.45),
        (0.72, 0.64, 1.365, 1.395),
    ]
    roof_rings = []
    for y, hw, z_side, z_mid in roof_stations:
        thick = 0.036
        ring = [
            bm.verts.new(Vector((-hw, y, z_side))),
            bm.verts.new(Vector((-hw * 0.45, y, z_mid))),
            bm.verts.new(Vector((hw * 0.45, y, z_mid))),
            bm.verts.new(Vector((hw, y, z_side))),
            bm.verts.new(Vector((hw, y, z_side - thick))),
            bm.verts.new(Vector((hw * 0.45, y, z_mid - thick))),
            bm.verts.new(Vector((-hw * 0.45, y, z_mid - thick))),
            bm.verts.new(Vector((-hw, y, z_side - thick))),
        ]
        roof_rings.append(ring)

    n_r = len(roof_rings[0])
    for i in range(len(roof_rings) - 1):
        r0 = roof_rings[i]
        r1 = roof_rings[i + 1]
        for j in range(n_r):
            nj = (j + 1) % n_r
            f = bm.faces.new([r0[j], r0[nj], r1[nj], r1[j]])
            f.material_index = 0
            f.smooth = True

    f_rf = bm.faces.new(list(reversed(roof_rings[0])))
    f_rf.material_index = 1
    f_rr = bm.faces.new(roof_rings[-1])
    f_rr.material_index = 1

    # シャークフィンアンテナ
    shark_verts = [
        Vector((-0.022, 0.44, 1.43)),
        Vector((0.022, 0.44, 1.43)),
        Vector((0.026, 0.68, 1.385)),
        Vector((-0.026, 0.68, 1.385)),
        Vector((-0.004, 0.52, 1.48)),
        Vector((0.004, 0.52, 1.48)),
        Vector((0.005, 0.69, 1.495)),
        Vector((-0.005, 0.69, 1.495)),
    ]
    add_hexahedron(bm, shark_verts, mat_idx=0, smooth=True)

    # 左右の傾斜Aピラー・Bピラー・6ライトクォーターピラー・ファストバックCピラー＆クロームウィンドウモール
    for side in [-1.0, 1.0]:
        add_slanted_strut(
            bm,
            p0=Vector((side * 0.742, -1.26, 0.86)),
            p1=Vector((side * 0.658, -0.48, 1.40)),
            width_x=0.048,
            depth_y=0.072,
            taper=0.82,
            mat_idx=1,
            smooth=False,
        )
        add_slanted_strut(
            bm,
            p0=Vector((side * 0.798, 0.16, 0.85)),
            p1=Vector((side * 0.674, 0.20, 1.432)),
            width_x=0.040,
            depth_y=0.082,
            taper=0.88,
            mat_idx=1,
            smooth=False,
        )
        # クラウン セダン特徴の6ライトウィンドウ用リアドアディバイダーバー
        add_slanted_strut(
            bm,
            p0=Vector((side * 0.780, 0.92, 0.87)),
            p1=Vector((side * 0.642, 0.72, 1.362)),
            width_x=0.028,
            depth_y=0.042,
            taper=0.85,
            mat_idx=1,
            smooth=False,
        )
        add_slanted_strut(
            bm,
            p0=Vector((side * 0.758, 1.72, 0.89)),
            p1=Vector((side * 0.640, 0.71, 1.365)),
            width_x=0.072,
            depth_y=0.16,
            taper=0.78,
            mat_idx=0,
            smooth=True,
        )
        # クラウン セダンの6ライトウィンドウ下端を走る水平クロームベルトラインモールディング＆ウェザーストリップ
        add_box(
            bm,
            center=Vector((side * 0.885, 0.18, 0.862)),
            size=Vector((0.016, 2.58, 0.016)),
            mat_idx=2,
            smooth=False,
        )
        add_box(
            bm,
            center=Vector((side * 0.775, 0.18, 0.860)),
            size=Vector((0.032, 2.86, 0.018)),
            mat_idx=1,
            smooth=False,
        )
        # アッパーウィンドウフレームのクロームモールディング（Aピラー上端〜ルーフサイド〜Cピラー後端）
        upper_molding_pts = [
            Vector((side * 0.742, -1.24, 0.872)),
            Vector((side * 0.658, -0.48, 1.404)),
            Vector((side * 0.678, -0.18, 1.434)),
            Vector((side * 0.678, 0.18, 1.438)),
            Vector((side * 0.660, 0.46, 1.416)),
            Vector((side * 0.642, 0.72, 1.366)),
            Vector((side * 0.758, 1.68, 0.898)),
        ]
        for m_i in range(len(upper_molding_pts) - 1):
            add_slanted_strut(
                bm,
                p0=upper_molding_pts[m_i],
                p1=upper_molding_pts[m_i + 1],
                width_x=0.014,
                depth_y=0.018,
                taper=1.0,
                mat_idx=2,
                smooth=True,
            )


def build_chassis(materials) -> bpy.types.Object:
    """トヨタ クラウン セダン (AZSH32) 外装ボディ (Chassis) をモデリング"""
    mesh = bpy.data.meshes.new("ChassisMesh")
    bm = bmesh.new()

    # 0: BodyPaint, 1: BlackTrim, 2: Chrome, 3: WindowGlass, 4: HeadlightLED, 5: TaillightLED,
    # 6: JdmPlateWhite, 7: JdmPlateGreen, 8: MirrorGlass
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

    # 1. 流線型ロフトロアボディ
    build_lofted_lower_body(bm, mat_idx=0)

    # 2. ホイールハウス遮光ライナー＆立体フェンダーアーチ
    build_wheel_arches_and_liners(bm, paint_mat=0, black_mat=1)

    # 3. 曲面ルーフ＆6ライト傾斜ピラー＆リアガラス
    build_curved_roof_and_pillars(bm)

    # 4. サイドロッカーモール＆クラウン特徴のフロントフェンダー縦ガーニッシュ＆カラードドアハンドル
    for side in [-1.0, 1.0]:
        # サイドロッカーブラック＆クロームアクセントモール
        add_box(
            bm,
            center=Vector((side * 0.905, 0.0, 0.215)),
            size=Vector((0.045, 1.88, 0.042)),
            mat_idx=1,
            smooth=False,
        )
        add_box(
            bm,
            center=Vector((side * 0.928, 0.0, 0.228)),
            size=Vector((0.012, 1.82, 0.014)),
            mat_idx=2,
            smooth=False,
        )
        # クラウン セダン象徴のフロントフェンダー縦型ブラック＆クロームサイドガーニッシュ（前輪アーチ直後 Y=-0.92m）
        add_box(
            bm,
            center=Vector((side * 0.952, -0.92, 0.56)),
            size=Vector((0.016, 0.036, 0.24)),
            mat_idx=1,
            smooth=False,
        )
        add_box(
            bm,
            center=Vector((side * 0.958, -0.92, 0.56)),
            size=Vector((0.008, 0.014, 0.21)),
            mat_idx=2,
            smooth=False,
        )
        # 前後ドアグリップハンドル（ボディ同色＋上部クロームライン）
        for door_y in [-0.15, 0.58]:
            add_box(
                bm,
                center=Vector((side * 0.955, door_y, 0.77)),
                size=Vector((0.020, 0.16, 0.028)),
                mat_idx=0,
                smooth=True,
            )
            add_box(
                bm,
                center=Vector((side * 0.962, door_y, 0.782)),
                size=Vector((0.010, 0.15, 0.008)),
                mat_idx=2,
                smooth=False,
            )

    # 5. クラウン セダン フロントフェイス（ハンマーヘッド + 大型台形アンダープライオリティ縦バーグリル + 王冠エンブレム）
    # フロントアンダースポイラー＆ロアクロームリップ（ロアボディ幅 wb=0.72..0.82 の内側にぴったり収める）
    splitter_verts = [
        Vector((-0.71, -2.285, 0.205)),
        Vector((0.71, -2.285, 0.205)),
        Vector((0.81, -2.10, 0.205)),
        Vector((-0.81, -2.10, 0.205)),
        Vector((-0.71, -2.270, 0.236)),
        Vector((0.71, -2.270, 0.236)),
        Vector((0.81, -2.10, 0.236)),
        Vector((-0.81, -2.10, 0.236)),
    ]
    add_hexahedron(bm, splitter_verts, mat_idx=1, smooth=False)
    # フロントリップスポイラー下端ロアモール（ピアノブラック仕上げ）
    add_box(
        bm,
        center=Vector((0.0, -2.282, 0.212)),
        size=Vector((1.36, 0.018, 0.014)),
        mat_idx=1,
        smooth=False,
    )

    # 大型台形「アンダープライオリティ」グリルハウジング（ブラック樹脂ベース）
    grille_verts = [
        Vector((-0.66, -2.282, 0.22)),
        Vector((0.66, -2.282, 0.22)),
        Vector((0.66, -2.210, 0.22)),
        Vector((-0.66, -2.210, 0.22)),
        Vector((-0.54, -2.272, 0.455)),
        Vector((0.54, -2.272, 0.455)),
        Vector((0.54, -2.200, 0.455)),
        Vector((-0.54, -2.200, 0.455)),
    ]
    add_hexahedron(bm, grille_verts, mat_idx=1, smooth=False)

    # クラウン セダン最大の特徴：アンダープライオリティグリルの「縦基調グロスブラックバー列（Vertical Bars）」19本
    # Why not メッキ調 (mat_idx=2):
    # 実車トヨタ クラウン セダン (AZSH32/KZSM30) のアンダープライオリティグリルは漆黒のグロスブラック幾何学ルーバーであり、
    # 白銀クロームを適用すると夜間や夕暮れの暗闇でバンパーに白い棒が白浮きして突き刺さるような違和感を生むため、全ルーバーをピアノブラックに統一する。
    for bar_i in range(-9, 10):
        bx = bar_i * 0.058
        top_x = bx * 0.88
        add_slanted_strut(
            bm,
            p0=Vector((bx, -2.284, 0.225)),
            p1=Vector((top_x, -2.274, 0.450)),
            width_x=0.011,
            depth_y=0.022,
            taper=0.92,
            mat_idx=1,
            smooth=False,
        )

    # ハンマーヘッド アッパーグリルガーニッシュ＆横一文字シームレスLEDデイタイムランニングランプ（DRL）
    # ノーズの平面傾斜（中央 Y=-2.262 → 左右端 Y=-2.185）に沿う8頂点ヘキサヘドロンで左右一体構造にする
    for side in [-1.0, 1.0]:
        in_x = 0.0
        out_x = side * 0.785
        if side > 0:
            drl_housing = [
                Vector((in_x, -2.268, 0.486)),
                Vector((out_x, -2.188, 0.498)),
                Vector((out_x, -2.155, 0.498)),
                Vector((in_x, -2.235, 0.486)),
                Vector((in_x, -2.262, 0.518)),
                Vector((out_x, -2.182, 0.530)),
                Vector((out_x, -2.155, 0.530)),
                Vector((in_x, -2.235, 0.518)),
            ]
            drl_led = [
                Vector((in_x, -2.275, 0.504)),
                Vector((out_x, -2.195, 0.516)),
                Vector((out_x, -2.180, 0.516)),
                Vector((in_x, -2.260, 0.504)),
                Vector((in_x, -2.273, 0.517)),
                Vector((out_x, -2.193, 0.529)),
                Vector((out_x, -2.180, 0.529)),
                Vector((in_x, -2.260, 0.517)),
            ]
            drl_chrome = [
                Vector((in_x, -2.272, 0.494)),
                Vector((out_x, -2.192, 0.506)),
                Vector((out_x, -2.180, 0.506)),
                Vector((in_x, -2.260, 0.494)),
                Vector((in_x, -2.272, 0.502)),
                Vector((out_x, -2.192, 0.514)),
                Vector((out_x, -2.180, 0.514)),
                Vector((in_x, -2.260, 0.502)),
            ]
        else:
            drl_housing = [
                Vector((out_x, -2.188, 0.498)),
                Vector((in_x, -2.268, 0.486)),
                Vector((in_x, -2.235, 0.486)),
                Vector((out_x, -2.155, 0.498)),
                Vector((out_x, -2.182, 0.530)),
                Vector((in_x, -2.262, 0.518)),
                Vector((in_x, -2.235, 0.518)),
                Vector((out_x, -2.155, 0.530)),
            ]
            drl_led = [
                Vector((out_x, -2.195, 0.516)),
                Vector((in_x, -2.275, 0.504)),
                Vector((in_x, -2.260, 0.504)),
                Vector((out_x, -2.180, 0.516)),
                Vector((out_x, -2.193, 0.529)),
                Vector((in_x, -2.273, 0.517)),
                Vector((in_x, -2.260, 0.517)),
                Vector((out_x, -2.180, 0.529)),
            ]
            drl_chrome = [
                Vector((out_x, -2.192, 0.506)),
                Vector((in_x, -2.272, 0.494)),
                Vector((in_x, -2.260, 0.494)),
                Vector((out_x, -2.180, 0.506)),
                Vector((out_x, -2.192, 0.514)),
                Vector((in_x, -2.272, 0.502)),
                Vector((in_x, -2.260, 0.502)),
                Vector((out_x, -2.180, 0.514)),
            ]
        add_hexahedron(bm, drl_housing, mat_idx=1, smooth=False)
        add_hexahedron(bm, drl_led, mat_idx=4, smooth=False)
        add_hexahedron(bm, drl_chrome, mat_idx=2, smooth=False)

    # ハンマーヘッドノーズ中央の伝統「王冠（Crown）エンブレム」
    add_crown_emblem(
        bm,
        center=Vector((0.0, -2.264, 0.548)),
        scale=1.15,
        axis_y_dir=-1.0,
        mat_chrome=2,
        mat_back=1,
    )

    # フロント日本規格ナンバープレート (330mm x 165mm)
    add_japanese_license_plate(
        bm,
        center=Vector((0.0, -2.288, 0.315)),
        is_rear=False,
        mat_trim=1,
        mat_white=6,
        mat_green=7,
        mat_chrome=2,
    )

    # 左右ハンマーヘッド4眼LEDヘッドランプユニット＆C字コーナーエアインテークベゼル
    for side in [-1.0, 1.0]:
        # ヘッドランプダークハウジング（フロントフェンダーノーズ傾斜に沿って外側から内側へスラントする8頂点ヘキサヘドロン）
        hl_in_x = side * 0.44
        hl_out_x = side * 0.78
        if side > 0:
            hl_verts = [
                Vector((hl_in_x, -2.266, 0.478)),
                Vector((hl_out_x, -2.185, 0.492)),
                Vector((hl_out_x, -2.095, 0.492)),
                Vector((hl_in_x, -2.180, 0.478)),
                Vector((hl_in_x, -2.256, 0.525)),
                Vector((hl_out_x, -2.175, 0.542)),
                Vector((hl_out_x, -2.095, 0.548)),
                Vector((hl_in_x, -2.180, 0.530)),
            ]
        else:
            hl_verts = [
                Vector((hl_out_x, -2.185, 0.492)),
                Vector((hl_in_x, -2.266, 0.478)),
                Vector((hl_in_x, -2.180, 0.478)),
                Vector((hl_out_x, -2.095, 0.492)),
                Vector((hl_out_x, -2.175, 0.542)),
                Vector((hl_in_x, -2.256, 0.525)),
                Vector((hl_in_x, -2.180, 0.530)),
                Vector((hl_out_x, -2.095, 0.548)),
            ]
        add_hexahedron(bm, hl_verts, mat_idx=1, smooth=False)
        # 片側4眼スクエアLEDプロジェクターレンズ（スラント面に密着）
        for lamp_idx in range(4):
            t_lamp = (lamp_idx + 0.5) / 4.0
            lx = side * (0.47 + lamp_idx * 0.072)
            ly = -2.258 + t_lamp * 0.068
            lz = 0.502 + t_lamp * 0.014
            add_box(
                bm,
                center=Vector((lx, ly, lz)),
                size=Vector((0.046, 0.022, 0.026)),
                mat_idx=4,
                smooth=False,
            )
            add_box(
                bm,
                center=Vector((lx, ly - 0.003, lz - 0.015)),
                size=Vector((0.050, 0.016, 0.005)),
                mat_idx=2,
                smooth=False,
            )
        # 左右バンパーコーナーのC字ピアノブラックインテークガーニッシュ（ロアボディ幅 wb=0.72..0.80 の内側に収める）
        add_box(
            bm,
            center=Vector((side * 0.68, -2.215, 0.34)),
            size=Vector((0.11, 0.075, 0.19)),
            mat_idx=1,
            smooth=False,
        )
        add_box(
            bm,
            center=Vector((side * 0.725, -2.235, 0.34)),
            size=Vector((0.018, 0.035, 0.175)),
            mat_idx=1,
            smooth=False,
        )

    # 6. クラウン セダン リアフェイス（横一文字LEDリヤコンビネーションランプ + トヨタエンブレム + C R O W N レタリング）
    # トランクデッキエンドの繊細な一体型リップ（クラウンらしいエレガントな造形）
    add_box(
        bm,
        center=Vector((0.0, 2.14, 0.892)),
        size=Vector((1.42, 0.07, 0.022)),
        mat_idx=0,
        smooth=True,
    )
    # 横一文字テールランプのピアノブラックハウジング（左右フェンダー端まで一直線に貫く）
    add_box(
        bm,
        center=Vector((0.0, 2.215, 0.765)),
        size=Vector((1.48, 0.034, 0.068)),
        mat_idx=1,
        smooth=False,
    )
    # 横一文字フルワイドLEDテールランプバー（クラウン セダンの象徴）
    add_box(
        bm,
        center=Vector((0.0, 2.230, 0.772)),
        size=Vector((1.44, 0.018, 0.022)),
        mat_idx=5,
        smooth=False,
    )
    # 左右端の立体L字シグネチャーLEDブロック
    for side in [-1.0, 1.0]:
        add_box(
            bm,
            center=Vector((side * 0.61, 2.228, 0.752)),
            size=Vector((0.22, 0.020, 0.042)),
            mat_idx=5,
            smooth=False,
        )
        add_box(
            bm,
            center=Vector((side * 0.71, 2.180, 0.758)),
            size=Vector((0.036, 0.105, 0.044)),
            mat_idx=5,
            smooth=False,
        )

    # リア中央クロームエンブレムバッジ ＆ 横一文字の下に等間隔で並ぶ「C R O W N」5文字レタリング
    add_cylinder(
        bm,
        center=Vector((0.0, 2.232, 0.818)),
        radius=0.024,
        height=0.010,
        segments=16,
        axis="Y",
        mat_idx=2,
        smooth=True,
    )
    for ch_idx in range(-2, 3):
        add_box(
            bm,
            center=Vector((ch_idx * 0.075, 2.228, 0.712)),
            size=Vector((0.022, 0.008, 0.016)),
            mat_idx=2,
            smooth=False,
        )
    # 右側「HEV / FCEV」エンブレムプレート
    add_box(
        bm,
        center=Vector((0.54, 2.226, 0.675)),
        size=Vector((0.085, 0.012, 0.020)),
        mat_idx=2,
        smooth=False,
    )

    # ハイマウントストップランプ（リアガラス上端）
    add_box(
        bm,
        center=Vector((0.0, 0.74, 1.365)),
        size=Vector((0.46, 0.04, 0.022)),
        mat_idx=5,
    )

    # リアナンバープレートガーニッシュ＆日本規格ナンバープレート（330mm x 165mm、白地＋緑文字レリーフ＋左上の封印）
    add_box(
        bm,
        center=Vector((0.0, 2.215, 0.545)),
        size=Vector((0.66, 0.035, 0.195)),
        mat_idx=1,
    )
    add_japanese_license_plate(
        bm,
        center=Vector((0.0, 2.232, 0.545)),
        is_rear=True,
        mat_trim=1,
        mat_white=6,
        mat_green=7,
        mat_chrome=2,
    )

    # クラウン セダン リアバンパー下部ロアブラックガーニッシュ＆水平クロームモール＆スリムリフレクター
    # （※フラッグシップセダンのためマフラーは床下隠蔽式とし、上品な水平メッキバーで仕上げる）
    add_box(
        bm,
        center=Vector((0.0, 2.185, 0.305)),
        size=Vector((1.38, 0.085, 0.095)),
        mat_idx=1,
        smooth=False,
    )
    add_box(
        bm,
        center=Vector((0.0, 2.228, 0.312)),
        size=Vector((1.32, 0.016, 0.014)),
        mat_idx=2,
        smooth=False,
    )
    for side in [-1.0, 1.0]:
        add_box(
            bm,
            center=Vector((side * 0.52, 2.226, 0.345)),
            size=Vector((0.22, 0.014, 0.014)),
            mat_idx=5,
            smooth=False,
        )

    # 7. Aピラー根元ガセット＆JDM流線型エアロドアミラー（運転席側へ22°ヨー角スイープ＋凹みインナーバイザー＋シーケンシャルLEDウインカー）
    for side in [-1.0, 1.0]:
        # Aピラー根元の流線型デルタガセット（角張った箱ではなくドアベルトラインに沿う低い楔形プレート）
        gusset_rear_y = -0.91 if side > 0 else -0.97
        gusset_top_rear_y = -0.93 if side > 0 else -1.00
        gusset_verts = [
            Vector((side * 0.755, -1.21, 0.850)),
            Vector((side * 0.835, -1.21, 0.850)),
            Vector((side * 0.855, gusset_rear_y, 0.850)),
            Vector((side * 0.745, gusset_rear_y, 0.850)),
            Vector((side * 0.745, -1.16, 0.892)),
            Vector((side * 0.805, -1.16, 0.888)),
            Vector((side * 0.825, gusset_top_rear_y, 0.882)),
            Vector((side * 0.735, gusset_top_rear_y, 0.892)),
        ]
        if side < 0:
            gusset_verts = [
                gusset_verts[1],
                gusset_verts[0],
                gusset_verts[3],
                gusset_verts[2],
                gusset_verts[5],
                gusset_verts[4],
                gusset_verts[7],
                gusset_verts[6],
            ]
        add_hexahedron(bm, gusset_verts, mat_idx=1, smooth=False)

        # ドアミラーハウジングのヨー角スイープ (22°) を事前計算し、ステー先端がハウジング底面中心へ 0.0mm ギャップで貫入するように配置
        # ドアミラーピボット: ドアマウントペデスタル（三角ガセット後方のドアショルダー上）
        # Why side > 0 (助手席・左ドアミラー) を Y=-0.880m に配置し、ヨー角を 27° に設定するか:
        # 日本仕様の右ハンドル車 (RHD: 運転席アイポイント X=-0.380m, Y=+0.060m, Z=1.130m) では、
        # 左Aピラー (p0=(+0.742, -1.260, 0.860) -> p1=(+0.658, -0.480, 1.400)) および車内側アルカンターラ内張り
        # (X=+0.715m, Y=-1.220m .. X=+0.628m, Y=-0.480m) の高さ Z=0.962m 断面が Y=-1.15m .. -1.03m を通過する。
        # 左右対称の Y=-1.005m に左ドアミラーを置くと、右運転席から約 1.6m 離れた斜め視線 (yaw=+47°) の内側半分が
        # 左Aピラーおよび内張りの後縁と干渉してケラレが生じる。
        # 実車のRHDセダン設計および UN R46 視界基準に準拠し、左ドアミラーピボットを Aピラー後方のドアベルトライン上 (Y=-0.880m) に配置し、
        # 鏡面ヨー角を 27.0° に内振りすることで、左Aピラーの死角から 100% クリアに左ドアミラー全面を視認できるようにする。
        is_left_mirror = side > 0
        mirror_y = -0.880 if is_left_mirror else -1.005
        gusset_y = -0.952 if is_left_mirror else -1.078
        yaw_deg = 27.0 if is_left_mirror else 22.0
        yaw_angle = side * math.radians(yaw_deg)
        cos_y = math.cos(yaw_angle)
        sin_y = math.sin(yaw_angle)
        pivot = Vector((side * 0.918, mirror_y, 0.962))

        def transform_mirror_pt(
            local_x: float,
            local_y: float,
            local_z: float,
            _cos_y: float = cos_y,
            _sin_y: float = sin_y,
            _pivot: Vector = pivot,
        ) -> Vector:
            rx = local_x * _cos_y - local_y * _sin_y
            ry = local_x * _sin_y + local_y * _cos_y
            return _pivot + Vector((rx, ry, local_z))

        # ドアショルダーガセット上面 (Z=0.876..0.888) からスイープ済みミラー底面中心 (Z=0.913..0.930) へ隙間なく接続するエアロミラーステー＆スイベル台座
        add_slanted_strut(
            bm,
            p0=Vector((side * 0.788, gusset_y, 0.876)),
            p1=transform_mirror_pt(-side * 0.032, -0.026, -0.032),
            width_x=0.048,
            depth_y=0.056,
            taper=0.82,
            mat_idx=1,
            smooth=False,
        )
        add_cylinder(
            bm,
            center=transform_mirror_pt(-side * 0.032, -0.026, -0.038),
            radius=0.024,
            height=0.022,
            segments=16,
            axis="Z",
            mat_idx=1,
            smooth=True,
        )

        # local_x: 内側 (-side*0.086) 〜 外側 (+side*0.086)
        in_x = -side * 0.086
        out_x = side * 0.086

        def make_housing_ring(
            y_off: float,
            scale_x: float,
            scale_z: float,
            z_shift: float = 0.0,
            _in_x: float = in_x,
            _out_x: float = out_x,
            _side: float = side,
            _transform_fn=transform_mirror_pt,
        ):
            # 8頂点（下内 → 下外 → 外下 → 外上 → 上外 → 上内（エアロフィン） → 内上 → 内下）
            pts_local = [
                (_in_x * 0.78 * scale_x, y_off, -0.046 * scale_z + z_shift),
                (_out_x * 0.72 * scale_x, y_off, -0.042 * scale_z + z_shift),
                (_out_x * 0.98 * scale_x, y_off, -0.015 * scale_z + z_shift),
                (_out_x * 0.92 * scale_x, y_off, 0.030 * scale_z + z_shift),
                (_out_x * 0.62 * scale_x, y_off, 0.050 * scale_z + z_shift),
                (_in_x * 0.68 * scale_x, y_off, 0.054 * scale_z + z_shift),
                (_in_x * 0.98 * scale_x, y_off, 0.026 * scale_z + z_shift),
                (_in_x * 0.95 * scale_x, y_off, -0.020 * scale_z + z_shift),
            ]
            if _side < 0:
                pts_local.reverse()
            return [bm.verts.new(_transform_fn(px, py, pz)) for px, py, pz in pts_local]

        # 3段ロフト: 後端バイザー縁 (y=+0.018) → 中間最大断面 (y=-0.022) → 前端エアロキャップ (y=-0.066)
        ring_rear_outer = make_housing_ring(0.018, 1.00, 1.00, 0.0)
        ring_mid = make_housing_ring(-0.022, 1.03, 1.02, -0.002)
        ring_front = make_housing_ring(-0.066, 0.72, 0.68, -0.005)
        # バイザー内側の凹みリム (y=+0.004)
        ring_rear_inner = make_housing_ring(0.004, 0.88, 0.86, 0.0)

        n_m = len(ring_rear_outer)
        # 外周カウル（上半分は BodyPaint=0、下半分は BlackTrim=1）
        for s_pair in [(ring_rear_outer, ring_mid), (ring_mid, ring_front)]:
            r0, r1 = s_pair
            for i in range(n_m):
                ni = (i + 1) % n_m
                f = bm.faces.new([r0[i], r0[ni], r1[ni], r1[i]])
                avg_z = (r0[i].co.z + r0[ni].co.z + r1[ni].co.z + r1[i].co.z) * 0.25
                f.material_index = 0 if avg_z >= pivot.z - 0.006 else 1
                f.smooth = False

        # 前端キャップを閉じる（外向き法線: 車両前方 -Y）
        # Why not list(reversed(ring_front)):
        # ring_front 頂点順序はリング外周向きに定義されているため、reversed すると法線が内向き (+Y) に反転してしまう。
        f_cap = bm.faces.new(ring_front)
        f_cap.material_index = 0
        f_cap.smooth = False

        # 後端の黒いインナーバイザー縁（外周から凹みリムへ繋がるベゼル）
        for i in range(n_m):
            ni = (i + 1) % n_m
            f_rim = bm.faces.new(
                [
                    ring_rear_inner[i],
                    ring_rear_inner[ni],
                    ring_rear_outer[ni],
                    ring_rear_outer[i],
                ]
            )
            f_rim.material_index = 1
            f_rim.smooth = False

        # インナーバイザー奥の背面プレート（外向き法線: 車両後方 +Y）
        # Why not ring_rear_inner:
        # 凹み内側から後方を向く背面プレートは、外周ループと逆向きにすることで法線が車両後方 (+Y) を向く。
        f_back = bm.faces.new(list(reversed(ring_rear_inner)))
        f_back.material_index = 1
        f_back.smooth = False

        # ドアミラー前面〜外側面にはめ込まれたフラッシュマウントLEDウインカーレンズ（突起にならないようハウジング面に沿った8頂点ヘキサヘドロンで造形）
        led_verts = [
            transform_mirror_pt(out_x * 0.15, -0.067, -0.006),
            transform_mirror_pt(out_x * 0.69, -0.066, -0.005),
            transform_mirror_pt(out_x * 0.99, -0.023, -0.003),
            transform_mirror_pt(out_x * 0.15, -0.056, -0.006),
            transform_mirror_pt(out_x * 0.15, -0.067, 0.004),
            transform_mirror_pt(out_x * 0.69, -0.066, 0.005),
            transform_mirror_pt(out_x * 0.99, -0.023, 0.007),
            transform_mirror_pt(out_x * 0.15, -0.056, 0.004),
        ]
        if side < 0:
            led_verts = [
                led_verts[1],
                led_verts[0],
                led_verts[3],
                led_verts[2],
                led_verts[5],
                led_verts[4],
                led_verts[7],
                led_verts[6],
            ]
        add_hexahedron(bm, led_verts, mat_idx=4, smooth=False)

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("Chassis", mesh)
    for k in mat_keys:
        obj.data.materials.append(materials[k])

    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_interior(materials) -> bpy.types.Object:
    """日本の右ハンドル（RHD: X = -0.38m）専用 トヨタ クラウン セダン (AZSH32)「アイランドアーキテクチャー」内装 (Interior) をモデリング
    ドライバー視点カメラ (X=-0.38m, Y_blender=-0.06m, Z_blender=1.13m) から見て:
    - 運転席から助手席、左右ドアトリム、センターコンソール天板まで連続する大型杢目調「ウッディブラウン」パネル (`CrownWoodTrim`: 3D木目ノード)
    - インパネ水平ライン・センターコンソール両脇・足元を彩る64色マルチカラーアンビエントイルミネーション (`AmbientStripLED`)
    - 12.3インチ大型ワイド連装ディスプレイハウジング（メータークラスター＋センターナビ一体型パノラマベゼル）
    - ステアリングコラムの右側に JIS 規格のウインカーレバー、左側にワイパーレバー
    - センターコンソール（ストレート型エレクトロシフトマチックノブ、右ハンドル用エンジンスターターボタン、縦型2連カップホルダー）
    - セミアニリン本革シボ＆パンチングレザーのコンフォートラグジュアリーシート＆ドアアームレスト (`InteriorSeat` / `InteriorDark`: 3D本革シボノード)
    """
    mesh = bpy.data.meshes.new("InteriorMesh")
    bm = bmesh.new()

    # 0: InteriorDark, 1: InteriorSeat, 2: MeterBack, 3: DashboardScreen, 4: GaugeNeedleRed, 5: Chrome,
    # 6: CrownWoodTrim, 7: AmbientStripLED, 8: AlcantaraTrim, 9: SaddleStitch, 10: SilverTrim
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

    # 0. キャビンフロア＆左右インナードアトリム・杢目調ドアパネル・アンビエント照明・ドアアームレスト・Aピラー内張り
    add_box(bm, center=Vector((0.0, 0.25, 0.36)), size=Vector((1.58, 2.30, 0.08)), mat_idx=0)
    for side in [-1.0, 1.0]:
        # Aピラー車内側アルカンターラ調（ウルトラスエード）内張り＆JBLツィーターグリル（外装Aピラー内面に一致させサイド窓視界を確保）
        add_slanted_strut(
            bm,
            p0=Vector((side * 0.715, -1.22, 0.87)),
            p1=Vector((side * 0.628, -0.48, 1.38)),
            width_x=0.044,
            depth_y=0.062,
            taper=0.84,
            mat_idx=8,
            smooth=True,
        )
        add_cylinder(
            bm,
            center=Vector((side * 0.692, -1.08, 0.95)),
            radius=0.022,
            height=0.012,
            segments=16,
            axis="X",
            mat_idx=10,
            smooth=True,
        )
        # ドア内張りロア〜アッパーパネル（ダッシュボード端 Y=-0.95 からリアまで隙間なく連続）
        add_box(
            bm,
            center=Vector((side * 0.79, 0.05, 0.62)),
            size=Vector((0.11, 2.30, 0.46)),
            mat_idx=0,
            smooth=False,
        )
        # ドアショルダーパッド（ベルトライン Z=0.855：外装と段差なく接続）＋サドルタン本革ステッチ
        add_box(
            bm,
            center=Vector((side * 0.78, -0.25, 0.855)),
            size=Vector((0.09, 1.75, 0.045)),
            mat_idx=1,
            smooth=False,
        )
        add_box(
            bm,
            center=Vector((side * 0.734, -0.25, 0.868)),
            size=Vector((0.005, 1.68, 0.004)),
            mat_idx=9,
            smooth=False,
        )
        # クラウン アイランドアーキテクチャー：ドアトリム上部を走る大型杢目調（ウッディブラウン）加飾パネル＋サテンシルバーモール＋アンビエントLED
        add_box(
            bm,
            center=Vector((side * 0.742, -0.24, 0.802)),
            size=Vector((0.036, 1.42, 0.052)),
            mat_idx=6,
            smooth=False,
        )
        add_box(
            bm,
            center=Vector((side * 0.732, -0.24, 0.774)),
            size=Vector((0.022, 1.40, 0.006)),
            mat_idx=10,
            smooth=False,
        )
        add_box(
            bm,
            center=Vector((side * 0.730, -0.24, 0.768)),
            size=Vector((0.018, 1.36, 0.005)),
            mat_idx=7,
            smooth=False,
        )
        # ドアアームレスト＆サドルタンステッチ＆シルバースイッチベゼル＆インサイドドアハンドル
        add_box(
            bm,
            center=Vector((side * 0.73, -0.22, 0.71)),
            size=Vector((0.075, 0.58, 0.045)),
            mat_idx=1,
            smooth=False,
        )
        add_box(
            bm,
            center=Vector((side * 0.692, -0.22, 0.732)),
            size=Vector((0.004, 0.54, 0.004)),
            mat_idx=9,
            smooth=False,
        )
        add_box(
            bm,
            center=Vector((side * 0.73, -0.38, 0.735)),
            size=Vector((0.045, 0.14, 0.012)),
            mat_idx=10,
            smooth=False,
        )
        add_box(
            bm,
            center=Vector((side * 0.728, -0.44, 0.795)),
            size=Vector((0.018, 0.095, 0.020)),
            mat_idx=10,
            smooth=False,
        )

    # 1. 立体ダッシュボード本体 & カウルディープシェルフ（フロントガラス下端 Y=-1.26 まで隙間なく埋める）
    add_box(
        bm,
        center=Vector((0.0, -0.96, 0.845)),
        size=Vector((1.54, 0.62, 0.06)),
        mat_idx=0,
        smooth=False,
    )
    add_box(
        bm,
        center=Vector((0.0, -0.76, 0.74)),
        size=Vector((1.54, 0.44, 0.24)),
        mat_idx=0,
        smooth=False,
    )
    # ダッシュボード天面手前のサドルタン（カッパーブラウン）本革ダブルステッチライン
    add_box(
        bm,
        center=Vector((0.0, -0.665, 0.876)),
        size=Vector((1.48, 0.005, 0.004)),
        mat_idx=9,
        smooth=False,
    )
    add_box(
        bm,
        center=Vector((0.0, -0.674, 0.876)),
        size=Vector((1.48, 0.004, 0.003)),
        mat_idx=9,
        smooth=False,
    )
    # 右ハンドル運転席前方のカラーヘッドアップディスプレイ（HUD）投影開口リセス＆サテンベゼル
    add_box(
        bm,
        center=Vector((-0.38, -0.85, 0.874)),
        size=Vector((0.23, 0.13, 0.008)),
        mat_idx=10,
        smooth=False,
    )
    add_box(
        bm,
        center=Vector((-0.38, -0.85, 0.877)),
        size=Vector((0.20, 0.10, 0.006)),
        mat_idx=2,
        smooth=False,
    )
    # ダッシュボード中央奥の JBL プレミアムサウンド センタースピーカーグリル
    add_box(
        bm,
        center=Vector((0.0, -0.88, 0.876)),
        size=Vector((0.26, 0.12, 0.006)),
        mat_idx=10,
        smooth=False,
    )

    # クラウン セダン象徴の「アイランドアーキテクチャー」水平大型杢目調（ウッディブラウン）インパネオーナメントパネル
    # 助手席端 (X=+0.72) からセンター〜運転席端 (X=-0.72) まで水平に貫く立体木目パネル
    add_box(
        bm,
        center=Vector((0.18, -0.615, 0.838)),
        size=Vector((1.08, 0.075, 0.068)),
        mat_idx=6,
        smooth=False,
    )
    add_box(
        bm,
        center=Vector((-0.60, -0.615, 0.842)),
        size=Vector((0.24, 0.070, 0.062)),
        mat_idx=6,
        smooth=False,
    )
    # 杢目パネル上下のサテンシルバーヘアライン加飾モール
    add_box(
        bm,
        center=Vector((0.0, -0.576, 0.873)),
        size=Vector((1.44, 0.014, 0.007)),
        mat_idx=10,
        smooth=False,
    )
    add_box(
        bm,
        center=Vector((0.0, -0.576, 0.804)),
        size=Vector((1.44, 0.014, 0.007)),
        mat_idx=10,
        smooth=False,
    )
    # インパネ水平アンビエントイルミネーションLEDライン（杢目パネル直下を温かく照らす一文字間接照明）
    add_box(
        bm,
        center=Vector((0.0, -0.578, 0.797)),
        size=Vector((1.42, 0.010, 0.006)),
        mat_idx=7,
        smooth=False,
    )

    # 助手席側エアコンルーバー＆右ハンドル運転席右端（X = -0.63m）のエアコン吹き出し口＆クロームノブ
    add_box(
        bm,
        center=Vector((0.46, -0.574, 0.838)),
        size=Vector((0.36, 0.012, 0.022)),
        mat_idx=0,
        smooth=False,
    )
    add_box(
        bm,
        center=Vector((0.46, -0.570, 0.838)),
        size=Vector((0.34, 0.008, 0.005)),
        mat_idx=10,
        smooth=False,
    )
    add_box(
        bm,
        center=Vector((-0.63, -0.578, 0.855)),
        size=Vector((0.11, 0.036, 0.044)),
        mat_idx=0,
        smooth=False,
    )
    add_box(
        bm,
        center=Vector((-0.63, -0.562, 0.855)),
        size=Vector((0.09, 0.008, 0.008)),
        mat_idx=10,
        smooth=False,
    )

    # 2. クラウン 12.3インチ連装パノラミック・ディスプレイゾーン（右ハンドル運転席メーターフード＋一体型ナビマウント架台）
    # Why Three.js の instrumentClusterGroup / centerNavGroup / steeringColumn / electroShifterGroup と重複させないか:
    # Three.js 側でリアルタイム CanvasTexture と可動3Dメッシュ（指針・ウインカー/ワイパーレバー・電子シフトノブ・11インチチルトナビ）を
    # this.group に直接追加しているため、GLB 側に同位置の静的メーターリング・静的レバー・固定シフトノブ・ナビ領域を横切る平板壁を
    # 残すと、3D空間で二重メッシュが交差・貫通して「車内に何か埋まっている」状態になるため。
    # また、GLB の SteeringLeather マテリアル等に発光する静的な針を一切含めず、メーター指針は Three.js の可動 3D 指針
    # (SpeedometerNeedlePivot / TachometerNeedlePivot) のみとする。
    # メーターフード天板＆左右サイドバイザー（ステアリング上部開口から綺麗に見える高さ Z=1.018m）
    add_box(
        bm,
        center=Vector((-0.38, -0.64, 1.018)),
        size=Vector((0.38, 0.18, 0.024)),
        mat_idx=0,
        smooth=False,
    )
    # メーターフード内側の反射防止アルカンターラ調（ウルトラスエード）内張り＆前縁サドルタンステッチ
    add_box(
        bm,
        center=Vector((-0.38, -0.635, 1.005)),
        size=Vector((0.36, 0.16, 0.005)),
        mat_idx=8,
        smooth=False,
    )
    add_box(
        bm,
        center=Vector((-0.38, -0.551, 1.029)),
        size=Vector((0.37, 0.005, 0.004)),
        mat_idx=9,
        smooth=False,
    )
    # メーターフード右側サイドバイザー壁 (X=-0.56m)
    add_box(
        bm,
        center=Vector((-0.56, -0.64, 0.946)),
        size=Vector((0.024, 0.16, 0.135)),
        mat_idx=0,
        smooth=False,
    )
    # 運転席メータークラスター背面ハウジング壁（Three.js の instrumentClusterGroup z=0.625, y=0.952 の後方 Y_b=-0.658 に配置）
    add_box(
        bm,
        center=Vector((-0.38, -0.658, 0.948)),
        size=Vector((0.36, 0.020, 0.126)),
        mat_idx=0,
        smooth=False,
    )
    add_box(
        bm,
        center=Vector((-0.38, -0.646, 1.010)),
        size=Vector((0.36, 0.012, 0.006)),
        mat_idx=10,
        smooth=False,
    )
    # センターナビ背面ダッシュボードマウント架台（Three.js の centerNavGroup (x=-0.132, y=0.955, z=0.585) の背面を隙間なく支える台座）
    add_box(
        bm,
        center=Vector((-0.132, -0.625, 0.910)),
        size=Vector((0.14, 0.052, 0.088)),
        mat_idx=0,
        smooth=False,
    )

    # 3. ステアリングコラム奥側マウントベース＆レザーコラムブーツ（20°傾斜シャフト軸 Z = 0.888 - (|Y| - 0.440) * tan(20°) に 1mm 単位で同軸配置）
    add_box(
        bm,
        center=Vector((-0.38, -0.585, 0.835)),
        size=Vector((0.092, 0.085, 0.068)),
        mat_idx=0,
        smooth=False,
    )
    add_box(
        bm,
        center=Vector((-0.38, -0.625, 0.823)),
        size=Vector((0.112, 0.048, 0.078)),
        mat_idx=0,
        smooth=False,
    )
    # 運転席・助手席インパネロア・ニーボルスター（膝当てソフトパッド）＆ステアリング下部アンダーカバー
    # ステアリングホイール下縁 (Y=-0.44, Z=0.718m) より奥 (Y=-0.64m)・下 (Z=0.56..0.78m) に引き込み、ハンドル360度全周と干渉しない設計
    add_box(
        bm,
        center=Vector((-0.44, -0.66, 0.67)),
        size=Vector((0.52, 0.14, 0.22)),
        mat_idx=1,
        smooth=False,
    )
    add_box(
        bm,
        center=Vector((0.44, -0.66, 0.67)),
        size=Vector((0.52, 0.14, 0.22)),
        mat_idx=1,
        smooth=False,
    )
    # 助手席グローブボックスのリッドライン＆サテンシルバーハンドル
    add_box(
        bm,
        center=Vector((0.44, -0.588, 0.72)),
        size=Vector((0.44, 0.008, 0.006)),
        mat_idx=10,
        smooth=False,
    )
    # 右ハンドル運転席フットウェル：クラウン専用フロアマット＆アルミスポーツペダル（オルガン式アクセル・ワイドブレーキ・フットレスト）
    add_box(
        bm,
        center=Vector((-0.40, -0.36, 0.404)),
        size=Vector((0.46, 0.56, 0.010)),
        mat_idx=8,
        smooth=False,
    )
    add_box(
        bm,
        center=Vector((-0.40, -0.50, 0.410)),
        size=Vector((0.18, 0.12, 0.004)),
        mat_idx=10,
        smooth=False,
    )
    # オルガン式アクセルペダル (右側 X = -0.25m)
    add_slanted_strut(
        bm,
        p0=Vector((-0.25, -0.73, 0.41)),
        p1=Vector((-0.25, -0.81, 0.55)),
        width_x=0.046,
        depth_y=0.014,
        taper=0.92,
        mat_idx=10,
        smooth=False,
    )
    # ワイドブレーキペダル＆ペダルアーム (中央 X = -0.38m)
    add_slanted_strut(
        bm,
        p0=Vector((-0.38, -0.78, 0.62)),
        p1=Vector((-0.38, -0.73, 0.49)),
        width_x=0.018,
        depth_y=0.018,
        taper=1.0,
        mat_idx=0,
        smooth=False,
    )
    add_box(
        bm,
        center=Vector((-0.38, -0.72, 0.485)),
        size=Vector((0.092, 0.018, 0.056)),
        mat_idx=10,
        smooth=False,
    )
    # 左足アルミフットレスト / デッドペダル (左側 X = -0.53m)
    add_slanted_strut(
        bm,
        p0=Vector((-0.53, -0.72, 0.41)),
        p1=Vector((-0.53, -0.82, 0.54)),
        width_x=0.068,
        depth_y=0.014,
        taper=0.95,
        mat_idx=10,
        smooth=False,
    )

    # 4. センターダッシュロア・オートエアコン操作パネル（Three.js 側 centerNavGroup 下部ルーバー Z=0.923 のすぐ下に連なるピアノブラック操作部）
    add_box(
        bm,
        center=Vector((-0.11, -0.578, 0.838)),
        size=Vector((0.24, 0.028, 0.038)),
        mat_idx=0,
        smooth=False,
    )
    add_box(
        bm,
        center=Vector((-0.11, -0.563, 0.838)),
        size=Vector((0.20, 0.006, 0.008)),
        mat_idx=5,
        smooth=False,
    )

    # 5. クラウン セダン ハイデッキ・センターコンソール（大型杢目調天板＋アンビエント照明＋エレクトロシフトマチック）
    # センターコンソールロアボディ（セミアニリン本革サイドパッド）
    add_box(
        bm,
        center=Vector((0.0, -0.05, 0.53)),
        size=Vector((0.30, 1.18, 0.30)),
        mat_idx=1,
        smooth=False,
    )
    # センターコンソール天板の大型杢目調（ウッディブラウン）パネル (`CrownWoodTrim`)
    add_box(
        bm,
        center=Vector((0.0, -0.24, 0.688)),
        size=Vector((0.26, 0.62, 0.024)),
        mat_idx=6,
        smooth=False,
    )
    # コンソール左右エッジのサテンシルバーモール＆サドルタン本革ステッチ＆アンビエント照明ライン
    for side in [-1.0, 1.0]:
        add_box(
            bm,
            center=Vector((side * 0.132, -0.24, 0.692)),
            size=Vector((0.008, 0.60, 0.012)),
            mat_idx=10,
            smooth=False,
        )
        add_box(
            bm,
            center=Vector((side * 0.145, -0.05, 0.682)),
            size=Vector((0.004, 1.12, 0.004)),
            mat_idx=9,
            smooth=False,
        )
        add_box(
            bm,
            center=Vector((side * 0.138, -0.24, 0.678)),
            size=Vector((0.006, 0.58, 0.006)),
            mat_idx=7,
            smooth=False,
        )
    # センターコンソール後方の大型本革アームレストボックス＆サドルタンステッチ
    add_box(
        bm,
        center=Vector((0.0, 0.28, 0.725)),
        size=Vector((0.27, 0.44, 0.085)),
        mat_idx=1,
        smooth=True,
    )
    for side in [-1.0, 1.0]:
        add_box(
            bm,
            center=Vector((side * 0.122, 0.28, 0.768)),
            size=Vector((0.004, 0.41, 0.004)),
            mat_idx=9,
            smooth=False,
        )

    # クラウン純正ストレート型エレクトロシフトマチック台座（可動シフトノブ本体は Three.js 側 createElectroShifterAssembly で精密描画）
    add_box(
        bm,
        center=Vector((-0.055, -0.28, 0.704)),
        size=Vector((0.072, 0.110, 0.012)),
        mat_idx=0,
        smooth=False,
    )

    # 助手席寄り縦型2連カップホルダーリング (X = +0.055m)
    for cup_y in [-0.22, -0.34]:
        add_hollow_ring_y(
            bm,
            center=Vector((0.055, cup_y, 0.702)),
            r_outer=0.036,
            r_inner=0.030,
            depth_y=0.012,
            segments=16,
            mat_idx=5,
            smooth=True,
        )

    # 右ハンドル運転席側の POWER / ENGINE START STOP ボタン (X = -0.18m, インパネロア)
    add_cylinder(
        bm,
        center=Vector((-0.205, -0.575, 0.838)),
        radius=0.014,
        height=0.010,
        segments=16,
        axis="Y",
        mat_idx=5,
        smooth=False,
    )
    add_cylinder(
        bm,
        center=Vector((-0.205, -0.570, 0.838)),
        radius=0.010,
        height=0.008,
        segments=16,
        axis="Y",
        mat_idx=4,
        smooth=False,
    )

    # 6. クラウン セミアニリン本革エグゼクティブシート（右ハンドル運転席: X=-0.38, 助手席: X=+0.38）
    for seat_x in [-0.38, 0.38]:
        add_box(
            bm,
            center=Vector((seat_x, 0.18, 0.44)),
            size=Vector((0.50, 0.52, 0.16)),
            mat_idx=1,
            smooth=True,
        )
        add_box(
            bm,
            center=Vector((seat_x, 0.42, 0.76)),
            size=Vector((0.48, 0.13, 0.52)),
            mat_idx=1,
            smooth=True,
        )
        add_box(
            bm,
            center=Vector((seat_x - 0.22, 0.38, 0.74)),
            size=Vector((0.065, 0.16, 0.46)),
            mat_idx=1,
            smooth=True,
        )
        add_box(
            bm,
            center=Vector((seat_x + 0.22, 0.38, 0.74)),
            size=Vector((0.065, 0.16, 0.46)),
            mat_idx=1,
            smooth=True,
        )
        # シートショルダーの杢目調＆シルバー加飾（クラウン セダンの特徴）
        add_box(
            bm,
            center=Vector((seat_x, 0.41, 0.98)),
            size=Vector((0.32, 0.135, 0.028)),
            mat_idx=6,
            smooth=False,
        )
        add_box(
            bm,
            center=Vector((seat_x, 0.45, 1.09)),
            size=Vector((0.24, 0.10, 0.17)),
            mat_idx=1,
            smooth=True,
        )

    # 7. リアVIPエグゼクティブシート＆センターアームレスト＆リアパーセルシェルフ
    add_box(
        bm,
        center=Vector((0.0, 1.05, 0.46)),
        size=Vector((1.38, 0.50, 0.20)),
        mat_idx=1,
        smooth=True,
    )
    add_box(
        bm,
        center=Vector((0.0, 1.28, 0.74)),
        size=Vector((1.36, 0.14, 0.46)),
        mat_idx=1,
        smooth=True,
    )
    add_box(
        bm,
        center=Vector((0.0, 1.08, 0.62)),
        size=Vector((0.26, 0.42, 0.12)),
        mat_idx=6,
        smooth=False,
    )
    add_box(bm, center=Vector((0.0, 1.52, 0.86)), size=Vector((1.34, 0.42, 0.06)), mat_idx=0)

    # 8. フロントルーフヘッダー・アルカンターラ調（ウルトラスエード）天井ヘッドライナー・オーバーヘッドコンソール＆左右サンバイザー
    # フロントガラス上端 (v=1.0: Y=-0.480..-0.532m, Z=1.420m) と外装ルーフ前端 (Y=-0.532..-0.500m, Z=1.394..1.430m) および
    # 左右Aピラー内張り上端 (X=±0.628m, Y=-0.480m, Z=1.380m) を 0.0mm ギャップで完全に結合し、ルームミラー上方の空隙を根絶する
    header_front_arch = [
        Vector((-0.650, -0.495, 1.376)),
        Vector((-0.280, -0.545, 1.382)),
        Vector((0.280, -0.545, 1.382)),
        Vector((0.650, -0.495, 1.376)),
        Vector((-0.660, -0.480, 1.404)),
        Vector((-0.280, -0.532, 1.422)),
        Vector((0.280, -0.532, 1.422)),
        Vector((0.660, -0.480, 1.404)),
    ]
    add_hexahedron(bm, header_front_arch, mat_idx=8, smooth=True)

    header_rear_arch = [
        Vector((-0.650, -0.320, 1.382)),
        Vector((-0.280, -0.320, 1.392)),
        Vector((0.280, -0.320, 1.392)),
        Vector((0.650, -0.320, 1.382)),
        Vector((-0.650, -0.495, 1.376)),
        Vector((-0.280, -0.545, 1.382)),
        Vector((0.280, -0.545, 1.382)),
        Vector((0.650, -0.495, 1.376)),
    ]
    add_hexahedron(bm, header_rear_arch, mat_idx=8, smooth=True)

    # センターオーバーヘッドコンソール（SOSヘルプネット・ルームランプベゼル・サテンシルバーベゼル）
    # ルーフヘッダー内面 (Z=1.378..1.416m) にフラットに埋め込み、ドライバーの前方視界上端に垂れ下がらない実車準拠のロープロファイル形状にする
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
    add_box(
        bm,
        center=Vector((0.0, -0.495, 1.378)),
        size=Vector((0.180, 0.110, 0.004)),
        mat_idx=0,
        smooth=False,
    )
    # 左右の超小型ピンスポットLED読書灯レンズ（走行中に視界を邪魔しないダークベゼル収まり）
    for lamp_sx in (-0.045, 0.045):
        add_box(
            bm,
            center=Vector((lamp_sx, -0.495, 1.3755)),
            size=Vector((0.018, 0.012, 0.002)),
            mat_idx=10,
            smooth=False,
        )

    # 左右サンバイザー（アルカンターラ調ファブリック＆バニティミラーカバー：ルーフヘッダー下面に密着収納）
    for visor_side, visor_cx in [(-1.0, -0.395), (1.0, 0.395)]:
        add_box(
            bm,
            center=Vector((visor_cx, -0.465, 1.374)),
            size=Vector((0.350, 0.135, 0.016)),
            mat_idx=8,
            smooth=True,
        )
        add_cylinder(
            bm,
            center=Vector((visor_cx + visor_side * 0.155, -0.515, 1.380)),
            radius=0.009,
            height=0.022,
            segments=12,
            axis="Z",
            mat_idx=10,
            smooth=True,
        )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("Interior", mesh)
    for k in mat_keys:
        obj.data.materials.append(materials[k])

    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_steering_wheel(materials) -> bpy.types.Object:
    """実寸 360mm (外径 0.36m) トヨタ クラウン 3本スポーク本革ステアリングホイール (SteeringWheel) を右ハンドル運転席 (X=-0.38m) にモデリング
    中央ホーンパッドには伝統の立体『王冠（Crown）エンブレム』を配置。
    """
    mesh = bpy.data.meshes.new("SteeringWheelMesh")
    bm = bmesh.new()

    # 0: SteeringLeather, 1: Chrome, 2: BlackTrim, 3: CrownWoodTrim
    mat_keys = ["SteeringLeather", "Chrome", "BlackTrim", "CrownWoodTrim"]

    center_r = 0.164
    tube_r = 0.0165
    segs = 36
    tube_segs = 12

    ring_loops = []
    for i in range(segs):
        theta = (2.0 * math.pi * i) / segs
        cx = math.cos(theta) * center_r
        cz = math.sin(theta) * center_r

        radial = Vector((math.cos(theta), 0.0, math.sin(theta))).normalized()
        loop_verts = []
        for j in range(tube_segs):
            phi = (2.0 * math.pi * j) / tube_segs
            offset = radial * (math.cos(phi) * tube_r) + Vector((0.0, math.sin(phi) * tube_r, 0.0))
            loop_verts.append(bm.verts.new(Vector((cx, 0.0, cz)) + offset))
        ring_loops.append(loop_verts)

    for i in range(segs):
        ni = (i + 1) % segs
        for j in range(tube_segs):
            nj = (j + 1) % tube_segs
            f = bm.faces.new(
                [
                    ring_loops[i][j],
                    ring_loops[i][nj],
                    ring_loops[ni][nj],
                    ring_loops[ni][j],
                ]
            )
            # 上部・下部はウッディブラウン本杢目コンビステアリング仕様 (mat_idx=3)、左右グリップは本革 (mat_idx=0)
            theta_deg = (360.0 * i) / segs
            is_wood_arc = (45.0 <= theta_deg <= 135.0) or (235.0 <= theta_deg <= 305.0)
            f.material_index = 3 if is_wood_arc else 0
            f.smooth = True

    # ステアリング中央ホーンパッド（本革）＆サテンシルバーリング
    add_cylinder(
        bm,
        center=Vector((0.0, 0.0, 0.0)),
        radius=0.060,
        height=0.034,
        segments=24,
        axis="Y",
        mat_idx=0,
        smooth=True,
    )
    add_hollow_ring_y(
        bm,
        center=Vector((0.0, 0.017, 0.0)),
        r_outer=0.032,
        r_inner=0.028,
        depth_y=0.004,
        segments=20,
        mat_idx=1,
        smooth=True,
    )

    # ホーンパッド中央の立体「王冠（Crown）エンブレム」（ドライバー側 +Y 向き）
    add_crown_emblem(
        bm,
        center=Vector((0.0, 0.016, 0.0)),
        scale=0.68,
        axis_y_dir=1.0,
        mat_chrome=1,
        mat_back=-1,
    )

    # 3本スポーク（左右マルチファンクションスイッチ＋サテンシルバー加飾＋下部スポーク）
    add_box(
        bm,
        center=Vector((-0.098, 0.0, -0.008)),
        size=Vector((0.095, 0.018, 0.034)),
        mat_idx=0,
        smooth=False,
    )
    add_box(
        bm,
        center=Vector((0.098, 0.0, -0.008)),
        size=Vector((0.095, 0.018, 0.034)),
        mat_idx=0,
        smooth=False,
    )
    add_box(
        bm,
        center=Vector((-0.095, 0.010, -0.008)),
        size=Vector((0.068, 0.006, 0.024)),
        mat_idx=2,
        smooth=False,
    )
    add_box(
        bm,
        center=Vector((0.095, 0.010, -0.008)),
        size=Vector((0.068, 0.006, 0.024)),
        mat_idx=2,
        smooth=False,
    )
    add_box(
        bm,
        center=Vector((-0.098, 0.009, -0.022)),
        size=Vector((0.088, 0.005, 0.006)),
        mat_idx=1,
        smooth=False,
    )
    add_box(
        bm,
        center=Vector((0.098, 0.009, -0.022)),
        size=Vector((0.088, 0.005, 0.006)),
        mat_idx=1,
        smooth=False,
    )
    add_box(
        bm,
        center=Vector((0.0, 0.0, -0.092)),
        size=Vector((0.042, 0.018, 0.095)),
        mat_idx=1,
        smooth=False,
    )
    add_box(
        bm,
        center=Vector((0.0, 0.008, -0.092)),
        size=Vector((0.022, 0.006, 0.082)),
        mat_idx=2,
        smooth=False,
    )
    # パドルシフト
    add_box(
        bm,
        center=Vector((-0.115, -0.028, 0.025)),
        size=Vector((0.018, 0.008, 0.070)),
        mat_idx=1,
        smooth=False,
    )
    add_box(
        bm,
        center=Vector((0.115, -0.028, 0.025)),
        size=Vector((0.018, 0.008, 0.070)),
        mat_idx=1,
        smooth=False,
    )

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
    """3次元曲面フロントガラス (Windshield) を16x12高分割グリッドでモデリングしUV展開を行う"""
    mesh = bpy.data.meshes.new("WindshieldMesh")
    bm = bmesh.new()

    u_segs = 16
    v_segs = 12
    grid_verts = []

    for vi in range(v_segs + 1):
        v_ratio = vi / v_segs
        y = -1.28 * (1.0 - v_ratio) + (-0.48) * v_ratio
        z = 0.88 * (1.0 - v_ratio) + 1.42 * v_ratio
        width = 1.48 * (1.0 - v_ratio) + 1.34 * v_ratio

        row = []
        for ui in range(u_segs + 1):
            u_ratio = ui / u_segs
            x = (width * 0.5) * (1.0 - 2.0 * u_ratio)
            curve_y = math.sin(u_ratio * math.pi) * 0.055
            curve_z = math.sin(v_ratio * math.pi) * 0.018
            row.append(bm.verts.new(Vector((x, y - curve_y, z + curve_z))))
        grid_verts.append(row)

    for vi in range(v_segs):
        for ui in range(u_segs):
            v0 = grid_verts[vi][ui]
            v1 = grid_verts[vi][ui + 1]
            v2 = grid_verts[vi + 1][ui + 1]
            v3 = grid_verts[vi + 1][ui]
            face = bm.faces.new([v0, v1, v2, v3])
            face.material_index = 0
            face.smooth = True

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
            loop = mesh.loops[loop_idx]
            vert = mesh.vertices[loop.vertex_index]
            u = (vert.co.x - min_x) / range_x
            # Why 1.0 - (...) とするか:
            # glTF 2.0 エクスポータは UV の V 軸を (1.0 - v) で反転出力するため、
            # Three.js の GLTFLoader 読み込み時に下端カウルが v=0.0、上端ルーフが v=1.0 になるよう事前反転する
            v = 1.0 - (vert.co.z - min_z) / range_z
            uv_layer.data[loop_idx].uv = (u, v)

    obj = bpy.data.objects.new("Windshield", mesh)
    obj.data.materials.append(materials["WindshieldGlass"])
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_side_windows(materials) -> bpy.types.Object:
    """クラウン セダン (AZSH32) の左右6ライトサイドガラス（フロントドア窓・リアドア窓・リアクォーター窓）を3D曲面モデリングしUV展開を行う"""
    mesh = bpy.data.meshes.new("SideWindowsMesh")
    bm = bmesh.new()

    # 各ウィンドウパネル定義:
    # (u0_bot, u1_bot, u0_top, u1_top, top_arch_z, top_arch_x, u_segs, v_segs)
    panels = [
        # 1. フロントドアガラス（Aピラー〜Bピラー）
        (
            (0.742, -1.24, 0.862),
            (0.798, 0.155, 0.858),
            (0.658, -0.48, 1.400),
            (0.674, 0.195, 1.432),
            0.012,
            0.010,
            14,
            10,
        ),
        # 2. リアドアガラス（Bピラー〜6ライトディバイダーバー）
        (
            (0.798, 0.165, 0.858),
            (0.780, 0.915, 0.870),
            (0.674, 0.205, 1.432),
            (0.642, 0.715, 1.362),
            0.014,
            0.006,
            12,
            10,
        ),
        # 3. 6ライトリアクォーターガラス（ディバイダーバー〜ファストバックCピラー）
        (
            (0.780, 0.925, 0.870),
            (0.758, 1.665, 0.890),
            (0.642, 0.725, 1.362),
            (0.756, 1.655, 0.902),
            0.000,
            0.000,
            10,
            8,
        ),
    ]

    for side in [-1.0, 1.0]:
        for b0, b1, t0, t1, arch_z, arch_x, u_segs, v_segs in panels:
            grid = []
            for vi in range(v_segs + 1):
                v_ratio = vi / v_segs
                # 上下方向のタンブルホーム曲面（外側に緩やかに膨らむドアガラス断面）
                tumble_x = math.sin(v_ratio * math.pi) * 0.016
                row = []
                for ui in range(u_segs + 1):
                    u_ratio = ui / u_segs
                    arc = math.sin(u_ratio * math.pi)

                    bx = b0[0] * (1.0 - u_ratio) + b1[0] * u_ratio
                    by = b0[1] * (1.0 - u_ratio) + b1[1] * u_ratio
                    bz = b0[2] * (1.0 - u_ratio) + b1[2] * u_ratio

                    tx = t0[0] * (1.0 - u_ratio) + t1[0] * u_ratio + arc * arch_x
                    ty = t0[1] * (1.0 - u_ratio) + t1[1] * u_ratio
                    tz = t0[2] * (1.0 - u_ratio) + t1[2] * u_ratio + arc * arch_z

                    x = side * (bx * (1.0 - v_ratio) + tx * v_ratio + tumble_x)
                    y = by * (1.0 - v_ratio) + ty * v_ratio
                    z = bz * (1.0 - v_ratio) + tz * v_ratio
                    row.append(bm.verts.new(Vector((x, y, z))))
                grid.append(row)

            for vi in range(v_segs):
                for ui in range(u_segs):
                    v0 = grid[vi][ui]
                    v1 = grid[vi][ui + 1]
                    v2 = grid[vi + 1][ui + 1]
                    v3 = grid[vi + 1][ui]
                    # 外向き法線になるように頂点順序を左右で揃える
                    face_verts = [v0, v1, v2, v3] if side > 0 else [v0, v3, v2, v1]
                    face = bm.faces.new(face_verts)
                    face.material_index = 0
                    face.smooth = True

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
            loop = mesh.loops[loop_idx]
            vert = mesh.vertices[loop.vertex_index]
            # u: 車両前方(0.0) → 後方(1.0)、v: ベルトライン下端(0.0) → ルーフ上端(1.0) (glTF V反転補正込み)
            u = (vert.co.y - min_y) / range_y
            v = 1.0 - (vert.co.z - min_z) / range_z
            uv_layer.data[loop_idx].uv = (u, v)

    obj = bpy.data.objects.new("SideWindows", mesh)
    obj.data.materials.append(materials["WindowGlass"])
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_rear_window(materials) -> bpy.types.Object:
    """3次元曲面ファストバックリアガラス (RearWindow) を16x12高分割グリッドでモデリングしUV展開を行う"""
    mesh = bpy.data.meshes.new("RearWindowMesh")
    bm = bmesh.new()

    u_segs = 16
    v_segs = 12
    grid_verts = []

    for vi in range(v_segs + 1):
        # v_ratio=0.0 が下端（トランクデッキ側 y=1.74, z=0.89）、v_ratio=1.0 が上端（ルーフ後端 y=0.70, z=1.365）
        v_ratio = vi / v_segs
        y = 1.74 * (1.0 - v_ratio) + 0.70 * v_ratio
        z_side = 0.890 * (1.0 - v_ratio) + 1.362 * v_ratio
        z_arch = 0.012 * (1.0 - v_ratio) + 0.026 * v_ratio
        width = 1.46 * (1.0 - v_ratio) + 1.23 * v_ratio

        row = []
        for ui in range(u_segs + 1):
            u_ratio = ui / u_segs
            x = (width * 0.5) * (2.0 * u_ratio - 1.0)
            crown_u = math.sin(u_ratio * math.pi)
            crown_v = math.sin(v_ratio * math.pi)
            curve_y = crown_u * 0.032 - crown_v * 0.014
            curve_z = crown_u * z_arch + crown_v * 0.015
            row.append(bm.verts.new(Vector((x, y + curve_y, z_side + curve_z))))
        grid_verts.append(row)

    for vi in range(v_segs):
        for ui in range(u_segs):
            v0 = grid_verts[vi][ui]
            v1 = grid_verts[vi][ui + 1]
            v2 = grid_verts[vi + 1][ui + 1]
            v3 = grid_verts[vi + 1][ui]
            face = bm.faces.new([v0, v1, v2, v3])
            face.material_index = 0
            face.smooth = True

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
            loop = mesh.loops[loop_idx]
            vert = mesh.vertices[loop.vertex_index]
            u = (vert.co.x - min_x) / range_x
            v = 1.0 - (vert.co.z - min_z) / range_z
            uv_layer.data[loop_idx].uv = (u, v)

    obj = bpy.data.objects.new("RearWindow", mesh)
    obj.data.materials.append(materials["WindowGlass"])
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_wiper(
    materials,
    name_suffix: str,
    pivot_loc: Vector,
    pivot_rot: Euler,
    parent_root: bpy.types.Object,
):
    """日本の右ハンドル車用ワイパーピボットEmptyと、フロントガラス下端カウルに沿って延伸するエアロワイパーブレードを作成"""
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

    # Three.js の carModel.ts / windshield.ts と完全一致するピボット・ブレード半径で構築
    add_slanted_strut(
        bm,
        p0=Vector((0.0, 0.0, 0.0)),
        p1=Vector((arm_length, 0.032, 0.042)),
        width_x=0.016,
        depth_y=0.012,
        taper=0.75,
        mat_idx=0,
        smooth=False,
    )

    add_slanted_strut(
        bm,
        p0=Vector((blade_inner_r, 0.012, 0.015)),
        p1=Vector((blade_outer_r, 0.055, 0.072)),
        width_x=0.014,
        depth_y=0.012,
        taper=0.85,
        mat_idx=0,
        smooth=False,
    )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    blade_obj = bpy.data.objects.new(f"WiperBlade{name_suffix}", mesh)
    blade_obj.data.materials.append(materials["WiperBlack"])
    blade_obj.parent = pivot_empty
    bpy.context.scene.collection.objects.link(blade_obj)

    return pivot_empty, blade_obj


def add_rounded_tire(bm, radius: float, rim_r: float, width: float, segments=32, mat_idx=0):
    """ショルダー部に丸みのあるリアルなラジアルタイヤ断面を32分割で生成"""
    half_w = width * 0.5
    shoulder_w = half_w * 0.82
    shoulder_r = radius * 0.965

    profile = [
        (-shoulder_w * 0.92, rim_r),
        (-half_w, rim_r + (radius - rim_r) * 0.48),
        (-shoulder_w, shoulder_r),
        (-shoulder_w * 0.45, radius),
        (shoulder_w * 0.45, radius),
        (shoulder_w, shoulder_r),
        (half_w, rim_r + (radius - rim_r) * 0.48),
        (shoulder_w * 0.92, rim_r),
    ]

    rings = []
    for x_pos, r_val in profile:
        ring = []
        for s in range(segments):
            ang = (2.0 * math.pi * s) / segments
            y = math.cos(ang) * r_val
            z = math.sin(ang) * r_val
            ring.append(bm.verts.new(Vector((x_pos, y, z))))
        rings.append(ring)

    for p_idx in range(len(rings) - 1):
        r0 = rings[p_idx]
        r1 = rings[p_idx + 1]
        for s in range(segments):
            ns = (s + 1) % segments
            f = bm.faces.new([r0[s], r0[ns], r1[ns], r1[s]])
            f.material_index = mat_idx
            f.smooth = True


def build_wheel(
    materials, name: str, position: Vector, parent_root: bpy.types.Object
) -> bpy.types.Object:
    """クラウン セダン Z 20インチ 20本マルチスポーク（ダークメタリック＆切削光輝タービン調）アルミホイール + ブレーキローターを作成"""
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    bm = bmesh.new()

    # 0: TireRubber, 1: WheelAlloy, 2: BrakeRotor, 3: BrakeCaliper, 4: BlackTrim, 5: Chrome
    mat_keys = [
        "TireRubber",
        "WheelAlloy",
        "BrakeRotor",
        "BrakeCaliper",
        "BlackTrim",
        "Chrome",
    ]

    radius = 0.34
    width = 0.245
    rim_r = 0.248
    rim_inner_r = 0.228
    side_sign = 1.0 if position.x > 0 else -1.0

    # 1. ラウンドショルダータイヤ（245/45ZR20 相当）
    add_rounded_tire(bm, radius=radius, rim_r=rim_r, width=width, segments=36, mat_idx=0)

    # 2. 中空ホイールアウターリムバレル & 切削光輝フランジリング
    add_hollow_tube_x(
        bm,
        center=Vector((0.0, 0.0, 0.0)),
        r_outer=rim_r,
        r_inner=rim_inner_r,
        width_x=width * 0.84,
        segments=36,
        mat_idx=1,
        smooth=True,
    )
    add_hollow_tube_x(
        bm,
        center=Vector((side_sign * (width * 0.39), 0.0, 0.0)),
        r_outer=rim_r,
        r_inner=rim_inner_r + 0.006,
        width_x=0.012,
        segments=36,
        mat_idx=5,
        smooth=True,
    )

    # ホイール奥側のダークインナーバックプレート
    add_cylinder(
        bm,
        center=Vector((-side_sign * width * 0.32, 0.0, 0.0)),
        radius=rim_inner_r,
        height=0.02,
        segments=28,
        axis="X",
        mat_idx=4,
        smooth=False,
    )

    # 3. クラウン セダン 20本マルチスポーク（10組×2本の細身タービン調スポーク、切削光輝表層＋ダークメタリック側面）
    outer_x = side_sign * (width * 0.395)
    hub_x = side_sign * (width * 0.315)
    for pair_idx in range(10):
        base_angle = (2.0 * math.pi * pair_idx) / 10.0
        for sub_idx, sub_offset in enumerate([-0.095, 0.095]):
            s_angle = base_angle + sub_offset
            # タービン調のわずかなツイスト角
            twist = 0.045 if sub_idx == 0 else -0.025
            p_hub = Vector(
                (
                    hub_x,
                    math.cos(s_angle - twist) * 0.056,
                    math.sin(s_angle - twist) * 0.056,
                )
            )
            p_rim = Vector(
                (
                    outer_x,
                    math.cos(s_angle + twist) * (rim_inner_r * 1.015),
                    math.sin(s_angle + twist) * (rim_inner_r * 1.015),
                )
            )

            tangent = Vector((0.0, -math.sin(s_angle), math.cos(s_angle))) * 0.0085
            thick_x = Vector((0.014, 0.0, 0.0))
            spoke_verts = [
                p_hub - tangent - thick_x,
                p_hub + tangent - thick_x,
                p_hub + tangent + thick_x,
                p_hub - tangent + thick_x,
                p_rim - tangent * 0.78 - thick_x,
                p_rim + tangent * 0.78 - thick_x,
                p_rim + tangent * 0.78 + thick_x,
                p_rim - tangent * 0.78 + thick_x,
            ]
            # 交互に WheelAlloy と Chrome を織り交ぜて切削光輝のコントラストを表現
            spoke_mat = 5 if sub_idx == 0 else 1
            add_hexahedron(bm, spoke_verts, mat_idx=spoke_mat, smooth=False)

    # 4. センターハブキャップ & 王冠オーナメントリング
    add_cylinder(
        bm,
        center=Vector((hub_x + side_sign * 0.018, 0.0, 0.0)),
        radius=0.058,
        height=0.032,
        segments=24,
        axis="X",
        mat_idx=4,
        smooth=True,
    )
    add_cylinder(
        bm,
        center=Vector((hub_x + side_sign * 0.028, 0.0, 0.0)),
        radius=0.034,
        height=0.018,
        segments=20,
        axis="X",
        mat_idx=5,
        smooth=True,
    )

    # 5. スポークの奥に見えるベンチレーटेडブレーキローター & サテンシルバーキャリパー
    rotor_x = side_sign * (width * 0.14)
    add_cylinder(
        bm,
        center=Vector((rotor_x, 0.0, 0.0)),
        radius=0.205,
        height=0.026,
        segments=24,
        axis="X",
        mat_idx=2,
        smooth=True,
    )
    add_box(
        bm,
        center=Vector((rotor_x + side_sign * 0.028, -0.125, 0.075)),
        size=Vector((0.048, 0.085, 0.145)),
        mat_idx=3,
        smooth=False,
    )

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
    """ミラー鏡面メッシュに glTF 2.0 出力後 Three.js 側で u=[0..1] (右→左)、v=[0..1] (下→上) となる正規化UVを付与"""
    uv_layer = mesh.uv_layers.new(name="UVMap")
    cos_y = math.cos(-yaw_rad)
    sin_y = math.sin(-yaw_rad)

    local_xs = []
    local_zs = []
    for v in mesh.vertices:
        lx = v.co.x * cos_y - v.co.y * sin_y
        local_xs.append(lx)
        local_zs.append(v.co.z)

    min_x, max_x = min(local_xs), max(local_xs)
    min_z, max_z = min(local_zs), max(local_zs)
    range_x = (max_x - min_x) if max_x != min_x else 1.0
    range_z = (max_z - min_z) if max_z != min_z else 1.0

    for poly in mesh.polygons:
        for loop_idx in poly.loop_indices:
            loop = mesh.loops[loop_idx]
            vert = mesh.vertices[loop.vertex_index]
            lx = vert.co.x * cos_y - vert.co.y * sin_y
            u = (lx - min_x) / range_x
            v_coord = 1.0 - (vert.co.z - min_z) / range_z
            uv_layer.data[loop_idx].uv = (u, v_coord)


def build_rearview_mirror(materials, parent_root: bpy.types.Object):
    """トヨタ クラウン セダン (AZSH32) 実車通り車体中央 (X=0.00m)・フロントガラス上端ヘッダーにマウントされた JDM ワイド台形デジタルインナーミラーと鏡面メッシュを構築
    - RearviewMirror: 車体中央 (X=0.00m) のフロントガラス内面〜オーバーヘッドコンソールに密着する Toyota Safety Sense 3.0 ADAS カメラセンサーポッド + センターボールジョイントステー + 8角台形フレームレス筐体 + 防眩トグル
    - RearviewMirrorGlass: 右ハンドル運転席 (X=-0.38m) 側へヨー角22°チルトされた UV 正規化済み鏡面メッシュ
    """
    housing_mesh = bpy.data.meshes.new("RearviewMirrorMesh")
    bm = bmesh.new()
    # 0: InteriorDark, 1: BlackTrim, 2: Chrome, 3: DashboardScreen
    mat_keys = ["InteriorDark", "BlackTrim", "Chrome", "DashboardScreen"]

    # ルームミラー中心ピボット: 実車のクラウン セダン通り車体幅方向の中央 (X=0.00m)、フロントガラス上部傾斜面に沿った位置 (Y=-0.74m, Z=1.258m)
    # Why X=0.00m, Y=-0.74m, Z=1.258m に配置し yaw=22° チルトするか:
    # 従来の X=-0.14m, Z=1.232m は運転席寄りかつ低い位置にあり、センターディスプレイ真上のフロントガラス中央付近に不自然にぶら下がっていた。
    # 車体中央 (X=0.00m) かつフロントガラス傾斜面に沿った奥行き (Y=-0.74m, Z=1.258m) に配置することで、車外・車内の全方位から見て実車通りの正統なルームミラー位置になり、
    # 右ハンドル運転席アイポイント (-0.38, -0.06, 1.13) からも水平角 +29.2° (FOV内中央左寄り上部)・仰角 +10.7° に収まり前方視界を妨げない。
    pivot = Vector((0.0, -0.74, 1.258))
    yaw_angle = math.radians(22.0)  # 右ハンドル運転席 (X=-0.38m) へ向けて22°チルト
    pitch_angle = math.radians(-5.0)  # やや下向きにチルトしてドライバーの目線と正対させる
    cos_y = math.cos(yaw_angle)
    sin_y = math.sin(yaw_angle)
    cos_p = math.cos(pitch_angle)
    sin_p = math.sin(pitch_angle)

    def xform_rv(lx: float, ly: float, lz: float) -> Vector:
        # まずX軸まわりピッチ回転、次にZ軸まわりヨー回転
        py = ly * cos_p - lz * sin_p
        pz = ly * sin_p + lz * cos_p
        rx = lx * cos_y - py * sin_y
        ry = lx * sin_y + py * cos_y
        return pivot + Vector((rx, ry, pz))

    # 1. 車体中央 (X=0.00m) のフロントガラス内面 (v=0.72..1.00: Y=-0.760..-0.545m, Z=1.280..1.412m) に沿って薄く密着する
    # Toyota Safety Sense 3.0 ADAS カメラセンサーポッド＆セラミックフリット遮光シュラウド
    # Why ガラス面から室内側への厚みを 18mm に抑え幅をテーパーさせるか:
    # 運転席 (X=-0.38m) から斜め左上のルームミラー (X=0.00m) を見たとき、ポッドの右側面が巨大な黒い箱の壁に見えないよう、
    # フロントガラス内面に張り付いたスリムな流線形ウェッジ断面にするため。
    adas_pod_upper_verts = [
        Vector((-0.072, -0.695, 1.328)),
        Vector((0.072, -0.695, 1.328)),
        Vector((0.088, -0.548, 1.412)),
        Vector((-0.088, -0.548, 1.412)),
        Vector((-0.064, -0.682, 1.314)),
        Vector((0.064, -0.682, 1.314)),
        Vector((0.080, -0.538, 1.392)),
        Vector((-0.080, -0.538, 1.392)),
    ]
    add_hexahedron(bm, adas_pod_upper_verts, mat_idx=0, smooth=False)

    # フロントガラス内面下部シュラウド (X=±0.048m..±0.072m, Y=-0.755..-0.695m, Z=1.292..1.328m)
    adas_pod_lower_verts = [
        Vector((-0.048, -0.755, 1.292)),
        Vector((0.048, -0.755, 1.292)),
        Vector((0.072, -0.695, 1.328)),
        Vector((-0.072, -0.695, 1.328)),
        Vector((-0.042, -0.742, 1.282)),
        Vector((0.042, -0.742, 1.282)),
        Vector((0.064, -0.682, 1.314)),
        Vector((-0.064, -0.682, 1.314)),
    ]
    add_hexahedron(bm, adas_pod_lower_verts, mat_idx=1, smooth=False)

    # ADAS ポッド下面中央 (X=0.00m) からルームミラー上端 (Z=1.292m) の上方に明確に立ち上がる上部マウントボス＆デュアルジョイント・シリンダーステー
    mount_boss_verts = [
        Vector((-0.024, -0.742, 1.306)),
        Vector((0.024, -0.742, 1.306)),
        Vector((0.028, -0.695, 1.334)),
        Vector((-0.028, -0.695, 1.334)),
        Vector((-0.018, -0.736, 1.294)),
        Vector((0.018, -0.736, 1.294)),
        Vector((0.022, -0.700, 1.318)),
        Vector((-0.022, -0.700, 1.318)),
    ]
    add_hexahedron(bm, mount_boss_verts, mat_idx=1, smooth=False)

    # アッパーステー（車体中央 X=0.00m の ADAS マウントボス Z=1.316m から ミラー上方ネック Z=1.292m へ降りる太径アルミダイキャストステー）
    p_boss = Vector((0.0, -0.722, 1.316))
    p_neck = Vector((0.0, -0.752, 1.292))
    p_socket = xform_rv(0.0, -0.017, 0.012)
    p_top_spine = xform_rv(0.0, -0.016, 0.025)

    add_slanted_strut(
        bm,
        p0=p_boss,
        p1=p_neck,
        width_x=0.024,
        depth_y=0.024,
        taper=0.90,
        mat_idx=1,
        smooth=False,
    )
    # ネックからミラー背面スパイン (Z=1.257m) および背面ボールジョイントソケット (Z=1.244m) へ隙間なく貫入するロアアーム
    add_slanted_strut(
        bm,
        p0=p_neck,
        p1=p_top_spine,
        width_x=0.022,
        depth_y=0.016,
        taper=0.92,
        mat_idx=1,
        smooth=False,
    )
    add_slanted_strut(
        bm,
        p0=p_neck,
        p1=p_socket,
        width_x=0.020,
        depth_y=0.016,
        taper=0.88,
        mat_idx=1,
        smooth=False,
    )
    add_cylinder(
        bm,
        center=p_neck,
        radius=0.011,
        height=0.022,
        segments=16,
        axis="X",
        mat_idx=1,
        smooth=True,
    )
    add_cylinder(
        bm,
        center=xform_rv(0.0, -0.018, 0.010),
        radius=0.013,
        height=0.016,
        segments=16,
        axis="Y",
        mat_idx=2,
        smooth=True,
    )

    # 2. JDM ワイド台形フレームレス風ルームミラーハウジング（上辺 246mm / 下辺 218mm × 高さ 68mm）
    # 8角形ベベル輪郭（上辺が広く、下辺が絞られた日本車純正ワイドミラー形状）
    def rv_profile(scale_x: float, scale_z: float):
        pts = [
            (-0.104 * scale_x, -0.033 * scale_z),  # 下右
            (0.104 * scale_x, -0.033 * scale_z),  # 下左
            (0.118 * scale_x, -0.018 * scale_z),  # 左下コーナー
            (0.123 * scale_x, 0.020 * scale_z),  # 左上コーナー
            (0.112 * scale_x, 0.034 * scale_z),  # 上左
            (-0.112 * scale_x, 0.034 * scale_z),  # 上右
            (-0.123 * scale_x, 0.020 * scale_z),  # 右上コーナー
            (-0.118 * scale_x, -0.018 * scale_z),  # 右下コーナー
        ]
        return pts

    outer_prof = rv_profile(1.0, 1.0)
    inner_prof = rv_profile(0.94, 0.90)
    back_prof = rv_profile(0.82, 0.78)

    ring_front_edge = [bm.verts.new(xform_rv(px, 0.006, pz)) for px, pz in outer_prof]
    ring_inner_bezel = [bm.verts.new(xform_rv(px, 0.002, pz)) for px, pz in inner_prof]
    ring_mid_body = [bm.verts.new(xform_rv(px, -0.008, pz)) for px, pz in outer_prof]
    ring_back_cap = [bm.verts.new(xform_rv(px, -0.018, pz)) for px, pz in back_prof]

    n_rv = len(ring_front_edge)
    for i in range(n_rv):
        ni = (i + 1) % n_rv
        # 外周サイドシェル
        f_side = bm.faces.new(
            [
                ring_front_edge[i],
                ring_front_edge[ni],
                ring_mid_body[ni],
                ring_mid_body[i],
            ]
        )
        f_side.material_index = 1
        f_side.smooth = False
        # 背面テーパーシェル
        f_taper = bm.faces.new(
            [ring_mid_body[i], ring_mid_body[ni], ring_back_cap[ni], ring_back_cap[i]]
        )
        f_taper.material_index = 0
        f_taper.smooth = False
        # 鏡面周囲のスリムマイクロベゼル縁
        f_bezel = bm.faces.new(
            [
                ring_inner_bezel[i],
                ring_inner_bezel[ni],
                ring_front_edge[ni],
                ring_front_edge[i],
            ]
        )
        f_bezel.material_index = 1
        f_bezel.smooth = False

    f_rv_back = bm.faces.new(list(reversed(ring_back_cap)))
    f_rv_back.material_index = 0
    f_rv_back.smooth = False

    f_rv_inner = bm.faces.new(ring_inner_bezel)
    f_rv_inner.material_index = 1
    f_rv_inner.smooth = False

    # 下部中央の防眩フリップレバー＆自動防眩インジケーターLED
    add_box(
        bm,
        center=xform_rv(0.0, -0.004, -0.038),
        size=Vector((0.028, 0.012, 0.008)),
        mat_idx=1,
        smooth=False,
    )
    add_box(
        bm,
        center=xform_rv(-0.075, 0.006, -0.028),
        size=Vector((0.008, 0.003, 0.004)),
        mat_idx=3,
        smooth=False,
    )

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    bm.to_mesh(housing_mesh)
    bm.free()

    housing_obj = bpy.data.objects.new("RearviewMirror", housing_mesh)
    for k in mat_keys:
        housing_obj.data.materials.append(materials[k])
    housing_obj.parent = parent_root
    bpy.context.scene.collection.objects.link(housing_obj)

    # 3. 独立したルームミラー鏡面メッシュ (RearviewMirrorGlass) — Three.js 側でリアルタイム後方レンダーターゲットを貼る
    glass_mesh = bpy.data.meshes.new("RearviewMirrorGlassMesh")
    bm_g = bmesh.new()
    glass_prof = rv_profile(0.935, 0.895)
    # ドライバー側 (+Y) から見て反時計回りになるよう頂点を配置し、法線を確実にドライバー側 (+Y) へ向ける
    g_verts = [bm_g.verts.new(xform_rv(px, 0.0045, pz)) for px, pz in reversed(glass_prof)]
    f_glass = bm_g.faces.new(g_verts)
    f_glass.material_index = 0
    f_glass.smooth = False
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
    """左右ドアミラーの凹みバイザー内に収まる8角ティアドロップ鏡面メッシュ (SideMirrorGlass_R / SideMirrorGlass_L) を構築"""
    created = []
    for side, suffix in [(-1.0, "R"), (1.0, "L")]:
        mesh = bpy.data.meshes.new(f"SideMirrorGlass_{suffix}Mesh")
        bm = bmesh.new()

        is_left_mirror = side > 0
        mirror_y = -0.880 if is_left_mirror else -1.005
        yaw_deg = 27.0 if is_left_mirror else 22.0
        yaw_angle = side * math.radians(yaw_deg)
        cos_y = math.cos(yaw_angle)
        sin_y = math.sin(yaw_angle)
        pivot = Vector((side * 0.918, mirror_y, 0.962))

        def transform_pt(
            local_x: float,
            local_y: float,
            local_z: float,
            _cos_y: float = cos_y,
            _sin_y: float = sin_y,
            _pivot: Vector = pivot,
        ) -> Vector:
            rx = local_x * _cos_y - local_y * _sin_y
            ry = local_x * _sin_y + local_y * _cos_y
            return _pivot + Vector((rx, ry, local_z))

        in_x = -side * 0.086
        out_x = side * 0.086
        scale_x = 0.87
        scale_z = 0.85
        y_glass = 0.008  # 凹みインナーバイザー (y=0.004..0.018) の中間に配置

        pts_local = [
            (in_x * 0.78 * scale_x, y_glass, -0.046 * scale_z),
            (out_x * 0.72 * scale_x, y_glass, -0.042 * scale_z),
            (out_x * 0.98 * scale_x, y_glass, -0.015 * scale_z),
            (out_x * 0.92 * scale_x, y_glass, 0.030 * scale_z),
            (out_x * 0.62 * scale_x, y_glass, 0.050 * scale_z),
            (in_x * 0.68 * scale_x, y_glass, 0.054 * scale_z),
            (in_x * 0.98 * scale_x, y_glass, 0.026 * scale_z),
            (in_x * 0.95 * scale_x, y_glass, -0.020 * scale_z),
        ]

        g_verts = [bm.verts.new(transform_pt(px, py, pz)) for px, py, pz in pts_local]
        f_glass = bm.faces.new(g_verts)
        f_glass.material_index = 0
        f_glass.smooth = False
        # 法線が必ず車両後方 (+Y) かつ車体内側を向くように揃える
        # Why not bm.normal_update() を呼ばずに f_glass.normal.y < 0 を判定しないか:
        # BMesh では bm.faces.new() 直後は f_glass.normal が (0,0,0) の初期値であり、
        # 事前に bm.normal_update() を呼ばないと判定が常に false となって左ミラー法線が前方 (-Y / Three.js +Z) を向いたまま
        # Three.js 側で裏面カリング (Backface Culling) により完全不可視になってしまうため。
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


def generate_vehicle():
    """車両モデル全体を生成しエクスポート"""
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

    # 日本の右ハンドル車仕様: 運転席ワイパーピボットは (x=-0.58)、助手席ワイパーピボットは中央 (x=+0.06) に置き、
    # Three.js の carModel.ts / windshield.ts と完全一致させる
    driver_loc = Vector((-0.58, -1.275, 0.891))
    driver_rot = Euler((0.0, 0.0, 0.0), "XYZ")
    build_wiper(materials, "Driver", driver_loc, driver_rot, root)

    passenger_loc = Vector((0.06, -1.318, 0.891))
    passenger_rot = Euler((0.0, 0.0, 0.0), "XYZ")
    build_wiper(materials, "Passenger", passenger_loc, passenger_rot, root)

    wheel_coords = [
        ("Wheel_FL", Vector((-0.86, -1.39, 0.34))),  # 前右 (右ハンドル運転席側)
        ("Wheel_FR", Vector((0.86, -1.39, 0.34))),  # 前左 (助手席側)
        ("Wheel_RL", Vector((-0.86, 1.39, 0.34))),  # 後右
        ("Wheel_RR", Vector((0.86, 1.39, 0.34))),  # 後左
    ]
    for name, pos in wheel_coords:
        build_wheel(materials, name, pos, root)

    print("High-precision JDM RHD Vehicle modeling complete! Hierarchy created:")
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

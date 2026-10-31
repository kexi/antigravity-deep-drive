"""
Blender Procedural Modeling Script: 車両モデル (Car Model)
Tokyo Station Deep Drive 用 3D アセット生成

階層構造:
CarRoot (Empty)
├── Chassis (メッシュ: 外装ボディ、バンパー、グリル、ライト、ミラー)
├── Interior (メッシュ: ダッシュボード、コンソール、シート、スクリーン)
├── SteeringWheel (メッシュ: ステアリングハンドル - ピボットは回転軸中心)
├── Windshield (メッシュ: フロントガラス - UV展開必須)
├── WiperDriver (Empty: 運転席ワイパーピボット)
│   └── WiperBladeDriver (メッシュ: ワイパーアーム＆ブレード)
├── WiperPassenger (Empty: 助手席ワイパーピボット)
│   └── WiperBladePassenger (メッシュ: ワイパーアーム＆ブレード)
├── Wheel_FL (メッシュ: 前左タイヤ・ホイール)
├── Wheel_FR (メッシュ: 前右タイヤ・ホイール)
├── Wheel_RL (メッシュ: 後左タイヤ・ホイール)
└── Wheel_RR (メッシュ: 後右タイヤ・ホイール)
"""

import bpy
import bmesh
import math
import os
from mathutils import Vector, Matrix, Euler


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
    transmission=0.0,
    ior=1.45,
    alpha=1.0,
    coat_weight=0.0,
    coat_roughness=0.1,
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


def setup_materials():
    """車両用PBRマテリアル一式を定義"""
    materials = {
        # 外装メタリックブルー（クリアコート付き）
        "BodyPaint": create_pbr_material(
            "BodyPaint",
            base_color=(0.04, 0.22, 0.68, 1.0),
            metallic=0.88,
            roughness=0.18,
            coat_weight=1.0,
            coat_roughness=0.08,
        ),
        # マットブラックプラスチックトリム（グリル、バンパー下部）
        "BlackTrim": create_pbr_material(
            "BlackTrim",
            base_color=(0.03, 0.03, 0.04, 1.0),
            roughness=0.75,
            metallic=0.05,
        ),
        # クロームメッキ
        "Chrome": create_pbr_material(
            "Chrome",
            base_color=(0.95, 0.95, 0.95, 1.0),
            metallic=0.98,
            roughness=0.08,
        ),
        # フロントガラス（高透過PBRガラス）
        "WindshieldGlass": create_pbr_material(
            "WindshieldGlass",
            base_color=(0.88, 0.94, 0.98, 0.25),
            metallic=0.05,
            roughness=0.03,
            transmission=0.92,
            ior=1.52,
            alpha=0.35,
        ),
        # キャビンサイド・リアウィンドウ（スモークガラス）
        "WindowGlass": create_pbr_material(
            "WindowGlass",
            base_color=(0.12, 0.15, 0.18, 0.4),
            metallic=0.2,
            roughness=0.05,
            transmission=0.8,
            ior=1.52,
            alpha=0.5,
        ),
        # ヘッドライトLED（発光）
        "HeadlightLED": create_pbr_material(
            "HeadlightLED",
            base_color=(1.0, 1.0, 1.0, 1.0),
            emission_color=(1.0, 0.98, 0.92, 1.0),
            emission_strength=4.5,
            roughness=0.1,
        ),
        # テールライトLED（赤発光）
        "TaillightLED": create_pbr_material(
            "TaillightLED",
            base_color=(0.85, 0.02, 0.02, 1.0),
            emission_color=(1.0, 0.05, 0.05, 1.0),
            emission_strength=3.0,
            roughness=0.1,
        ),
        # 内装ダークプラスチック / レザー
        "InteriorDark": create_pbr_material(
            "InteriorDark",
            base_color=(0.06, 0.06, 0.07, 1.0),
            roughness=0.85,
            metallic=0.0,
        ),
        "InteriorSeat": create_pbr_material(
            "InteriorSeat",
            base_color=(0.11, 0.11, 0.13, 1.0),
            roughness=0.6,
            metallic=0.0,
        ),
        # ダッシュボードナビ液晶画面
        "DashboardScreen": create_pbr_material(
            "DashboardScreen",
            base_color=(0.02, 0.06, 0.12, 1.0),
            emission_color=(0.1, 0.45, 0.85, 1.0),
            emission_strength=1.8,
            roughness=0.2,
        ),
        # ステアリングホイールレザー
        "SteeringLeather": create_pbr_material(
            "SteeringLeather",
            base_color=(0.04, 0.04, 0.04, 1.0),
            roughness=0.7,
            metallic=0.05,
        ),
        # ワイパーブラック
        "WiperBlack": create_pbr_material(
            "WiperBlack",
            base_color=(0.02, 0.02, 0.02, 1.0),
            roughness=0.8,
            metallic=0.2,
        ),
        # タイヤゴム
        "TireRubber": create_pbr_material(
            "TireRubber",
            base_color=(0.04, 0.04, 0.04, 1.0),
            roughness=0.92,
            metallic=0.0,
        ),
        # ホイールアルミ合金リム
        "WheelAlloy": create_pbr_material(
            "WheelAlloy",
            base_color=(0.82, 0.82, 0.85, 1.0),
            metallic=0.92,
            roughness=0.22,
        ),
        # ブレーキローター
        "BrakeRotor": create_pbr_material(
            "BrakeRotor",
            base_color=(0.55, 0.55, 0.58, 1.0),
            metallic=0.85,
            roughness=0.35,
        ),
        # ブレーキキャリパー（スポーツレッド）
        "BrakeCaliper": create_pbr_material(
            "BrakeCaliper",
            base_color=(0.85, 0.05, 0.05, 1.0),
            metallic=0.4,
            roughness=0.25,
        ),
    }
    return materials


def add_box(bm, center: Vector, size: Vector, mat_idx=0):
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
        (v0, v4, v5, v1),  # back (-Y)
        (v2, v6, v7, v3),  # front (+Y)
        (v0, v3, v7, v4),  # left (-X)
        (v1, v5, v6, v2),  # right (+X)
    ]
    created_faces = []
    for f_verts in faces:
        face = bm.faces.new(f_verts)
        face.material_index = mat_idx
        created_faces.append(face)
    return created_faces


def add_cylinder(bm, center: Vector, radius: float, height: float, segments=16, axis="Z", mat_idx=0):
    """bmesh に円柱を追加"""
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

    # 側面フェース
    for i in range(segments):
        ni = (i + 1) % segments
        face = bm.faces.new([bot_verts[i], bot_verts[ni], top_verts[ni], top_verts[i]])
        face.material_index = mat_idx

    # 端面フェース
    f_bot = bm.faces.new(list(reversed(bot_verts)))
    f_bot.material_index = mat_idx
    f_top = bm.faces.new(top_verts)
    f_top.material_index = mat_idx


def build_chassis(materials) -> bpy.types.Object:
    """外装ボディ (Chassis) をモデリング"""
    mesh = bpy.data.meshes.new("ChassisMesh")
    bm = bmesh.new()

    # マテリアル登録順:
    # 0: BodyPaint, 1: BlackTrim, 2: Chrome, 3: WindowGlass, 4: HeadlightLED, 5: TaillightLED
    mat_keys = ["BodyPaint", "BlackTrim", "Chrome", "WindowGlass", "HeadlightLED", "TaillightLED"]

    # 1. ロアボディ（メイン車体ブロック: 全長4.3m, 全幅1.9m, 高さ0.55m）
    add_box(bm, center=Vector((0.0, 0.0, 0.55)), size=Vector((1.90, 4.30, 0.55)), mat_idx=0)

    # 2. フロントノーズ・バンパー（傾斜前端）
    add_box(bm, center=Vector((0.0, 2.18, 0.48)), size=Vector((1.84, 0.22, 0.42)), mat_idx=0)
    add_box(bm, center=Vector((0.0, 2.16, 0.28)), size=Vector((1.86, 0.20, 0.16)), mat_idx=1)  # フロントリップ

    # 3. リアバンパー・ディフューザー
    add_box(bm, center=Vector((0.0, -2.18, 0.52)), size=Vector((1.84, 0.22, 0.44)), mat_idx=0)
    add_box(bm, center=Vector((0.0, -2.16, 0.30)), size=Vector((1.86, 0.20, 0.18)), mat_idx=1)  # リアディフューザー

    # 4. フロントグリル（六角・ブラックハニカム風エリア）
    add_box(bm, center=Vector((0.0, 2.29, 0.46)), size=Vector((1.25, 0.04, 0.28)), mat_idx=1)
    add_box(bm, center=Vector((0.0, 2.295, 0.46)), size=Vector((0.20, 0.02, 0.12)), mat_idx=2)  # エンブレム

    # 5. キャビン上部（ルーフ・ピラー構造）
    # ルーフ本体 (Y: -0.2 付近, Z: 1.15)
    add_box(bm, center=Vector((0.0, -0.25, 1.16)), size=Vector((1.52, 2.10, 0.46)), mat_idx=0)

    # サイドウィンドウ（左・右スモークガラス）
    add_box(bm, center=Vector((0.74, -0.25, 1.14)), size=Vector((0.04, 1.80, 0.38)), mat_idx=3)
    add_box(bm, center=Vector((-0.74, -0.25, 1.14)), size=Vector((0.04, 1.80, 0.38)), mat_idx=3)

    # リアウィンドウ（傾斜バックガラス）
    add_box(bm, center=Vector((0.0, -1.35, 1.08)), size=Vector((1.42, 0.40, 0.32)), mat_idx=3)

    # 6. サイドミラー（左右）
    # 右（運転席側: X=+0.92）
    add_box(bm, center=Vector((0.92, 0.72, 0.95)), size=Vector((0.22, 0.14, 0.10)), mat_idx=0)
    add_box(bm, center=Vector((0.82, 0.72, 0.92)), size=Vector((0.10, 0.04, 0.04)), mat_idx=1)  # ミラーステー
    # 左（助手席側: X=-0.92）
    add_box(bm, center=Vector((-0.92, 0.72, 0.95)), size=Vector((0.22, 0.14, 0.10)), mat_idx=0)
    add_box(bm, center=Vector((-0.82, 0.72, 0.92)), size=Vector((0.10, 0.04, 0.04)), mat_idx=1)  # ミラーステー

    # 7. ヘッドライト（左右フロントLEDユニット）
    add_box(bm, center=Vector((0.68, 2.16, 0.58)), size=Vector((0.42, 0.12, 0.14)), mat_idx=4)
    add_box(bm, center=Vector((-0.68, 2.16, 0.58)), size=Vector((0.42, 0.12, 0.14)), mat_idx=4)

    # 8. テールライト（左右リアLEDバー）
    add_box(bm, center=Vector((0.68, -2.16, 0.65)), size=Vector((0.45, 0.10, 0.12)), mat_idx=5)
    add_box(bm, center=Vector((-0.68, -2.16, 0.65)), size=Vector((0.45, 0.10, 0.12)), mat_idx=5)
    # センターハイマウントストップランプ
    add_box(bm, center=Vector((0.0, -1.30, 1.25)), size=Vector((0.40, 0.04, 0.04)), mat_idx=5)

    # 9. デュアルエキゾースト（マフラーカッター）
    add_cylinder(bm, center=Vector((0.55, -2.18, 0.28)), radius=0.045, height=0.12, segments=12, axis="Y", mat_idx=2)
    add_cylinder(bm, center=Vector((-0.55, -2.18, 0.28)), radius=0.045, height=0.12, segments=12, axis="Y", mat_idx=2)

    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("Chassis", mesh)
    for k in mat_keys:
        obj.data.materials.append(materials[k])

    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_interior(materials) -> bpy.types.Object:
    """コックピット内装 (Interior) をモデリング"""
    mesh = bpy.data.meshes.new("InteriorMesh")
    bm = bmesh.new()

    # 0: InteriorDark, 1: InteriorSeat, 2: DashboardScreen, 3: Chrome
    mat_keys = ["InteriorDark", "InteriorSeat", "DashboardScreen", "Chrome"]

    # 1. ダッシュボード本体 (X: 0, Y: 0.55, Z: 0.82)
    add_box(bm, center=Vector((0.0, 0.58, 0.82)), size=Vector((1.52, 0.55, 0.32)), mat_idx=0)

    # 運転席側メーターフード (X: +0.38)
    add_box(bm, center=Vector((0.38, 0.48, 0.92)), size=Vector((0.36, 0.28, 0.12)), mat_idx=0)
    add_box(bm, center=Vector((0.38, 0.44, 0.88)), size=Vector((0.30, 0.02, 0.08)), mat_idx=2)  # デジタルメーター

    # センターコンソール・ナビディスプレイ (X: 0.0)
    add_box(bm, center=Vector((0.0, 0.46, 0.88)), size=Vector((0.28, 0.04, 0.16)), mat_idx=2)  # ナビ画面
    add_box(bm, center=Vector((0.0, 0.10, 0.58)), size=Vector((0.28, 0.85, 0.22)), mat_idx=0)  # センターフロアトンネル
    add_box(bm, center=Vector((0.0, 0.22, 0.72)), size=Vector((0.06, 0.06, 0.12)), mat_idx=3)  # シフトノブ

    # 2. シート（運転席: X=+0.38, 助手席: X=-0.38）
    for seat_x in [0.38, -0.38]:
        # 座面
        add_box(bm, center=Vector((seat_x, -0.15, 0.52)), size=Vector((0.52, 0.55, 0.18)), mat_idx=1)
        # 背もたれ
        add_box(bm, center=Vector((seat_x, -0.42, 0.82)), size=Vector((0.50, 0.16, 0.55)), mat_idx=1)
        # ヘッドレスト
        add_box(bm, center=Vector((seat_x, -0.45, 1.15)), size=Vector((0.24, 0.12, 0.16)), mat_idx=1)

    # 3. リアシート（後部座席ベンチ）
    add_box(bm, center=Vector((0.0, -1.05, 0.52)), size=Vector((1.42, 0.52, 0.18)), mat_idx=1)
    add_box(bm, center=Vector((0.0, -1.28, 0.78)), size=Vector((1.40, 0.15, 0.48)), mat_idx=1)

    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("Interior", mesh)
    for k in mat_keys:
        obj.data.materials.append(materials[k])

    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_steering_wheel(materials) -> bpy.types.Object:
    """ステアリングホイール (SteeringWheel) をモデリング
    ピボット位置（原点）をステアリング回転軸の中心に設定。
    """
    mesh = bpy.data.meshes.new("SteeringWheelMesh")
    bm = bmesh.new()

    # 0: SteeringLeather, 1: Chrome
    mat_keys = ["SteeringLeather", "Chrome"]

    # 原点(0,0,0)を中心にステアリングホイールを構築（ローカル座標系）
    # 外周リング（トーラス近似の多角形リング）
    outer_r = 0.18
    inner_r = 0.15
    tube_r = (outer_r - inner_r) * 0.5
    center_r = (outer_r + inner_r) * 0.5
    segs = 24

    prev_ring = []
    first_ring = []
    for i in range(segs):
        theta = (2.0 * math.pi * i) / segs
        cx = math.cos(theta) * center_r
        cz = math.sin(theta) * center_r

        # チューブ断面（円柱風4角形）
        curr_ring = [
            bm.verts.new(Vector((cx - math.cos(theta) * tube_r, -tube_r, cz - math.sin(theta) * tube_r))),
            bm.verts.new(Vector((cx + math.cos(theta) * tube_r, -tube_r, cz + math.sin(theta) * tube_r))),
            bm.verts.new(Vector((cx + math.cos(theta) * tube_r, tube_r, cz + math.sin(theta) * tube_r))),
            bm.verts.new(Vector((cx - math.cos(theta) * tube_r, tube_r, cz - math.sin(theta) * tube_r))),
        ]
        if i == 0:
            first_ring = curr_ring
        if prev_ring:
            for j in range(4):
                nj = (j + 1) % 4
                f = bm.faces.new([prev_ring[j], prev_ring[nj], curr_ring[nj], curr_ring[j]])
                f.material_index = 0
        prev_ring = curr_ring

    # リング接続
    for j in range(4):
        nj = (j + 1) % 4
        f = bm.faces.new([prev_ring[j], prev_ring[nj], first_ring[nj], first_ring[j]])
        f.material_index = 0

    # センターパッド（中央ホーンボタン）
    add_cylinder(bm, center=Vector((0.0, 0.0, 0.0)), radius=0.065, height=0.035, segments=16, axis="Y", mat_idx=0)
    add_cylinder(bm, center=Vector((0.0, 0.015, 0.0)), radius=0.025, height=0.01, segments=12, axis="Y", mat_idx=1)  # エンブレム

    # 3本スポーク（左、右、下）
    spoke_angles = [math.pi, 0.0, -math.pi * 0.5]
    for sa in spoke_angles:
        sx = math.cos(sa) * 0.10
        sz = math.sin(sa) * 0.10
        sy = 0.0
        w = 0.028 if sa != -math.pi * 0.5 else 0.035
        l = 0.11
        if sa == math.pi or sa == 0.0:
            add_box(bm, center=Vector((sx, sy, sz)), size=Vector((l, 0.02, w)), mat_idx=1)
        else:
            add_box(bm, center=Vector((sx, sy, sz)), size=Vector((w, 0.02, l)), mat_idx=1)

    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("SteeringWheel", mesh)
    for k in mat_keys:
        obj.data.materials.append(materials[k])

    # ピボットを回転軸中心とし、運転席手前の指定位置・角度に配置
    # 運転席: X = +0.38, Y = +0.40, Z = 0.82
    # 傾斜角: ドライバー方向へ約 25 度 (X軸回り約 -25度)
    obj.location = Vector((0.38, 0.42, 0.82))
    obj.rotation_euler = Euler((math.radians(-25), 0, 0), "XYZ")

    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_windshield(materials) -> bpy.types.Object:
    """フロントガラス (Windshield) をモデリングし適正なUV展開を行う。
    UV展開ルール:
    - U軸: 左（運転席側 X>0）が 0.0、右（助手席側 X<0）が 1.0
    - V軸: ガラス下端（カウル側）が 0.0、ガラス上端（ルーフ側）が 1.0
    """
    mesh = bpy.data.meshes.new("WindshieldMesh")
    bm = bmesh.new()

    # グリッドメッシュを作成（横 U方向 8分割、縦 V方向 8分割）
    u_segs = 8
    v_segs = 8

    # カウル下端 (Y=1.28, Z=0.91) から ルーフ上端 (Y=0.48, Z=1.38) へ傾斜
    # 幅: 下部 1.48m, 上部 1.36m、わずかに前後に湾曲（アーチ）
    grid_verts = []

    for vi in range(v_segs + 1):
        v_ratio = vi / v_segs  # 0.0 (下端) -> 1.0 (上端)

        # 補間位置
        y = 1.28 * (1.0 - v_ratio) + 0.48 * v_ratio
        z = 0.91 * (1.0 - v_ratio) + 1.38 * v_ratio
        width = 1.48 * (1.0 - v_ratio) + 1.36 * v_ratio

        row = []
        for ui in range(u_segs + 1):
            u_ratio = ui / u_segs  # 0.0 (運転席側 +X) -> 1.0 (助手席側 -X)
            # X座標: 運転席側 (+width/2) から 助手席側 (-width/2)
            x = (width * 0.5) * (1.0 - 2.0 * u_ratio)

            # 中央部が少し前方に膨らむ湾曲
            curve = math.sin(u_ratio * math.pi) * 0.04
            row.append(bm.verts.new(Vector((x, y + curve, z))))

        grid_verts.append(row)

    # クアッドフェース生成
    for vi in range(v_segs):
        for ui in range(u_segs):
            v0 = grid_verts[vi][ui]
            v1 = grid_verts[vi][ui + 1]
            v2 = grid_verts[vi + 1][ui + 1]
            v3 = grid_verts[vi + 1][ui]
            face = bm.faces.new([v0, v1, v2, v3])
            face.material_index = 0

    bm.to_mesh(mesh)
    bm.free()

    # UV展開の適用
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
            # U: 運転席側 (X > 0, max_x) が 0.0, 助手席側 (X < 0, min_x) が 1.0
            u = (max_x - vert.co.x) / range_x
            # V: カウル下端 (min_z) が 0.0, ルーフ上端 (max_z) が 1.0
            v = (vert.co.z - min_z) / range_z
            uv_layer.data[loop_idx].uv = (u, v)

    obj = bpy.data.objects.new("Windshield", mesh)
    obj.data.materials.append(materials["WindshieldGlass"])
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_wiper(materials, name_suffix: str, pivot_loc: Vector, pivot_rot: Euler, parent_root: bpy.types.Object):
    """ワイパーピボットEmptyとワイパーブレードメッシュを作成"""
    # 1. ワイパーピボット（Empty）
    pivot_empty = bpy.data.objects.new(f"Wiper{name_suffix}", None)
    pivot_empty.empty_display_type = "SINGLE_ARROW"
    pivot_empty.empty_display_size = 0.2
    pivot_empty.location = pivot_loc
    pivot_empty.rotation_euler = pivot_rot
    pivot_empty.parent = parent_root
    bpy.context.scene.collection.objects.link(pivot_empty)

    # 2. ワイパーブレードメッシュ（ローカル座標系: 原点がピボット位置）
    mesh = bpy.data.meshes.new(f"WiperBlade{name_suffix}Mesh")
    bm = bmesh.new()

    # ワイパーアーム（根元からブレード中央への細長いアーム: 長さ約0.42m）
    arm_length = 0.42
    add_box(bm, center=Vector((0.0, arm_length * 0.5, 0.015)), size=Vector((0.018, arm_length, 0.012)), mat_idx=0)

    # ワイパーブレード（ゴムブレードとホルダー: 長さ約0.52m）
    blade_length = 0.52
    add_box(
        bm,
        center=Vector((0.0, arm_length * 0.95, 0.005)),
        size=Vector((0.012, blade_length, 0.010)),
        mat_idx=0,
    )

    bm.to_mesh(mesh)
    bm.free()

    blade_obj = bpy.data.objects.new(f"WiperBlade{name_suffix}", mesh)
    blade_obj.data.materials.append(materials["WiperBlack"])
    blade_obj.parent = pivot_empty
    bpy.context.scene.collection.objects.link(blade_obj)

    return pivot_empty, blade_obj


def build_wheel(materials, name: str, position: Vector, parent_root: bpy.types.Object) -> bpy.types.Object:
    """ホイール＆タイヤメッシュを作成。原点は車軸中心に配置。"""
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    bm = bmesh.new()

    # 0: TireRubber, 1: WheelAlloy, 2: BrakeRotor, 3: BrakeCaliper
    mat_keys = ["TireRubber", "WheelAlloy", "BrakeRotor", "BrakeCaliper"]

    radius = 0.38
    width = 0.28
    rim_r = 0.26

    # 1. タイヤゴム（X軸向き円柱）
    add_cylinder(bm, center=Vector((0.0, 0.0, 0.0)), radius=radius, height=width, segments=24, axis="X", mat_idx=0)

    # 2. ホイールリム（アルミ合金）
    add_cylinder(bm, center=Vector((0.0, 0.0, 0.0)), radius=rim_r, height=width + 0.01, segments=20, axis="X", mat_idx=1)

    # 3. 5本スポーク（外側表面）
    outer_x = (width * 0.5) if position.x > 0 else (-width * 0.5)
    spoke_offset_x = outer_x * 0.85
    for s_idx in range(5):
        s_angle = (2.0 * math.pi * s_idx) / 5.0
        sy = math.cos(s_angle) * (rim_r * 0.5)
        sz = math.sin(s_angle) * (rim_r * 0.5)
        add_box(
            bm,
            center=Vector((spoke_offset_x, sy, sz)),
            size=Vector((0.02, 0.045, rim_r * 0.8)),
            mat_idx=1,
        )

    # 4. センターハブキャップ
    add_cylinder(
        bm,
        center=Vector((outer_x * 0.95, 0.0, 0.0)),
        radius=0.065,
        height=0.025,
        segments=16,
        axis="X",
        mat_idx=1,
    )

    # 5. ブレーキディスクローター
    inner_x = -outer_x * 0.4
    add_cylinder(bm, center=Vector((inner_x, 0.0, 0.0)), radius=0.21, height=0.02, segments=18, axis="X", mat_idx=2)

    # 6. レッドブレーキキャリパー
    add_box(
        bm,
        center=Vector((inner_x, 0.14, 0.10)),
        size=Vector((0.045, 0.08, 0.12)),
        mat_idx=3,
    )

    bm.to_mesh(mesh)
    bm.free()

    wheel_obj = bpy.data.objects.new(name, mesh)
    for k in mat_keys:
        wheel_obj.data.materials.append(materials[k])

    wheel_obj.location = position
    wheel_obj.parent = parent_root
    bpy.context.scene.collection.objects.link(wheel_obj)
    return wheel_obj


def generate_vehicle():
    """車両モデル全体を生成しエクスポート"""
    clean_scene()
    materials = setup_materials()

    # 1. ルート空オブジェクト (CarRoot)
    root = bpy.data.objects.new("CarRoot", None)
    root.empty_display_type = "ARROWS"
    root.empty_display_size = 0.5
    bpy.context.scene.collection.objects.link(root)

    # 2. シャシー・外装ボディ
    chassis = build_chassis(materials)
    chassis.parent = root

    # 3. コックピット内装
    interior = build_interior(materials)
    interior.parent = root

    # 4. ステアリングホイール（回転軸ピボット）
    steering = build_steering_wheel(materials)
    steering.parent = root

    # 5. フロントガラス（UV展開済み）
    windshield = build_windshield(materials)
    windshield.parent = root

    # 6. ワイパーピボットとブレード（運転席・助手席）
    # setup_car_hierarchy.py に準拠した位置・角度
    driver_loc = Vector((0.28, 1.25, 0.92))
    driver_rot = Euler((math.radians(-39), 0, math.radians(11)), "XYZ")
    build_wiper(materials, "Driver", driver_loc, driver_rot, root)

    passenger_loc = Vector((-0.32, 1.25, 0.92))
    passenger_rot = Euler((math.radians(-39), 0, math.radians(11)), "XYZ")
    build_wiper(materials, "Passenger", passenger_loc, passenger_rot, root)

    # 7. ホイール4輪
    wheel_coords = [
        ("Wheel_FL", Vector((-0.95, 1.35, 0.38))),  # 前左
        ("Wheel_FR", Vector((0.95, 1.35, 0.38))),   # 前右
        ("Wheel_RL", Vector((-0.95, -1.35, 0.38))), # 後左
        ("Wheel_RR", Vector((0.95, -1.35, 0.38))),  # 後右
    ]
    for name, pos in wheel_coords:
        build_wheel(materials, name, pos, root)

    print("Vehicle modeling complete! Hierarchy created:")
    for obj in bpy.data.objects:
        p_name = obj.parent.name if obj.parent else "None"
        print(f"  - {obj.name} (Type: {obj.type}, Parent: {p_name})")

    # エクスポート先ディレクトリ確認
    out_dir = os.path.abspath("apps/web/public/models")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "car.glb")

    # glTF 2.0 (GLB) エクスポート
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

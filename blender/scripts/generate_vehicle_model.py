"""
Blender Procedural Modeling Script: 日本仕様・右ハンドル JDM スポーツセダン / クーペ (RHD JDM Aero GT)
Tokyo Station Deep Drive 用 3D アセット生成

360度全方向＆ドライバー視点レビューに基づく高精度 JDM 右ハンドルモデリング仕様:
- 日本車（NISSAN GT-R / SKYLINE 400R / GR SUPRA 系 JDM アスリートスタイル）の空力ロフトボディ
- 前後・日本規格ナンバープレート（実寸 330mm × 165mm、白地に緑文字ディテール＆封印ボルト）
- 象徴的な丸型4灯リングLEDテールランプ + ダックテールスポイラー + クアッドチタン風マフラー
- 3D曲面フロントガラス下端カウルに密着した右ハンドル（RHD）車用エアロワイパー
- 右ハンドル（RHD: X = -0.38m）専用コックピット内装:
  - 中空クロームリング2連メーター（タコメーター＆スピードメーター、発光指針＆スケール目盛り、中央マルチディスプレイ）
  - JIS規格の右ウインカーレバー（X = -0.48m）＆左ワイパーレバー（X = -0.28m）
  - ドライバー側へ傾けたベゼル付きセンターナビディスプレイ（ルート表示ディテール）、エアコンルーバー、ハザードスイッチ
  - センターコンソール（シフトブーツ＆ノブ、右ハンドル用エンジンスターターボタン、電動パーキングスイッチ、カップホルダー）
  - 隙間なく連続する左右ドア内張りトリム・アームレスト・Aピラーガセット＆エアロドアミラー（車内から黒い箱や光点に見えない設計）

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

import bpy
import bmesh
import math
import os
from mathutils import Vector, Euler


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


def setup_materials():
    """車両用PBRマテリアル一式を定義
    Why metallic を 0.45〜0.55 に抑えるか:
    Three.js 側で HDRI 環境マップ無し（DirectionalLight + HemisphereLight）で描画される際、
    metallic が 0.9 以上だと拡散反射成分 (1 - metallic) が消失して真っ黒なシルエットになるのを防ぐため。
    """
    return {
        # 外装 JDM ベイサイドブルーメタリック（環境マップ無しでも鮮やかなブルーの陰影が出る設定）
        "BodyPaint": create_pbr_material(
            "BodyPaint",
            base_color=(0.07, 0.30, 0.82, 1.0),
            metallic=0.48,
            roughness=0.22,
            coat_weight=0.75,
            coat_roughness=0.10,
        ),
        # カーボン＆サテンブラックトリム（スプリッター、ディフューザー、ピラー、グリル、ホイールハウス内壁）
        "BlackTrim": create_pbr_material(
            "BlackTrim",
            base_color=(0.035, 0.038, 0.045, 1.0),
            roughness=0.55,
            metallic=0.15,
        ),
        # クローム＆サテンシルバー（エンブレム、マフラー、メーターリング：車内でも黒潰れしないよう微発光を付与）
        "Chrome": create_pbr_material(
            "Chrome",
            base_color=(0.88, 0.91, 0.95, 1.0),
            metallic=0.45,
            roughness=0.20,
            emission_color=(0.85, 0.88, 0.92, 1.0),
            emission_strength=0.12,
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
        # リアガラス・クォーターガラス（スモークガラス）
        "WindowGlass": create_pbr_material(
            "WindowGlass",
            base_color=(0.10, 0.14, 0.18, 0.45),
            metallic=0.15,
            roughness=0.06,
            transmission=0.78,
            ior=1.52,
            alpha=0.45,
        ),
        # ヘッドライトLED（クールホワイト発光）
        "HeadlightLED": create_pbr_material(
            "HeadlightLED",
            base_color=(0.95, 0.98, 1.0, 1.0),
            emission_color=(0.92, 0.96, 1.0, 1.0),
            emission_strength=4.5,
            roughness=0.08,
        ),
        # テールライトLED（JDM 丸型4灯クリムゾンレッド発光）
        "TaillightLED": create_pbr_material(
            "TaillightLED",
            base_color=(0.92, 0.03, 0.05, 1.0),
            emission_color=(1.0, 0.05, 0.07, 1.0),
            emission_strength=4.2,
            roughness=0.08,
        ),
        # 日本規格ナンバープレート白地（夜間・追従視点でも白プレートが鮮明に見えるよう微発光を設定）
        "JdmPlateWhite": create_pbr_material(
            "JdmPlateWhite",
            base_color=(0.96, 0.97, 0.95, 1.0),
            metallic=0.04,
            roughness=0.35,
            emission_color=(0.94, 0.96, 0.93, 1.0),
            emission_strength=0.38,
        ),
        # 日本規格ナンバープレート濃緑文字（自家用登録車の緑文字）
        "JdmPlateGreen": create_pbr_material(
            "JdmPlateGreen",
            base_color=(0.03, 0.24, 0.11, 1.0),
            metallic=0.05,
            roughness=0.40,
            emission_color=(0.03, 0.22, 0.10, 1.0),
            emission_strength=0.15,
        ),
        # ドアミラー鏡面（防眩ブルーグレー鏡面）
        "MirrorGlass": create_pbr_material(
            "MirrorGlass",
            base_color=(0.28, 0.36, 0.44, 1.0),
            metallic=0.35,
            roughness=0.18,
            emission_color=(0.18, 0.24, 0.30, 1.0),
            emission_strength=0.08,
        ),
        # 内装アルカンターラ / ダッシュボードソフトパッド
        "InteriorDark": create_pbr_material(
            "InteriorDark",
            base_color=(0.07, 0.075, 0.09, 1.0),
            roughness=0.78,
            metallic=0.04,
        ),
        # 内装スポーツレザーシート＆ドアトリムアクセント
        "InteriorSeat": create_pbr_material(
            "InteriorSeat",
            base_color=(0.12, 0.13, 0.16, 1.0),
            roughness=0.58,
            metallic=0.05,
        ),
        # メーター盤・ナビ画面のダーク背景（単なる青い板に見えないよう引き締まった黒紺液晶ベース）
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
        # メーター指針・スタートボタン・ハザードスイッチ発光（JDM スポーツレッド）
        "GaugeNeedleRed": create_pbr_material(
            "GaugeNeedleRed",
            base_color=(0.95, 0.12, 0.08, 1.0),
            emission_color=(1.0, 0.16, 0.08, 1.0),
            emission_strength=1.80,
            roughness=0.18,
        ),
        # ステアリングホイールレザー
        "SteeringLeather": create_pbr_material(
            "SteeringLeather",
            base_color=(0.055, 0.06, 0.07, 1.0),
            roughness=0.60,
            metallic=0.06,
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
        # ホイール鍛造アルミ合金リム
        "WheelAlloy": create_pbr_material(
            "WheelAlloy",
            base_color=(0.82, 0.85, 0.90, 1.0),
            metallic=0.50,
            roughness=0.20,
        ),
        # ブレーキローター（ドリルドスチールディスク）
        "BrakeRotor": create_pbr_material(
            "BrakeRotor",
            base_color=(0.55, 0.58, 0.62, 1.0),
            metallic=0.48,
            roughness=0.28,
        ),
        # ブレーキキャリパー（ブレンボ風レーシングレッド）
        "BrakeCaliper": create_pbr_material(
            "BrakeCaliper",
            base_color=(0.88, 0.04, 0.04, 1.0),
            metallic=0.35,
            roughness=0.20,
            coat_weight=0.75,
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


def add_slanted_strut(bm, p0: Vector, p1: Vector, width_x: float, depth_y: float, taper=0.85, mat_idx=0, smooth=True):
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


def add_cylinder(bm, center: Vector, radius: float, height: float, segments=24, axis="Z", mat_idx=0, smooth=True, cap_ends=True):
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


def add_hollow_tube_x(bm, center: Vector, r_outer: float, r_inner: float, width_x: float, segments=32, mat_idx=1, smooth=True):
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


def add_hollow_ring_y(bm, center: Vector, r_outer: float, r_inner: float, depth_y: float, segments=24, mat_idx=2, smooth=True):
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


def add_japanese_license_plate(bm, center: Vector, is_rear: bool, mat_trim: int, mat_white: int, mat_green: int, mat_chrome: int):
    """日本規格ナンバープレート（普通車 中板: 横 330mm × 縦 165mm）を白地＋緑文字レリーフ＋封印ボルト付きで造形"""
    dir_y = 1.0 if is_rear else -1.0
    # 1. ブラック樹脂ナンバーフレーム (342mm x 175mm)
    add_box(bm, center=center, size=Vector((0.342, 0.014, 0.175)), mat_idx=mat_trim, smooth=False)
    # 2. 日本の白ナンバープレート本体 (実寸 330mm x 165mm)
    plate_y = center.y + dir_y * 0.004
    add_box(bm, center=Vector((center.x, plate_y, center.z)), size=Vector((0.330, 0.012, 0.165)), mat_idx=mat_white, smooth=False)

    # 3. 緑文字レリーフ（上部：地名「千代田 330」、下部左：ひらがな「す」、下部中央：ハイフン、下部4桁数字「40-00」）
    char_y = center.y + dir_y * 0.010
    # 上段：地名＆分類番号バー
    add_box(bm, center=Vector((center.x - 0.045, char_y, center.z + 0.042)), size=Vector((0.075, 0.004, 0.028)), mat_idx=mat_green)
    add_box(bm, center=Vector((center.x + 0.050, char_y, center.z + 0.042)), size=Vector((0.070, 0.004, 0.028)), mat_idx=mat_green)
    # 下段左：ひらがな
    add_box(bm, center=Vector((center.x - 0.118, char_y, center.z - 0.022)), size=Vector((0.026, 0.004, 0.036)), mat_idx=mat_green)
    # 下段4桁大型ナンバー + ハイフン
    for dx in [-0.068, -0.024, 0.046, 0.092]:
        add_box(bm, center=Vector((center.x + dx, char_y, center.z - 0.022)), size=Vector((0.030, 0.004, 0.062)), mat_idx=mat_green)
    add_box(bm, center=Vector((center.x + 0.011, char_y, center.z - 0.022)), size=Vector((0.018, 0.004, 0.010)), mat_idx=mat_green)

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
    """車両のロアボディ（Y=-2.26m フロントノーズ 〜 Y=+2.21m リアテール）をロフト曲面として生成"""
    stations = [
        (-2.26, 0.72, 0.78, 0.68, 0.23, 0.35, 0.46, 0.49),  # 0: フロントノーズ最先端
        (-2.12, 0.82, 0.88, 0.78, 0.21, 0.40, 0.55, 0.59),  # 1: ヘッドライト・グリル上縁
        (-1.82, 0.87, 0.94, 0.85, 0.21, 0.46, 0.69, 0.73),  # 2: 前輪アーチ前方
        (-1.38, 0.82, 0.96, 0.89, 0.36, 0.58, 0.80, 0.83),  # 3: 前輪ホイールアーチ頂部
        (-0.96, 0.88, 0.96, 0.88, 0.21, 0.50, 0.84, 0.87),  # 4: カウル・Aピラー根元
        (-0.35, 0.89, 0.95, 0.87, 0.20, 0.50, 0.85, 0.85),  # 5: フロントドア中央
        (0.35, 0.89, 0.95, 0.87, 0.20, 0.51, 0.86, 0.86),   # 6: Bピラー・リアドア
        (0.95, 0.90, 0.98, 0.89, 0.21, 0.53, 0.88, 0.88),   # 7: リアフェンダー前縁
        (1.38, 0.82, 0.98, 0.90, 0.36, 0.60, 0.90, 0.89),   # 8: 後輪ホイールアーチ頂部
        (1.78, 0.88, 0.95, 0.85, 0.24, 0.54, 0.88, 0.89),   # 9: リアデッキ・トランク
        (2.10, 0.83, 0.89, 0.79, 0.27, 0.54, 0.86, 0.88),   # 10: ダックテールスポイラー縁
        (2.21, 0.76, 0.82, 0.73, 0.29, 0.52, 0.78, 0.80),   # 11: リアバンパー後端
    ]

    profile_rings = []
    for y, wb, wm, wt, zb, zm, zt, zc in stations:
        ring = [
            bm.verts.new(Vector((-wb * 0.5, y, zb))),
            bm.verts.new(Vector((-wb, y, zb + 0.03))),
            bm.verts.new(Vector((-wm, y, zm))),
            bm.verts.new(Vector((-wt, y, zt))),
            bm.verts.new(Vector((-wt * 0.38, y, zc))),
            bm.verts.new(Vector((wt * 0.38, y, zc))),
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
            f.smooth = True

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


def build_curved_roof_and_pillars(bm):
    """滑らかなアーチを描くルーフ天板〜ファストバックCピラー・A/Bピラー・リアウィンドウを構築
    mat_idx: 0=BodyPaint, 1=BlackTrim, 3=WindowGlass"""
    roof_stations = [
        (-0.50, 0.66, 1.40, 1.43),
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

    # 左右の傾斜Aピラー・Bピラー・ファストバックCピラー
    for side in [-1.0, 1.0]:
        add_slanted_strut(
            bm,
            p0=Vector((side * 0.74, -1.26, 0.86)),
            p1=Vector((side * 0.65, -0.48, 1.40)),
            width_x=0.052,
            depth_y=0.072,
            taper=0.82,
            mat_idx=1,  # 車内側から見たときに反射しすぎないようサテンブラックピラー仕上げ
            smooth=False,
        )
        add_slanted_strut(
            bm,
            p0=Vector((side * 0.80, 0.22, 0.85)),
            p1=Vector((side * 0.66, 0.26, 1.42)),
            width_x=0.042,
            depth_y=0.088,
            taper=0.88,
            mat_idx=1,
            smooth=False,
        )
        add_slanted_strut(
            bm,
            p0=Vector((side * 0.76, 1.72, 0.89)),
            p1=Vector((side * 0.63, 0.70, 1.365)),
            width_x=0.075,
            depth_y=0.18,
            taper=0.75,
            mat_idx=0,
            smooth=True,
        )

    # 3D曲面ファストバックリアガラス
    rw_stations = [
        (0.70, 0.61, 1.360, 1.385),
        (1.04, 0.65, 1.215, 1.235),
        (1.38, 0.69, 1.055, 1.070),
        (1.74, 0.73, 0.890, 0.900),
    ]
    rw_rows = []
    for y, hw, zs, zm in rw_stations:
        rw_rows.append([
            bm.verts.new(Vector((-hw, y, zs))),
            bm.verts.new(Vector((-hw * 0.4, y, zm))),
            bm.verts.new(Vector((hw * 0.4, y, zm))),
            bm.verts.new(Vector((hw, y, zs))),
        ])
    for r_i in range(len(rw_rows) - 1):
        row0 = rw_rows[r_i]
        row1 = rw_rows[r_i + 1]
        for c_i in range(3):
            f_rw = bm.faces.new([row0[c_i], row0[c_i + 1], row1[c_i + 1], row1[c_i]])
            f_rw.material_index = 3  # WindowGlass
            f_rw.smooth = True


def build_chassis(materials) -> bpy.types.Object:
    """JDM 外装エアロボディ (Chassis) をモデリング"""
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

    # 3. 曲面ルーフ＆傾斜ピラー＆リアガラス
    build_curved_roof_and_pillars(bm)

    # 4. サイドスカート＆ドアハンドル
    for side in [-1.0, 1.0]:
        add_box(
            bm,
            center=Vector((side * 0.91, 0.0, 0.21)),
            size=Vector((0.05, 1.88, 0.045)),
            mat_idx=1,
            smooth=False,
        )
        for door_y in [-0.15, 0.55]:
            add_box(
                bm,
                center=Vector((side * 0.955, door_y, 0.77)),
                size=Vector((0.018, 0.15, 0.026)),
                mat_idx=2,
                smooth=False,
            )

    # 5. フロントフェイス（JDM Vモーショングリル + 日本ナンバープレート + シャープLEDヘッドライト）
    splitter_verts = [
        Vector((-0.74, -2.29, 0.19)),
        Vector((0.74, -2.29, 0.19)),
        Vector((0.86, -2.08, 0.19)),
        Vector((-0.86, -2.08, 0.19)),
        Vector((-0.73, -2.27, 0.23)),
        Vector((0.73, -2.27, 0.23)),
        Vector((0.86, -2.08, 0.23)),
        Vector((-0.86, -2.08, 0.23)),
    ]
    add_hexahedron(bm, splitter_verts, mat_idx=1, smooth=False)

    # JDM メッシュグリル＆クローム V シグネチャー＆フロントエンブレム
    add_box(bm, center=Vector((0.0, -2.25, 0.37)), size=Vector((0.96, 0.06, 0.20)), mat_idx=1)
    add_box(bm, center=Vector((0.0, -2.275, 0.43)), size=Vector((0.12, 0.02, 0.045)), mat_idx=2)
    # フロント日本規格ナンバープレート (330mm x 165mm)
    add_japanese_license_plate(
        bm,
        center=Vector((0.0, -2.28, 0.30)),
        is_rear=False,
        mat_trim=1,
        mat_white=6,
        mat_green=7,
        mat_chrome=2,
    )

    # 左右ラップアラウンドLEDヘッドライト＆コーナーインテーク
    for side in [-1.0, 1.0]:
        x_in = side * 0.42
        x_out = side * 0.83
        if side < 0:
            hl_verts = [
                Vector((x_out, -2.14, 0.52)),
                Vector((x_in, -2.27, 0.48)),
                Vector((x_in, -2.12, 0.52)),
                Vector((x_out, -1.96, 0.56)),
                Vector((x_out * 0.96, -2.10, 0.61)),
                Vector((x_in, -2.24, 0.56)),
                Vector((x_in, -2.08, 0.61)),
                Vector((x_out * 0.96, -1.92, 0.65)),
            ]
        else:
            hl_verts = [
                Vector((x_in, -2.27, 0.48)),
                Vector((x_out, -2.14, 0.52)),
                Vector((x_out, -1.96, 0.56)),
                Vector((x_in, -2.12, 0.52)),
                Vector((x_in, -2.24, 0.56)),
                Vector((x_out * 0.96, -2.10, 0.61)),
                Vector((x_out * 0.96, -1.92, 0.65)),
                Vector((x_in, -2.08, 0.61)),
            ]
        add_hexahedron(bm, hl_verts, mat_idx=4, smooth=False)
        add_box(bm, center=Vector((side * 0.64, -2.19, 0.33)), size=Vector((0.24, 0.08, 0.13)), mat_idx=1)

    # 6. JDM リアフェイス（伝統の丸型4灯リングLEDテールランプ + 日本ナンバープレート + ダックテール）
    # カーボンダックテールリアスポイラー
    add_box(bm, center=Vector((0.0, 2.13, 0.905)), size=Vector((1.44, 0.11, 0.042)), mat_idx=1, smooth=False)
    # リアガーニッシュパネル（丸型4灯を際立たせるブラックトリムハウジング）
    add_box(bm, center=Vector((0.0, 2.215, 0.745)), size=Vector((1.48, 0.035, 0.135)), mat_idx=1, smooth=False)
    # センター JDM クロームエンブレムバッジ
    add_box(bm, center=Vector((0.0, 2.23, 0.825)), size=Vector((0.11, 0.018, 0.036)), mat_idx=2, smooth=False)
    add_box(bm, center=Vector((0.62, 2.23, 0.64)), size=Vector((0.09, 0.015, 0.024)), mat_idx=2, smooth=False)

    # 象徴的な丸型4灯リング LED テールランプ（GT-R / SKYLINE 400R スタイル：外側大径リング r=0.058m + 内側リング r=0.048m）
    for side in [-1.0, 1.0]:
        # 外側リング（大径）
        add_hollow_ring_y(
            bm,
            center=Vector((side * 0.63, 2.232, 0.750)),
            r_outer=0.058,
            r_inner=0.034,
            depth_y=0.028,
            segments=24,
            mat_idx=5,
            smooth=True,
        )
        # 内側リング（中径）
        add_hollow_ring_y(
            bm,
            center=Vector((side * 0.47, 2.232, 0.742)),
            r_outer=0.048,
            r_inner=0.028,
            depth_y=0.028,
            segments=24,
            mat_idx=5,
            smooth=True,
        )
        # リアバンパー下部リフレクター
        add_box(bm, center=Vector((side * 0.64, 2.225, 0.39)), size=Vector((0.20, 0.030, 0.024)), mat_idx=5)

    # ハイマウントストップランプ（リアガラス上端）
    add_box(bm, center=Vector((0.0, 0.74, 1.365)), size=Vector((0.46, 0.04, 0.022)), mat_idx=5)

    # リアナンバープレートガーニッシュ＆日本規格ナンバープレート（330mm x 165mm、白地＋緑文字レリーフ＋左上の封印）
    add_box(bm, center=Vector((0.0, 2.215, 0.545)), size=Vector((0.66, 0.035, 0.195)), mat_idx=1)
    add_japanese_license_plate(
        bm,
        center=Vector((0.0, 2.232, 0.545)),
        is_rear=True,
        mat_trim=1,
        mat_white=6,
        mat_green=7,
        mat_chrome=2,
    )

    # リアアンダーディフューザー＆4連バーティカルフィン
    add_box(bm, center=Vector((0.0, 2.19, 0.29)), size=Vector((1.50, 0.12, 0.12)), mat_idx=1)
    for fin_x in [-0.34, -0.11, 0.11, 0.34]:
        add_box(bm, center=Vector((fin_x, 2.22, 0.27)), size=Vector((0.022, 0.14, 0.12)), mat_idx=1)

    # クアッド（左右4本出し）大径エキゾーストマフラーカッター
    for ex_x in [-0.58, -0.46, 0.46, 0.58]:
        add_cylinder(
            bm,
            center=Vector((ex_x, 2.23, 0.28)),
            radius=0.044,
            height=0.12,
            segments=20,
            axis="Y",
            mat_idx=2,
            smooth=True,
        )
        add_cylinder(
            bm,
            center=Vector((ex_x, 2.24, 0.28)),
            radius=0.033,
            height=0.11,
            segments=16,
            axis="Y",
            mat_idx=1,
            smooth=False,
        )

    # 7. Aピラー根元ガセット＆流線型エアロドアミラー
    # Why Aピラー根元 Y=-1.04m に配置し smooth=False にするか:
    # 直方体に smooth=True をかけると頂点法線が平均化されて太陽光で不自然な青い光点が生じるため、
    # フラットシェーディングの楔形エアロハウジングとし、ドライバー視点で窓外の正しい位置にミラー鏡面が見えるようにする。
    for side in [-1.0, 1.0]:
        # Aピラー根元の三角ミラーガセットプレート（窓の前端コーナーを隙間なく塞ぐ）
        add_box(
            bm,
            center=Vector((side * 0.78, -1.12, 0.89)),
            size=Vector((0.07, 0.22, 0.09)),
            mat_idx=1,
            smooth=False,
        )
        # ドアから斜め上外側へ伸びるミラーステー
        add_slanted_strut(
            bm,
            p0=Vector((side * 0.82, -1.04, 0.87)),
            p1=Vector((side * 0.91, -1.00, 0.92)),
            width_x=0.07,
            depth_y=0.045,
            taper=0.85,
            mat_idx=1,
            smooth=False,
        )
        # 流線型エアロミラーハウジング（車体色、角の光点が出ないよう smooth=False）
        x_in = side * 0.88
        x_out = side * 1.01
        if side < 0:
            mirror_verts = [
                Vector((x_out, -0.97, 0.90)),
                Vector((x_in, -1.03, 0.90)),
                Vector((x_in, -0.95, 0.90)),
                Vector((x_out, -0.93, 0.90)),
                Vector((x_out * 0.98, -0.97, 0.965)),
                Vector((x_in, -1.02, 0.968)),
                Vector((x_in, -0.95, 0.968)),
                Vector((x_out * 0.98, -0.93, 0.965)),
            ]
        else:
            mirror_verts = [
                Vector((x_in, -1.03, 0.90)),
                Vector((x_out, -0.97, 0.90)),
                Vector((x_out, -0.93, 0.90)),
                Vector((x_in, -0.95, 0.90)),
                Vector((x_in, -1.02, 0.968)),
                Vector((x_out * 0.98, -0.97, 0.965)),
                Vector((x_out * 0.98, -0.93, 0.965)),
                Vector((x_in, -0.95, 0.968)),
            ]
        add_hexahedron(bm, mirror_verts, mat_idx=0, smooth=False)
        # ドライバー側（後方 +Y）を向いたブラックインナーベゼル＆防眩ミラーガラス面
        add_box(
            bm,
            center=Vector((side * 0.945, -0.938, 0.934)),
            size=Vector((0.125, 0.012, 0.062)),
            mat_idx=1,
            smooth=False,
        )
        add_box(
            bm,
            center=Vector((side * 0.945, -0.931, 0.934)),
            size=Vector((0.112, 0.006, 0.050)),
            mat_idx=8,  # MirrorGlass
            smooth=False,
        )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("Chassis", mesh)
    for k in mat_keys:
        obj.data.materials.append(materials[k])

    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_interior(materials) -> bpy.types.Object:
    """日本の右ハンドル（RHD: X = -0.38m）専用コックピット内装 (Interior) をモデリング
    ドライバー視点カメラ (X=-0.38m, Y_blender=-0.06m, Z_blender=1.13m) から見て、
    - ステアリングの奥に中空クロームリングの2連メーター（タコ＆スピード、赤い指針、シアン目盛り）
    - ステアリングコラムの右側に JIS 規格のウインカーレバー、左側にワイパーレバー
    - 左側（中央 X=0.0m）にベゼル付きカーナビ画面（ルート表示）、エアコン吹き出し口、ハザードボタン、シフトノブ、赤いスタートボタン
    - 右側（X=-0.78m）にドア内張りトリム・アームレストが隙間なく繋がる本格日本車コックピット。
    """
    mesh = bpy.data.meshes.new("InteriorMesh")
    bm = bmesh.new()

    # 0: InteriorDark, 1: InteriorSeat, 2: MeterBack, 3: DashboardScreen, 4: GaugeNeedleRed, 5: Chrome
    mat_keys = [
        "InteriorDark",
        "InteriorSeat",
        "MeterBack",
        "DashboardScreen",
        "GaugeNeedleRed",
        "Chrome",
    ]

    # 0. キャビンフロア＆左右インナードアトリム・ドアアームレスト・ウインドウスイッチパネル
    add_box(bm, center=Vector((0.0, 0.25, 0.36)), size=Vector((1.58, 2.30, 0.08)), mat_idx=0)
    for side in [-1.0, 1.0]:
        # ドア内張りロア〜アッパーパネル（ダッシュボード端 Y=-0.95 からリアまで隙間なく連続）
        add_box(bm, center=Vector((side * 0.79, 0.05, 0.62)), size=Vector((0.11, 2.30, 0.46)), mat_idx=0, smooth=False)
        # ドアショルダーパッド（ベルトライン Z=0.855：外装と段差なく接続）
        add_box(bm, center=Vector((side * 0.78, -0.25, 0.855)), size=Vector((0.09, 1.75, 0.045)), mat_idx=1, smooth=False)
        # ドアアームレスト＆シルバースイッチベゼル
        add_box(bm, center=Vector((side * 0.73, -0.22, 0.71)), size=Vector((0.075, 0.58, 0.045)), mat_idx=1, smooth=False)
        add_box(bm, center=Vector((side * 0.73, -0.38, 0.735)), size=Vector((0.045, 0.14, 0.012)), mat_idx=5, smooth=False)

    # 1. 立体ダッシュボード本体 & カウルディープシェルフ（フロントガラス下端 Y=-1.26 まで隙間なく埋める）
    add_box(bm, center=Vector((0.0, -0.96, 0.845)), size=Vector((1.54, 0.62, 0.06)), mat_idx=0, smooth=False)
    add_box(bm, center=Vector((0.0, -0.76, 0.74)), size=Vector((1.54, 0.44, 0.24)), mat_idx=0, smooth=False)
    # 助手席側（左側 X > 0）ダッシュボードソフトパッドトリム＆エアコンルーバー
    add_box(bm, center=Vector((0.44, -0.63, 0.84)), size=Vector((0.52, 0.08, 0.07)), mat_idx=1, smooth=False)
    add_box(bm, center=Vector((0.44, -0.588, 0.84)), size=Vector((0.48, 0.01, 0.012)), mat_idx=5, smooth=False)
    add_box(bm, center=Vector((0.64, -0.62, 0.84)), size=Vector((0.11, 0.04, 0.048)), mat_idx=0, smooth=False)
    # 右ハンドル運転席右端（X = -0.64m）のエアコン吹き出し口＆クロームフィン
    add_box(bm, center=Vector((-0.63, -0.62, 0.86)), size=Vector((0.11, 0.04, 0.052)), mat_idx=0, smooth=False)
    add_box(bm, center=Vector((-0.63, -0.598, 0.86)), size=Vector((0.09, 0.01, 0.010)), mat_idx=5, smooth=False)

    # 2. 右ハンドル運転席 (X = -0.38m) 立体メーターフード（バイザー）＆中空リング2連メータークラスター
    # メーターフード天板＆左右サイドバイザー（ステアリング上部開口から綺麗に見える高さ Z=1.00m）
    add_box(bm, center=Vector((-0.38, -0.64, 1.002)), size=Vector((0.36, 0.18, 0.024)), mat_idx=0, smooth=False)
    add_box(bm, center=Vector((-0.55, -0.64, 0.935)), size=Vector((0.024, 0.16, 0.13)), mat_idx=0, smooth=False)
    add_box(bm, center=Vector((-0.21, -0.64, 0.935)), size=Vector((0.024, 0.16, 0.13)), mat_idx=0, smooth=False)

    # メータークラスター背面ダークパネル（単なる青い箱にならないよう黒紺ベース `MeterBack` を使う）
    add_box(bm, center=Vector((-0.38, -0.655, 0.935)), size=Vector((0.33, 0.018, 0.115)), mat_idx=2, smooth=False)

    # 中央マルチインフォメーションディスプレイ（車速・ギア表示部のシャープなシアン発光アクセント）
    add_box(bm, center=Vector((-0.38, -0.642, 0.945)), size=Vector((0.052, 0.008, 0.058)), mat_idx=3, smooth=False)
    add_box(bm, center=Vector((-0.38, -0.639, 0.962)), size=Vector((0.038, 0.006, 0.012)), mat_idx=4, smooth=False)

    # 左右2連メーター（右 X=-0.455m: タコメーター / 左 X=-0.305m: スピードメーター）
    # ※中空リング `add_hollow_ring_y` を使うため、以前のように黒い円柱で画面を塞がない！
    for idx, gauge_x in enumerate([-0.455, -0.305]):
        # 中空クロームベゼルリング
        add_hollow_ring_y(
            bm,
            center=Vector((gauge_x, -0.635, 0.935)),
            r_outer=0.044,
            r_inner=0.037,
            depth_y=0.016,
            segments=24,
            mat_idx=5,
            smooth=True,
        )
        # 内部のシアン発光スケールリング（中空リングの内側に細く光る目盛りリング）
        add_hollow_ring_y(
            bm,
            center=Vector((gauge_x, -0.641, 0.935)),
            r_outer=0.035,
            r_inner=0.030,
            depth_y=0.008,
            segments=24,
            mat_idx=3,
            smooth=True,
        )
        # センターキャップ
        add_cylinder(
            bm,
            center=Vector((gauge_x, -0.638, 0.935)),
            radius=0.007,
            height=0.010,
            segments=12,
            axis="Y",
            mat_idx=5,
            smooth=False,
        )
        # JDM スポーツレッド発光指針（タコメーターは右上斜め、スピードメーターは左上斜めを指す）
        needle_dx = -0.018 if idx == 0 else 0.016
        needle_dz = 0.020 if idx == 0 else 0.018
        add_slanted_strut(
            bm,
            p0=Vector((gauge_x, -0.637, 0.935)),
            p1=Vector((gauge_x + needle_dx, -0.637, 0.935 + needle_dz)),
            width_x=0.004,
            depth_y=0.005,
            taper=0.5,
            mat_idx=4,
            smooth=False,
        )

    # 3. ステアリングコラム＆日本車（JIS規格・右ハンドル）専用の右ウインカーレバー・左ワイパーレバー
    add_box(bm, center=Vector((-0.38, -0.53, 0.885)), size=Vector((0.10, 0.18, 0.075)), mat_idx=0, smooth=False)
    # 右ウインカーレバー（日本の右ハンドル車はステアリングコラム右側 X = -0.43..-0.54m にウインカーレバーがある！）
    add_slanted_strut(
        bm,
        p0=Vector((-0.42, -0.50, 0.895)),
        p1=Vector((-0.535, -0.48, 0.925)),
        width_x=0.016,
        depth_y=0.016,
        taper=1.15,
        mat_idx=0,
        smooth=False,
    )
    add_box(bm, center=Vector((-0.542, -0.48, 0.927)), size=Vector((0.022, 0.018, 0.018)), mat_idx=5, smooth=False)

    # 左ワイパーレバー（日本の右ハンドル車はステアリングコラム左側 X = -0.33..-0.22m にワイパーレバーがある！）
    add_slanted_strut(
        bm,
        p0=Vector((-0.34, -0.50, 0.895)),
        p1=Vector((-0.225, -0.48, 0.925)),
        width_x=0.016,
        depth_y=0.016,
        taper=1.15,
        mat_idx=0,
        smooth=False,
    )
    add_box(bm, center=Vector((-0.218, -0.48, 0.927)), size=Vector((0.022, 0.018, 0.018)), mat_idx=5, smooth=False)

    # 4. センターコンソールエアコン吹き出し口＆ハザードスイッチ台座（上部のフローティング11インチナビ画面は Three.js CanvasTexture 側で高精細描画）
    add_box(bm, center=Vector((-0.135, -0.60, 0.855)), size=Vector((0.20, 0.04, 0.036)), mat_idx=0, smooth=False)
    add_box(bm, center=Vector((-0.135, -0.58, 0.855)), size=Vector((0.024, 0.008, 0.020)), mat_idx=4, smooth=False)

    # センターコンソールトンネル＆シフトゲート＆右ハンドル車配置のシフトノブ・赤いエンジンスターターボタン
    add_box(bm, center=Vector((0.0, -0.05, 0.52)), size=Vector((0.28, 1.18, 0.28)), mat_idx=0, smooth=False)
    add_box(bm, center=Vector((0.0, -0.32, 0.665)), size=Vector((0.22, 0.36, 0.02)), mat_idx=5, smooth=False)
    # シフトブーツ＆シフトノブ（右ハンドル運転席側 X = -0.045m に寄せて配置）
    add_box(bm, center=Vector((-0.045, -0.28, 0.69)), size=Vector((0.075, 0.095, 0.045)), mat_idx=1, smooth=False)
    add_box(bm, center=Vector((-0.045, -0.28, 0.735)), size=Vector((0.042, 0.055, 0.055)), mat_idx=5, smooth=False)
    # 右ハンドル運転席側の赤い ENGINE START/STOP ボタン (X = -0.11m)
    add_cylinder(
        bm,
        center=Vector((-0.105, -0.38, 0.678)),
        radius=0.014,
        height=0.010,
        segments=16,
        axis="Z",
        mat_idx=4,
        smooth=False,
    )

    # 5. スリムなフレームレス風ルームミラー（フロントガラス上端中央 Y=-0.46, Z=1.34）
    add_box(bm, center=Vector((0.0, -0.46, 1.37)), size=Vector((0.016, 0.025, 0.055)), mat_idx=0)
    add_box(bm, center=Vector((0.0, -0.44, 1.335)), size=Vector((0.20, 0.020, 0.046)), mat_idx=0, smooth=False)

    # 6. スポーツバケットシート（右ハンドル運転席: X=-0.38, 助手席: X=+0.38）
    for seat_x in [-0.38, 0.38]:
        add_box(bm, center=Vector((seat_x, 0.18, 0.44)), size=Vector((0.48, 0.52, 0.16)), mat_idx=1, smooth=True)
        add_box(bm, center=Vector((seat_x, 0.42, 0.76)), size=Vector((0.46, 0.12, 0.52)), mat_idx=1, smooth=True)
        add_box(bm, center=Vector((seat_x - 0.21, 0.38, 0.74)), size=Vector((0.06, 0.16, 0.46)), mat_idx=1, smooth=True)
        add_box(bm, center=Vector((seat_x + 0.21, 0.38, 0.74)), size=Vector((0.06, 0.16, 0.46)), mat_idx=1, smooth=True)
        add_box(bm, center=Vector((seat_x, 0.45, 1.08)), size=Vector((0.22, 0.09, 0.16)), mat_idx=1, smooth=True)

    # 7. リアシート＆リアパーセルシェルフ
    add_box(bm, center=Vector((0.0, 1.05, 0.46)), size=Vector((1.38, 0.50, 0.20)), mat_idx=1, smooth=True)
    add_box(bm, center=Vector((0.0, 1.28, 0.74)), size=Vector((1.36, 0.14, 0.46)), mat_idx=1, smooth=True)
    add_box(bm, center=Vector((0.0, 1.52, 0.86)), size=Vector((1.34, 0.42, 0.06)), mat_idx=0)

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("Interior", mesh)
    for k in mat_keys:
        obj.data.materials.append(materials[k])

    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_steering_wheel(materials) -> bpy.types.Object:
    """実寸 360mm (外径 0.36m) ステアリングホイール (SteeringWheel) を右ハンドル運転席 (X=-0.38m) にモデリング"""
    mesh = bpy.data.meshes.new("SteeringWheelMesh")
    bm = bmesh.new()

    mat_keys = ["SteeringLeather", "Chrome", "GaugeNeedleRed"]

    center_r = 0.164
    tube_r = 0.016
    segs = 32
    tube_segs = 10

    ring_loops = []
    for i in range(segs):
        theta = (2.0 * math.pi * i) / segs
        cx = math.cos(theta) * center_r
        cz = math.sin(theta) * center_r
        if cz < -center_r * 0.80:
            cz = -center_r * 0.80

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
            f = bm.faces.new([ring_loops[i][j], ring_loops[i][nj], ring_loops[ni][nj], ring_loops[ni][j]])
            f.material_index = 0
            f.smooth = True

    add_cylinder(bm, center=Vector((0.0, 0.0, 0.0)), radius=0.058, height=0.034, segments=20, axis="Y", mat_idx=0, smooth=True)
    add_cylinder(bm, center=Vector((0.0, 0.018, 0.0)), radius=0.024, height=0.008, segments=16, axis="Y", mat_idx=1, smooth=True)

    # 3本メタリックスポーク + パドルシフト
    add_box(bm, center=Vector((-0.10, 0.0, -0.008)), size=Vector((0.10, 0.016, 0.026)), mat_idx=1, smooth=False)
    add_box(bm, center=Vector((0.10, 0.0, -0.008)), size=Vector((0.10, 0.016, 0.026)), mat_idx=1, smooth=False)
    add_box(bm, center=Vector((0.0, 0.0, -0.082)), size=Vector((0.030, 0.016, 0.09)), mat_idx=1, smooth=False)
    add_box(bm, center=Vector((-0.115, -0.028, 0.025)), size=Vector((0.018, 0.008, 0.075)), mat_idx=1, smooth=False)
    add_box(bm, center=Vector((0.115, -0.028, 0.025)), size=Vector((0.018, 0.008, 0.075)), mat_idx=1, smooth=False)

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("SteeringWheel", mesh)
    for k in mat_keys:
        obj.data.materials.append(materials[k])

    obj.location = Vector((-0.38, -0.44, 0.90))
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


def build_wiper(materials, name_suffix: str, pivot_loc: Vector, pivot_rot: Euler, parent_root: bpy.types.Object):
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


def build_wheel(materials, name: str, position: Vector, parent_root: bpy.types.Object) -> bpy.types.Object:
    """中空アウターリム + 10本立体ツインスポーク鍛造ホイール + ブレーキローター＆レッドキャリパーを作成"""
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    bm = bmesh.new()

    # 0: TireRubber, 1: WheelAlloy, 2: BrakeRotor, 3: BrakeCaliper, 4: BlackTrim
    mat_keys = ["TireRubber", "WheelAlloy", "BrakeRotor", "BrakeCaliper", "BlackTrim"]

    radius = 0.34
    width = 0.245
    rim_r = 0.24
    rim_inner_r = 0.216
    side_sign = 1.0 if position.x > 0 else -1.0

    # 1. ラウンドショルダータイヤ
    add_rounded_tire(bm, radius=radius, rim_r=rim_r, width=width, segments=32, mat_idx=0)

    # 2. 中空ホイールアウターリムバレル
    add_hollow_tube_x(
        bm,
        center=Vector((0.0, 0.0, 0.0)),
        r_outer=rim_r,
        r_inner=rim_inner_r,
        width_x=width * 0.84,
        segments=32,
        mat_idx=1,
        smooth=True,
    )

    # ホイール奥側のダークインナーバックプレート
    add_cylinder(
        bm,
        center=Vector((-side_sign * width * 0.32, 0.0, 0.0)),
        radius=rim_inner_r,
        height=0.02,
        segments=24,
        axis="X",
        mat_idx=4,
        smooth=False,
    )

    # 3. 10本ツインスポーク（V字ペア×5組）
    outer_x = side_sign * (width * 0.38)
    hub_x = side_sign * (width * 0.30)
    for pair_idx in range(5):
        base_angle = (2.0 * math.pi * pair_idx) / 5.0
        for sub_offset in [-0.15, 0.15]:
            s_angle = base_angle + sub_offset
            p_hub = Vector((hub_x, math.cos(s_angle * 0.96) * 0.055, math.sin(s_angle * 0.96) * 0.055))
            p_rim = Vector((outer_x, math.cos(s_angle) * (rim_inner_r * 1.02), math.sin(s_angle) * (rim_inner_r * 1.02)))

            tangent = Vector((0.0, -math.sin(s_angle), math.cos(s_angle))) * 0.015
            thick_x = Vector((0.018, 0.0, 0.0))
            spoke_verts = [
                p_hub - tangent - thick_x,
                p_hub + tangent - thick_x,
                p_hub + tangent + thick_x,
                p_hub - tangent + thick_x,
                p_rim - tangent * 0.82 - thick_x,
                p_rim + tangent * 0.82 - thick_x,
                p_rim + tangent * 0.82 + thick_x,
                p_rim - tangent * 0.82 + thick_x,
            ]
            add_hexahedron(bm, spoke_verts, mat_idx=1, smooth=False)

    # 4. センターロック風ハブキャップ
    add_cylinder(
        bm,
        center=Vector((hub_x + side_sign * 0.015, 0.0, 0.0)),
        radius=0.064,
        height=0.035,
        segments=20,
        axis="X",
        mat_idx=1,
        smooth=True,
    )

    # 5. スポークのすぐ奥に見える大径ブレーキローター & 6ポットレッドキャリパー
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
        ("Wheel_FR", Vector((0.86, -1.39, 0.34))),   # 前左 (助手席側)
        ("Wheel_RL", Vector((-0.86, 1.39, 0.34))),   # 後右
        ("Wheel_RR", Vector((0.86, 1.39, 0.34))),    # 後左
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

"""
Blender Procedural Modeling Script: 東京駅丸の内赤レンガ駅舎 (Tokyo Station Marunouchi Building)
Tokyo Station Deep Drive 用 3D アセット生成

建築仕様 (Project PLATEAU / 国土交通省 3D都市モデル仕様準拠):
- 中央棟 (Central Building): 幅50m, 奥行き24m, 高さ24m, 中央三角形ペディメント, 皇室貴賓エントランス庇
- 北ウィング棟 (North Wing): X=-85m, 幅110m, 奥行き20m, 高さ18m, 3階建て窓列・マンサード風スレート屋根
- 南ウィング棟 (South Wing): X=+85m, 幅110m, 奥行き20m, 高さ18m, 3階建て窓列・マンサード風スレート屋根
- 北八角形ドーム (North Dome): X=-145m, 8角形塔 (半径14m, 高さ24m) + 8角形ドーム屋根 (高さ14m, 酸化銅グリーン)
- 南八角形ドーム (South Dome): X=+145m, 8角形塔 (半径14m, 高さ24m) + 8角形ドーム屋根 (高さ14m, 酸化銅グリーン)
- 白御影石トリム (White Stone Trim): 赤レンガ壁面に水平に走る辰野金吾デザインの白帯装飾ストライプ

階層構造:
StationRoot (Empty)
├── CentralBuilding (メッシュ: 中央棟ファサード・ペディメント・エントランス)
├── NorthWing (メッシュ: 北ウィング棟・マンサード屋根)
├── SouthWing (メッシュ: 南ウィング棟・マンサード屋根)
├── NorthDome (メッシュ: 北八角形ドーム塔・酸化銅ドーム屋根)
├── SouthDome (メッシュ: 南八角形ドーム塔・酸化銅ドーム屋根)
└── FacadeDetails (メッシュ: 白帯ストライプ装飾帯、窓枠、コーニス)
"""

import bpy
import bmesh
import math
import os
from mathutils import Vector, Euler


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
    materials = {
        # 赤レンガ（深みのある赤褐色）
        "RedBrick": create_pbr_material(
            "RedBrick",
            base_color=(0.72, 0.11, 0.11, 1.0),
            roughness=0.85,
            metallic=0.05,
        ),
        # 白御影石トリム・花崗岩（白帯装飾）
        "WhiteStone": create_pbr_material(
            "WhiteStone",
            base_color=(0.94, 0.94, 0.95, 1.0),
            roughness=0.60,
            metallic=0.08,
        ),
        # 酸化銅グリーン屋根・ドーム
        "CopperRoof": create_pbr_material(
            "CopperRoof",
            base_color=(0.06, 0.46, 0.43, 1.0),
            roughness=0.45,
            metallic=0.40,
        ),
        # ダークスレート瓦屋根（中央・ウィング部）
        "SlateRoof": create_pbr_material(
            "SlateRoof",
            base_color=(0.18, 0.20, 0.23, 1.0),
            roughness=0.75,
            metallic=0.15,
        ),
        # 窓ガラス（低ラフネス・暗色反射）
        "WindowGlass": create_pbr_material(
            "WindowGlass",
            base_color=(0.10, 0.14, 0.20, 1.0),
            roughness=0.12,
            metallic=0.88,
        ),
        # ダークブロンズ（庇金具、鉄柵）
        "DarkBronze": create_pbr_material(
            "DarkBronze",
            base_color=(0.14, 0.12, 0.10, 1.0),
            roughness=0.55,
            metallic=0.70,
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
        (v0, v4, v5, v1),  # front (-Y: 丸の内広場側)
        (v2, v6, v7, v3),  # back (+Y: 八重洲側)
        (v0, v3, v7, v4),  # left (-X: 北側)
        (v1, v5, v6, v2),  # right (+X: 南側)
    ]
    created = []
    for f_verts in faces:
        f = bm.faces.new(f_verts)
        f.material_index = mat_idx
        created.append(f)
    return created


def add_polygon_prism(bm, center: Vector, radius_bot: float, radius_top: float, height: float, sides=8, mat_idx=0):
    """bmesh に多角柱（八角塔柱など）を追加"""
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

    # 側面フェース
    for i in range(sides):
        ni = (i + 1) % sides
        f = bm.faces.new([bot_verts[i], bot_verts[ni], top_verts[ni], top_verts[i]])
        f.material_index = mat_idx

    # 端面
    f_bot = bm.faces.new(list(reversed(bot_verts)))
    f_bot.material_index = mat_idx
    f_top = bm.faces.new(top_verts)
    f_top.material_index = mat_idx


def add_bell_dome(bm, center: Vector, radius: float, height: float, sides=8, rings=4, mat_idx=0):
    """八角形ベル型ドーム屋根を追加"""
    ring_verts = []

    for ri in range(rings + 1):
        ratio = ri / rings  # 0.0 (底面) -> 1.0 (頂点)
        z = center.z + height * ratio

        # ベル型の美しい曲率（膨らみから先端尖塔へ）
        r = radius * math.pow(math.cos(ratio * math.pi * 0.5), 0.65) if ratio < 1.0 else 0.05

        current_ring = []
        for si in range(sides):
            angle = (2.0 * math.pi * si) / sides + (math.pi / sides)
            x = center.x + math.cos(angle) * r
            y = center.y + math.sin(angle) * r
            current_ring.append(bm.verts.new(Vector((x, y, z))))
        ring_verts.append(current_ring)

    # リング間フェース
    for ri in range(rings):
        r0 = ring_verts[ri]
        r1 = ring_verts[ri + 1]
        for si in range(sides):
            nsi = (si + 1) % sides
            f = bm.faces.new([r0[si], r0[nsi], r1[nsi], r1[si]])
            f.material_index = mat_idx

    # 頂点フィニアル（尖塔飾り）
    v_tip = bm.verts.new(Vector((center.x, center.y, center.z + height + 2.5)))
    top_ring = ring_verts[-1]
    for si in range(sides):
        nsi = (si + 1) % sides
        f = bm.faces.new([top_ring[si], top_ring[nsi], v_tip])
        f.material_index = mat_idx


def build_central_building(materials) -> bpy.types.Object:
    """中央棟（皇居正対中央部）をモデリング"""
    mesh = bpy.data.meshes.new("CentralBuildingMesh")
    bm = bmesh.new()

    # 0: RedBrick, 1: WhiteStone, 2: SlateRoof, 3: WindowGlass, 4: DarkBronze
    mat_keys = ["RedBrick", "WhiteStone", "SlateRoof", "WindowGlass", "DarkBronze"]

    w, d, h = 50.0, 24.0, 22.0

    # 1. 中央棟メイン躯体 (幅50m, 奥行き24m, 高さ22m)
    add_box(bm, center=Vector((0.0, 0.0, h * 0.5)), size=Vector((w, d, h)), mat_idx=0)

    # 2. 中央ペディメント（大三角形切妻装飾: 幅18m, 奥行き1.2m, 高さ7m）
    # 正面壁のZ=22mから頂点Z=29m
    ped_w, ped_h = 18.0, 7.0
    v_bl = bm.verts.new(Vector((-ped_w * 0.5, -d * 0.5 - 0.2, h)))
    v_br = bm.verts.new(Vector((ped_w * 0.5, -d * 0.5 - 0.2, h)))
    v_top = bm.verts.new(Vector((0.0, -d * 0.5 - 0.2, h + ped_h)))
    v_bl_b = bm.verts.new(Vector((-ped_w * 0.5, -d * 0.5 + 2.0, h)))
    v_br_b = bm.verts.new(Vector((ped_w * 0.5, -d * 0.5 + 2.0, h)))
    v_top_b = bm.verts.new(Vector((0.0, -d * 0.5 + 2.0, h + ped_h)))

    f_front = bm.faces.new([v_bl, v_br, v_top])
    f_front.material_index = 1
    f_left = bm.faces.new([v_bl, v_top, v_top_b, v_bl_b])
    f_left.material_index = 1
    f_right = bm.faces.new([v_br, v_br_b, v_top_b, v_top])
    f_right.material_index = 1

    # 3. 中央スレート屋根（ピラミッド/マンサード風屋根）
    roof_h = 8.0
    add_box(bm, center=Vector((0.0, 0.0, h + roof_h * 0.5)), size=Vector((w * 0.94, d * 0.88, roof_h)), mat_idx=2)

    # 4. 正面貴賓エントランス大庇（皇室車寄せポーティコ: 幅14m, 奥行き6m, 高さ5m）
    add_box(bm, center=Vector((0.0, -d * 0.5 - 3.0, 4.8)), size=Vector((14.0, 6.0, 0.6)), mat_idx=1)
    # 車寄せの柱4本
    for col_x in [-6.0, -2.0, 2.0, 6.0]:
        add_box(bm, center=Vector((col_x, -d * 0.5 - 5.5, 2.2)), size=Vector((0.8, 0.8, 4.5)), mat_idx=1)

    # 5. 中央大時計塔・丸窓（ペディメント下部）
    add_box(bm, center=Vector((0.0, -d * 0.5 - 0.15, 17.5)), size=Vector((3.5, 0.2, 3.5)), mat_idx=1)

    # 6. 中央ファサードの窓列（正面アーチ窓・矩形窓）
    for floor_y in [5.5, 11.0, 16.5]:
        for wx in [-18.0, -12.0, -6.0, 6.0, 12.0, 18.0]:
            add_box(bm, center=Vector((wx, -d * 0.5 - 0.1, floor_y)), size=Vector((2.2, 0.2, 3.2)), mat_idx=3)

    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("CentralBuilding", mesh)
    for k in mat_keys:
        obj.data.materials.append(materials[k])

    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_wing(materials, name: str, center_x: float) -> bpy.types.Object:
    """南北ウィング棟をモデリング"""
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    bm = bmesh.new()

    # 0: RedBrick, 1: WhiteStone, 2: SlateRoof, 3: WindowGlass
    mat_keys = ["RedBrick", "WhiteStone", "SlateRoof", "WindowGlass"]

    w, d, h = 110.0, 20.0, 18.0

    # 1. ウィング棟メイン躯体 (幅110m, 奥行き20m, 高さ18m)
    add_box(bm, center=Vector((center_x, 0.0, h * 0.5)), size=Vector((w, d, h)), mat_idx=0)

    # 2. スレートマンサード屋根 (高さ6m)
    roof_h = 6.0
    add_box(bm, center=Vector((center_x, 0.0, h + roof_h * 0.5)), size=Vector((w * 0.98, d * 0.88, roof_h)), mat_idx=2)

    # 3. 窓列（3階層 × 各階約16窓）
    window_count = 14
    step_x = (w - 14.0) / (window_count - 1)
    start_x = center_x - (w - 14.0) * 0.5

    for fi, floor_z in enumerate([4.5, 9.5, 14.5]):
        win_h = 2.6 if fi < 2 else 2.2
        for wi in range(window_count):
            wx = start_x + wi * step_x
            # 窓本体（ガラス）
            add_box(bm, center=Vector((wx, -d * 0.5 - 0.1, floor_z)), size=Vector((2.0, 0.2, win_h)), mat_idx=3)
            # 窓上の白御影石アーチキーストーン装飾
            add_box(
                bm,
                center=Vector((wx, -d * 0.5 - 0.15, floor_z + win_h * 0.5 + 0.3)),
                size=Vector((2.4, 0.25, 0.45)),
                mat_idx=1,
            )

    # 4. 屋根上のドーマー窓（屋根小窓）
    dormer_count = 10
    dormer_step = (w - 20.0) / (dormer_count - 1)
    dormer_start = center_x - (w - 20.0) * 0.5
    for di in range(dormer_count):
        dx = dormer_start + di * dormer_step
        add_box(bm, center=Vector((dx, -d * 0.5 + 1.2, h + 2.0)), size=Vector((1.8, 1.8, 2.0)), mat_idx=1)
        add_box(bm, center=Vector((dx, -d * 0.5 + 0.2, h + 2.0)), size=Vector((1.2, 0.2, 1.4)), mat_idx=3)

    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new(name, mesh)
    for k in mat_keys:
        obj.data.materials.append(materials[k])

    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_octagonal_dome(materials, name: str, center_x: float) -> bpy.types.Object:
    """南北八角形ドーム塔＆ドーム屋根をモデリング"""
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    bm = bmesh.new()

    # 0: RedBrick, 1: WhiteStone, 2: CopperRoof, 3: WindowGlass
    mat_keys = ["RedBrick", "WhiteStone", "CopperRoof", "WindowGlass"]

    tower_r = 14.5
    tower_h = 24.0
    dome_h = 14.0

    # 1. 八角形レンガ塔本体 (底面半径14.5m, 高さ24m)
    add_polygon_prism(
        bm,
        center=Vector((center_x, 0.0, tower_h * 0.5)),
        radius_bot=tower_r,
        radius_top=tower_r * 0.98,
        height=tower_h,
        sides=8,
        mat_idx=0,
    )

    # 2. 塔上部コーニス・白御影石パラペット帯
    add_polygon_prism(
        bm,
        center=Vector((center_x, 0.0, tower_h + 0.6)),
        radius_bot=tower_r * 1.04,
        radius_top=tower_r * 1.06,
        height=1.4,
        sides=8,
        mat_idx=1,
    )

    # 3. 酸化銅グリーン八角形ベル型ドーム屋根 (高さ14m)
    add_bell_dome(
        bm,
        center=Vector((center_x, 0.0, tower_h + 1.2)),
        radius=tower_r * 1.02,
        height=dome_h,
        sides=8,
        rings=5,
        mat_idx=2,
    )

    # 4. ドーム下部の八角形アーチ窓群 (各面2階層のアーチ窓)
    for side_idx in range(8):
        angle = (2.0 * math.pi * side_idx) / 8.0 + (math.pi / 8.0)
        face_dir = Vector((math.cos(angle), math.sin(angle), 0.0))
        dist = tower_r * 0.98

        # 3階高窓
        win_pos = Vector((center_x, 0.0, 17.5)) + face_dir * dist
        add_box(bm, center=win_pos, size=Vector((2.2, 0.3, 3.8)), mat_idx=3)
        add_box(bm, center=win_pos + Vector((0, 0, 2.2)), size=Vector((2.6, 0.4, 0.6)), mat_idx=1)

        # 2階窓
        win_pos2 = Vector((center_x, 0.0, 11.0)) + face_dir * dist
        add_box(bm, center=win_pos2, size=Vector((2.0, 0.3, 3.2)), mat_idx=3)

    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new(name, mesh)
    for k in mat_keys:
        obj.data.materials.append(materials[k])

    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_facade_details(materials) -> bpy.types.Object:
    """全棟にわたる白御影石ストライプ化粧帯（白帯装飾）およびコーニスをモデリング"""
    mesh = bpy.data.meshes.new("FacadeDetailsMesh")
    bm = bmesh.new()

    # マテリアル: WhiteStone
    # 全長約330mにわたって水平に走る白帯ストライプ帯（Z = 2.0m, 6.5m, 11.5m, 16.5m, 18.0m）
    stripe_heights = [2.0, 6.5, 11.5, 16.5, 18.0]

    for sz in stripe_heights:
        # 中央棟部分 (幅50.6m, 奥行き24.4m)
        add_box(bm, center=Vector((0.0, 0.0, sz)), size=Vector((50.8, 24.6, 0.55)), mat_idx=0)

        # 北ウィング部分 (X=-85m, 幅110.6m, 奥行き20.4m)
        add_box(bm, center=Vector((-85.0, 0.0, sz)), size=Vector((110.8, 20.6, 0.50)), mat_idx=0)

        # 南ウィング部分 (X=+85m, 幅110.6m, 奥行き20.4m)
        add_box(bm, center=Vector((85.0, 0.0, sz)), size=Vector((110.8, 20.6, 0.50)), mat_idx=0)

    # 1階腰壁基壇部（Plinth: 御影石の土台）
    add_box(bm, center=Vector((0.0, 0.0, 0.5)), size=Vector((335.0, 25.0, 1.0)), mat_idx=0)

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

    # 1. ルート空オブジェクト (StationRoot)
    root = bpy.data.objects.new("StationRoot", None)
    root.empty_display_type = "ARROWS"
    root.empty_display_size = 2.0
    bpy.context.scene.collection.objects.link(root)

    # 2. 中央棟
    central = build_central_building(materials)
    central.parent = root

    # 3. 南北ウィング棟
    north_wing = build_wing(materials, "NorthWing", center_x=-85.0)
    north_wing.parent = root

    south_wing = build_wing(materials, "SouthWing", center_x=85.0)
    south_wing.parent = root

    # 4. 南北八角形ドーム
    north_dome = build_octagonal_dome(materials, "NorthDome", center_x=-145.0)
    north_dome.parent = root

    south_dome = build_octagonal_dome(materials, "SouthDome", center_x=145.0)
    south_dome.parent = root

    # 5. 白帯ストライプ装飾帯
    details = build_facade_details(materials)
    details.parent = root

    print("Tokyo Station modeling complete! Hierarchy created:")
    for obj in bpy.data.objects:
        p_name = obj.parent.name if obj.parent else "None"
        print(f"  - {obj.name} (Type: {obj.type}, Parent: {p_name})")

    # エクスポート先ディレクトリ確認
    out_dir = os.path.abspath("apps/web/public/models")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "tokyo_station.glb")

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
    print(f"Successfully exported Tokyo Station model to: {out_path} ({os.path.getsize(out_path):,} bytes)")


if __name__ == "__main__":
    generate_tokyo_station()

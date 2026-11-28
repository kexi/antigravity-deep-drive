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
Antigravity Deep Drive - Blender 3D建築モデル連動 LOD0/LOD1/LOD2 テクスチャ生成パイプライン (Pass 2 フォトリアル版)

実際の 3D 建築ファサード（深い室内・天井照明コーブ・ブラインド・斜め空反射ガラス・二丁掛タイル・
目地入り石材パネル・1F店舗ショーウィンドウ）および屋根モジュールを Blender 上でモデリングし、
正射影レンダリング（ベイク）により以下を一貫生成する：
- LOD0 (1024px): 近景詳細アルベド＋専用夜間窓発光マスク (512px)
- LOD1 (512px): LOD0 3D突出スパンドレル庇・垂直マリオン構造柱の立体陰影を焼き込んだ中距離アルベド＋発光マスク (256px)
- LOD2 (256px): LOD1 ベイク画像からアンチエイリアス縮約生成した遠景モアレ防止アルベド＋発光マスク (128px)
"""

import math
import os
import shutil

import bmesh
import bpy
import numpy as np
from mathutils import Vector

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".."))
OUT_DIR = os.path.join(PROJECT_ROOT, "apps", "web", "public", "textures", "shibuya")


def clean_scene() -> None:
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh, do_unlink=True)
    for mat in list(bpy.data.materials):
        bpy.data.materials.remove(mat, do_unlink=True)
    for img in list(bpy.data.images):
        bpy.data.images.remove(img, do_unlink=True)


def make_architectural_mat(
    name: str,
    color: tuple[float, float, float, float],
    roughness: float = 0.55,
    metallic: float = 0.05,
    noise_scale: float = 16.0,
    noise_mix: float = 0.14,
    brick_tile: bool = False,
    brick_color2: tuple[float, float, float, float] | None = None,
    mortar_color: tuple[float, float, float, float] = (0.18, 0.16, 0.15, 1.0),
    brick_scale: float = 10.0,
    brick_ratio: float = 3.2,
    glass_reflection: bool = False,
    glass_period: float = 0.40,
    lit_interior: bool = False,
    lit_color: tuple[float, float, float, float] = (0.95, 0.80, 0.56, 1.0),
) -> bpy.types.Material:
    mat = bpy.data.materials.new(name=name)
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic

    tex_coord = nt.nodes.new("ShaderNodeTexCoord")

    if glass_reflection:
        # リアルな建築ガラス：上下方向の空・街並みグラデーション反射＋緩やかな雲ノイズ＋室内奥行明暗
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(tex_coord.outputs["Object"], sep.inputs["Vector"])

        # Z位置の周期グラデーション（各階の上部は空の反射でやや明るく、下部は室内・街路の反射で深い紺灰）
        math_mod = nt.nodes.new("ShaderNodeMath")
        math_mod.operation = "FRACT"
        math_mul = nt.nodes.new("ShaderNodeMath")
        math_mul.operation = "MULTIPLY"
        math_mul.inputs[1].default_value = glass_period  # 階高周期 (4層=0.40, 1F店舗=0.10)
        nt.links.new(sep.outputs["Z"], math_mul.inputs[0])
        nt.links.new(math_mul.outputs["Value"], math_mod.inputs[0])

        noise = nt.nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 0.32
        noise.inputs["Detail"].default_value = 4.0
        noise.inputs["Roughness"].default_value = 0.55
        nt.links.new(tex_coord.outputs["Object"], noise.inputs["Vector"])

        # 反射グラデーション（下: 深いガラス暗色, 上: 青白い天空反射 or 点灯室内天井バウンス）
        mix_grad = nt.nodes.new("ShaderNodeMix")
        mix_grad.data_type = "RGBA"
        if lit_interior:
            # 昼間アルベドでは過度なチェッカーボード反復を避け、落ち着いたガラス越し室内明暗（夜間は専用 Emissive マスクが鮮明に点灯）
            mix_grad.inputs[6].default_value = (
                lit_color[0] * 0.24,
                lit_color[1] * 0.24,
                lit_color[2] * 0.26,
                1.0,
            )
            mix_grad.inputs[7].default_value = (
                lit_color[0] * 0.46,
                lit_color[1] * 0.45,
                lit_color[2] * 0.42,
                1.0,
            )
            nt.links.new(math_mod.outputs["Value"], mix_grad.inputs["Factor"])

            mix_var = nt.nodes.new("ShaderNodeMix")
            mix_var.data_type = "RGBA"
            mix_var.inputs["Factor"].default_value = 0.22
            mix_var.inputs[7].default_value = (
                lit_color[0] * 0.36,
                lit_color[1] * 0.36,
                lit_color[2] * 0.35,
                1.0,
            )
            nt.links.new(mix_grad.outputs[2], mix_var.inputs[6])
            nt.links.new(mix_var.outputs[2], bsdf.inputs["Base Color"])
            bsdf.inputs["Emission Color"].default_value = lit_color
            bsdf.inputs["Emission Strength"].default_value = 0.08
        else:
            # 非点灯反射ガラス：下部は街並み映り込みの濃いネイビーグレー、上部は斜め空・雲のソフト反射
            mix_grad.inputs[6].default_value = (
                color[0] * 0.58,
                color[1] * 0.64,
                color[2] * 0.74,
                1.0,
            )
            mix_grad.inputs[7].default_value = (
                min(1.0, color[0] * 1.35 + 0.06),
                min(1.0, color[1] * 1.45 + 0.08),
                min(1.0, color[2] * 1.55 + 0.10),
                1.0,
            )
            nt.links.new(math_mod.outputs["Value"], mix_grad.inputs["Factor"])

            # 雲反射の柔らかい揺らぎを混合
            ramp = nt.nodes.new("ShaderNodeValToRGB")
            ramp.color_ramp.elements[0].position = 0.42
            ramp.color_ramp.elements[0].color = (0.0, 0.0, 0.0, 1.0)
            ramp.color_ramp.elements[1].position = 0.72
            ramp.color_ramp.elements[1].color = (0.38, 0.38, 0.38, 1.0)
            nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])

            mix_cloud = nt.nodes.new("ShaderNodeMix")
            mix_cloud.data_type = "RGBA"
            mix_cloud.inputs[7].default_value = (0.48, 0.56, 0.66, 1.0)
            nt.links.new(ramp.outputs["Color"], mix_cloud.inputs["Factor"])
            nt.links.new(mix_grad.outputs[2], mix_cloud.inputs[6])
            nt.links.new(mix_cloud.outputs[2], bsdf.inputs["Base Color"])
        return mat

    if brick_tile:
        # 日本の建築外装タイル（二丁掛タイル・レンガ調パネル）：ShaderNodeTexBrick を XZ 平面へマッピング
        mapping = nt.nodes.new("ShaderNodeMapping")
        mapping.inputs["Rotation"].default_value = (math.radians(90.0), 0.0, 0.0)
        nt.links.new(tex_coord.outputs["Object"], mapping.inputs["Vector"])

        brick = nt.nodes.new("ShaderNodeTexBrick")
        brick.offset = 0.5
        brick.inputs["Scale"].default_value = brick_scale
        brick.inputs["Mortar Size"].default_value = 0.018
        brick.inputs["Mortar Smooth"].default_value = 0.15
        brick.inputs["Bias"].default_value = 0.0
        brick.inputs["Brick Width"].default_value = 0.5 * brick_ratio
        brick.inputs["Row Height"].default_value = 0.25
        brick.inputs["Color1"].default_value = color
        brick.inputs["Color2"].default_value = brick_color2 or (
            color[0] * 0.84,
            color[1] * 0.82,
            color[2] * 0.80,
            1.0,
        )
        brick.inputs["Mortar"].default_value = mortar_color
        nt.links.new(mapping.outputs["Vector"], brick.inputs["Vector"])

        # さらに大域的な風合い・雨垂れニュアンスを乗算
        noise = nt.nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 1.6
        noise.inputs["Detail"].default_value = 5.0
        nt.links.new(tex_coord.outputs["Object"], noise.inputs["Vector"])

        mix_w = nt.nodes.new("ShaderNodeMix")
        mix_w.data_type = "RGBA"
        mix_w.blend_type = "MULTIPLY"
        mix_w.inputs["Factor"].default_value = 0.22
        nt.links.new(brick.outputs["Color"], mix_w.inputs[6])
        nt.links.new(noise.outputs["Color"], mix_w.inputs[7])
        nt.links.new(mix_w.outputs[2], bsdf.inputs["Base Color"])
        return mat

    if noise_scale > 0.0 and noise_mix > 0.0:
        noise = nt.nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = noise_scale
        noise.inputs["Detail"].default_value = 6.0
        noise.inputs["Roughness"].default_value = 0.65
        nt.links.new(tex_coord.outputs["Object"], noise.inputs["Vector"])

        dark_c = (
            max(0.0, color[0] * (1.0 - noise_mix)),
            max(0.0, color[1] * (1.0 - noise_mix)),
            max(0.0, color[2] * (1.0 - noise_mix)),
            1.0,
        )
        light_c = (
            min(1.0, color[0] * (1.0 + noise_mix * 0.65)),
            min(1.0, color[1] * (1.0 + noise_mix * 0.65)),
            min(1.0, color[2] * (1.0 + noise_mix * 0.65)),
            1.0,
        )
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.inputs[6].default_value = dark_c
        mix.inputs[7].default_value = light_c
        nt.links.new(noise.outputs["Fac"], mix.inputs["Factor"])
        nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = color
    return mat


def make_emissive_mask_mat(
    name: str,
    color: tuple[float, float, float, float],
    vertical_ceiling_grad: bool = False,
) -> bpy.types.Material:
    mat = bpy.data.materials.new(name=name)
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = 1.0
    if vertical_ceiling_grad:
        # 夜間オフィス窓は天井照明側が明るく下側へ自然に減衰（単色塗り潰し感を排除）
        tex_coord = nt.nodes.new("ShaderNodeTexCoord")
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(tex_coord.outputs["Object"], sep.inputs["Vector"])
        m_mul = nt.nodes.new("ShaderNodeMath")
        m_mul.operation = "MULTIPLY"
        m_mul.inputs[1].default_value = 0.40
        m_frac = nt.nodes.new("ShaderNodeMath")
        m_frac.operation = "FRACT"
        nt.links.new(sep.outputs["Z"], m_mul.inputs[0])
        nt.links.new(m_mul.outputs["Value"], m_frac.inputs[0])
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.inputs[6].default_value = (color[0] * 0.42, color[1] * 0.36, color[2] * 0.28, 1.0)
        mix.inputs[7].default_value = color
        nt.links.new(m_frac.outputs["Value"], mix.inputs["Factor"])
        nt.links.new(mix.outputs[2], em.inputs["Color"])
    else:
        em.inputs["Color"].default_value = color
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return mat


def add_box(
    bm: bmesh.types.BMesh,
    x0: float,
    x1: float,
    y0: float,
    y1: float,
    z0: float,
    z1: float,
    mat_idx: int,
) -> None:
    if x1 <= x0 + 1e-5 or y1 <= y0 + 1e-5 or z1 <= z0 + 1e-5:
        return
    vs = [
        bm.verts.new(Vector((x0, y0, z0))),
        bm.verts.new(Vector((x1, y0, z0))),
        bm.verts.new(Vector((x1, y1, z0))),
        bm.verts.new(Vector((x0, y1, z0))),
        bm.verts.new(Vector((x0, y0, z1))),
        bm.verts.new(Vector((x1, y0, z1))),
        bm.verts.new(Vector((x1, y1, z1))),
        bm.verts.new(Vector((x0, y1, z1))),
    ]
    faces_idx = [
        (0, 1, 5, 4),  # front (-Y)
        (2, 3, 7, 6),  # back (+Y)
        (1, 2, 6, 5),  # right (+X)
        (3, 0, 4, 7),  # left (-X)
        (4, 5, 6, 7),  # top (+Z)
        (3, 2, 1, 0),  # bottom (-Z)
    ]
    for fi in faces_idx:
        try:
            f = bm.faces.new([vs[i] for i in fi])
            f.material_index = mat_idx
        except Exception:
            pass


def setup_ortho_bake_scene(
    res_x: int,
    res_y: int,
    ortho_scale: float,
    center_x: float,
    center_z: float,
    is_emissive_pass: bool = False,
    top_down: bool = False,
) -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = res_x
    scene.render.resolution_y = res_y
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 92
    scene.render.filter_size = 1.25

    # AgX 相当の自然なハイライトロールオフ（白飛び・プラスチック感を完全防止）
    scene.view_settings.view_transform = "Standard" if is_emissive_pass else "AgX"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0 if is_emissive_pass else -0.25

    world = scene.world
    bg = next((n for n in world.node_tree.nodes if n.type == "BACKGROUND"), None)
    if bg:
        if is_emissive_pass:
            bg.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)
            bg.inputs["Strength"].default_value = 0.0
        else:
            bg.inputs["Color"].default_value = (0.58, 0.66, 0.78, 1.0)
            bg.inputs["Strength"].default_value = 0.55

    # 既存ライト・カメラを清掃してから配置（多重生成による光量過多を防止）
    for obj in list(bpy.data.objects):
        if obj.type in ("LIGHT", "CAMERA"):
            bpy.data.objects.remove(obj, do_unlink=True)

    if not is_emissive_pass:
        sun1_d = bpy.data.lights.new("SunKey", type="SUN")
        sun1_d.energy = 1.85
        sun1_d.angle = math.radians(10.0)
        sun1_d.color = (1.0, 0.97, 0.92)
        sun1_o = bpy.data.objects.new("SunKey", sun1_d)
        scene.collection.objects.link(sun1_o)
        if top_down:
            sun1_o.rotation_euler = (math.radians(38), math.radians(-20), math.radians(22))
        else:
            sun1_o.rotation_euler = (math.radians(48), math.radians(18), math.radians(20))

        sun2_d = bpy.data.lights.new("SunFill", type="SUN")
        sun2_d.energy = 0.45
        sun2_d.color = (0.78, 0.88, 1.0)
        sun2_o = bpy.data.objects.new("SunFill", sun2_d)
        scene.collection.objects.link(sun2_o)
        if top_down:
            sun2_o.rotation_euler = (math.radians(-28), math.radians(22), math.radians(-40))
        else:
            sun2_o.rotation_euler = (math.radians(78), math.radians(-26), math.radians(-22))

    cam_d = bpy.data.cameras.new("OrthoBakeCam")
    cam_d.type = "ORTHO"
    cam_d.ortho_scale = ortho_scale
    cam_d.clip_start = 0.1
    cam_d.clip_end = 100.0
    cam_o = bpy.data.objects.new("OrthoBakeCam", cam_d)
    scene.collection.objects.link(cam_o)
    scene.camera = cam_o

    if top_down:
        cam_o.location = Vector((center_x, center_z, 12.0))
        cam_o.rotation_euler = (0.0, 0.0, 0.0)
    else:
        cam_o.location = Vector((center_x, -12.0, center_z))
        cam_o.rotation_euler = (math.radians(90.0), 0.0, 0.0)


def build_facade_rig_and_bake(
    style: str,
    include_lod0_outer_relief: bool,
    out_albedo_path: str,
    res: int,
    out_emissive_path: str | None = None,
    emissive_res: int = 512,
) -> None:
    """
    実寸 3D 建築ファサード（4スパン × 4層、完全周期シームレス）から LOD0 / LOD1 アルベドおよび
    夜間窓専用発光マスク（壁・枠・暗室は完全黒）を正射影ベイクする。
    """
    clean_scene()

    mod_w = 10.0
    mod_h = 10.0
    n_cols = 4
    n_rows = 4
    bay_w = mod_w / n_cols
    floor_h = mod_h / n_rows

    if style == "glass_tower":
        mat_wall = make_architectural_mat(
            "SpandrelMetal",
            (0.14, 0.17, 0.23, 1.0),
            roughness=0.34,
            metallic=0.58,
            noise_scale=18.0,
            noise_mix=0.10,
        )
        mat_frame = make_architectural_mat(
            "DarkMullion", (0.07, 0.08, 0.11, 1.0), roughness=0.30, metallic=0.70, noise_scale=0.0
        )
        mat_glass_cool = make_architectural_mat(
            "GlassCool",
            (0.15, 0.22, 0.30, 1.0),
            roughness=0.12,
            metallic=0.45,
            glass_reflection=True,
            lit_interior=False,
        )
        mat_glass_lit = make_architectural_mat(
            "GlassLit",
            (0.40, 0.44, 0.46, 1.0),
            roughness=0.20,
            metallic=0.18,
            glass_reflection=True,
            lit_interior=True,
            lit_color=(0.86, 0.90, 0.88, 1.0),
        )
        mat_blind = make_architectural_mat(
            "OfficeBlind",
            (0.36, 0.40, 0.46, 1.0),
            roughness=0.62,
            metallic=0.08,
            noise_scale=30.0,
            noise_mix=0.08,
        )
        mat_trim = make_architectural_mat(
            "OuterTrim",
            (0.11, 0.14, 0.19, 1.0),
            roughness=0.32,
            metallic=0.62,
            noise_scale=12.0,
            noise_mix=0.08,
        )
        mat_accent = make_architectural_mat(
            "AccentSpandrel",
            (0.18, 0.24, 0.32, 1.0),
            roughness=0.24,
            metallic=0.45,
            noise_scale=8.0,
            noise_mix=0.08,
        )
        em_lit_col = (0.82, 0.90, 1.0, 1.0)
        em_warm_col = (1.0, 0.84, 0.58, 1.0)
    elif style == "commercial":
        # 日本の都市部中〜高層商業オフィス（プレキャスト御影石・アルミパネル＋深い窓凹み）
        mat_wall = make_architectural_mat(
            "LimestonePanel",
            (0.48, 0.47, 0.45, 1.0),
            roughness=0.58,
            metallic=0.06,
            brick_tile=True,
            brick_color2=(0.43, 0.42, 0.40, 1.0),
            mortar_color=(0.24, 0.24, 0.24, 1.0),
            brick_scale=2.2,
            brick_ratio=2.4,
        )
        mat_frame = make_architectural_mat(
            "BronzeSash", (0.11, 0.12, 0.15, 1.0), roughness=0.34, metallic=0.55, noise_scale=0.0
        )
        mat_glass_cool = make_architectural_mat(
            "GlassOffice",
            (0.14, 0.20, 0.28, 1.0),
            roughness=0.14,
            metallic=0.42,
            glass_reflection=True,
            lit_interior=False,
        )
        mat_glass_lit = make_architectural_mat(
            "GlassOfficeLit",
            (0.46, 0.40, 0.32, 1.0),
            roughness=0.22,
            metallic=0.16,
            glass_reflection=True,
            lit_interior=True,
            lit_color=(1.0, 0.84, 0.58, 1.0),
        )
        mat_blind = make_architectural_mat(
            "OfficeBlindWarm",
            (0.44, 0.43, 0.40, 1.0),
            roughness=0.68,
            metallic=0.05,
            noise_scale=28.0,
            noise_mix=0.08,
        )
        mat_trim = make_architectural_mat(
            "ArchTrimLight",
            (0.56, 0.57, 0.59, 1.0),
            roughness=0.38,
            metallic=0.25,
            noise_scale=14.0,
            noise_mix=0.08,
        )
        mat_accent = make_architectural_mat(
            "StoneGroove", (0.28, 0.28, 0.28, 1.0), roughness=0.72, metallic=0.04, noise_scale=0.0
        )
        em_lit_col = (1.0, 0.86, 0.62, 1.0)
        em_warm_col = (1.0, 0.78, 0.48, 1.0)
    elif style == "alley":
        # 渋谷・道玄坂・宮益坂裏のリアルな暖色系二丁掛セラミックタイル商業ビル
        mat_wall = make_architectural_mat(
            "ShibuyaCeramicTile",
            (0.46, 0.38, 0.31, 1.0),
            roughness=0.54,
            metallic=0.05,
            brick_tile=True,
            brick_color2=(0.38, 0.31, 0.25, 1.0),
            mortar_color=(0.20, 0.18, 0.16, 1.0),
            brick_scale=8.5,
            brick_ratio=3.0,
        )
        mat_frame = make_architectural_mat(
            "AlumSash", (0.14, 0.15, 0.18, 1.0), roughness=0.36, metallic=0.52, noise_scale=0.0
        )
        mat_glass_cool = make_architectural_mat(
            "GlassTenantDark",
            (0.12, 0.17, 0.24, 1.0),
            roughness=0.16,
            metallic=0.36,
            glass_reflection=True,
            lit_interior=False,
        )
        mat_glass_lit = make_architectural_mat(
            "GlassTenantLit",
            (0.50, 0.38, 0.26, 1.0),
            roughness=0.26,
            metallic=0.12,
            glass_reflection=True,
            lit_interior=True,
            lit_color=(1.0, 0.78, 0.48, 1.0),
        )
        mat_blind = make_architectural_mat(
            "TenantCurtain",
            (0.48, 0.44, 0.38, 1.0),
            roughness=0.72,
            metallic=0.03,
            noise_scale=24.0,
            noise_mix=0.10,
        )
        mat_trim = make_architectural_mat(
            "ConcreteLedge",
            (0.44, 0.42, 0.39, 1.0),
            roughness=0.58,
            metallic=0.10,
            noise_scale=14.0,
            noise_mix=0.10,
        )
        mat_accent = make_architectural_mat(
            "TileMortar", (0.28, 0.25, 0.22, 1.0), roughness=0.75, metallic=0.03, noise_scale=0.0
        )
        em_lit_col = (1.0, 0.80, 0.50, 1.0)
        em_warm_col = (1.0, 0.72, 0.40, 1.0)
    else:
        # 1F 路面店舗専用モジュール（御影石ピラスター＋ダークブロンズ扉枠＋落ち着いた暖色ショーウィンドウ内装）
        mat_wall = make_architectural_mat(
            "GranitePier",
            (0.42, 0.40, 0.37, 1.0),
            roughness=0.46,
            metallic=0.08,
            brick_tile=True,
            brick_color2=(0.37, 0.35, 0.32, 1.0),
            mortar_color=(0.20, 0.19, 0.18, 1.0),
            brick_scale=2.4,
            brick_ratio=2.0,
        )
        mat_frame = make_architectural_mat(
            "ShopBronzeFrame",
            (0.10, 0.11, 0.13, 1.0),
            roughness=0.30,
            metallic=0.66,
            noise_scale=0.0,
        )
        mat_glass_cool = make_architectural_mat(
            "ShopGlassClosed",
            (0.14, 0.19, 0.25, 1.0),
            roughness=0.12,
            metallic=0.40,
            glass_reflection=True,
            glass_period=0.10,
            lit_interior=False,
        )
        mat_glass_lit = make_architectural_mat(
            "ShopInteriorWarm",
            (0.48, 0.39, 0.29, 1.0),
            roughness=0.38,
            metallic=0.06,
            glass_reflection=True,
            glass_period=0.10,
            lit_interior=True,
            lit_color=(1.0, 0.82, 0.54, 1.0),
        )
        mat_blind = make_architectural_mat(
            "ShopShelfWood",
            (0.34, 0.28, 0.22, 1.0),
            roughness=0.52,
            metallic=0.04,
            noise_scale=12.0,
            noise_mix=0.12,
        )
        mat_trim = make_architectural_mat(
            "ShopFasciaDark",
            (0.14, 0.16, 0.20, 1.0),
            roughness=0.34,
            metallic=0.48,
            noise_scale=8.0,
            noise_mix=0.06,
        )
        mat_accent = make_architectural_mat(
            "ShopBasePlinth",
            (0.12, 0.13, 0.15, 1.0),
            roughness=0.46,
            metallic=0.20,
            noise_scale=18.0,
            noise_mix=0.10,
        )
        em_lit_col = (1.0, 0.86, 0.60, 1.0)
        em_warm_col = (1.0, 0.78, 0.50, 1.0)

    albedo_mats = [
        mat_wall,
        mat_frame,
        mat_glass_cool,
        mat_glass_lit,
        mat_blind,
        mat_trim,
        mat_accent,
    ]

    # 夜間窓専用発光マスク用マテリアル（壁・サッシ・庇・ブラインドは完全黒 0,0,0）
    mat_black = make_emissive_mask_mat("EmBlack", (0.0, 0.0, 0.0, 1.0))
    mat_em_dim = make_emissive_mask_mat("EmDim", (0.03, 0.04, 0.06, 1.0))
    mat_em_lit = make_emissive_mask_mat(
        "EmLit", em_lit_col, vertical_ceiling_grad=(style != "storefront")
    )
    mat_em_warm = make_emissive_mask_mat("EmWarm", em_warm_col, vertical_ceiling_grad=True)

    bm = bmesh.new()
    add_box(bm, -1.0, mod_w + 1.0, 0.55, 0.90, -1.0, mod_h + 1.0, 2)

    if style == "storefront":
        add_box(bm, -0.5, mod_w + 0.5, -0.06, 0.42, 8.20, 10.05, 0)  # 上部壁石材
        add_box(bm, -0.5, mod_w + 0.5, -0.14, 0.02, 8.38, 9.64, 5)  # 店舗看板ダークフレーム
        add_box(bm, -0.5, mod_w + 0.5, -0.18, 0.04, 8.00, 8.32, 1)  # 店舗軒下ダーク庇ライン
        add_box(bm, -0.5, mod_w + 0.5, -0.06, 0.45, -0.1, 0.68, 6)  # 1F ダーク御影石巾木

        for ci in range(-1, n_cols + 1):
            bx0 = ci * bay_w
            bx1 = bx0 + bay_w
            col_mod = ci % n_cols
            # 両端ピラスター石柱（端境界で隣接スパンとシームレス結合）
            add_box(bm, bx0 - 0.16, bx0 + 0.16, -0.12, 0.45, 0.0, 10.0, 0)
            gx0 = bx0 + 0.20
            gx1 = bx1 - 0.20
            add_box(bm, bx0 + 0.14, gx0, -0.04, 0.30, 0.66, 8.05, 1)
            add_box(bm, gx1, bx1 - 0.14, -0.04, 0.30, 0.66, 8.05, 1)
            # 上部欄間桟＆ドア縦マリオン
            add_box(bm, gx0, gx1, -0.03, 0.18, 5.95, 6.18, 1)
            mid_x = 0.5 * (gx0 + gx1)
            add_box(bm, mid_x - 0.045, mid_x + 0.045, -0.03, 0.18, 0.68, 8.02, 1)
            add_box(bm, mid_x - 0.16, mid_x - 0.11, -0.05, 0.06, 2.35, 3.65, 1)
            add_box(bm, mid_x + 0.11, mid_x + 0.16, -0.05, 0.06, 2.35, 3.65, 1)
            # 店内背板（4店舗中3店舗が温かい点灯、1店舗が落ち着いた暗めガラス）
            is_bright_shop = col_mod in (0, 1, 3)
            add_box(bm, gx0, gx1, 0.44, 0.62, 0.68, 8.02, 3 if is_bright_shop else 2)
            # 店内ディスプレイ棚・カウンター（立体陰影でガラス越し奥行感を演出）
            add_box(bm, gx0 + 0.14, gx1 - 0.14, 0.24, 0.46, 0.68, 1.85, 4)
            for sz in (3.15, 4.55):
                add_box(bm, gx0 + 0.16, gx1 - 0.16, 0.28, 0.46, sz, sz + 0.12, 4)
            # 上部サインプレートアクセント
            add_box(
                bm, gx0 + 0.08, gx1 - 0.08, -0.16, -0.08, 8.56, 9.46, 5 if col_mod % 2 == 0 else 6
            )
    else:
        # 全スタイル共通の自然なオフィス点灯配置（全16室中 6〜7 室のみ点灯）
        lit_pattern = {
            "glass_tower": {(0, 0), (2, 0), (1, 1), (3, 1), (0, 2), (2, 3)},
            "commercial": {(0, 0), (2, 0), (1, 1), (3, 1), (1, 2), (3, 2), (0, 3)},
            "alley": {(0, 0), (2, 0), (1, 1), (2, 2), (0, 3), (3, 3)},
        }[style]

        if style == "glass_tower":
            pier_half = 0.08
            spandrel_bot = 0.34
            spandrel_top = 0.14
            recess_y = 0.15
        elif style == "commercial":
            pier_half = 0.22
            spandrel_bot = 0.44
            spandrel_top = 0.22
            recess_y = 0.26
        else:  # alley
            pier_half = 0.28
            spandrel_bot = 0.50
            spandrel_top = 0.24
            recess_y = 0.30

        for ri in range(-1, n_rows + 1):
            z0 = ri * floor_h
            z1 = z0 + floor_h
            row_mod = ri % n_rows
            add_box(bm, -bay_w, mod_w + bay_w, 0.0, recess_y + 0.18, z0, z0 + spandrel_bot, 0)
            add_box(bm, -bay_w, mod_w + bay_w, 0.0, recess_y + 0.18, z1 - spandrel_top, z1, 0)
            add_box(bm, -bay_w, mod_w + bay_w, -0.015, 0.03, z0 + 0.03, z0 + 0.07, 6)
            add_box(
                bm,
                -bay_w,
                mod_w + bay_w,
                -0.06,
                0.08,
                z0 + spandrel_bot - 0.05,
                z0 + spandrel_bot + 0.02,
                1,
            )

            for ci in range(-1, n_cols + 1):
                x0 = ci * bay_w
                x1 = x0 + bay_w
                col_mod = ci % n_cols
                add_box(bm, x0 - pier_half, x0 + pier_half, 0.0, recess_y + 0.18, z0, z1, 0)

                wx0 = x0 + pier_half
                wx1 = x1 - pier_half
                wz0 = z0 + spandrel_bot
                wz1 = z1 - spandrel_top

                ft = 0.065
                add_box(bm, wx0, wx0 + ft, recess_y * 0.45, recess_y + 0.06, wz0, wz1, 1)
                add_box(bm, wx1 - ft, wx1, recess_y * 0.45, recess_y + 0.06, wz0, wz1, 1)
                add_box(bm, wx0, wx1, recess_y * 0.45, recess_y + 0.06, wz0, wz0 + ft, 1)
                add_box(bm, wx0, wx1, recess_y * 0.45, recess_y + 0.06, wz1 - ft, wz1, 1)

                mid_x = 0.5 * (wx0 + wx1)
                add_box(
                    bm, mid_x - 0.03, mid_x + 0.03, recess_y * 0.55, recess_y + 0.06, wz0, wz1, 1
                )
                if style == "glass_tower":
                    add_box(
                        bm,
                        wx0 + ft,
                        wx1 - ft,
                        recess_y * 0.60,
                        recess_y + 0.05,
                        wz0 + 0.36,
                        wz0 + 0.42,
                        1,
                    )
                    add_box(
                        bm,
                        wx0 + ft,
                        wx1 - ft,
                        recess_y * 0.72,
                        recess_y + 0.10,
                        wz0 + ft,
                        wz0 + 0.36,
                        6,
                    )
                else:
                    add_box(
                        bm,
                        wx0 + ft,
                        wx1 - ft,
                        recess_y * 0.60,
                        recess_y + 0.05,
                        wz1 - 0.36,
                        wz1 - 0.30,
                        1,
                    )

                is_lit = (col_mod, row_mod) in lit_pattern
                glass_z0 = wz0 + (0.42 if style == "glass_tower" else ft)
                add_box(
                    bm,
                    wx0 + ft,
                    wx1 - ft,
                    recess_y + 0.07,
                    recess_y + 0.24,
                    glass_z0,
                    wz1 - ft,
                    3 if is_lit else 2,
                )

                # ブラインド（横スラットの立体陰影を控えめに配置）
                blind_seed = (col_mod * 7 + row_mod * 13) % 5
                if not is_lit and blind_seed in (0, 2, 4):
                    drop_frac = 0.36 if blind_seed == 0 else (0.58 if blind_seed == 2 else 0.24)
                    bz0 = wz1 - ft - (wz1 - ft - glass_z0) * drop_frac
                    add_box(
                        bm,
                        wx0 + ft + 0.02,
                        wx1 - ft - 0.02,
                        recess_y + 0.02,
                        recess_y + 0.07,
                        bz0,
                        wz1 - ft - 0.02,
                        4,
                    )

        # LOD1 ベイク時：LOD0 ジオメトリの 3D 突出スパンドレル庇（2階毎）＆ 3D 構造マリオン柱（2スパン毎）を追加して立体陰影を直接ベイク
        if include_lod0_outer_relief:
            for r_ledge in (0, 2, 4):
                zl = r_ledge * floor_h
                add_box(bm, -bay_w, mod_w + bay_w, -0.28, 0.04, zl - 0.14, zl + 0.14, 5)
            for c_pier in (0, 2, 4):
                xp = c_pier * bay_w
                add_box(bm, xp - 0.15, xp + 0.15, -0.24, 0.04, -floor_h, mod_h + floor_h, 5)

    bm.normal_update()
    mesh = bpy.data.meshes.new(f"FacadeRig_{style}")
    for m in albedo_mats:
        mesh.materials.append(m)
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new(f"FacadeRigObj_{style}", mesh)
    bpy.context.scene.collection.objects.link(obj)

    # 1. Albedo 正射影ベイク
    setup_ortho_bake_scene(
        res,
        res,
        ortho_scale=mod_w,
        center_x=mod_w * 0.5,
        center_z=mod_h * 0.5,
        is_emissive_pass=False,
    )
    bpy.context.scene.render.filepath = out_albedo_path
    bpy.ops.render.render(write_still=True)

    # 2. 夜間窓専用 Emissive マスク正射影ベイク
    # Why mesh.materials[i] = em でインプレース置換するか:
    # mesh.materials.clear() すると Blender 5.0 では全ポリゴンの material_index が 0 へリセットされ真っ黒になるため。
    if out_emissive_path:
        em_mats = [
            mat_black,
            mat_black,
            mat_em_dim,
            mat_em_warm if style == "alley" else mat_em_lit,
            mat_black,
            mat_black,
            mat_black,
        ]
        for idx, em in enumerate(em_mats):
            mesh.materials[idx] = em
        setup_ortho_bake_scene(
            emissive_res,
            emissive_res,
            ortho_scale=mod_w,
            center_x=mod_w * 0.5,
            center_z=mod_h * 0.5,
            is_emissive_pass=True,
        )
        bpy.context.scene.render.filepath = out_emissive_path
        bpy.ops.render.render(write_still=True)


def build_roof_rig_and_bake(style: str, out_path: str, res: int) -> None:
    """屋上防水シート（flat_roof）または日本式スレート瓦（pitched_slate）を 3D モデリングから正射影ベイクする"""
    clean_scene()
    mod = 8.0
    bm = bmesh.new()

    if style == "flat_roof":
        mat_base = make_architectural_mat(
            "RoofMembrane",
            (0.10, 0.11, 0.13, 1.0),
            roughness=0.84,
            metallic=0.05,
            noise_scale=3.8,
            noise_mix=0.26,
        )
        mat_seam = make_architectural_mat(
            "RoofSeam", (0.06, 0.07, 0.08, 1.0), roughness=0.90, metallic=0.04, noise_scale=0.0
        )
        mat_strip = make_architectural_mat(
            "RoofWalkway",
            (0.14, 0.15, 0.17, 1.0),
            roughness=0.78,
            metallic=0.06,
            noise_scale=10.0,
            noise_mix=0.12,
        )
        mats = [mat_base, mat_seam, mat_strip]

        add_box(bm, -1.0, mod + 1.0, -1.0, mod + 1.0, -0.2, 0.0, 0)
        for k in range(5):
            p = k * 2.0
            add_box(bm, p - 0.025, p + 0.025, -1.0, mod + 1.0, -0.01, 0.015, 1)
            add_box(bm, -1.0, mod + 1.0, p - 0.025, p + 0.025, -0.01, 0.015, 1)
        for k in range(4):
            y0 = k * 2.0 + 0.06
            add_box(bm, -1.0, mod + 1.0, y0, y0 + 0.14, 0.0, 0.010, 2)
    else:
        # 日本の住宅スレート屋根（カラーベスト／ダークスレート段葺き：深い段影と微妙な色むら）
        mat_slate_a = make_architectural_mat(
            "SlateA",
            (0.08, 0.09, 0.11, 1.0),
            roughness=0.74,
            metallic=0.05,
            noise_scale=12.0,
            noise_mix=0.18,
        )
        mat_slate_b = make_architectural_mat(
            "SlateB",
            (0.11, 0.12, 0.14, 1.0),
            roughness=0.76,
            metallic=0.05,
            noise_scale=14.0,
            noise_mix=0.18,
        )
        mat_gap = make_architectural_mat(
            "SlateGap", (0.025, 0.028, 0.035, 1.0), roughness=0.92, metallic=0.02, noise_scale=0.0
        )
        mats = [mat_slate_a, mat_slate_b, mat_gap]

        add_box(bm, -1.0, mod + 1.0, -1.0, mod + 1.0, -0.2, 0.0, 2)
        n_courses = 16
        n_tiles_x = 8
        ch = mod / n_courses
        tw = mod / n_tiles_x
        for r in range(-1, n_courses + 1):
            y0 = r * ch
            y1 = y0 + ch * 0.92
            stagger = (tw * 0.5) if (r % 2 == 1) else 0.0
            for c in range(-1, n_tiles_x + 2):
                x0 = c * tw + stagger
                x1 = x0 + tw * 0.96
                m_idx = 0 if ((r * 3 + c * 5) % 2 == 0) else 1
                add_box(bm, x0, x1, y0, y1, 0.0, 0.075 + (r % 2) * 0.008, m_idx)

    bm.normal_update()
    mesh = bpy.data.meshes.new(f"RoofRig_{style}")
    for m in mats:
        mesh.materials.append(m)
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new(f"RoofRigObj_{style}", mesh)
    bpy.context.scene.collection.objects.link(obj)

    setup_ortho_bake_scene(
        res,
        res,
        ortho_scale=mod,
        center_x=mod * 0.5,
        center_z=mod * 0.5,
        is_emissive_pass=False,
        top_down=True,
    )
    bpy.context.scene.render.filepath = out_path
    bpy.ops.render.render(write_still=True)


def _load_rgb_array(path: str) -> np.ndarray:
    img = bpy.data.images.load(path)
    w, h = img.size[0], img.size[1]
    arr = np.array(img.pixels[:], dtype=np.float32).reshape((h, w, 4))[:, :, :3]
    bpy.data.images.remove(img)
    return arr


def _save_rgb_array(arr: np.ndarray, path: str, quality: int = 88) -> None:
    h, w, _ = arr.shape
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[:, :, :3] = np.clip(arr, 0.0, 1.0)
    img = bpy.data.images.new("TempOut", width=w, height=h, alpha=False)
    img.pixels.foreach_set(rgba.ravel())
    scene = bpy.context.scene
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.exposure = 0.0
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = quality
    img.save_render(filepath=path, scene=scene)
    bpy.data.images.remove(img)


def _downsample_box2x(arr: np.ndarray) -> np.ndarray:
    h, w, c = arr.shape
    return arr.reshape((h // 2, 2, w // 2, 2, c)).mean(axis=(1, 3))


def generate_lod2_from_lod1(
    lod1_comm_path: str,
    lod1_comm_emissive_path: str,
    out_proxy_albedo: str,
    out_proxy_emissive: str,
) -> None:
    """
    LOD1 ベイク済み商業建築テクスチャ（512px）からアンチエイリアス縮約により LOD2 遠景テクスチャ（256px）と
    遠景夜間発光マスク（128px）を直接生成する（二重像ゼロ・遠景モアレ防止・隅6pxへ暗色屋上ピクセル固定）。
    """
    a_comm = _load_rgb_array(lod1_comm_path)
    lod2 = _downsample_box2x(a_comm)
    lod2_smooth = (
        lod2 * 0.56
        + np.roll(lod2, 1, axis=0) * 0.11
        + np.roll(lod2, -1, axis=0) * 0.11
        + np.roll(lod2, 1, axis=1) * 0.11
        + np.roll(lod2, -1, axis=1) * 0.11
    )
    lod2_out = np.clip(lod2_smooth * 1.06, 0.0, 1.0)
    # 屋上参照テクセル (u≈0.006, v≈0.006) を暗色防水屋上へ固定（単一ドローコールで屋上窓柄ゼロ）
    roof_px = np.array([0.24, 0.25, 0.28], dtype=np.float32)
    lod2_out[0:6, 0:6, :] = roof_px
    lod2_out[-6:, 0:6, :] = roof_px
    _save_rgb_array(lod2_out, out_proxy_albedo, quality=88)

    e_comm = _load_rgb_array(lod1_comm_emissive_path)
    while e_comm.shape[0] > 128:
        e_comm = _downsample_box2x(e_comm)
    e_comm[0:4, 0:4, :] = 0.0
    e_comm[-4:, 0:4, :] = 0.0
    _save_rgb_array(e_comm, out_proxy_emissive, quality=86)


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    print("[LOD-TEX] Pass 2: Baking photorealistic LOD0 (1024px) & Window-Only Emissive (512px)...")

    build_facade_rig_and_bake(
        "glass_tower",
        include_lod0_outer_relief=False,
        out_albedo_path=os.path.join(OUT_DIR, "plateau_lod0_glass.jpg"),
        res=1024,
        out_emissive_path=os.path.join(OUT_DIR, "plateau_lod0_glass_emissive.jpg"),
        emissive_res=512,
    )
    build_facade_rig_and_bake(
        "commercial",
        include_lod0_outer_relief=False,
        out_albedo_path=os.path.join(OUT_DIR, "plateau_lod0_commercial.jpg"),
        res=1024,
        out_emissive_path=os.path.join(OUT_DIR, "plateau_lod0_commercial_emissive.jpg"),
        emissive_res=512,
    )
    build_facade_rig_and_bake(
        "storefront",
        include_lod0_outer_relief=False,
        out_albedo_path=os.path.join(OUT_DIR, "plateau_lod0_storefront.jpg"),
        res=1024,
        out_emissive_path=os.path.join(OUT_DIR, "plateau_lod0_storefront_emissive.jpg"),
        emissive_res=512,
    )
    build_facade_rig_and_bake(
        "alley",
        include_lod0_outer_relief=False,
        out_albedo_path=os.path.join(OUT_DIR, "plateau_lod0_alley.jpg"),
        res=1024,
        out_emissive_path=os.path.join(OUT_DIR, "plateau_lod0_alley_emissive.jpg"),
        emissive_res=512,
    )
    build_roof_rig_and_bake("flat_roof", os.path.join(OUT_DIR, "plateau_lod0_roof.jpg"), res=512)
    build_roof_rig_and_bake(
        "pitched_slate", os.path.join(OUT_DIR, "plateau_lod0_pitched_roof.jpg"), res=512
    )

    print(
        "[LOD-TEX] Pass 2: Baking LOD1 (512px) directly from 3D LOD0 architecture WITH 3D relief..."
    )
    lod1_glass = os.path.join(OUT_DIR, "plateau_lod1_glass.jpg")
    lod1_glass_em = os.path.join(OUT_DIR, "plateau_lod1_glass_emissive.jpg")
    lod1_comm = os.path.join(OUT_DIR, "plateau_lod1_commercial.jpg")
    lod1_comm_em = os.path.join(OUT_DIR, "plateau_lod1_commercial_emissive.jpg")
    lod1_alley = os.path.join(OUT_DIR, "plateau_lod1_alley.jpg")
    lod1_alley_em = os.path.join(OUT_DIR, "plateau_lod1_alley_emissive.jpg")
    lod1_roof = os.path.join(OUT_DIR, "plateau_lod1_roof.jpg")

    build_facade_rig_and_bake(
        "glass_tower", True, lod1_glass, res=512, out_emissive_path=lod1_glass_em, emissive_res=256
    )
    build_facade_rig_and_bake(
        "commercial", True, lod1_comm, res=512, out_emissive_path=lod1_comm_em, emissive_res=256
    )
    build_facade_rig_and_bake(
        "alley", True, lod1_alley, res=512, out_emissive_path=lod1_alley_em, emissive_res=256
    )

    roof_l0 = _load_rgb_array(os.path.join(OUT_DIR, "plateau_lod0_roof.jpg"))
    _save_rgb_array(_downsample_box2x(roof_l0), lod1_roof, quality=86)

    print("[LOD-TEX] Pass 2: Generating LOD2 (256px) anti-aliased proxy from LOD1...")
    generate_lod2_from_lod1(
        lod1_comm,
        lod1_comm_em,
        os.path.join(OUT_DIR, "plateau_lod2_proxy.jpg"),
        os.path.join(OUT_DIR, "plateau_lod2_proxy_emissive.jpg"),
    )

    shutil.copyfile(
        os.path.join(OUT_DIR, "plateau_lod0_roof.jpg"),
        os.path.join(OUT_DIR, "plateau_lod2_roof.jpg"),
    )

    print(f"[LOD-TEX] Pass 2 complete in {OUT_DIR}")


if __name__ == "__main__":
    main()

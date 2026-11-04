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
Blender Procedural 3D Texture Generator
Tokyo Station Deep Drive - 道路・イチョウ街路樹・東京駅赤レンガ・白御影石 3D プロシージャル PBR マテリアル生成スクリプト

Blender の 3D プロシージャルテクスチャノード:
- Noise Texture (3D Perlin / Simplex FBM)
- Voronoi Texture (3D Worley Cellular / Distance to Edge)
- Wave Texture (3D Fan Veins / Anisotropic Furrows)
- Brick Texture + 3D Weathering Noise
を組み合わせて、シームレスな 3D ボリューム PBR マテリアル群を生成する。
"""

import os

import bpy


def clean_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh, do_unlink=True)
    for mat in list(bpy.data.materials):
        bpy.data.materials.remove(mat, do_unlink=True)


def ensure_node_tree(mat):
    # Why not: Blender 5.0+ では Material.new() 時点で node_tree が有効化されているため、
    # Blender 6.0 で削除予定の mat.use_nodes = True は node_tree が None の場合のみ呼ぶ。
    has_node_tree = mat.node_tree is not None
    if not has_node_tree:
        mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    return nodes, links


def create_road_3d_texture_material():
    mat = bpy.data.materials.new(name="JapaneseRoadPBR_3D")
    nodes, links = ensure_node_tree(mat)

    node_out = nodes.new(type="ShaderNodeOutputMaterial")
    node_out.location = (920, 0)

    node_bsdf = nodes.new(type="ShaderNodeBsdfPrincipled")
    node_bsdf.location = (620, 0)
    links.new(node_bsdf.outputs["BSDF"], node_out.inputs["Surface"])

    node_tex_coord = nodes.new(type="ShaderNodeTexCoord")
    node_tex_coord.location = (-920, 0)

    node_mapping = nodes.new(type="ShaderNodeMapping")
    node_mapping.location = (-720, 0)
    node_mapping.inputs["Scale"].default_value = (10.0, 10.0, 10.0)
    links.new(node_tex_coord.outputs["Object"], node_mapping.inputs["Vector"])

    # 3D Voronoi Texture 1: 粗骨材（砕石 13mm セルハイト）
    node_coarse_voronoi = nodes.new(type="ShaderNodeTexVoronoi")
    node_coarse_voronoi.name = "Coarse_Aggregate_Voronoi_3D"
    node_coarse_voronoi.location = (-420, 320)
    node_coarse_voronoi.voronoi_dimensions = "3D"
    node_coarse_voronoi.feature = "F1"
    node_coarse_voronoi.inputs["Scale"].default_value = 32.0
    links.new(node_mapping.outputs["Vector"], node_coarse_voronoi.inputs["Vector"])

    # 3D Voronoi Texture 2: 細骨材（砕石 5mm セルハイト）
    node_fine_voronoi = nodes.new(type="ShaderNodeTexVoronoi")
    node_fine_voronoi.name = "Fine_Aggregate_Voronoi_3D"
    node_fine_voronoi.location = (-420, 80)
    node_fine_voronoi.voronoi_dimensions = "3D"
    node_fine_voronoi.feature = "F1"
    node_fine_voronoi.inputs["Scale"].default_value = 78.0
    links.new(node_mapping.outputs["Vector"], node_fine_voronoi.inputs["Vector"])

    # 3D Noise Texture: アスファルト歴青バインダー＆石英粒子ざらつき
    node_noise_3d = nodes.new(type="ShaderNodeTexNoise")
    node_noise_3d.name = "Asphalt_Grit_Noise_3D"
    node_noise_3d.location = (-420, -140)
    node_noise_3d.noise_dimensions = "3D"
    node_noise_3d.inputs["Scale"].default_value = 54.0
    node_noise_3d.inputs["Detail"].default_value = 10.0
    node_noise_3d.inputs["Roughness"].default_value = 0.76
    links.new(node_mapping.outputs["Vector"], node_noise_3d.inputs["Vector"])

    # 3D Voronoi Texture 3: 骨材間ボイド＆微細クラック (DISTANCE_TO_EDGE)
    node_voronoi_3d = nodes.new(type="ShaderNodeTexVoronoi")
    node_voronoi_3d.name = "Crack_Voronoi_3D"
    node_voronoi_3d.location = (-420, -360)
    node_voronoi_3d.voronoi_dimensions = "3D"
    node_voronoi_3d.feature = "DISTANCE_TO_EDGE"
    node_voronoi_3d.inputs["Scale"].default_value = 14.0
    links.new(node_mapping.outputs["Vector"], node_voronoi_3d.inputs["Vector"])

    # 粗骨材 + 細骨材 + 粒子ノイズを合成して砕石ハイトマップを構成
    node_agg_mix = nodes.new(type="ShaderNodeMix")
    node_agg_mix.data_type = "FLOAT"
    node_agg_mix.location = (-140, 220)
    node_agg_mix.inputs["Factor"].default_value = 0.45
    links.new(node_coarse_voronoi.outputs["Distance"], node_agg_mix.inputs[2])
    links.new(node_fine_voronoi.outputs["Distance"], node_agg_mix.inputs[3])

    node_height_mix = nodes.new(type="ShaderNodeMix")
    node_height_mix.data_type = "FLOAT"
    node_height_mix.location = (60, 120)
    node_height_mix.inputs["Factor"].default_value = 0.38
    links.new(node_agg_mix.outputs[0], node_height_mix.inputs[2])
    links.new(node_noise_3d.outputs["Fac"], node_height_mix.inputs[3])

    node_crack_ramp = nodes.new(type="ShaderNodeValToRGB")
    node_crack_ramp.location = (-120, -320)
    node_crack_ramp.color_ramp.elements[0].position = 0.03
    node_crack_ramp.color_ramp.elements[1].position = 0.15
    links.new(node_voronoi_3d.outputs["Distance"], node_crack_ramp.inputs["Fac"])

    node_bump = nodes.new(type="ShaderNodeBump")
    node_bump.location = (320, -160)
    node_bump.inputs["Strength"].default_value = 0.58
    node_bump.inputs["Distance"].default_value = 0.06
    links.new(node_height_mix.outputs[0], node_bump.inputs["Height"])
    links.new(node_bump.outputs["Normal"], node_bsdf.inputs["Normal"])

    node_color_mix = nodes.new(type="ShaderNodeMix")
    node_color_mix.data_type = "RGBA"
    node_color_mix.location = (300, 160)
    node_color_mix.inputs[6].default_value = (0.10, 0.11, 0.13, 1.0)
    node_color_mix.inputs[7].default_value = (0.23, 0.24, 0.27, 1.0)
    links.new(node_height_mix.outputs[0], node_color_mix.inputs["Factor"])
    links.new(node_color_mix.outputs[2], node_bsdf.inputs["Base Color"])

    node_bsdf.inputs["Roughness"].default_value = 0.82
    node_bsdf.inputs["Metallic"].default_value = 0.10

    return mat


def create_ginkgo_foliage_3d_material():
    mat = bpy.data.materials.new(name="GinkgoFoliagePBR_3D")
    nodes, links = ensure_node_tree(mat)

    node_out = nodes.new(type="ShaderNodeOutputMaterial")
    node_out.location = (800, 0)

    node_bsdf = nodes.new(type="ShaderNodeBsdfPrincipled")
    node_bsdf.location = (500, 0)
    links.new(node_bsdf.outputs["BSDF"], node_out.inputs["Surface"])

    node_tex_coord = nodes.new(type="ShaderNodeTexCoord")
    node_tex_coord.location = (-800, 0)

    # 3D Noise Texture (樹冠の黄金グラデーション・紅葉斑)
    node_noise_3d = nodes.new(type="ShaderNodeTexNoise")
    node_noise_3d.location = (-350, 180)
    node_noise_3d.noise_dimensions = "3D"
    node_noise_3d.inputs["Scale"].default_value = 4.5
    node_noise_3d.inputs["Detail"].default_value = 6.0
    links.new(node_tex_coord.outputs["Object"], node_noise_3d.inputs["Vector"])

    # 3D Wave Texture (イチョウ扇形平行葉脈)
    node_wave_3d = nodes.new(type="ShaderNodeTexWave")
    node_wave_3d.location = (-350, -140)
    node_wave_3d.wave_type = "BANDS"
    node_wave_3d.inputs["Scale"].default_value = 28.0
    node_wave_3d.inputs["Distortion"].default_value = 2.4
    links.new(node_tex_coord.outputs["Object"], node_wave_3d.inputs["Vector"])

    node_color_mix = nodes.new(type="ShaderNodeMix")
    node_color_mix.data_type = "RGBA"
    node_color_mix.location = (180, 140)
    node_color_mix.inputs[6].default_value = (0.85, 0.62, 0.04, 1.0)
    node_color_mix.inputs[7].default_value = (0.98, 0.84, 0.18, 1.0)
    links.new(node_noise_3d.outputs["Fac"], node_color_mix.inputs["Factor"])
    links.new(node_color_mix.outputs[2], node_bsdf.inputs["Base Color"])

    node_bump = nodes.new(type="ShaderNodeBump")
    node_bump.location = (220, -120)
    node_bump.inputs["Strength"].default_value = 0.22
    links.new(node_wave_3d.outputs["Fac"], node_bump.inputs["Height"])
    links.new(node_bump.outputs["Normal"], node_bsdf.inputs["Normal"])

    node_bsdf.inputs["Roughness"].default_value = 0.46
    return mat


def create_ginkgo_bark_3d_material():
    mat = bpy.data.materials.new(name="GinkgoBarkPBR_3D")
    nodes, links = ensure_node_tree(mat)

    node_out = nodes.new(type="ShaderNodeOutputMaterial")
    node_out.location = (800, 0)

    node_bsdf = nodes.new(type="ShaderNodeBsdfPrincipled")
    node_bsdf.location = (500, 0)
    links.new(node_bsdf.outputs["BSDF"], node_out.inputs["Surface"])

    node_tex_coord = nodes.new(type="ShaderNodeTexCoord")
    node_tex_coord.location = (-800, 0)

    # 異方性3Dスケール（縦溝樹皮）
    node_mapping = nodes.new(type="ShaderNodeMapping")
    node_mapping.location = (-580, 0)
    node_mapping.inputs["Scale"].default_value = (14.0, 14.0, 2.2)
    links.new(node_tex_coord.outputs["Object"], node_mapping.inputs["Vector"])

    node_voronoi = nodes.new(type="ShaderNodeTexVoronoi")
    node_voronoi.location = (-300, 120)
    node_voronoi.voronoi_dimensions = "3D"
    node_voronoi.feature = "F1"
    node_voronoi.inputs["Scale"].default_value = 3.8
    links.new(node_mapping.outputs["Vector"], node_voronoi.inputs["Vector"])

    node_color_mix = nodes.new(type="ShaderNodeMix")
    node_color_mix.data_type = "RGBA"
    node_color_mix.location = (180, 140)
    node_color_mix.inputs[6].default_value = (0.15, 0.09, 0.06, 1.0)
    node_color_mix.inputs[7].default_value = (0.42, 0.30, 0.23, 1.0)
    links.new(node_voronoi.outputs["Distance"], node_color_mix.inputs["Factor"])
    links.new(node_color_mix.outputs[2], node_bsdf.inputs["Base Color"])

    node_bump = nodes.new(type="ShaderNodeBump")
    node_bump.location = (220, -140)
    node_bump.inputs["Strength"].default_value = 0.65
    links.new(node_voronoi.outputs["Distance"], node_bump.inputs["Height"])
    links.new(node_bump.outputs["Normal"], node_bsdf.inputs["Normal"])

    node_bsdf.inputs["Roughness"].default_value = 0.88
    return mat


def create_architecture_brick_granite_3d_material():
    mat = bpy.data.materials.new(name="TokyoStationBrickGranitePBR_3D")
    nodes, links = ensure_node_tree(mat)

    node_out = nodes.new(type="ShaderNodeOutputMaterial")
    node_out.location = (800, 0)

    node_bsdf = nodes.new(type="ShaderNodeBsdfPrincipled")
    node_bsdf.location = (500, 0)
    links.new(node_bsdf.outputs["BSDF"], node_out.inputs["Surface"])

    node_tex_coord = nodes.new(type="ShaderNodeTexCoord")
    node_tex_coord.location = (-800, 0)

    node_noise_3d = nodes.new(type="ShaderNodeTexNoise")
    node_noise_3d.location = (-320, 160)
    node_noise_3d.noise_dimensions = "3D"
    node_noise_3d.inputs["Scale"].default_value = 18.0
    node_noise_3d.inputs["Detail"].default_value = 6.0
    links.new(node_tex_coord.outputs["Object"], node_noise_3d.inputs["Vector"])

    node_voronoi_3d = nodes.new(type="ShaderNodeTexVoronoi")
    node_voronoi_3d.location = (-320, -160)
    node_voronoi_3d.voronoi_dimensions = "3D"
    node_voronoi_3d.inputs["Scale"].default_value = 32.0
    links.new(node_tex_coord.outputs["Object"], node_voronoi_3d.inputs["Vector"])

    node_color_mix = nodes.new(type="ShaderNodeMix")
    node_color_mix.data_type = "RGBA"
    node_color_mix.location = (180, 140)
    node_color_mix.inputs[6].default_value = (0.58, 0.14, 0.11, 1.0)
    node_color_mix.inputs[7].default_value = (0.76, 0.22, 0.17, 1.0)
    links.new(node_noise_3d.outputs["Fac"], node_color_mix.inputs["Factor"])
    links.new(node_color_mix.outputs[2], node_bsdf.inputs["Base Color"])

    node_bump = nodes.new(type="ShaderNodeBump")
    node_bump.location = (220, -140)
    node_bump.inputs["Strength"].default_value = 0.38
    links.new(node_voronoi_3d.outputs["Distance"], node_bump.inputs["Height"])
    links.new(node_bump.outputs["Normal"], node_bsdf.inputs["Normal"])

    node_bsdf.inputs["Roughness"].default_value = 0.76
    return mat


def create_crown_wood_3d_material():
    """トヨタ クラウン セダン（AZSH32）アイランドアーキテクチャー用 3D 杢目調「ウッディブラウン」マテリアル"""
    mat = bpy.data.materials.new(name="CrownWoodGrainPBR_3D")
    nodes, links = ensure_node_tree(mat)

    node_out = nodes.new(type="ShaderNodeOutputMaterial")
    node_out.location = (820, 0)

    node_bsdf = nodes.new(type="ShaderNodeBsdfPrincipled")
    node_bsdf.location = (520, 0)
    links.new(node_bsdf.outputs["BSDF"], node_out.inputs["Surface"])

    node_tex_coord = nodes.new(type="ShaderNodeTexCoord")
    node_tex_coord.location = (-860, 0)

    node_mapping = nodes.new(type="ShaderNodeMapping")
    node_mapping.location = (-640, 0)
    node_mapping.inputs["Scale"].default_value = (6.0, 18.0, 9.0)
    links.new(node_tex_coord.outputs["Object"], node_mapping.inputs["Vector"])

    # 3D Wave Texture (オープンポア杢目の導管バンド)
    node_wave_3d = nodes.new(type="ShaderNodeTexWave")
    node_wave_3d.location = (-360, 180)
    node_wave_3d.wave_type = "RINGS"
    node_wave_3d.rings_direction = "SPHERICAL"
    node_wave_3d.inputs["Scale"].default_value = 4.2
    node_wave_3d.inputs["Distortion"].default_value = 6.8
    node_wave_3d.inputs["Detail"].default_value = 5.0
    links.new(node_mapping.outputs["Vector"], node_wave_3d.inputs["Vector"])

    # 3D Noise Texture (微細導管繊維)
    node_noise_3d = nodes.new(type="ShaderNodeTexNoise")
    node_noise_3d.location = (-360, -140)
    node_noise_3d.noise_dimensions = "3D"
    node_noise_3d.inputs["Scale"].default_value = 28.0
    node_noise_3d.inputs["Detail"].default_value = 6.0
    links.new(node_mapping.outputs["Vector"], node_noise_3d.inputs["Vector"])

    node_color_mix = nodes.new(type="ShaderNodeMix")
    node_color_mix.data_type = "RGBA"
    node_color_mix.location = (180, 160)
    node_color_mix.inputs[6].default_value = (0.16, 0.085, 0.045, 1.0)
    node_color_mix.inputs[7].default_value = (0.36, 0.20, 0.105, 1.0)
    links.new(node_wave_3d.outputs["Fac"], node_color_mix.inputs["Factor"])
    links.new(node_color_mix.outputs[2], node_bsdf.inputs["Base Color"])

    node_bump = nodes.new(type="ShaderNodeBump")
    node_bump.location = (220, -140)
    node_bump.inputs["Strength"].default_value = 0.24
    node_bump.inputs["Distance"].default_value = 0.015
    links.new(node_noise_3d.outputs["Fac"], node_bump.inputs["Height"])
    links.new(node_bump.outputs["Normal"], node_bsdf.inputs["Normal"])

    node_bsdf.inputs["Roughness"].default_value = 0.34
    if "Coat Weight" in node_bsdf.inputs:
        node_bsdf.inputs["Coat Weight"].default_value = 0.45
    return mat


def create_crown_leather_3d_material():
    """トヨタ クラウン セダン（AZSH32）セミアニリン本革シボ＆パンチングレザー 3D マテリアル"""
    mat = bpy.data.materials.new(name="CrownLeatherGrainPBR_3D")
    nodes, links = ensure_node_tree(mat)

    node_out = nodes.new(type="ShaderNodeOutputMaterial")
    node_out.location = (820, 0)

    node_bsdf = nodes.new(type="ShaderNodeBsdfPrincipled")
    node_bsdf.location = (520, 0)
    links.new(node_bsdf.outputs["BSDF"], node_out.inputs["Surface"])

    node_tex_coord = nodes.new(type="ShaderNodeTexCoord")
    node_tex_coord.location = (-860, 0)

    node_mapping = nodes.new(type="ShaderNodeMapping")
    node_mapping.location = (-640, 0)
    node_mapping.inputs["Scale"].default_value = (24.0, 24.0, 24.0)
    links.new(node_tex_coord.outputs["Object"], node_mapping.inputs["Vector"])

    # 3D Voronoi Texture (ペブル本革シボのセル凹凸)
    node_voronoi_3d = nodes.new(type="ShaderNodeTexVoronoi")
    node_voronoi_3d.location = (-340, 160)
    node_voronoi_3d.voronoi_dimensions = "3D"
    node_voronoi_3d.feature = "F1"
    node_voronoi_3d.inputs["Scale"].default_value = 18.0
    links.new(node_mapping.outputs["Vector"], node_voronoi_3d.inputs["Vector"])

    # 3D Noise Texture (本革の微細毛穴・柔らかな光沢ムラ)
    node_noise_3d = nodes.new(type="ShaderNodeTexNoise")
    node_noise_3d.location = (-340, -140)
    node_noise_3d.noise_dimensions = "3D"
    node_noise_3d.inputs["Scale"].default_value = 42.0
    node_noise_3d.inputs["Detail"].default_value = 5.0
    links.new(node_mapping.outputs["Vector"], node_noise_3d.inputs["Vector"])

    node_color_mix = nodes.new(type="ShaderNodeMix")
    node_color_mix.data_type = "RGBA"
    node_color_mix.location = (180, 150)
    node_color_mix.inputs[6].default_value = (0.11, 0.115, 0.135, 1.0)
    node_color_mix.inputs[7].default_value = (0.18, 0.19, 0.22, 1.0)
    links.new(node_noise_3d.outputs["Fac"], node_color_mix.inputs["Factor"])
    links.new(node_color_mix.outputs[2], node_bsdf.inputs["Base Color"])

    node_bump = nodes.new(type="ShaderNodeBump")
    node_bump.location = (220, -140)
    node_bump.inputs["Strength"].default_value = 0.28
    node_bump.inputs["Distance"].default_value = 0.010
    links.new(node_voronoi_3d.outputs["Distance"], node_bump.inputs["Height"])
    links.new(node_bump.outputs["Normal"], node_bsdf.inputs["Normal"])

    node_bsdf.inputs["Roughness"].default_value = 0.52
    return mat


def create_shibuya_stream_3d_material():
    """渋谷ストリーム（Shibuya Stream）白アルミカーテンウォールパネル＆打放しコンクリート 3D マテリアル"""
    mat = bpy.data.materials.new(name="ShibuyaStreamFacadePBR_3D")
    nodes, links = ensure_node_tree(mat)

    node_out = nodes.new(type="ShaderNodeOutputMaterial")
    node_out.location = (820, 0)

    node_bsdf = nodes.new(type="ShaderNodeBsdfPrincipled")
    node_bsdf.location = (520, 0)
    links.new(node_bsdf.outputs["BSDF"], node_out.inputs["Surface"])

    node_tex_coord = nodes.new(type="ShaderNodeTexCoord")
    node_tex_coord.location = (-860, 0)

    node_mapping = nodes.new(type="ShaderNodeMapping")
    node_mapping.location = (-640, 0)
    node_mapping.inputs["Scale"].default_value = (4.0, 4.0, 18.0)
    links.new(node_tex_coord.outputs["Object"], node_mapping.inputs["Vector"])

    # 3D Wave Texture (白アルミパネルの異方性縦ヘアライン＆溶融亜鉛めっきスパングル)
    node_wave_3d = nodes.new(type="ShaderNodeTexWave")
    node_wave_3d.location = (-340, 160)
    node_wave_3d.wave_type = "BANDS"
    node_wave_3d.inputs["Scale"].default_value = 22.0
    node_wave_3d.inputs["Distortion"].default_value = 1.6
    links.new(node_mapping.outputs["Vector"], node_wave_3d.inputs["Vector"])

    # 3D Voronoi Texture (アルミカーテンウォールのパネル目地・リベット境界)
    node_voronoi_3d = nodes.new(type="ShaderNodeTexVoronoi")
    node_voronoi_3d.location = (-340, -140)
    node_voronoi_3d.voronoi_dimensions = "3D"
    node_voronoi_3d.feature = "DISTANCE_TO_EDGE"
    node_voronoi_3d.inputs["Scale"].default_value = 8.5
    links.new(node_mapping.outputs["Vector"], node_voronoi_3d.inputs["Vector"])

    node_color_mix = nodes.new(type="ShaderNodeMix")
    node_color_mix.data_type = "RGBA"
    node_color_mix.location = (180, 150)
    node_color_mix.inputs[6].default_value = (0.86, 0.89, 0.93, 1.0)
    node_color_mix.inputs[7].default_value = (0.96, 0.98, 1.00, 1.0)
    links.new(node_wave_3d.outputs["Fac"], node_color_mix.inputs["Factor"])
    links.new(node_color_mix.outputs[2], node_bsdf.inputs["Base Color"])

    node_bump = nodes.new(type="ShaderNodeBump")
    node_bump.location = (220, -140)
    node_bump.inputs["Strength"].default_value = 0.22
    node_bump.inputs["Distance"].default_value = 0.012
    links.new(node_voronoi_3d.outputs["Distance"], node_bump.inputs["Height"])
    links.new(node_bump.outputs["Normal"], node_bsdf.inputs["Normal"])

    node_bsdf.inputs["Roughness"].default_value = 0.24
    node_bsdf.inputs["Metallic"].default_value = 0.32
    if "Coat Weight" in node_bsdf.inputs:
        node_bsdf.inputs["Coat Weight"].default_value = 0.45
    return mat


def main():
    print("=== Generating 3D Procedural PBR Materials in Blender ===")
    clean_scene()

    materials = [
        create_road_3d_texture_material(),
        create_ginkgo_foliage_3d_material(),
        create_ginkgo_bark_3d_material(),
        create_architecture_brick_granite_3d_material(),
        create_crown_wood_3d_material(),
        create_crown_leather_3d_material(),
        create_shibuya_stream_3d_material(),
    ]

    for idx, mat in enumerate(materials):
        print(f"Material created successfully: {mat.name}")
        bpy.ops.mesh.primitive_plane_add(size=6.0, location=(idx * 7.5, 0, 0))
        plane = bpy.context.active_object
        plane.name = f"Preview_{mat.name}"
        plane.data.materials.append(mat)

    output_blend = os.path.join(os.path.dirname(__file__), "..", "output", "road_3d_material.blend")
    os.makedirs(os.path.dirname(output_blend), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=output_blend)
    print(f"Saved 3D procedural texture blend file to: {output_blend}")


if __name__ == "__main__":
    main()

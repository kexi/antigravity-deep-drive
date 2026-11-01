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

import bpy
import os


def clean_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


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
    node_out.location = (800, 0)

    node_bsdf = nodes.new(type="ShaderNodeBsdfPrincipled")
    node_bsdf.location = (500, 0)
    links.new(node_bsdf.outputs["BSDF"], node_out.inputs["Surface"])

    node_tex_coord = nodes.new(type="ShaderNodeTexCoord")
    node_tex_coord.location = (-800, 0)

    node_mapping = nodes.new(type="ShaderNodeMapping")
    node_mapping.location = (-600, 0)
    node_mapping.inputs["Scale"].default_value = (8.0, 8.0, 8.0)
    links.new(node_tex_coord.outputs["Object"], node_mapping.inputs["Vector"])

    # 3D Noise Texture (アスファルト骨材粒度)
    node_noise_3d = nodes.new(type="ShaderNodeTexNoise")
    node_noise_3d.location = (-300, 200)
    node_noise_3d.noise_dimensions = "3D"
    node_noise_3d.inputs["Scale"].default_value = 45.0
    node_noise_3d.inputs["Detail"].default_value = 8.0
    node_noise_3d.inputs["Roughness"].default_value = 0.72
    links.new(node_mapping.outputs["Vector"], node_noise_3d.inputs["Vector"])

    # 3D Voronoi Texture (アスファルト微細クラック・水たまり盆地)
    node_voronoi_3d = nodes.new(type="ShaderNodeTexVoronoi")
    node_voronoi_3d.location = (-300, -200)
    node_voronoi_3d.voronoi_dimensions = "3D"
    node_voronoi_3d.feature = "DISTANCE_TO_EDGE"
    node_voronoi_3d.inputs["Scale"].default_value = 6.5
    links.new(node_mapping.outputs["Vector"], node_voronoi_3d.inputs["Vector"])

    node_crack_ramp = nodes.new(type="ShaderNodeValToRGB")
    node_crack_ramp.location = (0, -200)
    node_crack_ramp.color_ramp.elements[0].position = 0.04
    node_crack_ramp.color_ramp.elements[1].position = 0.16
    links.new(node_voronoi_3d.outputs["Distance"], node_crack_ramp.inputs["Fac"])

    node_bump = nodes.new(type="ShaderNodeBump")
    node_bump.location = (250, -150)
    node_bump.inputs["Strength"].default_value = 0.45
    node_bump.inputs["Distance"].default_value = 0.08
    links.new(node_noise_3d.outputs["Fac"], node_bump.inputs["Height"])
    links.new(node_bump.outputs["Normal"], node_bsdf.inputs["Normal"])

    node_color_mix = nodes.new(type="ShaderNodeMix")
    node_color_mix.data_type = "RGBA"
    node_color_mix.location = (200, 150)
    node_color_mix.inputs[6].default_value = (0.11, 0.12, 0.14, 1.0)
    node_color_mix.inputs[7].default_value = (0.21, 0.22, 0.25, 1.0)
    links.new(node_noise_3d.outputs["Fac"], node_color_mix.inputs["Factor"])
    links.new(node_color_mix.outputs[2], node_bsdf.inputs["Base Color"])

    node_bsdf.inputs["Roughness"].default_value = 0.84
    node_bsdf.inputs["Metallic"].default_value = 0.08

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


def main():
    print("=== Generating 3D Procedural PBR Materials in Blender ===")
    clean_scene()

    materials = [
        create_road_3d_texture_material(),
        create_ginkgo_foliage_3d_material(),
        create_ginkgo_bark_3d_material(),
        create_architecture_brick_granite_3d_material(),
    ]

    for idx, mat in enumerate(materials):
        print(f"Material created successfully: {mat.name}")
        bpy.ops.mesh.primitive_plane_add(size=6.0, location=(idx * 7.5, 0, 0))
        plane = bpy.context.active_object
        plane.name = f"Preview_{mat.name}"
        plane.data.materials.append(mat)

    output_blend = os.path.join(
        os.path.dirname(__file__), "..", "output", "road_3d_material.blend"
    )
    os.makedirs(os.path.dirname(output_blend), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=output_blend)
    print(f"Saved 3D procedural texture blend file to: {output_blend}")


if __name__ == "__main__":
    main()

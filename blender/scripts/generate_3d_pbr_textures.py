"""
Blender Procedural 3D Texture Generator
Tokyo Station Deep Drive - 道路PBR 3Dテクスチャ生成スクリプト

Blender の 3D プロシージャルテクスチャノード:
- Noise Texture (3D Perlin / Simplex)
- Voronoi Texture (3D Worley Cellular / Distance to Edge)
- Wave / Musgrave Texture
を組み合わせて、日本のリアルな道路用 PBR マテリアルを生成。
"""

import bpy
import os
import sys

def clean_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def create_road_3d_texture_material():
    mat = bpy.data.materials.new(name="JapaneseRoadPBR_3D")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()

    # 1. Output Node
    node_out = nodes.new(type="ShaderNodeOutputMaterial")
    node_out.location = (800, 0)

    # 2. Principled BSDF
    node_bsdf = nodes.new(type="ShaderNodeBsdfPrincipled")
    node_bsdf.location = (500, 0)
    links.new(node_bsdf.outputs["BSDF"], node_out.inputs["Surface"])

    # 3. Texture Coordinate (Object / Generated 3D Space)
    node_tex_coord = nodes.new(type="ShaderNodeTexCoord")
    node_tex_coord.location = (-800, 0)

    # 4. Mapping Node (3D Scale)
    node_mapping = nodes.new(type="ShaderNodeMapping")
    node_mapping.location = (-600, 0)
    node_mapping.inputs["Scale"].default_value = (8.0, 8.0, 8.0)
    links.new(node_tex_coord.outputs["Object"], node_mapping.inputs["Vector"])

    # 5. Noise Texture (3D - アスファルト骨材)
    node_noise_3d = nodes.new(type="ShaderNodeTexNoise")
    node_noise_3d.location = (-300, 200)
    node_noise_3d.noise_dimensions = "3D"
    node_noise_3d.inputs["Scale"].default_value = 45.0
    node_noise_3d.inputs["Detail"].default_value = 8.0
    node_noise_3d.inputs["Roughness"].default_value = 0.7
    links.new(node_mapping.outputs["Vector"], node_noise_3d.inputs["Vector"])

    # 6. Voronoi Texture (3D - ひび割れ・クラック)
    node_voronoi_3d = nodes.new(type="ShaderNodeTexVoronoi")
    node_voronoi_3d.location = (-300, -200)
    node_voronoi_3d.voronoi_dimensions = "3D"
    node_voronoi_3d.feature = "DISTANCE_TO_EDGE"
    node_voronoi_3d.inputs["Scale"].default_value = 6.0
    links.new(node_mapping.outputs["Vector"], node_voronoi_3d.inputs["Vector"])

    # 7. ColorRamp (クラックのシャープネス調整)
    node_crack_ramp = nodes.new(type="ShaderNodeValToRGB")
    node_crack_ramp.location = (0, -200)
    node_crack_ramp.color_ramp.elements[0].position = 0.05
    node_crack_ramp.color_ramp.elements[1].position = 0.15
    links.new(node_voronoi_3d.outputs["Distance"], node_crack_ramp.inputs["Fac"])

    # 8. Bump Node (法線マップバンプ)
    node_bump = nodes.new(type="ShaderNodeBump")
    node_bump.location = (250, -150)
    node_bump.inputs["Strength"].default_value = 0.45
    node_bump.inputs["Distance"].default_value = 0.1
    links.new(node_noise_3d.outputs["Fac"], node_bump.inputs["Height"])
    links.new(node_bump.outputs["Normal"], node_bsdf.inputs["Normal"])

    # 9. カラー調整 (濃淡アスファルトグレー)
    node_color_mix = nodes.new(type="ShaderNodeMix")
    node_color_mix.data_type = "RGBA"
    node_color_mix.location = (200, 150)
    node_color_mix.inputs[6].default_value = (0.12, 0.13, 0.15, 1.0) # Base dark
    node_color_mix.inputs[7].default_value = (0.22, 0.23, 0.26, 1.0) # Light patch
    links.new(node_noise_3d.outputs["Fac"], node_color_mix.inputs["Factor"])
    links.new(node_color_mix.outputs[2], node_bsdf.inputs["Base Color"])

    # ラフネス設定
    node_bsdf.inputs["Roughness"].default_value = 0.85
    node_bsdf.inputs["Metallic"].default_value = 0.1

    return mat

def main():
    print("=== Generating 3D Texture PBR Road Material in Blender ===")
    clean_scene()
    mat = create_road_3d_texture_material()
    print(f"Material created successfully: {mat.name}")

    # プレビュー用平面を作成してアサイン
    bpy.ops.mesh.primitive_plane_add(size=10.0, location=(0, 0, 0))
    plane = bpy.context.active_object
    plane.data.materials.append(mat)

    output_blend = os.path.join(os.path.dirname(__file__), "..", "output", "road_3d_material.blend")
    os.makedirs(os.path.dirname(output_blend), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=output_blend)
    print(f"Saved 3D procedural texture blend file to: {output_blend}")

if __name__ == "__main__":
    main()

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
渋谷ストリーム（Shibuya Stream）高精度 3D モデル生成スクリプト
実寸 180.0m（地上35階）・シーラカンスアンドアソシエイツ（CAt）設計の特徴的な外観を忠実に再現：
1. 高層オフィスタワー（14F〜35F, Z=66m〜168m）:
   - Low-E ブルーグレー反射ガラスカーテンウォール + 白アルミパネルの「ストリーム（水流）」スタガード格子
   - 屋上（Z=168m〜180m）の溶融亜鉛めっき鉄骨オープンフレーム（ブレース付き冠部）＆屋上緑化
2. 中層ボイド＆ホテル層（7F〜13F, Z=32m〜66m）:
   - 深いチャコールグレーの吹き抜けボイド層 + 垂直壁面緑化（グリーンウォール）＆白縦ルーバーの交互配置
   - 9F〜13F の高密度縦マリオン・ガラスバンド
3. 低層商業ポディウム・歩行者デッキ・稲荷橋広場大階段（1F〜6F, Z=0m〜32m）:
   - 1F ピロティ円柱列、キャンチレバーで張り出すガラスキューブ群、北西角の円筒ガラスパビリオン
   - 2F/3F ペデストリアンデッキと稲荷橋広場へ降りる大階段
4. 渋谷ストリーム建築サイン＆ライムイエロー・ストリームアクセント（ShibuyaStream_Signage）:
   - 高層ファサード4面（Z=152m）、中層ポディウム冠部（Z=29.2m）、低層2Fエントランスキャノピー（Z=10.6m）、
     および明治通り沿い稲荷橋広場アイレベル・モニュメントサイン（Z=2.35m）に、
     渋谷ストリーム固有のライムイエロー・ストリームライン＆ホワイトアルミ建築サインを配置。
"""

import json
import math
import os

import bpy

# isort: split
# Why not: bpy 単体 wheel (PyPI) では import bpy 実行時に初めて bmesh / mathutils が
# sys.modules に登録されるため、アルファベット順で bmesh を先に import すると ModuleNotFoundError になる。
import bmesh
from mathutils import Vector


def clean_scene():
    """既存の全オブジェクト・メッシュ・マテリアルをクリアする"""
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh, do_unlink=True)
    for mat in list(bpy.data.materials):
        bpy.data.materials.remove(mat, do_unlink=True)


def create_material(
    name: str,
    base_color: tuple,
    roughness: float = 0.5,
    metallic: float = 0.0,
    emission_color: tuple | None = None,
    emission_strength: float = 0.0,
    coat_weight: float = 0.0,
    image_path: str | None = None,
) -> bpy.types.Material:
    """Blender 5.0+ Principled BSDF マテリアルを作成する（実写テクスチャ画像パス指定対応）"""
    mat = bpy.data.materials.new(name=name)
    has_node_tree = mat.node_tree is not None
    if not has_node_tree:
        mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf:
        bsdf.inputs["Base Color"].default_value = base_color
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
        if coat_weight > 0.0 and "Coat Weight" in bsdf.inputs:
            bsdf.inputs["Coat Weight"].default_value = coat_weight
        if emission_color is not None and "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = emission_color
            bsdf.inputs["Emission Strength"].default_value = emission_strength

        if image_path:
            script_dir = os.path.dirname(os.path.abspath(__file__))
            project_root = os.path.abspath(os.path.join(script_dir, "..", ".."))
            full_img_path = os.path.join(project_root, image_path.lstrip("/"))
            if os.path.exists(full_img_path):
                tex_node = nodes.new(type="ShaderNodeTexImage")
                img = bpy.data.images.load(full_img_path)
                tex_node.image = img
                links.new(tex_node.outputs["Color"], bsdf.inputs["Base Color"])
                if emission_strength > 0.0 and "Emission Color" in bsdf.inputs:
                    links.new(tex_node.outputs["Color"], bsdf.inputs["Emission Color"])
    return mat


def setup_materials() -> dict[str, bpy.types.Material]:
    """実写の渋谷ストリーム（Shibuya Stream）および実写ストリートビューに基づく PBR マテリアル群を構築する"""
    mats = {
        # 0: 白アルミカーテンウォールパネル（渋谷ストリーム象徴の白い縦横ランダムフィン）
        "StreamWhitePanel": create_material(
            "StreamWhitePanel",
            base_color=(0.93, 0.95, 0.97, 1.0),
            roughness=0.26,
            metallic=0.28,
            coat_weight=0.35,
        ),
        # 1: 高層 Low-E ブルーグレー反射カーテンウォールガラス
        "StreamCurtainGlass": create_material(
            "StreamCurtainGlass",
            base_color=(0.24, 0.41, 0.56, 1.0),
            roughness=0.10,
            metallic=0.42,
            coat_weight=0.90,
        ),
        # 2: 中層ボイド・低層ピロティのダークチャコール鉄骨・打放しコンクリート
        "StreamDarkVoidSteel": create_material(
            "StreamDarkVoidSteel",
            base_color=(0.09, 0.11, 0.14, 1.0),
            roughness=0.48,
            metallic=0.52,
        ),
        # 3: 屋上オープンフレーム＆デッキ梁の溶融亜鉛めっき鋼材（シルバーグレー）
        "StreamGalvanizedFrame": create_material(
            "StreamGalvanizedFrame",
            base_color=(0.56, 0.60, 0.65, 1.0),
            roughness=0.38,
            metallic=0.72,
        ),
        # 4: 中層・低層ボイドの垂直壁面緑化（グリーンウォール植栽）
        "StreamVerticalGreen": create_material(
            "StreamVerticalGreen",
            base_color=(0.18, 0.34, 0.13, 1.0),
            roughness=0.84,
            metallic=0.0,
        ),
        # 5: 渋谷ストリーム ブランドアクセント（ライムイエロー）
        "StreamYellowAccent": create_material(
            "StreamYellowAccent",
            base_color=(0.84, 0.90, 0.08, 1.0),
            roughness=0.24,
            metallic=0.15,
            emission_color=(0.75, 0.82, 0.06, 1.0),
            emission_strength=0.65,
        ),
        # 6: 商業フロア・カフェ・オフィス窓のウォームインテリア発光ガラス
        "WarmPlazaGlow": create_material(
            "WarmPlazaGlow",
            base_color=(1.0, 0.90, 0.78, 1.0),
            roughness=0.18,
            metallic=0.10,
            emission_color=(1.0, 0.85, 0.60, 1.0),
            emission_strength=0.05,
        ),
        # 7: 航空障害灯レッド発光
        "BeaconRed": create_material(
            "BeaconRed",
            base_color=(1.0, 0.12, 0.08, 1.0),
            roughness=0.15,
            metallic=0.0,
            emission_color=(1.0, 0.15, 0.08, 1.0),
            emission_strength=3.2,
        ),
        # 8: 首都高速3号渋谷線・鉄道高架の重厚プレキャストコンクリート橋脚・遮音壁パネル
        "ShutokoConcretePier": create_material(
            "ShutokoConcretePier",
            base_color=(0.52, 0.55, 0.58, 1.0),
            roughness=0.76,
            metallic=0.08,
        ),
        # 9: 首都高速道路 緑案内標識ボード（実写ストリートビュー標識テクスチャ）
        "ShutokoHighwayGreenSign": create_material(
            "ShutokoHighwayGreenSign",
            base_color=(0.04, 0.42, 0.24, 1.0),
            roughness=0.35,
            metallic=0.10,
            emission_color=(0.05, 0.48, 0.28, 1.0),
            emission_strength=0.08,
            image_path="apps/web/public/textures/shibuya/shibuya_shutoko_sign.jpg",
        ),
        # 10: 渋谷スクランブルスクエア 屋上展望施設「SHIBUYA SKY」スカイエッジ発光ガラス＆ヘリポートライン
        "ShibuyaSkyEdgeGlow": create_material(
            "ShibuyaSkyEdgeGlow",
            base_color=(0.45, 0.82, 1.0, 1.0),
            roughness=0.12,
            metallic=0.25,
            emission_color=(0.38, 0.78, 1.0, 1.0),
            emission_strength=0.25,
        ),
        # 11: 渋谷ヒカリエ 東急シアターオーブ球体劇場＆首都高高架下アンバーナトリウム照明
        "HikarieGoldOrb": create_material(
            "HikarieGoldOrb",
            base_color=(0.92, 0.78, 0.42, 1.0),
            roughness=0.25,
            metallic=0.75,
            emission_color=(0.95, 0.75, 0.35, 1.0),
            emission_strength=0.0,
        ),
        # 12: 渋谷サクラステージ（Shibuya Sakura Stage）「KINETIC GATE（ときめきSTAGE）」チェリーピンク発光ガラス
        "SakuraStagePinkGlow": create_material(
            "SakuraStagePinkGlow",
            base_color=(1.0, 0.56, 0.68, 1.0),
            roughness=0.14,
            metallic=0.22,
            emission_color=(0.96, 0.32, 0.50, 1.0),
            emission_strength=0.25,
        ),
        # 13: SHIBUYA109 シリンダークラウン＆QFRONT 大型ビジョン マゼンタレッド発光アクセント
        "ShibuyaQfront109Accent": create_material(
            "ShibuyaQfront109Accent",
            base_color=(0.96, 0.14, 0.42, 1.0),
            roughness=0.16,
            metallic=0.28,
            emission_color=(1.0, 0.16, 0.45, 1.0),
            emission_strength=0.35,
        ),
        # 14: QFRONT 巨大湾曲LEDビジョン「Q'S EYE」＆TSUTAYA/スターバックス実写ストリートビューテクスチャ
        "ShibuyaQfrontMedia": create_material(
            "ShibuyaQfrontMedia",
            base_color=(0.20, 0.45, 0.70, 1.0),
            roughness=0.14,
            metallic=0.25,
            emission_color=(0.20, 0.45, 0.70, 1.0),
            emission_strength=0.35,
            image_path="apps/web/public/textures/shibuya/shibuya_qfront.jpg",
        ),
        # 15: SHIBUYA109 円筒クラウン「109」ロゴ＆ファサード実写ストリートビューテクスチャ
        "Shibuya109Crown": create_material(
            "Shibuya109Crown",
            base_color=(0.95, 0.22, 0.45, 1.0),
            roughness=0.18,
            metallic=0.28,
            emission_color=(0.95, 0.22, 0.45, 1.0),
            emission_strength=0.30,
            image_path="apps/web/public/textures/shibuya/shibuya_109.jpg",
        ),
        # 16: 渋谷スクランブルスクエア 東棟超高層ファサード実写ストリートビューテクスチャ
        "ShibuyaScrambleSquareFacade": create_material(
            "ShibuyaScrambleSquareFacade",
            base_color=(0.25, 0.38, 0.52, 1.0),
            roughness=0.12,
            metallic=0.45,
            image_path="apps/web/public/textures/shibuya/shibuya_scramble_square.jpg",
        ),
        # 17: 渋谷ストリーム 水流（Stream）千鳥ルーバーファサード実写ストリートビューテクスチャ
        "ShibuyaStreamFacade": create_material(
            "ShibuyaStreamFacade",
            base_color=(0.30, 0.48, 0.62, 1.0),
            roughness=0.22,
            metallic=0.32,
            image_path="apps/web/public/textures/shibuya/shibuya_stream.jpg",
        ),
        # 18: MIYASHITA PARK 商業ファサード＆渋谷横丁実写ストリートビューテクスチャ
        "ShibuyaMiyashitaParkFacade": create_material(
            "ShibuyaMiyashitaParkFacade",
            base_color=(0.35, 0.52, 0.38, 1.0),
            roughness=0.30,
            metallic=0.20,
            image_path="apps/web/public/textures/shibuya/shibuya_miyashita_park.jpg",
        ),
        # 19: 明治通り・国道246号 沿道商業ビル（コンビニ・ドラッグストア・飲食店）実写ストリートビューテクスチャ
        "ShibuyaCommercialFacade": create_material(
            "ShibuyaCommercialFacade",
            base_color=(0.48, 0.45, 0.42, 1.0),
            roughness=0.36,
            metallic=0.15,
            image_path="apps/web/public/textures/shibuya/shibuya_commercial_facade.jpg",
        ),
        # 20: 渋谷スクランブル交差点 屋外大型LEDビジョン＆ビルボード実写ストリートビューテクスチャ
        "ShibuyaCrossingBillboard": create_material(
            "ShibuyaCrossingBillboard",
            base_color=(0.15, 0.22, 0.38, 1.0),
            roughness=0.12,
            metallic=0.20,
            emission_color=(0.15, 0.22, 0.38, 1.0),
            emission_strength=0.45,
            image_path="apps/web/public/textures/shibuya/shibuya_billboards.jpg",
        ),
        # 21: 渋谷スクランブルスクエア 屋上ヘリポート着陸帯（緑色着陸パッド、道路案内標識ではない）
        "HeliportGreenPad": create_material(
            "HeliportGreenPad",
            base_color=(0.04, 0.45, 0.25, 1.0),
            roughness=0.55,
            metallic=0.08,
            emission_color=(0.04, 0.45, 0.25, 1.0),
            emission_strength=0.04,
        ),
        # 22: JR山手線・埼京線 跨道グリーンスチールトラス鉄道橋
        "JRGreenSteel": create_material(
            "JRGreenSteel",
            base_color=(0.06, 0.38, 0.20, 1.0),
            roughness=0.45,
            metallic=0.75,
        ),
        # 23: MAGNET by SHIBUYA109 巨大LEDビジョン「渋谷駅前ビジョン」＆ファサード実写ストリートビューテクスチャ
        "ShibuyaMagnetFacade": create_material(
            "ShibuyaMagnetFacade",
            base_color=(0.20, 0.30, 0.45, 1.0),
            roughness=0.15,
            metallic=0.25,
            emission_color=(0.20, 0.30, 0.45, 1.0),
            emission_strength=0.40,
            image_path="apps/web/public/textures/shibuya/shibuya_magnet.jpg",
        ),
        # 24: 渋谷マークシティ アルミルーバー＆スリット連窓実写ストリートビューテクスチャ
        "ShibuyaMarkCityFacade": create_material(
            "ShibuyaMarkCityFacade",
            base_color=(0.55, 0.58, 0.62, 1.0),
            roughness=0.32,
            metallic=0.40,
            image_path="apps/web/public/textures/shibuya/shibuya_mark_city.jpg",
        ),
        # 25: 渋谷東映プラザ / ビックカメラ渋谷東口店 赤白大サイン＆ファサード実写ストリートビューテクスチャ
        "ShibuyaToeiBicFacade": create_material(
            "ShibuyaToeiBicFacade",
            base_color=(0.85, 0.15, 0.15, 1.0),
            roughness=0.22,
            metallic=0.18,
            emission_color=(0.85, 0.15, 0.15, 1.0),
            emission_strength=0.35,
            image_path="apps/web/public/textures/shibuya/shibuya_toei_bic.jpg",
        ),
        # 26: 道玄坂・宮益坂 沿道商業ビル（飲食店・カラオケ・コンビニ・多層看板）実写ストリートビューテクスチャ
        "ShibuyaDogenzakaCommercialFacade": create_material(
            "ShibuyaDogenzakaCommercialFacade",
            base_color=(0.50, 0.46, 0.42, 1.0),
            roughness=0.36,
            metallic=0.18,
            emission_color=(0.50, 0.46, 0.42, 1.0),
            emission_strength=0.25,
            image_path="apps/web/public/textures/shibuya/shibuya_dogenzaka_commercial.jpg",
        ),
        # 27: 渋谷センター街 入口アーチメイン看板（CanvasTexture で「渋谷センター街 / SHIBUYA CENTER-GAI」を描画）
        "ShibuyaCenterGaiArchSign": create_material(
            "ShibuyaCenterGaiArchSign",
            base_color=(0.08, 0.22, 0.52, 1.0),
            roughness=0.22,
            metallic=0.25,
            emission_color=(0.95, 0.85, 0.65, 1.0),
            emission_strength=0.35,
        ),
        # 28: 渋谷センター街 街路灯ハンギングフラッグバナー（CanvasTexture 描画用）
        "ShibuyaCenterGaiBanner": create_material(
            "ShibuyaCenterGaiBanner",
            base_color=(0.14, 0.34, 0.72, 1.0),
            roughness=0.45,
            metallic=0.05,
            emission_color=(0.65, 0.78, 0.98, 1.0),
            emission_strength=0.22,
        ),
        # 29: 渋谷スクランブルスクエア 屋上「SHIBUYA SKY」CROSSING LIGHT 天頂サーチライト光柱
        "ShibuyaSkySearchlightGlow": create_material(
            "ShibuyaSkySearchlightGlow",
            base_color=(0.65, 0.95, 1.0, 0.7),
            roughness=0.05,
            metallic=0.0,
            emission_color=(0.35, 0.85, 1.0, 1.0),
            emission_strength=0.0,
        ),
        # 30: ハチ公像 ブロンズ鋳造像（落ち着いた経年青銅色・低彩度金属光沢）
        "HachikoBronze": create_material(
            "HachikoBronze",
            base_color=(0.26, 0.21, 0.14, 1.0),
            roughness=0.38,
            metallic=0.85,
        ),
        # 31: ハチ公像 御影石台座（ニュートラル花崗岩）
        "HachikoGranite": create_material(
            "HachikoGranite",
            base_color=(0.58, 0.56, 0.53, 1.0),
            roughness=0.72,
            metallic=0.04,
        ),
    }
    return mats


# 垂直壁面専用の建物テクスチャマテリアルインデックス（上面屋根に窓・看板が貼られるのを防止）
FACADE_WALL_MAT_INDICES = {14, 15, 16, 17, 18, 19, 23, 24, 25, 26}
# 4層×4スパン（16m×14m）でエッジ途切れなく整数倍反復するタイルファサードマテリアル
REPEATABLE_FACADE_MAT_INDICES = {16, 19, 26}


def add_box(
    bm: bmesh.types.BMesh,
    center: Vector,
    size: Vector,
    mat_idx: int = 0,
    cap_mat_idx: int | None = None,
    uv_rect: tuple[float, float, float, float] | None = None,
):
    """指定中心・サイズの直方体を bmesh に追加する（自動平面UV展開・屋上非ウォール保護・部分UV矩形指定付き）"""
    res = bmesh.ops.create_cube(bm, size=1.0)
    verts = res["verts"]
    bmesh.ops.scale(bm, vec=size, verts=verts)
    bmesh.ops.translate(bm, vec=center, verts=verts)
    uv_layer = bm.loops.layers.uv.verify()
    resolved_cap_mat = (
        cap_mat_idx
        if cap_mat_idx is not None
        else (2 if mat_idx in FACADE_WALL_MAT_INDICES else mat_idx)
    )
    created_faces = set()
    for v in verts:
        for f in v.link_faces:
            if f not in created_faces:
                created_faces.add(f)
                is_cap_face = abs(f.normal.z) > 0.8
                f.material_index = resolved_cap_mat if is_cap_face else mat_idx
                ax, ay, az = abs(f.normal.x), abs(f.normal.y), abs(f.normal.z)
                if ax >= ay and ax >= az:
                    coords = [(loop, loop.vert.co.y, loop.vert.co.z) for loop in f.loops]
                elif ay >= ax and ay >= az:
                    coords = [(loop, loop.vert.co.x, loop.vert.co.z) for loop in f.loops]
                else:
                    coords = [(loop, loop.vert.co.x, loop.vert.co.y) for loop in f.loops]
                min_u = min(c[1] for c in coords)
                max_u = max(c[1] for c in coords)
                min_v = min(c[2] for c in coords)
                max_v = max(c[2] for c in coords)
                ru = max_u - min_u if (max_u - min_u) > 1e-5 else 1.0
                rv = max_v - min_v if (max_v - min_v) > 1e-5 else 1.0
                flip_u = (ax >= ay and ax >= az and f.normal.x < 0.0) or (
                    ay > ax and ay >= az and f.normal.y > 0.0
                )
                rep_u = (
                    float(max(1, round(ru / 16.0)))
                    if (not is_cap_face and mat_idx in REPEATABLE_FACADE_MAT_INDICES)
                    else 1.0
                )
                rep_v = (
                    float(max(1, round(rv / 14.0)))
                    if (not is_cap_face and mat_idx in REPEATABLE_FACADE_MAT_INDICES)
                    else 1.0
                )
                for loop, u_raw, v_raw in coords:
                    u_norm = (u_raw - min_u) / ru
                    u_base = 1.0 - u_norm if flip_u else u_norm
                    v_base = (v_raw - min_v) / rv
                    if uv_rect is not None and not is_cap_face:
                        u_val = uv_rect[0] + u_base * (uv_rect[2] - uv_rect[0])
                        v_val = uv_rect[1] + v_base * (uv_rect[3] - uv_rect[1])
                    else:
                        u_val = u_base * rep_u
                        v_val = v_base * rep_v
                    loop[uv_layer].uv = Vector((u_val, v_val))


def add_oriented_box(
    bm: bmesh.types.BMesh,
    center: Vector,
    tangent_dir: Vector,
    normal_dir: Vector,
    size_tangent: float,
    size_normal: float,
    size_z: float,
    mat_idx: int = 0,
):
    """接線・法線・Z軸方向に整列した直方体を bmesh に追加する（自動UV展開付き）"""
    t = tangent_dir.normalized()
    n = normal_dir.normalized()
    up = Vector((0.0, 0.0, 1.0))

    ht = size_tangent * 0.5
    hn = size_normal * 0.5
    hz = size_z * 0.5

    offsets = [
        (-ht, -hn, -hz),
        (ht, -hn, -hz),
        (ht, hn, -hz),
        (-ht, hn, -hz),
        (-ht, -hn, hz),
        (ht, -hn, hz),
        (ht, hn, hz),
        (-ht, hn, hz),
    ]
    v = [bm.verts.new(center + t * ox + n * oy + up * oz) for (ox, oy, oz) in offsets]
    quads = [
        (0, 3, 2, 1),
        (4, 5, 6, 7),
        (0, 1, 5, 4),
        (2, 3, 7, 6),
        (1, 2, 6, 5),
        (3, 0, 4, 7),
    ]
    uv_layer = bm.loops.layers.uv.verify()
    for q in quads:
        f = bm.faces.new([v[q[0]], v[q[1]], v[q[2]], v[q[3]]])
        f.material_index = mat_idx
        f.loops[0][uv_layer].uv = Vector((0.0, 0.0))
        f.loops[1][uv_layer].uv = Vector((1.0, 0.0))
        f.loops[2][uv_layer].uv = Vector((1.0, 1.0))
        f.loops[3][uv_layer].uv = Vector((0.0, 1.0))


def add_slanted_ribbon(
    bm: bmesh.types.BMesh,
    p_start: Vector,
    p_end: Vector,
    outward_normal: Vector,
    ribbon_width: float = 0.48,
    ribbon_depth: float = 0.55,
    mat_idx: int = 0,
):
    """
    傾斜した連続リボンルーバー（始点 p_start から終点 p_end、外向き法線 outward_normal）を生成する。
    隈研吾・日建設計のスクランブルスクエア斜めルーバー（26度連続スパイラルリボン）用。
    """
    v_dir = p_end - p_start
    length = v_dir.length
    if length < 1e-4:
        return
    t = v_dir.normalized()
    n = outward_normal.normalized()
    b = n.cross(t).normalized()

    center = (p_start + p_end) * 0.5
    hl = length * 0.5
    hw = ribbon_width * 0.5
    hd = ribbon_depth * 0.5

    offsets = [
        -t * hl - b * hw - n * hd,
        t * hl - b * hw - n * hd,
        t * hl + b * hw - n * hd,
        -t * hl + b * hw - n * hd,
        -t * hl - b * hw + n * hd,
        t * hl - b * hw + n * hd,
        t * hl + b * hw + n * hd,
        -t * hl + b * hw + n * hd,
    ]
    verts = [bm.verts.new(center + off) for off in offsets]
    quads = [
        (0, 3, 2, 1),
        (4, 5, 6, 7),
        (0, 1, 5, 4),
        (2, 3, 7, 6),
        (1, 2, 6, 5),
        (3, 0, 4, 7),
    ]
    uv_layer = bm.loops.layers.uv.verify()
    for q in quads:
        f = bm.faces.new([verts[i] for i in q])
        f.material_index = mat_idx
        f.loops[0][uv_layer].uv = Vector((0.0, 0.0))
        f.loops[1][uv_layer].uv = Vector((1.0, 0.0))
        f.loops[2][uv_layer].uv = Vector((1.0, 1.0))
        f.loops[3][uv_layer].uv = Vector((0.0, 1.0))


def add_cone_beam(
    bm: bmesh.types.BMesh,
    p_base: Vector,
    p_top: Vector,
    r_base: float = 0.35,
    r_top: float = 2.6,
    segments: int = 12,
    mat_idx: int = 29,
):
    """
    天頂サーチライト（CROSSING LIGHT）の円錐状光柱ボリュームメッシュを追加する。
    """
    v_axis = p_top - p_base
    height = v_axis.length
    if height < 1e-3:
        return
    dir_axis = v_axis.normalized()
    ref = (
        Vector((0.0, 1.0, 0.0))
        if abs(dir_axis.x) > 0.5 or abs(dir_axis.z) > 0.5
        else Vector((1.0, 0.0, 0.0))
    )
    u = dir_axis.cross(ref).normalized()
    v = dir_axis.cross(u).normalized()

    bot_verts = []
    top_verts = []
    for i in range(segments):
        ang = 2.0 * math.pi * i / segments
        cos_a = math.cos(ang)
        sin_a = math.sin(ang)
        radial_vec = u * cos_a + v * sin_a
        bot_verts.append(bm.verts.new(p_base + radial_vec * r_base))
        top_verts.append(bm.verts.new(p_top + radial_vec * r_top))

    uv_layer = bm.loops.layers.uv.verify()
    for i in range(segments):
        ni = (i + 1) % segments
        f = bm.faces.new([bot_verts[i], bot_verts[ni], top_verts[ni], top_verts[i]])
        f.material_index = mat_idx
        f.loops[0][uv_layer].uv = Vector((i / segments, 0.0))
        f.loops[1][uv_layer].uv = Vector(((i + 1) / segments, 0.0))
        f.loops[2][uv_layer].uv = Vector(((i + 1) / segments, 1.0))
        f.loops[3][uv_layer].uv = Vector((i / segments, 1.0))


def add_cylindrical_panel_z(
    bm: bmesh.types.BMesh,
    center: Vector,
    r_inner: float,
    r_outer: float,
    height: float,
    start_rad: float,
    end_rad: float,
    segments: int = 20,
    mat_idx: int = 0,
    inner_mat_idx: int | None = None,
    uv_rect: tuple[float, float, float, float] | None = None,
):
    """
    円柱表面に沿った扇形円筒シェル（厚み r_outer - r_inner、角度範囲 start_rad .. end_rad）を bmesh に追加する。
    SHIBUYA109 シリンダー曲面ファサードに完全密着したバッキングプレート・看板ベース生成用。
    """
    back_mat_idx = mat_idx if inner_mat_idx is None else inner_mat_idx
    hz = height * 0.5
    p_in_bot = []
    p_in_top = []
    p_out_bot = []
    p_out_top = []

    for i in range(segments + 1):
        ratio = i / segments
        ang = start_rad + (end_rad - start_rad) * ratio
        ca = math.cos(ang)
        sa = math.sin(ang)

        c_in = center + Vector((ca * r_inner, sa * r_inner, 0.0))
        c_out = center + Vector((ca * r_outer, sa * r_outer, 0.0))

        p_in_bot.append(bm.verts.new(c_in - Vector((0.0, 0.0, hz))))
        p_in_top.append(bm.verts.new(c_in + Vector((0.0, 0.0, hz))))
        p_out_bot.append(bm.verts.new(c_out - Vector((0.0, 0.0, hz))))
        p_out_top.append(bm.verts.new(c_out + Vector((0.0, 0.0, hz))))

    uv_u0, uv_v0, uv_u1, uv_v1 = uv_rect if uv_rect is not None else (0.0, 0.0, 1.0, 1.0)
    uv_layer = bm.loops.layers.uv.verify()
    for i in range(segments):
        ni = i + 1
        u0 = uv_u0 + (i / segments) * (uv_u1 - uv_u0)
        u1 = uv_u0 + ((i + 1) / segments) * (uv_u1 - uv_u0)
        # 外周面
        f_out = bm.faces.new([p_out_bot[i], p_out_bot[ni], p_out_top[ni], p_out_top[i]])
        f_out.material_index = mat_idx
        f_out.loops[0][uv_layer].uv = Vector((u0, uv_v0))
        f_out.loops[1][uv_layer].uv = Vector((u1, uv_v0))
        f_out.loops[2][uv_layer].uv = Vector((u1, uv_v1))
        f_out.loops[3][uv_layer].uv = Vector((u0, uv_v1))
        # 内周面（内側視点でも左右反転しない UV 方向）
        f_in = bm.faces.new([p_in_bot[ni], p_in_bot[i], p_in_top[i], p_in_top[ni]])
        f_in.material_index = back_mat_idx
        f_in.loops[0][uv_layer].uv = Vector((u0, uv_v0))
        f_in.loops[1][uv_layer].uv = Vector((u1, uv_v0))
        f_in.loops[2][uv_layer].uv = Vector((u1, uv_v1))
        f_in.loops[3][uv_layer].uv = Vector((u0, uv_v1))
        # 底面
        f_bot = bm.faces.new([p_in_bot[i], p_in_bot[ni], p_out_bot[ni], p_out_bot[i]])
        f_bot.material_index = back_mat_idx
        f_bot.loops[0][uv_layer].uv = Vector((0.0, 0.0))
        f_bot.loops[1][uv_layer].uv = Vector((1.0, 0.0))
        f_bot.loops[2][uv_layer].uv = Vector((1.0, 1.0))
        f_bot.loops[3][uv_layer].uv = Vector((0.0, 1.0))
        # 天面
        f_top = bm.faces.new([p_in_top[ni], p_in_top[i], p_out_top[i], p_out_top[ni]])
        f_top.material_index = back_mat_idx
        f_top.loops[0][uv_layer].uv = Vector((0.0, 0.0))
        f_top.loops[1][uv_layer].uv = Vector((1.0, 0.0))
        f_top.loops[2][uv_layer].uv = Vector((1.0, 1.0))
        f_top.loops[3][uv_layer].uv = Vector((0.0, 1.0))

    # 左側小口 (i = 0)
    f_left = bm.faces.new([p_in_bot[0], p_out_bot[0], p_out_top[0], p_in_top[0]])
    f_left.material_index = back_mat_idx
    f_left.loops[0][uv_layer].uv = Vector((0.0, 0.0))
    f_left.loops[1][uv_layer].uv = Vector((1.0, 0.0))
    f_left.loops[2][uv_layer].uv = Vector((1.0, 1.0))
    f_left.loops[3][uv_layer].uv = Vector((0.0, 1.0))
    # 右側小口 (i = segments)
    f_right = bm.faces.new([p_out_bot[-1], p_in_bot[-1], p_in_top[-1], p_out_top[-1]])
    f_right.material_index = back_mat_idx
    f_right.loops[0][uv_layer].uv = Vector((0.0, 0.0))
    f_right.loops[1][uv_layer].uv = Vector((1.0, 0.0))
    f_right.loops[2][uv_layer].uv = Vector((1.0, 1.0))
    f_right.loops[3][uv_layer].uv = Vector((0.0, 1.0))


def add_cylinder_z(
    bm: bmesh.types.BMesh,
    center: Vector,
    radius: float,
    height: float,
    segments: int = 16,
    mat_idx: int = 0,
    smooth: bool = True,
):
    """Z軸方向の円柱を bmesh に追加する（自動円筒UV展開付き）"""
    bot_verts = []
    top_verts = []
    hz = height * 0.5
    for i in range(segments):
        ang = (2.0 * math.pi * i) / segments
        dx = math.cos(ang) * radius
        dy = math.sin(ang) * radius
        bot_verts.append(bm.verts.new(center + Vector((dx, dy, -hz))))
        top_verts.append(bm.verts.new(center + Vector((dx, dy, hz))))

    uv_layer = bm.loops.layers.uv.verify()
    for i in range(segments):
        ni = (i + 1) % segments
        f = bm.faces.new([bot_verts[i], bot_verts[ni], top_verts[ni], top_verts[i]])
        f.material_index = mat_idx
        f.smooth = smooth
        u0 = i / segments
        u1 = (i + 1) / segments
        f.loops[0][uv_layer].uv = Vector((u0, 0.0))
        f.loops[1][uv_layer].uv = Vector((u1, 0.0))
        f.loops[2][uv_layer].uv = Vector((u1, 1.0))
        f.loops[3][uv_layer].uv = Vector((u0, 1.0))

    f_bot = bm.faces.new(list(reversed(bot_verts)))
    f_bot.material_index = mat_idx
    for loop in f_bot.loops:
        dx = (loop.vert.co.x - center.x) / (radius * 2.0) + 0.5
        dy = (loop.vert.co.y - center.y) / (radius * 2.0) + 0.5
        loop[uv_layer].uv = Vector((dx, dy))

    f_top = bm.faces.new(top_verts)
    f_top.material_index = mat_idx
    for loop in f_top.loops:
        dx = (loop.vert.co.x - center.x) / (radius * 2.0) + 0.5
        dy = (loop.vert.co.y - center.y) / (radius * 2.0) + 0.5
        loop[uv_layer].uv = Vector((dx, dy))


def add_extruded_arc_ring(
    bm: bmesh.types.BMesh,
    center: Vector,
    tangent_dir: Vector,
    normal_dir: Vector,
    outer_r: float,
    inner_r: float,
    depth: float,
    start_deg: float = 0.0,
    end_deg: float = 360.0,
    segments: int = 28,
    mat_idx: int = 0,
    offset_t: float = 0.0,
    offset_z: float = 0.0,
):
    """
    ファサード平面 (tangent_dir, Z) 上に円環または円弧を描き、normal_dir 方向へ厚み depth で押し出した
    3D メッシュを追加する（Google ロゴの G, o, g, e の曲線パーツ生成用）。
    """
    t = tangent_dir.normalized()
    n = normal_dir.normalized()
    up = Vector((0.0, 0.0, 1.0))
    origin = center + t * offset_t + up * offset_z
    hd = depth * 0.5

    is_full_circle = abs((end_deg - start_deg) - 360.0) < 1e-3
    num_pts = segments if is_full_circle else segments + 1

    front_outer = []
    front_inner = []
    back_outer = []
    back_inner = []

    for i in range(num_pts):
        ratio = i / segments
        ang = math.radians(start_deg + (end_deg - start_deg) * ratio)
        ca = math.cos(ang)
        sa = math.sin(ang)
        p_out = origin + t * (ca * outer_r) + up * (sa * outer_r)
        p_in = origin + t * (ca * inner_r) + up * (sa * inner_r)

        front_outer.append(bm.verts.new(p_out + n * hd))
        front_inner.append(bm.verts.new(p_in + n * hd))
        back_outer.append(bm.verts.new(p_out - n * hd))
        back_inner.append(bm.verts.new(p_in - n * hd))

    loop_count = segments
    for i in range(loop_count):
        ni = (i + 1) % num_pts
        # 前面・背面・外周・内周の4面
        for quad in [
            [front_inner[i], front_outer[i], front_outer[ni], front_inner[ni]],
            [back_outer[i], back_inner[i], back_inner[ni], back_outer[ni]],
            [front_outer[i], back_outer[i], back_outer[ni], front_outer[ni]],
            [back_inner[i], front_inner[i], front_inner[ni], back_inner[ni]],
        ]:
            f = bm.faces.new(quad)
            f.material_index = mat_idx

    if not is_full_circle:
        # 始端・終端のキャップ面
        f_start = bm.faces.new([front_outer[0], front_inner[0], back_inner[0], back_outer[0]])
        f_start.material_index = mat_idx
        f_end = bm.faces.new([front_inner[-1], front_outer[-1], back_outer[-1], back_inner[-1]])
        f_end.material_index = mat_idx


def add_3d_stream_architectural_emblem(
    bm: bmesh.types.BMesh,
    center: Vector,
    tangent_dir: Vector,
    normal_dir: Vector,
    cap_height: float,
    depth: float,
    with_backing_plate: bool = True,
    mat_white: int = 0,
    mat_dark_frame: int = 2,
    mat_galvanized: int = 3,
    mat_yellow_accent: int = 5,
):
    """
    指定したファサード面上に渋谷ストリーム（SHIBUYA STREAM）の建築ストリーム・エンブレム＆
    ライムイエロー水平ストリームラインを生成する（特定企業ロゴを含まない純粋な建築サイン）。
    """
    t = tangent_dir.normalized()
    n = normal_dir.normalized()
    up = Vector((0.0, 0.0, 1.0))

    plate_w = cap_height * 4.4
    plate_h = cap_height * 1.55

    if with_backing_plate:
        # ダークチャコール外枠バックプレート
        add_oriented_box(
            bm,
            center=center - n * (depth * 0.45),
            tangent_dir=t,
            normal_dir=n,
            size_tangent=plate_w,
            size_normal=depth * 0.65,
            size_z=plate_h,
            mat_idx=mat_dark_frame,
        )
        # 溶融亜鉛めっきインナーフレーム
        add_oriented_box(
            bm,
            center=center - n * (depth * 0.18),
            tangent_dir=t,
            normal_dir=n,
            size_tangent=plate_w - cap_height * 0.22,
            size_normal=depth * 0.42,
            size_z=plate_h - cap_height * 0.22,
            mat_idx=mat_galvanized,
        )

    # 3本の流れるような水平ストリーム・リボン（上段：白アルミ、中段：ライムイエロー発光、下段：白アルミ）
    bar_configs = [
        (-0.22 * cap_height, 0.36 * cap_height, 2.85 * cap_height, 0.22 * cap_height, mat_white),
        (0.18 * cap_height, 0.0, 3.35 * cap_height, 0.26 * cap_height, mat_yellow_accent),
        (0.24 * cap_height, -0.36 * cap_height, 2.85 * cap_height, 0.22 * cap_height, mat_white),
    ]
    for offset_t, offset_z, bar_w, bar_h, m_idx in bar_configs:
        add_oriented_box(
            bm,
            center=center + t * offset_t + up * offset_z + n * (depth * 0.22),
            tangent_dir=t,
            normal_dir=n,
            size_tangent=bar_w,
            size_normal=depth * 0.75,
            size_z=bar_h,
            mat_idx=m_idx,
        )

    # 左端の「S」字ストリーム・デュアルアーク（水流シンボル）
    arc_r = cap_height * 0.28
    arc_stroke = cap_height * 0.11
    add_extruded_arc_ring(
        bm,
        center=center,
        tangent_dir=t,
        normal_dir=n,
        outer_r=arc_r,
        inner_r=arc_r - arc_stroke,
        depth=depth * 0.85,
        start_deg=35.0,
        end_deg=270.0,
        segments=20,
        mat_idx=mat_yellow_accent,
        offset_t=-1.55 * cap_height,
        offset_z=0.18 * cap_height,
    )
    add_extruded_arc_ring(
        bm,
        center=center,
        tangent_dir=t,
        normal_dir=n,
        outer_r=arc_r,
        inner_r=arc_r - arc_stroke,
        depth=depth * 0.85,
        start_deg=215.0,
        end_deg=450.0,
        segments=20,
        mat_idx=mat_white,
        offset_t=-1.55 * cap_height,
        offset_z=-0.18 * cap_height,
    )


def assign_materials_to_object(obj: bpy.types.Object, materials: dict[str, bpy.types.Material]):
    """固定インデックス順でオブジェクトに全マテリアルスロットを割り当てる"""
    ordered_keys = [
        "StreamWhitePanel",  # 0
        "StreamCurtainGlass",  # 1
        "StreamDarkVoidSteel",  # 2
        "StreamGalvanizedFrame",  # 3
        "StreamVerticalGreen",  # 4
        "StreamYellowAccent",  # 5
        "WarmPlazaGlow",  # 6
        "BeaconRed",  # 7
        "ShutokoConcretePier",  # 8
        "ShutokoHighwayGreenSign",  # 9
        "ShibuyaSkyEdgeGlow",  # 10
        "HikarieGoldOrb",  # 11
        "SakuraStagePinkGlow",  # 12
        "ShibuyaQfront109Accent",  # 13
        "ShibuyaQfrontMedia",  # 14
        "Shibuya109Crown",  # 15
        "ShibuyaScrambleSquareFacade",  # 16
        "ShibuyaStreamFacade",  # 17
        "ShibuyaMiyashitaParkFacade",  # 18
        "ShibuyaCommercialFacade",  # 19
        "ShibuyaCrossingBillboard",  # 20
        "HeliportGreenPad",  # 21
        "JRGreenSteel",  # 22
        "ShibuyaMagnetFacade",  # 23
        "ShibuyaMarkCityFacade",  # 24
        "ShibuyaToeiBicFacade",  # 25
        "ShibuyaDogenzakaCommercialFacade",  # 26
        "ShibuyaCenterGaiArchSign",  # 27
        "ShibuyaCenterGaiBanner",  # 28
        "ShibuyaSkySearchlightGlow",  # 29
        "HachikoBronze",  # 30
        "HachikoGranite",  # 31
    ]
    for k in ordered_keys:
        obj.data.materials.append(materials[k])


def build_high_rise_tower(materials: dict[str, bpy.types.Material]) -> bpy.types.Object:
    """
    渋谷ストリーム高層オフィスタワー（14F〜35F, Z=66m〜180m）を構築する。
    実写（File:Shibuya Stream-1b.jpg / detail_3.jpg）に忠実なスタガード白アルミパネル格子と
    屋上の溶融亜鉛めっき鉄骨オープンフレーム冠部を備える。
    """
    mesh = bpy.data.meshes.new("ShibuyaStream_HighRiseMesh")
    bm = bmesh.new()

    tower_w = 50.0  # X軸幅 (-25m..+25m)
    tower_d = 38.0  # Y軸奥行 (-19m..+19m)
    z_start = 66.0
    z_glass_top = 168.0
    z_crown_top = 180.0
    glass_h = z_glass_top - z_start

    # 1. メインガラスカーテンウォールコア（Z=66m..168m: 実写ストリームテクスチャ）
    add_box(
        bm,
        center=Vector((0.0, 0.0, z_start + glass_h * 0.5)),
        size=Vector((tower_w, tower_d, glass_h)),
        mat_idx=17,
    )

    # 2. 各階（14F〜35F：22フロア × 階高 4.63m）の水平スパンドレル帯＆発光オフィス窓バンド
    num_floors = 22
    floor_h = glass_h / num_floors
    for fl in range(num_floors + 1):
        fz = z_start + fl * floor_h
        # 水平アルミスパンドレルフィン
        add_box(
            bm,
            center=Vector((0.0, 0.0, fz)),
            size=Vector((tower_w + 0.32, tower_d + 0.32, 0.36)),
            mat_idx=0,
        )
        # 3階おきに室内のウォームオフィス照明ストリップを内側に配置
        is_lit_floor = fl < num_floors and (fl % 3 == 1)
        if is_lit_floor:
            add_box(
                bm,
                center=Vector((0.0, 0.0, fz + floor_h * 0.5)),
                size=Vector((tower_w + 0.06, tower_d + 0.06, floor_h * 0.42)),
                mat_idx=6,
            )

    # 3. 渋谷ストリーム象徴の「スタガード（千鳥・水流）白アルミパネル＆縦フィン」
    # 正面(-Y: 明治通り側) と 背面(+Y: 渋谷川側): 20ベイ
    num_bays_x = 20
    bay_w_x = tower_w / num_bays_x
    for bx in range(num_bays_x + 1):
        cx = -tower_w * 0.5 + bx * bay_w_x
        # 細い垂直サッシマリオン（全高通し）
        for ny_sign in [-1.0, 1.0]:
            py = ny_sign * (tower_d * 0.5 + 0.12)
            add_box(
                bm,
                center=Vector((cx, py, z_start + glass_h * 0.5)),
                size=Vector((0.18, 0.24, glass_h)),
                mat_idx=3,
            )

    # 水流のように斜め・千鳥状に連なる白アルミパネル（CAt ファサードパターン）
    for fl in range(num_floors):
        fz = z_start + (fl + 0.5) * floor_h
        for bx in range(num_bays_x):
            cx = -tower_w * 0.5 + (bx + 0.5) * bay_w_x
            # 周期的ハッシュと階段位相で実写の斜めストリーム白パネル配置を生成
            stream_phase = (bx * 3 + fl * 2) % 7
            is_wide_panel = stream_phase in (0, 1)
            is_narrow_fin = stream_phase == 4
            if is_wide_panel or is_narrow_fin:
                panel_w = bay_w_x * (0.86 if is_wide_panel else 0.42)
                panel_x = cx + (0.0 if is_wide_panel else -bay_w_x * 0.22)
                for ny_sign in [-1.0, 1.0]:
                    py = ny_sign * (tower_d * 0.5 + 0.22)
                    add_box(
                        bm,
                        center=Vector((panel_x, py, fz)),
                        size=Vector((panel_w, 0.34, floor_h + 0.12)),
                        mat_idx=0,
                    )

    # 左側面(-X: 渋谷駅・スクランブルスクエア側) と 右側面(+X: 恵比寿側): 16ベイ
    num_bays_y = 16
    bay_w_y = tower_d / num_bays_y
    for by in range(num_bays_y + 1):
        cy = -tower_d * 0.5 + by * bay_w_y
        for nx_sign in [-1.0, 1.0]:
            px = nx_sign * (tower_w * 0.5 + 0.12)
            add_box(
                bm,
                center=Vector((px, cy, z_start + glass_h * 0.5)),
                size=Vector((0.24, 0.18, glass_h)),
                mat_idx=3,
            )

    for fl in range(num_floors):
        fz = z_start + (fl + 0.5) * floor_h
        for by in range(num_bays_y):
            cy = -tower_d * 0.5 + (by + 0.5) * bay_w_y
            stream_phase = (by * 3 + fl * 2 + 2) % 7
            is_wide_panel = stream_phase in (0, 2)
            is_narrow_fin = stream_phase == 5
            if is_wide_panel or is_narrow_fin:
                panel_d = bay_w_y * (0.86 if is_wide_panel else 0.42)
                for nx_sign in [-1.0, 1.0]:
                    px = nx_sign * (tower_w * 0.5 + 0.22)
                    add_box(
                        bm,
                        center=Vector((px, cy, fz)),
                        size=Vector((0.34, panel_d, floor_h + 0.12)),
                        mat_idx=0,
                    )

    # 4隅のホワイトコーナーピラー（建物の輪郭を引き締める）
    for sx in [-1.0, 1.0]:
        for sy in [-1.0, 1.0]:
            add_box(
                bm,
                center=Vector(
                    (
                        sx * (tower_w * 0.5 + 0.18),
                        sy * (tower_d * 0.5 + 0.18),
                        z_start + glass_h * 0.5,
                    )
                ),
                size=Vector((1.35, 1.35, glass_h + 0.4)),
                mat_idx=0,
            )

    # 4. 屋上オープン鉄骨フレーム冠部 (Z=168m..180m: 実写 wikimedia_2.jpg / wikimedia_5.jpg)
    crown_h = z_crown_top - z_glass_top
    crown_mid_z = z_glass_top + crown_h * 0.5
    # 屋上内側の設備コア＆屋上緑化プランター
    add_box(
        bm,
        center=Vector((0.0, 0.0, z_glass_top + crown_h * 0.38)),
        size=Vector((tower_w - 8.5, tower_d - 8.5, crown_h * 0.76)),
        mat_idx=2,
    )
    # 屋上外周の植栽ヘッジ（実写 wikimedia_2.jpg の屋上緑化）
    add_box(
        bm,
        center=Vector((0.0, 0.0, z_glass_top + 1.2)),
        size=Vector((tower_w - 2.2, tower_d - 2.2, 2.2)),
        mat_idx=4,
    )

    # 外周の溶融亜鉛めっき鉄骨柱列＆水平H鋼ビーム3段
    for bx in range(0, num_bays_x + 1, 2):
        cx = -tower_w * 0.5 + bx * bay_w_x
        for ny_sign in [-1.0, 1.0]:
            py = ny_sign * (tower_d * 0.5 - 0.2)
            add_box(
                bm,
                center=Vector((cx, py, crown_mid_z)),
                size=Vector((0.55, 0.55, crown_h)),
                mat_idx=3,
            )
    for by in range(0, num_bays_y + 1, 2):
        cy = -tower_d * 0.5 + by * bay_w_y
        for nx_sign in [-1.0, 1.0]:
            px = nx_sign * (tower_w * 0.5 - 0.2)
            add_box(
                bm,
                center=Vector((px, cy, crown_mid_z)),
                size=Vector((0.55, 0.55, crown_h)),
                mat_idx=3,
            )

    for ring_z in [z_glass_top + 4.0, z_glass_top + 8.0, z_crown_top - 0.35]:
        for ny_sign in [-1.0, 1.0]:
            add_box(
                bm,
                center=Vector((0.0, ny_sign * (tower_d * 0.5 - 0.2), ring_z)),
                size=Vector((tower_w + 0.4, 0.60, 0.55)),
                mat_idx=3,
            )
        for nx_sign in [-1.0, 1.0]:
            add_box(
                bm,
                center=Vector((nx_sign * (tower_w * 0.5 - 0.2), 0.0, ring_z)),
                size=Vector((0.60, tower_d + 0.4, 0.55)),
                mat_idx=3,
            )

    # 屋上航空障害灯（四隅）
    for sx in [-1.0, 1.0]:
        for sy in [-1.0, 1.0]:
            add_cylinder_z(
                bm,
                center=Vector(
                    (sx * (tower_w * 0.5 - 0.8), sy * (tower_d * 0.5 - 0.8), z_crown_top + 0.9)
                ),
                radius=0.45,
                height=1.8,
                segments=12,
                mat_idx=7,
            )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("ShibuyaStream_HighRise", mesh)
    assign_materials_to_object(obj, materials)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_mid_void_and_hotel_band(materials: dict[str, bpy.types.Material]) -> bpy.types.Object:
    """
    中層ボイド＆ホテル層（Z=32m〜66m）を構築する。
    - Z=32m〜48m: 深いダークチャコール吹き抜けボイド + 壁面緑化（グリーンウォール）＋白縦パネルの千鳥配置
      （実写 File:Shibuya Stream-2a.jpg / detail_1.jpg / detail_2.jpg で非常に特徴的な中層帯）
    - Z=48m〜66m: 9F〜13F エクセルホテル東急＆スカイロビーの高密度縦マリオン・ガラスバンド
    """
    mesh = bpy.data.meshes.new("ShibuyaStream_MidVoidMesh")
    bm = bmesh.new()

    tower_w = 50.0
    tower_d = 38.0

    # 1. Z=32m..48m: 奥まったダークチャコール構造コア
    void_z0 = 32.0
    void_z1 = 48.0
    void_h = void_z1 - void_z0
    void_mid_z = void_z0 + void_h * 0.5
    add_box(
        bm,
        center=Vector((0.0, 0.0, void_mid_z)),
        size=Vector((tower_w - 4.2, tower_d - 4.2, void_h)),
        mat_idx=2,
    )
    # ボイド内の水平構造スラブ（2段）
    for sz in [32.3, 40.0, 47.7]:
        add_box(
            bm,
            center=Vector((0.0, 0.0, sz)),
            size=Vector((tower_w + 0.2, tower_d + 0.2, 0.65)),
            mat_idx=2,
        )

    # ボイド外周に並ぶ「白アルミ縦パネル」と「垂直壁面緑化（グリーンウォール）」の交互配置
    num_void_cols_x = 14
    col_step_x = tower_w / num_void_cols_x
    for i in range(num_void_cols_x):
        cx = -tower_w * 0.5 + (i + 0.5) * col_step_x
        for ny_sign in [-1.0, 1.0]:
            py = ny_sign * (tower_d * 0.5 - 0.15)
            # 下段 (Z=32..40) と 上段 (Z=40..48) で白パネルと緑化パネルを千鳥配置
            for seg_idx, seg_z in enumerate([36.0, 44.0]):
                mode = (i + seg_idx) % 3
                if mode == 0:
                    # 白アルミ縦パネル
                    add_box(
                        bm,
                        center=Vector((cx, py, seg_z)),
                        size=Vector((col_step_x * 0.68, 0.55, 7.6)),
                        mat_idx=0,
                    )
                elif mode == 1:
                    # 垂直壁面緑化プランター（グリーンウォール）
                    add_box(
                        bm,
                        center=Vector((cx, py - ny_sign * 0.25, seg_z)),
                        size=Vector((col_step_x * 0.64, 0.75, 7.4)),
                        mat_idx=4,
                    )

    num_void_cols_y = 10
    col_step_y = tower_d / num_void_cols_y
    for i in range(num_void_cols_y):
        cy = -tower_d * 0.5 + (i + 0.5) * col_step_y
        for nx_sign in [-1.0, 1.0]:
            px = nx_sign * (tower_w * 0.5 - 0.15)
            for seg_idx, seg_z in enumerate([36.0, 44.0]):
                mode = (i + seg_idx + 1) % 3
                if mode == 0:
                    add_box(
                        bm,
                        center=Vector((px, cy, seg_z)),
                        size=Vector((0.55, col_step_y * 0.68, 7.6)),
                        mat_idx=0,
                    )
                elif mode == 1:
                    add_box(
                        bm,
                        center=Vector((px - nx_sign * 0.25, cy, seg_z)),
                        size=Vector((0.75, col_step_y * 0.64, 7.4)),
                        mat_idx=4,
                    )

    # 2. Z=48m..66m: 9F〜13F ホテル＆スカイロビー層（細かい縦マリオン＋白パネルアクセント）
    hotel_z0 = 48.0
    hotel_z1 = 66.0
    hotel_h = hotel_z1 - hotel_z0
    hotel_mid_z = hotel_z0 + hotel_h * 0.5
    add_box(
        bm,
        center=Vector((0.0, 0.0, hotel_mid_z)),
        size=Vector((tower_w, tower_d, hotel_h)),
        mat_idx=1,
    )
    # 4フロア分の水平白帯と高密度縦マリオン
    for fl in range(5):
        fz = hotel_z0 + fl * (hotel_h / 4.0)
        add_box(
            bm,
            center=Vector((0.0, 0.0, fz)),
            size=Vector((tower_w + 0.30, tower_d + 0.30, 0.38)),
            mat_idx=0,
        )

    for i in range(32):
        cx = -tower_w * 0.5 + (i + 0.5) * (tower_w / 32.0)
        is_white_strip = i % 5 == 0
        for ny_sign in [-1.0, 1.0]:
            py = ny_sign * (tower_d * 0.5 + 0.16)
            add_box(
                bm,
                center=Vector((cx, py, hotel_mid_z)),
                size=Vector((1.15 if is_white_strip else 0.22, 0.30, hotel_h)),
                mat_idx=0 if is_white_strip else 3,
            )

    for j in range(24):
        cy = -tower_d * 0.5 + (j + 0.5) * (tower_d / 24.0)
        is_white_strip = j % 4 == 0
        for nx_sign in [-1.0, 1.0]:
            px = nx_sign * (tower_w * 0.5 + 0.16)
            add_box(
                bm,
                center=Vector((px, cy, hotel_mid_z)),
                size=Vector((0.30, 1.15 if is_white_strip else 0.22, hotel_h)),
                mat_idx=0 if is_white_strip else 3,
            )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("ShibuyaStream_MidVoid", mesh)
    assign_materials_to_object(obj, materials)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_low_rise_podium_and_plaza(materials: dict[str, bpy.types.Material]) -> bpy.types.Object:
    """
    低層商業ポディウム・歩行者デッキ・円筒ガラスアトリウム・稲荷橋広場大階段（1F〜6F, Z=0m〜32m）を構築する。
    実写（detail_2.jpg / cat_0.jpg）の通り：
    - 1F (Z=0..8.5m): ダークチャコールの円柱ピロティ列と奥まったガラスエントランス
    - 2F〜6F (Z=8.5..32m): 明治通り側(-Y)および渋谷駅側(-X)へ張り出すガラス＆白パネルの積層キューブ群
    - 北西角 (-X, -Y) の2層吹き抜け円筒ガラスパビリオン＆歩行者デッキ歩道橋
    - 稲荷橋広場の大階段（階段ステップ＋傾斜に追従したガラス・白スチール手すり）
    """
    mesh = bpy.data.meshes.new("ShibuyaStream_PodiumMesh")
    bm = bmesh.new()

    # 1. 1F ベースプラザ床スラブ＆ダークコア (Z=0..8.8m)
    add_box(
        bm,
        center=Vector((0.0, 0.0, 4.4)),
        size=Vector((46.0, 34.0, 8.8)),
        mat_idx=2,
    )
    # 1F 路面商業・エントランス発光ショーウィンドウ（1フロア等倍のガラス店舗ファサード＋縦マリオン）
    add_box(
        bm,
        center=Vector((0.0, -17.1, 3.6)),
        size=Vector((38.0, 0.28, 6.2)),
        mat_idx=6,
    )
    add_box(
        bm,
        center=Vector((0.0, -17.26, 2.55)),
        size=Vector((37.6, 0.16, 4.7)),
        mat_idx=19,
        uv_rect=(0.0, 0.0, 1.0, 0.24),
    )
    add_box(
        bm,
        center=Vector((-23.1, 0.0, 3.6)),
        size=Vector((0.28, 26.0, 6.2)),
        mat_idx=6,
    )
    add_box(
        bm,
        center=Vector((-23.26, 0.0, 2.55)),
        size=Vector((0.16, 25.6, 4.7)),
        mat_idx=19,
        uv_rect=(0.0, 0.0, 1.0, 0.24),
    )
    for mx_1f in range(-18, 19, 4):
        add_box(
            bm,
            center=Vector((float(mx_1f), -17.36, 3.6)),
            size=Vector((0.22, 0.24, 6.4)),
            mat_idx=3,
        )
    # 2F キャンチレバー軒裏（Z=8.65m）のウォーム間接照明コープ＆アルミルーバー天井
    add_box(
        bm,
        center=Vector((0.0, -19.2, 8.68)),
        size=Vector((48.0, 3.6, 0.16)),
        mat_idx=0,
    )
    for soffit_y in [-20.4, -18.2]:
        add_box(
            bm,
            center=Vector((0.0, soffit_y, 8.58)),
            size=Vector((46.0, 0.28, 0.08)),
            mat_idx=6,
        )

    # 1F 外周の重厚なダークチャコール円柱ピロティ列（実写 cat_0.jpg 右下の丸柱列）
    for cx in [-24.0, -16.0, -8.0, 0.0, 8.0, 16.0, 24.0]:
        for cy in [-20.5, 20.5]:
            add_cylinder_z(
                bm,
                center=Vector((cx, cy, 4.5)),
                radius=0.68,
                height=9.0,
                segments=16,
                mat_idx=2,
            )
    for cy in [-12.0, -4.0, 4.0, 12.0]:
        for cx in [-26.5, 26.5]:
            add_cylinder_z(
                bm,
                center=Vector((cx, cy, 4.5)),
                radius=0.68,
                height=9.0,
                segments=16,
                mat_idx=2,
            )

    # 2. 2F〜4F キャンチレバー積層ガラスキューブ (Z=8.8m..21.5m)
    podium_w = 55.0
    podium_d = 43.0
    podium_z0 = 8.8
    podium_z1 = 21.5
    podium_h = podium_z1 - podium_z0
    add_box(
        bm,
        center=Vector((0.0, -1.0, podium_z0 + podium_h * 0.5)),
        size=Vector((podium_w, podium_d, podium_h)),
        mat_idx=1,
    )
    # ポディウム内部の暖かいカフェ・商業照明バンド
    for lz in [11.2, 15.2, 19.2]:
        add_box(
            bm,
            center=Vector((0.0, -1.0, lz)),
            size=Vector((podium_w + 0.08, podium_d + 0.08, 1.8)),
            mat_idx=6,
        )
    # ポディウム外周の白アルミパネル＆グリッドフレーム（実写 detail_2.jpg）
    for sz in [8.8, 13.0, 17.2, 21.5]:
        add_box(
            bm,
            center=Vector((0.0, -1.0, sz)),
            size=Vector((podium_w + 0.45, podium_d + 0.45, 0.50)),
            mat_idx=0,
        )
    for bx in range(15):
        cx = -podium_w * 0.5 + (bx + 0.5) * (podium_w / 15.0)
        is_panel = bx % 3 == 0
        for ny_pos in [-22.6, 20.6]:
            add_box(
                bm,
                center=Vector((cx, ny_pos, podium_z0 + podium_h * 0.5)),
                size=Vector((2.4 if is_panel else 0.28, 0.38, podium_h)),
                mat_idx=0 if is_panel else 3,
            )
    for by in range(12):
        cy = -1.0 - podium_d * 0.5 + (by + 0.5) * (podium_d / 12.0)
        is_panel = by % 3 == 1
        for nx_pos in [-podium_w * 0.5 - 0.15, podium_w * 0.5 + 0.15]:
            add_box(
                bm,
                center=Vector((nx_pos, cy, podium_z0 + podium_h * 0.5)),
                size=Vector((0.38, 2.2 if is_panel else 0.28, podium_h)),
                mat_idx=0 if is_panel else 3,
            )

    # 3. 5F〜6F セットバック上層ポディウム (Z=21.5m..32.0m)
    upper_p_z0 = 21.5
    upper_p_z1 = 32.0
    upper_p_h = upper_p_z1 - upper_p_z0
    add_box(
        bm,
        center=Vector((0.0, -0.5, upper_p_z0 + upper_p_h * 0.5)),
        size=Vector((52.0, 40.0, upper_p_h)),
        mat_idx=1,
    )
    for sz in [25.0, 28.5, 32.0]:
        add_box(
            bm,
            center=Vector((0.0, -0.5, sz)),
            size=Vector((52.5, 40.5, 0.45)),
            mat_idx=0,
        )
    for bx in range(14):
        cx = -26.0 + (bx + 0.5) * (52.0 / 14.0)
        is_panel = (bx % 2) == 1
        for ny_pos in [-20.6, 19.6]:
            add_box(
                bm,
                center=Vector((cx, ny_pos, upper_p_z0 + upper_p_h * 0.5)),
                size=Vector((2.1 if is_panel else 0.26, 0.36, upper_p_h)),
                mat_idx=0 if is_panel else 3,
            )
    for by in range(11):
        cy = -0.5 - 20.0 + (by + 0.5) * (40.0 / 11.0)
        is_panel = (by % 2) == 0
        for nx_pos in [-26.15, 26.15]:
            add_box(
                bm,
                center=Vector((nx_pos, cy, upper_p_z0 + upper_p_h * 0.5)),
                size=Vector((0.36, 2.0 if is_panel else 0.26, upper_p_h)),
                mat_idx=0 if is_panel else 3,
            )

    # 4. 北西角・明治通り広場側の円筒ガラスパビリオン＆2Fペデストリアンデッキ（実写 detail_2.jpg 左手前）
    pav_center = Vector((-21.5, -24.5, 12.8))
    add_cylinder_z(
        bm,
        center=pav_center,
        radius=6.2,
        height=8.4,
        segments=24,
        mat_idx=1,
    )
    # パビリオン上下の白リングスラブ
    for rz in [8.6, 12.8, 17.0]:
        add_cylinder_z(
            bm,
            center=Vector((pav_center.x, pav_center.y, rz)),
            radius=6.45,
            height=0.42,
            segments=24,
            mat_idx=0,
        )

    # 2F 歩行者デッキテラス＆ガラス欄干 (Y = -22m..-27.5m, Z = 8.4m)
    add_box(
        bm,
        center=Vector((2.0, -24.8, 8.4)),
        size=Vector((42.0, 5.4, 0.62)),
        mat_idx=0,
    )
    # デッキ軒裏（Soffit）のシャープなダークスチール構造リブ＆暖色リニア間接照明
    add_box(
        bm,
        center=Vector((2.0, -24.8, 8.02)),
        size=Vector((41.4, 4.8, 0.18)),
        mat_idx=3,
    )
    for soffit_lx in range(-16, 21, 4):
        add_box(
            bm,
            center=Vector((float(soffit_lx), -24.8, 7.92)),
            size=Vector((0.32, 4.9, 0.14)),
            mat_idx=2,
        )
    for soffit_ly in [-26.4, -23.4]:
        add_box(
            bm,
            center=Vector((2.0, soffit_ly, 7.94)),
            size=Vector((40.6, 0.24, 0.08)),
            mat_idx=6,
        )
    add_box(
        bm,
        center=Vector((2.0, -27.25, 9.28)),
        size=Vector((42.0, 0.14, 1.15)),
        mat_idx=1,
    )
    add_box(
        bm,
        center=Vector((2.0, -27.25, 9.88)),
        size=Vector((42.1, 0.22, 0.10)),
        mat_idx=3,
    )
    # 渋谷ストリーム象徴のイエローストリーム・リボンアクセントライン
    add_box(
        bm,
        center=Vector((2.0, -27.52, 8.45)),
        size=Vector((42.2, 0.18, 0.26)),
        mat_idx=5,
    )

    # 5. 稲荷橋広場（Inaribashi Plaza）大階段（Z=0m から Z=8.4m の2Fデッキへ上がる建築大階段）
    # 緩やかな実在建築勾配（水平奥行 13.6m: y=-37.4m..y=-23.8m, 中間踊り場付き42段）、
    # 側面からステップ断面と段鼻間接照明が美しく抜けて見えるキャンチレバー階段＋クリアガラス欄干で構成
    num_steps = 42
    stair_w = 11.4
    stair_x = 12.5
    y_bot = -37.4
    y_top = -23.8
    z_top = 8.4
    dy_total = y_top - y_bot
    dz_total = z_top

    def add_stair_sloped_beam(
        p0: Vector,
        p1: Vector,
        width_x: float,
        height_perp: float,
        m_idx: int,
    ):
        delta = p1 - p0
        if delta.length < 1e-6:
            return
        t_dir = delta.normalized()
        x_dir = Vector((1.0, 0.0, 0.0))
        n_dir = x_dir.cross(t_dir).normalized()
        hx = width_x * 0.5
        hn = height_perp * 0.5
        corners = [
            p0 - x_dir * hx - n_dir * hn,
            p0 + x_dir * hx - n_dir * hn,
            p0 + x_dir * hx + n_dir * hn,
            p0 - x_dir * hx + n_dir * hn,
            p1 - x_dir * hx - n_dir * hn,
            p1 + x_dir * hx - n_dir * hn,
            p1 + x_dir * hx + n_dir * hn,
            p1 - x_dir * hx + n_dir * hn,
        ]
        verts = [bm.verts.new(c) for c in corners]
        quad_indices = [
            (0, 3, 2, 1),
            (4, 5, 6, 7),
            (0, 1, 5, 4),
            (2, 3, 7, 6),
            (1, 2, 6, 5),
            (3, 0, 4, 7),
        ]
        created_faces = []
        for qi in quad_indices:
            f = bm.faces.new([verts[i] for i in qi])
            f.material_index = m_idx
            created_faces.append(f)
        bmesh.ops.recalc_face_normals(bm, faces=created_faces)

    # 5a. 内側にセットバックした2本のスチール斜め主桁スパイン＆明色アルミ軒裏ソフィット
    # （外側1.9mをキャンチレバー張り出しにすることで、明治通り側から見た際に黒い三角壁にならず、
    #   精緻な42段の白石材踏面・段鼻LED照明・軽快な斜め桁シルエットが際立つ建築造形）
    for spine_off_x in [-3.2, 3.2]:
        add_stair_sloped_beam(
            Vector((stair_x + spine_off_x, y_bot + 0.35, 0.05)),
            Vector((stair_x + spine_off_x, y_top - 0.10, z_top - 0.36)),
            width_x=0.72,
            height_perp=0.52,
            m_idx=2,  # StreamDarkVoidSteel
        )
    # 階段裏面の連続明色アルミソフィットパネル＆リニア間接照明
    add_stair_sloped_beam(
        Vector((stair_x, y_bot + 0.28, 0.04)),
        Vector((stair_x, y_top - 0.05, z_top - 0.24)),
        width_x=stair_w - 1.6,
        height_perp=0.22,
        m_idx=3,  # StreamGalvanizedFrame
    )
    for soffit_light_x in [stair_x - 2.1, stair_x, stair_x + 2.1]:
        add_stair_sloped_beam(
            Vector((soffit_light_x, y_bot + 0.65, 0.08)),
            Vector((soffit_light_x, y_top - 0.25, z_top - 0.38)),
            width_x=0.22,
            height_perp=0.08,
            m_idx=6,  # WarmPlazaGlow
        )
    # 階段中腹部・上部のスリム円柱構造ピラー（黒い塊壁ではなく軽快な建築ピロティ支柱）
    for pier_frac in [0.48, 0.82]:
        pier_y = y_bot + pier_frac * dy_total
        pier_h = max(0.4, pier_frac * dz_total - 0.48)
        for px_off in [-3.2, 3.2]:
            add_cylinder_z(
                bm,
                center=Vector((stair_x + px_off, pier_y, pier_h * 0.5)),
                radius=0.32,
                height=pier_h,
                segments=14,
                mat_idx=2,
            )
            add_cylinder_z(
                bm,
                center=Vector((stair_x + px_off, pier_y, 0.18)),
                radius=0.44,
                height=0.36,
                segments=14,
                mat_idx=3,
            )

    # 5b. 42段の建築踏面（明色ライムストーン調）＋ダークライザー＋全段ウォームLED段鼻ライン照明
    # 中央（st = 19..22）に中間踊り場プラットフォームのリズムを付与
    step_dy = dy_total / num_steps
    step_dz = dz_total / num_steps
    for st in range(num_steps):
        step_top = (st + 1) * step_dz
        step_bot_y = y_bot + st * step_dy
        is_mid_landing = st in (20, 21)
        tread_extra_y = 0.14 if is_mid_landing else 0.07
        step_center_y = step_bot_y + step_dy * 0.5
        riser_h = step_dz + 0.12 if st > 0 else step_top
        riser_cz = step_top - riser_h * 0.5 - 0.03
        # ダーク花崗岩調ライザー（左右端を0.14m控え、側面からも白い踏面ノーズがくっきり浮き立つ構造）
        add_box(
            bm,
            center=Vector((stair_x, step_center_y + 0.02, max(riser_h * 0.5, riser_cz))),
            size=Vector((stair_w - 0.28, step_dy, riser_h)),
            mat_idx=2,  # StreamDarkVoidSteel
        )
        # 明るい石材・アルミ調キャンチレバー踏面スラブ（歩道・車道から1段ずつシャープに視認可能）
        add_box(
            bm,
            center=Vector((stair_x, step_center_y - 0.02, step_top - 0.032)),
            size=Vector((stair_w + 0.08, step_dy + tread_extra_y, 0.068)),
            mat_idx=0,  # StreamWhitePanel
        )
        # 全段の踏面ノーズ直下に走る暖色リニア間接照明（WarmPlazaGlow）
        add_box(
            bm,
            center=Vector((stair_x, step_bot_y - 0.035, step_top - 0.078)),
            size=Vector((stair_w - 0.20, 0.055, 0.052)),
            mat_idx=6,  # WarmPlazaGlow
        )
        # 北側（+X側: 広場ベンチテラス側）の3段ごとのウッド/石材スタジアムベンチ段差演出
        if st % 3 == 2 and st < num_steps - 2:
            bench_y = step_bot_y + step_dy * 0.2
            bench_z = step_top + step_dz * 0.45
            add_box(
                bm,
                center=Vector((stair_x + stair_w * 0.34, bench_y, bench_z)),
                size=Vector((2.6, step_dy * 2.4, step_dz * 0.95)),
                mat_idx=0,
            )
            add_box(
                bm,
                center=Vector((stair_x + stair_w * 0.34, bench_y - step_dy * 1.15, bench_z - 0.05)),
                size=Vector((2.5, 0.08, 0.12)),
                mat_idx=6,
            )

    # 5c. 左右のスリムなホワイトアルミ側桁トリム・連続強化ガラス欄干・ステンレストップレール
    for sx in [-1.0, 1.0]:
        rail_x = stair_x + sx * (stair_w * 0.5 + 0.08)
        # スリムな明色アルミ側桁ストリンガー（ステップ断面を隠さない薄型プロファイル）
        add_stair_sloped_beam(
            Vector((rail_x, y_bot, 0.08)),
            Vector((rail_x, y_top, z_top + 0.08)),
            width_x=0.14,
            height_perp=0.22,
            m_idx=3,  # StreamGalvanizedFrame
        )
        # ストリーム象徴のライムイエロー・サイドエッジライン（明治通り側 sx=-1.0 のみアクセント配置）
        if sx < 0.0:
            add_stair_sloped_beam(
                Vector((rail_x - 0.08, y_bot + 0.05, 0.12)),
                Vector((rail_x - 0.08, y_top - 0.05, z_top + 0.12)),
                width_x=0.05,
                height_perp=0.10,
                m_idx=5,  # StreamYellowAccent
            )
        # 連続強化ガラス欄干（階段勾配と完全平行）
        add_stair_sloped_beam(
            Vector((rail_x, y_bot, 0.68)),
            Vector((rail_x, y_top, z_top + 0.68)),
            width_x=0.05,
            height_perp=0.96,
            m_idx=1,  # StreamCurtainGlass
        )
        # ステンレス製連続トップ手すりバー
        add_stair_sloped_beam(
            Vector((rail_x, y_bot - 0.04, 1.18)),
            Vector((rail_x, y_top + 0.04, z_top + 1.18)),
            width_x=0.12,
            height_perp=0.07,
            m_idx=3,  # StreamGalvanizedFrame
        )
        # 手すり直下の間接LEDライン照明
        add_stair_sloped_beam(
            Vector((rail_x - sx * 0.05, y_bot + 0.08, 1.11)),
            Vector((rail_x - sx * 0.05, y_top - 0.08, z_top + 1.11)),
            width_x=0.04,
            height_perp=0.045,
            m_idx=6,  # WarmPlazaGlow
        )
        # スリム垂直ステンレスマリオン支柱（8スパン）
        for post_i in range(9):
            post_frac = 0.02 + (post_i / 8.0) * 0.96
            py = y_bot + post_frac * dy_total
            pz = post_frac * dz_total
            add_box(
                bm,
                center=Vector((rail_x, py, pz + 0.60)),
                size=Vector((0.06, 0.07, 1.20)),
                mat_idx=3,
            )

    # 中央2列のスリム・ダブルステンレス手すり（大階段の実在スケール演出）
    for inner_x in [stair_x - 2.1, stair_x + 1.4]:
        add_stair_sloped_beam(
            Vector((inner_x, y_bot + 0.12, 0.92)),
            Vector((inner_x, y_top - 0.12, z_top + 0.92)),
            width_x=0.065,
            height_perp=0.065,
            m_idx=3,
        )
        for post_frac in [0.04, 0.28, 0.52, 0.76, 0.96]:
            py = y_bot + post_frac * dy_total
            pz = post_frac * dz_total
            add_box(
                bm,
                center=Vector((inner_x, py, pz + 0.46)),
                size=Vector((0.06, 0.06, 0.92)),
                mat_idx=3,
            )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("ShibuyaStream_Podium", mesh)
    assign_materials_to_object(obj, materials)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_stream_architectural_signage(
    materials: dict[str, bpy.types.Material],
) -> bpy.types.Object:
    """
    渋谷ストリーム（Shibuya Stream）の立体建築エンブレムサイン群を構築する：
    1. 高層タワー4面サイン (Z=152.0m, エンブレム高 5.4m):
       - 正面(-Y: 明治通り側)、背面(+Y: 渋谷川側)、左側面(-X: 渋谷駅側)、右側面(+X: 恵比寿側)の4面すべてに配置。
    2. 中層ポディウム冠部サイン (Z=29.2m, エンブレム高 3.2m):
       - 明治通り側(-Y)および渋谷駅側(-X)の低層ガラスキューブ最上部に配置し、
         道路走行中の追従カメラ・フロントガラス越しに自然な仰角で視認可能。
    3. 低層2Fデッキ・エントランスサイン (Z=10.6m, エンブレム高 2.15m) ＆
       明治通り稲荷橋広場アイレベル・モニュメントサイン (Z=2.35m, エンブレム高 1.55m):
       - コックピット視点（ドライバー目線高 1.18m）で目の前に渋谷ストリームの建築サインが鮮明に入る配置。
    """
    mesh = bpy.data.meshes.new("ShibuyaStream_SignageMesh")
    bm = bmesh.new()

    # 1. 高層タワー4面 渋谷ストリーム建築サイン (Z = 152.0m)
    # 正面 (-Y: 明治通り向き)
    add_3d_stream_architectural_emblem(
        bm,
        center=Vector((0.0, -19.65, 152.0)),
        tangent_dir=Vector((1.0, 0.0, 0.0)),
        normal_dir=Vector((0.0, -1.0, 0.0)),
        cap_height=5.4,
        depth=0.55,
        with_backing_plate=True,
    )
    # 背面 (+Y: 渋谷川向き)
    add_3d_stream_architectural_emblem(
        bm,
        center=Vector((0.0, 19.65, 152.0)),
        tangent_dir=Vector((-1.0, 0.0, 0.0)),
        normal_dir=Vector((0.0, 1.0, 0.0)),
        cap_height=5.4,
        depth=0.55,
        with_backing_plate=True,
    )
    # 左側面 (-X: 渋谷駅・国道246号向き)
    add_3d_stream_architectural_emblem(
        bm,
        center=Vector((-25.65, 0.0, 152.0)),
        tangent_dir=Vector((0.0, -1.0, 0.0)),
        normal_dir=Vector((-1.0, 0.0, 0.0)),
        cap_height=4.6,
        depth=0.55,
        with_backing_plate=True,
    )
    # 右側面 (+X: 恵比寿・並木橋向き)
    add_3d_stream_architectural_emblem(
        bm,
        center=Vector((25.65, 0.0, 152.0)),
        tangent_dir=Vector((0.0, 1.0, 0.0)),
        normal_dir=Vector((1.0, 0.0, 0.0)),
        cap_height=4.6,
        depth=0.55,
        with_backing_plate=True,
    )

    # 2. 中層ポディウム冠部サイン (Z = 29.2m) — 明治通り・広場側(-Y) ＆ 渋谷駅側(-X)
    add_3d_stream_architectural_emblem(
        bm,
        center=Vector((-2.0, -21.05, 29.2)),
        tangent_dir=Vector((1.0, 0.0, 0.0)),
        normal_dir=Vector((0.0, -1.0, 0.0)),
        cap_height=3.2,
        depth=0.42,
        with_backing_plate=True,
    )
    add_3d_stream_architectural_emblem(
        bm,
        center=Vector((-26.45, -1.0, 29.2)),
        tangent_dir=Vector((0.0, -1.0, 0.0)),
        normal_dir=Vector((-1.0, 0.0, 0.0)),
        cap_height=2.8,
        depth=0.42,
        with_backing_plate=True,
    )

    # 3. 低層2Fエントランスデッキ・キャノピーサイン (Z = 10.6m, Y = -27.55m)
    add_3d_stream_architectural_emblem(
        bm,
        center=Vector((-1.5, -27.55, 10.6)),
        tangent_dir=Vector((1.0, 0.0, 0.0)),
        normal_dir=Vector((0.0, -1.0, 0.0)),
        cap_height=2.15,
        depth=0.35,
        with_backing_plate=True,
    )

    # 4. 明治通り沿いアイレベル（ドライバー目線 Z = 1.65m）渋谷ストリーム モニュメントサイン（大階段への視界を遮らない洗練されたトーテム形状）
    monolith_pos = Vector((-7.5, -32.8, 1.65))
    add_box(
        bm,
        center=Vector((monolith_pos.x, monolith_pos.y, 1.45)),
        size=Vector((4.6, 0.68, 2.5)),
        mat_idx=2,
    )
    add_box(
        bm,
        center=Vector((monolith_pos.x, monolith_pos.y, 0.18)),
        size=Vector((5.1, 1.05, 0.36)),
        mat_idx=3,
    )
    # モニュメント上部のライムイエローアクセントバー
    add_box(
        bm,
        center=Vector((monolith_pos.x, monolith_pos.y, 2.76)),
        size=Vector((4.7, 0.74, 0.12)),
        mat_idx=5,
    )
    # モニュメント前面 (-Y) と 背面 (+Y) の立体ストリーム建築エンブレム
    add_3d_stream_architectural_emblem(
        bm,
        center=Vector((monolith_pos.x, monolith_pos.y - 0.40, 1.58)),
        tangent_dir=Vector((1.0, 0.0, 0.0)),
        normal_dir=Vector((0.0, -1.0, 0.0)),
        cap_height=0.88,
        depth=0.18,
        with_backing_plate=True,
    )
    add_3d_stream_architectural_emblem(
        bm,
        center=Vector((monolith_pos.x, monolith_pos.y + 0.40, 1.58)),
        tangent_dir=Vector((-1.0, 0.0, 0.0)),
        normal_dir=Vector((0.0, 1.0, 0.0)),
        cap_height=0.88,
        depth=0.18,
        with_backing_plate=True,
    )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("ShibuyaStream_Signage", mesh)
    assign_materials_to_object(obj, materials)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_shutoko_route3_viaduct(
    materials: dict[str, bpy.types.Material],
) -> bpy.types.Object:
    """
    首都高速3号渋谷線の実カーブ追従高架橋は tokyoStationMap.ts（ShutokoRoute3ViaductGroup）側で
    生成するため、GLB 内ではノード名互換用の空プレースホルダーノードのみを保持する。
    """
    _ = materials
    obj = bpy.data.objects.new("ShutokoRoute3_Viaduct", None)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 1.0
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_shibuya_scramble_square_tower(
    materials: dict[str, bpy.types.Material],
) -> bpy.types.Object:
    """
    渋谷スクランブルスクエア 東棟（Shibuya Scramble Square East Tower, 実寸 229.7m / 地上47階）を構築する。
    配置: worldX = -808.0, worldZ = 145.0 -> Blender (bx = 160.0, by = -113.0)
    隈研吾建築都市設計事務所・SANAA・日建設計による渋谷最高峰ランドマークの特徴を忠実に造形：
    - 低層〜中層商業ポディウム（Z = 0m..38m）:
      多段セットバックテラス、ハチ公広場正対の半円筒ガラスシャフト「アーバン・コア (Urban Core)」アトリウム、
      2F 東口ペデストリアンデッキ接続、および館名サイン「SHIBUYA SCRAMBLE SQUARE」ステンレスバー
    - 高層カーテンウォール（Z = 48m..214m）:
      傾斜約26度の滑らかな連続スパイラルリボンルーバー（add_slanted_ribbon）が4面を途切れなく包む
    - 屋上展望施設「SHIBUYA SKY（渋谷スカイ）」（Z = 214m..229.7m）:
      360度オープンエア展望デッキ、シアンブルーに輝くガラススカイエッジ（SKY EDGE）、
      3D「SHIBUYA SKY」クラウンロゴ、18条の天頂サーチライト光柱「CROSSING LIGHT」
      （ShibuyaSkySearchlightGlow）、屋上ヘリポート＆赤色航空障害灯
    """
    mesh = bpy.data.meshes.new("ShibuyaScrambleSquare_TowerMesh")
    bm = bmesh.new()

    cx = 160.0  # worldZ = 145.0
    cy = -113.0  # worldX = -808.0
    w_x = 54.0  # Z方向奥行
    d_y = 52.0  # X方向幅

    # 1. 低層商業ポディウム (1F〜11F, Z = 0m..38m)
    # 1F-3F 基壇部 (Z = 0..14m): 無地白灰スラブにならぬよう実写商業ファサード＋ガラスカーテンウォール＋縦マリオンで構成
    add_box(
        bm,
        center=Vector((cx, cy, 7.0)),
        size=Vector((w_x + 1.2, d_y + 1.2, 14.0)),
        mat_idx=2,  # StreamDarkVoidSteel
    )
    add_box(
        bm,
        center=Vector((cx, cy, 4.6)),
        size=Vector((w_x + 1.5, d_y + 1.5, 8.8)),
        mat_idx=19,  # ShibuyaCommercialFacade（1F〜2F 等倍2フロア店舗ショーウィンドウ）
        uv_rect=(0.0, 0.0, 1.0, 0.49),
    )
    add_box(
        bm,
        center=Vector((cx, cy, 11.4)),
        size=Vector((w_x + 1.4, d_y + 1.4, 4.8)),
        mat_idx=16,  # ShibuyaScrambleSquareFacade
        uv_rect=(0.0, 0.0, 1.0, 0.25),
    )
    for pz_low in [4.8, 9.2, 14.0]:
        add_box(
            bm,
            center=Vector((cx, cy, pz_low)),
            size=Vector((w_x + 2.0, d_y + 2.0, 0.62)),
            mat_idx=0,  # StreamWhitePanel
        )

    # 4F-8F 中層商業フロア (Z = 14..28m)
    add_box(
        bm,
        center=Vector((cx, cy, 21.0)),
        size=Vector((w_x, d_y, 14.0)),
        mat_idx=16,  # ShibuyaScrambleSquareFacade
        uv_rect=(0.0, 0.15, 1.0, 0.65),
    )
    for pz in [17.5, 21.0, 24.5, 28.0]:
        add_box(
            bm,
            center=Vector((cx, cy, pz)),
            size=Vector((w_x + 0.55, d_y + 0.55, 0.45)),
            mat_idx=0,
        )

    # 9F-11F 上層レストラン・セットバックテラス (Z = 28..38m)
    add_box(
        bm,
        center=Vector((cx, cy, 33.0)),
        size=Vector((w_x - 2.4, d_y - 2.4, 10.0)),
        mat_idx=16,  # ShibuyaScrambleSquareFacade
        uv_rect=(0.0, 0.55, 1.0, 0.92),
    )
    for pz_up in [31.4, 34.8, 38.0]:
        add_box(
            bm,
            center=Vector((cx, cy, pz_up)),
            size=Vector((w_x - 1.8, d_y - 1.8, 0.52)),
            mat_idx=3 if pz_up == 38.0 else 0,
        )

    # 低層〜中層ポディウム外周の垂直アルミフィン列（Z = 0..38m）
    num_pod_fins = 14
    for pf_i in range(num_pod_fins):
        p_ratio = (pf_i + 0.5) / num_pod_fins - 0.5
        pfx = cx + p_ratio * (w_x - 2.0)
        pfy = cy + p_ratio * (d_y - 2.0)
        p_mat = 0 if (pf_i % 2 == 0) else 3
        for sy in [-1.0, 1.0]:
            add_box(
                bm,
                center=Vector((pfx, cy + sy * (d_y * 0.5 + 0.85), 14.0)),
                size=Vector((0.34, 0.42, 28.0)),
                mat_idx=p_mat,
            )
        for sx in [-1.0, 1.0]:
            add_box(
                bm,
                center=Vector((cx + sx * (w_x * 0.5 + 0.85), pfy, 14.0)),
                size=Vector((0.42, 0.34, 28.0)),
                mat_idx=p_mat,
            )

    # 西面 (cy - d_y/2: ハチ公前・スクランブル交差点側) アーバン・コア (Urban Core) 半円筒ガラスアトリウム (Z = 0..34m)
    uc_x = cx + 5.0
    uc_y = cy - d_y * 0.5 + 0.5
    uc_r = 6.4
    uc_h = 34.0
    add_cylindrical_panel_z(
        bm,
        center=Vector((uc_x, uc_y, uc_h * 0.5)),
        r_inner=uc_r - 0.25,
        r_outer=uc_r,
        height=uc_h,
        start_rad=math.pi,
        end_rad=2.0 * math.pi,
        segments=20,
        mat_idx=1,  # StreamCurtainGlass
    )
    add_cylindrical_panel_z(
        bm,
        center=Vector((uc_x, uc_y, 16.5)),
        r_inner=0.8,
        r_outer=uc_r - 0.4,
        height=31.0,
        start_rad=math.pi + 0.08,
        end_rad=2.0 * math.pi - 0.08,
        segments=16,
        mat_idx=6,  # WarmPlazaGlow
    )
    for rz in [4.0, 8.0, 12.0, 16.0, 20.0, 24.0, 28.0, 32.0]:
        add_cylindrical_panel_z(
            bm,
            center=Vector((uc_x, uc_y, rz)),
            r_inner=uc_r - 0.15,
            r_outer=uc_r + 0.25,
            height=0.55,
            start_rad=math.pi - 0.05,
            end_rad=2.0 * math.pi + 0.05,
            segments=20,
            mat_idx=3,  # StreamGalvanizedFrame
        )
    for ang_deg in [195.0, 225.0, 270.0, 315.0, 345.0]:
        rad = math.radians(ang_deg)
        add_cylinder_z(
            bm,
            center=Vector((uc_x + math.cos(rad) * uc_r, uc_y + math.sin(rad) * uc_r, uc_h * 0.5)),
            radius=0.18,
            height=uc_h,
            segments=8,
            mat_idx=3,
        )

    # 2F 東口ペデストリアンデッキ接続連絡橋 (Z = 7.0..10.2m)
    add_box(
        bm,
        center=Vector((cx - 2.0, cy + d_y * 0.5 + 1.8, 8.6)),
        size=Vector((8.2, 4.0, 3.4)),
        mat_idx=3,  # StreamGalvanizedFrame
    )
    add_box(
        bm,
        center=Vector((cx - 2.0, cy + d_y * 0.5 + 1.8, 8.6)),
        size=Vector((7.6, 4.2, 2.8)),
        mat_idx=1,  # StreamCurtainGlass
    )

    # 館名サイン「SHIBUYA SCRAMBLE SQUARE」3Dステンレスサインバー
    # 西側アーバンコア前メインサイン
    add_box(
        bm,
        center=Vector((uc_x, uc_y - uc_r - 0.35, 5.8)),
        size=Vector((14.0, 0.45, 0.95)),
        mat_idx=3,  # StreamGalvanizedFrame
    )
    add_box(
        bm,
        center=Vector((uc_x, uc_y - uc_r - 0.42, 5.8)),
        size=Vector((13.6, 0.25, 0.65)),
        mat_idx=0,  # StreamWhitePanel
    )
    add_box(
        bm,
        center=Vector((uc_x, uc_y - uc_r - 0.25, 5.2)),
        size=Vector((13.6, 0.35, 0.20)),
        mat_idx=6,  # WarmPlazaGlow
    )
    # 東側明治通りエントランスサイン
    add_box(
        bm,
        center=Vector((cx, cy + d_y * 0.5 + 0.35, 5.8)),
        size=Vector((14.0, 0.45, 0.95)),
        mat_idx=3,  # StreamGalvanizedFrame
    )
    add_box(
        bm,
        center=Vector((cx, cy + d_y * 0.5 + 0.42, 5.8)),
        size=Vector((13.6, 0.25, 0.65)),
        mat_idx=0,  # StreamWhitePanel
    )
    add_box(
        bm,
        center=Vector((cx, cy + d_y * 0.5 + 0.25, 5.2)),
        size=Vector((13.6, 0.35, 0.20)),
        mat_idx=6,  # WarmPlazaGlow
    )

    # 12F イベントスペース「Scene12」中層ボイド＆セットバック帯 (Z = 38m..48m)
    add_box(
        bm,
        center=Vector((cx, cy, 43.0)),
        size=Vector((w_x - 3.0, d_y - 3.0, 10.0)),
        mat_idx=10,  # ShibuyaSkyEdgeGlow
    )
    add_box(
        bm,
        center=Vector((cx, cy, 48.0)),
        size=Vector((w_x + 0.8, d_y + 0.8, 0.9)),
        mat_idx=0,
    )

    # 2. 高層オフィスタワーコア (14F〜45F, Z = 48m..214m)
    tw_x = 47.0
    td_y = 45.0
    z_tower_bot = 48.0
    z_tower_top = 214.0
    tower_h = z_tower_top - z_tower_bot
    add_box(
        bm,
        center=Vector((cx, cy, z_tower_bot + tower_h * 0.5)),
        size=Vector((tw_x, td_y, tower_h)),
        mat_idx=16,  # ShibuyaScrambleSquareFacade
    )

    # 多層水平アルミフィン＆ウォームオフィス照明帯（28段）
    num_bands = 28
    band_step = tower_h / num_bands
    for b_idx in range(num_bands + 1):
        bz = z_tower_bot + b_idx * band_step
        add_box(
            bm,
            center=Vector((cx, cy, bz)),
            size=Vector((tw_x + 0.45, td_y + 0.45, 0.38)),
            mat_idx=0,
        )
        if b_idx < num_bands and (b_idx % 3 == 0):
            add_box(
                bm,
                center=Vector((cx, cy, bz + band_step * 0.5)),
                size=Vector((tw_x + 0.12, td_y + 0.12, band_step * 0.44)),
                mat_idx=6,
            )

    # 4面の垂直マリオン列
    num_fins = 16
    for f_idx in range(num_fins):
        ratio = (f_idx + 0.5) / num_fins - 0.5
        fx = cx + ratio * (tw_x - 2.0)
        for sy in [-1.0, 1.0]:
            add_box(
                bm,
                center=Vector((fx, cy + sy * (td_y * 0.5 + 0.24), z_tower_bot + tower_h * 0.5)),
                size=Vector((0.42, 0.48, tower_h)),
                mat_idx=0 if (f_idx % 2 == 0) else 3,
            )
        fy = cy + ratio * (td_y - 2.0)
        for sx in [-1.0, 1.0]:
            add_box(
                bm,
                center=Vector((cx + sx * (tw_x * 0.5 + 0.24), fy, z_tower_bot + tower_h * 0.5)),
                size=Vector((0.48, 0.42, tower_h)),
                mat_idx=0 if (f_idx % 2 == 1) else 3,
            )

    # 滑らかな連続斜めリボンルーバー（隈研吾・日建設計 傾斜角約26度の連続スパイラルフィン帯）
    tan_slope = 0.4877  # tan(26 degrees)
    delta_z_x = (tw_x - 1.0) * tan_slope
    delta_z_y = (td_y - 1.0) * tan_slope
    half_x = (tw_x - 1.0) * 0.5
    half_y = (td_y - 1.0) * 0.5

    base_heights = [48.0, 68.0, 88.0, 108.0, 128.0, 148.0, 168.0, 188.0]
    for bz in base_heights:
        for rib_offset_z in [0.0, 1.2]:
            cur_z = bz + rib_offset_z

            # 1. 西面 (-Y face, outward normal = (0, -1, 0))
            if cur_z < z_tower_top and (cur_z + delta_z_x) > z_tower_bot:
                z_s = max(z_tower_bot, cur_z)
                z_e = min(z_tower_top, cur_z + delta_z_x)
                frac_s = (z_s - cur_z) / delta_z_x
                frac_e = (z_e - cur_z) / delta_z_x
                p_s = Vector((cx - half_x + frac_s * (tw_x - 1.0), cy - td_y * 0.5 - 0.32, z_s))
                p_e = Vector((cx - half_x + frac_e * (tw_x - 1.0), cy - td_y * 0.5 - 0.32, z_e))
                add_slanted_ribbon(
                    bm,
                    p_s,
                    p_e,
                    outward_normal=Vector((0.0, -1.0, 0.0)),
                    ribbon_width=0.48,
                    ribbon_depth=0.55,
                    mat_idx=0,
                )
            cur_z += delta_z_x

            # 2. 北面 (+X face, outward normal = (1, 0, 0))
            if cur_z < z_tower_top and (cur_z + delta_z_y) > z_tower_bot:
                z_s = max(z_tower_bot, cur_z)
                z_e = min(z_tower_top, cur_z + delta_z_y)
                frac_s = (z_s - cur_z) / delta_z_y
                frac_e = (z_e - cur_z) / delta_z_y
                p_s = Vector((cx + tw_x * 0.5 + 0.32, cy - half_y + frac_s * (td_y - 1.0), z_s))
                p_e = Vector((cx + tw_x * 0.5 + 0.32, cy - half_y + frac_e * (td_y - 1.0), z_e))
                add_slanted_ribbon(
                    bm,
                    p_s,
                    p_e,
                    outward_normal=Vector((1.0, 0.0, 0.0)),
                    ribbon_width=0.48,
                    ribbon_depth=0.55,
                    mat_idx=0,
                )
            cur_z += delta_z_y

            # 3. 東面 (+Y face, outward normal = (0, 1, 0))
            if cur_z < z_tower_top and (cur_z + delta_z_x) > z_tower_bot:
                z_s = max(z_tower_bot, cur_z)
                z_e = min(z_tower_top, cur_z + delta_z_x)
                frac_s = (z_s - cur_z) / delta_z_x
                frac_e = (z_e - cur_z) / delta_z_x
                p_s = Vector((cx + half_x - frac_s * (tw_x - 1.0), cy + td_y * 0.5 + 0.32, z_s))
                p_e = Vector((cx + half_x - frac_e * (tw_x - 1.0), cy + td_y * 0.5 + 0.32, z_e))
                add_slanted_ribbon(
                    bm,
                    p_s,
                    p_e,
                    outward_normal=Vector((0.0, 1.0, 0.0)),
                    ribbon_width=0.48,
                    ribbon_depth=0.55,
                    mat_idx=0,
                )
            cur_z += delta_z_x

            # 4. 南面 (-X face, outward normal = (-1, 0, 0))
            if cur_z < z_tower_top and (cur_z + delta_z_y) > z_tower_bot:
                z_s = max(z_tower_bot, cur_z)
                z_e = min(z_tower_top, cur_z + delta_z_y)
                frac_s = (z_s - cur_z) / delta_z_y
                frac_e = (z_e - cur_z) / delta_z_y
                p_s = Vector((cx - tw_x * 0.5 - 0.32, cy + half_y - frac_s * (td_y - 1.0), z_s))
                p_e = Vector((cx - tw_x * 0.5 - 0.32, cy + half_y - frac_e * (td_y - 1.0), z_e))
                add_slanted_ribbon(
                    bm,
                    p_s,
                    p_e,
                    outward_normal=Vector((-1.0, 0.0, 0.0)),
                    ribbon_width=0.48,
                    ribbon_depth=0.55,
                    mat_idx=0,
                )

    # 3. 屋上展望施設「SHIBUYA SKY（渋谷スカイ）」(46F〜屋上: Z = 214m..229.7m)
    # 展望回廊 SKY GALLERY & スカイエッジ発光ガラス壁 (Z = 214m..223.5m)
    add_box(
        bm,
        center=Vector((cx, cy, 218.8)),
        size=Vector((tw_x - 1.2, td_y - 1.2, 9.6)),
        mat_idx=10,  # ShibuyaSkyEdgeGlow
    )
    # 展望デッキ外周の白い水平クラウンフレーム
    for crown_z in [214.2, 223.6, 228.2]:
        add_box(
            bm,
            center=Vector((cx, cy, crown_z)),
            size=Vector((tw_x + 1.1, td_y + 1.1, 0.75)),
            mat_idx=0,
        )
    # SHIBUYA SKY コーナー展望台「SKY EDGE」（張り出しガラスデッキ）
    for sx, sy in [(-1.0, 1.0), (-1.0, -1.0), (1.0, 1.0)]:
        add_box(
            bm,
            center=Vector((cx + sx * (tw_x * 0.5 - 2.5), cy + sy * (td_y * 0.5 - 2.5), 225.8)),
            size=Vector((9.5, 9.5, 4.2)),
            mat_idx=10,
        )

    # 3D "SHIBUYA SKY" 屋上クラウン発光ロゴサイン（南西角西面クラウンフレーム）
    add_box(
        bm,
        center=Vector((cx - 6.0, cy - td_y * 0.5 - 0.45, 225.8)),
        size=Vector((18.5, 0.35, 2.2)),
        mat_idx=2,  # StreamDarkVoidSteel
    )
    add_box(
        bm,
        center=Vector((cx - 6.0, cy - td_y * 0.5 - 0.65, 225.8)),
        size=Vector((16.8, 0.25, 1.35)),
        mat_idx=10,  # ShibuyaSkyEdgeGlow
    )

    # 屋上オープンエア芝生・ウッドデッキ＆ヘリポート (Z = 223.8m..229.7m)
    add_box(
        bm,
        center=Vector((cx, cy, 226.4)),
        size=Vector((tw_x - 8.0, td_y - 8.0, 5.2)),
        mat_idx=2,
    )
    # 屋上ヘリポート着陸パッド（グリーン標識パッド＋白 H マーク）
    add_box(
        bm,
        center=Vector((cx, cy, 229.25)),
        size=Vector((18.0, 18.0, 0.45)),
        mat_idx=21,  # HeliportGreenPad
    )
    for hx_off in [-3.2, 3.2]:
        add_box(
            bm,
            center=Vector((cx + hx_off, cy, 229.55)),
            size=Vector((1.4, 9.0, 0.25)),
            mat_idx=0,
        )
    add_box(
        bm,
        center=Vector((cx, cy, 229.55)),
        size=Vector((6.4, 1.4, 0.25)),
        mat_idx=0,
    )

    # 屋上四隅の赤色航空障害灯
    for sx in [-1.0, 1.0]:
        for sy in [-1.0, 1.0]:
            add_cylinder_z(
                bm,
                center=Vector((cx + sx * (tw_x * 0.5 - 1.0), cy + sy * (td_y * 0.5 - 1.0), 230.6)),
                radius=0.55,
                height=2.0,
                segments=12,
                mat_idx=7,  # BeaconRed
            )

    # 18条の天頂サーチライト「CROSSING LIGHT」（SHIBUYA SKY 夜間象徴ライト演出）
    # 西面 5基, 東面 5基, 北面 4基, 南面 4基 = 計18基
    searchlight_positions = []
    # 西端 (y = cy - td_y * 0.5 + 2.2)
    for i in range(5):
        fx = cx - 18.0 + i * 9.0
        fy = cy - td_y * 0.5 + 2.2
        searchlight_positions.append((fx, fy))
    # 東端 (y = cy + td_y * 0.5 - 2.2)
    for i in range(5):
        fx = cx - 18.0 + i * 9.0
        fy = cy + td_y * 0.5 - 2.2
        searchlight_positions.append((fx, fy))
    # 北端 (x = cx + tw_x * 0.5 - 2.2)
    for i in range(4):
        fx = cx + tw_x * 0.5 - 2.2
        fy = cy - 14.0 + i * 9.33
        searchlight_positions.append((fx, fy))
    # 南端 (x = cx - tw_x * 0.5 + 2.2)
    for i in range(4):
        fx = cx - tw_x * 0.5 + 2.2
        fy = cy - 14.0 + i * 9.33
        searchlight_positions.append((fx, fy))

    for fx, fy in searchlight_positions:
        add_cylinder_z(
            bm,
            center=Vector((fx, fy, 229.45)),
            radius=0.45,
            height=0.55,
            segments=12,
            mat_idx=2,  # StreamDarkVoidSteel
        )
        p_base = Vector((fx, fy, 229.75))
        p_top = Vector((fx + (cx - fx) * 0.16, fy + (cy - fy) * 0.16, 355.0))
        add_cone_beam(
            bm,
            p_base=p_base,
            p_top=p_top,
            r_base=0.35,
            r_top=2.6,
            segments=12,
            mat_idx=29,  # ShibuyaSkySearchlightGlow
        )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("ShibuyaScrambleSquare_Tower", mesh)
    assign_materials_to_object(obj, materials)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_shibuya_hikarie_tower(
    materials: dict[str, bpy.types.Material],
) -> bpy.types.Object:
    """
    渋谷ヒカリエ（Shibuya Hikarie, 実寸 182.5m / 地上34階）を構築する。
    配置: worldX = -692.0, worldZ = 146.0 -> Blender (bx = 161.0, by = 3.0)
    日建設計・隈研吾氏らによる渋谷駅東口の象徴的複合タワーの特徴を造形：
    - 低層商業「ShinQs」ステップ状ガラスポディウム（1F〜8F, Z = 0m..36m）と2F貫通アーバンコア歩行者デッキ口
    - 中層11F〜16F（Z = 42m..76m）に浮かぶ球体・楕円ドラム型ミュージカル劇場「東急シアターオーブ（Tokyu Theatre Orb）」
      およびガラス張りの11Fスカイロビー（明治通り側へキャンチレバーで張り出す発光アトリウム）
    - 高層オフィスタワー（17F〜34F, Z = 76m..182.5m）の南北ツインガラスコア＆白マリオンフレーム
    """
    mesh = bpy.data.meshes.new("ShibuyaHikarie_TowerMesh")
    bm = bmesh.new()

    cx = 163.0  # worldZ = 148.0 (国道246号北側首都高橋脚 z=119.5 を南端 z=123.0 でクリア)
    cy = 5.0  # worldX = -690.0 (西端 x=-714.0 でヒカリエ連絡路 x=-727.5±5.0 を完全クリア)
    w_x = 50.0
    d_y = 48.0

    # 1. 低層商業ポディウム「ShinQs」(Z = 0m..38m)
    add_box(
        bm,
        center=Vector((cx, cy, 19.0)),
        size=Vector((w_x, d_y, 38.0)),
        mat_idx=1,
    )
    # 1F〜2F 商業ショーウィンドウ（無地灰壁を排除し等倍2フロア商業ファサードを展開）
    add_box(
        bm,
        center=Vector((cx, cy, 4.6)),
        size=Vector((w_x + 0.32, d_y + 0.32, 8.8)),
        mat_idx=19,
        uv_rect=(0.0, 0.0, 1.0, 0.49),
    )
    for pz in [5.0, 9.5, 14.5, 20.0, 25.5, 31.5, 37.5]:
        add_box(
            bm,
            center=Vector((cx, cy, pz)),
            size=Vector((w_x + 0.55, d_y + 0.55, 0.55)),
            mat_idx=0,
        )
    # ShinQs ポディウム外周の垂直アルミマリオン
    for h_mull in range(11):
        hm_ratio = -0.45 + (h_mull / 10.0) * 0.90
        for sy in [-1.0, 1.0]:
            add_box(
                bm,
                center=Vector((cx + hm_ratio * w_x, cy + sy * (d_y * 0.5 + 0.22), 19.0)),
                size=Vector((0.36, 0.38, 37.6)),
                mat_idx=0 if (h_mull % 2 == 0) else 3,
            )
        for sx in [-1.0, 1.0]:
            add_box(
                bm,
                center=Vector((cx + sx * (w_x * 0.5 + 0.22), cy + hm_ratio * d_y, 19.0)),
                size=Vector((0.38, 0.36, 37.6)),
                mat_idx=0 if (h_mull % 2 == 1) else 3,
            )
    # 明治通り側 (-Y) の円筒ガラスアーバンコア（エレベーター・エスカレーターシャフト）
    add_cylinder_z(
        bm,
        center=Vector((cx - 14.0, cy - d_y * 0.5 + 0.5, 24.0)),
        radius=4.2,
        height=48.0,
        segments=24,
        mat_idx=1,
    )
    for uc_rz in range(6, 48, 6):
        add_cylinder_z(
            bm,
            center=Vector((cx - 14.0, cy - d_y * 0.5 + 0.5, float(uc_rz))),
            radius=4.38,
            height=0.38,
            segments=24,
            mat_idx=3,
        )

    # 2. 中層 11F スカイロビー＆「東急シアターオーブ（Tokyu Theatre Orb）」(Z = 38m..76m)
    # 明治通り(-Y)および国道246号(-X)側のガラスボイドから、多段球面ルーバーで構成された
    # ゴールド球体劇場「東急シアターオーブ」がダイナミックに張り出す実在造形
    add_box(
        bm,
        center=Vector((cx + 3.0, cy + 3.0, 57.0)),
        size=Vector((w_x - 6.0, d_y - 6.0, 35.0)),
        mat_idx=2,
    )
    # シアターオーブ背後のガラスアトリウムコア（オーブ前面を塞がず背後に控える）
    add_box(
        bm,
        center=Vector((cx + 1.5, cy + 1.5, 57.0)),
        size=Vector((w_x - 2.0, d_y - 2.0, 36.0)),
        mat_idx=1,
    )
    # 多段楕円球体（Spheroid）としてのシアターオーブ造形（11層の球面曲率リング＋水平シルバー＆ウォームルーバー）
    orb_cx = cx - 5.2
    orb_cy = cy - 8.8
    orb_cz = 57.5
    orb_max_r = 22.8
    orb_half_h = 14.8
    num_orb_rings = 11
    for r_i in range(num_orb_rings):
        norm_z = -0.88 + (r_i / (num_orb_rings - 1)) * 1.76
        ring_z = orb_cz + norm_z * orb_half_h
        sphere_factor = math.sqrt(max(0.22, 1.0 - norm_z * norm_z * 0.76))
        ring_r = orb_max_r * sphere_factor
        ring_h = (orb_half_h * 2.0 / num_orb_rings) * 0.86
        add_cylinder_z(
            bm,
            center=Vector((orb_cx, orb_cy, ring_z)),
            radius=ring_r,
            height=ring_h,
            segments=36,
            mat_idx=11,
        )
        # 球体を包む繊細なシルバー水平リングフィン
        add_cylinder_z(
            bm,
            center=Vector((orb_cx, orb_cy, ring_z)),
            radius=ring_r + 0.24,
            height=0.28,
            segments=36,
            mat_idx=3,
        )
    # シアターオーブ上下の白構造デッキスラブ（オーブ中央 Z=46..69m はオープンに抜いて球体を魅せる）
    for orb_z in [38.5, 43.5, 71.5, 75.5]:
        add_box(
            bm,
            center=Vector((cx, cy - 0.8, orb_z)),
            size=Vector((w_x + 1.6, d_y + 2.0, 0.62)),
            mat_idx=0,
        )
    for tr_i in range(11):
        tr_ratio = -0.46 + (tr_i / 10.0) * 0.92
        for sy in [-1.0, 1.0]:
            if sy < 0.0 and abs(tr_ratio) < 0.32:
                continue
            add_box(
                bm,
                center=Vector((cx + tr_ratio * w_x, cy - 0.8 + sy * (d_y * 0.5 + 0.52), 57.0)),
                size=Vector((0.38, 0.42, 36.6)),
                mat_idx=3,
            )
        for sx in [-1.0, 1.0]:
            if sx < 0.0 and abs(tr_ratio) < 0.32:
                continue
            add_box(
                bm,
                center=Vector((cx + sx * (w_x * 0.5 + 0.52), cy - 0.8 + tr_ratio * d_y, 57.0)),
                size=Vector((0.42, 0.38, 36.6)),
                mat_idx=3,
            )
    # 11F スカイロビーのキャンチレバー展望ガラスデッキ
    add_box(
        bm,
        center=Vector((cx, cy - d_y * 0.5 - 2.2, 42.0)),
        size=Vector((w_x - 2.0, 2.2, 5.4)),
        mat_idx=1,
    )
    add_box(
        bm,
        center=Vector((cx, cy - d_y * 0.5 - 1.8, 42.0)),
        size=Vector((w_x - 2.8, 1.6, 4.6)),
        mat_idx=6,
    )

    # 3. 高層オフィスタワー（17F〜34F, Z = 76m..182.5m）：分節されたツインガラスボリューム＋高密度縦マリオン
    z_hi_bot = 76.0
    z_hi_top = 182.5
    hi_h = z_hi_top - z_hi_bot
    tw_x = 44.0
    td_y = 40.0
    add_box(
        bm,
        center=Vector((cx, cy, z_hi_bot + hi_h * 0.5)),
        size=Vector((tw_x, td_y, hi_h)),
        mat_idx=1,
    )
    # 南北分節スリット（ヒカリエ特有の垂直ガラススリット）
    add_box(
        bm,
        center=Vector((cx, cy, z_hi_bot + hi_h * 0.5)),
        size=Vector((4.2, td_y + 0.6, hi_h + 0.8)),
        mat_idx=10,
    )
    for fl in range(22):
        fz = z_hi_bot + fl * (hi_h / 22.0)
        add_box(
            bm,
            center=Vector((cx, cy, fz)),
            size=Vector((tw_x + 0.45, td_y + 0.45, 0.36)),
            mat_idx=0,
        )
        if fl % 3 == 1:
            add_box(
                bm,
                center=Vector((cx, cy, fz + 2.2)),
                size=Vector((tw_x + 0.12, td_y + 0.12, 1.8)),
                mat_idx=6,
            )
    # 高層タワー4面の垂直アルミマリオン列（13本×4面）
    for hm_i in range(13):
        hm_r = -0.46 + (hm_i / 12.0) * 0.92
        m_mat = 0 if (hm_i % 3 == 0) else 3
        for sy in [-1.0, 1.0]:
            add_box(
                bm,
                center=Vector(
                    (cx + hm_r * tw_x, cy + sy * (td_y * 0.5 + 0.22), z_hi_bot + hi_h * 0.5)
                ),
                size=Vector((0.36, 0.40, hi_h)),
                mat_idx=m_mat,
            )
        for sx in [-1.0, 1.0]:
            add_box(
                bm,
                center=Vector(
                    (cx + sx * (tw_x * 0.5 + 0.22), cy + hm_r * td_y, z_hi_bot + hi_h * 0.5)
                ),
                size=Vector((0.40, 0.36, hi_h)),
                mat_idx=m_mat,
            )

    # 屋上冠部フレーム＆航空障害灯
    add_box(
        bm,
        center=Vector((cx, cy, z_hi_top - 2.5)),
        size=Vector((tw_x + 0.9, td_y + 0.9, 1.2)),
        mat_idx=0,
    )
    for sx in [-1.0, 1.0]:
        for sy in [-1.0, 1.0]:
            add_cylinder_z(
                bm,
                center=Vector(
                    (cx + sx * (tw_x * 0.5 - 1.0), cy + sy * (td_y * 0.5 - 1.0), z_hi_top + 0.9)
                ),
                radius=0.5,
                height=1.8,
                segments=12,
                mat_idx=7,
            )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("ShibuyaHikarie_Tower", mesh)
    assign_materials_to_object(obj, materials)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_shibuya_pedestrian_deck_and_rail_overpass(
    materials: dict[str, bpy.types.Material],
) -> bpy.types.Object:
    """
    1:1 非反転実座標系の渋谷駅東口歩道橋および東京メトロ銀座線 渋谷駅新駅舎（M字アーチ屋根）を構築する。
    (旧直線 JR 山手線高架・直線 246 デッキは tokyoStationMap.ts 側の曲線・NNE-SSW 実軸構造へ移行済みのため除外)
    """
    mesh = bpy.data.meshes.new("ShibuyaEastDeckAndRailMesh")
    bm = bmesh.new()

    def add_skywalk_span(
        cx_w: float,
        cz_w: float,
        tx_w: float,
        tz_w: float,
        span_len: float,
        width: float,
        deck_h: float = 8.35,
    ) -> None:
        base_z = sample_shibuya_terrain_y(cx_w, cz_w)
        deck_z = base_z + deck_h
        bx = cx_w - (-750.0)
        by = 527.6 - cz_w
        # Blender XY 上の方向ベクトル (dbx = dwx, dby = -dwz)
        t_dir = Vector((tx_w, -tz_w, 0.0)).normalized()
        n_dir = Vector((-t_dir.y, t_dir.x, 0.0))

        # 歩道橋床版スラブ & 下部ダークスチール桁
        add_oriented_box(
            bm,
            center=Vector((bx, by, deck_z)),
            tangent_dir=t_dir,
            normal_dir=n_dir,
            size_tangent=span_len,
            size_normal=width,
            size_z=0.68,
            mat_idx=0,
        )
        add_oriented_box(
            bm,
            center=Vector((bx, by, deck_z - 0.48)),
            tangent_dir=t_dir,
            normal_dir=n_dir,
            size_tangent=max(2.0, span_len - 0.6),
            size_normal=max(1.2, width - 0.6),
            size_z=0.34,
            mat_idx=2,
        )
        # 両側ガラス欄干＋アルミ笠木
        for side in [-1.0, 1.0]:
            rail_off = n_dir * (side * (width * 0.5 - 0.14))
            add_oriented_box(
                bm,
                center=Vector((bx + rail_off.x, by + rail_off.y, deck_z + 0.92)),
                tangent_dir=t_dir,
                normal_dir=n_dir,
                size_tangent=span_len,
                size_normal=0.16,
                size_z=1.18,
                mat_idx=10,
            )
            add_oriented_box(
                bm,
                center=Vector((bx + rail_off.x, by + rail_off.y, deck_z + 1.56)),
                tangent_dir=t_dir,
                normal_dir=n_dir,
                size_tangent=span_len,
                size_normal=0.26,
                size_z=0.14,
                mat_idx=0,
            )
        # 白ルーフキャノピー
        add_oriented_box(
            bm,
            center=Vector((bx, by, deck_z + 3.0)),
            tangent_dir=t_dir,
            normal_dir=n_dir,
            size_tangent=max(2.0, span_len - 2.0),
            size_normal=width + 0.5,
            size_z=0.24,
            mat_idx=0,
        )
        # 両端の歩道接地スチール橋脚（車道外側のみ）
        for end_sign in [-1.0, 1.0]:
            p_off = t_dir * (end_sign * (span_len * 0.5 - 1.2))
            px_w = cx_w + p_off.x
            pz_w = cz_w - p_off.y
            end_ground_z = sample_shibuya_terrain_y(px_w, pz_w)
            pier_bot = end_ground_z - 3.0
            pier_top = deck_z - 0.2
            pier_h = max(4.0, pier_top - pier_bot)
            add_cylinder_z(
                bm,
                center=Vector((bx + p_off.x, by + p_off.y, (pier_bot + pier_top) * 0.5)),
                radius=0.52,
                height=pier_h,
                segments=14,
                mat_idx=3,
            )

    # 1a. 渋谷駅東口歩道橋：玉川通り/R246 跨道スパン (-775, 438)
    add_skywalk_span(-775.0, 438.0, 0.3335, 0.9428, span_len=48.0, width=6.0, deck_h=8.35)
    # 1b. 渋谷駅東口歩道橋：明治通り横断スパン (-776, 400)
    add_skywalk_span(-776.0, 400.0, 0.9547, -0.2976, span_len=62.0, width=5.6, deck_h=8.35)

    # 2. 東京メトロ銀座線 渋谷駅新駅舎（M字アーチ屋根ホーム）
    # (-835, 315) -> Blender (bx = -85.0, by = 212.6), 東西スパン 122m で明治通り (-802, 315) 上空を横断
    ginza_wx = -835.0
    ginza_wz = 315.0
    ginza_base_z = sample_shibuya_terrain_y(ginza_wx, ginza_wz)
    ginza_bx = ginza_wx - (-750.0)  # -85.0
    ginza_by = 527.6 - ginza_wz  # 212.6
    ginza_span_x = 122.0
    ginza_depth_y = 14.4

    add_box(
        bm,
        center=Vector((ginza_bx, ginza_by, ginza_base_z + 14.8)),
        size=Vector((ginza_span_x, ginza_depth_y, 1.2)),
        mat_idx=8,
    )
    add_box(
        bm,
        center=Vector((ginza_bx, ginza_by, ginza_base_z + 16.8)),
        size=Vector((ginza_span_x - 0.8, ginza_depth_y - 0.7, 2.8)),
        mat_idx=1,
    )
    add_box(
        bm,
        center=Vector((ginza_bx, ginza_by, ginza_base_z + 18.6)),
        size=Vector((ginza_span_x + 2.0, ginza_depth_y + 0.8, 0.85)),
        mat_idx=0,
    )
    for arch_idx in range(17):
        ax = ginza_bx - ginza_span_x * 0.5 + (arch_idx + 0.5) * (ginza_span_x / 17.0)
        add_box(
            bm,
            center=Vector((ax, ginza_by, ginza_base_z + 17.2)),
            size=Vector((0.55, ginza_depth_y + 1.0, 3.6)),
            mat_idx=0,
        )
    # 銀座線駅舎 東西支持橋脚（JR線路側・明治通り東側歩道に接地）
    for pier_wx in [-884.0, -778.0]:
        p_bx = pier_wx - (-750.0)
        p_ground = sample_shibuya_terrain_y(pier_wx, ginza_wz)
        p_bot = p_ground - 3.0
        p_top = ginza_base_z + 14.5
        for side_y in [-5.4, 5.4]:
            add_box(
                bm,
                center=Vector((p_bx, ginza_by + side_y, (p_bot + p_top) * 0.5)),
                size=Vector((1.35, 1.35, max(6.0, p_top - p_bot))),
                mat_idx=8,
            )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("ShibuyaEastPedestrianDeck", mesh)
    assign_materials_to_object(obj, materials)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_shibuya_sakura_stage_tower(
    materials: dict[str, bpy.types.Material],
) -> bpy.types.Object:
    """
    渋谷サクラステージ（Shibuya Sakura Stage / SHIBUYAタワー, 実寸 179.9m / 地上39階）
    Three.js ワールド座標 (x=-812.0, z=-25.0) -> Blender 座標 (bx=-10.0, by=-117.0):
    1. 低層商業ポディウム（1F〜5F, Z=0.0m〜32.0m）:
       - 東側（明治通り・JR渋谷駅新南改札側 `by = -92.0`）の象徴的なチェリーピンク発光アトリウム「KINETIC GATE（ときめきSTAGE）」
       - 1F〜4F へと連鎖する段状ランドスケープテラス「にぎわいSTAGE」＆植栽グリーンプランター
       - 2F/3F 北東側で `ShibuyaEastPedestrianDeck`（西口・国道246号横断歩道橋）と直結する歩行者デッキ広場
    2. 中高層 SHIBUYAタワー（6F〜37F, Z=32.0m〜169.5m）:
       - 52.0m × 44.0m の高透過 Low-E ブルーグレーガラスカーテンウォール
       - サクラステージ特有の水平ホワイトアルミスパンドレルフィン＆コーナーのチェリーピンク垂直アクセントマリオン
       - 17F スカイロビー＆コワーキング「38F/17F ボイド緑化テラス」の水平セットバック
    3. 屋上メカニカルクラウン＆ヘリポート（38F〜R, Z=169.5m〜179.9m）:
       - ホワイトアルミルーバー冠部、四隅の航空障害灯レッドビーコン
    """
    mesh = bpy.data.meshes.new("ShibuyaSakuraStageMesh")
    bm = bmesh.new()

    cx = -10.0  # worldZ = -25.0 (南端 bx=-38 -> worldZ=-53, 北端 bx=+18 -> worldZ=+3)
    cy = -117.0  # worldX = -812.0 (西端 by=-142 -> worldX=-837, 東端 by=-92 -> worldX=-787: JR線路 by=-84 をクリア)
    w_x = 56.0
    d_y = 50.0

    # 1. 低層商業ポディウム（1F〜5F, Z = 0.0m .. 32.0m）
    add_box(
        bm,
        center=Vector((cx, cy, 16.0)),
        size=Vector((w_x, d_y, 32.0)),
        mat_idx=2,
    )
    add_box(
        bm,
        center=Vector((cx, cy, 20.0)),
        size=Vector((w_x + 0.18, d_y + 0.18, 22.0)),
        mat_idx=1,
    )
    # 1F〜2F 路面ショーウィンドウ（無地灰壁に見えない等倍2フロア商業ファサード＋縦マリオン）
    add_box(
        bm,
        center=Vector((cx, cy, 4.4)),
        size=Vector((w_x + 0.35, d_y + 0.35, 8.4)),
        mat_idx=19,
        uv_rect=(0.0, 0.0, 1.0, 0.49),
    )
    for sk_mull in range(11):
        sk_r = -0.45 + (sk_mull / 10.0) * 0.90
        for sy in [-1.0, 1.0]:
            add_box(
                bm,
                center=Vector((cx + sk_r * w_x, cy + sy * (d_y * 0.5 + 0.24), 16.0)),
                size=Vector((0.36, 0.36, 31.6)),
                mat_idx=0 if (sk_mull % 2 == 0) else 3,
            )
        for sx in [-1.0, 1.0]:
            add_box(
                bm,
                center=Vector((cx + sx * (w_x * 0.5 + 0.24), cy + sk_r * d_y, 16.0)),
                size=Vector((0.36, 0.36, 31.6)),
                mat_idx=0 if (sk_mull % 2 == 1) else 3,
            )

    # 段状ランドスケープテラス「にぎわいSTAGE」（東側・北東側に向かって階段状にせり出す4層の緑化デッキ）
    for step_idx in range(4):
        step_z = 8.2 + step_idx * 5.8
        terrace_ext_y = 4.2 - step_idx * 0.75
        terrace_y = cy + d_y * 0.5 + terrace_ext_y * 0.5
        # 白アルミデッキスラブ
        add_box(
            bm,
            center=Vector((cx + 2.0, terrace_y, step_z)),
            size=Vector((w_x - step_idx * 3.2, terrace_ext_y + 1.4, 1.15)),
            mat_idx=0,
        )
        # 植栽グリーンプランター帯
        add_box(
            bm,
            center=Vector((cx + 2.0, terrace_y + terrace_ext_y * 0.28, step_z + 0.92)),
            size=Vector((w_x - step_idx * 3.6 - 1.5, 1.35, 0.85)),
            mat_idx=4,
        )
        # ガラス手すり＆ウォーム間接照明
        add_box(
            bm,
            center=Vector((cx + 2.0, terrace_y + terrace_ext_y * 0.45, step_z + 1.15)),
            size=Vector((w_x - step_idx * 3.6, 0.22, 1.1)),
            mat_idx=6,
        )

    # 東面・北東角の象徴的な「KINETIC GATE（ときめきSTAGE）」チェリーピンク発光ガラスアトリウム
    gate_cx = cx + 12.5
    gate_cy = cy + d_y * 0.5 + 1.8
    # アトリウム背面のブルーグレーガラスコア
    add_box(
        bm,
        center=Vector((gate_cx, gate_cy - 0.35, 17.5)),
        size=Vector((22.4, 4.6, 25.0)),
        mat_idx=1,
    )
    # KINETIC GATE の3層ガラスステージボックス（チェリーピンク発光＋ウォームアトリウム交互配置）
    for k_tier in range(4):
        kz = 8.2 + k_tier * 6.0
        add_box(
            bm,
            center=Vector((gate_cx, gate_cy + 0.15, kz)),
            size=Vector((21.6, 4.8, 4.6)),
            mat_idx=12 if (k_tier % 2 == 0) else 6,
        )
        # 各ステージ間の水平ホワイトアルミデッキバンド
        add_box(
            bm,
            center=Vector((gate_cx, gate_cy + 0.45, kz - 2.55)),
            size=Vector((22.8, 5.4, 0.72)),
            mat_idx=0,
        )
    # KINETIC GATE を囲む白い立体フレームと桜色デジタルルーバー列
    for g_rib in range(8):
        gx = gate_cx - 10.5 + g_rib * 3.0
        add_box(
            bm,
            center=Vector((gx, gate_cy + 2.55, 17.5)),
            size=Vector((0.46, 0.72, 25.4)),
            mat_idx=0 if (g_rib % 2 == 0) else 12,
        )
    # 2F 歩行者デッキ連絡ブリッジ（東側のJR渋谷駅新南改札・西口歩道橋 `by = -78.5` へ接続）
    add_box(
        bm,
        center=Vector((cx + 22.0, -85.5, 7.8)),
        size=Vector((8.5, 14.5, 0.85)),
        mat_idx=0,
    )
    add_box(
        bm,
        center=Vector((cx + 22.0, -85.5, 9.0)),
        size=Vector((8.5, 14.5, 1.2)),
        mat_idx=12,
    )

    # 2. 中高層 SHIBUYAタワー（6F〜37F, Z = 32.0m .. 169.5m）
    tw_x = 46.0
    td_y = 40.0
    tower_base_z = 32.0
    tower_top_z = 169.5
    tower_h = tower_top_z - tower_base_z
    tower_cz = (tower_base_z + tower_top_z) * 0.5

    # タワーコアガラスカーテンウォール
    add_box(
        bm,
        center=Vector((cx, cy - 1.5, tower_cz)),
        size=Vector((tw_x, td_y, tower_h)),
        mat_idx=1,
    )

    # 17F スカイロビー＆緑化ボイドテラス（Z = 78.0m .. 85.5m）
    sky_lobby_z = 81.8
    add_box(
        bm,
        center=Vector((cx, cy - 1.5, sky_lobby_z)),
        size=Vector((tw_x + 1.8, td_y + 1.8, 6.2)),
        mat_idx=6,
    )
    add_box(
        bm,
        center=Vector((cx, cy - 1.5 + td_y * 0.5 + 0.8, sky_lobby_z - 2.2)),
        size=Vector((tw_x + 2.2, 2.2, 1.4)),
        mat_idx=4,
    )

    # 各階水平ホワイトアルミ・スパンドレルフィン＆ウォームオフィス窓バンド
    for z_step in range(18):
        fz = tower_base_z + 4.0 + z_step * 7.4
        add_box(
            bm,
            center=Vector((cx, cy - 1.5, fz)),
            size=Vector((tw_x + 0.65, td_y + 0.65, 0.62)),
            mat_idx=0,
        )
        if z_step % 2 == 0:
            add_box(
                bm,
                center=Vector((cx, cy - 1.5, fz + 2.6)),
                size=Vector((tw_x + 0.28, td_y + 0.28, 1.25)),
                mat_idx=6,
            )

    # 垂直ホワイトアルミマリオン列＋四隅のサクラピンク垂直ライトライン
    for m_idx in range(9):
        ratio = -0.44 + (m_idx / 8.0) * 0.88
        is_corner_accent = m_idx in (0, 8)
        m_mat = 12 if is_corner_accent else 0
        # 東面・西面
        for sy in [-1.0, 1.0]:
            add_box(
                bm,
                center=Vector((cx + ratio * tw_x, cy - 1.5 + sy * (td_y * 0.5 + 0.25), tower_cz)),
                size=Vector((0.52, 0.58, tower_h)),
                mat_idx=m_mat,
            )
        # 北面・南面
        for sx in [-1.0, 1.0]:
            add_box(
                bm,
                center=Vector((cx + sx * (tw_x * 0.5 + 0.25), cy - 1.5 + ratio * td_y, tower_cz)),
                size=Vector((0.58, 0.52, tower_h)),
                mat_idx=m_mat,
            )

    # 3. 屋上メカニカルクラウン＆桜色コーニスライン（Z = 169.5m .. 179.9m）
    add_box(
        bm,
        center=Vector((cx, cy - 1.5, 174.2)),
        size=Vector((tw_x * 0.88, td_y * 0.88, 9.4)),
        mat_idx=3,
    )
    add_box(
        bm,
        center=Vector((cx, cy - 1.5, 170.2)),
        size=Vector((tw_x + 0.9, td_y + 0.9, 1.4)),
        mat_idx=12,
    )
    add_box(
        bm,
        center=Vector((cx, cy - 1.5, 179.2)),
        size=Vector((tw_x * 0.92, td_y * 0.92, 1.2)),
        mat_idx=0,
    )

    # 四隅の航空障害灯レッドビーコン
    for sx in [-1.0, 1.0]:
        for sy in [-1.0, 1.0]:
            add_cylinder_z(
                bm,
                center=Vector((cx + sx * (tw_x * 0.43), cy - 1.5 + sy * (td_y * 0.43), 180.3)),
                radius=0.52,
                height=1.1,
                segments=12,
                mat_idx=7,
            )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("ShibuyaSakuraStage_Tower", mesh)
    assign_materials_to_object(obj, materials)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_shibuya_fukuras_tower(
    materials: dict[str, bpy.types.Material],
) -> bpy.types.Object:
    """
    渋谷フクラス / 東急プラザ渋谷（Shibuya Fukuras / Tokyu Plaza Shibuya, 実寸 103.3m / 地上18階）
    Three.js ワールド座標 (x=-815.0, z=46.0) -> Blender 座標 (bx=61.0, by=-120.0):
    1. 1F バスターミナル・ピロティ＆エントランスロビー（Z=0.0m〜7.2m）
    2. 東急プラザ渋谷（2F〜8F, Z=7.2m〜34.5m）:
       - 手塚建築研究所・日建設計による「折り紙・結晶体」モチーフの多面体プリーツ・ホワイトアルミルーバー基壇
       - 角度を交互に振ったV字プリーツスクリーンと内部の暖色商業アトリウム光・2F歩道橋連絡口
    3. 17F 屋上庭園「SHIBUYA NIWA（シブヤニワ）」＆中層セットバックテラス（Z=34.5m〜38.5m, Z=88.0m〜92.5m）:
       - 緑豊かなルーフトップガーデン植栽とオープンエアのカフェテラス発光
    4. 高層オフィスタワー（9F〜18F, Z=36.0m〜103.3m）:
       - 端正なブルーグレー反射ガラスカーテンウォール＋繊細なホワイトアルミ水平・垂直マリオン格子
    """
    mesh = bpy.data.meshes.new("ShibuyaFukurasMesh")
    bm = bmesh.new()

    cx = 61.0  # worldZ = 46.0 (南端 bx=38 -> worldZ=23, 北端 bx=84 -> worldZ=69: 国道246号 bx=96 をクリア)
    cy = -120.0  # worldX = -815.0 (西端 by=-143 -> worldX=-838, 東端 by=-97 -> worldX=-792: JR線 by=-84 をクリア)
    w_x = 46.0
    d_y = 46.0

    # 1. 1F バスターミナル・ピロティ＆商業エントランス（Z = 0.0m .. 7.5m）
    add_box(
        bm,
        center=Vector((cx, cy, 3.75)),
        size=Vector((w_x - 2.0, d_y - 2.0, 7.5)),
        mat_idx=2,
    )
    add_box(
        bm,
        center=Vector((cx, cy + 1.0, 3.6)),
        size=Vector((w_x - 1.6, d_y - 1.6, 6.8)),
        mat_idx=19,
        uv_rect=(0.0, 0.0, 1.0, 0.49),
    )
    # 1F バスターミナル外周のピロティ列柱
    for px_i in range(5):
        px = cx - (w_x * 0.42) + px_i * (w_x * 0.21)
        for py_side in [-1.0, 1.0]:
            add_cylinder_z(
                bm,
                center=Vector((px, cy + py_side * (d_y * 0.45), 3.75)),
                radius=0.62,
                height=7.5,
                segments=14,
                mat_idx=3,
            )

    # 2F 東口・西口歩行者デッキと直結するエントランスブリッジ（東側 `by = -78.5` の西側連絡デッキへ接続）
    add_box(
        bm,
        center=Vector((cx + 12.0, -88.0, 7.8)),
        size=Vector((7.5, 19.0, 0.82)),
        mat_idx=0,
    )
    add_box(
        bm,
        center=Vector((cx + 12.0, -88.0, 8.95)),
        size=Vector((7.5, 19.0, 1.15)),
        mat_idx=10,
    )

    # 2. 東急プラザ渋谷（2F〜8F, Z = 7.5m .. 34.5m）: 象徴的な折り紙プリーツ・ホワイトアルミルーバー基壇
    # 内部の商業ガラスコア（ブルーグレー反射ガラス＋ウォームアトリウム）
    add_box(
        bm,
        center=Vector((cx, cy, 21.0)),
        size=Vector((w_x - 0.8, d_y - 0.8, 27.0)),
        mat_idx=1,
    )
    for wf_i in range(5):
        wz = 10.2 + wf_i * 5.2
        add_box(
            bm,
            center=Vector((cx, cy, wz)),
            size=Vector((w_x - 0.2, d_y - 0.2, 2.2)),
            mat_idx=6,
        )

    # 多面体折り紙プリーツ水平シェルフ＆斜めファセットルーバー（手塚建築研究所の折り紙外装）
    for p_band in range(6):
        bz = 8.8 + p_band * 4.5
        sign = 1.0 if (p_band % 2 == 0) else -1.0
        # 水平プリーツキャノピーフィン
        add_box(
            bm,
            center=Vector((cx, cy, bz)),
            size=Vector((w_x + 1.8, d_y + 1.8, 0.68)),
            mat_idx=0,
        )
        # 4面に走る斜め折り紙プリーツルーバー列
        for l_idx in range(11):
            ratio = -0.44 + (l_idx / 10.0) * 0.88
            tilt = 0.26 * sign * (1.0 if (l_idx % 2 == 0) else -1.0)
            # 東面・西面
            for sy in [-1.0, 1.0]:
                add_oriented_box(
                    bm,
                    center=Vector(
                        (
                            cx + ratio * w_x,
                            cy + sy * (d_y * 0.5 + 0.55),
                            bz + 2.25,
                        )
                    ),
                    tangent_dir=Vector((tilt, 0.0, 1.0)).normalized(),
                    normal_dir=Vector((0.0, sy, 0.0)),
                    size_tangent=4.5,
                    size_normal=1.15,
                    size_z=0.52,
                    mat_idx=0,
                )
            # 北面・南面
            for sx in [-1.0, 1.0]:
                add_oriented_box(
                    bm,
                    center=Vector(
                        (
                            cx + sx * (w_x * 0.5 + 0.55),
                            cy + ratio * d_y,
                            bz + 2.25,
                        )
                    ),
                    tangent_dir=Vector((0.0, tilt, 1.0)).normalized(),
                    normal_dir=Vector((sx, 0.0, 0.0)),
                    size_tangent=4.5,
                    size_normal=1.15,
                    size_z=0.52,
                    mat_idx=0,
                )

    # 8F テラス緑化帯（Z = 34.5m .. 36.2m）
    add_box(
        bm,
        center=Vector((cx, cy, 35.1)),
        size=Vector((w_x + 1.4, d_y + 1.4, 1.2)),
        mat_idx=0,
    )
    add_box(
        bm,
        center=Vector((cx + 2.5, cy + 2.5, 36.0)),
        size=Vector((w_x - 3.0, d_y - 3.0, 1.2)),
        mat_idx=4,
    )

    # 3. 高層オフィスタワー（9F〜16F, Z = 36.0m .. 88.5m）
    tw_x = 39.0
    td_y = 39.0
    tower_cz = (36.0 + 88.5) * 0.5
    tower_h = 88.5 - 36.0
    add_box(
        bm,
        center=Vector((cx - 1.5, cy - 1.5, tower_cz)),
        size=Vector((tw_x, td_y, tower_h)),
        mat_idx=1,
    )
    for f_i in range(10):
        fz = 38.5 + f_i * 5.0
        add_box(
            bm,
            center=Vector((cx - 1.5, cy - 1.5, fz)),
            size=Vector((tw_x + 0.55, td_y + 0.55, 0.52)),
            mat_idx=0,
        )
        if f_i % 2 == 1:
            add_box(
                bm,
                center=Vector((cx - 1.5, cy - 1.5, fz + 2.2)),
                size=Vector((tw_x + 0.25, td_y + 0.25, 1.15)),
                mat_idx=6,
            )
    # 垂直ホワイトアルミマリオン
    for m_i in range(7):
        ratio = -0.42 + (m_i / 6.0) * 0.84
        for sy in [-1.0, 1.0]:
            add_box(
                bm,
                center=Vector(
                    (cx - 1.5 + ratio * tw_x, cy - 1.5 + sy * (td_y * 0.5 + 0.2), tower_cz)
                ),
                size=Vector((0.42, 0.45, tower_h)),
                mat_idx=0,
            )

    # 4. 17F〜18F 屋上庭園「SHIBUYA NIWA（シブヤニワ）」＆ルーフトップ展望ラウンジ（Z = 88.5m .. 103.3m）
    add_box(
        bm,
        center=Vector((cx - 1.5, cy - 1.5, 89.2)),
        size=Vector((tw_x + 1.4, td_y + 1.4, 1.4)),
        mat_idx=0,
    )
    add_box(
        bm,
        center=Vector((cx + 2.5, cy + 2.5, 90.4)),
        size=Vector((tw_x - 4.0, td_y - 4.0, 1.5)),
        mat_idx=4,
    )
    # 屋上庭園を囲むクリアガラス欄干とウォームラウンジ「CÉ LA VI TOKYO」
    add_box(
        bm,
        center=Vector((cx - 4.5, cy - 4.5, 95.2)),
        size=Vector((tw_x * 0.76, td_y * 0.76, 10.2)),
        mat_idx=1,
    )
    add_box(
        bm,
        center=Vector((cx - 4.5, cy - 4.5, 93.2)),
        size=Vector((tw_x * 0.78, td_y * 0.78, 3.2)),
        mat_idx=6,
    )
    add_box(
        bm,
        center=Vector((cx - 4.5, cy - 4.5, 101.5)),
        size=Vector((tw_x * 0.80, td_y * 0.80, 3.6)),
        mat_idx=0,
    )

    # 航空障害灯レッドビーコン
    for sx in [-1.0, 1.0]:
        for sy in [-1.0, 1.0]:
            add_cylinder_z(
                bm,
                center=Vector((cx - 4.5 + sx * 13.5, cy - 4.5 + sy * 13.5, 103.8)),
                radius=0.45,
                height=1.0,
                segments=12,
                mat_idx=7,
            )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("ShibuyaFukuras_Tower", mesh)
    assign_materials_to_object(obj, materials)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_shibuya_miyashita_park_complex(
    materials: dict[str, bpy.types.Material],
) -> bpy.types.Object:
    """
    MIYASHITA PARK / sequence MIYASHITA PARK（宮下公園・レイヤードミヤシタパーク, 実寸 71.8m / 地上18階）
    Three.js ワールド座標 (x=-695.0, z=248.0) -> Blender 座標 (bx=263.0, by=0.0):
    1. 低層商業施設「RAYARD MIYASHITA PARK」（1F〜3F, Z=0.0m〜16.5m, 全長 70.0m × 幅 42.0m）:
       - 1F「渋谷横丁（Shibuya Yokocho）」の暖色提灯・ネオン飲食街アーケード（西面＝明治通り沿い `by = -21.0`）
       - 2F/3F オープンエア商業回廊（キャンチレバーデッキ・ガラス手すり・階段）
    2. 4F 屋上立体都市公園「渋谷区立宮下公園」（Z=16.5m〜25.2m）:
       - 全面に広がる屋上芝生広場・植栽ツリー・スケート場＆ボルダリングウォール
       - 宮下公園の最も象徴的な「ボタニカル・パラボラアーチ鉄骨フレーム（10連の白/亜鉛めっきアーチキャノピー）」
       - 屋上中央のガラスパビリオンカフェ（Starbucks Coffee MIYASHITA PARK 店モチーフ）
    3. 北端のホテルタワー「sequence MIYASHITA PARK」（4F〜18F, Z=16.5m〜71.8m）:
       - 北側（`bx = 284.7`）にそびえるダークグレー＆ブルーグレーガラスの18階建てライフスタイルホテル棟
    """
    mesh = bpy.data.meshes.new("ShibuyaMiyashitaParkMesh")
    bm = bmesh.new()

    cx = 335.0  # worldZ = 320.0 (南端 bx=300 -> worldZ=285: 宮益坂 worldZ=248..254 を完全クリアし明治通り東側正規街区に整合)
    cy = 0.0  # worldX = -695.0 (西端 by=-21 -> worldX=-716: 明治通り東歩道外縁をクリア)
    w_x = 70.0
    d_y = 42.0
    park_deck_z = 16.5

    # 1. 1F〜3F 商業施設「RAYARD MIYASHITA PARK」基壇（実写ミヤシタパーク＆渋谷横丁ファサード）
    add_box(
        bm,
        center=Vector((cx, cy, park_deck_z * 0.5)),
        size=Vector((w_x, d_y, park_deck_z)),
        mat_idx=18,
    )
    # 1F「渋谷横丁」暖色飲食街アーケード（明治通り側 `by = -21.0` に連なる賑わい発光帯）
    add_box(
        bm,
        center=Vector((cx - 4.0, cy - d_y * 0.5 - 0.25, 3.6)),
        size=Vector((w_x - 6.0, 1.2, 5.2)),
        mat_idx=18,
    )
    # 渋谷横丁の赤・アンバー提灯ランタン列
    for yoko_i in range(14):
        yx = cx - w_x * 0.44 + yoko_i * (w_x * 0.88 / 13.0)
        add_box(
            bm,
            center=Vector((yx, cy - d_y * 0.5 - 0.95, 5.4)),
            size=Vector((1.8, 0.55, 0.95)),
            mat_idx=11 if (yoko_i % 2 == 0) else 13,
        )

    # 2F・3F オープンエア商業デッキスラブ＆緑化プランター
    for floor_z in [6.2, 11.4, 16.5]:
        add_box(
            bm,
            center=Vector((cx, cy, floor_z)),
            size=Vector((w_x + 1.8, d_y + 1.8, 0.95)),
            mat_idx=0,
        )
        add_box(
            bm,
            center=Vector((cx, cy - d_y * 0.5 - 0.65, floor_z + 1.05)),
            size=Vector((w_x + 1.4, 0.24, 1.15)),
            mat_idx=6,
        )

    # 2. 4F 屋上芝生公園「宮下公園」(Z = 16.5m .. 25.2m)
    add_box(
        bm,
        center=Vector((cx - 8.0, cy, park_deck_z + 0.75)),
        size=Vector((w_x - 14.0, d_y - 2.0, 1.1)),
        mat_idx=4,
    )
    # 屋上中央のガラスパビリオンカフェ
    add_box(
        bm,
        center=Vector((cx - 12.0, cy - 2.0, park_deck_z + 2.8)),
        size=Vector((14.0, 10.5, 4.2)),
        mat_idx=6,
    )
    add_box(
        bm,
        center=Vector((cx - 12.0, cy - 2.0, park_deck_z + 5.1)),
        size=Vector((15.6, 12.0, 0.55)),
        mat_idx=0,
    )

    # 象徴的な「ボタニカル・パラボラアーチ鉄骨フレーム列」（屋上公園を跨ぐ10連の白/シルバーアーチキャノピー）
    for arch_i in range(10):
        ax = (cx - w_x * 0.45) + arch_i * (w_x * 0.70 / 9.0)
        # 左右のアーチ垂直脚柱: y = ±19.5m, Z = 16.5m .. 21.5m (高さ 5.0m)
        for side_y in [-1.0, 1.0]:
            ay = cy + side_y * 19.5
            add_box(
                bm,
                center=Vector((ax, ay, park_deck_z + 2.5)),
                size=Vector((0.75, 0.85, 5.0)),
                mat_idx=0,
            )
            # 斜めニーブレース（アーチ肩部）: (y=±19.5, z=21.5) から (y=±10.5, z=24.8) を正確に結ぶ
            brace_dy = -side_y * 9.0
            brace_dz = 3.3
            brace_len = math.hypot(brace_dy, brace_dz) + 0.65
            t_vec = Vector((0.0, brace_dy, brace_dz)).normalized()
            n_vec = Vector((1.0, 0.0, 0.0))
            add_oriented_box(
                bm,
                center=Vector((ax, cy + side_y * 15.0, park_deck_z + 6.65)),
                tangent_dir=t_vec,
                normal_dir=n_vec,
                size_tangent=brace_len,
                size_normal=0.72,
                size_z=0.72,
                mat_idx=0,
            )
        # アーチ頂部水平ビーム: y = -10.8 .. +10.8m, Z = 24.8m
        add_box(
            bm,
            center=Vector((ax, cy, park_deck_z + 8.3)),
            size=Vector((0.78, 21.8, 0.78)),
            mat_idx=0,
        )

    # アーチ列を縦断連結するルーバーパーゴラ＆植栽グリーンネット
    for purlin_y in [-13.5, -7.5, 0.0, 7.5, 13.5]:
        pz = (park_deck_z + 8.3) if abs(purlin_y) <= 10.5 else (park_deck_z + 7.2)
        add_box(
            bm,
            center=Vector((cx - 7.0, cy + purlin_y, pz)),
            size=Vector((w_x * 0.72, 0.48, 0.48)),
            mat_idx=3,
        )

    # 3. 北端の18階建てホテルタワー「sequence MIYASHITA PARK」（Z = 16.5m .. 71.8m）
    hotel_cx = cx + w_x * 0.31  # bx = 284.7 (北側)
    hotel_cy = cy + 1.0
    hw_x = 22.0
    hd_y = 34.0
    hotel_base_z = 16.5
    hotel_top_z = 71.8
    hotel_h = hotel_top_z - hotel_base_z
    hotel_cz = (hotel_base_z + hotel_top_z) * 0.5

    add_box(
        bm,
        center=Vector((hotel_cx, hotel_cy, hotel_cz)),
        size=Vector((hw_x, hd_y, hotel_h)),
        mat_idx=1,
    )
    # ホテル外装のダークチャコール＆白アルミ縦ルーバーと客室照明バンド
    for hf_i in range(9):
        hf_z = hotel_base_z + 4.5 + hf_i * 5.8
        add_box(
            bm,
            center=Vector((hotel_cx, hotel_cy, hf_z)),
            size=Vector((hw_x + 0.5, hd_y + 0.5, 0.52)),
            mat_idx=0,
        )
        if hf_i % 2 == 0:
            add_box(
                bm,
                center=Vector((hotel_cx, hotel_cy, hf_z + 2.4)),
                size=Vector((hw_x + 0.25, hd_y + 0.25, 1.15)),
                mat_idx=6,
            )
    # 屋上クラウン＆航空障害灯
    add_box(
        bm,
        center=Vector((hotel_cx, hotel_cy, 70.2)),
        size=Vector((hw_x * 0.86, hd_y * 0.86, 3.2)),
        mat_idx=2,
    )
    for sx in [-1.0, 1.0]:
        for sy in [-1.0, 1.0]:
            add_cylinder_z(
                bm,
                center=Vector((hotel_cx + sx * 8.5, hotel_cy + sy * 13.5, 72.3)),
                radius=0.42,
                height=0.95,
                segments=12,
                mat_idx=7,
            )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("ShibuyaMiyashitaPark_Complex", mesh)
    assign_materials_to_object(obj, materials)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_shibuya_qfront_109_complex(
    materials: dict[str, bpy.types.Material],
) -> bpy.types.Object:
    """
    QFRONT・SHIBUYA109 街区（実寸街区へ分離配置）
    1. QFRONT（スクランブル交差点北側正面街区 `worldX=-815.0, worldZ=288.0` -> Blender `bx=303.0, by=-120.0`, Z=0..46m）:
       - スクランブル交差点北歩道（`z=270..278`）に正対し、センター街・公園通りに挟まれた一等地へ配置
       - 1F〜2F 展望ガラス帯および南正面密着型の大型メディア壁「Q'S EYE / SHIBUYA TSUTAYA」
    2. SHIBUYA109（道玄坂・文化村通り Y字分岐三角街区 `worldX=-879.0, worldZ=263.0` -> Blender `bx=278.0, by=-184.0`, Z=0..78m）:
       - スクランブル交差点から道玄坂へ入る左手の二股分岐ランドマークとして配置
       - 東〜南東（道玄坂下・スクランブル交差点方向）に正対するメタリックシルバー円筒タワー、
         正面弧に配された「109」マゼンタクラウンパネルおよび立体 3D「1 0 9」エンブレム
    """
    mesh = bpy.data.meshes.new("ShibuyaQfront109Mesh")
    bm = bmesh.new()

    # =========================================================================
    # 1. SHIBUYA QFRONT（スクランブル交差点北正面: worldX=[-823,-807], worldZ=[278,298]）
    # =========================================================================
    qf_cx = 303.0  # worldZ = 288.0 (南端 bx=293.0 -> worldZ=278.0, Scramble pad z<=270 から 8m 北)
    qf_cy = -120.0  # worldX = -815.0 (幅 16.0m -> worldX=[-823.0, -807.0])
    qf_w = 20.0
    qf_d = 16.0
    qf_h = 46.0

    # メイン建物躯体（ダークスチール骨格＋全周ガラスカーテンウォール）
    add_box(
        bm,
        center=Vector((qf_cx, qf_cy, qf_h * 0.5)),
        size=Vector((qf_w, qf_d, qf_h)),
        mat_idx=2,  # StreamDarkVoidSteel
    )
    add_box(
        bm,
        center=Vector((qf_cx, qf_cy, qf_h * 0.5 + 2.0)),
        size=Vector((qf_w + 0.16, qf_d + 0.16, qf_h - 5.0)),
        mat_idx=1,  # StreamCurtainGlass
    )

    front_x = qf_cx - qf_w * 0.5  # bx = 293.0（スクランブル交差点正対南面）

    # 1a. 1F SHIBUYA TSUTAYA 路面ガラスストアフロント＆奥まったアーケード（Z = 0.0m .. 4.75m）
    # `step_249_shot_1.png` で暗いグレー箱に見えていた 1F を、実写ストリートビューに準拠した
    # 「高輝度店内照明ディスプレイ＋バックライト白サインヘッダ＋自動ドア入口＋トランサム縦マリオン＋奥まったアーケード柱」で構築
    # 足元御影石風ダーク幅木（Z = 0.0m .. 0.22m）
    add_box(
        bm,
        center=Vector((front_x - 0.24, qf_cy, 0.11)),
        size=Vector((0.52, qf_d - 0.2, 0.22)),
        mat_idx=2,  # StreamDarkVoidSteel
    )
    # 1F 奥まった高輝度店内ショーケース（Z = 0.22m .. 3.88m）:
    # `ShibuyaQfrontMedia` (dayIntensity=0.90) の下部ウォーム店内領域 v=[0.0, 0.155] を 1:1 スケールで展開し、
    # 昼間でも2Fスターバックスと同等の明るい暖色店内空間（書棚・照明天井・ガラス扉）を鮮明に表現する
    add_box(
        bm,
        center=Vector((front_x - 0.12, qf_cy, 2.05)),
        size=Vector((0.16, qf_d - 0.8, 3.66)),
        mat_idx=14,  # ShibuyaQfrontMedia（高輝度ウォーム店舗インテリア）
        uv_rect=(0.0, 0.0, 1.0, 0.155),
    )
    # 1F 店内天井のウォームLED照明コープ（Z = 3.62m .. 3.86m）
    add_box(
        bm,
        center=Vector((front_x - 0.20, qf_cy, 3.74)),
        size=Vector((0.18, qf_d - 1.0, 0.22)),
        mat_idx=6,  # WarmPlazaGlow
    )
    # 1F バックライト店舗ファシアサインヘッダ帯（Z = 3.88m .. 4.52m: "SHIBUYA TSUTAYA" 白発光サインバンド）
    add_box(
        bm,
        center=Vector((front_x - 0.26, qf_cy, 4.20)),
        size=Vector((0.26, qf_d - 0.6, 0.64)),
        mat_idx=2,  # StreamDarkVoidSteel（サインヘッダ外枠）
    )
    for sign_bay_y, sign_bay_w in [(-5.1, 4.0), (0.0, 5.2), (5.1, 4.0)]:
        # バックライトホワイトアクリル看板面
        add_box(
            bm,
            center=Vector((front_x - 0.34, qf_cy + sign_bay_y, 4.20)),
            size=Vector((0.16, sign_bay_w, 0.44)),
            mat_idx=0,  # StreamWhitePanel
        )
        # サイン上下の暖色・シアンバックライトエッジ
        add_box(
            bm,
            center=Vector((front_x - 0.36, qf_cy + sign_bay_y, 4.44)),
            size=Vector((0.14, sign_bay_w - 0.2, 0.07)),
            mat_idx=10,  # ShibuyaSkyEdgeGlow
        )
        add_box(
            bm,
            center=Vector((front_x - 0.36, qf_cy + sign_bay_y, 3.96)),
            size=Vector((0.14, sign_bay_w - 0.2, 0.07)),
            mat_idx=6,  # WarmPlazaGlow
        )
    # 1F アーケード構造ピラー（4本のステンレス被覆コラムが奥行 0.38m の立体アーケードを形成）
    for pil_y in [-7.35, -3.0, 3.0, 7.35]:
        add_box(
            bm,
            center=Vector((front_x - 0.30, qf_cy + pil_y, 2.35)),
            size=Vector((0.38, 0.44, 4.70)),
            mat_idx=3,  # StreamGalvanizedFrame
        )
        add_box(
            bm,
            center=Vector((front_x - 0.34, qf_cy + pil_y, 2.35)),
            size=Vector((0.34, 0.24, 4.66)),
            mat_idx=2,  # StreamDarkVoidSteel
        )
    # 1F 中央＆左右エントランス自動ドアポータル枠（Z = 0.15m .. 3.25m）＋ ドア無目バー ＋ 縦トランサムマリオン
    add_box(
        bm,
        center=Vector((front_x - 0.30, qf_cy, 3.22)),
        size=Vector((0.28, qf_d - 0.8, 0.18)),
        mat_idx=3,  # StreamGalvanizedFrame（1F全幅ドア上無目トランサムバー）
    )
    for door_cy in [-5.1, 0.0, 5.1]:
        door_w = 3.4 if door_cy == 0.0 else 2.6
        # 自動ドア枠（左・右・中央合わせ目・下部キックプレート）
        for df_off in [-door_w * 0.5, door_w * 0.5]:
            add_box(
                bm,
                center=Vector((front_x - 0.28, qf_cy + door_cy + df_off, 1.68)),
                size=Vector((0.22, 0.14, 3.12)),
                mat_idx=3,  # StreamGalvanizedFrame
            )
        for center_seam in [-0.06, 0.06]:
            add_box(
                bm,
                center=Vector((front_x - 0.26, qf_cy + door_cy + center_seam, 1.68)),
                size=Vector((0.16, 0.05, 3.08)),
                mat_idx=3,
            )
        add_box(
            bm,
            center=Vector((front_x - 0.25, qf_cy + door_cy, 0.24)),
            size=Vector((0.18, door_w - 0.16, 0.22)),
            mat_idx=3,  # ステンレスキックプレート
        )
    # 1F 欄間（トランサム Z = 3.25m .. 3.90m）の細密縦マリオン列
    for tr_y in range(-7, 8):
        add_box(
            bm,
            center=Vector((front_x - 0.25, qf_cy + float(tr_y) * 1.02, 3.56)),
            size=Vector((0.18, 0.09, 0.66)),
            mat_idx=2,  # StreamDarkVoidSteel
        )

    # 1F 店舗エントランス庇キャノピー & 軒裏ウォームダウンライト天井（Z = 4.62m .. 4.92m）
    add_box(
        bm,
        center=Vector((front_x - 0.68, qf_cy, 4.76)),
        size=Vector((1.20, qf_d - 0.4, 0.28)),
        mat_idx=2,  # StreamDarkVoidSteel
    )
    add_box(
        bm,
        center=Vector((front_x - 1.26, qf_cy, 4.76)),
        size=Vector((0.12, qf_d - 0.6, 0.22)),
        mat_idx=3,  # StreamGalvanizedFrame（庇先端ステンレスエッジ）
    )
    add_box(
        bm,
        center=Vector((front_x - 0.66, qf_cy, 4.58)),
        size=Vector((0.96, qf_d - 1.0, 0.10)),
        mat_idx=0,  # StreamWhitePanel（明るい軒裏天井パネル）
    )
    add_box(
        bm,
        center=Vector((front_x - 0.92, qf_cy, 4.55)),
        size=Vector((0.32, qf_d - 1.2, 0.08)),
        mat_idx=6,  # WarmPlazaGlow（庇裏ライン照明）
    )

    # 1b. 2F SHIBUYA TSUTAYA / STARBUCKS 展望カフェガラス帯（Z = 4.95m .. 9.75m）
    # `shibuya_qfront.jpg` 下部の実写スターバックス窓領域 v=[0.0, 0.195] を 2F に正確配置
    add_box(
        bm,
        center=Vector((front_x - 0.16, qf_cy, 7.35)),
        size=Vector((0.18, qf_d - 0.8, 4.65)),
        mat_idx=14,  # ShibuyaQfrontMedia（2F スターバックス実写窓）
        uv_rect=(0.0, 0.0, 1.0, 0.195),
    )
    # 2F 窓台のダークグリーンスターバックスキャノピー帯（Z = 5.08m）＆ 上部間接照明（Z = 9.55m）
    add_box(
        bm,
        center=Vector((front_x - 0.24, qf_cy, 5.08)),
        size=Vector((0.16, qf_d - 0.8, 0.32)),
        mat_idx=4,  # StreamVerticalGreen
    )
    add_box(
        bm,
        center=Vector((front_x - 0.22, qf_cy, 9.56)),
        size=Vector((0.14, qf_d - 1.0, 0.28)),
        mat_idx=6,  # WarmPlazaGlow
    )
    # 2F 展望ガラスの縦サッシマリオン（Z = 4.95m .. 9.75m）
    for m2_off in [-6.8, -4.6, -2.3, 0.0, 2.3, 4.6, 6.8]:
        add_box(
            bm,
            center=Vector((front_x - 0.26, qf_cy + m2_off, 7.35)),
            size=Vector((0.18, 0.14, 4.75)),
            mat_idx=2,  # StreamDarkVoidSteel
        )

    # 1c. QFRONT 東側面（井の頭通り/公園通り側）および西側面（センター街側）の1F〜上層ファサード
    for side_sign in [-1.0, 1.0]:
        side_y = qf_cy + side_sign * (qf_d * 0.5 + 0.10)
        # 1F 側面ショーウィンドウ（Z = 0.2m .. 4.5m: 1フロア等倍ガラス店舗）
        add_box(
            bm,
            center=Vector((qf_cx, side_y, 2.35)),
            size=Vector((qf_w - 0.4, 0.14, 4.3)),
            mat_idx=14,  # ShibuyaQfrontMedia（南面と連続する高輝度ウォーム店舗）
            uv_rect=(0.0, 0.0, 1.0, 0.155),
        )
        # 1F 側面バックライトサインヘッダ＆庇（Z = 4.20m .. 4.76m）
        add_box(
            bm,
            center=Vector((qf_cx, side_y + side_sign * 0.08, 4.22)),
            size=Vector((qf_w - 0.6, 0.16, 0.42)),
            mat_idx=0,  # StreamWhitePanel
        )
        add_box(
            bm,
            center=Vector((qf_cx, side_y + side_sign * 0.22, 4.74)),
            size=Vector((qf_w - 0.2, 0.45, 0.24)),
            mat_idx=2,  # StreamDarkVoidSteel
        )
        # 2F 側面スターバックス窓（Z = 5.0m .. 9.6m）
        add_box(
            bm,
            center=Vector((qf_cx, side_y, 7.35)),
            size=Vector((qf_w - 0.4, 0.14, 4.6)),
            mat_idx=14,
            uv_rect=(0.0, 0.0, 1.0, 0.195),
        )
        # 3F〜8F 側面カーテンウォール＋各階アルミスパンドレル帯＋縦マリオン
        add_box(
            bm,
            center=Vector((qf_cx, side_y + side_sign * 0.04, 27.6)),
            size=Vector((qf_w + 0.06, 0.12, 35.0)),
            mat_idx=1,  # StreamCurtainGlass
        )
        for fl in range(10):
            fz = 10.0 + fl * 3.6
            add_box(
                bm,
                center=Vector((qf_cx, side_y + side_sign * 0.12, fz)),
                size=Vector((qf_w + 0.22, 0.16, 0.34)),
                mat_idx=3,  # StreamGalvanizedFrame
            )
        for sx_off in [-8.0, -4.8, -1.6, 1.6, 4.8, 8.0]:
            add_box(
                bm,
                center=Vector((qf_cx + sx_off, side_y + side_sign * 0.14, 23.0)),
                size=Vector((0.24, 0.18, 45.2)),
                mat_idx=2,  # StreamDarkVoidSteel
            )

    # 1d. 3F〜7F スクランブル交差点直視 巨大湾曲LEDビジョン「Q'S EYE」＆「QFRONT / TSUTAYA」サイン (Z = 10.2m .. 38.6m)
    # `uv_rect=(0.0, 0.195, 1.0, 1.0)` により、3F位置に2Fスタバ窓が二重表示されるバグを完全根絶
    add_box(
        bm,
        center=Vector((front_x - 0.18, qf_cy, 24.4)),
        size=Vector((0.68, qf_d - 1.2, 28.4)),
        mat_idx=14,  # ShibuyaQfrontMedia
        uv_rect=(0.0, 0.195, 1.0, 1.0),
    )
    # 8F 上層建築ガラス＆クラウンルーバーファサード (Z = 38.8m .. 45.4m)
    add_box(
        bm,
        center=Vector((front_x - 0.10, qf_cy, 42.1)),
        size=Vector((0.42, qf_d - 1.2, 6.6)),
        mat_idx=1,  # StreamCurtainGlass
    )
    for crown_mull_y in [-5.6, -2.8, 0.0, 2.8, 5.6]:
        add_box(
            bm,
            center=Vector((front_x - 0.24, qf_cy + crown_mull_y, 42.1)),
            size=Vector((0.22, 0.18, 6.6)),
            mat_idx=3,  # StreamGalvanizedFrame
        )
    # スクリーン周囲のダークスチール額縁＆左右角コーナーガラスシリンダーピラー
    for side_y in [-1.0, 1.0]:
        add_cylinder_z(
            bm,
            center=Vector((front_x + 0.55, qf_cy + side_y * (qf_d * 0.5 - 0.35), 23.0)),
            radius=0.88,
            height=46.0,
            segments=20,
            mat_idx=1,  # StreamCurtainGlass
        )
        for fl in range(9):
            fz = 4.8 + fl * 5.0
            add_cylinder_z(
                bm,
                center=Vector((front_x + 0.55, qf_cy + side_y * (qf_d * 0.5 - 0.35), fz)),
                radius=0.96,
                height=0.34,
                segments=20,
                mat_idx=2,  # StreamDarkVoidSteel
            )
    for frame_z in [9.95, 14.8, 38.7, 45.4]:
        add_box(
            bm,
            center=Vector((front_x - 0.26, qf_cy, frame_z)),
            size=Vector((0.82, qf_d - 0.8, 0.55)),
            mat_idx=2,  # StreamDarkVoidSteel
        )
    # 屋上ペントハウス＆シアンアクセントライン
    add_box(
        bm,
        center=Vector((qf_cx + 1.5, qf_cy, qf_h + 2.0)),
        size=Vector((10.0, 10.0, 4.0)),
        mat_idx=2,  # StreamDarkVoidSteel
    )
    add_box(
        bm,
        center=Vector((front_x + 0.2, qf_cy, qf_h - 0.6)),
        size=Vector((1.0, qf_d - 0.4, 0.7)),
        mat_idx=10,  # ShibuyaSkyEdgeGlow
    )

    # =========================================================================
    # 2. SHIBUYA109（道玄坂×文化村通り Y字分岐三角街区: worldX=[-899,-870], worldZ=[254,273]）
    # =========================================================================
    cyl_cx = 278.0  # worldZ = 263.0
    cyl_cy = -184.0  # worldX = -879.0
    cyl_r = 8.8
    cyl_h = 78.0

    # 109 シリンダー正面方向（道玄坂下・スクランブル交差点へ向かう東寄り南東向き）
    logo_dir = Vector((-0.39, 0.92, 0.0)).normalized()
    theta_center = math.atan2(logo_dir.y, logo_dir.x)

    # 2a. Y字分岐三角街区 1F〜2F 統合基壇ポディウム（Z = 0.0m .. 8.2m）
    # シリンダーと背後2棟の間の隙間を埋め、Y字路に自然に馴染むガラスショーウィンドウ付き三角基壇を形成
    add_box(
        bm,
        center=Vector((278.0, -192.2, 4.1)),
        size=Vector((19.6, 12.8, 8.2)),
        mat_idx=2,  # StreamDarkVoidSteel
    )
    add_box(
        bm,
        center=Vector((278.0, -192.2, 2.45)),
        size=Vector((19.8, 13.0, 4.4)),
        mat_idx=15,  # Shibuya109Crown（1F等倍ガラス扉＆大理石ロビー）
        uv_rect=(0.0, 0.0, 1.0, 0.165),
    )
    add_box(
        bm,
        center=Vector((278.0, -192.2, 5.75)),
        size=Vector((19.75, 12.95, 2.5)),
        mat_idx=1,  # StreamCurtainGlass（2Fショーウィンドウ帯）
    )
    add_box(
        bm,
        center=Vector((278.0, -192.2, 4.25)),
        size=Vector((19.95, 13.15, 0.28)),
        mat_idx=3,  # StreamGalvanizedFrame（1F/2Fトランサム帯）
    )
    add_box(
        bm,
        center=Vector((278.0, -192.2, 0.22)),
        size=Vector((20.4, 13.6, 0.44)),
        mat_idx=2,  # StreamDarkVoidSteel（御影石風接地ベース枠）
    )
    add_box(
        bm,
        center=Vector((278.0, -192.2, 7.35)),
        size=Vector((20.2, 13.4, 0.65)),
        mat_idx=3,  # StreamGalvanizedFrame（基壇上部コーニス）
    )

    # 2b. 背後段状商業ビル棟（道玄坂および文化村通りの分岐角に沿ったV字クサビ型ウィング）
    # 中央連結コア (Z = 0..58m)
    add_box(
        bm,
        center=Vector((278.0, -193.0, 29.0)),
        size=Vector((14.0, 10.0, 58.0)),
        mat_idx=2,  # StreamDarkVoidSteel
    )
    add_box(
        bm,
        center=Vector((278.0, -193.0, 33.0)),
        size=Vector((14.24, 10.24, 49.0)),
        mat_idx=0,  # StreamWhitePanel（109特有のメタリック白アルミ外装）
    )
    for band_z in range(10, 58, 4):
        add_box(
            bm,
            center=Vector((278.0, -193.0, float(band_z))),
            size=Vector((14.42, 10.42, 0.42)),
            mat_idx=3,  # StreamGalvanizedFrame
        )
        add_box(
            bm,
            center=Vector((278.0, -193.0, float(band_z) + 1.8)),
            size=Vector((14.34, 10.34, 1.45)),
            mat_idx=1,  # StreamCurtainGlass（横連窓スリット）
        )

    # 道玄坂側ウィング（南西側ウィング、道玄坂本線沿道）: Z = 0..58m
    add_box(
        bm,
        center=Vector((271.0, -199.0, 29.0)),
        size=Vector((16.0, 9.0, 58.0)),
        mat_idx=2,  # StreamDarkVoidSteel
    )
    add_box(
        bm,
        center=Vector((271.0, -199.0, 33.2)),
        size=Vector((16.22, 9.22, 49.0)),
        mat_idx=0,  # StreamWhitePanel（シルバーホワイトアルミパネル外装）
    )
    # 1F〜2F 等倍商業店舗ショーウィンドウ（4段ミニチュア化を防ぐ uv_rect=(0.0, 0.0, 1.0, 0.24)）
    add_box(
        bm,
        center=Vector((271.0, -199.0, 2.5)),
        size=Vector((16.36, 9.36, 4.6)),
        mat_idx=15,  # Shibuya109Crown（下部 v=[0..0.165] の1Fガラス扉＆大理石ロビー）
        uv_rect=(0.0, 0.0, 1.0, 0.165),
    )
    add_box(
        bm,
        center=Vector((271.0, -199.0, 6.2)),
        size=Vector((16.32, 9.32, 2.6)),
        mat_idx=1,  # StreamCurtainGlass（2Fショーウィンドウ帯）
    )
    # 水平スパンドレル＆横連窓リボン（全4面連続）
    for band_z in range(10, 58, 4):
        add_box(
            bm,
            center=Vector((271.0, -199.0, float(band_z))),
            size=Vector((16.44, 9.44, 0.42)),
            mat_idx=3,  # StreamGalvanizedFrame
        )
        add_box(
            bm,
            center=Vector((271.0, -199.0, float(band_z) + 1.8)),
            size=Vector((16.34, 9.34, 1.35)),
            mat_idx=1,  # StreamCurtainGlass
        )
    for mx in [-6.0, -3.0, 0.0, 3.0, 6.0]:
        add_box(
            bm,
            center=Vector((271.0 + mx, -199.0, 29.0)),
            size=Vector((0.28, 9.48, 57.2)),
            mat_idx=3,
        )
    # 道玄坂正対壁面（南面・西面）の実写109ファッションビルボード＆アルミパネル展開
    add_box(
        bm,
        center=Vector((271.0, -203.65, 31.0)),
        size=Vector((15.8, 0.24, 46.0)),
        mat_idx=15,  # Shibuya109Crown
        uv_rect=(0.0, 0.16, 1.0, 0.96),
    )
    add_box(
        bm,
        center=Vector((262.9, -199.0, 31.0)),
        size=Vector((0.24, 8.6, 46.0)),
        mat_idx=15,  # Shibuya109Crown（道玄坂下から見える南面にも109ファッションパネル展開）
        uv_rect=(0.0, 0.16, 1.0, 0.96),
    )

    # 文化村通り側ウィング（北西側ウィング、東急本店通り沿道）: Z = 0..52m
    add_box(
        bm,
        center=Vector((285.0, -199.0, 26.0)),
        size=Vector((15.0, 8.5, 52.0)),
        mat_idx=2,  # StreamDarkVoidSteel
    )
    add_box(
        bm,
        center=Vector((285.0, -199.0, 30.0)),
        size=Vector((15.22, 8.72, 43.0)),
        mat_idx=0,  # StreamWhitePanel（シリンダーと統一されたシルバーホワイトパネル）
    )
    add_box(
        bm,
        center=Vector((285.0, -199.0, 2.5)),
        size=Vector((15.36, 8.86, 4.6)),
        mat_idx=15,  # Shibuya109Crown（1Fガラスエントランス＆明るいロビー）
        uv_rect=(0.0, 0.0, 1.0, 0.165),
    )
    add_box(
        bm,
        center=Vector((285.0, -199.0, 6.2)),
        size=Vector((15.32, 8.82, 2.6)),
        mat_idx=1,
    )
    for band_z in range(10, 52, 4):
        add_box(
            bm,
            center=Vector((285.0, -199.0, float(band_z))),
            size=Vector((15.44, 8.94, 0.42)),
            mat_idx=3,  # StreamGalvanizedFrame
        )
        add_box(
            bm,
            center=Vector((285.0, -199.0, float(band_z) + 1.8)),
            size=Vector((15.34, 8.84, 1.35)),
            mat_idx=1,  # StreamCurtainGlass
        )
    for mx in [-5.4, -2.7, 0.0, 2.7, 5.4]:
        add_box(
            bm,
            center=Vector((285.0 + mx, -199.0, 26.0)),
            size=Vector((0.26, 8.98, 51.2)),
            mat_idx=3,
        )

    # 2c. 竹山実設計 SHIBUYA109 象徴の円筒シリンダータワー（Z = 0.0m .. 78.0m, 48分割で滑らかな円筒）
    add_cylinder_z(
        bm,
        center=Vector((cyl_cx, cyl_cy, cyl_h * 0.5)),
        radius=cyl_r,
        height=cyl_h,
        segments=48,
        mat_idx=0,  # StreamWhitePanel
    )
    # 水平リング目地フレーム（Z=18.0mのリングは正面 `1 0 9` エンブレム Z=19.5m 領域を避けて上下 Z=15.6m / 23.4m に整列）
    for ring_z in [11.6, 15.6, 23.4, 29.0, 35.0, 41.0, 47.0, 53.0, 59.0]:
        add_cylinder_z(
            bm,
            center=Vector((cyl_cx, cyl_cy, ring_z)),
            radius=cyl_r + 0.14,
            height=0.34,
            segments=48,
            mat_idx=3,  # StreamGalvanizedFrame
        )

    # 20本の垂直アルミリブ（縦マリオンフィン）: キャノピー上端(Z=7.6m)からクラウン下端(Z=60.8m)まで途切れなく連続
    num_cyl_fins = 20
    for fin_i in range(num_cyl_fins):
        fin_ang = theta_center + (fin_i / num_cyl_fins) * 2.0 * math.pi
        diff_ang = abs((fin_ang - theta_center + math.pi) % (2.0 * math.pi) - math.pi)
        # エレベーター縦スリット＆正面109エンブレム領域（|diff_ang| < 0.42）にはフィンを重ねない
        if diff_ang < 0.42:
            continue
        fx = cyl_cx + math.cos(fin_ang) * (cyl_r + 0.16)
        fy = cyl_cy + math.sin(fin_ang) * (cyl_r + 0.16)
        t_fin = Vector((-math.sin(fin_ang), math.cos(fin_ang), 0.0))
        n_fin = Vector((math.cos(fin_ang), math.sin(fin_ang), 0.0))
        add_oriented_box(
            bm,
            center=Vector((fx, fy, 34.2)),
            tangent_dir=t_fin,
            normal_dir=n_fin,
            size_tangent=0.22,
            size_normal=0.28,
            size_z=53.2,
            mat_idx=0 if (fin_i % 2 == 0) else 3,
        )

    # 2d. シースルー展望エレベーター縦スリットガラス（"1 0 9" エンブレム Z=19.5m の背後を完全回避して上下2区間に分割）
    # 下部区間 Z=9.2m..15.4m / 上部区間 Z=23.6m..60.4m（エンブレム背後 Z=15.4m..23.6m はソリッド白メタリックパネル）
    add_cylindrical_panel_z(
        bm,
        center=Vector((cyl_cx, cyl_cy, 19.5)),
        r_inner=cyl_r - 0.05,
        r_outer=cyl_r + 0.24,
        height=8.2,
        start_rad=theta_center - 0.44,
        end_rad=theta_center + 0.44,
        segments=16,
        mat_idx=0,  # StreamWhitePanel（Z=19.5m エンブレム背後のクリーンなソリッド白アルミパネル）
        inner_mat_idx=0,
    )
    slit_segments = [
        (9.2, 15.4),
        (23.6, 60.4),
    ]
    for slit_z0, slit_z1 in slit_segments:
        slit_zc = 0.5 * (slit_z0 + slit_z1)
        slit_h = slit_z1 - slit_z0
        # スリット奥のダークシャフト背景
        add_cylindrical_panel_z(
            bm,
            center=Vector((cyl_cx, cyl_cy, slit_zc)),
            r_inner=cyl_r - 0.15,
            r_outer=cyl_r + 0.08,
            height=slit_h,
            start_rad=theta_center - 0.16,
            end_rad=theta_center + 0.16,
            segments=10,
            mat_idx=2,  # StreamDarkVoidSteel
        )
        # スリット前面のカーテンウォールガラス
        add_cylindrical_panel_z(
            bm,
            center=Vector((cyl_cx, cyl_cy, slit_zc)),
            r_inner=cyl_r + 0.06,
            r_outer=cyl_r + 0.19,
            height=slit_h,
            start_rad=theta_center - 0.15,
            end_rad=theta_center + 0.15,
            segments=10,
            mat_idx=1,  # StreamCurtainGlass
        )
        # エレベーターシャフト内の水平サッシバー
        num_slit_bars = max(2, int(slit_h / 4.5))
        for sb_i in range(1, num_slit_bars):
            sb_z = slit_z0 + sb_i * (slit_h / num_slit_bars)
            add_cylindrical_panel_z(
                bm,
                center=Vector((cyl_cx, cyl_cy, sb_z)),
                r_inner=cyl_r + 0.12,
                r_outer=cyl_r + 0.22,
                height=0.22,
                start_rad=theta_center - 0.15,
                end_rad=theta_center + 0.15,
                segments=8,
                mat_idx=3,
            )
        # スリット左右のシルバーマリオン枠
        for slit_side in [-1.0, 1.0]:
            s_ang = theta_center + slit_side * 0.165
            sx = cyl_cx + math.cos(s_ang) * (cyl_r + 0.21)
            sy = cyl_cy + math.sin(s_ang) * (cyl_r + 0.21)
            st = Vector((-math.sin(s_ang), math.cos(s_ang), 0.0))
            sn = Vector((math.cos(s_ang), math.sin(s_ang), 0.0))
            add_oriented_box(
                bm,
                center=Vector((sx, sy, slit_zc)),
                tangent_dir=st,
                normal_dir=sn,
                size_tangent=0.20,
                size_normal=0.28,
                size_z=slit_h + 0.2,
                mat_idx=3,  # StreamGalvanizedFrame
            )

    # 2e. 1F エントランス足元: 4段半円形御影石ステップテラス（段鼻LED照明付き）＆ 曲面ガラスエントランス＋メタリック大庇
    step_specs_109 = [
        (0.06, 12.1, 0.24, 1.48, 2),
        (0.24, 11.35, 0.20, 1.40, 3),
        (0.42, 10.60, 0.20, 1.32, 2),
        (0.60, 9.85, 0.22, 1.25, 3),
    ]
    for st_z, st_rout, st_h, st_ang, st_mat in step_specs_109:
        add_cylindrical_panel_z(
            bm,
            center=Vector((cyl_cx, cyl_cy, st_z)),
            r_inner=cyl_r - 0.20,
            r_outer=st_rout,
            height=st_h,
            start_rad=theta_center - st_ang,
            end_rad=theta_center + st_ang,
            segments=36,
            mat_idx=st_mat,
        )
        # ステップ段鼻のウォーム間接ライン照明
        add_cylindrical_panel_z(
            bm,
            center=Vector((cyl_cx, cyl_cy, st_z + st_h * 0.32)),
            r_inner=st_rout - 0.08,
            r_outer=st_rout + 0.02,
            height=0.05,
            start_rad=theta_center - st_ang + 0.04,
            end_rad=theta_center + st_ang - 0.04,
            segments=36,
            mat_idx=6,  # WarmPlazaGlow
        )

    # 1F〜2F 曲面ガラスエントランスホール (Z = 0.72m .. 6.85m)
    # 4段ミニチュア化していた旧テクスチャを廃止し、`shibuya_109.jpg` 下部1Fエントランス (v=[0.0, 0.165]) を等倍配置
    add_cylindrical_panel_z(
        bm,
        center=Vector((cyl_cx, cyl_cy, 3.78)),
        r_inner=cyl_r - 0.10,
        r_outer=cyl_r + 0.18,
        height=6.10,
        start_rad=theta_center - 1.18,
        end_rad=theta_center + 1.18,
        segments=28,
        mat_idx=6,  # WarmPlazaGlow（奥の店内暖色照明）
    )
    # 1F 路面ガラス扉＆大理石ロビー（Z = 0.72m .. 4.18m: 等倍1フロア）
    add_cylindrical_panel_z(
        bm,
        center=Vector((cyl_cx, cyl_cy, 2.45)),
        r_inner=cyl_r + 0.12,
        r_outer=cyl_r + 0.34,
        height=3.46,
        start_rad=theta_center - 1.14,
        end_rad=theta_center + 1.14,
        segments=28,
        mat_idx=15,  # Shibuya109Crown（下部 v=[0..0.165] の1Fガラス扉＆ウォームロビー）
        uv_rect=(0.0, 0.0, 1.0, 0.165),
    )
    # 2F 曲面ショーウィンドウガラス帯（Z = 4.30m .. 6.82m）
    add_cylindrical_panel_z(
        bm,
        center=Vector((cyl_cx, cyl_cy, 5.56)),
        r_inner=cyl_r + 0.14,
        r_outer=cyl_r + 0.34,
        height=2.52,
        start_rad=theta_center - 1.14,
        end_rad=theta_center + 1.14,
        segments=28,
        mat_idx=1,  # StreamCurtainGlass
    )
    # 1F/2F 境界のステンレス無目トランサムビーム（Z = 4.22m）＆ 中央自動ドアポータル枠
    add_cylindrical_panel_z(
        bm,
        center=Vector((cyl_cx, cyl_cy, 4.22)),
        r_inner=cyl_r + 0.24,
        r_outer=cyl_r + 0.44,
        height=0.26,
        start_rad=theta_center - 1.15,
        end_rad=theta_center + 1.15,
        segments=28,
        mat_idx=3,  # StreamGalvanizedFrame
    )
    add_cylindrical_panel_z(
        bm,
        center=Vector((cyl_cx, cyl_cy, 3.62)),
        r_inner=cyl_r + 0.28,
        r_outer=cyl_r + 0.52,
        height=0.30,
        start_rad=theta_center - 0.34,
        end_rad=theta_center + 0.34,
        segments=14,
        mat_idx=0,  # StreamWhitePanel（中央エントランス照明ヘッダ）
    )
    # 1F〜2F 垂直放射マリオン（11本）
    for mul_i in range(-5, 6):
        m_ang = theta_center + mul_i * 0.21
        mx = cyl_cx + math.cos(m_ang) * (cyl_r + 0.36)
        my = cyl_cy + math.sin(m_ang) * (cyl_r + 0.36)
        mt = Vector((-math.sin(m_ang), math.cos(m_ang), 0.0))
        mn = Vector((math.cos(m_ang), math.sin(m_ang), 0.0))
        is_portal_col = mul_i in (-1, 1)
        add_oriented_box(
            bm,
            center=Vector((mx, my, 3.76)),
            tangent_dir=mt,
            normal_dir=mn,
            size_tangent=0.22 if is_portal_col else 0.14,
            size_normal=0.26 if is_portal_col else 0.18,
            size_z=6.05,
            mat_idx=3 if is_portal_col else 2,
        )

    # 扇形メタリック大庇キャノピー (Z = 6.82m .. 7.72m, 36分割で滑らかなアーク)
    add_cylindrical_panel_z(
        bm,
        center=Vector((cyl_cx, cyl_cy, 7.26)),
        r_inner=cyl_r + 0.10,
        r_outer=11.65,
        height=0.72,
        start_rad=theta_center - 1.32,
        end_rad=theta_center + 1.32,
        segments=36,
        mat_idx=3,  # StreamGalvanizedFrame（重厚なヘアラインシルバー大庇）
    )
    # キャノピー上下のシャープなダークトリム＆スリムなマゼンタネオンアクセントライン
    for trim_z in [6.88, 7.64]:
        add_cylindrical_panel_z(
            bm,
            center=Vector((cyl_cx, cyl_cy, trim_z)),
            r_inner=cyl_r + 0.15,
            r_outer=11.72,
            height=0.10,
            start_rad=theta_center - 1.32,
            end_rad=theta_center + 1.32,
            segments=36,
            mat_idx=2,  # StreamDarkVoidSteel
        )
    add_cylindrical_panel_z(
        bm,
        center=Vector((cyl_cx, cyl_cy, 7.36)),
        r_inner=11.45,
        r_outer=11.76,
        height=0.24,
        start_rad=theta_center - 1.28,
        end_rad=theta_center + 1.28,
        segments=36,
        mat_idx=13,  # ShibuyaQfront109Accent（シャープなマゼンタネオンエッジ）
    )
    # キャノピー下面天井のウォーム間接照明ストリップ (WarmPlazaGlow)
    add_cylindrical_panel_z(
        bm,
        center=Vector((cyl_cx, cyl_cy, 6.84)),
        r_inner=cyl_r + 0.35,
        r_outer=11.25,
        height=0.12,
        start_rad=theta_center - 1.26,
        end_rad=theta_center + 1.26,
        segments=36,
        mat_idx=6,  # WarmPlazaGlow
    )

    # 2f. 円筒側面に沿って垂下する垂直リニアネオンライン（左右2本: キャノピー Z=7.7m からクラウン Z=60.8m まで完全連続）
    for neon_sign in [-1.0, 1.0]:
        neon_ang = theta_center + neon_sign * 0.56
        nx = cyl_cx + math.cos(neon_ang) * (cyl_r + 0.22)
        ny = cyl_cy + math.sin(neon_ang) * (cyl_r + 0.22)
        nt = Vector((-math.sin(neon_ang), math.cos(neon_ang), 0.0))
        nn = Vector((math.cos(neon_ang), math.sin(neon_ang), 0.0))
        add_oriented_box(
            bm,
            center=Vector((nx, ny, 34.25)),
            tangent_dir=nt,
            normal_dir=nn,
            size_tangent=0.20,
            size_normal=0.24,
            size_z=53.1,
            mat_idx=13,  # ShibuyaQfront109Accent
        )
        add_oriented_box(
            bm,
            center=Vector((nx, ny, 7.92)),
            tangent_dir=nt,
            normal_dir=nn,
            size_tangent=0.52,
            size_normal=0.52,
            size_z=0.44,
            mat_idx=2,
        )

    # 2g. シリンダー頂部クラウン（Z = 60.4m .. 75.4m）および立体 3D「1 0 9」ロゴ（Z=68.0m & Z=19.5m）
    add_cylindrical_panel_z(
        bm,
        center=Vector((cyl_cx, cyl_cy, 67.8)),
        r_inner=cyl_r + 0.14,
        r_outer=cyl_r + 0.36,
        height=14.8,
        start_rad=theta_center - 1.05,
        end_rad=theta_center + 1.05,
        segments=28,
        mat_idx=0,  # StreamWhitePanel
        inner_mat_idx=0,
    )
    for pink_z in [61.0, 74.4]:
        add_cylinder_z(
            bm,
            center=Vector((cyl_cx, cyl_cy, pink_z)),
            radius=cyl_r + 0.48,
            height=1.15,
            segments=48,
            mat_idx=13,  # ShibuyaQfront109Accent
        )
        for collar_off in [-0.68, 0.68]:
            add_cylinder_z(
                bm,
                center=Vector((cyl_cx, cyl_cy, pink_z + collar_off)),
                radius=cyl_r + 0.42,
                height=0.22,
                segments=48,
                mat_idx=3,  # StreamGalvanizedFrame
            )

    # 立体「1 0 9」エンブレム＆ベゼルフレーム（頂部クラウン Z=68.0m ＋ 街路/ドライバー視線 Z=19.5m の二段構成）
    # 背景はどちらもソリッドな白アルミプレート（スリットや横リングの干渉ゼロ）で、「1」「0」「9」を実在の丸みあるフォント形状で造形
    cyl_center = Vector((cyl_cx, cyl_cy, 0.0))
    n_c = Vector((math.cos(theta_center), math.sin(theta_center), 0.0))
    t_c = Vector((-math.sin(theta_center), math.cos(theta_center), 0.0))
    letter_depth = 0.34

    for logo_z, logo_s in [(68.0, 1.0), (19.5, 0.92)]:
        pos_crown = cyl_center + n_c * (cyl_r + 0.40) + Vector((0.0, 0.0, logo_z))
        # マゼンタネオン外枠ベゼル
        add_oriented_box(
            bm,
            center=pos_crown,
            tangent_dir=t_c,
            normal_dir=n_c,
            size_tangent=7.8 * logo_s,
            size_normal=0.22,
            size_z=5.6 * logo_s,
            mat_idx=13,  # ShibuyaQfront109Accent
        )
        # シルバーメタリックインナーベゼル
        add_oriented_box(
            bm,
            center=pos_crown + n_c * 0.09,
            tangent_dir=t_c,
            normal_dir=n_c,
            size_tangent=7.25 * logo_s,
            size_normal=0.24,
            size_z=5.08 * logo_s,
            mat_idx=3,  # StreamGalvanizedFrame
        )
        # 純白ソリッドバッキングプレート（文字背後にスリットや影が一切入らない平面白盤）
        add_oriented_box(
            bm,
            center=pos_crown + n_c * 0.17,
            tangent_dir=t_c,
            normal_dir=n_c,
            size_tangent=6.75 * logo_s,
            size_normal=0.22,
            size_z=4.62 * logo_s,
            mat_idx=0,  # StreamWhitePanel
        )

        # 全3文字を白プレート前面（n_c * 0.42）と同一平面上に整列（文字同士が接触しない明瞭な字間を確保）
        logo_front = pos_crown + n_c * 0.42

        # "1"（左側: t = -2.25 * logo_s）
        pos_1 = logo_front - t_c * (2.25 * logo_s)
        add_oriented_box(
            bm,
            center=pos_1,
            tangent_dir=t_c,
            normal_dir=n_c,
            size_tangent=0.66 * logo_s,
            size_normal=letter_depth,
            size_z=3.32 * logo_s,
            mat_idx=13,
        )
        add_oriented_box(
            bm,
            center=pos_1 - t_c * (0.34 * logo_s) + Vector((0.0, 0.0, 1.28 * logo_s)),
            tangent_dir=t_c,
            normal_dir=n_c,
            size_tangent=0.58 * logo_s,
            size_normal=letter_depth,
            size_z=0.76 * logo_s,
            mat_idx=13,
        )

        # "0"（中央: t = -0.15 * logo_s, outer_r = 1.18 * logo_s で左右の文字と明確なクリアランスを確保）
        pos_0 = logo_front - t_c * (0.15 * logo_s)
        add_extruded_arc_ring(
            bm,
            center=pos_0,
            tangent_dir=t_c,
            normal_dir=n_c,
            outer_r=1.18 * logo_s,
            inner_r=0.58 * logo_s,
            depth=letter_depth,
            start_deg=0.0,
            end_deg=360.0,
            segments=28,
            mat_idx=13,
        )

        # "9"（右側: t = +2.02 * logo_s, 上部円環ボウル ＋ 右側縦ステム ＋ 下部円弧テイル）
        pos_9 = logo_front + t_c * (2.02 * logo_s)
        add_extruded_arc_ring(
            bm,
            center=pos_9 + Vector((0.0, 0.0, 0.62 * logo_s)),
            tangent_dir=t_c,
            normal_dir=n_c,
            outer_r=0.94 * logo_s,
            inner_r=0.40 * logo_s,
            depth=letter_depth,
            start_deg=0.0,
            end_deg=360.0,
            segments=24,
            mat_idx=13,
        )
        add_oriented_box(
            bm,
            center=pos_9 + t_c * (0.67 * logo_s) - Vector((0.0, 0.0, 0.06 * logo_s)),
            tangent_dir=t_c,
            normal_dir=n_c,
            size_tangent=0.54 * logo_s,
            size_normal=letter_depth,
            size_z=1.52 * logo_s,
            mat_idx=13,
        )
        add_extruded_arc_ring(
            bm,
            center=pos_9 - Vector((0.0, 0.0, 0.62 * logo_s)),
            tangent_dir=t_c,
            normal_dir=n_c,
            outer_r=0.94 * logo_s,
            inner_r=0.40 * logo_s,
            depth=letter_depth,
            start_deg=200.0,
            end_deg=360.0,
            segments=16,
            mat_idx=13,
        )

    # シリンダー最上部のダークスチール冠部＆航空障害灯（Z = 75.5m .. 78.8m）
    add_cylinder_z(
        bm,
        center=Vector((cyl_cx, cyl_cy, 77.2)),
        radius=cyl_r * 0.88,
        height=3.2,
        segments=36,
        mat_idx=2,
    )
    for ang_deg in [0.0, 90.0, 180.0, 270.0]:
        rad = math.radians(ang_deg)
        add_cylinder_z(
            bm,
            center=Vector(
                (
                    cyl_cx + math.cos(rad) * (cyl_r * 0.78),
                    cyl_cy + math.sin(rad) * (cyl_r * 0.78),
                    79.3,
                )
            ),
            radius=0.40,
            height=0.9,
            segments=12,
            mat_idx=7,
        )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("ShibuyaQfront109_Complex", mesh)
    assign_materials_to_object(obj, materials)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_shibuya_magnet_and_station_front(
    materials: dict[str, bpy.types.Material],
) -> bpy.types.Object:
    """
    MAGNET by SHIBUYA109 & 渋谷駅前ビル（スクランブル交差点北東〜ハチ公前広場正対ランドマーク）
    Three.js ワールド座標 (x=-782.0, z=275.0) -> Blender 座標 (bx=290.0, by=-87.0)
    1. 10階建て商業タワー（高さ 42.0m）:
       - 渋谷駅前東西連絡路・スクランブル交差点北側歩道に正対する南面・西面ファサード
       - 壁面を覆う巨大LEDスクリーン「渋谷駅前ビジョン」（実写 MAGNET テクスチャ）
       - 1F〜3F ガラス張り路面店舗・エントランス（ウォーム照明）
       - 8F〜屋上展望台「MAG's PARK」（スクランブル交差点見下ろし展望デッキ）
    """
    mesh = bpy.data.meshes.new("ShibuyaMagnetMesh")
    bm = bmesh.new()

    cx = 304.0  # worldZ = 289.0（[277..301]: スクランブル交差点北歩道へ正対）
    cy = -84.8  # worldX = -779.8（[-784.0..-775.6]: 公園通りと北側JR高架橋[-774.45..-763.95]の間の正規街区に完全退避）
    w_x = 24.0  # worldZ 方向奥行き
    d_y = 8.4  # worldX 方向間口幅
    h_z = 42.0

    # 1. メインビルボリューム（ダークサッシコア）
    add_box(
        bm,
        center=Vector((cx, cy, h_z * 0.5)),
        size=Vector((w_x, d_y, h_z)),
        mat_idx=2,  # StreamDarkVoidSteel
    )
    # ガラスカーテンウォールレイヤー（全4面に突き出し北・東面からも無地白壁を見せない）
    add_box(
        bm,
        center=Vector((cx, cy, h_z * 0.5 + 2.5)),
        size=Vector((w_x + 0.22, d_y + 0.22, h_z - 5.5)),
        mat_idx=1,  # StreamCurtainGlass
    )
    # 1F〜2F 全周路面店舗暖色照明＆商業ショーウィンドウ（等倍1フロア、JR高架クリアランス厳守）
    add_box(
        bm,
        center=Vector((cx, cy, 4.4)),
        size=Vector((w_x + 0.16, d_y + 0.16, 8.2)),
        mat_idx=6,  # WarmPlazaGlow
    )
    add_box(
        bm,
        center=Vector((cx, cy, 2.5)),
        size=Vector((w_x + 0.22, d_y + 0.20, 4.6)),
        mat_idx=19,  # ShibuyaCommercialFacade（1フロア等倍路面ショーウィンドウ）
        uv_rect=(0.0, 0.0, 1.0, 0.24),
    )
    # 各階水平アルミスパンドレル＆縦マリオン（公園通り北行・JR東側のどの視点でも高密度ファサード化）
    for fl in range(9):
        fz = 9.0 + fl * 4.0
        add_box(
            bm,
            center=Vector((cx, cy, fz)),
            size=Vector((w_x + 0.32, d_y + 0.24, 0.34)),
            mat_idx=3,  # StreamGalvanizedFrame
        )
    # 1F〜屋上直前まで実写ファサードを一体展開（南・西・北3面へ拡張）
    # 南面（駅前連絡路向き）
    add_box(
        bm,
        center=Vector((cx - w_x * 0.5 - 0.35, cy, 18.0)),
        size=Vector((0.6, d_y - 1.2, 35.0)),
        mat_idx=23,  # ShibuyaMagnetFacade
    )
    # 北面（公園通り奥・神南方面から見ても実写ファサード展開）
    add_box(
        bm,
        center=Vector((cx + w_x * 0.5 + 0.30, cy, 19.0)),
        size=Vector((0.45, d_y - 1.2, 34.0)),
        mat_idx=23,  # ShibuyaMagnetFacade
    )
    # 西面（スクランブル交差点・公園通り向き）
    add_box(
        bm,
        center=Vector((cx, cy - d_y * 0.5 - 0.35, 18.0)),
        size=Vector((w_x - 1.8, 0.6, 35.0)),
        mat_idx=23,  # ShibuyaMagnetFacade
    )
    # 東面（JR山手線高架側: worldX <= -775.6 を厳守し、カーテンウォール＋縦マリオンで構成）
    for mag_mx in [-8.0, -4.0, 0.0, 4.0, 8.0]:
        add_box(
            bm,
            center=Vector((cx + mag_mx, cy + d_y * 0.5 + 0.08, 23.0)),
            size=Vector((0.26, 0.14, 37.0)),
            mat_idx=2,  # StreamDarkVoidSteel
        )
    # ファサード周囲のダークスチールトリムフレーム
    add_box(
        bm,
        center=Vector((cx - w_x * 0.5 - 0.2, cy, 18.2)),
        size=Vector((0.5, d_y - 1.2, 36.0)),
        mat_idx=2,  # StreamDarkVoidSteel
    )
    add_box(
        bm,
        center=Vector((cx, cy - d_y * 0.5 - 0.2, 18.2)),
        size=Vector((w_x - 2.4, 0.5, 36.0)),
        mat_idx=2,  # StreamDarkVoidSteel
    )
    # 屋上 MAG's PARK 展望デッキ（Z = 42.0m）
    add_box(
        bm,
        center=Vector((cx, cy, 42.6)),
        size=Vector((w_x - 1.5, d_y - 0.8, 1.2)),
        mat_idx=3,  # StreamGalvanizedFrame
    )
    # 展望ガラスフェンス（南西見下ろし角）
    add_box(
        bm,
        center=Vector((cx - w_x * 0.5 + 1.0, cy, 43.5)),
        size=Vector((0.3, d_y - 1.2, 1.6)),
        mat_idx=1,  # StreamCurtainGlass
    )
    add_box(
        bm,
        center=Vector((cx, cy - d_y * 0.5 + 1.0, 43.5)),
        size=Vector((w_x - 2.0, 0.3, 1.6)),
        mat_idx=1,  # StreamCurtainGlass
    )
    # 屋上パーゴラ＆ラウンジ構造物
    add_box(
        bm,
        center=Vector((cx + 4.0, cy + 0.5, 45.0)),
        size=Vector((10.0, 5.6, 4.0)),
        mat_idx=2,  # StreamDarkVoidSteel
    )
    # 航空障害灯（屋上パーゴラ天端 z=47.0 にフランジ座付きで接地）
    add_cylinder_z(
        bm,
        center=Vector((cx + 7.2, cy - 1.5, 47.08)),
        radius=0.55,
        height=0.16,
        segments=12,
        mat_idx=2,  # StreamDarkVoidSteel
    )
    add_cylinder_z(
        bm,
        center=Vector((cx + 7.2, cy - 1.5, 47.56)),
        radius=0.35,
        height=0.80,
        segments=12,
        mat_idx=7,  # BeaconRed
    )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("ShibuyaMagnet_Tower", mesh)
    assign_materials_to_object(obj, materials)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_shibuya_mark_city_complex(
    materials: dict[str, bpy.types.Material],
) -> bpy.types.Object:
    """
    渋谷マークシティ（道玄坂北側・京王井の頭線渋谷駅直結 巨大複合ランドマーク）
    Three.js ワールド座標 (x=-910.0 .. -845.0, z=145.0 .. 220.0) -> Blender 座標 (bx=160.0 .. 235.0, by=-215.0 .. -150.0)
    1. イースト棟（オフィス棟、地上25階・実寸高 95.6m）:
       - 水平メタリックシルバーアルミルーバー＆スリット連窓（実写 Mark City テクスチャ）
    2. ウエスト棟（渋谷エクセルホテル東急、地上23階・実寸高 85.0m）:
       - 段状ホテル客室ボリューム
    3. 連絡空中回廊＆井の頭線駅コンコース:
       - 玉川通り・道玄坂頭上を跨ぎ渋谷駅・スクランブル交差点へ接続する空中ガラス回廊（桁下クリアランス 7.5m）
    """
    mesh = bpy.data.meshes.new("ShibuyaMarkCityMesh")
    bm = bmesh.new()

    # 1. イースト棟（オフィス棟: bx = 166.0 -> worldZ = 151.0, by = -168.0 -> worldX = -863.0, 高 95.6m）
    # Why bx = 166 / 178 へ南寄せするか:
    # 道玄坂（worldZ ≈ 210..238）と玉川通り（worldZ ≈ 98..113）の間の実在マークシティ敷地（worldZ ∈ [132..183]）へ収め、
    # 道玄坂本線の路上・交差点へ躯体がはみ出して道路を分断・宙浮きに見せる干渉を完全に解消するため。
    e_cx = 166.0
    e_cy = -168.0
    e_w = 34.0
    e_d = 30.0
    e_h = 95.6

    # 上層オフィスタワー本体（Z = 0.0m .. 95.6m: ガラスカーテンウォール＋水平アルミスパンドレル）
    add_box(
        bm,
        center=Vector((e_cx, e_cy, e_h * 0.5)),
        size=Vector((e_w, e_d, e_h)),
        mat_idx=1,  # StreamCurtainGlass
    )
    for band_z in range(26, int(e_h), 6):
        add_box(
            bm,
            center=Vector((e_cx, e_cy, float(band_z))),
            size=Vector((e_w + 0.35, e_d + 0.35, 1.8)),
            mat_idx=0,  # StreamWhitePanel
        )
    # イースト棟上層 垂直アルミマリオン（のっぺり帯にならない高密度カーテンウォール）
    for mx in [-13.6, -6.8, 0.0, 6.8, 13.6]:
        add_box(
            bm,
            center=Vector((e_cx + mx, e_cy, e_h * 0.5 + 11.0)),
            size=Vector((0.35, e_d + 0.44, e_h - 24.0)),
            mat_idx=3,  # StreamGalvanizedFrame
        )
    for my in [-11.6, -3.8, 3.8, 11.6]:
        add_box(
            bm,
            center=Vector((e_cx, e_cy + my, e_h * 0.5 + 11.0)),
            size=Vector((e_w + 0.44, 0.35, e_h - 24.0)),
            mat_idx=3,  # StreamGalvanizedFrame
        )
    # 1F〜5F 駅・商業ポディウム（Z = 0.0m .. 24.0m 接地：実写ファサードを路面から立ち上げ）
    add_box(
        bm,
        center=Vector((e_cx, e_cy, 12.0)),
        size=Vector((e_w + 1.6, e_d + 2.0, 24.0)),
        mat_idx=24,  # ShibuyaMarkCityFacade
    )
    # イースト棟屋上パラペット＆設備塔
    add_box(
        bm,
        center=Vector((e_cx, e_cy, e_h + 3.0)),
        size=Vector((e_w * 0.6, e_d * 0.6, 6.0)),
        mat_idx=2,  # StreamDarkVoidSteel
    )
    add_cylinder_z(
        bm,
        center=Vector((e_cx, e_cy, e_h + 6.5)),
        radius=0.45,
        height=1.2,
        segments=12,
        mat_idx=7,  # BeaconRed
    )

    # 2. ウエスト棟（渋谷エクセルホテル東急: bx = 178.0 -> worldZ = 163.0, by = -198.0 -> worldX = -893.0, 高 85.0m）
    w_cx = 178.0
    w_cy = -198.0
    w_w = 38.0
    w_d = 32.0
    w_h = 85.0

    # 上層ホテルタワー本体（Z = 0.0m .. 85.0m: ガラスカーテンウォール＋水平白アルミバンド）
    add_box(
        bm,
        center=Vector((w_cx, w_cy, w_h * 0.5)),
        size=Vector((w_w, w_d, w_h)),
        mat_idx=1,  # StreamCurtainGlass
    )
    for band_z in range(28, int(w_h), 6):
        add_box(
            bm,
            center=Vector((w_cx, w_cy, float(band_z))),
            size=Vector((w_w + 0.35, w_d + 0.35, 1.9)),
            mat_idx=0,  # StreamWhitePanel
        )
    # ウエスト棟上層 垂直マリオン
    for mx in [-14.0, -7.0, 0.0, 7.0, 14.0]:
        add_box(
            bm,
            center=Vector((w_cx + mx, w_cy, w_h * 0.5 + 12.0)),
            size=Vector((0.35, w_d + 0.44, w_h - 26.0)),
            mat_idx=3,
        )
    for my in [-11.5, -3.8, 3.8, 11.5]:
        add_box(
            bm,
            center=Vector((w_cx, w_cy + my, w_h * 0.5 + 12.0)),
            size=Vector((w_w + 0.44, 0.35, w_h - 26.0)),
            mat_idx=3,
        )
    # 低層商業基壇（Z = 0.0m .. 26.0m 接地：SHIBUYA MARK CITY 実写テクスチャを地面から配置）
    add_box(
        bm,
        center=Vector((w_cx, w_cy, 13.0)),
        size=Vector((w_w + 1.6, w_d + 2.0, 26.0)),
        mat_idx=24,  # ShibuyaMarkCityFacade
    )
    # ウエスト棟屋上
    add_box(
        bm,
        center=Vector((w_cx, w_cy, w_h + 2.5)),
        size=Vector((w_w * 0.5, w_d * 0.5, 5.0)),
        mat_idx=2,  # StreamDarkVoidSteel
    )
    add_cylinder_z(
        bm,
        center=Vector((w_cx, w_cy, w_h + 5.5)),
        radius=0.45,
        height=1.2,
        segments=12,
        mat_idx=7,  # BeaconRed
    )

    # 3. 連絡駅コンコース棟（イースト棟・ウエスト棟間を東西方向に貫通接続：Z = 0.0m .. 24.0m 接地）
    bridge_span_x = 24.0
    bridge_span_y = 32.0
    bridge_cx = (e_cx + w_cx) * 0.5
    bridge_cy = (e_cy + w_cy) * 0.5
    add_box(
        bm,
        center=Vector((bridge_cx, bridge_cy, 12.0)),
        size=Vector((bridge_span_x, bridge_span_y, 24.0)),
        mat_idx=24,  # ShibuyaMarkCityFacade
    )
    for b_louv_z in [10.0, 14.0, 18.0, 22.0]:
        add_box(
            bm,
            center=Vector((bridge_cx, bridge_cy, b_louv_z)),
            size=Vector((bridge_span_x + 0.36, bridge_span_y + 0.36, 0.42)),
            mat_idx=3,  # StreamGalvanizedFrame
        )
    add_box(
        bm,
        center=Vector((bridge_cx, bridge_cy, 24.2)),
        size=Vector((bridge_span_x + 0.5, bridge_span_y + 0.5, 0.8)),
        mat_idx=2,  # StreamDarkVoidSteel
    )
    for pier_y in [e_cy - 6.0, bridge_cy, w_cy + 6.0]:
        add_box(
            bm,
            center=Vector((bridge_cx + bridge_span_x * 0.5 + 0.2, pier_y, 12.0)),
            size=Vector((0.6, 1.2, 24.0)),
            mat_idx=3,  # StreamGalvanizedFrame
        )

    # 4. 道玄坂側プラザ商業ショーウィンドウ（イースト棟北面に密着接地：worldZ ≈ 169m, 2フロア等倍）
    add_box(
        bm,
        center=Vector((e_cx + e_w * 0.5 + 0.9, e_cy, 4.2)),
        size=Vector((1.8, e_d + 0.4, 8.4)),
        mat_idx=19,  # ShibuyaCommercialFacade（等倍2フロア商業アーケード）
        uv_rect=(0.0, 0.0, 1.0, 0.49),
    )
    add_box(
        bm,
        center=Vector((e_cx + e_w * 0.5 + 0.9, e_cy, 8.6)),
        size=Vector((2.1, e_d + 0.6, 0.5)),
        mat_idx=2,  # StreamDarkVoidSteel
    )
    for mul_y in [-12.0, -6.0, 0.0, 6.0, 12.0]:
        add_box(
            bm,
            center=Vector((e_cx + e_w * 0.5 + 1.85, e_cy + mul_y, 4.2)),
            size=Vector((0.22, 0.30, 8.4)),
            mat_idx=2,  # StreamDarkVoidSteel
        )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("ShibuyaMarkCity_Complex", mesh)
    assign_materials_to_object(obj, materials)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_shibuya_toei_plaza_bic_camera(
    materials: dict[str, bpy.types.Material],
) -> bpy.types.Object:
    """
    渋谷東映プラザ / ビックカメラ渋谷東口店（宮益坂下交差点北東角 ランドマーク）
    Three.js ワールド座標 (x=-723.0, z=275.0) -> Blender 座標 (bx=290.0, by=-28.0)
    1. 地上12階建て複合商業ビル（高さ 50.0m）:
       - 宮益坂北側歩道・明治通り東側歩道に正対するファサード
       - 宮益坂・明治通り両面に掲げられた巨大赤白「BIC CAMERA / ビックカメラ」タテ型・ヨコ型サイン看板
       - 渋谷TOEI 映画館サイン＆エントランス
       - 1F〜2F 家電量販店ショーウィンドウ
    """
    mesh = bpy.data.meshes.new("ShibuyaToeiBicMesh")
    bm = bmesh.new()

    cx = 290.0  # worldZ = 275.0（南側壁面 z = 262.0 で宮益坂車道 z = 248.0 を回避）
    cy = -28.0  # worldX = -723.0（西側壁面 x = -736.0 で明治通り車道 x = -750.0 を回避）
    w_x = 26.0
    d_y = 26.0
    h_z = 50.0

    # 1. ビル本体（ダークサッシコア）
    add_box(
        bm,
        center=Vector((cx, cy, h_z * 0.5)),
        size=Vector((w_x, d_y, h_z)),
        mat_idx=2,  # StreamDarkVoidSteel
    )
    # ガラスカーテンウォール窓面（全4面外周に突き出し、特に東面 worldX=-710 宮益坂側から無地白壁に見えない構成）
    add_box(
        bm,
        center=Vector((cx, cy, h_z * 0.5 + 4.0)),
        size=Vector((w_x + 0.24, d_y + 0.24, h_z - 10.0)),
        mat_idx=1,  # StreamCurtainGlass
    )
    # 1F〜2F 全周路面店舗暖色照明＆商業ウィンドウ（Z = 0.6..8.4m: 等倍2フロア）
    add_box(
        bm,
        center=Vector((cx, cy, 4.4)),
        size=Vector((w_x + 0.20, d_y + 0.20, 7.6)),
        mat_idx=6,  # WarmPlazaGlow
    )
    add_box(
        bm,
        center=Vector((cx, cy, 4.4)),
        size=Vector((w_x + 0.28, d_y + 0.28, 7.8)),
        mat_idx=19,  # ShibuyaCommercialFacade
        uv_rect=(0.0, 0.0, 1.0, 0.49),
    )
    # 2. 南面（宮益坂面）＆東面（宮益坂上り視点正面）のビックカメラ連続ファサード（Z = 1.0m .. 46.0m）
    add_box(
        bm,
        center=Vector((cx - w_x * 0.5 - 0.35, cy, 23.5)),
        size=Vector((0.6, d_y - 2.0, 45.0)),
        mat_idx=25,  # ShibuyaToeiBicFacade
    )
    # 東面（宮益坂上から西向きに正対する面 worldX=-710）: 実写ファサード＋サッシマリオン
    add_box(
        bm,
        center=Vector((cx, cy + d_y * 0.5 + 0.28, 24.0)),
        size=Vector((w_x - 2.4, 0.36, 44.0)),
        mat_idx=25,  # ShibuyaToeiBicFacade
    )
    # 北面（JR宮益坂北側）にもビックカメラ連続ファサードを展開（12階ミニチュア反復を防止）
    add_box(
        bm,
        center=Vector((cx + w_x * 0.5 + 0.26, cy, 24.0)),
        size=Vector((0.36, d_y - 2.4, 44.0)),
        mat_idx=25,  # ShibuyaToeiBicFacade
    )
    # 西面（明治通り面）のビックカメラ 1F〜上層階縦型連続ファサード（Z = 1.0m .. 46.0m）
    add_box(
        bm,
        center=Vector((cx, cy - d_y * 0.5 - 0.35, 23.5)),
        size=Vector((w_x - 4.0, 0.6, 45.0)),
        mat_idx=25,  # ShibuyaToeiBicFacade
    )
    # 各階水平アルミスパンドレル＆全4面垂直サッシマリオン
    for fl in range(10):
        fz = 9.0 + fl * 4.0
        add_box(
            bm,
            center=Vector((cx, cy, fz)),
            size=Vector((w_x + 0.40, d_y + 0.40, 0.36)),
            mat_idx=3,  # StreamGalvanizedFrame
        )
    for m_off in [-9.6, -4.8, 0.0, 4.8, 9.6]:
        for ny in [-1.0, 1.0]:
            add_box(
                bm,
                center=Vector((cx + m_off, cy + ny * (d_y * 0.5 + 0.16), h_z * 0.5 + 2.0)),
                size=Vector((0.26, 0.18, h_z - 6.0)),
                mat_idx=2,  # StreamDarkVoidSteel
            )
        for nx in [-1.0, 1.0]:
            add_box(
                bm,
                center=Vector((cx + nx * (w_x * 0.5 + 0.16), cy + m_off, h_z * 0.5 + 2.0)),
                size=Vector((0.18, 0.26, h_z - 6.0)),
                mat_idx=2,  # StreamDarkVoidSteel
            )
    # 3. 1F〜2F コーナー＆ガラスショーウィンドウ基壇フレーム
    add_box(
        bm,
        center=Vector((cx - 0.05, cy - 0.05, 5.0)),
        size=Vector((w_x + 0.2, d_y + 0.2, 9.6)),
        mat_idx=1,  # StreamCurtainGlass
    )
    # 4. 屋上設備パラペット＆航空障害灯
    add_box(
        bm,
        center=Vector((cx, cy, h_z + 2.0)),
        size=Vector((w_x * 0.5, d_y * 0.5, 4.0)),
        mat_idx=2,  # StreamDarkVoidSteel
    )
    add_cylinder_z(
        bm,
        center=Vector((cx - w_x * 0.4, cy - d_y * 0.4, h_z + 4.5)),
        radius=0.35,
        height=1.0,
        segments=12,
        mat_idx=7,  # BeaconRed
    )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("ShibuyaToeiBic_Tower", mesh)
    assign_materials_to_object(obj, materials)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_shibuya_cerulean_tower(
    materials: dict[str, bpy.types.Material],
) -> bpy.types.Object:
    """
    セルリアンタワー（Cerulean Tower Tokyu Hotel, 実寸 184.0m / 地上41階）
    Three.js ワールド座標 (x=-898.0, z=-45.0) -> Blender 座標 (bx=-30.0, by=-203.0)
    1. 低層ホテルポディウム・車寄せキャノピー・大宴会場 (Z = 0m..32m)
    2. 中高層オフィスタワー＆東急ホテル客室階 (Z = 32m..170m) - 特徴的な三角形扇状セットバック平面とカーテンウォール
    3. 屋上クラウン・ヘリポート（HeliportGreenPad + 白色Hマーク）＆航空障害灯 (Z = 170m..184m)
    """
    mesh = bpy.data.meshes.new("ShibuyaCerulean_TowerMesh")
    bm = bmesh.new()

    cx = -30.0  # worldZ = -45.0
    cy = -203.0  # worldX = -898.0
    w_x = 48.0
    d_y = 48.0

    # 1. 低層ポディウム・ホテルロビー (Z = 0m..32m)
    add_box(
        bm,
        center=Vector((cx, cy, 16.0)),
        size=Vector((w_x + 12.0, d_y + 10.0, 32.0)),
        mat_idx=8,  # ShutokoConcretePier
    )
    # ホテル車寄せエントランスキャノピー
    add_box(
        bm,
        center=Vector((cx, cy - d_y * 0.5 - 5.0, 6.5)),
        size=Vector((w_x * 0.65, 12.0, 1.8)),
        mat_idx=2,  # StreamDarkVoidSteel
    )
    # キャノピー支柱
    for c_x in [cx - w_x * 0.28, cx + w_x * 0.28]:
        add_cylinder_z(
            bm,
            center=Vector((c_x, cy - d_y * 0.5 - 10.0, 3.25)),
            radius=0.55,
            height=6.5,
            segments=12,
            mat_idx=2,
        )
    # 1F〜3F 暖色エントランスロビー窓
    add_box(
        bm,
        center=Vector((cx, cy - d_y * 0.5 - 0.2, 8.0)),
        size=Vector((w_x * 0.7, 1.2, 10.0)),
        mat_idx=6,  # WarmPlazaGlow
    )

    # 2. 中高層タワー（6F〜40F, Z = 32m..170m）
    tower_height = 138.0
    tower_mid_z = 32.0 + tower_height * 0.5
    add_box(
        bm,
        center=Vector((cx, cy, tower_mid_z)),
        size=Vector((w_x, d_y, tower_height)),
        mat_idx=1,  # StreamCurtainGlass
    )
    # 水平アルミフィン・バンド（全高にわたるシャープなカーテンウォール分節）
    for band_z in range(36, 170, 5):
        add_box(
            bm,
            center=Vector((cx, cy, float(band_z))),
            size=Vector((w_x + 0.55, d_y + 0.55, 0.52)),
            mat_idx=0,  # StreamWhitePanel
        )
        if band_z % 15 == 6:
            add_box(
                bm,
                center=Vector((cx, cy, float(band_z) + 2.2)),
                size=Vector((w_x + 0.16, d_y + 0.16, 1.6)),
                mat_idx=6,  # WarmPlazaGlow（ホテル客室・オフィス点灯層）
            )
    # 4面の中間垂直アルミマリオン列（11本×4面でのっぺり感を完全解消）
    for cer_i in range(11):
        cer_r = -0.44 + (cer_i / 10.0) * 0.88
        c_mat = 0 if (cer_i % 2 == 0) else 3
        for sy in [-1.0, 1.0]:
            add_box(
                bm,
                center=Vector((cx + cer_r * w_x, cy + sy * (d_y * 0.5 + 0.22), tower_mid_z)),
                size=Vector((0.36, 0.40, tower_height)),
                mat_idx=c_mat,
            )
        for sx in [-1.0, 1.0]:
            add_box(
                bm,
                center=Vector((cx + sx * (w_x * 0.5 + 0.22), cy + cer_r * d_y, tower_mid_z)),
                size=Vector((0.40, 0.36, tower_height)),
                mat_idx=c_mat,
            )
    # 四隅の重厚なコーナーマリオンピラー
    for m_x in [cx - w_x * 0.48, cx, cx + w_x * 0.48]:
        for m_y in [cy - d_y * 0.48, cy + d_y * 0.48]:
            add_box(
                bm,
                center=Vector((m_x, m_y, tower_mid_z)),
                size=Vector((1.1, 1.1, tower_height)),
                mat_idx=2,  # StreamDarkVoidSteel
            )

    # 3. 屋上ペントハウス・ヘリポート＆クラウン (Z = 170m..184m)
    add_box(
        bm,
        center=Vector((cx, cy, 174.0)),
        size=Vector((w_x * 0.65, d_y * 0.65, 8.0)),
        mat_idx=8,
    )
    # 屋上ヘリポート着陸帯（HeliportGreenPad）
    add_box(
        bm,
        center=Vector((cx, cy, 178.6)),
        size=Vector((18.0, 18.0, 1.2)),
        mat_idx=21,  # HeliportGreenPad
    )
    # ヘリポート白色Hマーク
    add_box(
        bm,
        center=Vector((cx - 3.2, cy, 179.3)),
        size=Vector((1.2, 7.5, 0.2)),
        mat_idx=0,  # StreamWhitePanel
    )
    add_box(
        bm,
        center=Vector((cx + 3.2, cy, 179.3)),
        size=Vector((1.2, 7.5, 0.2)),
        mat_idx=0,
    )
    add_box(
        bm,
        center=Vector((cx, cy, 179.3)),
        size=Vector((6.4, 1.4, 0.2)),
        mat_idx=0,
    )

    # 四隅の航空障害灯（BeaconRed）
    for corner_x in [cx - w_x * 0.42, cx + w_x * 0.42]:
        for corner_y in [cy - d_y * 0.42, cy + d_y * 0.42]:
            add_cylinder_z(
                bm,
                center=Vector((corner_x, corner_y, 184.0)),
                radius=0.45,
                height=1.4,
                segments=12,
                mat_idx=7,  # BeaconRed
            )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("ShibuyaCerulean_Tower", mesh)
    assign_materials_to_object(obj, materials)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_shibuya_parco_complex(
    materials: dict[str, bpy.types.Material],
) -> bpy.types.Object:
    """
    渋谷PARCO（Shibuya PARCO, 実寸 100.0m / 地上19階）
    Three.js ワールド座標 (x=-824.0, z=375.0) -> Blender 座標 (bx=390.0, by=-129.0)
    1. 低層商業ポディウム＆立体街路スパイラル階段テラス（Z = 0m..48m, 1F〜10F屋外回廊）
    2. 10F 屋上庭園「ROOFTOP PARK」＆野外テラスカフェ (Z = 45m..52m)
    3. 中高層オフィスタワー＆カルチャーフロア (Z = 50m..100m)
    """
    mesh = bpy.data.meshes.new("ShibuyaParco_ComplexMesh")
    bm = bmesh.new()

    cx = 403.0  # worldZ = 388.0
    cy = -140.0  # worldX = -835.0
    w_x = 36.0
    d_y = 36.0

    # 1. 低層商業ポディウム (Z = 0m..48m): 積層多面キューブフレーム＋ガラスファサード
    add_box(
        bm,
        center=Vector((cx, cy, 24.0)),
        size=Vector((w_x, d_y, 48.0)),
        mat_idx=1,  # StreamCurtainGlass（ベースガラスコア）
    )
    # 1F〜2F 路面商業ショーウィンドウ（等倍2フロア）
    add_box(
        bm,
        center=Vector((cx, cy, 4.5)),
        size=Vector((w_x + 0.32, d_y + 0.32, 8.6)),
        mat_idx=19,  # ShibuyaCommercialFacade
        uv_rect=(0.0, 0.0, 1.0, 0.49),
    )
    # PARCO 特有の鉱物・多面体積層キューブの白＆シルバー建築グリッドフレーム（Z = 9m..48m）
    for p_fl_z in range(9, 49, 5):
        add_box(
            bm,
            center=Vector((cx, cy, float(p_fl_z))),
            size=Vector((w_x + 0.58, d_y + 0.58, 0.52)),
            mat_idx=0 if (p_fl_z % 10 == 4) else 3,
        )
        if p_fl_z % 10 == 4 and p_fl_z < 45:
            add_box(
                bm,
                center=Vector((cx, cy, float(p_fl_z) + 2.4)),
                size=Vector((w_x + 0.18, d_y + 0.18, 2.2)),
                mat_idx=6,  # WarmPlazaGlow（商業フロア内観光）
            )
    for pm_i in range(9):
        pm_r = -0.44 + (pm_i / 8.0) * 0.88
        pm_mat = 0 if (pm_i % 2 == 0) else 2
        for sy in [-1.0, 1.0]:
            add_box(
                bm,
                center=Vector((cx + pm_r * w_x, cy + sy * (d_y * 0.5 + 0.24), 24.0)),
                size=Vector((0.38, 0.42, 47.6)),
                mat_idx=pm_mat,
            )
        for sx in [-1.0, 1.0]:
            add_box(
                bm,
                center=Vector((cx + sx * (w_x * 0.5 + 0.24), cy + pm_r * d_y, 24.0)),
                size=Vector((0.42, 0.38, 47.6)),
                mat_idx=pm_mat,
            )

    # 立体街路スパイラル階段テラス（スリム構造柱・白スラブ・植栽グリーンプランター・ガラス手すりで構成）
    step_count = 10
    for s_i in range(step_count):
        s_ratio = s_i / step_count
        step_z = 4.5 + s_ratio * 41.0
        angle = s_ratio * math.pi * 1.5
        s_dx = math.cos(angle) * (w_x * 0.46)
        s_dy = math.sin(angle) * (d_y * 0.46)
        # 地表 z=0 から各テラス下端まで繋がるスリム鉄骨構造ピラー（太い黒箱にならぬよう 1.1m 角に引き締め）
        add_box(
            bm,
            center=Vector((cx + s_dx * 1.04, cy + s_dy * 1.04, step_z * 0.5)),
            size=Vector((1.05, 1.05, step_z)),
            mat_idx=2,  # StreamDarkVoidSteel
        )
        # テラス床スラブ
        add_box(
            bm,
            center=Vector((cx + s_dx, cy + s_dy, step_z)),
            size=Vector((5.6, 5.6, 0.85)),
            mat_idx=0,  # StreamWhitePanel
        )
        # テラス外縁の立体街路植栽グリーンプランター＆ガラス欄干
        add_box(
            bm,
            center=Vector((cx + s_dx * 1.03, cy + s_dy * 1.03, step_z + 0.72)),
            size=Vector((5.4, 5.4, 0.65)),
            mat_idx=4,  # StreamVerticalGreen
        )
        add_box(
            bm,
            center=Vector((cx + s_dx * 1.05, cy + s_dy * 1.05, step_z + 1.25)),
            size=Vector((5.7, 5.7, 0.55)),
            mat_idx=1,  # StreamCurtainGlass
        )

    # 2. 10F 屋上庭園「ROOFTOP PARK」(Z = 48m..52m)
    add_box(
        bm,
        center=Vector((cx - 4.0, cy - 4.0, 49.0)),
        size=Vector((w_x * 0.75, d_y * 0.75, 2.0)),
        mat_idx=4,  # StreamVerticalGreen
    )

    # 3. 中高層オフィスタワー (Z = 50m..100m): 水平アルミスパンドレル＋垂直マリオン格子
    up_w = w_x * 0.75
    up_d = d_y * 0.75
    add_box(
        bm,
        center=Vector((cx + 2.0, cy + 2.0, 75.0)),
        size=Vector((up_w, up_d, 50.0)),
        mat_idx=1,  # StreamCurtainGlass
    )
    for f_z in range(53, 99, 5):
        add_box(
            bm,
            center=Vector((cx + 2.0, cy + 2.0, float(f_z))),
            size=Vector((up_w + 0.55, up_d + 0.55, 0.55)),
            mat_idx=0,
        )
        if f_z % 10 == 3:
            add_box(
                bm,
                center=Vector((cx + 2.0, cy + 2.0, float(f_z) + 2.2)),
                size=Vector((up_w + 0.16, up_d + 0.16, 1.6)),
                mat_idx=6,
            )
    for pt_i in range(7):
        pt_r = -0.42 + (pt_i / 6.0) * 0.84
        for sy in [-1.0, 1.0]:
            add_box(
                bm,
                center=Vector((cx + 2.0 + pt_r * up_w, cy + 2.0 + sy * (up_d * 0.5 + 0.22), 75.0)),
                size=Vector((0.34, 0.38, 49.6)),
                mat_idx=3 if (pt_i % 2 == 1) else 0,
            )
        for sx in [-1.0, 1.0]:
            add_box(
                bm,
                center=Vector((cx + 2.0 + sx * (up_w * 0.5 + 0.22), cy + 2.0 + pt_r * up_d, 75.0)),
                size=Vector((0.38, 0.34, 49.6)),
                mat_idx=3 if (pt_i % 2 == 0) else 0,
            )

    # 塔屋・パラペット＆航空障害灯 (Z = 100m..103m)
    add_box(
        bm,
        center=Vector((cx + 2.0, cy + 2.0, 101.5)),
        size=Vector((w_x * 0.5, d_y * 0.5, 3.0)),
        mat_idx=2,
    )
    add_cylinder_z(
        bm,
        center=Vector((cx + 2.0, cy + 2.0, 103.5)),
        radius=0.45,
        height=1.2,
        segments=12,
        mat_idx=7,  # BeaconRed
    )

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("ShibuyaParco_Complex", mesh)
    assign_materials_to_object(obj, materials)
    bpy.context.scene.collection.objects.link(obj)
    return obj


_STREAM_DEM_CACHE: tuple[dict, list[list[float]]] | None = None


def sample_shibuya_terrain_y(x: float, z: float) -> float:
    """`gsiPlateauLoader.ts` の `sampleShibuyaTerrainY` と一致する 2-pass 平滑済み地形標高（m）"""
    global _STREAM_DEM_CACHE
    if x >= -395.0:
        return 0.0
    if _STREAM_DEM_CACHE is None:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.abspath(os.path.join(script_dir, "..", ".."))
        json_path = os.path.join(
            project_root, "apps", "web", "public", "data", "tokyo_marunouchi_open_data.json"
        )
        with open(json_path, encoding="utf-8") as fh:
            dem = json.load(fh)["shibuyaDem5a"]
        grid = [[float(v) for v in row] for row in dem["elevationGrid"]]
        rows = len(grid)
        cols = len(grid[0]) if rows > 0 else 0
        for _ in range(2):
            nxt = [[0.0] * cols for _ in range(rows)]
            for r in range(rows):
                rm, rp = max(0, r - 1), min(rows - 1, r + 1)
                for c in range(cols):
                    cm, cp = max(0, c - 1), min(cols - 1, c + 1)
                    nxt[r][c] = (
                        grid[rm][cm]
                        + 2.0 * grid[rm][c]
                        + grid[rm][cp]
                        + 2.0 * grid[r][cm]
                        + 4.0 * grid[r][c]
                        + 2.0 * grid[r][cp]
                        + grid[rp][cm]
                        + 2.0 * grid[rp][c]
                        + grid[rp][cp]
                    ) / 16.0
            grid = nxt
        _STREAM_DEM_CACHE = (dem, grid)

    dem, grid = _STREAM_DEM_CACHE
    rows, cols = len(grid), len(grid[0])
    step = float(dem["gridStep"])
    fx = max(0.0, min(cols - 1.0001, (x - float(dem["xMin"])) / step))
    fz = max(0.0, min(rows - 1.0001, (z - float(dem["zMin"])) / step))
    c0, r0 = min(cols - 1, math.floor(fx)), min(rows - 1, math.floor(fz))
    c1, r1 = min(cols - 1, c0 + 1), min(rows - 1, r0 + 1)
    tx, tz = fx - c0, fz - r0
    e = (grid[r0][c0] * (1.0 - tx) + grid[r0][c1] * tx) * (1.0 - tz) + (
        grid[r1][c0] * (1.0 - tx) + grid[r1][c1] * tx
    ) * tz
    y = max(-0.4, (e - 15.0) * 0.72)
    if x > -500.0:
        t = max(0.0, min(1.0, (x - -500.0) / (-395.0 - -500.0)))
        y *= 0.5 * (1.0 + math.cos(math.pi * t))
    return y


def _transform_mesh_vertices(
    mesh: bpy.types.Mesh,
    verts: list[bpy.types.MeshVertex],
    old_cx: float,
    old_cy: float,
    target_wx: float,
    target_wz: float,
    rot_z_deg: float,
    skirt_depth: float = 3.5,
) -> None:
    """剛体Z回転（反転なし・det=+1）+ アンカー (-750.0, 527.6) 相対並行移動 + 地形接地・地中スカート延長"""
    target_bx = target_wx - (-750.0)
    target_by = 527.6 - target_wz
    ty = sample_shibuya_terrain_y(target_wx, target_wz)
    rad = math.radians(rot_z_deg)
    cos_a = math.cos(rad)
    sin_a = math.sin(rad)

    for v in verts:
        dx = v.co.x - old_cx
        dy = v.co.y - old_cy
        rx = dx * cos_a - dy * sin_a
        ry = dx * sin_a + dy * cos_a
        vz = (ty - skirt_depth) if (skirt_depth > 0.0 and v.co.z <= 0.15) else (v.co.z + ty)
        v.co = Vector((target_bx + rx, target_by + ry, vz))
    mesh.update()


def reposition_mesh_obj(
    obj: bpy.types.Object,
    old_cx: float,
    old_cy: float,
    target_wx: float,
    target_wz: float,
    rot_z_deg: float,
    skirt_depth: float = 3.5,
) -> None:
    """メッシュオブジェクト全体を 1:1 非反転座標系 + 地形標高へ剛体再配置する"""
    if obj.type != "MESH" or not obj.data:
        return
    _transform_mesh_vertices(
        obj.data,
        list(obj.data.vertices),
        old_cx,
        old_cy,
        target_wx,
        target_wz,
        rot_z_deg,
        skirt_depth=skirt_depth,
    )


def build_shibuya_center_gai_entrance(
    materials: dict[str, bpy.types.Material],
) -> bpy.types.Object:
    """
    渋谷センター街（バスケットボール通り）メイン入口アーチ看板（1:1 非反転 実座標）
    u = 0.08 地点 (-1035.8, 238.4) -> アンカー (-750.0, 527.6) 相対 Blender (-285.8, +289.2)
    """
    mesh = bpy.data.meshes.new("ShibuyaCenterGai_ArchMesh")
    bm = bmesh.new()

    wx, wz = -1035.8, 238.4
    cx = wx - (-750.0)
    cy = 527.6 - wz
    base_z = sample_shibuya_terrain_y(wx, wz)

    # 進行方向: スクランブル北西入口 (-1024, 249) -> (-1155, 128) (Three.js tan=(-0.73, -0.68) -> Blender (-0.73, +0.68))
    tangent_dir = Vector((-0.73, 0.68, 0.0)).normalized()
    normal_dir = Vector((0.68, 0.73, 0.0)).normalized()

    half_span = 5.4
    for side in [-1.0, 1.0]:
        pillar_pos = Vector((cx, cy, base_z + 3.7)) + side * half_span * normal_dir
        add_cylinder_z(
            bm,
            center=pillar_pos,
            radius=0.28,
            height=9.2,
            segments=14,
            mat_idx=2,  # StreamDarkVoidSteel
        )
        base_pos = Vector((cx, cy, base_z + 0.1)) + side * half_span * normal_dir
        add_oriented_box(
            bm,
            center=base_pos,
            tangent_dir=tangent_dir,
            normal_dir=normal_dir,
            size_tangent=0.9,
            size_normal=0.9,
            size_z=1.4,
            mat_idx=2,
        )

    add_oriented_box(
        bm,
        center=Vector((cx, cy, base_z + 7.6)),
        tangent_dir=tangent_dir,
        normal_dir=normal_dir,
        size_tangent=0.6,
        size_normal=11.4,
        size_z=0.6,
        mat_idx=3,  # StreamGalvanizedFrame
    )

    uv_layer = bm.loops.layers.uv.verify()
    t = tangent_dir.normalized()
    n = normal_dir.normalized()
    up = Vector((0.0, 0.0, 1.0))

    def add_sign_panel_box(
        panel_center: Vector,
        size_t: float,
        size_n: float,
        size_z: float,
        face_axis: str,
        face_mat: int,
        edge_mat: int,
    ) -> None:
        ht = size_t * 0.5
        hn = size_n * 0.5
        hz = size_z * 0.5
        pts = [
            panel_center + t * (-ht) + n * (-hn) + up * (-hz),
            panel_center + t * ht + n * (-hn) + up * (-hz),
            panel_center + t * ht + n * hn + up * (-hz),
            panel_center + t * (-ht) + n * hn + up * (-hz),
            panel_center + t * (-ht) + n * (-hn) + up * hz,
            panel_center + t * ht + n * (-hn) + up * hz,
            panel_center + t * ht + n * hn + up * hz,
            panel_center + t * (-ht) + n * hn + up * hz,
        ]
        verts = [bm.verts.new(p) for p in pts]
        uv_corners = [
            Vector((0.0, 0.0)),
            Vector((1.0, 0.0)),
            Vector((1.0, 1.0)),
            Vector((0.0, 1.0)),
        ]

        if face_axis == "normal":
            face_specs = [
                ((0, 3, 7, 4), face_mat, uv_corners),
                ((2, 1, 5, 6), face_mat, uv_corners),
                ((0, 3, 2, 1), edge_mat, uv_corners),
                ((4, 5, 6, 7), edge_mat, uv_corners),
                ((0, 1, 5, 4), edge_mat, uv_corners),
                ((2, 3, 7, 6), edge_mat, uv_corners),
            ]
        else:
            face_specs = [
                ((1, 0, 4, 5), face_mat, uv_corners),
                ((3, 2, 6, 7), face_mat, uv_corners),
                ((0, 3, 2, 1), edge_mat, uv_corners),
                ((4, 5, 6, 7), edge_mat, uv_corners),
                ((1, 2, 6, 5), edge_mat, uv_corners),
                ((3, 0, 4, 7), edge_mat, uv_corners),
            ]

        for idxs, m_idx, uvs in face_specs:
            f = bm.faces.new([verts[idxs[0]], verts[idxs[1]], verts[idxs[2]], verts[idxs[3]]])
            f.material_index = m_idx
            for li, uv in enumerate(uvs):
                f.loops[li][uv_layer].uv = uv

    add_sign_panel_box(
        panel_center=Vector((cx, cy, base_z + 6.8)),
        size_t=0.42,
        size_n=6.4,
        size_z=1.4,
        face_axis="normal",
        face_mat=27,  # ShibuyaCenterGaiArchSign
        edge_mat=2,  # StreamDarkVoidSteel
    )
    add_oriented_box(
        bm,
        center=Vector((cx, cy, base_z + 7.7)),
        tangent_dir=tangent_dir,
        normal_dir=normal_dir,
        size_tangent=0.5,
        size_normal=6.8,
        size_z=0.28,
        mat_idx=10,  # ShibuyaSkyEdgeGlow
    )

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("ShibuyaCenterGai_Arch", mesh)
    assign_materials_to_object(obj, materials)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_shibuya_hachiko_statue(
    materials: dict[str, bpy.types.Material],
) -> bpy.types.Object:
    """
    渋谷駅ハチ公前広場 忠犬ハチ公像（彫塑シルエット秋田犬ブロンズ像＋白御影石段状台座＋地中スカート）を構築する。
    実在GPS (35.65906°N, 139.70065°E) -> world (-984.4, terrainY + 0.023, 324.6) ->
    アンカー (-750.0, 527.6) 相対 Blender (-234.4, +203.0) でスクランブル交差点（北西）へ正対配置。
    """
    mesh = bpy.data.meshes.new("ShibuyaHachiko_StatueMesh")
    bm = bmesh.new()

    wx, wz = -984.4, 324.6
    bx = wx - (-750.0)
    by = 527.6 - wz
    base_z = sample_shibuya_terrain_y(wx, wz) + 0.023

    # 正面（北西 Scramble Crossing 側: Blender (-0.707, +0.707)）への基底ベクトル
    fwd = Vector((-1.0, 1.0, 0.0)).normalized()
    right = Vector((1.0, 1.0, 0.0)).normalized()
    up = Vector((0.0, 0.0, 1.0))

    def pt_local(rx: float, fy: float, uz: float) -> Vector:
        return Vector((bx, by, base_z)) + right * rx + fwd * fy + up * uz

    def add_oriented_ellipsoid(
        center_local: tuple[float, float, float],
        radii: tuple[float, float, float],
        tilt_pitch_deg: float = 0.0,
        tilt_roll_deg: float = 0.0,
        mat_idx: int = 30,
        subdivisions: int = 2,
    ) -> None:
        res = bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=1.0)
        verts = res["verts"]
        p_rad = math.radians(tilt_pitch_deg)
        r_rad = math.radians(tilt_roll_deg)
        cp, sp = math.cos(p_rad), math.sin(p_rad)
        cr, sr = math.cos(r_rad), math.sin(r_rad)
        c_pos = pt_local(*center_local)
        for v in verts:
            lx = v.co.x * radii[0]
            ly = v.co.y * radii[1]
            lz = v.co.z * radii[2]
            # Roll around forward axis (local Y)
            rx0 = lx * cr - lz * sr
            rz0 = lx * sr + lz * cr
            # Pitch around right axis (local X)
            fy1 = ly * cp - rz0 * sp
            uz1 = ly * sp + rz0 * cp
            v.co = c_pos + right * rx0 + fwd * fy1 + up * uz1
        visited = set()
        for v in verts:
            for f in v.link_faces:
                if f not in visited:
                    visited.add(f)
                    f.material_index = mat_idx

    def add_oriented_limb(
        p0_local: tuple[float, float, float],
        p1_local: tuple[float, float, float],
        r0: float,
        r1: float,
        mat_idx: int = 30,
        segments: int = 12,
    ) -> None:
        p0 = pt_local(*p0_local)
        p1 = pt_local(*p1_local)
        axis = p1 - p0
        if axis.length < 1e-4:
            return
        d = axis.normalized()
        ref = up if abs(d.z) < 0.9 else fwd
        u_ax = d.cross(ref).normalized()
        v_ax = d.cross(u_ax).normalized()
        ring0, ring1 = [], []
        for i in range(segments):
            ang = 2.0 * math.pi * i / segments
            radial = u_ax * math.cos(ang) + v_ax * math.sin(ang)
            ring0.append(bm.verts.new(p0 + radial * r0))
            ring1.append(bm.verts.new(p1 + radial * r1))
        for i in range(segments):
            ni = (i + 1) % segments
            f = bm.faces.new([ring0[i], ring0[ni], ring1[ni], ring1[i]])
            f.material_index = mat_idx
        f_bot = bm.faces.new(list(reversed(ring0)))
        f_bot.material_index = mat_idx
        f_top = bm.faces.new(ring1)
        f_top.material_index = mat_idx

    # 1. 御影石台座（地中スカート -1.5m + 二段基壇 + 台座 + 銘板）
    add_oriented_box(
        bm,
        center=pt_local(0.0, 0.0, -0.75),
        tangent_dir=fwd,
        normal_dir=right,
        size_tangent=1.84,
        size_normal=1.64,
        size_z=1.50,
        mat_idx=31,  # HachikoGranite
    )
    add_oriented_box(
        bm,
        center=pt_local(0.0, 0.0, 0.14),
        tangent_dir=fwd,
        normal_dir=right,
        size_tangent=1.76,
        size_normal=1.56,
        size_z=0.28,
        mat_idx=31,
    )
    add_oriented_box(
        bm,
        center=pt_local(0.0, 0.0, 0.68),
        tangent_dir=fwd,
        normal_dir=right,
        size_tangent=1.34,
        size_normal=1.18,
        size_z=0.82,
        mat_idx=31,
    )
    # 銅製銘板
    add_oriented_box(
        bm,
        center=pt_local(0.0, 0.68, 0.68),
        tangent_dir=fwd,
        normal_dir=right,
        size_tangent=0.06,
        size_normal=0.58,
        size_z=0.38,
        mat_idx=30,  # HachikoBronze
    )

    # 2. お座りポーズのブロンズ秋田犬ハチ公本体 (Z = 1.09m .. 2.02m)
    z0 = 1.09
    # 後躯（座った腰部・太腿）
    add_oriented_ellipsoid(
        (0.0, -0.18, z0 + 0.18), (0.20, 0.24, 0.18), tilt_pitch_deg=-15.0, mat_idx=30
    )
    # 厚みのある胸郭・前胴体
    add_oriented_ellipsoid(
        (0.0, 0.08, z0 + 0.34), (0.19, 0.26, 0.22), tilt_pitch_deg=32.0, mat_idx=30
    )
    # 首筋
    add_oriented_limb((0.0, 0.20, z0 + 0.44), (0.0, 0.31, z0 + 0.62), 0.14, 0.125, mat_idx=30)
    # 頭部・頬ボリューム
    add_oriented_ellipsoid(
        (0.0, 0.33, z0 + 0.68), (0.145, 0.165, 0.145), tilt_pitch_deg=-5.0, mat_idx=30
    )
    # 秋田犬の精悍な口吻（マズル）＆鼻先
    add_oriented_ellipsoid(
        (0.0, 0.49, z0 + 0.65), (0.075, 0.11, 0.068), tilt_pitch_deg=-6.0, mat_idx=30
    )
    add_oriented_ellipsoid((0.0, 0.58, z0 + 0.66), (0.032, 0.032, 0.028), mat_idx=2, subdivisions=1)
    # 右耳（凛と立つ三角耳）・左耳（特徴的な垂れ耳）
    add_oriented_limb(
        (-0.095, 0.31, z0 + 0.78), (-0.115, 0.33, z0 + 0.92), 0.052, 0.018, mat_idx=30, segments=8
    )
    add_oriented_limb(
        (0.095, 0.31, z0 + 0.78), (0.155, 0.34, z0 + 0.72), 0.052, 0.020, mat_idx=30, segments=8
    )
    # 前脚2本（真っ直ぐ台座に着く力強い前肢 + 足先）
    for sx in [-0.11, 0.11]:
        add_oriented_limb((sx, 0.22, z0 + 0.30), (sx, 0.27, z0 + 0.04), 0.068, 0.052, mat_idx=30)
        add_oriented_ellipsoid(
            (sx, 0.30, z0 + 0.035), (0.055, 0.075, 0.036), mat_idx=30, subdivisions=1
        )
    # 後脚（折りたたんだ脛＋足先）
    for sx in [-0.15, 0.15]:
        add_oriented_ellipsoid(
            (sx, -0.05, z0 + 0.06), (0.065, 0.16, 0.06), mat_idx=30, subdivisions=1
        )
    # 太い巻き尾（3セグメントの背負い巻き尾）
    add_oriented_limb(
        (0.0, -0.36, z0 + 0.14), (0.0, -0.44, z0 + 0.30), 0.06, 0.055, mat_idx=30, segments=10
    )
    add_oriented_limb(
        (0.0, -0.44, z0 + 0.30), (0.0, -0.34, z0 + 0.44), 0.055, 0.048, mat_idx=30, segments=10
    )
    add_oriented_limb(
        (0.0, -0.34, z0 + 0.44), (0.04, -0.22, z0 + 0.38), 0.048, 0.032, mat_idx=30, segments=10
    )

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("ShibuyaHachiko_Statue", mesh)
    assign_materials_to_object(obj, materials)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def generate_shibuya_stream():
    """渋谷ストリーム・主要ランドマーク群・センター街・ハチ公像を 1:1 非反転 実座標＋地形標高へ生成・配置して GLB エクスポートする"""
    clean_scene()
    materials = setup_materials()

    root = bpy.data.objects.new("ShibuyaStreamRoot", None)
    root.empty_display_type = "ARROWS"
    root.empty_display_size = 2.0
    bpy.context.scene.collection.objects.link(root)

    podium = build_low_rise_podium_and_plaza(materials)
    mid_void = build_mid_void_and_hotel_band(materials)
    high_rise = build_high_rise_tower(materials)
    stream_signage = build_stream_architectural_signage(materials)
    for stream_part, sk in [
        (podium, 3.5),
        (mid_void, 0.0),
        (high_rise, 0.0),
        (stream_signage, 0.0),
    ]:
        reposition_mesh_obj(stream_part, 0.0, 0.0, -750.0, 527.6, 135.0, skirt_depth=sk)
        stream_part.parent = root

    shutoko_viaduct = build_shutoko_route3_viaduct(materials)
    shutoko_viaduct.parent = root

    scramble_square = build_shibuya_scramble_square_tower(materials)
    reposition_mesh_obj(scramble_square, 160.0, -114.3, -835.7, 391.1, -90.0)
    scramble_square.parent = root

    hikarie = build_shibuya_hikarie_tower(materials)
    reposition_mesh_obj(hikarie, 161.8, 1.3, -723.6, 327.9, -90.0)
    hikarie.parent = root

    pedestrian_deck = build_shibuya_pedestrian_deck_and_rail_overpass(materials)
    pedestrian_deck.parent = root

    sakura_stage = build_shibuya_sakura_stage_tower(materials)
    reposition_mesh_obj(sakura_stage, -9.2, -110.3, -908.7, 613.0, -90.0)
    sakura_stage.parent = root

    fukuras = build_shibuya_fukuras_tower(materials)
    reposition_mesh_obj(fukuras, 61.0, -111.3, -1026.3, 443.3, -90.0)
    fukuras.parent = root

    miyashita_park = build_shibuya_miyashita_park_complex(materials)
    reposition_mesh_obj(miyashita_park, 334.9, -0.2, -895.0, 47.2, 90.0)
    miyashita_park.parent = root

    qfront_109 = build_shibuya_qfront_109_complex(materials)
    qf_verts = [v for v in qfront_109.data.vertices if v.co.y > -150.0]
    s109_verts = [v for v in qfront_109.data.vertices if v.co.y <= -150.0]
    _transform_mesh_vertices(
        qfront_109.data, qf_verts, 303.0, -120.0, -1009.0, 235.8, 114.6, skirt_depth=3.5
    )
    _transform_mesh_vertices(
        qfront_109.data, s109_verts, 278.0, -184.0, -1192.0, 266.0, -113.0, skirt_depth=3.5
    )
    qfront_109.parent = root

    magnet = build_shibuya_magnet_and_station_front(materials)
    reposition_mesh_obj(magnet, 303.9, -85.0, -950.0, 224.0, 90.0)
    magnet.parent = root

    mark_city = build_shibuya_mark_city_complex(materials)
    reposition_mesh_obj(mark_city, 173.0, -183.5, -1154.9, 424.4, -90.0)
    mark_city.parent = root

    toei_bic = build_shibuya_toei_plaza_bic_camera(materials)
    reposition_mesh_obj(toei_bic, 289.9, -28.1, -770.0, 202.0, -90.0)
    toei_bic.parent = root

    cerulean = build_shibuya_cerulean_tower(materials)
    reposition_mesh_obj(cerulean, -30.0, -206.0, -1093.8, 616.4, -90.0)
    cerulean.parent = root

    parco = build_shibuya_parco_complex(materials)
    reposition_mesh_obj(parco, 403.1, -139.2, -1154.9, -8.3, -90.0)
    parco.parent = root

    center_gai = build_shibuya_center_gai_entrance(materials)
    center_gai.parent = root

    hachiko_statue = build_shibuya_hachiko_statue(materials)
    hachiko_statue.parent = root

    print("Preserving procedural and cylindrical UV coordinates for all mesh objects...")
    for m_obj in bpy.data.objects:
        if m_obj.type == "MESH" and m_obj.data.uv_layers:
            m_obj.data.uv_layers.active_index = 0

    print(
        "High-precision Shibuya Station District (1:1 non-mirrored) modeling complete! Hierarchy:"
    )
    for obj in bpy.data.objects:
        p_name = obj.parent.name if obj.parent else "None"
        print(f"  - {obj.name} (Type: {obj.type}, Parent: {p_name})")

    out_dir = os.path.abspath("apps/web/public/models")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "shibuya_stream.glb")

    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_extras=True,
    )
    print(
        f"Successfully exported Shibuya Stream & Landmarks model to: {out_path} ({os.path.getsize(out_path):,} bytes)"
    )
    out_dist_path = os.path.abspath("apps/web/dist/models/shibuya_stream.glb")
    if os.path.exists(os.path.dirname(out_dist_path)):
        import shutil

        shutil.copyfile(out_path, out_dist_path)
        print(f"Synchronized to dist: {out_dist_path}")


def render_360_review(review_dir: str):
    """360度マルチアングル＆主要ランドマーク（ハチ公像・スクランブル・QFRONT・109・ストリーム）検証レンダリング"""
    os.makedirs(review_dir, exist_ok=True)
    scene = bpy.context.scene
    avail_engines = [
        e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items
    ]
    if "BLENDER_EEVEE_NEXT" in avail_engines:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    elif "BLENDER_EEVEE" in avail_engines:
        scene.render.engine = "BLENDER_EEVEE"
    else:
        scene.render.engine = "CYCLES"

    scene.render.resolution_x = 960
    scene.render.resolution_y = 720
    scene.render.image_settings.file_format = "PNG"

    world = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
    scene.world = world
    if world.node_tree is None:
        world.use_nodes = True
    bg = next((n for n in world.node_tree.nodes if n.type == "BACKGROUND"), None)
    if bg:
        bg.inputs["Color"].default_value = (0.36, 0.44, 0.56, 1.0)
        bg.inputs["Strength"].default_value = 1.15

    for idx, (loc, rot, energy) in enumerate(
        [
            ((120.0, -160.0, 220.0), (math.radians(48), 0.0, math.radians(32)), 3.2),
            ((-140.0, 150.0, 180.0), (math.radians(55), 0.0, math.radians(-145)), 1.6),
        ]
    ):
        light_data = bpy.data.lights.new(name=f"ReviewSun_{idx}", type="SUN")
        light_data.energy = energy
        light_obj = bpy.data.objects.new(name=f"ReviewSun_{idx}", object_data=light_data)
        scene.collection.objects.link(light_obj)
        light_obj.location = loc
        light_obj.rotation_euler = rot

    cam_data = bpy.data.cameras.new("ReviewCamera")
    cam_data.lens = 35.0
    cam_data.clip_end = 2500.0
    cam_obj = bpy.data.objects.new("ReviewCamera", cam_data)
    scene.collection.objects.link(cam_obj)
    scene.camera = cam_obj

    def bpos(wx: float, wz: float, h: float) -> Vector:
        return Vector((wx - (-750.0), 527.6 - wz, sample_shibuya_terrain_y(wx, wz) + h))

    views = [
        ("00_overview_southeast", bpos(-550.0, 720.0, 220.0), bpos(-930.0, 340.0, 50.0), 26.0),
        ("01_overview_northeast", bpos(-540.0, 20.0, 220.0), bpos(-950.0, 340.0, 50.0), 26.0),
        ("02_overview_northwest", bpos(-1380.0, -40.0, 220.0), bpos(-950.0, 340.0, 50.0), 26.0),
        ("03_overview_southwest", bpos(-1380.0, 760.0, 220.0), bpos(-950.0, 340.0, 50.0), 26.0),
        ("04_birdseye_shibuya", bpos(-950.0, 340.0, 540.0), bpos(-950.0, 340.0, 10.0), 24.0),
        ("05_stream_front_meiji", bpos(-680.0, 465.0, 4.0), bpos(-750.0, 527.6, 55.0), 24.0),
        (
            "06_scramble_qfront_centergai",
            bpos(-965.0, 305.0, 3.0),
            bpos(-1020.0, 236.0, 18.0),
            24.0,
        ),
        ("07_shibuya109_east_yfork", bpos(-1125.0, 272.0, 3.5), bpos(-1192.0, 266.0, 32.0), 24.0),
        ("08_hachiko_closeup_front", bpos(-988.5, 320.5, 1.9), bpos(-984.4, 324.6, 1.4), 38.0),
        ("09_hachiko_closeup_side", bpos(-981.0, 321.5, 2.0), bpos(-984.4, 324.6, 1.3), 38.0),
        ("10_scramble_sq_hikarie", bpos(-795.0, 380.0, 15.0), bpos(-835.7, 391.1, 80.0), 22.0),
        ("11_cerulean_sakura_fukuras", bpos(-975.0, 515.0, 18.0), bpos(-1085.0, 600.0, 70.0), 22.0),
    ]

    for name, cam_pos, target_pos, lens in views:
        cam_data.lens = lens
        cam_obj.location = cam_pos
        direction = target_pos - cam_pos
        cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        out_file = os.path.join(review_dir, f"{name}.png")
        scene.render.filepath = out_file
        bpy.ops.render.render(write_still=True)
        print(f"Rendered review angle: {out_file}")


if __name__ == "__main__":
    import sys

    generate_shibuya_stream()
    if "--render-review" in sys.argv:
        idx = sys.argv.index("--render-review")
        target_dir = sys.argv[idx + 1] if idx + 1 < len(sys.argv) else "/tmp/shibuya_review_r3"
        render_360_review(target_dir)

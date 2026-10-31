"""
Blender Script: 車両階層・ピボット自動セットアップ
BlenderのText Editorで開いて [Run Script] を実行してください。
"""

import bpy
import math

def setup_car_template():
    # 既存コレクションの取得または新規作成
    col_name = "DeepDrive_Car"
    if col_name in bpy.data.collections:
        car_col = bpy.data.collections[col_name]
    else:
        car_col = bpy.data.collections.new(col_name)
        bpy.context.scene.collection.children.link(car_col)

    # 1. ルート空オブジェクト
    root = bpy.data.objects.new("CarRoot", None)
    root.empty_display_type = 'ARROWS'
    car_col.objects.link(root)

    # 2. ワイパー用ピボット（運転席・助手席）
    wiper_driver = bpy.data.objects.new("WiperDriver", None)
    wiper_driver.empty_display_type = 'SINGLE_ARROW'
    wiper_driver.location = (0.28, 1.25, 0.92)
    wiper_driver.rotation_euler = (math.radians(-39), 0, math.radians(11))
    wiper_driver.parent = root
    car_col.objects.link(wiper_driver)

    wiper_pass = bpy.data.objects.new("WiperPassenger", None)
    wiper_pass.empty_display_type = 'SINGLE_ARROW'
    wiper_pass.location = (-0.32, 1.25, 0.92)
    wiper_pass.rotation_euler = (math.radians(-39), 0, math.radians(11))
    wiper_pass.parent = root
    car_col.objects.link(wiper_pass)

    print("Car template and wiper pivots created successfully!")

if __name__ == "__main__":
    setup_car_template()

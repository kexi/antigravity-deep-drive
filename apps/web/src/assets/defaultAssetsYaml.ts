export const DEFAULT_ASSETS_YAML = `
version: "1.0.0"
name: "Tokyo Station Marunouchi Drive Assets"

models:
  - id: "car"
    path: "/models/car.glb"
    scale: [1.0, 1.0, 1.0]
    offset: [0.0, 0.0, 0.0]
    subparts:
      body: "Chassis_Body"
      wheelFL: "Wheel_FL"
      wheelFR: "Wheel_FR"
      wheelRL: "Wheel_RL"
      wheelRR: "Wheel_RR"
      windshield: "Windshield_Glass"
      wiperL: "Wiper_Left"
      wiperR: "Wiper_Right"
      headlightL: "Headlight_Left"
      headlightR: "Headlight_Right"
    fallbackColor: 0x1133aa

  - id: "tokyo_station"
    path: "/models/tokyo_station.glb"
    scale: [1.0, 1.0, 1.0]
    offset: [0.0, 0.0, -45.0]
    subparts:
      mainBuilding: "TokyoStation_Main"
      northDome: "Dome_North"
      southDome: "Dome_South"
    fallbackColor: 0x8b3a2b

  - id: "street_tree"
    path: "/models/street_tree.glb"
    scale: [1.0, 1.0, 1.0]
    offset: [0.0, 0.0, 0.0]
    subparts:
      trunk: "Tree_Trunk"
      foliage: "Tree_Foliage"
      guard: "Tree_Guard"
    fallbackColor: 0xeab308

  - id: "guardrail"
    path: "/models/guardrail.glb"
    scale: [1.0, 1.0, 1.0]
    offset: [0.0, 0.0, 0.0]
    subparts:
      wbeam: "Guardrail_WBeam"
      sleeveEnds: "Guardrail_Sleeve_Ends"
      posts: "Guardrail_Posts"
      bracketsBolts: "Guardrail_Brackets_Bolts"
      delineators: "Guardrail_Delineators"
    fallbackColor: 0xf1f5f9

  - id: "shibuya_stream"
    path: "/models/shibuya_stream.glb"
    scale: [1.0, 1.0, 1.0]
    offset: [-695.0, 0.0, -15.0]
    subparts:
      highRise: "ShibuyaStream_HighRise"
      midVoid: "ShibuyaStream_MidVoid"
      podium: "ShibuyaStream_Podium"
      signage: "ShibuyaStream_Signage"
      shutokoViaduct: "ShutokoRoute3_Viaduct"
      scrambleSquare: "ShibuyaScrambleSquare_Tower"
      hikarie: "ShibuyaHikarie_Tower"
      pedestrianDeck: "ShibuyaEastPedestrianDeck"
      sakuraStage: "ShibuyaSakuraStage_Tower"
      fukuras: "ShibuyaFukuras_Tower"
      miyashitaPark: "ShibuyaMiyashitaPark_Complex"
      qfront109: "ShibuyaQfront109_Complex"
      magnet: "ShibuyaMagnet_Tower"
      markCity: "ShibuyaMarkCity_Complex"
      toeiBic: "ShibuyaToeiBic_Tower"
    fallbackColor: 0xe2e8f0

  - id: "shibuya_plateau_buildings"
    path: "/models/shibuya_plateau_buildings.glb"
    scale: [1.0, 1.0, 1.0]
    offset: [0.0, 0.0, 0.0]
    subparts:
      city: "ShibuyaPlateauCity"
    fallbackColor: 0x334155

textures3d:
  - id: "asphalt_3d"
    resolution: 64
    type: "asphalt_pbr"
    roughnessScale: 1.0

  - id: "foliage_bark_3d"
    resolution: 32
    type: "foliage_bark"
    roughnessScale: 0.9

  - id: "architecture_3d"
    resolution: 32
    type: "architecture_stone"
    roughnessScale: 0.85

  - id: "volumetric_fog_3d"
    resolution: 32
    type: "volumetric_fog"
    roughnessScale: 0.5

  - id: "volumetric_cloud_3d"
    resolution: 32
    type: "volumetric_cloud"
    roughnessScale: 0.6

  - id: "crown_interior_3d"
    resolution: 32
    type: "crown_interior"
    roughnessScale: 0.75

  - id: "road_marking_prop_3d"
    resolution: 32
    type: "road_marking_prop"
    roughnessScale: 0.8

  - id: "vehicle_exterior_3d"
    resolution: 32
    type: "vehicle_exterior"
    roughnessScale: 0.7

  - id: "water_caustics_3d"
    resolution: 32
    type: "water_caustics"
    roughnessScale: 0.4

roads:
  - id: "gyoko_dori"
    name: "行幸通り (Gyoko-dori Ave)"
    center: [0.0, 0.0, -10.0]
    length: 160.0
    width: 24.0
    lanes: 4
    speedLimit: 40
    hasSidewalk: true
    sidewalkWidth: 4.0
    hasMedian: true
    markings:
      centerLineType: "solid_white"
      hasCrosswalks: true
      hasTactilePaving: true
      hasShoulderLines: true
    props:
      hasGuardrails: true
      hasManholes: true
      hasGratings: true
      hasTrafficLights: true

  - id: "marunouchi_chuo"
    name: "丸の内中央通り (Marunouchi Chuo-dori)"
    center: [-25.0, 0.0, 15.0]
    length: 100.0
    width: 14.0
    lanes: 2
    speedLimit: 30
    hasSidewalk: true
    sidewalkWidth: 3.0
    hasMedian: false
    markings:
      centerLineType: "solid_yellow"
      hasCrosswalks: true
      hasTactilePaving: true
      hasShoulderLines: true
    props:
      hasGuardrails: true
      hasManholes: true
      hasGratings: true
      hasTrafficLights: true

  - id: "hibiya_dori"
    name: "日比谷通り (Hibiya-dori Ave)"
    center: [25.0, 0.0, 15.0]
    length: 100.0
    width: 18.0
    lanes: 4
    speedLimit: 50
    hasSidewalk: true
    sidewalkWidth: 3.5
    hasMedian: true
    markings:
      centerLineType: "solid_white"
      hasCrosswalks: true
      hasTactilePaving: true
      hasShoulderLines: true
    props:
      hasGuardrails: true
      hasManholes: true
      hasGratings: true
      hasTrafficLights: true

  - id: "meiji_dori_shibuya"
    name: "明治通り (Meiji-dori Ave - Shibuya)"
    center: [-750.0, 0.0, 0.0]
    length: 360.0
    width: 22.0
    lanes: 4
    speedLimit: 50
    hasSidewalk: true
    sidewalkWidth: 4.5
    hasMedian: true
    markings:
      centerLineType: "solid_white"
      hasCrosswalks: true
      hasTactilePaving: true
      hasShoulderLines: true
    props:
      hasGuardrails: true
      hasManholes: true
      hasGratings: true
      hasTrafficLights: true

  - id: "route_246_shibuya"
    name: "国道246号・青山通り (Route 246 / Aoyama-dori)"
    center: [-375.0, 0.0, 95.0]
    length: 750.0
    width: 24.0
    lanes: 4
    speedLimit: 50
    hasSidewalk: true
    sidewalkWidth: 4.0
    hasMedian: true
    markings:
      centerLineType: "solid_white"
      hasCrosswalks: true
      hasTactilePaving: true
      hasShoulderLines: true
    props:
      hasGuardrails: true
      hasManholes: true
      hasGratings: true
      hasTrafficLights: true

signs:
  - id: "overhead_guide_gyoko"
    type: "overhead_guide"
    position: [0.0, 0.0, 58.0]
    rotationY: 3.14159
    label: "皇居外苑 内堀通り"
    subLabel: "Kokyo Gaien / Uchibori-dori"
    arrowDirections: ["直進", "左折"]

  - id: "overhead_guide_wadakura"
    type: "overhead_guide"
    position: [0.0, 0.0, 200.0]
    rotationY: 3.14159
    label: "日比谷 霞が関"
    subLabel: "Hibiya / Kasumigaseki"
    arrowDirections: ["左折", "右折"]

  - id: "speed_limit_gyoko"
    type: "speed_limit"
    position: [9.3, 0.0, 45.0]
    rotationY: 3.14159
    speedLimit: 40
    auxiliaryText: "終日"

  - id: "no_parking_gyoko_left"
    type: "no_parking"
    position: [9.3, 0.0, 106.0]
    rotationY: 3.14159
    auxiliaryText: "終日"

  - id: "no_stopping_gyoko_right"
    type: "no_stopping"
    position: [9.3, 0.0, 116.0]
    rotationY: 3.14159
    auxiliaryText: "ここまで"

  - id: "lane_direction_gyoko"
    type: "lane_direction"
    position: [9.5, 0.0, 77.0]
    rotationY: 3.14159

  - id: "intersection_name_gyoko"
    type: "intersection_name"
    position: [9.5, 0.0, 126.0]
    rotationY: 3.14159
    label: "丸の内仲通り"
    subLabel: "Marunouchi Naka-dori"

  - id: "no_uturn_gyoko"
    type: "no_uturn"
    position: [9.3, 0.0, 145.0]
    rotationY: 3.14159
    auxiliaryText: "終日"

  - id: "one_way_marunouchi"
    type: "one_way"
    position: [11.2, 0.0, 98.0]
    rotationY: 3.14159
    auxiliaryText: "自転車を除く"

  - id: "delineator_median_south"
    type: "delineator"
    position: [9.3, 0.0, 38.0]
    rotationY: 3.14159

  - id: "delineator_median_north"
    type: "delineator"
    position: [9.3, 0.0, 96.0]
    rotationY: 3.14159

  - id: "stop_marunouchi_entry"
    type: "stop"
    position: [-15.5, 0.0, -0.5]
    rotationY: -1.5708

  - id: "no_entry_plaza"
    type: "no_entry"
    position: [-9.5, 0.0, 21.0]
    rotationY: 0.0

  - id: "direction_mandatory_hibiya"
    type: "direction_mandatory"
    position: [9.3, 0.0, 188.0]
    rotationY: 3.14159
    arrowDirections: ["左折", "直進"]

  - id: "traffic_light_ahead_gyoko"
    type: "traffic_light_ahead"
    position: [9.3, 0.0, 67.0]
    rotationY: 3.14159

  - id: "crosswalk_station_front"
    type: "crosswalk"
    position: [9.3, 0.0, 86.5]
    rotationY: 3.14159

  - id: "street_name_gyoko"
    type: "street_name"
    position: [9.5, 0.0, 32.0]
    rotationY: 3.14159
    label: "行幸通り"
    subLabel: "Gyoko-dori Ave."

  - id: "intersection_name_wadakura"
    type: "intersection_name"
    position: [9.5, 0.0, 216.0]
    rotationY: 3.14159
    label: "和田倉門"
    subLabel: "Wadakuramon"

  - id: "overhead_guide_shibuya_stream"
    type: "overhead_guide"
    position: [-750.0, 0.0, 35.0]
    rotationY: 3.14159
    supportType: "portal"
    spanWidth: 26.6
    label: "宮益坂下・原宿"
    subLabel: "Miyamasuzaka / Harajuku"
    leftLabel: "青山・六本木"
    leftSubLabel: "Aoyama / Roppongi"
    rightLabel: "三軒茶屋・道玄坂"
    rightSubLabel: "Sangenjaya / Dogenzaka"
    roadNumber: "246"
    subRoadNumber: "305"
    intersectionName: "渋谷ストリーム前"
    arrowDirections: ["直進", "左折", "右折"]

  - id: "intersection_name_shibuya_stream"
    type: "intersection_name"
    position: [-736.2, 0.0, 38.0]
    rotationY: 3.14159
    label: "渋谷ストリーム前"
    subLabel: "Shibuya Stream"

  - id: "lane_direction_meiji_dori"
    type: "lane_direction"
    position: [-736.2, 0.0, 18.0]
    rotationY: 3.14159
    arrowDirections: ["直進・左折", "直進", "右折"]

  - id: "street_name_meiji_dori"
    type: "street_name"
    position: [-736.2, 0.0, 58.0]
    rotationY: 3.14159
    label: "明治通り"
    subLabel: "Meiji-dori Ave."

  - id: "speed_limit_meiji_dori"
    type: "speed_limit"
    position: [-736.2, 0.0, 48.0]
    rotationY: 3.14159
    speedLimit: 50
    auxiliaryText: "終日"

  - id: "overhead_guide_shibuya_246_shutoko"
    type: "overhead_guide"
    position: [-750.0, 0.0, 62.0]
    rotationY: 3.14159
    supportType: "portal"
    spanWidth: 26.6
    label: "原宿・新宿"
    subLabel: "Harajuku / Shinjuku"
    leftLabel: "青山一丁目・赤坂"
    leftSubLabel: "Aoyama / Akasaka"
    rightLabel: "三軒茶屋・渋谷駅西口"
    rightSubLabel: "Sangenjaya / Shibuya W."
    roadNumber: "246"
    subRoadNumber: "305"
    intersectionName: "渋谷駅東口"
    arrowDirections: ["左折", "直進", "右折"]

  - id: "overhead_guide_shibuya_miyamasu"
    type: "overhead_guide"
    position: [-620.0, 0.0, 253.4]
    rotationY: 1.5708
    supportType: "cantilever"
    spanWidth: 19.2
    label: "道玄坂・スクランブル"
    subLabel: "Dogenzaka / Scramble"
    leftLabel: "原宿・新宿"
    leftSubLabel: "Harajuku / Shinjuku"
    rightLabel: "恵比寿・渋谷駅"
    rightSubLabel: "Ebisu / Shibuya Sta."
    roadNumber: "305"
    subRoadNumber: "413"
    intersectionName: "宮益坂下"
    arrowDirections: ["直進", "左折", "右折"]

  - id: "overhead_guide_shibuya_dogenzaka"
    type: "overhead_guide"
    position: [-925.5, 0.0, 215.5]
    rotationY: 1.25
    supportType: "cantilever"
    spanWidth: 12.4
    label: "三軒茶屋・世田谷"
    subLabel: "Sangenjaya / Setagaya"
    leftLabel: "玉川通り・池尻"
    leftSubLabel: "Tamagawa-dori / Rte 246"
    rightLabel: "神泉・駒場"
    rightSubLabel: "Shinsen / Komaba"
    roadNumber: "246"
    subRoadNumber: "413"
    intersectionName: "道玄坂上"
    arrowDirections: ["直進", "左折", "右折"]

  - id: "overhead_guide_shibuya_meiji_north"
    type: "overhead_guide"
    position: [-746.6, 0.0, 295.0]
    rotationY: 3.1416
    supportType: "cantilever"
    spanWidth: 16.0
    label: "原宿・新宿"
    subLabel: "Harajuku / Shinjuku"
    leftLabel: "表参道・青山"
    leftSubLabel: "Omotesando / Aoyama"
    rightLabel: "公園通り・代々木"
    rightSubLabel: "Koen-dori / Yoyogi"
    roadNumber: "305"
    subRoadNumber: "413"
    intersectionName: "宮下公園前"
    arrowDirections: ["直進", "左折", "右折"]

weatherPresets:
  - id: "sunset"
    name: "夕暮れの丸の内 (Sunset Golden Hour)"
    sunPosition: [4.0, 42.0, 180.0]
    sunColor: 0xff9944
    ambientColor: 0xfdba74
    skyColor: 0x4c1d95
    fogDensity: 0.002
    fogColor: 0xfb923c
    rain:
      enabled: false
      intensity: 0.0
      wiperSpeed: 0.0
      windshieldWetness: 0.0
    lensflare:
      enabled: true
      intensity: 0.18
      color: 0xffbb66

  - id: "clear"
    name: "晴天 (Clear Daylight)"
    sunPosition: [-5.0, 52.0, 180.0]
    sunColor: 0xfffaed
    ambientColor: 0x93c5fd
    skyColor: 0x0284c7
    fogDensity: 0.0012
    fogColor: 0xbae6fd
    rain:
      enabled: false
      intensity: 0.0
      wiperSpeed: 0.0
      windshieldWetness: 0.0
    lensflare:
      enabled: true
      intensity: 0.14
      color: 0xfffaee

  - id: "rain"
    name: "雨の東京駅 (Rainy Reflection)"
    sunPosition: [-5.0, 48.0, 180.0]
    sunColor: 0x94a3b8
    ambientColor: 0x64748b
    skyColor: 0x1e293b
    fogDensity: 0.008
    fogColor: 0x475569
    rain:
      enabled: true
      intensity: 0.85
      wiperSpeed: 1.2
      windshieldWetness: 0.9
    lensflare:
      enabled: false
      intensity: 0.0
      color: 0x8899aa

  - id: "night"
    name: "夜景 (Tokyo Station Night Lights)"
    sunPosition: [3.0, 48.0, 180.0]
    sunColor: 0x93c5fd
    ambientColor: 0x1e293b
    skyColor: 0x020617
    fogDensity: 0.0035
    fogColor: 0x0f172a
    rain:
      enabled: false
      intensity: 0.0
      wiperSpeed: 0.0
      windshieldWetness: 0.0
    lensflare:
      enabled: false
      intensity: 0.0
      color: 0x4466aa

defaultWeather: "sunset"
`;

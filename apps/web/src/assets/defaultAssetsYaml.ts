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
    offset: [0.0, 0.0, -80.0]
    subparts:
      mainBuilding: "TokyoStation_Main"
      northDome: "Dome_North"
      southDome: "Dome_South"
    fallbackColor: 0x8b3a2b

textures3d:
  - id: "asphalt_3d"
    resolution: 32
    type: "asphalt_pbr"
    roughnessScale: 1.0

  - id: "volumetric_fog_3d"
    resolution: 32
    type: "volumetric_fog"
    roughnessScale: 0.5

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
      centerLineType: "solid_yellow"
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
      centerLineType: "dashed_white"
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
      centerLineType: "solid_yellow"
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
    position: [0.0, 0.0, -45.0]
    rotationY: 0.0
    label: "大手町 皇居外苑"
    subLabel: "Otemachi / Kokyo Gaien"
    arrowDirections: ["直進", "左折"]

  - id: "speed_limit_gyoko"
    type: "speed_limit"
    position: [13.0, 0.0, -20.0]
    rotationY: 3.14159
    speedLimit: 40

  - id: "stop_marunouchi_entry"
    type: "stop"
    position: [-18.0, 0.0, 2.0]
    rotationY: 1.5708

  - id: "no_entry_plaza"
    type: "no_entry"
    position: [0.0, 0.0, -70.0]
    rotationY: 0.0

  - id: "direction_mandatory_hibiya"
    type: "direction_mandatory"
    position: [18.0, 0.0, 2.0]
    rotationY: -1.5708
    arrowDirections: ["左折", "直進"]

  - id: "traffic_light_ahead_gyoko"
    type: "traffic_light_ahead"
    position: [-13.0, 0.0, 10.0]
    rotationY: 0.0

  - id: "crosswalk_station_front"
    type: "crosswalk"
    position: [13.0, 0.0, -50.0]
    rotationY: 3.14159

  - id: "street_name_gyoko"
    type: "street_name"
    position: [-13.0, 0.0, -35.0]
    rotationY: 1.5708
    label: "行幸通り"
    subLabel: "Gyoko-dori Ave."

weatherPresets:
  - id: "sunset"
    name: "夕暮れの丸の内 (Sunset Golden Hour)"
    sunPosition: [120.0, 35.0, -80.0]
    sunColor: 0xff8844
    ambientColor: 0x442233
    skyColor: 0x221122
    fogDensity: 0.003
    fogColor: 0xffaa77
    rain:
      enabled: false
      intensity: 0.0
      wiperSpeed: 0.0
      windshieldWetness: 0.0
    lensflare:
      enabled: true
      intensity: 1.2
      color: 0xffbb66

  - id: "clear"
    name: "晴天 (Clear Daylight)"
    sunPosition: [80.0, 120.0, -40.0]
    sunColor: 0xffffff
    ambientColor: 0x334455
    skyColor: 0x112233
    fogDensity: 0.001
    fogColor: 0xcceeff
    rain:
      enabled: false
      intensity: 0.0
      wiperSpeed: 0.0
      windshieldWetness: 0.0
    lensflare:
      enabled: true
      intensity: 0.8
      color: 0xfffaee

  - id: "rain"
    name: "雨の東京駅 (Rainy Reflection)"
    sunPosition: [50.0, 60.0, -30.0]
    sunColor: 0x667788
    ambientColor: 0x222a33
    skyColor: 0x111620
    fogDensity: 0.012
    fogColor: 0x334455
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
    sunPosition: [0.0, -50.0, 0.0]
    sunColor: 0x112244
    ambientColor: 0x080c18
    skyColor: 0x02040a
    fogDensity: 0.004
    fogColor: 0x050a14
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

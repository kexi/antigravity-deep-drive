export type TimeOfDay = "morning" | "day" | "sunset" | "night";
export type WeatherCondition = "clear" | "cloudy" | "rain";
export type RoadSurfaceCondition = "dry" | "wet" | "puddle";
// Why not: 既存のYAMLプリセットや単体テストとの後方互換性を保ちつつ、純粋な天候(WeatherCondition)と時間帯(TimeOfDay)を分離する
export type WeatherType = WeatherCondition | "sunset" | "night";
export type CameraMode = "cockpit" | "chase";
export type WiperMode = "off" | "slow" | "fast";
/**
 * ウインカー（方向指示器）・非常点滅表示灯（ハザード）の状態
 * - `off`: 消灯
 * - `left`: 左ウインカー点滅 (`Q`)
 * - `right`: 右ウインカー点滅 (`E`)
 * - `hazard`: ハザードランプ（左右同時点滅 `Z`）
 */
export type TurnSignalState = "off" | "left" | "right" | "hazard";
export type GraphicsQuality = "high" | "medium" | "low";

export type GazePreset =
  | "forward"
  | "right_mirror"
  | "left_mirror"
  | "rearview_mirror"
  | "dashboard"
  | "right_shoulder"
  | "left_shoulder"
  | "free";

export interface GazeState {
  preset: GazePreset;
  label: string;
  yawRad: number;
  pitchRad: number;
  targetYawRad: number;
  targetPitchRad: number;
  headOffsetLocal: { x: number; y: number; z: number };
}

export interface VehicleInput {
  throttle: number; // 0 to 1
  brake: number; // 0 to 1
  steer: number; // -1 (left) to 1 (right)
  handbrake: boolean;
}

export interface WheelTelemetry {
  suspensionLength: number;
  inContact: boolean;
  rotation: number;
  steering: number;
  /** 各輪の鉛直サスペンション反力（接地荷重）[N] */
  suspensionForce?: number;
}

export interface VehicleState {
  speedKmh: number;
  engineRpm: number;
  gear: string;
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
  velocity: { x: number; y: number; z: number };
  headingAngle: number;
  steeringAngle: number;
  pitchAngle: number;
  rollAngle: number;
  wheels: WheelTelemetry[];
  turnSignal?: TurnSignalState;
  /** 車体前後加速度 [G]（加速=正 / 制動=負） */
  longitudinalG?: number;
  /** 車体横加速度 [G]（右旋回遠心力=+X方向=正） */
  lateralG?: number;
  /** 車両総質量 [kg] */
  massKg?: number;
  /** 静的平衡時のサスペンション基準長 [m] */
  equilibriumSuspensionLength?: number;
  /** 物理タイヤ半径 [m] */
  wheelRadius?: number;
}

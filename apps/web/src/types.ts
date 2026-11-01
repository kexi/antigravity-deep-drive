export type WeatherType = "clear" | "sunset" | "rain" | "night";
export type CameraMode = "cockpit" | "chase";
export type WiperMode = "off" | "slow" | "fast";

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
}

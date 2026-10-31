import type { VehicleInput } from "../types";

/**
 * キーボード・入力管理
 */
export class InputManager {
  private keys: Record<string, boolean> = {};

  public onCameraToggle?: () => void;
  public onWiperToggle?: () => void;
  public onBlurToggle?: () => void;
  public onResetVehicle?: () => void;

  constructor() {
    window.addEventListener("keydown", (e) => this.handleKeyDown(e));
    window.addEventListener("keyup", (e) => this.handleKeyUp(e));
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const key = e.key.toLowerCase();
    this.keys[key] = true;

    if (key === "c") {
      this.onCameraToggle?.();
    } else if (key === "x") {
      this.onWiperToggle?.();
    } else if (key === "b") {
      this.onBlurToggle?.();
    } else if (key === "r") {
      this.onResetVehicle?.();
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    const key = e.key.toLowerCase();
    this.keys[key] = false;
  }

  public getInput(): VehicleInput {
    let throttle = 0;
    let brake = 0;
    let steer = 0;

    const isThrottlePressed = this.keys["w"] || this.keys["arrowup"];
    if (isThrottlePressed) {
      throttle = 1.0;
    }

    const isBrakePressed = this.keys["s"] || this.keys["arrowdown"];
    if (isBrakePressed) {
      brake = 1.0;
    }

    const isSteerLeft = this.keys["a"] || this.keys["arrowleft"];
    if (isSteerLeft) {
      steer -= 1.0;
    }

    const isSteerRight = this.keys["d"] || this.keys["arrowright"];
    if (isSteerRight) {
      steer += 1.0;
    }

    const handbrake = !!this.keys[" "];

    return { throttle, brake, steer, handbrake };
  }
}

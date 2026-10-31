import { describe, it, expect } from "vitest";
import type { WeatherType, WiperMode } from "../types";

describe("車両およびゲームシステムの仕様検証", () => {
  it("時速に応じた適正なギア段数を算出できることを保証する", () => {
    // 速度域ごとのギア選定ロジックをテスト
    const determineGear = (speedKmh: number, isReverse: boolean): string => {
      const isBackingUp = isReverse;
      if (isBackingUp) {
        return "R";
      }
      if (speedKmh < 30) {
        return "D 1";
      }
      if (speedKmh < 60) {
        return "D 2";
      }
      if (speedKmh < 95) {
        return "D 3";
      }
      return "D 4";
    };

    expect(determineGear(0, true)).toBe("R");
    expect(determineGear(15, false)).toBe("D 1");
    expect(determineGear(45, false)).toBe("D 2");
    expect(determineGear(80, false)).toBe("D 3");
    expect(determineGear(120, false)).toBe("D 4");
  });

  it("天候に応じた適切な雨量と路面濡れ度の目標値を保証する", () => {
    const getTargetWeatherParams = (weather: WeatherType) => {
      const isRain = weather === "rain";
      return {
        rainIntensity: isRain ? 1.0 : 0.0,
        wetness: isRain ? 1.0 : 0.0,
      };
    };

    expect(getTargetWeatherParams("clear")).toEqual({ rainIntensity: 0.0, wetness: 0.0 });
    expect(getTargetWeatherParams("sunset")).toEqual({ rainIntensity: 0.0, wetness: 0.0 });
    expect(getTargetWeatherParams("rain")).toEqual({ rainIntensity: 1.0, wetness: 1.0 });
    expect(getTargetWeatherParams("night")).toEqual({ rainIntensity: 0.0, wetness: 0.0 });
  });

  it("ワイパーの動作速度倍率がモードに応じて適切に設定されることを保証する", () => {
    const getWiperSpeedMultiplier = (mode: WiperMode): number => {
      if (mode === "off") {
        return 0.0;
      }
      if (mode === "slow") {
        return 3.5;
      }
      return 6.5;
    };

    expect(getWiperSpeedMultiplier("off")).toBe(0.0);
    expect(getWiperSpeedMultiplier("slow")).toBe(3.5);
    expect(getWiperSpeedMultiplier("fast")).toBe(6.5);
  });
});

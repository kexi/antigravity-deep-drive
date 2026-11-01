import { describe, it, expect } from "vitest";
import { AssetManager } from "../assets/assetManager";
import { DEFAULT_ASSETS_YAML } from "../assets/defaultAssetsYaml";

describe("AssetManager - YAML Asset Manifest & Zod Validation", () => {
  it("YAMLマニフェストを正しくパースし、Zodスキーマに適合することを保証する", () => {
    const manager = new AssetManager();
    const manifest = manager.loadFromYamlString(DEFAULT_ASSETS_YAML);

    expect(manifest.version).toBe("1.0.0");
    expect(manifest.models.length).toBeGreaterThanOrEqual(2);
    expect(manifest.roads.length).toBeGreaterThanOrEqual(3);
    expect(manifest.signs.length).toBeGreaterThanOrEqual(8);
    expect(manifest.weatherPresets.length).toBeGreaterThanOrEqual(4);
  });

  it("不正な形式のYAMLやスキーマ違反のデータに対してバリデーションエラーを投げることを保証する", () => {
    const manager = new AssetManager();
    const invalidYaml = `
version: "1.0.0"
models:
  - id: "broken_model"
    # path is missing
    scale: [1, 1] # length must be 3
`;

    const throwsError = () => {
      manager.loadFromYamlString(invalidYaml);
    };

    expect(throwsError).toThrow();
  });

  it("東京駅と車両のモデル設定を正しく取得できることを保証する", () => {
    const manager = new AssetManager();
    manager.loadFromYamlString(DEFAULT_ASSETS_YAML);

    const car = manager.getModelConfig("car");
    const isCarValid = car !== undefined && car.path === "/models/car.glb";
    expect(isCarValid).toBe(true);
    expect(car?.subparts?.windshield).toBe("Windshield_Glass");

    const tokyoStation = manager.getModelConfig("tokyo_station");
    const isStationValid =
      tokyoStation !== undefined && tokyoStation.path === "/models/tokyo_station.glb";
    expect(isStationValid).toBe(true);
  });

  it("行幸通りなどの日本の道路設定と標識配置を正確に取得できることを保証する", () => {
    const manager = new AssetManager();
    manager.loadFromYamlString(DEFAULT_ASSETS_YAML);

    const gyoko = manager.getRoad("gyoko_dori");
    const isGyokoFound = gyoko !== undefined;
    expect(isGyokoFound).toBe(true);
    expect(gyoko?.width).toBe(24.0);
    expect(gyoko?.lanes).toBe(4);
    expect(gyoko?.markings.centerLineType).toBe("solid_yellow");

    const signs = manager.getSigns();
    const hasOverheadSign = signs.some((sign) => sign.type === "overhead_guide");
    const hasStopSign = signs.some((sign) => sign.type === "stop");
    const hasSpeedSign = signs.some((sign) => sign.type === "speed_limit");
    const hasNoParkingSign = signs.some((sign) => sign.type === "no_parking");
    const hasLaneDirectionSign = signs.some((sign) => sign.type === "lane_direction");
    const hasIntersectionNameSign = signs.some((sign) => sign.type === "intersection_name");
    expect(hasOverheadSign).toBe(true);
    expect(hasStopSign).toBe(true);
    expect(hasSpeedSign).toBe(true);
    expect(hasNoParkingSign).toBe(true);
    expect(hasLaneDirectionSign).toBe(true);
    expect(hasIntersectionNameSign).toBe(true);
  });

  it("3Dテクスチャの生成とキャッシュ管理が機能することを保証する", () => {
    const manager = new AssetManager();
    manager.loadFromYamlString(DEFAULT_ASSETS_YAML);

    const tex1 = manager.getOrCreate3DTexture("asphalt_3d");
    const tex2 = manager.getOrCreate3DTexture("asphalt_3d");

    expect(tex1).toBeDefined();
    expect(tex1).toBe(tex2); // キャッシュされた同一インスタンスであることを検証
  });

  it("デフォルト天候（夕暮れ）および天候プリセットを正常に取得できることを保証する", () => {
    const manager = new AssetManager();
    manager.loadFromYamlString(DEFAULT_ASSETS_YAML);

    const defaultWeather = manager.getDefaultWeather();
    expect(defaultWeather.id).toBe("sunset");
    expect(defaultWeather.lensflare.enabled).toBe(true);

    const rainWeather = manager.getWeatherPreset("rain");
    expect(rainWeather?.rain.enabled).toBe(true);
    expect(rainWeather?.rain.intensity).toBeGreaterThan(0.5);
  });

  it("resolveAssetUrlがベースパスに基づき相対・絶対パスを適切に正規化することを保証する", () => {
    const manager = new AssetManager();

    // 1. 完全なHTTP/HTTPS URLは変更されないことを保証
    const httpUrl = "https://example.com/models/car.glb";
    expect(manager.resolveAssetUrl(httpUrl)).toBe(httpUrl);

    // 2. 先頭スラッシュの有無に関わらずベースパスが適切に付与されることを保証
    const resolvedSlash = manager.resolveAssetUrl("/config/assets.yml");
    const resolvedNoSlash = manager.resolveAssetUrl("config/assets.yml");
    expect(resolvedSlash).toBe(resolvedNoSlash);
    expect(resolvedSlash.endsWith("config/assets.yml")).toBe(true);
  });
});

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

    const shibuyaStream = manager.getModelConfig("shibuya_stream");
    const isShibuyaStreamValid =
      shibuyaStream !== undefined && shibuyaStream.path === "/models/shibuya_stream.glb";
    expect(isShibuyaStreamValid).toBe(true);
    expect(shibuyaStream?.subparts?.highRise).toBe("ShibuyaStream_HighRise");
    expect(shibuyaStream?.subparts?.midVoid).toBe("ShibuyaStream_MidVoid");
    expect(shibuyaStream?.subparts?.podium).toBe("ShibuyaStream_Podium");
    expect(shibuyaStream?.subparts?.signage).toBe("ShibuyaStream_Signage");

    const guardrail = manager.getModelConfig("guardrail");
    const isGuardrailValid = guardrail !== undefined && guardrail.path === "/models/guardrail.glb";
    expect(isGuardrailValid).toBe(true);
    expect(guardrail?.subparts?.wbeam).toBe("Guardrail_WBeam");
    expect(guardrail?.subparts?.sleeveEnds).toBe("Guardrail_Sleeve_Ends");
    expect(guardrail?.subparts?.posts).toBe("Guardrail_Posts");
    expect(guardrail?.subparts?.bracketsBolts).toBe("Guardrail_Brackets_Bolts");
    expect(guardrail?.subparts?.delineators).toBe("Guardrail_Delineators");
  });

  it("行幸通りや明治通り（渋谷ストリーム前）などの日本の道路設定と標識配置を正確に取得できることを保証する", () => {
    const manager = new AssetManager();
    manager.loadFromYamlString(DEFAULT_ASSETS_YAML);

    const gyoko = manager.getRoad("gyoko_dori");
    const isGyokoFound = gyoko !== undefined;
    expect(isGyokoFound).toBe(true);
    expect(gyoko?.width).toBe(24.0);
    expect(gyoko?.lanes).toBe(4);
    // 道路交通法第17条第4項・警察庁交通規制基準に基づき、4車線（片側2車線以上）道路の中央線は白実線（solid_white）であること
    expect(gyoko?.markings.centerLineType).toBe("solid_white");

    const marunouchiChuo = manager.getRoad("marunouchi_chuo");
    expect(marunouchiChuo?.lanes).toBe(2);
    expect(marunouchiChuo?.markings.centerLineType).toBe("solid_yellow");

    const meiji = manager.getRoad("meiji_dori_shibuya");
    const isMeijiFound = meiji !== undefined;
    expect(isMeijiFound).toBe(true);
    expect(meiji?.width).toBe(22.0);
    expect(meiji?.lanes).toBe(4);
    expect(meiji?.markings.centerLineType).toBe("solid_white");

    const signs = manager.getSigns();
    const hasOverheadSign = signs.some((sign) => sign.type === "overhead_guide");
    const shibuyaStreamOverhead = signs.find((sign) => sign.id === "overhead_guide_shibuya_stream");
    const shibuyaSinglePoleSigns = signs.filter((sign) =>
      [
        "intersection_name_shibuya_stream",
        "street_name_meiji_dori",
        "speed_limit_meiji_dori",
      ].includes(sign.id),
    );
    const hasStopSign = signs.some((sign) => sign.type === "stop");
    const hasSpeedSign = signs.some((sign) => sign.type === "speed_limit");
    const hasNoParkingSign = signs.some((sign) => sign.type === "no_parking");
    const hasLaneDirectionSign = signs.some((sign) => sign.type === "lane_direction");
    const hasIntersectionNameSign = signs.some((sign) => sign.type === "intersection_name");
    expect(hasOverheadSign).toBe(true);
    expect(shibuyaStreamOverhead).toBeDefined();
    expect(shibuyaStreamOverhead?.rotationY).toBeCloseTo(3.14159, 4);
    expect(shibuyaSinglePoleSigns.length).toBe(3);
    for (const s of shibuyaSinglePoleSigns) {
      expect(s.rotationY).toBeCloseTo(3.14159, 4);
      // 明治通り北行き (+Z) の左側歩道 (x = -750 + 12.8 = -737.2, 車道東端 -738.0 の外側) に建つこと
      expect(s.position[0]).toBeCloseTo(-737.2, 2);
    }
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

  it("getManifestSummaryが全アセット数および3Dボリュームテクスチャの推定VRAMバイト数を正確に算出することを保証する", () => {
    const manager = new AssetManager();
    manager.loadFromYamlString(DEFAULT_ASSETS_YAML);

    const summary = manager.getManifestSummary();
    expect(summary.version).toBe("1.0.0");
    expect(summary.modelsCount).toBeGreaterThanOrEqual(4);
    expect(summary.textures3dCount).toBeGreaterThanOrEqual(3);
    expect(summary.roadsCount).toBeGreaterThanOrEqual(3);
    expect(summary.signsCount).toBeGreaterThanOrEqual(8);
    expect(summary.weatherPresetsCount).toBeGreaterThanOrEqual(4);
    expect(summary.totalAssetsCount).toBe(
      summary.modelsCount +
        summary.textures3dCount +
        summary.roadsCount +
        summary.signsCount +
        summary.weatherPresetsCount,
    );
    expect(summary.estimated3DTextureVramBytes).toBeGreaterThan(0);
  });

  it("validateYamlStringが正常なYAMLと不正なYAMLの両方を非例外で検査結果を返すことを保証する", () => {
    const manager = new AssetManager();

    const validRes = manager.validateYamlString(DEFAULT_ASSETS_YAML);
    expect(validRes.valid).toBe(true);
    expect(validRes.errors).toEqual([]);
    expect(validRes.manifest?.version).toBe("1.0.0");

    const invalidRes = manager.validateYamlString("version: 123\nmodels: 'not_an_array'");
    expect(invalidRes.valid).toBe(false);
    expect(invalidRes.errors.length).toBeGreaterThan(0);
  });

  it("各カテゴリ（models, textures3d, roads, signs, weatherPresets）の更新・追加・削除・YAML出力・リセットが正しく動作することを保証する", () => {
    const manager = new AssetManager();
    manager.loadFromYamlString(DEFAULT_ASSETS_YAML);

    const events: string[] = [];
    const unsubscribe = manager.onChange((event) => {
      events.push(event.type);
    });

    // 1. Model update
    const updatedCar = manager.updateModelConfig("car", { scale: [1.1, 1.1, 1.1] });
    expect(updatedCar.scale).toEqual([1.1, 1.1, 1.1]);
    expect(manager.getModelConfig("car")?.scale).toEqual([1.1, 1.1, 1.1]);

    // 2. Texture3D update & cache regeneration
    const beforeTex = manager.getOrCreate3DTexture("asphalt_3d");
    const updatedTexCfg = manager.updateTexture3DConfig("asphalt_3d", {
      resolution: 48,
      roughnessScale: 2.5,
    });
    expect(updatedTexCfg.resolution).toBe(48);
    expect(updatedTexCfg.roughnessScale).toBe(2.5);
    const afterTex = manager.getOrCreate3DTexture("asphalt_3d");
    expect(afterTex).not.toBe(beforeTex);

    // 3. Road update
    const updatedRoad = manager.updateRoadConfig("gyoko_dori", { width: 28.0, speedLimit: 50 });
    expect(updatedRoad.width).toBe(28.0);
    expect(updatedRoad.speedLimit).toBe(50);

    // 4. Sign upsert & remove
    const customSign = manager.upsertSign({
      id: "test_custom_sign_99",
      type: "stop",
      position: [10, 0, 20],
      rotationY: 1.57,
      label: "止まれ",
    });
    expect(customSign.id).toBe("test_custom_sign_99");
    expect(manager.getSign("test_custom_sign_99")?.rotationY).toBe(1.57);
    expect(manager.removeSign("test_custom_sign_99")).toBe(true);
    expect(manager.getSign("test_custom_sign_99")).toBeUndefined();
    expect(manager.removeSign("non_existent_sign")).toBe(false);

    // 5. WeatherPreset update
    const updatedWeather = manager.updateWeatherPreset("sunset", { fogDensity: 0.0055 });
    expect(updatedWeather.fogDensity).toBe(0.0055);

    // 6. YAML round-trip
    const exportedYaml = manager.toYamlString();
    expect(exportedYaml).toContain("gyoko_dori");
    const roundTripCheck = manager.validateYamlString(exportedYaml);
    expect(roundTripCheck.valid).toBe(true);

    // 7. Reset to default
    manager.resetToDefault();
    expect(manager.getModelConfig("car")?.scale).toEqual([1, 1, 1]);
    expect(manager.getRoad("gyoko_dori")?.width).toBe(24.0);

    expect(events).toEqual([
      "model.update",
      "texture3d.update",
      "road.update",
      "sign.upsert",
      "sign.remove",
      "weatherPreset.update",
      "manifest.reset",
    ]);
    unsubscribe();
  });

  it("3DテクスチャのroughnessScale単独変更でもキャッシュが破棄され、ボクセル値とuserDataが再計算されることを保証する", () => {
    const manager = new AssetManager();
    manager.loadFromYamlString(DEFAULT_ASSETS_YAML);

    const baseTex = manager.getOrCreate3DTexture("asphalt_3d");
    expect(baseTex).toBeDefined();
    expect(baseTex?.userData?.roughnessScale).toBe(1);
    const baseDataSample = new Uint8Array((baseTex!.image.data as Uint8Array).slice(0, 64));

    const updatedCfg = manager.updateTexture3DConfig("asphalt_3d", {
      roughnessScale: 1.8,
    });
    expect(updatedCfg.roughnessScale).toBe(1.8);

    const modTex = manager.getOrCreate3DTexture("asphalt_3d");
    expect(modTex).toBeDefined();
    expect(modTex).not.toBe(baseTex);
    expect(modTex?.userData?.roughnessScale).toBe(1.8);

    const modDataSample = new Uint8Array((modTex!.image.data as Uint8Array).slice(0, 64));
    let hasChangedChannel = false;
    for (let i = 0; i < baseDataSample.length; i += 1) {
      if (baseDataSample[i] !== modDataSample[i]) {
        hasChangedChannel = true;
        break;
      }
    }
    expect(hasChangedChannel).toBe(true);
  });

  it("3Dテクスチャの解像度やroughnessScaleが安全上限（resolution: 8..128, roughnessScale: 0.1..10.0）を超えた場合にZodバリデーションで拒否することを保証する", () => {
    const manager = new AssetManager();
    manager.loadFromYamlString(DEFAULT_ASSETS_YAML);

    const throwsTooHighRes = () => {
      manager.updateTexture3DConfig("asphalt_3d", { resolution: 512 });
    };
    const throwsTooLowRes = () => {
      manager.updateTexture3DConfig("asphalt_3d", { resolution: 4 });
    };
    const throwsInvalidRoughness = () => {
      manager.updateTexture3DConfig("asphalt_3d", { roughnessScale: 25.0 });
    };

    expect(throwsTooHighRes).toThrow();
    expect(throwsTooLowRes).toThrow();
    expect(throwsInvalidRoughness).toThrow();
  });
});

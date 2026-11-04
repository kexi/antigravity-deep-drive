import { describe, it, expect, beforeEach } from "vitest";
import { AssetManager } from "../assets/assetManager";
import { DEFAULT_ASSETS_YAML } from "../assets/defaultAssetsYaml";
import {
  AssetManagerUI,
  hasAssetManagerPathSegment,
  hexColorStringToNumber,
  numberToHexColorString,
  parseAssetManagerOption,
} from "../assets/assetManagerUI";
import { i18n } from "../core/i18n";

describe("AssetManagerUI - URL Parsing, Color Helpers & Headless Safe Lifecycle", () => {
  beforeEach(() => {
    i18n.setLocale("ja");
  });

  it("URLパスやクエリパラメータ、ハッシュからアセット管理システム自動起動オプションを正確に判定することを保証する", () => {
    expect(hasAssetManagerPathSegment("/assets")).toBe(true);
    expect(hasAssetManagerPathSegment("/boost/assets")).toBe(true);
    expect(hasAssetManagerPathSegment("/deep-drive/asset-manager/")).toBe(true);
    expect(hasAssetManagerPathSegment("/boost")).toBe(false);
    expect(hasAssetManagerPathSegment("")).toBe(false);

    expect(parseAssetManagerOption("/assets")).toBe(true);
    expect(parseAssetManagerOption("/boost/assets")).toBe(true);
    expect(parseAssetManagerOption("?assets=1")).toBe(true);
    expect(parseAssetManagerOption("?assetManager=true")).toBe(true);
    expect(parseAssetManagerOption("?asset_manager=open")).toBe(true);
    expect(parseAssetManagerOption("?assets=0")).toBe(false);
    expect(parseAssetManagerOption("/assets?assets=off")).toBe(false);
    expect(parseAssetManagerOption("#assets")).toBe(true);
    expect(parseAssetManagerOption("#/asset-manager")).toBe(true);
    expect(parseAssetManagerOption({ pathname: "/", search: "", hash: "" })).toBe(false);
  });

  it("数値カラーとHEXカラー文字列の相互変換が境界値や不正入力に対しても安全に機能することを保証する", () => {
    expect(numberToHexColorString(0xff8844)).toBe("#ff8844");
    expect(numberToHexColorString(0x000000)).toBe("#000000");
    expect(numberToHexColorString(-10)).toBe("#000000");
    expect(numberToHexColorString(0x1ffffff)).toBe("#ffffff");
    expect(numberToHexColorString(Number.NaN)).toBe("#000000");

    expect(hexColorStringToNumber("#ff8844")).toBe(0xff8844);
    expect(hexColorStringToNumber("0x38bdf8")).toBe(0x38bdf8);
    expect(hexColorStringToNumber("invalid-hex", 0x123456)).toBe(0x123456);
  });

  it("ヘッドレス（DOM未定義）環境でもAssetManagerUIが例外なく初期化され、タブ切替・アセット選択・検索状態遷移が安全に機能することを保証する", () => {
    const manager = new AssetManager();
    manager.loadFromYamlString(DEFAULT_ASSETS_YAML);

    const ui = new AssetManagerUI({
      manager,
      bridge: {
        getShaderBoostState: () => ({
          enabled: true,
          prebuilt: true,
          lastReport: null,
        }),
      },
    });

    expect(ui.isOpen()).toBe(false);
    expect(ui.getActiveTab()).toBe("models");
    expect(ui.getSelectedAssetId()).toBe("car");

    // 各タブへの切替と初期選択アセットの解決
    ui.setActiveTab("textures3d");
    expect(ui.getActiveTab()).toBe("textures3d");
    expect(ui.getSelectedAssetId()).toBe("asphalt_3d");

    ui.setActiveTab("roads");
    expect(ui.getActiveTab()).toBe("roads");
    expect(ui.getSelectedAssetId()).toBe("gyoko_dori");

    ui.setActiveTab("signs");
    expect(ui.getActiveTab()).toBe("signs");
    expect(ui.getSelectedAssetId()).toBe("overhead_guide_gyoko");

    ui.setActiveTab("weatherPresets");
    expect(ui.getActiveTab()).toBe("weatherPresets");
    expect(ui.getSelectedAssetId()).toBe("sunset");

    ui.setActiveTab("yaml");
    expect(ui.getActiveTab()).toBe("yaml");

    // アセットの明示的選択とDOM無し環境での安全な開閉呼び出し
    ui.setActiveTab("models");
    ui.selectAsset("tokyo_station");
    expect(ui.getSelectedAssetId()).toBe("tokyo_station");

    ui.open("roads");
    expect(ui.getActiveTab()).toBe("roads");
    ui.close();
    ui.toggle();
    ui.renderAll();
  });

  it("標識が0件になった場合でもsignsタブの選択状態がクラッシュせず安全に空文字へフォールバックし、再追加時に復帰することを保証する", () => {
    const manager = new AssetManager();
    manager.loadFromYamlString(DEFAULT_ASSETS_YAML);

    const ui = new AssetManagerUI({ manager });
    ui.setActiveTab("signs");
    expect(ui.getSelectedAssetId().length).toBeGreaterThan(0);

    const signIds = manager.getSigns().map((s) => s.id);
    for (const id of signIds) {
      manager.removeSign(id);
    }
    ui.setActiveTab("signs");
    expect(ui.getSelectedAssetId()).toBe("");

    manager.upsertSign({
      id: "sign_added_1",
      type: "stop",
      position: [0, 0, -25],
      rotationY: 0,
      label: "止まれ",
    });
    ui.setActiveTab("signs");
    expect(ui.getSelectedAssetId()).toBe("sign_added_1");
  });
});

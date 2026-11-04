import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  applyDocumentTranslations,
  formatGsiRoadTelemetry,
  formatLabelPair,
  formatPlateauBuildingTelemetry,
  formatSignValidationStatus,
  getNextLocale,
  getNavigationMapLabels,
  getUiTranslations,
  i18n,
  I18nManager,
  isSupportedLocale,
  localizeBuildingName,
  localizeGazePresetLabel,
  localizeGraphicsQualityTexts,
  localizeRoadCategory,
  localizeRoadDisplayName,
  localizeRoadSignCategory,
  localizeRoadSignTitle,
  localizeRoadSurfaceLabel,
  localizeRoadWidthRank,
  localizeTimeOfDaySummaryLabel,
  localizeWeatherButtonLabel,
  localizeWeatherSummaryLabel,
  normalizeLocaleTag,
  parseLocaleQuery,
  resolveBrowserLocale,
  resolveInitialLocale,
  SUPPORTED_LOCALES,
} from "../core/i18n";
import { WeatherSystem } from "../weather/weatherSystem";
import { CameraController } from "../core/cameraController";
import { ROAD_SIGN_CATALOG } from "../roads/roadSignSystem";
import { CarModel } from "../vehicle/carModel";
import { TOKYO_MARUNOUCHI_OPEN_DATA } from "../openData/tokyoMarunouchiOpenData";
import { SHIBUYA_GSI_ROAD_SEGMENTS, SHIBUYA_PLATEAU_BUILDINGS } from "../openData/gsiPlateauLoader";

describe("Multi-language i18n & Browser Default Locale", () => {
  it("BCP 47 言語タグ（ja-JP, en-US, zh-CN, zh-TW, zh-Hant 等）を ja / en / zh へ正規化できることを保証する", () => {
    expect(normalizeLocaleTag("ja")).toBe("ja");
    expect(normalizeLocaleTag("ja-JP")).toBe("ja");
    expect(normalizeLocaleTag("JA_jp")).toBe("ja");

    expect(normalizeLocaleTag("en")).toBe("en");
    expect(normalizeLocaleTag("en-US")).toBe("en");
    expect(normalizeLocaleTag("en-GB")).toBe("en");

    expect(normalizeLocaleTag("zh")).toBe("zh");
    expect(normalizeLocaleTag("zh-CN")).toBe("zh");
    expect(normalizeLocaleTag("zh-TW")).toBe("zh");
    expect(normalizeLocaleTag("zh-HK")).toBe("zh");
    expect(normalizeLocaleTag("zh-Hans")).toBe("zh");
    expect(normalizeLocaleTag("zh-Hant-HK")).toBe("zh");
    expect(normalizeLocaleTag("cmn-Hans-CN")).toBe("zh");
    expect(normalizeLocaleTag("yue-HK")).toBe("zh");

    expect(normalizeLocaleTag("fr-FR")).toBeNull();
    expect(normalizeLocaleTag("de")).toBeNull();
    expect(normalizeLocaleTag("")).toBeNull();
    expect(normalizeLocaleTag(null)).toBeNull();
    expect(normalizeLocaleTag(undefined)).toBeNull();
  });

  it("ブラウザの navigator.languages 優先リストおよび navigator.language から既定言語を自動判定できることを保証する", () => {
    // 英語ブラウザ設定
    expect(
      resolveBrowserLocale({
        languages: ["en-US", "en", "ja"],
        language: "en-US",
      }),
    ).toBe("en");

    // 中国語ブラウザ設定
    expect(
      resolveBrowserLocale({
        languages: ["zh-CN", "zh", "en-US"],
        language: "zh-CN",
      }),
    ).toBe("zh");

    // 繁体字中国語ブラウザ設定
    expect(
      resolveBrowserLocale({
        languages: ["zh-TW", "en"],
        language: "zh-TW",
      }),
    ).toBe("zh");

    // 日本語ブラウザ設定
    expect(
      resolveBrowserLocale({
        languages: ["ja-JP", "ja", "en-US"],
        language: "ja-JP",
      }),
    ).toBe("ja");

    // 第1優先が未対応言語 (fr-FR) でも第2優先 (zh-HK) が対応言語ならそちらを選択する
    expect(
      resolveBrowserLocale({
        languages: ["fr-FR", "zh-HK", "en-US"],
        language: "fr-FR",
      }),
    ).toBe("zh");

    // languages が空配列の場合は language 単体設定へフォールバックする
    expect(
      resolveBrowserLocale({
        languages: [],
        language: "en-GB",
      }),
    ).toBe("en");

    // すべて未対応の場合はフォールバック言語（既定 ja）を返す
    expect(
      resolveBrowserLocale({
        languages: ["fr-FR", "de-DE"],
        language: "fr-FR",
        fallback: "ja",
      }),
    ).toBe("ja");
  });

  it("URL クエリ (?lang=... / ?locale=...) が指定された場合はブラウザ設定より優先し、未指定時はブラウザ設定をデフォルト言語にすることを保証する", () => {
    expect(parseLocaleQuery("?lang=en")).toBe("en");
    expect(parseLocaleQuery("?lang=zh-CN")).toBe("zh");
    expect(parseLocaleQuery("?locale=ja")).toBe("ja");
    expect(parseLocaleQuery("?area=shibuya")).toBeNull();
    expect(parseLocaleQuery("?lang=invalid")).toBeNull();

    // URL クエリ未指定時はブラウザ設定（例: zh-CN）がデフォルトになる
    expect(
      resolveInitialLocale({
        search: "?area=tokyo",
        languages: ["zh-CN", "en-US"],
        language: "zh-CN",
      }),
    ).toBe("zh");

    // URL クエリ指定時はブラウザ設定（ja-JP）を上書きして指定言語（en）になる
    expect(
      resolveInitialLocale({
        search: "?lang=en&area=shibuya",
        languages: ["ja-JP"],
        language: "ja-JP",
      }),
    ).toBe("en");
  });

  it("I18nManager が言語状態の保持・サイクル切替 (ja -> en -> zh -> ja)・変更通知リスナーを正しく制御することを保証する", () => {
    const manager = new I18nManager("en");
    expect(manager.getLocale()).toBe("en");
    expect(isSupportedLocale(manager.getLocale())).toBe(true);

    const observed: string[] = [];
    const unsubscribe = manager.onChange((loc) => {
      observed.push(loc);
    });

    // 同一言語の再設定では不要な通知を飛ばさない
    manager.setLocale("en");
    expect(observed).toEqual([]);

    // サイクル切替: en -> zh -> ja -> en
    expect(manager.cycleLocale()).toBe("zh");
    expect(manager.cycleLocale()).toBe("ja");
    expect(manager.cycleLocale()).toBe("en");
    expect(observed).toEqual(["zh", "ja", "en"]);

    unsubscribe();
    manager.setLocale("zh");
    expect(observed).toEqual(["zh", "ja", "en"]);
    expect(getNextLocale("ja")).toBe("en");
    expect(getNextLocale("en")).toBe("zh");
    expect(getNextLocale("zh")).toBe("ja");
  });

  it("日本語 (ja)・英語 (en)・中国語 (zh) の全 UI 翻訳辞書が同一キー構造を持ち空文字列を含まないことを保証する", () => {
    const jaDict = getUiTranslations("ja");
    const enDict = getUiTranslations("en");
    const zhDict = getUiTranslations("zh");

    const jaKeys = Object.keys(jaDict).sort();
    const enKeys = Object.keys(enDict).sort();
    const zhKeys = Object.keys(zhDict).sort();

    expect(enKeys).toEqual(jaKeys);
    expect(zhKeys).toEqual(jaKeys);

    for (const locale of SUPPORTED_LOCALES) {
      const dict = getUiTranslations(locale);
      for (const [key, val] of Object.entries(dict)) {
        expect(typeof val, `${locale}.${key} should be string`).toBe("string");
        expect(val.trim().length, `${locale}.${key} should not be empty`).toBeGreaterThan(0);
      }
    }

    // 代表的なラベルが3言語で適切に翻訳されていること
    expect(localizeWeatherButtonLabel("clear", "ja")).toBe("晴天");
    expect(localizeWeatherButtonLabel("clear", "en")).toBe("Clear");
    expect(localizeWeatherButtonLabel("clear", "zh")).toBe("晴天");

    expect(localizeWeatherButtonLabel("rain", "ja")).toBe("雨天");
    expect(localizeWeatherButtonLabel("rain", "en")).toBe("Rain");
    expect(localizeWeatherButtonLabel("rain", "zh")).toBe("雨天");

    expect(jaDict.cameraCockpitBtn).toContain("ドライバー視点");
    expect(enDict.cameraCockpitBtn).toContain("Cockpit");
    expect(zhDict.cameraCockpitBtn).toContain("驾驶席");

    expect(jaDict.loadingStageShaderPrebuild).toContain("/boost");
    expect(enDict.loadingStageShaderPrebuild).toContain("/boost");
    expect(zhDict.loadingStageShaderPrebuild).toContain("/boost");
    expect(jaDict.boostStatusPrebuilt).toContain("PREBUILT");
    expect(enDict.boostStatusPrebuilt).toContain("PREBUILT");
    expect(zhDict.boostStatusPrebuilt).toContain("已预编译");
  });

  it("時間帯・天候・路面状態・視線ラベル・画質ステータスが ja / en / zh の3言語で正しくローカライズされることを保証する", () => {
    const scene = new THREE.Scene();
    const weather = new WeatherSystem(scene);
    weather.setEnvironment("sunset", "rain", "puddle");

    const sumJa = weather.getEnvironmentSummary("ja");
    const sumEn = weather.getEnvironmentSummary("en");
    const sumZh = weather.getEnvironmentSummary("zh");

    expect(sumJa.timeLabel).toBe("夕暮れ");
    expect(sumEn.timeLabel).toBe("Sunset");
    expect(sumZh.timeLabel).toBe("傍晚");

    expect(sumJa.weatherLabel).toBe("雨天");
    expect(sumEn.weatherLabel).toBe("Rain");
    expect(sumZh.weatherLabel).toBe("雨天");

    expect(sumJa.roadSurfaceLabel).toBe("水たまり");
    expect(sumEn.roadSurfaceLabel).toBe("Standing Puddles");
    expect(sumZh.roadSurfaceLabel).toBe("积水路面");

    const cam = new CameraController(16 / 9);
    cam.setGazePreset("right_mirror", true);
    expect(cam.getGazeState("ja").label).toContain("右ミラー");
    expect(cam.getGazeState("en").label).toContain("Right Mirror");
    expect(cam.getGazeState("zh").label).toContain("右后视镜");

    expect(localizeTimeOfDaySummaryLabel("morning", "en")).toBe("Morning");
    expect(localizeWeatherSummaryLabel("cloudy", "zh")).toBe("多云");
    expect(localizeRoadSurfaceLabel("wet", "en")).toContain("Wet");
    expect(localizeGazePresetLabel("dashboard", "zh")).toContain("仪表");

    const gfxEn = localizeGraphicsQualityTexts("high", "en");
    const gfxZh = localizeGraphicsQualityTexts("low", "zh");
    expect(gfxEn.badgeText).toBe("HIGH");
    expect(gfxZh.quickChipText).toBe("画质: 低");
  });

  it("GIS 道路名・PLATEAU 建物名・道路標識カタログ・ナビ地図ラベルが ja / en / zh へ翻訳されることを保証する", () => {
    const roadJa = "行幸通り (都道404号皇居前東京停車場線)";
    expect(localizeRoadDisplayName(roadJa, "ja")).toBe(roadJa);
    expect(localizeRoadDisplayName(roadJa, "en")).toContain("Gyoko-dori Ave.");
    expect(localizeRoadDisplayName(roadJa, "zh")).toContain("行幸通");

    expect(localizeRoadCategory("都道府県道", "en")).toBe("Prefectural Rd");
    expect(localizeRoadCategory("都道府県道", "zh")).toBe("都道");
    expect(localizeRoadWidthRank("13m-19.5m未満", "en")).toBe("13m-19.5m");
    expect(localizeRoadWidthRank("13m-19.5m未満", "zh")).toBe("13m-19.5m");

    const roadTelemetryEn = formatGsiRoadTelemetry(
      {
        displayName: roadJa,
        rdCtg: "都道府県道",
        rnkWidth: "13m-19.5m未満",
        rID: "gsi-rd-404",
      },
      "en",
    );
    expect(roadTelemetryEn).toBe(
      "Gyoko-dori Ave. (Tokyo Pref. Rte 404) [Prefectural Rd / Width 13m-19.5m / rID:gsi-rd-404]",
    );

    const bldg = {
      buildingId: "13101-bldg-3114",
      name: "新丸の内ビルディング",
      nameEn: "Shin-Marunouchi Building",
      measuredHeight: 197.6,
      storeysAboveGround: 38,
    };
    expect(localizeBuildingName(bldg, "en")).toBe("Shin-Marunouchi Building");
    expect(localizeBuildingName(bldg, "zh")).toBe("新丸之内大厦");
    expect(formatPlateauBuildingTelemetry(bldg, "en")).toContain(
      "Shin-Marunouchi Building (13101-bldg-3114 / H=197.6m · 38F)",
    );
    expect(formatLabelPair("Clear", "Wet / After Rain", "en")).toBe("Clear · Wet / After Rain");
    expect(formatLabelPair("晴天", "雨上がり湿潤", "ja")).toBe("晴天・雨上がり湿潤");
    expect(formatLabelPair("晴天", "雨后湿润", "zh")).toBe("晴天・雨后湿润");

    // 道路標識カタログタイトルの多言語化
    const speedSign = ROAD_SIGN_CATALOG.speed_limit;
    expect(localizeRoadSignTitle(speedSign.type, speedSign.titleJa, "ja")).toContain("最高速度");
    expect(localizeRoadSignTitle(speedSign.type, speedSign.titleJa, "en")).toContain("Speed Limit");
    expect(localizeRoadSignTitle(speedSign.type, speedSign.titleJa, "zh")).toContain("最高限速");

    expect(localizeRoadSignCategory("regulatory", "en")).toBe("Regulatory");
    expect(localizeRoadSignCategory("warning", "zh")).toBe("警告");

    const okStatusEn = formatSignValidationStatus(
      {
        valid: true,
        boardTopY: 2.8,
        poleTopY: 2.9,
        poleClearanceFromTop: 0.1,
        issues: [],
      },
      "en",
    );
    expect(okStatusEn).toContain("Validation OK");

    const ngStatusZh = formatSignValidationStatus(
      {
        valid: false,
        boardTopY: 2.95,
        poleTopY: 2.8,
        poleClearanceFromTop: -0.15,
        issues: ["支柱天端が看板上端より低い"],
      },
      "zh",
    );
    expect(ngStatusZh).toContain("结构验证未通过");

    // カーナビ地図ランドマークラベルの多言語化
    const navShibuyaEn = getNavigationMapLabels(true, "en");
    const navMarunouchiZh = getNavigationMapLabels(false, "zh");
    expect(navShibuyaEn.some((lbl) => lbl.text.includes("Shibuya Stream"))).toBe(true);
    expect(navMarunouchiZh.some((lbl) => lbl.text.includes("东京站"))).toBe(true);
  });

  it("丸の内・渋谷の全 GSI 道路セグメントと全 PLATEAU ビルが英中翻訳テーブルで漏れなくローカライズされることを保証する", () => {
    const allRoads = [...TOKYO_MARUNOUCHI_OPEN_DATA.gsiRoadSegments, ...SHIBUYA_GSI_ROAD_SEGMENTS];
    expect(allRoads.length).toBeGreaterThan(0);

    for (const road of allRoads) {
      const enName = localizeRoadDisplayName(road.displayName, "en");
      const zhName = localizeRoadDisplayName(road.displayName, "zh");
      expect(enName).not.toBe(road.displayName);
      expect(zhName).not.toBe(road.displayName);
      expect(localizeRoadCategory(road.rdCtg, "en")).not.toBe(road.rdCtg);
      expect(localizeRoadWidthRank(road.rnkWidth, "en")).not.toBe(road.rnkWidth);
    }

    const allBuildings = [
      ...TOKYO_MARUNOUCHI_OPEN_DATA.plateauBuildings,
      ...SHIBUYA_PLATEAU_BUILDINGS,
    ];
    expect(allBuildings.length).toBeGreaterThan(0);

    for (const bldg of allBuildings) {
      const enBldg = localizeBuildingName(bldg, "en");
      const zhBldg = localizeBuildingName(bldg, "zh");
      expect(enBldg.length).toBeGreaterThan(0);
      expect(zhBldg.length).toBeGreaterThan(0);
      expect(enBldg).not.toBe(bldg.name);
      expect(zhBldg).not.toBe(bldg.name);
    }
  });

  it("applyDocumentTranslations が主要 DOM セレクタ・[N] ショートカット・data-locale ボタンの active 状態を漏れなく更新することを保証する", () => {
    const elements = new Map<
      string,
      {
        textContent: string;
        innerHTML: string;
        attributes: Record<string, string>;
        setAttribute(name: string, value: string): void;
      }
    >();

    const getOrCreateEl = (selector: string) => {
      const existing = elements.get(selector);
      if (existing) return existing;
      const created = {
        textContent: "",
        innerHTML: "",
        attributes: {} as Record<string, string>,
        setAttribute(name: string, value: string) {
          this.attributes[name] = value;
        },
      };
      elements.set(selector, created);
      return created;
    };

    const localeButtons = (["ja", "en", "zh"] as const).map((loc) => {
      const activeSet = new Set<string>();
      return {
        dataset: { lang: loc },
        classList: {
          toggle(cls: string, force?: boolean) {
            if (force) activeSet.add(cls);
            else activeSet.delete(cls);
          },
          contains(cls: string) {
            return activeSet.has(cls);
          },
        },
      };
    });

    const fakeDoc = {
      title: "",
      documentElement: { lang: "ja" },
      querySelector(selector: string) {
        return getOrCreateEl(selector);
      },
      querySelectorAll(selector: string) {
        if (selector === "#lang-buttons .hud-btn") {
          return localeButtons;
        }
        return [];
      },
    } as unknown as Document;

    applyDocumentTranslations("en", fakeDoc);
    expect(getOrCreateEl("#lang-panel-label").textContent).toBe("Language [N]");
    expect(getOrCreateEl("#hud-ui-toggle-btn").textContent).toBe("👁 UI OFF [Tab]");
    expect(getOrCreateEl("#ui-restore-fab").textContent).toBe("👁 Show UI [Tab]");
    expect(getOrCreateEl("#ui-visibility-panel-label").textContent).toBe(
      "HUD Visibility (UI Mode) [Tab]",
    );
    expect(getOrCreateEl("#controls-guide-line-3").innerHTML).toContain("<kbd>Tab</kbd>");
    expect(getOrCreateEl("#controls-guide-line-3").innerHTML).toContain("<kbd>N</kbd>");
    expect(localeButtons[1]?.classList.contains("active")).toBe(true);
    expect(localeButtons[0]?.classList.contains("active")).toBe(false);

    applyDocumentTranslations("zh", fakeDoc);
    expect(getOrCreateEl("#lang-panel-label").textContent).toBe("显示语言 (Language) [N]");
    expect(getOrCreateEl("#hud-ui-toggle-btn").textContent).toBe("👁 隐藏UI [Tab]");
    expect(getOrCreateEl("#ui-restore-fab").textContent).toBe("👁 显示UI [Tab]");
    expect(getOrCreateEl("#controls-guide-line-3").innerHTML).toContain("<kbd>Tab</kbd>");
    expect(getOrCreateEl("#controls-guide-line-3").innerHTML).toContain("<kbd>N</kbd>");
    expect(localeButtons[2]?.classList.contains("active")).toBe(true);
    expect(localeButtons[1]?.classList.contains("active")).toBe(false);
  });

  it("CarModel が初期状態で現在の i18n ロケールを採用し setLocale で即時更新されることを保証する", () => {
    const prevLocale = i18n.getLocale();
    try {
      i18n.setLocale("en");
      const car = new CarModel();
      expect(car.getLocale()).toBe("en");

      car.setLocale("zh");
      expect(car.getLocale()).toBe("zh");
    } finally {
      i18n.setLocale(prevLocale);
    }
  });

  it("DOM 環境が存在する場合に applyDocumentTranslations が document.documentElement.lang と titles を更新することを保証する", () => {
    const fakeSubtitleEl = { textContent: "" };
    const fakeThrottleEl = {
      textContent: "",
      attributes: {} as Record<string, string>,
      setAttribute(name: string, value: string) {
        this.attributes[name] = value;
      },
    };
    const fakeDoc = {
      title: "",
      documentElement: { lang: "ja" },
      querySelector(selector: string) {
        if (selector === "#header-subtitle-text") return fakeSubtitleEl;
        if (selector === "#touch-throttle-btn") return fakeThrottleEl;
        return null;
      },
      querySelectorAll() {
        return [];
      },
    } as unknown as Document;

    applyDocumentTranslations("en", fakeDoc);
    expect(fakeDoc.documentElement.lang).toBe("en");
    expect(fakeDoc.title).toContain("Tokyo 3D Driving Simulator");
    expect(fakeSubtitleEl.textContent).toContain("Tokyo PLATEAU");
    expect(fakeThrottleEl.attributes["aria-label"]).toContain("Throttle");

    applyDocumentTranslations("zh", fakeDoc);
    expect(fakeDoc.documentElement.lang).toBe("zh-CN");
    expect(fakeDoc.title).toContain("东京站・涩谷 3D驾驶模拟器");
    expect(fakeSubtitleEl.textContent).toContain("东京都 PLATEAU");
    expect(fakeThrottleEl.attributes["aria-label"]).toContain("油门");
  });
});

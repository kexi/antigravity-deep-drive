import type { RoadSignType } from "../assets/schema";
import type {
  CameraMode,
  GazePreset,
  GraphicsQuality,
  RoadSurfaceCondition,
  TimeOfDay,
  WeatherCondition,
  WiperMode,
} from "../types";
import { logger } from "./logger";

/**
 * シミュレーターが対応する言語ロケール識別子
 * - `ja`: 日本語
 * - `en`: 英語 (English)
 * - `zh`: 中国語 (簡体字・繁体字を含む中文表示)
 */
export type SupportedLocale = "ja" | "en" | "zh";

/**
 * 言語サイクル順序（日本語 → 英語 → 中国語）
 */
export const SUPPORTED_LOCALES: readonly SupportedLocale[] = ["ja", "en", "zh"] as const;

/**
 * 言語切替ボタン等に表示するネイティブロケール表記
 */
export const LOCALE_DISPLAY_LABELS: Readonly<Record<SupportedLocale, string>> = {
  ja: "日本語",
  en: "English",
  zh: "中文",
};

/**
 * `<html lang="...">` 属性に設定する標準 BCP 47 言語タグ
 */
export const LOCALE_HTML_LANG: Readonly<Record<SupportedLocale, string>> = {
  ja: "ja",
  en: "en",
  zh: "zh-CN",
};

export interface BrowserLocaleDetectionOptions {
  languages?: readonly string[] | null;
  language?: string | null;
  fallback?: SupportedLocale;
}

export interface InitialLocaleResolutionOptions extends BrowserLocaleDetectionOptions {
  search?: string;
}

export interface UiTranslationDictionary {
  documentTitle: string;
  headerSubtitle: string;
  gisToggleBtn: string;
  gisToggleAria: string;
  quickBarAria: string;
  quickCameraCockpit: string;
  quickCameraChase: string;
  quickGazeForward: string;
  quickGazeForwardTitle: string;
  quickMirrorLeft: string;
  quickMirrorLeftTitle: string;
  quickMirrorRear: string;
  quickMirrorRearTitle: string;
  quickMirrorRight: string;
  quickMirrorRightTitle: string;
  quickNavGaze: string;
  quickNavGazeTitle: string;
  quickAreaTokyo: string;
  quickAreaShibuya: string;
  quickGraphicsTitle: string;
  quickResetBtn: string;
  quickLangTitle: string;
  menuOpenBtn: string;
  menuCloseBtn: string;
  gisHeaderMarunouchi: string;
  gisHeaderShibuya: string;
  gisCoordLabel: string;
  gisRoadLabel: string;
  gisBldgLabel: string;
  drawerTitle: string;
  drawerCloseBtn: string;
  drawerCloseAria: string;
  panelLangLabel: string;
  panelAreaLabel: string;
  areaTokyoBtn: string;
  areaShibuyaBtn: string;
  panelTimePrefix: string;
  panelWeatherLabel: string;
  panelSurfaceLabel: string;
  panelCameraLabel: string;
  cameraCockpitBtn: string;
  cameraChaseBtn: string;
  panelGazePrefix: string;
  gazeForwardBtn: string;
  gazeForwardTitle: string;
  gazeRightMirrorBtn: string;
  gazeRightMirrorTitle: string;
  gazeLeftMirrorBtn: string;
  gazeLeftMirrorTitle: string;
  gazeRearviewMirrorBtn: string;
  gazeRearviewMirrorTitle: string;
  gazeDashboardBtn: string;
  gazeDashboardTitle: string;
  gazeRightShoulderBtn: string;
  gazeRightShoulderTitle: string;
  gazeLeftShoulderBtn: string;
  gazeLeftShoulderTitle: string;
  panelWiperLabel: string;
  wiperOffBtn: string;
  wiperSlowBtn: string;
  wiperFastBtn: string;
  panelTurnSignalPrefix: string;
  turnSignalLeftBtn: string;
  turnSignalRightBtn: string;
  turnSignalHazardBtn: string;
  turnSignalOffBtn: string;
  turnSignalStatusOff: string;
  turnSignalStatusLeft: string;
  turnSignalStatusRight: string;
  turnSignalStatusHazard: string;
  panelBlurLabel: string;
  panelGraphicsPrefix: string;
  graphicsHighBtn: string;
  graphicsMediumBtn: string;
  graphicsLowBtn: string;
  panelTouchUiLabel: string;
  touchUiAutoBtn: string;
  touchUiOnBtn: string;
  touchUiOffBtn: string;
  panelSignBuilderLabel: string;
  openSignCreatorBtn: string;
  panelGamepadLabel: string;
  gamepadStatusStandby: string;
  gamepadStatusConnectedProCon: string;
  gamepadStatusConnectedGeneric: string;
  controlsGuideLine1: string;
  controlsGuideLine2: string;
  controlsGuideLine3: string;
  controlsGuideLine4: string;
  blurStatusActive: string;
  blurStatusOff: string;
  touchControllerAria: string;
  touchSteerClusterAria: string;
  touchSteerPadAria: string;
  touchSteerLeftAria: string;
  touchSteerLeftMain: string;
  touchSteerLeftSub: string;
  touchSteerRightAria: string;
  touchSteerRightMain: string;
  touchSteerRightSub: string;
  touchPedalClusterAria: string;
  touchHandbrakeAria: string;
  touchHandbrakeSub: string;
  touchBrakeAria: string;
  touchBrakeSub: string;
  touchThrottleAria: string;
  touchThrottleSub: string;
  navDistanceAheadSuffix: string;
  navTargetShibuya: string;
  navTargetMarunouchi: string;
  navRouteSubShibuya: string;
  navRouteSubMarunouchi: string;
  navSpeedGearHeader: string;
  navLandmarkHeader: string;
  signDialogTitle: string;
  signDialogCloseBtn: string;
  signFieldTypeLabel: string;
  signFieldMainLabel: string;
  signFieldMainPlaceholder: string;
  signFieldSubLabel: string;
  signFieldSubPlaceholder: string;
  signFieldAuxLabel: string;
  signFieldAuxPlaceholder: string;
  signFieldSpeedLabel: string;
  signFieldDistanceLabel: string;
  signFieldOffsetLabel: string;
  signPlaceAheadBtn: string;
  signCopyYamlBtn: string;
  signYamlSectionLabel: string;
  signCustomListLabel: string;
  signEmptyListMessage: string;
  signDeleteBtnTitle: string;
  titleScreenBadge: string;
  titleScreenSubtitle: string;
  titleSelectAreaLabel: string;
  titleSelectQualityLabel: string;
  titleSelectBoostLabel: string;
  titleSelectLangLabel: string;
  titleStartDriveBtn: string;
  titleControlsHint: string;
  loadingStageInit: string;
  loadingStageOpenData: string;
  loadingStageTextures: string;
  loadingStagePhysics: string;
  loadingStageCity: string;
  loadingStageShaderPrebuild: string;
  loadingStageReady: string;
  panelBoostPrefix: string;
  boostOnBtn: string;
  boostOffBtn: string;
  boostBadgePrebuilt: string;
  boostBadgeOn: string;
  boostBadgeOff: string;
  boostStatusPrebuilt: string;
  boostStatusOff: string;
  panelSoundPrefix: string;
  soundOnBtn: string;
  soundOffBtn: string;
  soundVolumeAria: string;
  soundBadgeActive: string;
  soundBadgeMuted: string;
  soundStatusActive: string;
  soundStatusMuted: string;
  quickSoundOn: string;
  quickSoundOff: string;
  quickSoundTitle: string;
  panelAssetManagerLabel: string;
  openAssetManagerBtn: string;
  quickAssetManagerBtn: string;
  quickAssetManagerTitle: string;
  assetDialogTitle: string;
  assetDialogCloseBtn: string;
  assetRunBoostBtn: string;
  assetResetAllBtn: string;
  assetSearchPlaceholder: string;
  assetTabModels: string;
  assetTabTextures3d: string;
  assetTabRoads: string;
  assetTabSigns: string;
  assetTabWeather: string;
  assetTabYaml: string;
  gisStreamingLabel: string;
  loadingStagePriorityChunks: string;
  loadingRetryBtn: string;
  streamingBannerAreaTitle: string;
  streamingBannerPrefetchTitle: string;
  streamingBannerRetryBtn: string;
  streamingStatusLabel: string;
  hudUiOffBtn: string;
  hudUiOffBtnTitle: string;
  uiRestoreFabBtn: string;
  uiRestoreFabTitle: string;
  quickUiOffBtn: string;
  quickUiOffTitle: string;
  panelUiVisibilityLabel: string;
  uiVisibilityOnBtn: string;
  uiVisibilityOffBtn: string;
}

/**
 * 値が `SupportedLocale` かどうかを判定する型ガード
 */
export function isSupportedLocale(value: unknown): value is SupportedLocale {
  const isNotString = typeof value !== "string";
  if (isNotString) {
    return false;
  }
  return value === "ja" || value === "en" || value === "zh";
}

/**
 * 任意の BCP 47 言語タグやクエリ文字列（例: `"en-US"`, `"zh-CN"`, `"zh_Hant"`, `"ja-JP"`）を
 * `SupportedLocale` (`"ja" | "en" | "zh"`) に正規化する。未対応言語の場合は `null` を返す。
 *
 * Why サブタグ分割 (`split(/[-_]/)`) で判定するか:
 * ブラウザの `navigator.languages` は `"en-US"`, `"en-GB"`, `"zh-CN"`, `"zh-TW"`, `"zh-Hans-CN"`, `"ja-JP"` など
 * 地域・スクリプトサブタグ付きの形式で返されるため、主言語サブタグまたは慣用エイリアスで統一的に解決する必要がある。
 * Why not 完全一致のみで比較しなかったか:
 * `"en"` のみとの厳密比較では `"en-US"` や `"zh-CN"` がすべて未対応扱いになり、実機のブラウザ言語設定を検出できないため。
 */
export function normalizeLocaleTag(tag: string | null | undefined): SupportedLocale | null {
  const isMissingTag = typeof tag !== "string" || tag.trim().length === 0;
  if (isMissingTag) {
    return null;
  }

  const normalized = tag.trim().toLowerCase();
  const primarySubtag = normalized.split(/[-_]/)[0] ?? "";

  const isJapanese = primarySubtag === "ja" || primarySubtag === "jp" || primarySubtag === "jpn";
  if (isJapanese) {
    return "ja";
  }

  const isEnglish = primarySubtag === "en" || primarySubtag === "eng";
  if (isEnglish) {
    return "en";
  }

  const isChinese =
    primarySubtag === "zh" ||
    primarySubtag === "cmn" ||
    primarySubtag === "yue" ||
    primarySubtag === "cn" ||
    primarySubtag === "chs" ||
    primarySubtag === "cht";
  if (isChinese) {
    return "zh";
  }

  return null;
}

/**
 * ブラウザの言語設定 (`navigator.languages` および `navigator.language`) からデフォルト言語を決定する。
 *
 * How 優先順位を解決しているか:
 * 1. `navigator.languages`（優先言語リスト）を先頭から順に走査し、最初に `ja` / `en` / `zh` にマッチした言語を採用する。
 * 2. リストで解決できなかった場合は `navigator.language`（単一言語プロパティ）を検査する。
 * 3. 非ブラウザ環境（Node.js / Vitest サーバー実行）や未対応言語のみの場合は `fallback`（既定: `"ja"`）へ安全にフォールバックする。
 */
export function resolveBrowserLocale(options: BrowserLocaleDetectionOptions = {}): SupportedLocale {
  const fallback: SupportedLocale = options.fallback ?? "ja";

  const hasExplicitLanguages = options.languages !== undefined;
  const candidateLanguages: readonly string[] = hasExplicitLanguages
    ? (options.languages ?? [])
    : typeof navigator !== "undefined" && Array.isArray(navigator.languages)
      ? navigator.languages
      : [];

  for (const candidate of candidateLanguages) {
    const matched = normalizeLocaleTag(candidate);
    const isMatched = matched !== null;
    if (isMatched) {
      return matched;
    }
  }

  const hasExplicitPrimary = options.language !== undefined;
  const primaryCandidate = hasExplicitPrimary
    ? options.language
    : typeof navigator !== "undefined"
      ? navigator.language
      : null;

  const matchedPrimary = normalizeLocaleTag(primaryCandidate);
  const hasPrimaryMatch = matchedPrimary !== null;
  if (hasPrimaryMatch) {
    return matchedPrimary;
  }

  return fallback;
}

/**
 * URL クエリ文字列 (`?lang=en` または `?locale=zh`) から明示的な言語指定を解析する。
 */
export function parseLocaleQuery(
  search: string,
  fallback: SupportedLocale | null = null,
): SupportedLocale | null {
  const isEmpty = !search || search.trim().length === 0;
  if (isEmpty) {
    return fallback;
  }

  try {
    const normalizedSearch = search.startsWith("?") ? search : `?${search}`;
    const params = new URLSearchParams(normalizedSearch);
    const rawValue = params.get("lang") ?? params.get("locale");
    const resolved = normalizeLocaleTag(rawValue);
    const isValid = resolved !== null;
    if (isValid) {
      return resolved;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

/**
 * アプリ起動時の初期言語を決定する。
 * URL クエリ (`?lang=...`) が指定されている場合はそれを優先し、未指定時はブラウザの言語設定をデフォルト言語とする。
 */
export function resolveInitialLocale(
  options: InitialLocaleResolutionOptions = {},
): SupportedLocale {
  const searchStr =
    options.search !== undefined
      ? options.search
      : typeof window !== "undefined"
        ? window.location.search
        : "";

  const queryLocale = parseLocaleQuery(searchStr, null);
  const hasQueryOverride = queryLocale !== null;
  if (hasQueryOverride) {
    return queryLocale;
  }

  return resolveBrowserLocale(options);
}

/**
 * 次の言語へサイクル遷移する（日本語 → 英語 → 中国語 → 日本語）
 */
export function getNextLocale(current: SupportedLocale): SupportedLocale {
  const currentIndex = SUPPORTED_LOCALES.indexOf(current);
  const isUnknown = currentIndex < 0;
  if (isUnknown) {
    return "ja";
  }
  const nextIndex = (currentIndex + 1) % SUPPORTED_LOCALES.length;
  return SUPPORTED_LOCALES[nextIndex];
}

/**
 * 時間帯 (`TimeOfDay`) の多言語サマリーラベル定義
 */
const TIME_OF_DAY_SUMMARY_LABELS: Readonly<
  Record<SupportedLocale, Readonly<Record<TimeOfDay, string>>>
> = {
  ja: {
    morning: "朝",
    day: "昼",
    sunset: "夕暮れ",
    night: "夜間",
  },
  en: {
    morning: "Morning",
    day: "Day",
    sunset: "Sunset",
    night: "Night",
  },
  zh: {
    morning: "清晨",
    day: "白天",
    sunset: "傍晚",
    night: "夜晚",
  },
};

/**
 * 時間帯ボタン (`#time-buttons`) の多言語ラベル定義
 */
const TIME_OF_DAY_BUTTON_LABELS: Readonly<
  Record<SupportedLocale, Readonly<Record<TimeOfDay, string>>>
> = {
  ja: {
    morning: "朝 06:30",
    day: "昼 12:00",
    sunset: "夕暮れ 17:30",
    night: "夜間 21:00",
  },
  en: {
    morning: "Morning 06:30",
    day: "Day 12:00",
    sunset: "Sunset 17:30",
    night: "Night 21:00",
  },
  zh: {
    morning: "清晨 06:30",
    day: "白天 12:00",
    sunset: "傍晚 17:30",
    night: "夜晚 21:00",
  },
};

/**
 * 天候 (`WeatherCondition`) の多言語サマリーラベル定義
 */
const WEATHER_SUMMARY_LABELS: Readonly<
  Record<SupportedLocale, Readonly<Record<WeatherCondition, string>>>
> = {
  ja: {
    clear: "晴天",
    cloudy: "曇天",
    rain: "雨天",
  },
  en: {
    clear: "Clear",
    cloudy: "Cloudy",
    rain: "Rain",
  },
  zh: {
    clear: "晴天",
    cloudy: "多云",
    rain: "雨天",
  },
};

/**
 * 天候ボタン (`#weather-buttons`) の多言語ラベル定義
 */
const WEATHER_BUTTON_LABELS: Readonly<
  Record<SupportedLocale, Readonly<Record<WeatherCondition, string>>>
> = {
  ja: {
    clear: "晴天",
    cloudy: "曇天",
    rain: "雨天",
  },
  en: {
    clear: "Clear",
    cloudy: "Cloudy",
    rain: "Rain",
  },
  zh: {
    clear: "晴天",
    cloudy: "多云",
    rain: "雨天",
  },
};

/**
 * 路面状態 (`RoadSurfaceCondition`) の多言語サマリーラベル定義
 */
const ROAD_SURFACE_LOCALIZED_LABELS: Readonly<
  Record<SupportedLocale, Readonly<Record<RoadSurfaceCondition, string>>>
> = {
  ja: {
    dry: "乾燥",
    wet: "雨上がり・湿潤",
    puddle: "水たまり",
  },
  en: {
    dry: "Dry",
    wet: "Wet / After Rain",
    puddle: "Standing Puddles",
  },
  zh: {
    dry: "干燥",
    wet: "雨后湿润",
    puddle: "积水路面",
  },
};

/**
 * 路面状態ボタン (`#road-surface-buttons`) の短いラベル定義
 */
const ROAD_SURFACE_BUTTON_LABELS: Readonly<
  Record<SupportedLocale, Readonly<Record<RoadSurfaceCondition, string>>>
> = {
  ja: {
    dry: "乾燥",
    wet: "雨上がり",
    puddle: "水たまり",
  },
  en: {
    dry: "Dry",
    wet: "Wet",
    puddle: "Puddles",
  },
  zh: {
    dry: "干燥",
    wet: "雨后",
    puddle: "积水",
  },
};

/**
 * カメラモード (`CameraMode`) の多言語ラベル定義
 */
const CAMERA_MODE_LABELS: Readonly<Record<SupportedLocale, Readonly<Record<CameraMode, string>>>> =
  {
    ja: {
      cockpit: "運転席",
      chase: "追従",
    },
    en: {
      cockpit: "Cockpit",
      chase: "Chase",
    },
    zh: {
      cockpit: "驾驶席",
      chase: "跟随",
    },
  };

/**
 * ドライバー視線プリセット (`GazePreset`) の多言語ラベル定義
 */
const GAZE_PRESET_LABELS: Readonly<Record<SupportedLocale, Readonly<Record<GazePreset, string>>>> =
  {
    ja: {
      forward: "正面",
      right_mirror: "右ミラー",
      left_mirror: "左ミラー",
      rearview_mirror: "ルームミラー",
      dashboard: "計器・ナビ",
      right_shoulder: "右目視",
      left_shoulder: "左目視",
      free: "自由視線",
    },
    en: {
      forward: "Forward",
      right_mirror: "Right Mirror",
      left_mirror: "Left Mirror",
      rearview_mirror: "Rearview Mirror",
      dashboard: "Meters & Nav",
      right_shoulder: "Right Blind Spot",
      left_shoulder: "Left Blind Spot",
      free: "Free Look",
    },
    zh: {
      forward: "正前",
      right_mirror: "右后视镜",
      left_mirror: "左后视镜",
      rearview_mirror: "内后视镜",
      dashboard: "仪表・导航",
      right_shoulder: "右盲区",
      left_shoulder: "左盲区",
      free: "自由视线",
    },
  };

/**
 * グラフィック品質 (`GraphicsQuality`) の多言語表示テキスト定義
 */
const GRAPHICS_QUALITY_LOCALIZED: Readonly<
  Record<
    SupportedLocale,
    Readonly<
      Record<
        GraphicsQuality,
        { label: string; badgeText: string; quickChipText: string; hudStatusText: string }
      >
    >
  >
> = {
  ja: {
    high: {
      label: "高",
      badgeText: "高 (HIGH)",
      quickChipText: "画質: 高",
      hudStatusText: "GRAPHICS: 高 (HIGH)",
    },
    medium: {
      label: "中",
      badgeText: "中 (MEDIUM)",
      quickChipText: "画質: 中",
      hudStatusText: "GRAPHICS: 中 (MEDIUM)",
    },
    low: {
      label: "低",
      badgeText: "低 (LOW)",
      quickChipText: "画質: 低",
      hudStatusText: "GRAPHICS: 低 (LOW)",
    },
  },
  en: {
    high: {
      label: "High",
      badgeText: "HIGH",
      quickChipText: "GFX: High",
      hudStatusText: "GRAPHICS: HIGH",
    },
    medium: {
      label: "Med",
      badgeText: "MEDIUM",
      quickChipText: "GFX: Med",
      hudStatusText: "GRAPHICS: MEDIUM",
    },
    low: {
      label: "Low",
      badgeText: "LOW",
      quickChipText: "GFX: Low",
      hudStatusText: "GRAPHICS: LOW",
    },
  },
  zh: {
    high: {
      label: "高",
      badgeText: "高 (HIGH)",
      quickChipText: "画质: 高",
      hudStatusText: "GRAPHICS: 高 (HIGH)",
    },
    medium: {
      label: "中",
      badgeText: "中 (MEDIUM)",
      quickChipText: "画质: 中",
      hudStatusText: "GRAPHICS: 中 (MEDIUM)",
    },
    low: {
      label: "低",
      badgeText: "低 (LOW)",
      quickChipText: "画质: 低",
      hudStatusText: "GRAPHICS: 低 (LOW)",
    },
  },
};

/**
 * GSI 道路網の路線名（日本語 `displayName`）に対する英語・中国語ローカライズ辞書
 */
const ROAD_DISPLAY_NAME_TRANSLATIONS: Readonly<Record<string, { en: string; zh: string }>> = {
  "行幸通り (都道404号皇居前東京停車場線)": {
    en: "Gyoko-dori Ave. (Tokyo Pref. Rte 404)",
    zh: "行幸通 (东京都道404号皇居前东京站线)",
  },
  "日比谷通り (都道403号・国道1号)": {
    en: "Hibiya-dori Ave. (Route 1 / Pref. Rte 403)",
    zh: "日比谷通 (都道403号・国道1号)",
  },
  "丸の内仲通り (特別区道千第110号)": {
    en: "Marunouchi Nakadori Ave. (Chiyoda Rd 110)",
    zh: "丸之内仲通 (千代田区道110号)",
  },
  "丸の内中央通り (東京駅前広場線)": {
    en: "Marunouchi Central Ave. (Tokyo Sta. Plaza)",
    zh: "丸之内中央通 (东京站前广场线)",
  },
  "永代通り (国道1号)": {
    en: "Eitai-dori Ave. (National Route 1)",
    zh: "永代通 (国道1号)",
  },
  "永代通り・大手町大通り (国道1号)": {
    en: "Eitai-dori / Otemachi Ave. (Route 1)",
    zh: "永代通・大手町大道 (国道1号)",
  },
  "内堀通り (都道301号白山祝田田町線)": {
    en: "Uchibori-dori Ave. (Tokyo Pref. Rte 301)",
    zh: "内堀通 (东京都道301号白山祝田田町线)",
  },
  "鍛冶橋通り・馬場先門通り (都道406号皇居前鍛冶橋線)": {
    en: "Kajibashi / Babasakimon Ave. (Pref. Rte 406)",
    zh: "锻冶桥通・马场先门通 (东京都道406号)",
  },
  丸の内区画街路: {
    en: "Marunouchi District Street",
    zh: "丸之内街区道路",
  },
  "明治通り (都道305号芝新宿王子線・渋谷ストリーム前)": {
    en: "Meiji-dori Ave. (Pref. Rte 305 / Shibuya Stream)",
    zh: "明治通 (东京都道305号・涩谷Stream前)",
  },
  "国道246号・青山通り・玉川通り (渋谷ストリーム北交差点)": {
    en: "Route 246 / Aoyama-dori / Tamagawa-dori (Shibuya Stream North)",
    zh: "国道246号・青山通・玉川通 (涩谷Stream北交叉口)",
  },
  "渋谷川遊歩道・稲荷橋広場通り (渋谷区道)": {
    en: "Shibuya River Promenade / Inaribashi Plaza St. (Shibuya Ward Rd)",
    zh: "涩谷川步道・稻荷桥广场通 (涩谷区道)",
  },
  "明治通り (都道305号芝新宿王子線・渋谷駅東口)": {
    en: "Meiji-dori Ave. (Pref. Rte 305 Shibuya East)",
    zh: "明治通 (东京都道305号・涩谷站东口)",
  },
  "青山通り・国道246号 (赤坂・青山・渋谷連絡線)": {
    en: "Aoyama-dori / Route 246 (Akasaka–Shibuya)",
    zh: "青山通・国道246号 (赤坂・青山・涩谷联络线)",
  },
  "渋谷ストリーム前 区道 (稲荷橋広場連絡線)": {
    en: "Shibuya Stream Front Rd (Inaribashi Plaza)",
    zh: "涩谷Stream前区道 (稻荷桥广场联络线)",
  },
  "稲荷橋通り・サクラステージ南通り (渋谷区道)": {
    en: "Inaribashi St. / Sakura Stage South Rd (Shibuya Ward Rd)",
    zh: "稻荷桥通・Sakura Stage南通 (涩谷区道)",
  },
  "並木橋・八幡通り連絡路 (渋谷区道)": {
    en: "Namikibashi / Hachiman-dori Connector (Shibuya Ward Rd)",
    zh: "并木桥・八幡通联络路 (涩谷区道)",
  },
  "宮下公園・美竹通り連絡路 (渋谷区道)": {
    en: "Miyashita Park / Mitake-dori Connector (Shibuya Ward Rd)",
    zh: "宫下公园・美竹通联络路 (涩谷区道)",
  },
  "渋谷西口・桜丘ウエスト通り (渋谷区道)": {
    en: "Shibuya West / Sakuragaoka West St. (Shibuya Ward Rd)",
    zh: "涩谷西口・樱丘西通 (涩谷区道)",
  },
  "金王坂・渋谷三丁目イースト通り (渋谷区道)": {
    en: "Konnozaka / Shibuya 3-Chome East St. (Shibuya Ward Rd)",
    zh: "金王坂・涩谷三丁目东通 (涩谷区道)",
  },
};

/**
 * GSI 道路分類 (`rdCtg`) の多言語辞書
 */
const ROAD_CATEGORY_TRANSLATIONS: Readonly<Record<string, { en: string; zh: string }>> = {
  国道: { en: "National Hwy", zh: "国道" },
  都道府県道: { en: "Prefectural Rd", zh: "都道" },
  市区町村道等: { en: "Municipal Rd", zh: "市政区道" },
};

/**
 * GSI 幅員区分 (`rnkWidth`) の多言語辞書
 */
const ROAD_WIDTH_RANK_TRANSLATIONS: Readonly<Record<string, { en: string; zh: string }>> = {
  "19.5m以上": { en: ">=19.5m", zh: "19.5m以上" },
  "13m-19.5m未満": { en: "13m-19.5m", zh: "13m-19.5m" },
  "5.5m-13m未満": { en: "5.5m-13m", zh: "5.5m-13m" },
  "3m-5.5m未満": { en: "3m-5.5m", zh: "3m-5.5m" },
};

/**
 * PLATEAU 建築物 ID に対する中国語名称辞書（英語はオープンデータ既存の `nameEn` を活用）
 */
const BUILDING_NAME_ZH_BY_ID: Readonly<Record<string, string>> = {
  "13101-bldg-3741": "丸之内二重桥大厦北座",
  "13101-bldg-3449": "明治安田生命大厦 (明治生命馆街区)",
  "13101-bldg-768": "丸之内仲通岸本大厦街区",
  "13101-bldg-3114": "新丸之内大厦",
  "13101-bldg-881": "丸之内二丁目大厦",
  "13101-bldg-2287": "JP塔 (KITTE丸之内)",
  "13101-bldg-604": "东京海上日动大厦本馆",
  "13101-bldg-2033": "东京银行协会大厦",
  "13101-bldg-4002": "丸之内OAZO (日本生命丸之内大厦)",
  "13101-bldg-2340": "丸之内公园大厦",
  "13101-bldg-3556": "东京大厦 (TOKIA)",
  "13101-bldg-4149": "邮船大厦",
  "13101-bldg-4184": "三菱商事大厦",
  "13101-bldg-1194": "丸之内大厦 (Marubiru)",
  "13101-bldg-1849": "丸之内仲通大厦",
  "13101-bldg-3631": "东京皇宫酒店 (Palace Hotel Tokyo)",
  "13101-bldg-1824": "丸之内永乐大厦 (iiyo!!)",
  "13101-bldg-1336": "日本工业俱乐部会馆・三菱UFJ信托银行总行",
  "13101-bldg-5101": "大手町塔 (Otemachi Tower / 安缦东京)",
  "13101-bldg-5102": "Otemachi One 塔楼",
  "13101-bldg-5103": "大手町Place (西塔/东塔)",
  "13101-bldg-5104": "大手町金融城 Grand Cube",
  "13101-bldg-5105": "读卖新闻东京总社大厦",
  "13101-bldg-5201": "DN塔21 (第一生命馆・农林中金大厦)",
  "13101-bldg-5202": "国际大厦・帝国剧场街区",
  "13101-bldg-5203": "东京国际论坛 (玻璃栋・大厅栋)",
  "13101-bldg-5204": "东京半岛酒店 (The Peninsula Tokyo)",
  "13101-bldg-5205": "东京中城日比谷 (Tokyo Midtown Hibiya)",
  "13113-bldg-shibuya-stream": "涩谷Stream",
  "13113-bldg-scramble-square": "涩谷Scramble Square 东栋",
  "13113-bldg-shibuya-scramble-sq": "涩谷Scramble Square 东栋",
  "13113-bldg-shibuya-hikarie": "涩谷Hikarie",
  "13113-bldg-sakura-stage": "涩谷Sakura Stage SHIBUYA塔",
  "13113-bldg-shibuya-sakura-stage": "涩谷Sakura Stage SHIBUYA塔",
  "13113-bldg-shibuya-fukuras": "涩谷FUKURAS (东急Plaza涩谷)",
  "13113-bldg-shibuya-cast": "涩谷三丁目东大楼 (明治通林荫街区)",
  "13113-bldg-shibuya-sankyo": "涩谷三共生兴大厦",
  "13113-bldg-meiji-dori-south-west": "涩谷并木桥西大楼 (樱丘南街区)",
  "13113-bldg-aoyama-oval": "青山椭圆大厦 (国道246号・表参道街区)",
  "13113-bldg-shibuya-first-tower": "涩谷第一塔楼 (金王坂・青山通南街区)",
  "13103-bldg-aoyama-twins": "新青山大厦 (青山双子塔・国道246号沿线)",
  "13103-bldg-akasaka-intercity": "青山通大道塔楼 (赤坂・表参道街区)",
};

/**
 * 道路標識 15 種の多言語タイトル辞書
 */
const ROAD_SIGN_TITLE_TRANSLATIONS: Readonly<
  Record<RoadSignType, { ja: string; en: string; zh: string }>
> = {
  speed_limit: {
    ja: "最高速度 (323)",
    en: "Speed Limit (323)",
    zh: "最高限速 (323)",
  },
  no_parking: {
    ja: "駐車禁止 (316)",
    en: "No Parking (316)",
    zh: "禁止停车 (316)",
  },
  no_stopping: {
    ja: "駐停車禁止 (315)",
    en: "No Stopping or Parking (315)",
    zh: "禁止临时或长时间停车 (315)",
  },
  no_entry: {
    ja: "車両進入禁止 (303)",
    en: "No Entry (303)",
    zh: "禁止车辆驶入 (303)",
  },
  no_uturn: {
    ja: "転回禁止 (313)",
    en: "No U-Turn (313)",
    zh: "禁止掉头 (313)",
  },
  direction_mandatory: {
    ja: "指定方向外進行禁止 (311)",
    en: "Mandatory Direction (311)",
    zh: "指定方向外禁止通行 (311)",
  },
  stop: {
    ja: "一時停止 (330)",
    en: "Stop Sign (330)",
    zh: "停车让行 (330)",
  },
  one_way: {
    ja: "一方通行 (326-A)",
    en: "One Way (326-A)",
    zh: "单行道 (326-A)",
  },
  lane_direction: {
    ja: "進行方向別通行区分 (327-7)",
    en: "Lane Direction Control (327-7)",
    zh: "按方向分道通行 (327-7)",
  },
  crosswalk: {
    ja: "横断歩道 (407-A)",
    en: "Pedestrian Crossing (407-A)",
    zh: "人行横道 (407-A)",
  },
  traffic_light_ahead: {
    ja: "信号機あり (201-2)",
    en: "Traffic Signals Ahead (201-2)",
    zh: "前方信号灯 (201-2)",
  },
  street_name: {
    ja: "道路の通称名 (119)",
    en: "Street Name Sign (119)",
    zh: "道路名称标志 (119)",
  },
  intersection_name: {
    ja: "交差点名標識 (114-A)",
    en: "Intersection Name (114-A)",
    zh: "路口名称标志 (114-A)",
  },
  overhead_guide: {
    ja: "方面及び方向 頭上案内標識 (108-A)",
    en: "Overhead Route Guide (108-A)",
    zh: "龙门架方向引导标志 (108-A)",
  },
  delineator: {
    ja: "視線誘導標 デリネーター",
    en: "Roadside Delineator Post",
    zh: "视线诱导标 (轮廓标)",
  },
};

const ROAD_SIGN_CATEGORY_TRANSLATIONS: Readonly<
  Record<
    "regulatory" | "warning" | "indication" | "guide" | "accessory",
    { ja: string; en: string; zh: string }
  >
> = {
  regulatory: { ja: "規制", en: "Regulatory", zh: "禁令/限制" },
  warning: { ja: "警戒", en: "Warning", zh: "警告" },
  indication: { ja: "指示", en: "Indication", zh: "指示" },
  guide: { ja: "案内", en: "Guide", zh: "指路引导" },
  accessory: { ja: "附属施設", en: "Accessory", zh: "附属设施" },
};

/**
 * UI 全要素の言語別翻訳辞書 (`ja` / `en` / `zh`)
 */
export const UI_TRANSLATIONS: Readonly<Record<SupportedLocale, UiTranslationDictionary>> = {
  ja: {
    documentTitle: "Antigravity Deep Drive - 東京駅・渋谷 3Dドライブシミュレーター",
    headerSubtitle:
      "東京都 PLATEAU (千代田区 13101・渋谷区 13113) × 国土地理院 (GSI DEM5A / 道路中心線) 3Dシミュレーター",
    gisToggleBtn: "GIS情報",
    gisToggleAria: "GISテレメトリ表示切替",
    quickBarAria: "クイック操作バー",
    quickCameraCockpit: "視点: 運転席",
    quickCameraChase: "視点: 追従",
    quickGazeForward: "正面",
    quickGazeForwardTitle: "正面を向く (ダブルタップでもリセット)",
    quickMirrorLeft: "左ミラー",
    quickMirrorLeftTitle: "左ドアミラー確認",
    quickMirrorRear: "ルーム",
    quickMirrorRearTitle: "ルームミラー確認",
    quickMirrorRight: "右ミラー",
    quickMirrorRightTitle: "右ドアミラー確認",
    quickNavGaze: "計器・ナビ",
    quickNavGazeTitle: "車内メーター・カーナビ確認",
    quickAreaTokyo: "エリア: 東京駅",
    quickAreaShibuya: "エリア: 渋谷",
    quickGraphicsTitle: "グラフィック品質切替 (高 / 中 / 低)",
    quickResetBtn: "位置リセット",
    quickLangTitle: "表示言語切替 (日本語 / English / 中文)",
    menuOpenBtn: "環境設定",
    menuCloseBtn: "設定を閉じる",
    gisHeaderMarunouchi: "東京都 PLATEAU 13101 × 国土地理院 GIS",
    gisHeaderShibuya: "東京都 PLATEAU 13113 (渋谷区) × 国土地理院 GIS",
    gisCoordLabel: "座標 / 標高:",
    gisRoadLabel: "GSI 道路網:",
    gisBldgLabel: "PLATEAU 建築:",
    drawerTitle: "環境・視点・シミュレーター設定",
    drawerCloseBtn: "閉じる",
    drawerCloseAria: "設定パネルを閉じる",
    panelLangLabel: "表示言語 (Language) [N]",
    panelAreaLabel: "走行エリア (Area) [P]",
    areaTokyoBtn: "東京駅・丸の内",
    areaShibuyaBtn: "渋谷",
    panelTimePrefix: "時間 (Time) [T] — ",
    panelWeatherLabel: "天候 (Weather)",
    panelSurfaceLabel: "路面状態 (Surface) [G]",
    panelCameraLabel: "カメラ視点 [C]",
    cameraCockpitBtn: "ドライバー視点",
    cameraChaseBtn: "追従視点",
    panelGazePrefix: "視線 (Gaze) [マウス移動 / L·Rスティック / V] — ",
    gazeForwardBtn: "正面 [V]",
    gazeForwardTitle: "正面リセット [V / ダブルクリック]",
    gazeRightMirrorBtn: "右ミラー [Shift+E]",
    gazeRightMirrorTitle: "右ドアミラー確認 [Shift+E]",
    gazeLeftMirrorBtn: "左ミラー [Shift+Q]",
    gazeLeftMirrorTitle: "左ドアミラー確認 [Shift+Q]",
    gazeRearviewMirrorBtn: "ルームミラー [I]",
    gazeRearviewMirrorTitle: "ルームミラー確認 [I]",
    gazeDashboardBtn: "計器・ナビ [K]",
    gazeDashboardTitle: "12.3型メーター・11型ナビ確認 [K]",
    gazeRightShoulderBtn: "右目視 [O]",
    gazeRightShoulderTitle: "右後方目視 [O]",
    gazeLeftShoulderBtn: "左目視 [U]",
    gazeLeftShoulderTitle: "左後方目視 [U]",
    panelWiperLabel: "ワイパー [X]",
    wiperOffBtn: "OFF",
    wiperSlowBtn: "通常",
    wiperFastBtn: "高速",
    panelTurnSignalPrefix: "ウインカー (Turn Signal) [Q / E / Z] — ",
    turnSignalLeftBtn: "◀ 左 [Q]",
    turnSignalRightBtn: "右 ▶ [E]",
    turnSignalHazardBtn: "⚠ ハザード [Z]",
    turnSignalOffBtn: "OFF",
    turnSignalStatusOff: "TURN SIGNAL: OFF",
    turnSignalStatusLeft: "◀ LEFT BLINKER [Q]",
    turnSignalStatusRight: "RIGHT BLINKER ▶ [E]",
    turnSignalStatusHazard: "◀▶ HAZARD [Z]",
    panelBlurLabel: "モーションブラー [B]",
    panelGraphicsPrefix: "グラフィック品質 (Graphics) [F] — ",
    graphicsHighBtn: "高",
    graphicsMediumBtn: "中",
    graphicsLowBtn: "低",
    panelTouchUiLabel: "タッチ操作パッド (Touch UI)",
    touchUiAutoBtn: "自動検出",
    touchUiOnBtn: "常時表示",
    touchUiOffBtn: "非表示",
    panelSignBuilderLabel: "道路標識ビルダー [M]",
    openSignCreatorBtn: "標識作成・配置",
    panelGamepadLabel: "コントローラー (Switch ProCon 1)",
    gamepadStatusStandby: "ProCon 1 待機中 (USB / Bluetooth 接続で自動認識)",
    gamepadStatusConnectedProCon: "Switch ProCon 1 接続中",
    gamepadStatusConnectedGeneric: "ゲームパッド接続中",
    controlsGuideLine1:
      "<kbd>W</kbd>/<kbd>↑</kbd> 加速 | <kbd>S</kbd>/<kbd>↓</kbd> 制動・後退 | <kbd>A</kbd>/<kbd>D</kbd> 操舵 | <kbd>Q</kbd>/<kbd>E</kbd> 左右ウインカー | <kbd>Z</kbd> ハザード | <kbd>Space</kbd> サイドブレーキ | <kbd>R</kbd> リセット",
    controlsGuideLine2:
      "<kbd>マウス移動</kbd> 自由視線 | <kbd>Shift+Q</kbd>/<kbd>Shift+E</kbd> 左右ミラー | <kbd>I</kbd> ルームミラー | <kbd>K</kbd> 計器・ナビ | <kbd>U</kbd>/<kbd>O</kbd> 左右目視 | <kbd>J</kbd>/<kbd>L</kbd> 首振り | <kbd>V</kbd> 正面",
    controlsGuideLine3:
      "<kbd>Tab</kbd> UI OFF切替 | <kbd>P</kbd> エリア切替 | <kbd>C</kbd> 視点切替 | <kbd>T</kbd> 時間切替 | <kbd>G</kbd> 路面状態 | <kbd>X</kbd> ワイパー切替 | <kbd>B</kbd> モーションブラー | <kbd>F</kbd> 画質切替 | <kbd>H</kbd>/<kbd>[</kbd>/<kbd>]</kbd> エンジン音・音量 | <kbd>M</kbd> 標識作成 | <kbd>Y</kbd> アセット管理 | <kbd>N</kbd> 言語切替",
    controlsGuideLine4:
      "<kbd>Switch ProCon 1</kbd> <kbd>Lスティック</kbd> 操舵・視線 | <kbd>ZR</kbd>/<kbd>A</kbd> 加速 | <kbd>ZL</kbd>/<kbd>B</kbd> 制動 | <kbd>Y</kbd> サイド | <kbd>Rスティック</kbd> 視線 | <kbd>L</kbd>/<kbd>R</kbd> 左右ミラー | <kbd>十字</kbd> ミラー・ナビ・ワイパー・時間 | <kbd>L3</kbd> 路面 | <kbd>X</kbd> 視点 | <kbd>-</kbd>/<kbd>+</kbd> エリア/リセット | <kbd>Capture</kbd> 画質",
    blurStatusActive: "MOTION BLUR: ACTIVE",
    blurStatusOff: "MOTION BLUR: OFF",
    touchControllerAria: "タッチ運転コントローラー",
    touchSteerClusterAria: "ステアリング操作",
    touchSteerPadAria: "アナログステアリングパッド",
    touchSteerLeftAria: "左操舵",
    touchSteerLeftMain: "◀ 左",
    touchSteerLeftSub: "STEER L",
    touchSteerRightAria: "右操舵",
    touchSteerRightMain: "右 ▶",
    touchSteerRightSub: "STEER R",
    touchPedalClusterAria: "ペダル操作",
    touchHandbrakeAria: "サイドブレーキ",
    touchHandbrakeSub: "SIDE",
    touchBrakeAria: "ブレーキ・後退",
    touchBrakeSub: "制動 / R",
    touchThrottleAria: "アクセル",
    touchThrottleSub: "加速",
    navDistanceAheadSuffix: "m 先",
    navTargetShibuya: "渋谷ストリーム・R246",
    navTargetMarunouchi: "和田倉門・日比谷通り",
    navRouteSubShibuya: "明治通り → 渋谷ストリーム",
    navRouteSubMarunouchi: "都道404号 → 国道1号",
    navSpeedGearHeader: "SPEED / GEAR",
    navLandmarkHeader: "PLATEAU 3D LANDMARK",
    signDialogTitle: "道路標識作成・配置システム（JDM 道路標識令準拠）",
    signDialogCloseBtn: "閉じる [Esc]",
    signFieldTypeLabel: "標識種別（全15種カタログ）",
    signFieldMainLabel: "主ラベル（日本語名称 / 方面）",
    signFieldMainPlaceholder: "例: 行幸通り / 止まれ",
    signFieldSubLabel: "英語サブラベル",
    signFieldSubPlaceholder: "例: Gyoko-dori Ave. / STOP",
    signFieldAuxLabel: "補助標識テキスト（空欄で省略）",
    signFieldAuxPlaceholder: "例: ここまで / 終日 / 自転車を除く",
    signFieldSpeedLabel: "制限速度 (km/h)",
    signFieldDistanceLabel: "自車前方距離 (m)",
    signFieldOffsetLabel: "左歩道オフセット (m)",
    signPlaceAheadBtn: "自車の前方（左歩道・正対向き）に配置",
    signCopyYamlBtn: "YAML定義をコピー",
    signYamlSectionLabel: "assets.yml 用 宣言的スニペット",
    signCustomListLabel: "配置済みカスタム標識（クリックで削除）",
    signEmptyListMessage:
      "まだカスタム標識は配置されていません。「自車の前方に配置」ボタンでシーンへ追加できます。",
    signDeleteBtnTitle: "この標識を3Dシーンから削除",
    titleScreenBadge: "PLATEAU 3D CITY × GSI ROAD GIS DRIVING SIMULATOR",
    titleScreenSubtitle: "渋谷・東京駅丸の内 3Dオープンデータ走行シミュレーター",
    titleSelectAreaLabel: "走行エリア選択 (デフォルト: 渋谷)",
    titleSelectQualityLabel: "グラフィック品質",
    titleSelectBoostLabel: "シェーダープレビルド (/boost)",
    titleSelectLangLabel: "表示言語 (Language)",
    titleStartDriveBtn: "ドライブ開始 (START DRIVING)",
    titleControlsHint:
      "Enter / Space / クリック / Switch ProCon [A・+] でスタート — W/A/S/D または矢印キーで運転",
    loadingStageInit: "シミュレーターエンジンを初期化中...",
    loadingStageOpenData: "国土地理院 GIS & Project PLATEAU 都市データをロード中...",
    loadingStageTextures: "3D プロシージャル材質・PBR テクスチャを生成中...",
    loadingStagePhysics: "Rapier 3D 物理ワールドと車両サスペンションを構築中...",
    loadingStageCity: "渋谷・丸の内 3D 都市モデルと曲線道路網を生成中...",
    loadingStageShaderPrebuild: "シェーダーをプレビルド中 (/boost)...",
    loadingStageReady: "準備完了 — 渋谷エリアから走行を開始できます",
    panelBoostPrefix: "シェーダープレビルド (/boost) — ",
    boostOnBtn: "ON (/boost)",
    boostOffBtn: "OFF",
    boostBadgePrebuilt: "PREBUILT (/boost)",
    boostBadgeOn: "ON (/boost)",
    boostBadgeOff: "OFF",
    boostStatusPrebuilt: "SHADER BOOST: PREBUILT",
    boostStatusOff: "SHADER BOOST: OFF",
    panelSoundPrefix: "エンジン音 (Engine Sound) [H / [·]] — ",
    soundOnBtn: "ON",
    soundOffBtn: "OFF (消音)",
    soundVolumeAria: "エンジン音量 (Engine Volume) [[ / ]]",
    soundBadgeActive: "ON (2.5L I4 HYBRID)",
    soundBadgeMuted: "MUTED (消音)",
    soundStatusActive: "ENGINE AUDIO: ON",
    soundStatusMuted: "ENGINE AUDIO: MUTED",
    quickSoundOn: "🔊 音: ON",
    quickSoundOff: "🔇 音: OFF",
    quickSoundTitle: "エンジン音 ON / OFF 切替 [H]",
    panelAssetManagerLabel: "Webアセット管理システム [Y]",
    openAssetManagerBtn: "アセット管理を開く",
    quickAssetManagerBtn: "📦 アセット",
    quickAssetManagerTitle: "Webアセット管理システム (/boost 対応) [Y]",
    assetDialogTitle: "Webアセット管理システム（assets.yml × /boost シェーダーパイプライン）",
    assetDialogCloseBtn: "閉じる [Esc]",
    assetRunBoostBtn: "⚡ /boost シェーダープレビルド実行",
    assetResetAllBtn: "規定マニフェストにリセット",
    assetSearchPlaceholder: "アセットID・パス・名称で検索...",
    assetTabModels: "3Dモデル",
    assetTabTextures3d: "3Dテクスチャ",
    assetTabRoads: "道路定義",
    assetTabSigns: "道路標識",
    assetTabWeather: "環境・天候",
    assetTabYaml: "YAML検証・出力",
    gisStreamingLabel: "空間ストリーミング:",
    loadingStagePriorityChunks: "現在地周辺の道路・建物・テクスチャを優先ストリーミング中...",
    loadingRetryBtn: "再試行 (Retry)",
    streamingBannerAreaTitle: "エリア周辺アセットを優先読み込み中...",
    streamingBannerPrefetchTitle: "進行方向エリアをバックグラウンド先読み中...",
    streamingBannerRetryBtn: "再試行",
    streamingStatusLabel: "STREAMING",
    hudUiOffBtn: "👁 UI OFF [Tab]",
    hudUiOffBtnTitle: "UI全パネルを非表示にして3D視界に集中する [Tab]",
    uiRestoreFabBtn: "👁 UI表示 [Tab]",
    uiRestoreFabTitle: "UIを再表示 [Tab]",
    quickUiOffBtn: "👁 UI OFF",
    quickUiOffTitle: "UI全パネルを非表示にして3D視界に集中する [Tab]",
    panelUiVisibilityLabel: "HUD UI表示 (UI Mode) [Tab]",
    uiVisibilityOnBtn: "UI表示 (ON)",
    uiVisibilityOffBtn: "UI OFF (没入モード) [Tab]",
  },
  en: {
    documentTitle: "Antigravity Deep Drive - Tokyo 3D Driving Simulator",
    headerSubtitle:
      "Tokyo PLATEAU (Chiyoda 13101 & Shibuya 13113) × GSI DEM5A / Road Centerline 3D Simulator",
    gisToggleBtn: "GIS Info",
    gisToggleAria: "Toggle GIS Telemetry",
    quickBarAria: "Quick Action Bar",
    quickCameraCockpit: "Cam: Cockpit",
    quickCameraChase: "Cam: Chase",
    quickGazeForward: "Front",
    quickGazeForwardTitle: "Look Forward (or double-tap screen)",
    quickMirrorLeft: "L Mirror",
    quickMirrorLeftTitle: "Check Left Side Mirror",
    quickMirrorRear: "Rearview",
    quickMirrorRearTitle: "Check Rearview Mirror",
    quickMirrorRight: "R Mirror",
    quickMirrorRightTitle: "Check Right Side Mirror",
    quickNavGaze: "Meters/Nav",
    quickNavGazeTitle: "Check Meters & Center Navigation",
    quickAreaTokyo: "Area: Tokyo Sta.",
    quickAreaShibuya: "Area: Shibuya",
    quickGraphicsTitle: "Switch Graphics Quality (High / Med / Low)",
    quickResetBtn: "Reset Pos",
    quickLangTitle: "Switch Language (日本語 / English / 中文)",
    menuOpenBtn: "Settings",
    menuCloseBtn: "Close",
    gisHeaderMarunouchi: "TOKYO PLATEAU 13101 × GSI Japan GIS",
    gisHeaderShibuya: "TOKYO PLATEAU 13113 (Shibuya) × GSI Japan GIS",
    gisCoordLabel: "Coord / Elev:",
    gisRoadLabel: "GSI Road:",
    gisBldgLabel: "PLATEAU Bldg:",
    drawerTitle: "Environment, Camera & Simulator Settings",
    drawerCloseBtn: "Close",
    drawerCloseAria: "Close settings drawer",
    panelLangLabel: "Language [N]",
    panelAreaLabel: "Driving Area [P]",
    areaTokyoBtn: "Tokyo Sta. · Marunouchi",
    areaShibuyaBtn: "Shibuya",
    panelTimePrefix: "Time of Day [T] — ",
    panelWeatherLabel: "Weather",
    panelSurfaceLabel: "Road Surface [G]",
    panelCameraLabel: "Camera View [C]",
    cameraCockpitBtn: "Cockpit View",
    cameraChaseBtn: "Chase View",
    panelGazePrefix: "Driver Gaze [Mouse / L·R-Stick / V] — ",
    gazeForwardBtn: "Front [V]",
    gazeForwardTitle: "Reset Look Forward [V / Double-click]",
    gazeRightMirrorBtn: "R Mirror [Shift+E]",
    gazeRightMirrorTitle: "Check Right Side Mirror [Shift+E]",
    gazeLeftMirrorBtn: "L Mirror [Shift+Q]",
    gazeLeftMirrorTitle: "Check Left Side Mirror [Shift+Q]",
    gazeRearviewMirrorBtn: "Rearview [I]",
    gazeRearviewMirrorTitle: "Check Rearview Mirror [I]",
    gazeDashboardBtn: "Meters & Nav [K]",
    gazeDashboardTitle: 'Check 12.3" Cluster & 11" Nav [K]',
    gazeRightShoulderBtn: "R Blind Spot [O]",
    gazeRightShoulderTitle: "Right Shoulder Check [O]",
    gazeLeftShoulderBtn: "L Blind Spot [U]",
    gazeLeftShoulderTitle: "Left Shoulder Check [U]",
    panelWiperLabel: "Wipers [X]",
    wiperOffBtn: "OFF",
    wiperSlowBtn: "Slow",
    wiperFastBtn: "Fast",
    panelTurnSignalPrefix: "Turn Signal [Q / E / Z] — ",
    turnSignalLeftBtn: "◀ Left [Q]",
    turnSignalRightBtn: "Right ▶ [E]",
    turnSignalHazardBtn: "⚠ Hazard [Z]",
    turnSignalOffBtn: "OFF",
    turnSignalStatusOff: "TURN SIGNAL: OFF",
    turnSignalStatusLeft: "◀ LEFT BLINKER [Q]",
    turnSignalStatusRight: "RIGHT BLINKER ▶ [E]",
    turnSignalStatusHazard: "◀▶ HAZARD [Z]",
    panelBlurLabel: "Motion Blur [B]",
    panelGraphicsPrefix: "Graphics Quality [F] — ",
    graphicsHighBtn: "High",
    graphicsMediumBtn: "Med",
    graphicsLowBtn: "Low",
    panelTouchUiLabel: "Touch Controls (Touch UI)",
    touchUiAutoBtn: "Auto Detect",
    touchUiOnBtn: "Always On",
    touchUiOffBtn: "Hidden",
    panelSignBuilderLabel: "Road Sign Builder [M]",
    openSignCreatorBtn: "Create & Place Sign",
    panelGamepadLabel: "Controller (Switch ProCon 1)",
    gamepadStatusStandby: "ProCon 1 Standby (Connect via USB / Bluetooth)",
    gamepadStatusConnectedProCon: "Switch ProCon 1 Connected",
    gamepadStatusConnectedGeneric: "Gamepad Connected",
    controlsGuideLine1:
      "<kbd>W</kbd>/<kbd>↑</kbd> Accel | <kbd>S</kbd>/<kbd>↓</kbd> Brake/Rev | <kbd>A</kbd>/<kbd>D</kbd> Steer | <kbd>Q</kbd>/<kbd>E</kbd> L/R Blinker | <kbd>Z</kbd> Hazard | <kbd>Space</kbd> Handbrake | <kbd>R</kbd> Reset",
    controlsGuideLine2:
      "<kbd>Mouse</kbd> Free Look | <kbd>Shift+Q</kbd>/<kbd>Shift+E</kbd> L/R Mirror | <kbd>I</kbd> Rearview | <kbd>K</kbd> Nav | <kbd>U</kbd>/<kbd>O</kbd> Blind Spot | <kbd>J</kbd>/<kbd>L</kbd> Turn Head | <kbd>V</kbd> Front",
    controlsGuideLine3:
      "<kbd>Tab</kbd> UI ON/OFF | <kbd>P</kbd> Area | <kbd>C</kbd> Camera | <kbd>T</kbd> Time | <kbd>G</kbd> Surface | <kbd>X</kbd> Wiper | <kbd>B</kbd> Blur | <kbd>F</kbd> Graphics | <kbd>H</kbd>/<kbd>[</kbd>/<kbd>]</kbd> Engine Sound/Vol | <kbd>M</kbd> Sign Builder | <kbd>Y</kbd> Assets | <kbd>N</kbd> Language",
    controlsGuideLine4:
      "<kbd>Switch ProCon 1</kbd> <kbd>L-Stick</kbd> Steer/Gaze | <kbd>ZR</kbd>/<kbd>A</kbd> Accel | <kbd>ZL</kbd>/<kbd>B</kbd> Brake | <kbd>Y</kbd> Handbrake | <kbd>R-Stick</kbd> Gaze | <kbd>L</kbd>/<kbd>R</kbd> L/R Mirror | <kbd>D-Pad</kbd> Mirror/Nav/Wiper/Time | <kbd>L3</kbd> Surface | <kbd>X</kbd> Camera | <kbd>-</kbd>/<kbd>+</kbd> Area/Reset | <kbd>Capture</kbd> Graphics",
    blurStatusActive: "MOTION BLUR: ACTIVE",
    blurStatusOff: "MOTION BLUR: OFF",
    touchControllerAria: "Touch Driving Controls",
    touchSteerClusterAria: "Steering Controls",
    touchSteerPadAria: "Analog Steering Pad",
    touchSteerLeftAria: "Steer Left",
    touchSteerLeftMain: "◀ Left",
    touchSteerLeftSub: "STEER L",
    touchSteerRightAria: "Steer Right",
    touchSteerRightMain: "Right ▶",
    touchSteerRightSub: "STEER R",
    touchPedalClusterAria: "Pedal Controls",
    touchHandbrakeAria: "Handbrake",
    touchHandbrakeSub: "P-BRAKE",
    touchBrakeAria: "Brake / Reverse",
    touchBrakeSub: "BRAKE / R",
    touchThrottleAria: "Throttle",
    touchThrottleSub: "ACCEL",
    navDistanceAheadSuffix: "m ahead",
    navTargetShibuya: "Shibuya Stream / R246",
    navTargetMarunouchi: "Wadakuramon / Hibiya Ave",
    navRouteSubShibuya: "Meiji Ave → Shibuya Stream",
    navRouteSubMarunouchi: "Pref. Rte 404 → Route 1",
    navSpeedGearHeader: "SPEED / GEAR",
    navLandmarkHeader: "PLATEAU 3D LANDMARK",
    signDialogTitle: "3D Road Sign Builder & Structural Validator (JDM Standard)",
    signDialogCloseBtn: "Close [Esc]",
    signFieldTypeLabel: "Sign Type (15 Catalog Presets)",
    signFieldMainLabel: "Primary Label (Road / Destination)",
    signFieldMainPlaceholder: "e.g., Gyoko-dori / STOP",
    signFieldSubLabel: "English Sub-Label",
    signFieldSubPlaceholder: "e.g., Gyoko-dori Ave. / STOP",
    signFieldAuxLabel: "Auxiliary Plate Text (Blank to omit)",
    signFieldAuxPlaceholder: "e.g., End / All Day / Except Bicycles",
    signFieldSpeedLabel: "Speed Limit (km/h)",
    signFieldDistanceLabel: "Distance Ahead (m)",
    signFieldOffsetLabel: "Left Sidewalk Offset (m)",
    signPlaceAheadBtn: "Place Ahead on Left Sidewalk (Facing Car)",
    signCopyYamlBtn: "Copy YAML Definition",
    signYamlSectionLabel: "Declarative Snippet for assets.yml",
    signCustomListLabel: "Placed Custom Signs (Click to delete)",
    signEmptyListMessage:
      "No custom signs placed yet. Click 'Place Ahead on Left Sidewalk' to add one to the 3D scene.",
    signDeleteBtnTitle: "Remove this sign from 3D scene",
    titleScreenBadge: "PLATEAU 3D CITY × GSI ROAD GIS DRIVING SIMULATOR",
    titleScreenSubtitle: "Shibuya & Tokyo Marunouchi 3D Open-Data Driving Simulator",
    titleSelectAreaLabel: "Select Driving Area (Default: Shibuya)",
    titleSelectQualityLabel: "Graphics Quality",
    titleSelectBoostLabel: "Shader Prebuild (/boost)",
    titleSelectLangLabel: "Language",
    titleStartDriveBtn: "START DRIVING",
    titleControlsHint:
      "Press Enter / Space / Click / Switch ProCon [A or +] to Start — Drive with W/A/S/D or Arrow Keys",
    loadingStageInit: "Initializing simulator engine...",
    loadingStageOpenData: "Loading GSI Road Centerline & Project PLATEAU 3D city data...",
    loadingStageTextures: "Generating 3D procedural shaders & PBR textures...",
    loadingStagePhysics: "Building Rapier 3D physics world & vehicle suspension...",
    loadingStageCity: "Constructing Shibuya & Marunouchi 3D city & curved road network...",
    loadingStageShaderPrebuild: "Prebuilding shaders (/boost)...",
    loadingStageReady: "Ready — Start driving in Shibuya",
    panelBoostPrefix: "Shader Prebuild (/boost) — ",
    boostOnBtn: "ON (/boost)",
    boostOffBtn: "OFF",
    boostBadgePrebuilt: "PREBUILT (/boost)",
    boostBadgeOn: "ON (/boost)",
    boostBadgeOff: "OFF",
    boostStatusPrebuilt: "SHADER BOOST: PREBUILT",
    boostStatusOff: "SHADER BOOST: OFF",
    panelSoundPrefix: "Engine Sound [H / [·]] — ",
    soundOnBtn: "ON",
    soundOffBtn: "OFF (Mute)",
    soundVolumeAria: "Engine Sound Volume [[ / ]]",
    soundBadgeActive: "ON (2.5L I4 HYBRID)",
    soundBadgeMuted: "MUTED",
    soundStatusActive: "ENGINE AUDIO: ON",
    soundStatusMuted: "ENGINE AUDIO: MUTED",
    quickSoundOn: "🔊 Sound: ON",
    quickSoundOff: "🔇 Sound: OFF",
    quickSoundTitle: "Toggle Engine Sound ON / OFF [H]",
    panelAssetManagerLabel: "Web Asset Manager [Y]",
    openAssetManagerBtn: "Open Asset Manager",
    quickAssetManagerBtn: "📦 Assets",
    quickAssetManagerTitle: "Web Asset Management System (/boost) [Y]",
    assetDialogTitle: "Web Asset Management System (assets.yml × /boost Shader Pipeline)",
    assetDialogCloseBtn: "Close [Esc]",
    assetRunBoostBtn: "⚡ Run /boost Shader Prebuild",
    assetResetAllBtn: "Reset to Default Manifest",
    assetSearchPlaceholder: "Search assets by ID, path, or name...",
    assetTabModels: "3D Models",
    assetTabTextures3d: "3D Textures",
    assetTabRoads: "Roads",
    assetTabSigns: "Road Signs",
    assetTabWeather: "Weather",
    assetTabYaml: "YAML Manifest",
    gisStreamingLabel: "Open-World Stream:",
    loadingStagePriorityChunks: "Streaming priority roads, buildings & textures around start...",
    loadingRetryBtn: "Retry Loading",
    streamingBannerAreaTitle: "Streaming priority assets for target area...",
    streamingBannerPrefetchTitle: "Prefetching forward chunks in background...",
    streamingBannerRetryBtn: "Retry",
    streamingStatusLabel: "STREAMING",
    hudUiOffBtn: "👁 UI OFF [Tab]",
    hudUiOffBtnTitle: "Hide all HUD panels for immersive driving [Tab]",
    uiRestoreFabBtn: "👁 Show UI [Tab]",
    uiRestoreFabTitle: "Restore HUD UI [Tab]",
    quickUiOffBtn: "👁 UI OFF",
    quickUiOffTitle: "Hide all HUD panels for immersive driving [Tab]",
    panelUiVisibilityLabel: "HUD Visibility (UI Mode) [Tab]",
    uiVisibilityOnBtn: "UI ON",
    uiVisibilityOffBtn: "UI OFF (Immersive) [Tab]",
  },
  zh: {
    documentTitle: "Antigravity Deep Drive - 东京站・涩谷 3D驾驶模拟器",
    headerSubtitle:
      "东京都 PLATEAU (千代田区 13101・涩谷区 13113) × 国土地理院 (GSI DEM5A / 道路中心线) 3D模拟器",
    gisToggleBtn: "GIS信息",
    gisToggleAria: "切换GIS遥测信息显示",
    quickBarAria: "快捷操作栏",
    quickCameraCockpit: "视角: 驾驶席",
    quickCameraChase: "视角: 跟随",
    quickGazeForward: "正前",
    quickGazeForwardTitle: "看向正前方 (也可双击屏幕重置)",
    quickMirrorLeft: "左后视镜",
    quickMirrorLeftTitle: "查看左侧后视镜",
    quickMirrorRear: "内后视镜",
    quickMirrorRearTitle: "查看车内后视镜",
    quickMirrorRight: "右后视镜",
    quickMirrorRightTitle: "查看右侧后视镜",
    quickNavGaze: "仪表・导航",
    quickNavGazeTitle: "查看车内仪表与中控导航",
    quickAreaTokyo: "区域: 东京站",
    quickAreaShibuya: "区域: 涩谷",
    quickGraphicsTitle: "切换图形画质 (高 / 中 / 低)",
    quickResetBtn: "重置位置",
    quickLangTitle: "切换显示语言 (日本語 / English / 中文)",
    menuOpenBtn: "环境设置",
    menuCloseBtn: "关闭设置",
    gisHeaderMarunouchi: "东京都 PLATEAU 13101 × 国土地理院 GIS",
    gisHeaderShibuya: "东京都 PLATEAU 13113 (涩谷区) × 国土地理院 GIS",
    gisCoordLabel: "坐标 / 海拔:",
    gisRoadLabel: "GSI 道路网:",
    gisBldgLabel: "PLATEAU 建筑:",
    drawerTitle: "环境・视角・模拟器设置",
    drawerCloseBtn: "关闭",
    drawerCloseAria: "关闭设置面板",
    panelLangLabel: "显示语言 (Language) [N]",
    panelAreaLabel: "驾驶区域 (Area) [P]",
    areaTokyoBtn: "东京站・丸之内",
    areaShibuyaBtn: "涩谷",
    panelTimePrefix: "时间段 (Time) [T] — ",
    panelWeatherLabel: "天气 (Weather)",
    panelSurfaceLabel: "路面状态 (Surface) [G]",
    panelCameraLabel: "摄像机视角 [C]",
    cameraCockpitBtn: "驾驶席视角",
    cameraChaseBtn: "跟随视角",
    panelGazePrefix: "视线 (Gaze) [鼠标移动 / 左右摇杆 / V] — ",
    gazeForwardBtn: "正前 [V]",
    gazeForwardTitle: "重置正前视线 [V / 双击]",
    gazeRightMirrorBtn: "右后视镜 [Shift+E]",
    gazeRightMirrorTitle: "查看右外后视镜 [Shift+E]",
    gazeLeftMirrorBtn: "左后视镜 [Shift+Q]",
    gazeLeftMirrorTitle: "查看左外后视镜 [Shift+Q]",
    gazeRearviewMirrorBtn: "内后视镜 [I]",
    gazeRearviewMirrorTitle: "查看车内后视镜 [I]",
    gazeDashboardBtn: "仪表・导航 [K]",
    gazeDashboardTitle: "查看12.3寸仪表与11寸导航 [K]",
    gazeRightShoulderBtn: "右盲区 [O]",
    gazeRightShoulderTitle: "右后方盲区观察 [O]",
    gazeLeftShoulderBtn: "左盲区 [U]",
    gazeLeftShoulderTitle: "左后方盲区观察 [U]",
    panelWiperLabel: "雨刷器 [X]",
    wiperOffBtn: "关闭",
    wiperSlowBtn: "普通",
    wiperFastBtn: "快速",
    panelTurnSignalPrefix: "转向灯 (Turn Signal) [Q / E / Z] — ",
    turnSignalLeftBtn: "◀ 左转向 [Q]",
    turnSignalRightBtn: "右转向 ▶ [E]",
    turnSignalHazardBtn: "⚠ 双闪 [Z]",
    turnSignalOffBtn: "关闭",
    turnSignalStatusOff: "TURN SIGNAL: OFF",
    turnSignalStatusLeft: "◀ 左转向灯 [Q]",
    turnSignalStatusRight: "右转向灯 ▶ [E]",
    turnSignalStatusHazard: "◀▶ 双闪警示灯 [Z]",
    panelBlurLabel: "动态模糊 [B]",
    panelGraphicsPrefix: "图形画质 (Graphics) [F] — ",
    graphicsHighBtn: "高",
    graphicsMediumBtn: "中",
    graphicsLowBtn: "低",
    panelTouchUiLabel: "触控面板 (Touch UI)",
    touchUiAutoBtn: "自动检测",
    touchUiOnBtn: "始终显示",
    touchUiOffBtn: "隐藏",
    panelSignBuilderLabel: "道路标志生成器 [M]",
    openSignCreatorBtn: "创建并放置标志",
    panelGamepadLabel: "手柄控制 (Switch ProCon 1)",
    gamepadStatusStandby: "ProCon 1 待机中 (连接 USB / 蓝牙自动识别)",
    gamepadStatusConnectedProCon: "Switch ProCon 1 已连接",
    gamepadStatusConnectedGeneric: "游戏手柄已连接",
    controlsGuideLine1:
      "<kbd>W</kbd>/<kbd>↑</kbd> 加速 | <kbd>S</kbd>/<kbd>↓</kbd> 刹车・倒车 | <kbd>A</kbd>/<kbd>D</kbd> 转向 | <kbd>Q</kbd>/<kbd>E</kbd> 左右转向灯 | <kbd>Z</kbd> 双闪 | <kbd>Space</kbd> 手刹 | <kbd>R</kbd> 重置",
    controlsGuideLine2:
      "<kbd>鼠标移动</kbd> 自由视线 | <kbd>Shift+Q</kbd>/<kbd>Shift+E</kbd> 左右后视镜 | <kbd>I</kbd> 内后视镜 | <kbd>K</kbd> 仪表・导航 | <kbd>U</kbd>/<kbd>O</kbd> 左右盲区 | <kbd>J</kbd>/<kbd>L</kbd> 转头 | <kbd>V</kbd> 正前",
    controlsGuideLine3:
      "<kbd>Tab</kbd> UI显隐 | <kbd>P</kbd> 区域切换 | <kbd>C</kbd> 视角切换 | <kbd>T</kbd> 时间切换 | <kbd>G</kbd> 路面状态 | <kbd>X</kbd> 雨刷切换 | <kbd>B</kbd> 动态模糊 | <kbd>F</kbd> 画质切换 | <kbd>H</kbd>/<kbd>[</kbd>/<kbd>]</kbd> 引擎音效・音量 | <kbd>M</kbd> 标志生成 | <kbd>Y</kbd> 资产管理 | <kbd>N</kbd> 语言切换",
    controlsGuideLine4:
      "<kbd>Switch ProCon 1</kbd> <kbd>左摇杆</kbd> 转向・视线 | <kbd>ZR</kbd>/<kbd>A</kbd> 加速 | <kbd>ZL</kbd>/<kbd>B</kbd> 刹车 | <kbd>Y</kbd> 手刹 | <kbd>右摇杆</kbd> 视线 | <kbd>L</kbd>/<kbd>R</kbd> 左右后视镜 | <kbd>十字键</kbd> 后视镜・导航・雨刷・时间 | <kbd>L3</kbd> 路面 | <kbd>X</kbd> 视角 | <kbd>-</kbd>/<kbd>+</kbd> 区域/重置 | <kbd>Capture</kbd> 画质",
    blurStatusActive: "MOTION BLUR: ACTIVE",
    blurStatusOff: "MOTION BLUR: OFF",
    touchControllerAria: "触控驾驶控制器",
    touchSteerClusterAria: "转向控制",
    touchSteerPadAria: "模拟转向触摸板",
    touchSteerLeftAria: "向左转向",
    touchSteerLeftMain: "◀ 左",
    touchSteerLeftSub: "STEER L",
    touchSteerRightAria: "向右转向",
    touchSteerRightMain: "右 ▶",
    touchSteerRightSub: "STEER R",
    touchPedalClusterAria: "踏板控制",
    touchHandbrakeAria: "手刹",
    touchHandbrakeSub: "手刹",
    touchBrakeAria: "刹车・倒车",
    touchBrakeSub: "制动 / R",
    touchThrottleAria: "油门",
    touchThrottleSub: "加速",
    navDistanceAheadSuffix: "m 前方",
    navTargetShibuya: "涩谷Stream・国道246",
    navTargetMarunouchi: "和田仓门・日比谷通",
    navRouteSubShibuya: "明治通 → 涩谷Stream",
    navRouteSubMarunouchi: "都道404号 → 国道1号",
    navSpeedGearHeader: "SPEED / GEAR",
    navLandmarkHeader: "PLATEAU 3D LANDMARK",
    signDialogTitle: "道路标志创建与放置系统（符合日本道路标志令）",
    signDialogCloseBtn: "关闭 [Esc]",
    signFieldTypeLabel: "标志类型（全15种目录）",
    signFieldMainLabel: "主标签（道路名 / 方向）",
    signFieldMainPlaceholder: "例: 行幸通 / 止まれ",
    signFieldSubLabel: "英文副标签",
    signFieldSubPlaceholder: "例: Gyoko-dori Ave. / STOP",
    signFieldAuxLabel: "辅助标志文本（留空省略）",
    signFieldAuxPlaceholder: "例: ここまで / 終日 / 自転車を除く",
    signFieldSpeedLabel: "限速值 (km/h)",
    signFieldDistanceLabel: "车辆前方距离 (m)",
    signFieldOffsetLabel: "左侧人行道偏移 (m)",
    signPlaceAheadBtn: "放置在车辆前方（左侧人行道・正对方向）",
    signCopyYamlBtn: "复制 YAML 定义",
    signYamlSectionLabel: "assets.yml 声明式代码片段",
    signCustomListLabel: "已放置自定义标志（点击删除）",
    signEmptyListMessage: "尚未放置自定义标志。点击“放置在车辆前方”按钮即可添加到3D场景中。",
    signDeleteBtnTitle: "从3D场景中移除此标志",
    titleScreenBadge: "PLATEAU 3D CITY × GSI ROAD GIS DRIVING SIMULATOR",
    titleScreenSubtitle: "涩谷・东京站丸之内 3D开放数据驾驶模拟器",
    titleSelectAreaLabel: "选择驾驶区域 (默认: 涩谷)",
    titleSelectQualityLabel: "图形画质",
    titleSelectBoostLabel: "着色器预编译 (/boost)",
    titleSelectLangLabel: "显示语言 (Language)",
    titleStartDriveBtn: "开始驾驶 (START DRIVING)",
    titleControlsHint:
      "按 Enter / Space / 点击 / Switch ProCon [A・+] 开始 — 使用 W/A/S/D 或方向键驾驶",
    loadingStageInit: "正在初始化模拟器引擎...",
    loadingStageOpenData: "正在加载国土地理院 GIS 与 Project PLATEAU 城市数据...",
    loadingStageTextures: "正在生成 3D 程序化材质与 PBR 纹理...",
    loadingStagePhysics: "正在构建 Rapier 3D 物理世界与车辆悬架...",
    loadingStageCity: "正在构建涩谷・丸之内 3D 城市模型与曲线道路网...",
    loadingStageShaderPrebuild: "正在预编译着色器 (/boost)...",
    loadingStageReady: "准备就绪 — 可从涩谷区域开始驾驶",
    panelBoostPrefix: "着色器预编译 (/boost) — ",
    boostOnBtn: "ON (/boost)",
    boostOffBtn: "OFF",
    boostBadgePrebuilt: "已预编译 (/boost)",
    boostBadgeOn: "开启 (/boost)",
    boostBadgeOff: "关闭",
    boostStatusPrebuilt: "SHADER BOOST: 已预编译",
    boostStatusOff: "SHADER BOOST: OFF",
    panelSoundPrefix: "引擎音效 (Engine Sound) [H / [·]] — ",
    soundOnBtn: "开启",
    soundOffBtn: "静音",
    soundVolumeAria: "引擎音量 (Engine Volume) [[ / ]]",
    soundBadgeActive: "开启 (2.5L I4 HYBRID)",
    soundBadgeMuted: "已静音 (MUTED)",
    soundStatusActive: "ENGINE AUDIO: 开启",
    soundStatusMuted: "ENGINE AUDIO: 已静音",
    quickSoundOn: "🔊 音效: 开",
    quickSoundOff: "🔇 音效: 关",
    quickSoundTitle: "切换引擎音效 开启 / 静音 [H]",
    panelAssetManagerLabel: "Web资产管理系统 [Y]",
    openAssetManagerBtn: "打开资产管理",
    quickAssetManagerBtn: "📦 资产",
    quickAssetManagerTitle: "Web资产管理系统 (/boost) [Y]",
    assetDialogTitle: "Web资产管理系统（assets.yml × /boost 着色器管线）",
    assetDialogCloseBtn: "关闭 [Esc]",
    assetRunBoostBtn: "⚡ 运行 /boost 着色器预编译",
    assetResetAllBtn: "重置为默认清单",
    assetSearchPlaceholder: "按资产 ID、路径或名称搜索...",
    assetTabModels: "3D模型",
    assetTabTextures3d: "3D纹理",
    assetTabRoads: "道路定义",
    assetTabSigns: "道路标志",
    assetTabWeather: "天气环境",
    assetTabYaml: "YAML验证导出",
    gisStreamingLabel: "开放世界流式加载:",
    loadingStagePriorityChunks: "正在优先流式加载起点周边的道路、建筑与纹理...",
    loadingRetryBtn: "重试加载 (Retry)",
    streamingBannerAreaTitle: "正在优先加载目标区域资产...",
    streamingBannerPrefetchTitle: "正在后台预加载前方区域...",
    streamingBannerRetryBtn: "重试",
    streamingStatusLabel: "STREAMING",
    hudUiOffBtn: "👁 隐藏UI [Tab]",
    hudUiOffBtnTitle: "隐藏所有HUD面板进入沉浸驾驶模式 [Tab]",
    uiRestoreFabBtn: "👁 显示UI [Tab]",
    uiRestoreFabTitle: "恢复显示HUD界面 [Tab]",
    quickUiOffBtn: "👁 隐藏UI",
    quickUiOffTitle: "隐藏所有HUD面板进入沉浸驾驶模式 [Tab]",
    panelUiVisibilityLabel: "HUD界面显示 (UI Mode) [Tab]",
    uiVisibilityOnBtn: "显示UI (ON)",
    uiVisibilityOffBtn: "隐藏UI (沉浸模式) [Tab]",
  },
};

export function getUiTranslations(locale: SupportedLocale = "ja"): UiTranslationDictionary {
  return UI_TRANSLATIONS[locale];
}

export function localizeTimeOfDaySummaryLabel(
  timeOfDay: TimeOfDay,
  locale: SupportedLocale = "ja",
): string {
  return TIME_OF_DAY_SUMMARY_LABELS[locale][timeOfDay];
}

export function localizeTimeOfDayButtonLabel(
  timeOfDay: TimeOfDay,
  locale: SupportedLocale = "ja",
): string {
  return TIME_OF_DAY_BUTTON_LABELS[locale][timeOfDay];
}

export function localizeWeatherSummaryLabel(
  weather: WeatherCondition,
  locale: SupportedLocale = "ja",
): string {
  return WEATHER_SUMMARY_LABELS[locale][weather];
}

export function localizeWeatherButtonLabel(
  weather: WeatherCondition,
  locale: SupportedLocale = "ja",
): string {
  return WEATHER_BUTTON_LABELS[locale][weather];
}

export function localizeRoadSurfaceLabel(
  surface: RoadSurfaceCondition,
  locale: SupportedLocale = "ja",
): string {
  return ROAD_SURFACE_LOCALIZED_LABELS[locale][surface];
}

export function localizeRoadSurfaceButtonLabel(
  surface: RoadSurfaceCondition,
  locale: SupportedLocale = "ja",
): string {
  return ROAD_SURFACE_BUTTON_LABELS[locale][surface];
}

export function localizeCameraModeLabel(mode: CameraMode, locale: SupportedLocale = "ja"): string {
  return CAMERA_MODE_LABELS[locale][mode];
}

export function localizeGazePresetLabel(
  preset: GazePreset,
  locale: SupportedLocale = "ja",
): string {
  return GAZE_PRESET_LABELS[locale][preset];
}

export function localizeWiperButtonLabel(wiper: WiperMode, locale: SupportedLocale = "ja"): string {
  const dict = UI_TRANSLATIONS[locale];
  const isOff = wiper === "off";
  if (isOff) {
    return dict.wiperOffBtn;
  }
  const isSlow = wiper === "slow";
  if (isSlow) {
    return dict.wiperSlowBtn;
  }
  return dict.wiperFastBtn;
}

export function localizeGraphicsQualityTexts(
  quality: GraphicsQuality,
  locale: SupportedLocale = "ja",
): { label: string; badgeText: string; quickChipText: string; hudStatusText: string } {
  return GRAPHICS_QUALITY_LOCALIZED[locale][quality];
}

export function localizeGamepadStatusText(
  status: { connected: boolean; isSwitchProCon1: boolean },
  locale: SupportedLocale = "ja",
): string {
  const dict = UI_TRANSLATIONS[locale];
  const isDisconnected = !status.connected;
  if (isDisconnected) {
    return dict.gamepadStatusStandby;
  }
  const isSwitchPro = status.isSwitchProCon1;
  if (isSwitchPro) {
    return dict.gamepadStatusConnectedProCon;
  }
  return dict.gamepadStatusConnectedGeneric;
}

export function localizeRoadDisplayName(
  displayNameJa: string,
  locale: SupportedLocale = "ja",
): string {
  const isJapanese = locale === "ja";
  if (isJapanese) {
    return displayNameJa;
  }
  const entry = ROAD_DISPLAY_NAME_TRANSLATIONS[displayNameJa];
  const isMissingTranslation = entry === undefined;
  if (isMissingTranslation) {
    return displayNameJa;
  }
  return locale === "en" ? entry.en : entry.zh;
}

export function localizeRoadCategory(rdCtgJa: string, locale: SupportedLocale = "ja"): string {
  const isJapanese = locale === "ja";
  if (isJapanese) {
    return rdCtgJa;
  }
  const entry = ROAD_CATEGORY_TRANSLATIONS[rdCtgJa];
  const isMissingTranslation = entry === undefined;
  if (isMissingTranslation) {
    return rdCtgJa;
  }
  return locale === "en" ? entry.en : entry.zh;
}

export function localizeRoadWidthRank(rnkWidthJa: string, locale: SupportedLocale = "ja"): string {
  const isJapanese = locale === "ja";
  if (isJapanese) {
    return rnkWidthJa;
  }
  const entry = ROAD_WIDTH_RANK_TRANSLATIONS[rnkWidthJa];
  const isMissingTranslation = entry === undefined;
  if (isMissingTranslation) {
    return rnkWidthJa;
  }
  return locale === "en" ? entry.en : entry.zh;
}

export function localizeBuildingName(
  building: { buildingId?: string; name: string; nameEn?: string },
  locale: SupportedLocale = "ja",
): string {
  const isJapanese = locale === "ja";
  if (isJapanese) {
    return building.name;
  }
  const isEnglish = locale === "en";
  if (isEnglish) {
    const hasEnglishName = typeof building.nameEn === "string" && building.nameEn.trim().length > 0;
    return hasEnglishName && building.nameEn ? building.nameEn : building.name;
  }
  const zhName = building.buildingId ? BUILDING_NAME_ZH_BY_ID[building.buildingId] : undefined;
  const hasZhName = typeof zhName === "string" && zhName.length > 0;
  return hasZhName && zhName ? zhName : building.name;
}

export function formatGsiRoadTelemetry(
  road: { displayName: string; rdCtg: string; rnkWidth: string; rID: string },
  locale: SupportedLocale = "ja",
): string {
  const name = localizeRoadDisplayName(road.displayName, locale);
  const category = localizeRoadCategory(road.rdCtg, locale);
  const widthRank = localizeRoadWidthRank(road.rnkWidth, locale);
  const widthLabel = locale === "en" ? "Width" : locale === "zh" ? "路宽" : "幅員";
  return `${name} [${category} / ${widthLabel} ${widthRank} / rID:${road.rID}]`;
}

export function formatLabelPair(
  first: string,
  second: string,
  locale: SupportedLocale = "ja",
): string {
  const isEnglish = locale === "en";
  const separator = isEnglish ? " · " : "・";
  return `${first}${separator}${second}`;
}

export function formatPlateauBuildingTelemetry(
  building: {
    buildingId: string;
    name: string;
    nameEn?: string;
    measuredHeight: number;
    storeysAboveGround: number;
  },
  locale: SupportedLocale = "ja",
): string {
  const name = localizeBuildingName(building, locale);
  const floorText =
    locale === "en"
      ? `${building.storeysAboveGround}F`
      : locale === "zh"
        ? `地上${building.storeysAboveGround}层`
        : `地上${building.storeysAboveGround}F`;
  const pairText = formatLabelPair(`H=${building.measuredHeight}m`, floorText, locale);
  return `${name} (${building.buildingId} / ${pairText})`;
}

export function localizeRoadSignTitle(
  type: RoadSignType,
  defaultTitleJa: string,
  locale: SupportedLocale = "ja",
): string {
  const entry = ROAD_SIGN_TITLE_TRANSLATIONS[type];
  const isMissingEntry = entry === undefined;
  if (isMissingEntry) {
    return defaultTitleJa;
  }
  return entry[locale];
}

export function localizeRoadSignCategory(
  category: "regulatory" | "warning" | "indication" | "guide" | "accessory",
  locale: SupportedLocale = "ja",
): string {
  return ROAD_SIGN_CATEGORY_TRANSLATIONS[category][locale];
}

export function formatSignValidationStatus(
  validation: {
    valid: boolean;
    boardTopY: number;
    poleTopY: number;
    poleClearanceFromTop: number;
    issues: string[];
  },
  locale: SupportedLocale = "ja",
): string {
  const clearanceCm = (validation.poleClearanceFromTop * 100).toFixed(1);
  const isValidStructure = validation.valid;
  if (isValidStructure) {
    const isEnglish = locale === "en";
    if (isEnglish) {
      return `Validation OK — Board top ${validation.boardTopY}m / Pole top ${validation.poleTopY}m (Clearance ${clearanceCm}cm) / Back ribs & front plane OK`;
    }
    const isChinese = locale === "zh";
    if (isChinese) {
      return `结构验证通过 — 标志牌顶 ${validation.boardTopY}m / 支柱顶 ${validation.poleTopY}m (余量 ${clearanceCm}cm) / 背部加固肋与正面朝向正常`;
    }
    return `構造検証 OK — 看板上端 ${validation.boardTopY}m / 支柱天端 ${validation.poleTopY}m (余裕 ${clearanceCm}cm) / 裏リブ金具・正立面 OK`;
  }

  const joinedIssues = validation.issues.join(" / ");
  const isEnglish = locale === "en";
  if (isEnglish) {
    return `Validation Failed — ${joinedIssues}`;
  }
  const isChinese = locale === "zh";
  if (isChinese) {
    return `结构验证未通过 — ${joinedIssues}`;
  }
  return `構造検証 NG — ${joinedIssues}`;
}

export function getNavigationMapLabels(
  isShibuyaZone: boolean,
  locale: SupportedLocale = "ja",
): ReadonlyArray<{ text: string; x: number; z: number; color: string }> {
  if (isShibuyaZone) {
    const isEnglish = locale === "en";
    if (isEnglish) {
      return [
        { text: "Shibuya Stream", x: -695, z: -15, color: "#fde047" },
        { text: "Scramble Square", x: -808, z: 145, color: "#93c5fd" },
        { text: "Shibuya Hikarie", x: -692, z: 162, color: "#e2e8f0" },
        { text: "Sakura Stage", x: -808, z: -28, color: "#fca5a5" },
        { text: "Shibuya River", x: -726, z: -85, color: "#7dd3fc" },
        { text: "Meiji-dori Ave", x: -750, z: 30, color: "#86efac" },
        { text: "Route 246 (Aoyama)", x: -660, z: 95, color: "#86efac" },
      ];
    }
    const isChinese = locale === "zh";
    if (isChinese) {
      return [
        { text: "涩谷Stream", x: -695, z: -15, color: "#fde047" },
        { text: "涩谷Scramble广场", x: -808, z: 145, color: "#93c5fd" },
        { text: "涩谷Hikarie", x: -692, z: 162, color: "#e2e8f0" },
        { text: "涩谷Sakura Stage", x: -808, z: -28, color: "#fca5a5" },
        { text: "涩谷川步道", x: -726, z: -85, color: "#7dd3fc" },
        { text: "明治通", x: -750, z: 30, color: "#86efac" },
        { text: "国道246号 (青山通)", x: -660, z: 95, color: "#86efac" },
      ];
    }
    return [
      { text: "渋谷ストリーム", x: -695, z: -15, color: "#fde047" },
      { text: "渋谷スクランブルSQ", x: -808, z: 145, color: "#93c5fd" },
      { text: "渋谷ヒカリエ", x: -692, z: 162, color: "#e2e8f0" },
      { text: "渋谷サクラステージ", x: -808, z: -28, color: "#fca5a5" },
      { text: "渋谷川プロムナード", x: -726, z: -85, color: "#7dd3fc" },
      { text: "明治通り", x: -750, z: 30, color: "#86efac" },
      { text: "国道246号 (青山通り)", x: -660, z: 95, color: "#86efac" },
    ];
  }

  const isEnglish = locale === "en";
  if (isEnglish) {
    return [
      { text: "Tokyo Station", x: 0, z: -25, color: "#fca5a5" },
      { text: "Marunouchi Bldg", x: 64, z: 62, color: "#e2e8f0" },
      { text: "Shin-Maru Bldg", x: -64, z: 62, color: "#e2e8f0" },
      { text: "Marunouchi Nakadori", x: 85, z: 165, color: "#fde68a" },
      { text: "Wadakuramon", x: 0, z: 255, color: "#86efac" },
      { text: "Uchibori / Imperial Plz", x: 0, z: 365, color: "#86efac" },
      { text: "Otemachi / Eitai Ave", x: -268, z: 165, color: "#93c5fd" },
      { text: "Yurakucho / Babasakimon", x: 270, z: 250, color: "#93c5fd" },
    ];
  }
  const isChinese = locale === "zh";
  if (isChinese) {
    return [
      { text: "东京站", x: 0, z: -25, color: "#fca5a5" },
      { text: "丸之内大厦", x: 64, z: 62, color: "#e2e8f0" },
      { text: "新丸之内大厦", x: -64, z: 62, color: "#e2e8f0" },
      { text: "丸之内仲通", x: 85, z: 165, color: "#fde68a" },
      { text: "皇居・和田仓门", x: 0, z: 255, color: "#86efac" },
      { text: "内堀通・皇居外苑", x: 0, z: 365, color: "#86efac" },
      { text: "大手町・永代通", x: -268, z: 165, color: "#93c5fd" },
      { text: "有乐町・马场先门", x: 270, z: 250, color: "#93c5fd" },
    ];
  }
  return [
    { text: "東京駅", x: 0, z: -25, color: "#fca5a5" },
    { text: "丸ビル", x: 64, z: 62, color: "#e2e8f0" },
    { text: "新丸ビル", x: -64, z: 62, color: "#e2e8f0" },
    { text: "丸の内仲通り", x: 85, z: 165, color: "#fde68a" },
    { text: "皇居・和田倉門", x: 0, z: 255, color: "#86efac" },
    { text: "内堀通り・皇居外苑", x: 0, z: 365, color: "#86efac" },
    { text: "大手町・永代通り", x: -268, z: 165, color: "#93c5fd" },
    { text: "有楽町・馬場先門", x: 270, z: 250, color: "#93c5fd" },
  ];
}

export type LocaleChangeListener = (locale: SupportedLocale) => void;

/**
 * アプリケーション全体の言語状態 (`ja` | `en` | `zh`) を管理し、
 * ブラウザ設定に基づく初期化とリアクティブな言語切替通知を提供するマネージャー
 */
export class I18nManager {
  private currentLocale: SupportedLocale;
  private readonly listeners = new Set<LocaleChangeListener>();

  constructor(initialLocale?: SupportedLocale) {
    this.currentLocale = initialLocale ?? resolveInitialLocale();
  }

  public getLocale(): SupportedLocale {
    return this.currentLocale;
  }

  public t(): UiTranslationDictionary {
    return UI_TRANSLATIONS[this.currentLocale];
  }

  public setLocale(nextLocale: SupportedLocale): void {
    const isSame = this.currentLocale === nextLocale;
    if (isSame) {
      return;
    }
    const previousLocale = this.currentLocale;
    this.currentLocale = nextLocale;

    logger.withTrace(
      "i18n",
      "locale.change",
      () => {
        for (const listener of this.listeners) {
          listener(nextLocale);
        }
      },
      {
        previousLocale,
        nextLocale,
        htmlLang: LOCALE_HTML_LANG[nextLocale],
      },
    );
  }

  public cycleLocale(): SupportedLocale {
    const next = getNextLocale(this.currentLocale);
    this.setLocale(next);
    return next;
  }

  public onChange(listener: LocaleChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const i18n = new I18nManager();

/**
 * DOM 上の静的 UI ラベル・プレースホルダー・アクセシビリティ属性 (`aria-label`, `title`, `<html lang>`) を
 * 指定されたロケールに一括同期する。
 */
export function applyDocumentTranslations(
  locale: SupportedLocale,
  doc: Document | undefined = typeof document !== "undefined" ? document : undefined,
): void {
  const isMissingDoc = doc === undefined;
  if (isMissingDoc) {
    return;
  }

  const dict = UI_TRANSLATIONS[locale];
  const hasDocElement = Boolean(doc.documentElement);
  if (hasDocElement) {
    doc.documentElement.lang = LOCALE_HTML_LANG[locale];
  }
  doc.title = dict.documentTitle;

  const setText = (selector: string, text: string): void => {
    const el = doc.querySelector<HTMLElement>(selector);
    const hasEl = el !== null;
    if (hasEl) {
      el.textContent = text;
    }
  };

  const setHtml = (selector: string, html: string): void => {
    const el = doc.querySelector<HTMLElement>(selector);
    const hasEl = el !== null;
    if (hasEl) {
      el.innerHTML = html;
    }
  };

  const setAttr = (selector: string, attr: string, value: string): void => {
    const el = doc.querySelector<HTMLElement>(selector);
    const hasEl = el !== null;
    if (hasEl) {
      el.setAttribute(attr, value);
    }
  };

  // ヘッダー & GIS トグルボタン & UI OFF トグルボタン
  setText("#header-subtitle-text", dict.headerSubtitle);
  setText("#gis-toggle-btn", dict.gisToggleBtn);
  setAttr("#gis-toggle-btn", "aria-label", dict.gisToggleAria);
  setText("#hud-ui-toggle-btn", dict.hudUiOffBtn);
  setAttr("#hud-ui-toggle-btn", "title", dict.hudUiOffBtnTitle);
  setText("#ui-restore-fab", dict.uiRestoreFabBtn);
  setAttr("#ui-restore-fab", "title", dict.uiRestoreFabTitle);
  setAttr("#ui-restore-fab", "aria-label", dict.uiRestoreFabTitle);
  setText("#quick-ui-off-btn", dict.quickUiOffBtn);
  setAttr("#quick-ui-off-btn", "title", dict.quickUiOffTitle);
  setText("#ui-visibility-panel-label", dict.panelUiVisibilityLabel);
  setText('#ui-visibility-buttons .hud-btn[data-ui-visibility="on"]', dict.uiVisibilityOnBtn);
  setText('#ui-visibility-buttons .hud-btn[data-ui-visibility="off"]', dict.uiVisibilityOffBtn);

  // モバイルクイックバー
  setAttr("#mobile-quick-bar", "aria-label", dict.quickBarAria);
  setText("#quick-gaze-forward-btn", dict.quickGazeForward);
  setAttr("#quick-gaze-forward-btn", "title", dict.quickGazeForwardTitle);
  setText("#quick-mirror-left-btn", dict.quickMirrorLeft);
  setAttr("#quick-mirror-left-btn", "title", dict.quickMirrorLeftTitle);
  setText("#quick-mirror-rear-btn", dict.quickMirrorRear);
  setAttr("#quick-mirror-rear-btn", "title", dict.quickMirrorRearTitle);
  setText("#quick-mirror-right-btn", dict.quickMirrorRight);
  setAttr("#quick-mirror-right-btn", "title", dict.quickMirrorRightTitle);
  setText("#quick-nav-gaze-btn", dict.quickNavGaze);
  setAttr("#quick-nav-gaze-btn", "title", dict.quickNavGazeTitle);
  setAttr("#quick-graphics-btn", "title", dict.quickGraphicsTitle);
  setText("#quick-reset-btn", dict.quickResetBtn);
  setText("#quick-lang-btn", `🌐 ${LOCALE_DISPLAY_LABELS[locale]}`);
  setAttr("#quick-lang-btn", "title", dict.quickLangTitle);

  // GIS テレメトリラベル
  setText("#gis-coord-label", dict.gisCoordLabel);
  setText("#gis-road-label", dict.gisRoadLabel);
  setText("#gis-bldg-label", dict.gisBldgLabel);
  setText("#gis-streaming-label", dict.gisStreamingLabel);

  // オープンワールド・ストリーミング再試行ボタン
  setText("#loading-retry-btn", dict.loadingRetryBtn);
  setText("#streaming-banner-retry-btn", dict.streamingBannerRetryBtn);

  // ドロワーヘッダー
  setText("#drawer-title-text", dict.drawerTitle);
  setText("#hud-drawer-close-btn", dict.drawerCloseBtn);
  setAttr("#hud-drawer-close-btn", "aria-label", dict.drawerCloseAria);

  // 各コントロールパネルの見出しとボタン
  setText("#lang-panel-label", dict.panelLangLabel);
  setText("#area-panel-label", dict.panelAreaLabel);
  setText('#area-buttons .hud-btn[data-area="tokyo"]', dict.areaTokyoBtn);
  setText('#area-buttons .hud-btn[data-area="shibuya"]', dict.areaShibuyaBtn);

  // タイトル画面・ローディング画面
  setText("#title-screen-badge", dict.titleScreenBadge);
  setText("#title-screen-subtitle", dict.titleScreenSubtitle);
  setText("#title-area-label", dict.titleSelectAreaLabel);
  setText("#title-quality-label", dict.titleSelectQualityLabel);
  setText("#title-boost-label", dict.titleSelectBoostLabel);
  setText("#title-lang-label", dict.titleSelectLangLabel);
  setText("#start-drive-btn", dict.titleStartDriveBtn);
  setText("#title-controls-hint", dict.titleControlsHint);
  setText('#title-area-buttons .hud-btn[data-area="tokyo"]', dict.areaTokyoBtn);
  setText('#title-area-buttons .hud-btn[data-area="shibuya"]', dict.areaShibuyaBtn);
  setText('#title-graphics-buttons .hud-btn[data-graphics="high"]', dict.graphicsHighBtn);
  setText('#title-graphics-buttons .hud-btn[data-graphics="medium"]', dict.graphicsMediumBtn);
  setText('#title-graphics-buttons .hud-btn[data-graphics="low"]', dict.graphicsLowBtn);
  setText('#title-boost-buttons .hud-btn[data-boost="on"]', dict.boostOnBtn);
  setText('#title-boost-buttons .hud-btn[data-boost="off"]', dict.boostOffBtn);

  setText("#time-panel-prefix", dict.panelTimePrefix);
  setText(
    '#time-buttons .hud-btn[data-time="morning"]',
    localizeTimeOfDayButtonLabel("morning", locale),
  );
  setText('#time-buttons .hud-btn[data-time="day"]', localizeTimeOfDayButtonLabel("day", locale));
  setText(
    '#time-buttons .hud-btn[data-time="sunset"]',
    localizeTimeOfDayButtonLabel("sunset", locale),
  );
  setText(
    '#time-buttons .hud-btn[data-time="night"]',
    localizeTimeOfDayButtonLabel("night", locale),
  );

  setText("#weather-panel-label", dict.panelWeatherLabel);
  setText(
    '#weather-buttons .hud-btn[data-weather="clear"]',
    localizeWeatherButtonLabel("clear", locale),
  );
  setText(
    '#weather-buttons .hud-btn[data-weather="cloudy"]',
    localizeWeatherButtonLabel("cloudy", locale),
  );
  setText(
    '#weather-buttons .hud-btn[data-weather="rain"]',
    localizeWeatherButtonLabel("rain", locale),
  );

  setText("#road-surface-panel-label", dict.panelSurfaceLabel);
  setText(
    '#road-surface-buttons .hud-btn[data-surface="dry"]',
    localizeRoadSurfaceButtonLabel("dry", locale),
  );
  setText(
    '#road-surface-buttons .hud-btn[data-surface="wet"]',
    localizeRoadSurfaceButtonLabel("wet", locale),
  );
  setText(
    '#road-surface-buttons .hud-btn[data-surface="puddle"]',
    localizeRoadSurfaceButtonLabel("puddle", locale),
  );

  setText("#camera-panel-label", dict.panelCameraLabel);
  setText('#camera-buttons .hud-btn[data-camera="cockpit"]', dict.cameraCockpitBtn);
  setText('#camera-buttons .hud-btn[data-camera="chase"]', dict.cameraChaseBtn);

  setText("#gaze-panel-prefix", dict.panelGazePrefix);
  setText('#gaze-buttons .hud-btn[data-gaze="forward"]', dict.gazeForwardBtn);
  setAttr('#gaze-buttons .hud-btn[data-gaze="forward"]', "title", dict.gazeForwardTitle);
  setText('#gaze-buttons .hud-btn[data-gaze="right_mirror"]', dict.gazeRightMirrorBtn);
  setAttr('#gaze-buttons .hud-btn[data-gaze="right_mirror"]', "title", dict.gazeRightMirrorTitle);
  setText('#gaze-buttons .hud-btn[data-gaze="left_mirror"]', dict.gazeLeftMirrorBtn);
  setAttr('#gaze-buttons .hud-btn[data-gaze="left_mirror"]', "title", dict.gazeLeftMirrorTitle);
  setText('#gaze-buttons .hud-btn[data-gaze="rearview_mirror"]', dict.gazeRearviewMirrorBtn);
  setAttr(
    '#gaze-buttons .hud-btn[data-gaze="rearview_mirror"]',
    "title",
    dict.gazeRearviewMirrorTitle,
  );
  setText('#gaze-buttons .hud-btn[data-gaze="dashboard"]', dict.gazeDashboardBtn);
  setAttr('#gaze-buttons .hud-btn[data-gaze="dashboard"]', "title", dict.gazeDashboardTitle);
  setText('#gaze-buttons .hud-btn[data-gaze="right_shoulder"]', dict.gazeRightShoulderBtn);
  setAttr(
    '#gaze-buttons .hud-btn[data-gaze="right_shoulder"]',
    "title",
    dict.gazeRightShoulderTitle,
  );
  setText('#gaze-buttons .hud-btn[data-gaze="left_shoulder"]', dict.gazeLeftShoulderBtn);
  setAttr('#gaze-buttons .hud-btn[data-gaze="left_shoulder"]', "title", dict.gazeLeftShoulderTitle);

  setText("#wiper-panel-label", dict.panelWiperLabel);
  setText('#wiper-buttons .hud-btn[data-wiper="off"]', localizeWiperButtonLabel("off", locale));
  setText('#wiper-buttons .hud-btn[data-wiper="slow"]', localizeWiperButtonLabel("slow", locale));
  setText('#wiper-buttons .hud-btn[data-wiper="fast"]', localizeWiperButtonLabel("fast", locale));

  setText("#turn-signal-panel-prefix", dict.panelTurnSignalPrefix);
  setText('#turn-signal-buttons .hud-btn[data-turn-signal="left"]', dict.turnSignalLeftBtn);
  setText('#turn-signal-buttons .hud-btn[data-turn-signal="hazard"]', dict.turnSignalHazardBtn);
  setText('#turn-signal-buttons .hud-btn[data-turn-signal="right"]', dict.turnSignalRightBtn);
  setText('#turn-signal-buttons .hud-btn[data-turn-signal="off"]', dict.turnSignalOffBtn);

  setText("#blur-panel-label", dict.panelBlurLabel);

  setText("#graphics-panel-prefix", dict.panelGraphicsPrefix);
  setText('#graphics-buttons .hud-btn[data-graphics="high"]', dict.graphicsHighBtn);
  setText('#graphics-buttons .hud-btn[data-graphics="medium"]', dict.graphicsMediumBtn);
  setText('#graphics-buttons .hud-btn[data-graphics="low"]', dict.graphicsLowBtn);

  setText("#boost-panel-prefix", dict.panelBoostPrefix);
  setText('#boost-buttons .hud-btn[data-boost="on"]', dict.boostOnBtn);
  setText('#boost-buttons .hud-btn[data-boost="off"]', dict.boostOffBtn);

  setText("#sound-panel-prefix", dict.panelSoundPrefix);
  setText('#sound-buttons .hud-btn[data-sound="on"]', dict.soundOnBtn);
  setText('#sound-buttons .hud-btn[data-sound="off"]', dict.soundOffBtn);
  setAttr("#sound-volume-slider", "aria-label", dict.soundVolumeAria);
  setAttr("#quick-sound-btn", "title", dict.quickSoundTitle);

  setText("#touch-ui-panel-label", dict.panelTouchUiLabel);
  setText('#touch-ui-mode-buttons .hud-btn[data-touch-ui-mode="auto"]', dict.touchUiAutoBtn);
  setText('#touch-ui-mode-buttons .hud-btn[data-touch-ui-mode="on"]', dict.touchUiOnBtn);
  setText('#touch-ui-mode-buttons .hud-btn[data-touch-ui-mode="off"]', dict.touchUiOffBtn);

  setText("#sign-builder-panel-label", dict.panelSignBuilderLabel);
  setText("#open-sign-creator-btn", dict.openSignCreatorBtn);
  setText("#asset-manager-panel-label", dict.panelAssetManagerLabel);
  setText("#open-asset-manager-btn", dict.openAssetManagerBtn);
  setText("#title-open-asset-manager-btn", dict.openAssetManagerBtn);
  setText("#quick-asset-manager-btn", dict.quickAssetManagerBtn);
  setAttr("#quick-asset-manager-btn", "title", dict.quickAssetManagerTitle);
  setText("#gamepad-panel-label", dict.panelGamepadLabel);

  // 言語ボタンの active 状態同期
  const langButtons = doc.querySelectorAll<HTMLButtonElement>("#lang-buttons .hud-btn");
  langButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.lang === locale);
  });
  const titleLangButtons = doc.querySelectorAll<HTMLButtonElement>("#title-lang-buttons .hud-btn");
  titleLangButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.lang === locale);
  });

  // フッターショートカットガイド
  setHtml("#controls-guide-line-1", dict.controlsGuideLine1);
  setHtml("#controls-guide-line-2", dict.controlsGuideLine2);
  setHtml("#controls-guide-line-3", dict.controlsGuideLine3);
  setHtml("#controls-guide-line-4", dict.controlsGuideLine4);

  // 仮想タッチコントローラー
  setAttr("#virtual-touch-controls", "aria-label", dict.touchControllerAria);
  setAttr("#touch-steer-cluster", "aria-label", dict.touchSteerClusterAria);
  setAttr("#touch-steer-pad", "aria-label", dict.touchSteerPadAria);
  setAttr("#touch-steer-left", "aria-label", dict.touchSteerLeftAria);
  setText("#touch-steer-left-main", dict.touchSteerLeftMain);
  setText("#touch-steer-left-sub", dict.touchSteerLeftSub);
  setAttr("#touch-steer-right", "aria-label", dict.touchSteerRightAria);
  setText("#touch-steer-right-main", dict.touchSteerRightMain);
  setText("#touch-steer-right-sub", dict.touchSteerRightSub);
  setAttr("#touch-pedal-cluster", "aria-label", dict.touchPedalClusterAria);
  setAttr("#touch-handbrake-btn", "aria-label", dict.touchHandbrakeAria);
  setText("#touch-handbrake-sub", dict.touchHandbrakeSub);
  setAttr("#touch-brake-btn", "aria-label", dict.touchBrakeAria);
  setText("#touch-brake-sub", dict.touchBrakeSub);
  setAttr("#touch-throttle-btn", "aria-label", dict.touchThrottleAria);
  setText("#touch-throttle-sub", dict.touchThrottleSub);

  // 道路標識ビルダーモーダル
  setText("#sign-creator-title", dict.signDialogTitle);
  setText("#close-sign-creator-btn", dict.signDialogCloseBtn);
  setText("#sign-field-type-label", dict.signFieldTypeLabel);
  setText("#sign-field-main-label", dict.signFieldMainLabel);
  setAttr("#sign-label-input", "placeholder", dict.signFieldMainPlaceholder);
  setText("#sign-field-sub-label", dict.signFieldSubLabel);
  setAttr("#sign-sublabel-input", "placeholder", dict.signFieldSubPlaceholder);
  setText("#sign-field-aux-label", dict.signFieldAuxLabel);
  setAttr("#sign-aux-input", "placeholder", dict.signFieldAuxPlaceholder);
  setText("#sign-field-speed-label", dict.signFieldSpeedLabel);
  setText("#sign-field-distance-label", dict.signFieldDistanceLabel);
  setText("#sign-field-offset-label", dict.signFieldOffsetLabel);
  setText("#place-sign-ahead-btn", dict.signPlaceAheadBtn);
  setText("#copy-sign-yaml-btn", dict.signCopyYamlBtn);
  setText("#sign-yaml-section-label", dict.signYamlSectionLabel);
  setText("#sign-custom-list-label", dict.signCustomListLabel);

  // Webアセット管理システムモーダル
  setText("#asset-manager-title", dict.assetDialogTitle);
  setText("#close-asset-manager-btn", dict.assetDialogCloseBtn);
  setText("#asset-manager-run-boost-btn", dict.assetRunBoostBtn);
  setText("#asset-manager-reset-all-btn", dict.assetResetAllBtn);
  setAttr("#asset-manager-search-input", "placeholder", dict.assetSearchPlaceholder);
}

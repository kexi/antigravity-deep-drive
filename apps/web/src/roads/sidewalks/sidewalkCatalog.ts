import type { SidewalkPavingStyle } from "../types";
import {
  SidewalkZoneSpecSchema,
  type SidewalkDistrictPresetId,
  type SidewalkGuardrailStyle,
  type SidewalkZoneSpec,
} from "./sidewalkSchema";

export interface SidewalkDistrictPreset {
  id: SidewalkDistrictPresetId;
  labelJa: string;
  pavingStyle: SidewalkPavingStyle;
  guardrailStyle: SidewalkGuardrailStyle;
  defaultCrossSlope: number;
  backCurbWidthMeters: number;
  catchBasinSpacingMeters: number;
  hasCatchBasins: boolean;
}

const DISTRICT_PRESETS: Record<SidewalkDistrictPresetId, SidewalkDistrictPreset> = {
  marunouchi_granite: {
    id: "marunouchi_granite",
    labelJa: "丸の内・東京駅 御影石平板舗装",
    pavingStyle: "granite_slab",
    guardrailStyle: "marunouchi_dark_bronze",
    defaultCrossSlope: 0.015,
    backCurbWidthMeters: 0.14,
    catchBasinSpacingMeters: 22.0,
    hasCatchBasins: true,
  },
  ginza_promenade: {
    id: "ginza_promenade",
    labelJa: "銀座・中央通り 御影石プロムナード",
    pavingStyle: "granite_slab",
    guardrailStyle: "marunouchi_dark_bronze",
    defaultCrossSlope: 0.015,
    backCurbWidthMeters: 0.14,
    catchBasinSpacingMeters: 22.0,
    hasCatchBasins: true,
  },
  shibuya_brick: {
    id: "shibuya_brick",
    labelJa: "渋谷エリア インターロッキングブロック舗装",
    pavingStyle: "interlocking_brick",
    guardrailStyle: "tokyo_white_pipe",
    defaultCrossSlope: 0.015,
    backCurbWidthMeters: 0.12,
    catchBasinSpacingMeters: 20.0,
    hasCatchBasins: true,
  },
  imperial_moat: {
    id: "imperial_moat",
    labelJa: "皇居外苑・内堀通り 石材舗装",
    pavingStyle: "granite_slab",
    guardrailStyle: "marunouchi_dark_bronze",
    defaultCrossSlope: 0.015,
    backCurbWidthMeters: 0.14,
    catchBasinSpacingMeters: 24.0,
    hasCatchBasins: true,
  },
  tokyo_concrete: {
    id: "tokyo_concrete",
    labelJa: "東京都標準 コンクリート平板歩道",
    pavingStyle: "concrete_tile",
    guardrailStyle: "tokyo_white_pipe",
    defaultCrossSlope: 0.015,
    backCurbWidthMeters: 0.1,
    catchBasinSpacingMeters: 24.0,
    hasCatchBasins: true,
  },
};

/**
 * 路線 ID・名称・世界座標 X・明示指定の舗装スタイルから、実在の東京／渋谷地区に即した歩道プリセットを解決する。
 */
export function resolveSidewalkDistrictPreset(params: {
  roadId?: string;
  roadName?: string;
  worldX?: number;
  explicitPavingStyle?: SidewalkPavingStyle;
}): SidewalkDistrictPreset {
  const key = `${params.roadId ?? ""} ${params.roadName ?? ""}`.toLowerCase();

  const isShibuyaByName =
    key.includes("shibuya") ||
    key.includes("dogenzaka") ||
    key.includes("miyamasu") ||
    key.includes("meiji") ||
    key.includes("koen") ||
    key.includes("bunkamura") ||
    key.includes("inokashira") ||
    key.includes("sakurazaka") ||
    key.includes("hikarie") ||
    key.includes("konnozaka") ||
    key.includes("roppongi") ||
    key.includes("aoyama") ||
    key.includes("渋谷") ||
    key.includes("道玄坂") ||
    key.includes("宮益") ||
    key.includes("明治");
  const isShibuyaByCoord = typeof params.worldX === "number" && params.worldX < -395;

  let preset: SidewalkDistrictPreset;
  if (isShibuyaByName || isShibuyaByCoord) {
    preset = DISTRICT_PRESETS.shibuya_brick;
  } else if (
    key.includes("ginza") ||
    key.includes("harumi") ||
    key.includes("chuo") ||
    key.includes("showa") ||
    key.includes("銀座") ||
    key.includes("中央通り")
  ) {
    preset = DISTRICT_PRESETS.ginza_promenade;
  } else if (
    key.includes("uchibori") ||
    key.includes("kokyo") ||
    key.includes("内堀") ||
    key.includes("皇居")
  ) {
    preset = DISTRICT_PRESETS.imperial_moat;
  } else if (
    key.includes("gyoko") ||
    key.includes("marunouchi") ||
    key.includes("hibiya") ||
    key.includes("tokyo") ||
    key.includes("eitai") ||
    key.includes("行幸") ||
    key.includes("丸の内") ||
    key.includes("日比谷")
  ) {
    preset = DISTRICT_PRESETS.marunouchi_granite;
  } else if (params.explicitPavingStyle === "interlocking_brick") {
    preset = DISTRICT_PRESETS.shibuya_brick;
  } else if (params.explicitPavingStyle === "concrete_tile") {
    preset = DISTRICT_PRESETS.tokyo_concrete;
  } else {
    preset = DISTRICT_PRESETS.marunouchi_granite;
  }

  if (params.explicitPavingStyle && params.explicitPavingStyle !== preset.pavingStyle) {
    return {
      ...preset,
      pavingStyle: params.explicitPavingStyle,
    };
  }
  return preset;
}

/**
 * 歩道幅員と地区プリセットから、道路構造令に基づく施設帯・有効歩行空間・民地境界幅を含む
 * 完全な SidewalkZoneSpec を構築・バリデーションする。
 */
export function buildSidewalkZoneSpec(params: {
  preset: SidewalkDistrictPreset;
  totalWidthMeters: number;
  curbWidthMeters: number;
  curbHeightMeters: number;
  gutterWidthMeters: number;
  crossSlopeRatio?: number;
  hasGuardrails?: boolean;
  hasCrosswalks?: boolean;
}): SidewalkZoneSpec {
  const totalW = Math.max(0, params.totalWidthMeters);
  const curbW = totalW > 0.05 ? Math.min(params.curbWidthMeters, totalW * 0.4) : 0;
  const walkW = Math.max(0, totalW - curbW);
  const backCurbW = walkW >= 1.4 ? Math.min(params.preset.backCurbWidthMeters, walkW * 0.1) : 0;

  // 幅員 >= 3.2m は植樹・信号施設帯 0.9m、中幅員は 0.55m、狭小歩道は施設帯を抑え有効歩行幅を確保
  const furnitureW = walkW >= 3.2 ? 0.9 : walkW >= 2.0 ? 0.55 : Math.min(0.35, walkW * 0.25);
  const pedestrianClearW = Math.max(0, walkW - furnitureW - backCurbW);

  return SidewalkZoneSpecSchema.parse({
    presetId: params.preset.id,
    pavingStyle: params.preset.pavingStyle,
    totalWidthMeters: totalW,
    curbWidthMeters: curbW,
    curbHeightMeters: Math.max(0.05, params.curbHeightMeters),
    curbBevelWidthMeters: 0.045,
    curbBevelHeightMeters: 0.045,
    gutterWidthMeters: Math.max(0, params.gutterWidthMeters),
    crossSlopeRatio: params.crossSlopeRatio ?? params.preset.defaultCrossSlope,
    furnitureZoneWidthMeters: furnitureW,
    pedestrianClearWidthMeters: pedestrianClearW,
    backCurbWidthMeters: backCurbW,
    guardrailStyle: params.hasGuardrails ? params.preset.guardrailStyle : "none",
    hasCatchBasins: params.preset.hasCatchBasins && params.gutterWidthMeters >= 0.15,
    catchBasinSpacingMeters: params.preset.catchBasinSpacingMeters,
    hasTactileWarningPads: params.hasCrosswalks ?? true,
  });
}

export function getAllSidewalkDistrictPresets(): ReadonlyArray<SidewalkDistrictPreset> {
  return Object.values(DISTRICT_PRESETS);
}

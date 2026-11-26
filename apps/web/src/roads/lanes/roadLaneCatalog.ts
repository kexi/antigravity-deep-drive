import { z } from "zod";
import { RoadLaneCatalogEntrySchema, type RoadLaneCatalogEntry } from "./laneSchema";

/**
 * 渋谷・東京駅丸の内エリアの実在道路に基づく宣言的車線プロファイルカタログ（Zod 検証済み SSOT）
 *
 * - すべてのエントリはモジュールロード時に RoadLaneCatalogEntrySchema でバリデーションされる。
 * - 車道外縁幅（roadCrossSection.ts）は変えず、幹線アプローチでの右折ポケット（中央導流帯絞り込み）や
 *   細街路の一時停止「止まれ」標示、橙黄色二本線センターライン等を統一仕様で記述する。
 */
const RAW_ROAD_LANE_CATALOG: ReadonlyArray<RoadLaneCatalogEntry> = [
  {
    idPattern: "nav-road-meiji-dori",
    description: "明治通り（渋谷ストリーム〜東口〜宮益坂下）：片側2車線・立体中央分離帯・看板整合",
    inboundLaneCount: 2,
    oncomingLaneCount: 2,
    inboundArrows: ["straight-right", "straight-left"],
    oncomingArrows: ["straight-right", "straight-left"],
    speedLimitOverride: 50,
  },
  {
    idPattern: "nav-road-route246",
    description:
      "国道246号・青山通り：片側3車線幹線＋終端アプローチ右折ポケット（中央ゼブラ導流帯）",
    speedLimitOverride: 50,
    rightTurnPockets: [
      {
        anchor: "end",
        direction: "inbound",
        pocketLengthM: 26,
        chevronTaperLengthM: 14,
      },
    ],
  },
  {
    idPattern: "nav-road-shibuya-tamagawa-west",
    description: "国道246号・玉川通り（渋谷駅西口〜道玄坂上）：片側3車線＋アプローチ右折ポケット",
    speedLimitOverride: 50,
    rightTurnPockets: [
      {
        anchor: "start",
        direction: "oncoming",
        pocketLengthM: 24,
        chevronTaperLengthM: 14,
      },
    ],
  },
  {
    idPattern: "nav-road-shibuya-miyamasuzaka",
    description: "宮益坂（都道305号）：橙黄色二本線センターライン・片側2車線",
    centerFeatureOverride: "double_yellow",
    inboundArrows: ["straight-right", "straight-left"],
    oncomingArrows: ["straight-right", "straight-left"],
    speedLimitOverride: 40,
  },
  {
    idPattern: "nav-road-shibuya-dogenzaka",
    description: "道玄坂：片側2車線・進路変更禁止アプローチ",
    inboundArrows: ["straight-right", "straight-left"],
    oncomingArrows: ["straight-right", "straight-left"],
    speedLimitOverride: 40,
  },
  {
    idPattern: "nav-road-shibuya-hikarie-access",
    description: "渋谷ヒカリエ東側アクセス路：細街路一時停止「止まれ」標示対応",
    hasStopTextOnApproaches: true,
    speedLimitOverride: 30,
  },
  {
    idPattern: "nav-road-shibuya-sakurazaka-loop",
    description: "桜丘さくら坂ループ：細街路一時停止「止まれ」標示対応",
    hasStopTextOnApproaches: true,
    speedLimitOverride: 30,
  },
  {
    idPattern: "nav-road-shibuya-inokashira-organ",
    description: "井の頭通り・オルガン坂接続路：細街路一時停止「止まれ」標示対応",
    hasStopTextOnApproaches: true,
    speedLimitOverride: 30,
  },
  {
    idPattern: "Naka-dori",
    description: "丸の内仲通り：石畳風商業街路・一時停止「止まれ」標示対応",
    hasStopTextOnApproaches: true,
    speedLimitOverride: 30,
  },
];

export const ROAD_LANE_CATALOG: ReadonlyArray<RoadLaneCatalogEntry> = z
  .array(RoadLaneCatalogEntrySchema)
  .parse(RAW_ROAD_LANE_CATALOG);

/**
 * 路線 ID または表示名から該当する車線カタログ定義を検索する（完全一致を最優先）。
 */
export function lookupRoadLaneCatalogEntry(
  roadIdOrName?: string,
): RoadLaneCatalogEntry | undefined {
  const hasQuery = typeof roadIdOrName === "string" && roadIdOrName.length > 0;
  if (!hasQuery) {
    return undefined;
  }
  const exact = ROAD_LANE_CATALOG.find((entry) => entry.idPattern === roadIdOrName);
  if (exact) {
    return exact;
  }
  return ROAD_LANE_CATALOG.find(
    (entry) => roadIdOrName.includes(entry.idPattern) || entry.idPattern.includes(roadIdOrName),
  );
}

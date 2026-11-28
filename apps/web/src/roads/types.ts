import type * as THREE from "three";
import type { JunctionTopology, Point2D, RoadLaneCatalogEntry } from "./lanes/laneSchema";

/**
 * 日本の道路仕様・パラメータ型定義
 * 国土交通省「道路構造令」（第4種第1級/第2級 市街地幹線道路仕様）に準拠
 */

export type SidewalkPavingStyle = "granite_slab" | "interlocking_brick" | "concrete_tile";

export interface RoadExclusionCorridor {
  id?: string;
  sampledPoints: ReadonlyArray<{ x: number; z: number }>;
  halfWidth: number;
  /** 交差道路側の歩道幅員（交差点コーナーの歩道重複を防ぎ、隅切りコネクタ用スペースをクリーンに確保する） */
  sidewalkClearance?: number;
  /** T字路等の端点キャップ長手余白（既定 1.5m）。道路終端の先へ半球状に張り出して対向側歩道を切断するのを防ぐ */
  endCapMargin?: number;
}

export interface RoadExclusionBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface IntersectionArmSpec {
  carriagewayWidth: number;
  sidewalkLeft?: number;
  sidewalkRight?: number;
}

export interface JapaneseIntersectionConfig {
  name?: string;
  x: number;
  z: number;
  widthX: number;
  depthZ: number;
  arms?: {
    north?: IntersectionArmSpec;
    south?: IntersectionArmSpec;
    east?: IntersectionArmSpec;
    west?: IntersectionArmSpec;
  };
  curbHeight?: number;
  curbWidth?: number;
  cornerFilletRadius?: number;
  hasCornerSidewalks?: boolean;
  sidewalkPavingStyle?: SidewalkPavingStyle;
  lanesX?: number;
  lanesZ?: number;
  hasCrosswalks?: boolean;
  hasCenterDiamond?: boolean;
  crosswalkN?: boolean;
  crosswalkS?: boolean;
  crosswalkE?: boolean;
  crosswalkW?: boolean;
  hasGuideDots?: boolean;
  isScramble?: boolean;
  junctionTopology?: JunctionTopology;
  baseY?: number;
  elevationSampler?: (x: number, z: number) => number;
  skipRoadCollider?: boolean;
}

export interface JapaneseRoadSegmentConfig {
  roadId?: string;
  name?: string;
  laneProfileOverride?: RoadLaneCatalogEntry;
  hasStopText?: boolean;
  junctionPolygons?: ReadonlyArray<ReadonlyArray<Point2D>>;
  crossingCorridors?: ReadonlyArray<RoadExclusionCorridor>;
  lanesPerDirection: number; // 片側車線数 (例: 2 = 往復4車線, 3 = 往復6車線)
  laneWidth: number; // 1車線の標準幅員 (日本標準: 3.0m - 3.5m)
  shoulderWidth: number; // 路肩・側帯幅員 (日本標準: 0.5m - 1.25m)
  medianWidth?: number; // 中央分離帯幅員 (0 = 黄色中央線のみ, >0 = 植栽/防護柵ブロック)
  sidewalkWidth: number; // 歩道幅員 (日本標準: 2.5m - 4.5m)
  leftSidewalkWidth?: number; // 左歩道幅員の上書き指定
  rightSidewalkWidth?: number; // 右歩道幅員の上書き指定
  curbHeight: number; // 縁石マウントアップ高さ (日本標準: 0.15m - 0.20m)
  curbWidth?: number; // 縁石幅員 (日本標準: 0.15m - 0.22m, 既定 0.20m)
  sidewalkCrossSlope?: number; // 歩道横断排水勾配 (日本標準: 1.5% = 0.015)
  sidewalkPavingStyle?: SidewalkPavingStyle; // 歩道舗装パターン
  length: number; // セグメント長 (m)
  hasCenterLine?: boolean; // 中央線描画の有無（既定: true。スクランブル交差点直下等で中央線を抑止）
  hasShoulderLines?: boolean; // 路側帯実線描画の有無（既定: true）
  hasYellowCenterLine?: boolean; // 黄色追越禁止中央線の有無
  hasDoubleYellowCenterLine?: boolean; // 橙黄色二本線センターライン（宮益坂等の片側2車線以上はみ出し禁止）
  hasWhiteDashedLines?: boolean; // 白破線車線境界線の有無
  elevationSampler?: (x: number, z: number) => number; // 3D起伏地形への追従サンプラー
  skipRoadCollider?: boolean; // 連続Terrain Trimesh側で走行路面コライダーを担う場合に車道直方体コライダーを抑止する
  hasCrosswalk?: boolean; // 横断歩道の有無
  hasCrosswalks?: boolean; // 横断歩道の有無（別名）
  hasStopLines?: boolean; // 停止線描画の有無（既定: true）
  hasManholes?: boolean; // マンホールの有無
  hasGuardrails?: boolean; // ガードレールの有無
  hasStreetLights?: boolean; // 街灯の有無
  hasTrafficLights?: boolean; // 信号機の有無
  speedLimitSign?: number; // 速度制限標識値
  startTrimMeters?: number; // 曲線道路の始端白線トリム長（交差点パッド手前での白線停止長、m）
  endTrimMeters?: number; // 曲線道路の終端白線トリム長（交差点パッド手前での白線停止長、m）
  skipStartCrosswalk?: boolean; // 連続接続継ぎ目で始端側の横断歩道・停止線描画を抑制する
  skipEndCrosswalk?: boolean; // 連続接続継ぎ目で終端側の横断歩道・停止線描画を抑制する
  medianExclusionZones?: ReadonlyArray<{ x: number; z: number; radius: number }>; // 中央分離帯を開口する交差点座標群
  markingExclusionZones?: ReadonlyArray<{ x: number; z: number; radius: number }>; // 交差点中心付近で車線境界線・中央線・路側帯線を切るための除外ゾーン
  sidewalkExclusionCorridors?: ReadonlyArray<RoadExclusionCorridor>; // 交差コリドー群による片側別歩道クリッピング
  sidewalkExclusionBoxes?: ReadonlyArray<RoadExclusionBox>; // 交差点パッド・直交車道AABBによる歩道クリッピング
  sidewalkExclusionZones?: ReadonlyArray<{ x: number; z: number; radius: number }>; // 広場・円形除外ゾーンによる歩道クリッピング
  points?: ReadonlyArray<{ x: number; z: number }>; // オープンデータ道路中心線ポリライン頂点列 (ワールドまたはローカル座標)
}

export interface RoadMeshOutput {
  visualGroup: THREE.Group;
  roadWidthTotal: number;
  driveableWidthTotal: number;
}

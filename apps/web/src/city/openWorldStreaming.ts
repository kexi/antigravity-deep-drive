import type { GraphicsQuality } from "../types";
import { logger } from "../core/logger";

/**
 * 都市空間のオープンワールド分割セクター（チャンク）ID
 * 従来の20チャンク（7.8 km²）を11倍超となる 48チャンク（86.0 km²: 東西 10.0 km × 南北 8.6 km）へ大拡張。
 * 西は三軒茶屋・世田谷・下北沢・中野・西新宿都庁、北は新宿・四ツ谷・市ヶ谷・品川、
 * 南は中目黒・五反田・麻布十番・東京タワー・後楽園・上野・浅草、東は築地・豊洲・お台場・両国・東京スカイツリーまで
 * 隙間なく網羅し、優先ロード・進行方向先読み・メモリ解放（Eviction）を行う。
 */
export type WorldChunkId =
  | "shibuya-core"
  | "shibuya-south"
  | "shibuya-north"
  | "shibuya-west"
  | "harajuku-yoyogi"
  | "ebisu-daikanyama"
  | "aoyama-west"
  | "aoyama-east"
  | "roppongi-nishiazabu"
  | "omotesando-aoyama-north"
  | "otemachi-west"
  | "marunouchi-core"
  | "kokyo-north"
  | "kokyo-west-hanzomon"
  | "kokyo-north-takebashi"
  | "kanda-akihabara"
  | "yurakucho-east"
  | "ginza-sukiyabashi"
  | "shimbashi-shiodome"
  | "yaesu-showadori-east"
  // --- 大東京 10倍拡張 外周リング（28チャンク: 78.2 km² 追加 → 計 86.0 km²） ---
  | "nakano-sakaue-honcho"
  | "shinjuku-west-tocho"
  | "shimokitazawa-daita"
  | "hatsudai-sasazuka"
  | "setagaya-komazawa"
  | "sangenjaya-ikejiri"
  | "jiyugaoka-futako"
  | "gakugeidaigaku-yutenji"
  | "yoyogi-shinjuku-south"
  | "shinjuku-kabukicho-east"
  | "yotsuya-shinanomachi"
  | "ichigaya-kagurazaka"
  | "shinagawa-tamachi"
  | "shinagawa-tennozu"
  | "meguro-nakameguro"
  | "gotanda-osaki"
  | "hiroo-azabu-juban"
  | "korakuen-bunkyo"
  | "ueno-okachimachi"
  | "asakusa-kuramae"
  | "odaiba-rainbow-bridge"
  | "ariake-tokyo-bigsight"
  | "tsukiji-kachidoki"
  | "toyosu-harumi"
  | "monzennakacho-kiyosumi"
  | "kiba-toyosu-east"
  | "ryogoku-sumida"
  | "kinshicho-skytree";

/**
 * チャンクのライフサイクル状態
 * - `unloaded`: 未ロード（または遠方退避によりジオメトリ・GLBがメモリ解放された状態）
 * - `queued`: 優先度キューに登録され、バックグラウンドまたは優先ストリーム待ちの状態
 * - `loading`: GLBモデル取得またはチャンクメッシュ構築を実行中の状態
 * - `active`: ロード完了し、シーン内で描画・物理有効な状態
 * - `failed`: ネットワークエラー等で読み込みに失敗し、再試行（Retry）待ちの状態
 */
export type ChunkLifecycleState = "unloaded" | "queued" | "loading" | "active" | "failed";

/**
 * 各チャンクの空間定義メタデータ
 */
export interface WorldChunkDefinition {
  id: WorldChunkId;
  nameJa: string;
  nameEn: string;
  nameZh: string;
  /** エリア所属（渋谷エリア / Corridor / 東京駅・丸の内エリア） */
  zone: "shibuya" | "corridor" | "tokyo";
  /** チャンク中心座標 (x, z) */
  centerX: number;
  centerZ: number;
  /** チャンク境界ボックス (minX, maxX, minZ, maxZ) */
  bounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
  /** 推定メモリ使用量 (MB): 建物・道路メッシュ + 紐づくGLBランドマーク */
  estimatedMemoryMb: number;
  /** このチャンクが要求する大型ランドマークGLBアセットID（存在する場合） */
  associatedGlbModelIds: readonly string[];
  /** 主要幹線道路や交差点を含むコアチャンクかどうか */
  isPrimaryHub: boolean;
}

/**
 * ランタイムでの各チャンク状態スナップショット
 */
export interface WorldChunkRuntimeState {
  definition: WorldChunkDefinition;
  state: ChunkLifecycleState;
  /** ポップイン抑制用の表示遷移係数 (0.0 = 非表示/プロキシ, 1.0 = 完全表示) */
  transitionAlpha: number;
  /** 車両および先読み予測位置から計算された優先度スコア（高いほど優先） */
  priorityScore: number;
  /** 現在の車両位置からの直線距離 (m) */
  distanceFromVehicleM: number;
  /** 進行方向予測ポイントからの距離 (m) */
  distanceFromPredictedM: number;
  /** 最終アクティブ時刻 (ms) — LRU メモリ解放判定に使用 */
  lastActiveTimestampMs: number;
  /** ロード試行回数 */
  retryCount: number;
  /** 直近のエラーメッセージ（failed 状態の場合） */
  lastError: string | null;
  /** チャンクに紐づく3Dオブジェクト数 */
  boundObjectCount: number;
  /** チャンクのジオメトリ・GLBが実メモリ上に保持されているか */
  isResidentInMemory: boolean;
}

/**
 * 画質プリセット（High / Medium / Low）およびモバイル Chrome 判定に応じた
 * ストリーミング＆メモリ制御バジェット設定
 */
export interface StreamingBudgetProfile {
  quality: GraphicsQuality;
  isMobileChrome: boolean;
  /** 即座にアクティブ化する半径 (m) */
  activeRadiusM: number;
  /** 進行方向に応じてバックグラウンド先読みを開始する半径 (m) */
  prefetchRadiusM: number;
  /** 不要になったチャンク・遠方GLBをアンロード/Evictする距離しきい値 (m) */
  unloadRadiusM: number;
  /** 進行方向の予測先読み秒数 (秒) */
  lookaheadSeconds: number;
  /** 進行方向コーンの前方ブースト距離 (m) */
  forwardConeBoostM: number;
  /** メモリ上限バジェット (MB) — これを超えると遠方チャンクから優先的に Evict する */
  memoryBudgetMb: number;
  /** 同時にメモリ保持可能な最大チャンク数 */
  maxResidentChunks: number;
  /** 1フレームあたりのバックグラウンドチャンク処理時間上限 (ms) — フリーズ防止用タイムスライス */
  frameSliceBudgetMs: number;
  /** 1フレームあたりに状態遷移させる最大チャンク数 */
  maxChunksPerFrame: number;
  /** ポップイン防止フェード/スケールイン速度 (1/sec) */
  popInTransitionSpeed: number;
  /** 自動リトライの最大回数 */
  maxAutoRetries: number;
  /** リトライ基準待機時間 (ms) */
  retryBaseDelayMs: number;
}

/**
 * ストリーミングシステム全体のテレメトリ・UI表示用ステータス
 */
export interface OpenWorldStreamingStatus {
  phase: "booting" | "streaming" | "warping" | "ready" | "error";
  currentChunkId: WorldChunkId;
  currentChunkNameJa: string;
  currentChunkNameEn: string;
  currentChunkNameZh: string;
  activeChunkCount: number;
  loadingChunkCount: number;
  queuedChunkCount: number;
  unloadedChunkCount: number;
  failedChunkCount: number;
  totalChunkCount: number;
  /** 初期起動またはワープ時の優先チャンクロード進捗 (0..100) */
  priorityLoadProgressPercent: number;
  /** 推定アセットメモリ使用量 (MB) */
  estimatedMemoryUsedMb: number;
  /** 設定されたメモリバジェット上限 (MB) */
  memoryBudgetMb: number;
  /** JS Heap 使用量 (MB, performance.memory が利用可能な場合) */
  jsHeapUsedMb: number | null;
  /** Three.js WebGLRenderer 内のジオメトリ数・テクスチャ数 */
  gpuGeometriesCount: number;
  gpuTexturesCount: number;
  /** これまでにメモリ解放（Evict）された延べチャンク数 */
  totalEvictedCount: number;
  /** 進行方向プリフェッチの対象チャンクIDリスト */
  prefetchTargetIds: WorldChunkId[];
  /** エラー発生時の再試行可能フラグ */
  canRetry: boolean;
  lastErrorMessage: string | null;
}

/**
 * 全48チャンクの空間定義カタログ（東西 10.0 km × 南北 8.6 km = 86.0 km²、従来20チャンク 7.8 km² の 11.0 倍）
 * 中央コア20チャンク（渋谷〜青山〜東京駅・丸の内・銀座・神田）の座標・IDを完全維持しつつ、
 * 外周28チャンク（西新宿都庁・中野・下北沢・三軒茶屋・駒沢・中目黒・五反田・品川・東京タワー・後楽園・上野・浅草・築地・豊洲・お台場・両国・東京スカイツリー）で隙間なく囲む。
 */
export const WORLD_CHUNK_DEFINITIONS: readonly WorldChunkDefinition[] = [
  {
    id: "shibuya-core",
    nameJa: "渋谷ストリーム・スクランブル交差点・駅周辺",
    nameEn: "Shibuya Stream, Scramble Crossing & Station Core",
    nameZh: "涩谷Stream・全向路口・车站核心区",
    zone: "shibuya",
    centerX: -850,
    centerZ: 420,
    bounds: { minX: -1180, maxX: -610, minZ: 220, maxZ: 640 },
    estimatedMemoryMb: 34,
    associatedGlbModelIds: ["shibuya_stream", "shibuya_plateau_buildings", "street_tree"],
    isPrimaryHub: true,
  },
  {
    id: "shibuya-south",
    nameJa: "渋谷南・並木橋・桜丘ループ",
    nameEn: "Shibuya South, Namikibashi & Sakuragaoka",
    nameZh: "涩谷南・并木桥・樱丘环线",
    zone: "shibuya",
    centerX: -820,
    centerZ: 760,
    bounds: { minX: -1200, maxX: -540, minZ: 640, maxZ: 920 },
    estimatedMemoryMb: 18,
    associatedGlbModelIds: ["shibuya_stream", "shibuya_plateau_buildings", "street_tree"],
    isPrimaryHub: false,
  },
  {
    id: "shibuya-north",
    nameJa: "渋谷北・センター街・公園通り・PARCO・宮下公園",
    nameEn: "Shibuya North, Center-Gai, Koen-dori, PARCO & Miyashita",
    nameZh: "涩谷北・中心街・公园通・PARCO・宫下公园",
    zone: "shibuya",
    centerX: -980,
    centerZ: 50,
    bounds: { minX: -1350, maxX: -610, minZ: -160, maxZ: 220 },
    estimatedMemoryMb: 26,
    associatedGlbModelIds: ["shibuya_stream", "shibuya_plateau_buildings", "street_tree"],
    isPrimaryHub: true,
  },
  {
    id: "aoyama-west",
    nameJa: "国道246号・青山通り西（金王坂〜表参道）",
    nameEn: "Route 246 Aoyama-dori West (Konnozaka)",
    nameZh: "国道246号・青山通西（金王坂〜表参道）",
    zone: "corridor",
    centerX: -545,
    centerZ: 200,
    bounds: { minX: -610, maxX: -465, minZ: 60, maxZ: 340 },
    estimatedMemoryMb: 16,
    associatedGlbModelIds: ["shibuya_plateau_buildings", "street_tree"],
    isPrimaryHub: false,
  },
  {
    id: "aoyama-east",
    nameJa: "国道246号・青山通り東（赤坂・三宅坂接続）",
    nameEn: "Route 246 Aoyama-dori East (Akasaka Approach)",
    nameZh: "国道246号・青山通东（赤坂方向）",
    zone: "corridor",
    centerX: -395,
    centerZ: 200,
    bounds: { minX: -465, maxX: -320, minZ: 60, maxZ: 340 },
    estimatedMemoryMb: 16,
    associatedGlbModelIds: ["street_tree"],
    isPrimaryHub: false,
  },
  {
    id: "otemachi-west",
    nameJa: "大手町・永代通り・丸の内西",
    nameEn: "Otemachi, Eitai-dori & Marunouchi West",
    nameZh: "大手町・永代通・丸之内西",
    zone: "tokyo",
    centerX: -235,
    centerZ: 110,
    bounds: { minX: -320, maxX: -120, minZ: -200, maxZ: 420 },
    estimatedMemoryMb: 24,
    associatedGlbModelIds: ["street_tree"],
    isPrimaryHub: false,
  },
  {
    id: "marunouchi-core",
    nameJa: "東京駅赤レンガ・行幸通り・丸の内中央",
    nameEn: "Tokyo Station Red Brick & Gyoko-dori Core",
    nameZh: "东京站红砖站舍・行幸通・丸之内核心区",
    zone: "tokyo",
    centerX: 0,
    centerZ: 75,
    bounds: { minX: -120, maxX: 125, minZ: -200, maxZ: 235 },
    estimatedMemoryMb: 38,
    associatedGlbModelIds: ["tokyo_station", "street_tree"],
    isPrimaryHub: true,
  },
  {
    id: "kokyo-north",
    nameJa: "皇居外苑・和田倉門・内堀通り・日比谷通り",
    nameEn: "Imperial Palace Kokyo Gaien & Uchibori-dori",
    nameZh: "皇居外苑・和田仓门・内堀通",
    zone: "tokyo",
    centerX: 0,
    centerZ: 320,
    bounds: { minX: -120, maxX: 125, minZ: 235, maxZ: 460 },
    estimatedMemoryMb: 22,
    associatedGlbModelIds: ["street_tree"],
    isPrimaryHub: false,
  },
  {
    id: "yurakucho-east",
    nameJa: "有楽町・馬場先門・鍛冶橋通り東",
    nameEn: "Yurakucho, Babasakimon & Marunouchi East",
    nameZh: "有乐町・马场先门・丸之内东",
    zone: "tokyo",
    centerX: 250,
    centerZ: 120,
    bounds: { minX: 125, maxX: 520, minZ: -200, maxZ: 460 },
    estimatedMemoryMb: 22,
    associatedGlbModelIds: ["street_tree"],
    isPrimaryHub: false,
  },
  {
    id: "shibuya-west",
    nameJa: "渋谷西・松濤・神泉・山手通り",
    nameEn: "Shibuya West, Shoto, Shinsen & Yamate-dori",
    nameZh: "涩谷西・松涛・神泉・山手通",
    zone: "shibuya",
    centerX: -1450,
    centerZ: 380,
    bounds: { minX: -1800, maxX: -1180, minZ: -160, maxZ: 920 },
    estimatedMemoryMb: 24,
    associatedGlbModelIds: ["shibuya_stream", "shibuya_plateau_buildings", "street_tree"],
    isPrimaryHub: false,
  },
  {
    id: "harajuku-yoyogi",
    nameJa: "原宿・明治通り北・表参道・代々木",
    nameEn: "Harajuku, Meiji-dori North, Omotesando & Yoyogi",
    nameZh: "原宿・明治通北・表参道・代代木",
    zone: "shibuya",
    centerX: -860,
    centerZ: -320,
    bounds: { minX: -1800, maxX: -610, minZ: -1200, maxZ: -160 },
    estimatedMemoryMb: 20,
    associatedGlbModelIds: ["shibuya_plateau_buildings", "street_tree"],
    isPrimaryHub: false,
  },
  {
    id: "ebisu-daikanyama",
    nameJa: "恵比寿・明治通り南・代官山・並木橋南",
    nameEn: "Ebisu, Meiji-dori South, Daikanyama & Hiroo",
    nameZh: "惠比寿・明治通南・代官山・广尾",
    zone: "shibuya",
    centerX: -720,
    centerZ: 1050,
    bounds: { minX: -1800, maxX: -320, minZ: 920, maxZ: 1400 },
    estimatedMemoryMb: 18,
    associatedGlbModelIds: ["shibuya_plateau_buildings", "street_tree"],
    isPrimaryHub: false,
  },
  {
    id: "roppongi-nishiazabu",
    nameJa: "六本木通り・西麻布・六本木ヒルズ",
    nameEn: "Roppongi-dori, Nishi-Azabu & Roppongi Hills",
    nameZh: "六本木通・西麻布・六本木之丘",
    zone: "corridor",
    centerX: -400,
    centerZ: 480,
    bounds: { minX: -610, maxX: -120, minZ: 340, maxZ: 920 },
    estimatedMemoryMb: 24,
    associatedGlbModelIds: ["shibuya_plateau_buildings", "street_tree"],
    isPrimaryHub: false,
  },
  {
    id: "omotesando-aoyama-north",
    nameJa: "表参道北・外苑前・神宮外苑・キラー通り",
    nameEn: "Omotesando North, Gaienmae & Jingu Gaien",
    nameZh: "表参道北・外苑前・神宫外苑",
    zone: "corridor",
    centerX: -480,
    centerZ: -120,
    bounds: { minX: -610, maxX: -320, minZ: -1200, maxZ: 60 },
    estimatedMemoryMb: 18,
    associatedGlbModelIds: ["shibuya_plateau_buildings", "street_tree"],
    isPrimaryHub: false,
  },
  {
    id: "kokyo-west-hanzomon",
    nameJa: "皇居西・半蔵門・三宅坂・千鳥ヶ淵",
    nameEn: "Imperial Palace West, Hanzomon & Chidorigafuchi",
    nameZh: "皇居西・半藏门・三宅坂・千鸟渊",
    zone: "tokyo",
    centerX: -220,
    centerZ: 810,
    bounds: { minX: -320, maxX: -120, minZ: 420, maxZ: 1400 },
    estimatedMemoryMb: 20,
    associatedGlbModelIds: ["street_tree"],
    isPrimaryHub: false,
  },
  {
    id: "kokyo-north-takebashi",
    nameJa: "皇居北・竹橋・北の丸公園・神田錦町",
    nameEn: "Imperial Palace North, Takebashi & Kanda-Nishikicho",
    nameZh: "皇居北・竹桥・北之丸公园・神田锦町",
    zone: "tokyo",
    centerX: 0,
    centerZ: 830,
    bounds: { minX: -120, maxX: 125, minZ: 460, maxZ: 1400 },
    estimatedMemoryMb: 20,
    associatedGlbModelIds: ["street_tree"],
    isPrimaryHub: false,
  },
  {
    id: "kanda-akihabara",
    nameJa: "神田・秋葉原・日本橋本石町・万世橋",
    nameEn: "Kanda, Akihabara, Nihombashi-Honcho & Manseibashi",
    nameZh: "神田・秋叶原・日本桥本町・万世桥",
    zone: "tokyo",
    centerX: 385,
    centerZ: 830,
    bounds: { minX: 125, maxX: 1200, minZ: 460, maxZ: 1400 },
    estimatedMemoryMb: 22,
    associatedGlbModelIds: ["street_tree"],
    isPrimaryHub: false,
  },
  {
    id: "ginza-sukiyabashi",
    nameJa: "銀座中央通り・晴海通り・数寄屋橋交差点",
    nameEn: "Ginza Chuo-dori, Harumi-dori & Sukiyabashi",
    nameZh: "银座中央通・晴海通・数寄屋桥",
    zone: "tokyo",
    centerX: 200,
    centerZ: -425,
    bounds: { minX: -320, maxX: 520, minZ: -650, maxZ: -200 },
    estimatedMemoryMb: 24,
    associatedGlbModelIds: ["street_tree"],
    isPrimaryHub: false,
  },
  {
    id: "shimbashi-shiodome",
    nameJa: "新橋・SL広場・汐留シオサイト・第一京浜",
    nameEn: "Shimbashi, SL Plaza, Shiodome Sio-Site & Route 15",
    nameZh: "新桥・SL广场・汐留・第一京滨",
    zone: "tokyo",
    centerX: 200,
    centerZ: -925,
    bounds: { minX: -320, maxX: 1200, minZ: -1200, maxZ: -650 },
    estimatedMemoryMb: 22,
    associatedGlbModelIds: ["street_tree"],
    isPrimaryHub: false,
  },
  {
    id: "yaesu-showadori-east",
    nameJa: "八重洲東・昭和通り・宝町・日本橋兜町",
    nameEn: "Yaesu East, Showa-dori, Takaracho & Kabutocho",
    nameZh: "八重洲东・昭和通・宝町・日本桥兜町",
    zone: "tokyo",
    centerX: 860,
    centerZ: -95,
    bounds: { minX: 520, maxX: 1200, minZ: -650, maxZ: 460 },
    estimatedMemoryMb: 20,
    associatedGlbModelIds: ["street_tree"],
    isPrimaryHub: false,
  },
  // === 大東京 10倍拡張 外周リング（28チャンク: 西・北・南・東 全面連続展開） ===
  // 1. 西側ウイング (X: -5600..-1800, 8チャンク)
  {
    id: "nakano-sakaue-honcho",
    nameJa: "中野坂上・青梅街道・方南通り",
    nameEn: "Nakano-Sakaue, Ome-kaido & Honan-dori",
    nameZh: "中野坂上・青梅街道・方南通",
    zone: "shibuya",
    centerX: -4650,
    centerZ: -2700,
    bounds: { minX: -5600, maxX: -3700, minZ: -4200, maxZ: -1200 },
    estimatedMemoryMb: 12,
    associatedGlbModelIds: [],
    isPrimaryHub: false,
  },
  {
    id: "shinjuku-west-tocho",
    nameJa: "西新宿・東京都庁・超高層ビル街",
    nameEn: "West Shinjuku & Tokyo Metropolitan Gov. Towers",
    nameZh: "西新宿・东京都厅・超高层建筑群",
    zone: "shibuya",
    centerX: -2750,
    centerZ: -2700,
    bounds: { minX: -3700, maxX: -1800, minZ: -4200, maxZ: -1200 },
    estimatedMemoryMb: 16,
    associatedGlbModelIds: [],
    isPrimaryHub: true,
  },
  {
    id: "shimokitazawa-daita",
    nameJa: "下北沢・世田谷代田・環七通り西",
    nameEn: "Shimokitazawa, Setagaya-Daita & Kannana West",
    nameZh: "下北泽・世田谷代田・环七通西",
    zone: "shibuya",
    centerX: -4650,
    centerZ: -500,
    bounds: { minX: -5600, maxX: -3700, minZ: -1200, maxZ: 200 },
    estimatedMemoryMb: 12,
    associatedGlbModelIds: [],
    isPrimaryHub: false,
  },
  {
    id: "hatsudai-sasazuka",
    nameJa: "初台・笹塚・甲州街道・オペラシティ",
    nameEn: "Hatsudai, Sasazuka, Koshu-kaido & Opera City",
    nameZh: "初台・笹冢・甲州街道・歌剧城",
    zone: "shibuya",
    centerX: -2750,
    centerZ: -500,
    bounds: { minX: -3700, maxX: -1800, minZ: -1200, maxZ: 200 },
    estimatedMemoryMb: 14,
    associatedGlbModelIds: [],
    isPrimaryHub: false,
  },
  {
    id: "setagaya-komazawa",
    nameJa: "世田谷・駒沢オリンピック公園・玉川通り西",
    nameEn: "Setagaya, Komazawa Olympic Park & Route 246 West",
    nameZh: "世田谷・驹泽公园・玉川通西",
    zone: "shibuya",
    centerX: -4650,
    centerZ: 900,
    bounds: { minX: -5600, maxX: -3700, minZ: 200, maxZ: 1600 },
    estimatedMemoryMb: 12,
    associatedGlbModelIds: [],
    isPrimaryHub: false,
  },
  {
    id: "sangenjaya-ikejiri",
    nameJa: "三軒茶屋・池尻大橋・キャロットタワー",
    nameEn: "Sangenjaya, Ikejiri-Ohashi & Carrot Tower",
    nameZh: "三轩茶屋・池尻大桥・胡萝卜塔",
    zone: "shibuya",
    centerX: -2750,
    centerZ: 900,
    bounds: { minX: -3700, maxX: -1800, minZ: 200, maxZ: 1600 },
    estimatedMemoryMb: 14,
    associatedGlbModelIds: [],
    isPrimaryHub: true,
  },
  {
    id: "jiyugaoka-futako",
    nameJa: "自由が丘・等々力・目黒通り西",
    nameEn: "Jiyugaoka, Todoroki & Meguro-dori West",
    nameZh: "自由之丘・等等力・目黑通西",
    zone: "shibuya",
    centerX: -4650,
    centerZ: 3000,
    bounds: { minX: -5600, maxX: -3700, minZ: 1600, maxZ: 4400 },
    estimatedMemoryMb: 12,
    associatedGlbModelIds: [],
    isPrimaryHub: false,
  },
  {
    id: "gakugeidaigaku-yutenji",
    nameJa: "祐天寺・学芸大学・駒沢通り南",
    nameEn: "Yutenji, Gakugei-Daigaku & Komazawa-dori South",
    nameZh: "祐天寺・学艺大学・驹泽通南",
    zone: "shibuya",
    centerX: -2750,
    centerZ: 3000,
    bounds: { minX: -3700, maxX: -1800, minZ: 1600, maxZ: 4400 },
    estimatedMemoryMb: 12,
    associatedGlbModelIds: [],
    isPrimaryHub: false,
  },
  // 2. 北・南東回廊外周 (X: -1800..+1200, Z: -4200..-1200, 6チャンク)
  {
    id: "yoyogi-shinjuku-south",
    nameJa: "代々木・新宿南口・バスタ新宿・明治通り北",
    nameEn: "Yoyogi, Shinjuku South Gate & Meiji-dori North",
    nameZh: "代代木・新宿南口・明治通北",
    zone: "shibuya",
    centerX: -1205,
    centerZ: -1950,
    bounds: { minX: -1800, maxX: -610, minZ: -2700, maxZ: -1200 },
    estimatedMemoryMb: 14,
    associatedGlbModelIds: [],
    isPrimaryHub: false,
  },
  {
    id: "shinjuku-kabukicho-east",
    nameJa: "新宿三丁目・歌舞伎町・明治通り新宿",
    nameEn: "Shinjuku-Sanchome, Kabukicho & Meiji-dori",
    nameZh: "新宿三丁目・歌舞伎町・明治通",
    zone: "shibuya",
    centerX: -1205,
    centerZ: -3450,
    bounds: { minX: -1800, maxX: -610, minZ: -4200, maxZ: -2700 },
    estimatedMemoryMb: 14,
    associatedGlbModelIds: [],
    isPrimaryHub: false,
  },
  {
    id: "yotsuya-shinanomachi",
    nameJa: "信濃町・四ツ谷・外苑東通り北",
    nameEn: "Shinanomachi, Yotsuya & Gaien-Higashi North",
    nameZh: "信浓町・四谷・外苑东通北",
    zone: "corridor",
    centerX: -205,
    centerZ: -1950,
    bounds: { minX: -610, maxX: 200, minZ: -2700, maxZ: -1200 },
    estimatedMemoryMb: 12,
    associatedGlbModelIds: [],
    isPrimaryHub: false,
  },
  {
    id: "ichigaya-kagurazaka",
    nameJa: "市ヶ谷・飯田橋・神楽坂・外堀通り",
    nameEn: "Ichigaya, Iidabashi, Kagurazaka & Sotobori-dori",
    nameZh: "市谷・饭田桥・神乐坂・外堀通",
    zone: "corridor",
    centerX: -205,
    centerZ: -3450,
    bounds: { minX: -610, maxX: 200, minZ: -4200, maxZ: -2700 },
    estimatedMemoryMb: 12,
    associatedGlbModelIds: [],
    isPrimaryHub: false,
  },
  {
    id: "shinagawa-tamachi",
    nameJa: "田町・高輪ゲートウェイ・第一京浜国道15号",
    nameEn: "Tamachi, Takanawa Gateway & Route 15",
    nameZh: "田町・高轮Gateway・第一京滨",
    zone: "tokyo",
    centerX: 700,
    centerZ: -1950,
    bounds: { minX: 200, maxX: 1200, minZ: -2700, maxZ: -1200 },
    estimatedMemoryMb: 14,
    associatedGlbModelIds: [],
    isPrimaryHub: false,
  },
  {
    id: "shinagawa-tennozu",
    nameJa: "品川駅前・品川インターシティ・天王洲アイル",
    nameEn: "Shinagawa Intercity & Tennozu Isle",
    nameZh: "品川站前・天王洲岛・海岸通",
    zone: "tokyo",
    centerX: 700,
    centerZ: -3450,
    bounds: { minX: 200, maxX: 1200, minZ: -4200, maxZ: -2700 },
    estimatedMemoryMb: 14,
    associatedGlbModelIds: [],
    isPrimaryHub: false,
  },
  // 3. 南西・北東回廊外周 (X: -1800..+1200, Z: +1400..+4400, 6チャンク)
  {
    id: "meguro-nakameguro",
    nameJa: "中目黒・目黒駅前・山手通り南進",
    nameEn: "Nakameguro, Meguro Station & Yamate-dori South",
    nameZh: "中目黑・目黑站・山手通南",
    zone: "shibuya",
    centerX: -1205,
    centerZ: 2150,
    bounds: { minX: -1800, maxX: -610, minZ: 1400, maxZ: 2900 },
    estimatedMemoryMb: 14,
    associatedGlbModelIds: [],
    isPrimaryHub: false,
  },
  {
    id: "gotanda-osaki",
    nameJa: "五反田・大崎ゲートシティ・目黒川",
    nameEn: "Gotanda, Osaki Gate City & Meguro River",
    nameZh: "五反田・大崎・目黑川",
    zone: "shibuya",
    centerX: -1205,
    centerZ: 3650,
    bounds: { minX: -1800, maxX: -610, minZ: 2900, maxZ: 4400 },
    estimatedMemoryMb: 14,
    associatedGlbModelIds: [],
    isPrimaryHub: false,
  },
  {
    id: "hiroo-azabu-juban",
    nameJa: "広尾・麻布十番・芝公園・東京タワー",
    nameEn: "Hiroo, Azabu-Juban, Shiba Park & Tokyo Tower",
    nameZh: "广尾・麻布十番・芝公园・东京塔",
    zone: "corridor",
    centerX: -205,
    centerZ: 2150,
    bounds: { minX: -610, maxX: 200, minZ: 1400, maxZ: 2900 },
    estimatedMemoryMb: 15,
    associatedGlbModelIds: [],
    isPrimaryHub: true,
  },
  {
    id: "korakuen-bunkyo",
    nameJa: "後楽園・東京ドーム・春日通り・白山通り",
    nameEn: "Korakuen, Tokyo Dome & Hakusan-dori",
    nameZh: "后乐园・东京巨蛋・白山通",
    zone: "corridor",
    centerX: -205,
    centerZ: 3650,
    bounds: { minX: -610, maxX: 200, minZ: 2900, maxZ: 4400 },
    estimatedMemoryMb: 13,
    associatedGlbModelIds: [],
    isPrimaryHub: false,
  },
  {
    id: "ueno-okachimachi",
    nameJa: "御徒町・上野駅前・昭和通り北進",
    nameEn: "Okachimachi, Ueno Station & Showa-dori North",
    nameZh: "御徒町・上野站・昭和通北",
    zone: "tokyo",
    centerX: 700,
    centerZ: 2150,
    bounds: { minX: 200, maxX: 1200, minZ: 1400, maxZ: 2900 },
    estimatedMemoryMb: 14,
    associatedGlbModelIds: [],
    isPrimaryHub: false,
  },
  {
    id: "asakusa-kuramae",
    nameJa: "浅草・雷門・蔵前・江戸通り",
    nameEn: "Asakusa, Kaminarimon, Kuramae & Edo-dori",
    nameZh: "浅草・雷门・藏前・江户通",
    zone: "tokyo",
    centerX: 700,
    centerZ: 3650,
    bounds: { minX: 200, maxX: 1200, minZ: 2900, maxZ: 4400 },
    estimatedMemoryMb: 14,
    associatedGlbModelIds: [],
    isPrimaryHub: false,
  },
  // 4. 東側東京湾・隅田川ウイング (X: +1200..+4400, 8チャンク)
  {
    id: "odaiba-rainbow-bridge",
    nameJa: "レインボーブリッジ・お台場海浜公園・臨海副都心",
    nameEn: "Rainbow Bridge, Odaiba & Fuji TV Bayfront",
    nameZh: "彩虹大桥・台场海滨公园・临海副都心",
    zone: "tokyo",
    centerX: 2000,
    centerZ: -2900,
    bounds: { minX: 1200, maxX: 2800, minZ: -4200, maxZ: -1600 },
    estimatedMemoryMb: 16,
    associatedGlbModelIds: [],
    isPrimaryHub: true,
  },
  {
    id: "ariake-tokyo-bigsight",
    nameJa: "有明・東京ビッグサイト・湾岸道路国道357号",
    nameEn: "Ariake, Tokyo Big Sight & Bayshore Route 357",
    nameZh: "有明・东京国际展示场・湾岸道路",
    zone: "tokyo",
    centerX: 3600,
    centerZ: -2900,
    bounds: { minX: 2800, maxX: 4400, minZ: -4200, maxZ: -1600 },
    estimatedMemoryMb: 13,
    associatedGlbModelIds: [],
    isPrimaryHub: false,
  },
  {
    id: "tsukiji-kachidoki",
    nameJa: "築地・勝鬨橋・勝どき・晴海通り東",
    nameEn: "Tsukiji, Kachidoki Bridge & Harumi-dori East",
    nameZh: "筑地・胜哄桥・晴海通东",
    zone: "tokyo",
    centerX: 2000,
    centerZ: -800,
    bounds: { minX: 1200, maxX: 2800, minZ: -1600, maxZ: 0 },
    estimatedMemoryMb: 14,
    associatedGlbModelIds: [],
    isPrimaryHub: false,
  },
  {
    id: "toyosu-harumi",
    nameJa: "晴海フラッグ・豊洲市場・豊洲大橋",
    nameEn: "Harumi Flag, Toyosu Market & Toyosu Bridge",
    nameZh: "晴海・丰洲市场・丰洲大桥",
    zone: "tokyo",
    centerX: 3600,
    centerZ: -800,
    bounds: { minX: 2800, maxX: 4400, minZ: -1600, maxZ: 0 },
    estimatedMemoryMb: 14,
    associatedGlbModelIds: [],
    isPrimaryHub: false,
  },
  {
    id: "monzennakacho-kiyosumi",
    nameJa: "永代橋・門前仲町・清澄白河・永代通り東",
    nameEn: "Eitai Bridge, Monzennakacho & Kiyosumi-Shirakawa",
    nameZh: "永代桥・门前仲町・清澄白河",
    zone: "tokyo",
    centerX: 2000,
    centerZ: 800,
    bounds: { minX: 1200, maxX: 2800, minZ: 0, maxZ: 1600 },
    estimatedMemoryMb: 13,
    associatedGlbModelIds: [],
    isPrimaryHub: false,
  },
  {
    id: "kiba-toyosu-east",
    nameJa: "木場・東陽町・三ツ目通り・葛西橋通り",
    nameEn: "Kiba, Toyocho & Mitsume-dori",
    nameZh: "木场・东阳町・三目通",
    zone: "tokyo",
    centerX: 3600,
    centerZ: 800,
    bounds: { minX: 2800, maxX: 4400, minZ: 0, maxZ: 1600 },
    estimatedMemoryMb: 12,
    associatedGlbModelIds: [],
    isPrimaryHub: false,
  },
  {
    id: "ryogoku-sumida",
    nameJa: "両国国技館・隅田川・京葉道路国道14号",
    nameEn: "Ryogoku Kokugikan, Sumida River & Route 14",
    nameZh: "两国国技馆・隅田川・京叶道路",
    zone: "tokyo",
    centerX: 2000,
    centerZ: 3000,
    bounds: { minX: 1200, maxX: 2800, minZ: 1600, maxZ: 4400 },
    estimatedMemoryMb: 14,
    associatedGlbModelIds: [],
    isPrimaryHub: false,
  },
  {
    id: "kinshicho-skytree",
    nameJa: "錦糸町・押上・東京スカイツリータウン",
    nameEn: "Kinshicho, Oshiage & Tokyo Skytree Town",
    nameZh: "锦糸町・押上・东京晴空塔",
    zone: "tokyo",
    centerX: 3600,
    centerZ: 3000,
    bounds: { minX: 2800, maxX: 4400, minZ: 1600, maxZ: 4400 },
    estimatedMemoryMb: 16,
    associatedGlbModelIds: [],
    isPrimaryHub: true,
  },
] as const;

/**
 * スマホ Chrome やタッチ端末のヒューリスティック判定
 */
export function detectMobileChromeEnvironment(options?: {
  userAgent?: string;
  innerWidth?: number;
  coarsePointer?: boolean;
  deviceMemoryGb?: number;
}): boolean {
  const ua =
    options?.userAgent !== undefined
      ? options.userAgent
      : typeof navigator !== "undefined"
        ? navigator.userAgent
        : "";
  const width =
    options?.innerWidth !== undefined
      ? options.innerWidth
      : typeof window !== "undefined"
        ? window.innerWidth
        : 1280;
  const isCoarse =
    options?.coarsePointer !== undefined
      ? options.coarsePointer
      : typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(pointer: coarse)").matches
        : false;
  const deviceMemory =
    options?.deviceMemoryGb !== undefined
      ? options.deviceMemoryGb
      : typeof navigator !== "undefined" && "deviceMemory" in navigator
        ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8)
        : 8;

  const isMobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const isSmallViewport = width <= 860;
  const isLowMemoryDevice = deviceMemory <= 4;

  const isMobileDetected = isMobileUa || (isCoarse && isSmallViewport) || isLowMemoryDevice;
  return isMobileDetected;
}

/**
 * 画質設定（High / Medium / Low）およびスマホ Chrome 環境に応じた
 * オープンワールド・ストリーミングバジェットを算出する。
 */
export function resolveStreamingBudgetProfile(
  quality: GraphicsQuality,
  isMobileChrome = detectMobileChromeEnvironment(),
): StreamingBudgetProfile {
  const isLowQuality = quality === "low";
  if (isLowQuality) {
    return {
      quality: "low",
      isMobileChrome,
      activeRadiusM: isMobileChrome ? 210 : 250,
      prefetchRadiusM: isMobileChrome ? 340 : 400,
      unloadRadiusM: isMobileChrome ? 430 : 500,
      lookaheadSeconds: 3.2,
      forwardConeBoostM: 120,
      memoryBudgetMb: isMobileChrome ? 78 : 96,
      maxResidentChunks: isMobileChrome ? 3 : 4,
      frameSliceBudgetMs: isMobileChrome ? 1.8 : 2.5,
      maxChunksPerFrame: 1,
      popInTransitionSpeed: 3.2,
      maxAutoRetries: 3,
      retryBaseDelayMs: 450,
    };
  }

  const isMediumQuality = quality === "medium";
  if (isMediumQuality) {
    return {
      quality: "medium",
      isMobileChrome,
      activeRadiusM: isMobileChrome ? 260 : 320,
      prefetchRadiusM: isMobileChrome ? 430 : 520,
      unloadRadiusM: isMobileChrome ? 540 : 640,
      lookaheadSeconds: 4.0,
      forwardConeBoostM: 165,
      memoryBudgetMb: isMobileChrome ? 105 : 138,
      maxResidentChunks: isMobileChrome ? 4 : 6,
      frameSliceBudgetMs: isMobileChrome ? 2.4 : 3.5,
      maxChunksPerFrame: isMobileChrome ? 1 : 2,
      popInTransitionSpeed: 3.6,
      maxAutoRetries: 3,
      retryBaseDelayMs: 400,
    };
  }

  return {
    quality: "high",
    isMobileChrome,
    activeRadiusM: isMobileChrome ? 310 : 410,
    prefetchRadiusM: isMobileChrome ? 500 : 660,
    unloadRadiusM: isMobileChrome ? 560 : 680,
    lookaheadSeconds: 4.8,
    forwardConeBoostM: 210,
    memoryBudgetMb: isMobileChrome ? 128 : 195,
    maxResidentChunks: isMobileChrome ? 5 : 7,
    frameSliceBudgetMs: isMobileChrome ? 3.0 : 4.8,
    maxChunksPerFrame: 2,
    popInTransitionSpeed: 4.2,
    maxAutoRetries: 3,
    retryBaseDelayMs: 350,
  };
}

/**
 * 任意のワールド座標 (x, z) が所属するチャンクIDを特定する。
 * 境界外の場合は最も中心距離が近いチャンクを返す。
 */
export function resolveChunkIdAtPosition(x: number, z: number): WorldChunkId {
  for (const def of WORLD_CHUNK_DEFINITIONS) {
    const isInsideX = x >= def.bounds.minX && x <= def.bounds.maxX;
    const isInsideZ = z >= def.bounds.minZ && z <= def.bounds.maxZ;
    const isInsideBounds = isInsideX && isInsideZ;
    if (isInsideBounds) {
      return def.id;
    }
  }

  let closestId: WorldChunkId = "shibuya-core";
  let minDistanceSq = Number.POSITIVE_INFINITY;
  for (const def of WORLD_CHUNK_DEFINITIONS) {
    const dx = x - def.centerX;
    const dz = z - def.centerZ;
    const distSq = dx * dx + dz * dz;
    const isCloser = distSq < minDistanceSq;
    if (isCloser) {
      minDistanceSq = distSq;
      closestId = def.id;
    }
  }
  return closestId;
}

/**
 * 点 (x, z) からチャンクの境界ボックス（AABB）までの最短距離 (m) を計算する。
 * チャンク内部にいる場合は 0 を返す。
 * Why not: チャンク中心点との距離だけで判定すると、長方形チャンクの端（交差点付近）を走行中に
 * 隣接チャンクへの切り替えが遅れてポップインが発生するため、AABB最短距離と中心距離を併用する。
 */
export function computeDistanceToChunkBounds(
  x: number,
  z: number,
  chunk: WorldChunkDefinition,
): number {
  const clampedX = Math.max(chunk.bounds.minX, Math.min(chunk.bounds.maxX, x));
  const clampedZ = Math.max(chunk.bounds.minZ, Math.min(chunk.bounds.maxZ, z));
  const dx = x - clampedX;
  const dz = z - clampedZ;
  return Math.hypot(dx, dz);
}

/**
 * 車両の現在位置・速度ベクトル・進行方向（headingAngle）から、
 * 先読み予測座標および各チャンクの優先度スコアを算出する。
 */
export function computeChunkPriorityScore(params: {
  chunk: WorldChunkDefinition;
  vehicleX: number;
  vehicleZ: number;
  velocityX: number;
  velocityZ: number;
  headingAngleRad: number;
  speedKmh: number;
  budget: StreamingBudgetProfile;
}): {
  priorityScore: number;
  distanceFromVehicleM: number;
  distanceFromPredictedM: number;
  isWithinActiveRadius: boolean;
  isWithinPrefetchCone: boolean;
} {
  const { chunk, vehicleX, vehicleZ, velocityX, velocityZ, headingAngleRad, speedKmh, budget } =
    params;

  const distBoundsM = computeDistanceToChunkBounds(vehicleX, vehicleZ, chunk);
  const distCenterM = Math.hypot(vehicleX - chunk.centerX, vehicleZ - chunk.centerZ);
  const distanceFromVehicleM = distBoundsM * 0.75 + distCenterM * 0.25;

  // 進行方向単位ベクトル（速度が十分にある場合は速度ベクトル優先、停止・極低速時は車体向き）
  // VehicleController の forward は (-sin(heading), -cos(heading)) または速度ベクトル方向
  const speedMs = Math.hypot(velocityX, velocityZ);
  const isMovingSignificantly = speedMs > 1.2;
  const dirX = isMovingSignificantly ? velocityX / speedMs : -Math.sin(headingAngleRad);
  const dirZ = isMovingSignificantly ? velocityZ / speedMs : -Math.cos(headingAngleRad);

  // 到達予測位置: 現在位置 + 速度ベクトル × lookaheadSeconds + 前方バイアス
  const effectiveLeadDistance = Math.min(
    budget.forwardConeBoostM,
    speedMs * budget.lookaheadSeconds + (speedKmh > 15 ? 65 : 25),
  );
  const predictedX = vehicleX + dirX * effectiveLeadDistance;
  const predictedZ = vehicleZ + dirZ * effectiveLeadDistance;

  const predBoundsM = computeDistanceToChunkBounds(predictedX, predictedZ, chunk);
  const predCenterM = Math.hypot(predictedX - chunk.centerX, predictedZ - chunk.centerZ);
  const distanceFromPredictedM = predBoundsM * 0.75 + predCenterM * 0.25;

  // 前方コーン内積判定（チャンク中心が車両の進行方向前方にあるか）
  const toChunkX = chunk.centerX - vehicleX;
  const toChunkZ = chunk.centerZ - vehicleZ;
  const toChunkLen = Math.hypot(toChunkX, toChunkZ);
  const forwardAlignment =
    toChunkLen > 1e-3 ? (toChunkX * dirX + toChunkZ * dirZ) / toChunkLen : 1.0;

  const isAheadInCone = forwardAlignment >= 0.25;
  const isWithinActiveRadius = distBoundsM <= budget.activeRadiusM;
  const isWithinPrefetchCone =
    distBoundsM <= budget.prefetchRadiusM &&
    (isAheadInCone || predBoundsM <= budget.activeRadiusM * 1.15);

  // 優先度スコア計算（1000点満点基準）
  let priorityScore = 1000 - distanceFromVehicleM * 1.1 - distanceFromPredictedM * 0.65;
  if (isWithinActiveRadius) {
    priorityScore += 500;
  }
  if (isAheadInCone) {
    priorityScore += forwardAlignment * 220;
  }
  if (chunk.isPrimaryHub) {
    priorityScore += 45;
  }

  return {
    priorityScore: Math.round(priorityScore * 10) / 10,
    distanceFromVehicleM: Math.round(distanceFromVehicleM * 10) / 10,
    distanceFromPredictedM: Math.round(distanceFromPredictedM * 10) / 10,
    isWithinActiveRadius,
    isWithinPrefetchCone,
  };
}

/**
 * チャンクローダーの外部連携フック（GLB遅延ロード・チャンクメッシュ再構築/解放・GPU統計取得）
 */
export interface OpenWorldStreamingCallbacks {
  /** 指定チャンクの3Dオブジェクト群やGLBモデルをロード・有効化する */
  onActivateChunk?: (chunkId: WorldChunkId) => Promise<void> | void;
  /** 指定チャンクの不要な高負荷アセット・ジオメトリをアンロード（メモリ解放）する */
  onEvictChunk?: (chunkId: WorldChunkId) => void;
  /** 各チャンクのポップイン抑制トランジション係数 (0..1) を反映する */
  onUpdateChunkTransition?: (chunkId: WorldChunkId, alpha: number) => void;
  /** 現在のThree.js GPUメモリ統計（geometries / textures）を返す */
  getGpuMemoryStats?: () => { geometries: number; textures: number };
}

/**
 * オープンワールド型チャンクストリーミング＆メモリ管理システム
 *
 * How:
 * 1. 起動時は初期座標（渋谷または東京駅）周辺の必須チャンクのみを優先ロードし、最短時間でプレイ可能状態にする。
 * 2. 走行中は車両の位置・速度・進行方向から前方チャンクの優先度スコアを毎フレーム計算し、
 *    フレーム予算（タイムスライス）内でバックグラウンド先読み（Prefetch）を実行する。
 * 3. 画質（高・中・低）およびスマホ Chrome に応じたメモリ上限・保持半径を超えた遠方チャンクを
 *    LRU + 距離ベースで安全に解放（Evict）し、メモリ圧迫とGCスパイクを防ぐ。
 * 4. エリア移動・ワープ時はワープ先チャンクを優先プリウォームしつつ進捗を通知し、
 *    段階的なフェード/スケール遷移（`transitionAlpha`）で建物・道路の突然の出現（ポップイン）を抑える。
 * 5. 読み込み失敗時は指数バックオフによる自動再試行と UI からの手動再試行（Retry）を提供する。
 */
export class OpenWorldStreamingSystem {
  private budget: StreamingBudgetProfile;
  private readonly chunks = new Map<WorldChunkId, WorldChunkRuntimeState>();
  private readonly callbacks: OpenWorldStreamingCallbacks;
  private currentChunkId: WorldChunkId = "shibuya-core";
  private phase: OpenWorldStreamingStatus["phase"] = "booting";
  private priorityTargetChunkIds = new Set<WorldChunkId>();
  private totalEvictedCount = 0;
  private lastErrorMessage: string | null = null;
  private simulatedFailureChunkIds = new Set<WorldChunkId>();
  private readonly statusListeners = new Set<(status: OpenWorldStreamingStatus) => void>();

  constructor(options?: {
    quality?: GraphicsQuality;
    isMobileChrome?: boolean;
    callbacks?: OpenWorldStreamingCallbacks;
  }) {
    const quality = options?.quality ?? "high";
    const isMobileChrome = options?.isMobileChrome ?? detectMobileChromeEnvironment();
    this.budget = resolveStreamingBudgetProfile(quality, isMobileChrome);
    this.callbacks = options?.callbacks ?? {};

    const nowMs = Date.now();
    for (const def of WORLD_CHUNK_DEFINITIONS) {
      this.chunks.set(def.id, {
        definition: def,
        state: "unloaded",
        transitionAlpha: 0,
        priorityScore: 0,
        distanceFromVehicleM: 0,
        distanceFromPredictedM: 0,
        lastActiveTimestampMs: nowMs,
        retryCount: 0,
        lastError: null,
        boundObjectCount: 0,
        isResidentInMemory: false,
      });
    }
  }

  /**
   * ステータス変更リスナーを登録する
   */
  public onStatusChange(listener: (status: OpenWorldStreamingStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private emitStatus(): void {
    const status = this.getStatus();
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }

  /**
   * チャンクに紐づくシーン内3Dオブジェクト数を記録する
   */
  public setChunkBoundObjectCount(chunkId: WorldChunkId, count: number): void {
    const entry = this.chunks.get(chunkId);
    const hasEntry = entry !== undefined;
    if (hasEntry) {
      entry.boundObjectCount = count;
    }
  }

  /**
   * 画質設定またはモバイルモード変更時にストリーミングバジェットを動的更新する
   */
  public setQualityProfile(quality: GraphicsQuality, isMobileChrome?: boolean): void {
    const mobileFlag = isMobileChrome ?? this.budget.isMobileChrome;
    this.budget = resolveStreamingBudgetProfile(quality, mobileFlag);
    logger.info("streaming", "budget.update", "Updated open-world streaming budget profile", {
      quality: this.budget.quality,
      isMobileChrome: this.budget.isMobileChrome,
      activeRadiusM: this.budget.activeRadiusM,
      prefetchRadiusM: this.budget.prefetchRadiusM,
      unloadRadiusM: this.budget.unloadRadiusM,
      memoryBudgetMb: this.budget.memoryBudgetMb,
      maxResidentChunks: this.budget.maxResidentChunks,
    });
    this.enforceMemoryBudgetAndEvict();
    this.emitStatus();
  }

  public getBudgetProfile(): StreamingBudgetProfile {
    return { ...this.budget };
  }

  /**
   * テスト・検証用に特定チャンクの読み込み失敗をシミュレート注入する
   */
  public setSimulatedChunkFailure(chunkId: WorldChunkId, shouldFail: boolean): void {
    if (shouldFail) {
      this.simulatedFailureChunkIds.add(chunkId);
    } else {
      this.simulatedFailureChunkIds.delete(chunkId);
    }
  }

  /**
   * 初期起動時またはエリアワープ時に、指定座標周辺の必須チャンク群を特定し、
   * 優先ロードしてプレイ可能状態になるまで進捗コールバックを駆動する。
   */
  public async loadPriorityAreaAround(
    x: number,
    z: number,
    options?: {
      isWarp?: boolean;
      headingAngleRad?: number;
      onProgress?: (progressPercent: number, status: OpenWorldStreamingStatus) => void;
    },
  ): Promise<OpenWorldStreamingStatus> {
    const isWarp = Boolean(options?.isWarp);
    const headingAngleRad = options?.headingAngleRad ?? 0;

    return logger.withAsyncTrace(
      "streaming",
      isWarp ? "area.warp_stream" : "boot.priority_stream",
      async () => {
        this.phase = isWarp ? "warping" : "booting";
        this.lastErrorMessage = null;
        this.currentChunkId = resolveChunkIdAtPosition(x, z);

        // 現在位置および初期進行方向の近傍チャンクを抽出
        const scoredChunks = WORLD_CHUNK_DEFINITIONS.map((def) => {
          const scoreInfo = computeChunkPriorityScore({
            chunk: def,
            vehicleX: x,
            vehicleZ: z,
            velocityX: 0,
            velocityZ: 0,
            headingAngleRad,
            speedKmh: 0,
            budget: this.budget,
          });
          const runtime = this.chunks.get(def.id)!;
          runtime.priorityScore = scoreInfo.priorityScore;
          runtime.distanceFromVehicleM = scoreInfo.distanceFromVehicleM;
          runtime.distanceFromPredictedM = scoreInfo.distanceFromPredictedM;
          return {
            id: def.id,
            scoreInfo,
          };
        }).sort((a, b) => b.scoreInfo.priorityScore - a.scoreInfo.priorityScore);

        // 起動・ワープ時に最低限必要なチャンク（現在チャンク + activeRadius内の上位チャンク、最大3チャンク）
        const priorityIds: WorldChunkId[] = [];
        for (const item of scoredChunks) {
          const isCurrent = item.id === this.currentChunkId;
          const isNearActive =
            item.scoreInfo.isWithinActiveRadius &&
            priorityIds.length < Math.min(3, this.budget.maxResidentChunks);
          const shouldInclude = isCurrent || isNearActive;
          if (shouldInclude) {
            priorityIds.push(item.id);
          }
        }
        const isEmptyPriority = priorityIds.length === 0;
        if (isEmptyPriority) {
          priorityIds.push(this.currentChunkId);
        }

        this.priorityTargetChunkIds = new Set(priorityIds);

        // ワープ時は最初に遠方の不要チャンクをメモリ解放してバジェットを空ける
        if (isWarp) {
          this.enforceMemoryBudgetAndEvict(this.priorityTargetChunkIds, {
            aggressiveDistanceThresholdM: this.budget.activeRadiusM * 1.15,
          });
        }

        for (const targetId of priorityIds) {
          const chunk = this.chunks.get(targetId)!;
          const isNotActive = chunk.state !== "active";
          if (isNotActive) {
            chunk.state = "queued";
          }
        }
        this.emitStatus();
        options?.onProgress?.(this.computePriorityProgressPercent(), this.getStatus());

        // 優先チャンクを順番にロード＆有効化
        for (let i = 0; i < priorityIds.length; i++) {
          const targetId = priorityIds[i];
          await this.activateChunkWithRetry(targetId, { immediateTransition: true });
          const progress = this.computePriorityProgressPercent();
          options?.onProgress?.(progress, this.getStatus());
        }

        const currentZone = this.chunks.get(this.currentChunkId)?.definition.zone ?? "shibuya";

        // 残りの進行方向プリフェッチ対象チャンクをバックグラウンドキューに積む
        for (const item of scoredChunks) {
          const isAlreadyPriority = this.priorityTargetChunkIds.has(item.id);
          if (isAlreadyPriority) {
            continue;
          }
          const runtime = this.chunks.get(item.id)!;
          const isBlockedCrossCityFar = this.isCrossCityPrefetchBlocked(
            currentZone,
            runtime.definition.zone,
            item.scoreInfo.distanceFromVehicleM,
          );
          const shouldQueueForPrefetch =
            !isBlockedCrossCityFar &&
            item.scoreInfo.isWithinPrefetchCone &&
            runtime.state === "unloaded";
          if (shouldQueueForPrefetch) {
            runtime.state = "queued";
          }
        }

        this.enforceMemoryBudgetAndEvict(this.priorityTargetChunkIds);

        const hasFailedPriority = priorityIds.some((id) => this.chunks.get(id)?.state === "failed");
        this.phase = hasFailedPriority ? "error" : "ready";
        this.emitStatus();
        options?.onProgress?.(this.computePriorityProgressPercent(), this.getStatus());
        return this.getStatus();
      },
      {
        x: Math.round(x),
        z: Math.round(z),
        isWarp,
        currentChunkId: this.currentChunkId,
        quality: this.budget.quality,
      },
    );
  }

  /**
   * 単一チャンクをロード・有効化する（失敗時は指数バックオフで自動リトライし、上限到達時は failed に遷移）
   */
  public async activateChunkWithRetry(
    chunkId: WorldChunkId,
    options?: { immediateTransition?: boolean },
  ): Promise<boolean> {
    const chunk = this.chunks.get(chunkId);
    const isMissing = chunk === undefined;
    if (isMissing) {
      return false;
    }

    const isAlreadyActive = chunk.state === "active" && chunk.isResidentInMemory;
    if (isAlreadyActive) {
      chunk.lastActiveTimestampMs = Date.now();
      if (options?.immediateTransition) {
        chunk.transitionAlpha = 1.0;
        this.callbacks.onUpdateChunkTransition?.(chunkId, 1.0);
      }
      return true;
    }

    chunk.state = "loading";
    chunk.lastError = null;
    this.emitStatus();

    const maxAttempts = this.budget.maxAutoRetries + 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const isSimulatedFail = this.simulatedFailureChunkIds.has(chunkId);
        if (isSimulatedFail) {
          throw new Error(`Simulated chunk load failure for ${chunkId}`);
        }

        await this.callbacks.onActivateChunk?.(chunkId);

        chunk.state = "active";
        chunk.isResidentInMemory = true;
        chunk.lastActiveTimestampMs = Date.now();
        chunk.retryCount = attempt - 1;
        chunk.lastError = null;

        const shouldShowImmediately = Boolean(options?.immediateTransition);
        chunk.transitionAlpha = shouldShowImmediately ? 1.0 : Math.max(0.18, chunk.transitionAlpha);
        this.callbacks.onUpdateChunkTransition?.(chunkId, chunk.transitionAlpha);

        this.emitStatus();
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        chunk.retryCount = attempt;
        chunk.lastError = message;
        this.lastErrorMessage = `${chunk.definition.nameJa}: ${message}`;

        const hasMoreRetries = attempt < maxAttempts;
        if (hasMoreRetries) {
          // テスト環境やシミュレート時は短時間でバックオフ
          const delayMs = Math.min(80, this.budget.retryBaseDelayMs * Math.pow(1.5, attempt - 1));
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    chunk.state = "failed";
    this.phase = "error";
    logger.warn("streaming", "chunk.load_failed", `Chunk ${chunkId} failed to load after retries`, {
      chunkId,
      retryCount: chunk.retryCount,
      error: chunk.lastError,
    });
    this.emitStatus();
    return false;
  }

  /**
   * 失敗状態のすべてのチャンクを手動で再試行（Retry）する
   */
  public async retryFailedChunks(): Promise<OpenWorldStreamingStatus> {
    return logger.withAsyncTrace("streaming", "chunk.manual_retry", async () => {
      const failedIds: WorldChunkId[] = [];
      for (const [id, chunk] of this.chunks.entries()) {
        const isFailed = chunk.state === "failed";
        if (isFailed) {
          failedIds.push(id);
        }
      }

      this.lastErrorMessage = null;
      for (const id of failedIds) {
        await this.activateChunkWithRetry(id, { immediateTransition: true });
      }

      const stillHasFailed = Array.from(this.chunks.values()).some((c) => c.state === "failed");
      this.phase = stillHasFailed ? "error" : "ready";
      this.emitStatus();
      return this.getStatus();
    });
  }

  /**
   * 毎フレームの走行中ストリーミング更新
   * - 車両位置・速度・進行方向から各チャンクの優先度と先読み対象を更新
   * - フレーム予算（タイムスライス）内でキュー内チャンクを段階的にロード開始
   * - ポップイン防止トランジション（`transitionAlpha`）を滑らかに補間
   * - 遠方チャンクおよびメモリ上限超過チャンクを解放（Evict）
   */
  public updateFrame(params: {
    vehicleX: number;
    vehicleZ: number;
    velocityX: number;
    velocityZ: number;
    headingAngleRad: number;
    speedKmh: number;
    deltaSeconds: number;
  }): OpenWorldStreamingStatus {
    const frameStartMs = typeof performance !== "undefined" ? performance.now() : Date.now();
    const nowMs = Date.now();
    const { vehicleX, vehicleZ, velocityX, velocityZ, headingAngleRad, speedKmh, deltaSeconds } =
      params;

    this.currentChunkId = resolveChunkIdAtPosition(vehicleX, vehicleZ);
    const currentZone = this.chunks.get(this.currentChunkId)?.definition.zone ?? "shibuya";

    // 1. 全チャンクの距離・進行方向予測スコアを更新し、優先度上位のチャンクのみをアクティブ/キュー対象として選定
    // Why not shouldBeActiveOrQueued だけで全対象チャンクを無制限に queued にするか:
    // maxResidentChunks や memoryBudgetMb を超える数のチャンクを毎フレーム queued にしてロードすると、
    // 直後の Step 4 (enforceMemoryBudgetAndEvict) で即座に Evict され、次フレームで再び queued になる
    // Activate ⇄ Evict の無限ピンポン（チャタリング）が発生して画面のチラつきや負荷スパイクを招くため。
    const scoredChunks: Array<{
      chunk: WorldChunkRuntimeState;
      shouldBeCandidate: boolean;
      isCurrentOrActiveZone: boolean;
    }> = [];

    for (const chunk of this.chunks.values()) {
      const score = computeChunkPriorityScore({
        chunk: chunk.definition,
        vehicleX,
        vehicleZ,
        velocityX,
        velocityZ,
        headingAngleRad,
        speedKmh,
        budget: this.budget,
      });

      chunk.priorityScore = score.priorityScore;
      chunk.distanceFromVehicleM = score.distanceFromVehicleM;
      chunk.distanceFromPredictedM = score.distanceFromPredictedM;

      const isBlockedCrossCityFar = this.isCrossCityPrefetchBlocked(
        currentZone,
        chunk.definition.zone,
        score.distanceFromVehicleM,
      );
      const isCurrentOrActiveZone =
        chunk.definition.id === this.currentChunkId || score.isWithinActiveRadius;
      const isWithinUnloadBoundary = score.distanceFromVehicleM <= this.budget.unloadRadiusM;
      const shouldBeCandidate =
        chunk.definition.id === this.currentChunkId ||
        (!isBlockedCrossCityFar &&
          (isCurrentOrActiveZone || score.isWithinPrefetchCone) &&
          isWithinUnloadBoundary);
      scoredChunks.push({ chunk, shouldBeCandidate, isCurrentOrActiveZone });
    }

    scoredChunks.sort((a, b) => b.chunk.priorityScore - a.chunk.priorityScore);
    const allowedTargetIds = new Set<WorldChunkId>();
    let projectedMemoryMb = 24; // computeEstimatedMemoryUsedMb() のベースライン (24MB) と一致させる
    for (const item of scoredChunks) {
      if (!item.shouldBeCandidate) {
        continue;
      }
      const isCurrent = item.chunk.definition.id === this.currentChunkId;
      const canFitCount = allowedTargetIds.size < this.budget.maxResidentChunks;
      const nextMemoryMb = projectedMemoryMb + item.chunk.definition.estimatedMemoryMb;
      const canFitMemory = nextMemoryMb <= this.budget.memoryBudgetMb;
      const isAllowed = isCurrent || (canFitCount && canFitMemory);
      if (isAllowed) {
        allowedTargetIds.add(item.chunk.definition.id);
        projectedMemoryMb = nextMemoryMb;
      }
    }

    // すでに active / loading 中のチャンクが占めている実カウント・実メモリと、
    // まだ Evict されていない非 allowed チャンクがどれだけ Step 4 で空くかを考慮して
    // 新規 queued 数を制限する（非同期 activate 完了時に Step 4 で押し出されるピンポンを防止）
    let activeAllowedCount = 0;
    let activeAllowedMemMb = 24;
    for (const chunk of this.chunks.values()) {
      const isBusy =
        chunk.state === "active" || chunk.state === "loading" || chunk.isResidentInMemory;
      const isAllowed = allowedTargetIds.has(chunk.definition.id);
      if (isBusy && isAllowed) {
        activeAllowedCount++;
        activeAllowedMemMb += chunk.definition.estimatedMemoryMb;
      }
    }

    const candidateQueue: WorldChunkRuntimeState[] = [];
    let queuedMemMb = activeAllowedMemMb;
    let queuedCount = activeAllowedCount;
    for (const { chunk } of scoredChunks) {
      const isAllowedTarget = allowedTargetIds.has(chunk.definition.id);
      if (chunk.state === "active") {
        if (isAllowedTarget) {
          chunk.lastActiveTimestampMs = nowMs;
        }
      } else if (chunk.state === "unloaded" && isAllowedTarget) {
        const isCurrent = chunk.definition.id === this.currentChunkId;
        const canQueueCount = queuedCount < this.budget.maxResidentChunks;
        const canQueueMem =
          queuedMemMb + chunk.definition.estimatedMemoryMb <= this.budget.memoryBudgetMb;
        if (isCurrent || (canQueueCount && canQueueMem)) {
          chunk.state = "queued";
          queuedCount++;
          queuedMemMb += chunk.definition.estimatedMemoryMb;
        }
      } else if (chunk.state === "queued" && !isAllowedTarget) {
        chunk.state = "unloaded";
      }

      if (chunk.state === "queued") {
        candidateQueue.push(chunk);
      }
    }

    // 2. 優先度順にソートし、1フレームあたりのタイムスライス予算内でバックグラウンド先読みを実行
    candidateQueue.sort((a, b) => b.priorityScore - a.priorityScore);
    let processedThisFrame = 0;
    for (const queuedChunk of candidateQueue) {
      const elapsedMs =
        (typeof performance !== "undefined" ? performance.now() : Date.now()) - frameStartMs;
      const hasExceededFrameBudget =
        processedThisFrame >= this.budget.maxChunksPerFrame ||
        (processedThisFrame > 0 && elapsedMs >= this.budget.frameSliceBudgetMs);
      if (hasExceededFrameBudget) {
        break;
      }

      processedThisFrame++;
      const isUrgentCurrentChunk = queuedChunk.definition.id === this.currentChunkId;
      void this.activateChunkWithRetry(queuedChunk.definition.id, {
        immediateTransition: isUrgentCurrentChunk,
      });
    }

    // 3. ポップイン防止トランジション係数の滑らかな更新 (0 -> 1)
    const stepAlpha = Math.min(1, Math.max(0.016, deltaSeconds) * this.budget.popInTransitionSpeed);
    for (const chunk of this.chunks.values()) {
      const isChunkActive = chunk.state === "active";
      if (isChunkActive && chunk.transitionAlpha < 1.0) {
        chunk.transitionAlpha = Math.min(1.0, chunk.transitionAlpha + stepAlpha);
        this.callbacks.onUpdateChunkTransition?.(chunk.definition.id, chunk.transitionAlpha);
      } else if (!isChunkActive && chunk.transitionAlpha > 0) {
        chunk.transitionAlpha = Math.max(0, chunk.transitionAlpha - stepAlpha * 1.5);
        this.callbacks.onUpdateChunkTransition?.(chunk.definition.id, chunk.transitionAlpha);
      }
    }

    // 4. 遠方チャンクのアンロードとメモリバジェット強制（Eviction）
    this.enforceMemoryBudgetAndEvict();

    const hasLoadingOrQueued = Array.from(this.chunks.values()).some(
      (c) => c.state === "loading" || c.state === "queued",
    );
    const hasFailed = Array.from(this.chunks.values()).some((c) => c.state === "failed");
    if (hasFailed) {
      this.phase = "error";
    } else if (hasLoadingOrQueued) {
      this.phase = "streaming";
    } else {
      this.phase = "ready";
    }

    return this.getStatus();
  }

  /**
   * 遠方チャンク（unloadRadiusM 超え）およびメモリ上限（memoryBudgetMb / maxResidentChunks）を
   * 超過しているチャンクを安全な順序（最も遠く優先度の低いものから）で解放する。
   */
  public enforceMemoryBudgetAndEvict(
    protectedChunkIds?: ReadonlySet<WorldChunkId>,
    options?: { aggressiveDistanceThresholdM?: number },
  ): number {
    let evictedNow = 0;
    const distanceThresholdM = options?.aggressiveDistanceThresholdM ?? this.budget.unloadRadiusM;

    // Step A: しきい値距離（通常は unloadRadiusM、ワープ時は activeRadiusM * 1.15）を超えて離れたチャンクを解放
    for (const chunk of this.chunks.values()) {
      const isProtected =
        chunk.definition.id === this.currentChunkId ||
        Boolean(protectedChunkIds?.has(chunk.definition.id));
      if (isProtected) {
        continue;
      }

      const isResidentOrActive = chunk.state === "active" || chunk.isResidentInMemory;
      const isBeyondUnloadDistance = chunk.distanceFromVehicleM > distanceThresholdM;
      if (isResidentOrActive && isBeyondUnloadDistance) {
        this.evictSingleChunk(chunk);
        evictedNow++;
      }
    }

    // Step B: メモリ使用量または最大常駐チャンク数を超えている場合、優先度が最も低い遠方チャンクから解放
    const getResidentCandidates = (): WorldChunkRuntimeState[] =>
      Array.from(this.chunks.values())
        .filter(
          (c) =>
            (c.state === "active" || c.isResidentInMemory) &&
            c.definition.id !== this.currentChunkId &&
            !protectedChunkIds?.has(c.definition.id),
        )
        .sort((a, b) => a.priorityScore - b.priorityScore);

    let safetyCounter = 0;
    while (safetyCounter < WORLD_CHUNK_DEFINITIONS.length) {
      safetyCounter++;
      const currentMemMb = this.computeEstimatedMemoryUsedMb();
      const residentCount = Array.from(this.chunks.values()).filter(
        (c) => c.state === "active" || c.isResidentInMemory,
      ).length;

      const isOverMemoryBudget = currentMemMb > this.budget.memoryBudgetMb;
      const isOverCountBudget = residentCount > this.budget.maxResidentChunks;
      const needsEviction = isOverMemoryBudget || isOverCountBudget;
      if (!needsEviction) {
        break;
      }

      const candidates = getResidentCandidates();
      const hasCandidate = candidates.length > 0;
      if (!hasCandidate) {
        break;
      }

      const victim = candidates[0];
      this.evictSingleChunk(victim);
      evictedNow++;
    }

    return evictedNow;
  }

  private evictSingleChunk(chunk: WorldChunkRuntimeState): void {
    chunk.state = "unloaded";
    chunk.isResidentInMemory = false;
    chunk.transitionAlpha = 0;
    this.totalEvictedCount++;
    this.callbacks.onUpdateChunkTransition?.(chunk.definition.id, 0);
    this.callbacks.onEvictChunk?.(chunk.definition.id);
  }

  /**
   * 特定チャンクを強制的にアンロード（Evict）する（テスト・検証・手動解放用）
   */
  public forceEvictChunk(chunkId: WorldChunkId): boolean {
    const chunk = this.chunks.get(chunkId);
    const isMissing = chunk === undefined;
    if (isMissing) {
      return false;
    }
    this.evictSingleChunk(chunk);
    this.emitStatus();
    return true;
  }

  /**
   * 東京⇄渋谷の遠方越境プリフェッチ抑止判定。
   * 廊下セクター ("corridor") を跨いで反対都市のチャンクが遠方から先読みされるのを防ぐ。
   */
  private isCrossCityPrefetchBlocked(
    currentZone: WorldChunkDefinition["zone"],
    targetZone: WorldChunkDefinition["zone"],
    distanceFromVehicleM: number,
  ): boolean {
    const isOppositeCity =
      (currentZone === "tokyo" && targetZone === "shibuya") ||
      (currentZone === "shibuya" && targetZone === "tokyo");
    return isOppositeCity && distanceFromVehicleM > this.budget.activeRadiusM;
  }

  private computeEstimatedMemoryUsedMb(): number {
    // 共通ベースライン（車両・基本物理・共通シェーダー: 約24MB）+ 常駐チャンクの合計
    let totalMb = 24;
    for (const chunk of this.chunks.values()) {
      const isResident = chunk.state === "active" || chunk.isResidentInMemory;
      if (isResident) {
        totalMb += chunk.definition.estimatedMemoryMb;
      }
    }
    return Math.round(totalMb * 10) / 10;
  }

  private computePriorityProgressPercent(): number {
    const targetCount = this.priorityTargetChunkIds.size;
    const isEmpty = targetCount === 0;
    if (isEmpty) {
      return 100;
    }

    let completedWeight = 0;
    for (const id of this.priorityTargetChunkIds) {
      const chunk = this.chunks.get(id);
      if (!chunk) {
        continue;
      }
      if (chunk.state === "active") {
        completedWeight += 1.0;
      } else if (chunk.state === "loading") {
        completedWeight += 0.45;
      }
    }
    return Math.min(100, Math.round((completedWeight / targetCount) * 100));
  }

  /**
   * 特定チャンクの現在のランタイム状態を取得する
   */
  public getChunkState(chunkId: WorldChunkId): WorldChunkRuntimeState | undefined {
    const state = this.chunks.get(chunkId);
    return state ? { ...state } : undefined;
  }

  /**
   * 全チャンクのランタイム状態一覧を取得する（優先度順）
   */
  public getAllChunkStates(): WorldChunkRuntimeState[] {
    return Array.from(this.chunks.values())
      .map((c) => ({ ...c }))
      .sort((a, b) => b.priorityScore - a.priorityScore);
  }

  /**
   * 現在のストリーミング状態・メモリ使用量・進捗の包括的スナップショットを取得する
   */
  public getStatus(): OpenWorldStreamingStatus {
    let activeChunkCount = 0;
    let loadingChunkCount = 0;
    let queuedChunkCount = 0;
    let unloadedChunkCount = 0;
    let failedChunkCount = 0;
    const prefetchTargetIds: WorldChunkId[] = [];

    for (const chunk of this.chunks.values()) {
      if (chunk.state === "active") {
        activeChunkCount++;
      } else if (chunk.state === "loading") {
        loadingChunkCount++;
        prefetchTargetIds.push(chunk.definition.id);
      } else if (chunk.state === "queued") {
        queuedChunkCount++;
        prefetchTargetIds.push(chunk.definition.id);
      } else if (chunk.state === "failed") {
        failedChunkCount++;
      } else {
        unloadedChunkCount++;
      }
    }

    const currentChunkDef =
      this.chunks.get(this.currentChunkId)?.definition ?? WORLD_CHUNK_DEFINITIONS[0];

    let jsHeapUsedMb: number | null = null;
    const hasPerfMemory =
      typeof performance !== "undefined" &&
      "memory" in performance &&
      Boolean((performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory);
    if (hasPerfMemory) {
      const rawBytes =
        (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory
          ?.usedJSHeapSize ?? 0;
      if (rawBytes > 0) {
        jsHeapUsedMb = Math.round((rawBytes / (1024 * 1024)) * 10) / 10;
      }
    }

    const gpuStats = this.callbacks.getGpuMemoryStats?.() ?? { geometries: 0, textures: 0 };

    return {
      phase: this.phase,
      currentChunkId: this.currentChunkId,
      currentChunkNameJa: currentChunkDef.nameJa,
      currentChunkNameEn: currentChunkDef.nameEn,
      currentChunkNameZh: currentChunkDef.nameZh,
      activeChunkCount,
      loadingChunkCount,
      queuedChunkCount,
      unloadedChunkCount,
      failedChunkCount,
      totalChunkCount: WORLD_CHUNK_DEFINITIONS.length,
      priorityLoadProgressPercent: this.computePriorityProgressPercent(),
      estimatedMemoryUsedMb: this.computeEstimatedMemoryUsedMb(),
      memoryBudgetMb: this.budget.memoryBudgetMb,
      jsHeapUsedMb,
      gpuGeometriesCount: gpuStats.geometries,
      gpuTexturesCount: gpuStats.textures,
      totalEvictedCount: this.totalEvictedCount,
      prefetchTargetIds,
      canRetry: failedChunkCount > 0,
      lastErrorMessage: this.lastErrorMessage,
    };
  }
}

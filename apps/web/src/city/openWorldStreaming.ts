import type { GraphicsQuality } from "../types";
import { logger } from "../core/logger";

/**
 * 都市空間のオープンワールド分割セクター（チャンク）ID
 * 渋谷（西 x ≈ -850）〜 青山通り・国道246号（中央 x ≈ -550..-350）〜 東京駅・丸の内・皇居外苑（東 x ≈ 0..+450）を
 * 9つの空間セクターに分割し、優先ロード・進行方向先読み・メモリ解放（Eviction）を行う。
 */
export type WorldChunkId =
  | "shibuya-core"
  | "shibuya-south"
  | "shibuya-north"
  | "aoyama-west"
  | "aoyama-east"
  | "otemachi-west"
  | "marunouchi-core"
  | "kokyo-north"
  | "yurakucho-east";

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
 * 全9チャンクの空間定義カタログ
 * 渋谷（西）〜 国道246号（中央）〜 東京駅・丸の内（東）を隙間なくカバーする。
 */
export const WORLD_CHUNK_DEFINITIONS: readonly WorldChunkDefinition[] = [
  {
    id: "shibuya-core",
    nameJa: "渋谷ストリーム・明治通り中央",
    nameEn: "Shibuya Stream & Meiji-dori Core",
    nameZh: "涩谷Stream・明治通核心区",
    zone: "shibuya",
    centerX: -750,
    centerZ: -15,
    bounds: { minX: -920, maxX: -610, minZ: -115, maxZ: 115 },
    estimatedMemoryMb: 34,
    associatedGlbModelIds: ["shibuya_stream", "street_tree"],
    isPrimaryHub: true,
  },
  {
    id: "shibuya-south",
    nameJa: "渋谷南・並木橋・桜丘ループ",
    nameEn: "Shibuya South, Namikibashi & Sakuragaoka",
    nameZh: "涩谷南・并木桥・樱丘环线",
    zone: "shibuya",
    centerX: -750,
    centerZ: -195,
    bounds: { minX: -920, maxX: -610, minZ: -320, maxZ: -115 },
    estimatedMemoryMb: 18,
    associatedGlbModelIds: ["street_tree"],
    isPrimaryHub: false,
  },
  {
    id: "shibuya-north",
    nameJa: "渋谷北・スクランブルSQ・宮下公園",
    nameEn: "Shibuya North, Scramble Sq & Miyashita",
    nameZh: "涩谷北・Scramble广场・宫下公园",
    zone: "shibuya",
    centerX: -750,
    centerZ: 175,
    bounds: { minX: -920, maxX: -610, minZ: 115, maxZ: 320 },
    estimatedMemoryMb: 22,
    associatedGlbModelIds: ["street_tree"],
    isPrimaryHub: false,
  },
  {
    id: "aoyama-west",
    nameJa: "国道246号・青山通り西（金王坂〜表参道）",
    nameEn: "Route 246 Aoyama-dori West (Konnozaka)",
    nameZh: "国道246号・青山通西（金王坂〜表参道）",
    zone: "corridor",
    centerX: -545,
    centerZ: 95,
    bounds: { minX: -610, maxX: -465, minZ: -260, maxZ: 340 },
    estimatedMemoryMb: 16,
    associatedGlbModelIds: ["street_tree"],
    isPrimaryHub: false,
  },
  {
    id: "aoyama-east",
    nameJa: "国道246号・青山通り東（赤坂・三宅坂接続）",
    nameEn: "Route 246 Aoyama-dori East (Akasaka Approach)",
    nameZh: "国道246号・青山通东（赤坂方向）",
    zone: "corridor",
    centerX: -395,
    centerZ: 95,
    bounds: { minX: -465, maxX: -320, minZ: -260, maxZ: 340 },
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

        // 残りの進行方向プリフェッチ対象チャンクをバックグラウンドキューに積む
        for (const item of scoredChunks) {
          const isAlreadyPriority = this.priorityTargetChunkIds.has(item.id);
          if (isAlreadyPriority) {
            continue;
          }
          const runtime = this.chunks.get(item.id)!;
          const shouldQueueForPrefetch =
            item.scoreInfo.isWithinPrefetchCone && runtime.state === "unloaded";
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

      const isCurrentOrActiveZone =
        chunk.definition.id === this.currentChunkId || score.isWithinActiveRadius;
      const isWithinUnloadBoundary = score.distanceFromVehicleM <= this.budget.unloadRadiusM;
      const shouldBeCandidate =
        chunk.definition.id === this.currentChunkId ||
        ((isCurrentOrActiveZone || score.isWithinPrefetchCone) && isWithinUnloadBoundary);
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

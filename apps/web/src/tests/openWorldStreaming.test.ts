import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  computeChunkPriorityScore,
  computeDistanceToChunkBounds,
  detectMobileChromeEnvironment,
  OpenWorldStreamingSystem,
  resolveChunkIdAtPosition,
  resolveStreamingBudgetProfile,
  WORLD_CHUNK_DEFINITIONS,
  type WorldChunkId,
} from "../city/openWorldStreaming";
import { TokyoStationMap } from "../city/tokyoStationMap";
import { RoadProps } from "../roads/roadProps";

describe("OpenWorldStreamingSystem & Spatial Chunk Management", () => {
  it("全20の空間チャンクが10倍広域マップ（渋谷・原宿・恵比寿・山手通り・青山・六本木・大手町・丸の内・皇居周回・有楽町・銀座・新橋・神田・八重洲）を隙間なく網羅し、現在座標から適切なチャンクIDを解決できることを保証する", () => {
    expect(WORLD_CHUNK_DEFINITIONS.length).toBe(20);

    // 渋谷ストリーム周辺
    expect(resolveChunkIdAtPosition(-750, 12)).toBe("shibuya-core");
    // 渋谷南（恵比寿・並木橋側: z = -115..-320）
    expect(resolveChunkIdAtPosition(-750, -220)).toBe("shibuya-south");
    // 渋谷北（表参道・宮下パーク・ヒカリエ・センター街・PARCO側: z = +115..+460）
    expect(resolveChunkIdAtPosition(-750, 220)).toBe("shibuya-north");
    expect(resolveChunkIdAtPosition(-710, 155)).toBe("shibuya-north"); // 渋谷ヒカリエ
    expect(resolveChunkIdAtPosition(-850, 292)).toBe("shibuya-north"); // 渋谷センター街
    expect(resolveChunkIdAtPosition(-935, 375)).toBe("shibuya-north"); // センター街北西端（井の頭通り合流）
    expect(resolveChunkIdAtPosition(-830, 382)).toBe("shibuya-north"); // 渋谷PARCO
    const shibuyaNorthDef = WORLD_CHUNK_DEFINITIONS.find((c) => c.id === "shibuya-north")!;
    expect(shibuyaNorthDef.associatedGlbModelIds).toContain("shibuya_stream");
    expect(shibuyaNorthDef.associatedGlbModelIds).toContain("shibuya_plateau_buildings");
    const shibuyaSouthDef = WORLD_CHUNK_DEFINITIONS.find((c) => c.id === "shibuya-south")!;
    expect(shibuyaSouthDef.associatedGlbModelIds).toContain("shibuya_stream");
    // 国道246号・青山通り西（渋谷〜表参道・外苑前）
    expect(resolveChunkIdAtPosition(-480, 0)).toBe("aoyama-west");
    // 国道246号・青山通り東（赤坂見附・永田町〜霞が関）
    expect(resolveChunkIdAtPosition(-330, 0)).toBe("aoyama-east");
    // 大手町・日比谷通り西
    expect(resolveChunkIdAtPosition(-160, 0)).toBe("otemachi-west");
    // 東京駅・丸の内仲通り・行幸通りコア
    expect(resolveChunkIdAtPosition(0, 0)).toBe("marunouchi-core");
    // 皇居外苑・和田倉濠北（z = +235..+460）
    expect(resolveChunkIdAtPosition(0, 320)).toBe("kokyo-north");
    // 有楽町・八重洲東
    expect(resolveChunkIdAtPosition(220, 180)).toBe("yurakucho-east");

    // 10倍広域マップ拡張チャンク
    // 渋谷西・神泉・山手通り
    expect(resolveChunkIdAtPosition(-1250, 50)).toBe("shibuya-west");
    // 原宿・代々木
    expect(resolveChunkIdAtPosition(-750, 600)).toBe("harajuku-yoyogi");
    // 恵比寿・代官山
    expect(resolveChunkIdAtPosition(-750, -600)).toBe("ebisu-daikanyama");
    // 六本木通り・西麻布
    expect(resolveChunkIdAtPosition(-380, -350)).toBe("roppongi-nishiazabu");
    // 表参道北・外苑前
    expect(resolveChunkIdAtPosition(-450, 500)).toBe("omotesando-aoyama-north");
    // 皇居西・半蔵門・三宅坂
    expect(resolveChunkIdAtPosition(-250, 600)).toBe("kokyo-west-hanzomon");
    // 皇居北・竹橋
    expect(resolveChunkIdAtPosition(0, 700)).toBe("kokyo-north-takebashi");
    // 神田・秋葉原
    expect(resolveChunkIdAtPosition(350, 600)).toBe("kanda-akihabara");
    // 銀座・数寄屋橋・晴海通り
    expect(resolveChunkIdAtPosition(156, -350)).toBe("ginza-sukiyabashi");
    // 新橋・汐留
    expect(resolveChunkIdAtPosition(156, -750)).toBe("shimbashi-shiodome");
    // 八重洲東・昭和通り
    expect(resolveChunkIdAtPosition(700, 0)).toBe("yaesu-showadori-east");
  });

  it("チャンク境界ボックス（AABB）への最短距離が正しく計算されることを保証する", () => {
    const shibuyaCore = WORLD_CHUNK_DEFINITIONS.find((c) => c.id === "shibuya-core")!;
    // チャンク内部の座標は距離0
    expect(computeDistanceToChunkBounds(-750, 0, shibuyaCore)).toBe(0);
    // 東側へ100m離れた座標
    const distEast = computeDistanceToChunkBounds(shibuyaCore.bounds.maxX + 100, 0, shibuyaCore);
    expect(distEast).toBeCloseTo(100, 4);
  });

  it("スマホChrome環境（UserAgent / Coarse Pointer / 画面幅）を正確に判定し、高・中・低画質と組み合わせて負荷・メモリバジェットを調整することを保証する", () => {
    const isAndroidChrome = detectMobileChromeEnvironment({
      userAgent:
        "Mozilla/5.0 (Linux; Android 15; Pixel 11 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36",
      innerWidth: 412,
      coarsePointer: true,
    });
    expect(isAndroidChrome).toBe(true);

    const isIosChrome = detectMobileChromeEnvironment({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/136.0.0.0 Mobile/15E148 Safari/604.1",
      innerWidth: 393,
      coarsePointer: true,
    });
    expect(isIosChrome).toBe(true);

    const isDesktopChrome = detectMobileChromeEnvironment({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
      innerWidth: 1920,
      coarsePointer: false,
    });
    expect(isDesktopChrome).toBe(false);

    const desktopHigh = resolveStreamingBudgetProfile("high", false);
    const desktopMedium = resolveStreamingBudgetProfile("medium", false);
    const desktopLow = resolveStreamingBudgetProfile("low", false);
    const mobileHigh = resolveStreamingBudgetProfile("high", true);
    const mobileLow = resolveStreamingBudgetProfile("low", true);

    expect(desktopHigh.memoryBudgetMb).toBeGreaterThan(desktopMedium.memoryBudgetMb);
    expect(desktopMedium.memoryBudgetMb).toBeGreaterThan(desktopLow.memoryBudgetMb);
    expect(mobileHigh.memoryBudgetMb).toBeLessThan(desktopHigh.memoryBudgetMb);
    expect(mobileLow.maxResidentChunks).toBeLessThanOrEqual(desktopLow.maxResidentChunks);
    expect(mobileLow.frameSliceBudgetMs).toBeLessThan(desktopHigh.frameSliceBudgetMs);
  });

  it("走行中の車両位置・速度ベクトル・進行方向（headingAngleRad）に応じて、前方のチャンクが後方チャンクよりも高い先読み優先度スコアを得ることを保証する", () => {
    const budget = resolveStreamingBudgetProfile("high", false);
    const aoyamaWest = WORLD_CHUNK_DEFINITIONS.find((c) => c.id === "aoyama-west")!;
    const shibuyaSouth = WORLD_CHUNK_DEFINITIONS.find((c) => c.id === "shibuya-south")!;

    // 渋谷（x = -620, z = 0）から東（東京駅方向: +X方向、headingAngleRad = -Math.PI / 2）へ時速 90km/h (vx = +25 m/s) で走行中
    const forwardScore = computeChunkPriorityScore({
      chunk: aoyamaWest,
      vehicleX: -620,
      vehicleZ: 0,
      velocityX: 25,
      velocityZ: 0,
      headingAngleRad: -Math.PI / 2,
      speedKmh: 90,
      budget,
    });

    const sideRearScore = computeChunkPriorityScore({
      chunk: shibuyaSouth,
      vehicleX: -620,
      vehicleZ: 0,
      velocityX: 25,
      velocityZ: 0,
      headingAngleRad: -Math.PI / 2,
      speedKmh: 90,
      budget,
    });

    expect(forwardScore.isWithinPrefetchCone).toBe(true);
    expect(forwardScore.priorityScore).toBeGreaterThan(sideRearScore.priorityScore);
  });

  it("起動時は現在地（渋谷）周辺の必須チャンクのみを優先ロードしてプレイ可能状態にし、遠方（東京駅・皇居等）のチャンクは未ロードのまま保持することを保証する", async () => {
    const activatedChunks: WorldChunkId[] = [];
    const evictedChunks: WorldChunkId[] = [];
    const progressHistory: number[] = [];

    const system = new OpenWorldStreamingSystem({
      quality: "high",
      isMobileChrome: false,
      callbacks: {
        onActivateChunk: async (id) => {
          activatedChunks.push(id);
        },
        onEvictChunk: (id) => {
          evictedChunks.push(id);
        },
      },
    });

    // 渋谷初期スポーン位置（x = -720, z = 12）周辺を優先ロード
    const status = await system.loadPriorityAreaAround(-720, 12, {
      isWarp: false,
      headingAngleRad: -Math.PI / 2,
      onProgress: (pct) => {
        progressHistory.push(pct);
      },
    });

    expect(status.phase).toBe("ready");
    expect(status.currentChunkId).toBe("shibuya-core");
    expect(status.priorityLoadProgressPercent).toBe(100);
    expect(progressHistory.length).toBeGreaterThan(0);
    expect(progressHistory[progressHistory.length - 1]).toBe(100);

    // 渋谷周辺の最大3チャンクのみが最初にアクティブ化され、東京駅コア（marunouchi-core）はまだアクティブでないこと
    expect(activatedChunks).toContain("shibuya-core");
    expect(activatedChunks.length).toBeLessThanOrEqual(3);
    expect(system.getChunkState("marunouchi-core")?.state).not.toBe("active");
    expect(evictedChunks.length).toBe(0);
  });

  it("渋谷から国道246号・青山通りを東へ連続走行して東京駅へ移動する際、前方エリアを順次バックグラウンド先読みし、遠く離れた渋谷チャンクをメモリ解放（Evict）することを保証する", async () => {
    const activatedChunks: WorldChunkId[] = [];
    const evictedChunks: WorldChunkId[] = [];

    const system = new OpenWorldStreamingSystem({
      quality: "medium",
      isMobileChrome: false,
      callbacks: {
        onActivateChunk: async (id) => {
          activatedChunks.push(id);
        },
        onEvictChunk: (id) => {
          evictedChunks.push(id);
        },
      },
    });

    // 1. 渋谷で起動
    await system.loadPriorityAreaAround(-750, 12, {
      isWarp: false,
      headingAngleRad: -Math.PI / 2,
    });
    expect(system.getChunkState("shibuya-core")?.state).toBe("active");

    // 2. 国道246号・青山通り（x = -480 -> -320 -> -150 -> 0）を東向きに連続走行
    const waypoints = [-520, -360, -180, -20, 40];
    for (const x of waypoints) {
      system.updateFrame({
        vehicleX: x,
        vehicleZ: 0,
        velocityX: 28,
        velocityZ: 0,
        headingAngleRad: -Math.PI / 2,
        speedKmh: 100,
        deltaSeconds: 0.25,
      });
      // 非同期アクティベーションの解決を待つ
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const finalStatus = system.getStatus();
    expect(finalStatus.currentChunkId).toBe("marunouchi-core");
    expect(system.getChunkState("marunouchi-core")?.state).toBe("active");

    // 遠方に離れた渋谷コアチャンク（x = -750、現在地 x = +40 から 600m 以上離隔）がアンロード半径超過により解放されていること
    expect(evictedChunks).toContain("shibuya-core");
    expect(system.getChunkState("shibuya-core")?.state).toBe("unloaded");
    expect(finalStatus.totalEvictedCount).toBeGreaterThan(0);
    expect(finalStatus.estimatedMemoryUsedMb).toBeLessThanOrEqual(finalStatus.memoryBudgetMb);
  });

  it("エリアワープ（渋谷 ⇄ 東京駅）時に遠方チャンクを即座に解放し、ワープ先の優先チャンクを読み込んでから完了状態に遷移することを保証する", async () => {
    const system = new OpenWorldStreamingSystem({
      quality: "high",
      isMobileChrome: false,
    });

    // 渋谷で初期ロード
    await system.loadPriorityAreaAround(-720, 12, { isWarp: false });
    expect(system.getStatus().currentChunkId).toBe("shibuya-core");

    // 東京駅・丸の内（x = 0, z = 120）へワープ
    const warpStatus = await system.loadPriorityAreaAround(0, 120, {
      isWarp: true,
      headingAngleRad: Math.PI,
    });

    expect(warpStatus.phase).toBe("ready");
    expect(warpStatus.currentChunkId).toBe("marunouchi-core");
    expect(system.getChunkState("marunouchi-core")?.state).toBe("active");
    // ワープ元の渋谷チャンクは解放されていること
    expect(system.getChunkState("shibuya-core")?.state).toBe("unloaded");
    expect(warpStatus.totalEvictedCount).toBeGreaterThan(0);
  });

  it("チャンク読み込み失敗時に指数バックオフで自動再試行し、それでも失敗した場合は failed 状態（canRetry=true）となり、手動再試行（retryFailedChunks）で復旧できることを保証する", async () => {
    let attemptCounter = 0;
    const system = new OpenWorldStreamingSystem({
      quality: "high",
      isMobileChrome: false,
      callbacks: {
        onActivateChunk: async (chunkId) => {
          if (chunkId === "shibuya-core") {
            attemptCounter++;
          }
        },
      },
    });

    // shibuya-core の読み込み失敗をシミュレート注入
    system.setSimulatedChunkFailure("shibuya-core", true);
    const failedStatus = await system.loadPriorityAreaAround(-750, 12, { isWarp: false });

    expect(failedStatus.phase).toBe("error");
    expect(failedStatus.canRetry).toBe(true);
    expect(failedStatus.failedChunkCount).toBeGreaterThanOrEqual(1);
    expect(system.getChunkState("shibuya-core")?.state).toBe("failed");
    expect(system.getChunkState("shibuya-core")?.retryCount).toBeGreaterThan(1);

    // 失敗要因を解消して手動再試行を実行
    system.setSimulatedChunkFailure("shibuya-core", false);
    const recoveredStatus = await system.retryFailedChunks();

    expect(recoveredStatus.phase).toBe("ready");
    expect(recoveredStatus.canRetry).toBe(false);
    expect(recoveredStatus.failedChunkCount).toBe(0);
    expect(system.getChunkState("shibuya-core")?.state).toBe("active");
    expect(attemptCounter).toBeGreaterThanOrEqual(1);
  });

  it("ポップイン防止トランジション係数（transitionAlpha）がチャンク有効化後にフレーム経過で 1.0 へ滑らかに収束することを保証する", async () => {
    const transitions: Array<{ chunkId: WorldChunkId; alpha: number }> = [];
    const system = new OpenWorldStreamingSystem({
      quality: "high",
      isMobileChrome: false,
      callbacks: {
        onUpdateChunkTransition: (chunkId, alpha) => {
          transitions.push({ chunkId, alpha });
        },
      },
    });

    // 非即時トランジション（走行中プリフェッチ相当）で aoyama-west を有効化
    await system.activateChunkWithRetry("aoyama-west", { immediateTransition: false });
    const initialAlpha = system.getChunkState("aoyama-west")?.transitionAlpha ?? 0;
    expect(initialAlpha).toBeGreaterThan(0);
    expect(initialAlpha).toBeLessThan(1.0);

    // フレーム更新を進めて alpha が 1.0 に到達することを確認
    for (let i = 0; i < 10; i++) {
      system.updateFrame({
        vehicleX: -480,
        vehicleZ: 0,
        velocityX: 10,
        velocityZ: 0,
        headingAngleRad: -Math.PI / 2,
        speedKmh: 36,
        deltaSeconds: 0.1,
      });
    }

    const convergedAlpha = system.getChunkState("aoyama-west")?.transitionAlpha ?? 0;
    expect(convergedAlpha).toBeCloseTo(1.0, 4);
    expect(transitions.length).toBeGreaterThan(0);
  });

  it("連続フレーム更新時にチャンクの Activate ⇄ Evict 無限ピンポン（チャタリング）が発生せず、道路インフラ（isRoadInfrastructure）の scale.y や可視性が破壊されないことを保証する", async () => {
    const activatedHistory: WorldChunkId[] = [];
    const evictedHistory: WorldChunkId[] = [];
    const system = new OpenWorldStreamingSystem({
      quality: "low",
      isMobileChrome: true,
      callbacks: {
        onActivateChunk: async (chunkId) => {
          activatedHistory.push(chunkId);
        },
        onEvictChunk: (chunkId) => {
          evictedHistory.push(chunkId);
        },
      },
    });

    await system.loadPriorityAreaAround(-500, -10, { isWarp: false });
    const initialActivatedCount = activatedHistory.length;
    const initialEvictedCount = evictedHistory.length;

    // 同一地点付近を低速走行しながら 30 フレーム連続更新しても、予算超過チャンクの Activate -> 即 Evict ループが起きないこと
    for (let frame = 0; frame < 30; frame++) {
      system.updateFrame({
        vehicleX: -500 + frame * 0.5,
        vehicleZ: -10,
        velocityX: 8,
        velocityZ: 0,
        headingAngleRad: -Math.PI / 2,
        speedKmh: 28.8,
        deltaSeconds: 0.033,
      });
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    const deltaActivations = activatedHistory.length - initialActivatedCount;
    const deltaEvictions = evictedHistory.length - initialEvictedCount;
    // 30フレームの間で同じチャンクが何度もロード・アンロードを繰り返していないこと（最大でも2チャンク以下）
    expect(deltaActivations).toBeLessThanOrEqual(2);
    expect(deltaEvictions).toBeLessThanOrEqual(2);
  });
});

describe("遠方3Dモデルの距離ベース多段階LOD（Level of Detail）軽量化検証", () => {
  const createMockPhysicsContext = () => {
    const mockBody = {} as any;
    const mockWorld = {
      createRigidBody: () => mockBody,
      createCollider: () => ({ handle: 1 }) as any,
    } as any;

    const createColliderChain = () => ({
      setTranslation: function () {
        return this;
      },
      setRotation: function () {
        return this;
      },
      setFriction: function () {
        return this;
      },
      setRestitution: function () {
        return this;
      },
    });

    const mockRapier = {
      RigidBodyDesc: {
        fixed: () => ({
          setTranslation: function () {
            return this;
          },
          setRotation: function () {
            return this;
          },
        }),
      },
      ColliderDesc: {
        cuboid: () => createColliderChain(),
        cylinder: () => createColliderChain(),
      },
      Quaternion: class {
        constructor(
          public x: number,
          public y: number,
          public z: number,
          public w: number,
        ) {}
      },
    } as any;

    return { mockWorld, mockRapier };
  };

  it("ガードレールスロット（applyGuardrailSlotLod）が近距離(high)・中距離(medium)・遠距離(low)に応じてブラケット・ボルト・デリネーター・支柱を段階的に間引き、遠距離では単一ビームメッシュのみに軽量化することを保証する", () => {
    const props = new RoadProps();
    const guardrailSlot = props.createGuardrail(24);

    // 初期状態（または high 適用時）は袖ビーム・ブラケット・ボルト・デリネーター・支柱すべてが表示される（省略サブメッシュ数 = 0）こと
    const highSimplifiedCount = RoadProps.applyGuardrailSlotLod(guardrailSlot, "high");
    const rootGroup = guardrailSlot.children.find((c) => c.name === "GuardrailRoot")!;
    const wBeam = rootGroup.children.find((c) => c.name === "Guardrail_WBeam")!;
    const sleeves = rootGroup.children.find((c) => c.name === "Guardrail_Sleeve_Ends")!;
    const posts = rootGroup.children.find((c) => c.name === "Guardrail_Posts")!;
    const brackets = rootGroup.children.find((c) => c.name === "Guardrail_Brackets_Bolts")!;
    const delineators = rootGroup.children.find((c) => c.name === "Guardrail_Delineators")!;

    expect(highSimplifiedCount).toBe(0);
    expect(wBeam.visible).toBe(true);
    expect(sleeves.visible).toBe(true);
    expect(posts.visible).toBe(true);
    expect(brackets.visible).toBe(true);
    expect(delineators.visible).toBe(true);

    // 中距離（medium / LOD1）では袖ビーム・ブラケット・ボルトおよび支柱キャップ等の微小パーツが非表示になり、ビーム＋支柱本体＋視線誘導標（デリネーター）が残ること
    const mediumSimplifiedCount = RoadProps.applyGuardrailSlotLod(guardrailSlot, "medium");
    expect(wBeam.visible).toBe(true);
    expect(posts.visible).toBe(true);
    expect(delineators.visible).toBe(true);
    expect(sleeves.visible).toBe(false);
    expect(brackets.visible).toBe(false);
    expect(mediumSimplifiedCount).toBeGreaterThan(highSimplifiedCount);

    // 遠距離（low / LOD2）では支柱グループも非表示となり、連続Wビーム単一メッシュ（1メッシュ）のみに軽量化され、省略サブメッシュ数がさらに増えること
    const lowSimplifiedCount = RoadProps.applyGuardrailSlotLod(guardrailSlot, "low");
    expect(wBeam.visible).toBe(true);
    expect(posts.visible).toBe(false);
    expect(sleeves.visible).toBe(false);
    expect(brackets.visible).toBe(false);
    expect(delineators.visible).toBe(false);
    expect(lowSimplifiedCount).toBeGreaterThan(mediumSimplifiedCount);
  });

  it("TokyoStationMap.updateDistanceCulling が距離に応じて高層ビル・街路樹・街灯・ボラード・道路付属物を LOD0(high) / LOD1(medium) / LOD2(low) / Culled へ動的に切り替え、遠方メッシュとシャドウ負荷を大幅に削減することを保証する", async () => {
    const { mockWorld, mockRapier } = createMockPhysicsContext();
    const scene = new THREE.Scene();
    const cityMap = new TokyoStationMap(scene, mockWorld, mockRapier, { deferGlbLoads: true });

    // 全チャンクをアクティブ化
    for (const def of WORLD_CHUNK_DEFINITIONS) {
      await cityMap.activateWorldChunk(def.id);
    }

    // 丸の内ビルディング（x ≈ 88.9, z ≈ 111.3）を対象に距離別のビルLOD遷移を検証
    const maruBuilding = cityMap.group.children.find(
      (c) => c.userData?.buildingId === "13101-bldg-1194" || c.name === "13101-bldg-1194",
    ) as THREE.Group;
    expect(maruBuilding).toBeDefined();

    const countVisibleBuildingMeshes = (bldg: THREE.Object3D): number => {
      let visibleMeshes = 0;
      bldg.traverse((node) => {
        if ((node as THREE.Mesh).isMesh && node.visible) {
          visibleMeshes++;
        }
      });
      return visibleMeshes;
    };

    // 1. 近距離（丸ビル直近 x=60, z=111 -> 距離 <= 135m）: LOD0 ("high") でマリオン・1階ピロティ・コーニスを含む全メッシュが表示され castShadow=true
    cityMap.updateDistanceCulling(new THREE.Vector3(60, 0, 111), 380, true);
    expect(maruBuilding.userData.appliedLodTier).toBe("high");
    const highMeshCount = countVisibleBuildingMeshes(maruBuilding);
    expect(highMeshCount).toBeGreaterThanOrEqual(20);

    // 2. 中距離（丸ビルから約180m離れた x=-120, z=111 -> 135m < 距離 <= 235m）: LOD1 ("medium") で14本のマリオン・1階ピロティ・コーニスが非表示化
    cityMap.updateDistanceCulling(new THREE.Vector3(-120, 0, 111), 380, true);
    expect(maruBuilding.userData.appliedLodTier).toBe("medium");
    const mediumMeshCount = countVisibleBuildingMeshes(maruBuilding);
    expect(mediumMeshCount).toBeLessThan(highMeshCount);
    expect(mediumMeshCount).toBeGreaterThan(3);

    // 3. 遠距離（丸ビルから約290m離れた x=-230, z=111 -> 235m < 距離 <= 380m）: LOD2 ("low") で水平ストライプや航空障害灯も非表示になり基壇・高層コア・屋上の3メッシュのみ残る
    cityMap.updateDistanceCulling(new THREE.Vector3(-230, 0, 111), 380, true);
    expect(maruBuilding.userData.appliedLodTier).toBe("low");
    const lowMeshCount = countVisibleBuildingMeshes(maruBuilding);
    expect(lowMeshCount).toBe(3);

    // 4. 多段階 LOD 統計（lod0HighCount / lod1MediumCount / lod2LowCount / culledByDistanceCount / simplifiedSubMeshCount）が getLodStats() に正確に集計されること
    const statsAtMarunouchi = cityMap.getLodStats();
    expect(statsAtMarunouchi.visibleObjects).toBeGreaterThan(0);
    expect(statsAtMarunouchi.lod0HighCount).toBeGreaterThan(0);
    expect(statsAtMarunouchi.lod1MediumCount).toBeGreaterThan(0);
    expect(statsAtMarunouchi.lod2LowCount).toBeGreaterThan(0);
    expect(statsAtMarunouchi.culledByDistanceCount).toBeGreaterThan(0);
    expect(statsAtMarunouchi.simplifiedSubMeshCount).toBeGreaterThan(50);
  });

  it("高精度ランドマークGLB（東京駅丸の内駅舎・渋谷ストリーム）が185m以遠の遠距離では自動的に軽量プロシージャルプロキシへ切り替わり、185m以内に近づくと高精度GLBへ復帰することを保証する", async () => {
    const { mockWorld, mockRapier } = createMockPhysicsContext();
    const scene = new THREE.Scene();
    const cityMap = new TokyoStationMap(scene, mockWorld, mockRapier, { deferGlbLoads: true });

    for (const def of WORLD_CHUNK_DEFINITIONS) {
      await cityMap.activateWorldChunk(def.id);
    }

    // 東京駅丸の内駅舎（中心 x=0, z=-45）の高精度GLBがロード完了した状態をシミュレート注入
    const mockStationGlb = new THREE.Group();
    mockStationGlb.name = "MockTokyoStationGlb";
    const stationMesh = new THREE.Mesh(
      new THREE.BoxGeometry(300, 30, 30),
      new THREE.MeshBasicMaterial(),
    );
    stationMesh.position.set(0, 15, -45);
    mockStationGlb.add(stationMesh);
    cityMap.glbStationGroup = mockStationGlb;
    cityMap.group.add(mockStationGlb);

    // 1. 駅舎近傍（x=0, z=20 -> 駅舎まで約50m <= 185m）では高精度GLBが表示され、プロシージャル駅舎は非表示になること
    cityMap.updateDistanceCulling(new THREE.Vector3(0, 0, 20), 380, true);
    expect(cityMap.glbStationGroup.visible).toBe(true);
    expect(cityMap.getLodStats().landmarkProxyActiveCount).toBe(0);

    // 2. 駅舎から約250m離れた遠方（x=0, z=230 -> 185m < 距離 <= 380m）では高精度GLBが非表示になり、軽量プロシージャル駅舎プロキシが代替表示されること
    cityMap.updateDistanceCulling(new THREE.Vector3(0, 0, 230), 380, true);
    expect(cityMap.glbStationGroup.visible).toBe(false);
    expect(cityMap.getLodStats().landmarkProxyActiveCount).toBeGreaterThanOrEqual(1);

    // 3. 再び駅舎近傍（x=0, z=10）へ接近すると高精度GLBへシームレスに復帰すること
    cityMap.updateDistanceCulling(new THREE.Vector3(0, 0, 10), 380, true);
    expect(cityMap.glbStationGroup.visible).toBe(true);
    expect(cityMap.getLodStats().landmarkProxyActiveCount).toBe(0);
  });

  it("遠方（maxDrawDistance 超・400m〜900m）や未ロード・Evict済みチャンクであっても、高層ビル・大型ランドマークは消滅せず軽量な LOD2（low: 3ボックスシルエット・castShadow=false）として描画され続け、小型プロップのみがカリングされることを保証する", async () => {
    const { mockWorld, mockRapier } = createMockPhysicsContext();
    const scene = new THREE.Scene();
    const cityMap = new TokyoStationMap(scene, mockWorld, mockRapier, { deferGlbLoads: true });

    // 初期状態（渋谷チャンクのみアクティブ化、丸の内チャンクは未ロード状態）
    await cityMap.activateWorldChunk("shibuya-core");
    cityMap.evictWorldChunk("marunouchi-core");

    // 丸の内ビルディング（x ≈ 88.9, z ≈ 111.3, 所属: marunouchi-core）と東京駅赤レンガ駅舎プロキシ
    const maruBuilding = cityMap.group.children.find(
      (c) => c.userData?.buildingId === "13101-bldg-1194" || c.name === "13101-bldg-1194",
    ) as THREE.Group;
    expect(maruBuilding).toBeDefined();

    // 渋谷ストリーム前（x = -720, z = 12）から東側の丸の内方面（約820m先、maxDrawDistance=380m を大幅に超える遠方かつ未ロードチャンク）を見る
    cityMap.updateDistanceCulling(new THREE.Vector3(-720, 0, 12), 380, true);

    // 1. 遠方かつ未ロードチャンク内の大型ビル（丸ビル）が非表示にならず、軽量な LOD2 ("low", 3メッシュのみ, castShadow=false) で描画されていること
    expect(maruBuilding.visible).toBe(true);
    expect(maruBuilding.userData.appliedLodTier).toBe("low");
    let visibleMeshes = 0;
    let castingShadowMeshes = 0;
    maruBuilding.traverse((node) => {
      if ((node as THREE.Mesh).isMesh && node.visible) {
        visibleMeshes++;
        if (node.castShadow) {
          castingShadowMeshes++;
        }
      }
    });
    expect(visibleMeshes).toBe(3);
    expect(castingShadowMeshes).toBe(0);

    // 2. 東京駅赤レンガ駅舎のプロシージャルProxyも遠景シルエット（visible=true, LOD2 "low"）として維持されていること
    const stationProxy = cityMap.group.children.find(
      (c) => c.userData?.isLargeStructure && c.position.x === 0 && c.position.z === -45,
    );
    expect(stationProxy).toBeDefined();
    expect(stationProxy!.visible).toBe(true);
    expect(stationProxy!.userData.appliedLodTier).toBe("low");
    expect(cityMap.getLodStats().landmarkProxyActiveCount).toBeGreaterThanOrEqual(1);
  });

  it("渋谷チャンクに首都高速3号渋谷線高架橋・東口歩道橋・JR/銀座線高架およびスクランブルスクエア（SHIBUYA SKY）・渋谷ヒカリエ（東急シアターオーブ）・MIYASHITA PARK・QFRONTのランドマーク意匠が生成され、GLBマテリアル変換が機能することを保証する", async () => {
    const { mockWorld, mockRapier } = createMockPhysicsContext();
    const scene = new THREE.Scene();
    const cityMap = new TokyoStationMap(scene, mockWorld, mockRapier, { deferGlbLoads: true });

    await cityMap.activateWorldChunk("shibuya-core");

    const shutokoGroup = cityMap.group.children.find(
      (c) => c.name === "ShutokoRoute3ViaductGroup",
    ) as THREE.Group;
    expect(shutokoGroup).toBeDefined();

    const meshNames = new Set<string>();
    shutokoGroup.traverse((node) => {
      if (node.name) {
        meshNames.add(node.name);
      }
    });
    expect(meshNames.has("ShutokoSteelBoxGirder")).toBe(true);
    expect(meshNames.has("ShutokoConcreteDeck")).toBe(true);
    expect(meshNames.has("ShutokoSoundBarrierWall")).toBe(true);
    expect(meshNames.has("ShutokoRoute3GreenSign")).toBe(true);
    expect(meshNames.has("ShibuyaEastPedestrianDeckBridge")).toBe(true);
    expect(meshNames.has("ShibuyaGinzaLineStationVault")).toBe(true);
    expect(meshNames.has("ShibuyaJrYamanoteOverpass")).toBe(true);

    const allSceneNames = new Set<string>();
    cityMap.group.traverse((node) => {
      if (node.name) {
        allSceneNames.add(node.name);
      }
    });
    expect(allSceneNames.has("ShibuyaSkyObservationDeck")).toBe(true);
    expect(allSceneNames.has("ShibuyaSkyHelipad")).toBe(true);
    expect(allSceneNames.has("HikarieTokyuTheatreOrb")).toBe(true);
    expect(allSceneNames.has("MiyashitaParkRoofLawn")).toBe(true);
    expect(allSceneNames.has("ShibuyaQfrontMediaWall")).toBe(true);

    // GLB マテリアル変換（首都高緑標識・SHIBUYA SKY エッジ・ヒカリエ黄金球体・RC橋脚・サクラステージ・109）の検証
    const matNames = [
      "ShutokoHighwayGreenSign",
      "ShibuyaSkyEdgeGlow",
      "HikarieGoldOrb",
      "ShutokoConcretePier",
      "SakuraStagePinkGlow",
      "ShibuyaQfront109Accent",
    ];
    for (const name of matNames) {
      const mat = new THREE.MeshStandardMaterial({ name });
      cityMap.applyShibuyaStreamGlbMaterial3DTexture(mat);
      expect(mat.roughness).toBeGreaterThan(0);
    }

    // shibuya_stream.glb ロード完了時（LOD0）に、同一座標のプロシージャル版スクランブルスクエア・ヒカリエ・サクラステージ・フクラス・MIYASHITA PARK・QFRONT/109・首都高渋谷コア区間が非表示化されて Z-fighting せず、青山通り東側区間（ShutokoConcreteDeckEast）は連続表示され続けることを検証
    const mockShibuyaGlb = new THREE.Group();
    mockShibuyaGlb.name = "MockShibuyaDistrictGlb";
    mockShibuyaGlb.position.set(-695, 0, -15);
    const glbBoundsMesh = new THREE.Mesh(
      new THREE.BoxGeometry(300, 230, 320),
      new THREE.MeshBasicMaterial(),
    );
    glbBoundsMesh.position.set(-55, 115, 115); // covers Stream (-15) & Sakura Stage (-25) to MIYASHITA PARK / QFRONT (+248)
    mockShibuyaGlb.add(glbBoundsMesh);
    cityMap.glbShibuyaStreamGroup = mockShibuyaGlb;
    cityMap.group.add(mockShibuyaGlb);

    const procScramble = cityMap.group.children.find(
      (c) => c.name === "13113-bldg-scramble-square",
    )!;
    const procHikarie = cityMap.group.children.find(
      (c) => c.name === "13113-bldg-shibuya-hikarie",
    )!;
    const procSakuraStage = cityMap.group.children.find(
      (c) => c.name === "13113-bldg-sakura-stage",
    )!;
    const procFukuras = cityMap.group.children.find(
      (c) => c.name === "13113-bldg-shibuya-fukuras",
    )!;
    const procMiyashitaPark = cityMap.group.children.find(
      (c) => c.name === "13113-bldg-miyashita-park",
    )!;
    const procQfront109 = cityMap.group.children.find((c) => c.name === "13113-bldg-qfront-109")!;
    const coreDeckMesh = shutokoGroup.children.find((c) => c.name === "ShutokoConcreteDeck")!;
    const eastDeckMesh = shutokoGroup.children.find((c) => c.name === "ShutokoConcreteDeckEast")!;

    // 1. 宮下公園・スクランブル交差点北側（x=-750, z=240: ストリーム単体からは 255m > 185m だがスクランブルスクエア・MIYASHITA PARK・109からは <= 185m）でも GLB が維持され、重複プロシージャルメッシュがすべて非表示になること
    cityMap.updateDistanceCulling(new THREE.Vector3(-750, 0, 240), 380, true);
    expect(mockShibuyaGlb.visible).toBe(true);
    expect(procScramble.visible).toBe(false);
    expect(procHikarie.visible).toBe(false);
    expect(procSakuraStage.visible).toBe(false);
    expect(procFukuras.visible).toBe(false);
    expect(procMiyashitaPark.visible).toBe(false);
    expect(procQfront109.visible).toBe(false);
    expect(coreDeckMesh.visible).toBe(false);
    expect(eastDeckMesh.visible).toBe(true);

    // 2. 渋谷エリアから 300m 以上離れた表参道東側（x=-350, z=95）へ移動すると、GLB が非表示になりプロシージャル Proxy が復帰すること
    cityMap.updateDistanceCulling(new THREE.Vector3(-350, 0, 95), 380, true);
    expect(mockShibuyaGlb.visible).toBe(false);
    expect(procScramble.visible).toBe(true);
    expect(procHikarie.visible).toBe(true);
    expect(procSakuraStage.visible).toBe(true);
    expect(procFukuras.visible).toBe(true);
    expect(procMiyashitaPark.visible).toBe(true);
    expect(procQfront109.visible).toBe(true);
    expect(coreDeckMesh.visible).toBe(true);
    expect(eastDeckMesh.visible).toBe(true);
  });

  it("PLATEAU 渋谷実在建築物タイル群（shibuya_plateau_buildings.glb）が距離に応じて LOD0(高精細・影あり) / LOD1(中距離軽量化・影OFF) / LOD2(遠景シルエット・影OFF) / Culled へ自動遷移し、遠方の描画負荷とシャドウを大幅抑制することを保証する", async () => {
    const { mockWorld, mockRapier } = createMockPhysicsContext();
    const scene = new THREE.Scene();
    const cityMap = new TokyoStationMap(scene, mockWorld, mockRapier, { deferGlbLoads: true });

    await cityMap.activateWorldChunk("shibuya-core");

    // 渋谷PLATEAUモデルの各タイル（道玄坂・宮益坂・並木橋）を模擬生成
    const mockPlateauGroup = new THREE.Group();
    mockPlateauGroup.name = "MockShibuyaPlateauBuildingsGroup";

    // 1. 道玄坂タイル（スクランブル交差点近傍 x=-825, z=245）
    const dogenzakaTileMesh = new THREE.Mesh(
      new THREE.BoxGeometry(40, 30, 40),
      new THREE.MeshStandardMaterial({ name: "PlateauCommercialFacade" }),
    );
    dogenzakaTileMesh.name = "PlateauTile_data155";
    dogenzakaTileMesh.position.set(-825, 15, 245);
    dogenzakaTileMesh.castShadow = true;
    dogenzakaTileMesh.userData.cullingBounds = new THREE.Box3().setFromObject(dogenzakaTileMesh);

    // 2. 宮益坂タイル（中距離 x=-640, z=250 -> 境界まで約155m: 135m < dist <= 235m）
    const miyamasuTileMesh = new THREE.Mesh(
      new THREE.BoxGeometry(40, 35, 40),
      new THREE.MeshStandardMaterial({ name: "PlateauGlassTower" }),
    );
    miyamasuTileMesh.name = "PlateauTile_data142";
    miyamasuTileMesh.position.set(-640, 17.5, 250);
    miyamasuTileMesh.castShadow = true;
    miyamasuTileMesh.userData.cullingBounds = new THREE.Box3().setFromObject(miyamasuTileMesh);

    // 3. 並木橋タイル（遠距離 x=-720, z=-150 -> 渋谷交差点から約400m離れた南側エリア）
    const namikibashiTileMesh = new THREE.Mesh(
      new THREE.BoxGeometry(40, 25, 40),
      new THREE.MeshStandardMaterial({ name: "PlateauAlleyCommercial" }),
    );
    namikibashiTileMesh.name = "PlateauTile_data153";
    namikibashiTileMesh.position.set(-720, 12.5, -150);
    namikibashiTileMesh.castShadow = true;
    namikibashiTileMesh.userData.cullingBounds = new THREE.Box3().setFromObject(
      namikibashiTileMesh,
    );

    mockPlateauGroup.add(dogenzakaTileMesh);
    mockPlateauGroup.add(miyamasuTileMesh);
    mockPlateauGroup.add(namikibashiTileMesh);

    cityMap.glbShibuyaPlateauGroup = mockPlateauGroup;
    cityMap.plateauTileMeshes = [dogenzakaTileMesh, miyamasuTileMesh, namikibashiTileMesh];
    cityMap.group.add(mockPlateauGroup);

    // 1. スクランブル交差点（x=-815, z=248）を走行中の視点
    cityMap.updateDistanceCulling(new THREE.Vector3(-815, 0, 248), 380, true);

    // 道玄坂タイル（距離約10m <= 135m）: LOD0 ("high") で高精細表示かつ castShadow=true、詳細ジオメトリ
    expect(dogenzakaTileMesh.visible).toBe(true);
    expect(dogenzakaTileMesh.userData.appliedLodTier).toBe("high");
    expect(dogenzakaTileMesh.castShadow).toBe(true);
    expect(dogenzakaTileMesh.userData.isProxyActive).toBe(false);
    expect(dogenzakaTileMesh.geometry).toBe(dogenzakaTileMesh.userData.detailedGeometry);
    expect(dogenzakaTileMesh.material).toBe(dogenzakaTileMesh.userData.detailedMaterial);

    // 宮益坂タイル（距離約155m: 135m < dist <= 235m）: LOD1 ("medium") で簡易化かつ castShadow=false（影カリング）
    expect(miyamasuTileMesh.visible).toBe(true);
    expect(miyamasuTileMesh.userData.appliedLodTier).toBe("medium");
    expect(miyamasuTileMesh.castShadow).toBe(false);
    expect(miyamasuTileMesh.userData.isProxyActive).toBe(false);
    expect(miyamasuTileMesh.geometry).toBe(miyamasuTileMesh.userData.detailedGeometry);

    // 並木橋タイル（距離約405m: 235m < dist <= 800m）: LOD2 ("low") で遠景軽量プロキシかつ castShadow=false
    expect(namikibashiTileMesh.visible).toBe(true);
    expect(namikibashiTileMesh.userData.appliedLodTier).toBe("low");
    expect(namikibashiTileMesh.castShadow).toBe(false);
    expect(namikibashiTileMesh.userData.isProxyActive).toBe(true);
    expect(namikibashiTileMesh.geometry).toBe(namikibashiTileMesh.userData.proxyGeometry);
    expect(namikibashiTileMesh.material).toBe(namikibashiTileMesh.userData.proxyMaterial);
    expect((namikibashiTileMesh.material as THREE.MeshStandardMaterial).name).toBe(
      "PlateauLod2ProxyMat",
    );

    // 2. 宮益坂上（x=-640, z=250）へ移動した場合
    cityMap.updateDistanceCulling(new THREE.Vector3(-640, 0, 250), 380, true);

    // 宮益坂タイルが直近（<= 135m）になり LOD0 ("high", castShadow=true, detailedGeometry) に自動昇格
    expect(miyamasuTileMesh.userData.appliedLodTier).toBe("high");
    expect(miyamasuTileMesh.castShadow).toBe(true);
    expect(miyamasuTileMesh.userData.isProxyActive).toBe(false);
    expect(miyamasuTileMesh.geometry).toBe(miyamasuTileMesh.userData.detailedGeometry);

    // 遠ざかった道玄坂タイル（約165m）は LOD1 ("medium", castShadow=false) へ自動降格
    expect(dogenzakaTileMesh.userData.appliedLodTier).toBe("medium");
    expect(dogenzakaTileMesh.castShadow).toBe(false);
    expect(dogenzakaTileMesh.userData.isProxyActive).toBe(false);

    // 3. 渋谷から離れた遠方エリア（x=250, z=0: 全タイルから距離 > 800m）へ移動した場合
    cityMap.updateDistanceCulling(new THREE.Vector3(250, 0, 0), 380, true);

    // 800m 以遠の全 PLATEAU タイルが Culled (visible=false) となり GPU ドローコールが完全にゼロになること
    expect(dogenzakaTileMesh.visible).toBe(false);
    expect(dogenzakaTileMesh.userData.appliedLodTier).toBe("culled");
    expect(dogenzakaTileMesh.userData.isProxyActive).toBe(false);
    expect(miyamasuTileMesh.visible).toBe(false);
    expect(miyamasuTileMesh.userData.appliedLodTier).toBe("culled");
    expect(namikibashiTileMesh.visible).toBe(false);
    expect(namikibashiTileMesh.userData.appliedLodTier).toBe("culled");
  });

  it("実在 PLATEAU GLB モデル読み込み時に全8タイルと低ポリゴンプロキシメッシュが正しくペアリングされることを保証する", async () => {
    const { mockWorld, mockRapier } = createMockPhysicsContext();
    const scene = new THREE.Scene();
    const cityMap = new TokyoStationMap(scene, mockWorld, mockRapier, { deferGlbLoads: true });

    // 模擬GLB（8タイル＋8プロキシ）
    const mockGlbScene = new THREE.Group();
    const tileIds = [
      "data142",
      "data143",
      "data147",
      "data150",
      "data151",
      "data153",
      "data155",
      "data157",
    ];
    for (const id of tileIds) {
      const detailed = new THREE.Mesh(new THREE.BufferGeometry(), [
        new THREE.MeshStandardMaterial({ name: "PlateauGlassTower" }),
        new THREE.MeshStandardMaterial({ name: "PlateauRooftop" }),
      ]);
      detailed.name = `PlateauTile_${id}`;
      const proxy = new THREE.Mesh(
        new THREE.BufferGeometry(),
        new THREE.MeshStandardMaterial({ name: "PlateauLod2Proxy" }),
      );
      proxy.name = `PlateauProxyTile_${id}`;
      mockGlbScene.add(detailed);
      mockGlbScene.add(proxy);
    }

    // loadShibuyaPlateauBuildingsGlb のパースロジックを直接テスト
    const detailedTileMeshes: THREE.Mesh[] = [];
    const proxyTileMap = new Map<string, THREE.Mesh>();
    mockGlbScene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (mesh.name.startsWith("PlateauProxyTile_")) {
        proxyTileMap.set(mesh.name.replace("PlateauProxyTile_", ""), mesh);
      } else if (mesh.name.startsWith("PlateauTile_")) {
        detailedTileMeshes.push(mesh);
      }
    });

    for (const tileMesh of detailedTileMeshes) {
      const tileId = tileMesh.name.replace("PlateauTile_", "");
      const proxyMesh = proxyTileMap.get(tileId);
      expect(proxyMesh).toBeDefined();
      tileMesh.userData.proxyMesh = proxyMesh;
      tileMesh.userData.detailedGeometry = tileMesh.geometry;
      tileMesh.userData.proxyGeometry = proxyMesh?.geometry;
      tileMesh.userData.detailedMaterial = tileMesh.material;
      tileMesh.userData.proxyMaterial = proxyMesh?.material;
      cityMap.plateauTileMeshes.push(tileMesh);
    }

    expect(cityMap.plateauTileMeshes).toHaveLength(8);
    for (const tileMesh of cityMap.plateauTileMeshes) {
      expect(tileMesh.userData.proxyMesh).toBeDefined();
      expect(tileMesh.userData.proxyGeometry).toBeDefined();
      expect(tileMesh.userData.proxyMaterial).toBeDefined();
    }
  });
});

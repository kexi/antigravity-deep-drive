import * as THREE from "three";

export interface BoostLocationInput {
  pathname?: string | null;
  search?: string | null;
  hash?: string | null;
}

export interface PostProcessCompileTarget {
  name?: string;
  material: THREE.Material;
}

export interface ShaderCompileRenderer {
  compile?: (
    scene: THREE.Object3D,
    camera: THREE.Camera,
    targetScene?: THREE.Scene | null,
  ) => Set<THREE.Material> | void;
  compileAsync?: (
    scene: THREE.Object3D,
    camera: THREE.Camera,
    targetScene?: THREE.Scene | null,
  ) => Promise<THREE.Object3D | void>;
  shadowMap?: {
    enabled?: boolean;
    needsUpdate?: boolean;
  };
}

export interface ShaderPrebuildOptions {
  renderer: ShaderCompileRenderer;
  scene: THREE.Scene;
  cameras: readonly THREE.Camera[];
  postProcessPasses?: readonly PostProcessCompileTarget[];
}

export interface ShaderPrebuildReport {
  compiledScenesCount: number;
  compiledCamerasCount: number;
  compiledObjectsCount: number;
  temporarilyRevealedObjectsCount: number;
  compiledMaterialsCount: number;
  compiledPostProcessCount: number;
  usedAsyncCompile: boolean;
  durationMs: number;
}

interface SavedObjectRenderState {
  object: THREE.Object3D;
  visible: boolean;
  forcedVisible: boolean;
  frustumCulled: boolean;
  forcedFrustumCulled: boolean;
}

/**
 * 真偽値相当のクエリ・ハッシュ値を解析する。
 * - 空文字列（例: `?boost`）や `"1"`, `"true"`, `"on"`, `"yes"`, `"enabled"` は `true`
 * - `"0"`, `"false"`, `"off"`, `"no"`, `"disabled"` は `false`
 * - それ以外は `null`
 */
function parseBooleanFlagValue(rawValue: string | null | undefined): boolean | null {
  const isMissing = rawValue === null || rawValue === undefined;
  if (isMissing) {
    return null;
  }

  const normalized = rawValue.trim().toLowerCase();
  const isEmptyFlag = normalized.length === 0;
  if (isEmptyFlag) {
    return true;
  }

  const isExplicitTrue =
    normalized === "1" ||
    normalized === "true" ||
    normalized === "on" ||
    normalized === "yes" ||
    normalized === "enabled" ||
    normalized === "boost";
  if (isExplicitTrue) {
    return true;
  }

  const isExplicitFalse =
    normalized === "0" ||
    normalized === "false" ||
    normalized === "off" ||
    normalized === "no" ||
    normalized === "disabled";
  if (isExplicitFalse) {
    return false;
  }

  return null;
}

/**
 * URL ハッシュ文字列から `/boost` 指定の真偽値を解析する。
 * - `#boost`, `#/boost`, `#section/boost`, `#boost=1`, `#boost=true`, `#shaderBoost=1` 等は `true`
 * - `#boost=0`, `#boost=false`, `#shaderBoost=0` 等は `false`
 * - boost に関連しないハッシュ（例: `#camera`, `#hud`）や空文字列は `null`
 * - Why not `parseBoostOption` と `buildUrlWithBoostOption` で別々にハッシュを判定しないか:
 *   `#boost=1` で有効化した後に OFF へ切り替えた際、判定ロジックが食い違うと `#boost=1` が URL に残留して
 *   リロード時に再び ON になってしまう不整合を防ぐため。
 */
function parseBoostHashFlag(hash: string | null | undefined): boolean | null {
  const isEmptyHash = typeof hash !== "string" || hash.trim().length === 0;
  if (isEmptyHash) {
    return null;
  }

  const cleanHash = hash.replace(/^#/, "").trim();
  const isEmptyCleanHash = cleanHash.length === 0;
  if (isEmptyCleanHash) {
    return null;
  }

  const lowerHash = cleanHash.toLowerCase();
  const isDirectBoostToken = lowerHash === "boost" || lowerHash === "/boost";
  if (isDirectBoostToken) {
    return true;
  }

  const hasKeyValueFormat = lowerHash.includes("=");
  if (hasKeyValueFormat) {
    const hashParams = new URLSearchParams(cleanHash.replace(/^\/+/, ""));
    const hasBoostKey = hashParams.has("boost") || hashParams.has("shaderBoost");
    if (hasBoostKey) {
      const rawVal = hashParams.has("boost")
        ? hashParams.get("boost")
        : hashParams.get("shaderBoost");
      return parseBooleanFlagValue(rawVal);
    }
  }

  const isHashPathBoost = hasBoostPathSegment(cleanHash);
  if (isHashPathBoost) {
    return true;
  }

  return null;
}

/**
 * URL パスに `/boost` セグメントが含まれているか判定する。
 * - 例: `/boost`, `/boost/`, `/antigravity-deep-drive/boost`, `/antigravity-deep-drive/boost/index.html`
 * - Why not `pathname.includes("boost")` で判定しないか:
 *   `/booster` や `/my-boost-test` のような別語彙のパスに誤マッチするのを防ぎ、
 *   パスセグメント単位（`/` 区切り）で厳密に `boost` を検出するため。
 */
export function hasBoostPathSegment(pathname: string | null | undefined): boolean {
  const isEmptyPath = typeof pathname !== "string" || pathname.trim().length === 0;
  if (isEmptyPath) {
    return false;
  }

  const segments = pathname
    .trim()
    .split("/")
    .map((segment) => segment.trim().toLowerCase())
    .filter((segment) => segment.length > 0 && segment !== "index.html");

  return segments.includes("boost");
}

/**
 * URL または Location 情報から `/boost` シェーダープレビルドオプションが有効かどうかを判定する。
 *
 * 【優先順位】
 * 1. クエリパラメータ `?boost=...` または `?shaderBoost=...`:
 *    明示的な ON/OFF 指定（例: `/boost?boost=0` で一時無効化、または `/?boost=1` で有効化）を最優先。
 * 2. URL ハッシュ `#boost=0` 等の明示的な OFF 指定、または `#boost` / `#/boost` / `#boost=1`
 * 3. URL パスセグメント `/boost`（例: `/boost`, `/antigravity-deep-drive/boost/`）
 */
export function parseBoostOption(
  input?: BoostLocationInput | string | null,
  fallback = false,
): boolean {
  const isMissingInput = input === null || input === undefined;
  if (isMissingInput) {
    const hasWindowLocation = typeof window !== "undefined" && Boolean(window.location);
    if (!hasWindowLocation) {
      return fallback;
    }
    return parseBoostOption(
      {
        pathname: window.location.pathname,
        search: window.location.search,
        hash: window.location.hash,
      },
      fallback,
    );
  }

  const isStringInput = typeof input === "string";
  if (isStringInput) {
    const trimmed = input.trim();
    const isEmptyString = trimmed.length === 0;
    if (isEmptyString) {
      return fallback;
    }

    // 完全な URL または相対 URL/クエリ/ハッシュ文字列を URL パーサーで分解
    try {
      const baseOrigin = "https://deep-drive.local";
      const normalizedTarget =
        trimmed.startsWith("http://") || trimmed.startsWith("https://")
          ? trimmed
          : trimmed.startsWith("?") || trimmed.startsWith("#")
            ? `/${trimmed}`
            : trimmed.startsWith("/")
              ? trimmed
              : `/${trimmed}`;
      const parsedUrl = new URL(normalizedTarget, baseOrigin);
      return parseBoostOption(
        {
          pathname: parsedUrl.pathname,
          search: parsedUrl.search,
          hash: parsedUrl.hash,
        },
        fallback,
      );
    } catch {
      return fallback;
    }
  }

  const pathname = input.pathname ?? "";
  const search = input.search ?? "";
  const hash = input.hash ?? "";

  // 1. クエリパラメータ (?boost / ?boost=1 / ?boost=0 / ?shaderBoost=1)
  const hasSearch = search.trim().length > 0;
  if (hasSearch) {
    const normalizedSearch = search.startsWith("?") ? search : `?${search}`;
    const params = new URLSearchParams(normalizedSearch);
    const hasBoostParam = params.has("boost") || params.has("shaderBoost");
    if (hasBoostParam) {
      const rawParam = params.has("boost") ? params.get("boost") : params.get("shaderBoost");
      const parsedFlag = parseBooleanFlagValue(rawParam);
      const isRecognizedFlag = parsedFlag !== null;
      if (isRecognizedFlag) {
        return parsedFlag;
      }
    }
  }

  // 2. ハッシュによる明示的指定 (#boost, #/boost, #boost=1, #boost=0)
  const parsedHashFlag = parseBoostHashFlag(hash);
  const hasExplicitHashFlag = parsedHashFlag !== null;
  if (hasExplicitHashFlag) {
    return parsedHashFlag;
  }

  // 3. パスセグメント (/boost, /antigravity-deep-drive/boost)
  const isPathBoost = hasBoostPathSegment(pathname);
  if (isPathBoost) {
    return true;
  }

  return fallback;
}

/**
 * 現在の URL に `/boost` オプションを反映した新しい URL パス＋クエリ＋ハッシュ文字列を生成する。
 * - Why not 常に `/boost` パスへの書き換えだけにしないか:
 *   クエリパラメータ等で既に状態を持つ場合やサブパス環境でも、`history.replaceState` でページリロードなしに
 *   URL 状態を整合させるため。既に `/boost` パス上にいるときに OFF にする場合は `/boost` セグメントを除去し、
 *   ルートパス上で ON にする場合は `?boost=1` または `/boost` を維持できるようにする。
 */
export function buildUrlWithBoostOption(locationObj: BoostLocationInput, enabled: boolean): string {
  const rawPathname = locationObj.pathname ?? "/";
  const rawSearch = locationObj.search ?? "";
  const rawHash = locationObj.hash ?? "";

  const params = new URLSearchParams(rawSearch.startsWith("?") ? rawSearch : `?${rawSearch}`);
  params.delete("shaderBoost");

  let nextPathname = rawPathname;
  const pathHasBoost = hasBoostPathSegment(rawPathname);
  const hashBoostFlag = parseBoostHashFlag(rawHash);

  if (enabled) {
    if (pathHasBoost) {
      params.delete("boost");
    } else {
      params.set("boost", "1");
    }
  } else {
    params.delete("boost");
    if (pathHasBoost) {
      const replaced = rawPathname.replace(/\/boost(?=\/|$)/gi, "");
      nextPathname = replaced.length > 0 ? replaced : "/";
    }
  }

  const queryString = params.toString();
  const searchPart = queryString.length > 0 ? `?${queryString}` : "";

  let hashPart = rawHash;
  const shouldClearBoostHash =
    (!enabled && hashBoostFlag !== null) || (enabled && hashBoostFlag === false);
  if (shouldClearBoostHash) {
    hashPart = "";
  }

  return `${nextPathname}${searchPart}${hashPart}`;
}

/**
 * オブジェクトまたはその親チェーンに `userData.permanentlyHiddenByGlb === true` が設定されているか判定する。
 * - Why not GLB で置き換え済みのプロシージャルフォールバックメッシュまで `visible = true` に強制しないか:
 *   GLB ロード完了後は GLB 本体側のメッシュがシーン内に存在してコンパイルされるため、
 *   代替用の非表示プロシージャルメッシュや重複アニメーション部品を無理に可視化する必要がなく、
 *   非同期ロードとの競合リスクも排除できるため。
 */
function isPermanentlyHiddenByGlb(obj: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = obj;
  while (current !== null) {
    const isMarkedHidden = current.userData?.permanentlyHiddenByGlb === true;
    if (isMarkedHidden) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

/**
 * シーン内の全メッシュ・マテリアルおよびポストプロセスパスを一括プレビルド（事前シェーダーコンパイル）する。
 *
 * 【How】
 * 1. シーンツリーを走査し、`permanentlyHiddenByGlb` ではない全描画オブジェクト（`Light` を除く）の
 *    `visible` と `frustumCulled` の元の状態を保存した上で、一時的に `visible = true` かつ `frustumCulled = false` に強制する。
 *    （距離カリングで非表示になっている渋谷/東京駅の建築物や、晴天時に `visible = false` の雨粒・水しぶきメッシュ、
 *     車内ミラー等のカスタムシェーダーも漏れなくコンパイル対象に含めるため）
 * 2. ライト（`THREE.Light`）については PBR シェーダーのプログラムキャッシュキーが「可視ライトの種別・個数」に依存するため、
 *    まず「現在のライト構成（例: 昼間のヘッドライト `SpotLight` OFF）」で全カメラをコンパイルし、
 *    続いて初期非表示のライト（例: 夜間・雨天用の車両 `SpotLight`）が存在する場合はそれらを一時的に ON にした
 *    第2パスもコンパイルすることで、昼夜・天候切替時のシェーダー再コンパイルヒッチを防止する。
 * 3. ポストプロセスパス（`DepthFogPass`, `LensFlarePass`, `MotionBlurPass`）の `ShaderMaterial` も専用ダミーシーン＆
 *    正射影カメラで事前コンパイルする。初回描画前で `null` のテクスチャユニフォームには一時的な 1x1 `DataTexture` を割り当てる。
 * 4. `finally` ブロックで全オブジェクトの `visible` と `frustumCulled` を元の状態へ安全に復元する。
 */
export async function prebuildSceneShaders(
  options: ShaderPrebuildOptions,
): Promise<ShaderPrebuildReport> {
  const startTime = typeof performance !== "undefined" ? performance.now() : Date.now();
  const { renderer, scene, cameras, postProcessPasses = [] } = options;

  const savedStates: SavedObjectRenderState[] = [];
  const hiddenLights: Array<{ light: THREE.Light; originalVisible: boolean }> = [];
  const uniqueMaterials = new Set<THREE.Material>();
  let compiledObjectsCount = 0;
  let temporarilyRevealedObjectsCount = 0;

  scene.traverse((obj) => {
    const isLightObject = Boolean((obj as THREE.Light).isLight);
    if (isLightObject) {
      const light = obj as THREE.Light;
      const isHiddenLight = !light.visible;
      if (isHiddenLight) {
        hiddenLights.push({ light, originalVisible: light.visible });
      }
      return;
    }

    const shouldKeepHidden = isPermanentlyHiddenByGlb(obj);
    if (shouldKeepHidden) {
      return;
    }

    const wasHidden = !obj.visible;
    if (wasHidden) {
      temporarilyRevealedObjectsCount += 1;
    }
    const nextVisible = true;
    const nextFrustumCulled = false;
    savedStates.push({
      object: obj,
      visible: obj.visible,
      forcedVisible: nextVisible,
      frustumCulled: obj.frustumCulled,
      forcedFrustumCulled: nextFrustumCulled,
    });
    obj.visible = nextVisible;
    obj.frustumCulled = nextFrustumCulled;

    const meshLike = obj as THREE.Mesh;
    const hasMaterial = Boolean(meshLike.material);
    if (hasMaterial) {
      compiledObjectsCount += 1;
      const materials = Array.isArray(meshLike.material) ? meshLike.material : [meshLike.material];
      for (const mat of materials) {
        const isValidMaterial = Boolean(mat);
        if (isValidMaterial) {
          mat.needsUpdate = true;
          uniqueMaterials.add(mat);
        }
      }
    }
  });

  let usedAsyncCompile = false;
  let compiledScenesCount = 0;
  let compiledCamerasCount = 0;
  let compiledPostProcessCount = 0;

  const compileSceneWithCamera = async (targetScene: THREE.Object3D, camera: THREE.Camera) => {
    const hasCompileAsync = typeof renderer.compileAsync === "function";
    if (hasCompileAsync) {
      try {
        await renderer.compileAsync!(targetScene, camera);
        usedAsyncCompile = true;
        compiledScenesCount += 1;
        return;
      } catch {
        // KHR_parallel_shader_compile 等で非同期コンパイルが失敗した場合は同期 compile へフォールバックする
      }
    }

    const hasSyncCompile = typeof renderer.compile === "function";
    if (hasSyncCompile) {
      renderer.compile!(targetScene, camera);
      compiledScenesCount += 1;
    }
  };

  try {
    scene.updateMatrixWorld(true);

    const activeCameras =
      cameras.length > 0 ? cameras : [new THREE.PerspectiveCamera(60, 1, 0.1, 1000)];

    // 第1パス: 現在のライト可視状態（例: 昼間のヘッドライト SpotLight OFF）で全カメラをコンパイル
    for (const camera of activeCameras) {
      camera.updateMatrixWorld(true);
      compiledCamerasCount += 1;
      await compileSceneWithCamera(scene, camera);
    }

    // 第2パス: 非表示のライト（例: 夜間・雨天時に点灯する車両ヘッドライト SpotLight）が存在する場合、
    // ライト全点灯バリアントの PBR シェーダーも事前コンパイルして昼夜切替時のヒッチを防ぐ
    const hasHiddenLights = hiddenLights.length > 0;
    if (hasHiddenLights) {
      try {
        for (const item of hiddenLights) {
          item.light.visible = true;
        }
        scene.updateMatrixWorld(true);
        for (const camera of activeCameras) {
          await compileSceneWithCamera(scene, camera);
        }
      } finally {
        for (const item of hiddenLights) {
          item.light.visible = item.originalVisible;
        }
      }
    }

    // ポストプロセス用フルスクリーンシェーダーの事前コンパイル
    const hasPostProcessPasses = postProcessPasses.length > 0;
    if (hasPostProcessPasses) {
      const postScene = new THREE.Scene();
      postScene.frustumCulled = false;
      const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const quadGeometry = new THREE.PlaneGeometry(2, 2);
      const dummyTexture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
      dummyTexture.needsUpdate = true;
      const temporarilyAssignedUniforms: Array<{ uniform: { value: unknown }; original: unknown }> =
        [];

      try {
        for (const pass of postProcessPasses) {
          const isValidPassMaterial = Boolean(pass?.material);
          if (!isValidPassMaterial) {
            continue;
          }
          pass.material.needsUpdate = true;
          uniqueMaterials.add(pass.material);

          const shaderMat = pass.material as THREE.ShaderMaterial;
          const hasUniforms = Boolean(shaderMat.uniforms && typeof shaderMat.uniforms === "object");
          if (hasUniforms) {
            for (const [uName, uniformObj] of Object.entries(shaderMat.uniforms)) {
              const isNullUniform = Boolean(uniformObj && uniformObj.value === null);
              const isLikelyTextureUniform = /^t[A-Z]|texture|map|diffuse|color|depth/i.test(uName);
              if (isNullUniform && isLikelyTextureUniform) {
                temporarilyAssignedUniforms.push({
                  uniform: uniformObj,
                  original: uniformObj.value,
                });
                uniformObj.value = dummyTexture;
              }
            }
          }

          const quadMesh = new THREE.Mesh(quadGeometry, pass.material);
          quadMesh.frustumCulled = false;
          postScene.add(quadMesh);
          compiledPostProcessCount += 1;
        }

        const hasAddedPostMeshes = compiledPostProcessCount > 0;
        if (hasAddedPostMeshes) {
          await compileSceneWithCamera(postScene, postCamera);
        }
      } finally {
        for (const item of temporarilyAssignedUniforms) {
          item.uniform.value = item.original;
        }
        dummyTexture.dispose();
        quadGeometry.dispose();
      }
    }

    const hasShadowMap = Boolean(renderer.shadowMap);
    if (hasShadowMap && renderer.shadowMap!.enabled) {
      renderer.shadowMap!.needsUpdate = true;
    }
  } finally {
    // 元の visible / frustumCulled 状態を復元する。
    // 非同期コンパイル待機中に外部処理（GLB ロードコールバック等）が明示的に値を書き換えた場合は、その変更を尊重する。
    for (const state of savedStates) {
      const isVisibleUnchangedByExternal = state.object.visible === state.forcedVisible;
      if (isVisibleUnchangedByExternal) {
        state.object.visible = state.visible;
      }
      const isCulledUnchangedByExternal = state.object.frustumCulled === state.forcedFrustumCulled;
      if (isCulledUnchangedByExternal) {
        state.object.frustumCulled = state.frustumCulled;
      }
    }
  }

  const endTime = typeof performance !== "undefined" ? performance.now() : Date.now();
  const durationMs = Math.max(0, Number((endTime - startTime).toFixed(2)));

  return {
    compiledScenesCount,
    compiledCamerasCount,
    compiledObjectsCount,
    temporarilyRevealedObjectsCount,
    compiledMaterialsCount: uniqueMaterials.size,
    compiledPostProcessCount,
    usedAsyncCompile,
    durationMs,
  };
}

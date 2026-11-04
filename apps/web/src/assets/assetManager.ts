import * as THREE from "three";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  AssetManifestSchema,
  ModelAssetSchema,
  RoadDefinitionSchema,
  RoadSignPlacementSchema,
  Texture3DAssetSchema,
  WeatherPresetSchema,
  type AssetManifest,
  type ModelAsset,
  type RoadDefinition,
  type RoadSignPlacement,
  type Texture3DAsset,
  type WeatherPreset,
} from "./schema";
import { DEFAULT_ASSETS_YAML } from "./defaultAssetsYaml";
import { Procedural3DTextureGenerator } from "../textures/procedural3DTexture";
import { logger } from "../core/logger";

export type AssetCategory = "models" | "textures3d" | "roads" | "signs" | "weatherPresets";

export interface AssetManifestSummary {
  version: string;
  name: string;
  defaultWeather: string;
  modelsCount: number;
  textures3dCount: number;
  roadsCount: number;
  signsCount: number;
  weatherPresetsCount: number;
  totalAssetsCount: number;
  estimated3DTextureVramBytes: number;
}

export interface AssetValidationResult {
  valid: boolean;
  manifest: AssetManifest | null;
  errors: string[];
}

export type AssetChangeEvent =
  | { type: "manifest.reload"; manifest: AssetManifest }
  | { type: "manifest.reset"; manifest: AssetManifest }
  | { type: "model.update"; id: string; model: ModelAsset }
  | { type: "texture3d.update"; id: string; texture3d: Texture3DAsset }
  | { type: "road.update"; id: string; road: RoadDefinition }
  | { type: "sign.upsert"; id: string; sign: RoadSignPlacement }
  | { type: "sign.remove"; id: string }
  | { type: "weatherPreset.update"; id: string; weatherPreset: WeatherPreset };

export type AssetChangeListener = (event: AssetChangeEvent) => void;

/**
 * YAMLファイルまたは埋め込み定義からアセット設定を読み込み、
 * Zodスキーマで型検証を行った上で管理・提供するマネージャークラス。
 * Webアセット管理システムからのリアルタイム編集・YAML入出力・変更通知にも対応する。
 */
export class AssetManager {
  private manifest: AssetManifest | null = null;
  private texture3dCache = new Map<string, THREE.Data3DTexture>();
  private readonly listeners = new Set<AssetChangeListener>();

  /**
   * アセット変更イベントのリスナーを登録する。解除関数を返す。
   */
  public onChange(listener: AssetChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitChange(event: AssetChangeEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /**
   * YAMLテキストを検証し、エラーがある場合は詳細な診断メッセージを返す（例外を投げない）。
   * How: yaml.parse の構文エラーと AssetManifestSchema.safeParse の Zod Issue を両方収集する。
   */
  public validateYamlString(yamlContent: string): AssetValidationResult {
    const isBlank = !yamlContent || yamlContent.trim().length === 0;
    if (isBlank) {
      return {
        valid: false,
        manifest: null,
        errors: ["YAML content is empty."],
      };
    }

    let rawParsed: unknown;
    try {
      rawParsed = parseYaml(yamlContent);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        valid: false,
        manifest: null,
        errors: [`YAML syntax error: ${msg}`],
      };
    }

    const parsedResult = AssetManifestSchema.safeParse(rawParsed);
    const isParseFailed = !parsedResult.success;
    if (isParseFailed) {
      const errors = parsedResult.error.issues.map((issue) => {
        const pathText = issue.path.length > 0 ? issue.path.join(".") : "(root)";
        return `${pathText}: ${issue.message}`;
      });
      return {
        valid: false,
        manifest: null,
        errors,
      };
    }

    return {
      valid: true,
      manifest: parsedResult.data,
      errors: [],
    };
  }

  /**
   * YAMLテキストを直接パースしてバリデーションし、マニフェストを設定する。
   * How: yaml.parse でJSオブジェクトに変換後、AssetManifestSchema.parse でZod検証を実行する。
   */
  public loadFromYamlString(yamlContent: string): AssetManifest {
    const rawParsed = parseYaml(yamlContent);
    const validatedManifest = AssetManifestSchema.parse(rawParsed);
    this.manifest = validatedManifest;
    this.texture3dCache.clear();
    this.emitChange({ type: "manifest.reload", manifest: validatedManifest });
    return validatedManifest;
  }

  /**
   * デフォルトの埋め込み YAML 定義 (`DEFAULT_ASSETS_YAML`) にリセットする。
   */
  public resetToDefault(): AssetManifest {
    return logger.withTrace("assetManager", "manifest.reset", () => {
      const rawParsed = parseYaml(DEFAULT_ASSETS_YAML);
      const validatedManifest = AssetManifestSchema.parse(rawParsed);
      this.manifest = validatedManifest;
      this.texture3dCache.clear();
      this.emitChange({ type: "manifest.reset", manifest: validatedManifest });
      return validatedManifest;
    });
  }

  /**
   * 現在のアセットマニフェストを整形済み YAML 文字列としてシリアライズする。
   * How: yaml パッケージの stringify を用いて宣言的設定ファイル形式に変換する。
   */
  public toYamlString(): string {
    const manifest = this.getManifest();
    return stringifyYaml(manifest, {
      indent: 2,
      lineWidth: 100,
    });
  }

  /**
   * マニフェスト全体のアセット数および 3D テクスチャ推定 VRAM 使用量（RGBA8 4byte × res³）を集計する。
   */
  public getManifestSummary(): AssetManifestSummary {
    const manifest = this.getManifest();
    const modelsCount = manifest.models.length;
    const textures3dCount = manifest.textures3d.length;
    const roadsCount = manifest.roads.length;
    const signsCount = manifest.signs.length;
    const weatherPresetsCount = manifest.weatherPresets.length;
    const totalAssetsCount =
      modelsCount + textures3dCount + roadsCount + signsCount + weatherPresetsCount;

    const estimated3DTextureVramBytes = manifest.textures3d.reduce((acc, tex) => {
      const voxels = tex.resolution * tex.resolution * tex.resolution;
      return acc + voxels * 4;
    }, 0);

    return {
      version: manifest.version,
      name: manifest.name,
      defaultWeather: manifest.defaultWeather,
      modelsCount,
      textures3dCount,
      roadsCount,
      signsCount,
      weatherPresetsCount,
      totalAssetsCount,
      estimated3DTextureVramBytes,
    };
  }

  /**
   * アセットの相対・絶対パスを Vite のベースパス（GitHub Pagesサブパス等）に合わせて解決する。
   * How: http(s) URL はそのまま返し、先頭のスラッシュを除去して BASE_URL と連結する。
   */
  public resolveAssetUrl(path: string): string {
    const isAbsoluteUrl = path.startsWith("http://") || path.startsWith("https://");
    if (isAbsoluteUrl) {
      return path;
    }

    const baseUrl = (typeof import.meta !== "undefined" && import.meta.env?.BASE_URL) || "/";
    const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    const cleanPath = path.startsWith("/") ? path.slice(1) : path;

    return `${normalizedBase}${cleanPath}`;
  }

  /**
   * 指定URL（例: 'config/assets.yml'）からフェッチしてマニフェストを読み込む。
   * ネットワーク不可環境やテスト環境ではデフォルトYAMLへフォールバックする。
   */
  public async loadFromUrl(url?: string): Promise<AssetManifest> {
    const targetUrl = url ?? this.resolveAssetUrl("config/assets.yml");
    const isBrowserEnv = typeof fetch !== "undefined";
    if (!isBrowserEnv) {
      // Why not: Node.js/Vitest等のテスト環境ではローカルHTTPサーバが無いため、デフォルト定義を即時ロードする
      return this.loadFromYamlString(DEFAULT_ASSETS_YAML);
    }

    try {
      const response = await fetch(targetUrl);
      const isFetchFailed = !response.ok;
      if (isFetchFailed) {
        console.warn(
          `[AssetManager] Failed to fetch ${targetUrl} (${response.status}), falling back to default.`,
        );
        return this.loadFromYamlString(DEFAULT_ASSETS_YAML);
      }
      const yamlText = await response.text();
      return this.loadFromYamlString(yamlText);
    } catch (err) {
      console.warn("[AssetManager] Error fetching YAML asset manifest, using fallback:", err);
      return this.loadFromYamlString(DEFAULT_ASSETS_YAML);
    }
  }

  /**
   * 現在のマニフェストを取得する。未読み込みの場合はデフォルト定義で初期化する。
   */
  public getManifest(): AssetManifest {
    const isManifestLoaded = this.manifest !== null;
    if (isManifestLoaded) {
      return this.manifest!;
    }
    return this.loadFromYamlString(DEFAULT_ASSETS_YAML);
  }

  /**
   * 定義されている全3Dモデル設定の一覧を取得する。
   */
  public getModels(): ModelAsset[] {
    const manifest = this.getManifest();
    return manifest.models;
  }

  /**
   * 指定されたIDのモデル設定を取得する。
   */
  public getModelConfig(id: string): ModelAsset | undefined {
    const manifest = this.getManifest();
    return manifest.models.find((model) => model.id === id);
  }

  /**
   * 指定IDの3Dモデル設定を部分更新し、Zodスキーマで検証して反映する。
   */
  public updateModelConfig(id: string, patch: Partial<Omit<ModelAsset, "id">>): ModelAsset {
    return logger.withTrace(
      "assetManager",
      "model.update",
      () => {
        const manifest = this.getManifest();
        const index = manifest.models.findIndex((m) => m.id === id);
        const isNotFound = index === -1;
        if (isNotFound) {
          throw new Error(`Model asset not found: ${id}`);
        }
        const current = manifest.models[index]!;
        const validated = ModelAssetSchema.parse({
          ...current,
          ...patch,
          id,
        });
        manifest.models[index] = validated;
        this.emitChange({ type: "model.update", id, model: validated });
        return validated;
      },
      { id },
    );
  }

  /**
   * 定義されている全3Dテクスチャ設定の一覧を取得する。
   */
  public getTextures3D(): Texture3DAsset[] {
    const manifest = this.getManifest();
    return manifest.textures3d;
  }

  /**
   * 定義されている全道路の一覧を取得する。
   */
  public getRoads(): RoadDefinition[] {
    const manifest = this.getManifest();
    return manifest.roads;
  }

  /**
   * 指定IDの道路定義を取得する。
   */
  public getRoad(id: string): RoadDefinition | undefined {
    const manifest = this.getManifest();
    return manifest.roads.find((road) => road.id === id);
  }

  /**
   * 指定IDの道路定義を部分更新し、Zodスキーマで検証して反映する。
   */
  public updateRoadConfig(id: string, patch: Partial<Omit<RoadDefinition, "id">>): RoadDefinition {
    return logger.withTrace(
      "assetManager",
      "road.update",
      () => {
        const manifest = this.getManifest();
        const index = manifest.roads.findIndex((r) => r.id === id);
        const isNotFound = index === -1;
        if (isNotFound) {
          throw new Error(`Road definition not found: ${id}`);
        }
        const current = manifest.roads[index]!;
        const validated = RoadDefinitionSchema.parse({
          ...current,
          ...patch,
          markings: patch.markings ? { ...current.markings, ...patch.markings } : current.markings,
          props: patch.props ? { ...current.props, ...patch.props } : current.props,
          id,
        });
        manifest.roads[index] = validated;
        this.emitChange({ type: "road.update", id, road: validated });
        return validated;
      },
      { id },
    );
  }

  /**
   * 定義されている全道路標識の配置一覧を取得する。
   */
  public getSigns(): RoadSignPlacement[] {
    const manifest = this.getManifest();
    return manifest.signs;
  }

  /**
   * 指定IDの道路標識配置を取得する。
   */
  public getSign(id: string): RoadSignPlacement | undefined {
    const manifest = this.getManifest();
    return manifest.signs.find((sign) => sign.id === id);
  }

  /**
   * 道路標識配置を追加または更新する。
   */
  public upsertSign(signInput: RoadSignPlacement): RoadSignPlacement {
    return logger.withTrace(
      "assetManager",
      "sign.upsert",
      () => {
        const manifest = this.getManifest();
        const validated = RoadSignPlacementSchema.parse(signInput);
        const existingIndex = manifest.signs.findIndex((s) => s.id === validated.id);
        const isExisting = existingIndex !== -1;
        if (isExisting) {
          manifest.signs[existingIndex] = validated;
        } else {
          manifest.signs.push(validated);
        }
        this.emitChange({ type: "sign.upsert", id: validated.id, sign: validated });
        return validated;
      },
      { id: signInput.id, type: signInput.type },
    );
  }

  /**
   * 指定IDの道路標識配置をマニフェストから削除する。
   */
  public removeSign(id: string): boolean {
    return logger.withTrace(
      "assetManager",
      "sign.remove",
      () => {
        const manifest = this.getManifest();
        const index = manifest.signs.findIndex((s) => s.id === id);
        const isNotFound = index === -1;
        if (isNotFound) {
          return false;
        }
        manifest.signs.splice(index, 1);
        this.emitChange({ type: "sign.remove", id });
        return true;
      },
      { id },
    );
  }

  /**
   * 定義されている全天候プリセットの一覧を取得する。
   */
  public getWeatherPresets(): WeatherPreset[] {
    const manifest = this.getManifest();
    return manifest.weatherPresets;
  }

  /**
   * 指定IDの天候プリセットを取得する。
   */
  public getWeatherPreset(id: string): WeatherPreset | undefined {
    const manifest = this.getManifest();
    return manifest.weatherPresets.find((preset) => preset.id === id);
  }

  /**
   * 指定IDの天候プリセットを部分更新し、Zodスキーマで検証して反映する。
   */
  public updateWeatherPreset(id: string, patch: Partial<Omit<WeatherPreset, "id">>): WeatherPreset {
    return logger.withTrace(
      "assetManager",
      "weatherPreset.update",
      () => {
        const manifest = this.getManifest();
        const index = manifest.weatherPresets.findIndex((p) => p.id === id);
        const isNotFound = index === -1;
        if (isNotFound) {
          throw new Error(`Weather preset not found: ${id}`);
        }
        const current = manifest.weatherPresets[index]!;
        const validated = WeatherPresetSchema.parse({
          ...current,
          ...patch,
          rain: patch.rain ? { ...current.rain, ...patch.rain } : current.rain,
          lensflare: patch.lensflare
            ? { ...current.lensflare, ...patch.lensflare }
            : current.lensflare,
          id,
        });
        manifest.weatherPresets[index] = validated;
        this.emitChange({ type: "weatherPreset.update", id, weatherPreset: validated });
        return validated;
      },
      { id },
    );
  }

  /**
   * デフォルトの天候プリセットを取得する。
   */
  public getDefaultWeather(): WeatherPreset {
    const manifest = this.getManifest();
    const defaultId = manifest.defaultWeather;
    const foundPreset = manifest.weatherPresets.find((preset) => preset.id === defaultId);
    const hasPreset = foundPreset !== undefined;
    if (hasPreset) {
      return foundPreset;
    }
    // Why not: 万一defaultIdに一致するプリセットが存在しない場合は先頭要素を返す
    return manifest.weatherPresets[0]!;
  }

  /**
   * 指定IDの3Dテクスチャ設定を取得する。
   */
  public getTexture3DConfig(id: string): Texture3DAsset | undefined {
    const manifest = this.getManifest();
    return manifest.textures3d.find((tex) => tex.id === id);
  }

  /**
   * 指定IDの3Dテクスチャ設定を更新し、キャッシュを無効化する。
   */
  public updateTexture3DConfig(
    id: string,
    patch: Partial<Omit<Texture3DAsset, "id">>,
  ): Texture3DAsset {
    return logger.withTrace(
      "assetManager",
      "texture3d.update",
      () => {
        const manifest = this.getManifest();
        const index = manifest.textures3d.findIndex((t) => t.id === id);
        const isNotFound = index === -1;
        if (isNotFound) {
          throw new Error(`3D texture asset not found: ${id}`);
        }
        const current = manifest.textures3d[index]!;
        const validated = Texture3DAssetSchema.parse({
          ...current,
          ...patch,
          id,
        });
        manifest.textures3d[index] = validated;
        this.texture3dCache.delete(id);
        this.emitChange({ type: "texture3d.update", id, texture3d: validated });
        return validated;
      },
      { id },
    );
  }

  /**
   * 指定IDのプロシージャル3Dテクスチャを生成またはキャッシュから取得する。
   */
  public getOrCreate3DTexture(id: string): THREE.Data3DTexture {
    const cached = this.texture3dCache.get(id);
    const isCached = cached !== undefined;
    if (isCached) {
      return cached;
    }

    const config = this.getTexture3DConfig(id);
    const res = config?.resolution ?? 32;
    const texType = config?.type ?? "asphalt_pbr";
    const roughnessScale = config?.roughnessScale ?? 1.0;

    let baseTexture: THREE.Data3DTexture;
    switch (texType) {
      case "asphalt_pbr":
        baseTexture = Procedural3DTextureGenerator.getSharedAsphalt3DTexture(res);
        break;
      case "foliage_bark":
        baseTexture = Procedural3DTextureGenerator.getSharedFoliageBark3DTexture(res);
        break;
      case "architecture_stone":
        baseTexture = Procedural3DTextureGenerator.getSharedArchitecture3DTexture(res);
        break;
      case "volumetric_fog":
        baseTexture = Procedural3DTextureGenerator.getSharedFog3DTexture(res);
        break;
      case "volumetric_cloud":
        baseTexture = Procedural3DTextureGenerator.getSharedCloud3DTexture(res);
        break;
      case "crown_interior":
        baseTexture = Procedural3DTextureGenerator.getSharedCrownInterior3DTexture(res);
        break;
      case "road_marking_prop":
        baseTexture = Procedural3DTextureGenerator.getSharedRoadMarkingProp3DTexture(res);
        break;
      case "vehicle_exterior":
        baseTexture = Procedural3DTextureGenerator.getSharedVehicleExterior3DTexture(res);
        break;
      case "water_caustics":
        baseTexture = Procedural3DTextureGenerator.getSharedWaterCaustics3DTexture(res);
        break;
      default:
        baseTexture = Procedural3DTextureGenerator.getSharedAsphalt3DTexture(res);
        break;
    }

    const srcData = baseTexture.image.data as Uint8Array;
    const dstData = new Uint8Array(srcData.length);
    const isScaledRoughness = Math.abs(roughnessScale - 1.0) > 1e-4;
    if (isScaledRoughness) {
      for (let i = 0; i < srcData.length; i += 4) {
        dstData[i] = srcData[i]!;
        dstData[i + 1] = Math.min(255, Math.max(0, Math.round(srcData[i + 1]! * roughnessScale)));
        dstData[i + 2] = Math.min(255, Math.max(0, Math.round(srcData[i + 2]! * roughnessScale)));
        dstData[i + 3] = srcData[i + 3]!;
      }
    } else {
      dstData.set(srcData);
    }

    const texture = new THREE.Data3DTexture(
      dstData,
      baseTexture.image.width,
      baseTexture.image.height,
      baseTexture.image.depth,
    );
    texture.format = baseTexture.format;
    texture.type = baseTexture.type;
    texture.minFilter = baseTexture.minFilter;
    texture.magFilter = baseTexture.magFilter;
    texture.wrapS = baseTexture.wrapS;
    texture.wrapT = baseTexture.wrapT;
    texture.wrapR = baseTexture.wrapR;
    texture.unpackAlignment = baseTexture.unpackAlignment;
    texture.userData = {
      id,
      type: texType,
      resolution: res,
      roughnessScale,
    };
    texture.needsUpdate = true;

    this.texture3dCache.set(id, texture);
    return texture;
  }
}

/**
 * シングルトンインスタンス
 */
export const assetManager = new AssetManager();

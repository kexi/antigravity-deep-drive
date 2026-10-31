import * as THREE from "three";
import { parse as parseYaml } from "yaml";
import {
  AssetManifestSchema,
  type AssetManifest,
  type ModelAsset,
  type RoadDefinition,
  type RoadSignPlacement,
  type Texture3DAsset,
  type WeatherPreset,
} from "./schema";
import { DEFAULT_ASSETS_YAML } from "./defaultAssetsYaml";
import { Procedural3DTextureGenerator } from "../textures/procedural3DTexture";

/**
 * YAMLファイルまたは埋め込み定義からアセット設定を読み込み、
 * Zodスキーマで型検証を行った上で管理・提供するマネージャークラス。
 */
export class AssetManager {
  private manifest: AssetManifest | null = null;
  private texture3dCache = new Map<string, THREE.Data3DTexture>();

  /**
   * YAMLテキストを直接パースしてバリデーションし、マニフェストを設定する。
   * How: yaml.parse でJSオブジェクトに変換後、AssetManifestSchema.parse でZod検証を実行する。
   */
  public loadFromYamlString(yamlContent: string): AssetManifest {
    const rawParsed = parseYaml(yamlContent);
    const validatedManifest = AssetManifestSchema.parse(rawParsed);
    this.manifest = validatedManifest;
    return validatedManifest;
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
   * 指定されたIDのモデル設定を取得する。
   */
  public getModelConfig(id: string): ModelAsset | undefined {
    const manifest = this.getManifest();
    return manifest.models.find((model) => model.id === id);
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
   * 定義されている全道路標識の配置一覧を取得する。
   */
  public getSigns(): RoadSignPlacement[] {
    const manifest = this.getManifest();
    return manifest.signs;
  }

  /**
   * 指定IDの天候プリセットを取得する。
   */
  public getWeatherPreset(id: string): WeatherPreset | undefined {
    const manifest = this.getManifest();
    return manifest.weatherPresets.find((preset) => preset.id === id);
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
    return manifest.weatherPresets[0];
  }

  /**
   * 指定IDの3Dテクスチャ設定を取得する。
   */
  public getTexture3DConfig(id: string): Texture3DAsset | undefined {
    const manifest = this.getManifest();
    return manifest.textures3d.find((tex) => tex.id === id);
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
    const isAsphalt = config?.type === "asphalt_pbr" || !config;

    let texture: THREE.Data3DTexture;
    if (isAsphalt) {
      texture = Procedural3DTextureGenerator.generateAsphalt3DTexture(res);
    } else {
      texture = Procedural3DTextureGenerator.generateFog3DTexture(res);
    }

    this.texture3dCache.set(id, texture);
    return texture;
  }
}

/**
 * シングルトンインスタンス
 */
export const assetManager = new AssetManager();

import * as THREE from "three";

export type ShibuyaTextureId =
  | "qfront"
  | "shibuya109"
  | "scrambleSquare"
  | "stream"
  | "miyashitaPark"
  | "commercialFacade"
  | "billboards"
  | "shutokoSign"
  | "magnet"
  | "markCity"
  | "toeiBic"
  | "dogenzakaCommercial"
  | "plateauLod2Facade"
  | "plateauLod2Storefront"
  | "plateauLod2Roof";

export interface ShibuyaTextureConfig {
  id: ShibuyaTextureId;
  url: string;
  repeat?: [number, number];
  roughness?: number;
  metalness?: number;
  emissiveIntensityDay?: number;
  emissiveIntensityNight?: number;
}

export const SHIBUYA_TEXTURE_CONFIGS: Record<ShibuyaTextureId, ShibuyaTextureConfig> = {
  qfront: {
    id: "qfront",
    url: "/textures/shibuya/shibuya_qfront.jpg",
    repeat: [1, 1],
    roughness: 0.14,
    metalness: 0.35,
    emissiveIntensityDay: 0.35,
    emissiveIntensityNight: 1.15,
  },
  shibuya109: {
    id: "shibuya109",
    url: "/textures/shibuya/shibuya_109.jpg",
    repeat: [1, 1],
    roughness: 0.22,
    metalness: 0.38,
    emissiveIntensityDay: 0.25,
    emissiveIntensityNight: 1.05,
  },
  scrambleSquare: {
    id: "scrambleSquare",
    url: "/textures/shibuya/shibuya_scramble_square.jpg",
    repeat: [1, 2],
    roughness: 0.12,
    metalness: 0.45,
    emissiveIntensityDay: 0.08,
    emissiveIntensityNight: 0.85,
  },
  stream: {
    id: "stream",
    url: "/textures/shibuya/shibuya_stream.jpg",
    repeat: [1, 2],
    roughness: 0.24,
    metalness: 0.32,
    emissiveIntensityDay: 0.08,
    emissiveIntensityNight: 0.8,
  },
  miyashitaPark: {
    id: "miyashitaPark",
    url: "/textures/shibuya/shibuya_miyashita_park.jpg",
    repeat: [2, 1],
    roughness: 0.32,
    metalness: 0.25,
    emissiveIntensityDay: 0.18,
    emissiveIntensityNight: 0.95,
  },
  commercialFacade: {
    id: "commercialFacade",
    url: "/textures/shibuya/shibuya_commercial_facade.jpg",
    repeat: [1, 1],
    roughness: 0.38,
    metalness: 0.18,
    emissiveIntensityDay: 0.18,
    emissiveIntensityNight: 0.95,
  },
  billboards: {
    id: "billboards",
    url: "/textures/shibuya/shibuya_billboards.jpg",
    repeat: [1, 1],
    roughness: 0.15,
    metalness: 0.22,
    emissiveIntensityDay: 0.4,
    emissiveIntensityNight: 1.15,
  },
  shutokoSign: {
    id: "shutokoSign",
    url: "/textures/shibuya/shibuya_shutoko_sign.jpg",
    repeat: [1, 1],
    roughness: 0.28,
    metalness: 0.12,
    emissiveIntensityDay: 0.06,
    emissiveIntensityNight: 0.85,
  },
  magnet: {
    id: "magnet",
    url: "/textures/shibuya/shibuya_magnet.jpg",
    repeat: [1, 1],
    roughness: 0.15,
    metalness: 0.25,
    emissiveIntensityDay: 0.45,
    emissiveIntensityNight: 1.85,
  },
  markCity: {
    id: "markCity",
    url: "/textures/shibuya/shibuya_mark_city.jpg",
    repeat: [1, 2],
    roughness: 0.32,
    metalness: 0.4,
    emissiveIntensityDay: 0.12,
    emissiveIntensityNight: 1.15,
  },
  toeiBic: {
    id: "toeiBic",
    url: "/textures/shibuya/shibuya_toei_bic.jpg",
    repeat: [1, 1],
    roughness: 0.22,
    metalness: 0.18,
    emissiveIntensityDay: 0.35,
    emissiveIntensityNight: 1.65,
  },
  dogenzakaCommercial: {
    id: "dogenzakaCommercial",
    url: "/textures/shibuya/shibuya_dogenzaka_commercial.jpg",
    repeat: [1, 1],
    roughness: 0.36,
    metalness: 0.18,
    emissiveIntensityDay: 0.28,
    emissiveIntensityNight: 1.55,
  },
  plateauLod2Facade: {
    id: "plateauLod2Facade",
    url: "/textures/shibuya/plateau_lod2_facade.jpg",
    repeat: [1, 1],
    roughness: 0.25,
    metalness: 0.35,
    emissiveIntensityDay: 0.12,
    emissiveIntensityNight: 0.85,
  },
  plateauLod2Storefront: {
    id: "plateauLod2Storefront",
    url: "/textures/shibuya/plateau_lod2_storefront.jpg",
    repeat: [1, 1],
    roughness: 0.32,
    metalness: 0.22,
    emissiveIntensityDay: 0.22,
    emissiveIntensityNight: 1.25,
  },
  plateauLod2Roof: {
    id: "plateauLod2Roof",
    url: "/textures/shibuya/plateau_lod2_roof.jpg",
    repeat: [1, 1],
    roughness: 0.75,
    metalness: 0.12,
    emissiveIntensityDay: 0.02,
    emissiveIntensityNight: 0.15,
  },
};

/**
 * 渋谷実写ストリートビューテクスチャマネージャー
 * Google Maps / ストリートビューに基づく実写景観テクスチャ群の遅延ロード、
 * キャッシュ、sRGBカラースペース補正、および /boost 事前プリビルド連携を統括する。
 */
export class ShibuyaTextureManager {
  private static instance: ShibuyaTextureManager | null = null;
  private textures = new Map<ShibuyaTextureId, THREE.Texture>();
  private loader: THREE.TextureLoader | null = null;

  public static getInstance(): ShibuyaTextureManager {
    if (!this.instance) {
      this.instance = new ShibuyaTextureManager();
    }
    return this.instance;
  }

  /**
   * テクスチャを取得する（キャッシュ済みなら即時返却・Mipmap完全対応）
   */
  public getTexture(id: ShibuyaTextureId): THREE.Texture {
    const cached = this.textures.get(id);
    if (cached) {
      return cached;
    }

    const cfg = SHIBUYA_TEXTURE_CONFIGS[id];
    const isBrowser = typeof window !== "undefined";

    let texture: THREE.Texture;
    if (!isBrowser) {
      // ヘッドレス・単体テスト環境: 1x1 ダミー DataTexture を生成して安定動作を保証
      const dummyData = new Uint8Array([200, 200, 200, 255]);
      texture = new THREE.DataTexture(dummyData, 1, 1, THREE.RGBAFormat);
      texture.generateMipmaps = true;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
    } else {
      if (!this.loader) {
        this.loader = new THREE.TextureLoader();
      }
      texture = this.loader.load(cfg.url);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.generateMipmaps = true;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      if (cfg.repeat) {
        texture.repeat.set(cfg.repeat[0], cfg.repeat[1]);
      }
    }

    texture.name = `ShibuyaTex_${id}`;
    this.textures.set(id, texture);
    return texture;
  }

  /**
   * PLATEAU LOD2 写真ベースの実写ファサードマテリアル（中高層階カーテンウォール・窓サッシ）を生成する
   */
  public createPlateauLod2Material(isNight = false): THREE.MeshStandardMaterial {
    const tex = this.getTexture("plateauLod2Facade");
    const cfg = SHIBUYA_TEXTURE_CONFIGS.plateauLod2Facade;
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: cfg.roughness ?? 0.25,
      metalness: cfg.metalness ?? 0.35,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: tex,
      emissiveIntensity: isNight
        ? (cfg.emissiveIntensityNight ?? 0.85)
        : (cfg.emissiveIntensityDay ?? 0.12),
    });
    mat.name = "PlateauLod2PhotorealisticMat";
    return mat;
  }

  /**
   * PLATEAU LOD2 低層階・路面店舗・街路樹＆地面の映り込み実写マテリアルを生成する
   */
  public createPlateauLod2StorefrontMaterial(isNight = false): THREE.MeshStandardMaterial {
    const tex = this.getTexture("plateauLod2Storefront");
    const cfg = SHIBUYA_TEXTURE_CONFIGS.plateauLod2Storefront;
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: cfg.roughness ?? 0.32,
      metalness: cfg.metalness ?? 0.22,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: tex,
      emissiveIntensity: isNight
        ? (cfg.emissiveIntensityNight ?? 1.25)
        : (cfg.emissiveIntensityDay ?? 0.22),
    });
    mat.name = "PlateauLod2StorefrontMat";
    return mat;
  }

  /**
   * PLATEAU LOD2 屋上・パラペット・エレベーター機械室塔屋マテリアルを生成する
   */
  public createPlateauLod2RoofMaterial(isNight = false): THREE.MeshStandardMaterial {
    const tex = this.getTexture("plateauLod2Roof");
    const cfg = SHIBUYA_TEXTURE_CONFIGS.plateauLod2Roof;
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: cfg.roughness ?? 0.75,
      metalness: cfg.metalness ?? 0.12,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: tex,
      emissiveIntensity: isNight
        ? (cfg.emissiveIntensityNight ?? 0.15)
        : (cfg.emissiveIntensityDay ?? 0.02),
    });
    mat.name = "PlateauLod2RoofMat";
    return mat;
  }

  /**
   * 遠景（LOD2）用の軽量プロキシマテリアルを生成する（単一ドローコール・テクスチャMipmap・低負荷シェーディング）
   */
  public createPlateauLod2ProxyMaterial(isNight = false): THREE.MeshStandardMaterial {
    const tex = this.getTexture("plateauLod2Facade");
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.65,
      metalness: 0.15,
      emissive: new THREE.Color(0xffe8ba),
      emissiveMap: tex,
      emissiveIntensity: isNight ? 0.45 : 0.05,
    });
    mat.name = "PlateauLod2ProxyMat";
    return mat;
  }

  /**
   * 街頭商業ビル・路面店舗用の実写マテリアルを生成する
   */
  public createCommercialStorefrontMaterial(isNight = false): THREE.MeshStandardMaterial {
    const tex = this.getTexture("commercialFacade");
    const cfg = SHIBUYA_TEXTURE_CONFIGS.commercialFacade;
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: cfg.roughness ?? 0.38,
      metalness: cfg.metalness ?? 0.18,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: tex,
      emissiveIntensity: isNight
        ? (cfg.emissiveIntensityNight ?? 0.95)
        : (cfg.emissiveIntensityDay ?? 0.18),
    });
    mat.name = "ShibuyaRoadsideCommercialMat";
    return mat;
  }

  /**
   * スクランブル交差点・屋外大型LEDビジョン用の発光マテリアルを生成する
   */
  public createBillboardMaterial(
    type: "qfront" | "billboards" = "billboards",
    isNight = false,
  ): THREE.MeshStandardMaterial {
    const tex = this.getTexture(type);
    const cfg = SHIBUYA_TEXTURE_CONFIGS[type];
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: cfg.roughness ?? 0.15,
      metalness: cfg.metalness ?? 0.22,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: tex,
      emissiveIntensity: isNight
        ? (cfg.emissiveIntensityNight ?? 1.15)
        : (cfg.emissiveIntensityDay ?? 0.35),
    });
    mat.name = `Shibuya${type === "qfront" ? "Qfront" : "Billboard"}Mat`;
    return mat;
  }

  /**
   * 首都高速3号渋谷線 案内標識用マテリアルを生成する
   */
  public createShutokoHighwaySignMaterial(isNight = false): THREE.MeshStandardMaterial {
    const tex = this.getTexture("shutokoSign");
    const cfg = SHIBUYA_TEXTURE_CONFIGS.shutokoSign;
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: cfg.roughness ?? 0.28,
      metalness: cfg.metalness ?? 0.12,
      emissive: new THREE.Color(0x059669),
      emissiveIntensity: isNight
        ? (cfg.emissiveIntensityNight ?? 0.85)
        : (cfg.emissiveIntensityDay ?? 0.06),
    });
    mat.name = "ShutokoHighwaySignPBRMat";
    return mat;
  }

  /**
   * 全テクスチャの一括プリロード（`/boost` オプション用）
   */
  public async preloadAll(): Promise<void> {
    const isBrowser = typeof window !== "undefined";
    if (!isBrowser) {
      return;
    }
    const promises = (Object.keys(SHIBUYA_TEXTURE_CONFIGS) as ShibuyaTextureId[]).map(
      (id) =>
        new Promise<void>((resolve) => {
          const tex = this.getTexture(id);
          const img = tex.image as HTMLImageElement | undefined;
          if (img && typeof img.complete === "boolean" && img.complete) {
            resolve();
          } else if (img && typeof img.addEventListener === "function") {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          } else {
            resolve();
          }
        }),
    );
    await Promise.all(promises);
  }
}

export const shibuyaTextureManager = ShibuyaTextureManager.getInstance();

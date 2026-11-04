import * as THREE from "three";

/**
 * 3Dプロシージャル・ボリュームテクスチャ生成システム
 * Three.js (WebGL2) の Data3DTexture (GLSL sampler3D) を用いた 3 次元トーラス周期ボクセルテクスチャ群
 *
 * 【3Dテクスチャの利点と設計方針】
 * 1. UV展開歪み・タイリングシームの完全根絶:
 *    2Dテクスチャでは複雑な曲面（樹皮・根張り・多層樹冠・広大な道路網・車両・建築・水面）でUV歪みや継ぎ目が発生するが、
 *    3次元ワールド座標 / ローカル座標 (x, y, z) で直接 sampler3D をサンプリングすることで、
 *    どのような形状のジオメトリに対しても完全シームレスな立体質感を付与できる。
 * 2. 数学的 3D トーラス周期性 (Toroidal 3D Tileability):
 *    Why not: 非周期的な perlin3D(fx * scale) では RepeatWrapping の境界 (0.0 <-> 1.0) で不連続な段差が生じるため、
 *    全オクターブの格子座標を整数周期 P で剰余ラップ (Modulo Period) し、3次元トーラス T^3 上で完全連続にする。
 * 3. 用途別 9 種の 3D ボリュームテクスチャ:
 *    - Asphalt3DTexture (RGBA): 道路・石畳の骨材バンプ(R)、3D Worleyクラック(G)、補修パッチ(B)、水たまり盆地深度(A)
 *    - FoliageBark3DTexture (RGBA): イチョウ樹皮の3D縦溝(R)、葉肉SSS透過厚(G)、根元コケ群落(B)、3D風乱流・色彩変調(A)
 *    - Architecture3DTexture (RGBA): 御影石・赤レンガ結晶粒子(R)、3D石垣・レンガ目地(G)、雨水風化パティナ(B)、微細気孔ラフネス(A)
 *    - Fog3DTexture (Red): 雨煙・大気ボリュメトリックフォグ用の 3D Perlin-Worley 密度場
 *    - Cloud3DTexture (RGBA): SIGGRAPH Nubis 方式の 3D Perlin-Worley 積雲密度場
 *    - CrownInterior3DTexture (RGBA): トヨタ クラウン内装の3D異方性杢目ウッドグレイン(R)、3D Worley本革シボ(G)、3Dパンチングレザー＆ステッチ粒子(B)、3Dサテンヘアライン＆クリアコート変調(A)
 *    - RoadMarkingProp3DTexture (RGBA): 路面標示ガラスビーズ再帰反射(R)、ペイント摩耗・点字ブロック粒子(G)、ガードレール亜鉛めっき・アルミヘアライン(B)、鋳鉄マンホール・縁石コンクリート風化(A)
 *    - VehicleExterior3DTexture (RGBA): 外装メタリックマイカ塗装フレーク(R)、クリアコートオレンジピール(G)、タイヤトレッド＆サイドウォール加硫ゴム粒子(B)、アルミホイール切削＆ブレーキローター摺動痕(A)
 *    - WaterCaustics3DTexture (RGBA): 3D水中コースティクス網目(R)、3Dマイクロ毛細管波紋(G)、皇居お堀水中浮遊粒子・プランクトン散乱(B)、水際マイクロフォーム気泡(A)
 */
export class Procedural3DTextureGenerator {
  private static sharedAsphalt3D: THREE.Data3DTexture | null = null;
  private static sharedFoliageBark3D: THREE.Data3DTexture | null = null;
  private static sharedArchitecture3D: THREE.Data3DTexture | null = null;
  private static sharedFog3D: THREE.Data3DTexture | null = null;
  private static sharedCloud3D: THREE.Data3DTexture | null = null;
  private static sharedCrownInterior3D: THREE.Data3DTexture | null = null;
  private static sharedRoadMarkingProp3D: THREE.Data3DTexture | null = null;
  private static sharedVehicleExterior3D: THREE.Data3DTexture | null = null;
  private static sharedWaterCaustics3D: THREE.Data3DTexture | null = null;

  /**
   * 共有アスファルト・石畳用 3D ボリュームテクスチャを取得する（シングルトンキャッシュ）
   */
  public static getSharedAsphalt3DTexture(size = 64): THREE.Data3DTexture {
    const hasCached = this.sharedAsphalt3D !== null && this.sharedAsphalt3D.image.width === size;
    if (hasCached) {
      return this.sharedAsphalt3D!;
    }
    this.sharedAsphalt3D = this.generateAsphalt3DTexture(size);
    return this.sharedAsphalt3D;
  }

  /**
   * 共有イチョウ葉っぱ・樹皮・コケ用 3D ボリュームテクスチャを取得する（シングルトンキャッシュ）
   */
  public static getSharedFoliageBark3DTexture(size = 32): THREE.Data3DTexture {
    const hasCached =
      this.sharedFoliageBark3D !== null && this.sharedFoliageBark3D.image.width === size;
    if (hasCached) {
      return this.sharedFoliageBark3D!;
    }
    this.sharedFoliageBark3D = this.generateFoliageBark3DTexture(size);
    return this.sharedFoliageBark3D;
  }

  /**
   * 共有建築石材（赤レンガ・白御影石・皇居石垣）用 3D ボリュームテクスチャを取得する（シングルトンキャッシュ）
   */
  public static getSharedArchitecture3DTexture(size = 32): THREE.Data3DTexture {
    const hasCached =
      this.sharedArchitecture3D !== null && this.sharedArchitecture3D.image.width === size;
    if (hasCached) {
      return this.sharedArchitecture3D!;
    }
    this.sharedArchitecture3D = this.generateArchitecture3DTexture(size);
    return this.sharedArchitecture3D;
  }

  /**
   * 共有雨煙・大気フォグ用 3D ボリュームテクスチャを取得する（シングルトンキャッシュ）
   */
  public static getSharedFog3DTexture(size = 32): THREE.Data3DTexture {
    const hasCached = this.sharedFog3D !== null && this.sharedFog3D.image.width === size;
    if (hasCached) {
      return this.sharedFog3D!;
    }
    this.sharedFog3D = this.generateFog3DTexture(size);
    return this.sharedFog3D;
  }

  /**
   * 共有ボリュメトリック雲シェーダー用 3D Perlin-Worley ボリュームテクスチャを取得する（シングルトンキャッシュ）
   */
  public static getSharedCloud3DTexture(size = 32): THREE.Data3DTexture {
    const hasCached = this.sharedCloud3D !== null && this.sharedCloud3D.image.width === size;
    if (hasCached) {
      return this.sharedCloud3D!;
    }
    this.sharedCloud3D = this.generateCloud3DTexture(size);
    return this.sharedCloud3D;
  }

  /**
   * 共有トヨタ クラウン（AZSH32）車内内装用 3D ボリュームテクスチャを取得する（シングルトンキャッシュ）
   */
  public static getSharedCrownInterior3DTexture(size = 32): THREE.Data3DTexture {
    const hasCached =
      this.sharedCrownInterior3D !== null && this.sharedCrownInterior3D.image.width === size;
    if (hasCached) {
      return this.sharedCrownInterior3D!;
    }
    this.sharedCrownInterior3D = this.generateCrownInterior3DTexture(size);
    return this.sharedCrownInterior3D;
  }

  /**
   * 共有道路標示・ストリートファニチャー・標識・縁石用 3D ボリュームテクスチャを取得する（シングルトンキャッシュ）
   */
  public static getSharedRoadMarkingProp3DTexture(size = 32): THREE.Data3DTexture {
    const hasCached =
      this.sharedRoadMarkingProp3D !== null && this.sharedRoadMarkingProp3D.image.width === size;
    if (hasCached) {
      return this.sharedRoadMarkingProp3D!;
    }
    this.sharedRoadMarkingProp3D = this.generateRoadMarkingProp3DTexture(size);
    return this.sharedRoadMarkingProp3D;
  }

  /**
   * 共有車両エクステリア（メタリックマイカ塗装・タイヤ加硫ゴム・ホイール切削・ブレーキローター）用 3D ボリュームテクスチャを取得する（シングルトンキャッシュ）
   */
  public static getSharedVehicleExterior3DTexture(size = 32): THREE.Data3DTexture {
    const hasCached =
      this.sharedVehicleExterior3D !== null && this.sharedVehicleExterior3D.image.width === size;
    if (hasCached) {
      return this.sharedVehicleExterior3D!;
    }
    this.sharedVehicleExterior3D = this.generateVehicleExterior3DTexture(size);
    return this.sharedVehicleExterior3D;
  }

  /**
   * 共有水面・水中コースティクス・マイクロ波紋用 3D ボリュームテクスチャを取得する（シングルトンキャッシュ）
   */
  public static getSharedWaterCaustics3DTexture(size = 32): THREE.Data3DTexture {
    const hasCached =
      this.sharedWaterCaustics3D !== null && this.sharedWaterCaustics3D.image.width === size;
    if (hasCached) {
      return this.sharedWaterCaustics3D!;
    }
    this.sharedWaterCaustics3D = this.generateWaterCaustics3DTexture(size);
    return this.sharedWaterCaustics3D;
  }

  /**
   * 1. 日本の密粒度アスファルト路面（JIS A 5308 / 13mm 砕石骨材）・石畳広場用 3D ボリュームテクスチャ
   * 4チャンネル構成 (RGBAFormat):
   * - R: 周期的 3D Worley 砕石骨材セル (F1) + 高周波 3D Perlin マイクログリット（安山岩・硬質砂岩・白珪石チップの立体凸凹）
   * - G: 周期的 3D Worley F2-F1 骨材間タール空隙・ポーラス微細孔 ＋ 経年ヘアクラック網
   * - B: 周期的 3D 異方性ローラー転圧タールバインダー濃淡・舗装打設ムラ・補修パッチ境界
   * - A: 周期的 3D マルチスケール水たまり盆地・わだち保水深度
   */
  public static generateAsphalt3DTexture(size = 64): THREE.Data3DTexture {
    const totalVoxels = size * size * size;
    const data = new Uint8Array(totalVoxels * 4);
    const perm = this.createPermutationTable(1337);

    let ptr = 0;
    const invSize = 1.0 / size;

    for (let z = 0; z < size; z++) {
      const fz = z * invSize;
      for (let y = 0; y < size; y++) {
        const fy = y * invSize;
        for (let x = 0; x < size; x++) {
          const fx = x * invSize;

          // 1. R & G: 周期16の 3D Worley 砕石骨材セル（F1 と F2-F1 空隙を1パス計算）
          const [coarseF1, aggregateVoid] = this.worleyCellF1AndVoidPeriodic(fx, fy, fz, 16);
          const stoneCrown = Math.pow(Math.max(1.0 - coarseF1 * 1.12, 0.0), 0.78);
          const microGrit = this.perlin3DPeriodic(fx * 32, fy * 32, fz * 32, 32, perm) * 0.5 + 0.5;
          const rAggregate = Math.min(Math.max(stoneCrown * 0.66 + microGrit * 0.34, 0.0), 1.0);

          // 2. G: 骨材間タール空隙 + 周期4の経年ヘアクラック
          const hairCrack = this.worleyCrack3DPeriodic(fx + 0.23, fy + 0.41, fz + 0.67, 4);
          const gVoidCrack = Math.min(Math.max(aggregateVoid * 0.52 + hairCrack * 0.78, 0.0), 1.0);

          // 3. B: ローラー転圧方向（Z軸）の異方性バインダー濃淡 + 補修パッチ
          const rollerStreak =
            this.fbm3DAnisotropicPeriodic(fx, fy, fz, 8, 4, 2, perm, 2) * 0.5 + 0.5;
          const patchTone = this.patchwork3DPeriodic(fx, fy, fz, 2, perm);
          const bBinder = Math.min(Math.max(rollerStreak * 0.48 + patchTone * 0.52, 0.0), 1.0);

          // 4. A: マルチスケール水たまり盆地深度
          const puddleMacro = this.fbm3DPeriodic(fx, fy, fz, 2, perm, 3) * 0.5 + 0.5;
          const puddleMeso =
            this.fbm3DPeriodic(fx + 0.37, fy + 0.19, fz + 0.83, 6, perm, 2) * 0.5 + 0.5;
          const aPuddle = Math.min(Math.max(puddleMacro * 0.74 + puddleMeso * 0.26, 0.0), 1.0);

          data[ptr] = this.toByte(rAggregate);
          data[ptr + 1] = this.toByte(gVoidCrack);
          data[ptr + 2] = this.toByte(bBinder);
          data[ptr + 3] = this.toByte(aPuddle);
          ptr += 4;
        }
      }
    }

    return this.createRgbaData3DTexture(data, size);
  }

  /**
   * 2. イチョウ街路樹（葉っぱ・樹皮・根元コケ）用 3D 有機ボリュームテクスチャ
   * 4チャンネル構成 (RGBAFormat):
   * - R: 3D 異方性ドメインワーピング樹皮縦溝（Y軸方向に伸びる深い木肌溝と繊維バンプ）
   * - G: 3D セルラー葉肉密度・SSS透過厚（逆光サブサーフェス・スキャタリングの立体透過ムラ）
   * - B: 3D 有機コケ・地衣類コロニー分布（根張りや樹皮の窪みに定着するコケ群落マスク）
   * - A: 3D 風乱流・黄金色変調フィールド（樹冠内の空間位置に応じた黄葉〜琥珀グラデーションと風揺れ位相）
   */
  public static generateFoliageBark3DTexture(size = 32): THREE.Data3DTexture {
    const totalVoxels = size * size * size;
    const data = new Uint8Array(totalVoxels * 4);
    const perm = this.createPermutationTable(4209);

    let ptr = 0;
    const invSize = 1.0 / size;

    for (let z = 0; z < size; z++) {
      const fz = z * invSize;
      for (let y = 0; y < size; y++) {
        const fy = y * invSize;
        for (let x = 0; x < size; x++) {
          const fx = x * invSize;

          // 1. Rチャンネル: 3D ドメインワーピング異方性樹皮縦溝 (X/Zは高周波、Yは縦筋状に低周波)
          const warpX = this.perlin3DPeriodic(fx * 4.0, fy * 2.0, fz * 4.0, 4, perm) * 0.18;
          const warpZ =
            this.perlin3DPeriodic((fx + 0.37) * 4.0, fy * 2.0, (fz + 0.61) * 4.0, 4, perm) * 0.18;
          const barkRidge = this.fbm3DAnisotropicPeriodic(
            fx + warpX,
            fy,
            fz + warpZ,
            8,
            2,
            8,
            perm,
            3,
          );
          const barkCrevice = Math.pow(Math.min(Math.max(barkRidge * 0.5 + 0.5, 0.0), 1.0), 1.35);
          const rVal = this.toByte(barkCrevice);

          // 2. Gチャンネル: 3D セルラー葉肉密度 & 葉クラスタ透過厚 (Worley F1 + 微細FBM)
          const cellF1 = this.worleyCellF1Periodic(fx, fy, fz, 6);
          const mesophyllFbm = this.fbm3DPeriodic(fx, fy, fz, 8, perm, 2) * 0.5 + 0.5;
          const leafThickness = (1.0 - cellF1 * 0.65) * 0.65 + mesophyllFbm * 0.35;
          const gVal = this.toByte(leafThickness);

          // 3. Bチャンネル: 3D コケ・地衣類コロニー分布 (有機的な斑状クラスタ)
          const mossBase = this.fbm3DPeriodic(fx + 0.2, fy + 0.5, fz + 0.8, 5, perm, 3) * 0.5 + 0.5;
          const mossPores = 1.0 - this.worleyCellF1Periodic(fx + 0.1, fy + 0.3, fz + 0.7, 8);
          const mossColony = Math.min(Math.max(mossBase * 0.7 + mossPores * 0.3, 0.0), 1.0);
          const bVal = this.toByte(mossColony);

          // 4. Aチャンネル: 3D 風乱流・樹冠カラー変調ポテンシャル
          const gustPotential =
            this.fbm3DPeriodic(fx + 0.45, fy + 0.15, fz + 0.25, 3, perm, 3) * 0.5 + 0.5;
          const aVal = this.toByte(gustPotential);

          data[ptr] = rVal;
          data[ptr + 1] = gVal;
          data[ptr + 2] = bVal;
          data[ptr + 3] = aVal;
          ptr += 4;
        }
      }
    }

    return this.createRgbaData3DTexture(data, size);
  }

  /**
   * 3. 建築石材（東京駅赤レンガ・丸の内白御影石・皇居お堀石垣）用 3D ボリュームテクスチャ
   * 4チャンネル構成 (RGBAFormat):
   * - R: 3D 鉱物結晶グレイン（白御影石の石英・長石・黒雲母斑晶スペックル & 赤レンガの焼成粘土粒子）
   * - G: 3D 石垣・レンガ目地エッジ（Worley 3D 切込接ぎブロック境界 & 目地溝）
   * - B: 3D 経年風化・雨水垂れ筋・パティナ（縦方向の雨だれ・白華・緑青ムラ）
   * - A: 3D 微細気孔ラフネス（石材・レンガ表面のミクロな凹凸ラフネス変調）
   */
  public static generateArchitecture3DTexture(size = 32): THREE.Data3DTexture {
    const totalVoxels = size * size * size;
    const data = new Uint8Array(totalVoxels * 4);
    const perm = this.createPermutationTable(8821);

    let ptr = 0;
    const invSize = 1.0 / size;

    for (let z = 0; z < size; z++) {
      const fz = z * invSize;
      for (let y = 0; y < size; y++) {
        const fy = y * invSize;
        for (let x = 0; x < size; x++) {
          const fx = x * invSize;

          // 1. Rチャンネル: 3D 鉱物結晶グレイン（高周波スペックル + 中周波粘土ムラ）
          const crystalFine = this.fbm3DPeriodic(fx, fy, fz, 12, perm, 3) * 0.5 + 0.5;
          const biotiteSpeck = 1.0 - this.worleyCellF1Periodic(fx, fy, fz, 10);
          const mineralGrain = crystalFine * 0.65 + biotiteSpeck * 0.35;
          const rVal = this.toByte(mineralGrain);

          // 2. Gチャンネル: 3D 切込接ぎ石垣・目地エッジ (Worley F2-F1 ブロック境界)
          const stoneJoint = this.worleyCrack3DPeriodic(fx, fy, fz, 5);
          const gVal = this.toByte(stoneJoint);

          // 3. Bチャンネル: 3D 雨水風化・パティナ（Y軸方向に伸びる異方性風化ストリーク）
          const weathering =
            this.fbm3DAnisotropicPeriodic(fx + 0.3, fy, fz + 0.6, 6, 2, 6, perm, 3) * 0.5 + 0.5;
          const bVal = this.toByte(weathering);

          // 4. Aチャンネル: 3D 微細気孔ラフネス
          const microPore =
            this.fbm3DPeriodic(fx + 0.5, fy + 0.2, fz + 0.9, 10, perm, 2) * 0.5 + 0.5;
          const aVal = this.toByte(microPore);

          data[ptr] = rVal;
          data[ptr + 1] = gVal;
          data[ptr + 2] = bVal;
          data[ptr + 3] = aVal;
          ptr += 4;
        }
      }
    }

    return this.createRgbaData3DTexture(data, size);
  }

  /**
   * 4. 雨煙・大気フォグ用 3D ボリュームノイズテクスチャ (RedFormat)
   * 周期的 3D Perlin-Worley ハイブリッドノイズによる水蒸気・霧の 3 次元濃淡分布
   */
  public static generateFog3DTexture(size = 32): THREE.Data3DTexture {
    const totalVoxels = size * size * size;
    const data = new Uint8Array(totalVoxels);
    const perm = this.createPermutationTable(2026);

    let ptr = 0;
    const invSize = 1.0 / size;

    for (let z = 0; z < size; z++) {
      const fz = z * invSize;
      for (let y = 0; y < size; y++) {
        const fy = y * invSize;
        for (let x = 0; x < size; x++) {
          const fx = x * invSize;
          const fbmDensity = this.fbm3DPeriodic(fx, fy, fz, 4, perm, 4) * 0.5 + 0.5;
          const billowWorley = 1.0 - this.worleyCellF1Periodic(fx, fy, fz, 4) * 0.65;
          const combinedMist = fbmDensity * 0.72 + billowWorley * 0.28;
          data[ptr++] = this.toByte(combinedMist);
        }
      }
    }

    const texture = new THREE.Data3DTexture(data, size, size, size);
    texture.format = THREE.RedFormat;
    texture.type = THREE.UnsignedByteType;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.wrapR = THREE.RepeatWrapping;
    texture.needsUpdate = true;

    return texture;
  }

  /**
   * 5. SIGGRAPH Nubis / Horizon Zero Dawn 方式の 3D ボリュメトリック雲テクスチャ (RGBAFormat)
   * - R: Perlin-Worley 基本積雲シェイプ密度
   * - G: 低周波 Worley F1 反転（カリフラワー状の塊隆起）
   * - B: 中周波 Worley F1 反転（雲縁のモクモクしたディテール）
   * - A: 高周波 Perlin-Worley 乱流浸食ノイズ（雲の輪郭を削る微細ウィスプ）
   */
  public static generateCloud3DTexture(size = 32): THREE.Data3DTexture {
    const totalVoxels = size * size * size;
    const data = new Uint8Array(totalVoxels * 4);
    const perm = this.createPermutationTable(7741);

    let ptr = 0;
    const invSize = 1.0 / size;

    for (let z = 0; z < size; z++) {
      const fz = z * invSize;
      for (let y = 0; y < size; y++) {
        const fy = y * invSize;
        for (let x = 0; x < size; x++) {
          const fx = x * invSize;

          const basePerlin = this.fbm3DPeriodic(fx, fy, fz, 4, perm, 4) * 0.5 + 0.5;
          const worleyLow = 1.0 - this.worleyCellF1Periodic(fx, fy, fz, 4);
          const worleyMid = 1.0 - this.worleyCellF1Periodic(fx + 0.17, fy + 0.31, fz + 0.53, 8);
          const worleyHigh = 1.0 - this.worleyCellF1Periodic(fx + 0.43, fy + 0.67, fz + 0.19, 12);

          const worleyFbm = worleyLow * 0.625 + worleyMid * 0.25 + worleyHigh * 0.125;
          const perlinWorley = Math.min(Math.max(basePerlin * 0.58 + worleyFbm * 0.42, 0.0), 1.0);

          data[ptr] = this.toByte(perlinWorley);
          data[ptr + 1] = this.toByte(worleyLow);
          data[ptr + 2] = this.toByte(worleyMid);
          data[ptr + 3] = this.toByte(worleyHigh * 0.7 + basePerlin * 0.3);
          ptr += 4;
        }
      }
    }

    return this.createRgbaData3DTexture(data, size);
  }

  /**
   * 6. トヨタ クラウン（AZSH32）ラグジュアリー車内内装用 3D ボリュームテクスチャ (RGBAFormat)
   * - R: 3D 異方性オープンポア杢目ウッドグレイン（ウッディブラウンパネル用：カテドラル年輪＋深彫り導管ピット＋リボン杢）
   * - G: 3D Worley ペブル本革シボ（セミアニリンナッパレザー・ダッシュボードソフトパッド用：立体セルドーム＋深いシボ溝）
   * - B: 3D パンチングレザー＆ダイヤモンドキルティング織り目（シート座面・背もたれ・ガングリップ用）
   * - A: 3D サテンシルバー異方性ヘアライン＆ウルトラスエード（アルカンターラ調）微細起毛ナップ
   */
  public static generateCrownInterior3DTexture(size = 32): THREE.Data3DTexture {
    const totalVoxels = size * size * size;
    const data = new Uint8Array(totalVoxels * 4);
    const perm = this.createPermutationTable(5123);

    let ptr = 0;
    const invSize = 1.0 / size;
    const twoPi = Math.PI * 2.0;

    for (let z = 0; z < size; z++) {
      const fz = z * invSize;
      for (let y = 0; y < size; y++) {
        const fy = y * invSize;
        for (let x = 0; x < size; x++) {
          const fx = x * invSize;

          // R: 3D 異方性オープンポア杢目ウッドグレイン（ウッディブラウンパネル用）
          const warpX = this.fbm3DPeriodic(fx + 0.11, fy + 0.27, fz + 0.43, 3, perm, 3) * 0.28;
          const warpY = this.fbm3DPeriodic(fx + 0.53, fy + 0.19, fz + 0.71, 3, perm, 3) * 0.26;
          const ringPhase = (fy * 3.0 + fz * 2.0 + fx * 1.0 + warpX + warpY) * twoPi;
          const woodRings = Math.pow(Math.sin(ringPhase) * 0.5 + 0.5, 1.45);
          const woodPoreFiber =
            this.fbm3DAnisotropicPeriodic(fx, fy, fz, 14, 3, 8, perm, 3) * 0.5 + 0.5;
          // 導管の鋭い凹みピット（オープンポア特有の繊維方向の微細溝）
          const openPorePit = woodPoreFiber < 0.34 ? (0.34 - woodPoreFiber) * 1.35 : 0.0;
          const ribbonShimmer = Math.sin((fx * 2.0 - fy * 1.0 + warpX * 0.6) * twoPi) * 0.08 + 0.08;
          const woodGrain = Math.min(
            Math.max(woodRings * 0.66 + woodPoreFiber * 0.34 + ribbonShimmer - openPorePit, 0.0),
            1.0,
          );

          // G: 3D Worley ペブル本革シボ（セミアニリンナッパレザー・ダッシュボードソフトパッド用）
          const f1Dist = this.worleyCellF1Periodic(fx + 0.17, fy + 0.39, fz + 0.61, 8);
          const pebbleDome = Math.pow(Math.max(1.0 - f1Dist * 1.12, 0.0), 0.72);
          const pebbleCrease = Math.pow(
            this.worleyCrack3DPeriodic(fx + 0.17, fy + 0.39, fz + 0.61, 8),
            1.2,
          );
          const microPore =
            this.fbm3DPeriodic(fx + 0.31, fy + 0.67, fz + 0.13, 14, perm, 2) * 0.5 + 0.5;
          const leatherPebble = Math.min(
            Math.max(pebbleDome * 0.76 + microPore * 0.24 - pebbleCrease * 0.58, 0.0),
            1.0,
          );

          // B: 3D パンチングレザー＆マイクロファブリック織り目（シートセンター・ステアリングガングリップ用）
          const perfGridX = Math.cos(fx * 10.0 * twoPi) * 0.5 + 0.5;
          const perfGridY = Math.cos(fy * 10.0 * twoPi) * 0.5 + 0.5;
          const perfGridZ = Math.cos(fz * 10.0 * twoPi) * 0.5 + 0.5;
          const holeCluster = Math.pow(perfGridX * perfGridY * perfGridZ, 1.35);
          const perfDimple = 1.0 - holeCluster * 0.88;
          const weaveNoise =
            this.fbm3DPeriodic(fx + 0.73, fy + 0.19, fz + 0.47, 10, perm, 3) * 0.5 + 0.5;
          const perforatedWeave = Math.min(
            Math.max(perfDimple * 0.72 + weaveNoise * 0.28, 0.0),
            1.0,
          );

          // A: 3D サテンシルバー微細ヘアライン＆ウルトラスエード起毛マイクロファイバー変調
          const brushedHairline =
            this.fbm3DAnisotropicPeriodic(fx + 0.29, fy + 0.83, fz + 0.41, 18, 4, 5, perm, 2) *
              0.5 +
            0.5;
          const fineSheen =
            this.fbm3DPeriodic(fx + 0.61, fy + 0.11, fz + 0.89, 12, perm, 2) * 0.5 + 0.5;
          const satinSpecMod = Math.min(
            Math.max(brushedHairline * 0.68 + fineSheen * 0.32, 0.0),
            1.0,
          );

          data[ptr] = this.toByte(woodGrain);
          data[ptr + 1] = this.toByte(leatherPebble);
          data[ptr + 2] = this.toByte(perforatedWeave);
          data[ptr + 3] = this.toByte(satinSpecMod);
          ptr += 4;
        }
      }
    }

    return this.createRgbaData3DTexture(data, size);
  }

  /**
   * 7. 道路標示ペイント・縁石・ガードレール・鋳鉄マンホール・道路標識用 3D ボリュームテクスチャ
   * 4チャンネル構成 (RGBAFormat):
   * - R: 路面標示ペイント・標識フィルムの再帰反射ガラスビーズ＆マイクロプリズム粒子（3D Worley F1 + 高周波スパークル）
   * - G: 溶融式トラフィックペイント厚み・タイヤ通過摩耗剥離マスク＆点字ブロック滑り止め粒子（3D FBM + 3D クラック）
   * - B: ガードレール溶融亜鉛めっき結晶（スパングル）・標識アルミ裏面ヘアライン・信号機筐体微細凹凸（3D 異方性 FBM + Worley）
   * - A: 鋳鉄マンホール・側溝グレーチングの砂型鋳造ディンプル肌＆縁石コンクリートの風化雨だれ・骨材（3D Worley F1 + 3D Perlin）
   */
  public static generateRoadMarkingProp3DTexture(size = 32): THREE.Data3DTexture {
    const totalVoxels = size * size * size;
    const data = new Uint8Array(totalVoxels * 4);
    const perm = this.createPermutationTable(9182);
    const invSize = 1.0 / size;
    let ptr = 0;

    for (let z = 0; z < size; z++) {
      const fz = z * invSize;
      for (let y = 0; y < size; y++) {
        const fy = y * invSize;
        for (let x = 0; x < size; x++) {
          const fx = x * invSize;

          // R: 再帰反射ガラスビーズ＆プリズム粒子
          const beadCell = 1.0 - this.worleyCellF1Periodic(fx + 0.13, fy + 0.29, fz + 0.47, 10);
          const microSparkle =
            this.perlin3DPeriodic(fx * 16, fy * 16, fz * 16, 16, perm) * 0.5 + 0.5;
          const glassBead = Math.min(
            Math.max(Math.pow(beadCell, 1.5) * 0.68 + microSparkle * 0.32, 0.0),
            1.0,
          );

          // G: ペイント塗膜厚み・摩耗剥離マスク＆点字ブロック粒子
          const paintBody =
            this.fbm3DPeriodic(fx + 0.37, fy + 0.19, fz + 0.61, 6, perm, 3) * 0.5 + 0.5;
          const wearCrack = this.worleyCrack3DPeriodic(fx + 0.41, fy + 0.53, fz + 0.23, 6);
          const paintWearMask = Math.min(
            Math.max(paintBody * 0.85 - wearCrack * 0.35 + 0.12, 0.0),
            1.0,
          );

          // B: 溶融亜鉛めっきスパングル・アルミヘアライン
          const spangleCell = 1.0 - this.worleyCellF1Periodic(fx + 0.59, fy + 0.71, fz + 0.17, 6);
          const metalGrain =
            this.fbm3DAnisotropicPeriodic(fx + 0.23, fy + 0.43, fz + 0.83, 12, 4, 8, perm, 2) *
              0.5 +
            0.5;
          const galvanizedMetal = Math.min(
            Math.max(spangleCell * 0.52 + metalGrain * 0.48, 0.0),
            1.0,
          );

          // A: 鋳鉄砂型ディンプル・縁石コンクリート骨材＆雨だれ風化
          const castDimple = 1.0 - this.worleyCellF1Periodic(fx + 0.83, fy + 0.11, fz + 0.37, 8);
          const curbWeathering =
            this.fbm3DAnisotropicPeriodic(fx + 0.17, fy + 0.67, fz + 0.29, 4, 12, 4, perm, 3) *
              0.5 +
            0.5;
          const castAndCurb = Math.min(
            Math.max(castDimple * 0.58 + curbWeathering * 0.42, 0.0),
            1.0,
          );

          data[ptr] = this.toByte(glassBead);
          data[ptr + 1] = this.toByte(paintWearMask);
          data[ptr + 2] = this.toByte(galvanizedMetal);
          data[ptr + 3] = this.toByte(castAndCurb);
          ptr += 4;
        }
      }
    }

    return this.createRgbaData3DTexture(data, size);
  }

  /**
   * 8. 車両エクステリア（外装メタリックマイカ塗装・タイヤ加硫ゴム・ホイール切削・ブレーキローター）用 3D ボリュームテクスチャ
   * 4チャンネル構成 (RGBAFormat):
   * - R: ボディ塗装の 3D メタリック・マイカフレーク（真珠光沢・アルミフレーク微細スパークル粒子）
   * - G: クリアコート層の 3D マイクロオレンジピール（塗装肌法線ゆらぎ）
   * - B: タイヤトレッド＆サイドウォール加硫ゴムの 3D マイクログレイン・シリカ配合粒子・摩耗質感
   * - A: アルミホイール切削スピンヘアライン＆ベンチレーテッドブレーキローター鋳鉄摺動痕（3D 異方性ノイズ）
   */
  public static generateVehicleExterior3DTexture(size = 32): THREE.Data3DTexture {
    const totalVoxels = size * size * size;
    const data = new Uint8Array(totalVoxels * 4);
    const perm = this.createPermutationTable(6421);
    const invSize = 1.0 / size;
    let ptr = 0;

    for (let z = 0; z < size; z++) {
      const fz = z * invSize;
      for (let y = 0; y < size; y++) {
        const fy = y * invSize;
        for (let x = 0; x < size; x++) {
          const fx = x * invSize;

          // R: メタリック・マイカフレーク粒子
          const flakeCell = 1.0 - this.worleyCellF1Periodic(fx + 0.21, fy + 0.47, fz + 0.73, 12);
          const flakeShimmer =
            this.perlin3DPeriodic(fx * 16, fy * 16, fz * 16, 16, perm) * 0.5 + 0.5;
          const micaFlake = Math.min(
            Math.max(Math.pow(flakeCell, 1.8) * 0.65 + flakeShimmer * 0.35, 0.0),
            1.0,
          );

          // G: クリアコート・オレンジピール微細ゆらぎ
          const orangePeel =
            this.fbm3DPeriodic(fx + 0.33, fy + 0.59, fz + 0.14, 6, perm, 3) * 0.5 + 0.5;

          // B: タイヤトレッド＆サイドウォール加硫ゴム粒子
          const rubberPore = 1.0 - this.worleyCellF1Periodic(fx + 0.63, fy + 0.19, fz + 0.41, 10);
          const treadCompound =
            this.fbm3DPeriodic(fx + 0.11, fy + 0.83, fz + 0.57, 8, perm, 3) * 0.5 + 0.5;
          const tireRubber = Math.min(Math.max(rubberPore * 0.55 + treadCompound * 0.45, 0.0), 1.0);

          // A: アルミホイール切削ヘアライン＆ブレーキローター摺動痕
          const machinedSpin =
            this.fbm3DAnisotropicPeriodic(fx + 0.49, fy + 0.27, fz + 0.69, 16, 16, 4, perm, 2) *
              0.5 +
            0.5;
          const rotorGroove =
            this.fbm3DPeriodic(fx + 0.77, fy + 0.39, fz + 0.91, 8, perm, 2) * 0.5 + 0.5;
          const wheelAlloy = Math.min(Math.max(machinedSpin * 0.66 + rotorGroove * 0.34, 0.0), 1.0);

          data[ptr] = this.toByte(micaFlake);
          data[ptr + 1] = this.toByte(orangePeel);
          data[ptr + 2] = this.toByte(tireRubber);
          data[ptr + 3] = this.toByte(wheelAlloy);
          ptr += 4;
        }
      }
    }

    return this.createRgbaData3DTexture(data, size);
  }

  /**
   * 9. 皇居お堀・水面用 3D コースティクス・マイクロ波紋・水中散乱ボリュームテクスチャ
   * 4チャンネル構成 (RGBAFormat):
   * - R: 3D 水中コースティクス（集光模様）セルラーネットワーク（周期的 3D Worley F1 反転＋クラック強調）
   * - G: 3D マイクロ毛細管波紋（風波による多方向干渉リップルハイト）
   * - B: 水中浮遊微粒子・プランクトン散乱（サブサーフェス・スキャタリング深度濃度）
   * - A: 水際マイクロフォーム（気泡）＆水草揺らぎ変調マスク
   */
  public static generateWaterCaustics3DTexture(size = 32): THREE.Data3DTexture {
    const totalVoxels = size * size * size;
    const data = new Uint8Array(totalVoxels * 4);
    const perm = this.createPermutationTable(3571);
    const invSize = 1.0 / size;
    let ptr = 0;

    for (let z = 0; z < size; z++) {
      const fz = z * invSize;
      for (let y = 0; y < size; y++) {
        const fy = y * invSize;
        for (let x = 0; x < size; x++) {
          const fx = x * invSize;

          // R: 3D 水中コースティクス網目
          const [f1, voidBridge] = this.worleyCellF1AndVoidPeriodic(
            fx + 0.19,
            fy + 0.43,
            fz + 0.67,
            6,
          );
          const causticRidge = Math.pow(Math.min(f1 * 1.35, 1.0), 2.2);
          const caustics = Math.min(Math.max(causticRidge * 0.65 + voidBridge * 0.45, 0.0), 1.0);

          // G: 3D マイクロ毛細管リップル
          const capillaryRipple =
            this.fbm3DAnisotropicPeriodic(fx + 0.31, fy + 0.73, fz + 0.13, 8, 4, 8, perm, 3) * 0.5 +
            0.5;

          // B: 水中浮遊粒子・プランクトン散乱密度
          const suspendedTurbidity =
            this.fbm3DPeriodic(fx + 0.57, fy + 0.21, fz + 0.89, 4, perm, 3) * 0.5 + 0.5;

          // A: 水際マイクロフォーム気泡
          const foamBubble = 1.0 - this.worleyCellF1Periodic(fx + 0.79, fy + 0.17, fz + 0.53, 8);
          const foamMask = Math.min(Math.max(foamBubble * 0.6 + capillaryRipple * 0.4, 0.0), 1.0);

          data[ptr] = this.toByte(caustics);
          data[ptr + 1] = this.toByte(capillaryRipple);
          data[ptr + 2] = this.toByte(suspendedTurbidity);
          data[ptr + 3] = this.toByte(foamMask);
          ptr += 4;
        }
      }
    }

    return this.createRgbaData3DTexture(data, size);
  }

  // --- 内部ヘルパー & 3D トーラス周期ノイズ数学関数群 ---

  private static createRgbaData3DTexture(data: Uint8Array, size: number): THREE.Data3DTexture {
    const texture = new THREE.Data3DTexture(data, size, size, size);
    texture.format = THREE.RGBAFormat;
    texture.type = THREE.UnsignedByteType;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.wrapR = THREE.RepeatWrapping;
    texture.needsUpdate = true;
    return texture;
  }

  private static toByte(normalizedValue: number): number {
    const clamped = Math.min(Math.max(normalizedValue, 0.0), 1.0);
    return Math.floor(clamped * 255.0);
  }

  private static modPositive(n: number, period: number): number {
    return ((n % period) + period) % period;
  }

  private static createPermutationTable(initialSeed = 1337): Uint8Array {
    const table = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      p[i] = i;
    }
    // Fisher-Yates シャッフル（決定論的シード）
    let seed = initialSeed;
    for (let i = 255; i > 0; i--) {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      const j = Math.floor((seed / 4294967296) * (i + 1));
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    for (let i = 0; i < 512; i++) {
      table[i] = p[i & 255];
    }
    return table;
  }

  private static fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private static lerp(t: number, a: number, b: number): number {
    return a + t * (b - a);
  }

  private static grad3D(hash: number, x: number, y: number, z: number): number {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  /**
   * 3次元トーラス周期 Perlin ノイズ（X, Y, Z それぞれ独立した整数周期 periodX, periodY, periodZ で完全タイル化）
   */
  private static perlin3DAnisotropicPeriodic(
    x: number,
    y: number,
    z: number,
    periodX: number,
    periodY: number,
    periodZ: number,
    perm: Uint8Array,
  ): number {
    const floorX = Math.floor(x);
    const floorY = Math.floor(y);
    const floorZ = Math.floor(z);

    const X0 = this.modPositive(floorX, periodX) & 255;
    const Y0 = this.modPositive(floorY, periodY) & 255;
    const Z0 = this.modPositive(floorZ, periodZ) & 255;

    const X1 = this.modPositive(floorX + 1, periodX) & 255;
    const Y1 = this.modPositive(floorY + 1, periodY) & 255;
    const Z1 = this.modPositive(floorZ + 1, periodZ) & 255;

    const fx = x - floorX;
    const fy = y - floorY;
    const fz = z - floorZ;

    const u = this.fade(fx);
    const v = this.fade(fy);
    const w = this.fade(fz);

    const A0 = perm[X0] + Y0;
    const A1 = perm[X0] + Y1;
    const B0 = perm[X1] + Y0;
    const B1 = perm[X1] + Y1;

    const AA0 = perm[A0 & 511] + Z0;
    const AA1 = perm[A0 & 511] + Z1;
    const AB0 = perm[A1 & 511] + Z0;
    const AB1 = perm[A1 & 511] + Z1;
    const BA0 = perm[B0 & 511] + Z0;
    const BA1 = perm[B0 & 511] + Z1;
    const BB0 = perm[B1 & 511] + Z0;
    const BB1 = perm[B1 & 511] + Z1;

    return this.lerp(
      w,
      this.lerp(
        v,
        this.lerp(
          u,
          this.grad3D(perm[AA0 & 511], fx, fy, fz),
          this.grad3D(perm[BA0 & 511], fx - 1, fy, fz),
        ),
        this.lerp(
          u,
          this.grad3D(perm[AB0 & 511], fx, fy - 1, fz),
          this.grad3D(perm[BB0 & 511], fx - 1, fy - 1, fz),
        ),
      ),
      this.lerp(
        v,
        this.lerp(
          u,
          this.grad3D(perm[AA1 & 511], fx, fy, fz - 1),
          this.grad3D(perm[BA1 & 511], fx - 1, fy, fz - 1),
        ),
        this.lerp(
          u,
          this.grad3D(perm[AB1 & 511], fx, fy - 1, fz - 1),
          this.grad3D(perm[BB1 & 511], fx - 1, fy - 1, fz - 1),
        ),
      ),
    );
  }

  private static perlin3DPeriodic(
    x: number,
    y: number,
    z: number,
    period: number,
    perm: Uint8Array,
  ): number {
    return this.perlin3DAnisotropicPeriodic(x, y, z, period, period, period, perm);
  }

  /**
   * 3次元トーラス周期 FBM（各オクターブで周波数と周期を同時に2倍化することで境界の連続性を厳密保持）
   */
  private static fbm3DPeriodic(
    normX: number,
    normY: number,
    normZ: number,
    basePeriod: number,
    perm: Uint8Array,
    octaves = 3,
  ): number {
    return this.fbm3DAnisotropicPeriodic(
      normX,
      normY,
      normZ,
      basePeriod,
      basePeriod,
      basePeriod,
      perm,
      octaves,
    );
  }

  /**
   * 3次元トーラス (T^3) 上で数学的に完全周期的な 3D Perlin FBM を評価する（境界 0.0 と 1.0 で完全一致）
   */
  public static samplePeriodicVolumeNoise3D(
    normX: number,
    normY: number,
    normZ: number,
    basePeriod = 4,
    seed = 1337,
  ): number {
    const perm = this.createPermutationTable(seed);
    return this.fbm3DPeriodic(normX, normY, normZ, basePeriod, perm, 3);
  }

  private static fbm3DAnisotropicPeriodic(
    normX: number,
    normY: number,
    normZ: number,
    basePeriodX: number,
    basePeriodY: number,
    basePeriodZ: number,
    perm: Uint8Array,
    octaves = 3,
  ): number {
    let total = 0;
    let amplitude = 1.0;
    let maxValue = 0;
    let freqMult = 1;

    for (let i = 0; i < octaves; i++) {
      const px = basePeriodX * freqMult;
      const py = basePeriodY * freqMult;
      const pz = basePeriodZ * freqMult;
      total +=
        this.perlin3DAnisotropicPeriodic(normX * px, normY * py, normZ * pz, px, py, pz, perm) *
        amplitude;
      maxValue += amplitude;
      amplitude *= 0.5;
      freqMult *= 2;
    }

    return total / maxValue;
  }

  /**
   * 周期的 Worley (Cellular) ノイズによる 3D セル中心距離 F1
   */
  private static worleyCellF1Periodic(
    normX: number,
    normY: number,
    normZ: number,
    period: number,
  ): number {
    const x = normX * period;
    const y = normY * period;
    const z = normZ * period;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);

    let d1 = 999.0;

    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const cx = ix + dx;
          const cy = iy + dy;
          const cz = iz + dz;

          const wrappedCx = this.modPositive(cx, period);
          const wrappedCy = this.modPositive(cy, period);
          const wrappedCz = this.modPositive(cz, period);

          const h = (wrappedCx * 73856093) ^ (wrappedCy * 19349663) ^ (wrappedCz * 83492791);
          const rx = ((h & 0x7fffffff) % 1009) * 0.00099108;
          const ry = ((((h >> 5) ^ (wrappedCx * 49979693)) & 0x7fffffff) % 1009) * 0.00099108;
          const rz = ((((h >> 11) ^ (wrappedCy * 29986577)) & 0x7fffffff) % 1009) * 0.00099108;

          const diffX = cx + rx - x;
          const diffY = cy + ry - y;
          const diffZ = cz + rz - z;

          const distSq = diffX * diffX + diffY * diffY + diffZ * diffZ;
          const isCloser = distSq < d1;
          if (isCloser) {
            d1 = distSq;
          }
        }
      }
    }

    return Math.min(Math.sqrt(d1), 1.0);
  }

  /**
   * 周期的 Worley (Cellular) ノイズによる 3D クラック（ひび割れ・石垣目地）
   * セル中心との距離差 (F2 - F1) により鋭い境界線を抽出
   */
  private static worleyCrack3DPeriodic(
    normX: number,
    normY: number,
    normZ: number,
    period: number,
  ): number {
    const x = normX * period;
    const y = normY * period;
    const z = normZ * period;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);

    let d1Sq = 999.0;
    let d2Sq = 999.0;

    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const cx = ix + dx;
          const cy = iy + dy;
          const cz = iz + dz;

          const wrappedCx = this.modPositive(cx, period);
          const wrappedCy = this.modPositive(cy, period);
          const wrappedCz = this.modPositive(cz, period);

          const h = (wrappedCx * 73856093) ^ (wrappedCy * 19349663) ^ (wrappedCz * 83492791);
          const rx = ((h & 0x7fffffff) % 1009) * 0.00099108;
          const ry = ((((h >> 5) ^ (wrappedCx * 49979693)) & 0x7fffffff) % 1009) * 0.00099108;
          const rz = ((((h >> 11) ^ (wrappedCy * 29986577)) & 0x7fffffff) % 1009) * 0.00099108;

          const diffX = cx + rx - x;
          const diffY = cy + ry - y;
          const diffZ = cz + rz - z;

          const distSq = diffX * diffX + diffY * diffY + diffZ * diffZ;

          const isClosest = distSq < d1Sq;
          const isSecondClosest = distSq < d2Sq;
          if (isClosest) {
            d2Sq = d1Sq;
            d1Sq = distSq;
          } else if (isSecondClosest) {
            d2Sq = distSq;
          }
        }
      }
    }

    // 境界の繊細なクラック線 (d2 - d1)
    // Why not: 0.14 のような広い閾値にすると道路全面に 20cm 幅の太い亀甲・キリン柄ネット模様が出現するため、
    // 0.045 の極細境界に絞り、かつべき乗で滑らかに減衰させる
    const crack = Math.sqrt(d2Sq) - Math.sqrt(d1Sq);
    const isEdge = crack < 0.045;
    return isEdge ? Math.pow(1.0 - crack / 0.045, 2.2) : 0.0;
  }

  /**
   * 周期的 3D Worley 砕石骨材ハイト (F1) と骨材間の微細空隙 (F2 - F1) を1パスで同時に算出する
   */
  private static worleyCellF1AndVoidPeriodic(
    normX: number,
    normY: number,
    normZ: number,
    period: number,
  ): [number, number] {
    const x = normX * period;
    const y = normY * period;
    const z = normZ * period;

    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);

    let d1Sq = 999.0;
    let d2Sq = 999.0;

    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const cx = ix + dx;
          const cy = iy + dy;
          const cz = iz + dz;

          const wrappedCx = this.modPositive(cx, period);
          const wrappedCy = this.modPositive(cy, period);
          const wrappedCz = this.modPositive(cz, period);

          const h = (wrappedCx * 73856093) ^ (wrappedCy * 19349663) ^ (wrappedCz * 83492791);
          const rx = ((h & 0x7fffffff) % 1009) * 0.00099108;
          const ry = ((((h >> 5) ^ (wrappedCx * 49979693)) & 0x7fffffff) % 1009) * 0.00099108;
          const rz = ((((h >> 11) ^ (wrappedCy * 29986577)) & 0x7fffffff) % 1009) * 0.00099108;

          const diffX = cx + rx - x;
          const diffY = cy + ry - y;
          const diffZ = cz + rz - z;

          const distSq = diffX * diffX + diffY * diffY + diffZ * diffZ;

          const isClosest = distSq < d1Sq;
          const isSecondClosest = distSq < d2Sq;
          if (isClosest) {
            d2Sq = d1Sq;
            d1Sq = distSq;
          } else if (isSecondClosest) {
            d2Sq = distSq;
          }
        }
      }
    }

    const d1 = Math.sqrt(d1Sq);
    const gap = Math.sqrt(d2Sq) - d1;
    const isVoid = gap < 0.22;
    const voidVal = isVoid ? Math.pow(1.0 - gap / 0.22, 1.6) : 0.0;
    return [Math.min(d1, 1.0), voidVal];
  }

  /**
   * 周期的 3D アスファルト色調・骨材バインダー濃淡バリエーション
   * Why not: 正方形グリッドの周囲を border < 0.08 で 0.92 に黒く縁取りすると、
   * ワールド上で規則的な四角いタイル・パッチワーク枠線が無限リピートするため、
   * 連続的な 3D Perlin FBM による自然な舗装バインダーの濃淡ムラ（0.0〜0.65）で表現する。
   */
  private static patchwork3DPeriodic(
    normX: number,
    normY: number,
    normZ: number,
    period: number,
    perm: Uint8Array,
  ): number {
    const macroTone = this.fbm3DPeriodic(
      normX + 0.17,
      normY + 0.31,
      normZ + 0.53,
      period * 2,
      perm,
      3,
    );
    const normalizedTone = macroTone * 0.5 + 0.5;
    const isDarkerBinder = normalizedTone > 0.45;
    if (!isDarkerBinder) {
      return 0.0;
    }
    return Math.min((normalizedTone - 0.45) * 1.1, 0.65);
  }
}

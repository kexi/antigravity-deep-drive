import * as THREE from "three";

/**
 * 3Dプロシージャル・ボリュームテクスチャ生成システム
 * Three.js (WebGL2) の Data3DTexture (GLSL sampler3D) を用いた 3 次元トーラス周期ボクセルテクスチャ群
 *
 * 【3Dテクスチャの利点と設計方針】
 * 1. UV展開歪み・タイリングシームの完全根絶:
 *    2Dテクスチャでは複雑な曲面（樹皮・根張り・多層樹冠・広大な道路網）でUV歪みや継ぎ目が発生するが、
 *    3次元ワールド座標 / ローカル座標 (x, y, z) で直接 sampler3D をサンプリングすることで、
 *    どのような形状のジオメトリに対しても完全シームレスな立体質感を付与できる。
 * 2. 数学的 3D トーラス周期性 (Toroidal 3D Tileability):
 *    Why not: 非周期的な perlin3D(fx * scale) では RepeatWrapping の境界 (0.0 <-> 1.0) で不連続な段差が生じるため、
 *    全オクターブの格子座標を整数周期 P で剰余ラップ (Modulo Period) し、3次元トーラス T^3 上で完全連続にする。
 * 3. 用途別 4 種の 3D ボリュームテクスチャ:
 *    - Asphalt3DTexture (RGBA): 道路・石畳の骨材バンプ(R)、3D Worleyクラック(G)、補修パッチ(B)、水たまり盆地深度(A)
 *    - FoliageBark3DTexture (RGBA): イチョウ樹皮の3D縦溝(R)、葉肉SSS透過厚(G)、根元コケ群落(B)、3D風乱流・色彩変調(A)
 *    - Architecture3DTexture (RGBA): 御影石・赤レンガ結晶粒子(R)、3D石垣・レンガ目地(G)、雨水風化パティナ(B)、微細気孔ラフネス(A)
 *    - Fog3DTexture (Red): 雨煙・大気ボリュメトリックフォグ用の 3D Perlin-Worley 密度場
 */
export class Procedural3DTextureGenerator {
  private static sharedAsphalt3D: THREE.Data3DTexture | null = null;
  private static sharedFoliageBark3D: THREE.Data3DTexture | null = null;
  private static sharedArchitecture3D: THREE.Data3DTexture | null = null;
  private static sharedFog3D: THREE.Data3DTexture | null = null;

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
   * 1. 日本のアスファルト路面・石畳広場用 3D ボリュームテクスチャ
   * 4チャンネル構成 (RGBAFormat):
   * - R: 周期的 3D Perlin FBM（アスファルト砕石・御影石結晶のザラつきバンプ）
   * - G: 周期的 3D Worley F2-F1 ノイズ（経年劣化ひび割れ・クラック溝）
   * - B: 周期的 3D パッチワークノイズ（舗装切り貼り補修跡の領域と境界）
   * - A: 周期的 3D フラクタルノイズ（雨水が溜まる水たまり盆地・わだち深度）
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

          // 1. Rチャンネル: 骨材ノイズ（周期16の3DシームレスFBM）
          const rNoise = this.fbm3DPeriodic(fx, fy, fz, 16, perm, 3);
          const rVal = this.toByte(rNoise * 0.5 + 0.5);

          // 2. Gチャンネル: クラック（ひび割れ）ノイズ（周期4の3D Worleyセル境界）
          const worleyCrack = this.worleyCrack3DPeriodic(fx, fy, fz, 4);
          const gVal = this.toByte(worleyCrack);

          // 3. Bチャンネル: 補修パッチワーク境界ノイズ（周期2のグリッド切り貼り跡）
          const patch = this.patchwork3DPeriodic(fx, fy, fz, 2, perm);
          const bVal = this.toByte(patch);

          // 4. Aチャンネル: 水たまり深度（周期3の低周波広域3Dノイズ）
          const puddleNoise = this.fbm3DPeriodic(fx, fy, fz, 3, perm, 3);
          const aVal = this.toByte(puddleNoise * 0.5 + 0.5);

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

          const rx =
            (Math.sin(wrappedCx * 12.9898 + wrappedCy * 78.233 + wrappedCz * 45.164) * 43758.5453) %
            1;
          const ry =
            (Math.sin(wrappedCx * 39.346 + wrappedCy * 11.135 + wrappedCz * 83.155) * 43758.5453) %
            1;
          const rz =
            (Math.sin(wrappedCx * 73.156 + wrappedCy * 52.459 + wrappedCz * 21.234) * 43758.5453) %
            1;

          const diffX = cx + Math.abs(rx) - x;
          const diffY = cy + Math.abs(ry) - y;
          const diffZ = cz + Math.abs(rz) - z;

          const dist = Math.sqrt(diffX * diffX + diffY * diffY + diffZ * diffZ);
          const isCloser = dist < d1;
          if (isCloser) {
            d1 = dist;
          }
        }
      }
    }

    return Math.min(d1, 1.0);
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

    let d1 = 999.0;
    let d2 = 999.0;

    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const cx = ix + dx;
          const cy = iy + dy;
          const cz = iz + dz;

          const wrappedCx = this.modPositive(cx, period);
          const wrappedCy = this.modPositive(cy, period);
          const wrappedCz = this.modPositive(cz, period);

          const rx =
            (Math.sin(wrappedCx * 12.9898 + wrappedCy * 78.233 + wrappedCz * 45.164) * 43758.5453) %
            1;
          const ry =
            (Math.sin(wrappedCx * 39.346 + wrappedCy * 11.135 + wrappedCz * 83.155) * 43758.5453) %
            1;
          const rz =
            (Math.sin(wrappedCx * 73.156 + wrappedCy * 52.459 + wrappedCz * 21.234) * 43758.5453) %
            1;

          const diffX = cx + Math.abs(rx) - x;
          const diffY = cy + Math.abs(ry) - y;
          const diffZ = cz + Math.abs(rz) - z;

          const dist = Math.sqrt(diffX * diffX + diffY * diffY + diffZ * diffZ);

          const isClosest = dist < d1;
          const isSecondClosest = dist < d2;
          if (isClosest) {
            d2 = d1;
            d1 = dist;
          } else if (isSecondClosest) {
            d2 = dist;
          }
        }
      }
    }

    // 境界の繊細なクラック線 (d2 - d1)
    // Why not: 0.14 のような広い閾値にすると道路全面に 20cm 幅の太い亀甲・キリン柄ネット模様が出現するため、
    // 0.045 の極細境界に絞り、かつべき乗で滑らかに減衰させる
    const crack = d2 - d1;
    const isEdge = crack < 0.045;
    return isEdge ? Math.pow(1.0 - crack / 0.045, 2.2) : 0.0;
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

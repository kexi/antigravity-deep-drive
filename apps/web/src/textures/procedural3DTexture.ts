import * as THREE from "three";

/**
 * 3Dプロシージャルテクスチャジェネレーター
 * Three.js の Data3DTexture (sampler3D) を用いたボリュームテクスチャ生成
 *
 * 【3Dテクスチャの利点】
 * - 2Dテクスチャ特有のUV展開歪みやタイリングシームが原理的に存在しない
 * - 3次元ワールド座標 (x, y, z) を直接サンプリングすることで、
 *   広大な都市・道路ネットワーク全体で完全シームレスな路面凹凸・クラック・水たまりを実現
 */
export class Procedural3DTextureGenerator {
  /**
   * 日本のアスファルト路面用 3D ボリュームテクスチャ
   * 4チャンネル構成:
   * - R: 高周波 3D ノイズ（アスファルト骨材のザラつき）
   * - G: 3D Worley / Voronoi ノイズ（ひび割れ・クラック溝）
   * - B: 低周波 3D パッチノイズ（補修パッチワークの領域と境界）
   * - A: 3D フラクタルノイズ（雨水が溜まる低所・わだち深度）
   */
  public static generateAsphalt3DTexture(size = 64): THREE.Data3DTexture {
    const totalVoxels = size * size * size;
    const data = new Uint8Array(totalVoxels * 4);

    // 擬似乱数パーミュテーションテーブル
    const perm = this.createPermutationTable();

    let ptr = 0;
    const invSize = 1.0 / size;

    for (let z = 0; z < size; z++) {
      const fz = z * invSize;
      for (let y = 0; y < size; y++) {
        const fy = y * invSize;
        for (let x = 0; x < size; x++) {
          const fx = x * invSize;

          // 1. Rチャンネル: 骨材ノイズ（高周波 3D ノイズ）
          const rNoise = this.fbm3D(fx * 16.0, fy * 16.0, fz * 16.0, perm, 3);
          const rVal = Math.floor(Math.min(Math.max((rNoise * 0.5 + 0.5) * 255, 0), 255));

          // 2. Gチャンネル: クラック（ひび割れ）ノイズ（Worley セル境界）
          const worley = this.worleyCrack3D(fx * 4.0, fy * 4.0, fz * 4.0);
          const gVal = Math.floor(Math.min(Math.max(worley * 255, 0), 255));

          // 3. Bチャンネル: 補修パッチワーク境界ノイズ
          const patch = this.patchwork3D(fx * 2.0, fy * 2.0, fz * 2.0, perm);
          const bVal = Math.floor(Math.min(Math.max(patch * 255, 0), 255));

          // 4. Aチャンネル: 水たまり深度（低周波広域ノイズ）
          const puddleNoise = this.fbm3D(fx * 2.5, fy * 2.5, fz * 2.5, perm, 2);
          const aVal = Math.floor(Math.min(Math.max((puddleNoise * 0.5 + 0.5) * 255, 0), 255));

          data[ptr] = rVal;
          data[ptr + 1] = gVal;
          data[ptr + 2] = bVal;
          data[ptr + 3] = aVal;
          ptr += 4;
        }
      }
    }

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

  /**
   * 雨煙・大気フォグ用 3D ボリュームノイズテクスチャ
   * 雨天時の水飛沫やヘッドライト光円錐のボリュメトリック散乱用
   */
  public static generateFog3DTexture(size = 32): THREE.Data3DTexture {
    const totalVoxels = size * size * size;
    const data = new Uint8Array(totalVoxels);
    const perm = this.createPermutationTable();

    let ptr = 0;
    const invSize = 1.0 / size;

    for (let z = 0; z < size; z++) {
      const fz = z * invSize;
      for (let y = 0; y < size; y++) {
        const fy = y * invSize;
        for (let x = 0; x < size; x++) {
          const fx = x * invSize;
          const density = this.fbm3D(fx * 4.0, fy * 4.0, fz * 4.0, perm, 4);
          const val = Math.floor(Math.min(Math.max((density * 0.5 + 0.5) * 255, 0), 255));
          data[ptr++] = val;
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

  // --- 3D ノイズ数学ヘルパー ---

  private static createPermutationTable(): Uint8Array {
    const table = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      p[i] = i;
    }
    // Fisher-Yates シャッフル（決定論的シード）
    let seed = 1337;
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

  private static perlin3D(x: number, y: number, z: number, perm: Uint8Array): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;

    const fx = x - Math.floor(x);
    const fy = y - Math.floor(y);
    const fz = z - Math.floor(z);

    const u = this.fade(fx);
    const v = this.fade(fy);
    const w = this.fade(fz);

    const A = perm[X] + Y;
    const AA = perm[A] + Z;
    const AB = perm[A + 1] + Z;
    const B = perm[X + 1] + Y;
    const BA = perm[B] + Z;
    const BB = perm[B + 1] + Z;

    return this.lerp(
      w,
      this.lerp(
        v,
        this.lerp(u, this.grad3D(perm[AA], fx, fy, fz), this.grad3D(perm[BA], fx - 1, fy, fz)),
        this.lerp(
          u,
          this.grad3D(perm[AB], fx, fy - 1, fz),
          this.grad3D(perm[BB], fx - 1, fy - 1, fz),
        ),
      ),
      this.lerp(
        v,
        this.lerp(
          u,
          this.grad3D(perm[AA + 1], fx, fy, fz - 1),
          this.grad3D(perm[BA + 1], fx - 1, fy, fz - 1),
        ),
        this.lerp(
          u,
          this.grad3D(perm[AB + 1], fx, fy - 1, fz - 1),
          this.grad3D(perm[BB + 1], fx - 1, fy - 1, fz - 1),
        ),
      ),
    );
  }

  private static fbm3D(x: number, y: number, z: number, perm: Uint8Array, octaves = 3): number {
    let total = 0;
    let frequency = 1;
    let amplitude = 1;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      total += this.perlin3D(x * frequency, y * frequency, z * frequency, perm) * amplitude;
      maxValue += amplitude;
      amplitude *= 0.5;
      frequency *= 2.0;
    }

    return total / maxValue;
  }

  /**
   * Worley (Cellular) ノイズによる 3D クラック（ひび割れ）
   * セル中心との距離差 (F2 - F1) により鋭い境界線を抽出
   */
  private static worleyCrack3D(x: number, y: number, z: number): number {
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

          // 擬似ランダムセル位置
          const rx = (Math.sin(cx * 12.9898 + cy * 78.233 + cz * 45.164) * 43758.5453) % 1;
          const ry = (Math.sin(cx * 39.346 + cy * 11.135 + cz * 83.155) * 43758.5453) % 1;
          const rz = (Math.sin(cx * 73.156 + cy * 52.459 + cz * 21.234) * 43758.5453) % 1;

          const diffX = cx + Math.abs(rx) - x;
          const diffY = cy + Math.abs(ry) - y;
          const diffZ = cz + Math.abs(rz) - z;

          const dist = Math.sqrt(diffX * diffX + diffY * diffY + diffZ * diffZ);

          if (dist < d1) {
            d2 = d1;
            d1 = dist;
          } else if (dist < d2) {
            d2 = dist;
          }
        }
      }
    }

    // 境界の狭いクラック線 (d2 - d1)
    const crack = d2 - d1;
    const isEdge = crack < 0.12;
    return isEdge ? 1.0 - crack / 0.12 : 0.0;
  }

  /**
   * 補修パッチワーク（グリッド状の舗装切り貼り跡）
   */
  private static patchwork3D(x: number, _y: number, z: number, perm: Uint8Array): number {
    const gx = Math.floor(x);
    const gz = Math.floor(z);
    const h = perm[(gx & 255) + perm[gz & 255]] / 255.0;

    const isPatch = h > 0.72;
    if (!isPatch) {
      return 0.0;
    }

    const fx = x - gx;
    const fz = z - gz;
    const border = Math.min(Math.min(fx, 1.0 - fx), Math.min(fz, 1.0 - fz));
    const isBorderLine = border < 0.08;

    return isBorderLine ? 0.9 : 0.4 + (h - 0.72) * 1.5;
  }
}

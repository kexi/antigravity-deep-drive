import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { Procedural3DTextureGenerator } from "../textures/procedural3DTexture";

describe("3Dプロシージャルテクスチャ生成システムの仕様検証", () => {
  it("アスファルト用3Dボリュームテクスチャが指定解像度と4チャンネル（RGBA）で正常に構築されることを保証する", () => {
    const size = 16; // テスト実行速度のため16x16x16で検証
    const texture = Procedural3DTextureGenerator.generateAsphalt3DTexture(size);

    // 1. Data3DTexture インスタンスとして生成されていること
    expect(texture).toBeInstanceOf(THREE.Data3DTexture);

    // 2. 3次元の解像度が指定サイズと一致すること
    const img = texture.image;
    expect(img.width).toBe(size);
    expect(img.height).toBe(size);
    expect(img.depth).toBe(size);

    // 3. ボクセルデータが RGBA 4チャンネル（size^3 * 4 バイト）で確保されていること
    const expectedByteLength = size * size * size * 4;
    const data = img.data as Uint8Array;
    expect(data).toBeDefined();
    expect(data.byteLength).toBe(expectedByteLength);

    // 4. テクスチャのラッピング設定が3次元すべてで RepeatWrapping であること（シームレスサンプリング保証）
    expect(texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(texture.wrapT).toBe(THREE.RepeatWrapping);
    expect(texture.wrapR).toBe(THREE.RepeatWrapping);

    // 5. 各チャンネル（R: 骨材, G: クラック, B: パッチ, A: 水たまり）に有効な値が格納されていること
    let hasNonZeroR = false;
    let hasNonZeroA = false;
    for (let i = 0; i < data.length; i += 4) {
      const isNonZeroR = data[i] > 0;
      if (isNonZeroR) {
        hasNonZeroR = true;
      }
      const isNonZeroA = data[i + 3] > 0;
      if (isNonZeroA) {
        hasNonZeroA = true;
      }
      const isBothFound = hasNonZeroR && hasNonZeroA;
      if (isBothFound) {
        break;
      }
    }
    expect(hasNonZeroR).toBe(true);
    expect(hasNonZeroA).toBe(true);
  });

  it("イチョウ葉っぱ＆樹皮用3Dボリュームテクスチャが4チャンネル（葉脈・縦溝・コケ・SSS）で正常に生成されることを保証する", () => {
    const size = 12;
    const texture = Procedural3DTextureGenerator.generateFoliageBark3DTexture(size);

    expect(texture).toBeInstanceOf(THREE.Data3DTexture);
    expect(texture.format).toBe(THREE.RGBAFormat);
    expect(texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(texture.wrapT).toBe(THREE.RepeatWrapping);
    expect(texture.wrapR).toBe(THREE.RepeatWrapping);

    const data = texture.image.data as Uint8Array;
    expect(data.byteLength).toBe(size * size * size * 4);
  });

  it("東京駅赤レンガ・丸の内白御影石・お堀石垣用3Dボリュームテクスチャが正常に生成されることを保証する", () => {
    const size = 12;
    const texture = Procedural3DTextureGenerator.generateArchitecture3DTexture(size);

    expect(texture).toBeInstanceOf(THREE.Data3DTexture);
    expect(texture.format).toBe(THREE.RGBAFormat);
    expect(texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(texture.wrapT).toBe(THREE.RepeatWrapping);
    expect(texture.wrapR).toBe(THREE.RepeatWrapping);

    const data = texture.image.data as Uint8Array;
    expect(data.byteLength).toBe(size * size * size * 4);
  });

  it("3次元トーラス周期ノイズが境界(0.0と1.0)で数学的に完全連続であることを保証する", () => {
    const v0 = Procedural3DTextureGenerator.samplePeriodicVolumeNoise3D(0.0, 0.37, 0.64, 4);
    const v1 = Procedural3DTextureGenerator.samplePeriodicVolumeNoise3D(1.0, 0.37, 0.64, 4);
    expect(v0).toBeCloseTo(v1, 6);

    const vy0 = Procedural3DTextureGenerator.samplePeriodicVolumeNoise3D(0.42, 0.0, 0.81, 4);
    const vy1 = Procedural3DTextureGenerator.samplePeriodicVolumeNoise3D(0.42, 1.0, 0.81, 4);
    expect(vy0).toBeCloseTo(vy1, 6);
  });

  it("雨煙・大気フォグ用3DボリュームテクスチャがRedFormatで正常に生成されることを保証する", () => {
    const size = 8;
    const texture = Procedural3DTextureGenerator.generateFog3DTexture(size);

    expect(texture).toBeInstanceOf(THREE.Data3DTexture);
    expect(texture.format).toBe(THREE.RedFormat);
    expect(texture.image.depth).toBe(size);
    const fogData = texture.image.data as Uint8Array;
    expect(fogData).toBeDefined();
    expect(fogData.byteLength).toBe(size * size * size);
  });
});

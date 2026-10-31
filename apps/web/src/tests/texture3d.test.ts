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
      if (data[i] > 0) {
        hasNonZeroR = true;
      }
      if (data[i + 3] > 0) {
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

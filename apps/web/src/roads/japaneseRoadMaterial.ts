import * as THREE from "three";
import { Procedural3DTextureGenerator } from "../textures/procedural3DTexture";

/**
 * 日本の道路用カスタムPBRマテリアル
 * 【設計方針】
 * - 視覚的には「リアルな凸凹」：
 *   - 3Dプロシージャルテクスチャ（Data3DTexture / sampler3D）による完全シームレスな立体サンプリング
 *   - R: アスファルト骨材のざらつき法線バンプ
 *   - G: 経年劣化のひび割れ（クラック）
 *   - B: 補修跡（パッチワーク舗装：四角いつぎはぎ）
 *   - A: 雨天時に凹部に水が溜まる水たまり深度（Puddle Depth）
 * - 物理的には「完全に平ら」：
 *   - ジオメトリ表面を物理コライダーで平滑に保ち、タイヤの引っかかり・不要な跳ねを根絶
 */

export interface JapaneseRoadMaterialOptions {
  baseRoughness?: number;
  baseMetalness?: number;
  noise3DTexture?: THREE.Data3DTexture;
}

export class JapaneseRoadMaterial extends THREE.MeshStandardMaterial {
  private static shared3DTexture: THREE.Data3DTexture | null = null;

  public uRainWetness: { value: number };
  public uTime: { value: number };
  public uRoadNoise3D: { value: THREE.Data3DTexture };

  constructor(options: JapaneseRoadMaterialOptions = {}) {
    super({
      color: 0x27292d,
      roughness: options.baseRoughness ?? 0.85,
      metalness: options.baseMetalness ?? 0.12,
    });

    const hasSharedTex = Boolean(JapaneseRoadMaterial.shared3DTexture);
    if (!hasSharedTex) {
      JapaneseRoadMaterial.shared3DTexture =
        Procedural3DTextureGenerator.generateAsphalt3DTexture(64);
    }

    const tex3D = options.noise3DTexture ?? JapaneseRoadMaterial.shared3DTexture!;

    this.uRainWetness = { value: 0.0 };
    this.uTime = { value: 0.0 };
    this.uRoadNoise3D = { value: tex3D };

    this.onBeforeCompile = (shader) => {
      shader.uniforms.uRainWetness = this.uRainWetness;
      shader.uniforms.uTime = this.uTime;
      shader.uniforms.uRoadNoise3D = this.uRoadNoise3D;

      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        varying vec3 vWorldPos;
        varying vec2 vRoadUv;
        `,
      );

      shader.vertexShader = shader.vertexShader.replace(
        "#include <worldpos_vertex>",
        /* glsl */ `
        #include <worldpos_vertex>
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vRoadUv = uv;
        `,
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        precision highp sampler3D;
        uniform float uRainWetness;
        uniform float uTime;
        uniform sampler3D uRoadNoise3D;
        varying vec3 vWorldPos;
        varying vec2 vRoadUv;

        // 水たまり用雨滴着水リップル計算
        vec2 roadHash2D(vec2 p) {
          p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
          return fract(sin(p) * 43758.5453123);
        }

        vec3 calculatePuddleRipples(vec2 uv, float time, float intensity) {
          vec2 p = uv * 3.2;
          vec3 rippleN = vec3(0.0, 0.0, 1.0);
          if (intensity <= 0.01) {
            return rippleN;
          }

          for (int i = 0; i < 2; i++) {
            float t = time * 1.35 + float(i) * 1.57;
            vec2 gridPos = p + float(i) * vec2(17.1, 31.4);
            vec2 cellId = floor(gridPos);
            vec2 cellFrac = fract(gridPos);

            vec2 dropCenter = roadHash2D(cellId);
            vec2 diff = cellFrac - dropCenter;
            float dist = length(diff);

            float dropAge = fract(t * 1.2 + dot(cellId, vec2(0.4, 0.6)));
            float waveRadius = dropAge * 0.7;
            float waveDist = abs(dist - waveRadius);

            float wave = sin(waveDist * 42.0) * exp(-dist * 4.5) * (1.0 - dropAge);
            vec2 grad = normalize(diff + 0.0001) * wave * 0.4;
            rippleN.xy += grad * intensity;
          }
          return normalize(rippleN);
        }
        `,
      );

      // 3Dボリュームテクスチャからの直接法線バンプサンプリング
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <normal_fragment_maps>",
        /* glsl */ `
        #include <normal_fragment_maps>

        // ワールド座標による3Dテクスチャサンプリング（UV歪み・タイリングシームなし）
        vec3 coord3D = vWorldPos * 0.18;
        vec4 noiseVoxel = texture(uRoadNoise3D, coord3D);

        // Rチャンネル: 骨材のマイクロバンプ
        vec3 stepOffset = vec3(0.02, 0.0, 0.0);
        float hCenter = noiseVoxel.r;
        float hRight  = texture(uRoadNoise3D, coord3D + stepOffset.xyy).r;
        float hUp     = texture(uRoadNoise3D, coord3D + stepOffset.yxy).r;

        vec3 bumpNormal = vec3((hRight - hCenter) * 0.5, (hUp - hCenter) * 0.5, 1.0);

        // Gチャンネル: クラック（ひび割れ溝）の凹凸変調
        float crackVal = noiseVoxel.g;
        bumpNormal.xy += vec2(crackVal * 0.35);

        vec3 calcNormal = normalize(normalMatrix * normalize(bumpNormal));

        // 雨天時: 水たまり部分に動的雨滴リップル波紋法線を適用
        if (uRainWetness > 0.01) {
          float puddleMask = smoothstep(0.48, 0.62, noiseVoxel.a + crackVal * 0.3) * uRainWetness;
          if (puddleMask > 0.05) {
            vec3 rip = calculatePuddleRipples(vWorldPos.xz, uTime, uRainWetness);
            vec3 perturbedN = vec3(rip.x, rip.z, rip.y);
            calcNormal = normalize(mix(calcNormal, normalize(normalMatrix * perturbedN), puddleMask * 0.7));
          }
        }

        normal = calcNormal;
        `,
      );

      // カラーとラフネスの3Dテクスチャ変調
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <roughnessmap_fragment>",
        /* glsl */ `
        #include <roughnessmap_fragment>

        vec3 sampleCoord = vWorldPos * 0.18;
        vec4 voxel = texture(uRoadNoise3D, sampleCoord);

        // Bチャンネル: 補修パッチワークによるアスファルトの色・光沢の差
        float patchVal = voxel.b;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.08, 0.08, 0.10), patchVal * 0.6);

        // Gチャンネル: クラック（ひび割れ部分は黒ずむ）
        float crackDarkness = voxel.g;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.04), crackDarkness * 0.7);

        // Aチャンネル: 3D水たまり深度（雨天時に凹部に水が溜まり、鏡面反射に変化）
        if (uRainWetness > 0.01) {
          float puddleDepth = voxel.a;
          float puddle = smoothstep(0.48, 0.62, puddleDepth + crackDarkness * 0.3) * uRainWetness;

          diffuseColor.rgb *= mix(1.0, 0.62, uRainWetness * 0.8);
          roughnessFactor = mix(roughnessFactor, 0.04, puddle); // 水たまり鏡面化
          roughnessFactor = mix(roughnessFactor, 0.30, uRainWetness * (1.0 - puddle));
          metalnessFactor = mix(metalnessFactor, 0.50, puddle * 0.85);
        }
        `,
      );
    };
  }
}

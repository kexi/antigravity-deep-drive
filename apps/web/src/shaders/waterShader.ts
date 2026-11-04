import * as THREE from "three";
import { Procedural3DTextureGenerator } from "../textures/procedural3DTexture";

export interface WaterShaderOptions {
  shallowColor?: number;
  deepColor?: number;
  waveSpeed?: number;
  waveHeight?: number;
}

/**
 * 物理ベース Gerstner 波 水面シェーダー (Water Surface Shader)
 *
 * 【特徴・視覚表現】
 * 1. トロコイド・Gerstner 波 (Gerstner Waves):
 *    頂点シェーダーにおいて複数の風向・波長・振幅の波を合成し、波頭が尖るリアルな水面起伏を生成。
 * 2. 解析的法線計算 (Analytical Normals) & 3D マイクロ毛細管波紋:
 *    頂点変位の偏微分から水面の正確な法線ベクトルを算出し、`uWaterVolumeTex` (Gチャンネル) の3D毛細管リップルおよび雨滴波紋とブレンド。
 * 3. 光の水中吸光減衰 (Water Depth Absorption) & 3D 水中コースティクス・プランクトン散乱:
 *    浅瀬のエメラルドグリーンから深部のダークティールへの色減衰（Beer-Lambert 則）に加え、
 *    `uWaterVolumeTex` の Rチャンネル（3Dコースティクス網目）と Bチャンネル（水中浮遊粒子散乱）で立体的な水中サブサーフェス輝きを表現。
 * 4. フレネル鏡面反射 (Fresnel Specular) & 水際マイクロフォーム:
 *    水の物理屈折率 (IOR 1.33) に基づく反射と、`uWaterVolumeTex` の Aチャンネルによる石垣際・波頂の微細気泡ディテール。
 * 5. 雨滴着水波紋連動:
 *    雨天時に水面全体に広がる雨滴リップルの動的合成。
 */
export class WaterSurfaceMaterial extends THREE.MeshStandardMaterial {
  public uTime: { value: number };
  public uRainWetness: { value: number };
  public uWaveSpeed: { value: number };
  public uWaveHeight: { value: number };
  public uSunDirection: { value: THREE.Vector3 };
  public uShallowColor: { value: THREE.Color };
  public uDeepColor: { value: THREE.Color };
  public uWaterVolumeTex: { value: THREE.Data3DTexture };

  constructor(options: WaterShaderOptions = {}) {
    super({
      color: options.deepColor ?? 0x0a2a3a,
      roughness: 0.08,
      metalness: 0.15,
      transparent: true,
      opacity: 0.88,
    });

    this.uTime = { value: 0.0 };
    this.uRainWetness = { value: 0.0 };
    this.uWaveSpeed = { value: options.waveSpeed ?? 0.8 };
    this.uWaveHeight = { value: options.waveHeight ?? 0.35 };
    this.uSunDirection = { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() };
    this.uShallowColor = { value: new THREE.Color(options.shallowColor ?? 0x14708c) };
    this.uDeepColor = { value: new THREE.Color(options.deepColor ?? 0x031e2b) };
    this.uWaterVolumeTex = {
      value: Procedural3DTextureGenerator.getSharedWaterCaustics3DTexture(),
    };

    this.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uTime;
      shader.uniforms.uRainWetness = this.uRainWetness;
      shader.uniforms.uWaveSpeed = this.uWaveSpeed;
      shader.uniforms.uWaveHeight = this.uWaveHeight;
      shader.uniforms.uSunDirection = this.uSunDirection;
      shader.uniforms.uShallowColor = this.uShallowColor;
      shader.uniforms.uDeepColor = this.uDeepColor;
      shader.uniforms.uWaterVolumeTex = this.uWaterVolumeTex;

      // 頂点シェーダー: Gerstner 波による頂点変位と法線計算
      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        uniform float uTime;
        uniform float uWaveSpeed;
        uniform float uWaveHeight;
        varying vec3 vWorldPosition;
        varying vec3 vWaveNormal;

        // Gerstner波の計算
        vec3 calculateGerstnerWave(
          vec2 dir,
          float steepness,
          float wavelength,
          vec3 p,
          inout vec3 tangent,
          inout vec3 binormal
        ) {
          float k = 2.0 * 3.14159265 / wavelength;
          float c = sqrt(9.8 / k);
          vec2 d = normalize(dir);
          float f = k * (dot(d, p.xz) - c * uTime * uWaveSpeed);
          float a = steepness / k * uWaveHeight;

          tangent += vec3(
            -d.x * d.x * (steepness * sin(f)),
            d.x * (steepness * cos(f)),
            -d.x * d.y * (steepness * sin(f))
          );
          binormal += vec3(
            -d.x * d.y * (steepness * sin(f)),
            d.y * (steepness * cos(f)),
            -d.y * d.y * (steepness * sin(f))
          );

          return vec3(
            d.x * (a * cos(f)),
            a * sin(f),
            d.y * (a * cos(f))
          );
        }
        `,
      );

      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        /* glsl */ `
        #include <begin_vertex>

        vec3 gridP = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vec3 tangent = vec3(1.0, 0.0, 0.0);
        vec3 binormal = vec3(0.0, 0.0, 1.0);
        vec3 waveOffset = vec3(0.0);

        // 3本の主要Gerstner波の合成（皇居のお堀に吹く風向）
        waveOffset += calculateGerstnerWave(vec2(1.0, 0.3), 0.18, 14.0, gridP, tangent, binormal);
        waveOffset += calculateGerstnerWave(vec2(0.6, 0.8), 0.12, 7.5, gridP, tangent, binormal);
        waveOffset += calculateGerstnerWave(vec2(-0.4, 0.9), 0.08, 3.2, gridP, tangent, binormal);

        transformed += waveOffset;
        vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWaveNormal = normalize(cross(binormal, tangent));
        `,
      );

      // フラグメントシェーダー: 水色減衰、3Dコースティクス・散乱、フレネル、雨滴リップルの合成
      // Why not: 2D UVスクロールだけでは波高(Y)方向の立体的な干渉や水中深度による散乱変化が表現できないため、
      // 3Dワールド座標 vWorldPos と uTime で sampler3D uWaterVolumeTex を直接サンプリングする
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        uniform float uTime;
        uniform float uRainWetness;
        uniform vec3 uSunDirection;
        uniform vec3 uShallowColor;
        uniform vec3 uDeepColor;
        uniform sampler3D uWaterVolumeTex;
        varying vec3 vWorldPosition;
        varying vec3 vWaveNormal;

        // 水面用ハッシュ
        vec2 waterHash2D(vec2 p) {
          p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
          return fract(sin(p) * 43758.5453123);
        }

        // 雨滴リップル法線
        vec3 waterRainRipples(vec2 uv, float time, float rain) {
          vec2 p = uv * 4.0;
          vec3 rNorm = vec3(0.0, 0.0, 1.0);
          if (rain <= 0.01) return rNorm;

          for (int i = 0; i < 2; i++) {
            float t = time * 1.5 + float(i) * 1.8;
            vec2 grid = p + float(i) * vec2(19.2, 37.4);
            vec2 cellId = floor(grid);
            vec2 cellFrac = fract(grid);

            vec2 dropPos = waterHash2D(cellId);
            vec2 diff = cellFrac - dropPos;
            float dist = length(diff);

            float age = fract(t * 1.4 + dot(cellId, vec2(0.3, 0.7)));
            float r = age * 0.8;
            float waveDist = abs(dist - r);

            float w = sin(waveDist * 45.0) * exp(-dist * 4.0) * (1.0 - age);
            rNorm.xy += normalize(diff + 0.0001) * w * 0.35 * rain;
          }
          return normalize(rNorm);
        }
        `,
      );

      // 法線マップ部の変調: Gerstner 波法線、3Dマイクロ毛細管波紋(Gチャンネル)、雨滴リップルのブレンド
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <normal_fragment_maps>",
        /* glsl */ `
        #include <normal_fragment_maps>

        vec3 vWorldPos = vWorldPosition;
        vec3 capCoordA = vWorldPos * vec3(0.18, 0.36, 0.18) + vec3(uTime * 0.045, uTime * 0.02, -uTime * 0.035);
        vec3 capCoordB = vWorldPos * vec3(0.42, 0.68, 0.42) + vec3(-uTime * 0.06, -uTime * 0.025, uTime * 0.05);
        float capSampleA = texture(uWaterVolumeTex, capCoordA).g;
        float capSampleB = texture(uWaterVolumeTex, capCoordB).g;

        // Gチャンネルの3Dマイクロ毛細管波紋で法線 N に繊細な高周波3Dゆらぎを加える
        float capPerturbX = (capSampleA - 0.5) * 0.14 + (capSampleB - 0.5) * 0.09;
        float capPerturbZ = (capSampleB - 0.5) * 0.14 - (capSampleA - 0.5) * 0.09;
        vec3 capillaryWorldNormal = normalize(vWaveNormal + vec3(capPerturbX, 0.0, capPerturbZ));
        vec3 baseN = normalize(mat3(viewMatrix) * capillaryWorldNormal);

        // 雨滴波紋のブレンド
        if (uRainWetness > 0.01) {
          vec3 rip = waterRainRipples(vWorldPos.xz, uTime, uRainWetness);
          vec3 perturbedN = vec3(rip.x, rip.z, rip.y);
          baseN = normalize(mix(baseN, normalize(mat3(viewMatrix) * perturbedN), uRainWetness * 0.5));
        }

        normal = baseN;
        `,
      );

      // カラー・吸光グラデーション・3D水中コースティクス＆プランクトン散乱・水際マイクロフォーム・鏡面反射
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <metalnessmap_fragment>",
        /* glsl */ `
        #include <metalnessmap_fragment>

        // 波の高さに基づく浅瀬・深部カラーグラデーション
        float waveHeightFactor = clamp((vWorldPosition.y + 0.2) * 1.5, 0.0, 1.0);
        vec3 waterColor = mix(uDeepColor, uShallowColor, waveHeightFactor);

        // How: vWorldPos と uTime で 3D ボリュームテクスチャを2スケール干渉サンプリングし、
        // R(コースティクス網目)・B(浮遊粒子散乱)・A(石垣際マイクロフォーム気泡)を合成する
        vec3 vWorldPosVol = vWorldPosition;
        vec4 waterVol1 = texture(
          uWaterVolumeTex,
          vWorldPosVol * vec3(0.15, 0.32, 0.15) + vec3(uTime * 0.038, -uTime * 0.016, uTime * 0.028)
        );
        vec4 waterVol2 = texture(
          uWaterVolumeTex,
          vWorldPosVol * vec3(0.33, 0.52, 0.33) + vec3(-uTime * 0.048, uTime * 0.022, -uTime * 0.036)
        );

        // Rチャンネル: 3D水中コースティクス網目 & Bチャンネル: 水中浮遊微粒子・プランクトン散乱
        float causticNetwork = pow(clamp(waterVol1.r * 0.62 + waterVol2.r * 0.58, 0.0, 1.0), 1.65);
        float planktonScatter = mix(waterVol1.b, waterVol2.b, 0.5);
        float sunLightFactor = max(uSunDirection.y, 0.18);
        vec3 subsurfaceEmerald = vec3(0.06, 0.44, 0.38) * (0.42 + planktonScatter * 0.78) * sunLightFactor;
        vec3 causticRadiance = vec3(0.16, 0.66, 0.58) * causticNetwork * (0.30 + waveHeightFactor * 0.52) * sunLightFactor;

        // Aチャンネル: お堀石垣際（abs(vWorldPos.x) が岸に近い領域や波頂）の微細な水泡・水面ミクロディテール
        float innerBankFactor = 1.0 - smoothstep(14.0, 26.0, abs(vWorldPosVol.x - 18.0));
        float outerBankFactor = smoothstep(92.0, 118.0, abs(vWorldPosVol.x));
        float bankEdgeProximity = clamp(innerBankFactor + outerBankFactor, 0.0, 1.0);
        float waveCrestMask = smoothstep(0.60, 0.94, waveHeightFactor);
        float microFoamIntensity = clamp(
          (bankEdgeProximity * 0.55 + waveCrestMask * 0.45) * waterVol1.a * waterVol2.a * 1.75,
          0.0,
          0.38
        );
        vec3 microFoamColor = vec3(0.74, 0.86, 0.88);

        waterColor += subsurfaceEmerald * 0.30 + causticRadiance * 0.36;
        waterColor = mix(waterColor, microFoamColor, microFoamIntensity);
        diffuseColor.rgb = waterColor;

        // 水面フレネル反射（鏡面度 0.03 + マイクロフォーム・毛細管波紋による微細ラフネス変調）
        roughnessFactor = clamp(0.03 + microFoamIntensity * 0.16 + (waterVol2.g - 0.5) * 0.015, 0.02, 0.32);
        metalnessFactor = 0.25;
        `,
      );
    };
  }
}

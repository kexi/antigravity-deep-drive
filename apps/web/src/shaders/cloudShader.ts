import * as THREE from "three";
import { Procedural3DTextureGenerator } from "../textures/procedural3DTexture";

export interface CloudShaderOptions {
  zenithColor?: number;
  horizonColor?: number;
  sunColor?: number;
  cloudColor?: number;
  cloudShadowColor?: number;
  sunPosition?: THREE.Vector3;
  cloudCoverage?: number;
  cloudDensity?: number;
  cloudType?: number;
  cloudBottomAltitude?: number;
  cloudTopAltitude?: number;
  cloudSpeed?: number;
  windDirection?: THREE.Vector2;
  silverLiningIntensity?: number;
  powderStrength?: number;
  cirrusIntensity?: number;
  cloudMarchSteps?: number;
  cloudSunSteps?: number;
}

export interface CloudUniformUpdateParams {
  zenithColor?: number;
  horizonColor?: number;
  sunColor?: number;
  cloudColor?: number;
  cloudShadowColor?: number;
  cloudCoverage?: number;
  cloudDensity?: number;
  cloudType?: number;
  cloudBottomAltitude?: number;
  cloudTopAltitude?: number;
  cloudSpeed?: number;
  windDirection?: THREE.Vector2;
  silverLiningIntensity?: number;
  powderStrength?: number;
  cirrusIntensity?: number;
  cloudMarchSteps?: number;
  cloudSunSteps?: number;
}

/**
 * 物理ベース 3D ボリュメトリック・レイマーチング雲シェーダー GLSL チャンク
 *
 * 【コア技術仕様】
 * 1. 3D Perlin-Worley ハイブリッド密度場 (`sampler3D uCloudVolumeTex`):
 *    SIGGRAPH Nubis (Guerrilla Games) 方式に基づき、3次元トーラス周期の Perlin-Worley 基本密度(R)を
 *    3オクターブの 3D Worley FBM (G, B, A) で境界侵食（Erosion）し、カリフラワー状の立体積雲を生成。
 * 2. 雲形プロファイル関数 (`sampleCloudHeightGradient`):
 *    高度比 h ∈ [0, 1] と `uCloudType` に応じて、積雲 (Cumulus: 0.0)、層積雲 (Stratocumulus: 0.5)、
 *    乱層雲・積乱雲 (Nimbostratus: 1.0) の垂直断面プロファイルを連続補間。
 * 3. 二重ローブ Henyey-Greenstein 位相関数 (`cloudDualLobePhase`):
 *    強い太陽前方ミー散乱 (g = 0.72: シルバーライニング) と後方散乱 (g = -0.32: 順光時の白い輝き) を統合。
 * 4. Beer-Lambert 減衰 + Powder Sugar 効果 + 多重散乱近似 (`cloudBeerPowder`):
 *    光学的厚み τ に対する指数減衰 exp(-τ) と Powder 項 (1 - exp(-2τ))、および 2 オクターブ多重散乱近似により
 *    雲塊のふっくらした明部と重厚な雲底シャドウを同時に表現。
 * 5. 高層巻雲・すじ雲レイヤー (`sampleCirrusCloudLayer`):
 *    積雲層の上空 (高度 5500m) に異方性ドメインワーピングによる繊細な巻雲（すじ雲）を重ね、多層的な奥行きを付与。
 */
export const CLOUD_SHADER_GLSL = /* glsl */ `
  uniform vec3 uCloudColor;
  uniform vec3 uCloudShadowColor;
  uniform float uCloudCoverage;
  uniform float uCloudDensity;
  uniform float uCloudType;
  uniform float uCloudBottomAltitude;
  uniform float uCloudTopAltitude;
  uniform float uCloudSpeed;
  uniform vec2 uWindDirection;
  uniform float uSilverLiningIntensity;
  uniform float uPowderStrength;
  uniform float uCirrusIntensity;
  uniform int uCloudMarchSteps;
  uniform int uCloudSunSteps;
  uniform sampler3D uCloudVolumeTex;

  // 線形リマップ関数
  float cloudRemap(float value, float oldMin, float oldMax, float newMin, float newMax) {
    return newMin + (clamp(value, oldMin, oldMax) - oldMin) / max(0.0001, (oldMax - oldMin)) * (newMax - newMin);
  }

  // 2D ハッシュ（レイマーチング・ジッタリング及びマクロ雲量変調用）
  float cloudHash2D(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  // 2D バリューノイズ
  float cloudNoise2D(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = cloudHash2D(i);
    float b = cloudHash2D(i + vec2(1.0, 0.0));
    float c = cloudHash2D(i + vec2(0.0, 1.0));
    float d = cloudHash2D(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  // 3オクターブ 2D FBM（広域ウェザーマップ・巻雲用）
  float cloudFbm2D(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 3; i++) {
      v += a * cloudNoise2D(p);
      p = rot * p * 2.03;
      a *= 0.5;
    }
    return v;
  }

  // 1. 雲形（Cumulus / Stratocumulus / Nimbostratus）の垂直高度プロファイル関数
  float sampleCloudHeightGradient(float heightFraction, float cloudType) {
    float h = clamp(heightFraction, 0.0, 1.0);
    // 積雲 (Cumulus): 平らな雲底と丸みを帯びた中〜上層ドーム
    float cumulus = smoothstep(0.0, 0.11, h) * smoothstep(0.98, 0.42, h);
    // 層積雲 (Stratocumulus): 中層に広がる厚みのある雲層
    float stratocumulus = smoothstep(0.0, 0.09, h) * smoothstep(0.82, 0.32, h);
    // 乱層雲・積乱雲 (Nimbostratus / Cumulonimbus): 低空から上空のかなとこ雲まで厚く発達
    float nimbostratus = smoothstep(0.0, 0.06, h) * smoothstep(1.0, 0.82, h);

    float lowMix = mix(cumulus, stratocumulus, clamp(cloudType * 2.0, 0.0, 1.0));
    return mix(lowMix, nimbostratus, clamp((cloudType - 0.5) * 2.0, 0.0, 1.0));
  }

  // 2. Henyey-Greenstein 位相関数 & 二重ローブ散乱
  float cloudPhaseHenyeyGreenstein(float cosTheta, float g) {
    float g2 = g * g;
    float denom = max(0.001, pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5));
    return (1.0 - g2) / (4.0 * 3.14159265 * denom);
  }

  float cloudDualLobePhase(float cosTheta) {
    float forwardLobe = cloudPhaseHenyeyGreenstein(cosTheta, 0.72);
    float backwardLobe = cloudPhaseHenyeyGreenstein(cosTheta, -0.35);
    return mix(backwardLobe, forwardLobe, 0.65);
  }

  // 3. Beer-Lambert 法則 + Powder Sugar 効果 + 2オクターブ多重散乱近似
  float cloudBeerPowder(float opticalDepth, float cosTheta, float powderStrength) {
    float primaryAttenuation = exp(-opticalDepth);
    float secondaryScattering = exp(-opticalDepth * 0.32) * 0.48;
    float beerTerm = max(primaryAttenuation, secondaryScattering);

    // Powder Sugar Effect: 視線が太陽方向に近いほど雲縁の凝縮感と内部散乱の立体感を強調
    float powder = 1.0 - exp(-opticalDepth * 2.4);
    float sunViewAlign = clamp(cosTheta * 0.5 + 0.5, 0.0, 1.0);
    return mix(beerTerm, beerTerm * (0.45 + 1.75 * powder), powderStrength * (0.45 + 0.55 * sunViewAlign));
  }

  // 4. 3D Perlin-Worley ボリュームテクスチャからのボリュメトリック雲密度サンプリング
  float sampleVolumetricCloudDensity(vec3 worldPos, float heightFraction) {
    vec2 windDir = normalize(length(uWindDirection) > 0.001 ? uWindDirection : vec2(0.85, 0.52));
    // 高度に応じたウィンドシア（上空ほど風が速く雲頂が流れる）
    vec3 windOffset = vec3(
      windDir.x * uTime * uCloudSpeed * 120.0 + heightFraction * windDir.x * 140.0,
      uTime * uCloudSpeed * 10.0,
      windDir.y * uTime * uCloudSpeed * 120.0 + heightFraction * windDir.y * 140.0
    );

    vec3 samplePos = worldPos + windOffset;

    // 3D ボリュームテクスチャ (uCloudVolumeTex) サンプリング
    vec3 uvwBase = samplePos * 0.00054;
    vec4 volSample = texture(uCloudVolumeTex, uvwBase);

    // 広域ウェザーマップ（2D FBM）による自然な雲塊と青空の粗密分布
    float weatherMacro = cloudFbm2D(samplePos.xz * 0.00038 + windDir * uTime * uCloudSpeed * 0.15);
    float macroContrast = smoothstep(0.22, 0.78, weatherMacro);
    float localCoverage = clamp(uCloudCoverage * mix(0.62, 1.38, macroContrast), 0.0, 0.98);

    // 高度プロファイル乗算
    float heightGrad = sampleCloudHeightGradient(heightFraction, uCloudType);
    float baseCloud = volSample.r * heightGrad;

    // 雲量閾値によるリマップ（塊と青空の境界をくっきり分離）
    float coverageThreshold = (1.0 - localCoverage) * 0.62;
    float baseWithCoverage = cloudRemap(baseCloud, coverageThreshold, 0.88, 0.0, 1.0);

    if (baseWithCoverage <= 0.001) {
      return 0.0;
    }

    // 低画質モード (uCloudSunSteps <= 0) では2回目の高周波3Dテクスチャフェッチを省略し、ベースサンプルのGBAチャンネルを再利用
    vec3 detailChannels = volSample.gba;
    if (uCloudSunSteps > 0) {
      // 3オクターブ 3D Worley FBM によるカリフラワー状の雲縁ビルー侵食 (Detail Erosion)
      vec3 uvwDetail = (samplePos + vec3(uTime * uCloudSpeed * 45.0, 0.0, 0.0)) * 0.00195;
      detailChannels = texture(uCloudVolumeTex, uvwDetail).gba;
    }
    float detailWorleyFbm = dot(detailChannels, vec3(0.625, 0.25, 0.125));

    // 下層は凝縮、上層（雲頂）ほどモコモコしたカリフラワー形状に侵食させる
    float detailModifier = mix(detailWorleyFbm, 1.0 - detailWorleyFbm, clamp(heightFraction * 3.5, 0.0, 1.0));
    float erosionWeight = 0.28 * pow(1.0 - clamp(uCloudCoverage * 0.65, 0.0, 0.82), 0.65);

    float finalDensity = cloudRemap(baseWithCoverage, detailModifier * erosionWeight, 1.0, 0.0, 1.0);
    return clamp(finalDensity * (0.75 + uCloudDensity * 1.45), 0.0, 1.0);
  }

  // 5. 高層巻雲・すじ雲（Cirrus Clouds: 高度 5500m）の異方性散乱評価
  vec4 sampleCirrusCloudLayer(vec3 rayDir, vec3 sunDir, float cosTheta) {
    if (uCirrusIntensity <= 0.01 || rayDir.y <= 0.02) {
      return vec4(0.0);
    }
    vec2 windDir = normalize(length(uWindDirection) > 0.001 ? uWindDirection : vec2(0.85, 0.52));
    float planeDist = 5500.0 / max(0.04, rayDir.y);
    vec2 cirrusPos = rayDir.xz * planeDist * 0.00024 + windDir * uTime * uCloudSpeed * 0.35;

    // ドメインワーピングによる繊維状のすじ雲パターン
    float warp = cloudFbm2D(cirrusPos * 1.8);
    vec2 stretchedUv = vec2(cirrusPos.x * 2.6 + warp * 0.85, cirrusPos.y * 0.65 - warp * 0.45);
    float streak = cloudFbm2D(stretchedUv * 2.4);
    float fineStreak = cloudNoise2D(stretchedUv * 6.5 + vec2(warp * 2.0));

    float cirrusMask = smoothstep(0.48, 0.82, streak * 0.72 + fineStreak * 0.28) * uCirrusIntensity;
    float horizonFade = smoothstep(0.02, 0.12, rayDir.y);
    float alpha = clamp(cirrusMask * horizonFade * 0.68, 0.0, 0.82);

    // 氷晶による強い太陽前方散乱
    float iceForward = pow(max(0.0, cosTheta), 4.5) * 0.9;
    vec3 cirrusColor = mix(uCloudColor, uSunColor, clamp(0.28 + iceForward, 0.0, 1.0));
    return vec4(cirrusColor, alpha);
  }

  // 6. メイン・ボリュメトリック雲レイマーチング評価関数
  // 戻り値: rgb = 大気遠近法適用済みの雲放射輝度, a = 雲層の不透明度 (1.0 - transmittance)
  vec4 evaluateVolumetricClouds(vec3 rayDir, vec3 sunDir) {
    float cosTheta = dot(rayDir, sunDir);

    // まず上空の巻雲レイヤーを評価
    vec4 cirrus = sampleCirrusCloudLayer(rayDir, sunDir, cosTheta);

    if (rayDir.y <= 0.012 || (uCloudCoverage <= 0.01 && uCloudDensity <= 0.01)) {
      return cirrus;
    }

    // 地球曲率を近似した仮想球殻レイ交差距離の算出
    float bottomAlt = max(200.0, uCloudBottomAltitude);
    float topAlt = max(bottomAlt + 400.0, uCloudTopAltitude);
    float effectiveY = max(0.055, rayDir.y + 0.042);
    float tStart = bottomAlt / effectiveY;
    float tEnd = topAlt / effectiveY;

    const int MARCH_STEPS = 14;
    int activeMarchSteps = clamp(uCloudMarchSteps, 2, MARCH_STEPS);
    float stepSize = (tEnd - tStart) / float(activeMarchSteps);
    float stepScale = float(MARCH_STEPS) / float(activeMarchSteps);

    // ステップ境界のバンディングを滑らかに抑える微小ディザ（粒状ノイズを出さないよう 0.08 に制限）
    float jitter = (cloudNoise2D(rayDir.xz * 180.0) - 0.5) * 0.08;
    float tCurrent = tStart + stepSize * (0.5 + jitter);

    float transmittance = 1.0;
    vec3 accumulatedLight = vec3(0.0);

    float phaseVal = cloudDualLobePhase(cosTheta);
    float silverBoost = pow(max(0.0, cosTheta), 5.0) * uSilverLiningIntensity;

    for (int i = 0; i < MARCH_STEPS; i++) {
      if (i >= activeMarchSteps) {
        break;
      }
      if (transmittance < 0.015) {
        break;
      }

      vec3 samplePos = rayDir * tCurrent;
      float heightFraction = clamp((samplePos.y - bottomAlt) / max(1.0, (topAlt - bottomAlt)), 0.0, 1.0);
      float density = sampleVolumetricCloudDensity(samplePos, heightFraction);

      if (density > 0.002) {
        // 太陽方向へのライトマーチング（画質プリセットに応じて 2ステップ / 1ステップ / 解析的自己遮蔽を切替）
        float sunShadowSample = density * (1.0 - heightFraction) * 0.55;
        if (uCloudSunSteps >= 1) {
          vec3 sunSamplePos1 = samplePos + sunDir * 125.0;
          float sunH1 = clamp((sunSamplePos1.y - bottomAlt) / max(1.0, (topAlt - bottomAlt)), 0.0, 1.0);
          float sunDensity1 = sampleVolumetricCloudDensity(sunSamplePos1, sunH1);
          if (uCloudSunSteps >= 2) {
            vec3 sunSamplePos2 = samplePos + sunDir * 310.0;
            float sunH2 = clamp((sunSamplePos2.y - bottomAlt) / max(1.0, (topAlt - bottomAlt)), 0.0, 1.0);
            float sunDensity2 = sampleVolumetricCloudDensity(sunSamplePos2, sunH2);
            sunShadowSample = sunDensity1 * 0.55 + sunDensity2 * 0.45;
          } else {
            sunShadowSample = sunDensity1 * 0.92;
          }
        }

        // 自己遮蔽に雲下部での光学厚みを加え、立体的な雲底シェーディングを形成
        float baseSelfShadow = (1.0 - heightFraction) * density * 0.45;
        float lightOpticalDepth = (sunShadowSample + baseSelfShadow) * (1.35 + uCloudDensity * 1.65);
        float lightTransmittance = cloudBeerPowder(lightOpticalDepth, cosTheta, uPowderStrength);

        // 垂直方向の環境光バウンス + 太陽光透過によるふっくらした明暗グラデーション
        float verticalBounce = smoothstep(0.04, 0.72, heightFraction);
        float cloudLitFactor = clamp(verticalBounce * 0.62 + lightTransmittance * 0.58, 0.0, 1.0);
        vec3 ambientCloud = mix(uCloudShadowColor, uCloudColor, cloudLitFactor);

        // 太陽直接散乱光（Henyey-Greenstein 位相 + シルバーライニング: 逆光時の前方散乱ピークが白飛びしないようソフト飽和）
        float phaseScatter = min(phaseVal * 1.45, 0.85);
        vec3 directSunScatter = uSunColor * (phaseScatter + silverBoost * 0.55) * lightTransmittance;

        // ステップ内の散乱輝度積分
        vec3 stepScattering = ambientCloud * (0.82 + 0.28 * lightTransmittance) + directSunScatter;

        float stepExtinction = density * (0.68 + uCloudDensity * 1.05) * stepScale;
        float stepTransmittance = exp(-stepExtinction);

        // エネルギー保存積分: S * (1 - exp(-sigma * dt))
        vec3 integratedScattering = stepScattering * (1.0 - stepTransmittance);
        accumulatedLight += transmittance * integratedScattering;
        transmittance *= stepTransmittance;
      }

      tCurrent += stepSize;
    }

    float cumulusAlpha = clamp(1.0 - transmittance, 0.0, 1.0);
    // 雲縁のソフトな立ち上がりと中心部の高い不透明度を両立
    cumulusAlpha = smoothstep(0.02, 0.88, cumulusAlpha);
    vec3 cumulusColor = cumulusAlpha > 0.0001 ? accumulatedLight / max(0.0001, (1.0 - transmittance)) : uCloudColor;

    // 上空の巻雲と下層の積雲を前後関係に従って合成
    vec3 combinedColor = mix(cirrus.rgb, cumulusColor, cumulusAlpha);
    float combinedAlpha = clamp(cirrus.a * (1.0 - cumulusAlpha) + cumulusAlpha, 0.0, 1.0);

    // 地平線直近（仰角 0.01〜0.09）のみ大気遠近法でヘイズに馴染ませ、ビル群の谷間（仰角 0.09 以上）では雲の立体コントラストを完全維持
    float aerialPerspective = smoothstep(0.012, 0.095, rayDir.y);
    vec3 finalCloudColor = mix(uHorizonColor, combinedColor, aerialPerspective);
    float finalCloudAlpha = combinedAlpha * smoothstep(0.012, 0.065, rayDir.y);

    return vec4(finalCloudColor, finalCloudAlpha);
  }
`;

/**
 * 単体利用およびテスト検証用の 3D ボリュメトリック雲ドームクラス (`VolumetricCloudDome`)
 */
export class VolumetricCloudDome {
  public mesh: THREE.Mesh;
  public material: THREE.ShaderMaterial;

  constructor(options: CloudShaderOptions = {}) {
    const uniforms = {
      uZenithColor: { value: new THREE.Color(options.zenithColor ?? 0x0284c7) },
      uHorizonColor: { value: new THREE.Color(options.horizonColor ?? 0xbae6fd) },
      uSunColor: { value: new THREE.Color(options.sunColor ?? 0xfffaed) },
      uCloudColor: { value: new THREE.Color(options.cloudColor ?? 0xffffff) },
      uCloudShadowColor: { value: new THREE.Color(options.cloudShadowColor ?? 0x64748b) },
      uSunPosition: {
        value: options.sunPosition
          ? options.sunPosition.clone().normalize()
          : new THREE.Vector3(0.5, 0.6, -0.6).normalize(),
      },
      uCloudCoverage: { value: options.cloudCoverage ?? 0.48 },
      uCloudDensity: { value: options.cloudDensity ?? 0.42 },
      uCloudType: { value: options.cloudType ?? 0.2 },
      uCloudBottomAltitude: { value: options.cloudBottomAltitude ?? 650.0 },
      uCloudTopAltitude: { value: options.cloudTopAltitude ?? 1850.0 },
      uCloudSpeed: { value: options.cloudSpeed ?? 0.02 },
      uWindDirection: {
        value: options.windDirection
          ? options.windDirection.clone()
          : new THREE.Vector2(0.85, 0.52),
      },
      uSilverLiningIntensity: { value: options.silverLiningIntensity ?? 1.25 },
      uPowderStrength: { value: options.powderStrength ?? 0.85 },
      uCirrusIntensity: { value: options.cirrusIntensity ?? 0.45 },
      uCloudMarchSteps: { value: options.cloudMarchSteps ?? 14 },
      uCloudSunSteps: { value: options.cloudSunSteps ?? 2 },
      uCloudVolumeTex: {
        value: Procedural3DTextureGenerator.getSharedCloud3DTexture(),
      },
      uTime: { value: 0.0 },
    };

    const vertexShader = /* glsl */ `
      varying vec3 vLocalPosition;
      varying vec3 vWorldPosition;
      void main() {
        vLocalPosition = position;
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        vec4 clipPos = projectionMatrix * viewMatrix * worldPosition;
        gl_Position = vec4(clipPos.xy, clipPos.w * 0.99999, clipPos.w);
      }
    `;

    const fragmentShader = /* glsl */ `
      uniform vec3 uZenithColor;
      uniform vec3 uHorizonColor;
      uniform vec3 uSunColor;
      uniform vec3 uSunPosition;
      uniform float uTime;

      varying vec3 vLocalPosition;
      varying vec3 vWorldPosition;

      ${CLOUD_SHADER_GLSL}

      void main() {
        vec3 rayDir = normalize(vLocalPosition);
        vec3 sunDir = normalize(uSunPosition);
        vec4 cloudLayer = evaluateVolumetricClouds(rayDir, sunDir);
        gl_FragColor = cloudLayer;
      }
    `;

    this.material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      depthFunc: THREE.LessEqualDepth,
    });

    const geometry = new THREE.SphereGeometry(880, 32, 16);
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = "VolumetricCloudDome";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -999;
  }

  public update(time: number, cameraPos: THREE.Vector3): void {
    this.material.uniforms.uTime.value = time;
    this.mesh.position.copy(cameraPos);
  }

  public setSunPosition(pos: THREE.Vector3): void {
    this.material.uniforms.uSunPosition.value.copy(pos).normalize();
  }

  public setCloudQuality(marchSteps: number, sunSteps: number): void {
    const u = this.material.uniforms;
    u.uCloudMarchSteps.value = Math.max(2, Math.min(14, Math.round(marchSteps)));
    u.uCloudSunSteps.value = Math.max(0, Math.min(2, Math.round(sunSteps)));
  }

  public setParams(params: CloudUniformUpdateParams): void {
    const u = this.material.uniforms;
    const hasZenith = params.zenithColor !== undefined;
    if (hasZenith) {
      u.uZenithColor.value.setHex(params.zenithColor!);
    }
    const hasHorizon = params.horizonColor !== undefined;
    if (hasHorizon) {
      u.uHorizonColor.value.setHex(params.horizonColor!);
    }
    const hasSunColor = params.sunColor !== undefined;
    if (hasSunColor) {
      u.uSunColor.value.setHex(params.sunColor!);
    }
    const hasCloudColor = params.cloudColor !== undefined;
    if (hasCloudColor) {
      u.uCloudColor.value.setHex(params.cloudColor!);
    }
    const hasShadowColor = params.cloudShadowColor !== undefined;
    if (hasShadowColor) {
      u.uCloudShadowColor.value.setHex(params.cloudShadowColor!);
    }
    const hasCoverage = params.cloudCoverage !== undefined;
    if (hasCoverage) {
      u.uCloudCoverage.value = params.cloudCoverage!;
    }
    const hasDensity = params.cloudDensity !== undefined;
    if (hasDensity) {
      u.uCloudDensity.value = params.cloudDensity!;
    }
    const hasType = params.cloudType !== undefined;
    if (hasType) {
      u.uCloudType.value = params.cloudType!;
    }
    const hasBottomAlt = params.cloudBottomAltitude !== undefined;
    if (hasBottomAlt) {
      u.uCloudBottomAltitude.value = params.cloudBottomAltitude!;
    }
    const hasTopAlt = params.cloudTopAltitude !== undefined;
    if (hasTopAlt) {
      u.uCloudTopAltitude.value = params.cloudTopAltitude!;
    }
    const hasSpeed = params.cloudSpeed !== undefined;
    if (hasSpeed) {
      u.uCloudSpeed.value = params.cloudSpeed!;
    }
    const hasWindDir = params.windDirection !== undefined;
    if (hasWindDir) {
      u.uWindDirection.value.copy(params.windDirection!);
    }
    const hasSilver = params.silverLiningIntensity !== undefined;
    if (hasSilver) {
      u.uSilverLiningIntensity.value = params.silverLiningIntensity!;
    }
    const hasPowder = params.powderStrength !== undefined;
    if (hasPowder) {
      u.uPowderStrength.value = params.powderStrength!;
    }
    const hasCirrus = params.cirrusIntensity !== undefined;
    if (hasCirrus) {
      u.uCirrusIntensity.value = params.cirrusIntensity!;
    }
    const hasMarchSteps = params.cloudMarchSteps !== undefined;
    if (hasMarchSteps) {
      u.uCloudMarchSteps.value = Math.max(2, Math.min(14, Math.round(params.cloudMarchSteps!)));
    }
    const hasSunSteps = params.cloudSunSteps !== undefined;
    if (hasSunSteps) {
      u.uCloudSunSteps.value = Math.max(0, Math.min(2, Math.round(params.cloudSunSteps!)));
    }
  }
}

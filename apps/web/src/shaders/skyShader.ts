import * as THREE from "three";
import { Procedural3DTextureGenerator } from "../textures/procedural3DTexture";
import { CLOUD_SHADER_GLSL } from "./cloudShader";

export interface SkyOptions {
  zenithColor?: number;
  horizonColor?: number;
  sunColor?: number;
  cloudColor?: number;
  cloudShadowColor?: number;
  sunPosition?: THREE.Vector3;
  moonPosition?: THREE.Vector3;
  moonColor?: number;
  moonIntensity?: number;
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
  starsIntensity?: number;
}

/**
 * 物理ベース大気散乱・3Dボリュメトリック雲・太陽・月・星空 空シェーダー (Atmospheric Dynamic Sky & Volumetric Cloud Shader)
 *
 * 【特徴・技術仕様】
 * 1. レイリー散乱・地平線大気減衰 (Rayleigh Scattering & Horizon Extinction):
 *    天頂（ディープブルー）から地平線（温かなヘイズ）への滑らかなグラデーション。
 * 2. ミー散乱太陽ディスク & コロナ光冠 (Mie Scattering Sun Disk & Aureole):
 *    太陽方向への前方散乱と、雲による物理的な遮蔽（オクルージョン）を伴う太陽ディスク。
 * 3. プロシージャル月面・月の海クレーター & 月光コロナ (Procedural Lunar Disk, Maria Craters & Lunar Halo):
 *    球面法線投影・周辺減光（Limb Darkening）・多重オクターブ FBM による「月の海（玄武岩平原）」と高地クレーター陰影、
 *    大気月光ハロー（Lunar Corona）、および夜間ボリュメトリック雲への月光散乱を統合。
 * 4. 3D ボリュメトリック・レイマーチング雲 (`CLOUD_SHADER_GLSL` / `uCloudVolumeTex`):
 *    3D Perlin-Worley ハイブリッド・ボリュームテクスチャ (`sampler3D`) と可変ステップ・レイマーチング、
 *    可変ステップ太陽・月光ライトマーチング、二重ローブ Henyey-Greenstein 位相関数、Beer-Powder 効果、
 *    および上空 5500m の高層巻雲（すじ雲）レイヤーを統合。
 * 5. 夜間恒星瞬き (Procedural Night Stars & Twinkling):
 *    雲の切れ間から覗く微細な恒星群と大気シンチレーション（雲および月面による遮蔽を考慮）。
 * 6. Far クリップ平面不変の無限遠スカイドーム投影 (`gl_Position = vec4(clipPos.xy, clipPos.w * 0.99999, clipPos.w)`):
 *    メインカメラ (`far = 600`) やバックミラー (`far = 160`) 等いかなるカメラの `far` 設定でも
 *    スカイドームが Far 平面でクリップされて消失することを防ぎ、かつ `depth >= 0.99995` を維持して深度フォグ・光学レンズフレアと完全共存。
 */
export class AtmosphericSky {
  public mesh: THREE.Mesh;
  public material: THREE.ShaderMaterial;

  constructor(options: SkyOptions = {}) {
    const uniforms = {
      uZenithColor: { value: new THREE.Color(options.zenithColor ?? 0x0284c7) },
      uHorizonColor: { value: new THREE.Color(options.horizonColor ?? 0xbae6fd) },
      uSunColor: { value: new THREE.Color(options.sunColor ?? 0xfffaed) },
      uCloudColor: { value: new THREE.Color(options.cloudColor ?? 0xffffff) },
      uCloudShadowColor: { value: new THREE.Color(options.cloudShadowColor ?? 0x64748b) },
      uSunPosition: {
        value: options.sunPosition
          ? options.sunPosition.clone().normalize()
          : new THREE.Vector3(0.35, 0.42, -0.84).normalize(),
      },
      uMoonPosition: {
        value: options.moonPosition
          ? options.moonPosition.clone().normalize()
          : new THREE.Vector3(-0.28, 0.36, -0.89).normalize(),
      },
      uMoonColor: { value: new THREE.Color(options.moonColor ?? 0xe2e8f0) },
      uMoonIntensity: { value: options.moonIntensity ?? 0.0 },
      uCloudCoverage: { value: options.cloudCoverage ?? 0.48 },
      uCloudDensity: { value: options.cloudDensity ?? 0.35 },
      uCloudType: { value: options.cloudType ?? 0.18 },
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
      uCloudMarchSteps: {
        value: Math.max(2, Math.min(14, Math.round(options.cloudMarchSteps ?? 14))),
      },
      uCloudSunSteps: { value: Math.max(0, Math.min(2, Math.round(options.cloudSunSteps ?? 2))) },
      uCloudVolumeTex: {
        value: Procedural3DTextureGenerator.getSharedCloud3DTexture(),
      },
      uStarsIntensity: { value: options.starsIntensity ?? 0.0 },
      uTime: { value: 0.0 },
    };

    const vertexShader = /* glsl */ `
      varying vec3 vLocalPosition;
      varying vec3 vWorldPosition;
      void main() {
        vLocalPosition = position;
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        // Why not: 通常の gl_Position = projectionMatrix * viewMatrix * worldPosition だと、
        // 半径 2400m のスカイドーム頂点がメインカメラ (far=600) やミラーカメラ (far=160) の Far 平面を超えて
        // WebGL の視錐台クリッピングにより空・太陽・月・雲が 100% 消失してしまうため。
        // How: NDC 空間で z/w = 0.99999 に固定することで、任意のカメラ far でもクリップされず、
        // かつ DepthFogPass (depth >= 0.9999) と LensFlarePass (d >= 0.99995) が空として正確に認識できるようにする。
        vec4 clipPos = projectionMatrix * viewMatrix * worldPosition;
        gl_Position = vec4(clipPos.xy, clipPos.w * 0.99999, clipPos.w);
      }
    `;

    const fragmentShader = /* glsl */ `
      uniform vec3 uZenithColor;
      uniform vec3 uHorizonColor;
      uniform vec3 uSunColor;
      uniform vec3 uSunPosition;
      uniform vec3 uMoonPosition;
      uniform vec3 uMoonColor;
      uniform float uMoonIntensity;
      uniform float uStarsIntensity;
      uniform float uTime;

      varying vec3 vLocalPosition;
      varying vec3 vWorldPosition;

      // 疑似ランダムハッシュ関数
      float hash(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      // 2Dバリューノイズ
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);

        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));

        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      // 3オクターブ フラクタル・ブラウン運動 (FBM)
      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
        for (int i = 0; i < 3; i++) {
          v += a * noise(p);
          p = rot * p * 2.0;
          a *= 0.5;
        }
        return v;
      }

      ${CLOUD_SHADER_GLSL}

      // プロシージャル月面（月の海・クレーター陰影・周辺減光・大気コロナ）描画関数
      vec3 evaluateLunarContribution(vec3 rayDir, vec3 moonDir, float cloudAlpha, out float outMoonDiskMask) {
        outMoonDiskMask = 0.0;
        if (uMoonIntensity <= 0.005) {
          return vec3(0.0);
        }

        float moonCos = dot(rayDir, moonDir);
        // 運転視点から視認しやすい視直径（約 2.1度）のシャープな月円盤マスク
        float moonDisk = smoothstep(0.99915, 0.99942, moonCos);
        outMoonDiskMask = moonDisk;

        // 球面タンジェント座標系を構築し、月面上の 2D 座標と球面法線を算出
        vec3 upRef = abs(moonDir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 moonRight = normalize(cross(upRef, moonDir));
        vec3 moonUp = normalize(cross(moonDir, moonRight));

        // 視線と月中心ベクトルの角度差を正規化月面半径 (r ∈ [0, 1]) に変換
        const float moonAngularRadius = 0.038;
        vec2 lunarUv = vec2(dot(rayDir, moonRight), dot(rayDir, moonUp)) / moonAngularRadius;
        float r2 = clamp(dot(lunarUv, lunarUv), 0.0, 1.0);
        float zSphere = sqrt(max(0.001, 1.0 - r2));
        vec2 sphereCoords = lunarUv / (0.65 + 0.35 * zSphere);

        // 月の海（Lunar Maria: 玄武岩質の暗い平原）と高地クレーターのマルチスケール FBM 模様
        float mariaMacro = fbm(sphereCoords * 2.1 + vec2(1.7, -0.9));
        float mariaDetail = fbm(sphereCoords * 5.2 - vec2(0.8, 2.3));
        float craterMicro = noise(sphereCoords * 12.5 + vec2(3.1, 1.4));
        float mariaPattern = smoothstep(0.32, 0.64, mariaMacro * 0.68 + mariaDetail * 0.32);
        float craterRim = smoothstep(0.55, 0.85, craterMicro) * 0.14;

        // 周辺減光 (Limb Darkening) と立体陰影（白飛びせず月の海と高地クレーターの陰影がくっきり見えるよう調整）
        float limbDarkening = pow(zSphere, 0.42);
        vec3 highlandAlbedo = uMoonColor * vec3(1.02, 1.01, 0.96);
        vec3 mariaAlbedo = uMoonColor * vec3(0.42, 0.46, 0.56);
        vec3 lunarSurface = mix(highlandAlbedo, mariaAlbedo, mariaPattern * 0.78) + vec3(craterRim);
        lunarSurface *= limbDarkening;

        // 大気中の氷晶・エアロゾルによる月光コロナ（Aureole）とソフトな銀青色ハロー
        float moonHalo = pow(max(0.0, moonCos), 12.0) * 0.24;
        float moonCorona = pow(max(0.0, moonCos), 96.0) * 0.72;

        // 雲による月ディスクおよび月光コロナの物理オクルージョン
        float moonDiskOcclusion = 1.0 - smoothstep(0.22, 0.80, cloudAlpha);
        float haloOcclusion = 0.25 + 0.75 * moonDiskOcclusion;

        vec3 haloContrib = uMoonColor * (moonHalo * haloOcclusion + moonCorona * (0.20 + 0.80 * moonDiskOcclusion)) * (1.0 - moonDisk * 0.75);
        vec3 diskContrib = lunarSurface * moonDisk * 1.18 * moonDiskOcclusion;

        return (haloContrib + diskContrib) * uMoonIntensity;
      }

      void main() {
        // Why not: vWorldPosition - cameraPosition を使うと、バックミラーのオフスクリーン描画時に
        // スカイドーム中心座標（メインカメラ位置）とミラーカメラ位置の差で視線ベクトルが歪むため、
        // 球体ローカル座標 vLocalPosition を正規化して常に純粋な全方位視線ベクトルを得る。
        vec3 rayDir = normalize(vLocalPosition);
        vec3 sunDir = normalize(uSunPosition);
        vec3 moonDir = normalize(uMoonPosition);
        float elevation = clamp(rayDir.y, 0.0, 1.0);

        // 1. レイリー散乱グラデーション (大気ヘイズ: ビル群の谷間でも天頂の深い青・茜色がしっかり視認できるよう指数を調整)
        float horizonFade = pow(1.0 - elevation, 4.2);
        vec3 skyColor = mix(uZenithColor, uHorizonColor, horizonFade);

        // 2. 太陽ディスク & ミー散乱コロナ（ビルの谷間の青空や積乱雲が白飛びしないようコロナの広がり指数を締め、シャープな太陽円盤を強調）
        float sunActiveWeight = clamp(1.0 - uMoonIntensity * 0.88, 0.0, 1.0);
        float cosTheta = dot(rayDir, sunDir);
        float sunAureole = pow(max(0.0, cosTheta), 64.0) * 0.14 * sunActiveWeight;
        float sunGlow = pow(max(0.0, cosTheta), 420.0) * 0.55 * sunActiveWeight;
        float sunDisk = smoothstep(0.99925, 0.99962, cosTheta) * sunActiveWeight;

        // 3. 夜間恒星 (Stars & Twinkling - 雲層および月円盤より奥の宇宙空間として先に描画)
        if (uStarsIntensity > 0.01 && rayDir.y > 0.05) {
          vec2 starUv = rayDir.xz / (rayDir.y + 0.1) * 35.0;
          float starNoise = hash(floor(starUv));
          if (starNoise > 0.985) {
            float twinkle = sin(uTime * 4.0 + starNoise * 6.28) * 0.4 + 0.6;
            float starCenter = length(fract(starUv) - 0.5);
            float starGlow = smoothstep(0.12, 0.0, starCenter);
            vec3 starColor = mix(vec3(0.9, 0.95, 1.0), vec3(1.0, 0.8, 0.6), hash(floor(starUv) + 1.0));
            skyColor += starColor * starGlow * twinkle * uStarsIntensity * smoothstep(0.05, 0.2, rayDir.y);
          }
        }

        // 4. 3D ボリュメトリック・レイマーチング雲 + 高層巻雲レイヤー評価
        // 夜間は月方向 (moonDir) からの月光散乱と太陽方向をブレンドして雲縁のシルバーライニングを計算
        vec3 primaryCelestialDir = normalize(mix(sunDir, moonDir, clamp(uMoonIntensity, 0.0, 1.0)));
        vec4 cloudLayer = evaluateVolumetricClouds(rayDir, primaryCelestialDir);

        // 5. 月面ディスク（月の海・クレーター）& 月光コロナの合成（月面背後にある恒星はマスクで隠す）
        float moonDiskMask = 0.0;
        vec3 moonContribution = evaluateLunarContribution(rayDir, moonDir, cloudLayer.a, moonDiskMask);
        skyColor = skyColor * (1.0 - moonDiskMask * clamp(uMoonIntensity, 0.0, 1.0)) + moonContribution;

        // 6. 雲による太陽ディスクの物理的オクルージョン（厚い雲の背後ではシャープな太陽円盤と光冠が減衰し雲の散乱へ移行）
        float sunDiskOcclusion = 1.0 - smoothstep(0.25, 0.82, cloudLayer.a);
        float aureoleOcclusion = 0.22 + 0.78 * sunDiskOcclusion;
        vec3 sunContribution = uSunColor * (sunAureole * aureoleOcclusion + sunGlow * (0.18 + 0.82 * sunDiskOcclusion) + sunDisk * 2.2 * sunDiskOcclusion);
        skyColor += sunContribution;

        // 7. 大気空・太陽・月・恒星の上にボリュメトリック雲層をアルファ合成
        skyColor = mix(skyColor, cloudLayer.rgb, cloudLayer.a);

        gl_FragColor = vec4(skyColor, 1.0);
      }
    `;

    this.material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      depthWrite: false, // 最奥描画のため深度バッファを汚染しない
      depthTest: true,
      depthFunc: THREE.LessEqualDepth,
    });

    // スカイドーム用球体ジオメトリ（広域都市マップ 2400m × 2400m 全体を包囲する半径 2400m）
    const geometry = new THREE.SphereGeometry(2400, 32, 16);
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = "AtmosphericSkyDome";
    this.mesh.frustumCulled = false;
  }

  public update(time: number, cameraPos: THREE.Vector3): void {
    this.material.uniforms.uTime.value = time;
    this.mesh.position.copy(cameraPos);
  }

  public setSunPosition(pos: THREE.Vector3): void {
    this.material.uniforms.uSunPosition.value.copy(pos).normalize();
  }

  public setMoonPosition(pos: THREE.Vector3): void {
    this.material.uniforms.uMoonPosition.value.copy(pos).normalize();
  }

  /**
   * グラフィック品質プリセットに応じて雲レイマーチングのステップ数を動的に切り替える。
   */
  public setCloudQuality(marchSteps: number, sunSteps: number): void {
    this.material.uniforms.uCloudMarchSteps.value = Math.max(
      2,
      Math.min(14, Math.round(marchSteps)),
    );
    this.material.uniforms.uCloudSunSteps.value = Math.max(0, Math.min(2, Math.round(sunSteps)));
  }

  public setParams(params: {
    zenithColor?: number;
    horizonColor?: number;
    sunColor?: number;
    moonColor?: number;
    moonIntensity?: number;
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
    starsIntensity?: number;
  }): void {
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

    const hasMoonColor = params.moonColor !== undefined;
    if (hasMoonColor) {
      u.uMoonColor.value.setHex(params.moonColor!);
    }

    const hasMoonIntensity = params.moonIntensity !== undefined;
    if (hasMoonIntensity) {
      u.uMoonIntensity.value = params.moonIntensity!;
    }

    const hasCloudColor = params.cloudColor !== undefined;
    if (hasCloudColor) {
      u.uCloudColor.value.setHex(params.cloudColor!);
    }

    const hasCloudShadow = params.cloudShadowColor !== undefined;
    if (hasCloudShadow) {
      u.uCloudShadowColor.value.setHex(params.cloudShadowColor!);
    }

    const hasCloudCoverage = params.cloudCoverage !== undefined;
    if (hasCloudCoverage) {
      u.uCloudCoverage.value = params.cloudCoverage!;
    }

    const hasCloudDensity = params.cloudDensity !== undefined;
    if (hasCloudDensity) {
      u.uCloudDensity.value = params.cloudDensity!;
    }

    const hasCloudType = params.cloudType !== undefined;
    if (hasCloudType) {
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

    const hasCloudSpeed = params.cloudSpeed !== undefined;
    if (hasCloudSpeed) {
      u.uCloudSpeed.value = params.cloudSpeed!;
    }

    const hasWindDir = params.windDirection !== undefined;
    if (hasWindDir) {
      u.uWindDirection.value.copy(params.windDirection!);
    }

    const hasSilverLining = params.silverLiningIntensity !== undefined;
    if (hasSilverLining) {
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

    const hasStars = params.starsIntensity !== undefined;
    if (hasStars) {
      u.uStarsIntensity.value = params.starsIntensity!;
    }
  }
}

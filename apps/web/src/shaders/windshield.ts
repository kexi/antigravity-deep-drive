import * as THREE from "three";

/**
 * フロントガラス・雨滴・ワイパー払拭シミュレーション用 光学屈折ガラスシェーダー
 *
 * 【視覚表現・アルゴリズム】
 * 1. 実寸メートル座標系 (1.48m × 0.965m) による右ハンドル日本車 (JDM RHD) 3D ワイパーブレードとの完全 1:1 同期:
 *    - 運転席ピボット (0.16m, 0.02m)・ブレード長 [0.08m, 0.86m]・掃引角 [0.08, 1.62] rad
 *    - 助手席ピボット (0.80m, 0.02m)・ブレード長 [0.08m, 0.66m]・掃引角 [0.08, 1.56] rad
 * 2. 往復ストローク位相連動のワイパー払拭履歴 (Stroke-Age Wiper Clearing & Regrowth):
 *    - ブレード通過直後の領域 (strokeAge ≈ 0) では水滴・雨筋を 100% 払拭してクリアな視界を確保
 *    - 掃引扇形内部の基本水滴量を低く抑え、ブレード通過からの経過時間に応じて繊細な雨粒が1粒ずつランダムに着水し、次回のストロークで再びスッと拭き取られる動的サイクル
 *    - ブレード進行方向の先端エッジおよび扇形反転境界に形成される水堤 (Water Ridge)
 * 3. 多重スケール自然雨滴 & 重力・風圧ベクトル合成:
 *    - 低速時は重力によりガラス斜面を下方向 (-Y) へ蛇行滑落し、高速走行時は風圧で斜め上・外側へ吹き上がる物理軌道
 *    - 水滴間のガラスは透明に保ち、水滴内部のみメニスカス縁・上下反転レンズ屈折・鋭いスペキュラハイライトを描画
 */

export type VehicleGlassType = "windshield" | "side" | "rear";

export interface WindshieldUniforms {
  [key: string]: THREE.IUniform;
  uTime: { value: number };
  uRainIntensity: { value: number };
  uSpeed: { value: number };
  /**
   * 速度積分済みの縦方向（カウル↔ルーフ／上下）水滴スクロール位相
   * Why 累積位相ユニフォームを設けるか:
   * `uTime * fallRate(uSpeed)` のように総経過時間と瞬間速度の積でスクロールさせると、
   * 加減速した瞬間に `uTime` が大きいため水滴グリッド座標が数十セル単位で瞬間移動（ワープ／逆再生スクラブ）してしまう。
   * 毎フレーム `dt` で速度に応じた滑落・吹き上がり角速度を積分した位相を渡すことで、0km/h→100km/h の加速やブレーキングでも連続的に水滴が加減速する。
   */
  uWindScrollY: { value: number };
  /** 速度積分済みの横方向（Aピラー放射風／サイドガラス後方スリップストリーム）水滴スクロール位相 */
  uWindScrollX: { value: number };
  uWiperAngle1: { value: number };
  uWiperAngle2: { value: number };
  uWiperClearing: { value: number };
  uWiperDir: { value: number };
  uWiperSpeed: { value: number };
  uGlassType: { value: number };
  uEnvMap: { value: THREE.Texture | null };
  uEnvSkyColor: { value: THREE.Color };
  uEnvGroundColor: { value: THREE.Color };
  uSunColor: { value: THREE.Color };
  uNightFactor: { value: number };
}

/**
 * ガラス種別と走行速度 (km/h) から、単位時間 (1秒) あたりの水滴スクロール位相増分を計算する純粋関数。
 * How:
 * - フロントガラス (`windshield`):
 *   - 0〜45 km/h: 重力が卓越し下方向 (`+scrollYRate > 0`) へ滑落
 *   - 45〜55 km/h: 傾斜34°ガラス面上の走行風揚力と重力が拮抗する気流バランス域 (`scrollYRate ≈ 0`)
 *   - 55〜140+ km/h: 動圧 (`\propto v^2`) が表面張力・重力を凌駕し、ルーフ上端 (`scrollYRate < 0`) かつ左右Aピラー外側 (`scrollXRate > 0`) へ吹き上がる
 * - サイドガラス (`side`):
 *   - 速度上昇に伴いフロントAピラーからリアCピラー方向 (`+scrollXRate`) へ高速スリップストリーム滑走
 * - リアガラス (`rear`):
 *   - ファストバック背面気流に沿って下端へ滑落加速
 */
export function computeGlassRainScrollRates(
  speedKmh: number,
  glassType: VehicleGlassType = "windshield",
): { scrollYRate: number; scrollXRate: number } {
  const clampedSpeed = Math.max(0, speedKmh);
  const speedNorm = Math.min(clampedSpeed / 100.0, 1.5);
  const aeroPressure = Math.min((clampedSpeed / 78.0) * (clampedSpeed / 78.0), 2.2);

  const isSideGlass = glassType === "side";
  if (isSideGlass) {
    return {
      scrollYRate: Math.max(0.28, 0.85 - speedNorm * 0.42),
      scrollXRate: speedNorm * 1.15 + aeroPressure * 0.65,
    };
  }

  const isRearGlass = glassType === "rear";
  if (isRearGlass) {
    return {
      scrollYRate: 1.05 + speedNorm * 0.45 + aeroPressure * 0.25,
      scrollXRate: speedNorm * 0.16,
    };
  }

  // フロントガラス: 約 50 km/h (speedNorm=0.5, aeroPressure≈0.41) で重力 1.0 と気流揚力が拮抗し、それ以上の高速域でマイナス（上方吹き上がり）に反転
  const gravityVsWind = 1.0 - speedNorm * 0.72 - aeroPressure * 1.55;
  return {
    scrollYRate: gravityVsWind,
    scrollXRate: speedNorm * 0.35 + aeroPressure * 0.75,
  };
}

export function createWindshieldMaterial(
  glassType: VehicleGlassType = "windshield",
): THREE.ShaderMaterial {
  const isSideGlass = glassType === "side";
  const isRearGlass = glassType === "rear";
  const glassTypeCode = isSideGlass ? 1.0 : isRearGlass ? 2.0 : 0.0;

  const uniforms: WindshieldUniforms = {
    uTime: { value: 0.0 },
    uRainIntensity: { value: 0.0 },
    uSpeed: { value: 0.0 },
    uWindScrollY: { value: 0.0 },
    uWindScrollX: { value: 0.0 },
    uWiperAngle1: { value: 0.08 },
    uWiperAngle2: { value: 0.08 },
    uWiperClearing: { value: isSideGlass || isRearGlass ? 0.0 : 1.0 },
    uWiperDir: { value: 1.0 },
    uWiperSpeed: { value: 3.5 },
    uGlassType: { value: glassTypeCode },
    uEnvMap: { value: null },
    uEnvSkyColor: { value: new THREE.Color(0x94a3b8) },
    uEnvGroundColor: { value: new THREE.Color(0x1e293b) },
    uSunColor: { value: new THREE.Color(0xfde68a) },
    uNightFactor: { value: 0.0 },
  };

  const vertexShader = /* glsl */ `
    varying vec2 vUv;
    varying vec3 vWorldNormal;
    varying vec3 vWorldPosition;
    varying vec3 vViewPosition;

    void main() {
      vUv = uv;
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPos.xyz;
      vWorldNormal = normalize(mat3(modelMatrix) * normal);

      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vViewPosition = -mvPosition.xyz;
      gl_Position = projectionMatrix * mvPosition;
    }
  `;

  const fragmentShader = /* glsl */ `
    uniform float uTime;
    uniform float uRainIntensity;
    uniform float uSpeed;
    uniform float uWindScrollY;
    uniform float uWindScrollX;
    uniform float uWiperAngle1;
    uniform float uWiperAngle2;
    uniform float uWiperClearing;
    uniform float uWiperDir;
    uniform float uWiperSpeed;
    uniform float uGlassType;
    uniform vec3 uEnvSkyColor;
    uniform vec3 uEnvGroundColor;
    uniform vec3 uSunColor;
    uniform float uNightFactor;

    varying vec2 vUv;
    varying vec3 vWorldNormal;
    varying vec3 vWorldPosition;
    varying vec3 vViewPosition;

    // ガラス種別ごとの実寸スケール:
    // 0: フロントガラス (1.48m × 0.965m)
    // 1: 6ライトサイドガラス (全長 2.85m × 高さ 0.56m)
    // 2: ファストバックリアガラス (幅 1.46m × 斜面長 1.08m)
    vec2 getGlassPhysicalSize(float glassType) {
      if (glassType > 0.5 && glassType < 1.5) {
        return vec2(2.85, 0.56);
      }
      if (glassType >= 1.5) {
        return vec2(1.46, 1.08);
      }
      return vec2(1.48, 0.965);
    }

    // 擬似乱数ハッシュ
    vec2 hash22(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.xx + p3.yz) * p3.zy);
    }

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    // ガラス面上の局所気流・重力合成ベクトルを計算する
    // 戻り値: xy = 正規化された水滴進行方向ベクトル (ガラス面 p 座標系), z = 気流ストレッチ倍率, w = 風圧微振動強度
    vec4 computeLocalAirflowVector(vec2 p, float speedKmh, float glassType) {
      float speedNorm = clamp(speedKmh / 100.0, 0.0, 1.5);
      float aeroPressure = clamp((speedKmh / 78.0) * (speedKmh / 78.0), 0.0, 2.2);

      // サイドガラス: 停車時は真下 (0, -1)、走行時は車両後方 (+X) へ鋭く傾く水平スリップストリーム
      if (glassType > 0.5 && glassType < 1.5) {
        vec2 sideVel = vec2(speedNorm * 1.65 + aeroPressure * 1.10, -max(0.18, 0.85 - speedNorm * 0.52));
        float sideLen = length(sideVel);
        vec2 sideDir = (sideLen > 0.001) ? (sideVel / sideLen) : vec2(0.0, -1.0);
        float sideStretch = 1.0 + speedNorm * 1.35 + aeroPressure * 1.45;
        float sideTremor = smoothstep(25.0, 75.0, speedKmh) * 0.35;
        return vec4(sideDir, sideStretch, sideTremor);
      }

      // リアガラス: ファストバック背面気流に沿って下端 (-Y) かつわずかに外側へ流れ落ちる
      if (glassType >= 1.5) {
        float rearRadialX = (p.x - 0.73) / 0.73;
        vec2 rearVel = vec2(rearRadialX * speedNorm * 0.25, -(1.0 + speedNorm * 0.55 + aeroPressure * 0.35));
        vec2 rearDir = normalize(rearVel);
        float rearStretch = 1.0 + speedNorm * 0.65 + aeroPressure * 0.55;
        float rearTremor = smoothstep(35.0, 90.0, speedKmh) * 0.22;
        return vec4(rearDir, rearStretch, rearTremor);
      }

      // フロントガラス (1.48m × 0.965m, 傾斜角34°):
      // - 低速域 (0〜35km/h): 重力が支配し真下 (0, -1) へ滑落
      // - 中速均衡域 (35〜60km/h): 風圧揚力と重力が拮抗 (stagnation) し、水滴が風圧で小刻みに震えながら左右Aピラー方向へ開き始める
      // - 高速域 (65〜140+km/h): 動圧 (v^2) が重力を振り切り、ルーフ上端 (+Y) および左右Aピラー外側 (radialX) へ放射状に吹き上がる
      float radialX = (p.x - 0.74) / 0.74;
      float lateralWind = radialX * (speedNorm * 0.58 + aeroPressure * 1.15);
      float verticalNet = -1.0 + speedNorm * 0.72 + aeroPressure * 1.55;
      vec2 rawVel = vec2(lateralWind, verticalNet);
      float velMag = length(rawVel);
      vec2 flowDir = (velMag > 0.08) ? (rawVel / velMag) : normalize(vec2(radialX * 0.35, -0.25));

      float frontStretch = 1.0 + speedNorm * 0.85 + aeroPressure * 1.75;
      // 重力と風圧が拮抗する 35〜70km/h 付近で表面張力と気流剥離による微振動 (windVibration) が最も顕著になり、高速域でも乱流微振動が持続する
      float stagnationTremor = exp(-pow((speedKmh - 50.0) / 22.0, 2.0)) * 0.65;
      float highSpeedTremor = smoothstep(45.0, 110.0, speedKmh) * 0.45;
      return vec4(flowDir, frontStretch, clamp(stagnationTremor + highSpeedTremor, 0.0, 1.0));
    }

    // 1. 静止・着水雨滴層 (Landed Droplets & Unwiped Micro Mist)
    // 戻り値: xy = 水滴のレンズ法線勾配, z = 水滴マスク (0.0 = 透明ガラス, 1.0 = 水滴内部)
    vec3 calculateStaticMist(
      vec2 p,
      float localRain,
      float unwipedFactor,
      float time,
      float speedKmh,
      vec4 airflow
    ) {
      vec2 totalGrad = vec2(0.0);
      float totalMask = 0.0;

      vec2 flowDir = airflow.xy;
      float aeroStretch = airflow.z;
      float windTremor = airflow.w;
      float speedNorm = clamp(speedKmh / 100.0, 0.0, 1.5);
      // 走行風が強まるほど静止水滴の入れ替わり（吹き飛び＆新規着水）サイクルが加速し、小粒ミストは風圧で吹き飛ばされて減少する
      float windBlowOff = clamp(1.0 - speedNorm * 0.32, 0.48, 1.0);
      // 水滴の伸長軸を局所気流ベクトル flowDir に揃える 2D 回転基底（along: 気流進行方向, perp: 気流直交方向）
      vec2 flowPerp = vec2(-flowDir.y, flowDir.x);

      // レイヤー 1A: 中粒の着水雨滴（実寸フロントガラス上で繊細に見える高精細グリッド）
      {
        vec2 grid = p * 68.0;
        vec2 id = floor(grid);
        vec2 gv = fract(grid) - 0.5;
        vec2 rand = hash22(id);

        // 各セルの水滴が着水する閾値（払拭直後 localRain≈0 では 0 粒、時間経過とともに1粒ずつ出現）
        float birthThreshold = 0.08 + rand.x * 0.84;
        float dropLife = clamp((localRain - birthThreshold) * 3.2, 0.0, 1.0);

        // 時間による微細な着水明滅（高速走行時は風圧で水滴の離脱・着水サイクルが速まる）
        float cycleRate = (0.14 + rand.y * 0.20) * (1.0 + speedNorm * 1.45);
        float timeCycle = fract(time * cycleRate + rand.x * 3.7);
        float lifeEnvelope = smoothstep(0.0, 0.15, timeCycle) * smoothstep(1.0, 0.82, timeCycle);
        float activeDrop = dropLife * (0.65 + 0.35 * lifeEnvelope);

        if (activeDrop > 0.01) {
          // 中〜高速域における気流せん断による水滴の微振動 (Wind Quiver / Tremor)
          float tremorFreq = 22.0 + speedNorm * 26.0 + rand.x * 12.0;
          vec2 quiverOffset = flowPerp * sin(time * tremorFreq + rand.y * 6.28) * 0.045 * windTremor +
                              flowDir * cos(time * (tremorFreq * 0.85) + rand.x * 6.28) * 0.035 * windTremor;
          vec2 offset = (rand - 0.5) * 0.58 + quiverOffset;
          vec2 delta = gv - offset;

          // 局所気流ベクトル (flowDir) に沿って水滴を空力ティアドロップ変形（高速ほど風下へ細長く伸びる）
          float alongFlow = dot(delta, flowDir);
          float acrossFlow = dot(delta, flowPerp);
          float stretchFactor = clamp(0.84 / mix(1.0, aeroStretch, 0.52), 0.36, 0.84);
          float widthPinch = 1.0 + clamp(alongFlow * 1.2, -0.25, 0.45) * clamp(speedNorm, 0.0, 1.0);
          vec2 aeroDelta = flowDir * (alongFlow * stretchFactor) + flowPerp * (acrossFlow * widthPinch);

          float radius = (0.11 + 0.13 * rand.y) * (0.45 + 0.55 * sqrt(activeDrop)) * windBlowOff;
          float dist = length(aeroDelta);

          if (dist < radius) {
            float rNorm = dist / max(radius, 0.001);
            // 表面張力による球冠メニスカス断面
            float edgeSoft = smoothstep(1.0, 0.76, rNorm);
            vec2 grad = (delta / max(radius, 0.001)) * (0.6 + 0.4 * rNorm) * edgeSoft;
            totalGrad += grad * 1.1;
            totalMask = max(totalMask, edgeSoft);
          }
        }
      }

      // レイヤー 1B: 小粒の着水雨滴（黄金角オフセットで格子感を排除）
      {
        mat2 rot = mat2(0.866, -0.5, 0.5, 0.866);
        vec2 grid = (rot * p) * 118.0 + vec2(17.3, 41.8);
        vec2 id = floor(grid);
        vec2 gv = fract(grid) - 0.5;
        vec2 rand = hash22(id);

        float birthThreshold = 0.05 + rand.x * 0.86;
        float dropLife = clamp((localRain - birthThreshold) * 3.6, 0.0, 1.0);

        if (dropLife > 0.01) {
          vec2 offset = (rand - 0.5) * 0.62;
          vec2 delta = gv - offset;
          float alongFlow = dot(delta, flowDir);
          float acrossFlow = dot(delta, flowPerp);
          float stretchB = clamp(1.0 / mix(1.0, aeroStretch, 0.38), 0.48, 1.0);
          vec2 aeroDelta = flowDir * (alongFlow * stretchB) + flowPerp * acrossFlow;

          float radius = (0.10 + 0.12 * rand.y) * sqrt(dropLife) * windBlowOff;
          float dist = length(aeroDelta);

          if (dist < radius) {
            float rNorm = dist / max(radius, 0.001);
            float edgeSoft = smoothstep(1.0, 0.72, rNorm);
            vec2 grad = (delta / max(radius, 0.001)) * edgeSoft;
            totalGrad += grad * 0.82;
            totalMask = max(totalMask, edgeSoft * 0.82);
          }
        }
      }

      // レイヤー 1C: ワイパー払拭域外の細かい結露ミスト（扇形境界の外側に密集し、高速時は風圧で一部吹き飛ぶ）
      float mistIntensity = unwipedFactor * clamp(localRain * 1.1, 0.0, 1.0) * windBlowOff;
      if (mistIntensity > 0.02) {
        vec2 grid = p * 195.0;
        vec2 id = floor(grid);
        vec2 gv = fract(grid) - 0.5;
        vec2 rand = hash22(id);

        float isMistPresent = step(0.26, rand.x) * mistIntensity;
        float radius = 0.21 * (0.5 + 0.5 * rand.y);
        vec2 delta = gv - (rand - 0.5) * 0.52;
        float dist = length(delta);

        if (dist < radius && isMistPresent > 0.01) {
          float rNorm = dist / radius;
          float mask = smoothstep(1.0, 0.55, rNorm) * isMistPresent;
          totalGrad += (delta / radius) * mask * 0.52;
          totalMask = max(totalMask, mask * 0.52);
        }
      }

      return vec3(totalGrad, clamp(totalMask, 0.0, 1.0));
    }

    // 2. 動的滑落水滴 & 高速空力ストリーク・ビーズ状雨筋トレイル層 (Speed-Driven Sliding Teardrops & Aerodynamic Wind Streaks)
    // 戻り値: xy = 滑落水滴のレンズ法線勾配, z = 水滴マスク
    vec3 calculateSlidingDrops(
      vec2 p,
      float time,
      float speedKmh,
      float speedFactor,
      float scrollPhaseY,
      float scrollPhaseX,
      float localRain,
      float uRainRaw,
      float bladeContactMask,
      float glassType,
      vec4 airflow
    ) {
      float aeroPressure = clamp((speedKmh / 78.0) * (speedKmh / 78.0), 0.0, 2.2);
      // ワイパー掃引域内でも、中〜高速走行時 (speedKmh > 35km/h) には着水直後の雨粒が風圧で筋を引いて吹き上がる演出を許容する（ただしブレード接触直下は100%消去）
      float highSpeedWindStreakBoost = smoothstep(32.0, 95.0, speedKmh) * uRainRaw * 0.52 * (1.0 - bladeContactMask);
      float effectiveSlideRain = max(localRain, highSpeedWindStreakBoost);
      float slidePresence = smoothstep(0.18, 0.68, effectiveSlideRain);
      if (slidePresence <= 0.005) {
        return vec3(0.0);
      }

      bool isSideGlass = (glassType > 0.5 && glassType < 1.5);
      bool isRearGlass = (glassType >= 1.5);

      // 位相積分ユニフォーム (uWindScrollY / uWindScrollX) が更新されている場合はそれを優先し、
      // 単体テスト等で uTime と uSpeed のみ直接設定された場合は連続フォールバック式を使用する
      bool hasAccumulatedPhase = (abs(scrollPhaseY) + abs(scrollPhaseX)) > 0.0001;
      float gravityVsWind = isSideGlass
        ? max(0.28, 0.85 - speedFactor * 0.42)
        : (isRearGlass ? (1.05 + speedFactor * 0.45) : (1.0 - speedFactor * 0.72 - aeroPressure * 1.55));
      float effScrollY = hasAccumulatedPhase ? scrollPhaseY : (time * gravityVsWind);
      float effScrollX = hasAccumulatedPhase
        ? scrollPhaseX
        : (time * (isSideGlass ? (speedFactor * 1.15 + aeroPressure * 0.65) : (speedFactor * 0.35 + aeroPressure * 0.75)));

      // 走行風圧による滑落・吹き上がり軌道の空間ワープ:
      // - フロントガラス: 中心 (p.x = 0.74m) から左右Aピラーへ向かって放射状に広がる気流ライン (radialX)
      // - サイドガラス: 車両前方 (p.x=0) から後方 (+p.x) へ高速スリップストリーム滑走
      // - リアガラス: ファストバックスロープに沿って下端へ滑落
      float radialX = (p.x - 0.74) / 0.74;
      float windLateralSlope = isSideGlass
        ? (-speedFactor * 0.52)
        : (isRearGlass ? ((p.x - 0.73) * speedFactor * 0.10) : (radialX * (0.14 + speedFactor * 0.28 + aeroPressure * 0.22)));
      float lateralStreamShift = isSideGlass
        ? (-effScrollX * 0.42)
        : (isRearGlass ? 0.0 : (-radialX * effScrollX * 0.22));

      // 水滴頭部と後続ビーズトレイルの向きを局所気流ベクトル (airflow.xy) に追従させる
      // 低速落下時 (flowDir ≈ (0, -1)) は頭部が下 (-Y)・トレイルが上 (+Y)、
      // 高速吹き上がり時 (flowDir ≈ (radialX, +1)) は頭部が上外側・トレイルが下内側、
      // サイドガラス高速時 (flowDir ≈ (+1, -0.2)) は頭部が後方 (+X)・トレイルが前方 (-X) へ伸びる
      vec2 flowDir = airflow.xy;
      vec2 flowPerp = vec2(-flowDir.y, flowDir.x);
      float aeroStretch = airflow.z;

      vec2 totalGrad = vec2(0.0);
      float totalMask = 0.0;

      // 2層の異なるスケールで滑落・吹き上がり水滴を合成し規則的なグリッド感を排除
      for (int layer = 0; layer < 2; layer++) {
        float layerF = float(layer);
        // 高速走行時は風圧ストリーク密度と長さを高めるためグリッドのアスペクトを調整
        vec2 scale = (layer == 0) ? vec2(38.0, 16.0) : vec2(56.0, 24.0);
        vec2 warpedP = p + vec2(windLateralSlope * p.y + lateralStreamShift + layerF * 0.37, layerF * 0.53);

        // カラム（列）ごとに独立した滑走速度と横揺れを与える
        float colId = floor(warpedP.x * scale.x);
        float colRand = hash21(vec2(colId, layerF * 19.7 + 3.1));

        // 十分な雨量または高速風圧ストリークがあるカラムのみ生成
        float colThreshold = (0.22 + colRand * 0.64) * clamp(1.0 - aeroPressure * 0.18, 0.65, 1.0);
        if (slidePresence > colThreshold) {
          float speedRate = 0.34 + colRand * 0.46;
          // 停車時 (effScrollY > 0増加) は p.y が減少する方向（下方向）へ移動し、
          // 高速時 (effScrollY < 0減少) は p.y が増加する方向（ルーフ上方向）へ吹き上がる
          float scrolledY = warpedP.y * scale.y + effScrollY * speedRate * 2.35 + colRand * 10.0;

          float rowId = floor(scrolledY);
          vec2 cellId = vec2(colId, rowId);
          vec2 cellRand = hash22(cellId + vec2(layerF * 11.3));

          vec2 gv = vec2(fract(warpedP.x * scale.x) - 0.5, fract(scrolledY) - 0.5);

          // 表面張力による不規則な蛇行 (Wobble): 低速時は大きく蛇行し、高速時は強い風圧で直線的なストリークに収束する
          float wobbleDamping = clamp(1.0 - speedFactor * 0.55, 0.25, 1.0);
          float wobbleFreq = 28.0 + speedFactor * 18.0;
          float wobble = sin(warpedP.y * wobbleFreq + cellRand.x * 6.28 + time * (1.5 + speedFactor * 6.0)) *
                         0.14 * (1.0 - cellRand.y * 0.5) * wobbleDamping;
          float dropX = (cellRand.x - 0.5) * 0.42 + wobble;
          // 気流の向き（落下 vs 吹き上がり）に応じてセル内の主水滴基準位置をオフセット
          float dropY = -0.16 * sign(flowDir.y != 0.0 ? -flowDir.y : 1.0);

          vec2 dDrop = gv - vec2(dropX, dropY);
          // セル内変位を局所気流座標系 (headCoord: 進行方向前方+, wakeCoord: 後流トレイル側+, crossCoord: 幅方向) へ射影
          // gv の Y 軸は scale.y で圧縮されているため、気流方向ベクトルと整合するよう異方性を補正
          vec2 wakeDir = normalize(vec2(-flowDir.x, -flowDir.y * 0.75));
          vec2 crossDir = vec2(-wakeDir.y, wakeDir.x);
          float alongWake = dot(dDrop, wakeDir);
          float crossWake = dot(dDrop, crossDir);

          // ティアドロップ形状（進行方向先端が丸く、風下後流側 alongWake > 0 が細長く伸びる）
          float headStretch = clamp(0.85 / mix(1.0, aeroStretch, 0.45), 0.38, 0.85);
          float shapeStretch = (alongWake > 0.0) ? (1.0 - min(alongWake, 0.38) * (1.35 + speedFactor * 0.35)) : 1.0;
          vec2 shapedDelta = vec2(
            crossWake / max(shapeStretch, 0.28),
            alongWake * headStretch
          );

          float radius = (0.12 + 0.05 * cellRand.y) * smoothstep(colThreshold, 1.0, slidePresence);
          float dist = length(shapedDelta);

          // 主水滴の凸レンズ勾配
          if (dist < radius) {
            float rNorm = dist / max(radius, 0.001);
            float dropMask = smoothstep(1.0, 0.72, rNorm);
            vec2 gradLocal = (shapedDelta / max(radius, 0.001)) * dropMask;
            vec2 grad = crossDir * gradLocal.x + wakeDir * gradLocal.y;
            totalGrad += grad * 1.25;
            totalMask = max(totalMask, dropMask);
          }

          // 水滴が通過した後（後流側 alongWake > 0）に残るビーズ状の細かな水滴トレイル＆高速風圧ストリーク
          // 高速走行時はトレイル長が伸び、細かな衛星水滴 (satellite micro-beads) と連続した風圧水筋を形成する
          float trailLen = clamp(0.56 + speedFactor * 0.22 + aeroPressure * 0.12, 0.56, 0.92);
          if (alongWake > 0.0 && alongWake < trailLen) {
            float trailFade = 1.0 - (alongWake / trailLen);
            float beadFreq = 46.0 + speedFactor * 22.0;
            float beadWave = 0.5 + 0.5 * cos(alongWake * beadFreq - time * (2.0 + speedFactor * 10.0) + cellRand.y * 6.28);
            // 高速になるほどビーズ間の途切れが繋がり、鋭い空力ウォーターストリークになる
            float streakContinuity = mix(beadWave, 0.65 + 0.35 * beadWave, clamp(speedFactor * 0.85, 0.0, 1.0));
            float trailWidth = (0.038 + 0.028 * beadWave) *
                               mix(1.0, 0.72, clamp(speedFactor, 0.0, 1.0)) *
                               trailFade *
                               smoothstep(colThreshold, 1.0, slidePresence);
            float trailDist = abs(crossWake);
            if (trailDist < trailWidth) {
              float tNorm = trailDist / max(trailWidth, 0.001);
              float beadMask = smoothstep(1.0, 0.35, tNorm) * streakContinuity * trailFade * (0.72 + 0.20 * clamp(speedFactor, 0.0, 1.0));
              vec2 trailGrad = crossDir * ((crossWake / max(trailWidth, 0.001)) * beadMask * 0.78) +
                               wakeDir * ((beadWave - 0.5) * beadMask * 0.42);
              totalGrad += trailGrad;
              totalMask = max(totalMask, beadMask * 0.68);
            }
          }
        }
      }

      return vec3(totalGrad, clamp(totalMask, 0.0, 1.0));
    }

    // 3. ワイパーの往復ストローク履歴に基づく扇形クリアリング & 水堤マスク計算
    // - ブレード通過直後は 100% クリアし、時間経過（strokeAge）に応じて微細な雨粒のみが再付着する
    float calculateWiperClearing(
      vec2 p,
      vec2 pivot,
      float currentAngle,
      float minAngle,
      float maxAngle,
      float rMin,
      float rMax,
      float wiperDir,
      float wiperSpeed,
      float clearingActive,
      out float wiperRidge,
      out float inSweptFan
    ) {
      vec2 d = p - pivot;
      float dist = length(d);
      float angle = atan(d.y, d.x);

      // ブレード有効半径 [rMin, rMax] と掃引角度範囲 [minAngle, maxAngle]
      float inRadius = smoothstep(rMin - 0.015, rMin + 0.012, dist) *
                       smoothstep(rMax + 0.015, rMax - 0.012, dist);
      float inAngle = smoothstep(minAngle - 0.025, minAngle + 0.012, angle) *
                      smoothstep(maxAngle + 0.025, maxAngle - 0.012, angle);
      inSweptFan = inRadius * inAngle;

      // ワイパーOFF時は払拭なし
      if (clearingActive <= 0.01) {
        wiperRidge = 0.0;
        return 0.0;
      }

      float span = max(0.001, maxAngle - minAngle);
      float normAngle = clamp((angle - minAngle) / span, 0.0, 1.0);
      float normBlade = clamp((currentAngle - minAngle) / span, 0.0, 1.0);

      // ブレードが現在の角度を通過してからの相対経過ストローク量 strokeAge in [0.0, 2.0]
      // strokeAge == 0.0: 今まさにブレードが通過した直後（水滴ゼロ）
      // strokeAge -> 2.0: 1往復前のストロークで拭かれてから次のブレードが到達する直前
      float strokeAge = 0.0;
      if (wiperDir >= 0.0) {
        // 往路（下 → 上へ掃引中）: ブレードより下側 (normAngle <= normBlade) が拭きたて
        strokeAge = (normAngle <= normBlade)
          ? (normBlade - normAngle)
          : (normAngle + normBlade);
      } else {
        // 復路（上 → 下へ掃引中）: ブレードより上側 (normAngle >= normBlade) が拭きたて
        strokeAge = (normAngle >= normBlade)
          ? (normAngle - normBlade)
          : ((1.0 - normAngle) + (1.0 - normBlade));
      }

      // ワイパー速度が速いほど次の払拭までの間に付着する雨粒量が少なくなる
      float speedScale = clamp(3.5 / max(wiperSpeed, 1.5), 0.45, 1.15);
      // 掃引扇形内部の基本水滴量を低く抑え（最大 0.24）、拭かれた扇形領域が明確にクリアに見え、
      // ブレードが通過するたびに残った小粒の水滴がスッと消えるように調整
      float regrownRatio = smoothstep(0.38, 1.95, strokeAge * speedScale) * 0.24;

      // ブレード直下は常に 100% 払拭
      float angleDiff = abs(angle - currentAngle);
      float bladeContact = smoothstep(0.055, 0.01, angleDiff) * inRadius;

      float cleared = max(inSweptFan * (1.0 - regrownRatio), bladeContact);

      // 水堤 (Water Ridge):
      // (A) 移動するゴムブレードの進行方向先端で押し集められる水筋
      float signedLead = (angle - currentAngle) * (wiperDir >= 0.0 ? 1.0 : -1.0);
      float leadingWave = smoothstep(0.052, 0.006, signedLead) * step(0.0, signedLead) * inRadius;
      // (B) 扇形外周アーク境界および上端折り返しラインに残る水の縁
      float outerArcRidge = smoothstep(0.020, 0.0, abs(dist - rMax)) * inAngle * 0.82;
      float topReverseRidge = smoothstep(0.030, 0.0, abs(angle - maxAngle)) * inRadius * 0.78;

      wiperRidge = clamp(leadingWave * 0.95 + outerArcRidge + topReverseRidge, 0.0, 1.0);

      return clamp(cleared, 0.0, 1.0);
    }

    void main() {
      // 各ガラス種別の実寸座標系 (m)
      vec2 glassSize = getGlassPhysicalSize(uGlassType);
      vec2 p = vUv * glassSize;

      bool isWindshield = (uGlassType < 0.5);
      bool isSideGlass = (uGlassType > 0.5 && uGlassType < 1.5);
      bool isRearGlass = (uGlassType >= 1.5);

      // 非降雨時（uRainIntensity <= 0.01）はワイパー・水滴・ミスト・ボケ計算を完全スキップして早期リターン
      if (uRainIntensity <= 0.01) {
        vec3 dryViewDir = normalize(cameraPosition - vWorldPosition);
        vec3 dryNormal = normalize(vWorldNormal);
        float dryFresnel = pow(1.0 - max(0.0, dot(dryViewDir, dryNormal)), 3.2);
        vec4 dryGlassBase = isSideGlass
          ? vec4(0.018, 0.044, 0.056, 0.068)
          : (isRearGlass ? vec4(0.016, 0.028, 0.042, 0.115) : vec4(0.015, 0.032, 0.052, 0.042));
        float dryReflectScale = isSideGlass ? 0.30 : (isRearGlass ? 0.32 : 0.24);
        vec3 dryGlassColor = dryGlassBase.rgb + mix(uEnvSkyColor, vec3(0.75, 0.86, 0.96), 0.45) * dryFresnel * dryReflectScale;
        float dryDefoggerAlpha = 0.0;
        if (isRearGlass) {
          float inHeaterBand = smoothstep(0.06, 0.09, vUv.y) * smoothstep(0.94, 0.91, vUv.y) *
                               smoothstep(0.03, 0.05, vUv.x) * smoothstep(0.97, 0.95, vUv.x);
          float heaterWave = abs(fract(vUv.y * 14.0) - 0.5);
          float heaterLine = (1.0 - smoothstep(0.0, 0.045, heaterWave)) * inHeaterBand;
          float busBar = (smoothstep(0.042, 0.034, abs(vUv.x - 0.04)) + smoothstep(0.042, 0.034, abs(vUv.x - 0.96))) *
                         smoothstep(0.06, 0.09, vUv.y) * smoothstep(0.94, 0.91, vUv.y);
          float heaterMask = clamp(heaterLine * 0.65 + busBar * 0.75, 0.0, 1.0);
          vec3 copperHeaterColor = vec3(0.46, 0.28, 0.16) + uSunColor * 0.12;
          dryGlassColor = mix(dryGlassColor, copperHeaterColor, heaterMask * 0.55);
          dryDefoggerAlpha = heaterMask * 0.14;
        }
        float dryAlpha = clamp(dryGlassBase.a + dryDefoggerAlpha + dryFresnel * 0.12, 0.04, 0.55);
        gl_FragColor = vec4(dryGlassColor, dryAlpha);
        return;
      }

      float totalWiped = 0.0;
      float totalRidge = 0.0;
      float unwipedFactor = 0.42;
      float bladeContactMask = 0.0;

      if (isWindshield) {
        // 日本の右ハンドル車 (JDM RHD) の 3D ワイパーモデルと完全一致するピボット位置・ブレード半径・掃引角度
        // 運転席 (p.x = 0.36m) の正面視界を上端 p.y = 0.85m (ガラス高の90%) までワイドにカバー
        vec2 pivotDriver = vec2(0.16, 0.02);
        vec2 pivotPassenger = vec2(0.80, 0.02);

        float ridge1 = 0.0;
        float ridge2 = 0.0;
        float fan1 = 0.0;
        float fan2 = 0.0;

        float wipe1 = calculateWiperClearing(
          p,
          pivotDriver,
          uWiperAngle1,
          0.08,
          1.62,
          0.08,
          0.86,
          uWiperDir,
          uWiperSpeed,
          uWiperClearing,
          ridge1,
          fan1
        );
        float wipe2 = calculateWiperClearing(
          p,
          pivotPassenger,
          uWiperAngle2,
          0.08,
          1.56,
          0.08,
          0.66,
          uWiperDir,
          uWiperSpeed,
          uWiperClearing,
          ridge2,
          fan2
        );

        // ブレード接触直下〜通過直後の極近傍マスク（高速走行時の風圧雨筋もブレード通過瞬間は拭き取るため）
        vec2 d1 = p - pivotDriver;
        vec2 d2 = p - pivotPassenger;
        float contact1 = smoothstep(0.095, 0.015, abs(atan(d1.y, d1.x) - uWiperAngle1)) * fan1;
        float contact2 = smoothstep(0.095, 0.015, abs(atan(d2.y, d2.x) - uWiperAngle2)) * fan2;
        bladeContactMask = clamp(max(contact1, contact2) * uWiperClearing, 0.0, 1.0);

        // 助手席側の外周水堤のうち、運転席ワイパーの掃引域に入る部分は運転席ワイパーで拭き取る
        ridge2 *= (1.0 - wipe1 * 0.85);

        totalWiped = clamp(max(wipe1, wipe2), 0.0, 1.0);
        totalRidge = clamp(ridge1 + ridge2, 0.0, 1.0);
        float inAnySweptFan = clamp(max(fan1, fan2), 0.0, 1.0);
        unwipedFactor = 1.0 - inAnySweptFan * uWiperClearing;
      }

      // 局所的な残存雨滴量（フロントはワイパー払拭連動、サイド・リアは自然な着水密度）
      float glassRainScale = isSideGlass ? 0.82 : (isRearGlass ? 0.88 : 1.0);
      float effectiveRain = uRainIntensity * glassRainScale * (1.0 - totalWiped * uWiperClearing) +
                            totalRidge * uRainIntensity * 0.65;
      effectiveRain = clamp(effectiveRain, 0.0, 1.5);

      vec3 viewDir = normalize(vViewPosition);
      vec3 normal = normalize(vWorldNormal);

      vec2 dropGrad = vec2(0.0);
      float dropMask = 0.0;

      // 雨が降っている場合の水滴生成（局所残存雨量 effectiveRain または高速走行風ストリークに連動）
      float speedKmh = max(0.0, uSpeed);
      if (uRainIntensity > 0.01 && (effectiveRain > 0.01 || speedKmh > 32.0)) {
        float speedFactor = clamp(speedKmh / 100.0, 0.0, 1.5);
        vec4 localAirflow = computeLocalAirflowVector(p, speedKmh, uGlassType);

        // A. 着水雨滴 & ミスト（走行速度に応じた空力ティアドロップ伸長・風圧微振動・小粒吹き飛び連動）
        vec3 staticDrops = (effectiveRain > 0.01)
          ? calculateStaticMist(p, effectiveRain, unwipedFactor, uTime, speedKmh, localAirflow)
          : vec3(0.0);
        // B. 重力・走行風で滑落／高速吹き上がりするティアドロップ & 空力ウォーターストリーク
        vec3 slidingDrops = calculateSlidingDrops(
          p,
          uTime,
          speedKmh,
          speedFactor,
          uWindScrollY,
          uWindScrollX,
          effectiveRain,
          uRainIntensity * glassRainScale,
          bladeContactMask,
          uGlassType,
          localAirflow
        );

        dropGrad = staticDrops.xy + slidingDrops.xy;
        dropMask = clamp(max(staticDrops.z, slidingDrops.z), 0.0, 1.0);

        // 水堤 (Water Ridge) のレンズ盛り上がりを合成
        if (totalRidge > 0.01) {
          float ridgeAmt = totalRidge * uRainIntensity;
          dropGrad += vec2(0.35, 0.45) * ridgeAmt;
          dropMask = max(dropMask, ridgeAmt * 0.72);
        }

        vec3 combinedDrops = normalize(vec3(dropGrad, 1.0));
        normal = normalize(normal + combinedDrops * dropMask * 0.55);
      }

      // フレネル反射率（ガラス基材）
      float fresnel = pow(1.0 - max(0.0, dot(viewDir, normal)), 3.2);

      // ガラス種別ごとの基本トーン（フロント: 高透明UVカットガラス、サイド: JDMグリーンティント、リア: プライバシースモーク）
      vec4 glassBase = isSideGlass
        ? vec4(0.018, 0.044, 0.056, 0.068)
        : (isRearGlass ? vec4(0.016, 0.028, 0.042, 0.115) : vec4(0.015, 0.032, 0.052, 0.042));
      float fresnelReflectScale = isSideGlass ? 0.30 : (isRearGlass ? 0.32 : 0.24);
      vec3 glassColor = glassBase.rgb + mix(uEnvSkyColor, vec3(0.75, 0.86, 0.96), 0.45) * fresnel * fresnelReflectScale;

      // リアガラス専用の熱線デフォッガー（水平ヒータープリント線 + 左右バスバー + セラミック黒縁フリット）
      float defoggerAlpha = 0.0;
      if (isRearGlass) {
        float inHeaterBand = smoothstep(0.06, 0.09, vUv.y) * smoothstep(0.94, 0.91, vUv.y) *
                             smoothstep(0.03, 0.05, vUv.x) * smoothstep(0.97, 0.95, vUv.x);
        float heaterWave = abs(fract(vUv.y * 14.0) - 0.5);
        float heaterLine = (1.0 - smoothstep(0.0, 0.045, heaterWave)) * inHeaterBand;
        float busBar = (smoothstep(0.042, 0.034, abs(vUv.x - 0.04)) + smoothstep(0.042, 0.034, abs(vUv.x - 0.96))) *
                       smoothstep(0.06, 0.09, vUv.y) * smoothstep(0.94, 0.91, vUv.y);
        float heaterMask = clamp(heaterLine * 0.65 + busBar * 0.75, 0.0, 1.0);
        vec3 copperHeaterColor = vec3(0.46, 0.28, 0.16) + uSunColor * 0.12;
        glassColor = mix(glassColor, copperHeaterColor, heaterMask * 0.55);
        defoggerAlpha = heaterMask * 0.14;
      }

      // 水滴の物理光学屈折・メニスカス全反射リム・コースティクス・都市ボケハイライト計算
      // Why not: 固定の青灰色グラデーションを dropMask * 0.78 で不透明合成すると「灰色のプラスチック粒がガラスに貼られている」ように見えるため、
      // 水滴内部の中心部は高透明に保って背後の景色を透かしつつ、輪郭のメニスカス全反射とコースティクス、環境光屈折のみで立体感を出す。
      float gradLen = length(dropGrad);

      // 凸レンズ屈折により水滴の下半分は上方の空色 (uEnvSkyColor / uSunColor) を集光し、上半分は濡れた路面色 (uEnvGroundColor) を映す
      float lensTilt = clamp(-dropGrad.y * 0.95 + 0.5, 0.0, 1.0);
      vec3 skyRefract = mix(uEnvSkyColor, uSunColor, 0.28 + (1.0 - uNightFactor) * 0.18);
      vec3 groundRefract = mix(uEnvGroundColor, uEnvSkyColor * 0.28, 0.35);

      // 夜間・夕暮れ時の丸の内街灯（アンバー）・信号・先行車テールランプ（レッド）の微細な屈折ボケ彩度
      float bokehCell = hash21(floor(p * 34.0) + floor(uTime * 0.5) * 0.0);
      vec3 cityBokehColor = mix(
        vec3(1.0, 0.68, 0.28),
        vec3(1.0, 0.22, 0.26),
        step(0.68, bokehCell)
      );
      skyRefract += cityBokehColor * uNightFactor * smoothstep(0.35, 0.85, gradLen) * 0.42;

      vec3 refractedEnv = mix(groundRefract, skyRefract, smoothstep(0.15, 0.85, lensTilt));

      // 水滴外周のメニスカス暗縁（全反射リム）と内側の明るいコースティクス集光リング
      float meniscusDarkRim = smoothstep(0.58, 0.96, gradLen) * (1.0 - smoothstep(0.96, 1.38, gradLen));
      float innerCaustic = smoothstep(0.18, 0.56, gradLen) * (1.0 - smoothstep(0.56, 0.88, gradLen)) * lensTilt;

      refractedEnv = mix(refractedEnv, groundRefract * 0.32, meniscusDarkRim * 0.55);
      refractedEnv += (skyRefract * 0.75 + vec3(0.22, 0.26, 0.30)) * innerCaustic * 0.65;

      // 太陽・空光・街灯の鋭いピンポイントスペキュラハイライト
      vec3 lightDir1 = normalize(vec3(0.25, 0.85, 0.45));
      vec3 lightDir2 = normalize(vec3(-0.40, 0.65, 0.65));
      vec3 dropNormalLocal = normalize(vec3(dropGrad * 1.85, 1.0));
      float spec1 = pow(max(0.0, dot(dropNormalLocal, lightDir1)), 48.0);
      float spec2 = pow(max(0.0, dot(dropNormalLocal, lightDir2)), 28.0) * 0.65;
      float highlight = (spec1 + spec2) * dropMask;
      vec3 specTint = mix(vec3(0.96, 0.99, 1.0), uSunColor + vec3(0.35), 0.35);
      vec4 highlightColor = vec4(specTint, 1.0) * highlight;

      // ワイパー通過直後の極薄水膜シア（ブレードが水を切って過ぎた直後の繊細な光学シマー）
      float wetFilmSheen = totalRidge * uRainIntensity * 0.28;

      // 水滴中心部は背後が透けるようアルファを抑え、輪郭リムとハイライトでクリスタルのような透明水滴を表現
      float opticalEdgeWeight = clamp(meniscusDarkRim * 0.75 + innerCaustic * 0.55 + dropMask * 0.24 + wetFilmSheen, 0.0, 0.82);
      vec3 finalRgb = mix(glassColor, refractedEnv, opticalEdgeWeight) + highlightColor.rgb * 1.15;
      float finalAlpha = clamp(
        glassBase.a + defoggerAlpha + fresnel * 0.12 + dropMask * 0.16 + meniscusDarkRim * 0.28 + innerCaustic * 0.18 + wetFilmSheen * 0.22 + highlight * 0.48,
        0.04,
        0.78
      );

      gl_FragColor = vec4(finalRgb, finalAlpha);
    }
  `;

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  return material;
}

export function createSideWindowMaterial(): THREE.ShaderMaterial {
  return createWindshieldMaterial("side");
}

export function createRearWindowMaterial(): THREE.ShaderMaterial {
  return createWindshieldMaterial("rear");
}

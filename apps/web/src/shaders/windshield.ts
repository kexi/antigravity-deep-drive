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

export interface WindshieldUniforms {
  [key: string]: THREE.IUniform;
  uTime: { value: number };
  uRainIntensity: { value: number };
  uSpeed: { value: number };
  uWiperAngle1: { value: number };
  uWiperAngle2: { value: number };
  uWiperClearing: { value: number };
  uWiperDir: { value: number };
  uWiperSpeed: { value: number };
  uEnvMap: { value: THREE.Texture | null };
}

export function createWindshieldMaterial(): THREE.ShaderMaterial {
  const uniforms: WindshieldUniforms = {
    uTime: { value: 0.0 },
    uRainIntensity: { value: 0.0 },
    uSpeed: { value: 0.0 },
    uWiperAngle1: { value: 0.08 },
    uWiperAngle2: { value: 0.08 },
    uWiperClearing: { value: 1.0 },
    uWiperDir: { value: 1.0 },
    uWiperSpeed: { value: 3.5 },
    uEnvMap: { value: null },
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
    uniform float uWiperAngle1;
    uniform float uWiperAngle2;
    uniform float uWiperClearing;
    uniform float uWiperDir;
    uniform float uWiperSpeed;

    varying vec2 vUv;
    varying vec3 vWorldNormal;
    varying vec3 vWorldPosition;
    varying vec3 vViewPosition;

    // フロントガラス実寸（横幅 1.48m × 斜面長 0.965m）
    const vec2 GLASS_SIZE = vec2(1.48, 0.965);

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

    // 1. 静止・着水雨滴層 (Landed Droplets & Unwiped Micro Mist)
    // 戻り値: xy = 水滴のレンズ法線勾配, z = 水滴マスク (0.0 = 透明ガラス, 1.0 = 水滴内部)
    vec3 calculateStaticMist(vec2 p, float localRain, float unwipedFactor, float time) {
      vec2 totalGrad = vec2(0.0);
      float totalMask = 0.0;

      // レイヤー 1A: 中粒の着水雨滴（実寸フロントガラス上で繊細に見える高精細グリッド）
      {
        vec2 grid = p * 68.0;
        vec2 id = floor(grid);
        vec2 gv = fract(grid) - 0.5;
        vec2 rand = hash22(id);

        // 各セルの水滴が着水する閾値（払拭直後 localRain≈0 では 0 粒、時間経過とともに1粒ずつ出現）
        float birthThreshold = 0.08 + rand.x * 0.84;
        float dropLife = clamp((localRain - birthThreshold) * 3.2, 0.0, 1.0);

        // 時間による微細な着水明滅（雨粒の入れ替わり）
        float timeCycle = fract(time * (0.14 + rand.y * 0.20) + rand.x * 3.7);
        float lifeEnvelope = smoothstep(0.0, 0.15, timeCycle) * smoothstep(1.0, 0.82, timeCycle);
        float activeDrop = dropLife * (0.65 + 0.35 * lifeEnvelope);

        if (activeDrop > 0.01) {
          vec2 offset = (rand - 0.5) * 0.58;
          vec2 delta = gv - offset;
          // 重力によるわずかな縦長ティアドロップ変形
          delta.y *= 0.84;

          float radius = (0.11 + 0.13 * rand.y) * (0.45 + 0.55 * sqrt(activeDrop));
          float dist = length(delta);

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
          float radius = (0.10 + 0.12 * rand.y) * sqrt(dropLife);
          float dist = length(delta);

          if (dist < radius) {
            float rNorm = dist / max(radius, 0.001);
            float edgeSoft = smoothstep(1.0, 0.72, rNorm);
            vec2 grad = (delta / max(radius, 0.001)) * edgeSoft;
            totalGrad += grad * 0.82;
            totalMask = max(totalMask, edgeSoft * 0.82);
          }
        }
      }

      // レイヤー 1C: ワイパー払拭域外の細かい結露ミスト（扇形境界の外側に密集し、拭かれた領域とのコントラストを強調）
      float mistIntensity = unwipedFactor * clamp(localRain * 1.1, 0.0, 1.0);
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

    // 2. 動的滑落水滴 & ビーズ状雨筋トレイル層 (Sliding Teardrops & Beaded Trails)
    // 戻り値: xy = 滑落水滴のレンズ法線勾配, z = 水滴マスク
    vec3 calculateSlidingDrops(vec2 p, float time, float speedFactor, float localRain) {
      // ワイパーで拭かれている扇形内部 (localRain <= 0.24) は滑落水滴を消去しクリアな前方視界を保つ
      float slidePresence = smoothstep(0.22, 0.72, localRain);
      if (slidePresence <= 0.005) {
        return vec3(0.0);
      }

      // 走行風圧による滑落方向の変調:
      // 停車〜低速時は重力で真下 (-Y) へ滑り落ち、高速時は風圧で斜め外側・上方へ押し流される
      float windLateral = (p.x - 0.74) * speedFactor * 0.22;
      float gravityVsWind = 1.0 - speedFactor * 0.65;

      vec2 totalGrad = vec2(0.0);
      float totalMask = 0.0;

      // 2層の異なるスケールで滑落水滴を合成し規則的なグリッド感を排除
      for (int layer = 0; layer < 2; layer++) {
        float layerF = float(layer);
        vec2 scale = (layer == 0) ? vec2(38.0, 16.0) : vec2(56.0, 24.0);
        vec2 warpedP = p + vec2(windLateral * p.y + layerF * 0.37, layerF * 0.53);

        // カラム（縦列）ごとに独立した落下速度と横揺れを与える
        float colId = floor(warpedP.x * scale.x);
        float colRand = hash21(vec2(colId, layerF * 19.7 + 3.1));

        // 十分な雨量があるカラムのみ滑落水滴を生成
        float colThreshold = 0.24 + colRand * 0.66;
        if (slidePresence > colThreshold) {
          float fallRate = (0.32 + colRand * 0.45) * gravityVsWind;
          // 停車時 (gravityVsWind > 0) は +time で p.y が減少する方向（下方向）へ移動するよう座標を加算
          float scrolledY = warpedP.y * scale.y + time * fallRate * 2.2 + colRand * 10.0;

          float rowId = floor(scrolledY);
          vec2 cellId = vec2(colId, rowId);
          vec2 cellRand = hash22(cellId + vec2(layerF * 11.3));

          vec2 gv = vec2(fract(warpedP.x * scale.x) - 0.5, fract(scrolledY) - 0.5);

          // 表面張力による不規則な蛇行 (Wobble)
          float wobble = sin(warpedP.y * 28.0 + cellRand.x * 6.28) * 0.14 * (1.0 - cellRand.y * 0.5);
          float dropX = (cellRand.x - 0.5) * 0.44 + wobble;
          // セル内の中央付近に主水滴を配置
          float dropY = -0.18;

          vec2 dDrop = gv - vec2(dropX, dropY);
          // ティアドロップ形状（下端が丸く、上端が細く伸びる水滴）
          float shapeStretch = (dDrop.y > 0.0) ? (1.0 - min(dDrop.y, 0.35) * 1.4) : 1.0;
          vec2 shapedDelta = vec2(dDrop.x / max(shapeStretch, 0.35), dDrop.y * 0.85);

          float radius = (0.12 + 0.05 * cellRand.y) * smoothstep(colThreshold, 1.0, slidePresence);
          float dist = length(shapedDelta);

          // 主水滴の凸レンズ勾配
          if (dist < radius) {
            float rNorm = dist / max(radius, 0.001);
            float dropMask = smoothstep(1.0, 0.72, rNorm);
            vec2 grad = (shapedDelta / max(radius, 0.001)) * dropMask;
            totalGrad += grad * 1.25;
            totalMask = max(totalMask, dropMask);
          }

          // 水滴が滑り落ちた後（上方 gv.y > dropY）に残るビーズ状の細かな水滴トレイル
          float trailLen = 0.62;
          float alongTrail = gv.y - dropY;
          if (alongTrail > 0.0 && alongTrail < trailLen) {
            float trailFade = 1.0 - (alongTrail / trailLen);
            float beadWave = 0.5 + 0.5 * cos(alongTrail * 48.0 + cellRand.y * 6.28);
            float trailWidth = (0.04 + 0.03 * beadWave) * trailFade * smoothstep(colThreshold, 1.0, slidePresence);
            float trailDist = abs(gv.x - dropX);
            if (trailDist < trailWidth) {
              float tNorm = trailDist / max(trailWidth, 0.001);
              float beadMask = smoothstep(1.0, 0.4, tNorm) * beadWave * trailFade * 0.72;
              totalGrad.x += ((gv.x - dropX) / max(trailWidth, 0.001)) * beadMask * 0.75;
              totalGrad.y += (beadWave - 0.5) * beadMask * 0.38;
              totalMask = max(totalMask, beadMask * 0.65);
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
      // フロントガラス実寸座標系 (m):
      // p.x: 0.0 (右ハンドル運転席側Aピラー端 x=-0.74m) -> 1.48 (助手席側Aピラー端 x=+0.74m)
      // p.y: 0.0 (下端カウル) -> 0.965 (上端ルーフ縁)
      vec2 p = vUv * GLASS_SIZE;

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

      // 助手席側の外周水堤のうち、運転席ワイパーの掃引域に入る部分は運転席ワイパーで拭き取る
      ridge2 *= (1.0 - wipe1 * 0.85);

      float totalWiped = clamp(max(wipe1, wipe2), 0.0, 1.0);
      float totalRidge = clamp(ridge1 + ridge2, 0.0, 1.0);
      float inAnySweptFan = clamp(max(fan1, fan2), 0.0, 1.0);
      float unwipedFactor = 1.0 - inAnySweptFan * uWiperClearing;

      // ワイパー払拭後の局所的な残存雨滴量（拭きたての領域は 0.0、徐々に新しい雨粒が着水）
      float effectiveRain = uRainIntensity * (1.0 - totalWiped * uWiperClearing) +
                            totalRidge * uRainIntensity * 0.65;
      effectiveRain = clamp(effectiveRain, 0.0, 1.5);

      vec3 viewDir = normalize(vViewPosition);
      vec3 normal = normalize(vWorldNormal);

      vec2 dropGrad = vec2(0.0);
      float dropMask = 0.0;

      // 雨が降っている場合の水滴生成（局所残存雨量 effectiveRain に完全連動）
      if (uRainIntensity > 0.01 && effectiveRain > 0.01) {
        float speedFactor = clamp(uSpeed * 0.018, 0.0, 1.35);

        // A. 着水雨滴 & 払拭域外ミスト
        vec3 staticDrops = calculateStaticMist(p, effectiveRain, unwipedFactor, uTime);
        // B. 重力・風圧で滑落するティアドロップ & ビーズ状雨筋
        vec3 slidingDrops = calculateSlidingDrops(p, uTime, speedFactor, effectiveRain);

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
      float fresnel = pow(1.0 - max(0.0, dot(viewDir, normal)), 3.5);

      // フロントガラス基本トーン（水滴がない場所はクリアで高い透過性を維持）
      vec4 glassBase = vec4(0.02, 0.045, 0.075, 0.065);
      vec3 glassColor = glassBase.rgb + vec3(0.65, 0.80, 0.95) * fresnel * 0.35;

      // 水滴の光学屈折・メニスカス縁・スペキュラハイライト計算
      float gradLen = length(dropGrad);
      // 凸レンズ屈折により水滴の下半分は明るい空色を、上半分は暗い路面色を映す
      float lensTilt = clamp(-dropGrad.y * 0.85 + 0.5, 0.0, 1.0);
      vec3 refractedEnv = mix(vec3(0.10, 0.15, 0.22), vec3(0.82, 0.90, 0.98), lensTilt);

      // 水滴外周のメニスカス暗縁（全反射リム）と内側のコースティクス明帯
      float meniscusRim = smoothstep(0.35, 0.95, gradLen) * (1.0 - smoothstep(0.95, 1.35, gradLen));
      refractedEnv = mix(refractedEnv, vec3(0.06, 0.10, 0.16), meniscusRim * 0.45);

      // 街灯・空光の鋭いピンポイントスペキュラハイライト
      vec3 lightDir1 = normalize(vec3(0.25, 0.85, 0.45));
      vec3 lightDir2 = normalize(vec3(-0.40, 0.65, 0.65));
      vec3 dropNormalLocal = normalize(vec3(dropGrad * 1.6, 1.0));
      float spec1 = pow(max(0.0, dot(dropNormalLocal, lightDir1)), 36.0);
      float spec2 = pow(max(0.0, dot(dropNormalLocal, lightDir2)), 24.0) * 0.6;
      float highlight = (spec1 + spec2) * dropMask;
      vec4 highlightColor = vec4(0.95, 0.98, 1.0, 1.0) * highlight;

      // ガラス色と水滴屈折色の合成（水滴があるピクセルのみ不透明度を上げ、拭かれたガラス面はクリアに保つ）
      vec3 finalRgb = mix(glassColor, refractedEnv, dropMask * 0.78) + highlightColor.rgb;
      float finalAlpha = clamp(
        glassBase.a + fresnel * 0.14 + dropMask * 0.58 + highlight * 0.35,
        0.06,
        0.86
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

import * as THREE from "three";

/**
 * 日本の道路標識ジェネレーター
 * 「道路標識、区画線及び道路標示に関する命令」（道路標識令）準拠
 * - 案内標識（大型青看板：方面・方向・路線名・英語併記）
 * - 規制標識（最高速度、止まれ、進入禁止、指定方向外進行禁止、転回禁止）
 * - 警戒標識（信号機あり、交差点あり）
 * - 指示標識（横断歩道）
 * - 道路の通称名標識（行幸通り、日比谷通り等）
 */
export class JapaneseRoadSigns {
  private poleMat: THREE.MeshStandardMaterial;
  private signBackMat: THREE.MeshStandardMaterial;

  constructor() {
    this.poleMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8, // 溶融亜鉛めっき鋼管・アルミニウムグレー
      metalness: 0.8,
      roughness: 0.35,
    });
    this.signBackMat = new THREE.MeshStandardMaterial({
      color: 0x64748b, // 標識裏面のグレー防錆塗装
      metalness: 0.5,
      roughness: 0.6,
    });
  }

  /**
   * 1. 案内標識（オーバーヘッド大型青看板・F型/門型トラス支柱）
   * 日本の幹線道路交差点手前に設置される代表的な方面案内標識（108-A系）
   */
  public createOverheadGuideSign(
    x: number,
    z: number,
    options: {
      straightText?: string;
      straightEn?: string;
      leftText?: string;
      leftEn?: string;
      rightText?: string;
      rightEn?: string;
      roadNumber?: string;
      spanWidth?: number;
    } = {},
  ): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const span = options.spanWidth ?? 12.0;

    // F型/門型 支柱（高さ7.2m、上部オーバーハングビーム）
    const columnGeo = new THREE.CylinderGeometry(0.18, 0.22, 7.5, 16);
    const column = new THREE.Mesh(columnGeo, this.poleMat);
    column.position.set(-span / 2, 3.75, 0);
    column.castShadow = true;
    group.add(column);

    // 水平梁（トラス構造を模した上部ビーム）
    const beamGeo = new THREE.BoxGeometry(span, 0.35, 0.35);
    const beam = new THREE.Mesh(beamGeo, this.poleMat);
    beam.position.set(0, 7.0, 0);
    group.add(beam);

    const beamLowerGeo = new THREE.BoxGeometry(span, 0.25, 0.25);
    const beamLower = new THREE.Mesh(beamLowerGeo, this.poleMat);
    beamLower.position.set(0, 5.0, 0);
    group.add(beamLower);

    // 看板本体（横4.2m, 縦2.4m, 厚み0.12m）
    const signBoardWidth = 4.4;
    const signBoardHeight = 2.4;
    const boardGeo = new THREE.BoxGeometry(signBoardWidth, signBoardHeight, 0.1);
    const boardMesh = new THREE.Mesh(boardGeo, this.signBackMat);
    boardMesh.position.set(0, 6.0, 0.12);
    group.add(boardMesh);

    // 表面青看板グラフィック
    const hasDocument = typeof document !== "undefined";
    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 1024;
      canvas.height = 512;
      const ctx = canvas.getContext("2d");
      const hasCtx = Boolean(ctx);
      if (hasCtx) {
        // 日本標準の標識青（RGB: 0, 70, 150）
        ctx!.fillStyle = "#00428a";
        ctx!.fillRect(0, 0, 1024, 512);

        // 外枠の白線
        ctx!.strokeStyle = "#ffffff";
        ctx!.lineWidth = 14;
        ctx!.strokeRect(16, 16, 992, 480);

        // 区切り線
        ctx!.beginPath();
        ctx!.moveTo(512, 32);
        ctx!.lineTo(512, 480);
        ctx!.stroke();

        ctx!.fillStyle = "#ffffff";
        ctx!.textAlign = "center";

        // 直進 / 皇居・日比谷 方面（左半分）
        const straightJa = options.straightText ?? "皇居　日比谷";
        const straightEn = options.straightEn ?? "Imperial Palace / Hibiya";
        ctx!.font = "bold 54px sans-serif";
        ctx!.fillText(straightJa, 256, 140);
        ctx!.font = "bold 28px sans-serif";
        ctx!.fillText(straightEn, 256, 195);

        // 直進上向き矢印
        this.drawArrow(ctx!, 256, 380, 256, 250, "#ffffff");

        // 国道・都道番号バッジ（おにぎり・ヘキサゴン調）
        const routeNum = options.roadNumber ?? "1";
        this.drawRouteBadge(ctx!, 256, 70, routeNum);

        // 右折 / 東京駅・銀座 方面（右半分）
        const rightJa = options.rightText ?? "東京駅　銀座";
        const rightEn = options.rightEn ?? "Tokyo Sta. / Ginza";
        ctx!.font = "bold 54px sans-serif";
        ctx!.fillText(rightJa, 768, 140);
        ctx!.font = "bold 28px sans-serif";
        ctx!.fillText(rightEn, 768, 195);

        // 右折矢印（鍵型矢印）
        this.drawTurnArrow(ctx!, 720, 380, 840, 300, "#ffffff");
      }

      const signTex = new THREE.CanvasTexture(canvas);
      signTex.colorSpace = THREE.SRGBColorSpace;
      const frontMat = new THREE.MeshStandardMaterial({
        map: signTex,
        roughness: 0.4,
        metalness: 0.1,
      });

      const frontGeo = new THREE.PlaneGeometry(signBoardWidth * 0.98, signBoardHeight * 0.98);
      const frontMesh = new THREE.Mesh(frontGeo, frontMat);
      frontMesh.position.set(0, 6.0, 0.18);
      group.add(frontMesh);

      // 反対車線側からも視認できるよう背面にも案内板を配置
      const backSignMesh = new THREE.Mesh(frontGeo, frontMat);
      backSignMesh.position.set(0, 6.0, 0.06);
      backSignMesh.rotation.y = Math.PI;
      group.add(backSignMesh);
    }

    // 看板上部の外照式照明ランプ（2基）
    const lampArmGeo = new THREE.BoxGeometry(0.08, 0.08, 0.65);
    const lampHoodGeo = new THREE.BoxGeometry(0.85, 0.1, 0.28);
    const lampGlowMat = new THREE.MeshBasicMaterial({ color: 0xfef9c3 });
    for (const lampX of [-1.1, 1.1]) {
      const arm = new THREE.Mesh(lampArmGeo, this.poleMat);
      arm.position.set(lampX, 7.25, 0.35);
      group.add(arm);

      const hood = new THREE.Mesh(lampHoodGeo, this.poleMat);
      hood.position.set(lampX, 7.25, 0.65);
      group.add(hood);

      const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.18), lampGlowMat);
      glow.rotation.x = Math.PI / 2;
      glow.position.set(lampX, 7.19, 0.65);
      group.add(glow);
    }

    return group;
  }

  /**
   * 2. 規制標識: 「止まれ / STOP」（330: 赤色逆三角形）
   */
  public createStopSign(x: number, z: number): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    // 支柱
    const pole = this.createPoleMesh(3.6);
    group.add(pole);

    // 逆三角形標識板
    const signGroup = new THREE.Group();
    signGroup.position.set(0, 3.2, 0);

    const hasDocument = typeof document !== "undefined";
    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 444; // 三角比率 (sqrt(3)/2)
      const ctx = canvas.getContext("2d");
      const hasCtx = Boolean(ctx);
      if (hasCtx) {
        // 赤地逆三角形
        ctx!.fillStyle = "#dc2626";
        ctx!.beginPath();
        ctx!.moveTo(16, 20);
        ctx!.lineTo(496, 20);
        ctx!.lineTo(256, 424);
        ctx!.closePath();
        ctx!.fill();

        // 白フチ線
        ctx!.strokeStyle = "#ffffff";
        ctx!.lineWidth = 16;
        ctx!.stroke();

        // 文字「止まれ」 & 「STOP」
        ctx!.fillStyle = "#ffffff";
        ctx!.textAlign = "center";
        ctx!.font = "bold 96px sans-serif";
        ctx!.fillText("止まれ", 256, 175);
        ctx!.font = "bold 64px sans-serif";
        ctx!.fillText("STOP", 256, 280);
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.5 });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.74), mat);
      plane.position.z = 0.02;
      signGroup.add(plane);
    }

    // 裏板
    const backGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.02, 3);
    backGeo.rotateX(Math.PI / 2);
    backGeo.rotateZ(Math.PI);
    const back = new THREE.Mesh(backGeo, this.signBackMat);
    signGroup.add(back);

    group.add(signGroup);
    return group;
  }

  /**
   * 3. 規制標識: 「車両進入禁止」（303: 赤丸に白横バー）
   */
  public createNoEntrySign(x: number, z: number): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const pole = this.createPoleMesh(3.6);
    group.add(pole);

    const signGroup = new THREE.Group();
    signGroup.position.set(0, 3.2, 0);

    const hasDocument = typeof document !== "undefined";
    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext("2d");
      const hasCtx = Boolean(ctx);
      if (hasCtx) {
        // 赤丸
        ctx!.fillStyle = "#dc2626";
        ctx!.beginPath();
        ctx!.arc(128, 128, 120, 0, Math.PI * 2);
        ctx!.fill();

        // 白フチ
        ctx!.strokeStyle = "#ffffff";
        ctx!.lineWidth = 8;
        ctx!.stroke();

        // 中央の白長方形バー
        ctx!.fillStyle = "#ffffff";
        ctx!.fillRect(36, 104, 184, 48);
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.5 });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.72), mat);
      plane.position.z = 0.02;
      signGroup.add(plane);
    }

    // 裏板
    const backGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.02, 24);
    backGeo.rotateX(Math.PI / 2);
    const back = new THREE.Mesh(backGeo, this.signBackMat);
    signGroup.add(back);

    group.add(signGroup);
    return group;
  }

  /**
   * 4. 規制標識: 「指定方向外進行禁止」（311: 青丸白矢印・直進および左折等）
   */
  public createDirectionSign(
    x: number,
    z: number,
    direction: "straight-left" | "straight-right" | "straight-only" = "straight-left",
  ): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const pole = this.createPoleMesh(3.6);
    group.add(pole);

    const signGroup = new THREE.Group();
    signGroup.position.set(0, 3.2, 0);

    const hasDocument = typeof document !== "undefined";
    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext("2d");
      const hasCtx = Boolean(ctx);
      if (hasCtx) {
        // 青丸
        ctx!.fillStyle = "#1d4ed8";
        ctx!.beginPath();
        ctx!.arc(128, 128, 120, 0, Math.PI * 2);
        ctx!.fill();

        ctx!.strokeStyle = "#ffffff";
        ctx!.lineWidth = 8;
        ctx!.stroke();

        // 白矢印
        const isStraightOnly = direction === "straight-only";
        const isStraightLeft = direction === "straight-left";
        if (isStraightOnly) {
          this.drawArrow(ctx!, 128, 200, 128, 50, "#ffffff", 22);
        } else if (isStraightLeft) {
          this.drawArrow(ctx!, 140, 200, 140, 60, "#ffffff", 18);
          this.drawTurnArrowLeft(ctx!, 140, 160, 50, 100, "#ffffff");
        } else {
          this.drawArrow(ctx!, 116, 200, 116, 60, "#ffffff", 18);
          this.drawTurnArrow(ctx!, 116, 160, 206, 100, "#ffffff");
        }
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.5 });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.72), mat);
      plane.position.z = 0.02;
      signGroup.add(plane);
    }

    const backGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.02, 24);
    backGeo.rotateX(Math.PI / 2);
    const back = new THREE.Mesh(backGeo, this.signBackMat);
    signGroup.add(back);

    group.add(signGroup);
    return group;
  }

  /**
   * 5. 警戒標識: 「信号機あり」（201-2: 黄色ひし形黒枠・信号機シンボル）
   */
  public createWarningSignalSign(x: number, z: number): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const pole = this.createPoleMesh(3.6);
    group.add(pole);

    const signGroup = new THREE.Group();
    signGroup.position.set(0, 3.2, 0);

    const hasDocument = typeof document !== "undefined";
    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext("2d");
      const hasCtx = Boolean(ctx);
      if (hasCtx) {
        // 黄色ひし形（45度回転した正方形）
        ctx!.save();
        ctx!.translate(128, 128);
        ctx!.rotate(Math.PI / 4);

        ctx!.fillStyle = "#facc15"; // 警戒黄色
        ctx!.fillRect(-80, -80, 160, 160);

        ctx!.strokeStyle = "#18181b";
        ctx!.lineWidth = 10;
        ctx!.strokeRect(-76, -76, 152, 152);

        ctx!.restore();

        // 信号機ピクトグラム（中央に赤・黄・青の3色ランプ）
        ctx!.fillStyle = "#27272a";
        ctx!.fillRect(80, 108, 96, 40);

        // 青・黄・赤
        ctx!.fillStyle = "#22c55e";
        ctx!.beginPath();
        ctx!.arc(96, 128, 11, 0, Math.PI * 2);
        ctx!.fill();

        ctx!.fillStyle = "#f59e0b";
        ctx!.beginPath();
        ctx!.arc(128, 128, 11, 0, Math.PI * 2);
        ctx!.fill();

        ctx!.fillStyle = "#ef4444";
        ctx!.beginPath();
        ctx!.arc(160, 128, 11, 0, Math.PI * 2);
        ctx!.fill();
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.5 });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.72), mat);
      plane.position.z = 0.02;
      signGroup.add(plane);
    }

    // ひし形裏板
    const backGeo = new THREE.BoxGeometry(0.55, 0.55, 0.02);
    backGeo.rotateZ(Math.PI / 4);
    const back = new THREE.Mesh(backGeo, this.signBackMat);
    signGroup.add(back);

    group.add(signGroup);
    return group;
  }

  /**
   * 6. 指示標識: 「横断歩道」（407: 青五角形屋根型・歩行者ピクトグラム）
   */
  public createCrosswalkSign(x: number, z: number): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const pole = this.createPoleMesh(3.6);
    group.add(pole);

    const signGroup = new THREE.Group();
    signGroup.position.set(0, 3.2, 0);

    const hasDocument = typeof document !== "undefined";
    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext("2d");
      const hasCtx = Boolean(ctx);
      if (hasCtx) {
        // 青色五角形（家型・屋根型）
        ctx!.fillStyle = "#1d4ed8";
        ctx!.beginPath();
        ctx!.moveTo(128, 12);
        ctx!.lineTo(240, 96);
        ctx!.lineTo(240, 240);
        ctx!.lineTo(16, 240);
        ctx!.lineTo(16, 96);
        ctx!.closePath();
        ctx!.fill();

        ctx!.strokeStyle = "#ffffff";
        ctx!.lineWidth = 8;
        ctx!.stroke();

        // 内部白三角（横断歩道エリア）
        ctx!.fillStyle = "#ffffff";
        ctx!.beginPath();
        ctx!.moveTo(128, 48);
        ctx!.lineTo(218, 220);
        ctx!.lineTo(38, 220);
        ctx!.closePath();
        ctx!.fill();

        // 歩行者シルエット（黒色）
        ctx!.fillStyle = "#1e293b";
        // 頭
        ctx!.beginPath();
        ctx!.arc(128, 92, 12, 0, Math.PI * 2);
        ctx!.fill();
        // 体・手足（簡易ピクトグラム）
        ctx!.fillRect(122, 108, 12, 42);
        ctx!.beginPath();
        ctx!.moveTo(124, 150);
        ctx!.lineTo(108, 195);
        ctx!.lineTo(118, 195);
        ctx!.lineTo(128, 155);
        ctx!.lineTo(138, 195);
        ctx!.lineTo(148, 195);
        ctx!.lineTo(132, 150);
        ctx!.fill();

        // ゼブラ帯（横断歩道ストライプ）
        ctx!.fillRect(75, 198, 106, 6);
        ctx!.fillRect(65, 208, 126, 6);
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.5 });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.72), mat);
      plane.position.z = 0.02;
      signGroup.add(plane);
    }

    const backGeo = new THREE.BoxGeometry(0.68, 0.68, 0.02);
    const back = new THREE.Mesh(backGeo, this.signBackMat);
    signGroup.add(back);

    group.add(signGroup);
    return group;
  }

  /**
   * 7. 通称名標識（119: 青長方形「行幸通り Gyoko-dori Ave.」等）
   */
  public createStreetNameSign(x: number, z: number, nameJa: string, nameEn: string): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const pole = this.createPoleMesh(3.8);
    group.add(pole);

    const signGroup = new THREE.Group();
    signGroup.position.set(0, 3.4, 0);

    const width = 1.4;
    const height = 0.45;

    const hasDocument = typeof document !== "undefined";
    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 160;
      const ctx = canvas.getContext("2d");
      const hasCtx = Boolean(ctx);
      if (hasCtx) {
        ctx!.fillStyle = "#00428a"; // 道路標識ブルー
        ctx!.fillRect(0, 0, 512, 160);

        ctx!.strokeStyle = "#ffffff";
        ctx!.lineWidth = 8;
        ctx!.strokeRect(6, 6, 500, 148);

        ctx!.fillStyle = "#ffffff";
        ctx!.textAlign = "center";
        ctx!.font = "bold 50px sans-serif";
        ctx!.fillText(nameJa, 256, 68);
        ctx!.font = "bold 24px sans-serif";
        ctx!.fillText(nameEn, 256, 122);
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.4 });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
      plane.position.z = 0.02;
      signGroup.add(plane);
    }

    const backGeo = new THREE.BoxGeometry(width, height, 0.02);
    const back = new THREE.Mesh(backGeo, this.signBackMat);
    signGroup.add(back);

    group.add(signGroup);
    return group;
  }

  // --- ヘルパー描画メソッド ---

  private createPoleMesh(height: number): THREE.Mesh {
    const poleGeo = new THREE.CylinderGeometry(0.045, 0.045, height, 12);
    const pole = new THREE.Mesh(poleGeo, this.poleMat);
    pole.position.y = height / 2;
    pole.castShadow = true;
    return pole;
  }

  private drawArrow(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
    width = 24,
  ): void {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // 矢尻
    const headLen = width * 2.2;
    ctx.beginPath();
    ctx.moveTo(x2, y2 - headLen * 0.4);
    ctx.lineTo(x2 - headLen * 0.8, y2 + headLen * 0.8);
    ctx.lineTo(x2 + headLen * 0.8, y2 + headLen * 0.8);
    ctx.closePath();
    ctx.fill();
  }

  private drawTurnArrow(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
  ): void {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 20;
    ctx.lineCap = "round";

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1, y2);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // 矢尻（右向き）
    ctx.beginPath();
    ctx.moveTo(x2 + 20, y2);
    ctx.lineTo(x2 - 25, y2 - 25);
    ctx.lineTo(x2 - 25, y2 + 25);
    ctx.closePath();
    ctx.fill();
  }

  private drawTurnArrowLeft(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
  ): void {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 20;
    ctx.lineCap = "round";

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1, y2);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // 矢尻（左向き）
    ctx.beginPath();
    ctx.moveTo(x2 - 20, y2);
    ctx.lineTo(x2 + 25, y2 - 25);
    ctx.lineTo(x2 + 25, y2 + 25);
    ctx.closePath();
    ctx.fill();
  }

  private drawRouteBadge(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    routeNum: string,
  ): void {
    // 国道「おにぎり」型青色マーク
    ctx.fillStyle = "#0284c7";
    ctx.beginPath();
    ctx.roundRect(x - 38, y - 28, 76, 56, 12);
    ctx.fill();

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 32px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(routeNum, x, y + 10);
  }

  /**
   * 規制標識（最高速度 323: 丸型赤枠・青数字 + オプション補助標識）
   * How: 支柱に丸型赤枠・白地メッシュを配置し、Canvasで日本の標識数字を描画する。
   */
  public createSpeedLimitSign(
    x: number,
    z: number,
    limit = 50,
    auxiliaryText?: string,
  ): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    // 支柱
    const poleGeo = new THREE.CylinderGeometry(0.04, 0.04, 3.8, 12);
    const pole = new THREE.Mesh(poleGeo, this.poleMat);
    pole.position.y = 1.9;
    group.add(pole);

    // 丸型看板
    const signGroup = new THREE.Group();
    signGroup.position.set(0, 3.4, 0);

    const borderGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.02, 24);
    borderGeo.rotateX(Math.PI / 2);
    const borderMat = new THREE.MeshStandardMaterial({ color: 0xdc2626 });
    const border = new THREE.Mesh(borderGeo, borderMat);
    signGroup.add(border);

    const faceGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.025, 24);
    faceGeo.rotateX(Math.PI / 2);
    const faceMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const face = new THREE.Mesh(faceGeo, faceMat);
    face.position.z = 0.005;
    signGroup.add(face);

    const hasDocument = typeof document !== "undefined";
    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext("2d");
      const hasCtx = ctx !== null;
      if (hasCtx) {
        ctx!.fillStyle = "#ffffff";
        ctx!.beginPath();
        ctx!.arc(64, 64, 60, 0, Math.PI * 2);
        ctx!.fill();

        ctx!.fillStyle = "#1e3a8a";
        ctx!.font = "bold 64px sans-serif";
        ctx!.textAlign = "center";
        ctx!.textBaseline = "middle";
        ctx!.fillText(`${limit}`, 64, 64);

        const tex = new THREE.CanvasTexture(canvas);
        face.material = new THREE.MeshStandardMaterial({
          map: tex,
          roughness: 0.4,
        });
      }
    }

    const hasAux = Boolean(auxiliaryText);
    if (hasAux) {
      const auxPlate = this.createAuxiliaryPlate(auxiliaryText!);
      auxPlate.position.set(0, -0.52, 0);
      signGroup.add(auxPlate);
    }

    group.add(signGroup);
    return group;
  }

  /**
   * 8. 規制標識: 「駐車禁止」(316) / 「駐停車禁止」(315) + 補助標識プレート
   * How: 赤枠・青地丸板に斜め赤線（駐車禁止は1本、駐停車禁止はX字2本）を描画し、下部に補助標識を添える。
   */
  public createNoParkingSign(
    x: number,
    z: number,
    isNoStopping = false,
    auxiliaryText = "終日",
  ): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const pole = this.createPoleMesh(3.8);
    group.add(pole);

    const signGroup = new THREE.Group();
    signGroup.position.set(0, 3.35, 0);

    const hasDocument = typeof document !== "undefined";
    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext("2d");
      const hasCtx = Boolean(ctx);
      if (hasCtx) {
        // 白外縁
        ctx!.fillStyle = "#ffffff";
        ctx!.beginPath();
        ctx!.arc(128, 128, 122, 0, Math.PI * 2);
        ctx!.fill();

        // 赤リング
        ctx!.fillStyle = "#dc2626";
        ctx!.beginPath();
        ctx!.arc(128, 128, 116, 0, Math.PI * 2);
        ctx!.fill();

        // 内部の青円
        ctx!.fillStyle = "#1d4ed8";
        ctx!.beginPath();
        ctx!.arc(128, 128, 86, 0, Math.PI * 2);
        ctx!.fill();

        // 斜め赤スラッシュ（左上→右下）
        ctx!.strokeStyle = "#dc2626";
        ctx!.lineWidth = 24;
        ctx!.beginPath();
        ctx!.moveTo(56, 56);
        ctx!.lineTo(200, 200);
        ctx!.stroke();

        // 駐停車禁止（315）の場合は右上→左下の斜線も追加
        if (isNoStopping) {
          ctx!.beginPath();
          ctx!.moveTo(200, 56);
          ctx!.lineTo(56, 200);
          ctx!.stroke();
        }
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.45 });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.72), mat);
      plane.position.z = 0.02;
      signGroup.add(plane);
    }

    const backGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.02, 24);
    backGeo.rotateX(Math.PI / 2);
    const back = new THREE.Mesh(backGeo, this.signBackMat);
    signGroup.add(back);

    const hasAux = Boolean(auxiliaryText);
    if (hasAux) {
      const auxPlate = this.createAuxiliaryPlate(auxiliaryText);
      auxPlate.position.set(0, -0.52, 0);
      signGroup.add(auxPlate);
    }

    group.add(signGroup);
    return group;
  }

  /**
   * 9. 規制標識: 「転回禁止」(313: Uターン禁止) + 補助標識
   * How: 白地・赤枠丸板に黒のUターン矢印と赤スラッシュを描画する。
   */
  public createNoUTurnSign(x: number, z: number, auxiliaryText = "終日"): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const pole = this.createPoleMesh(3.8);
    group.add(pole);

    const signGroup = new THREE.Group();
    signGroup.position.set(0, 3.35, 0);

    const hasDocument = typeof document !== "undefined";
    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext("2d");
      const hasCtx = Boolean(ctx);
      if (hasCtx) {
        // 赤外枠
        ctx!.fillStyle = "#dc2626";
        ctx!.beginPath();
        ctx!.arc(128, 128, 118, 0, Math.PI * 2);
        ctx!.fill();

        // 内部白円
        ctx!.fillStyle = "#ffffff";
        ctx!.beginPath();
        ctx!.arc(128, 128, 90, 0, Math.PI * 2);
        ctx!.fill();

        // 黒Uターン矢印
        ctx!.strokeStyle = "#18181b";
        ctx!.lineWidth = 18;
        ctx!.lineCap = "round";
        ctx!.beginPath();
        ctx!.moveTo(156, 185);
        ctx!.lineTo(156, 108);
        ctx!.arc(128, 108, 28, 0, Math.PI, true);
        ctx!.lineTo(100, 155);
        ctx!.stroke();

        // 矢尻
        ctx!.fillStyle = "#18181b";
        ctx!.beginPath();
        ctx!.moveTo(100, 185);
        ctx!.lineTo(78, 148);
        ctx!.lineTo(122, 148);
        ctx!.closePath();
        ctx!.fill();

        // 赤禁止スラッシュ
        ctx!.strokeStyle = "#dc2626";
        ctx!.lineWidth = 22;
        ctx!.beginPath();
        ctx!.moveTo(58, 58);
        ctx!.lineTo(198, 198);
        ctx!.stroke();
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.45 });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.72), mat);
      plane.position.z = 0.02;
      signGroup.add(plane);
    }

    const backGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.02, 24);
    backGeo.rotateX(Math.PI / 2);
    const back = new THREE.Mesh(backGeo, this.signBackMat);
    signGroup.add(back);

    const hasAux = Boolean(auxiliaryText);
    if (hasAux) {
      const auxPlate = this.createAuxiliaryPlate(auxiliaryText);
      auxPlate.position.set(0, -0.52, 0);
      signGroup.add(auxPlate);
    }

    group.add(signGroup);
    return group;
  }

  /**
   * 10. 規制標識: 「一方通行」(326-A: 青長方形に白太矢印)
   */
  public createOneWaySign(x: number, z: number, auxiliaryText = "自転車を除く"): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const pole = this.createPoleMesh(3.6);
    group.add(pole);

    const signGroup = new THREE.Group();
    signGroup.position.set(0, 3.25, 0);

    const width = 0.95;
    const height = 0.42;

    const hasDocument = typeof document !== "undefined";
    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 384;
      canvas.height = 168;
      const ctx = canvas.getContext("2d");
      const hasCtx = Boolean(ctx);
      if (hasCtx) {
        ctx!.fillStyle = "#1d4ed8";
        ctx!.fillRect(0, 0, 384, 168);

        ctx!.strokeStyle = "#ffffff";
        ctx!.lineWidth = 10;
        ctx!.strokeRect(6, 6, 372, 156);

        // 左向き白太矢印
        ctx!.fillStyle = "#ffffff";
        ctx!.fillRect(110, 64, 220, 40);
        ctx!.beginPath();
        ctx!.moveTo(42, 84);
        ctx!.lineTo(122, 34);
        ctx!.lineTo(122, 134);
        ctx!.closePath();
        ctx!.fill();
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45 });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
      plane.position.z = 0.02;
      signGroup.add(plane);
    }

    const backGeo = new THREE.BoxGeometry(width, height, 0.02);
    const back = new THREE.Mesh(backGeo, this.signBackMat);
    signGroup.add(back);

    const hasAux = Boolean(auxiliaryText);
    if (hasAux) {
      const auxPlate = this.createAuxiliaryPlate(auxiliaryText);
      auxPlate.position.set(0, -0.38, 0);
      signGroup.add(auxPlate);
    }

    group.add(signGroup);
    return group;
  }

  /**
   * 11. 規制標識: 「進行方向別通行区分」(327の7: 交差点手前の車線別進行方向表示板)
   * How: 青地に白破線区切りと左折・直進・右折の3車線矢印を描画した大型角板。
   */
  public createLaneDirectionSign(x: number, z: number): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const pole = this.createPoleMesh(4.4);
    group.add(pole);

    const signGroup = new THREE.Group();
    signGroup.position.set(0, 3.85, 0);

    const width = 1.65;
    const height = 1.15;

    const hasDocument = typeof document !== "undefined";
    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 360;
      const ctx = canvas.getContext("2d");
      const hasCtx = Boolean(ctx);
      if (hasCtx) {
        ctx!.fillStyle = "#00428a";
        ctx!.fillRect(0, 0, 512, 360);

        ctx!.strokeStyle = "#ffffff";
        ctx!.lineWidth = 10;
        ctx!.strokeRect(8, 8, 496, 344);

        // 車線区切り破線（2本）
        ctx!.setLineDash([22, 16]);
        ctx!.lineWidth = 8;
        for (const divX of [170, 342]) {
          ctx!.beginPath();
          ctx!.moveTo(divX, 24);
          ctx!.lineTo(divX, 336);
          ctx!.stroke();
        }
        ctx!.setLineDash([]);

        // 左レーン: 直進＋左折
        this.drawArrow(ctx!, 105, 300, 105, 75, "#ffffff", 16);
        this.drawTurnArrowLeft(ctx!, 105, 210, 42, 140, "#ffffff");

        // 中央レーン: 直進
        this.drawArrow(ctx!, 256, 300, 256, 75, "#ffffff", 20);

        // 右レーン: 右折専用
        this.drawTurnArrow(ctx!, 400, 300, 470, 145, "#ffffff");
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
      plane.position.z = 0.02;
      signGroup.add(plane);
    }

    const backGeo = new THREE.BoxGeometry(width, height, 0.03);
    const back = new THREE.Mesh(backGeo, this.signBackMat);
    signGroup.add(back);

    group.add(signGroup);
    return group;
  }

  /**
   * 12. 案内標識: 「交差点名標識（地点名標識 114-A）」
   * How: 信号機横や交差点角に設置される白地・青枠・青文字の交差点名プレート。
   */
  public createIntersectionNameSign(
    x: number,
    z: number,
    nameJa = "和田倉門",
    nameEn = "Wadakuramon",
  ): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const pole = this.createPoleMesh(4.2);
    group.add(pole);

    const board = this.createIntersectionNamePlateMesh(nameJa, nameEn);
    board.position.set(0, 3.85, 0);
    group.add(board);

    return group;
  }

  /**
   * 信号機アームにも取り付け可能な交差点名プレート単体メッシュ
   */
  public createIntersectionNamePlateMesh(
    nameJa = "行幸通り前",
    nameEn = "Gyoko-dori",
  ): THREE.Group {
    const signGroup = new THREE.Group();
    const width = 1.25;
    const height = 0.42;

    const hasDocument = typeof document !== "undefined";
    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 172;
      const ctx = canvas.getContext("2d");
      const hasCtx = Boolean(ctx);
      if (hasCtx) {
        ctx!.fillStyle = "#ffffff";
        ctx!.fillRect(0, 0, 512, 172);

        ctx!.strokeStyle = "#00428a";
        ctx!.lineWidth = 10;
        ctx!.strokeRect(8, 8, 496, 156);

        ctx!.fillStyle = "#00428a";
        ctx!.textAlign = "center";
        ctx!.font = "bold 52px sans-serif";
        ctx!.fillText(nameJa, 256, 76);
        ctx!.font = "bold 28px sans-serif";
        ctx!.fillText(nameEn, 256, 132);
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
      plane.position.z = 0.02;
      signGroup.add(plane);
    }

    const backGeo = new THREE.BoxGeometry(width, height, 0.02);
    const back = new THREE.Mesh(backGeo, this.signBackMat);
    signGroup.add(back);

    return signGroup;
  }

  /**
   * 13. 安全施設: 「視線誘導標（デリネーター）＆ 障害物表示ゼブラ標示板」
   * How: 中央分離帯端や交差点コーナーに設置される黄黒ゼブラ反射板とオレンジ反射器。
   */
  public createDelineatorPost(x: number, z: number): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    // 支柱（高さ1.2m）
    const poleGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.2, 10);
    const pole = new THREE.Mesh(poleGeo, this.poleMat);
    pole.position.y = 0.6;
    group.add(pole);

    // 黄黒ゼブラ警戒板（幅0.26m, 高さ0.75m）
    const zebraWidth = 0.26;
    const zebraHeight = 0.75;
    const hasDocument = typeof document !== "undefined";
    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 384;
      const ctx = canvas.getContext("2d");
      const hasCtx = Boolean(ctx);
      if (hasCtx) {
        ctx!.fillStyle = "#facc15";
        ctx!.fillRect(0, 0, 128, 384);

        ctx!.fillStyle = "#18181b";
        for (let y = -128; y < 384; y += 64) {
          ctx!.beginPath();
          ctx!.moveTo(0, y);
          ctx!.lineTo(128, y + 64);
          ctx!.lineTo(128, y + 96);
          ctx!.lineTo(0, y + 32);
          ctx!.closePath();
          ctx!.fill();
        }
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35 });
      const front = new THREE.Mesh(new THREE.PlaneGeometry(zebraWidth, zebraHeight), mat);
      front.position.set(0, 0.72, 0.05);
      group.add(front);
    }

    // 上部オレンジ反射デリネーターレンズ
    const reflectorGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.04, 16);
    reflectorGeo.rotateX(Math.PI / 2);
    const reflectorMat = new THREE.MeshBasicMaterial({ color: 0xf97316 });
    const reflector = new THREE.Mesh(reflectorGeo, reflectorMat);
    reflector.position.set(0, 1.22, 0.04);
    group.add(reflector);

    return group;
  }

  /**
   * 補助標識プレート（501〜510系: 本標識の下に付く白長方形プレート）
   */
  private createAuxiliaryPlate(text: string): THREE.Group {
    const auxGroup = new THREE.Group();
    const width = 0.62;
    const height = 0.22;

    const backGeo = new THREE.BoxGeometry(width, height, 0.015);
    const back = new THREE.Mesh(backGeo, this.signBackMat);
    auxGroup.add(back);

    const hasDocument = typeof document !== "undefined";
    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 96;
      const ctx = canvas.getContext("2d");
      const hasCtx = Boolean(ctx);
      if (hasCtx) {
        ctx!.fillStyle = "#ffffff";
        ctx!.fillRect(0, 0, 256, 96);

        ctx!.strokeStyle = "#334155";
        ctx!.lineWidth = 4;
        ctx!.strokeRect(4, 4, 248, 88);

        ctx!.fillStyle = "#1e293b";
        ctx!.font = "bold 36px sans-serif";
        ctx!.textAlign = "center";
        ctx!.textBaseline = "middle";
        ctx!.fillText(text, 128, 48);
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45 });
      const front = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
      front.position.z = 0.012;
      auxGroup.add(front);
    }

    return auxGroup;
  }
}

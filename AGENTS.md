# AGENTS.md — Antigravity Deep Drive 開発・運用規約

本ドキュメントは、本リポジトリで作業するすべての AI コーディングエージェント（Claude Code / Codex / Antigravity 等）向けのプロジェクト規約および設計指針を定義します。

---

## 1. 3D モデリング規約（Blender MCP & 360度収束レビュー）

- **モデリングは Blender MCP を使う**:
  - 車両（[`apps/web/public/models/car.glb`](apps/web/public/models/car.glb)）、建築物（[`apps/web/public/models/tokyo_station.glb`](apps/web/public/models/tokyo_station.glb)）、街路樹（[`apps/web/public/models/street_tree.glb`](apps/web/public/models/street_tree.glb)）等の 3D アセット作成・改修は、Three.js 側の単純プリミティブ組み合わせで済ませず、**Blender MCP**（`execute_blender_code` / `execute_blender_code_for_cli` / `get_objects_summary` / `render_viewport_to_path`）および [`blender/scripts/`](blender/scripts/) のスクリプトを用いて行うこと。
  - Blender MCP サーバーは `just start-blender-mcp` で起動できる。
- **モデリング後は 360度のアングルでレビューし、指摘事項が収束するまで修正を繰り返す**:
  1. モデリングまたはジオメトリ修正のたびに、対象アセットの周囲 **360度マルチアングル**（正面・背面・左側面・右側面・斜め4方向・俯瞰・アイレベル/車内ドライバー視点・主要ディテール接写）からレンダリング画像を出力する。
  2. 出力した全アングルの画像を視覚的に確認・レビューし、プロポーション破綻、パーツの浮き・めり込み、法線/向きの反転、視界遮蔽（車内ナビやメーターの見切れ等）、シルエットの単調さなどの指摘事項を洗い出す。
  3. **指摘事項がゼロになり品質が収束するまで「スクリプト修正 → GLB 再出力 → 360度レンダリング → レビュー」のループを繰り返す**。1回の生成で完了とみなさないこと。
- **実寸スケール（1 Unit = 1.0m）と日本仕様（JDM 右ハンドル）**:
  - すべての 3D モデルは現実の物理寸法（例：3ナンバーセダン 全長 4.72m × 全幅 1.84m × 全高 1.43m、ホイールベース 2.82m）でモデリングし、日本仕様の右ハンドル（運転席 `x = -0.38m`、センターナビは運転席左隣）に準拠すること。

---

## 2. 時間帯（Time of Day）と天候（Weather）の直交分離

- **時間帯と天候を混同しない**:
  - 「夕暮れ (`sunset`)」「夜間 (`night`)」は天候ではなく **時間（`TimeOfDay`: `morning` / `day` / `sunset` / `night`）** である。
  - **天候（`WeatherCondition`: `clear` 晴天 / `cloudy` 曇天 / `rain` 雨天）** は時間帯とは独立した軸として管理し、「夕暮れ × 晴天」「夕暮れ × 雨天」「昼 × 雨天」「夜間 × 雨天」など任意の組み合わせが機能するように設計・実装する（[`apps/web/src/weather/weatherSystem.ts`](apps/web/src/weather/weatherSystem.ts)）。

---

## 3. トレーサビリティ重視の構造化ログ（Zod Schema）

- **Zod スキーマ検証付き 1イベント1行 JSON ログ**:
  - ログ出力は [`apps/web/src/core/logger.ts`](apps/web/src/core/logger.ts) の `StructuredLogEntrySchema`（Zod）で検証された構造化 JSON 形式（`timestamp`, `level`, `traceId`, `spanId`, `parentSpanId`, `module`, `event`, `message`, `durationMs`, `data`）を使用する。
- **`traceId` / `spanId` の伝播**:
  - 初期化、オープンデータ読込、時間変更、天候変更、カメラ切替、ワイパー操作等のイベントでは `logger.withTrace` / `logger.withAsyncTrace` を用いて `traceId` を伝播させ、AI エージェントが `window.__DEEP_DRIVE_LOGS__` やコンソール出力から `jq` / `grep` で即座に自動調査・原因追跡できるようにする。

---

## 4. ナレッジベース（OKF）と検証フロー

- 作業に着手する前に [`knowledge/index.md`](knowledge/index.md) を確認し、既知の知見・過去のシェーダーや物理エンジンの設計背景を踏まえること。
- 調査・実装で得た新しい知見は [`knowledge/`](knowledge/) 配下に OKF 形式で記録し、[`knowledge/tags.yml`](knowledge/tags.yml) の統制語彙タグを付与すること。
- コード変更後は必ず以下のコマンドで自動整形・型検査・Lint・単体テスト・本番ビルドのすべてが通ることを確認すること：
  - `just format-code`
  - `just verify-all`

# 利用可能なレシピ一覧を表示する
default:
    @just --list

# 依存関係をインストールしGitフックをセットアップする
install-deps:
    pnpm install
    lefthook install

# 開発サーバーを起動する
start-dev:
    pnpm --filter web dev

# 本番ビルド成果物をプレビューする
preview-app:
    pnpm --filter web preview

# 全パッケージをビルドする
build-app:
    pnpm -r build

# 全パッケージの型検査を実行する
check-types:
    pnpm -r typecheck

# 全パッケージのリントを実行する
lint-code:
    pnpm -r lint
    ruff check blender/scripts/
    ruff format --check blender/scripts/

# 全パッケージのコードを自動整形する
format-code:
    pnpm -r format
    ruff format blender/scripts/

# 全パッケージのテストを実行する
run-tests:
    pnpm -r test

# GitHub Pages向けにベースパスを設定してビルドする
build-pages:
    BASE_URL=/antigravity-deep-drive/ pnpm --filter web build

# GitHub Actionsワークフローの構文とSHA pinを検証する
check-actions:
    actionlint
    pinact run --check

# GitHub ActionsワークフローのアクションをコミットSHAでpinする
pin-actions:
    pinact run
    pinact run --verify

# 型検査・リント・テスト・ビルドを一括実行して品質を検証する
verify-all:
    just check-actions
    just check-types
    just lint-code
    just run-tests
    just build-app

# 3DモデルアセットをBlenderでプロシージャル生成してGLB形式でエクスポートする
model-assets:
    uv run --script blender/scripts/generate_vehicle_model.py
    uv run --script blender/scripts/generate_tokyo_station.py
    uv run --script blender/scripts/generate_shibuya_stream.py
    uv run --script blender/scripts/generate_street_tree.py
    uv run --script blender/scripts/generate_guardrail.py

# 行幸通りイチョウ街路樹3DモデルをBlenderでプロシージャル生成してGLB形式でエクスポートする
generate-tree:
    uv run --script blender/scripts/generate_street_tree.py

# 3DテクスチャPBRマテリアルをBlenderで生成する
generate-textures:
    uv run --script blender/scripts/generate_3d_pbr_textures.py

# Blender公式MCPサーバーをバックグラウンドソケット待受モードで起動する
start-blender-mcp:
    /Applications/Blender.app/Contents/MacOS/Blender --background --online-mode --command blender_mcp --port 9876

# ビルド成果物とキャッシュを削除する
clean-cache:
    rm -rf apps/web/dist .turbo .cache

# tsdownを使用してビルド済みJSアセットをminifyする
minify-assets:
    pnpm --filter web run minify

# 東京都PLATEAUおよび国土地理院のオープンデータを取得して都市データバンドルを生成する
fetch-open-data:
    pnpm --filter web run fetch-open-data

# GitHub Pagesデプロイワークフローを起動する
deploy-pages:
    gh workflow run deploy.yml

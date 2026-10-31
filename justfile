# 利用可能なレシピ一覧を表示する
default:
    @just --list

# 依存関係をインストールする
install-deps:
    pnpm install

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

# 全パッケージのコードを自動整形する
format-code:
    pnpm -r format

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
    /Applications/Blender.app/Contents/MacOS/Blender --background --python blender/scripts/generate_vehicle_model.py
    /Applications/Blender.app/Contents/MacOS/Blender --background --python blender/scripts/generate_tokyo_station.py

# 3DテクスチャPBRマテリアルをBlenderで生成する
generate-textures:
    /Applications/Blender.app/Contents/MacOS/Blender --background --python blender/scripts/generate_3d_pbr_textures.py

# ビルド成果物とキャッシュを削除する
clean-cache:
    rm -rf apps/web/dist .turbo .cache

# tsdownを使用してビルド済みJSアセットをminifyする
minify-assets:
    pnpm --filter web run minify

# GitHub Pagesデプロイワークフローを起動する
deploy-pages:
    gh workflow run deploy.yml

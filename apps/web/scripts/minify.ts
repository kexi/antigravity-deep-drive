import { readdirSync, statSync, copyFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

/**
 * tsdown を使用して Vite ビルド成果物 (dist/assets/*.js) を minify 最適化するスクリプト
 *
 * 【Why】
 * Vite/Rolldown でバンドルされた単一アセットに対し、tsdown (Oxc/Rolldown Minifier) による
 * 追加の構文最適化と minification を実行し、ブラウザ向けに最小サイズで提供するため。
 * あわせて `/boost` パス直アクセス時にも静的ホスティング（vite preview / GitHub Pages 等）で
 * SPA エントリ (`index.html`) が返されるよう `dist/boost/index.html` と `dist/404.html` を生成する。
 *
 * 【How】
 * 1. dist/assets 内の .js ファイルを走査
 * 2. tsdown <file> --out-dir dist/assets-tsdown-min --minify --platform browser --format esm --no-clean を実行
 * 3. minify 済みファイルで元ファイルを安全に置き換え、一時ディレクトリを削除
 * 4. dist/index.html を dist/boost/index.html および dist/404.html に複製
 */
function minifyDistAssets(): void {
  const distDir = resolve(import.meta.dirname, "../dist");
  const assetsDir = resolve(distDir, "assets");
  const hasNoAssetsDir = !existsSync(assetsDir);
  if (hasNoAssetsDir) {
    console.warn(`[minify] Warning: assets directory not found at ${assetsDir}`);
    return;
  }

  const entries = readdirSync(assetsDir);
  const jsFiles = entries.filter((file) => file.endsWith(".js"));
  const hasNoJsFiles = jsFiles.length === 0;
  if (hasNoJsFiles) {
    console.log("[minify] No JavaScript files found in dist/assets.");
    return;
  }

  const tempMinDir = resolve(distDir, "assets-tsdown-min");

  for (const jsFile of jsFiles) {
    const originalPath = join(assetsDir, jsFile);
    const originalSize = statSync(originalPath).size;

    console.log(
      `[minify] Minifying ${jsFile} with tsdown (initial size: ${(originalSize / 1024).toFixed(2)} KB)...`,
    );

    // tsdown CLI で minify バンドルを実行
    const cmd = `pnpm exec tsdown "dist/assets/${jsFile}" --out-dir dist/assets-tsdown-min --minify --platform browser --format esm --no-clean`;
    execSync(cmd, {
      cwd: resolve(import.meta.dirname, ".."),
      stdio: "inherit",
    });

    const minifiedPath = join(tempMinDir, jsFile);
    const isMinifiedCreated = existsSync(minifiedPath);
    if (!isMinifiedCreated) {
      console.warn(`[minify] Warning: Minified file not generated for ${jsFile}`);
      continue;
    }

    const minifiedSize = statSync(minifiedPath).size;
    copyFileSync(minifiedPath, originalPath);
    console.log(
      `[minify] Replaced ${jsFile}: ${(originalSize / 1024).toFixed(2)} KB -> ${(minifiedSize / 1024).toFixed(2)} KB`,
    );
  }

  const hasTempDir = existsSync(tempMinDir);
  if (hasTempDir) {
    rmSync(tempMinDir, { recursive: true, force: true });
  }

  // /boost, /boost/assets, /asset-manager, /assets パスへの直接アクセスを静的ホスティングで解決するため index.html を複製
  const rootIndexHtml = join(distDir, "index.html");
  const hasRootIndexHtml = existsSync(rootIndexHtml);
  if (hasRootIndexHtml) {
    const boostRouteDir = join(distDir, "boost");
    mkdirSync(boostRouteDir, { recursive: true });
    copyFileSync(rootIndexHtml, join(boostRouteDir, "index.html"));

    const boostAssetsRouteDir = join(distDir, "boost", "assets");
    mkdirSync(boostAssetsRouteDir, { recursive: true });
    copyFileSync(rootIndexHtml, join(boostAssetsRouteDir, "index.html"));

    const assetManagerRouteDir = join(distDir, "asset-manager");
    mkdirSync(assetManagerRouteDir, { recursive: true });
    copyFileSync(rootIndexHtml, join(assetManagerRouteDir, "index.html"));

    const assetsRouteDir = join(distDir, "assets");
    mkdirSync(assetsRouteDir, { recursive: true });
    copyFileSync(rootIndexHtml, join(assetsRouteDir, "index.html"));

    copyFileSync(rootIndexHtml, join(distDir, "404.html"));
    console.log(
      "[minify] Generated dist/boost/index.html, dist/boost/assets/index.html, dist/asset-manager/index.html, dist/assets/index.html, and dist/404.html.",
    );
  }

  console.log("[minify] tsdown minification completed successfully.");
}

minifyDistAssets();

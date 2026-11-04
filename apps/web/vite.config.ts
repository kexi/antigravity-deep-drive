import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.BASE_URL ?? (process.env.GITHUB_ACTIONS ? "/antigravity-deep-drive/" : "/"),
  server: {
    port: 3000,
    open: false,
  },
  optimizeDeps: {
    exclude: ["@dimforge/rapier3d-compat"],
  },
  build: {
    target: "esnext",
  },
});

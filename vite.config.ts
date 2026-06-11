import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  // Relative asset paths so the build works when served from a subpath
  // (GitHub Pages serves project sites at https://<user>.github.io/<repo>/).
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@protocol": path.resolve(__dirname, "../protocol"),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    target: "esnext",
  },
});

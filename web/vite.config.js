import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const apiTarget = process.env.VITE_API_TARGET || process.env.API_TARGET || "http://127.0.0.1:5174";
const buildStamp = process.env.BUILD_STAMP || new Date().toISOString().replace(/\D/g, "").slice(0, 14);

export default defineConfig({
  plugins: [vue()],
  build: {
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-${buildStamp}-[hash].js`,
        chunkFileNames: `assets/[name]-${buildStamp}-[hash].js`,
        assetFileNames: `assets/[name]-${buildStamp}-[hash][extname]`
      }
    }
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: true,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        ws: true
      }
    }
  }
});

import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  server: {
    watch: {
      ignored: ["**/dist/**", "**/dist-cloudflare/**", "**/.wrangler/**"],
    },
  },
  build: {
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks: { three: ["three"], network: ["socket.io-client"] },
      },
    },
  },
});

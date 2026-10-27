import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Transform halaman awal saat server start agar request pertama (mis. dari test E2E) tidak lambat.
    warmup: { clientFiles: ["./src/main.tsx", "./src/App.tsx"] },
    // Path /api tidak di-rewrite: API sendiri memakai prefix /api. Header Origin dari browser diteruskan apa adanya.
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
  // Pre-bundle sejak awal supaya tidak ada reload halaman di tengah sesi karena dependensi baru ditemukan.
  optimizeDeps: {
    include: [
      "react",
      "react-dom/client",
      "react-router-dom",
      "@testpulse/shared > zod",
      "@radix-ui/react-dropdown-menu",
      "lucide-react",
    ],
  },
  build: {
    rollupOptions: {
      // Komentar anotasi dari zod (pihak ketiga) memicu peringatan Rollup yang tidak bisa kita perbaiki.
      onwarn(warning, defaultHandler) {
        if (warning.code === "INVALID_ANNOTATION" && warning.id?.includes("node_modules")) return;
        defaultHandler(warning);
      },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});

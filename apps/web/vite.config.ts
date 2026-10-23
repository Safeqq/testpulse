import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const catalogUrl = process.env.CATALOG_URL ?? "http://localhost:3001";
const orderUrl = process.env.ORDER_URL ?? "http://localhost:3002";

// Browser hanya berbicara ke satu origin; /api/* diteruskan ke service masing-masing.
// Konfigurasi yang sama dipakai nginx di Docker (lihat nginx.conf).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api/catalog": { target: catalogUrl, rewrite: (path) => path.replace(/^\/api\/catalog/, "") },
      "/api/order": { target: orderUrl, rewrite: (path) => path.replace(/^\/api\/order/, "") },
    },
  },
});

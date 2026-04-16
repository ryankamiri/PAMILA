import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@pamila/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
      "@pamila/ui": fileURLToPath(new URL("../../packages/ui/src/index.ts", import.meta.url))
    }
  },
  server: {
    host: "127.0.0.1",
    port: 5173
  }
});

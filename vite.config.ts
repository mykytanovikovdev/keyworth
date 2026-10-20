import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), cloudflare()],
  build: {
    // `--mode design` adds the /design page (see src/App.tsx). It gets its own
    // folder so it is never confused with the production build in dist/.
    outDir: mode === "design" ? "dist-design" : "dist",
  },
}));

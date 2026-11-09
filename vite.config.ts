import { cloudflare } from "@cloudflare/vite-plugin";
import optimizeLocales from "@react-aria/optimize-locales-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  plugins: [
    // The interface is English only: React Aria's strings for its other 30-odd
    // languages are left out. en-GB orders the date field's segments.
    optimizeLocales.vite({ locales: ["en-US", "en-GB"] }),
    react(),
    tailwindcss(),
    cloudflare(),
  ],
  build: {
    // `--mode design` adds the /design page (see src/App.tsx). It gets its own
    // folder so it is never confused with the production build in dist/.
    outDir: mode === "design" ? "dist-design" : "dist",
  },
}));

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/* Two builds:
     npm run build          the real site, served from the domain root, with
                            clean addresses (/newsletter, /advertise…)
     npm run build:preview  a copy that works from any folder and keeps the
                            current tab after "#", for previews and demos  */
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === "preview" ? "./" : "/",
  define: { __HASH_ROUTER__: JSON.stringify(mode === "preview") },
  build: { chunkSizeWarningLimit: 700 },
}));

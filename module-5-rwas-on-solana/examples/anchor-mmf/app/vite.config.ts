import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Anchor checks `process.env.ANCHOR_BROWSER` to pick its browser code path.
  define: { "process.env.ANCHOR_BROWSER": JSON.stringify("1") },
  server: {
    port: 5173,
    // The IDLs and generated types are read straight from ../target, so the
    // console always matches the last `anchor build`.
    fs: { allow: [".."] },
  },
});

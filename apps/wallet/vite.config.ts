import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Ensure @noble packages are pre-bundled for the browser
    include: ["@noble/post-quantum", "@noble/hashes"],
  },
});

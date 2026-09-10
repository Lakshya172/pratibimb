import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The security package is environment-agnostic by design: it must behave identically
    // in an offscreen document and in a dedicated worker, so the unit suite runs in plain
    // Node and the BROWSER matrix (G1/G2/G3) is a separate, real-browser gate.
    environment: "node",
    include: ["packages/*/test/**/*.test.ts"],
    reporters: ["default"],
  },
  resolve: {
    alias: { "@pratibimb/security": new URL("./packages/security/src/index.ts", import.meta.url).pathname },
  },
});

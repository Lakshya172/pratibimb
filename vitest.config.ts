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
    alias: {
      "@pratibimb/security": new URL("./packages/security/src/index.ts", import.meta.url).pathname,
      "@pratibimb/perception": new URL("./packages/perception/src/index.ts", import.meta.url).pathname,
      "@pratibimb/evaluation": new URL("./packages/evaluation/src/index.ts", import.meta.url).pathname,
      "@pratibimb/agent": new URL("./packages/agent/src/index.ts", import.meta.url).pathname,
      "@pratibimb/extension-transport": new URL("./packages/extension-transport/src/index.ts", import.meta.url).pathname,
      "@pratibimb/privacy": new URL("./packages/privacy/src/index.ts", import.meta.url).pathname,
      "@pratibimb/egress": new URL("./packages/egress/src/index.ts", import.meta.url).pathname,
      "@pratibimb/reasoner": new URL("./packages/reasoner/src/index.ts", import.meta.url).pathname,
      "@pratibimb/plan": new URL("./packages/plan/src/index.ts", import.meta.url).pathname,
      "@pratibimb/orchestrator": new URL("./packages/orchestrator/src/index.ts", import.meta.url).pathname,
    },
  },
});

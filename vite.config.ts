import { defineConfig } from "vite";

// Single config for both the dev server and the Vitest test runner.
// `host: true` binds all interfaces so the sim is reachable from other
// devices on the home network for testing.
export default defineConfig({
  server: { host: true },
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});

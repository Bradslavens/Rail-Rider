import { defineConfig, type Plugin } from "vite";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Dev-only API so the in-app signal editor can persist edits straight to the
 * repo. POST /api/signals with a SignalSet body writes data/signals.json (the
 * committed source) and public/data/signals.json (what the running app fetches).
 */
function signalsApi(): Plugin {
  return {
    name: "rail-rider-signals-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api/signals", (req, res, next) => {
        if (req.method !== "POST") return next();
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          try {
            const data = JSON.parse(body);
            if (!data || !Array.isArray(data.signals)) {
              throw new Error("body must be { signals: [...] }");
            }
            const json = JSON.stringify(data, null, 2) + "\n";
            writeFileSync(resolve(HERE, "data/signals.json"), json);
            mkdirSync(resolve(HERE, "public/data"), { recursive: true });
            writeFileSync(resolve(HERE, "public/data/signals.json"), json);
            res.statusCode = 200;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true, count: data.signals.length }));
          } catch (err) {
            res.statusCode = 400;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: false, error: String(err) }));
          }
        });
      });
    },
  };
}

// Single config for both the dev server and the Vitest test runner.
// `host: true` binds all interfaces so the sim is reachable from other
// devices on the home network for testing.
export default defineConfig({
  plugins: [signalsApi()],
  server: { host: true },
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});

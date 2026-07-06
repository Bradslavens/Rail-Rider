import { defineConfig, type Plugin } from "vite";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Dev-only API so the in-app admin editor can persist edits straight to the
 * repo. Each endpoint writes data/<file> (the committed source) and
 * public/data/<file> (what the running app fetches):
 *   POST /api/signals   { signals: [...] } -> signals.json
 *   POST /api/stations  { edits: [...] }   -> stationEdits.json
 *   POST /api/crossings { edits: [...] }   -> crossingEdits.json
 */
function editApi(name: string, route: string, file: string, listKey: string): Plugin {
  return {
    name: `rail-rider-${name}-api`,
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(route, (req, res, next) => {
        if (req.method !== "POST") return next();
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          try {
            const data = JSON.parse(body);
            if (!data || !Array.isArray(data[listKey])) {
              throw new Error(`body must be { ${listKey}: [...] }`);
            }
            const json = JSON.stringify(data, null, 2) + "\n";
            writeFileSync(resolve(HERE, `data/${file}`), json);
            mkdirSync(resolve(HERE, "public/data"), { recursive: true });
            writeFileSync(resolve(HERE, `public/data/${file}`), json);
            res.statusCode = 200;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true, count: data[listKey].length }));
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
  plugins: [
    editApi("signals", "/api/signals", "signals.json", "signals"),
    editApi("stations", "/api/stations", "stationEdits.json", "edits"),
    editApi("crossings", "/api/crossings", "crossingEdits.json", "edits"),
  ],
  server: { host: true },
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});

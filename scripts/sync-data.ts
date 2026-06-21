// Copy the committed pipeline output into public/data so Vite serves it at
// /data/*.json. Runs automatically before `dev` and `build`.

import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../pipeline/out");
const DEST = resolve(HERE, "../public/data");
const FILES = ["tracks.json", "stations.json", "meta.json"];

mkdirSync(DEST, { recursive: true });
for (const f of FILES) {
  const src = resolve(OUT, f);
  if (!existsSync(src)) {
    console.error(`Missing ${src}. Run \`npm run pipeline\` first.`);
    process.exit(1);
  }
  copyFileSync(src, resolve(DEST, f));
}
console.log(`Synced ${FILES.length} data files -> public/data`);

import { build } from "esbuild";
import { cpSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const dist = resolve(root, "dist");
const out = resolve(root, "out");

if (!existsSync(out)) {
  console.error("Missing out/ folder. Run `npm run build:ui` first.");
  process.exit(1);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(out, dist, { recursive: true });
cpSync(resolve(root, "src/manifest.json"), resolve(dist, "manifest.json"));

await build({
  entryPoints: [resolve(root, "src/background/index.ts")],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2020",
  outfile: resolve(dist, "background/index.js")
});

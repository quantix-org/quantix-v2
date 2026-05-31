import { mkdir, cp, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const src = resolve(root, "src");
const dist = resolve(root, "dist");

const entryPoints = [
  resolve(src, "background/index.ts"),
  resolve(src, "content/index.ts"),
  resolve(src, "inpage/provider.ts"),
  resolve(src, "popup/index.ts"),
  resolve(src, "options/index.ts"),
];

await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, "popup"), { recursive: true });
await mkdir(resolve(dist, "options"), { recursive: true });
await mkdir(resolve(dist, "inpage"), { recursive: true });
await mkdir(resolve(dist, "background"), { recursive: true });
await mkdir(resolve(dist, "content"), { recursive: true });

await esbuild.build({
  entryPoints,
  outdir: dist,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome120"],
  sourcemap: true,
  logLevel: "info",
});

await cp(resolve(src, "manifest.json"), resolve(dist, "manifest.json"));
await cp(resolve(src, "popup/index.html"), resolve(dist, "popup/index.html"));
await cp(resolve(src, "options/index.html"), resolve(dist, "options/index.html"));

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const sourceLogo = path.join(projectRoot, "assets", "logo.png");
const outputRoot = path.join(projectRoot, ".output", "chrome-mv3");
const manifestPath = path.join(outputRoot, "manifest.json");
const actionIconDir = path.join(outputRoot, "action-icon");

const sizes = [16, 32, 48, 128];

async function generateActionIcons() {
  await mkdir(actionIconDir, { recursive: true });

  for (const size of sizes) {
    const target = path.join(actionIconDir, `${size}.png`);
    await sharp(sourceLogo)
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ quality: 100, compressionLevel: 9 })
      .toFile(target);
  }
}

async function patchManifest() {
  const raw = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(raw);

  manifest.action = manifest.action || {};
  manifest.action.default_icon = {
    16: "action-icon/16.png",
    32: "action-icon/32.png",
    48: "action-icon/48.png",
    128: "action-icon/128.png"
  };

  await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
}

async function main() {
  await generateActionIcons();
  await patchManifest();
  console.log("[postbuild] action icons generated and manifest patched");
}

main().catch((error) => {
  console.error("[postbuild] failed:", error);
  process.exit(1);
});

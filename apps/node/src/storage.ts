import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const STORE_FILE = "node-state.json";

export function loadPersistedNodeData<T>(dataDir: string): T | null {
  const filePath = join(dataDir, STORE_FILE);
  try {
    const raw = readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export function savePersistedNodeData<T>(dataDir: string, data: T): void {
  mkdirSync(dataDir, { recursive: true });

  const filePath = join(dataDir, STORE_FILE);
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const payload = JSON.stringify(data, null, 2);

  writeFileSync(tempPath, payload, "utf8");
  renameSync(tempPath, filePath);
}

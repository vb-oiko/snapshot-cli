import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PSNAP_DIR = path.join(os.homedir(), ".psnap");

export const paths = {
  root: PSNAP_DIR,
  sessionFile: path.join(PSNAP_DIR, "session.json"),
  artifactsDir: path.join(PSNAP_DIR, "artifacts"),
  configFile: path.join(PSNAP_DIR, "config.json"),
};

export function ensureDirs(): void {
  fs.mkdirSync(paths.artifactsDir, { recursive: true });
}

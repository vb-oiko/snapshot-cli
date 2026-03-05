import fs from "node:fs";
import { paths } from "./paths";
import type { SessionState } from "./types";

export function readSession(): SessionState | null {
  try {
    const raw = fs.readFileSync(paths.sessionFile, "utf8");
    return JSON.parse(raw) as SessionState;
  } catch {
    return null;
  }
}

export function writeSession(state: SessionState): void {
  fs.writeFileSync(paths.sessionFile, JSON.stringify(state), "utf8");
}

export function removeSession(): void {
  try {
    fs.unlinkSync(paths.sessionFile);
  } catch {}
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readLiveSession(): SessionState | null {
  const state = readSession();
  if (!state) return null;
  if (!isProcessAlive(state.pid)) {
    removeSession();
    return null;
  }
  return state;
}

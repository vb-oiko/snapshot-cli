import fs from "node:fs";
import { paths } from "./paths";

export interface PsnapConfig {
  outputThresholdBytes: number;
  consoleBufferSize: number;
  pruneOlderThanDays: number;
  pruneMaxMb: number;
}

const DEFAULTS: PsnapConfig = {
  outputThresholdBytes: 2048,
  consoleBufferSize: 500,
  pruneOlderThanDays: 7,
  pruneMaxMb: 100,
};

let _cached: PsnapConfig | null = null;

export function loadConfig(overrides: Partial<PsnapConfig> = {}): PsnapConfig {
  if (!_cached) {
    try {
      const raw = fs.readFileSync(paths.configFile, "utf8");
      const file = JSON.parse(raw) as Partial<PsnapConfig>;
      _cached = { ...DEFAULTS, ...file };
    } catch {
      _cached = { ...DEFAULTS };
    }
  }
  return { ..._cached, ...overrides };
}

export function resetConfigCache(): void {
  _cached = null;
}

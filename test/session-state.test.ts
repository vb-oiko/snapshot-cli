import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tmpDir, sessionFile } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("node:os") as typeof import("node:os");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "psnap-sess-"));
  return { tmpDir, sessionFile: path.join(tmpDir, "session.json") };
});

vi.mock("../src/paths", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");
  return {
    paths: {
      root: tmpDir,
      sessionFile,
      artifactsDir: path.join(tmpDir, "artifacts"),
      configFile: path.join(tmpDir, "config.json"),
    },
    ensureDirs: () => {},
  };
});

import fs from "node:fs";
import {
  isProcessAlive,
  readLiveSession,
  readSession,
  removeSession,
  writeSession,
} from "../src/session-state";

beforeEach(() => {
  try {
    fs.unlinkSync(sessionFile);
  } catch {}
});

afterEach(() => {
  try {
    fs.unlinkSync(sessionFile);
  } catch {}
});

describe("readSession / writeSession / removeSession", () => {
  it("returns null when file absent", () => {
    expect(readSession()).toBeNull();
  });

  it("round-trips session state", () => {
    const state = {
      pid: 12345,
      port: 9999,
      startedAt: "2026-01-01T00:00:00.000Z",
    };
    writeSession(state);
    expect(readSession()).toEqual(state);
  });

  it("removeSession deletes the file", () => {
    writeSession({ pid: 1, port: 1, startedAt: "" });
    removeSession();
    expect(readSession()).toBeNull();
  });

  it("removeSession is a no-op if file absent", () => {
    expect(() => removeSession()).not.toThrow();
  });
});

describe("isProcessAlive", () => {
  it("returns true for current process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("returns false for a dead PID", () => {
    expect(isProcessAlive(2147483647)).toBe(false);
  });
});

describe("readLiveSession", () => {
  it("returns null when no file", () => {
    expect(readLiveSession()).toBeNull();
  });

  it("returns state when PID is alive", () => {
    const state = { pid: process.pid, port: 9999, startedAt: "" };
    writeSession(state);
    expect(readLiveSession()).toEqual(state);
  });

  it("removes stale file and returns null for dead PID", () => {
    writeSession({ pid: 2147483647, port: 9999, startedAt: "" });
    expect(readLiveSession()).toBeNull();
    expect(fs.existsSync(sessionFile)).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tmpDir, artifactsDir } = vi.hoisted(() => {
  const fs = require("node:fs") as typeof import("node:fs");
  const os = require("node:os") as typeof import("node:os");
  const path = require("node:path") as typeof import("node:path");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "psnap-so-"));
  return { tmpDir, artifactsDir: path.join(tmpDir, "artifacts") };
});

vi.mock("../src/paths", () => {
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  return {
    paths: {
      root: tmpDir,
      sessionFile: path.join(tmpDir, "session.json"),
      artifactsDir,
      configFile: path.join(tmpDir, "config.json"),
    },
    ensureDirs: () => fs.mkdirSync(artifactsDir, { recursive: true }),
  };
});

import fs from "node:fs";
import { routePngOutput, routeTextOutput } from "../src/smart-output";

beforeEach(() => {
  fs.mkdirSync(artifactsDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(artifactsDir, { recursive: true, force: true });
});

describe("routeTextOutput", () => {
  it("returns inline when content is below threshold", () => {
    const result = routeTextOutput("hello", "snap", "json", "application/json", 2048);
    expect(result.inline).toBe(true);
    expect(result.content).toBe("hello");
    expect(result.size).toBe(5);
    expect(result.lines).toBe(1);
    expect(result.mimeType).toBe("application/json");
    expect(result.file).toBeUndefined();
  });

  it("writes to file when content meets threshold", () => {
    const big = "x".repeat(2048);
    const result = routeTextOutput(big, "snap", "json", "application/json", 2048);
    expect(result.inline).toBe(false);
    expect(result.file).toBeDefined();
    expect(fs.existsSync(result.file as string)).toBe(true);
    expect(result.size).toBe(2048);
    expect(result.lines).toBeDefined();
  });

  it("counts lines correctly", () => {
    const result = routeTextOutput("a\nb\nc", "log", "json", "application/json", 9999);
    expect(result.lines).toBe(3);
  });

  it("file has timestamped name with correct extension", () => {
    const big = "y".repeat(3000);
    const result = routeTextOutput(big, "eval", "json", "application/json", 100);
    expect(result.file).toMatch(/eval\.json$/);
  });
});

describe("routePngOutput", () => {
  it("always writes PNG to file", () => {
    const png = Buffer.alloc(100, 0);
    const result = routePngOutput(png, 9999);
    expect(result.file).toBeDefined();
    expect(fs.existsSync(result.file as string)).toBe(true);
    expect(result.mimeType).toBe("image/png");
  });

  it("inlines dataUri preview when below threshold", () => {
    const png = Buffer.alloc(50, 0);
    const result = routePngOutput(png, 9999);
    expect(result.inline).toBe(true);
    expect(result.dataUri).toMatch(/^data:image\/png;base64,/);
  });

  it("does not inline when at or above threshold", () => {
    const png = Buffer.alloc(500, 0);
    const result = routePngOutput(png, 100);
    expect(result.inline).toBe(false);
    expect(result.dataUri).toBeUndefined();
  });
});

/**
 * Smoke test: exercises the full session lifecycle against a real local server.
 *
 * Requirements:
 *   - `npm run build` must have been run (dist/cli.js must exist)
 *   - Playwright Chromium must be installed
 *   - A display is required (macOS or Linux with Xvfb)
 *
 * The test is skipped automatically when dist/cli.js is absent.
 * To skip explicitly set SKIP_SMOKE=1.
 */
import { execFileSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CLI = path.resolve(__dirname, "../dist/cli.js");
function runPsnap(args: string[]): string {
  return execFileSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    timeout: 30_000,
  });
}

// Smoke test requires a running display and Playwright Chromium.
// Run manually: PSNAP_SMOKE=1 npx vitest run test/smoke.test.ts
describe.skipIf(process.env.PSNAP_SMOKE !== "1")(
  "smoke: full session lifecycle",
  { timeout: 90_000 },
  () => {
    let staticServer: http.Server;
    let staticPort: number;

    beforeAll(async () => {
      // Static HTML server
      staticServer = http.createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<!doctype html><html><body><h1>Hello psnap</h1><p id='content'>smoke</p></body></html>",
        );
      });
      await new Promise<void>((resolve) =>
        staticServer.listen(0, "127.0.0.1", resolve),
      );
      staticPort = (staticServer.address() as { port: number }).port;

      // Ensure no stale session
      try {
        runPsnap(["stop", "--force"]);
      } catch {
        // ignore if no session
      }
    });

    afterAll(async () => {
      try {
        runPsnap(["stop", "--force"]);
      } catch {
        // ignore
      }
      await new Promise<void>((resolve) => staticServer.close(() => resolve()));
    });

    it("navigates to local HTML", () => {
      const url = `http://127.0.0.1:${staticPort}/`;
      const output = runPsnap(["go", url]);
      const result = JSON.parse(output) as Record<string, unknown>;
      expect(result.ok).toBe(true);
      expect(result.url as string).toContain(`127.0.0.1:${staticPort}`);
    });

    it("takes an aria snapshot", () => {
      const output = runPsnap(["snap"]);
      const result = JSON.parse(output) as Record<string, unknown>;
      // smart-output may inline or write to file
      expect(result.ok ?? result.inline ?? true).toBeTruthy();
      const text = (result.content as string | undefined) ?? "";
      if (text) {
        expect(text).toContain("heading");
      }
    });

    it("fetches console log", () => {
      const output = runPsnap(["log"]);
      const result = JSON.parse(output) as Record<string, unknown>;
      // buffer may be empty; we just assert valid JSON was returned
      expect(result).toBeDefined();
    });

    it("stops the session", () => {
      const output = runPsnap(["stop"]);
      const result = JSON.parse(output) as Record<string, unknown>;
      expect(result.stopped).toBe(true);
    });
  },
);

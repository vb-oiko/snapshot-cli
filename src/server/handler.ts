import fs from "node:fs";
import type http from "node:http";
import nodePath from "node:path";
import { ensureDirs, paths } from "../paths";
import type { ConsoleBuffer, NetworkRecord } from "../types";

export interface PlaywrightRequestLike {
  url(): string;
  method(): string;
  headers(): Record<string, string>;
  postData(): string | null;
}

export interface PlaywrightResponseLike {
  body(): Promise<Buffer>;
  headers(): Record<string, string>;
  url(): string;
  request(): { method(): string };
  status(): number;
}

export interface PageLocator {
  ariaSnapshot(): Promise<string>;
}

export interface PageLike {
  url(): string;
  on(event: string, listener: (...args: unknown[]) => unknown): void;
  off(event: string, listener: (...args: unknown[]) => unknown): void;
  goto(
    url: string,
    opts?: { waitUntil?: string; timeout?: number },
  ): Promise<{ status(): number } | null>;
  title(): Promise<string>;
  waitForSelector(
    selector: string,
    opts?: { timeout?: number },
  ): Promise<unknown>;
  locator(selector: string): PageLocator;
  screenshot(opts?: { type?: string }): Promise<Buffer>;
  evaluate(script: string): Promise<unknown>;
  click(selector: string, opts?: { timeout?: number }): Promise<void>;
  fill(
    selector: string,
    value: string,
    opts?: { timeout?: number },
  ): Promise<void>;
}

export interface BrowserServerLike {
  wsEndpoint(): string;
}

export interface HandlerDeps {
  page: PageLike;
  browserServer: BrowserServerLike;
  getPort(): number;
  consoleBuffer: ConsoleBuffer;
  config: { consoleBufferSize: number };
  startedAt: string;
  onShutdown?: () => void;
}

interface RecordingState {
  file: string;
  linesWritten: number;
  onRequest: (...args: unknown[]) => void;
  onResponse: (...args: unknown[]) => void;
}

function appendJsonl(file: string, obj: unknown): void {
  fs.appendFileSync(file, `${JSON.stringify(obj)}\n`, "utf8");
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function send(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(json);
}

export interface HandlerResult {
  handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void>;
  stopRecording(): { file: string; linesWritten: number } | null;
}

export function createHandler(deps: HandlerDeps): HandlerResult {
  const { getPort, consoleBuffer, startedAt } = deps;
  // page and browserServer are accessed via deps each time to support lazy initialization
  // (the server's main() assigns these after createHandler is called)
  let recording: RecordingState | null = null;
  let bodyCounter = 0;

  function startRecording(file: string): void {
    stopRecording();
    fs.mkdirSync(nodePath.dirname(file), { recursive: true });

    const state: RecordingState = {
      file,
      linesWritten: 0,
      onRequest: (req: unknown) => {
        const r = req as PlaywrightRequestLike;
        const line: NetworkRecord = {
          type: "request",
          timestamp: new Date().toISOString(),
          url: r.url(),
          method: r.method(),
          headers: r.headers(),
          postData: r.postData() ?? undefined,
        };
        appendJsonl(file, line);
        state.linesWritten += 1;
      },
      onResponse: async (res: unknown) => {
        try {
          const r = res as PlaywrightResponseLike;
          const bodyBuf = await r.body().catch(() => Buffer.alloc(0));
          const bodySize = bodyBuf.length;
          const preview = bodyBuf.slice(0, 128).toString("utf8");
          const bodyTruncated = bodySize > 128 ? true : undefined;
          const contentType = (
            r.headers()["content-type"] ?? ""
          ).toLowerCase();
          const isJson = contentType.includes("application/json");

          let bodyFile: string | undefined;
          if (isJson && bodySize > 0) {
            ensureDirs();
            const ts = new Date().toISOString().replace(/[:.]/g, "-");
            bodyFile = nodePath.join(
              paths.artifactsDir,
              `${ts}-body-${++bodyCounter}.json`,
            );
            fs.writeFileSync(bodyFile, bodyBuf);
          }

          const line: NetworkRecord = {
            type: "response",
            timestamp: new Date().toISOString(),
            url: r.url(),
            method: r.request().method(),
            headers: r.headers(),
            status: r.status(),
            body: preview,
            bodySize,
            bodyTruncated,
            bodyFile,
          };
          appendJsonl(file, line);
          state.linesWritten += 1;
        } catch {}
      },
    };

    deps.page.on("request", state.onRequest);
    deps.page.on("response", state.onResponse);
    recording = state;
  }

  function stopRecording(): { file: string; linesWritten: number } | null {
    if (!recording) return null;
    deps.page.off("request", recording.onRequest);
    deps.page.off("response", recording.onResponse);
    const result = {
      file: recording.file,
      linesWritten: recording.linesWritten,
    };
    recording = null;
    return result;
  }

  async function handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    if (method === "GET" && url === "/status") {
      send(res, 200, {
        active: true,
        pid: process.pid,
        port: getPort(),
        url: deps.page.url(),
        startedAt,
      });
      return;
    }

    if (method === "GET" && url === "/ws-endpoint") {
      send(res, 200, { wsEndpoint: deps.browserServer.wsEndpoint() });
      return;
    }

    if (method === "GET" && url.startsWith("/console")) {
      const params = new URL(url, "http://localhost").searchParams;
      const tailParam = params.get("tail");
      const tail = tailParam ? Number.parseInt(tailParam, 10) : undefined;
      const level = params.get("level") ?? undefined;
      const clear = params.get("clear") === "true";

      let msgs = consoleBuffer.messages;
      if (level) msgs = msgs.filter((m) => m.level === level);
      if (tail && tail > 0) msgs = msgs.slice(-tail);

      const result = {
        messages: msgs,
        _truncated: consoleBuffer._truncated,
        _droppedCount: consoleBuffer._droppedCount,
      };

      if (clear) {
        consoleBuffer.messages = [];
        consoleBuffer._truncated = false;
        consoleBuffer._droppedCount = 0;
      }

      send(res, 200, result);
      return;
    }

    if (method === "POST" && url === "/navigate") {
      const body = JSON.parse(await readBody(req)) as {
        url: string;
        wait?: string;
        waitTimeout?: number;
        record?: string;
        stopRecord?: boolean;
      };

      if (body.stopRecord) {
        const stopped = stopRecording();
        send(
          res,
          200,
          stopped
            ? { ok: true, ...stopped }
            : { ok: false, reason: "no active recording" },
        );
        return;
      }

      if (!body.record) stopRecording();
      if (body.record) startRecording(body.record);

      try {
        const response = await deps.page.goto(body.url, {
          waitUntil: "networkidle",
          timeout: 30000,
        });

        if (body.wait) {
          await deps.page.waitForSelector(body.wait, {
            timeout: body.waitTimeout ?? 5000,
          });
        }

        send(res, 200, {
          ok: true,
          url: deps.page.url(),
          title: await deps.page.title(),
          status: response?.status() ?? null,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isTimeout =
          msg.includes("timeout") || msg.includes("Timeout");
        send(res, 200, {
          ok: false,
          error: isTimeout
            ? body.wait
              ? "wait timeout"
              : "timeout"
            : msg,
          url: body.url,
          selector: body.wait,
        });
      }
      return;
    }

    if (method === "POST" && url === "/snap") {
      const body = JSON.parse(await readBody(req)) as { selector?: string };
      try {
        const locator = body.selector
          ? deps.page.locator(body.selector)
          : deps.page.locator("html");
        const snapshot = await locator.ariaSnapshot();
        send(res, 200, { ok: true, snapshot });
      } catch (err) {
        send(res, 500, { ok: false, error: (err as Error).message });
      }
      return;
    }

    if (method === "POST" && url === "/shot") {
      const png = await deps.page.screenshot({ type: "png" });
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(png);
      return;
    }

    if (method === "POST" && url === "/eval") {
      const body = JSON.parse(await readBody(req)) as { script: string };
      try {
        const result = await deps.page.evaluate(body.script);
        send(res, 200, { ok: true, result });
      } catch (err) {
        send(res, 200, { ok: false, error: (err as Error).message });
      }
      return;
    }

    if (method === "POST" && url === "/click") {
      const body = JSON.parse(await readBody(req)) as { selector: string };
      try {
        await deps.page.click(body.selector, { timeout: 5000 });
        send(res, 200, { ok: true });
      } catch {
        send(res, 200, {
          ok: false,
          error: `selector not found: ${body.selector}`,
        });
      }
      return;
    }

    if (method === "POST" && url === "/fill") {
      const body = JSON.parse(await readBody(req)) as {
        selector: string;
        value: string;
      };
      try {
        await deps.page.fill(body.selector, body.value, { timeout: 5000 });
        send(res, 200, { ok: true });
      } catch {
        send(res, 200, {
          ok: false,
          error: `selector not found: ${body.selector}`,
        });
      }
      return;
    }

    if (method === "POST" && url === "/wait") {
      const body = JSON.parse(await readBody(req)) as {
        selector: string;
        timeout?: number;
      };
      try {
        await deps.page.waitForSelector(body.selector, {
          timeout: body.timeout ?? 5000,
        });
        send(res, 200, { ok: true });
      } catch {
        send(res, 200, { ok: false, error: "timeout" });
      }
      return;
    }

    if (method === "POST" && url === "/shutdown") {
      send(res, 200, { ok: true });
      if (deps.onShutdown) setImmediate(deps.onShutdown);
      return;
    }

    res.writeHead(404);
    res.end();
  }

  return { handleRequest, stopRecording };
}

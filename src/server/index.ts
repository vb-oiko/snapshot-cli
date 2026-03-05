import fs from "node:fs";
import http from "node:http";
import nodePath from "node:path";
import { chromium } from "playwright";
import type { Browser, BrowserServer, Page } from "playwright";
import { loadConfig } from "../config";
import { ensureDirs, paths } from "../paths";
import { pruneArtifacts } from "../prune";
import { removeSession, writeSession } from "../session-state";
import type { ConsoleBuffer, ConsoleMessage, NetworkRecord } from "../types";

let browserServer: BrowserServer;
let browser: Browser;
let page: Page;
const startedAt = new Date().toISOString();
const config = loadConfig();

const consoleBuffer: ConsoleBuffer = {
  messages: [],
  _truncated: false,
  _droppedCount: 0,
};

function attachConsoleListener(): void {
  page.on("console", (msg) => {
    const entry: ConsoleMessage = {
      level: msg.type(),
      text: msg.text(),
      timestamp: new Date().toISOString(),
      url: page.url(),
      lineNumber: msg.location().lineNumber,
    };
    if (consoleBuffer.messages.length >= config.consoleBufferSize) {
      consoleBuffer.messages.shift();
      consoleBuffer._truncated = true;
      consoleBuffer._droppedCount += 1;
    }
    consoleBuffer.messages.push(entry);
  });
}

interface RecordingState {
  file: string;
  linesWritten: number;
  onRequest: (req: import("playwright").Request) => void;
  onResponse: (res: import("playwright").Response) => void;
}

let recording: RecordingState | null = null;
let bodyCounter = 0;

function appendJsonl(file: string, obj: unknown): void {
  fs.appendFileSync(file, `${JSON.stringify(obj)}\n`, "utf8");
}

function startRecording(file: string): void {
  stopRecording();
  fs.mkdirSync(nodePath.dirname(file), { recursive: true });

  const state: RecordingState = {
    file,
    linesWritten: 0,
    onRequest: (req) => {
      const line: NetworkRecord = {
        type: "request",
        timestamp: new Date().toISOString(),
        url: req.url(),
        method: req.method(),
        headers: req.headers(),
        postData: req.postData() ?? undefined,
      };
      appendJsonl(file, line);
      state.linesWritten += 1;
    },
    onResponse: async (res) => {
      try {
        const bodyBuf = await res.body().catch(() => Buffer.alloc(0));
        const bodySize = bodyBuf.length;
        const preview = bodyBuf.slice(0, 128).toString("utf8");
        const bodyTruncated = bodySize > 128 ? true : undefined;
        const contentType = (res.headers()["content-type"] ?? "").toLowerCase();
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
          url: res.url(),
          method: res.request().method(),
          headers: res.headers(),
          status: res.status(),
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

  page.on("request", state.onRequest);
  page.on("response", state.onResponse);
  recording = state;
}

function stopRecording(): { file: string; linesWritten: number } | null {
  if (!recording) return null;
  page.off("request", recording.onRequest);
  page.off("response", recording.onResponse);
  const result = { file: recording.file, linesWritten: recording.linesWritten };
  recording = null;
  return result;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(json);
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
      port: (server.address() as { port: number }).port,
      url: page.url(),
      startedAt,
    });
    return;
  }

  if (method === "GET" && url === "/ws-endpoint") {
    send(res, 200, { wsEndpoint: browserServer.wsEndpoint() });
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
      const response = await page.goto(body.url, {
        waitUntil: "networkidle",
        timeout: 30000,
      });

      if (body.wait) {
        await page.waitForSelector(body.wait, {
          timeout: body.waitTimeout ?? 5000,
        });
      }

      send(res, 200, {
        ok: true,
        url: page.url(),
        title: await page.title(),
        status: response?.status() ?? null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = msg.includes("timeout") || msg.includes("Timeout");
      send(res, 200, {
        ok: false,
        error: isTimeout ? (body.wait ? "wait timeout" : "timeout") : msg,
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
        ? page.locator(body.selector)
        : page.locator("html");
      const snapshot = await locator.ariaSnapshot();
      send(res, 200, { ok: true, snapshot });
    } catch (err) {
      send(res, 500, { ok: false, error: (err as Error).message });
    }
    return;
  }

  if (method === "POST" && url === "/shot") {
    const png = await page.screenshot({ type: "png" });
    res.writeHead(200, { "Content-Type": "image/png" });
    res.end(png);
    return;
  }

  if (method === "POST" && url === "/eval") {
    const body = JSON.parse(await readBody(req)) as { script: string };
    try {
      const result = await page.evaluate(body.script);
      send(res, 200, { ok: true, result });
    } catch (err) {
      send(res, 200, { ok: false, error: (err as Error).message });
    }
    return;
  }

  if (method === "POST" && url === "/click") {
    const body = JSON.parse(await readBody(req)) as { selector: string };
    try {
      await page.click(body.selector, { timeout: 5000 });
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
      await page.fill(body.selector, body.value, { timeout: 5000 });
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
      await page.waitForSelector(body.selector, {
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
    setImmediate(() => shutdown());
    return;
  }

  res.writeHead(404);
  res.end();
}

async function shutdown(): Promise<void> {
  stopRecording();
  try {
    await browser.close();
  } catch {}
  try {
    await browserServer.close();
  } catch {}
  removeSession();
  try {
    pruneArtifacts(loadConfig());
  } catch {}
  process.exit(0);
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    send(res, 500, { ok: false, error: (err as Error).message });
  });
});

async function main(): Promise<void> {
  ensureDirs();
  browserServer = await chromium.launchServer({ headless: false });
  browser = await chromium.connect(browserServer.wsEndpoint());
  const context = await browser.newContext();
  page = await context.newPage();
  await page.goto("about:blank");

  attachConsoleListener();

  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address() as { port: number };
    writeSession({ pid: process.pid, port, startedAt });
    process.stderr.write(`[psnap-server] pid=${process.pid} port=${port}\n`);
  });

  process.on("SIGTERM", () => {
    shutdown();
  });
}

main().catch((err) => {
  process.stderr.write(`[psnap-server] fatal: ${(err as Error).message}\n`);
  process.exit(1);
});

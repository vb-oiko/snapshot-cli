import http from "node:http";
import { chromium } from "playwright";
import type { Browser, BrowserServer, Page } from "playwright";
import { loadConfig } from "../config";
import { ensureDirs } from "../paths";
import { pruneArtifacts } from "../prune";
import { removeSession, writeSession } from "../session-state";
import type { ConsoleBuffer, ConsoleMessage } from "../types";
import { createHandler, type HandlerResult } from "./handler";

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

// biome-ignore lint/style/useConst: assigned after server is created (circular ref with getPort)
let app: HandlerResult;

const server = http.createServer((req, res) => {
  app.handleRequest(req, res).catch((err) => {
    const json = JSON.stringify({ ok: false, error: (err as Error).message });
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(json);
  });
});

app = createHandler({
  get page(): Page {
    return page;
  },
  get browserServer(): BrowserServer {
    return browserServer;
  },
  getPort: () => (server.address() as { port: number }).port,
  consoleBuffer,
  config,
  startedAt,
  onShutdown: () => {
    shutdown();
  },
});

async function shutdown(): Promise<void> {
  app.stopRecording();
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

async function main(): Promise<void> {
  ensureDirs();
  browserServer = await chromium.launchServer({ headless: false });
  browser = await chromium.connect(browserServer.wsEndpoint());
  const context = await browser.newContext({ viewport: { width: 1710, height: 1080 } });
  page = await context.newPage();
  await page.goto("about:blank");

  attachConsoleListener();
  page.on("framenavigated", () => {
    attachConsoleListener();
  });

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

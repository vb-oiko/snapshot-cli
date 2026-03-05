import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { paths } from "./paths";
import { readLiveSession } from "./session-state";
import type { SessionState } from "./types";

const SERVER_SCRIPT = path.join(__dirname, "server", "index.js");
const WAIT_MS = 5000;
const POLL_MS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForSession(): Promise<SessionState> {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const state = readLiveSession();
    if (state) return state;
  }
  throw new Error("timed out waiting for psnap session server to start");
}

export async function ensureSession(): Promise<SessionState> {
  const existing = readLiveSession();
  if (existing) return existing;

  // Spawn the session server as a detached process
  const child = spawn(process.execPath, [SERVER_SCRIPT], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });
  child.unref();

  return waitForSession();
}

export function serverUrl(port: number, path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

import http from "node:http";

export function httpRequest(
  port: number,
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path: urlPath,
        headers: data
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(data),
            }
          : {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString();
          try {
            resolve(JSON.parse(text));
          } catch {
            resolve(text);
          }
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

export async function httpRequestBinary(
  port: number,
  urlPath: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method: "POST", path: urlPath },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

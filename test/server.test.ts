import http from "node:http";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createHandler } from "../src/server/handler";
import type { ConsoleBuffer } from "../src/types";

type JsonBody = Record<string, unknown>;

async function httpRequest(
  port: number,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown; contentType: string }> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: payload
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks);
          const contentType = (res.headers["content-type"] as string) ?? "";
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw.toString());
          } catch {
            parsed = raw;
          }
          resolve({
            status: res.statusCode ?? 0,
            body: parsed,
            contentType,
          });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe("session server HTTP routes", () => {
  let server: http.Server;
  let port: number;

  const mockLocator = { ariaSnapshot: vi.fn<[], Promise<string>>() };
  const mockPage = {
    url: vi.fn<[], string>(),
    on: vi.fn(),
    off: vi.fn(),
    goto: vi.fn<[string, object?], Promise<{ status(): number } | null>>(),
    title: vi.fn<[], Promise<string>>(),
    waitForSelector: vi.fn<[string, object?], Promise<unknown>>(),
    locator: vi.fn<[string], typeof mockLocator>(),
    screenshot: vi.fn<[object?], Promise<Buffer>>(),
    evaluate: vi.fn<[string], Promise<unknown>>(),
    click: vi.fn<[string, object?], Promise<void>>(),
    fill: vi.fn<[string, string, object?], Promise<void>>(),
  };

  const mockBrowserServer = {
    wsEndpoint: vi.fn<[], string>(),
  };

  const consoleBuffer: ConsoleBuffer = {
    messages: [],
    _truncated: false,
    _droppedCount: 0,
  };

  beforeAll(async () => {
    const { handleRequest } = createHandler({
      page: mockPage,
      browserServer: mockBrowserServer,
      getPort: () => port,
      consoleBuffer,
      config: { consoleBufferSize: 500 },
      startedAt: "2024-01-01T00:00:00.000Z",
    });

    server = http.createServer((req, res) => {
      handleRequest(req, res).catch((err) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: (err as Error).message }));
      });
    });

    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    port = (server.address() as { port: number }).port;
  });

  afterAll(
    () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  );

  beforeEach(() => {
    vi.clearAllMocks();
    mockPage.url.mockReturnValue("https://example.com");
    mockPage.goto.mockResolvedValue({ status: () => 200 });
    mockPage.title.mockResolvedValue("Example");
    mockPage.evaluate.mockResolvedValue(42);
    mockPage.screenshot.mockResolvedValue(Buffer.alloc(100, 0));
    mockLocator.ariaSnapshot.mockResolvedValue("- heading: Hello");
    mockPage.locator.mockReturnValue(mockLocator);
    mockBrowserServer.wsEndpoint.mockReturnValue("ws://127.0.0.1:9999/");
    consoleBuffer.messages = [];
    consoleBuffer._truncated = false;
    consoleBuffer._droppedCount = 0;
  });

  describe("GET /status", () => {
    it("returns active status", async () => {
      const res = await httpRequest(port, "GET", "/status");
      expect(res.status).toBe(200);
      expect(res.body as JsonBody).toMatchObject({
        active: true,
        pid: process.pid,
        port,
        url: "https://example.com",
        startedAt: "2024-01-01T00:00:00.000Z",
      });
    });
  });

  describe("GET /ws-endpoint", () => {
    it("returns browser WebSocket endpoint", async () => {
      const res = await httpRequest(port, "GET", "/ws-endpoint");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ wsEndpoint: "ws://127.0.0.1:9999/" });
    });
  });

  describe("GET /console", () => {
    it("returns empty buffer initially", async () => {
      const res = await httpRequest(port, "GET", "/console");
      expect(res.status).toBe(200);
      expect(res.body as JsonBody).toMatchObject({
        messages: [],
        _truncated: false,
        _droppedCount: 0,
      });
    });

    it("filters messages by level", async () => {
      consoleBuffer.messages = [
        { level: "log", text: "hello", timestamp: "", url: "", lineNumber: 0 },
        { level: "error", text: "oops", timestamp: "", url: "", lineNumber: 0 },
      ];
      const res = await httpRequest(port, "GET", "/console?level=error");
      expect((res.body as JsonBody).messages).toEqual([
        expect.objectContaining({ level: "error", text: "oops" }),
      ]);
    });

    it("tails last N messages", async () => {
      consoleBuffer.messages = [
        { level: "log", text: "a", timestamp: "", url: "", lineNumber: 0 },
        { level: "log", text: "b", timestamp: "", url: "", lineNumber: 0 },
        { level: "log", text: "c", timestamp: "", url: "", lineNumber: 0 },
      ];
      const res = await httpRequest(port, "GET", "/console?tail=2");
      const msgs = (res.body as JsonBody).messages as JsonBody[];
      expect(msgs).toHaveLength(2);
      expect(msgs[1].text).toBe("c");
    });

    it("clears buffer when clear=true", async () => {
      consoleBuffer.messages = [
        { level: "log", text: "hi", timestamp: "", url: "", lineNumber: 0 },
      ];
      await httpRequest(port, "GET", "/console?clear=true");
      expect(consoleBuffer.messages).toHaveLength(0);
      expect(consoleBuffer._truncated).toBe(false);
    });
  });

  describe("POST /navigate", () => {
    it("navigates and returns ok with url, title, status", async () => {
      const res = await httpRequest(port, "POST", "/navigate", {
        url: "https://example.com",
      });
      expect(res.status).toBe(200);
      expect(res.body as JsonBody).toMatchObject({
        ok: true,
        url: "https://example.com",
        title: "Example",
        status: 200,
      });
      expect(mockPage.goto).toHaveBeenCalledWith(
        "https://example.com",
        expect.any(Object),
      );
    });

    it("returns ok:false on navigation error", async () => {
      mockPage.goto.mockRejectedValue(new Error("net::ERR_NAME_NOT_RESOLVED"));
      const res = await httpRequest(port, "POST", "/navigate", {
        url: "https://nonexistent.invalid",
      });
      expect(res.status).toBe(200);
      expect((res.body as JsonBody).ok).toBe(false);
    });

    it("returns ok:false with reason when no active recording on stopRecord", async () => {
      const res = await httpRequest(port, "POST", "/navigate", {
        url: "x",
        stopRecord: true,
      });
      expect(res.body as JsonBody).toMatchObject({
        ok: false,
        reason: "no active recording",
      });
    });

    it("calls waitForSelector when wait is provided", async () => {
      const res = await httpRequest(port, "POST", "/navigate", {
        url: "https://example.com",
        wait: "#content",
      });
      expect(res.status).toBe(200);
      expect(mockPage.waitForSelector).toHaveBeenCalledWith(
        "#content",
        expect.any(Object),
      );
    });
  });

  describe("POST /snap", () => {
    it("returns aria snapshot", async () => {
      const res = await httpRequest(port, "POST", "/snap", {});
      expect(res.status).toBe(200);
      expect(res.body as JsonBody).toMatchObject({
        ok: true,
        snapshot: "- heading: Hello",
      });
    });

    it("uses selector when provided", async () => {
      await httpRequest(port, "POST", "/snap", { selector: "#main" });
      expect(mockPage.locator).toHaveBeenCalledWith("#main");
    });

    it("returns 500 on snap failure", async () => {
      mockLocator.ariaSnapshot.mockRejectedValue(new Error("no element"));
      const res = await httpRequest(port, "POST", "/snap", {});
      expect(res.status).toBe(500);
      expect((res.body as JsonBody).ok).toBe(false);
    });
  });

  describe("POST /shot", () => {
    it("returns PNG image with correct content-type", async () => {
      const res = await httpRequest(port, "POST", "/shot", {});
      expect(res.status).toBe(200);
      expect(res.contentType).toBe("image/png");
      expect(res.body).toBeInstanceOf(Buffer);
    });
  });

  describe("POST /eval", () => {
    it("evaluates script and returns result", async () => {
      const res = await httpRequest(port, "POST", "/eval", { script: "1+1" });
      expect(res.status).toBe(200);
      expect(res.body as JsonBody).toMatchObject({ ok: true, result: 42 });
    });

    it("returns ok:false on eval error", async () => {
      mockPage.evaluate.mockRejectedValue(new Error("SyntaxError"));
      const res = await httpRequest(port, "POST", "/eval", { script: "!!!" });
      expect((res.body as JsonBody).ok).toBe(false);
    });
  });

  describe("POST /click", () => {
    it("returns ok:true on success", async () => {
      const res = await httpRequest(port, "POST", "/click", {
        selector: "#btn",
      });
      expect(res.body as JsonBody).toMatchObject({ ok: true });
      expect(mockPage.click).toHaveBeenCalledWith("#btn", { timeout: 5000 });
    });

    it("returns ok:false when selector not found", async () => {
      mockPage.click.mockRejectedValue(new Error("not found"));
      const res = await httpRequest(port, "POST", "/click", {
        selector: "#missing",
      });
      expect((res.body as JsonBody).ok).toBe(false);
    });
  });

  describe("POST /fill", () => {
    it("returns ok:true on success", async () => {
      const res = await httpRequest(port, "POST", "/fill", {
        selector: "#input",
        value: "hello",
      });
      expect(res.body as JsonBody).toMatchObject({ ok: true });
      expect(mockPage.fill).toHaveBeenCalledWith("#input", "hello", {
        timeout: 5000,
      });
    });

    it("returns ok:false when selector not found", async () => {
      mockPage.fill.mockRejectedValue(new Error("not found"));
      const res = await httpRequest(port, "POST", "/fill", {
        selector: "#missing",
        value: "x",
      });
      expect((res.body as JsonBody).ok).toBe(false);
    });
  });

  describe("POST /wait", () => {
    it("returns ok:true when selector found", async () => {
      const res = await httpRequest(port, "POST", "/wait", {
        selector: "#el",
      });
      expect(res.body as JsonBody).toMatchObject({ ok: true });
    });

    it("returns ok:false on timeout", async () => {
      mockPage.waitForSelector.mockRejectedValue(new Error("timeout"));
      const res = await httpRequest(port, "POST", "/wait", {
        selector: "#missing",
      });
      expect(res.body as JsonBody).toMatchObject({ ok: false, error: "timeout" });
    });
  });

  describe("POST /shutdown", () => {
    it("returns ok:true", async () => {
      const res = await httpRequest(port, "POST", "/shutdown", {});
      expect(res.body as JsonBody).toMatchObject({ ok: true });
    });
  });

  describe("unknown routes", () => {
    it("returns 404", async () => {
      const res = await httpRequest(port, "GET", "/unknown");
      expect(res.status).toBe(404);
    });
  });
});

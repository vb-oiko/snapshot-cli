import { describe, expect, it } from "vitest";
import type { NetworkRecord } from "../src/types";

// Pure serialization helpers — no browser needed

function makePreview(buf: Buffer): {
  body: string;
  bodyTruncated?: boolean;
  bodySize: number;
} {
  const preview = buf.slice(0, 128).toString("utf8");
  const bodyTruncated = buf.length > 128 ? true : undefined;
  return { body: preview, bodyTruncated, bodySize: buf.length };
}

function buildRequestLine(
  url: string,
  method: string,
  headers: Record<string, string>,
  postData?: string,
): NetworkRecord {
  return {
    type: "request",
    timestamp: new Date().toISOString(),
    url,
    method,
    headers,
    postData,
  };
}

function buildResponseLine(
  url: string,
  method: string,
  status: number,
  headers: Record<string, string>,
  bodyBuf: Buffer,
  bodyFile?: string,
): NetworkRecord {
  const { body, bodyTruncated, bodySize } = makePreview(bodyBuf);
  return {
    type: "response",
    timestamp: new Date().toISOString(),
    url,
    method,
    status,
    headers,
    body,
    bodySize,
    bodyTruncated,
    bodyFile,
  };
}

describe("JSONL request line", () => {
  it("includes all required fields", () => {
    const line = buildRequestLine("https://example.com", "GET", {
      "x-foo": "bar",
    });
    expect(line.type).toBe("request");
    expect(line.url).toBe("https://example.com");
    expect(line.method).toBe("GET");
    expect(line.headers).toEqual({ "x-foo": "bar" });
    expect(line.postData).toBeUndefined();
  });

  it("includes postData when present", () => {
    const line = buildRequestLine(
      "https://example.com/api",
      "POST",
      {},
      '{"a":1}',
    );
    expect(line.postData).toBe('{"a":1}');
  });
});

describe("JSONL response body preview", () => {
  it("inlines full body when <= 128 bytes", () => {
    const buf = Buffer.from("hello world");
    const { body, bodyTruncated, bodySize } = makePreview(buf);
    expect(body).toBe("hello world");
    expect(bodyTruncated).toBeUndefined();
    expect(bodySize).toBe(11);
  });

  it("truncates to 128 bytes and sets bodyTruncated when > 128 bytes", () => {
    const buf = Buffer.from("x".repeat(200));
    const { body, bodyTruncated, bodySize } = makePreview(buf);
    expect(body.length).toBe(128);
    expect(bodyTruncated).toBe(true);
    expect(bodySize).toBe(200);
  });

  it("response line has bodyFile for JSON responses", () => {
    const buf = Buffer.from('{"key":"value"}');
    const line = buildResponseLine(
      "https://api.example.com/data",
      "GET",
      200,
      { "content-type": "application/json" },
      buf,
      "/tmp/artifact.json",
    );
    expect(line.bodyFile).toBe("/tmp/artifact.json");
  });

  it("response line has no bodyFile for non-JSON responses", () => {
    const buf = Buffer.from("body { color: red }");
    const line = buildResponseLine(
      "https://example.com/style.css",
      "GET",
      200,
      { "content-type": "text/css" },
      buf,
    );
    expect(line.bodyFile).toBeUndefined();
  });
});

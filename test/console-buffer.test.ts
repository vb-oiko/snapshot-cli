import { describe, expect, it } from "vitest";
import type { ConsoleBuffer, ConsoleMessage } from "../src/types";

// Replicate the circular buffer logic from the server for unit testing

function makeBuffer(cap: number): ConsoleBuffer {
  return { messages: [], _truncated: false, _droppedCount: 0 };
}

function pushMessage(
  buf: ConsoleBuffer,
  msg: ConsoleMessage,
  cap: number,
): void {
  if (buf.messages.length >= cap) {
    buf.messages.shift();
    buf._truncated = true;
    buf._droppedCount += 1;
  }
  buf.messages.push(msg);
}

function makeMsg(level: string, text: string): ConsoleMessage {
  return {
    level,
    text,
    timestamp: new Date().toISOString(),
    url: "about:blank",
    lineNumber: 0,
  };
}

function filterBuffer(
  buf: ConsoleBuffer,
  level?: string,
  tail?: number,
): ConsoleMessage[] {
  let msgs = buf.messages;
  if (level) msgs = msgs.filter((m) => m.level === level);
  if (tail && tail > 0) msgs = msgs.slice(-tail);
  return msgs;
}

function clearBuffer(buf: ConsoleBuffer): void {
  buf.messages = [];
  buf._truncated = false;
  buf._droppedCount = 0;
}

describe("console circular buffer", () => {
  it("accumulates messages up to cap", () => {
    const buf = makeBuffer(3);
    pushMessage(buf, makeMsg("log", "a"), 3);
    pushMessage(buf, makeMsg("log", "b"), 3);
    pushMessage(buf, makeMsg("log", "c"), 3);
    expect(buf.messages).toHaveLength(3);
    expect(buf._truncated).toBe(false);
    expect(buf._droppedCount).toBe(0);
  });

  it("drops oldest message on overflow and sets _truncated", () => {
    const buf = makeBuffer(3);
    for (let i = 0; i < 4; i++) pushMessage(buf, makeMsg("log", `msg${i}`), 3);
    expect(buf.messages).toHaveLength(3);
    expect(buf.messages[0].text).toBe("msg1"); // oldest dropped
    expect(buf._truncated).toBe(true);
    expect(buf._droppedCount).toBe(1);
  });

  it("increments _droppedCount for each overflow", () => {
    const buf = makeBuffer(2);
    for (let i = 0; i < 5; i++) pushMessage(buf, makeMsg("log", `m${i}`), 2);
    expect(buf._droppedCount).toBe(3);
  });

  it("filters by level", () => {
    const buf = makeBuffer(10);
    pushMessage(buf, makeMsg("error", "bad"), 10);
    pushMessage(buf, makeMsg("log", "info"), 10);
    pushMessage(buf, makeMsg("error", "also bad"), 10);
    const errors = filterBuffer(buf, "error");
    expect(errors).toHaveLength(2);
    expect(errors.every((m) => m.level === "error")).toBe(true);
  });

  it("tail returns last N messages", () => {
    const buf = makeBuffer(10);
    for (let i = 0; i < 5; i++) pushMessage(buf, makeMsg("log", `m${i}`), 10);
    const last2 = filterBuffer(buf, undefined, 2);
    expect(last2).toHaveLength(2);
    expect(last2[0].text).toBe("m3");
    expect(last2[1].text).toBe("m4");
  });

  it("clear resets all state", () => {
    const buf = makeBuffer(2);
    for (let i = 0; i < 4; i++) pushMessage(buf, makeMsg("log", `m${i}`), 2);
    clearBuffer(buf);
    expect(buf.messages).toHaveLength(0);
    expect(buf._truncated).toBe(false);
    expect(buf._droppedCount).toBe(0);
  });
});

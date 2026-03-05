import fs from "node:fs";
import path from "node:path";
import { ensureDirs, paths } from "./paths";
import type { SmartOutputResult } from "./types";

function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.split("\n").length;
}

function timestampedFilename(cmd: string, ext: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `${ts}-${cmd}.${ext}`;
}

export function routeTextOutput(
  content: string,
  cmd: string,
  ext: string,
  mimeType: string,
  thresholdBytes: number,
): SmartOutputResult {
  const size = Buffer.byteLength(content, "utf8");
  const lines = countLines(content);

  if (size < thresholdBytes) {
    return { inline: true, content, size, lines, mimeType };
  }

  ensureDirs();
  const filename = timestampedFilename(cmd, ext);
  const file = path.join(paths.artifactsDir, filename);
  fs.writeFileSync(file, content, "utf8");
  return { inline: false, file, size, lines, mimeType };
}

export function routePngOutput(
  pngBuffer: Buffer,
  thresholdBytes: number,
): SmartOutputResult {
  ensureDirs();
  const filename = timestampedFilename("shot", "png");
  const file = path.join(paths.artifactsDir, filename);
  fs.writeFileSync(file, pngBuffer);
  const size = pngBuffer.length;

  if (size < thresholdBytes) {
    const dataUri = `data:image/png;base64,${pngBuffer.toString("base64")}`;
    return { inline: true, dataUri, file, size, mimeType: "image/png" };
  }

  return { inline: false, file, size, mimeType: "image/png" };
}

export function writeArtifact(
  content: string,
  cmd: string,
  ext: string,
): string {
  ensureDirs();
  const filename = timestampedFilename(cmd, ext);
  const file = path.join(paths.artifactsDir, filename);
  fs.writeFileSync(file, content, "utf8");
  return file;
}

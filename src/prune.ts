import fs from "node:fs";
import path from "node:path";
import type { PsnapConfig } from "./config";
import { paths } from "./paths";

interface ArtifactEntry {
  file: string;
  size: number;
  createdAt: string;
}

function listArtifacts(): ArtifactEntry[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(paths.artifactsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile())
    .map((e) => {
      const file = path.join(paths.artifactsDir, e.name);
      const stat = fs.statSync(file);
      return { file, size: stat.size, createdAt: stat.birthtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function pruneArtifacts(config: PsnapConfig): number {
  const artifacts = listArtifacts();
  const cutoffMs = config.pruneOlderThanDays * 24 * 60 * 60 * 1000;
  const maxBytes = config.pruneMaxMb * 1024 * 1024;
  const now = Date.now();

  let totalSize = artifacts.reduce((s, a) => s + a.size, 0);
  let deleted = 0;

  for (const artifact of [...artifacts].reverse()) {
    const age = now - new Date(artifact.createdAt).getTime();
    const tooOld = age > cutoffMs;
    const tooBig = totalSize > maxBytes;
    if (tooOld || tooBig) {
      try {
        fs.unlinkSync(artifact.file);
        totalSize -= artifact.size;
        deleted += 1;
      } catch {}
    }
  }
  return deleted;
}

export function listArtifactsMeta(): Array<{
  file: string;
  size: number;
  mimeType: string;
  createdAt: string;
  lines?: number;
}> {
  return listArtifacts().map((a) => ({
    ...a,
    mimeType: guessMime(a.file),
    lines: isText(a.file) ? countLines(a.file) : undefined,
  }));
}

function guessMime(file: string): string {
  if (file.endsWith(".json")) return "application/json";
  if (file.endsWith(".md")) return "text/markdown";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".jsonl")) return "application/x-ndjson";
  return "application/octet-stream";
}

function isText(file: string): boolean {
  return (
    file.endsWith(".json") || file.endsWith(".md") || file.endsWith(".jsonl")
  );
}

function countLines(file: string): number {
  try {
    const content = fs.readFileSync(file, "utf8");
    return content.length === 0 ? 0 : content.split("\n").length;
  } catch {
    return 0;
  }
}

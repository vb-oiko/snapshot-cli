import type { A11yNode, SnapshotResult } from "./types";

const INDENT = "  ";

type MarkdownParts = {
  lines: string[];
};

function formatMetadata(metadata: SnapshotResult["metadata"]): string[] {
  const lines: string[] = ["## metadata"];

  lines.push(`- timestamp: ${metadata.timestamp}`);
  lines.push(`- url: ${metadata.url}`);

  if (metadata.selector) {
    lines.push(`- selector: ${metadata.selector}`);
  }

  if (typeof metadata.maxDepth === "number") {
    lines.push(`- maxDepth: ${metadata.maxDepth}`);
  }

  if (typeof metadata.maxNodes === "number") {
    lines.push(`- maxNodes: ${metadata.maxNodes}`);
  }

  if (metadata.version) {
    lines.push(`- version: ${metadata.version}`);
  }

  if (metadata.truncated) {
    lines.push("- warning: output truncated by size limits");
  }

  if (Array.isArray(metadata.warnings)) {
    for (const warning of metadata.warnings) {
      lines.push(`- warning: ${warning}`);
    }
  }

  return lines;
}

function formatA11yLine(node: A11yNode): string {
  const parts: string[] = [];

  if (node.role) {
    parts.push(`role=${node.role}`);
  }

  if (typeof node.name === "string" && node.name.length > 0) {
    parts.push(`name=\"${node.name}\"`);
  }

  if (typeof node.value === "string" || typeof node.value === "number") {
    parts.push(`value=\"${node.value}\"`);
  }

  if (typeof node.checked === "boolean") {
    parts.push(`checked=${node.checked}`);
  }

  return parts.length > 0 ? parts.join(" ") : "node";
}

function renderA11yTree(
  node: A11yNode | null,
  depth: number,
  parts: MarkdownParts,
): void {
  if (!node) {
    return;
  }

  const indent = INDENT.repeat(Math.max(0, depth));
  parts.lines.push(`${indent}- ${formatA11yLine(node)}`);

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      renderA11yTree(child, depth + 1, parts);
    }
  }
}

export function formatMarkdown(result: SnapshotResult): string {
  const parts: MarkdownParts = { lines: [] };

  parts.lines.push("# snapshot");
  parts.lines.push("");
  parts.lines.push(...formatMetadata(result.metadata));
  parts.lines.push("");
  parts.lines.push("## a11y");

  if (result.a11y) {
    renderA11yTree(result.a11y, 0, parts);
  } else {
    parts.lines.push("- (no snapshot)");
  }

  if (result.dom) {
    parts.lines.push("");
    parts.lines.push("## dom");
    parts.lines.push("```html");
    parts.lines.push(result.dom);
    parts.lines.push("```");
  }

  return parts.lines.join("\n");
}

export function formatJson(result: SnapshotResult): string {
  return JSON.stringify(result, null, 2);
}

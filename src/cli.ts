import { Command } from "commander";
import fs from "node:fs/promises";
import path from "node:path";
import { captureSnapshot } from "./snapshot";
import { formatJson, formatMarkdown } from "./format";
import type { OutputFormat, SnapshotOptions } from "./types";
import { z } from "zod";

const pkg = require("../package.json") as { version?: string };

const program = new Command();

program
  .name("psnap")
  .description("Capture Playwright accessibility snapshots to disk")
  .version(pkg.version ?? "0.0.0")
  .requiredOption("--url <url>", "target page url")
  .option("--out <file>", "output file path")
  .option("--out-dir <dir>", "output directory path")
  .option("--format <format>", "output format: json or md", "json")
  .option("--selector <selector>", "CSS selector to scope snapshot")
  .option("--dom", "include DOM slice for selector", false)
  .option("--max-depth <number>", "max depth for snapshot tree")
  .option("--max-nodes <number>", "max nodes for snapshot tree");

program.parse();

const opts = program.opts();

const schema = z
  .object({
    url: z.string().min(1, "--url is required"),
    out: z.string().optional(),
    outDir: z.string().optional(),
    format: z.enum(["json", "md"]).default("json"),
    selector: z.string().optional(),
    dom: z.boolean().optional(),
    maxDepth: z.coerce.number().int().positive().optional(),
    maxNodes: z.coerce.number().int().positive().optional()
  })
  .refine((data) => !(data.out && data.outDir), {
    message: "--out and --out-dir cannot be used together"
  })
  .refine((data) => Boolean(data.out || data.outDir), {
    message: "--out or --out-dir is required"
  })
  .refine((data) => !(data.dom && !data.selector), {
    message: "--selector is required when using --dom"
  });

async function run(): Promise<void> {
  const parsed = schema.parse(opts);
  const format = parsed.format as OutputFormat;
  const outDir = parsed.outDir;
  let out = parsed.out;

  if (!out && outDir) {
    out = path.join(outDir, `snapshot.${format}`);
  }

  const outputDir = outDir ?? path.dirname(out as string);
  await fs.mkdir(outputDir, { recursive: true });

  const options: SnapshotOptions = {
    url: parsed.url,
    out: out as string,
    outDir,
    format,
    selector: parsed.selector,
    dom: Boolean(parsed.dom),
    maxDepth: parsed.maxDepth,
    maxNodes: parsed.maxNodes
  };

  const result = await captureSnapshot(options);
  result.metadata.version = pkg.version;

  if (result.metadata.truncated) {
    process.stderr.write("warning: output truncated by size limits\n");
  }

  if (Array.isArray(result.metadata.warnings)) {
    for (const warning of result.metadata.warnings) {
      process.stderr.write(`warning: ${warning}\n`);
    }
  }

  const content = format === "md" ? formatMarkdown(result) : formatJson(result);
  await fs.writeFile(options.out, content, "utf8");
  process.stdout.write(`saved: ${options.out}\n`);
}

run().catch((error: unknown) => {
  if (error instanceof z.ZodError) {
    for (const issue of error.issues) {
      process.stderr.write(`${issue.message}\n`);
    }
    process.exitCode = 1;
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

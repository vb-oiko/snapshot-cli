import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { z } from "zod";
import { ensureSession, httpRequest, httpRequestBinary } from "./auto-start";
import { loadConfig } from "./config";
import { formatJson, formatMarkdown } from "./format";
import { paths } from "./paths";
import { listArtifactsMeta } from "./prune";
import { readLiveSession, removeSession } from "./session-state";
import { routePngOutput, routeTextOutput } from "./smart-output";
import { captureSnapshot } from "./snapshot";
import type { OutputFormat } from "./types";

const pkg = require("../package.json") as { version?: string };

const program = new Command();

program
  .name("psnap")
  .description(
    "Capture Playwright snapshots and control a persistent browser session",
  )
  .version(pkg.version ?? "0.0.0");

program
  .argument("[url]", "URL to snapshot (stateless headless mode)")
  .option("--url <url>", "target page URL (legacy flag, use positional arg)")
  .option("--out <file>", "output file path")
  .option("--out-dir <dir>", "output directory path")
  .option("--format <format>", "output format: json or md", "json")
  .option("--selector <selector>", "CSS selector to scope snapshot")
  .option("--dom", "include DOM slice for selector", false)
  .option("--max-depth <number>", "max depth for snapshot tree")
  .option("--max-nodes <number>", "max nodes for snapshot tree")
  .action(async (urlArg: string | undefined) => {
    const opts = program.opts();
    const url = urlArg ?? opts.url;
    if (!url) return;

    const schema = z
      .object({
        url: z.string().min(1),
        out: z.string().optional(),
        outDir: z.string().optional(),
        format: z.enum(["json", "md"]).default("json"),
        selector: z.string().optional(),
        dom: z.boolean().optional(),
        maxDepth: z.coerce.number().int().positive().optional(),
        maxNodes: z.coerce.number().int().positive().optional(),
      })
      .refine((d) => !(d.out && d.outDir), {
        message: "--out and --out-dir cannot be used together",
      })
      .refine((d) => !(d.dom && !d.selector), {
        message: "--selector is required when using --dom",
      });

    const parsed = schema.parse({ url, ...opts });
    const format = parsed.format as OutputFormat;

    let out = parsed.out;
    const outDir = parsed.outDir;
    if (!out && !outDir) {
      const config = loadConfig();
      const result = await captureSnapshot({
        url: parsed.url,
        out: "",
        outDir,
        format,
        selector: parsed.selector,
        dom: Boolean(parsed.dom),
        maxDepth: parsed.maxDepth,
        maxNodes: parsed.maxNodes,
      });
      result.metadata.version = pkg.version;
      const content =
        format === "md" ? formatMarkdown(result) : formatJson(result);
      const output = routeTextOutput(
        content,
        "snap",
        format,
        format === "md" ? "text/markdown" : "application/json",
        config.outputThresholdBytes,
      );
      process.stdout.write(`${JSON.stringify(output)}\n`);
      return;
    }

    if (!out && outDir) out = path.join(outDir, `snapshot.${format}`);
    const outputDir = outDir ?? path.dirname(out as string);
    await fs.promises.mkdir(outputDir, { recursive: true });

    const result = await captureSnapshot({
      url: parsed.url,
      out: out as string,
      outDir,
      format,
      selector: parsed.selector,
      dom: Boolean(parsed.dom),
      maxDepth: parsed.maxDepth,
      maxNodes: parsed.maxNodes,
    });
    result.metadata.version = pkg.version;
    if (result.metadata.truncated)
      process.stderr.write("warning: output truncated by size limits\n");
    for (const w of result.metadata.warnings ?? [])
      process.stderr.write(`warning: ${w}\n`);
    const content =
      format === "md" ? formatMarkdown(result) : formatJson(result);
    await fs.promises.writeFile(out as string, content, "utf8");
    process.stdout.write(`saved: ${out}\n`);
  });

program
  .command("go <url>")
  .description("Navigate the session browser to a URL")
  .option("--wait <selector>", "wait for CSS selector after navigation")
  .option("--wait-timeout <ms>", "timeout for --wait in milliseconds", "5000")
  .option("--record <path>", "record all network traffic to a JSONL file")
  .option("--stop-record", "stop active network recording without navigating")
  .option("--threshold <bytes>", "smart-output threshold in bytes")
  .action(
    async (
      url: string,
      opts: {
        wait?: string;
        waitTimeout?: string;
        record?: string;
        stopRecord?: boolean;
        threshold?: string;
      },
    ) => {
      if (!opts.stopRecord) {
        try {
          new URL(url);
        } catch {
          process.stderr.write(`invalid URL: ${url}\n`);
          process.exitCode = 1;
          return;
        }
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
          process.stderr.write("URL must start with http:// or https://\n");
          process.exitCode = 1;
          return;
        }
      }
      const session = await ensureSession();
      const result = (await httpRequest(session.port, "POST", "/navigate", {
        url: opts.stopRecord ? undefined : url,
        wait: opts.wait,
        waitTimeout: opts.waitTimeout
          ? Number.parseInt(opts.waitTimeout, 10)
          : undefined,
        record: opts.record,
        stopRecord: opts.stopRecord,
      })) as Record<string, unknown>;
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (!result.ok) process.exitCode = 1;
    },
  );

program
  .command("snap")
  .description("Capture an accessibility tree snapshot of the current page")
  .option("--selector <css>", "scope snapshot to a CSS selector")
  .option("--threshold <bytes>", "smart-output threshold in bytes")
  .action(async (opts: { selector?: string; threshold?: string }) => {
    const session = await ensureSession();
    const config = loadConfig();
    const threshold = opts.threshold
      ? Number.parseInt(opts.threshold, 10)
      : config.outputThresholdBytes;
    const result = (await httpRequest(session.port, "POST", "/snap", {
      selector: opts.selector,
    })) as { ok: boolean; snapshot?: string; error?: string };
    if (!result.ok) {
      process.stderr.write(`snap error: ${result.error}\n`);
      process.exitCode = 1;
      return;
    }
    const output = routeTextOutput(
      result.snapshot as string,
      "snap",
      "txt",
      "text/plain",
      threshold,
    );
    process.stdout.write(`${JSON.stringify(output)}\n`);
  });

program
  .command("shot")
  .description("Take a screenshot of the current page")
  .option("--threshold <bytes>", "smart-output threshold in bytes")
  .action(async (opts: { threshold?: string }) => {
    const session = await ensureSession();
    const config = loadConfig();
    const threshold = opts.threshold
      ? Number.parseInt(opts.threshold, 10)
      : config.outputThresholdBytes;
    const png = await httpRequestBinary(session.port, "/shot");
    const output = routePngOutput(png, threshold);
    process.stdout.write(`${JSON.stringify(output)}\n`);
  });

program
  .command("log")
  .description("Retrieve browser console output from the session buffer")
  .option("--tail <n>", "return only the last N messages")
  .option(
    "--level <level>",
    "filter by log level (log, warn, error, info, debug)",
  )
  .option("--clear", "clear the buffer after fetching")
  .option("--threshold <bytes>", "smart-output threshold in bytes")
  .action(
    async (opts: {
      tail?: string;
      level?: string;
      clear?: boolean;
      threshold?: string;
    }) => {
      const session = await ensureSession();
      const config = loadConfig();
      const threshold = opts.threshold
        ? Number.parseInt(opts.threshold, 10)
        : config.outputThresholdBytes;

      const params = new URLSearchParams();
      if (opts.tail) params.set("tail", opts.tail);
      if (opts.level) params.set("level", opts.level);
      if (opts.clear) params.set("clear", "true");

      const result = (await httpRequest(
        session.port,
        "GET",
        `/console?${params}`,
      )) as { messages: unknown[]; _truncated: boolean; _droppedCount: number };
      const messagesJson = JSON.stringify(result.messages, null, 2);
      const output = routeTextOutput(
        messagesJson,
        "log",
        "json",
        "application/json",
        threshold,
      );
      process.stdout.write(
        `${JSON.stringify({
          ...output,
          _truncated: result._truncated,
          _droppedCount: result._droppedCount,
        })}\n`,
      );
    },
  );

program
  .command("eval [script]")
  .description("Evaluate JavaScript in the current page context")
  .option("--file <path>", "read script from file")
  .option("--threshold <bytes>", "smart-output threshold in bytes")
  .action(
    async (
      script: string | undefined,
      opts: { file?: string; threshold?: string },
    ) => {
      let code = script;
      if (opts.file) {
        code = fs.readFileSync(opts.file, "utf8");
      }
      if (!code) {
        process.stderr.write("provide a script or --file <path>\n");
        process.exitCode = 1;
        return;
      }
      const session = await ensureSession();
      const config = loadConfig();
      const threshold = opts.threshold
        ? Number.parseInt(opts.threshold, 10)
        : config.outputThresholdBytes;
      const result = (await httpRequest(session.port, "POST", "/eval", {
        script: code,
      })) as { ok: boolean; result?: unknown; error?: string };
      if (!result.ok) {
        process.stdout.write(
          `${JSON.stringify({ ok: false, error: result.error })}\n`,
        );
        process.exitCode = 1;
        return;
      }
      const serialized = JSON.stringify(result.result, null, 2);
      const size = Buffer.byteLength(serialized, "utf8");
      if (size < threshold) {
        process.stdout.write(
          `${JSON.stringify({ ok: true, result: result.result, size })}\n`,
        );
      } else {
        const { writeArtifact } = await import("./smart-output");
        const file = writeArtifact(serialized, "eval", "json");
        process.stdout.write(
          `${JSON.stringify({
            ok: true,
            inline: false,
            file,
            size,
            mimeType: "application/json",
          })}\n`,
        );
      }
    },
  );

program
  .command("click <selector>")
  .description("Click an element matching the CSS selector")
  .action(async (selector: string) => {
    const session = await ensureSession();
    const result = (await httpRequest(session.port, "POST", "/click", {
      selector,
    })) as { ok: boolean; error?: string };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) process.exitCode = 1;
  });

program
  .command("fill <selector> <value>")
  .description("Fill a form field matching the CSS selector with a value")
  .action(async (selector: string, value: string) => {
    const session = await ensureSession();
    const result = (await httpRequest(session.port, "POST", "/fill", {
      selector,
      value,
    })) as { ok: boolean; error?: string };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) process.exitCode = 1;
  });

program
  .command("wait <selector>")
  .description("Wait for a CSS selector to become visible")
  .option("--timeout <ms>", "timeout in milliseconds", "5000")
  .action(async (selector: string, opts: { timeout?: string }) => {
    const session = await ensureSession();
    const result = (await httpRequest(session.port, "POST", "/wait", {
      selector,
      timeout: opts.timeout ? Number.parseInt(opts.timeout, 10) : 5000,
    })) as { ok: boolean; error?: string };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) process.exitCode = 1;
  });

program
  .command("stop")
  .description("Stop the session server and close the browser")
  .option("--force", "remove stale session files even if server is not running")
  .action(async (opts: { force?: boolean }) => {
    const session = readLiveSession();
    if (!session) {
      if (opts.force) removeSession();
      process.stdout.write(
        `${JSON.stringify({ active: false, stopped: false })}\n`,
      );
      return;
    }
    try {
      await httpRequest(session.port, "POST", "/shutdown", {});
      process.stdout.write(
        `${JSON.stringify({ active: false, stopped: true })}\n`,
      );
    } catch {
      if (opts.force) removeSession();
      process.stdout.write(
        `${JSON.stringify({
          active: false,
          stopped: false,
          error: "server unreachable",
        })}\n`,
      );
    }
  });

program
  .command("status")
  .description("Show current session state")
  .action(async () => {
    const session = readLiveSession();
    if (!session) {
      process.stdout.write(`${JSON.stringify({ active: false })}\n`);
      return;
    }
    try {
      const result = (await httpRequest(
        session.port,
        "GET",
        "/status",
      )) as Record<string, unknown>;
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch {
      process.stdout.write(`${JSON.stringify({ active: false })}\n`);
    }
  });

program
  .command("test <test-file>")
  .description("Run a Playwright test file inside the active session browser")
  .allowUnknownOption(true)
  .action(async (testFile: string, opts: unknown, cmd: Command) => {
    if (!fs.existsSync(testFile)) {
      process.stderr.write(`test file not found: ${testFile}\n`);
      process.exitCode = 1;
      return;
    }
    const session = await ensureSession();
    const wsResult = (await httpRequest(
      session.port,
      "GET",
      "/ws-endpoint",
    )) as { wsEndpoint: string };
    const extraArgs = cmd.args.slice(1);
    const child = spawn("npx", ["playwright", "test", testFile, ...extraArgs], {
      stdio: "inherit",
      env: { ...process.env, PSNAP_WS_ENDPOINT: wsResult.wsEndpoint },
    });
    child.on("close", (code) => {
      process.exitCode = code ?? 0;
    });
  });

program
  .command("ls")
  .description("List captured artifacts")
  .action(() => {
    const artifacts = listArtifactsMeta();
    process.stdout.write(`${JSON.stringify(artifacts, null, 2)}\n`);
  });

program
  .command("clean")
  .description("Delete old artifacts")
  .option("--older-than <days>", "delete artifacts older than N days")
  .option("--all", "delete all artifacts")
  .option("--yes", "skip confirmation prompt")
  .action(
    async (opts: { olderThan?: string; all?: boolean; yes?: boolean }) => {
      const config = loadConfig();
      const days = opts.olderThan
        ? Number.parseInt(opts.olderThan, 10)
        : undefined;

      let toDelete: ReturnType<typeof listArtifactsMeta>;
      if (opts.all) {
        toDelete = listArtifactsMeta();
      } else {
        const cutoffMs =
          (days ?? config.pruneOlderThanDays) * 24 * 60 * 60 * 1000;
        const now = Date.now();
        toDelete = listArtifactsMeta().filter(
          (a) => now - new Date(a.createdAt).getTime() > cutoffMs,
        );
      }

      if (toDelete.length === 0) {
        process.stdout.write("no artifacts to delete\n");
        return;
      }

      process.stdout.write(`will delete ${toDelete.length} file(s):\n`);
      for (const a of toDelete) process.stdout.write(`  ${a.file}\n`);

      if (!opts.yes) {
        const readline = await import("node:readline");
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        const answer = await new Promise<string>((resolve) =>
          rl.question("proceed? [y/N] ", resolve),
        );
        rl.close();
        if (answer.toLowerCase() !== "y") {
          process.stdout.write("aborted\n");
          return;
        }
      }

      let deleted = 0;
      for (const a of toDelete) {
        try {
          fs.unlinkSync(a.file);
          deleted++;
        } catch {}
      }
      process.stdout.write(`deleted ${deleted} file(s)\n`);
    },
  );

program.parseAsync().catch((error: unknown) => {
  if (error instanceof z.ZodError) {
    for (const issue of error.issues)
      process.stderr.write(`${issue.message}\n`);
    process.exitCode = 1;
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

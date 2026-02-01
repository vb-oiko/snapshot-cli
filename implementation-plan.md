# implementation plan: snapshot-cli

## goals
- Ship a small TypeScript CLI that captures Playwright accessibility snapshots to disk.
- Keep default output compact and agent-friendly.
- Support optional DOM slices with size caps and selectors.
- Package as an npm CLI with a `bin` entry.

## scope (phase 1)
- CLI entrypoint with `--help` and version.
- Required flags: `--url`, `--out` (or `--out-dir`), `--format`.
- Snapshot default: a11y tree JSON (or Markdown when `--format md`).
- Optional DOM slice via `--dom` + `--selector`.
- Size controls: `--max-depth`, `--max-nodes`.
- First match only for selectors.
- Single output file by default.
- Selector-based scoping should be easy to use for “verify a value changed” workflows.
- Warn clearly when size caps truncate output.

## non-goals (phase 1)
- MCP integration.
- Locator/text/role selector syntax beyond CSS.
- Viewport-only mode.
- Multi-match output (`--all-matches`).

## decisions
- Default `--max-depth` and `--max-nodes` values: 12 and 1500.
- Markdown output shape: compact, scan-friendly outline with short metadata header, indented a11y tree lines, minimal inline attrs (role/name/value/checked), truncation warning near top, optional DOM in a fenced block.
- DOM output format: raw HTML string (future: optional JSON format).
- Error policy for no selector matches: warn and fallback to full a11y snapshot, except when `--dom` requires `--selector` (hard error).

## implementation steps

### 1) project scaffolding
- Initialize `package.json` with `bin` entry (e.g. `psnap`).
- Add TypeScript config and build pipeline (`tsc`).
- Install Playwright and minimal CLI deps (e.g., `yargs` or `commander`).
- Add `src/cli.ts` and `src/snapshot.ts`.

### 2) CLI contract
- Define flags and validation:
  - `--url` required unless `--input` (future)
  - `--out` conflicts with `--out-dir`
  - `--format` in `json | md`
  - `--selector` required when `--dom` is used
  - `--max-depth` and `--max-nodes` optional
- Normalize paths and create output directory if needed.
- Print concise errors to stderr with non-zero exit codes.
- Emit a clear warning when truncation occurs due to `--max-depth` or `--max-nodes`.

### 3) snapshot capture
- Launch Playwright (chromium) with a minimal context.
- Navigate to `--url` with a sensible timeout.
- Capture a11y snapshot (`page.accessibility.snapshot`), optionally scoped to selector.
- Apply size caps in post-processing (depth/nodes).
- If a selector is provided, prioritize that subtree for inclusion.

### 4) DOM slice capture (optional)
- When `--dom` is set, evaluate DOM and extract HTML for the selector.
- Apply size caps (nodes/depth) to DOM subtree (if feasible).
- Bundle DOM output into the same artifact when in single-file mode.

### 5) output formatting
- JSON output: object containing metadata + a11y + optional dom.
- Markdown output: headings for metadata, a11y tree, and optional dom block.
- Include metadata: timestamp, url, selector, size caps, tool version.

### 6) packaging
- Build to `dist/` with `bin` entry.
- Add minimal README usage examples and help text.
- Ensure `npx` and global install work.

### 7) tests (lightweight)
- Unit tests for:
  - size cap logic
  - output formatter (json/md)
  - argument validation
- Optional integration test against a local static html file.

## suggested file layout
- `src/cli.ts` (arg parsing + orchestration)
- `src/snapshot.ts` (Playwright calls + snapshot shaping)
- `src/format.ts` (json/md formatting)
- `src/limits.ts` (depth/node caps)
- `src/types.ts`
- `tests/`

## risks and mitigations
- Large pages produce huge trees: enforce size caps and warn on truncation.
- Selector not found: clear error or fallback to full a11y tree.
- DOM extraction size: keep optional and capped.

## milestones
- M1: CLI skeleton + a11y snapshot JSON output.
- M2: size caps + metadata + error handling.
- M3: Markdown formatting + optional DOM slice.
- M4: packaging and README polish.

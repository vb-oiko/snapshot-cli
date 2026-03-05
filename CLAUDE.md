# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm install
npm run build      # tsc → dist/, then injects shebang into dist/cli.js
npm run typecheck  # type-check without emitting
npm run lint       # Biome lint
npm run check      # Biome lint + format check
```

Pre-commit hook (lefthook) runs `typecheck` and `lint` automatically.

## Architecture

- **`src/cli.ts`** — entry point; parses args with `commander`, validates with `zod`, writes output file
- **`src/snapshot.ts`** — launches headless Chromium via Playwright, uses CDP (`Accessibility.getFullAXTree` / `getPartialAXTree`) to build an `A11yNode` tree
- **`src/limits.ts`** — applies `--max-depth` / `--max-nodes` to the tree, sets `truncated` flag
- **`src/format.ts`** — serializes `SnapshotResult` to JSON or Markdown
- **`src/types.ts`** — shared types

Compiled to CommonJS in `dist/`. Binary registered as `psnap` in `package.json#bin`.

## CLI flags

`--url` and one of `--out` / `--out-dir` are required. `--out` and `--out-dir` are mutually exclusive. `--dom` requires `--selector`.

# snapshot-cli

A CLI that saves Playwright snapshots to files for agent-friendly reading.

## status
Early draft. This folder captures the planning and naming context while the project setup is decided.

## goals
- Keep snapshot output out of model context by writing artifacts to disk.
- Default to a small, structured a11y snapshot with optional DOM slices.
- Stay CLI-first and easy to document with `--help`.

## non-goals
- Replace or wrap Playwright MCP servers.
- Build a full testing framework.

## disclaimer
`vb-oiko/snapshot-cli` is an independent project and is not affiliated with or endorsed by Microsoft or the Playwright project.

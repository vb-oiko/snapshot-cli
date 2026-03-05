# snapshot-cli (psnap)

A CLI for browser automation with a persistent, visible Chromium window. Keeps agent context small through smart output routing (inline when small, file when large).

## disclaimer

`vb-oiko/snapshot-cli` is an independent project and is not affiliated with or endorsed by Microsoft or the Playwright project.

## quick start

```sh
# One-shot stateless snapshot (headless, exits immediately)
psnap https://example.com

# Start a persistent session and navigate
psnap go https://example.com

# Take an accessibility snapshot of the live page
psnap snap

# Take a screenshot
psnap shot

# Evaluate JavaScript
psnap eval "document.title"

# Stop the session
psnap stop
```

## session commands

| Command | Description |
|---|---|
| `psnap go <url>` | Navigate to URL. Opens session if not running. |
| `psnap go <url> --wait <selector>` | Navigate and wait for a CSS selector |
| `psnap go <url> --record <file.jsonl>` | Record all network traffic to JSONL |
| `psnap go --stop-record` | Stop active network recording |
| `psnap snap` | Capture aria accessibility tree |
| `psnap snap --selector <css>` | Scope snapshot to a CSS selector |
| `psnap shot` | Take a PNG screenshot |
| `psnap log` | Retrieve browser console output |
| `psnap log --tail 20 --level error` | Last 20 error messages |
| `psnap log --clear` | Fetch and clear the console buffer |
| `psnap eval "<script>"` | Run JavaScript in the page context |
| `psnap eval --file script.js` | Run a script file |
| `psnap click <selector>` | Click an element |
| `psnap fill <selector> <value>` | Fill a form field |
| `psnap wait <selector>` | Wait for an element to be visible |
| `psnap status` | Show current session state as JSON |
| `psnap stop` | Close the browser and stop the session |
| `psnap stop --force` | Force-remove stale session files |

## artifact commands

| Command | Description |
|---|---|
| `psnap ls` | List captured artifacts |
| `psnap clean` | Delete old artifacts (prompts for confirmation) |
| `psnap clean --older-than 3 --yes` | Delete artifacts older than 3 days |
| `psnap clean --all --yes` | Delete all artifacts |

## stateless mode

```sh
# Headless snapshot with smart-output (no persistent session)
psnap https://example.com

# Legacy flags still work
psnap --url https://example.com --out snapshot.json
psnap --url https://example.com --out-dir ./snapshots --format md
```

## smart output

All content commands (`snap`, `shot`, `log`, `eval`) apply a size threshold (default **2 048 bytes**):

- **Below threshold** → content printed inline to stdout as JSON: `{ inline: true, content, size, lines, mimeType }`
- **At or above threshold** → written to `~/.psnap/artifacts/<timestamp>-<cmd>.<ext>`, metadata returned: `{ inline: false, file, size, lines, mimeType }`

Override per-command with `--threshold <bytes>`. Set a global default in `~/.psnap/config.json`:

```json
{ "outputThresholdBytes": 4096 }
```

## network recording

```sh
psnap go https://api.example.com --record traffic.jsonl
# ... interact with the page ...
psnap go --stop-record
```

Each line is a request or response:
- **Request**: `{ type, timestamp, url, method, headers, postData? }`
- **Response**: `{ type, timestamp, url, method, status, headers, body, bodySize, bodyTruncated?, bodyFile? }`

Body preview: first 128 bytes always included. For `application/json` responses, the full body is also saved to `~/.psnap/artifacts/` and the path returned in `bodyFile`.

## playwright test runner

Run a Playwright test file inside the live session window:

```sh
psnap test my.spec.ts
psnap test my.spec.ts --reporter=list
```

In test files, import the `psnapFixtures` helper to receive the session page:

```ts
import { psnapFixtures } from "psnap/fixtures";

const test = psnapFixtures;

test("my test", async ({ sessionPage }) => {
  await sessionPage.goto("https://example.com");
  // ...
});
```

Falls back to a fresh browser when `PSNAP_WS_ENDPOINT` is not set (i.e. outside `psnap test`).

## config

`~/.psnap/config.json` supports:

```json
{
  "outputThresholdBytes": 2048,
  "consoleBufferSize": 500,
  "pruneOlderThanDays": 7,
  "pruneMaxMb": 100
}
```

Artifacts are pruned automatically on `psnap stop`.

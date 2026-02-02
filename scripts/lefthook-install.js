const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const isCi = Boolean(process.env.CI || process.env.GITHUB_ACTIONS || process.env.BUILDKITE);
if (isCi) {
  process.exit(0);
}

const gitDir = path.join(process.cwd(), ".git");
if (!fs.existsSync(gitDir)) {
  process.exit(0);
}

try {
  execSync("npx lefthook install", { stdio: "inherit" });
} catch (error) {
  process.exitCode = 1;
}

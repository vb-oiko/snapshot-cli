// Fixtures for running Playwright tests inside a psnap session.
// Requires @playwright/test in the consuming project.
//
// Usage in a test file:
//   import { psnapFixtures } from "psnap/fixtures";
//   const test = psnapFixtures;
//   test("my test", async ({ sessionPage }) => { ... });

import { chromium } from "playwright";

// biome-ignore lint/suspicious/noExplicitAny: dynamic require for optional peer dep
const { test: base } = require("@playwright/test") as { test: any };

export const psnapFixtures = base.extend({
  sessionPage: async (_: unknown, use: (page: unknown) => Promise<void>) => {
    const wsEndpoint = process.env.PSNAP_WS_ENDPOINT;
    if (wsEndpoint) {
      const browser = await chromium.connect(wsEndpoint);
      const pages = browser.contexts().flatMap((c) => c.pages());
      const page =
        pages[0] ?? (await browser.newContext().then((ctx) => ctx.newPage()));
      await use(page);
    } else {
      const browser = await chromium.launch();
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await use(page);
      await browser.close();
    }
  },
});

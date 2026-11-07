// Design tests: real Chromium against the built app, outside services stubbed, at three widths and both
// themes. `npm run e2e` runs the flows, layout invariants and accessibility checks. Reference screenshots
// are compared only with E2E_VISUAL=1 (`npm run e2e:visual`), because they depend on the platform's font
// rendering: record them with `npm run e2e:update` on the machine that will compare them, and review the
// image diff after a deliberate design change (that review is the design review).
import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT || 3100);
export const BASE = process.env.E2E_BASE_URL || `http://127.0.0.1:${port}`;

const themes = ["dark", "light"] as const;
const sizes = {
  // The smallest phone still in use: a column that grows to its content shows up here first.
  narrow: { width: 320, height: 568 },
  phone: { width: 390, height: 844 },
  tablet: { width: 1024, height: 768 },
  laptop: { width: 1440, height: 900 },
} as const;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000, toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: "disabled", caret: "hide" } },
  fullyParallel: true,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}-{platform}{ext}",
  projects: Object.entries(sizes).flatMap(([size, viewport]) =>
    // The narrow size runs in one theme: it is a layout check, and the themes do not change layout.
    (size === "narrow" ? (["dark"] as const) : themes).map((theme) => ({
      name: `${size}-${theme}`,
      use: { viewport, colorScheme: theme, storageState: { cookies: [], origins: [{ origin: BASE, localStorage: [{ name: "bl.theme", value: theme }] }] } },
    })),
  ),
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: `npx next start -p ${port}`, url: `${BASE}/`, timeout: 120_000, reuseExistingServer: !process.env.CI },
});

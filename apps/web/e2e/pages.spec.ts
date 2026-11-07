// Every page that renders without a planning run, in every project (width × theme): layout invariants,
// accessibility, and a reference screenshot. Book section 7.2 to 7.4.
import { test, expect } from "@playwright/test";
import { stubWorld, freeze, expectLayoutClean, expectAccessible, expectNoPageErrors } from "./helpers";

const PAGES: { name: string; path: string; ready: string; mask?: string[] }[] = [
  { name: "landing", path: "/", ready: "main" },
  { name: "mission-holding", path: "/mission", ready: "main.holding" },
  { name: "account-signed-out", path: "/account", ready: "main" },
  { name: "signin", path: "/signin", ready: "main" },
  { name: "privacy", path: "/privacy", ready: "main.doc" },
  { name: "terms", path: "/terms", ready: "main.doc" },
  { name: "security", path: "/security", ready: "main" },
  { name: "not-found", path: "/this-page-does-not-exist", ready: "main" },
  { name: "adventure-sample", path: "/adventure", ready: ".eq", mask: [".maplibregl-marker"] },
];

for (const p of PAGES) {
  test(`${p.name}: layout, a11y, snapshot`, async ({ page }, info) => {
    test.skip(p.name === "adventure-sample" && Boolean(process.env.E2E_LITE), "the globe needs a GPU");
    await stubWorld(page);
    await page.goto(p.path, { waitUntil: "domcontentloaded" });
    await page.locator(p.ready).first().waitFor({ state: "visible" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await freeze(page);
    await page.waitForTimeout(300);

    expectNoPageErrors(page);
    await expectLayoutClean(page, info);
    await expectAccessible(page, info);
    // WebGL canvases animate on their own clock: hidden for the picture (a mask would cover the UI drawn
    // over them), so what is compared is every pixel of the interface itself.
    if (!process.env.E2E_VISUAL) return;
    await page.addStyleTag({ content: "canvas { visibility: hidden !important; }" });
    await expect(page).toHaveScreenshot(`${p.name}.png`, { fullPage: p.name !== "adventure-sample", mask: (p.mask ?? []).map((m) => page.locator(m)) });
  });
}

test("theme is applied before first paint", async ({ page }) => {
  await stubWorld(page);
  // The inline script must have set the attribute by the time the first stylesheet applies.
  await page.addInitScript(() => {
    const seen: string[] = [];
    const obs = new MutationObserver(() => seen.push(document.documentElement.getAttribute("data-bl-theme") || "none"));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-bl-theme"] });
    (window as unknown as { __themeSeen: string[] }).__themeSeen = seen;
  });
  await page.goto("/");
  const seen = await page.evaluate(() => (window as unknown as { __themeSeen: string[] }).__themeSeen);
  const theme = await page.evaluate(() => document.documentElement.getAttribute("data-bl-theme"));
  expect(["dark", "light"]).toContain(theme);
  // The attribute is set exactly once, never flipped from one theme to another after paint.
  expect(new Set(seen).size).toBeLessThanOrEqual(1);
});

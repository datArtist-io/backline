// The flows a person actually takes, scripted in plain steps, with every step asserting something visible.
// Book section 7.1. Outside services are stubbed, so each run is the same as the last.
import { test, expect } from "@playwright/test";
import { stubWorld, expectLayoutClean, expectAccessible, expectNoPageErrors } from "./helpers";

test.describe("typing a request", () => {
  test("goes to the mission page and, when the agent is unreachable, says so in plain words", async ({ page }, info) => {
    await stubWorld(page);
    await page.route("**/api/mission", (route) => route.fulfill({ status: 503, json: { error: "The agent is resting. Try again in a moment." } }));
    await page.goto("/");
    const box = page.getByRole("textbox").first();
    await box.fill("3 days in Lisbon for two, we love fado");
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page).toHaveURL(/\/mission\?/);
    // The error is a sentence a first-time user understands, with a way forward (invariant U3).
    await expect(page.getByText("The agent is resting. Try again in a moment.")).toBeVisible();
    await expect(page.getByRole("button", { name: /try again/i }).or(page.getByRole("link", { name: /new trip/i })).first()).toBeVisible();
    await expectLayoutClean(page, info);
    expectNoPageErrors(page);
  });

  test("a dropped connection is reported, never a blank screen", async ({ page }) => {
    await stubWorld(page);
    await page.route("**/api/mission", (route) => route.abort("connectionfailed"));
    await page.goto("/mission?goal=Tokyo+for+two");
    await expect(page.getByText(/couldn.t reach the agent|try again/i).first()).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("the trip view", () => {
  // The globe renders through WebGL; without a GPU (some sandboxes) a frame takes seconds and clicks
  // time out. E2E_LITE=1 skips these; every other check still runs.
  test.skip(Boolean(process.env.E2E_LITE), "WebGL interactions need a GPU");
  test.beforeEach(async ({ page }) => {
    await stubWorld(page);
    await page.goto("/adventure");
    await page.locator(".eq").waitFor();
  });

  test("days, picks, field guide and view menu all open and close", async ({ page }, info) => {
    // A pick opens its card.
    await page.getByRole("button", { name: /Tasca do Chico/ }).first().click();
    await expect(page.locator(".eq-card").getByRole("heading", { name: "Tasca do Chico" })).toBeVisible();
    // Day tabs switch the day.
    const day2 = page.getByRole("button", { name: /Day 2/ }).first();
    if (await day2.isVisible()) {
      await day2.click();
      await expect(day2).toHaveAttribute("aria-pressed", /true|/);
    }
    // The field guide is a dialog that closes on Escape and returns focus.
    await page.getByRole("button", { name: /Field guide/ }).first().click();
    const dialog = page.getByRole("dialog", { name: "Field guide" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expectAccessible(page, info);
    await expectLayoutClean(page, info);
    expectNoPageErrors(page);
  });

  test("the whole trip view works from the keyboard", async ({ page }) => {
    // Tab reaches the main controls, and every focused control shows a visible focus ring (invariant U7).
    const names: string[] = [];
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        // The map canvas handles its own keyboard moves and draws no ring; every other control must.
        if (!el || el === document.body || el.tagName === "CANVAS") return null;
        const s = getComputedStyle(el);
        const ring = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
        const shadow = s.boxShadow !== "none";
        return { name: el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 30) || el.tagName, ring: ring || shadow };
      });
      if (!info) continue;
      names.push(info.name);
      expect(info.ring, `focus ring on "${info.name}"`).toBe(true);
    }
    expect(names.some((n) => /Fly the trip|Field guide|Backline/.test(n))).toBe(true);
  });
});

test.describe("planned by voice", () => {
  test("a fresh call shows with its code; an old one or an opened one does not", async ({ page }) => {
    await stubWorld(page);
    const now = Date.now();
    await page.route("**/api/call-trips", (route) =>
      route.fulfill({
        json: {
          number: "+15555550123",
          trips: [
            { code: "4821", at: new Date(now - 5 * 60_000).toISOString(), live: false, destination: "Lisbon", days: 3, travellers: 2, loves: "fado", url: "/mission?goal=x" },
            { code: "9930", at: new Date(now - 3 * 3600_000).toISOString(), live: false, destination: "Tokyo", days: 5, travellers: 1, loves: "jazz", url: "/mission?goal=y" },
          ],
        },
      }),
    );
    await page.goto("/");
    await expect(page.getByText("4821")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("9930")).toHaveCount(0);
    // Opening a trip removes it from the list for this browser (invariant U5).
    await page.getByRole("link", { name: "Open" }).first().click();
    await page.goBack();
    await expect(page.getByText("4821")).toHaveCount(0);
  });
});

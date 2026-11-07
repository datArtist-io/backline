// Shared helpers for the design tests: stub every outside service so a screen is the same twice, and
// the layout invariants from the bug-finding book (section 7.3) run on any page.
import { expect, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/** Outside hosts a page may call. Each is answered locally so nothing varies between runs. */
export async function stubWorld(page: Page): Promise<void> {
  await page.route(/https?:\/\/(?!127\.0\.0\.1|localhost)[^/]+\//, (route) => {
    const url = route.request().url();
    // Map tiles, 3D tiles and fonts: an empty answer keeps the page going.
    if (/tile|maps\.googleapis|tomtom|basemaps|arcgis|openstreetmap|nominatim|fonts\./.test(url)) return route.fulfill({ status: 204, body: "" });
    return route.fulfill({ status: 204, body: "" });
  });
  await page.route("**/api/call-trips", (route) => route.fulfill({ json: { number: "+15555550123", trips: [] } }));
  await page.route("**/api/account/searches**", (route) => route.fulfill({ json: { searches: [] } }));
  await page.route("**/api/account**", (route) => route.fulfill({ status: 401, json: { ok: false } }));
  await page.route("**/api/profile**", (route) => route.fulfill({ json: { profile: null } }));
  await page.route("**/api/fx**", (route) => route.fulfill({ json: { base: "USD", rates: { USD: 1, EUR: 0.92, GBP: 0.79, NGN: 1500 }, at: "2026-11-07T00:00:00Z" } }));
  await page.route("**/api/health", (route) => route.fulfill({ json: { ok: true, failing: [], services: [], at: "2026-11-07T00:00:00Z" } }));
  await page.route("**/api/wallet**", (route) => route.fulfill({ json: { balance: 5000, currency: "USD", ledger: [] } }));
}

/** Freezes time and animation so screenshots and motion samples are deterministic. */
export async function freeze(page: Page): Promise<void> {
  await page.clock.install({ time: new Date("2026-11-07T12:00:00Z") });
  await page.addStyleTag({ content: "*, *::before, *::after { transition-duration: 0s !important; animation-play-state: paused !important; }" }).catch(() => {});
}

export type LayoutFinding = { rule: string; element: string; detail: string };

/**
 * Layout invariants (book section 7.3): no horizontal scroll, nothing overflowing its parent, no clipped
 * text, tap targets on phones, the theme applied before paint. Returns findings instead of throwing so a
 * test can report all of them at once.
 */
export async function layoutInvariants(page: Page): Promise<LayoutFinding[]> {
  return page.evaluate(() => {
    const out: { rule: string; element: string; detail: string }[] = [];
    const tag = (el: Element) => {
      const id = el.id ? `#${el.id}` : "";
      const cls = (el as HTMLElement).className && typeof (el as HTMLElement).className === "string" ? "." + (el as HTMLElement).className.trim().split(/\s+/).slice(0, 2).join(".") : "";
      const text = (el.textContent || "").trim().slice(0, 40);
      return `${el.tagName.toLowerCase()}${id}${cls}${text ? ` "${text}"` : ""}`;
    };
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) out.push({ rule: "no-horizontal-scroll", element: "html", detail: `scrollWidth ${doc.scrollWidth} > clientWidth ${doc.clientWidth}` });
    const theme = doc.getAttribute("data-bl-theme");
    if (theme !== "dark" && theme !== "light") out.push({ rule: "theme-before-paint", element: "html", detail: `data-bl-theme is ${String(theme)}` });

    const vw = doc.clientWidth;
    const phone = vw <= 480;
    const visible = (el: Element) => {
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const all = Array.from(document.body.querySelectorAll<HTMLElement>("*")).filter((el) => !["SCRIPT", "STYLE", "CANVAS", "SVG", "PATH"].includes(el.tagName));
    for (const el of all) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      // Off the right edge of the viewport (the usual cause of horizontal scroll).
      if (r.right > vw + 1 && r.left < vw && getComputedStyle(el).position !== "fixed") {
        const inScroller = (() => {
          let p: HTMLElement | null = el.parentElement;
          while (p && p !== document.body) {
            const o = getComputedStyle(p).overflowX;
            if (o === "auto" || o === "scroll" || o === "hidden") return true;
            p = p.parentElement;
          }
          return false;
        })();
        if (!inScroller) out.push({ rule: "no-overflow-right", element: tag(el), detail: `right ${Math.round(r.right)} > viewport ${vw}` });
      }
      // Clipped text: text that cannot fit inside an overflow-hidden box.
      const s = getComputedStyle(el);
      const ownText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || "").trim());
      if (ownText && (s.overflowX === "hidden" || s.overflow === "hidden") && s.textOverflow !== "ellipsis" && s.whiteSpace !== "nowrap" && el.scrollWidth > el.clientWidth + 2) {
        out.push({ rule: "no-clipped-text", element: tag(el), detail: `scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}` });
      }
      // Tap targets on a phone (WCAG 2.5.8: 24px minimum; we hold 32). Links inside running text are
      // exempt, as the standard allows.
      if (phone && (el.tagName === "BUTTON" || el.tagName === "A" || el.getAttribute("role") === "button") && el.textContent?.trim()) {
        const inline = el.tagName === "A" && !!el.closest("p, li, td, dd, blockquote, small");
        if (!inline && (r.width < 32 || r.height < 32)) out.push({ rule: "tap-target", element: tag(el), detail: `${Math.round(r.width)}×${Math.round(r.height)} px` });
      }
    }
    // Copy that should never reach a person.
    const html = document.body.innerText;
    for (const bad of ["undefined", "NaN", "[object Object]", "null null", "lorem ipsum", "TODO"]) {
      if (html.includes(bad)) out.push({ rule: "no-placeholder-copy", element: "body", detail: `contains "${bad}"` });
    }
    return out;
  });
}

export async function expectLayoutClean(page: Page, info: TestInfo, allow: string[] = []): Promise<void> {
  const findings = (await layoutInvariants(page)).filter((f) => !allow.includes(f.rule));
  await info.attach("layout-findings", { body: JSON.stringify(findings, null, 2), contentType: "application/json" });
  expect(findings, findings.map((f) => `${f.rule}: ${f.element} (${f.detail})`).join("\n")).toEqual([]);
}

/** Axe on the current page state: serious and critical findings fail the test. */
export async function expectAccessible(page: Page, info: TestInfo, disable: string[] = []): Promise<void> {
  // axe ships against a newer playwright-core than the runner pinned here; the Page API it uses is the same.
  const results = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).disableRules(disable).analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  await info.attach("axe", { body: JSON.stringify(results.violations, null, 2), contentType: "application/json" });
  expect(bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`)).toEqual([]);
}

/** Keyboard-only browser checks and 200% reflow-equivalent layouts.
 * Not a claim of native browser zoom or a complete manual accessibility audit.
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { cleanupTempServer } from "./process-cleanup.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "accessibility-results");
mkdirSync(output, { recursive: true });
const temporary = mkdtempSync(path.join(tmpdir(), "cloudlabs-access-"));
const port = await new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, "127.0.0.1", () => {
    const p = s.address().port;
    s.close(() => resolve(p));
  });
});
const base = `http://127.0.0.1:${port}`;
const proc = spawn(process.execPath, ["server/index.mjs"], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    DB_PATH: path.join(temporary, "test.db"),
    AI_API_KEY: "",
    AI_BASE_URL: "",
  },
  stdio: "ignore",
});
let browser;
const results = [];
async function activeMatches(page, selector) {
  return page.evaluate(
    (selector) => document.activeElement?.matches(selector),
    selector,
  );
}
async function tabTo(page, selector) {
  for (let i = 0; i < 400; i++) {
    if (await activeMatches(page, selector)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Cannot reach ${selector} by Tab`);
}
async function focusRing(page) {
  const visible = await page.evaluate(() => {
    const el = document.activeElement;
    const candidates = [el, el?.closest(".search-wrap")].filter(Boolean);
    return candidates.some((el) => {
      const s = getComputedStyle(el);
      return s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 2;
    });
  });
  assert.ok(visible, "keyboard focus must have a visible outline");
}
async function escapeReturns(page, selector) {
  await page.keyboard.press("Escape");
  await page.locator('[role="dialog"]').waitFor({ state: "detached" });
  assert.ok(
    await activeMatches(page, selector),
    `Escape must restore ${selector}`,
  );
}
async function runLayout(spec) {
  const context = await browser.newContext({
    viewport: spec.viewport,
    deviceScaleFactor: spec.scale,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  try {
    await page.goto(base);
    await page.waitForFunction(
      () => document.querySelectorAll("tr[data-id]").length === 120,
    );
    const monitor = await page.evaluate(() => {
      const shell = document.querySelector('.table-shell').getBoundingClientRect();
      const header = document.querySelector('thead').getBoundingClientRect();
      const row = document.querySelector('tr[data-id]').getBoundingClientRect();
      return {
        height: shell.height,
        headerVisible: header.top >= shell.top && header.bottom <= shell.bottom,
        rowVisible: row.top >= shell.top && row.bottom <= shell.bottom,
      };
    });
    assert.ok(monitor.height >= 200, 'monitor must retain usable height at zoom');
    assert.ok(monitor.headerVisible, 'table header must fit inside its scroll area');
    assert.ok(monitor.rowVisible, 'at least one complete learner row must remain visible');
    const bounds = await page.evaluate(() => ({
      width: innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    assert.ok(
      bounds.document <= bounds.width + 1,
      "horizontal document overflow; horizontal table scrolling is allowed",
    );
    for (const selector of [
      "#guideButton",
      "#activityButton",
      "#refreshButton",
      "#triageButton",
      "#searchInput",
      "#riskToggle",
      "#sortSelect",
    ]) {
      const rect = await page.locator(selector).boundingBox();
      assert.ok(
        rect && rect.x >= 0 && rect.x + rect.width <= spec.viewport.width + 1,
        `${selector} overflows horizontally`,
      );
    }
    // All interaction below uses keyboard input; selectors only inspect state.
    await tabTo(page, "#guideButton");
    await focusRing(page);
    await page.keyboard.press("Enter");
    await page.locator("#guideTitle").waitFor();
    assert.ok(await activeMatches(page, "[data-close]"));
    await page.keyboard.press("Shift+Tab");
    assert.ok(
      await activeMatches(page, "#guideClose"),
      "reverse Tab must wrap",
    );
    await page.keyboard.press("Tab");
    assert.ok(
      await activeMatches(page, "[data-close]"),
      "Tab must wrap to Close",
    );
    await escapeReturns(page, "#guideButton");

    await tabTo(page, "#activityButton");
    await page.keyboard.press("Enter");
    await page.locator("#activityTitle").waitFor();
    await page.keyboard.press("Tab");
    assert.ok(
      await activeMatches(page, "[data-close]"),
      "single-control drawer must retain focus",
    );
    await escapeReturns(page, "#activityButton");

    await tabTo(page, "#triageButton");
    await page.keyboard.press("Enter");
    await page.locator(".insight-mode").waitFor();
    await page.waitForFunction(
      () => !document.querySelector("#triageReload").disabled,
    );
    await page.keyboard.press("Shift+Tab");
    assert.ok(await activeMatches(page, "#triageReload"));
    await page.keyboard.press("Tab");
    assert.ok(await activeMatches(page, "[data-close]"));
    await escapeReturns(page, "#triageButton");

    await tabTo(page, '[data-status="failed"]');
    await page.keyboard.press("Space");
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-status="failed"]')
          .getAttribute("aria-pressed") === "true",
    );
    const id = await page
      .locator("tr[data-id]")
      .first()
      .getAttribute("data-id");
    await tabTo(page, "#searchInput");
    await focusRing(page);
    await page.keyboard.type(id);
    await page.waitForFunction(
      () => document.querySelectorAll("tr[data-id]").length === 1,
    );
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.waitForFunction(
      () => document.querySelectorAll("tr[data-id]").length > 1,
    );
    await tabTo(page, "#riskToggle");
    await page.keyboard.press("Space");
    assert.equal(await page.locator("#riskToggle").isChecked(), true);
    await page.keyboard.press("Space");
    assert.equal(await page.locator("#riskToggle").isChecked(), false);
    await tabTo(page, "#sortSelect");
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => document.querySelector("#sortSelect").value === "step_time:desc",
    );

    await tabTo(page, "tr[data-id]");
    await focusRing(page);
    const firstId = await page.evaluate(
      () => document.activeElement.dataset.id,
    );
    await page.keyboard.press("ArrowDown");
    assert.notEqual(
      await page.evaluate(() => document.activeElement.dataset.id),
      firstId,
    );
    await page.keyboard.press("ArrowUp");
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.id),
      firstId,
    );
    await page.keyboard.press("Enter");
    await page.locator("#drawerTitle").waitFor();
    await page.screenshot({
      path: path.join(output, `${spec.name}-details.png`),
      fullPage: true,
    });
    await escapeReturns(page, `tr[data-id="${firstId}"]`);
    await page.keyboard.press("Enter");
    await page.locator("#drawerRetry").waitFor();
    await page.keyboard.press("Tab");
    assert.ok(await activeMatches(page, "#drawerRetry"));
    await page.keyboard.press("Enter");
    await page.locator("#drawerRetry").waitFor({ state: "detached" });
    await page.waitForFunction(() =>
      document.activeElement?.matches(".drawer [data-close]"),
    );
    const detail = await (
      await fetch(`${base}/api/environments/${firstId}`)
    ).json();
    assert.ok(detail.events.some((event) => event.type === "reprovision"));
    await page.keyboard.press("Escape");
    await page.locator('[role="dialog"]').waitFor({ state: "detached" });
    assert.ok(
      await activeMatches(page, "tr[data-id],#clearFilters,#searchInput"),
      "removed row must have a usable focus fallback",
    );
    await page.screenshot({
      path: path.join(output, `${spec.name}-monitor.png`),
      fullPage: true,
    });
    results.push({
      layout: spec.name,
      status: "passed",
      keyboard: true,
      viewport: spec.viewport,
      deviceScaleFactor: spec.scale,
    });
    console.log(
      `PASS ${spec.name}: keyboard controls, dialogs, focus restoration, retry and reflow`,
    );
  } finally {
    await context.close();
  }
}
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!ready) throw new Error("Temporary server did not start");
  browser = await chromium.launch({
    headless: !process.argv.includes("--headed"),
  });
  for (const spec of [
    { name: "normal-1440", viewport: { width: 1440, height: 960 }, scale: 1 },
    { name: "short-desktop", viewport: { width: 1440, height: 436 }, scale: 1 },
    { name: "200-equivalent-browser-chrome", viewport: { width: 960, height: 436 }, scale: 2 },
    {
      name: "200-equivalent-1440",
      viewport: { width: 720, height: 480 },
      scale: 2,
    },
    {
      name: "200-equivalent-1920",
      viewport: { width: 960, height: 540 },
      scale: 2,
    },
  ])
    await runLayout(spec);
  writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify(
      {
        results,
        note: "200-equivalent uses half-size CSS viewports at device scale 2. This checks the corresponding reflow, not native browser zoom or a full manual audit.",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Keyboard and reflow checks passed. Native 200% browser zoom remains a separate manual check.",
  );
} finally {
  try {
    await browser?.close();
  } finally {
    await cleanupTempServer(proc, temporary);
  }
}

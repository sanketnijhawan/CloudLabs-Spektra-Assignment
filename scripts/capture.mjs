import { cleanupTempServer } from "./process-cleanup.mjs";
/** Capture real HTTP/SQLite-backed states; uses an isolated disposable workshop. */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import net from "node:net";
const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "screenshots");
mkdirSync(output, { recursive: true });
const dir = mkdtempSync(path.join(tmpdir(), "cloudlabs-capture-"));
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
    DB_PATH: path.join(dir, "capture.db"),
    AI_API_KEY: "",
    AI_BASE_URL: "",
  },
  stdio: "ignore",
});
let browser;
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
  if (!ready) throw new Error("Local server did not start");
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForFunction(
    () => document.querySelectorAll("tr[data-id]").length === 120,
  );
  await page.screenshot({
    path: path.join(output, "workshop-desktop-120-rows.png"),
    fullPage: true,
  });
  const density = await page.evaluate(() => {
    const shell = document.querySelector("#tableShell").getBoundingClientRect();
    return [...document.querySelectorAll("tr[data-id]")].filter((row) => {
      const r = row.getBoundingClientRect();
      return r.top >= shell.top + 32 && r.bottom <= shell.bottom;
    }).length;
  });
  if (density < 10)
    throw new Error(
      `Expected at least ten visible rows at 1440x960; saw ${density}`,
    );
  const layout = await page.evaluate(() => ({
    viewport: innerHeight,
    document: document.documentElement.scrollHeight,
    body: document.body.scrollHeight,
    shell: document.querySelector('.main-wrap').getBoundingClientRect().height,
    hiddenLabels: [...document.querySelectorAll('.sr-only')].map(el => {
      const r = el.getBoundingClientRect();
      return {top:r.top,bottom:r.bottom};
    }).filter(r => r.bottom > innerHeight + 1).slice(0,3),
  }));
  if (layout.document > layout.viewport + 1)
    throw new Error(`Unexpected desktop page scrolling: ${JSON.stringify(layout)}`);
  // Keyboard focus survives a real polling cycle.
  const focused = page.locator("tr[data-id]").first();
  const id = await focused.getAttribute("data-id");
  await focused.focus();
  await page.waitForTimeout(5400);
  if ((await page.evaluate(() => document.activeElement.dataset.id)) !== id)
    throw new Error("Polling lost row focus");
  await page.locator("#triageButton").click();
  await page.locator(".insight-mode").waitFor();
  await page.screenshot({
    path: path.join(output, "at-risk-summary.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await page.locator("#activityButton").click();
  await page.locator("#activityList .activity-item").first().waitFor();
  await page.screenshot({
    path: path.join(output, "recent-activity.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await page.locator("[data-status=failed]").click();
  await page.waitForFunction(
    () =>
      document.querySelector(".status-tab.current")?.dataset.status ===
      "failed",
  );
  const row = page.locator("tr[data-id]").first();
  const lab = await row.getAttribute("data-id");
  await row.click();
  await page.locator("#drawerRetry").waitFor();
  await page.screenshot({
    path: path.join(output, "learner-details.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await row.locator("[data-reprovision]").click();
  await page.waitForFunction(
    (id) => !document.querySelector(`tr[data-id="${id}"]`),
    lab,
  );
  const changed = await (await fetch(`${base}/api/environments/${lab}`)).json();
  if (!changed.events.some((event) => event.type === "reprovision"))
    throw new Error("Retry did not persist");
  await page.locator("[data-status=all]").click();
  await page.waitForFunction(
    () => document.querySelectorAll("tr[data-id]").length === 120,
  );
  await page.locator("#searchInput").fill("no-such-learner");
  await page.locator("#clearFilters").waitFor();
  await page.locator(".toast").waitFor({ state: "detached" });
  await page.screenshot({
    path: path.join(output, "empty-state.png"),
    fullPage: true,
  });
  await page.locator("#clearFilters").click();
  await page.waitForFunction(
    () => document.querySelectorAll("tr[data-id]").length === 120,
  );
  await page.route("**/api/dashboard?**", (r) => r.abort());
  await page.locator("#refreshButton").click();
  await page.locator("#connectionNotice").waitFor();
  await page.screenshot({
    path: path.join(output, "connection-error.png"),
    fullPage: true,
  });
  await page.unroute("**/api/dashboard?**");
  await page.locator("#refreshButton").click();
  await page.locator("#connectionNotice").waitFor({ state: "hidden" });
  await page.locator(".toast").waitFor({ state: "detached" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(output, "workshop-mobile.png"),
    fullPage: true,
  });
  // Hold the initial request to capture the actual pending state.
  const loading = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  let release;
  const gate = new Promise((r) => (release = r));
  await loading.route("**/api/dashboard?**", async (r) => {
    await gate;
    await r.continue();
  });
  await loading.goto(base);
  await loading.getByText("Loading live environments…").waitFor();
  await loading.screenshot({
    path: path.join(output, "loading-state.png"),
    fullPage: true,
  });
  release();
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "Captured eight screenshots from the real app. Review them before submission.",
  );
} finally {
  try {
    await browser?.close();
  } finally {
    await cleanupTempServer(proc, dir);
  }
}

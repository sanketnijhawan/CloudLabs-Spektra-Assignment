import { cleanupTempServer } from "../../scripts/process-cleanup.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
const root = fileURLToPath(new URL("../../", import.meta.url));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) {
  for (let i = 0; i < 150; i++) {
    if (fn()) return;
    await pause(20);
  }
  throw new Error("UI condition timed out");
}

test("live API + DOM: dense view, filter race, focus, mutation, drawer, empty/error recovery", async () => {
  const port = await new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
  const dir = mkdtempSync(path.join(tmpdir(), "cloudlabs-ui-"));
  const proc = spawn(process.execPath, ["server/index.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: path.join(dir, "ui.db"),
      AI_API_KEY: "",
      AI_BASE_URL: "",
    },
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  let dom;
  try {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(base + "/api/health")).ok) break;
      } catch {}
      await pause(30);
    }
    dom = new JSDOM(
      readFileSync(path.join(root, "public/index.html"), "utf8"),
      { url: base, runScripts: "outside-only", pretendToBeVisual: true },
    );
    const w = dom.window;
    w.setInterval = () => 0;
    w.AbortSignal = AbortSignal;
    let networkOnline = false;
    w.fetch = (url, options) =>
      networkOnline
        ? fetch(new URL(url, base), options)
        : Promise.reject(new Error("offline at startup"));
    w.HTMLElement.prototype.scrollIntoView = function () {};
    w.eval(
      readFileSync(path.join(root, "public/app.js"), "utf8") +
        "\nwindow.app={state,refresh,openDrawer,closeOverlay,reprovisionLab,loadTriage,showToast};",
    );
    const app = w.app,
      doc = w.document;
    assert.match(
      doc.querySelector("#environmentRows").textContent,
      /Loading live environments/,
    );
    await until(() => doc.querySelector("#retryLoad"));
    assert.equal(
      doc.querySelector("#tableShell").getAttribute("aria-busy"),
      "false",
    );
    networkOnline = true;
    doc.querySelector("#retryLoad").click();
    await until(() => app.state.hasLoaded);
    assert.equal(doc.querySelectorAll("tr[data-id]").length, 120);
    assert.equal(
      doc.querySelector("tr[data-id] .state-chip").textContent,
      "Failed",
    );
    // Escape must return to each dialog's current opener, not a previous opener.
    for (const buttonId of ["guideButton", "activityButton"]) {
      const trigger = doc.getElementById(buttonId);
      trigger.focus();
      trigger.click();
      assert.ok(doc.querySelector("[role=dialog]"));
      doc.dispatchEvent(
        new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      assert.equal(
        doc.activeElement,
        trigger,
        "dialog close must restore its own trigger",
      );
    }
    // Rapid actions replace the feedback in one live region instead of stacking.
    for (let i = 1; i <= 5; i++)
      app.showToast(`LAB-00${i} queued`, "success", `LAB-00${i}`);
    assert.equal(doc.querySelectorAll(".toast").length, 1);
    assert.match(doc.querySelector(".toast").textContent, /5 labs queued/);
    const row = doc.querySelector("tr[data-id]");
    row.focus();
    const id = row.dataset.id;
    row.dispatchEvent(
      new w.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    assert.equal(doc.activeElement, doc.querySelectorAll("tr[data-id]")[1]);
    row.focus();
    doc.querySelector("#tableShell").scrollTop = 150;
    await app.refresh({ quiet: true });
    assert.equal(doc.activeElement.dataset.id, id);
    assert.equal(doc.querySelector("#tableShell").scrollTop, 150);
    // Force a cell update, exercising focus restoration after replacing children.
    const button = doc.querySelector(`tr[data-id="${id}"] button`);
    button.focus();
    const realFetch = w.fetch;
    w.fetch = async (url, options) => {
      const r = await realFetch(url, options);
      const data = await r.json();
      if (String(url).startsWith("/api/dashboard"))
        data.environments[0].estimated_spend_cents += 2;
      return { ok: r.ok, status: r.status, json: async () => data };
    };
    await app.refresh({ quiet: true });
    assert.equal(doc.activeElement.dataset.reprovision, id);
    // Change filter while an older request is still pending.
    let release;
    const gate = new Promise((r) => (release = r));
    w.fetch = async (url, options) => {
      if (String(url).includes("state=ready")) await gate;
      return realFetch(url, options);
    };
    doc.querySelector("[data-status=ready]").click();
    doc.querySelector("[data-status=failed]").click();
    release();
    await until(
      () =>
        !app.state.refreshing &&
        doc.querySelector(".status-tab.current").dataset.status === "failed",
    );
    assert.ok(
      [...doc.querySelectorAll("tr[data-id] .state-chip")].every(
        (e) => e.textContent === "Failed",
      ),
    );
    w.fetch = realFetch;
    const retryId = doc.querySelector("tr[data-id]").dataset.id;
    doc.querySelector(`tr[data-id="${retryId}"]`).focus();
    await app.openDrawer(retryId);
    assert.equal(app.state.drawerId, retryId);
    assert.equal(doc.querySelector(".main-wrap").inert, true);
    doc.querySelector("#drawerRetry").focus();
    assert.ok(
      await app.reprovisionLab(retryId, doc.querySelector("#drawerRetry")),
    );
    assert.equal(
      doc.activeElement,
      doc.querySelector(".drawer [data-close]"),
      "removed Retry should move focus to Close",
    );
    assert.equal(
      doc.querySelector(".drawer .state-chip").textContent,
      "Provisioning",
    );
    assert.equal(doc.querySelector("#drawerRetry"), null);
    app.closeOverlay();
    assert.equal(doc.querySelector(".main-wrap").inert, false);
    assert.ok(
      doc.activeElement.matches("tr[data-id],#clearFilters,#searchInput"),
      "removed opener must have a usable focus fallback",
    );
    doc.querySelector("#activityButton").click();
    assert.equal(
      doc.querySelector("[role=dialog]").getAttribute("aria-labelledby"),
      "activityTitle",
    );
    assert.ok(doc.querySelectorAll("#activityList .activity-item").length > 0);
    await app.refresh({ quiet: true });
    assert.ok(doc.querySelectorAll("#activityList .activity-item").length > 0);
    doc.dispatchEvent(
      new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    assert.equal(doc.querySelector("[role=dialog]"), null);
    doc.querySelector("#guideButton").click();
    assert.doesNotMatch(
      doc.querySelector("#triageHost").textContent,
      /SQLite|POST API|polling/,
    );
    app.closeOverlay();
    doc.querySelector("#triageButton").click();
    await until(() => doc.querySelector(".insight-mode"));
    assert.equal(
      doc.querySelector(".insight-mode strong").textContent,
      "Rules-based assessment",
    );
    assert.match(
      doc.querySelector("#assessmentMeta").textContent,
      /Assessed at/,
    );
    assert.ok(doc.querySelector(".modal-footer #triageReload"));
    app.closeOverlay();
    doc.querySelector("#searchInput").value = "no-such-learner";
    doc.querySelector("#searchInput").dispatchEvent(new w.Event("input"));
    await until(() => doc.querySelector("#clearFilters"));
    doc.querySelector("#clearFilters").click();
    await until(() => doc.querySelectorAll("tr[data-id]").length === 120);
    w.fetch = async () => {
      throw new Error("offline");
    };
    await app.refresh({ quiet: true });
    assert.equal(doc.querySelector("#connectionNotice").hidden, false);
    assert.equal(doc.querySelectorAll("tr[data-id]").length, 120);
    w.fetch = realFetch;
    await app.refresh({ quiet: true });
    assert.equal(doc.querySelector("#connectionNotice").hidden, true);
  } finally {
    dom?.window.close();
    await cleanupTempServer(proc, dir);
  }
});

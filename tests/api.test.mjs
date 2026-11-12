import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { cleanupTempServer, stopChild } from "../scripts/process-cleanup.mjs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
async function freePort() {
  return await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}
async function startServer(port, dbPath) {
  const proc = spawn(process.execPath, ["server/index.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      AI_API_KEY: "",
      AI_BASE_URL: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let error = "";
  proc.stderr.on("data", (c) => {
    error += c.toString();
  });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    if (proc.exitCode !== null) throw new Error(`Server exited: ${error}`);
    try {
      const r = await fetch(url + "/api/health");
      if (r.ok) return { proc, url };
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  await stopChild(proc);
  throw new Error(`Server startup timed out: ${error}`);
}

test("real APIs seed, sort, filter, calculate, mutate, and triage with fallback", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cloudlabs-test-"));
  const port = await freePort();
  let proc;
  try {
    const server = await startServer(port, path.join(dir, "workshop.db"));
    proc = server.proc;
    const { url } = server;
    const get = async (suffix) => {
      const r = await fetch(url + suffix);
      assert.equal(r.status, 200);
      return r.json();
    };
    const all = await get("/api/dashboard");
    assert.equal(all.environments.length, 120);
    assert.equal(
      Object.values(all.session.states).reduce((a, b) => a + b, 0),
      120,
    );
    assert.ok(all.session.estimated_spend_cents > 0);
    assert.ok(
      all.environments.every((e) => Number.isInteger(e.estimated_spend_cents)),
    );
    assert.ok(all.at_risk.length > 0);
    assert.ok(all.events.length > 0);
    const fails = await get(
      "/api/dashboard?state=failed&sort=learner&direction=asc",
    );
    assert.equal(fails.environments.length, all.session.failures);
    assert.ok(fails.environments.every((e) => e.state === "failed"));
    const names = fails.environments.map((e) => e.learner_name);
    assert.deepEqual(
      names,
      [...names].sort((a, b) => a.localeCompare(b)),
    );
    const target = fails.environments[0];
    const res = await fetch(
      `${url}/api/environments/${target.id}/reprovision`,
      { method: "POST" },
    );
    assert.equal(res.status, 200);
    const mutated = await res.json();
    assert.equal(mutated.state, "provisioning");
    assert.equal(mutated.error_code, null);
    assert.equal(mutated.reprovision_attempts, target.reprovision_attempts + 1);
    assert.ok(
      mutated.estimated_spend_cents >= target.estimated_spend_cents - 1,
      "old spend persists after reprovision",
    );
    const after = await get(`/api/environments/${target.id}`);
    assert.equal(after.state, "provisioning");
    assert.ok(after.events.some((e) => e.type === "reprovision"));
    const afterDash = await get("/api/dashboard");
    assert.equal(afterDash.session.failures, all.session.failures - 1);
    assert.equal(
      afterDash.session.states.provisioning,
      all.session.states.provisioning + 1,
    );
    const repeat = await fetch(
      `${url}/api/environments/${target.id}/reprovision`,
      { method: "POST" },
    );
    assert.equal(repeat.status, 409);
    const search = await get(`/api/dashboard?search=${target.id}`);
    assert.equal(search.environments.length, 1);
    const empty = await get("/api/dashboard?search=nonexistentlearner999");
    assert.equal(empty.total_filtered, 0);
    const atRisk = await get("/api/dashboard?risk=true");
    assert.ok(atRisk.environments.every((e) => e.needs_attention));
    const triageResponse = await fetch(url + "/api/insights", {
      method: "POST",
    });
    assert.equal(triageResponse.status, 200);
    const triage = await triageResponse.json();
    assert.equal(triage.mode, "rules");
    assert.ok(triage.summary.includes("failed"));
    assert.ok(triage.actions.every((a) => a.id.startsWith("LAB-")));
    const page = await fetch(url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Workshop operations/);
    const css = await fetch(url + "/styles.css");
    assert.equal(css.status, 200);
    const js = await fetch(url + "/app.js");
    assert.equal(js.status, 200);
    const invalid = await fetch(url + "/api/environments/LAB-999");
    assert.equal(invalid.status, 404);
  } finally {
    await cleanupTempServer(proc, dir);
  }
});

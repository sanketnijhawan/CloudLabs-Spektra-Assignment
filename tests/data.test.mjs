import test from "node:test";
import assert from "node:assert/strict";
process.env.DB_PATH = ":memory:";
const {
  seed,
  db,
  allEnvironments,
  getDashboard,
  simulateTick,
  reprovision,
  getEnvironment,
} = await import("../server/db.mjs");

test("seeded timestamps and totals are coherent; intervention sorting prioritizes failures", () => {
  seed(true);
  const now = new Date();
  const envs = allEnvironments(now);
  const sessionStart = db
    .prepare("SELECT value FROM meta WHERE key='session_started_at'")
    .get().value;
  for (const e of envs) {
    if (e.started_at) {
      assert.ok(e.started_at >= sessionStart, e.id);
      assert.ok(e.step_started_at >= e.started_at, e.id);
    }
    if (e.ended_at) assert.ok(e.step_started_at <= e.ended_at, e.id);
  }
  const dash = getDashboard({}, now);
  assert.equal(
    dash.session.estimated_spend_cents,
    envs.reduce((sum, e) => sum + e.estimated_spend_cents, 0),
  );
  assert.equal(
    dash.session.average_completion_percent,
    Math.round(envs.reduce((sum, e) => sum + e.progress_percent, 0) / 120),
  );
  assert.ok(
    dash.environments
      .slice(0, dash.session.failures)
      .every((e) => e.state === "failed"),
  );
  const completed = envs.find((e) => e.state === "deprovisioned");
  const later = getEnvironment(completed.id, new Date(now.getTime() + 3600000));
  assert.equal(later.estimated_spend_cents, completed.estimated_spend_cents);
  assert.equal(later.step_minutes, completed.step_minutes);
});

test("simulation changes persisted rows and describes step advances accurately", () => {
  seed(true);
  const now = new Date();
  for (let i = 0; i < 40; i++) {
    const before = new Map(allEnvironments(now).map((e) => [e.id, e]));
    const changed = simulateTick(new Date(now.getTime() + i * 12000));
    assert.ok(changed);
    assert.ok(changed.events.length);
    const old = before.get(changed.id);
    if (old.state === "in_use" && changed.state === "in_use")
      assert.match(changed.events[0].message, /Advanced to step/);
    assert.ok(
      changed.step_index !== old.step_index || changed.state !== old.state,
    );
  }
});

test("reprovision preserves accrued costs across multiple attempts", () => {
  seed(true);
  const now = new Date();
  const failed = allEnvironments(now).find((e) => e.state === "failed");
  const retry = reprovision(failed.id, now);
  assert.equal(
    retry.environment.estimated_spend_cents,
    failed.estimated_spend_cents,
  );
  db.prepare(
    "UPDATE environments SET state='failed',started_at=? WHERE id=?",
  ).run(now.toISOString(), failed.id);
  const later = new Date(now.getTime() + 3600000);
  assert.equal(
    reprovision(failed.id, later).environment.estimated_spend_cents,
    failed.estimated_spend_cents + failed.hourly_rate_cents,
  );
});

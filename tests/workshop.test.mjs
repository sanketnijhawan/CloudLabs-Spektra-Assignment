import test from "node:test";
import assert from "node:assert/strict";
import {
  spendCents,
  progressPercent,
  assessRisk,
  durationMinutes,
  STEPS,
} from "../lib/workshop.mjs";

const now = new Date("2026-11-12T00:00:00Z");

test("spend is server-side rate × actual runtime in cents", () => {
  assert.equal(spendCents(60, "2026-11-11T22:30:00Z", now), 90);
  assert.equal(spendCents(45, null, now), 0);
  assert.equal(spendCents(60, "2026-11-12T01:00:00Z", now), 0);
});

test("duration uses monotonic nonnegative minute intervals", () => {
  assert.equal(durationMinutes("2026-11-11T23:35:00Z", now), 25);
  assert.equal(durationMinutes("2026-11-12T00:10:00Z", now), 0);
});

test("progress renders 8 steps and completed labs as 100%", () => {
  assert.equal(STEPS.length, 8);
  assert.equal(progressPercent(3, "in_use"), 38);
  assert.equal(progressPercent(8, "deprovisioned"), 100);
  assert.equal(progressPercent(0, "ready"), 0);
});

test("risk triage flags real field-based failures, stuck steps and provisioning delays", () => {
  const base = {
    state: "in_use",
    step_index: 3,
    step_started_at: "2026-11-11T23:35:00Z",
    reprovision_attempts: 0,
    error_code: null,
  };
  const stuck = assessRisk(base, now);
  assert.equal(stuck.level, "warning");
  assert.match(stuck.reasons[0], /step 4 for 25 min/);
  assert.equal(
    assessRisk({ ...base, step_started_at: "2026-11-11T23:10:00Z" }, now).level,
    "critical",
  );
  assert.equal(
    assessRisk({ ...base, state: "failed", error_code: "QUOTA_EXCEEDED" }, now)
      .level,
    "critical",
  );
  assert.equal(
    assessRisk({ ...base, state: "ready" }, now).needs_attention,
    false,
  );
  assert.equal(
    assessRisk(
      {
        ...base,
        state: "provisioning",
        step_started_at: "2026-11-11T23:47:00Z",
      },
      now,
    ).needs_attention,
    true,
  );
});

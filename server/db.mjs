import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  STEPS,
  assessRisk,
  spendCents,
  progressPercent,
  durationMinutes,
} from "../lib/workshop.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const databasePath =
  process.env.DB_PATH === ":memory:"
    ? ":memory:"
    : path.resolve(projectRoot, process.env.DB_PATH || "./data/workshop.db");
mkdirSync(path.dirname(databasePath), { recursive: true });
export const db = new DatabaseSync(databasePath);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS environments (
 id TEXT PRIMARY KEY, learner_name TEXT NOT NULL, learner_email TEXT NOT NULL,
 region TEXT NOT NULL, state TEXT NOT NULL, step_index INTEGER NOT NULL,
 step_started_at TEXT, started_at TEXT, ended_at TEXT,
 hourly_rate_cents INTEGER NOT NULL, error_code TEXT,
 accrued_spend_cents INTEGER NOT NULL DEFAULT 0, reprovision_attempts INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_state ON environments(state);
CREATE INDEX IF NOT EXISTS idx_learner ON environments(learner_name);
CREATE TABLE IF NOT EXISTS events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, environment_id TEXT NOT NULL,
 type TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(environment_id) REFERENCES environments(id)
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);
// Migrate older local demo databases without dropping workshop state.
if (
  !db
    .prepare("PRAGMA table_info(environments)")
    .all()
    .some((c) => c.name === "accrued_spend_cents")
) {
  db.exec(
    "ALTER TABLE environments ADD COLUMN accrued_spend_cents INTEGER NOT NULL DEFAULT 0",
  );
}

function seededRandom(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const firstNames = [
  "Alex",
  "Taylor",
  "Jordan",
  "Morgan",
  "Casey",
  "Avery",
  "Riley",
  "Sam",
  "Jamie",
  "Parker",
  "Harper",
  "Reese",
  "Skyler",
  "Cameron",
  "Drew",
  "Quinn",
  "Robin",
  "Devon",
  "Rowan",
  "Finley",
  "Dakota",
  "Emerson",
  "Kendall",
  "Logan",
];
const lastNames = [
  "Chen",
  "Patel",
  "Wilson",
  "Sharma",
  "Kim",
  "Singh",
  "Taylor",
  "Gupta",
  "Martinez",
  "Brown",
  "Lee",
  "Anderson",
  "Clark",
  "Nguyen",
  "Rivera",
  "Scott",
  "Evans",
  "Moore",
  "Wright",
  "Davis",
];
const errorCodes = [
  "VM_START_TIMEOUT",
  "QUOTA_EXCEEDED",
  "AUTH_EXPIRED",
  "NETWORK_UNAVAILABLE",
  "RESOURCE_LOCKED",
];

export function seed(force = false) {
  const count = db.prepare("SELECT count(*) as n FROM environments").get().n;
  if (count && !force) return false;
  const now = Date.now();
  const rng = seededRandom(20261110);
  const statuses = [
    ...Array(77).fill("in_use"),
    ...Array(16).fill("ready"),
    ...Array(13).fill("provisioning"),
    ...Array(9).fill("failed"),
    ...Array(5).fill("deprovisioned"),
  ];
  for (let i = statuses.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [statuses[i], statuses[j]] = [statuses[j], statuses[i]];
  }
  const insert = db.prepare(`INSERT INTO environments (
    id, learner_name, learner_email, region, state, step_index, step_started_at,
    started_at, ended_at, hourly_rate_cents, error_code, reprovision_attempts, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM events; DELETE FROM environments; DELETE FROM meta;");
    db.prepare("INSERT INTO meta (key,value) VALUES (?,?)").run(
      "session_started_at",
      new Date(now - 105 * 60000).toISOString(),
    );
    db.prepare("INSERT INTO meta (key,value) VALUES (?,?)").run(
      "seed_version",
      "v1",
    );
    for (let i = 0; i < 120; i++) {
      const id = `LAB-${String(i + 1).padStart(3, "0")}`;
      const name = `${firstNames[(i * 11 + 7) % firstNames.length]} ${lastNames[(i * 7 + Math.floor(i / 8)) % lastNames.length]}`;
      const state = statuses[i];
      const step =
        state === "in_use" || state === "failed"
          ? 1 + Math.floor(rng() * 7)
          : state === "deprovisioned"
            ? 8
            : 0;
      const age =
        state === "failed"
          ? 2 + Math.floor(rng() * 37)
          : state === "provisioning"
            ? 2 + Math.floor(rng() * 20)
            : state === "in_use"
              ? 2 + Math.floor(rng() * 50)
              : 5 + Math.floor(rng() * 28);
      const startAgo = 25 + Math.floor(rng() * 80);
      const startedAt =
        state === "provisioning" && rng() > 0.4
          ? null
          : new Date(now - startAgo * 60000).toISOString();
      const endedAt =
        state === "deprovisioned"
          ? new Date(now - (1 + Math.floor(rng() * 20)) * 60000).toISOString()
          : null;
      const stepStartedAt = new Date(
        Math.min(
          now - Math.min(age, startAgo) * 60000,
          endedAt ? new Date(endedAt).getTime() : now,
        ),
      ).toISOString();
      insert.run(
        id,
        name,
        `${name.toLowerCase().replace(" ", ".")}.${i + 1}@learners.example`,
        ["eastus", "westeurope", "centralindia"][Math.floor(rng() * 3)],
        state,
        step,
        stepStartedAt,
        startedAt,
        endedAt,
        22 + Math.floor(rng() * 48),
        state === "failed"
          ? errorCodes[Math.floor(rng() * errorCodes.length)]
          : null,
        state === "failed" && rng() > 0.78 ? 2 : 0,
        new Date(now - 110 * 60000).toISOString(),
        new Date(now - (1 + Math.floor(rng() * 6)) * 60000).toISOString(),
      );
    }
    // Front-load a few deterministic events for the activity feed.
    const events = db.prepare(
      "INSERT INTO events(environment_id,type,message,created_at) VALUES(?,?,?,?)",
    );
    const records = db
      .prepare(
        "SELECT id, state, step_index, step_started_at, ended_at FROM environments ORDER BY id LIMIT 15",
      )
      .all();
    for (let i = 0; i < records.length; i++) {
      const e = records[i];
      events.run(
        e.id,
        e.state === "failed"
          ? "failure"
          : e.state === "deprovisioned"
            ? "completed"
            : "progress",
        e.state === "failed"
          ? "Environment failure detected"
          : e.state === "deprovisioned"
            ? "Lab completed and deprovisioned"
            : e.state === "ready"
              ? "Lab is ready for use"
              : e.state === "provisioning"
                ? "Environment provisioning started"
                : `Advanced to step ${e.step_index + 1}`,
        e.ended_at || e.step_started_at,
      );
    }
    db.exec("COMMIT");
    return true;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function addEvent(id, type, message, now = new Date()) {
  db.prepare(
    "INSERT INTO events(environment_id,type,message,created_at) VALUES(?,?,?,?)",
  ).run(id, type, message, now.toISOString());
  db.prepare(
    "DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT 250)",
  ).run();
}

export function enrich(e, now = new Date()) {
  const effectiveEnd = e.ended_at ? new Date(e.ended_at) : now;
  const risk = assessRisk(e, effectiveEnd);
  const cost =
    (e.accrued_spend_cents || 0) +
    spendCents(e.hourly_rate_cents, e.started_at, effectiveEnd);
  return {
    ...e,
    step_name:
      e.state === "deprovisioned"
        ? "Completed"
        : e.step_index === 0 && e.state !== "in_use" && e.state !== "failed"
          ? "Awaiting start"
          : STEPS[Math.min(7, e.step_index)],
    progress_percent: progressPercent(e.step_index, e.state),
    step_minutes: risk.step_minutes,
    runtime_minutes: e.started_at
      ? durationMinutes(e.started_at, effectiveEnd)
      : 0,
    estimated_spend_cents: cost,
    risk_level: risk.level,
    risk_reasons: risk.reasons,
    needs_attention: risk.needs_attention,
  };
}

export function allEnvironments(now = new Date()) {
  return db
    .prepare("SELECT * FROM environments")
    .all()
    .map((e) => enrich(e, now));
}

export function allEvents(limit = 8) {
  return db
    .prepare(
      `SELECT ev.id, ev.environment_id, ev.type, ev.message, ev.created_at, env.learner_name
    FROM events ev JOIN environments env ON env.id=ev.environment_id
    ORDER BY ev.created_at DESC, ev.id DESC LIMIT ?`,
    )
    .all(limit);
}

export function getEnvironment(id, now = new Date()) {
  const e = db.prepare("SELECT * FROM environments WHERE id=?").get(id);
  if (!e) return null;
  const events = db
    .prepare(
      "SELECT id, type, message, created_at FROM events WHERE environment_id=? ORDER BY created_at DESC, id DESC LIMIT 15",
    )
    .all(id);
  return { ...enrich(e, now), events, steps: STEPS };
}

function chooseSortKey(sort) {
  return [
    "attention",
    "learner",
    "state",
    "progress",
    "step_time",
    "spend",
    "updated",
  ].includes(sort)
    ? sort
    : "attention";
}

export function getDashboard(params = {}, now = new Date()) {
  const data = allEnvironments(now);
  const states = Object.fromEntries(
    ["provisioning", "ready", "in_use", "failed", "deprovisioned"].map((k) => [
      k,
      0,
    ]),
  );
  data.forEach((e) => states[e.state]++);
  const totalSpend = data.reduce((s, e) => s + e.estimated_spend_cents, 0);
  const averageProgress = Math.round(
    data.reduce((s, e) => s + e.progress_percent, 0) / data.length,
  );
  const risks = data.filter((e) => e.needs_attention);
  // Broken environments have first response priority; long stalls come next.
  const priority = (e) =>
    e.state === "failed"
      ? 3
      : e.risk_level === "critical"
        ? 2
        : e.risk_level === "warning"
          ? 1
          : 0;
  const topAtRisk = risks
    .sort(
      (a, b) => priority(b) - priority(a) || b.step_minutes - a.step_minutes,
    )
    .slice(0, 6);
  const search = String(params.search || "")
    .trim()
    .toLowerCase()
    .slice(0, 100);
  const state = String(params.state || "all");
  const riskOnly = params.risk === "true";
  const filtered = data.filter(
    (e) =>
      (state === "all" || e.state === state) &&
      (!riskOnly || e.needs_attention) &&
      (!search ||
        [e.learner_name, e.learner_email, e.id, e.region].some((v) =>
          v.toLowerCase().includes(search),
        )),
  );
  const sort = chooseSortKey(params.sort);
  const direction = params.direction === "asc" ? 1 : -1;
  filtered.sort((a, b) => {
    if (sort === "attention")
      return (
        priority(b) - priority(a) ||
        b.step_minutes - a.step_minutes ||
        a.id.localeCompare(b.id)
      );
    const av =
      sort === "learner"
        ? a.learner_name
        : sort === "state"
          ? a.state
          : sort === "progress"
            ? a.progress_percent
            : sort === "spend"
              ? a.estimated_spend_cents
              : sort === "updated"
                ? a.updated_at
                : a.step_minutes;
    const bv =
      sort === "learner"
        ? b.learner_name
        : sort === "state"
          ? b.state
          : sort === "progress"
            ? b.progress_percent
            : sort === "spend"
              ? b.estimated_spend_cents
              : sort === "updated"
                ? b.updated_at
                : b.step_minutes;
    return (
      (typeof av === "number"
        ? av - bv
        : String(av).localeCompare(String(bv))) * direction ||
      a.id.localeCompare(b.id)
    );
  });
  return {
    server_time: now.toISOString(),
    session: {
      name: "Azure Administrator — Cloud Foundations",
      code: "AZ-104 · WORKSHOP 07",
      started_at: db
        .prepare("SELECT value FROM meta WHERE key=?")
        .get("session_started_at")?.value,
      total: data.length,
      active: states.in_use + states.ready,
      in_use: states.in_use,
      failures: states.failed,
      estimated_spend_cents: totalSpend,
      average_completion_percent: averageProgress,
      attention_count: risks.length,
      states,
    },
    filters: {
      state,
      search,
      risk: riskOnly,
      sort,
      direction: params.direction === "asc" ? "asc" : "desc",
    },
    total_filtered: filtered.length,
    environments: filtered,
    at_risk: topAtRisk,
    events: allEvents(6),
  };
}

export function reprovision(id, now = new Date()) {
  const old = db.prepare("SELECT * FROM environments WHERE id=?").get(id);
  if (!old) return { ok: false, status: 404, error: "Environment not found" };
  if (old.state !== "failed")
    return {
      ok: false,
      status: 409,
      error: "Only failed environments can be reprovisioned",
    };
  const priorCost = spendCents(old.hourly_rate_cents, old.started_at, now);
  db.prepare(
    `UPDATE environments SET state='provisioning', step_index=0, step_started_at=?,
    started_at=NULL, ended_at=NULL, error_code=NULL, reprovision_attempts=reprovision_attempts+1,
    accrued_spend_cents=accrued_spend_cents+?, updated_at=? WHERE id=?`,
  ).run(now.toISOString(), priorCost, now.toISOString(), id);
  addEvent(
    id,
    "reprovision",
    "Reprovision requested; environment is provisioning",
    now,
  );
  return { ok: true, status: 200, environment: getEnvironment(id, now) };
}

/** True server-owned simulation: every tick moves a real SQLite row. */
let tickCount = 0;
export function simulateTick(now = new Date()) {
  tickCount++;
  const candidates = db
    .prepare(
      "SELECT id,state,step_index FROM environments WHERE state IN ('provisioning','ready','in_use') ORDER BY updated_at ASC LIMIT 18",
    )
    .all();
  if (!candidates.length) return null;
  const target = candidates[tickCount % candidates.length];
  let nextState = target.state,
    nextStep = target.step_index,
    error = null;
  if (target.state === "provisioning") {
    nextState = "ready";
  } else if (target.state === "ready") {
    nextState = "in_use";
    nextStep = 0;
  } else if (tickCount % 13 === 0) {
    nextState = "failed";
    error = "VM_START_TIMEOUT";
  } else if (target.step_index >= 7) {
    nextState = "deprovisioned";
    nextStep = 8;
  } else nextStep++;
  const date = now.toISOString();
  db.prepare(
    `UPDATE environments SET state=?, step_index=?, error_code=?,
    step_started_at=?, started_at=CASE WHEN ?='in_use' AND started_at IS NULL THEN ? ELSE started_at END,
    ended_at=CASE WHEN ?='deprovisioned' THEN ? ELSE ended_at END,
    updated_at=? WHERE id=?`,
  ).run(
    nextState,
    nextStep,
    error,
    date,
    nextState,
    date,
    nextState,
    date,
    date,
    target.id,
  );
  addEvent(
    target.id,
    nextState === "failed"
      ? "failure"
      : nextState === "deprovisioned"
        ? "completed"
        : "progress",
    nextState === "failed"
      ? "VM start timeout detected"
      : nextState === "deprovisioned"
        ? "Lab completed and deprovisioned"
        : nextState === "ready"
          ? "Lab is ready for use"
          : target.state === "ready"
            ? "Learner began the lab"
            : `Advanced to step ${nextStep + 1}`,
    now,
  );
  return getEnvironment(target.id, now);
}

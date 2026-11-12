import test from "node:test";
import assert from "node:assert/strict";
process.env.DB_PATH = ":memory:";
const { seed, allEnvironments, db } = await import("../server/db.mjs");
const { getInsights, validateFocus } = await import("../server/insights.mjs");
seed(true);

test("model selection cannot supply prose, unknown labs, duplicates or extra claims", () => {
  const labs = [{ id: "LAB-001" }];
  for (const value of [
    null,
    {},
    [],
    { focus_ids: [] },
    { focus_ids: ["LAB-999"] },
    { focus_ids: ["LAB-001", "LAB-001"] },
    { focus_ids: ["LAB-001"], summary: "999 failures" },
    { focus_ids: [null] },
  ])
    assert.equal(validateFocus(value, labs), null);
  assert.deepEqual(validateFocus({ focus_ids: ["LAB-001"] }, labs), labs);
});

test("provider success renders server facts; outages and invalid output safely fall back", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.AI_API_KEY;
  const originalBase = process.env.AI_BASE_URL;
  delete process.env.AI_BASE_URL;
  try {
    delete process.env.AI_API_KEY;
    assert.equal((await getInsights()).mode, "rules");
    process.env.AI_API_KEY = "test-only";
    const id = allEnvironments().find((e) => e.state === "failed").id;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        choices: [
          { message: { content: JSON.stringify({ focus_ids: [id] }) } },
        ],
      }),
    });
    const result = await getInsights();
    assert.equal(result.mode, "model");
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].id, id);
    assert.ok(!Number.isNaN(Date.parse(result.assessed_at)));
    assert.match(result.summary, new RegExp(id));
    assert.ok(
      result.summary.includes(
        allEnvironments().find((e) => e.id === id).risk_reasons[0],
      ),
    );
    for (const content of [
      "There are 999 failed labs.",
      '{"focus_ids":["LAB-999"]}',
      '{"focus_ids":["LAB-001"],"summary":"invented"}',
      "",
      "{}",
    ]) {
      globalThis.fetch = async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content } }] }),
      });
      assert.equal((await getInsights()).mode, "rules");
    }
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    assert.equal((await getInsights()).mode, "rules");
    globalThis.fetch = async () => {
      throw new Error("offline");
    };
    assert.equal((await getInsights()).mode, "rules");
    globalThis.fetch = async () => {
      throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
    };
    const timeout = await getInsights();
    assert.equal(timeout.mode, "rules");
    assert.match(timeout.note, /timeout/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBase === undefined) delete process.env.AI_BASE_URL;
    else process.env.AI_BASE_URL = originalBase;
    if (originalKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = originalKey;
  }
});

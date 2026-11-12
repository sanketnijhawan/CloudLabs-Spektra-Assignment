import { allEnvironments } from "./db.mjs";

function groundedFallback(envs) {
  const failed = envs.filter((e) => e.state === "failed");
  const stuck = envs.filter(
    (e) => e.state === "in_use" && e.step_minutes >= 20,
  );
  const delayed = envs.filter(
    (e) => e.state === "provisioning" && e.step_minutes >= 12,
  );
  const priority = (e) =>
    e.state === "failed"
      ? 3
      : e.risk_level === "critical"
        ? 2
        : e.risk_level === "warning"
          ? 1
          : 0;
  const top = envs
    .filter((e) => e.needs_attention)
    .sort(
      (a, b) => priority(b) - priority(a) || b.step_minutes - a.step_minutes,
    )
    .slice(0, 5);
  const headline = `${failed.length} failed · ${stuck.length} stalled · ${delayed.length} slow provisioning`;
  const summary = `There are ${failed.length} failed labs, ${stuck.length} learners on a step for at least 20 minutes, and ${delayed.length} labs provisioning for at least 12 minutes. Prioritize failed labs, then the longest waits.`;
  return {
    headline,
    assessed_at: new Date().toISOString(),
    summary: top.length
      ? summary
      : "No labs currently cross the review thresholds. Continue monitoring the session.",
    actions: top.map((e) => ({
      id: e.id,
      learner: e.learner_name,
      reason: e.risk_reasons.join("; "),
      severity: e.risk_level,
    })),
    mode: "rules",
    label: "Rules-based assessment",
    note: "No AI key is configured or the model is unavailable. All recommendations use transparent server-side thresholds.",
  };
}

// No model-authored prose reaches the UI. It selects up to three evidence IDs;
// all displayed facts and reasons are rendered from the captured server snapshot.
export function validateFocus(value, labs) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !Array.isArray(value.focus_ids)
  )
    return null;
  const ids = value.focus_ids;
  if (
    !ids.length ||
    ids.length > 3 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => typeof id !== "string" || !labs.some((e) => e.id === id))
  )
    return null;
  return ids.map((id) => labs.find((e) => e.id === id));
}

export async function getInsights() {
  const envs = allEnvironments();
  const fallback = groundedFallback(envs);
  const key = process.env.AI_API_KEY;
  if (!key && !process.env.AI_BASE_URL)
    return {
      ...fallback,
      note: "No model configured. Showing transparent rules-based priorities.",
    };
  const base = (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(
    /\/$/,
    "",
  );
  const model = process.env.AI_MODEL || "gpt-4o-mini";
  // The model is only asked to interpret a constrained, grounded snapshot.
  const priority = (e) =>
    e.state === "failed"
      ? 3
      : e.risk_level === "critical"
        ? 2
        : e.risk_level === "warning"
          ? 1
          : 0;
  const problemLabs = envs
    .filter((e) => e.needs_attention)
    .sort(
      (a, b) => priority(b) - priority(a) || b.step_minutes - a.step_minutes,
    )
    .slice(0, 14);
  if (!problemLabs.length)
    return {
      ...fallback,
      note: "No at-risk learners; no model request needed.",
    };
  const snapshot = {
    counts: {
      failed: envs.filter((e) => e.state === "failed").length,
      stalled: envs.filter((e) => e.state === "in_use" && e.step_minutes >= 20)
        .length,
      slow_provisioning: envs.filter(
        (e) => e.state === "provisioning" && e.step_minutes >= 12,
      ).length,
    },
    labs: problemLabs.map((e) => ({
      id: e.id,
      state: e.state,
      step: e.step_index + 1,
      minutes: e.step_minutes,
      error: e.error_code,
      reason: e.risk_reasons,
    })),
  };
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(6500),
      headers: {
        "Content-Type": "application/json",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 2048,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              'Select up to three representative labs for instructor review using only supplied labs. Cover different failure codes or stalled workshop steps rather than repeatedly selecting the same signal. Include a failed lab if present and a critical stalled learner if present. Prefer long waits when otherwise equal. Return ONLY a JSON object with the single key focus_ids containing the selected lab IDs, for example {"focus_ids":["LAB-001"]}. No prose or additional keys.',
          },
          { role: "user", content: JSON.stringify(snapshot) },
        ],
      }),
    });
    if (!response.ok)
      throw new Error(`AI provider returned ${response.status}`);
    const json = await response.json();
    const selected = validateFocus(
      JSON.parse(json?.choices?.[0]?.message?.content),
      problemLabs,
    );
    if (!selected) throw new Error("Ungrounded model selection");
    const summary =
      "Suggested focus: " +
      selected.map((e) => `${e.id} — ${e.risk_reasons.join("; ")}`).join(". ") +
      ".";
    return {
      ...fallback,
      summary,
      actions: selected.map((e) => ({
        id: e.id,
        learner: e.learner_name,
        reason: e.risk_reasons.join("; "),
        severity: e.risk_level,
      })),
      mode: "model",
      label: `AI-assisted · ${model}`,
      note: "AI selected a focused shortlist. Every name and reason comes from workshop records; the main queue keeps its rule-based order.",
    };
  } catch (err) {
    return {
      ...fallback,
      note: `AI service unavailable (${err.name === "TimeoutError" ? "timeout" : "provider error"}). Showing transparent rules-based assessment.`,
    };
  }
}

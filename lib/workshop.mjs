/** Pure business logic; deliberately shared by API, seed, and unit tests. */
export const STEPS = [
  "Open Azure portal",
  "Create resource group",
  "Deploy virtual machine",
  "Configure networking",
  "Set access permissions",
  "Connect to VM",
  "Run workshop workload",
  "Validate & submit",
];

export const STATES = [
  "provisioning",
  "ready",
  "in_use",
  "failed",
  "deprovisioned",
];
export const ALLOWED_SORTS = {
  learner: "learner_name",
  state: "state",
  progress: "step_index",
  step_time: "step_started_at",
  spend: "estimated_spend_cents",
  updated: "updated_at",
};

export function durationMinutes(start, end = new Date()) {
  if (!start) return 0;
  return Math.max(
    0,
    Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 60000),
  );
}

export function spendCents(rateCentsPerHour, start, end = new Date()) {
  if (!start) return 0;
  const hours =
    Math.max(0, new Date(end).getTime() - new Date(start).getTime()) / 3600000;
  return Math.round(hours * rateCentsPerHour);
}

export function progressPercent(stepIndex, state, totalSteps = STEPS.length) {
  if (state === "deprovisioned") return 100;
  return Math.min(100, Math.round((Math.max(0, stepIndex) / totalSteps) * 100));
}

/** Returns explicit and auditable risk reasons, never invented by an LLM. */
export function assessRisk(env, now = new Date()) {
  const minutes = durationMinutes(env.step_started_at, now);
  const reasons = [];
  if (env.state === "failed") {
    reasons.push(
      env.error_code
        ? `Failed: ${env.error_code.replaceAll("_", " ").toLowerCase()}`
        : "Environment failed",
    );
  }
  if (env.state === "in_use" && minutes >= 20) {
    reasons.push(
      `On step ${env.step_index + 1} for ${minutes} min (20 min threshold)`,
    );
  }
  if (env.state === "provisioning" && minutes >= 12) {
    reasons.push(`Provisioning for ${minutes} min (12 min threshold)`);
  }
  if (env.reprovision_attempts >= 2 && env.state !== "deprovisioned") {
    reasons.push(`${env.reprovision_attempts} reprovision attempts`);
  }
  const level =
    env.state === "failed" || (minutes >= 40 && env.state === "in_use")
      ? "critical"
      : reasons.length
        ? "warning"
        : "normal";
  return {
    level,
    reasons,
    needs_attention: reasons.length > 0,
    step_minutes: minutes,
  };
}

export function formatMoney(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

// Explicit opt-in provider check. Never prints credentials or raw provider output.
import { seed } from "../server/db.mjs";
import { getInsights } from "../server/insights.mjs";
if (!process.env.AI_API_KEY && !process.env.AI_BASE_URL) {
  console.error(
    "No model configured. Fill in .env first; the dashboard still works with rules.",
  );
  process.exitCode = 1;
} else {
  seed();
  const result = await getInsights();
  if (result.mode !== "model") {
    console.error(
      `Provider check did not produce a model assessment: ${result.note}`,
    );
    process.exitCode = 1;
  } else
    console.log(
      `Provider returned a validated shortlist of ${result.actions.length} labs. ${result.label}`,
    );
}

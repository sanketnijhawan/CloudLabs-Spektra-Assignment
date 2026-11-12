# Walkthrough and final checks

Use the actual running app. Keep narration natural; explain decisions you understand.

## 60–90 second walkthrough

- **0–15s:** Show all 120 environments. Explain that the table defaults to intervention priority and the summary covers the whole session.
- **15–35s:** Filter failed labs, open a learner and show the error/history. Retry the environment, then show provisioning and the new event. Existing spend is retained.
- **35–50s:** Show attention-only filtering, current step numbers and elapsed times. Explain that a long step is a signal to review, not proof that someone is stuck.
- **50–70s:** Review at-risk. If a provider is genuinely configured, show its validated shortlist. The committed `screenshots/ai-assisted-mode.png` captures a genuine Gemini selection; `screenshots/ai-rules-fallback.png` captures a timeout fallback. Do not call the rules-only demo a successful model integration.
- **70–90s:** Show a live update, then briefly explain server-side cost calculation and one tradeoff.

## Check before sending

1. Use Node 24. Extract the archive; run `npm start`. No install is needed to run the application.
2. Run `npm test`. For DOM checks, run `npm ci` then `npm run test:ui`.
3. Install the browser with `npx playwright install chromium`, then run `npm run screenshots`. Inspect desktop and mobile captures. The Windows capture run passed; current clean images are included in screenshots/.
4. Tab through filters, rows and Retry. Leave a row focused through a refresh. Open/close a dialog with Escape; verify focus returns. Inspect text contrast and zoom to 200%.
5. Test empty search and connection loss. Confirm the last data remains marked stale after a disconnection.
6. If demonstrating a model, configure `.env` and run `npm run check:ai` to verify the real provider. The two submitted app-only screenshots document successful Gemini mode and the earlier timeout fallback. Do not commit `.env` or disclose the key.
7. Read `DECISIONS.md`, amend the AI disclosure to match your involvement, and push the source to your GitHub repository. Never commit credentials, local SQLite files or `node_modules`.

## Be prepared to explain

- Why are filters, totals and spend server-side?
- Why keep session totals independent of table filters?
- What qualifies as at risk, and what are the limitations of fixed thresholds?
- Why does the model return IDs rather than text?
- What happens when a new filter is chosen during a slow request?
- How are prior costs retained after retry?
- What would change for early teardown, more learners, real Azure events or multiple server instances?

# CloudLabs Workshop Operations

A live instructor dashboard for a simulated Azure workshop with 120 learners.

**Design intent:** Keep failures and long waits at the top of a dense, readable monitor, with whole-session totals always visible above it.

## Run

Use Node.js 24 (minimum 22.16). The application has no runtime dependencies and creates its SQLite dataset automatically.

```bash
npm start
```

Open http://localhost:3000. On Windows, `start-windows.bat` runs the same app. An optional `.env` is loaded on startup. Without a model configuration, the dashboard uses its labelled rules-based assessment.

```bash
npm test        # 11 backend/business-logic tests; no install required
npm run seed   # reset the LOCAL demo dataset
npm run dev    # watch backend changes
```

## What the instructor can do

- Scan all 120 mounted rows, with explicit lifecycle labels, progress, current step, elapsed time and spend. The default order prioritizes failed labs, critical stalls and other review signals.
- Search and filter by state or attention, and sort by progress, elapsed time, spend, name or update time. Requests are processed on the server. Summary totals always cover the whole session.
- Open learner details, review steps/failure/history, and retry a failed lab. Retry persists provisioning, clears the failure, resets the current lab's progress, retains earlier spend and records an event. Invalid transitions return HTTP 409.
- Watch persisted changes from an independent twelve-second server simulation through five-second polling. Focus and scroll survive updates; open details refresh too.
- Use Activity in a drawer, the optional at-risk assessment, or manual filters. Loading, empty search, initial failure/retry and stale-data states are implemented.

Spend is estimated in integer USD cents: previous attempts' accrued cost + hourly rate × billable runtime. Deprovisioned labs stop accruing cost. In this simulation deprovisioned implies completed; early teardown would need a separate completion field. No real Azure resources are created or billed.

## Grounded AI assessment

Rules flag failed environments, 20+ minutes on a step (critical at 40), provisioning for 12+ minutes, or at least two retries. An optional model receives up to fourteen flagged records and aggregate counts, then selects up to three representative lab IDs covering distinct signals. The server validates those IDs and constructs every displayed name and reason from the captured records. The model cannot write arbitrary displayed facts or mutate state.

Missing configuration, invalid/duplicate/unknown IDs, additional output fields, malformed JSON, provider errors and a 6.5-second timeout fall back to the explicitly labelled rules-based assessment. Manual controls and the main queue remain available. The assessment displays its mode and snapshot timestamp.

### Optional provider configuration

Create a local `.env` beside `package.json`, using your own credentials. The manually verified provider/model was Gemini 3.5 Flash-Lite through its OpenAI-compatible endpoint:

```dotenv
AI_API_KEY=YOUR_GEMINI_KEY
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
AI_MODEL=gemini-3.5-flash-lite
```

Other compatible chat-completion providers can use their own base URL/model. A local provider that ignores authentication may omit the key. JSON object response mode is required for model mode; incompatible or unavailable providers safely fall back.

```bash
npm run check:ai
```

Restart the app after changing `.env`. Keep actual credentials local; the submission includes only `.env.example`.

## Verification and screenshots

```bash
npm ci
npm run test:ui
npx playwright install chromium
npm run screenshots
```

On Windows, `verify-windows.bat` runs these checks in order. Capture uses a separate temporary database and never resets the normal workshop.

- Eleven backend tests and one real-HTTP/SQLite DOM integration test pass. They cover records, aggregates, spend, valid/invalid mutation, simulation, risk/fallback boundaries, filter races, focus, drawer updates, loading, empty results and recovery. Process cleanup waits for exit before removing SQLite files, including Windows retry handling.
- The Windows browser capture run passed density, no document overflow, polling-focus and mutation checks. Eight app-only images are in `screenshots/`, including clean empty/mobile states and the deliberate connection-failure state.
- A genuine Gemini call returned a validated shortlist of three labs. The candidate's live UI screenshot also showed AI-assisted mode with failure/retry and long-step reasons. The bundled automated at-risk capture intentionally demonstrates the no-key fallback; an app-only model-mode capture can supplement it.
- Text/status contrast was checked numerically. Native controls, visible focus, row keyboard shortcuts, dialog focus handling and reduced-motion support are implemented. A complete accessibility audit and a separate 200% zoom walkthrough have not been claimed.

See `REQUIREMENTS.md` for the final audit and `DEMO.md` for a 60–90 second walkthrough.

## Source map and limits

| Area | Location |
|---|---|
| API routes and server simulation timer | `server/index.mjs` |
| SQLite seed, filtering, sorting, totals and mutation | `server/db.mjs` |
| Model request, validation and fallback | `server/insights.mjs` |
| Spend, duration, progress and risk rules | `lib/workshop.mjs` |
| Interface and polling | `public/` |

API routes: `GET /api/health`, `GET /api/dashboard`, `GET /api/environments/LAB-001`, `POST /api/environments/LAB-001/reprovision`, `POST /api/insights`. Dashboard query fields are `state`, `search`, `risk`, `sort`, `direction`. Intervention priority is fixed; other sorts support direction.

The exercise uses one local process, synthetic learner data and approximate per-lab rates. Production hosting would need authorization, persistent managed storage, real telemetry, appropriate scaling and actual billing data.

## AI assistance

ChatGPT assisted with architecture, application code, interaction design, tests and documentation. The decorative sidebar/state-chart layout, stacked retry notices and whole-table replacement were revised after inspection. Free-form model output was rejected after a fabricated-summary test; the model now returns only validated record IDs. Verification evidence distinguishes automated checks, manual provider/browser observations and remaining accessibility review.

## Keyboard and zoom checks

`npm run check:a11y` runs a real-browser keyboard-only flow against a temporary workshop: Tab/Shift+Tab, focus outlines, Enter/Space activation, search/filter/sort, row arrows, dialog focus trapping/restoration and Retry. It also checks the reflow equivalent of 200% zoom using half-size CSS viewports at device scale 2, for 1440×960 and 1920×1080 screens. Results/screenshots go to `accessibility-results/`.

The original three-layout browser check passed on Windows (user-provided output). A later native zoom screenshot exposed a collapsed table at a shorter CSS viewport. The layout now permits page scrolling on short screens, and the expanded browser check asserts table height plus visible header and learner row at five viewport sizes. The expanded check still needs a Windows run; the refinement browser cannot reach the local server. The DOM regression reproducing stale dialog-opener focus failed before the fix and passed after it. Exact native browser zoom and a manual accessibility sign-off remain pending; the reflow-equivalent check is not a substitute claim.

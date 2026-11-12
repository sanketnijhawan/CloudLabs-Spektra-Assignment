# Engineering decisions

**Data model.** SQLite stores 120 seeded environments with lifecycle state, eight-step progress, step/start/end timestamps, hourly rate in cents, accrued spend across attempts, failure code and retry count. Events record changes; session metadata stores the start. Step timestamps are bounded by runtime. Deprovisioned implies completed here; early teardown would need an independent completion field.

**Server ownership.** The server filters, sorts, computes spend and session aggregates, and derives risk reasons. Retry is a persisted POST transition valid only for failures; it retains prior cost and adds an event. A twelve-second server timer changes stored rows independently of five-second browser polling. One process and local SQLite keep the exercise easy to run.

**Interaction and density.** Failed labs and critical stalls come first. A compact summary and viewport-sized table replace decorative panels. Activity opens in a drawer; retries share one status message. Keyed rows preserve focus/scroll, filters queue behind pending requests, stale responses are discarded, and details refresh. Explicit state text, tabular numbers, keyboard shortcuts, focus handling and reduced-motion support improve scanning and access.

**AI boundary.** Rules own risk and the main queue. A model selects up to three representative IDs from a bounded snapshot. The server validates the IDs and supplies every displayed name/reason. Missing configuration, unknown/duplicate IDs, extra fields, malformed JSON, errors or timeout fall back to labelled rule-based output. Manual controls always work independently; mode and snapshot time stay visible.

**Validation and next.** Eleven backend tests and the real-API DOM test passed, including Windows cleanup. The Windows browser capture checks passed and eight screenshots were reviewed. A genuine Gemini 3.5 Flash-Lite call produced three validated IDs; its live UI was also observed. Contrast pairs were checked numerically; full accessibility/200% zoom review remains separate. Production work would add authorization, hosted persistence, telemetry and real pricing.

**AI assistance.** ChatGPT assisted with implementation, review, tests and document drafts. Rejected approaches included unrestricted model prose, decorative panels, stacked notifications and replacing the entire table on every poll. These were replaced with bounded evidence selection and workflow-focused interactions.

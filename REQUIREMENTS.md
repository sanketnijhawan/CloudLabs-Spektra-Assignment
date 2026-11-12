# Final assignment audit

| Requirement | Evidence | Result |
|---|---|---|
| ~120 environments, five states | SQLite seed; API/DOM count assertions; all five status filters | Implemented and tested |
| Progress and current-step duration | Step number/name, progress percentage, elapsed timers and threshold-based review reasons | Implemented; screenshots reviewed |
| Session active/failures/spend/completion | Whole-session server aggregates; tests compare against records | Implemented and tested |
| Backend-hitting action | Persisted Retry POST; subsequent GET and history reflect provisioning | HTTP, DOM and Windows browser checks passed |
| Loading/empty/error/dense states | Real pending request, no results, initial failure/retry, marked stale data, 120 mounted rows | Tested; eight screenshot captures reviewed |
| Server filtering/sorting/spend math | Node server operates on SQLite records; rate × runtime plus accrued cost | Implemented and tested |
| Server-side state drift | Independent twelve-second simulator updates SQLite; browser polls every five seconds | Simulation tests and code verified |
| One grounded AI feature | At-risk summary; model selects real flagged IDs; server supplies names/reasons | Genuine Gemini provider call and AI-assisted UI observed |
| Graceful model failure and optional AI | Missing config, invalid output, provider error and timeout use rules; manual filters/actions remain available | Automated fallback checks; rules-mode screenshot included |
| No decorative template or forbidden effects | Table-first viewport; restrained status palette; no gradients, glass, glow, emoji icons or decorative chart | Code and screenshots reviewed |
| Type, alignment, motion and accessibility | Tabular numeric values, explicit status words, keyboard/focus handling, reduced motion; contrast pairs checked | Implemented; automated interaction checks passed. Full accessibility audit/200% zoom not claimed |
| README, design intent, concise decisions and AI disclosure | Included at project root | Included |
| Screenshots under load or recording | Eight app-only screenshots included; walkthrough in DEMO.md | Screenshot option satisfied |
| Repository link | [Public GitHub repository](https://github.com/sanketnijhawan/CloudLabs-Spektra-Assignment) | Published; uploaded code independently cloned and tested |

## Verification scope

The uploaded source was independently extracted without credentials or runtime state and re-tested: eleven backend tests and one real-API DOM integration test passed. Windows browser/provider verification is supported by the candidate's terminal output and supplied screenshots, not a claim of a new provider call during this final audit.

The public repository excludes `.env`, installed dependencies and live database files. `.env.example` contains placeholders only. Synthetic seed data is recreated automatically. Commit `5c90626` was independently cloned and its eleven backend tests and one DOM integration test passed. The candidate's Windows output shows all five keyboard/reflow checks passing; a supplied native zoom screenshot shows the table visible after the height fix. Deployment, email submission and a complete accessibility audit are not claimed.

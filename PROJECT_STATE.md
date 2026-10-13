# Project State — AI Fitness Experiment Lab

Persistent summary for new sessions. Details live in `spec.md` (product) and `CLAUDE.md` (rules). Update this file after each milestone.

## Milestones
- M0: CV foundation — COMPLETE
- M1: architecture / contracts / backend / DB — COMPLETE
- M2: profile / personalization / workout generation — COMPLETE
- M3: follow-along runner / session recording — COMPLETE
- M4: multi-exercise CV (squat, lunge, curl, bilateral shoulder press; push-up manual) — COMPLETE
- M5: real-time coaching / voice feedback — COMPLETE
- M6: history / metrics / simulated history — COMPLETE
- M7: deterministic experiment engine — COMPLETE
- M8: AI analysis (Groq via provider-agnostic `LlmClient`; validated, deterministic fallback) — COMPLETE
- M9: adaptation engine (experiment result → proposal → approval → applied → next workout) — COMPLETE
- M10: hardening / production / demo readiness — COMPLETE (real-camera CV sign-off pending, see below)
- M11: logic integrity (genuine completion, assigned experiments, restrictions, preferred time) — COMPLETE
- Public demo: anonymous visitor sessions, ownership isolation, abuse limits, Vercel + Render config — IMPLEMENTED, NOT YET DEPLOYED
- **All planned milestones done. Next: the remaining deployment tasks (end of this file) and the user's real-camera CV check.**

## Stack
- Frontend: React + TypeScript + Vite (`src/`)
- Backend: Node (≥ 22.18, native TS) + Fastify + SQLite via `node:sqlite` (`server/`)
- Shared Zod contracts, exercise library, deterministic metrics/engines (`shared/`)
- Tests: Vitest, **409 passing in 30 files** (`npm test`); `npm run typecheck`; `npm run build`
- Dev: `npm run dev:all` (API :3001, UI :5173)
- Deploy target: frontend on **Vercel** (`vercel.json`), API on **Render** (`render.yaml`, `npm start`, API-only). Single-server alternative: `npm run build` then `NODE_ENV=production DATABASE_URL=file:/abs/path.db TRUST_PROXY=none HOST=0.0.0.0 npm start` (README "Deployment").

## Invariants
- CV, rep counting, form rules, metrics, adherence, experiments: deterministic code only.
- The LLM (Groq; provider replaceable) interprets structured, already-computed data; it must NOT calculate or invent metrics.
- No medical diagnosis or medical recommendations; restrictions are user-provided constraints.
- Simulated data is always flagged (`is_simulated`) and labelled SIMULATED in the UI.
- API key stays server-side (`GROQ_API_KEY`, optional `GROQ_MODEL`); the app must work without it (deterministic fallback).
- Preserve completed milestones; do not change squat CV thresholds.
- Every private API route is scoped to the current visitor: user ids come only from `requireVisitor(request)`; repositories take the id and filter by it. New `/api` routes are private by default.

## AI analysis (M8) — how it works
- `server/ai/`: `llm.ts` (provider interface), `groqClient.ts`, `facts.ts` (computed facts + allowed numbers), `validate.ts` (refs, numbers, unsafe wording), `analysisService.ts` (prompt, fallback, orchestration).
- `POST /api/ai/experiments/:id/analysis` → `AnalysisReport` (generated on demand, not stored). `source`: `llm` | `fallback` (+ `fallbackReason`); `isSimulated` + `notice` label SIMULATED data.
- Insights UI: `src/pages/InsightsPage.tsx`. Adaptation (M9) should reuse `AdaptationProposal` and keep significant changes user-approved.

## Adaptation (M9) — how it works
- `shared/adaptation/engine.ts` (pure rules, classification, restriction guard, lifecycle), `server/services/adaptationService.ts`, `server/routes/adaptations.ts`, `src/pages/AdaptationPage.tsx`. No LLM decides anything.
- Rules: `workout_time` experiment → preferred time (minor); `workout_duration` experiment → workout length (significant). Needs a completed experiment with sufficient data and a clear difference (≥10 points, or ≥1 rating point).
- Lifecycle: `POST /:id/approve` = accept + apply in ONE atomic step (`pending → applied`); `decline` from any open state; `POST /:id/refresh` re-derives a stale proposal in place (same id, still one per experiment). `auto_applied` only for minor, safe (timing), REAL-data proposals; a failed auto-apply rolls back and stays pending. `accepted` exists only as a legacy state (still approvable/declinable). Simulated proposals always need approval and are labelled SIMULATED.
- The profile is the workout-generation config: apply updates it (constraints untouched), then generates the next workout via the normal personalization/generator. Profile + next workout + proposal status are written in one transaction (`withTransaction`, `writeProfile`); any failure rolls back and the proposal stays open. Stale proposals (settings changed since; preferred times compared as sets) cannot be applied until refreshed.
- DB migration 3 rebuilt `adaptation_proposals` (new statuses + provenance columns, one proposal per experiment).

## Production hardening (M10) — how it works
- `server/static.ts`: serves `dist/` when `NODE_ENV=production` (or `SERVE_FRONTEND=true`; `STATIC_DIR` overrides); SPA fallback to index.html, traversal-safe, `/api/*` unknown → JSON 404, `.wasm` as `application/wasm`, hashed assets immutable.
- `server/http.ts`: CORS only for `CORS_ORIGIN` (bare http(s) origin; unset = same-origin only), security headers (nosniff, no-referrer, X-Frame-Options DENY, camera-only Permissions-Policy), fixed-window per-IP rate limiter.
- AI endpoint rate-limited (`AI_RATE_LIMIT_PER_MINUTE`, default 10) → 429 `rate_limited` + `Retry-After`.
- UI: `src/components/PageStatus.tsx` (Loading / PageError with "Go to Profile" or "backend not reachable" hints) on History, Experiments, Insights, Adaptation.
- Groq: default model `openai/gpt-oss-120b` (the old `llama-3.3-70b-versatile` returned 404 for this key). gpt-oss models get `reasoning_effort: 'low'`; `max_tokens` 2000 (reasoning counts against it). Validation unchanged.

## M10 verification (2026-09-30)
- Real Groq: key valid; 3/3 live analyses returned `source: llm` and passed schema + number + wording validation (~1.2–1.6 s). `gpt-oss-20b` reply was correctly rejected for an invented number ("4 weeks") → fallback. Invalid key → 401 → `api_error` fallback. No key → `no_api_key` fallback (tests). Key never logged or sent to the browser (`/api/health` only reports `configured`).
- Production start (`NODE_ENV=production`, fresh DB): `/`, assets, wasm, SPA deep links, JSON 404, traversal attempts, CORS allow/deny, headers all checked with curl.
- Browser E2E on the production build: Profile → Workout → Follow-along (camera blocked → "permission denied" message + Complete set fallback) → feedback → History → SIMULATED history → Experiment (completed) → AI Insight (live Groq, labelled SIMULATED) → Adaptation → Accept and apply → profile preferred time = morning, next workout generated. Empty states (no profile) and backend-offline states verified on every page.
- NOT verified by Claude: real-camera CV (the in-app browser blocks the camera). User checklist in CV Lab, per exercise (squat, lunge, curl, shoulder press front view with BOTH arms, push-up): full reps count as valid; shallow/partial reps are rejected with a reason; form cue appears; one-arm press is not counted; stepping out of frame / bad angle pauses counting with a setup message; denying camera permission shows an error and the manual fallback.

## Logic integrity (M11) — how it works
- **Genuine completion** (`shared/metrics/completion.ts`): a rep-based set counts only with ≥ 1 valid rep; a timed set counts when finished. Sets with zero valid reps are still recorded but not counted. The SERVER recomputes `completionRatio` when a session is completed (the client value is ignored), so History, adherence and experiments use it.
- **Experiments** (`shared/experiments/engine.ts`, `server/services/experimentSessions.ts`): a workout generated during an ACTIVE REAL experiment is assigned A/B by alternation (`nextCondition`: the condition with fewer on-protocol sessions; on a tie, the condition whose time window contains the user's local time at generation, else A; never re-assigned by start time) and stored on the workout (migration 4: `experiment_id`, `condition_id`, `condition_label`). Shorter-vs-longer workouts are generated at 15 / 45 min; time-of-day conditions only count sessions that START in their window; Follow-Along shows `assignmentNotice` before starting (info inside the window, warning outside, uncertainty note if the experiment list fails to load; nothing for unassigned, duration, simulated or inactive experiments), and results report `excludedOutsideWindow` per condition (shown on the Experiments page; never counted retroactively). An observation = a finished, assigned, on-protocol session with ≥ 1 genuine MAIN set (warm-up/cool-down alone, click-throughs, unassigned or pre-experiment workouts do not count). Adherence = completion-rule sessions ÷ observations (assigned workouts actually performed). The old calendar quota is gone.
- **Simulated history** is still matched by its built-in pattern (time window / length) and now attends every planned slot (the difference is in completion), so the morning-vs-evening demo has ≥ 3 sessions per condition. Simulated shorter-vs-longer has no length variation, so it honestly reports "not enough data".
- **Proposals** re-derive sufficiency from the observations (`hasSufficientData`) and never trust the stored flag. Duration proposals use the experiment's exact `durationMinutes`.
- **Preferred time**: `WorkoutRequirements.preferredTimes` (from the profile) is stored on every workout and explained in "Why this workout?". It is a planning label; it does NOT change exercise selection and never affects A/B assignment. When a time-of-day assignment conflicts with it, `explainAssignment` replaces the preferred-time line with "Your experiment assignment (X) takes priority over your preferred time (y) while the experiment runs." Applying a proposal returns `effects` (`appliedEffects`): only real differences between the previous and next workout are reported, otherwise "the next workout did not change".
- **Restrictions**: both lunges now carry `avoid_deep_knee_flexion`. `POST /api/sessions` re-checks the workout against the CURRENT restrictions (`restrictionConflicts`) and returns 409 "Generate a new workout" on conflict.

## Public demo (post-M11) — how it works
- **Anonymous visitor sessions** (`server/visitors.ts`): the first `PUT /api/profile` without a session creates a visitor and its profile in one transaction and sets cookie `fl_visitor` = random 256-bit token (base64url): `HttpOnly; SameSite=Lax; Path=/api; Max-Age=30 days`, `Secure` in production. Only `SHA-256(token)` is stored (`visitors.token_hash`). `visitors.id` IS the user id (`user_profiles.id`). `last_seen_at` and the cookie expiry slide at most every 10 min. Unknown/expired tokens → stale cookie cleared.
- **Ownership isolation**: a central `onRequest` guard makes every matched `/api` route private except `GET /api/health`, `GET /api/exercises(/:id)`, `GET /api/profile` (404 without a session) and `PUT /api/profile` (starts a session); no session → 401 `unauthorized` (checked before body validation). Handlers also call `requireVisitor`; every by-id query is `AND user_id = ?`, so another visitor's ids are 404. The check lives in the backend, so calling the Render URL directly cannot bypass it. Cross-site state-changing requests (`Sec-Fetch-Site: cross-site`) → 403 `forbidden` (in addition to SameSite=Lax).
- **Migration 5**: tables `visitors` (id, token_hash UNIQUE, created_at, last_seen_at) and `ai_usage` (visitor_id, UTC day, count; deliberately not tied to the visitor row). Pre-migration local profiles belong to no visitor (the app starts empty locally; old rows stay in the file).
- **Deletion / retention**: `DELETE /api/visitor` ("Delete my data" on the Profile page) deletes the profile (cascades to constraints, workouts, sessions, events, experiments, results, reports, proposals) and the visitor, and clears the cookie. Visitors inactive > `VISITOR_RETENTION_DAYS` (30) are purged at startup, every 24 h, and when their cookie is next used. The overall AI count survives deletion.
- **Rate limits** (all keyed by Fastify's `request.ip`, i.e. resolved under `TRUST_PROXY`):
  - new visitors: `NEW_VISITORS_PER_IP_PER_HOUR` (10) and `NEW_VISITORS_PER_HOUR` overall (200) → 429 + Retry-After;
  - writes (POST/PUT/DELETE) by visitors with a session: `WRITE_RATE_LIMIT_PER_MINUTE` (120) per IP; `DELETE /api/visitor` exempt; reads never limited;
  - AI analysis: `AI_RATE_LIMIT_PER_MINUTE` (10) per IP, `AI_DAILY_LIMIT_PER_VISITOR` (20) and `AI_DAILY_LIMIT_TOTAL` (500) per UTC day (stored in `ai_usage`).
  - Per-minute/hour limiters are in memory (reset on restart).
- **Architecture**: Vercel serves `dist/` and rewrites `/api/:path*` to the Render service, so the browser only talks to the Vercel origin (same-origin API, first-party cookie, no CORS). Vercel adds nosniff / no-referrer / X-Frame-Options DENY / camera-only Permissions-Policy and a REPORT-ONLY CSP. Render runs `npm ci` + `npm start` (Node 24), health check `/api/health`, migrations on startup.
- **Production config** (`server/config.ts`, enforced at startup): `NODE_ENV=production`; `DATABASE_URL` required and ABSOLUTE (relative or `:memory:` refused, so the repo's `data/` is never used); `TRUST_PROXY` required (`none`, hop count 1–5, or proxy IPs/CIDRs; `true` refused); `SERVE_FRONTEND=false` for the API-only Render service; `HOST=0.0.0.0`; `PORT` from Render; `GROQ_API_KEY` optional (missing → deterministic fallback; set only in the Render dashboard, `sync: false`); `DEBUG_PROXY_HEADERS=true` temporarily logs the X-Forwarded-For chain for `/api/health`.
- **Render free plan (chosen)**: no persistent disk. `DATABASE_URL=file:/tmp/fitness-lab.db` starts empty and ALL demo data is lost on restart, redeploy, or spin-down after ~15 min idle (cold start up to ~1 min). Persistent storage needs a paid instance with a disk (e.g. `file:/var/data/fitness-lab.db`).
- Tests: `tests/server/visitors.test.ts` (isolation, 401s, forged tokens, cookie flags, hashing, deletion, expiry/purge, visitor/write/AI limits, proxy-aware IPs, CSRF, production config). Server tests use `withCookieJar` (one browser per app instance) from `tests/server/helpers.ts`.

## Known limitations (documented in milestone reports)
- M11: sessions recorded before M11 keep their old stored completion ratio. Experiments created before M11 (real) have no assignments and will not collect observations; create a new one. Timed sets can still be confirmed instantly with "Done" (no minimum hold time). A CV exercise with no working camera cannot be completed with manual reps (zero valid reps = not counted). Morning-vs-evening cannot force WHEN the user trains; sessions started outside the assigned window are ignored. Only simulated morning-vs-evening can complete on demo data.
- CV thresholds are estimates validated on synthetic poses; push-up CV experimental (CV Lab only).
- No accounts: data is tied to one browser cookie (not recoverable, no cross-device). No per-day scheduling (planned workouts derive from weekly frequency).
- Simulated history reuses the latest real workout plan; experiment windows are day/UTC-week based.
- AI analysis: only digits are number-checked (number words are not); Groq model availability can change (override with `GROQ_MODEL`); the `analysis_reports` table exists but reports are not persisted.
- Adaptation: only workout time and duration have rules (no frequency/exercise/structure experiments exist yet); no undo button (change settings on the Profile page).
- `TRUST_PROXY=2` (render.yaml) is the EXPECTED hop count for browser → Vercel → Render proxy → app and is UNVERIFIED. Too low: all visitors share one IP for per-IP limits; too high or direct calls to the Render URL: callers can spoof their IP for per-IP limits (overall limits and the per-visitor AI cap still apply).
- Camera requires HTTPS on non-localhost hosts (Vercel and Render provide it). Render free plan: demo data is ephemeral (see above). CSP is report-only.
- Frontend bundle is a single ~586 kB chunk (Vite size warning; not split).
- Open reviewer notes (not fixed, out of M10 scope): experiments not refreshed server-side before analysis/generate; AI number check not tied to cited refs/direction; `ended_early` experiments treated as insufficient evidence; `analysis_reports.source` CHECK uses 'claude'.

## Remaining deployment tasks
1. Deploy the Render service from `render.yaml`; copy its URL from the Render dashboard.
2. Replace `REPLACE_WITH_YOUR_RENDER_SERVICE_HOST` in `vercel.json` (`rewrites[0].destination`) with that host, keeping `/api/:path*`.
3. Rotate the Groq key (it was pasted in chat) and set the NEW key as `GROQ_API_KEY` in the Render dashboard only.
4. Deploy the frontend on Vercel.
5. Verify proxy IP handling: set `DEBUG_PROXY_HEADERS=true`, open `https://<vercel-app>/api/health`, check that the `proxy check` log's `resolvedIp` is your own public IP (adjust `TRUST_PROXY` otherwise), then set it back to `false`.
6. Verify cookies through the Vercel rewrite: saving a profile sets `fl_visitor` (Secure), History loads afterwards, "Delete my data" clears it.
7. Check the browser console for report-only CSP violations (MediaPipe) before enforcing the CSP.

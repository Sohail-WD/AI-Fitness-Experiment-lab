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
- **All planned milestones done. Next: user real-camera CV check, then deploy (HTTPS host).**

## Stack
- Frontend: React + TypeScript + Vite (`src/`)
- Backend: Node (≥ 22.18, native TS) + Fastify + SQLite via `node:sqlite` (`server/`)
- Shared Zod contracts, exercise library, deterministic metrics/engines (`shared/`)
- Tests: Vitest, **324 passing** (`npm test`); `npm run typecheck`; `npm run build`
- Dev: `npm run dev:all` (API :3001, UI :5173)
- Prod: `npm run build` then `NODE_ENV=production DATABASE_URL=file:./data/fitness-lab.db HOST=0.0.0.0 npm start` (one process serves API + `dist/`; README "Production / deployment")

## Invariants
- CV, rep counting, form rules, metrics, adherence, experiments: deterministic code only.
- The LLM (Groq; provider replaceable) interprets structured, already-computed data; it must NOT calculate or invent metrics.
- No medical diagnosis or medical recommendations; restrictions are user-provided constraints.
- Simulated data is always flagged (`is_simulated`) and labelled SIMULATED in the UI.
- API key stays server-side (`GROQ_API_KEY`, optional `GROQ_MODEL`); the app must work without it (deterministic fallback).
- Preserve completed milestones; do not change squat CV thresholds.

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

## Known limitations (documented in milestone reports)
- CV thresholds are estimates validated on synthetic poses; push-up CV experimental (CV Lab only).
- Single user, no auth; no per-day scheduling (planned workouts derive from weekly frequency).
- Simulated history reuses the latest real workout plan; experiment windows are day/UTC-week based.
- AI analysis: only digits are number-checked (number words are not); Groq model availability can change (override with `GROQ_MODEL`); the `analysis_reports` table exists but reports are not persisted.
- Adaptation: only workout time and duration have rules (no frequency/exercise/structure experiments exist yet); no undo button (change settings on the Profile page).
- Rate limiter is in-memory and per process, keyed by `request.ip`; behind a reverse proxy all clients share the proxy IP unless Fastify `trustProxy` is configured (not enabled).
- Camera requires HTTPS on non-localhost hosts; the deploy platform must terminate TLS. SQLite needs a persistent disk.
- Frontend bundle is a single ~586 kB chunk (Vite size warning; not split).
- Open reviewer notes (not fixed, out of M10 scope): experiments not refreshed server-side before analysis/generate; AI number check not tied to cited refs/direction; `ended_early` experiments treated as insufficient evidence; `analysis_reports.source` CHECK uses 'claude'.

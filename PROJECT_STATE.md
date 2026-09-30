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
- **Current: M10 — hardening / deployment**

## Stack
- Frontend: React + TypeScript + Vite (`src/`)
- Backend: Node (≥ 22.18, native TS) + Fastify + SQLite via `node:sqlite` (`server/`)
- Shared Zod contracts, exercise library, deterministic metrics/engines (`shared/`)
- Tests: Vitest, **311 passing** (`npm test`); `npm run typecheck`; `npm run build`
- Dev: `npm run dev:all` (API :3001, UI :5173)

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

## Known limitations (documented in milestone reports)
- CV thresholds are estimates validated on synthetic poses; push-up CV experimental (CV Lab only).
- Single user, no auth; no per-day scheduling (planned workouts derive from weekly frequency).
- Simulated history reuses the latest real workout plan; experiment windows are day/UTC-week based.
- AI analysis: only digits are number-checked (number words are not); default Groq model `llama-3.3-70b-versatile` unverified against the live API (set `GROQ_MODEL`); the `analysis_reports` table exists but reports are not persisted.
- Adaptation: only workout time and duration have rules (no frequency/exercise/structure experiments exist yet); no undo button (change settings on the Profile page).

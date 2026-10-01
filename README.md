# AI Fitness Experiment Lab

Adaptive computer-vision fitness coach. See `spec.md` for the product
specification and milestones.

**Status:** M0 (browser CV prototype: side-view squat tracking and rep
counting) and M1 (project foundations) are complete. Profile, workouts,
experiments, AI analysis and adaptation are placeholders for M2–M9.

## Run

Requires Node.js 22.18+ (uses the built-in `node:sqlite` module and native
TypeScript execution).

```bash
npm install
cp .env.example .env   # optional; defaults work for development
npm run dev:all        # backend on :3001 + frontend on :5173
```

Open http://localhost:5173. The **CV Lab** tab is the M0 demo. It works even
if the backend is not running (the header then shows "Backend: offline").

| Command | Purpose |
|---|---|
| `npm run dev` | Frontend only (Vite, proxies `/api` to the backend) |
| `npm run dev:server` | Backend only, restarts on change |
| `npm run dev:all` | Both |
| `npm run start:server` | Backend without watch mode |
| `npm test` | All unit/integration tests (Vitest) |
| `npm run typecheck` | App + strict server type checks |
| `npm run build` | Type-check and build the frontend to `dist/` |

Camera access requires `http://localhost` or HTTPS. The pose model (~5 MB)
downloads from Google's MediaPipe model storage on first use; inference runs
locally in the browser. Video frames are never recorded or uploaded.

## Structure

```
shared/                 used by both browser and server
  schemas/              Zod contracts; TypeScript types are inferred from them
  exercises/            exercise library as data (squat is CV-enabled)
  metrics/              deterministic calculations (adherence, …)
server/                 Node + Fastify + node:sqlite
  app.ts                builds the API (testable via app.inject)
  config.ts             env validation; refuses to start on bad config
  errors.ts             one JSON error format for all routes
  db/                   connection, numbered migrations, library seeding
  routes/               /api/health, /api/exercises, 501 stubs for later milestones
  ai/                   AI provider interface (Claude integration in M8)
src/                    React + Vite frontend
  pages/                one page per product area; CvLabPage = M0
  cv/                   M0 pipeline; index.ts is its public interface
  lib/                  typed API client, hash router
tests/                  M0 tests at top level; shared/ and server/ subfolders
```

### Boundaries

- **Deterministic vs AI.** Rep counting, form rules, metrics, adherence and
  experiment calculations are plain code (`src/cv`, `shared/metrics`). The AI
  layer (`server/ai`) only interprets numbers it is given; AI observations must
  cite the stored data they use.
- **CV boundary.** Other code consumes a finished set as an `ExerciseSetResult`
  (`FrameProcessor.setResult()` / `usePoseSession().getSetResult()`), never the
  state machine directly.
- **Secrets.** `GROQ_API_KEY` is read by the server only (`server/ai`); it never reaches the browser bundle.
- **AI analysis (M8).** `server/ai/analysisService.ts` turns a deterministic experiment result into an insight through the
  provider-agnostic `LlmClient` interface (Groq implementation in `groqClient.ts`). The model receives only pre-computed
  facts; its reply is rejected (and a deterministic summary used instead) if it is malformed, cites unknown data, contains any
  number not in the supplied facts, or uses medical/diagnostic/causal/scientific-certainty wording. Set `GROQ_API_KEY` (and
  optionally `GROQ_MODEL`) in `.env` to enable it; without a key the app shows deterministic summaries.

### Production / deployment (M10)

```bash
npm ci && npm run build        # typecheck + frontend bundle into dist/ (incl. MediaPipe wasm)
NODE_ENV=production DATABASE_URL=file:./data/fitness-lab.db HOST=0.0.0.0 PORT=3001 npm start
```

In production one Node process serves both the API and the built frontend (SPA fallback to `index.html`; hashed assets
cached for a year; `.wasm` served as `application/wasm`). Camera access requires HTTPS on any host other than
`localhost`, so put the server behind a TLS-terminating proxy or platform. Environment: `NODE_ENV`, `DATABASE_URL`
(required in production; use a persistent disk), `HOST`, `PORT`, optional `GROQ_API_KEY` / `GROQ_MODEL`,
`AI_RATE_LIMIT_PER_MINUTE` (default 10 per IP), and `CORS_ORIGIN` only if the frontend is hosted elsewhere. API responses
carry `nosniff`, `no-referrer`, `X-Frame-Options: DENY` and a camera-only `Permissions-Policy`. The AI endpoint returns
`429` with `Retry-After` when rate-limited.

### Database

SQLite at `data/fitness-lab.db` (git-ignored), created and migrated on
startup. Tables: `user_profiles`, `user_constraints`, `exercises`, `workouts`,
`workout_sessions`, `session_events`, `experiments`, `experiment_results`,
`analysis_reports`, `adaptation_proposals`. Nested structures are JSON columns
(checked with `json_valid`, validated with Zod in the app). Sessions and
experiments carry an `is_simulated` flag so demo data is never mistaken for
real data.

## Squat threshold rationale (thigh angle = hip→knee vs horizontal)

Squat depth is judged by the thigh angle: ~90° standing, 0° = thigh parallel
to the floor, negative = below parallel. The knee angle was used at first but
also depends on how far the shins lean forward, so a ~40%-depth squat could
reach the old 100° knee threshold in real testing. The knee and hip angles
are still displayed for information. Values live in `shared/exercises/squat.ts`.

| Threshold | Value | Why |
|---|---|---|
| Standing (enter) | ≥ 70° | Standing thigh is near vertical (~80–90°); tolerates lean and perspective |
| Standing (exit) | < 60° | 10° hysteresis so jitter near the top doesn't start a descent |
| Bottom (enter) | ≤ 15° | Within 15° of parallel; a ~40%-depth squat (~37°) is not counted |
| Bottom (exit) | > 25° | 10° hysteresis at the bottom |
| Reversal | +10° | Rising 10° above the lowest angle before depth = partial rep |
| Min rep duration | 400 ms | Faster full "reps" are detection glitches |
| Min visibility | 0.6 | Stricter than MediaPipe's 0.5 default |
| Side-view spread ratio | ≤ 0.4 | Shoulder/hip left–right spread ÷ torso length; side-on ≈ 0–0.25 |
| Tracking-loss reset | 1 s | Longer gaps discard the rep in progress |

These are engineering estimates, partially checked against real squats. They
still need calibration across more people and camera positions.

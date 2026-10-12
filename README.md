# AI Fitness Experiment Lab

Adaptive fitness web app: personalized workouts, a guided follow-along runner
with on-device camera rep counting, workout history, personal A/B experiments,
AI-worded insights and approval-based plan adaptation. See `spec.md` for the
product specification and `PROJECT_STATE.md` for the current engineering state.

**Status:** milestones M0–M11 are implemented. The app is prepared as a **public
demo without login**: every browser gets its own anonymous demo session, and
visitors cannot see or change each other's data. See
[Privacy and access](#privacy-and-access) and [Deployment](#deployment).

## What it does

The app runs one loop, and every step except the wording of insights is
deterministic code:

```
Profile → Workout → Follow-Along (+ camera) → History → Experiments → Insights (AI) → Adaptation → Profile
```

| Area | What is implemented |
|---|---|
| **Profile** | Fitness level, activity, goal, equipment, home/gym, duration (15–60 min), days per week, preferred time of day, movement restrictions (used only to exclude exercises; the optional note is stored, never interpreted). |
| **Workout** | Rule-based generator over the exercise library: hard filters (equipment, level, restrictions, space), goal-based sets/reps/rest, time budget, warm-up and cool-down, and a "Why this workout?" explanation. A seed makes "Regenerate" reproducible. |
| **Follow-Along** | Set-by-set runner with timers, rest, pause/skip/stop, manual rep counting, voice cues (browser speech synthesis), and post-workout feedback (difficulty, energy, enjoyment). |
| **Camera (CV)** | MediaPipe Pose in the browser → smoothing → joint angles → rep state machine → form rules. Counted in Follow-Along: bodyweight squat, reverse lunges, bicep curls and overhead presses (front view, **both arms** required). Push-up tracking is experimental and only in the **CV Lab** tab. Setup checks (person visible, joints in frame, camera angle) gate counting. |
| **History** | Sessions (real / SIMULATED / all), workouts completed, adherence, average completion, valid-rep rate, form issues, weekly trend. "Generate simulated history" creates labelled demo data. |
| **Experiments** | Two templates: *morning vs evening* and *shorter (15 min) vs longer (45 min)*. Results are computed by code and phrased as personal observations, not scientific conclusions. |
| **Insights** | Optional Groq LLM words the computed result. Every number it uses is checked against the computed facts; unsafe or medical wording, unknown data references or invented numbers cause a fixed-template fallback. Works without an API key. |
| **Adaptation** | Fixed rules turn a finished experiment into a proposal (preferred time or workout length). "Accept and apply" updates the profile and generates the next workout in one atomic step; restrictions are never changed. |

## Core rules (M11)

### When a set and a workout count as completed

- A **rep-based set** counts only with **at least one valid rep** (camera-validated, or entered with "+1 Rep").
- A **timed set** counts when its interval is finished (the timer, or "Done").
- A set completed with **zero valid reps is recorded but not counted**.
- Completion = counted sets ÷ planned sets. A workout counts as **completed at ≥ 80%**.
- The **server recomputes** the completion ratio when a session ends from the recorded sets and the workout plan; the value sent by the browser is ignored. History, adherence and experiments all use this value.

### Experiment A/B assignment

- While a **real** experiment is active, every workout you generate on the Workout tab is **assigned to condition A or B**, alternately: the condition with fewer used sessions gets the next workout (ties go to A). The assignment is stored on the workout and shown in "Why this workout?".
- *Shorter vs longer* workouts are generated at exactly **15 or 45 minutes**.
- *Morning vs evening* workouts must be **started inside the assigned window** (05:00–11:59 or 17:00–22:59 local time); a session started at another time is ignored.
- An **observation** is a finished session of an assigned workout with at least one counted **main-exercise** set. Warm-up/cool-down only, click-through sessions, and workouts generated before the experiment started do not count. Regenerating a workout does not use up a slot.
- Each condition needs **3 observations** before a result is shown. Adherence = sessions meeting the 80% rule ÷ observations.
- An adaptation proposal is only created from a completed experiment, after re-checking that every condition really has enough observations and a clear difference (≥ 10 percentage points).
- **SIMULATED** experiments use the generated demo history, which follows a built-in morning/evening pattern. Only *morning vs evening* can complete on simulated data; *shorter vs longer* honestly reports "not enough data".
- **Experiments created before M11 must be recreated:** they have no assigned workouts, so they can never collect observations. End or skip them, create a new one, start it, then generate workouts.

### Restriction checks

- Restrictions exclude every exercise carrying the matching tag. "Avoid deep knee flexion" excludes squats **and lunges**.
- Starting a session re-checks the workout against your **current** restrictions. If you added a restriction after generating the workout, the start is refused (HTTP 409) with the conflicting exercises named; generate a new workout.

### Preferred time and adaptations

- Your preferred time is stored on every generated workout and shown in its plan. It is a planning label: it does **not** change which exercises are chosen.
- When a proposal is applied, the app reports only what really changed in the next workout (for example its new length), or says that the workout did not change.

## Run locally

Requires **Node.js 22.18+** (built-in `node:sqlite` and native TypeScript execution). No database server is needed.

```bash
npm install
cp .env.example .env   # optional; defaults work for development
npm run dev:all        # backend on :3001 + frontend on :5173
```

Open http://localhost:5173 in Chrome or Edge and allow camera access when asked.
The CV Lab works even if the backend is offline (the header then shows "Backend: offline").

| Command | Purpose |
|---|---|
| `npm run dev:all` | Backend (watch mode) + frontend |
| `npm run dev` | Frontend only (Vite, proxies `/api` to the backend) |
| `npm run dev:server` | Backend only, restarts on change |
| `npm test` | All unit and integration tests (Vitest) |
| `npm run typecheck` | App + strict server type checks |
| `npm run build` | Type-check, copy the MediaPipe wasm, build the frontend to `dist/` |
| `npm start` | Production start (backend; also serves `dist/` in production unless `SERVE_FRONTEND=false`) |
| `npm run start:server` | Same command as `npm start` |

## Environment variables

All are read by the backend only; nothing here reaches the browser bundle. See `.env.example`.

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `production` enables secure cookies and the production checks below. |
| `PORT` | `3001` | Backend port (Render sets it automatically). |
| `HOST` | `127.0.0.1` | Use `0.0.0.0` on a server/container. |
| `DATABASE_URL` | `file:./data/fitness-lab.db` | `file:<path>` or `:memory:`. **Production: required and must be an absolute path** (so the repository's `data/` folder is never used). |
| `TRUST_PROXY` | `none` | Which `X-Forwarded-For` entries to believe: `none`, a hop count `1`–`5`, or proxy IPs/CIDRs. **Required in production**; `true` is refused. |
| `DEBUG_PROXY_HEADERS` | `false` | Temporarily `true` to log the forwarded-IP chain for `/api/health` (see "Verify the client IP"). |
| `SERVE_FRONTEND` / `STATIC_DIR` | unset | Production serves `dist/` unless `SERVE_FRONTEND=false` (API-only backend). `true` serves it outside production. |
| `CORS_ORIGIN` | unset | Only if the browser calls the backend cross-origin. Not needed with the Vercel rewrite. |
| `GROQ_API_KEY` | unset | Optional. Without it, insights use deterministic summaries. Never commit it. |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Optional override if the model is retired. |
| `AI_RATE_LIMIT_PER_MINUTE` | `10` | AI analyses per client IP per minute. |
| `AI_DAILY_LIMIT_PER_VISITOR` | `20` | AI analyses per visitor per UTC day. |
| `AI_DAILY_LIMIT_TOTAL` | `500` | AI analyses for all visitors together per UTC day (protects the Groq quota). |
| `NEW_VISITORS_PER_IP_PER_HOUR` | `10` | New demo sessions per client IP per hour. |
| `NEW_VISITORS_PER_HOUR` | `200` | New demo sessions per hour overall. |
| `WRITE_RATE_LIMIT_PER_MINUTE` | `120` | State-changing API requests (POST/PUT/DELETE) per client IP per minute for visitors with a session. "Delete my data" is exempt. |
| `VISITOR_RETENTION_DAYS` | `30` | Inactive visitors are deleted with all their data after this many days. |
| `API_PORT` | `3001` | Read by the Vite dev server for its `/api` proxy. |

## Tests

```bash
npm test            # 390 tests in 30 files
npm run typecheck
npm run build
```

Tests cover the CV state machines (synthetic poses), generator and personalization, runner, metrics, experiments,
adaptation, AI validation and fallback, the API (Fastify `inject` against an in-memory SQLite database), migrations,
production serving, the M11 logic rules (`tests/server/logicIntegrity.test.ts`, `tests/shared/completion.test.ts`), and
the public-demo security model (`tests/server/visitors.test.ts`: visitor isolation, 401 without a session, forged
tokens, cookie flags, token hashing, "Delete my data", 30-day expiry, visitor, write and AI limits, proxy-aware IPs, CSRF and
production configuration). Server tests use a cookie jar that behaves like one browser per app instance.
Real-camera accuracy and the live Vercel/Render setup are **not** covered by automated tests.

## Deployment

The intended public demo runs the **frontend on Vercel** and the **API on Render**. The browser only talks to the
Vercel domain: `vercel.json` rewrites `/api/*` to the Render service, so API calls are same-origin (no CORS, and the
visitor cookie is a first-party cookie on the Vercel domain). Both platforms serve HTTPS, which browsers require for
the camera.

### Render (API) — `render.yaml`

1. Create a Blueprint from this repository (or a web service with the same settings): build `npm ci`, start
   `npm start`, health check `/api/health`, Node 24.
2. In the dashboard, set `GROQ_API_KEY` (optional; it is declared with `sync: false` and never stored in the repo).
3. The blueprint sets `NODE_ENV=production`, `HOST=0.0.0.0`, `SERVE_FRONTEND=false`, `TRUST_PROXY=2`, the demo limits,
   and `DATABASE_URL=file:/tmp/fitness-lab.db`.

**Free plan limitations (current choice):** Render's free web services have **no persistent disk**. The SQLite file in
`/tmp` starts empty on every start and is **lost whenever the service restarts, redeploys, or spins down after about
15 minutes without traffic**. The first request after a spin-down can take up to a minute. Demo data is therefore
temporary; visitors whose data was lost simply start again (their stale cookie is cleared). To keep data, move to a
paid instance with a persistent disk mounted at e.g. `/var/data` and set `DATABASE_URL=file:/var/data/fitness-lab.db`.

### Vercel (frontend) — `vercel.json`

1. **Deploy the Render service first** and copy its URL from the Render dashboard (top of the service page, of the
   form `https://<service-name>.onrender.com`; Render may add a suffix if the name is taken).
2. **Replace the placeholder** in `vercel.json` before deploying the frontend: in `rewrites[0].destination`, replace
   only `REPLACE_WITH_YOUR_RENDER_SERVICE_HOST` with that host (no `https://`, no trailing slash), keeping the rest:

   ```
   "destination": "https://REPLACE_WITH_YOUR_RENDER_SERVICE_HOST/api/:path*"
   →
   "destination": "https://<service-name>.onrender.com/api/:path*"
   ```

   Vercel cannot read environment variables in rewrites, so this value lives in the file. Until it is replaced, every
   `/api` request from the deployed frontend fails.
3. Import the repository in Vercel. `vercel.json` sets `npm ci`, `npm run build` and the `dist/` output.
4. No environment variables are needed on Vercel (no secrets reach the frontend).
5. Check on the Vercel domain that saving a profile sets the `fl_visitor` cookie (`Secure`), that History then
   loads, and that "Delete my data" clears it.
6. Security headers for the frontend: `nosniff`, `no-referrer`, `X-Frame-Options: DENY`, a camera-only
   `Permissions-Policy`, and a **report-only** Content-Security-Policy (check the browser console for violations with
   the MediaPipe loader before enforcing it).

### Verify the client IP (once, after the first deploy)

Per-IP limits need the real client IP. The expected chain is browser → Vercel → Render's proxy → app, hence
`TRUST_PROXY=2`; this has **not** been verified against the live platforms. Set `DEBUG_PROXY_HEADERS=true`, open
`https://<your-vercel-app>/api/health`, and check the Render log line `proxy check`: `resolvedIp` must be your own
public IP. If it is a Vercel or Render address, increase the hop count; then set `DEBUG_PROXY_HEADERS=false`.
Callers who bypass Vercel and call Render directly can put a fake IP in front of the chain; the **overall** limits
(`NEW_VISITORS_PER_HOUR`, `AI_DAILY_LIMIT_TOTAL`) and the per-visitor AI limit still apply to them.

### Single-server alternative

One Node process can also serve the API and the built frontend (`SERVE_FRONTEND` unset):

```bash
npm ci && npm run build
NODE_ENV=production DATABASE_URL=file:/var/data/fitness-lab.db TRUST_PROXY=none HOST=0.0.0.0 PORT=3001 npm start
```

It serves `dist/` with an SPA fallback, caches hashed assets for a year and serves `.wasm` as `application/wasm`.
API responses carry `nosniff`, `no-referrer`, `X-Frame-Options: DENY` and a camera-only `Permissions-Policy`.

### Database and migrations

SQLite, created and migrated automatically on startup (`server/db/migrations.ts`, recorded in `schema_migrations`).
There is no separate setup step. Tables: `user_profiles`, `user_constraints`, `exercises`, `workouts`,
`workout_sessions`, `session_events`, `experiments`, `experiment_results`, `analysis_reports`,
`adaptation_proposals`, `visitors`, `ai_usage`. Nested data are JSON columns (checked with `json_valid`, validated with
Zod). Sessions and experiments carry an `is_simulated` flag.

- **Migration 4 (M11)** adds `experiment_id`, `condition_id` and `condition_label` to `workouts` for experiment
  assignment. Existing rows are kept; older workouts simply have no assignment. Sessions recorded before M11 keep the
  completion ratio stored at the time.
- **Migration 5 (public demo)** adds `visitors` (id, SHA-256 token hash, created/last-seen times) and `ai_usage`
  (AI analyses per visitor per day). A visitor's id is their `user_profiles.id`; deleting it cascades to all their
  rows. **Local databases created before migration 5** keep their old profile, but it belongs to no visitor, so the app
  starts with an empty profile; the old rows stay in the file untouched.
- Production refuses a relative `DATABASE_URL`, so the repository's git-ignored `data/` folder (your local database)
  is never used or deployed.

## Privacy and access

- **Anonymous demo sessions, no login.** The first profile save creates a visitor and sets a random 256-bit token in a
  cookie (`HttpOnly`, `SameSite=Lax`, `Path=/api`, `Secure` in production, 30 days, refreshed with activity). Only a
  SHA-256 hash of the token is stored.
- **Isolation.** Every private API route requires a valid visitor cookie (401 otherwise) and every database lookup is
  scoped to that visitor; another visitor's ids behave like missing ones (404). This is enforced by the backend itself,
  so calling the Render URL directly does not bypass it. Public routes: `/api/health`, `/api/exercises`, reading
  `/api/profile` (404 without a session) and saving it (which starts a session). State-changing cross-site requests
  are rejected (403). CORS and rate limits are additional protections, **not** authentication.
- **Delete my data.** The Profile page has a "Delete my data" button (`DELETE /api/visitor`): it removes the visitor
  and all their rows and clears the cookie. Visitors inactive for 30 days are deleted automatically (checked at
  startup, daily, and on use).
- **Limits.** New sessions: 10 per IP per hour and 200 per hour overall. Changes (POST/PUT/DELETE) by visitors with a
  session: 120 per IP per minute ("Delete my data" is exempt). AI insights: 10 per IP per minute, 20 per visitor per
  day and 500 per day overall.
- **Camera:** video is processed in the browser only. Frames are never recorded, stored or uploaded; only numbers
  (reps, angle summary, form-issue codes, timings) are saved.
- **What leaves the server:** only the pre-computed experiment facts, sent to Groq when `GROQ_API_KEY` is set and a
  visitor presses "Generate insight". The API key never reaches the browser.
- **SIMULATED data** (generated demo history and experiments based on it) is labelled SIMULATED everywhere, kept
  separate from real sessions in History, and belongs to the visitor who generated it.
- **Restrictions** are constraints you enter, not diagnoses. The app gives no medical advice.
- Data is tied to one browser: clearing cookies or switching device starts a new, empty demo session, and lost
  sessions cannot be recovered.

## Known limitations

- No accounts: data is tied to one browser cookie and cannot be recovered or moved to another device.
- **Render free plan: no persistent storage.** All demo data is lost on restart, redeploy or spin-down (see
  Deployment). Persistent storage needs a paid instance with a disk.
- `TRUST_PROXY=2` is the expected value for Vercel → Render but must be verified after deploying; requests sent
  directly to the Render URL can spoof their IP for per-IP limits (overall limits still apply).
- Rate limiters for new sessions, writes and per-minute AI calls are in memory and reset on restart; daily AI counts are in
  the database (and reset with it on the free plan).
- The Content-Security-Policy is report-only until checked against MediaPipe in real browsers.
- CV thresholds are engineering estimates, partly checked against real movement; they need calibration across more
  people and camera positions. Push-up tracking is experimental (CV Lab only).
- A camera exercise cannot be completed with manual reps when the camera is unavailable, so those sets are not counted.
- Timed sets can be confirmed instantly with "Done" (no minimum hold time).
- *Morning vs evening* cannot make you train at a given time; off-window sessions are ignored. There is no calendar or
  reminders.
- Only workout time and length have adaptation rules.
- History weeks are UTC weeks, and past adherence uses the current days-per-week setting.
- Groq model availability can change (override with `GROQ_MODEL`). AI reports are generated on demand and not stored.

## Structure

```
shared/                 used by browser and server
  schemas/              Zod contracts; TypeScript types are inferred from them
  exercises/            exercise library and CV configs as data
  workout/              personalization + workout generator
  metrics/              deterministic metrics (adherence, completion, history)
  experiments/          experiment templates, assignment and evaluation
  adaptation/           adaptation rules, effects and proposal lifecycle
server/                 Node + Fastify + node:sqlite
  app.ts                builds the API (testable via app.inject)
  config.ts             env validation; refuses to start on bad config
  http.ts, static.ts    CORS, security headers, rate limiter; production static serving
  visitors.ts           anonymous visitor sessions: cookie, token hashing, central auth guard, retention, AI quota
  db/                   connection, numbered migrations, library seeding
  routes/               health, exercises, profile, workouts, sessions, history, experiments, ai, adaptations
  services/             adaptation, simulated history, experiment sessions/assignment
  repositories/         SQL access per table
  ai/                   provider-agnostic LLM client (Groq), facts, validation, fallback
src/                    React + Vite frontend
  pages/                one page per product area
  cv/                   pose pipeline; index.ts is its public interface
  workout/              follow-along runner, camera set tracker, coaching, voice
  profile/, history/, components/, hooks/, lib/
tests/                  CV tests at top level; shared/ and server/ subfolders
```

### Boundaries

- **Deterministic vs AI.** Rep counting, form rules, metrics, completion, experiments and adaptation rules are plain
  code. The AI layer (`server/ai`) only words numbers it is given and must cite them.
- **CV boundary.** Other code consumes a finished set as an `ExerciseSetResult`, never the state machine directly.
- **Secrets.** `GROQ_API_KEY` is read by the server only; it never reaches the browser bundle.
- **Ownership.** Routes get the user id only from `requireVisitor(request)`; repositories take that id and scope every query by it.

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

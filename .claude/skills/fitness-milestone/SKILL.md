---
name: fitness-milestone
description: Workflow rules for implementing an AI Fitness Experiment Lab milestone (M8–M10) with minimal context use.
disable-model-invocation: true
---

# Fitness milestone workflow

1. Read `PROJECT_STATE.md` first. Read `spec.md` / `CLAUDE.md` only for the sections relevant to the milestone.
2. Inspect only the files the milestone touches (use the extension points listed in `PROJECT_STATE.md`). No broad exploration.
3. Preserve completed milestones: do not change existing behavior, CV thresholds, or contracts unless required; extend contracts additively.
4. Prefer deterministic logic. Use Claude only to interpret already-computed data; never let it calculate or invent metrics.
5. Never invent fitness or medical conclusions. No diagnosis or medical advice; results are personal observations.
6. Keep simulated data flagged and labelled SIMULATED.
7. No unnecessary dependencies or refactors. Match existing code style.
8. Implement → `npm test` → `npm run build` → brief summary → STOP. Do not start the next milestone.
9. Final report: concise (files changed, tests, build, manual verification, limitations, next recommendation).
10. After completing the milestone, update `PROJECT_STATE.md` (status, current milestone, test count, new extension points/limitations).

import type { ExerciseSetResult, PerformanceMetrics } from '../../shared/schemas/metrics';
import type { SessionEventInput, WorkoutItem } from '../../shared/schemas/workout';

/**
 * Follow-along runner as a pure reducer: exercise → set → rest → next, with
 * pause/resume/skip/stop. Every transition appends a session event to `log`,
 * which the UI sends to the server.
 */

export interface RunnerItem extends WorkoutItem {
  name: string;
  perSide: boolean;
  /** Tracked by the camera (squat) instead of manual reps. */
  hasCv: boolean;
}

export type RunnerPhase = 'ready' | 'work' | 'rest' | 'done';

export interface SetRecord {
  itemIndex: number;
  setIndex: number;
  result: ExerciseSetResult;
}

export interface RunnerState {
  items: RunnerItem[];
  itemIndex: number;
  setIndex: number;
  phase: RunnerPhase;
  paused: boolean;
  /** Countdown for timed work or rest; null for rep-based work. */
  remainingMs: number | null;
  manualReps: number;
  /** Increments each time a set starts (lets the CV tracker reset per set). */
  setAttempt: number;
  activeMs: number;
  sets: SetRecord[];
  outcome: 'completed' | 'stopped' | null;
  log: SessionEventInput[];
}

export type RunnerAction =
  | { type: 'start'; at: string }
  | { type: 'tick'; at: string; deltaMs: number }
  | { type: 'add_rep'; delta: 1 | -1 }
  | { type: 'complete_set'; at: string; result?: ExerciseSetResult }
  | { type: 'skip'; at: string }
  | { type: 'pause'; at: string }
  | { type: 'resume'; at: string }
  | { type: 'stop'; at: string };

export function initialRunnerState(items: RunnerItem[]): RunnerState {
  return {
    items: [...items].sort((a, b) => a.order - b.order),
    itemIndex: 0,
    setIndex: 0,
    phase: 'ready',
    paused: false,
    remainingMs: null,
    manualReps: 0,
    setAttempt: 0,
    activeMs: 0,
    sets: [],
    outcome: null,
    log: [],
  };
}

export const totalSets = (s: RunnerState) => s.items.reduce((n, i) => n + i.sets, 0);
export const currentItem = (s: RunnerState): RunnerItem | undefined => s.items[s.itemIndex];

function event(
  s: RunnerState,
  type: SessionEventInput['type'],
  at: string,
  data: SessionEventInput['data'] = {},
  withSet = true,
): SessionEventInput {
  const item = currentItem(s);
  return { type, occurredAt: at, exerciseId: item?.exerciseId ?? null, setIndex: withSet && item ? s.setIndex : null, data };
}

const log = (s: RunnerState, e: SessionEventInput): RunnerState => ({ ...s, log: [...s.log, e] });

function timedWorkMs(item: RunnerItem): number | null {
  return item.target.type === 'duration' ? item.target.seconds * 1000 * (item.perSide ? 2 : 1) : null;
}

/** Begin the set at (itemIndex, setIndex), or finish if past the last exercise. */
function beginSet(s: RunnerState, at: string): RunnerState {
  const item = currentItem(s);
  if (!item) return finish(s, at, 'completed');
  let next: RunnerState = { ...s, phase: 'work', remainingMs: timedWorkMs(item), manualReps: 0, setAttempt: s.setAttempt + 1 };
  if (s.setIndex === 0) next = log(next, event(next, 'exercise_started', at, {}, false));
  return next;
}

function finish(s: RunnerState, at: string, outcome: 'completed' | 'stopped'): RunnerState {
  const done: RunnerState = { ...s, phase: 'done', paused: false, remainingMs: null, outcome };
  return log(done, {
    type: outcome === 'completed' ? 'workout_completed' : 'workout_stopped',
    occurredAt: at,
    exerciseId: null,
    setIndex: null,
    data: { completedSets: s.sets.length, plannedSets: totalSets(s) },
  });
}

function manualResult(item: RunnerItem, reps: number): ExerciseSetResult {
  return {
    exerciseId: item.exerciseId,
    detectedReps: reps,
    validReps: reps,
    invalidReps: 0,
    metrics: { lowestPrimaryAngleDeg: null, averageRepDurationMs: null, usableFrameRatio: null },
    formIssues: [],
    measurementSource: 'manual',
  };
}

function completeSet(s: RunnerState, at: string, cvResult?: ExerciseSetResult): RunnerState {
  const item = currentItem(s)!;
  const result = cvResult ?? manualResult(item, item.target.type === 'reps' ? s.manualReps : 0);
  let next = log(
    { ...s, sets: [...s.sets, { itemIndex: s.itemIndex, setIndex: s.setIndex, result }] },
    event(s, 'set_completed', at, {
      reps: result.detectedReps,
      validReps: result.validReps,
      invalidReps: result.invalidReps,
      source: result.measurementSource,
      target: item.target.type === 'reps' ? `${item.target.reps} reps` : `${item.target.seconds} s`,
    }),
  );

  const lastSet = s.setIndex + 1 >= item.sets;
  if (lastSet) {
    next = log(next, event(next, 'exercise_completed', at, { sets: item.sets }, false));
    next = { ...next, itemIndex: s.itemIndex + 1, setIndex: 0 };
    if (next.itemIndex >= s.items.length) return finish(next, at, 'completed');
  } else {
    next = { ...next, setIndex: s.setIndex + 1 };
  }
  // Rest before the next set (or next exercise), then start it.
  return item.restSeconds > 0
    ? { ...next, phase: 'rest', remainingMs: item.restSeconds * 1000, manualReps: 0 }
    : beginSet(next, at);
}

export function runnerReducer(s: RunnerState, a: RunnerAction): RunnerState {
  const active = s.phase === 'work' || s.phase === 'rest';
  switch (a.type) {
    case 'start':
      if (s.phase !== 'ready') return s;
      return beginSet(log(s, { type: 'workout_started', occurredAt: a.at, exerciseId: null, setIndex: null, data: {} }), a.at);

    case 'tick': {
      if (!active || s.paused) return s;
      const next = { ...s, activeMs: s.activeMs + a.deltaMs };
      if (next.remainingMs === null) return next;
      const remainingMs = next.remainingMs - a.deltaMs;
      if (remainingMs > 0) return { ...next, remainingMs };
      return s.phase === 'rest' ? beginSet({ ...next, remainingMs: 0 }, a.at) : completeSet({ ...next, remainingMs: 0 }, a.at);
    }

    case 'add_rep':
      if (s.phase !== 'work' || s.paused) return s;
      return { ...s, manualReps: Math.max(0, s.manualReps + a.delta) };

    case 'complete_set':
      if (s.phase !== 'work' || s.paused) return s;
      return completeSet(s, a.at, a.result);

    case 'skip': {
      if (!active || s.paused) return s;
      if (s.phase === 'rest') return beginSet({ ...s, remainingMs: null }, a.at);
      const item = currentItem(s)!;
      const skipped = log(s, event(s, 'exercise_skipped', a.at, { skippedSets: item.sets - s.setIndex }));
      return beginSet({ ...skipped, itemIndex: s.itemIndex + 1, setIndex: 0 }, a.at);
    }

    case 'pause':
      if (!active || s.paused) return s;
      return log({ ...s, paused: true }, event(s, 'workout_paused', a.at));

    case 'resume':
      if (!active || !s.paused) return s;
      return log({ ...s, paused: false }, event(s, 'workout_resumed', a.at));

    case 'stop':
      if (s.phase === 'done') return s;
      return finish(s, a.at, 'stopped');
  }
}

/** Deterministic session metrics from what was actually completed. */
export function buildPerformanceMetrics(s: RunnerState, sessionId: string): PerformanceMetrics {
  const planned = totalSets(s);
  return {
    sessionId,
    sets: s.sets.map((r) => r.result),
    completionRatio: planned > 0 ? s.sets.length / planned : 0,
    activeDurationSeconds: Math.round(s.activeMs / 1000),
  };
}

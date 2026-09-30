import { describe, expect, it } from 'vitest';
import { performanceMetricsSchema } from '../shared/schemas/metrics';
import { postWorkoutFeedbackSchema, sessionEventInputSchema } from '../shared/schemas/workout';
import { toPostWorkoutFeedback } from '../src/workout/feedback';
import {
  buildPerformanceMetrics,
  initialRunnerState,
  type RunnerAction,
  type RunnerItem,
  runnerReducer,
  type RunnerState,
} from '../src/workout/runner';

const AT = '2026-09-29T10:00:00.000Z';
const SESSION = '9b2e4d17-5a3c-4f8e-b1d2-7e6f5a4b3c21';

const items: RunnerItem[] = [
  { exerciseId: 'march_in_place', section: 'warmup', order: 0, sets: 1, target: { type: 'duration', seconds: 30 }, restSeconds: 0, name: 'March', perSide: false, hasCv: false },
  { exerciseId: 'squat', section: 'main', order: 1, sets: 2, target: { type: 'reps', reps: 5 }, restSeconds: 60, name: 'Squat', perSide: false, hasCv: true },
  { exerciseId: 'push_up', section: 'main', order: 2, sets: 2, target: { type: 'reps', reps: 8 }, restSeconds: 45, name: 'Push-up', perSide: false, hasCv: false },
];

const run = (actions: RunnerAction[], state: RunnerState = initialRunnerState(items)) => actions.reduce(runnerReducer, state);
const tick = (deltaMs: number): RunnerAction => ({ type: 'tick', at: AT, deltaMs });
const start: RunnerAction = { type: 'start', at: AT };
const complete: RunnerAction = { type: 'complete_set', at: AT };
const types = (s: RunnerState) => s.log.map((e) => e.type);

/** State at the start of squat set 1 (after the 30 s timed warm-up, which has no rest). */
const atSquat = () => run([start, tick(30_000)]);

describe('runner transitions', () => {
  it('starts in ready and begins the first set on start', () => {
    expect(initialRunnerState(items).phase).toBe('ready');
    const s = run([start]);
    expect(s).toMatchObject({ phase: 'work', itemIndex: 0, setIndex: 0, remainingMs: 30_000 });
    expect(types(s)).toEqual(['workout_started', 'exercise_started']);
  });

  it('auto-completes a timed set when its timer runs out', () => {
    const s = atSquat();
    expect(s).toMatchObject({ phase: 'work', itemIndex: 1, setIndex: 0, remainingMs: null });
    expect(s.sets).toHaveLength(1);
  });

  it('rests between sets, then starts the next set', () => {
    let s = run([complete], atSquat());
    expect(s).toMatchObject({ phase: 'rest', itemIndex: 1, setIndex: 1, remainingMs: 60_000 });
    s = run([tick(59_000)], s);
    expect(s.phase).toBe('rest');
    s = run([tick(1_000)], s);
    expect(s).toMatchObject({ phase: 'work', setIndex: 1 });
  });

  it('moves to the next exercise after the last set', () => {
    const s = run([complete, tick(60_000), complete, tick(60_000)], atSquat());
    expect(s).toMatchObject({ phase: 'work', itemIndex: 2, setIndex: 0 });
    expect(types(s)).toContain('exercise_completed');
  });

  it('completes the workout after the final set', () => {
    const s = run([complete, tick(60_000), complete, tick(60_000), complete, tick(45_000), complete], atSquat());
    expect(s).toMatchObject({ phase: 'done', outcome: 'completed' });
    expect(types(s).at(-1)).toBe('workout_completed');
    expect(s.sets).toHaveLength(5);
  });
});

describe('manual reps', () => {
  it('counts +1/−1 (never below 0) and records them on completion', () => {
    let s = run([complete, tick(60_000), complete, tick(60_000)], atSquat()); // at push-up
    s = run([{ type: 'add_rep', delta: -1 }, ...Array(7).fill({ type: 'add_rep', delta: 1 })], s);
    expect(s.manualReps).toBe(7);
    s = run([complete], s);
    expect(s.sets.at(-1)!.result).toMatchObject({ exerciseId: 'push_up', detectedReps: 7, validReps: 7, measurementSource: 'manual' });
    expect(s.manualReps).toBe(0);
  });

  it('uses the CV result when one is provided', () => {
    const cv = {
      exerciseId: 'squat',
      detectedReps: 6,
      validReps: 5,
      invalidReps: 1,
      metrics: { lowestPrimaryAngleDeg: 4, averageRepDurationMs: 2100, usableFrameRatio: 0.95 },
      formIssues: [{ code: 'insufficient_depth', count: 1 }],
      measurementSource: 'cv' as const,
    };
    const s = run([{ type: 'complete_set', at: AT, result: cv }], atSquat());
    expect(s.sets.at(-1)!.result).toBe(cv);
    expect(s.log.at(-1)).toMatchObject({ type: 'set_completed', exerciseId: 'squat', setIndex: 0, data: { reps: 6, validReps: 5, invalidReps: 1, source: 'cv' } });
  });
});

describe('pause / resume', () => {
  it('freezes timers and blocks actions while paused', () => {
    let s = run([start, { type: 'pause', at: AT }, tick(10_000), { type: 'add_rep', delta: 1 }, complete]);
    expect(s).toMatchObject({ paused: true, remainingMs: 30_000, activeMs: 0, manualReps: 0 });
    expect(s.sets).toHaveLength(0);
    s = run([{ type: 'resume', at: AT }, tick(10_000)], s);
    expect(s).toMatchObject({ paused: false, remainingMs: 20_000, activeMs: 10_000 });
    expect(types(s)).toEqual(['workout_started', 'exercise_started', 'workout_paused', 'workout_resumed']);
  });

  it('ignores pause before start and double pause', () => {
    expect(run([{ type: 'pause', at: AT }]).paused).toBe(false);
    expect(types(run([start, { type: 'pause', at: AT }, { type: 'pause', at: AT }])).filter((t) => t === 'workout_paused')).toHaveLength(1);
  });
});

describe('skip', () => {
  it('skips the remaining sets of the current exercise', () => {
    const s = run([{ type: 'skip', at: AT }], atSquat());
    expect(s).toMatchObject({ phase: 'work', itemIndex: 2, setIndex: 0 });
    expect(s.log.find((e) => e.type === 'exercise_skipped')).toMatchObject({ exerciseId: 'squat', setIndex: 0, data: { skippedSets: 2 } });
  });

  it('skips rest without skipping the next set', () => {
    const s = run([complete, { type: 'skip', at: AT }], atSquat());
    expect(s).toMatchObject({ phase: 'work', itemIndex: 1, setIndex: 1 });
  });

  it('finishes when the last exercise is skipped', () => {
    const s = run([{ type: 'skip', at: AT }, { type: 'skip', at: AT }], atSquat());
    expect(s).toMatchObject({ phase: 'done', outcome: 'completed' });
  });
});

describe('stop and session recording', () => {
  it('stop ends the workout as stopped', () => {
    const s = run([{ type: 'stop', at: AT }], atSquat());
    expect(s).toMatchObject({ phase: 'done', outcome: 'stopped' });
    expect(s.log.at(-1)).toMatchObject({ type: 'workout_stopped', data: { completedSets: 1, plannedSets: 5 } });
  });

  it('every logged event matches the session event contract', () => {
    const s = run([{ type: 'pause', at: AT }, { type: 'resume', at: AT }, complete, { type: 'skip', at: AT }, { type: 'skip', at: AT }], atSquat());
    for (const e of s.log) expect(sessionEventInputSchema.safeParse(e).success, JSON.stringify(e)).toBe(true);
  });

  it('builds contract-valid performance metrics from completed sets', () => {
    const s = run([complete, { type: 'stop', at: AT }], atSquat());
    const m = buildPerformanceMetrics(s, SESSION);
    expect(performanceMetricsSchema.safeParse(m).success).toBe(true);
    expect(m.completionRatio).toBeCloseTo(2 / 5);
    expect(m.activeDurationSeconds).toBe(30);
  });
});

describe('post-workout feedback mapping', () => {
  it('maps the three-level answers onto the stored 1–10 scales', () => {
    const f = toPostWorkoutFeedback({ difficulty: 'hard', energy: 'low', enjoyment: 'high', note: '  tired  ' });
    expect(f).toEqual({ effort: 9, enjoyment: 9, energy: 'low', note: 'tired' });
    expect(postWorkoutFeedbackSchema.safeParse(f).success).toBe(true);
    expect(toPostWorkoutFeedback({ difficulty: 'easy', energy: 'okay', enjoyment: 'low', note: '' })).toEqual({ effort: 3, enjoyment: 3, energy: 'okay' });
  });
});

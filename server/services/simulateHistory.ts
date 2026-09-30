import { randomUUID } from 'node:crypto';
import type { ExerciseDefinition } from '../../shared/schemas/exercise.ts';
import type { ExerciseSetResult } from '../../shared/schemas/metrics.ts';
import { type Workout, type WorkoutSession, workoutSessionSchema } from '../../shared/schemas/workout.ts';

/**
 * Simulated workout history for demonstrations (spec §13.4). Every record has
 * isSimulated = true and a "SIMULATED" feedback note; it is never presented as
 * real data. Deterministic for a given seed and `now`.
 *
 * Built-in pattern (so the M7 experiment demo has something to find):
 * - planned sessions alternate morning (07:00) and evening (19:00), local time;
 * - morning sessions are attended and completed more often than evening ones;
 * - the share of invalid (form-issue) reps falls slowly week over week.
 */

export const SIMULATED_NOTE = 'SIMULATED demo data';

export interface SimulationOptions {
  workout: Workout;
  library: readonly ExerciseDefinition[];
  workoutsPerWeek: number;
  weeks: number;
  seed?: number;
  now: Date;
  newId?: () => string;
  /** User's UTC offset (JS getTimezoneOffset, minutes) so sessions fall at 07:00/19:00 local time. Default 0 (UTC). */
  timezoneOffsetMinutes?: number;
}

const PROFILE = {
  morning: { attendance: 0.9, minCompletion: 0.85 },
  evening: { attendance: 0.6, minCompletion: 0.55 },
};

function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function simulateSessions(opts: SimulationOptions): WorkoutSession[] {
  const { workout, library, workoutsPerWeek, weeks, now } = opts;
  const rng = createRng(opts.seed ?? 42);
  const newId = opts.newId ?? randomUUID;
  const totalSets = workout.items.reduce((n, i) => n + i.sets, 0);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)];

  // Start on the Monday `weeks` weeks before the current week; only past slots are generated.
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const mondayThisWeek = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * 86_400_000);
  const sessions: WorkoutSession[] = [];

  for (let w = 0; w < weeks; w++) {
    const weekStart = mondayThisWeek.getTime() - (weeks - w) * 7 * 86_400_000;
    const invalidShare = Math.max(0.05, 0.3 - 0.04 * w); // form improves over time

    for (let k = 0; k < workoutsPerWeek; k++) {
      const slot = k % 2 === 0 ? 'morning' : 'evening';
      const p = PROFILE[slot];
      const dayOffset = Math.floor((k * 7) / workoutsPerWeek);
      const localHour = slot === 'morning' ? 7 : 19;
      const start = new Date(
        weekStart + dayOffset * 86_400_000 + localHour * 3_600_000 + (opts.timezoneOffsetMinutes ?? 0) * 60_000,
      );
      if (start.getTime() >= now.getTime()) continue;
      if (rng() > p.attendance) continue; // missed workout

      const completion = p.minCompletion + rng() * (1 - p.minCompletion);
      const setsDone = Math.max(1, Math.round(totalSets * completion));
      const sets: ExerciseSetResult[] = [];
      let remaining = setsDone;
      for (const item of workout.items) {
        const exercise = library.find((e) => e.id === item.exerciseId);
        for (let s = 0; s < item.sets && remaining > 0; s++, remaining--) {
          const target = item.target.type === 'reps' ? item.target.reps * (exercise?.perSide && exercise.cv ? 2 : 1) : 0;
          const detected = Math.max(0, target - Math.floor(rng() * 3));
          const invalid = exercise?.cv ? Math.round(detected * invalidShare * rng() * 2) : 0;
          const valid = Math.max(0, detected - invalid);
          sets.push({
            exerciseId: item.exerciseId,
            detectedReps: valid + Math.min(invalid, detected),
            validReps: valid,
            invalidReps: Math.min(invalid, detected),
            metrics: { lowestPrimaryAngleDeg: null, averageRepDurationMs: null, usableFrameRatio: null },
            formIssues: exercise?.cv && invalid > 0 ? [{ code: exercise.cv.issueCodes.partial, count: Math.min(invalid, detected) }] : [],
            measurementSource: exercise?.cv ? 'cv' : 'manual',
          });
        }
      }

      const ratio = sets.length / totalSets;
      const activeSeconds = Math.round(workout.estimatedMinutes * 60 * ratio * (0.8 + rng() * 0.2));
      const id = newId();
      sessions.push(
        workoutSessionSchema.parse({
          id,
          workoutId: workout.id,
          userId: workout.userId,
          status: ratio >= 1 ? 'completed' : 'abandoned',
          startedAt: start.toISOString(),
          endedAt: new Date(start.getTime() + activeSeconds * 1000 * 1.2).toISOString(),
          isSimulated: true,
          feedback: {
            effort: pick([3, 6, 6, 9]),
            enjoyment: slot === 'morning' ? pick([6, 9, 9]) : pick([3, 6, 6]),
            energy: slot === 'morning' ? pick(['okay', 'high'] as const) : pick(['low', 'okay'] as const),
            note: SIMULATED_NOTE,
          },
          metrics: { sessionId: id, sets, completionRatio: ratio, activeDurationSeconds: activeSeconds },
        }),
      );
    }
  }
  return sessions;
}

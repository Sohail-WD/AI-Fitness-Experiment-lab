import type { ExerciseSetResult } from '../../shared/schemas/metrics';
import type { Diagnostics } from './diagnostics';
import type { CvRepEvent } from './formCheck';

/**
 * Boundary between the CV pipeline and the rest of the application: a set's
 * rep events are reduced to the shared ExerciseSetResult contract, so
 * workout/session code never depends on CV internals.
 */

export interface SetAccumulator {
  validReps: number;
  /** Partial, too-fast, and form-invalidated reps. */
  invalidReps: number;
  totalValidRepDurationMs: number;
  /** Furthest primary angle over counted and partial reps, in the counter's (decreasing) space. */
  furthestCounterDeg: number | null;
  issueCounts: Record<string, number>;
}

export function initialSetAccumulator(): SetAccumulator {
  return { validReps: 0, invalidReps: 0, totalValidRepDurationMs: 0, furthestCounterDeg: null, issueCounts: {} };
}

/** `sign` is the exercise direction sign (1 decreasing, −1 increasing). */
export function accumulateRepEvent(acc: SetAccumulator, event: CvRepEvent, sign: 1 | -1): SetAccumulator {
  if (event.type === 'tracking_reset') return acc;
  const issueCounts = { ...acc.issueCounts };
  for (const code of event.formIssues) issueCounts[code] = (issueCounts[code] ?? 0) + 1;

  let furthestCounterDeg = acc.furthestCounterDeg;
  if (event.type === 'rep' || event.type === 'partial') {
    const counterDeg = sign * event.minAngleDeg;
    furthestCounterDeg = furthestCounterDeg === null ? counterDeg : Math.min(furthestCounterDeg, counterDeg);
  }

  if (event.type === 'rep' && event.valid) {
    return {
      ...acc,
      validReps: acc.validReps + 1,
      totalValidRepDurationMs: acc.totalValidRepDurationMs + event.durationMs,
      furthestCounterDeg,
      issueCounts,
    };
  }
  return { ...acc, invalidReps: acc.invalidReps + 1, furthestCounterDeg, issueCounts };
}

/**
 * `issueOrder` lists issue codes in reporting order (partial, too fast, then
 * the exercise's form rules); only issues that occurred are reported.
 */
export function toExerciseSetResult(
  exerciseId: string,
  acc: SetAccumulator,
  diagnostics: Diagnostics,
  sign: 1 | -1,
  issueOrder: string[],
): ExerciseSetResult {
  const framesWithPerson = diagnostics.frames - diagnostics.framesByStatus.no_person;
  const codes = [...new Set([...issueOrder, ...Object.keys(acc.issueCounts)])];
  return {
    exerciseId,
    detectedReps: acc.validReps + acc.invalidReps,
    validReps: acc.validReps,
    invalidReps: acc.invalidReps,
    metrics: {
      lowestPrimaryAngleDeg: acc.furthestCounterDeg === null ? null : sign * acc.furthestCounterDeg,
      averageRepDurationMs: acc.validReps > 0 ? acc.totalValidRepDurationMs / acc.validReps : null,
      usableFrameRatio: framesWithPerson > 0 ? diagnostics.framesByStatus.ok / framesWithPerson : null,
    },
    formIssues: codes.filter((code) => (acc.issueCounts[code] ?? 0) > 0).map((code) => ({ code, count: acc.issueCounts[code] })),
    measurementSource: 'cv',
  };
}

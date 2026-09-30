import { z } from 'zod';
import { idSchema, issueCodeSchema } from './common.ts';

/**
 * spec §10. All values here are computed by deterministic code (CV pipeline
 * or metrics functions). The AI layer may read them but never produce them.
 */

export const formIssueCountSchema = z.object({
  code: issueCodeSchema,
  count: z.int().nonnegative(),
});

/**
 * Result of one set of one exercise. This is the boundary between the CV
 * system and the rest of the application: consumers see only this shape.
 */
export const exerciseSetResultSchema = z
  .object({
    exerciseId: z.string(),
    /** Every movement recognised as a rep attempt: valid + invalid. */
    detectedReps: z.int().nonnegative(),
    validReps: z.int().nonnegative(),
    invalidReps: z.int().nonnegative(),
    metrics: z.object({
      /**
       * Furthest primary angle reached across counted and partial reps, degrees
       * (lowest for exercises whose angle decreases, highest for increasing ones).
       */
      lowestPrimaryAngleDeg: z.number().nullable(),
      averageRepDurationMs: z.number().nonnegative().nullable(),
      /** Share of frames that passed setup/confidence checks (0–1). */
      usableFrameRatio: z.number().min(0).max(1).nullable(),
    }),
    formIssues: z.array(formIssueCountSchema),
    /** "manual" = entered by the user when CV was unavailable (spec §25 fallback). */
    measurementSource: z.enum(['cv', 'manual']),
  })
  .refine((r) => r.detectedReps === r.validReps + r.invalidReps, {
    message: 'detectedReps must equal validReps + invalidReps',
    path: ['detectedReps'],
  });
export type ExerciseSetResult = z.infer<typeof exerciseSetResultSchema>;

/** Aggregated metrics for one workout session. */
export const performanceMetricsSchema = z.object({
  sessionId: idSchema,
  sets: z.array(exerciseSetResultSchema),
  /** Completed planned sets / planned sets (0–1). */
  completionRatio: z.number().min(0).max(1),
  activeDurationSeconds: z.number().nonnegative(),
});
export type PerformanceMetrics = z.infer<typeof performanceMetricsSchema>;

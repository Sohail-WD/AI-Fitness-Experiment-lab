import { z } from 'zod';
import { idSchema, timestampSchema } from './common.ts';

/** spec §12–§14 */

export const experimentVariableSchema = z.enum([
  'workout_time',
  'workout_duration',
  'workout_structure',
  'exercise_selection',
  'training_frequency',
  'rest_duration',
  'workout_difficulty',
]);

export const experimentMetricSchema = z.enum(['adherence', 'completion_ratio', 'effort', 'enjoyment', 'valid_rep_ratio']);
export type ExperimentMetric = z.infer<typeof experimentMetricSchema>;

export const experimentConditionSchema = z.object({
  id: z.enum(['A', 'B']),
  label: z.string().min(1),
  /** Workout parameters applied under this condition, e.g. { durationMinutes: 20 }. */
  parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

export const experimentSchema = z.object({
  id: idSchema,
  userId: idSchema,
  /** proposed → active → completed | ended_early; proposed → skipped (spec §13.1). */
  status: z.enum(['proposed', 'active', 'completed', 'ended_early', 'skipped']),
  variable: experimentVariableSchema,
  hypothesis: z.string().min(1),
  conditions: z.tuple([experimentConditionSchema, experimentConditionSchema]),
  primaryMetric: experimentMetricSchema,
  /** No result is claimed until each condition has at least this many observations (spec §13.2). */
  minObservationsPerCondition: z.int().min(1),
  plannedDurationDays: z.int().min(1),
  /** Evaluates SIMULATED sessions over a back-dated window instead of real sessions after acceptance. */
  isSimulated: z.boolean(),
  /** User's UTC offset (JS getTimezoneOffset, minutes) used to classify local time of day. Default 0. */
  timezoneOffsetMinutes: z.int().min(-840).max(840).optional(),
  createdAt: timestampSchema,
  startedAt: timestampSchema.nullable(),
  endedAt: timestampSchema.nullable(),
});
export type Experiment = z.infer<typeof experimentSchema>;

/** Deterministically computed. Wording for the user is produced later, from these numbers. */
export const experimentResultSchema = z.object({
  experimentId: idSchema,
  computedAt: timestampSchema,
  perCondition: z.array(
    z.object({
      conditionId: z.enum(['A', 'B']),
      observations: z.int().nonnegative(),
      /** Value of the primary metric; null when there were no observations. */
      metricValue: z.number().nullable(),
      /** Sessions assigned to this condition (M7). */
      sessionIds: z.array(idSchema).optional(),
      /** Planned workouts in the window (adherence experiments). */
      planned: z.int().nonnegative().optional(),
      /** Sessions meeting the completion rule. */
      completed: z.int().nonnegative().optional(),
    }),
  ),
  sufficientData: z.boolean(),
  /** Period the result covers (M7). */
  windowStart: timestampSchema.optional(),
  windowEnd: timestampSchema.optional(),
});
export type ExperimentResult = z.infer<typeof experimentResultSchema>;

/** API: create an experiment from a template (M7). */
export const createExperimentInputSchema = z.object({
  templateId: z.string(),
  useSimulatedData: z.boolean().default(false),
  timezoneOffsetMinutes: z.int().min(-840).max(840).default(0),
});

export const experimentWithResultSchema = z.object({
  experiment: experimentSchema,
  result: experimentResultSchema.nullable(),
});
export type ExperimentWithResult = z.infer<typeof experimentWithResultSchema>;
export const experimentListSchema = z.object({ experiments: z.array(experimentWithResultSchema) });

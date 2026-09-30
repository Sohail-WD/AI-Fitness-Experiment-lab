import { z } from 'zod';
import { idSchema, timestampSchema } from './common.ts';
import { workoutSchema } from './workout.ts';

/** spec §16 */

export const adaptableParameterSchema = z.enum([
  'exercise_selection',
  'workout_duration',
  'difficulty',
  'sets',
  'repetitions',
  'rest',
  'exercise_order',
  'frequency',
  'workout_timing',
]);
export type AdaptableParameter = z.infer<typeof adaptableParameterSchema>;

const changeValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);
export type ChangeValue = z.infer<typeof changeValueSchema>;

export const adaptationChangeSchema = z.object({
  parameter: adaptableParameterSchema,
  from: changeValueSchema,
  to: changeValueSchema,
});
export type AdaptationChange = z.infer<typeof adaptationChangeSchema>;

/**
 * pending → accepted → applied, or pending → declined (all by the user).
 * auto_applied: a minor, safe, reversible change on real data applied by rule.
 */
export const adaptationStatusSchema = z.enum(['pending', 'accepted', 'declined', 'applied', 'auto_applied']);
export type AdaptationStatus = z.infer<typeof adaptationStatusSchema>;

export const adaptationProposalSchema = z
  .object({
    id: idSchema,
    userId: idSchema,
    /** The experiment (and its stored result) that caused this proposal. */
    experimentId: idSchema.nullable(),
    analysisReportId: idSchema.nullable(),
    title: z.string(),
    /** minor changes may auto-apply by rule; significant ones need user approval (spec §16.1–16.2). */
    significance: z.enum(['minor', 'significant']),
    status: adaptationStatusSchema,
    changes: z.array(adaptationChangeSchema).min(1),
    /** Why the proposal was created: the deterministic result it is based on. */
    rationale: z.string().min(1),
    /** Proposal comes from SIMULATED demo history (spec §13.4). */
    isSimulated: z.boolean(),
    /** computedAt of the experiment result the proposal was derived from. */
    resultComputedAt: timestampSchema.nullable(),
    createdAt: timestampSchema,
    decidedAt: timestampSchema.nullable(),
    appliedAt: timestampSchema.nullable(),
    /** The next workout generated when the proposal was applied. */
    appliedWorkoutId: idSchema.nullable(),
  })
  .refine((p) => !(p.status === 'auto_applied' && p.significance === 'significant'), {
    message: 'significant adaptations require user approval and cannot be auto-applied',
    path: ['status'],
  });
export type AdaptationProposal = z.infer<typeof adaptationProposalSchema>;

export const skipReasonSchema = z.enum([
  'insufficient_evidence',
  'no_clear_difference',
  'no_rule',
  'already_configured',
  'already_proposed',
  'violates_constraints',
]);
export type SkipReason = z.infer<typeof skipReasonSchema>;

/** `stale`: the current configuration no longer matches the proposal's "from" values. */
export const adaptationListItemSchema = z.object({ proposal: adaptationProposalSchema, stale: z.boolean() });
export const adaptationListSchema = z.object({ proposals: z.array(adaptationListItemSchema) });
export const generateAdaptationsResponseSchema = z.object({
  created: z.array(adaptationProposalSchema),
  skipped: z.array(z.object({ experimentId: idSchema, reason: skipReasonSchema })),
});
export const proposalResponseSchema = z.object({ proposal: adaptationProposalSchema });
export const applyResponseSchema = z.object({ proposal: adaptationProposalSchema, workout: workoutSchema });

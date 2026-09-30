import { z } from 'zod';
import { dateSchema, idSchema, timestampSchema } from './common.ts';
import { formIssueCountSchema } from './metrics.ts';
import { postWorkoutFeedbackSchema } from './workout.ts';

/** History & performance (M6). Every value is computed deterministically from stored sessions. */

export const dataSourceSchema = z.enum(['real', 'simulated', 'all']);
export type DataSource = z.infer<typeof dataSourceSchema>;

export const sessionSummarySchema = z.object({
  sessionId: idSchema,
  workoutId: idSchema,
  workoutTitle: z.string(),
  status: z.enum(['in_progress', 'completed', 'abandoned']),
  startedAt: timestampSchema,
  endedAt: timestampSchema.nullable(),
  /** Simulated demo data (spec §13.4). Always shown with a SIMULATED label. */
  isSimulated: z.boolean(),
  activeDurationSeconds: z.number().nonnegative().nullable(),
  completionRatio: z.number().min(0).max(1).nullable(),
  totalReps: z.int().nonnegative(),
  validReps: z.int().nonnegative(),
  invalidReps: z.int().nonnegative(),
  formIssues: z.array(formIssueCountSchema),
  feedback: postWorkoutFeedbackSchema.nullable(),
  /** Whether this session meets the completion rule used for adherence. */
  countsAsCompleted: z.boolean(),
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;

export const weeklyTrendSchema = z.object({
  /** Monday of the week (UTC). */
  weekStart: dateSchema,
  planned: z.int().nonnegative(),
  sessions: z.int().nonnegative(),
  completed: z.int().nonnegative(),
  adherence: z.number().min(0).max(1).nullable(),
  averageCompletion: z.number().min(0).max(1).nullable(),
  validRepRate: z.number().min(0).max(1).nullable(),
  formIssueCount: z.int().nonnegative(),
});
export type WeeklyTrend = z.infer<typeof weeklyTrendSchema>;

export const historyMetricsSchema = z.object({
  /** Human-readable definition used for "completed" (spec §14). */
  completionRule: z.string(),
  plannedPerWeek: z.int().nonnegative(),
  weeks: z.array(weeklyTrendSchema),
  totals: z.object({
    sessions: z.int().nonnegative(),
    workoutsCompleted: z.int().nonnegative(),
    planned: z.int().nonnegative(),
    adherence: z.number().min(0).max(1).nullable(),
    averageCompletion: z.number().min(0).max(1).nullable(),
    validRepRate: z.number().min(0).max(1).nullable(),
    formIssues: z.array(formIssueCountSchema),
  }),
});
export type HistoryMetrics = z.infer<typeof historyMetricsSchema>;

export const historyResponseSchema = z.object({
  source: dataSourceSchema,
  sessions: z.array(sessionSummarySchema),
  metrics: historyMetricsSchema,
});
export type HistoryResponse = z.infer<typeof historyResponseSchema>;

export const simulateHistoryInputSchema = z.object({
  weeks: z.int().min(1).max(12).default(6),
  /** JS getTimezoneOffset() of the user, so simulated sessions fall at local morning/evening times. */
  timezoneOffsetMinutes: z.int().min(-840).max(840).default(0),
});
export const simulateHistoryResponseSchema = z.object({ created: z.int().nonnegative(), replaced: z.int().nonnegative() });

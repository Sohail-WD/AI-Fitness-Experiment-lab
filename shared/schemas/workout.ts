import { z } from 'zod';
import {
  dateSchema,
  equipmentSchema,
  fitnessLevelSchema,
  goalSchema,
  idSchema,
  locationSchema,
  restrictionTagSchema,
  spaceSchema,
  timestampSchema,
  trainingContextSchema,
} from './common.ts';
import { performanceMetricsSchema } from './metrics.ts';

/** Training prescription derived from goal, level, context and frequency. */
export const trainingParametersSchema = z
  .object({
    sets: z.int().min(1).max(10),
    repsMin: z.int().min(1).max(100),
    repsMax: z.int().min(1).max(100),
    /** Rest between sets of main exercises. */
    restSeconds: z.int().min(0).max(600),
    /** Work interval for timed (duration) exercises. */
    holdSeconds: z.int().min(5).max(600),
  })
  .refine((p) => p.repsMin <= p.repsMax, { message: 'repsMin must not exceed repsMax', path: ['repsMin'] });
export type TrainingParameters = z.infer<typeof trainingParametersSchema>;

export const exclusionReasonSchema = z.enum(['equipment', 'restriction', 'level', 'space']);

/** Output of the personalization engine, input to the workout engine (spec §5). */
export const workoutRequirementsSchema = z.object({
  userId: idSchema,
  fitnessLevel: fitnessLevelSchema,
  goals: z.array(goalSchema).min(1),
  trainingContext: trainingContextSchema,
  availableEquipment: z.array(equipmentSchema),
  targetDurationMinutes: z.int().min(10).max(120),
  workoutsPerWeek: z.int().min(1).max(7),
  location: locationSchema,
  space: spaceSchema,
  restrictions: z.array(restrictionTagSchema),
  trainingParameters: trainingParametersSchema,
  /** Library exercises that pass every hard filter (equipment, restrictions, level, space). */
  eligibleExerciseIds: z.array(z.string()),
  /** Why each remaining library exercise was excluded (first failing filter). */
  exclusions: z.array(z.object({ exerciseId: z.string(), reason: exclusionReasonSchema })),
});
export type WorkoutRequirements = z.infer<typeof workoutRequirementsSchema>;

export const workoutTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('reps'), reps: z.int().min(1).max(100) }),
  z.object({ type: z.literal('duration'), seconds: z.int().min(5).max(3600) }),
]);

/** spec §6.2 */
export const workoutItemSchema = z.object({
  exerciseId: z.string(),
  section: z.enum(['warmup', 'main', 'cooldown']),
  order: z.int().nonnegative(),
  sets: z.int().min(1).max(10),
  target: workoutTargetSchema,
  restSeconds: z.int().min(0).max(600),
});
export type WorkoutItem = z.infer<typeof workoutItemSchema>;

export const workoutSchema = z.object({
  id: idSchema,
  userId: idSchema,
  title: z.string().min(1),
  /** Deterministic, profile-based explanation ("Why this workout?"). */
  rationale: z.array(z.string()),
  /** Variation seed: the same requirements and seed always produce the same workout. */
  seed: z.int().nonnegative(),
  requirements: workoutRequirementsSchema,
  items: z.array(workoutItemSchema).min(1),
  scheduledFor: dateSchema.nullable(),
  estimatedMinutes: z.int().positive(),
  createdAt: timestampSchema,
});
export type Workout = z.infer<typeof workoutSchema>;

export const generateWorkoutInputSchema = z.object({
  /** Omit for the first workout; pass a new value to regenerate a variation. */
  seed: z.int().nonnegative().optional(),
});

/** spec §11 */
export const postWorkoutFeedbackSchema = z.object({
  effort: z.int().min(1).max(10),
  enjoyment: z.int().min(1).max(10),
  energy: z.enum(['low', 'okay', 'high']).optional(),
  note: z.string().max(1000).optional(),
  wouldRepeat: z.boolean().optional(),
});
export type PostWorkoutFeedback = z.infer<typeof postWorkoutFeedbackSchema>;

export const workoutSessionSchema = z.object({
  id: idSchema,
  workoutId: idSchema,
  userId: idSchema,
  status: z.enum(['in_progress', 'completed', 'abandoned']),
  startedAt: timestampSchema,
  endedAt: timestampSchema.nullable(),
  /** Simulated demo data must always be distinguishable from real data (spec §13.4). */
  isSimulated: z.boolean(),
  feedback: postWorkoutFeedbackSchema.nullable(),
  metrics: performanceMetricsSchema.nullable(),
});
export type WorkoutSession = z.infer<typeof workoutSessionSchema>;

/** spec §19.4 */
export const sessionEventTypeSchema = z.enum([
  'workout_started',
  'workout_paused',
  'workout_resumed',
  'exercise_started',
  'exercise_skipped',
  'set_completed',
  'rep_detected',
  'rep_validated',
  'form_issue_detected',
  'exercise_completed',
  'workout_completed',
  'workout_stopped',
]);
export type SessionEventType = z.infer<typeof sessionEventTypeSchema>;

export const sessionEventSchema = z.object({
  sessionId: idSchema,
  type: sessionEventTypeSchema,
  occurredAt: timestampSchema,
  exerciseId: z.string().nullable(),
  setIndex: z.int().nonnegative().nullable(),
  /** Event-specific details (e.g. form issue code, rep duration). Kept small and flat. */
  data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});
export type SessionEvent = z.infer<typeof sessionEventSchema>;

/** Session API request bodies (M3). */
export const createSessionInputSchema = z.object({ workoutId: idSchema });
export const sessionEventInputSchema = sessionEventSchema.omit({ sessionId: true });
export type SessionEventInput = z.infer<typeof sessionEventInputSchema>;
export const appendEventsInputSchema = z.object({ events: z.array(sessionEventInputSchema).min(1).max(200) });
export const completeSessionInputSchema = z.object({
  status: z.enum(['completed', 'abandoned']),
  metrics: performanceMetricsSchema,
});
export const sessionFeedbackInputSchema = z.object({ feedback: postWorkoutFeedbackSchema });

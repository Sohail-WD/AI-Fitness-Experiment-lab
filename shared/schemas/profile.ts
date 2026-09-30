import { z } from 'zod';
import {
  equipmentSchema,
  fitnessLevelSchema,
  goalSchema,
  idSchema,
  locationSchema,
  restrictionTagSchema,
  spaceSchema,
  timeOfDaySchema,
  timestampSchema,
  trainingContextSchema,
  weekdaySchema,
} from './common.ts';

/** spec §3 */
export const userProfileSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(60),
  fitnessLevel: fitnessLevelSchema,
  goals: z.array(goalSchema).min(1),
  trainingContext: trainingContextSchema,
  equipment: z.array(equipmentSchema),
  environment: z.object({
    location: locationSchema,
    /** Optional; when absent, personalization assumes a typical space for the location. */
    space: spaceSchema.optional(),
    limitations: z.string().max(500).optional(),
  }),
  availableMinutes: z.int().min(10).max(120),
  schedule: z.object({
    preferredDays: z.array(weekdaySchema),
    preferredTimes: z.array(timeOfDaySchema),
    workoutsPerWeek: z.int().min(1).max(7),
  }),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type UserProfile = z.infer<typeof userProfileSchema>;

/**
 * spec §4: restrictions are filtering constraints, not diagnoses. Free-text
 * notes are stored and shown back to the user but never interpreted.
 */
export const userConstraintsSchema = z.object({
  userId: idSchema,
  restrictionTags: z.array(restrictionTagSchema),
  notes: z.string().max(1000),
  source: z.enum(['self_reported', 'professional_advised']),
  updatedAt: timestampSchema,
});
export type UserConstraints = z.infer<typeof userConstraintsSchema>;

/** What the client sends to save a profile; ids and timestamps are assigned by the server. */
export const profileInputSchema = z.object({
  profile: userProfileSchema.omit({ id: true, createdAt: true, updatedAt: true }),
  constraints: userConstraintsSchema.omit({ userId: true, updatedAt: true }),
});
export type ProfileInput = z.infer<typeof profileInputSchema>;

export const profileResponseSchema = z.object({
  profile: userProfileSchema,
  constraints: userConstraintsSchema,
});
export type ProfileResponse = z.infer<typeof profileResponseSchema>;

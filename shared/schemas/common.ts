import { z } from 'zod';

/** Vocabulary shared by every contract. Values come from spec.md §3–§4. */

export const idSchema = z.uuid();
export const timestampSchema = z.iso.datetime({ offset: true });
/** Calendar date, YYYY-MM-DD. */
export const dateSchema = z.iso.date();

export const fitnessLevelSchema = z.enum(['beginner', 'intermediate', 'advanced']);
export type FitnessLevel = z.infer<typeof fitnessLevelSchema>;

export const goalSchema = z.enum([
  'general_fitness',
  'strength',
  'muscle_building',
  'endurance',
  'weight_management',
  'explosive_strength',
  'mobility',
  'sport_performance',
  'consistency',
]);
export type Goal = z.infer<typeof goalSchema>;

/** Current activity level (M2). Replaces the user-type list in spec §3.3. */
export const trainingContextSchema = z.enum(['sedentary', 'recreationally_active', 'regularly_training', 'athletic']);
export type TrainingContext = z.infer<typeof trainingContextSchema>;

/**
 * Available equipment. "No equipment" is an empty list. "full_gym" means any
 * equipment the library requires is available.
 */
export const equipmentSchema = z.enum(['dumbbells', 'resistance_bands', 'barbell', 'bench', 'full_gym', 'other']);
export type Equipment = z.infer<typeof equipmentSchema>;

export const locationSchema = z.enum(['home', 'gym', 'outdoors', 'other']);
export type Location = z.infer<typeof locationSchema>;

export const spaceSchema = z.enum(['small', 'medium', 'large']);
export type Space = z.infer<typeof spaceSchema>;

/**
 * Restrictions supplied by the user or a healthcare professional (spec §4.2).
 * They are constraints for filtering exercises, never diagnoses.
 */
export const restrictionTagSchema = z.enum([
  'avoid_high_impact',
  'avoid_jumping',
  'avoid_overhead_loading',
  'avoid_floor_work',
  'avoid_deep_knee_flexion',
  'avoid_loaded_spinal_flexion',
]);
export type RestrictionTag = z.infer<typeof restrictionTagSchema>;

export const weekdaySchema = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
export const timeOfDaySchema = z.enum(['morning', 'afternoon', 'evening']);

/** Machine-readable issue code, e.g. "insufficient_depth". Open-ended so exercises can add their own. */
export const issueCodeSchema = z.string().regex(/^[a-z][a-z0-9_]*$/, 'must be snake_case');

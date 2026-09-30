import type { Equipment, FitnessLevel, Goal, Location, RestrictionTag, TrainingContext } from '../schemas/common.ts';

/** User-facing labels, shared by the UI and the generated workout rationale. */

export const GOAL_LABEL: Record<Goal, string> = {
  general_fitness: 'General fitness',
  strength: 'Strength',
  muscle_building: 'Muscle building',
  endurance: 'Endurance',
  weight_management: 'Weight management',
  explosive_strength: 'Explosive strength',
  mobility: 'Mobility',
  sport_performance: 'Sport performance',
  consistency: 'Consistency',
};

export const LEVEL_LABEL: Record<FitnessLevel, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

export const CONTEXT_LABEL: Record<TrainingContext, string> = {
  sedentary: 'Sedentary',
  recreationally_active: 'Recreationally active',
  regularly_training: 'Regularly training',
  athletic: 'Athletic',
};

export const EQUIPMENT_LABEL: Record<Equipment, string> = {
  dumbbells: 'Dumbbells',
  resistance_bands: 'Resistance bands',
  barbell: 'Barbell',
  bench: 'Bench',
  full_gym: 'Full gym',
  other: 'Other',
};

export const LOCATION_LABEL: Record<Location, string> = {
  home: 'Home',
  gym: 'Gym',
  outdoors: 'Outdoors',
  other: 'Other',
};

export const RESTRICTION_LABEL: Record<RestrictionTag, string> = {
  avoid_high_impact: 'Avoid high impact',
  avoid_jumping: 'Avoid jumping',
  avoid_overhead_loading: 'Avoid overhead loading',
  avoid_floor_work: 'Avoid floor work',
  avoid_deep_knee_flexion: 'Avoid deep knee flexion',
  avoid_loaded_spinal_flexion: 'Avoid loaded spinal flexion',
};

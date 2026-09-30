import type {
  AdaptationProposal,
  AnalysisReport,
  Experiment,
  ExperimentResult,
  UserConstraints,
  UserProfile,
  Workout,
  WorkoutRequirements,
} from '../../shared/schemas';

/** Valid example objects for every contract. Tests override single fields to probe validation. */

export const USER_ID = '6f1c1a8e-3b8e-4c1e-9d6a-2b7f4f1a0c11';
export const WORKOUT_ID = '0a8f7c52-6d43-4b3e-8f6a-1c2d3e4f5a61';
export const SESSION_ID = '9b2e4d17-5a3c-4f8e-b1d2-7e6f5a4b3c21';
export const EXPERIMENT_ID = '3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e71';
export const REPORT_ID = 'aa1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c81';
export const PROPOSAL_ID = 'bb2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d91';
const NOW = '2026-09-29T10:00:00.000Z';

export const profile: UserProfile = {
  id: USER_ID,
  name: 'Test User',
  fitnessLevel: 'intermediate',
  goals: ['strength'],
  trainingContext: 'regularly_training',
  equipment: ['dumbbells'],
  environment: { location: 'home', space: 'medium' },
  availableMinutes: 30,
  schedule: { preferredDays: ['mon', 'wed', 'fri', 'sat'], preferredTimes: ['morning'], workoutsPerWeek: 4 },
  createdAt: NOW,
  updatedAt: NOW,
};

export const constraints: UserConstraints = {
  userId: USER_ID,
  restrictionTags: ['avoid_high_impact'],
  notes: 'Advised by physiotherapist to avoid jumping for now.',
  source: 'professional_advised',
  updatedAt: NOW,
};

/** spec §5 example */
export const requirements: WorkoutRequirements = {
  userId: USER_ID,
  fitnessLevel: 'intermediate',
  goals: ['strength'],
  trainingContext: 'regularly_training',
  availableEquipment: ['dumbbells'],
  targetDurationMinutes: 30,
  workoutsPerWeek: 4,
  location: 'home',
  space: 'medium',
  restrictions: ['avoid_high_impact'],
  trainingParameters: { sets: 4, repsMin: 5, repsMax: 8, restSeconds: 120, holdSeconds: 30 },
  eligibleExerciseIds: ['squat'],
  exclusions: [{ exerciseId: 'jump_squat', reason: 'restriction' }],
};

export const workout: Workout = {
  id: WORKOUT_ID,
  userId: USER_ID,
  title: 'Strength workout · Intermediate',
  rationale: ['Goal: strength.'],
  seed: 0,
  requirements,
  items: [
    { exerciseId: 'squat', section: 'main', order: 0, sets: 3, target: { type: 'reps', reps: 12 }, restSeconds: 60 },
  ],
  scheduledFor: '2026-09-30',
  estimatedMinutes: 30,
  createdAt: NOW,
};

export const experiment: Experiment = {
  id: EXPERIMENT_ID,
  userId: USER_ID,
  status: 'proposed',
  variable: 'workout_duration',
  hypothesis: 'Shorter workouts may improve consistency for this user.',
  conditions: [
    { id: 'A', label: '20-minute workouts', parameters: { durationMinutes: 20 } },
    { id: 'B', label: '30-minute workouts', parameters: { durationMinutes: 30 } },
  ],
  primaryMetric: 'adherence',
  minObservationsPerCondition: 4,
  plannedDurationDays: 14,
  isSimulated: false,
  createdAt: NOW,
  startedAt: null,
  endedAt: null,
};

export const experimentResult: ExperimentResult = {
  experimentId: EXPERIMENT_ID,
  computedAt: NOW,
  perCondition: [
    { conditionId: 'A', observations: 7, metricValue: 0.86 },
    { conditionId: 'B', observations: 8, metricValue: 0.63 },
  ],
  sufficientData: true,
};

export const analysisReport: AnalysisReport = {
  id: REPORT_ID,
  userId: USER_ID,
  experimentId: EXPERIMENT_ID,
  createdAt: NOW,
  source: 'fallback',
  provider: null,
  model: null,
  fallbackReason: 'no_api_key',
  isSimulated: false,
  notice: null,
  dataUsed: [
    { ref: 'A.metric', label: '20-minute workouts: adherence', display: '86%' },
    { ref: 'B.metric', label: '30-minute workouts: adherence', display: '63%' },
  ],
  caveat: 'This describes your own workouts during this experiment only. It is a personal observation, not a scientific conclusion.',
  observations: [
    {
      text: 'You completed 86% of 20-minute workouts and 63% of 30-minute workouts during this experiment.',
      dataRefs: ['A.metric', 'B.metric'],
    },
  ],
  possibleExplanations: ['Shorter sessions may have been easier to fit into your schedule.'],
  hypothesis: 'Keeping sessions at 20 minutes may maintain higher consistency.',
  recommendation: 'Consider 20-minute sessions for the next two weeks.',
  confidence: 'low',
};

export const adaptationProposal: AdaptationProposal = {
  id: PROPOSAL_ID,
  userId: USER_ID,
  experimentId: EXPERIMENT_ID,
  analysisReportId: REPORT_ID,
  title: 'Change workout length to 15 minutes',
  isSimulated: false,
  resultComputedAt: NOW,
  appliedAt: null,
  appliedWorkoutId: null,
  significance: 'significant',
  status: 'pending',
  changes: [{ parameter: 'workout_duration', from: 30, to: 20 }],
  rationale: 'Adherence was higher with 20-minute workouts during the experiment.',
  createdAt: NOW,
  decidedAt: null,
};

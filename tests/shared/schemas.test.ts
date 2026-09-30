import { describe, expect, it } from 'vitest';
import {
  adaptationProposalSchema,
  analysisReportSchema,
  exerciseSetResultSchema,
  experimentResultSchema,
  experimentSchema,
  performanceMetricsSchema,
  postWorkoutFeedbackSchema,
  sessionEventSchema,
  userConstraintsSchema,
  userProfileSchema,
  workoutRequirementsSchema,
  workoutSchema,
  workoutSessionSchema,
} from '../../shared/schemas';
import {
  adaptationProposal,
  analysisReport,
  constraints,
  experiment,
  experimentResult,
  profile,
  requirements,
  SESSION_ID,
  USER_ID,
  WORKOUT_ID,
  workout,
} from '../fixtures/contracts';

const setResult = {
  exerciseId: 'squat',
  detectedReps: 12,
  validReps: 9,
  invalidReps: 3,
  metrics: { lowestPrimaryAngleDeg: 8, averageRepDurationMs: 2400, usableFrameRatio: 0.91 },
  formIssues: [{ code: 'insufficient_depth', count: 3 }],
  measurementSource: 'cv' as const,
};

describe('valid contracts parse', () => {
  it.each([
    ['UserProfile', userProfileSchema, profile],
    ['UserConstraints', userConstraintsSchema, constraints],
    ['WorkoutRequirements', workoutRequirementsSchema, requirements],
    ['Workout', workoutSchema, workout],
    ['Experiment', experimentSchema, experiment],
    ['ExperimentResult', experimentResultSchema, experimentResult],
    ['AnalysisReport', analysisReportSchema, analysisReport],
    ['AdaptationProposal', adaptationProposalSchema, adaptationProposal],
    ['ExerciseSetResult', exerciseSetResultSchema, setResult],
  ] as const)('%s', (_name, schema, value) => {
    expect(schema.safeParse(value).success).toBe(true);
  });

  it('WorkoutSession with metrics and feedback', () => {
    const session = {
      id: SESSION_ID,
      workoutId: WORKOUT_ID,
      userId: USER_ID,
      status: 'completed',
      startedAt: '2026-09-29T10:00:00.000Z',
      endedAt: '2026-09-29T10:31:00.000Z',
      isSimulated: false,
      feedback: { effort: 8, enjoyment: 6, wouldRepeat: true },
      metrics: { sessionId: SESSION_ID, sets: [setResult], completionRatio: 1, activeDurationSeconds: 1860 },
    };
    expect(workoutSessionSchema.safeParse(session).success).toBe(true);
  });

  it('SessionEvent', () => {
    const event = {
      sessionId: SESSION_ID,
      type: 'form_issue_detected',
      occurredAt: '2026-09-29T10:05:00.000Z',
      exerciseId: 'squat',
      setIndex: 0,
      data: { code: 'insufficient_depth', lowestThighAngleDeg: 32 },
    };
    expect(sessionEventSchema.safeParse(event).success).toBe(true);
  });
});

describe('invalid contracts are rejected', () => {
  it('profile needs at least one goal and a known fitness level', () => {
    expect(userProfileSchema.safeParse({ ...profile, goals: [] }).success).toBe(false);
    expect(userProfileSchema.safeParse({ ...profile, fitnessLevel: 'elite' }).success).toBe(false);
  });

  it('profile rejects non-integer or out-of-range available minutes', () => {
    expect(userProfileSchema.safeParse({ ...profile, availableMinutes: 0 }).success).toBe(false);
    expect(userProfileSchema.safeParse({ ...profile, availableMinutes: 22.5 }).success).toBe(false);
  });

  it('constraints only accept predefined restriction tags, not free-text medical terms', () => {
    expect(userConstraintsSchema.safeParse({ ...constraints, restrictionTags: ['knee_injury'] }).success).toBe(false);
  });

  it('post-workout effort and enjoyment are limited to 1–10', () => {
    expect(postWorkoutFeedbackSchema.safeParse({ effort: 11, enjoyment: 5, wouldRepeat: true }).success).toBe(false);
    expect(postWorkoutFeedbackSchema.safeParse({ effort: 0, enjoyment: 5, wouldRepeat: true }).success).toBe(false);
  });

  it('set results must have detected = valid + invalid', () => {
    expect(exerciseSetResultSchema.safeParse({ ...setResult, detectedReps: 13 }).success).toBe(false);
  });

  it('metrics sets must also satisfy the set-result rule', () => {
    const metrics = { sessionId: SESSION_ID, sets: [{ ...setResult, validReps: 20 }], completionRatio: 1, activeDurationSeconds: 60 };
    expect(performanceMetricsSchema.safeParse(metrics).success).toBe(false);
  });

  it('experiments compare exactly two conditions', () => {
    expect(experimentSchema.safeParse({ ...experiment, conditions: [experiment.conditions[0]] }).success).toBe(false);
  });

  it('AI observations must cite the stored data they are based on', () => {
    const uncited = { ...analysisReport, observations: [{ text: 'You did well.', dataRefs: [] }] };
    expect(analysisReportSchema.safeParse(uncited).success).toBe(false);
  });

  it('significant adaptations cannot be auto-applied', () => {
    expect(adaptationProposalSchema.safeParse({ ...adaptationProposal, status: 'auto_applied' }).success).toBe(false);
    expect(
      adaptationProposalSchema.safeParse({ ...adaptationProposal, significance: 'minor', status: 'auto_applied' }).success,
    ).toBe(true);
  });

  it('timestamps must be ISO-8601 and ids must be UUIDs', () => {
    expect(userProfileSchema.safeParse({ ...profile, createdAt: 'yesterday' }).success).toBe(false);
    expect(userProfileSchema.safeParse({ ...profile, id: 'user-1' }).success).toBe(false);
  });
});

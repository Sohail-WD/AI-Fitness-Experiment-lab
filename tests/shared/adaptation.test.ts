import { describe, expect, it } from 'vitest';
import {
  AdaptationApplyError,
  AdaptationTransitionError,
  applyChangesToProfile,
  canAutoApply,
  classifyChange,
  isStale,
  MIN_RATIO_DIFFERENCE,
  proposalSignificance,
  type ProposalDraft,
  proposeFromExperiment,
  transitionProposal,
  violatesRestrictions,
} from '../../shared/adaptation/engine';
import { findTemplate } from '../../shared/experiments/engine';
import { exerciseLibrary } from '../../shared/exercises/library';
import { type AdaptationChange, type AdaptationProposal, adaptationProposalSchema } from '../../shared/schemas/adaptation';
import type { Experiment, ExperimentResult } from '../../shared/schemas/experiment';
import type { ProfileInput } from '../../shared/schemas/profile';
import { adaptationProposal, constraints, EXPERIMENT_ID, profile } from '../fixtures/contracts';

const NOW = new Date('2026-10-01T12:00:00.000Z');
const COMPUTED_AT = '2026-09-29T11:00:00.000Z';

const experiment = (templateId: string, o: Partial<Experiment> = {}): Experiment => ({
  id: EXPERIMENT_ID,
  userId: profile.id,
  status: 'completed',
  ...findTemplate(templateId)!.build(3),
  isSimulated: false,
  timezoneOffsetMinutes: 0,
  createdAt: COMPUTED_AT,
  startedAt: COMPUTED_AT,
  endedAt: COMPUTED_AT,
  ...o,
});
const result = (a: number | null, b: number | null, sufficientData = true): ExperimentResult => ({
  experimentId: EXPERIMENT_ID,
  computedAt: COMPUTED_AT,
  perCondition: [
    { conditionId: 'A', observations: 6, metricValue: a, planned: 6, completed: 5 },
    { conditionId: 'B', observations: 6, metricValue: b, planned: 6, completed: 3 },
  ],
  sufficientData,
});
const ctx = (o: { minutes?: number; times?: ('morning' | 'afternoon' | 'evening')[]; restrictions?: typeof constraints.restrictionTags } = {}) => ({
  profile: { ...profile, availableMinutes: o.minutes ?? 30, schedule: { ...profile.schedule, preferredTimes: o.times ?? [] } },
  constraints: { ...constraints, restrictionTags: o.restrictions ?? [] },
  library: exerciseLibrary,
});
const draftOf = (outcome: ReturnType<typeof proposeFromExperiment>): ProposalDraft => {
  if (outcome.kind !== 'proposal') throw new Error(`expected a proposal, got skip: ${outcome.reason}`);
  return outcome.draft;
};

describe('proposal generation', () => {
  it('better workout time → change the preferred time (minor), citing the experiment and result', () => {
    const d = draftOf(proposeFromExperiment(experiment('morning_vs_evening'), result(0.83, 0.5), ctx()));
    expect(d).toMatchObject({
      title: 'Prefer morning workouts',
      significance: 'minor',
      changes: [{ parameter: 'workout_timing', from: [], to: ['morning'] }],
      experimentId: EXPERIMENT_ID,
      resultComputedAt: COMPUTED_AT,
      isSimulated: false,
    });
    expect(d.rationale).toMatch(/^During this experiment, you completed 83% of your planned morning workouts/);
    expect(draftOf(proposeFromExperiment(experiment('morning_vs_evening'), result(0.4, 0.8), ctx())).changes[0].to).toEqual(['evening']);
  });

  it('better workout length → change the duration (significant)', () => {
    const shorter = draftOf(proposeFromExperiment(experiment('shorter_vs_longer'), result(0.9, 0.6), ctx({ minutes: 30 })));
    expect(shorter).toMatchObject({ title: 'Change workout length to 15 minutes', significance: 'significant', changes: [{ parameter: 'workout_duration', from: 30, to: 15 }] });
    const longer = draftOf(proposeFromExperiment(experiment('shorter_vs_longer'), result(0.5, 0.9), ctx({ minutes: 15 })));
    expect(longer.changes).toEqual([{ parameter: 'workout_duration', from: 15, to: 30 }]);
  });

  it('carries the experiment\'s simulated flag onto the proposal', () => {
    const d = draftOf(proposeFromExperiment(experiment('morning_vs_evening', { isSimulated: true }), result(0.9, 0.5), ctx()));
    expect(d.isSimulated).toBe(true);
  });

  it('proposes nothing without sufficient evidence', () => {
    const skipped = (e: Experiment, r: ExperimentResult | null) => proposeFromExperiment(e, r, ctx());
    expect(skipped(experiment('morning_vs_evening'), result(null, null, false))).toEqual({ kind: 'skipped', reason: 'insufficient_evidence' });
    expect(skipped(experiment('morning_vs_evening'), null)).toEqual({ kind: 'skipped', reason: 'insufficient_evidence' });
    expect(skipped(experiment('morning_vs_evening', { status: 'ended_early' }), result(0.9, 0.2))).toEqual({ kind: 'skipped', reason: 'insufficient_evidence' });
    expect(skipped(experiment('morning_vs_evening', { status: 'active' }), result(0.9, 0.2))).toEqual({ kind: 'skipped', reason: 'insufficient_evidence' });
  });

  it('proposes nothing for a small difference, a settled config, or an unsupported experiment', () => {
    const small = MIN_RATIO_DIFFERENCE - 0.02;
    expect(proposeFromExperiment(experiment('morning_vs_evening'), result(0.7 + small, 0.7), ctx())).toEqual({ kind: 'skipped', reason: 'no_clear_difference' });
    expect(proposeFromExperiment(experiment('morning_vs_evening'), result(0.9, 0.5), ctx({ times: ['morning'] }))).toEqual({ kind: 'skipped', reason: 'already_configured' });
    expect(proposeFromExperiment(experiment('shorter_vs_longer'), result(0.9, 0.5), ctx({ minutes: 15 }))).toEqual({ kind: 'skipped', reason: 'already_configured' });
    expect(proposeFromExperiment(experiment('shorter_vs_longer', { primaryMetric: 'effort' }), result(0.9, 0.5), ctx())).toEqual({ kind: 'skipped', reason: 'no_rule' });
    expect(proposeFromExperiment(experiment('shorter_vs_longer', { variable: 'rest_duration' }), result(0.9, 0.5), ctx())).toEqual({ kind: 'skipped', reason: 'no_rule' });
  });
});

describe('significance and approval', () => {
  const change = (parameter: AdaptationChange['parameter'], from: AdaptationChange['from'], to: AdaptationChange['to']): AdaptationChange => ({ parameter, from, to });

  it('duration, frequency, exercise, order and difficulty changes are always significant', () => {
    for (const c of [
      change('workout_duration', 30, 20),
      change('frequency', 3, 4),
      change('exercise_selection', ['squat'], ['reverse_lunge']),
      change('exercise_order', ['a'], ['b']),
      change('difficulty', 'beginner', 'intermediate'),
    ]) {
      expect(classifyChange(c), c.parameter).toBe('significant');
    }
  });

  it('timing is minor; sets/reps/rest are minor only for small (≤ 20%) changes', () => {
    expect(classifyChange(change('workout_timing', [], ['morning']))).toBe('minor');
    expect(classifyChange(change('repetitions', 10, 11))).toBe('minor');
    expect(classifyChange(change('rest', 60, 90))).toBe('significant');
    expect(proposalSignificance([change('workout_timing', [], ['morning']), change('workout_duration', 30, 20)])).toBe('significant');
  });

  it('only minor, safe, real-data changes may auto-apply', () => {
    const base = { significance: 'minor' as const, isSimulated: false, changes: [change('workout_timing', [], ['morning'])] };
    expect(canAutoApply(base)).toBe(true);
    expect(canAutoApply({ ...base, isSimulated: true })).toBe(false);
    expect(canAutoApply({ ...base, significance: 'significant' })).toBe(false);
    expect(canAutoApply({ ...base, changes: [change('sets', 3, 3)] })).toBe(false);
  });

  it('the contract itself refuses an auto-applied significant proposal', () => {
    expect(adaptationProposalSchema.safeParse({ ...adaptationProposal, status: 'auto_applied' }).success).toBe(false);
  });
});

describe('restrictions', () => {
  it('rejects exercise changes that conflict with the user\'s restrictions or name unknown exercises', () => {
    const swap = (to: string[]): AdaptationChange[] => [{ parameter: 'exercise_selection', from: ['squat'], to }];
    const c = { restrictionTags: ['avoid_jumping', 'avoid_deep_knee_flexion'] as typeof constraints.restrictionTags };
    expect(violatesRestrictions(swap(['jump_squat']), c, exerciseLibrary)).toHaveLength(1);
    expect(violatesRestrictions(swap(['goblet_squat']), c, exerciseLibrary)).toHaveLength(1);
    expect(violatesRestrictions(swap(['made_up']), c, exerciseLibrary)).toEqual(['unknown exercise "made_up"']);
    expect(violatesRestrictions(swap(['reverse_lunge']), c, exerciseLibrary)).toEqual([]);
    expect(violatesRestrictions([{ parameter: 'workout_duration', from: 30, to: 15 }], c, exerciseLibrary)).toEqual([]);
  });

  it('applying changes never touches restrictions', () => {
    const input: ProfileInput = {
      profile: { name: 'A', fitnessLevel: 'beginner', goals: ['general_fitness'], trainingContext: 'sedentary', equipment: [], environment: { location: 'home' }, availableMinutes: 30, schedule: { preferredDays: [], preferredTimes: [], workoutsPerWeek: 3 } },
      constraints: { restrictionTags: ['avoid_floor_work'], notes: 'keep', source: 'professional_advised' },
    };
    const next = applyChangesToProfile(input, [
      { parameter: 'workout_duration', from: 30, to: 15 },
      { parameter: 'workout_timing', from: [], to: ['evening'] },
      { parameter: 'frequency', from: 3, to: 4 },
    ]);
    expect(next.constraints).toEqual(input.constraints);
    expect(next.profile).toMatchObject({ availableMinutes: 15, schedule: { preferredTimes: ['evening'], workoutsPerWeek: 4 }, goals: ['general_fitness'] });
    expect(input.profile.availableMinutes).toBe(30); // input not mutated
    expect(() => applyChangesToProfile(input, [{ parameter: 'difficulty', from: 'a', to: 'b' }])).toThrow(AdaptationApplyError);
  });

  it('detects when the configuration changed since a proposal was made', () => {
    const changes: AdaptationChange[] = [{ parameter: 'workout_duration', from: 30, to: 15 }];
    expect(isStale({ ...profile, availableMinutes: 30 }, changes)).toBe(false);
    expect(isStale({ ...profile, availableMinutes: 45 }, changes)).toBe(true);
  });
});

describe('proposal lifecycle', () => {
  const pending: AdaptationProposal = { ...adaptationProposal, status: 'pending', decidedAt: null, appliedAt: null };
  const minor: AdaptationProposal = { ...pending, significance: 'minor', changes: [{ parameter: 'workout_timing', from: [], to: ['morning'] }] };
  const WORKOUT = '0a8f7c52-6d43-4b3e-8f6a-1c2d3e4f5a61';

  it('pending → accepted → applied, recording when', () => {
    const accepted = transitionProposal(pending, 'accept', NOW);
    expect(accepted).toMatchObject({ status: 'accepted', decidedAt: NOW.toISOString(), appliedAt: null });
    const applied = transitionProposal(accepted, 'apply', NOW, WORKOUT);
    expect(applied).toMatchObject({ status: 'applied', appliedAt: NOW.toISOString(), appliedWorkoutId: WORKOUT });
    expect(adaptationProposalSchema.safeParse(applied).success).toBe(true);
  });

  it('pending → declined, and a declined proposal is final', () => {
    const declined = transitionProposal(pending, 'decline', NOW);
    expect(declined).toMatchObject({ status: 'declined', decidedAt: NOW.toISOString() });
    for (const a of ['accept', 'decline', 'apply', 'auto_apply'] as const) expect(() => transitionProposal(declined, a, NOW)).toThrow(AdaptationTransitionError);
  });

  it('a significant change can only be applied after the user accepted it', () => {
    expect(() => transitionProposal(pending, 'apply', NOW)).toThrow(/pending/);
    expect(() => transitionProposal(pending, 'auto_apply', NOW)).toThrow(/needs your approval/);
    expect(() => transitionProposal(transitionProposal(pending, 'accept', NOW), 'accept', NOW)).toThrow(AdaptationTransitionError);
  });

  it('a minor safe change may be auto-applied, but simulated ones may not', () => {
    expect(transitionProposal(minor, 'auto_apply', NOW, WORKOUT)).toMatchObject({ status: 'auto_applied', appliedAt: NOW.toISOString() });
    expect(() => transitionProposal({ ...minor, isSimulated: true }, 'auto_apply', NOW)).toThrow(AdaptationTransitionError);
  });
});

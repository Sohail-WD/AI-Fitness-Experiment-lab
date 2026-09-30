import { describeResult } from '../experiments/engine.ts';
import type {
  AdaptationChange,
  AdaptationProposal,
  AdaptableParameter,
  ChangeValue,
  SkipReason,
} from '../schemas/adaptation.ts';
import type { ExerciseDefinition } from '../schemas/exercise.ts';
import type { Experiment, ExperimentMetric, ExperimentResult } from '../schemas/experiment.ts';
import type { ProfileInput, UserConstraints, UserProfile } from '../schemas/profile.ts';

/**
 * Adaptation engine (spec §16). Deterministic rules turn a completed
 * experiment result into an AdaptationProposal; no LLM is involved. Every
 * proposal cites the experiment and result it came from. Significant changes
 * always need user approval, and proposals can never violate user restrictions.
 */

/* ---------- classification ---------- */

/** Largest relative change (of sets/reps/rest) still treated as a small tweak. */
export const MINOR_RELATIVE_CHANGE = 0.2;

export function classifyChange(change: AdaptationChange): 'minor' | 'significant' {
  switch (change.parameter) {
    case 'workout_timing':
      return 'minor';
    case 'sets':
    case 'repetitions':
    case 'rest': {
      const { from, to } = change;
      if (typeof from !== 'number' || typeof to !== 'number' || from <= 0) return 'significant';
      return Math.abs(to - from) / from <= MINOR_RELATIVE_CHANGE ? 'minor' : 'significant';
    }
    // duration, frequency, exercise replacement/order, difficulty: always the user's call
    default:
      return 'significant';
  }
}

export function proposalSignificance(changes: AdaptationChange[]): 'minor' | 'significant' {
  return changes.some((c) => classifyChange(c) === 'significant') ? 'significant' : 'minor';
}

/** Only changes that are clearly safe and reversible, and never on simulated evidence. */
const AUTO_APPLY_PARAMETERS: readonly AdaptableParameter[] = ['workout_timing'];
export function canAutoApply(p: Pick<AdaptationProposal, 'significance' | 'isSimulated' | 'changes'>): boolean {
  return p.significance === 'minor' && !p.isSimulated && p.changes.every((c) => AUTO_APPLY_PARAMETERS.includes(c.parameter));
}

/* ---------- restrictions ---------- */

/**
 * Restriction violations in a proposed change. An exercise_selection change
 * may only name exercises that exist and carry none of the user's restriction tags.
 */
export function violatesRestrictions(
  changes: AdaptationChange[],
  constraints: Pick<UserConstraints, 'restrictionTags'>,
  library: readonly ExerciseDefinition[],
): string[] {
  const problems: string[] = [];
  for (const c of changes) {
    if (c.parameter !== 'exercise_selection') continue;
    const ids = Array.isArray(c.to) ? c.to : [String(c.to)];
    for (const id of ids) {
      const exercise = library.find((e) => e.id === id);
      if (!exercise) problems.push(`unknown exercise "${id}"`);
      else if (exercise.restrictionTags.some((t) => constraints.restrictionTags.includes(t))) {
        problems.push(`"${id}" conflicts with a restriction you set`);
      }
    }
  }
  return problems;
}

/* ---------- configuration (the profile is the workout-generation config) ---------- */

/** Current value of a configuration parameter, or undefined if the parameter is not configurable. */
export function currentValue(profile: Pick<UserProfile, 'availableMinutes' | 'schedule'>, parameter: AdaptableParameter): ChangeValue | undefined {
  switch (parameter) {
    case 'workout_duration':
      return profile.availableMinutes;
    case 'workout_timing':
      return profile.schedule.preferredTimes;
    case 'frequency':
      return profile.schedule.workoutsPerWeek;
    default:
      return undefined;
  }
}

const sameValue = (a: ChangeValue | undefined, b: ChangeValue | undefined) => JSON.stringify(a) === JSON.stringify(b);

/** True when the configuration no longer matches the values a proposal was based on. */
export function isStale(profile: Pick<UserProfile, 'availableMinutes' | 'schedule'>, changes: AdaptationChange[]): boolean {
  return changes.some((c) => !sameValue(currentValue(profile, c.parameter), c.from));
}

export class AdaptationApplyError extends Error {
  override name = 'AdaptationApplyError';
}

/** Profile input with the proposal's changes applied. Restrictions and all other fields are untouched. */
export function applyChangesToProfile(input: ProfileInput, changes: AdaptationChange[]): ProfileInput {
  const profile = { ...input.profile, schedule: { ...input.profile.schedule } };
  for (const c of changes) {
    switch (c.parameter) {
      case 'workout_duration':
        if (typeof c.to !== 'number') throw new AdaptationApplyError('workout_duration must be a number');
        profile.availableMinutes = c.to;
        break;
      case 'frequency':
        if (typeof c.to !== 'number') throw new AdaptationApplyError('frequency must be a number');
        profile.schedule.workoutsPerWeek = c.to;
        break;
      case 'workout_timing':
        if (!Array.isArray(c.to)) throw new AdaptationApplyError('workout_timing must be a list of times of day');
        profile.schedule.preferredTimes = c.to as typeof profile.schedule.preferredTimes;
        break;
      default:
        throw new AdaptationApplyError(`Changing "${c.parameter}" cannot be applied automatically yet`);
    }
  }
  return { profile, constraints: input.constraints };
}

/* ---------- proposal rules ---------- */

/** Minimum difference between conditions before one is called "better". */
export const MIN_RATIO_DIFFERENCE = 0.1;
export const MIN_RATING_DIFFERENCE = 1;
/** Workout lengths offered in the profile form. */
export const DURATION_OPTIONS = [15, 30, 45, 60] as const;

/** Metrics where a higher value means the condition worked better for the user. */
const HIGHER_IS_BETTER: readonly ExperimentMetric[] = ['adherence', 'completion_ratio', 'valid_rep_ratio', 'enjoyment'];

export interface ProposalDraft {
  title: string;
  rationale: string;
  significance: 'minor' | 'significant';
  changes: AdaptationChange[];
  experimentId: string;
  resultComputedAt: string;
  isSimulated: boolean;
}
export type ProposeOutcome = { kind: 'proposal'; draft: ProposalDraft } | { kind: 'skipped'; reason: SkipReason };

export interface AdaptationContext {
  profile: UserProfile;
  constraints: UserConstraints;
  library: readonly ExerciseDefinition[];
}

const skip = (reason: SkipReason): ProposeOutcome => ({ kind: 'skipped', reason });

/**
 * Propose an adaptation from a finished experiment, or explain why not.
 * Requires a completed experiment with sufficient data, and a clear difference
 * between the two conditions.
 */
export function proposeFromExperiment(experiment: Experiment, result: ExperimentResult | null, ctx: AdaptationContext): ProposeOutcome {
  if (experiment.status !== 'completed' || !result || !result.sufficientData) return skip('insufficient_evidence');
  if (!HIGHER_IS_BETTER.includes(experiment.primaryMetric)) return skip('no_rule');

  const a = result.perCondition.find((p) => p.conditionId === 'A')?.metricValue;
  const b = result.perCondition.find((p) => p.conditionId === 'B')?.metricValue;
  if (a == null || b == null) return skip('insufficient_evidence');
  const threshold = experiment.primaryMetric === 'enjoyment' ? MIN_RATING_DIFFERENCE : MIN_RATIO_DIFFERENCE;
  if (Math.abs(a - b) < threshold) return skip('no_clear_difference');

  const winner = experiment.conditions[a > b ? 0 : 1];
  const observation = describeResult(experiment, result)[0];
  let title: string;
  let changes: AdaptationChange[];
  let action: string;

  if (experiment.variable === 'workout_time' && typeof winner.parameters.timeOfDay === 'string') {
    const time = winner.parameters.timeOfDay;
    changes = [{ parameter: 'workout_timing', from: ctx.profile.schedule.preferredTimes, to: [time] }];
    title = `Prefer ${time} workouts`;
    action = `set your preferred workout time to ${time}`;
  } else if (experiment.variable === 'workout_duration') {
    const { maxMinutes, minMinutes } = winner.parameters;
    const current = ctx.profile.availableMinutes;
    let target: number;
    if (typeof maxMinutes === 'number') {
      const shorter = DURATION_OPTIONS.filter((d) => d <= maxMinutes);
      target = shorter.length ? shorter[shorter.length - 1] : DURATION_OPTIONS[0];
      if (target >= current) return skip('already_configured');
    } else if (typeof minMinutes === 'number') {
      target = DURATION_OPTIONS.find((d) => d >= minMinutes) ?? DURATION_OPTIONS[DURATION_OPTIONS.length - 1];
      if (target <= current) return skip('already_configured');
    } else {
      return skip('no_rule');
    }
    changes = [{ parameter: 'workout_duration', from: current, to: target }];
    title = `Change workout length to ${target} minutes`;
    action = `change your workout length to ${target} minutes`;
  } else {
    return skip('no_rule');
  }

  if (changes.every((c) => JSON.stringify(c.from) === JSON.stringify(c.to))) return skip('already_configured');
  if (violatesRestrictions(changes, ctx.constraints, ctx.library).length > 0) return skip('violates_constraints');

  return {
    kind: 'proposal',
    draft: {
      title,
      rationale: `${observation} The ${winner.label.split(' (')[0].toLowerCase()} option scored higher, so the suggestion is to ${action}.`,
      significance: proposalSignificance(changes),
      changes,
      experimentId: experiment.id,
      resultComputedAt: result.computedAt,
      isSimulated: experiment.isSimulated,
    },
  };
}

/* ---------- lifecycle ---------- */

export type AdaptationAction = 'accept' | 'decline' | 'apply' | 'auto_apply';
export class AdaptationTransitionError extends Error {
  override name = 'AdaptationTransitionError';
}

/**
 * pending → accepted | declined | auto_applied (minor + safe + real data only);
 * accepted → applied. A significant change can therefore only be applied after the user accepted it.
 */
export function transitionProposal(p: AdaptationProposal, action: AdaptationAction, now: Date, appliedWorkoutId: string | null = null): AdaptationProposal {
  const at = now.toISOString();
  if (action === 'accept' && p.status === 'pending') return { ...p, status: 'accepted', decidedAt: at };
  if (action === 'decline' && p.status === 'pending') return { ...p, status: 'declined', decidedAt: at };
  if (action === 'apply' && p.status === 'accepted') return { ...p, status: 'applied', appliedAt: at, appliedWorkoutId };
  if (action === 'auto_apply' && p.status === 'pending') {
    if (!canAutoApply(p)) throw new AdaptationTransitionError('This change needs your approval and cannot be applied automatically');
    return { ...p, status: 'auto_applied', decidedAt: at, appliedAt: at, appliedWorkoutId };
  }
  throw new AdaptationTransitionError(`Cannot ${action.replace('_', '-')} a proposal that is ${p.status.replace('_', ' ')}`);
}

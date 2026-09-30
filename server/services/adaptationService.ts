import { randomUUID } from 'node:crypto';
import {
  AdaptationApplyError,
  AdaptationTransitionError,
  applyChangesToProfile,
  canAutoApply,
  isOpen,
  isStale,
  type ProposalDraft,
  proposeFromExperiment,
  transitionProposal,
} from '../../shared/adaptation/engine.ts';
import { exerciseLibrary } from '../../shared/exercises/library.ts';
import type { AdaptationProposal, SkipReason } from '../../shared/schemas/adaptation.ts';
import { type ProfileInput, type ProfileResponse, profileInputSchema } from '../../shared/schemas/profile.ts';
import type { Workout } from '../../shared/schemas/workout.ts';
import { generateWorkout, WorkoutGenerationError } from '../../shared/workout/generate.ts';
import { personalize } from '../../shared/workout/personalize.ts';
import { type Database, withTransaction } from '../db/database.ts';
import { AppError } from '../errors.ts';
import {
  getProposal,
  insertProposal,
  listProposals,
  proposalForExperiment,
  replaceProposalContent,
  saveTransition,
} from '../repositories/adaptationRepository.ts';
import { getExperiment, getResult, listExperiments } from '../repositories/experimentRepository.ts';
import { getProfile, writeProfile } from '../repositories/profileRepository.ts';
import { insertWorkout } from '../repositories/workoutRepository.ts';

/**
 * Closes the adaptive loop: experiment result → proposal → user approval →
 * updated configuration (the profile) → next workout. Deterministic; no LLM.
 * Restrictions are never modified: only duration, timing and frequency are
 * configurable here, and the next workout goes through the normal
 * personalization filters.
 *
 * Applying is atomic: the profile update, the new workout and the proposal's
 * status change are written in ONE transaction. If anything fails, nothing
 * changes and the proposal stays open, so retrying is safe.
 */

export const STALE_MESSAGE =
  'Your settings changed since this was proposed. Update the proposal to your current settings, or decline it.';

const SKIP_EXPLANATION: Record<SkipReason, string> = {
  insufficient_evidence: 'the experiment no longer has enough data',
  no_clear_difference: 'the options no longer differ clearly',
  no_rule: 'there is no adaptation rule for this experiment',
  already_configured: 'your settings already match the better option',
  already_proposed: 'it was already handled',
  violates_constraints: 'it would conflict with your restrictions',
};

function requireProfile(db: Database): ProfileResponse {
  const profile = getProfile(db);
  if (!profile) throw new AppError(409, 'conflict', 'Create a profile first');
  return profile;
}

function profileToInput({ profile, constraints }: ProfileResponse): ProfileInput {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = profile;
  return { profile: rest, constraints: { restrictionTags: constraints.restrictionTags, notes: constraints.notes, source: constraints.source } };
}

function requireProposal(db: Database, id: string): AdaptationProposal {
  const p = getProposal(db, id);
  if (!p) throw new AppError(404, 'not_found', `Adaptation proposal "${id}" not found`);
  return p;
}

function guarded<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof AdaptationTransitionError) throw new AppError(409, 'conflict', err.message);
    throw err;
  }
}

export function listWithStaleness(db: Database) {
  const { profile } = requireProfile(db);
  return listProposals(db, profile.id).map((proposal) => ({
    proposal,
    // Only open proposals can be stale; finished ones are history.
    stale: isOpen(proposal) && isStale(profile, proposal.changes),
  }));
}

/**
 * Apply a proposal: validate, compute the next workout from the changed
 * configuration, then write profile + workout + proposal status atomically.
 * Pure checks run first (stale settings → 409, unworkable configuration → 422),
 * so failures before the write change nothing; failures during the write roll back.
 */
function applyToPlan(db: Database, proposal: AdaptationProposal, mode: 'approve' | 'auto_apply', now: Date) {
  const current = requireProfile(db);
  if (isStale(current.profile, proposal.changes)) throw new AppError(409, 'conflict', STALE_MESSAGE);

  let next: ProfileInput;
  let plan: ReturnType<typeof generateWorkout>;
  try {
    next = profileInputSchema.parse(applyChangesToProfile(profileToInput(current), proposal.changes));
    const candidate = { ...current.profile, ...next.profile };
    plan = generateWorkout(personalize(candidate, current.constraints, exerciseLibrary), exerciseLibrary, 0);
  } catch (err) {
    if (err instanceof AdaptationApplyError || err instanceof WorkoutGenerationError) {
      throw new AppError(422, 'unprocessable', `This change cannot be applied: ${err.message}`);
    }
    throw err;
  }

  return withTransaction(db, () => {
    writeProfile(db, next);
    const workout: Workout = insertWorkout(db, current.profile.id, plan);
    const applied = guarded(() => transitionProposal(proposal, mode, now, workout.id));
    saveTransition(db, applied);
    return { proposal: applied, workout };
  });
}

/**
 * The user's explicit "accept and apply" for an open proposal, done atomically.
 * On any failure the proposal is left exactly as it was (still open) and can be
 * retried, updated (if stale) or declined.
 */
export function approveProposal(db: Database, id: string, now = new Date()) {
  const proposal = requireProposal(db, id);
  guarded(() => transitionProposal(proposal, 'approve', now)); // valid from this state?
  return applyToPlan(db, proposal, 'approve', now);
}

export function declineProposal(db: Database, id: string, now = new Date()): AdaptationProposal {
  const next = guarded(() => transitionProposal(requireProposal(db, id), 'decline', now));
  saveTransition(db, next);
  return next;
}

function fromDraft(d: ProposalDraft, base: Pick<AdaptationProposal, 'id' | 'userId'>, now: Date): AdaptationProposal {
  return {
    ...base,
    experimentId: d.experimentId,
    analysisReportId: null,
    title: d.title,
    significance: d.significance,
    status: 'pending',
    changes: d.changes,
    rationale: d.rationale,
    isSimulated: d.isSimulated,
    resultComputedAt: d.resultComputedAt,
    createdAt: now.toISOString(),
    decidedAt: null,
    appliedAt: null,
    appliedWorkoutId: null,
  };
}

/**
 * Re-derive a stale proposal from the same experiment result against the
 * CURRENT settings, replacing it in place (same id: still one proposal per
 * experiment). If the rule no longer proposes anything, the proposal is left
 * open with an explanation, so the user can decline it.
 */
export function refreshProposal(db: Database, id: string, now = new Date()): AdaptationProposal {
  const proposal = requireProposal(db, id);
  if (!isOpen(proposal)) throw new AppError(409, 'conflict', 'Only open proposals can be updated');
  const current = requireProfile(db);
  if (!isStale(current.profile, proposal.changes)) throw new AppError(409, 'conflict', 'This proposal is already up to date');

  const experiment = proposal.experimentId ? getExperiment(db, proposal.experimentId) : null;
  if (!experiment) throw new AppError(409, 'conflict', 'The experiment behind this proposal no longer exists. Decline it.');
  const outcome = proposeFromExperiment(experiment, getResult(db, experiment.id), {
    profile: current.profile,
    constraints: current.constraints,
    library: exerciseLibrary,
  });
  if (outcome.kind === 'skipped') {
    throw new AppError(409, 'conflict', `No updated proposal: ${SKIP_EXPLANATION[outcome.reason]}. You can decline this one.`);
  }
  const refreshed = fromDraft(outcome.draft, proposal, now);
  replaceProposalContent(db, refreshed);
  return refreshed;
}

/**
 * Create proposals from completed experiments that do not have one yet (one per
 * experiment). Minor, safe changes based on real data are then applied
 * automatically; if that fails it is rolled back and the proposal stays pending.
 */
export function generateProposals(db: Database, now = new Date(), log: (message: string) => void = () => {}) {
  const { profile } = requireProfile(db);
  const created: AdaptationProposal[] = [];
  const skipped: { experimentId: string; reason: SkipReason }[] = [];

  for (const experiment of listExperiments(db, profile.id).reverse()) {
    if (experiment.status !== 'completed' && experiment.status !== 'ended_early') continue;
    if (proposalForExperiment(db, experiment.id)) {
      skipped.push({ experimentId: experiment.id, reason: 'already_proposed' });
      continue;
    }
    // Re-read the profile: an auto-applied proposal may already have changed it.
    const latest = requireProfile(db);
    const outcome = proposeFromExperiment(experiment, getResult(db, experiment.id), {
      profile: latest.profile,
      constraints: latest.constraints,
      library: exerciseLibrary,
    });
    if (outcome.kind === 'skipped') {
      skipped.push({ experimentId: experiment.id, reason: outcome.reason });
      continue;
    }
    let proposal = fromDraft(outcome.draft, { id: randomUUID(), userId: profile.id }, now);
    insertProposal(db, proposal);
    if (canAutoApply(proposal)) {
      try {
        proposal = applyToPlan(db, proposal, 'auto_apply', now).proposal;
      } catch (err) {
        // Rolled back: the proposal stays pending for the user to approve or decline.
        log(`auto-apply rolled back for proposal ${proposal.id}: ${err instanceof Error ? err.message : 'unknown error'}`);
      }
    }
    created.push(proposal);
  }
  return { created, skipped };
}

import { randomUUID } from 'node:crypto';
import {
  AdaptationApplyError,
  AdaptationTransitionError,
  applyChangesToProfile,
  canAutoApply,
  isStale,
  proposeFromExperiment,
  transitionProposal,
} from '../../shared/adaptation/engine.ts';
import { exerciseLibrary } from '../../shared/exercises/library.ts';
import type { AdaptationProposal, SkipReason } from '../../shared/schemas/adaptation.ts';
import { type ProfileInput, type ProfileResponse, profileInputSchema } from '../../shared/schemas/profile.ts';
import type { Workout } from '../../shared/schemas/workout.ts';
import { generateWorkout, WorkoutGenerationError } from '../../shared/workout/generate.ts';
import { personalize } from '../../shared/workout/personalize.ts';
import type { Database } from '../db/database.ts';
import { AppError } from '../errors.ts';
import { getProposal, insertProposal, listProposals, proposalForExperiment, saveTransition } from '../repositories/adaptationRepository.ts';
import { getResult, listExperiments } from '../repositories/experimentRepository.ts';
import { getProfile, saveProfile } from '../repositories/profileRepository.ts';
import { insertWorkout } from '../repositories/workoutRepository.ts';

/**
 * Closes the adaptive loop: experiment result → proposal → user approval →
 * updated configuration (the profile) → next workout. Deterministic; no LLM.
 * Restrictions are never modified: only duration, timing and frequency are
 * configurable here, and the next workout goes through the normal
 * personalization filters.
 */

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
    stale: (proposal.status === 'pending' || proposal.status === 'accepted') && isStale(profile, proposal.changes),
  }));
}

/**
 * Apply a proposal's changes to the profile and generate the next workout.
 * The workout is generated from the *changed* configuration before anything is
 * written, so a configuration that cannot produce a valid workout (e.g. given
 * the user's equipment and restrictions) changes nothing.
 */
function applyToPlan(db: Database, proposal: AdaptationProposal, mode: 'apply' | 'auto_apply', now: Date) {
  const current = requireProfile(db);
  if (isStale(current.profile, proposal.changes)) {
    throw new AppError(409, 'conflict', 'Your settings changed since this was proposed. Decline it and check for adaptations again.');
  }

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

  saveProfile(db, next);
  const workout: Workout = insertWorkout(db, current.profile.id, plan);
  const applied = transitionProposal(proposal, mode, now, workout.id);
  saveTransition(db, applied);
  return { proposal: applied, workout };
}

export function acceptProposal(db: Database, id: string, now = new Date()): AdaptationProposal {
  const next = guarded(() => transitionProposal(requireProposal(db, id), 'accept', now));
  saveTransition(db, next);
  return next;
}

export function declineProposal(db: Database, id: string, now = new Date()): AdaptationProposal {
  const next = guarded(() => transitionProposal(requireProposal(db, id), 'decline', now));
  saveTransition(db, next);
  return next;
}

/** Apply an accepted proposal. Only accepted proposals can be applied. */
export function applyProposal(db: Database, id: string, now = new Date()) {
  const proposal = requireProposal(db, id);
  guarded(() => transitionProposal(proposal, 'apply', now)); // validate the transition before doing any work
  return applyToPlan(db, proposal, 'apply', now);
}

/**
 * Create proposals from completed experiments that do not have one yet.
 * Minor, safe changes based on real data are applied automatically; everything
 * else waits for the user.
 */
export function generateProposals(db: Database, now = new Date()) {
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
    const d = outcome.draft;
    let proposal: AdaptationProposal = {
      id: randomUUID(),
      userId: profile.id,
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
    insertProposal(db, proposal);
    if (canAutoApply(proposal)) {
      try {
        proposal = applyToPlan(db, proposal, 'auto_apply', now).proposal;
      } catch (err) {
        // Stays pending for the user to review; auto-apply is best-effort.
        if (!(err instanceof AppError)) throw err;
      }
    }
    created.push(proposal);
  }
  return { created, skipped };
}

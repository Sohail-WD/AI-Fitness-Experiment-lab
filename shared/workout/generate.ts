import type { Goal } from '../schemas/common.ts';
import type { ExerciseDefinition, MovementPattern } from '../schemas/exercise.ts';
import type { Workout, WorkoutItem, WorkoutRequirements } from '../schemas/workout.ts';
import { EQUIPMENT_LABEL, GOAL_LABEL, LEVEL_LABEL, LOCATION_LABEL, RESTRICTION_LABEL } from './labels.ts';

/**
 * Workout generator (spec §6): WorkoutRequirements + exercise library + seed →
 * structured workout. Deterministic for a given seed; a new seed gives a
 * variation. Only exercises the personalization engine marked eligible are used.
 */

export type WorkoutPlan = Pick<Workout, 'title' | 'rationale' | 'seed' | 'requirements' | 'items' | 'estimatedMinutes'>;

export class WorkoutGenerationError extends Error {
  override name = 'WorkoutGenerationError';
}

/** Setup/transition time between exercises, seconds. */
export const TRANSITION_SECONDS = 20;
const MIN_MAIN_SETS = 2;

/** Main-block slots in order; each slot accepts any of its patterns (first = preferred). */
const STRENGTH_SLOTS: MovementPattern[][] = [
  ['squat', 'lunge'], ['push'], ['hinge'], ['pull'], ['press'], ['lunge', 'squat'], ['curl'], ['core'],
];
const GENERAL_SLOTS: MovementPattern[][] = [
  ['squat', 'lunge'], ['push'], ['pull'], ['hinge'], ['lunge', 'squat'], ['press'], ['core'], ['cardio'],
];
const CONDITIONING_SLOTS: MovementPattern[][] = [
  ['cardio'], ['squat', 'lunge'], ['push'], ['cardio'], ['lunge', 'squat'], ['pull'], ['core'], ['hinge'], ['cardio'],
];

function slotsFor(goal: Goal): MovementPattern[][] {
  if (['strength', 'muscle_building', 'explosive_strength', 'sport_performance'].includes(goal)) return STRENGTH_SLOTS;
  if (goal === 'endurance' || goal === 'weight_management') return CONDITIONING_SLOTS;
  return GENERAL_SLOTS;
}

/** Small deterministic PRNG (mulberry32). */
function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Estimated seconds for one workout item, including the transition to the next exercise. */
export function estimateItemSeconds(item: Pick<WorkoutItem, 'sets' | 'target' | 'restSeconds'>, exercise: ExerciseDefinition): number {
  const sides = exercise.perSide ? 2 : 1;
  const work = item.target.type === 'reps' ? item.target.reps * exercise.secondsPerRep * sides : item.target.seconds * sides;
  return item.sets * work + (item.sets - 1) * item.restSeconds + TRANSITION_SECONDS;
}

export function estimateWorkoutSeconds(items: readonly WorkoutItem[], library: readonly ExerciseDefinition[]): number {
  return items.reduce((sum, item) => {
    const exercise = library.find((e) => e.id === item.exerciseId);
    if (!exercise) throw new WorkoutGenerationError(`Unknown exercise "${item.exerciseId}"`);
    return sum + estimateItemSeconds(item, exercise);
  }, 0);
}

type Draft = Omit<WorkoutItem, 'order'>;

export function generateWorkout(
  requirements: WorkoutRequirements,
  library: readonly ExerciseDefinition[],
  seed = 0,
): WorkoutPlan {
  const rng = createRng(seed);
  const goal = requirements.goals[0];
  const params = requirements.trainingParameters;
  const budget = requirements.targetDurationMinutes * 60;
  const eligible = library.filter((e) => requirements.eligibleExerciseIds.includes(e.id));
  const byId = new Map(eligible.map((e) => [e.id, e]));
  const seconds = (d: Draft) => estimateItemSeconds(d, byId.get(d.exerciseId)!);
  const used = new Set<string>();

  const mainCandidates = eligible.filter((e) => e.roles.includes('main'));
  if (mainCandidates.length === 0) {
    throw new WorkoutGenerationError('No exercises match your equipment, level and restrictions.');
  }

  // Warm-up and cool-down: short, single-set, timed.
  const short = requirements.targetDurationMinutes <= 15;
  const pickTimed = (role: 'warmup' | 'cooldown', count: number, holdSeconds: number): Draft[] =>
    eligible
      .filter((e) => e.roles.includes(role) && !used.has(e.id))
      .map((e) => ({ e, key: rng() }))
      .sort((a, b) => a.key - b.key)
      .slice(0, count)
      .map(({ e }) => {
        used.add(e.id);
        return { exerciseId: e.id, section: role, sets: 1, target: { type: 'duration', seconds: holdSeconds }, restSeconds: 0 };
      });
  const warmup = pickTimed('warmup', short ? 1 : 2, short ? 45 : 60);
  const cooldown = pickTimed('cooldown', short ? 1 : 2, 30);

  let remaining = budget - [...warmup, ...cooldown].reduce((s, d) => s + seconds(d), 0);

  const mainDraft = (e: ExerciseDefinition, sets: number): Draft => ({
    exerciseId: e.id,
    section: 'main',
    sets,
    target:
      e.targetType === 'reps'
        ? { type: 'reps', reps: Math.round((params.repsMin + params.repsMax) / 2) }
        : { type: 'duration', seconds: params.holdSeconds },
    restSeconds: params.restSeconds,
  });

  // Fill slots in order; reduce sets (not below the minimum) to fit, else skip the slot.
  const main: Draft[] = [];
  for (const patterns of slotsFor(goal)) {
    const candidates = mainCandidates.filter((e) => patterns.includes(e.movementPattern) && !used.has(e.id));
    if (candidates.length === 0) continue;
    const score = (e: ExerciseDefinition) =>
      (e.applicableGoals.includes(goal) ? 2 : 0) + (e.movementPattern === patterns[0] ? 1 : 0) + rng() * 0.99;
    const choice = candidates.map((e) => ({ e, s: score(e) })).sort((a, b) => b.s - a.s)[0].e;

    for (let sets = params.sets; sets >= MIN_MAIN_SETS; sets--) {
      const draft = mainDraft(choice, sets);
      if (seconds(draft) <= remaining) {
        main.push(draft);
        used.add(choice.id);
        remaining -= seconds(draft);
        break;
      }
    }
  }

  // Very short sessions: guarantee at least one main exercise by dropping warm-up/cool-down time.
  if (main.length === 0) {
    const first = mainCandidates.find((e) => !used.has(e.id)) ?? mainCandidates[0];
    const draft = mainDraft(first, MIN_MAIN_SETS);
    while (seconds(draft) > remaining && (cooldown.length > 0 || warmup.length > 0)) {
      const dropped = cooldown.length > 0 ? cooldown.pop()! : warmup.pop()!;
      remaining += seconds(dropped);
    }
    if (seconds(draft) > remaining) throw new WorkoutGenerationError('The session is too short for any eligible exercise.');
    main.push(draft);
    remaining -= seconds(draft);
  }

  // Use leftover time: add sets round-robin, up to two above the prescription.
  let added = true;
  while (added) {
    added = false;
    for (const draft of main) {
      if (draft.sets >= params.sets + 2) continue;
      const extra = seconds({ ...draft, sets: draft.sets + 1 }) - seconds(draft);
      if (extra <= remaining) {
        draft.sets += 1;
        remaining -= extra;
        added = true;
      }
    }
  }

  const items: WorkoutItem[] = [...warmup, ...main, ...cooldown].map((d, order) => ({ ...d, order }));
  const estimatedSeconds = estimateWorkoutSeconds(items, eligible);
  const estimatedMinutes = Math.max(1, Math.ceil(estimatedSeconds / 60));

  return {
    title: `${GOAL_LABEL[goal]} workout · ${LEVEL_LABEL[requirements.fitnessLevel]}`,
    rationale: buildRationale(requirements, library, items, estimatedMinutes),
    seed,
    requirements,
    items,
    estimatedMinutes,
  };
}

function buildRationale(
  req: WorkoutRequirements,
  library: readonly ExerciseDefinition[],
  items: readonly WorkoutItem[],
  estimatedMinutes: number,
): string[] {
  const goal = req.goals[0];
  const p = req.trainingParameters;
  const name = (id: string) => library.find((e) => e.id === id)?.name ?? id;
  const mainCount = items.filter((i) => i.section === 'main').length;
  const lines: string[] = [];

  lines.push(
    `Goal: ${GOAL_LABEL[goal].toLowerCase()}. Main exercises use about ${p.repsMin}–${p.repsMax} reps (or ${p.holdSeconds} s intervals) with ${p.restSeconds} s rest between sets.`,
  );

  const contextNote =
    req.trainingContext === 'sedentary'
      ? ' Volume and difficulty are reduced because you are currently sedentary.'
      : req.trainingContext === 'athletic'
        ? ' Timed intervals are longer for your athletic background.'
        : '';
  lines.push(`Exercise difficulty matched to your ${LEVEL_LABEL[req.fitnessLevel].toLowerCase()} level.${contextNote}`);

  const usedEquipment = [
    ...new Set(items.flatMap((i) => library.find((e) => e.id === i.exerciseId)?.requiredEquipment ?? [])),
  ];
  lines.push(
    usedEquipment.length === 0
      ? 'Bodyweight only: no equipment needed.'
      : `Uses equipment you have: ${usedEquipment.map((e) => EQUIPMENT_LABEL[e].toLowerCase()).join(', ')}.`,
  );

  lines.push(
    `Estimated ${estimatedMinutes} min, within your ${req.targetDurationMinutes}-minute session: ${mainCount} main exercise${mainCount === 1 ? '' : 's'} plus warm-up and cool-down.`,
  );

  const spaceExcluded = req.exclusions.filter((x) => x.reason === 'space');
  lines.push(
    `Planned for training at ${LOCATION_LABEL[req.location].toLowerCase()}.` +
      (spaceExcluded.length > 0 ? ` Left out for space: ${spaceExcluded.map((x) => name(x.exerciseId)).join(', ')}.` : ''),
  );

  if (req.restrictions.length > 0) {
    const excluded = req.exclusions.filter((x) => x.reason === 'restriction').map((x) => name(x.exerciseId));
    lines.push(
      `Your movement restrictions (${req.restrictions.map((r) => RESTRICTION_LABEL[r].toLowerCase()).join(', ')}) excluded: ${
        excluded.length > 0 ? excluded.join(', ') : 'nothing in the current library'
      }. Restrictions are applied exactly as you entered them; this is not medical advice.`,
    );
  }

  if (req.workoutsPerWeek >= 5) lines.push('Per-session volume is slightly lower because you train 5 or more days a week.');
  return lines;
}

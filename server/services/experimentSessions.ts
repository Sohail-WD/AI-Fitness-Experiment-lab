import { type ExperimentSession, nextCondition } from '../../shared/experiments/engine.ts';
import { PREFERRED_TIME_PREFIX } from '../../shared/workout/generate.ts';
import { countGenuineSets } from '../../shared/metrics/completion.ts';
import { summarizeSession } from '../../shared/metrics/history.ts';
import type { Experiment } from '../../shared/schemas/experiment.ts';
import type { WorkoutAssignment, WorkoutItem } from '../../shared/schemas/workout.ts';
import type { Database } from '../db/database.ts';
import { listExperiments } from '../repositories/experimentRepository.ts';
import { listSessions } from '../repositories/historyRepository.ts';

const DAY_MS = 86_400_000;

interface WorkoutRow {
  id: string;
  estimated_minutes: number;
  items: string;
  experiment_id: string | null;
  condition_id: string | null;
}

/** Every session as the experiment engine sees it: summary, assignment and genuine MAIN-set count. */
export function experimentSessions(db: Database, userId: string): ExperimentSession[] {
  const rows = db
    .prepare('SELECT id, estimated_minutes, items, experiment_id, condition_id FROM workouts WHERE user_id = ?')
    .all(userId) as unknown as WorkoutRow[];
  const workouts = new Map(rows.map((r) => [r.id, r]));

  return listSessions(db, userId, 'all').map(({ session, title }) => {
    const workout = workouts.get(session.workoutId);
    const items = workout ? (JSON.parse(workout.items) as Pick<WorkoutItem, 'exerciseId' | 'sets' | 'target' | 'section'>[]) : [];
    return {
      summary: summarizeSession(session, title),
      workoutMinutes: workout?.estimated_minutes ?? 0,
      assignment:
        workout?.experiment_id && (workout.condition_id === 'A' || workout.condition_id === 'B')
          ? { experimentId: workout.experiment_id, conditionId: workout.condition_id }
          : null,
      // Warm-up and cool-down alone are not an observation: real work on at least one main exercise is required.
      genuineSets: countGenuineSets(session.metrics?.sets ?? [], items.filter((i) => i.section === 'main')),
    };
  });
}

export interface ActiveAssignment {
  experiment: Experiment;
  condition: Experiment['conditions'][number];
  assignment: WorkoutAssignment;
  /** "Why this workout?" line explaining the assignment. */
  rationale: string;
}

/**
 * The condition the next generated workout belongs to, if a real experiment is
 * running and still inside its planned period (afterwards its sessions would not count).
 */
export function activeAssignment(db: Database, userId: string, now: Date): ActiveAssignment | null {
  const experiment = listExperiments(db, userId).find((e) => e.status === 'active' && !e.isSimulated);
  if (!experiment?.startedAt) return null;
  if (now.getTime() >= Date.parse(experiment.startedAt) + experiment.plannedDurationDays * DAY_MS) return null;

  const id = nextCondition(experiment, experimentSessions(db, userId), now);
  const condition = experiment.conditions.find((c) => c.id === id)!;
  const how =
    typeof condition.parameters.timeOfDay === 'string'
      ? 'Do this workout inside that time window: a session started at another time is not counted in the experiment.'
      : 'This workout is built to that length so the two options can be compared.';
  return {
    experiment,
    condition,
    assignment: { experimentId: experiment.id, conditionId: condition.id, label: condition.label },
    rationale: `Experiment assignment: condition ${condition.id}, ${condition.label}. ${how}`,
  };
}

/**
 * "Why this workout?" for an assigned workout: appends the assignment line and, when a
 * time-of-day assignment conflicts with the profile's preferred time, replaces the
 * preferred-time line with an explanation of which one applies. Assignment itself is
 * never influenced by the preference (that would undo the A/B design).
 */
export function explainAssignment(rationale: readonly string[], assigned: ActiveAssignment, preferredTimes: readonly string[]): string[] {
  const time = assigned.condition.parameters.timeOfDay;
  const conflicts = typeof time === 'string' && preferredTimes.length > 0 && !preferredTimes.includes(time);
  const lines = conflicts
    ? rationale.map((line) =>
        line.startsWith(PREFERRED_TIME_PREFIX)
          ? `Your experiment assignment (${assigned.condition.label.split(' (')[0]}) takes priority over your preferred time (${preferredTimes.join(' or ')}) while the experiment runs.`
          : line,
      )
    : [...rationale];
  return [...lines, assigned.rationale];
}

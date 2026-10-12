import { randomUUID } from 'node:crypto';
import { type Workout, type WorkoutAssignment, workoutSchema } from '../../shared/schemas/workout.ts';
import type { WorkoutPlan } from '../../shared/workout/generate.ts';
import type { Database } from '../db/database.ts';
import { AppError } from '../errors.ts';

interface WorkoutRow {
  id: string;
  user_id: string;
  title: string;
  rationale: string;
  seed: number;
  requirements: string;
  items: string;
  scheduled_for: string | null;
  estimated_minutes: number;
  created_at: string;
  experiment_id: string | null;
  condition_id: string | null;
  condition_label: string | null;
}

function toWorkout(row: WorkoutRow): Workout {
  const parsed = workoutSchema.safeParse({
    id: row.id,
    userId: row.user_id,
    title: row.title,
    rationale: JSON.parse(row.rationale),
    seed: row.seed,
    requirements: JSON.parse(row.requirements),
    items: JSON.parse(row.items),
    scheduledFor: row.scheduled_for,
    assignment:
      row.experiment_id && row.condition_id
        ? { experimentId: row.experiment_id, conditionId: row.condition_id, label: row.condition_label ?? row.condition_id }
        : null,
    estimatedMinutes: row.estimated_minutes,
    createdAt: row.created_at,
  });
  if (!parsed.success) throw new AppError(500, 'internal_error', 'Stored workout is invalid');
  return parsed.data;
}

export function insertWorkout(db: Database, userId: string, plan: WorkoutPlan, assignment: WorkoutAssignment | null = null): Workout {
  const workout = workoutSchema.parse({
    ...plan,
    id: randomUUID(),
    userId,
    scheduledFor: null,
    assignment,
    createdAt: new Date().toISOString(),
  });
  db.prepare(
    `INSERT INTO workouts (id, user_id, title, rationale, seed, requirements, items, scheduled_for, estimated_minutes, created_at, experiment_id, condition_id, condition_label)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    workout.id,
    workout.userId,
    workout.title,
    JSON.stringify(workout.rationale),
    workout.seed,
    JSON.stringify(workout.requirements),
    JSON.stringify(workout.items),
    workout.scheduledFor,
    workout.estimatedMinutes,
    workout.createdAt,
    assignment?.experimentId ?? null,
    assignment?.conditionId ?? null,
    assignment?.label ?? null,
  );
  return workout;
}

export function getLatestWorkout(db: Database, userId: string): Workout | null {
  const row = db
    .prepare('SELECT * FROM workouts WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
    .get(userId) as WorkoutRow | undefined;
  return row ? toWorkout(row) : null;
}

export function getWorkout(db: Database, id: string, userId: string): Workout | null {
  const row = db.prepare('SELECT * FROM workouts WHERE id = ? AND user_id = ?').get(id, userId) as WorkoutRow | undefined;
  return row ? toWorkout(row) : null;
}

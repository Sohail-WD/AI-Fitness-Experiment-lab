import { randomUUID } from 'node:crypto';
import { type Workout, workoutSchema } from '../../shared/schemas/workout.ts';
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
    estimatedMinutes: row.estimated_minutes,
    createdAt: row.created_at,
  });
  if (!parsed.success) throw new AppError(500, 'internal_error', 'Stored workout is invalid');
  return parsed.data;
}

export function insertWorkout(db: Database, userId: string, plan: WorkoutPlan): Workout {
  const workout = workoutSchema.parse({
    ...plan,
    id: randomUUID(),
    userId,
    scheduledFor: null,
    createdAt: new Date().toISOString(),
  });
  db.prepare(
    `INSERT INTO workouts (id, user_id, title, rationale, seed, requirements, items, scheduled_for, estimated_minutes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  );
  return workout;
}

export function getLatestWorkout(db: Database, userId: string): Workout | null {
  const row = db
    .prepare('SELECT * FROM workouts WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
    .get(userId) as WorkoutRow | undefined;
  return row ? toWorkout(row) : null;
}

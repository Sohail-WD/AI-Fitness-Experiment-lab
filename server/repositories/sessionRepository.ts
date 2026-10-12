import { randomUUID } from 'node:crypto';
import { genuineCompletionRatio } from '../../shared/metrics/completion.ts';
import type { PerformanceMetrics } from '../../shared/schemas/metrics.ts';
import {
  type PostWorkoutFeedback,
  type SessionEventInput,
  type WorkoutItem,
  type WorkoutSession,
  workoutSessionSchema,
} from '../../shared/schemas/workout.ts';
import type { Database } from '../db/database.ts';
import { AppError } from '../errors.ts';

interface SessionRow {
  id: string;
  workout_id: string;
  user_id: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  is_simulated: number;
  feedback: string | null;
  metrics: string | null;
}

/** A session of this user, or null (another user's session is indistinguishable from a missing one). */
export function getSession(db: Database, id: string, userId: string): WorkoutSession | null {
  const row = db.prepare('SELECT * FROM workout_sessions WHERE id = ? AND user_id = ?').get(id, userId) as SessionRow | undefined;
  if (!row) return null;
  const parsed = workoutSessionSchema.safeParse({
    id: row.id,
    workoutId: row.workout_id,
    userId: row.user_id,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    isSimulated: row.is_simulated === 1,
    feedback: row.feedback ? JSON.parse(row.feedback) : null,
    metrics: row.metrics ? JSON.parse(row.metrics) : null,
  });
  if (!parsed.success) throw new AppError(500, 'internal_error', 'Stored session is invalid');
  return parsed.data;
}

function requireSession(db: Database, userId: string, id: string, mustBeInProgress: boolean): WorkoutSession {
  const session = getSession(db, id, userId);
  if (!session) throw new AppError(404, 'not_found', `Session "${id}" not found`);
  if (mustBeInProgress && session.status !== 'in_progress') {
    throw new AppError(409, 'conflict', 'Session has already ended');
  }
  return session;
}

export function createSession(db: Database, userId: string, workoutId: string): WorkoutSession {
  const workout = db.prepare('SELECT user_id FROM workouts WHERE id = ? AND user_id = ?').get(workoutId, userId) as { user_id: string } | undefined;
  if (!workout) throw new AppError(404, 'not_found', `Workout "${workoutId}" not found`);
  const id = randomUUID();
  db.prepare(
    `INSERT INTO workout_sessions (id, workout_id, user_id, status, started_at, is_simulated) VALUES (?, ?, ?, 'in_progress', ?, 0)`,
  ).run(id, workoutId, userId, new Date().toISOString());
  return getSession(db, id, userId)!;
}

export function appendEvents(db: Database, userId: string, sessionId: string, events: SessionEventInput[]): number {
  requireSession(db, userId, sessionId, true);
  const insert = db.prepare(
    'INSERT INTO session_events (session_id, type, occurred_at, exercise_id, set_index, data) VALUES (?, ?, ?, ?, ?, ?)',
  );
  db.exec('BEGIN');
  try {
    for (const e of events) insert.run(sessionId, e.type, e.occurredAt, e.exerciseId, e.setIndex, JSON.stringify(e.data));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return events.length;
}

export function completeSession(
  db: Database,
  userId: string,
  sessionId: string,
  status: 'completed' | 'abandoned',
  metrics: PerformanceMetrics,
): WorkoutSession {
  const session = requireSession(db, userId, sessionId, true);
  if (metrics.sessionId !== sessionId) throw new AppError(400, 'validation_error', 'metrics.sessionId does not match');
  // The server owns completion: recomputed from the recorded sets and the workout plan (sets with no valid reps do not count).
  const row = db.prepare('SELECT items FROM workouts WHERE id = ?').get(session.workoutId) as { items: string } | undefined;
  const items = row ? (JSON.parse(row.items) as { exerciseId: string; sets: number; target: WorkoutItem['target'] }[]) : [];
  const verified: PerformanceMetrics = { ...metrics, completionRatio: genuineCompletionRatio(metrics.sets, items) };
  db.prepare('UPDATE workout_sessions SET status = ?, ended_at = ?, metrics = ? WHERE id = ? AND user_id = ?').run(
    status,
    new Date().toISOString(),
    JSON.stringify(verified),
    sessionId,
    userId,
  );
  return getSession(db, sessionId, userId)!;
}

export function saveFeedback(db: Database, userId: string, sessionId: string, feedback: PostWorkoutFeedback): WorkoutSession {
  requireSession(db, userId, sessionId, false);
  db.prepare('UPDATE workout_sessions SET feedback = ? WHERE id = ? AND user_id = ?').run(JSON.stringify(feedback), sessionId, userId);
  return getSession(db, sessionId, userId)!;
}

export function countEvents(db: Database, sessionId: string): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM session_events WHERE session_id = ?').get(sessionId) as { n: number }).n;
}

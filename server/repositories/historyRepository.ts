import type { DataSource } from '../../shared/schemas/history.ts';
import type { WorkoutSession } from '../../shared/schemas/workout.ts';
import type { Database } from '../db/database.ts';
import { getSession } from './sessionRepository.ts';

/** Sessions with their workout titles, oldest first, filtered by data source. */
export function listSessions(db: Database, userId: string, source: DataSource): { session: WorkoutSession; title: string }[] {
  const filter = source === 'real' ? 'AND s.is_simulated = 0' : source === 'simulated' ? 'AND s.is_simulated = 1' : '';
  const rows = db
    .prepare(
      `SELECT s.id, w.title FROM workout_sessions s JOIN workouts w ON w.id = s.workout_id
       WHERE s.user_id = ? ${filter} ORDER BY s.started_at, s.rowid`,
    )
    .all(userId) as { id: string; title: string }[];
  return rows.map((r) => ({ session: getSession(db, r.id)!, title: r.title }));
}

/** Replace all simulated sessions with the given ones (one transaction). Returns how many were removed. */
export function replaceSimulatedSessions(db: Database, userId: string, sessions: WorkoutSession[]): number {
  db.exec('BEGIN');
  try {
    const removed = deleteSimulated(db, userId);
    const insert = db.prepare(
      `INSERT INTO workout_sessions (id, workout_id, user_id, status, started_at, ended_at, is_simulated, feedback, metrics)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    );
    for (const s of sessions) {
      if (!s.isSimulated) throw new Error('Only simulated sessions can be seeded');
      insert.run(s.id, s.workoutId, s.userId, s.status, s.startedAt, s.endedAt, JSON.stringify(s.feedback), JSON.stringify(s.metrics));
    }
    db.exec('COMMIT');
    return removed;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function deleteSimulated(db: Database, userId: string): number {
  return Number(db.prepare('DELETE FROM workout_sessions WHERE user_id = ? AND is_simulated = 1').run(userId).changes);
}

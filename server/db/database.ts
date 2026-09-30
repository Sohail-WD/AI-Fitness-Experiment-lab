import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { exerciseLibrary } from '../../shared/exercises/library.ts';
import { exerciseDefinitionSchema } from '../../shared/schemas/exercise.ts';
import { type Migration, migrations as defaultMigrations } from './migrations.ts';

export type Database = DatabaseSync;

/** Open (creating if needed) the SQLite database, apply migrations, and seed the exercise library. */
export function openDatabase(path: string): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  runMigrations(db);
  seedExerciseLibrary(db);
  return db;
}

/** Apply pending migrations in order, each in its own transaction. Safe to call repeatedly. */
export function runMigrations(db: Database, migrations: readonly Migration[] = defaultMigrations): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version),
  );

  const newlyApplied: number[] = [];
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (applied.has(m.version)) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        m.version,
        m.name,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
      newlyApplied.push(m.version);
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return newlyApplied;
}

/** Upsert the shared exercise library, validating every definition first. */
export function seedExerciseLibrary(db: Database): void {
  const upsert = db.prepare(
    `INSERT INTO exercises (id, definition, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET definition = excluded.definition, updated_at = excluded.updated_at`,
  );
  const now = new Date().toISOString();
  for (const exercise of exerciseLibrary) {
    const valid = exerciseDefinitionSchema.parse(exercise);
    upsert.run(valid.id, JSON.stringify(valid), now);
  }
}

/**
 * Run `fn` in one transaction: commit if it returns, roll back everything if it
 * throws. Not re-entrant — code called inside must not start its own transaction.
 */
export function withTransaction<T>(db: Database, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function isDatabaseHealthy(db: Database): boolean {
  try {
    db.prepare('SELECT 1').get();
    return true;
  } catch {
    return false;
  }
}

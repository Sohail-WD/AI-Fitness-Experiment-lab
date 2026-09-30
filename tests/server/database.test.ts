import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Database, openDatabase, runMigrations } from '../../server/db/database';
import { migrations } from '../../server/db/migrations';
import { adaptationProposal, profile, USER_ID } from '../fixtures/contracts';

const EXPECTED_TABLES = [
  'adaptation_proposals',
  'analysis_reports',
  'exercises',
  'experiment_results',
  'experiments',
  'session_events',
  'user_constraints',
  'user_profiles',
  'workout_sessions',
  'workouts',
];

let db: Database;
beforeEach(() => {
  db = openDatabase(':memory:');
});
afterEach(() => db.close());

function insertProfile() {
  db.prepare(
    `INSERT INTO user_profiles (id, fitness_level, training_context, goals, equipment, environment, available_minutes, schedule, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    profile.id,
    profile.fitnessLevel,
    profile.trainingContext,
    JSON.stringify(profile.goals),
    JSON.stringify(profile.equipment),
    JSON.stringify(profile.environment),
    profile.availableMinutes,
    JSON.stringify(profile.schedule),
    profile.createdAt,
    profile.updatedAt,
  );
}

describe('database initialization', () => {
  it('creates every table and records the migration', () => {
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    expect(tables).toEqual([...EXPECTED_TABLES, 'schema_migrations'].sort());
    expect(db.prepare('SELECT version FROM schema_migrations').all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }]);
  });

  it('is idempotent: re-running migrations applies nothing', () => {
    expect(runMigrations(db)).toEqual([]);
  });

  it('rolls back a failing migration completely', () => {
    const broken = [...migrations, { version: 99, name: 'broken', sql: 'CREATE TABLE ok_table (id TEXT); CREATE TABLE (' }];
    expect(() => runMigrations(db, broken)).toThrow();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'ok_table'").get()).toBeUndefined();
    expect(db.prepare('SELECT version FROM schema_migrations WHERE version = 99').get()).toBeUndefined();
  });

  it('seeds the exercise library', () => {
    const row = db.prepare("SELECT definition FROM exercises WHERE id = 'squat'").get() as { definition: string };
    expect(JSON.parse(row.definition).cv.rep.bottomEnterDeg).toBe(15);
  });

  it('enforces foreign keys', () => {
    expect(() =>
      db
        .prepare(`INSERT INTO user_constraints (user_id, restriction_tags, source, updated_at) VALUES (?, '[]', 'self_reported', ?)`)
        .run('no-such-user', new Date().toISOString()),
    ).toThrow(/FOREIGN KEY/);
  });

  it('rejects invalid JSON in JSON columns', () => {
    insertProfile();
    expect(() =>
      db
        .prepare(`INSERT INTO user_constraints (user_id, restriction_tags, source, updated_at) VALUES (?, '{broken', 'self_reported', ?)`)
        .run(USER_ID, new Date().toISOString()),
    ).toThrow(/CHECK/);
  });

  it('refuses to store an auto-applied significant adaptation (spec §16.2)', () => {
    insertProfile();
    const insert = db.prepare(
      `INSERT INTO adaptation_proposals (id, user_id, significance, status, changes, rationale, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const p = adaptationProposal;
    expect(() => insert.run(p.id, USER_ID, 'significant', 'auto_applied', JSON.stringify(p.changes), p.rationale, p.createdAt)).toThrow(
      /CHECK/,
    );
    expect(() => insert.run(p.id, USER_ID, 'significant', 'pending', JSON.stringify(p.changes), p.rationale, p.createdAt)).not.toThrow();
  });

  it('cascades user deletion to dependent rows', () => {
    insertProfile();
    db.prepare(`INSERT INTO user_constraints (user_id, restriction_tags, source, updated_at) VALUES (?, '[]', 'self_reported', ?)`).run(
      USER_ID,
      profile.updatedAt,
    );
    db.prepare('DELETE FROM user_profiles WHERE id = ?').run(USER_ID);
    expect(db.prepare('SELECT COUNT(*) AS n FROM user_constraints').get()).toEqual({ n: 0 });
  });
});

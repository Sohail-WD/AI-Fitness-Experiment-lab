import { randomUUID } from 'node:crypto';
import {
  type ProfileInput,
  type ProfileResponse,
  profileResponseSchema,
} from '../../shared/schemas/profile.ts';
import type { Database } from '../db/database.ts';
import { AppError } from '../errors.ts';

/**
 * Single-user MVP: there is at most one profile. Saving updates it if it
 * exists, otherwise creates it. Stored JSON is re-validated on read.
 */

interface ProfileRow {
  id: string;
  name: string;
  fitness_level: string;
  training_context: string;
  goals: string;
  equipment: string;
  environment: string;
  available_minutes: number;
  schedule: string;
  created_at: string;
  updated_at: string;
  restriction_tags: string | null;
  notes: string | null;
  source: string | null;
  constraints_updated_at: string | null;
}

export function getProfile(db: Database): ProfileResponse | null {
  const row = db
    .prepare(
      `SELECT p.*, c.restriction_tags, c.notes, c.source, c.updated_at AS constraints_updated_at
       FROM user_profiles p LEFT JOIN user_constraints c ON c.user_id = p.id
       ORDER BY p.created_at LIMIT 1`,
    )
    .get() as ProfileRow | undefined;
  if (!row) return null;

  const parsed = profileResponseSchema.safeParse({
    profile: {
      id: row.id,
      name: row.name,
      fitnessLevel: row.fitness_level,
      goals: JSON.parse(row.goals),
      trainingContext: row.training_context,
      equipment: JSON.parse(row.equipment),
      environment: JSON.parse(row.environment),
      availableMinutes: row.available_minutes,
      schedule: JSON.parse(row.schedule),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    constraints: {
      userId: row.id,
      restrictionTags: row.restriction_tags ? JSON.parse(row.restriction_tags) : [],
      notes: row.notes ?? '',
      source: row.source ?? 'self_reported',
      updatedAt: row.constraints_updated_at ?? row.updated_at,
    },
  });
  if (!parsed.success) throw new AppError(500, 'internal_error', 'Stored profile is invalid');
  return parsed.data;
}

export function saveProfile(db: Database, input: ProfileInput): ProfileResponse {
  const existing = getProfile(db);
  const id = existing?.profile.id ?? randomUUID();
  const now = new Date().toISOString();
  const p = input.profile;
  const c = input.constraints;

  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO user_profiles (id, name, fitness_level, training_context, goals, equipment, environment, available_minutes, schedule, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name, fitness_level = excluded.fitness_level, training_context = excluded.training_context,
         goals = excluded.goals, equipment = excluded.equipment, environment = excluded.environment,
         available_minutes = excluded.available_minutes, schedule = excluded.schedule, updated_at = excluded.updated_at`,
    ).run(
      id,
      p.name,
      p.fitnessLevel,
      p.trainingContext,
      JSON.stringify(p.goals),
      JSON.stringify(p.equipment),
      JSON.stringify(p.environment),
      p.availableMinutes,
      JSON.stringify(p.schedule),
      existing?.profile.createdAt ?? now,
      now,
    );
    db.prepare(
      `INSERT INTO user_constraints (user_id, restriction_tags, notes, source, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         restriction_tags = excluded.restriction_tags, notes = excluded.notes, source = excluded.source, updated_at = excluded.updated_at`,
    ).run(id, JSON.stringify(c.restrictionTags), c.notes, c.source, now);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return getProfile(db)!;
}

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../server/app';
import { type Database, openDatabase } from '../../server/db/database';
import { apiErrorSchema } from '../../shared/schemas/api';
import { type ProfileInput, profileResponseSchema } from '../../shared/schemas/profile';
import { workoutSchema } from '../../shared/schemas/workout';
import { testConfig } from './helpers';

let db: Database;
let app: FastifyInstance;
beforeEach(() => {
  db = openDatabase(':memory:');
  app = buildApp({ config: testConfig, db });
});
afterEach(async () => {
  await app.close();
  db.close();
});

const input: ProfileInput = {
  profile: {
    name: 'Asha',
    fitnessLevel: 'intermediate',
    goals: ['strength'],
    trainingContext: 'regularly_training',
    equipment: ['dumbbells'],
    environment: { location: 'home' },
    availableMinutes: 30,
    schedule: { preferredDays: [], preferredTimes: [], workoutsPerWeek: 4 },
  },
  constraints: { restrictionTags: ['avoid_overhead_loading'], notes: 'Physio advice.', source: 'professional_advised' },
};

const put = (body: unknown) => app.inject({ method: 'PUT', url: '/api/profile', payload: body as object });
const generate = (seed?: number) =>
  app.inject({ method: 'POST', url: '/api/workouts/generate', payload: seed === undefined ? {} : { seed } });

describe('profile API', () => {
  it('returns 404 before a profile exists', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/profile' });
    expect(res.statusCode).toBe(404);
  });

  it('saves and reloads the profile and constraints', async () => {
    expect((await put(input)).statusCode).toBe(200);
    const saved = profileResponseSchema.parse((await app.inject({ method: 'GET', url: '/api/profile' })).json());
    expect(saved.profile).toMatchObject(input.profile);
    expect(saved.constraints).toMatchObject(input.constraints);
  });

  it('updates the single profile in place', async () => {
    const first = profileResponseSchema.parse((await put(input)).json());
    const second = profileResponseSchema.parse((await put({ ...input, profile: { ...input.profile, name: 'Asha K' } })).json());
    expect(second.profile.id).toBe(first.profile.id);
    expect(second.profile.name).toBe('Asha K');
    expect(second.profile.createdAt).toBe(first.profile.createdAt);
  });

  it('rejects invalid input with field issues', async () => {
    const res = await put({ ...input, profile: { ...input.profile, availableMinutes: 500 } });
    expect(res.statusCode).toBe(400);
    expect(apiErrorSchema.parse(res.json()).error.issues?.[0].path).toBe('profile.availableMinutes');
  });
});

describe('workout API', () => {
  it('requires a profile first', async () => {
    const res = await generate();
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('conflict');
  });

  it('generates, stores and returns the latest workout', async () => {
    await put(input);
    const res = await generate();
    expect(res.statusCode).toBe(200);
    const workout = workoutSchema.parse(res.json());
    expect(workout.estimatedMinutes).toBeLessThanOrEqual(30);
    expect(workout.items.map((i) => i.exerciseId)).not.toContain('dumbbell_shoulder_press'); // avoid_overhead_loading

    const latest = workoutSchema.parse((await app.inject({ method: 'GET', url: '/api/workouts/latest' })).json());
    expect(latest.id).toBe(workout.id);
  });

  it('regenerates with a new seed', async () => {
    await put(input);
    const first = workoutSchema.parse((await generate(0)).json());
    const again = workoutSchema.parse((await generate(0)).json());
    expect(again.items).toEqual(first.items);
    const second = workoutSchema.parse((await generate(1)).json());
    expect(second.seed).toBe(1);
    const latest = workoutSchema.parse((await app.inject({ method: 'GET', url: '/api/workouts/latest' })).json());
    expect(latest.id).toBe(second.id);
  });

  it('reflects profile changes in the next workout', async () => {
    await put(input);
    const before = workoutSchema.parse((await generate()).json());
    await put({ ...input, profile: { ...input.profile, equipment: [], goals: ['endurance'] } });
    const after = workoutSchema.parse((await generate()).json());
    expect(after.title).toContain('Endurance');
    expect(after.items.map((i) => i.exerciseId)).not.toEqual(before.items.map((i) => i.exerciseId));
  });
});

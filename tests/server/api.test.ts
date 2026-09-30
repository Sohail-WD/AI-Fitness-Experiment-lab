import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp } from '../../server/app';
import { type Database, openDatabase } from '../../server/db/database';
import { parseWith } from '../../server/validation/parse';
import { apiErrorSchema, healthResponseSchema } from '../../shared/schemas/api';
import { exerciseDefinitionSchema } from '../../shared/schemas/exercise';
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

describe('GET /api/health', () => {
  it('reports ok with a contract-valid body', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = healthResponseSchema.parse(res.json());
    expect(body.status).toBe('ok');
    expect(body.services).toEqual({ database: 'ok', ai: 'not_configured' });
  });

  it('reports the AI as configured when a key is set, without exposing it', async () => {
    const keyed = buildApp({ config: { ...testConfig, groqApiKey: 'gsk-test-not-real' }, db });
    const res = await keyed.inject({ method: 'GET', url: '/api/health' });
    expect(res.json().services.ai).toBe('configured');
    expect(res.body).not.toContain('gsk-test-not-real');
    await keyed.close();
  });

  it('reports degraded when the database is unavailable', async () => {
    db.close();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.json()).toMatchObject({ status: 'degraded', services: { database: 'error' } });
    db = openDatabase(':memory:'); // for afterEach
  });
});

describe('GET /api/exercises', () => {
  it('returns the seeded library as valid exercise definitions', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/exercises' });
    expect(res.statusCode).toBe(200);
    const exercises = z.array(exerciseDefinitionSchema).parse(res.json());
    expect(exercises.map((e) => e.id)).toContain('squat');
  });

  it('returns one exercise, or a 404 error body', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/exercises/squat' })).json().id).toBe('squat');
    const missing = await app.inject({ method: 'GET', url: '/api/exercises/unknown_exercise' });
    expect(missing.statusCode).toBe(404);
    expect(apiErrorSchema.parse(missing.json()).error.code).toBe('not_found');
  });
});

describe('error handling', () => {
  it('answers unknown API paths with a JSON 404 (all planned areas are implemented)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/not-a-planned-area/abc' });
    expect(res.statusCode).toBe(404);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('not_found');
  });

  it('answers unknown routes with a JSON 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/unknown' });
    expect(res.statusCode).toBe(404);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('not_found');
  });

  it('turns schema validation failures into 400 with field issues', async () => {
    app.post('/api/test/validate', async (request) => parseWith(z.object({ effort: z.int().min(1).max(10) }), request.body));
    const res = await app.inject({ method: 'POST', url: '/api/test/validate', payload: { effort: 42 } });
    expect(res.statusCode).toBe(400);
    const body = apiErrorSchema.parse(res.json());
    expect(body.error.code).toBe('validation_error');
    expect(body.error.issues?.[0].path).toBe('effort');
  });

  it('turns malformed JSON into a 400', async () => {
    app.post('/api/test/echo', async (request) => request.body);
    const res = await app.inject({
      method: 'POST',
      url: '/api/test/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(res.statusCode).toBe(400);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('validation_error');
  });

  it('hides database error details behind a generic 500', async () => {
    app.get('/api/test/db', async () => db.prepare('SELECT * FROM table_that_does_not_exist').all());
    const res = await app.inject({ method: 'GET', url: '/api/test/db' });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toEqual({ code: 'database_error', message: 'A database error occurred' });
  });

  it('hides unexpected error details behind a generic 500', async () => {
    app.get('/api/test/crash', async () => {
      throw new Error('secret internal detail');
    });
    const res = await app.inject({ method: 'GET', url: '/api/test/crash' });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe('internal_error');
    expect(res.body).not.toContain('secret internal detail');
  });
});

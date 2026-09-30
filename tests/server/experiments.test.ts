import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../server/app';
import { type Database, openDatabase } from '../../server/db/database';
import { experimentListSchema, experimentWithResultSchema } from '../../shared/schemas/experiment';
import { testConfig } from './helpers';

let db: Database;
let app: FastifyInstance;
beforeEach(async () => {
  db = openDatabase(':memory:');
  app = buildApp({ config: testConfig, db });
  await app.inject({
    method: 'PUT',
    url: '/api/profile',
    payload: {
      profile: {
        name: 'Asha',
        fitnessLevel: 'beginner',
        goals: ['general_fitness'],
        trainingContext: 'recreationally_active',
        equipment: [],
        environment: { location: 'home' },
        availableMinutes: 15,
        schedule: { preferredDays: [], preferredTimes: [], workoutsPerWeek: 3 },
      },
      constraints: { restrictionTags: [], notes: '', source: 'self_reported' },
    },
  });
  await app.inject({ method: 'POST', url: '/api/workouts/generate', payload: {} });
});
afterEach(async () => {
  await app.close();
  db.close();
});

const post = (url: string, payload: object = {}) => app.inject({ method: 'POST', url, payload });
const create = async (useSimulatedData: boolean) =>
  experimentWithResultSchema.parse((await post('/api/experiments', { templateId: 'morning_vs_evening', useSimulatedData })).json());

describe('experiments API', () => {
  it('runs a SIMULATED morning-vs-evening experiment to completion on simulated history', async () => {
    await post('/api/history/simulated', { weeks: 6 });
    const draft = await create(true);
    expect(draft.experiment).toMatchObject({ status: 'proposed', isSimulated: true, primaryMetric: 'adherence' });
    expect(draft.result).toBeNull();

    const started = experimentWithResultSchema.parse((await post(`/api/experiments/${draft.experiment.id}/start`)).json());
    expect(started.experiment.status).toBe('completed'); // 3 weeks of simulated history already cover the minimum
    expect(started.result!.sufficientData).toBe(true);
    const [a, b] = started.result!.perCondition;
    expect(a).toMatchObject({ planned: 6, observations: 6 });
    expect(b).toMatchObject({ planned: 3, observations: 3 });
    expect(a.sessionIds!.length + b.sessionIds!.length).toBeGreaterThan(0);
    // The simulated pattern: mornings are completed more often.
    expect(a.metricValue!).toBeGreaterThan(b.metricValue!);

    const list = experimentListSchema.parse((await app.inject({ method: 'GET', url: '/api/experiments' })).json());
    expect(list.experiments[0].result?.sufficientData).toBe(true);
  });

  it('a real experiment ignores simulated history and says "not enough data" until real sessions exist', async () => {
    await post('/api/history/simulated', { weeks: 6 });
    const draft = await create(false);
    const started = experimentWithResultSchema.parse((await post(`/api/experiments/${draft.experiment.id}/start`)).json());
    expect(started.experiment.status).toBe('active');
    expect(started.result!.sufficientData).toBe(false);
    expect(started.result!.perCondition.flatMap((p) => p.sessionIds)).toEqual([]);

    const ended = experimentWithResultSchema.parse((await post(`/api/experiments/${draft.experiment.id}/end`)).json());
    expect(ended.experiment.status).toBe('ended_early');
    expect(ended.result!.sufficientData).toBe(false);
  });

  it('supports skipping and rejects invalid transitions', async () => {
    const draft = await create(false);
    // Only one draft/active experiment at a time.
    expect((await post('/api/experiments', { templateId: 'morning_vs_evening' })).statusCode).toBe(409);

    const skipped = experimentWithResultSchema.parse((await post(`/api/experiments/${draft.experiment.id}/skip`)).json());
    expect(skipped.experiment.status).toBe('skipped');
    expect((await post(`/api/experiments/${draft.experiment.id}/start`)).statusCode).toBe(409);
    expect((await post('/api/experiments', { templateId: 'nope' })).statusCode).toBe(404);
  });
});

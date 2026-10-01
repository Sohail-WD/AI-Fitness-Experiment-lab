import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAnalysisService, SIMULATED_NOTICE } from '../../server/ai/analysisService';
import { allowedNumbers, buildFacts, extractNumbers, unsupportedNumbers } from '../../server/ai/facts';
import { createGroqClient, createLlmFromConfig, GROQ_CHAT_URL } from '../../server/ai/groqClient';
import { type LlmClient, LlmError, type LlmMessage } from '../../server/ai/llm';
import { findUnsafeWording } from '../../server/ai/validate';
import { buildApp } from '../../server/app';
import { type Database, openDatabase } from '../../server/db/database';
import { describeResult, findTemplate, OBSERVATION_CAVEAT } from '../../shared/experiments/engine';
import { analysisReportSchema } from '../../shared/schemas/ai';
import { type Experiment, type ExperimentResult, experimentWithResultSchema } from '../../shared/schemas/experiment';
import { USER_ID } from '../fixtures/contracts';
import { testConfig } from './helpers';

/* ---------- fixtures ---------- */

const EXP_ID = '3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e71';
const experiment = (isSimulated = false): Experiment => ({
  id: EXP_ID,
  userId: USER_ID,
  status: 'completed',
  ...findTemplate('morning_vs_evening')!.build(3),
  isSimulated,
  timezoneOffsetMinutes: 0,
  createdAt: '2026-09-29T10:00:00.000Z',
  startedAt: '2026-09-29T10:00:00.000Z',
  endedAt: '2026-09-29T11:00:00.000Z',
});

/** Morning 5 of 6 planned completed (83%), evening 2 of 3 (67%). */
const result = (sufficientData = true): ExperimentResult => ({
  experimentId: EXP_ID,
  computedAt: '2026-09-29T11:00:00.000Z',
  perCondition: [
    { conditionId: 'A', observations: sufficientData ? 6 : 1, metricValue: sufficientData ? 5 / 6 : null, planned: 6, completed: 5, sessionIds: [] },
    { conditionId: 'B', observations: sufficientData ? 3 : 0, metricValue: sufficientData ? 2 / 3 : null, planned: 3, completed: 2, sessionIds: [] },
  ],
  sufficientData,
});

const validReply = {
  observations: [
    {
      text: 'During this experiment, you completed 83% of your planned morning workouts (5 of 6) compared with 67% of your evening workouts (2 of 3).',
      dataRefs: ['A.metric', 'B.metric', 'A.completed', 'A.planned', 'B.completed', 'B.planned'],
    },
    { text: 'That is a gap of 16.7 percentage points, with mornings ahead.', dataRefs: ['difference'] },
  ],
  possibleExplanations: ['Morning sessions may have fit more easily around your schedule.'],
  hypothesis: 'Mornings might keep working well for you.',
  recommendation: 'Consider scheduling your next workouts in the morning and comparing again.',
  confidence: 'high',
};

/** A fake provider: records the prompts it receives and returns a canned reply (or throws). */
function fakeLlm(reply: string | Error) {
  const calls: LlmMessage[][] = [];
  const client: LlmClient = {
    provider: 'groq',
    model: 'test-model',
    async completeJson(messages) {
      calls.push(messages);
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
  return { client, calls };
}
const analyse = async (reply: string | Error | null, exp = experiment(), res = result()) => {
  const llm = reply === null ? null : fakeLlm(reply);
  const service = createAnalysisService({ llm: llm?.client ?? null, now: () => new Date('2026-09-30T00:00:00Z'), newId: () => 'aa1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c81' });
  return { report: await service.analyzeExperiment({ experiment: exp, result: res }), llm, service };
};
const withReply = (patch: Record<string, unknown>) => JSON.stringify({ ...validReply, ...patch });

/* ---------- valid response ---------- */

describe('valid LLM response', () => {
  it('is accepted, labelled AI-written, contract-valid, and confidence is capped', async () => {
    const { report, service } = await analyse(JSON.stringify(validReply));
    expect(analysisReportSchema.safeParse(report).success).toBe(true);
    expect(report).toMatchObject({ source: 'llm', provider: 'groq', model: 'test-model', fallbackReason: null, isSimulated: false, notice: null });
    expect(report.observations).toHaveLength(2);
    expect(report.confidence).toBe('medium'); // "high" is never shown for one person's data
    expect(report.caveat).toBe(OBSERVATION_CAVEAT);
    expect(report.dataUsed.find((f) => f.ref === 'difference')!.display).toBe('+16.7 percentage points');
    expect(service.status).toBe('configured');
  });

  it('receives only computed facts and experiment context, no personal data', async () => {
    const { llm } = await analyse(JSON.stringify(validReply));
    const [system, user] = llm!.calls[0];
    expect(system.content).toMatch(/Never calculate/);
    const payload = JSON.parse(user.content);
    expect(Object.keys(payload).sort()).toEqual(['experiment', 'facts']);
    expect(payload.experiment.dataSource).toBe('REAL');
    expect(payload.facts.find((f: { ref: string }) => f.ref === 'A.metric').display).toBe('83%');
    expect(user.content).not.toContain(USER_ID);
  });
});

/* ---------- fallback paths ---------- */

describe('deterministic fallback', () => {
  it('is used when no API key is configured', async () => {
    const { report, service } = await analyse(null);
    expect(service.status).toBe('not_configured');
    expect(report).toMatchObject({ source: 'fallback', provider: null, model: null, fallbackReason: 'no_api_key', confidence: 'low' });
    expect(analysisReportSchema.safeParse(report).success).toBe(true);
  });

  it('is the M7 deterministic wording, identical on every run', async () => {
    const first = (await analyse(null)).report;
    const second = (await analyse(null)).report;
    expect(first).toEqual(second);
    expect(first.observations[0].text).toBe(describeResult(experiment(), result())[0]);
    expect(first.observations[0].dataRefs).toEqual(['A.metric', 'B.metric']);
    expect(first.possibleExplanations).toEqual([]);
  });

  it('is used when the API fails (HTTP/network error or unknown error)', async () => {
    for (const err of [new LlmError('api_error', 'HTTP 500'), new Error('socket hang up')]) {
      expect((await analyse(err)).report).toMatchObject({ source: 'fallback', fallbackReason: 'api_error' });
    }
  });

  it('is used when the reply has no usable content', async () => {
    expect((await analyse(new LlmError('invalid_response', 'empty'))).report.fallbackReason).toBe('invalid_response');
  });

  it.each([
    ['not JSON', 'Sure! Here is your analysis.'],
    ['a JSON array', '[]'],
    ['missing fields', JSON.stringify({ observations: [] })],
    ['wrong types', withReply({ confidence: 'certain' })],
    ['observation without data refs', withReply({ observations: [{ text: 'You did well.', dataRefs: [] }] })],
  ])('is used for a malformed response: %s', async (_name, reply) => {
    expect((await analyse(reply)).report).toMatchObject({ source: 'fallback', fallbackReason: 'invalid_response' });
  });

  it('does not ask the LLM to interpret "not enough data"', async () => {
    const { report, llm } = await analyse(JSON.stringify(validReply), experiment(), result(false));
    expect(llm!.calls).toHaveLength(0);
    expect(report).toMatchObject({ source: 'fallback', fallbackReason: 'insufficient_data' });
    expect(report.observations[0].text).toMatch(/^Not enough data yet/);
  });
});

/* ---------- validation ---------- */

describe('numeric-claim validation', () => {
  const invalid = (patch: Record<string, unknown>) => analyse(withReply(patch)).then((r) => r.report);

  it.each([
    ['an invented percentage', { observations: [{ text: 'You completed 91% of morning workouts.', dataRefs: ['A.metric'] }] }],
    ['a derived number', { observations: [{ text: 'You did 8 of 9 planned workouts overall.', dataRefs: ['A.completed'] }] }],
    ['a changed difference', { observations: [{ text: 'Mornings were ahead by 20 percentage points.', dataRefs: ['difference'] }] }],
    ['an invented number in the recommendation', { recommendation: 'Try 4 workouts a week.' }],
    ['an invented number in an explanation', { possibleExplanations: ['You may have slept 8 hours.'] }],
    ['a made-up reference', { observations: [{ text: 'You completed 83% of morning workouts.', dataRefs: ['C.metric'] }] }],
  ])('rejects %s', async (_name, patch) => {
    expect(await invalid(patch)).toMatchObject({ source: 'fallback', fallbackReason: 'validation_failed' });
  });

  it('accepts every supplied number in its natural forms (83, 83.3, 16.7, label numbers)', async () => {
    const facts = buildFacts(experiment(), result());
    const allowed = allowedNumbers(facts, experiment());
    expect(unsupportedNumbers('83% and 83.3% vs 67%, gap 16.7 (17), 5 of 6, 2 of 3, morning 5:00–11:59, 21 days, 3 weeks', allowed)).toEqual([]);
    expect(unsupportedNumbers('You reached 84% and 7 sessions', allowed)).toEqual([84, 7]);
    expect(extractNumbers('a 12.5 and 3, not 4a5')).toEqual([12.5, 3, 4, 5]);
  });
});

describe('unsafe and unsupported wording', () => {
  it.each([
    ['diagnosis', { possibleExplanations: ['You may be showing signs of a condition; a diagnosis could help.'] }],
    ['treatment', { recommendation: 'Consider physiotherapy treatment for your workouts.' }],
    ['medical advice', { recommendation: 'Ask your doctor whether mornings are safe for you.' }],
    ['health claims', { hypothesis: 'Morning workouts might improve your health.' }],
    ['scientific proof', { observations: [{ text: 'This proves mornings are scientifically better.', dataRefs: ['A.metric'] }] }],
    ['statistical significance', { observations: [{ text: 'Mornings performed significantly better (83%).', dataRefs: ['A.metric'] }] }],
    ['causal claims', { possibleExplanations: ['Waking early may cause you to finish more workouts.'] }],
    ['overgeneralising', { observations: [{ text: 'Most people finish more morning workouts (83%).', dataRefs: ['A.metric'] }] }],
    ['an unhedged explanation', { possibleExplanations: ['Your schedule is busier in the evening.'] }],
  ])('rejects %s', async (_name, patch) => {
    expect((await analyse(withReply(patch))).report).toMatchObject({ source: 'fallback', fallbackReason: 'validation_failed' });
  });

  it('flags disallowed words but not ordinary experiment language', () => {
    expect(findUnsafeWording('You must diagnose this')).toBe('diagnose');
    expect(findUnsafeWording('This is scientifically proven')).toBe('scientifically');
    expect(findUnsafeWording('During this experiment, you completed more morning workouts than evening workouts.')).toBeNull();
    expect(findUnsafeWording('Both conditions had enough observations; mornings may suit your schedule.')).toBeNull();
  });
});

/* ---------- simulated data ---------- */

describe('simulated-data labelling', () => {
  it('labels LLM-written analysis of simulated data', async () => {
    const { report, llm } = await analyse(JSON.stringify(validReply), experiment(true));
    expect(report).toMatchObject({ source: 'llm', isSimulated: true, notice: SIMULATED_NOTICE });
    expect(report.notice).toContain('SIMULATED');
    expect(JSON.parse(llm!.calls[0][1].content).experiment.dataSource).toBe('SIMULATED');
  });

  it('labels fallback and insufficient-data reports too, and never labels real data as simulated', async () => {
    expect((await analyse(null, experiment(true))).report).toMatchObject({ isSimulated: true, notice: SIMULATED_NOTICE });
    expect((await analyse(null, experiment(true), result(false))).report.notice).toBe(SIMULATED_NOTICE);
    expect((await analyse(JSON.stringify(validReply), experiment(false))).report).toMatchObject({ isSimulated: false, notice: null });
  });
});

/* ---------- Groq client ---------- */

describe('Groq client', () => {
  const okBody = (content: unknown) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  const messages: LlmMessage[] = [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }];

  it('sends an authenticated JSON-mode chat request and returns the message content', async () => {
    const fetchImpl = vi.fn(async () => okBody('{"ok":true}'));
    const client = createGroqClient({ apiKey: 'gsk-secret', model: 'm1', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await client.completeJson(messages)).toBe('{"ok":true}');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(GROQ_CHAT_URL);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gsk-secret');
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'm1', messages, response_format: { type: 'json_object' }, temperature: 0.2 });
    expect(client).toMatchObject({ provider: 'groq', model: 'm1' });
    expect(JSON.parse(init.body as string)).not.toHaveProperty('reasoning_effort');
  });

  it('asks gpt-oss reasoning models for low reasoning effort so the JSON fits the token budget', async () => {
    const fetchImpl = vi.fn(async () => okBody('{"ok":true}'));
    const client = createGroqClient({ apiKey: 'gsk-secret', model: 'openai/gpt-oss-120b', fetchImpl: fetchImpl as unknown as typeof fetch });
    await client.completeJson(messages);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ reasoning_effort: 'low', max_tokens: 2000 });
  });

  it.each([
    ['HTTP error', () => Promise.resolve(new Response('nope gsk-secret', { status: 401 })), 'api_error'],
    ['network error', () => Promise.reject(new Error('ECONNRESET')), 'api_error'],
    ['non-JSON body', () => Promise.resolve(new Response('<html>', { status: 200 })), 'invalid_response'],
    ['no choices', () => Promise.resolve(new Response('{}', { status: 200 })), 'invalid_response'],
    ['empty content', () => Promise.resolve(okBody('  ')), 'invalid_response'],
  ])('maps %s to an LlmError without leaking the key', async (_name, impl, code) => {
    const client = createGroqClient({ apiKey: 'gsk-secret', model: 'm', fetchImpl: impl as unknown as typeof fetch });
    const err = await client.completeJson(messages).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err.code).toBe(code);
    expect(err.message).not.toContain('gsk-secret');
  });

  it('is only created when a key is configured', () => {
    expect(createLlmFromConfig({ groqApiKey: null, groqModel: 'm' })).toBeNull();
    expect(createLlmFromConfig({ groqApiKey: 'gsk-x', groqModel: 'm' })).toMatchObject({ provider: 'groq', model: 'm' });
  });
});

/* ---------- API ---------- */

describe('POST /api/ai/experiments/:id/analysis', () => {
  let db: Database;
  let app: FastifyInstance;
  beforeEach(async () => {
    db = openDatabase(':memory:');
    app = buildApp({ config: testConfig, db }); // no key → deterministic summaries
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
  async function simulatedExperiment() {
    await post('/api/history/simulated', { weeks: 6 });
    const created = experimentWithResultSchema.parse((await post('/api/experiments', { templateId: 'morning_vs_evening', useSimulatedData: true })).json());
    await post(`/api/experiments/${created.experiment.id}/start`);
    return created.experiment.id;
  }

  it('returns a deterministic, SIMULATED-labelled report when no API key is set', async () => {
    const id = await simulatedExperiment();
    const res = await post(`/api/ai/experiments/${id}/analysis`);
    expect(res.statusCode).toBe(200);
    const report = analysisReportSchema.parse(res.json());
    expect(report).toMatchObject({ source: 'fallback', fallbackReason: 'no_api_key', isSimulated: true, experimentId: id });
    expect(report.notice).toContain('SIMULATED');
    expect(report.observations[0].text).toMatch(/^During this experiment, you completed \d+% of your planned morning workouts/);
  });

  it('uses the injected analysis service and passes it the stored deterministic result', async () => {
    const id = await simulatedExperiment();
    const llm = fakeLlm('{"broken":');
    const withAi = buildApp({ config: testConfig, db, ai: createAnalysisService({ llm: llm.client }) });
    const res = await withAi.inject({ method: 'POST', url: `/api/ai/experiments/${id}/analysis`, payload: {} });
    expect(analysisReportSchema.parse(res.json())).toMatchObject({ source: 'fallback', fallbackReason: 'invalid_response' });
    expect(llm.calls).toHaveLength(1);
    const facts = JSON.parse(llm.calls[0][1].content).facts as { ref: string; display: string }[];
    expect(facts.find((f) => f.ref === 'A.metric')!.display).toMatch(/^\d+%$/);
    await withAi.close();
  });

  it('rejects unknown, draft and unstarted experiments', async () => {
    expect((await post('/api/ai/experiments/00000000-0000-4000-8000-000000000000/analysis')).statusCode).toBe(404);
    const draft = experimentWithResultSchema.parse((await post('/api/experiments', { templateId: 'shorter_vs_longer' })).json());
    expect((await post(`/api/ai/experiments/${draft.experiment.id}/analysis`)).statusCode).toBe(409);
  });
});

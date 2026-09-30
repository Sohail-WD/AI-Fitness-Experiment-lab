import { afterEach, beforeEach, expect, it } from 'vitest';
import { buildApp } from '../../server/app';
import { type Database, openDatabase } from '../../server/db/database';
import { findExercise } from '../../shared/exercises/library';
import { workoutSchema, workoutSessionSchema } from '../../shared/schemas/workout';
import { FrameProcessor } from '../../src/cv/frameProcessor';
import { testConfig } from './helpers';

/** Movement patterns whose exercises gained CV tracking in M4. */
const M4_CV_PATTERNS: string[] = ['lunge', 'curl', 'press'];

let db: Database;
let app: ReturnType<typeof buildApp>;
beforeEach(() => {
  db = openDatabase(':memory:');
  app = buildApp({ config: testConfig, db });
});
afterEach(async () => {
  await app.close();
  db.close();
});

/** M4 end-to-end: a generated workout includes the new CV exercises and their set results record through M3 sessions. */
it('records a CV set result from a new CV exercise through the session API', async () => {
  await app.inject({
    method: 'PUT',
    url: '/api/profile',
    payload: {
      profile: {
        name: 'Asha',
        fitnessLevel: 'intermediate',
        goals: ['muscle_building'],
        trainingContext: 'regularly_training',
        equipment: ['dumbbells'],
        environment: { location: 'home' },
        availableMinutes: 60,
        schedule: { preferredDays: [], preferredTimes: [], workoutsPerWeek: 4 },
      },
      constraints: { restrictionTags: [], notes: '', source: 'self_reported' },
    },
  });
  const workout = workoutSchema.parse((await app.inject({ method: 'POST', url: '/api/workouts/generate', payload: {} })).json());
  // Any exercise that gained CV in M4 (lunge, bicep curl or shoulder press variants) satisfies the requirement;
  // which ones appear depends on the generator's seeded choice between equally suitable exercises.
  const m4Item = workout.items.find((i) => M4_CV_PATTERNS.includes(findExercise(i.exerciseId)?.cv ? findExercise(i.exerciseId)!.movementPattern : ''));
  expect(m4Item, `no M4 CV exercise in ${workout.items.map((i) => i.exerciseId).join(', ')}`).toBeDefined();
  const exerciseId = m4Item!.exerciseId;

  // An (empty) CV set result straight from the pipeline with that exercise's own config, as the runner would send it.
  const setResult = new FrameProcessor(findExercise(exerciseId)!.cv!).setResult();
  const session = workoutSessionSchema.parse((await app.inject({ method: 'POST', url: '/api/sessions', payload: { workoutId: workout.id } })).json());
  const done = await app.inject({
    method: 'POST',
    url: `/api/sessions/${session.id}/complete`,
    payload: { status: 'completed', metrics: { sessionId: session.id, sets: [setResult], completionRatio: 0.1, activeDurationSeconds: 30 } },
  });
  expect(done.statusCode).toBe(200);
  expect(workoutSessionSchema.parse(done.json()).metrics!.sets[0]).toMatchObject({ exerciseId, measurementSource: 'cv' });
});

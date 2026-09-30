import type { FastifyInstance } from 'fastify';
import { type ExerciseDefinition, exerciseDefinitionSchema } from '../../shared/schemas/exercise.ts';
import type { Database } from '../db/database.ts';
import { AppError } from '../errors.ts';

/** Stored JSON is re-validated on read; a mismatch is a server fault, not a client error. */
function parseStoredExercise(json: string): ExerciseDefinition {
  const result = exerciseDefinitionSchema.safeParse(JSON.parse(json));
  if (!result.success) throw new AppError(500, 'internal_error', 'Stored exercise definition is invalid');
  return result.data;
}

export function registerExerciseRoutes(app: FastifyInstance, deps: { db: Database }): void {
  app.get('/api/exercises', async (): Promise<ExerciseDefinition[]> => {
    const rows = deps.db.prepare('SELECT definition FROM exercises ORDER BY id').all() as { definition: string }[];
    return rows.map((r) => parseStoredExercise(r.definition));
  });

  app.get<{ Params: { id: string } }>('/api/exercises/:id', async (request) => {
    const row = deps.db.prepare('SELECT definition FROM exercises WHERE id = ?').get(request.params.id) as
      | { definition: string }
      | undefined;
    if (!row) throw new AppError(404, 'not_found', `Exercise "${request.params.id}" not found`);
    return parseStoredExercise(row.definition);
  });
}

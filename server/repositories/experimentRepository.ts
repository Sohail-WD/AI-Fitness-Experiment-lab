import { type Experiment, experimentSchema, type ExperimentResult, experimentResultSchema } from '../../shared/schemas/experiment.ts';
import type { Database } from '../db/database.ts';
import { AppError } from '../errors.ts';

/** Stored in experiments.design (JSON); other fields are columns. */
type Design = Pick<Experiment, 'conditions' | 'primaryMetric' | 'minObservationsPerCondition' | 'plannedDurationDays' | 'timezoneOffsetMinutes'>;

interface Row {
  id: string;
  user_id: string;
  status: string;
  variable: string;
  hypothesis: string;
  design: string;
  is_simulated: number;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
}

function toExperiment(row: Row): Experiment {
  const design = JSON.parse(row.design) as Design;
  const parsed = experimentSchema.safeParse({
    id: row.id,
    userId: row.user_id,
    status: row.status,
    variable: row.variable,
    hypothesis: row.hypothesis,
    ...design,
    isSimulated: row.is_simulated === 1,
    createdAt: row.created_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  });
  if (!parsed.success) throw new AppError(500, 'internal_error', 'Stored experiment is invalid');
  return parsed.data;
}

export function insertExperiment(db: Database, e: Experiment): void {
  const design: Design = {
    conditions: e.conditions,
    primaryMetric: e.primaryMetric,
    minObservationsPerCondition: e.minObservationsPerCondition,
    plannedDurationDays: e.plannedDurationDays,
    timezoneOffsetMinutes: e.timezoneOffsetMinutes,
  };
  db.prepare(
    `INSERT INTO experiments (id, user_id, status, variable, hypothesis, design, is_simulated, created_at, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(e.id, e.userId, e.status, e.variable, e.hypothesis, JSON.stringify(design), e.isSimulated ? 1 : 0, e.createdAt, e.startedAt, e.endedAt);
}

export function updateExperimentStatus(db: Database, e: Experiment): void {
  db.prepare('UPDATE experiments SET status = ?, started_at = ?, ended_at = ? WHERE id = ?').run(e.status, e.startedAt, e.endedAt, e.id);
}

export function getExperiment(db: Database, id: string): Experiment | null {
  const row = db.prepare('SELECT * FROM experiments WHERE id = ?').get(id) as Row | undefined;
  return row ? toExperiment(row) : null;
}

/** Newest first. */
export function listExperiments(db: Database, userId: string): Experiment[] {
  const rows = db.prepare('SELECT * FROM experiments WHERE user_id = ? ORDER BY created_at DESC, rowid DESC').all(userId);
  return (rows as unknown as Row[]).map(toExperiment);
}

export function saveResult(db: Database, r: ExperimentResult): void {
  db.prepare(
    `INSERT INTO experiment_results (experiment_id, sufficient_data, result, computed_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (experiment_id) DO UPDATE SET sufficient_data = excluded.sufficient_data, result = excluded.result, computed_at = excluded.computed_at`,
  ).run(r.experimentId, r.sufficientData ? 1 : 0, JSON.stringify(r), r.computedAt);
}

export function getResult(db: Database, experimentId: string): ExperimentResult | null {
  const row = db.prepare('SELECT result FROM experiment_results WHERE experiment_id = ?').get(experimentId) as { result: string } | undefined;
  if (!row) return null;
  const parsed = experimentResultSchema.safeParse(JSON.parse(row.result));
  if (!parsed.success) throw new AppError(500, 'internal_error', 'Stored experiment result is invalid');
  return parsed.data;
}

import { type AdaptationProposal, adaptationProposalSchema } from '../../shared/schemas/adaptation.ts';
import type { Database } from '../db/database.ts';
import { AppError } from '../errors.ts';

interface Row {
  id: string;
  user_id: string;
  experiment_id: string | null;
  analysis_report_id: string | null;
  title: string;
  significance: string;
  status: string;
  changes: string;
  rationale: string;
  is_simulated: number;
  result_computed_at: string | null;
  created_at: string;
  decided_at: string | null;
  applied_at: string | null;
  applied_workout_id: string | null;
}

function toProposal(row: Row): AdaptationProposal {
  const parsed = adaptationProposalSchema.safeParse({
    id: row.id,
    userId: row.user_id,
    experimentId: row.experiment_id,
    analysisReportId: row.analysis_report_id,
    title: row.title,
    significance: row.significance,
    status: row.status,
    changes: JSON.parse(row.changes),
    rationale: row.rationale,
    isSimulated: row.is_simulated === 1,
    resultComputedAt: row.result_computed_at,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    appliedAt: row.applied_at,
    appliedWorkoutId: row.applied_workout_id,
  });
  if (!parsed.success) throw new AppError(500, 'internal_error', 'Stored adaptation proposal is invalid');
  return parsed.data;
}

export function insertProposal(db: Database, p: AdaptationProposal): void {
  db.prepare(
    `INSERT INTO adaptation_proposals
       (id, user_id, experiment_id, analysis_report_id, title, significance, status, changes, rationale,
        is_simulated, result_computed_at, created_at, decided_at, applied_at, applied_workout_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    p.id,
    p.userId,
    p.experimentId,
    p.analysisReportId,
    p.title,
    p.significance,
    p.status,
    JSON.stringify(p.changes),
    p.rationale,
    p.isSimulated ? 1 : 0,
    p.resultComputedAt,
    p.createdAt,
    p.decidedAt,
    p.appliedAt,
    p.appliedWorkoutId,
  );
}

/** Persist a lifecycle transition (status, timestamps, applied workout). */
export function saveTransition(db: Database, p: AdaptationProposal): void {
  db.prepare('UPDATE adaptation_proposals SET status = ?, decided_at = ?, applied_at = ?, applied_workout_id = ? WHERE id = ?').run(
    p.status,
    p.decidedAt,
    p.appliedAt,
    p.appliedWorkoutId,
    p.id,
  );
}

/**
 * Replace an open proposal's content in place (same id and experiment), used
 * when a stale proposal is refreshed against the current settings. Keeps the
 * one-proposal-per-experiment rule.
 */
export function replaceProposalContent(db: Database, p: AdaptationProposal): void {
  db.prepare(
    `UPDATE adaptation_proposals SET title = ?, significance = ?, status = ?, changes = ?, rationale = ?, is_simulated = ?,
       result_computed_at = ?, created_at = ?, decided_at = ?, applied_at = ?, applied_workout_id = ? WHERE id = ?`,
  ).run(
    p.title,
    p.significance,
    p.status,
    JSON.stringify(p.changes),
    p.rationale,
    p.isSimulated ? 1 : 0,
    p.resultComputedAt,
    p.createdAt,
    p.decidedAt,
    p.appliedAt,
    p.appliedWorkoutId,
    p.id,
  );
}

export function getProposal(db: Database, id: string): AdaptationProposal | null {
  const row = db.prepare('SELECT * FROM adaptation_proposals WHERE id = ?').get(id) as unknown as Row | undefined;
  return row ? toProposal(row) : null;
}

export function proposalForExperiment(db: Database, experimentId: string): AdaptationProposal | null {
  const row = db.prepare('SELECT * FROM adaptation_proposals WHERE experiment_id = ?').get(experimentId) as unknown as Row | undefined;
  return row ? toProposal(row) : null;
}

/** Newest first. */
export function listProposals(db: Database, userId: string): AdaptationProposal[] {
  const rows = db.prepare('SELECT * FROM adaptation_proposals WHERE user_id = ? ORDER BY created_at DESC, rowid DESC').all(userId);
  return (rows as unknown as Row[]).map(toProposal);
}

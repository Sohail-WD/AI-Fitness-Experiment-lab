import { useEffect, useState } from 'react';
import { findExercise } from '../../shared/exercises/library';
import { type WorkoutSession, workoutSessionSchema } from '../../shared/schemas/workout';
import { apiGet } from '../lib/api';

export const issueLabel = (code: string) => code.replace(/_/g, ' ');

/** Per-set results of one session (loaded on demand). */
export function SessionDetails({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet(`/sessions/${sessionId}`, workoutSessionSchema)
      .then(setSession)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load session.'));
  }, [sessionId]);

  if (error) return <p className="error">{error}</p>;
  if (!session) return <p className="subtitle">Loading…</p>;
  const sets = session.metrics?.sets ?? [];

  return (
    <div className="session-details">
      {sets.length === 0 ? (
        <p className="subtitle">No sets were completed.</p>
      ) : (
        <table className="workout-table">
          <thead>
            <tr>
              <th scope="col">Set</th>
              <th scope="col">Exercise</th>
              <th scope="col">Reps (valid / invalid)</th>
              <th scope="col">Form issues</th>
              <th scope="col">Measured by</th>
            </tr>
          </thead>
          <tbody>
            {sets.map((s, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>{findExercise(s.exerciseId)?.name ?? s.exerciseId}</td>
                <td>
                  {s.detectedReps} ({s.validReps} / {s.invalidReps})
                </td>
                <td>{s.formIssues.length ? s.formIssues.map((f) => `${issueLabel(f.code)} ×${f.count}`).join(', ') : '—'}</td>
                <td>{s.measurementSource === 'cv' ? 'Camera' : 'Manual'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {session.feedback?.note && (
        <p className="subtitle">
          <strong>Note:</strong> {session.feedback.note}
        </p>
      )}
    </div>
  );
}

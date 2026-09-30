import { Fragment, useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import {
  type DataSource,
  type HistoryResponse,
  historyResponseSchema,
  type SessionSummary,
  simulateHistoryResponseSchema,
} from '../../shared/schemas/history';
import { SessionDetails, issueLabel } from '../history/SessionDetails';
import { ApiError, apiGet, apiSend } from '../lib/api';

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
const minutes = (s: number | null) => (s === null ? '—' : `${Math.max(1, Math.round(s / 60))} min`);
const date = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const LEVEL = (v: number) => (v <= 3 ? 'low' : v <= 6 ? 'mid' : 'high');

function feedbackText(f: SessionSummary['feedback']): string {
  if (!f) return '—';
  return `Effort ${LEVEL(f.effort)} · Enjoy ${LEVEL(f.enjoyment)}${f.energy ? ` · Energy ${f.energy}` : ''}`;
}

const SOURCES: [DataSource, string][] = [
  ['real', 'Real'],
  ['simulated', 'Simulated'],
  ['all', 'All (real + simulated)'],
];

export function HistoryPage() {
  const [source, setSource] = useState<DataSource>('real');
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async (src: DataSource) => {
    setError(null);
    try {
      setData(await apiGet(`/history?source=${src}`, historyResponseSchema));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError && err.code === 'conflict' ? 'Create a profile first.' : err instanceof Error ? err.message : 'Could not load history.');
    }
  }, []);

  useEffect(() => {
    void load(source);
  }, [source, load]);

  const seed = async () => {
    setBusy(true);
    try {
      await apiSend(
        'POST',
        '/history/simulated',
        { weeks: 6, timezoneOffsetMinutes: new Date().getTimezoneOffset() },
        simulateHistoryResponseSchema,
      );
      setSource('simulated');
      await load('simulated');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create simulated history.');
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/history/simulated', { method: 'DELETE' });
      z.object({ deleted: z.int() }).parse(await res.json());
      await load(source);
    } catch {
      setError('Could not clear simulated history.');
    } finally {
      setBusy(false);
    }
  };

  const m = data?.metrics;
  const hasSimulated = data?.sessions.some((s) => s.isSimulated) ?? false;

  return (
    <section aria-labelledby="history-title">
      <div className="page-header">
        <h2 id="history-title">History</h2>
        <p className="subtitle">Recorded sessions and metrics calculated directly from them (no AI).</p>
      </div>

      <div className="controls history-controls">
        <label className="field inline-field">
          <span>Data</span>
          <select value={source} onChange={(e) => setSource(e.target.value as DataSource)}>
            {SOURCES.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="secondary" onClick={seed} disabled={busy}>
          Generate simulated history (6 weeks)
        </button>
        <button type="button" className="secondary" onClick={clear} disabled={busy}>
          Clear simulated history
        </button>
      </div>

      {source !== 'real' && (
        <p className="notice simulated-banner" role="status">
          {source === 'simulated'
            ? 'SIMULATED data: generated for demonstration, not recorded from real workouts.'
            : 'Mixed view: real and SIMULATED sessions together. Simulated rows are labelled.'}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {m && (
        <>
          <dl className="workout-meta metric-tiles">
            <div>
              <dt>Workouts completed</dt>
              <dd>
                {m.totals.workoutsCompleted} of {m.totals.planned} planned
              </dd>
            </div>
            <div>
              <dt>Adherence</dt>
              <dd>{pct(m.totals.adherence)}</dd>
            </div>
            <div>
              <dt>Avg completion</dt>
              <dd>{pct(m.totals.averageCompletion)}</dd>
            </div>
            <div>
              <dt>Valid-rep rate</dt>
              <dd>{pct(m.totals.validRepRate)}</dd>
            </div>
          </dl>
          <p className="hint">
            {m.completionRule} Planned: {m.plannedPerWeek} per week (from your profile). Adherence = completed planned
            workouts ÷ planned workouts.
          </p>

          {m.weeks.length > 0 && (
            <div className="panel table-scroll">
              <h3>Weekly trend</h3>
              <table className="workout-table">
                <thead>
                  <tr>
                    <th scope="col">Week of</th>
                    <th scope="col">Completed / planned</th>
                    <th scope="col">Adherence</th>
                    <th scope="col">Avg completion</th>
                    <th scope="col">Valid-rep rate</th>
                    <th scope="col">Form issues</th>
                  </tr>
                </thead>
                <tbody>
                  {m.weeks.map((w) => (
                    <tr key={w.weekStart}>
                      <td>{w.weekStart}</td>
                      <td>
                        {w.completed} / {w.planned}
                      </td>
                      <td>
                        <span className="bar" style={{ width: `${(w.adherence ?? 0) * 60}px` }} aria-hidden="true" /> {pct(w.adherence)}
                      </td>
                      <td>{pct(w.averageCompletion)}</td>
                      <td>{pct(w.validRepRate)}</td>
                      <td>{w.formIssueCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {m.totals.formIssues.length > 0 && (
                <p className="hint">
                  Most frequent form issues: {m.totals.formIssues.slice(0, 3).map((f) => `${issueLabel(f.code)} (${f.count})`).join(', ')}
                </p>
              )}
            </div>
          )}

          <div className="panel table-scroll">
            <h3>Sessions</h3>
            {data.sessions.length === 0 ? (
              <p className="subtitle">
                {source === 'real' ? 'No finished workouts yet. Complete one on the Follow-Along tab.' : 'No sessions for this view.'}
              </p>
            ) : (
              <table className="workout-table">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Workout</th>
                    <th scope="col">Active time</th>
                    <th scope="col">Completion</th>
                    <th scope="col">Reps (valid / invalid)</th>
                    <th scope="col">Form issues</th>
                    <th scope="col">Feedback</th>
                    <th scope="col">
                      <span className="visually-hidden">Details</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.sessions.map((s) => (
                    <Fragment key={s.sessionId}>
                      <tr>
                        <td>
                          {date(s.startedAt)}
                          {s.isSimulated && <span className="sim-tag">SIMULATED</span>}
                        </td>
                        <td>{s.workoutTitle}</td>
                        <td>{minutes(s.activeDurationSeconds)}</td>
                        <td>
                          {pct(s.completionRatio)}
                          {!s.countsAsCompleted && <span className="hint"> (not counted)</span>}
                        </td>
                        <td>
                          {s.totalReps} ({s.validReps} / {s.invalidReps})
                        </td>
                        <td>{s.formIssues.length ? s.formIssues.map((f) => `${issueLabel(f.code)} ×${f.count}`).join(', ') : '—'}</td>
                        <td>{feedbackText(s.feedback)}</td>
                        <td>
                          <button
                            type="button"
                            className="secondary small"
                            aria-expanded={open === s.sessionId}
                            onClick={() => setOpen(open === s.sessionId ? null : s.sessionId)}
                          >
                            {open === s.sessionId ? 'Hide' : 'Details'}
                          </button>
                        </td>
                      </tr>
                      {open === s.sessionId && (
                        <tr>
                          <td colSpan={8}>
                            <SessionDetails sessionId={s.sessionId} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {source === 'all' && hasSimulated && <p className="hint">Totals above include SIMULATED sessions.</p>}
        </>
      )}
    </section>
  );
}

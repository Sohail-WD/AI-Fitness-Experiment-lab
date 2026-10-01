import { useCallback, useEffect, useState } from 'react';
import { describeResult, EXPERIMENT_TEMPLATES, STATUS_LABEL } from '../../shared/experiments/engine';
import {
  type ExperimentWithResult,
  experimentListSchema,
  experimentWithResultSchema,
} from '../../shared/schemas/experiment';
import { ApiError, apiGet, apiSend } from '../lib/api';
import { Loading, PageError } from '../components/PageStatus';

const METRIC_LABEL = {
  adherence: 'Adherence (planned workouts completed)',
  completion_ratio: 'Average share of sets completed',
  valid_rep_ratio: 'Valid-rep rate',
  effort: 'Average effort rating',
  enjoyment: 'Average enjoyment rating',
} as const;

const fmtValue = (metric: keyof typeof METRIC_LABEL, v: number | null) =>
  v === null ? '—' : metric === 'effort' || metric === 'enjoyment' ? `${v.toFixed(1)}/10` : `${Math.round(v * 100)}%`;
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—');

function ExperimentCard({ item, onAction, busy }: { item: ExperimentWithResult; onAction: (id: string, a: 'start' | 'skip' | 'end') => void; busy: boolean }) {
  const { experiment: e, result: r } = item;
  const lines = r ? describeResult(e, r) : [];
  return (
    <article className="panel experiment" aria-label={`Experiment: ${e.hypothesis}`}>
      <p className="runner-label">
        {STATUS_LABEL[e.status]} · {e.plannedDurationDays} days
        {e.isSimulated && <span className="sim-tag">SIMULATED</span>}
      </p>
      <h3>{e.hypothesis}</h3>
      <p className="subtitle">
        Primary metric: {METRIC_LABEL[e.primaryMetric]} · at least {e.minObservationsPerCondition} observations per condition
        {r?.windowStart && ` · period ${day(r.windowStart)} – ${day(r.windowEnd)}`}
      </p>

      <div className="conditions">
        {e.conditions.map((c) => {
          const p = r?.perCondition.find((x) => x.conditionId === c.id);
          const progress = Math.min(1, (p?.observations ?? 0) / e.minObservationsPerCondition);
          return (
            <div key={c.id} className="condition">
              <strong>
                {c.id}: {c.label}
              </strong>
              <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={e.minObservationsPerCondition} aria-valuenow={p?.observations ?? 0}>
                <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
              </div>
              <span className="hint">
                {p?.observations ?? 0} / {e.minObservationsPerCondition} observations
                {p?.sessionIds && ` · ${p.sessionIds.length} session${p.sessionIds.length === 1 ? '' : 's'}`}
              </span>
              <span className="condition-value">{fmtValue(e.primaryMetric, p?.metricValue ?? null)}</span>
            </div>
          );
        })}
      </div>

      {r ? (
        <div className={r.sufficientData ? 'observation' : 'notice'}>
          {e.isSimulated && <p className="sim-note">SIMULATED data: this result is from generated demo history, not your real workouts.</p>}
          {lines.map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>
      ) : (
        e.status === 'proposed' && (
          <p className="hint">
            {e.isSimulated
              ? 'Uses SIMULATED history (generate it on the History tab). Results appear as soon as you start.'
              : 'After you start, your real workouts are assigned to a condition by the rule above.'}
          </p>
        )
      )}

      <div className="controls">
        {e.status === 'proposed' && (
          <>
            <button type="button" onClick={() => onAction(e.id, 'start')} disabled={busy}>
              Start experiment
            </button>
            <button type="button" className="secondary" onClick={() => onAction(e.id, 'skip')} disabled={busy}>
              Skip
            </button>
          </>
        )}
        {e.status === 'active' && (
          <button type="button" className="secondary" onClick={() => onAction(e.id, 'end')} disabled={busy}>
            End experiment
          </button>
        )}
      </div>
    </article>
  );
}

export function ExperimentsPage() {
  const [items, setItems] = useState<ExperimentWithResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems((await apiGet('/experiments', experimentListSchema)).experiments);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'conflict' ? 'Create a profile first.' : err instanceof Error ? err.message : 'Could not load experiments.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  const create = (templateId: string, useSimulatedData: boolean) =>
    run(() =>
      apiSend('POST', '/experiments', { templateId, useSimulatedData, timezoneOffsetMinutes: new Date().getTimezoneOffset() }, experimentWithResultSchema),
    );
  const act = (id: string, a: 'start' | 'skip' | 'end') => run(() => apiSend('POST', `/experiments/${id}/${a}`, {}, experimentWithResultSchema));

  const current = items?.find((i) => i.experiment.status === 'proposed' || i.experiment.status === 'active');
  const past = items?.filter((i) => i !== current) ?? [];

  return (
    <section aria-labelledby="experiments-title">
      <div className="page-header">
        <h2 id="experiments-title">Experiments</h2>
        <p className="subtitle">Personal A/B comparisons computed from your sessions by fixed rules (no AI).</p>
      </div>
      {error && <PageError message={error} />}
      {!items && !error && <Loading what="experiments" />}

      {current ? (
        <ExperimentCard item={current} onAction={act} busy={busy} />
      ) : (
        items && (
          <div className="panel">
            <h3>Start a new experiment</h3>
            {EXPERIMENT_TEMPLATES.map((t) => (
              <div key={t.id} className="template">
                <p>
                  <strong>{t.title}.</strong> {t.description}
                </p>
                <div className="controls">
                  <button type="button" onClick={() => create(t.id, false)} disabled={busy}>
                    Create with my real workouts
                  </button>
                  <button type="button" className="secondary" onClick={() => create(t.id, true)} disabled={busy}>
                    Create with SIMULATED history
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {past.length > 0 && (
        <>
          <h3>Past experiments</h3>
          {past.map((i) => (
            <ExperimentCard key={i.experiment.id} item={i} onAction={act} busy={busy} />
          ))}
        </>
      )}
    </section>
  );
}

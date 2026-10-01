import { useCallback, useEffect, useState } from 'react';
import {
  type AdaptationChange,
  type AdaptationProposal,
  adaptationListSchema,
  applyResponseSchema,
  type ChangeValue,
  generateAdaptationsResponseSchema,
  proposalResponseSchema,
  type SkipReason,
} from '../../shared/schemas/adaptation';
import { type Experiment, experimentListSchema } from '../../shared/schemas/experiment';
import { apiGet, apiSend } from '../lib/api';
import { Loading, PageError } from '../components/PageStatus';

const PARAM_LABEL: Record<string, string> = {
  workout_duration: 'Workout length',
  workout_timing: 'Preferred workout time',
  frequency: 'Workouts per week',
};

function formatValue(parameter: string, v: ChangeValue): string {
  if (parameter === 'workout_duration') return `${v} minutes`;
  if (parameter === 'frequency') return `${v} days a week`;
  if (Array.isArray(v)) return v.length ? v.join(', ') : 'none set';
  return String(v);
}

const STATUS: Record<AdaptationProposal['status'], string> = {
  pending: 'Waiting for your decision',
  accepted: 'Approved, not yet applied',
  declined: 'Declined',
  applied: 'Applied',
  auto_applied: 'Applied automatically (small change)',
};

const SKIP_TEXT: Record<SkipReason, string> = {
  insufficient_evidence: 'not enough data yet',
  no_clear_difference: 'no clear difference between the options',
  no_rule: 'no adaptation rule for this kind of experiment',
  already_configured: 'your settings already match the better option',
  already_proposed: 'already handled',
  violates_constraints: 'it would conflict with your restrictions',
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

function ChangeTable({ changes, stale }: { changes: AdaptationChange[]; stale: boolean }) {
  return (
    <table className="workout-table">
      <thead>
        <tr>
          <th scope="col">Setting</th>
          <th scope="col">{stale ? 'When proposed' : 'Current'}</th>
          <th scope="col">Proposed</th>
        </tr>
      </thead>
      <tbody>
        {changes.map((c) => (
          <tr key={c.parameter}>
            <td>{PARAM_LABEL[c.parameter] ?? c.parameter}</td>
            <td>{formatValue(c.parameter, c.from)}</td>
            <td>
              <strong>{formatValue(c.parameter, c.to)}</strong>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface CardProps {
  proposal: AdaptationProposal;
  stale: boolean;
  experiment: Experiment | undefined;
  busy: boolean;
  onApprove: (p: AdaptationProposal) => void;
  onDecline: (p: AdaptationProposal) => void;
  onRefresh: (p: AdaptationProposal) => void;
}

function ProposalCard({ proposal: p, stale, experiment, busy, onApprove, onDecline, onRefresh }: CardProps) {
  const open = p.status === 'pending' || p.status === 'accepted';
  return (
    <article className="panel experiment" aria-label={`Proposal: ${p.title}`}>
      <p className="runner-label">
        {STATUS[p.status]}
        {p.isSimulated && <span className="sim-tag">SIMULATED</span>}
        <span className="source-tag">{p.significance === 'significant' ? 'Needs your approval' : 'Small change'}</span>
      </p>
      <h3>{p.title}</h3>
      {p.isSimulated && (
        <p className="sim-note">
          SIMULATED data: this proposal comes from generated demo history, not your real workouts. Applying it changes your real plan.
        </p>
      )}
      <p>{p.rationale}</p>
      <p className="hint">
        Why this was created ({when(p.createdAt)}): based on the experiment “{experiment?.hypothesis ?? p.experimentId}” and its result computed{' '}
        {when(p.resultComputedAt)}. <a href="#/experiments">Experiment</a> · <a href="#/insights">Insight</a>
      </p>
      <ChangeTable changes={p.changes} stale={stale} />
      {open && stale && (
        <p className="notice" role="status">
          Your settings changed since this was proposed. Update it to your current settings, or decline it.
        </p>
      )}

      {open && (
        <div className="controls">
          {stale ? (
            <button type="button" onClick={() => onRefresh(p)} disabled={busy}>
              Update to my current settings
            </button>
          ) : (
            <button type="button" onClick={() => onApprove(p)} disabled={busy}>
              Accept and apply
            </button>
          )}
          <button type="button" className="secondary" onClick={() => onDecline(p)} disabled={busy}>
            Decline
          </button>
        </div>
      )}
      {(p.status === 'applied' || p.status === 'auto_applied') && (
        <p className="success">
          Applied {when(p.appliedAt)}. Your next workout was generated with the new setting.{' '}
          <a href="#/workout">See the workout</a>
        </p>
      )}
      {p.status === 'declined' && <p className="hint">Declined {when(p.decidedAt)}. Nothing was changed.</p>}
    </article>
  );
}

export function AdaptationPage() {
  const [items, setItems] = useState<{ proposal: AdaptationProposal; stale: boolean }[] | null>(null);
  const [experiments, setExperiments] = useState<Map<string, Experiment>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, exps] = await Promise.all([apiGet('/adaptations', adaptationListSchema), apiGet('/experiments', experimentListSchema)]);
      setItems(list.proposals);
      setExperiments(new Map(exps.experiments.map((x) => [x.experiment.id, x.experiment])));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load adaptations.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const msg = await fn();
      if (msg) setMessage(msg);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      await load();
      setBusy(false);
    }
  };

  const check = () =>
    run(async () => {
      const res = await apiSend('POST', '/adaptations/generate', {}, generateAdaptationsResponseSchema);
      const reasons = res.skipped.filter((s) => s.reason !== 'already_proposed');
      const parts = [`${res.created.length} new proposal${res.created.length === 1 ? '' : 's'}.`];
      if (reasons.length) parts.push(`No proposal for ${reasons.length} experiment${reasons.length === 1 ? '' : 's'}: ${[...new Set(reasons.map((s) => SKIP_TEXT[s.reason]))].join('; ')}.`);
      return parts.join(' ');
    });

  // One atomic server operation: on failure the proposal stays open and can be retried or declined.
  const approve = (p: AdaptationProposal) =>
    run(async () => {
      await apiSend('POST', `/adaptations/${p.id}/approve`, {}, applyResponseSchema);
      return 'Applied. Your next workout was generated with the new setting.';
    });
  const decline = (p: AdaptationProposal) => run(async () => void (await apiSend('POST', `/adaptations/${p.id}/decline`, {}, proposalResponseSchema)));
  const refresh = (p: AdaptationProposal) =>
    run(async () => {
      await apiSend('POST', `/adaptations/${p.id}/refresh`, {}, proposalResponseSchema);
      return 'Proposal updated to your current settings.';
    });

  return (
    <section aria-labelledby="adaptation-title">
      <div className="page-header">
        <h2 id="adaptation-title">Adaptation</h2>
        <p className="subtitle">
          Suggestions from your finished experiments, chosen by fixed rules (no AI). Nothing significant changes without your approval,
          and your restrictions are never changed.
        </p>
      </div>
      <div className="controls">
        <button type="button" onClick={check} disabled={busy}>
          Check for adaptations
        </button>
      </div>
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
      {error && <PageError message={error} />}
      {!items && !error && <Loading what="proposals" />}
      {items?.length === 0 && (
        <div className="panel">
          <p>
            No proposals yet. Finish an experiment on the <a href="#/experiments">Experiments tab</a>, then press “Check for adaptations”.
          </p>
        </div>
      )}
      {items?.map(({ proposal, stale }) => (
        <ProposalCard
          key={proposal.id}
          proposal={proposal}
          stale={stale}
          experiment={proposal.experimentId ? experiments.get(proposal.experimentId) : undefined}
          busy={busy}
          onApprove={approve}
          onDecline={decline}
          onRefresh={refresh}
        />
      ))}
    </section>
  );
}

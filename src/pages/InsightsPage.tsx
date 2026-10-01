import { useCallback, useEffect, useState } from 'react';
import { STATUS_LABEL } from '../../shared/experiments/engine';
import { type AnalysisReport, analysisReportSchema, type FallbackReason } from '../../shared/schemas/ai';
import { healthResponseSchema } from '../../shared/schemas/api';
import { type ExperimentWithResult, experimentListSchema } from '../../shared/schemas/experiment';
import { apiGet, apiSend } from '../lib/api';
import { Loading, PageError } from '../components/PageStatus';

const FALLBACK_TEXT: Record<FallbackReason, string> = {
  no_api_key: 'No AI key is configured, so this is a fixed-template summary.',
  api_error: 'The AI service could not be reached, so this is a fixed-template summary.',
  invalid_response: 'The AI reply was unusable, so this is a fixed-template summary.',
  validation_failed: 'The AI reply failed the safety and number checks, so this is a fixed-template summary.',
  insufficient_data: 'There is not enough data to interpret yet, so no AI was used.',
};

function Report({ report, factLabel }: { report: AnalysisReport; factLabel: (ref: string) => string }) {
  return (
    <div className="report" aria-label="Analysis">
      <p className="report-source">
        {report.source === 'llm' ? (
          <span className="source-tag source-llm">AI-written · {report.provider} · {report.model}</span>
        ) : (
          <span className="source-tag source-fallback">Deterministic summary</span>
        )}
        <span className="source-tag">Data: {report.isSimulated ? 'SIMULATED history' : 'your real workouts'}</span>
        <span className="source-tag">Confidence: {report.confidence}</span>
      </p>
      {report.notice && <p className="sim-note">{report.notice}</p>}
      {report.fallbackReason && <p className="hint">{FALLBACK_TEXT[report.fallbackReason]}</p>}

      <h4>What the data shows</h4>
      <ul>
        {report.observations.map((o) => (
          <li key={o.text}>
            {o.text}
            <span className="hint"> Based on: {o.dataRefs.map(factLabel).join('; ')}</span>
          </li>
        ))}
      </ul>

      {report.possibleExplanations.length > 0 && (
        <>
          <h4>Possible explanations (not established)</h4>
          <ul>
            {report.possibleExplanations.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </>
      )}
      {report.hypothesis && (
        <p>
          <strong>Idea to test:</strong> {report.hypothesis}
        </p>
      )}
      {report.recommendation && (
        <p>
          <strong>Suggested next step:</strong> {report.recommendation}
        </p>
      )}
      <p className="hint">{report.caveat}</p>
    </div>
  );
}

function ExperimentInsight({ item, aiConfigured }: { item: ExperimentWithResult; aiConfigured: boolean }) {
  const { experiment: e, result } = item;
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      setReport(await apiSend('POST', `/ai/experiments/${e.id}/analysis`, {}, analysisReportSchema));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate the insight.');
    } finally {
      setBusy(false);
    }
  };

  const factLabel = (ref: string) => report?.dataUsed.find((f) => f.ref === ref)?.label ?? ref;
  return (
    <article className="panel experiment" aria-label={`Insight: ${e.hypothesis}`}>
      <p className="runner-label">
        {STATUS_LABEL[e.status]}
        {e.isSimulated && <span className="sim-tag">SIMULATED</span>}
      </p>
      <h3>{e.hypothesis}</h3>
      <p className="subtitle">
        {e.conditions.map((c) => `${c.id}: ${c.label}`).join(' · ')}
        {result && !result.sufficientData && ' · not enough data yet'}
      </p>
      <div className="controls">
        <button type="button" onClick={generate} disabled={busy}>
          {busy ? 'Analysing…' : report ? 'Regenerate insight' : 'Generate insight'}
        </button>
        {!aiConfigured && <span className="hint">AI not configured: you will get a fixed-template summary.</span>}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {report && <Report report={report} factLabel={factLabel} />}
    </article>
  );
}

export function InsightsPage() {
  const [items, setItems] = useState<ExperimentWithResult[] | null>(null);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, health] = await Promise.all([
        apiGet('/experiments', experimentListSchema),
        apiGet('/health', healthResponseSchema),
      ]);
      setItems(list.experiments.filter((i) => i.experiment.status !== 'proposed' && i.experiment.status !== 'skipped' && i.result));
      setAiConfigured(health.services.ai === 'configured');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load experiments.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section aria-labelledby="insights-title">
      <div className="page-header">
        <h2 id="insights-title">Insights</h2>
        <p className="subtitle">
          Plain-language readings of your experiment results. Numbers are computed by the app; the AI only words them, and every
          number it uses is checked against them.
        </p>
      </div>
      {error && <PageError message={error} />}
      {!items && !error && <Loading what="experiments" />}
      {items?.length === 0 && (
        <div className="panel">
          <p>
            No started experiments yet. <a href="#/experiments">Start one on the Experiments tab</a> (you can use SIMULATED history
            to try it).
          </p>
        </div>
      )}
      {items?.map((item) => (
        <ExperimentInsight key={item.experiment.id} item={item} aiConfigured={aiConfigured} />
      ))}
    </section>
  );
}

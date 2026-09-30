import type { Experiment, ExperimentMetric, ExperimentResult } from '../../shared/schemas/experiment.ts';

/**
 * The only numbers an analysis may cite. They are computed from the M7
 * experiment result by code; the LLM receives them as-is and may not calculate
 * new ones (spec §15.4). Each fact has a stable `ref` that observations cite.
 */

export type FactKind = 'percent' | 'count' | 'rating' | 'difference' | 'days';

export interface Fact {
  ref: string;
  label: string;
  kind: FactKind;
  /** percent: ratio 0–1 · count/days: integer · rating: 0–10 · difference: signed points in display units. */
  value: number;
  /** Exact text for this number, e.g. "83%". */
  display: string;
}

const METRIC_NAME: Record<ExperimentMetric, string> = {
  adherence: 'adherence (planned workouts completed)',
  completion_ratio: 'average share of sets completed',
  valid_rep_ratio: 'valid-rep rate',
  effort: 'average effort rating',
  enjoyment: 'average enjoyment rating',
};
export const metricName = (m: ExperimentMetric) => METRIC_NAME[m];

const isRating = (m: ExperimentMetric) => m === 'effort' || m === 'enjoyment';
const fmtPercent = (v: number) => `${Math.round(v * 100)}%`;
const fmtRating = (v: number) => `${v.toFixed(1)}/10`;

export function buildFacts(experiment: Experiment, result: ExperimentResult): Fact[] {
  const facts: Fact[] = [];
  const rating = isRating(experiment.primaryMetric);
  const name = metricName(experiment.primaryMetric);

  for (const c of experiment.conditions) {
    const p = result.perCondition.find((x) => x.conditionId === c.id);
    if (!p) continue;
    if (p.metricValue !== null) {
      facts.push({
        ref: `${c.id}.metric`,
        label: `${c.label}: ${name}`,
        kind: rating ? 'rating' : 'percent',
        value: p.metricValue,
        display: rating ? fmtRating(p.metricValue) : fmtPercent(p.metricValue),
      });
    }
    facts.push({ ref: `${c.id}.observations`, label: `${c.label}: observations`, kind: 'count', value: p.observations, display: String(p.observations) });
    if (p.planned !== undefined) {
      facts.push({ ref: `${c.id}.planned`, label: `${c.label}: planned workouts`, kind: 'count', value: p.planned, display: String(p.planned) });
    }
    if (p.completed !== undefined) {
      facts.push({ ref: `${c.id}.completed`, label: `${c.label}: sessions counted as completed`, kind: 'count', value: p.completed, display: String(p.completed) });
    }
  }

  const a = result.perCondition.find((x) => x.conditionId === 'A')?.metricValue;
  const b = result.perCondition.find((x) => x.conditionId === 'B')?.metricValue;
  if (a != null && b != null) {
    const diff = rating ? a - b : (a - b) * 100;
    const unit = rating ? 'rating points' : 'percentage points';
    facts.push({
      ref: 'difference',
      label: `Difference between condition A and B (A minus B) in ${unit}`,
      kind: 'difference',
      value: diff,
      display: `${diff >= 0 ? '+' : '-'}${Math.abs(diff).toFixed(1)} ${unit}`,
    });
  }

  facts.push({
    ref: 'min_observations',
    label: 'Minimum observations required per condition',
    kind: 'count',
    value: experiment.minObservationsPerCondition,
    display: String(experiment.minObservationsPerCondition),
  });
  facts.push({ ref: 'planned_days', label: 'Planned experiment length in days', kind: 'days', value: experiment.plannedDurationDays, display: `${experiment.plannedDurationDays} days` });
  if (experiment.plannedDurationDays % 7 === 0) {
    const weeks = experiment.plannedDurationDays / 7;
    facts.push({ ref: 'planned_weeks', label: 'Planned experiment length in weeks', kind: 'days', value: weeks, display: `${weeks} weeks` });
  }
  return facts;
}

/* ---------- numeric-claim checking ---------- */

const norm = (n: number) => Number(n.toFixed(2));

/** All numbers appearing in a text (integers and dot-decimals). */
export function extractNumbers(text: string): number[] {
  return (text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/**
 * Every number the analysis text may contain: each fact in the ways it is
 * naturally written (83, 83.3 for 0.833), plus numbers already present in the
 * supplied condition labels (e.g. "≤ 20 min").
 */
export function allowedNumbers(facts: Fact[], experiment: Experiment): Set<number> {
  const allowed = new Set<number>();
  const add = (n: number) => allowed.add(norm(n));
  /** A number as it is naturally written: whole, one decimal, two decimals. */
  const addForms = (n: number) => {
    add(Math.round(n));
    add(Number(n.toFixed(1)));
    add(n);
  };
  for (const f of facts) {
    switch (f.kind) {
      case 'percent':
        addForms(f.value * 100);
        break;
      case 'rating':
        addForms(f.value);
        add(10);
        break;
      case 'difference':
        addForms(Math.abs(f.value));
        break;
      default:
        add(f.value);
    }
  }
  for (const c of experiment.conditions) for (const n of extractNumbers(c.label)) add(n);
  return allowed;
}

/** Numbers in `text` that are not in the allowed set. */
export function unsupportedNumbers(text: string, allowed: Set<number>): number[] {
  return extractNumbers(text).filter((n) => !allowed.has(norm(n)));
}

import { calculateAdherence } from '../metrics/adherence.ts';
import type { Experiment, ExperimentMetric, ExperimentResult } from '../schemas/experiment.ts';
import type { SessionSummary } from '../schemas/history.ts';

/**
 * Experiment engine (spec §12–§14). Deterministic: sessions are assigned to a
 * condition by fixed rules and each condition's primary metric is computed
 * from the same session summaries and adherence definition as History.
 * Results are personal observations, never scientific conclusions.
 */

const DAY_MS = 86_400_000;

/* ---------- templates ---------- */

export interface ExperimentTemplate {
  id: string;
  title: string;
  description: string;
  build: (workoutsPerWeek: number) => Pick<
    Experiment,
    'variable' | 'hypothesis' | 'conditions' | 'primaryMetric' | 'minObservationsPerCondition' | 'plannedDurationDays'
  >;
}

/** Local time-of-day windows used to assign sessions (hours, [from, to)). */
export const TIME_WINDOWS = { morning: [5, 12], evening: [17, 23] } as const;

export const EXPERIMENT_TEMPLATES: ExperimentTemplate[] = [
  {
    id: 'morning_vs_evening',
    title: 'Morning vs evening workouts',
    description: 'Alternate morning and evening workouts for 3 weeks and compare how many you complete.',
    build: (perWeek) => ({
      variable: 'workout_time',
      hypothesis: 'You may complete more of your planned workouts in the morning than in the evening.',
      conditions: [
        { id: 'A', label: 'Morning (5:00–11:59)', parameters: { timeOfDay: 'morning', plannedPerWeek: Math.ceil(perWeek / 2) } },
        { id: 'B', label: 'Evening (17:00–22:59)', parameters: { timeOfDay: 'evening', plannedPerWeek: Math.max(1, Math.floor(perWeek / 2)) } },
      ],
      primaryMetric: 'adherence',
      minObservationsPerCondition: 3,
      plannedDurationDays: 21,
    }),
  },
  {
    id: 'shorter_vs_longer',
    title: 'Shorter vs longer workouts',
    description: 'Mix workouts of 20 minutes or less with workouts of 30 minutes or more and compare how much of each you finish.',
    build: () => ({
      variable: 'workout_duration',
      hypothesis: 'You may finish more of each session when workouts are shorter.',
      conditions: [
        { id: 'A', label: 'Shorter (≤ 20 min)', parameters: { maxMinutes: 20 } },
        { id: 'B', label: 'Longer (≥ 30 min)', parameters: { minMinutes: 30 } },
      ],
      primaryMetric: 'completion_ratio',
      minObservationsPerCondition: 3,
      plannedDurationDays: 28,
    }),
  },
];

export function findTemplate(id: string): ExperimentTemplate | undefined {
  return EXPERIMENT_TEMPLATES.find((t) => t.id === id);
}

/* ---------- lifecycle ---------- */

export type ExperimentAction = 'start' | 'skip' | 'end' | 'complete';
export class ExperimentTransitionError extends Error {
  override name = 'ExperimentTransitionError';
}

/** Display names for stored statuses (proposed = draft, ended_early = ended). */
export const STATUS_LABEL: Record<Experiment['status'], string> = {
  proposed: 'Draft',
  active: 'Active',
  completed: 'Completed',
  skipped: 'Skipped',
  ended_early: 'Ended',
};

/** Allowed transitions: draft → active | skipped; active → completed | ended. */
export function applyLifecycle(experiment: Experiment, action: ExperimentAction, now: Date): Experiment {
  const at = now.toISOString();
  const from = experiment.status;
  if (action === 'start' && from === 'proposed') return { ...experiment, status: 'active', startedAt: at };
  if (action === 'skip' && from === 'proposed') return { ...experiment, status: 'skipped', endedAt: at };
  if (action === 'end' && from === 'active') return { ...experiment, status: 'ended_early', endedAt: at };
  if (action === 'complete' && from === 'active') return { ...experiment, status: 'completed', endedAt: at };
  throw new ExperimentTransitionError(`Cannot ${action} an experiment that is ${STATUS_LABEL[from].toLowerCase()}`);
}

/* ---------- condition assignment ---------- */

export interface ExperimentSession {
  summary: SessionSummary;
  /** Planned length of the session's workout. */
  workoutMinutes: number;
}

/** Local hour (0–23) of an ISO timestamp for a JS-style UTC offset (minutes; UTC − local). */
export function localHour(iso: string, timezoneOffsetMinutes = 0): number {
  return new Date(Date.parse(iso) - timezoneOffsetMinutes * 60_000).getUTCHours();
}

function matches(params: Record<string, string | number | boolean>, s: ExperimentSession, tz: number): boolean {
  if (typeof params.timeOfDay === 'string') {
    const window = TIME_WINDOWS[params.timeOfDay as keyof typeof TIME_WINDOWS];
    const h = localHour(s.summary.startedAt, tz);
    if (!window || h < window[0] || h >= window[1]) return false;
  }
  if (typeof params.maxMinutes === 'number' && s.workoutMinutes > params.maxMinutes) return false;
  if (typeof params.minMinutes === 'number' && s.workoutMinutes < params.minMinutes) return false;
  return true;
}

/** Condition a session belongs to, or null if it matches neither (e.g. an afternoon session). */
export function assignCondition(experiment: Experiment, s: ExperimentSession): 'A' | 'B' | null {
  const tz = experiment.timezoneOffsetMinutes ?? 0;
  for (const c of experiment.conditions) if (matches(c.parameters, s, tz)) return c.id;
  return null;
}

/* ---------- evaluation ---------- */

/**
 * Period evaluated. Real experiments: from acceptance, for the planned
 * duration (or until ended). SIMULATED experiments: the planned duration
 * ending at the start of the current week (UTC), where simulated history lives.
 */
export function experimentWindow(e: Experiment, now: Date): { start: Date; end: Date } {
  const duration = e.plannedDurationDays * DAY_MS;
  if (e.isSimulated) {
    const day = (now.getUTCDay() + 6) % 7;
    const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day);
    return { start: new Date(end - duration), end: new Date(end) };
  }
  const start = Date.parse(e.startedAt ?? now.toISOString());
  const stop = Math.min(start + duration, e.endedAt ? Date.parse(e.endedAt) : now.getTime(), now.getTime());
  return { start: new Date(start), end: new Date(Math.max(start, stop)) };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function conditionMetric(
  metric: ExperimentMetric,
  sessions: SessionSummary[],
  plannedPerWeek: number,
  windowDays: number,
): { observations: number; metricValue: number | null; planned?: number; completed?: number } {
  const completed = sessions.filter((s) => s.countsAsCompleted).length;
  switch (metric) {
    case 'adherence': {
      // Each planned workout in the window is one observation: done (per the completion rule) or not.
      const planned = Math.floor((plannedPerWeek * windowDays) / 7);
      return { observations: planned, metricValue: calculateAdherence(planned, Math.min(completed, planned)), planned, completed };
    }
    case 'completion_ratio': {
      const values = sessions.map((s) => s.completionRatio).filter((v): v is number => v !== null);
      return { observations: values.length, metricValue: mean(values), completed };
    }
    case 'valid_rep_ratio': {
      const withReps = sessions.filter((s) => s.totalReps > 0);
      const reps = withReps.reduce((n, s) => n + s.totalReps, 0);
      return { observations: withReps.length, metricValue: reps ? withReps.reduce((n, s) => n + s.validReps, 0) / reps : null, completed };
    }
    case 'effort':
    case 'enjoyment': {
      const values = sessions.map((s) => s.feedback?.[metric]).filter((v): v is number => typeof v === 'number');
      return { observations: values.length, metricValue: mean(values), completed };
    }
  }
}

/** Deterministic result for an experiment from all known sessions. */
export function evaluateExperiment(e: Experiment, all: ExperimentSession[], now: Date): ExperimentResult {
  const { start, end } = experimentWindow(e, now);
  const windowDays = (end.getTime() - start.getTime()) / DAY_MS;
  const inWindow = all.filter(
    (s) =>
      s.summary.isSimulated === e.isSimulated &&
      s.summary.status !== 'in_progress' &&
      Date.parse(s.summary.startedAt) >= start.getTime() &&
      Date.parse(s.summary.startedAt) < end.getTime(),
  );

  const perCondition = e.conditions.map((c) => {
    const assigned = inWindow.filter((s) => assignCondition(e, s) === c.id).map((s) => s.summary);
    const plannedPerWeek = typeof c.parameters.plannedPerWeek === 'number' ? c.parameters.plannedPerWeek : 0;
    return {
      conditionId: c.id,
      sessionIds: assigned.map((s) => s.sessionId),
      ...conditionMetric(e.primaryMetric, assigned, plannedPerWeek, windowDays),
    };
  });

  return {
    experimentId: e.id,
    computedAt: now.toISOString(),
    perCondition,
    sufficientData: perCondition.every((p) => p.observations >= e.minObservationsPerCondition && p.metricValue !== null),
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
  };
}

/** Evaluate an active experiment and complete it automatically once every condition has enough observations. */
export function refreshExperiment(e: Experiment, all: ExperimentSession[], now: Date): { experiment: Experiment; result: ExperimentResult } {
  const result = evaluateExperiment(e, all, now);
  const experiment = e.status === 'active' && result.sufficientData ? applyLifecycle(e, 'complete', now) : e;
  return { experiment, result };
}

/* ---------- wording ---------- */

function formatMetric(metric: ExperimentMetric, v: number): string {
  if (metric === 'effort' || metric === 'enjoyment') return `${v.toFixed(1)}/10`;
  return `${Math.round(v * 100)}%`;
}

export const OBSERVATION_CAVEAT =
  'This describes your own workouts during this experiment only. It is a personal observation, not a scientific conclusion.';

/** Personal-observation sentences for a result, or a "not enough data" statement. */
export function describeResult(e: Experiment, r: ExperimentResult): string[] {
  const [a, b] = e.conditions;
  const pa = r.perCondition.find((p) => p.conditionId === 'A')!;
  const pb = r.perCondition.find((p) => p.conditionId === 'B')!;
  if (!r.sufficientData || pa.metricValue === null || pb.metricValue === null) {
    return [
      `Not enough data yet: at least ${e.minObservationsPerCondition} observations are needed for each condition ` +
        `(${a.label}: ${pa.observations}, ${b.label}: ${pb.observations}).`,
    ];
  }
  const A = a.label.split(' (')[0].toLowerCase();
  const B = b.label.split(' (')[0].toLowerCase();
  const va = formatMetric(e.primaryMetric, pa.metricValue);
  const vb = formatMetric(e.primaryMetric, pb.metricValue);
  const sentence: Record<ExperimentMetric, string> = {
    adherence: `During this experiment, you completed ${va} of your planned ${A} workouts (${pa.completed} of ${pa.planned}) compared with ${vb} of your ${B} workouts (${pb.completed} of ${pb.planned}).`,
    completion_ratio: `During this experiment, you finished on average ${va} of the sets in ${A} workouts compared with ${vb} in ${B} workouts.`,
    valid_rep_ratio: `During this experiment, ${va} of your reps in ${A} workouts were valid compared with ${vb} in ${B} workouts.`,
    effort: `During this experiment, your average effort rating was ${va} for ${A} workouts and ${vb} for ${B} workouts.`,
    enjoyment: `During this experiment, your average enjoyment rating was ${va} for ${A} workouts and ${vb} for ${B} workouts.`,
  };
  return [sentence[e.primaryMetric], OBSERVATION_CAVEAT];
}

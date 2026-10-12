import { calculateAdherence } from '../metrics/adherence.ts';
import type { Experiment, ExperimentMetric, ExperimentResult } from '../schemas/experiment.ts';
import type { SessionSummary } from '../schemas/history.ts';

/**
 * Experiment engine (spec §12–§14). Deterministic. Workouts generated during an
 * active experiment are INTENTIONALLY assigned to condition A or B (alternating),
 * and each condition's primary metric is computed from the sessions that ran
 * those workouts. An observation is a finished, on-protocol session with at least
 * one genuine set (see metrics/completion): planned quotas are never observations.
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
    description:
      'Your next workouts are assigned alternately to a morning or an evening time window. Do each one in its window; the app compares how much of each you finish.',
    build: () => ({
      variable: 'workout_time',
      hypothesis: 'You may finish more of your assigned workouts in the morning than in the evening.',
      conditions: [
        { id: 'A', label: 'Morning (5:00–11:59)', parameters: { timeOfDay: 'morning' } },
        { id: 'B', label: 'Evening (17:00–22:59)', parameters: { timeOfDay: 'evening' } },
      ],
      primaryMetric: 'adherence',
      minObservationsPerCondition: 3,
      plannedDurationDays: 21,
    }),
  },
  {
    id: 'shorter_vs_longer',
    title: 'Shorter vs longer workouts',
    description:
      'Your next workouts are generated alternately at 15 and 45 minutes, and the app compares how much of each you finish.',
    build: () => ({
      variable: 'workout_duration',
      hypothesis: 'You may finish more of each session when workouts are shorter.',
      conditions: [
        { id: 'A', label: 'Shorter (15 min)', parameters: { durationMinutes: 15, maxMinutes: 20 } },
        { id: 'B', label: 'Longer (45 min)', parameters: { durationMinutes: 45, minMinutes: 30 } },
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

export interface SessionAssignment {
  experimentId: string;
  conditionId: 'A' | 'B';
}

export interface ExperimentSession {
  summary: SessionSummary;
  /** Planned length of the session's workout. */
  workoutMinutes: number;
  /** The experiment condition the session's workout was generated for (real sessions). */
  assignment?: SessionAssignment | null;
  /** Main-exercise sets with real work evidenced (shared/metrics/completion). Warm-up and cool-down alone do not count. */
  genuineSets: number;
}

/** Local hour (0–23) of an ISO timestamp for a JS-style UTC offset (minutes; UTC − local). */
export function localHour(iso: string, timezoneOffsetMinutes = 0): number {
  return new Date(Date.parse(iso) - timezoneOffsetMinutes * 60_000).getUTCHours();
}

type Condition = Experiment['conditions'][number];

/** A time-of-day condition only counts sessions that actually started in its window. */
function onProtocol(c: Condition, s: ExperimentSession, tz: number): boolean {
  const t = c.parameters.timeOfDay;
  if (typeof t !== 'string') return true;
  const window = TIME_WINDOWS[t as keyof typeof TIME_WINDOWS];
  const h = localHour(s.summary.startedAt, tz);
  return !!window && h >= window[0] && h < window[1];
}

/** Simulated demo sessions have no stored assignment; they follow a built-in alternating pattern and are matched by it. */
function inferSimulated(c: Condition, s: ExperimentSession, tz: number): boolean {
  const p = c.parameters;
  if (!onProtocol(c, s, tz)) return false;
  if (typeof p.maxMinutes === 'number' && s.workoutMinutes > p.maxMinutes) return false;
  if (typeof p.minMinutes === 'number' && s.workoutMinutes < p.minMinutes) return false;
  return typeof p.timeOfDay === 'string' || typeof p.maxMinutes === 'number' || typeof p.minMinutes === 'number';
}

/**
 * Condition a session belongs to, or null. Real sessions need the assignment made
 * when their workout was generated for THIS experiment (and, for time-of-day
 * conditions, must have started in that window); anything else is off-protocol.
 */
export function assignCondition(experiment: Experiment, s: ExperimentSession): 'A' | 'B' | null {
  const tz = experiment.timezoneOffsetMinutes ?? 0;
  if (s.summary.isSimulated) {
    for (const c of experiment.conditions) if (inferSimulated(c, s, tz)) return c.id;
    return null;
  }
  const a = s.assignment;
  if (!a || a.experimentId !== experiment.id) return null;
  const c = experiment.conditions.find((x) => x.id === a.conditionId);
  return c && onProtocol(c, s, tz) ? c.id : null;
}

/** An observation is a finished session with at least one genuine set. Unfinished or click-through sessions are not. */
export const isObservation = (s: ExperimentSession) => s.summary.status !== 'in_progress' && s.genuineSets >= 1;

/**
 * The condition the NEXT generated workout is assigned to: whichever has fewer
 * on-protocol sessions (finished with real work, or still in progress); ties go to A.
 * Sessions that did not follow the protocol or did no genuine work do not use up a slot.
 */
export function nextCondition(experiment: Experiment, all: readonly ExperimentSession[]): 'A' | 'B' {
  const tz = experiment.timezoneOffsetMinutes ?? 0;
  const used = (c: Condition) =>
    all.filter(
      (s) =>
        !s.summary.isSimulated &&
        s.assignment?.experimentId === experiment.id &&
        s.assignment.conditionId === c.id &&
        onProtocol(c, s, tz) &&
        (s.summary.status === 'in_progress' || isObservation(s)),
    ).length;
  const [a, b] = experiment.conditions;
  return used(b) < used(a) ? b.id : a.id;
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
): { observations: number; metricValue: number | null; planned?: number; completed?: number } {
  const completed = sessions.filter((s) => s.countsAsCompleted).length;
  switch (metric) {
    case 'adherence': {
      // Each assigned workout the user actually performed is one observation: finished (completion rule) or not.
      const planned = sessions.length;
      return { observations: planned, metricValue: calculateAdherence(planned, completed), planned, completed };
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
  const inWindow = all.filter(
    (s) =>
      s.summary.isSimulated === e.isSimulated &&
      isObservation(s) &&
      Date.parse(s.summary.startedAt) >= start.getTime() &&
      Date.parse(s.summary.startedAt) < end.getTime(),
  );

  const perCondition = e.conditions.map((c) => {
    const assigned = inWindow.filter((s) => assignCondition(e, s) === c.id).map((s) => s.summary);
    return {
      conditionId: c.id,
      sessionIds: assigned.map((s) => s.sessionId),
      ...conditionMetric(e.primaryMetric, assigned),
    };
  });

  return {
    experimentId: e.id,
    computedAt: now.toISOString(),
    perCondition,
    sufficientData: hasSufficientData(e, perCondition),
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
  };
}

/** Every condition needs at least the minimum number of observations and a computed value. */
export function hasSufficientData(
  e: Pick<Experiment, 'conditions' | 'minObservationsPerCondition'>,
  perCondition: readonly { conditionId: string; observations: number; metricValue: number | null }[],
): boolean {
  return e.conditions.every((c) => {
    const p = perCondition.find((x) => x.conditionId === c.id);
    return !!p && p.observations >= e.minObservationsPerCondition && p.metricValue !== null;
  });
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
    adherence: `During this experiment, you completed ${va} of the ${A} workouts you started (${pa.completed} of ${pa.planned}) compared with ${vb} of the ${B} workouts you started (${pb.completed} of ${pb.planned}).`,
    completion_ratio: `During this experiment, you finished on average ${va} of the sets in ${A} workouts compared with ${vb} in ${B} workouts.`,
    valid_rep_ratio: `During this experiment, ${va} of your reps in ${A} workouts were valid compared with ${vb} in ${B} workouts.`,
    effort: `During this experiment, your average effort rating was ${va} for ${A} workouts and ${vb} for ${B} workouts.`,
    enjoyment: `During this experiment, your average enjoyment rating was ${va} for ${A} workouts and ${vb} for ${B} workouts.`,
  };
  return [sentence[e.primaryMetric], OBSERVATION_CAVEAT];
}

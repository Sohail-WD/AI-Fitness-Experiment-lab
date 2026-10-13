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

/** Whether an ISO time falls inside a condition's time-of-day window (always true for conditions without one). */
function inTimeWindow(c: Condition, iso: string, tz: number): boolean {
  const t = c.parameters.timeOfDay;
  if (typeof t !== 'string') return true;
  const window = TIME_WINDOWS[t as keyof typeof TIME_WINDOWS];
  const h = localHour(iso, tz);
  return !!window && h >= window[0] && h < window[1];
}

/** A time-of-day condition only counts sessions that actually started in its window. */
const onProtocol = (c: Condition, s: ExperimentSession, tz: number) => inTimeWindow(c, s.summary.startedAt, tz);

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
 * on-protocol sessions (finished with real work, or still in progress). On a tie,
 * the condition whose time window contains `now` (the user's local time) is
 * preferred, so a workout generated in the evening is not sent to the morning;
 * otherwise A. Sessions that did not follow the protocol or did no genuine work
 * do not use up a slot. The assignment is fixed when the workout is generated;
 * the session's eventual start time never changes it.
 */
export function nextCondition(experiment: Experiment, all: readonly ExperimentSession[], now?: Date): 'A' | 'B' {
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
  const usedA = used(a);
  const usedB = used(b);
  if (usedA !== usedB) return usedB < usedA ? b.id : a.id;
  const current = now ? experiment.conditions.find((c) => typeof c.parameters.timeOfDay === 'string' && inTimeWindow(c, now.toISOString(), tz)) : undefined;
  return current?.id ?? a.id;
}

/**
 * Warning for starting an assigned workout now, or null when it is fine: the
 * experiment is still active and the condition's time window does not contain
 * `now`. A session started now would not count toward the experiment.
 */
export function timeWindowWarning(experiment: Experiment, conditionId: 'A' | 'B', now: Date): string | null {
  if (experiment.status !== 'active' || experiment.isSimulated) return null;
  const c = experiment.conditions.find((x) => x.id === conditionId);
  if (!c || typeof c.parameters.timeOfDay !== 'string') return null;
  const tz = experiment.timezoneOffsetMinutes ?? 0;
  if (inTimeWindow(c, now.toISOString(), tz)) return null;
  return (
    `This workout is assigned to ${c.label} for your experiment. Starting it now is outside that time window, ` +
    'so the session will not count toward the experiment. You can still do the workout, or start it within the window.'
  );
}

export interface AssignmentNotice {
  kind: 'info' | 'warning' | 'unknown';
  text: string;
}

/**
 * What Follow-Along tells the user about an assigned workout before they start it.
 * `experiment`: the assigned experiment; `null` if it no longer exists (or is not
 * this visitor's); `'unavailable'` if the experiment list could not be loaded.
 * - info: active real time-of-day experiment and `now` is inside the condition's window;
 * - warning: outside the window (the session would not count);
 * - unknown: the experiment could not be checked; the stored assignment label is shown;
 * - null: unassigned workout, duration condition, simulated or no-longer-active experiment.
 * Uses the experiment's stored timezone, exactly like observation counting.
 */
export function assignmentNotice(
  assignment: { experimentId: string; conditionId: 'A' | 'B'; label: string } | null,
  experiment: Experiment | null | 'unavailable',
  now: Date,
): AssignmentNotice | null {
  if (!assignment) return null;
  if (experiment === 'unavailable') {
    return {
      kind: 'unknown',
      text:
        `This workout is assigned to ${assignment.label} for your experiment, but the experiment could not be checked right now. ` +
        'It only counts if it follows that assignment (for a time-of-day condition: start it within that time window).',
    };
  }
  if (!experiment || experiment.id !== assignment.experimentId) return null;
  if (experiment.status !== 'active' || experiment.isSimulated) return null;
  const c = experiment.conditions.find((x) => x.id === assignment.conditionId);
  if (!c || typeof c.parameters.timeOfDay !== 'string') return null;
  const warning = timeWindowWarning(experiment, assignment.conditionId, now);
  if (warning) return { kind: 'warning', text: warning };
  return { kind: 'info', text: `This workout counts toward your experiment as ${c.label}. Start it within that time window.` };
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

  const tz = e.timezoneOffsetMinutes ?? 0;
  const perCondition = e.conditions.map((c) => {
    const assigned = inWindow.filter((s) => assignCondition(e, s) === c.id).map((s) => s.summary);
    // Real sessions of workouts assigned to this condition that were started outside its time window (not counted).
    const outsideWindow = e.isSimulated
      ? 0
      : inWindow.filter((s) => !s.summary.isSimulated && s.assignment?.experimentId === e.id && s.assignment.conditionId === c.id && !onProtocol(c, s, tz)).length;
    return {
      conditionId: c.id,
      sessionIds: assigned.map((s) => s.sessionId),
      ...conditionMetric(e.primaryMetric, assigned),
      ...(outsideWindow > 0 ? { excludedOutsideWindow: outsideWindow } : {}),
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

import type { CvExerciseConfig, RepThresholds } from './exercises/types';
import type { RepEvent, RepPhase } from './repCounter';

/**
 * Generic per-exercise logic around the (unchanged) rep state machine:
 * - rep direction: the counter always sees a DECREASING angle, so exercises
 *   whose angle increases (shoulder press) are mirrored (angle × −1);
 * - form rules with a `check`: the furthest value of each measurement during
 *   a rep is compared with the rule's limit when the rep ends.
 */

export const directionSign = (c: CvExerciseConfig): 1 | -1 => (c.repDirection === 'increasing' ? -1 : 1);

/** Thresholds in the counter's (decreasing) space. Identity for decreasing exercises. */
export function counterThresholds(c: CvExerciseConfig): RepThresholds {
  if (directionSign(c) === 1) return c.rep;
  return {
    ...c.rep,
    topEnterDeg: -c.rep.topEnterDeg,
    topExitDeg: -c.rep.topExitDeg,
    bottomEnterDeg: -c.rep.bottomEnterDeg,
    bottomExitDeg: -c.rep.bottomExitDeg,
  };
}

/**
 * Bilateral exercises: combine both sides' angles (counter space, decreasing)
 * into the one value the state machine sees, choosing the side that is
 * LAGGING for the current phase. Both sides must therefore reach the start
 * (min), both must leave it and reach the target (max), and both must leave
 * the target and return to the start (min). Timing differences only delay
 * transitions; a side that never moves blocks the rep.
 */
export function combineBilateral(phase: RepPhase, a: number, b: number): number {
  return phase === 'STANDING' || phase === 'DESCENDING' ? Math.max(a, b) : Math.min(a, b);
}

export type Extremes = Record<string, { min: number; max: number }>;

export function updateExtremes(extremes: Extremes, values: Record<string, number | null>): Extremes {
  const next = { ...extremes };
  for (const [code, v] of Object.entries(values)) {
    if (v === null) continue;
    const e = next[code];
    next[code] = e ? { min: Math.min(e.min, v), max: Math.max(e.max, v) } : { min: v, max: v };
  }
  return next;
}

export interface RuleViolation {
  code: string;
  feedback: string;
  invalidatesRep: boolean;
}

export function violatedRules(c: CvExerciseConfig, extremes: Extremes): RuleViolation[] {
  const out: RuleViolation[] = [];
  for (const rule of c.formRules) {
    const e = rule.check && extremes[rule.code];
    if (!rule.check || !e) continue;
    const violated = rule.check.bound === 'min' ? e.min < rule.check.limitDeg : e.max > rule.check.limitDeg;
    if (violated) out.push({ code: rule.code, feedback: rule.feedback, invalidatesRep: rule.check.invalidatesRep });
  }
  return out;
}

/** A rep event in natural angle units, with its form verdict and a short feedback message. */
export type CvRepEvent = RepEvent & { valid: boolean; formIssues: string[]; feedback: string };

const feedbackFor = (c: CvExerciseConfig, code: string, fallback: string) =>
  c.formRules.find((r) => r.code === code)?.feedback ?? fallback;

export function annotateEvent(c: CvExerciseConfig, counterEvent: RepEvent, extremes: Extremes): CvRepEvent {
  const sign = directionSign(c);
  switch (counterEvent.type) {
    case 'tracking_reset':
      return { ...counterEvent, valid: false, formIssues: [], feedback: 'Tracking lost. Rep in progress discarded.' };
    case 'rejected_too_fast':
      return {
        ...counterEvent,
        valid: false,
        formIssues: [c.issueCodes.tooFast],
        feedback: feedbackFor(c, c.issueCodes.tooFast, 'Slow down the movement.'),
      };
    case 'partial': {
      const violations = violatedRules(c, extremes);
      return {
        ...counterEvent,
        minAngleDeg: sign * counterEvent.minAngleDeg,
        valid: false,
        formIssues: [c.issueCodes.partial, ...violations.map((v) => v.code)],
        feedback: feedbackFor(c, c.issueCodes.partial, 'Rep not counted: range not reached.'),
      };
    }
    case 'rep': {
      const violations = violatedRules(c, extremes);
      const invalidating = violations.find((v) => v.invalidatesRep);
      return {
        ...counterEvent,
        minAngleDeg: sign * counterEvent.minAngleDeg,
        valid: !invalidating,
        formIssues: violations.map((v) => v.code),
        feedback: (invalidating ?? violations[0])?.feedback ?? 'Good rep.',
      };
    }
  }
}

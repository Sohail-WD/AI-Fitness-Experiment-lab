import type { RepThresholds } from './exercises/types';

/**
 * Movement phases for an exercise whose primary angle decreases from the top
 * position to the bottom position. UNKNOWN = not yet seen at the top, so
 * nothing is counted until the user is first observed standing.
 */
export type RepPhase = 'UNKNOWN' | 'STANDING' | 'DESCENDING' | 'BOTTOM' | 'ASCENDING';

export type RepEvent =
  | { type: 'rep'; durationMs: number; minAngleDeg: number }
  | { type: 'partial'; minAngleDeg: number }
  | { type: 'rejected_too_fast'; durationMs: number }
  | { type: 'tracking_reset' };

export interface RepCounterState {
  phase: RepPhase;
  validReps: number;
  partialReps: number;
  rejectedReps: number;
  /** Time the current rep left the top position. */
  repStartMs: number | null;
  /** Lowest primary angle seen during the current rep. */
  minAngleDeg: number | null;
  depthReached: boolean;
  lastReliableMs: number | null;
  /** Event produced by the most recent step, if any. */
  lastEvent: RepEvent | null;
}

export interface RepInput {
  timestampMs: number;
  /** Primary joint angle; null when the frame is not reliable enough to measure. */
  angleDeg: number | null;
}

export function initialRepState(): RepCounterState {
  return {
    phase: 'UNKNOWN',
    validReps: 0,
    partialReps: 0,
    rejectedReps: 0,
    repStartMs: null,
    minAngleDeg: null,
    depthReached: false,
    lastReliableMs: null,
    lastEvent: null,
  };
}

const CLEARED_REP = { repStartMs: null, minAngleDeg: null, depthReached: false } as const;

/** Close the current rep on returning to the top position. */
function finishRep(state: RepCounterState, t: number, minAngle: number, rep: RepThresholds): RepCounterState {
  const base = { ...state, ...CLEARED_REP, phase: 'STANDING' as const };
  if (!state.depthReached) {
    return { ...base, partialReps: state.partialReps + 1, lastEvent: { type: 'partial', minAngleDeg: minAngle } };
  }
  const durationMs = t - (state.repStartMs ?? t);
  if (durationMs < rep.minRepDurationMs) {
    return { ...base, rejectedReps: state.rejectedReps + 1, lastEvent: { type: 'rejected_too_fast', durationMs } };
  }
  return { ...base, validReps: state.validReps + 1, lastEvent: { type: 'rep', durationMs, minAngleDeg: minAngle } };
}

/**
 * Pure, deterministic state-machine step. Unreliable frames (angleDeg = null)
 * freeze the machine; if they persist past trackingLossResetMs, any
 * in-progress rep is discarded and the user must be seen standing again.
 */
export function stepRepCounter(
  state: RepCounterState,
  input: RepInput,
  rep: RepThresholds,
  trackingLossResetMs: number,
): RepCounterState {
  const t = input.timestampMs;
  const angle = input.angleDeg;
  const s: RepCounterState = { ...state, lastEvent: null };

  if (angle === null) {
    const lostFor = s.lastReliableMs === null ? 0 : t - s.lastReliableMs;
    if (s.phase !== 'UNKNOWN' && lostFor > trackingLossResetMs) {
      return { ...s, ...CLEARED_REP, phase: 'UNKNOWN', lastEvent: { type: 'tracking_reset' } };
    }
    return s;
  }

  s.lastReliableMs = t;
  const minAngle = Math.min(s.minAngleDeg ?? angle, angle);

  switch (s.phase) {
    case 'UNKNOWN':
      return angle >= rep.topEnterDeg ? { ...s, phase: 'STANDING' } : s;

    case 'STANDING':
      if (angle >= rep.topExitDeg) return s;
      return {
        ...s,
        phase: angle <= rep.bottomEnterDeg ? 'BOTTOM' : 'DESCENDING',
        repStartMs: t,
        minAngleDeg: angle,
        depthReached: angle <= rep.bottomEnterDeg,
      };

    case 'DESCENDING':
      if (angle <= rep.bottomEnterDeg) return { ...s, phase: 'BOTTOM', minAngleDeg: minAngle, depthReached: true };
      if (angle >= rep.topEnterDeg) return finishRep(s, t, minAngle, rep);
      if (angle - minAngle >= rep.reversalDeg) return { ...s, phase: 'ASCENDING', minAngleDeg: minAngle };
      return { ...s, minAngleDeg: minAngle };

    case 'BOTTOM':
      if (angle >= rep.topEnterDeg) return finishRep(s, t, minAngle, rep);
      if (angle > rep.bottomExitDeg) return { ...s, phase: 'ASCENDING', minAngleDeg: minAngle };
      return { ...s, minAngleDeg: minAngle };

    case 'ASCENDING':
      if (angle >= rep.topEnterDeg) return finishRep(s, t, minAngle, rep);
      if (angle <= rep.bottomEnterDeg) return { ...s, phase: 'BOTTOM', minAngleDeg: minAngle, depthReached: true };
      return { ...s, minAngleDeg: minAngle };
  }
}

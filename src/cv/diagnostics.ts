import type { FrameAnalysis } from './analyzeFrame';
import type { CvExerciseConfig } from './exercises/types';
import type { SetupStatus } from './setupCheck';

/**
 * Running summary of a session, used to see why reps are or aren't counted
 * and to calibrate thresholds against real movement.
 */
export interface Diagnostics {
  frames: number;
  framesByStatus: Record<SetupStatus, number>;
  /** Range of the raw primary angle over all frames with a person, whether or not setup passed. */
  rawAngleMinDeg: number | null;
  rawAngleMaxDeg: number | null;
  /** Range of the primary angle over frames that passed setup (what the counter saw). */
  countedAngleMinDeg: number | null;
  countedAngleMaxDeg: number | null;
}

export function initialDiagnostics(): Diagnostics {
  return {
    frames: 0,
    framesByStatus: { ok: 0, no_person: 0, low_visibility: 0, out_of_frame: 0, wrong_view: 0 },
    rawAngleMinDeg: null,
    rawAngleMaxDeg: null,
    countedAngleMinDeg: null,
    countedAngleMaxDeg: null,
  };
}

const min = (a: number | null, b: number | null) => (b === null ? a : a === null ? b : Math.min(a, b));
const max = (a: number | null, b: number | null) => (b === null ? a : a === null ? b : Math.max(a, b));

const BLOCKER_LABEL: Record<Exclude<SetupStatus, 'ok'>, string> = {
  no_person: 'no person detected',
  low_visibility: 'low landmark visibility',
  out_of_frame: 'body partly out of frame',
  wrong_view: 'not side-on to the camera',
};

/** Plain-language explanation of the most likely reason reps are not being counted. */
export function diagnoseCounting(d: Diagnostics, exercise: CvExerciseConfig): string {
  if (d.frames < 30) return 'Collecting data… do a few reps.';

  const { ok, ...blocked } = d.framesByStatus;
  const [topBlocker, topCount] = (Object.entries(blocked) as [Exclude<SetupStatus, 'ok'>, number][]).sort(
    (a, b) => b[1] - a[1],
  )[0];
  const pct = (n: number) => Math.round((n / d.frames) * 100);
  const { topEnterDeg, bottomEnterDeg } = exercise.rep;
  const fmt = (deg: number | null) => (deg === null ? '—' : `${Math.round(deg)}°`);

  if (ok < d.frames / 2) {
    return `Counting is blocked in ${pct(d.frames - ok)}% of frames, mostly by: ${BLOCKER_LABEL[topBlocker]} (${pct(topCount)}%).`;
  }
  const angle = exercise.primaryAngle.label.toLowerCase();
  if (exercise.repDirection === 'increasing') {
    const start = exercise.phaseLabels?.top ?? 'Start position';
    const target = exercise.phaseLabels?.target ?? 'Target position';
    if (d.countedAngleMinDeg === null || d.countedAngleMinDeg > topEnterDeg) {
      return `${start} not recognised: lowest ${angle} ${fmt(d.countedAngleMinDeg)}, needs ≤ ${topEnterDeg}°.`;
    }
    if (d.countedAngleMaxDeg === null || d.countedAngleMaxDeg < bottomEnterDeg) {
      return `${target} not reached in usable frames: highest ${angle} ${fmt(d.countedAngleMaxDeg)}, needs ≥ ${bottomEnterDeg}°.`;
    }
    return 'Start and target thresholds are both being reached. See "Last event" for why a rep was not counted.';
  }
  if (d.countedAngleMaxDeg === null || d.countedAngleMaxDeg < topEnterDeg) {
    return `Standing position not recognised: highest ${angle} ${fmt(d.countedAngleMaxDeg)}, needs ≥ ${topEnterDeg}°.`;
  }
  if (d.countedAngleMinDeg === null || d.countedAngleMinDeg > bottomEnterDeg) {
    const rawNote =
      d.rawAngleMinDeg !== null && d.rawAngleMinDeg <= bottomEnterDeg
        ? ` Depth was seen (${fmt(d.rawAngleMinDeg)}) only in frames that failed setup checks (mostly: ${BLOCKER_LABEL[topBlocker]}).`
        : '';
    return `Depth not reached in usable frames: lowest ${angle} ${fmt(d.countedAngleMinDeg)}, needs ≤ ${bottomEnterDeg}°.${rawNote}`;
  }
  return 'Standing and depth thresholds are both being reached. See "Last event" for why a rep was not counted.';
}

export function updateDiagnostics(d: Diagnostics, analysis: FrameAnalysis): Diagnostics {
  return {
    frames: d.frames + 1,
    framesByStatus: { ...d.framesByStatus, [analysis.setup.status]: d.framesByStatus[analysis.setup.status] + 1 },
    rawAngleMinDeg: min(d.rawAngleMinDeg, analysis.rawPrimaryAngleDeg),
    rawAngleMaxDeg: max(d.rawAngleMaxDeg, analysis.rawPrimaryAngleDeg),
    countedAngleMinDeg: min(d.countedAngleMinDeg, analysis.primaryAngleDeg),
    countedAngleMaxDeg: max(d.countedAngleMaxDeg, analysis.primaryAngleDeg),
  };
}

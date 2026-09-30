import type { ExerciseSetResult } from '../../shared/schemas/metrics';
import { analyzeFrame, type FrameAnalysis } from './analyzeFrame';
import { type Diagnostics, initialDiagnostics, updateDiagnostics } from './diagnostics';
import type { CvExerciseConfig } from './exercises/types';
import {
  annotateEvent,
  combineBilateral,
  counterThresholds,
  type CvRepEvent,
  directionSign,
  type Extremes,
  updateExtremes,
} from './formCheck';
import { initialRepState, type RepCounterState, stepRepCounter } from './repCounter';
import { accumulateRepEvent, initialSetAccumulator, type SetAccumulator, toExerciseSetResult } from './setSummary';
import { LandmarkSmoother } from './smoothing';
import type { FrameSize, Landmark } from './types';

export interface ProcessedFrame {
  landmarks: Landmark[] | null;
  analysis: FrameAnalysis;
  /** Rep state machine state (angles in the counter's decreasing space). */
  reps: RepCounterState;
  diagnostics: Diagnostics;
  /** Most recent rep events (oldest first), in natural angle units, with form verdicts. */
  eventLog: CvRepEvent[];
  /** Rep event produced by this frame, if any. */
  event: CvRepEvent | null;
  /** Running set totals after form checks (the counts to show and act on). */
  set: SetAccumulator;
}

const EVENT_LOG_LIMIT = 20;
const IN_REP = new Set(['DESCENDING', 'BOTTOM', 'ASCENDING']);

/**
 * Framework-free pipeline for one exercise:
 * landmarks → smoothing → setup check + angles → rep state machine → form checks.
 * Deterministic given the same inputs, so it can be driven by recorded data.
 */
export class FrameProcessor {
  private readonly smoother = new LandmarkSmoother(0.5);
  private reps: RepCounterState = initialRepState();
  private diagnostics: Diagnostics = initialDiagnostics();
  private eventLog: CvRepEvent[] = [];
  private setAccumulator: SetAccumulator = initialSetAccumulator();
  private extremes: Extremes = {};
  private readonly exercise: CvExerciseConfig;
  private readonly sign: 1 | -1;

  constructor(exercise: CvExerciseConfig) {
    this.exercise = exercise;
    this.sign = directionSign(exercise);
  }

  process(rawLandmarks: Landmark[] | null, frame: FrameSize, timestampMs: number): ProcessedFrame {
    let landmarks: Landmark[] | null = null;
    if (rawLandmarks) {
      landmarks = this.smoother.smooth(rawLandmarks);
    } else {
      this.smoother.reset();
    }

    const analysis = analyzeFrame(landmarks, frame, this.exercise);
    this.reps = stepRepCounter(
      this.reps,
      { timestampMs, angleDeg: this.counterAngle(analysis) },
      counterThresholds(this.exercise),
      this.exercise.setup.trackingLossResetMs,
    );
    this.diagnostics = updateDiagnostics(this.diagnostics, analysis);

    // Form rules: track each measurement's extremes while a rep is in progress.
    const inRep = IN_REP.has(this.reps.phase);
    if (inRep || this.reps.lastEvent) this.extremes = updateExtremes(this.extremes, analysis.ruleValues);

    let event: CvRepEvent | null = null;
    if (this.reps.lastEvent) {
      event = annotateEvent(this.exercise, this.reps.lastEvent, this.extremes);
      this.eventLog = [...this.eventLog, event].slice(-EVENT_LOG_LIMIT);
      this.setAccumulator = accumulateRepEvent(this.setAccumulator, event, this.sign);
      this.extremes = {};
    } else if (!inRep) {
      this.extremes = {};
    }

    return {
      landmarks,
      analysis,
      reps: this.reps,
      diagnostics: this.diagnostics,
      eventLog: this.eventLog,
      event,
      set: this.setAccumulator,
    };
  }

  /** Angle fed to the rep state machine, in its (decreasing) space; null when unreliable. */
  private counterAngle(analysis: FrameAnalysis): number | null {
    if (!this.exercise.bilateral) {
      return analysis.primaryAngleDeg === null ? null : this.sign * analysis.primaryAngleDeg;
    }
    const both = analysis.bilateralAnglesDeg;
    if (!both || both.left === null || both.right === null) return null;
    return combineBilateral(this.reps.phase, this.sign * both.left, this.sign * both.right);
  }

  /** Structured result of everything processed since the last reset (the CV boundary). */
  setResult(): ExerciseSetResult {
    const issueOrder = [
      this.exercise.issueCodes.partial,
      this.exercise.issueCodes.tooFast,
      ...this.exercise.formRules.map((r) => r.code),
    ];
    return toExerciseSetResult(this.exercise.id, this.setAccumulator, this.diagnostics, this.sign, issueOrder);
  }

  reset(): void {
    this.smoother.reset();
    this.reps = initialRepState();
    this.diagnostics = initialDiagnostics();
    this.eventLog = [];
    this.setAccumulator = initialSetAccumulator();
    this.extremes = {};
  }
}

import type { CvExerciseConfig } from '../cv/exercises/types';
import type { CvRepEvent } from '../cv/formCheck';
import type { RepEvent, RepPhase } from '../cv/repCounter';
import type { SessionSnapshot } from '../hooks/usePoseSession';

const PHASE_LABEL: Record<RepPhase, string> = {
  UNKNOWN: 'Waiting — stand up straight to begin',
  STANDING: 'Standing',
  DESCENDING: 'Descending',
  BOTTOM: 'Bottom',
  ASCENDING: 'Ascending',
};

/** Phase label from the exercise config, falling back to the squat wording. */
export function phaseLabel(phase: RepPhase, exercise: CvExerciseConfig): string {
  const l = exercise.phaseLabels;
  if (!l) return PHASE_LABEL[phase];
  const byPhase: Record<RepPhase, string> = {
    UNKNOWN: `Waiting — get into the start position (${l.top.toLowerCase()})`,
    STANDING: l.top,
    DESCENDING: l.toTarget,
    BOTTOM: l.target,
    ASCENDING: l.toTop,
  };
  return byPhase[phase];
}

/**
 * @param angleLabel Name of the exercise's primary angle, e.g. "Thigh angle".
 * @param direction  Whether the angle decreases (default) or increases towards the target.
 */
export function describeEvent(
  event: RepEvent | CvRepEvent | null,
  angleLabel: string,
  direction: 'decreasing' | 'increasing' = 'decreasing',
): string {
  if (!event) return '—';
  const extreme = direction === 'increasing' ? 'highest' : 'lowest';
  const lowest = (deg: number) => `${extreme} ${angleLabel.toLowerCase()} ${Math.round(deg)}°`;
  switch (event.type) {
    case 'rep':
      if ('valid' in event && !event.valid) return `Not counted: ${event.feedback} (${lowest(event.minAngleDeg)})`;
      return `Rep counted (${(event.durationMs / 1000).toFixed(1)} s, ${lowest(event.minAngleDeg)})${
        'formIssues' in event && event.formIssues.length > 0 ? `: ${event.feedback}` : ''
      }`;
    case 'partial':
      return `Not counted: ${direction === 'increasing' ? 'full range' : 'depth'} not reached (${lowest(event.minAngleDeg)})`;
    case 'rejected_too_fast':
      return `Not counted: movement too fast to be a real rep (${event.durationMs} ms)`;
    case 'tracking_reset':
      return 'Tracking lost — rep in progress discarded';
  }
}

export const fmtAngle = (deg: number | null) => (deg === null ? '—' : `${Math.round(deg)}°`);

interface StatusPanelProps {
  snapshot: SessionSnapshot;
  running: boolean;
  exercise: CvExerciseConfig;
}

export function StatusPanel({ snapshot, running, exercise }: StatusPanelProps) {
  const { frame, lastEvent, fps } = snapshot;
  const reps = frame?.reps;
  const setup = frame?.analysis.setup;
  const setupOk = setup?.status === 'ok';
  const angleLabel = exercise.primaryAngle.label;

  return (
    <section className="panel" aria-label="Tracking status">
      <div className="rep-count">
        <span className="rep-number" aria-live="polite">
          {frame?.set.validReps ?? 0}
        </span>
        <span className="rep-label">valid reps</span>
      </div>

      <dl className="stats">
        <dt>Partial / rejected</dt>
        <dd>
          {reps?.partialReps ?? 0} / {reps?.rejectedReps ?? 0}
        </dd>
        <dt>Invalid reps (all reasons)</dt>
        <dd>{frame?.set.invalidReps ?? 0}</dd>
        <dt>Movement state</dt>
        <dd>{reps ? phaseLabel(reps.phase, exercise) : '—'}</dd>
        <dt>
          {angleLabel}
          {exercise.primaryAngle.kind === 'segmentFromHorizontal' && ' (0° = parallel)'}
        </dt>
        <dd>{fmtAngle(frame?.analysis.primaryAngleDeg ?? null)}</dd>
        <dt>Knee angle (info only)</dt>
        <dd>{fmtAngle(frame?.analysis.kneeAngleDeg ?? null)}</dd>
        <dt>Hip angle (info only)</dt>
        <dd>{fmtAngle(frame?.analysis.hipAngleDeg ?? null)}</dd>
        <dt>Tracked side</dt>
        <dd>{frame?.analysis.side ?? '—'}</dd>
        <dt>Pose confidence</dt>
        <dd>{setup ? `${Math.round(setup.confidence * 100)}%` : '—'}</dd>
        <dt>Processing rate</dt>
        <dd>{running ? `${fps.toFixed(0)} fps` : '—'}</dd>
      </dl>

      <p className={`setup ${setupOk ? 'setup-ok' : 'setup-warn'}`} role="status">
        {running ? (setup?.message ?? 'Starting…') : 'Camera off'}
      </p>
      <p className="last-event">
        <strong>Last event:</strong> {describeEvent(lastEvent, angleLabel, exercise.repDirection)}
      </p>
    </section>
  );
}

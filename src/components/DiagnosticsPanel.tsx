import { diagnoseCounting } from '../cv/diagnostics';
import type { CvExerciseConfig } from '../cv/exercises/types';
import type { ProcessedFrame } from '../cv/frameProcessor';
import { describeEvent, fmtAngle } from './StatusPanel';

const fmtRange = (lo: number | null, hi: number | null) => `${fmtAngle(lo)} – ${fmtAngle(hi)}`;

/** Calibration aid for M0: shows why reps are or aren't being counted. */
export function DiagnosticsPanel({ frame, exercise }: { frame: ProcessedFrame | null; exercise: CvExerciseConfig }) {
  if (!frame) return null;
  const d = frame.diagnostics;
  const m = frame.analysis.setup.measurements;
  const pct = (n: number) => (d.frames ? `${Math.round((n / d.frames) * 100)}%` : '—');
  const { rep, setup } = exercise;
  const label = exercise.primaryAngle.label;

  return (
    <section className="panel diagnostics" aria-label="Diagnostics">
      <h2>Diagnostics</h2>
      <p className="diagnosis">{diagnoseCounting(d, exercise)}</p>
      <dl className="stats">
        <dt>Usable frames</dt>
        <dd>{pct(d.framesByStatus.ok)}</dd>
        <dt>Out of frame</dt>
        <dd>{pct(d.framesByStatus.out_of_frame)}</dd>
        <dt>Low visibility</dt>
        <dd>{pct(d.framesByStatus.low_visibility)}</dd>
        <dt>Not side-on</dt>
        <dd>{pct(d.framesByStatus.wrong_view)}</dd>
        <dt>No person</dt>
        <dd>{pct(d.framesByStatus.no_person)}</dd>
        <dt>{label} range, usable frames</dt>
        <dd>{fmtRange(d.countedAngleMinDeg, d.countedAngleMaxDeg)}</dd>
        <dt>{label} range, all frames</dt>
        <dd>{fmtRange(d.rawAngleMinDeg, d.rawAngleMaxDeg)}</dd>
        <dt>{label} now (ignoring setup checks)</dt>
        <dd>{fmtAngle(frame.analysis.rawPrimaryAngleDeg)}</dd>
        <dt>Weakest joint visibility</dt>
        <dd>
          {m ? `${m.weakestJoint} ${m.weakestVisibility.toFixed(2)}` : '—'} (need ≥ {setup.minVisibility})
        </dd>
        <dt>Side-view ratio</dt>
        <dd>
          {m?.spreadRatio != null ? m.spreadRatio.toFixed(2) : '—'} (need ≤ {setup.maxSideViewSpreadRatio})
        </dd>
      </dl>
      <h3>Rep log (newest first)</h3>
      {frame.eventLog.length === 0 ? (
        <p className="hint">No reps yet.</p>
      ) : (
        <ol className="event-log" reversed>
          {[...frame.eventLog].reverse().map((event, i) => (
            <li key={frame.eventLog.length - i} className={`event-${event.type}`}>
              {describeEvent(event, label, exercise.repDirection)}
            </li>
          ))}
        </ol>
      )}
      <p className="hint">
        {exercise.repDirection === 'increasing'
          ? `Counting needs ${label.toLowerCase()} ≤ ${rep.topEnterDeg}° at the start and ≥ ${rep.bottomEnterDeg}° at the target.`
          : `Counting needs ${label.toLowerCase()} ≥ ${rep.topEnterDeg}° at the start and ≤ ${rep.bottomEnterDeg}° at the target.`}
        {exercise.primaryAngle.kind === 'segmentFromHorizontal' && ' (0° = parallel to the floor.)'} Press "Reset count" to
        clear these statistics.
      </p>
    </section>
  );
}

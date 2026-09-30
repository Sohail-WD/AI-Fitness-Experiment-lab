import { useEffect, useRef } from 'react';
import type { ExerciseSetResult } from '../../shared/schemas/metrics';
import { describeEvent, phaseLabel } from '../components/StatusPanel';
import type { CvExerciseConfig } from '../cv/exercises/types';
import { formStatus, setupChecklist } from '../cv/coach';
import { usePoseSession } from '../hooks/usePoseSession';
import { useCoach } from './useCoach';
import { useVoice } from './useVoice';

interface CvSetTrackerProps {
  exercise: CvExerciseConfig;
  /** Changes whenever a new set starts; counts reset then. */
  setAttempt: number;
  working: boolean;
  paused: boolean;
  targetReps: number;
  onComplete: (result: ExerciseSetResult) => void;
}

/**
 * Camera set tracking with the shared CV pipeline (usePoseSession + the
 * exercise's CV config). Mount with key={exerciseId} so each exercise gets its
 * own processor.
 */
export function CvSetTracker({ exercise, setAttempt, working, paused, targetReps, onComplete }: CvSetTrackerProps) {
  const { videoRef, canvasRef, status, error, snapshot, start, resetCount, getSetResult } = usePoseSession(exercise);
  const completedAttempt = useRef<number | null>(null);

  // Start the camera automatically (deferred so React StrictMode's double mount starts it once).
  useEffect(() => {
    const timer = window.setTimeout(() => void start(), 0);
    return () => window.clearTimeout(timer);
  }, [start]);

  useEffect(() => {
    resetCount();
  }, [setAttempt, resetCount]);

  const set = snapshot.frame?.set;
  const validReps = set?.validReps ?? 0;
  const canComplete = working && !paused && completedAttempt.current !== setAttempt;

  const complete = () => {
    if (!canComplete) return;
    completedAttempt.current = setAttempt;
    onComplete(getSetResult());
  };

  // Auto-complete the set once the target number of valid reps is reached.
  useEffect(() => {
    if (validReps >= targetReps && canComplete) complete();
  });

  const voice = useVoice();
  const coach = useCoach(exercise, snapshot, working && !paused, voice.speak);

  const setup = snapshot.frame?.analysis.setup;
  const phase = snapshot.frame?.reps.phase;
  const checklist = setupChecklist(exercise, status === 'running' ? (setup?.status ?? null) : null);
  return (
    <div className="cv-tracker">
      <div className="stage">
        <div className="mirror">
          <video ref={videoRef} playsInline muted aria-label="Camera feed" />
          <canvas ref={canvasRef} aria-hidden="true" />
        </div>
        {status !== 'running' && (
          <div className="stage-placeholder">{status === 'starting' ? 'Starting camera…' : 'Camera off'}</div>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error} You can still finish the set with the button below.
        </p>
      )}
      <div className="cv-counts" aria-live="polite">
        <span>
          <strong>{validReps}</strong> / {targetReps} valid reps
        </span>
        <span>{set?.invalidReps ?? 0} not counted</span>
        {phase && <span>{phaseLabel(phase, exercise)}</span>}
      </div>
      {!coach.setupReady && (
        <section className="setup-card" aria-label="Camera setup">
          <h5>Camera setup</h5>
          <p className="hint">{exercise.setupInstructions}</p>
          <ul className="checklist">
            {checklist.map((item) => (
              <li key={item.label} className={`check-${item.state}`}>
                <span aria-hidden="true">{item.state === 'ok' ? '✓' : item.state === 'fail' ? '✗' : '…'}</span>{' '}
                {item.label}
                <span className="visually-hidden"> ({item.state === 'unknown' ? 'not checked yet' : item.state})</span>
              </li>
            ))}
          </ul>
          <p className="hint">
            Reps are counted only while all checks pass. If tracking can't start, use “Complete set” below.
          </p>
        </section>
      )}

      <section className="coach" aria-label="Coaching">
        <div className="coach-row">
          <span className="coach-status">
            <strong>Form:</strong> {formStatus(coach, performance.now())}
          </span>
          <span className={`setup ${setup?.status === 'ok' ? 'setup-ok' : 'setup-warn'}`}>
            <strong>Camera:</strong> {status === 'running' ? (setup?.message ?? 'Starting…') : status === 'starting' ? 'Starting…' : 'Off'}
          </span>
          {voice.supported ? (
            <button type="button" className="secondary voice-toggle" aria-pressed={voice.enabled} onClick={voice.toggle}>
              Voice: {voice.enabled ? 'on' : 'off'}
            </button>
          ) : (
            <span className="hint">Voice not supported in this browser</span>
          )}
        </div>
        <p className={`coach-message coach-${coach.current?.priority ?? 'none'}`} role="status" aria-live="polite">
          {coach.current?.text ?? (coach.setupReady ? 'Tracking. Start your reps.' : 'Waiting for camera setup…')}
        </p>
      </section>

      <p className="last-event">
        <strong>Last:</strong> {describeEvent(snapshot.lastEvent, exercise.primaryAngle.label, exercise.repDirection)}
      </p>
      <button type="button" onClick={complete} disabled={!canComplete}>
        Complete set
      </button>
    </div>
  );
}

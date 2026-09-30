import { useState } from 'react';
import { curlCv, lungeCv, pressCv, pushUpCvExperimental } from '../../shared/exercises/cvConfigs';
import { DiagnosticsPanel } from '../components/DiagnosticsPanel';
import { StatusPanel } from '../components/StatusPanel';
import { squat } from '../cv/exercises/squat';
import type { CvExerciseConfig } from '../cv/exercises/types';
import { usePoseSession } from '../hooks/usePoseSession';

const LAB_EXERCISES: CvExerciseConfig[] = [squat, lungeCv, curlCv, pressCv, pushUpCvExperimental];

/** Computer-vision test bench: live tracking, rep counting and diagnostics for each CV exercise. */
export function CvLabPage() {
  const [exerciseId, setExerciseId] = useState(squat.id);
  const exercise = LAB_EXERCISES.find((e) => e.id === exerciseId) ?? squat;

  return (
    <>
      <div className="page-header">
        <h2>CV Lab</h2>
        <p className="subtitle">On-device pose tracking · test each exercise's rep counting and form checks</p>
      </div>
      <label className="field lab-select">
        <span>Exercise</span>
        <select value={exerciseId} onChange={(e) => setExerciseId(e.target.value)}>
          {LAB_EXERCISES.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>
      {/* Keyed so switching exercise stops the camera and starts a fresh processor. */}
      <CvLabBench key={exercise.id} exercise={exercise} />
    </>
  );
}

function CvLabBench({ exercise }: { exercise: CvExerciseConfig }) {
  const { videoRef, canvasRef, status, error, delegate, snapshot, start, stop, resetCount } = usePoseSession(exercise);
  const running = status === 'running';

  return (
    <div className="layout">
      <div className="stage">
        {/* Mirrored like a selfie view; video and overlay share the same transform. */}
        <div className="mirror">
          <video ref={videoRef} playsInline muted aria-label="Camera feed" />
          <canvas ref={canvasRef} aria-hidden="true" />
        </div>
        {!running && <div className="stage-placeholder">{status === 'starting' ? 'Loading pose model…' : 'Camera off'}</div>}
      </div>

      <aside>
        <div className="controls">
          {running ? (
            <button type="button" onClick={stop}>
              Stop camera
            </button>
          ) : (
            <button type="button" onClick={start} disabled={status === 'starting'}>
              {status === 'starting' ? 'Starting…' : 'Start camera'}
            </button>
          )}
          <button type="button" className="secondary" onClick={resetCount} disabled={!running}>
            Reset count
          </button>
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <StatusPanel snapshot={snapshot} running={running} exercise={exercise} />
        <DiagnosticsPanel frame={snapshot.frame} exercise={exercise} />

        <section className="guidance">
          <h2>Setup</h2>
          <p>{exercise.setupInstructions}</p>
          <p className="privacy">
            Video is processed in this browser only. No frames are recorded or uploaded.
            {delegate && ` Inference: ${delegate}.`}
          </p>
        </section>
      </aside>
    </div>
  );
}

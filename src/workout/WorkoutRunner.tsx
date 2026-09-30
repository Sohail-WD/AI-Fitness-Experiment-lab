import { useEffect, useReducer, useRef, useState } from 'react';
import type { Workout } from '../../shared/schemas/workout';
import { findExercise } from '../../shared/exercises/library';
import { CvSetTracker } from './CvSetTracker';
import {
  buildPerformanceMetrics,
  currentItem,
  initialRunnerState,
  type RunnerItem,
  type RunnerState,
  runnerReducer,
  totalSets,
} from './runner';
import { completeSession, sendEvents } from './sessionApi';

const TICK_MS = 250;
const now = () => new Date().toISOString();
const fmtClock = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function toRunnerItems(workout: Workout): RunnerItem[] {
  return workout.items.map((item) => {
    const exercise = findExercise(item.exerciseId);
    return { ...item, name: exercise?.name ?? item.exerciseId, perSide: exercise?.perSide ?? false, hasCv: !!exercise?.cv };
  });
}

/** Sends new log entries in order, then completes the session once the runner is done. */
function useSessionRecorder(sessionId: string, state: RunnerState, onSaved: () => void) {
  const sent = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const completed = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const batch = state.log.slice(sent.current);
    if (batch.length > 0) {
      sent.current = state.log.length;
      queue.current = queue.current.then(() => sendEvents(sessionId, batch)).catch(() => setSaveError('Some events could not be saved.'));
    }
    if (state.phase === 'done' && !completed.current) {
      completed.current = true;
      const status = state.outcome === 'completed' ? 'completed' : 'abandoned';
      queue.current = queue.current
        .then(() => completeSession(sessionId, status, buildPerformanceMetrics(state, sessionId)))
        .catch(() => setSaveError('The session result could not be saved.'))
        .finally(onSaved);
    }
  }, [sessionId, state, onSaved]);

  return saveError;
}

export function WorkoutRunner({
  workout,
  sessionId,
  onFinished,
}: {
  workout: Workout;
  sessionId: string;
  onFinished: (state: RunnerState) => void;
}) {
  const [state, dispatch] = useReducer(runnerReducer, workout, (w) => initialRunnerState(toRunnerItems(w)));
  const [saved, setSaved] = useState(false);
  const saveError = useSessionRecorder(sessionId, state, () => setSaved(true));

  // Clock: advances timers and active time while working or resting.
  useEffect(() => {
    if (state.phase !== 'work' && state.phase !== 'rest') return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const t = performance.now();
      dispatch({ type: 'tick', at: now(), deltaMs: t - last });
      last = t;
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [state.phase]);

  useEffect(() => {
    if (state.phase === 'done' && saved) onFinished(state);
  }, [state, saved, onFinished]);

  const item = currentItem(state);
  const planned = totalSets(state);
  const progress = planned > 0 ? state.sets.length / planned : 0;
  const working = state.phase === 'work';
  const cvConfig = item?.hasCv ? findExercise(item.exerciseId)?.cv : null;

  if (state.phase === 'done') return <p className="subtitle">Saving session…</p>;

  return (
    <div className="runner">
      <div className="runner-top">
        <h3>{workout.title}</h3>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={planned} aria-valuenow={state.sets.length}>
          <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
        </div>
        <p className="subtitle">
          {state.sets.length} of {planned} sets done · exercise {Math.min(state.itemIndex + 1, state.items.length)} of{' '}
          {state.items.length}
        </p>
      </div>

      {state.phase === 'ready' && item && (
        <div className="panel runner-card">
          <p>First up: <strong>{item.name}</strong>. {item.hasCv && 'This exercise is tracked by the camera.'}</p>
          <button type="button" onClick={() => dispatch({ type: 'start', at: now() })}>
            Begin
          </button>
        </div>
      )}

      {(working || state.phase === 'rest') && item && (
        <div className="panel runner-card">
          <p className="runner-label">
            {state.phase === 'rest' ? 'Rest · up next' : item.section === 'main' ? 'Exercise' : item.section === 'warmup' ? 'Warm-up' : 'Cool-down'}
            {state.paused && ' · Paused'}
          </p>
          <h4 className="runner-exercise">{item.name}</h4>
          <p className="runner-set">
            Set {state.setIndex + 1} of {item.sets} ·{' '}
            {item.target.type === 'reps' ? `${item.target.reps} reps` : `${item.target.seconds} s`}
            {item.perSide && ' per side'}
          </p>
          <p className="runner-instructions">{findExercise(item.exerciseId)?.instructions.join(' ')}</p>

          {state.remainingMs !== null && (
            <p className="runner-timer" aria-live="off">
              {fmtClock(state.remainingMs)}
            </p>
          )}

          {cvConfig && item.target.type === 'reps' ? (
            <CvSetTracker
              key={item.exerciseId}
              exercise={cvConfig}
              setAttempt={state.setAttempt}
              working={working}
              paused={state.paused}
              // Per-side exercises (lunges) are counted per rep on either side.
              targetReps={item.target.reps * (item.perSide ? 2 : 1)}
              onComplete={(result) => dispatch({ type: 'complete_set', at: now(), result })}
            />
          ) : (
            working && (
              <div className="manual-reps">
                {item.target.type === 'reps' && (
                  <>
                    <button type="button" className="secondary" onClick={() => dispatch({ type: 'add_rep', delta: -1 })} disabled={state.paused}>
                      −1
                    </button>
                    <span className="rep-number" aria-live="polite">
                      {state.manualReps}
                    </span>
                    <span className="rep-label">/ {item.target.reps}</span>
                    <button type="button" onClick={() => dispatch({ type: 'add_rep', delta: 1 })} disabled={state.paused}>
                      +1 Rep
                    </button>
                  </>
                )}
                <button type="button" onClick={() => dispatch({ type: 'complete_set', at: now() })} disabled={state.paused}>
                  {item.target.type === 'reps' ? 'Complete set' : 'Done'}
                </button>
              </div>
            )
          )}
        </div>
      )}

      {(working || state.phase === 'rest') && (
        <div className="controls">
          {state.paused ? (
            <button type="button" onClick={() => dispatch({ type: 'resume', at: now() })}>
              Resume
            </button>
          ) : (
            <button type="button" className="secondary" onClick={() => dispatch({ type: 'pause', at: now() })}>
              Pause
            </button>
          )}
          <button type="button" className="secondary" onClick={() => dispatch({ type: 'skip', at: now() })} disabled={state.paused}>
            {state.phase === 'rest' ? 'Skip rest' : 'Skip exercise'}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => window.confirm('Stop the workout now?') && dispatch({ type: 'stop', at: now() })}
          >
            Stop
          </button>
        </div>
      )}
      {saveError && <p className="notice">{saveError} The workout continues.</p>}
    </div>
  );
}

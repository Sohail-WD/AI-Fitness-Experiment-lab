import { useCallback, useEffect, useState } from 'react';
import { assignmentNotice } from '../../shared/experiments/engine';
import { type Experiment, experimentListSchema } from '../../shared/schemas/experiment';
import { type Workout, workoutSchema } from '../../shared/schemas/workout';
import { apiGet } from '../lib/api';
import { FeedbackForm } from '../workout/FeedbackForm';
import { buildPerformanceMetrics, type RunnerState } from '../workout/runner';
import { createSession } from '../workout/sessionApi';
import { WorkoutRunner } from '../workout/WorkoutRunner';

type Stage =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'ready'; workout: Workout }
  | { kind: 'running'; workout: Workout; sessionId: string }
  | { kind: 'feedback'; sessionId: string; summary: string }
  | { kind: 'finished'; summary: string; feedbackSaved: boolean };

export function FollowAlongPage() {
  const [stage, setStage] = useState<Stage>({ kind: 'loading' });
  const [error, setError] = useState<string | null>(null);
  // null while loading; 'unavailable' if the list could not be loaded (then the notice says so instead of staying silent).
  const [experiments, setExperiments] = useState<Experiment[] | 'unavailable' | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    apiGet('/workouts/latest', workoutSchema)
      .then((workout) => setStage({ kind: 'ready', workout }))
      .catch(() => setStage({ kind: 'none' }));
    // Needed for the experiment assignment notice.
    apiGet('/experiments', experimentListSchema)
      .then((list) => setExperiments(list.experiments.map((i) => i.experiment)))
      .catch(() => setExperiments('unavailable'));
  }, []);

  // Keep the notice current while the page stays open (windows start and end on the hour).
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const assignment = stage.kind === 'ready' ? stage.workout.assignment : null;
  const notice =
    !assignment || experiments === null
      ? null
      : assignmentNotice(assignment, experiments === 'unavailable' ? 'unavailable' : (experiments.find((e) => e.id === assignment.experimentId) ?? null), now);

  const begin = async (workout: Workout) => {
    setError(null);
    try {
      const session = await createSession(workout.id);
      setStage({ kind: 'running', workout, sessionId: session.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start a session.');
    }
  };

  const onFinished = useCallback((state: RunnerState) => {
    setStage((s) => {
      if (s.kind !== 'running') return s;
      const m = buildPerformanceMetrics(state, s.sessionId);
      const reps = m.sets.reduce((n, set) => n + set.validReps, 0);
      const summary = `${state.outcome === 'completed' ? 'Workout complete' : 'Workout stopped'}: ${state.sets.length} sets recorded, ${reps} valid reps, ${Math.round(m.completionRatio * 100)}% of planned sets counted (sets with no valid reps are not counted), ${Math.round(m.activeDurationSeconds / 60)} min active.`;
      return { kind: 'feedback', sessionId: s.sessionId, summary };
    });
  }, []);

  return (
    <section aria-labelledby="follow-title">
      <div className="page-header">
        <h2 id="follow-title">Follow-Along</h2>
        <p className="subtitle">Guided workout · camera tracking for squat, lunge, curl and shoulder press; other exercises counted manually</p>
      </div>

      {stage.kind === 'loading' && <p className="subtitle">Loading…</p>}
      {stage.kind === 'none' && (
        <div className="panel">
          <p>
            No workout prepared yet. <a href="#/workout">Generate one on the Workout tab.</a>
          </p>
        </div>
      )}
      {stage.kind === 'ready' && (
        <div className="panel">
          <p>
            <strong>{stage.workout.title}</strong>: {stage.workout.items.length} exercises, about {stage.workout.estimatedMinutes} min.
          </p>
          {notice && (
            <p className={notice.kind === 'info' ? 'success' : 'notice'} role={notice.kind === 'warning' ? 'alert' : 'status'}>
              {notice.text}
            </p>
          )}
          <button type="button" onClick={() => begin(stage.workout)}>
            Start session
          </button>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
      {stage.kind === 'running' && <WorkoutRunner workout={stage.workout} sessionId={stage.sessionId} onFinished={onFinished} />}
      {stage.kind === 'feedback' && (
        <>
          <p className="success">{stage.summary}</p>
          <FeedbackForm
            sessionId={stage.sessionId}
            onDone={(feedbackSaved) => setStage({ kind: 'finished', summary: stage.summary, feedbackSaved })}
          />
        </>
      )}
      {stage.kind === 'finished' && (
        <div className="panel">
          <p className="success">{stage.summary}</p>
          <p>{stage.feedbackSaved ? 'Feedback saved. Thank you!' : 'Feedback skipped.'}</p>
          <a className="button-link" href="#/workout">
            Back to Workout
          </a>
        </div>
      )}
    </section>
  );
}

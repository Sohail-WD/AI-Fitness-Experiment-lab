import { useEffect, useState } from 'react';
import { type ProfileResponse, profileResponseSchema } from '../../shared/schemas/profile';
import { type Workout, workoutSchema } from '../../shared/schemas/workout';
import { ApiError, apiGet, apiSend } from '../lib/api';
import { WorkoutView } from '../workout/WorkoutView';

type State =
  | { kind: 'loading' }
  | { kind: 'no_profile' }
  | { kind: 'ready'; profile: ProfileResponse; workout: Workout | null }
  | { kind: 'error'; message: string };

/** Resolve to null on 404 so "nothing yet" is not treated as an error. */
async function orNull<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof ApiError && err.code === 'not_found') return null;
    throw err;
  }
}

export function WorkoutPage() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const profile = await orNull(apiGet('/profile', profileResponseSchema));
        if (!profile) return setState({ kind: 'no_profile' });
        const workout = await orNull(apiGet('/workouts/latest', workoutSchema));
        setState({ kind: 'ready', profile, workout });
      } catch (err) {
        setState({ kind: 'error', message: err instanceof Error ? err.message : 'Could not load workout.' });
      }
    })();
  }, []);

  const generate = async (seed: number) => {
    if (state.kind !== 'ready') return;
    setBusy(true);
    setError(null);
    try {
      const workout = await apiSend('POST', '/workouts/generate', { seed }, workoutSchema);
      setState({ ...state, workout });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate a workout.');
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <div className="page-header">
      <h2 id="workout-page-title">Workout</h2>
      <p className="subtitle">Generated from your profile by fixed rules (no AI), using the exercise library.</p>
    </div>
  );

  if (state.kind === 'loading') return <section aria-labelledby="workout-page-title">{header}<p className="subtitle">Loading…</p></section>;
  if (state.kind === 'error') {
    return (
      <section aria-labelledby="workout-page-title">
        {header}
        <p className="error" role="alert">
          {state.message} Is the backend running?
        </p>
      </section>
    );
  }
  if (state.kind === 'no_profile') {
    return (
      <section aria-labelledby="workout-page-title">
        {header}
        <div className="panel">
          <p>Create your profile first so the workout can match your goal, equipment, time and restrictions.</p>
          <a className="button-link" href="#/profile">
            Go to Profile
          </a>
        </div>
      </section>
    );
  }

  const { workout, profile } = state;
  const stale = workout !== null && profile.profile.updatedAt > workout.createdAt;

  return (
    <section aria-labelledby="workout-page-title">
      {header}
      <div className="controls">
        <button type="button" onClick={() => generate(0)} disabled={busy}>
          {busy ? 'Generating…' : 'Generate workout'}
        </button>
        <button type="button" className="secondary" onClick={() => generate((workout?.seed ?? 0) + 1)} disabled={busy || !workout}>
          Regenerate
        </button>
        <button
          type="button"
          className="secondary"
          disabled={!workout}
          onClick={() => {
            window.location.hash = '#/follow-along';
          }}
        >
          Start workout
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {stale && (
        <p className="notice" role="status">
          Your profile changed after this workout was generated. Generate again to apply the changes.
        </p>
      )}
      {workout ? (
        <div className="panel">
          <WorkoutView workout={workout} />
        </div>
      ) : (
        <p className="subtitle">No workout yet. Press “Generate workout”.</p>
      )}
    </section>
  );
}

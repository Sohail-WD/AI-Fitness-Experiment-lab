import { useEffect, useState } from 'react';
import { type ProfileInput, type ProfileResponse, profileResponseSchema } from '../../shared/schemas/profile';
import { ApiError, apiGet, apiSend } from '../lib/api';
import { EMPTY_PROFILE, ProfileForm } from '../profile/ProfileForm';

type LoadState = { kind: 'loading' } | { kind: 'ready'; saved: ProfileResponse | null } | { kind: 'error'; message: string };

function toInput({ profile, constraints }: ProfileResponse): ProfileInput {
  const { id: _id, createdAt: _c, updatedAt: _u, ...p } = profile;
  return { profile: p, constraints: { restrictionTags: constraints.restrictionTags, notes: constraints.notes, source: constraints.source } };
}

export function ProfilePage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiGet('/profile', profileResponseSchema, controller.signal)
      .then((saved) => setState({ kind: 'ready', saved }))
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (err instanceof ApiError && err.code === 'not_found') setState({ kind: 'ready', saved: null });
        else setState({ kind: 'error', message: err instanceof Error ? err.message : 'Could not load profile.' });
      });
    return () => controller.abort();
  }, []);

  const save = async (input: ProfileInput) => {
    setSaving(true);
    setMessage(null);
    try {
      const saved = await apiSend('PUT', '/profile', input, profileResponseSchema);
      setState({ kind: 'ready', saved });
      setMessage({ kind: 'ok', text: 'Profile saved. Generate a workout on the Workout tab.' });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not save profile.' });
    } finally {
      setSaving(false);
    }
  };

  // "Delete my data": removes this browser's demo session and everything in it on the server.
  const deleteMyData = async () => {
    if (!window.confirm('Delete your profile, workouts, history, experiments and adaptations from the demo server? This cannot be undone.')) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/visitor', { method: 'DELETE' });
      if (!res.ok) throw new Error(`Request failed (${res.status}).`);
      setState({ kind: 'ready', saved: null });
      setMessage({ kind: 'ok', text: 'Your data was deleted from the demo server.' });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? `Could not delete your data. ${err.message}` : 'Could not delete your data.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="profile-title">
      <div className="page-header">
        <h2 id="profile-title">Profile</h2>
        <p className="subtitle">Used to personalize your workouts. Stored on this app's server only, linked to this browser.</p>
      </div>

      {state.kind === 'loading' && <p className="subtitle">Loading…</p>}
      {state.kind === 'error' && (
        <p className="error" role="alert">
          {state.message} Is the backend running?
        </p>
      )}
      {state.kind === 'ready' && (
        <ProfileForm
          key={state.saved?.profile.updatedAt ?? 'new'}
          initial={state.saved ? toInput(state.saved) : EMPTY_PROFILE}
          saving={saving}
          onSave={save}
        />
      )}
      {message && (
        <p className={message.kind === 'ok' ? 'success' : 'error'} role="status">
          {message.text}
        </p>
      )}

      <div className="panel">
        <h3>Your data in this demo</h3>
        <p className="hint">
          This is a public demo without accounts. Your data is linked to this browser by a cookie, stored on the demo server,
          and deleted after 30 days of inactivity. The demo server may also be reset when it restarts, so data can be lost
          at any time. Camera video never leaves your browser.
        </p>
        {state.kind === 'ready' && state.saved && (
          <button type="button" className="secondary" onClick={deleteMyData} disabled={saving}>
            Delete my data
          </button>
        )}
      </div>
    </section>
  );
}

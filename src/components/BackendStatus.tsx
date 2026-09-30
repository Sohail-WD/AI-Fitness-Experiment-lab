import { useEffect, useState } from 'react';
import { type HealthResponse, healthResponseSchema } from '../../shared/schemas/api';
import { ApiError, apiGet } from '../lib/api';

type State = { kind: 'checking' } | { kind: 'online'; health: HealthResponse } | { kind: 'offline'; message: string };

const POLL_INTERVAL_MS = 15_000;

/** Shows whether the backend is reachable. The CV Lab works either way. */
export function BackendStatus() {
  const [state, setState] = useState<State>({ kind: 'checking' });

  useEffect(() => {
    let controller = new AbortController();
    const check = async () => {
      controller.abort();
      controller = new AbortController();
      try {
        const health = await apiGet('/health', healthResponseSchema, controller.signal);
        setState({ kind: 'online', health });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setState({ kind: 'offline', message: err instanceof ApiError ? err.message : 'Health check failed.' });
      }
    };
    void check();
    const timer = window.setInterval(check, POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, []);

  if (state.kind === 'checking') return <span className="backend-status">Backend: checking…</span>;
  if (state.kind === 'offline') {
    return (
      <span className="backend-status offline" title={state.message}>
        Backend: offline
      </span>
    );
  }
  const { health } = state;
  return (
    <span
      className={`backend-status ${health.status === 'ok' ? 'online' : 'offline'}`}
      title={`v${health.version} · database ${health.services.database} · AI ${health.services.ai.replace('_', ' ')}`}
    >
      Backend: {health.status === 'ok' ? 'online' : 'degraded'}
    </span>
  );
}

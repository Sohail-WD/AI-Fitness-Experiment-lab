import type { z } from 'zod';
import { type ApiErrorCode, apiErrorSchema } from '../../shared/schemas/api';

export type ClientErrorCode = ApiErrorCode | 'network_error' | 'invalid_response';

/** Error from the backend API, or from failing to reach it. */
export class ApiError extends Error {
  override name = 'ApiError';
  readonly status: number;
  readonly code: ClientErrorCode;

  constructor(status: number, code: ClientErrorCode, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * GET a JSON resource and validate it against a shared schema, so the UI only
 * ever handles data that matches the contract.
 */
export function apiGet<S extends z.ZodType>(path: string, schema: S, signal?: AbortSignal): Promise<z.infer<S>> {
  return request(path, schema, { signal, headers: { Accept: 'application/json' } });
}

/** Send a JSON body (PUT/POST) and validate the response against a shared schema. */
export function apiSend<S extends z.ZodType>(
  method: 'PUT' | 'POST',
  path: string,
  body: unknown,
  schema: S,
): Promise<z.infer<S>> {
  return request(path, schema, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function request<S extends z.ZodType>(path: string, schema: S, init: RequestInit): Promise<z.infer<S>> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'network_error', 'The backend is not reachable.');
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    if (parsed.success) throw new ApiError(response.status, parsed.data.error.code, parsed.data.error.message);
    // The Vite dev proxy answers 5xx without a JSON body when the backend is down.
    throw new ApiError(response.status, response.status >= 500 ? 'network_error' : 'internal_error', `Request failed (${response.status}).`);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(response.status, 'invalid_response', 'Unexpected response from the backend.');
  return parsed.data;
}

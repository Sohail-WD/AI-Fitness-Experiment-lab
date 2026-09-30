import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { ApiErrorBody, ApiErrorCode } from '../shared/schemas/api.ts';

/** An expected, user-facing error with an HTTP status and a stable code. */
export class AppError extends Error {
  override name = 'AppError';
  readonly statusCode: number;
  readonly code: ApiErrorCode;

  constructor(statusCode: number, code: ApiErrorCode, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function errorBody(code: ApiErrorCode, message: string, issues?: ApiErrorBody['error']['issues']): ApiErrorBody {
  return { error: { code, message, ...(issues ? { issues } : {}) } };
}

/** node:sqlite reports failures as errors with an ERR_SQLITE_* code. */
function isDatabaseError(err: unknown): boolean {
  const code: unknown = err instanceof Error ? (err as Error & { code?: unknown }).code : undefined;
  return typeof code === 'string' && code.startsWith('ERR_SQLITE');
}

/**
 * One error format for every route:
 * validation → 400 · AppError → its status · database → 500 (details logged,
 * not leaked) · anything else → 500.
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | Error, request, reply) => {
    if (err instanceof ZodError) {
      const issues = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      return reply.status(400).send(errorBody('validation_error', 'Request validation failed', issues));
    }
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send(errorBody(err.code, err.message));
    }
    if (isDatabaseError(err)) {
      request.log.error({ err }, 'database error');
      return reply.status(500).send(errorBody('database_error', 'A database error occurred'));
    }
    // Fastify's own client errors (malformed JSON, oversized body, …).
    const statusCode = (err as FastifyError).statusCode;
    if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send(errorBody('validation_error', err.message));
    }
    request.log.error({ err }, 'unhandled error');
    return reply.status(500).send(errorBody('internal_error', 'An unexpected error occurred'));
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send(errorBody('not_found', `Route ${request.method} ${request.url} not found`));
  });
}

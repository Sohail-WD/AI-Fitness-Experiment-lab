import { z } from 'zod';
import { timestampSchema } from './common.ts';

/** Every API error response has this shape. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum([
      'validation_error',
      'not_found',
      'conflict',
      'unprocessable',
      'not_implemented',
      'database_error',
      'service_unavailable',
      'internal_error',
    ]),
    message: z.string(),
    /** Field-level problems for validation errors. */
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;
export type ApiErrorCode = ApiErrorBody['error']['code'];

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  time: timestampSchema,
  services: z.object({
    database: z.enum(['ok', 'error']),
    /** Claude is optional; the app must work without it (M8). */
    ai: z.enum(['configured', 'not_configured']),
  }),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

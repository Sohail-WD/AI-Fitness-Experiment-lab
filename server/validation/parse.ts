import type { z } from 'zod';

/**
 * Validate untrusted input (request bodies, params, JSON read from the
 * database) against a shared schema. Throws ZodError, which the error handler
 * turns into a 400 validation_error response.
 */
export function parseWith<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  return schema.parse(data);
}

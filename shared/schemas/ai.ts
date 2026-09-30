import { z } from 'zod';
import { idSchema, timestampSchema } from './common.ts';

/**
 * spec §15.3: structured analysis output, split into observed data, possible
 * explanations and recommendations (spec §9). Every observation cites the
 * stored facts it is based on (dataRefs) so its numbers can be checked against
 * the application's own metrics before anything is shown (spec §15.4).
 */

/** A pre-computed number the analysis may cite. `display` is the exact text the UI shows for it. */
export const analysisFactSchema = z.object({
  ref: z.string(),
  label: z.string(),
  display: z.string(),
});
export type AnalysisFact = z.infer<typeof analysisFactSchema>;

/** Why a deterministic summary was used instead of AI-written text. */
export const fallbackReasonSchema = z.enum([
  'no_api_key',
  'api_error',
  'invalid_response',
  'validation_failed',
  'insufficient_data',
]);
export type FallbackReason = z.infer<typeof fallbackReasonSchema>;

export const analysisReportSchema = z.object({
  id: idSchema,
  userId: idSchema,
  experimentId: idSchema.nullable(),
  createdAt: timestampSchema,
  /** "llm" = AI-written text that passed validation; "fallback" = deterministic template. */
  source: z.enum(['llm', 'fallback']),
  /** LLM provider and model that wrote the text ("groq"); null for fallback reports. */
  provider: z.string().nullable(),
  model: z.string().nullable(),
  fallbackReason: fallbackReasonSchema.nullable(),
  /** True when the analysed data is SIMULATED demo history (spec §13.4). */
  isSimulated: z.boolean(),
  /** Always set for simulated data: a SIMULATED notice for display. */
  notice: z.string().nullable(),
  observations: z.array(
    z.object({
      text: z.string().min(1),
      dataRefs: z.array(z.string()).min(1),
    }),
  ),
  possibleExplanations: z.array(z.string()),
  hypothesis: z.string().nullable(),
  recommendation: z.string().nullable(),
  confidence: z.enum(['low', 'medium', 'high']),
  /** The computed facts the analysis was allowed to use (what dataRefs point to). */
  dataUsed: z.array(analysisFactSchema),
  /** Fixed wording: this is a personal observation, not a scientific conclusion. */
  caveat: z.string(),
});
export type AnalysisReport = z.infer<typeof analysisReportSchema>;

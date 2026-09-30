import { z } from 'zod';
import type { Experiment } from '../../shared/schemas/experiment.ts';
import { allowedNumbers, type Fact, unsupportedNumbers } from './facts.ts';

/** Shape the LLM must return. Anything else is rejected and the deterministic fallback is used. */
export const llmAnalysisSchema = z.object({
  observations: z
    .array(z.object({ text: z.string().min(1).max(400), dataRefs: z.array(z.string()).min(1).max(8) }))
    .min(1)
    .max(4),
  possibleExplanations: z.array(z.string().min(1).max(400)).max(3),
  hypothesis: z.string().min(1).max(400).nullable(),
  recommendation: z.string().min(1).max(400).nullable(),
  confidence: z.enum(['low', 'medium', 'high']),
});
export type LlmAnalysis = z.infer<typeof llmAnalysisSchema>;

/** Diagnosis, treatment and medical/health advice: never allowed (spec §3 safety, §14 non-goals). */
const MEDICAL =
  /\b(diagnos\w*|treat(?:ment|ments|ing|s)?|therap\w+|cure[sd]?|prescri\w+|medicat\w+|medic(?:al|ally|ine)|disease|disorder|syndrome|injur\w+|pain\w*|symptom\w*|doctor|physician|physio\w*|clinician|clinical\w*|rehab\w*|health\w*|risk|safe|safely|safety|diet|nutrition|supplement\w*)\b/i;

/** Unsupported certainty: scientific/causal/statistical claims, guarantees, generalisations. */
const OVERCLAIM =
  /\b(scientific\w*|prove[sdn]?|proof|clinically|statistic\w*|significan\w*|guarantee[sd]?|definite\w*|certain\w*|always|never|cause[sd]?|causing|studies|research|evidence|everyone|most people)\b/i;

/** Explanations must be phrased as possibilities, not facts. */
const HEDGE = /\b(may|might|could|possibly|perhaps|seems?|suggests?|one possibility|it is possible)\b/i;

export function findUnsafeWording(text: string): string | null {
  return text.match(MEDICAL)?.[0] ?? text.match(OVERCLAIM)?.[0] ?? null;
}

export type ValidationResult = { ok: true; value: LlmAnalysis } | { ok: false; problems: string[] };

/**
 * Validate an LLM analysis against the supplied data:
 *  - every data reference exists;
 *  - every number in any text matches a supplied fact (no invented or derived numbers);
 *  - no medical, diagnostic, treatment, causal or scientific-certainty wording;
 *  - possible explanations are hedged.
 */
export function validateAnalysis(analysis: LlmAnalysis, facts: Fact[], experiment: Experiment): ValidationResult {
  const problems: string[] = [];
  const refs = new Set(facts.map((f) => f.ref));
  const allowed = allowedNumbers(facts, experiment);

  const texts: { where: string; text: string }[] = [
    ...analysis.observations.map((o, i) => ({ where: `observations[${i}]`, text: o.text })),
    ...analysis.possibleExplanations.map((t, i) => ({ where: `possibleExplanations[${i}]`, text: t })),
    ...(analysis.hypothesis ? [{ where: 'hypothesis', text: analysis.hypothesis }] : []),
    ...(analysis.recommendation ? [{ where: 'recommendation', text: analysis.recommendation }] : []),
  ];

  analysis.observations.forEach((o, i) => {
    for (const ref of o.dataRefs) if (!refs.has(ref)) problems.push(`observations[${i}] cites unknown data "${ref}"`);
  });
  for (const { where, text } of texts) {
    const unsupported = unsupportedNumbers(text, allowed);
    if (unsupported.length > 0) problems.push(`${where} contains unsupported number(s): ${unsupported.join(', ')}`);
    const unsafe = findUnsafeWording(text);
    if (unsafe) problems.push(`${where} contains disallowed wording: "${unsafe}"`);
  }
  analysis.possibleExplanations.forEach((t, i) => {
    if (!HEDGE.test(t)) problems.push(`possibleExplanations[${i}] is not phrased as a possibility`);
  });

  return problems.length > 0 ? { ok: false, problems } : { ok: true, value: analysis };
}

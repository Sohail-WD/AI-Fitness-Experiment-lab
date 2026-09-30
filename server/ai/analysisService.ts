import { randomUUID } from 'node:crypto';
import { describeResult, OBSERVATION_CAVEAT } from '../../shared/experiments/engine.ts';
import type { AnalysisReport, FallbackReason } from '../../shared/schemas/ai.ts';
import type { Experiment, ExperimentResult } from '../../shared/schemas/experiment.ts';
import { buildFacts, type Fact, metricName } from './facts.ts';
import { type LlmClient, LlmError, type LlmMessage } from './llm.ts';
import { llmAnalysisSchema, validateAnalysis } from './validate.ts';

/**
 * Analysis service (spec §15). Turns an experiment's deterministic result into
 * a validated, personal-observation insight.
 *
 * The LLM only receives numbers computed by the application and may not
 * calculate or change them. If there is no API key, the call fails, the reply
 * is malformed, or validation rejects it, a deterministic summary is returned
 * instead. The provider is replaceable: only the LlmClient interface is used.
 */

export interface ExperimentAnalysisInput {
  experiment: Experiment;
  result: ExperimentResult;
}

export interface AnalysisService {
  /** "configured" when an LLM client is available. */
  readonly status: 'configured' | 'not_configured';
  analyzeExperiment(input: ExperimentAnalysisInput): Promise<AnalysisReport>;
}

export interface AnalysisServiceOptions {
  llm: LlmClient | null;
  /** Diagnostic logging (never receives keys or raw model output). */
  log?: (message: string) => void;
  now?: () => Date;
  newId?: () => string;
}

export const SIMULATED_NOTICE = 'SIMULATED data: this analysis is based on generated demo history, not on your real workouts.';

/* ---------- prompt ---------- */

const SYSTEM_PROMPT = `You write short, plain-language personal fitness-experiment insights for one user.

You are given a JSON object with an experiment description and a list of "facts": numbers that were already computed by the application.

Hard rules:
- Use ONLY the numbers in "facts". Never calculate, estimate, round differently, combine or invent any number. Quote a fact's "display" text exactly. Do not mention dates or any number that is not in "facts".
- Describe what happened in this user's own data ("during this experiment, you ..."). Do not claim anything is scientifically proven, statistically significant, universally true, or caused by something.
- Possible explanations must be clearly tentative (use words like "may" or "might") and must not be stated as fact.
- Do NOT give medical, health, injury, diagnosis, treatment, nutrition or safety advice, and do not mention doctors or conditions.
- If "dataSource" is "SIMULATED", the data is generated demo data: never describe it as the user's real workouts.
- Each observation must list the "ref" values of the facts it uses in "dataRefs".

Reply with a single JSON object and nothing else, in exactly this shape:
{"observations":[{"text":string,"dataRefs":[string]}],"possibleExplanations":[string],"hypothesis":string|null,"recommendation":string|null,"confidence":"low"|"medium"|"high"}
Use 1 to 4 observations, at most 3 possible explanations, and keep every string under 300 characters. "recommendation" is an optional, non-medical suggestion for the next experiment or planning step.`;

function buildMessages(experiment: Experiment, facts: Fact[]): LlmMessage[] {
  const payload = {
    experiment: {
      hypothesis: experiment.hypothesis,
      primaryMetric: metricName(experiment.primaryMetric),
      dataSource: experiment.isSimulated ? 'SIMULATED' : 'REAL',
      conditions: experiment.conditions.map((c) => ({ id: c.id, label: c.label })),
    },
    facts: facts.map((f) => ({ ref: f.ref, label: f.label, display: f.display })),
  };
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(payload) },
  ];
}

/* ---------- deterministic fallback ---------- */

const FALLBACK_RECOMMENDATION = 'If you like, repeat this experiment later to see whether the same pattern shows up again.';
const INSUFFICIENT_RECOMMENDATION = 'Keep logging workouts; the comparison needs more observations before it says anything.';

function fallbackContent(experiment: Experiment, result: ExperimentResult) {
  // First line of the M7 wording: the personal-observation sentence, or "Not enough data yet…".
  const text = describeResult(experiment, result)[0];
  return {
    observations: [{ text, dataRefs: result.sufficientData ? ['A.metric', 'B.metric'] : ['A.observations', 'B.observations'] }],
    possibleExplanations: [] as string[],
    hypothesis: null,
    recommendation: result.sufficientData ? FALLBACK_RECOMMENDATION : INSUFFICIENT_RECOMMENDATION,
    confidence: 'low' as const,
  };
}

/* ---------- service ---------- */

export function createAnalysisService(options: AnalysisServiceOptions): AnalysisService {
  const { llm, log = () => {}, now = () => new Date(), newId = randomUUID } = options;

  return {
    status: llm ? 'configured' : 'not_configured',

    async analyzeExperiment({ experiment, result }) {
      const facts = buildFacts(experiment, result);
      const base = {
        id: newId(),
        userId: experiment.userId,
        experimentId: experiment.id,
        createdAt: now().toISOString(),
        isSimulated: experiment.isSimulated,
        notice: experiment.isSimulated ? SIMULATED_NOTICE : null,
        dataUsed: facts.map(({ ref, label, display }) => ({ ref, label, display })),
        caveat: OBSERVATION_CAVEAT,
      };
      const fallback = (reason: FallbackReason): AnalysisReport => ({
        ...base,
        source: 'fallback',
        provider: null,
        model: null,
        fallbackReason: reason,
        ...fallbackContent(experiment, result),
      });

      // Never ask an LLM to interpret a result that says "not enough data".
      if (!result.sufficientData) return fallback('insufficient_data');
      if (!llm) return fallback('no_api_key');

      let raw: string;
      try {
        raw = await llm.completeJson(buildMessages(experiment, facts));
      } catch (err) {
        const reason = err instanceof LlmError ? err.code : 'api_error';
        log(`analysis fallback (${reason}): ${err instanceof Error ? err.message : 'unknown error'}`);
        return fallback(reason);
      }

      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        log('analysis fallback (invalid_response): reply was not valid JSON');
        return fallback('invalid_response');
      }
      const parsed = llmAnalysisSchema.safeParse(json);
      if (!parsed.success) {
        log('analysis fallback (invalid_response): reply did not match the expected shape');
        return fallback('invalid_response');
      }

      const checked = validateAnalysis(parsed.data, facts, experiment);
      if (!checked.ok) {
        log(`analysis fallback (validation_failed): ${checked.problems.join('; ')}`);
        return fallback('validation_failed');
      }

      const v = checked.value;
      return {
        ...base,
        source: 'llm',
        provider: llm.provider,
        model: llm.model,
        fallbackReason: null,
        observations: v.observations,
        possibleExplanations: v.possibleExplanations,
        hypothesis: v.hypothesis,
        recommendation: v.recommendation,
        // One person's data never justifies "high" confidence.
        confidence: v.confidence === 'high' ? 'medium' : v.confidence,
      };
    },
  };
}

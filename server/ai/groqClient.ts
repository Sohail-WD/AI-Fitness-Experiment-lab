import type { AppConfig } from '../config.ts';
import { type LlmClient, LlmError, type LlmMessage } from './llm.ts';

/** Groq's OpenAI-compatible chat completions endpoint. */
export const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = 20_000;
/** Output budget. Reasoning models count hidden reasoning against it, so it is larger than the JSON itself needs. */
const MAX_TOKENS = 2000;

/** Groq's gpt-oss models reason before answering; low effort keeps replies fast and within the token budget. */
export const isReasoningModel = (model: string) => model.startsWith('openai/gpt-oss');

export interface GroqOptions {
  apiKey: string;
  model: string;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  url?: string;
}

/**
 * Groq chat client. The API key is only ever placed in the Authorization
 * header; error messages never include it or the response body.
 */
export function createGroqClient(options: GroqOptions): LlmClient {
  const { apiKey, model, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, url = GROQ_CHAT_URL } = options;

  return {
    provider: 'groq',
    model,
    async completeJson(messages: LlmMessage[]): Promise<string> {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.2,
            max_tokens: MAX_TOKENS,
            response_format: { type: 'json_object' },
            ...(isReasoningModel(model) ? { reasoning_effort: 'low' } : {}),
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new LlmError('api_error', 'Could not reach the Groq API (network error or timeout)');
      }
      if (!response.ok) throw new LlmError('api_error', `Groq API returned HTTP ${response.status}`);

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new LlmError('invalid_response', 'Groq API returned a non-JSON body');
      }
      const content = (body as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.trim() === '') {
        throw new LlmError('invalid_response', 'Groq API reply had no message content');
      }
      return content;
    },
  };
}

/** The configured LLM client, or null when no API key is set (analysis then uses deterministic summaries). */
export function createLlmFromConfig(config: Pick<AppConfig, 'groqApiKey' | 'groqModel'>, fetchImpl?: typeof fetch): LlmClient | null {
  if (!config.groqApiKey) return null;
  return createGroqClient({ apiKey: config.groqApiKey, model: config.groqModel, fetchImpl });
}

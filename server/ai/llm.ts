/**
 * Provider-agnostic LLM boundary. The analysis service depends only on this
 * interface, so Groq can be replaced by any other provider by implementing it.
 */

export interface LlmMessage {
  role: 'system' | 'user';
  content: string;
}

export interface LlmClient {
  /** Provider name shown to the user, e.g. "groq". */
  readonly provider: string;
  readonly model: string;
  /** Returns the model's raw text reply, which must be a JSON document. Throws LlmError on failure. */
  completeJson(messages: LlmMessage[]): Promise<string>;
}

export class LlmError extends Error {
  override name = 'LlmError';
  /** "api_error": unreachable, timed out, or non-2xx. "invalid_response": reply had no usable content. */
  readonly code: 'api_error' | 'invalid_response';

  constructor(code: 'api_error' | 'invalid_response', message: string) {
    super(message);
    this.code = code;
  }
}

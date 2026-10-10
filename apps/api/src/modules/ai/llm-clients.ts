/** Provider-agnostic chat completion (TECH appx: "OpenAI-compatible abstraction"). */
export interface LlmRequest {
  model: string;
  system: string;
  user: string;
  temperature: number | null;
  maxOutputTokens: number;
  timeoutMs: number;
}
export interface LlmResponse {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
}
export interface LlmClient {
  complete(req: LlmRequest): Promise<LlmResponse>;
}

async function post(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<any> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`LLM HTTP ${res.status}: ${text.slice(0, 200)}`), { status: res.status });
  return JSON.parse(text);
}

/** Any OpenAI-compatible /chat/completions endpoint (OpenAI, Azure OpenAI, vLLM, Together, Groq, local gateways). */
export class OpenAiCompatibleClient implements LlmClient {
  constructor(private readonly baseUrl: string, private readonly apiKey: string) {}
  async complete(r: LlmRequest): Promise<LlmResponse> {
    const j = await post(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, { Authorization: `Bearer ${this.apiKey}` }, {
      model: r.model, messages: [{ role: 'system', content: r.system }, { role: 'user', content: r.user }],
      max_tokens: r.maxOutputTokens, ...(r.temperature !== null ? { temperature: r.temperature } : {}), response_format: { type: 'json_object' },
    }, r.timeoutMs);
    return { text: j.choices?.[0]?.message?.content ?? '', inputTokens: j.usage?.prompt_tokens ?? null, outputTokens: j.usage?.completion_tokens ?? null };
  }
}

/** Anthropic Messages API. */
export class AnthropicClient implements LlmClient {
  constructor(private readonly baseUrl: string, private readonly apiKey: string) {}
  async complete(r: LlmRequest): Promise<LlmResponse> {
    const j = await post(`${this.baseUrl.replace(/\/$/, '')}/v1/messages`, { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' }, {
      model: r.model, system: r.system, messages: [{ role: 'user', content: r.user }], max_tokens: r.maxOutputTokens, ...(r.temperature !== null ? { temperature: r.temperature } : {}),
    }, r.timeoutMs);
    const text = (j.content ?? []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('');
    return { text, inputTokens: j.usage?.input_tokens ?? null, outputTokens: j.usage?.output_tokens ?? null };
  }
}

/** Route-table fetch mock for the real ApiClient. Keys are "METHOD /path" (no /v1 prefix, no query string). */
export interface MockResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}
export type Handler = MockResponse | ((req: RecordedRequest) => MockResponse | Promise<MockResponse>);
export interface RecordedRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: any;
}

export function response({ status = 200, body, headers = {} }: MockResponse): Response {
  const text = body === undefined ? '' : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    text: async () => text,
    json: async () => body,
    blob: async () => {
      const size = text.length || 1234;
      return { size, type: headers['content-type'] ?? '', arrayBuffer: async () => new ArrayBuffer(size) };
    },
  } as unknown as Response;
}

export const apiError = (status: number, code: string, details?: unknown): MockResponse => ({ status, body: { error: { code, message: code, details, requestId: 'req-test-1' } } });

export function mockApi(routes: Record<string, Handler>) {
  const calls: RecordedRequest[] = [];
  const fetchMock = jest.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const path = url.pathname.replace(/^\/v1/, '');
    const req: RecordedRequest = {
      method: (init.method ?? 'GET').toUpperCase(),
      path,
      query: url.searchParams,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
    };
    calls.push(req);
    const h = routes[`${req.method} ${path}`];
    if (!h) return response(apiError(404, 'NOT_FOUND'));
    return response(typeof h === 'function' ? await h(req) : h);
  });
  (globalThis as { fetch: unknown }).fetch = fetchMock;
  return {
    calls,
    fetchMock,
    callsTo: (key: string) => calls.filter((c) => `${c.method} ${c.path}` === key),
    set: (key: string, h: Handler) => {
      routes[key] = h;
    },
  };
}

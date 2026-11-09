// Share simultaneous reads only. Completed responses are never cached, so a
// refresh or a return to a page still reads current server data.
type PendingRead = { request: Promise<Response>; readers: number };
const pendingReads = new Map<string, PendingRead>();

export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    // A read started before/during a write must not be reused after it.
    pendingReads.clear();
    return globalThis.fetch(input, init).finally(() => pendingReads.clear());
  }
  if (
    method !== 'GET'
    || typeof input !== 'string'
    || !input.startsWith('/api/')
    || init?.signal
    || (init?.cache && init.cache !== 'default')
  ) return globalThis.fetch(input, init);

  const headers: [string, string][] = [];
  new Headers(init?.headers).forEach((value, name) => headers.push([name, value]));
  const key = JSON.stringify([input, { ...init, headers }]);
  let pending = pendingReads.get(key);
  if (!pending) {
    pending = { request: globalThis.fetch(input, init), readers: 0 };
    pendingReads.set(key, pending);
    const entry = pending;
    const remove = () => {
      if (pendingReads.get(key) === entry) pendingReads.delete(key);
    };
    void pending.request.then(remove, remove);
  }
  pending.readers += 1;
  const entry = pending;
  // Each caller owns a body stream and can independently read JSON or text.
  return pending.request.then(response => entry.readers > 1 ? response.clone() : response);
}

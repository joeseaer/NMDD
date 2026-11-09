import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from './apiFetch';

const deferred = () => {
  let resolve!: (response: Response) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Response>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
afterEach(() => vi.unstubAllGlobals());

describe('simultaneous API reads', () => {
  it('shares a network request while each reader can consume its own body', async () => {
    const response = deferred();
    const fetch = vi.fn(() => response.promise);
    vi.stubGlobal('fetch', fetch);
    const a = apiFetch('/api/people/user');
    const b = apiFetch('/api/people/user');
    response.resolve(Response.json([{ id: 'person' }]));
    const bodies = await Promise.all([a.then(r => r.json()), b.then(r => r.json())]);
    expect(bodies).toEqual([[{ id: 'person' }], [{ id: 'person' }]]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not cache completed data, failures, or rejected network requests', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ old: true }))
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(Response.json({ current: true }));
    vi.stubGlobal('fetch', fetch);
    await (await apiFetch('/api/fresh')).json();
    expect((await apiFetch('/api/fresh')).status).toBe(503);
    await expect(apiFetch('/api/fresh')).rejects.toThrow('offline');
    await expect((await apiFetch('/api/fresh')).json()).resolves.toEqual({ current: true });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('keeps authorization, credentials and abortable requests independent', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({}));
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    await Promise.all([
      apiFetch('/api/private', { headers: { Authorization: 'first' } }),
      apiFetch('/api/private', { headers: { Authorization: 'second' } }),
      apiFetch('/api/private', { credentials: 'omit' }),
      apiFetch('/api/private', { signal: controller.signal }),
      apiFetch('/api/private', { signal: controller.signal }),
      apiFetch('/api/private', { cache: 'no-store' }),
    ]);
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(fetch.mock.calls[3][1]?.signal).toBe(controller.signal);
  });

  it('never reuses a pre-write read and preserves newer pending reads', async () => {
    const old = deferred();
    const current = deferred();
    const fetch = vi.fn()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(Response.json({ saved: true }))
      .mockReturnValueOnce(current.promise);
    vi.stubGlobal('fetch', fetch);
    const a = apiFetch('/api/items');
    await apiFetch('/api/items', { method: 'POST', body: '{}' });
    const b = apiFetch('/api/items');
    old.resolve(Response.json(['old']));
    await a;
    const c = apiFetch('/api/items');
    current.resolve(Response.json(['current']));
    expect(await (await b).json()).toEqual(['current']);
    expect(await (await c).json()).toEqual(['current']);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

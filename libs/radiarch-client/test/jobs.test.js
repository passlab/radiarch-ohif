// Tests of how @radiarch/client follows a job (no server: a fake API and a fake clock). A deliverable arc plan takes
// hours, so the wait has no limit of its own, slows its polls, rides out a gateway restart, and stops when the host
// aborts it.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createClient, RadiarchApiError } from '../src/index.js';

const API = 'http://radiarch.test/api/v1';

/** A fake API: POST /mco/m1/deliverable starts job j1; its polls answer from `polls` in turn (the last one repeats). */
function fakeApi(polls) {
  const seen = [];
  let clock = 0;
  let i = 0;
  const json = (status, body) => ({ status, text: async () => JSON.stringify(body) });
  const fetch = async (url, { method }) => {
    const path = url.slice(API.length);
    seen.push(`${method} ${path}`);
    clock += 10 * 60 * 1000;                                  // every request "takes" ten minutes
    if (method === 'POST' && path === '/mco/m1/deliverable') {
      return json(202, { job_id: 'j1', state: 'queued' });
    }
    if (path === '/mco/deliverables/jobs/j1') {
      const p = polls[Math.min(i++, polls.length - 1)];
      if (p instanceof Error) {
        throw p;
      }
      return typeof p === 'number' ? json(p, { detail: 'Bad Gateway' }) : json(200, p);
    }
    if (path === '/mco/deliverables/d1') {
      return json(200, { deliverable_id: 'd1' });
    }
    return json(404, { detail: 'not found' });
  };
  return { fetch, seen, now: () => clock };
}

const running = k => ({ state: 'running', progress: k / 10, stage: 'sequencing' });
const done = { state: 'succeeded', progress: 1, deliverable_id: 'd1' };

test('a job is followed until it ends, hours later, and each status reaches the host', async () => {
  const api = fakeApi([...Array.from({ length: 9 }, (_, k) => running(k + 1)), done]);
  const c = createClient({ apiUrl: API, fetch: api.fetch, now: api.now, pollMs: 1, pollMaxMs: 2 });
  const statuses = [];
  const plan = await c.makeDeliverable('m1', { state_id: 's1' }, { onProgress: s => statuses.push(s.progress) });
  assert.equal(plan.deliverable_id, 'd1');
  assert.deepEqual(statuses, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
  assert.ok(api.now() > 60 * 60 * 1000, 'the fake clock passed an hour');
});

test('a gateway restart or a dropped connection while polling is ridden out', async () => {
  const api = fakeApi([running(1), 502, new TypeError('fetch failed'), 503, running(5), done]);
  const c = createClient({ apiUrl: API, fetch: api.fetch, now: api.now, pollMs: 1, pollMaxMs: 2 });
  assert.equal((await c.makeDeliverable('m1', { state_id: 's1' })).deliverable_id, 'd1');
});

test('a lasting gateway error, or a refusal, ends the wait with that error', async () => {
  const lasting = fakeApi([running(1), 502]);
  const c = createClient({ apiUrl: API, fetch: lasting.fetch, now: lasting.now, pollMs: 1, pollMaxMs: 2 });
  await assert.rejects(c.makeDeliverable('m1', { state_id: 's1' }), e => e instanceof RadiarchApiError && e.status === 502);
  assert.equal(lasting.seen.filter(s => s.endsWith('/jobs/j1')).length, 1 + 6);

  const refused = fakeApi([running(1), 403]);
  const d = createClient({ apiUrl: API, fetch: refused.fetch, now: refused.now, pollMs: 1 });
  await assert.rejects(d.makeDeliverable('m1', { state_id: 's1' }), e => e.status === 403);
  assert.equal(refused.seen.filter(s => s.endsWith('/jobs/j1')).length, 2);
});

test('a failed job ends the wait with its message', async () => {
  const api = fakeApi([running(1), { state: 'failed', message: 'Timed out' }]);
  const c = createClient({ apiUrl: API, fetch: api.fetch, now: api.now, pollMs: 1 });
  await assert.rejects(c.makeDeliverable('m1', { state_id: 's1' }), /Timed out/);
});

test('the host stops the wait (the panel closes); no request follows', async () => {
  const api = fakeApi([running(1)]);
  const c = createClient({ apiUrl: API, fetch: api.fetch, now: api.now, pollMs: 50 });
  const stop = new AbortController();
  const wait = c.makeDeliverable('m1', { state_id: 's1' }, { signal: stop.signal, onProgress: () => stop.abort() });
  await assert.rejects(wait, e => e.name === 'AbortError');
  const n = api.seen.length;
  await new Promise(r => setTimeout(r, 120));
  assert.equal(api.seen.length, n);
});

test('a host that sets a limit stops waiting after it; the message says the job runs on', async () => {
  const api = fakeApi([running(1)]);
  const c = createClient({ apiUrl: API, fetch: api.fetch, now: api.now, pollMs: 1, pollMaxMs: 2, timeoutMs: 30 * 60 * 1000 });
  await assert.rejects(c.makeDeliverable('m1', { state_id: 's1' }), e => e.status === 504 && /runs on/.test(e.message));
});

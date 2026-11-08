// Tests of the host's upload token (radiarch's ADR 0020; no server: a fake API). The client sends the token in its
// header only when it is given one; exportAndPush asks the host's hook first, and a null or an error from it decides
// whether anything is sent or written.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createClient } from '../src/index.js';

const API = 'http://radiarch.test/api/v1';
const TOKEN = 'Bearer host-issued-1';

/** A fake API that records each request's path, headers and body, and answers an export or a push. */
function fakeApi() {
  const seen = [];
  const fetch = async (url, { method, headers, body }) => {
    const path = url.slice(API.length);
    const sent = body ? JSON.parse(body) : null;
    seen.push({ method, path, headers, body: sent });
    const data = path === '/rt/export' ? { export_id: 'e1', pushed: !!sent.push, push_error: null } : { export_id: 'e1', pushed: 2 };
    return { status: 200, text: async () => JSON.stringify(data) };
  };
  return { fetch, seen };
}

const client = (api, options = {}) =>
  createClient({ apiUrl: API, fetch: api.fetch, headers: () => ({ Authorization: 'Bearer host-session' }), ...options });

test('the token goes in its own header, only when given; the host\'s authorization header stays', async () => {
  const api = fakeApi();
  const c = client(api);
  await c.exportPlan({ sequence_id: 's1', push: true });
  await c.exportPlan({ sequence_id: 's1', push: true }, { uploadToken: TOKEN });
  await c.pushExport('e1');
  await c.pushExport('e1', { kinds: ['RTPLAN'] }, { uploadToken: TOKEN });
  assert.deepEqual(api.seen.map(r => r.headers['X-Upload-Authorization']), [undefined, TOKEN, undefined, TOKEN]);
  assert.ok(api.seen.every(r => r.headers.Authorization === 'Bearer host-session'));
  assert.deepEqual(api.seen.map(r => r.path), ['/rt/export', '/rt/export', '/rt/exports/e1/push', '/rt/exports/e1/push']);
  assert.ok(api.seen.every(r => !JSON.stringify(r.body).includes('host-issued')));          // never in a body
});

test('a server that names another header gets the token there', async () => {
  const api = fakeApi();
  await client(api, { uploadTokenHeader: 'X-Archive-Token' }).pushExport('e1', {}, { uploadToken: TOKEN });
  assert.equal(api.seen[0].headers['X-Archive-Token'], TOKEN);
  assert.equal(api.seen[0].headers['X-Upload-Authorization'], undefined);
});

test('without a hook, export and push work as before', async () => {
  const api = fakeApi();
  const out = await client(api).exportAndPush({ beam_model_id: 'b1', dose_id: 'd1' }, { studyInstanceUID: '1.2.3' });
  assert.equal(out.pushed, true);
  assert.equal(api.seen.length, 1);
  assert.equal(api.seen[0].body.push, true);
  assert.equal(api.seen[0].headers['X-Upload-Authorization'], undefined);
});

test('the hook is asked for the study and the objects; its token goes with the push', async () => {
  const api = fakeApi();
  const asked = [];
  const getUploadToken = async ctx => (asked.push(ctx), TOKEN);
  const body = { beam_model_id: 'b1', dose_id: 'd1', rtstruct_uid: '1.2.9', objects: ['rtplan', 'rtdose'] };
  const out = await client(api).exportAndPush(body, { getUploadToken, studyInstanceUID: '1.2.3' });
  assert.deepEqual(asked, [{ studyInstanceUID: '1.2.3', objects: ['rtplan', 'rtdose'] }]);
  assert.equal(api.seen[0].headers['X-Upload-Authorization'], TOKEN);
  assert.equal(api.seen[0].body.push, true);
  assert.equal(out.pushed, true);
  assert.equal(out.notSent, undefined);
  // an export that names no objects writes radiarch's default four
  await client(api).exportAndPush({ beam_model_id: 'b1' }, { getUploadToken, studyInstanceUID: '1.2.3' });
  assert.deepEqual(asked[1].objects, ['rtstruct', 'rtplan', 'rtdose', 'rtimage']);
});

test('a hook that gives no token: the objects are written, not sent, and the result says why', async () => {
  const api = fakeApi();
  const out = await client(api).exportAndPush({ beam_model_id: 'b1' }, { getUploadToken: async () => null, studyInstanceUID: '1.2.3' });
  assert.equal(api.seen.length, 1);
  assert.equal(api.seen[0].body.push, false);
  assert.equal(api.seen[0].headers['X-Upload-Authorization'], undefined);
  assert.equal(out.pushed, false);
  assert.equal(out.notSent, 'the host gave no upload token');
});

test('a hook that fails: nothing is exported, and its error reaches the panel', async () => {
  const api = fakeApi();
  const getUploadToken = async () => {
    throw new Error('the host refused an upload token: study not open');
  };
  await assert.rejects(client(api).exportAndPush({ beam_model_id: 'b1' }, { getUploadToken, studyInstanceUID: '1.2.3' }),
    /^Error: no upload token from the host: the host refused an upload token: study not open$/);
  assert.equal(api.seen.length, 0);
});

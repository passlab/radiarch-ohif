// scripts/build-ohif.sh on an existing OHIF checkout, with `node` and `npx` stubbed: the packages are placed and
// registered and the build steps called (OHIF_DIR), or only placed and registered (--add-only), without a network or
// an OHIF build. CI's image job runs the real build on a clone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'build-ohif.sh');

function checkout() {
  const tmp = mkdtempSync(join(tmpdir(), 'build-ohif-'));
  const ohif = join(tmp, 'Viewers');
  mkdirSync(join(ohif, 'platform', 'app'), { recursive: true });
  mkdirSync(join(ohif, 'extensions'));
  mkdirSync(join(ohif, 'modes'));
  writeFileSync(join(ohif, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.0.0' }));
  writeFileSync(join(ohif, 'platform', 'app', 'pluginConfig.json'),
    JSON.stringify({ extensions: [{ packageName: '@ohif/extension-default', default: true }], modes: [] }));
  return { tmp, ohif };
}

function run(tmp, args, env = {}) {
  const bin = join(tmp, 'bin');
  mkdirSync(bin, { recursive: true });
  const log = join(tmp, 'npx.log');
  for (const [name, body] of [['node', 'echo 10.0.0'], ['npx', `echo "$@" >> ${log}`]]) {
    writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const out = spawnSync('bash', [SCRIPT, ...args], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...env }, encoding: 'utf8', timeout: 60000,
  });
  return { out, calls: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [] };
}

function registered(ohif) {
  for (const d of ['extensions/radiarch-rt-dose-core', 'extensions/radiarch-radiarch-client', 'extensions/radiarch-rt-dose', 'extensions/radiarch-planning', 'modes/radiarch-plan-review']) {
    assert.ok(existsSync(join(ohif, d, 'package.json')), d);
  }
  const cfg = JSON.parse(readFileSync(join(ohif, 'platform', 'app', 'pluginConfig.json'), 'utf8'));
  const ext = new Set(cfg.extensions.map((e) => e.packageName));
  assert.ok(ext.has('@radiarch/extension-rt-dose') && ext.has('@radiarch/extension-planning'));
  assert.deepEqual(cfg.modes.map((m) => m.packageName), ['@radiarch/mode-plan-review']);
}

test('an existing checkout is built in place (OHIF_DIR)', () => {
  const { tmp, ohif } = checkout();
  const { out, calls } = run(tmp, [], { OHIF_DIR: ohif });
  assert.equal(out.status, 0, out.stderr);
  assert.ok(out.stdout.trim().endsWith(join(ohif, 'platform', 'app', 'dist')));
  registered(ohif);
  assert.ok(calls.some((c) => c.includes('install')) && calls.some((c) => c.endsWith('run build')));
  assert.ok(!existsSync(join(ohif, '.git')));                                   // not cloned
});

test('--add-only adds and registers the packages, and neither installs nor builds', () => {
  const { tmp, ohif } = checkout();
  const first = run(tmp, ['--add-only', ohif]);
  assert.equal(first.out.status, 0, first.out.stderr);
  registered(ohif);
  assert.deepEqual(first.calls, []);
  const again = run(tmp, ['--add-only', ohif]);                                 // twice: registered once
  assert.equal(again.out.status, 0, again.out.stderr);
  registered(ohif);
});

test('a directory that is not a checkout is refused', () => {
  const { tmp } = checkout();
  for (const [args, env, msg] of [[[], { OHIF_DIR: tmp }, 'not an OHIF checkout'],
                                  [['--add-only', join(tmp, 'missing')], {}, 'no such directory'],
                                  [['--add-only'], {}, 'usage']]) {
    const { out } = run(tmp, args, env);
    assert.equal(out.status, 2);
    assert.match(out.stderr, new RegExp(msg));
  }
});

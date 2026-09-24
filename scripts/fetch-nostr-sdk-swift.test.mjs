import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const iosDir = join(scriptsDir, '..', 'modules', 'nostr-native', 'ios');
// Simulates an offline / proxied / GitHub-outage install without touching the network.
const OFFLINE_FETCH = `data:text/javascript,${encodeURIComponent(
  'globalThis.fetch = () => Promise.reject(new Error("offline"));',
)}`;

// Never run against (and possibly discard) a developer's real iOS artifacts.
const artifactsPresent =
  existsSync(join(iosDir, 'Generated')) || existsSync(join(iosDir, 'nostr_sdkFFI.xcframework'));

function runOffline(env) {
  const childEnv = { ...process.env, FETCH_NOSTR_SDK_SWIFT: '1' };
  delete childEnv.EAS_BUILD_PLATFORM;
  delete childEnv.FETCH_NOSTR_SDK_SWIFT_REQUIRED;
  Object.assign(childEnv, env);
  return spawnSync(
    process.execPath,
    ['--import', OFFLINE_FETCH, join(scriptsDir, 'fetch-nostr-sdk-swift.mjs')],
    { env: childEnv, encoding: 'utf8' },
  );
}

test('offline fetch warns but does not fail a JS-only install', { skip: artifactsPresent }, () => {
  const result = runOffline({});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /fetch failed: offline/);
  assert.match(result.stderr, /pod install \/ iOS builds will fail/);
});

for (const [name, env] of [
  ['an EAS iOS build', { EAS_BUILD_PLATFORM: 'ios' }],
  ['an explicitly required fetch', { FETCH_NOSTR_SDK_SWIFT_REQUIRED: '1' }],
]) {
  test(`offline fetch fails ${name}`, { skip: artifactsPresent }, () => {
    const result = runOffline(env);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /required for this iOS build/);
  });
}

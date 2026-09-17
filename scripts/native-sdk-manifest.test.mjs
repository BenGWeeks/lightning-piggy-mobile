import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { frameworkContentHash } from './native-sdk-manifest.mjs';

test('content manifest detects modifications, omissions and added files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'piggy-sdk-test-'));
  try {
    mkdirSync(join(dir, 'Headers'));
    writeFileSync(join(dir, 'Headers', 'ffi.h'), 'original');
    const trusted = frameworkContentHash(dir);
    writeFileSync(join(dir, '.lightning-piggy-version'), 'version marker');
    assert.equal(frameworkContentHash(dir), trusted);
    writeFileSync(join(dir, 'Headers', 'ffi.h'), 'modified');
    assert.notEqual(frameworkContentHash(dir), trusted);
    writeFileSync(join(dir, 'Headers', 'ffi.h'), 'original');
    assert.equal(frameworkContentHash(dir), trusted);
    writeFileSync(join(dir, 'extra'), 'extra');
    assert.notEqual(frameworkContentHash(dir), trusted);
    rmSync(join(dir, 'extra'));
    rmSync(join(dir, 'Headers', 'ffi.h'));
    assert.notEqual(frameworkContentHash(dir), trusted);
    symlinkSync('/tmp', join(dir, 'link'));
    assert.throws(() => frameworkContentHash(dir), /symlink/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

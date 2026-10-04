import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = resolve('scripts/check-elf-alignment.sh');
function runFixture(libraries) {
  const dir = mkdtempSync(join(tmpdir(), 'elf-alignment-test-'));
  try {
    writeFileSync(join(dir, 'AndroidManifest.xml'), '<manifest/>');
    writeFileSync(join(dir, 'probe.c'), 'int probe(void) { return 42; }\n');
    for (const { abi, pageSize, malformed } of libraries) {
      const path = join(dir, 'lib', abi, 'libprobe.so');
      mkdirSync(join(dir, 'lib', abi), { recursive: true });
      if (malformed) writeFileSync(path, 'not an ELF');
      else {
        const built = spawnSync(
          'gcc',
          [
            '-shared',
            '-fPIC',
            `-Wl,-z,max-page-size=${pageSize}`,
            `-Wl,-z,common-page-size=${pageSize}`,
            '-o',
            path,
            join(dir, 'probe.c'),
          ],
          { encoding: 'utf8' },
        );
        assert.equal(built.status, 0, built.stderr);
      }
    }
    const zipped = spawnSync(
      'zip',
      ['-qr', 'app.apk', 'AndroidManifest.xml', ...(libraries.length ? ['lib'] : [])],
      { cwd: dir },
    );
    assert.equal(zipped.status, 0);
    return spawnSync('bash', [script, join(dir, 'app.apk')], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('accepts 16 KB load segments in both supported 64-bit ABI paths', () => {
  const result = runFixture(['arm64-v8a', 'x86_64'].map((abi) => ({ abi, pageSize: 16384 })));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /2\/2 libraries/);
});
test('rejects a 4 KB library even when the other ABI passes', () => {
  const result = runFixture([
    { abi: 'arm64-v8a', pageSize: 16384 },
    { abi: 'x86_64', pageSize: 4096 },
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /1\/2 libraries/);
});
test('rejects an APK with no audited native libraries', () => {
  assert.equal(runFixture([]).status, 1);
});
test('rejects malformed ELF data', () => {
  const result = runFixture([{ abi: 'arm64-v8a', malformed: true }]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /no PT_LOAD found/);
});

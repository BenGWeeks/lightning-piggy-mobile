/** @jest-environment node */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

test('release-body regression suite: ordered workflows, section preservation, retries and tag resolution', () => {
  // Exercise the real Node helper and workflow shell steps in both update orders.
  // Also runnable directly with node --test, without the Expo/Jest runtime.
  expect(() =>
    execFileSync(
      process.execPath,
      ['--test', path.join(__dirname, 'update-release-body.test.mjs')],
      {
        stdio: 'pipe',
      },
    ),
  ).not.toThrow();
});

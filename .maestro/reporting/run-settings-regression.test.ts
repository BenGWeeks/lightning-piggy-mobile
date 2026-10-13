import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('dedicated-device settings regression runner', () => {
  let fixture: string;

  beforeEach(() => {
    fixture = mkdtempSync(join(tmpdir(), 'settings-regression-'));
    writeFileSync(
      join(fixture, 'maestro'),
      '#!/usr/bin/env bash\nprintf "%s\\0" "$@" >> "$MAESTRO_CALL_LOG"\n',
      { mode: 0o755 },
    );
  });

  afterEach(() => {
    rmSync(fixture, { recursive: true, force: true });
  });

  it('supplies the language flow with a locale and an explicit empty screenshot prefix', () => {
    const log = join(fixture, 'calls');
    execFileSync('bash', [join(__dirname, 'run-settings-regression.sh'), 'test-device'], {
      cwd: fixture,
      env: {
        ...process.env,
        PATH: `${fixture}:${process.env.PATH}`,
        MAESTRO_CALL_LOG: log,
      },
    });

    const commonArgs = ['--device', 'test-device', 'test', '-e', 'EXERCISE_SETTINGS=true'];
    expect(readFileSync(log, 'utf8').split('\0').slice(0, -1)).toEqual([
      ...commonArgs,
      '.maestro/profile/flow-095-appearance-theme.yaml',
      ...commonArgs,
      '.maestro/profile/flow-118-appearance-sending-animation.yaml',
      ...commonArgs,
      '-e',
      'LOCALE=en',
      '-e',
      'SHOT=',
      '.maestro/profile/flow-141-display-language-screens.yaml',
    ]);
  });
});

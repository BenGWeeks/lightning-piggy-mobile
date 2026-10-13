/** @jest-environment node */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
const workflow = parse(fs.readFileSync(path.join(__dirname, 'release.yml'), 'utf8'));
const archiveStep = workflow.jobs['release-notes'].steps.find(
  (step: { name?: string }) => step.name === 'Append generated section to changelog archive',
);
let repo: string;
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

test.each(['missing-release', 'no-assets', 'archive'])(
  'appends and uploads notes when the previous tag has %s',
  (scenario) => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'release-archive-'));
    fs.mkdirSync(path.join(repo, 'docs'));
    fs.writeFileSync(path.join(repo, 'docs/CHANGELOG.md'), '# Checked-in history\n');
    fs.writeFileSync(path.join(repo, 'release-notes.md'), '### Fixed\n\n- Current fix\n');
    fs.writeFileSync(
      path.join(repo, 'gh'),
      `#!/usr/bin/env bash
set -euo pipefail
case "$2" in
  view)
    [ "$SCENARIO" != missing-release ] || exit 1
    if [ "$SCENARIO" = archive ]; then echo CHANGELOG.md; fi
    ;;
  download)
    [ "$SCENARIO" = archive ] || exit 2
    mkdir -p "$RUNNER_TEMP/previous"
    printf '# Archived history\\n' > "$RUNNER_TEMP/previous/CHANGELOG.md"
    ;;
  upload)
    cp "$RUNNER_TEMP/CHANGELOG.md" "$RUNNER_TEMP/uploaded.md"
    ;;
  *) exit 2 ;;
esac
`,
      { mode: 0o755 },
    );
    execFileSync('bash', ['-e', '-o', 'pipefail', '-c', archiveStep.run], {
      cwd: repo,
      env: {
        ...process.env,
        PATH: `${repo}:${process.env.PATH}`,
        RUNNER_TEMP: repo,
        PREVIOUS_TAG: 'v1.0.0',
        RELEASE_REF: 'v1.0.1',
        SCENARIO: scenario,
      },
      stdio: 'pipe',
    });
    const archive = fs.readFileSync(path.join(repo, 'uploaded.md'), 'utf8');
    expect(archive).toContain('## v1.0.1\n\n### Fixed\n\n- Current fix');
    expect(archive).toContain(
      scenario === 'archive' ? '# Archived history' : '# Checked-in history',
    );
  },
);

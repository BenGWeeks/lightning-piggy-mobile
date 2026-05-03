<!--
Title format: Conventional Commits + optional scope, optional trailing issue suffix.
  feat(scope): subject (#nnn)        feat: subject
  fix(scope): subject (#nnn)         fix: subject
  perf(scope): subject (#nnn)        refactor(scope): subject
  chore: subject     ci: subject     docs: subject     deps: subject
  test: subject      build: subject  style: subject

Body sections below are required.
- feat / fix / perf / refactor PRs MUST include a `Closes #nnn` line (one per resolved issue).
- All PRs MUST include a `## Test plan` section with steps or `N/A — <reason>`.
-->

## Summary

<!-- 1-3 bullets: what changed and why. -->

## Closes

Closes #

<!-- One `Closes #nnn` per resolved issue. Delete this section for chore / ci / docs / deps PRs not tied to an issue. -->

## Test plan

<!--
Step-by-step actions a reviewer or tester can follow, with expected results.
Example:
  1. Open the Messages tab.
  2. **Expected:** conversations appear immediately on cold start (no blank flash).
  3. Tap the (+) FAB.
  4. **Expected:** sheet animates up smoothly, friend list appears within ~250 ms.

For pure-refactor / docs / CI / deps PRs with no user-visible change, replace with:

  N/A — <one-line reason, e.g. "internal refactor, covered by existing perf-suite">
-->

## Screenshots (if applicable)

<!--
For UI changes, attach before/after screenshots. Use ADB to capture on Android:
  adb exec-out screencap -p > /tmp/screen.png
  convert /tmp/screen.png -resize 1200x1200\> /tmp/screen_small.png
-->

## Perf impact (if applicable)

<!--
For PRs touching list-rendering / sheet / animation surfaces, run:
  scripts/perf-suite.sh
on this branch and on `main`, then paste the median table delta. Otherwise N/A.
-->

# Copilot review instructions

When reviewing pull requests in this repository, format your output to support **per-finding resolution** instead of a single bulk text response. Each distinct issue should be a separate inline comment so reviewers can address and resolve them one by one.

## How to leave reviews

1. **One inline comment per distinct finding.** Anchor each comment to the specific line(s) of code it concerns. Do NOT bundle multiple findings into a single inline comment, and do NOT put actionable findings in the top-level review summary — those can't be resolved individually.

2. **Top-level review summary** should ONLY describe the PR overall (1-3 sentences on what the PR changes + a verdict). Do not put actionable items there.

3. **Tag findings by severity** at the start of each comment so authors can prioritise:
   - `[blocking]` — would cause a regression / bug / data loss / security issue if shipped
   - `[suggestion]` — non-blocking improvement worth considering
   - `[nit]` — small style / clarity / consistency note
   - `[question]` — clarification request, not necessarily a fix

4. **Each comment should be self-contained.** Include enough context that the author can act on it without scrolling back to the summary or other comments.

5. **Suggest concrete fixes** when possible. A 3-line code suggestion is more useful than a paragraph of prose. Use GitHub's `suggestion` code blocks when the fix is mechanical.

## Repository conventions to enforce

- **Conventional Commits + optional scope** in PR titles: `<type>: <subject>` or `<type>(<scope>): <subject>`
  - Types: `feat`, `fix`, `perf`, `refactor`, `chore`, `ci`, `docs`, `deps`, `test`, `build`, `style`
  - Scope is optional, lower-case alphanumeric when present (e.g. `ui`, `nostr`, `dm`, `onboarding`)
  - A trailing `(#nnn)` issue suffix is allowed but optional; what's required (for `feat`/`fix`/`perf`/`refactor`) is at least one `Closes #nnn` line in the PR body — see `pr-lint.yml`
- **All PRs include `## Test plan`** section with concrete steps or `N/A — <reason>`
- **Mobile-specific:** all interactive elements need `accessibilityLabel` and/or `testID`. Maestro tests must use `id:` or `text:` selectors, never coordinates (see `CLAUDE.md`)
- **Avatar caching:** every `expo-image` `<Image>` for an avatar must use `cachePolicy="memory-disk"` + `recyclingKey={picture}` + `autoplay={false}` (see PR #245 follow-ups)

## What NOT to do

- Don't repeat the same finding across multiple comments — pick the most specific anchor line
- Don't comment on auto-formatted lines (Prettier already gates this)
- Don't suggest naming changes for already-shipping symbols unless there's a real bug or ambiguity
- Don't comment on commented-out code unless removing it would actually clean things up

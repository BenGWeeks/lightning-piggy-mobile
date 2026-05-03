---
name: Bug Report
about: Report a bug or unexpected behavior
title: 'bug: '
labels: bug
assignees: ''
---

## Description

A clear and concise description of the bug.

## Steps to Reproduce

1. Go to '...'
2. Tap on '...'
3. Observe '...'

## Expected Behavior

What you expected to happen.

## Actual Behavior

What actually happened.

## Screenshots / Recording

If applicable, attach screenshots or a screen recording. Capture on Android via:

```sh
adb exec-out screencap -p > /tmp/screen.png
convert /tmp/screen.png -resize 1200x1200\> /tmp/screen_small.png
```

## Environment

- Device: [e.g. Pixel 8 / AVD `Medium_Phone_API_36.1`]
- Android version: [e.g. 16]
- App version: [e.g. v1.0.0 versionCode 28 — see Settings → About]
- Build flavor: [release / dev / preview]
- Signer: [nsec / Amber / N/A]

## Logs

If the bug shows up in `adb logcat`, attach the relevant slice:

```sh
adb logcat -d -t 300 | grep -E "ReactNativeJS|FATAL|AndroidRuntime"
```

## Additional Context

Anything else worth knowing — frequency, recent app updates, related Nostr / NWC state.

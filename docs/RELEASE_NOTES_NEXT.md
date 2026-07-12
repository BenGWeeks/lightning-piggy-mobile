<!--
Append a one-line bullet describing your user-visible change in the same PR.
Each release, the contents of this file are auto-published to TestFlight as
the "What to Test" notes for that build, then the file is reset.

- Keep bullets short, written for a tester, not a developer.
- Only user-visible changes belong here; pure refactors / CI / docs do not.
- Empty file = release workflow falls back to `git log` subjects since the last tag.

See docs/DEPLOYMENT.adoc → "TestFlight 'What to Test' automation".
-->

## What to test in the next release

### New

- **App language is now its own setting.** Account → **Language** (moved out of Appearance) — switch between System / English / Español / Українська.
- **"Typing…" in chats.** You'll see when the other person is typing in a 1:1 message thread.
- **Tabbed leaderboard.** Explore → Geo-caches → Leaderboard now has **Top hiders** / **Top finders** tabs instead of one long list.
- **The Geo-caches map scrolls with the page**, and Nearby merchants now show in a horizontal rail — the map no longer takes up a fixed chunk of the screen.
- **Experimental (testers): native crypto.** Account → Nostr → **Experimental** has a "Native crypto (rust-nostr)" switch. Turning it on (Android only, restart to apply) runs message encryption and signature checks through a native module instead of JavaScript — much faster on busy inboxes. Watch for anything odd in messaging and turn it back off if so. Off by default; the row shows "Unavailable on this device" where it can't run.

### Improved

- **Group messages appear the instant you hit send** — no waiting for encryption to finish first.
- **Snappier taps after the app wakes up** from a long time in the background.
- **Sending is faster** — the app no longer re-reads your key from secure storage on every message.
- **Geo-cache pages are smoother** as recently-added / recently-found and their icons stream in.

### Fixed

- **Messages sent while your app was asleep now arrive as soon as it reconnects**, instead of only when you open the Messages tab.
- Ukrainian: the "typing…" label is now translated.

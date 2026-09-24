# Background payment settings

Captured on 20 September 2026 with ADB from Warmachine's `lightningpiggy_api34` emulator, running the development client with Metro loading PR #1100 commit `cae322d5`. Maestro navigated Account → Security and scrolled to the background messages and payments control.

`01-background-payment-settings.png` is an unedited emulator screenshot. It shows the default-off opt-in, NWC-only scope, polling interval and battery guidance. No credentials or private endpoint appear.

This is UI evidence only. The installed native client was not rebuilt for this capture; the image does not prove background/headless delivery, the updated native notification-channel text, reboot handling, or GrapheneOS battery behaviour. Those require the corresponding native build and device tests.

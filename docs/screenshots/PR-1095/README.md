# Configurable swap backend screenshots

Captured on 18 September 2026 from PR #1095 commit `58f60e652d62aebab95a11676df81032d892d30f`, using the `lightningpiggy_api34` Android emulator on warmachine. The installed development client loaded Metro from a separate checkout of that exact commit.

- `01-default-backend.png`: Account → On-chain, showing the default Boltz API URL and the new controls.
- `02-custom-url.png`: An example HTTPS endpoint entered in the field. This is an **unsaved example**, not a successful connection test.
- `03-https-validation.png`: Attempting to save an HTTP URL produces the HTTPS validation error before making a network request.

These are unedited emulator captures. Only reserved `example.com` addresses are used for the custom URL; no family endpoint or wallet credentials are displayed. The input was reset to the default after capture. No swap was created and no funds were moved.

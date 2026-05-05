#!/usr/bin/env node
// Set the "What to Test" (whatsNew) string on a TestFlight build via the
// App Store Connect API.
//
// Why: `eas build --auto-submit` ships builds with a blank "What to Test"
// field; `eas.json` has no slot for it (as of EAS CLI 18). EAS itself does
// not expose the betaBuildLocalizations endpoint either. So we PATCH it
// post-submit using the ASC API directly.
//
// Inputs (env vars):
//   ASC_API_KEY_ID         10-char ASC API key ID (e.g. "ABC1234567")
//   ASC_API_KEY_ISSUER_ID  UUID of the issuing team
//   ASC_API_KEY_P8         the .p8 private-key file CONTENTS (multi-line PEM)
//   ASC_APP_ID             numeric App Store Connect app ID (matches eas.json
//                          → submit.production.ios.ascAppId, e.g. "6762218164")
//   ASC_BUILD_VERSION      build number to target (e.g. "42") — usually the
//                          CFBundleVersion EAS just incremented to
//   WHATS_NEW              the changelog text to set
//
// Optional:
//   ASC_LOCALE             defaults to "en-US"
//   ASC_MAX_WAIT_SECS      max seconds to wait for the build to appear in
//                          ASC after submission (default 900 = 15 min)
//
// Exit: 0 on success, non-zero on hard failure. We treat "build not found
// after waiting" as a soft failure and exit 0 with a warning, so a slow
// Apple processing queue doesn't fail the whole release.

import crypto from 'node:crypto';

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[asc] missing required env var: ${name}`);
    process.exit(2);
  }
  return v;
}

function makeJwt({ keyId, issuerId, privateKeyPem }) {
  // ASC API requires ES256, 20-min max lifetime.
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: issuerId,
    iat: now,
    exp: now + 19 * 60,
    aud: 'appstoreconnect-v1',
  };
  const b64url = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  const signingInput = `${b64url(header)}.${b64url(payload)}`;
  const signer = crypto.createSign('SHA256');
  signer.update(signingInput);
  // ASC keys are EC P-256; Node returns DER-encoded ECDSA. JWT needs IEEE
  // P1363 (raw r||s, 64 bytes). Re-encode via dsaEncoding option.
  const sigBytes = signer.sign({ key: privateKeyPem, dsaEncoding: 'ieee-p1363' });
  const sig = Buffer.from(sigBytes)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${signingInput}.${sig}`;
}

async function ascFetch(jwt, pathAndQuery, init = {}) {
  const url = `https://api.appstoreconnect.apple.com${pathAndQuery}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { _raw: text };
  }
  return { status: res.status, ok: res.ok, json };
}

async function findBuild({ jwt, appId, version }) {
  // Builds endpoint: filter by app + version. Apple returns most-recent first.
  const q = new URLSearchParams({
    'filter[app]': appId,
    'filter[version]': version,
    sort: '-uploadedDate',
    limit: '5',
  }).toString();
  const r = await ascFetch(jwt, `/v1/builds?${q}`);
  if (!r.ok) {
    throw new Error(`builds query failed: ${r.status} ${JSON.stringify(r.json)}`);
  }
  const builds = r.json.data || [];
  return builds[0] || null;
}

async function getOrCreateLocalization({ jwt, buildId, locale }) {
  // List existing localizations on this build.
  const r = await ascFetch(jwt, `/v1/builds/${buildId}/betaBuildLocalizations`);
  if (!r.ok) {
    throw new Error(`list localizations failed: ${r.status} ${JSON.stringify(r.json)}`);
  }
  const existing = (r.json.data || []).find((d) => d.attributes?.locale === locale);
  if (existing) return existing;
  // Create new localization for the locale.
  const create = await ascFetch(jwt, '/v1/betaBuildLocalizations', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        type: 'betaBuildLocalizations',
        attributes: { locale, whatsNew: '' },
        relationships: { build: { data: { type: 'builds', id: buildId } } },
      },
    }),
  });
  if (!create.ok) {
    throw new Error(`create localization failed: ${create.status} ${JSON.stringify(create.json)}`);
  }
  return create.json.data;
}

async function setWhatsNew({ jwt, locId, whatsNew }) {
  const r = await ascFetch(jwt, `/v1/betaBuildLocalizations/${locId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      data: {
        type: 'betaBuildLocalizations',
        id: locId,
        attributes: { whatsNew },
      },
    }),
  });
  if (!r.ok) {
    throw new Error(`patch whatsNew failed: ${r.status} ${JSON.stringify(r.json)}`);
  }
}

async function waitForBuild({ jwt, appId, version, maxWaitSecs }) {
  const deadline = Date.now() + maxWaitSecs * 1000;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    const build = await findBuild({ jwt, appId, version });
    if (build) {
      console.error(`[asc] found build ${build.id} (version ${version}) on attempt ${attempt}`);
      return build;
    }
    // Apple typically takes 5-15 min after EAS submit completes before the
    // build is visible via the API. Poll every 30s.
    console.error(
      `[asc] build version ${version} not yet visible, retrying in 30s (attempt ${attempt})`,
    );
    await new Promise((r) => setTimeout(r, 30_000));
  }
  return null;
}

async function main() {
  const keyId = requireEnv('ASC_API_KEY_ID');
  const issuerId = requireEnv('ASC_API_KEY_ISSUER_ID');
  const p8 = requireEnv('ASC_API_KEY_P8');
  const appId = requireEnv('ASC_APP_ID');
  const version = requireEnv('ASC_BUILD_VERSION');
  const whatsNew = requireEnv('WHATS_NEW').trimEnd();
  const locale = process.env.ASC_LOCALE || 'en-US';
  const parsedMaxWait = parseInt(process.env.ASC_MAX_WAIT_SECS || '', 10);
  const maxWaitSecs = Number.isFinite(parsedMaxWait) && parsedMaxWait > 0 ? parsedMaxWait : 900;

  const jwt = makeJwt({ keyId, issuerId, privateKeyPem: p8 });

  const build = await waitForBuild({ jwt, appId, version, maxWaitSecs });
  if (!build) {
    console.error(
      `::warning title=TestFlight whatsNew not set::Build ${version} did not appear in App Store Connect within ${maxWaitSecs}s. Run scripts/asc-set-whats-new.mjs manually once Apple processes the build.`,
    );
    return;
  }

  const loc = await getOrCreateLocalization({ jwt, buildId: build.id, locale });
  await setWhatsNew({ jwt, locId: loc.id, whatsNew });
  console.error(
    `[asc] set "What to Test" on build ${build.id} (${locale}, ${whatsNew.length} chars)`,
  );
}

main().catch((err) => {
  console.error(`[asc] fatal: ${err.message}`);
  process.exit(1);
});

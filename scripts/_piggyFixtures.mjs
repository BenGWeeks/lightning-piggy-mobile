// Shared helper used by every test-publish script to source its signing
// key from a small set of named "Piggy" fixture nsecs. Previously each
// script invented its own env-var name (PIGGY_NSEC, NSEC,
// BIG_PIGGY_NSEC, MAESTRO_NSEC_*) and a couple of them silently fell
// back to generateSecretKey() — leaving orphan pubkeys scattered across
// relays on every dev run. This module canonicalises:
//
//   BIG    → MAESTRO_NSEC_BIG       (the user's primary test identity)
//   MIDDLE → MAESTRO_NSEC_MIDDLE    (the friendly Piggy)
//   LITTLE → MAESTRO_NSEC_LITTLE    (the curious Piggy)
//   EVIL   → MAESTRO_NSEC_EVIL      (the antagonist — for moderation /
//                                    untrusted-publisher test paths)
//
// Reference: reference_ben_nostr_identity memory + the existing
// MAESTRO_NSEC_* convention already in publish-test-find-logs.mjs,
// send-nip17-test.mjs, verify-bigpiggy-outbox.mjs, verify-recv.mjs.

import { getPublicKey } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';

// Canonical role → env-var-name map. Add roles here, not inline in
// scripts, so a new fixture can be introduced in one place.
export const PIGGY_NSEC_ENV = {
  BIG: 'MAESTRO_NSEC_BIG',
  MIDDLE: 'MAESTRO_NSEC_MIDDLE',
  LITTLE: 'MAESTRO_NSEC_LITTLE',
  EVIL: 'MAESTRO_NSEC_EVIL',
};

export const PIGGY_ROLES = Object.keys(PIGGY_NSEC_ENV);

// Decode a bech32 nsec into a raw secret key + derived pubkey. Throws
// with a script-friendly message rather than the cryptic nip19 default
// so failures point straight at the missing env var.
export function decodeNsec(nsec, contextLabel = 'nsec') {
  if (typeof nsec !== 'string' || nsec.trim() === '') {
    throw new Error(`${contextLabel}: expected a bech32 nsec, got empty value`);
  }
  const decoded = nip19.decode(nsec.trim());
  if (decoded.type !== 'nsec') {
    throw new Error(`${contextLabel}: expected nsec, got ${decoded.type}`);
  }
  const sk = decoded.data;
  const pk = getPublicKey(sk);
  return { sk, pk };
}

// Resolve a Piggy role to a { sk, pk } pair. Throws (loudly) if the
// env var isn't set — never silently falls back to a random key,
// because random keys litter relays with un-cleanupable pubkeys.
//
//   const { sk, pk } = resolvePiggy('BIG');
export function resolvePiggy(role) {
  if (!PIGGY_NSEC_ENV[role]) {
    throw new Error(
      `Unknown Piggy role "${role}". Known roles: ${PIGGY_ROLES.join(', ')}`,
    );
  }
  const envVar = PIGGY_NSEC_ENV[role];
  const nsec = process.env[envVar];
  if (!nsec) {
    throw new Error(
      `${envVar} is not set. Export your ${role} Piggy nsec before running this script — see docs/TESTING.adoc for the canonical fixture list.`,
    );
  }
  return decodeNsec(nsec, envVar);
}

// Pick a Piggy role from a CLI / env source with sensible defaults.
// Used by scripts that previously accepted a generic NSEC env var:
// prefer an explicit --piggy=BIG flag, fall back to PIGGY_ROLE env,
// then to the script's caller-supplied default.
export function pickRole({ defaultRole = 'BIG', argv = process.argv } = {}) {
  const flagArg = argv.find((a) => a.startsWith('--piggy='));
  const fromFlag = flagArg ? flagArg.slice('--piggy='.length).toUpperCase() : null;
  const fromEnv = process.env.PIGGY_ROLE ? process.env.PIGGY_ROLE.toUpperCase() : null;
  const role = fromFlag ?? fromEnv ?? defaultRole;
  if (!PIGGY_NSEC_ENV[role]) {
    throw new Error(
      `Invalid Piggy role "${role}". Pass --piggy=BIG|MIDDLE|LITTLE|EVIL or set PIGGY_ROLE.`,
    );
  }
  return role;
}

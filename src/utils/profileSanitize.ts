/**
 * Strips payment-relevant fields from a profile fetched via the
 * unverified batch path (`fetchProfiles` → the `pool.verifyEvent` kind-0
 * fast-path in `services/nostrService`).
 *
 * A batch-fetched kind-0 event skips signature verification, so a
 * malicious relay could forge any field. A forged name/avatar is only
 * cosmetic, but a forged `lud16` (lightning address) would silently
 * redirect a zap to the attacker. The batch consumers — the zap-sender
 * resolver and the contacts list — are display-only and never pay
 * `lud16` directly; the screens that actually zap a contact re-fetch the
 * profile through the verified single `fetchProfile`. So the `lud16` value
 * is dropped here, but its *presence* is recorded in `hasLud16` so display
 * surfaces can show/grey the zap affordance correctly without exposing the
 * forgeable value (the real address is re-resolved + verified at zap time).
 *
 * `banner` and `about` are KEPT: both are purely cosmetic (a forged image
 * or bio carries no payment risk), and display surfaces do read them — the
 * quick-profile sheet renders the banner (#666/#18) and the bio should not
 * be empty just because a profile arrived via the batch path.
 */
import type { NostrProfile } from '../types/nostr';

export function slimDisplayProfile(profile: NostrProfile): NostrProfile {
  // `|| profile.hasLud16 === true` keeps the function idempotent: re-slimming
  // an already-slim profile (lud16 already null) must not lose the recorded
  // presence.
  return { ...profile, lud16: null, hasLud16: profile.lud16 != null || profile.hasLud16 === true };
}

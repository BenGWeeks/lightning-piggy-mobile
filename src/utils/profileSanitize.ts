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
 * profile through the verified single `fetchProfile`. So `lud16` is the
 * only field dropped here.
 *
 * `banner` and `about` are KEPT: both are purely cosmetic (a forged image
 * or bio carries no payment risk), and display surfaces do read them — the
 * quick-profile sheet renders the banner (#666/#18) and the bio should not
 * be empty just because a profile arrived via the batch path.
 */
import type { NostrProfile } from '../types/nostr';

export function slimDisplayProfile(profile: NostrProfile): NostrProfile {
  return { ...profile, lud16: null };
}

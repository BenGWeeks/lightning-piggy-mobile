// Maps a cryptic *wallet-side* prize-claim failure to friendly copy. The
// claim receives the payout by asking the active wallet to make an invoice;
// when that wallet can't be reached (NWC relay 403 / wrong relay URL / no
// kind-13194 info event / connection timeout) the underlying SDK surfaces a
// raw string like "no info event (kind 13194) returned from relay" (#734).
//
// Returns null when the raw message should be shown as-is — i.e. meaningful
// LNURL-withdraw *issuer* messages (cache empty, cooldown, already claimed),
// which the caller passes through unchanged.

const WALLET_UNREACHABLE =
  /no info event|kind ?13194|\b403\b|could not connect|connection refused|websocket|\brelay\b|timed out|timeout|enable failed/i;

export function friendlyClaimError(reason: string): string | null {
  if (WALLET_UNREACHABLE.test(reason)) {
    return "Couldn't reach your wallet to receive the prize. Check your active wallet's connection, then try again.";
  }
  return null;
}

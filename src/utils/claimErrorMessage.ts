// Maps a cryptic wallet-side prize-claim failure to friendly copy. The claim asks the chosen wallet to make an invoice; when that wallet can't be reached (NWC relay 403 / wrong relay URL / no kind-13194 info event / connection timeout) the SDK surfaces a raw string like "no info event (kind 13194) returned from relay" (#734).
// Returns null when the raw message should be shown as-is — meaningful LNURL-withdraw issuer messages (cache empty, cooldown, already claimed) the caller passes through unchanged.

const WALLET_UNREACHABLE =
  /no info event|kind ?13194|\b403\b|could not connect|connection refused|websocket|\brelay\b|timed out|timeout|enable failed/i;

export function friendlyClaimError(reason: string): string | null {
  if (WALLET_UNREACHABLE.test(reason)) {
    return "Couldn't reach your wallet to receive the prize. Check your wallet's connection, then try again.";
  }
  return null;
}

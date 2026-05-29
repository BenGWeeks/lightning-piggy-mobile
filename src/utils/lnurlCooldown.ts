// Shared cooldown helpers for LNURL-withdraw claim UIs.
//
// LNbits reusable withdraw links rate-limit between uses and reply with a
// "you must wait" message; we treat that as a benign "come back later" state
// (a live countdown) rather than a hard error. Used by both the geo-cache
// prize sheet (NfcReadSheet) and the standalone withdraw-voucher sheet
// (LnurlWithdrawSheet) so the two stay in lock-step. See #341.

// LNbits' withdraw endpoint returns 'Wait N seconds.' verbatim; older versions
// / other backends use 'wait_time: N', 'cooldown', or budget-exhausted shapes.
// `\bwait` (no trailing \b) catches all of "Wait 79017", "wait_time", "waiting"
// and "must wait" — a trailing \b would miss "wait_time" since '_' is a word
// char. Dropping into this benign sleeping countdown beats the red 'Couldn't
// claim' state for what is really just a rate-limit.
export const SLEEPING_PATTERN =
  /\bwait|cooldown|budget|sleeping|exhausted|already used|too (?:soon|early|many)/i;

// Parse the LNURLw's 'Wait N seconds' / 'wait_time: N' / 'cooldown Ns' shape
// into the integer N — used to drive the live countdown. Returns null when the
// server's response carries no time hint (budget exhausted, generic 'already
// used', etc.) so callers can fall back to static copy. Not capped at 5 digits:
// a long cooldown can exceed 99999 s (~27 h).
export const parseCooldownSeconds = (raw: string): number | null => {
  const m = raw.match(/(\d+)\s*(?:s|sec|seconds?)?/i);
  if (!m) return null;
  const total = Number(m[1]);
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.round(total);
};

// Format a remaining-seconds count for a counting-down display, picking the
// unit by magnitude so it reads naturally as time runs down:
//   <1 min  → '45s'
//   <1 hr   → '3:05'      (M:SS)
//   <1 day  → '3h 05m'
//   ≥1 day  → '1d 03h'
export const formatCountdown = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${String(m).padStart(2, '0')}m`;
  }
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return `${d}d ${String(h).padStart(2, '0')}h`;
};

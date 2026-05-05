/**
 * Bolt11 payment-hash extraction for DM-bolt11 attribution (#126).
 *
 * When a friend DMs us a bolt11 invoice (or we DM one to them), the
 * resulting wallet transaction has no on-chain link back to the
 * counterparty — bolt11 has no NIP-57-style receipt with a sender
 * pubkey. We bridge that gap by mapping `payment_hash → counterparty`
 * at DM-receive / DM-send time and looking it up at attribution time.
 *
 * `extractInvoice()` in `messageContent.ts` already decodes the *first*
 * invoice it finds for the message-bubble UI. The attribution scanner
 * needs to find *all* bolt11s in a message body (rare but possible —
 * e.g. a "here are two invoices" reply), so this module loops the same
 * regex + decoder until exhausted.
 */
import { decode as bolt11Decode } from 'light-bolt11-decoder';

// Same prefix shape as INVOICE_REGEX in messageContent.ts but `g`-flagged
// so we can sweep multiple invoices out of one DM body.
const INVOICE_REGEX_GLOBAL = /\b(?:lightning:)?(ln(?:bc|tb|ts|bs)[0-9a-z]{50,})\b/gi;

/**
 * Pulls every bolt11 invoice out of `text` and returns its 32-byte
 * payment_hash (hex, lowercase). Invalid / undecodable invoices are
 * silently skipped so a malformed string in the body never poisons
 * the whole scan. Returns an empty array when the text contains no
 * decodable bolt11s.
 */
export function extractBolt11PaymentHashes(text: string): string[] {
  if (!text) return [];
  const hashes: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(INVOICE_REGEX_GLOBAL)) {
    const raw = match[1];
    try {
      const decoded = bolt11Decode(raw);
      // The decoder's `Section` discriminated union doesn't expose a
      // common `value` field on every variant (e.g. `checksum` has none),
      // so we cast the matching entry to read it. The `name` discriminator
      // narrows safely at runtime.
      const hashSection = decoded.sections.find((s) => s.name === 'payment_hash') as
        | { name: 'payment_hash'; value: string }
        | undefined;
      if (!hashSection) continue;
      const hash = String(hashSection.value).toLowerCase();
      if (!hash || seen.has(hash)) continue;
      seen.add(hash);
      hashes.push(hash);
    } catch {
      // Malformed bolt11 — skip it. Other invoices in the same body
      // can still attribute.
    }
  }
  return hashes;
}

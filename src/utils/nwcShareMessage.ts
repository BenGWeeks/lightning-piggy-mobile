// App-internal structured DM: "share an NWC (Nostr Wallet Connect) wallet".
//
// The NWC connection string (`nostr+walletconnect://…`) is a BEARER SECRET —
// anyone holding it can spend from the wallet — so this message travels ONLY
// inside a NIP-17 gift-wrapped DM (encrypted, peer-only). It is never sent as a
// public/plaintext relay event and its secret is never surfaced in an inbox
// preview or a notification body (see `nwcSharePreviewText` + `dmRowPreview`).
//
// Modelled on the marketplace order card (kinds 16/17, see ./orderEvents): a
// distinct inner rumor kind carried in the flat `dm_messages` row via
// `wireKind`, with the card's JSON in `content`; the conversation renderer
// rebuilds an "Add NWC Wallet" card from it (see ./conversationItems). Kept
// dependency-light (NO `@getalby/sdk` / nwcService import) so the conversation
// renderer AND the hot decrypt-loop preview path can import it freely.

/**
 * Inner NIP-17 rumor kind for an NWC-wallet share. App-specific: LP is the only
 * client that both sends and renders it. The value only needs to (a) not collide
 * with the kinds we already ingest/render specially (4 NIP-04, 14/15 NIP-17,
 * 16/17 order), and (b) stay stable — a received row's `wireKind` equals this,
 * which is how the renderer tells a wallet share apart from a chat bubble. The
 * kind is never published to a relay directly (only its gift wrap, kind 1059,
 * is), so its numeric range has no relay-storage semantics.
 */
export const NWC_SHARE_KIND = 21947;

export interface NwcShareCard {
  /** The `nostr+walletconnect://…` connection string — a bearer secret. */
  nwcUrl: string;
  /** Optional human alias for the shared wallet, shown on the card. */
  walletName?: string;
}

/**
 * Shape-check an NWC connection URL — a self-contained mirror of
 * `validateNwcUrl` in `services/nwcService` (protocol + 64-hex pubkey host + ≥1
 * `relay` param + a `secret` param), WITHOUT importing that module (which drags
 * in `@getalby/sdk`). Keeps this file light enough for the render + preview
 * paths. Validation-only: it never connects.
 */
export function isNwcConnectionUrl(url: string): boolean {
  if (typeof url !== 'string') return false;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  if (parsed.protocol.toLowerCase() !== 'nostr+walletconnect:') return false;
  if (!/^[0-9a-fA-F]{64}$/.test(parsed.hostname)) return false;
  if (parsed.searchParams.getAll('relay').length === 0) return false;
  if (!parsed.searchParams.get('secret')) return false;
  return true;
}

/**
 * Build the shareable card from a wallet's stored fields. Prefers the user's own
 * local label (`alias` — the exact name shown in the settings/confirm UI) so the
 * recipient's card matches what the sender agreed to share; falls back to the
 * remote getInfo name (`walletAlias`) only when the local label is blank, and to
 * `undefined` (an unnamed card) when neither is set. Kept as a tiny pure helper
 * so both the Attach-menu and Settings share entry points derive the name
 * identically. Takes primitives (not `WalletState`) to keep this file
 * dependency-light for the render + preview paths.
 */
export function nwcShareCardFromWallet(
  nwcUrl: string,
  alias: string,
  walletAlias?: string,
): NwcShareCard {
  const walletName = alias.trim() || walletAlias?.trim() || undefined;
  return { nwcUrl, walletName };
}

/**
 * Canonical storage form. The card is persisted as its JSON in the DM row's
 * `content` (the flat store has no extra column), so the conversation renderer
 * can rebuild the full card. A blank `walletName` is dropped so it round-trips
 * as `undefined` rather than an empty string.
 */
export function serializeNwcShare(card: NwcShareCard): string {
  // Normalise both fields so the stored/echoed JSON is deterministic and
  // `parseNwcShare(serializeNwcShare(card))` round-trips byte-for-byte.
  const nwcUrl = card.nwcUrl.trim();
  const name = card.walletName?.trim();
  return JSON.stringify(name ? { nwcUrl, walletName: name } : { nwcUrl });
}

/**
 * Inverse of `serializeNwcShare`; returns null when `content` isn't a stored
 * wallet share. Requires a well-formed NWC URL so a corrupt / off-schema row (or
 * an unrelated payload that happened to share the kind) never renders as a card
 * that would import a bogus wallet.
 */
export function parseNwcShare(content: string): NwcShareCard | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.nwcUrl !== 'string' || !isNwcConnectionUrl(o.nwcUrl)) return null;
  const walletName =
    typeof o.walletName === 'string' && o.walletName.trim().length > 0
      ? o.walletName.trim()
      : undefined;
  return { nwcUrl: o.nwcUrl.trim(), walletName };
}

/**
 * Secret-free one-line preview for an inbox row / notification body. NEVER
 * includes the NWC connection string. Hardcoded English to match the util-layer
 * convention (`orderPreviewText`) — the store/notification layers have no `t`.
 */
export function nwcSharePreviewText(card: NwcShareCard | null): string {
  if (card?.walletName) return `🔌 Shared wallet "${card.walletName}"`;
  return '🔌 Shared a wallet connection';
}

/**
 * Inbox-preview / notification text for a stored NWC-share row: derive the
 * secret-free summary from the row's `content`, or a neutral label if it won't
 * parse. Guarantees the raw connection string never leaks into a preview.
 */
export function nwcSharePreviewFromContent(content: string): string {
  return nwcSharePreviewText(parseNwcShare(content));
}

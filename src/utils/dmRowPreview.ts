import { orderPreviewFromContent } from './orderEvents';
import { pollPreviewFromContent } from './nip88Poll';
import { NWC_SHARE_KIND, nwcSharePreviewFromContent } from './nwcShareMessage';

/**
 * Secret-free inbox / notification preview for a stored DM row, dispatched by
 * `wireKind`. Structured rows carry non-human `content` (order JSON, poll JSON,
 * an NWC connection string) that must never surface raw in a conversation-list
 * preview or a push-notification body:
 *
 *  - NWC wallet share (kind {@link NWC_SHARE_KIND}) → a label that never
 *    includes the bearer connection string.
 *  - Encrypted file message (kind 15) whose content carries the `#lpe=1…`
 *    fragment → a neutral "attachment" label. An AES-GCM voice note / photo is
 *    stored as that URL, whose fragment embeds the decryption key + nonce (see
 *    `encodeEncryptedFileUrl` / `textForRumor`); it must never surface in a
 *    conversation-list preview or a lock-screen notification, so it's redacted
 *    to a label here. Plain kind-15 rows (bare blob URL, no secret) pass through.
 *  - Structured NIP-88 poll / vote (kind 1068/1018) → the poll summary.
 *  - Marketplace order / receipt (kind 16/17) → the order summary.
 *  - Everything else → the content unchanged (plain chat text, …).
 *
 * Shared by every store → preview projection (inbox refresh, live sub,
 * wrap ingest, background notification) so they redact identically.
 */
export function dmRowPreview(content: string, wireKind: number): string {
  if (wireKind === NWC_SHARE_KIND) return nwcSharePreviewFromContent(content);
  // `#lpe=1` is the encrypted-file fragment marker (see encryptedFileUrl.ts);
  // its `&k=…&n=…` params are the decryption secret, so never let it through.
  if (wireKind === 15 && content.includes('#lpe=1')) return '📎 Attachment';
  return pollPreviewFromContent(content, wireKind) ?? orderPreviewFromContent(content, wireKind);
}

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
 *  - Structured NIP-88 poll / vote (kind 1068/1018) → the poll summary.
 *  - Marketplace order / receipt (kind 16/17) → the order summary.
 *  - Everything else → the content unchanged (plain chat text, file URLs, …).
 *
 * Shared by every store → preview projection (inbox refresh, live sub,
 * wrap ingest, background notification) so they redact identically.
 */
export function dmRowPreview(content: string, wireKind: number): string {
  if (wireKind === NWC_SHARE_KIND) return nwcSharePreviewFromContent(content);
  return pollPreviewFromContent(content, wireKind) ?? orderPreviewFromContent(content, wireKind);
}

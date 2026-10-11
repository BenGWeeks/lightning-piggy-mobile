import { translations } from '../i18n';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The attachment fallback labels Marmot rows are stored with when the media
// can't be shown (`attachmentFallbackText`), in every locale — the text is
// translated when the message arrives, so a stored row may be in any of them.
const PLACEHOLDER_PATTERNS: RegExp[] = Object.values(translations).flatMap((cat) =>
  [cat.messageBubble.attachmentUnavailable, cat.messageBubble.unsupportedAttachment].map(
    (template) =>
      new RegExp(`^${escape(template).replace(/\\\{\\\{(?:name|type)\\\}\\\}/g, '.*')}$`, 's'),
  ),
);

/**
 * True for a stored message text that is only a stand-in for an attachment:
 * empty (Marmot voice notes received before #1225 were stored blank) or an
 * attachment fallback label. A history replay may repair such a row (#1241).
 */
export function isAttachmentPlaceholderText(text: string): boolean {
  return text === '' || PLACEHOLDER_PATTERNS.some((re) => re.test(text));
}

import { translations } from '../i18n';
import { isAttachmentPlaceholderText } from './attachmentPlaceholder';

describe('isAttachmentPlaceholderText', () => {
  it('matches blank text and the fallback labels in every locale', () => {
    expect(isAttachmentPlaceholderText('')).toBe(true);
    for (const cat of Object.values(translations)) {
      const unavailable = cat.messageBubble.attachmentUnavailable.replace('{{name}}', 'a b.m4a');
      const unsupported = cat.messageBubble.unsupportedAttachment
        .replace('{{name}}', 'clip.mov')
        .replace('{{type}}', 'video/quicktime');
      expect(isAttachmentPlaceholderText(unavailable)).toBe(true);
      expect(isAttachmentPlaceholderText(unsupported)).toBe(true);
    }
  });

  it('does not match ordinary messages', () => {
    expect(isAttachmentPlaceholderText('hello')).toBe(false);
    expect(isAttachmentPlaceholderText("I couldn't open attachment: x — can you resend?")).toBe(
      false,
    );
  });
});

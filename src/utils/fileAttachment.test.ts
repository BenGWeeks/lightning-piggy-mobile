import { buildConversationItems } from './conversationItems';
import { chatUnreadEntries } from './unreadDivider';
import { unreadCount, firstUnreadId } from './chatUnread';
import { attachmentMetadata, classifyAttachment, parseFileAttachment } from './fileAttachment';
import { encodeMarmotMediaUrl } from './encryptedFileUrl';

const encoded = (mime: string) =>
  encodeMarmotMediaUrl({
    url: 'https://blossom.example/invoice.pdf',
    version: 'encrypted-media-v2',
    mime,
    keysHex: ['11'.repeat(32)],
    nonceHex: '22'.repeat(12),
    filename: 'invoice.pdf',
    plaintextSha256: '33'.repeat(32),
    ciphertextSha256: '44'.repeat(32),
    name: 'Invoice.pdf',
    size: 2048,
  });

describe('attachment classification', () => {
  it.each([
    ['image/png', 'image'],
    ['audio/mp4', 'voice'],
    ['application/pdf', 'file'],
  ])('%s → %s', (mime, expected) => {
    expect(classifyAttachment(encoded(mime), 15)).toBe(expected);
  });
  it('preserves unknown kinds even when the payload looks like media', () => {
    expect(classifyAttachment(encoded('image/png'), 1234)).toBe('unknown');
  });
  it('keeps authenticated filename and display metadata separate', () => {
    expect(parseFileAttachment(encoded('application/pdf'))).toMatchObject({
      name: 'Invoice.pdf',
      size: 2048,
      available: true,
      marmot: { filename: 'invoice.pdf' },
    });
  });
  it('marks incomplete encryption unavailable', () => {
    expect(parseFileAttachment('https://blossom.example/f#lpe=1&m=application/pdf')).toMatchObject({
      available: false,
    });
  });
});

describe('imeta display metadata', () => {
  it('prefers name then alt, with size including zero', () => {
    expect(
      attachmentMetadata([['imeta', 'name Invoice.pdf', 'alt Statement', 'size 2048']]),
    ).toEqual({ name: 'Invoice.pdf', size: 2048 });
    expect(attachmentMetadata([['imeta', 'alt Statement', 'size 0']])).toEqual({
      name: 'Statement',
      size: 0,
    });
  });
  it('decodes the last URL path segment and omits invalid sizes', () => {
    expect(
      attachmentMetadata([['imeta', 'url https://example.com/my%20file.pdf?token=x#f', 'size -5']]),
    ).toEqual({ name: 'my file.pdf' });
    expect(
      attachmentMetadata([
        ['imeta', 'url https://example.com/%ZZ.pdf', 'size 999999999999999999999'],
      ]),
    ).toEqual({ name: '%ZZ.pdf' });
  });
  it('uses filename when no URL/name exists and removes controls', () => {
    expect(attachmentMetadata([['imeta', 'alt a\nb.pdf']], 'fallback.pdf').name).toBe('a b.pdf');
    expect(attachmentMetadata([], 'fallback.pdf').name).toBe('fallback.pdf');
  });
});

it('counts PDF and unknown-kind rows in the same order they render', () => {
  const items = buildConversationItems(
    [
      { id: 'unknown1', fromMe: false, text: '', wireKind: 1234, createdAt: 1 },
      {
        id: 'file0001',
        fromMe: false,
        text: encoded('application/pdf'),
        wireKind: 15,
        createdAt: 2,
      },
    ],
    [],
  );
  const entries = chatUnreadEntries(items, true);
  expect(entries.map((e) => e.id)).toEqual(['dm-unknown1', 'dm-file0001']);
  expect(unreadCount(entries, { at: 0 })).toBe(2);
  expect(firstUnreadId(entries, { at: 0 })).toBe('dm-unknown1');
});

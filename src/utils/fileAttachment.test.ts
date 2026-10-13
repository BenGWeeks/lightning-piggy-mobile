import { buildConversationItems } from './conversationItems';
import { chatUnreadEntries } from './unreadDivider';
import { unreadCount, firstUnreadId } from './chatUnread';
import {
  attachmentMetadata,
  attachmentSafety,
  sanitizeAttachmentText,
  classifyAttachment,
  parseFileAttachment,
} from './fileAttachment';
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

it.each('apk exe msi dmg pkg sh bat cmd ps1 js jar html htm xhtml svg lnk scr iso'.split(' '))(
  'blocks dangerous .%s extensions even with benign MIME',
  (ext) => {
    expect(attachmentSafety(`invoice.pdf.${ext}`, 'application/pdf').dangerous).toBe(true);
  },
);
it.each([
  'application/vnd.android.package-archive',
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'application/javascript',
  'application/x-msdownload',
  'application/x-sh',
  'application/java-archive',
  'application/x-iso9660-image',
])('blocks dangerous MIME %s with a harmless name', (mime) => {
  expect(attachmentSafety('invoice.pdf', mime).dangerous).toBe(true);
});
it('strips bidi, zero-width, separators, traversal and controls in every stored shape', () => {
  const name = '../a\\b\u202e\u2066\u200b\u200c\u200d\u2060\ufeff\u2028\u2029\x7f.pdf';
  expect(sanitizeAttachmentText(name)).toBe('ab.pdf');
  const parsed = parseFileAttachment(
    '[FILE]' +
      JSON.stringify({
        name,
        mime: 'application/\u202epdf',
        encrypted: false,
        url: 'https://example.com/f',
      }),
  )!;
  expect(parsed).toMatchObject({ name: 'ab.pdf', mime: 'application/pdf' });
  expect(attachmentMetadata([['imeta', `name ${name}`]]).name).toBe('ab.pdf');
});
it('caps the displayed name while preserving a dangerous suffix and flags mismatched types', () => {
  const parsed = parseFileAttachment(
    '[FILE]' + JSON.stringify({ name: 'a'.repeat(120) + '.exe', mime: 'application/pdf' }),
  )!;
  expect(parsed.name.length).toBeLessThanOrEqual(80);
  expect(parsed.name.endsWith('.exe')).toBe(true);
  expect(parsed).toMatchObject({ dangerous: true, typeMismatch: true, mime: 'application/pdf' });
});
it.each([14, 15])('wire kind %s controls file detection before geo classification', (wireKind) => {
  const text =
    '[FILE]' +
    JSON.stringify({
      name: 'geo:1,2.pdf',
      mime: 'application/pdf',
      caption: 'geo:1,2',
      encrypted: false,
      url: 'https://example.com/f',
    });
  const item = buildConversationItems(
    [{ id: 'f', fromMe: false, createdAt: 1, text, wireKind }],
    [],
  ).find((i) => i.id === 'dm-f');
  if (wireKind === 15)
    expect(item).toMatchObject({ kind: 'message', file: { name: 'geo:1,2.pdf' } });
  else expect(item).not.toHaveProperty('file');
});
it('does not upgrade a kind-14 encrypted-looking PDF URL to a file', () => {
  const item = buildConversationItems(
    [{ id: 'f', fromMe: false, createdAt: 1, text: encoded('application/pdf'), wireKind: 14 }],
    [],
  ).find((i) => i.id === 'dm-f');
  expect(item).toMatchObject({ kind: 'message' });
  expect(item).not.toHaveProperty('file');
});

it('sanitizes malformed MIME tokens to generic bytes without trusting object properties', () => {
  expect(
    parseFileAttachment('[FILE]' + JSON.stringify({ name: 'invoice.pdf', mime: 'constructor' })),
  ).toMatchObject({ mime: 'application/octet-stream' });
});

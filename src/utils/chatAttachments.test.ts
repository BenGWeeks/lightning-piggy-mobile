import { extractChatAttachments, groupAttachmentsByMonth } from './chatAttachments';
import { encodeEncryptedFileUrl, encodeMarmotMediaUrl } from './encryptedFileUrl';
jest.mock('../services/nostrService', () => ({ decodeProfileReference: jest.fn() }));
const message = (text: string, id = 'm', createdAt = 1705320000) => ({ id, text, createdAt });
it('extracts images, voice, GIFs, files and multiple unique URLs', () => {
  const items = extractChatAttachments([
    message('https://a.example/photo.jpg', 'photo'),
    message('https://a.example/note.m4a', 'voice'),
    message('https://media.giphy.com/media/abc/giphy.gif', 'gif'),
    message(
      'See https://a.example/file.pdf?download=1 and https://b.example/page. https://b.example/page.',
      'mixed',
    ),
  ]);
  expect(items.map((i) => [i.messageId, i.tab, i.kind])).toEqual([
    ['photo', 'media', 'image'],
    ['voice', 'media', 'voice'],
    ['gif', 'media', 'image'],
    ['mixed', 'docs', 'file'],
    ['mixed', 'links', 'link'],
  ]);
  expect(items[4].url).toBe('https://b.example/page');
});
it('preserves encrypted media references and never displays a key fragment as a link', () => {
  const encode = (mime: string) =>
    encodeEncryptedFileUrl({
      url: 'https://a.example/blob.bin',
      mime,
      keyHex: 'a'.repeat(64),
      nonceHex: 'b'.repeat(24),
    });
  const items = extractChatAttachments([
    message(encode('image/jpeg'), 'image'),
    message(encode('audio/mp4'), 'audio'),
    message(encode('application/pdf'), 'file'),
  ]);
  expect(items.map((i) => i.tab)).toEqual(['media', 'media', 'docs']);
  expect(items[0].image?.encrypted).toBe(true);
  expect(items.every((i) => !i.url.includes('#') && !i.label.includes('lpe'))).toBe(true);
});
it('ignores text without URLs, and groups newest-first with years separated', () => {
  expect(extractChatAttachments([message('hello')])).toEqual([]);
  const items = extractChatAttachments([
    message('https://a.example/a.png', 'old', new Date(2024, 0, 15).getTime() / 1000),
    message('https://a.example/b.png', 'new', new Date(2025, 0, 15).getTime() / 1000),
    message('https://a.example/c.png', 'latest', new Date(2025, 1, 15).getTime() / 1000),
  ]);
  const grouped = groupAttachmentsByMonth(items, 'en-GB');
  expect(grouped.map((s) => s.key)).toEqual(['2025-02', '2025-01', '2024-01']);
  expect(grouped[0].data[0].messageId).toBe('latest');
  expect(groupAttachmentsByMonth([], 'en')).toEqual([]);
});

it('classifies embedded image and voice URLs, and groups a month in timestamp order', () => {
  const items = extractChatAttachments([
    message(
      'Photo: https://a.example/a.webp and voice https://a.example/b.opus',
      'first',
      1705320000,
    ),
    message('https://a.example/c.pdf', 'last', 1705321000),
  ]);
  expect(items.map((i) => i.kind)).toEqual(['image', 'voice', 'file']);
  const sections = groupAttachmentsByMonth(items, 'es');
  expect(sections).toHaveLength(1);
  expect(sections[0].data.map((i) => i.messageId)).toEqual(['last', 'first', 'first']);
});

it.each(['nip17', 'marmot'] as const)(
  'extracts each captioned %s encrypted attachment with clean URLs and intact metadata',
  (protocol) => {
    const encode = (url: string, mime: string) =>
      protocol === 'nip17'
        ? encodeEncryptedFileUrl({ url, mime, keyHex: 'a'.repeat(64), nonceHex: 'b'.repeat(24) })
        : encodeMarmotMediaUrl({
            url,
            mime,
            version: 'encrypted-media-v2',
            keysHex: ['a'.repeat(64)],
            nonceHex: 'b'.repeat(24),
            filename: 'photo.jpg',
            plaintextSha256: 'c'.repeat(64),
            ciphertextSha256: 'd'.repeat(64),
          });
    const photo = encode('https://files.example/photo.bin', 'image/jpeg');
    const voice = encode('https://files.example/voice.bin', 'audio/mp4');
    const items = extractChatAttachments([
      message(
        `Photo: ${photo} and voice: ${voice} plus https://files.example/document.pdf and https://example.com/page. Again ${photo}`,
      ),
    ]);
    expect(items.map((i) => [i.id, i.kind, i.url])).toEqual([
      ['m:0', 'image', 'https://files.example/photo.bin'],
      ['m:1', 'voice', 'https://files.example/voice.bin'],
      ['m:2', 'file', 'https://files.example/document.pdf'],
      ['m:3', 'link', 'https://example.com/page'],
    ]);
    expect(items[0].image).toMatchObject({
      url: 'https://files.example/photo.bin',
      mime: 'image/jpeg',
      encrypted: true,
      nonceHex: 'b'.repeat(24),
    });
    if (protocol === 'nip17') expect(items[0].image?.keyHex).toBe('a'.repeat(64));
    else expect(items[0].image?.marmot?.keysHex).toEqual(['a'.repeat(64)]);
    expect(items.map((i) => i.label)).toEqual(['photo.bin', 'voice.bin', 'document.pdf', 'page']);
  },
);

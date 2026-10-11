import { classifyMediaUrl, extractNoteMedia, hasMedia, parseImetaTags } from './noteMedia';

describe('classifyMediaUrl', () => {
  it('detects images and videos by extension, ignoring query strings', () => {
    expect(classifyMediaUrl('https://x.example/a.jpeg')).toBe('image');
    expect(classifyMediaUrl('https://x.example/a.WEBP?w=200#frag')).toBe('image');
    expect(classifyMediaUrl('https://x.example/clip.mp4')).toBe('video');
    expect(classifyMediaUrl('https://x.example/clip.mov?t=1')).toBe('video');
  });

  it('rejects non-media and non-http URLs', () => {
    expect(classifyMediaUrl('https://x.example/page')).toBeNull();
    expect(classifyMediaUrl('https://x.example/jpg')).toBeNull();
    expect(classifyMediaUrl('ftp://x.example/a.png')).toBeNull();
    expect(classifyMediaUrl('javascript:alert(1).png')).toBeNull();
  });
});

describe('parseImetaTags', () => {
  it('parses NIP-92 fields and drops entries without an http url', () => {
    const metas = parseImetaTags([
      ['imeta', 'url https://x.example/1', 'm image/jpeg', 'blurhash abc', 'alt A pig'],
      ['imeta', 'm image/png'],
      ['imeta', 'url javascript:x'],
      ['p', 'pubkey'],
    ]);
    expect(metas).toEqual([
      {
        url: 'https://x.example/1',
        mime: 'image/jpeg',
        thumb: undefined,
        blurhash: 'abc',
        alt: 'A pig',
      },
    ]);
  });
});

describe('extractNoteMedia', () => {
  it('finds image and video URLs in a kind-1 note, de-duplicated', () => {
    const items = extractNoteMedia({
      kind: 1,
      content:
        'look https://x.example/a.png and https://x.example/a.png, plus https://x.example/v.mp4.',
      tags: [],
    });
    expect(items).toEqual([
      { url: 'https://x.example/a.png', type: 'image' },
      { url: 'https://x.example/v.mp4', type: 'video' },
    ]);
  });

  it('uses imeta mime for extension-less URLs in a note', () => {
    const items = extractNoteMedia({
      kind: 1,
      content: 'https://blossom.example/abcdef',
      tags: [
        [
          'imeta',
          'url https://blossom.example/abcdef',
          'm video/mp4',
          'image https://blossom.example/thumb.jpg',
        ],
      ],
    });
    expect(items).toEqual([
      {
        url: 'https://blossom.example/abcdef',
        type: 'video',
        thumb: 'https://blossom.example/thumb.jpg',
        blurhash: undefined,
        alt: undefined,
      },
    ]);
  });

  it('treats kind-20 imeta as images and kind-21/22 as videos even without a mime', () => {
    expect(
      extractNoteMedia({
        kind: 20,
        content: 'caption',
        tags: [['imeta', 'url https://x.example/p']],
      }),
    ).toMatchObject([{ type: 'image' }]);
    expect(
      extractNoteMedia({
        kind: 22,
        content: 'caption',
        tags: [['imeta', 'url https://x.example/s']],
      }),
    ).toMatchObject([{ type: 'video' }]);
  });

  it('ignores caption URLs on picture events and plain links on notes', () => {
    expect(
      extractNoteMedia({ kind: 20, content: 'https://x.example/other.png', tags: [] }),
    ).toEqual([]);
    expect(hasMedia({ kind: 1, content: 'read https://x.example/blog', tags: [] })).toBe(false);
  });
});

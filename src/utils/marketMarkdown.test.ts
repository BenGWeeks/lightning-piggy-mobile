import { parseMarkdown, truncateBlocks } from './marketMarkdown';

const SAMPLE = [
  '# Big heading',
  '### Small heading',
  '',
  'A **bold** and *italic* and ~~gone~~ word with `code`.',
  'Second line of the same paragraph.',
  '',
  '- first',
  '- second with [a link](https://shop.example/item)',
  '',
  '1. one',
  '2. two',
  '',
  '> quoted **text**',
  '',
  '```',
  'const x = 1;',
  '```',
].join('\n');

describe('parseMarkdown', () => {
  it('maps each supported element to the render model', () => {
    expect(parseMarkdown(SAMPLE)).toEqual([
      { type: 'heading', level: 1, inlines: [{ text: 'Big heading' }] },
      { type: 'heading', level: 3, inlines: [{ text: 'Small heading' }] },
      {
        type: 'paragraph',
        inlines: [
          { text: 'A ' },
          { text: 'bold', bold: true },
          { text: ' and ' },
          { text: 'italic', italic: true },
          { text: ' and ' },
          { text: 'gone', strike: true },
          { text: ' word with ' },
          { text: 'code', code: true },
          { text: '.\nSecond line of the same paragraph.' },
        ],
      },
      {
        type: 'list',
        ordered: false,
        start: 1,
        items: [
          [{ type: 'paragraph', inlines: [{ text: 'first' }] }],
          [
            {
              type: 'paragraph',
              inlines: [
                { text: 'second with ' },
                { text: 'a link', href: 'https://shop.example/item' },
              ],
            },
          ],
        ],
      },
      {
        type: 'list',
        ordered: true,
        start: 1,
        items: [
          [{ type: 'paragraph', inlines: [{ text: 'one' }] }],
          [{ type: 'paragraph', inlines: [{ text: 'two' }] }],
        ],
      },
      {
        type: 'quote',
        blocks: [
          {
            type: 'paragraph',
            inlines: [{ text: 'quoted ' }, { text: 'text', bold: true }],
          },
        ],
      },
      { type: 'code', text: 'const x = 1;' },
    ]);
  });

  it('drops raw HTML and images, and only links https', () => {
    const blocks = parseMarkdown(
      [
        '<script>alert(1)</script>',
        '',
        'Hi <b>there</b> ![pic](https://img.example/a.png)',
        '[js](javascript:alert(1)) [plain](http://insecure.example) [creds](https://u:p@x.example)',
      ].join('\n'),
    );
    const text = JSON.stringify(blocks);
    expect(text).not.toContain('script');
    expect(text).not.toContain('<b>');
    expect(text).not.toContain('img.example');
    expect(text).not.toContain('"href"');
    expect(text).toContain('js');
    expect(text).toContain('plain');
  });

  it('turns bare URLs into safe links (GFM autolink)', () => {
    const [p] = parseMarkdown('Buy it here: https://shop.example/x');
    expect(p).toEqual({
      type: 'paragraph',
      inlines: [
        { text: 'Buy it here: ' },
        { text: 'https://shop.example/x', href: 'https://shop.example/x' },
      ],
    });
  });

  it('decodes entities and keeps plain text descriptions as paragraphs', () => {
    expect(parseMarkdown('Fish & chips < £5\n\nNext')).toEqual([
      { type: 'paragraph', inlines: [{ text: 'Fish & chips < £5' }] },
      { type: 'paragraph', inlines: [{ text: 'Next' }] },
    ]);
    expect(parseMarkdown('   ')).toEqual([]);
  });

  it('bounds hostile nesting', () => {
    expect(() => parseMarkdown('>'.repeat(5000) + ' deep')).not.toThrow();
  });
});

describe('truncateBlocks', () => {
  const blocks = parseMarkdown('aaaa\n\nbbbb\n\ncccc');
  it('keeps whole leading blocks within the budget', () => {
    expect(truncateBlocks(blocks, 9)).toEqual({ blocks: blocks.slice(0, 2), truncated: true });
    expect(truncateBlocks(blocks, 100)).toEqual({ blocks, truncated: false });
  });
  it('always shows at least the first block', () => {
    expect(truncateBlocks(blocks, 1).blocks).toHaveLength(1);
  });
});

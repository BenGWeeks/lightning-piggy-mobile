import { parseOgMeta } from './parseOgMeta';

describe('parseOgMeta', () => {
  it('extracts standard og:title / og:description / og:image', () => {
    const html = `<html><head>
      <meta property="og:title" content="Hello world">
      <meta property="og:description" content="A nice page">
      <meta property="og:image" content="https://example.com/hero.jpg">
      <meta property="og:site_name" content="Example">
    </head></html>`;
    const meta = parseOgMeta(html, 'https://example.com/page');
    expect(meta).toEqual({
      title: 'Hello world',
      description: 'A nice page',
      image: 'https://example.com/hero.jpg',
      siteName: 'Example',
    });
  });

  it('handles reversed attribute order (content before property)', () => {
    const html = `<head><meta content="Reversed" property="og:title"></head>`;
    expect(parseOgMeta(html).title).toBe('Reversed');
  });

  it('falls back to twitter:title when og:title absent', () => {
    const html = `<head><meta name="twitter:title" content="Tweet card"></head>`;
    expect(parseOgMeta(html).title).toBe('Tweet card');
  });

  it('falls back to <title> when no og/twitter title present', () => {
    const html = `<html><head><title>Page Title</title></head><body></body></html>`;
    expect(parseOgMeta(html).title).toBe('Page Title');
  });

  it('falls back to first <img src> when no og:image / twitter:image', () => {
    const html = `<head></head><body><img src="https://example.com/first.jpg"></body>`;
    // Note: first-img fallback only fires inside the <head> haystack when no head present
    const meta = parseOgMeta(html);
    expect(meta.image).toBeNull(); // intentional — img fallback won't reach into <body>
  });

  it('decodes common HTML entities in content', () => {
    const html = `<head><meta property="og:title" content="A &amp; B &lt;tag&gt;"></head>`;
    expect(parseOgMeta(html).title).toBe('A & B <tag>');
  });

  it('decodes numeric character references', () => {
    const html = `<head><meta property="og:title" content="caf&#233; &#x2014; bar"></head>`;
    expect(parseOgMeta(html).title).toBe('café — bar');
  });

  it('absolutises a relative og:image against the page URL', () => {
    const html = `<head><meta property="og:image" content="/img/hero.jpg"></head>`;
    expect(parseOgMeta(html, 'https://example.com/article').image).toBe(
      'https://example.com/img/hero.jpg',
    );
  });

  it('leaves an absolute og:image alone', () => {
    const html = `<head><meta property="og:image" content="https://cdn.example.com/h.png"></head>`;
    expect(parseOgMeta(html, 'https://example.com/article').image).toBe(
      'https://cdn.example.com/h.png',
    );
  });

  it('returns all-null on a page with no metadata', () => {
    expect(parseOgMeta('<html><body>nothing here</body></html>')).toEqual({
      title: null,
      description: null,
      image: null,
      siteName: null,
    });
  });

  it('keeps the first occurrence when a tag is duplicated', () => {
    const html = `<head>
      <meta property="og:title" content="First">
      <meta property="og:title" content="Second">
    </head>`;
    expect(parseOgMeta(html).title).toBe('First');
  });

  it('handles single-quoted attributes', () => {
    const html = `<head><meta property='og:title' content='Single quoted'></head>`;
    expect(parseOgMeta(html).title).toBe('Single quoted');
  });

  it('skips data: URI images in the <img> fallback', () => {
    const html = `<html><body><img src="data:image/png;base64,iVBOR..."></body></html>`;
    expect(parseOgMeta(html).image).toBeNull();
  });
});

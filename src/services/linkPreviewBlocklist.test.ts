import { firstPreviewableUrl, isBlocklisted } from './linkPreviewBlocklist';

describe('isBlocklisted', () => {
  it.each([
    'http://192.168.1.1/',
    'http://127.1/',
    'http://localhost/',
    'http://localhost./',
    'http://printer.local/',
    'http://router/',
    'http://[::1]/',
    'http://100.64.0.1/',
    'not a url',
  ])('blocks private / malformed %s', (url) => {
    expect(isBlocklisted(url)).toBe(true);
  });

  it.each([
    'https://slack.com/x',
    'https://acme.slack.com/x',
    'https://discord.gg/abc',
    'https://t.me/joinchat/x',
  ])('blocks listed public host %s', (url) => {
    expect(isBlocklisted(url)).toBe(true);
  });

  it('allows ordinary public URLs', () => {
    expect(isBlocklisted('https://example.com/article')).toBe(false);
    expect(isBlocklisted('https://notslack.com/')).toBe(false);
  });
});

describe('firstPreviewableUrl', () => {
  it('skips private and blocklisted URLs and returns the first public one', () => {
    expect(
      firstPreviewableUrl(
        'router http://192.168.1.1 then https://t.me/x and https://example.com/a, also https://b.example.org',
      ),
    ).toBe('https://example.com/a');
  });

  it('returns null when nothing is previewable', () => {
    expect(firstPreviewableUrl('see http://10.0.0.1/admin')).toBeNull();
    expect(firstPreviewableUrl('no links here')).toBeNull();
  });
});

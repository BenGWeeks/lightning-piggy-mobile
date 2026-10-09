import type { MediaAttachment } from '@internet-privacy/marmot-ts';

import { mediaFetchUrl } from './marmotMedia';

const CT = 'ab'.repeat(32);
const attachment = (url: string): MediaAttachment => ({
  version: 'encrypted-media-v2',
  locators: [{ kind: 'blossom-v1', value: url }],
  ciphertextSha256: CT,
  plaintextSha256: 'cd'.repeat(32),
  nonce: 'ef'.repeat(12),
  mediaType: 'image/jpeg',
  filename: 'photo.jpg',
});

describe('mediaFetchUrl — the sender-controlled locator is vetted before we ever fetch it', () => {
  it('keeps a public https Blossom URL that commits to the ciphertext hash', () => {
    const url = `https://blossom.example/${CT}.bin`;
    expect(mediaFetchUrl(attachment(url), undefined)).toBe(url);
  });

  it.each([
    ['loopback', `http://127.0.0.1:8080/${CT}`],
    ['LAN over https', `https://192.168.1.10/${CT}`],
    ['plain http', `http://blossom.example/${CT}.bin`],
    ['no hash commitment', 'https://blossom.example/somefile.bin'],
    ['a different hash', `https://blossom.example/${'00'.repeat(32)}.bin`],
  ])('drops %s', (_label, url) => {
    expect(mediaFetchUrl(attachment(url), undefined)).toBeUndefined();
  });
});

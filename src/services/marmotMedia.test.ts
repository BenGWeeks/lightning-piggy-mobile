import type { MediaAttachment } from '@internet-privacy/marmot-ts';

import { parseImageMessage, parseVoiceNote } from '../utils/messageContent';
import {
  attachmentFallbackText,
  marmotImetaTag,
  marmotMediaText,
  renderableAttachments,
  mediaFetchUrl,
} from './marmotMedia';

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

describe('voice notes and other attachments', () => {
  const voice: MediaAttachment = {
    ...attachment(`https://blossom.example/${CT}.bin`),
    mediaType: 'audio/mp4',
    filename: 'voice-2000ms.m4a',
  };
  const tagsOf = (a: MediaAttachment) => [marmotImetaTag(a, a.locators[0].value)];
  const keys = { [CT]: { url: `https://blossom.example/${CT}.bin`, keysHex: ['11'.repeat(32)] } };

  it('renders an audio attachment as a voice note, not an image', () => {
    const text = marmotMediaText(tagsOf(voice), keys)!;
    expect(parseVoiceNote(text)).toMatchObject({
      mime: 'audio/mp4',
      encrypted: true,
      nonceHex: voice.nonce,
      marmot: { filename: 'voice-2000ms.m4a', keysHex: ['11'.repeat(32)], ciphertextSha256: CT },
    });
    expect(parseImageMessage(text)).toBeNull();
  });

  it('still renders a photo as an image, not a voice note', () => {
    const text = marmotMediaText(tagsOf(attachment(`https://blossom.example/${CT}.bin`)), keys)!;
    expect(parseImageMessage(text)?.marmot).toBeDefined();
    expect(parseVoiceNote(text)).toBeNull();
  });

  it('labels an unsupported attachment without leaking its URL or keys', () => {
    const video = { ...voice, mediaType: 'video/mp4', filename: 'clip.mp4' };
    expect(renderableAttachments(tagsOf(video))).toHaveLength(0);
    expect(marmotMediaText(tagsOf(video), keys)).toBeNull();
    const text = attachmentFallbackText(tagsOf(video))!;
    expect(text).toBe('Unsupported attachment: clip.mp4 (video/mp4)');
    expect(text).not.toContain('blossom');
  });

  it('has no fallback when there is no attachment', () => {
    expect(attachmentFallbackText([])).toBeNull();
  });
});

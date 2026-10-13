import { encodeEncryptedFileUrl } from './encryptedFileUrl';
import { parseImageMessage, parseVoiceNote } from './messageContent';

it.each(['image/jpeg', 'audio/mp4'])(
  'carries a declared ciphertext hash through %s display metadata',
  (mime) => {
    const meta = {
      url: 'https://cdn.example/photo',
      mime,
      keyHex: '11'.repeat(32),
      nonceHex: '22'.repeat(12),
      sha256: '33'.repeat(32),
    };
    const parse = mime.startsWith('image') ? parseImageMessage : parseVoiceNote;
    expect(parse(encodeEncryptedFileUrl(meta))).toMatchObject({ sha256: meta.sha256 });
    expect(parse(encodeEncryptedFileUrl({ ...meta, sha256: undefined }))).not.toHaveProperty(
      'sha256',
    );
  },
);

it('keeps an explicitly empty hash distinct from no hash', () => {
  const meta = {
    url: 'https://cdn.example/voice',
    mime: 'audio/mp4',
    keyHex: '11'.repeat(32),
    nonceHex: '22'.repeat(12),
  };
  expect(parseVoiceNote(encodeEncryptedFileUrl({ ...meta, sha256: '' }))).toMatchObject({
    sha256: '',
  });
  expect(parseVoiceNote(encodeEncryptedFileUrl(meta))).not.toHaveProperty('sha256');
});

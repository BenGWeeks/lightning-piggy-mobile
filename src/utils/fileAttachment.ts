import { isMarmotMediaVersion } from './encryptedFileUrl';
import type { ParsedImageMessage } from './messageContent';

export interface FileAttachment extends ParsedImageMessage {
  name: string;
  size?: number;
  available: boolean;
  caption?: string;
}

/** Display metadata is separate from the authenticated MIP-04 filename. */
export function attachmentMetadata(tags: string[][], filename?: string) {
  const tag =
    tags.find((tag) => tag[0] === 'imeta' && (!filename || tag.includes(`filename ${filename}`))) ??
    tags.find((tag) => tag[0] === 'imeta');
  const field = (key: string) =>
    tag?.find((value) => value.startsWith(`${key} `))?.slice(key.length + 1);
  const url = field('url') ?? '';
  let segment = url.split(/[?#]/)[0].split('/').pop() ?? '';
  try {
    segment = decodeURIComponent(segment);
  } catch {
    /* Keep malformed percent escapes literal. */
  }
  const name = (field('name') || field('alt') || segment || filename || '')
    .replace(/[\r\n\x00-\x1f]/g, ' ')
    .slice(0, 160);
  const rawSize = field('size');
  const size = rawSize && /^\d+$/.test(rawSize) ? Number(rawSize) : undefined;
  return { name, ...(size !== undefined && Number.isSafeInteger(size) ? { size } : {}) };
}

/** Stored file URLs carry decryption parameters; never expose their fragments in UI. */
export function parseFileAttachment(text: string): FileAttachment | null {
  if (text.startsWith('[FILE]')) {
    try {
      const value = JSON.parse(text.slice(6));
      if (typeof value.name !== 'string' || typeof value.mime !== 'string') return null;
      return {
        url: typeof value.url === 'string' ? value.url : '',
        encrypted: value.encrypted !== false,
        name: value.name,
        mime: value.mime,
        available:
          value.encrypted === false &&
          typeof value.url === 'string' &&
          /^https?:\/\//.test(value.url),
        ...(typeof value.caption === 'string' ? { caption: value.caption } : {}),
        ...(Number.isSafeInteger(value.size) && value.size >= 0 ? { size: value.size } : {}),
      };
    } catch {
      return null;
    }
  }
  const [url, fragment] = text.trim().split('#');
  if (!fragment || !/^https?:\/\//.test(url)) return null;
  const p = new URLSearchParams(fragment);
  if (p.get('lpe') !== '1') return null;
  const mime = p.get('m') ?? 'application/octet-stream';
  if (mime.startsWith('image/') || mime.startsWith('audio/')) return null;
  const alg = p.get('alg') ?? 'aes-gcm';
  const nonceHex = p.get('n') ?? undefined;
  const keyHex = p.get('k') ?? undefined;
  const filename = p.get('f') ?? '';
  const plaintextSha256 = p.get('ps') ?? '';
  const ciphertextSha256 = p.get('cs') ?? '';
  const marmot =
    isMarmotMediaVersion(alg) && keyHex && filename && plaintextSha256 && ciphertextSha256
      ? { version: alg, keysHex: keyHex.split(','), filename, plaintextSha256, ciphertextSha256 }
      : undefined;
  const size = p.get('size');
  return {
    url,
    mime,
    encrypted: true,
    keyHex,
    nonceHex,
    marmot,
    name: p.get('name') || filename || attachmentMetadata([['imeta', `url ${url}`]]).name,
    ...(size && /^\d+$/.test(size) && Number.isSafeInteger(Number(size))
      ? { size: Number(size) }
      : {}),
    available: !!nonceHex && (!!marmot || (alg === 'aes-gcm' && !!keyHex)),
  };
}

export function classifyAttachment(
  text: string,
  wireKind?: number,
): 'image' | 'voice' | 'file' | 'unknown' | 'text' {
  if (wireKind !== undefined && ![4, 9, 14, 15, 16, 17, 1068, 1018].includes(wireKind))
    return 'unknown';
  if (parseFileAttachment(text)) return 'file';
  const fragment = text.split('#')[1];
  const mime = fragment ? new URLSearchParams(fragment).get('m') : null;
  if (mime?.startsWith('image/')) return 'image';
  if (mime?.startsWith('audio/')) return 'voice';
  return 'text';
}

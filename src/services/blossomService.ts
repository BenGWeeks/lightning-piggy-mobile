import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { Buffer } from 'buffer';

/**
 * Minimal Blossom client (BUD-01 / BUD-02).
 *
 * Blossom servers accept `PUT /upload` with the raw file bytes as the body
 * and a kind-24242 authorization event in the `Authorization: Nostr <b64>`
 * header. The server returns a blob descriptor containing the public URL.
 */

export type UnsignedNostrEvent = {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
};

export type SignedNostrEvent = {
  id: string;
  pubkey: string;
  sig: string;
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
};

export type BlossomSigner = (event: UnsignedNostrEvent) => Promise<SignedNostrEvent | null>;

interface BlossomBlobDescriptor {
  url: string;
  sha256?: string;
  size?: number;
  type?: string;
}

function inferContentType(imageUri: string, blobType: string | undefined): string {
  if (blobType && blobType !== 'application/octet-stream') return blobType;
  const filename = imageUri.split('/').pop() || '';
  const ext = (/\.(\w+)$/.exec(filename)?.[1] || '').toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'heic':
      return 'image/heic';
    case 'heif':
      return 'image/heif';
    case 'jpg':
    case 'jpeg':
    default:
      return 'image/jpeg';
  }
}

export async function uploadToBlossom(
  imageUri: string,
  serverUrl: string,
  signer: BlossomSigner,
  imageBase64?: string | null,
): Promise<string> {
  const server = serverUrl.trim().replace(/\/+$/, '');
  if (!server) throw new Error('Blossom server URL is empty');

  // Prefer the base64 payload returned directly by expo-image-picker when
  // the caller passed `base64: true`. Reading local `file://` URIs via
  // fetch/XHR is unreliable on Android in React Native — the base64 path
  // keeps the upload in pure JS and avoids that failure mode entirely.
  if (!imageBase64) {
    throw new Error('Selected image has no base64 payload');
  }
  const bytes = Buffer.from(imageBase64, 'base64');
  if (bytes.length === 0) throw new Error('Selected image is empty');
  console.log('[Blossom] read', bytes.length, 'bytes from base64');

  const hashHex = bytesToHex(sha256(bytes));
  const contentType = inferContentType(imageUri, undefined);
  console.log('[Blossom] hash', hashHex, 'type', contentType);

  const nowSec = Math.floor(Date.now() / 1000);
  const unsigned: UnsignedNostrEvent = {
    kind: 24242,
    created_at: nowSec,
    content: 'Upload image',
    tags: [
      ['t', 'upload'],
      ['x', hashHex],
      ['expiration', (nowSec + 300).toString()],
    ],
  };

  const signed = await signer(unsigned);
  if (!signed) throw new Error('Could not sign upload authorization');
  console.log('[Blossom] event signed', signed.id);

  const authHeader = 'Nostr ' + Buffer.from(JSON.stringify(signed), 'utf-8').toString('base64');

  // Use XMLHttpRequest for the PUT — React Native's fetch() body handling
  // for raw Uint8Array / ArrayBuffer is inconsistent across versions, but
  // XHR reliably transmits binary bytes via `send(arrayBuffer)`.
  const uploadUrl = `${server}/upload`;
  console.log('[Blossom] PUT', uploadUrl, 'body size', bytes.length);

  const { status, responseText } = await new Promise<{ status: number; responseText: string }>(
    (resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl, true);
      xhr.setRequestHeader('Authorization', authHeader);
      xhr.setRequestHeader('Content-Type', contentType);
      xhr.onload = () => resolve({ status: xhr.status, responseText: xhr.responseText });
      xhr.onerror = () => reject(new Error('Blossom upload: network error'));
      xhr.send(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    },
  );
  console.log('[Blossom] PUT status', status);

  if (status < 200 || status >= 300) {
    throw new Error(
      `Blossom upload failed: ${status}${responseText ? ` ${responseText.slice(0, 200)}` : ''}`,
    );
  }

  let descriptor: BlossomBlobDescriptor;
  try {
    descriptor = JSON.parse(responseText) as BlossomBlobDescriptor;
  } catch {
    throw new Error('Blossom server returned invalid JSON');
  }
  if (!descriptor?.url) {
    throw new Error('Blossom server did not return a URL');
  }
  console.log('[Blossom] uploaded', descriptor.url);
  return descriptor.url;
}

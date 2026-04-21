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
): Promise<string> {
  const server = serverUrl.trim().replace(/\/+$/, '');
  if (!server) throw new Error('Blossom server URL is empty');

  // Read the local file into an ArrayBuffer so we can hash it and send the
  // raw bytes as the PUT body. `fetch(file://…)` is supported in React Native
  // for URIs returned by expo-image-picker.
  const fileResponse = await fetch(imageUri);
  if (!fileResponse.ok) {
    throw new Error(`Could not read image (${fileResponse.status})`);
  }
  const blob = await fileResponse.blob();
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.length === 0) throw new Error('Selected image is empty');

  const hashHex = bytesToHex(sha256(bytes));
  const contentType = inferContentType(imageUri, blob.type);

  const nowSec = Math.floor(Date.now() / 1000);
  const unsigned: UnsignedNostrEvent = {
    kind: 24242,
    created_at: nowSec,
    content: 'Upload image',
    tags: [
      ['t', 'upload'],
      ['x', hashHex],
      // Short expiration window — the auth event only needs to survive the
      // round trip to the Blossom server. 5 minutes is plenty.
      ['expiration', (nowSec + 300).toString()],
    ],
  };

  const signed = await signer(unsigned);
  if (!signed) throw new Error('Could not sign upload authorization');

  const authHeader = 'Nostr ' + Buffer.from(JSON.stringify(signed), 'utf-8').toString('base64');

  const response = await fetch(`${server}/upload`, {
    method: 'PUT',
    headers: {
      Authorization: authHeader,
      'Content-Type': contentType,
    },
    body: bytes as unknown as BodyInit,
  });

  if (!response.ok) {
    // BUD-01 servers report the rejection reason via the `X-Reason` header.
    const reason = response.headers.get('X-Reason') || response.headers.get('x-reason');
    let body = '';
    try {
      body = await response.text();
    } catch {}
    throw new Error(
      `Blossom upload failed: ${response.status}${reason ? ` ${reason}` : body ? ` ${body.slice(0, 200)}` : ''}`,
    );
  }

  const descriptor = (await response.json()) as BlossomBlobDescriptor;
  if (!descriptor?.url) {
    throw new Error('Blossom server did not return a URL');
  }
  return descriptor.url;
}

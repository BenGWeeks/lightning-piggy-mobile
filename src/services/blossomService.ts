import { checkRemoteUrl } from '../utils/remoteUrlPolicy';
import { t } from '../i18n';

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { Buffer } from 'buffer';

/** One server answered with a descriptor URL we won't publish (#1508). That
 * server counts as failed; the upload moves on to the next one (#1558). */
export class InvalidBlossomDescriptorError extends Error {
  constructor() {
    super(t('messageBubble.invalidUpload'));
  }
}

/** No server stored the blob: every configured server was blocked, refused
 * the upload or returned an unusable descriptor. User-facing message. */
export class BlossomUploadFailedError extends Error {
  constructor(cause?: unknown) {
    super(t('messageBubble.uploadFailedAllServers'));
    this.cause = cause;
  }
}

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
    // Voice notes (#235). expo-audio's HIGH_QUALITY preset emits .m4a on
    // both Android and iOS; keep .mp3 / .wav / .aac / .ogg in the table
    // so future audio-attach paths (e.g. picker-based uploads) flow
    // through Blossom with the right MIME.
    case 'm4a':
      return 'audio/mp4';
    case 'aac':
      return 'audio/aac';
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'ogg':
      return 'audio/ogg';
    case 'jpg':
    case 'jpeg':
    default:
      return 'image/jpeg';
  }
}

const trimServer = (url: string) => url.trim().replace(/\/+$/, '');

/** PUT raw bytes (or a JSON body) with XHR — React Native's fetch() body
 * handling for binary is inconsistent, but XHR's `send(arrayBuffer)` is not. */
const UPLOAD_TIMEOUT_MS = 120_000;
const MIRROR_TIMEOUT_MS = 30_000;

function put(
  url: string,
  authHeader: string,
  contentType: string,
  body: ArrayBuffer | string,
  timeoutMs: number,
): Promise<{ status: number; responseText: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    // Bounded, so an unresponsive server fails over instead of hanging.
    xhr.timeout = timeoutMs;
    xhr.ontimeout = () => reject(new Error('Blossom upload: timed out'));
    xhr.setRequestHeader('Authorization', authHeader);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.onload = () => resolve({ status: xhr.status, responseText: xhr.responseText });
    xhr.onerror = () => reject(new Error('Blossom upload: network error'));
    xhr.send(body);
  });
}

// BUD-01: a blob is addressed by its sha256 — the last path segment is the
// lowercase hex hash, optionally followed by a file extension.
const BLOB_PATH_SEGMENT = /^([0-9a-f]{64})(?:\.[A-Za-z0-9]{1,10})?$/;

/**
 * The descriptor URL to publish for a blob we just uploaded, or null if it is
 * unusable (#1508, #1558). The host is NOT required to match the upload
 * server: BUD-02 lets a server hand back any public URL (blossom.divine.video
 * serves from cdn.divine.video). What is required:
 *  - it passes the shared remote-URL policy (https, public host, default
 *    port, no credentials) — the same check every recipient applies again
 *    before fetching;
 *  - its last path segment is exactly the sha256 of the bytes we uploaded
 *    (plus an optional extension), and a declared descriptor `sha256` agrees.
 * Content integrity is enforced where it matters, on the recipient: kind-15
 * files check the `x` ciphertext hash and the AES-GCM tag, Marmot (MIP-04)
 * media check both hashes and the AEAD tag — so a URL on another host can't
 * deliver different content.
 */
export function blossomBlobUrl(
  value: unknown,
  hashHex: string,
  declaredSha256?: unknown,
): string | null {
  if (typeof value !== 'string') return null;
  if (declaredSha256 !== undefined && String(declaredSha256).toLowerCase() !== hashHex) return null;
  const checked = checkRemoteUrl(value, { kind: 'blossom' });
  if (!checked.ok) return null;
  const segment = new URL(checked.url).pathname.split('/').pop() ?? '';
  return BLOB_PATH_SEGMENT.exec(segment)?.[1] === hashHex ? checked.url : null;
}

function descriptorUrl(status: number, responseText: string, hashHex: string): string {
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
  if (!descriptor?.url) throw new Error('Blossom server did not return a URL');
  const url = blossomBlobUrl(descriptor.url, hashHex, descriptor.sha256);
  if (!url) throw new InvalidBlossomDescriptorError();
  return url;
}

/**
 * Upload to the user's Blossom servers in order (#1149): the first that
 * accepts the blob wins (so a down primary fails over), then the blob is
 * mirrored to every other server in the background (BUD-04 `PUT /mirror`) as
 * a backup. One signed kind-24242 authorization covers every server, so a
 * remote signer (Amber / NIP-46) is asked once. Mirrors are best-effort and
 * never delay or fail the upload. Returns the winning server's URL.
 */
export async function uploadToBlossomServers(
  imageUri: string,
  serverUrls: string[],
  signer: BlossomSigner,
  imageBase64?: string | null,
  // Force a specific Content-Type instead of inferring from the URI
  // extension. Encrypted uploads pass `application/octet-stream` because
  // the bytes are AES-GCM ciphertext, not the original media type (the
  // real mime travels in the NIP-17 kind-15 `file-type` tag).
  contentTypeOverride?: string,
): Promise<string> {
  const configured = [...new Set(serverUrls.map(trimServer).filter(Boolean))];
  // A blocked server (private host, http, odd port) is never contacted — not
  // for the upload, not for a mirror. The rest still get their turn.
  const servers = configured.filter((server) => {
    const verdict = checkRemoteUrl(server, { kind: 'blossom' });
    // Log only the rejection reason: the configured string may carry
    // credentials (user:pass@host), and console.warn survives release builds.
    if (!verdict.ok && __DEV__) console.warn('[Blossom] skipping blocked server:', verdict.reason);
    return verdict.ok;
  });
  if (servers.length === 0) throw new BlossomUploadFailedError();

  // Prefer the base64 payload returned directly by expo-image-picker (or
  // the file→base64 step in uploadBlob for non-image blobs) when the
  // caller passed `base64: true`. Reading local `file://` URIs via
  // fetch/XHR is unreliable on Android in React Native — the base64 path
  // keeps the upload in pure JS and avoids that failure mode entirely.
  if (!imageBase64) {
    throw new Error('Selected file has no base64 payload');
  }
  const bytes = Buffer.from(imageBase64, 'base64');
  if (bytes.length === 0) throw new Error('Selected file is empty');

  const hashHex = bytesToHex(sha256(bytes));
  const contentType = contentTypeOverride ?? inferContentType(imageUri, undefined);

  const nowSec = Math.floor(Date.now() / 1000);
  const unsigned: UnsignedNostrEvent = {
    kind: 24242,
    created_at: nowSec,
    content: 'Upload blob',
    tags: [
      ['t', 'upload'],
      ['x', hashHex],
      // Valid for every attempt (each up to UPLOAD_TIMEOUT_MS) plus the
      // background mirrors, so failover can't outlive the authorization.
      [
        'expiration',
        (nowSec + 300 + servers.length * Math.ceil(UPLOAD_TIMEOUT_MS / 1000)).toString(),
      ],
    ],
  };
  const signed = await signer(unsigned);
  if (!signed) throw new Error('Could not sign upload authorization');
  const authHeader = 'Nostr ' + Buffer.from(JSON.stringify(signed), 'utf-8').toString('base64');
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

  let lastError: unknown;
  for (let i = 0; i < servers.length; i++) {
    try {
      const { status, responseText } = await put(
        `${servers[i]}/upload`,
        authHeader,
        contentType,
        body,
        UPLOAD_TIMEOUT_MS,
      );
      const url = descriptorUrl(status, responseText, hashHex);
      // Backups: every other server mirrors the stored blob (fire-and-forget).
      for (const backup of servers.filter((_, j) => j !== i)) {
        void put(
          `${backup}/mirror`,
          authHeader,
          'application/json',
          JSON.stringify({ url }),
          MIRROR_TIMEOUT_MS,
        )
          .then(({ status: s }) => {
            if (s < 200 || s >= 300) console.warn('[Blossom] mirror failed', backup, s);
          })
          .catch((e: unknown) => console.warn('[Blossom] mirror failed', backup, e));
      }
      return url;
    } catch (e) {
      // Network error, refusal or an unusable descriptor: this server failed
      // (its URL is never mirrored or returned) — try the next one.
      lastError = e;
      console.warn('[Blossom] upload failed on', servers[i], e);
    }
  }
  throw new BlossomUploadFailedError(lastError);
}

// Servers known to store opaque encrypted blobs — White Noise's defaults
// (MDK DEFAULT_BLOSSOM_SERVER_URLS). Media-only servers, including the
// default blossom.primal.net and nostr.build's free tier, refuse
// `application/octet-stream` with a 415, which every encrypted upload is.
export const ENCRYPTED_BLOB_FALLBACK_SERVERS = [
  'https://blossom.divine.video',
  'https://blossom.ditto.pub',
  'https://cdn.hzrd149.com',
];

/**
 * Upload ciphertext (NIP-17 kind-15 files and voice notes, Marmot photos and
 * voice notes). Tries the user's servers first; if none stores it, falls back
 * to servers that accept opaque bytes, one after another (mirrored among
 * themselves only — never back to the refusing ones). Throws
 * BlossomUploadFailedError only once every server has failed.
 */
export async function uploadEncryptedBlobToBlossom(
  fileUri: string,
  serverUrls: string[],
  signer: BlossomSigner,
  ciphertextBase64: string,
): Promise<string> {
  try {
    return await uploadToBlossomServers(
      fileUri,
      serverUrls,
      signer,
      ciphertextBase64,
      'application/octet-stream',
    );
  } catch (e) {
    // Only a server-side failure falls back; a declined signature or an empty
    // payload would fail the same way again (and re-prompt a remote signer).
    if (!(e instanceof BlossomUploadFailedError)) throw e;
    const tried = new Set(serverUrls.map(trimServer));
    const fallbacks = ENCRYPTED_BLOB_FALLBACK_SERVERS.filter((u) => !tried.has(trimServer(u)));
    if (fallbacks.length === 0) throw e;
    console.warn('[Blossom] encrypted upload refused by your servers; using fallbacks');
    return uploadToBlossomServers(
      fileUri,
      fallbacks,
      signer,
      ciphertextBase64,
      'application/octet-stream',
    );
  }
}

/** Single-server upload (no backups). */
export function uploadToBlossom(
  imageUri: string,
  serverUrl: string,
  signer: BlossomSigner,
  imageBase64?: string | null,
  contentTypeOverride?: string,
): Promise<string> {
  return uploadToBlossomServers(imageUri, [serverUrl], signer, imageBase64, contentTypeOverride);
}

import { isSafeFileUrl } from '../utils/fileAttachment';

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const FILE_TIMEOUT_MS = 30_000;

/** Expo's streaming fetch prevents RN's whole-response buffering before the cap. */
export async function downloadFile(url: string, size?: number): Promise<Uint8Array> {
  if (!isSafeFileUrl(url)) throw new Error('Unsafe file URL');
  if (size !== undefined && size > MAX_FILE_BYTES) throw new Error('File exceeds 50 MB');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FILE_TIMEOUT_MS);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    // Keep the native module off startup paths and compatible with Jest mocks.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { fetch: streamingFetch } = require('expo/fetch') as typeof import('expo/fetch');
    const res = await streamingFetch(url, { signal: controller.signal, redirect: 'error' });
    if (!res.ok || res.redirected || (res.url && !isSafeFileUrl(res.url)))
      throw new Error('File download rejected');
    const length = Number(res.headers.get('content-length'));
    if (length > MAX_FILE_BYTES) throw new Error('File exceeds 50 MB');
    if (!res.body) throw new Error('Streaming file download unavailable');
    reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (controller.signal.aborted) throw new Error('File download timed out');
      if (done) break;
      total += value.byteLength;
      if (total > MAX_FILE_BYTES) throw new Error('File exceeds 50 MB');
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } finally {
    clearTimeout(timer);
    controller.abort();
    await reader?.cancel().catch(() => {});
  }
}

/** Only positively identified formats may be handed to a typed share target. */
export function sniffFileMime(bytes: Uint8Array): string {
  const starts = (signature: number[]) => signature.every((byte, i) => bytes[i] === byte);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  return 'application/octet-stream';
}

export class FileVerificationError extends Error {
  constructor() {
    super('File failed verification');
    this.name = 'FileVerificationError';
  }
}

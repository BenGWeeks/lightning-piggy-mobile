import { cacheDirectory, getInfoAsync, writeAsStringAsync } from 'expo-file-system/legacy';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { Buffer } from 'buffer';
import { checkRemoteUrl, fetchBounded, MEDIA_MAX_BYTES } from '../utils/remoteUrlPolicy';

const pending = new Map<string, Promise<string>>();

/** Cache only bounded downloads; native image/audio loaders receive local URIs. */
export async function resolveRemoteMedia(url: string, maxBytes = MEDIA_MAX_BYTES): Promise<string> {
  const checked = checkRemoteUrl(url, { kind: 'media' });
  if (!checked.ok) throw new Error('Blocked remote URL');
  if (!cacheDirectory) throw new Error('Media cache unavailable');
  const key = bytesToHex(sha256(utf8ToBytes(`${maxBytes}:${checked.url}`)));
  const existing = pending.get(key);
  if (existing) return existing;
  const uri = `${cacheDirectory}remote-${key}`;
  const task = (async () => {
    if (!(await getInfoAsync(uri)).exists) {
      const { bytes } = await fetchBounded(checked.url, {
        maxBytes,
        timeoutMs: 30000,
        redirects: 'https-only',
        maxRedirects: 3,
      });
      await writeAsStringAsync(uri, Buffer.from(bytes).toString('base64'), { encoding: 'base64' });
    }
    return uri;
  })();
  pending.set(key, task);
  try {
    return await task;
  } finally {
    pending.delete(key);
  }
}

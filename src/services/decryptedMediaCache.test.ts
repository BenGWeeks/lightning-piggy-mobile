import AsyncStorage from '@react-native-async-storage/async-storage';
import { encryptFile } from './encryptedFile';
import {
  DecryptedMediaCancelledError,
  LEGACY_CLEANUP_FLAG_KEY,
  __resetDecryptedMediaCacheForTests,
  cleanupLegacyDecryptedMedia,
  clearDecryptedMediaMemory,
  ownerDirName,
  peekDecryptedMedia,
  resolveDecryptedMedia,
  setDecryptedMediaOwner,
  wipeDecryptedMediaForOwner,
  type EncryptedMediaRef,
} from './decryptedMediaCache';

// --- in-memory expo-file-system/legacy ------------------------------------
// path → base64 contents. Directories are implicit (any path prefix).
const mockFiles = new Map<string, string>();
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn(async (uri: string) => ({ exists: mockFiles.has(uri) })),
  makeDirectoryAsync: jest.fn(async () => {}),
  writeAsStringAsync: jest.fn(async (uri: string, data: string) => {
    mockFiles.set(uri, data);
  }),
  deleteAsync: jest.fn(async (uri: string) => {
    for (const k of [...mockFiles.keys()]) if (k === uri || k.startsWith(uri)) mockFiles.delete(k);
  }),
  readDirectoryAsync: jest.fn(async (dir: string) =>
    [...mockFiles.keys()]
      .filter((k) => k.startsWith(dir) && !k.slice(dir.length).includes('/'))
      .map((k) => k.slice(dir.length)),
  ),
}));

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const URL_ = 'https://blossom.example/abc123';
const PLAIN = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const sealed = encryptFile(PLAIN);
const ref: EncryptedMediaRef = {
  url: URL_,
  kind: 'voice',
  mime: 'audio/mp4',
  keyHex: sealed.keyHex,
  nonceHex: sealed.nonceHex,
};
const wrongKeys: EncryptedMediaRef = { ...ref, keyHex: encryptFile(PLAIN).keyHex };

const fetchMock = jest.fn();
function serveCiphertext() {
  fetchMock.mockImplementation(async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => sealed.ciphertext.slice().buffer,
  }));
}

const filesUnder = (owner: string) =>
  [...mockFiles.keys()].filter((k) =>
    k.startsWith(`file:///cache/decrypted/${ownerDirName(owner)}/`),
  );
const plaintextOf = (uri: string) => Buffer.from(mockFiles.get(uri) ?? '', 'base64');

beforeEach(async () => {
  jest.useRealTimers();
  mockFiles.clear();
  fetchMock.mockReset();
  serveCiphertext();
  (globalThis as { fetch: unknown }).fetch = fetchMock;
  __resetDecryptedMediaCacheForTests();
  await AsyncStorage.clear();
  // Pre-seed the flag so the scheduled legacy sweep is a no-op in most tests.
  await AsyncStorage.setItem(LEGACY_CLEANUP_FLAG_KEY, '1');
});

afterAll(() => __resetDecryptedMediaCacheForTests());

describe('decryptedMediaCache', () => {
  it('decrypts once and reuses the file for the same account', async () => {
    setDecryptedMediaOwner(A);
    const uri = await resolveDecryptedMedia(ref);
    expect(uri.startsWith(`file:///cache/decrypted/${ownerDirName(A)}/voice-`)).toBe(true);
    expect(uri.endsWith('.m4a')).toBe(true);
    expect([...plaintextOf(uri)]).toEqual([...PLAIN]);
    expect(peekDecryptedMedia(ref)).toBe(uri);
    expect(await resolveDecryptedMedia(ref)).toBe(uri);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps each account's files separate and drops the memory cache on switch", async () => {
    setDecryptedMediaOwner(A);
    const uriA = await resolveDecryptedMedia(ref);
    setDecryptedMediaOwner(B);
    expect(peekDecryptedMedia(ref)).toBeNull();
    const uriB = await resolveDecryptedMedia(ref);
    expect(uriB).not.toBe(uriA);
    expect(filesUnder(A)).toEqual([uriA]);
    expect(filesUnder(B)).toEqual([uriB]);
    // B decrypted for itself rather than reusing A's file.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("wipe deletes the account's files and memory entries, and leaves others alone", async () => {
    setDecryptedMediaOwner(B);
    const uriB = await resolveDecryptedMedia(ref);
    setDecryptedMediaOwner(A);
    await resolveDecryptedMedia(ref);
    await wipeDecryptedMediaForOwner(A);
    expect(filesUnder(A)).toEqual([]);
    expect(peekDecryptedMedia(ref)).toBeNull();
    expect(filesUnder(B)).toEqual([uriB]);
    // Next play decrypts again.
    await resolveDecryptedMedia(ref);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('never serves cached plaintext to a request with the wrong keys', async () => {
    setDecryptedMediaOwner(A);
    await resolveDecryptedMedia(ref);
    // Same URL, other keys: a different cache entry, so it must decrypt — and fail.
    expect(peekDecryptedMedia(wrongKeys)).toBeNull();
    await expect(resolveDecryptedMedia(wrongKeys)).rejects.toThrow();
    // Another account holding the URL with wrong keys gets nothing either.
    setDecryptedMediaOwner(B);
    await expect(resolveDecryptedMedia(wrongKeys)).rejects.toThrow();
    expect(filesUnder(B)).toEqual([]);
  });

  it('a decrypt in flight when the account is wiped writes nothing', async () => {
    setDecryptedMediaOwner(A);
    let release!: () => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              ok: true,
              status: 200,
              arrayBuffer: async () => sealed.ciphertext.slice().buffer,
            });
        }),
    );
    const pending = resolveDecryptedMedia(ref);
    await new Promise((r) => setImmediate(r));
    await wipeDecryptedMediaForOwner(A);
    release();
    await expect(pending).rejects.toBeInstanceOf(DecryptedMediaCancelledError);
    expect(filesUnder(A)).toEqual([]);
    expect(peekDecryptedMedia(ref)).toBeNull();
  });

  it('a decrypt in flight across an account switch or identity reset writes nothing', async () => {
    for (const end of [() => setDecryptedMediaOwner(B), () => clearDecryptedMediaMemory()]) {
      __resetDecryptedMediaCacheForTests();
      mockFiles.clear();
      setDecryptedMediaOwner(A);
      let release!: () => void;
      fetchMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () =>
              resolve({
                ok: true,
                status: 200,
                arrayBuffer: async () => sealed.ciphertext.slice().buffer,
              });
          }),
      );
      const pending = resolveDecryptedMedia(ref);
      await new Promise((r) => setImmediate(r));
      end();
      release();
      await expect(pending).rejects.toBeInstanceOf(DecryptedMediaCancelledError);
      expect(filesUnder(A)).toEqual([]);
    }
  });

  it('refuses to decrypt with no active account', async () => {
    await expect(resolveDecryptedMedia(ref)).rejects.toThrow(/No active account/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('removes legacy device-wide files once, and on sign-out until it has run', async () => {
    await AsyncStorage.removeItem(LEGACY_CLEANUP_FLAG_KEY);
    mockFiles.set('file:///cache/lp-voice-abc.m4a', 'x');
    mockFiles.set('file:///cache/lp-img-def.jpg', 'x');
    mockFiles.set('file:///cache/ImagePicker-keep.jpg', 'x');
    await wipeDecryptedMediaForOwner(A);
    expect([...mockFiles.keys()]).toEqual(['file:///cache/ImagePicker-keep.jpg']);
    expect(await AsyncStorage.getItem(LEGACY_CLEANUP_FLAG_KEY)).toBe('1');
    // Already done: later runs don't list / delete again.
    mockFiles.set('file:///cache/lp-voice-new.m4a', 'x');
    await cleanupLegacyDecryptedMedia();
    expect(mockFiles.has('file:///cache/lp-voice-new.m4a')).toBe(true);
  });

  it('schedules the legacy sweep when an account first becomes active', async () => {
    jest.useFakeTimers();
    await AsyncStorage.removeItem(LEGACY_CLEANUP_FLAG_KEY);
    mockFiles.set('file:///cache/lp-img-old.png', 'x');
    setDecryptedMediaOwner(A);
    expect(mockFiles.size).toBe(1);
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(mockFiles.size).toBe(0);
  });
});

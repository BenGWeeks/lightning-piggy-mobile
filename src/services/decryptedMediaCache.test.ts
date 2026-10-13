import { encryptMediaFile } from '@internet-privacy/marmot-ts';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteAsync, moveAsync, writeAsStringAsync } from 'expo-file-system/legacy';
import { encryptFile } from './encryptedFile';
import {
  deleteDecryptedFile,
  verifiedFileMetadata,
  DecryptedMediaCancelledError,
  LEGACY_CLEANUP_FLAG_KEY,
  __resetDecryptedMediaCacheForTests,
  cleanupLegacyDecryptedMedia,
  clearDecryptedMediaMemory,
  ownerDirName,
  mediaCacheKey,
  peekDecryptedMedia,
  resolveDecryptedMedia,
  setDecryptedMediaOwner,
  wipeDecryptedMediaForOwner,
  type EncryptedMediaRef,
} from './decryptedMediaCache';

jest.mock('expo/fetch', () => ({
  fetch: async (...args: unknown[]) => {
    const res = await globalThis.fetch(...(args as Parameters<typeof globalThis.fetch>));
    let done = false;
    return {
      ...res,
      headers: { get: () => null },
      body: {
        getReader: () => ({
          read: async () => {
            if (done) return { done: true };
            done = true;
            return { done: false, value: new Uint8Array(await res.arrayBuffer()) };
          },
          cancel: async () => {},
        }),
      },
    };
  },
}));

// --- in-memory expo-file-system/legacy ------------------------------------
// path → base64 contents. Directories are implicit (any path prefix).
const mockFiles = new Map<string, string>();
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn(async (uri: string) => ({
    exists: mockFiles.has(uri),
    size: Buffer.from(mockFiles.get(uri) ?? '', 'base64').length,
    modificationTime: uri.includes('file-old') ? 0 : Date.now() / 1000,
  })),
  readAsStringAsync: jest.fn(async (uri: string) => mockFiles.get(uri) ?? ''),
  makeDirectoryAsync: jest.fn(async () => {}),
  writeAsStringAsync: jest.fn(async (uri: string, data: string) => {
    mockFiles.set(uri, data);
  }),
  deleteAsync: jest.fn(async (uri: string) => {
    for (const k of [...mockFiles.keys()]) if (k === uri || k.startsWith(uri)) mockFiles.delete(k);
  }),
  moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    const data = mockFiles.get(from);
    if (data === undefined) throw new Error(`move: ${from} missing`);
    mockFiles.delete(from);
    mockFiles.set(to, data);
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
  it('downloads a plain imeta file into the same account-scoped cache', async () => {
    setDecryptedMediaOwner(A);
    fetchMock.mockResolvedValue({ ok: true, arrayBuffer: async () => PLAIN.slice().buffer });
    const uri = await resolveDecryptedMedia({
      url: URL_,
      kind: 'file',
      mime: 'application/pdf',
      encrypted: false,
      plaintextSha256: bytesToHex(sha256(PLAIN)),
    });
    expect([...plaintextOf(uri)]).toEqual([...PLAIN]);
    expect(uri).toContain(ownerDirName(A));
    expect(uri.endsWith('.pdf')).toBe(true);
  });

  it('downloads and authenticates a MIP-04 PDF into an account-scoped shareable temp file', async () => {
    const key = new Uint8Array(32).fill(17);
    const { encrypted, attachment } = encryptMediaFile(PLAIN, key, {
      version: 'encrypted-media-v2',
      mediaType: 'application/pdf',
      filename: 'invoice.pdf',
      plaintextSha256: bytesToHex(sha256(PLAIN)),
    });
    fetchMock.mockResolvedValue({ ok: true, arrayBuffer: async () => encrypted.slice().buffer });
    const pdf: EncryptedMediaRef = {
      url: URL_,
      kind: 'file',
      mime: 'application/pdf',
      nonceHex: attachment.nonce,
      marmot: {
        version: attachment.version,
        keysHex: [bytesToHex(key)],
        filename: attachment.filename,
        plaintextSha256: attachment.plaintextSha256,
        ciphertextSha256: attachment.ciphertextSha256,
      },
    };
    setDecryptedMediaOwner(A);
    const uri = await resolveDecryptedMedia(pdf);
    expect(uri).toMatch(/file-.*\.pdf$/);
    expect([...plaintextOf(uri)]).toEqual([...PLAIN]);
    expect(await resolveDecryptedMedia(pdf)).toBe(uri);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(
      resolveDecryptedMedia({ ...pdf, marmot: { ...pdf.marmot!, keysHex: ['00'.repeat(32)] } }),
    ).rejects.toThrow();
  });

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
    // Signing back in, the next play decrypts again.
    setDecryptedMediaOwner(A);
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

  it("a request made after A's sign-out is cancelled and never lands in B's folder", async () => {
    setDecryptedMediaOwner(A);
    await resolveDecryptedMedia(ref);
    fetchMock.mockClear();
    await wipeDecryptedMediaForOwner(A);
    const late = resolveDecryptedMedia(ref); // e.g. a bubble mounting mid-logout
    setDecryptedMediaOwner(B); // the successor account becomes active
    await expect(late).rejects.toBeInstanceOf(DecryptedMediaCancelledError);
    await new Promise((r) => setImmediate(r));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(filesUnder(A)).toEqual([]);
    expect(filesUnder(B)).toEqual([]);
  });

  it('a cold-start waiter is cancelled if the owner changes again before it runs', async () => {
    const pending = resolveDecryptedMedia(ref);
    setDecryptedMediaOwner(A);
    setDecryptedMediaOwner(B);
    await expect(pending).rejects.toBeInstanceOf(DecryptedMediaCancelledError);
    expect(filesUnder(A)).toEqual([]);
    expect(filesUnder(B)).toEqual([]);
  });

  it('never leaves a plaintext temp file behind when a write or move fails', async () => {
    setDecryptedMediaOwner(A);
    (writeAsStringAsync as jest.Mock).mockImplementationOnce(async (uri: string) => {
      mockFiles.set(uri, 'partial'); // e.g. disk full mid-write
      throw new Error('ENOSPC');
    });
    await expect(resolveDecryptedMedia(ref)).rejects.toThrow('ENOSPC');
    expect(filesUnder(A)).toEqual([]);
    (moveAsync as jest.Mock).mockRejectedValueOnce(new Error('move failed'));
    await expect(resolveDecryptedMedia(ref)).rejects.toThrow('move failed');
    expect(filesUnder(A)).toEqual([]);
  });

  it('a wipe waits for a publish already past its last check, then deletes it', async () => {
    setDecryptedMediaOwner(A);
    let releaseMove!: () => void;
    let moveStarted!: () => void;
    const started = new Promise<void>((r) => (moveStarted = r));
    // A move that reads the temp, then completes later (lands after a naive
    // folder delete would have run).
    (moveAsync as jest.Mock).mockImplementationOnce(
      async ({ from, to }: { from: string; to: string }) => {
        const data = mockFiles.get(from) as string;
        moveStarted();
        await new Promise<void>((r) => (releaseMove = r));
        mockFiles.delete(from);
        mockFiles.set(to, data);
      },
    );
    const pending = resolveDecryptedMedia(ref);
    await started;
    const wipe = wipeDecryptedMediaForOwner(A);
    await new Promise((r) => setImmediate(r));
    releaseMove();
    await wipe;
    await expect(pending).rejects.toBeInstanceOf(DecryptedMediaCancelledError);
    expect(filesUnder(A)).toEqual([]);
  });

  it('a cancelled writer never deletes the file a newer request published (A → B → A)', async () => {
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
    const stale = resolveDecryptedMedia(ref);
    await new Promise((r) => setImmediate(r));
    setDecryptedMediaOwner(B);
    setDecryptedMediaOwner(A);
    const uri = await resolveDecryptedMedia(ref);
    release();
    await expect(stale).rejects.toBeInstanceOf(DecryptedMediaCancelledError);
    expect(filesUnder(A)).toEqual([uri]);
    expect([...plaintextOf(uri)]).toEqual([...PLAIN]);
  });

  it('waits for an account to become active (cold start) before decrypting', async () => {
    const pending = resolveDecryptedMedia(ref);
    await new Promise((r) => setImmediate(r));
    expect(fetchMock).not.toHaveBeenCalled();
    setDecryptedMediaOwner(A);
    const uri = await pending;
    expect(filesUnder(A)).toEqual([uri]);
  });

  it('gives up if no account becomes active', async () => {
    jest.useFakeTimers();
    const pending = resolveDecryptedMedia(ref);
    jest.advanceTimersByTime(15_000);
    await expect(pending).rejects.toThrow(/No active account/);
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

  it('retries the legacy cleanup later if a file could not be deleted', async () => {
    await AsyncStorage.removeItem(LEGACY_CLEANUP_FLAG_KEY);
    mockFiles.set('file:///cache/lp-voice-stuck.m4a', 'x');
    (deleteAsync as jest.Mock).mockRejectedValueOnce(new Error('EBUSY'));
    await cleanupLegacyDecryptedMedia();
    expect(await AsyncStorage.getItem(LEGACY_CLEANUP_FLAG_KEY)).toBeNull();
    await cleanupLegacyDecryptedMedia();
    expect(mockFiles.size).toBe(0);
    expect(await AsyncStorage.getItem(LEGACY_CLEANUP_FLAG_KEY)).toBe('1');
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

it('rejects substituted plaintext and a missing hash without publishing', async () => {
  setDecryptedMediaOwner(A);
  fetchMock.mockResolvedValue({ ok: true, arrayBuffer: async () => PLAIN.slice().buffer });
  for (const plaintextSha256 of ['00'.repeat(32), undefined]) {
    await expect(
      resolveDecryptedMedia({ url: URL_, kind: 'file', encrypted: false, plaintextSha256 }),
    ).rejects.toThrow('File failed verification');
    expect(filesUnder(A)).toEqual([]);
  }
});
it('does not reuse plaintext cached against another committed hash', async () => {
  setDecryptedMediaOwner(A);
  fetchMock.mockResolvedValue({ ok: true, arrayBuffer: async () => PLAIN.slice().buffer });
  const plainRef: EncryptedMediaRef = {
    url: URL_,
    kind: 'file',
    encrypted: false,
    plaintextSha256: bytesToHex(sha256(PLAIN)),
  };
  const uri = await resolveDecryptedMedia(plainRef);
  expect(verifiedFileMetadata(uri)).toEqual({
    size: PLAIN.length,
    mime: 'application/octet-stream',
  });
  await expect(
    resolveDecryptedMedia({ ...plainRef, plaintextSha256: '00'.repeat(32) }),
  ).rejects.toThrow('verification');
  await deleteDecryptedFile(uri);
  expect(mockFiles.has(uri)).toBe(false);
  expect(peekDecryptedMedia(plainRef)).toBeNull();
});
it('evicts abandoned plaintext shares on disk', async () => {
  setDecryptedMediaOwner(A);
  const stale = `file:///cache/decrypted/${ownerDirName(A)}/file-old.bin`;
  mockFiles.set(stale, 'plaintext');
  fetchMock.mockResolvedValue({ ok: true, arrayBuffer: async () => PLAIN.slice().buffer });
  await resolveDecryptedMedia({
    url: URL_,
    kind: 'file',
    encrypted: false,
    plaintextSha256: bytesToHex(sha256(PLAIN)),
  });
  expect(mockFiles.has(stale)).toBe(false);
});

it('re-verifies bounded disk plaintext before sharing and rejects a substituted cached file', async () => {
  setDecryptedMediaOwner(A);
  const plainRef: EncryptedMediaRef = {
    url: URL_,
    kind: 'file',
    encrypted: false,
    plaintextSha256: bytesToHex(sha256(PLAIN)),
  };
  const uri = `file:///cache/decrypted/${ownerDirName(A)}/file-${mediaCacheKey(plainRef)}.bin`;
  mockFiles.set(uri, Buffer.from(PLAIN).toString('base64'));
  expect(await resolveDecryptedMedia(plainRef)).toBe(uri);
  expect(fetchMock).not.toHaveBeenCalled();
  clearDecryptedMediaMemory();
  mockFiles.set(uri, Buffer.from('substituted').toString('base64'));
  await expect(resolveDecryptedMedia(plainRef)).rejects.toThrow('File failed verification');
  expect(mockFiles.has(uri)).toBe(false);
});

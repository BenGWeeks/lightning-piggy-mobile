import type { RawDmEvent } from '../services/nostrService';
import { decryptInboxKind4 } from './inboxNip04Ingest';
import { nip04PlaintextCache } from './nostrSecretKeyCache';

jest.mock('./nostrSecretKeyCache', () => ({ nip04PlaintextCache: { set: jest.fn() } }));
const target = (i: number) => ({
  ev: { id: String(i), content: 'cipher', created_at: i } as RawDmEvent,
  fromMe: false,
  partnerPubkey: 'peer',
});
beforeEach(() => jest.clearAllMocks());

it('keeps productive rows on abort and stops before the next decrypt batch', async () => {
  const controller = new AbortController();
  const decrypt = jest.fn(async () => {
    controller.abort();
    return 'plaintext';
  });
  const result = await decryptInboxKind4({
    owner: 'me',
    targets: Array.from({ length: 30 }, (_, i) => target(i)),
    decrypt,
    signal: controller.signal,
    isColdStart: false,
  });
  expect(decrypt).toHaveBeenCalledTimes(15);
  expect(result.attempts).toBe(15);
  expect(result.rows).toHaveLength(15);
  expect(result.entries).toHaveLength(15);
  expect(nip04PlaintextCache.set).not.toHaveBeenCalled();
  expect(result.rows[0]).toMatchObject({
    owner: 'me',
    sender: 'peer',
    wireKind: 4,
    content: 'plaintext',
  });
});

it('ignores failed decrypts and caches successfully decrypted rows', async () => {
  const decrypt = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('hello');
  const result = await decryptInboxKind4({
    owner: 'me',
    targets: [target(1), target(2)],
    decrypt,
    isColdStart: false,
  });
  expect(result.attempts).toBe(2);
  expect(result.rows).toHaveLength(1);
  expect(nip04PlaintextCache.set).toHaveBeenCalledWith('2', 'hello');
});

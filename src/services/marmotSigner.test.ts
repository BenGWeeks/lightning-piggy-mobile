const mockAmberSign = jest.fn();
const mockBunkerSign = jest.fn();

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn() }));
jest.mock('./amberService', () => ({
  requestEventSignature: (...args: unknown[]) => mockAmberSign(...args),
  requestNip44Encrypt: jest.fn(),
  requestNip44Decrypt: jest.fn(),
}));
jest.mock('./nostrConnectService', () => ({
  requestEventSignature: (...args: unknown[]) => mockBunkerSign(...args),
}));
jest.mock('./nostrService', () => ({}));
jest.mock('./nostrCrypto', () => ({}));

import { createMarmotSigner } from './marmotSigner';

const PK = 'a'.repeat(64);
const draft = { kind: 13, created_at: 1, tags: [], content: 'x' };

beforeEach(() => {
  mockAmberSign.mockReset();
  mockBunkerSign.mockReset();
});

describe('createMarmotSigner', () => {
  it('serialises requests across signer instances (one Amber intent at a time)', async () => {
    let open = 0;
    let maxOpen = 0;
    mockAmberSign.mockImplementation(async () => {
      maxOpen = Math.max(maxOpen, ++open);
      await new Promise((r) => setTimeout(r, 5));
      open--;
      return { event: JSON.stringify({ ...draft, id: 'i', sig: 's', pubkey: PK }) };
    });
    const a = createMarmotSigner(PK, 'amber');
    const b = createMarmotSigner(PK, 'amber');
    await Promise.all([a.signEvent(draft), b.signEvent(draft), a.signEvent(draft)]);
    expect(maxOpen).toBe(1);
  });

  it('never reaches the backend for a request abandoned while it was queued', async () => {
    let cancelled = false;
    mockAmberSign.mockImplementation(async () => {
      cancelled = true; // the caller gives up while this one is open
      return { event: JSON.stringify({ ...draft, id: 'i', sig: 's', pubkey: PK }) };
    });
    const signer = createMarmotSigner(PK, 'amber', { cancelled: () => cancelled });
    const first = signer.signEvent(draft);
    const second = signer.signEvent(draft);
    await expect(first).resolves.toBeDefined();
    await expect(second).rejects.toThrow('abandoned');
    expect(mockAmberSign).toHaveBeenCalledTimes(1);
  });

  it('an abandoned NIP-46 request frees the shared queue even if the bunker never answers', async () => {
    let gaveUp = false;
    mockBunkerSign.mockImplementationOnce(() => new Promise(() => undefined)); // offline bunker
    mockBunkerSign.mockImplementationOnce(async () => ({
      event: JSON.stringify({ ...draft, id: 'i', sig: 's', pubkey: PK }),
    }));
    const stuck = createMarmotSigner(PK, 'nip46', { cancelled: () => gaveUp }).signEvent(draft);
    const next = createMarmotSigner(PK, 'nip46').signEvent(draft);
    setTimeout(() => (gaveUp = true), 20);
    await expect(stuck).rejects.toThrow('abandoned');
    await expect(next).resolves.toBeDefined();
  });

  it('an abandoned Amber request rejects at once but holds the queue until the intent settles', async () => {
    let gaveUp = false;
    let answerFirst: () => void = () => undefined;
    const signed = { event: JSON.stringify({ ...draft, id: 'i', sig: 's', pubkey: PK }) };
    mockAmberSign.mockImplementationOnce(
      () => new Promise((r) => (answerFirst = () => r(signed))), // the user hasn't answered yet
    );
    mockAmberSign.mockImplementationOnce(async () => signed);
    const stuck = createMarmotSigner(PK, 'amber', { cancelled: () => gaveUp }).signEvent(draft);
    const next = createMarmotSigner(PK, 'amber').signEvent(draft);
    setTimeout(() => (gaveUp = true), 20);
    await expect(stuck).rejects.toThrow('abandoned');
    expect(mockAmberSign).toHaveBeenCalledTimes(1); // no second intent while one is open
    answerFirst();
    await expect(next).resolves.toBeDefined();
    expect(mockAmberSign).toHaveBeenCalledTimes(2);
  });
});

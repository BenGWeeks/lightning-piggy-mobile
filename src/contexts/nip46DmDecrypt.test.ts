/**
 * Unit tests for the NIP-46 DM decrypt primitives. nostrConnectService and the
 * gift-wrap unwrap helper are mocked so we only exercise the thin delegation +
 * argument shaping this module adds.
 */
import { nip46DecryptNip04, nip46Sign, nip46Unwrap } from './nip46DmDecrypt';

const mockRequestNip04Decrypt = jest.fn();
const mockRequestNip44Decrypt = jest.fn();
const mockRequestEventSignature = jest.fn();
const mockUnwrapWrapViaNip44 = jest.fn();

jest.mock('../services/nostrConnectService', () => ({
  requestNip04Decrypt: (...a: unknown[]) => mockRequestNip04Decrypt(...(a as [])),
  requestNip44Decrypt: (...a: unknown[]) => mockRequestNip44Decrypt(...(a as [])),
  requestEventSignature: (...a: unknown[]) => mockRequestEventSignature(...(a as [])),
}));

jest.mock('../utils/nip17Unwrap', () => ({
  unwrapWrapViaNip44: (...a: unknown[]) => mockUnwrapWrapViaNip44(...(a as [])),
}));

beforeEach(() => jest.clearAllMocks());

describe('nip46DecryptNip04', () => {
  it('delegates to nostrConnectService.requestNip04Decrypt', async () => {
    mockRequestNip04Decrypt.mockResolvedValue('plaintext');
    await expect(nip46DecryptNip04('ct', 'peer', 'me')).resolves.toBe('plaintext');
    expect(mockRequestNip04Decrypt).toHaveBeenCalledWith('ct', 'peer', 'me');
  });
});

describe('nip46Sign', () => {
  it('serialises the template and returns the signed event JSON', async () => {
    mockRequestEventSignature.mockResolvedValue({ signature: 's', event: '{"sig":"s"}' });
    const event = { kind: 1, created_at: 5, tags: [['p', 'x']], content: 'hi' };
    await expect(nip46Sign(event, 'me')).resolves.toBe('{"sig":"s"}');
    expect(mockRequestEventSignature).toHaveBeenCalledWith(JSON.stringify(event), '', 'me');
  });
});

describe('nip46Unwrap', () => {
  it('builds an unwrap fn that routes NIP-44 decrypt through the bunker', async () => {
    mockUnwrapWrapViaNip44.mockImplementation(
      async (_wrap, decrypt: (a: string, b: string) => Promise<string>) => {
        // exercise the injected decrypt callback so its wiring is covered
        await decrypt('ct', 'peer');
        return { content: 'rumor' };
      },
    );
    mockRequestNip44Decrypt.mockResolvedValue('pt');
    const onSkip = jest.fn();
    const unwrap = nip46Unwrap('me', onSkip);
    const wrap = { id: 'wrapid' } as never;
    await expect(unwrap(wrap)).resolves.toEqual({ content: 'rumor' });
    expect(mockUnwrapWrapViaNip44).toHaveBeenCalledWith(wrap, expect.any(Function), onSkip);
    expect(mockRequestNip44Decrypt).toHaveBeenCalledWith('ct', 'peer', 'me');
  });
});

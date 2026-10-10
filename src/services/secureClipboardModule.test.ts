/**
 * Tests for modules/secure-clipboard/index.ts (#1223). Lives under src/ so
 * jest's testMatch picks it up. The native side is optional: without it the
 * facade must refuse to copy rather than degrade to a plain clipboard write.
 */
let mockNative: { setSecretStringAsync: jest.Mock } | null = null;
jest.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: () => mockNative,
}));

function loadFacade(): typeof import('../../modules/secure-clipboard') {
  let facade!: typeof import('../../modules/secure-clipboard');
  jest.isolateModules(() => {
    facade = jest.requireActual('../../modules/secure-clipboard');
  });
  return facade;
}

describe('secure-clipboard facade', () => {
  it('forwards the secret and expiry to the native module', async () => {
    mockNative = { setSecretStringAsync: jest.fn(async () => {}) };
    const facade = loadFacade();
    expect(facade.isSecureClipboardAvailable()).toBe(true);
    await facade.setSecretStringAsync('test-secret', 60_000);
    expect(mockNative.setSecretStringAsync).toHaveBeenCalledWith('test-secret', 60_000);
  });

  it('reports unavailable and rejects when the native module is missing', async () => {
    mockNative = null;
    const facade = loadFacade();
    expect(facade.isSecureClipboardAvailable()).toBe(false);
    await expect(facade.setSecretStringAsync('test-secret', 60_000)).rejects.toThrow(
      'SecureClipboard native module is not available',
    );
  });
});

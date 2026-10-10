import { AppState, Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  __resetSensitiveClipboardForTests,
  canCopySensitiveText,
  copySensitiveText,
} from './sensitiveClipboard';
import { isSecureClipboardAvailable, setSecretStringAsync } from '../../modules/secure-clipboard';

// One simulated system clipboard shared by the native secret write and
// expo-clipboard's plain read/clear.
let mockClipboard = '';
jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(async (v: string) => {
    mockClipboard = v;
    return true;
  }),
  getStringAsync: jest.fn(async () => mockClipboard),
}));
jest.mock('../../modules/secure-clipboard', () => ({
  isSecureClipboardAvailable: jest.fn(() => true),
  setSecretStringAsync: jest.fn(async (v: string) => {
    mockClipboard = v;
  }),
}));

const flush = () => new Promise((r) => jest.requireActual('timers').setImmediate(r));

describe('copySensitiveText', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClipboard = '';
    Platform.OS = 'android';
    jest.useFakeTimers();
    AppState.currentState = 'active';
    jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
    __resetSensitiveClipboardForTests();
  });
  afterEach(() => {
    __resetSensitiveClipboardForTests();
    jest.useRealTimers();
  });

  it('writes through the native secret clipboard, never a plain clipboard write', async () => {
    await copySensitiveText('test-secret-native', 1000);
    expect(setSecretStringAsync).toHaveBeenCalledWith('test-secret-native', 1000);
    expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
  });

  it('propagates a native failure without touching the clipboard', async () => {
    jest.mocked(setSecretStringAsync).mockRejectedValueOnce(new Error('unavailable'));
    await expect(copySensitiveText('test-secret-fail', 1000)).rejects.toThrow('unavailable');
    expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1000);
    await flush();
    expect(Clipboard.getStringAsync).not.toHaveBeenCalled();
  });

  it('reports whether the native module is present', () => {
    expect(canCopySensitiveText()).toBe(true);
    jest.mocked(isSecureClipboardAvailable).mockReturnValueOnce(false);
    expect(canCopySensitiveText()).toBe(false);
  });

  it('leaves expiry to the OS on iOS (no JS read or clear)', async () => {
    Platform.OS = 'ios';
    await copySensitiveText('test-secret-ios', 1000);
    jest.advanceTimersByTime(1000);
    await flush();
    expect(Clipboard.getStringAsync).not.toHaveBeenCalled();
    expect(AppState.addEventListener).not.toHaveBeenCalled();
  });

  it('clears the clipboard after the window when it still holds the secret', async () => {
    await copySensitiveText('secret-one', 1000);
    expect(await Clipboard.getStringAsync()).toBe('secret-one');
    jest.advanceTimersByTime(1000);
    await flush();
    expect(await Clipboard.getStringAsync()).toBe('');
  });

  it('retries expired background copies on foreground without retaining the secret', async () => {
    await copySensitiveText('test-secret-background', 1000);
    AppState.currentState = 'background';
    jest.advanceTimersByTime(1000);
    await flush();
    expect(await Clipboard.getStringAsync()).toBe('test-secret-background');
    AppState.currentState = 'active';
    const listen = jest.mocked(AppState.addEventListener);
    listen.mock.calls[listen.mock.calls.length - 1][1]('active');
    jest.advanceTimersByTime(3000);
    await flush();
    expect(await Clipboard.getStringAsync()).toBe('');
  });

  it('does not clear a newer copy when an older clipboard read finishes', async () => {
    let finish!: (text: string) => void;
    await copySensitiveText('test-secret-old', 1000);
    jest
      .mocked(Clipboard.getStringAsync)
      .mockImplementationOnce(() => new Promise((r) => (finish = r)));
    jest.advanceTimersByTime(1000);
    await copySensitiveText('test-secret-new', 1000);
    finish('test-secret-old');
    await flush();
    expect(await Clipboard.getStringAsync()).toBe('test-secret-new');
    jest.advanceTimersByTime(1000);
    await flush();
    expect(await Clipboard.getStringAsync()).toBe('');
  });

  it('leaves the clipboard alone if the user copied something else', async () => {
    await copySensitiveText('secret-two', 1000);
    await Clipboard.setStringAsync('a shopping list');
    jest.advanceTimersByTime(1000);
    await flush();
    expect(await Clipboard.getStringAsync()).toBe('a shopping list');
  });
});

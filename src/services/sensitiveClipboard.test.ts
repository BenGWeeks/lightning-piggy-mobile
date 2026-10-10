import { AppState } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { __resetSensitiveClipboardForTests, copySensitiveText } from './sensitiveClipboard';

jest.mock('expo-clipboard', () => {
  let value = '';
  return {
    setStringAsync: jest.fn(async (v: string) => {
      value = v;
      return true;
    }),
    getStringAsync: jest.fn(async () => value),
  };
});

const flush = () => new Promise((r) => jest.requireActual('timers').setImmediate(r));

describe('copySensitiveText', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    AppState.currentState = 'active';
    jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
    __resetSensitiveClipboardForTests();
  });
  afterEach(() => {
    __resetSensitiveClipboardForTests();
    jest.useRealTimers();
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

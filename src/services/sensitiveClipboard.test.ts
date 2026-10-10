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
    __resetSensitiveClipboardForTests();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('clears the clipboard after the window when it still holds the secret', async () => {
    await copySensitiveText('secret-one', 1000);
    expect(await Clipboard.getStringAsync()).toBe('secret-one');
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

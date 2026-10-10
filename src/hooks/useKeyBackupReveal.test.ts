import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import * as ScreenCapture from 'expo-screen-capture';
import { useKeyBackupReveal } from './useKeyBackupReveal';
import { authenticateForKeyReveal, loadAccountNsec } from '../services/accountKeyAccess';
import { copySensitiveText } from '../services/sensitiveClipboard';

let mockFocusCleanup: (() => void) | void;
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = jest.requireActual('react');
    React.useEffect(() => {
      mockFocusCleanup = callback();
      return () => mockFocusCleanup?.();
    }, [callback]);
  },
}));
jest.mock('../contexts/LocaleContext', () => ({ useTranslation: () => (key: string) => key }));
jest.mock('../components/BrandedAlert', () => ({ Alert: { alert: jest.fn() } }));
jest.mock('../services/accountKeyAccess', () => ({
  keyRevealGate: jest.fn(async () => 'device-auth'),
  authenticateForKeyReveal: jest.fn(async () => true),
  // Deliberately not real keys: no credentials in snapshots or test output.
  loadAccountNsec: jest.fn(async (pubkey: string) => `test-secret-${pubkey}`),
}));
jest.mock('../services/sensitiveClipboard', () => ({ copySensitiveText: jest.fn(async () => {}) }));
jest.mock('expo-screen-capture', () => ({
  preventScreenCaptureAsync: jest.fn(async () => {}),
  allowScreenCaptureAsync: jest.fn(async () => {}),
  enableAppSwitcherProtectionAsync: jest.fn(async () => {}),
  disableAppSwitcherProtectionAsync: jest.fn(async () => {}),
}));

beforeEach(() => {
  jest.clearAllMocks();
  AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
});

function setup() {
  return renderHook(({ pubkey }: { pubkey: string | null }) => useKeyBackupReveal(pubkey), {
    initialProps: { pubkey: 'account-a' } as { pubkey: string | null },
  });
}

it('requires a fresh unlock after changing accounts and only copies the new key', async () => {
  const { result, rerender } = setup();
  await act(() => result.current.toggleReveal());
  expect(result.current.nsec).toBe('test-secret-account-a');
  expect(result.current.hasUnlocked).toBe(true);
  rerender({ pubkey: 'account-b' });
  expect(result.current).toMatchObject({ nsec: null, revealed: false, hasUnlocked: false });
  await act(() => result.current.copy());
  expect(authenticateForKeyReveal).toHaveBeenCalledTimes(2);
  expect(copySensitiveText).toHaveBeenCalledWith('test-secret-account-b');
});

it('drops the key and screenshot lock when the target account disappears', async () => {
  const { result, rerender } = setup();
  await act(() => result.current.toggleReveal());
  rerender({ pubkey: null });
  expect(result.current).toMatchObject({ nsec: null, revealed: false, hasUnlocked: false });
  expect(ScreenCapture.allowScreenCaptureAsync).toHaveBeenCalledWith('key-backup');
  await act(() => result.current.copy());
  expect(copySensitiveText).not.toHaveBeenCalled();
});

it('discards a pending key read when the target changes', async () => {
  let finish!: (key: string) => void;
  jest.mocked(loadAccountNsec).mockImplementationOnce(() => new Promise((r) => (finish = r)));
  const { result, rerender } = setup();
  let pending!: Promise<boolean>;
  await act(async () => {
    pending = result.current.copy();
    await Promise.resolve();
    await Promise.resolve();
  });
  rerender({ pubkey: 'account-b' });
  await act(async () => {
    finish('test-secret-account-a');
    await pending;
  });
  expect(result.current).toMatchObject({
    nsec: null,
    revealed: false,
    hasUnlocked: false,
    busy: false,
  });
  expect(copySensitiveText).not.toHaveBeenCalled();
});

it('invalidates pending authentication on blur', async () => {
  let finish!: (passed: boolean) => void;
  jest
    .mocked(authenticateForKeyReveal)
    .mockImplementationOnce(() => new Promise((r) => (finish = r)));
  const { result } = setup();
  let pending!: Promise<void>;
  await act(async () => {
    pending = result.current.toggleReveal();
    await Promise.resolve();
  });
  act(() => mockFocusCleanup?.());
  await act(async () => {
    finish(true);
    await pending;
  });
  expect(loadAccountNsec).not.toHaveBeenCalled();
  expect(result.current).toMatchObject({ nsec: null, revealed: false, hasUnlocked: false });
});

function appState(state: 'active' | 'background') {
  AppState.currentState = state;
  const listen = jest.mocked(AppState.addEventListener);
  listen.mock.calls[listen.mock.calls.length - 1][1](state);
}

it.each(['resume', 'remove-account'] as const)(
  'keeps Android credential authentication pending until %s',
  async (event) => {
    let finish!: (passed: boolean) => void;
    jest
      .mocked(authenticateForKeyReveal)
      .mockImplementationOnce(() => new Promise((r) => (finish = r)));
    const { result, rerender } = setup();
    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.toggleReveal();
      await Promise.resolve();
    });
    act(() => appState('background'));
    await act(async () => {
      finish(true);
      await Promise.resolve();
    });
    // Even successful native auth must not load or reveal a key in background.
    expect(loadAccountNsec).not.toHaveBeenCalled();
    expect(result.current.nsec).toBeNull();
    if (event === 'remove-account') rerender({ pubkey: null });
    await act(async () => {
      appState('active');
      await pending;
    });
    if (event === 'resume') {
      expect(result.current).toMatchObject({ nsec: 'test-secret-account-a', revealed: true });
    } else {
      expect(loadAccountNsec).not.toHaveBeenCalled();
      expect(result.current).toMatchObject({ nsec: null, revealed: false, busy: false });
    }
  },
);

it('still invalidates a pending storage read when the app backgrounds after authentication', async () => {
  let finish!: (key: string) => void;
  jest.mocked(loadAccountNsec).mockImplementationOnce(() => new Promise((r) => (finish = r)));
  const { result } = setup();
  let pending!: Promise<void>;
  await act(async () => {
    pending = result.current.toggleReveal();
    await Promise.resolve();
    await Promise.resolve();
  });
  act(() => appState('background'));
  await act(async () => {
    finish('test-secret-account-a');
    await pending;
  });
  expect(result.current).toMatchObject({ nsec: null, revealed: false, hasUnlocked: false });
});

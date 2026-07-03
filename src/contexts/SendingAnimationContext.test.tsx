import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  SendingAnimationProvider,
  useSendingAnimation,
  isSendingAnimationPreference,
  SENDING_ANIMATION_STORAGE_KEY,
  DEFAULT_SENDING_ANIMATION,
} from './SendingAnimationContext';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SendingAnimationProvider>{children}</SendingAnimationProvider>
);

describe('isSendingAnimationPreference', () => {
  it('accepts the two known values', () => {
    expect(isSendingAnimationPreference('bubbles')).toBe(true);
    expect(isSendingAnimationPreference('lightning')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isSendingAnimationPreference('sparkles')).toBe(false);
    expect(isSendingAnimationPreference('')).toBe(false);
    expect(isSendingAnimationPreference(null)).toBe(false);
    expect(isSendingAnimationPreference(undefined)).toBe(false);
    expect(isSendingAnimationPreference(42)).toBe(false);
  });
});

describe('SendingAnimationProvider', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('defaults to lightning when nothing is stored', async () => {
    const { result } = renderHook(() => useSendingAnimation(), { wrapper });
    expect(result.current.preference).toBe(DEFAULT_SENDING_ANIMATION);
    expect(result.current.preference).toBe('lightning');
  });

  it('hydrates a stored bubbles preference on mount (overrides the default)', async () => {
    await AsyncStorage.setItem(SENDING_ANIMATION_STORAGE_KEY, 'bubbles');
    const { result } = renderHook(() => useSendingAnimation(), { wrapper });
    await waitFor(() => expect(result.current.preference).toBe('bubbles'));
  });

  it('falls back to the lightning default when the stored value is invalid', async () => {
    await AsyncStorage.setItem(SENDING_ANIMATION_STORAGE_KEY, 'rainbows');
    const { result } = renderHook(() => useSendingAnimation(), { wrapper });
    // Give the hydration effect a tick; the invalid value must be ignored.
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.preference).toBe('lightning');
  });

  it('persists a new preference to AsyncStorage and updates in memory', async () => {
    const { result } = renderHook(() => useSendingAnimation(), { wrapper });
    expect(result.current.preference).toBe('lightning');

    await act(async () => {
      result.current.setPreference('bubbles');
    });

    expect(result.current.preference).toBe('bubbles');
    await expect(AsyncStorage.getItem(SENDING_ANIMATION_STORAGE_KEY)).resolves.toBe('bubbles');
  });

  it('keeps the in-memory change even if the write rejects (best-effort)', async () => {
    const spy = jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    const { result } = renderHook(() => useSendingAnimation(), { wrapper });

    await act(async () => {
      result.current.setPreference('bubbles');
    });

    expect(result.current.preference).toBe('bubbles');
    spy.mockRestore();
  });

  it('throws if useSendingAnimation is used outside the provider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useSendingAnimation())).toThrow(
      'useSendingAnimation must be used within a SendingAnimationProvider',
    );
    spy.mockRestore();
  });
});

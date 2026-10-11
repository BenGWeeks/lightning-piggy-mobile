import { renderHook } from '@testing-library/react-native';
import { Keyboard, Platform, type KeyboardEventName } from 'react-native';
import { useSheetKeyboardRestore } from './useSheetKeyboardRestore';

const originalOS = Platform.OS;
let listeners: Map<KeyboardEventName, () => void>;
const snapToIndex = jest.fn();
const sheetRef = { current: { snapToIndex } };

beforeEach(() => {
  jest.clearAllMocks();
  listeners = new Map();
  jest.spyOn(Keyboard, 'addListener').mockImplementation((name, listener) => {
    listeners.set(name, listener as () => void);
    return { remove: () => listeners.delete(name) } as unknown as ReturnType<
      typeof Keyboard.addListener
    >;
  });
});
afterEach(() => {
  Platform.OS = originalOS;
  jest.restoreAllMocks();
});

it('snaps an open iOS sheet back to its detent when the keyboard closes', () => {
  Platform.OS = 'ios';
  const { unmount } = renderHook(() => useSheetKeyboardRestore(sheetRef, true));
  listeners.get('keyboardDidHide')?.();
  expect(snapToIndex).toHaveBeenCalledWith(0);
  unmount();
  expect(listeners.size).toBe(0);
});
it('does nothing for a closed sheet or on Android', () => {
  Platform.OS = 'ios';
  renderHook(() => useSheetKeyboardRestore(sheetRef, false));
  Platform.OS = 'android';
  renderHook(() => useSheetKeyboardRestore(sheetRef, true));
  expect(listeners.size).toBe(0);
});

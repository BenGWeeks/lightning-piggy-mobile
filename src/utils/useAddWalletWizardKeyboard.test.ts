import { act, renderHook } from '@testing-library/react-native';
import { Keyboard, Platform, type KeyboardEvent, type KeyboardEventName } from 'react-native';
import type { BottomSheetScrollViewMethods } from '@gorhom/bottom-sheet';
import { useAddWalletWizardKeyboard } from './useAddWalletWizardKeyboard';

const originalOS = Platform.OS;
let listeners: Map<KeyboardEventName, (event: KeyboardEvent) => void>;
const scrollTo = jest.fn();
const scrollToEnd = jest.fn();
const scrollRef = {
  current: { scrollTo, scrollToEnd } as unknown as BottomSheetScrollViewMethods,
};

function keyboard(event: KeyboardEventName, height = 320) {
  act(() => listeners.get(event)?.({ endCoordinates: { height } } as KeyboardEvent));
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  listeners = new Map();
  jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
  jest.spyOn(Keyboard, 'addListener').mockImplementation((name, listener) => {
    listeners.set(name, listener);
    return {
      remove: () => {
        listeners.delete(name);
      },
    } as ReturnType<typeof Keyboard.addListener>;
  });
});

afterEach(() => {
  Platform.OS = originalOS;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('lets Gorhom handle iOS focus without adding a second keyboard spacer or scrolling away', () => {
  Platform.OS = 'ios';
  const { result } = renderHook(() => useAddWalletWizardKeyboard(true, 'url', scrollRef));
  keyboard('keyboardWillShow');
  act(() => jest.runAllTimers());
  expect(result.current).toBe(60);
  expect(Keyboard.addListener).not.toHaveBeenCalled();
  expect(scrollToEnd).not.toHaveBeenCalled();
});

it.each(['ios', 'android'] as const)(
  'resets scrolling and dismisses the keyboard between %s steps',
  (os) => {
    Platform.OS = os;
    const { rerender } = renderHook<number, { step: string }>(
      ({ step }) => useAddWalletWizardKeyboard(true, step, scrollRef),
      { initialProps: { step: 'url' } },
    );
    jest.clearAllMocks();
    rerender({ step: 'alias' });
    expect(Keyboard.dismiss).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
    rerender({ step: 'theme' });
    expect(Keyboard.dismiss).toHaveBeenCalledTimes(2);
    expect(scrollTo).toHaveBeenCalledTimes(2);
  },
);

it('preserves Android keyboard clearance and removes it when the keyboard hides', () => {
  Platform.OS = 'android';
  const { result } = renderHook(() => useAddWalletWizardKeyboard(true, 'url', scrollRef));
  keyboard('keyboardDidShow');
  expect(result.current).toBe(400);
  act(() => jest.advanceTimersByTime(100));
  expect(scrollToEnd).toHaveBeenCalledWith({ animated: true });
  keyboard('keyboardDidHide');
  expect(result.current).toBe(60);
});

it('cancels a pending Android scroll on a step change so it cannot move the next heading', () => {
  Platform.OS = 'android';
  const { result, rerender } = renderHook<number, { step: string }>(
    ({ step }) => useAddWalletWizardKeyboard(true, step, scrollRef),
    { initialProps: { step: 'url' } },
  );
  keyboard('keyboardDidShow');
  rerender({ step: 'alias' });
  act(() => jest.runAllTimers());
  expect(result.current).toBe(60);
  expect(scrollToEnd).not.toHaveBeenCalled();
});

it('stops listening and cancels delayed scrolling when the wizard closes', () => {
  Platform.OS = 'android';
  const { result, rerender } = renderHook<number, { visible: boolean }>(
    ({ visible }) => useAddWalletWizardKeyboard(visible, 'url', scrollRef),
    { initialProps: { visible: true } },
  );
  keyboard('keyboardDidShow');
  jest.clearAllMocks();
  rerender({ visible: false });
  act(() => jest.runAllTimers());
  expect(result.current).toBe(60);
  expect(listeners.size).toBe(0);
  expect(scrollToEnd).not.toHaveBeenCalled();
  // A separately presented CoinOS sheet must retain its keyboard.
  expect(Keyboard.dismiss).not.toHaveBeenCalled();
});

it('cancels the Android delayed scroll if the keyboard hides before it fires', () => {
  Platform.OS = 'android';
  renderHook(() => useAddWalletWizardKeyboard(true, 'url', scrollRef));
  keyboard('keyboardDidShow');
  keyboard('keyboardDidHide');
  act(() => jest.runAllTimers());
  expect(scrollToEnd).not.toHaveBeenCalled();
});

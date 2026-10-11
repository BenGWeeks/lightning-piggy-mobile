import { useEffect, type RefObject } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * On iOS, return a bottom sheet to its first detent when the keyboard closes.
 * gorhom v5's `keyboardBlurBehavior="restore"` can leave a dynamically sized
 * sheet stranded where the keyboard pushed it (mid-screen, with the tab bar
 * showing underneath), especially when the content changed while the keyboard
 * was up. Android resizes the window instead, so it doesn't need this.
 */
export function useSheetKeyboardRestore(
  sheetRef: RefObject<{ snapToIndex: (index: number) => void } | null>,
  active: boolean,
): void {
  useEffect(() => {
    if (!active || Platform.OS !== 'ios') return;
    const sub = Keyboard.addListener('keyboardDidHide', () => sheetRef.current?.snapToIndex(0));
    return () => sub.remove();
  }, [active, sheetRef]);
}

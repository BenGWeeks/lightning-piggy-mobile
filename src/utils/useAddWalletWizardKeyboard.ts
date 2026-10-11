import { useEffect, useState, type RefObject } from 'react';
import { Keyboard, Platform } from 'react-native';
import type { BottomSheetScrollViewMethods } from '@gorhom/bottom-sheet';

/** Keep each wizard step at its heading, with one owner of iOS keyboard avoidance. */
export function useAddWalletWizardKeyboard(
  visible: boolean,
  step: string,
  scrollRef: RefObject<BottomSheetScrollViewMethods | null>,
): number {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    setKeyboardHeight(0);
    if (!visible) return;

    Keyboard.dismiss();
    scrollRef.current?.scrollTo({ y: 0, animated: false });

    // Gorhom already lifts/resizes the sheet on iOS. Adding the keyboard
    // height to dynamic content and scrolling to its end hides the input.
    if (Platform.OS !== 'android') return;

    let scrollTimer: ReturnType<typeof setTimeout> | undefined;
    const cancelScroll = () => {
      if (scrollTimer !== undefined) clearTimeout(scrollTimer);
      scrollTimer = undefined;
    };
    const showSub = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardHeight(event.endCoordinates.height);
      cancelScroll();
      scrollTimer = setTimeout(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      }, 100);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      cancelScroll();
      setKeyboardHeight(0);
    });
    return () => {
      cancelScroll();
      showSub.remove();
      hideSub.remove();
    };
  }, [visible, step, scrollRef]);

  return keyboardHeight > 0 ? keyboardHeight + 80 : 60;
}

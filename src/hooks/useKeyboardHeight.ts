import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

// Tracks on-screen keyboard height so a scroll container can pad past the IME to the last field. Shared by the bottom-sheet forms; see docs/TROUBLESHOOTING.adoc "Bottom sheet doesn't slide up …" rule 5.
export function useKeyboardHeight(): number {
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) =>
      setKeyboardHeight(e.endCoordinates.height),
    );
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);
  return keyboardHeight;
}

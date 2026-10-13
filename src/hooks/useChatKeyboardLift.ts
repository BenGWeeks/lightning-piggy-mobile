import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { useAnimatedStyle } from 'react-native-reanimated';
/** Sticky composers translate visually; the message viewport must shrink as well. */
export function useChatKeyboardLift() {
  const keyboard = useReanimatedKeyboardAnimation();
  return useAnimatedStyle(() => ({ marginBottom: -keyboard.height.value }));
}

// Drag-to-dismiss behaviour for the merchant / cache detail bottom
// sheets. Returns an `Animated.Value` to bind to the sheet's `translateY`
// transform and a `PanResponder` to attach to a handle/grabber view.
//
// Behaviour: vertical drag > 4 px engages the responder, translateY
// follows finger (clamped upward). Release: if drag exceeded 100 px
// downward OR velocity > 0.5, animate off-screen and call `onClose`
// once the animation lands. Otherwise spring back to anchor.
//
// Off-screen target uses `Dimensions.get('window').height` rather than
// a hard-coded 600 px because tall devices (Pixel 8 ≈ 2400 px) with
// `maxHeight: '80%'` sheets stay visible past 600 px translateY and
// the sheet appeared to flash back to full size right before unmount.
//
// Extracted from MapScreen.tsx for re-use on the Explore mini-map's
// pin-tap sheets (#627 follow-up).

import { useRef } from 'react';
import { Animated, Dimensions, PanResponder } from 'react-native';

export function useDismissibleSheet(onClose: () => void): {
  translateY: Animated.Value;
  panHandlers: ReturnType<typeof PanResponder.create>['panHandlers'];
} {
  const translateY = useRef(new Animated.Value(0)).current;
  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4,
      onPanResponderMove: (_e, g) => {
        // Clamp upward drag — the sheet shouldn't rise past its
        // anchor since there's nowhere meaningful for it to go.
        translateY.setValue(Math.max(0, g.dy));
      },
      onPanResponderRelease: (_e, g) => {
        const dismiss = g.dy > 100 || g.vy > 0.5;
        if (dismiss) {
          const screenHeight = Dimensions.get('window').height;
          Animated.timing(translateY, {
            toValue: screenHeight,
            duration: 180,
            useNativeDriver: true,
          }).start(() => {
            // No translateY reset — sheet unmounts on onClose and the
            // next mount creates a fresh translateY at 0 via useRef.
            onClose();
          });
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            friction: 8,
            tension: 80,
          }).start();
        }
      },
    }),
  ).current;
  return { translateY, panHandlers: responder.panHandlers };
}

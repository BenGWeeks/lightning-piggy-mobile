// Full-screen image viewer for avatars / profile pictures (#661), with
// pinch-to-zoom + pan, double-tap-to-zoom, and single-tap-to-dismiss.
//
// NB: a Modal renders in its own native window outside the app's root view, so
// the GestureHandlerRootView at App.tsx doesn't wrap it — we add a local one
// here or the gestures silently no-op (known RNGH + Modal gotcha).

import React, { useEffect } from 'react';
import { Modal, StyleSheet, useWindowDimensions } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';

interface Props {
  url: string | null;
  onClose: () => void;
}

const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;

const FullscreenImageModal: React.FC<Props> = ({ url, onClose }) => {
  const { width, height } = useWindowDimensions();
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  // Reset transforms whenever a new image opens.
  useEffect(() => {
    if (url) {
      scale.value = 1;
      savedScale.value = 1;
      tx.value = 0;
      ty.value = 0;
      savedTx.value = 0;
      savedTy.value = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(Math.max(savedScale.value * e.scale, 0.5), MAX_SCALE);
    })
    .onEnd(() => {
      if (scale.value < 1) {
        scale.value = withTiming(1);
        savedScale.value = 1;
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedTx.value = 0;
        savedTy.value = 0;
      } else {
        savedScale.value = scale.value;
      }
    });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      tx.value = savedTx.value + e.translationX;
      ty.value = savedTy.value + e.translationY;
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) {
        scale.value = withTiming(1);
        savedScale.value = 1;
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedTx.value = 0;
        savedTy.value = 0;
      } else {
        scale.value = withTiming(DOUBLE_TAP_SCALE);
        savedScale.value = DOUBLE_TAP_SCALE;
      }
    });

  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .onEnd(() => {
      runOnJS(onClose)();
    });

  // pinch + pan run together; single tap dismisses but waits for a possible
  // double tap (which zooms) to fail first.
  const composed = Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(doubleTap, singleTap));

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <Modal visible={url !== null} transparent animationType="fade" onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.root}>
        <GestureDetector gesture={composed}>
          <Animated.View
            style={styles.backdrop}
            accessibilityLabel="Full-screen image (pinch to zoom, tap to close)"
            testID="fullscreen-image-backdrop"
          >
            {url ? (
              <Animated.View style={[{ width, height }, animatedStyle]}>
                <ExpoImage
                  source={{ uri: url }}
                  style={{ width, height }}
                  contentFit="contain"
                  cachePolicy="memory-disk"
                  transition={150}
                  accessibilityLabel="Full-screen image"
                />
              </Animated.View>
            ) : null}
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default FullscreenImageModal;

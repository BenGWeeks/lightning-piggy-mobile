import React, { useMemo, useRef, useState } from 'react';
import {
  View,
  PanResponder,
  type LayoutChangeEvent,
  type GestureResponderEvent,
} from 'react-native';
import type { Palette } from '../styles/palettes';
import { createAmountSliderStyles, THUMB_SIZE } from '../styles/AmountSlider.styles';

interface Props {
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  colors: Palette;
  testID?: string;
}

/**
 * Bold, app-themed amount slider — a thick pink track with a large, easy-to-drag
 * circular thumb. Custom (PanResponder) rather than @react-native-community/slider
 * so the thumb/track match the rest of the app and the touch target is generous.
 * PanResponder (not react-native-gesture-handler) is deliberate: it doesn't fight
 * the @gorhom/bottom-sheet gesture handler the way an RNGH pan would. #341.
 */
export function AmountSlider({
  min,
  max,
  value,
  onChange,
  colors,
  testID,
}: Props): React.ReactElement {
  const styles = useMemo(() => createAmountSliderStyles(colors), [colors]);
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);

  const range = Math.max(1, max - min);
  const frac = Math.min(1, Math.max(0, (value - min) / range));

  // The PanResponder is created once, so route every touch through a ref that
  // always holds the latest props (else min/max/onChange would be stale).
  const handleRef = useRef<(x: number) => void>(() => {});
  handleRef.current = (x: number) => {
    const usable = widthRef.current - THUMB_SIZE;
    if (usable <= 0) return;
    const f = Math.min(1, Math.max(0, (x - THUMB_SIZE / 2) / usable));
    onChange(Math.round(min + f * range));
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e: GestureResponderEvent) => handleRef.current(e.nativeEvent.locationX),
      onPanResponderMove: (e: GestureResponderEvent) => handleRef.current(e.nativeEvent.locationX),
    }),
  ).current;

  const usable = Math.max(0, width - THUMB_SIZE);
  const thumbLeft = frac * usable;
  const fillWidth = thumbLeft + THUMB_SIZE / 2;

  return (
    <View
      style={styles.container}
      onLayout={(e: LayoutChangeEvent) => {
        const w = e.nativeEvent.layout.width;
        widthRef.current = w;
        setWidth(w);
      }}
      testID={testID}
      accessibilityRole="adjustable"
      accessibilityValue={{ min, max, now: value }}
      {...pan.panHandlers}
    >
      <View style={styles.track} />
      <View style={[styles.fill, { width: fillWidth }]} />
      <View style={[styles.thumb, { left: thumbLeft }]} />
    </View>
  );
}

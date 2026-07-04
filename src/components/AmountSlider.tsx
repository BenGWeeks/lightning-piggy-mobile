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
  /** Spoken label for the adjustable control (e.g. "Claim amount in sats"). */
  accessibilityLabel?: string;
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
  accessibilityLabel,
}: Props): React.ReactElement {
  const styles = useMemo(() => createAmountSliderStyles(colors), [colors]);
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);

  const range = Math.max(1, max - min);
  const frac = Math.min(1, Math.max(0, (value - min) / range));

  // Last integer value we dispatched to the parent. PanResponderMove fires
  // ~once per frame (60/s) but the slider value is an integer — most frames
  // land on the same sat amount. Tracking the last-dispatched value and only
  // calling `onChange` when the rounded integer actually changes throttles the
  // parent re-render from per-frame to per-value-step (audit LOW 6). The slider
  // renders its own thumb/fill from the `value` prop, so a 1-frame parent lag
  // is imperceptible. Initialised to NaN so the first move always dispatches.
  const lastDispatchedRef = useRef<number>(NaN);
  // The PanResponder is created once, so route every touch through a ref that
  // always holds the latest props (else min/max/onChange would be stale).
  const handleRef = useRef<(x: number) => void>(() => {});
  handleRef.current = (x: number) => {
    const usable = widthRef.current - THUMB_SIZE;
    if (usable <= 0) return;
    const f = Math.min(1, Math.max(0, (x - THUMB_SIZE / 2) / usable));
    // Clamp to [min, max]: with min === max, `range` is floored to 1 to avoid a
    // divide-by-zero, so the raw value could land at min+1 (out of bounds).
    const next = Math.min(max, Math.max(min, Math.round(min + f * range)));
    if (next === lastDispatchedRef.current) return;
    lastDispatchedRef.current = next;
    onChange(next);
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
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="adjustable"
      accessibilityValue={{ min, max, now: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        // Keep the drag throttle's last-dispatched ref in sync so a
        // subsequent drag back onto a value the a11y action set still fires.
        if (e.nativeEvent.actionName === 'increment') {
          const next = Math.min(max, value + 1);
          lastDispatchedRef.current = next;
          onChange(next);
        } else if (e.nativeEvent.actionName === 'decrement') {
          const next = Math.max(min, value - 1);
          lastDispatchedRef.current = next;
          onChange(next);
        }
      }}
      {...pan.panHandlers}
    >
      <View style={styles.track} />
      <View style={[styles.fill, { width: fillWidth }]} />
      <View style={[styles.thumb, { left: thumbLeft }]} />
    </View>
  );
}

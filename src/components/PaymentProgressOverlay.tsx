import React, { useEffect, useMemo, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  useWindowDimensions,
  ActivityIndicator,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  withTiming,
  withDelay,
  withRepeat,
  withSpring,
  withSequence,
  interpolate,
  interpolateColor,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { Check, X } from 'lucide-react-native';
import { colors } from '../styles/theme';

export type PaymentProgressState = 'sending' | 'success' | 'error' | 'hidden';
export type PaymentDirection = 'send' | 'receive';

interface Props {
  state: PaymentProgressState;
  direction?: PaymentDirection; // default 'send'
  amountSats?: number;
  recipientName?: string;
  errorMessage?: string;
  onDismiss: () => void;
}

const BUBBLE_COUNT = 140;
const CONFETTI_COUNT = 90;
// Screen should be packed with bubbles by ~5s. Quadratic stagger means
// early bubbles are sparse and density ramps up rapidly toward the 5s mark.
const FULL_DENSITY_MS = 5000;
// Auto-dismiss delay once we hit `success`; gives the user a beat to see
// the tick + the green bubble wave (or confetti burst) before closing.
const SUCCESS_DISMISS_MS = 2200;

// On-brand confetti palette — Piggy pink plus blues and purples.
const CONFETTI_COLORS = [
  colors.brandPink,
  '#FF6BB7', // light pink
  '#7A5CFF', // violet
  '#5B8DEF', // blue
  '#22C1E4', // cyan
  '#A77BFF', // lavender
];

interface BubbleSpec {
  index: number;
  startXRatio: number;
  size: number;
  duration: number;
  driftPx: number;
  delayMs: number;
  opacityPeak: number;
}

function makeSpecs(count: number, screenHeight: number): BubbleSpec[] {
  const specs: BubbleSpec[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / count; // 0..1
    // Quadratic stagger: sparse at first, denser toward FULL_DENSITY_MS.
    const delayMs = t * t * FULL_DENSITY_MS;
    specs.push({
      index: i,
      startXRatio: Math.random(),
      size: 10 + Math.random() * 34,
      duration: 2400 + Math.random() * 1800,
      driftPx: -40 + Math.random() * 80,
      delayMs,
      opacityPeak: 0.35 + Math.random() * 0.4,
    });
  }
  // Unused screenHeight param kept for future tuning (eg size scaling
  // on short screens). Silence the lint by using it.
  void screenHeight;
  return specs;
}

interface ConfettiSpec {
  index: number;
  startXRatio: number;
  width: number;
  height: number;
  color: string;
  duration: number;
  driftPx: number;
  delayMs: number;
  spinTurns: number;
  opacityPeak: number;
}

function makeConfettiSpecs(count: number): ConfettiSpec[] {
  const specs: ConfettiSpec[] = [];
  for (let i = 0; i < count; i++) {
    // Staggered launch over ~800ms for a celebratory wave rather than
    // a hard burst. Longer than that and it feels sluggish.
    const delayMs = Math.random() * 800;
    specs.push({
      index: i,
      startXRatio: Math.random(),
      width: 7 + Math.random() * 6,
      height: 10 + Math.random() * 8,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      duration: 2200 + Math.random() * 1600,
      driftPx: -60 + Math.random() * 120,
      delayMs,
      spinTurns: 2 + Math.random() * 4,
      opacityPeak: 0.85 + Math.random() * 0.15,
    });
  }
  return specs;
}

interface BubbleProps {
  spec: BubbleSpec;
  colorProgress: SharedValue<number>;
  screenWidth: number;
  screenHeight: number;
}

function Bubble({ spec, colorProgress, screenWidth, screenHeight }: BubbleProps) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      spec.delayMs,
      withRepeat(withTiming(1, { duration: spec.duration, easing: Easing.linear }), -1, false),
    );
    return () => cancelAnimation(progress);
  }, [progress, spec.delayMs, spec.duration]);

  const animatedStyle = useAnimatedStyle(() => {
    const y = interpolate(progress.value, [0, 1], [screenHeight + 60, -80]);
    const xOffset = Math.sin(progress.value * Math.PI * 2) * spec.driftPx;
    const opacity = interpolate(
      progress.value,
      [0, 0.12, 0.85, 1],
      [0, spec.opacityPeak, spec.opacityPeak, 0],
    );
    const bg = interpolateColor(colorProgress.value, [0, 1], [colors.brandPink, colors.green]);
    return {
      transform: [{ translateX: xOffset }, { translateY: y }],
      opacity,
      backgroundColor: bg,
    };
  });

  const baseLeft = spec.startXRatio * screenWidth - spec.size / 2;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.bubble,
        {
          width: spec.size,
          height: spec.size,
          borderRadius: spec.size / 2,
          left: baseLeft,
          top: 0,
        },
        animatedStyle,
      ]}
    />
  );
}

interface ConfettiProps {
  spec: ConfettiSpec;
  armed: SharedValue<number>;
  screenWidth: number;
  screenHeight: number;
}

function Confetti({ spec, armed, screenWidth, screenHeight }: ConfettiProps) {
  const progress = useSharedValue(0);

  // React to the `armed` shared value flipping 0 → 1 — that kicks off the
  // fall animation for this piece with its per-spec stagger.
  useAnimatedReaction(
    () => armed.value,
    (armedNow, armedBefore) => {
      if (armedNow === 1 && armedBefore !== 1) {
        progress.value = withDelay(
          spec.delayMs,
          withTiming(1, { duration: spec.duration, easing: Easing.in(Easing.quad) }),
        );
      } else if (armedNow === 0) {
        cancelAnimation(progress);
        progress.value = 0;
      }
    },
  );

  const animatedStyle = useAnimatedStyle(() => {
    const y = interpolate(progress.value, [0, 1], [-80, screenHeight + 80]);
    const xOffset = Math.sin(progress.value * Math.PI * 1.5) * spec.driftPx;
    const rotate = `${progress.value * spec.spinTurns * 360}deg`;
    const opacity = interpolate(
      progress.value,
      [0, 0.05, 0.9, 1],
      [0, spec.opacityPeak, spec.opacityPeak, 0],
    );
    return {
      transform: [{ translateX: xOffset }, { translateY: y }, { rotate }],
      opacity,
    };
  });

  const baseLeft = spec.startXRatio * screenWidth - spec.width / 2;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.confetti,
        {
          width: spec.width,
          height: spec.height,
          backgroundColor: spec.color,
          left: baseLeft,
          top: 0,
        },
        animatedStyle,
      ]}
    />
  );
}

export default function PaymentProgressOverlay({
  state,
  direction = 'send',
  amountSats,
  recipientName,
  errorMessage,
  onDismiss,
}: Props) {
  const { width, height } = useWindowDimensions();

  // Keep the overlay mounted across `hidden` so bubbles don't flash
  // when state flips back to sending mid-flow. We drive the Modal's
  // `visible` from state.
  const visible = state !== 'hidden';

  const bubbleSpecs = useMemo(() => makeSpecs(BUBBLE_COUNT, height), [height]);
  const confettiSpecs = useMemo(() => makeConfettiSpecs(CONFETTI_COUNT), []);

  // 0 = pink (sending / error), 1 = green (success). The error case
  // keeps pink so the green-flood doesn't imply success on a failure.
  const colorProgress = useSharedValue(0);
  // 0 while holding fire, 1 once success fires — gates the confetti launch.
  const confettiArmed = useSharedValue(0);
  const cardScale = useSharedValue(0.9);
  const cardOpacity = useSharedValue(0);
  const iconScale = useSharedValue(0);

  // Entry animation when overlay first appears.
  useEffect(() => {
    if (visible) {
      cardScale.value = withSpring(1, { damping: 14, stiffness: 180 });
      cardOpacity.value = withTiming(1, { duration: 220 });
    } else {
      cardScale.value = 0.9;
      cardOpacity.value = 0;
      colorProgress.value = 0;
      iconScale.value = 0;
      confettiArmed.value = 0;
    }
  }, [visible, cardScale, cardOpacity, colorProgress, iconScale, confettiArmed]);

  // Drive colour + icon animations on state change, and auto-dismiss on success.
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (state === 'success') {
      if (direction === 'send') {
        // Bubbles morph from pink to green on a successful send.
        colorProgress.value = withTiming(1, { duration: 650 });
      } else {
        // Receive: fire the on-brand confetti burst.
        confettiArmed.value = 1;
      }
      iconScale.value = withSequence(
        withTiming(0, { duration: 0 }),
        withSpring(1, { damping: 10, stiffness: 220 }),
      );
      dismissTimerRef.current = setTimeout(() => {
        onDismiss();
      }, SUCCESS_DISMISS_MS);
    } else if (state === 'error') {
      iconScale.value = withSequence(
        withTiming(0, { duration: 0 }),
        withSpring(1, { damping: 10, stiffness: 220 }),
      );
    } else if (state === 'sending') {
      colorProgress.value = 0;
      iconScale.value = 0;
      confettiArmed.value = 0;
    }
    return () => {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
    };
  }, [state, direction, colorProgress, iconScale, confettiArmed, onDismiss]);

  const cardAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: cardScale.value }],
    opacity: cardOpacity.value,
  }));

  const iconAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }],
    opacity: iconScale.value,
  }));

  const formattedAmount =
    typeof amountSats === 'number' && amountSats > 0
      ? `${amountSats.toLocaleString()} sats`
      : undefined;

  const isReceive = direction === 'receive';
  let title = isReceive ? 'Waiting for payment…' : 'Sending payment…';
  let subtitle: string | undefined = recipientName
    ? isReceive
      ? `from ${recipientName}`
      : `to ${recipientName}`
    : formattedAmount;
  if (state === 'success') {
    title = isReceive ? 'Payment received!' : 'Payment sent!';
    subtitle = formattedAmount
      ? recipientName
        ? isReceive
          ? `${formattedAmount} from ${recipientName}`
          : `${formattedAmount} to ${recipientName}`
        : formattedAmount
      : recipientName
        ? isReceive
          ? `from ${recipientName}`
          : `to ${recipientName}`
        : undefined;
  } else if (state === 'error') {
    title = 'Payment failed';
    subtitle = errorMessage || 'Please try again.';
  }

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      animationType="fade"
      onRequestClose={state === 'sending' ? undefined : onDismiss}
    >
      <View style={styles.root}>
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {isReceive
            ? confettiSpecs.map((spec) => (
                <Confetti
                  key={spec.index}
                  spec={spec}
                  armed={confettiArmed}
                  screenWidth={width}
                  screenHeight={height}
                />
              ))
            : bubbleSpecs.map((spec) => (
                <Bubble
                  key={spec.index}
                  spec={spec}
                  colorProgress={colorProgress}
                  screenWidth={width}
                  screenHeight={height}
                />
              ))}
        </View>

        <Animated.View style={[styles.card, cardAnimatedStyle]}>
          {state === 'sending' && (
            <ActivityIndicator size="large" color={colors.brandPink} style={styles.iconSlot} />
          )}
          {state === 'success' && (
            <Animated.View style={[styles.iconSlot, styles.successCircle, iconAnimatedStyle]}>
              <Check size={44} color={colors.white} strokeWidth={3.5} />
            </Animated.View>
          )}
          {state === 'error' && (
            <Animated.View style={[styles.iconSlot, styles.errorCircle, iconAnimatedStyle]}>
              <X size={44} color={colors.white} strokeWidth={3.5} />
            </Animated.View>
          )}

          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'rgba(21, 23, 26, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  bubble: {
    position: 'absolute',
  },
  confetti: {
    position: 'absolute',
    borderRadius: 2,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: 28,
    paddingVertical: 32,
    paddingHorizontal: 28,
    minWidth: 260,
    maxWidth: 340,
    alignItems: 'center',
    gap: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 12,
  },
  iconSlot: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successCircle: {
    borderRadius: 36,
    backgroundColor: colors.green,
  },
  errorCircle: {
    borderRadius: 36,
    backgroundColor: colors.red,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textHeader,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSupplementary,
    textAlign: 'center',
  },
});

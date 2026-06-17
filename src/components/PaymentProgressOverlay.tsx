import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  useWindowDimensions,
  ActivityIndicator,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { humanizePaymentError } from '../utils/paymentErrors';
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
import { Check, X, WifiOff } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useSendingAnimation } from '../contexts/SendingAnimationContext';
import LightningOverlay from './LightningOverlay';
import { lightPalette, type Palette } from '../styles/palettes';

export type PaymentProgressState =
  | 'sending'
  | 'in-flight-extended'
  | 'success'
  // Relay/transport connectivity failure — outcome UNKNOWN, not a
  // confirmed failure (#648). Distinct from 'error' so we never imply the
  // payment failed when it may have settled.
  | 'connection-lost'
  | 'error'
  | 'hidden';
export type PaymentDirection = 'send' | 'receive';

interface Props {
  state: PaymentProgressState;
  direction?: PaymentDirection; // default 'send'
  amountSats?: number;
  recipientName?: string;
  errorMessage?: string;
  onDismiss: () => void;
  /** If provided, a "Cancel" link renders beneath the spinner during
   * the `sending` state. Used to abort long-running NWC payments when
   * the relay is unreachable (see #175). */
  onCancel?: () => void;
  /** When the in-flight payment is a Boltz swap (e.g. Lightning → on-chain
   * via a reverse swap), the `in-flight-extended` state names it as a swap
   * and explains swaps take longer — instead of the generic copy used for a
   * plain Lightning send that's slow to confirm. */
  inFlightIsSwap?: boolean;
}

const BUBBLE_COUNT = 140;
const CONFETTI_COUNT = 135;
// Screen should be packed with bubbles by ~5s. Quadratic stagger means
// early bubbles are sparse and density ramps up rapidly toward the 5s mark.
const FULL_DENSITY_MS = 5000;

// On-brand confetti palette — Piggy pink plus blues and purples. The
// brand pink is identical in light and dark palettes, so reading from
// `lightPalette` at module scope is fine.
const CONFETTI_COLORS = [
  lightPalette.brandPink,
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
      size: 22 + Math.random() * 46,
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
  width: number;
  height: number;
  color: string;
  // Radial burst from the card centre: initial velocity (px/s).
  vx: number;
  vy: number;
  // Gravity pulls pieces down after the initial burst (px/s²).
  gravity: number;
  // Total animation duration (ms).
  duration: number;
  // Small per-piece launch stagger so the burst feels alive, not mechanical.
  delayMs: number;
  spinTurns: number;
  opacityPeak: number;
}

function makeConfettiSpecs(count: number): ConfettiSpec[] {
  const specs: ConfettiSpec[] = [];
  for (let i = 0; i < count; i++) {
    // Pick a random angle across the full circle, then bias slightly
    // upward so the burst feels explosive rather than dribbling straight
    // down into gravity.
    const angle = Math.random() * Math.PI * 2;
    const speed = 320 + Math.random() * 380; // px/s
    const vx = Math.cos(angle) * speed;
    // Bias upward: subtract a small extra upward component so on average
    // pieces launch *outward-and-up* before gravity takes over.
    const vy = Math.sin(angle) * speed - 80;
    specs.push({
      index: i,
      width: 7 + Math.random() * 6,
      height: 10 + Math.random() * 8,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      vx,
      vy,
      gravity: 780 + Math.random() * 180,
      duration: 1800 + Math.random() * 900,
      delayMs: Math.random() * 220,
      spinTurns: 1.5 + Math.random() * 3.5,
      opacityPeak: 0.9 + Math.random() * 0.1,
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
  const colors = useThemeColors();
  const progress = useSharedValue(0);
  // Reanimated worklets capture primitives by value, so freeze the
  // endpoint colours at render time so the interpolation below sees
  // stable string literals. Symmetric 3-stop range so success and
  // failure animate AWAY from 0/pink in opposite directions, never
  // crossing the other outcome's stop (#426):
  //   colorProgress -1 = red (failure)
  //   colorProgress  0 = pink (in-flight, default)
  //   colorProgress  1 = green (success)
  const bubblePink = colors.brandPink;
  const bubbleGreen = colors.green;
  const bubbleRed = colors.red;

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
    const bg = interpolateColor(
      colorProgress.value,
      [-1, 0, 1],
      [bubbleRed, bubblePink, bubbleGreen],
    );
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
        sharedStyles.bubble,
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
  originX: number;
  originY: number;
}

function Confetti({ spec, armed, originX, originY }: ConfettiProps) {
  // `progress` goes 0 → 1 across `spec.duration`. We interpret it as
  // elapsed-time in seconds via `progress * duration/1000` and plug that
  // into a standard projectile equation with gravity.
  const progress = useSharedValue(0);

  useAnimatedReaction(
    () => armed.value,
    (armedNow, armedBefore) => {
      if (armedNow === 1 && armedBefore !== 1) {
        progress.value = withDelay(
          spec.delayMs,
          withTiming(1, { duration: spec.duration, easing: Easing.linear }),
        );
      } else if (armedNow === 0) {
        cancelAnimation(progress);
        progress.value = 0;
      }
    },
  );

  const animatedStyle = useAnimatedStyle(() => {
    // Seconds since this piece launched.
    const t = (progress.value * spec.duration) / 1000;
    // Classic projectile: s = v0·t + ½·g·t². Horizontal has no accel.
    const tx = spec.vx * t;
    const ty = spec.vy * t + 0.5 * spec.gravity * t * t;
    const rotate = `${progress.value * spec.spinTurns * 360}deg`;
    // Quick fade-in at the start (so it pops from behind the card), then
    // a longer tail fade as pieces fall past the edges.
    const opacity = interpolate(
      progress.value,
      [0, 0.06, 0.75, 1],
      [0, spec.opacityPeak, spec.opacityPeak, 0],
    );
    return {
      transform: [{ translateX: tx }, { translateY: ty }, { rotate }],
      opacity,
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        sharedStyles.confetti,
        {
          width: spec.width,
          height: spec.height,
          backgroundColor: spec.color,
          left: originX - spec.width / 2,
          top: originY - spec.height / 2,
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
  onCancel,
  inFlightIsSwap = false,
}: Props) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { width, height } = useWindowDimensions();
  // Which send animation the user picked in Appearance. Only affects the
  // outgoing (send) particle layer; receive keeps its confetti burst.
  const { preference: sendingAnimation } = useSendingAnimation();

  // Keep the overlay mounted across `hidden` so bubbles don't flash
  // when state flips back to sending mid-flow. We drive the Modal's
  // `visible` from state.
  const visible = state !== 'hidden';

  // Map the raw internal error onto a user-facing string; keep the
  // original available for support via a "Show details" toggle (#175).
  const humanizedError = useMemo(() => humanizePaymentError(errorMessage), [errorMessage]);
  const [showDetails, setShowDetails] = useState(false);
  useEffect(() => {
    if (state !== 'error') setShowDetails(false);
  }, [state]);

  const bubbleSpecs = useMemo(() => makeSpecs(BUBBLE_COUNT, height), [height]);
  const confettiSpecs = useMemo(() => makeConfettiSpecs(CONFETTI_COUNT), []);

  // Symmetric 3-stop range so success and failure paths animate from
  // 0/pink in opposite directions and never cross each other's stop:
  //   -1 = red (failure)
  //    0 = pink (in-flight, default)
  //    1 = green (success)
  // See the `Bubble` component's interpolateColor for the colour map.
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

  // Drive colour + icon animations on state change. Dismissal is
  // user-driven — neither send nor receive auto-closes, so the user
  // always confirms they saw the outcome before we tear down the sheet.
  useEffect(() => {
    if (state === 'success') {
      if (direction === 'send') {
        // Bubbles morph from pink to green on a successful send.
        colorProgress.value = withTiming(1, { duration: 650 });
      } else {
        // Receive: fire the on-brand confetti burst. We delay the
        // launch by 280ms so the card visibly springs in *first* and
        // the burst reads as coming from behind it.
        confettiArmed.value = withDelay(280, withTiming(1, { duration: 0 }));
      }
      iconScale.value = withSequence(
        withTiming(0, { duration: 0 }),
        withSpring(1, { damping: 10, stiffness: 220 }),
      );
    } else if (state === 'error') {
      // Bubbles morph from pink to red on a definitive failure (#426 —
      // mirrors the pink → green success path, just in the opposite
      // direction so the animation never transits through green). Same
      // 650 ms duration so the animation feels symmetric across outcomes.
      if (direction === 'send') {
        colorProgress.value = withTiming(-1, { duration: 650 });
      }
      iconScale.value = withSequence(
        withTiming(0, { duration: 0 }),
        withSpring(1, { damping: 10, stiffness: 220 }),
      );
    } else if (state === 'connection-lost') {
      // Not a failure — keep the neutral palette (no red morph) but pop
      // the icon in so the "couldn't confirm" card reads as resolved.
      colorProgress.value = 0;
      iconScale.value = withSequence(
        withTiming(0, { duration: 0 }),
        withSpring(1, { damping: 10, stiffness: 220 }),
      );
    } else if (state === 'sending' || state === 'in-flight-extended') {
      colorProgress.value = 0;
      iconScale.value = 0;
      confettiArmed.value = 0;
    }
  }, [state, direction, colorProgress, iconScale, confettiArmed]);

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
  } else if (state === 'connection-lost') {
    title = 'Connection lost';
    subtitle =
      "We couldn't reach your wallet to confirm. Your payment may still have gone through — check your balance before trying again.";
  } else if (state === 'error') {
    title = 'Payment failed';
    subtitle = humanizedError.message;
  } else if (state === 'in-flight-extended') {
    if (inFlightIsSwap) {
      title = 'Boltz swap in progress';
      subtitle =
        'Swaps take a little longer to settle. Safe to close — it finishes in the background and appears in your transactions.';
    } else {
      title = 'Still in flight';
      subtitle =
        'This is taking longer than usual to settle. The result will appear in your transactions once it does.';
    }
  }

  // Android expects a stable `onRequestClose` for hardware-back behaviour
  // — passing `undefined` intermittently can warn and makes the button
  // feel inconsistent. Always provide a handler; swallow the back press
  // while the payment is still in flight so the user doesn't accidentally
  // dismiss the "Sending…" state and lose sight of the outcome.
  const handleRequestClose = () => {
    if (state === 'sending') return;
    onDismiss();
  };

  const showSpinner = state === 'sending' || state === 'in-flight-extended';

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      animationType="fade"
      onRequestClose={handleRequestClose}
    >
      <View style={styles.root}>
        {/* Particle layer renders BEHIND the card — later siblings stack
         *  above earlier ones in RN, so this block must come first.
         *  Receive = radial confetti burst from card centre. Send respects
         *  the Appearance "Sending animation" setting: bubbles (default) or
         *  the procedural Skia lightning. Both send variants morph purple →
         *  green on success via the same `colorProgress` driver. */}
        {isReceive ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {confettiSpecs.map((spec) => (
              <Confetti
                key={spec.index}
                spec={spec}
                armed={confettiArmed}
                originX={width / 2}
                originY={height / 2}
              />
            ))}
          </View>
        ) : sendingAnimation === 'lightning' ? (
          <LightningOverlay progress={colorProgress} width={width} height={height} />
        ) : (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {bubbleSpecs.map((spec) => (
              <Bubble
                key={spec.index}
                spec={spec}
                colorProgress={colorProgress}
                screenWidth={width}
                screenHeight={height}
              />
            ))}
          </View>
        )}

        <Animated.View style={[styles.card, cardAnimatedStyle]}>
          {showSpinner && (
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
          {state === 'connection-lost' && (
            <Animated.View style={[styles.iconSlot, styles.connectionCircle, iconAnimatedStyle]}>
              <WifiOff size={40} color={colors.zapYellowInk} strokeWidth={3} />
            </Animated.View>
          )}

          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

          {/* Error detail toggle: the humanised subtitle is shown by
           *  default; tapping "Show details" reveals the raw error for
           *  dev / support, tapping "Hide details" collapses it again.
           *  Only renders when the humaniser actually rewrote the
           *  message — no point showing a toggle whose detail equals
           *  the subtitle already on screen. */}
          {state === 'error' &&
          humanizedError.detail &&
          humanizedError.detail !== humanizedError.message ? (
            <>
              {showDetails ? (
                <Text style={styles.detailText} selectable testID="payment-overlay-error-detail">
                  {humanizedError.detail}
                </Text>
              ) : null}
              <TouchableOpacity
                onPress={() => setShowDetails((prev) => !prev)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel={showDetails ? 'Hide error details' : 'Show error details'}
                testID="payment-overlay-details-toggle"
              >
                <Text style={styles.detailsToggle}>
                  {showDetails ? 'Hide details' : 'Show details'}
                </Text>
              </TouchableOpacity>
            </>
          ) : null}

          {/* The user must acknowledge send/receive/error outcomes before
           *  we tear down the sheet — auto-dismiss can hide the fact the
           *  money moved if they weren't looking. During `sending` we
           *  optionally render a Cancel link so the user can bail out
           *  when the relay is unreachable (#175). */}
          {state !== 'sending' ? (
            <TouchableOpacity
              style={styles.okButton}
              onPress={onDismiss}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={
                state === 'in-flight-extended'
                  ? 'Continue in background'
                  : 'Dismiss payment confirmation'
              }
              testID="payment-overlay-ok"
            >
              <Text style={styles.okButtonText}>
                {state === 'in-flight-extended'
                  ? 'Continue in background'
                  : state === 'error'
                    ? 'Dismiss'
                    : 'OK'}
              </Text>
            </TouchableOpacity>
          ) : onCancel ? (
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={onCancel}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Cancel payment"
              testID="payment-overlay-cancel"
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

// Colour-agnostic styles shared with the Bubble and Confetti subcomponents
// so they don't need access to the themed styles created inside the main
// component.
const sharedStyles = StyleSheet.create({
  bubble: {
    position: 'absolute',
  },
  confetti: {
    position: 'absolute',
    borderRadius: 2,
  },
});

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: 'rgba(21, 23, 26, 0.45)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    card: {
      backgroundColor: colors.surface,
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
    // Amber, not red: a connection loss is "couldn't confirm", not a
    // confirmed failure (#648).
    connectionCircle: {
      borderRadius: 36,
      backgroundColor: colors.zapYellow,
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
    okButton: {
      marginTop: 12,
      alignSelf: 'stretch',
      backgroundColor: colors.brandPink,
      paddingVertical: 12,
      paddingHorizontal: 24,
      borderRadius: 14,
      alignItems: 'center',
    },
    okButtonText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '700',
      letterSpacing: 0.3,
    },
    cancelButton: {
      marginTop: 8,
      alignSelf: 'center',
      paddingVertical: 10,
      paddingHorizontal: 16,
    },
    cancelButtonText: {
      color: colors.textSupplementary,
      fontSize: 15,
      fontWeight: '600',
    },
    detailsToggle: {
      marginTop: -6,
      fontSize: 12,
      color: colors.textSupplementary,
      textDecorationLine: 'underline',
    },
    detailText: {
      marginTop: -6,
      fontSize: 11,
      color: colors.textSupplementary,
      textAlign: 'center',
      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    },
  });

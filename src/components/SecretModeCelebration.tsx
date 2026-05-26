// Secret-mode unlock celebration — confetti burst behind a card, same
// visual idiom as PaymentProgressOverlay's incoming-payment burst, scoped
// down to a single-shot "Secret Mode Enabled" / "Secret Mode Disabled"
// reveal. Replaces the plain Alert.alert() in AboutScreen so the unlock
// itself feels like a discovery.
//
// We deliberately duplicate the confetti spec generator + render rather
// than extracting it from PaymentProgressOverlay: the payment overlay's
// behaviour is tightly coupled to send/receive state machines and a
// shared abstraction would have to thread a lot of props through. The
// confetti body is small enough that a focused copy is clearer than
// the indirection.

import React, { useEffect, useMemo } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  useSharedValue,
  withTiming,
  withSpring,
  withDelay,
  cancelAnimation,
  useAnimatedStyle,
  useAnimatedReaction,
  type SharedValue,
} from 'react-native-reanimated';
import { Sparkles } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { lightPalette } from '../styles/palettes';
import type { Palette } from '../styles/palettes';

const CONFETTI_COUNT = 38;

const CONFETTI_COLORS = [
  lightPalette.brandPink,
  '#FF6BB7',
  '#7A5CFF',
  '#5B8DEF',
  '#22C1E4',
  '#A77BFF',
];

interface ConfettiSpec {
  index: number;
  width: number;
  height: number;
  color: string;
  vx: number;
  vy: number;
  gravity: number;
  duration: number;
  delayMs: number;
  spinTurns: number;
  opacityPeak: number;
}

function makeConfettiSpecs(): ConfettiSpec[] {
  const specs: ConfettiSpec[] = [];
  for (let i = 0; i < CONFETTI_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 320 + Math.random() * 380;
    specs.push({
      index: i,
      width: 7 + Math.random() * 6,
      height: 10 + Math.random() * 8,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 80,
      gravity: 780 + Math.random() * 180,
      duration: 1800 + Math.random() * 900,
      delayMs: Math.random() * 220,
      spinTurns: 1.5 + Math.random() * 3.5,
      opacityPeak: 0.9 + Math.random() * 0.1,
    });
  }
  return specs;
}

interface ConfettiProps {
  spec: ConfettiSpec;
  armed: SharedValue<number>;
  originX: number;
  originY: number;
}

function Confetti({ spec, armed, originX, originY }: ConfettiProps) {
  const progress = useSharedValue(0);

  useAnimatedReaction(
    () => armed.value,
    (armedNow) => {
      if (armedNow === 1 && progress.value === 0) {
        progress.value = withDelay(spec.delayMs, withTiming(1, { duration: spec.duration }));
      } else if (armedNow === 0) {
        cancelAnimation(progress);
        progress.value = 0;
      }
    },
  );

  const animatedStyle = useAnimatedStyle(() => {
    const t = (progress.value * spec.duration) / 1000;
    const tx = spec.vx * t;
    const ty = spec.vy * t + 0.5 * spec.gravity * t * t;
    const rotate = `${progress.value * spec.spinTurns * 360}deg`;
    let opacity = 0;
    if (progress.value < 0.06) {
      opacity = (progress.value / 0.06) * spec.opacityPeak;
    } else if (progress.value < 0.75) {
      opacity = spec.opacityPeak;
    } else {
      opacity = spec.opacityPeak * (1 - (progress.value - 0.75) / 0.25);
    }
    return {
      transform: [{ translateX: tx }, { translateY: ty }, { rotate }],
      opacity,
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.confetti,
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

interface Props {
  visible: boolean;
  enabled: boolean;
  onDismiss: () => void;
}

const SecretModeCelebration: React.FC<Props> = ({ visible, enabled, onDismiss }) => {
  const colors = useThemeColors();
  const themed = useMemo(() => createStyles(colors), [colors]);
  const { width, height } = useWindowDimensions();

  // Regenerate the spec set every time the overlay opens. A useMemo
  // with [] dependency would freeze a single trajectory set for the
  // lifetime of the component, so a second unlock in the same session
  // would replay the identical burst — feels canned. Keying on
  // `visible && enabled` gives each discovery moment a fresh seed.
  const confettiSpecs = useMemo(
    () => makeConfettiSpecs(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible && enabled],
  );
  const armed = useSharedValue(0);
  const cardScale = useSharedValue(0.9);
  const cardOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      cardScale.value = withSpring(1, { damping: 14, stiffness: 180 });
      cardOpacity.value = withTiming(1, { duration: 220 });
      // Only fire the confetti when secret mode is being ENABLED — the
      // disabled path uses the same card layout so it still feels like
      // a deliberate state change, but the burst is reserved for the
      // discovery moment.
      armed.value = enabled ? withDelay(120, withTiming(1, { duration: 0 })) : 0;
    } else {
      cardScale.value = 0.9;
      cardOpacity.value = 0;
      armed.value = 0;
    }
  }, [visible, enabled, cardScale, cardOpacity, armed]);

  const cardAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: cardScale.value }],
    opacity: cardOpacity.value,
  }));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={themed.root}>
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {enabled
            ? confettiSpecs.map((spec) => (
                <Confetti
                  key={spec.index}
                  spec={spec}
                  armed={armed}
                  originX={width / 2}
                  originY={height / 2}
                />
              ))
            : null}
        </View>

        <Animated.View style={[themed.card, cardAnimatedStyle]}>
          <View style={[themed.iconSlot, themed.iconBg]}>
            <Sparkles size={36} color={colors.white} strokeWidth={2.5} />
          </View>
          <Text style={themed.title}>
            {enabled ? 'Secret Mode Enabled' : 'Secret Mode Disabled'}
          </Text>
          <Text style={themed.subtitle}>
            {enabled
              ? "You've unlocked the hidden surfaces — hot-wallet import, the Following-only chip on Messages and Groups, the Web-of-Trust wider tiers, and other debug widgets."
              : 'Hidden surfaces are tucked away again. Restart if any toggle still appears.'}
          </Text>
          <TouchableOpacity
            style={themed.button}
            onPress={onDismiss}
            testID="secret-mode-celebration-ok"
            accessibilityLabel="Dismiss"
          >
            <Text style={themed.buttonText}>OK</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  confetti: {
    position: 'absolute',
    borderRadius: 2,
  },
});

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 28,
    },
    card: {
      width: '100%',
      maxWidth: 340,
      backgroundColor: colors.surface,
      borderRadius: 18,
      paddingHorizontal: 24,
      paddingTop: 28,
      paddingBottom: 20,
      alignItems: 'center',
    },
    iconSlot: {
      width: 72,
      height: 72,
      borderRadius: 36,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 18,
    },
    iconBg: {
      backgroundColor: colors.brandPink,
    },
    title: {
      fontSize: 20,
      fontWeight: '800',
      color: colors.textHeader,
      textAlign: 'center',
      marginBottom: 10,
    },
    subtitle: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.textBody,
      textAlign: 'center',
      marginBottom: 20,
    },
    button: {
      alignSelf: 'stretch',
      backgroundColor: colors.brandPink,
      borderRadius: 999,
      paddingVertical: 13,
      alignItems: 'center',
    },
    buttonText: {
      color: colors.white,
      fontSize: 15,
      fontWeight: '700',
    },
  });

export default SecretModeCelebration;

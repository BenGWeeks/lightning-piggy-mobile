// Add-contact celebration — confetti burst behind a card, the same visual
// idiom as SecretModeCelebration / PaymentProgressOverlay's incoming-payment
// burst, scoped to "you just connected to someone" (#660). As with those, we
// deliberately keep a focused copy of the confetti spec generator + render
// rather than threading a shared abstraction through several state machines.

import React, { useEffect, useMemo, useState } from 'react';
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
import { Image as ExpoImage } from 'expo-image';
import { UserRoundCheck } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { isSupportedImageUrl } from '../utils/imageUrl';
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
      vy: Math.sin(angle) * speed - 220,
      gravity: 900 + Math.random() * 300,
      duration: 1100 + Math.random() * 700,
      delayMs: Math.random() * 120,
      spinTurns: 1 + Math.random() * 3,
      opacityPeak: 0.85 + Math.random() * 0.15,
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
  // When the pubkey was already in the follow list, we show a neutral
  // "already connected" card and hold the confetti (no fresh follow to
  // celebrate) — see #660.
  alreadyConnected: boolean;
  name: string;
  // The contact's kind-0 avatar, shown in the card's icon slot. Falls back
  // to a generic check icon when absent (e.g. a brand-new follow whose
  // profile hasn't resolved yet, or a contact with no picture).
  picture?: string | null;
  onOpenProfile: () => void;
  onDismiss: () => void;
}

const AddContactCelebration: React.FC<Props> = ({
  visible,
  alreadyConnected,
  name,
  picture,
  onOpenProfile,
  onDismiss,
}) => {
  const colors = useThemeColors();
  const themed = useMemo(() => createStyles(colors), [colors]);
  const { width, height } = useWindowDimensions();

  // Fresh trajectory set per open — a frozen [] memo would replay an
  // identical burst on the next add (mirrors SecretModeCelebration).
  const confettiSpecs = useMemo(
    () => makeConfettiSpecs(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible && !alreadyConnected],
  );
  const armed = useSharedValue(0);
  const cardScale = useSharedValue(0.9);
  const cardOpacity = useSharedValue(0);

  // Avatar handling mirrors ContactListItem / GroupAvatar: pre-filter
  // unsupported URLs (.svg/.heic etc that crash expo-image's decoder) and fall
  // back to the icon on a load error. Reset the error flag when the URL changes
  // so a fresh follow whose picture resolves later still gets a chance (#662).
  const [avatarError, setAvatarError] = useState(false);
  useEffect(() => {
    setAvatarError(false);
  }, [picture]);
  const showAvatar = !!picture && !avatarError && isSupportedImageUrl(picture);

  useEffect(() => {
    if (visible) {
      cardScale.value = withSpring(1, { damping: 14, stiffness: 180 });
      cardOpacity.value = withTiming(1, { duration: 220 });
      // Confetti only for a NEW connection — the already-connected path
      // reuses the same card but reserves the burst for the real moment.
      armed.value = alreadyConnected ? 0 : withDelay(120, withTiming(1, { duration: 0 }));
    } else {
      cardScale.value = 0.9;
      cardOpacity.value = 0;
      armed.value = 0;
    }
  }, [visible, alreadyConnected, cardScale, cardOpacity, armed]);

  const cardAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: cardScale.value }],
    opacity: cardOpacity.value,
  }));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={themed.root}>
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {!alreadyConnected
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
          <View style={[themed.iconSlot, !showAvatar && themed.iconBg]}>
            {showAvatar ? (
              <ExpoImage
                source={{ uri: picture as string }}
                style={themed.avatar}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={200}
                recyclingKey={picture || undefined}
                autoplay={false}
                onError={() => setAvatarError(true)}
                accessibilityLabel={`${name} profile picture`}
              />
            ) : (
              <UserRoundCheck size={36} color={colors.white} strokeWidth={2.5} />
            )}
          </View>
          <Text style={themed.title}>{alreadyConnected ? 'Already connected' : 'Connected!'}</Text>
          <Text style={themed.subtitle}>
            {alreadyConnected
              ? `You're already connected to ${name}.`
              : `You're now connected to ${name}.`}
          </Text>
          <TouchableOpacity
            style={themed.button}
            onPress={onOpenProfile}
            testID="add-contact-celebration-open-profile"
            accessibilityLabel="Open profile"
          >
            <Text style={themed.buttonText}>Open profile</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={themed.secondaryButton}
            onPress={onDismiss}
            testID="add-contact-celebration-dismiss"
            accessibilityLabel="Dismiss"
          >
            <Text style={themed.secondaryButtonText}>Dismiss</Text>
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
      overflow: 'hidden',
    },
    iconBg: {
      backgroundColor: colors.brandPink,
    },
    avatar: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: colors.background,
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
    secondaryButton: {
      alignSelf: 'stretch',
      paddingVertical: 13,
      alignItems: 'center',
      marginTop: 4,
    },
    secondaryButtonText: {
      color: colors.textBody,
      fontSize: 15,
      fontWeight: '600',
    },
  });

export default AddContactCelebration;

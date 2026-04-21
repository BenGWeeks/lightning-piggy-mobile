import React, { useRef, useEffect, useCallback } from 'react';
import { Text, Image, Animated, Pressable, AccessibilityInfo, StyleSheet } from 'react-native';
import { styles } from '../styles/IntroScreen.styles';
import { RootNavigation } from '../navigation/types';

interface Props {
  navigation: RootNavigation;
}

const FADE_IN_MS = 800;
const HOLD_MS = 1200;
const FADE_OUT_MS = 600;

const IntroScreen: React.FC<Props> = ({ navigation }) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const screenFadeAnim = useRef(new Animated.Value(1)).current;
  const hasAdvancedRef = useRef(false);

  const advance = useCallback(
    (immediate: boolean) => {
      if (hasAdvancedRef.current) return;
      hasAdvancedRef.current = true;

      if (immediate) {
        navigation.replace('Onboarding');
        return;
      }

      Animated.timing(screenFadeAnim, {
        toValue: 0,
        duration: FADE_OUT_MS,
        useNativeDriver: true,
      }).start(() => navigation.replace('Onboarding'));
    },
    [navigation, screenFadeAnim],
  );

  useEffect(() => {
    let cancelled = false;
    let holdTimer: ReturnType<typeof setTimeout> | null = null;

    const runAnimatedPath = () => {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: FADE_IN_MS,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: FADE_IN_MS,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (!finished || cancelled) return;
        holdTimer = setTimeout(() => advance(false), HOLD_MS);
      });
    };

    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduceMotion) => {
        if (cancelled) return;
        if (reduceMotion) {
          advance(true);
          return;
        }
        runAnimatedPath();
      })
      .catch(() => {
        if (cancelled) return;
        runAnimatedPath();
      });

    return () => {
      cancelled = true;
      if (holdTimer) clearTimeout(holdTimer);
    };
  }, [advance, fadeAnim, slideAnim]);

  return (
    <Pressable
      style={StyleSheet.absoluteFill}
      onPress={() => advance(true)}
      accessibilityRole="button"
      accessibilityLabel="Skip intro"
      testID="intro-screen"
    >
      <Animated.View style={[styles.container, { opacity: screenFadeAnim }]}>
        <Image
          source={require('../../assets/images/lightning-piggy-intro.png')}
          style={styles.introImage}
          resizeMode="cover"
        />
        <Animated.View
          style={{
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
            alignItems: 'center',
            width: '100%',
          }}
        >
          <Image
            source={require('../../assets/images/lightning-piggy-logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.description}>
            An electronic cash piggy bank for children that accepts bitcoin sent over lightning,
            while displaying the amount saved in satoshis
          </Text>
          <Image
            source={require('../../assets/images/bitcoin-logo.png')}
            style={styles.bitcoinLogo}
            resizeMode="contain"
          />
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
};

export default IntroScreen;

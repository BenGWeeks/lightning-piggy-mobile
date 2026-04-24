/**
 * JS-side boot splash — a full-screen pig image on brand-pink shown
 * from the moment `<App>` mounts until the app signals it's ready.
 * Pairs with the native splash in `app.config.ts`: the native layer
 * covers from process start → JS bundle load, then this JS layer takes
 * over from JS-mount → first-meaningful-paint so the user never sees
 * the plain pink "loading" screen between them.
 *
 * Visual: same pig + logo IntroScreen uses, so the transition from
 * splash → Intro (new users) or splash → Home (logged-in users) is
 * a continuous pink background with the pig centered.
 *
 * The splash fades out over 250 ms once `done=true`, via React Native
 * `Animated`. After the animation, the component returns null so it
 * doesn't intercept touch events.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, View, Text } from 'react-native';
import { colors } from '../styles/theme';

interface Props {
  /** When true, fade out over 250ms and unmount. */
  done: boolean;
}

const FADE_MS = 250;

const BootSplash: React.FC<Props> = ({ done }) => {
  const opacity = useRef(new Animated.Value(1)).current;
  const [unmounted, setUnmounted] = useState(false);

  useEffect(() => {
    if (done) {
      Animated.timing(opacity, {
        toValue: 0,
        duration: FADE_MS,
        useNativeDriver: true,
      }).start(() => setUnmounted(true));
    }
  }, [done, opacity]);

  if (unmounted) return null;

  return (
    <Animated.View style={[styles.root, { opacity }]} pointerEvents={done ? 'none' : 'auto'}>
      <Image
        source={require('../../assets/images/lightning-piggy-intro.png')}
        style={styles.pig}
        resizeMode="contain"
      />
      <View style={styles.brandRow}>
        <Image
          source={require('../../assets/images/lightning-piggy-logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.brandText}>LIGHTNING PIGGY</Text>
      </View>
    </Animated.View>
  );
};

export default BootSplash;

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.brandPink,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  pig: {
    width: '80%',
    height: '50%',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 24,
  },
  logo: {
    width: 32,
    height: 32,
    tintColor: '#fff',
  },
  brandText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
});

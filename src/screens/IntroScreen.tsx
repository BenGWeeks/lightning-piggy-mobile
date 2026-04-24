import React, { useRef, useEffect, useMemo } from 'react';
import { View, Text, Image, TouchableOpacity, Animated } from 'react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { createIntroScreenStyles } from '../styles/IntroScreen.styles';
import { RootNavigation } from '../navigation/types';

interface Props {
  navigation: RootNavigation;
}

const IntroScreen: React.FC<Props> = ({ navigation }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createIntroScreenStyles(colors), [colors]);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 800,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  return (
    <View style={styles.container}>
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
          An electronic cash piggy bank for children that accepts bitcoin sent over lightning, while
          displaying the amount saved in satoshis
        </Text>
        <TouchableOpacity style={styles.button} onPress={() => navigation.navigate('Onboarding')}>
          <Text style={styles.buttonText}>Let's Go</Text>
        </TouchableOpacity>
        <Image
          source={require('../../assets/images/bitcoin-logo.png')}
          style={styles.bitcoinLogo}
          resizeMode="contain"
        />
      </Animated.View>
    </View>
  );
};

export default IntroScreen;

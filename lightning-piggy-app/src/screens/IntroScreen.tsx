import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { colors } from '../styles/theme';

interface Props {
  navigation: any;
}

const IntroScreen: React.FC<Props> = ({ navigation }) => {
  return (
    <View style={styles.container}>
      <Image
        source={require('../../assets/images/lightning-piggy-intro.png')}
        style={styles.introImage}
        resizeMode="contain"
      />
      <Image
        source={require('../../assets/images/lightning-piggy-logo.png')}
        style={styles.logo}
        resizeMode="contain"
      />
      <Text style={styles.description}>
        An electronic cash piggy bank for children that accepts bitcoin sent
        over lightning, while displaying the amount saved in satoshis
      </Text>
      <TouchableOpacity
        style={styles.button}
        onPress={() => navigation.navigate('Setup')}
      >
        <Text style={styles.buttonText}>Let's Go</Text>
      </TouchableOpacity>
      <Image
        source={require('../../assets/images/bitcoin-logo.png')}
        style={styles.bitcoinLogo}
        resizeMode="contain"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.brandPink,
    alignItems: 'center',
    paddingTop: 40,
  },
  introImage: {
    width: '100%',
    height: 200,
  },
  logo: {
    width: '80%',
    height: 60,
    marginTop: 24,
  },
  description: {
    color: colors.white,
    maxWidth: 300,
    marginTop: 37,
    fontSize: 16,
    fontWeight: '400',
    textAlign: 'center',
    lineHeight: 22,
  },
  button: {
    backgroundColor: colors.white,
    marginTop: 37,
    height: 52,
    paddingHorizontal: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  buttonText: {
    color: colors.brandPink,
    fontSize: 16,
    fontWeight: '700',
  },
  bitcoinLogo: {
    width: '60%',
    height: 80,
    marginTop: 37,
  },
});

export default IntroScreen;

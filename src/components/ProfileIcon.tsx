import React from 'react';
import { TouchableOpacity, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Path, Circle } from 'react-native-svg';
import { colors } from '../styles/theme';

interface Props {
  uri?: string | null;
  size?: number;
  onPress?: () => void;
}

const ProfileIcon: React.FC<Props> = ({ uri, size = 36, onPress }) => {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} accessibilityLabel="Profile" testID="profile-icon">
      <View style={[styles.container, { width: size, height: size, borderRadius: size / 2 }]}>
        {uri ? (
          <Image
            source={{ uri }}
            style={{ width: size, height: size, borderRadius: size / 2 }}
            cachePolicy="disk"
          />
        ) : (
          <Svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none">
            <Circle cx="12" cy="8" r="4" fill={colors.white} />
            <Path
              d="M4 20c0-3.314 3.582-6 8-6s8 2.686 8 6"
              stroke={colors.white}
              strokeWidth={2}
              strokeLinecap="round"
            />
          </Svg>
        )}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
});

export default ProfileIcon;

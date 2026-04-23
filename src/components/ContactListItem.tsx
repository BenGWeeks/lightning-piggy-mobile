import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Path, Circle } from 'react-native-svg';
import { Zap } from 'lucide-react-native';
import { colors } from '../styles/theme';

interface Props {
  name: string;
  picture?: string | null;
  lightningAddress?: string | null;
  onPress?: () => void;
  onZap?: () => void;
}

const ContactListItem: React.FC<Props> = ({ name, picture, lightningAddress, onPress, onZap }) => {
  const [avatarError, setAvatarError] = useState(false);
  const [avatarLoaded, setAvatarLoaded] = useState(false);

  // Reset state when picture URL changes
  useEffect(() => {
    setAvatarError(false);
    setAvatarLoaded(false);
  }, [picture]);

  // Timeout: if image hasn't loaded in 3s, show fallback
  useEffect(() => {
    if (!picture || avatarLoaded || avatarError) return;
    const timer = setTimeout(() => {
      if (!avatarLoaded) setAvatarError(true);
    }, 5000);
    return () => clearTimeout(timer);
  }, [picture, avatarLoaded, avatarError]);

  const showImage = !!picture && !avatarError;

  return (
    <TouchableOpacity style={styles.container} onPress={onPress} activeOpacity={onPress ? 0.6 : 1}>
      <View style={styles.avatar}>
        {showImage ? (
          <Image
            source={{ uri: picture }}
            style={styles.avatarImage}
            cachePolicy="disk"
            transition={200}
            recyclingKey={picture || undefined}
            autoplay={false}
            onError={() => setAvatarError(true)}
            onLoad={() => setAvatarLoaded(true)}
          />
        ) : (
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
            <Circle cx="12" cy="8" r="4" fill={colors.textSupplementary} />
            <Path
              d="M4 20c0-3.314 3.582-6 8-6s8 2.686 8 6"
              stroke={colors.textSupplementary}
              strokeWidth={2}
              strokeLinecap="round"
            />
          </Svg>
        )}
      </View>
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        {lightningAddress && (
          <Text style={styles.address} numberOfLines={1}>
            {lightningAddress}
          </Text>
        )}
      </View>
      {lightningAddress && onZap && (
        <TouchableOpacity style={styles.zapButton} onPress={onZap} activeOpacity={0.6}>
          <Zap size={22} color={colors.brandPink} fill={colors.brandPink} />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textHeader,
  },
  address: {
    fontSize: 13,
    color: colors.textSupplementary,
    marginTop: 2,
  },
  zapButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brandPinkLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default React.memo(ContactListItem);

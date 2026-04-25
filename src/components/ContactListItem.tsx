import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { UserRound, Zap } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';

interface Props {
  name: string;
  picture?: string | null;
  lightningAddress?: string | null;
  onPress?: () => void;
  onZap?: () => void;
}

const ContactListItem: React.FC<Props> = ({ name, picture, lightningAddress, onPress, onZap }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
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
          <UserRound size={22} color={colors.textBody} strokeWidth={1.75} />
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

// Row height is fixed by the styles below — avatar 44 + paddingVertical
// 14 × 2 = 72. Exported so FriendsScreen's alphabet-tap offset math
// doesn't duplicate the magic number; if you change avatar size or
// paddingVertical, update this constant too (the FriendsScreen comment
// references it).
export const CONTACT_LIST_ITEM_HEIGHT = 72;

const createStyles = (colors: Palette) =>
  StyleSheet.create({
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

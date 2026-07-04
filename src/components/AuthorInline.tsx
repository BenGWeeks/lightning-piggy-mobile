import React, { useMemo } from 'react';
import { View, Text } from 'react-native';
import { Image } from 'expo-image';
import * as nip19 from 'nostr-tools/nip19';
import { useThemeColors } from '../contexts/ThemeContext';
import { createAuthorInlineStyles } from '../styles/AuthorInline.styles';
import { usePubkeyProfile } from '../hooks/usePubkeyProfile';
import { isSupportedImageUrl } from '../utils/imageUrl';

interface Props {
  /** Author hex pubkey. */
  pubkey: string;
  size?: number;
  testID?: string;
}

/** Shorten a hex pubkey to a readable npub1abc…wxyz for the display fallback. */
function shortNpub(pubkey: string): string {
  try {
    const npub = nip19.npubEncode(pubkey);
    return `${npub.slice(0, 10)}…${npub.slice(-4)}`;
  } catch {
    return `${pubkey.slice(0, 8)}…`;
  }
}

/**
 * Small avatar + display name for a Nostr author (review / comment poster).
 * Resolves the author's kind-0 metadata via {@link usePubkeyProfile} (cached,
 * de-duped), falling back to a branded initial tile and a shortened npub.
 */
const AuthorInline: React.FC<Props> = ({ pubkey, size = 28, testID }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createAuthorInlineStyles(colors), [colors]);
  const { name, picture } = usePubkeyProfile(pubkey);
  const display = name && name.trim().length > 0 ? name : shortNpub(pubkey);
  const uri = picture && isSupportedImageUrl(picture) ? picture : null;
  const dimension = { width: size, height: size, borderRadius: size / 2 };

  const initial = useMemo(() => display.charAt(0).toUpperCase(), [display]);

  return (
    <View style={styles.row} testID={testID}>
      <View style={[styles.avatar, dimension]}>
        {uri ? (
          <Image
            source={{ uri }}
            style={dimension}
            cachePolicy="memory-disk"
            recyclingKey={uri}
            autoplay={false}
            contentFit="cover"
          />
        ) : (
          <View style={[styles.fallback, dimension]}>
            <Text style={[styles.fallbackText, { fontSize: size * 0.45 }]}>{initial}</Text>
          </View>
        )}
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {display}
      </Text>
    </View>
  );
};

export default AuthorInline;

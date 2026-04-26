import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { UserRound } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import { useNostr } from '../contexts/NostrContext';

interface Props {
  /**
   * Lowercased hex pubkeys of the people whose avatars we want to show,
   * newest-first. Up to the first 3 are rendered as a stacked cluster.
   * Pass an empty array to fall back to the group-letter avatar.
   */
  pubkeys: string[];
  /** Used as the letter-fallback when `pubkeys` is empty. */
  groupName: string;
  /** Diameter of the outer container. Inner avatars scale to ~62%. */
  size?: number;
}

const MAX_AVATARS = 3;

const GroupAvatar: React.FC<Props> = ({ pubkeys, groupName, size = 48 }) => {
  const colors = useThemeColors();
  const { contacts } = useNostr();
  const styles = useMemo(() => createStyles(colors, size), [colors, size]);

  // Map each pubkey to a profile picture lookup ahead of time so the row
  // re-renders only when contacts/pubkeys actually change. Each entry is
  // null when we have no kind-0 profile for that pubkey yet.
  const items = useMemo(() => {
    const byPubkey = new Map<string, string | null>();
    for (const c of contacts) {
      byPubkey.set(c.pubkey.toLowerCase(), c.profile?.picture ?? null);
    }
    return pubkeys.slice(0, MAX_AVATARS).map((pk) => ({
      pubkey: pk,
      picture: byPubkey.get(pk.toLowerCase()) ?? null,
    }));
  }, [pubkeys, contacts]);

  if (items.length === 0) {
    // No-message fallback: brand-pink letter avatar matches GroupsScreen.
    return (
      <View style={styles.letterAvatar}>
        <Text style={styles.letterText}>{(groupName[0] || '?').toUpperCase()}</Text>
      </View>
    );
  }

  return (
    <View style={styles.cluster}>
      {items.map((item, idx) => (
        <View key={item.pubkey} style={[styles.slot, slotPosition(idx, items.length, size)]}>
          <SingleAvatar
            picture={item.picture}
            colors={colors}
            innerSize={Math.round(size * 0.62)}
          />
        </View>
      ))}
    </View>
  );
};

interface SingleAvatarProps {
  picture: string | null;
  colors: Palette;
  innerSize: number;
}

const SingleAvatar: React.FC<SingleAvatarProps> = ({ picture, colors, innerSize }) => {
  const [errored, setErrored] = useState(false);
  const showImage = !!picture && !errored;
  // Thin white ring on every avatar — separates overlapping circles in
  // the stacked cluster and gives picture + placeholder slots the same
  // visual weight.
  const ringStyle = {
    width: innerSize,
    height: innerSize,
    borderRadius: innerSize / 2,
    backgroundColor: colors.background,
    borderWidth: 1.5,
    borderColor: colors.white,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    overflow: 'hidden' as const,
  };
  return (
    <View style={ringStyle}>
      {showImage ? (
        <Image
          source={{ uri: picture! }}
          style={{ width: innerSize, height: innerSize, borderRadius: innerSize / 2 }}
          cachePolicy="disk"
          onError={() => setErrored(true)}
        />
      ) : (
        <UserRound size={Math.round(innerSize * 0.55)} color={colors.textBody} strokeWidth={1.75} />
      )}
    </View>
  );
};

/** Position each inner avatar so the cluster reads as 1, 2, or 3 stacked
 * circles within the same `size × size` footprint. With a single avatar
 * we centre it; with two we offset diagonally; with three we anchor one
 * top-left, one top-right, one bottom-centre. Offsets are in raw pixels
 * scaled from `size` so the cluster keeps shape across row sizes. */
function slotPosition(idx: number, total: number, size: number): { top: number; left: number } {
  const inner = Math.round(size * 0.62);
  const slack = size - inner;
  const half = Math.round(slack / 2);
  if (total === 1) return { top: half, left: half };
  if (total === 2) {
    return idx === 0 ? { top: 0, left: 0 } : { top: slack, left: slack };
  }
  // 3 avatars: top-left, top-right, bottom-centre.
  if (idx === 0) return { top: 0, left: 0 };
  if (idx === 1) return { top: 0, left: slack };
  return { top: slack, left: half };
}

const createStyles = (colors: Palette, size: number) =>
  StyleSheet.create({
    cluster: {
      width: size,
      height: size,
      position: 'relative',
    },
    slot: {
      position: 'absolute',
    },
    letterAvatar: {
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor: colors.brandPinkLight,
      justifyContent: 'center',
      alignItems: 'center',
    },
    letterText: {
      fontSize: Math.round(size * 0.4),
      fontWeight: '700',
      color: colors.brandPink,
    },
  });

export default React.memo(GroupAvatar);

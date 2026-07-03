import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { MessageCircle, UserRound, Zap } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import { isSupportedImageUrl } from '../utils/imageUrl';

interface Props {
  name: string;
  picture?: string | null;
  lightningAddress?: string | null;
  /** Truthy when this contact has a Nostr pubkey, i.e. is messageable.
   * False for phone-book contacts who haven't been matched to a Nostr
   * identity — the message button renders disabled in that case. */
  canMessage?: boolean;
  /** Truthy when we can actually send a zap from the current user to this
   * contact. Two conditions must hold: the *user* has a wallet attached
   * (otherwise there's nothing to pay from), AND the *contact* has a
   * Lightning address in their Nostr profile (otherwise there's nowhere
   * to pay to). The disabled state then tells the user *which* condition
   * is missing via `zapDisabledReason`. */
  canZap?: boolean;
  /** Single-phrase explanation surfaced in the screen-reader label when
   * `canZap` is false. Caller composes it (the host screen knows whether
   * it's "no wallet" or "no Lightning address"). */
  zapDisabledReason?: string;
  /** Whether to render the zap affordance at all. On the list we hide it
   * entirely for contacts with no Lightning address (an empty spacer keeps
   * the message button column-aligned); the profile screen always shows it
   * (greyed) instead. Defaults to true. */
  showZap?: boolean;
  onPress?: () => void;
  onZap?: () => void;
  onMessage?: () => void;
  testID?: string;
}

const ContactListItem: React.FC<Props> = ({
  name,
  picture,
  lightningAddress,
  canMessage = false,
  canZap = false,
  zapDisabledReason,
  showZap = true,
  onPress,
  onZap,
  onMessage,
  testID,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [avatarError, setAvatarError] = useState(false);

  // Reset error state when picture URL changes (rows are recycled by
  // FlashList; without this a row that errored before would show its
  // fallback even when reused for a contact whose picture loads fine).
  useEffect(() => {
    setAvatarError(false);
  }, [picture]);

  // Pre-filter unsupported URLs (`.svg`, `.heic`, etc.) so we never
  // hand them to expo-image — Android's BitmapFactory floods logcat
  // with `unimplemented` decode errors + GC pressure when ~50 contacts
  // each fail to decode (#189).
  const showImage = !!picture && !avatarError && isSupportedImageUrl(picture);

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onPress}
      activeOpacity={onPress ? 0.6 : 1}
      testID={testID}
      accessibilityLabel={name}
      accessible
    >
      <View style={styles.avatar}>
        {showImage ? (
          <Image
            source={{ uri: picture }}
            style={styles.avatarImage}
            cachePolicy="memory-disk"
            transition={200}
            recyclingKey={picture || undefined}
            autoplay={false}
            onError={() => setAvatarError(true)}
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
      {/* Action buttons — always rendered so the row's right column has
          a stable width regardless of profile-load state. A single
          composite boolean drives `disabled`, the styling, AND the
          accessibility state for each button, so a button that's inert
          because the host didn't wire a handler is announced as disabled
          rather than as a tappable button that silently does nothing. */}
      {(() => {
        const messageDisabled = !canMessage || !onMessage;
        const zapDisabled = !canZap || !onZap;
        return (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.iconButton, messageDisabled && styles.iconButtonDisabled]}
              onPress={messageDisabled ? undefined : onMessage}
              disabled={messageDisabled}
              activeOpacity={0.6}
              accessibilityRole="button"
              accessibilityState={{ disabled: messageDisabled }}
              accessibilityLabel={
                messageDisabled
                  ? `Message ${name} (${!canMessage ? 'no Nostr key' : 'unavailable'})`
                  : `Message ${name}`
              }
              testID="contact-row-message"
            >
              <MessageCircle
                size={20}
                color={messageDisabled ? colors.textSupplementary : colors.brandPink}
                strokeWidth={2}
              />
            </TouchableOpacity>
            {/* Hidden entirely on the list for contacts with no Lightning
                address (showZap=false) — an empty spacer keeps the message
                button aligned. A shown-but-dimmed (can't-zap) button stays
                tappable when a handler is wired: the host explains *why* it
                can't zap (no wallet / no Lightning address) rather than
                silently doing nothing. Only truly inert when no handler. */}
            {showZap ? (
              <TouchableOpacity
                style={[styles.iconButton, zapDisabled && styles.iconButtonDisabled]}
                onPress={onZap}
                disabled={!onZap}
                activeOpacity={0.6}
                accessibilityRole="button"
                accessibilityState={{ disabled: !onZap }}
                accessibilityLabel={
                  zapDisabled
                    ? `Zap ${name} (${zapDisabledReason ?? 'unavailable'})`
                    : `Zap ${name}`
                }
                testID="contact-row-zap"
              >
                <Zap
                  size={20}
                  color={zapDisabled ? colors.textSupplementary : colors.brandPink}
                  fill={zapDisabled ? 'none' : colors.brandPink}
                />
              </TouchableOpacity>
            ) : (
              <View style={styles.iconButton} />
            )}
          </View>
        );
      })()}
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
    actions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    iconButton: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.brandPinkLight,
      justifyContent: 'center',
      alignItems: 'center',
    },
    iconButtonDisabled: {
      backgroundColor: colors.divider,
    },
  });

export default React.memo(ContactListItem);

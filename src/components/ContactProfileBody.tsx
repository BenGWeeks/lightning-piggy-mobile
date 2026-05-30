import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Share } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Path } from 'react-native-svg';
import FullscreenImageModal from './FullscreenImageModal';
import { Zap, UserRound, ChevronRight, Share2 } from 'lucide-react-native';
import { npubEncode } from '../services/nostrService';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';

export interface ContactProfileBodyData {
  pubkey: string | null;
  name: string;
  picture: string | null;
  banner?: string | null;
  nip05?: string | null;
  // Free-form bio from the friend's kind-0 (NIP-01 `about` field).
  // Optional because legacy callers + phone-only contacts won't have it.
  about?: string | null;
  lightningAddress: string | null;
  source: 'nostr' | 'contacts';
}

interface Props {
  contact: ContactProfileBodyData;
  onZap?: () => void;
  onMessage?: () => void;
  /** Truthy when we can actually send a zap. Requires the user to have
   * a wallet AND the contact to have a Lightning address. Caller passes
   * the boolean and the human-readable reason for the disabled-state
   * accessibility label. See ContactListItem for the row-level mirror. */
  canZap?: boolean;
  zapDisabledReason?: string;
  // Fires when the user taps "View profile" — host should dismiss the
  // sheet and navigate to the full ContactProfile route.
  onViewFullProfile?: () => void;
}

// Body of ContactProfileSheet — the bottom-sheet preview rendered when
// the user taps a contact row from Friends / Messages / Conversation /
// Group / TransactionList. The full-page ContactProfileScreen built its
// own UI (see #439), so this component is intentionally narrow: avatar,
// name, npub/Lightning toggle QR, and three action affordances —
// Message, Zap, "View profile →". Share / Open-in / NFC-write / Follow
// all live on the full-page route now.
const ContactProfileBody: React.FC<Props> = ({
  contact,
  onZap,
  onMessage,
  canZap = false,
  zapDisabledReason,
  onViewFullProfile,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const npub = useMemo(
    () => (contact.pubkey ? npubEncode(contact.pubkey) : null),
    [contact.pubkey],
  );
  const [avatarError, setAvatarError] = useState(false);
  // Tap the avatar → view the picture full screen (#661).
  const [fullscreenUrl, setFullscreenUrl] = useState<string | null>(null);

  // Share the contact via the OS share sheet — njump.me web link + a plain
  // name line. Replaces the QR box that used to live in this sheet (#666/#18).
  const handleShare = async () => {
    if (!npub) return;
    const webUrl = `https://njump.me/${npub}`;
    try {
      await Share.share({ message: `${contact.name || 'a contact'}\n${webUrl}`, url: webUrl });
    } catch {
      // User dismissed / platform rejected — nothing to surface.
    }
  };

  // Reset the error flag when the picture URL changes so a previously-failed
  // avatar gets a fresh chance. No load timeout: expo-image shows the image
  // when ready and fires onError on a genuine failure — the old 8s timeout
  // misfired (flipped to the default icon even while the image was displayed,
  // because onLoad doesn't reliably fire for cached images). Matches
  // ContactListItem's avatar handling.
  useEffect(() => {
    setAvatarError(false);
  }, [contact.picture]);

  return (
    <View style={styles.sheetContent}>
      <View style={styles.bannerContainer}>
        {/* When the contact has no kind-0 banner, fall back to a solid brand
            violet (#9B40FF) rather than the white-background ostrich texture —
            the white read as a broken/empty band in this sheet (#18). */}
        {contact.banner ? (
          <Image
            source={{ uri: contact.banner }}
            style={styles.bannerImage}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={contact.banner}
            autoplay={false}
          />
        ) : (
          <View style={[styles.bannerImage, styles.bannerFallback]}>
            <Image
              source={require('../../assets/images/banner-ostriches.png')}
              style={styles.bannerImage}
              contentFit="cover"
            />
          </View>
        )}
        <View style={styles.handleOverlay}>
          <View style={styles.handleBar} />
        </View>
      </View>

      <View style={styles.avatarContainer}>
        {contact.picture && !avatarError ? (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => setFullscreenUrl(contact.picture)}
            accessibilityRole="imagebutton"
            accessibilityLabel="View profile picture full screen"
            testID="profile-avatar-fullscreen"
          >
            <Image
              source={{ uri: contact.picture }}
              style={styles.avatar}
              cachePolicy="memory-disk"
              recyclingKey={contact.picture}
              autoplay={false}
              transition={200}
              onError={() => setAvatarError(true)}
            />
          </TouchableOpacity>
        ) : (
          <View style={styles.avatarDefault}>
            <UserRound size={40} color={colors.textBody} strokeWidth={1.5} />
          </View>
        )}
      </View>

      <FullscreenImageModal url={fullscreenUrl} onClose={() => setFullscreenUrl(null)} />

      <Text style={styles.name} numberOfLines={1}>
        {contact.name}
      </Text>

      {contact.nip05 ? (
        <Text style={styles.nip05} numberOfLines={1}>
          {contact.nip05}
        </Text>
      ) : null}

      {contact.about ? (
        <Text style={styles.about} numberOfLines={3} testID="contact-profile-about">
          {contact.about.trim()}
        </Text>
      ) : null}

      {/* The npub/Lightning QR box was dropped from this quick sheet to keep it
          compact — sharing now lives in the action row's Share button, and the
          full QR is still on the "View profile" page (#666/#18). */}

      {/* Action buttons — always rendered; disabled state when the
          per-button precondition isn't met. The accessibility labels
          disclose *why* a button is disabled (no Nostr key / no
          Lightning address) so power and screen-reader users get the
          full context instead of a silently inert circle. */}
      <View style={styles.actionRowSheet}>
        {/* Compose the same boolean for `disabled` and `accessibilityState`
            so a button that's inert because the host didn't wire a
            handler is announced as disabled to screen readers (instead
            of being read out as a tappable button that silently does
            nothing on press). Same alignment applied to the zap button. */}
        {(() => {
          const messageDisabled = !contact.pubkey || !onMessage;
          return (
            <TouchableOpacity
              style={[styles.iconCircleButton, messageDisabled && styles.iconCircleButtonDisabled]}
              onPress={messageDisabled ? undefined : onMessage}
              disabled={messageDisabled}
              accessibilityRole="button"
              accessibilityState={{ disabled: messageDisabled }}
              accessibilityLabel={
                messageDisabled
                  ? `Message (${!contact.pubkey ? 'no Nostr key' : 'unavailable'})`
                  : 'Message'
              }
              testID="contact-message-button"
            >
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
                  stroke={messageDisabled ? colors.textSupplementary : colors.white}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </TouchableOpacity>
          );
        })()}
        {(() => {
          const zapDisabled = !canZap || !onZap;
          // Dimmed-but-tappable when a handler is wired: tapping a greyed zap
          // explains *why* (no wallet / no Lightning address) via the host
          // rather than doing nothing. Only inert when no handler at all.
          return (
            <TouchableOpacity
              style={[
                styles.iconCircleButton,
                styles.iconCircleButtonYellow,
                zapDisabled && styles.iconCircleButtonDisabled,
              ]}
              onPress={onZap}
              disabled={!onZap}
              accessibilityRole="button"
              accessibilityState={{ disabled: !onZap }}
              accessibilityLabel={
                zapDisabled ? `Zap (${zapDisabledReason ?? 'unavailable'})` : 'Zap'
              }
              testID="profile-sheet-zap-button"
            >
              <Zap
                size={20}
                color={zapDisabled ? colors.textSupplementary : colors.white}
                fill={zapDisabled ? 'none' : colors.white}
              />
            </TouchableOpacity>
          );
        })()}
        <TouchableOpacity
          style={[styles.iconCircleButton, !npub && styles.iconCircleButtonDisabled]}
          onPress={npub ? handleShare : undefined}
          disabled={!npub}
          accessibilityRole="button"
          accessibilityState={{ disabled: !npub }}
          accessibilityLabel={npub ? 'Share contact' : 'Share (no Nostr key)'}
          testID="contact-share-button"
        >
          <Share2
            size={20}
            color={npub ? colors.white : colors.textSupplementary}
            strokeWidth={2}
          />
        </TouchableOpacity>
        {onViewFullProfile ? (
          <TouchableOpacity
            style={styles.viewProfileButton}
            onPress={onViewFullProfile}
            accessibilityLabel="View full profile"
            testID="contact-view-full-profile"
          >
            <Text style={styles.viewProfileButtonText}>View profile</Text>
            <ChevronRight size={16} color={colors.white} strokeWidth={2.5} />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    sheetContent: {
      alignItems: 'center',
      // 32 matches the other dynamic-sized sheets (AccountSwitcherSheet) so the
      // bottom gap is consistent — the old 80 left a big white margin once the
      // sheet switched to content-based dynamic sizing (#18).
      paddingBottom: 32,
    },
    handleOverlay: {
      position: 'absolute',
      top: 8,
      left: 0,
      right: 0,
      alignItems: 'center',
    },
    handleBar: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: 'rgba(255,255,255,0.6)',
    },
    bannerContainer: {
      width: '100%',
      height: 100,
      backgroundColor: colors.brandPinkLight,
      overflow: 'hidden',
      // Match the sheet's 24px top corners (ContactProfileSheet.sheetBackground)
      // so the banner doesn't square off the rounded sheet (#18).
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
    },
    bannerImage: {
      width: '100%',
      height: '100%',
    },
    // Solid brand violet (#9B40FF) used when the contact has no kind-0 banner.
    bannerFallback: {
      backgroundColor: colors.brandPurple,
    },
    avatarContainer: {
      marginTop: -36,
      width: 88,
      height: 88,
      borderRadius: 44,
      backgroundColor: colors.surface,
      padding: 4,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatar: {
      width: 80,
      height: 80,
      borderRadius: 40,
    },
    avatarDefault: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    name: {
      fontSize: 18,
      fontWeight: '800',
      color: colors.textHeader,
      textAlign: 'center',
      marginTop: 12,
      paddingHorizontal: 24,
    },
    nip05: {
      fontSize: 13,
      color: colors.textSupplementary,
      textAlign: 'center',
      marginTop: 2,
      paddingHorizontal: 24,
    },
    about: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.textBody,
      textAlign: 'center',
      marginTop: 10,
      paddingHorizontal: 28,
    },
    qrToggleWrapper: {
      alignSelf: 'stretch',
      paddingHorizontal: 4,
      marginTop: 8,
    },
    actionRowSheet: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 16,
      paddingVertical: 12,
      marginTop: 4,
    },
    iconCircleButton: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: colors.brandPink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconCircleButtonDisabled: {
      backgroundColor: colors.divider,
    },
    iconCircleButtonYellow: {
      backgroundColor: colors.zapYellow,
    },
    viewProfileButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      height: 52,
      paddingHorizontal: 18,
      borderRadius: 26,
      backgroundColor: colors.brandPink,
    },
    viewProfileButtonText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.white,
    },
  });

export default ContactProfileBody;

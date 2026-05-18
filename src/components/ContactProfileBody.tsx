import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Path } from 'react-native-svg';
import QrWithIdentityToggle from './QrWithIdentityToggle';
import { Zap, UserRound, ChevronRight } from 'lucide-react-native';
import { isNfcSupported } from '../services/nfcService';
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
  const [avatarLoaded, setAvatarLoaded] = useState(false);
  const [nfcSupported, setNfcSupported] = useState(false);

  // Probe NFC capability once on mount so the QR toggle's "Write to NFC"
  // affordance can render correctly enabled / disabled.
  useEffect(() => {
    let cancelled = false;
    isNfcSupported().then((ok) => {
      if (!cancelled) setNfcSupported(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fallback to default avatar if the picture URL hasn't loaded in 8s.
  useEffect(() => {
    if (!contact.picture || avatarLoaded || avatarError) return;
    const timer = setTimeout(() => {
      if (!avatarLoaded) setAvatarError(true);
    }, 8000);
    return () => clearTimeout(timer);
  }, [contact.picture, avatarLoaded, avatarError]);

  useEffect(() => {
    setAvatarError(false);
    setAvatarLoaded(false);
  }, [contact.picture]);

  return (
    <View style={styles.sheetContent}>
      <View style={styles.bannerContainer}>
        {/* Fall back to the brand pink-ostrich texture when the contact
            has no kind-0 banner — matches the full-page ContactProfileScreen.
            The empty placeholder used to render as a flat dark band,
            which read as a broken image. */}
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
          <Image
            source={require('../../assets/images/friends-bg.png')}
            style={styles.bannerImage}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        )}
        <View style={styles.handleOverlay}>
          <View style={styles.handleBar} />
        </View>
      </View>

      <View style={styles.avatarContainer}>
        {contact.picture && !avatarError ? (
          <Image
            source={{ uri: contact.picture }}
            style={styles.avatar}
            cachePolicy="memory-disk"
            recyclingKey={contact.picture}
            autoplay={false}
            transition={200}
            onError={() => setAvatarError(true)}
            onLoad={() => setAvatarLoaded(true)}
          />
        ) : (
          <View style={styles.avatarDefault}>
            <UserRound size={40} color={colors.textBody} strokeWidth={1.5} />
          </View>
        )}
      </View>

      <Text style={styles.name} numberOfLines={1}>
        {contact.name}
      </Text>

      {contact.nip05 ? (
        <Text style={styles.nip05} numberOfLines={1}>
          {contact.nip05}
        </Text>
      ) : null}

      {npub ? (
        <View style={styles.qrToggleWrapper}>
          <QrWithIdentityToggle
            npub={npub}
            lightningAddress={contact.lightningAddress}
            nfcSupported={nfcSupported}
          />
        </View>
      ) : null}

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
          return (
            <TouchableOpacity
              style={[
                styles.iconCircleButton,
                styles.iconCircleButtonYellow,
                zapDisabled && styles.iconCircleButtonDisabled,
              ]}
              onPress={zapDisabled ? undefined : onZap}
              disabled={zapDisabled}
              accessibilityRole="button"
              accessibilityState={{ disabled: zapDisabled }}
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
      // 80 leaves clear breathing room above the Android gesture-nav
      // bar — the previous 40 was tight enough that the View-profile
      // pill sat almost flush with the bar on a Pixel 8a.
      paddingBottom: 80,
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
    },
    bannerImage: {
      width: '100%',
      height: '100%',
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

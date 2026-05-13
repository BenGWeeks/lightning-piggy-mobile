import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking, Share } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Path } from 'react-native-svg';
import QrWithIdentityToggle from './QrWithIdentityToggle';
import { Zap, UserRound, ChevronRight } from 'lucide-react-native';
import NfcWriteSheet from './NfcWriteSheet';
import ContactActionsSheet from './ContactActionsSheet';
import { isNfcSupported } from '../services/nfcService';
import Toast from './BrandedToast';
import { npubEncode, nprofileEncode, buildProfileRelayHints } from '../services/nostrService';
import { useNostr } from '../contexts/NostrContext';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import FriendPickerSheet, { PickedFriend } from './FriendPickerSheet';

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
  // Fired when an action wants the host sheet to dismiss itself —
  // e.g. share-via-DM completes.
  onRequestClose?: () => void;
  // Fires when the user taps "View profile" — host should dismiss the
  // sheet and navigate to the full ContactProfile route.
  onViewFullProfile?: () => void;
}

// Body of ContactProfileSheet — the bottom-sheet preview rendered when
// the user taps a contact row from Friends / Messages / Conversation /
// Group / TransactionList. The full-page ContactProfileScreen built its
// own UI (see #439) so this component is sheet-only; an earlier
// `variant` prop is gone (#439 review round-4).
const ContactProfileBody: React.FC<Props> = ({
  contact,
  onZap,
  onMessage,
  onRequestClose,
  onViewFullProfile,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const npub = useMemo(
    () => (contact.pubkey ? npubEncode(contact.pubkey) : null),
    [contact.pubkey],
  );
  const { contacts, sendDirectMessage, relays } = useNostr();
  const [avatarError, setAvatarError] = useState(false);
  const [avatarLoaded, setAvatarLoaded] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [nfcWriteVisible, setNfcWriteVisible] = useState(false);
  const [nfcSupported, setNfcSupported] = useState(false);
  const [actionsSheetOpen, setActionsSheetOpen] = useState(false);

  // Probe NFC capability once on mount.
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

  // "Share to friend" — opens the FriendPicker so the user can DM the
  // contact card as an encrypted Nostr message.
  const handleShareToFriendOpen = useCallback(() => {
    if (!contact.pubkey) return;
    setShareOpen(true);
  }, [contact.pubkey]);

  // "Share" — OS share sheet (other apps, clipboard, etc). The Nostr URI
  // is the primary handle; we include a friendly label so apps that just
  // surface the message-string (eg Signal) have human-readable context.
  const handleOsShare = useCallback(async () => {
    if (!contact.pubkey || !npub) return;
    const readRelays = relays.filter((r) => r.read).map((r) => r.url);
    const relayHints = buildProfileRelayHints(contact.pubkey, contacts, readRelays);
    const nprofile = nprofileEncode(contact.pubkey, relayHints);
    const label = contact.name || 'a contact';
    const nostrUri = `nostr:${nprofile}`;
    const webUrl = `https://njump.me/${npub}`;
    try {
      await Share.share({
        message: `${label}\n${nostrUri}\n${webUrl}`,
        url: webUrl,
      });
    } catch {
      // User dismissed or platform rejected — nothing actionable to surface.
    }
  }, [contact.pubkey, contact.name, npub, contacts, relays]);

  const handleShareToFriend = useCallback(
    async (friend: PickedFriend) => {
      if (!contact.pubkey || sharing) return;
      setSharing(true);
      setShareOpen(false);
      try {
        const readRelays = relays.filter((r) => r.read).map((r) => r.url);
        const relayHints = buildProfileRelayHints(contact.pubkey, contacts, readRelays);
        const nprofile = nprofileEncode(contact.pubkey, relayHints);
        const label = contact.name || 'a contact';
        const payload = `Shared contact: ${label}\nnostr:${nprofile}`;
        const result = await sendDirectMessage(friend.pubkey, payload);
        if (!result.success) {
          Toast.show({
            type: 'error',
            text1: 'Share failed',
            text2: result.error ?? 'Could not share contact.',
            position: 'top',
            visibilityTime: 4000,
          });
          return;
        }
        Toast.show({
          type: 'success',
          text1: `${label} shared with ${friend.name}`,
          position: 'top',
          visibilityTime: 2500,
        });
        onRequestClose?.();
      } finally {
        setSharing(false);
      }
    },
    [contact.pubkey, contact.name, sharing, sendDirectMessage, onRequestClose, contacts, relays],
  );

  const handleViewProfile = useCallback(async () => {
    if (!npub) return;
    const nostrUri = `nostr:${npub}`;
    const canOpen = await Linking.canOpenURL(nostrUri);
    if (canOpen) {
      Linking.openURL(nostrUri);
    } else {
      Linking.openURL(`https://primal.net/p/${npub}`);
    }
  }, [npub]);

  // Don't wrap children in an inline-defined component — that would
  // give the wrapper a fresh function identity per render and force
  // React to unmount/remount the entire subtree on every parent
  // re-render (losing scroll position, in-flight image loads, focused
  // inputs). Render the wrapper element directly.
  const body = (
    <>
      <View style={styles.bannerContainer}>
        {/* Fall back to the brand pink-ostrich texture when the
              contact has no kind-0 banner — matches the full-page
              ContactProfileScreen. The empty placeholder used to
              render as a flat dark band, which read as a broken
              image. */}
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

      {contact.nip05 && (
        <Text style={styles.nip05} numberOfLines={1}>
          {contact.nip05}
        </Text>
      )}

      {/* QR + identity toggle. Sheet variant reuses the shared
          QrWithIdentityToggle (same tabs + copy/share/NFC affordance
          as QrSheet) so the friend's npub and Lightning address are
          both scannable. */}
      {npub ? (
        <View style={styles.qrToggleWrapper}>
          <QrWithIdentityToggle
            npub={npub}
            lightningAddress={contact.lightningAddress}
            nfcSupported={nfcSupported}
            onNfcWrite={() => setNfcWriteVisible(true)}
          />
        </View>
      ) : null}

      {/* Pared-down peek — Message + Zap + View-profile pill. The
          View-profile button drills into the full ContactProfile route
          where the richer Follow / "…" actions live. */}
      <View style={styles.actionRowSheet}>
        {contact.pubkey && onMessage ? (
          <TouchableOpacity
            style={styles.iconCircleButton}
            onPress={onMessage}
            accessibilityLabel="Message"
            testID="contact-message-button"
          >
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
              <Path
                d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
                stroke={colors.white}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </TouchableOpacity>
        ) : null}
        {contact.lightningAddress && onZap ? (
          <TouchableOpacity
            style={[styles.iconCircleButton, styles.iconCircleButtonYellow]}
            onPress={onZap}
            accessibilityLabel="Zap"
            testID="profile-sheet-zap-button"
          >
            <Zap size={20} color={colors.white} fill={colors.white} />
          </TouchableOpacity>
        ) : null}
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

      {npub && (
        <NfcWriteSheet
          visible={nfcWriteVisible}
          onClose={() => setNfcWriteVisible(false)}
          npub={npub}
          displayName={contact.name}
        />
      )}

      <FriendPickerSheet
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        onSelect={handleShareToFriend}
        title={`Share ${contact.name || 'contact'}`}
        subtitle="They'll receive an encrypted Nostr DM with a person card."
      />

      <ContactActionsSheet
        visible={actionsSheetOpen}
        onClose={() => setActionsSheetOpen(false)}
        onShare={handleOsShare}
        onOpenIn={handleViewProfile}
        onShareToFriend={handleShareToFriendOpen}
        onWriteToNfc={() => setNfcWriteVisible(true)}
        nfcSupported={nfcSupported}
      />
    </>
  );

  return <View style={styles.sheetContent}>{body}</View>;
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
    screenContent: {
      alignItems: 'center',
      paddingBottom: 48,
    },
    handleOverlay: {
      position: 'absolute',
      top: 8,
      left: 0,
      right: 0,
      zIndex: 1,
      alignItems: 'center',
    },
    handleBar: {
      width: 40,
      height: 5,
      borderRadius: 3,
      backgroundColor: 'rgba(255,255,255,0.7)',
    },
    bannerContainer: {
      width: '100%',
      height: 120,
      overflow: 'hidden',
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
    },
    screenBannerContainer: {
      width: '100%',
      height: 140,
      overflow: 'hidden',
    },
    bannerImage: {
      width: '100%',
      height: '100%',
    },
    bannerPlaceholder: {
      width: '100%',
      height: 120,
      backgroundColor: colors.brandPink,
      opacity: 0.15,
    },
    avatarContainer: {
      marginTop: -36,
      borderRadius: 39,
      borderWidth: 3,
      borderColor: colors.white,
      overflow: 'hidden',
      backgroundColor: colors.background,
    },
    avatarContainerNoBanner: {
      marginTop: 24,
      borderRadius: 39,
      borderWidth: 3,
      borderColor: colors.white,
      overflow: 'hidden',
      backgroundColor: colors.background,
    },
    avatar: {
      width: 72,
      height: 72,
      borderRadius: 36,
    },
    avatarDefault: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: colors.background,
      justifyContent: 'center',
      alignItems: 'center',
    },
    name: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.textHeader,
      marginTop: 8,
      paddingHorizontal: 24,
      maxWidth: '100%',
    },
    nip05: {
      fontSize: 13,
      color: colors.brandPink,
      marginTop: 2,
    },
    qrContainer: {
      marginTop: 12,
      padding: 12,
      backgroundColor: colors.white,
      borderRadius: 12,
    },
    npubRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 6,
      backgroundColor: colors.background,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
    },
    npubText: {
      fontSize: 12,
      color: colors.textSupplementary,
      fontWeight: '500',
    },
    lightningAddress: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginTop: 4,
      paddingHorizontal: 24,
      maxWidth: '100%',
    },
    lnAddressRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 4,
      paddingHorizontal: 24,
    },
    lnAddressEditRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 8,
      paddingHorizontal: 24,
    },
    lnAddressInput: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.brandPinkLight,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      fontSize: 14,
      color: colors.textHeader,
    },
    lnAddressSaveButton: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: colors.brandPink,
    },
    lnAddressSaveText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.white,
    },
    actionRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: 8,
      marginTop: 20,
      paddingHorizontal: 16,
      // alignSelf:'stretch' so flexWrap triggers — without it the row
      // shrinks to its children and never wraps.
      alignSelf: 'stretch',
    },
    followButton: {
      flexShrink: 1,
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: colors.brandPink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    followingButton: {
      backgroundColor: colors.brandPinkLight,
      borderColor: colors.brandPinkLight,
    },
    followButtonText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.brandPink,
    },
    followingButtonText: {
      color: colors.brandPink,
    },
    zapButton: {
      flexDirection: 'row',
      flexShrink: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderRadius: 10,
      backgroundColor: colors.brandPink,
    },
    zapButtonText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.white,
    },
    messageButton: {
      flexDirection: 'row',
      flexShrink: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderRadius: 10,
      backgroundColor: colors.brandPink,
    },
    messageButtonText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.white,
    },
    iconButton: {
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: colors.brandPink,
      justifyContent: 'center',
      alignItems: 'center',
    },
    iconButtonDisabled: {
      borderColor: colors.textSupplementary,
      opacity: 0.6,
    },
    qrToggleWrapper: {
      // Override the sheetContent's `alignItems: 'center'` so the
      // QrWithIdentityToggle's pink-bordered card stretches edge-to-
      // edge inside the sheet (with the standard 20 px sheet inset on
      // each side). QR itself stays a fixed size — the box widens
      // around it.
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

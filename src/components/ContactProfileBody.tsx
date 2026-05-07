import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Linking,
  ScrollView,
} from 'react-native';
import { Alert } from './BrandedAlert';
import { Image } from 'expo-image';
import Svg, { Path } from 'react-native-svg';
import QRCode from 'react-native-qrcode-svg';
import { Zap, Copy, Share2, UserRound } from 'lucide-react-native';
import NfcIcon from './icons/NfcIcon';
import NfcWriteSheet from './NfcWriteSheet';
import { isNfcSupported } from '../services/nfcService';
import * as Clipboard from 'expo-clipboard';
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
  // Layout flag: the bottom-sheet variant renders the banner with a
  // pull-handle overlay; the full-page screen omits both because the
  // screen has its own header bar.
  variant: 'sheet' | 'screen';
  onZap?: () => void;
  onMessage?: () => void;
  onSetLightningAddress?: (address: string) => void;
  // Fired when an action wants the host (sheet) to dismiss itself —
  // e.g. share-via-DM completes. Screens ignore this.
  onRequestClose?: () => void;
}

const ContactProfileBody: React.FC<Props> = ({
  contact,
  variant,
  onZap,
  onMessage,
  onSetLightningAddress,
  onRequestClose,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const npub = useMemo(
    () => (contact.pubkey ? npubEncode(contact.pubkey) : null),
    [contact.pubkey],
  );
  const { contacts, followContact, unfollowContact, sendDirectMessage, relays } = useNostr();
  const [following, setFollowing] = useState(false);
  const [loadingFollow, setLoadingFollow] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const [avatarLoaded, setAvatarLoaded] = useState(false);
  const [editingLnAddress, setEditingLnAddress] = useState(false);
  const [lnAddressDraft, setLnAddressDraft] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [nfcWriteVisible, setNfcWriteVisible] = useState(false);
  const [nfcSupported, setNfcSupported] = useState(false);

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
    if (contact.pubkey) {
      setFollowing(contacts.some((c) => c.pubkey === contact.pubkey));
    }
  }, [contact.pubkey, contacts]);

  useEffect(() => {
    setAvatarError(false);
    setAvatarLoaded(false);
  }, [contact.picture]);

  useEffect(() => {
    setEditingLnAddress(false);
    setLnAddressDraft(contact.lightningAddress ?? '');
  }, [contact.name, contact.lightningAddress]);

  const handleFollowToggle = async () => {
    if (!contact.pubkey || loadingFollow) return;
    setLoadingFollow(true);
    try {
      if (following) {
        Alert.alert('Unfollow', `Stop following ${contact.name}?`, [
          { text: 'Cancel', style: 'cancel', onPress: () => setLoadingFollow(false) },
          {
            text: 'Unfollow',
            style: 'destructive',
            onPress: async () => {
              const success = await unfollowContact(contact.pubkey!);
              if (success) setFollowing(false);
              setLoadingFollow(false);
            },
          },
        ]);
      } else {
        const success = await followContact(contact.pubkey);
        if (success) setFollowing(true);
        setLoadingFollow(false);
      }
    } catch {
      setLoadingFollow(false);
    }
  };

  const handleCopyNpub = async () => {
    if (!npub) return;
    await Clipboard.setStringAsync(npub);
    Toast.show({
      type: 'success',
      text1: 'Public key copied',
      position: 'top',
      visibilityTime: 1800,
    });
  };

  const handleCopyLnAddress = async () => {
    if (!contact.lightningAddress) return;
    await Clipboard.setStringAsync(contact.lightningAddress);
    Toast.show({
      type: 'success',
      text1: 'Lightning address copied',
      position: 'top',
      visibilityTime: 1800,
    });
  };

  const handleShare = useCallback(() => {
    if (!contact.pubkey) return;
    setShareOpen(true);
  }, [contact.pubkey]);

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

  const npubDisplay = npub ? `${npub.slice(0, 16)}...${npub.slice(-8)}` : null;

  const Container: React.ComponentType<{ children: React.ReactNode }> =
    variant === 'screen'
      ? ({ children }) => (
          <ScrollView
            contentContainerStyle={styles.screenContent}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        )
      : ({ children }) => <View style={styles.sheetContent}>{children}</View>;

  return (
    <Container>
      {variant === 'sheet' && (
        <View style={styles.bannerContainer}>
          {contact.banner ? (
            <Image source={{ uri: contact.banner }} style={styles.bannerImage} cachePolicy="disk" />
          ) : (
            <View style={styles.bannerPlaceholder} />
          )}
          <View style={styles.handleOverlay}>
            <View style={styles.handleBar} />
          </View>
        </View>
      )}

      {variant === 'screen' && contact.banner && (
        <View style={styles.screenBannerContainer}>
          <Image source={{ uri: contact.banner }} style={styles.bannerImage} cachePolicy="disk" />
        </View>
      )}

      <View
        style={
          variant === 'screen' && !contact.banner
            ? styles.avatarContainerNoBanner
            : styles.avatarContainer
        }
      >
        {contact.picture && !avatarError ? (
          <Image
            source={{ uri: contact.picture }}
            style={styles.avatar}
            cachePolicy="disk"
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

      {npub && (
        <View
          style={styles.qrContainer}
          accessible
          accessibilityRole="image"
          accessibilityLabel="Friend npub QR code"
        >
          <QRCode value={`nostr:${npub}`} size={160} backgroundColor="#FFFFFF" color="#000000" />
        </View>
      )}

      {npubDisplay && (
        <TouchableOpacity
          style={styles.npubRow}
          onPress={handleCopyNpub}
          accessibilityLabel="Copy npub"
          testID="contact-copy-npub-button"
        >
          <Text style={styles.npubText}>{npubDisplay}</Text>
          <Copy size={20} color={colors.brandPink} />
        </TouchableOpacity>
      )}

      {contact.source === 'contacts' && onSetLightningAddress ? (
        editingLnAddress ? (
          <View style={styles.lnAddressEditRow}>
            <TextInput
              style={styles.lnAddressInput}
              placeholder="user@domain.com"
              placeholderTextColor={colors.textSupplementary}
              value={lnAddressDraft}
              onChangeText={setLnAddressDraft}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
            />
            <TouchableOpacity
              style={styles.lnAddressSaveButton}
              onPress={() => {
                const trimmed = lnAddressDraft.trim();
                if (trimmed) {
                  onSetLightningAddress(trimmed);
                }
                setEditingLnAddress(false);
              }}
            >
              <Text style={styles.lnAddressSaveText}>
                {lnAddressDraft.trim() ? 'Save' : 'Cancel'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.lnAddressRow}
            onPress={() => {
              setLnAddressDraft(contact.lightningAddress ?? '');
              setEditingLnAddress(true);
            }}
          >
            <Text style={styles.lightningAddress} numberOfLines={1}>
              {contact.lightningAddress || 'Add Lightning Address'}
            </Text>
            <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
              <Path
                d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
                stroke={colors.brandPink}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </TouchableOpacity>
        )
      ) : contact.lightningAddress ? (
        <TouchableOpacity
          style={styles.lnAddressRow}
          onPress={handleCopyLnAddress}
          accessibilityLabel="Copy Lightning address"
          testID="contact-copy-lud16-button"
        >
          <Text style={styles.lightningAddress} numberOfLines={1}>
            {contact.lightningAddress}
          </Text>
          <Copy size={14} color={colors.brandPink} />
        </TouchableOpacity>
      ) : null}

      <View style={styles.actionRow}>
        {contact.pubkey && contact.source === 'nostr' && (
          <TouchableOpacity
            style={[styles.followButton, following && styles.followingButton]}
            onPress={handleFollowToggle}
            disabled={loadingFollow}
            accessibilityLabel={following ? 'Unfollow' : 'Follow'}
            testID="profile-sheet-follow-button"
          >
            <Text
              style={[styles.followButtonText, following && styles.followingButtonText]}
              numberOfLines={1}
            >
              {loadingFollow ? '...' : following ? 'Unfollow' : 'Follow'}
            </Text>
          </TouchableOpacity>
        )}
        {contact.pubkey && onMessage && (
          <TouchableOpacity
            style={styles.messageButton}
            onPress={onMessage}
            accessibilityLabel="Message"
            testID="contact-message-button"
          >
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path
                d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
                stroke={colors.white}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
            <Text style={styles.messageButtonText} numberOfLines={1}>
              Message
            </Text>
          </TouchableOpacity>
        )}
        {contact.lightningAddress && onZap && (
          <TouchableOpacity
            style={styles.zapButton}
            onPress={onZap}
            accessibilityLabel="Zap"
            testID="profile-sheet-zap-button"
          >
            <Zap size={20} color={colors.white} fill={colors.white} />
            <Text style={styles.zapButtonText} numberOfLines={1}>
              Zap
            </Text>
          </TouchableOpacity>
        )}
        {contact.pubkey && (
          <TouchableOpacity
            style={styles.iconButton}
            onPress={handleShare}
            disabled={sharing}
            accessibilityLabel="Share contact"
            testID="contact-share-button"
          >
            <Share2 size={18} color={colors.brandPink} />
          </TouchableOpacity>
        )}
        {contact.pubkey && (
          <TouchableOpacity
            style={styles.iconButton}
            onPress={handleViewProfile}
            accessibilityLabel="Open in external client"
            testID="contact-view-profile-button"
          >
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path
                d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"
                stroke={colors.brandPink}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </TouchableOpacity>
        )}
        {contact.pubkey && (
          <TouchableOpacity
            style={[styles.iconButton, !nfcSupported && styles.iconButtonDisabled]}
            onPress={() => setNfcWriteVisible(true)}
            disabled={!nfcSupported}
            accessibilityLabel={
              nfcSupported ? 'Write to NFC tag' : 'Write to NFC tag (not supported on this device)'
            }
            accessibilityState={{ disabled: !nfcSupported }}
            testID="contact-nfc-write-button"
          >
            <NfcIcon size={18} color={nfcSupported ? colors.brandPink : colors.textSupplementary} />
          </TouchableOpacity>
        )}
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
    </Container>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    sheetContent: {
      alignItems: 'center',
      paddingBottom: 40,
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
  });

export default ContactProfileBody;

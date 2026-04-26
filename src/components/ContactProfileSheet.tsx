import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  BackHandler,
  Alert,
  Linking,
} from 'react-native';
import { Image } from 'expo-image';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import Svg, { Circle, Path } from 'react-native-svg';
import { Zap, Copy, Share2, UserRound } from 'lucide-react-native';
import NfcIcon from './icons/NfcIcon';
import NfcWriteSheet from './NfcWriteSheet';
import { isNfcSupported } from '../services/nfcService';
import * as Clipboard from 'expo-clipboard';
import Toast from 'react-native-toast-message';
import { npubEncode, nprofileEncode, buildProfileRelayHints } from '../services/nostrService';
import { useNostr } from '../contexts/NostrContext';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import FriendPickerSheet, { PickedFriend } from './FriendPickerSheet';

interface ContactData {
  pubkey: string | null;
  name: string;
  picture: string | null;
  banner?: string | null;
  nip05?: string | null;
  lightningAddress: string | null;
  source: 'nostr' | 'contacts';
}

interface Props {
  visible: boolean;
  onClose: () => void;
  contact: ContactData | null;
  onZap?: () => void;
  onMessage?: () => void;
  onSetLightningAddress?: (address: string) => void;
}

const ContactProfileSheet: React.FC<Props> = ({
  visible,
  onClose,
  contact,
  onZap,
  onMessage,
  onSetLightningAddress,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const sheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ['55%'], []);
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
  // Probe device NFC capability once when the sheet opens. Hide the
  // NFC tile entirely if the hardware isn't there (or expo-go's NFC
  // shim returns false in dev) — no point teasing a feature that
  // can't fire on this device.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    isNfcSupported().then((ok) => {
      if (!cancelled) setNfcSupported(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  // Timeout: if image hasn't loaded in 8s, show fallback
  useEffect(() => {
    if (!contact?.picture || avatarLoaded || avatarError) return;
    const timer = setTimeout(() => {
      if (!avatarLoaded) setAvatarError(true);
    }, 8000);
    return () => clearTimeout(timer);
  }, [contact?.picture, avatarLoaded, avatarError]);

  // Update follow state when contacts list changes
  useEffect(() => {
    if (contact?.pubkey) {
      setFollowing(contacts.some((c) => c.pubkey === contact.pubkey));
    }
  }, [contact?.pubkey, contacts]);

  // Reset avatar state only when the picture URL changes
  useEffect(() => {
    setAvatarError(false);
    setAvatarLoaded(false);
  }, [contact?.picture]);

  // Reset lightning address editing state when contact changes
  useEffect(() => {
    setEditingLnAddress(false);
    setLnAddressDraft(contact?.lightningAddress ?? '');
  }, [contact?.name, contact?.lightningAddress]);

  useEffect(() => {
    if (visible) {
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
    ),
    [],
  );

  const handleFollowToggle = async () => {
    if (!contact?.pubkey || loadingFollow) return;
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
    if (!contact?.pubkey) return;
    await Clipboard.setStringAsync(npubEncode(contact.pubkey));
  };

  const handleShare = useCallback(() => {
    if (!contact?.pubkey) return;
    setShareOpen(true);
  }, [contact?.pubkey]);

  const handleShareToFriend = useCallback(
    async (friend: PickedFriend) => {
      if (!contact?.pubkey || sharing) return;
      setSharing(true);
      setShareOpen(false);
      try {
        // NIP-19 nprofile includes relay hints so the receiving client can
        // find the shared person's profile without searching every relay.
        // Prefixing with `nostr:` (NIP-21) means any conforming client
        // — Damus, Amethyst, Primal, Coracle, 0xchat — renders it as a
        // clickable profile mention. The human-readable first line is a
        // fallback for clients that don't unfurl the URI.
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
        onClose();
      } finally {
        setSharing(false);
      }
    },
    [contact?.pubkey, contact?.name, sharing, sendDirectMessage, onClose, contacts, relays],
  );

  const handleViewProfile = useCallback(async () => {
    if (!contact?.pubkey) return;
    const npub = npubEncode(contact.pubkey);
    // Try nostr: URI first (NIP-21), fall back to Primal web URL
    const nostrUri = `nostr:${npub}`;
    const canOpen = await Linking.canOpenURL(nostrUri);
    if (canOpen) {
      Linking.openURL(nostrUri);
    } else {
      Linking.openURL(`https://primal.net/p/${npub}`);
    }
  }, [contact?.pubkey]);

  if (!contact) return null;

  const npubDisplay = contact.pubkey
    ? (() => {
        const full = npubEncode(contact.pubkey);
        return `${full.slice(0, 16)}...${full.slice(-8)}`;
      })()
    : null;

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      onDismiss={onClose}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleComponent={() => null}
    >
      <BottomSheetView style={styles.content}>
        {/* Banner with handle overlay */}
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

        {/* Avatar */}
        <View style={styles.avatarContainer}>
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

        {/* Name */}
        <Text style={styles.name} numberOfLines={1}>
          {contact.name}
        </Text>

        {/* NIP-05 */}
        {contact.nip05 && (
          <Text style={styles.nip05} numberOfLines={1}>
            {contact.nip05}
          </Text>
        )}

        {/* npub */}
        {npubDisplay && (
          <TouchableOpacity style={styles.npubRow} onPress={handleCopyNpub}>
            <Text style={styles.npubText}>{npubDisplay}</Text>
            <Copy size={20} color={colors.brandPink} />
          </TouchableOpacity>
        )}

        {/* Lightning Address */}
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
          <Text style={styles.lightningAddress} numberOfLines={1}>
            {contact.lightningAddress}
          </Text>
        ) : null}

        {/* Action buttons */}
        <View style={styles.actionRow}>
          {contact.pubkey && contact.source === 'nostr' && (
            <TouchableOpacity
              style={[styles.followButton, following && styles.followingButton]}
              onPress={handleFollowToggle}
              disabled={loadingFollow}
            >
              <Text style={[styles.followButtonText, following && styles.followingButtonText]}>
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
              <Text style={styles.messageButtonText}>Message</Text>
            </TouchableOpacity>
          )}
          {contact.lightningAddress && onZap && (
            <TouchableOpacity style={styles.zapButton} onPress={onZap}>
              <Zap size={20} color={colors.white} fill={colors.white} />
              <Text style={styles.zapButtonText}>Zap</Text>
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
          {contact.pubkey && nfcSupported && (
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => setNfcWriteVisible(true)}
              accessibilityLabel="Write to NFC tag"
              testID="contact-nfc-write-button"
            >
              <NfcIcon size={18} color={colors.brandPink} />
            </TouchableOpacity>
          )}
        </View>
        {/* Write the friend's npub (nostr:-prefixed) to a physical NFC
            tag. The friend can then tap the tag against another device
            to be added on Nostr — same payload as the existing share
            flow but routed through hardware. */}
        {contact.pubkey && (
          <NfcWriteSheet
            visible={nfcWriteVisible}
            onClose={() => setNfcWriteVisible(false)}
            npub={npubEncode(contact.pubkey)}
            displayName={contact.name}
          />
        )}
      </BottomSheetView>
      <FriendPickerSheet
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        onSelect={handleShareToFriend}
        title={`Share ${contact.name || 'contact'}`}
        subtitle="They'll receive an encrypted Nostr DM with a person card."
      />
    </BottomSheetModal>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
    },
    content: {
      alignItems: 'center',
      paddingBottom: 40,
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
    bannerImage: {
      width: '100%',
      height: 120,
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
      gap: 8,
      marginTop: 20,
      paddingHorizontal: 16,
    },
    followButton: {
      paddingHorizontal: 14,
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
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingHorizontal: 14,
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
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingHorizontal: 14,
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
  });

export default ContactProfileSheet;

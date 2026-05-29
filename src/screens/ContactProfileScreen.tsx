import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Linking,
  Share,
} from 'react-native';
import { Image } from 'expo-image';
import ContactActionsSheet from '../components/ContactActionsSheet';
import * as Clipboard from 'expo-clipboard';
import {
  ChevronLeft,
  QrCode,
  Zap,
  MessageCircle,
  MoreHorizontal,
  UserRound,
  Copy,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Alert } from '../components/BrandedAlert';
import Toast from '../components/BrandedToast';
import NfcWriteSheet from '../components/NfcWriteSheet';
import QrSheet from '../components/QrSheet';
import SendSheet from '../components/SendSheet';
import FriendNoteFeed from '../components/FriendNoteFeed';
import FriendPickerSheet, { PickedFriend } from '../components/FriendPickerSheet';
import { type ContactProfileBodyData } from '../components/ContactProfileBody';
import FullscreenImageModal from '../components/FullscreenImageModal';
import { useNostr } from '../contexts/NostrContext';
import { useWallet } from '../contexts/WalletContext';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import { isNfcSupported } from '../services/nfcService';
import {
  npubEncode,
  nprofileEncode,
  buildProfileRelayHints,
  fetchProfile,
} from '../services/nostrService';
import { setLightningAddress } from '../services/contactsService';
import type { RootStackParamList } from '../navigation/types';

type ContactProfileNavigation = NativeStackNavigationProp<RootStackParamList, 'ContactProfile'>;
type ContactProfileRoute = RouteProp<RootStackParamList, 'ContactProfile'>;

// Full-page friends profile route. Layout follows Primal/Damus
// convention: back chevron pinned top-left, identity card (banner +
// avatar + name + nip05 + lud16), an action row (QR + Zap + Message
// icons left, Follow/Unfollow pill right), description, embedded
// kind-1 feed, and a smaller secondary affordance row for share / open
// externally / NFC. The legacy sheet (ContactProfileSheet +
// ContactProfileBody) is preserved untouched for callers that still
// want a quick-glance presentation — see issue #435.
const ContactProfileScreen: React.FC = () => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<ContactProfileNavigation>();
  const route = useRoute<ContactProfileRoute>();
  const { contacts, followContact, unfollowContact, sendDirectMessage, relays } = useNostr();
  const { hasWallets } = useWallet();

  const [contact, setContact] = useState<ContactProfileBodyData>(route.params.contact);
  const [following, setFollowing] = useState(false);
  const [loadingFollow, setLoadingFollow] = useState(false);
  const [savingLnAddress, setSavingLnAddress] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  // Tap the avatar → view the picture full screen (#661 — same as the sheet).
  const [fullscreenUrl, setFullscreenUrl] = useState<string | null>(null);
  const [editingLnAddress, setEditingLnAddress] = useState(false);
  const [lnAddressDraft, setLnAddressDraft] = useState(contact.lightningAddress ?? '');
  const [sendSheetOpen, setSendSheetOpen] = useState(false);
  const [qrSheetOpen, setQrSheetOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [actionsSheetOpen, setActionsSheetOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [nfcWriteVisible, setNfcWriteVisible] = useState(false);
  const [nfcSupported, setNfcSupported] = useState(false);

  // React Navigation may reuse this screen instance and only update params
  // when navigating to ContactProfile while it's already in the stack.
  // Re-sync the local `contact` state when the param identity changes —
  // gated on `pubkey` so navigating from FriendsScreen → profile → back
  // → tap-same-friend (which builds a fresh `ContactProfileBodyData`
  // each time but with the same pubkey) doesn't blow away our locally
  // fetched `about` bio + avatar-load state.
  const paramContact = route.params.contact;
  // Use the pubkey for Nostr contacts (stable hex) and the phone
  // contact id for phone-only contacts (where pubkey is null). Without
  // the phone fallback, navigating between two different phone contacts
  // while the screen is reused would no-op (`null === null`) and keep
  // showing the previous contact's data.
  const paramIdentityKey = paramContact.pubkey ?? route.params.phoneContactId ?? null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setContact(paramContact);
  }, [paramIdentityKey]);

  const npub = useMemo(
    () => (contact.pubkey ? npubEncode(contact.pubkey) : null),
    [contact.pubkey],
  );
  const npubDisplay = npub ? `${npub.slice(0, 12)}...${npub.slice(-6)}` : null;

  // `nostr:nprofile1…` (pubkey + relay hints) to write to an NFC tag —
  // strictly more useful than a bare npub for a cold-contact scanner, who
  // can resolve this person's metadata even on niche relays (#755). Mirrors
  // the relay-hint sourcing used by the OS/DM share handlers below.
  const nprofileRef = useMemo(() => {
    if (!contact.pubkey) return undefined;
    const readRelays = relays.filter((r) => r.read).map((r) => r.url);
    const relayHints = buildProfileRelayHints(contact.pubkey, contacts, readRelays);
    return `nostr:${nprofileEncode(contact.pubkey, relayHints)}`;
  }, [contact.pubkey, contacts, relays]);

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

  // Hydrate the `about` bio from kind-0 if it wasn't passed in the
  // navigation params. Most entry points pre-build ContactProfileBodyData
  // without the bio (it isn't shown on the row item), so we lazily
  // fetch it here for the description block.
  //
  // The actual loop-breaker is `aboutFetchedFor.current === contact.pubkey` —
  // the `about !== undefined && about !== null` early-return only short-
  // circuits when a bio was passed in via params (i.e. about already set
  // to a non-null string). Users whose kind-0 omits `about` write `null`
  // back via `setContact`, which would re-trigger this effect (deps
  // include `contact.about`); the ref blocks the re-fetch.
  // Resolves the *verified* profile once per pubkey to fill in the bio AND
  // the Lightning address. The contacts-list profile has its lud16 stripped
  // (anti-redirect slimming), so this verified single-fetch is what re-arms
  // the zap button and yields a safe-to-pay address.
  const profileFetchedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!contact.pubkey) return;
    const needsAbout = contact.about === undefined || contact.about === null;
    const needsLud16 = !contact.lightningAddress;
    if (!needsAbout && !needsLud16) return;
    if (profileFetchedFor.current === contact.pubkey) return;
    profileFetchedFor.current = contact.pubkey;
    let cancelled = false;
    const readRelays = relays.filter((r) => r.read).map((r) => r.url);
    fetchProfile(contact.pubkey, readRelays)
      .then((profile) => {
        if (cancelled || !profile) return;
        setContact((prev) => ({
          ...prev,
          about: prev.about ?? profile.about ?? null,
          lightningAddress: prev.lightningAddress ?? profile.lud16 ?? null,
        }));
      })
      .catch(() => {
        // best-effort — bio + address are non-critical to first paint
      });
    return () => {
      cancelled = true;
    };
  }, [contact.pubkey, contact.about, contact.lightningAddress, relays]);

  useEffect(() => {
    if (contact.pubkey) {
      setFollowing(contacts.some((c) => c.pubkey === contact.pubkey));
    }
  }, [contact.pubkey, contacts]);

  // Reset the avatar error when the picture changes (no load timeout — rely on
  // onError, like ContactListItem; the old 8s timeout flipped a loaded cached
  // avatar to the default icon when expo-image's onLoad didn't fire).
  useEffect(() => {
    setAvatarError(false);
  }, [contact.picture]);

  useEffect(() => {
    setEditingLnAddress(false);
    setLnAddressDraft(contact.lightningAddress ?? '');
  }, [contact.name, contact.lightningAddress]);

  const handleMessage = useCallback(() => {
    if (!contact.pubkey) return;
    // `navigate` (not `replace`) so the user can back-button from
    // Conversation → Profile → previous screen. The dedupe inside the
    // Conversation route already collapses re-opens of the same DM
    // peer, so we don't worry about a profile→conversation→profile
    // bounce stacking duplicates.
    navigation.navigate('Conversation', {
      pubkey: contact.pubkey,
      name: contact.name,
      picture: contact.picture,
      lightningAddress: contact.lightningAddress,
    });
  }, [contact, navigation]);

  const handleZap = useCallback(async () => {
    if (!hasWallets) {
      Alert.alert('No wallet attached', 'Connect a Lightning wallet first to send zaps.');
      return;
    }
    let address = contact.lightningAddress;
    if (!address && contact.pubkey) {
      // The on-mount verified fetch may not have finished yet (or failed) —
      // resolve once more on demand so a present lud16 isn't false-negatived
      // into a "no Lightning address" alert.
      const readRelays = relays.filter((r) => r.read).map((r) => r.url);
      const verified = await fetchProfile(contact.pubkey, readRelays);
      if (verified?.lud16) {
        address = verified.lud16;
        setContact((prev) => ({ ...prev, lightningAddress: verified.lud16 }));
      }
    }
    if (!address) {
      Alert.alert(
        'No Lightning address',
        `${contact.name} hasn’t published a Lightning address, so they can’t receive zaps yet.`,
      );
      return;
    }
    setSendSheetOpen(true);
  }, [hasWallets, contact.lightningAddress, contact.pubkey, contact.name, relays]);

  const handleSetLightningAddress = useCallback(
    async (address: string) => {
      if (!route.params.phoneContactId) return;
      await setLightningAddress(route.params.phoneContactId, address);
      // Update local state so the row re-renders with the saved value.
      setContact((prev) => ({ ...prev, lightningAddress: address }));
    },
    [route.params.phoneContactId],
  );

  const handleFollowToggle = useCallback(async () => {
    if (!contact.pubkey || loadingFollow) return;
    if (following) {
      // Don't flip loadingFollow until the user actually confirms the
      // Unfollow — back-gesture / tap-outside dismissal doesn't fire
      // either button's onPress and would otherwise leave the chip
      // stuck spinning forever.
      Alert.alert('Unfollow', `Stop following ${contact.name}?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unfollow',
          style: 'destructive',
          onPress: async () => {
            setLoadingFollow(true);
            try {
              const success = await unfollowContact(contact.pubkey!);
              if (success) setFollowing(false);
            } finally {
              setLoadingFollow(false);
            }
          },
        },
      ]);
      return;
    }
    setLoadingFollow(true);
    try {
      const success = await followContact(contact.pubkey);
      if (success) setFollowing(true);
    } finally {
      setLoadingFollow(false);
    }
  }, [contact.pubkey, contact.name, loadingFollow, following, followContact, unfollowContact]);

  const handleCopyNpub = useCallback(async () => {
    if (!npub) return;
    await Clipboard.setStringAsync(npub);
    Toast.show({
      type: 'success',
      text1: 'Public key copied',
      position: 'top',
      visibilityTime: 1800,
    });
  }, [npub]);

  const handleCopyLnAddress = useCallback(async () => {
    if (!contact.lightningAddress) return;
    await Clipboard.setStringAsync(contact.lightningAddress);
    Toast.show({
      type: 'success',
      text1: 'Lightning address copied',
      position: 'top',
      visibilityTime: 1800,
    });
  }, [contact.lightningAddress]);

  // "Share to friend" — opens FriendPickerSheet for NIP-17 DM share.
  const handleShareToFriendOpen = useCallback(() => {
    if (!contact.pubkey) return;
    setShareOpen(true);
  }, [contact.pubkey]);

  // "Share" — native OS share sheet (other apps, clipboard, system intents).
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
      // User dismissed or platform rejected — nothing to surface.
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
      } finally {
        setSharing(false);
      }
    },
    [contact.pubkey, contact.name, sharing, sendDirectMessage, contacts, relays],
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

  const showFollowButton = !!contact.pubkey && contact.source === 'nostr';
  const canEditLnAddress = contact.source === 'contacts' && !!route.params.phoneContactId;

  return (
    <View style={styles.container}>
      {/* Header strip pinned over the banner. The banner extends up behind
          the status bar (battery / clock / wifi) — `topBar` is absolute so
          the buttons stay at a consistent inset.top + 8 offset. Back on
          the left, the "More" actions button on the right (mirrors the
          back chevron). Both buttons use a solid dark-pill background for
          contrast against busy banner imagery. */}
      <View style={[styles.topBar, { top: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.headerButton}
          accessibilityLabel="Go back"
          testID="contact-profile-back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ChevronLeft size={22} color={colors.white} strokeWidth={2.4} />
        </TouchableOpacity>
        {contact.pubkey && (
          <TouchableOpacity
            onPress={() => setActionsSheetOpen(true)}
            disabled={sharing}
            style={styles.headerButton}
            accessibilityLabel="More actions"
            testID="contact-more-button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MoreHorizontal size={22} color={colors.white} strokeWidth={2.4} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Banner — contact's own if set, else the brand pink-ostrich texture. */}
        <View style={styles.bannerContainer}>
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
        </View>

        {/* Identity row — avatar left, action buttons + Follow pill right. */}
        <View style={styles.identityRow}>
          <View style={styles.avatarContainer}>
            {contact.picture && !avatarError ? (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => setFullscreenUrl(contact.picture)}
                accessibilityRole="imagebutton"
                accessibilityLabel="View profile picture full screen"
                testID="profile-screen-avatar-fullscreen"
              >
                <Image
                  source={{ uri: contact.picture }}
                  style={styles.avatar}
                  cachePolicy="memory-disk"
                  transition={200}
                  recyclingKey={contact.picture}
                  autoplay={false}
                  onError={() => setAvatarError(true)}
                />
              </TouchableOpacity>
            ) : (
              <View style={styles.avatarDefault}>
                <UserRound size={48} color={colors.textBody} strokeWidth={1.5} />
              </View>
            )}
          </View>

          <View style={styles.identityActionsBlock}>
            <View style={styles.actionIconGroup}>
              {npub && (
                <TouchableOpacity
                  style={styles.actionIconButton}
                  onPress={() => setQrSheetOpen(true)}
                  accessibilityLabel="Show QR code"
                  testID="contact-profile-qr-button"
                >
                  <QrCode size={20} color={colors.white} />
                </TouchableOpacity>
              )}
              {/* Always shown; greyed when a zap can't go out (no wallet or
                  no Lightning address). Tapping the greyed state explains
                  which prerequisite is missing via handleZap. */}
              <TouchableOpacity
                style={[
                  styles.actionIconButton,
                  (!hasWallets || !contact.lightningAddress) && styles.actionIconButtonDisabled,
                ]}
                onPress={handleZap}
                accessibilityRole="button"
                accessibilityLabel={
                  !hasWallets
                    ? 'Zap (no wallet attached)'
                    : contact.lightningAddress
                      ? 'Zap'
                      : 'Zap (no Lightning address)'
                }
                testID="contact-profile-zap-button"
              >
                <Zap size={20} color={colors.white} />
              </TouchableOpacity>
              {contact.pubkey && (
                <TouchableOpacity
                  style={styles.actionIconButton}
                  onPress={handleMessage}
                  accessibilityLabel="Message"
                  testID="contact-profile-message-button"
                >
                  <MessageCircle size={20} color={colors.white} />
                </TouchableOpacity>
              )}
            </View>

            {showFollowButton && (
              <TouchableOpacity
                style={[styles.followButton, following && styles.followingButton]}
                onPress={handleFollowToggle}
                disabled={loadingFollow}
                accessibilityLabel={following ? 'Unfollow' : 'Follow'}
                testID="contact-profile-follow-button"
              >
                <Text
                  style={[styles.followButtonText, following && styles.followingButtonText]}
                  numberOfLines={1}
                >
                  {loadingFollow ? '...' : following ? 'Following' : 'Follow'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <Text style={styles.name} numberOfLines={1}>
          {contact.name}
        </Text>

        {contact.nip05 && (
          <Text style={styles.nip05} numberOfLines={1}>
            {contact.nip05}
          </Text>
        )}

        {npubDisplay && (
          <TouchableOpacity
            style={styles.npubRow}
            onPress={handleCopyNpub}
            accessibilityLabel="Copy npub"
            testID="contact-copy-npub-button"
          >
            <Text style={styles.npubText}>{npubDisplay}</Text>
            <Copy size={16} color={colors.brandPink} />
          </TouchableOpacity>
        )}

        {/* Editable / copyable lud16 row. */}
        {canEditLnAddress ? (
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
                disabled={savingLnAddress}
                onPress={async () => {
                  const trimmed = lnAddressDraft.trim();
                  if (!trimmed) {
                    setEditingLnAddress(false);
                    return;
                  }
                  setSavingLnAddress(true);
                  try {
                    await handleSetLightningAddress(trimmed);
                    // Only exit edit mode after a successful save so the
                    // user can retry without retyping if persistence fails.
                    setEditingLnAddress(false);
                  } catch {
                    Toast.show({
                      type: 'error',
                      text1: 'Failed to save lightning address',
                      position: 'top',
                      visibilityTime: 3000,
                    });
                  } finally {
                    setSavingLnAddress(false);
                  }
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

        {/* Description / about. */}
        {contact.about && contact.about.trim().length > 0 && (
          <View style={styles.aboutContainer}>
            <Text style={styles.aboutText}>{contact.about.trim()}</Text>
          </View>
        )}

        {/* Friend's recent kind-1 notes. Hidden for phone-only contacts. */}
        {contact.pubkey && <FriendNoteFeed authorPubkey={contact.pubkey} />}
      </ScrollView>

      {npub && (
        <QrSheet
          visible={qrSheetOpen}
          onClose={() => setQrSheetOpen(false)}
          npub={npub}
          nostrRef={nprofileRef}
          lightningAddress={contact.lightningAddress}
        />
      )}

      {npub && (
        <NfcWriteSheet
          visible={nfcWriteVisible}
          onClose={() => setNfcWriteVisible(false)}
          npub={npub}
          nostrRef={nprofileRef}
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

      <SendSheet
        visible={sendSheetOpen}
        onClose={() => setSendSheetOpen(false)}
        initialAddress={contact.lightningAddress ?? undefined}
        initialPicture={contact.picture ?? undefined}
        recipientPubkey={contact.pubkey ?? undefined}
        recipientName={contact.name}
      />

      <FullscreenImageModal url={fullscreenUrl} onClose={() => setFullscreenUrl(null)} />
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    topBar: {
      position: 'absolute',
      left: 8,
      right: 8,
      zIndex: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 4,
      paddingVertical: 2,
    },
    headerButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: 'rgba(0,0,0,0.6)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    scrollContent: {
      paddingBottom: 48,
    },
    bannerContainer: {
      width: '100%',
      height: 200,
      overflow: 'hidden',
      backgroundColor: colors.brandPinkLight,
    },
    bannerImage: {
      width: '100%',
      height: '100%',
    },
    identityRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      paddingHorizontal: 16,
      marginTop: -48,
      gap: 12,
    },
    identityActionsBlock: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingBottom: 6,
      flexWrap: 'wrap',
      gap: 8,
    },
    avatarContainer: {
      borderRadius: 51,
      borderWidth: 3,
      borderColor: colors.surface,
      overflow: 'hidden',
      backgroundColor: colors.background,
    },
    avatar: {
      width: 96,
      height: 96,
      borderRadius: 48,
    },
    avatarDefault: {
      width: 96,
      height: 96,
      borderRadius: 48,
      backgroundColor: colors.background,
      justifyContent: 'center',
      alignItems: 'center',
    },
    name: {
      fontSize: 24,
      fontWeight: '700',
      color: colors.textHeader,
      marginTop: 12,
      paddingHorizontal: 16,
    },
    nip05: {
      fontSize: 13,
      color: colors.brandPink,
      marginTop: 2,
      paddingHorizontal: 16,
    },
    npubRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 6,
      paddingHorizontal: 16,
    },
    npubText: {
      fontSize: 12,
      color: colors.textSupplementary,
      fontWeight: '500',
    },
    lightningAddress: {
      fontSize: 13,
      color: colors.textSupplementary,
    },
    lnAddressRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 4,
      paddingHorizontal: 16,
    },
    lnAddressEditRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 8,
      paddingHorizontal: 16,
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
    actionIconGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    actionIconButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.brandPink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionIconButtonDisabled: {
      backgroundColor: colors.textSupplementary,
      opacity: 0.5,
    },
    followButton: {
      paddingHorizontal: 22,
      paddingVertical: 10,
      borderRadius: 22,
      backgroundColor: colors.brandPink,
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 110,
    },
    followingButton: {
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      borderColor: colors.brandPink,
      // Subtract the border width so following / not-following pills
      // visually align at the same height.
      paddingVertical: 8.5,
    },
    followButtonText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.white,
    },
    followingButtonText: {
      color: colors.brandPink,
    },
    aboutContainer: {
      paddingHorizontal: 16,
      marginTop: 16,
    },
    aboutText: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.textBody,
    },
  });

export default ContactProfileScreen;

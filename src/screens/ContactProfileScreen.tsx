import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Share,
  useWindowDimensions,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import ContactActionsSheet from '../components/ContactActionsSheet';
import * as Clipboard from 'expo-clipboard';
import { ChevronLeft, MoreHorizontal } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Alert } from '../components/BrandedAlert';
import Toast from '../components/BrandedToast';
import NfcWriteSheet from '../components/NfcWriteSheet';
import QrSheet from '../components/QrSheet';
import SendSheet from '../components/SendSheet';
import ContactProfileHeader from '../components/profile/ContactProfileHeader';
import ProfileTabBar from '../components/profile/ProfileTabBar';
import ProfileFeedRow from '../components/profile/ProfileFeedRow';
import FriendPickerSheet, { PickedFriend } from '../components/FriendPickerSheet';
import { type ContactProfileBodyData } from '../components/ContactProfileBody';
import FullscreenImageModal from '../components/FullscreenImageModal';
import { useNostr, useNostrContacts } from '../contexts/NostrContext';
import { useWallet } from '../contexts/WalletContext';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createContactProfileScreenStyles } from '../styles/ContactProfileScreen.styles';
import { createProfileTabsStyles } from '../styles/ProfileTabs.styles';
import { profileHeaderLayout } from '../utils/profileHeaderLayout';
import { buildProfileRows, type ProfileRow, type ProfileTab } from '../utils/profileFeedRows';
import { useProfileFeed } from '../hooks/useProfileFeed';
import { useSellerProducts } from '../hooks/useSellerProducts';
import type { MarketProduct } from '../data/marketProducts';
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
// convention: back chevron pinned top-left, the identity header
// (ContactProfileHeader: banner, avatar, action row, name, nip05, npub,
// lud16, NIP-27-aware bio), then Posts / Media / Products tabs (#1332).
// Header, tab bar and the active tab's rows are ONE virtualised FlashList
// so long feeds stay cheap. Share / open externally / NFC live behind the
// "…" button. The quick-glance sheet (ContactProfileSheet +
// ContactProfileBody) is separate — see issue #435.
const ContactProfileScreen: React.FC = () => {
  const t = useTranslation();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<ContactProfileNavigation>();
  const route = useRoute<ContactProfileRoute>();
  const { sendDirectMessage, relays } = useNostr();
  const { contacts, followContact, unfollowContact } = useNostrContacts();
  const { hasWallets } = useWallet();

  const [contact, setContact] = useState<ContactProfileBodyData>(route.params.contact);
  const [following, setFollowing] = useState(false);
  const [loadingFollow, setLoadingFollow] = useState(false);
  // Tap the avatar / a picture → view it full screen (#661 — same as the sheet).
  const [fullscreenUrl, setFullscreenUrl] = useState<string | null>(null);
  const [sendSheetOpen, setSendSheetOpen] = useState(false);
  const [qrSheetOpen, setQrSheetOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [actionsSheetOpen, setActionsSheetOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [nfcWriteVisible, setNfcWriteVisible] = useState(false);
  const [nfcSupported, setNfcSupported] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Bumped on pull-to-refresh so the feed re-subscribes and the Products tab
  // refetches.
  const [notesReloadNonce, setNotesReloadNonce] = useState(0);
  const [tab, setTab] = useState<ProfileTab>('posts');
  // Products are fetched only once their tab has been opened.
  const [productsOpened, setProductsOpened] = useState(false);

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
    // A different person starts on Posts, with Products not yet fetched.
    setTab('posts');
    setProductsOpened(false);
  }, [paramIdentityKey]);

  const npub = useMemo(
    () => (contact.pubkey ? npubEncode(contact.pubkey) : null),
    [contact.pubkey],
  );

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
          // A profile opened from a bare reference (an @mention chip, a
          // deep link) arrives as a stub named after its npub — fill the
          // identity in too, never overwriting what the caller passed.
          name:
            prev.name.startsWith('npub1') && prev.name.endsWith('…')
              ? (profile.displayName ?? profile.name ?? prev.name)
              : prev.name,
          picture: prev.picture ?? profile.picture ?? null,
          banner: prev.banner ?? profile.banner ?? null,
          nip05: prev.nip05 ?? profile.nip05 ?? null,
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

  // Pull-to-refresh: unlike the gap-fill effect above (which only fills
  // missing about/lud16, once), this re-fetches the kind-0 from relays and
  // OVERWRITES every displayed field with the latest — so a friend who
  // updated their name, picture, banner, bio or Lightning address surfaces
  // without waiting out the 24h profile cache. `fetchProfile` is a direct
  // relay query, so there's no cache to bypass.
  const handleRefresh = useCallback(async () => {
    if (!contact.pubkey) return;
    setRefreshing(true);
    try {
      const readRelays = relays.filter((r) => r.read).map((r) => r.url);
      const fresh = await fetchProfile(contact.pubkey, readRelays);
      if (fresh) {
        setContact((prev) => ({
          ...prev,
          name: fresh.displayName ?? fresh.name ?? prev.name,
          picture: fresh.picture ?? null,
          banner: fresh.banner ?? null,
          about: fresh.about ?? null,
          lightningAddress: fresh.lud16 ?? null,
          nip05: fresh.nip05 ?? null,
        }));
      }
    } catch {
      // best-effort — a failed refresh leaves the current data in place
    } finally {
      setRefreshing(false);
    }
    // Re-query the kind-1 note feed for new posts too.
    setNotesReloadNonce((n) => n + 1);
  }, [contact.pubkey, relays]);

  useEffect(() => {
    if (contact.pubkey) {
      setFollowing(contacts.some((c) => c.pubkey === contact.pubkey));
    }
  }, [contact.pubkey, contacts]);

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
      Alert.alert(
        t('contactProfileScreen.noWalletTitle'),
        t('contactProfileScreen.noWalletMessage'),
      );
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
        t('contactProfileScreen.noLightningAddressTitle'),
        t('contactProfileScreen.noLightningAddressMessage', { name: contact.name }),
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
      Alert.alert(
        t('contactProfileScreen.unfollow'),
        t('contactProfileScreen.unfollowMessage', { name: contact.name }),
        [
          { text: t('contactProfileScreen.cancel'), style: 'cancel' },
          {
            text: t('contactProfileScreen.unfollow'),
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
        ],
      );
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
      text1: t('contactProfileScreen.publicKeyCopied'),
      position: 'top',
      visibilityTime: 1800,
    });
  }, [npub]);

  const handleCopyLnAddress = useCallback(async () => {
    if (!contact.lightningAddress) return;
    await Clipboard.setStringAsync(contact.lightningAddress);
    Toast.show({
      type: 'success',
      text1: t('contactProfileScreen.lightningAddressCopied'),
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
    const label = contact.name || t('contactProfileScreen.contactFallback');
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
        const label = contact.name || t('contactProfileScreen.contactFallback');
        const payload = t('contactProfileScreen.sharedContactPayload', { label, nprofile });
        const result = await sendDirectMessage(friend.pubkey, payload);
        if (!result.success) {
          Toast.show({
            type: 'error',
            text1: t('contactProfileScreen.shareFailed'),
            text2: result.error ?? t('contactProfileScreen.couldNotShareContact'),
            position: 'top',
            visibilityTime: 4000,
          });
          return;
        }
        Toast.show({
          type: 'success',
          text1: t('contactProfileScreen.sharedWith', { label, name: friend.name }),
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

  // Identity-row sizing (#1332): regular or compact so the buttons + Follow
  // always fit on one row beside the avatar.
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const iconCount = (npub ? 1 : 0) + 1 + (contact.pubkey ? 1 : 0);
  const layout = useMemo(
    () => profileHeaderLayout(windowWidth, fontScale, iconCount, showFollowButton),
    [windowWidth, fontScale, iconCount, showFollowButton],
  );
  const styles = useMemo(() => createContactProfileScreenStyles(colors, layout), [colors, layout]);
  const tabStyles = useMemo(() => createProfileTabsStyles(colors), [colors]);

  // Posts + Media share one focus-gated feed subscription; Products load on
  // first open of their tab.
  const feed = useProfileFeed(contact.pubkey, notesReloadNonce);
  const seller = useSellerProducts(contact.pubkey, productsOpened, notesReloadNonce, contact.name);
  const selectTab = useCallback((next: ProfileTab) => {
    setTab(next);
    if (next === 'products') setProductsOpened(true);
  }, []);
  const rows = useMemo(
    () =>
      contact.pubkey
        ? buildProfileRows({
            tab,
            feed: feed.events,
            feedLoading: feed.loading && feed.hasRelays,
            products: seller.products,
            productsLoading: seller.loading,
          })
        : [],
    [
      contact.pubkey,
      tab,
      feed.events,
      feed.loading,
      feed.hasRelays,
      seller.products,
      seller.loading,
    ],
  );

  const openProduct = useCallback(
    (product: MarketProduct) =>
      navigation.push('ProductDetail', { productId: product.id, product }),
    [navigation],
  );
  const renderRow = useCallback(
    ({ item }: { item: ProfileRow }) => (
      <ProfileFeedRow
        row={item}
        styles={tabStyles}
        onOpenImage={setFullscreenUrl}
        onOpenProduct={openProduct}
      />
    ),
    [tabStyles, openProduct],
  );
  const openQr = useCallback(() => setQrSheetOpen(true), []);

  const listHeader = useMemo(
    () => (
      <>
        <ContactProfileHeader
          contact={contact}
          styles={styles}
          npub={npub}
          hasWallets={hasWallets}
          following={following}
          loadingFollow={loadingFollow}
          showFollowButton={showFollowButton}
          canEditLnAddress={canEditLnAddress}
          onOpenImage={setFullscreenUrl}
          onQr={openQr}
          onZap={handleZap}
          onMessage={handleMessage}
          onFollowToggle={handleFollowToggle}
          onCopyNpub={handleCopyNpub}
          onCopyLnAddress={handleCopyLnAddress}
          onSaveLightningAddress={handleSetLightningAddress}
        />
        {contact.pubkey ? (
          <ProfileTabBar active={tab} onChange={selectTab} styles={tabStyles} />
        ) : null}
      </>
    ),
    [
      contact,
      styles,
      npub,
      hasWallets,
      following,
      loadingFollow,
      showFollowButton,
      canEditLnAddress,
      openQr,
      handleZap,
      handleMessage,
      handleFollowToggle,
      handleCopyNpub,
      handleCopyLnAddress,
      handleSetLightningAddress,
      tab,
      selectTab,
      tabStyles,
    ],
  );

  // Posts / Media page backwards on demand; nothing to page on Products (the
  // seller's listings come in one bounded snapshot).
  const canPage = tab !== 'products' && feed.events.length > 0 && !feed.reachedEnd;
  const listFooter = canPage ? (
    <View style={tabStyles.footer}>
      {feed.loadingMore ? (
        <ActivityIndicator size="small" color={colors.brandPink} />
      ) : (
        <TouchableOpacity
          style={tabStyles.loadMoreButton}
          onPress={feed.loadMore}
          accessibilityRole="button"
          accessibilityLabel={t('profileTabs.loadMore')}
          testID="profile-load-more"
        >
          <Text style={tabStyles.loadMoreText}>{t('profileTabs.loadMore')}</Text>
        </TouchableOpacity>
      )}
    </View>
  ) : null;

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
          accessibilityRole="button"
          onPress={() => navigation.goBack()}
          style={styles.headerButton}
          accessibilityLabel={t('contactProfileScreen.goBack')}
          testID="contact-profile-back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ChevronLeft size={22} color={colors.white} strokeWidth={2.4} />
        </TouchableOpacity>
        {contact.pubkey && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ disabled: sharing }}
            onPress={() => setActionsSheetOpen(true)}
            disabled={sharing}
            style={styles.headerButton}
            accessibilityLabel={t('contactProfileScreen.moreActions')}
            testID="contact-more-button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MoreHorizontal size={22} color={colors.white} strokeWidth={2.4} />
          </TouchableOpacity>
        )}
      </View>

      <FlashList
        data={rows}
        renderItem={renderRow}
        keyExtractor={(row) => row.key}
        getItemType={(row) => row.type}
        ListHeaderComponent={listHeader}
        ListFooterComponent={listFooter}
        // Posts page in as you scroll; the Media grid pages from its footer
        // button, since a text-heavy author can need several pages per row.
        onEndReached={tab === 'posts' && canPage ? feed.loadMore : undefined}
        onEndReachedThreshold={0.5}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        testID="contact-profile-list"
      />

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
        title={t('contactProfileScreen.shareTitle', {
          name: contact.name || t('contactProfileScreen.contactShort'),
        })}
        subtitle={t('contactProfileScreen.shareSubtitle')}
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

export default ContactProfileScreen;

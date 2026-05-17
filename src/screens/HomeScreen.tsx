import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  InteractionManager,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useWallet } from '../contexts/WalletContext';
import { useNostr } from '../contexts/NostrContext';
import { Home } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import ReceiveSheet from '../components/ReceiveSheet';
import SendSheet from '../components/SendSheet';
import TransferSheet from '../components/TransferSheet';
import TransactionList from '../components/TransactionList';
import WalletCarousel from '../components/WalletCarousel';
import AddWalletWizard from '../components/AddWalletWizard';
import WelcomeWalletPrompt from '../components/WelcomeWalletPrompt';
import WalletSettingsSheet from '../components/WalletSettingsSheet';
import TabHeader from '../components/TabHeader';
import { ArrowDownIcon, ArrowUpIcon, ArrowLeftRightIcon } from '../components/icons/ArrowIcons';
import { createHomeScreenStyles } from '../styles/HomeScreen.styles';
import { isSendableWallet } from '../utils/walletCapabilities';
import { perfLog } from '../utils/perfLog';
import type { MainTabParamList } from '../navigation/types';

const HomeScreen: React.FC = () => {
  const colors = useThemeColors();
  // First-render marker: fires once per mount when the first commit lands. Used by scripts/perf-startup.sh to measure tap-to-render latency for tab-home.
  const homeRenderLoggedRef = useRef(false);
  useEffect(() => {
    if (homeRenderLoggedRef.current) return;
    homeRenderLoggedRef.current = true;
    console.log(`[Perf] HomeScreen first render`);
  }, []);
  const styles = useMemo(() => createHomeScreenStyles(colors), [colors]);
  const {
    wallets,
    activeWalletId,
    activeWallet,
    hasWallets,
    walletsHydrated,
    refreshActiveBalance,
    fetchTransactionsForWallet,
    setActiveWallet,
    btcPrice,
    currency,
    requestBalancePoll,
  } = useWallet();
  const { isLoggedIn, profile, refreshProfile } = useNostr();
  const navigation = useNavigation<BottomTabNavigationProp<MainTabParamList, 'Home'>>();
  const route = useRoute<RouteProp<MainTabParamList, 'Home'>>();
  const insets = useSafeAreaInsets();

  const [receiveOpen, setReceiveOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [sendToAddress, setSendToAddress] = useState<string | undefined>();
  const [sendToPicture, setSendToPicture] = useState<string | undefined>();
  const [sendToPubkey, setSendToPubkey] = useState<string | undefined>();
  const [sendToName, setSendToName] = useState<string | undefined>();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [settingsWalletId, setSettingsWalletId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Refresh the own-profile kind-0 on focus so the top-right profile
  // icon picks up external renames (e.g. via Amber or another client).
  // The call is cache-respecting: if the 24h kind-0 cache is still
  // fresh it short-circuits without hitting relays, so switching tabs
  // doesn't incur a network cost. Pull-to-refresh in MessagesScreen
  // passes `{ force: true }` for the explicit-user-intent path.
  useFocusEffect(
    useCallback(() => {
      if (!isLoggedIn) return;
      // Defer to after the tab-transition animation finishes — same
      // rationale as Friends/Messages: refreshProfile can hold the JS
      // thread briefly while it walks the profile cache and (on miss)
      // hits a relay, and running it during the focus callback
      // synchronously makes the tab feel laggy.
      const handle = InteractionManager.runAfterInteractions(() => refreshProfile());
      return () => handle.cancel();
    }, [isLoggedIn, refreshProfile]),
  );

  // Drive the 30 s NWC balance poll only while Home is focused — see
  // #569. The poll lives in WalletContext but is now demand-gated: this
  // screen signals "the balance is on screen, keep refreshing it" on
  // focus, and the cleanup signals "I no longer need it" on blur. The
  // initial in-effect `refreshOnce()` inside WalletContext means the
  // balance refreshes immediately on return to Home rather than waiting
  // up to 30 s for the next tick.
  useFocusEffect(
    useCallback(() => {
      const release = requestBalancePoll();
      return release;
    }, [requestBalancePoll]),
  );

  // Handle sendToAddress from navigation params (e.g., from Friends tab zap)
  useEffect(() => {
    if (route.params?.sendToAddress) {
      setSendToAddress(route.params.sendToAddress);
      setSendToPicture(route.params.sendToPicture);
      setSendToPubkey(route.params.sendToPubkey);
      setSendToName(route.params.sendToName);
      setSendOpen(true);
      navigation.setParams({
        sendToAddress: undefined,
        sendToPicture: undefined,
        sendToPubkey: undefined,
        sendToName: undefined,
      });
    }
  }, [
    route.params?.sendToAddress,
    route.params?.sendToPicture,
    route.params?.sendToPubkey,
    route.params?.sendToName,
    navigation,
  ]);

  // Hold the latest wallets + context callbacks in refs so fetchTransactions
  // and fetchData can read up-to-date values without taking `wallets` or the
  // callbacks as dependencies. Without refs we'd either re-run the fetch
  // callback on every wallet state change (triggering fetch loops via the
  // effect below) or capture stale values (and mis-route NWC vs on-chain).
  const walletsRef = useRef(wallets);
  const refreshActiveBalanceRef = useRef(refreshActiveBalance);
  const fetchTransactionsForWalletRef = useRef(fetchTransactionsForWallet);
  useEffect(() => {
    walletsRef.current = wallets;
    refreshActiveBalanceRef.current = refreshActiveBalance;
    fetchTransactionsForWalletRef.current = fetchTransactionsForWallet;
  }, [wallets, refreshActiveBalance, fetchTransactionsForWallet]);

  const fetchTransactions = useCallback(
    async (opts?: { force?: boolean }) => {
      if (!activeWalletId) return;
      await fetchTransactionsForWalletRef.current(activeWalletId, opts);
    },
    [activeWalletId],
  );

  // `force` is set by an explicit pull-to-refresh — it bypasses the
  // zap-resolver's fingerprint skip so a manual refresh always does a
  // full attribution pass even when nothing looks changed (#526).
  const fetchData = useCallback(
    async (opts?: { force?: boolean }) => {
      // For on-chain wallets, fetchTransactions already does syncAndRefresh
      // which updates both balance and transactions in a single sync.
      // Only call refreshActiveBalance separately for NWC wallets.
      const wallet = walletsRef.current.find((w) => w.id === activeWalletId);
      if (wallet?.walletType === 'onchain') {
        await fetchTransactions(opts);
      } else {
        await Promise.all([refreshActiveBalanceRef.current(), fetchTransactions(opts)]);
      }
    },
    [activeWalletId, fetchTransactions],
  );

  const isWalletAvailable =
    activeWallet?.walletType === 'onchain' ? true : (activeWallet?.isConnected ?? false);

  // Transactions from the active wallet (owned by WalletContext)
  const transactions = activeWallet?.transactions ?? [];
  const fetchedWallets = useRef<Set<string>>(new Set());

  // Show spinner only while first fetch is in progress (not for zero-tx wallets)
  const loadingTransactions =
    isWalletAvailable &&
    transactions.length === 0 &&
    activeWalletId != null &&
    !fetchedWallets.current.has(activeWalletId);

  // When swiping to a disconnected NWC wallet, trigger reconnection
  useEffect(() => {
    if (activeWallet?.walletType === 'nwc' && !activeWallet?.isConnected && activeWalletId) {
      refreshActiveBalance();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWalletId]);

  // Fetch fresh data once per wallet (not on every swipe back)
  useEffect(() => {
    setRefreshing(false);
    if (isWalletAvailable && activeWalletId && !fetchedWallets.current.has(activeWalletId)) {
      fetchedWallets.current.add(activeWalletId);
      fetchData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWalletId, isWalletAvailable]);

  const handleRefresh = async () => {
    setRefreshing(true);
    if (activeWalletId) fetchedWallets.current.delete(activeWalletId);
    // Explicit pull-to-refresh — force a full zap-resolver pass.
    await fetchData({ force: true });
    setRefreshing(false);
  };

  const handleWalletChange = useCallback(
    (walletId: string | null) => {
      if (walletId !== activeWalletId) {
        setActiveWallet(walletId);
      }
    },
    [activeWalletId, setActiveWallet],
  );

  const handleSettingsPress = useCallback((walletId: string) => {
    setSettingsWalletId(walletId);
  }, []);

  const greetingName = profile?.displayName?.trim() || profile?.name?.trim() || 'Satoshi';

  const isOnchainWallet = activeWallet?.walletType === 'onchain';
  const isWatchOnly = isOnchainWallet && activeWallet?.onchainImportMethod !== 'mnemonic';
  // Don't gate Send/Receive on the transient `isConnected` flag: post-PR-D
  // The previous `hasActiveConnection`, `canSend`, `canTransfer`
  // gates were inlined into the `is*Disabled` constants below — see
  // #474. They required an in-state activeWallet (i.e. a populated
  // wallet list, not necessarily a completed NWC handshake) and a
  // sendable wallet for transfer. We now gate on wallet count alone
  // since the bottom sheets handle their own connection-loading
  // states; blocking the BUTTON tap during the NWC handshake left
  // the app feeling locked.

  // Cold-start gating: until the WalletContext finishes its initial
  // AsyncStorage read, `wallets` is `[]` and `activeWallet` is `null` —
  // not because the user has no wallets, but because we haven't loaded
  // them yet. Rendering the buttons in the faded `actionButtonDisabled`
  // style during that window looks broken; suppress it until hydration
  // completes. If it turns out there really are no wallets, the empty
  // state below replaces this UI anyway. See #201.
  //
  // Single source of truth per button — `isXDisabled` drives BOTH the
  // disabled style AND the `disabled` prop so visual state always
  // matches interactivity. During hydration both come out `false` so
  // the buttons render neutral AND remain tappable; the receive sheet
  // / transfer flow handles "wallets not loaded yet" gracefully.
  // Disable each button only when the user has no wallet to act on —
  // not while NWC connections are still handshaking. The bottom
  // sheets handle their own loading states; gating the BUTTON on
  // `hasActiveConnection` left taps un-feedback-able for the 1-3 s
  // cold-start window while NWC handshakes complete (#474).
  const isReceiveDisabled = walletsHydrated && wallets.length === 0;
  // Send is also disabled when the active wallet itself can't sign —
  // watch-only on-chain (xpub) and bare-receive-address imports
  // (Xapo deposit addresses, etc.) have no signing material so the
  // Send sheet can't complete from them. Per #493. The "no wallets
  // at all" case still kicks in first.
  const isSendDisabled =
    (walletsHydrated && wallets.length === 0) ||
    (activeWallet !== null && !isSendableWallet(activeWallet));
  // Transfer needs at least two wallets (a source + destination).
  const isTransferDisabled = walletsHydrated && wallets.length < 2;

  return (
    <View style={styles.container}>
      {/* Header area with brand background + faded pig behind carousel */}
      <View style={styles.headerBackground}>
        <Image
          source={require('../../assets/images/lightning-piggy-intro.png')}
          style={styles.bgPigImage}
          resizeMode="contain"
        />

        <TabHeader
          title={`Hello${greetingName ? `, ${greetingName}` : ''}!`}
          // Keep Home's greeting at its pre-#139 lighter weight + smaller
          // size; section titles (Messages/Friends/Learn) stay bolder to
          // read as section labels.
          titleStyle={{ fontSize: 22, fontWeight: '400' }}
          icon={<Home size={20} color={colors.brandPink} />}
        />

        <WalletCarousel
          wallets={wallets}
          activeWalletId={activeWalletId}
          btcPrice={btcPrice}
          currency={currency}
          onWalletChange={handleWalletChange}
          onAddWallet={() => setWizardOpen(true)}
          onSettingsPress={handleSettingsPress}
        />

        {/* Send/Receive/Transfer buttons */}
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.actionButton, isReceiveDisabled && styles.actionButtonDisabled]}
            onPress={() => setReceiveOpen(true)}
            disabled={isReceiveDisabled}
            accessibilityLabel="Receive"
            testID="btn-receive"
          >
            <View style={styles.actionCircle}>
              <ArrowDownIcon size={24} strokeWidth={3} />
            </View>
            <Text style={styles.actionText}>Receive</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, isTransferDisabled && styles.actionButtonDisabled]}
            onPress={() => setTransferOpen(true)}
            disabled={isTransferDisabled}
            accessibilityLabel="Transfer"
            testID="btn-transfer"
          >
            <View style={styles.actionCircle}>
              <ArrowLeftRightIcon size={24} strokeWidth={3} />
            </View>
            <Text style={styles.actionText}>Transfer</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, isSendDisabled && styles.actionButtonDisabled]}
            onPress={() => {
              perfLog('btn-send onPress');
              setSendOpen(true);
            }}
            disabled={isSendDisabled}
            accessibilityLabel="Send"
            testID="btn-send"
          >
            <View style={styles.actionCircle}>
              <ArrowUpIcon size={24} strokeWidth={3} />
            </View>
            <Text style={styles.actionText}>Send</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Transaction list */}
      <View style={styles.transactionsWrapper}>
        <ScrollView
          style={styles.transactionsContainer}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        >
          {!hasWallets ? (
            <WelcomeWalletPrompt onGetStarted={() => setWizardOpen(true)} />
          ) : activeWalletId === null ? (
            <View style={styles.emptyState}>
              <TouchableOpacity onPress={() => setWizardOpen(true)}>
                <Text style={styles.addWalletText}>+ Add a Wallet</Text>
              </TouchableOpacity>
            </View>
          ) : loadingTransactions && transactions.length === 0 ? (
            <View style={styles.emptyState}>
              <ActivityIndicator size="small" color="#EC008C" />
            </View>
          ) : (
            <TransactionList transactions={transactions} />
          )}
        </ScrollView>
      </View>

      <ReceiveSheet visible={receiveOpen} onClose={() => setReceiveOpen(false)} />
      <SendSheet
        visible={sendOpen}
        onClose={() => {
          setSendOpen(false);
          setSendToAddress(undefined);
          setSendToPicture(undefined);
          setSendToPubkey(undefined);
          setSendToName(undefined);
        }}
        initialAddress={sendToAddress}
        initialPicture={sendToPicture}
        recipientPubkey={sendToPubkey}
        recipientName={sendToName}
      />
      <TransferSheet visible={transferOpen} onClose={() => setTransferOpen(false)} />
      <AddWalletWizard visible={wizardOpen} onClose={() => setWizardOpen(false)} />
      <WalletSettingsSheet walletId={settingsWalletId} onClose={() => setSettingsWalletId(null)} />
    </View>
  );
};

// React.Profiler wrapper to surface render-commit costs as
// [PerfBlock] log lines. Threshold-gated to ≥ 100 ms (the user-perceived
// jank floor) so the log doesn't drown on healthy frames. The id arg
// is the screen name so multi-screen Profiler output is greppable as
// [PerfBlock] render:<screen>. Pre-fix the silent 20-45 s freezes in
// #560 had no React-side instrumentation, so render-storm cost from
// the 596-contact setContacts dispatch was completely invisible.
const ProfiledHomeScreen: React.FC = () => (
  <React.Profiler
    id="HomeScreen"
    onRender={(id, phase, actualDuration) => {
      if (actualDuration > 100) {
        // eslint-disable-next-line no-console
        console.log(`[PerfBlock] render:${id} ${phase}=${Math.round(actualDuration)}ms`);
      }
    }}
  >
    <HomeScreen />
  </React.Profiler>
);

export default ProfiledHomeScreen;

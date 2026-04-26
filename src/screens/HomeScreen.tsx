import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  NativeScrollEvent,
  NativeSyntheticEvent,
  LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useWallet } from '../contexts/WalletContext';
import { useNostr } from '../contexts/NostrContext';
import { Home } from 'lucide-react-native';
import { colors } from '../styles/theme';
import ReceiveSheet from '../components/ReceiveSheet';
import SendSheet from '../components/SendSheet';
import TransferSheet from '../components/TransferSheet';
import TransactionList, { TransactionListHandle } from '../components/TransactionList';
import WalletCarousel from '../components/WalletCarousel';
import AddWalletWizard from '../components/AddWalletWizard';
import WalletSettingsSheet from '../components/WalletSettingsSheet';
import TabHeader from '../components/TabHeader';
import { ArrowDownIcon, ArrowUpIcon, ArrowLeftRightIcon } from '../components/icons/ArrowIcons';
import { styles } from '../styles/HomeScreen.styles';
import type { MainTabParamList } from '../navigation/types';

// How close to the bottom (in px) we trigger a new batch of transactions.
const INFINITE_SCROLL_THRESHOLD = 200;

const HomeScreen: React.FC = () => {
  const {
    wallets,
    activeWalletId,
    activeWallet,
    hasWallets,
    refreshActiveBalance,
    fetchTransactionsForWallet,
    setActiveWallet,
    userName,
    btcPrice,
    currency,
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
  // (The greeting text itself reads from WalletContext's userName, not
  // `profile` — aligning those is tracked separately under #150.)
  useFocusEffect(
    useCallback(() => {
      if (isLoggedIn) refreshProfile();
    }, [isLoggedIn, refreshProfile]),
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

  const fetchTransactions = useCallback(async () => {
    if (!activeWalletId) return;
    await fetchTransactionsForWalletRef.current(activeWalletId);
  }, [activeWalletId]);

  const fetchData = useCallback(async () => {
    // For on-chain wallets, fetchTransactions already does syncAndRefresh
    // which updates both balance and transactions in a single sync.
    // Only call refreshActiveBalance separately for NWC wallets.
    const wallet = walletsRef.current.find((w) => w.id === activeWalletId);
    if (wallet?.walletType === 'onchain') {
      await fetchTransactions();
    } else {
      await Promise.all([refreshActiveBalanceRef.current(), fetchTransactions()]);
    }
  }, [activeWalletId, fetchTransactions]);

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
    await fetchData();
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

  // Infinite-scroll for the transactions list: when the user scrolls within
  // INFINITE_SCROLL_THRESHOLD of the bottom, ask TransactionList to reveal
  // the next batch of cached transactions.
  //
  // `onScroll` fires continuously while the user remains near the bottom, so
  // we latch on entry into the bottom zone via `nearBottomRef`: each crossing
  // from above-threshold to below-threshold triggers exactly one loadMore().
  // Revealing a batch grows contentSize and pushes the user back above the
  // threshold, clearing the latch so the next pull fires again.
  //
  // `onScroll` alone isn't enough on large screens / small lists where the
  // initial 20 rows fit without overflow — the user can't scroll, so the
  // remaining cached rows would be unreachable. We also fire loadMore on
  // `onContentSizeChange` whenever content height is within threshold of
  // the visible layout height; loadMore is a no-op once visibleCount equals
  // the cached total, so the cascade self-terminates.
  const txListRef = useRef<TransactionListHandle>(null);
  const nearBottomRef = useRef(false);
  const scrollLayoutHeightRef = useRef(0);

  // Reset the near-bottom latch when switching wallets so the first
  // bottom-zone entry on the new list still fires a loadMore.
  useEffect(() => {
    nearBottomRef.current = false;
  }, [activeWalletId]);

  const handleTransactionsScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    scrollLayoutHeightRef.current = layoutMeasurement.height;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    const nearBottom = distanceFromBottom < INFINITE_SCROLL_THRESHOLD;
    if (nearBottom && !nearBottomRef.current) {
      txListRef.current?.loadMore();
    }
    nearBottomRef.current = nearBottom;
  }, []);

  const handleTransactionsLayout = useCallback((e: LayoutChangeEvent) => {
    scrollLayoutHeightRef.current = e.nativeEvent.layout.height;
  }, []);

  const handleTransactionsContentSizeChange = useCallback(
    (_contentWidth: number, contentHeight: number) => {
      const layoutHeight = scrollLayoutHeightRef.current;
      if (layoutHeight > 0 && contentHeight - layoutHeight < INFINITE_SCROLL_THRESHOLD) {
        txListRef.current?.loadMore();
      }
    },
    [],
  );

  const greetingName =
    profile?.displayName?.trim() || profile?.name?.trim() || userName?.trim() || '';

  const isOnchainWallet = activeWallet?.walletType === 'onchain';
  const isWatchOnly = isOnchainWallet && activeWallet?.onchainImportMethod !== 'mnemonic';
  const hasActiveConnection = isOnchainWallet ? true : (activeWallet?.isConnected ?? false);
  const canSend = hasActiveConnection && !isWatchOnly;
  // Transfer requires at least 1 wallet that can send + 1 other wallet
  const hasSendableWallet = wallets.some(
    (w) =>
      (w.walletType === 'nwc' && w.isConnected) ||
      (w.walletType === 'onchain' && w.onchainImportMethod === 'mnemonic'),
  );
  const canTransfer = hasSendableWallet && wallets.length >= 2;

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
            style={[styles.actionButton, !hasActiveConnection && styles.actionButtonDisabled]}
            onPress={() => setReceiveOpen(true)}
            disabled={!hasActiveConnection}
            accessibilityLabel="Receive"
            testID="btn-receive"
          >
            <View style={styles.actionCircle}>
              <ArrowDownIcon size={24} strokeWidth={3} />
            </View>
            <Text style={styles.actionText}>Receive</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, !canTransfer && styles.actionButtonDisabled]}
            onPress={() => setTransferOpen(true)}
            disabled={!canTransfer}
            accessibilityLabel="Transfer"
            testID="btn-transfer"
          >
            <View style={styles.actionCircle}>
              <ArrowLeftRightIcon size={24} strokeWidth={3} />
            </View>
            <Text style={styles.actionText}>Transfer</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, !canSend && styles.actionButtonDisabled]}
            onPress={() => setSendOpen(true)}
            disabled={!canSend}
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
          onScroll={handleTransactionsScroll}
          onLayout={handleTransactionsLayout}
          onContentSizeChange={handleTransactionsContentSizeChange}
          scrollEventThrottle={100}
          testID="transactions-scroll"
        >
          {!hasWallets || activeWalletId === null ? (
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
            <TransactionList ref={txListRef} transactions={transactions} />
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

export default HomeScreen;

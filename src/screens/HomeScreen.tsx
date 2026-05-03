import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
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
import TransactionList, { TRANSACTION_ROW_HEIGHT } from '../components/TransactionList';
import { SkeletonList } from '../components/SkeletonRow';
import WalletCarousel from '../components/WalletCarousel';
import AddWalletWizard from '../components/AddWalletWizard';
import WalletSettingsSheet from '../components/WalletSettingsSheet';
import TabHeader from '../components/TabHeader';
import { ArrowDownIcon, ArrowUpIcon, ArrowLeftRightIcon } from '../components/icons/ArrowIcons';
import { createHomeScreenStyles } from '../styles/HomeScreen.styles';
import type { MainTabParamList } from '../navigation/types';

const HomeScreen: React.FC = () => {
  const colors = useThemeColors();
  const styles = useMemo(() => createHomeScreenStyles(colors), [colors]);
  const {
    wallets,
    activeWalletId,
    activeWallet,
    hasWallets,
    refreshActiveBalance,
    fetchTransactionsForWallet,
    setActiveWallet,
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

  const greetingName = profile?.displayName?.trim() || profile?.name?.trim() || 'Satoshi';

  const isOnchainWallet = activeWallet?.walletType === 'onchain';
  const isWatchOnly = isOnchainWallet && activeWallet?.onchainImportMethod !== 'mnemonic';
  // Don't gate Send/Receive on the transient `isConnected` flag: post-PR-D
  // NWC wallets land in state with `isConnected: false` and flip true in
  // background, so gating here would dead-lock the buttons for the 2-14 s
  // enable() window, or indefinitely if the WebSocket blips. `pay` /
  // `makeInvoice` auto-await the in-flight connect, so "in state" is
  // enough.
  const hasActiveConnection = !!activeWallet;
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
        >
          {!hasWallets || activeWalletId === null ? (
            <View style={styles.emptyState}>
              <TouchableOpacity onPress={() => setWizardOpen(true)}>
                <Text style={styles.addWalletText}>+ Add a Wallet</Text>
              </TouchableOpacity>
            </View>
          ) : loadingTransactions && transactions.length === 0 ? (
            // Row-shaped skeleton instead of a centred spinner so the
            // layout doesn't jump when transactions land. 5 rows ≈ one
            // viewport of pre-roll on a typical phone. See plan in
            // #245 follow-up.
            <SkeletonList count={5} rowHeight={TRANSACTION_ROW_HEIGHT} avatarSize={40} lines={2} />
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

export default HomeScreen;

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useWallet } from '../contexts/WalletContext';
import { useNostr } from '../contexts/NostrContext';
import ReceiveSheet from '../components/ReceiveSheet';
import SendSheet from '../components/SendSheet';
import TransferSheet from '../components/TransferSheet';
import TransactionList from '../components/TransactionList';
import WalletCarousel from '../components/WalletCarousel';
import AddWalletWizard from '../components/AddWalletWizard';
import WalletSettingsSheet from '../components/WalletSettingsSheet';
import ProfileIcon from '../components/ProfileIcon';
import { ArrowDownIcon, ArrowUpIcon, ArrowLeftRightIcon } from '../components/icons/ArrowIcons';
import { styles } from '../styles/HomeScreen.styles';
import type { MainTabParamList } from '../navigation/types';

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
  const { profile } = useNostr();
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

  const greetingName = profile?.displayName?.trim() || profile?.name?.trim() || userName || '';

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
      <View style={[styles.headerBackground, { paddingTop: insets.top + 12 }]}>
        <Image
          source={require('../../assets/images/lightning-piggy-intro.png')}
          style={styles.bgPigImage}
          resizeMode="contain"
        />

        <View style={styles.headerRow}>
          <Text style={styles.hello}>Hello{greetingName ? `, ${greetingName}` : ''}!</Text>
          <ProfileIcon
            uri={profile?.picture}
            size={36}
            onPress={() => navigation.navigate('Account')}
          />
        </View>

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

export default HomeScreen;

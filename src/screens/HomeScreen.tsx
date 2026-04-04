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
import * as nwcService from '../services/nwcService';
import * as onchainService from '../services/onchainService';
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
  const [wizardOpen, setWizardOpen] = useState(false);
  const [settingsWalletId, setSettingsWalletId] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingTransactions, setLoadingTransactions] = useState(false);
  // In-memory cache: wallet ID → transactions (avoids re-fetching on swipe)
  const txCache = useRef<Map<string, any[]>>(new Map());

  // Handle sendToAddress from navigation params (e.g., from Friends tab zap)
  useEffect(() => {
    if (route.params?.sendToAddress) {
      setSendToAddress(route.params.sendToAddress);
      setSendToPicture(route.params.sendToPicture);
      setSendToPubkey(route.params.sendToPubkey);
      setSendOpen(true);
      navigation.setParams({
        sendToAddress: undefined,
        sendToPicture: undefined,
        sendToPubkey: undefined,
      });
    }
  }, [
    route.params?.sendToAddress,
    route.params?.sendToPicture,
    route.params?.sendToPubkey,
    navigation,
  ]);

  const fetchTransactions = useCallback(async () => {
    if (!activeWalletId) {
      setTransactions([]);
      setLoadingTransactions(false);
      return;
    }
    // Read wallet type from current wallets array to avoid depending on
    // the activeWallet object reference (which changes on every balance update)
    const wallet = wallets.find((w) => w.id === activeWalletId);
    if (!wallet) {
      setTransactions([]);
      setLoadingTransactions(false);
      return;
    }
    // Show cached transactions immediately (if any)
    const cached = txCache.current.get(activeWalletId);
    if (cached) {
      setTransactions(cached);
      setLoadingTransactions(false);
    } else {
      setLoadingTransactions(true);
    }

    // Fetch fresh transactions in background
    try {
      let freshTxs: any[];
      if (wallet.walletType === 'onchain') {
        const txs = await onchainService.getTransactions(activeWalletId);
        freshTxs = txs.map((tx) => ({
          type: tx.type,
          amount: tx.amount,
          description: tx.type === 'incoming' ? 'Received' : 'Sent',
          settled_at: tx.timestamp,
          created_at: tx.timestamp,
        }));
      } else {
        freshTxs = await nwcService.listTransactions(activeWalletId);
      }
      txCache.current.set(activeWalletId, freshTxs);
      setTransactions(freshTxs);
    } catch (error) {
      console.warn('Failed to fetch transactions:', error);
    } finally {
      setLoadingTransactions(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWalletId]);

  const fetchData = useCallback(async () => {
    await Promise.all([refreshActiveBalance(), fetchTransactions()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWalletId]);

  const isWalletAvailable =
    activeWallet?.walletType === 'onchain' ? true : (activeWallet?.isConnected ?? false);

  // Fetch data once when wallet becomes available or wallet changes.
  // Uses a ref to track the last fetched state and avoid re-fetching
  // when unrelated wallet state (balance, etc.) changes.
  // Show cached transactions immediately when active wallet changes
  useEffect(() => {
    if (activeWalletId) {
      const cached = txCache.current.get(activeWalletId);
      setTransactions(cached || []);
      if (!cached) setLoadingTransactions(true);
    } else {
      setTransactions([]);
    }
  }, [activeWalletId]);

  // Fetch fresh data when wallet becomes available
  const lastFetchKey = useRef<string | null>(null);
  useEffect(() => {
    const fetchKey = `${activeWalletId}-${isWalletAvailable}`;
    if (isWalletAvailable && fetchKey !== lastFetchKey.current) {
      lastFetchKey.current = fetchKey;
      fetchData();
    } else if (!isWalletAvailable) {
      lastFetchKey.current = null;
      setTransactions([]);
    }
  }, [activeWalletId, isWalletAvailable, fetchData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  const handleWalletChange = useCallback(
    (walletId: string) => {
      if (walletId !== activeWalletId) {
        setActiveWallet(walletId);
      }
    },
    [activeWalletId, setActiveWallet],
  );

  const handleSettingsPress = useCallback((walletId: string) => {
    setSettingsWalletId(walletId);
  }, []);

  const isOnchainWatchOnly = activeWallet?.walletType === 'onchain';
  const hasActiveConnection = isOnchainWatchOnly ? true : (activeWallet?.isConnected ?? false);
  const canSend = hasActiveConnection && !isOnchainWatchOnly;
  // Transfer requires at least 1 connected NWC wallet + 1 other wallet
  const hasConnectedNwc = wallets.some((w) => w.walletType === 'nwc' && w.isConnected);
  const canTransfer = hasConnectedNwc && wallets.length >= 2;

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
          <Text style={styles.hello}>Hello{userName ? `, ${userName}` : ''}!</Text>
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
          {!hasWallets ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>Add a wallet to get started</Text>
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
        }}
        initialAddress={sendToAddress}
        initialPicture={sendToPicture}
        recipientPubkey={sendToPubkey}
      />
      <TransferSheet visible={transferOpen} onClose={() => setTransferOpen(false)} />
      <AddWalletWizard visible={wizardOpen} onClose={() => setWizardOpen(false)} />
      <WalletSettingsSheet walletId={settingsWalletId} onClose={() => setSettingsWalletId(null)} />
    </View>
  );
};

export default HomeScreen;

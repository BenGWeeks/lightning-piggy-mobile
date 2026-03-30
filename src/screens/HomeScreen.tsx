import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWallet } from '../contexts/WalletContext';
import ReceiveSheet from '../components/ReceiveSheet';
import SendSheet from '../components/SendSheet';
import TransactionList from '../components/TransactionList';
import WalletCarousel from '../components/WalletCarousel';
import AddWalletWizard from '../components/AddWalletWizard';
import WalletSettingsSheet from '../components/WalletSettingsSheet';
import * as nwcService from '../services/nwcService';
import { styles } from '../styles/HomeScreen.styles';

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
  const insets = useSafeAreaInsets();

  const [receiveOpen, setReceiveOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [settingsWalletId, setSettingsWalletId] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchTransactions = useCallback(async () => {
    if (!activeWalletId) {
      setTransactions([]);
      return;
    }
    try {
      const txs = await nwcService.listTransactions(activeWalletId);
      setTransactions(txs);
    } catch (error) {
      console.warn('Failed to fetch transactions:', error);
    }
  }, [activeWalletId]);

  const fetchData = useCallback(async () => {
    await refreshActiveBalance();
    await fetchTransactions();
  }, [refreshActiveBalance, fetchTransactions]);

  useEffect(() => {
    if (activeWallet?.isConnected) {
      fetchData();
    } else {
      setTransactions([]);
    }
  }, [activeWalletId, activeWallet?.isConnected]);

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

  const hasActiveConnection = activeWallet?.isConnected ?? false;

  return (
    <View style={styles.container}>
      {/* Header area with brand background + faded pig behind carousel */}
      <View style={[styles.headerBackground, { paddingTop: insets.top + 12 }]}>
        <Image
          source={require('../../assets/images/lightning-piggy-intro.png')}
          style={styles.bgPigImage}
          resizeMode="contain"
        />

        <Text style={styles.hello}>Hello{userName ? `, ${userName}` : ''}!</Text>

        <WalletCarousel
          wallets={wallets}
          activeWalletId={activeWalletId}
          btcPrice={btcPrice}
          currency={currency}
          onWalletChange={handleWalletChange}
          onAddWallet={() => setWizardOpen(true)}
          onSettingsPress={handleSettingsPress}
        />

        {/* Send/Receive buttons */}
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.actionButton, !hasActiveConnection && styles.actionButtonDisabled]}
            onPress={() => setReceiveOpen(true)}
            disabled={!hasActiveConnection}
          >
            <Text style={styles.actionIcon}>&#8595;</Text>
            <Text style={styles.actionText}>Receive</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, !hasActiveConnection && styles.actionButtonDisabled]}
            onPress={() => setSendOpen(true)}
            disabled={!hasActiveConnection}
          >
            <Text style={styles.actionText}>Send</Text>
            <Text style={styles.actionIcon}>&#8593;</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Transaction list */}
      <View style={styles.transactionsWrapper}>
        <ScrollView
          style={styles.transactionsContainer}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        >
          {hasWallets ? (
            <TransactionList transactions={transactions} />
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>Add a wallet to get started</Text>
            </View>
          )}
        </ScrollView>
      </View>

      <ReceiveSheet visible={receiveOpen} onClose={() => setReceiveOpen(false)} />
      <SendSheet visible={sendOpen} onClose={() => setSendOpen(false)} />
      <AddWalletWizard visible={wizardOpen} onClose={() => setWizardOpen(false)} />
      <WalletSettingsSheet
        walletId={settingsWalletId}
        onClose={() => setSettingsWalletId(null)}
      />
    </View>
  );
};

export default HomeScreen;

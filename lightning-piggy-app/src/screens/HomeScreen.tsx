import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { useWallet } from '../contexts/WalletContext';
import { colors } from '../styles/theme';
import { satsToFiatString } from '../services/fiatService';
import ReceiveSheet from '../components/ReceiveSheet';
import SendSheet from '../components/SendSheet';
import TransactionList from '../components/TransactionList';
import * as nwcService from '../services/nwcService';

const HomeScreen: React.FC = () => {
  const { balance, refreshBalance, userName, btcPrice, currency } = useWallet();
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    await refreshBalance();
    try {
      const txs = await nwcService.listTransactions();
      setTransactions(txs);
    } catch {}
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  return (
    <View style={styles.container}>
      {/* Header area with pink background and faded pig */}
      <View style={styles.headerBackground}>
        <Image
          source={require('../../assets/images/lightning-piggy-intro.png')}
          style={styles.pigImage}
          resizeMode="contain"
        />
        <View style={styles.headerContent}>
          <Text style={styles.hello}>Hello{userName ? `, ${userName}` : ''}!</Text>
          <TouchableOpacity onPress={handleRefresh}>
            <Text style={styles.balance}>
              {balance !== null ? `${balance.toLocaleString()} Sats` : 'Loading...'}
            </Text>
            {balance !== null && btcPrice !== null && (
              <Text style={styles.fiatBalance}>
                {satsToFiatString(balance, btcPrice, currency)}
              </Text>
            )}
          </TouchableOpacity>
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.actionButton} onPress={() => setReceiveOpen(true)}>
              <Text style={styles.actionIcon}>↓</Text>
              <Text style={styles.actionText}>Receive</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton} onPress={() => setSendOpen(true)}>
              <Text style={styles.actionText}>Send</Text>
              <Text style={styles.actionIcon}>↑</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Transaction list */}
      <ScrollView
        style={styles.transactionsContainer}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        <TransactionList transactions={transactions} />
      </ScrollView>

      <ReceiveSheet visible={receiveOpen} onClose={() => setReceiveOpen(false)} />
      <SendSheet visible={sendOpen} onClose={() => setSendOpen(false)} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerBackground: {
    height: 380,
    backgroundColor: colors.brandPink,
    overflow: 'hidden',
  },
  pigImage: {
    position: 'absolute',
    width: 420,
    height: 420,
    right: -60,
    top: -20,
    opacity: 0.6,
  },
  headerContent: {
    flex: 1,
    paddingTop: 60,
    paddingHorizontal: 24,
    gap: 24,
  },
  hello: {
    color: colors.white,
    fontSize: 28,
    fontWeight: '400',
  },
  balance: {
    color: colors.white,
    fontSize: 48,
    fontWeight: '700',
  },
  fiatBalance: {
    color: colors.white,
    fontSize: 18,
    fontWeight: '400',
    opacity: 0.8,
    marginTop: 4,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 20,
    marginTop: 16,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.white,
    height: 52,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  actionText: {
    color: colors.brandPink,
    fontSize: 16,
    fontWeight: '700',
  },
  actionIcon: {
    color: colors.brandPink,
    fontSize: 20,
    fontWeight: '700',
  },
  transactionsContainer: {
    flex: 1,
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: -20,
  },
});

export default HomeScreen;

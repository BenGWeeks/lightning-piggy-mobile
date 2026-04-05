import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Image, TouchableOpacity, ScrollView, RefreshControl, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import * as nip19 from 'nostr-tools/nip19';
import { useWallet } from '../contexts/WalletContext';
import { useNostr } from '../contexts/NostrContext';
import ReceiveSheet from '../components/ReceiveSheet';
import SendSheet from '../components/SendSheet';
import ContactProfileSheet from '../components/ContactProfileSheet';
import TransactionList from '../components/TransactionList';
import WalletCarousel from '../components/WalletCarousel';
import AddWalletWizard from '../components/AddWalletWizard';
import WalletSettingsSheet from '../components/WalletSettingsSheet';
import NfcIcon from '../components/icons/NfcIcon';
import ProfileIcon from '../components/ProfileIcon';
import * as nwcService from '../services/nwcService';
import {
  isNfcSupported,
  isNfcEnabled,
  openNfcSettings,
  scanNfcTag,
} from '../services/nfcService';
import { fetchProfile, DEFAULT_RELAYS } from '../services/nostrService';
import { resolveLnurl } from '../services/lnurlService';
import { styles } from '../styles/HomeScreen.styles';
import type { MainTabParamList } from '../navigation/types';
import type { NostrProfile } from '../types/nostr';

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
  const [sendToAddress, setSendToAddress] = useState<string | undefined>();
  const [sendToPicture, setSendToPicture] = useState<string | undefined>();
  const [sendToPubkey, setSendToPubkey] = useState<string | undefined>();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [settingsWalletId, setSettingsWalletId] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [nfcSupported, setNfcSupported] = useState(false);
  const [nfcScanning, setNfcScanning] = useState(false);
  const [nfcContact, setNfcContact] = useState<{
    pubkey: string;
    name: string;
    picture: string | null;
    banner?: string | null;
    nip05?: string | null;
    lightningAddress: string | null;
    source: 'nostr';
  } | null>(null);
  const [nfcContactSheetOpen, setNfcContactSheetOpen] = useState(false);

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
    await Promise.all([refreshActiveBalance(), fetchTransactions()]);
  }, [refreshActiveBalance, fetchTransactions]);

  useEffect(() => {
    if (activeWallet?.isConnected) {
      fetchData();
    } else {
      setTransactions([]);
    }
  }, [activeWalletId, activeWallet?.isConnected, fetchData]);

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

  // Check NFC hardware support
  useEffect(() => {
    isNfcSupported().then(setNfcSupported);
  }, []);

  const handleNfcScan = async () => {
    const enabled = await isNfcEnabled();
    if (!enabled) {
      Alert.alert(
        'NFC is Off',
        'Please enable NFC in your device settings to scan NFC tags.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: openNfcSettings },
        ],
      );
      return;
    }

    setNfcScanning(true);
    try {
      const result = await scanNfcTag();

      switch (result.type) {
        case 'lnurl': {
          // Resolve LNURL to determine pay vs withdraw
          try {
            const resolved = await resolveLnurl(result.data);
            if (resolved.tag === 'payRequest') {
              setSendToAddress(result.data);
              setSendOpen(true);
            } else if (resolved.tag === 'withdrawRequest') {
              // For LNURL-withdraw, open receive sheet
              // TODO: extend ReceiveSheet to handle LNURL-withdraw
              setReceiveOpen(true);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to resolve LNURL';
            Alert.alert('LNURL Error', msg);
          }
          break;
        }
        case 'lightning-invoice':
        case 'lightning-address':
          setSendToAddress(result.data);
          setSendOpen(true);
          break;
        case 'npub': {
          try {
            const decoded = nip19.decode(result.data);
            if (decoded.type !== 'npub') {
              Alert.alert('Error', 'Invalid npub on NFC tag.');
              break;
            }
            const hexPubkey = decoded.data;
            const profileData: NostrProfile | null = await fetchProfile(hexPubkey, DEFAULT_RELAYS);
            setNfcContact({
              pubkey: hexPubkey,
              name: profileData?.displayName || profileData?.name || result.data.slice(0, 16) + '...',
              picture: profileData?.picture || null,
              banner: profileData?.banner || null,
              nip05: profileData?.nip05 || null,
              lightningAddress: profileData?.lud16 || null,
              source: 'nostr',
            });
            setNfcContactSheetOpen(true);
          } catch {
            Alert.alert('Error', 'Could not resolve npub from NFC tag.');
          }
          break;
        }
        case 'unknown':
          Alert.alert('Unrecognized NFC Tag', `Tag content: ${result.data.slice(0, 100)}`);
          break;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'NFC scan failed';
      if (!msg.includes('cancelled')) {
        Alert.alert('NFC Error', msg);
      }
    } finally {
      setNfcScanning(false);
    }
  };

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

        {/* Send/Receive/NFC buttons */}
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
          {nfcSupported && (
            <TouchableOpacity
              style={[
                styles.actionButton,
                styles.nfcButton,
                (!hasActiveConnection || nfcScanning) && styles.actionButtonDisabled,
              ]}
              onPress={handleNfcScan}
              disabled={!hasActiveConnection || nfcScanning}
              accessibilityLabel="Scan NFC tag"
              testID="nfc-scan-button"
            >
              <NfcIcon size={22} color="#EC008C" />
            </TouchableOpacity>
          )}
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
      <AddWalletWizard visible={wizardOpen} onClose={() => setWizardOpen(false)} />
      <WalletSettingsSheet walletId={settingsWalletId} onClose={() => setSettingsWalletId(null)} />
      <ContactProfileSheet
        visible={nfcContactSheetOpen}
        onClose={() => {
          setNfcContactSheetOpen(false);
          setNfcContact(null);
        }}
        contact={nfcContact}
        onZap={
          nfcContact?.lightningAddress
            ? () => {
                setNfcContactSheetOpen(false);
                setSendToAddress(nfcContact.lightningAddress!);
                setSendToPicture(nfcContact.picture ?? undefined);
                setSendToPubkey(nfcContact.pubkey);
                setSendOpen(true);
              }
            : undefined
        }
      />
    </View>
  );
};

export default HomeScreen;

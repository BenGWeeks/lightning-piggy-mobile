import React, { useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Image,
  ActivityIndicator,
} from 'react-native';
import Svg, { Rect, Path as SvgPath } from 'react-native-svg';
import * as Clipboard from 'expo-clipboard';
import * as nip19 from 'nostr-tools/nip19';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWallet } from '../contexts/WalletContext';
import { useNostr } from '../contexts/NostrContext';
import { colors } from '../styles/theme';
import { CURRENCIES } from '../services/fiatService';
import { Trash2, Eye, EyeOff, ChevronUp, ChevronDown, Zap, Home, Copy } from 'lucide-react-native';
import {
  getElectrumServer,
  setElectrumServer,
  getBlossomServer,
  setBlossomServer,
  DEFAULT_BLOSSOM_SERVER,
} from '../services/walletStorageService';
import { disconnectElectrum } from '../services/onchainService';
import NfcIcon from '../components/icons/NfcIcon';
import NostrLoginSheet from '../components/NostrLoginSheet';
import EditProfileSheet from '../components/EditProfileSheet';
import QrSheet from '../components/QrSheet';
import SendSheet from '../components/SendSheet';
import FeedbackSheet from '../components/FeedbackSheet';
import NfcWriteSheet from '../components/NfcWriteSheet';
import { createDmSender } from '../utils/nostrDm';
import * as amberService from '../services/amberService';
import { fetchProfile, DEFAULT_RELAYS } from '../services/nostrService';
import { isNfcSupported, isNfcEnabled, openNfcSettings } from '../services/nfcService';
import type { NostrProfile } from '../types/nostr';
import type { MainTabParamList } from '../navigation/types';
import { LIGHTNING_PIGGY_TEAM_NPUB, dmRecipient } from '../constants/npubs';

const TEAM_PROFILE_CACHE_KEY = 'team_profile_cache';

const QrIcon: React.FC<{ size?: number; color?: string }> = ({ size = 20, color = '#FFFFFF' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect x="3" y="3" width="7" height="7" rx="1" stroke={color} strokeWidth={2} />
    <Rect x="14" y="3" width="7" height="7" rx="1" stroke={color} strokeWidth={2} />
    <Rect x="3" y="14" width="7" height="7" rx="1" stroke={color} strokeWidth={2} />
    <SvgPath
      d="M14 14h3v3h-3zM20 14v3h-3M14 20h3M20 20h0"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

const AccountScreen: React.FC = () => {
  const navigation = useNavigation<BottomTabNavigationProp<MainTabParamList>>();
  const insets = useSafeAreaInsets();
  const {
    userName,
    setUserName,
    currency,
    setCurrency,
    lightningAddress,
    setLightningAddress,
    wallets,
    removeWallet,
    updateWalletSettings,
    reorderWallet,
  } = useWallet();
  const {
    isLoggedIn,
    profile,
    logout,
    sendDirectMessage,
    signerType,
    amberNip44Permission,
    refreshProfile,
  } = useNostr();
  const [nameInput, setNameInput] = useState(userName);
  const [lnAddressInput, setLnAddressInput] = useState(lightningAddress || '');
  const [loginSheetOpen, setLoginSheetOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [qrSheetOpen, setQrSheetOpen] = useState(false);
  const [qrDefaultMode, setQrDefaultMode] = useState<'npub' | 'lightning'>('npub');
  const [teamProfile, setTeamProfile] = useState<NostrProfile | null>(null);
  const [teamProfileLoading, setTeamProfileLoading] = useState(true);
  const [zapSheetOpen, setZapSheetOpen] = useState(false);
  const [feedbackSheetOpen, setFeedbackSheetOpen] = useState(false);
  const [electrumHostPort, setElectrumHostPort] = useState('electrum.blockstream.info:50002');
  const [electrumSSL, setElectrumSSL] = useState(true);
  const [blossomServer, setBlossomServerInput] = useState(DEFAULT_BLOSSOM_SERVER);
  const [devMode, setDevMode] = useState(false);
  const [amberNip17Enabled, setAmberNip17Enabled] = useState(false);
  const [nfcSupported, setNfcSupported] = useState(false);
  const [nfcEnabled, setNfcEnabled] = useState(false);
  const [nfcWriteOpen, setNfcWriteOpen] = useState(false);
  const versionTapCount = useRef(0);
  const versionTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  // Fetch Lightning Piggy team profile
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const decoded = nip19.decode(LIGHTNING_PIGGY_TEAM_NPUB);
        if (decoded.type !== 'npub') return;
        const cached = await AsyncStorage.getItem(TEAM_PROFILE_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached) as NostrProfile;
          if (!cancelled) {
            setTeamProfile(parsed);
            setTeamProfileLoading(false);
          }
        }
        const fetched = await fetchProfile(decoded.data, DEFAULT_RELAYS);
        if (!cancelled && fetched) {
          setTeamProfile(fetched);
          await AsyncStorage.setItem(TEAM_PROFILE_CACHE_KEY, JSON.stringify(fetched));
        }
      } catch (error) {
        console.warn('Failed to fetch team profile:', error);
      } finally {
        if (!cancelled) setTeamProfileLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setNameInput(userName);
  }, [userName]);

  useEffect(() => {
    AsyncStorage.getItem('dev_mode').then((v) => setDevMode(v === 'true'));
    AsyncStorage.getItem('amber_nip17_enabled').then((v) => setAmberNip17Enabled(v === 'true'));
  }, []);

  // Force-refresh the own-profile kind-0 on focus so the header avatar
  // and displayed name here pick up external renames (e.g. via Amber or
  // another client) without waiting for the 24h cache to expire. See #148.
  useFocusEffect(
    useCallback(() => {
      if (isLoggedIn) refreshProfile();
    }, [isLoggedIn, refreshProfile]),
  );

  const toggleAmberNip17 = useCallback(() => {
    setAmberNip17Enabled((prev) => {
      const next = !prev;
      AsyncStorage.setItem('amber_nip17_enabled', next ? 'true' : 'false').catch(() => {});
      return next;
    });
  }, []);

  /**
   * Grant Amber blanket NIP-44 encrypt+decrypt permission via a one-shot
   * probe. We encrypt a tiny payload to the user's own pubkey and
   * immediately decrypt it — both round-trips use the non-silent API so
   * Amber's approval dialog appears, and the user can check "Remember my
   * choice" to bank the permission for subsequent silent refreshes.
   */
  const grantAmberNip44Permission = useCallback(async () => {
    if (!profile?.pubkey) throw new Error('No profile pubkey — log in first.');
    const probePlaintext = 'lightning-piggy-nip44-permission-probe';
    const ciphertext = await amberService.requestNip44Encrypt(
      probePlaintext,
      profile.pubkey,
      profile.pubkey,
    );
    const roundTrip = await amberService.requestNip44Decrypt(
      ciphertext,
      profile.pubkey,
      profile.pubkey,
    );
    if (roundTrip !== probePlaintext) {
      throw new Error('Amber round-trip mismatch — permission may not be set.');
    }
    // Next inbox refresh will hit the silent fast-path and flip
    // amberNip44Permission to 'granted' on its own.
  }, [profile?.pubkey]);

  const handleVersionTap = () => {
    versionTapCount.current += 1;
    if (versionTapTimer.current) clearTimeout(versionTapTimer.current);
    if (versionTapCount.current >= 3) {
      versionTapCount.current = 0;
      const newMode = !devMode;
      setDevMode(newMode);
      AsyncStorage.setItem('dev_mode', newMode ? 'true' : 'false');
      Alert.alert(
        newMode ? 'Developer Mode Enabled' : 'Developer Mode Disabled',
        newMode
          ? 'Hot wallet options are now available in Add Wallet.'
          : 'Hot wallet options hidden.',
      );
    } else {
      versionTapTimer.current = setTimeout(() => {
        versionTapCount.current = 0;
      }, 1000);
    }
  };

  useEffect(() => {
    getElectrumServer().then((server) => {
      const parts = server.split(':');
      const protocol = parts.pop(); // 's' or 't'
      setElectrumHostPort(parts.join(':'));
      setElectrumSSL(protocol === 's');
    });
    getBlossomServer().then(setBlossomServerInput);
  }, []);

  const handleBlossomSave = async () => {
    const normalized = blossomServer.trim() || DEFAULT_BLOSSOM_SERVER;
    setBlossomServerInput(normalized);
    await setBlossomServer(normalized);
  };

  const handleElectrumSave = async () => {
    const hostPort = electrumHostPort.trim() || 'electrum.blockstream.info:50002';
    setElectrumHostPort(hostPort);
    const value = `${hostPort}:${electrumSSL ? 's' : 't'}`;
    await setElectrumServer(value);
    disconnectElectrum(); // Force reconnect to new server on next sync
  };

  useEffect(() => {
    setLnAddressInput(lightningAddress || '');
  }, [lightningAddress]);

  // Check NFC hardware and status
  useEffect(() => {
    (async () => {
      const supported = await isNfcSupported();
      setNfcSupported(supported);
      if (supported) {
        const enabled = await isNfcEnabled();
        setNfcEnabled(enabled);
      }
    })();
  }, []);

  // Profile merge: when Nostr profile is loaded and has different values
  // Only prompt once per unique profile values (persisted so it doesn't nag)
  useEffect(() => {
    if (!profile) return;

    const nostrName = profile.displayName || profile.name;
    const nostrLn = profile.lud16;
    const changes: string[] = [];

    if (nostrName && nostrName !== userName) {
      changes.push(`Name: "${nostrName}"`);
    }
    if (nostrLn && nostrLn !== lightningAddress) {
      changes.push(`Lightning Address: "${nostrLn}"`);
    }

    if (changes.length === 0) return;

    // Check if we already prompted for these exact values
    const profileHash = `${nostrName}|${nostrLn}`;
    AsyncStorage.getItem('dismissed_profile_merge').then((dismissed) => {
      if (dismissed === profileHash) return;

      Alert.alert(
        'Update from Nostr Profile?',
        `Your Nostr profile has:\n${changes.join('\n')}\n\nWould you like to use these?`,
        [
          {
            text: 'Keep Current',
            style: 'cancel',
            onPress: () => AsyncStorage.setItem('dismissed_profile_merge', profileHash),
          },
          {
            text: 'Update',
            onPress: async () => {
              if (nostrName && nostrName !== userName) {
                await setUserName(nostrName);
              }
              if (nostrLn && nostrLn !== lightningAddress) {
                await setLightningAddress(nostrLn);
              }
              await AsyncStorage.setItem('dismissed_profile_merge', profileHash);
            },
          },
        ],
      );
    });
    // Only trigger on profile change, not on userName/lightningAddress changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  const handleSave = async () => {
    await setUserName(nameInput.trim());
    await setLightningAddress(lnAddressInput.trim() || null);
    Alert.alert('Saved', 'Your settings have been saved.');
  };

  const handleLogout = () => {
    Alert.alert('Logout', 'Disconnect your Nostr identity?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: () => logout(),
      },
    ]);
  };

  const copyNpub = async () => {
    if (profile?.npub) {
      await Clipboard.setStringAsync(profile.npub);
      Alert.alert('Copied', 'Your npub has been copied to clipboard.');
    }
  };

  const handleNfcWrite = async () => {
    if (!nfcSupported) return;
    const enabled = await isNfcEnabled();
    setNfcEnabled(enabled);
    if (!enabled) {
      Alert.alert('NFC is Off', 'Please enable NFC in your device settings to write to NFC tags.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: openNfcSettings },
      ]);
      return;
    }
    setNfcWriteOpen(true);
  };

  const connectedCount = wallets.filter((w) =>
    w.walletType === 'onchain' ? w.balance !== null : w.isConnected,
  ).length;
  const truncatedNpub = profile?.npub
    ? `${profile.npub.slice(0, 16)}...${profile.npub.slice(-8)}`
    : '';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <Image
        source={require('../../assets/images/nostrich.png')}
        style={styles.bgImage}
        resizeMode="contain"
      />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.titleRow}>
          <TouchableOpacity
            style={styles.homeButton}
            onPress={() => navigation.navigate('Home', {})}
            accessibilityLabel="Go home"
            testID="account-home-button"
          >
            <Home size={20} color={colors.brandPink} />
          </TouchableOpacity>
          <Text style={styles.title}>Account</Text>
        </View>

        {/* Nostr Profile Section */}
        {isLoggedIn && profile ? (
          <View style={styles.profileSection}>
            {profile.banner && (
              <Image source={{ uri: profile.banner }} style={styles.banner} resizeMode="cover" />
            )}
            <View style={styles.profileRow}>
              {profile.picture ? (
                <Image source={{ uri: profile.picture }} style={styles.profilePicture} />
              ) : (
                <View style={styles.profilePicturePlaceholder} />
              )}
              <View style={styles.profileInfo}>
                <Text style={styles.profileName}>
                  {profile.displayName || profile.name || 'Unknown'}
                </Text>
                {profile.nip05 && <Text style={styles.profileNip05}>{profile.nip05}</Text>}
              </View>
            </View>

            {/* npub */}
            <View style={styles.npubRow}>
              <TouchableOpacity style={styles.npubCopy} onPress={copyNpub}>
                <Text style={styles.npubText}>{truncatedNpub}</Text>
                <Copy size={20} color={colors.textSupplementary} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setQrDefaultMode('npub');
                  setQrSheetOpen(true);
                }}
              >
                <QrIcon size={22} color={colors.textSupplementary} />
              </TouchableOpacity>
              {nfcSupported && (
                <TouchableOpacity
                  onPress={handleNfcWrite}
                  accessibilityLabel="Write npub to NFC tag"
                  testID="nfc-write-npub"
                >
                  <NfcIcon size={22} color={colors.textSupplementary} />
                </TouchableOpacity>
              )}
            </View>

            {profile.lud16 && (
              <View style={styles.profileLnRow}>
                <Zap size={14} color={colors.white} />
                <Text style={styles.profileLn}>{profile.lud16}</Text>
              </View>
            )}

            <TouchableOpacity
              style={styles.editProfileButton}
              onPress={() => setEditProfileOpen(true)}
              accessibilityLabel="Edit Profile"
              testID="edit-profile-button"
            >
              <Text style={styles.editProfileButtonText}>Edit Profile</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.logoutButton}
              onPress={handleLogout}
              accessibilityLabel="Logout"
              testID="logout-button"
            >
              <Text style={styles.logoutButtonText}>Logout</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.connectButton}
            onPress={() => setLoginSheetOpen(true)}
            accessibilityLabel="Connect Nostr"
            testID="connect-nostr"
          >
            <Text style={styles.connectButtonText}>Connect Nostr</Text>
          </TouchableOpacity>
        )}

        {/* Name */}
        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Your Name</Text>
        <TextInput
          style={styles.textInput}
          placeholder="Enter your name"
          placeholderTextColor={colors.textSupplementary}
          value={nameInput}
          onChangeText={setNameInput}
          autoCapitalize="words"
          autoCorrect={false}
        />

        {/* Currency */}
        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Currency</Text>
        <View style={styles.currencyRow}>
          {CURRENCIES.map((cur) => (
            <TouchableOpacity
              key={cur}
              style={[styles.currencyChip, currency === cur && styles.currencyChipActive]}
              onPress={() => setCurrency(cur)}
            >
              <Text
                style={[styles.currencyChipText, currency === cur && styles.currencyChipTextActive]}
              >
                {cur}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Electrum Server */}
        {wallets.some((w) => w.walletType === 'onchain') && (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Electrum Server</Text>
            <TextInput
              style={styles.textInput}
              value={electrumHostPort}
              onChangeText={setElectrumHostPort}
              placeholder="electrum.blockstream.info:50002"
              placeholderTextColor={colors.textSupplementary}
              autoCapitalize="none"
              autoCorrect={false}
              onBlur={handleElectrumSave}
              testID="electrum-server-input"
              accessibilityLabel="Electrum server"
            />
            <View style={styles.sslRow}>
              <Text style={styles.sslLabel}>Use SSL</Text>
              <TouchableOpacity
                style={[styles.sslToggle, electrumSSL && styles.sslToggleActive]}
                onPress={() => {
                  setElectrumSSL(!electrumSSL);
                  // Auto-save when toggling
                  const hostPort = electrumHostPort.trim() || 'electrum.blockstream.info:50002';
                  setElectrumServer(`${hostPort}:${!electrumSSL ? 's' : 't'}`);
                  disconnectElectrum();
                }}
                testID="electrum-ssl-toggle"
                accessibilityLabel="Use SSL"
              >
                <View style={[styles.sslToggleThumb, electrumSSL && styles.sslToggleThumbActive]} />
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* Blossom media server (image uploads) */}
        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Image Server (Blossom)</Text>
        <TextInput
          style={styles.textInput}
          value={blossomServer}
          onChangeText={setBlossomServerInput}
          placeholder={DEFAULT_BLOSSOM_SERVER}
          placeholderTextColor={colors.textSupplementary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onBlur={handleBlossomSave}
          testID="blossom-server-input"
          accessibilityLabel="Blossom image server"
        />
        <Text style={styles.fieldHint}>
          Hosts images you send in chats and set as your profile picture. Any Blossom
          (BUD-01/BUD-02) server works — e.g. blossom.primal.net or nostr.build.
        </Text>

        {/* NIP-17 on Amber — only shown when signing via Amber */}
        {signerType === 'amber' && (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 24 }]}>
              Encrypted Messages (NIP-17)
            </Text>
            <View style={styles.sslRow}>
              <Text style={styles.sslLabel}>Enable NIP-17 on Amber</Text>
              <TouchableOpacity
                style={[styles.sslToggle, amberNip17Enabled && styles.sslToggleActive]}
                onPress={toggleAmberNip17}
                testID="amber-nip17-toggle"
                accessibilityLabel="Enable NIP-17 messages on Amber"
                accessibilityRole="switch"
                accessibilityState={{ checked: amberNip17Enabled }}
              >
                <View
                  style={[styles.sslToggleThumb, amberNip17Enabled && styles.sslToggleThumbActive]}
                />
              </TouchableOpacity>
            </View>
            <Text style={styles.fieldHint}>
              NIP-17 gift-wrapped messages hide sender metadata from relays, but each one requires a
              NIP-44 decrypt via Amber. When you first enable this, Amber will ask to approve — tap
              &quot;Remember my choice&quot; so subsequent messages load silently. Messages from
              people you don&apos;t follow stay hidden.
            </Text>
            {amberNip17Enabled && amberNip44Permission === 'denied' && (
              <>
                <Text style={[styles.fieldHint, { color: colors.brandPink, marginTop: 8 }]}>
                  Amber hasn&apos;t granted NIP-44 decrypt permission to this app yet — tap the
                  button below to grant it. One dialog, then subsequent messages decrypt silently.
                </Text>
                <TouchableOpacity
                  style={[styles.saveButton, { marginTop: 8 }]}
                  onPress={async () => {
                    try {
                      await grantAmberNip44Permission();
                    } catch (e) {
                      Alert.alert(
                        'Amber permission',
                        e instanceof Error ? e.message : 'Could not grant NIP-44 permission.',
                      );
                    }
                  }}
                  accessibilityLabel="Grant Amber NIP-44 permission"
                  testID="amber-nip17-grant"
                >
                  <Text style={styles.saveButtonText}>Grant permission in Amber</Text>
                </TouchableOpacity>
              </>
            )}
          </>
        )}

        {/* Wallets summary */}
        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Wallets</Text>
        <View style={styles.card}>
          <Text style={styles.walletSummary}>
            {wallets.length === 0
              ? 'No wallets connected. Add one from the Home screen.'
              : `${wallets.length} wallet${wallets.length !== 1 ? 's' : ''} (${connectedCount} connected)`}
          </Text>
          {wallets.map((w, index) => (
            <View key={w.id} style={styles.walletRow}>
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor:
                      w.walletType === 'onchain'
                        ? w.balance !== null
                          ? colors.green
                          : colors.red
                        : w.isConnected
                          ? colors.green
                          : colors.red,
                  },
                ]}
              />
              <Text style={styles.walletName} numberOfLines={1}>
                {w.alias}
                {w.walletType === 'onchain' ? ' (on-chain)' : ''}
              </Text>
              <Text style={styles.walletBalance}>
                {w.hideBalance
                  ? '***'
                  : w.balance !== null
                    ? `${w.balance.toLocaleString()} sats`
                    : '---'}
              </Text>
              <View style={styles.walletActions}>
                <TouchableOpacity
                  onPress={() => reorderWallet(w.id, 'up')}
                  disabled={index === 0}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <ChevronUp size={18} color={colors.white} opacity={index === 0 ? 0.3 : 0.8} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => reorderWallet(w.id, 'down')}
                  disabled={index === wallets.length - 1}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <ChevronDown
                    size={18}
                    color={colors.white}
                    opacity={index === wallets.length - 1 ? 0.3 : 0.8}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => updateWalletSettings(w.id, { hideBalance: !w.hideBalance })}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  {w.hideBalance ? (
                    <EyeOff size={18} color={colors.white} opacity={0.8} />
                  ) : (
                    <Eye size={18} color={colors.white} opacity={0.8} />
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() =>
                    Alert.alert(
                      'Remove Wallet',
                      `Remove "${w.alias}"? This will disconnect the wallet.`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Remove',
                          style: 'destructive',
                          onPress: () => removeWallet(w.id),
                        },
                      ],
                    )
                  }
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Trash2 size={18} color={colors.white} opacity={0.8} />
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>

        {/* Lightning Address */}
        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Lightning Address</Text>
        <View style={styles.lnAddressRow}>
          <TextInput
            style={[styles.textInput, { flex: 1 }]}
            placeholder="user@wallet.com"
            placeholderTextColor={colors.textSupplementary}
            value={lnAddressInput}
            onChangeText={setLnAddressInput}
            onFocus={() => {
              setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
              setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 500);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />
          {lnAddressInput.trim() && profile?.npub && (
            <TouchableOpacity
              style={styles.lnQrButton}
              onPress={() => {
                setQrDefaultMode('lightning');
                setQrSheetOpen(true);
              }}
            >
              <QrIcon size={22} color={colors.brandPink} />
            </TouchableOpacity>
          )}
        </View>

        {/* NFC Status */}
        {nfcSupported && (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 24 }]}>NFC</Text>
            <View style={styles.nfcStatusRow}>
              <NfcIcon size={20} color={nfcEnabled ? colors.green : colors.red} />
              <Text style={styles.nfcStatusText}>
                {nfcEnabled ? 'NFC is enabled' : 'NFC is disabled'}
              </Text>
              {!nfcEnabled && (
                <TouchableOpacity
                  onPress={openNfcSettings}
                  accessibilityLabel="Enable NFC in settings"
                  testID="nfc-enable-settings"
                >
                  <Text style={styles.nfcEnableText}>Enable</Text>
                </TouchableOpacity>
              )}
            </View>
          </>
        )}

        {/* Save button */}
        <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
          <Text style={styles.saveButtonText}>Save</Text>
        </TouchableOpacity>

        {/* Lightning Piggy Team */}
        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Support Lightning Piggy</Text>
        <View style={styles.teamCard}>
          {teamProfileLoading ? (
            <ActivityIndicator size="small" color={colors.brandPink} style={{ padding: 20 }} />
          ) : teamProfile ? (
            <>
              {teamProfile.banner && (
                <Image
                  source={{ uri: teamProfile.banner }}
                  style={styles.teamBanner}
                  resizeMode="cover"
                />
              )}
              <View style={styles.teamRow}>
                {teamProfile.picture ? (
                  <Image source={{ uri: teamProfile.picture }} style={styles.teamPicture} />
                ) : (
                  <View style={styles.teamPicturePlaceholder} />
                )}
                <View style={styles.teamInfo}>
                  <Text style={styles.teamName}>
                    {teamProfile.displayName || teamProfile.name || 'Lightning Piggy'}
                  </Text>
                  {teamProfile.about && (
                    <Text style={styles.teamAbout} numberOfLines={2}>
                      {teamProfile.about}
                    </Text>
                  )}
                </View>
              </View>
              <View style={styles.teamButtonRow}>
                {teamProfile.lud16 && (
                  <TouchableOpacity
                    style={styles.zapButton}
                    onPress={() => setZapSheetOpen(true)}
                    accessibilityLabel="Zap Lightning Piggy"
                    testID="zap-team-button"
                  >
                    <Text style={styles.zapButtonText}>{'\u26A1'} Zap the Team</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.feedbackButton}
                  onPress={() => setFeedbackSheetOpen(true)}
                  accessibilityLabel="Send Feedback"
                  testID="feedback-button"
                >
                  <Text style={styles.feedbackButtonText}>Send Feedback</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <Text style={styles.teamFallbackText}>Could not load team profile</Text>
          )}
        </View>
        {/* Version — triple-tap to toggle developer mode */}
        <TouchableOpacity onPress={handleVersionTap} activeOpacity={1}>
          <Text style={styles.versionText} testID="version-text">
            v{require('../../package.json').version}
            {devMode ? ' (dev)' : ''}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <NostrLoginSheet visible={loginSheetOpen} onClose={() => setLoginSheetOpen(false)} />
      <EditProfileSheet visible={editProfileOpen} onClose={() => setEditProfileOpen(false)} />
      {profile?.npub && (
        <>
          <QrSheet
            visible={qrSheetOpen}
            onClose={() => setQrSheetOpen(false)}
            npub={profile.npub}
            lightningAddress={profile.lud16 || lnAddressInput.trim() || null}
            defaultMode={qrDefaultMode}
          />
          <NfcWriteSheet
            visible={nfcWriteOpen}
            onClose={() => setNfcWriteOpen(false)}
            npub={profile.npub}
            displayName={profile.displayName || profile.name || 'Your'}
          />
        </>
      )}
      {teamProfile?.lud16 && (
        <SendSheet
          visible={zapSheetOpen}
          onClose={() => setZapSheetOpen(false)}
          initialAddress={teamProfile.lud16}
          initialPicture={teamProfile.picture || undefined}
          recipientPubkey={teamProfile.pubkey}
        />
      )}
      <FeedbackSheet
        visible={feedbackSheetOpen}
        onClose={() => setFeedbackSheetOpen(false)}
        onSend={createDmSender(dmRecipient(LIGHTNING_PIGGY_TEAM_NPUB), sendDirectMessage)}
        isLoggedIn={isLoggedIn}
        signerType={signerType}
        onLoginPress={() => setLoginSheetOpen(true)}
      />
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.brandPink,
  },
  bgImage: {
    position: 'absolute',
    width: 420,
    height: 420,
    right: -60,
    top: -20,
    opacity: 0.15,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 24,
  },
  homeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    color: colors.white,
    fontSize: 28,
    fontWeight: '700',
  },
  // Nostr profile styles
  profileSection: {
    backgroundColor: colors.white,
    borderRadius: 16,
    overflow: 'hidden',
  },
  banner: {
    width: '100%',
    height: 100,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  profilePicture: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: colors.divider,
  },
  profilePicturePlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.background,
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    color: colors.textHeader,
    fontSize: 18,
    fontWeight: '700',
  },
  profileNip05: {
    color: colors.textSupplementary,
    fontSize: 13,
    marginTop: 2,
  },
  npubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  npubCopy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  npubText: {
    color: colors.textSupplementary,
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  profileLnRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 4,
  },
  profileLn: {
    color: colors.textBody,
    fontSize: 14,
  },
  editProfileButton: {
    margin: 16,
    marginBottom: 0,
    height: 44,
    borderRadius: 10,
    backgroundColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.brandPink,
  },
  editProfileButtonText: {
    color: colors.brandPink,
    fontSize: 14,
    fontWeight: '600',
  },
  logoutButton: {
    margin: 16,
    marginTop: 8,
    height: 44,
    borderRadius: 10,
    backgroundColor: colors.brandPink,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoutButtonText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
  connectButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    height: 52,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  connectButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
  },
  // Existing styles
  sectionLabel: {
    color: colors.white,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: colors.textBody,
    fontWeight: '600',
  },
  fieldHint: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    marginTop: 4,
  },
  sslRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingHorizontal: 4,
  },
  sslLabel: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
  sslToggle: {
    width: 48,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  sslToggleActive: {
    backgroundColor: '#4CAF50',
  },
  sslToggleThumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.white,
  },
  sslToggleThumbActive: {
    alignSelf: 'flex-end',
  },
  lnAddressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  lnQrButton: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
  },
  currencyRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  currencyChip: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 10,
    borderRadius: 8,
    width: '23%',
    alignItems: 'center',
  },
  currencyChipActive: {
    backgroundColor: colors.white,
  },
  currencyChipText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
  currencyChipTextActive: {
    color: colors.brandPink,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 16,
    padding: 20,
    gap: 12,
  },
  walletSummary: {
    color: colors.white,
    fontSize: 14,
    opacity: 0.9,
  },
  walletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  walletName: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  walletBalance: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '400',
    opacity: 0.8,
  },
  nfcStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12,
    padding: 16,
  },
  nfcStatusText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  nfcEnableText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  walletActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  saveButton: {
    backgroundColor: colors.white,
    height: 52,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  saveButtonText: {
    color: colors.brandPink,
    fontSize: 16,
    fontWeight: '700',
  },
  // Team profile card styles
  teamCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    overflow: 'hidden',
  },
  teamBanner: {
    width: '100%',
    height: 80,
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  teamPicture: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.divider,
  },
  teamPicturePlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.background,
  },
  teamInfo: {
    flex: 1,
  },
  teamName: {
    color: colors.textHeader,
    fontSize: 16,
    fontWeight: '700',
  },
  teamAbout: {
    color: colors.textSupplementary,
    fontSize: 12,
    marginTop: 2,
  },
  teamButtonRow: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 8,
  },
  zapButton: {
    height: 44,
    borderRadius: 10,
    backgroundColor: colors.brandPink,
    justifyContent: 'center',
    alignItems: 'center',
  },
  zapButtonText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
  feedbackButton: {
    height: 44,
    borderRadius: 10,
    backgroundColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.brandPink,
  },
  feedbackButtonText: {
    color: colors.brandPink,
    fontSize: 14,
    fontWeight: '600',
  },
  teamFallbackText: {
    color: colors.textSupplementary,
    fontSize: 14,
    padding: 20,
    textAlign: 'center',
  },
  versionText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    textAlign: 'center',
    paddingTop: 24,
    paddingBottom: 0,
  },
});

export default AccountScreen;

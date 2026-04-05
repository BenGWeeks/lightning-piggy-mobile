import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWallet } from '../contexts/WalletContext';
import { useNostr } from '../contexts/NostrContext';
import { colors } from '../styles/theme';
import { CURRENCIES } from '../services/fiatService';
import CopyIcon from '../components/icons/CopyIcon';
import NostrLoginSheet from '../components/NostrLoginSheet';
import EditProfileSheet from '../components/EditProfileSheet';
import QrSheet from '../components/QrSheet';
import SendSheet from '../components/SendSheet';
import FeedbackSheet from '../components/FeedbackSheet';
import { fetchProfile, DEFAULT_RELAYS } from '../services/nostrService';
import type { NostrProfile } from '../types/nostr';
import type { MainTabParamList } from '../navigation/types';

// Lightning Piggy team npub — update this if the team key changes
const TEAM_NPUB = 'npub1y2qcaseaspuwvjtyk4suswdhgselydc42ttlt0t2kzhnykne7s5swvaffq';

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
  } = useWallet();
  const { isLoggedIn, profile, logout, sendDirectMessage, signerType } = useNostr();
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
  const scrollRef = useRef<ScrollView>(null);

  // Fetch Lightning Piggy team profile
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const decoded = nip19.decode(TEAM_NPUB);
        if (decoded.type !== 'npub') return;
        const cached = await AsyncStorage.getItem('team_profile_cache');
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
          await AsyncStorage.setItem('team_profile_cache', JSON.stringify(fetched));
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
    setLnAddressInput(lightningAddress || '');
  }, [lightningAddress]);

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

  const connectedCount = wallets.filter((w) => w.isConnected).length;
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
            <Image
              source={require('../../assets/images/Home.png')}
              style={styles.homeIcon}
              resizeMode="contain"
            />
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
                <CopyIcon size={20} color={colors.textSupplementary} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setQrDefaultMode('npub');
                  setQrSheetOpen(true);
                }}
              >
                <QrIcon size={22} color={colors.textSupplementary} />
              </TouchableOpacity>
            </View>

            {profile.lud16 && (
              <Text style={styles.profileLn}>
                {'\u26A1'} {profile.lud16}
              </Text>
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

        {/* Wallets summary */}
        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Wallets</Text>
        <View style={styles.card}>
          <Text style={styles.walletSummary}>
            {wallets.length === 0
              ? 'No wallets connected. Add one from the Home screen.'
              : `${wallets.length} wallet${wallets.length !== 1 ? 's' : ''} (${connectedCount} connected)`}
          </Text>
          {wallets.map((w) => (
            <View key={w.id} style={styles.walletRow}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: w.isConnected ? colors.green : colors.red },
                ]}
              />
              <Text style={styles.walletName}>{w.alias}</Text>
              {w.balance !== null && (
                <Text style={styles.walletBalance}>{w.balance.toLocaleString()} sats</Text>
              )}
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
      </ScrollView>

      <NostrLoginSheet visible={loginSheetOpen} onClose={() => setLoginSheetOpen(false)} />
      <EditProfileSheet visible={editProfileOpen} onClose={() => setEditProfileOpen(false)} />
      {profile?.npub && (
        <QrSheet
          visible={qrSheetOpen}
          onClose={() => setQrSheetOpen(false)}
          npub={profile.npub}
          lightningAddress={profile.lud16 || lnAddressInput.trim() || null}
          defaultMode={qrDefaultMode}
        />
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
        onSend={(msg) => {
          const decoded = nip19.decode(TEAM_NPUB);
          if (decoded.type !== 'npub') {
            return Promise.resolve({ success: false, error: 'Invalid team npub' });
          }
          return sendDirectMessage(decoded.data, msg);
        }}
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
  homeIcon: {
    width: 20,
    height: 20,
    tintColor: colors.brandPink,
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
  profileLn: {
    color: colors.textBody,
    fontSize: 14,
    paddingHorizontal: 16,
    paddingBottom: 12,
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
});

export default AccountScreen;

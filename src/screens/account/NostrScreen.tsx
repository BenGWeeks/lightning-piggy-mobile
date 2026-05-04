import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Alert } from '../../components/BrandedAlert';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { X as XIcon } from 'lucide-react-native';
import AccountScreenLayout from './AccountScreenLayout';
import { createSharedAccountStyles } from './sharedStyles';
import {
  getBlossomServer,
  setBlossomServer,
  DEFAULT_BLOSSOM_SERVER,
} from '../../services/walletStorageService';
import * as amberService from '../../services/amberService';
import { DEFAULT_RELAYS, getRelayConnectionStatus } from '../../services/nostrService';
import { validateRelayUrl } from '../../services/nostrRelayStorage';
import { useNostr } from '../../contexts/NostrContext';
import { useThemeColors } from '../../contexts/ThemeContext';
import type { Palette } from '../../styles/palettes';

type RelayRow = {
  url: string;
  /**
   * 'user' = user-added override only, removable from this screen.
   * 'default' = baked into the app, not removable here.
   * 'nip65' = published in the user's kind-10002 (NIP-65) list.
   * 'both-user-default' / 'both-user-nip65' = covered by multiple
   * sources; treated as user-removable because the user explicitly
   * opted in by re-adding it on top of the default/NIP-65.
   */
  source: 'user' | 'default' | 'nip65' | 'both-user-default' | 'both-user-nip65';
  read: boolean;
  write: boolean;
  connected: boolean;
};

const NostrScreen: React.FC = () => {
  const colors = useThemeColors();
  const sharedAccountStyles = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const {
    profile,
    signerType,
    amberNip44Permission,
    relays,
    userRelays,
    addUserRelay,
    removeUserRelay,
  } = useNostr();
  const [connStatus, setConnStatus] = useState<Map<string, boolean>>(new Map());
  const [newRelayInput, setNewRelayInput] = useState('');
  const [addRelayError, setAddRelayError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      const tick = () => setConnStatus(new Map(getRelayConnectionStatus()));
      tick();
      const id = setInterval(tick, 3000);
      return () => clearInterval(id);
    }, []),
  );

  const relayRows = useMemo<RelayRow[]>(() => {
    const userSet = new Set(userRelays.map((r) => r.url));
    const defaultSet = new Set<string>(DEFAULT_RELAYS);
    return relays.map((r) => {
      const inUser = userSet.has(r.url);
      const inDefault = defaultSet.has(r.url);
      let source: RelayRow['source'];
      if (inUser && inDefault) source = 'both-user-default';
      else if (inUser) source = 'user';
      else if (inDefault) source = 'default';
      else source = 'nip65';
      // A NIP-65 relay the user has also re-added explicitly is user-managed.
      if (inUser && !inDefault && source !== 'user') source = 'both-user-nip65';
      return {
        url: r.url,
        source,
        read: r.read,
        write: r.write,
        connected: connStatus.get(r.url) === true,
      };
    });
  }, [relays, userRelays, connStatus]);

  const handleAddRelay = useCallback(async () => {
    const result = validateRelayUrl(newRelayInput);
    if (!result.ok) {
      setAddRelayError(result.error);
      return;
    }
    setAddRelayError(null);
    try {
      await addUserRelay({ url: result.url, read: true, write: true });
      setNewRelayInput('');
    } catch (e) {
      setAddRelayError(e instanceof Error ? e.message : 'Failed to add relay.');
    }
  }, [addUserRelay, newRelayInput]);

  const handleRemoveRelay = useCallback(
    async (url: string) => {
      try {
        await removeUserRelay(url);
      } catch (e) {
        Alert.alert('Remove relay', e instanceof Error ? e.message : 'Failed to remove relay.');
      }
    },
    [removeUserRelay],
  );
  const [blossomServer, setBlossomServerInput] = useState(DEFAULT_BLOSSOM_SERVER);
  const [amberNip17Enabled, setAmberNip17Enabled] = useState(false);

  useEffect(() => {
    getBlossomServer().then(setBlossomServerInput);
    AsyncStorage.getItem('amber_nip17_enabled').then((v) => setAmberNip17Enabled(v === 'true'));
  }, []);

  const handleBlossomSave = async () => {
    const normalized = blossomServer.trim() || DEFAULT_BLOSSOM_SERVER;
    setBlossomServerInput(normalized);
    await setBlossomServer(normalized);
  };

  const toggleAmberNip17 = useCallback(() => {
    setAmberNip17Enabled((prev) => {
      const next = !prev;
      AsyncStorage.setItem('amber_nip17_enabled', next ? 'true' : 'false').catch(() => {});
      return next;
    });
  }, []);

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
  }, [profile?.pubkey]);

  return (
    <AccountScreenLayout title="Nostr">
      <Text style={sharedAccountStyles.sectionLabel}>Relays</Text>
      <View style={styles.relayList}>
        {relayRows.map((r) => {
          const mode = r.read && r.write ? 'read/write' : r.write ? 'write' : 'read';
          const sourceLabel =
            r.source === 'both-user-default'
              ? 'user + default'
              : r.source === 'both-user-nip65'
                ? 'user + NIP-65'
                : r.source === 'user'
                  ? 'user'
                  : r.source === 'nip65'
                    ? 'NIP-65'
                    : 'default';
          const removable = r.source === 'user' || r.source === 'both-user-nip65';
          return (
            <View key={r.url} style={styles.relayRow}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: r.connected ? colors.green : colors.red },
                ]}
                accessibilityLabel={r.connected ? 'Connected' : 'Disconnected'}
              />
              <View style={styles.relayMain}>
                <Text style={styles.relayUrl} numberOfLines={1} ellipsizeMode="middle">
                  {r.url}
                </Text>
                <Text style={styles.relaySource}>{sourceLabel}</Text>
              </View>
              <Text style={styles.relayMode}>{mode}</Text>
              {removable && (
                <TouchableOpacity
                  onPress={() => handleRemoveRelay(r.url)}
                  style={styles.removeButton}
                  testID={`relay-list-remove-${r.url}`}
                  accessibilityLabel={`Remove relay ${r.url}`}
                  accessibilityRole="button"
                  hitSlop={8}
                >
                  <XIcon size={16} color={colors.white} />
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </View>
      <View style={styles.addRelayRow}>
        <TextInput
          style={[sharedAccountStyles.textInput, styles.addRelayInput]}
          value={newRelayInput}
          onChangeText={(t) => {
            setNewRelayInput(t);
            if (addRelayError) setAddRelayError(null);
          }}
          placeholder="wss://relay.example.com"
          placeholderTextColor="rgba(0,0,0,0.3)"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onSubmitEditing={handleAddRelay}
          testID="relay-list-add-input"
          accessibilityLabel="Add relay URL"
        />
        <TouchableOpacity
          style={styles.addRelayButton}
          onPress={handleAddRelay}
          testID="relay-list-add-button"
          accessibilityLabel="Add relay"
          accessibilityRole="button"
        >
          <Text style={styles.addRelayButtonText}>Add</Text>
        </TouchableOpacity>
      </View>
      {addRelayError && (
        <Text
          style={[sharedAccountStyles.fieldHint, { color: colors.brandPink }]}
          testID="relay-list-add-error"
        >
          {addRelayError}
        </Text>
      )}
      <Text style={sharedAccountStyles.fieldHint}>
        Green dot = currently connected. NIP-65 relays come from your published kind-10002 list;
        defaults are baked into the app and always tried as a fallback. Add your own relays above —
        they&apos;re saved on this device and used for the next subscription / publish.
      </Text>

      <Text style={[sharedAccountStyles.sectionLabel, { marginTop: 24 }]}>
        Image Server (Blossom)
      </Text>
      <TextInput
        style={sharedAccountStyles.textInput}
        value={blossomServer}
        onChangeText={setBlossomServerInput}
        placeholder={DEFAULT_BLOSSOM_SERVER}
        placeholderTextColor="rgba(0,0,0,0.3)"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        onBlur={handleBlossomSave}
        testID="blossom-server-input"
        accessibilityLabel="Blossom image server"
      />
      <Text style={sharedAccountStyles.fieldHint}>
        Hosts images you send in chats and set as your profile picture. Any Blossom (BUD-01/BUD-02)
        server works — e.g. blossom.primal.net or nostr.build.
      </Text>

      {signerType === 'amber' && (
        <>
          <Text style={[sharedAccountStyles.sectionLabel, { marginTop: 24 }]}>
            Encrypted Messages (NIP-17)
          </Text>
          <View style={sharedAccountStyles.sslRow}>
            <Text style={sharedAccountStyles.sslLabel}>Enable NIP-17 on Amber</Text>
            <TouchableOpacity
              style={[
                sharedAccountStyles.sslToggle,
                amberNip17Enabled && sharedAccountStyles.sslToggleActive,
              ]}
              onPress={toggleAmberNip17}
              testID="amber-nip17-toggle"
              accessibilityLabel="Enable NIP-17 messages on Amber"
              accessibilityRole="switch"
              accessibilityState={{ checked: amberNip17Enabled }}
            >
              <View
                style={[
                  sharedAccountStyles.sslToggleThumb,
                  amberNip17Enabled && sharedAccountStyles.sslToggleThumbActive,
                ]}
              />
            </TouchableOpacity>
          </View>
          <Text style={sharedAccountStyles.fieldHint}>
            NIP-17 gift-wrapped messages hide sender metadata from relays, but each one requires a
            NIP-44 decrypt via Amber. When you first enable this, Amber will ask to approve — tap
            &quot;Remember my choice&quot; so subsequent messages load silently. Messages from
            people you don&apos;t follow stay hidden.
          </Text>
          {amberNip17Enabled && amberNip44Permission === 'denied' && (
            <>
              <Text
                style={[sharedAccountStyles.fieldHint, { color: colors.brandPink, marginTop: 8 }]}
              >
                Amber hasn&apos;t granted NIP-44 decrypt permission to this app yet — tap the button
                below to grant it. One dialog, then subsequent messages decrypt silently.
              </Text>
              <TouchableOpacity
                style={[sharedAccountStyles.saveButton, { marginTop: 8 }]}
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
                <Text style={sharedAccountStyles.saveButtonText}>Grant permission in Amber</Text>
              </TouchableOpacity>
            </>
          )}
        </>
      )}
    </AccountScreenLayout>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    relayList: {
      backgroundColor: 'rgba(255,255,255,0.1)',
      borderRadius: 10,
      paddingVertical: 4,
    },
    relayRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      paddingHorizontal: 12,
      gap: 10,
    },
    statusDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      borderWidth: 1,
      borderColor: colors.white,
    },
    relayMain: {
      flex: 1,
    },
    relayUrl: {
      color: colors.white,
      fontSize: 13,
    },
    relaySource: {
      color: colors.white,
      fontSize: 10,
      opacity: 0.6,
      marginTop: 1,
    },
    relayMode: {
      color: colors.white,
      fontSize: 11,
      opacity: 0.7,
      fontWeight: '500',
    },
    removeButton: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.15)',
    },
    addRelayRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 12,
    },
    addRelayInput: {
      flex: 1,
    },
    addRelayButton: {
      backgroundColor: colors.surface,
      paddingHorizontal: 16,
      height: 52,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
    },
    addRelayButtonText: {
      color: colors.brandPink,
      fontSize: 14,
      fontWeight: '700',
    },
  });

export default NostrScreen;

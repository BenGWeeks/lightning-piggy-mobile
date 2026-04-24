import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import AccountScreenLayout from './AccountScreenLayout';
import { sharedAccountStyles } from './sharedStyles';
import {
  getBlossomServer,
  setBlossomServer,
  DEFAULT_BLOSSOM_SERVER,
} from '../../services/walletStorageService';
import * as amberService from '../../services/amberService';
import { DEFAULT_RELAYS, getRelayConnectionStatus } from '../../services/nostrService';
import { useNostr } from '../../contexts/NostrContext';
import { colors } from '../../styles/theme';

type RelayRow = {
  url: string;
  source: 'user' | 'default' | 'both';
  read: boolean;
  write: boolean;
  connected: boolean;
};

const NostrScreen: React.FC = () => {
  const { profile, signerType, amberNip44Permission, relays } = useNostr();
  const [connStatus, setConnStatus] = useState<Map<string, boolean>>(new Map());

  useFocusEffect(
    useCallback(() => {
      const tick = () => setConnStatus(new Map(getRelayConnectionStatus()));
      tick();
      const id = setInterval(tick, 3000);
      return () => clearInterval(id);
    }, []),
  );

  const relayRows = useMemo<RelayRow[]>(() => {
    const userMap = new Map(relays.map((r) => [r.url, r]));
    const defaultSet = new Set<string>(DEFAULT_RELAYS);
    const urls = new Set<string>([...userMap.keys(), ...defaultSet]);
    return [...urls].map((url) => {
      const u = userMap.get(url);
      const inDefault = defaultSet.has(url);
      const source: RelayRow['source'] = u && inDefault ? 'both' : u ? 'user' : 'default';
      return {
        url,
        source,
        read: u ? u.read : true,
        write: u ? u.write : true,
        connected: connStatus.get(url) === true,
      };
    });
  }, [relays, connStatus]);
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
            r.source === 'both' ? 'NIP-65 + default' : r.source === 'user' ? 'NIP-65' : 'default';
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
            </View>
          );
        })}
      </View>
      <Text style={sharedAccountStyles.fieldHint}>
        Green dot = currently connected. NIP-65 relays come from your published kind-10002 list;
        defaults are baked into the app and always tried as a fallback. Editing is not yet supported
        in-app — update via another Nostr client for now.
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

const styles = StyleSheet.create({
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
});

export default NostrScreen;

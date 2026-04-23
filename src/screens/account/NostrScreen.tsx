import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AccountScreenLayout from './AccountScreenLayout';
import { sharedAccountStyles } from './sharedStyles';
import {
  getBlossomServer,
  setBlossomServer,
  DEFAULT_BLOSSOM_SERVER,
} from '../../services/walletStorageService';
import * as amberService from '../../services/amberService';
import { useNostr } from '../../contexts/NostrContext';
import { colors } from '../../styles/theme';

const NostrScreen: React.FC = () => {
  const { profile, signerType, amberNip44Permission } = useNostr();
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
      <Text style={sharedAccountStyles.sectionLabel}>Image Server (Blossom)</Text>
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

export default NostrScreen;

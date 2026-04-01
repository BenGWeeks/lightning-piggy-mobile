import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { fetchPhoneContacts, setLightningAddress, PhoneContact } from '../services/contactsService';
import ContactListItem from './ContactListItem';
import { colors } from '../styles/theme';

interface Props {
  search: string;
  onZap: (address: string) => void;
}

const PhoneContactList: React.FC<Props> = ({ search, onZap }) => {
  const [contacts, setContacts] = useState<PhoneContact[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [loaded, setLoaded] = useState(false);

  const loadContacts = useCallback(async () => {
    const result = await fetchPhoneContacts();
    setContacts(result);
    setLoaded(true);
  }, []);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  const filteredContacts = search.trim()
    ? contacts.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          (c.lightningAddress && c.lightningAddress.toLowerCase().includes(search.toLowerCase())),
      )
    : contacts;

  const handleSaveAddress = async (contactId: string) => {
    const trimmed = editValue.trim();
    if (!trimmed || !trimmed.includes('@')) {
      Alert.alert('Invalid', 'Please enter a valid Lightning address (e.g. user@wallet.com)');
      return;
    }
    await setLightningAddress(contactId, trimmed);
    setContacts((prev) =>
      prev.map((c) => (c.id === contactId ? { ...c, lightningAddress: trimmed } : c)),
    );
    setEditingId(null);
    setEditValue('');
  };

  const renderContact = ({ item }: { item: PhoneContact }) => {
    if (editingId === item.id) {
      return (
        <View style={styles.editRow}>
          <Text style={styles.editName}>{item.name}</Text>
          <View style={styles.editInputRow}>
            <TextInput
              style={styles.editInput}
              placeholder="user@wallet.com"
              placeholderTextColor={colors.textSupplementary}
              value={editValue}
              onChangeText={setEditValue}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoFocus
            />
            <TouchableOpacity style={styles.editSave} onPress={() => handleSaveAddress(item.id)}>
              <Text style={styles.editSaveText}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.editCancel}
              onPress={() => {
                setEditingId(null);
                setEditValue('');
              }}
            >
              <Text style={styles.editCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return (
      <TouchableOpacity
        activeOpacity={item.lightningAddress ? 1 : 0.6}
        onLongPress={() => {
          setEditingId(item.id);
          setEditValue(item.lightningAddress || '');
        }}
      >
        <ContactListItem
          name={item.name}
          lightningAddress={item.lightningAddress}
          onZap={item.lightningAddress ? () => onZap(item.lightningAddress!) : undefined}
        />
        {!item.lightningAddress && (
          <TouchableOpacity
            style={styles.addAddress}
            onPress={() => {
              setEditingId(item.id);
              setEditValue('');
            }}
          >
            <Text style={styles.addAddressText}>+ Add Lightning Address</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  if (!loaded) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyText}>Loading contacts...</Text>
      </View>
    );
  }

  if (contacts.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyText}>
          No contacts available. Please grant contacts permission in your device settings.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={filteredContacts}
      keyExtractor={(item) => item.id}
      renderItem={renderContact}
      contentContainerStyle={styles.listContent}
      ListEmptyComponent={
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No contacts match your search.</Text>
        </View>
      }
    />
  );
};

const styles = StyleSheet.create({
  listContent: {
    paddingTop: 12,
    paddingBottom: 20,
  },
  editRow: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 8,
  },
  editName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textHeader,
  },
  editInputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  editInput: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.textBody,
  },
  editSave: {
    backgroundColor: colors.brandPink,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  editSaveText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '700',
  },
  editCancel: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  editCancelText: {
    color: colors.textSupplementary,
    fontSize: 13,
    fontWeight: '600',
  },
  addAddress: {
    paddingHorizontal: 76,
    paddingBottom: 8,
  },
  addAddressText: {
    color: colors.brandPink,
    fontSize: 13,
    fontWeight: '600',
  },
  emptyState: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    color: colors.textSupplementary,
    fontSize: 14,
    textAlign: 'center',
  },
});

export default PhoneContactList;

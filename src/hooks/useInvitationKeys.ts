import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useNostr } from '../contexts/NostrContext';
import { useTranslation } from '../contexts/LocaleContext';
import { Alert } from '../components/BrandedAlert';
import Toast from '../components/BrandedToast';
import { getMarmotSession } from '../services/marmotSession';
import {
  loadInvitationKeys,
  oldInvitationKeys,
  removeInvitationKeys,
  type InvitationInventory,
  type InvitationKey,
} from '../services/marmotInvitationKeys';

export function useInvitationKeys() {
  const { pubkey, userRelays, signEvent } = useNostr();
  const t = useTranslation();
  const [inventory, setInventory] = useState<InvitationInventory>({
    keys: [],
    partial: false,
    paused: false,
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const owner = useRef(pubkey);
  owner.current = pubkey;
  const sequence = useRef(0);
  const action = useRef(false);
  const relays = useMemo(() => userRelays.map((r) => r.url), [userRelays]);
  const reload = useCallback(async () => {
    const seq = ++sequence.current;
    if (!pubkey) return;
    setLoading(true);
    setError(false);
    try {
      const result = await loadInvitationKeys(pubkey, relays);
      if (seq === sequence.current && owner.current === pubkey) setInventory(result);
    } catch {
      if (seq === sequence.current) setError(true);
    } finally {
      if (seq === sequence.current) setLoading(false);
    }
  }, [pubkey, relays]);
  useFocusEffect(
    useCallback(() => {
      setInventory({ keys: [], partial: false, paused: false });
      void reload();
      return () => {
        ++sequence.current;
      };
    }, [reload]),
  );

  const perform = useCallback(
    async (selected?: InvitationKey[]) => {
      if (!pubkey || action.current) return;
      action.current = true;
      setBusy(true);
      try {
        const session = getMarmotSession();
        if (selected) {
          await removeInvitationKeys({
            owner: pubkey,
            selected,
            inventory: inventory.keys,
            relays,
            isCurrent: () => owner.current === pubkey,
            sign: async (template) => {
              const event = await signEvent(template);
              if (!event) throw new Error('Signature declined');
              return event;
            },
          });
        } else {
          if (session?.pubkey !== pubkey) throw new Error('Session unavailable');
          await session.refreshInvitationKey();
        }
        if (owner.current === pubkey)
          Toast.show({
            type: 'success',
            text1: t(selected ? 'invitationKeys.removed' : 'invitationKeys.refreshed'),
          });
      } catch {
        if (owner.current === pubkey)
          Alert.alert(t('invitationKeys.failedTitle'), t('invitationKeys.failedBody'));
      } finally {
        action.current = false;
        setBusy(false);
        if (owner.current === pubkey) await reload();
      }
    },
    [pubkey, inventory.keys, relays, signEvent, t, reload],
  );
  const confirm = useCallback(
    (selected: InvitationKey[], old = false) => {
      const confirmedOwner = pubkey;
      Alert.alert(
        t(old ? 'invitationKeys.removeOld' : 'invitationKeys.removeTitle'),
        t(old ? 'invitationKeys.removeOldBody' : 'invitationKeys.removeBody'),
        [
          { text: t('invitationKeys.cancel'), style: 'cancel' },
          {
            text: t('invitationKeys.remove'),
            style: 'destructive',
            onPress: () => {
              if (owner.current === confirmedOwner) void perform(selected);
            },
          },
        ],
      );
    },
    [pubkey, t, perform],
  );
  const remove = useCallback(
    (key: InvitationKey) => {
      const versions = inventory.keys.filter((k) => k.slot === key.slot);
      // Removing the current version retires its slot, preventing older relays
      // from continuing to advertise a superseded version as current.
      confirm(versions[0]?.event.id === key.event.id ? versions : [key]);
    },
    [inventory.keys, confirm],
  );
  const old = useMemo(
    () => (inventory.partial ? [] : oldInvitationKeys(inventory.keys)),
    [inventory.keys, inventory.partial],
  );
  const removeOld = useCallback(() => confirm(old, true), [confirm, old]);
  const refresh = useCallback(() => {
    void perform();
  }, [perform]);
  return {
    ...inventory,
    loading,
    busy,
    error,
    reload,
    remove,
    removeOld,
    refresh,
    oldCount: old.length,
  };
}

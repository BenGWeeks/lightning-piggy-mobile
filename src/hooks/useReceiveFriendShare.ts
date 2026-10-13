import { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useNostr, useNostrContacts } from '../contexts/NostrContext';
import { useLocale } from '../contexts/LocaleContext';
import Toast from '../components/BrandedToast';
import type { PickedFriend } from '../components/FriendPickerSheet';
import type { DmProtocol } from '../utils/dmProtocol';
import type { MarmotUnreachableReason } from '../services/marmotFallback';
import { receiveFriendProtocol } from '../utils/receiveFriendProtocol';
import { sendSharedDm } from '../services/sendSharedDm';

interface Params {
  value: string;
  isOnchain: boolean;
  isAddress: boolean;
  sending: boolean;
  setSending: (sending: boolean) => void;
  setFriendPickerOpen: (open: boolean) => void;
  presetFriend?: PickedFriend;
  presetProtocol?: DmProtocol;
  onSent?: (payload: string) => void;
  onMarmotUnreachable?: (reason: MarmotUnreachableReason, payload: string) => Promise<boolean>;
  onClose: () => void;
}

/** Invoice / address sharing, including protocol choice, sent-row persistence
 * and feedback. An open thread delegates its local row and fallback to the composer. */
export function useReceiveFriendShare({
  value,
  isOnchain,
  isAddress,
  sending,
  setSending,
  setFriendPickerOpen,
  presetFriend,
  presetProtocol,
  onSent,
  onMarmotUnreachable,
  onClose,
}: Params) {
  const { t } = useLocale();
  const { sendDirectMessage, pubkey: viewerPubkey, appendLocalDmMessage } = useNostr();
  const { contacts } = useNostrContacts();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return useCallback(
    async (friend: PickedFriend) => {
      if (!value || sending) return;
      const sharedAddress = isAddress;
      setSending(true);
      setFriendPickerOpen(false);
      try {
        // Bolt11 invoices are self-identifying by their `lnbc…` prefix — no
        // URI scheme needed, and sending bare `lnbc…` matches what Damus
        // (and other Nostr clients that use nostrdb's block parser) expect
        // for cross-client interop. Lightning addresses look like plain
        // emails (`alice@example.com`), so we have to prefix them with
        // `lightning:` so the receiver can safely render a Pay button
        // without mis-classifying a regular email. On-chain BIP-21 URIs
        // already carry their own `bitcoin:` scheme — send as-is.
        const payload = isOnchain ? value : isAddress ? `lightning:${value}` : value;
        const protocol = await receiveFriendProtocol(
          viewerPubkey,
          friend.pubkey,
          presetFriend?.pubkey,
          presetProtocol,
        );
        let result = await sendSharedDm({
          peer: friend.pubkey,
          text: payload,
          protocol,
          send: () => sendDirectMessage(friend.pubkey, payload, { protocol }),
          append: presetFriend ? undefined : appendLocalDmMessage,
        });
        if (result.success) onSent?.(payload);
        else if (result.marmotUnreachable && onMarmotUnreachable) {
          if (!(await onMarmotUnreachable(result.marmotUnreachable, payload))) return;
          result = { success: true };
        }
        if (!result.success) {
          Toast.show({
            type: 'error',
            text1: t('receiveSheet.sendFailed'),
            text2: result.error ?? t('receiveSheet.couldNotSendToFriend'),
            position: 'top',
            visibilityTime: 4000,
          });
          return;
        }
        Toast.show({
          type: 'success',
          text1: sharedAddress
            ? t('receiveSheet.lightningAddressSentTo', { name: friend.name })
            : t('receiveSheet.invoiceSentTo', { name: friend.name }),
          position: 'top',
          visibilityTime: 2500,
        });
        // Close this sheet and drop the user into the conversation so they
        // can see the message land and the friend's "Pay" response. When
        // opened from inside a conversation (presetFriend), we're already
        // there — just close.
        onClose();
        if (!presetFriend) {
          const contact = contacts.find((c) => c.pubkey === friend.pubkey);
          navigation.navigate('Conversation', {
            protocol,
            pubkey: friend.pubkey,
            name: friend.name,
            picture: friend.picture,
            lightningAddress: contact?.profile?.lud16 ?? friend.lightningAddress,
          });
        }
      } finally {
        setSending(false);
      }
    },
    [
      value,
      isOnchain,
      isAddress,
      sending,
      sendDirectMessage,
      appendLocalDmMessage,
      setSending,
      setFriendPickerOpen,
      t,
      viewerPubkey,
      contacts,
      navigation,
      onClose,
      presetFriend,
      presetProtocol,
      onSent,
      onMarmotUnreachable,
    ],
  );
}

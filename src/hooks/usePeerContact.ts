import { shortNpub } from '../utils/shortNpub';
import { useCallback, useMemo } from 'react';
import { useNostrContacts } from '../contexts/NostrContext';
import type { ContactProfileBodyData } from '../components/ContactProfileBody';
import type { RootStackParamList } from '../navigation/types';
/** The same resolved identity feeds the profile preview and View contact. */
export function usePeerContact(
  params: RootStackParamList['Conversation'],
  present: (contact: ContactProfileBodyData) => void,
) {
  const { contacts } = useNostrContacts();
  const { pubkey, name, picture, lightningAddress } = params;
  const contact = useMemo<ContactProfileBodyData>(() => {
    const known = contacts.find((c) => c.pubkey === pubkey)?.profile;
    return {
      pubkey,
      name: name || known?.displayName || known?.name || shortNpub(pubkey),
      picture: known?.picture ?? picture ?? null,
      banner: known?.banner ?? null,
      nip05: known?.nip05 ?? null,
      lightningAddress: known?.lud16 ?? lightningAddress ?? null,
      source: 'nostr',
    };
  }, [contacts, pubkey, name, picture, lightningAddress]);
  const openPeerProfile = useCallback(() => present(contact), [contact, present]);
  return { contact, openPeerProfile };
}

import { LP_CLIENT_TAG } from './nip89ClientTag';
import {
  createContactListEvent,
  createProfileEvent,
  createZapRequestEvent,
  createGroupStateEvent,
  createDirectMessageRumor,
  createGroupChatRumor,
} from './nostrService';
import { buildCacheListing, buildFoundLog, buildComment } from './nostrPlacesService';
import type { HiddenPiggy } from './piggyStorageService';

// NIP-89 client tag (https://github.com/nostr-protocol/nips/blob/master/89.md).
// The tag must ride on every PUBLIC event LP publishes (attribution +
// client filtering) and must NOT appear on the kind-14 rumors that get
// sealed into NIP-17 gift wraps, where it would leak client metadata.
const CLIENT_TAG = ['client', 'Lightning Piggy'];
const PK = 'a'.repeat(64);
const PK2 = 'b'.repeat(64);
const RELAY = 'wss://relay.example.com';
// Realistic NIP-01 coordinate: <kind>:<64-hex-pubkey>:<d>.
const CACHE_COORD = `37516:${PK}:d1`;

describe('NIP-89 client tag', () => {
  it('is the bare two-element form', () => {
    expect([...LP_CLIENT_TAG]).toEqual(CLIENT_TAG);
  });

  describe('present on public events', () => {
    it('kind 0 — profile metadata', () => {
      expect(createProfileEvent({ name: 'piggy' }).tags).toContainEqual(CLIENT_TAG);
    });

    it('kind 3 — contact list', () => {
      const ev = createContactListEvent([{ pubkey: PK, relay: null, petname: null }]);
      expect(ev.tags).toContainEqual(CLIENT_TAG);
    });

    it('kind 9734 — zap request', () => {
      expect(createZapRequestEvent(PK, PK2, 1000, [RELAY], '').tags).toContainEqual(CLIENT_TAG);
    });

    it('kind 30200 — group state', () => {
      const ev = createGroupStateEvent({ groupId: 'g1', name: 'fam', memberPubkeys: [PK2] });
      expect(ev.tags).toContainEqual(CLIENT_TAG);
    });

    it('kind 37516 — NIP-GC cache listing', () => {
      const piggy = { id: 'p1', lat: 1, lon: 2 } as HiddenPiggy;
      expect(buildCacheListing(piggy).tags).toContainEqual(CLIENT_TAG);
    });

    it('kind 7516 — found log', () => {
      expect(buildFoundLog(CACHE_COORD, 'found it').tags).toContainEqual(CLIENT_TAG);
    });

    it('kind 1111 — NIP-22 comment', () => {
      expect(buildComment(CACHE_COORD, PK, 'note', 'note').tags).toContainEqual(CLIENT_TAG);
    });
  });

  describe('absent from NIP-17 gift-wrapped rumors', () => {
    it('kind 14 — direct message rumor', () => {
      const ev = createDirectMessageRumor({
        senderPubkey: PK,
        recipientPubkey: PK2,
        content: 'hi',
      });
      expect(ev.tags).not.toContainEqual(CLIENT_TAG);
    });

    it('kind 14 — group chat rumor', () => {
      const ev = createGroupChatRumor({
        senderPubkey: PK,
        subject: 'fam',
        memberPubkeys: [PK2],
        content: 'hi',
      });
      expect(ev.tags).not.toContainEqual(CLIENT_TAG);
    });
  });
});

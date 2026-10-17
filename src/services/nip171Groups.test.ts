import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { wrapEvent } from 'nostr-tools/nip59';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { Nip171Ticket } from '../utils/nip171';

import {
  __resetNip171GroupsForTests,
  forgetNip171Group,
  ingestNip171Ticket,
  loadNip171Groups,
  nip171GroupState,
  nip171GroupsFor,
  nip171Outgoing,
} from './nip171Groups';
import { ingestNip171Wrap } from './nip171Session';

const mockStore: (Nip171Ticket & { owner: string })[] = [];
jest.mock('./nip171Store', () => ({
  saveNip171Ticket: jest.fn(async (owner: string, t: Nip171Ticket) => {
    if (!mockStore.some((s) => s.owner === owner && s.id === t.id)) mockStore.push({ ...t, owner });
  }),
  loadNip171Tickets: jest.fn(async (owner: string) => mockStore.filter((s) => s.owner === owner)),
  deleteNip171Group: jest.fn(async (owner: string, group: string) => {
    for (let i = mockStore.length - 1; i >= 0; i--) {
      if (mockStore[i].owner === owner && mockStore[i].groupPubkey === group)
        mockStore.splice(i, 1);
    }
  }),
}));
const mockAppended: { groupId: string; text: string; senderPubkey: string }[] = [];
jest.mock('./groupMessagesStorageService', () => ({
  appendGroupMessage: jest.fn(async (_o: string, groupId: string, m: never) => {
    mockAppended.push({ groupId, ...(m as { text: string; senderPubkey: string }) });
  }),
}));
jest.mock('../contexts/nostrEventBus', () => ({ notifyGroupMessage: jest.fn() }));
jest.mock('./nostrService', () => ({ pool: {}, trackRelays: jest.fn() }));
jest.mock('./relayQuery', () => ({ querySyncAbortable: jest.fn() }));

const groupSk = generateSecretKey();
const GROUP = getPublicKey(groupSk);
const meSk = generateSecretKey();
const ME = getPublicKey(meSk);
const epochSk = generateSecretKey();
const EPOCH_PUB = getPublicKey(epochSk);
const peerSk = generateSecretKey();
const PEER = getPublicKey(peerSk);

/** An epoch ticket as Anagram sends it: unsigned rumor, signature on the seal. */
function anagramTicket(member: string, epoch = 0) {
  const signed = finalizeEvent(
    {
      kind: 1014,
      created_at: 1000,
      tags: [
        ['p', member],
        ['epoch', String(epoch)],
      ],
      content: bytesToHex(epochSk),
    },
    groupSk,
  );
  const { kind, created_at, tags, content, pubkey, sig } = signed;
  return { kind, created_at, tags, content, pubkey, sealInvitationProof: sig };
}

beforeEach(() => {
  mockStore.length = 0;
  mockAppended.length = 0;
  __resetNip171GroupsForTests();
});

describe('ingestNip171Ticket', () => {
  it('joins the group from an Anagram ticket', async () => {
    await loadNip171Groups(ME);
    expect(await ingestNip171Ticket(ME, anagramTicket(ME))).toBe(true);
    const state = nip171GroupState(ME, GROUP)!;
    expect(state.epochPubkey).toBe(EPOCH_PUB);
    expect(nip171GroupsFor(ME)).toEqual([
      expect.objectContaining({ id: `nip171:${GROUP}`, protocol: 'nip171' }),
    ]);
  });

  it('swallows an invalid ticket without joining', async () => {
    const bad = { ...anagramTicket(ME), sealInvitationProof: '0'.repeat(128) };
    expect(await ingestNip171Ticket(ME, bad)).toBe(true);
    expect(nip171GroupsFor(ME)).toEqual([]);
  });

  it('ignores rumors that are not tickets', async () => {
    expect(
      await ingestNip171Ticket(ME, {
        kind: 14,
        pubkey: PEER,
        created_at: 1,
        tags: [],
        content: '',
      }),
    ).toBe(false);
  });
});

describe('nip171Outgoing', () => {
  it('addresses the epoch key with the membership proof', async () => {
    const ticket = anagramTicket(ME);
    await ingestNip171Ticket(ME, ticket);
    const out = nip171Outgoing(ME, `nip171:${GROUP}`, 'hi', ['wss://a']);
    if ('error' in out) throw new Error(out.error);
    expect(out.recipientPubkeys).toEqual([EPOCH_PUB]);
    expect(out.rumor.tags).toEqual([
      ['p', EPOCH_PUB],
      ['h', GROUP],
      ['epoch', '0'],
      ['invited_at', '1000'],
      ['invitation_proof', ticket.sealInvitationProof],
    ]);
  });

  it('refuses groups we are not in', () => {
    expect(nip171Outgoing(ME, `nip171:${GROUP}`, 'hi', [])).toEqual({
      error: 'Not a member of this group',
    });
  });

  it('forgets a group we left', async () => {
    await ingestNip171Ticket(ME, anagramTicket(ME));
    await forgetNip171Group(ME, GROUP);
    expect(nip171GroupsFor(ME)).toEqual([]);
    expect(mockStore).toEqual([]);
  });
});

describe('ingestNip171Wrap', () => {
  /** A member's message, built the way Anagram builds one. */
  async function memberWrap(senderSk: Uint8Array, proofOverride?: string) {
    await ingestNip171Ticket(getPublicKey(senderSk), anagramTicket(getPublicKey(senderSk)));
    const sender = nip171GroupState(getPublicKey(senderSk), GROUP)!;
    const tags = [
      ['p', EPOCH_PUB],
      ['h', GROUP],
      ['epoch', '0'],
      ['invited_at', String(sender.keys.current.createdAt)],
      ['invitation_proof', proofOverride ?? sender.keys.current.sig],
    ];
    return wrapEvent({ kind: 14, created_at: 2000, tags, content: 'hello' }, senderSk, EPOCH_PUB);
  }

  it('stores a member message whose proof verifies', async () => {
    const wrap = await memberWrap(peerSk);
    await ingestNip171Ticket(ME, anagramTicket(ME));
    const state = nip171GroupState(ME, GROUP)!;
    expect(await ingestNip171Wrap(ME, state, wrap)).toBe('stored');
    expect(mockAppended).toEqual([
      expect.objectContaining({ groupId: `nip171:${GROUP}`, text: 'hello', senderPubkey: PEER }),
    ]);
    expect(state.members.has(PEER)).toBe(true);
  });

  it('drops a message with a forged proof', async () => {
    const wrap = await memberWrap(peerSk, '1'.repeat(128));
    await ingestNip171Ticket(ME, anagramTicket(ME));
    expect(await ingestNip171Wrap(ME, nip171GroupState(ME, GROUP)!, wrap)).toBe('invalid');
    expect(mockAppended).toEqual([]);
  });

  it('applies a member announcement from the group key', async () => {
    await ingestNip171Ticket(ME, anagramTicket(ME));
    const wrap = wrapEvent(
      {
        kind: 14,
        created_at: 2000,
        tags: [
          ['p', EPOCH_PUB],
          ['h', GROUP],
          ['epoch', '0'],
          ['member', PEER],
        ],
        content: '+',
      },
      groupSk,
      EPOCH_PUB,
    );
    const state = nip171GroupState(ME, GROUP)!;
    expect(await ingestNip171Wrap(ME, state, wrap)).toBe('announcement');
    expect(state.members.has(PEER)).toBe(true);
  });
});

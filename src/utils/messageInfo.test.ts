import { buildMessageInfo, messageKindLabel, resendPayloadFor } from './messageInfo';
import { protocolLabel, type DeliveryStatus } from './dmDeliveryStatus';
import type { DmProtocol } from './dmProtocol';
import type { BubbleContent } from './messageContent';

// #1296 — what the message-info sheet shows for every protocol × direction ×
// content combination the app can render. Each row is one tapped bubble: the
// thread protocol, the stored kind, whether it's ours, the resend payload the
// bubble hands up, and whether a tracked send's status exists.

const sentStatus = (eventId: string, kind: number): DeliveryStatus => ({
  delivered: true,
  relayResults: { 'wss://a': 'ok', 'wss://b': 'failed' },
  eventId,
  kind,
});

type Row = {
  name: string;
  protocol: DmProtocol;
  fromMe: boolean;
  rowId: string;
  wireKind?: number;
  status?: DeliveryStatus;
  resend: { resendText: string; resendIsGif?: true };
  expect: {
    protocol: string;
    kind: ReturnType<typeof messageKindLabel>;
    eventId: string;
    idKind: 'event' | 'rumor' | 'wrap';
    canResend: boolean;
    resendText?: string;
  };
};

const text = (t: string) => ({ resendText: t });
const none = { resendText: '' };
const gif = (url: string) => ({ resendText: url, resendIsGif: true as const });
const GIF = 'https://media.giphy.com/media/abc/giphy.gif';

const ROWS: Row[] = [
  // ── NIP-04 1:1 — one kind-4 event, findable by id ───────────────────────
  {
    name: 'NIP-04 1:1 sent text',
    protocol: 'nip04',
    fromMe: true,
    rowId: 'e4',
    wireKind: 4,
    status: sentStatus('e4', 4),
    resend: text('hi'),
    expect: {
      protocol: 'NIP-04 (legacy DM)',
      kind: { key: 'kind4' },
      eventId: 'e4',
      idKind: 'event',
      canResend: true,
    },
  },
  {
    name: 'NIP-04 1:1 received text',
    protocol: 'nip04',
    fromMe: false,
    rowId: 'e4r',
    wireKind: 4,
    resend: text('hi'),
    expect: {
      protocol: 'NIP-04 (legacy DM)',
      kind: { key: 'kind4' },
      eventId: 'e4r',
      idKind: 'event',
      canResend: false,
    },
  },
  // ── NIP-17 1:1 — kind-14/15 rumor in kind-1059 wraps ────────────────────
  {
    name: 'NIP-17 1:1 sent text (tracked: rumor id)',
    protocol: 'nip17',
    fromMe: true,
    rowId: 'local-r14',
    wireKind: 14,
    status: sentStatus('r14', 14),
    resend: text('hi'),
    expect: {
      protocol: 'NIP-17 (gift-wrapped)',
      kind: { key: 'kind14' },
      eventId: 'r14',
      idKind: 'rumor',
      canResend: true,
    },
  },
  {
    name: 'NIP-17 1:1 pending send (no stored kind yet)',
    protocol: 'nip17',
    fromMe: true,
    rowId: 'local-r14p',
    status: { ...sentStatus('r14p', 14), pending: true, delivered: false },
    resend: text('hi'),
    expect: {
      protocol: 'NIP-17 (gift-wrapped)',
      kind: { key: 'kind14' },
      eventId: 'r14p',
      idKind: 'rumor',
      canResend: true,
    },
  },
  {
    name: 'NIP-17 1:1 received text (row keyed by the wrap id)',
    protocol: 'nip17',
    fromMe: false,
    rowId: 'w1059',
    wireKind: 14,
    resend: text('hi'),
    expect: {
      protocol: 'NIP-17 (gift-wrapped)',
      kind: { key: 'kind14' },
      eventId: 'w1059',
      idKind: 'wrap',
      canResend: false,
    },
  },
  {
    name: 'NIP-17 1:1 sent image / voice (kind 15)',
    protocol: 'nip17',
    fromMe: true,
    rowId: 'local-x',
    wireKind: 15,
    status: sentStatus('r15', 15),
    resend: text('https://blossom/f#lpe=1'),
    expect: {
      protocol: 'NIP-17 (gift-wrapped)',
      kind: { key: 'kind15' },
      eventId: 'r15',
      idKind: 'rumor',
      canResend: false,
    },
  },
  {
    name: 'NIP-17 1:1 sent GIF (bare URL, no envelope)',
    protocol: 'nip17',
    fromMe: true,
    rowId: 'local-g',
    wireKind: 14,
    status: sentStatus('rg', 14),
    resend: gif(GIF),
    expect: {
      protocol: 'NIP-17 (gift-wrapped)',
      kind: { key: 'kind14' },
      eventId: 'rg',
      idKind: 'rumor',
      canResend: true,
      resendText: GIF,
    },
  },
  {
    name: 'NIP-17 1:1 received poll (kind 1068) is still NIP-17, not "Unknown"',
    protocol: 'nip17',
    fromMe: false,
    rowId: 'wp',
    wireKind: 1068,
    resend: none,
    expect: {
      protocol: 'NIP-17 (gift-wrapped)',
      kind: { key: 'kindN', kind: 1068 },
      eventId: 'wp',
      idKind: 'wrap',
      canResend: false,
    },
  },
  {
    name: 'NIP-17 1:1 legacy sent row with only a local id',
    protocol: 'nip17',
    fromMe: true,
    rowId: 'local-1700000000-abc',
    wireKind: 14,
    resend: text('hi'),
    expect: {
      protocol: 'NIP-17 (gift-wrapped)',
      kind: { key: 'kind14' },
      eventId: '',
      idKind: 'wrap',
      canResend: true,
    },
  },
  // ── NIP-17 group ────────────────────────────────────────────────────────
  {
    name: 'NIP-17 group sent text (optimistic local_ id is hidden)',
    protocol: 'nip17',
    fromMe: true,
    rowId: 'local_1700000000_abc',
    wireKind: 14,
    resend: text('hi'),
    expect: {
      protocol: 'NIP-17 (gift-wrapped)',
      kind: { key: 'kind14' },
      eventId: '',
      idKind: 'wrap',
      canResend: true,
    },
  },
  {
    name: 'NIP-17 group received voice note',
    protocol: 'nip17',
    fromMe: false,
    rowId: 'wv',
    wireKind: 15,
    resend: none,
    expect: {
      protocol: 'NIP-17 (gift-wrapped)',
      kind: { key: 'kind15' },
      eventId: 'wv',
      idKind: 'wrap',
      canResend: false,
    },
  },
  // ── Marmot 1:1 — kind-9 rumor in a kind-445 group event ─────────────────
  {
    name: 'Marmot 1:1 sent text',
    protocol: 'marmot',
    fromMe: true,
    rowId: 'local-m9',
    wireKind: 14,
    status: sentStatus('m9', 14),
    resend: text('hi'),
    expect: {
      protocol: 'Marmot (MLS)',
      kind: { key: 'marmotChat', kind: 9 },
      eventId: 'm9',
      idKind: 'rumor',
      canResend: true,
    },
  },
  {
    name: 'Marmot 1:1 received text',
    protocol: 'marmot',
    fromMe: false,
    rowId: 'm9r',
    wireKind: 14,
    resend: text('hi'),
    expect: {
      protocol: 'Marmot (MLS)',
      kind: { key: 'marmotChat', kind: 9 },
      eventId: 'm9r',
      idKind: 'rumor',
      canResend: false,
    },
  },
  {
    name: 'Marmot 1:1 sent photo (MIP-04: kind 9 + imeta, stored 15)',
    protocol: 'marmot',
    fromMe: true,
    rowId: 'local-mp',
    wireKind: 15,
    status: sentStatus('mp', 15),
    resend: text('https://blossom/f#lpe=1'),
    expect: {
      protocol: 'Marmot (MLS)',
      kind: { key: 'marmotMedia', kind: 9 },
      eventId: 'mp',
      idKind: 'rumor',
      canResend: false,
    },
  },
  {
    name: 'Marmot 1:1 sent GIF re-sends in the GIPHY envelope',
    protocol: 'marmot',
    fromMe: true,
    rowId: 'local-mg',
    wireKind: 14,
    status: sentStatus('mg', 14),
    resend: gif(GIF),
    expect: {
      protocol: 'Marmot (MLS)',
      kind: { key: 'marmotChat', kind: 9 },
      eventId: 'mg',
      idKind: 'rumor',
      canResend: true,
      resendText: `${GIF}\nvia GIPHY`,
    },
  },
  {
    name: 'Marmot 1:1 received poll (kind 1068 carried unchanged)',
    protocol: 'marmot',
    fromMe: false,
    rowId: 'mpoll',
    wireKind: 1068,
    resend: none,
    expect: {
      protocol: 'Marmot (MLS)',
      kind: { key: 'kindN', kind: 1068 },
      eventId: 'mpoll',
      idKind: 'rumor',
      canResend: false,
    },
  },
  {
    name: 'Marmot 1:1 failed send',
    protocol: 'marmot',
    fromMe: true,
    rowId: 'local-mf',
    wireKind: 14,
    status: { delivered: false, relayResults: { 'wss://a': 'failed' }, eventId: 'mf', kind: 14 },
    resend: text('hi'),
    expect: {
      protocol: 'Marmot (MLS)',
      kind: { key: 'marmotChat', kind: 9 },
      eventId: 'mf',
      idKind: 'rumor',
      canResend: true,
    },
  },
  // ── Marmot group (untracked sends; rows keyed by the Marmot rumor id) ───
  {
    name: 'Marmot group sent text',
    protocol: 'marmot',
    fromMe: true,
    rowId: 'mg9',
    wireKind: 14,
    resend: text('hi'),
    expect: {
      protocol: 'Marmot (MLS)',
      kind: { key: 'marmotChat', kind: 9 },
      eventId: 'mg9',
      idKind: 'rumor',
      canResend: true,
    },
  },
  {
    name: 'Marmot group sent text before its rumor id is adopted',
    protocol: 'marmot',
    fromMe: true,
    rowId: 'local_1700000000_abc',
    wireKind: 14,
    resend: text('hi'),
    expect: {
      protocol: 'Marmot (MLS)',
      kind: { key: 'marmotChat', kind: 9 },
      eventId: '',
      idKind: 'rumor',
      canResend: true,
    },
  },
  {
    name: 'Marmot group received voice note',
    protocol: 'marmot',
    fromMe: false,
    rowId: 'mgv',
    wireKind: 15,
    resend: none,
    expect: {
      protocol: 'Marmot (MLS)',
      kind: { key: 'marmotMedia', kind: 9 },
      eventId: 'mgv',
      idKind: 'rumor',
      canResend: false,
    },
  },
  {
    name: 'Marmot group sent reply (resend would drop the quote)',
    protocol: 'marmot',
    fromMe: true,
    rowId: 'mgr',
    wireKind: 14,
    resend: none, // resendPayloadFor(…, isReply=true)
    expect: {
      protocol: 'Marmot (MLS)',
      kind: { key: 'marmotChat', kind: 9 },
      eventId: 'mgr',
      idKind: 'rumor',
      canResend: false,
    },
  },
];

describe('buildMessageInfo', () => {
  it.each(ROWS.map((r) => [r.name, r] as const))('%s', (_name, row) => {
    const { info, canResend } = buildMessageInfo({
      protocol: row.protocol,
      fromMe: row.fromMe,
      rowId: row.rowId,
      wireKind: row.wireKind,
      deliveryStatus: row.status,
      ...row.resend,
    });
    expect(info.direction).toBe(row.fromMe ? 'sent' : 'received');
    expect(protocolLabel(info.wireKind, info.protocol)).toBe(row.expect.protocol);
    expect(messageKindLabel(info.wireKind, info.protocol!)).toEqual(row.expect.kind);
    expect(info.eventId).toBe(row.expect.eventId);
    expect(info.idKind).toBe(row.expect.idKind);
    expect(canResend).toBe(row.expect.canResend);
    // The per-relay breakdown is the tracked send's own (kind-445 acks for
    // Marmot, wrap acks for NIP-17) — passed through untouched; untracked
    // (group / received) messages have none.
    expect(info.deliveryStatus).toBe(row.status);
    if (row.expect.resendText !== undefined) expect(info.resendText).toBe(row.expect.resendText);
  });

  it('a Marmot message never reports a NIP-17 protocol or kind 14', () => {
    for (const wireKind of [14, 15]) {
      const { info } = buildMessageInfo({
        protocol: 'marmot',
        fromMe: true,
        rowId: 'x',
        wireKind,
        resendText: 'hi',
      });
      expect(protocolLabel(info.wireKind, info.protocol)).toBe('Marmot (MLS)');
      expect(messageKindLabel(info.wireKind, info.protocol!).key).not.toMatch(/^kind1[45]$/);
    }
  });
});

describe('resendPayloadFor', () => {
  const cases: [string, BubbleContent, boolean, ReturnType<typeof resendPayloadFor>][] = [
    ['text', { kind: 'text', text: 'hi' }, false, { resendText: 'hi' }],
    ['GIF', { kind: 'gif', url: GIF }, false, { resendText: GIF, resendIsGif: true }],
    ['a reply', { kind: 'text', text: 'hi' }, true, { resendText: '' }],
    [
      'location',
      { kind: 'location', location: { lat: 1, lon: 2, accuracyMeters: null } },
      false,
      { resendText: '' },
    ],
    ['a poll vote', { kind: 'pollVote' }, false, { resendText: '' }],
  ];
  it.each(cases)('%s', (_n, content, isReply, expected) => {
    expect(resendPayloadFor(content, isReply)).toEqual(expected);
  });
});

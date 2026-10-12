import { finalizeEvent } from 'nostr-tools/pure';
import { publishSignedEvent, signAndPublishEvent } from './nostrEventPublish';
import { pool, trackRelays } from './nostrPool';

jest.mock('./nostrPool', () => ({ pool: { publish: jest.fn() }, trackRelays: jest.fn() }));

const key = new Uint8Array(32).fill(9);
const template = { kind: 1, created_at: 1, tags: [], content: '' };
const relays = ['wss://a.example', 'wss://b.example'];

beforeEach(() => jest.clearAllMocks());

describe.each([
  ['signed', () => publishSignedEvent(finalizeEvent(template, key), relays)],
  ['sign then publish', () => signAndPublishEvent(template, key, relays)],
] as const)('%s publication', (_name, publish) => {
  it('rejects when every connection fails, preserving the failure reasons', async () => {
    (pool.publish as jest.Mock).mockReturnValue(
      relays.map(() => Promise.resolve('connection failure: offline')),
    );
    await expect(publish()).rejects.toMatchObject({
      errors: [
        expect.objectContaining({ message: 'connection failure: offline' }),
        expect.objectContaining({ message: 'connection failure: offline' }),
      ],
    });
  });

  it('accepts an empty relay OK even when another connection fails', async () => {
    (pool.publish as jest.Mock).mockReturnValue([
      Promise.resolve('connection failure: offline'),
      Promise.resolve(''),
    ]);
    await expect(publish()).resolves.toBeUndefined();
    expect(trackRelays).toHaveBeenCalledWith(relays);
  });
});

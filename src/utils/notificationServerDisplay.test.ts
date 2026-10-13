import { nip19 } from 'nostr-tools';

import { notificationServerDisplay } from './notificationServerDisplay';

const builtIn = { pubkey: '653e35d79e65d33d99d6d623cc87101b2159008488a321a774b3bd1205ee6297' };
const custom = { pubkey: '1888abbc7706e75aac190b095b962f3a8fe3e3b8b32d96d3e18b917159d988f7' };
const display = (override: typeof custom | null, name: string | null = null) =>
  notificationServerDisplay(override, builtIn, name, 'Lightning Piggy notifications');

describe('notification server card', () => {
  it('shows the built-in identity and default badge with a name before kind-0 arrives', () => {
    expect(display(null)).toMatchObject({
      server: builtIn,
      npub: nip19.npubEncode(builtIn.pubkey),
      name: 'Lightning Piggy notifications',
      isDefault: true,
      canReset: false,
    });
    expect(display(null, 'Development notifications').name).toBe('Development notifications');
  });

  it('shows a custom profile and copy key without the default badge', () => {
    expect(display(custom, 'My notification server')).toMatchObject({
      server: custom,
      npub: nip19.npubEncode(custom.pubkey),
      name: 'My notification server',
      isDefault: false,
      canReset: true,
    });
    expect(display(custom).name).toBe(display(custom).shortNpub);
    expect(display(custom, '   ').name).toBe(display(custom).shortNpub);
  });

  it('restores the built-in card and hides reset when the override is removed', () => {
    expect(display(custom).canReset).toBe(true);
    const reset = display(null, 'Lightning Piggy notifications');
    expect(reset.server).toBe(builtIn);
    expect(reset.isDefault).toBe(true);
    expect(reset.canReset).toBe(false);
    expect(reset.npub).toBe(nip19.npubEncode(builtIn.pubkey));
  });
});

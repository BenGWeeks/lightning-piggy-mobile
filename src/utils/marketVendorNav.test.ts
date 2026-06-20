import { openVendorNostrProfile } from './marketVendorNav';
import type { MarketVendor } from '../data/marketVendors';

const make = (over: Partial<MarketVendor>): MarketVendor => ({
  name: 'Test Vendor',
  country: 'Denmark',
  shippingRegions: ['Worldwide'],
  shopType: 'online',
  description: 'desc',
  url: 'https://example.com',
  logo: 'https://example.com/logo.png',
  nostrUrl: '',
  xUrl: '',
  featured: false,
  ...over,
});

describe('openVendorNostrProfile', () => {
  // Robotechy's npub → hex (verified against nostr-tools nip19.decode).
  const robotechyHex = '211f325b5396968ac0c79b7c0a030d768206d32ac61f93f143de112b859bd46f';

  it('navigates to ContactProfile with the decoded pubkey for a Nostr vendor', () => {
    const navigate = jest.fn();
    const vendor = make({
      name: 'Robotechy',
      logo: 'https://m.primal.net/JdnO.jpg',
      nostrUrl: 'https://njump.me/npub1yy0nyk6nj6tg4sx8nd7q5qcdw6pqd5e2cc0e8u2rmcgjhpvm63hsk67xe5',
    });

    const result = openVendorNostrProfile({ navigate }, vendor);

    expect(result).toBe(true);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('ContactProfile', {
      contact: {
        pubkey: robotechyHex,
        name: 'Robotechy',
        picture: 'https://m.primal.net/JdnO.jpg',
        lightningAddress: null,
        source: 'nostr',
      },
    });
  });

  it('passes a null picture when the vendor has no logo', () => {
    const navigate = jest.fn();
    openVendorNostrProfile(
      { navigate },
      make({
        logo: '',
        nostrUrl:
          'https://njump.me/npub1yy0nyk6nj6tg4sx8nd7q5qcdw6pqd5e2cc0e8u2rmcgjhpvm63hsk67xe5',
      }),
    );
    expect(navigate).toHaveBeenCalledWith(
      'ContactProfile',
      expect.objectContaining({ contact: expect.objectContaining({ picture: null }) }),
    );
  });

  it('does not navigate (returns false) for a vendor without an npub', () => {
    const navigate = jest.fn();
    const result = openVendorNostrProfile({ navigate }, make({ nostrUrl: '' }));
    expect(result).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});

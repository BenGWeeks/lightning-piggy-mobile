import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { Image } from 'expo-image';
import MarketProductCard from '../MarketProductCard';
import { usePubkeyProfile } from '../../hooks/usePubkeyProfile';
import { MARKET_PRODUCTS } from '../../data/marketProducts';
import type { MarketProduct } from '../../data/marketProducts';
import EmbeddedEventCard from './EmbeddedEventCard';
import { resolveRemoteMedia } from '../../services/remoteMediaCache';
import { PREVIEW_IMAGE_MAX_BYTES } from '../../utils/remoteUrlPolicy';
import { createNostrContentStyles } from '../../styles/NostrContent.styles';
import { lightPalette } from '../../styles/palettes';

let mockCover = 'https://example.com/cover.jpg';
let mockTrusted = true;
let mockProduct: MarketProduct | undefined;
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ push: jest.fn() }) }));
jest.mock('expo-image', () => ({
  Image: (props: object) =>
    jest.requireActual('react').createElement(jest.requireActual('react-native').View, props),
}));
jest.mock('../../services/remoteMediaCache', () => ({ resolveRemoteMedia: jest.fn() }));
jest.mock('../../hooks/useActivePubkey', () => ({ useActivePubkey: () => 'alice' }));
jest.mock('../../hooks/useEmbeddedEvent', () => ({
  useEmbeddedEvent: () => ({
    loading: false,
    result: {
      product: mockProduct,
      event: {
        id: 'article',
        pubkey: 'author',
        kind: mockProduct ? 30402 : 30023,
        created_at: 1,
        content: 'Article',
        tags: [['image', mockCover]],
        sig: '',
      },
    },
  }),
}));
jest.mock('../../hooks/useFollowedPubkeys', () => ({ useIsTrustedAuthor: () => mockTrusted }));
jest.mock('../../hooks/usePubkeyProfile', () => ({ usePubkeyProfile: jest.fn() }));
jest.mock('../../services/nostrEmbedCache', () => ({ PRODUCT_KIND: 30402 }));
jest.mock('../../contexts/LocaleContext', () => ({ useTranslation: () => (key: string) => key }));
jest.mock('../AuthorInline', () => () => null);
jest.mock('../MarketProductCard', () => jest.fn(() => null));
const props = {
  token: { type: 'event' as const, id: 'article', raw: 'nostr:note', relays: [] },
  styles: createNostrContentStyles(lightPalette),
};
beforeEach(() => {
  jest.clearAllMocks();
  mockCover = 'https://example.com/cover.jpg';
  mockTrusted = true;
  mockProduct = undefined;
  jest
    .mocked(usePubkeyProfile)
    .mockReturnValue({ name: null } as ReturnType<typeof usePubkeyProfile>);
  jest.mocked(resolveRemoteMedia).mockResolvedValue('file:///alice/cover');
});
it('passes only a bounded local cover to the native loader', async () => {
  const view = render(<EmbeddedEventCard {...props} />);
  await waitFor(() =>
    expect(view.UNSAFE_getByType(Image).props.source.uri).toBe('file:///alice/cover'),
  );
  expect(resolveRemoteMedia).toHaveBeenCalledWith(mockCover, PREVIEW_IMAGE_MAX_BYTES);
});
it.each(['http://example.com/cover.jpg', 'https://127.0.0.1/cover.jpg'])(
  'never loads blocked cover %s',
  async (url) => {
    mockCover = url;
    const view = render(<EmbeddedEventCard {...props} />);
    await act(async () => {});
    expect(resolveRemoteMedia).not.toHaveBeenCalled();
    expect(view.UNSAFE_queryByType(Image)).toBeNull();
  },
);
it('preserves the trust gate', async () => {
  mockTrusted = false;
  const view = render(<EmbeddedEventCard {...props} />);
  await act(async () => {});
  expect(resolveRemoteMedia).not.toHaveBeenCalled();
  expect(view.UNSAFE_queryByType(Image)).toBeNull();
});

it.each([true, false])(
  'passes chat image trust (%s) through the product embed',
  (autoLoadMedia) => {
    mockProduct = MARKET_PRODUCTS[0];
    render(<EmbeddedEventCard {...props} autoLoadMedia={autoLoadMedia} />);
    expect(jest.mocked(MarketProductCard).mock.calls[0][0].autoLoadMedia).toBe(autoLoadMedia);
  },
);

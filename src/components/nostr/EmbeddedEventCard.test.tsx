import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { Image } from 'expo-image';
import EmbeddedEventCard from './EmbeddedEventCard';
import { resolveRemoteMedia } from '../../services/remoteMediaCache';
import { PREVIEW_IMAGE_MAX_BYTES } from '../../utils/remoteUrlPolicy';
import { createNostrContentStyles } from '../../styles/NostrContent.styles';
import { lightPalette } from '../../styles/palettes';

let mockCover = 'https://example.com/cover.jpg';
let mockTrusted = true;
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
      event: {
        id: 'article',
        pubkey: 'author',
        kind: 30023,
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
jest.mock('../MarketProductCard', () => () => null);
const props = {
  token: { type: 'event' as const, id: 'article', raw: 'nostr:note', relays: [] },
  styles: createNostrContentStyles(lightPalette),
};
beforeEach(() => {
  jest.clearAllMocks();
  mockCover = 'https://example.com/cover.jpg';
  mockTrusted = true;
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

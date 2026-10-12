import { marketEditorDestination } from './marketEditorNavigation';
it('routes profile and embedded product edits through the root to Explore’s editor', () => {
  expect(marketEditorDestination('book')).toEqual({
    screen: 'MainTabs',
    params: {
      screen: 'Explore',
      params: { screen: 'MarketListingEditor', params: { dTag: 'book' } },
    },
  });
});

import { movePhoto, setCoverPhoto } from './listingPhotos';

const photos = ['a', 'b', 'c', 'd'];

describe('listing photo ordering', () => {
  it('moves a photo left or right by one', () => {
    expect(movePhoto(photos, 2, 1)).toEqual(['a', 'c', 'b', 'd']);
    expect(movePhoto(photos, 0, 1)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('makes any photo the cover and keeps the others in order', () => {
    expect(setCoverPhoto(photos, 3)).toEqual(['d', 'a', 'b', 'c']);
    expect(setCoverPhoto(photos, 0)).toEqual(photos);
  });

  it('ignores out-of-range moves and never mutates the input', () => {
    expect(movePhoto(photos, 0, -1)).toEqual(photos);
    expect(movePhoto(photos, 3, 4)).toEqual(photos);
    expect(photos).toEqual(['a', 'b', 'c', 'd']);
  });
});

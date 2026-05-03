/**
 * Coverage for the YouTube ID + thumbnail helpers. The regex accepts
 * the three standard URL shapes (long watch?v=, short youtu.be, embed)
 * — these tests pin each, plus the null-handling on the public API.
 */

import { extractYouTubeId, getYouTubeThumbnail } from './youtube';

describe('extractYouTubeId', () => {
  it('extracts the id from a long watch URL', () => {
    expect(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts the id from a short youtu.be URL', () => {
    expect(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts the id from an embed URL', () => {
    expect(extractYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('returns null when the URL does not match', () => {
    expect(extractYouTubeId('https://example.com/dQw4w9WgXcQ')).toBeNull();
    expect(extractYouTubeId('https://www.youtube.com/')).toBeNull();
  });
});

describe('getYouTubeThumbnail', () => {
  it('returns the mqdefault thumbnail URL for a recognised video', () => {
    expect(getYouTubeThumbnail('https://youtu.be/dQw4w9WgXcQ')).toBe(
      'https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
    );
  });

  it('returns null for unrecognised input', () => {
    expect(getYouTubeThumbnail(null)).toBeNull();
    expect(getYouTubeThumbnail('https://example.com/')).toBeNull();
  });
});

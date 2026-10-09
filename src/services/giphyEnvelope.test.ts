import { extractGifUrl, giphyEnvelope } from './giphyService';

const URL = 'https://media2.giphy.com/media/abc123/giphy.gif';

describe("GIFs in White Noise's envelope", () => {
  it('round-trips the two-line envelope we send in Marmot chats', () => {
    expect(giphyEnvelope(URL)).toBe(`${URL}\nvia GIPHY`);
    expect(extractGifUrl(giphyEnvelope(URL))).toBe(URL);
  });

  it("reads White Noise iOS's creator attribution too", () => {
    expect(extractGifUrl(`${URL}\nvia GIPHY · Oinker`)).toBe(URL);
  });

  it('still reads a bare URL, and never swallows other text', () => {
    expect(extractGifUrl(URL)).toBe(URL);
    expect(extractGifUrl(`${URL}\nlook at this`)).toBeNull();
    expect(extractGifUrl(`lol ${URL}\nvia GIPHY`)).toBeNull();
  });
});

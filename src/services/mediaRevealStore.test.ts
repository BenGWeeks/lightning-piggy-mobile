import {
  __resetForTests,
  forgetRevealedMedia,
  isMediaRevealed,
  markMediaRevealed,
} from './mediaRevealStore';

beforeEach(() => __resetForTests());

describe('mediaRevealStore', () => {
  it('remembers a reveal for the account that made it', () => {
    markMediaRevealed('alice', 'image:m1:https://x.example/a.png');
    expect(isMediaRevealed('alice', 'image:m1:https://x.example/a.png')).toBe(true);
  });

  it('never shares consent between accounts', () => {
    markMediaRevealed('alice', 'k');
    expect(isMediaRevealed('bob', 'k')).toBe(false);
    expect(isMediaRevealed(null, 'k')).toBe(false);
  });

  it('is keyed by media identity, so an edited URL needs a new tap', () => {
    markMediaRevealed('alice', 'image:m1:https://x.example/a.png');
    expect(isMediaRevealed('alice', 'image:m1:http://10.0.0.1/a.png')).toBe(false);
  });

  it('forgets an account on sign-out without touching others', () => {
    markMediaRevealed('alice', 'k');
    markMediaRevealed('bob', 'k');
    forgetRevealedMedia('alice');
    expect(isMediaRevealed('alice', 'k')).toBe(false);
    expect(isMediaRevealed('bob', 'k')).toBe(true);
  });
});

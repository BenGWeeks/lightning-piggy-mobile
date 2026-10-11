import { isPermanentWelcomeFailure } from './marmotWelcomeFailure';

jest.mock('@internet-privacy/marmot-ts', () => ({
  getWelcome: jest.fn((rumor: { content: string }) => {
    if (rumor.content === 'garbage') throw new Error('decode');
    return { secrets: [] };
  }),
}));

const rumor = (content = 'welcome') => ({ content }) as never;
const keyPackages = (matches: boolean[] | Error) => ({
  selectForWelcome: jest.fn(async () => {
    if (matches instanceof Error) throw matches;
    return matches.map((hasMatchingSecret) => ({ hasMatchingSecret })) as never;
  }),
});

describe('isPermanentWelcomeFailure', () => {
  const noSecret = new Error('Last error: No matching secret found');

  it('retries when one of our keys matches, whatever the last error said', async () => {
    expect(await isPermanentWelcomeFailure(keyPackages([false, true]), rumor(), noSecret)).toBe(
      false,
    );
  });

  it('is permanent when no key we hold matches (another device / deleted key)', async () => {
    expect(await isPermanentWelcomeFailure(keyPackages([false]), rumor(), noSecret)).toBe(true);
    expect(await isPermanentWelcomeFailure(keyPackages([]), rumor(), noSecret)).toBe(true);
  });

  it('is permanent for a malformed Welcome', async () => {
    const kps = keyPackages([true]);
    expect(await isPermanentWelcomeFailure(kps, rumor(), new Error('Invalid welcome event'))).toBe(
      true,
    );
    expect(await isPermanentWelcomeFailure(kps, rumor('garbage'), new Error('x'))).toBe(true);
  });

  it('treats a store error while checking as transient', async () => {
    expect(await isPermanentWelcomeFailure(keyPackages(new Error('db')), rumor(), noSecret)).toBe(
      false,
    );
  });
});

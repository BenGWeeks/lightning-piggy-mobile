import en from './en.json';
import uk from './uk.json';

type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else for (const [k, v] of leaves(value, path)) out.set(k, v);
  }
  return out;
}

// #948 regression: a bad merge replaced ~1,500 existing Ukrainian strings
// with the English source. Type-checking can't catch that (English values
// still satisfy `Translations`), so guard the catalogue's content instead.
describe('uk locale', () => {
  const enLeaves = leaves(en as Tree);
  const ukLeaves = leaves(uk as Tree);

  it('keeps long-standing translations rather than the English source', () => {
    expect(ukLeaves.get('tabs.home')).toBe('Головна');
    expect(ukLeaves.get('aboutScreen.sendFeedback')).toBe('Надіслати відгук');
    expect(ukLeaves.get('orderPaymentActions.scanHint')).toBe(
      'Відскануйте будь-яким гаманцем Lightning',
    );
  });

  it('translates the vast majority of strings shared with en', () => {
    let shared = 0;
    let identical = 0;
    for (const [path, value] of ukLeaves) {
      const source = enLeaves.get(path);
      if (source === undefined) continue;
      shared++;
      if (source === value) identical++;
    }
    expect(shared).toBeGreaterThan(1000);
    // Brand names, units and interpolation-only strings legitimately match
    // en; a bulk overwrite pushes this ratio far past the budget.
    expect(identical / shared).toBeLessThan(0.1);
  });
});

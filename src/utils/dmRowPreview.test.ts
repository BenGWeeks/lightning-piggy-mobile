import { dmRowPreview } from './dmRowPreview';

describe('dmRowPreview — Marmot (#1140)', () => {
  const MLS = 'AAEAAwABQJggd1eNN8W4RwiOszLjR'; // serialized MLS Welcome (base64)

  it('labels a Marmot group invite instead of showing its raw payload', () => {
    const preview = dmRowPreview(MLS, 444);
    expect(preview).toBe('🔒 Group invite (Marmot not supported yet)');
    expect(preview).not.toContain(MLS);
  });

  it('labels other Marmot kinds as not supported yet', () => {
    expect(dmRowPreview(MLS, 443)).toBe('🔒 Marmot message (not supported yet)');
    expect(dmRowPreview(MLS, 445)).toBe('🔒 Marmot message (not supported yet)');
  });

  it('leaves ordinary chat text unchanged', () => {
    expect(dmRowPreview('Hello!', 14)).toBe('Hello!');
  });
});

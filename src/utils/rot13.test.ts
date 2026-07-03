import { rot13 } from './rot13';

describe('rot13', () => {
  it('rotates basic ASCII letters', () => {
    expect(rot13('hello')).toBe('uryyb');
    expect(rot13('uryyb')).toBe('hello');
  });

  it('preserves case', () => {
    expect(rot13('Hello World')).toBe('Uryyb Jbeyq');
  });

  it('passes non-letter characters through', () => {
    expect(rot13('21 sats — under the bench!')).toBe('21 fngf — haqre gur orapu!');
  });

  it('is its own inverse', () => {
    const sample = 'In the branches near the playground';
    expect(rot13(rot13(sample))).toBe(sample);
  });
});

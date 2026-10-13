import { validateProfileMetadata } from './profileMetadata';
import { parseProfileContent } from './profileContent';

it.each([null, [], 42, true, 'name', {}])('tolerates malformed metadata %j', (value) => {
  expect(Object.values(validateProfileMetadata(value)).every((field) => field === undefined)).toBe(
    true,
  );
});
it.each([null, [], {}, 42, true])('drops non-string fields %j', (value) => {
  const data = Object.fromEntries(
    ['name', 'display_name', 'about', 'nip05', 'lud16', 'picture', 'banner'].map((field) => [
      field,
      value,
    ]),
  );
  expect(Object.values(validateProfileMetadata(data)).every((field) => field === undefined)).toBe(
    true,
  );
});
it.each([
  ['name', 'name', 64],
  ['display_name', 'displayName', 64],
  ['about', 'about', 2000],
  ['nip05', 'nip05', 320],
  ['lud16', 'lud16', 320],
] as const)('bounds %s', (field, output, limit) => {
  expect(validateProfileMetadata({ [field]: 'x'.repeat(limit) })[output]).toBe('x'.repeat(limit));
  expect(validateProfileMetadata({ [field]: 'x'.repeat(10000) })[output]).toBe(
    'x'.repeat(limit - 1) + '…',
  );
});
it.each([
  'http://cdn.example/a',
  'https://127.0.0.1/a',
  'https://u:p@cdn.example/a',
  'file:///a',
  'https://cdn.example/' + 'x'.repeat(2048),
])('drops unsafe or oversized URLs %s', (url) => {
  expect(validateProfileMetadata({ picture: url, banner: url })).toMatchObject({
    picture: undefined,
    banner: undefined,
  });
});
it('keeps bounded HTTPS URLs and sanitises kind-0 names', () => {
  expect(
    parseProfileContent(
      JSON.stringify({
        name: 'Al\u202eice',
        picture: 'https://cdn.example/a',
        banner: 'https://cdn.example/b',
      }),
    ),
  ).toMatchObject({
    name: 'Alice',
    picture: 'https://cdn.example/a',
    banner: 'https://cdn.example/b',
  });
  expect(parseProfileContent('{')).toMatchObject({ name: null });
});

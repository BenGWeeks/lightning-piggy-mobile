import {
  buildBlossomServerListEvent,
  blossomServersFromTags,
  normalizeBlossomServer,
} from './blossomServerList';

it('accepts only https server URLs, without a trailing slash', () => {
  expect(normalizeBlossomServer(' https://blossom.primal.net/ ')).toBe(
    'https://blossom.primal.net',
  );
  expect(normalizeBlossomServer('http://insecure.example')).toBeNull();
  expect(normalizeBlossomServer('not a url')).toBeNull();
});

it('builds and reads a BUD-03 kind-10063 list, keeping order and dropping junk', () => {
  const e = buildBlossomServerListEvent([
    'https://a.example/',
    'https://b.example',
    'http://x',
    'https://a.example',
  ]);
  expect(e.kind).toBe(10063);
  expect(e.tags).toEqual([
    ['server', 'https://a.example'],
    ['server', 'https://b.example'],
  ]);
  expect(
    blossomServersFromTags([...e.tags, ['server', 'ftp://bad'], ['r', 'https://c.example']]),
  ).toEqual(['https://a.example', 'https://b.example']);
});

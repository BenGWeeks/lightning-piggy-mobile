import { parseProfileContent } from './profileContent';

describe('parseProfileContent — text field types (#1448)', () => {
  it.each([{}, 42, true, ['Seller'], null, ''])(
    'drops malformed or empty text fields (%j)',
    (value) => {
      expect(
        parseProfileContent(
          JSON.stringify({
            name: value,
            display_name: value,
            nip05: value,
            about: value,
            lud16: value,
          }),
        ),
      ).toEqual({
        name: null,
        displayName: null,
        nip05: null,
        about: null,
        lud16: null,
        picture: null,
        banner: null,
      });
    },
  );

  it('preserves valid text fields without coercion', () => {
    expect(
      parseProfileContent(
        JSON.stringify({
          name: 'Seller',
          display_name: 'Shop',
          nip05: 'seller@example.com',
          about: 'Shop biography',
          lud16: 'pay@example.com',
        }),
      ),
    ).toMatchObject({
      name: 'Seller',
      displayName: 'Shop',
      nip05: 'seller@example.com',
      about: 'Shop biography',
      lud16: 'pay@example.com',
    });
  });
});

describe('parseProfileContent — automatic image destinations (#1338)', () => {
  const parse = (picture: unknown, banner: unknown) =>
    parseProfileContent(JSON.stringify({ name: 'n', picture, banner }));

  it('keeps public http(s) avatars and banners', () => {
    expect(parse('https://cdn.example.com/a.png', 'https://cdn.example.com/b.jpg')).toMatchObject({
      picture: 'https://cdn.example.com/a.png',
      banner: 'https://cdn.example.com/b.jpg',
    });
  });

  it.each([
    'http://192.168.1.1/cam.jpg',
    'http://127.1/x.png',
    'http://[::ffff:10.0.0.1]/x.png',
    'http://router/x.png',
    'http://printer.local/x.png',
    'javascript:alert(1)',
    42,
  ])('drops a private / malformed image URL %s', (bad) => {
    expect(parse(bad, bad)).toMatchObject({ picture: null, banner: null, name: 'n' });
  });
});

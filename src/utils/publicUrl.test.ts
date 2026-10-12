import {
  isPublicHttpUrl,
  isPublicRelayUrl,
  normalisePublicHost,
  parseIpv6,
  parsePublicUrl,
} from './publicUrl';

describe('publicUrl — accepts ordinary public URLs', () => {
  it.each([
    'https://example.com',
    'https://example.com/',
    'http://example.com/path?q=1#frag',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'HTTPS://EXAMPLE.COM/Path',
    'https://example.com.', // trailing dot = DNS root, still public
    'https://sub.domain.example.co.uk:8443/x',
    'https://xn--bcher-kva.de/', // punycode IDN
    'https://my_host.example.com/', // underscore labels exist in the wild
    'http://8.8.8.8/',
    'http://1.1.1.1:80/dns',
    'https://93.184.216.34/',
    'http://100.63.255.255/', // just below CGNAT
    'http://100.128.0.0/', // just above CGNAT
    'http://172.15.255.255/', // just below 172.16/12
    'http://172.32.0.0/', // just above 172.16/12
    'http://169.253.1.1/',
    'http://223.255.255.255/', // just below multicast
    'http://[2606:4700:4700::1111]/', // Cloudflare DNS
    'http://[2001:4860:4860::8888]:443/', // Google DNS
    'https://example.com?@127.0.0.1', // `@` is in the query, host is example.com
    'https://example.com/#@10.0.0.1',
    'https://de.wikipedia.org/wiki/Köln', // non-ASCII in the PATH is fine
  ])('%s', (url) => {
    expect(isPublicHttpUrl(url)).toBe(true);
  });

  it('normalises the host', () => {
    expect(parsePublicUrl('HTTPS://Example.COM.:8080/x')).toEqual({
      scheme: 'https',
      host: 'example.com',
      port: 8080,
    });
    expect(parsePublicUrl('http://[2606:4700:4700::1111]/')).toEqual({
      scheme: 'http',
      host: '2606:4700:4700::1111',
      port: null,
    });
  });
});

describe('publicUrl — rejects private / local / reserved IPv4', () => {
  it.each([
    ['loopback', 'http://127.0.0.1/'],
    ['loopback (other)', 'http://127.255.255.254/'],
    ['10/8', 'http://10.0.0.1/'],
    ['172.16/12 low', 'http://172.16.0.1/'],
    ['172.16/12 high', 'http://172.31.255.255/'],
    ['192.168/16', 'http://192.168.1.1/'],
    ['router w/ path', 'http://192.168.1.1/cgi-bin/reboot'],
    ['link-local / cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['CGNAT low', 'http://100.64.0.1/'],
    ['CGNAT high', 'http://100.127.255.255/'],
    ['0.0.0.0', 'http://0.0.0.0/'],
    ['0/8', 'http://0.1.2.3/'],
    ['multicast', 'http://224.0.0.1/'],
    ['multicast high', 'http://239.255.255.250/'],
    ['reserved 240/4', 'http://240.0.0.1/'],
    ['broadcast', 'http://255.255.255.255/'],
    ['IETF 192.0.0/24', 'http://192.0.0.8/'],
    ['TEST-NET-1', 'http://192.0.2.1/'],
    ['TEST-NET-2', 'http://198.51.100.1/'],
    ['TEST-NET-3', 'http://203.0.113.1/'],
    ['benchmarking', 'http://198.18.0.1/'],
    ['6to4 relay', 'http://192.88.99.1/'],
    ['with port', 'http://192.168.0.1:8080/'],
    ['trailing dot', 'http://127.0.0.1./'],
  ])('%s: %s', (_label, url) => {
    expect(isPublicHttpUrl(url)).toBe(false);
  });
});

describe('publicUrl — rejects non-canonical numeric hosts', () => {
  it.each([
    ['shorthand 127.1', 'http://127.1/'],
    ['shorthand 127.0.1', 'http://127.0.1/'],
    ['shorthand 10.1', 'http://10.1/'],
    ['integer', 'http://2130706433/'],
    ['integer 0', 'http://0/'],
    ['hex integer', 'http://0x7f000001/'],
    ['hex octets', 'http://0x7f.0x0.0x0.0x1/'],
    ['hex shorthand', 'http://0x7f.1/'],
    ['octal', 'http://0177.0.0.1/'],
    ['octal-looking public', 'http://010.8.8.8/'], // 10.8.8.8 to inet_aton, 8.8.8.8... to others
    ['leading zero', 'http://08.8.8.8/'],
    ['five parts', 'http://1.2.3.4.5/'],
    ['octet > 255', 'http://256.1.1.1/'],
    ['numeric last label', 'http://example.123/'],
    ['bare 0x', 'http://foo.0x/'],
    ['shorthand public', 'http://8.8/'],
  ])('%s: %s', (_label, url) => {
    expect(isPublicHttpUrl(url)).toBe(false);
  });
});

describe('publicUrl — rejects private / reserved IPv6', () => {
  it.each([
    ['loopback', 'http://[::1]/'],
    ['loopback expanded', 'http://[0:0:0:0:0:0:0:1]/'],
    ['unspecified', 'http://[::]/'],
    ['IPv4-mapped dotted', 'http://[::ffff:127.0.0.1]/'],
    ['IPv4-mapped hex', 'http://[::ffff:7f00:1]/'],
    ['IPv4-mapped private', 'http://[::ffff:192.168.1.1]/'],
    ['IPv4-mapped PUBLIC still rejected', 'http://[::ffff:8.8.8.8]/'],
    ['IPv4-mapped expanded', 'http://[0:0:0:0:0:ffff:7f00:1]/'],
    ['IPv4-compatible', 'http://[::127.0.0.1]/'],
    ['NAT64', 'http://[64:ff9b::7f00:1]/'],
    ['link-local', 'http://[fe80::1]/'],
    ['link-local upper', 'http://[febf::1]/'],
    ['site-local', 'http://[fec0::1]/'],
    ['ULA fc', 'http://[fc00::1]/'],
    ['ULA fd', 'http://[fd12:3456:789a::1]/'],
    ['multicast', 'http://[ff02::1]/'],
    ['documentation', 'http://[2001:db8::1]/'],
    ['documentation 3fff', 'http://[3fff::1]/'],
    ['Teredo', 'http://[2001:0:4136:e378::1]/'],
    ['6to4', 'http://[2002:7f00:1::1]/'],
    ['zone id', 'http://[fe80::1%25eth0]/'],
    ['zone id on public', 'http://[2606:4700::1%25eth0]/'],
    ['upper-case loopback', 'http://[::FFFF:127.0.0.1]/'],
    ['with port', 'http://[::1]:8080/'],
  ])('%s: %s', (_label, url) => {
    expect(isPublicHttpUrl(url)).toBe(false);
  });

  it.each([
    'http://[1:2:3:4:5:6:7:8:9]/', // too many groups
    'http://[1:2:3:4:5:6:7]/', // too few, no ::
    'http://[1::2::3]/', // two ::
    'http://[1:2:3:4::5:6:7:8]/', // :: compressing zero groups
    'http://[12345::1]/', // group too long
    'http://[::1.2.3]/', // bad embedded v4
    'http://[1.2.3.4::1]/', // embedded v4 not last
    'http://[2606:4700::1/', // unterminated
    'http://[2606:4700::1]x/', // junk after ]
    'http://[]/',
    'http://[g::1]/',
  ])('malformed IPv6 %s', (url) => {
    expect(isPublicHttpUrl(url)).toBe(false);
  });

  it('parses compressed and embedded-v4 forms', () => {
    expect(parseIpv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6('::ffff:127.0.0.1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
    expect(parseIpv6('2001:db8::')).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 0]);
    expect(parseIpv6('1:2:3:4:5:6:7:8')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('publicUrl — rejects local hostnames', () => {
  it.each([
    ['localhost', 'http://localhost/'],
    ['localhost trailing dot', 'http://localhost./'],
    ['LOCALHOST', 'http://LOCALHOST:3000/'],
    ['*.localhost', 'http://app.localhost/'],
    ['mDNS', 'http://printer.local/'],
    ['mDNS trailing dot', 'http://printer.local./'],
    ['.lan', 'http://router.lan/'],
    ['.internal', 'http://metadata.google.internal/'],
    ['.home.arpa', 'http://nas.home.arpa/'],
    ['reverse DNS', 'http://1.0.0.127.in-addr.arpa/'],
    ['.localdomain', 'http://box.localdomain/'],
    ['.home', 'http://router.home/'],
    ['.corp', 'http://wiki.corp/'],
    ['.test', 'http://site.test/'],
    ['.onion', 'http://abc.onion/'],
    ['single label', 'http://router/'],
    ['single label trailing dot', 'http://router./'],
    ['single label intranet', 'http://intranet/'],
    ['nip.io', 'http://10.0.0.1.nip.io/'],
    ['sslip.io', 'http://192-168-1-1.sslip.io/'],
    ['localtest.me', 'http://localtest.me/'],
    ['lvh.me sub', 'http://app.lvh.me/'],
  ])('%s: %s', (_label, url) => {
    expect(isPublicHttpUrl(url)).toBe(false);
  });
});

describe('publicUrl — rejects ambiguous or malformed URLs', () => {
  it.each([
    ['userinfo', 'http://user:pass@example.com/'],
    ['userinfo hiding private host', 'http://example.com@127.0.0.1/'],
    ['backslash trick', 'http://example.com\\@127.0.0.1/'],
    ['backslash authority', 'http://127.0.0.1\\example.com/'],
    ['percent-encoded host', 'http://%31%32%37.0.0.1/'],
    ['percent-encoded dot', 'http://127%2E0.0.1/'],
    ['embedded newline', 'http://127.0.0.\n1/'],
    ['embedded tab', 'http://exam\tple.com/'],
    ['leading space', ' http://example.com/'],
    ['full-width digits', 'http://１２７.０.０.１/'],
    ['ideographic dot', 'http://127。0。0。1/'],
    ['raw unicode IDN', 'http://bücher.de/'],
    ['full-width solidus in authority', 'http://127.0.0.1／example.com/'],
    ['DEL char', 'http://example.com/\x7f'],
    ['no slashes', 'http:example.com'],
    ['one slash', 'http:/example.com'],
    ['empty host', 'http:///path'],
    ['empty host with port', 'http://:80/'],
    ['bad port', 'http://example.com:abc/'],
    ['port 0', 'http://example.com:0/'],
    ['port too big', 'http://example.com:65536/'],
    ['double colon port', 'http://example.com:80:80/'],
    ['empty label', 'http://example..com/'],
    ['leading dot', 'http://.example.com/'],
    ['two trailing dots', 'http://example.com../'],
    ['hyphen-edged label', 'http://-example.com/'],
    ['label too long', `http://${'a'.repeat(64)}.com/`],
    ['empty string', ''],
    ['not a URL', 'example.com'],
  ])('%s', (_label, url) => {
    expect(isPublicHttpUrl(url)).toBe(false);
  });

  it.each([
    'ftp://example.com/',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'wss://relay.example.com',
    'data:text/html,hi',
    'gopher://example.com/',
  ])('rejects non-http scheme %s by default', (url) => {
    expect(isPublicHttpUrl(url)).toBe(false);
  });

  it('tolerates non-string input', () => {
    expect(isPublicHttpUrl(undefined as unknown as string)).toBe(false);
    expect(isPublicHttpUrl(null as unknown as string)).toBe(false);
  });
});

describe('publicUrl — relay URLs', () => {
  it('accepts public wss relays', () => {
    expect(isPublicRelayUrl('wss://relay.example.com')).toBe(true);
    expect(isPublicRelayUrl('wss://relay.example.com/')).toBe(true);
    expect(isPublicRelayUrl('WSS://Relay.Example.com:443')).toBe(true);
  });

  it.each([
    'wss://127.1',
    'wss://127.0.0.1',
    'wss://localhost:7777',
    'wss://[::1]',
    'wss://relay.local',
    'wss://10.0.0.5:7000',
    'https://relay.example.com', // wrong scheme for a relay
    'ws://relay.example.com', // plaintext not accepted by default
  ])('rejects %s', (url) => {
    expect(isPublicRelayUrl(url)).toBe(false);
  });

  it('accepts a custom scheme list', () => {
    expect(parsePublicUrl('ws://relay.example.com', ['ws', 'wss'])).not.toBeNull();
  });
});

describe('normalisePublicHost', () => {
  it('returns the normalised host or null', () => {
    expect(normalisePublicHost('Example.COM.')).toBe('example.com');
    expect(normalisePublicHost('[2606:4700::1]')).toBe('2606:4700::1');
    expect(normalisePublicHost('192.168.1.1')).toBeNull();
    expect(normalisePublicHost('')).toBeNull();
    expect(normalisePublicHost('[::1')).toBeNull();
  });
});

import { uploadToBlossomServers, type BlossomSigner } from './blossomService';

// Minimal XMLHttpRequest fake: each PUT is answered by `respond(url, body)`.
type Call = { url: string; body: unknown; headers: Record<string, string> };
let calls: Call[] = [];
let respond: (url: string) => { status: number; responseText: string } | 'network-error' | 'hang';

class FakeXhr {
  status = 0;
  responseText = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  timeout = 0;
  private url = '';
  private headers: Record<string, string> = {};
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(body: unknown) {
    calls.push({ url: this.url, body, headers: this.headers });
    const r = respond(this.url);
    setTimeout(() => {
      if (r === 'network-error') return this.onerror?.();
      // A server that never answers: the request's timeout fires instead.
      if (r === 'hang') return this.timeout > 0 ? this.ontimeout?.() : undefined;
      this.status = r.status;
      this.responseText = r.responseText;
      this.onload?.();
    }, 0);
  }
}

const ok = (url: string) => ({ status: 200, responseText: JSON.stringify({ url }) });
const signer: BlossomSigner = jest.fn(async (e) => ({ ...e, id: 'id', pubkey: 'p', sig: 's' }));
const B64 = Buffer.from('hello').toString('base64');

beforeEach(() => {
  calls = [];
  (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXhr;
  (signer as jest.Mock).mockClear();
});

const flush = () => new Promise((r) => setTimeout(r, 10));

it('uploads to the primary and mirrors to the backups with one signature', async () => {
  respond = (url) => ok(url.replace('/upload', '/blob'));
  const url = await uploadToBlossomServers(
    'file.jpg',
    ['https://a.example/', 'https://b.example', 'https://c.example'],
    signer,
    B64,
  );
  await flush();
  expect(url).toBe('https://a.example/blob');
  expect(signer).toHaveBeenCalledTimes(1);
  expect(calls.map((c) => c.url)).toEqual([
    'https://a.example/upload',
    'https://b.example/mirror',
    'https://c.example/mirror',
  ]);
  expect(JSON.parse(calls[1].body as string)).toEqual({ url: 'https://a.example/blob' });
  expect(calls[1].headers.Authorization).toBe(calls[0].headers.Authorization);
});

it('fails over to the next server when the primary is down', async () => {
  respond = (url) => (url.startsWith('https://a.example') ? 'network-error' : ok(url));
  const url = await uploadToBlossomServers(
    'file.jpg',
    ['https://a.example', 'https://b.example'],
    signer,
    B64,
  );
  await flush();
  expect(url).toBe('https://b.example/upload');
  // The (down) primary is still asked to mirror the stored blob.
  expect(calls.map((c) => c.url)).toEqual([
    'https://a.example/upload',
    'https://b.example/upload',
    'https://a.example/mirror',
  ]);
});

it("doesn't let a failing backup affect the upload", async () => {
  respond = (url) => (url.includes('/mirror') ? { status: 500, responseText: '' } : ok(url));
  await expect(
    uploadToBlossomServers('file.jpg', ['https://a.example', 'https://b.example'], signer, B64),
  ).resolves.toBe('https://a.example/upload');
});

it('throws the last error when every server rejects the upload', async () => {
  respond = () => ({ status: 413, responseText: 'too big' });
  await expect(
    uploadToBlossomServers('file.jpg', ['https://a.example', 'https://b.example'], signer, B64),
  ).rejects.toThrow('Blossom upload failed: 413 too big');
});

it('times out an unresponsive primary and fails over to the next server', async () => {
  respond = (url) => (url.startsWith('https://a.example') ? 'hang' : ok(url));
  await expect(
    uploadToBlossomServers('file.jpg', ['https://a.example', 'https://b.example'], signer, B64),
  ).resolves.toBe('https://b.example/upload');
  await flush(); // let the background mirror to the hung server settle
});

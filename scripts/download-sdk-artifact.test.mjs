import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { downloadArtifact } from './download-sdk-artifact.mjs';

for (const streamBody of [false, true]) {
  test(`deadline aborts ${streamBody ? 'slow body' : 'stalled headers'}`, async () => {
    const timers = [];
    const server = createServer((_request, response) => {
      if (streamBody) {
        response.writeHead(200);
        response.write('first');
        timers.push(setInterval(() => response.write('drip'), 10));
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}/sdk`;
    try {
      await assert.rejects(downloadArtifact(url, 100), /timed out after 100 ms/);
    } finally {
      timers.forEach(clearInterval);
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
}

test('keeps successful bodies and HTTP errors', async () => {
  const server = createServer((request, response) => {
    response.writeHead(request.url === '/ok' ? 200 : 503);
    response.end('sdk');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await downloadArtifact(`${url}/ok`)).toString(), 'sdk');
    await assert.rejects(downloadArtifact(`${url}/bad`), /503/);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

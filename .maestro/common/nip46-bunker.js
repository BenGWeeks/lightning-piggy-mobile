// Maestro `runScript` helper for the local NIP-46 test bunker
// (scripts/nip46-test-bunker.sh). Talks to its control API on 127.0.0.1 —
// Maestro runs on the host, so localhost is the bunker, not the device.
//
// Auth: the bunker's per-start token, from MAESTRO_NIP46_TOKEN (the runner
// exports it; Maestro picks up MAESTRO_* environment variables itself, so it
// never goes on a command line).
//
// env:
//   ACTION   mode | pair-from-screen | status | reset-stats | expect-count
//   MODE     for ACTION=mode: approve | decline | silent | decline-all | silent-all
//   WAIT     for ACTION=pair-from-screen: seconds to keep retrying the QR decode;
//            for ACTION=expect-count: seconds the bunker waits for the counter
//            (default 20) — requests can trail the UI by a relay round-trip
//   EXPECT_PAIRED  for ACTION=pair-from-screen: 'false' when the bunker is in a
//            silent-all / decline-all mode and is meant to refuse
//   COUNTER  for ACTION=expect-count: a key of /status `counts`
//            (e.g. "sign_event:kind=13", "verdict:decline")
//   MIN      for ACTION=expect-count: minimum value (default 1)
//   MAESTRO_NIP46_PORT  control port (default 8746; exported by the runner)
//
// Sets `output.nip46` to the bunker's JSON reply (mode / counts / paired).
var port =
  typeof MAESTRO_NIP46_PORT !== 'undefined' && MAESTRO_NIP46_PORT ? MAESTRO_NIP46_PORT : '8746';
var base = 'http://127.0.0.1:' + port;
var action = typeof ACTION !== 'undefined' ? ACTION : 'status';
var token = typeof MAESTRO_NIP46_TOKEN !== 'undefined' ? MAESTRO_NIP46_TOKEN : '';
if (!token) {
  throw new Error('MAESTRO_NIP46_TOKEN not set — run via scripts/signer-matrix-e2e.sh');
}
var headers = { Authorization: 'Bearer ' + token };

function call(method, path, body) {
  var r =
    method === 'GET'
      ? http.get(base + path, { headers: headers })
      : http.post(base + path, { body: body || '', headers: headers });
  if (!r.ok) {
    throw new Error(
      'NIP-46 test bunker ' +
        path +
        ' failed (' +
        r.status +
        '): ' +
        r.body +
        ' — is it running? bash scripts/nip46-test-bunker.sh start',
    );
  }
  return json(r.body);
}

var res;
if (action === 'mode') {
  res = call('POST', '/mode', MODE);
} else if (action === 'pair-from-screen') {
  res = call('POST', '/pair-from-screen', String(typeof WAIT !== 'undefined' && WAIT ? WAIT : 8));
  var expectPaired = !(typeof EXPECT_PAIRED !== 'undefined' && EXPECT_PAIRED === 'false');
  if (expectPaired && !res.paired) throw new Error('bunker did not pair: ' + JSON.stringify(res));
} else if (action === 'reset-stats') {
  res = call('POST', '/stats/reset', '');
} else if (action === 'expect-count') {
  var min = Number(typeof MIN !== 'undefined' && MIN ? MIN : 1);
  var secs = Number(typeof WAIT !== 'undefined' && WAIT ? WAIT : 20);
  // The bunker holds the request until the counter reaches MIN (or 408s).
  res = call(
    'GET',
    '/status?wait=' + encodeURIComponent(COUNTER) + '&min=' + min + '&timeout=' + secs,
  );
} else {
  res = call('GET', '/status');
}
output.nip46 = res;

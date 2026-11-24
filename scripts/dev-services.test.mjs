import assert from 'node:assert/strict';
import test from 'node:test';
import { runningFrontend, verifyBrowserAccess } from './dev-services.mjs';

test('running this checkout reuses its Expo port instead of choosing 8082', async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    return url.endsWith('/status') ? new Response('packager-status:running') :
      Response.json({ extra: { expoGo: { developer: { projectRoot: '/tmp/padi/frontend' } } } });
  };
  assert.equal(await runningFrontend(8081, '/tmp/padi/frontend', request), true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.headers['Expo-Platform'], 'ios');
});

test('an unused port starts normally while an unrelated or unreadable port fails clearly', async () => {
  assert.equal(await runningFrontend(8081, '/tmp/padi/frontend', async () => {
    throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  }), false);
  for (const request of [
    async () => new Response('another service'),
    async url => url.endsWith('/status') ? new Response('packager-status:running') :
      Response.json({ extra: { expoGo: { developer: { projectRoot: '/tmp/other/frontend' } } } }),
    async () => { throw new Error('timed out'); },
  ]) await assert.rejects(runningFrontend(8081, '/tmp/padi/frontend', request), /port|Port/);
});

test('reuse checks actual auth configuration and preflight for the selected origins', async () => {
  const calls = [];
  await verifyBrowserAccess('http://127.0.0.1:8080', ['http://localhost:8081', 'http://127.0.0.1:8081'], async (url, options) => {
    calls.push({ url, options });
    const headers = { 'Access-Control-Allow-Origin': options.headers.Origin };
    return options.method === 'OPTIONS' ? new Response(null, { status: 204, headers }) :
      Response.json({ otp_required: false }, { headers });
  });
  assert.deepEqual(calls.map(call => call.options.method), ['OPTIONS', 'GET', 'OPTIONS', 'GET']);
  assert.equal(calls[0].options.headers['Access-Control-Request-Headers'], 'content-type');
});

test('the 8082 CORS failure is caught before Expo starts, without broadening allowed origins', async () => {
  await assert.rejects(verifyBrowserAccess('http://127.0.0.1:8080', ['http://localhost:8082'], async () =>
    Response.json({ error: 'origin_not_allowed' }, { status: 403 })), /does not allow.*8082.*Restart the backend/);
  await assert.rejects(verifyBrowserAccess('http://127.0.0.1:8080', ['http://localhost:8081'], async () =>
    Response.json({ otp_required: false })), /does not allow/);
  await assert.rejects(verifyBrowserAccess('http://127.0.0.1:8080', ['http://localhost:8081'], async (_url, options) =>
    Response.json({ otp_required: 'invalid' }, { headers: { 'Access-Control-Allow-Origin': options.headers.Origin } })), /invalid sign-in settings/);
});

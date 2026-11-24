import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

function canonical(path) {
  try { return realpathSync(path); }
  catch { return resolve(path); }
}

/** Reuse only Metro for this checkout, never another project's occupied port. */
export async function runningFrontend(port, projectRoot, request = fetch) {
  const address = `http://127.0.0.1:${port}`;
  let status;
  try {
    status = await request(`${address}/status`, { signal: AbortSignal.timeout(2000), redirect: 'error' });
  } catch (error) {
    if (error.cause?.code === 'ECONNREFUSED') return false;
    throw new Error(`Could not check Expo on port ${port}. Check that port before starting PADI.`);
  }
  if (status.ok && (await status.text()).trim() === 'packager-status:running') {
    try {
      const response = await request(`${address}/`, {
        headers: { Accept: 'application/expo+json', 'Expo-Platform': 'ios' },
        signal: AbortSignal.timeout(10000), redirect: 'error',
      });
      const manifest = await response.json();
      const directory = manifest.extra?.expoGo?.developer?.projectRoot;
      if (response.ok && typeof directory === 'string' && canonical(directory) === canonical(projectRoot)) return true;
    } catch { /* An unidentified server must not be reused as this project. */ }
  }
  throw new Error(`Port ${port} is occupied by another or unidentified project. Stop that server, or set PADI_FRONTEND_PORT in backend/.env and restart PADI. Do not accept an unconfigured Expo fallback port.`);
}

/** A healthy reused API can still reject the actual web origin. Check both
 * the auth GET and its preflight because requestJSON sends Content-Type. */
export async function verifyBrowserAccess(apiAddress, origins, request = fetch) {
  for (const origin of origins) {
    for (const method of ['OPTIONS', 'GET']) {
      const response = await request(`${apiAddress}/v1/auth/config`, {
        method,
        headers: {
          Origin: origin,
          ...(method === 'OPTIONS' ? {
            'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'content-type',
          } : {}),
        },
        signal: AbortSignal.timeout(5000), redirect: 'error',
      });
      if (!response.ok || response.headers.get('access-control-allow-origin') !== origin) {
        throw new Error(`The running API does not allow browser requests from ${origin}. Restart the backend with npm run dev after setting PADI_FRONTEND_PORT; changes to backend/.env do not update an already running API.`);
      }
      if (method === 'GET' && typeof (await response.json()).otp_required !== 'boolean') {
        throw new Error('The running API returned invalid sign-in settings. Restart the PADI backend before opening the app.');
      }
    }
  }
}

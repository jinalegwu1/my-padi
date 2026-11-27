const apiKey = 'padi.chat.api-base.v1';

export function openWebChat(apiBase) {
  // Only the Expo build's public configuration crosses the page navigation.
  sessionStorage.setItem(apiKey, apiBase);
  const page = new URL('/padi-chat.html', location.origin);
  page.searchParams.set('route', location.pathname + location.search);
  location.replace(page.href);
}

export function chatApiBase() {
  const configured = sessionStorage.getItem(apiKey);
  if (configured !== null) return configured;
  // Direct visits to the static page also work in local development or behind
  // a same-origin /v1 reverse proxy. An incoming URL cannot select an API host.
  if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    return 'http://127.0.0.1:8080';
  }
  return location.origin;
}

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTS } = require('./helpers/load-ts.cjs');

const { deviceActionUrl } = loadTS('src/lib/device-actions.ts', {
  'expo': { requireOptionalNativeModule: () => null },
  'react-native': {
    Linking: { canOpenURL: async () => true, openURL: async () => {} },
    Platform: { OS: 'android' },
  },
});

test('phone call URL is normalized and escaped', () => {
  assert.equal(deviceActionUrl({ kind: 'call', phone: '+234 (803) 123-4567' }), 'tel:+2348031234567');
});

test('SMS URL includes an encoded body', () => {
  assert.equal(
    deviceActionUrl({ kind: 'sms', phone: '+2348031234567', body: 'Meet me soon' }),
    'sms:+2348031234567?body=Meet%20me%20soon',
  );
});

test('email URL includes encoded subject and body', () => {
  assert.equal(
    deviceActionUrl({ kind: 'email', recipient: 'hello@example.com', subject: 'Hello', body: 'My PADI' }),
    'mailto:hello@example.com?subject=Hello&body=My%20PADI',
  );
});

test('WhatsApp URL uses an international phone number and encoded text', () => {
  assert.equal(
    deviceActionUrl({ kind: 'whatsapp', phone: '+2348031234567', body: 'Hello PADI' }),
    'https://wa.me/2348031234567?text=Hello%20PADI',
  );
});

test('Facebook Messenger URL accepts a username and optional draft text', () => {
  assert.equal(
    deviceActionUrl({ kind: 'facebook', recipient: 'adebola', body: 'Hello' }),
    'https://www.messenger.com/t/adebola?text=Hello',
  );
});

test('music and video actions open encoded search URLs', () => {
  assert.equal(
    deviceActionUrl({ kind: 'music', query: 'Burna Boy Ye' }),
    'https://music.youtube.com/search?q=Burna%20Boy%20Ye',
  );
  assert.equal(
    deviceActionUrl({ kind: 'video', query: 'Lagos travel guide' }),
    'https://www.youtube.com/results?search_query=Lagos%20travel%20guide',
  );
});

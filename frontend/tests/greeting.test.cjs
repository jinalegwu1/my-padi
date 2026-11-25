const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTS } = require('./helpers/load-ts.cjs');
const { greetingRequest } = loadTS('src/lib/greeting.ts');

test('greeting is sent as an actual conversational turn', () => {
  assert.equal(greetingRequest(), 'Hi');
  assert.equal(greetingRequest('pcm-NG'), 'Hi');
  assert.equal(greetingRequest('fr-FR'), 'Hi');
});

test('greetings do not inject previous opener text as synthetic user content', () => {
  assert.equal(greetingRequest(), 'Hi');
});

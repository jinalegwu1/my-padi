const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTS } = require('./helpers/load-ts.cjs');
const { greetingRequest, greetingOpening } = loadTS('src/lib/greeting.ts');

test('greeting requests delegate personality and variation while honouring language selection', () => {
  assert.match(greetingRequest(), /short, spontaneous/);
  assert.match(greetingRequest(), /English \(en-NG\), without switching to Pidgin/);
  assert.match(greetingRequest('pcm-NG'), /Nigerian Pidgin/);
  assert.match(greetingRequest('fr-FR'), /French/);
  assert.doesNotMatch(greetingRequest(), /\b(?:Boss|Mrs|Mr|My Lord|Oga)\b/);
});

test('greeting variation retains only a nonpersonal opening word', () => {
  assert.equal(greetingOpening('Well, hello!'), 'well');
  assert.equal(greetingOpening('Jina, how are you?'), undefined);
  assert.equal(greetingOpening('Your interview is today.'), undefined);
  assert.match(greetingRequest('en-NG', 'well'), /different word from well/);
  assert.doesNotMatch(greetingRequest('en-NG', 'Private remembered detail'), /Private remembered detail/);
  assert.doesNotMatch(greetingRequest('en-NG', 'well Private remembered detail'), /Private remembered detail/);
});

test('returning greetings request continuity without copying old context into a new user turn', () => {
  const request = greetingRequest('en-NG');
  assert.match(request, /welcome me back in a way that fits the conversation/);
  assert.match(request, /Follow my conversation preferences/);
});

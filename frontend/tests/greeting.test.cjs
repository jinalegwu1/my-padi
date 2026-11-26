const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTS } = require('./helpers/load-ts.cjs');
const { greetingRequest, nextCheckIn } = loadTS('src/lib/greeting.ts');

test('a check-in carries only public cues, never prior message text', () => {
  const cue = nextCheckIn([{ backendUserID: 'a', backendChat: true, role: 'padi',
    text: 'Our private detail about plantain', checkIn: { gist_seed: 'pockets' } }], 'a');
  assert.ok(cue.recent_topics.includes('plantain'));
  assert.ok(cue.recent_topics.includes('pockets'));
  assert.ok(!cue.recent_topics.includes(cue.gist_seed));
  assert.doesNotMatch(greetingRequest(cue), /private detail/);
  assert.equal(greetingRequest(), 'Hi');
});

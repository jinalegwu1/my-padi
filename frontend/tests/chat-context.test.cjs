const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTS } = require('./helpers/load-ts.cjs');
const { chatContext, visibleChatMessages } = loadTS('src/lib/chat-context.ts');

const message = (text, revision, owner = 'a') => ({ id: text, role: 'padi', text, backendChat: true, backendUserID: owner, memoryRevision: revision });

test('deleted or paused facts never re-enter later turns through old replies', () => {
  const history = [message('Old recalled secret', 1), message('Fresh context', 2), message('New reply', 2)];
  const context = chatContext(history, 'a');
  assert.equal(context.memoryRevision, 2);
  assert.deepEqual(context.messages.map(m => m.content), ['Fresh context', 'New reply']);
  const secondTurn = chatContext([...history, message('Another new reply', 2)], 'a');
  assert(!secondTurn.messages.some(m => m.content.includes('secret')));
});

test('other accounts, demo greetings, and pending messages cannot supply AI context', () => {
  const context = chatContext([
    message('My reply', 3), message('Other account secret', 99, 'b'),
    { ...message('Pending', 3), pending: true },
    { ...message('Local demo', 3), backendChat: false },
    { ...message('Unattributed legacy data', 3), backendUserID: undefined },
  ], 'a');
  assert.equal(context.memoryRevision, 3);
  assert.deepEqual(context.messages, [{ role: 'assistant', content: 'My reply' }]);
});

test('follow-up context stays bounded and starts clean for a new account', () => {
  const history = Array.from({ length: 40 }, (_, i) => message(String(i), 4));
  assert.equal(chatContext(history, 'a').messages.length, 19);
  assert.deepEqual(chatContext(history, 'b'), { memoryRevision: 0, messages: [] });
});

test('private account-tagged recalled replies are not displayed to another account', () => {
  const history = [message('A private recalled fact', 1, 'a'), message('B private recalled fact', 1, 'b'),
    { id: 'greeting', role: 'padi', text: 'Local greeting' }];
  assert.deepEqual(visibleChatMessages(history, 'b').map(item => item.text), ['B private recalled fact', 'Local greeting']);
});

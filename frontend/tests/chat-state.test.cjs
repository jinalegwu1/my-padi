const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { loadTS } = require('./helpers/load-ts.cjs');
const context = loadTS('src/lib/chat-context.ts');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

async function fixture() {
  let session = { token: 'a-token', user: { id: 'a' } };
  const listeners = new Set();
  const calls = [];
  let backend = async () => ({ reply: 'Real reply 😊', memory_revision: 7 });
  const feedbackCalls = [];
  const api = {
    APIError: class extends Error {},
    sendChat: async (...args) => { calls.push(args); return backend(...args); },
    submitResponseFeedback: async (...args) => { feedbackCalls.push(args); },
  };
  let id = 0;
  const exported = loadTS('src/state/chat-context.tsx', {
    '@/data/mock-conversations': { WELCOME_MESSAGE: 'Welcome', nextId: prefix => `${prefix}-${++id}` },
    '@/hooks/use-persistent-state': { usePersistentState: () => { const [items, update] = React.useState([]); return [items, update, 'ready']; } },
    '@/lib/api': api, '@/lib/config': { hasBackend: true }, '@/lib/chat-context': context,
    '@/lib/session': {
      readSession: async () => session,
      subscribeSession: fn => { listeners.add(fn); return () => listeners.delete(fn); },
      clearSession: async () => { session = null; listeners.forEach(fn => fn()); },
    },
  });
  let text, voice, root;
  function TextProbe() { text = exported.useChat(); return null; }
  function VoiceProbe() { voice = exported.useChat(); return null; }
  await act(async () => { root = create(React.createElement(exported.ChatProvider, null, React.createElement(TextProbe), React.createElement(VoiceProbe))); });
  return {
    calls, feedbackCalls, api, get text() { return text; }, get voice() { return voice; },
    backend: fn => { backend = fn; },
    switchAccount: async () => act(async () => { session = { token: 'b-token', user: { id: 'b' } }; listeners.forEach(fn => fn()); }),
    close: async () => act(async () => root.unmount()),
  };
}

test('text and voice share replies, consent revision, and conversation context', async () => {
  const f = await fixture();
  try {
    await act(async () => { assert.equal(await f.text.send('Our project is PADI', 'a'), 'sent'); });
    await act(async () => { assert.equal((await f.voice.sendVoice('What is our project?', 'a', new AbortController().signal)).status, 'sent'); });
    assert.deepEqual(f.calls[1][1], [
      { role: 'user', content: 'Our project is PADI' }, { role: 'assistant', content: 'Real reply 😊' },
      { role: 'user', content: 'What is our project?' },
    ]);
    assert.equal(f.calls[1][2], 7);
    assert.equal(f.calls[1][6], 'en-NG');
    assert.equal(f.text.messages, f.voice.messages);
    assert.equal(f.text.messages.length, 4);
    assert.equal(f.text.messages[2].viaVoice, true);
    assert.equal(f.text.messages[3].backendUserID, 'a');
  } finally { await f.close(); }
});

test('voice turns preserve the explicitly selected language through shared chat',async()=>{
  const f=await fixture();
  try{
    await act(async()=>{await f.voice.sendVoice('Hello','a',new AbortController().signal,'en-GB');});
    assert.equal(f.calls.at(-1)[4],'voice');
    assert.equal(f.calls.at(-1)[6],'en-GB');
  }finally{await f.close();}
});

test('text sends expose the exact committed reply for the speech integration', async () => {
  const f = await fixture();
  try {
    let result;
    await act(async () => { result = await f.text.sendWithResponse('Question', 'a'); });
    assert.equal(result.status, 'sent');
    assert.equal(result.reply, 'Real reply 😊');
    assert.equal(f.text.messages.at(-1).id, result.messageID);
    assert.equal(f.text.messages.at(-1).text, result.reply);
  } finally { await f.close(); }
});

test('a pending voice send blocks competing text sends and cancellation removes both pending messages', async () => {
  const f = await fixture();
  const pending = deferred();
  f.backend(() => pending.promise);
  const controller = new AbortController();
  try {
    let sending;
    await act(async () => { sending = f.voice.sendVoice('Question', 'a', controller.signal); });
    await act(async () => { assert.equal(await f.text.send('Competing', 'a'), 'ignored'); });
    assert.equal(f.calls.length, 1);
    await act(async () => { controller.abort(); pending.resolve({ reply: 'Late private answer', memory_revision: 7 }); assert.equal((await sending).status, 'ignored'); });
    assert.equal(f.text.messages.length, 0);
    assert.equal(f.text.isThinking, false);
  } finally { await f.close(); }
});

test('stale expired response cannot sign out the next account or reuse old context', async () => {
  const f = await fixture();
  const pending = deferred();
  f.backend(() => pending.promise);
  try {
    let sending;
    await act(async () => { sending = f.text.send('A private question', 'a'); });
    await f.switchAccount();
    await act(async () => { pending.resolve(Promise.reject(Object.assign(new f.api.APIError('Expired'), { status: 401 }))); assert.equal(await sending, 'ignored'); });
    f.backend(async () => ({ reply: 'B reply', memory_revision: 0 }));
    await act(async () => { assert.equal(await f.text.send('B question', 'b'), 'sent'); });
    assert.equal(f.calls.at(-1)[0], 'b-token');
    assert.deepEqual(f.calls.at(-1)[1], [{ role: 'user', content: 'B question' }]);
  } finally { await f.close(); }
});

test('speech progress cannot annotate another account’s reply',async()=>{
  const f=await fixture();
  try{
    let result;
    await act(async()=>{result=await f.voice.sendVoice('Hello','a',new AbortController().signal);});
    await act(async()=>{f.voice.delivered(result.messageID,'Private old words',true,'b');});
    assert.equal(f.voice.messages.at(-1).voiceSpokenText,undefined);
    await act(async()=>{f.voice.delivered(result.messageID,'Real reply',true,'a');});
    assert.equal(f.voice.messages.at(-1).voiceSpokenText,'Real reply');
  }finally{await f.close();}
});

test('response feedback sends only a rating for the owning account and updates its reply', async () => {
  const f = await fixture();
  try {
    let replyID;
    await act(async () => { replyID = (await f.text.send('Hello', 'a')); });
    const messageID = f.text.messages.at(-1).id;
    await act(async () => { await f.text.rateResponse(messageID, 'liked_humour'); });
    assert.deepEqual(f.feedbackCalls, [['a-token', messageID, 'liked_humour']]);
    assert.equal(f.text.messages.at(-1).responseFeedback, 'liked_humour');
    await f.switchAccount();
    await assert.rejects(f.voice.rateResponse(messageID, 'not_helpful'), /Sign in to rate/);
    assert.equal(f.feedbackCalls.length, 1);
    assert.equal(replyID, 'sent');
  } finally { await f.close(); }
});

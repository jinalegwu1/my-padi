const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { loadTS } = require('./helpers/load-ts.cjs');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function fixture(send, platform = 'web') {
  const { Composer } = loadTS('src/components/chat/composer.tsx', {
    '@expo/vector-icons/Ionicons': 'icon',
    'react-native': { Platform: { OS: platform }, Pressable: 'button', TextInput: 'input', View: 'view', StyleSheet: { create: value => value, hairlineWidth: 1 } },
    '@/constants/theme': { fonts: {}, radius: {}, shadow: { card: {} }, spacing: {}, useColors: () => ({}), useType: () => ({}) },
  });
  let root;
  const props = { onSend: send, onOpenVoice: () => {}, placeholder: 'Message PADI', sendLabel: 'Send', voiceLabel: 'Voice' };
  await act(async () => { root = create(React.createElement(Composer, props)); });
  return {
    get input() { return root.root.findByType('input'); },
    change: async text => act(async () => root.root.findByType('input').props.onChangeText(text)),
    disable: async () => act(async () => root.update(React.createElement(Composer, { ...props, disabled: true }))),
    close: async () => act(async () => root.unmount()),
  };
}

test('Enter submits once while Shift+Enter and composing input retain the draft', async () => {
  const sent = [];
  const f = await fixture(text => { sent.push(text); return true; });
  try {
    await f.change('How you dey?');
    assert.equal(f.input.props.onSubmitEditing, undefined);
    for (const keys of [{ key: 'Enter', shiftKey: true }, { key: 'Enter', isComposing: true }, { key: 'Enter', keyCode: 229 }]) {
      await act(async () => f.input.props.onKeyPress({ nativeEvent: keys, preventDefault: () => assert.fail('newline or composition should remain available') }));
    }
    assert.equal(sent.length, 0);
    let prevented = false;
    await act(async () => f.input.props.onKeyPress({ nativeEvent: { key: 'Enter' }, preventDefault: () => { prevented = true; } }));
    assert.equal(prevented, true);
    assert.deepEqual(sent, ['How you dey?']);
    assert.equal(f.input.props.value, '');
  } finally { await f.close(); }
});

test('pending send prevents duplicates and preserves words typed for the next message', async () => {
  let resolve;
  const sent = [];
  const f = await fixture(text => { sent.push(text); return new Promise(done => { resolve = done; }); });
  const key = { nativeEvent: { key: 'Enter' }, preventDefault() {} };
  try {
    await f.change('First message');
    await act(async () => f.input.props.onKeyPress(key));
    await f.change('Next message');
    await act(async () => f.input.props.onKeyPress(key));
    assert.deepEqual(sent, ['First message']);
    await act(async () => resolve(true));
    assert.equal(f.input.props.value, 'Next message');
    await f.disable();
    await act(async () => f.input.props.onKeyPress(key));
    assert.deepEqual(sent, ['First message']);
  } finally { await f.close(); }
});

test('rejected sends keep the draft and native keyboard exposes the Send action', async () => {
  const f = await fixture(async () => false, 'android');
  try {
    await f.change('Keep this message');
    assert.equal(f.input.props.returnKeyType, 'send');
    assert.equal(f.input.props.submitBehavior, 'submit');
    await act(async () => f.input.props.onSubmitEditing());
    assert.equal(f.input.props.value, 'Keep this message');
  } finally { await f.close(); }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { loadTS } = require('./helpers/load-ts.cjs');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function fixture() {
  const previews = [], selections = [];
  const { VOICES } = loadTS('src/data/languages.ts');
  const preferences = { voiceId: 'baby', voiceRate: 1, reduceMotion: true };
  const Pressable = ({ children, ...props }) => React.createElement('button', props,
    typeof children === 'function' ? children({ pressed: false }) : children);
  const { VoicePicker } = loadTS('src/components/settings/voice-picker.tsx', {
    '@expo/vector-icons/Ionicons': 'icon',
    'react-native': { Pressable, Text: 'text', View: 'view', StyleSheet: { create: x => x, hairlineWidth: 1 },
      Animated: { Value: class { setValue() {} interpolate() {} }, View: 'animated-view' }, Easing: {} },
    '@/components/reactive-portrait': { ReactivePortrait: 'portrait' },
    '@/constants/theme': { fonts: {}, radius: {}, spacing: {}, useColors: () => ({}), useType: () => ({}) },
    '@/data/languages': { VOICES },
    '@/hooks/use-preferences': { usePreferences: () => ({ preferences, update: change => selections.push(change) }) },
    '@/lib/speech': { stopPadiSpeech: async () => {}, speakPortraitGreeting:(id,_language,_rate,signal,start,onText)=>new Promise(resolve=>{
      onText('Hi! Welcome back.');previews.push({id,signal,start,resolve});
    }) },
    '@/lib/session': { subscribeSession: () => () => {} },
    '@/lib/voice-preview': { previewVoice: (_text, id, _rate, signal, start) => new Promise(resolve => previews.push({ id, signal, start, resolve })) },
  });
  let root;
  await act(async () => { root = create(React.createElement(VoicePicker, {
    labels: { female: 'Female', male: 'Male', preview: 'Preview', stop: 'Stop', speed: 'Speed' },
  })); });
  return { previews, selections,
    portrait: id => root.root.findAllByType('portrait').find(node => node.props.voiceId === id),
    press: async label => act(async () => root.root.findAllByType('button').find(node => node.props.accessibilityLabel === label).props.onPress()),
    select: async id => act(async () => root.root.findAllByType('button').find(node => node.props.accessibilityLabel?.startsWith(`${VOICES.find(voice => voice.id === id).name},`)).props.onPress()),
    close: async () => act(async () => root.unmount()),
  };
}

test('preview portraits wait for audio start and stop moving when audio ends', async () => {
  const f = await fixture();
  try {
    assert.equal(f.portrait('baby').props.state, 'listening');
    for (const [id, name] of [['baby', 'PADI'], ['ada', 'Ada'], ['chidi', 'Chidi'], ['zainab', 'Zainab'], ['tunde', 'Tunde'], ['amara', 'Amara']]) {
      await f.press(`Preview: ${name}`);
      assert.equal(f.portrait(id).props.state, 'thinking');
      const preview = f.previews.at(-1);
      await act(async () => preview.start());
      assert.equal(f.portrait(id).props.state, 'speaking');
      await act(async () => preview.resolve());
      assert.equal(f.portrait(id).props.state, id === 'baby' ? 'listening' : 'idle');
    }
  } finally { await f.close(); }
});

test('switching or stopping previews ignores late playback callbacks', async () => {
  const f = await fixture();
  try {
    await f.press('Preview: Ada');
    const ada = f.previews.at(-1);
    await f.press('Preview: Chidi');
    assert.equal(ada.signal.aborted, true);
    await act(async () => { ada.start(); ada.resolve(); });
    assert.equal(f.portrait('chidi').props.state, 'thinking');
    const chidi = f.previews.at(-1);
    await f.press('Stop');
    assert.equal(chidi.signal.aborted, true);
    await act(async () => chidi.start());
    assert.equal(f.portrait('chidi').props.state, 'idle');
    await act(async () => chidi.resolve());

    await f.press('Preview: Ada');
    const next = f.previews.at(-1);
    await f.select('tunde');
    assert.equal(next.signal.aborted, true);
    assert.deepEqual(f.selections.at(-1), { voiceId: 'tunde' });
    assert.equal(f.previews.at(-1).id,'tunde','Touching a new person starts that person’s spoken greeting');
    await act(async () => next.resolve());
  } finally { await f.close(); }
});

test('touching the same selected person again speaks a fresh greeting',async()=>{
  const f=await fixture();
  try {
    await f.select('baby');const first=f.previews.at(-1);
    await f.select('baby');assert.equal(first.signal.aborted,true);
    assert.equal(f.previews.length,2);assert.equal(f.previews.at(-1).id,'baby');
    await act(async()=>first.resolve());
    assert.equal(f.portrait('baby').props.state,'thinking');
    await act(async()=>{f.previews.at(-1).start();f.previews.at(-1).resolve();});
  } finally {await f.close();}
});

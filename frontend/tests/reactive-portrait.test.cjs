const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { loadTS } = require('./helpers/load-ts.cjs');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const speechMotion=loadTS('src/lib/portrait-speech.ts');

function animations() {
  const values = [], started = [];
  class Value {
    constructor(value) { this.value = value; values.push(this); }
    setValue(value) { this.value = value; }
    stopAnimation() {}
    interpolate(config) { return { config, interpolate: this.interpolate }; }
  }
  function animation(kind, children = [], value, config) {
    return { kind, children, value, config, stopped: false,
      start() { this.stopped = false; started.push(this); },
      stop() { this.stopped = true; },
    };
  }
  return { values, started, Animated: {
    Value, View: 'animated-view',
    timing: (value, config) => animation('timing', [], value, config),
    delay: duration => animation('delay', [], undefined, { duration }),
    sequence: children => animation('sequence', children),
    parallel: children => animation('parallel', children),
    loop: child => animation('loop', [child]),
    add: () => ({ interpolate: config => config }),
  } };
}

function targets(animation, value) {
  return animation.value === value || animation.children.some(child => targets(child, value));
}

async function fixture(props = {}) {
  const motion = animations();
  const preferences = { reduceMotion: false, voiceRate: 1 };
  const { VOICES, findVoice } = loadTS('src/data/languages.ts');
  const { ReactivePortrait } = loadTS('src/components/reactive-portrait.tsx', {
    'expo-image': { Image: 'image' },
    'react-native': { Animated: motion.Animated, Easing: { out: x => x, inOut: x => x, sin: {}, quad: {} },
      Pressable: 'button', View: 'view', StyleSheet: { create: x => x } },
    '@/constants/theme': { useColors: () => ({ primary: 'blue' }) },
    '@/data/languages': { findVoice, VOICES },
    '@/data/portrait-rigs': { portraitRig: id => ({ photo: `${id}.jpg`, blink: `${id}-blink.png`, mouth: `${id}-mouth.png`, mouthBox: [240, 210, 120, 60] }) },
    '@/hooks/use-preferences': { usePreferences: () => ({ preferences }) },
    '@/lib/portrait-speech': speechMotion,
  });
  let root;
  let current = { voiceId: 'baby', size: 190, ...props };
  await act(async () => { root = create(React.createElement(ReactivePortrait, current)); });
  return { motion, preferences, VOICES, speechMotion,
    get button() { return root.root.findByType('button'); },
    update: async props => act(async () => { current = { ...current, ...props }; root.update(React.createElement(ReactivePortrait, current)); }),
    close: async () => act(async () => root.unmount()),
  };
}

test('every persona moves its lips with actual speech energy and closes them in silent pauses', async () => {
  const f = await fixture();
  const mouth = f.motion.values[3];
  try {
    assert.equal(f.motion.started.some(animation => targets(animation, mouth)), false);
    for (const voice of f.VOICES) {
      await f.update({ voiceId: voice.id, state: 'listening' });
      assert.match(f.button.props.accessibilityLabel, new RegExp(`${voice.name} portrait, PADI listening`));
      await f.update({ state: 'speaking' });
      const clip=f.speechMotion.portraitSpeech(voice.id);
      await act(async()=>clip.report(.85));
      assert.equal(targets(f.motion.started.at(-1),mouth),true);
      assert.equal(f.motion.started.at(-1).config.toValue,.85);
      await act(async()=>clip.report(0));
      assert.equal(mouth.value,0,'Silent syllable gaps close the mouth before playback ends');
      await act(async()=>clip.stop());
      await f.update({ state: 'listening' });
      assert.equal(mouth.value, 0, 'Returning to listening restores the resting lips immediately');
    }
  } finally { await f.close(); }
  assert.ok(f.motion.started.filter(animation => animation.kind === 'loop').every(animation => animation.stopped));
});

test('repeated touches restart the face reaction and include an explicit blink', async () => {
  const f = await fixture({ state: 'speaking' });
  try {
    await act(async () => f.button.props.onPress());
    const firstTouch = f.motion.started.at(-1);
    assert.equal(firstTouch.kind, 'parallel');
    assert.equal(targets(firstTouch,f.motion.values[6]),true,'Touch must close and reopen the eyes');
    await act(async () => f.button.props.onPress());
    assert.equal(firstTouch.stopped, true);
    await f.update({ interactive: false, pressed: true });
    assert.equal(f.motion.started.at(-1).kind, 'parallel', 'Picker row presses also animate the face');
    await f.update({pressed:false,touchVersion:1});
    const completed=f.motion.started.at(-1);
    assert.equal(completed.kind,'parallel','A completed tap blinks even if press-in/out were batched');
    await f.update({touchVersion:2});
    assert.equal(completed.stopped,true,'Repeated completed taps restart the reaction');
  } finally { await f.close(); }
});

test('reduced motion disables face loops and retains static touch feedback', async () => {
  const f = await fixture({ state: 'speaking' });
  try {
    f.preferences.reduceMotion = true;
    await f.update({});
    assert.ok(f.motion.started.every(animation => animation.stopped));
    const before = f.motion.started.length;
    await act(async () => f.button.props.onPress());
    assert.equal(f.motion.started.length, before);
    assert.equal(f.motion.values[5].value, 1, 'Touch still lights the portrait ring');
    assert.equal(f.motion.values[3].value, 0, 'Lips remain still with reduced motion');
  } finally { await f.close(); }
});

test('each portrait uses distinct bundled facial patches aligned with its crop', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { VOICES } = loadTS('src/data/languages.ts');
  const mocks = {};
  for (const { id } of VOICES) {
    for (const suffix of ['.jpg', '-blink.png', '-mouth.png', '-mouth-open.png']) {
      const asset = `@/assets/images/portraits/${id}${suffix}`;
      mocks[asset] = path.resolve(__dirname, `../assets/images/portraits/${id}${suffix}`);
    }
  }
  const { portraitRig } = loadTS('src/data/portrait-rigs.ts', mocks);
  const pngSize = file => {
    const bytes = fs.readFileSync(file);
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  };
  for (const { id } of VOICES) {
    const rig = portraitRig(id);
    assert.ok(fs.statSync(rig.photo).size > 0);
    assert.deepEqual(pngSize(rig.blink), [600, 600]);
    assert.deepEqual(pngSize(rig.mouth), rig.mouthBox.slice(2));
    assert.deepEqual(pngSize(rig.mouthOpen),rig.mouthBox.slice(2));
    const [x, y, width, height] = rig.mouthBox;
    assert.ok(x >= 0 && y >= 0 && x + width <= 600 && y + height <= 600);
  }
  assert.equal(new Set(VOICES.map(({ id }) => portraitRig(id).photo)).size, 6);
  assert.equal(portraitRig('unknown'), portraitRig('baby'));
});

// The chat host owns the account and conversation. This view receives the same
// call updates whether the user opened /voice or switched from text chat.
export function createVoiceScreen({ dispatch, translate, languageName, preparePortrait }) {
  const byId = id => document.getElementById(id);
  const screen = byId('voice-view');
  const portrait = byId('portrait');
  const mic = byId('pause-call');
  const toggle = byId('toggle-captions');
  const fastVoice = byId('fast-voice');
  const captions = byId('captions');
  let micAction = 'voice';
  let showTranscript = false;
  let portraitKey;
  let moveMouth;

  portrait.onclick = () => dispatch('voice');
  mic.onclick = () => dispatch(micAction);
  byId('voice-captions').onclick = () => dispatch('voice', 'captions');
  byId('voice-retry').onclick = () => dispatch('voice');
  toggle.onclick = () => dispatch('preference', { key: 'showVoiceTranscript', value: !showTranscript });
  fastVoice.onchange = () => dispatch('preference', { key: 'fastEnglishVoice', value: fastVoice.checked });

  function render(call, { preferences, paused }) {
    const key = preferences.voiceId + '/' + preferences.reduceMotion;
    if (key !== portraitKey) {
      portraitKey = key;
      moveMouth = preparePortrait(preferences.voiceId, preferences.reduceMotion);
    }

    const phase = { checking: 'connecting', preparing: 'connecting', transcribing: 'understanding' }[call.phase] || call.phase;
    byId('fast-voice-option').hidden = !call.fastEnglishAvailable || (call.connected && call.captionsOnly);
    fastVoice.checked = call.fastEnglishAvailable && preferences.fastEnglishVoice === true;
    fastVoice.disabled = !paused && phase !== 'idle' && !call.defaultVoiceAvailable;
    const offer = !fastVoice.checked && call.offer;
    screen.dataset.phase = paused ? 'paused' : phase;
    portrait.setAttribute('aria-label', byId('voice-name').textContent + ' portrait, PADI ' + screen.dataset.phase);
    const status = byId('voice-status');
    const statusText = offer
      ? translate(offer.speechEnabled ? 'voice.localeUnavailable' : 'voice.outputUnavailable', { language: languageName(offer.language) })
      : translate('voice.' + (paused ? 'pausedHint' : phase));
    if (status.textContent !== statusText) status.textContent = statusText;
    byId('voice-options').hidden = !offer;
    byId('voice-captions').textContent = translate('voice.useCaptions');
    byId('voice-retry').textContent = translate('voice.retry');

    const active = !paused && (call.connected || phase !== 'idle');
    micAction = active ? 'pauseCall' : 'voice';
    mic.hidden = !!offer;
    mic.querySelector('i').className = active ? 'icon pause' : 'icon mic';
    mic.querySelector('span').textContent = translate(paused ? 'voice.resume' : active ? 'voice.pause' : 'voice.micStart');

    showTranscript = !!preferences.showVoiceTranscript;
    const show = call.captionsOnly || showTranscript;
    const follow = captions.hidden || captions.scrollHeight - captions.scrollTop - captions.clientHeight < 35;
    toggle.hidden = !!call.captionsOnly;
    toggle.textContent = translate(show ? 'voice.hideWords' : 'voice.showWords');
    toggle.setAttribute('aria-expanded', String(!!show));
    byId('words').hidden = !show;
    captions.hidden = !show || !(call.userText || call.padiText);
    byId('user-caption-label').textContent = translate('voice.youSaid').toLocaleUpperCase();
    byId('user-caption-label').hidden = !call.userText;
    byId('padi-caption-label').hidden = !call.padiText;
    byId('user-caption').textContent = call.userText || '';
    byId('padi-caption').textContent = call.padiText || '';
    if (follow && !captions.hidden) captions.scrollTop = captions.scrollHeight;
  }

  return { render, level: frame => moveMouth?.(frame) };
}

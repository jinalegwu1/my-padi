import { createVoiceOutput } from './voice-output.js';

// Only audio from the authenticated host crosses into this local document.
export function connectFrameVoice(send, level) {
  const output = createVoiceOutput({portrait: voiceId => ({
    report: value => level({voiceId, level:value}), stop: () => level({voiceId, level:0}),
  })});
  let current;
  const stop = () => {
    if (!current) return;
    current.controller.abort();
    void current.player.finish().catch(() => {});
    current = null;
  };
  const unlock = () => { void output.unlock().catch(() => {}); };
  const gesture = event => {
    if (event.target.closest?.('#portrait, #switch-mode, #auto-speak[aria-pressed="false"], #composer button[type="submit"], [data-action="play"], [data-action="resume"]') ||
        (event.key === 'Enter' && event.target.closest?.('#composer textarea'))) unlock();
  };
  document.addEventListener('click', gesture, true);
  document.addEventListener('keydown', event => { if (event.key === 'Enter') gesture(event); }, true);
  window.addEventListener('pagehide', stop);
  return packet => {
    const {action, id, clip} = packet;
    if (action === 'begin') {
      stop();
      const controller = new AbortController();
      current = {id, controller, player:output.queue(controller.signal, 'ada')};
      return;
    }
    if (!current || id !== current.id) return;
    const turn = current;
    const report = state => { if (turn === current) send({id, clip, state}); };
    if (action === 'clip') {
      turn.player.enqueue(packet.wave, () => report('playing'), () => report('ended'))
        .catch(() => report('failed'));
    } else if (action === 'finish') {
      void turn.player.finish().then(() => { if (current === turn) current = null; }).catch(() => report('failed'));
    } else if (action === 'stop') stop();
    else if (action === 'pause') void output.pause().catch(() => report('failed'));
    else if (action === 'resume') void output.resume().catch(() => report('failed'));
  };
}

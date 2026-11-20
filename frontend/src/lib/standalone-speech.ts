import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { playVoice } from '@/lib/voice-playback';
import { portraitSpeech, speechEnvelope } from '@/lib/portrait-speech';

/** Play generated PCM speech without opening a microphone. */
export async function playStandaloneSpeech(encoded: string, signal: AbortSignal, onStart: () => void, voiceId?: string): Promise<void> {
  if (signal.aborted) return;
  if (Platform.OS === 'web') { await playVoice(encoded, signal, onStart, voiceId); return; }
  const file = new File(Paths.cache, 'padi-speech-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.wav');
  let player: AudioPlayer | undefined;
  const envelope = voiceId ? speechEnvelope(encoded) : null;
  let face:ReturnType<typeof portraitSpeech>|undefined;
  try {
    file.create(); file.write(encoded, { encoding: 'base64' });
    player = createAudioPlayer(file.uri, { updateInterval: 50 });
    await new Promise<void>((resolve, reject) => {
      let started = false, settled = false;
      const timer = setTimeout(() => finish(new Error('PADI’s voice did not finish. You can read the text and try again.')), 120_000);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal.removeEventListener('abort', stop); subscription.remove();
        error ? reject(error) : resolve();
      };
      const stop = () => { player?.pause(); finish(); };
      const subscription = player!.addListener('playbackStatusUpdate', status => {
        if (status.playing && !started && !signal.aborted) {
          started = true;
          if(voiceId)face=portraitSpeech(voiceId);
          onStart();
        }
        if(status.playing&&!signal.aborted&&envelope)face?.report(envelope.levelAt(status.currentTime));
        if (status.didJustFinish) finish();
      });
      signal.addEventListener('abort', stop, { once: true });
      if (signal.aborted) { stop(); return; }
      try { player!.play(); } catch { finish(new Error('PADI’s natural voice could not start. You can read the text.')); }
    });
  } finally {
    face?.stop();
    try { player?.release(); } finally { if (file.exists) file.delete(); }
  }
}

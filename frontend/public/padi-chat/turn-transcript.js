// An overlapping, one-word interruption can sound quite different to the live
// recognizer. Check the retained recording before submitting a doubtful word.
export async function turnTranscript(live, utterance, canUpload, upload, signal, interrupted = false) {
  if (!live) return signal.aborted ? '' : upload(signal);
  let words;
  try { words = (await live).trim(); }
  catch (error) {
    if (signal.aborted) return '';
    if (!canUpload) throw error;
    return upload(signal);
  }
  if (signal.aborted) return '';
  if (!canUpload || !utterance || utterance.pcm.length > 2.5 * utterance.sampleRate * 2) return words;
  const singleWord = /^[\p{L}]+(?:['’][\p{L}]+)?[.!?…]*$/u;
  const weakGreeting = /^i[.!?…]*$/i.test(words);
  const overlap = interrupted && singleWord.test(words);
  if (!weakGreeting && !overlap && (words || !hasShortSpeech(utterance))) return words;
  const check = new AbortController();
  const abort = () => check.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 30000);
  try {
    let checked;
    // Cancelling an earlier Whisper request can briefly reload its worker.
    // Retry this recording only while it is still the current microphone turn.
    for (let attempt = 0; ; attempt++) {
      try { checked = (await upload(check.signal)).trim(); break; }
      catch (error) {
        if (error?.code !== 'model_loading' || attempt >= 3 || check.signal.aborted) throw error;
        await new Promise(resolve => {
          const finish = () => { clearTimeout(timer); check.signal.removeEventListener('abort', finish); resolve(); };
          const timer = setTimeout(finish, 800 * (attempt + 1));
          check.signal.addEventListener('abort', finish, {once:true});
        });
        if (check.signal.aborted) break;
      }
    }
    if (!check.signal.aborted && (weakGreeting ? /^(hi|i)[.!?…]*$/i.test(checked) : singleWord.test(checked))) return checked;
  } catch (error) {
    if (error?.status === 401 || error?.code === 'model_loading') throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
  if (signal.aborted) return '';
  throw new Error(weakGreeting ? 'I heard either “hi” or “I”. Please say that again.' : 'I missed that short word. Please say it again.');
}

export function hasShortSpeech({pcm, sampleRate}) {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const window = 2 * Math.round(sampleRate * .02);
  let voiced = 0;
  for (let start = 0; start + window <= pcm.byteLength; start += window) {
    let energy = 0;
    for (let at = start; at < start + window; at += 2) energy += (view.getInt16(at, true) / 32768) ** 2;
    if (energy / (window / 2) > .002 ** 2 && ++voiced >= 5) return true;
  }
  return false;
}

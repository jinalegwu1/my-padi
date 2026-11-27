// Both recognizers hear the same microphone turn. Upload the retained audio
// only when live recognition fails or a short “I” needs a second listen.
export async function turnTranscript(live, utterance, canUpload, upload, signal) {
  if (!live) return signal.aborted ? '' : upload(signal);
  let text;
  try {
    text = await live;
  } catch (error) {
    if (signal.aborted) return '';
    if (!canUpload) throw error;
    return upload(signal);
  }
  if (signal.aborted) return '';
  if (!canUpload || utterance.pcm.length > 2.5 * utterance.sampleRate * 2 ||
      !/^i[.!?…]*$/i.test(text.trim())) return text;
  const check = new AbortController();
  const abort = () => check.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 15000);
  try {
    const words = (await upload(check.signal)).trim();
    if (!check.signal.aborted && /^(hi|i)[.!?…]*$/i.test(words)) return words;
  } catch (error) {
    if (error?.status === 401) throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
  if (signal.aborted) return '';
  throw new Error('I heard either “hi” or “I”. Please say that again.');
}

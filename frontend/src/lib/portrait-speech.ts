type SpeechLevel = { voiceId: string | null; level: number };
const listeners = new Set<(level: SpeechLevel) => void>();
let current: SpeechLevel = { voiceId: null, level: 0 };
let owner: symbol | null = null;

export function subscribePortraitSpeech(listener: (level: SpeechLevel) => void): () => void {
  listeners.add(listener);
  listener(current);
  return () => { listeners.delete(listener); };
}

/** Only the currently playing clip may drive a face or clear its mouth. */
export function portraitSpeech(voiceId: string) {
  const token = Symbol(voiceId);
  owner = token;
  const report = (level: number) => {
    if (owner !== token) return;
    current = { voiceId, level: Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0 };
    listeners.forEach(listener => listener(current));
  };
  report(0);
  return { report, stop() {
    if (owner !== token) return;
    owner = null;
    current = { voiceId: null, level: 0 };
    listeners.forEach(listener => listener(current));
  } };
}

/** Short PCM windows describe actual syllable energy. No microphone audio is used. */
export function speechEnvelope(encoded: string): { levelAt(seconds: number): number } {
  const empty = { levelAt: () => 0 };
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const data = new Uint8Array(Math.floor(encoded.length * 3 / 4));
  let bits = 0, count = 0, length = 0;
  for (const letter of encoded) {
    if (letter === '=') break;
    const value = alphabet.indexOf(letter);
    if (value < 0) return empty;
    bits = (bits << 6) | value; count += 6;
    if (count >= 8) { count -= 8; data[length++] = (bits >>> count) & 255; }
  }
  const bytes = data.subarray(0, length);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (length < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return empty;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let rate = 0, start = 0, size = 0;
  for (let offset = 12; offset + 8 <= length;) {
    const chunkSize = view.getUint32(offset + 4, true);
    if (offset + 8 + chunkSize > length) return empty;
    if (tag(offset) === 'fmt ') {
      if (chunkSize < 16 || view.getUint16(offset + 8, true) !== 1 || view.getUint16(offset + 10, true) !== 1 || view.getUint16(offset + 22, true) !== 16) return empty;
      rate = view.getUint32(offset + 12, true);
    }
    if (tag(offset) === 'data') { start = offset + 8; size = chunkSize; }
    offset += 8 + chunkSize + chunkSize % 2;
  }
  if (!rate || !start || !size || size % 2) return empty;
  const window = Math.max(1, Math.round(rate * .04));
  const samples = size / 2;
  const levels: number[] = [];
  let peak = 0;
  for (let offset = 0; offset < samples; offset += window) {
    const end = Math.min(samples, offset + window);
    let energy = 0;
    for (let index = offset; index < end; index++) {
      const value = view.getInt16(start + index * 2, true) / 32768;
      energy += value * value;
    }
    const rms = Math.sqrt(energy / (end - offset));
    levels.push(rms); peak = Math.max(peak, rms);
  }
  const normalizer = Math.max(.04, peak * .75);
  return { levelAt(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds >= samples / rate) return 0;
    const position = seconds * rate / window;
    const index = Math.floor(position), fraction = position - index;
    const rms = levels[index] * (1 - fraction) + (levels[index + 1] ?? 0) * fraction;
    return Math.max(0, Math.min(1, (rms - .008) / normalizer));
  } };
}

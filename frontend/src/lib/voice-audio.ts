import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';

export function audioUpload(bytes: Uint8Array): { form: FormData; dispose(): void } {
  const form = new FormData();
  if (Platform.OS === 'web') {
    form.append('audio',new Blob([bytes as BlobPart],{type:'audio/wav'}),'voice.wav');
    return {form,dispose() {}};
  }
  const file = new File(Paths.cache,`padi-voice-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
  try {
    file.create(); file.write(bytes);
    form.append('audio',{uri:file.uri,name:'voice.wav',type:'audio/wav'} as unknown as Blob);
  } catch(error) { if(file.exists) file.delete(); throw error; }
  return {form,dispose() { if(file.exists) file.delete(); }};
}

export function speechSegments(text: string): string[] {
  const sentences=text.trim().match(/[\s\S]*?[.!?](?=\s|$)|[\s\S]+$/g)?.map(sentence=>sentence.trim()).filter(Boolean)??[];
  const segments:string[]=[];
  // Keep requests below the speech endpoint's text limit, including long
  // single-sentence answers. Short replies continue to use one request.
  const splitLongSentence=(sentence:string) => {
    const parts:string[]=[];
    let remaining=sentence;
    while(remaining.length>650) {
      const boundary=remaining.lastIndexOf(' ',650);
      const cut=boundary>0?boundary:650;
      const part=remaining.slice(0,cut).trim();
      if(part)parts.push(part);
      remaining=remaining.slice(cut).trim();
    }
    if(remaining)parts.push(remaining);
    return parts;
  };
  if(text.length>220&&sentences.length>1) {
    for(const part of splitLongSentence(sentences.shift()!))segments.push(part);
  }
  let current='';
  for(const sentence of sentences) {
    for(const part of splitLongSentence(sentence)) {
      if(current&&current.length+part.length+1>650) {segments.push(current);current='';}
      if(part.length>650) {segments.push(part);continue;}
      current=[current,part].filter(Boolean).join(' ');
    }
  }
  if(current)segments.push(current);
  return segments;
}

/** Return only complete sentence boundaries; keep the unfinished tail buffered. */
export function takeCompletedSentences(text: string): { sentences: string[]; remainder: string } {
  const sentences: string[] = [];
  let start = 0;
  const boundary = /[.!?](?=\s|$)/g;
  for (const match of text.matchAll(boundary)) {
    const end = match.index! + 1;
    const sentence = text.slice(start, end).trim();
    if (!sentence) continue;
    if (/\b(?:Mr|Mrs|Ms|Dr|Prof|St|e\.g|i\.e|vs|etc)\.$/i.test(sentence)) continue;
    sentences.push(sentence);
    start = end;
    while (/\s/.test(text[start] ?? '') && start < text.length) start++;
  }
  return { sentences, remainder: text.slice(start) };
}

/** Release a usable first phrase instead of waiting on a long sentence's final
 * punctuation. Later passages can be larger to maintain synthesis throughput. */
export function takeReadySpeech(text:string,first=true):{sentences:string[];remainder:string} {
  const limit=first?160:650;
  const complete=takeCompletedSentences(text);
  if(text.length>limit&&(!complete.sentences.length||complete.sentences[0].length>limit)) {
    const cut=text.lastIndexOf(' ',limit);
    if(cut>=40)return {sentences:[text.slice(0,cut).trim()],remainder:text.slice(cut).trimStart()};
  }
  return complete;
}

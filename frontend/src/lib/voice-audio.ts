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

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
  let current='';
  for(const sentence of sentences) {
    if(current && current.length+sentence.length>650) {segments.push(current);current='';}
    current=[current,sentence].filter(Boolean).join(' ');
  }
  if(current)segments.push(current);
  return segments;
}

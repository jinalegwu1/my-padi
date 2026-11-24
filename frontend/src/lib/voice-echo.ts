import type { PCMFrame } from '@/lib/voice-activity';

type Reference={mono:Float32Array;position():number;stopAt:number};
const references:Reference[]=[];

/** Prepare the actual output PCM before reserving its playback-clock slot. */
export function preparePlaybackReference(samples:Float32Array,rate:number) {
  const mono=new Float32Array(Math.floor(samples.length*16000/rate));
  if(rate===16000)mono.set(samples.subarray(0,mono.length));
  else {
    // Match the microphone's band-limited conversion. Averaging/downsampling
    // aliases high-frequency consonants and can mistake that residual for speech.
    const radius=Math.ceil(32*Math.max(1,rate/16000)),cutoff=.45*Math.min(1,16000/rate);
    const kernels=new Map<number,Float64Array>();
    for(let i=0;i<mono.length;i++){
      const position=i*rate/16000,start=Math.floor(position),phase=Math.round((position-start)*256);
      let weights=kernels.get(phase);
      if(!weights){
        weights=new Float64Array(radius*2+1);let total=0;
        for(let j=-radius;j<=radius;j++){
          const distance=j-phase/256,angle=2*Math.PI*cutoff*distance;
          const window=.42+.5*Math.cos(Math.PI*distance/radius)+.08*Math.cos(2*Math.PI*distance/radius);
          const value=2*cutoff*(angle===0?1:Math.sin(angle)/angle)*window;
          weights[j+radius]=value;total+=value;
        }
        for(let j=0;j<weights.length;j++)weights[j]/=total;kernels.set(phase,weights);
      }
      let value=0;
      for(let j=-radius;j<=radius;j++)if(start+j>=0&&start+j<samples.length)value+=samples[start+j]*weights[j+radius];
      mono[i]=value;
    }
  }
  return (position:()=>number)=>{
    const ref:Reference={mono,position,stopAt:mono.length/16000};references.push(ref);
    return ()=>{
      ref.stopAt=Math.min(ref.stopAt,Math.max(0,position()));
      if(ref.stopAt===0){const index=references.indexOf(ref);if(index>=0)references.splice(index,1);}
    };
  };
}

export function prepareWaveReference(encoded:string) {
  const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
  const view=new DataView(bytes.buffer);
  const rate=view.getUint32(24,true);
  const samples=new Float32Array((bytes.length-44)/2);
  for(let i=0;i<samples.length;i++)samples[i]=view.getInt16(44+i*2,true)/32768;
  return preparePlaybackReference(samples,rate);
}

/** Supplement device AEC with a delayed far-end reference. Correlated speaker
 * audio is removed; uncorrelated/double-talk speech still reaches the VAD. */
export function suppressPlaybackEcho(frame:PCMFrame):PCMFrame {
  if(frame.channels!==1||frame.sampleRate!==16000||frame.data.byteLength%2)return frame;
  const age=frame.capturedAt===undefined?0:Math.max(0,performance.now()/1000-frame.capturedAt);
  for(let i=references.length-1;i>=0;i--)if(references[i].position()>references[i].stopAt+Math.max(.6,age+.6))references.splice(i,1);
  if(!references.length)return frame;
  const input=new DataView(frame.data),count=frame.data.byteLength/2,samples=new Float32Array(count);let power=0;
  for(let i=0;i<count;i++){samples[i]=input.getInt16(i*2,true)/32768;power+=samples[i]*samples[i];}
  if(power<1e-7)return frame;
  let best:{ref:Reference;base:number;score:number}|undefined;
  for(const ref of references) {
    const position=ref.position()-age-count/16000;
    if(position<-.08||position>ref.stopAt+.5)continue;
    const score=(base:number,stride:number)=>{
      let cross=0,energy=0;
      let inputPower=0;
      for(let i=0;i<count;i+=stride){
        const at=base+i,value=at<0||at>=ref.stopAt*16000?0:(ref.mono[at]??0);
        cross+=samples[i]*value;energy+=value*value;inputPower+=samples[i]*samples[i];
      }
      if(energy<1e-7||inputPower<1e-7)return null;
      return {base,score:cross>0?cross*cross/(inputPower*energy):0};
    };
    // Preserve the PCM's phase instead of aligning only its low-frequency
    // envelope, which can confuse adjacent pitch periods. Sparse full-band
    // candidates are cheap; verify the strongest ones against every sample.
    const newest=Math.round(position*16000),candidates:{base:number;score:number}[]=[];
    for(let lag=-480;lag<=7200;lag++){
      const match=score(newest-lag,16);if(!match)continue;
      if(candidates.length<12||match.score>candidates[candidates.length-1].score){
        candidates.push(match);candidates.sort((a,b)=>b.score-a.score);if(candidates.length>12)candidates.pop();
      }
    }
    for(const candidate of candidates){const match=score(candidate.base,1);if(match&&(!best||match.score>best.score))best={...match,ref};}
  }
  // A weak accidental match must never rewrite a consonant of the user's
  // interrupting word. Double talk without a strong match passes through;
  // genuine onset then stops playback and removes the echo at its source.
  if(!best||best.score<.8)return frame;
  const match=best;
  const data=new ArrayBuffer(frame.data.byteLength),output=new DataView(data);
  // Fit a short FIR around the matched delay. A single gain/linear interpolation
  // cannot match the microphone resampler's fractional phase, especially on
  // consonants. Fit only the far-end waveform; unrelated user speech remains.
  const taps=7,center=match.base,matrix=Array.from({length:taps},()=>new Float64Array(taps+1));
  const values=new Float64Array(taps);let originalPower=0;
  for(let i=0;i<count;i++){
    const value=input.getInt16(i*2,true)/32768;originalPower+=value*value;
    for(let tap=0;tap<taps;tap++){
      const at=center+i+tap-3;values[tap]=at<0||at>=match.ref.stopAt*16000?0:(match.ref.mono[at]??0);
    }
    for(let row=0;row<taps;row++){
      matrix[row][taps]+=values[row]*value;
      for(let column=row;column<taps;column++)matrix[row][column]+=values[row]*values[column];
    }
  }
  const regularizer=matrix.reduce((sum,row,i)=>sum+row[i],0)/taps*.0001+1e-9;
  for(let row=0;row<taps;row++){for(let column=0;column<row;column++)matrix[row][column]=matrix[column][row];matrix[row][row]+=regularizer;}
  for(let column=0;column<taps;column++){
    let pivot=column;for(let row=column+1;row<taps;row++)if(Math.abs(matrix[row][column])>Math.abs(matrix[pivot][column]))pivot=row;
    [matrix[column],matrix[pivot]]=[matrix[pivot],matrix[column]];
    const divisor=matrix[column][column];if(Math.abs(divisor)<1e-12)return frame;
    for(let j=column;j<=taps;j++)matrix[column][j]/=divisor;
    for(let row=0;row<taps;row++)if(row!==column){const scale=matrix[row][column];for(let j=column;j<=taps;j++)matrix[row][j]-=scale*matrix[column][j];}
  }
  let residualPower=0;
  for(let i=0;i<count;i++){
    let echo=0;
    for(let tap=0;tap<taps;tap++){const at=center+i+tap-3;if(at>=0&&at<match.ref.stopAt*16000)echo+=(match.ref.mono[at]??0)*matrix[tap][taps];}
    const residual=input.getInt16(i*2,true)/32768-echo;residualPower+=residual*residual;
    output.setInt16(i*2,Math.max(-32768,Math.min(32767,Math.round(residual*32768))),true);
  }
  if(best.score>.98&&residualPower/originalPower<.005)return {...frame,data:new ArrayBuffer(frame.data.byteLength),voiceLevel:-140};
  const residual=Math.sqrt(residualPower/count);
  return {...frame,data,voiceLevel:20*Math.log10(Math.max(1e-7,residual))};
}

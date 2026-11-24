const assert = require('node:assert/strict');
const { resolveObjectURL } = require('node:buffer');
const vm = require('node:vm');
const { loadTS } = require('./load-ts.cjs');

// Execute the actual Blob-loaded worklet, including its resampler. The mocks
// supply browser resources; none of the capture or DSP code is copied here.
exports.captureHarness = (options = {}) => {
  const original = Object.fromEntries(['navigator', 'AudioContext', 'AudioWorkletNode'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const frames = [], contexts = [], nodes = [], requested = [];
  const track = { stopped: 0, onended: null, stop() { this.stopped++; } };
  const stream = { getTracks: () => [track] };
  let constraints, interruptions = 0;

  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: {
    async getUserMedia(input) {
      constraints = input;
      if (options.permissionDenied) throw new DOMException('Denied', 'NotAllowedError');
      if (options.microphoneError) throw new DOMException('Microphone unavailable', options.microphoneError);
      await options.permission;
      return stream;
    },
  } } });
  globalThis.AudioContext = class {
    constructor(input) {
      requested.push(input);
      if (options.rejectRequestedRate && input?.sampleRate) throw new DOMException('Unsupported rate', 'NotSupportedError');
      this.sampleRate = options.ignoreRequestedRate ? options.engineRate : input?.sampleRate ?? options.engineRate ?? 48000;
      this.closed = 0;
      this.currentTime = 0;
      this.destination = {};
      this.audioWorklet = { addModule: async url => {
        this.worklet = await resolveObjectURL(url).text();
        await options.moduleReady;
      } };
      contexts.push(this);
    }
    async resume() {}
    async close() { this.closed++; }
    createMediaStreamSource() {
      if (options.rejectSourceAt16k && this.sampleRate === 16000) throw new DOMException('Microphone rate mismatch', 'NotSupportedError');
      return { connect() {}, disconnect() {} };
    }
    createMediaStreamDestination() {
      return { stream: { getTracks: () => [{ stop() {} }] }, channelCount: 1, channelCountMode: 'explicit' };
    }
  };
  globalThis.AudioWorkletNode = class {
    constructor(context, name, input) {
      assert.equal(name, 'padi-capture');
      this.options = input;
      this.port = { onmessage: null };
      let Processor;
      const port = this.port;
      this.globals = {
        currentFrame: options.startFrame ?? 0,
        sampleRate: context.sampleRate, ArrayBuffer, DataView, Float64Array,
        AudioWorkletProcessor: class { constructor() { this.port = { postMessage: data => port.onmessage?.({ data }) }; } },
        registerProcessor: (_name, implementation) => { Processor = implementation; },
      };
      vm.runInNewContext(context.worklet, this.globals);
      this.context = context;
      this.processor = new Processor();
      nodes.push(this);
    }
    connect() {}
    disconnect() { this.disconnected = true; }
  };
  const { VoiceCapture } = loadTS('src/lib/voice-capture.web.ts');
  const capture = new VoiceCapture(frame => { frames.push(frame); options.onFrame?.(frame); }, () => { interruptions++; options.onInterrupted?.(); });
  return {
    VoiceCapture, capture, frames, contexts, nodes, requested, track,
    get constraints() { return constraints; },
    get interruptions() { return interruptions; },
    feed(samples, blockSize = 128) {
      const node=nodes[0];
      for (let offset = 0; offset < samples.length; offset += blockSize) {
        const block=samples.subarray(offset, offset+blockSize);
        node.context.currentTime=(node.globals.currentFrame+block.length)/node.context.sampleRate;
        node.processor.process([[block]]);
        node.globals.currentFrame+=block.length;
      }
    },
    async close() {
      try { await capture.stop(); }
      finally {
        for (const [name, descriptor] of Object.entries(original)) {
          if (descriptor) Object.defineProperty(globalThis, name, descriptor);
          else delete globalThis[name];
        }
      }
    },
  };
};

exports.joinPCM = frames => new Uint8Array(Buffer.concat(frames.map(frame => Buffer.from(frame.data))));
exports.tone = (rate, seconds, frequency = 1000, amplitude = 0.05) => Float32Array.from({ length: Math.round(rate * seconds) }, (_, index) => amplitude * Math.sin(2 * Math.PI * frequency * index / rate));
exports.pcm16 = samples => {
  const data = new Uint8Array(samples.length * 2);
  const view = new DataView(data.buffer);
  for (let index = 0; index < samples.length; index++) view.setInt16(index * 2, Math.max(-32768, Math.min(32767, Math.round(samples[index] * 32767))), true);
  return data;
};

const { turnTranscript } = require('../../public/padi-chat/turn-transcript.js');
const { VoiceActivity, wavAudio } = require('@/lib/voice-activity');
const { takeCompletedSentences, takeReadySpeech } = require('@/lib/voice-audio');
function measureTurn(stage, start) {
  if (start === undefined || typeof performance.measure !== 'function') return;
  const name = 'padi.voice.' + stage;
  try {
    if (performance.getEntriesByName(name).length >= 256) performance.clearMeasures(name);
    performance.measure(name, {
      start,
      end: performance.now()
    });
  } catch {/* Older native runtimes may lack User Timing Level 3. */}
}
/** Keep the microphone active during speech. AEC/reference filtering rejects
 * speaker echo; genuine speech onset cancels only PADI's response, not capture. */
class HandsfreeSession {
  session = null;
  controller = null;
  capture = null;
  activity;
  queue = [];
  turnID = 0;
  verifying = null;
  recognition = null;
  input = null;
  partial = '';
  draining = false;
  work = null;
  lastVoiceAt;
  pending = '';
  stopping = null;
  snapshot = {
    phase: 'idle',
    connected: false,
    padiText: '',
    error: null
  };
  wakeMode = false;
  wakeActivated = false;
  wakeTimer = null;
  constructor(deps) {
    this.deps = deps;
    this.activity = new VoiceActivity((rate, startedAt) => this.began(rate, startedAt), utterance => {
      if (this.queue.length >= 3) {
        void this.cancel('Voice could not keep up. Please restart the conversation.');
        return;
      }
      this.lastVoiceAt = utterance.lastVoiceAt;
      const live = this.input?.finish();
      // Only short live turns can request an independent recognition pass.
      const keepAudio = !live || utterance.pcm.length <= 2.5 * utterance.sampleRate * 2;
      this.queue.push({
        id: this.turnID, interrupted: this.interrupted,
        live,
        wav: keepAudio ? wavAudio(utterance) : undefined
      });
      this.input = null;
      void this.drain();
    }, {
      onsetMs: 120,
      audio: pcm => this.input?.write(pcm),
    });
  }
  change(update) {
    this.snapshot = {
      ...this.snapshot,
      ...update
    };
    this.deps.changed(this.snapshot);
  }
  alive(controller = this.controller) {
    return !!controller && this.controller === controller && !controller.signal.aborted;
  }
  makeWork(accountID) {
    let finish;
    const done = new Promise(resolve => {
      finish = resolve;
    });
    return {
      controller: new AbortController(),
      spoken: '',
      accountID,
      done,
      finish,
      speechTask: Promise.resolve(),
      played: false
    };
  }
  async start({
    greet = true,
    wake = false,
    greetBeforeCapture = false
  } = {}) {
    if (this.controller || this.stopping) return;
    this.wakeMode = wake;
    this.wakeActivated = false;
    const controller = new AbortController();
    this.controller = controller;
    this.change({
      phase: 'preparing',
      error: null
    });
    try {
      const session = await this.deps.readSession();
      if (!this.alive(controller)) return;
      if (!session) throw new Error('Sign in to talk with PADI.');
      this.session = session;
      this.activity.reset();
      if (this.deps.openRecognition) {
        const connection = await this.deps.openRecognition(session.token, controller.signal, message => {
          if (this.alive(controller)) void this.cancel(message);
        });
        if (!this.alive(controller)) return;
        this.recognition = connection;
      }
      // On chat entry PADI can say hello while the OS asks about the microphone.
      const opening = greetBeforeCapture && greet && this.deps.greet ? this.greet(controller) : null;
      this.capture = this.deps.capture(frame => {
        if (this.alive(controller) && this.snapshot.connected) this.activity.feed(this.deps.filterFrame?.(frame) ?? frame);
      }, () => {
        void this.cancel('Voice was interrupted by the device. Tap PADI to continue.');
      });
      try {
        await this.capture.start(controller.signal);
      } catch (error) {
        await opening;
        throw error;
      }
      if (!this.alive(controller)) return;
      this.change({
        connected: true
      });
      if (opening) {
        if (this.snapshot.phase === 'preparing') this.change({
          phase: 'listening'
        });
      } else if (greet && this.deps.greet) void this.greet(controller);else this.change({
        phase: 'listening'
      });
    } catch (error) {
      if (this.alive(controller)) await this.cancel(error instanceof Error ? error.message : 'Voice could not start.');
    }
  }
  async greet(sessionController) {
    if (!this.deps.greet) return;
    const work = this.makeWork(this.session.user.id);
    this.work = work;
    const stop = () => work.controller.abort();
    sessionController.signal.addEventListener('abort', stop, {
      once: true
    });
    this.change({
      phase: 'thinking'
    });
    try {
      await this.deps.greet(work.controller.signal, text => {
        if (this.alive(sessionController) && !work.controller.signal.aborted) this.change({
          padiText: text
        });
      }, () => {
        if (this.alive(sessionController) && !work.controller.signal.aborted) {
          work.played = true;
          this.change({
            phase: 'speaking'
          });
        }
      });
    } catch (error) {
      if (this.alive(sessionController) && !work.controller.signal.aborted) this.change({
        error: error instanceof Error ? error.message : 'PADI’s greeting could not play. You can still talk to me.'
      });
    } finally {
      sessionController.signal.removeEventListener('abort', stop);
      const owned = this.work === work;
      if (owned) this.work = null;
      work.finish();
      if (this.alive(sessionController) && owned) {
        if (!this.draining) this.change({
          phase: this.snapshot.connected ? 'listening' : 'preparing'
        });
        if (this.pending && !this.activity.speaking && !this.draining) void this.respond();
      }
    }
  }

  /** A touch gets a spoken acknowledgement without starting another mic. */
  async reactToTouch() {
    if (!this.alive() || !this.session || this.work || this.activity.speaking || this.draining) return;
    await this.greet(this.controller);
  }
  began(rate, startedAt) {
    this.turnID++;
    this.interrupted = this.snapshot.phase === 'speaking';
    this.verifying?.abort();
    const work = this.work;
    if (work) {
      // Detach ownership before cancelling: late completion must never reset
      // the detector or replace the user's new listening turn.
      this.work = null;
      this.pending = '';
      work.controller.abort();
      if (work.id) this.deps.delivered(work.id, work.spoken, true, work.accountID);
    }
    this.partial = '';
    const input = this.recognition?.begin(rate, words => {
      if (this.input !== input || !this.alive()) return;
      if (!this.partial && words) measureTurn('first-caption', startedAt);
      this.partial = words;
      if (!this.wakeMode || this.wakeActivated) this.change({
        userText: [this.pending, words].filter(Boolean).join(' ')
      });
    });
    this.input = input ?? null;
    this.change({
      phase: 'listening',
      error: null,
      userText: this.pending || undefined,
      padiText: ''
    });
  }
  async transcript(recording, token, session) {
    if (!recording.live && recording.wav) return this.deps.transcribe(token, recording.wav, session.signal);
    const result = await recording.live;
    if (!this.alive(session) || recording.id !== this.turnID) return '';
    // The native live protocol explicitly marks ambiguous short pronouns.
    if (!recording.interrupted && typeof result === 'string' && /^i[.!?…]*$/i.test(result)) return result;
    const check = this.verifying = new AbortController();
    const utterance = recording.wav && {
      pcm: recording.wav.subarray(44),
      sampleRate: new DataView(recording.wav.buffer, recording.wav.byteOffset).getUint32(24, true),
    };
    try {
      return await turnTranscript(Promise.resolve(result?.checkGreeting ? 'i' : result), utterance,
        !!utterance && this.deps.canTranscribe?.() !== false,
        signal => this.deps.transcribe(token, recording.wav, signal), check.signal, recording.interrupted);
    } finally {
      if (this.verifying === check) this.verifying = null;
    }
  }
  async drain() {
    if (this.draining || !this.alive() || !this.session) return;
    const controller = this.controller;
    const session = this.session;
    this.draining = true;
    try {
      while (this.queue.length && this.alive(controller)) {
        const recording = this.queue.shift();
        if (!this.activity.speaking) this.change({
          phase: 'transcribing'
        });
        try {
          const text = await this.transcript(recording, session.token, controller);
          if (!this.alive(controller)) return;
          let recognised = text.trim();
          if (this.wakeMode) {
            const wake = /^(?:hey\s+)?padi\b[\s,.:!?-]*/i;
            if (!this.wakeActivated) {
              if (!wake.test(recognised)) continue;
              recognised = recognised.replace(wake, '').trim();
              this.wakeActivated = true;
            } else if (wake.test(recognised)) {
              recognised = recognised.replace(wake, '').trim();
            }
            if (this.wakeTimer) clearTimeout(this.wakeTimer);
            this.wakeTimer = setTimeout(() => {
              this.wakeActivated = false;
            }, 20_000);
          }
          if (/^(?:please\s+)?stop(?:\s+(?:talking|speaking))?(?:\s+please)?[.!?]*$/i.test(recognised)) {
            this.pending = '';
            this.change({
              userText: recognised,
              error: null
            });
            continue;
          }
          if (/^(?:please\s+)?(?:end(?: (?:the )?(?:call|conversation|voice(?: mode)?))?|hang up|stop listening)(?:\s+please)?[.!?]*$/i.test(recognised)) {
            this.pending = '';
            await this.cancel();
            return;
          }
          if (/^(?:please\s+)?start(?:\s+please)?[.!?]*$/i.test(recognised)) {
            // A one-word acoustic near-neighbour is not permission to start
            // playback. Keep listening; never silently turn Start into Stop.
            this.pending = '';
            this.change({
              userText: recognised,
              phase: 'listening',
              error: 'Please say what you would like to start.'
            });
            continue;
          }
          if (recognised) this.pending = [this.pending, recognised].filter(Boolean).join('\n');
          this.change({
            userText: [this.pending, this.input && this.partial].filter(Boolean).join(' '),
            error: null
          });
        } catch (error) {
          if (this.alive(controller) && error && typeof error === 'object' && 'status' in error && error.status === 401) {
            await this.cancel('Your session expired. Sign in again to continue.', true);
            return;
          }
          if (this.alive(controller)) this.change({
            phase: 'listening',
            error: error instanceof Error ? error.message : 'I didn’t catch that. Please say it again.'
          });
        }
      }
    } finally {
      if (this.alive(controller)) {
        this.draining = false;
        this.scheduleResponse();
      }
    }
  }
  scheduleResponse() {
    if (!this.alive() || this.work || this.draining || this.queue.length || this.activity.speaking) return;
    if (this.pending.trim()) void this.respond();else this.change({
      phase: 'listening'
    });
  }
  async respond() {
    if (!this.alive() || !this.session || this.work || this.draining || this.queue.length || this.activity.speaking || !this.pending.trim()) return;
    const sessionController = this.controller;
    const text = this.pending;
    const lastVoiceAt = this.lastVoiceAt;
    measureTurn('submit', lastVoiceAt);
    const work = this.makeWork(this.session.user.id);
    this.work = work;
    const stop = () => work.controller.abort();
    sessionController.signal.addEventListener('abort', stop, {
      once: true
    });
    let speechRemainder = '';
    let receivedStream = false;
    let speechQueued = false;
    const speaking = () => {
      if (this.alive(sessionController) && !work.controller.signal.aborted && !work.played) {
        work.played = true;
        measureTurn('first-playback', lastVoiceAt);
        this.change({
          phase: 'speaking'
        });
      }
    };
    const completed = spoken => {
      if (work.controller.signal.aborted) return;
      work.spoken = [work.spoken, spoken].filter(Boolean).join(' ');
      if (work.id) this.deps.delivered(work.id, work.spoken, false, work.accountID);
    };
    const stream = this.deps.createSpeech?.(work.controller.signal, speaking, completed);
    const queueSpeech = segment => {
      speechQueued = true;
      if (stream) {
        stream.enqueue(segment);
        return;
      }
      work.speechTask = work.speechTask.then(async () => {
        if (work.controller.signal.aborted) return;
        try {
          await this.deps.speak?.(segment, work.controller.signal, speaking, completed);
        } catch (error) {
          if (!work.controller.signal.aborted) this.change({
            error: error instanceof Error ? error.message : 'PADI could not speak this reply. It is available in text chat.'
          });
        }
      });
    };
    this.change({
      phase: 'thinking'
    });
    try {
      const reply = await this.deps.send(text, this.session.user.id, work.controller.signal, delta => {
        if (work.controller.signal.aborted) return;
        if (!receivedStream) measureTurn('first-reply-text', lastVoiceAt);
        receivedStream = true;
        work.reply = (work.reply ?? '') + delta;
        this.change({
          padiText: work.reply
        });
        speechRemainder += delta;
        // A single network event can contain several passages. Drain all
        // usable text now, without waiting on playback or another delta.
        while (speechRemainder.trim()) {
          const complete = takeReadySpeech(speechRemainder, !speechQueued);
          if (!complete.sentences.length) break;
          speechRemainder = complete.remainder;
          complete.sentences.forEach(queueSpeech);
        }
      }, id => {
        if (this.alive(sessionController) && !work.controller.signal.aborted) work.id = id;
      });
      if (!this.alive(sessionController) || this.work !== work || work.controller.signal.aborted) return;
      if (reply.status === 'sent' && reply.reply) {
        // The exchange is already confirmed in shared chat, even if the user
        // interrupts between the reply arriving and speech starting.
        if (this.pending.startsWith(text)) this.pending = this.pending.slice(text.length).trim();
        work.reply = reply.reply;
        work.id = reply.messageID ?? work.id;
        if (work.id && work.spoken) this.deps.delivered(work.id, work.spoken, false, work.accountID);
        this.change({
          padiText: reply.reply
        });
        if (work.controller.signal.aborted) {
          if (work.id) this.deps.delivered(work.id, '', true, work.accountID);
          return;
        }
        if (!receivedStream) {
          const complete = takeCompletedSentences(reply.reply);
          complete.sentences.forEach(queueSpeech);
          speechRemainder = complete.remainder;
        }
        if (speechRemainder.trim()) queueSpeech(speechRemainder.trim());
        work.speechTask = stream?.finish() ?? work.speechTask;
        await work.speechTask;
      } else if (!work.controller.signal.aborted) {
        if (reply.status === 'unauthorized') {
          await this.cancel('Your session expired. Sign in again.');
          return;
        }
        // Keep the draft so the next utterance can retry it, without repeatedly
        // calling providers while the user is silent.
        throw new Error('PADI could not answer. Your recognised words are still here; please speak again to retry.');
      }
    } catch (error) {
      // A failed stream must also stop any sentence already playing.
      const interrupted = work.controller.signal.aborted;
      work.controller.abort();
      if (this.alive(sessionController) && !interrupted) this.change({
        error: error instanceof Error ? error.message : 'Voice playback failed. The reply is available in chat.'
      });
    } finally {
      if (stream && work.controller.signal.aborted) work.speechTask = stream.finish();
      await work.speechTask.catch(() => undefined);
      sessionController.signal.removeEventListener('abort', stop);
      const owned = this.work === work;
      if (owned) this.work = null;
      work.finish();
      if (this.alive(sessionController) && owned) {
        this.change({
          phase: 'listening'
        });
        // Only drain genuinely newer input. Avoid automatic retries after an
        // AI failure, and preserve drafts when an in-flight send was cancelled.
        if (this.pending && this.pending !== text && !this.activity.speaking && !this.draining) this.scheduleResponse();
      }
    }
  }
  cancel(error = null, clearTranscript = false) {
    this.verifying?.abort();
    this.lastVoiceAt = undefined;
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer);
      this.wakeTimer = null;
    }
    this.wakeMode = false;
    this.wakeActivated = false;
    this.controller?.abort();
    this.work?.controller.abort();
    if (this.work?.id && this.work.reply) this.deps.delivered(this.work.id, this.work.spoken, true, this.work.accountID);
    this.activity.reset();
    this.queue = [];
    this.pending = '';
    this.recognition = null;
    this.input = null;
    this.partial = '';
    this.draining = false;
    this.work = null;
    this.change({
      phase: 'idle',
      connected: false,
      error,
      ...(clearTranscript ? {
        userText: undefined,
        padiText: ''
      } : {})
    });
    if (this.stopping) return this.stopping;
    const capture = this.capture;
    this.stopping = (async () => {
      try {
        await capture?.stop();
      } catch {
        this.change({
          error: 'The microphone could not close cleanly. Close the app before starting again.'
        });
      } finally {
        this.controller = null;
        this.capture = null;
        this.session = null;
        this.stopping = null;
      }
    })();
    return this.stopping;
  }
}

module.exports = { HandsfreeSession };

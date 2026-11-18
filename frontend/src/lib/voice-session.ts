import type { AppSession } from '@/lib/session';

export type VoicePhase = 'idle' | 'preparing' | 'listening' | 'transcribing' | 'thinking' | 'speaking';
export type VoiceSnapshot = { phase: VoicePhase; userText?: string; padiText: string; error: string | null };
type Recording = { start(signal: AbortSignal): Promise<void>; finish(): Promise<FormData>; cancel(): Promise<void> };
type Dependencies = {
  readSession(): Promise<AppSession | null>;
  recording(interrupted: () => void): Recording;
  transcribe(token: string, form: FormData, signal: AbortSignal): Promise<string>;
  send(text: string, accountID: string, signal: AbortSignal): Promise<{ status: string; reply?: string }>;
  speak(text: string, signal: AbortSignal, onStart: () => void): Promise<void>;
  stopSpeech(): Promise<void>;
  changed(snapshot: VoiceSnapshot): void;
};

/** Cancellation fences every async step, including delayed permission and replies. */
export class VoiceSession {
  private active: { controller: AbortController; recording: Recording; session?: AppSession } | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopping: Promise<void> | null = null;
  private snapshot: VoiceSnapshot = { phase: 'idle', padiText: 'Tap the microphone, speak, then tap Stop and send.', error: null };

  constructor(private deps: Dependencies) {}
  private change(update: Partial<VoiceSnapshot>) {
    this.snapshot = { ...this.snapshot, ...update };
    this.deps.changed(this.snapshot);
  }
  private current(turn: NonNullable<VoiceSession['active']>) { return this.active === turn && !turn.controller.signal.aborted; }

  async start(): Promise<void> {
    if (this.active || this.stopping) return;
    const turn = { controller: new AbortController(), recording: this.deps.recording(() => { void this.cancel('The recording was interrupted. Tap the microphone to try again.'); }), session: undefined as AppSession | undefined };
    this.active = turn;
    this.change({ phase: 'preparing', userText: undefined, padiText: '', error: null });
    try {
      turn.session = (await this.deps.readSession()) ?? undefined;
      if (!this.current(turn)) return;
      if (!turn.session) throw new Error('Sign in to start a voice conversation.');
      await this.deps.stopSpeech();
      if (!this.current(turn)) return;
      await turn.recording.start(turn.controller.signal);
      if (!this.current(turn)) return;
      this.change({ phase: 'listening' });
      this.timer = setTimeout(() => { void this.cancel('This turn reached 60 seconds. Please record a shorter message, then tap Stop and send.'); }, 60_000);
    } catch (error) {
      if (this.current(turn)) await this.cancel(error instanceof Error ? error.message : 'The microphone could not start.');
    }
  }

  async stopAndSend(): Promise<void> {
    const turn = this.active;
    if (!turn || this.snapshot.phase !== 'listening' || !turn.session) return;
    clearTimeout(this.timer);
    this.change({ phase: 'transcribing' });
    try {
      const form = await turn.recording.finish();
      if (!this.current(turn)) return;
      const text = await this.deps.transcribe(turn.session.token, form, turn.controller.signal);
      await turn.recording.cancel();
      if (!this.current(turn)) return;
      this.change({ phase: 'thinking', userText: text });
      const result = await this.deps.send(text, turn.session.user.id, turn.controller.signal);
      if (!this.current(turn)) return;
      if (result.status !== 'sent' || !result.reply) throw new Error(result.status === 'unauthorized' ? 'Your session expired. Please sign in again.' : 'PADI could not answer this turn. Please try again; your recognised words remain here.');
      this.change({ padiText: result.reply });
      await this.deps.speak(result.reply, turn.controller.signal, () => { if (this.current(turn)) this.change({ phase: 'speaking' }); });
      if (this.current(turn)) { this.active = null; this.change({ phase: 'idle' }); }
    } catch (error) {
      if (this.current(turn)) await this.cancel(error instanceof Error ? error.message : 'Voice could not complete this turn. Please try again.');
    } finally {
      // Also covers cancellation while finishing or uploading.
      try { await turn.recording.cancel(); } catch { if (this.current(turn)) this.change({ error: 'The temporary recording could not be removed. Please close this screen and try again.' }); }
    }
  }

  cancel(error: string | null = null, clearTranscript = false): Promise<void> {
    clearTimeout(this.timer);
    const turn = this.active;
    turn?.controller.abort();
    this.change({ phase: 'idle', error, ...(clearTranscript ? { userText: undefined, padiText: '' } : {}) });
    if (this.stopping) return this.stopping;
    this.stopping = Promise.allSettled([turn?.recording.cancel(), this.deps.stopSpeech()]).then(results => {
      if (results.some(result => result.status === 'rejected')) this.change({ error: 'Voice cleanup failed. Please close this screen and try again.' });
      if (this.active === turn) this.active = null;
    }).finally(() => { this.stopping = null; });
    return this.stopping;
  }

  async replay(): Promise<void> {
    if (this.active || this.stopping || !this.snapshot.padiText) return;
    const turn = { controller: new AbortController(), recording: this.deps.recording(() => {}) };
    this.active = turn;
    this.change({ error: null });
    try {
      await this.deps.speak(this.snapshot.padiText, turn.controller.signal, () => { if (this.current(turn)) this.change({ phase: 'speaking' }); });
      if (this.current(turn)) { this.active = null; this.change({ phase: 'idle' }); }
    } catch (error) { if (this.current(turn)) await this.cancel(error instanceof Error ? error.message : 'Playback failed.'); }
  }
}

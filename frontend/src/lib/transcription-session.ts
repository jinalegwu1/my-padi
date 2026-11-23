import type { AppSession } from './session';
import type { TranscriptResult } from './api';

export type RecordingMetadata = { mime: string; audioBytes: number; pcmBytes: number; durationMs: number; compressionMs: number };
export type TranscriptionPhase = 'idle' | 'preparing' | 'recording' | 'compressing' | 'uploading' | 'processing';
export type TranscriptionSnapshot = {
  phase: TranscriptionPhase; transcript: TranscriptResult | null; recording: RecordingMetadata | null;
  error: string | null; progress: number; uploadMs: number; totalMs: number;
};
type Recording = { start(signal: AbortSignal): Promise<void>; finish(): Promise<FormData>; cancel(): Promise<void>; readonly metadata?: RecordingMetadata };
type Dependencies = {
  readSession(): Promise<AppSession | null>;
  recording(interrupted: () => void): Recording;
  transcribe(token: string, form: FormData, language: string, signal: AbortSignal, progress: (percent: number, uploaded: boolean) => void): Promise<TranscriptResult>;
  changed(snapshot: TranscriptionSnapshot): void;
};

/** Incoming-only lifecycle. Recognised words are never submitted to chat. */
export class TranscriptionSession {
  private turn: { controller: AbortController; recorder: Recording; session?: AppSession } | null = null;
  private stopping: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private language = 'auto';
  private snapshot: TranscriptionSnapshot = { phase: 'idle', transcript: null, recording: null, error: null, progress: 0, uploadMs: 0, totalMs: 0 };
  constructor(private deps: Dependencies) {}
  private change(value: Partial<TranscriptionSnapshot>) { this.snapshot = { ...this.snapshot, ...value }; this.deps.changed(this.snapshot); }
  private current(turn: NonNullable<TranscriptionSession['turn']>) { return this.turn === turn && !turn.controller.signal.aborted; }

  async start(language = 'auto') {
    if (this.turn || this.stopping) return;
    this.language = language;
    const turn = { controller: new AbortController(), recorder: this.deps.recording(() => { void this.cancel('The microphone or recording was interrupted. Please record again.'); }), session: undefined as AppSession | undefined };
    this.turn = turn;
    this.change({ phase: 'preparing', transcript: null, error: null, recording: null, progress: 0, uploadMs: 0, totalMs: 0 });
    try {
      turn.session = (await this.deps.readSession()) ?? undefined;
      if (!this.current(turn)) return;
      if (!turn.session) throw new Error('Sign in to use voice transcription.');
      await turn.recorder.start(turn.controller.signal);
      if (!this.current(turn)) return;
      this.change({ phase: 'recording' });
      // Leave a little headroom for recorder finalisation under the server's
      // 60-second safety limit, including on slower mobile browsers.
      this.timer = setTimeout(() => { void this.finish(); }, 59_000);
    } catch (error) { if (this.current(turn)) await this.cancel(error instanceof Error ? error.message : 'The microphone could not start.'); }
  }

  async finish() {
    const turn = this.turn;
    if (!turn || !turn.session || this.snapshot.phase !== 'recording') return;
    clearTimeout(this.timer);
    const started = performance.now();
    this.change({ phase: 'compressing' });
    let completed: TranscriptResult | null = null;
    let failure: string | null = null;
    try {
      const form = await turn.recorder.finish();
      if (!this.current(turn)) return;
      this.change({ recording: turn.recorder.metadata ?? null, phase: 'uploading' });
      const uploadStarted = performance.now();
      const result = await this.deps.transcribe(turn.session.token, form, this.language, turn.controller.signal, (percent, uploaded) => {
        if (this.current(turn)) this.change({ progress: percent, ...(uploaded ? { phase: 'processing', uploadMs: performance.now() - uploadStarted } : {}) });
      });
      const session = await this.deps.readSession();
      if (!this.current(turn)) return;
      if (session?.token !== turn.session.token || result.user_id !== turn.session.user.id) {
        failure = 'Your account changed. The earlier transcript was discarded.';
        return;
      }
      completed = result;
    } catch (error) {
      if (this.current(turn)) failure = error instanceof Error ? error.message : 'Speech recognition failed. Please try again.';
    } finally {
      try { await turn.recorder.cancel(); }
      catch { failure = 'The microphone could not close cleanly. Close this screen before recording again.'; }
      if (this.turn === turn) {
        this.turn = null;
        if (!turn.controller.signal.aborted) this.change({ phase: 'idle', transcript: completed, error: failure, totalMs: performance.now() - started });
      }
    }
  }

  cancel(error: string | null = null, clear = false): Promise<void> {
    clearTimeout(this.timer);
    const turn = this.turn;
    turn?.controller.abort();
    this.change({ phase: 'idle', error, ...(clear ? { transcript: null, recording: null, uploadMs: 0, totalMs: 0 } : {}) });
    if (this.stopping) return this.stopping;
    this.stopping = (async () => {
      try { await turn?.recorder.cancel(); }
      catch { this.change({ error: 'The microphone could not close cleanly. Close this screen before recording again.' }); }
      finally { if (this.turn === turn) this.turn = null; this.stopping = null; }
    })();
    return this.stopping;
  }
}

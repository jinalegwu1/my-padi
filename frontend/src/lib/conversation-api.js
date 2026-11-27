/** Existing authenticated HTTP transport is supplied by the app. */
function createConversationAPI(API_URL, APIError, requestJSON) {
  function sendChat(token, messages, memoryRevision = 0, signal, delivery = 'text', voiceContext, languageCode, greeting = false) {
    return requestJSON('/v1/chat', {
      messages,
      memory_revision: memoryRevision,
      delivery,
      voice_context: voiceContext,
      ...(greeting ? {
        greeting: true
      } : {}),
      ...(languageCode && (greeting || delivery === 'voice' && voiceLanguageSupported) ? {
        language: languageCode
      } : {})
    }, {
      token,
      timeoutMs: 155_000,
      signal
    });
  }
  /** @param {(delta: string) => void} onText
   * @returns {Promise<{reply: string, memory_revision: number}>} */
  function streamChat(token, messages, memoryRevision, signal, onText, voiceContext, languageCode = 'en-NG', greeting = false, delivery = 'voice') {
    return new Promise((resolve, reject) => {
      if (!API_URL) {
        reject(new Error('The PADI backend address is not configured in this app build.'));
        return;
      }
      if (signal.aborted) {
        reject(Object.assign(new Error('Cancelled'), {
          name: 'AbortError'
        }));
        return;
      }
      const xhr = new XMLHttpRequest();
      let settled = false;
      let readOffset = 0;
      let buffered = '';
      let eventName = '';
      let eventData = [];
      let reply = '';
      let completed = null;
      const finish = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
        xhr.onload = xhr.onerror = xhr.onabort = xhr.ontimeout = xhr.onprogress = null;
        if (error) reject(error);else if (completed) resolve(completed);else reject(new Error('PADI ended the streamed response before it was complete.'));
      };
      const abort = () => xhr.abort();
      const timeout = setTimeout(() => xhr.abort(), 155_000);
      const failFromBody = (raw, status) => {
        let payload = {};
        try {
          payload = JSON.parse(raw);
        } catch {/* use the standard message */}
        finish(new APIError(typeof payload.message === 'string' ? payload.message : 'PADI could not get a response right now. Please try again.', status, typeof payload.error === 'string' ? payload.error : 'provider_unavailable'));
      };
      const dispatch = () => {
        if (!eventName || eventData.length === 0) {
          eventName = '';
          eventData = [];
          return;
        }
        const name = eventName;
        const raw = eventData.join('\n');
        eventName = '';
        eventData = [];
        let data;
        try {
          data = JSON.parse(raw);
        } catch {
          throw new Error('PADI returned an invalid streamed response.');
        }
        if (!data || typeof data !== 'object') throw new Error('PADI returned an invalid streamed response.');
        const value = data;
        if (name === 'delta') {
          if (typeof value.text !== 'string' || !value.text) throw new Error('PADI returned invalid streamed text.');
          reply += value.text;
          if (reply.length > 200_000) throw new Error('PADI returned an oversized streamed response.');
          onText(value.text);
        } else if (name === 'error') {
          throw new APIError(typeof value.message === 'string' ? value.message : 'PADI could not get a response right now. Please try again.', 502, typeof value.error === 'string' ? value.error : 'provider_unavailable');
        } else if (name === 'done') {
          if (typeof value.reply !== 'string' || value.reply !== reply || !Number.isSafeInteger(value.memory_revision) || Number(value.memory_revision) < 0) {
            throw new Error('PADI returned an invalid completed response.');
          }
          completed = {
            reply: value.reply,
            memory_revision: Number(value.memory_revision)
          };
        } else {
          throw new Error('PADI returned an unsupported streamed event.');
        }
      };
      const consume = chunk => {
        buffered += chunk;
        let newline = buffered.indexOf('\n');
        while (newline >= 0) {
          const line = buffered.slice(0, newline).replace(/\r$/, '');
          buffered = buffered.slice(newline + 1);
          if (!line) dispatch();else if (line.startsWith('event:')) eventName = line.slice(6).trim();else if (line.startsWith('data:')) eventData.push(line.slice(5).trimStart());
          newline = buffered.indexOf('\n');
        }
      };
      const readProgress = () => {
        if (settled) return;
        try {
          const raw = xhr.responseText.slice(readOffset);
          readOffset = xhr.responseText.length;
          consume(raw);
        } catch (error) {
          finish(error instanceof Error ? error : new Error('PADI returned an invalid streamed response.'));
          xhr.abort();
        }
      };
      xhr.open('POST', `${API_URL}/v1/chat`);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.timeout = 155_000;
      xhr.onprogress = readProgress;
      xhr.onerror = () => finish(new Error('The chat connection was interrupted. Please try again.'));
      xhr.ontimeout = () => finish(new Error('PADI took too long to respond. Please try again.'));
      xhr.onabort = () => finish(Object.assign(new Error('Cancelled'), {
        name: 'AbortError'
      }));
      xhr.onload = () => {
        if (settled) return;
        if (xhr.status < 200 || xhr.status >= 300) {
          failFromBody(xhr.responseText, xhr.status);
          return;
        }
        if (!xhr.getResponseHeader('Content-Type')?.toLowerCase().includes('text/event-stream')) {
          finish(new Error('PADI did not return a streamed response.'));
          return;
        }
        try {
          readProgress();
          if (buffered) {
            const line = buffered.replace(/\r$/, '');
            buffered = '';
            if (line.startsWith('data:')) eventData.push(line.slice(5).trimStart());else if (line.startsWith('event:')) eventName = line.slice(6).trim();
          }
          dispatch();
          if (completed && completed.reply.trim()) finish();else finish(new Error('PADI ended the streamed response before it was complete.'));
        } catch (error) {
          finish(error instanceof Error ? error : new Error('PADI returned an invalid streamed response.'));
        }
      };
      signal.addEventListener('abort', abort, {
        once: true
      });
      try {
        xhr.send(JSON.stringify({
          messages,
          memory_revision: memoryRevision,
          delivery,
          stream: true,
          voice_context: voiceContext,
          ...(greeting ? {
            greeting: true
          } : {}),
          ...(languageCode && (greeting || delivery === 'voice' && voiceLanguageSupported) ? {
            language: languageCode
          } : {})
        }));
      } catch (error) {
        finish(error instanceof Error ? error : new Error('The live voice request could not be sent.'));
      }
    });
  }
  const streamVoiceChat = streamChat;
  let liveSpeechSupported = false;
  let voiceLanguageSupported = false;

  /** XHR progress is available in Expo native and web, including while the
   * response is still arriving. Only complete newline-delimited packets play. */
  function streamSpeechAudio(token, text, style, rate, language, signal, onChunk) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('Speech cancelled.'));
        return;
      }
      const xhr = new XMLHttpRequest();
      let offset = 0;
      let done = false;
      let chunks = 0;
      const abort = () => xhr.abort();
      const finish = error => {
        signal.removeEventListener('abort', abort);
        xhr.onload = xhr.onprogress = xhr.onabort = xhr.onerror = xhr.ontimeout = null;
        if (error) reject(error);else resolve();
      };
      const read = () => {
        if (xhr.status !== 200 || signal.aborted) return;
        const raw = xhr.responseText;
        let end = raw.indexOf('\n', offset);
        while (end >= 0) {
          const event = JSON.parse(raw.slice(offset, end));
          offset = end + 1;
          if (done) throw new Error('Unexpected audio after speech ended.');
          if (event.done === true && chunks) done = true;else if (typeof event.audio_base64 === 'string' && event.mime_type === 'audio/wav') {
            chunks++;
            onChunk(event.audio_base64);
          } else throw new Error('Invalid speech audio.');
          end = raw.indexOf('\n', offset);
        }
      };
      xhr.onprogress = () => {
        try {
          read();
        } catch {
          finish(new Error('PADI’s speech was interrupted.'));
          xhr.abort();
        }
      };
      xhr.onload = () => {
        try {
          if (xhr.status !== 200) throw new APIError('PADI’s voice could not play this reply.', xhr.status, 'speech_unavailable');
          read();
          if (!done) throw new Error('PADI’s speech ended early.');
          finish();
        } catch (error) {
          finish(error instanceof Error ? error : new Error('Invalid speech response.'));
        }
      };
      xhr.onabort = () => finish(new Error('Speech cancelled.'));
      xhr.onerror = xhr.ontimeout = () => finish(new Error('Could not receive PADI’s voice.'));
      xhr.open('POST', API_URL + '/v1/voice/speak');
      xhr.timeout = 65000;
      xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      xhr.setRequestHeader('Content-Type', 'application/json');
      signal.addEventListener('abort', abort, {
        once: true
      });
      xhr.send(JSON.stringify({
        text,
        style,
        rate,
        language,
        live: true,
        stream: true
      }));
    });
  }
  async function getVoiceConfiguration(signal) {
    const result = await requestJSON('/v1/voice/config', undefined, {
      method: 'GET',
      signal
    });
    if (typeof result?.enabled !== 'boolean' || result.max_seconds !== 60) throw new Error('PADI returned invalid voice settings.');
    liveSpeechSupported = result.live_speech === true;
    voiceLanguageSupported = result.language_selection === true;
    return result;
  }
  async function synthesiseSpeech(token, text, style, rate, signal, languageCode = 'en-NG', live = false, groqOnly = false) {
    const result = await requestJSON('/v1/voice/speak', {
      text,
      style,
      rate,
      language: languageCode,
      ...(live && liveSpeechSupported ? {
        live: true
      } : {}),
      ...(groqOnly ? {
        groq_only: true
      } : {})
    }, {
      token,
      signal,
      timeoutMs: 65_000
    });
    if (result?.mime_type !== 'audio/wav' || typeof result.audio_base64 !== 'string' || !result.audio_base64 || result.audio_base64.length > 12 * 1024 * 1024) throw new Error('PADI returned invalid speech audio.');
    return result;
  }
  async function fetchVoiceSample(kind, style, languageCode, rate, signal) {
    const language = languageCode === 'pcm-NG' ? 'pcm-NG' : languageCode.toLowerCase().startsWith('fr') ? 'fr' : 'en-NG';
    const pace = rate < 0.95 ? 0.85 : rate > 1.05 ? 1.15 : 1;
    const query = kind === 'welcome' ? `style=${encodeURIComponent(style)}&language=${language}` : kind === 'call' ? `style=${encodeURIComponent(style)}&language=${encodeURIComponent(languageCode)}&rate=${pace}` : `style=${encodeURIComponent(style)}&rate=${pace}${voiceLanguageSupported ? `&language=${encodeURIComponent(languageCode)}` : ''}`;
    const result = await requestJSON(`/v1/voice/${kind}?${query}`, undefined, {
      method: 'GET',
      signal,
      timeoutMs: 65_000
    });
    if (result?.mime_type !== 'audio/wav' || typeof result.audio_base64 !== 'string' || !result.audio_base64 || result.audio_base64.length > 12 * 1024 * 1024) throw new Error('PADI returned invalid natural speech audio.');
    if (kind === 'call' && (typeof result.text !== 'string' || !result.text.trim())) throw new Error('PADI’s live greeting could not load.');
    return result;
  }
  async function transcribeAudio(token, audio, signal, languageCode) {
    const query = voiceLanguageSupported && languageCode ? `?language=${encodeURIComponent(languageCode)}` : '';
    const result = await requestJSON(`/v1/voice/transcribe${query}`, audio, {
      token,
      multipart: true,
      timeoutMs: 200_000,
      signal
    });
    if (typeof result?.text !== 'string' || !result.text.trim()) throw new Error('PADI could not hear clear speech. Please try again.');
    return result.text.trim();
  }

  return { sendChat, streamChat, streamVoiceChat, streamSpeechAudio, getVoiceConfiguration, synthesiseSpeech, fetchVoiceSample, transcribeAudio };
}

module.exports = { createConversationAPI };

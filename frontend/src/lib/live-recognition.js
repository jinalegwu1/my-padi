const { API_URL } = require('@/lib/config');
/** One authenticated socket per open microphone. Audio is sent only during a turn. */
function openLiveRecognition(token, language, signal, disconnected) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Voice session closed.'));
      return;
    }
    const socket = new WebSocket(API_URL.replace(/^http/, 'ws') + '/v1/voice/listen');
    const turns = new Map();
    let ready = false;
    let closed = false;
    let sequence = 0;
    const timeout = setTimeout(() => close('Live captions took too long to connect.'), 8000);
    const abort = () => close('Voice session closed.');
    function close(message) {
      if (closed) return;
      closed = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      const error = new Error(message);
      for (const turn of turns.values()) turn.reject(error);
      turns.clear();
      socket.close();
      if (!ready) reject(error);else if (!signal.aborted) disconnected(message);
    }
    function send(value) {
      if (closed) return;
      if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 256 * 1024) {
        close('Live captions lost their connection. Tap PADI to reconnect.');
        return;
      }
      try {
        socket.send(value);
      } catch {
        close('Live captions lost their connection. Tap PADI to reconnect.');
      }
    }
    const recognition = {
      begin(rate, partial) {
        const turn = ++sequence;
        const final = new Promise((done, fail) => turns.set(turn, {
          partial,
          resolve: done,
          reject: fail
        }));
        void final.catch(() => undefined);
        send(JSON.stringify({
          type: 'start',
          turn,
          rate,
          check_short_words: true
        }));
        return {
          write(pcm) {
            for (let offset = 0; offset < pcm.length; offset += 16000) send(pcm.slice(offset, offset + 16000).buffer);
          },
          finish() {
            send(JSON.stringify({
              type: 'finish',
              turn
            }));
            return final;
          }
        };
      }
    };
    signal.addEventListener('abort', abort, {
      once: true
    });
    socket.onopen = () => send(JSON.stringify({
      token,
      language
    }));
    socket.onerror = socket.onclose = () => close('Live captions disconnected. Tap PADI to reconnect.');
    socket.onmessage = ({
      data
    }) => {
      if (closed) return;
      try {
        const event = JSON.parse(data);
        if (event.type === 'ready' && !ready) {
          clearTimeout(timeout);
          ready = true;
          resolve(recognition);
          return;
        }
        if (event.type === 'error') {
          close(String(event.message));
          return;
        }
        const turn = turns.get(event.turn);
        if (!turn || typeof event.text !== 'string') return;
        if (event.type === 'partial') turn.partial(event.text);
        if (event.type === 'final') {
          turns.delete(event.turn);
          turn.resolve(event.check_greeting === true && event.text === 'i' ? {
            checkGreeting: true
          } : event.text);
        }
      } catch {
        close('PADI received an invalid live caption. Tap to reconnect.');
      }
    };
  });
}

module.exports = { openLiveRecognition };

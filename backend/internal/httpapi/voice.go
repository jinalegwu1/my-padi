package httpapi

import (
	"context"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/jinalegwu1/my-padi/backend/internal/voice"
)

type SpeechTranscriber interface {
	Transcribe(context.Context, []byte) (string, error)
}

func registerVoiceRoutes(mux *http.ServeMux, deps Dependencies) {
	registerSpeechSamples(mux, deps.Synthesis, deps.Logger)
	mux.HandleFunc("/v1/voice/speak", synthesisHandler(deps))
	mux.HandleFunc("/v1/voice/config", func(w http.ResponseWriter, r *http.Request) {
		if !requireMethod(w, r, http.MethodGet) {
			return
		}
		writeJSON(w, http.StatusOK, struct {
			Enabled       bool `json:"enabled"`
			MaxSeconds    int  `json:"max_seconds"`
			NaturalSpeech bool `json:"natural_speech"`
		}{deps.Speech != nil && deps.Auth != nil && deps.Chat != nil, 60, deps.Synthesis != nil})
	})
	mux.HandleFunc("/v1/voice/transcribe", func(w http.ResponseWriter, r *http.Request) {
		if !requireMethod(w, r, http.MethodPost) {
			return
		}
		if deps.Auth == nil {
			writeAPIError(w, http.StatusServiceUnavailable, "auth_unavailable", "Authentication is not configured.")
			return
		}
		token, ok := bearerToken(r)
		if !ok {
			writeAPIError(w, http.StatusUnauthorized, "unauthenticated", "Sign in to use voice.")
			return
		}
		if _, err := deps.Auth.Authenticate(r.Context(), token); err != nil {
			writeAuthError(w, err, deps.Logger)
			return
		}
		if deps.Speech == nil {
			writeAPIError(w, http.StatusServiceUnavailable, "voice_unavailable", "Voice transcription is not configured yet.")
			return
		}
		// Short recordings still need time to upload on slower mobile networks.
		// This extends the read deadline only for authenticated voice uploads.
		_ = http.NewResponseController(w).SetReadDeadline(time.Now().Add(60 * time.Second))
		r.Body = http.MaxBytesReader(w, r.Body, voice.MaxAudioBytes+4096)
		reader, err := r.MultipartReader()
		if err != nil {
			writeAPIError(w, http.StatusBadRequest, "invalid_audio", "Send a WAV, M4A, or WebM recording.")
			return
		}
		// Stream the multipart into bounded memory. Never create server audio files.
		var audio []byte
		for {
			part, err := reader.NextPart()
			if errors.Is(err, io.EOF) {
				break
			}
			if err != nil {
				writeUploadError(w, err)
				return
			}
			if part.FormName() != "audio" || audio != nil {
				writeUploadError(w, voice.ErrInvalidAudio)
				return
			}
			audio, err = io.ReadAll(io.LimitReader(part, voice.MaxAudioBytes+1))
			if err != nil {
				writeUploadError(w, err)
				return
			}
			if len(audio) > voice.MaxAudioBytes {
				writeAPIError(w, http.StatusRequestEntityTooLarge, "audio_too_large", "Record a shorter voice message (up to 8 MB).")
				return
			}
		}
		if _, err := voice.AudioFilename(audio); err != nil {
			writeUploadError(w, err)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 50*time.Second)
		defer cancel()
		text, err := deps.Speech.Transcribe(ctx, audio)
		if err != nil {
			switch {
			case errors.Is(err, voice.ErrNoSpeech):
				writeAPIError(w, http.StatusUnprocessableEntity, "no_speech", "I could not hear clear speech. Please try again in a quieter place.")
			case errors.Is(err, voice.ErrInvalidAudio):
				writeUploadError(w, err)
			case errors.Is(err, voice.ErrBusy):
				writeAPIError(w, http.StatusTooManyRequests, "voice_busy", "Voice is busy. Please try again shortly.")
			default:
				status, code, _ := classifyChatError(err)
				writeAPIError(w, status, code, "PADI could not transcribe your recording right now. Please try again.")
			}
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"text": text})
	})
}

func writeUploadError(w http.ResponseWriter, err error) {
	var maxBytes *http.MaxBytesError
	if errors.As(err, &maxBytes) {
		writeAPIError(w, http.StatusRequestEntityTooLarge, "audio_too_large", "Record a shorter voice message (up to 8 MB).")
		return
	}
	writeAPIError(w, http.StatusBadRequest, "invalid_audio", "Send one WAV, M4A, or WebM recording of up to 60 seconds.")
}

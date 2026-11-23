package httpapi

import (
	"context"
	"errors"
	"io"
	"mime"
	"net/http"
	"time"

	"github.com/jinalegwu1/my-padi/backend/internal/voice"
)

type SpeechTranscriber interface {
	Transcribe(context.Context, []byte) (string, error)
}

type LanguageSpeechTranscriber interface {
	TranscribeLanguage(context.Context, []byte, string) (string, error)
}

type DetailedSpeechTranscriber interface {
	TranscribeAudio(context.Context, voice.Input) (voice.Transcript, error)
}

func registerVoiceRoutes(mux *http.ServeMux, deps Dependencies) {
	uploads := make(chan struct{}, 4)
	registerSpeechSamples(mux, deps.Synthesis, deps.Logger)
	mux.HandleFunc("/v1/voice/speak", synthesisHandler(deps))
	mux.HandleFunc("/v1/voice/config", func(w http.ResponseWriter, r *http.Request) {
		if !requireMethod(w, r, http.MethodGet) {
			return
		}
		_, liveSpeech := deps.Synthesis.(LiveSpeechSynthesiser)
		_, localSpeech := deps.Speech.(DetailedSpeechTranscriber)
		state := voice.Readiness{Ready: deps.Speech != nil}
		if service, ok := deps.Speech.(interface {
			Ready(context.Context) voice.Readiness
		}); ok {
			ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
			state = service.Ready(ctx)
			cancel()
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"enabled": deps.Speech != nil && deps.Auth != nil, "max_seconds": 60,
			"natural_speech": deps.Synthesis != nil, "live_speech": liveSpeech, "language_selection": true,
			"local_transcription": localSpeech, "transcription_ready": state.Ready,
			"transcription_error": state.Error, "transcription_model": state.Model,
			"accepted_audio_formats": []string{"audio/webm;codecs=opus", "audio/mp4", "audio/wav"},
		})
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
		user, err := deps.Auth.Authenticate(r.Context(), token)
		if err != nil {
			writeAuthError(w, err, deps.Logger)
			return
		}
		if deps.Speech == nil {
			writeAPIError(w, http.StatusServiceUnavailable, "voice_unavailable", "Voice transcription is not configured yet.")
			return
		}
		language := r.URL.Query().Get("language")
		if language == "" {
			language = "en-NG"
		}
		for name, values := range r.URL.Query() {
			if name != "language" || len(values) != 1 {
				writeAPIError(w, 400, "invalid_request", "Choose one supported speech language.")
				return
			}
		}
		if !voice.ValidLanguage(language) {
			writeAPIError(w, 400, "invalid_request", "Choose a supported speech language.")
			return
		}
		select {
		case uploads <- struct{}{}:
			defer func() { <-uploads }()
		default:
			writeAPIError(w, 429, "transcription_busy", "Speech processing is busy. Try again shortly.")
			return
		}
		media, _, typeErr := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if typeErr != nil || media != "multipart/form-data" {
			writeAPIError(w, 415, "unsupported_audio_format", "Upload one supported audio recording.")
			return
		}
		_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(200 * time.Second))
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
		var audioType string
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
			audioType = part.Header.Get("Content-Type")
			partMedia, _, partErr := mime.ParseMediaType(audioType)
			if partErr != nil || (partMedia != "audio/webm" && partMedia != "audio/mp4" && partMedia != "audio/x-m4a" && partMedia != "audio/wav" && partMedia != "audio/x-wav") {
				writeAPIError(w, 415, "unsupported_audio_format", "Use WebM/Opus or M4A/AAC audio.")
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
		audioType, err = voice.ValidateContentType(audio, audioType)
		if err != nil {
			writeVoiceError(w, err)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 130*time.Second)
		defer cancel()
		id, err := voice.NewRequestID()
		if err != nil {
			writeAPIError(w, 500, "transcription_failed", "Speech processing could not start.")
			return
		}
		result := voice.Transcript{UserID: user.ID, RequestID: id}
		if service, ok := deps.Speech.(DetailedSpeechTranscriber); ok {
			result, err = service.TranscribeAudio(ctx, voice.Input{Audio: audio, MIME: audioType, UserID: user.ID, RequestID: id, Language: language})
		} else if service, ok := deps.Speech.(LanguageSpeechTranscriber); ok {
			result.Text, err = service.TranscribeLanguage(ctx, audio, language)
		} else {
			result.Text, err = deps.Speech.Transcribe(ctx, audio)
		}
		if err != nil {
			writeVoiceError(w, err)
			return
		}
		if result.UserID != user.ID || result.RequestID != id {
			writeVoiceError(w, &voice.SpeechFailure{Status: 502, Code: "invalid_transcription"})
			return
		}
		if ctx.Err() != nil {
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
}

func writeUploadError(w http.ResponseWriter, err error) {
	var maxBytes *http.MaxBytesError
	if errors.As(err, &maxBytes) {
		writeAPIError(w, http.StatusRequestEntityTooLarge, "audio_too_large", "Record a shorter voice message (up to 8 MB).")
		return
	}
	writeAPIError(w, http.StatusBadRequest, "invalid_audio", "Send one WebM/Opus, M4A/AAC or PCM WAV recording of up to 60 seconds.")
}

func writeVoiceError(w http.ResponseWriter, err error) {
	var failure *voice.SpeechFailure
	status, code, message := 502, "transcription_failed", "PADI could not recognise this recording. Please try again."
	switch {
	case errors.Is(err, context.Canceled):
		return
	case errors.Is(err, voice.ErrNoSpeech):
		status, code, message = 422, "no_speech", "No clear speech was detected. Speak closer to the microphone and try again."
	case errors.Is(err, voice.ErrInvalidAudio):
		status, code, message = 400, "invalid_audio", "The recording is malformed or unsupported."
	case errors.Is(err, voice.ErrBusy):
		status, code, message = 429, "transcription_busy", "Speech processing is busy. Try again shortly."
	case errors.Is(err, context.DeadlineExceeded):
		status, code, message = 504, "transcription_timeout", "Speech processing took too long. Try a shorter recording."
	case errors.As(err, &failure):
		status, code = failure.Status, failure.Code
		switch code {
		case "no_speech":
			message = "No clear speech was detected. Please try again."
		case "audio_too_long":
			message = "Keep recordings under 60 seconds."
		case "audio_too_large":
			message = "The recording exceeds the 8 MB upload limit."
		case "unsupported_audio_format", "unsupported_audio_codec":
			message = "This audio format is unsupported. Use WebM/Opus or M4A/AAC."
		case "invalid_audio", "empty_audio":
			message = "The recording is empty or damaged. Please record again."
		case "transcription_busy":
			message = "Speech processing is busy. Try again shortly."
		case "model_not_installed", "model_load_failed", "model_loading", "model_unavailable", "speech_service_unavailable":
			status = 503
			message = "Local speech recognition is not ready. Please try again later."
		case "transcription_timeout", "upload_timeout":
			message = "Speech processing took too long. Try a shorter recording."
		case "unsupported_language":
			message = "The local speech model does not support the selected language. Try automatic detection."
		case "cancelled":
			status, message = 499, "The recording was cancelled. Please record again."
		}
	}
	writeAPIError(w, status, code, message)
}

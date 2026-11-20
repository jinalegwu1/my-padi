package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/jinalegwu1/my-padi/backend/internal/voice"
)

// Bump when speech delivery or style mappings change. Model, original voice,
// phrase, language, and rate are included separately in each file's key.
const publicSpeechCacheVersion = "padi-expressive-speech-2"

type speechFileCache struct {
	directory, model, originalVoice string
}

type storedPublicSpeech struct {
	Text  string      `json:"text"`
	Audio voice.Audio `json:"audio"`
}

func newSpeechFileCache() *speechFileCache {
	directory := os.Getenv("PADI_VOICE_SAMPLE_CACHE_DIR")
	if directory == "" {
		return nil
	}
	return &speechFileCache{directory, os.Getenv("PADI_VOICE_MODEL"), os.Getenv("PADI_VOICE_DEFAULT_ID")}
}

func (cache *speechFileCache) filename(key, text string) string {
	digest := sha256.Sum256([]byte(strings.Join([]string{publicSpeechCacheVersion, cache.model, cache.originalVoice, key, text}, "\n")))
	return filepath.Join(cache.directory, hex.EncodeToString(digest[:])+".json")
}

func (cache *speechFileCache) load(key, text string) (voice.Audio, bool) {
	if cache == nil {
		return voice.Audio{}, false
	}
	file, err := os.Open(cache.filename(key, text))
	if err != nil {
		return voice.Audio{}, false
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, 12*1024*1024+1))
	var stored storedPublicSpeech
	if err != nil || len(data) > 12*1024*1024 || json.Unmarshal(data, &stored) != nil || stored.Text != text || !voice.ValidSpeechAudio(stored.Audio) {
		return voice.Audio{}, false
	}
	return stored.Audio, true
}

func (cache *speechFileCache) save(key, text string, audio voice.Audio) error {
	if cache == nil || !voice.ValidSpeechAudio(audio) {
		return nil
	}
	data, err := json.Marshal(storedPublicSpeech{Text: text, Audio: audio})
	if err != nil {
		return err
	}
	if err := os.MkdirAll(cache.directory, 0700); err != nil {
		return err
	}
	file, err := os.CreateTemp(cache.directory, ".speech-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err := file.Write(data); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), cache.filename(key, text))
}

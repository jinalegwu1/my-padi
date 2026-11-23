package voice

import (
	"context"
	"encoding/binary"
	"errors"
	"testing"
)

func TestSilentPCMNeverCallsSpeechProvider(t *testing.T) {
	data := make([]byte, 44+32000)
	copy(data, "RIFF")
	binary.LittleEndian.PutUint32(data[4:], uint32(len(data)-8))
	copy(data[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(data[16:], 16)
	binary.LittleEndian.PutUint16(data[20:], 1)
	binary.LittleEndian.PutUint16(data[22:], 1)
	binary.LittleEndian.PutUint32(data[24:], 16000)
	binary.LittleEndian.PutUint32(data[28:], 32000)
	binary.LittleEndian.PutUint16(data[32:], 2)
	binary.LittleEndian.PutUint16(data[34:], 16)
	copy(data[36:], "data")
	binary.LittleEndian.PutUint32(data[40:], 32000)
	limiter := &testLimiter{}
	service := &Transcriber{}
	if _, err := service.Transcribe(context.Background(), data); !errors.Is(err, ErrNoSpeech) || limiter.calls != 0 {
		t.Fatal("silence reached provider or usage reservation")
	}
	data[50] = 1
	if silentPCM(data) {
		t.Fatal("non-silent data marked as digital silence")
	}
	for _, malformed := range [][]byte{data[:12], []byte("RIFF0000WAVEfmt 1234"), append([]byte(nil), data[:43]...)} {
		if silentPCM(malformed) {
			t.Fatal("invalid data marked silent")
		}
	}
}

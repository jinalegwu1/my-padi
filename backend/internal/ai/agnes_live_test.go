package ai

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Explicit opt-in: real default-key Agnes generation, local recognition and
// local audio. All input is synthetic and no application account is created.
func TestLiveAgnesWhisperAndLocalPythonSpeech(t *testing.T) {
	if os.Getenv("PADI_RUN_AGNES_VOICE_CHECK") != "true" {
		t.Skip("explicit live Agnes/local voice verification disabled")
	}
	voiceDir, err := filepath.Abs(filepath.Join("..", "..", "..", "services", "voice"))
	if err != nil {
		t.Fatal(err)
	}
	python := filepath.Join(voiceDir, ".venv", "bin", "python")
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	const recognition = `import sys,os,tempfile,json
sys.path.insert(0,sys.argv[1]);os.environ['HF_HUB_OFFLINE']='1'
import app
from local_recognition import RecognitionConfig,load_model,recognise_file
raw=app.local_engine().speak('I bought a new phone today.','ada',1,'en-NG')
with tempfile.NamedTemporaryFile(suffix='.wav') as audio:
 audio.write(raw);audio.flush()
 cfg=RecognitionConfig(model_path=os.path.join(sys.argv[1],'models','base'))
 model=load_model(cfg);result=recognise_file(model,cfg,audio.name,'audio/wav','en')
 print(json.dumps({'text':result['text'],'model':cfg.model}))`
	command := exec.CommandContext(ctx, python, "-I", "-B", "-c", recognition, voiceDir)
	command.Env = []string{"PATH=" + os.Getenv("PATH"), "HF_HUB_OFFLINE=1"}
	output, err := command.Output()
	if err != nil {
		t.Fatalf("local speech/Whisper stage failed: %v", err)
	}
	var transcript struct{ Text, Model string }
	if json.Unmarshal(output, &transcript) != nil || !strings.Contains(strings.ToLower(transcript.Text), "phone") {
		t.Fatalf("synthetic speech not transcribed correctly: %s", output)
	}
	cfg, err := LoadEnvironment()
	if err != nil {
		t.Fatal(err)
	}
	router, err := NewRouterFromEnvironment(cfg, nil, newMemoryUsageLimiter())
	if err != nil {
		t.Fatal(err)
	}
	var deltas strings.Builder
	response, err := router.StreamVoice(ctx, Request{Messages: []Message{{Role: RoleUser, Content: transcript.Text}}, Task: TaskConversation}, func(delta string) error { deltas.WriteString(delta); return nil })
	if err != nil {
		t.Fatalf("Agnes streaming failed: %v", err)
	}
	if response.Provider != ProviderAgnes || response.Content != deltas.String() {
		t.Fatal("the requested Agnes provider did not complete the reply")
	}
	const speech = `import sys,json,base64,wave,io
sys.path.insert(0,sys.argv[1]);import app
result=app.synthesise_local(sys.argv[2],'baby',1,'en-NG')
raw=base64.b64decode(result['audio_base64'])
with wave.open(io.BytesIO(raw)) as audio:print(json.dumps({'bytes':len(raw),'rate':audio.getframerate(),'channels':audio.getnchannels(),'frames':audio.getnframes()}))`
	command = exec.CommandContext(ctx, python, "-I", "-B", "-c", speech, voiceDir, response.Content)
	command.Env = []string{"PATH=" + os.Getenv("PATH")}
	output, err = command.Output()
	if err != nil {
		t.Fatalf("local reply audio failed: %v", err)
	}
	var audio struct{ Bytes, Rate, Channels, Frames int }
	if json.Unmarshal(output, &audio) != nil || audio.Rate != 24000 || audio.Channels != 1 || audio.Frames == 0 {
		t.Fatal("reply audio is not valid canonical speech")
	}
	t.Logf("Whisper %s transcribed: %q", transcript.Model, transcript.Text)
	t.Logf("Agnes %s completed reply: %s", response.Model, response.Content)
	t.Logf("Local Python engine generated %d audio bytes at %d Hz", audio.Bytes, audio.Rate)
}

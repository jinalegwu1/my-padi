package personality

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const pythonConfigExport = `import json, sys
sys.path.insert(0, sys.argv[1])
from padi_personality.core import export_personality
print(json.dumps(export_personality()))
`

var configuredCoreSettings = sync.OnceValues(loadCoreSettings)

// LoadCoreSettings imports PADI's Python configuration once per process.
// Configuration errors are returned rather than replaced with Go defaults.
func LoadCoreSettings() (CoreSettings, error) {
	return configuredCoreSettings()
}

func loadCoreSettings() (CoreSettings, error) {
	root, err := personalityRoot()
	if err != nil {
		return CoreSettings{}, err
	}
	python, err := personalityPython()
	if err != nil {
		return CoreSettings{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return loadPythonCoreSettings(ctx, python, root)
}

func personalityPython() (string, error) {
	if configured := strings.TrimSpace(os.Getenv("PADI_PERSONALITY_PYTHON")); configured != "" {
		return configured, nil
	}
	for _, name := range []string{"python3", "python"} {
		if path, err := exec.LookPath(name); err == nil {
			return path, nil
		}
	}
	return "", errors.New("Python 3 is required for PADI personality configuration; set PADI_PERSONALITY_PYTHON")
}

func personalityRoot() (string, error) {
	if configured := strings.TrimSpace(os.Getenv("PADI_PERSONALITY_ROOT")); configured != "" {
		return filepath.Abs(configured)
	}
	directory, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("locate PADI personality configuration: %w", err)
	}
	for {
		root := filepath.Join(directory, "services")
		info, err := os.Stat(filepath.Join(root, "padi_personality", "core.py"))
		if err == nil && info.Mode().IsRegular() {
			return root, nil
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			return "", errors.New("PADI Python personality package not found; set PADI_PERSONALITY_ROOT to its parent directory")
		}
		directory = parent
	}
}

func loadPythonCoreSettings(ctx context.Context, python, root string) (CoreSettings, error) {
	// Isolated mode ignores ambient Python imports; -B avoids bytecode writes.
	command := exec.CommandContext(ctx, python, "-I", "-B", "-c", pythonConfigExport, root)
	output, err := command.Output()
	if err != nil {
		if ctx.Err() != nil {
			err = ctx.Err()
		}
		return CoreSettings{}, fmt.Errorf("execute Python personality configuration: %w", err)
	}
	return decodeCoreSettings(output)
}

func decodeCoreSettings(output []byte) (CoreSettings, error) {
	exported, err := decodeExportObject(output)
	if err != nil {
		return CoreSettings{}, fmt.Errorf("decode Python personality export: %w", err)
	}
	if len(exported) != 2 || exported["traits"] == nil || exported["warmth_guidance"] == nil {
		return CoreSettings{}, errors.New("Python personality export requires exactly traits and warmth_guidance")
	}
	values, err := decodeExportObject(exported["traits"])
	if err != nil {
		return CoreSettings{}, fmt.Errorf("decode Python personality traits: %w", err)
	}
	traits := []string{"warm", "funny", "witty", "intelligent", "playful", "emotionally_aware"}
	if len(values) != len(traits) {
		return CoreSettings{}, errors.New("Python personality configuration must contain exactly the six core traits")
	}
	booleans := make(map[string]bool, len(traits))
	for _, trait := range traits {
		var value *bool
		if err := json.Unmarshal(values[trait], &value); err != nil || value == nil {
			return CoreSettings{}, fmt.Errorf("Python personality configuration requires boolean %q", trait)
		}
		booleans[trait] = *value
	}
	var guidance *string
	if err := json.Unmarshal(exported["warmth_guidance"], &guidance); err != nil || guidance == nil {
		return CoreSettings{}, errors.New("Python personality export requires string warmth_guidance")
	}
	if booleans["warm"] && strings.TrimSpace(*guidance) == "" {
		return CoreSettings{}, errors.New("Python personality export with warmth enabled requires non-empty warmth_guidance")
	}
	if !booleans["warm"] && *guidance != "" {
		return CoreSettings{}, errors.New("Python personality export with warmth disabled requires empty warmth_guidance")
	}
	return CoreSettings{
		Warm: booleans["warm"], Funny: booleans["funny"], Witty: booleans["witty"],
		Intelligent: booleans["intelligent"], Playful: booleans["playful"],
		EmotionallyAware: booleans["emotionally_aware"], WarmthGuidance: *guidance,
	}, nil
}

// Reject ambiguous duplicate keys as well as non-object and trailing output.
func decodeExportObject(data []byte) (map[string]json.RawMessage, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	start, err := decoder.Token()
	if err != nil {
		return nil, err
	}
	if start != json.Delim('{') {
		return nil, errors.New("expected a JSON object")
	}
	values := make(map[string]json.RawMessage)
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return nil, err
		}
		key, ok := token.(string)
		if !ok {
			return nil, errors.New("expected a JSON object key")
		}
		if _, exists := values[key]; exists {
			return nil, fmt.Errorf("duplicate JSON key %q", key)
		}
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return nil, err
		}
		values[key] = value
	}
	if _, err := decoder.Token(); err != nil {
		return nil, err
	}
	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); err != io.EOF {
		return nil, errors.New("unexpected trailing output after JSON object")
	}
	return values, nil
}

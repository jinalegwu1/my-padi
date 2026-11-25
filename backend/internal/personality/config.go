package personality

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const pythonConfigExport = `import json, sys
sys.path.insert(0, sys.argv[1])
from padi_personality.core import PADI_PERSONALITY_CONFIG
print(json.dumps(PADI_PERSONALITY_CONFIG.to_dict()))
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
	var values map[string]*bool
	if err := json.Unmarshal(output, &values); err != nil {
		return CoreSettings{}, fmt.Errorf("decode Python personality configuration: %w", err)
	}
	traits := []string{"warm", "funny", "witty", "intelligent", "playful", "emotionally_aware"}
	if len(values) != len(traits) {
		return CoreSettings{}, errors.New("Python personality configuration must contain exactly the six core traits")
	}
	for _, trait := range traits {
		if values[trait] == nil {
			return CoreSettings{}, fmt.Errorf("Python personality configuration requires boolean %q", trait)
		}
	}
	return CoreSettings{
		Warm: *values["warm"], Funny: *values["funny"], Witty: *values["witty"],
		Intelligent: *values["intelligent"], Playful: *values["playful"],
		EmotionallyAware: *values["emotionally_aware"],
	}, nil
}

package verification

import (
	"bufio"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
)

var environmentName = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// LoadEnvFile reads configuration as data. It never evaluates shell expressions,
// prints values, or overwrites variables already set by the operator.
func LoadEnvFile(path string) error {
	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open configuration file: %w", err)
	}
	defer file.Close()
	values := make(map[string]string)
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 4096), 128*1024)
	lineNumber := 0
	for scanner.Scan() {
		lineNumber++
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		name, raw, found := strings.Cut(line, "=")
		name = strings.TrimSpace(name)
		if !found || !environmentName.MatchString(name) {
			return fmt.Errorf("invalid configuration assignment on line %d", lineNumber)
		}
		value, err := parseEnvironmentValue(strings.TrimSpace(raw))
		if err != nil {
			return fmt.Errorf("invalid configuration value on line %d", lineNumber)
		}
		values[name] = value
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("read configuration file: %w", err)
	}
	for name, value := range values {
		if _, exists := os.LookupEnv(name); !exists {
			if err := os.Setenv(name, value); err != nil {
				return fmt.Errorf("set configuration variable %s", name)
			}
		}
	}
	return nil
}

func parseEnvironmentValue(raw string) (string, error) {
	if raw == "" {
		return "", nil
	}
	if raw[0] != '\'' && raw[0] != '"' {
		value, _, _ := strings.Cut(raw, " #")
		return strings.TrimSpace(value), nil
	}
	quote := raw[0]
	for i := 1; i < len(raw); i++ {
		if quote == '"' && raw[i] == '\\' {
			i++
			continue
		}
		if raw[i] != quote {
			continue
		}
		tail := strings.TrimSpace(raw[i+1:])
		if tail != "" && !strings.HasPrefix(tail, "#") {
			return "", fmt.Errorf("unexpected text after quoted value")
		}
		if quote == '\'' {
			return raw[1:i], nil
		}
		return strconv.Unquote(raw[:i+1])
	}
	return "", fmt.Errorf("unterminated quoted value")
}

package verification

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadEnvFileKeepsSecretsLiteralAndPreservesEnvironment(t *testing.T) {
	const valueName = "PADI_VERIFY_TEST_LITERAL"
	const existingName = "PADI_VERIFY_TEST_EXISTING"
	os.Unsetenv(valueName)
	t.Cleanup(func() { os.Unsetenv(valueName) })
	t.Setenv(existingName, "existing-value")
	path := filepath.Join(t.TempDir(), ".env")
	content := "# comment\n" + valueName + "='synthetic # $(shell) `command` $VARIABLE'\n" + existingName + "=replacement\n"
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	if err := LoadEnvFile(path); err != nil {
		t.Fatal(err)
	}
	if got := os.Getenv(valueName); got != "synthetic # $(shell) `command` $VARIABLE" {
		t.Errorf("literal configuration value changed: %q", got)
	}
	if got := os.Getenv(existingName); got != "existing-value" {
		t.Errorf("existing environment overwritten: %q", got)
	}
}

func TestInvalidEnvFileDoesNotExposeValuesOrPartiallyApply(t *testing.T) {
	const name = "PADI_VERIFY_TEST_PARTIAL"
	os.Unsetenv(name)
	t.Cleanup(func() { os.Unsetenv(name) })
	path := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(path, []byte(name+"=valid\nBROKEN='synthetic-secret\n"), 0600); err != nil {
		t.Fatal(err)
	}
	err := LoadEnvFile(path)
	if err == nil || strings.Contains(err.Error(), "synthetic-secret") {
		t.Fatalf("unsafe configuration error: %v", err)
	}
	if _, exists := os.LookupEnv(name); exists {
		t.Fatal("invalid file partially applied its configuration")
	}
}

func TestEnvironmentValuesKeepJSONAndQuotedComments(t *testing.T) {
	cases := []struct{ input, want string }{
		{`'[{"id":"main","model":"model-id"}]'`, `[{"id":"main","model":"model-id"}]`},
		{`"value # inside" # outside`, "value # inside"},
		{`unquoted # comment`, "unquoted"},
		{`''`, ""},
	}
	for _, current := range cases {
		got, err := parseEnvironmentValue(current.input)
		if err != nil || got != current.want {
			t.Errorf("parse value = %q, %v; want %q", got, err, current.want)
		}
	}
	if _, err := parseEnvironmentValue(`'value'; run-command`); err == nil {
		t.Fatal("accepted extra commands after quoted value")
	}
}

package config

import "testing"

func TestLoad(t *testing.T) {
	tests := []struct {
		name    string
		address string
		want    string
	}{
		{name: "default address", address: "", want: ":8080"},
		{name: "configured address", address: "127.0.0.1:9090", want: "127.0.0.1:9090"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("PADI_HTTP_ADDR", test.address)

			if got := Load().HTTPAddr; got != test.want {
				t.Errorf("HTTPAddr = %q, want %q", got, test.want)
			}
		})
	}
}

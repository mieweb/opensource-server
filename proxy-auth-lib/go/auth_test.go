package trustedproxyauth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func loadFixtures(t *testing.T) (map[string]string, []byte) {
	t.Helper()
	root := filepath.Join("..", "testdata")
	tokensData, err := os.ReadFile(filepath.Join(root, "tokens.json"))
	if err != nil {
		t.Fatal(err)
	}
	jwksData, err := os.ReadFile(filepath.Join(root, "jwks.json"))
	if err != nil {
		t.Fatal(err)
	}
	var tokens map[string]string
	if err := json.Unmarshal(tokensData, &tokens); err != nil {
		t.Fatal(err)
	}
	return tokens, jwksData
}

func newAuthenticator(t *testing.T) (*Authenticator, map[string]string, func()) {
	t.Helper()
	tokens, jwksData := loadFixtures(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/jwks.json" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(jwksData)
	}))
	auth, err := New(Config{
		Header:   "X-Trusted-Proxy-Assertion",
		JWKSURL:  server.URL + "/jwks.json",
		Issuer:   "https://issuer.example.test",
		Audience: "my-service",
	})
	if err != nil {
		t.Fatal(err)
	}
	return auth, tokens, server.Close
}

func TestVerifyCoversFixtureCases(t *testing.T) {
	auth, tokens, closeServer := newAuthenticator(t)
	defer closeServer()

	identity, err := auth.Verify(context.Background(), tokens["valid"])
	if err != nil {
		t.Fatalf("verify valid token: %v", err)
	}
	if identity.Subject != "user-123" {
		t.Fatalf("got subject %q", identity.Subject)
	}

	for _, name := range []string{"expired", "invalid_signature", "wrong_issuer", "wrong_audience", "malformed"} {
		t.Run(name, func(t *testing.T) {
			if _, err := auth.Verify(context.Background(), tokens[name]); err == nil {
				t.Fatalf("expected %s to fail", name)
			}
		})
	}
}

func TestMiddlewareRejectsMissingAndAcceptsValidAssertions(t *testing.T) {
	auth, tokens, closeServer := newAuthenticator(t)
	defer closeServer()

	handler := auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		identity, ok := IdentityFromContext(r.Context())
		if !ok {
			t.Fatal("missing identity in request context")
		}
		_, _ = w.Write([]byte("ok:" + identity.Subject))
	}))

	validRequest := httptest.NewRequest(http.MethodGet, "/", nil)
	validRequest.Header.Set("X-Trusted-Proxy-Assertion", tokens["valid"])
	validRecorder := httptest.NewRecorder()
	handler.ServeHTTP(validRecorder, validRequest)
	if validRecorder.Code != http.StatusOK {
		t.Fatalf("got status %d", validRecorder.Code)
	}
	if body := validRecorder.Body.String(); body != "ok:user-123" {
		t.Fatalf("got body %q", body)
	}

	for _, name := range []string{"missing", "expired", "invalid_signature", "wrong_issuer", "wrong_audience", "malformed"} {
		t.Run(name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/", nil)
			if name != "missing" {
				request.Header.Set("X-Trusted-Proxy-Assertion", tokens[name])
			}
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, request)
			if recorder.Code != http.StatusUnauthorized {
				t.Fatalf("got status %d", recorder.Code)
			}
		})
	}
}

func TestConfigFromEnvUsesSharedNames(t *testing.T) {
	config := ConfigFromEnv(func(key string) string {
		values := map[string]string{
			"TRUSTED_PROXY_ASSERTION_HEADER": "X-Test",
			"TRUSTED_PROXY_JWKS_URL":         "https://issuer.example.test/jwks.json",
			"TRUSTED_PROXY_ISSUER":           "https://issuer.example.test",
			"TRUSTED_PROXY_AUDIENCE":         "my-service",
		}
		return values[key]
	})
	if config.Header != "X-Test" || config.Audience != "my-service" {
		t.Fatalf("unexpected config: %+v", config)
	}
}

func TestDeriveAuthDomainFromHostFQDN(t *testing.T) {
	if got := deriveAuthDomain("web1.os.example.org"); got != "auth.os.example.org" {
		t.Fatalf("got %q", got)
	}
	if got := deriveAuthDomain("host"); got != "auth.host" {
		t.Fatalf("got %q", got)
	}
}

func TestConfigFromEnvAuthDomainOverride(t *testing.T) {
	config := ConfigFromEnv(func(key string) string {
		if key == "TRUSTED_PROXY_AUTH_DOMAIN" {
			return "auth.example.test"
		}
		return ""
	})
	if config.Issuer != "https://auth.example.test" {
		t.Fatalf("got issuer %q", config.Issuer)
	}
	if config.JWKSURL != "https://auth.example.test/.well-known/jwks.json" {
		t.Fatalf("got jwks %q", config.JWKSURL)
	}
}

func TestVerifyWithStaticPublicKey(t *testing.T) {
	tokens, _ := loadFixtures(t)
	pemData, err := os.ReadFile(filepath.Join("..", "testdata", "public-key.pem"))
	if err != nil {
		t.Fatal(err)
	}
	auth, err := New(Config{
		Header:    "X-Trusted-Proxy-Assertion",
		PublicKey: string(pemData),
		Issuer:    "https://issuer.example.test",
		Audience:  "my-service",
	})
	if err != nil {
		t.Fatal(err)
	}

	identity, err := auth.Verify(context.Background(), tokens["valid"])
	if err != nil {
		t.Fatalf("verify valid token: %v", err)
	}
	if identity.Subject != "user-123" {
		t.Fatalf("got subject %q", identity.Subject)
	}
	if _, err := auth.Verify(context.Background(), tokens["invalid_signature"]); err == nil {
		t.Fatal("expected invalid signature to fail")
	}
}

func TestConfigFromEnvReadsInlinePublicKey(t *testing.T) {
	config := ConfigFromEnv(func(key string) string {
		if key == "TRUSTED_PROXY_PUBLIC_KEY" {
			return "-----BEGIN PUBLIC KEY-----\nMII...\n-----END PUBLIC KEY-----"
		}
		return ""
	})
	if config.PublicKey == "" {
		t.Fatal("expected public key to be set")
	}
}

package trustedproxyauth

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"strings"
	"time"
)

type Config struct {
	Header     string
	JWKSURL    string
	Issuer     string
	Audience   string
	HTTPClient *http.Client
}

type Identity struct {
	Subject string
	Email   string
	Name    string
	Claims  map[string]any
}

type contextKey struct{}

type Authenticator struct {
	config     Config
	httpClient *http.Client
}

func New(config Config) (*Authenticator, error) {
	if config.Header == "" {
		return nil, errors.New("missing config: header")
	}
	if config.JWKSURL == "" {
		return nil, errors.New("missing config: jwks url")
	}
	if config.Issuer == "" {
		return nil, errors.New("missing config: issuer")
	}
	if config.Audience == "" {
		return nil, errors.New("missing config: audience")
	}
	client := config.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	return &Authenticator{config: config, httpClient: client}, nil
}

func ConfigFromEnv(getenv func(string) string) Config {
	return Config{
		Header:   getenv("TRUSTED_PROXY_ASSERTION_HEADER"),
		JWKSURL:  getenv("TRUSTED_PROXY_JWKS_URL"),
		Issuer:   getenv("TRUSTED_PROXY_ISSUER"),
		Audience: getenv("TRUSTED_PROXY_AUDIENCE"),
	}
}

func IdentityFromContext(ctx context.Context) (Identity, bool) {
	identity, ok := ctx.Value(contextKey{}).(Identity)
	return identity, ok
}

func (a *Authenticator) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimSpace(r.Header.Get(a.config.Header))
		if token == "" {
			unauthorized(w)
			return
		}

		identity, err := a.Verify(r.Context(), token)
		if err != nil {
			unauthorized(w)
			return
		}

		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), contextKey{}, identity)))
	})
}

func (a *Authenticator) Verify(ctx context.Context, token string) (Identity, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return Identity{}, errors.New("malformed assertion")
	}

	var header struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}
	if err := decodeSegment(parts[0], &header); err != nil {
		return Identity{}, err
	}
	if header.Alg != "RS256" || header.Kid == "" {
		return Identity{}, errors.New("unsupported assertion")
	}

	var claims map[string]any
	if err := decodeSegment(parts[1], &claims); err != nil {
		return Identity{}, err
	}

	key, err := a.lookupKey(ctx, header.Kid)
	if err != nil {
		return Identity{}, err
	}

	hasher := sha256.New()
	hasher.Write([]byte(parts[0] + "." + parts[1]))
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return Identity{}, err
	}
	if err := rsa.VerifyPKCS1v15(key, crypto.SHA256, hasher.Sum(nil), signature); err != nil {
		return Identity{}, err
	}

	if claims["iss"] != a.config.Issuer {
		return Identity{}, errors.New("wrong issuer")
	}
	if !matchesAudience(claims["aud"], a.config.Audience) {
		return Identity{}, errors.New("wrong audience")
	}
	exp, ok := claims["exp"].(float64)
	if !ok || int64(exp) <= time.Now().Unix() {
		return Identity{}, errors.New("expired assertion")
	}
	subject, _ := claims["sub"].(string)
	if subject == "" {
		return Identity{}, errors.New("missing subject")
	}

	email, _ := claims["email"].(string)
	name, _ := claims["name"].(string)
	return Identity{Subject: subject, Email: email, Name: name, Claims: claims}, nil
}

func (a *Authenticator) lookupKey(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.config.JWKSURL, nil)
	if err != nil {
		return nil, err
	}
	res, err := a.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, errors.New("failed to fetch jwks")
	}

	var jwks struct {
		Keys []struct {
			Kid string `json:"kid"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(res.Body).Decode(&jwks); err != nil {
		return nil, err
	}
	for _, key := range jwks.Keys {
		if key.Kid == kid {
			return rsaFromJWK(key.N, key.E)
		}
	}
	return nil, errors.New("unknown signing key")
}

func rsaFromJWK(modulus, exponent string) (*rsa.PublicKey, error) {
	nBytes, err := base64.RawURLEncoding.DecodeString(modulus)
	if err != nil {
		return nil, err
	}
	eBytes, err := base64.RawURLEncoding.DecodeString(exponent)
	if err != nil {
		return nil, err
	}
	return &rsa.PublicKey{
		N: new(big.Int).SetBytes(nBytes),
		E: int(new(big.Int).SetBytes(eBytes).Int64()),
	}, nil
}

func decodeSegment(segment string, target any) error {
	decoded, err := base64.RawURLEncoding.DecodeString(segment)
	if err != nil {
		return err
	}
	return json.Unmarshal(decoded, target)
}

func matchesAudience(actual any, expected string) bool {
	switch value := actual.(type) {
	case string:
		return value == expected
	case []any:
		for _, candidate := range value {
			if text, ok := candidate.(string); ok && text == expected {
				return true
			}
		}
	}
	return false
}

func unauthorized(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_, _ = w.Write([]byte(`{"error":"invalid_assertion"}`))
}

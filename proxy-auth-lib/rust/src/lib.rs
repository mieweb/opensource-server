use std::{collections::BTreeMap, fmt, sync::Arc};

use axum::{
    extract::{Request, State},
    http::{HeaderMap, StatusCode},
    middleware::Next,
    response::Response,
};
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug)]
pub struct Config {
    pub header: String,
    pub jwks_url: String,
    pub issuer: String,
    pub audience: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Identity {
    pub subject: String,
    pub email: Option<String>,
    pub name: Option<String>,
    pub claims: Value,
}

#[derive(Debug)]
pub enum AuthError {
    Config(&'static str),
    MissingAssertion,
    UnsupportedAlgorithm,
    MissingKeyId,
    UnknownKey,
    Jwt(jsonwebtoken::errors::Error),
    Jwks(reqwest::Error),
    Serde(serde_json::Error),
}

impl fmt::Display for AuthError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "invalid assertion")
    }
}

impl std::error::Error for AuthError {}

#[derive(Clone)]
pub struct TrustedProxyAuth {
    config: Config,
    client: reqwest::Client,
}

impl TrustedProxyAuth {
    pub fn new(config: Config) -> Result<Self, AuthError> {
        validate_config(&config)?;
        Ok(Self {
            config,
            client: reqwest::Client::new(),
        })
    }

    pub fn config_from_env() -> Config {
        let domain = match std::env::var("TRUSTED_PROXY_AUTH_DOMAIN") {
            Ok(value) if !value.is_empty() => value,
            _ => default_auth_domain(),
        };
        let base = format!("https://{domain}");
        Config {
            header: var_or("TRUSTED_PROXY_ASSERTION_HEADER", DEFAULT_ASSERTION_HEADER),
            jwks_url: var_or("TRUSTED_PROXY_JWKS_URL", format!("{base}/.well-known/jwks.json")),
            issuer: var_or("TRUSTED_PROXY_ISSUER", base.clone()),
            audience: var_or("TRUSTED_PROXY_AUDIENCE", base),
        }
    }

    pub async fn verify(&self, token: &str) -> Result<Identity, AuthError> {
        let header = decode_header(token).map_err(AuthError::Jwt)?;
        if header.alg != Algorithm::RS256 {
            return Err(AuthError::UnsupportedAlgorithm);
        }
        let kid = header.kid.ok_or(AuthError::MissingKeyId)?;

        let jwks = self
            .client
            .get(&self.config.jwks_url)
            .send()
            .await
            .map_err(AuthError::Jwks)?
            .error_for_status()
            .map_err(AuthError::Jwks)?
            .json::<Jwks>()
            .await
            .map_err(AuthError::Jwks)?;

        let jwk = jwks
            .keys
            .into_iter()
            .find(|candidate| candidate.kid == kid)
            .ok_or(AuthError::UnknownKey)?;
        let decoding_key =
            DecodingKey::from_rsa_components(&jwk.n, &jwk.e).map_err(AuthError::Jwt)?;

        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_issuer(&[self.config.issuer.clone()]);
        validation.set_audience(&[self.config.audience.clone()]);
        validation.required_spec_claims = ["aud", "exp", "iss", "sub"]
            .into_iter()
            .map(String::from)
            .collect();

        let token_data =
            decode::<Claims>(token, &decoding_key, &validation).map_err(AuthError::Jwt)?;
        let claims = serde_json::to_value(&token_data.claims).map_err(AuthError::Serde)?;

        Ok(Identity {
            subject: token_data.claims.sub,
            email: token_data.claims.email,
            name: token_data.claims.name,
            claims,
        })
    }
}

pub async fn axum_middleware(
    State(auth): State<Arc<TrustedProxyAuth>>,
    mut request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let token =
        read_header(request.headers(), &auth.config.header).ok_or(StatusCode::UNAUTHORIZED)?;
    let identity = auth
        .verify(token)
        .await
        .map_err(|_| StatusCode::UNAUTHORIZED)?;
    request.extensions_mut().insert(identity);
    Ok(next.run(request).await)
}

fn read_header<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get(name)?
        .to_str()
        .ok()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

// Reasonable defaults so every setting is optional. The auth domain is derived
// from the host name (`web1.os.example.org` -> `auth.os.example.org`); issuer
// and JWKS come from it. Override any single value with its own env var.
pub const DEFAULT_ASSERTION_HEADER: &str = "X-Trusted-Proxy-Assertion";

fn derive_auth_domain(hostname: &str) -> String {
    let labels: Vec<&str> = hostname.split('.').filter(|label| !label.is_empty()).collect();
    match labels.len() {
        0 => "auth.localhost".to_string(),
        1 => format!("auth.{}", labels[0]),
        _ => format!("auth.{}", labels[1..].join(".")),
    }
}

fn default_auth_domain() -> String {
    let host = gethostname::gethostname().to_string_lossy().into_owned();
    derive_auth_domain(&host)
}

fn var_or(key: &str, default: impl Into<String>) -> String {
    match std::env::var(key) {
        Ok(value) if !value.is_empty() => value,
        _ => default.into(),
    }
}

fn validate_config(config: &Config) -> Result<(), AuthError> {
    if config.header.is_empty() {
        return Err(AuthError::Config("header"));
    }
    if config.jwks_url.is_empty() {
        return Err(AuthError::Config("jwks_url"));
    }
    if config.issuer.is_empty() {
        return Err(AuthError::Config("issuer"));
    }
    if config.audience.is_empty() {
        return Err(AuthError::Config("audience"));
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
struct Jwks {
    keys: Vec<Jwk>,
}

#[derive(Debug, Deserialize)]
struct Jwk {
    kid: String,
    n: String,
    e: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct Claims {
    sub: String,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    name: Option<String>,
    iss: String,
    aud: String,
    exp: usize,
    #[serde(flatten)]
    extra: BTreeMap<String, Value>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        extract::Extension,
        middleware,
        response::IntoResponse,
        routing::get,
        Router,
    };
    use serde_json::from_str;
    use std::{collections::HashMap, net::SocketAddr};
    use tokio::{net::TcpListener, task::JoinHandle};
    use tower::ServiceExt;

    fn fixtures(name: &str) -> String {
        std::fs::read_to_string(format!(
            "{}/../testdata/{}",
            env!("CARGO_MANIFEST_DIR"),
            name
        ))
        .unwrap()
    }

    async fn start_jwks_server() -> (String, JoinHandle<()>) {
        let jwks = fixtures("jwks.json");
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address: SocketAddr = listener.local_addr().unwrap();
        let app = Router::new().route(
            "/jwks.json",
            get(move || {
                let body = jwks.clone();
                async move { body.into_response() }
            }),
        );
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (format!("http://{address}/jwks.json"), server)
    }

    fn config(jwks_url: String) -> Config {
        Config {
            header: "x-trusted-proxy-assertion".into(),
            jwks_url,
            issuer: "https://issuer.example.test".into(),
            audience: "my-service".into(),
        }
    }

    #[test]
    fn derives_auth_domain_from_host() {
        assert_eq!(derive_auth_domain("web1.os.example.org"), "auth.os.example.org");
        assert_eq!(derive_auth_domain("host"), "auth.host");
    }

    #[tokio::test]
    async fn verify_covers_all_fixture_cases() {
        let tokens: HashMap<String, String> = from_str(&fixtures("tokens.json")).unwrap();
        let (jwks_url, server) = start_jwks_server().await;
        let auth = TrustedProxyAuth::new(config(jwks_url)).unwrap();

        let identity = auth.verify(&tokens["valid"]).await.unwrap();
        assert_eq!(identity.subject, "user-123");

        for key in [
            "expired",
            "invalid_signature",
            "wrong_issuer",
            "wrong_audience",
            "malformed",
        ] {
            assert!(
                auth.verify(&tokens[key]).await.is_err(),
                "expected {key} to fail"
            );
        }

        server.abort();
    }

    #[tokio::test]
    async fn middleware_rejects_missing_and_accepts_valid_assertions() {
        let tokens: HashMap<String, String> = from_str(&fixtures("tokens.json")).unwrap();
        let (jwks_url, server) = start_jwks_server().await;
        let auth = Arc::new(TrustedProxyAuth::new(config(jwks_url)).unwrap());

        async fn protected(Extension(identity): Extension<Identity>) -> String {
            identity.subject
        }

        let app = Router::new()
            .route("/", get(protected))
            .layer(middleware::from_fn_with_state(
                auth.clone(),
                axum_middleware,
            ));

        let valid_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/")
                    .header("x-trusted-proxy-assertion", &tokens["valid"])
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(valid_response.status(), StatusCode::OK);
        let body = to_bytes(valid_response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(body, "user-123");

        let missing_response = app
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(missing_response.status(), StatusCode::UNAUTHORIZED);

        server.abort();
    }
}

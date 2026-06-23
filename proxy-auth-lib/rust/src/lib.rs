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
        Config {
            header: std::env::var("TRUSTED_PROXY_ASSERTION_HEADER").unwrap_or_default(),
            jwks_url: std::env::var("TRUSTED_PROXY_JWKS_URL").unwrap_or_default(),
            issuer: std::env::var("TRUSTED_PROXY_ISSUER").unwrap_or_default(),
            audience: std::env::var("TRUSTED_PROXY_AUDIENCE").unwrap_or_default(),
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

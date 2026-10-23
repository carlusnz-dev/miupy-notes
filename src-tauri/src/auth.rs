//! Login Google (OIDC) do app desktop: authorization code + PKCE S256 + state,
//! navegador do sistema e redirect loopback. Veja docs/decisoes/2026-10-18_identidade.md.
//!
//! Só o refresh token vai para o cofre do sistema; o ID token fica em memória.
//! O mesmo login pede o escopo Calendar (consentimento único): a API local lê o refresh token deste cofre.

use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

const AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT: &str = "https://oauth2.googleapis.com/revoke";
const SCOPES: &str = "openid email profile";
/// Escopos Calendar do modo espelho (leitura) e refletor (escrita); iguais a `SCOPE_MIRROR`/`SCOPE_REFLECT` da API.
const CALENDAR_SCOPE_MIRROR: &str = "https://www.googleapis.com/auth/calendar.events.owned.readonly";
const CALENDAR_SCOPE_REFLECT: &str = "https://www.googleapis.com/auth/calendar.events.owned";
const KEYRING_SERVICE: &str = "com.miupy.notes";
const KEYRING_USER: &str = "google-refresh-token";
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const HTTP_TIMEOUT: Duration = Duration::from_secs(30);
/// Navegadores abrem conexões especulativas sem enviar nada; sem limite, uma delas prenderia o loop.
const CALLBACK_READ_TIMEOUT: Duration = Duration::from_secs(5);
/// Margem mínima de validade para devolver o ID token em memória sem refresh.
const EXPIRY_MARGIN_SECS: u64 = 60;

const AUTH_NOT_CONFIGURED: &str = "AUTH_NOT_CONFIGURED";
const AUTH_TIMEOUT: &str = "AUTH_TIMEOUT";
const AUTH_DENIED: &str = "AUTH_DENIED";
const AUTH_FAILED: &str = "AUTH_FAILED";
const NOT_SIGNED_IN: &str = "NOT_SIGNED_IN";
const ACCOUNT_CHANGED: &str = "ACCOUNT_CHANGED";
const KEYRING_ERROR: &str = "KEYRING_ERROR";

const SUCCESS_PAGE: &str = "<!doctype html><html lang=\"pt-BR\"><meta charset=\"utf-8\">\
<title>miupy-notes</title><p>Login concluído. Você pode fechar esta aba.</p></html>";
const FAILURE_PAGE: &str = "<!doctype html><html lang=\"pt-BR\"><meta charset=\"utf-8\">\
<title>miupy-notes</title><p>Login não concluído. Volte ao aplicativo.</p></html>";

#[derive(Default)]
pub struct AuthState {
    session: Mutex<Option<Session>>,
}

struct Session {
    id_token: String,
    /// Instante de expiração do ID token, em segundos Unix.
    expires_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    signed_in: bool,
}

struct Config {
    client_id: String,
    client_secret: Option<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
    id_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
}

#[derive(Deserialize)]
struct TokenError {
    error: String,
}

#[derive(Debug, PartialEq)]
enum Callback {
    Code(String),
    Error(String),
    /// Requisição sem state válido ou sem code; o listener continua esperando.
    Invalid,
}

/// Em debug, carrega `../.env.local` (o cwd do `tauri dev` é src-tauri) sem
/// sobrescrever variáveis já definidas. Em release, só o ambiente do processo.
pub fn load_dev_env() {
    #[cfg(debug_assertions)]
    if let Err(err) = dotenvy::from_filename("../.env.local")
        && !err.not_found()
    {
        eprintln!("auth: falha ao carregar .env.local");
    }
}

/// Escopos do login. Sem `calendar` explícito, `GOOGLE_CALENDAR_CREDENTIAL_STORE=login-keyring` (o mesmo opt-in da API)
/// inclui o Calendar somente leitura; o refletor só vem de uma escolha explícita na tela do Calendar.
fn login_scopes(calendar: Option<&str>, calendar_enabled: bool) -> Result<String, String> {
    let calendar = match calendar {
        Some("mirror") => Some(CALENDAR_SCOPE_MIRROR),
        Some("reflect") => Some(CALENDAR_SCOPE_REFLECT),
        Some(_) => return Err(AUTH_FAILED.to_string()),
        None if calendar_enabled => Some(CALENDAR_SCOPE_MIRROR),
        None => None,
    };
    Ok(match calendar {
        Some(scope) => format!("{SCOPES} {scope}"),
        None => SCOPES.to_string(),
    })
}

fn calendar_login_enabled() -> bool {
    std::env::var("GOOGLE_CALENDAR_CREDENTIAL_STORE").is_ok_and(|value| value.trim() == "login-keyring")
}

fn config() -> Result<Config, String> {
    let client_id = std::env::var("GOOGLE_CLIENT_ID")
        .ok()
        .filter(|v| !v.is_empty())
        .ok_or(AUTH_NOT_CONFIGURED)?;
    let client_secret = std::env::var("GOOGLE_CLIENT_SECRET")
        .ok()
        .filter(|v| !v.is_empty());
    Ok(Config {
        client_id,
        client_secret,
    })
}

fn generate_verifier() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| {
        eprintln!("auth: falha ao gerar bytes aleatórios");
        AUTH_FAILED.to_string()
    })?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

fn code_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn authorization_url(
    client_id: &str,
    redirect_uri: &str,
    challenge: &str,
    state: &str,
    scopes: &str,
    login_hint: Option<&str>,
    prompt_consent: bool,
) -> String {
    let mut params = vec![
        ("client_id", client_id),
        ("redirect_uri", redirect_uri),
        ("response_type", "code"),
        ("scope", scopes),
        ("code_challenge", challenge),
        ("code_challenge_method", "S256"),
        ("state", state),
        ("access_type", "offline"),
    ];
    if let Some(hint) = login_hint {
        params.push(("login_hint", hint));
    }
    if prompt_consent {
        params.push(("prompt", "consent"));
    }
    match Url::parse_with_params(AUTH_ENDPOINT, &params) {
        Ok(url) => url.into(),
        // AUTH_ENDPOINT é constante válida; este ramo não ocorre.
        Err(_) => AUTH_ENDPOINT.to_string(),
    }
}

/// Interpreta a primeira linha do request HTTP (`GET /?code=...&state=... HTTP/1.1`).
fn parse_callback(request_line: &str, expected_state: &str) -> Callback {
    if !request_line.starts_with("GET ") { return Callback::Invalid; }
    let Some(target) = request_line.split_whitespace().nth(1) else {
        return Callback::Invalid;
    };
    if !target.starts_with('/') {
        return Callback::Invalid;
    }
    let Ok(url) = Url::parse(&format!("http://127.0.0.1{target}")) else {
        return Callback::Invalid;
    };
    if url.path() != "/" && url.path() != "/callback" { return Callback::Invalid; }
    let (mut code, mut state, mut error) = (None, None, None);
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "code" => { if code.is_some() || value.is_empty() { return Callback::Invalid; } code = Some(value.into_owned()); },
            "state" => { if state.is_some() { return Callback::Invalid; } state = Some(value.into_owned()); },
            "error" => { if error.is_some() { return Callback::Invalid; } error = Some(value.into_owned()); },
            _ => {}
        }
    }
    if state.as_deref() != Some(expected_state) {
        return Callback::Invalid;
    }
    match (error, code) {
        (Some(error), _) => Callback::Error(error),
        (None, Some(code)) => Callback::Code(code),
        (None, None) => Callback::Invalid,
    }
}

/// `sub` do ID token. Lido sem verificar assinatura: o token veio direto do endpoint do Google por TLS.
fn jwt_subject(token: &str) -> Option<String> {
    jwt_payload(token)?.get("sub")?.as_str().map(str::to_string)
}

/// Decodifica o payload de um JWT sem verificar a assinatura.
fn jwt_payload(token: &str) -> Option<serde_json::Value> {
    let payload = token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|err| {
        eprintln!("auth: cofre indisponível: {err}");
        KEYRING_ERROR.to_string()
    })
}

fn read_refresh_token() -> Result<Option<String>, String> {
    match keyring_entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => {
            eprintln!("auth: falha ao ler o cofre: {err}");
            Err(KEYRING_ERROR.to_string())
        }
    }
}

fn store_refresh_token(token: &str) -> Result<(), String> {
    keyring_entry()?.set_password(token).map_err(|err| {
        eprintln!("auth: falha ao gravar no cofre: {err}");
        KEYRING_ERROR.to_string()
    })
}

fn delete_refresh_token() -> Result<(), String> {
    match keyring_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => {
            eprintln!("auth: falha ao apagar do cofre: {err}");
            Err(KEYRING_ERROR.to_string())
        }
    }
}

/// O cofre usa chamadas bloqueantes (D-Bus no Linux); roda fora do executor async.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|_| KEYRING_ERROR.to_string())?
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .map_err(|err| {
            eprintln!("auth: falha ao criar cliente HTTP: {err}");
            AUTH_FAILED.to_string()
        })
}

/// POST no token endpoint. Devolve `Err(Some(código OAuth))` para erros do
/// Google e `Err(None)` para falhas de rede ou de formato.
async fn token_request(
    config: &Config,
    mut params: Vec<(&str, &str)>,
) -> Result<TokenResponse, Option<String>> {
    params.push(("client_id", &config.client_id));
    if let Some(secret) = &config.client_secret {
        params.push(("client_secret", secret));
    }
    let client = http_client().map_err(|_| None)?;
    let response = client
        .post(TOKEN_ENDPOINT)
        .form(&params)
        .send()
        .await
        .map_err(|err| {
            eprintln!(
                "auth: falha de rede no token endpoint: {}",
                err.without_url()
            );
            None
        })?;
    let status = response.status();
    if !status.is_success() {
        let error = response.json::<TokenError>().await.ok().map(|e| e.error);
        eprintln!(
            "auth: token endpoint respondeu {status} ({})",
            error.as_deref().unwrap_or("sem código")
        );
        return Err(error);
    }
    response.json().await.map_err(|_| {
        eprintln!("auth: resposta inválida do token endpoint");
        None
    })
}

/// Guarda o ID token em memória com o `exp` do próprio token (ou `expires_in`).
fn save_session(auth: &AuthState, id_token: String, expires_in: Option<u64>) {
    let expires_at = jwt_payload(&id_token)
        .and_then(|claims| claims.get("exp").and_then(|exp| exp.as_u64()))
        .unwrap_or_else(|| now_secs() + expires_in.unwrap_or(0));
    *lock(auth) = Some(Session {
        id_token,
        expires_at,
    });
}

fn valid_id_token(auth: &AuthState, margin: u64) -> Option<String> {
    lock(auth)
        .as_ref()
        .filter(|session| session.expires_at > now_secs() + margin)
        .map(|session| session.id_token.clone())
}

fn lock(auth: &AuthState) -> std::sync::MutexGuard<'_, Option<Session>> {
    auth.session
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

async fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\n\
Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

/// Lê até o fim da primeira linha do request (limite de 8 KiB).
async fn read_request_line(stream: &mut TcpStream) -> Option<String> {
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    while buf.len() < 8192 {
        let read = stream.read(&mut chunk).await.ok()?;
        if read == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..read]);
        if let Some(end) = buf.windows(2).position(|w| w == b"\r\n") {
            return String::from_utf8(buf[..end].to_vec()).ok();
        }
    }
    None
}

/// Espera o redirect do Google até receber um callback com o state esperado.
async fn wait_for_code(listener: &TcpListener, expected_state: &str) -> Result<String, String> {
    loop {
        let Ok((mut stream, _)) = listener.accept().await else {
            continue;
        };
        let Ok(line) =
            tokio::time::timeout(CALLBACK_READ_TIMEOUT, read_request_line(&mut stream)).await
        else {
            continue;
        };
        let line = line.unwrap_or_default();
        match parse_callback(&line, expected_state) {
            Callback::Code(code) => {
                respond(&mut stream, "200 OK", SUCCESS_PAGE).await;
                return Ok(code);
            }
            Callback::Error(error) => {
                respond(&mut stream, "200 OK", FAILURE_PAGE).await;
                eprintln!("auth: autorização recusada ({error})");
                return Err(if error == "access_denied" {
                    AUTH_DENIED
                } else {
                    AUTH_FAILED
                }
                .to_string());
            }
            Callback::Invalid => {
                respond(&mut stream, "400 Bad Request", FAILURE_PAGE).await;
            }
        }
    }
}

#[cfg(debug_assertions)]
fn debug_print_identity(id_token: &str) {
    if std::env::var("MIUPY_DEBUG_IDENTITY").as_deref() != Ok("1") {
        return;
    }
    let claims = jwt_payload(id_token).unwrap_or_default();
    let claim = |name: &str| {
        claims
            .get(name)
            .and_then(|v| v.as_str())
            .unwrap_or("?")
            .to_string()
    };
    eprintln!("identidade: iss={} sub={}", claim("iss"), claim("sub"));
}

#[tauri::command]
pub async fn auth_status(auth: State<'_, AuthState>) -> Result<AuthStatus, String> {
    let signed_in = valid_id_token(&auth, 0).is_some()
        || blocking(read_refresh_token).await.ok().flatten().is_some();
    Ok(AuthStatus { signed_in })
}

#[tauri::command]
pub async fn auth_sign_in(
    auth: State<'_, AuthState>,
    calendar: Option<String>,
) -> Result<(), String> {
    let config = config()?;
    let scopes = login_scopes(calendar.as_deref(), calendar_login_enabled())?;
    // Refazer o login pelo Calendar não pode trocar de conta: o React, o cache local e a outbox continuam os da sessão
    // atual. Sem sessão em memória, renova o ID token para saber quem está logado.
    let expected_sub = match calendar {
        Some(_) => Some(
            jwt_subject(&auth_id_token(auth.clone()).await?).ok_or(AUTH_FAILED.to_string())?,
        ),
        None => None,
    };
    // Sem refresh token no cofre, ou ao escolher o Calendar na tela dele, força o consentimento: o Google só
    // emite refresh token com os escopos novos (apps instalados não têm autorização incremental).
    let has_refresh = blocking(read_refresh_token).await.ok().flatten().is_some();

    let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|err| {
        eprintln!("auth: falha ao abrir porta loopback: {err}");
        AUTH_FAILED.to_string()
    })?;
    let port = listener
        .local_addr()
        .map_err(|_| AUTH_FAILED.to_string())?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}");
    let verifier = generate_verifier()?;
    let state = generate_verifier()?;
    let url = authorization_url(
        &config.client_id,
        &redirect_uri,
        &code_challenge(&verifier),
        &state,
        &scopes,
        expected_sub.as_deref(),
        !has_refresh || calendar.is_some(),
    );

    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|err| {
        eprintln!("auth: falha ao abrir o navegador: {err}");
        AUTH_FAILED.to_string()
    })?;

    let code = tokio::time::timeout(SIGN_IN_TIMEOUT, wait_for_code(&listener, &state))
        .await
        .map_err(|_| AUTH_TIMEOUT.to_string())??;
    drop(listener);

    let tokens = token_request(
        &config,
        vec![
            ("grant_type", "authorization_code"),
            ("code", &code),
            ("code_verifier", &verifier),
            ("redirect_uri", &redirect_uri),
        ],
    )
    .await
    .map_err(|_| AUTH_FAILED.to_string())?;

    let id_token = tokens.id_token.ok_or_else(|| {
        eprintln!("auth: resposta sem id_token");
        AUTH_FAILED.to_string()
    })?;
    if let Some(expected) = expected_sub
        && jwt_subject(&id_token).as_deref() != Some(expected.as_str())
    {
        // Outra conta escolhida na tela do Google: nada é gravado e o token recém-emitido é revogado (melhor esforço).
        if let Some(token) = tokens.refresh_token {
            revoke(&token).await;
        }
        return Err(ACCOUNT_CHANGED.to_string());
    }
    #[cfg(debug_assertions)]
    debug_print_identity(&id_token);
    save_session(&auth, id_token, tokens.expires_in);
    if let Some(refresh_token) = tokens.refresh_token {
        blocking(move || store_refresh_token(&refresh_token)).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn auth_id_token(auth: State<'_, AuthState>) -> Result<String, String> {
    if let Some(id_token) = valid_id_token(&auth, EXPIRY_MARGIN_SECS) {
        return Ok(id_token);
    }
    let config = config()?;
    let refresh_token = blocking(read_refresh_token).await?.ok_or(NOT_SIGNED_IN)?;
    let tokens = match token_request(
        &config,
        vec![
            ("grant_type", "refresh_token"),
            ("refresh_token", &refresh_token),
        ],
    )
    .await
    {
        Ok(tokens) => tokens,
        // Refresh token revogado ou expirado: limpa o cofre e pede novo login.
        Err(Some(error)) if error == "invalid_grant" => {
            blocking(delete_refresh_token).await?;
            *lock(&auth) = None;
            return Err(NOT_SIGNED_IN.to_string());
        }
        Err(_) => return Err(AUTH_FAILED.to_string()),
    };
    let id_token = tokens.id_token.ok_or_else(|| {
        eprintln!("auth: refresh sem id_token");
        AUTH_FAILED.to_string()
    })?;
    save_session(&auth, id_token.clone(), tokens.expires_in);
    Ok(id_token)
}

#[tauri::command]
pub async fn auth_sign_out(auth: State<'_, AuthState>) -> Result<(), String> {
    *lock(&auth) = None;
    // Melhor esforço: a entrada local é apagada mesmo se a revogação falhar.
    if let Some(token) = blocking(read_refresh_token).await? {
        revoke(&token).await;
    }
    blocking(delete_refresh_token).await
}

/// Revogação de melhor esforço; falhas só vão para o log, sem o token.
async fn revoke(token: &str) {
    if let Ok(client) = http_client()
        && let Err(err) = client
            .post(REVOKE_ENDPOINT)
            .form(&[("token", token)])
            .send()
            .await
    {
        eprintln!("auth: falha ao revogar: {}", err.without_url());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn code_challenge_matches_rfc7636_appendix_b() {
        assert_eq!(
            code_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn verifier_is_43_chars_base64url_without_padding() {
        let verifier = generate_verifier().expect("verifier");
        assert_eq!(verifier.len(), 43);
        assert!(
            verifier
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        );
        assert_ne!(verifier, generate_verifier().expect("verifier"));
    }

    #[test]
    fn authorization_url_has_pkce_redirect_and_scope() {
        let url = authorization_url("client", "http://127.0.0.1:4321", "chal", "st", SCOPES, None, false);
        assert!(url.starts_with(AUTH_ENDPOINT));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("code_challenge=chal"));
        assert!(url.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A4321"));
        assert!(url.contains("scope=openid+email+profile"));
        assert!(url.contains("access_type=offline"));
        assert!(url.contains("state=st"));
        assert!(!url.contains("prompt="));
        let with_consent = authorization_url("client", "http://127.0.0.1:1", "c", "s", SCOPES, Some("123"), true);
        assert!(with_consent.contains("prompt=consent"));
        assert!(with_consent.contains("login_hint=123"));
        assert!(!url.contains("login_hint"));
    }

    #[test]
    fn login_scopes_add_calendar_only_when_enabled_or_chosen() {
        assert_eq!(login_scopes(None, false).unwrap(), "openid email profile");
        assert_eq!(
            login_scopes(None, true).unwrap(),
            format!("openid email profile {CALENDAR_SCOPE_MIRROR}")
        );
        assert_eq!(
            login_scopes(Some("reflect"), false).unwrap(),
            format!("openid email profile {CALENDAR_SCOPE_REFLECT}")
        );
        assert_eq!(
            login_scopes(Some("mirror"), true).unwrap(),
            format!("openid email profile {CALENDAR_SCOPE_MIRROR}")
        );
        assert_eq!(login_scopes(Some("owner"), true), Err(AUTH_FAILED.to_string()));
        let url = authorization_url("c", "http://127.0.0.1:1", "c", "s", &login_scopes(Some("reflect"), false).unwrap(), None, true);
        assert!(url.contains("calendar.events.owned"));
        assert!(!url.contains("include_granted_scopes"));
    }

    #[test]
    fn callback_with_matching_state_returns_code() {
        assert_eq!(
            parse_callback("GET /?state=abc&code=4%2F0xyz&scope=openid HTTP/1.1", "abc"),
            Callback::Code("4/0xyz".to_string())
        );
    }

    #[test]
    fn callback_with_wrong_or_missing_state_is_invalid() {
        assert_eq!(
            parse_callback("GET /?state=other&code=c HTTP/1.1", "abc"),
            Callback::Invalid
        );
        assert_eq!(
            parse_callback("GET /?code=c HTTP/1.1", "abc"),
            Callback::Invalid
        );
        assert_eq!(
            parse_callback("GET /favicon.ico HTTP/1.1", "abc"),
            Callback::Invalid
        );
        assert_eq!(
            parse_callback("GET /?state=abc HTTP/1.1", "abc"),
            Callback::Invalid
        );
        assert_eq!(parse_callback("", "abc"), Callback::Invalid);
    }

    #[test]
    fn callback_with_error_and_matching_state_returns_error() {
        assert_eq!(
            parse_callback("GET /?error=access_denied&state=abc HTTP/1.1", "abc"),
            Callback::Error("access_denied".to_string())
        );
        assert_eq!(
            parse_callback("GET /?error=access_denied&state=x HTTP/1.1", "abc"),
            Callback::Invalid
        );
    }

    #[test]
    fn callback_rejects_duplicates_empty_code_and_wrong_path() {
        for line in [
            "GET /callback?code=c&state=s&state=s HTTP/1.1",
            "GET /callback?code=c&code=d&state=s HTTP/1.1",
            "GET /callback?code=&state=s HTTP/1.1",
            "GET /other?code=c&state=s HTTP/1.1",
            "POST /callback?code=c&state=s HTTP/1.1",
        ] { assert!(matches!(parse_callback(line, "s"), Callback::Invalid)); }
    }

    #[test]
    fn jwt_payload_decodes_claims() {
        let payload =
            URL_SAFE_NO_PAD.encode(r#"{"iss":"https://accounts.google.com","sub":"123","exp":99}"#);
        let token = format!("eyJhbGciOiJSUzI1NiJ9.{payload}.c2ln");
        let claims = jwt_payload(&token).expect("payload");
        assert_eq!(claims["iss"], "https://accounts.google.com");
        assert_eq!(claims["sub"], "123");
        assert_eq!(claims["exp"], 99);
        assert!(jwt_payload("sem-pontos").is_none());
        assert!(jwt_payload("a.!!!.c").is_none());
        assert_eq!(jwt_subject(&token).as_deref(), Some("123"));
        assert!(jwt_subject("sem-pontos").is_none());
    }
}

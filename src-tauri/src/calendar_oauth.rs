//! Consentimento Calendar separado do login. Código/verifier nunca atravessam o React.
use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
use std::time::{Duration, Instant};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};
use tokio::net::TcpListener;
use crate::auth;

#[derive(Default)]
pub struct CalendarOAuthState { active: Mutex<Option<Arc<AtomicBool>>>, finalizing: AtomicBool }

struct ActiveGuard<'a> { state: &'a CalendarOAuthState, cancelled: Arc<AtomicBool> }
impl Drop for ActiveGuard<'_> {
    fn drop(&mut self) {
        let mut active = self.state.active.lock().unwrap_or_else(|p| p.into_inner());
        if active.as_ref().is_some_and(|value| Arc::ptr_eq(value, &self.cancelled)) { *active = None; self.state.finalizing.store(false, Ordering::SeqCst); }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Authorization { authorization_url: String, state: String }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthorizationInput<'a> { mode: &'a str, redirect_uri: &'a str, code_challenge: &'a str }

fn api_base() -> Result<reqwest::Url, String> {
    let value = std::env::var("MIUPY_API_BASE_URL").unwrap_or_else(|_| "http://127.0.0.1:4000".into());
    let url = reqwest::Url::parse(&value).map_err(|_| "CALENDAR_NOT_CONFIGURED")?;
    // Este adaptador só atende à API local. Nunca envie ID token a uma URL recebida do frontend.
    if url.scheme() != "http" || url.host_str() != Some("127.0.0.1") || !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
        return Err("CALENDAR_NOT_CONFIGURED".into());
    }
    Ok(url)
}

fn valid_authorization(url: &reqwest::Url, state: &str, challenge: &str, redirect: &str) -> bool {
    let param = |name: &str| url.query_pairs().find(|(key, _)| key == name).map(|(_, value)| value.into_owned());
    url.scheme() == "https" && url.host_str() == Some("accounts.google.com") && url.path() == "/o/oauth2/v2/auth"
        && url.username().is_empty() && url.password().is_none() && url.port().is_none() && url.fragment().is_none()
        && ["state", "code_challenge", "code_challenge_method", "redirect_uri"].iter().all(|name| url.query_pairs().filter(|(key, _)| key == name).count() == 1)
        && param("state").as_deref() == Some(state) && param("code_challenge").as_deref() == Some(challenge)
        && param("code_challenge_method").as_deref() == Some("S256") && param("redirect_uri").as_deref() == Some(redirect)
}

#[tauri::command]
pub fn calendar_google_cancel(state: State<'_, CalendarOAuthState>) -> Result<(), String> {
    let active = state.active.lock().unwrap_or_else(|p| p.into_inner());
    if state.finalizing.load(Ordering::SeqCst) { return Err("CALENDAR_FINALIZING".into()); }
    if let Some(cancelled) = active.as_ref() { cancelled.store(true, Ordering::SeqCst); }
    Ok(())
}

async fn response_json(response: reqwest::Response) -> Result<serde_json::Value, String> {
    if !response.status().is_success() {
        // Classificação somente; corpos do provedor/servidor nunca vão a logs ou ao frontend.
        return Err(if response.status().as_u16() == 503 { "CREDENTIAL_STORE_UNAVAILABLE" } else { "CALENDAR_CONNECT_FAILED" }.into());
    }
    response.json().await.map_err(|_| "CALENDAR_CONNECT_FAILED".into())
}

#[tauri::command]
pub async fn calendar_google_connect(app: tauri::AppHandle, mode: String, auth: State<'_, auth::AuthState>, state: State<'_, CalendarOAuthState>) -> Result<serde_json::Value, String> {
    if mode != "mirror" && mode != "reflect" { return Err("CALENDAR_CONNECT_FAILED".into()); }
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut active = state.active.lock().unwrap_or_else(|p| p.into_inner());
        if active.is_some() { return Err("CALENDAR_CONNECT_BUSY".into()); }
        *active = Some(cancelled.clone());
    }
    let _guard = ActiveGuard { state: &state, cancelled: cancelled.clone() };
    let token = auth::auth_id_token(auth.clone()).await?;
    let base = api_base()?;
    let client = reqwest::Client::builder().timeout(Duration::from_secs(30)).redirect(reqwest::redirect::Policy::none()).build().map_err(|_| "CALENDAR_CONNECT_FAILED")?;
    let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|_| "CALENDAR_CONNECT_FAILED")?;
    let redirect = format!("http://127.0.0.1:{}/callback", listener.local_addr().map_err(|_| "CALENDAR_CONNECT_FAILED")?.port());
    let verifier = auth::generate_verifier()?;
    let challenge = auth::code_challenge(&verifier);
    let response = client.post(base.join("/v1/calendar/google/authorization").map_err(|_| "CALENDAR_NOT_CONFIGURED")?).bearer_auth(&token)
        .json(&AuthorizationInput { mode: &mode, redirect_uri: &redirect, code_challenge: &challenge }).send().await.map_err(|_| "CALENDAR_CONNECT_FAILED")?;
    let authorization: Authorization = serde_json::from_value(response_json(response).await?).map_err(|_| "CALENDAR_CONNECT_FAILED")?;
    let url = reqwest::Url::parse(&authorization.authorization_url).map_err(|_| "CALENDAR_CONNECT_FAILED")?;
    if !valid_authorization(&url, &authorization.state, &challenge, &redirect) { return Err("CALENDAR_CONNECT_FAILED".into()); }
    if cancelled.load(Ordering::SeqCst) { return Err("CALENDAR_CANCELLED".into()); }
    tauri_plugin_opener::open_url(url.to_string(), None::<&str>).map_err(|_| "CALENDAR_CONNECT_FAILED")?;
    let deadline = Instant::now() + Duration::from_secs(300);
    let waiting = auth::wait_for_code(&listener, &authorization.state);
    let mut waiting = std::pin::pin!(waiting);
    let code = loop {
        if cancelled.load(Ordering::SeqCst) { return Err("CALENDAR_CANCELLED".into()); }
        if Instant::now() >= deadline { return Err("AUTH_TIMEOUT".into()); }
        if let Ok(result) = tokio::time::timeout(Duration::from_millis(100), &mut waiting).await { break result?; }
    };
    if cancelled.load(Ordering::SeqCst) { return Err("CALENDAR_CANCELLED".into()); }
    // A sessão deve continuar aberta: sair do app durante o navegador invalida a conclusão local.
    let current_token = auth::auth_id_token(auth).await?;
    if current_token != token { return Err("CALENDAR_SESSION_CHANGED".into()); }
    {
        let _active = state.active.lock().unwrap_or_else(|p| p.into_inner());
        if cancelled.load(Ordering::SeqCst) { return Err("CALENDAR_CANCELLED".into()); }
        state.finalizing.store(true, Ordering::SeqCst);
    }
    let _ = app.emit("calendar-google-finalizing", ());
    // Depois do envio o servidor pode ter persistido o consentimento mesmo se a resposta se perder.
    // Cancelar só interrompe a espera pelo navegador; a conclusão exige desconectar explicitamente.
    let response = client.post(base.join("/v1/calendar/google/connection").map_err(|_| "CALENDAR_NOT_CONFIGURED")?).bearer_auth(&token)
        .json(&serde_json::json!({ "state": authorization.state, "code": code, "codeVerifier": verifier, "redirectUri": redirect }))
        .send().await.map_err(|_| "CALENDAR_CONNECT_FAILED")?;
    response_json(response).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn authorization_must_target_google_and_match_pkce_state_redirect() {
        let url = reqwest::Url::parse_with_params("https://accounts.google.com/o/oauth2/v2/auth", &[("state", "s"), ("code_challenge", "c"), ("code_challenge_method", "S256"), ("redirect_uri", "http://127.0.0.1:1234/callback")]).unwrap();
        assert!(valid_authorization(&url, "s", "c", "http://127.0.0.1:1234/callback"));
        assert!(!valid_authorization(&url, "other", "c", "http://127.0.0.1:1234/callback"));
        assert!(!valid_authorization(&url, "s", "other", "http://127.0.0.1:1234/callback"));
        let mut duplicate = url.clone(); duplicate.query_pairs_mut().append_pair("state", "other");
        assert!(!valid_authorization(&duplicate, "s", "c", "http://127.0.0.1:1234/callback"));
        let mut fragment = url.clone(); fragment.set_fragment(Some("unexpected"));
        assert!(!valid_authorization(&fragment, "s", "c", "http://127.0.0.1:1234/callback"));
        let mut forged = url.clone(); forged.set_host(Some("evil.example")).unwrap();
        assert!(!valid_authorization(&forged, "s", "c", "http://127.0.0.1:1234/callback"));
    }
}

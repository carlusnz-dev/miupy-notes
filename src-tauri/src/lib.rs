mod auth;
mod calendar_oauth;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    auth::load_dev_env();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(auth::AuthState::default())
        .manage(calendar_oauth::CalendarOAuthState::default())
        .invoke_handler(tauri::generate_handler![
            auth::auth_status,
            auth::auth_sign_in,
            auth::auth_id_token,
            auth::auth_sign_out,
            calendar_oauth::calendar_google_connect,
            calendar_oauth::calendar_google_cancel
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

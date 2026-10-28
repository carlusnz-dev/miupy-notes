mod auth;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    auth::load_dev_env();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(auth::AuthState::default())
        .invoke_handler(tauri::generate_handler![
            auth::auth_status,
            auth::auth_sign_in,
            auth::auth_id_token,
            auth::auth_sign_out
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

# Release por tag no GitHub Actions

Data: 2026-10-28.

## Decisão

`.github/workflows/release.yml` publica uma versão quando uma tag `vX.Y.Z` chega ao GitHub (ou por `workflow_dispatch` informando a tag). O job `verificar` exige que `package.json`, `apps/web/package.json`, `src-tauri/tauri.conf.json` e `src-tauri/Cargo.toml` tenham a versão da tag e roda `check:modules`, `test:api` e `test:web`. Em seguida cria um rascunho de release e os jobs anexam:

- Linux (`ubuntu-22.04`): `.deb`, `.rpm`, `.AppImage`.
- Windows: `.exe` (NSIS) e `.msi`.
- macOS: `.dmg` para Apple Silicon e Intel.
- Android: `.apk` universal (`tauri android build --apk`).

O rascunho só é publicado (`--latest`) quando todos os jobs passam.

## Configuração

- `vars.VITE_API_BASE_URL`: URL da API embutida no frontend dos instaladores.
- Assinatura Android opcional: `secrets.ANDROID_KEYSTORE_BASE64`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. O workflow grava `src-tauri/gen/android/keystore.properties` (ignorado pelo Git) e o Gradle aplica a assinatura só se o arquivo existir; sem segredos o APK sai com sufixo `-unsigned` e precisa ser assinado antes de instalar.
- Sem assinatura de código no Windows/macOS: instaladores disparam SmartScreen/Gatekeeper. Assinatura e notarização ficam pendentes.

## Limites conhecidos

- O app desktop lê `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` de `../.env.local` em tempo de execução (`src-tauri/src/auth.rs`); os instaladores não embutem essa configuração, então o login Google em um binário distribuído depende de configuração local.
- O build Android do Tauri (inclusive `keyring` no Android) não foi exercitado localmente antes do primeiro release.

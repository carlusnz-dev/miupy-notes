# Release v0.1.0 e v0.1.1 — builds, tela em branco, assinatura Android (2026-10-29)

## Análise do trabalho de 28/10

- Worker Sonnet do Orca (sessão `1be66200`, worktree `habits-mvp`, 10:40–10:53): merge de `origin/develop` em `feat/habits-mvp` (`9dcabbb`, 5 conflitos em `app.ts`, `lambda.ts`, `logger.ts`, `error-handler.ts` e `api.md`) e `72bdd92`, que adiciona `dynamodb:ConditionCheckItem` à role da Lambda. Os dois commits entraram em `release/v0.1.0` (`cf32fea`) e em `main` (#32). O IAM só passou por `terraform fmt -check`; não foi aplicado na AWS.
- O resultado do worker (`resultado-habitos.md`) ficou só no diretório de briefs, fora do Git. Pendências abertas por ele: limite de 300 hábitos sem serialização; painel da Agenda sem estado vazio, retry e XP; `apps/api/README.md` sem os campos `service`/`detail`/`providerStatus`.
- Primeiro release v0.1.0 (run `40701028746`): linux ok. Windows e macOS falharam no `tsc` (`popover.ts` × `Popover.tsx` em sistemas de arquivos que ignoram maiúsculas); android falhou no `sdkmanager` (pacote legado `tools`). `publicar` foi pulado, mas rascunho e tag ficaram no repositório. O fix `137ea1e` (#33) já estava em `develop`.

## Mudanças

- #35 `.github/workflows/release.yml`: job `Release / limpar` (`if: failure() || cancelled()`), que remove rascunho e tag e nunca toca em release publicada.
- Rascunho e tag v0.1.0 antigos removidos; #34 levou o fix para `main`; tag recriada em `5d3e41d`. Release v0.1.0 publicada (run `40894248000`), com APK sem assinatura.
- O APK sem assinatura não instalava (o Android acusava "pacote conflitante"; os IDs `com.miupy.notes` e `dev.miupy.app` são distintos). Instalado no aparelho com assinatura de debug local, o app abria em tela em branco.
- Causa da tela em branco, em todas as plataformas da v0.1.0: `vars.VITE_API_BASE_URL` inexistente vira `""` no build; `z.url().optional()` recusa `""` e o `parse` em `api-client.ts` lançava na carga do módulo. #37: `apiEnvSchema` trata vazio como ausente; HTTPS continua obrigatório fora de loopback.
- Chave de release Android criada fora do Git em `~/.config/miupy-notes/android/` (PKCS12, RSA 4096, alias `miupy-notes`, SHA-256 `58:33:92:AC…:BB:5A`); segredos `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEY_ALIAS` e `ANDROID_KEY_PASSWORD` configurados no repositório.
- #38/#39: `padding-top: env(safe-area-inset-top)` em `.main-content` no layout móvel e versão 0.1.1 em `package.json` (raiz, web, api, mcp), `tauri.conf.json`, `Cargo.toml` e lockfiles. Tag `v0.1.1` em `836ff70`.

## Verificação

- CI `verificar` aprovado em #35, #34, #37, #38 e #39. Local: `npm run build` ok, `test:web` 229/229 (um teste novo), `check:modules` 6/6.
- Bundle com `VITE_API_BASE_URL=` servido por `vite preview` e aberto em Chromium headless: app montado, sem erros no console.
- APK arm64 com o #37, gerado localmente e assinado com a chave de release: instalado e aberto no Android. A tela "Visão geral" foi exibida, ainda sob a barra de status.
- Release v0.1.1 (run `40915123923`): todos os jobs aprovados, `limpar` pulado. APK `miupy-notes_0.1.1_android.apk` assinado com a mesma chave (conferido com `apksigner`). O proprietário instalou e testou no aparelho.

## Pendências

- `vars.VITE_API_BASE_URL` não configurada: o app abre, mas não sincroniza com a API. A URL de dev é saída do Terraform e não foi consultada.
- Backup da chave de release é responsabilidade do proprietário; sem ela, atualizações exigem desinstalar o app.
- O caminho de falha do job `limpar` ainda não rodou de verdade.
- IAM de hábitos (`72bdd92`) não aplicado; pendências do worker de hábitos seguem abertas.
- Não executados: instalação dos instaladores desktop e `actionlint` (não instalado). O push por SSH falha neste shell; fetch e push usaram HTTPS com a credencial do `gh`.

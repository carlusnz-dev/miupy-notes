# Calendar local: login Google único

Data: 2026-10-22. Escopo: RF-05, RF-12, RNF-02, composição local Linux. Substitui [OAuth Calendar local](2026-10-22_calendar-local-oauth.md) e [reuso do cliente OAuth](2026-10-22_calendar-oauth-client-reuse.md) nos pontos de consentimento e cofre; mantém deles a janela de sincronização, PATCH/If-Match e a serialização por processo.

## Problema

O login pedia `openid email profile`. O Calendar abria um segundo OAuth no navegador (`calendar_oauth.rs` → `POST /google/authorization` → troca de código na API) com outro refresh token no Secret Service backend: duas telas de consentimento, dois tokens e uma fase final sem cancelamento.

## Opções

1. **Escopo Calendar no login; a API local lê o refresh token do login (escolhida).** Um consentimento, um token, um cofre. Custo: a API passa a ler a entrada do chaveiro do Tauri, e o escopo (leitura ou escrita) é o do último login.
2. Escopo Calendar no login; o Tauri entrega o refresh token à API (HTTP loopback), que o guarda em cofre próprio. Dois tokens iguais e um segredo de longa vida atravessando HTTP: mais superfície sem ganho.
3. Access token do Calendar passando pelo React em cada chamada. Rejeitada: token de provedor no JavaScript contraria `AGENTS.md`.
4. Manter o OAuth separado, só com `login_hint`. Continua a segunda tela de consentimento; não resolve.

## Escolha e efeitos

- **Tauri:** `auth_sign_in(calendar?: "mirror"|"reflect")`. Com `GOOGLE_CALENDAR_CREDENTIAL_STORE=login-keyring`, o login padrão pede também `calendar.events.owned.readonly` (menor privilégio). Escolher um modo na tela do Calendar refaz o login com `prompt=consent` e o escopo escolhido. Apps instalados não suportam autorização incremental, então o pedido leva todos os escopos juntos e substitui o refresh token do cofre. `calendar_oauth.rs` e seus comandos foram removidos.
- **API:** `LoginCredentialStore` faz `secret-tool lookup service com.miupy.notes username google-refresh-token`, somente leitura. `HttpGoogleOAuth` só renova (`scope` e `id_token` vêm do token endpoint). `AccessTokenSource` exige `sub` do ID token igual ao proprietário, pois a entrada é única por usuário do sistema; token de outra conta vira `REAUTH_REQUIRED`. `POST /google/connection` virou `{}`: confere os escopos do login e grava o cadastro (reflect se `calendar.events.owned`, senão mirror), sem tela do Google; sem escopo, `409 SCOPE_NOT_GRANTED`. `POST /google/authorization`, `state` pendente e troca de código foram removidos.
- **Configuração:** o mesmo `GOOGLE_CALENDAR_CREDENTIAL_STORE=login-keyring` liga o conector da API e o escopo no Tauri. `GOOGLE_CALENDAR_CLIENT_ID/SECRET` e `secret-service` falham na inicialização: o refresh token só renova com o cliente que o emitiu.
- **UI:** "Conectado via sua conta Google"; "Ativar Google Calendar" não abre navegador. Só com `SCOPE_NOT_GRANTED` (login antigo ou Calendar desmarcado) ou `needs_reauth` a tela oferece refazer o login com a permissão escolhida.

## Segurança e revogação

A API local já roda como o mesmo usuário do sistema do Tauri, então ler a entrada do chaveiro não amplia quem pode alcançá-la; amplia o que um comprometimento da API alcança, agora o refresh token do login. Mitigações: leitura sem escrita, `sub` conferido, segredo só por pipe/memória, Lambda sem esse adaptador. Revogação é por projeto no Google; com um só token, **Desconectar Calendar não revoga**, apenas apaga cadastro e espelhos e para de usar o acesso. Revogar é sair da conta ou remover o app na conta Google. Itens `CALENDAR#GOOGLE#PENDING` antigos ficam órfãos e inertes.

## Evidência e limites

Testes com fakes: renovação, `scope`/`sub`, token de outra conta, escopo ausente, modo reflect/mirror, desconectar sem revogar, concorrência connect/disconnect, rota `{}`, `/google/authorization` inexistente, factory e leitura do chaveiro por executor falso, e `login_scopes` em Rust. Não verificados: chaveiro real (atributos `service`/`username` da crate `keyring` vistos só no código da crate), login e consentimento reais, janela Tauri, revogação efetiva. Fontes: [OAuth Desktop](https://developers.google.com/identity/protocols/oauth2/native-app), [revogação](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke), [validação de ID token](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation).

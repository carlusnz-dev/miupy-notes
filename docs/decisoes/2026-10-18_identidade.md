# Identidade: Google OIDC direto, um único usuário

- **Data:** 2026-10-18
- **Estado:** aceita; **implementada localmente em 2026-10-18 (sessão 05)**: cliente OAuth *Desktop app* criado pelo proprietário (projeto `miupy-notes`, consentimento em *Testing*), login real feito, verificação na API local com `jose`. JWT authorizer e recursos AWS **não** criados.
- **Resolve:** item 1 de [`pendencias.md`](pendencias.md).

## Contexto

App pessoal Tauri com API Gateway HTTP + Lambda. A API precisa negar requisições sem identidade válida e derivar o proprietário do token, nunca do cliente (RF-02). Opções avaliadas: Cognito com PKCE, Google OIDC direto e Auth0 Free.

## Decisão

1. **Uso estritamente pessoal, sem cadastro.** Um único proprietário; não há fluxo de criação de conta.
2. **Provedor:** Google como emissor OIDC, sem Cognito intermediário.
3. **Desktop:** cliente OAuth do tipo *Desktop app*, authorization code com PKCE S256 e `state`, aberto no **navegador do sistema** (nunca em webview embutida), redirect por **loopback** `http://127.0.0.1:<porta efêmera>`. Escopos apenas `openid email profile`.
4. **API Gateway:** JWT authorizer com `issuer` `https://accounts.google.com` e `audience` igual ao client ID do app desktop. O Lambda lê `requestContext.authorizer.jwt.claims`.
5. **Autorização no backend:** `ownerId` = claim `sub`. O backend aceita apenas um `sub` de uma lista configurada por variável de ambiente (fora do Git) e responde `403` aos demais. `email` não é identificador.
6. Tokens de login são separados de qualquer consentimento futuro de Calendar/Gmail; esses escopos serão pedidos pelo backend em fluxo próprio (RF-05/RF-06).

## Motivos

- Sem custo e sem serviço adicional para manter; o proprietário já usa conta Google.
- Fluxo nativo previsto pelo Google e pela RFC 8252 (loopback + PKCE + navegador externo).
- O JWT authorizer valida assinatura, `iss`, `aud`, `exp`, `nbf` e `iat` antes do Lambda.

## Riscos e efeitos assumidos

- **Qualquer conta Google obtém um ID token com o nosso `aud`.** O authorizer prova a autenticação, não a autorização: a lista de `sub` permitidos no backend é obrigatória. Manter também a tela de consentimento em modo *Testing* com o proprietário como único usuário de teste.
- **A API aceitará ID token**, porque o access token do Google é opaco. A AWS recomenda exigir scopes para não confundir tipos de JWT; aqui a defesa é o `aud` exclusivo do cliente desktop mais a lista de `sub`.
- **`iss` variável:** o Google documenta `https://accounts.google.com` *ou* `accounts.google.com`, e o authorizer aceita um único valor. Verificar com a conta real qual valor o endpoint de token emite; se variar, validar o token no Lambda em vez do authorizer.
- **Prende a identidade à conta Google.** Trocar de provedor exigirá migrar o `ownerId` dos registros (mapear `sub` antigo → novo).
- O cliente desktop é público: o `client_secret` emitido pelo Google para *Desktop app* não é confidencial e não pode ser tratado como segredo de servidor.
- Em modo *Testing*, autorizações expiram em 7 dias, **exceto** quando só `openid`, `email` e `profile` são pedidos — o caso desta decisão.
- Tokens no desktop devem ficar no cofre do sistema operacional, não em `localStorage` nem no bundle.

## Implementação (sessão 05)

- `iss` real emitido com a conta do proprietário: `https://accounts.google.com` (um valor; serve ao JWT authorizer). A API local aceita as duas formas documentadas.
- Escolhas do proprietário: verificação no Express com `jose`; loopback próprio em Rust (sem plugin OAuth); cofre via crate `keyring` no Rust; `client_secret`, se exigido, lido em runtime pelo Rust, nunca no bundle.
- Pendente: Terraform do authorizer; configuração de release do app; confirmar se o Google aceita a troca sem `client_secret` (não testado isoladamente: o login real rodou com `.env.local` do proprietário, cujo conteúdo não foi lido).

## Fontes (consultadas em 2026-10-18)

- API Gateway, JWT authorizers: <https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html>
- Google, OAuth para apps desktop (loopback; esquema próprio não suportado; cliente público; PKCE): <https://developers.google.com/identity/protocols/oauth2/native-app>
- Google, OpenID Connect (`iss`, `aud`, `sub` como identificador): <https://developers.google.com/identity/openid-connect/openid-connect>
- Google Cloud, status de publicação *Testing* (100 usuários; expiração de 7 dias e exceção): <https://support.google.com/cloud/answer/15549945>
- RFC 8252, OAuth 2.0 for Native Apps: <https://datatracker.ietf.org/doc/html/rfc8252>
- Alternativas avaliadas: Cognito, endpoint de autorização e PKCE <https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html>, app clients <https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-app-idp-settings.html>, access token <https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-access-token.html>, preços <https://aws.amazon.com/cognito/pricing/>; Auth0, preços <https://auth0.com/pricing>; Tauri deep-link <https://v2.tauri.app/plugin/deep-linking/>.

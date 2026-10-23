# Calendar local: reutilizar o cliente OAuth Desktop

> Consentimento e cofre superados por [login único](2026-10-22_calendar-login-unico.md).

Data: 2026-10-22. Escopo: RF-05, RF-12 e RNF-02, apenas composição local Linux. Complementa [OAuth Calendar local](2026-10-22_calendar-local-oauth.md).

## Contexto e escolha

O login atual solicita `openid email profile`; o refresh token fica no keyring desktop e o ID token em memória autentica a API. O código de login não desserializa `access_token`/`scope`. Não foram inspecionados tokens históricos ou ambiente privado: não se pode inferir quais permissões efetivas esses tokens possuem. Um refresh não amplia escopos; um access token só serviria ao Calendar se vigente e com escopo necessário comprovado. Esta mudança não reaproveita nem migra esses tokens.

O mesmo cliente OAuth Desktop pode pedir os escopos Calendar após habilitar Calendar API no seu projeto. Para evitar configuração duplicada, `GOOGLE_CALENDAR_CREDENTIAL_STORE=secret-service` habilita o conector e permite omitir `GOOGLE_CALENDAR_CLIENT_ID`, herdando `GOOGLE_CLIENT_ID`. O segredo Calendar omitido herda `GOOGLE_CLIENT_SECRET` somente quando os IDs, após trim, são iguais. Override de ID diferente usa apenas seu segredo Calendar, opcional para cliente Desktop público. Segredo Calendar vazio explícito impede fallback.

Sem nenhuma variável Calendar explícita, a factory retorna `null`, mesmo com login configurado. Configuração parcial, segredo isolado, cofre inválido ou ID explícito vazio falha antes de compor o adaptador, com mensagem sem valores. Espaços externos são removidos; variável omitida e variável explicitamente vazia têm semânticas diferentes. Nenhum endpoint, payload, status HTTP ou armazenamento foi alterado.

## Consentimento, sessão e revogação

Cliente identifica o app; sessão Google no navegador pode dispensar nova digitação de credenciais; consentimento autoriza acesso; tokens representam a autorização. Reutilizar cliente não garante reaproveitamento da sessão nem concede Calendar automaticamente. Mantidos PKCE S256, `prompt=consent`, `access_type=offline`, escopo mínimo por modo e `include_granted_scopes=false`: apps instalados não suportam autorização incremental. O backend valida os escopos concedidos antes de guardar um refresh Calendar no Secret Service; escopos insuficientes recusam a conexão e tentam revogar o token recebido.

Os cofres são separados dentro da aplicação, mas o Google documenta revogação dos escopos e tokens de todos os clientes do projeto. Desconectar Calendar, recusar escopos insuficientes ou sair da conta (o login também tenta revogar) pode exigir novo login e nova conexão Calendar quando pertencem ao mesmo projeto. Não se promete independência no provedor. Não há alteração de logout nesta decisão; a revogação permanece de melhor esforço.

## Evidência e limites

Testes sintéticos conferem opt-in, pares herdados/override, segredo opcional, whitespace/configuração inválida, URL com consentimento/PKCE/escopos e formulários de troca/refresh por fetch falso; escopo insuficiente não chama `CredentialStore.put`. O cofre real e contas Google não são acessados. Não é diagnóstico da configuração instalada; prova nativa e com provedor continua pendente. API Lambda permanece sem conector habilitado.

Fontes oficiais consultadas em 2026-10-22:

- [OAuth Desktop: cliente público, PKCE, escopos e ausência de autorização incremental](https://developers.google.com/identity/protocols/oauth2/native-app).
- [OpenID Connect: sessão e parâmetro prompt](https://developers.google.com/identity/openid-connect/openid-connect#authenticationuriparameters).
- [Revogação: efeitos nos tokens e escopos do projeto](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke).

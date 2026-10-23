# Contrato da agenda — `/v1/calendar`

RF-05 (parcial), RF-12 (parcial) e RNF-05. Base `/v1/calendar`, montada atrás da mesma autenticação das notas (ID token validado e `ALLOWED_SUBS`). `ownerId` vem só do principal: não é aceito no corpo, na query nem devolvido. Evento de outro proprietário responde `404`. Código local em `apps/api/src/modules/calendar`; tipos públicos em `contract.ts`; cliente web em `apps/web/src/lib/calendar-api.ts`. **Sem implantação AWS e sem conexão real com o Google** (ver "Google").

## Eventos

| Método | Caminho | Entrada | Saída |
|---|---|---|---|
| `GET` | `/events` | `limit` 1–100 (padrão 50), `cursor` opaco, `from`/`to` ISO com deslocamento | `{ items, nextCursor }` |
| `POST` | `/events` | `{ id?, title, description?, location?, allDay?, start, end, timeZone?, links?, sendToGoogle? }` | `201` evento; `200` se é repetição idêntica |
| `GET` | `/events/{id}` | — | evento |
| `PATCH` | `/events/{id}` | `{ version, ...campos }` (ao menos um campo além de `version`) | evento atualizado (salvar e refletir pode avançar duas versões) |
| `DELETE` | `/events/{id}?version=N` | `version` obrigatório | `204` |
| `POST` | `/events/{id}/google-reflection` | `{}` | evento (envia/atualiza no Google) |
| `DELETE` | `/events/{id}/google-reflection?keepRemote=true\|false` | — | evento sem vínculo |

Campos desconhecidos (inclusive `ownerId`) respondem `400`. Limites: `title` 1–200 após `trim`; `description` ≤ 8 000; `location` ≤ 300; `links` ≤ 20. Corpo HTTP ≤ 256 kB.

**Evento:** `{ id, title, description, location, allDay, start, end, timeZone, links, source, readOnly, external, reflection, createdAt, updatedAt, version }`. `ownerId`, ETag e IDs do Google nunca saem na resposta.

### Tempo, fuso e dia inteiro

- **Com hora (`allDay: false`):** `start`/`end` são data-hora **reais com deslocamento explícito** (`Z` ou `±hh:mm`, ex.: `2026-10-21T09:00:00-03:00`; validação estrita: `2026-02-30…`, hora 24 ou sem deslocamento → `400`, nunca normalizado nem lido no fuso do servidor) e **`timeZone` IANA é obrigatório**. O servidor normaliza para instante UTC (`...Z`) e guarda o nome do fuso só para exibir/editar. `end` deve ser posterior a `start`. Data sem hora ou fuso inexistente → `400`.
- **Dia inteiro (`allDay: true`):** `start`/`end` são datas `AAAA-MM-DD` reais, **`end` é o último dia (inclusivo)**, sem fuso (`timeZone` vira `null`, mesmo se enviado). `end >= start`. Não há instante: não sofre desvio de fuso. No Google, `end.date` é exclusivo; a conversão (±1 dia) acontece só na fronteira do conector.
- **Período (`from`/`to`):** filtra por sobreposição `startsAt < to && endsAt > from`. Dia inteiro entra como data flutuante lida em UTC (`00:00Z` do primeiro dia até `00:00Z` do dia seguinte ao último). O cliente web amplia o período em um dia de cada lado e filtra por dia local ao exibir. `to <= from` → `400`.

### Versão, idempotência e conflito

- `PATCH` e `DELETE` exigem a `version` lida; divergência → `409 CONFLICT` (escrita condicional no DynamoDB; sem sobrescrita silenciosa). `DELETE` de item ausente → `404`.
- **Idempotência de criação:** o cliente envia `id` (UUID gerado por ele). Reenviar o mesmo `id` com o mesmo conteúdo devolve `200` com o evento existente (sem duplicar); `id` existente com conteúdo diferente → `409`. O mesmo UUID em outro proprietário não colide. Sem `id`, o servidor gera um (sem proteção contra repetição).
- **Relações (`links`):** `{ kind: "note" | "event", id }`. A nota deve existir e ser do mesmo proprietário (porta `NoteDirectory`, ligada ao serviço de notas em `compose.ts`); o evento deve existir e não ser o próprio. Inválida → `400` genérico ("Relação inválida."), sem revelar o motivo. **Biblioteca e finanças não são tipos válidos** (módulos indisponíveis/em outra frente); a UI mostra "Biblioteca: módulo ainda indisponível". Excluir um evento ou nota não remove links que apontam para ele: a UI exibe "indisponível".
- Espelhos (`source: "google"`, `readOnly: true`) conservam essa origem na resposta; a UI permite editar/excluir apenas com conexão `reflect` atual. Sem escrita → `409 READ_ONLY_EVENT`; conexão antiga/versão divergente → `409 CONFLICT`. Edição usa ETag do espelho e PATCH no Google; exclusão remota precede a exclusão local condicional. Relações não são editáveis em espelhos.
- `sendToGoogle: true` em POST/PATCH registra primeiro o evento local e depois envia a cópia ao Google. Uma falha remota pode deixar a gravação local concluída; repetir o mesmo UUID/conteúdo reconcilia sem duplicar. Eventos já refletidos atualizam automaticamente a cópia ao salvar. `sendToGoogle: false` não desfaz um vínculo existente: use `google-reflection` explicitamente.
- Excluir um evento refletido remove primeiro a cópia Google com If-Match e depois o registro local com a versão original. O vínculo permanece até a exclusão local: se houver edição concorrente, retorna conflito preservando a referência; novo DELETE reconcilia 404/410 remoto. Não há transação entre Google e DynamoDB.

### Listagem e paginação

Ordem estável **por ID**, não cronológica (sem índice por data). Com `from`/`to` o DynamoDB aplica `Limit` antes do filtro; o repositório lê até 5 rodadas de 100 itens para juntar a página e devolve `nextCursor` (último item devolvido ou última chave avaliada). Uma página pode vir com menos itens ou vazia com `nextCursor` — continue até `null`. Custo proporcional ao acervo do proprietário (sem índice novo). Cursor inválido ou forjado → `400`; a partição vem sempre do principal.

## Google Calendar (espelho e refletor)

| Método | Caminho | Função |
|---|---|---|
| `GET` | `/google` | Estado: `not_configured`, `not_connected`, `connected`, `needs_reauth`; modo, escopos, `calendarId`, `connectedAt`, `lastSyncAt`, `lastError` (só código), `hasSyncCursor` |
| `POST` | `/google/connection` | Corpo `{}`. Ativa o Calendar com o consentimento que o **login** já concedeu: renova o access token com o refresh token do login e confere os escopos Calendar (reflect se `calendar.events.owned`, senão mirror). Sem escopo → `409 SCOPE_NOT_GRANTED`; sem login ou token de outra conta → `409 REAUTH_REQUIRED`. Nenhuma tela do Google. Removido: `POST /google/authorization` e o corpo `{ state, code, codeVerifier, redirectUri }` |
| `DELETE` | `/google/connection` | Apaga cadastro e espelhos. **Não revoga** o token (é o do login); revogar é sair da conta |
| `POST` | `/google/sync` | Espelho: sincroniza mudanças do Google |

### Implementação local (verificação desta frente com fakes e HTTP sintético)

- **Fronteiras testáveis:** `GoogleOAuth` (só renovação), `CredentialStore` (só leitura) e `GoogleCalendarClient` (portas). Implementações: `HttpGoogleOAuth`/`HttpGoogleCalendarClient` (fetch injetável) e fakes em memória. O web nunca recebe segredo ou token do provedor; segredo do cliente e refresh token ficam no servidor/chaveiro.
- **Sem configuração = não configurado:** `createCalendarModule(..., google = null)` continua padrão. O servidor local exige opt-in `GOOGLE_CALENDAR_CREDENTIAL_STORE=login-keyring` (o mesmo valor habilita o escopo Calendar no login do Tauri) e usa `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` do login, pois o refresh token só renova com o cliente que o emitiu. `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` e `GOOGLE_CALENDAR_CREDENTIAL_STORE=secret-service` foram removidos e falham no início, sem imprimir valores; segredo Desktop é opcional. Sem variáveis Calendar, login configurado não habilita o conector. Lambda continua sem adaptador Google. `GET /google` responde `not_configured`, e `connection`/`sync`/reflexão respondem `409 INTEGRATION_NOT_CONFIGURED`. Nenhuma chamada ao Google acontece.
- **Consentimento único (o do login):** o login do Tauri pede `openid email profile` mais `calendar.events.owned.readonly` (padrão com o opt-in) ou `calendar.events.owned` (escolha explícita na tela do Calendar); nomes conforme a [referência de insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert) e a página de [autorização](https://developers.google.com/workspace/calendar/api/auth); confirmar na tela de consentimento. A API não abre outro OAuth. O ID token do login **nunca** é usado como token do Calendar. Consentimento granular: se o Calendar não veio concedido (resposta do refresh traz `scope`), a conexão é recusada com `SCOPE_NOT_GRANTED` antes de gravar o cadastro. **Escopos reconferidos a cada operação:** sincronizar, enviar, editar ou excluir comparam o modo gravado com os escopos do token atual (em cache enquanto o refresh token do chaveiro não muda). Um login refeito só com leitura rebaixa o cadastro para `mirror` (escrita → `409 REFLECTION_NOT_ENABLED`/`READ_ONLY_EVENT`, sem chamar o Google); com escrita, volta a `reflect`; sem nenhum escopo Calendar, o cadastro vira `needs_reauth` com `lastError: SCOPE_NOT_GRANTED` e a operação responde `409 SCOPE_NOT_GRANTED`.
- **Espelho (leitura), conforme a [guia de sincronização](https://developers.google.com/workspace/calendar/api/guides/sync):** carga inicial limitada de 30 dias passados até 366 dias futuros (`timeMin`/`timeMax`, estáveis entre páginas, só na completa) e incremental com `syncToken` + `pageToken`, `singleEvents=true` nos dois, sem `timeMin`/`timeMax`/`orderBy`/`q` com `syncToken`. O `nextSyncToken` só é gravado após a última página; teto de 40 páginas por rodada (acima disso, `502 SYNC_TOO_LARGE`, sem marcar como em dia). **`410 Gone`** → apaga os espelhos do proprietário e refaz a completa (`resynced: true`). Cancelados removem o espelho. Itens são regravados com ID determinístico (`sha256` de proprietário+calendário+ID externo → UUID), logo repetir não duplica; ETag igual não regrava.
- **Refletor (escrita consentida, evento a evento):** só com modo `reflect`, por ação explícita (`POST .../google-reflection`). O ID do evento no Google é o UUID local sem hífens (base32hex válido), mais `extendedProperties.private.miupyEventId`: se o 1º envio chegou mas a resposta se perdeu, o `409` do insert é reconciliado por `GET` em vez de duplicar. Atualização usa PATCH e `If-Match` com o ETag guardado; `412` só vira `409 GOOGLE_CONFLICT` se o conteúdo remoto diferir do local (se igual, adota o ETag). Um `409` no insert (ID já existe) segue a mesma regra: conteúdo idêntico reconcilia; **divergente é `GOOGLE_CONFLICT` explícito, sem atualizar o remoto** (resolver apagando/ajustando a cópia no Google). Nada é sobrescrito sem consentimento. A cópia enviada não volta como espelho duplicado, e a sincronização **só adota o ETag novo dela se o conteúdo remoto for idêntico ao enviado** (edição no Google não avança o ETag).
- **Conexão tem `connectionId`:** desconectar/reconectar gera outro. Sincronização em voo confere a conexão a cada página e antes de gravar o cursor (gravação condicional); se foi desconectada ou refeita, remove só os espelhos gravados por ela e responde `409 INTEGRATION_NOT_CONNECTED`, sem ressuscitar o estado. Erros tardios também só gravam na mesma conexão.
- **Limites e erros do provedor:** `429` e `403 rateLimitExceeded/userRateLimitExceeded` repetem até 4 tentativas com backoff exponencial + jitter. `Retry-After` aceita segundos ou HTTP-date, sem truncar o prazo. Esperas de até 8 s são feitas no cliente do provedor; acima disso retorna imediatamente o erro com o prazo intacto, sem repetir antes da hora; `401` renova o access token uma vez; esgotado ou com prazo acima da janela interna → `429 RATE_LIMITED` público (indisponibilidade → `502 UPSTREAM_UNAVAILABLE`). Quando existe prazo, a API retorna `Retry-After` em segundos arredondados para cima e o expõe por `Access-Control-Expose-Headers`, mantendo o envelope JSON. `403 insufficientPermissions` → `409 SCOPE_NOT_GRANTED` (descarta o access token em cache para reconferir); demais `403` → `403 UPSTREAM_FORBIDDEN`; nenhum dos dois é repetível pela outbox. `needs_reauth` bloqueia novas chamadas. Erros são reduzidos a classificação: corpo, token e mensagens do Google não vão a respostas nem logs.
- **Armazenamento (mesma tabela):** eventos `EVENT#<id>`; cadastro `CALENDAR#GOOGLE`; sem item de autorização pendente (itens `CALENDAR#GOOGLE#PENDING` de versões anteriores ficam órfãos e inertes). Atributos derivados `startsAt`/`endsAt` só para filtrar. Persistência em DynamoDB Local verificada (ver relatório); repositório em memória para testes.

### Cofre e consentimento desktop

O Tauri guarda o refresh token do login no keyring do sistema (serviço `com.miupy.notes`, usuário `google-refresh-token`). A API local Linux o **lê** com `secret-tool lookup service com.miupy.notes username google-refresh-token`: somente leitura, nunca grava, troca nem apaga, e o segredo passa por stdout de pipe, nunca argv, bundle ou DynamoDB. O access token permanece em memória, associado ao refresh token atual. A entrada é única por usuário do sistema; por isso, a cada renovação, `AccessTokenSource` confere que o `sub` do ID token devolvido pelo token endpoint (TLS, sem exigir verificação de assinatura) é o do proprietário autenticado e recusa token de outra conta (`REAUTH_REQUIRED`). Cofre indisponível responde `503 CREDENTIAL_STORE_UNAVAILABLE`. Ausência reportada pelo secret-tool retorna não autorizado; o processo não consegue distinguir todas as causas de saída 1 do utilitário. O adaptador não é um cofre AWS nem um serviço multi-host.

Os atributos `service`/`username` do item gravado pela crate `keyring` seguem o teste da crate `zbus-secret-service-keyring-store`; a leitura com `secret-tool` num chaveiro real **não foi verificada**. Apps instalados [não suportam autorização incremental](https://developers.google.com/identity/protocols/oauth2/native-app#identify-access-scopes): trocar leitura por escrita, ou conceder o Calendar a um login que não o trouxe, exige refazer o login (`auth_sign_in` com `calendar`, `prompt=consent`), que substitui o refresh token do cofre. O Tauri envia `login_hint` com o `sub` da sessão e, se outra conta for escolhida, recusa com `ACCOUNT_CHANGED` sem gravar sessão nem token e revoga o token recém-emitido (melhor esforço). Reduzir escrita para leitura não revoga o token anterior: ele só deixa de ser usado. [Consentimento não obriga nova autenticação](https://developers.google.com/identity/openid-connect/openid-connect#authenticationuriparameters), mas a tela de consentimento aparece.

Um refresh token é revogado de uma só vez: sair da conta tenta revogar o token do login e, com ele, o acesso ao Calendar; a [revogação invalida escopos e tokens de todos os clientes do projeto](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke). Desconectar o Calendar no app **não revoga nada**: só para de usar o acesso e apaga cadastro e espelhos. Não foi comprovada revogação com conta real.

Conectar/desconectar são serializados por proprietário no processo da API local. **Essa coordenação não é distribuída**: executar vários processos com o mesmo repositório exige geração/trava persistida antes de habilitar o adaptador. Os espelhos saem ao desconectar; cópias enviadas permanecem no Google.

Espelhos truncam textos para exibição (200/8000/300). PATCH compara os campos recebidos com o espelho e omite os inalterados, preservando textos remotos maiores e campos fora do formulário. Troca entre hora/dia inteiro limpa `date` ou `dateTime`/`timeZone` incompatíveis via null. ETag remoto divergente não é sobrescrito; o app só reconcilia resposta perdida quando os campos efetivamente enviados já coincidem.

### Limites pendentes

1. Nenhuma conta Google real, chaveiro real ou consentimento nativo foi usado nesta frente. A configuração depende do proprietário e de prova autorizada; testes sintéticos não comprovam o comportamento do provedor. Não há adaptador de credenciais AWS.
2. A janela inicial não representa todo o calendário. Incrementais recebem mudanças segundo o cursor do provedor, sem reaplicar a janela; a passagem do tempo não busca automaticamente ocorrências futuras nunca importadas. Recomeçar uma conexão reinicia a carga limitada.
3. **Sem agendamento:** a sincronização é sob demanda (`POST /google/sync`); não há job periódico, push notifications (`events.watch`) nem retomada parcial de uma rodada interrompida (reinicia a partir do último token gravado).
4. Só o calendário `primary`. Sem convidados, recorrência editável, lembretes, anexos nem conferência. Espelho de recorrentes vem expandido (`singleEvents`).
5. Sincronizações concorrentes do mesmo proprietário são idempotentes, mas sem trava (último a gravar o cursor vence).
6. Sem exportação/restauração dos eventos (RF-04) e sem retenção definida para backup.

## Erros

Envelope e `requestId` como em [`api.md`](api.md). Códigos próprios da agenda:

| Status | `code` | Quando |
|---|---|---|
| `409` | `CONFLICT` | `version` divergente; `id` de criação já existe com conteúdo diferente |
| `409` | `READ_ONLY_EVENT` | edição/exclusão de espelho sem conexão de escrita |
| `409` | `REFLECTION_ACTIVE` | proteção do serviço de CRUD local; a rota HTTP coordena a remoção Google |
| `403` | `UPSTREAM_FORBIDDEN` | o Google negou a operação por motivo que não é escopo nem limite; não repetir |
| `409` | `INTEGRATION_NOT_CONFIGURED` / `INTEGRATION_NOT_CONNECTED` / `REAUTH_REQUIRED` / `SCOPE_NOT_GRANTED` | estado da integração; `SCOPE_NOT_GRANTED` = o login não concedeu o Calendar; `REAUTH_REQUIRED` = sem login no cofre, token de outra conta ou recusado pelo Google |
| `409` | `REFLECTION_NOT_ENABLED` | enviar ao Google sem modo `reflect` |
| `409` | `GOOGLE_CONFLICT` / `GOOGLE_EVENT_MISSING` | ETag divergente / evento sumiu no Google |
| `503` | `CREDENTIAL_STORE_UNAVAILABLE` | cofre Linux indisponível ou falha ao ler |
| `429` | `RATE_LIMITED` | limite do Google esgotou as tentativas ou exige espera acima da janela interna |
| `502` | `UPSTREAM_UNAVAILABLE` / `UPSTREAM_REJECTED` / `SYNC_TOO_LARGE` / `SYNC_INCOMPLETE` | falha do provedor ou sincronização incompleta |

## Cliente web (cache e outbox offline)

`apps/web/src/calendar/`. Rota `#/agendas` (`#/events` redireciona). Modos dia/semana/mês/ano; o planner prioriza a lista **Próximos eventos** (30 dias) e o cronograma de blocos (dia/semana).

- **Persistência por conta antes do HTTP:** IndexedDB `miupy-calendar` (`events`, `outbox`, `meta`), chaves `[ownerId, …]` com `ownerId` = `sub` do ID token (como os rascunhos de notas). Toda criação/edição/exclusão grava primeiro a intenção no dispositivo (`enqueue`) e só então tenta enviar. Se a gravação local falhar, o formulário continua aberto com os dados.
- **Um envio por evento, fundido:** editar uma criação pendente continua criação; excluir uma criação pendente cancela sem rede; `rev` impede que a confirmação de uma versão apague uma edição mais nova.
- **Retry:** erro de rede/5xx/429 mantém o envio com backoff (2 s, 4 s, … teto 60 s somente para o backoff do app; `Retry-After` é piso sem truncamento, inclusive após edição durante envio e ao tentar manualmente); rede indisponível encerra a rodada. Dispara ao abrir, ao voltar online, a cada 15 s com pendências e por "Tentar agora". `401` interrompe sem marcar o envio.
- **Reconciliação:** `409`/`404` → o motor lê o servidor: conteúdo igual e reflexão solicitada/ativa em dia ⇒ já enviado (conclui); `GOOGLE_CONFLICT` permanece conflito mesmo com conteúdo local igual; diferente ⇒ **conflito visível** com cópia do servidor; exclusão 404 ⇒ concluída. `400` ⇒ "recusado" (rascunho preservado). Resolução: "Manter o meu" (reenvia sobre a versão do servidor; evento removido lá é recriado com o mesmo ID), "Usar o do servidor" (descarta o rascunho) ou descartar.
- **Texto honesto:** pendências aparecem como "salva(s) só neste dispositivo, aguardando envio"; "Em dia com o servidor" só após uma leitura/envio bem-sucedidos. Sem conexão, mostra o cache e a hora da última atualização.
- **Limite conhecido:** sair da conta não avisa sobre alterações da agenda ainda não enviadas (o aviso de `signOut` cobre só rascunhos de notas; `auth.ts` não é desta frente). Elas permanecem no IndexedDB da conta e são enviadas no próximo login do mesmo proprietário. Sem criptografia local da aplicação nem coordenação entre janelas.

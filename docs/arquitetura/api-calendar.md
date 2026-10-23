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

## Tarefas

Entidade própria do módulo, na mesma tabela (chave `USER#{ownerId}` / `TASK#{id}`), com as mesmas regras de proprietário, versão e idempotência dos eventos. Tipos públicos em `task-contract.ts`; cliente web em `apps/web/src/lib/calendar-api.ts`. Tarefa de outro proprietário responde `404`.

| Método | Caminho | Entrada | Saída |
|---|---|---|---|
| `GET` | `/tasks` | `limit` 1–100 (padrão 50), `cursor` opaco, `status` `pending`\|`completed` | `{ items, nextCursor }` |
| `POST` | `/tasks` | `{ id?, title, description?, dueDate?, dueTime?, status? }` | `201` tarefa; `200` se é repetição idêntica |
| `GET` | `/tasks/{id}` | — | tarefa |
| `PATCH` | `/tasks/{id}` | `{ version, ...campos }` (ao menos um campo além de `version`) | tarefa atualizada |
| `DELETE` | `/tasks/{id}?version=N` | `version` obrigatório | `204` |

**Tarefa:** `{ id, title, description, dueDate, dueTime, status, completedAt, inGoogle, createdAt, updatedAt, version }`. `ownerId` e IDs do Google nunca saem. Limites: `title` 1–200 após `trim`; `description` ≤ 8 000. Campos desconhecidos → `400`.

- **Prazo:** `dueDate` é uma data real `AAAA-MM-DD` ou `null`; `dueTime` é `HH:MM` de **relógio local** (sem fuso: lembrete pessoal) e exige `dueDate`. Inválido → `400`. Limpar a data exige limpar a hora no mesmo `PATCH`.
- **Status:** `pending` ou `completed`. Concluir grava `completedAt`; reabrir limpa; editar outros campos de uma concluída preserva o instante original.
- **Atrasada** não é campo: é pendente com prazo passado (sem hora, vale até o fim do dia). A regra é a função pura `isTaskOverdue` (`domain/task-schedule.ts`), exportada pelo contrato e usada pelo cliente com o relógio local; o servidor não adivinha fuso.
- **Versão e idempotência:** `PATCH`/`DELETE` exigem a `version` lida (`409 CONFLICT` se divergir; escrita condicional no DynamoDB). `POST` com `id` repetido e mesmo conteúdo → `200`; conteúdo diferente → `409`.
- **Listagem:** ordem estável por ID. Com `status` o DynamoDB aplica `Limit` antes do filtro; o repositório lê até 5 rodadas de 100 itens para juntar a página (como em `/events`) — continue até `nextCursor: null`.

### Google Tasks (porta, desligada)

Projetada, **não ativada**. `google-tasks/` tem a porta `GoogleTasksClient` (inserir, atualizar, excluir), o mapeamento (`completed` ↔ `status: "completed"` + `completed`; pendente ↔ `needsAction` com `completed: null`; só a data do prazo, pois a API descarta a hora), um cliente HTTP (`https://tasks.googleapis.com/tasks/v1/lists/…`) e um fake. `TaskGoogleSync` envia após cada gravação, guarda a referência (`external`, `inGoogle: true`) e nunca desfaz a gravação local se o Google falhar. Sem `TaskGoogleSync` (composição padrão em `module.ts`), nenhuma chamada acontece.

**Pendente de autorização do proprietário:** (1) habilitar a Tasks API no projeto GCP; (2) pedir o escopo `https://www.googleapis.com/auth/tasks` no consentimento (hoje só Calendar); (3) fonte de token (`TasksTokenSource`) ligada ao cofre; (4) ligar `TaskGoogleSync` com `enabled: true` em `createCalendarModule`. Verificado só com fakes e `fetch` falso; nenhuma chamada a conta real, nenhum `gcloud`. Sem sincronização no sentido Google → app.

## Google Calendar (espelho e refletor)

| Método | Caminho | Função |
|---|---|---|
| `GET` | `/google` | Estado: `not_configured`, `not_connected`, `connected`, `needs_reauth`; modo, escopos, `lastSyncAt`, `lastError` (só código), `hasSyncCursor` |
| `POST` | `/google/authorization` | `{ mode: "mirror"\|"reflect", redirectUri, codeChallenge }` → URL de consentimento e `state` (10 min, uso único) |
| `POST` | `/google/connection` | `{ state, code, codeVerifier, redirectUri }` troca o código no servidor |
| `DELETE` | `/google/connection` | Revoga (melhor esforço), apaga credencial, cadastro e espelhos |
| `POST` | `/google/sync` | Espelho: sincroniza mudanças do Google |

### Implementação local (verificação desta frente com fakes e HTTP sintético)

- **Fronteiras testáveis:** `GoogleOAuth`, `CredentialStore` e `GoogleCalendarClient` (portas). Implementações: `HttpGoogleOAuth`/`HttpGoogleCalendarClient` (fetch injetável) e fakes em memória. O web nunca recebe segredo, token ou código do provedor; segredo do cliente e refresh token ficam no servidor.
- **Sem configuração = não configurado:** `createCalendarModule(..., google = null)` continua padrão. O servidor local exige opt-in `GOOGLE_CALENDAR_CREDENTIAL_STORE=secret-service`. Omitindo `GOOGLE_CALENDAR_CLIENT_ID`, usa `GOOGLE_CLIENT_ID`; omitindo `GOOGLE_CALENDAR_CLIENT_SECRET`, herda `GOOGLE_CLIENT_SECRET` somente se os IDs normalizados forem iguais. Um ID Calendar diferente nunca recebe segredo do login; segredo Desktop é opcional, e vazio explícito impede fallback. Espaços externos são removidos. Sem variáveis Calendar explícitas, login configurado não habilita o conector; configuração parcial, segredo isolado, cofre inválido ou ID explícito vazio falha no início com mensagem sem valores. Lambda continua sem adaptador Google. `GET /google` responde `not_configured`, e `authorization`/`connection`/`sync`/reflexão respondem `409 INTEGRATION_NOT_CONFIGURED`. Nenhuma chamada ao Google acontece.
- **Consentimento separado do login:** escopos mínimos por modo — espelho `calendar.events.owned.readonly`, refletor `calendar.events.owned` (nomes conforme a [referência de insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert) e a página de [autorização](https://developers.google.com/workspace/calendar/api/auth); confirmar na tela de consentimento). `include_granted_scopes=false`, `access_type=offline`, PKCE S256, sem `openid`/perfil. O ID token do login **nunca** é usado como token do Calendar. Consentimento granular: se o escopo pedido não vier concedido, a conexão é recusada antes de gravar a credencial e a API tenta revogar o token recebido.
- **Espelho (leitura), conforme a [guia de sincronização](https://developers.google.com/workspace/calendar/api/guides/sync):** carga inicial limitada de 30 dias passados até 366 dias futuros (`timeMin`/`timeMax`, estáveis entre páginas, só na completa) e incremental com `syncToken` + `pageToken`, `singleEvents=true` nos dois, sem `timeMin`/`timeMax`/`orderBy`/`q` com `syncToken`. O `nextSyncToken` só é gravado após a última página; teto de 40 páginas por rodada (acima disso, `502 SYNC_TOO_LARGE`, sem marcar como em dia). **`410 Gone`** → apaga os espelhos do proprietário e refaz a completa (`resynced: true`). Cancelados removem o espelho. Itens são regravados com ID determinístico (`sha256` de proprietário+calendário+ID externo → UUID), logo repetir não duplica; ETag igual não regrava.
- **Refletor (escrita consentida, evento a evento):** só com modo `reflect`, por ação explícita (`POST .../google-reflection`). O ID do evento no Google é o UUID local sem hífens (base32hex válido), mais `extendedProperties.private.miupyEventId`: se o 1º envio chegou mas a resposta se perdeu, o `409` do insert é reconciliado por `GET` em vez de duplicar. Atualização usa PATCH e `If-Match` com o ETag guardado; `412` só vira `409 GOOGLE_CONFLICT` se o conteúdo remoto diferir do local (se igual, adota o ETag). Um `409` no insert (ID já existe) segue a mesma regra: conteúdo idêntico reconcilia; **divergente é `GOOGLE_CONFLICT` explícito, sem atualizar o remoto** (resolver apagando/ajustando a cópia no Google). Nada é sobrescrito sem consentimento. A cópia enviada não volta como espelho duplicado, e a sincronização **só adota o ETag novo dela se o conteúdo remoto for idêntico ao enviado** (edição no Google não avança o ETag).
- **Conexão tem `connectionId`:** desconectar/reconectar gera outro. Sincronização em voo confere a conexão a cada página e antes de gravar o cursor (gravação condicional); se foi desconectada ou refeita, remove só os espelhos gravados por ela e responde `409 INTEGRATION_NOT_CONNECTED`, sem ressuscitar o estado. Erros tardios também só gravam na mesma conexão.
- **Limites e erros do provedor:** `429` e `403 rateLimitExceeded/userRateLimitExceeded` repetem até 4 tentativas com backoff exponencial + jitter. `Retry-After` aceita segundos ou HTTP-date, sem truncar o prazo. Esperas de até 8 s são feitas no cliente do provedor; acima disso retorna imediatamente o erro com o prazo intacto, sem repetir antes da hora; `401` renova o access token uma vez; esgotado ou com prazo acima da janela interna → `429 RATE_LIMITED` público (indisponibilidade → `502 UPSTREAM_UNAVAILABLE`). Quando existe prazo, a API retorna `Retry-After` em segundos arredondados para cima e o expõe por `Access-Control-Expose-Headers`, mantendo o envelope JSON. `needs_reauth` bloqueia novas chamadas. Erros são reduzidos a classificação: corpo, token e mensagens do Google não vão a respostas nem logs.
- **Armazenamento (mesma tabela):** eventos `EVENT#<id>`; cadastro `CALENDAR#GOOGLE`; autorização pendente `CALENDAR#GOOGLE#PENDING` (sem token). Atributos derivados `startsAt`/`endsAt` só para filtrar. Persistência em DynamoDB Local verificada (ver relatório); repositório em memória para testes.

### Cofre e consentimento desktop

O adaptador local Linux usa `secret-tool`/Secret Service da sessão. Atributos `application=com.miupy.notes.calendar` e SHA-256 do proprietário separam contas e o cofre do login. Refresh token passa por stdin/pipe, nunca argv, bundle ou DynamoDB; access token permanece em memória, associado ao refresh token atual. Cofre indisponível responde `503 CREDENTIAL_STORE_UNAVAILABLE`. Ausência reportada pelo secret-tool retorna não autorizado; o processo não consegue distinguir todas as causas de saída 1 do utilitário. O adaptador não é um cofre AWS nem um serviço multi-host.

Tauri cria PKCE S256 e listener efêmero `127.0.0.1`, valida URL Google/state/challenge/redirect, abre o navegador e espera até cinco minutos. Código e verifier vão diretamente do Rust à API local, nunca React. Redirect precisa ser `http://127.0.0.1:<porta>/callback`, sem userinfo/query/fragmento. State é consumido atomicamente por DELETE ALL_OLD antes da troca. Cancelar interrompe a espera; ao iniciar o POST final, a UI remove Cancelar e informa “Finalizando autorização”. Nessa fase o consentimento pode persistir mesmo se a resposta se perder ou a sessão do app encerrar; confira o estado no próximo login e use Desconectar para revogar.

O cliente OAuth Desktop do login pode ser reutilizado após habilitar Calendar API no mesmo projeto. Cliente identifica o app; sessão Google no navegador pode evitar nova digitação de credenciais, sem garantia; consentimento autoriza escopos; tokens representam a autorização recebida. Login pede `openid email profile`, guarda refresh no keyring desktop e usa ID token em memória para a API. Calendar mantém consentimento explícito (`prompt=consent`), apenas os escopos do modo e outro refresh no Secret Service backend, validado antes de gravar. Nenhum token do login é migrado. Apps instalados [não suportam autorização incremental](https://developers.google.com/identity/protocols/oauth2/native-app#identify-access-scopes), portanto `include_granted_scopes` permanece `false`; [consentimento não obriga nova autenticação](https://developers.google.com/identity/openid-connect/openid-connect#authenticationuriparameters).

A separação dos cofres não garante autorizações independentes no Google: a [revogação invalida escopos e tokens de todos os clientes do projeto](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke). Desconectar Calendar ou rejeitar escopos insuficientes tenta revogar o token Calendar; sair da conta tenta revogar o token do login. No mesmo projeto, essas ações podem exigir novo login e nova conexão Calendar. Não foi alterado o logout nem comprovada a revogação com conta real.

Conectar/desconectar são serializados por proprietário no processo da API local: Desconectar aguarda uma troca em voo e só responde após remover seu grant. **Essa coordenação não é distribuída**: executar vários processos com o mesmo cofre/repositório exige geração/trava persistida antes de habilitar o adaptador. Revogação Google é melhor esforço; falhas de limpeza do cofre são visíveis. Os espelhos saem ao desconectar; cópias enviadas permanecem no Google.

Espelhos truncam textos para exibição (200/8000/300). PATCH compara os campos recebidos com o espelho e omite os inalterados, preservando textos remotos maiores e campos fora do formulário. Troca entre hora/dia inteiro limpa `date` ou `dateTime`/`timeZone` incompatíveis via null. ETag remoto divergente não é sobrescrito; o app só reconcilia resposta perdida quando os campos efetivamente enviados já coincidem.

### Limites pendentes

1. Nenhuma conta Google real, cofre real ou consentimento nativo foi usado nesta frente. A configuração depende do proprietário e de prova autorizada; testes sintéticos não comprovam o comportamento do provedor. Não há adaptador de credenciais AWS.
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
| `409` | `INTEGRATION_NOT_CONFIGURED` / `INTEGRATION_NOT_CONNECTED` / `REAUTH_REQUIRED` / `SCOPE_NOT_GRANTED` | estado da integração |
| `409` | `REFLECTION_NOT_ENABLED` | enviar ao Google sem modo `reflect` |
| `409` | `GOOGLE_CONFLICT` / `GOOGLE_EVENT_MISSING` | ETag divergente / evento sumiu no Google |
| `503` | `CREDENTIAL_STORE_UNAVAILABLE` | cofre Linux indisponível ou falha ao gravar/apagar |
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

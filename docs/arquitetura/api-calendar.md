# Contrato da agenda — `/v1/calendar`

RF-05 (parcial), RF-12 (parcial) e RNF-05. Base `/v1/calendar`, montada atrás da mesma autenticação das notas (ID token validado e `ALLOWED_SUBS`). `ownerId` vem só do principal: não é aceito no corpo, na query nem devolvido. Evento de outro proprietário responde `404`. Código local em `apps/api/src/modules/calendar`; tipos públicos em `contract.ts`; cliente web em `apps/web/src/lib/calendar-api.ts`. **Sem implantação AWS e sem conexão real com o Google** (ver "Google"). Itens centrais (`api.md`, `arquitetura.json`, `backend.json`, `requisitos.md`, índice) não foram alterados por este trabalho: o coordenador integra.

## Eventos

| Método | Caminho | Entrada | Saída |
|---|---|---|---|
| `GET` | `/events` | `limit` 1–100 (padrão 50), `cursor` opaco, `from`/`to` ISO com deslocamento | `{ items, nextCursor }` |
| `POST` | `/events` | `{ id?, title, description?, location?, allDay?, start, end, timeZone?, links? }` | `201` evento; `200` se é repetição idêntica |
| `GET` | `/events/{id}` | — | evento |
| `PATCH` | `/events/{id}` | `{ version, ...campos }` (ao menos um campo além de `version`) | evento com `version + 1` |
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
- Eventos espelhados do Google (`source: "google"`, `readOnly: true`) → `409 READ_ONLY_EVENT` em `PATCH`/`DELETE`.
- Evento com cópia no Google não pode ser excluído (`409 REFLECTION_ACTIVE`): remova o envio antes.

### Listagem e paginação

Ordem estável **por ID**, não cronológica (sem índice por data). Com `from`/`to` o DynamoDB aplica `Limit` antes do filtro; o repositório lê até 5 rodadas de 100 itens para juntar a página e devolve `nextCursor` (último item devolvido ou última chave avaliada). Uma página pode vir com menos itens ou vazia com `nextCursor` — continue até `null`. Custo proporcional ao acervo do proprietário (sem índice novo). Cursor inválido ou forjado → `400`; a partição vem sempre do principal.

## Google Calendar (espelho e refletor)

| Método | Caminho | Função |
|---|---|---|
| `GET` | `/google` | Estado: `not_configured`, `not_connected`, `connected`, `needs_reauth`; modo, escopos, `lastSyncAt`, `lastError` (só código), `hasSyncCursor` |
| `POST` | `/google/authorization` | `{ mode: "mirror"\|"reflect", redirectUri, codeChallenge }` → URL de consentimento e `state` (10 min, uso único) |
| `POST` | `/google/connection` | `{ state, code, codeVerifier, redirectUri }` troca o código no servidor |
| `DELETE` | `/google/connection` | Revoga (melhor esforço), apaga credencial, cadastro e espelhos |
| `POST` | `/google/sync` | Espelho: sincroniza mudanças do Google |

### O que está implementado e verificado (com fakes e DynamoDB Local)

- **Fronteiras testáveis:** `GoogleOAuth`, `CredentialStore` e `GoogleCalendarClient` (portas). Implementações: `HttpGoogleOAuth`/`HttpGoogleCalendarClient` (fetch injetável) e fakes em memória. O web nunca recebe segredo, token ou código do provedor; segredo do cliente e refresh token ficam no servidor.
- **Sem configuração = não configurado:** `createCalendarModule(..., google = null)` (padrão em `compose.ts`, `server.ts`, `lambda.ts`). `GET /google` responde `not_configured`, e `authorization`/`connection`/`sync`/reflexão respondem `409 INTEGRATION_NOT_CONFIGURED`. Nenhuma chamada ao Google acontece.
- **Consentimento separado do login:** escopos mínimos por modo — espelho `calendar.events.owned.readonly`, refletor `calendar.events.owned` (nomes conforme a [referência de insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert) e a página de [autorização](https://developers.google.com/workspace/calendar/api/auth); confirmar na tela de consentimento). `include_granted_scopes=false`, `access_type=offline`, PKCE S256, sem `openid`/perfil. O ID token do login **nunca** é usado como token do Calendar. Consentimento granular: se o escopo pedido não vier concedido, a conexão é recusada e o token revogado.
- **Espelho (leitura), conforme a [guia de sincronização](https://developers.google.com/workspace/calendar/api/guides/sync):** sincronização completa (janela de 30 dias passados via `timeMin`, só aqui) e incremental com `syncToken` + `pageToken`, `singleEvents=true` nos dois, sem `timeMin`/`orderBy`/`q` com `syncToken`. O `nextSyncToken` só é gravado após a última página; teto de 40 páginas por rodada (acima disso, `502 SYNC_TOO_LARGE`, sem marcar como em dia). **`410 Gone`** → apaga os espelhos do proprietário e refaz a completa (`resynced: true`). Cancelados removem o espelho. Itens são regravados com ID determinístico (`sha256` de proprietário+calendário+ID externo → UUID), logo repetir não duplica; ETag igual não regrava.
- **Refletor (escrita consentida, evento a evento):** só com modo `reflect`, por ação explícita (`POST .../google-reflection`). O ID do evento no Google é o UUID local sem hífens (base32hex válido), mais `extendedProperties.private.miupyEventId`: se o 1º envio chegou mas a resposta se perdeu, o `409` do insert é reconciliado por `GET` em vez de duplicar. Atualização usa `If-Match` com o ETag guardado; `412` só vira `409 GOOGLE_CONFLICT` se o conteúdo remoto diferir do local (se igual, adota o ETag). Um `409` no insert (ID já existe) segue a mesma regra: conteúdo idêntico reconcilia; **divergente é `GOOGLE_CONFLICT` explícito, sem atualizar o remoto** (resolver apagando/ajustando a cópia no Google). Nada é sobrescrito sem consentimento. A cópia enviada não volta como espelho duplicado, e a sincronização **só adota o ETag novo dela se o conteúdo remoto for idêntico ao enviado** (edição no Google não avança o ETag).
- **Conexão tem `connectionId`:** desconectar/reconectar gera outro. Sincronização em voo confere a conexão a cada página e antes de gravar o cursor (gravação condicional); se foi desconectada ou refeita, remove só os espelhos gravados por ela e responde `409 INTEGRATION_NOT_CONNECTED`, sem ressuscitar o estado. Erros tardios também só gravam na mesma conexão.
- **Limites e erros do provedor:** `429` e `403 rateLimitExceeded/userRateLimitExceeded` repetem até 4 tentativas com backoff exponencial + jitter. `Retry-After` aceita segundos ou HTTP-date, sem truncar o prazo. Esperas de até 8 s são feitas no cliente do provedor; acima disso retorna imediatamente o erro com o prazo intacto, sem repetir antes da hora; `401` renova o access token uma vez; esgotado ou com prazo acima da janela interna → `429 RATE_LIMITED` público (indisponibilidade → `502 UPSTREAM_UNAVAILABLE`). Quando existe prazo, a API retorna `Retry-After` em segundos arredondados para cima e o expõe por `Access-Control-Expose-Headers`, mantendo o envelope JSON. `needs_reauth` bloqueia novas chamadas. Erros são reduzidos a classificação: corpo, token e mensagens do Google não vão a respostas nem logs.
- **Armazenamento (mesma tabela):** eventos `EVENT#<id>`; cadastro `CALENDAR#GOOGLE`; autorização pendente `CALENDAR#GOOGLE#PENDING` (sem token). Atributos derivados `startsAt`/`endsAt` só para filtrar. Persistência em DynamoDB Local verificada (ver relatório); repositório em memória para testes.

### O que NÃO existe (pendente, não afirmar como feito)

1. **Nenhuma conexão real foi feita ou é possível hoje:** não há `CredentialStore` de produção (exige KMS/Secrets Manager e decisão de armazenamento), cliente OAuth do Calendar configurado, nem tela de consentimento verificada no Google Cloud. Nenhuma credencial, conta real ou `.env` foi usado.
2. **Sem fluxo de consentimento no desktop:** não há comando Tauri/loopback para o Calendar (o do login só cobre ID token). A UI mostra o estado e "Sincronizar agora" quando conectado, mas **não oferece botão de conectar**.
3. **Sem agendamento:** a sincronização é sob demanda (`POST /google/sync`); não há job periódico, push notifications (`events.watch`) nem retomada parcial de uma rodada interrompida (reinicia a partir do último token gravado).
4. Só o calendário `primary`. Sem convidados, recorrência editável, lembretes, anexos nem conferência. Espelho de recorrentes vem expandido (`singleEvents`).
5. Sincronizações concorrentes do mesmo proprietário são idempotentes, mas sem trava (último a gravar o cursor vence).
6. Sem exportação/restauração dos eventos (RF-04) e sem retenção definida para backup.

## Erros

Envelope e `requestId` como em [`api.md`](api.md). Códigos próprios da agenda:

| Status | `code` | Quando |
|---|---|---|
| `409` | `CONFLICT` | `version` divergente; `id` de criação já existe com conteúdo diferente |
| `409` | `READ_ONLY_EVENT` | edição/exclusão de espelho do Google |
| `409` | `REFLECTION_ACTIVE` | excluir evento que tem cópia no Google |
| `409` | `INTEGRATION_NOT_CONFIGURED` / `INTEGRATION_NOT_CONNECTED` / `REAUTH_REQUIRED` / `SCOPE_NOT_GRANTED` | estado da integração |
| `409` | `REFLECTION_NOT_ENABLED` | enviar ao Google sem modo `reflect` |
| `409` | `GOOGLE_CONFLICT` / `GOOGLE_EVENT_MISSING` | ETag divergente / evento sumiu no Google |
| `429` | `RATE_LIMITED` | limite do Google esgotou as tentativas ou exige espera acima da janela interna |
| `502` | `UPSTREAM_UNAVAILABLE` / `UPSTREAM_REJECTED` / `SYNC_TOO_LARGE` / `SYNC_INCOMPLETE` | falha do provedor ou sincronização incompleta |

## Cliente web (cache e outbox offline)

`apps/web/src/calendar/`. Rota `#/agendas` (`#/events` redireciona). Modos dia/semana/mês/ano; o planner prioriza a lista **Próximos eventos** (30 dias) e o cronograma de blocos (dia/semana).

- **Persistência por conta antes do HTTP:** IndexedDB `miupy-calendar` (`events`, `outbox`, `meta`), chaves `[ownerId, …]` com `ownerId` = `sub` do ID token (como os rascunhos de notas). Toda criação/edição/exclusão grava primeiro a intenção no dispositivo (`enqueue`) e só então tenta enviar. Se a gravação local falhar, o formulário continua aberto com os dados.
- **Um envio por evento, fundido:** editar uma criação pendente continua criação; excluir uma criação pendente cancela sem rede; `rev` impede que a confirmação de uma versão apague uma edição mais nova.
- **Retry:** erro de rede/5xx/429 mantém o envio com backoff (2 s, 4 s, … teto 60 s somente para o backoff do app; `Retry-After` é piso sem truncamento, inclusive após edição durante envio e ao tentar manualmente); rede indisponível encerra a rodada. Dispara ao abrir, ao voltar online, a cada 15 s com pendências e por "Tentar agora". `401` interrompe sem marcar o envio.
- **Reconciliação:** `409`/`404` → o motor lê o servidor: conteúdo igual ⇒ já enviado (conclui); diferente ⇒ **conflito visível** com cópia do servidor; exclusão 404 ⇒ concluída. `400` ⇒ "recusado" (rascunho preservado). Resolução: "Manter o meu" (reenvia sobre a versão do servidor; evento removido lá é recriado com o mesmo ID), "Usar o do servidor" (descarta o rascunho) ou descartar.
- **Texto honesto:** pendências aparecem como "salva(s) só neste dispositivo, aguardando envio"; "Em dia com o servidor" só após uma leitura/envio bem-sucedidos. Sem conexão, mostra o cache e a hora da última atualização.
- **Limite conhecido:** sair da conta não avisa sobre alterações da agenda ainda não enviadas (o aviso de `signOut` cobre só rascunhos de notas; `auth.ts` não é desta frente). Elas permanecem no IndexedDB da conta e são enviadas no próximo login do mesmo proprietário. Sem criptografia local da aplicação nem coordenação entre janelas.

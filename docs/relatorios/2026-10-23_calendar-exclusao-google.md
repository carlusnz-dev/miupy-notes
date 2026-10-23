# Calendar — exclusão no Google e estado local (2026-10-23)

Hot-fix na worktree `fix-calendar-google-deletion`, branch `fix/calendar-google-deletion` a partir de develop (`fcaf49c`). Escopo: módulo calendar (API + cliente/UI web). Fora do diff: arquivos OAuth (`google-oauth`, `local-google`, credential stores), conforme o PR #22 em paralelo; UI mínima por causa de `feat/design-ux-refresh`.

## Bug

Relato do proprietário: ao excluir no Google um evento espelhado/refletido, a sincronização gera conflito; excluir o evento local não o remove. Reproduzido com fake do cliente Google (testes novos falhavam no código anterior). Caminhos observados no código anterior (`apps/api/src/modules/calendar/services/google-integration.service.impl.ts`):

- `apply` (l. 329-334) e `refreshOwnEtag` (l. 348-355): item `cancelled` de uma cópia enviada pelo app (o Google garante só `id` nos cancelados) não era ligado ao evento local; nada mudava e o vínculo ficava com ETag velho.
- `reflect` (l. 139-147) e `translate` (l. 377): salvar esse evento fazia PATCH na cópia inexistente; `404` virava `409 GOOGLE_EVENT_MISSING`. O PATCH local já tinha sido gravado (versão avançada), então no cliente `classify` (`apps/web/src/calendar/outbox.ts` l. 160-170) abria um **conflito** com a cópia do servidor.
- `deleteReflected` (l. 176-177) e `deleteMirror` (l. 222-223): só `404`/`410` eram toleráveis; um `412` do DELETE (ETag velho de uma cópia já excluída) virava `GOOGLE_CONFLICT` e o item local nunca saía (testado com fake: `precondition_failed` falhava). `unreflect` (l. 157-161) tolerava só `404`: `410` virava `UPSTREAM_REJECTED`.
- `updateMirror` (l. 202-205): espelho já excluído no Google dava `GOOGLE_EVENT_MISSING` sem saída.
- Cliente: `enqueue` de exclusão sobre um envio em conflito reaproveita `baseVersion` velha (l. 69), então o DELETE respondia `409 CONFLICT` de versão e o item seguia preso em "Conflito". Com a API não gerando mais o conflito inicial isso deixa de ser disparado por este caminho; o próprio reuso de `baseVersion` velha **não foi alterado**.

## Mudanças

- `Reflection.state` (`linked` | `deleted_remote`, padrão `linked` ao ler itens antigos do DynamoDB) e `reflection.state` na resposta; `inSync` é falso em `deleted_remote`. Contrato em `docs/arquitetura/api-calendar.md`.
- Sincronização: cancelado → acha o evento local pelo ID derivado (`eventIdFromGoogle`) e marca `deleted_remote` sem mudar versão/`updatedAt`; conta em `deleted`.
- `reflect` (salvar): `404`/`410` marca `deleted_remote` e devolve o evento; em `deleted_remote` devolve o evento sem chamar o Google.
- Exclusão/desvínculo: em `deleted_remote` não chama o Google nem exige conexão; senão `deleteRemote` trata `404`/`410` e `412` com cópia ausente/cancelada como removida (`412` com cópia viva segue `GOOGLE_CONFLICT`). Vale para `deleteReflected`, `deleteMirror` e `unreflect`.
- `updateMirror` com `404`/`410`: remove o espelho local e responde `404 NOT_FOUND`.
- Web: tag "Excluído no Google" em `UpcomingList`; em `EventForm`, bloco "Excluído no Google" com "Manter só neste app" (desvincula) além de Excluir.
- Fake do Google: `remove(id, { idOnly })` imita cancelado só com `id`.

## Verificação

| Comando | Resultado |
|---|---|
| Testes novos (serviço) contra o código anterior | falharam: estado `undefined`, `deleted` 0, `GOOGLE_EVENT_MISSING`, `GOOGLE_CONFLICT`, `UPSTREAM_REJECTED`, chamadas ao Google em item `deleted_remote` |
| `env -u DYNAMODB_TEST_ENDPOINT -u DYNAMODB_FINANCE_TEST_ENDPOINT npm run test:api` | 193 testes: 184 aprovados, 0 falhas, 9 ignorados (DynamoDB Local não configurado) |
| `npm run test:web` | 160/160 aprovados |
| `npm run build` (web + api) | aprovado; aviso conhecido de chunk >500 kB |
| `npm run check:modules` | 4 módulos válidos |
| `npm exec --workspace @miupy-notes/web -- tsc --noEmit` | aprovado |

## Não verificado / pendências

- Nenhuma conta Google real: o comportamento real do `412` em DELETE de evento excluído e de `events.get` em cancelados vem dos fakes e da documentação, não de prova com o provedor.
- Interface não foi aberta no navegador/Tauri (exige login Google); a tag e o botão foram verificados só por build/tipos.
- Persistência DynamoDB do novo campo não foi exercitada (DynamoDB Local ausente); o schema usa `default("linked")`.
- Não há UI de ação "reenviar ao Google" para `deleted_remote`: é preciso desvincular antes; reenvio com o mesmo ID não foi testado no Google.
- `enqueue` de exclusão sobre envio em conflito ainda usa `baseVersion` velha (descrito acima).
- `arquitetura.json` não alterado: o estado geral (sem implantação AWS/conta real) permanece.

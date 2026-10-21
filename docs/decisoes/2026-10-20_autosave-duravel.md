# Autosave durável (sessão 07)

Data: 2026-10-20. Escopo: `apps/web/src/lib/notes-*`, editor, auth.

## Decisões

- **Armazenamento local:** IndexedDB do WebView (`notes-draft-store-idb.ts`) atrás da interface assíncrona `DraftStore` (`put/get/listByOwner/remove/clearOwner`). Sem dependência nova. SQLite via plugin Tauri foi avaliado e adiado: exigiria crate, capability e permissões novas sem ganho para um registro por nota. `localStorage` não é usado. Sem IndexedDB, o store "indisponível" faz toda escrita falhar e a tela mostra *Falha ao proteger localmente* (nunca um substituto silencioso).
- **Proteção:** **não há criptografia da aplicação.** Os rascunhos ficam em texto no perfil do WebView do usuário do sistema, protegidos só pelas permissões do SO. Tokens nunca vão ao store. Chave via chaveiro (já usado pelo Rust) fica como evolução.
- **Isolamento:** chave `[ownerId, noteId]`, `ownerId` = `sub` do ID token. A fila só carrega rascunhos da conta ativa; outra conta nunca os lê nem envia.
- **Registro:** snapshot completo (`title`, `body`, `tags`), `eol`, `base` (nota completa da versão base), `revision` local. Cada escrita nova recebe `writeId` único. Gravação e ACK comparam atomicamente `writeId` e revisão esperados; o ACK também exige revisão ≤ à confirmada. Colisão mantém os snapshots e bloqueia o PATCH da edição sem proteção, com erro local recuperável; registros legados sem `writeId` são aceitos na migração.
- **Scheduler único** (`notes-scheduler.ts`), fora do React: pausa 1800 ms, teto 20 s desde a primeira edição não enviada, 1 PATCH global (configurável), 1 por nota, ordem pelo `dueAt` mais antigo (sem starvation). O editor só chama `notesSaver.edit` a cada alteração.
- **Falhas:** 429/5xx/408/rede → backoff exponencial (2 s a 5 min) com jitter, `Retry-After` como piso e `retryNow` ao voltar a conexão. 5xx/rede/timeout são ambíguos e releem o servidor antes de reenviar (mesmo texto: adota; só metadado mudou: reenvia sobre a versão nova; outro texto: conflito). 409: sem replay, texto preservado, resolução explícita (`reset`). 400/422: espera correção do texto. Outros 4xx: parado até "Salvar".
- **Sessão:** 401 pausa (rascunhos ficam; resposta em voo é ignorada e reconciliada depois); a mesma conta retoma sozinha. Logout explícito limpa os rascunhos da conta, com confirmação (`SignOutButton`) se houver notas não sincronizadas. Exclusão: `hold`, DELETE, `discard`; respostas tardias não recriam a nota.
- **Contrato HTTP:** inalterado (PATCH com `version`). `ApiError` ganhou `retryAfterMs` opcional e erros sem corpo do contrato mantêm o `status`.

## Invariantes após a revisão (follow-up)

- **Gravação local antes de tudo:** nenhum PATCH sai sem a escrita local da revisão atual confirmada. Falha local = `local-failed`, sem envio, com retry (backoff) do próprio `put`. `local` só existe depois do `put`; antes é `protecting`.
- **`synced` só após a limpeza local:** o PATCH confirmado marca a revisão como `confirmed`, mas o texto só sai da memória e a nota só fica `synced` quando o `remove(≤ revisão)` é gravado. Falha da limpeza = `local-failed` (`cleanup`), repetida sem reenviar o PATCH; `protect()` devolve `false`.
- **Revisão futura nunca é apagada:** `remove` só apaga registros de revisão ≤ à confirmada; voltar ao texto da base (noop) usa o mesmo caminho.
- **Leitura local com erro não é engolida:** `attach` rejeita com `LOCAL_READ_FAILED` e a tela não edita; há "Tentar de novo" e a decisão explícita "Abrir sem o rascunho local". `restoreError()`/`retryRestore()` cobrem a leitura geral.
- **Geração de sessão:** toda operação assíncrona (attach, restauração, envio, escrita) confere a geração e a entrada ao voltar, não só o dono. `notes-session` troca a geração e suspende/fecha a fila de forma síncrona ao receber o estado de auth, antes de ler o dono.
- **Logout:** `signOut()` (lib/auth.ts) é o guard central: com notas não sincronizadas (ou sem poder verificar) devolve `needs-confirmation`; só `discardDrafts: true` as descarta. Falha na limpeza local é devolvida (`draftsPurged: false`, `window.alert` no botão), bloqueia a restauração dessa conta e é repetida no próximo login durante a mesma execução, antes de ler qualquer rascunho. Desde a revisão de 2026-10-21, o adaptador IndexedDB confirma a intenção num journal antes de remover; replay ocorre antes de ler/listar rascunhos. Se a própria gravação da intenção falhar, ela continua apenas na memória e o rascunho pode reaparecer após reinício. A exclusão de nota e o `reset` também devolvem `false` quando o registro local não pôde ser removido (a exclusão é repetida na próxima sessão da mesma execução; o editor mostra aviso).
- **IndexedDB:** leituras observam request e transação juntos (aborto após sucesso rejeita); `finished` nunca fica sem tratador; escritas pedem `durability: "strict"` (ignorado por WebViews que não conhecem a opção, então não há garantia contra queda de energia do SO).
- **`Retry-After`:** é piso sem o teto do backoff (até 24 h); nem `online` (`retryNow`) nem "Salvar" o antecipam.

## Limites

`Retry-After` só chega ao app se a API o expuser por CORS (`Access-Control-Expose-Headers`). Não há medição de requisições com/sem scheduler.
A fila mantém pendências em memória, e o IndexedDB v2 guarda intenções confirmadas de logout/exclusão no journal. Remoção de rascunhos e da intenção ocorre na mesma transação; aborto mantém ambos para replay. Indisponibilidade que impede gravar a intenção ainda impede garantir o descarte após reinício. O aviso de limpeza falha no logout é um `window.alert`. Não há teste automatizado da camada React (`auth.ts` e o editor dependem do Vite/Tauri); o guard foi extraído em `signOutNeedsConfirmation` (testado) e o restante verificado por tipos e build.

## Avaliação final (sessão 08)

Provas locais com store compartilhado confirmaram a perda da intenção de purge depois de recriar a fila e colisões de revisão entre duas filas: o ACK de uma pode remover a proteção local da outra. Estes limites não foram resolvidos nesta entrega; avisos de falha de limpeza foram corrigidos e o aceite distingue uma fila por perfil de múltiplas janelas. WebKit/Tauri e encerramento forçado nativo permanecem pendentes. MCP Chromium repetido após os fixes validou React/IndexedDB reais com API e Tauri sintéticos; web 106/106 e API 74/74 aprovados. Ver [aceite consolidado](../requisitos/aceite-notas-api-web.md).


## Revisão de 2026-10-21

- CAS local implementado em uma transação de leitura/escrita, sem lock, lease ou merge automático. `null` exige registro ausente; revisão + `writeId` exigem aquela escrita exata. A fila sempre passa a expectativa, inclusive no ACK. Colisão aparece como `LOCAL_DRAFT_CONFLICT`, conserva texto na memória e pede preservá-lo antes de recarregar; retry pode voltar a proteger se o outro registro for removido. O PATCH remoto continua condicional por `version`.
- IndexedDB v2 preserva o store `drafts` v1 e acrescenta `cleanups`, isolado por proprietário/nota. Purge/discard confirma primeiro a intenção sem conteúdo; nova instância repete a limpeza antes de restaurar. Se a remoção abortar, a intenção permanece. Migração bloqueada por janela antiga falha explicitamente; requer fechar a janela antiga.
- Regressões sintéticas usam `fake-indexeddb` apenas como dependência de desenvolvimento: duas filas, colisão de revisão, ACK tardio, migração, aborto da remoção, replay com nova fila e falha da gravação da intenção. Não simulam persistência física, queda de energia ou crash nativo.
- **Limite mantido:** CAS evita sobrescrita cega e ACK de outra escrita; não coordena as memórias de várias janelas. Duas filas que restauraram o mesmo snapshot podem divergir e a primeira não recebe notificação de substituição local. Descarte global entre janelas, merge e recuperação das duas versões não foram implementados. Uso validado continua pressupondo uma fila ativa por perfil; WebKit/Tauri e encerramento forçado real continuam pendentes.

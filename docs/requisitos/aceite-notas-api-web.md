# Aceite de notas — API e cache web (sessão 07)

Referências: RF-01, RF-02, RF-03, RF-10, RNF-02, RNF-05 e RNF-06. Consolidação final em 2026-10-20: API 74/74 com DynamoDB Local sintético, web 106/106, build completo e check de três módulos aprovados. MCP Chromium com React/IndexedDB reais e API/Tauri sintéticos repetido depois dos três fixes finais. Sem AWS, login pessoal ou validação nativa WebKit/Tauri.

| ID | Critério | Evidência executada | Estado |
|---|---|---|---|
| API-META-01 | Navegação lê metadados sem corpo; projeção mantém ID, datas, tags, pasta e versão, com cursor e dono preservados. | Teste homônimo em `apps/api/src/modules/notes/repository/dynamo-notes.repository.test.ts`; aliases, legado e cursor. `persistence.integration.test.ts` exercita parser real da projeção. | Aprovado em cliente falso e DynamoDB Local. |
| API-HTTP-01 | Endpoint metadata pagina sem perda/repetição, sem body/ownerId; lista antiga conserva corpo; principal obrigatório e query estrita. | Teste homônimo em `apps/api/src/modules/notes/routes/notes.routes.test.ts`. | Aprovado em HTTP local sintético. |
| API-SUM-01 | Resumo agrega todas as páginas do proprietário, palavras Markdown/UTF-16/tags e janela no offset declarado, sem corpos na saída. | Teste homônimo em `apps/api/src/modules/notes/services/notes-summary.test.ts`: 105 notas, duas páginas e outro dono. | Aprovado. |
| API-SUM-02 | Acervo vazio retorna zeros, dias zerados e datas nulas. | Teste homônimo em `notes-summary.test.ts`. | Aprovado. |
| API-SUM-03 | Resumo não corta em cinquenta páginas/cinco mil notas. | Teste homônimo em `notes-summary.test.ts`: repository falso com 51 páginas e 5.100 notas; total e palavras 5.100. | Aprovado, sem benchmark de custo/latência. |
| API-HTTP-02 | Summary valida dias/offset/query/owner, exige principal e reflete PATCH/exclusão no repository de teste. | Teste homônimo em `notes.routes.test.ts`. | Aprovado; DynamoDB mantém consistência eventual das Queries. |
| API-DETAIL-01 | Detalhe usa leitura consistente para reconciliar PATCH ambíguo. | Teste homônimo em `dynamo-notes.repository.test.ts`: `ConsistentRead: true` e chave do dono. | Aprovado com cliente falso. |
| API-CONC-01 | Dois PATCH na mesma versão resultam em um sucesso e um 409; corpo final tem versão +1. | HTTP/memória e `persistence.integration.test.ts`: PATCH concorrentes 200/409, detalhe com versão 2 e corpo vencedor. | Aprovado também em DynamoDB Local. |
| CACHE-01 | Confirmação de PATCH atualiza detalhe e metadados conhecidos; preserva páginas/cursor/pageParams/truncamento e não refaz coleção ativa. | `apps/web/src/lib/notes-queries.test.ts`, QueryClient/QueryObserver reais: 0 leituras da coleção, 1 atualização do resumo ativo. | Aprovado. |
| CACHE-02 | Move com base conhecida não refaz métricas; nota desconhecida não é inserida em página carregada. | Teste homônimo em `notes-queries.test.ts`. | Aprovado; listas atuais não têm filtros e ordenam por ID. |
| CACHE-03 | Create/delete invalidam coleção; confirmação mais antiga ou posterior à exclusão não restaura detalhe. | Teste homônimo em `notes-queries.test.ts`. | Aprovado. |
| WEB-META-01 | Árvore e destinos trabalham apenas com NoteMetadataOutput; detalhe é buscado ao abrir editor; Home/Perfil usam summary. | Build e testes de árvore/métricas; MCP em 1440/390 confirma navegação sem GET da coleção completa. | Aprovado no Chromium sintético. |

## Aceite integrado do autosave

| ID | Critério | Evidência | Estado |
|---|---|---|---|
| SAVE-01 | Cada edição, inclusive inválida, é protegida antes de PATCH; falha local impede envio e fica visível. | `notes-autosave.test.ts`, `notes-draft-store-idb.test.ts` e MCP com quota injetada, zero PATCH até recuperação. | Aprovado. |
| SAVE-02 | Snapshot e EOL sobrevivem a reload; resultado remoto ambíguo é reconciliado antes de reenviar. | Testes de reload/crash/timeout e MCP recuperando título do IndexedDB após reload, depois sincronizando. | Aprovado no Chromium; encerramento nativo forçado pendente. |
| SAVE-03 | Cem edições coalescem; debounce 1800 ms, teto 20 s, concorrência global 1 e equidade. | Testes de fila e scheduler com relógio falso. | Aprovado sem benchmark real. |
| SAVE-04 | Backoff e Retry-After são respeitados por online, salvar e retry local. | Testes da fila/scheduler e REV-06: proteção local se recupera antes do piso, sem leitura/PATCH antecipados. | Aprovado; Retry-After limitado a 24 h. |
| SAVE-05 | 401 pausa; 409 conserva texto sem replay; confirmação antiga não apaga revisão nova. | Testes de fila, sessão e remoção condicional. | Aprovado para uma fila por perfil. |
| SAVE-06 | Troca de conta invalida attach/ready/get e callbacks antigos; login duplicado não perde a abertura. | Testes de sessão e regressões REV-07/REV-08. | Aprovado. |
| SAVE-07 | Logout pede confirmação para pendências; limpeza falha é informada; exclusão espera PATCH em voo. | Testes de fila/sessão; MCP com título inválido, cancelar logout e confirmar descarte, IndexedDB vazio. | Aprovado na mesma execução; ressalva de reinício abaixo. |
| SAVE-08 | Não anuncia sincronização antes de confirmar limpeza local; aborto de transação rejeita leitura. | Testes de fila e adaptador IDB; MCP observa estado sincronizado após recuperação. | Aprovado em testes falsos e Chromium; WebKit pendente. |

## Fronteira com autosave e limites

- Cache escreve bases remotas, nunca o DraftStore ou texto pendente do editor. A proteção de revisão local, troca de sessão e exclusão durante PATCH deve ser demonstrada pelos testes da fila/editor da frente de autosave; este documento não os declara aprovados.
- O callback `onSaved` precisa checar sessão e validade da nota antes de chamar `cacheSavedNote`. Tombstone de exclusão e comparação de versão no cache são defesa complementar. Não constituem autorização nem substituem a fila.
- O detalhe consistente reduz ambiguidade da leitura; uma gravação posterior continua possível e o versionamento condicional permanece necessário. Queries de coleção/resumo são eventualmente consistentes, sem snapshot entre páginas.
- **Limpeza após reinício:** pendências de purge/discard existem apenas em memória. Prova com nova fila e mesmo store confirmou restauração do rascunho após purge falhar, apesar do descarte escolhido. Avisos de logout/exclusão agora declaram esse limite. Não há garantia de descarte durável quando a limpeza falha.
- **Múltiplas janelas:** sem lock ou revisão global. Prova com duas filas e store compartilhado confirmou colisão de revisão 1: a confirmação de uma remove o snapshot protegido pela outra. Versionamento remoto não protege esse registro local. Bloqueante para prometer durabilidade com várias janelas; usar uma janela por perfil até coordenação própria.
- **Nativo:** WebKitGTK/Tauri, login real nesta rodada, encerramento forçado e queda de energia não foram verificados. `durability: strict` é pedido ao navegador, sem garantia universal de flush físico. Sem criptografia própria; isolamento por conta na aplicação não é proteção contra acesso ao perfil pelo usuário do SO.
- Summary percorre corpos no DynamoDB; custo/latência e acervos grandes não medidos. Corpo remoto permanece no DynamoDB, sem S3. Nenhuma chamada AWS ou infraestrutura executada.

## Checkpoint integrado no encerramento

Repetição final após REV-06/07/08: web 106/106, API 74/74 sem ignorados, build e check de módulos aprovados; MCP Chromium passou novamente em 1440/390. Os critérios aprovados não cobrem os limites de reinício com limpeza falha, múltiplas janelas ou WebKit. Evidências e publicação em [sessão 08](../relatorios/2026-10-20_sessao-08.md); histórico em [sessão 07](../relatorios/2026-10-20_sessao-07.md).

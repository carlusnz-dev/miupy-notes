# Sessão 07 — revisão dirigida do autosave

## Escopo e estado

Revisão inicial somente leitura de `notes-autosave.ts`, `notes-draft-store*.ts`, `notes-scheduler.ts`, `notes-session.ts`, `notes-saver.ts`, `notes-autosave-status.ts`, `auth.ts`, `NoteEditorPage.tsx` e testes diretamente relacionados. Plano e skills locais consultados. Após o encerramento dessa revisão e a liberação da frente Sonnet, o coordenador transferiu ownership da fila/binding/testes para esta frente corrigir somente os três bloqueantes restantes; o fechamento dessa rodada está no fim do relatório.

**Estado após os fixes mínimos: os três bloqueantes comprovados foram corrigidos e receberam regressões duráveis.** As três regressões falharam antes do patch e passaram depois; suíte dirigida 62/62, provas adicionais 10/10, quatro cenários IndexedDB falsos aprovados e build web aprovado. Os sete invariantes já seguros continuam passando. A validação integrada final de navegador e suíte global fica com o coordenador. Os checkpoints anteriores abaixo registram os problemas reais e as correções intermediárias, sem apagar o histórico de falhas.

As seções de WIP abaixo preservam a linha de base e distinguem problemas iniciais de correções verificadas. Elas não representam pendências atuais quando a seção final as marca corrigidas.

## Achados novos reproduzidos no WIP

| ID / severidade | Local e cenário | Evidência inicial | Correção sugerida |
|---|---|---|---|
| REV-01 / P1 | `notes-session.ts`, `handle`/`onAuthState`: signed-out chega enquanto getOwnerId está pendente; epoch só muda quando o próximo handle serializado começa. | Binding com getOwnerId deferred abriu old-owner **depois** de receber logout, depois fechou; eventos `open:old-owner`, `close`. Restaurar/envios nesse intervalo não devem ocorrer. | Invalidar geração no recebimento do evento e suspender envios imediatamente; verificar geração depois de cada await. |
| REV-02 / P1 | `notes-autosave.ts`, `persist`/`clean`: put rev1 pendente, usuário retorna à base na rev2, put1 termina e limpeza remove condicionalmente rev2 que nunca foi gravada. | Memória termina snapshot=null/synced, mas store conserva rev1 com `undo-this`; reload pode restaurar texto desfeito. | Serializar limpeza com a revisão realmente durável, preservando qualquer revisão nova. |
| REV-03 / P1 | `notes-autosave.ts`, restauração em openSession/attach engole falhas de listByOwner/get. | Store já possuía `unsynced-recoverable`; leitura falhou; attach devolveu restored=null e primeira edição substituiu o registro por `new-edit`. | Propagar erro de restauração e impedir sobrescrever registro desconhecido antes de recuperação ou decisão explícita. |
| REV-04 / P1 | `notes-autosave.ts`, attach verifica somente owner depois do await get. | get(u1) pendente; closeSession(purge:true); reabrir u1; resolver get antigo: o snapshot `explicitly-purged` reapareceu e foi enviado ao servidor falso. | Capturar e conferir a geração da sessão, além do owner, antes de qualquer aplicação de resultado assíncrono. |
| REV-05 / P2 | `notes-saver.ts` bootstrap + `NoteEditorPage.tsx` attach: editor não espera sessionIdle. | Com getOwnerId deferred, attach rejeita UNAUTHORIZED antes de openSession; editor engole rejeição e pode continuar no skeleton com detalhe cacheado sem outra mudança de dependência. Rejeição reproduzida; permanência visual inferida do effect, sem MCP nesta frente. | Esperar binding pronta com cancelamento por sessão e apresentar erro de inicialização/restauração. |
| REV-06 / P2 | `notes-scheduler.ts`, backoffDelay limita Retry-After ao cap próprio; retryNow também zera cooldown de 429. | `backoffDelay(1, 600000, { random: () => 1 })` devolveu 300000. | Limitar somente backoff próprio e preservar Retry-After como piso; online não deve antecipar limite de 429. |

## Achados previamente comunicados pelo coordenador

Não foram apresentados como descobertas novas: timer de zero quando concorrência global está cheia; envio apesar de put falhar; indicação de proteção local antes de commit; synced antes de confirmação local/remove; purge/discard engolindo erro.

A prova adicional de ACK-FAIL confirmou o cenário já conhecido: store.remove rejeita depois de PATCH confirmado; view.status=synced, snapshot=null, protect=true e unsyncedCount=0, embora store ainda guarde o registro antigo. Esta é somente a linha de base para rever a correção.

## Comandos e provas iniciais

- `npx tsx /tmp/miupy-review-p0.ts`: exit 0, confirmou REV-01, REV-02 e REV-03 com assertions sobre binding/store reais da fila e fakes determinísticos.
- `npx tsx /tmp/miupy-review-session-attach.ts`: exit 0, confirmou rejeição inicial do attach (REV-05) e restauração/envio após purge com resultado tardio (REV-04).
- Chamada dirigida via `npx tsx -e` a backoffDelay: observou 300000 para Retry-After 600000 (REV-06).
- `npx tsx /tmp/miupy-review-ack.ts`: exit 0, registrou estado inseguro de confirmação local, já conhecido pelo coordenador.

Os scripts temporários são provas exploratórias e não fazem parte do Git. Os cenários e resultados acima permitem recriá-los; a correção deve ter cobertura durável nos testes de propriedade da frente de implementação.

## Pendências da revisão final

Aguardar checkpoint pronto de Sonnet, reler somente os trechos corrigidos, repetir provas com expectativas de segurança e executar testes relacionados disponíveis. Conferir especificamente edição durante escrita/PATCH, confirmação local que falha, geração de sessão/restauração, logout/delete e proteção após falha de persistência. Sem AWS, dados pessoais, infraestrutura ou validação visual nesta frente.

## Segundo checkpoint — suíte disponível, correções parciais

O envio ao dispatch Sonnet original passou a ser rejeitado pelo Orca com estado `completed`, sem aviso de pronto recebido nesta mailbox. O coordenador foi informado e a revisão prosseguiu sobre os arquivos disponíveis, sem presumir que todas as correções já estavam finalizadas.

- `npx tsx --test apps/web/src/lib/notes-autosave.test.ts apps/web/src/lib/notes-session.test.ts apps/web/src/lib/notes-scheduler.test.ts`: **42 aprovados**, zero falhas. A aprovação não cobre os cenários de falha descritos aqui: testes ainda esperavam envio após put falhar e Retry-After de dez minutos reduzido a cinco.
- REV-02 corrigido parcialmente na fronteira de armazenamento: `remove(..., upToRevision)` agora remove revisão menor ou igual ao limite tanto em memória quanto em IndexedDB. A prova adaptada confirmou que retornar à base durante put antigo remove o registro obsoleto. Não foi validado IndexedDB real.
- Timer zero sob limite de concorrência cheio, achado prévio do coordenador, recebeu guard `running.size >= maxConcurrent` no scheduler. Testes de concorrência global disponíveis passaram.
- REV-01 e REV-03 **ainda reproduzidos** por `npx tsx /tmp/miupy-review-current.ts` (exit 0; REV-02 agora verifica registro nulo em vez de esperar o bug antigo).
- REV-04 **ainda reproduzido** por `npx tsx /tmp/miupy-review-session-current.ts` (exit 0): a restauração passou a scheduler.edit em vez de at(0); avançar 2.000 ms ainda envia o snapshot obtido pelo get da sessão anterior. REV-05 continua rejeitando attach antes de bootstrap pronto.

As primeiras repetições dos scripts originais terminaram exit 1 porque esperavam os sintomas antigos: REV-02 foi corrigido e REV-04 agora aguarda debounce. Isso não foi apresentado como falha da suíte; os scripts foram adaptados somente em /tmp e repetidos conforme descrito acima.

## Preparação da rodada de correção

O coordenador abriu um segundo dispatch Sonnet para corrigir os bloqueantes. A revisão permanece aberta até o checkpoint dessa rodada. Foram preparados, sem editar o repositório, `/tmp/miupy-review-safety.test.ts` (sete expectativas de segurança) e `/tmp/miupy-review-idb.ts` (get/listByOwner com success+abort e error+abort), comunicados ao implementador para reprodução. Esses arquivos ainda aguardavam execução após o aviso de pronto neste checkpoint.

O problema de `finished` sem tratamento nas leituras IndexedDB foi comunicado previamente pelo coordenador, não é achado novo desta revisão. A validação final deve observar simultaneamente request e fim da transação para não criar rejeição sem handler quando o próprio request falha. Coordenação entre abas ou múltiplas janelas não foi implementada nem validada nesta frente; os guards por revisão pressupõem uma fila por perfil.

## Achados na correção parcial, ainda WIP

- **REV-07 / P1 — attach segue uma nova sessão durante ready.** O novo do/while do attach atualiza o token ao detectar mudança, em vez de rejeitar. Prova: listByOwner(u1) pendente, attach de loadedA com body `private-A`, abrir u2, resolver leitura antiga; attach devolve `private-A` e insere a base de A na fila cujo owner agora é u2. `/tmp/miupy-review-session-round2.ts` confirmou. Deve capturar a geração original antes do primeiro await e rejeitar qualquer troca.
- **REV-08 / P2 — notificação signed-in duplicada invalida abertura pendente.** O novo binding incrementa epoch antes do early return active; uma notificação signed-in recebida durante getOwnerId invalida o único opener sem criar outro. A mesma prova mostrou zero aberturas depois de resolver owner. Ignorar a duplicata antes de avançar geração ou reabrir com guard coerente.
- **REV-06 / P2 — retry local ainda antecipa cooldown remoto.** Após 429 com Retry-After 600000, nova edição com falha temporária de put agenda retryStore em 2000; at substitui o piso e run envia após recuperação local sem checar floorUntil. `/tmp/miupy-review-retry-store.ts` observou PATCHs em 1800 e 3800 ms. Necessário preservar o piso também nessa combinação; não basta corrigir backoffDelay/online/flush.

Os três cenários foram comunicados ao coordenador e ao segundo dispatch Sonnet. Foram acrescentadas expectativas seguras aos testes temporários, que agora têm dez casos; continuam aguardando checkpoint final para execução.


## Resultado final verificado após a segunda entrega Sonnet

### Bloqueantes restantes

| ID / severidade | Arquivo/linha na revisão final | Cenário reproduzido | Correção mínima sugerida |
|---|---|---|---|
| REV-07 / P1 | `apps/web/src/lib/notes-autosave.ts:540` | attach começa aguardando ready da conta A; abre B antes de A terminar; do/while troca o token para B, retorna a nota privada carregada por A e a insere na fila B. | Fixar geração antes do primeiro await; se ela mudar, rejeitar e não aplicar loaded antigo. |
| REV-08 / P2 | `apps/web/src/lib/notes-session.ts:23` | Duas notificações signed-in durante leitura pendente de owner: a segunda incrementa epoch, retorna porque active=true, e invalida a única abertura; zero sessões abertas. | Retornar em duplicata signed-in antes de invalidar geração, preservando mudanças reais de identidade/saída. |
| REV-06 / P2, combinação | `apps/web/src/lib/notes-autosave.ts:268` e `:350` | PATCH 429 com Retry-After 600000; nova edição falha em put; retryStore agenda 2s, store recupera e run faz PATCH antes do piso. A prova observou duas chamadas onde só a primeira era permitida. | Após assegurar persistência local, conferir floorUntil antes de leitura/PATCH; reagendar envio para o piso sem bloquear retry da proteção local. |

### Correções conferidas

- REV-01: resultado tardio do owner após logout não abre mais a sessão antiga; prova de segurança passou.
- REV-02: retornar à base durante put antigo limpa o registro obsoleto; prova de segurança passou.
- REV-03: falha de restauração impede sobrescrever rascunho desconhecido; prova passou. Editor tem erro explícito, retry e escolha `ignoreLocal`, verificados por leitura do código.
- REV-04: resultado get de sessão purgada é rejeitado mesmo quando a mesma conta volta; prova passou. REV-07 é uma race diferente, no await anterior de ready.
- REV-05: editor passou a aguardar sessionIdle e mostrar erro de attach. Conferido no código e por teste de binding/whenIdle do repositório; sem validação visual própria.
- REV-06, caso simples: backoffDelay preserva Retry-After maior que o cap; prova passou. A combinação com retry local continua falhando, conforme tabela.
- Achados prévios do coordenador: testes/provas confirmaram bloqueio de PATCH após put rejeitado, `protecting` antes do commit, estado sem `synced` quando remove de confirmação falha, erro de purge/discard informado e cobertura de retry de limpeza. Timer sob concorrência cheia recebeu guard e os testes dirigidos passaram.
- Leitura IndexedDB: quatro cenários falsos de get/listByOwner com request success+abort e request error+abort propagaram falha sem unhandledRejection. O código usa Promise.all para request/finished e handler defensivo para finished. Isso não substitui teste WebKit/IndexedDB real.

### Comandos finais executados

| Comando | Resultado |
|---|---|
| `npx tsx --test apps/web/src/lib/notes-autosave.test.ts apps/web/src/lib/notes-session.test.ts apps/web/src/lib/notes-scheduler.test.ts` | 59 aprovados, 0 falhas. |
| `npx tsx --test /tmp/miupy-review-safety.test.ts` | 10 testes: 7 aprovados, 3 falhas — REV-07, REV-08 e REV-06 retry local. Exit 1 esperado como evidência dos bloqueantes. |
| `npx tsx /tmp/miupy-review-idb.ts` | Quatro cenários aprovados; exit 0. |

Não executei build adicional, suíte global web, MCP, Tauri, AWS ou integração DynamoDB nesta revisão dirigida. Não há afirmação de criptografia própria ou coordenação entre múltiplas janelas. O arquivo de relatório é a única alteração deste dispatch; índice e integração central ficam com o coordenador.


## Fechamento — três fixes mínimos após transferência de ownership

Nenhuma reescrita da fila ou mudança de contrato. O patch ficou em `notes-autosave.ts`, `notes-session.ts` e novo `notes-autosave-regressions.test.ts`:

- **REV-07:** attach captura a geração antes de aguardar ready e rejeita se mudar. Não segue a conta seguinte nem instala loaded antigo na nova fila.
- **REV-08:** signed-in duplicado retorna a operação pendente antes de incrementar epoch; o único opener continua válido. Saída/expiração continuam invalidando a geração imediatamente.
- **REV-06 (combinação):** run primeiro tenta assegurar a proteção local, depois verifica floorUntil antes de read/PATCH. Retry local pode recuperar o snapshot durante o cooldown; o envio é reagendado para o piso remoto, sem antecipar a API.

As três regressões estão no repositório, não apenas em /tmp. O caso de 429 verifica também proteção local antes do piso, ausência de leitura/PATCH antecipados e envio do texto mais recente exatamente no piso.

| Comando nesta rodada | Resultado real |
|---|---|
| `npx tsx --test apps/web/src/lib/notes-autosave-regressions.test.ts` antes do patch | 0 aprovados, 3 falhas, reproduzindo os bloqueantes. |
| Mesmo comando depois do patch | 3 aprovados, 0 falhas. |
| `npx tsx --test /tmp/miupy-review-safety.test.ts` | 10 aprovados, 0 falhas; os sete invariantes anteriores permanecem seguros nas provas. |
| `npx tsx /tmp/miupy-review-idb.ts` | Quatro cenários aprovados, sem unhandledRejection. Adaptador não foi alterado nesta rodada. |
| `npx tsx --test apps/web/src/lib/notes-autosave.test.ts apps/web/src/lib/notes-autosave-regressions.test.ts apps/web/src/lib/notes-session.test.ts apps/web/src/lib/notes-scheduler.test.ts` | 62 aprovados, 0 falhas. |
| `npm run build:web` | Aprovado (TypeScript/Vite); permanece aviso do chunk do editor maior que 500 kB. |
| `git diff --check` nos arquivos desta rodada | Aprovado. |

Sem teste global web ou navegador adicional nesta rodada: o coordenador executará integração final após os fixes. Continuam os limites já declarados de WebKit/Tauri, múltiplas janelas, criptografia e pendências de limpeza não persistidas; estes fixes não alteram essas decisões. API, logger e infraestrutura não foram tocados.

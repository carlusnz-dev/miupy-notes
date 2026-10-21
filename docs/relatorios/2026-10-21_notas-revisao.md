# Revisão independente — logger e durabilidade das notas

Base: `5f06dbb` (`chore/readable-request-logs`). Entrega: `fix/notes-durability`, destinada a develop. Ownership restrito a notes-*, testes, decisão de autosave e este relatório; coordenador autorizou também `apps/web/package.json`/`package-lock.json` para fake-indexeddb de desenvolvimento. Outros workers mantêm Calendar/finanças em worktrees próprias.

## Revisão

PR #11 aprovado na revisão dirigida do diff de Logger/handler, request logger e testes: nenhum achado bloqueante; métodos/templates controlados, mensagens técnicas allowlist, sem conteúdo/identidade de requisição. Testes dirigidos 15/15. Aprovação comunicada cedo ao coordenador, que posteriormente integrou o PR (merge `1b12fc8` observado via gh). Nenhum merge executado nesta frente. Limites de notas permitem baseline pessoal explicitamente restrito a uma fila por perfil; não constituem aprovação de uma promessa de durabilidade multi-janela nem revisão integral do PR #9.

Notas: conferidos cache pontual/versionamento/tombstone, guarda de geração de sessão e callbacks, reconciliação após resultado ambíguo e PATCH DynamoDB condicional por versão/owner. Nenhuma mudança de contrato HTTP. A suíte mantém cobertura de cache, troca de conta, resposta tardia e reconciliação; revisão dirigida, sem auditoria exaustiva ou chamadas a contas reais.

## Correções

- `DraftStore.put` e ACK agora comparam atomicamente revisão + `writeId` esperado. Filas com revisão 1 diferente não sobrescrevem cegamente; ACK antigo não apaga outra escrita. Colisão preserva memória/snapshot do outro, informa conflito local e impede PATCH até a edição ser protegida. Retry pode recuperar quando o registro concorrente desaparece; recuperação manual exige preservar o texto antes de recarregar.
- IndexedDB v2 acrescenta journal sem apagar drafts v1. Purge/discard confirma a intenção antes de remover; replay precede leitura/restauração. Remoção e consumo da intenção são atômicos, portanto aborto permite repetir com nova fila/adaptador. Intenção não inclui corpo nem token.
- Testes transacionais com fake-indexeddb (apenas devDependency), incluindo migração de registro legado sem writeId/EOL, CAS simultâneo, ACK tardio, duas filas, restart sintético após aborto, isolamento e falha da própria intenção. Atualizada a decisão de autosave.

## Verificação executada

| Comando | Resultado |
|---|---|
| `npm ci` | Dependências instaladas; tentativa inicial dos testes do logger falhou por ausência de tsx antes da instalação. |
| `node --import tsx --test apps/api/src/core/logging/logger.test.ts apps/api/src/app.test.ts` | 15/15. |
| `npm run test:web` | Base 106/106; final 114/114, zero ignorados. |
| `node --import tsx --test apps/web/src/lib/notes-draft-store-transactions.test.ts` | 6/6. |
| `npm run build` | Web/API aprovados; aviso conhecido de chunk >500 kB. |
| `npm run check:modules` | 3 módulos válidos. |
| `npm run test:api` | 77 aprovados, 4 ignorados por endpoints DynamoDB Local não configurados, zero falhas. |
| `git diff --check` | Sem erros. |
| Graphify | Consulta AST existente de createAutosaveQueue; extração web `--code-only --no-cluster` em cache externo específico, 596 nós/1596 arestas, sem LLM/documentos processados. |

Logs temporários: `/tmp/notes-final-web.log`, `/tmp/notes-final-build.log`, `/tmp/notes-final-api.log`, `/tmp/notes-logger-review.log`, `/tmp/notes-graphify.log`. O cache Graphify ficou em `~/.cache/miupy-notes/graphify/notes-durability-web`, fora do Git. Uma primeira execução com os fakes antigos deixou testes aguardando callbacks incompatíveis com a migração v2; fixtures corrigidas e rodadas posteriores concluíram.

## Limites e integração

CAS evita sobrescrita cega/ACK alheio; não oferece lock/lease nem sincroniza memórias de janelas que restauraram o mesmo snapshot. Uma janela pode desconhecer a substituição local realizada por outra; continuam pendentes coordenação/merge e descarte global entre janelas. A garantia validada continua sendo uma fila ativa por perfil.

Se nem gravar a intenção for possível, não há garantia de descarte após reinício: o resultado é falha explícita e o rascunho pode reaparecer. fake-indexeddb confirma comportamento transacional em memória, sem provar persistência física, crash real, quota real, WebKit/Tauri ou queda de energia; esses cenários não foram executados. Nenhuma chamada AWS/Google real, leitura de dados pessoais/segredos ou consulta ao banco pessoal. DynamoDB Local não usado nesta frente.

Arquitetura central/índice de relatórios ficam com o coordenador por ownership explícito; ele deve incorporar estes resultados com os limites. Fetch SSH falhou por chave ausente; repetido com HTTPS autenticado pelo gh, sem alterar o remote. Outro revisor deve revisar o PR antes do merge; não houve push main/develop nem deploy.

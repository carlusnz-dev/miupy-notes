# Calendar — OAuth local e sincronização (2026-10-22)

Worktree isolada `feat-calendar-google-sync-s13`, base develop `5dd21aa`. Ownership de API Calendar/composição local, frontend Calendar/cliente, Tauri OAuth, contrato Calendar, README API, decisão e este relatório. Checkout pai não foi editado; somente suas dependências foram usadas por symlink `node_modules`, autorizado. Documentos centrais/JSONs/índice ficam com o coordenador, conforme divisão explícita.

## Entrega

Importados **somente os 24 arquivos** de `/tmp/miupy-s13-calendar-handoff/files` listados em manifest.json. SHA-256 de origem e destino conferidos 24/24 antes de qualquer correção; checkpoints enviados ao coordenador antes de alterar e após copiar. Fontes obrigatórias e skills lidas; Graphify consultado em cache local (`explain GoogleIntegrationServiceImpl`, sem extração LLM, sem indexar documentos).

- Corrigido `GoogleEventBody`: omitir também `id` antes de torná-lo opcional. API compila.
- Cofre backend Secret Service opt-in, com namespace Calendar/hash por proprietário; dados só em pipes, sem tokens no frontend/DynamoDB. Falhas 503 do cofre preservadas sem retry Google. Composição Lambda permanece sem adaptador.
- Consentimento Tauri separado do login, PKCE/state/loopback/timeout, validação de URL/redirect e callback. State backend consumido atomicamente com Delete ALL_OLD. Callbacks recusam duplicatas, código vazio, método/path incorretos; URL de autorização recusa fragmento e parâmetros críticos duplicados.
- Conectar/desconectar serializados por proprietário **no processo local**, com regressão de troca OAuth em voo. Não é trava distribuída. Finalização do POST tem ponto explícito: Tauri sinaliza a fase, UI remove Cancelar e comando nativo recusa cancelar; após esse ponto é preciso desconectar para revogar. Logout/resposta perdida não garantem revogação.
- Carga inicial limitada a 30 dias passados e 366 futuros, limites estáveis entre páginas; incremental omite ambos. Não representa todo o calendário nem avança automaticamente a janela pelo relógio.
- Espelhos editáveis/excluíveis com escrita consentida, versão/ETag, PATCH e limpeza null de campos incompatíveis ao converter hora/dia inteiro. Textos remotos longos são preservados quando inalterados, mesmo se o formulário manda a cópia truncada; fake agora aplica semântica PATCH.
- Cópias locais enviadas por escolha explícita; salvar/excluir acompanha vínculo ativo. Exclusão mantém a referência até DELETE local condicional, permitindo retry após falha local/edição concorrente e remoto já ausente. Replay não descarta intenção com reflexão atrasada nem encobre GOOGLE_CONFLICT.
- Contrato/README atualizados; decisão [Calendar local](../decisoes/2026-10-22_calendar-local-oauth.md). Seletores/modais reutilizados, GSAP e cleanup/reduced-motion preservados.

## Verificação observada

| Comando/ação | Resultado final |
|---|---|
| `npm run test:api` | 172 testes: **163 aprovados, 0 falhas, 9 ignorados** por DynamoDB Local não configurado |
| `npm run test:web` | **160/160 aprovados** |
| `npm run check:modules` | 4 módulos válidos |
| `npm run build:api` | aprovado (`tsc --noEmit`) |
| `npm exec --workspace @miupy-notes/web -- tsc --noEmit` e `tsc -p tsconfig.node.json --noEmit` | aprovados |
| `node /tmp/miupy-s13-vite.mjs build` | build web aprovado; Vite `configFile:false`, plugins React/Tailwind, root desta worktree e `envDir=/tmp/miupy-s13-empty-env`; aviso já conhecido de chunk >500 kB |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib --offline` | **9/9 aprovados** |
| `git diff --check` | aprovado |
| Playwright MCP Chromium isolado, `python3 /tmp/miupy-s13-mcp.py http://127.0.0.1:5213` | harness sintético: 1440/390 px × normal/reduced-motion; conectar, cancelar espera, fase final sem botão Cancelar, dialog/foco/Esc/restauração, modos dia/semana/mês/ano e ausência de overflow horizontal; zero pageerror |

Regressões novas cobrem state simultâneo/ALL_OLD, janela e incremental, composição opt-in, isolamento/erros do cofre falso, redirect malformado, PATCH/If-Match/null, espelho com mesmo ETag após reconectar, preservação de descrição 9000/local 400 caracteres, conflito remoto, troca OAuth/desconexão, exclusão refletida concorrente/falha local e replay web. HTTP local comprova POST/PATCH com envio explícito após falha Google e repetição de DELETE após remoto já removido.

Falha intermediária real: a suíte API inicial tinha uma expectativa antiga de PUT, enquanto o snapshot usa PATCH; expectativa corrigida e regressões de semântica adicionadas, suíte final sem falhas. A primeira captura do harness temporário carecia dos tokens do shell; harness ajustado e toda a matriz visual repetida com tema/fonte/scroll do shell. Capturas finais inspecionadas; controles monocromáticos e título serif legíveis. Harness temporário removido do checkout após uso; cópia/log/scripts/capturas em `/tmp/miupy-s13-*` para inspeção local. Não são dados pessoais.

`npm run build` agregado não foi executado com configuração padrão de Vite para evitar qualquer carregamento implícito de ambiente; os dois compiladores web, build Vite com ambiente vazio e build API foram executados explicitamente. Não foram executados DynamoDB Local nesta frente, Tauri/WebKit manual, navegador/consentimento/cofre Google reais, testes de crash/duas janelas, AWS, Terraform, deploy, push ou merge. Nada foi aberto em `.env*`, credenciais ou dados pessoais preexistentes.

## Limites e integração

Somente `primary`, sync sob demanda; sem jobs/watch, exportação/restauração, coordenação distribuída ou garantia de transação entre Google/cofre/DynamoDB. Secret Service é local Linux e requer sessão desbloqueada; saída 1 de secret-tool não distingue todas as causas de ausência/indisponibilidade. Não há prova com conta real; consentimento e comportamento efetivo Google ainda exigem autorização específica do proprietário. Pendências offline de agenda não avisam no logout e não têm criptografia da aplicação/coordenação entre janelas.

Próximo passo: coordenador integra documentos centrais e dispara revisão independente pelo SHA local. A prova nativa/real fica separada e autorizada pelo proprietário; não chamar o resultado de espelho completo ou conta real verificada.

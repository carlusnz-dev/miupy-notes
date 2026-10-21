# Sessão 07 — Graphify e configuração de agentes

## Mudanças

- Instalado o pacote oficial PyPI `graphifyy` (`graphify 0.9.92`) com `uv tool install` em ambiente isolado: `/home/cabeto/.local/share/uv/tools/graphifyy`; executável em `/home/cabeto/.local/bin/graphify`. Python do ambiente: 3.12.14.
- Migradas as cinco skills do projeto de `skills/` para `.agents/skills/`; instaladas ali a skill Graphify e suas referências. `.claude/skills/` e `.codex/skills/` têm atalhos para as skills centrais. Atualizados os guias e os caminhos dos agentes.
- Criado `.codex/config.toml` local e ignorado pelo Git: `gpt-6.1-sol`, `medium`, `workspace-write`, `on-request`. Criadas regras em `.codex/rules/default.rules` para permitir build/testes locais e bloquear AWS, deploys selecionados e resets destrutivos.
- Atualizado `AGENTS.md` com navegação direcionada, política de extração code-only e limites de dados/infraestrutura. A skill Graphify do projeto foi restringida a `apps/web/src` e `apps/api/src`, sem documentos ou etapa LLM; consultas desativam o log local de perguntas.

## Verificações executadas

- Fonte oficial consultada: [Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify). A documentação identifica `graphifyy` como pacote oficial; descreve extração AST de código local sem LLM e extração semântica de documentos como fluxo que pode usar o modelo. Por isso o teste usou somente código e não configurou chave ou backend.
- Comando de instalação executado: `uv tool install --python "$HOME/.local/share/uv/python/cpython-3.12.14-linux-x86_64-gnu/bin/python3.12" graphifyy`. `graphify --version` retornou `0.9.92`.
- Prova de extração local: `graphify extract apps/web/src --code-only --no-cluster --out /tmp/miupy-graphify-validation` produziu 474 nós e 1.257 arestas; `apps/api/src` com as mesmas opções produziu 360 nós e 1.039 arestas. Saídas ficaram em `/tmp`, fora do checkout.
- Prova de consulta real: `graphify query 'authentication note routes' --graph /tmp/miupy-graphify-validation/graphify-out/graph.json --budget 500` e a consulta correspondente à API retornaram subgrafos com arquivos e símbolos locais. A primeira tentativa com `--backend none` foi rejeitada pela CLI (`unknown backend 'none'`); removido o argumento, a extração code-only/no-cluster concluiu sem etapa de LLM.
- TOML validado com `tomllib`; `codex --cd . --strict-config exec --help` iniciou sem erro de configuração. Versão local: `codex-cli 0.163.0`. Links para as seis skills resolveram sob `.agents/skills/`, `.claude/skills/` e `.codex/skills/`.
- `codex execpolicy check` confirmou `allow` para `npm run build` e `forbidden` para `terraform apply`, `git reset --hard`, `rm -rf`, `aws sts get-caller-identity` e `npm run deploy`. `.codex/config.toml` foi confirmado ignorado pelo Git.
- Regras e configuração seguiram a [referência oficial do Codex](https://learn.chatgpt.com/docs/config-file/config-reference) e a [documentação oficial de regras](https://learn.chatgpt.com/docs/agent-configuration/rules).

## Limites e pendências

- Graphify não processou documentos, notas, imagens, variáveis de ambiente ou credenciais, nem usou Graphify Cloud, API keys, AWS, deployment ou Terraform.
- TOML e regras do Codex não garantem, sozinhos, bloqueio de leitura individual de arquivos; as instruções em `AGENTS.md` complementam sandbox e regras.
- Não executados build/testes, pois não eram necessários para validar esta configuração de ferramenta. O grafo AST omite extensões sem suporte e alguns arquivos sem símbolos; confirme conclusões importantes na fonte e complemente com `rg` direcionado.
- O índice `docs/relatorios/README.md` e referências fora da propriedade desta frente ainda podem citar `skills/`; atualização ficou para a integração do coordenador.

## Acompanhamento da frente de ferramentas

- Adicionado `.codex/config.toml.example` versionável com os mesmos quatro padrões locais da configuração ignorada.
- Adicionados padrões exatos para `npm run build:web`, `build:api`, `test:api`, `test:web` e `check:modules`; `codex execpolicy check` retornou `allow` para os cinco comandos.
- `codex execpolicy check` manteve `terraform apply -auto-approve` como `forbidden`. O TOML de exemplo foi parseado e comparado com a configuração local; `git check-ignore` confirmou que apenas `.codex/config.toml` é ignorado entre os dois arquivos.
- Gerados grafos atuais fora do checkout em `$HOME/.cache/miupy-notes/graphify/{web,api}/graphify-out/graph.json`, usando somente `--code-only --no-cluster`: web 543 nós/1.419 arestas (64 arquivos de código detectados) e API 381 nós/1.103 arestas (67 arquivos detectados). Nenhum documento foi enviado ou processado.
- Consultas `note query cache` e `authenticate note controller`, com `GRAPHIFY_QUERY_LOG_DISABLE=1`, retornaram relações de cache de queries/notas na web e `authenticate()`/controller na API. Grafos permanecem locais; atualizar após mudanças nas fontes.

---
name: orquestrador
description: Coordenar workers Codex/Claude em terminais do Orca no miupy-notes sem inflar o contexto do coordenador (escolha de agente e esforço, briefs, acompanhamento, integração, scripts de estado e Graphify).
---

# Orquestrador

O coordenador decide, divide, acompanha e integra; quem lê código, roda testes e escreve achados são os workers. Complementa `worktrees-orca` (criação de worktrees, Run e limpeza) — leia as duas. CLI: `O=/home/cabeto/.config/orca/linux-orca-cli-shim/orca` (ou `$ORCA_CLI_COMMAND`); comandos Orca e `git push`/`fetch` rodam fora do sandbox.

## Contexto enxuto (regra principal)

- Não leia arquivos de código, diffs inteiros nem logs de teste no coordenador. Use `scripts/estado.sh` e leia só os relatórios mais recentes e os `resultado-*.md` dos workers.
- Para "onde está X / quem chama Y", use `scripts/grafo.sh` (Graphify local, code-only, cache fora do checkout) com orçamento pequeno; só abra um arquivo se a decisão depender dele, e só o trecho necessário (`sed -n a,bp`).
- Saídas de comandos: filtre (`| tail`, `--name-only`, `--stat | tail -1`, `python3 -c` sobre JSON). Nunca despeje `worker-show`/`run-show` inteiros.
- Peça ao worker um resultado curto (≤150 linhas) com veredito, achados com `arquivo:linha` e comandos executados. O coordenador confia no resultado e confere só o que vai virar decisão (por exemplo, `git log <pai>..<filha>`).

## Escolha de agente e esforço

| Tarefa | Agente / modelo | Esforço |
|---|---|---|
| Revisão de PR, segurança, infra, contrato (veredito) | `claude` / `claude-sonnet-5-5` | high |
| Implementação de feature com testes | `claude` Sonnet ou `codex` / `gpt-6.1-sol` | medium |
| Validação de frontend, design, rede, cache (skill de front) | `codex` / `gpt-6.1-sol` | medium |
| Levantamento de situação, ajuste pequeno, docs | `claude` Sonnet | low |
| Correção trivial, renomear, rodar verificação | `codex` / `gpt-6.1-sol` | low |

O proprietário pode fixar modelo e esforço no pedido: isso prevalece. Evite Codex em esforço alto salvo pedido. Confirme no recibo do `worker-start` que o modelo pedido foi aceito.

## Fluxo

1. **Estado**: `scripts/estado.sh` (worktrees, ahead/behind de `develop`, sujeira, Run atual). Leia os relatórios do dia em `docs/relatorios/` das worktrees (`scripts/estado.sh --relatorios`).
2. **Run**: se `run-current` mostra outro `coordinator_handle` sem workers ativos, crie o seu (`run-create --objective …`). Nunca crie Run com workers seus ativos.
3. **Briefs** em `/home/cabeto/orca/workspaces/miupy-notes/.briefs-<entrega>/`: `comum.md` (regras, proibições, entrega) + `frente-<nome>.md` (objetivo, skills a ler, o que verificar, arquivos editáveis, portas, nome do resultado). Diga explicitamente se a frente é só leitura ou pode commitar, e o que não pode tocar.
4. **Workers**: `scripts/iniciar-worker.sh <run> <worktree> <agente> <modelo> <esforço> <frente> "<título>"`. Duas frentes na mesma worktree só se no máximo uma editar e nenhuma rodar `npm ci` ao mesmo tempo.
5. **Acompanhar**: `scripts/acompanhar.sh <run> <dispatch…>` mostra status de cada dispatch e mensagens novas, uma linha cada. Espere com `Monitor`/execução em segundo plano; não faça polling curto.
6. **Integrar**: leia o `resultado-*.md`; se aprovado, merge `--no-ff` na pai e verificação completa (build, test:web, test:api, check:modules) — rodada por um worker ou em segundo plano, lendo só o resumo.
7. **Entregar**: push/PR/merge em `develop` e limpeza de branches só com aprovação do proprietário (e veredito do revisor quando pedido). Antes de apagar: `git merge-base --is-ancestor <branch> origin/develop`; `git branch -d`, nunca `-D`/`--force`.
8. **Relatório**: skill `relatorio`, com Run, dispatches, modelos, vereditos, o que não rodou e o estado para retomar.

## Evite

- Ler o diff ou o código para "conferir" o que o worker já revisou; peça ao worker se faltar evidência.
- Worker iniciando worker, `run-create`/`run-use` em worker (`nested_worker_depth_exceeded`, `consumer_fenced`).
- Briefs com segredos, URLs privadas, IPs ou dados pessoais; briefs dentro do Git.
- Mutação em AWS/GCP, `terraform apply`, deploy, push ou merge sem pedido explícito.
- Navegador com janela (rouba o foco): só headless, portas distintas por frente.
- Responder com resumo genérico: o relatório final cita dispatch, veredito e comandos verificados.

## Exemplo

```sh
D=.agents/skills/orquestrador/scripts
$D/estado.sh
$O orchestration run-create --objective "Revisão infra AWS" --json
$D/iniciar-worker.sh run_x infra-aws claude claude-sonnet-5-5 high infra-revisao "Revisão infra (veredito)"
$D/acompanhar.sh run_x ctx_aaa ctx_bbb
$D/grafo.sh api query "quem chama authenticate?"
```

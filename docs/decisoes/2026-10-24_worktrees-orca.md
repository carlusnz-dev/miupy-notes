# Worktrees e workers com o Orca IDE

Data: 2026-10-24. Origem: sessões 05, 18, 20 e 21 (infra AWS e polimento de design), em que a falta de regra causou worktree criada a partir de `main`, branch com nome errado, `nested_worker_depth_exceeded` e coordenador desvinculado do Run (`consumer_fenced`).

## Contexto

O trabalho paralelo usa worktrees do Orca em `/home/cabeto/orca/workspaces/miupy-notes/<nome>`, com um coordenador e workers (Claude ou Codex). O comportamento padrão do Orca não segue as convenções do repositório:

- `worktree create` nomeia a branch como `carlusnz-dev/<nome>`;
- `worker-start --worktree new-child` sem `--base-branch` parte de `main`, não da branch atual;
- a profundidade de workers aninhados é 1: um worker não consegue iniciar filhas;
- `run-create` vincula o terminal ao novo Run e tira o Run anterior desse terminal; `run-use` transfere o papel de coordenador e deixa o terminal antigo em `consumer_fenced`.

## Decisão

1. **CLI:** só o shim `/home/cabeto/.config/orca/linux-orca-cli-shim/orca` (ou `ORCA_CLI_COMMAND`). Confirme com `status --json`; o socket pode exigir execução fora do sandbox.
2. **Uma worktree pai por entrega**, top-level, criada a partir de `develop` (`--base-branch develop --no-parent`). Ela recebe o merge das filhas e é a única que vira PR, sempre para `develop` e sem merge pelo agente.
3. **Filhas só pelo coordenador:** `worktree create --parent-worktree branch:<pai> --base-branch <pai> --setup skip` e depois `worker-start --worktree name:<filha>`. Nunca `new-child` sem `--base-branch`.
4. **Branches renomeadas antes do primeiro commit** com o prefixo Conventional Commits do repositório (`fix/ui-polimento`, `fix/ui-polimento-agenda`), sem identificador de sessão.
5. **Um Run por coordenador.** Worker não executa `run-create` nem `run-use`. Se o coordenador precisar de um Run novo, ele confere antes que o Run atual não tem worker ativo, ou aceita que o Run atual passa a outro dono.
6. **Arquivos exclusivos por worker**, definidos no brief; mudança fora deles vira pendência para o coordenador. Cada worker usa uma porta própria para harness/Vite.
7. **Briefs e resultados fora do Git**, em `/home/cabeto/orca/workspaces/miupy-notes/.briefs-<entrega>/` (`comum.md`, `frente-<nome>.md`, `resultado-<nome>.md`).
8. **Integração local:** o coordenador faz `git merge --no-ff` de cada filha na pai, roda a verificação completa na pai e só então abre o PR. Push e PR exigem pedido do proprietário.
9. **Limpeza só depois do merge do PR:** `git merge-base --is-ancestor`, `orca worktree rm` ou `git worktree remove` sem `--force`, e `git branch -d`. Stashes e worktrees de outras entregas não são tocados.

## Efeitos

- A skill [`worktrees-orca`](../../.agents/skills/worktrees-orca/SKILL.md) traz o passo a passo, os checks e exemplos bons e ruins.
- `AGENTS.md` aponta para esta decisão e para a skill.
- Elevar "Nested worker depth" em Settings → Orchestration continua sendo opção do proprietário. Enquanto o valor for 1, vale o item 3.

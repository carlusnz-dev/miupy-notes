---
name: worktrees-orca
description: Criar, coordenar, integrar e limpar worktrees e workers do Orca IDE no miupy-notes (pai a partir de develop, filhas pelo coordenador, um Run por coordenador).
---

# Worktrees com o Orca

Regra completa em `docs/decisoes/2026-10-24_worktrees-orca.md`. Use `O=/home/cabeto/.config/orca/linux-orca-cli-shim/orca` (ou `$ORCA_CLI_COMMAND`); comandos Orca podem exigir execução fora do sandbox.

## Fluxo

1. **Estado:** `git status`, `git worktree list`, `git stash list`, `gh pr list`; `$O status --json`; `$O orchestration run-current --json`. Anote stashes e worktrees de outras entregas: elas não são tocadas.
2. **Pai:** `$O worktree create --name <entrega> --base-branch develop --no-parent --setup skip --json`, depois `git -C <wt> branch -m <tipo>/<entrega>` antes de qualquer commit.
3. **Run:** se o terminal já coordena um Run com worker ativo, reutilize-o (`--run <id>`). `run-create` só quando o Run atual estiver encerrado ou tiver passado a outro dono (`run-show` mostra outro `coordinator_handle`).
4. **Briefs:** `/home/cabeto/orca/workspaces/miupy-notes/.briefs-<entrega>/comum.md` (regras, decisões do proprietário, verificação, entrega) e `frente-<nome>.md` (achados, arquivos exclusivos, arquivos proibidos, porta, testes).
5. **Filhas:** `$O worktree create --name <entrega>-<frente> --parent-worktree branch:<pai> --base-branch <pai> --setup skip --json`, depois `git -C <wt> branch -m <pai>-<frente>`. Em seguida `$O orchestration worker-start --run <id> --worktree name:<entrega>-<frente> --agent claude|codex --model <id> --effort <nível> --task-title "…" --spec "Leia <briefs>/comum.md e frente-<frente>.md …"`.
6. **Acompanhar:** `worker-show --dispatch <id>` (`stage.dispatch` sai de `dispatched` ao terminar) e `check --terminal $ORCA_TERMINAL_HANDLE --json`, ignorando `type: heartbeat`. `check` não consome mensagens: guarde os ids já lidos. Responda perguntas com `reply --id <msg> --run <run>`.
7. **Integrar:** leia `resultado-<frente>.md`, confira `git log <pai>..<filha>` e `git status` da filha e faça `git merge --no-ff <filha>` na pai. Fases dependentes partem da pai já integrada.
8. **Verificar na pai:** `npm ci` (cada worktree começa sem `node_modules`), `npm run build`, `npm run test:web`, `npm run test:api` (com `env -u DYNAMODB_*_TEST_ENDPOINT`), `npm run check:modules`.
9. **Entregar:** push e PR da pai para `develop` só quando pedido. Fetch e push por HTTPS: `git -c credential.helper='!gh auth git-credential' -c url.https://github.com/.insteadOf=git@github.com: …` (SSH falha nesta máquina).
10. **Limpar** depois do merge do PR: `git merge-base --is-ancestor <branch> origin/develop`, `$O worktree rm` ou `git worktree remove` sem `--force`, `git branch -d`.

## Checks

- [ ] Pai criada de `develop`; filhas de `<pai>` (`git log -1` igual à ponta da pai no momento da criação).
- [ ] Nenhuma branch `carlusnz-dev/*` nem identificador de sessão antes do primeiro commit.
- [ ] Nenhum worker inicia worker, executa `run-create` ou `run-use`.
- [ ] Arquivos de cada frente sem sobreposição; exceções pontuais escritas no brief.
- [ ] Portas distintas por frente; navegador somente headless.
- [ ] Briefs e resultados fora do Git; nada de `.env*`, credenciais ou dados pessoais neles.
- [ ] Merge local das filhas e verificação completa na pai antes do PR.
- [ ] Stashes antigos e worktrees de outras entregas intactos.

## Exemplos

Bom:

```sh
$O worktree create --name ui-polimento --base-branch develop --no-parent --setup skip --json
git -C …/ui-polimento branch -m fix/ui-polimento
$O worktree create --name ui-polimento-agenda --parent-worktree branch:fix/ui-polimento \
  --base-branch fix/ui-polimento --setup skip --json
git -C …/ui-polimento-agenda branch -m fix/ui-polimento-agenda
$O orchestration worker-start --run run_x --worktree name:ui-polimento-agenda --agent claude \
  --model claude-sonnet-5-5 --effort high --task-title "UI: Agenda" --spec "Leia …/.briefs-ui/comum.md e frente-agenda.md"
```

Ruim:

```sh
/usr/bin/orca-ide orchestration …                        # launcher gráfico: "Unknown flag --app"
$O orchestration worker-start --worktree new-child …     # sem --base-branch: parte de main
git commit …  # ainda em carlusnz-dev/ui-polimento        # renomeie antes
git branch -m feat/s21-agenda                            # identificador de sessão no nome
# worker orquestrador chamando worker-start              # nested_worker_depth_exceeded
# worker chamando run-create                             # prende o terminal a outro Run: consumer_fenced
# coordenador chamando run-create com workers ativos     # tira o Run anterior do terminal
$O worktree rm … --force; git branch -D …                # limpeza destrutiva sem conferir merge
```

## Erros conhecidos

| Erro | Causa | Saída |
|---|---|---|
| `Unknown flag --app` | `/usr/bin/orca-ide` | Use o shim |
| `nested_worker_depth_exceeded` | worker tentou iniciar worker (máximo 1) | O coordenador cria a worktree filha e inicia o worker, ou o proprietário eleva o limite em Settings → Orchestration |
| `consumer_fenced` | o terminal não é mais o coordenador do Run (houve `run-create` ou `run-use` em outro terminal) | `run-show` para ver o dono; o dono legítimo faz `run-use`; o coordenador cria outro Run só se o anterior estiver encerrado ou com outro dono |
| Worktree com o código de `main` | `new-child` sem `--base-branch` | Recrie com `--base-branch <pai>` antes de o worker editar |

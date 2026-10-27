# Hábitos — MVP (backend, web e fundação de XP)

Data: 2026-10-26. Branch `feat/habits-mvp` (worktree `habits-mvp`), Claude Sonnet 5.5. Sem AWS, sem Google real, sem push.

## O que foi feito

- **API `/v1/habits`** (módulo `apps/api/src/modules/habits`, mesmo padrão de Biblioteca): hábito (título, descrição, tipo, prioridade, horário opcional), recorrência diária/semanal/dias da semana como união discriminada extensível, pausa por janelas (`from`, `until`), exclusão lógica (`deletedAt` + `purgeAfter` = 30 dias, restauração), ocorrências derivadas por data, conclusão por ocorrência, histórico e XP. Contrato completo em `docs/arquitetura/api.md` (seção Hábitos).
- **Hábito × ocorrência:** a ocorrência não é gravada; só a execução concluída (`HLOG#<data>#<hábito>`). Concluir uma não afeta as outras.
- **Regra de data/fuso:** datas locais `AAAA-MM-DD` e hora de parede `HH:MM`, aritmética de dias inteiros sem conversão de fuso (documentada em `domain/recurrence.ts` e na API).
- **Histórico preservado:** a execução guarda título, tipo e prioridade do momento; `purgeExpired(ownerId)` apaga só o `HABIT#`. Não há agendador (SQS/EventBridge adiado com a frente AWS).
- **XP:** evento por chave determinística `HXP#<hábito>#<data>#completion` com escrita condicional; desmarcar preenche `revokedAt`, remarcar reativa o mesmo evento. Saldo, nível (`⌊XP/100⌋+1`) e conquistas derivados no backend; sem penalidade.
- **Google Calendar:** `GET /habits/settings`; flag `HABITS_GOOGLE_CALENDAR` (desligada por padrão), `available` sempre `false`, nenhum adaptador.
- **Web:** `/habits` (visões Hoje/Hábitos/Lixeira, navegação por dia, formulário e pausa em `Modal`/`Select`/`DatePicker`/`TimeField`/`ButtonGroup` compartilhados, barra de XP com GSAP e `prefers-reduced-motion`), item na Sidebar e no "Mais" da barra inferior, painel "Hábitos do dia" na página Agendas e cliente `lib/habits-api.ts`.

## Verificação (resultado real)

| Comando | Resultado |
|---|---|
| `npm run test:api` (sem `DYNAMODB_TEST_ENDPOINT`) | 237 aprovados, 0 falhas, 10 ignorados (integração DynamoDB Local opt-in); 22 testes são de hábitos |
| `npm run build:api` | ok |
| `npm run check:modules` | 6 módulos válidos |
| `npm run test:web` | 210 aprovados, 0 falhas (3 novos em `habits/habits.test.ts`) |
| `npm run build` (web) | ok |

Cobertura dos testes de hábitos: recorrência (virada de mês/ano, bissexto, dia da semana, pausa, independência de `TZ`), conclusão por ocorrência, XP idempotente e compensação, lixeira e expiração por relógio injetado, expurgo preservando histórico/XP, rotas com isolamento A×B e `401` sem alteração de dados, validação estrita, chaves e condições do repositório DynamoDB com cliente falso.

## Não executado / limitações

- **Persistência real:** nenhum teste contra DynamoDB Local nem AWS; só cliente falso. Sem teste de integração opt-in específico de hábitos.
- **Validação visual não feita:** a tela exige login Google real, indisponível aqui; só `tsc`/`vite build` e testes unitários. O painel da agenda e a página nunca foram renderizados.
- **Agenda:** ocorrências aparecem em painel do dia em foco, não como marcadores na grade/mês (a integração de tarefas usa marcadores; ficou fora por tamanho do diff).
- **Atomicidade:** log e evento de XP são gravados em passos separados; marcar/desmarcar a mesma ocorrência em paralelo não é serializado. Datas passadas podem ser concluídas sem limite (XP retroativo).
- **`aiAssisted` nas notas: adiado.** Exigiria mudar entidade (construtor posicional), repositórios, DTOs, cliente e o rascunho local/autosave das notas, o que não é simples.
- **Expurgo** sem agendador; limite de 300 hábitos e 50 pausas por hábito é simples contagem.
- `arquitetura.json` e `docs/relatorios/README.md` não foram editados (do coordenador): o estado "Hábitos implementado (sem AWS, sem visual verificado)" precisa ser registrado lá.
- Nenhuma dependência nova.

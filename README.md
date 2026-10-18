# miupy-notes

Sistema pessoal para reunir dados próprios, notas, finanças, calendário, mensagens e registros culturais em uma interface Tauri + React. O objetivo é manter uma cópia consultável dos dados autorizados pelo usuário, com importação, exportação e relatórios.

**Estado atual:** interface inicial em Tauri 2 + React e template de API Express/TypeScript. Dependências novas foram declaradas, mas a instalação npm está bloqueada por DNS neste ambiente. Não há integração, sincronização ou recurso AWS implantado.

## Mapa do repositório

| Caminho | Finalidade |
|---|---|
| [`docs/`](docs/) | Requisitos, arquitetura, contratos, decisões e relatórios. |
| [`styles/`](styles/) | Referências e tokens visuais em JSON para pessoas e agentes. |
| [`skills/`](skills/) | Rotinas de trabalho do projeto. |
| [`infra/`](infra/) | Convenções e futura infraestrutura Terraform. |
| [`apps/web/`](apps/web/) | Frontend React, rotas básicas e estilo monocromático. |
| [`apps/api/`](apps/api/) | Template Express/TypeScript com `core/` e módulo `notes`. |
| `src-tauri/` | Casca Tauri, ainda no template. |

Leia [`AGENTS.md`](AGENTS.md) ou [`CLAUDE.md`](CLAUDE.md) antes de alterar o projeto. O ponto de partida funcional é [`docs/requisitos/requisitos.md`](docs/requisitos/requisitos.md); o estado de implementação está em [`docs/arquitetura/arquitetura.json`](docs/arquitetura/arquitetura.json).

## Desenvolvimento local

Requisitos: Node.js e npm, Rust e dependências de sistema do Tauri 2 para sua plataforma. O lockfile será regenerado após a instalação das dependências novas.

```sh
npm install
npm run dev:web
npm run dev:api
npm run tauri dev
npm run build
npm run check:modules
```

Os workspaces compartilham o `node_modules` da raiz. `dev:web` abre o frontend; `dev:api` abre a rota local `/health`; `tauri dev` abre a janela desktop. O template de notas não expõe rotas pessoais até haver autenticação.

## Próximas entregas

1. Definir identidade/autenticação e o primeiro recorte de dados, sem expor endpoints pessoais publicamente.
2. Criar o primeiro fluxo vertical: nota no app → API autenticada → DynamoDB/S3 → exportação.
3. Adicionar conectores Google com consentimento e escopos mínimos, depois finanças, relatórios e MCP.

As decisões que dependem da conta Google, do modelo de acesso e do custo AWS estão em [`docs/decisoes/pendencias.md`](docs/decisoes/pendencias.md).

# Skills de terceiros

Copiadas em 2026-10-22, fixadas no commit indicado, sem executar código dos repositórios. Para atualizar, compare o diff upstream antes de substituir a pasta.

| Skill | Origem | Commit | Licença |
|---|---|---|---|
| `frontend-design` | [anthropics/skills](https://github.com/anthropics/skills/tree/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/frontend-design) | `dbd4588f9e10` | Apache-2.0 (`LICENSE.txt`) |
| `web-design-guidelines` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills/tree/063bee94c3f4df8453406c830b0a7df0f2860278/skills/web-design-guidelines) | `063bee94c3f4` | MIT (README upstream) |
| `vercel-react-best-practices` | [vercel-labs/agent-skills `skills/react-best-practices`](https://github.com/vercel-labs/agent-skills/tree/063bee94c3f4df8453406c830b0a7df0f2860278/skills/react-best-practices) | `063bee94c3f4` | MIT (README upstream) |
| `vercel-composition-patterns` | [vercel-labs/agent-skills `skills/composition-patterns`](https://github.com/vercel-labs/agent-skills/tree/063bee94c3f4df8453406c830b0a7df0f2860278/skills/composition-patterns) | `063bee94c3f4` | MIT (README upstream) |
| `bencium-controlled-ux-designer` | [bencium/bencium-marketplace](https://github.com/bencium/bencium-marketplace/tree/5de46a39b4640fa419560cd0b67e4c4b50dac802/bencium-controlled-ux-designer) | `5de46a39b464` | MIT (`LICENSE`) |
| `accessibility-{audit,scan,inspect,fix,diff}` e `shared/` | [AccessLint/skills](https://github.com/AccessLint/skills/tree/2e9d7336678302d0bc08848e92542560295b34d3/plugins/accesslint) | `2e9d73366783` | MIT (README upstream) |

Observações:

- `web-design-guidelines` busca as regras atuais em `raw.githubusercontent.com/vercel-labs/web-interface-guidelines` a cada uso.
- As skills AccessLint executam `npx -y @accesslint/cli@latest` e `@accesslint/chrome@latest` (sem versão fixada); o MCP `accesslint` está em `.mcp.json`. Rode-as só contra o servidor local de desenvolvimento, nunca com dados pessoais reais.
- `bencium-controlled-ux-designer` cita shadcn/Tailwind; este projeto não usa nenhum dos dois. Prevalecem `styles/tokens.json` e as preferências de AGENTS.md.
- `shared/` não é skill: guarda a metodologia referenciada pelas skills AccessLint como `../shared/methodology.md`.

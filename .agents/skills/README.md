# Skills do projeto

| Skill | Quando usar |
|---|---|
| [`codigo-enxuto`](codigo-enxuto/SKILL.md) | Antes de implementar ou revisar mudança de código. |
| [`revisar-contrato`](revisar-contrato/SKILL.md) | Ao mudar API, persistência, integração ou MCP. |
| [`relatorio`](relatorio/SKILL.md) | Ao encerrar sessão ou frente de trabalho. |
| [`validar-design`](validar-design/SKILL.md) | Ao conferir telas em navegador com MCP disponível. |
| [`revisar-pr`](revisar-pr/SKILL.md) | Ao revisar um diff ou PR antes de merge. |
| [`miupy-mcp`](miupy-mcp/SKILL.md) | Ao implementar, revisar ou testar o servidor MCP (`apps/mcp`). |
| [`worktrees-orca`](worktrees-orca/SKILL.md) | Ao criar, coordenar, integrar ou limpar worktrees e workers do Orca. |

Skills de terceiros, fixadas por commit em [SOURCES.md](SOURCES.md):

| Skill | Quando usar |
|---|---|
| [`frontend-design`](frontend-design/SKILL.md) | Direção visual de tela nova ou redesenho, evitando aparência genérica. |
| [`bencium-controlled-ux-designer`](bencium-controlled-ux-designer/SKILL.md) | Decisões de UX/UI dentro dos tokens existentes. |
| [`web-design-guidelines`](web-design-guidelines/SKILL.md) | Auditoria de UI contra as Web Interface Guidelines da Vercel. |
| [`vercel-react-best-practices`](vercel-react-best-practices/SKILL.md) | Performance e boas práticas React. |
| [`vercel-composition-patterns`](vercel-composition-patterns/SKILL.md) | API de componentes reutilizáveis (select, modal etc.). |
| `accessibility-{scan,inspect,audit,fix,diff}` | Acessibilidade WCAG 2.2 com AccessLint, só contra o servidor local. |

Estas instruções adaptam práticas gerais observadas no `miupy` ao escopo deste projeto. `.agents/skills/` é a fonte única; `.claude/skills/` e `.codex/skills/` apontam para estas pastas por links simbólicos.

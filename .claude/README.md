# Claude Code neste projeto

`CLAUDE.md` carrega `AGENTS.md`. `settings.json` mantém regras compartilháveis; configurações pessoais devem ficar em `settings.local.json`, ignorado pelo Git. Agentes específicos estão em `agents/`; as skills em `skills/` são atalhos para a fonte única em `.agents/skills/`.

- `agents/design-researcher.md`: pesquisa e implementação visual, configurado para Sonnet com esforço high.
- `agents/pr-reviewer.md`: revisão de mudanças com foco em comportamento e risco.
- `skills/validar-design/SKILL.md`: validação visual em navegador via Playwright MCP quando disponível.
- `skills/revisar-pr/SKILL.md`: revisão de PR/diff.
- `skills/graphify/SKILL.md`: navegação local code-only em fontes selecionadas.

O servidor de navegador é descrito em `.mcp.json`. Confira `/mcp` no Claude Code antes de usar; o arquivo de configuração por si só não prova que o servidor iniciou. Nenhuma permissão ampla ou credencial é pré-aprovada.

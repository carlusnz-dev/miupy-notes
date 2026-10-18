# Codex neste projeto

Codex lê `AGENTS.md` na raiz. Agentes do projeto ficam em `.codex/agents/*.toml`, um por arquivo, com `name`, `description` e `developer_instructions`. Skills são descobertas em `.agents/skills/`, que contém links simbólicos para a fonte única em `skills/`.

Não há `.codex/config.toml`: os padrões globais bastam por enquanto. Configuração de projeto só é carregada quando o projeto é confiável no Codex. Não coloque credenciais nesses arquivos.

Referências: <https://learn.chatgpt.com/docs/agent-configuration/subagents> e <https://learn.chatgpt.com/docs/build-skills>.

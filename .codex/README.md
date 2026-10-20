# Codex neste projeto

Codex lê `AGENTS.md` na raiz. Agentes do projeto ficam em `.codex/agents/*.toml`, um por arquivo, com `name`, `description` e `developer_instructions`. A fonte única das skills está em `.agents/skills/`; `.codex/skills/` mantém atalhos para os consumidores que procuram skills no diretório do Codex.

`.codex/config.toml` mantém preferências locais do proprietário e é ignorado pelo Git; use `.codex/config.toml.example` como referência para clones. A configuração do projeto só é carregada quando ele é confiável no Codex. `.codex/rules/default.rules` declara decisões de execução de comandos; essas regras não substituem as instruções de `AGENTS.md` nem bloqueiam, sozinhas, a leitura de arquivos individuais.

Referências: <https://learn.chatgpt.com/docs/agent-configuration/subagents> e <https://learn.chatgpt.com/docs/build-skills>.

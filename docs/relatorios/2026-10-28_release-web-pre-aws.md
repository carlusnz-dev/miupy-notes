# Validação de release — sessão e rede web (2026-10-28)

- Integrado `origin/develop`; conflito do cliente HTTP resolvido preservando `apiBaseUrlSchema` (HTTPS fora de loopback), o fallback de ambiente para testes e o orçamento compartilhado. JSON arquitetural preserva as decisões das duas branches e o inventário vindo de develop.
- Achado bloqueante reproduzido: resposta 401 da outbox de uma sessão antiga encerrava o novo login. O hook agora verifica `current()` antes de expirar a sessão.
- Novo teste executa o comando de envio real do hook (efeitos de UI inativos por renderização no servidor), mantém o HTTP pendente, troca a sessão e libera o 401. Falhou antes da correção e aprovou depois; envio pendente permanece intacto.
- Verificação final: `npm ci`, `npm run build`, `npm run check:modules` (5 módulos), `npm audit --omit=dev` (zero vulnerabilidades); web 223/223 e API 228 aprovados/10 integrações DynamoDB ignoradas.
- Suíte cobre saída com pendências/consentimento, limpeza de IndexedDB/cache/localStorage, falha de limpeza, preservação na expiração, 401/403, Retry-After de 429, teto de GET em 5xx, escrita sem repetição, orçamento e respostas de outra sessão.
- Não executados: DynamoDB Local, contas/provedores reais, AWS, Tauri/WebKit e fluxo visual de logout. `test:mcp` não existe nesta branch. Nenhuma mudança de contrato ou novo estado de implementação em arquitetura.json.

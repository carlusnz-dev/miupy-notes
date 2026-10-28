# Validação de release — segurança (2026-10-28)

- Integrado `origin/develop` em `test/security-hardening`, sem conflitos.
- Corrigido bloqueio indevido de `/dist/` no verificador de segredos: o bundle agora é lido e os caminhos são deduplicados.
- Verificação: `npm ci`, `npm run build`, `npm run check:modules` (5 módulos), `npm audit --omit=dev` (zero vulnerabilidades); web 212/212; API 233 aprovados, 13 ignorados (10 integrações DynamoDB e 3 cenários explicitamente adiados).
- Sonda sintética no bundle detectada com exit 1; removida a sonda, `check:secrets` aprovou 431 caminhos de código e 43 arquivos de bundle.
- Suíte inclui proteção de todas as rotas registradas dos cinco módulos, bearer malformado, isolamento de notas, logs sem conteúdo, allowlist CIDR e handler Lambda com eventos sintéticos.
- Throttling 5/s e burst 10 têm asserção Terraform preexistente; Terraform não foi executado nesta frente. DynamoDB Local, hábitos/MCP integrados, infraestrutura real, contas externas e Tauri manual não foram verificados.
- Resultado consolidado das três branches no arquivo externo `resultado-seguranca-mcp-web.md` do brief de release.

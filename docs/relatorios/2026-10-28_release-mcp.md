# Validação de release — MCP (2026-10-28)

- Integrado `origin/develop`; conflito em `.agents/skills/README.md` resolvido preservando ambas as entradas; lockfile regenerado com `npm install`.
- `npm audit --omit=dev` apontou 1 alta em body-parser 2.3.0 (GHSA-27r3-jxmh-p828); atualizado somente esse pacote no lockfile para 2.4.0. Após `npm ci`, auditoria zerada.
- Teste opt-in falhava no CRUD por usar `notes` em vez de `items`; corrigido o contrato da asserção. Credencial inválida foi trocada para não coincidir com o prefixo de autenticação sintético `token-`.
- Verificação final: build dos três workspaces aprovado; web 212/212; API 228 aprovados/10 integrações DynamoDB ignoradas; MCP 22 aprovados/3 opt-in ignorados; check:modules 5/5.
- Os 3 testes opt-in também foram executados contra API em memória em 127.0.0.1:4700, com credenciais sintéticas: 3/3 após a correção, incluindo busca e conflito.
- Sonda externa com cliente SDK e processo stdio real na mesma API: listar cinco ferramentas, folders_list, notes_create/get/update/search, conflito, token ausente/inválido e logs sem token/conteúdo aprovados. API encerrada.
- `/health` local não fornece CORS; o Terraform atual possui configuração CORS no Gateway. A aba MCP pode indicar indisponibilidade entre origens; isso não bloqueia stdio, que não usa CORS. Gateway real e Tauri não foram acessados.
- HTTP/OAuth remoto continua parcial por decisão documentada; confirmação de escrita depende do cliente e auditoria é stderr, sem persistência. Não considerar RF-11 concluído.
- Sem AWS, provedores, DynamoDB Local, browser visual ou registros reais de clientes. Estado de implementação em arquitetura.json não mudou.

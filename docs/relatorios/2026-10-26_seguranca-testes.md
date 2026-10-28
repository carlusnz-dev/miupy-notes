# Frente de segurança — 2026-10-26

## Mudanças e decisão

- Teste HTTP deriva métodos e caminhos dos routers registrados de notas, pastas, finanças, agenda (incluindo tarefas) e biblioteca. Cada rota recebe ausência de token, esquema errado, JWT inválido, expirado e cabeçalho com sufixo indevido; todos devem responder `401 UNAUTHORIZED`.
- Testes adicionais verificam que A lê a própria nota, B recebe `404 NOT_FOUND` ao ler, editar ou excluir a nota de A, e que a nota permanece intacta. Verificam tipos, tamanhos, campos extras, query e IDs inválidos (`400`), leitura repetida e exclusão repetida (`204`, depois `404`).
- O teste inicialmente falhou: `Bearer <JWT válido> extra` era aceito porque o parser ignorava o terceiro segmento. O parser agora exige o valor inteiro no formato `Bearer <token>`; erro permanece `401 UNAUTHORIZED`, sem mudança de contrato HTTP.
- `npm run check:secrets --workspace @miupy-notes/api` examina código/configuração versionados ou novos em `apps/`, `infra/`, `scripts/` e o bundle web. Usa padrões de alta confiança para chave privada, AWS, Google API, GitHub e atribuição de segredo de provedor no frontend. Não imprime valores encontrados; ignora arquivos de dados/estado e dependências. Não é detector completo de credenciais.
- Três testes ignorados documentam dependências das futuras branches de hábitos, handler Lambda e MCP. Nenhuma dependência foi adicionada.

## Verificação

- `npm ci`: concluído; auditoria do npm relatou 1 vulnerabilidade alta em dependências, não investigada nesta frente.
- `npx tsx --test apps/api/src/modules/notes/routes/security.security.test.ts`: 5 aprovados, 3 ignorados.
- `env -u DYNAMODB_TABLE_TEST_ENDPOINT -u DYNAMODB_ENDPOINT_TEST_ENDPOINT npm run test:api`: 220 aprovados, 13 ignorados, 0 falhas. Os testes de integração DynamoDB Local foram ignorados por ausência de `DYNAMODB_TEST_ENDPOINT`.
- `npm run build`: passou para web e API. Vite informou chunks acima de 500 kB.
- `npm run check:modules`: passou; 5 módulos válidos.
- `npm run check:secrets --workspace @miupy-notes/api`: passou; 376 arquivos de código/configuração e 43 arquivos do bundle examinados, nenhum padrão detectado.
- `git diff --check`: passou.

## Limites e próximo passo

- `POST /notes` não oferece chave de idempotência: reenviar cria outra nota, conforme contrato atual. A criação de eventos Calendar por UUID tem cobertura própria já existente; não foi duplicada aqui.
- Não houve AWS, DynamoDB Local, handler Lambda HTTP, MCP, hábitos ou navegador real nesta frente. Após integrar essas branches, ativar os três testes ignorados e ampliar a matriz de autorização e validação para as novas operações.
- A vulnerabilidade alta apontada por `npm ci` precisa de triagem separada antes de um uso conectado.

# API — template

Express + TypeScript para Lambda via `serverless-http`. O servidor local responde apenas `GET /health`; o módulo `notes` implementa listar (cursor), criar, ler, atualizar (com `version` e `409`) e excluir, mas **não é montado** enquanto não houver verificação real de token. Contrato em `docs/arquitetura/api.md`. Não há tabela, Lambda ou API Gateway implantados.

```text
src/
  core/                  classes base, erro, HTTP, cliente DynamoDB
  modules/notes/
    domain/              entidade
    repository/          contrato e implementação DynamoDB
    services/            contrato abstrato e implementação
    controllers/         tradução HTTP → service
    dto/                 input, output, adapter com Zod
    routes/              Express Router
    module.ts            composição interna
    index.ts             API pública para outros módulos
  app.ts                 composição Express e rotas públicas
  lambda.ts              adaptador Lambda
  server.ts              execução local
```

## Regra dos módulos

Classes concretas herdam contratos abstratos de `core/`. Outro módulo só importa serviços pelo `index.ts` do módulo de origem; repository, controller, DTO e implementação são internos. A composição da aplicação recebe `createNotesModule` pelo mesmo índice. `npm run check:modules` verifica estrutura e fronteiras; `npm run test:api` roda todos os `src/**/*.test.ts`, incluindo as rotas de notas montadas com principal falso **apenas no teste** e o repositório DynamoDB com cliente falso. Novos módulos seguem o mesmo padrão, sem criar classes vazias apenas para preencher pastas.

## Comandos

Da raiz: `npm run dev:api`, `npm run build:api`, `npm run test:api` e `npm run check:modules`. A porta local padrão é 4000 e o listener usa `127.0.0.1`.

Antes de montar `/v1/notes`, converter as claims do JWT authorizer em `res.locals.principal` e aplicar a lista de `sub` permitidos (ver `docs/decisoes/2026-10-18_identidade.md`). Nunca aceitar `ownerId` do corpo HTTP como autoridade. Definir `NOTES_TABLE_NAME` e IAM mínimo ao compor a Lambda. O handler em `src/lambda.ts` ainda precisa de bundle para deployment; Terraform não o usa nesta etapa.

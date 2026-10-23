# Arquitetura proposta

## Limites

```text
Tauri + React ── Axios/HTTPS ── API Gateway HTTP ── Lambda ── DynamoDB
                                             │              └── S3
                                             └── conectores Google (OAuth)
CloudWatch recebe métricas e logs da API, Lambda e sincronizações.
MCP futuro consulta a mesma camada de autorização, sem acesso direto ao banco.
```

O código contém React e API Express/TypeScript com módulos autenticados de notas, pastas, finanças (contas e balanços) e Calendar, além da Biblioteca (CRUD e filtros por obra). O planner inclui cache/outbox por conta; a API local Linux oferece opt-in Google com login único: o Tauri pede o Calendar no login e a API lê o refresh token do chaveiro do login, sem segundo consentimento. A conexão real ainda não foi verificada; Lambda permanece sem adaptador Google. A coordenação OAuth é apenas por processo local e deve ser persistida antes de habilitar múltiplas instâncias. O diagrama é uma direção de implementação, não uma topologia implantada. A API centraliza regras, autorização, persistência e conectores. React apresenta dados e mantém estado de interface; Tauri fornece a janela e funções locais estritamente necessárias. Evite fazer a aplicação desktop conversar diretamente com DynamoDB, S3 ou APIs Google.

O backend é organizado em módulos de feature. Cada módulo tem domínio, repository, services, controllers, DTO (`input`, `output`, `adapter`), routes, `module.ts` e `index.ts`. Classes concretas herdam contratos em `core/`; a única superfície de importação entre módulos é o `index.ts`. A composição de `notes` existe, mas suas rotas não são montadas antes da identidade.

## Fluxos previstos

1. **Nota:** interface cria nota → cliente HTTP envia operação autenticada → Lambda valida identidade e payload → DynamoDB grava metadados e conteúdo curto. Anexos ficam no S3, referenciados pela nota.
2. **Sincronização:** usuário concede acesso a um provedor → backend armazena credencial protegida → tarefa lê mudanças em páginas e grava registros com `source`, `externalId`, versão/cursor e horário. Reexecução não deve duplicar registros.
3. **Exportação:** backend lê registros do usuário e gera manifesto JSON e CSVs por domínio; anexos são incluídos por referência ou pacote. Importação valida esquema, dono, conflitos e mostra prévia antes de gravar.
4. **Relatórios:** agregações usam dados persistidos, registram período/filtros e distinguem dados próprios de importados.
5. **MCP:** camada separada chama a API autorizada com ferramentas de leitura limitadas; escrita exige confirmação explícita e auditoria.

## Evolução

Começar por notas, identidade e exportação; só depois conectar Calendar/Gmail. Particionar Lambda por domínio quando houver motivo operacional. Desenhar padrões de consulta do DynamoDB antes de escolher chaves e índices. Não adicionar fila ou serviço de busca até surgir necessidade medida.

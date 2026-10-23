# Requisitos do miupy-notes

Estado em 2026-10-18: todos os itens abaixo são **planejados**. O primeiro recorte deve provar uma nota pessoal do app até a API, persistência e exportação.

| ID | Pri. | Requisito | Critério de aceite inicial |
|---|---|---|---|
| RF-01 | M | Criar, editar, listar e excluir notas em Markdown, com links e tags. | Conteúdo volta íntegro após reiniciar o app. |
| RF-02 | M | Autenticar o proprietário e isolar seus dados. | Requisição sem identidade válida é negada; usuário não lê outro usuário. |
| RF-03 | M | Persistir metadados no DynamoDB e anexos no S3 pela API. | CRUD retorna IDs estáveis e mantém referência ao anexo. |
| RF-04 | M | Exportar dados próprios em JSON e CSV e restaurar a partir de exportação validada. | Exportação é legível sem o app; restauração tem prévia e não duplica registros. |
| RF-05 | S | Conectar Google Calendar com consentimento e sincronizar eventos permitidos. | Origem, cursor e última sincronização visíveis; duplicatas evitadas. |
| RF-06 | S | Conectar Gmail com escopos mínimos e importar dados autorizados. | Usuário escolhe escopo e pode desconectar; sincronização incremental e auditável. |
| RF-07 | F | Avaliar conexão com Google Keep. | Disponibilidade para a conta do usuário e permissões verificadas antes de construir conector. |
| RF-08 | S | Registrar contas, lançamentos e categorias financeiras. | Totais batem com lançamentos; valores são decimais, moeda explícita. |
| RF-09 | S | Registrar músicas, livros, filmes e outras obras consumidas, com notas. | Tipo, título, data e avaliação podem ser consultados e exportados. |
| RF-10 | S | Gerar relatórios pessoais por período e domínio. | Relatório mostra origem dos dados, filtros e data de geração. |
| RF-11 | F | Expor ferramentas MCP para LLMs sobre dados autorizados. | Ferramentas usam escopo explícito, confirmação para escrita e trilha de auditoria. |
| RF-12 | S | Consultar e gerenciar sincronizações externas. | Estado, erro, retry e desconexão visíveis por integração. |
| RNF-01 | M | Interface responsiva e binário enxuto. | Medir tamanho final, abertura e fluidez antes de fixar metas. |
| RNF-02 | M | Segurança e privacidade. | TLS, criptografia em repouso, segredo fora do cliente, menor privilégio e logs sem conteúdo pessoal. |
| RNF-03 | M | Recuperação e backups. | Backup versionado com teste periódico de restauração e retenção definida. |
| RNF-04 | M | Observabilidade. | Erros e latência da API, falhas de Lambda e sincronização com alarmes acionáveis. |
| RNF-05 | S | Sincronização resiliente. | Retentativas limitadas, idempotência, paginação e tratamento de limites dos provedores. |
| RNF-06 | M | Documentação viva para humanos e LLMs. | Contratos e `arquitetura.json` mudam com a implementação; relatório registra verificação real. |

## Continuidade em 2026-10-21

Notas e identidade (RF-01/RF-02) têm proteção local de rascunhos por CAS e journal de descarte; notas foram promovidas para main pelo PR #17. RF-08 inclui contas, referências e balanços por moeda, sem conexão bancária real. RF-05/RF-12 são parciais: planner e portas/adaptadores Google testados com fakes; falta CredentialStore de produção e consentimento no desktop. Nenhuma conexão Google Calendar real ou recurso AWS implantado. A sessão 12 registra as correções e a validação para integração do PR #16; Chromium/fake IndexedDB não substituem Tauri/WebKit/crash/duas janelas.

## Continuidade em 2026-10-22

RF-05/RF-12 continuam parciais: API local Linux opt-in (`login-keyring`) usa o login único do Tauri com escopo Calendar, sem segundo OAuth; a API lê o refresh token do chaveiro do login; leitura ou escrita consentida, edição/exclusão de espelhos e envio explícito de cópias locais testados com fakes. Carga inicial limitada a 30 dias passados e 366 futuros, incremental sob demanda, sem janela móvel automática. Connect/disconnect têm serialização somente no processo local; Lambda permanece sem cofre/conector habilitado. Não há conta Google/chaveiro/consentimento nativo real verificado nem AWS implantada. Sessão 13 registra limpeza Git/Orca, revisão e validação sintética desktop/mobile.

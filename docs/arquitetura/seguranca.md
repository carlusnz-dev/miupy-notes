# Segurança e privacidade

## Identidade

Decidido em [`../decisoes/2026-10-18_identidade.md`](../decisoes/2026-10-18_identidade.md); **implementado localmente na sessão 05** (sem AWS):

- **Desktop (`src-tauri/src/auth.rs`):** authorization code + PKCE S256 + `state`, navegador do sistema, loopback `127.0.0.1` com porta efêmera (um callback por login, leitura limitada a 5 s por conexão, timeout de 5 min). Só o refresh token vai para o cofre do sistema (crate `keyring`; no Linux, Secret Service; entrada `google-refresh-token@com.miupy.notes`). O ID token fica em memória no Rust e chega ao JS só pelo comando `auth_id_token`, a cada requisição do Axios; nunca em `localStorage`, estado React ou log. `invalid_grant` no refresh apaga o cofre. Sair revoga o refresh token (melhor esforço).
- **Configuração:** `GOOGLE_CLIENT_ID` e, se o Google exigir, `GOOGLE_CLIENT_SECRET` são lidos em runtime do ambiente; em build de debug, de `.env.local` na raiz (ignorado pelo Git). Nada é compilado no binário nem vai para o bundle web (verificado por `grep` em `apps/web/dist`). Distribuição em release ainda sem solução de configuração.
- **API:** valida o ID token (`jose`, RS256, `iss`, `aud`, `exp`) e aplica `ALLOWED_SUBS`; `sub` fora da lista → `403`. `ownerId` = `sub`. O `sub` do proprietário fica **só** em `ALLOWED_SUBS` no `.env.local` da raiz; nenhum arquivo versionado o contém.
- **Diagnóstico:** `MIUPY_DEBUG_IDENTITY=1` em build de debug imprime `iss` e `sub` no stderr após o login; não usar em sessões gravadas.

Toda consulta e chave de objeto são derivadas da identidade validada. Rotas pessoais não são públicas.

## Google

Calendar e Gmail exigem OAuth com consentimento explícito e escopos mínimos. Token de atualização e segredo OAuth devem ficar protegidos no backend; nunca em `VITE_*`, JSON versionado ou logs. Desconexão revoga acesso quando possível e interrompe jobs. Sincronização registra escopos, data e falhas. Escopos de leitura de Gmail podem exigir verificação e avaliação adicional se dados forem armazenados no servidor; validar exigências antes de usar em produção.

Calendar local: consentimento único, o do login. A API Linux lê (somente leitura, via `secret-tool`) o refresh token que o Tauri guardou no keyring, confere o `sub` do ID token com o proprietário e mantém o access token só em memória; segredo passa por pipe, nunca argv ou DynamoDB. Desconectar Calendar não revoga (o token é o do login); sair da conta revoga login e Calendar. Connect/disconnect são serializados somente em um processo local, sem transação entre chaveiro/Google/DynamoDB. Lambda não habilita esse adaptador; prova com chaveiro/conta/consentimento reais permanece pendente. Decisão e limites em [login único](../decisoes/2026-10-22_calendar-login-unico.md).

A [documentação oficial do Google Keep](https://developers.google.com/workspace/keep/api/guides) descreve a API para uso empresarial. Confirmar se a conta do proprietário é elegível; caso contrário, não prometer integração oficial. A [lista oficial de escopos Gmail](https://developers.google.com/workspace/gmail/api/auth/scopes) deve orientar o recorte mínimo.

## AWS e LLM

S3 com acesso público bloqueado, criptografia, versionamento e política de retenção; DynamoDB com criptografia e recuperação conforme necessidade. Roles Lambda com permissões por recurso. Logs sem corpos de e-mail, notas, tokens ou dados financeiros. Alarmes devem avisar erros e falhas de sincronização sem vazar conteúdo.

O servidor MCP futuro terá ferramentas de leitura e escrita separadas, escopos explícitos, limites de resultado e auditoria. Não entregar credenciais AWS ou acesso direto ao DynamoDB a clientes MCP. Pedidos de exclusão e exportação devem abranger cópias e backups conforme política definida.

## Logs da API

Implementados localmente nas sessões 07/09: saída legível em stdout/stderr com motivos controlados em pt-BR, cores só em terminal compatível (respeita `NO_COLOR`) e JSON opcional via `LOG_FORMAT=json`; níveis via `LOG_LEVEL` (padrão `info`, `debug` opt-in), UUID interno por requisição em `X-Request-Id` e no envelope de erro. Logs registram evento, nível, horário, método, template de rota reconhecido, status e duração; rota não reconhecida usa `unmatched`. Nunca registrar URL real, query, body, headers, cookies, tokens, ownerId, e-mail ou valores financeiros. Não registrar mensagens/stack arbitrárias nem serializar Error/cause/request/config de provedores. Diagnóstico usa lista explícita de nomes/códigos seguros, com percurso limitado de causas. Debug não relaxa essa política. A saída pode ser consumida futuramente pela Lambda/CloudWatch, mas implantação, retenção e alarmes continuam pendentes.

## Base Terraform preparada em 2026-10-24

IAM humano com grupos mínimos e roles MFA, boundary de runtime, S3 privado (SSE-S3, TLS 1.2+) e observabilidade estão aplicados no dev em 2026-10-27 e sem prova de autorização efetiva; o código já removeu as chaves KMS próprias (criptografia gerenciada pela AWS, ver `docs/decisoes/2026-10-27_kms-gerenciado-aws.md`), com apply pendente. Senhas, access keys e MFA não são criados pelo Terraform; instalação inicial e alterações de identidades/boundary/chaves exigem identidade externa autorizada. Contas, e-mail e orçamento são entradas locais. Detalhes de perímetro, lockout e recuperação em [S3](armazenamento-s3.md) e [infraestrutura](../../infra/README.md). Autorização por sub permanece no backend; não há isolamento IAM por usuário HTTP.

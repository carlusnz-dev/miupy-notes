# Segurança e privacidade

## Identidade

Decidido em [`../decisoes/2026-10-18_identidade.md`](../decisoes/2026-10-18_identidade.md) (não implementado): Google OIDC com PKCE e loopback no navegador do sistema, JWT authorizer no API Gateway e lista de `sub` permitidos no backend. `ownerId` = `sub`. Toda consulta e chave de objeto são derivadas da identidade validada. Rotas pessoais não são públicas.

## Google

Calendar e Gmail exigem OAuth com consentimento explícito e escopos mínimos. Token de atualização e segredo OAuth devem ficar protegidos no backend; nunca em `VITE_*`, JSON versionado ou logs. Desconexão revoga acesso quando possível e interrompe jobs. Sincronização registra escopos, data e falhas. Escopos de leitura de Gmail podem exigir verificação e avaliação adicional se dados forem armazenados no servidor; validar exigências antes de usar em produção.

A [documentação oficial do Google Keep](https://developers.google.com/workspace/keep/api/guides) descreve a API para uso empresarial. Confirmar se a conta do proprietário é elegível; caso contrário, não prometer integração oficial. A [lista oficial de escopos Gmail](https://developers.google.com/workspace/gmail/api/auth/scopes) deve orientar o recorte mínimo.

## AWS e LLM

S3 com acesso público bloqueado, criptografia, versionamento e política de retenção; DynamoDB com criptografia e recuperação conforme necessidade. Roles Lambda com permissões por recurso. Logs sem corpos de e-mail, notas, tokens ou dados financeiros. Alarmes devem avisar erros e falhas de sincronização sem vazar conteúdo.

O servidor MCP futuro terá ferramentas de leitura e escrita separadas, escopos explícitos, limites de resultado e auditoria. Não entregar credenciais AWS ou acesso direto ao DynamoDB a clientes MCP. Pedidos de exclusão e exportação devem abranger cópias e backups conforme política definida.

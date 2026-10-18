# Infraestrutura Terraform

O diretório `environments/dev/` contém a raiz Terraform inicial, ainda sem recursos. **Nenhum serviço AWS é criado por esta estrutura.** A ordem de implementação prevista é identidade/autorização, DynamoDB e S3 privados, Lambda, API Gateway HTTP e CloudWatch com alarmes; depois sincronizações e backup. Cada ambiente terá estado remoto isolado e variáveis próprias, definidas antes do primeiro `apply`.

Não versionar `.tfstate`, `.tfvars` reais, credenciais ou artefatos de Lambda. Preferir autenticação AWS fora do repositório. Plano e apply exigem revisão de custos, IAM, retenção e políticas de dados. Não executar `terraform apply` como parte de uma edição de documentação.

## Preparar o primeiro módulo

1. Resolver `docs/decisoes/pendencias.md` quanto a identidade, conta, região, orçamento e alertas.
2. Desenhar padrões de consulta e políticas de retenção em `docs/arquitetura/dados.md`.
3. Adicionar recursos e saídas em `environments/dev/`, com permissões IAM mínimas.
4. Rodar `terraform fmt -check`, `terraform init -backend=false` e `terraform validate`; revisar o plano antes de qualquer aplicação.

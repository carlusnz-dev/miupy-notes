# Infraestrutura Terraform

O diretório `environments/dev/` contém a raiz Terraform inicial, ainda sem recursos. **Nenhum serviço AWS é criado por esta estrutura.** A ordem de implementação prevista é identidade/autorização, DynamoDB e S3 privados, Lambda, API Gateway HTTP e CloudWatch com alarmes; depois sincronizações e backup. Cada ambiente terá estado remoto isolado e variáveis próprias, definidas antes do primeiro `apply`.

Preparação em 2026-10-24: Terraform `>= 1.10.0, < 2.0.0`, provider AWS `~> 6.0` e lock em `6.70.0`. A raiz atual, sem recursos, passou em `init -backend=false`, `validate` e `fmt -check -recursive` com o binário oficial Terraform `1.17.0`, fora do Docker e sem variáveis AWS. O daemon Docker estava indisponível; isso não comprova validação em contêiner, funcionamento de políticas IAM ou implantação. A implementação das quatro frentes foi bloqueada pelo limite de profundidade do Orca antes de criar workers. Consulte a [decisão de desenho](../docs/decisoes/2026-10-24_infra-aws-base.md) e o [relatório factual](../docs/relatorios/2026-10-24_infra-aws.md).

Para repetir a validação quando o daemon estiver disponível, sem montar credenciais e sem encaminhar variáveis AWS:

```sh
docker run --rm -v "$PWD":/work -w /work hashicorp/terraform:1.17.0 fmt -check -recursive infra
docker run --rm -v "$PWD/infra":/work -w /work/environments/dev hashicorp/terraform:1.17.0 init -backend=false -input=false
docker run --rm -v "$PWD/infra":/work -w /work/environments/dev hashicorp/terraform:1.17.0 validate
```

Esses comandos partem da raiz do repositório. Ainda não existe `infra/bootstrap/`; não executar planos ou aplicações para tentar completar o desenho. A ordem futura será bootstrap separado → migração de estado → ambiente dev, após implementação, revisão e autorização específica do proprietário.

Não versionar `.tfstate`, `.tfvars` reais, credenciais ou artefatos de Lambda. Preferir autenticação AWS fora do repositório. Plano e apply exigem revisão de custos, IAM, retenção e políticas de dados. Não executar `terraform apply` como parte de uma edição de documentação.

## Preparar o primeiro módulo

1. Resolver `docs/decisoes/pendencias.md` quanto a identidade, conta, região, orçamento e alertas.
2. Desenhar padrões de consulta e políticas de retenção em `docs/arquitetura/dados.md`.
3. Adicionar recursos e saídas em `environments/dev/`, com permissões IAM mínimas.
4. Rodar `terraform fmt -check`, `terraform init -backend=false` e `terraform validate`; revisar o plano antes de qualquer aplicação.

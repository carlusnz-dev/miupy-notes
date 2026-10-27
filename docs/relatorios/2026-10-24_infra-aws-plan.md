# Infra AWS — primeiro plan real do bootstrap

Data: 2026-10-24. Branch `feat/infra-aws`, HEAD inicial `5a4ffc7`. Continuidade do [login IAM](2026-10-24_infra-aws-login.md). O proprietário autorizou consultas AWS e `terraform plan`; **nenhum apply, deploy, import, migração de estado, push ou PR foi executado**.

## Resultado e comparação com a entrega

Terraform 1.17.0 executou o primeiro plano real de `infra/bootstrap` com o perfil `miupy-notes-bootstrap`, região `sa-east-1`. STS confirmou o usuário IAM esperado, sem exibir conta/ARN real. O provider reconheceu o login existente; nenhum perfil auxiliar ou exportação de credenciais foi necessário.

**`Plan: 9 to add, 0 to change, 0 to destroy.`** Código de saída 2, esperado com `-detailed-exitcode`. Inspeção JSON confirmou plano completo, aplicável e sem erro, com somente ações `create`:

- `aws_kms_key.state` e `aws_kms_alias.state`;
- `aws_s3_bucket.state`;
- `aws_s3_bucket_public_access_block.state`;
- `aws_s3_bucket_ownership_controls.state`;
- `aws_s3_bucket_versioning.state`;
- `aws_s3_bucket_server_side_encryption_configuration.state`;
- `aws_s3_bucket_lifecycle_configuration.state`;
- `aws_s3_bucket_policy.state`.

São nove recursos Terraform, correspondentes a um bucket, uma chave, seu alias e configurações do bucket. Conferidos no plano: quatro bloqueios públicos, ACLs desativadas, versionamento, SSE-KMS com Bucket Key, rotação KMS, `force_destroy=false`, retenção não corrente de 90 dias, janela KMS de 30 dias e aborto multipart em sete dias. `prevent_destroy` de bucket/chave foi conferido no código; é proteção do Terraform. A policy depende dos ARNs ainda desconhecidos. O plano não testa sua aplicação efetiva.

Não havia tfvars, override de backend nem estado local do bootstrap nos caminhos conferidos. Criado `infra/bootstrap/terraform.tfvars.json` local ignorado, sem sobrescrever arquivo existente: conta obtida por STS; região/prefixo/retenção conforme sessão anterior; nome de bucket com sufixo aleatório de 12 dígitos hexadecimais. Janela KMS de 30 dias e multipart de sete dias são propostas usadas somente para planejar, sujeitas à revisão antes de apply. Disponibilidade global do nome não foi comprovada.

Plano em `infra/bootstrap/bootstrap.tfplan` e log em `infra/bootstrap/plan.log`, ambos ignorados. Os três arquivos têm permissão `0600`; conta, nome real do bucket e conteúdo completo do plano não foram incluídos em documentação versionada. Credenciais, caches de login e arquivos pessoais preexistentes não foram abertos. Não há `terraform.tfstate` local após o plan.

## Limite de verificação AWS

Tentativas somente de leitura com AWS CLI v2, após o plano:

- `s3api list-buckets`: AccessDenied por ausência de `s3:ListAllMyBuckets`;
- `kms list-aliases` em São Paulo: AccessDeniedException por ausência de `kms:ListAliases`.

Não houve alteração de permissões ou tentativa de contornar as negativas. As respostas não comprovam nem descartam permissões de criação. Plano sem estado prevê criar tudo, mas não descobre automaticamente recursos existentes fora do estado. Portanto, a ausência de recursos na conta continua informação do proprietário, sem inventário independente confirmado. `deployedResources=[]` foi preservado; nenhum recurso foi criado nesta sessão.

## Estado das worktrees

Orca 1.4.217 acessível, runtime ready. `worktree list` encontrou 12 worktrees do miupy-notes, todas com status Orca `in-progress`. Status Git consultado sem ler os conteúdos alterados:

| Worktree | Branch | HEAD | Situação Git inicial |
|---|---|---|---|
| miupy-notes (principal) | chore/skills-permissoes-e-relatorios | 92254ee | 3 alterações rastreadas e 4 entradas não rastreadas |
| infra-aws | feat/infra-aws | 5a4ffc7 | Limpa |
| infra-aws-bootstrap | feat/infra-aws-bootstrap | 57797a3 | Limpa; ancestral da infra integrada |
| infra-aws-iam | feat/infra-aws-iam | fc8b5f8 | Limpa; ancestral da infra integrada |
| infra-aws-observabilidade | feat/infra-aws-observabilidade | 163def3 | Limpa; ancestral da infra integrada |
| infra-aws-s3 | feat/infra-aws-s3 | 04f765c | Limpa; ancestral da infra integrada |
| ui-polimento | fix/ui-polimento | fa1d58d | Limpa |
| ui-polimento-agenda | fix/ui-polimento-agenda | 74c31c1 | Limpa |
| ui-polimento-biblioteca | fix/ui-polimento-biblioteca | 037a8fc | Limpa |
| ui-polimento-design-system | fix/ui-polimento-design-system | 7f21565 | Limpa |
| ui-polimento-mobile | fix/ui-polimento-mobile | 64eaebc | Limpa |
| ui-polimento-notas-inicio | fix/ui-polimento-notas-inicio | e3b75f6 | Limpa |

As quatro branches filhas de infra não têm commits exclusivos em relação à integrada, que está nove commits à frente de cada uma. Não foram removidas ou alteradas. Frentes UI têm divergências próprias; nenhuma integração foi feita nesta sessão. Snapshot local, sem fetch.

## Comandos e verificações

- `orca skills get orca-cli --json`, `status --json` e `worktree list --json` pelo shim Linux documentado; inventário filtrado ao repositório e `git status --porcelain` em cada checkout.
- `aws sts get-caller-identity --profile miupy-notes-bootstrap --region sa-east-1 --output json`: sucesso, resposta tratada em memória. Executável `/home/cabeto/.local/bin/aws`.
- `/tmp/miupy-infra-terraform/terraform version`: 1.17.0.
- `terraform -chdir=infra/bootstrap validate -no-color`: sucesso, ambiente limpo conforme relatório anterior.
- `terraform -chdir=infra/bootstrap plan -input=false -no-color -detailed-exitcode -out=bootstrap.tfplan`: saída 2, nove criações. Ambiente AWS herdado removido e perfil/região definidos explicitamente; `TF_CLI_CONFIG_FILE=/dev/null`. Cache/provider já inicializados; não foi necessário repetir init.
- `terraform -chdir=infra/bootstrap show -json bootstrap.tfplan`: analisado em memória, sem imprimir dados reais; nove ações de criação e proteções conferidas por assertions.
- `terraform fmt -check -recursive infra`: sucesso.
- `git check-ignore --no-index` confirmou tfvars JSON, plano e log ignorados; permissões locais conferidas.

Código da aplicação e contrato HTTP não mudaram; builds web/API e testes mock não foram repetidos. Dev não foi planejado: seu backend S3 depende do bootstrap e faltam decisões de orçamento/destinatário/retenções. Arquitetura atualizada para registrar o plan real, sem marcar implantação.

## Próximos passos

1. Revisar o plano privado e as propostas de bucket, janela KMS e multipart. Confirmar ausência de conflito dos nomes e permissões necessárias ao bootstrap com identidade autorizada; as negativas de listagem não justificam AdministratorAccess.
2. Após autorização específica para criar recursos e revisar custos: aplicar somente o bootstrap. O plano salvo exige sessão válida e revisão atualizada antes do uso.
3. Proteger/copiar o estado inicial conforme procedimento documentado, migrar para backend S3 com chave KMS/lock e verificar recuperação/concorrência.
4. Definir configuração dev e executar seu próprio plan. A entrega atual prepara IAM, S3/KMS e observabilidade/custos; não cria Lambda, DynamoDB ou API Gateway.

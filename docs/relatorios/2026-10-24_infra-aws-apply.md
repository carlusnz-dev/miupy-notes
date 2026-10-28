# Infra AWS — bootstrap aplicado

Data: 2026-10-24. Branch `feat/infra-aws`, HEAD inicial `5a4ffc7`. Continuidade do [primeiro plan](2026-10-24_infra-aws-plan.md). O proprietário informou ter anexado a policy IAM ao usuário e autorizou explicitamente `terraform apply` do bootstrap para conferir no console.

## Resultado

**Bootstrap concluído em `sa-east-1`: nove recursos Terraform, sem exclusões.** Bucket privado/versionado e chave KMS dedicada, alias e configurações de proteção. Plan final com refresh retornou saída 0: `No changes. Your infrastructure matches the configuration.` Não há dev, recursos de aplicação ou migração do estado implantados por esta sessão.

STS confirmou usuário IAM `miupy-notes-bootstrap` e conta igual à do plano original, antes do apply. Plano salvo foi inspecionado novamente: nove criações somente. Credenciais, caches de login e conteúdo bruto do estado não foram abertos nem publicados.

O primeiro apply criou oito recursos e falhou no alias: `AccessDeniedException`, sem permissão na key policy para `kms:CreateAlias`. A policy IAM fornecida ao proprietário já permitia a operação, mas a delegação enumerada da chave em `infra/bootstrap/main.tf` não incluía essa ação. A [documentação KMS](https://docs.aws.amazon.com/kms/latest/developerguide/alias-access.html) confirma que CreateAlias exige autorização tanto no alias quanto na chave.

Correção mínima: acrescentada somente `kms:CreateAlias` à delegação existente da conta na key policy. Mantida exigência de permissão IAM; nenhum principal novo, curinga de ações ou mudança em proteções de exclusão. Novo plano inspecionado por JSON/assertions: **uma atualização da key policy e uma criação do alias**, sem outras mudanças ou exclusões. Segundo apply concluiu com saída 0: `1 added, 1 changed, 0 destroyed`. O recurso atualizado foi a chave já criada; nove recursos finais no total.

## Verificações reais

Executáveis: `/tmp/miupy-infra-terraform/terraform` 1.17.0 e `/home/cabeto/.local/bin/aws` v2. Perfil `miupy-notes-bootstrap`, região `sa-east-1`; variáveis AWS/TF herdadas removidas antes das operações Terraform, `TF_CLI_CONFIG_FILE=/dev/null`, `umask 077`. Comandos Terraform a partir da raiz:

| Comando | Resultado |
|---|---|
| `terraform -chdir=infra/bootstrap show -json bootstrap.tfplan` | Conta/região e nove criações conferidas em memória. |
| `terraform -chdir=infra/bootstrap apply -input=false -no-color bootstrap.tfplan` | Saída 1; oito recursos criados; alias negado pela key policy. |
| `terraform fmt -check -recursive infra/bootstrap` | Sucesso após correção. |
| `terraform -chdir=infra/bootstrap validate -no-color` | Sucesso após correção. |
| `terraform -chdir=infra/bootstrap plan -input=false -no-color -detailed-exitcode -out=alias-fix.tfplan` | Saída 2; uma criação e uma atualização. |
| `terraform -chdir=infra/bootstrap show -json alias-fix.tfplan` | Assertions confirmaram somente alias novo e adição da ação na policy, sem outras propriedades alteradas. |
| `terraform -chdir=infra/bootstrap apply -input=false -no-color alias-fix.tfplan` | Saída 0; correção aplicada e alias criado. |
| `terraform -chdir=infra/bootstrap plan -input=false -no-color -detailed-exitcode` | Saída 0; sem diferenças após refresh real. |

Consultas AWS ao bucket/chave criados confirmaram:

- `s3api get-public-access-block`: quatro bloqueios ativos;
- `s3api get-bucket-versioning`: Enabled;
- `s3api get-bucket-encryption`: SSE-KMS e Bucket Key ativos;
- `s3api get-bucket-ownership-controls`: BucketOwnerEnforced;
- `s3api get-bucket-lifecycle-configuration`: regra ativa, versões não correntes em 90 dias e multipart incompleto em sete;
- `s3api get-bucket-policy`: quatro negações esperadas de transporte/TLS/criptografia/chave;
- `kms describe-key` pelo alias: resolve para a chave criada, estado Enabled;
- `kms get-key-rotation-status` pelo KeyId: rotação ativa.

Uma consulta inicial de rotação usou alias e recebeu `InvalidArnException`: essa operação não aceita alias. Repetida com KeyId, passou. Não houve nova negativa de permissão após corrigir a key policy. Não foram refeitas listagens globais de inventário.

Estado e backup locais, logs e planos permanecem ignorados. Permissão `0600` conferida para `terraform.tfstate`, `terraform.tfstate.backup`, logs de apply e plano da correção. Log do plan final em `infra/bootstrap/plan-post-apply.log`. Conta/ARN e identificadores reais não foram incluídos nos arquivos versionados; outputs privados disponíveis por `terraform -chdir=infra/bootstrap output`.

## Documentação e limites

Atualizados READMEs de infra/bootstrap, índice de relatórios e `arquitetura.json`, com nove endereços lógicos implantados e backend local. Relatórios anteriores preservam o estado histórico. Não houve alteração de contrato HTTP ou dados da aplicação. Skills `codigo-enxuto`, `revisar-contrato` e `relatorio` aplicadas à correção e registro.

Nenhuma migração, cópia cifrada externa do estado, teste de lock/restauração, gravação de objeto de teste, dev, push ou PR. Permissão POSIX não comprova criptografia do disco. Builds/testes da aplicação não foram repetidos porque seu código não mudou. O plan final e consultas AWS verificam o bootstrap, sem provar recuperação, custo efetivo ou a aplicação de cada Deny por requisições negativas.

## Continuidade

1. Proprietário confere bucket e alias no console de São Paulo; identificadores completos foram entregues no chat e constam nos outputs locais.
2. Preparar cópia cifrada de recuperação fora do Git e permissões de objetos/lock e uso KMS para o backend. A policy inicial de bootstrap não inclui essas permissões de acesso a objetos.
3. Configurar e migrar estado para S3 conforme procedimento documentado; verificar criptografia/versionamento, concorrência do lock e restauração antes de retirar cópias locais.
4. Definir orçamento, destinatário e demais parâmetros dev antes do próximo plan; implantação dev permanece separada.

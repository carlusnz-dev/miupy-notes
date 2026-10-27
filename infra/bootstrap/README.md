# Bootstrap do estado Terraform

Raiz independente da aplicação: cria apenas o bucket de estado, com SSE-S3 (a chave KMS dedicada saiu do código em 2026-10-27; ver [decisão](../../docs/decisoes/2026-10-27_kms-gerenciado-aws.md) para a migração e a exclusão manual da chave antiga). Bootstrap implantado em `sa-east-1` em 2026-10-24 com autorização do proprietário; nove recursos Terraform, consultas de proteção aprovadas e plan posterior sem mudanças. Estado ainda local; migração S3, lock e restauração permanecem pendentes. Veja o [relatório do apply](../../docs/relatorios/2026-10-24_infra-aws-apply.md). Não altera contrato HTTP, dados do app ou isolamento por `sub`; prepara RNF-02/RNF-03. A aplicação e seus operadores não devem receber acesso a este bucket.

Terraform `>= 1.10.0, < 2.0.0`, provider AWS `~> 6.0`, lock gerado em `6.70.0`; imagem de referência fixa `hashicorp/terraform:1.17.0`. O backend inicial é local para evitar depender do bucket antes de sua criação. O [backend S3 oficial](https://developer.hashicorp.com/terraform/language/backend/s3) orienta o lock nativo e as permissões abaixo; não existe tabela DynamoDB de lock.

## Interface e proteção

Todas as entradas são obrigatórias, exceto `tags` (`map(string)`, padrão `{}`):

| Entrada | Tipo | Uso |
|---|---|---|
| `aws_account_id` | `string` | Conta autorizada; provider recusa conta diferente |
| `aws_region` | `string` | Região comercial AWS do estado |
| `name_prefix` | `string` | Prefixo de nomes |
| `state_bucket_name` | `string` | Nome S3 globalmente único, separado do app |
| `noncurrent_version_retention_days` | `number` | Retenção inteira de versões anteriores, mínimo 30 dias |
| `abort_incomplete_multipart_days` | `number` | Aborto de uploads incompletos, inteiro positivo |
| `tags` | `map(string)` | Tags adicionais sem dados pessoais |

Saídas: `state_bucket_name`, `state_bucket_arn`. Nenhuma contém credencial. Exemplos são propostas sem aprovação: região `us-east-1`, histórico de 90 dias, aborto em 7 dias.

Bucket privado com as quatro opções de bloqueio público, ACLs desativadas (`BucketOwnerEnforced`), versionamento e SSE-S3 (`AES256`). A policy nega HTTP, TLS inferior a 1.2 e uploads que peçam explicitamente outro modo SSE (`DenyExplicitNonSSES3`). Configure o backend com `encrypt=true` e **sem** `kms_key_id`: um backend que ainda envie `aws:kms` tem a escrita (inclusive do lock) negada. Não há CORS ou acesso do runtime.

O bucket tem `prevent_destroy=true` e `force_destroy=false`. Isso evita exclusão/substituição acidental enquanto os recursos permanecem no código; não impede remoção pelo console ou após apagar blocos Terraform. Proteja acesso administrativo e não remova as salvaguardas para contornar erro. Não é Object Lock ou backup imutável. A versão atual nunca expira; versões anteriores expiram após o prazo escolhido, inclusive versões antigas dos arquivos de lock. Não há transições Glacier ou réplica nesta entrega.

O provisionador inicial precisa de permissão IAM externa para criar/administrar estes recursos; a role limitada ao ambiente dev pode não bastar. Não são criados usuários, chaves de acesso ou login profiles. Use sessão temporária com MFA e política revisada; não use root rotineiramente. Não retire a delegação da conta ou o acesso do provisionador antes de testar a identidade substituta: isso pode bloquear estado e administração. A recuperação depende de administrador autorizado na conta e, excepcionalmente, do procedimento root/MFA; não foi testada.

## Ordem futura, somente após autorização específica

O passo de criação foi concluído com plano salvo e autorização específica em 2026-10-24; os exemplos abaixo preservam o procedimento para instalações novas. Neste checkout, continuar pela preparação da migração (passo 2), sem sobrescrever configuração ou estado existente. Migração e dev não foram executados. Exigem aprovar os parâmetros aplicáveis e autenticar uma sessão temporária fora do Git, sem credenciais em flags ou arquivos de backend. Executar da raiz do repositório, com Terraform 1.17.0 no PATH.

1. Criar o bootstrap com estado local protegido por permissões do sistema e disco cifrado:

```sh
umask 077
cp infra/bootstrap/terraform.tfvars.example infra/bootstrap/terraform.tfvars
# Preencher os valores locais aprovados, especialmente conta e nome único.
terraform -chdir=infra/bootstrap init -backend=false -input=false
terraform -chdir=infra/bootstrap validate
terraform -chdir=infra/bootstrap plan -out=bootstrap.tfplan
# Revisar o plano privado antes de aplicar; requer autorização para a conta real.
terraform -chdir=infra/bootstrap apply bootstrap.tfplan
terraform -chdir=infra/bootstrap output
```

2. Preservar cópia cifrada do estado inicial fora do repositório, sem imprimir ou publicar o conteúdo. Usar os outputs para preencher bucket, região e conta no arquivo local de backend (sem `kms_key_id`):

```sh
cp infra/bootstrap/backend.hcl.example infra/bootstrap/backend.hcl
# Preencher backend.hcl local com os outputs; manter key e use_lockfile=true.
cp infra/bootstrap/backend.s3.tf.example infra/bootstrap/backend_override.tf
terraform -chdir=infra/bootstrap init -migrate-state -backend-config=backend.hcl
```

Confirmar a cópia quando o Terraform solicitar. Não usar `-reconfigure` no lugar de `-migrate-state`: ele não copia o estado local. Interromper se o destino já tiver estado inesperado; não sobrescrever. Conferir no console S3 autorizado que `bootstrap/terraform.tfstate` foi escrito com versionamento/SSE-KMS e testar em manutenção autorizada que duas operações não obtêm o mesmo lock. Só depois retirar cópias locais redundantes conforme a política de backup; manter a cópia cifrada de recuperação. `.terraform/` também contém metadados privados de backend.

3. Inicializar dev somente após integrar a raiz da aplicação. Ela deve declarar seu próprio `backend "s3" {}` e ter arquivo local de configuração com **outra chave**, `dev/terraform.tfstate`, o mesmo bucket e `use_lockfile=true`. Usar somente o workspace `default`; workspaces extras exigem rever prefixes/permissões. Da raiz do repositório:

```sh
# Preparar infra/environments/dev/backend.hcl a partir do exemplo, com key dev/terraform.tfstate.
terraform -chdir=infra/environments/dev init -backend-config=backend.hcl
terraform -chdir=infra/environments/dev validate
terraform -chdir=infra/environments/dev plan -out=dev.tfplan
# Após revisão e autorização específica:
terraform -chdir=infra/environments/dev apply dev.tfplan
```

Se dev já tiver estado local, migrar com `init -migrate-state -backend-config=backend.hcl`. Nunca aplicar dev com a chave de bootstrap. Migração, exclusão ou recriação do backend precisam de procedimento separado: interromper escritores, preservar versões, restaurar em destino de recuperação e conferir serial/linhagem/dependências antes de promover. Não executar `force-unlock` sem provar que o proprietário do lock terminou. Versionamento não substitui ensaio de restauração; esse ensaio está pendente.

## Permissões do backend

Conceder à identidade humana/backend aprovada, separadamente do runtime. Para cada raiz, substituir `BUCKET` e `KEY` localmente pelos outputs e pela chave de estado correspondente:

| Ações | Recurso | Limite |
|---|---|---|
| `s3:ListBucket` | `arn:aws:s3:::BUCKET` | Condição `StringEquals` em `s3:prefix` com `KEY` e `KEY.tflock` |
| `s3:GetObject`, `s3:PutObject` | `arn:aws:s3:::BUCKET/KEY` | Estado da raiz autorizada |
| `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` | `arn:aws:s3:::BUCKET/KEY.tflock` | Lock nativo exclusivo dessa raiz |

Não conceder `s3:DeleteObject` ao estado; não conceder `s3:DeleteObjectVersion` ao uso cotidiano. A recuperação de histórico requer acesso temporário adicional (`s3:ListBucketVersions`/`s3:GetObjectVersion`) e revisão própria. Sem chave KMS, o isolamento entre `bootstrap/` e `dev/` depende só das policies S3/IAM por chave de objeto: uma identidade de dev não deve ler `bootstrap/`. São requisitos documentados, não policies de identidades criadas por esta raiz.

## Custos e limites

Estimativa inicial, sem aprovação: sem chave KMS não há custo fixo de criptografia. Assumindo poucos estados pequenos e execuções ocasionais, armazenamento/versionamento, PUT/GET/LIST e locks S3 acrescentam consumo variável pela [tabela S3](https://aws.amazon.com/s3/pricing/); retenção maior acumula versões. Não há custo de DynamoDB de lock. Região, impostos, tráfego e preços devem ser revistos antes de aplicar; sem teto automático de custo. Não foi habilitado access logging/CloudTrail: decidir auditoria e seus custos antes de produção; nenhum histórico de acesso foi comprovado.

## Verificação local realizada em 2026-10-24

Binário oficial previamente verificado pelo coordenador: `/tmp/miupy-infra-terraform/terraform`, saída `Terraform v1.17.0 on linux_amd64`. Ambiente limpo (`env -i`) não encaminhou variáveis AWS ou credenciais. Da raiz do repositório:

```sh
env -i PATH=/usr/bin:/bin CHECKPOINT_DISABLE=1 /tmp/miupy-infra-terraform/terraform fmt -check -recursive infra/bootstrap
env -i PATH=/usr/bin:/bin CHECKPOINT_DISABLE=1 /tmp/miupy-infra-terraform/terraform -chdir=infra/bootstrap init -backend=false -input=false
env -i PATH=/usr/bin:/bin CHECKPOINT_DISABLE=1 /tmp/miupy-infra-terraform/terraform -chdir=infra/bootstrap validate -no-color
git diff --check
```

Resultados: formatação e diff sem erros; init instalou `hashicorp/aws v6.70.0 (signed by HashiCorp)` e gerou `.terraform.lock.hcl`; validate retornou `Success! The configuration is valid.`. Nada disso comprova permissões efetivas, acesso ao backend, migração, lock concorrente ou restauração.

Checagem adicional local com Python/subprocess sobre `git show :CAMINHO` dos arquivos preparados: nenhum ID literal de conta de 12 dígitos, ARN com conta real, e-mail, access key ou atribuição de segredo AWS pelos padrões conferidos. `git check-ignore --no-index` confirmou oito casos ignorados (tfvars HCL/JSON, estado, plano, backend local, override, cache do provider e crash log) e preservou os três exemplos e o lockfile. O diff preparado toca exclusivamente `.gitignore` e `infra/bootstrap/`; não houve build ou testes da aplicação, pois `apps/` e `src-tauri/` não mudaram.

Tentativa real de Docker:

```sh
docker run --rm -v "$PWD":/work -w /work hashicorp/terraform:1.17.0 fmt -check -recursive infra/bootstrap
```

Falhou com `failed to connect to the docker API at unix:///var/run/docker.sock` e `connect: no such file or directory`. O executável Docker existe, mas o daemon/socket está indisponível; não houve validação em contêiner. Não foram executados AWS CLI, chamadas a contas, `plan`, `apply`, `destroy` ou `import`. O relatório geral e a atualização de arquitetura ficam a cargo da integração da frente coordenadora.

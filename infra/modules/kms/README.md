# Módulo KMS por finalidade

Cria chave simétrica gerenciada pelo cliente com rotação anual (365 dias), janela de exclusão proposta de 30 dias e alias `alias/${name_prefix}`. Instanciar separadamente para S3, CloudWatch Logs e SNS; o coordenador/raiz compõe as instâncias. Nada implantado; este módulo não contém segredos ou material criptográfico.

## Interface

Obrigatórios: `name_prefix`, `account_id`, `aws_region`, `tags` (`map(string)`) e `provisioner_arn`. Prefixo de 3–31 caracteres minúsculos/números/hífens; provisionador é usuário/role IAM desta conta, nunca ARN STS. O provider herdado deve corresponder à conta/região informadas. Suporte restrito à partição comercial `aws`.

| Opcionais | Tipo / default | Uso |
|---|---|---|
| `administrator_arns` | `list(string) = []` | Administração explícita; provisionador sempre incluído |
| `key_user_arns` | `list(string) = []` | Uso criptográfico explícito; provisionador sempre incluído |
| `s3_bucket_arns` | `list(string) = []` | ViaService S3 regional + contexto exato de bucket ou seus objetos |
| `dynamodb_table_name` | `string = null` | Habilita `CreateGrant` apenas via DynamoDB regional; a instância deve ser exclusiva da tabela |
| `cloudwatch_log_group_arns` | `list(string) = []` | Serviço Logs regional com contexto de log group exato (sem `:*`) |
| `sns_topic_arns` | `list(string) = []` | ViaService SNS regional + contexto `aws:sns:topicArn` dos usuários IAM |
| `cloudwatch_alarm_arns` | `list(string) = []` | Serviço CloudWatch, `SourceAccount` e `SourceArn` exatos dos alarmes publicadores |
| `budget_arns` | `list(string) = []` | Serviço Budgets, `SourceAccount` e `SourceArn` exatos dos budgets publicadores |
| `deletion_window_in_days` | `number = 30` | Inteiro entre 7 e 30 |

Outputs: `key_arn`, `key_id`, `alias_name`; não são segredos. Listas de recursos são exatas, exceto alarmes, que aceitam um `*` final para o prefixo aprovado do ambiente. A policy usa `ArnLike` nessa origem; a conta permanece exata. Alarmes podem vir de outra região (billing usa us-east-1); logs e tópicos devem coincidir com região/conta da chave. Uma instância não mistura contexto S3 e SNS. Fornecer publicadores CloudWatch/Budgets exige também lista de tópicos. Instância sem listas de serviço serve como chave genérica para usuários IAM explícitos; a raiz deve escolher essa opção conscientemente.

Para o S3, use ARN de bucket determinístico montado na raiz, não output de módulo que já depende desta chave. Para Logs/SNS, também prefira ARNs determinísticos ao criar recursos que usam a chave, evitando ciclos. Não se cria grant genérico nem autorização para serviço que não esteja na configuração.

## Políticas e riscos

Na integração, administradores/usuários explícitos passaram a ser condições `ArnEquals` em `aws:PrincipalArn`, com a conta proprietária em `Principal`. Assim a policy aceita referências a roles ainda não criadas e evita o ciclo KMS → IAM → KMS. A delegação da conta exige também Allow na policy IAM e não concede acesso direto a uma sessão STS nem contorna a boundary. A identidade externa inicial deve estar em `administrator_arns` e possuir suas permissões IAM de bootstrap.

A raiz da conta preserva administração e delegação IAM administrativa. Uso criptográfico direto da raiz é condicionado ao seu `aws:PrincipalArn`, para que delegação não contorne o contexto criptográfico dos usuários. Administradores explícitos não recebem decriptação por padrão; adicioná-los a `key_user_arns` somente se necessário. O provisionador tem administração e uso para impedir lockout durante manutenção. As permissões criptográficas normais de S3/SNS passam por contexto/serviço. KMS key policy usa `Resource = "*"` porque corresponde somente à chave que contém a policy, não a outras chaves da conta.

O deny de perímetro usa `aws:PrincipalArn`, preserva raiz/provisionador/administradores/usuários e não usa `NotPrincipal`. `kms:*` existe apenas nesse deny para abranger ações e grants; Allows enumeram ações. Serviços diretos são excluídos desse deny, mas não recebem acesso por essa exceção: cada Allow de serviço é limitado aos contextos/fontes explícitos. CloudWatch Logs usa a condição [documentada de encryption context](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/encrypt-log-data-kms.html), que já contém conta/região/grupo, sem exigir SourceArn ausente nas chamadas KMS desse serviço. CloudWatch/Budgets usam `SourceAccount` e `SourceArn` conforme [SNS/KMS](https://docs.aws.amazon.com/sns/latest/dg/sns-key-management.html) e [Budgets/SNS](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-sns-policy.html). Não generalizar esse contrato para EventBridge, cuja integração tem restrições diferentes.

Listas não bastam para autenticar HTTP nem isolar usuários da aplicação. A policy IAM e boundaries/SCPs continuam limitando acesso. Chave desabilitada ou excluída torna os dados antigos indisponíveis; manter chave enquanto houver objetos, versões ou logs dependentes. A janela de exclusão não é backup; após ela, recuperação não existe. Procedimento emergencial com raiz/MFA e custos de armazenamento/rotação em [armazenamento-s3.md](../../../docs/arquitetura/armazenamento-s3.md). Provisionar várias finalidades custa várias chaves, além de requests/material rotacionado; consultar [preços KMS](https://aws.amazon.com/kms/pricing/) antes de aprovar.

## Verificação real em 2026-10-24

```sh
env -i PATH=/usr/bin:/bin HOME=/tmp/miupy-infra-terraform TF_DATA_DIR=/tmp/miupy-kms-tfdata /tmp/miupy-infra-terraform/terraform -chdir=infra/modules/kms init -backend=false -input=false
env -i PATH=/usr/bin:/bin HOME=/tmp/miupy-infra-terraform TF_DATA_DIR=/tmp/miupy-kms-tfdata /tmp/miupy-infra-terraform/terraform -chdir=infra/modules/kms validate -no-color
/tmp/miupy-infra-terraform/terraform fmt -check -recursive infra/modules/kms
```

`init` instalou AWS `6.70.0` assinado e gerou lockfile versionado; `validate` retornou `Success! The configuration is valid.` e `fmt -check` passou com Terraform `1.17.0`. Cache externo e ambiente limpo sem variáveis AWS/credenciais. Requisitos `>= 1.10.0, < 2.0.0` e provider `~> 6.0`.

Tentativa Docker da frente falhou por ausência de `/var/run/docker.sock`, registrada no README S3. Não se executou plan/apply, chamada AWS ou teste de policy efetiva. `validate` comprova sintaxe/consistência com schema do provider, não autorização ou entrega de alertas/logs. A raiz integrada será validada pelo coordenador.

Avaliação adicional: `python3 /tmp/miupy-review-kms-policy.py` extraiu os locals/variáveis para scratch sem provider/recursos/estado preexistente e invocou `terraform console` com valores sintéticos nos cenários genérico, S3, Logs e SNS. Os JSONs tiveram respectivamente 5/5/6/7 statements; assertions de raiz/provisionador, ausência de curingas nos Allows e condições de serviço passaram. A primeira tentativa teve argumento string com aspas extras; após corrigir o harness, a avaliação encontrou incompatibilidade de tipos nos contextos opcionais, corrigida com alternativas JSON antes da execução aprovada. O harness e scratch são temporários fora do Git; essa verificação não simula autorização AWS.

# Infra AWS — login IAM e continuidade do primeiro plan

Data: 2026-10-24. Branch `feat/infra-aws`, HEAD da implementação `0e5912db9697655b86f9d960262380d85a5b7199`. **Login IAM confirmado; nenhum terraform plan ou apply executado nesta sessão.** Nenhum recurso AWS criado. A pedido do proprietário, a preparação do plan continuará em outra sessão.

## Resultado observado

- AWS CLI do sistema (`/usr/bin/aws`) é v1.46.1. Instalada a v2.38.5 em `/home/cabeto/.local/lib/aws-cli`, com executável `/home/cabeto/.local/bin/aws`. O comando `aws` desta shell ainda resolve para `/usr/bin/aws`: usar o caminho absoluto da v2 nos comandos abaixo.
- Instalador baixado da AWS e assinatura PGP verificada com a chave pública da documentação oficial, fingerprint `FB5D B77F D5C1 18B8 0511 ADA8 A631 0ACC 4672 475C`, em chaveiro temporário isolado. Nenhuma instalação via sudo/pacman foi feita.
- Perfil `miupy-notes-bootstrap` autenticado pelo navegador Firefox em janela privativa. A CLI pediu confirmação para substituir a associação anterior ao root pela identidade IAM `miupy-notes-bootstrap`; a troca foi confirmada e a CLI reportou atualização do perfil.
- `sts get-caller-identity` confirmou ARN no formato `arn:aws:iam::<CONTA>:user/miupy-notes-bootstrap`. ID/ARN reais, tokens, senhas e chaves não foram incluídos neste relatório. Não foram abertos arquivos de credenciais ou caches de login.
- Configuração adicional de skills/MCP oferecida pela CLI foi recusada; não foram adicionados conectores.

## Valores confirmados pelo proprietário

| Entrada do bootstrap | Valor |
|---|---|
| `aws_region` | `sa-east-1` (São Paulo) |
| `name_prefix` | `miupy-notes-bootstrap` |
| `noncurrent_version_retention_days` | `90` |
| Perfil CLI | `miupy-notes-bootstrap` |

Ainda definir/preencher localmente: conta obtida por STS, nome globalmente único do bucket de estado, janela de exclusão KMS e aborto de multipart. Os dois últimos têm propostas de 30 e sete dias no exemplo; não foram aplicados. Não foram criados tfvars reais nesta sessão nem alterados os exemplos versionados. Para dev, orçamento, destinatário, prefixo e demais retenções continuam sujeitos à confirmação; as estimativas anteriores em us-east-1 não equivalem a cotação em sa-east-1.

## Comandos e verificações reais

```sh
BROWSER='firefox --private-window %s' AWS_PAGER='' /home/cabeto/.local/bin/aws login --profile miupy-notes-bootstrap --region sa-east-1
AWS_PAGER='' /home/cabeto/.local/bin/aws sts get-caller-identity --profile miupy-notes-bootstrap --region sa-east-1 --query Arn --output text
env -i PATH=/usr/bin:/bin CHECKPOINT_DISABLE=1 TF_CLI_CONFIG_FILE=/dev/null /tmp/miupy-infra-terraform/terraform -chdir=infra/bootstrap init -backend=false -input=false -no-color
env -i PATH=/usr/bin:/bin CHECKPOINT_DISABLE=1 TF_CLI_CONFIG_FILE=/dev/null /tmp/miupy-infra-terraform/terraform -chdir=infra/bootstrap validate -no-color
```

Resultados: login concluído como usuário IAM; STS retornou a identidade esperada; init reutilizou AWS provider 6.70.0; validate retornou `Success! The configuration is valid.`. Terraform testado anteriormente permanece disponível em `/tmp/miupy-infra-terraform/terraform` (1.17.0); Terraform do sistema é 1.15.9. O diretório temporário pode desaparecer entre sessões. `git check-ignore --no-index` confirmou que tfvars e planos previstos de bootstrap/dev estão ignorados. Não houve novo build/teste de aplicação, pois não houve alteração de código.

Falhas anteriores: navegador retornou 400/“Solicitação inválida”, tentativas selecionaram root e houve confusão entre senha root e senha IAM. A causa exata das páginas de erro não foi comprovada. Foi orientado conferir acesso ao console, MFA do próprio usuário e a policy `SignInLocalDevelopmentAccess`; não foi auditada a policy efetivamente anexada. A tentativa final em janela privativa concluiu o login IAM. Consultas locais de versão chegaram a ser rejeitadas pela revisão automática com a restrição antiga a AWS; não houve tentativa de contornar a revisão. A autenticação final e a chamada STS acima foram aceitas e executadas.

## Continuidade na próxima sessão

1. Ler AGENTS.md, fontes obrigatórias, [relatório da implementação](2026-10-24_infra-aws.md), [infra/README.md](../../infra/README.md) e [bootstrap/README.md](../../infra/bootstrap/README.md). Confirmar branch/diff e preservar este relatório. O proprietário autorizou nesta conversa conexão CLI e teste de plan; apply não foi executado nem aprovado a partir de um plano revisado.
2. Repetir STS com o caminho absoluto da CLI v2 e o perfil indicado. A sessão pode expirar; se necessário, repetir login no Firefox. Confirmar que o ARN continua sendo do usuário IAM, não root. Não ler nem imprimir tokens, arquivos de credenciais ou caches.
3. Preparar configuração local ignorada do bootstrap, sem sobrescrever arquivo existente, com os valores confirmados acima e a conta verificada. Definir nome único do bucket e revisar propostas restantes. Nunca colocar conta/ARN real em arquivo versionado.
4. Se Terraform/provider não reconhecer `login_session`, usar o procedimento oficial de `credential_process`: outro perfil aponta para `/home/cabeto/.local/bin/aws configure export-credentials --profile miupy-notes-bootstrap --format process`. Configurar via CLI, sem executar a exportação para exibir credenciais no terminal/chat e sem copiar credenciais para tfvars ou Git. Esse perfil auxiliar ainda não foi criado.
5. Executar o primeiro **plan somente do bootstrap**, com o perfil correto e plano salvo em arquivo ignorado/privado; revisar resultados e eventuais AccessDenied. STS confirma identidade, não comprova permissões de criação IAM/KMS/S3. Não anexar AdministratorAccess para contornar erros; revisar permissões por recurso/operação.
6. Depois de revisar o plano e confirmar custos/autorizações: apply do bootstrap, proteção e migração do estado, só então dev. Nenhum desses passos foi executado. Manter `deployedResources=[]` até implantação comprovada. Não fazer push/PR sem instrução.

Referências oficiais: [login e credential_process](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html), [instalação/assinatura da CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html), [SignInLocalDevelopmentAccess](https://docs.aws.amazon.com/signin/latest/userguide/security-iam-awsmanpol.html#security-iam-awsmanpol-SignInLocalDevelopmentAccess). Referências e comandos operacionais não constituem verificação de implantação.

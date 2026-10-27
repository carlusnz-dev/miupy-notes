# Base Terraform AWS

> **Atualização 2026-10-27:** as chaves KMS por finalidade descritas abaixo foram retiradas do código; veja [2026-10-27_kms-gerenciado-aws.md](2026-10-27_kms-gerenciado-aws.md). O restante (IAM, S3, observabilidade, bootstrap) segue válido.

Data: 2026-10-24. Estado: código Terraform integrado e validado localmente, sem autorização de implantação. Conta, região, orçamento, destinatário e retenções permanecem decisões do proprietário.

## Escopo e alternativas

Separar bootstrap do estado e ambiente da aplicação. O bucket de estado deve ter chave KMS própria, versionamento, bloqueio público e lock nativo S3 (`use_lockfile = true`, Terraform >= 1.10). Inicialmente o bootstrap usa estado local protegido; depois migra seu próprio estado para uma chave distinta da aplicação. A criação e a migração dependem de autorização futura. Nada nesta decisão autoriza acesso à conta.

O modelo solicitado usa um usuário humano sem credenciais por papel, grupos com `sts:AssumeRole` e autogestão mínima e roles com MFA obrigatório. IAM Identity Center é a alternativa recomendada para operação recorrente: reduz credenciais duradouras e centraliza sessões. Sua configuração organizacional fica fora desta primeira entrega; senhas, MFA e eventuais credenciais temporárias são preparados manualmente pelo proprietário, fora do Terraform. Nenhuma access key ou senha deve entrar no estado.

Provisionamento deve ficar limitado aos recursos nomeados do ambiente e a permissions boundaries; `iam:PassRole` somente para a execução Lambda, com `iam:PassedToService`. Monitoramento e operação não administram IAM, KMS ou cobrança. A role API só deve existir quando os ARNs necessários forem definidos, e OIDC de deploy permanece desligado até aprovação de repositório/environment/ref. A autorização HTTP por `sub` e a construção das chaves por proprietário continuam responsabilidade do backend: a role compartilhada não isola usuários HTTP.

Chaves KMS por finalidade (estado, objetos e observabilidade) reduzem o alcance de permissões e de revogações acidentais, com custo fixo maior que uma chave única. Políticas S3/KMS devem preservar a conta proprietária e o provisionador explícito; recuperação por raiz requer procedimento manual, MFA e política IAM adequada. A revisão deve considerar lockout antes de qualquer plano real.

S3 prepara anexos, exportações, importações, capas, backups e temporários; os fluxos HTTP correspondentes não são implementados por esta infraestrutura. Não criar marcadores vazios de diretório: prefixos não exigem objetos e os marcadores não oferecem isolamento adicional. Conteúdo de notas, dados financeiros, e-mails e tokens não devem aparecer em logs.

Secrets Manager versus itens cifrados no DynamoDB permanece **pendente** para Calendar. Essa decisão depende da granularidade dos segredos, custo, rotação, exportação e coordenação distribuída de connect/disconnect; não habilitar o conector Lambda antes de resolver o cofre e a corrida entre instâncias.

## Propostas para decisão

Região `us-east-1`, orçamento mensal de US$ 10, logs da aplicação por 30 dias, auditoria por 90 dias e versões S3 antigas por 90 dias são propostas. Exportações por 30 dias, importações por sete dias e temporários por um dia também exigem aprovação. Alarmes de cobrança usam obrigatoriamente `us-east-1`, independentemente da região da aplicação. Alertas financeiros chegam com atraso de horas e não impõem teto rígido de gastos.

CloudTrail completo permanece para sessão futura; filtros/alarmes de uma trilha externa, Cost Anomaly Detection, request metrics S3 e OIDC têm flags desligadas e exigem avaliação de custo/escopo e ativação explícita. O destinatário dos alertas só entra por variável sem default; exemplos devem usar `voce@example.com`. Conta e região também entram por variáveis, sem identificador real versionado.

## Referências verificadas

- [Backend S3 e permissões distintas do estado e do lock](https://developer.hashicorp.com/terraform/language/backend/s3).
- [Lock nativo S3 disponível desde Terraform 1.10](https://docs.aws.amazon.com/prescriptive-guidance/latest/terraform-aws-provider-best-practices/backend.html).
- APIs oficiais consultadas em 2026-10-24: [provider AWS](https://registry.terraform.io/v1/providers/hashicorp/aws) retornou `6.70.0`; [Terraform](https://checkpoint-api.hashicorp.com/v1/check/terraform) retornou `1.17.0`. Restringir AWS a `~> 6.0` e versionar o lock; usar imagem Terraform fixa `1.17.0` nas instruções locais.
- [KMS](https://aws.amazon.com/kms/pricing/), [CloudWatch](https://aws.amazon.com/cloudwatch/pricing/), [Budgets](https://aws.amazon.com/aws-cost-management/aws-budgets/pricing/) e [CloudTrail](https://aws.amazon.com/cloudtrail/pricing/): custos variam por uso e região. Budgets de monitoramento/notificação são gratuitos; a franquia de dois refere-se a budgets com ações. Rotação KMS pode acrescentar custo das duas primeiras rotações.

## Integração e limites confirmados

A raiz dev cria as duas chaves de aplicação (objetos e observabilidade), acrescentando chave billing em us-east-1 se necessário; bootstrap tem chave própria. A identidade externa inicial é input obrigatório e permanece nas allowlists. Roles futuras aparecem em condições PrincipalArn, sem depender de sua existência na criação da chave. O provisionador não altera humanos/boundary nem cria chaves: instalação e alterações estruturais continuam externas. API e OIDC ficam desligados; nenhum serviço de aplicação foi criado. HTTP API começa com métricas por logs porque ApiId é gerado, e recebe métricas nativas somente quando informado. Validação usou binário oficial local por orientação do coordenador após falha Docker; testes com mocks não comprovam autorização AWS.

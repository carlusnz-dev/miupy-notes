variable "name_prefix" {
  description = "Prefixo exclusivo do ambiente, usado também no path IAM."
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,31}$", var.name_prefix))
    error_message = "Use de 3 a 32 caracteres minúsculos, números e hífens."
  }
}
variable "account_id" {
  description = "ID da conta proprietária; sem valor real no Git."
  type        = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "A conta deve conter exatamente 12 dígitos."
  }
}
variable "aws_region" {
  description = "Região comercial AWS dos recursos do aplicativo."
  type        = string
  validation {
    condition     = can(regex("^[a-z]{2}-[a-z]+-[0-9]+$", var.aws_region))
    error_message = "Informe uma região comercial AWS válida."
  }
}
variable "tags" {
  description = "Tags comuns; não inclua dados pessoais."
  type        = map(string)
}
variable "app_bucket_arn" {
  description = "ARN determinístico do bucket do aplicativo; nunca o de estado."
  type        = string
  validation {
    condition     = can(regex("^arn:aws:s3:::[a-z0-9.-]+$", var.app_bucket_arn))
    error_message = "Informe ARN de bucket S3 comercial sem sufixo de objeto."
  }
}
variable "app_kms_key_arn" {
  description = "ARN exato da chave KMS dedicada aos objetos do aplicativo."
  type        = string
  validation {
    condition     = can(regex("^arn:aws:kms:${var.aws_region}:${var.account_id}:key/[a-zA-Z0-9-]+$", var.app_kms_key_arn))
    error_message = "A chave deve pertencer à conta/região do ambiente; aliases e curingas não são aceitos."
  }
}
variable "operator_s3_prefixes" {
  description = "Prefixos de objetos que o operador poderá ler/escrever, sem isolamento HTTP por usuário."
  type        = set(string)
  default     = ["attachments/", "exports/", "imports/", "library/covers/", "tmp/uploads/"]
  validation {
    condition     = alltrue([for p in var.operator_s3_prefixes : can(regex("^[a-zA-Z0-9/_-]+/$", p)) && !startswith(p, "/")])
    error_message = "Prefixos devem ser relativos, terminar em / e não conter curingas."
  }
}
variable "enable_api_role" {
  description = "Cria a role Lambda somente após definir tabela e log group futuros."
  type        = bool
  default     = false
  validation {
    condition     = !var.enable_api_role || (var.api_table_arn != null && var.api_log_group_arn != null)
    error_message = "Habilitar API exige api_table_arn e api_log_group_arn."
  }
}
variable "api_table_arn" {
  description = "ARN exato da futura tabela; Query não recebe acesso automático a índices."
  type        = string
  default     = null
  validation {
    condition     = var.api_table_arn == null ? true : can(regex("^arn:aws:dynamodb:${var.aws_region}:${var.account_id}:table/${var.name_prefix}-[a-zA-Z0-9_.-]+$", var.api_table_arn))
    error_message = "A tabela deve pertencer à conta/região e ao prefixo do ambiente."
  }
}
variable "api_log_group_arn" {
  description = "ARN do log group da API sem :*; provisionado fora da role."
  type        = string
  default     = null
  validation {
    condition     = var.api_log_group_arn == null ? true : can(regex("^arn:aws:logs:${var.aws_region}:${var.account_id}:log-group:/aws/lambda/${var.name_prefix}-api$", var.api_log_group_arn))
    error_message = "Use o ARN sem :* do log group /aws/lambda/<name_prefix>-api."
  }
}
variable "api_s3_prefixes" {
  description = "Sem acesso S3/KMS de runtime até existir código consumidor e prefixos aprovados."
  type        = set(string)
  default     = []
  validation {
    condition     = alltrue([for p in var.api_s3_prefixes : can(regex("^[a-zA-Z0-9/_-]+/$", p)) && !startswith(p, "/")])
    error_message = "Prefixos devem ser relativos, terminar em / e não conter curingas."
  }
}
variable "backend_bucket_arn" {
  description = "Bucket de estado separado, opcional; nunca igual ao aplicativo."
  type        = string
  default     = null
  validation {
    condition     = var.backend_bucket_arn == null ? true : can(regex("^arn:aws:s3:::[a-z0-9.-]+$", var.backend_bucket_arn)) && var.backend_bucket_arn != var.app_bucket_arn
    error_message = "Use ARN de bucket de estado separado do aplicativo."
  }
  validation {
    condition     = (var.backend_bucket_arn == null && var.backend_state_key == null && var.backend_kms_key_arn == null) || (var.backend_bucket_arn != null && var.backend_state_key != null && var.backend_kms_key_arn != null)
    error_message = "Configure as três variáveis backend juntas ou mantenha todas nulas."
  }
}
variable "backend_state_key" {
  description = "Chave exata do estado; workspaces adicionais exigem revisão explícita."
  type        = string
  default     = null
  validation {
    condition     = var.backend_state_key == null ? true : can(regex("^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$", var.backend_state_key)) && !endswith(var.backend_state_key, ".tflock")
    error_message = "Use chave relativa sem curingas e sem sufixo .tflock."
  }
}
variable "backend_kms_key_arn" {
  description = "ARN exato da chave de estado; permissão apenas no provisionador."
  type        = string
  default     = null
  validation {
    condition     = var.backend_kms_key_arn == null ? true : can(regex("^arn:aws:kms:[a-z0-9-]+:${var.account_id}:key/[a-zA-Z0-9-]+$", var.backend_kms_key_arn)) && var.backend_kms_key_arn != var.app_kms_key_arn
    error_message = "Use chave de estado da própria conta separada da chave do aplicativo."
  }
}
variable "enable_github_oidc" {
  description = "Esqueleto futuro desligado: reutiliza provider OIDC existente, nunca cria credenciais."
  type        = bool
  default     = false
  validation {
    condition     = !var.enable_github_oidc || (var.github_oidc_provider_arn != null && var.github_repository != null && var.github_subject != null)
    error_message = "OIDC exige provider, repositório e subject exato aprovados."
  }
}
variable "github_oidc_provider_arn" {
  description = "ARN de provider GitHub previamente criado por administrador externo."
  type        = string
  default     = null
  validation {
    condition     = var.github_oidc_provider_arn == null ? true : var.github_oidc_provider_arn == "arn:aws:iam::${var.account_id}:oidc-provider/token.actions.githubusercontent.com"
    error_message = "O provider deve ser GitHub Actions na própria conta."
  }
}
variable "github_repository" {
  description = "owner/repo aprovado para deploy futuro."
  type        = string
  default     = null
  validation {
    condition     = var.github_repository == null ? true : can(regex("^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$", var.github_repository))
    error_message = "Informe owner/repo sem curingas."
  }
}
variable "github_subject" {
  description = "Subject exato repo:owner/repo:environment:NOME ou repo:owner/repo:ref:refs/heads/BRANCH."
  type        = string
  default     = null
  validation {
    condition     = var.github_subject == null ? true : startswith(var.github_subject, "repo:${coalesce(var.github_repository, "unset")}:") && can(regex("^repo:[^:*?]+/[^:*?]+:(environment:[^:*?]+|ref:refs/heads/[^:*?]+)$", var.github_subject))
    error_message = "Use subject exato do repositório aprovado, limitado a environment ou branch."
  }
}
variable "additional_bucket_arns" {
  description = "Buckets auxiliares do ambiente (ex.: access logs), nunca estado; somente administração S3."
  type        = set(string)
  default     = []
  validation {
    condition     = alltrue([for arn in var.additional_bucket_arns : can(regex("^arn:aws:s3:::${var.name_prefix}-[a-z0-9.-]+$", arn)) && arn != var.backend_bucket_arn])
    error_message = "Buckets auxiliares devem usar o prefixo do ambiente e excluir o backend."
  }
}
variable "additional_kms_key_arns" {
  description = "Chaves auxiliares exatas do ambiente, aprovadas pelo proprietário (logs/alertas)."
  type        = set(string)
  default     = []
  validation {
    condition     = alltrue([for arn in var.additional_kms_key_arns : can(regex("^arn:aws:kms:${var.aws_region}:${var.account_id}:key/[a-zA-Z0-9-]+$", arn)) && arn != var.backend_kms_key_arn])
    error_message = "Chaves auxiliares devem pertencer à conta/região e excluir a chave de estado."
  }
}

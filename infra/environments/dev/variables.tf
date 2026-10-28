variable "name_prefix" {
  description = "Prefixo determinístico do ambiente (ex.: miupy-dev)."
  type        = string
  nullable    = false
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,14}[a-z0-9]$", var.name_prefix))
    error_message = "Valor inválido para name_prefix."
  }
}

variable "account_id" {
  description = "Conta proprietária informada pelo operador."
  type        = string
  nullable    = false
  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "Valor inválido para account_id."
  }
}

variable "aws_region" {
  description = "Região dos recursos da aplicação."
  type        = string
  nullable    = false
  validation {
    condition     = can(regex("^[a-z]{2}-[a-z]+-[0-9]+$", var.aws_region))
    error_message = "Valor inválido para aws_region."
  }
}

variable "google_client_id" {
  description = "Audience do ID token Google validado pelo JWT authorizer."
  type        = string
  nullable    = false
  validation {
    condition     = can(regex("^[A-Za-z0-9_-]+\\.apps\\.googleusercontent\\.com$", var.google_client_id))
    error_message = "Informe o Client ID Google completo."
  }
}

variable "allowed_subs_secret_arn" {
  description = "Segredo pré-existente com sub Google separados por vírgula; o conteúdo não entra no Terraform."
  type        = string
  nullable    = false
  validation {
    condition     = can(regex("^arn:aws:secretsmanager:${var.aws_region}:${var.account_id}:secret:[A-Za-z0-9/_+=.@-]+$", var.allowed_subs_secret_arn))
    error_message = "Informe ARN exato do segredo nesta conta e região."
  }
}

variable "cors_allowed_origins" {
  description = "Origens exatas do aplicativo desktop autorizadas no HTTP API."
  type        = set(string)
  nullable    = false
  validation {
    condition     = length(var.cors_allowed_origins) > 0 && alltrue([for origin in var.cors_allowed_origins : can(regex("^(https?://|tauri://)[A-Za-z0-9.:-]+$", origin))])
    error_message = "Informe ao menos uma origem HTTP(S) ou tauri:// exata, sem curingas."
  }
}

variable "allowed_cidrs" {
  description = "CIDRs IPv4/IPv6 com acesso à API (inclusive /health); a Lambda recusa qualquer outra origem com 403. Valor pessoal: só em tfvars local."
  type        = list(string)
  nullable    = false
  sensitive   = true
  validation {
    condition     = length(var.allowed_cidrs) > 0 && alltrue([for cidr in var.allowed_cidrs : can(cidrhost(cidr, 0)) && !endswith(cidr, "/0")])
    error_message = "Informe ao menos um CIDR válido (ex.: 203.0.113.0/24 ou 2001:db8::/32); /0 não é aceito."
  }
}

variable "api_throttling_rate_limit" {
  description = "Requisições por segundo sustentadas aceitas pelo stage; excedentes recebem 429."
  type        = number
  default     = 5
  validation {
    condition     = var.api_throttling_rate_limit >= 1 && var.api_throttling_rate_limit <= 100
    error_message = "Taxa deve estar entre 1 e 100 requisições por segundo."
  }
}

variable "api_throttling_burst_limit" {
  description = "Rajada máxima aceita pelo stage."
  type        = number
  default     = 10
  validation {
    condition     = var.api_throttling_burst_limit >= 1 && var.api_throttling_burst_limit <= 200 && floor(var.api_throttling_burst_limit) == var.api_throttling_burst_limit
    error_message = "Rajada deve ser inteira entre 1 e 200."
  }
}

variable "lambda_memory_mb" {
  description = "Memória da função HTTP."
  type        = number
  default     = 512
  validation {
    condition     = var.lambda_memory_mb >= 128 && var.lambda_memory_mb <= 10240 && floor(var.lambda_memory_mb) == var.lambda_memory_mb
    error_message = "Memória deve ser inteira entre 128 e 10240 MB."
  }
}

variable "lambda_reserved_concurrency" {
  description = "Teto de invocações simultâneas da API; limita o custo de tráfego negado, que ainda invoca a Lambda. null dispensa a reserva (contas com limite 10 não aceitam reservar)."
  type        = number
  default     = 5
  validation {
    condition     = var.lambda_reserved_concurrency == null ? true : var.lambda_reserved_concurrency >= 1 && var.lambda_reserved_concurrency <= 20 && floor(var.lambda_reserved_concurrency) == var.lambda_reserved_concurrency
    error_message = "Concorrência reservada deve ser null ou inteira entre 1 e 20."
  }
}

variable "alert_email" {
  description = "Destino de alertas; confirmação SNS manual obrigatória."
  type        = string
  nullable    = false
  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.alert_email))
    error_message = "Valor inválido para alert_email."
  }
}

variable "monthly_budget_usd" {
  description = "Limite proposto pelo proprietário em USD, sem filtro de serviço/tag."
  type        = number
  nullable    = false
  validation {
    condition     = var.monthly_budget_usd > 0
    error_message = "Valor inválido para monthly_budget_usd."
  }
}

variable "app_log_retention_days" {
  description = "Retenção proposta dos logs da aplicação."
  type        = number
  default     = 30
  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653], var.app_log_retention_days)
    error_message = "Valor inválido para app_log_retention_days."
  }
}

variable "audit_log_retention_days" {
  description = "Retenção proposta do log group de auditoria."
  type        = number
  default     = 90
  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653], var.audit_log_retention_days)
    error_message = "Valor inválido para audit_log_retention_days."
  }
}

variable "lambda_timeout_seconds" {
  description = "Timeout da função HTTP em segundos."
  type        = number
  default     = 30
  validation {
    condition     = var.lambda_timeout_seconds >= 1 && var.lambda_timeout_seconds <= 900
    error_message = "Valor inválido para lambda_timeout_seconds."
  }
}

variable "api_4xx_threshold" {
  description = "Contagem anormal proposta de 4xx em cinco minutos."
  type        = number
  default     = 20
  validation {
    condition     = var.api_4xx_threshold > 0
    error_message = "Valor inválido para api_4xx_threshold."
  }
}

variable "enable_cloudtrail_alarms" {
  description = "Habilita filtros/alertas root e IAM; exige trilha de gerenciamento externa."
  type        = bool
  default     = false
}

variable "cloudtrail_log_group_name" {
  description = "Log group de trilha externa, ou null para usar o grupo de auditoria deste módulo."
  type        = string
  default     = null
}

variable "enable_cost_anomaly_detection" {
  description = "Opt-in de monitor de anomalia de custo e resumo diário por e-mail."
  type        = bool
  default     = false
}

variable "exports_retention_days" {
  description = "Expiração proposta de exportações e suas versões antigas."
  type        = number
  default     = 30
  validation {
    condition     = var.exports_retention_days >= 1 && floor(var.exports_retention_days) == var.exports_retention_days
    error_message = "Informe um número inteiro positivo de dias."
  }
}

variable "imports_retention_days" {
  description = "Expiração proposta de importações e suas versões antigas."
  type        = number
  default     = 7
  validation {
    condition     = var.imports_retention_days >= 1 && floor(var.imports_retention_days) == var.imports_retention_days
    error_message = "Informe um número inteiro positivo de dias."
  }
}

variable "tmp_retention_days" {
  description = "Expiração proposta de uploads temporários e versões antigas."
  type        = number
  default     = 1
  validation {
    condition     = var.tmp_retention_days >= 1 && floor(var.tmp_retention_days) == var.tmp_retention_days
    error_message = "Informe um número inteiro positivo de dias."
  }
}

variable "noncurrent_retention_days" {
  description = "Expiração proposta de versões não correntes dos demais prefixos."
  type        = number
  default     = 90
  validation {
    condition     = var.noncurrent_retention_days >= 1 && floor(var.noncurrent_retention_days) == var.noncurrent_retention_days
    error_message = "Informe um número inteiro positivo de dias."
  }
}

variable "backup_transition_days" {
  description = "Dias propostos até transição de backups para Glacier Flexible Retrieval."
  type        = number
  default     = 90
  validation {
    condition     = var.backup_transition_days >= 1 && floor(var.backup_transition_days) == var.backup_transition_days
    error_message = "Informe um número inteiro positivo de dias."
  }
}

variable "backup_retention_days" {
  description = "Expiração proposta dos backups correntes."
  type        = number
  default     = 365
  validation {
    condition     = var.backup_retention_days >= 1 && floor(var.backup_retention_days) == var.backup_retention_days
    error_message = "Informe um número inteiro positivo de dias."
  }
}

variable "access_logs_retention_days" {
  description = "Expiração proposta dos logs de acesso e, separadamente, de versões antigas."
  type        = number
  default     = 90
  validation {
    condition     = var.access_logs_retention_days >= 1 && floor(var.access_logs_retention_days) == var.access_logs_retention_days
    error_message = "Informe um número inteiro positivo de dias."
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
  description = "Referencia opcional do backend separado; configurar bucket e chave do estado juntos."
  type        = string
  default     = null
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

variable "initial_provisioner_arn" {
  description = "ARN IAM da identidade externa que cria IAM inicialmente; preservado no perímetro dos buckets."
  type        = string
  validation {
    condition     = can(regex("^arn:aws:iam::${var.account_id}:(role|user)/[A-Za-z0-9+=,.@_/-]+$", var.initial_provisioner_arn))
    error_message = "Informe ARN IAM exato da conta, nunca ARN de sessao STS."
  }
}
variable "tags" {
  description = "Tags adicionais sem dados pessoais."
  type        = map(string)
  default     = {}
}
variable "enable_s3_request_metrics" {
  description = "Proposta opt-in: metrics e alarmes S3 juntos, com custo adicional."
  type        = bool
  default     = false
}

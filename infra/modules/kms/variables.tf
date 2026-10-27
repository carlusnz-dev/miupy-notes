variable "name_prefix" {
  description = "Prefixo determinístico do ambiente/finalidade, sem dados pessoais."
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,29}[a-z0-9]$", var.name_prefix))
    error_message = "Use 3 a 31 caracteres minúsculos, números ou hífen, iniciando com letra."
  }
}

variable "account_id" {
  description = "ID da conta proprietária, informado localmente."
  type        = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "Informe os 12 dígitos da conta proprietária."
  }
}

variable "aws_region" {
  description = "Região do provider que instancia este módulo."
  type        = string
  validation {
    condition     = can(regex("^[a-z]{2}-[a-z]+-[0-9]+$", var.aws_region))
    error_message = "Informe uma região AWS válida da partição comercial."
  }
}

variable "tags" {
  description = "Tags comuns sem dados pessoais."
  type        = map(string)
}

variable "provisioner_arn" {
  description = "ARN IAM estável do usuário ou role provisionadora; nunca ARN STS de sessão."
  type        = string
  validation {
    condition     = can(regex("^arn:aws:iam::${var.account_id}:(role|user)/[A-Za-z0-9+=,.@_/-]+$", var.provisioner_arn))
    error_message = "O provisionador deve ser usuário ou role IAM desta conta, sem curingas."
  }
}

variable "administrator_arns" {
  description = "Administradores IAM explícitos, além do provisionador obrigatório."
  type        = list(string)
  default     = []
  validation {
    condition     = alltrue([for arn in var.administrator_arns : can(regex("^arn:aws:iam::${var.account_id}:(role|user)/[A-Za-z0-9+=,.@_/-]+$", arn))])
    error_message = "Use ARNs IAM desta conta, sem curingas ou sessões STS."
  }
}

variable "key_user_arns" {
  description = "Usuários/roles IAM de uso criptográfico, além do provisionador."
  type        = list(string)
  default     = []
  validation {
    condition     = alltrue([for arn in var.key_user_arns : can(regex("^arn:aws:iam::${var.account_id}:(role|user)/[A-Za-z0-9+=,.@_/-]+$", arn))])
    error_message = "Use ARNs IAM desta conta, sem curingas ou sessões STS."
  }
}

variable "s3_bucket_arns" {
  description = "Buckets exatos para restringir usuários KMS via S3; inclui contexto de bucket key e objetos."
  type        = list(string)
  default     = []
  validation {
    condition     = alltrue([for arn in var.s3_bucket_arns : can(regex("^arn:aws:s3:::[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$", arn))])
    error_message = "Informe ARNs exatos da conta/região/finalidade esperadas, sem curingas."
  }
}

variable "dynamodb_table_name" {
  description = "Tabela exclusiva desta chave; autoriza grants somente via DynamoDB."
  type        = string
  default     = null
  validation {
    condition     = var.dynamodb_table_name == null ? true : can(regex("^[A-Za-z0-9_.-]{3,255}$", var.dynamodb_table_name))
    error_message = "Informe o nome exato da tabela DynamoDB."
  }
}

variable "cloudwatch_log_group_arns" {
  description = "ARNs exatos de log groups, sem sufixo :*, para encryption context CloudWatch Logs."
  type        = list(string)
  default     = []
  validation {
    condition     = alltrue([for arn in var.cloudwatch_log_group_arns : can(regex("^arn:aws:logs:${var.aws_region}:${var.account_id}:log-group:[A-Za-z0-9_/#.-]+$", arn))])
    error_message = "Informe ARNs exatos da conta/região/finalidade esperadas, sem curingas."
  }
}

variable "sns_topic_arns" {
  description = "ARNs exatos de tópicos para contexto de uso dos usuários KMS via SNS."
  type        = list(string)
  default     = []
  validation {
    condition     = alltrue([for arn in var.sns_topic_arns : can(regex("^arn:aws:sns:${var.aws_region}:${var.account_id}:[A-Za-z0-9_-]+$", arn))])
    error_message = "Informe ARNs exatos da conta/região/finalidade esperadas, sem curingas."
  }
}

variable "cloudwatch_alarm_arns" {
  description = "ARNs de alarmes autorizados; aceita um curinga final no prefixo aprovado."
  type        = list(string)
  default     = []
  validation {
    condition     = alltrue([for arn in var.cloudwatch_alarm_arns : can(regex("^arn:aws:cloudwatch:[a-z0-9-]+:${var.account_id}:alarm:[A-Za-z0-9_.-]+\\*?$", arn))])
    error_message = "Informe ARNs da conta/finalidade esperadas; somente um curinga final e permitido."
  }
}

variable "budget_arns" {
  description = "ARNs exatos de budgets autorizados a publicar em SNS cifrado."
  type        = list(string)
  default     = []
  validation {
    condition     = alltrue([for arn in var.budget_arns : can(regex("^arn:aws:budgets::${var.account_id}:budget/[A-Za-z0-9_.-]+$", arn))])
    error_message = "Informe ARNs exatos da conta/região/finalidade esperadas, sem curingas."
  }
}

variable "deletion_window_in_days" {
  description = "Janela de recuperação antes da exclusão agendada da chave (proposta: 30 dias)."
  type        = number
  default     = 30
  validation {
    condition     = var.deletion_window_in_days >= 7 && var.deletion_window_in_days <= 30 && floor(var.deletion_window_in_days) == var.deletion_window_in_days
    error_message = "A janela deve ser inteira entre 7 e 30 dias."
  }
}

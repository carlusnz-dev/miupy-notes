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

variable "allowed_principal_arns" {
  description = "Usuários/roles autorizados no perímetro; IAM ainda define operações permitidas."
  type        = list(string)
  default     = []
  validation {
    condition     = alltrue([for arn in var.allowed_principal_arns : can(regex("^arn:aws:iam::${var.account_id}:(role|user)/[A-Za-z0-9+=,.@_/-]+$", arn))])
    error_message = "Liste apenas usuários ou roles IAM desta conta, sem curingas ou sessões STS."
  }
}

variable "enable_request_metrics" {
  description = "Habilita métricas pagas de requests S3, desligadas por padrão."
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

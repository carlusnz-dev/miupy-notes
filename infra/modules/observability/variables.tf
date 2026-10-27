variable "name_prefix" {
  description = "Prefixo determinístico do ambiente (ex.: miupy-dev)."
  type        = string
  nullable    = false
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,39}$", var.name_prefix))
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

variable "tags" {
  description = "Tags comuns do ambiente."
  type        = map(string)
  nullable    = false
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

variable "api_4xx_threshold" {
  description = "Contagem anormal proposta de 4xx em cinco minutos."
  type        = number
  default     = 20
  validation {
    condition     = var.api_4xx_threshold > 0
    error_message = "Valor inválido para api_4xx_threshold."
  }
}

variable "api_id" {
  description = "ID gerado do HTTP API, dimensão dos alarmes nativos 5xx/4xx."
  type        = string
  nullable    = false
}

variable "s3_request_metrics_enabled" {
  description = "Só habilitar junto das métricas de request no bucket (custo adicional)."
  type        = bool
  default     = false
}

variable "s3_bucket_name" {
  description = "Nome do bucket monitorado; exigido quando métricas S3 estão habilitadas."
  type        = string
  default     = null
}

variable "s3_metrics_filter_id" {
  description = "FilterId exato da configuração de métricas S3."
  type        = string
  default     = "all-requests"
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

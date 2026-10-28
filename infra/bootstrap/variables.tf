variable "aws_account_id" {
  description = "Conta autorizada para o bootstrap; preencher somente na configuração local."
  type        = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "Informe um ID de conta AWS de 12 dígitos."
  }
}

variable "aws_region" {
  description = "Região aprovada para o bucket e a chave de estado."
  type        = string
  validation {
    condition     = can(regex("^[a-z]{2}-[a-z]+-[0-9]+$", var.aws_region))
    error_message = "Informe uma região AWS válida da partição comercial."
  }
}

variable "name_prefix" {
  description = "Prefixo dos recursos exclusivos de bootstrap."
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,39}$", var.name_prefix))
    error_message = "Use de 3 a 40 caracteres minúsculos, números ou hífen, começando por letra."
  }
}

variable "state_bucket_name" {
  description = "Nome globalmente único, exclusivo para estados Terraform."
  type        = string
  validation {
    condition = (
      can(regex("^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$", var.state_bucket_name)) &&
      !startswith(var.state_bucket_name, "xn--") &&
      !endswith(var.state_bucket_name, "-s3alias") &&
      !endswith(var.state_bucket_name, "--ol-s3") &&
      !endswith(var.state_bucket_name, "--x-s3") &&
      !endswith(var.state_bucket_name, "--table-s3")
    )
    error_message = "Use nome S3 de 3 a 63 caracteres, sem pontos ou sufixos reservados."
  }
}

variable "noncurrent_version_retention_days" {
  description = "Retenção das versões anteriores do estado; não expira a versão atual."
  type        = number
  validation {
    condition     = var.noncurrent_version_retention_days >= 30 && floor(var.noncurrent_version_retention_days) == var.noncurrent_version_retention_days
    error_message = "A retenção deve ser um número inteiro de pelo menos 30 dias."
  }
}

variable "abort_incomplete_multipart_days" {
  description = "Dias até abortar uploads multipart incompletos."
  type        = number
  validation {
    condition     = var.abort_incomplete_multipart_days >= 1 && floor(var.abort_incomplete_multipart_days) == var.abort_incomplete_multipart_days
    error_message = "Informe um número inteiro positivo de dias."
  }
}

variable "tags" {
  description = "Tags adicionais sem dados pessoais."
  type        = map(string)
  default     = {}
}

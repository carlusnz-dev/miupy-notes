terraform {
  backend "s3" {}
}
provider "aws" {
  region              = var.aws_region
  allowed_account_ids = [var.account_id]
}
provider "aws" {
  alias               = "billing"
  region              = "us-east-1"
  allowed_account_ids = [var.account_id]
}
locals {
  tags                 = merge(var.tags, { Project = "miupy-notes", Environment = "dev", ManagedBy = "Terraform" })
  role_arns            = { for role in ["provisioner", "operator", "api"] : role => "arn:aws:iam::${var.account_id}:role/${var.name_prefix}/${var.name_prefix}-${role}" }
  bucket_arn           = "arn:aws:s3:::${var.name_prefix}-${var.account_id}-app"
  lambda_log_group_arn = "arn:aws:logs:${var.aws_region}:${var.account_id}:log-group:/aws/lambda/${var.name_prefix}-api"
}
# As chaves KMS próprias saem do código, mas continuam na conta: destroy = false esquece o recurso no estado sem
# agendar exclusão enquanto S3, DynamoDB e logs ainda podem depender delas. A exclusão é manual e posterior
# (docs/decisoes/2026-10-27_kms-gerenciado-aws.md). Remova estes blocos depois do primeiro apply.
removed {
  from = module.objects_key
  lifecycle {
    destroy = false
  }
}

removed {
  from = module.data_key
  lifecycle {
    destroy = false
  }
}

removed {
  from = module.observability_key
  lifecycle {
    destroy = false
  }
}

removed {
  from = module.billing_key
  lifecycle {
    destroy = false
  }
}

module "storage" {
  source                     = "../../modules/s3"
  name_prefix                = var.name_prefix
  account_id                 = var.account_id
  aws_region                 = var.aws_region
  tags                       = local.tags
  provisioner_arn            = local.role_arns.provisioner
  allowed_principal_arns     = [var.initial_provisioner_arn, local.role_arns.operator, local.role_arns.api]
  enable_request_metrics     = var.enable_s3_request_metrics
  exports_retention_days     = var.exports_retention_days
  imports_retention_days     = var.imports_retention_days
  tmp_retention_days         = var.tmp_retention_days
  noncurrent_retention_days  = var.noncurrent_retention_days
  backup_transition_days     = var.backup_transition_days
  backup_retention_days      = var.backup_retention_days
  access_logs_retention_days = var.access_logs_retention_days
}

module "iam" {
  source                      = "../../modules/iam"
  name_prefix                 = var.name_prefix
  account_id                  = var.account_id
  aws_region                  = var.aws_region
  tags                        = local.tags
  app_bucket_arn              = local.bucket_arn
  additional_bucket_arns      = ["arn:aws:s3:::${var.name_prefix}-${var.account_id}-access-logs"]
  api_log_group_arn           = local.lambda_log_group_arn
  operator_s3_prefixes        = var.operator_s3_prefixes
  enable_api_role             = true
  api_table_arn               = aws_dynamodb_table.data.arn
  api_allowed_subs_secret_arn = var.allowed_subs_secret_arn
  api_s3_prefixes             = var.api_s3_prefixes
  backend_bucket_arn          = var.backend_bucket_arn
  backend_state_key           = var.backend_state_key
  enable_github_oidc          = var.enable_github_oidc
  github_oidc_provider_arn    = var.github_oidc_provider_arn
  github_repository           = var.github_repository
  github_subject              = var.github_subject
}

module "observability" {
  source                        = "../../modules/observability"
  name_prefix                   = var.name_prefix
  account_id                    = var.account_id
  aws_region                    = var.aws_region
  tags                          = local.tags
  providers                     = { aws = aws, aws.billing = aws.billing }
  s3_request_metrics_enabled    = var.enable_s3_request_metrics
  s3_bucket_name                = module.storage.bucket_name
  s3_metrics_filter_id          = "EntireBucket"
  alert_email                   = var.alert_email
  monthly_budget_usd            = var.monthly_budget_usd
  app_log_retention_days        = var.app_log_retention_days
  audit_log_retention_days      = var.audit_log_retention_days
  api_4xx_threshold             = var.api_4xx_threshold
  api_id                        = aws_apigatewayv2_api.this.id
  enable_cloudtrail_alarms      = var.enable_cloudtrail_alarms
  cloudtrail_log_group_name     = var.cloudtrail_log_group_name
  enable_cost_anomaly_detection = var.enable_cost_anomaly_detection
}

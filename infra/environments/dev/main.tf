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
  tags           = merge(var.tags, { Project = "miupy-notes", Environment = "dev", ManagedBy = "Terraform" })
  role_arns      = { for role in ["provisioner", "operator", "api"] : role => "arn:aws:iam::${var.account_id}:role/${var.name_prefix}/${var.name_prefix}-${role}" }
  bucket_arn     = "arn:aws:s3:::${var.name_prefix}-${var.account_id}-app"
  log_group_arns = [for name in ["/aws/lambda/${var.name_prefix}-api", "/aws/apigateway/${var.name_prefix}-api", "/aws/cloudtrail/${var.name_prefix}-audit"] : "arn:aws:logs:${var.aws_region}:${var.account_id}:log-group:${name}"]
  budget_arn     = "arn:aws:budgets::${var.account_id}:budget/${var.name_prefix}-total-monthly"
}
module "objects_key" {
  source             = "../../modules/kms"
  name_prefix        = "${var.name_prefix}-objects"
  account_id         = var.account_id
  aws_region         = var.aws_region
  tags               = local.tags
  provisioner_arn    = local.role_arns.provisioner
  administrator_arns = [var.initial_provisioner_arn]
  key_user_arns      = [local.role_arns.operator, local.role_arns.api]
  s3_bucket_arns     = [local.bucket_arn]
}

module "data_key" {
  source              = "../../modules/kms"
  name_prefix         = "${var.name_prefix}-data"
  account_id          = var.account_id
  aws_region          = var.aws_region
  tags                = local.tags
  provisioner_arn     = local.role_arns.provisioner
  administrator_arns  = [var.initial_provisioner_arn]
  key_user_arns       = [local.role_arns.api]
  dynamodb_table_name = "${var.name_prefix}-data"
}

module "observability_key" {
  source                    = "../../modules/kms"
  name_prefix               = "${var.name_prefix}-observability"
  account_id                = var.account_id
  aws_region                = var.aws_region
  tags                      = local.tags
  provisioner_arn           = local.role_arns.provisioner
  administrator_arns        = [var.initial_provisioner_arn]
  cloudwatch_log_group_arns = local.log_group_arns
  sns_topic_arns            = ["arn:aws:sns:${var.aws_region}:${var.account_id}:${var.name_prefix}-alerts"]
  cloudwatch_alarm_arns     = ["arn:aws:cloudwatch:${var.aws_region}:${var.account_id}:alarm:${var.name_prefix}-*"]
  budget_arns               = var.aws_region == "us-east-1" ? [local.budget_arn] : []
}

module "billing_key" {
  source                = "../../modules/kms"
  name_prefix           = "${var.name_prefix}-billing"
  account_id            = var.account_id
  aws_region            = "us-east-1"
  tags                  = local.tags
  provisioner_arn       = local.role_arns.provisioner
  administrator_arns    = [var.initial_provisioner_arn]
  count                 = var.aws_region == "us-east-1" ? 0 : 1
  providers             = { aws = aws.billing }
  sns_topic_arns        = ["arn:aws:sns:us-east-1:${var.account_id}:${var.name_prefix}-billing-alerts"]
  cloudwatch_alarm_arns = ["arn:aws:cloudwatch:us-east-1:${var.account_id}:alarm:${var.name_prefix}-billing-*"]
  budget_arns           = [local.budget_arn]
}

module "storage" {
  source                     = "../../modules/s3"
  name_prefix                = var.name_prefix
  account_id                 = var.account_id
  aws_region                 = var.aws_region
  tags                       = local.tags
  provisioner_arn            = local.role_arns.provisioner
  allowed_principal_arns     = [var.initial_provisioner_arn, local.role_arns.operator, local.role_arns.api]
  kms_key_arn                = module.objects_key.key_arn
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
  app_kms_key_arn             = module.objects_key.key_arn
  additional_bucket_arns      = ["arn:aws:s3:::${var.name_prefix}-${var.account_id}-access-logs"]
  additional_kms_key_arns     = concat([module.observability_key.key_arn, module.data_key.key_arn], module.billing_key[*].key_arn)
  api_log_group_arn           = local.log_group_arns[0]
  operator_s3_prefixes        = var.operator_s3_prefixes
  enable_api_role             = true
  api_table_arn               = aws_dynamodb_table.data.arn
  api_dynamodb_kms_key_arn    = module.data_key.key_arn
  api_allowed_subs_secret_arn = var.allowed_subs_secret_arn
  api_s3_prefixes             = var.api_s3_prefixes
  backend_bucket_arn          = var.backend_bucket_arn
  backend_state_key           = var.backend_state_key
  backend_kms_key_arn         = var.backend_kms_key_arn
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
  kms_key_arn                   = module.observability_key.key_arn
  billing_kms_key_arn           = var.aws_region == "us-east-1" ? null : module.billing_key[0].key_arn
  s3_request_metrics_enabled    = var.enable_s3_request_metrics
  s3_bucket_name                = module.storage.bucket_name
  s3_metrics_filter_id          = "EntireBucket"
  alert_email                   = var.alert_email
  monthly_budget_usd            = var.monthly_budget_usd
  app_log_retention_days        = var.app_log_retention_days
  audit_log_retention_days      = var.audit_log_retention_days
  lambda_timeout_seconds        = var.lambda_timeout_seconds
  lambda_concurrency_threshold  = min(var.lambda_concurrency_threshold, coalesce(var.lambda_reserved_concurrency, var.lambda_concurrency_threshold))
  api_latency_threshold_ms      = var.api_latency_threshold_ms
  api_4xx_threshold             = var.api_4xx_threshold
  api_id                        = aws_apigatewayv2_api.this.id
  enable_native_api_alarms      = true
  enable_cloudtrail_alarms      = var.enable_cloudtrail_alarms
  cloudtrail_log_group_name     = var.cloudtrail_log_group_name
  enable_cost_anomaly_detection = var.enable_cost_anomaly_detection
}

locals {
  resource_names = {
    lambda_function = "${var.name_prefix}-api"
    dynamodb_table  = "${var.name_prefix}-data"
  }
  metric_namespace = "Miupy/${var.name_prefix}"
  log_groups = {
    lambda = { name = "/aws/lambda/${local.resource_names.lambda_function}", retention = var.app_log_retention_days }
    api    = { name = "/aws/apigateway/${var.name_prefix}-api", retention = var.app_log_retention_days }
    audit  = { name = "/aws/cloudtrail/${var.name_prefix}-audit", retention = var.audit_log_retention_days }
  }
  security_filters = var.enable_cloudtrail_alarms ? {
    root_usage = {
      group   = coalesce(var.cloudtrail_log_group_name, aws_cloudwatch_log_group.this["audit"].name)
      pattern = "{ $.userIdentity.type = \"Root\" && $.userIdentity.invokedBy NOT EXISTS && $.eventType != \"AwsServiceEvent\" }"
      value   = "1"
      unit    = "Count"
    }
    iam_changes = {
      group   = coalesce(var.cloudtrail_log_group_name, aws_cloudwatch_log_group.this["audit"].name)
      pattern = "{ $.eventSource = \"iam.amazonaws.com\" && $.readOnly = false }"
      value   = "1"
      unit    = "Count"
    }
  } : {}
}

# Sem kms_key_id: o CloudWatch Logs cifra em repouso com chave própria do serviço.
resource "aws_cloudwatch_log_group" "this" {
  for_each          = local.log_groups
  name              = each.value.name
  retention_in_days = each.value.retention
  tags              = var.tags
}

resource "aws_cloudwatch_log_metric_filter" "this" {
  for_each       = local.security_filters
  name           = "${var.name_prefix}-${each.key}"
  log_group_name = each.value.group
  pattern        = each.value.pattern

  metric_transformation {
    name      = each.key
    namespace = local.metric_namespace
    value     = each.value.value
    unit      = each.value.unit
  }
}

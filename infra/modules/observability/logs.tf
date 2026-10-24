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
  log_filters = {
    application_errors = { group = aws_cloudwatch_log_group.this["lambda"].name, pattern = "{ $.level = \"error\" || $.level = \"ERROR\" }", value = "1", unit = "Count" }
    lambda_timeouts    = { group = aws_cloudwatch_log_group.this["lambda"].name, pattern = "\"Task timed out\"", value = "1", unit = "Count" }
    api_5xx            = { group = aws_cloudwatch_log_group.this["api"].name, pattern = "{ $.status >= 500 && $.status < 600 }", value = "1", unit = "Count" }
    api_4xx            = { group = aws_cloudwatch_log_group.this["api"].name, pattern = "{ $.status >= 400 && $.status < 500 }", value = "1", unit = "Count" }
    api_latency        = { group = aws_cloudwatch_log_group.this["api"].name, pattern = "{ $.responseLatency >= 0 }", value = "$.responseLatency", unit = "Milliseconds" }
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

resource "aws_cloudwatch_log_group" "this" {
  for_each          = local.log_groups
  name              = each.value.name
  retention_in_days = each.value.retention
  kms_key_id        = var.kms_key_arn
  tags              = var.tags
}

resource "aws_cloudwatch_log_metric_filter" "this" {
  for_each       = merge(local.log_filters, local.security_filters)
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

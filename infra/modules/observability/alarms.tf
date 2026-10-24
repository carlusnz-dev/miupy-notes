locals {
  lambda_metrics = {
    errors      = { metric = "Errors", stat = "Sum", percentile = null, threshold = 1 }
    throttles   = { metric = "Throttles", stat = "Sum", percentile = null, threshold = 1 }
    duration    = { metric = "Duration", stat = null, percentile = "p95", threshold = var.lambda_timeout_seconds * 1000 * 0.8 }
    concurrency = { metric = "ConcurrentExecutions", stat = "Maximum", percentile = null, threshold = var.lambda_concurrency_threshold }
  }
  native_lambda_alarms = {
    for key, metric in local.lambda_metrics : "lambda-${key}" => {
      namespace = "AWS/Lambda", metric = metric.metric, stat = metric.stat, percentile = metric.percentile,
      threshold = metric.threshold, dimensions = { FunctionName = local.resource_names.lambda_function }
    }
  }
  # SystemErrors/ThrottledRequests exigem TableName E Operation.
  dynamodb_alarms = {
    for pair in setproduct(["GetItem", "PutItem", "UpdateItem", "DeleteItem", "Query"], ["ThrottledRequests", "SystemErrors"]) :
    "dynamodb-${lower(pair[0])}-${lower(pair[1])}" => {
      namespace = "AWS/DynamoDB", metric = pair[1], stat = "Sum", percentile = null,
      threshold = 1, dimensions = { TableName = local.resource_names.dynamodb_table, Operation = pair[0] }
    }
  }
  custom_alarms = {
    for key, metric in local.log_filters : "logs-${key}" => {
      namespace  = local.metric_namespace, metric = key, stat = key == "api_latency" ? null : "Sum",
      percentile = key == "api_latency" ? "p95" : null,
      threshold  = key == "api_latency" ? var.api_latency_threshold_ms : (key == "api_4xx" ? var.api_4xx_threshold : 1),
      dimensions = {}
    }
  }
  native_api_alarms = var.api_id != null ? {
    for key, metric in {
      errors5xx = { name = "5xx", stat = "Sum", percentile = null, threshold = 1 }
      errors4xx = { name = "4xx", stat = "Sum", percentile = null, threshold = var.api_4xx_threshold }
      latency   = { name = "Latency", stat = null, percentile = "p95", threshold = var.api_latency_threshold_ms }
      } : "api-${key}" => {
      namespace = "AWS/ApiGateway", metric = metric.name, stat = metric.stat, percentile = metric.percentile,
      threshold = metric.threshold, dimensions = { ApiId = var.api_id }
    }
  } : {}
  s3_alarms = var.s3_request_metrics_enabled ? {
    for metric in ["4xxErrors", "5xxErrors"] : "s3-${lower(metric)}" => {
      namespace = "AWS/S3", metric = metric, stat = "Sum", percentile = null,
      threshold = 1, dimensions = { BucketName = var.s3_bucket_name, FilterId = var.s3_metrics_filter_id }
    }
  } : {}
  security_alarms = {
    for key, filter in local.security_filters : "security-${key}" => {
      namespace = local.metric_namespace, metric = key, stat = "Sum", percentile = null,
      threshold = 1, dimensions = {}
    }
  }
  alarms = merge(
    local.native_lambda_alarms, local.dynamodb_alarms, local.custom_alarms,
    local.native_api_alarms, local.s3_alarms, local.security_alarms,
    {
      # UserErrors não aceita TableName: este sinal abrange a conta/região.
      dynamodb-usererrors = {
        namespace = "AWS/DynamoDB", metric = "UserErrors", stat = "Sum", percentile = null,
        threshold = 1, dimensions = {}
      }
    }
  )
}

resource "aws_cloudwatch_metric_alarm" "application" {
  for_each            = local.alarms
  alarm_name          = "${var.name_prefix}-${each.key}"
  alarm_description   = "Investigar ${each.value.namespace}/${each.value.metric}; limiar proposto em janela de 5 minutos."
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  dimensions          = each.value.dimensions
  statistic           = each.value.stat
  extended_statistic  = each.value.percentile
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = each.value.threshold
  treat_missing_data  = "notBreaching"
  actions_enabled     = true
  alarm_actions       = [aws_sns_topic.alerts.arn]
  tags                = var.tags
  depends_on          = [aws_sns_topic_policy.alerts]

  lifecycle {
    precondition {
      condition     = !var.s3_request_metrics_enabled || try(length(var.s3_bucket_name) > 0, false)
      error_message = "Métricas de request S3 exigem s3_bucket_name e configuração FilterId correspondente no bucket."
    }
  }
}

resource "aws_cloudwatch_composite_alarm" "degraded" {
  alarm_name        = "${var.name_prefix}-application-degraded"
  alarm_description = "Aplicação degradada: pelo menos um sinal operacional ultrapassou o limiar."
  # Segurança e UserErrors globais não devem representar saúde exclusiva da aplicação.
  alarm_rule = join(" OR ", [
    for key, alarm in aws_cloudwatch_metric_alarm.application : "ALARM(\"${alarm.alarm_name}\")"
    if !startswith(key, "security-") && key != "dynamodb-usererrors"
  ])
  actions_enabled = true
  alarm_actions   = [aws_sns_topic.alerts.arn]
  ok_actions      = [aws_sns_topic.alerts.arn]
  tags            = var.tags
  depends_on      = [aws_sns_topic_policy.alerts]
}

resource "aws_cloudwatch_dashboard" "application" {
  dashboard_name = "${var.name_prefix}-overview"
  dashboard_body = jsonencode({
    widgets = concat(
      [{
        type = "alarm", x = 0, y = 0, width = 24, height = 3,
        properties = {
          title = "Estado dos alarmes"
          alarms = concat(
            [aws_cloudwatch_composite_alarm.degraded.arn],
            [for alarm in aws_cloudwatch_metric_alarm.application : alarm.arn],
            [for alarm in aws_cloudwatch_metric_alarm.billing : alarm.arn]
          )
        }
      }],
      [for index, key in sort(keys(local.alarms)) : {
        type = "metric", x = (index % 3) * 8, y = 3 + floor(index / 3) * 6, width = 8, height = 6,
        properties = {
          title = key, region = var.aws_region, period = 300,
          stat  = coalesce(local.alarms[key].percentile, local.alarms[key].stat),
          metrics = [concat(
            [local.alarms[key].namespace, local.alarms[key].metric],
            flatten([for dimension, value in local.alarms[key].dimensions : [dimension, value]])
          )]
        }
      }],
      [{
        type = "metric", x = 0, y = 3 + ceil(length(local.alarms) / 3) * 6, width = 24, height = 6,
        properties = {
          title   = "Custo estimado total (USD)", region = "us-east-1", period = 21600, stat = "Maximum",
          metrics = [["AWS/Billing", "EstimatedCharges", "Currency", "USD"]]
        }
      }]
    )
  })
}

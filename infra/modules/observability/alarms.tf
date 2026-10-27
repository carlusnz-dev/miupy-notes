locals {
  lambda_function = local.resource_names.lambda_function
  dynamodb_table  = local.resource_names.dynamodb_table
  # Conjunto essencial (7 alarmes de métrica no padrão, mais os 3 de billing): cada alarme extra custa US$ 0,10/mês
  # fora da franquia de 10. Latência, concorrência, duração e métricas derivadas de logs ficam no dashboard/logs.
  essential_alarms = {
    lambda-errors = {
      namespace = "AWS/Lambda", metric = "Errors", stat = "Sum", threshold = 1, dimensions = { FunctionName = local.lambda_function }
    }
    lambda-throttles = {
      namespace = "AWS/Lambda", metric = "Throttles", stat = "Sum", threshold = 1, dimensions = { FunctionName = local.lambda_function }
    }
    api-errors5xx = {
      namespace = "AWS/ApiGateway", metric = "5xx", stat = "Sum", threshold = 1, dimensions = { ApiId = var.api_id }
    }
    api-errors4xx = {
      namespace = "AWS/ApiGateway", metric = "4xx", stat = "Sum", threshold = var.api_4xx_threshold, dimensions = { ApiId = var.api_id }
    }
    # Métricas por tabela: cobrem todas as operações com um alarme (ThrottledRequests/SystemErrors exigem Operation).
    dynamodb-read-throttles = {
      namespace = "AWS/DynamoDB", metric = "ReadThrottleEvents", stat = "Sum", threshold = 1, dimensions = { TableName = local.dynamodb_table }
    }
    dynamodb-write-throttles = {
      namespace = "AWS/DynamoDB", metric = "WriteThrottleEvents", stat = "Sum", threshold = 1, dimensions = { TableName = local.dynamodb_table }
    }
    # UserErrors não aceita TableName: este sinal abrange a conta/região.
    dynamodb-usererrors = {
      namespace = "AWS/DynamoDB", metric = "UserErrors", stat = "Sum", threshold = 1, dimensions = {}
    }
  }
  s3_alarms = var.s3_request_metrics_enabled ? {
    for metric in ["4xxErrors", "5xxErrors"] : "s3-${lower(metric)}" => {
      namespace = "AWS/S3", metric = metric, stat = "Sum",
      threshold = 1, dimensions = { BucketName = var.s3_bucket_name, FilterId = var.s3_metrics_filter_id }
    }
  } : {}
  security_alarms = {
    for key, filter in local.security_filters : "security-${key}" => {
      namespace = local.metric_namespace, metric = key, stat = "Sum", threshold = 1, dimensions = {}
    }
  }
  alarms = merge(local.essential_alarms, local.s3_alarms, local.security_alarms)
}

resource "aws_cloudwatch_metric_alarm" "application" {
  for_each            = local.alarms
  alarm_name          = "${var.name_prefix}-${each.key}"
  alarm_description   = "Investigar ${each.value.namespace}/${each.value.metric}; limiar proposto em janela de 5 minutos."
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  dimensions          = each.value.dimensions
  statistic           = each.value.stat
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

resource "aws_cloudwatch_dashboard" "application" {
  dashboard_name = "${var.name_prefix}-overview"
  dashboard_body = jsonencode({
    widgets = concat(
      [{
        type = "alarm", x = 0, y = 0, width = 24, height = 3,
        properties = {
          title = "Estado dos alarmes"
          alarms = concat(
            [for alarm in aws_cloudwatch_metric_alarm.application : alarm.arn],
            [for alarm in aws_cloudwatch_metric_alarm.billing : alarm.arn]
          )
        }
      }],
      [for index, key in sort(keys(local.alarms)) : {
        type = "metric", x = (index % 3) * 8, y = 3 + floor(index / 3) * 6, width = 8, height = 6,
        properties = {
          title = key, region = var.aws_region, period = 300,
          stat  = local.alarms[key].stat,
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

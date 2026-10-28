resource "aws_budgets_budget" "monthly" {
  provider     = aws.billing
  account_id   = var.account_id
  name         = local.budget_name
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"
  tags         = var.tags

  # Sem cost_filter: custo total da conta, incluindo taxas, suporte e créditos.
  cost_types {
    include_credit             = true
    include_discount           = true
    include_other_subscription = true
    include_recurring          = true
    include_refund             = true
    include_subscription       = true
    include_support            = true
    include_tax                = true
    include_upfront            = true
    use_amortized              = false
    use_blended                = false
  }

  dynamic "notification" {
    for_each = {
      actual50    = { threshold = 50, type = "ACTUAL" }
      actual80    = { threshold = 80, type = "ACTUAL" }
      actual100   = { threshold = 100, type = "ACTUAL" }
      forecast100 = { threshold = 100, type = "FORECASTED" }
    }
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value.threshold
      threshold_type             = "PERCENTAGE"
      notification_type          = notification.value.type
      subscriber_email_addresses = [var.alert_email]
      subscriber_sns_topic_arns  = [local.billing_topic_arn]
    }
  }

  depends_on = [aws_sns_topic_policy.alerts, aws_sns_topic_policy.billing]
}

resource "aws_cloudwatch_metric_alarm" "billing" {
  for_each            = toset(["50", "80", "100"])
  provider            = aws.billing
  alarm_name          = "${var.name_prefix}-billing-${each.key}"
  alarm_description   = "Custo estimado total em USD acima de ${each.key}% do orçamento; exige Receive Billing Alerts."
  namespace           = "AWS/Billing"
  metric_name         = "EstimatedCharges"
  dimensions          = { Currency = "USD" }
  statistic           = "Maximum"
  period              = 21600
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = var.monthly_budget_usd * tonumber(each.key) / 100
  treat_missing_data  = "notBreaching"
  actions_enabled     = true
  alarm_actions       = [local.billing_topic_arn]
  tags                = var.tags
  depends_on          = [aws_sns_topic_policy.alerts, aws_sns_topic_policy.billing]
}

resource "aws_ce_anomaly_monitor" "services" {
  count             = var.enable_cost_anomaly_detection ? 1 : 0
  provider          = aws.billing
  name              = "${var.name_prefix}-services"
  monitor_type      = "DIMENSIONAL"
  monitor_dimension = "SERVICE"
  tags              = var.tags
}

resource "aws_ce_anomaly_subscription" "daily" {
  count            = var.enable_cost_anomaly_detection ? 1 : 0
  provider         = aws.billing
  name             = "${var.name_prefix}-anomalies"
  frequency        = "DAILY"
  monitor_arn_list = [aws_ce_anomaly_monitor.services[0].arn]
  tags             = var.tags

  subscriber {
    type    = "EMAIL"
    address = var.alert_email
  }
  threshold_expression {
    dimension {
      key           = "ANOMALY_TOTAL_IMPACT_ABSOLUTE"
      match_options = ["GREATER_THAN_OR_EQUAL"]
      values        = [tostring(var.monthly_budget_usd * 0.5)]
    }
  }
}

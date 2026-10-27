output "alert_topic_arn" {
  description = "Tópico SNS de alertas da aplicação (TLS obrigatório na publicação)."
  value       = aws_sns_topic.alerts.arn
}

output "billing_alert_topic_arn" {
  description = "Tópico SNS de billing em us-east-1 (pode ser o mesmo da aplicação)."
  value       = local.billing_topic_arn
}

output "log_group_names" {
  description = "Nomes determinísticos dos grupos lambda, api e audit."
  value       = { for key, group in aws_cloudwatch_log_group.this : key => group.name }
}

output "log_group_arns" {
  description = "ARNs dos grupos para configurar destinos e IAM."
  value       = { for key, group in aws_cloudwatch_log_group.this : key => group.arn }
}

output "alarm_arns" {
  description = "ARNs dos alarmes operacionais e financeiros."
  value = merge(
    { for key, alarm in aws_cloudwatch_metric_alarm.application : key => alarm.arn },
    { for key, alarm in aws_cloudwatch_metric_alarm.billing : "billing-${key}" => alarm.arn }
  )
}

output "dashboard_name" {
  description = "Nome do dashboard operacional."
  value       = aws_cloudwatch_dashboard.application.dashboard_name
}

output "budget_name" {
  description = "Nome do orçamento total mensal em USD."
  value       = aws_budgets_budget.monthly.name
}

output "resource_names" {
  description = "Nomes a respeitar nas próximas entregas de Lambda e DynamoDB."
  value       = local.resource_names
}

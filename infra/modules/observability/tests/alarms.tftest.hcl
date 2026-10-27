mock_provider "aws" {
  override_during = plan
  mock_resource "aws_sns_topic" {
    defaults = { arn = "arn:aws:sns:us-east-1:000000000000:miupy-test-alerts" }
  }
}
mock_provider "aws" {
  alias           = "billing"
  override_during = plan
}

variables {
  name_prefix        = "miupy-test"
  account_id         = "000000000000"
  aws_region         = "us-east-1"
  tags               = {}
  alert_email        = "voce@example.com"
  monthly_budget_usd = 10
  api_id             = "synthetic"
}

run "essential_alarms_and_tls" {
  command = plan
  providers = {
    aws         = aws
    aws.billing = aws.billing
  }
  assert {
    condition     = length(aws_cloudwatch_metric_alarm.application) + length(aws_cloudwatch_metric_alarm.billing) == 10
    error_message = "O padrão deve ter no máximo 10 alarmes de métrica, dentro da franquia."
  }
  assert {
    condition     = !contains(keys(aws_cloudwatch_metric_alarm.application), "lambda-duration") && length(aws_cloudwatch_log_metric_filter.this) == 0
    error_message = "Sem métricas derivadas de logs no padrão."
  }
  assert {
    condition     = jsondecode(aws_sns_topic_policy.alerts.policy).Statement[0].Sid == "DenyPublishWithoutTLS" && jsondecode(aws_sns_topic_policy.alerts.policy).Statement[0].Condition.Bool["aws:SecureTransport"] == "false"
    error_message = "O tópico nega publicação sem TLS."
  }
  assert {
    condition     = aws_sns_topic.alerts.kms_master_key_id == null && alltrue([for group in aws_cloudwatch_log_group.this : group.kms_key_id == null])
    error_message = "Tópicos e log groups usam a criptografia padrão do serviço."
  }
}

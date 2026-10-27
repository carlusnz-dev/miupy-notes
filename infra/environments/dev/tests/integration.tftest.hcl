# Providers simulados: nenhuma autenticacao ou chamada AWS.
mock_provider "aws" {
  override_during = plan
  mock_resource "aws_iam_user" {
    defaults = { arn = "arn:aws:iam::000000000000:user/miupy-test/miupy-test-admin" }
  }
}
mock_provider "aws" {
  alias           = "billing"
  override_during = plan
}
mock_provider "aws" {
  alias           = "west"
  override_during = plan
  mock_resource "aws_iam_user" {
    defaults = { arn = "arn:aws:iam::000000000000:user/miupy-test/miupy-test-admin" }
  }
}
variables {
  name_prefix             = "miupy-test"
  account_id              = "000000000000"
  aws_region              = "us-east-1"
  initial_provisioner_arn = "arn:aws:iam::000000000000:role/external-provisioner"
  alert_email             = "voce@example.com"
  monthly_budget_usd      = 10
  google_client_id        = "synthetic.apps.googleusercontent.com"
  allowed_subs_secret_arn = "arn:aws:secretsmanager:us-east-1:000000000000:secret:miupy-test/allowed-subs-synthetic"
  cors_allowed_origins    = ["http://tauri.localhost"]
  allowed_cidrs           = ["203.0.113.0/24", "2001:db8::/32"]
}
run "default_region" {
  command = plan
  assert {
    condition     = length(module.observability.alarm_arns) == 10 && length([for key, arn in module.observability.alarm_arns : key if !startswith(key, "billing-")]) == 7
    error_message = "Esperados 7 alarmes essenciais (Lambda, API, DynamoDB) e 3 de billing, sem alarme composto."
  }
  assert {
    condition     = length(aws_dynamodb_table.data.server_side_encryption) == 1 && aws_dynamodb_table.data.server_side_encryption[0].enabled == false
    error_message = "A tabela usa a chave AWS owned, sem CMK."
  }
  assert {
    condition     = toset(aws_apigatewayv2_api.this.cors_configuration[0].expose_headers) == toset(["retry-after", "x-request-id"])
    error_message = "O CORS deve expor Retry-After e X-Request-Id ao app."
  }
  assert {
    condition     = aws_apigatewayv2_route.health.route_key == "GET /health" && aws_apigatewayv2_route.health.authorizer_id == null && length(aws_apigatewayv2_api.this.cors_configuration[0].allow_origins) == 1
    error_message = "O CORS é configuração da API e cobre GET /health para as origens do app."
  }
  assert {
    condition     = module.iam.github_deploy_role_arn == null
    error_message = "OIDC permanece desligado."
  }
  assert {
    condition     = aws_dynamodb_table.data.billing_mode == "PAY_PER_REQUEST" && aws_dynamodb_table.data.deletion_protection_enabled && aws_dynamodb_table.data.point_in_time_recovery[0].enabled
    error_message = "A tabela deve ter cobrança sob demanda e proteção de recuperação/exclusão."
  }
  assert {
    condition     = aws_apigatewayv2_route.authenticated.authorization_type == "JWT" && aws_apigatewayv2_integration.api.payload_format_version == "2.0"
    error_message = "Rotas privadas exigem JWT e evento HTTP API v2."
  }
  assert {
    condition     = aws_apigatewayv2_stage.default.default_route_settings[0].throttling_rate_limit == 5 && aws_apigatewayv2_stage.default.default_route_settings[0].throttling_burst_limit == 10
    error_message = "O stage deve limitar taxa e rajada por padrão."
  }
  assert {
    condition     = aws_lambda_function.api.reserved_concurrent_executions == 5 && aws_lambda_function.api.environment[0].variables["ALLOWED_CIDRS"] == "203.0.113.0/24,2001:db8::/32"
    error_message = "A Lambda deve ter concorrência reservada baixa e receber a allow list de IP."
  }
  assert {
    condition     = alltrue([for field in ["requestId", "route", "status", "responseLatency", "integrationError", "authorizerError", "gatewayError"] : strcontains(aws_apigatewayv2_stage.default.access_log_settings[0].format, "\"${field}\"")]) && !strcontains(aws_apigatewayv2_stage.default.access_log_settings[0].format, "sourceIp")
    error_message = "O access log deve trazer requisição, rota, status, latência e erros, sem IP de origem."
  }
}

run "rejects_open_cidrs" {
  command = plan
  variables {
    allowed_cidrs = ["0.0.0.0/0"]
  }
  expect_failures = [var.allowed_cidrs]
}

run "rejects_empty_cidrs" {
  command = plan
  variables {
    allowed_cidrs = []
  }
  expect_failures = [var.allowed_cidrs]
}
run "other_region_and_opt_ins" {
  command   = plan
  providers = { aws = aws.west, aws.billing = aws.billing }
  variables {
    aws_region                    = "us-west-2"
    enable_s3_request_metrics     = true
    enable_cloudtrail_alarms      = true
    enable_cost_anomaly_detection = true
    allowed_subs_secret_arn       = "arn:aws:secretsmanager:us-west-2:000000000000:secret:miupy-test/allowed-subs-synthetic"
  }
  assert {
    condition     = length(module.observability.alarm_arns) == 14
    error_message = "Outra regiao soma os alarmes dos opt-ins (S3 e CloudTrail) aos essenciais."
  }
}

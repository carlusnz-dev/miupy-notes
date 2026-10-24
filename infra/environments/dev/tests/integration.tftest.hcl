# Providers simulados: nenhuma autenticacao ou chamada AWS.
mock_provider "aws" {
  override_during = plan
  mock_resource "aws_kms_key" {
    defaults = { arn = "arn:aws:kms:us-east-1:000000000000:key/00000000-0000-0000-0000-000000000001" }
  }
  mock_resource "aws_iam_user" {
    defaults = { arn = "arn:aws:iam::000000000000:user/miupy-test/miupy-test-admin" }
  }
}
mock_provider "aws" {
  alias           = "billing"
  override_during = plan
  mock_resource "aws_kms_key" {
    defaults = { arn = "arn:aws:kms:us-east-1:000000000000:key/00000000-0000-0000-0000-000000000002" }
  }
}
mock_provider "aws" {
  alias           = "west"
  override_during = plan
  mock_resource "aws_kms_key" {
    defaults = { arn = "arn:aws:kms:us-west-2:000000000000:key/00000000-0000-0000-0000-000000000003" }
  }
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
}
run "default_region" {
  command = plan
  assert {
    condition     = length(module.billing_key) == 0
    error_message = "A mesma regiao deve compartilhar a chave de observabilidade."
  }
  assert {
    condition     = length(module.observability.alarm_arns) == 24
    error_message = "Esperados 23 alarmes simples e um composto."
  }
  assert {
    condition     = module.iam.api_role_arn == null && module.iam.github_deploy_role_arn == null
    error_message = "Runtime e OIDC devem permanecer desligados."
  }
}
run "other_region_and_opt_ins" {
  command   = plan
  providers = { aws = aws.west, aws.billing = aws.billing }
  variables {
    aws_region                    = "us-west-2"
    enable_s3_request_metrics     = true
    enable_cloudtrail_alarms      = true
    enable_cost_anomaly_detection = true
    api_id                        = "synthetic-api"
  }
  assert {
    condition     = length(module.billing_key) == 1 && length(module.observability.alarm_arns) == 31
    error_message = "Outra regiao precisa de chave billing e alarmes dos opt-ins."
  }
}

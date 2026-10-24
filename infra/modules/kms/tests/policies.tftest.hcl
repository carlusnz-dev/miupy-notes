mock_provider "aws" { override_during = plan }
variables {
  name_prefix     = "miupy-test-objects"
  account_id      = "000000000000"
  aws_region      = "us-east-1"
  tags            = {}
  provisioner_arn = "arn:aws:iam::000000000000:role/miupy-test/miupy-test-provisioner"
  key_user_arns   = ["arn:aws:iam::000000000000:role/miupy-test/miupy-test-api"]
}
run "future_roles_and_s3_context" {
  command = plan
  variables { s3_bucket_arns = ["arn:aws:s3:::miupy-test-objects"] }
  assert {
    condition     = [for s in jsondecode(aws_kms_key.this.policy).Statement : s.Principal.AWS if s.Sid == "ExplicitKeyUsers"] == ["arn:aws:iam::000000000000:root"]
    error_message = "Roles futuras devem ser condicoes da delegacao da conta, sem Principal inexistente."
  }
  assert {
    condition     = [for s in jsondecode(aws_kms_key.this.policy).Statement : s.Condition.StringEquals["kms:ViaService"] if s.Sid == "ExplicitKeyUsers"] == ["s3.us-east-1.amazonaws.com"]
    error_message = "Uso criptografico dos objetos exige o servico S3."
  }
}
run "logs_and_sns_publishers" {
  command = plan
  variables {
    cloudwatch_log_group_arns = ["arn:aws:logs:us-east-1:000000000000:log-group:/aws/lambda/miupy-test-api"]
    sns_topic_arns            = ["arn:aws:sns:us-east-1:000000000000:miupy-test-alerts"]
    cloudwatch_alarm_arns     = ["arn:aws:cloudwatch:us-east-1:000000000000:alarm:miupy-test-*"]
    budget_arns               = ["arn:aws:budgets::000000000000:budget/miupy-test-total-monthly"]
  }
  assert {
    condition     = [for s in jsondecode(aws_kms_key.this.policy).Statement : s.Condition.StringEquals["aws:SourceAccount"] if s.Sid == "CloudWatchAlarmPublishers"] == ["000000000000"]
    error_message = "Publicacao em SNS precisa permanecer na conta explicita."
  }
  assert {
    condition     = alltrue([for s in jsondecode(aws_kms_key.this.policy).Statement : alltrue([for action in s.Action : !strcontains(action, "*")]) if s.Effect == "Allow"])
    error_message = "Allows KMS precisam enumerar acoes."
  }
}

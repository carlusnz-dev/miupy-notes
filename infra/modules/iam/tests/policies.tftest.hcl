mock_provider "aws" {
  override_during = plan
  mock_resource "aws_iam_user" {
    defaults = { arn = "arn:aws:iam::000000000000:user/miupy-test/miupy-test-admin" }
  }
  mock_resource "aws_iam_policy" {
    defaults = { arn = "arn:aws:iam::000000000000:policy/miupy-test/miupy-test-runtime-boundary" }
  }
}

variables {
  name_prefix    = "miupy-test"
  account_id     = "000000000000"
  aws_region     = "us-east-1"
  tags           = { Environment = "test" }
  app_bucket_arn = "arn:aws:s3:::miupy-test-objects"
}

run "closed_defaults" {
  command = plan
  assert {
    condition     = length(aws_iam_role.api) == 0 && length(aws_iam_role.github_deploy) == 0
    error_message = "API e OIDC não podem ser criados sem habilitação explícita."
  }
  assert {
    condition     = alltrue([for role in aws_iam_role.human : jsondecode(role.assume_role_policy).Statement[0].Condition.Bool["aws:MultiFactorAuthPresent"] == "true"])
    error_message = "Todas as trusts humanas exigem MFA."
  }
  assert {
    condition     = length(jsondecode(aws_iam_role_policy.provisioner.policy).Statement) > 0 && length(aws_iam_role_policy.provisioner.policy) < 10240
    error_message = "A policy deve caber no limite agregado de 10.240 caracteres de inline policies por role."
  }
  assert {
    condition     = alltrue([for s in jsondecode(aws_iam_role_policy.provisioner.policy).Statement : alltrue([for a in s.Action : !strcontains(a, "*") && !contains(["iam:DeleteRolePermissionsBoundary", "iam:CreatePolicyVersion", "iam:SetDefaultPolicyVersion", "iam:AttachRolePolicy", "iam:CreateUser", "iam:CreateAccessKey", "iam:PutUserPolicy", "iam:PutGroupPolicy"], a)])])
    error_message = "O provisionador não pode alterar boundary, grupos, usuários nem anexar policies arbitrárias."
  }
  assert {
    condition     = alltrue([for s in jsondecode(aws_iam_role_policy.provisioner.policy).Statement : !contains(s.Action, "iam:PassRole") || (s.Resource == [output.role_arns.api] && s.Condition.StringEquals["iam:PassedToService"] == "lambda.amazonaws.com")])
    error_message = "PassRole deve ser exclusivo da API para Lambda."
  }
  assert {
    condition     = alltrue([for s in jsondecode(aws_iam_role_policy.operator.policy).Statement : alltrue([for a in s.Action : !startswith(a, "iam:") && !startswith(a, "budgets:") && !startswith(a, "ce:") && !contains(["lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration"], a)])])
    error_message = "O operador não pode administrar IAM, billing ou implantar código."
  }
}
run "provisioner_scopes" {
  command = plan
  assert {
    condition     = alltrue([for s in jsondecode(aws_iam_role_policy.provisioner.policy).Statement : alltrue([for a in s.Action : !startswith(a, "kms:")])])
    error_message = "O provisionador não administra mais chaves KMS próprias."
  }
  assert {
    condition     = [for s in jsondecode(aws_iam_role_policy.provisioner.policy).Statement : s.Resource if s.Sid == "EnvironmentHttpApi"][0] == ["arn:aws:apigateway:us-east-1::/apis", "arn:aws:apigateway:us-east-1::/apis/*", "arn:aws:apigateway:us-east-1::/tags/*"]
    error_message = "API Gateway v2 deve ficar restrito a /apis e tags da região."
  }
}
run "runtime_scoped" {
  command = plan
  variables {
    enable_api_role             = true
    api_table_arn               = "arn:aws:dynamodb:us-east-1:000000000000:table/miupy-test-notes"
    api_log_group_arn           = "arn:aws:logs:us-east-1:000000000000:log-group:/aws/lambda/miupy-test-api"
    api_allowed_subs_secret_arn = "arn:aws:secretsmanager:us-east-1:000000000000:secret:miupy-test/allowed-subs-abcdef"
    api_s3_prefixes             = ["attachments/"]
  }
  assert {
    condition     = length(aws_iam_role.api) == 1 && aws_iam_role.api[0].permissions_boundary == aws_iam_policy.runtime_boundary.arn && aws_iam_role_policy.api[0].policy == aws_iam_policy.runtime_boundary.policy
    error_message = "Runtime deve receber a mesma superfície máxima da boundary."
  }
  assert {
    condition     = alltrue([for s in jsondecode(aws_iam_role_policy.api[0].policy).Statement : !contains(s.Resource, "*") && alltrue([for a in s.Action : !startswith(a, "iam:") && a != "dynamodb:Scan" && !strcontains(a, "*")])])
    error_message = "Runtime deve ter recursos específicos, sem Scan/IAM/coringa de ação."
  }
  assert {
    condition     = [for s in jsondecode(aws_iam_role_policy.api[0].policy).Statement : s.Resource if s.Sid == "ApplicationObjects"][0] == ["arn:aws:s3:::miupy-test-objects/attachments/*"]
    error_message = "O runtime só pode acessar o prefixo habilitado."
  }
  assert {
    condition     = [for s in jsondecode(aws_iam_role_policy.api[0].policy).Statement : s.Resource if s.Sid == "ReadAllowedSubs"][0] == [var.api_allowed_subs_secret_arn]
    error_message = "A role deve ler somente o segredo informado."
  }
  assert {
    condition     = alltrue([for s in jsondecode(aws_iam_role_policy.api[0].policy).Statement : alltrue([for a in s.Action : !startswith(a, "kms:")])])
    error_message = "Com criptografia gerenciada pela AWS o runtime não precisa de permissão KMS."
  }
}
run "backend_separate" {
  command = plan
  assert {
    condition     = length(aws_iam_role_policy.provisioner.policy) < 10240
    error_message = "A policy com backend também deve caber na quota da role."
  }
  variables {
    backend_bucket_arn = "arn:aws:s3:::miupy-test-state"
    backend_state_key  = "dev/terraform.tfstate"
  }
  assert {
    condition     = [for s in jsondecode(aws_iam_role_policy.provisioner.policy).Statement : contains(s.Action, "s3:DeleteObject") if s.Sid == "BackendState"] == [false]
    error_message = "O estado não pode ser apagado pelo provisionador."
  }
  assert {
    condition     = [for s in jsondecode(aws_iam_role_policy.provisioner.policy).Statement : s.Resource if s.Sid == "BackendLock"][0] == ["arn:aws:s3:::miupy-test-state/dev/terraform.tfstate.tflock"]
    error_message = "DeleteObject do backend deve atingir apenas o lock."
  }
}
run "oidc_exact_subject" {
  command = plan
  variables {
    enable_github_oidc       = true
    github_oidc_provider_arn = "arn:aws:iam::000000000000:oidc-provider/token.actions.githubusercontent.com"
    github_repository        = "example/miupy"
    github_subject           = "repo:example/miupy:environment:dev"
  }
  assert {
    condition     = jsondecode(aws_iam_role.github_deploy[0].assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"] == "repo:example/miupy:environment:dev"
    error_message = "OIDC deve exigir subject exato, sem curingas."
  }
}
run "reject_incomplete_api" {
  command = plan
  variables { enable_api_role = true }
  expect_failures = [var.enable_api_role]
}
run "reject_incomplete_backend" {
  command = plan
  variables { backend_bucket_arn = "arn:aws:s3:::miupy-test-state" }
  expect_failures = [var.backend_bucket_arn]
}
run "reject_unbounded_oidc" {
  command = plan
  variables {
    github_repository = "example/miupy"
    github_subject    = "repo:example/miupy:*"
  }
  expect_failures = [var.github_subject]
}

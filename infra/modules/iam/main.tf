locals {
  path           = "/${var.name_prefix}/"
  iam_prefix     = "arn:aws:iam::${var.account_id}"
  human_roles    = { admin = "provisioner", operator = "operator", monitor = "monitor" }
  role_arns      = { for role in ["provisioner", "operator", "monitor", "api", "github-deploy"] : replace(role, "-", "_") => "${local.iam_prefix}:role${local.path}${var.name_prefix}-${role}" }
  boundary_arn   = "${local.iam_prefix}:policy${local.path}${var.name_prefix}-runtime-boundary"
  lambda_arn     = "arn:aws:lambda:${var.aws_region}:${var.account_id}:function:${var.name_prefix}-api"
  table_arn      = "arn:aws:dynamodb:${var.aws_region}:${var.account_id}:table/${var.name_prefix}-*"
  log_group_arns = [for name in ["/aws/lambda/${var.name_prefix}-api", "/aws/apigateway/${var.name_prefix}-api", "/aws/cloudtrail/${var.name_prefix}-audit"] : "arn:aws:logs:${var.aws_region}:${var.account_id}:log-group:${name}"]

  runtime_statements = concat(
    var.api_table_arn == null ? [] : [{
      Sid      = "ApplicationItems", Effect = "Allow",
      Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query"],
      Resource = [var.api_table_arn]
    }],
    var.api_allowed_subs_secret_arn == null ? [] : [{
      Sid      = "ReadAllowedSubs", Effect = "Allow",
      Action   = ["secretsmanager:GetSecretValue"],
      Resource = [var.api_allowed_subs_secret_arn]
    }],
    var.api_log_group_arn == null ? [] : [{
      Sid      = "ApplicationLogStreams", Effect = "Allow",
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents"],
      Resource = ["${var.api_log_group_arn}:log-stream:*"]
    }],
    jsondecode(length(var.api_s3_prefixes) == 0 ? "[]" : jsonencode([
      {
        Sid      = "ApplicationObjects", Effect = "Allow",
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
        Resource = [for prefix in sort(tolist(var.api_s3_prefixes)) : "${var.app_bucket_arn}/${prefix}*"]
      }
    ]))
  )
  # Uma boundary vazia precisa de um statement válido; a negação total é fechada.
  runtime_policy = length(local.runtime_statements) > 0 ? jsonencode({ Version = "2012-10-17", Statement = local.runtime_statements }) : jsonencode({ Version = "2012-10-17", Statement = [{ Sid = "DisabledRuntime", Effect = "Deny", Action = ["sts:AssumeRole"], Resource = ["*"] }] })
}

resource "aws_iam_user" "human" {
  for_each      = local.human_roles
  name          = "${var.name_prefix}-${each.key}"
  path          = local.path
  force_destroy = false
  tags          = var.tags
}
resource "aws_iam_group" "human" {
  for_each = local.human_roles
  name     = "${var.name_prefix}-${each.key}"
  path     = local.path
}
resource "aws_iam_user_group_membership" "human" {
  for_each = local.human_roles
  user     = aws_iam_user.human[each.key].name
  groups   = [aws_iam_group.human[each.key].name]
}
resource "aws_iam_group_policy" "human" {
  for_each = local.human_roles
  name     = "${var.name_prefix}-self-and-assume"
  group    = aws_iam_group.human[each.key].name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AssumeAssignedRoleWithMFA", Effect = "Allow", Action = ["sts:AssumeRole"],
        Resource  = [local.role_arns[each.value]],
        Condition = { Bool = { "aws:MultiFactorAuthPresent" = "true" } }
      },
      {
        Sid      = "OwnPasswordAndMFAEnrollment", Effect = "Allow",
        Action   = ["iam:GetUser", "iam:ChangePassword", "iam:ListMFADevices", "iam:ResyncMFADevice"],
        Resource = [aws_iam_user.human[each.key].arn]
      },
      {
        Sid      = "OwnVirtualMFAEnrollment", Effect = "Allow", Action = ["iam:CreateVirtualMFADevice"],
        Resource = ["${local.iam_prefix}:mfa/${var.name_prefix}-${each.key}"]
      },
      {
        Sid       = "OwnMFAReplacementRequiresMFA", Effect = "Allow", Action = ["iam:EnableMFADevice", "iam:DeactivateMFADevice"],
        Resource  = [aws_iam_user.human[each.key].arn],
        Condition = { Bool = { "aws:MultiFactorAuthPresent" = "true" } }
      },
      {
        Sid       = "OwnVirtualMFADeletionRequiresMFA", Effect = "Allow", Action = ["iam:DeleteVirtualMFADevice"],
        Resource  = ["${local.iam_prefix}:mfa/${var.name_prefix}-${each.key}"],
        Condition = { Bool = { "aws:MultiFactorAuthPresent" = "true" } }
      },
      # Estas consultas IAM não aceitam ARN de recurso; apenas leitura de política da conta.
      { Sid = "PasswordPolicy", Effect = "Allow", Action = ["iam:GetAccountPasswordPolicy"], Resource = ["*"] }
    ]
  })
}
resource "aws_iam_role" "human" {
  for_each             = local.human_roles
  name                 = "${var.name_prefix}-${each.value}"
  path                 = local.path
  max_session_duration = 3600
  tags                 = var.tags
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow", Action = ["sts:AssumeRole"],
      Principal = { AWS = aws_iam_user.human[each.key].arn },
      Condition = { Bool = { "aws:MultiFactorAuthPresent" = "true" } }
    }]
  })
}
resource "aws_iam_policy" "runtime_boundary" {
  name   = "${var.name_prefix}-runtime-boundary"
  path   = local.path
  policy = local.runtime_policy
  tags   = var.tags
}
resource "aws_iam_role" "api" {
  count                = var.enable_api_role ? 1 : 0
  name                 = "${var.name_prefix}-api"
  path                 = local.path
  permissions_boundary = aws_iam_policy.runtime_boundary.arn
  tags                 = var.tags
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = ["sts:AssumeRole"], Principal = { Service = "lambda.amazonaws.com" } }]
  })
}
resource "aws_iam_role_policy" "api" {
  count  = var.enable_api_role ? 1 : 0
  name   = "${var.name_prefix}-runtime"
  role   = aws_iam_role.api[0].id
  policy = local.runtime_policy
}
resource "aws_iam_role" "github_deploy" {
  count                = var.enable_github_oidc ? 1 : 0
  name                 = "${var.name_prefix}-github-deploy"
  path                 = local.path
  max_session_duration = 3600
  tags                 = var.tags
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow", Action = ["sts:AssumeRoleWithWebIdentity"],
      Principal = { Federated = var.github_oidc_provider_arn },
      Condition = { StringEquals = { "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com", "token.actions.githubusercontent.com:sub" = var.github_subject } }
    }]
  })
  # Intencionalmente sem policies: ativar a confiança não concede deploy.
}
